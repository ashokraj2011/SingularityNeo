/**
 * Phase C1 — "Agent-as-git-author" session primitives.
 *
 * A thin, Octokit-free wrapper around the minimum GitHub REST surface we
 * need to turn a CODE_PATCH artifact (see ../patch/) into a real branch
 * + commit + pull request. Everything here is a pure async function —
 * no module-level state, no persistence. The orchestrator that binds a
 * session to a work-item (Phase C2) lives in ./repository.ts.
 *
 * Why no Octokit? The rest of this server uses raw `fetch` with the
 * shared GitHub headers (see server/codeIndex/ingest.ts:120-190,
 * server/repoGuidance.ts:94-192). Adding a dependency just to write
 * blobs + trees + refs would be inconsistent and would bloat the
 * sandboxed runtime image. The git-data API is small enough to call
 * directly.
 *
 * Error model: every request helper returns a discriminated union
 *   { ok: true, ... } | { ok: false, status, message }
 * so callers can surface structured errors to the UI without throwing.
 * The higher-level `commitPatchToBranch` orchestrator rolls this up
 * into a `SessionApplyResult` with per-file status.
 */
import { applyPatch, collectPatchSources } from '../patch/apply';
import type { PatchApplyResult } from '../patch/apply';
import { parseUnifiedDiff } from '../patch/validate';
import type { ParsedPatch } from '../patch/validate';

// ─────────────────────────────────────────────────────────────────────────
// Repo URL parsing (duplicated from codeIndex/ingest.ts — we intentionally
// don't cross-import because the two modules have independent lifetimes)
// ─────────────────────────────────────────────────────────────────────────

export interface ParsedRepo {
  owner: string;
  repo: string;
}

export const parseRepoUrl = (url: string): ParsedRepo | null => {
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

// ─────────────────────────────────────────────────────────────────────────
// Shared auth / header plumbing
// ─────────────────────────────────────────────────────────────────────────

export type GithubAuthResolution =
  | { ok: true; headers: Record<string, string>; hasToken: boolean }
  | { ok: false; status: 'AUTH_MISSING'; message: string };

/**
 * Build the request headers used for every call. We prefer the env token
 * (GITHUB_TOKEN / GH_TOKEN) because that's what every other GitHub-facing
 * module in the server already reads (ingest.ts:121, repoGuidance.ts:95).
 * A future refinement is to resolve per-capability tokens via the
 * workspace connector pattern (connectors.ts `readSecret(...)`); for now
 * we keep the dependency surface narrow.
 */
export const resolveGithubAuth = (
  explicitToken?: string | null,
): GithubAuthResolution => {
  const token = (
    explicitToken ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    ''
  ).trim();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'SingularityNeo-AgentGit/1.0',
    'Content-Type': 'application/json',
  };
  if (!token) {
    return {
      ok: false,
      status: 'AUTH_MISSING',
      message:
        'No GITHUB_TOKEN configured — the agent cannot write branches or PRs without a token.',
    };
  }
  headers.Authorization = `Bearer ${token}`;
  return { ok: true, headers, hasToken: true };
};

// ─────────────────────────────────────────────────────────────────────────
// Request envelopes
// ─────────────────────────────────────────────────────────────────────────

export type SessionErrorStatus =
  | 'AUTH_MISSING'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'NETWORK'
  | 'ERROR';

export interface SessionError {
  ok: false;
  status: SessionErrorStatus;
  message: string;
  /** Raw HTTP status from GitHub, when available. Useful for telemetry. */
  httpStatus?: number;
}

// Use an explicit `ok: true` shape plus `T` so TS's discrimination narrows
// cleanly on `if (result.ok === true)` / `if (result.ok === false)`.
type SessionOk<T> = T & { ok: true };

/**
 * Uniform error translator. GitHub returns different error shapes for
 * git-data vs pulls vs rate-limit; this picks the right status tag so the
 * UI can render a specific message.
 */
const translateHttpError = async (
  response: Response,
  verb: string,
): Promise<SessionError> => {
  const httpStatus = response.status;
  let message = `${verb} failed (${httpStatus})`;
  try {
    const body = (await response.json()) as { message?: string };
    if (body?.message) message = `${verb} failed: ${body.message}`;
  } catch {
    // GitHub didn't return JSON — that's fine, keep the default message.
  }
  if (httpStatus === 404) {
    return { ok: false, status: 'NOT_FOUND', message, httpStatus };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      return { ok: false, status: 'RATE_LIMITED', message, httpStatus };
    }
    return { ok: false, status: 'AUTH_MISSING', message, httpStatus };
  }
  if (httpStatus === 409 || httpStatus === 422) {
    // 422 on POST /git/refs means "ref already exists".
    return { ok: false, status: 'CONFLICT', message, httpStatus };
  }
  if (httpStatus >= 400 && httpStatus < 500) {
    return { ok: false, status: 'VALIDATION', message, httpStatus };
  }
  return { ok: false, status: 'ERROR', message, httpStatus };
};

// ─────────────────────────────────────────────────────────────────────────
// Primitive git-data calls
// ─────────────────────────────────────────────────────────────────────────

export interface BranchRefInfo {
  ref: string;
  sha: string;
}

/**
 * Resolve the tip SHA of a branch. Used to anchor a new session branch
 * and as the commit parent for the first commit. Accepts the default
 * branch name from `CapabilityRepository.defaultBranch`.
 */
export const getBranchTip = async (
  parsedRepo: ParsedRepo,
  branchName: string,
  headers: Record<string, string>,
): Promise<SessionOk<BranchRefInfo> | SessionError> => {
  const url = `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/ref/heads/${encodeURIComponent(branchName)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    return {
      ok: false,
      status: 'NETWORK',
      message: `getBranchTip network error: ${(error as Error).message}`,
    };
  }
  if (!response.ok) return translateHttpError(response, 'getBranchTip');
  const body = (await response.json()) as {
    ref?: string;
    object?: { sha?: string };
  };
  if (!body.object?.sha || !body.ref) {
    return {
      ok: false,
      status: 'VALIDATION',
      message: `getBranchTip returned malformed body for ${branchName}.`,
    };
  }
  return { ok: true, ref: body.ref, sha: body.object.sha };
};

/**
 * Create `refs/heads/<branchName>` anchored at `fromSha`. Returns CONFLICT
 * if the branch already exists — the caller can then decide to reuse it
 * (see `ensureBranch`) rather than failing the session.
 */
export const createBranch = async (
  parsedRepo: ParsedRepo,
  branchName: string,
  fromSha: string,
  headers: Record<string, string>,
): Promise<SessionOk<BranchRefInfo> | SessionError> => {
  const url = `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/refs`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: fromSha,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 'NETWORK',
      message: `createBranch network error: ${(error as Error).message}`,
    };
  }
  if (!response.ok) return translateHttpError(response, 'createBranch');
  const body = (await response.json()) as {
    ref?: string;
    object?: { sha?: string };
  };
  return {
    ok: true,
    ref: body.ref || `refs/heads/${branchName}`,
    sha: body.object?.sha || fromSha,
  };
};

/**
 * Create-or-reuse: try to create; on CONFLICT, resolve the existing tip.
 * This is the happy-path call-site uses — new session branches for
 * brand-new work items succeed immediately, and re-opened sessions pick
 * up where they left off.
 */
export const ensureBranch = async (
  parsedRepo: ParsedRepo,
  branchName: string,
  fromSha: string,
  headers: Record<string, string>,
): Promise<
  | (SessionOk<BranchRefInfo> & { created: boolean })
  | SessionError
> => {
  const created = await createBranch(parsedRepo, branchName, fromSha, headers);
  if (created.ok === false) {
    if (created.status !== 'CONFLICT') return created;
    const resolved = await getBranchTip(parsedRepo, branchName, headers);
    if (resolved.ok === false) return resolved;
    return { ok: true, ref: resolved.ref, sha: resolved.sha, created: false };
  }
  return { ok: true, ref: created.ref, sha: created.sha, created: true };
};

/**
 * Fast-forward (or force-update, per `force`) an existing branch to
 * point at `newSha`. We use force=false by default — agents should never
 * rewrite history, even on their own session branch.
 */
export const updateBranchRef = async (
  parsedRepo: ParsedRepo,
  branchName: string,
  newSha: string,
  headers: Record<string, string>,
  force = false,
): Promise<SessionOk<BranchRefInfo> | SessionError> => {
  const url = `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/refs/heads/${encodeURIComponent(branchName)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: newSha, force }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 'NETWORK',
      message: `updateBranchRef network error: ${(error as Error).message}`,
    };
  }
  if (!response.ok) return translateHttpError(response, 'updateBranchRef');
  const body = (await response.json()) as {
    ref?: string;
    object?: { sha?: string };
  };
  return {
    ok: true,
    ref: body.ref || `refs/heads/${branchName}`,
    sha: body.object?.sha || newSha,
  };
};

/**
 * Fetch a blob at a ref. We use the `/contents` API here (not `/git/blobs`)
 * because it lets us pass `?ref=<branch|sha>` directly — the git-data
 * blob endpoint requires a blob SHA which we don't yet know for the
 * "original" side of a MODIFIED file.
 *
 * Returns `null` content for 404 so the orchestrator can distinguish
 * "file doesn't exist yet" (ADDED) from a real error.
 */
export const fetchFileAtRef = async (
  parsedRepo: ParsedRepo,
  filePath: string,
  ref: string,
  headers: Record<string, string>,
): Promise<
  | SessionOk<{ content: string | null; sha?: string }>
  | SessionError
> => {
  const url = `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    return {
      ok: false,
      status: 'NETWORK',
      message: `fetchFileAtRef network error: ${(error as Error).message}`,
    };
  }
  if (response.status === 404) {
    return { ok: true, content: null };
  }
  if (!response.ok) return translateHttpError(response, 'fetchFileAtRef');
  const body = (await response.json()) as {
    content?: string;
    encoding?: string;
    sha?: string;
    type?: string;
  };
  if (body.type && body.type !== 'file') {
    return {
      ok: false,
      status: 'VALIDATION',
      message: `fetchFileAtRef: ${filePath} is not a file (type=${body.type}).`,
    };
  }
  if (typeof body.content !== 'string') {
    return { ok: true, content: '', sha: body.sha };
  }
  const decoded =
    body.encoding === 'base64'
      ? Buffer.from(body.content, 'base64').toString('utf8')
      : body.content;
  return { ok: true, content: decoded, sha: body.sha };
};

/**
 * Write a blob. GitHub returns a SHA we then reference from the tree.
 * We always POST utf-8 content base64-encoded so binary-safe (though
 * we short-circuit binary files before reaching this call).
 */
export const createBlob = async (
  parsedRepo: ParsedRepo,
  content: string,
  headers: Record<string, string>,
): Promise<SessionOk<{ sha: string }> | SessionError> => {
  const url = `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/blobs`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: Buffer.from(content, 'utf8').toString('base64'),
        encoding: 'base64',
      }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 'NETWORK',
      message: `createBlob network error: ${(error as Error).message}`,
    };
  }
  if (!response.ok) return translateHttpError(response, 'createBlob');
  const body = (await response.json()) as { sha?: string };
  if (!body.sha) {
    return {
      ok: false,
      status: 'VALIDATION',
      message: 'createBlob returned no sha.',
    };
  }
  return { ok: true, sha: body.sha };
};

/**
 * A tree entry in the form GitHub wants. We only ever emit `blob` with
 * mode `100644` (regular file) — session applies don't touch executable
 * bits or symlinks, and deletions are expressed via `sha: null`.
 */
export interface TreeEntry {
  path: string;
  mode: '100644';
  type: 'blob';
  /** Set to null to delete the path at the base tree. */
  sha: string | null;
}

/**
 * Build a new tree on top of `baseTreeSha` by overlaying the supplied
 * entries. GitHub's merge semantics: paths not in `entries` are
 * inherited from `baseTreeSha`; paths with `sha: null` are removed.
 */
export const createTree = async (
  parsedRepo: ParsedRepo,
  baseTreeSha: string,
  entries: TreeEntry[],
  headers: Record<string, string>,
): Promise<SessionOk<{ sha: string }> | SessionError> => {
  const url = `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/trees`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: entries,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 'NETWORK',
      message: `createTree network error: ${(error as Error).message}`,
    };
  }
  if (!response.ok) return translateHttpError(response, 'createTree');
  const body = (await response.json()) as { sha?: string };
  if (!body.sha) {
    return {
      ok: false,
      status: 'VALIDATION',
      message: 'createTree returned no sha.',
    };
  }
  return { ok: true, sha: body.sha };
};

/**
 * Fetch a commit to get its root tree SHA. Used as the base tree for
 * each session commit so we don't have to enumerate every file.
 */
export const getCommitTreeSha = async (
  parsedRepo: ParsedRepo,
  commitSha: string,
  headers: Record<string, string>,
): Promise<SessionOk<{ treeSha: string }> | SessionError> => {
  const url = `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/commits/${commitSha}`;
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    return {
      ok: false,
      status: 'NETWORK',
      message: `getCommitTreeSha network error: ${(error as Error).message}`,
    };
  }
  if (!response.ok) return translateHttpError(response, 'getCommitTreeSha');
  const body = (await response.json()) as { tree?: { sha?: string } };
  if (!body.tree?.sha) {
    return {
      ok: false,
      status: 'VALIDATION',
      message: 'getCommitTreeSha returned no tree sha.',
    };
  }
  return { ok: true, treeSha: body.tree.sha };
};

export interface CommitAuthor {
  name: string;
  email: string;
  date?: string;
}

/**
 * Create a commit pointing at `treeSha` with `parentSha` as its single
 * parent. Session commits are always linear — no merges.
 */
export const createCommit = async (
  parsedRepo: ParsedRepo,
  params: {
    message: string;
    treeSha: string;
    parentSha: string;
    author: CommitAuthor;
    committer?: CommitAuthor;
  },
  headers: Record<string, string>,
): Promise<SessionOk<{ sha: string }> | SessionError> => {
  const url = `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/git/commits`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: params.message,
        tree: params.treeSha,
        parents: [params.parentSha],
        author: params.author,
        committer: params.committer || params.author,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 'NETWORK',
      message: `createCommit network error: ${(error as Error).message}`,
    };
  }
  if (!response.ok) return translateHttpError(response, 'createCommit');
  const body = (await response.json()) as { sha?: string };
  if (!body.sha) {
    return {
      ok: false,
      status: 'VALIDATION',
      message: 'createCommit returned no sha.',
    };
  }
  return { ok: true, sha: body.sha };
};

export interface PullRequestSummary {
  number: number;
  url: string;
  htmlUrl: string;
  state: string;
  merged: boolean;
  draft: boolean;
  title: string;
  body: string;
}

/**
 * Open a PR from `head` into `base`. We default to `draft: true` so
 * reviewers know the agent hasn't hand-off signaled readiness yet —
 * Phase C3's "Open PR" button will flip this when the operator clicks
 * explicitly.
 */
export const openPullRequest = async (
  parsedRepo: ParsedRepo,
  params: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  },
  headers: Record<string, string>,
): Promise<SessionOk<PullRequestSummary> | SessionError> => {
  const url = `https://api.github.com/repos/${parsedRepo.owner}/${parsedRepo.repo}/pulls`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
        draft: params.draft ?? true,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 'NETWORK',
      message: `openPullRequest network error: ${(error as Error).message}`,
    };
  }
  if (!response.ok) return translateHttpError(response, 'openPullRequest');
  const body = (await response.json()) as {
    number?: number;
    url?: string;
    html_url?: string;
    state?: string;
    merged?: boolean;
    draft?: boolean;
    title?: string;
    body?: string;
  };
  if (typeof body.number !== 'number') {
    return {
      ok: false,
      status: 'VALIDATION',
      message: 'openPullRequest returned no PR number.',
    };
  }
  return {
    ok: true,
    number: body.number,
    url: body.url || '',
    htmlUrl: body.html_url || '',
    state: body.state || 'open',
    merged: Boolean(body.merged),
    draft: Boolean(body.draft),
    title: body.title || params.title,
    body: body.body || params.body,
  };
};

// ─────────────────────────────────────────────────────────────────────────
// High-level orchestrator: patch → branch → tree → commit → updated ref
// ─────────────────────────────────────────────────────────────────────────

export interface CommitPatchParams {
  parsedRepo: ParsedRepo;
  branchName: string;
  /**
   * Commit parent SHA — typically the current tip of the session branch.
   * The caller is responsible for obtaining it (via getBranchTip or the
   * last session commit we recorded).
   */
  parentSha: string;
  /**
   * Raw unified-diff text from the CODE_PATCH artifact's `contentText`.
   */
  patchText: string;
  message: string;
  author: CommitAuthor;
  committer?: CommitAuthor;
  /**
   * When provided, used as the ref to read ORIGINAL file content from
   * (for MODIFIED/DELETED/RENAMED files). Defaults to `parentSha` so the
   * patch is applied against the same snapshot it advertises as base.
   */
  originalRef?: string;
}

export interface CommitPatchResult {
  ok: true;
  commitSha: string;
  treeSha: string;
  branchRef: string;
  apply: PatchApplyResult;
  /**
   * Parsed patch summary — useful for persisting alongside the session
   * row so the UI can render the file list without re-parsing.
   */
  patch: ParsedPatch;
  /** Files we actually wrote blobs for (excluding BINARY_SKIPPED). */
  filesCommitted: string[];
  /** Files we skipped — either binary or MISSING_ORIGINAL/CONFLICT. */
  filesSkipped: Array<{ path: string; reason: string }>;
}

/**
 * End-to-end: parse the patch, apply it in-memory, write blobs + tree +
 * commit, then fast-forward the branch ref to the new commit. Returns
 * the full apply report so the caller can persist per-file status and
 * render it in the work-item UI.
 *
 * NOTE: this function does NOT open a PR — that's a separate step
 * controlled by the operator clicking "Open PR". Keeping them split
 * means an agent can iterate on a session branch (multiple commits)
 * before the operator decides to review.
 */
export const commitPatchToBranch = async (
  params: CommitPatchParams,
  headers: Record<string, string>,
): Promise<CommitPatchResult | SessionError> => {
  const parsed = parseUnifiedDiff(params.patchText);
  if (!parsed.files.length) {
    return {
      ok: false,
      status: 'VALIDATION',
      message: 'Patch contains no files — nothing to commit.',
    };
  }

  // 1. Pull the base tree so we can overlay changes instead of rewriting
  //    the whole repository.
  const baseTree = await getCommitTreeSha(
    params.parsedRepo,
    params.parentSha,
    headers,
  );
  if (baseTree.ok === false) return baseTree;

  // 2. Fetch originals for every non-ADDED non-binary file.
  const originalRef = params.originalRef || params.parentSha;
  const sourcePaths = collectPatchSources(parsed);
  const originals: Record<string, string | null> = {};
  for (const path of sourcePaths) {
    const fetched = await fetchFileAtRef(
      params.parsedRepo,
      path,
      originalRef,
      headers,
    );
    if (fetched.ok === false) {
      // A NOT_FOUND here is legitimate — the patch said MODIFIED but the
      // file is gone. Record it as null; applyPatch will mark it
      // MISSING_ORIGINAL and we'll skip it.
      if (fetched.status === 'NOT_FOUND') {
        originals[path] = null;
        continue;
      }
      return fetched;
    }
    originals[path] = fetched.content;
  }

  // 3. Run the in-memory apply.
  const apply = applyPatch(parsed, originals);

  // 4. Build tree entries — one blob per cleanly-applied file, plus
  //    null-sha entries for deletions.
  const treeEntries: TreeEntry[] = [];
  const filesCommitted: string[] = [];
  const filesSkipped: Array<{ path: string; reason: string }> = [];

  for (const [path, result] of Object.entries(apply.perFile)) {
    if (!result.applied) {
      filesSkipped.push({
        path,
        reason:
          result.status === 'MISSING_ORIGINAL'
            ? 'Original content not found at the base ref.'
            : result.status === 'BINARY_SKIPPED'
              ? 'Binary file — agentGit does not commit binary blobs.'
              : result.conflicts.length > 0
                ? `Hunk context did not match (${result.conflicts.length} conflict${result.conflicts.length === 1 ? '' : 's'}).`
                : `Skipped (${result.status}).`,
      });
      continue;
    }

    if (result.status === 'DELETED') {
      treeEntries.push({
        path,
        mode: '100644',
        type: 'blob',
        sha: null,
      });
      filesCommitted.push(path);
      continue;
    }

    // CLEAN or CREATED → write a blob and reference it.
    const blob = await createBlob(
      params.parsedRepo,
      result.resultContent,
      headers,
    );
    if (blob.ok === false) return blob;
    treeEntries.push({
      path,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
    filesCommitted.push(path);
  }

  if (!treeEntries.length) {
    return {
      ok: false,
      status: 'VALIDATION',
      message:
        'No files could be applied cleanly — commit aborted. See filesSkipped in the apply report.',
    };
  }

  // 5. Create the tree.
  const tree = await createTree(
    params.parsedRepo,
    baseTree.treeSha,
    treeEntries,
    headers,
  );
  if (tree.ok === false) return tree;

  // 6. Create the commit.
  const commit = await createCommit(
    params.parsedRepo,
    {
      message: params.message,
      treeSha: tree.sha,
      parentSha: params.parentSha,
      author: params.author,
      committer: params.committer,
    },
    headers,
  );
  if (commit.ok === false) return commit;

  // 7. Fast-forward the branch ref.
  const updated = await updateBranchRef(
    params.parsedRepo,
    params.branchName,
    commit.sha,
    headers,
  );
  if (updated.ok === false) return updated;

  return {
    ok: true,
    commitSha: commit.sha,
    treeSha: tree.sha,
    branchRef: updated.ref,
    apply,
    patch: parsed,
    filesCommitted,
    filesSkipped,
  };
};
