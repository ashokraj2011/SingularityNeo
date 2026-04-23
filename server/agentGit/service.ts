/**
 * Phase C — service layer for agent-as-git-author.
 *
 * This is the composition point: take a work-item + repository, talk to
 * GitHub via ./session.ts, persist the outcome via ./repository.ts,
 * return a shape the HTTP layer can return verbatim.
 *
 * Design choices:
 *   - One session = one branch on GitHub = one row in agent_branch_sessions.
 *     Multiple commits/CODE_PATCHes can land on the same session.
 *   - Starting a session is idempotent: if one is already ACTIVE for the
 *     (capability, workItem, repo) triple we reuse it. GitHub's ref
 *     creation is also idempotent (handled by `ensureBranch`).
 *   - Failures persist as `status: 'FAILED'` with `last_error` set so the
 *     UI can show "try again" + the actual error message.
 */
import type {
  AgentBranchCommitFileStatus,
  AgentBranchCommitResult,
  AgentBranchSession,
  AgentPullRequest,
  Artifact,
  CapabilityRepository,
  WorkItem,
} from '../../src/types';
import {
  getCapabilityArtifact,
  listWorkItemCodePatchArtifacts,
} from '../repository';
import {
  createOrReuseAgentBranchSession,
  getAgentBranchSessionById,
  insertAgentBranchCommit,
  insertAgentPullRequest,
  listAgentBranchSessionsForWorkItem,
  listAgentPullRequestsForSession,
  listAgentPullRequestsForWorkItem,
  updateAgentBranchSession,
  updateAgentPullRequest,
} from './repository';
import {
  commitPatchToBranch,
  ensureBranch,
  getBranchTip,
  openPullRequest,
  parseRepoUrl,
  resolveGithubAuth,
} from './session';
import type { ParsedRepo } from './session';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Construct the session branch name.
 *
 * Work-item execution uses the literal work item id as the branch name so
 * local checkouts, desktop runtime, and GitHub all speak the same ref.
 */
const buildBranchName = (
  _capabilityId: string,
  workItem: Pick<WorkItem, 'id' | 'title'>,
): string => String(workItem.id || '').trim();

export const buildAgentBranchName = buildBranchName;

const pickPrimaryRepository = (
  repositories: CapabilityRepository[],
  repositoryId?: string,
): CapabilityRepository | null => {
  if (!repositories.length) return null;
  if (repositoryId) {
    const match = repositories.find(r => r.id === repositoryId);
    if (match) return match;
  }
  const primary = repositories.find(r => r.isPrimary);
  if (primary) return primary;
  return repositories[0];
};

export interface AgentGitServiceError {
  ok: false;
  status:
    | 'NO_REPOSITORY'
    | 'REPO_URL_INVALID'
    | 'AUTH_MISSING'
    | 'RATE_LIMITED'
    | 'NOT_FOUND'
    | 'VALIDATION'
    | 'CONFLICT'
    | 'NETWORK'
    | 'ERROR';
  message: string;
}

const failure = (
  status: AgentGitServiceError['status'],
  message: string,
): AgentGitServiceError => ({ ok: false, status, message });

interface SessionContext {
  parsedRepo: ParsedRepo;
  repository: CapabilityRepository;
  headers: Record<string, string>;
}

const buildSessionContext = (
  repositories: CapabilityRepository[],
  repositoryId: string | undefined,
): SessionContext | AgentGitServiceError => {
  const repository = pickPrimaryRepository(repositories, repositoryId);
  if (!repository) {
    return failure('NO_REPOSITORY', 'No linked repository found on this capability.');
  }
  const parsedRepo = parseRepoUrl(repository.url);
  if (!parsedRepo) {
    return failure(
      'REPO_URL_INVALID',
      `Repository URL ${repository.url} could not be parsed as owner/repo.`,
    );
  }
  const auth = resolveGithubAuth();
  if (auth.ok === false) {
    return failure(auth.status, auth.message);
  }
  return { parsedRepo, repository, headers: auth.headers };
};

// ─────────────────────────────────────────────────────────────────────────
// Start session
// ─────────────────────────────────────────────────────────────────────────

export interface StartAgentSessionInput {
  capabilityId: string;
  workItem: Pick<WorkItem, 'id' | 'title'>;
  repositories: CapabilityRepository[];
  /** When omitted, the primary repo (or first repo) is used. */
  repositoryId?: string;
}

export const startAgentBranchSession = async (
  input: StartAgentSessionInput,
): Promise<
  | { ok: true; session: AgentBranchSession; reused: boolean }
  | AgentGitServiceError
> => {
  const context = buildSessionContext(input.repositories, input.repositoryId);
  if ('ok' in context) return context;
  const { parsedRepo, repository, headers } = context;

  const baseBranchName = (repository.defaultBranch || 'main').trim() || 'main';

  const tip = await getBranchTip(parsedRepo, baseBranchName, headers);
  if (tip.ok === false) return failure(tip.status, tip.message);

  const branchName = buildBranchName(input.capabilityId, input.workItem);
  const ensured = await ensureBranch(parsedRepo, branchName, tip.sha, headers);
  if (ensured.ok === false) return failure(ensured.status, ensured.message);

  const { session, reused } = await createOrReuseAgentBranchSession({
    capabilityId: input.capabilityId,
    workItemId: input.workItem.id,
    repositoryId: repository.id,
    repositoryUrl: repository.url,
    baseBranch: baseBranchName,
    baseSha: tip.sha,
    branchName,
  });

  return { ok: true, session, reused };
};

// ─────────────────────────────────────────────────────────────────────────
// Commit a patch artifact
// ─────────────────────────────────────────────────────────────────────────

export interface CommitPatchInput {
  capabilityId: string;
  sessionId: string;
  /**
   * CODE_PATCH artifact id. When omitted, the most recent CODE_PATCH
   * artifact on the session's work item is used.
   */
  artifactId?: string;
  /** Override commit message; defaults to the artifact summary. */
  message?: string;
  authorName?: string;
  authorEmail?: string;
}

const buildFileStatuses = (
  perFile: Record<string, { applied: boolean; status: string; conflicts: any[] }>,
): AgentBranchCommitFileStatus[] =>
  Object.entries(perFile).map(([path, entry]) => ({
    path,
    status: entry.status as AgentBranchCommitFileStatus['status'],
    applied: entry.applied,
    reason:
      entry.status === 'CONFLICT' && entry.conflicts?.length
        ? `Hunk context did not match (${entry.conflicts.length} conflict${entry.conflicts.length === 1 ? '' : 's'}).`
        : entry.status === 'BINARY_SKIPPED'
          ? 'Binary file — agentGit does not commit binary blobs.'
          : entry.status === 'MISSING_ORIGINAL'
            ? 'Original content not found at the base ref.'
            : undefined,
  }));

export const commitPatchArtifactToSession = async (
  input: CommitPatchInput,
): Promise<
  | { ok: true; result: AgentBranchCommitResult }
  | AgentGitServiceError
> => {
  const session = await getAgentBranchSessionById(input.sessionId);
  if (!session || session.capabilityId !== input.capabilityId) {
    return failure('NOT_FOUND', `Session ${input.sessionId} not found.`);
  }
  if (session.status === 'CLOSED') {
    return failure(
      'CONFLICT',
      `Session ${input.sessionId} is closed — start a new session to commit more patches.`,
    );
  }

  // 1. Resolve the patch artifact.
  let artifact: Artifact | null;
  if (input.artifactId) {
    artifact = await getCapabilityArtifact(input.capabilityId, input.artifactId);
  } else {
    const candidates = await listWorkItemCodePatchArtifacts({
      capabilityId: input.capabilityId,
      workItemId: session.workItemId,
      limit: 1,
    });
    artifact = candidates[0] || null;
  }
  if (!artifact) {
    return failure(
      'NOT_FOUND',
      'No CODE_PATCH artifact found for this session — emit one before committing.',
    );
  }
  if (artifact.artifactKind !== 'CODE_PATCH') {
    return failure(
      'VALIDATION',
      `Artifact ${artifact.id} is ${artifact.artifactKind || 'unknown'}, not CODE_PATCH.`,
    );
  }
  const patchText = String(artifact.contentText || '').trim();
  if (!patchText) {
    return failure(
      'VALIDATION',
      `Artifact ${artifact.id} has no unified-diff body in contentText.`,
    );
  }

  const defaultMessage =
    (artifact.summary && artifact.summary.trim()) ||
    `Agent commit for ${session.workItemId}`;

  return commitRawPatchToSession({
    capabilityId: input.capabilityId,
    sessionId: input.sessionId,
    patchText,
    message: input.message || defaultMessage,
    authorName: input.authorName,
    authorEmail: input.authorEmail,
    artifactId: artifact.id,
    artifactKind: artifact.artifactKind || 'CODE_PATCH',
  });
};

// ─────────────────────────────────────────────────────────────────────────
// Commit a raw unified-diff string (no artifact lookup)
//
// Sibling of `commitPatchArtifactToSession` used by the agent-git auto-wire
// hook when the triggering artifact is CODE_DIFF (whose body is markdown
// wrapping a diff, not a raw CODE_PATCH). Keeps the artifact-lookup path
// above as the "typed" public entry point, while this one is the
// pure-plumbing primitive: "here is a diff, here is a session, commit it".
// ─────────────────────────────────────────────────────────────────────────

export interface CommitRawPatchInput {
  capabilityId: string;
  sessionId: string;
  /** Unified-diff text. Must parse through `parseUnifiedDiff`. */
  patchText: string;
  /** Commit message; required — no sensible default at this layer. */
  message: string;
  authorName?: string;
  authorEmail?: string;
  /**
   * Originating artifact, when this commit was driven by one. Written
   * verbatim into `agent_branch_commits` so operators can answer
   * "which commit came from which artifact?" without log-grepping.
   * Optional because operator-initiated raw commits don't have one.
   */
  artifactId?: string | null;
  artifactKind?: string | null;
}

export const commitRawPatchToSession = async (
  input: CommitRawPatchInput,
): Promise<
  | { ok: true; result: AgentBranchCommitResult }
  | AgentGitServiceError
> => {
  const session = await getAgentBranchSessionById(input.sessionId);
  if (!session || session.capabilityId !== input.capabilityId) {
    return failure('NOT_FOUND', `Session ${input.sessionId} not found.`);
  }
  if (session.status === 'CLOSED') {
    return failure(
      'CONFLICT',
      `Session ${input.sessionId} is closed — start a new session to commit more patches.`,
    );
  }

  const trimmed = input.patchText.trim();
  if (!trimmed) {
    return failure('VALIDATION', 'patchText is empty — nothing to commit.');
  }

  const parsedRepo = parseRepoUrl(session.repositoryUrl);
  if (!parsedRepo) {
    return failure(
      'REPO_URL_INVALID',
      `Session repository URL ${session.repositoryUrl} could not be parsed.`,
    );
  }
  const auth = resolveGithubAuth();
  if (auth.ok === false) return failure(auth.status, auth.message);

  const tip = await getBranchTip(parsedRepo, session.branchName, auth.headers);
  if (tip.ok === false) return failure(tip.status, tip.message);

  const author = {
    name: input.authorName || 'SingularityNeo Agent',
    email: input.authorEmail || 'agent@singularity-neo.local',
  };

  const commit = await commitPatchToBranch(
    {
      parsedRepo,
      branchName: session.branchName,
      parentSha: tip.sha,
      patchText: trimmed,
      message: input.message,
      author,
    },
    auth.headers,
  );
  if (commit.ok === false) {
    await updateAgentBranchSession({
      sessionId: session.id,
      status: 'FAILED',
      lastError: commit.message,
    });
    return failure(commit.status, commit.message);
  }

  const updated = await updateAgentBranchSession({
    sessionId: session.id,
    headSha: commit.commitSha,
    status: 'ACTIVE',
    incrementCommits: 1,
    lastCommitMessage: input.message,
    lastError: null,
  });

  const files = buildFileStatuses(commit.apply.perFile);
  const filesCommittedCount = files.filter(f => f.applied).length;
  const filesSkippedCount = files.length - filesCommittedCount;

  // Audit row: one per commit, even if the session aggregates are lost
  // later. Best-effort — a write failure here must not mask the commit
  // success, because the commit has already landed on GitHub.
  try {
    await insertAgentBranchCommit({
      sessionId: session.id,
      capabilityId: session.capabilityId,
      workItemId: session.workItemId,
      commitSha: commit.commitSha,
      artifactId: input.artifactId ?? null,
      artifactKind: input.artifactKind ?? null,
      message: input.message,
      filesCommittedCount,
      filesSkippedCount,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `[agentGit] failed to record audit row for commit ${commit.commitSha} on session ${session.id}: ${reason}`,
    );
  }

  return {
    ok: true,
    result: {
      session: updated || session,
      commitSha: commit.commitSha,
      treeSha: commit.treeSha,
      files,
      filesCommittedCount,
      filesSkippedCount,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────
// Open a pull request from the session branch
// ─────────────────────────────────────────────────────────────────────────

export interface OpenSessionPullRequestInput {
  capabilityId: string;
  sessionId: string;
  title?: string;
  body?: string;
  draft?: boolean;
}

export const openSessionPullRequest = async (
  input: OpenSessionPullRequestInput,
): Promise<
  | { ok: true; session: AgentBranchSession; pullRequest: AgentPullRequest }
  | AgentGitServiceError
> => {
  const session = await getAgentBranchSessionById(input.sessionId);
  if (!session || session.capabilityId !== input.capabilityId) {
    return failure('NOT_FOUND', `Session ${input.sessionId} not found.`);
  }
  if (!session.headSha) {
    return failure(
      'CONFLICT',
      'Cannot open a PR before the session has at least one commit.',
    );
  }
  if (session.status === 'CLOSED') {
    return failure('CONFLICT', 'Session is closed.');
  }

  const parsedRepo = parseRepoUrl(session.repositoryUrl);
  if (!parsedRepo) {
    return failure(
      'REPO_URL_INVALID',
      `Session repository URL ${session.repositoryUrl} could not be parsed.`,
    );
  }
  const auth = resolveGithubAuth();
  if (auth.ok === false) return failure(auth.status, auth.message);

  const title =
    input.title?.trim() ||
    session.lastCommitMessage?.split('\n')[0] ||
    `Agent PR — ${session.workItemId}`;
  const body =
    input.body?.trim() ||
    [
      `Opened automatically from agent session **${session.id}**.`,
      '',
      `- Work item: \`${session.workItemId}\``,
      `- Commits on this branch: ${session.commitsCount}`,
      `- Base: \`${session.baseBranch}\` @ \`${session.baseSha.slice(0, 7)}\``,
      session.lastCommitMessage
        ? `\nLast commit: ${session.lastCommitMessage}`
        : '',
    ].join('\n');

  const pr = await openPullRequest(
    parsedRepo,
    {
      title,
      body,
      head: session.branchName,
      base: session.baseBranch,
      draft: input.draft ?? true,
    },
    auth.headers,
  );
  if (pr.ok === false) return failure(pr.status, pr.message);

  const record = await insertAgentPullRequest({
    sessionId: session.id,
    capabilityId: session.capabilityId,
    workItemId: session.workItemId,
    repositoryId: session.repositoryId,
    prNumber: pr.number,
    prUrl: pr.url,
    htmlUrl: pr.htmlUrl,
    isDraft: pr.draft,
    title: pr.title,
    body: pr.body,
  });

  const updated = await updateAgentBranchSession({
    sessionId: session.id,
    status: 'REVIEWING',
  });

  return {
    ok: true,
    session: updated || session,
    pullRequest: record,
  };
};

// ─────────────────────────────────────────────────────────────────────────
// Read helpers used by the UI
// ─────────────────────────────────────────────────────────────────────────

export interface WorkItemAgentGitSnapshot {
  sessions: AgentBranchSession[];
  pullRequests: AgentPullRequest[];
}

export const getWorkItemAgentGitSnapshot = async ({
  capabilityId,
  workItemId,
}: {
  capabilityId: string;
  workItemId: string;
}): Promise<WorkItemAgentGitSnapshot> => {
  const [sessions, pullRequests] = await Promise.all([
    listAgentBranchSessionsForWorkItem({ capabilityId, workItemId }),
    listAgentPullRequestsForWorkItem({ capabilityId, workItemId }),
  ]);
  return { sessions, pullRequests };
};

export const getSessionPullRequestHistory = async (
  sessionId: string,
): Promise<AgentPullRequest[]> => listAgentPullRequestsForSession(sessionId);

/**
 * Operator-initiated close: stop accepting commits on this session
 * branch. We do NOT delete the GitHub branch — the PR history stays
 * intact — we just flag the local row so the UI won't offer a "commit"
 * button.
 */
export const closeAgentBranchSession = async ({
  capabilityId,
  sessionId,
}: {
  capabilityId: string;
  sessionId: string;
}): Promise<
  | { ok: true; session: AgentBranchSession }
  | AgentGitServiceError
> => {
  const existing = await getAgentBranchSessionById(sessionId);
  if (!existing || existing.capabilityId !== capabilityId) {
    return failure('NOT_FOUND', `Session ${sessionId} not found.`);
  }
  const updated = await updateAgentBranchSession({
    sessionId,
    status: 'CLOSED',
  });
  return { ok: true, session: updated || existing };
};

/**
 * Mark a PR merged/closed when the operator confirms outside GitHub (or
 * when a webhook notifies us — Phase C3+). Kept here so the HTTP layer
 * stays thin.
 */
export const recordPullRequestStateChange = async (input: {
  pullRequestId: string;
  state: 'MERGED' | 'CLOSED';
}): Promise<AgentPullRequest | null> => {
  const now = new Date().toISOString();
  return updateAgentPullRequest({
    id: input.pullRequestId,
    state: input.state,
    mergedAt: input.state === 'MERGED' ? now : null,
    closedAt: now,
    isDraft: false,
  });
};
