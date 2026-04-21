/**
 * Phase C2 — persistence for agent-as-git-author.
 *
 * CRUD for `agent_branch_sessions` and `agent_pull_requests`. No HTTP,
 * no GitHub API — those live in ./session.ts. The service layer
 * (./service.ts) is the only caller that composes both.
 *
 * Conventions match the rest of server/repository.ts:
 *   - `transaction(...)` for multi-statement work
 *   - IDs minted locally via `createId('<PREFIX>')`
 *   - Rows normalised into the camelCase shapes defined in src/types.ts
 */
import type { PoolClient } from 'pg';
import { transaction } from '../db';
import type {
  AgentBranchSession,
  AgentBranchSessionStatus,
  AgentPullRequest,
  AgentPullRequestState,
} from '../../src/types';

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const asIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value || '');

const asNullableIso = (value: unknown): string | null =>
  value == null ? null : asIso(value);

// ─────────────────────────────────────────────────────────────────────────
// Row mappers
// ─────────────────────────────────────────────────────────────────────────

const sessionFromRow = (row: Record<string, any>): AgentBranchSession => ({
  id: String(row.id),
  capabilityId: String(row.capability_id),
  workItemId: String(row.work_item_id),
  repositoryId: String(row.repository_id),
  repositoryUrl: String(row.repository_url),
  baseBranch: String(row.base_branch),
  baseSha: String(row.base_sha),
  branchName: String(row.branch_name),
  headSha: row.head_sha == null ? null : String(row.head_sha),
  status: (row.status || 'ACTIVE') as AgentBranchSessionStatus,
  commitsCount: Number(row.commits_count || 0),
  lastCommitMessage: row.last_commit_message == null ? null : String(row.last_commit_message),
  lastError: row.last_error == null ? null : String(row.last_error),
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
});

const pullRequestFromRow = (row: Record<string, any>): AgentPullRequest => ({
  id: String(row.id),
  sessionId: String(row.session_id),
  capabilityId: String(row.capability_id),
  workItemId: String(row.work_item_id),
  repositoryId: String(row.repository_id),
  prNumber: Number(row.pr_number),
  prUrl: String(row.pr_url),
  htmlUrl: String(row.html_url),
  state: (row.state || 'OPEN') as AgentPullRequestState,
  isDraft: Boolean(row.is_draft),
  title: String(row.title || ''),
  body: String(row.body || ''),
  openedAt: asIso(row.opened_at),
  mergedAt: asNullableIso(row.merged_at),
  closedAt: asNullableIso(row.closed_at),
  lastSyncedAt: asIso(row.last_synced_at),
});

// ─────────────────────────────────────────────────────────────────────────
// Session CRUD
// ─────────────────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  capabilityId: string;
  workItemId: string;
  repositoryId: string;
  repositoryUrl: string;
  baseBranch: string;
  baseSha: string;
  branchName: string;
}

/**
 * Create a new session row. If a non-CLOSED session already exists for
 * the same (capability, work item, repository) we return the existing
 * row instead of inserting — the caller typically wants a stable
 * session and the branch on GitHub is idempotent anyway.
 *
 * Race safety: the `idx_agent_branch_sessions_open_unique` partial
 * unique index (capability_id, work_item_id, repository_id) WHERE
 * status IN ('ACTIVE','REVIEWING','FAILED') enforces "at most one open
 * session per triple" at the DB level. Two concurrent callers — which
 * happen in practice when a work item is created AND its initial
 * CODE_DIFF artifacts land in the same request — can both see the
 * empty SELECT result, but only one INSERT wins. The loser falls into
 * the `ON CONFLICT DO NOTHING` path (empty RETURNING) and we re-SELECT
 * to pick up the winner's row.
 */
export const createOrReuseAgentBranchSessionTx = async (
  client: PoolClient,
  input: CreateSessionInput,
): Promise<{ session: AgentBranchSession; reused: boolean }> => {
  const selectExisting = async () => {
    const existing = await client.query(
      `
        SELECT *
        FROM agent_branch_sessions
        WHERE capability_id = $1
          AND work_item_id = $2
          AND repository_id = $3
          AND status IN ('ACTIVE', 'REVIEWING', 'FAILED')
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      [input.capabilityId, input.workItemId, input.repositoryId],
    );
    return existing.rows[0] || null;
  };

  // Fast path: if a session already exists we reuse it without
  // bothering to INSERT. This is the common case once a work item has
  // its first session.
  const existingRow = await selectExisting();
  if (existingRow) {
    return { session: sessionFromRow(existingRow), reused: true };
  }

  // Race-safe insert: the partial unique index guarantees at most one
  // open row per triple. If a concurrent writer wins, DO NOTHING and
  // re-SELECT the winner so the caller still gets a stable session.
  const id = createId('AGIT');
  const inserted = await client.query(
    `
      INSERT INTO agent_branch_sessions (
        id,
        capability_id,
        work_item_id,
        repository_id,
        repository_url,
        base_branch,
        base_sha,
        branch_name,
        head_sha,
        status,
        commits_count
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,'ACTIVE',0)
      ON CONFLICT (capability_id, work_item_id, repository_id)
        WHERE status IN ('ACTIVE', 'REVIEWING', 'FAILED')
        DO NOTHING
      RETURNING *
    `,
    [
      id,
      input.capabilityId,
      input.workItemId,
      input.repositoryId,
      input.repositoryUrl,
      input.baseBranch,
      input.baseSha,
      input.branchName,
    ],
  );
  if (inserted.rows.length) {
    return { session: sessionFromRow(inserted.rows[0]), reused: false };
  }

  // We lost the race. The winning row is already committed from the
  // concurrent transaction's perspective; re-select to pick it up.
  const winner = await selectExisting();
  if (!winner) {
    // Extremely unlikely — the conflict fired but the winner vanished.
    // Surface the oddity so ops can investigate rather than silently
    // inserting a duplicate.
    throw new Error(
      `agent_branch_sessions: INSERT hit ON CONFLICT but winning row could not be read back (capability=${input.capabilityId}, workItem=${input.workItemId}, repo=${input.repositoryId})`,
    );
  }
  return { session: sessionFromRow(winner), reused: true };
};

export const createOrReuseAgentBranchSession = async (
  input: CreateSessionInput,
): Promise<{ session: AgentBranchSession; reused: boolean }> =>
  transaction(async client => createOrReuseAgentBranchSessionTx(client, input));

export const getAgentBranchSessionById = async (
  sessionId: string,
): Promise<AgentBranchSession | null> =>
  transaction(async client => {
    const result = await client.query(
      `SELECT * FROM agent_branch_sessions WHERE id = $1`,
      [sessionId],
    );
    if (!result.rows.length) return null;
    return sessionFromRow(result.rows[0]);
  });

export const listAgentBranchSessionsForWorkItem = async ({
  capabilityId,
  workItemId,
}: {
  capabilityId: string;
  workItemId: string;
}): Promise<AgentBranchSession[]> =>
  transaction(async client => {
    const result = await client.query(
      `
        SELECT *
        FROM agent_branch_sessions
        WHERE capability_id = $1 AND work_item_id = $2
        ORDER BY updated_at DESC
      `,
      [capabilityId, workItemId],
    );
    return result.rows.map(sessionFromRow);
  });

/**
 * Patch a session row after a commit/PR lifecycle event. Only the
 * supplied fields are written — others remain untouched.
 */
export interface UpdateSessionInput {
  sessionId: string;
  headSha?: string | null;
  status?: AgentBranchSessionStatus;
  incrementCommits?: number;
  lastCommitMessage?: string | null;
  lastError?: string | null;
}

export const updateAgentBranchSessionTx = async (
  client: PoolClient,
  input: UpdateSessionInput,
): Promise<AgentBranchSession | null> => {
  const fragments: string[] = [];
  const values: unknown[] = [];
  let pIndex = 1;

  if (input.headSha !== undefined) {
    fragments.push(`head_sha = $${pIndex++}`);
    values.push(input.headSha);
  }
  if (input.status !== undefined) {
    fragments.push(`status = $${pIndex++}`);
    values.push(input.status);
  }
  if (input.incrementCommits !== undefined && input.incrementCommits !== 0) {
    fragments.push(`commits_count = commits_count + $${pIndex++}`);
    values.push(input.incrementCommits);
  }
  if (input.lastCommitMessage !== undefined) {
    fragments.push(`last_commit_message = $${pIndex++}`);
    values.push(input.lastCommitMessage);
  }
  if (input.lastError !== undefined) {
    fragments.push(`last_error = $${pIndex++}`);
    values.push(input.lastError);
  }
  fragments.push(`updated_at = NOW()`);

  const result = await client.query(
    `
      UPDATE agent_branch_sessions
      SET ${fragments.join(', ')}
      WHERE id = $${pIndex}
      RETURNING *
    `,
    [...values, input.sessionId],
  );
  if (!result.rows.length) return null;
  return sessionFromRow(result.rows[0]);
};

export const updateAgentBranchSession = async (
  input: UpdateSessionInput,
): Promise<AgentBranchSession | null> =>
  transaction(async client => updateAgentBranchSessionTx(client, input));

// ─────────────────────────────────────────────────────────────────────────
// Per-commit audit trail (agent_branch_commits)
//
// The session row tracks aggregates (`commits_count`, `last_commit_message`);
// this table records every individual commit so operators can answer
// "which commit SHA came from which artifact?". `artifactId` is nullable
// to accommodate operator-initiated raw commits that have no artifact.
// ─────────────────────────────────────────────────────────────────────────

export interface AgentBranchCommitRecord {
  id: string;
  sessionId: string;
  capabilityId: string;
  workItemId: string;
  commitSha: string;
  artifactId: string | null;
  artifactKind: string | null;
  message: string;
  filesCommittedCount: number;
  filesSkippedCount: number;
  createdAt: string;
}

const branchCommitFromRow = (row: Record<string, any>): AgentBranchCommitRecord => ({
  id: String(row.id),
  sessionId: String(row.session_id),
  capabilityId: String(row.capability_id),
  workItemId: String(row.work_item_id),
  commitSha: String(row.commit_sha),
  artifactId: row.artifact_id == null ? null : String(row.artifact_id),
  artifactKind: row.artifact_kind == null ? null : String(row.artifact_kind),
  message: String(row.message || ''),
  filesCommittedCount: Number(row.files_committed_count || 0),
  filesSkippedCount: Number(row.files_skipped_count || 0),
  createdAt: asIso(row.created_at),
});

export interface InsertAgentBranchCommitInput {
  sessionId: string;
  capabilityId: string;
  workItemId: string;
  commitSha: string;
  artifactId?: string | null;
  artifactKind?: string | null;
  message: string;
  filesCommittedCount: number;
  filesSkippedCount: number;
}

export const insertAgentBranchCommit = async (
  input: InsertAgentBranchCommitInput,
): Promise<AgentBranchCommitRecord> =>
  transaction(async client => {
    const id = createId('ABC');
    const result = await client.query(
      `
        INSERT INTO agent_branch_commits (
          id,
          session_id,
          capability_id,
          work_item_id,
          commit_sha,
          artifact_id,
          artifact_kind,
          message,
          files_committed_count,
          files_skipped_count
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `,
      [
        id,
        input.sessionId,
        input.capabilityId,
        input.workItemId,
        input.commitSha,
        input.artifactId ?? null,
        input.artifactKind ?? null,
        input.message,
        input.filesCommittedCount,
        input.filesSkippedCount,
      ],
    );
    return branchCommitFromRow(result.rows[0]);
  });

export const listAgentBranchCommitsForSession = async (
  sessionId: string,
): Promise<AgentBranchCommitRecord[]> =>
  transaction(async client => {
    const result = await client.query(
      `
        SELECT *
        FROM agent_branch_commits
        WHERE session_id = $1
        ORDER BY created_at DESC
      `,
      [sessionId],
    );
    return result.rows.map(branchCommitFromRow);
  });

export const listAgentBranchCommitsForArtifact = async (
  artifactId: string,
): Promise<AgentBranchCommitRecord[]> =>
  transaction(async client => {
    const result = await client.query(
      `
        SELECT *
        FROM agent_branch_commits
        WHERE artifact_id = $1
        ORDER BY created_at DESC
      `,
      [artifactId],
    );
    return result.rows.map(branchCommitFromRow);
  });

// ─────────────────────────────────────────────────────────────────────────
// Pull-request CRUD
// ─────────────────────────────────────────────────────────────────────────

export interface InsertAgentPullRequestInput {
  sessionId: string;
  capabilityId: string;
  workItemId: string;
  repositoryId: string;
  prNumber: number;
  prUrl: string;
  htmlUrl: string;
  isDraft: boolean;
  title: string;
  body: string;
}

export const insertAgentPullRequestTx = async (
  client: PoolClient,
  input: InsertAgentPullRequestInput,
): Promise<AgentPullRequest> => {
  const id = createId('APR');
  const result = await client.query(
    `
      INSERT INTO agent_pull_requests (
        id,
        session_id,
        capability_id,
        work_item_id,
        repository_id,
        pr_number,
        pr_url,
        html_url,
        state,
        is_draft,
        title,
        body
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9,$10,$11)
      RETURNING *
    `,
    [
      id,
      input.sessionId,
      input.capabilityId,
      input.workItemId,
      input.repositoryId,
      input.prNumber,
      input.prUrl,
      input.htmlUrl,
      input.isDraft,
      input.title,
      input.body,
    ],
  );
  return pullRequestFromRow(result.rows[0]);
};

export const insertAgentPullRequest = async (
  input: InsertAgentPullRequestInput,
): Promise<AgentPullRequest> =>
  transaction(async client => insertAgentPullRequestTx(client, input));

export const listAgentPullRequestsForSession = async (
  sessionId: string,
): Promise<AgentPullRequest[]> =>
  transaction(async client => {
    const result = await client.query(
      `
        SELECT *
        FROM agent_pull_requests
        WHERE session_id = $1
        ORDER BY opened_at DESC
      `,
      [sessionId],
    );
    return result.rows.map(pullRequestFromRow);
  });

export const listAgentPullRequestsForWorkItem = async ({
  capabilityId,
  workItemId,
}: {
  capabilityId: string;
  workItemId: string;
}): Promise<AgentPullRequest[]> =>
  transaction(async client => {
    const result = await client.query(
      `
        SELECT *
        FROM agent_pull_requests
        WHERE capability_id = $1 AND work_item_id = $2
        ORDER BY opened_at DESC
      `,
      [capabilityId, workItemId],
    );
    return result.rows.map(pullRequestFromRow);
  });

export interface UpdateAgentPullRequestInput {
  id: string;
  state?: AgentPullRequestState;
  isDraft?: boolean;
  mergedAt?: string | null;
  closedAt?: string | null;
}

export const updateAgentPullRequest = async (
  input: UpdateAgentPullRequestInput,
): Promise<AgentPullRequest | null> =>
  transaction(async client => {
    const fragments: string[] = [];
    const values: unknown[] = [];
    let pIndex = 1;

    if (input.state !== undefined) {
      fragments.push(`state = $${pIndex++}`);
      values.push(input.state);
    }
    if (input.isDraft !== undefined) {
      fragments.push(`is_draft = $${pIndex++}`);
      values.push(input.isDraft);
    }
    if (input.mergedAt !== undefined) {
      fragments.push(`merged_at = $${pIndex++}`);
      values.push(input.mergedAt);
    }
    if (input.closedAt !== undefined) {
      fragments.push(`closed_at = $${pIndex++}`);
      values.push(input.closedAt);
    }
    fragments.push(`last_synced_at = NOW()`);

    const result = await client.query(
      `
        UPDATE agent_pull_requests
        SET ${fragments.join(', ')}
        WHERE id = $${pIndex}
        RETURNING *
      `,
      [...values, input.id],
    );
    if (!result.rows.length) return null;
    return pullRequestFromRow(result.rows[0]);
  });
