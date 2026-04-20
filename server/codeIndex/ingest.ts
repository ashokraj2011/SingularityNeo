/**
 * Code-index ingestion pipeline (Phase A).
 *
 * For each `CapabilityRepository` we:
 *   1. List the repo's entire file tree via the GitHub Git Trees API
 *      (one recursive request).
 *   2. Filter to TS/JS source files, skip vendor/build/generated paths,
 *      cap at MAX_FILES_PER_REPO so a megarepo doesn't blow us up.
 *   3. Fetch each file's content in limited-concurrency batches.
 *   4. Parse with the TypeScript compiler API (see parse.ts) to extract
 *      top-level symbols + module references.
 *   5. Truncate-and-insert into `capability_code_symbols` and
 *      `capability_code_references` inside a single transaction — we
 *      never want search queries to observe a half-updated index.
 *   6. Append a run audit row to `capability_code_index_runs`.
 *
 * All failures per-repo are captured in the audit row's `message` —
 * one bad repo doesn't kill the capability-level run.
 */
import type { PoolClient } from 'pg';
import { query, transaction } from '../db';
import { getCapabilityRepositoriesRecord } from '../repository';
import type {
  CapabilityCodeIndexRunStatus,
  CapabilityCodeIndexSnapshot,
  CapabilityRepository,
} from '../../src/types';
import { extractSymbolsFromSource } from './parse';
import { extractSymbolsFromJavaSource } from './parseJava';
import { extractSymbolsFromPythonSource } from './parsePython';
import { readCodeIndexSnapshot } from './query';

// ─────────────────────────────────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────────────────────────────────

/** Hard cap so a 50k-file monorepo doesn't exhaust the pg pool. */
const MAX_FILES_PER_REPO = 1500;
/** Per-file byte cap — huge generated files contribute no useful symbols. */
const MAX_FILE_BYTES = 256 * 1024;
/** Concurrency for blob fetches; GitHub rate-limits at 5k/hr with a token. */
const FETCH_CONCURRENCY = 4;
/** Symbols batched per INSERT to keep statements reasonable. */
const INSERT_BATCH_SIZE = 200;

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|java|py|pyw)$/i;

/** Paths we never want indexed regardless of repo shape. */
const DENY_PATH_PATTERNS: RegExp[] = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.cache(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)out(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)vendor(\/|$)/,
  // Java-land build output dirs.
  /(^|\/)target(\/|$)/, // Maven
  /(^|\/)\.gradle(\/|$)/,
  /(^|\/)generated(\/|$)/,
  /(^|\/)generated-sources(\/|$)/,
  // Python virtualenvs / caches / installed packages.
  /(^|\/)__pycache__(\/|$)/,
  /(^|\/)\.venv(\/|$)/,
  /(^|\/)venv(\/|$)/,
  /(^|\/)env(\/|$)/,
  /(^|\/)\.tox(\/|$)/,
  /(^|\/)\.mypy_cache(\/|$)/,
  /(^|\/)\.pytest_cache(\/|$)/,
  /(^|\/)\.ruff_cache(\/|$)/,
  /(^|\/)site-packages(\/|$)/,
  /\.egg-info(\/|$)/,
  /\.min\.(js|mjs|cjs)$/i,
  /\.d\.ts$/i, // declarations carry no extractable bodies
  /\.pyi$/i, // Python type stubs carry no bodies, same as .d.ts
];

const shouldIndex = (filePath: string) =>
  SOURCE_EXTENSIONS.test(filePath) &&
  !DENY_PATH_PATTERNS.some(pattern => pattern.test(filePath));

/** Dispatch parser by extension: brace-walker for Java, indent-walker for Python, TS compiler for everything else. */
const parseSourceFile = (filePath: string, content: string) => {
  if (/\.java$/i.test(filePath)) {
    return extractSymbolsFromJavaSource(filePath, content);
  }
  if (/\.pyw?$/i.test(filePath)) {
    return extractSymbolsFromPythonSource(filePath, content);
  }
  return extractSymbolsFromSource(filePath, content);
};

// ─────────────────────────────────────────────────────────────────────────
// GitHub REST
// ─────────────────────────────────────────────────────────────────────────

interface ParsedRepo {
  owner: string;
  repo: string;
}

const parseRepoUrl = (url: string): ParsedRepo | null => {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/i,
    /^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i,
    /^github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/i,
  ];
  for (const regex of patterns) {
    const match = trimmed.match(regex);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
};

const buildGithubHeaders = () => {
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SingularityNeo-CodeIndex/1.0',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { headers, hasToken: Boolean(token) };
};

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

const listRepoTree = async (
  parsed: ParsedRepo,
  branch: string,
  headers: Record<string, string>,
): Promise<
  | { ok: true; entries: TreeEntry[]; truncated: boolean }
  | { ok: false; status: CapabilityCodeIndexRunStatus; message: string }
> => {
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const response = await fetch(url, { headers });
  if (response.status === 404) {
    return { ok: false, status: 'EMPTY', message: `Branch ${branch} not found on GitHub.` };
  }
  if (response.status === 401 || response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      return { ok: false, status: 'RATE_LIMITED', message: 'GitHub rate limit exhausted.' };
    }
    return { ok: false, status: 'AUTH_MISSING', message: 'GitHub token lacks access to this repo.' };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: 'ERROR',
      message: `GitHub ${response.status} listing tree.`,
    };
  }
  const body = (await response.json()) as {
    tree?: TreeEntry[];
    truncated?: boolean;
  };
  const entries = Array.isArray(body.tree) ? body.tree : [];
  return { ok: true, entries, truncated: Boolean(body.truncated) };
};

const fetchBlobContent = async (
  parsed: ParsedRepo,
  sha: string,
  headers: Record<string, string>,
): Promise<string | null> => {
  // git/blobs returns base64 regardless of size — and avoids the 1 MB
  // ceiling on /contents. We cap by size before calling anyway.
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/blobs/${sha}`;
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const body = (await response.json()) as { content?: string; encoding?: string };
  if (!body.content) return null;
  const decoded =
    body.encoding === 'base64'
      ? Buffer.from(body.content, 'base64').toString('utf8')
      : body.content;
  return decoded;
};

// ─────────────────────────────────────────────────────────────────────────
// Per-repo ingest
// ─────────────────────────────────────────────────────────────────────────

interface RepoIngestResult {
  repositoryId: string;
  repositoryLabel: string;
  status: CapabilityCodeIndexRunStatus;
  message?: string;
  filesIndexed: number;
  symbolsIndexed: number;
  referencesIndexed: number;
  symbolRows: SymbolRow[];
  referenceRows: ReferenceRow[];
}

interface SymbolRow {
  capabilityId: string;
  repositoryId: string;
  filePath: string;
  symbolName: string;
  kind: string;
  parentSymbol: string; // empty-string sentinel; TEXT PK can't be NULL
  startLine: number;
  endLine: number;
  signature: string;
  isExported: boolean;
  sha: string | null;
}

interface ReferenceRow {
  capabilityId: string;
  repositoryId: string;
  fromFile: string;
  toModule: string;
  kind: 'IMPORTS' | 'REEXPORTS';
}

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
};

const ingestRepository = async (
  capabilityId: string,
  repository: CapabilityRepository,
  headers: Record<string, string>,
): Promise<RepoIngestResult> => {
  const label = repository.label || repository.url || repository.id;
  const parsed = parseRepoUrl(repository.url);
  if (!parsed) {
    return {
      repositoryId: repository.id,
      repositoryLabel: label,
      status: 'ERROR',
      message: 'Repository URL is not a recognised GitHub URL.',
      filesIndexed: 0,
      symbolsIndexed: 0,
      referencesIndexed: 0,
      symbolRows: [],
      referenceRows: [],
    };
  }

  const branch = repository.defaultBranch || 'main';
  const tree = await listRepoTree(parsed, branch, headers);
  if (tree.ok === false) {
    return {
      repositoryId: repository.id,
      repositoryLabel: label,
      status: tree.status,
      message: tree.message,
      filesIndexed: 0,
      symbolsIndexed: 0,
      referencesIndexed: 0,
      symbolRows: [],
      referenceRows: [],
    };
  }

  // Filter + cap.
  const candidates = tree.entries
    .filter(entry => entry.type === 'blob' && shouldIndex(entry.path))
    .filter(entry => !entry.size || entry.size <= MAX_FILE_BYTES)
    .slice(0, MAX_FILES_PER_REPO);

  if (!candidates.length) {
    return {
      repositoryId: repository.id,
      repositoryLabel: label,
      status: 'EMPTY',
      message: tree.truncated
        ? 'Tree truncated by GitHub; consider narrowing the indexed paths.'
        : 'No indexable source files (.ts/.tsx/.js/.jsx/.mjs/.cjs/.java/.py) found in this repo.',
      filesIndexed: 0,
      symbolsIndexed: 0,
      referencesIndexed: 0,
      symbolRows: [],
      referenceRows: [],
    };
  }

  // Fetch blobs in parallel, but never burst.
  const contents = await mapWithConcurrency(candidates, FETCH_CONCURRENCY, async entry => {
    try {
      const content = await fetchBlobContent(parsed, entry.sha, headers);
      return { entry, content, error: null as string | null };
    } catch (error) {
      return {
        entry,
        content: null,
        error: error instanceof Error ? error.message : 'fetch failed',
      };
    }
  });

  const symbolRows: SymbolRow[] = [];
  const referenceRows: ReferenceRow[] = [];
  let filesIndexed = 0;
  let fetchErrors = 0;

  for (const { entry, content, error } of contents) {
    if (!content) {
      if (error) fetchErrors += 1;
      continue;
    }
    filesIndexed += 1;
    let parsedFile;
    try {
      parsedFile = parseSourceFile(entry.path, content);
    } catch (parseError) {
      // Unparseable file — log and skip, don't fail the whole run.
      console.warn(
        '[codeIndex] parse failed',
        entry.path,
        parseError instanceof Error ? parseError.message : parseError,
      );
      continue;
    }
    for (const symbol of parsedFile.symbols) {
      symbolRows.push({
        capabilityId,
        repositoryId: repository.id,
        filePath: entry.path,
        symbolName: symbol.symbolName,
        kind: symbol.kind,
        parentSymbol: symbol.parentSymbol || '',
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        signature: symbol.signature,
        isExported: symbol.isExported,
        sha: entry.sha || null,
      });
    }
    for (const ref of parsedFile.references) {
      referenceRows.push({
        capabilityId,
        repositoryId: repository.id,
        fromFile: entry.path,
        toModule: ref.toModule,
        kind: ref.kind,
      });
    }
  }

  let status: CapabilityCodeIndexRunStatus = 'OK';
  let message: string | undefined;
  if (fetchErrors > 0 && fetchErrors < candidates.length) {
    status = 'PARTIAL';
    message = `${fetchErrors} of ${candidates.length} blobs failed to fetch.`;
  } else if (fetchErrors && fetchErrors === candidates.length) {
    status = 'ERROR';
    message = `All ${candidates.length} blob fetches failed.`;
  } else if (tree.truncated) {
    status = 'PARTIAL';
    message = 'GitHub truncated the tree listing; some files were not considered.';
  }

  return {
    repositoryId: repository.id,
    repositoryLabel: label,
    status,
    message,
    filesIndexed,
    symbolsIndexed: symbolRows.length,
    referencesIndexed: referenceRows.length,
    symbolRows,
    referenceRows,
  };
};

// ─────────────────────────────────────────────────────────────────────────
// DB writes
// ─────────────────────────────────────────────────────────────────────────

const writeSymbolsInTransaction = async (
  client: PoolClient,
  capabilityId: string,
  repositoryIds: string[],
  symbolRows: SymbolRow[],
  referenceRows: ReferenceRow[],
) => {
  // Truncate the capability's current index for the repos we're refreshing.
  // We scope by (capability_id, repository_id IN …) so a future partial
  // refresh of one repo won't nuke siblings.
  if (!repositoryIds.length) return;
  await client.query(
    `DELETE FROM capability_code_symbols WHERE capability_id = $1 AND repository_id = ANY($2::text[])`,
    [capabilityId, repositoryIds],
  );
  await client.query(
    `DELETE FROM capability_code_references WHERE capability_id = $1 AND repository_id = ANY($2::text[])`,
    [capabilityId, repositoryIds],
  );

  // Batched multi-row INSERTs — one round-trip per 200 symbols instead of
  // per-row. Pg's max params is 65k so a batch of 200 × 11 cols = 2200
  // params sits comfortably under the ceiling.
  for (let offset = 0; offset < symbolRows.length; offset += INSERT_BATCH_SIZE) {
    const chunk = symbolRows.slice(offset, offset + INSERT_BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((row, i) => {
      const base = i * 11;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`,
      );
      params.push(
        row.capabilityId,
        row.repositoryId,
        row.filePath,
        row.symbolName,
        row.kind,
        row.parentSymbol,
        row.startLine,
        row.endLine,
        row.signature,
        row.isExported,
        row.sha,
      );
    });
    await client.query(
      `
        INSERT INTO capability_code_symbols (
          capability_id, repository_id, file_path, symbol_name, kind,
          parent_symbol, start_line, end_line, signature, is_exported, sha
        ) VALUES ${values.join(', ')}
        ON CONFLICT DO NOTHING
      `,
      params,
    );
  }

  for (let offset = 0; offset < referenceRows.length; offset += INSERT_BATCH_SIZE) {
    const chunk = referenceRows.slice(offset, offset + INSERT_BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((row, i) => {
      const base = i * 5;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`,
      );
      params.push(
        row.capabilityId,
        row.repositoryId,
        row.fromFile,
        row.toModule,
        row.kind,
      );
    });
    await client.query(
      `
        INSERT INTO capability_code_references (
          capability_id, repository_id, from_file, to_module, kind
        ) VALUES ${values.join(', ')}
        ON CONFLICT DO NOTHING
      `,
      params,
    );
  }
};

const recordRunAudit = async (
  capabilityId: string,
  startedAt: Date,
  endedAt: Date,
  status: CapabilityCodeIndexRunStatus,
  counts: {
    repositoriesIndexed: number;
    filesIndexed: number;
    symbolsIndexed: number;
    referencesIndexed: number;
  },
  message: string | null,
) => {
  await query(
    `
      INSERT INTO capability_code_index_runs (
        capability_id, started_at, ended_at, status,
        repositories_indexed, files_indexed, symbols_indexed, references_indexed, message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      capabilityId,
      startedAt.toISOString(),
      endedAt.toISOString(),
      status,
      counts.repositoriesIndexed,
      counts.filesIndexed,
      counts.symbolsIndexed,
      counts.referencesIndexed,
      message,
    ],
  );
};

const aggregateStatus = (
  repoResults: RepoIngestResult[],
): CapabilityCodeIndexRunStatus => {
  if (!repoResults.length) return 'EMPTY';
  const nonEmpty = repoResults.filter(r => r.status !== 'EMPTY');
  if (!nonEmpty.length) return 'EMPTY';
  if (nonEmpty.every(r => r.status === 'OK')) return 'OK';
  if (nonEmpty.some(r => r.status === 'AUTH_MISSING')) return 'AUTH_MISSING';
  if (nonEmpty.some(r => r.status === 'RATE_LIMITED')) return 'RATE_LIMITED';
  if (nonEmpty.every(r => r.status === 'ERROR')) return 'ERROR';
  return 'PARTIAL';
};

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export const refreshCapabilityCodeIndex = async (
  capabilityId: string,
): Promise<CapabilityCodeIndexSnapshot> => {
  const startedAt = new Date();
  const repositories = await getCapabilityRepositoriesRecord(capabilityId);

  if (!repositories.length) {
    const endedAt = new Date();
    await recordRunAudit(
      capabilityId,
      startedAt,
      endedAt,
      'EMPTY',
      { repositoriesIndexed: 0, filesIndexed: 0, symbolsIndexed: 0, referencesIndexed: 0 },
      'No repositories configured on capability.',
    );
    return readCodeIndexSnapshot(capabilityId);
  }

  const { headers, hasToken } = buildGithubHeaders();

  const repoResults: RepoIngestResult[] = [];
  for (const repo of repositories) {
    try {
      const result = await ingestRepository(capabilityId, repo, headers);
      repoResults.push(result);
    } catch (error) {
      repoResults.push({
        repositoryId: repo.id,
        repositoryLabel: repo.label || repo.url || repo.id,
        status: 'ERROR',
        message: error instanceof Error ? error.message : 'ingestion failed',
        filesIndexed: 0,
        symbolsIndexed: 0,
        referencesIndexed: 0,
        symbolRows: [],
        referenceRows: [],
      });
    }
  }

  const allSymbols = repoResults.flatMap(r => r.symbolRows);
  const allReferences = repoResults.flatMap(r => r.referenceRows);
  const touchedRepoIds = repoResults.map(r => r.repositoryId);

  // Write in a single transaction so search queries never observe a
  // half-updated index.
  await transaction(async client => {
    await writeSymbolsInTransaction(
      client,
      capabilityId,
      touchedRepoIds,
      allSymbols,
      allReferences,
    );
  });

  const endedAt = new Date();
  const aggregate = aggregateStatus(repoResults);
  const aggregateMessage = (() => {
    const messages = repoResults
      .filter(r => r.message)
      .map(r => `${r.repositoryLabel}: ${r.message}`);
    if (!messages.length && !hasToken) {
      return 'No GITHUB_TOKEN in env; private repos will not index.';
    }
    return messages.length ? messages.join(' · ') : null;
  })();

  await recordRunAudit(
    capabilityId,
    startedAt,
    endedAt,
    aggregate,
    {
      repositoriesIndexed: repoResults.filter(r => r.status === 'OK' || r.status === 'PARTIAL').length,
      filesIndexed: repoResults.reduce((sum, r) => sum + r.filesIndexed, 0),
      symbolsIndexed: allSymbols.length,
      referencesIndexed: allReferences.length,
    },
    aggregateMessage,
  );

  return readCodeIndexSnapshot(capabilityId);
};
