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
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { query, transaction } from '../db';
import { getCapabilityRepositoriesRecord, getWorkspaceSettings } from '../repository';
import type {
  CapabilityCodeIndexRunStatus,
  CapabilityCodeIndexSnapshot,
  CapabilityRepository,
  WorkspaceSettings,
} from '../../src/types';
import { extractSymbolsFromSource, normalizeExtractedSymbols } from './parse';
import { extractSymbolsFromJavaSource } from './parseJava';
import { extractSymbolsFromPythonSource } from './parsePython';
import { readCodeIndexSnapshot } from './query';
import { normalizeDirectoryPath } from '../workspacePaths';

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

const SOURCE_PATH_PRIORITY_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /(^|\/)(src|app|server|client|lib|internal)\//i, score: 0 },
  { pattern: /(^|\/)packages\/[^/]+\/src\//i, score: 0 },
  { pattern: /(^|\/)(components|services|modules|domain|api)\//i, score: 1 },
  { pattern: /(^|\/)(tests?|spec|__tests__)\//i, score: 3 },
  { pattern: /(^|\/)(examples?|sample|demo|scripts)\//i, score: 4 },
];

const scoreIndexCandidatePath = (filePath: string) => {
  for (const entry of SOURCE_PATH_PRIORITY_PATTERNS) {
    if (entry.pattern.test(filePath)) {
      return entry.score;
    }
  }
  return 2;
};

/** Dispatch parser by extension: AST-backed Java/Python with heuristic fallback, TS compiler for everything else. */
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
  host: string;
  owner: string;
  repo: string;
}

const parseRepoUrl = (url: string): ParsedRepo | null => {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (parts.length >= 2) {
        return {
          host: parsed.hostname,
          owner: parts[0],
          repo: parts[1].replace(/\.git$/i, ''),
        };
      }
    }
  } catch {
    // fall through
  }

  {
    const match = trimmed.match(/^git@([^:]+):([^/]+)\/([^/.]+)(?:\.git)?$/i);
    if (match) {
      return {
        host: match[1],
        owner: match[2],
        repo: match[3],
      };
    }
  }

  {
    const parts = trimmed.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (parts.length === 2) {
      return {
        host: 'github.com',
        owner: parts[0],
        repo: parts[1].replace(/\.git$/i, ''),
      };
    }
    if (parts.length >= 3 && (parts[0].includes('.') || parts[0].toLowerCase() === 'github.com')) {
      return {
        host: parts[0],
        owner: parts[1],
        repo: parts[2].replace(/\.git$/i, ''),
      };
    }
  }
  return null;
};

const normalizeGithubApiBaseUrl = (value?: string, repoHost?: string) => {
  const trimmed = String(value || '').trim().replace(/\/+$/g, '');
  if (!trimmed) {
    return repoHost && repoHost !== 'github.com'
      ? `https://${repoHost}/api/v3`
      : 'https://api.github.com';
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === 'api.github.com') {
      return parsed.origin;
    }
    if (parsed.hostname === 'github.com') {
      return 'https://api.github.com';
    }
    if (/\/api\/v3$/i.test(parsed.pathname)) {
      return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/g, '');
    }
    if (parsed.pathname && parsed.pathname !== '/') {
      return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/g, '');
    }
    return `${parsed.origin}/api/v3`;
  } catch {
    return trimmed;
  }
};

const readSecret = (secretReference?: string) => {
  const key = String(secretReference || '').trim();
  return key ? String(process.env[key] || '').trim() : '';
};

type GithubAuthSource =
  | 'workspace-connector-secret'
  | 'GITHUB_TOKEN'
  | 'GH_TOKEN'
  | 'none';

const resolveGithubAccessToken = async (
  workspaceSettings?: WorkspaceSettings,
): Promise<{ token: string; source: GithubAuthSource }> => {
  const settings = workspaceSettings || (await getWorkspaceSettings().catch(() => undefined));
  const connectorToken = readSecret(settings?.connectors?.github?.secretReference);
  if (connectorToken) {
    return {
      token: connectorToken,
      source: 'workspace-connector-secret',
    };
  }
  const githubToken = String(process.env.GITHUB_TOKEN || '').trim();
  if (githubToken) {
    return {
      token: githubToken,
      source: 'GITHUB_TOKEN',
    };
  }
  const ghToken = String(process.env.GH_TOKEN || '').trim();
  if (ghToken) {
    return {
      token: ghToken,
      source: 'GH_TOKEN',
    };
  }
  return {
    token: '',
    source: 'none',
  };
};

const buildGithubHeaders = async (
  workspaceSettings?: WorkspaceSettings,
) => {
  const { token, source } = await resolveGithubAccessToken(workspaceSettings);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SingularityNeo-CodeIndex/1.0',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { headers, hasToken: Boolean(token), tokenSource: source };
};

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

const listRepoTree = async (
  parsed: ParsedRepo,
  apiBaseUrl: string,
  branch: string,
  headers: Record<string, string>,
): Promise<
  | { ok: true; entries: TreeEntry[]; truncated: boolean }
  | { ok: false; status: CapabilityCodeIndexRunStatus; message: string }
> => {
  const url = `${apiBaseUrl}/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
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
  apiBaseUrl: string,
  sha: string,
  headers: Record<string, string>,
): Promise<string | null> => {
  // git/blobs returns base64 regardless of size — and avoids the 1 MB
  // ceiling on /contents. We cap by size before calling anyway.
  const url = `${apiBaseUrl}/repos/${parsed.owner}/${parsed.repo}/git/blobs/${sha}`;
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
  reusedFiles: number;
  fetchedFiles: number;
  symbolRows: SymbolRow[];
  referenceRows: ReferenceRow[];
  edgeRows: SymbolEdgeRow[];
}

interface SymbolRow {
  capabilityId: string;
  repositoryId: string;
  filePath: string;
  symbolId: string;
  containerSymbolId: string | null;
  symbolName: string;
  qualifiedSymbolName: string;
  kind: string;
  language: string;
  parentSymbol: string; // empty-string sentinel; TEXT PK can't be NULL
  startLine: number;
  endLine: number;
  sliceStartLine: number;
  sliceEndLine: number;
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

interface SymbolEdgeRow {
  capabilityId: string;
  repositoryId: string;
  fromSymbolId: string;
  toSymbolId: string;
  fromFilePath: string;
  toFilePath: string;
  edgeKind: 'CONTAINS';
}

const resolveLocalRepositoryRoot = (repository: CapabilityRepository) => {
  const directHint = normalizeDirectoryPath(repository.localRootHint || '');
  if (directHint) {
    return directHint;
  }
  const rawUrl = String(repository.url || '').trim();
  if (!rawUrl || /^https?:\/\//i.test(rawUrl) || /^git@/i.test(rawUrl)) {
    return '';
  }
  return normalizeDirectoryPath(rawUrl);
};

const listLocalRepositoryEntries = async (repositoryRoot: string): Promise<TreeEntry[]> => {
  const entries: TreeEntry[] = [];

  const walk = async (currentDirectory: string) => {
    const children = await fs.readdir(currentDirectory, { withFileTypes: true });
    for (const child of children) {
      const absolutePath = path.join(currentDirectory, child.name);
      const relativePath = path.relative(repositoryRoot, absolutePath).replace(/\\/g, '/');
      if (!relativePath) continue;
      if (DENY_PATH_PATTERNS.some(pattern => pattern.test(relativePath))) {
        continue;
      }
      if (child.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!child.isFile() || !shouldIndex(relativePath)) {
        continue;
      }
      const stats = await fs.stat(absolutePath);
      entries.push({
        path: relativePath,
        type: 'blob',
        sha: '',
        size: stats.size,
      });
    }
  };

  await walk(repositoryRoot);
  return entries;
};

const fetchLocalFileContent = async (
  repositoryRoot: string,
  relativePath: string,
): Promise<string | null> => {
  try {
    return await fs.readFile(path.join(repositoryRoot, relativePath), 'utf8');
  } catch {
    return null;
  }
};

type ExistingIndexState = {
  symbolRowsByFile: Map<string, SymbolRow[]>;
  referenceRowsByFile: Map<string, ReferenceRow[]>;
  edgeRowsByFile: Map<string, SymbolEdgeRow[]>;
  shaByFile: Map<string, string>;
};

const loadExistingRepoIndexState = async (
  capabilityId: string,
  repositoryId: string,
): Promise<ExistingIndexState> => {
  const [symbolResult, referenceResult, edgeResult] = await Promise.all([
    query(
      `
        SELECT
          file_path,
          symbol_id,
          container_symbol_id,
          symbol_name,
          qualified_symbol_name,
          kind,
          language,
          parent_symbol,
          start_line,
          end_line,
          COALESCE(slice_start_line, start_line) AS slice_start_line,
          COALESCE(slice_end_line, end_line) AS slice_end_line,
          signature,
          is_exported,
          sha
        FROM capability_code_symbols
        WHERE capability_id = $1
          AND repository_id = $2
        ORDER BY file_path ASC, start_line ASC
      `,
      [capabilityId, repositoryId],
    ),
    query(
      `
        SELECT from_file, to_module, kind
        FROM capability_code_references
        WHERE capability_id = $1
          AND repository_id = $2
        ORDER BY from_file ASC, to_module ASC
      `,
      [capabilityId, repositoryId],
    ),
    query(
      `
        SELECT from_symbol_id, to_symbol_id, from_file_path, to_file_path, edge_kind
        FROM capability_code_symbol_edges
        WHERE capability_id = $1
          AND repository_id = $2
        ORDER BY from_file_path ASC, to_file_path ASC, from_symbol_id ASC, to_symbol_id ASC
      `,
      [capabilityId, repositoryId],
    ),
  ]);

  const symbolRowsByFile = new Map<string, SymbolRow[]>();
  const referenceRowsByFile = new Map<string, ReferenceRow[]>();
  const edgeRowsByFile = new Map<string, SymbolEdgeRow[]>();
  const shaByFile = new Map<string, string>();

  for (const row of symbolResult.rows as Array<Record<string, unknown>>) {
    const filePath = String(row.file_path || '').trim();
    if (!filePath) continue;
    const parentSymbol = String(row.parent_symbol || '').trim();
    const symbolName = String(row.symbol_name || '').trim();
    const symbolRow: SymbolRow = {
      capabilityId,
      repositoryId,
      filePath,
      symbolId: String(row.symbol_id || '').trim(),
      containerSymbolId: String(row.container_symbol_id || '').trim() || null,
      symbolName,
      qualifiedSymbolName:
        String(row.qualified_symbol_name || '').trim() ||
        (parentSymbol ? `${parentSymbol}.${symbolName}` : symbolName),
      kind: String(row.kind || '').trim(),
      language: String(row.language || '').trim() || 'text',
      parentSymbol,
      startLine: Number(row.start_line) || 1,
      endLine: Number(row.end_line) || 1,
      sliceStartLine: Number(row.slice_start_line) || Number(row.start_line) || 1,
      sliceEndLine: Number(row.slice_end_line) || Number(row.end_line) || 1,
      signature: String(row.signature || ''),
      isExported: Boolean(row.is_exported),
      sha: String(row.sha || '').trim() || null,
    };
    const rows = symbolRowsByFile.get(filePath) || [];
    rows.push(symbolRow);
    symbolRowsByFile.set(filePath, rows);
    if (symbolRow.sha) {
      shaByFile.set(filePath, symbolRow.sha);
    }
  }

  for (const row of referenceResult.rows as Array<Record<string, unknown>>) {
    const fromFile = String(row.from_file || '').trim();
    if (!fromFile) continue;
    const referenceRow: ReferenceRow = {
      capabilityId,
      repositoryId,
      fromFile,
      toModule: String(row.to_module || '').trim(),
      kind: String(row.kind || '').trim() === 'REEXPORTS' ? 'REEXPORTS' : 'IMPORTS',
    };
    const rows = referenceRowsByFile.get(fromFile) || [];
    rows.push(referenceRow);
    referenceRowsByFile.set(fromFile, rows);
  }

  for (const row of edgeResult.rows as Array<Record<string, unknown>>) {
    const fromFilePath = String(row.from_file_path || '').trim();
    const toFilePath = String(row.to_file_path || '').trim();
    const fileKey = fromFilePath || toFilePath;
    if (!fileKey) continue;
    const edgeRow: SymbolEdgeRow = {
      capabilityId,
      repositoryId,
      fromSymbolId: String(row.from_symbol_id || '').trim(),
      toSymbolId: String(row.to_symbol_id || '').trim(),
      fromFilePath,
      toFilePath,
      edgeKind: 'CONTAINS',
    };
    const rows = edgeRowsByFile.get(fileKey) || [];
    rows.push(edgeRow);
    edgeRowsByFile.set(fileKey, rows);
  }

  return {
    symbolRowsByFile,
    referenceRowsByFile,
    edgeRowsByFile,
    shaByFile,
  };
};

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
  workspaceSettings?: WorkspaceSettings,
  localRepositoryRootOverride?: string,
): Promise<RepoIngestResult> => {
  const label = repository.label || repository.url || repository.id;
  const localRepositoryRoot =
    normalizeDirectoryPath(localRepositoryRootOverride || "") ||
    resolveLocalRepositoryRoot(repository);
  let localFallbackMessage = '';
  let tree:
    | { ok: true; entries: TreeEntry[]; truncated: boolean }
    | { ok: false; status: CapabilityCodeIndexRunStatus; message: string }
    | null = null;
  let parsed: ParsedRepo | null = null;
  let apiBaseUrl = '';
  let ingestMode: 'local-clone' | 'remote-api' = 'remote-api';

  if (localRepositoryRoot) {
    try {
      const stats = await fs.stat(localRepositoryRoot);
      if (stats.isDirectory()) {
        tree = {
          ok: true,
          entries: await listLocalRepositoryEntries(localRepositoryRoot),
          truncated: false,
        };
        ingestMode = 'local-clone';
      } else {
        localFallbackMessage = `Local repository root ${localRepositoryRoot} is not a directory; falling back to remote indexing.`;
      }
    } catch {
      localFallbackMessage = `Local repository root ${localRepositoryRoot} could not be read; falling back to remote indexing.`;
    }
  }

  if (ingestMode !== 'local-clone') {
    parsed = parseRepoUrl(repository.url);
    if (!parsed) {
      return {
        repositoryId: repository.id,
        repositoryLabel: label,
        status: 'ERROR',
        message:
          localFallbackMessage ||
          'Repository URL is not a recognised GitHub URL and no local repository root is configured.',
        filesIndexed: 0,
        symbolsIndexed: 0,
        referencesIndexed: 0,
        reusedFiles: 0,
        fetchedFiles: 0,
        symbolRows: [],
        referenceRows: [],
        edgeRows: [],
      };
    }

    apiBaseUrl = normalizeGithubApiBaseUrl(workspaceSettings?.connectors?.github?.baseUrl, parsed.host);
    const branch = repository.defaultBranch || 'main';
    tree = await listRepoTree(parsed, apiBaseUrl, branch, headers);
  }

  if (!tree) {
    return {
      repositoryId: repository.id,
      repositoryLabel: label,
      status: 'ERROR',
      message:
        localFallbackMessage ||
        'Code index could not resolve a local or remote repository source.',
      filesIndexed: 0,
      symbolsIndexed: 0,
      referencesIndexed: 0,
      reusedFiles: 0,
      fetchedFiles: 0,
      symbolRows: [],
      referenceRows: [],
      edgeRows: [],
    };
  }

  if (tree.ok === false) {
    return {
      repositoryId: repository.id,
      repositoryLabel: label,
      status: tree.status,
      message: localFallbackMessage ? `${localFallbackMessage} ${tree.message}` : tree.message,
      filesIndexed: 0,
      symbolsIndexed: 0,
      referencesIndexed: 0,
      reusedFiles: 0,
      fetchedFiles: 0,
      symbolRows: [],
      referenceRows: [],
      edgeRows: [],
    };
  }

  const existingIndexState =
    ingestMode === 'remote-api'
      ? await loadExistingRepoIndexState(capabilityId, repository.id)
      : {
          symbolRowsByFile: new Map<string, SymbolRow[]>(),
          referenceRowsByFile: new Map<string, ReferenceRow[]>(),
          edgeRowsByFile: new Map<string, SymbolEdgeRow[]>(),
          shaByFile: new Map<string, string>(),
        };

  // Filter + cap. Prioritize source-root paths before test/demo paths so
  // large repos spend their parse budget on the highest-signal code first.
  const candidates = tree.entries
    .filter(entry => entry.type === 'blob' && shouldIndex(entry.path))
    .filter(entry => !entry.size || entry.size <= MAX_FILE_BYTES)
    .sort((left, right) => {
      const scoreDelta =
        scoreIndexCandidatePath(left.path) - scoreIndexCandidatePath(right.path);
      if (scoreDelta !== 0) return scoreDelta;
      const lengthDelta = left.path.length - right.path.length;
      if (lengthDelta !== 0) return lengthDelta;
      return left.path.localeCompare(right.path);
    })
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
      reusedFiles: 0,
      fetchedFiles: 0,
      symbolRows: [],
      referenceRows: [],
      edgeRows: [],
    };
  }

  const symbolRows: SymbolRow[] = [];
  const referenceRows: ReferenceRow[] = [];
  const edgeRows: SymbolEdgeRow[] = [];
  let filesIndexed = 0;
  let fetchErrors = 0;
  let reusedFiles = 0;

  const fetchCandidates = candidates.filter(entry => {
    if (ingestMode !== 'remote-api') {
      return true;
    }
    const knownSha = existingIndexState.shaByFile.get(entry.path);
    const hasReusableRows =
      existingIndexState.symbolRowsByFile.has(entry.path) ||
      existingIndexState.referenceRowsByFile.has(entry.path);
    if (knownSha && knownSha === entry.sha && hasReusableRows) {
      symbolRows.push(...(existingIndexState.symbolRowsByFile.get(entry.path) || []));
      referenceRows.push(...(existingIndexState.referenceRowsByFile.get(entry.path) || []));
      edgeRows.push(...(existingIndexState.edgeRowsByFile.get(entry.path) || []));
      filesIndexed += 1;
      reusedFiles += 1;
      return false;
    }
    return true;
  });

  // Fetch blobs in parallel, but never burst.
  const contents = await mapWithConcurrency(fetchCandidates, FETCH_CONCURRENCY, async entry => {
    try {
      const content =
        ingestMode === 'local-clone'
          ? await fetchLocalFileContent(localRepositoryRoot, entry.path)
          : await fetchBlobContent(parsed as ParsedRepo, apiBaseUrl, entry.sha, headers);
      return { entry, content, error: null as string | null };
    } catch (error) {
      return {
        entry,
        content: null,
        error: error instanceof Error ? error.message : 'fetch failed',
      };
    }
  });

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
    const normalizedSymbols = normalizeExtractedSymbols(entry.path, parsedFile.symbols);
    for (const symbol of normalizedSymbols) {
      symbolRows.push({
        capabilityId,
        repositoryId: repository.id,
        filePath: entry.path,
        symbolId: String(symbol.symbolId || ''),
        containerSymbolId: symbol.containerSymbolId || null,
        symbolName: symbol.symbolName,
        qualifiedSymbolName:
          String(symbol.qualifiedSymbolName || '').trim() || symbol.symbolName,
        kind: symbol.kind,
        language: String(symbol.language || '').trim() || 'text',
        parentSymbol: symbol.parentSymbol || '',
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        sliceStartLine: Number(symbol.sliceStartLine) || symbol.startLine,
        sliceEndLine: Number(symbol.sliceEndLine) || symbol.endLine,
        signature: symbol.signature,
        isExported: symbol.isExported,
        sha: entry.sha || null,
      });
      if (symbol.containerSymbolId && symbol.symbolId) {
        edgeRows.push({
          capabilityId,
          repositoryId: repository.id,
          fromSymbolId: symbol.containerSymbolId,
          toSymbolId: symbol.symbolId,
          fromFilePath: entry.path,
          toFilePath: entry.path,
          edgeKind: 'CONTAINS',
        });
      }
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
  if (fetchErrors > 0 && fetchErrors < fetchCandidates.length) {
    status = 'PARTIAL';
    message = `${fetchErrors} of ${fetchCandidates.length} blobs failed to fetch.`;
  } else if (fetchErrors && fetchErrors === fetchCandidates.length) {
    status = 'ERROR';
    message = `All ${fetchCandidates.length} blob fetches failed.`;
  } else if (tree.truncated) {
    status = 'PARTIAL';
    message = 'GitHub truncated the tree listing; some files were not considered.';
  }

  if (reusedFiles > 0) {
    const reuseNote =
      `Reused ${reusedFiles} unchanged file ${reusedFiles === 1 ? 'index' : 'indexes'} and fetched ${fetchCandidates.length} changed file ${fetchCandidates.length === 1 ? 'blob' : 'blobs'}.`;
    message = message ? `${message} ${reuseNote}` : reuseNote;
  }
  if (ingestMode === 'local-clone') {
    const localNote = `Indexed from local clone at ${localRepositoryRoot}.`;
    message = message ? `${message} ${localNote}` : localNote;
  } else if (localFallbackMessage) {
    message = message ? `${localFallbackMessage} ${message}` : localFallbackMessage;
  }

  return {
    repositoryId: repository.id,
    repositoryLabel: label,
    status,
    message,
    filesIndexed,
    symbolsIndexed: symbolRows.length,
    referencesIndexed: referenceRows.length,
    reusedFiles,
    fetchedFiles: fetchCandidates.length,
    symbolRows,
    referenceRows,
    edgeRows,
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
  edgeRows: SymbolEdgeRow[],
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
  await client.query(
    `DELETE FROM capability_code_symbol_edges WHERE capability_id = $1 AND repository_id = ANY($2::text[])`,
    [capabilityId, repositoryIds],
  );

  // Batched multi-row INSERTs — one round-trip per 200 symbols instead of
  // per-row. Pg's max params is 65k so a batch of 200 × 17 cols = 3400
  // params sits comfortably under the ceiling.
  for (let offset = 0; offset < symbolRows.length; offset += INSERT_BATCH_SIZE) {
    const chunk = symbolRows.slice(offset, offset + INSERT_BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((row, i) => {
      const base = i * 17;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17})`,
      );
      params.push(
        row.capabilityId,
        row.repositoryId,
        row.filePath,
        row.symbolId,
        row.containerSymbolId,
        row.symbolName,
        row.qualifiedSymbolName,
        row.kind,
        row.language,
        row.parentSymbol,
        row.startLine,
        row.endLine,
        row.sliceStartLine,
        row.sliceEndLine,
        row.signature,
        row.isExported,
        row.sha,
      );
    });
    await client.query(
      `
        INSERT INTO capability_code_symbols (
          capability_id, repository_id, file_path, symbol_id, container_symbol_id,
          symbol_name, qualified_symbol_name, kind, language, parent_symbol,
          start_line, end_line, slice_start_line, slice_end_line, signature,
          is_exported, sha
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

  for (let offset = 0; offset < edgeRows.length; offset += INSERT_BATCH_SIZE) {
    const chunk = edgeRows.slice(offset, offset + INSERT_BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((row, i) => {
      const base = i * 7;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
      );
      params.push(
        row.capabilityId,
        row.repositoryId,
        row.fromSymbolId,
        row.toSymbolId,
        row.fromFilePath,
        row.toFilePath,
        row.edgeKind,
      );
    });
    await client.query(
      `
        INSERT INTO capability_code_symbol_edges (
          capability_id,
          repository_id,
          from_symbol_id,
          to_symbol_id,
          from_file_path,
          to_file_path,
          edge_kind
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
  options?: {
    localRepositoryRoots?: Record<string, string | undefined>;
  },
): Promise<CapabilityCodeIndexSnapshot> => {
  const startedAt = new Date();
  const repositories = await getCapabilityRepositoriesRecord(capabilityId);
  const workspaceSettings = await getWorkspaceSettings().catch(() => undefined);

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

  const { headers, hasToken, tokenSource } = await buildGithubHeaders(workspaceSettings);

  const repoResults: RepoIngestResult[] = [];
  for (const repo of repositories) {
    try {
      const result = await ingestRepository(
        capabilityId,
        repo,
        headers,
        workspaceSettings,
        options?.localRepositoryRoots?.[repo.id],
      );
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
        reusedFiles: 0,
        fetchedFiles: 0,
        symbolRows: [],
        referenceRows: [],
        edgeRows: [],
      });
    }
  }

  const refreshedRepoResults = repoResults.filter(
    r => r.status === 'OK' || r.status === 'PARTIAL',
  );
  const allSymbols = refreshedRepoResults.flatMap(r => r.symbolRows);
  const allReferences = refreshedRepoResults.flatMap(r => r.referenceRows);
  const allEdges = refreshedRepoResults.flatMap(r => r.edgeRows);
  const touchedRepoIds = refreshedRepoResults.map(r => r.repositoryId);

  // Write in a single transaction so search queries never observe a
  // half-updated index.
  await transaction(async client => {
    await writeSymbolsInTransaction(
      client,
      capabilityId,
      touchedRepoIds,
      allSymbols,
      allReferences,
      allEdges,
    );
  });

  const endedAt = new Date();
  const aggregate = aggregateStatus(repoResults);
  const aggregateMessage = (() => {
    const messages = repoResults
      .filter(r => r.message)
      .map(r => `${r.repositoryLabel}: ${r.message}`);
    if (!messages.length) {
      const reusedFiles = repoResults.reduce((sum, result) => sum + result.reusedFiles, 0);
      const fetchedFiles = repoResults.reduce((sum, result) => sum + result.fetchedFiles, 0);
      if (reusedFiles > 0) {
        return `Indexed with ${tokenSource}; reused ${reusedFiles} unchanged file ${reusedFiles === 1 ? 'index' : 'indexes'} and fetched ${fetchedFiles} changed file ${fetchedFiles === 1 ? 'blob' : 'blobs'}.`;
      }
      if (!hasToken && aggregate === 'EMPTY') {
        return null;
      }
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
