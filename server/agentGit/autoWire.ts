/**
 * Phase C auto-wire — make the agent-git lifecycle fire without operator clicks.
 *
 * Today, `startAgentBranchSession` and the commit entry points are only
 * reachable through the Operate panel's "Start session" / "Commit latest
 * patch" buttons. The user asked for two automatic hooks instead:
 *
 *   1. When a work item is created, eagerly open a GitHub branch named after
 *      the work item id. No button click needed.
 *   2. When an agent persists a code-change artifact on a work item
 *      (CODE_PATCH or CODE_DIFF), commit it to the work item's branch
 *      session. Lazy-create the session if one doesn't exist yet.
 *
 * Artifact-kind dispatch for hook 2:
 *   - CODE_PATCH — `contentText` is the raw unified diff. Route through
 *     `commitPatchArtifactToSession` (keeps the typed artifact-lookup path).
 *   - CODE_DIFF  — `contentText` is markdown wrapping the diff; the raw
 *     patch is mirrored at `contentJson.repositories[].patchText`. Route
 *     through `commitRawPatchToSession` using that field.
 *
 * Both helpers are strictly fire-and-forget:
 *   - Never throw into the caller's success path. The primary write (work
 *     item insert, artifact insert) must succeed even if GitHub is down, the
 *     token is missing, or the capability has no repo wired.
 *   - Errors are logged to stderr so operators can see them without having
 *     to tail audit tables.
 *   - A capability with `gitRepositories.length === 0` is a no-op, not a
 *     failure. Same for a missing `GITHUB_TOKEN` — the service layer
 *     returns `AUTH_MISSING` cleanly and we just log and move on.
 *
 * Circular-import note: this module statically imports from
 * `./service` and `./repository`, which themselves import from
 * `../repository`. Callers in `server/repository.ts` and
 * `server/execution/service.ts` therefore use **dynamic** `import()` of
 * this module to avoid the cycle. Keep it that way.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  Artifact,
  CapabilityRepository,
  WorkItem,
} from '../../src/types';
import {
  buildAgentBranchName,
  commitPatchArtifactToSession,
  commitRawPatchToSession,
  startAgentBranchSession,
} from './service';
import {
  createOrReuseAgentBranchSession,
  getAgentBranchSessionById,
  insertAgentBranchCommit,
  listAgentBranchSessionsForWorkItem,
  updateAgentBranchSession,
} from './repository';
import { resolveGithubAuth } from './session';
import { normalizeDirectoryPath } from '../workspacePaths';

const LOG_PREFIX = '[agentGit/autoWire]';
const execFileAsync = promisify(execFile);

const logSkip = (context: string, reason: string) => {
  // Intentionally info-level, not error — these are design-intentional no-ops
  // (no repo, no token, feature-off). Kept at stderr so prod logs still
  // surface them without a separate log channel.
  console.warn(`${LOG_PREFIX} skip ${context}: ${reason}`);
};

const logError = (context: string, error: unknown) => {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`${LOG_PREFIX} ${context} failed — ${message}`);
};

const pickPrimaryRepository = (repositories: CapabilityRepository[]) =>
  repositories.find(repository => repository.isPrimary) || repositories[0] || null;

const runGit = async (workspaceRoot: string, args: string[]) => {
  const result = await execFileAsync('git', ['-C', workspaceRoot, ...args], {
    cwd: workspaceRoot,
    maxBuffer: 1024 * 1024 * 8,
  });
  return String(result.stdout || '').trim();
};

const ensureLocalGitRepository = async (workspaceRoot: string) => {
  const insideWorkTree = await runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree']).catch(
    () => '',
  );
  return insideWorkTree === 'true';
};

const resolveLocalWorkspaceRoot = ({
  repository,
  workspaceRoots = [],
}: {
  repository: CapabilityRepository;
  workspaceRoots?: string[];
}) => {
  const repositoryRoot = normalizeDirectoryPath(repository.localRootHint || '');
  if (repositoryRoot) {
    return repositoryRoot;
  }

  const normalizedRoots = workspaceRoots
    .map(root => normalizeDirectoryPath(root))
    .filter(Boolean);
  return normalizedRoots.length === 1 ? normalizedRoots[0] : '';
};

const ensureLocalBranchCheckedOut = async ({
  workspaceRoot,
  branchName,
  baseBranch,
}: {
  workspaceRoot: string;
  branchName: string;
  baseBranch: string;
}) => {
  const existingBranch = await runGit(workspaceRoot, [
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/heads/${branchName}`,
  ]).catch(() => '');

  if (existingBranch) {
    await runGit(workspaceRoot, ['switch', branchName]);
    return;
  }

  try {
    await runGit(workspaceRoot, ['switch', '-c', branchName, baseBranch]);
  } catch {
    await runGit(workspaceRoot, ['switch', '-c', branchName]);
  }
};

const ensureLocalBranchSessionForWorkItem = async ({
  capabilityId,
  workItem,
  repositories,
  workspaceRoots,
  context,
}: {
  capabilityId: string;
  workItem: Pick<WorkItem, 'id' | 'title'>;
  repositories: CapabilityRepository[];
  workspaceRoots?: string[];
  context: string;
}) => {
  const repository = pickPrimaryRepository(repositories);
  if (!repository) {
    logSkip(context, 'capability has no git repositories wired');
    return null;
  }

  const workspaceRoot = resolveLocalWorkspaceRoot({ repository, workspaceRoots });
  if (!workspaceRoot) {
    logSkip(
      context,
      'no local repository root was resolved; set repository localRootHint or exactly one approved workspace root',
    );
    return null;
  }

  if (!(await ensureLocalGitRepository(workspaceRoot))) {
    logSkip(context, `${workspaceRoot} is not a local git repository`);
    return null;
  }

  const branchName = buildAgentBranchName(capabilityId, workItem);
  const baseBranch = String(repository.defaultBranch || '').trim() || 'main';
  const baseSha =
    (await runGit(workspaceRoot, ['rev-parse', baseBranch]).catch(() => '')) ||
    (await runGit(workspaceRoot, ['rev-parse', 'HEAD']).catch(() => ''));

  const { session } = await createOrReuseAgentBranchSession({
    capabilityId,
    workItemId: workItem.id,
    repositoryId: repository.id,
    repositoryUrl: repository.url,
    baseBranch,
    baseSha: baseSha || 'UNKNOWN',
    branchName,
  });

  try {
    await ensureLocalBranchCheckedOut({ workspaceRoot, branchName, baseBranch });
    const headSha = await runGit(workspaceRoot, ['rev-parse', 'HEAD']).catch(() => null);
    await updateAgentBranchSession({
      sessionId: session.id,
      headSha,
      status: 'ACTIVE',
      lastError: null,
    });

    await runGit(workspaceRoot, ['push', '-u', 'origin', branchName]).catch(async error => {
      await updateAgentBranchSession({
        sessionId: session.id,
        status: 'FAILED',
        lastError:
          error instanceof Error
            ? `Local git push failed: ${error.message}`
            : `Local git push failed: ${String(error)}`,
      });
      throw error;
    });

    await updateAgentBranchSession({
      sessionId: session.id,
      status: 'ACTIVE',
      lastError: null,
    });
  } catch (error) {
    logError(context, error);
  }

  return session.id;
};

const resolveLocalCommitSelection = ({
  artifact,
  repository,
  workspaceRoots = [],
  context,
}: {
  artifact: Artifact;
  repository: CapabilityRepository;
  workspaceRoots?: string[];
  context: string;
}) => {
  if (artifact.artifactKind === 'CODE_DIFF') {
    const body = (artifact.contentJson || {}) as {
      repositories?: Array<{
        repoRoot?: string;
        touchedFiles?: string[];
      }>;
    };
    const repos = Array.isArray(body.repositories) ? body.repositories : [];
    if (repos.length !== 1) {
      logSkip(
        context,
        repos.length === 0
          ? 'CODE_DIFF artifact has no repository snapshot for local commit'
          : `CODE_DIFF spans ${repos.length} repos and cannot be committed from one local branch session yet`,
      );
      return null;
    }

    const repoRoot = normalizeDirectoryPath(repos[0].repoRoot || '');
    const touchedFiles = Array.isArray(repos[0].touchedFiles)
      ? repos[0].touchedFiles
          .map(file => String(file || '').trim())
          .filter(Boolean)
      : [];
    if (!repoRoot || touchedFiles.length === 0) {
      logSkip(context, 'CODE_DIFF artifact did not include repoRoot + touchedFiles');
      return null;
    }
    return { repoRoot, touchedFiles };
  }

  const payload = (artifact.contentJson || {}) as {
    files?: Array<{ path?: string; oldPath?: string }>;
  };
  const repoRoot = resolveLocalWorkspaceRoot({ repository, workspaceRoots });
  const touchedFiles = Array.isArray(payload.files)
    ? payload.files
        .map(file =>
          String(file.path || file.oldPath || '').trim(),
        )
        .filter(Boolean)
    : [];
  if (!repoRoot || touchedFiles.length === 0) {
    logSkip(context, 'CODE_PATCH artifact did not resolve local touched files');
    return null;
  }
  return { repoRoot, touchedFiles };
};

const commitArtifactToLocalBranchSession = async ({
  capabilityId,
  sessionId,
  artifact,
  repositories,
  workspaceRoots,
  context,
}: {
  capabilityId: string;
  sessionId: string;
  artifact: Artifact;
  repositories: CapabilityRepository[];
  workspaceRoots?: string[];
  context: string;
}) => {
  const session = await getAgentBranchSessionById(sessionId);
  if (!session || session.capabilityId !== capabilityId) {
    logSkip(context, `session ${sessionId} was not found for local git commit`);
    return;
  }

  const repository = repositories.find(item => item.id === session.repositoryId);
  if (!repository) {
    logSkip(context, `repository ${session.repositoryId} was not found on the capability`);
    return;
  }

  const selection = resolveLocalCommitSelection({
    artifact,
    repository,
    workspaceRoots,
    context,
  });
  if (!selection) {
    return;
  }

  if (!(await ensureLocalGitRepository(selection.repoRoot))) {
    logSkip(context, `${selection.repoRoot} is not a local git repository`);
    return;
  }

  await ensureLocalBranchCheckedOut({
    workspaceRoot: selection.repoRoot,
    branchName: session.branchName,
    baseBranch: session.baseBranch,
  });

  const statusOutput = await runGit(selection.repoRoot, [
    'status',
    '--porcelain',
    '--',
    ...selection.touchedFiles,
  ]).catch(() => '');
  if (!statusOutput.trim()) {
    logSkip(context, 'no local file changes matched the artifact paths');
    return;
  }

  await runGit(selection.repoRoot, ['add', '-A', '--', ...selection.touchedFiles]);

  const message =
    (artifact.summary && artifact.summary.trim()) ||
    `Agent commit for ${session.workItemId} (${artifact.name || artifact.artifactKind || 'change'})`;

  try {
    await runGit(selection.repoRoot, ['commit', '-m', message]);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    if (/nothing to commit|no changes added to commit/i.test(messageText)) {
      logSkip(context, 'git reported no staged changes to commit');
      return;
    }
    throw error;
  }

  const commitSha = await runGit(selection.repoRoot, ['rev-parse', 'HEAD']);
  try {
    await runGit(selection.repoRoot, ['push', '-u', 'origin', session.branchName]);
  } catch (error) {
    await updateAgentBranchSession({
      sessionId,
      status: 'FAILED',
      headSha: commitSha,
      incrementCommits: 1,
      lastCommitMessage: message,
      lastError:
        error instanceof Error
          ? `Local git push failed: ${error.message}`
          : `Local git push failed: ${String(error)}`,
    });
    throw error;
  }

  await insertAgentBranchCommit({
    sessionId,
    capabilityId,
    workItemId: session.workItemId,
    commitSha,
    artifactId: artifact.id,
    artifactKind: artifact.artifactKind || null,
    message,
    filesCommittedCount: selection.touchedFiles.length,
    filesSkippedCount: 0,
  });

  await updateAgentBranchSession({
    sessionId,
    status: 'ACTIVE',
    headSha: commitSha,
    incrementCommits: 1,
    lastCommitMessage: message,
    lastError: null,
  });
};

// ─────────────────────────────────────────────────────────────────────────
// Hook 1 — work item created → start branch session
// ─────────────────────────────────────────────────────────────────────────

export interface AutoStartInput {
  capabilityId: string;
  workItem: Pick<WorkItem, 'id' | 'title'>;
  repositories: CapabilityRepository[];
  workspaceRoots?: string[];
}

/**
 * Called right after a work item row is persisted. Fire-and-forget: resolves
 * with nothing on success AND on any failure. Swallows every error path.
 *
 * Short-circuits when the capability has no git repositories attached.
 * When GitHub auth is missing, it falls back to a local branch session using
 * the approved workspace root so the work item can still get its own branch.
 */
export const autoStartSessionForWorkItem = async (
  input: AutoStartInput,
): Promise<void> => {
  const context = `start(capability=${input.capabilityId}, workItem=${input.workItem.id})`;
  try {
    if (!input.repositories.length) {
      logSkip(context, 'capability has no git repositories wired');
      return;
    }

    // Best-effort pre-check so we don't make a GitHub round-trip just to
    // discover the token is missing. `resolveGithubAuth` is cheap.
    const auth = resolveGithubAuth();
    if (auth.ok === false) {
      await ensureLocalBranchSessionForWorkItem({
        capabilityId: input.capabilityId,
        workItem: input.workItem,
        repositories: input.repositories,
        workspaceRoots: input.workspaceRoots,
        context,
      });
      return;
    }

    const result = await startAgentBranchSession({
      capabilityId: input.capabilityId,
      workItem: input.workItem,
      repositories: input.repositories,
    });

    if (result.ok === false) {
      if (result.status === 'AUTH_MISSING') {
        await ensureLocalBranchSessionForWorkItem({
          capabilityId: input.capabilityId,
          workItem: input.workItem,
          repositories: input.repositories,
          workspaceRoots: input.workspaceRoots,
          context,
        });
        return;
      }

      // AUTH_MISSING / RATE_LIMITED / NO_REPOSITORY are expected-by-design
      // conditions; lump the rest together as real failures worth the louder
      // log line.
      if (
        result.status === 'NO_REPOSITORY' ||
        result.status === 'RATE_LIMITED'
      ) {
        logSkip(context, `${result.status} — ${result.message}`);
      } else {
        console.error(
          `${LOG_PREFIX} ${context} failed — ${result.status}: ${result.message}`,
        );
      }
      return;
    }

    if (!result.reused) {
      console.log(
        `${LOG_PREFIX} started session ${result.session.id} on branch ${result.session.branchName}`,
      );
    }
  } catch (error) {
    logError(context, error);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// Hook 2 — code-change artifact persisted → commit to session
// ─────────────────────────────────────────────────────────────────────────

export interface AutoCommitInput {
  capabilityId: string;
  artifact: Artifact;
  /** The work item the artifact belongs to — needed when lazy-creating a session. */
  workItem: Pick<WorkItem, 'id' | 'title'>;
  repositories: CapabilityRepository[];
  workspaceRoots?: string[];
}

/**
 * Kinds of artifacts this hook commits. Expansion point: adding a new
 * code-change kind (e.g. `CODE_REFACTOR`) only requires extending this
 * type + the dispatch switch below — the session plumbing is shared.
 */
const COMMITTABLE_KINDS = new Set<string>(['CODE_PATCH', 'CODE_DIFF']);

/**
 * Find the existing ACTIVE/REVIEWING/FAILED session for the work item, or
 * lazy-create one via `startAgentBranchSession` (which ensures the GitHub
 * branch exists AND inserts a row in one shot). Returns null on a
 * design-intentional skip (token missing, no repo, rate-limited) so the
 * caller can short-circuit quietly; any real failure is logged here.
 */
const resolveOrOpenSessionId = async ({
  capabilityId,
  workItem,
  repositories,
  workspaceRoots,
  context,
}: {
  capabilityId: string;
  workItem: Pick<WorkItem, 'id' | 'title'>;
  repositories: CapabilityRepository[];
  workspaceRoots?: string[];
  context: string;
}): Promise<string | null> => {
  const existingSessions = await listAgentBranchSessionsForWorkItem({
    capabilityId,
    workItemId: workItem.id,
  });

  const reusable = existingSessions.find(
    s =>
      s.status === 'ACTIVE' || s.status === 'REVIEWING' || s.status === 'FAILED',
  );
  if (reusable) return reusable.id;

  const started = await startAgentBranchSession({
    capabilityId,
    workItem,
    repositories,
  });
  if (started.ok === false) {
    if (started.status === 'AUTH_MISSING') {
      return ensureLocalBranchSessionForWorkItem({
        capabilityId,
        workItem,
        repositories,
        workspaceRoots,
        context,
      });
    }
    if (started.status === 'NO_REPOSITORY' || started.status === 'RATE_LIMITED') {
      logSkip(context, `lazy-start ${started.status} — ${started.message}`);
    } else {
      console.error(
        `${LOG_PREFIX} ${context} lazy-start failed — ${started.status}: ${started.message}`,
      );
    }
    return null;
  }
  return started.session.id;
};

/**
 * Extract the raw unified-diff body from a CODE_DIFF artifact's
 * `contentJson.repositories[]`. Returns [] when the artifact has no usable
 * patch (status-only capture, untracked-only empty commit, etc.).
 *
 * The multi-repo case (contentJson.repositories.length > 1) is intentionally
 * NOT supported yet — a single session maps to a single repo, and
 * concatenating diffs across repos would apply file paths from repo B onto
 * repo A's branch. That work is deferred until per-repo session routing lands.
 */
const extractCodeDiffPatchText = (
  artifact: Artifact,
  context: string,
): string | null => {
  const body = (artifact.contentJson || {}) as {
    repositories?: Array<{
      repoRoot?: string;
      patchText?: string;
    }>;
  };
  const repos = Array.isArray(body.repositories) ? body.repositories : [];
  if (repos.length === 0) {
    logSkip(context, 'CODE_DIFF artifact has no repositories array in contentJson');
    return null;
  }
  if (repos.length > 1) {
    logSkip(
      context,
      `CODE_DIFF spans ${repos.length} repos — per-repo session routing is not yet supported; skipping auto-commit`,
    );
    return null;
  }
  const raw = String(repos[0].patchText || '').trim();
  if (!raw) {
    logSkip(
      context,
      'CODE_DIFF artifact has no patchText — likely a status-only capture with no applied changes',
    );
    return null;
  }
  return raw;
};

/**
 * Route a freshly-persisted code-change artifact to the work item's agent-git
 * session, lazy-creating the session if needed. Dispatches on
 * `artifact.artifactKind`:
 *
 *   - CODE_PATCH  → unified-diff body lives in `contentText`;
 *     delegate to `commitPatchArtifactToSession`.
 *   - CODE_DIFF   → unified-diff body lives in
 *     `contentJson.repositories[0].patchText`;
 *     delegate to `commitRawPatchToSession`.
 *
 * Any other artifact kind is a silent no-op. This is the single entry point
 * the repository hook fires for every newly-added artifact.
 */
export const autoCommitArtifact = async (
  input: AutoCommitInput,
): Promise<void> => {
  const context = `commit(capability=${input.capabilityId}, artifact=${input.artifact.id}, kind=${input.artifact.artifactKind || 'unknown'})`;

  try {
    if (!input.artifact.artifactKind || !COMMITTABLE_KINDS.has(input.artifact.artifactKind)) {
      return; // not our concern
    }
    if (!input.artifact.workItemId) {
      logSkip(context, 'artifact has no workItemId — cannot route to a session');
      return;
    }
    if (input.artifact.workItemId !== input.workItem.id) {
      logSkip(
        context,
        `artifact.workItemId=${input.artifact.workItemId} mismatches caller's workItem=${input.workItem.id}`,
      );
      return;
    }
    if (!input.repositories.length) {
      logSkip(context, 'capability has no git repositories wired');
      return;
    }

    const sessionId = await resolveOrOpenSessionId({
      capabilityId: input.capabilityId,
      workItem: input.workItem,
      repositories: input.repositories,
      workspaceRoots: input.workspaceRoots,
      context,
    });
    if (!sessionId) return;

    const auth = resolveGithubAuth();
    if (auth.ok === false) {
      await commitArtifactToLocalBranchSession({
        capabilityId: input.capabilityId,
        sessionId,
        artifact: input.artifact,
        repositories: input.repositories,
        workspaceRoots: input.workspaceRoots,
        context,
      });
      return;
    }

    // Dispatch on kind.
    let result:
      | Awaited<ReturnType<typeof commitPatchArtifactToSession>>
      | Awaited<ReturnType<typeof commitRawPatchToSession>>;

    if (input.artifact.artifactKind === 'CODE_PATCH') {
      result = await commitPatchArtifactToSession({
        capabilityId: input.capabilityId,
        sessionId,
        artifactId: input.artifact.id,
      });
    } else {
      // CODE_DIFF
      const patchText = extractCodeDiffPatchText(input.artifact, context);
      if (!patchText) return;
      const message =
        (input.artifact.summary && input.artifact.summary.trim()) ||
        `Agent commit for ${input.workItem.id} (${input.artifact.name || 'code diff'})`;
      result = await commitRawPatchToSession({
        capabilityId: input.capabilityId,
        sessionId,
        patchText,
        message,
        artifactId: input.artifact.id,
        artifactKind: input.artifact.artifactKind,
      });
    }

    if (result.ok === false) {
      if (result.status === 'AUTH_MISSING' || result.status === 'RATE_LIMITED') {
        if (result.status === 'AUTH_MISSING') {
          await commitArtifactToLocalBranchSession({
            capabilityId: input.capabilityId,
            sessionId,
            artifact: input.artifact,
            repositories: input.repositories,
            workspaceRoots: input.workspaceRoots,
            context,
          });
          return;
        }
        logSkip(context, `${result.status} — ${result.message}`);
      } else {
        console.error(
          `${LOG_PREFIX} ${context} failed — ${result.status}: ${result.message}`,
        );
      }
      return;
    }

    console.log(
      `${LOG_PREFIX} committed ${input.artifact.id} to session ${sessionId} (commitSha=${result.result.commitSha.slice(0, 8)}, files=${result.result.filesCommittedCount})`,
    );
  } catch (error) {
    logError(context, error);
  }
};

/**
 * Back-compat alias kept so the existing repository.ts hook keeps working.
 * New callers should import `autoCommitArtifact` — same function, broader name.
 */
export const autoCommitCodePatchArtifact = autoCommitArtifact;
