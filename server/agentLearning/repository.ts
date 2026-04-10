import type { PoolClient } from 'pg';
import type {
  AgentLearningProfile,
  AgentSessionScope,
  AgentSessionSummary,
} from '../../src/types';
import { query, transaction } from '../db';

export type AgentLearningJobStatus =
  | 'QUEUED'
  | 'LEARNING'
  | 'COMPLETED'
  | 'FAILED';

export interface AgentLearningJobRecord {
  id: string;
  capabilityId: string;
  agentId: string;
  status: AgentLearningJobStatus;
  requestReason: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value || '');

const defaultLearningProfile = (): AgentLearningProfile => ({
  status: 'NOT_STARTED',
  summary: '',
  highlights: [],
  contextBlock: '',
  sourceDocumentIds: [],
  sourceArtifactIds: [],
  sourceCount: 0,
});

const learningProfileFromRow = (row: Record<string, any>): AgentLearningProfile => ({
  status: row.status || 'NOT_STARTED',
  summary: row.summary || '',
  highlights: Array.isArray(row.highlights) ? row.highlights.filter((item: unknown) => typeof item === 'string') : [],
  contextBlock: row.context_block || '',
  sourceDocumentIds: Array.isArray(row.source_document_ids)
    ? row.source_document_ids.filter((item: unknown) => typeof item === 'string')
    : [],
  sourceArtifactIds: Array.isArray(row.source_artifact_ids)
    ? row.source_artifact_ids.filter((item: unknown) => typeof item === 'string')
    : [],
  sourceCount: Number(row.source_count || 0),
  refreshedAt: row.refreshed_at ? asIso(row.refreshed_at) : undefined,
  lastRequestedAt: row.last_requested_at ? asIso(row.last_requested_at) : undefined,
  lastError: row.last_error || undefined,
});

const sessionSummaryFromRow = (row: Record<string, any>): AgentSessionSummary => ({
  sessionId: row.session_id,
  scope: row.scope as AgentSessionScope,
  scopeId: row.scope_id || undefined,
  lastUsedAt: asIso(row.last_used_at),
  model: row.model,
  requestCount: Number(row.request_count || 0),
  totalTokens: Number(row.total_tokens || 0),
});

const jobFromRow = (row: Record<string, any>): AgentLearningJobRecord => ({
  id: row.id,
  capabilityId: row.capability_id,
  agentId: row.agent_id,
  status: row.status,
  requestReason: row.request_reason,
  leaseOwner: row.lease_owner || undefined,
  leaseExpiresAt: row.lease_expires_at ? asIso(row.lease_expires_at) : undefined,
  requestedAt: asIso(row.requested_at),
  startedAt: row.started_at ? asIso(row.started_at) : undefined,
  completedAt: row.completed_at ? asIso(row.completed_at) : undefined,
  error: row.error || undefined,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
});

export const ensureAgentLearningProfileTx = async (
  client: PoolClient,
  capabilityId: string,
  agentId: string,
) => {
  await client.query(
    `
      INSERT INTO capability_agent_learning_profiles (
        capability_id,
        agent_id,
        status,
        summary,
        highlights,
        context_block,
        source_document_ids,
        source_artifact_ids,
        source_count,
        updated_at
      )
      VALUES ($1,$2,'NOT_STARTED','','[]'::jsonb,'','{}','{}',0,NOW())
      ON CONFLICT (capability_id, agent_id) DO NOTHING
    `,
    [capabilityId, agentId],
  );
};

export const getAgentLearningProfile = async (
  capabilityId: string,
  agentId: string,
): Promise<AgentLearningProfile> => {
  const result = await query(
    `
      SELECT *
      FROM capability_agent_learning_profiles
      WHERE capability_id = $1 AND agent_id = $2
    `,
    [capabilityId, agentId],
  );

  return result.rowCount
    ? learningProfileFromRow(result.rows[0])
    : defaultLearningProfile();
};

export const listAgentLearningProfilesTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<Map<string, AgentLearningProfile>> => {
  const result = await client.query(
    `
      SELECT *
      FROM capability_agent_learning_profiles
      WHERE capability_id = $1
    `,
    [capabilityId],
  );

  return new Map(
    result.rows.map(row => [String(row.agent_id), learningProfileFromRow(row)]),
  );
};

export const listAgentSessionSummariesTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<Map<string, AgentSessionSummary[]>> => {
  const result = await client.query(
    `
      SELECT *
      FROM capability_agent_sessions
      WHERE capability_id = $1
      ORDER BY last_used_at DESC, updated_at DESC
    `,
    [capabilityId],
  );

  const byAgent = new Map<string, Map<string, AgentSessionSummary>>();
  result.rows.forEach(row => {
    const agentId = String(row.agent_id);
    const key = `${row.scope}:${row.scope_id || ''}`;
    const current = byAgent.get(agentId) || new Map<string, AgentSessionSummary>();
    if (!current.has(key)) {
      current.set(key, sessionSummaryFromRow(row));
    }
    byAgent.set(agentId, current);
  });

  return new Map(
    [...byAgent.entries()].map(([agentId, sessions]) => [agentId, [...sessions.values()]]),
  );
};

export const listAgentSessionSummaries = async (
  capabilityId: string,
  agentId: string,
): Promise<AgentSessionSummary[]> => {
  const result = await query(
    `
      SELECT *
      FROM capability_agent_sessions
      WHERE capability_id = $1 AND agent_id = $2
      ORDER BY last_used_at DESC, updated_at DESC
    `,
    [capabilityId, agentId],
  );

  const byScope = new Map<string, AgentSessionSummary>();
  result.rows.forEach(row => {
    const record = row as Record<string, any>;
    const key = `${record.scope}:${record.scope_id || ''}`;
    if (!byScope.has(key)) {
      byScope.set(key, sessionSummaryFromRow(record));
    }
  });

  return [...byScope.values()];
};

export const upsertAgentLearningProfile = async ({
  capabilityId,
  agentId,
  profile,
}: {
  capabilityId: string;
  agentId: string;
  profile: AgentLearningProfile;
}) =>
  transaction(async client => {
    await ensureAgentLearningProfileTx(client, capabilityId, agentId);
    await client.query(
      `
        INSERT INTO capability_agent_learning_profiles (
          capability_id,
          agent_id,
          status,
          summary,
          highlights,
          context_block,
          source_document_ids,
          source_artifact_ids,
          source_count,
          refreshed_at,
          last_requested_at,
          last_error,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()
        )
        ON CONFLICT (capability_id, agent_id) DO UPDATE SET
          status = EXCLUDED.status,
          summary = EXCLUDED.summary,
          highlights = EXCLUDED.highlights,
          context_block = EXCLUDED.context_block,
          source_document_ids = EXCLUDED.source_document_ids,
          source_artifact_ids = EXCLUDED.source_artifact_ids,
          source_count = EXCLUDED.source_count,
          refreshed_at = EXCLUDED.refreshed_at,
          last_requested_at = EXCLUDED.last_requested_at,
          last_error = EXCLUDED.last_error,
          updated_at = NOW()
      `,
      [
        capabilityId,
        agentId,
        profile.status,
        profile.summary,
        JSON.stringify(profile.highlights || []),
        profile.contextBlock,
        profile.sourceDocumentIds || [],
        profile.sourceArtifactIds || [],
        profile.sourceCount || 0,
        profile.refreshedAt || null,
        profile.lastRequestedAt || null,
        profile.lastError || null,
      ],
    );
  });

export const queueAgentLearningJob = async ({
  capabilityId,
  agentId,
  requestReason,
  makeStale,
}: {
  capabilityId: string;
  agentId: string;
  requestReason: string;
  makeStale?: boolean;
}) =>
  transaction(async client => {
    await ensureAgentLearningProfileTx(client, capabilityId, agentId);

    const existingJobResult = await client.query(
      `
        SELECT *
        FROM capability_agent_learning_jobs
        WHERE capability_id = $1
          AND agent_id = $2
          AND status IN ('QUEUED', 'LEARNING')
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [capabilityId, agentId],
    );

    await client.query(
      `
        UPDATE capability_agent_learning_profiles
        SET
          status = $3,
          last_requested_at = NOW(),
          updated_at = NOW()
        WHERE capability_id = $1 AND agent_id = $2
      `,
      [capabilityId, agentId, makeStale ? 'STALE' : 'QUEUED'],
    );

    if (existingJobResult.rowCount) {
      await client.query(
        `
          UPDATE capability_agent_learning_jobs
          SET request_reason = $3, requested_at = NOW(), updated_at = NOW()
          WHERE capability_id = $1 AND id = $2
        `,
        [capabilityId, existingJobResult.rows[0].id, requestReason],
      );

      return jobFromRow({
        ...existingJobResult.rows[0],
        request_reason: requestReason,
        requested_at: new Date(),
        updated_at: new Date(),
      });
    }

    const jobId = createId('LJOB');
    const inserted = await client.query(
      `
        INSERT INTO capability_agent_learning_jobs (
          capability_id,
          id,
          agent_id,
          status,
          request_reason,
          requested_at,
          updated_at
        )
        VALUES ($1,$2,$3,'QUEUED',$4,NOW(),NOW())
        RETURNING *
      `,
      [capabilityId, jobId, agentId, requestReason],
    );

    await client.query(
      `
        UPDATE capability_agent_learning_profiles
        SET status = 'QUEUED', last_requested_at = NOW(), updated_at = NOW()
        WHERE capability_id = $1 AND agent_id = $2
      `,
      [capabilityId, agentId],
    );

    return jobFromRow(inserted.rows[0]);
  });

export const claimRunnableLearningJobs = async ({
  workerId,
  limit,
  leaseMs,
}: {
  workerId: string;
  limit: number;
  leaseMs: number;
}): Promise<AgentLearningJobRecord[]> =>
  transaction(async client => {
    const result = await client.query(
      `
        WITH candidates AS (
          SELECT capability_id, id
          FROM capability_agent_learning_jobs
          WHERE
            status = 'QUEUED'
            OR (
              status = 'LEARNING'
              AND lease_expires_at IS NOT NULL
              AND lease_expires_at < NOW()
            )
          ORDER BY requested_at ASC, created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE capability_agent_learning_jobs jobs
        SET
          status = 'LEARNING',
          lease_owner = $2,
          lease_expires_at = NOW() + ($3::text || ' milliseconds')::interval,
          started_at = COALESCE(jobs.started_at, NOW()),
          updated_at = NOW()
        FROM candidates
        WHERE jobs.capability_id = candidates.capability_id
          AND jobs.id = candidates.id
        RETURNING jobs.*
      `,
      [limit, workerId, leaseMs],
    );

    return result.rows.map(jobFromRow);
  });

export const renewAgentLearningJobLease = async ({
  capabilityId,
  jobId,
  workerId,
  leaseMs,
}: {
  capabilityId: string;
  jobId: string;
  workerId: string;
  leaseMs: number;
}) => {
  await query(
    `
      UPDATE capability_agent_learning_jobs
      SET lease_expires_at = NOW() + ($4::text || ' milliseconds')::interval,
          updated_at = NOW()
      WHERE capability_id = $1
        AND id = $2
        AND lease_owner = $3
    `,
    [capabilityId, jobId, workerId, leaseMs],
  );
};

export const releaseAgentLearningJobLease = async ({
  capabilityId,
  jobId,
}: {
  capabilityId: string;
  jobId: string;
}) => {
  await query(
    `
      UPDATE capability_agent_learning_jobs
      SET lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
    `,
    [capabilityId, jobId],
  );
};

export const updateAgentLearningJob = async (job: AgentLearningJobRecord) => {
  const result = await query(
    `
      UPDATE capability_agent_learning_jobs
      SET
        status = $3,
        request_reason = $4,
        lease_owner = $5,
        lease_expires_at = $6,
        requested_at = $7,
        started_at = $8,
        completed_at = $9,
        error = $10,
        updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
      RETURNING *
    `,
    [
      job.capabilityId,
      job.id,
      job.status,
      job.requestReason,
      job.leaseOwner || null,
      job.leaseExpiresAt || null,
      job.requestedAt,
      job.startedAt || null,
      job.completedAt || null,
      job.error || null,
    ],
  );

  if (!result.rowCount) {
    throw new Error(`Agent learning job ${job.id} was not found.`);
  }

  return jobFromRow(result.rows[0]);
};

export const findAgentSessionRecord = async ({
  capabilityId,
  agentId,
  scope,
  scopeId,
  fingerprint,
}: {
  capabilityId: string;
  agentId: string;
  scope: AgentSessionScope;
  scopeId?: string;
  fingerprint: string;
}) => {
  const result = await query(
    `
      SELECT *
      FROM capability_agent_sessions
      WHERE capability_id = $1
        AND agent_id = $2
        AND scope = $3
        AND scope_id = $4
        AND fingerprint = $5
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [capabilityId, agentId, scope, scopeId || '', fingerprint],
  );

  return result.rowCount
    ? {
        id: String((result.rows[0] as Record<string, any>).id),
        sessionId: String((result.rows[0] as Record<string, any>).session_id),
        fingerprint: String((result.rows[0] as Record<string, any>).fingerprint),
        summary: sessionSummaryFromRow(result.rows[0] as Record<string, any>),
      }
    : null;
};

export const upsertAgentSessionRecord = async ({
  capabilityId,
  agentId,
  scope,
  scopeId,
  sessionId,
  fingerprint,
  model,
  tokenDelta,
}: {
  capabilityId: string;
  agentId: string;
  scope: AgentSessionScope;
  scopeId?: string;
  sessionId: string;
  fingerprint: string;
  model: string;
  tokenDelta: number;
}) => {
  const id = createId('ASESSION');
  const result = await query(
    `
      INSERT INTO capability_agent_sessions (
        capability_id,
        id,
        agent_id,
        scope,
        scope_id,
        session_id,
        fingerprint,
        model,
        request_count,
        total_tokens,
        last_used_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,NOW(),NOW())
      ON CONFLICT (capability_id, agent_id, scope, scope_id, fingerprint) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        model = EXCLUDED.model,
        request_count = capability_agent_sessions.request_count + 1,
        total_tokens = capability_agent_sessions.total_tokens + EXCLUDED.total_tokens,
        last_used_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `,
    [
      capabilityId,
      id,
      agentId,
      scope,
      scopeId || '',
      sessionId,
      fingerprint,
      model,
      tokenDelta,
    ],
  );

  return sessionSummaryFromRow(result.rows[0]);
};

export const listAgentsNeedingLearning = async (): Promise<
  Array<{ capabilityId: string; agentId: string }>
> => {
  const result = await query(
    `
      SELECT agents.capability_id, agents.id AS agent_id
      FROM capability_agents agents
      LEFT JOIN capability_agent_learning_profiles profiles
        ON profiles.capability_id = agents.capability_id
       AND profiles.agent_id = agents.id
      WHERE
        profiles.agent_id IS NULL
        OR profiles.status IN ('NOT_STARTED', 'STALE', 'ERROR')
        OR profiles.refreshed_at IS NULL
      ORDER BY agents.capability_id ASC, agents.created_at ASC, agents.id ASC
    `,
  );

  return result.rows.map(row => ({
    capabilityId: String((row as Record<string, any>).capability_id),
    agentId: String((row as Record<string, any>).agent_id),
  }));
};
