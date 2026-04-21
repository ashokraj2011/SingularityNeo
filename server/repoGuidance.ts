/**
 * Copilot Guidance Pack fetcher.
 *
 * For each of a capability's linked repositories, this module fetches the
 * well-known copilot/AI-assistant authoring files that engineers have
 * already written (CLAUDE.md, AGENTS.md, .cursor/rules/*, …) and caches them
 * in Postgres.
 *
 * - Fetch mechanism: GitHub REST `/repos/{owner}/{repo}/contents/{path}`
 *   using `GITHUB_TOKEN` if present. Works for public repos without a
 *   token; private repos require the token. Gracefully returns
 *   `AUTH_MISSING` when a private repo is requested without creds.
 * - At agent session init, `readCapabilityCopilotGuidance` returns the
 *   cached rows. We never hit GitHub synchronously on session start —
 *   refresh is an explicit `POST .../refresh` action.
 * - Testing-category files (`docs/testing.md`, `TESTING.md`,
 *   `.github/copilot-instructions.md` testing sections) are separable so
 *   the learning judge can include them in its rubric.
 */
import { query } from './db';
import { getCapabilityRepositoriesRecord } from './repository';
import type {
  CapabilityCopilotGuidanceCategory,
  CapabilityCopilotGuidanceFetchStatus,
  CapabilityCopilotGuidanceFile,
  CapabilityCopilotGuidancePack,
} from '../src/types';

// ─────────────────────────────────────────────────────────────────────────
// Well-known paths
//
// Kept deliberately short. The point is to cover the dominant AI-assistant
// file conventions engineers are authoring today; if a team uses a novel
// path we'd rather extend this list than let them configure it inline
// (config sprawl + an attack surface for injecting arbitrary repo files
// into the agent's prompt).
// ─────────────────────────────────────────────────────────────────────────

interface WellKnownPath {
  path: string;
  category: CapabilityCopilotGuidanceCategory;
  /** When true, we look for a directory and pull all markdown under it. */
  directory?: boolean;
}

export const WELL_KNOWN_GUIDANCE_PATHS: WellKnownPath[] = [
  { path: 'CLAUDE.md', category: 'guidance' },
  { path: 'AGENTS.md', category: 'guidance' },
  { path: '.github/copilot-instructions.md', category: 'guidance' },
  { path: '.cursor/rules', category: 'guidance', directory: true },
  { path: '.aider.conf.yml', category: 'guidance' },
  { path: 'CONTRIBUTING.md', category: 'guidance' },
  { path: 'docs/testing.md', category: 'testing' },
  { path: 'TESTING.md', category: 'testing' },
  { path: 'docs/TESTING.md', category: 'testing' },
];

// Per-file hard cap so a giant CONTRIBUTING.md doesn't blow out the prompt.
const MAX_FILE_BYTES = 64 * 1024;
// Aggregate cap applied when we assemble the system-prompt block.
const PROMPT_GUIDANCE_BUDGET_BYTES = 24 * 1024;

// ─────────────────────────────────────────────────────────────────────────
// GitHub REST client
// ─────────────────────────────────────────────────────────────────────────

interface ParsedRepo {
  owner: string;
  repo: string;
  host: 'github.com' | 'other';
}

const parseRepoUrl = (url: string): ParsedRepo | null => {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  // Supported forms:
  //   https://github.com/owner/repo(.git)?
  //   git@github.com:owner/repo(.git)?
  //   github.com/owner/repo
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/i,
    /^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i,
    /^github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/i,
  ];
  for (const regex of patterns) {
    const match = trimmed.match(regex);
    if (match) {
      return { owner: match[1], repo: match[2], host: 'github.com' };
    }
  }
  return null;
};

const buildGithubHeaders = () => {
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SingularityNeo-CopilotGuidance/1.0',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return { headers, hasToken: Boolean(token) };
};

interface GithubFetchResult {
  status: CapabilityCopilotGuidanceFetchStatus;
  message?: string;
  files: Array<{
    filePath: string;
    content: string;
    sha: string;
  }>;
  commitSha?: string;
}

/**
 * Fetch a single file from GitHub. Returns `null` for 404 (file simply not
 * authored by the team — expected and non-fatal).
 */
const fetchGithubFile = async (
  parsed: ParsedRepo,
  filePath: string,
  branch: string,
  headers: Record<string, string>,
): Promise<{ content: string; sha: string } | null | 'rate_limited' | 'auth_missing'> => {
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURI(filePath)}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers });
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') return 'rate_limited';
    return 'auth_missing';
  }
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} on ${filePath}`);
  }
  const body = (await response.json()) as { content?: string; encoding?: string; sha?: string };
  if (!body.content) return null;
  const content =
    body.encoding === 'base64'
      ? Buffer.from(body.content, 'base64').toString('utf8')
      : body.content;
  if (content.length > MAX_FILE_BYTES) {
    return { content: `${content.slice(0, MAX_FILE_BYTES)}\n…[truncated]`, sha: body.sha || '' };
  }
  return { content, sha: body.sha || '' };
};

/**
 * List + fetch every markdown file under a directory (used for
 * `.cursor/rules/`). Returns [] for 404.
 */
const fetchGithubDirectory = async (
  parsed: ParsedRepo,
  directoryPath: string,
  branch: string,
  headers: Record<string, string>,
): Promise<Array<{ filePath: string; content: string; sha: string }> | 'rate_limited' | 'auth_missing'> => {
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURI(directoryPath)}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers });
  if (response.status === 404) return [];
  if (response.status === 401 || response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') return 'rate_limited';
    return 'auth_missing';
  }
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} listing ${directoryPath}`);
  }
  const entries = (await response.json()) as Array<{
    type: string;
    name: string;
    path: string;
    sha: string;
  }>;
  if (!Array.isArray(entries)) return [];
  const results: Array<{ filePath: string; content: string; sha: string }> = [];
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    if (!/\.(md|mdc|mdx|markdown)$/i.test(entry.name)) continue;
    const fileResult = await fetchGithubFile(parsed, entry.path, branch, headers);
    if (fileResult === 'rate_limited' || fileResult === 'auth_missing') {
      return fileResult;
    }
    if (fileResult) {
      results.push({ filePath: entry.path, content: fileResult.content, sha: fileResult.sha });
    }
  }
  return results;
};

const fetchRepositoryGuidance = async (
  url: string,
  defaultBranch: string,
): Promise<GithubFetchResult> => {
  const parsed = parseRepoUrl(url);
  if (!parsed) {
    return {
      status: 'ERROR',
      message: `Unsupported repo URL: ${url}. Only github.com URLs are supported today.`,
      files: [],
    };
  }
  const { headers, hasToken } = buildGithubHeaders();
  const branch = defaultBranch || 'main';

  const collected: GithubFetchResult['files'] = [];
  let authMissing = false;
  let rateLimited = false;

  for (const entry of WELL_KNOWN_GUIDANCE_PATHS) {
    try {
      if (entry.directory) {
        const dirResult = await fetchGithubDirectory(parsed, entry.path, branch, headers);
        if (dirResult === 'rate_limited') {
          rateLimited = true;
          break;
        }
        if (dirResult === 'auth_missing') {
          authMissing = true;
          continue;
        }
        for (const file of dirResult) {
          collected.push(file);
        }
      } else {
        const fileResult = await fetchGithubFile(parsed, entry.path, branch, headers);
        if (fileResult === 'rate_limited') {
          rateLimited = true;
          break;
        }
        if (fileResult === 'auth_missing') {
          authMissing = true;
          continue;
        }
        if (fileResult) {
          collected.push({ filePath: entry.path, content: fileResult.content, sha: fileResult.sha });
        }
      }
    } catch (error) {
      // Log and continue — a single file failure shouldn't kill the whole
      // pack. The caller sees the aggregate status based on collected vs.
      // attempted counts.
      console.warn(
        `[repoGuidance] ${parsed.owner}/${parsed.repo}:${entry.path} fetch failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (rateLimited) {
    return { status: 'RATE_LIMITED', files: collected, message: 'GitHub API rate limit exceeded.' };
  }
  if (!collected.length && authMissing && !hasToken) {
    return {
      status: 'AUTH_MISSING',
      files: [],
      message:
        'GitHub API returned 401/403 and no GITHUB_TOKEN is configured. Set GITHUB_TOKEN to ingest private-repo guidance.',
    };
  }

  return { status: 'OK', files: collected };
};

// ─────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────

const categoryForPath = (filePath: string): CapabilityCopilotGuidanceCategory => {
  const direct = WELL_KNOWN_GUIDANCE_PATHS.find(entry => entry.path === filePath);
  if (direct) return direct.category;
  // directory-style matches (e.g. `.cursor/rules/foo.md` → parent `.cursor/rules`)
  const prefixMatch = WELL_KNOWN_GUIDANCE_PATHS.find(
    entry => entry.directory && filePath.startsWith(`${entry.path}/`),
  );
  if (prefixMatch) return prefixMatch.category;
  return 'guidance';
};

const upsertGuidanceFile = async (row: {
  capabilityId: string;
  repositoryId: string;
  filePath: string;
  category: CapabilityCopilotGuidanceCategory;
  content: string;
  sha: string;
}) => {
  await query(
    `
      INSERT INTO capability_copilot_guidance (
        capability_id, repository_id, file_path, category, content, sha, size_bytes, fetched_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (capability_id, repository_id, file_path)
      DO UPDATE SET
        category = EXCLUDED.category,
        content = EXCLUDED.content,
        sha = EXCLUDED.sha,
        size_bytes = EXCLUDED.size_bytes,
        fetched_at = EXCLUDED.fetched_at
    `,
    [
      row.capabilityId,
      row.repositoryId,
      row.filePath,
      row.category,
      row.content,
      row.sha,
      Buffer.byteLength(row.content, 'utf8'),
    ],
  );
};

const deleteObsoleteFiles = async (
  capabilityId: string,
  repositoryId: string,
  keepFilePaths: string[],
) => {
  if (!keepFilePaths.length) {
    await query(
      `DELETE FROM capability_copilot_guidance WHERE capability_id = $1 AND repository_id = $2`,
      [capabilityId, repositoryId],
    );
    return;
  }
  await query(
    `DELETE FROM capability_copilot_guidance
       WHERE capability_id = $1 AND repository_id = $2 AND NOT (file_path = ANY($3))`,
    [capabilityId, repositoryId, keepFilePaths],
  );
};

const recordFetchAudit = async (
  capabilityId: string,
  status: CapabilityCopilotGuidanceFetchStatus,
  filesIngested: number,
  message?: string,
) => {
  await query(
    `
      INSERT INTO capability_copilot_guidance_fetches (
        capability_id, status, message, files_ingested
      ) VALUES ($1, $2, $3, $4)
    `,
    [capabilityId, status, message || null, filesIngested],
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export const refreshCapabilityCopilotGuidance = async (
  capabilityId: string,
): Promise<CapabilityCopilotGuidancePack> => {
  const repositories = await getCapabilityRepositoriesRecord(capabilityId);
  if (!repositories.length) {
    await recordFetchAudit(capabilityId, 'NOT_FOUND', 0, 'No repositories configured on capability.');
    return {
      capabilityId,
      files: [],
      lastFetchedAt: new Date().toISOString(),
      lastFetchStatus: 'NOT_FOUND',
      lastFetchMessage: 'No repositories configured on capability.',
    };
  }

  let aggregate: CapabilityCopilotGuidanceFetchStatus = 'OK';
  let aggregateMessage: string | undefined;
  let totalFiles = 0;

  for (const repo of repositories) {
    if (repo.status === 'ARCHIVED') continue;
    const result = await fetchRepositoryGuidance(repo.url, repo.defaultBranch);
    if (result.status !== 'OK' && aggregate === 'OK') {
      aggregate = result.status;
      aggregateMessage = result.message;
    }
    // Write what we got — partial success is still useful.
    for (const file of result.files) {
      await upsertGuidanceFile({
        capabilityId,
        repositoryId: repo.id,
        filePath: file.filePath,
        category: categoryForPath(file.filePath),
        content: file.content,
        sha: file.sha,
      });
    }
    await deleteObsoleteFiles(
      capabilityId,
      repo.id,
      result.files.map(file => file.filePath),
    );
    totalFiles += result.files.length;
  }

  await recordFetchAudit(capabilityId, aggregate, totalFiles, aggregateMessage);
  return readCapabilityCopilotGuidance(capabilityId);
};

export const readCapabilityCopilotGuidance = async (
  capabilityId: string,
): Promise<CapabilityCopilotGuidancePack> => {
  const repositories = await getCapabilityRepositoriesRecord(capabilityId);
  const repoLabelById = new Map(repositories.map(repo => [repo.id, repo.label]));

  const rowsResult = await query(
    `
      SELECT repository_id, file_path, category, content, sha, commit_sha, size_bytes, fetched_at
      FROM capability_copilot_guidance
      WHERE capability_id = $1
      ORDER BY category ASC, repository_id ASC, file_path ASC
    `,
    [capabilityId],
  );

  const files: CapabilityCopilotGuidanceFile[] = (rowsResult.rows as Array<Record<string, any>>).map(
    row => ({
      repositoryId: String(row.repository_id),
      repositoryLabel: repoLabelById.get(String(row.repository_id)),
      filePath: String(row.file_path),
      content: String(row.content || ''),
      sha: String(row.sha || ''),
      category: (row.category === 'testing' ? 'testing' : 'guidance'),
      commitSha: row.commit_sha ? String(row.commit_sha) : undefined,
      fetchedAt: new Date(row.fetched_at).toISOString(),
      sizeBytes: Number(row.size_bytes || 0),
    }),
  );

  const auditResult = await query(
    `
      SELECT fetched_at, status, message, files_ingested
      FROM capability_copilot_guidance_fetches
      WHERE capability_id = $1
      ORDER BY fetched_at DESC
      LIMIT 1
    `,
    [capabilityId],
  );
  const lastAudit = auditResult.rows[0] as Record<string, any> | undefined;

  return {
    capabilityId,
    files,
    lastFetchedAt: lastAudit ? new Date(lastAudit.fetched_at).toISOString() : undefined,
    lastFetchStatus: lastAudit ? (lastAudit.status as CapabilityCopilotGuidanceFetchStatus) : undefined,
    lastFetchMessage: lastAudit?.message ? String(lastAudit.message) : undefined,
  };
};

// ─────────────────────────────────────────────────────────────────────────
// Block assembly — shared by the system prompt + judge rubric
// ─────────────────────────────────────────────────────────────────────────

/**
 * Phase → guidance category router.
 *
 * `WorkItemPhase` is a free-form string (DESIGN, DEVELOPMENT, QA, RELEASE,
 * ANALYSIS, GOVERNANCE, …) that varies per workflow template, so we match
 * on lowercased substrings rather than a fixed enum. Agents running in a
 * QA/testing phase only receive the "testing" category (≈8 KB) and skip
 * the full 24 KB guidance pack — the single biggest input-token saving.
 *
 * Pass an unknown phase → returns null → caller should fall back to
 * today's behavior (full guidance pack).
 */
export const selectGuidanceCategoriesForPhase = (
  phase: string | null | undefined,
): { categories: CapabilityCopilotGuidanceCategory[]; byteBudget?: number } | null => {
  const normalized = (phase || '').trim().toLowerCase();
  if (!normalized) return null;

  // Testing / validation / QA phases: only testing rules.
  if (/\b(qa|test|valid|verif)/i.test(normalized)) {
    return { categories: ['testing'], byteBudget: 8 * 1024 };
  }

  // Release / deploy / delivery phases: compact guidance, no testing.
  if (/\b(release|deliver|deploy|launch)/i.test(normalized)) {
    return { categories: ['guidance'], byteBudget: 6 * 1024 };
  }

  // Governance / review phases: compact guidance only (policy & checklists).
  if (/\b(govern|review|audit)/i.test(normalized)) {
    return { categories: ['guidance'], byteBudget: 8 * 1024 };
  }

  // Discover / analyze / plan / design / inception / elaboration: guidance
  // only, full budget (architecture + house style are actually useful here).
  if (/\b(discover|analy|plan|design|incept|elabor)/i.test(normalized)) {
    return { categories: ['guidance'], byteBudget: PROMPT_GUIDANCE_BUDGET_BYTES };
  }

  // Development / build / construction / implementation: guidance + testing.
  if (/\b(dev|build|constr|impl|code)/i.test(normalized)) {
    return {
      categories: ['guidance', 'testing'],
      byteBudget: PROMPT_GUIDANCE_BUDGET_BYTES,
    };
  }

  // Unknown phase string — let caller fall back to today's default.
  return null;
};

/**
 * Assemble a compact, deduped text block from the cached guidance files.
 * Applies the aggregate byte budget and tags each file so the agent can
 * cite it back in its responses. Returns null when no files are cached.
 *
 * `categoryFilter` accepts either a single category (legacy) or an array
 * (phase-sliced). `phase` is a convenience shortcut that looks up the
 * right categories + byteBudget for a `WorkItemPhase` string.
 */
export const buildGuidanceBlockFromPack = (
  pack: CapabilityCopilotGuidancePack,
  options: {
    categoryFilter?: CapabilityCopilotGuidanceCategory | CapabilityCopilotGuidanceCategory[];
    byteBudget?: number;
    phase?: string | null;
  } = {},
): string | null => {
  // Resolve phase first so an explicit categoryFilter can still override it.
  let effectiveCategories: CapabilityCopilotGuidanceCategory[] | null = null;
  let effectiveBudget = options.byteBudget ?? PROMPT_GUIDANCE_BUDGET_BYTES;

  if (options.categoryFilter) {
    effectiveCategories = Array.isArray(options.categoryFilter)
      ? options.categoryFilter
      : [options.categoryFilter];
  } else if (options.phase) {
    const phaseSlice = selectGuidanceCategoriesForPhase(options.phase);
    if (phaseSlice) {
      effectiveCategories = phaseSlice.categories;
      if (options.byteBudget === undefined && phaseSlice.byteBudget !== undefined) {
        effectiveBudget = phaseSlice.byteBudget;
      }
    }
  }

  const budget = effectiveBudget;
  const selected = effectiveCategories
    ? pack.files.filter(file => effectiveCategories!.includes(file.category))
    : pack.files;
  if (!selected.length) return null;

  const sections: string[] = [];
  let usedBytes = 0;
  for (const file of selected) {
    const header = `── ${file.filePath}${
      file.repositoryLabel ? ` (${file.repositoryLabel})` : ''
    } ──`;
    const remaining = budget - usedBytes - header.length - 2;
    if (remaining <= 200) {
      sections.push(`${header}\n…[${selected.length - sections.length} more guidance file(s) truncated for prompt budget]`);
      break;
    }
    const body =
      file.content.length > remaining
        ? `${file.content.slice(0, remaining - 24)}\n…[truncated]`
        : file.content;
    sections.push(`${header}\n${body}`);
    usedBytes += header.length + body.length + 2;
  }

  if (!sections.length) return null;
  return sections.join('\n\n');
};

/**
 * Convenience: read from DB + assemble the "guidance" block (covers
 * authoring conventions, agent roles, house style). Returns null when
 * there's no cached content. Safe to call on every session init — no
 * network I/O.
 */
export const loadGuidanceSystemPromptBlock = async (
  capabilityId: string,
  options: { phase?: string | null } = {},
): Promise<string | null> => {
  const pack = await readCapabilityCopilotGuidance(capabilityId);
  // If a phase is provided and we have a mapping for it, use the phase
  // slice (which may select testing-only, guidance-only, or both with a
  // tighter budget). Otherwise default to the "guidance" category with
  // the full budget (today's behavior).
  if (options.phase) {
    const phaseSlice = selectGuidanceCategoriesForPhase(options.phase);
    if (phaseSlice) {
      return buildGuidanceBlockFromPack(pack, { phase: options.phase });
    }
  }
  return buildGuidanceBlockFromPack(pack, { categoryFilter: 'guidance' });
};

/**
 * Same, but returns only the "testing" category — for the learning judge
 * rubric and EvalCenter house-rules panel.
 */
export const loadTestingGuidanceBlock = async (
  capabilityId: string,
  byteBudget = 8 * 1024,
): Promise<string | null> => {
  const pack = await readCapabilityCopilotGuidance(capabilityId);
  return buildGuidanceBlockFromPack(pack, {
    categoryFilter: 'testing',
    byteBudget,
  });
};
