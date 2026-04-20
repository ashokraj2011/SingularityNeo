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
 */
export const createOrReuseAgentBranchSessionTx = async (
  client: PoolClient,
  input: CreateSessionInput,
): Promise<{ session: AgentBranchSession; reused: boolean }> => {
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
  if (existing.rows.length) {
    return { session: sessionFromRow(existing.rows[0]), reused: true };
  }

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
  return { session: sessionFromRow(inserted.rows[0]), reused: false };
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
