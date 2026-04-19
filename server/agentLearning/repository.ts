import type { PoolClient } from 'pg';
import type {
  AgentLearningProfile,
  AgentLearningProfileVersion,
  AgentLearningStatus,
  AgentSessionScope,
  AgentSessionSummary,
  OperatingPolicySnapshot,
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
  currentVersionId: row.current_version_id || undefined,
  previousVersionId: row.previous_version_id || undefined,
  // Slice C — canary + drift state. Optional so callers that only need
  // the knowledge fields aren't forced to care. Undefined means "not yet
  // initialized" (e.g. profile row predates the migration).
  canaryStartedAt: row.canary_started_at ? asIso(row.canary_started_at) : undefined,
  canaryRequestCount: row.canary_request_count !== undefined ? Number(row.canary_request_count) : undefined,
  canaryNegativeCount: row.canary_negative_count !== undefined ? Number(row.canary_negative_count) : undefined,
  driftFlaggedAt: row.drift_flagged_at ? asIso(row.drift_flagged_at) : undefined,
  driftReason: row.drift_reason || undefined,
  driftRegressionStreak: row.drift_regression_streak !== undefined ? Number(row.drift_regression_streak) : undefined,
  driftLastCheckedAt: row.drift_last_checked_at ? asIso(row.drift_last_checked_at) : undefined,
});

const toOptionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const parseJsonValue = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
};

const profileVersionFromRow = (row: Record<string, any>): AgentLearningProfileVersion => ({
  versionId: String(row.version_id),
  capabilityId: String(row.capability_id),
  agentId: String(row.agent_id),
  versionNo: Number(row.version_no || 0),
  status: (row.status || 'READY') as AgentLearningStatus,
  summary: row.summary || '',
  highlights: Array.isArray(row.highlights)
    ? row.highlights.filter((item: unknown) => typeof item === 'string')
    : [],
  contextBlock: row.context_block || '',
  sourceDocumentIds: Array.isArray(row.source_document_ids)
    ? row.source_document_ids.filter((item: unknown) => typeof item === 'string')
    : [],
  sourceArtifactIds: Array.isArray(row.source_artifact_ids)
    ? row.source_artifact_ids.filter((item: unknown) => typeof item === 'string')
    : [],
  sourceCount: Number(row.source_count || 0),
  contextBlockTokens: toOptionalNumber(row.context_block_tokens),
  judgeScore: toOptionalNumber(row.judge_score),
  judgeReport: parseJsonValue(row.judge_report),
  shapeReport: parseJsonValue(row.shape_report),
  createdByUpdateId: row.created_by_update_id || undefined,
  notes: row.notes || undefined,
  createdAt: asIso(row.created_at),
  // Slice C — final canary counters captured when this version was
  // replaced. Only populated on outgoing (replaced) versions.
  frozenRequestCount: toOptionalNumber(row.frozen_request_count),
  frozenNegativeCount: toOptionalNumber(row.frozen_negative_count),
  frozenAt: row.frozen_at ? asIso(row.frozen_at) : undefined,
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

const nextProfileVersionNoTx = async (
  client: PoolClient,
  capabilityId: string,
  agentId: string,
): Promise<number> => {
  const result = await client.query(
    `
      SELECT COALESCE(MAX(version_no), 0) AS max_version
      FROM capability_agent_learning_profile_versions
      WHERE capability_id = $1 AND agent_id = $2
    `,
    [capabilityId, agentId],
  );
  return Number(result.rows[0]?.max_version || 0) + 1;
};

const insertProfileVersionTx = async (
  client: PoolClient,
  {
    capabilityId,
    agentId,
    status,
    summary,
    highlights,
    contextBlock,
    sourceDocumentIds,
    sourceArtifactIds,
    sourceCount,
    contextBlockTokens,
    shapeReport,
    judgeScore,
    judgeReport,
    createdByUpdateId,
    notes,
  }: {
    capabilityId: string;
    agentId: string;
    status: AgentLearningStatus;
    summary: string;
    highlights: string[];
    contextBlock: string;
    sourceDocumentIds: string[];
    sourceArtifactIds: string[];
    sourceCount: number;
    contextBlockTokens?: number;
    shapeReport?: unknown;
    judgeScore?: number;
    judgeReport?: unknown;
    createdByUpdateId?: string;
    notes?: string;
  },
): Promise<AgentLearningProfileVersion> => {
  const versionNo = await nextProfileVersionNoTx(client, capabilityId, agentId);
  const versionId = createId('PROFVER');

  const result = await client.query(
    `
      INSERT INTO capability_agent_learning_profile_versions (
        capability_id,
        version_id,
        agent_id,
        version_no,
        status,
        summary,
        highlights,
        context_block,
        source_document_ids,
        source_artifact_ids,
        source_count,
        context_block_tokens,
        judge_score,
        judge_report,
        shape_report,
        created_by_update_id,
        notes,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
      RETURNING *
    `,
    [
      capabilityId,
      versionId,
      agentId,
      versionNo,
      status,
      summary,
      JSON.stringify(highlights || []),
      contextBlock,
      sourceDocumentIds || [],
      sourceArtifactIds || [],
      sourceCount || 0,
      contextBlockTokens ?? null,
      judgeScore ?? null,
      judgeReport === undefined ? null : JSON.stringify(judgeReport),
      shapeReport === undefined ? null : JSON.stringify(shapeReport),
      createdByUpdateId || null,
      notes || null,
    ],
  );

  return profileVersionFromRow(result.rows[0]);
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

/**
 * Commits a new profile version and flips the live pointer to it — in one
 * transaction. The previous pointer target is preserved in `previous_version_id`
 * so operator-initiated revert (`activateAgentLearningProfileVersion`) and
 * future drift detection have a clean N-1 baseline.
 *
 * Use this on the happy-path finalize (status=READY). For transient state
 * changes (QUEUED/LEARNING/ERROR/STALE) use `upsertAgentLearningProfile` so
 * we don't spam the version history with error placeholders.
 */
export const commitAgentLearningProfileVersion = async ({
  capabilityId,
  agentId,
  profile,
  contextBlockTokens,
  shapeReport,
  judgeScore,
  judgeReport,
  createdByUpdateId,
  notes,
  flipPointer = true,
  versionStatusOverride,
}: {
  capabilityId: string;
  agentId: string;
  profile: AgentLearningProfile;
  contextBlockTokens?: number;
  shapeReport?: unknown;
  judgeScore?: number;
  judgeReport?: unknown;
  createdByUpdateId?: string;
  notes?: string;
  /**
   * Slice B: when false, the candidate is saved to the version table but the
   * live pointer on capability_agent_learning_profiles is NOT flipped — the
   * prior version keeps serving. Used for the REVIEW_PENDING path when a
   * shape check blocks promotion.
   */
  flipPointer?: boolean;
  /**
   * Slice B: lets a caller persist the candidate version under a different
   * status from what the live profile gets updated to. e.g. staging a
   * REVIEW_PENDING candidate while the live pointer stays on the prior READY
   * version.
   */
  versionStatusOverride?: AgentLearningStatus;
}): Promise<{ profile: AgentLearningProfile; version: AgentLearningProfileVersion }> =>
  transaction(async client => {
    await ensureAgentLearningProfileTx(client, capabilityId, agentId);

    const currentResult = await client.query(
      `
        SELECT *
        FROM capability_agent_learning_profiles
        WHERE capability_id = $1 AND agent_id = $2
        FOR UPDATE
      `,
      [capabilityId, agentId],
    );
    const currentRow = currentResult.rows[0] as Record<string, any> | undefined;
    const previousVersionId: string | null = currentRow?.current_version_id || null;
    // Slice C — capture the outgoing version's live canary counters so we
    // can freeze them onto that version row after the INSERT lands. This
    // is the baseline the drift detector compares the new canary against.
    const outgoingRequestCount: number = Number(currentRow?.canary_request_count || 0);
    const outgoingNegativeCount: number = Number(currentRow?.canary_negative_count || 0);

    const version = await insertProfileVersionTx(client, {
      capabilityId,
      agentId,
      status: versionStatusOverride || profile.status,
      summary: profile.summary || '',
      highlights: profile.highlights || [],
      contextBlock: profile.contextBlock || '',
      sourceDocumentIds: profile.sourceDocumentIds || [],
      sourceArtifactIds: profile.sourceArtifactIds || [],
      sourceCount: profile.sourceCount || 0,
      contextBlockTokens,
      shapeReport,
      judgeScore,
      judgeReport,
      createdByUpdateId,
      notes,
    });

    if (!flipPointer) {
      // REVIEW_PENDING path: persist the candidate in the version table but
      // keep the prior version serving. Only touch a minimal set of fields
      // on the live profile (last_requested_at + last_error) so the UI can
      // surface the pending state without replacing the current knowledge.
      const pendingUpdate = await client.query(
        `
          UPDATE capability_agent_learning_profiles
          SET
            last_requested_at = COALESCE($3, last_requested_at),
            last_error = $4,
            updated_at = NOW()
          WHERE capability_id = $1 AND agent_id = $2
          RETURNING *
        `,
        [
          capabilityId,
          agentId,
          profile.lastRequestedAt || null,
          profile.lastError || null,
        ],
      );
      return {
        profile: learningProfileFromRow(pendingUpdate.rows[0]),
        version,
      };
    }

    // Slice C — freeze the outgoing version's final canary counters. We
    // write this BEFORE the pointer flip so even if the flip fails the
    // baseline is preserved. It's also idempotent — the freeze row is
    // keyed on (capability_id, version_id) and a second write is a no-op
    // in the normal flow.
    if (previousVersionId) {
      await client.query(
        `
          UPDATE capability_agent_learning_profile_versions
          SET
            frozen_request_count = COALESCE(frozen_request_count, $3),
            frozen_negative_count = COALESCE(frozen_negative_count, $4),
            frozen_at = COALESCE(frozen_at, NOW())
          WHERE capability_id = $1 AND version_id = $2
        `,
        [capabilityId, previousVersionId, outgoingRequestCount, outgoingNegativeCount],
      );
    }

    const updateResult = await client.query(
      `
        UPDATE capability_agent_learning_profiles
        SET
          status = $3,
          summary = $4,
          highlights = $5,
          context_block = $6,
          source_document_ids = $7,
          source_artifact_ids = $8,
          source_count = $9,
          refreshed_at = $10,
          last_requested_at = $11,
          last_error = $12,
          previous_version_id = $13,
          current_version_id = $14,
          -- Slice C — reset canary for the newly-live version.
          canary_started_at = NOW(),
          canary_request_count = 0,
          canary_negative_count = 0,
          drift_flagged_at = NULL,
          drift_reason = NULL,
          drift_regression_streak = 0,
          drift_last_checked_at = NULL,
          updated_at = NOW()
        WHERE capability_id = $1 AND agent_id = $2
        RETURNING *
      `,
      [
        capabilityId,
        agentId,
        profile.status,
        profile.summary || '',
        JSON.stringify(profile.highlights || []),
        profile.contextBlock || '',
        profile.sourceDocumentIds || [],
        profile.sourceArtifactIds || [],
        profile.sourceCount || 0,
        profile.refreshedAt || null,
        profile.lastRequestedAt || null,
        profile.lastError || null,
        previousVersionId,
        version.versionId,
      ],
    );

    return {
      profile: learningProfileFromRow(updateResult.rows[0]),
      version,
    };
  });

// ─────────────────────────────────────────────────────────────────────────
// Slice C — canary counters + drift state manipulation.
// ─────────────────────────────────────────────────────────────────────────

export interface CanaryIncrement {
  requestDelta?: number;
  negativeDelta?: number;
}

/**
 * Atomically bumps the canary counters on the live profile row. Used by
 * session-logging (request delta) and the correction / negative-feedback
 * path (negative delta). Safe to call before any version has been
 * committed — counters stay at 0 until the first version flip arms the
 * canary (canary_started_at NOT NULL). We still increment so early signal
 * isn't lost, but the drift detector ignores counters when no baseline
 * version exists yet.
 */
export const incrementAgentLearningCanaryCounters = async ({
  capabilityId,
  agentId,
  requestDelta = 0,
  negativeDelta = 0,
}: {
  capabilityId: string;
  agentId: string;
} & CanaryIncrement): Promise<void> => {
  if (!requestDelta && !negativeDelta) return;
  await query(
    `
      UPDATE capability_agent_learning_profiles
      SET
        canary_request_count = canary_request_count + $3,
        canary_negative_count = canary_negative_count + $4,
        updated_at = NOW()
      WHERE capability_id = $1 AND agent_id = $2
    `,
    [capabilityId, agentId, Math.max(0, requestDelta), Math.max(0, negativeDelta)],
  );
};

export const markAgentLearningDriftFlag = async ({
  capabilityId,
  agentId,
  flaggedAt,
  reason,
  regressionStreak,
  lastCheckedAt,
}: {
  capabilityId: string;
  agentId: string;
  flaggedAt: string | null;
  reason: string | null;
  regressionStreak: number;
  lastCheckedAt: string;
}): Promise<AgentLearningProfile> => {
  const result = await query(
    `
      UPDATE capability_agent_learning_profiles
      SET
        drift_flagged_at = $3,
        drift_reason = $4,
        drift_regression_streak = $5,
        drift_last_checked_at = $6,
        updated_at = NOW()
      WHERE capability_id = $1 AND agent_id = $2
      RETURNING *
    `,
    [capabilityId, agentId, flaggedAt, reason, regressionStreak, lastCheckedAt],
  );
  return result.rowCount
    ? learningProfileFromRow(result.rows[0])
    : defaultLearningProfile();
};

/**
 * Loads the profile + its previous version (if any) in a single round-trip.
 * The drift detector uses both — current canary counters from the profile
 * row, frozen baseline counters from the previous version row.
 */
export const getAgentLearningDriftContext = async (
  capabilityId: string,
  agentId: string,
): Promise<{
  profile: AgentLearningProfile;
  currentVersion: AgentLearningProfileVersion | null;
  previousVersion: AgentLearningProfileVersion | null;
}> => {
  const profile = await getAgentLearningProfile(capabilityId, agentId);
  const currentVersionId = profile.currentVersionId;
  const previousVersionId = profile.previousVersionId;
  const [currentVersion, previousVersion] = await Promise.all([
    currentVersionId
      ? getAgentLearningProfileVersion(capabilityId, agentId, currentVersionId)
      : Promise.resolve(null),
    previousVersionId
      ? getAgentLearningProfileVersion(capabilityId, agentId, previousVersionId)
      : Promise.resolve(null),
  ]);
  return { profile, currentVersion, previousVersion };
};

// ─────────────────────────────────────────────────────────────────────────
// Slice D — append-only learning-update emission + advisory lock helpers.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Atomically appends a single `capability_learning_updates` row. Unlike the
 * legacy `replaceCapabilityWorkspaceContentRecord` path (which DELETEs then
 * bulk-INSERTs every update for the capability), this helper is race-safe
 * and cheap — the right tool for Slice D's PIPELINE_ERROR / DRIFT_FLAGGED /
 * VERSION_REVERTED emissions that can't afford to clobber concurrent
 * writers. The rows remain visible to the existing reader code paths
 * (capability bundle assembly concatenates from this table).
 */
export const appendLearningUpdateRecord = async ({
  capabilityId,
  agentId,
  id,
  insight,
  timestamp,
  triggerType,
  sourceLogIds = [],
  skillUpdate,
  relatedWorkItemId,
  relatedRunId,
}: {
  capabilityId: string;
  agentId: string;
  id?: string;
  insight: string;
  timestamp?: string;
  triggerType: string;
  sourceLogIds?: string[];
  skillUpdate?: string;
  relatedWorkItemId?: string;
  relatedRunId?: string;
}): Promise<{ id: string }> => {
  const resolvedId = id || createId('LEARN');
  const resolvedTs = timestamp || new Date().toISOString();
  await query(
    `
      INSERT INTO capability_learning_updates (
        capability_id,
        id,
        agent_id,
        source_log_ids,
        insight,
        skill_update,
        timestamp,
        trigger_type,
        related_work_item_id,
        related_run_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (capability_id, id) DO NOTHING
    `,
    [
      capabilityId,
      resolvedId,
      agentId,
      sourceLogIds,
      insight,
      skillUpdate || null,
      resolvedTs,
      triggerType,
      relatedWorkItemId || null,
      relatedRunId || null,
    ],
  );
  return { id: resolvedId };
};

/**
 * Derives the 63-bit advisory lock key for an (agentId, capabilityId) pair.
 * We concat the two IDs with a pipe delimiter and hash with Postgres's
 * built-in hashtextextended so a JS equivalent isn't needed; callers pass
 * the concat string straight through. Pulled out as a helper so tests can
 * verify the same key shape is used everywhere.
 */
export const buildAgentLearningLockKey = (capabilityId: string, agentId: string) =>
  `agent-learning:${capabilityId}|${agentId}`;

/**
 * Slice D — run `work` while holding a Postgres advisory xact lock keyed on
 * the (capability, agent) pair. This serializes concurrent corrections /
 * judge writes / drift evaluations against the same agent without the
 * long-hold of a row-level lock, and the lock is auto-released at commit.
 *
 * When the lock cannot be acquired within `attempts * delayMs`, we throw a
 * well-known error the caller can route into PIPELINE_ERROR / queue retry.
 * The 100 ms budget matches the plan; contention above that indicates a
 * runaway writer rather than expected overlap.
 */
export const withAgentLearningLock = async <T>(
  {
    capabilityId,
    agentId,
    attempts = 3,
    delayMs = 50,
  }: {
    capabilityId: string;
    agentId: string;
    attempts?: number;
    delayMs?: number;
  },
  work: () => Promise<T>,
): Promise<{ value: T; lockWaitMs: number }> => {
  const key = buildAgentLearningLockKey(capabilityId, agentId);
  const startedAt = Date.now();
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    const acquired = await transaction(async client => {
      const result = await client.query(
        `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked`,
        [key],
      );
      if (!result.rows[0]?.locked) return null;
      return await work();
    });
    if (acquired !== null) {
      return { value: acquired as T, lockWaitMs: Date.now() - startedAt };
    }
    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  const waited = Date.now() - startedAt;
  const error = new Error(
    `Agent learning lock contention: could not acquire lock for ${key} after ${waited}ms`,
  );
  (error as Error & { code?: string }).code = 'AGENT_LEARNING_LOCK_TIMEOUT';
  throw error;
};

/**
 * Slice B — write the judge score + report onto an existing version row
 * after the async LLM-judge finishes. Separate from commit so the judge
 * can run after the transaction has closed without blocking inference.
 */
export const updateAgentLearningProfileVersionJudge = async ({
  capabilityId,
  agentId,
  versionId,
  judgeScore,
  judgeReport,
}: {
  capabilityId: string;
  agentId: string;
  versionId: string;
  judgeScore: number;
  judgeReport: unknown;
}): Promise<AgentLearningProfileVersion | null> => {
  const result = await query(
    `
      UPDATE capability_agent_learning_profile_versions
      SET judge_score = $4, judge_report = $5
      WHERE capability_id = $1 AND agent_id = $2 AND version_id = $3
      RETURNING *
    `,
    [capabilityId, agentId, versionId, judgeScore, JSON.stringify(judgeReport ?? null)],
  );
  if (!result.rowCount) return null;
  return profileVersionFromRow(result.rows[0] as Record<string, any>);
};

export const listAgentLearningProfileVersions = async (
  capabilityId: string,
  agentId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<AgentLearningProfileVersion[]> => {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);

  const result = await query(
    `
      SELECT *
      FROM capability_agent_learning_profile_versions
      WHERE capability_id = $1 AND agent_id = $2
      ORDER BY version_no DESC
      LIMIT $3 OFFSET $4
    `,
    [capabilityId, agentId, limit, offset],
  );

  return result.rows.map(row => profileVersionFromRow(row as Record<string, any>));
};

export const getAgentLearningProfileVersion = async (
  capabilityId: string,
  agentId: string,
  versionId: string,
): Promise<AgentLearningProfileVersion | null> => {
  const result = await query(
    `
      SELECT *
      FROM capability_agent_learning_profile_versions
      WHERE capability_id = $1 AND agent_id = $2 AND version_id = $3
    `,
    [capabilityId, agentId, versionId],
  );

  if (!result.rowCount) {
    return null;
  }
  return profileVersionFromRow(result.rows[0] as Record<string, any>);
};

/**
 * Operator-initiated revert. Flips the live pointer to a prior version and
 * mirrors its denormalized fields back onto the live profile row. Does NOT
 * create a new version — reverting is idempotent. The previous pointer target
 * is captured in `previous_version_id` so Slice C's drift detector has a
 * coherent baseline after an operator revert.
 */
export const activateAgentLearningProfileVersion = async ({
  capabilityId,
  agentId,
  versionId,
}: {
  capabilityId: string;
  agentId: string;
  versionId: string;
}): Promise<{ profile: AgentLearningProfile; version: AgentLearningProfileVersion }> =>
  transaction(async client => {
    const versionResult = await client.query(
      `
        SELECT *
        FROM capability_agent_learning_profile_versions
        WHERE capability_id = $1 AND agent_id = $2 AND version_id = $3
      `,
      [capabilityId, agentId, versionId],
    );

    if (!versionResult.rowCount) {
      throw new Error(
        `Profile version ${versionId} was not found for agent ${agentId} in capability ${capabilityId}.`,
      );
    }

    const version = profileVersionFromRow(versionResult.rows[0] as Record<string, any>);

    const currentResult = await client.query(
      `
        SELECT *
        FROM capability_agent_learning_profiles
        WHERE capability_id = $1 AND agent_id = $2
        FOR UPDATE
      `,
      [capabilityId, agentId],
    );
    const currentRow = currentResult.rows[0] as Record<string, any> | undefined;
    const previousVersionId: string | null = currentRow?.current_version_id || null;
    const outgoingRequestCount: number = Number(currentRow?.canary_request_count || 0);
    const outgoingNegativeCount: number = Number(currentRow?.canary_negative_count || 0);

    // Slice C — freeze the outgoing (revert-from) version's counters so
    // drift detection has a baseline for the restored version going
    // forward. Mirrors commitAgentLearningProfileVersion.
    if (previousVersionId && previousVersionId !== versionId) {
      await client.query(
        `
          UPDATE capability_agent_learning_profile_versions
          SET
            frozen_request_count = COALESCE(frozen_request_count, $3),
            frozen_negative_count = COALESCE(frozen_negative_count, $4),
            frozen_at = COALESCE(frozen_at, NOW())
          WHERE capability_id = $1 AND version_id = $2
        `,
        [capabilityId, previousVersionId, outgoingRequestCount, outgoingNegativeCount],
      );
    }

    const updateResult = await client.query(
      `
        UPDATE capability_agent_learning_profiles
        SET
          status = $3,
          summary = $4,
          highlights = $5,
          context_block = $6,
          source_document_ids = $7,
          source_artifact_ids = $8,
          source_count = $9,
          refreshed_at = NOW(),
          last_error = NULL,
          previous_version_id = $10,
          current_version_id = $11,
          -- Slice C — revert resets canary: the restored version starts
          -- tracking fresh signals from the moment of activation.
          canary_started_at = NOW(),
          canary_request_count = 0,
          canary_negative_count = 0,
          drift_flagged_at = NULL,
          drift_reason = NULL,
          drift_regression_streak = 0,
          drift_last_checked_at = NULL,
          updated_at = NOW()
        WHERE capability_id = $1 AND agent_id = $2
        RETURNING *
      `,
      [
        capabilityId,
        agentId,
        version.status,
        version.summary,
        JSON.stringify(version.highlights || []),
        version.contextBlock,
        version.sourceDocumentIds || [],
        version.sourceArtifactIds || [],
        version.sourceCount || 0,
        previousVersionId,
        version.versionId,
      ],
    );

    return {
      profile: learningProfileFromRow(updateResult.rows[0]),
      version,
    };
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

export const createOperatingPolicySnapshotTx = async (
  client: PoolClient,
  capabilityId: string,
  summary: string,
  triggeredByUserId?: string,
  chatMessageId?: string,
) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS operating_policy_snapshots (
      id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      operating_policy_summary TEXT NOT NULL,
      triggered_by_user_id TEXT,
      chat_message_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  
  const snapshotId = createId('OPSNAP');
  await client.query(`
    INSERT INTO operating_policy_snapshots (
      id, capability_id, operating_policy_summary, triggered_by_user_id, chat_message_id, created_at
    ) VALUES ($1, $2, $3, $4, $5, NOW())
  `, [snapshotId, capabilityId, summary, triggeredByUserId || null, chatMessageId || null]);
  return snapshotId;
};

export const createOperatingPolicySnapshot = async (
  capabilityId: string,
  summary: string,
  triggeredByUserId?: string,
  chatMessageId?: string,
) => transaction(async (client) => {
  return createOperatingPolicySnapshotTx(client, capabilityId, summary, triggeredByUserId, chatMessageId);
});

export const revertOperatingPolicyToSnapshot = async (
  capabilityId: string,
  snapshotId: string
) => transaction(async (client) => {
  const result = await client.query(`SELECT operating_policy_summary FROM operating_policy_snapshots WHERE capability_id = $1 AND id = $2`, [capabilityId, snapshotId]);
  if (!result.rowCount) throw new Error("Snapshot not found");
  const summary = result.rows[0].operating_policy_summary;
  await client.query(`UPDATE capabilities SET operating_policy_summary = $1, updated_at = NOW() WHERE id = $2`, [summary, capabilityId]);
  return summary;
});

export const getOperatingPolicySnapshots = async (capabilityId: string): Promise<OperatingPolicySnapshot[]> => {
  await query(`
    CREATE TABLE IF NOT EXISTS operating_policy_snapshots (
      id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      operating_policy_summary TEXT NOT NULL,
      triggered_by_user_id TEXT,
      chat_message_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const result = await query(
    `SELECT * FROM operating_policy_snapshots WHERE capability_id = $1 ORDER BY created_at DESC`,
    [capabilityId]
  );
  return result.rows.map(row => ({
    id: row.id,
    capabilityId: row.capability_id,
    operatingPolicySummary: row.operating_policy_summary,
    triggeredByUserId: row.triggered_by_user_id || undefined,
    chatMessageId: row.chat_message_id || undefined,
    createdAt: asIso(row.created_at)
  }));
};

// ─────────────────────────────────────────────────────────────────────────
// Slice B — evaluation fixtures for the LLM-judge quality gate.
// Fixtures are bootstrapped from recent high-signal agent messages so the
// judge has a known-good reference when scoring new profile versions.
// ─────────────────────────────────────────────────────────────────────────

export interface AgentEvalFixtureRecord {
  fixtureId: string;
  capabilityId: string;
  agentId: string;
  sourceSessionId?: string;
  prompt: string;
  referenceResponse?: string;
  expectedCriteria: string[];
  createdAt: string;
  lastUsedAt?: string;
}

const evalFixtureFromRow = (row: Record<string, any>): AgentEvalFixtureRecord => {
  const criteriaRaw = row.expected_criteria;
  let expectedCriteria: string[] = [];
  if (Array.isArray(criteriaRaw)) {
    expectedCriteria = criteriaRaw.filter((item): item is string => typeof item === 'string');
  } else if (typeof criteriaRaw === 'string' && criteriaRaw.length) {
    try {
      const parsed = JSON.parse(criteriaRaw);
      if (Array.isArray(parsed)) {
        expectedCriteria = parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      expectedCriteria = [];
    }
  }
  return {
    fixtureId: String(row.fixture_id),
    capabilityId: String(row.capability_id),
    agentId: String(row.agent_id),
    sourceSessionId: row.source_session_id ? String(row.source_session_id) : undefined,
    prompt: String(row.prompt || ''),
    referenceResponse: row.reference_response ? String(row.reference_response) : undefined,
    expectedCriteria,
    createdAt: asIso(row.created_at),
    lastUsedAt: row.last_used_at ? asIso(row.last_used_at) : undefined,
  };
};

export const listAgentEvalFixtures = async (
  capabilityId: string,
  agentId: string,
  options: { limit?: number } = {},
): Promise<AgentEvalFixtureRecord[]> => {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 40);
  const result = await query(
    `
      SELECT *
      FROM capability_agent_eval_fixtures
      WHERE capability_id = $1 AND agent_id = $2
      ORDER BY last_used_at NULLS FIRST, created_at ASC
      LIMIT $3
    `,
    [capabilityId, agentId, limit],
  );
  return result.rows.map(row => evalFixtureFromRow(row as Record<string, any>));
};

export const markEvalFixturesUsed = async (
  capabilityId: string,
  fixtureIds: string[],
): Promise<void> => {
  if (!fixtureIds.length) return;
  await query(
    `
      UPDATE capability_agent_eval_fixtures
      SET last_used_at = NOW()
      WHERE capability_id = $1 AND fixture_id = ANY($2::text[])
    `,
    [capabilityId, fixtureIds],
  );
};

export const insertAgentEvalFixture = async ({
  capabilityId,
  agentId,
  prompt,
  referenceResponse,
  expectedCriteria,
  sourceSessionId,
}: {
  capabilityId: string;
  agentId: string;
  prompt: string;
  referenceResponse?: string;
  expectedCriteria?: string[];
  sourceSessionId?: string;
}): Promise<AgentEvalFixtureRecord> => {
  const fixtureId = createId('EVFX');
  const result = await query(
    `
      INSERT INTO capability_agent_eval_fixtures (
        capability_id,
        fixture_id,
        agent_id,
        source_session_id,
        prompt,
        reference_response,
        expected_criteria,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      RETURNING *
    `,
    [
      capabilityId,
      fixtureId,
      agentId,
      sourceSessionId || null,
      prompt,
      referenceResponse || null,
      JSON.stringify(expectedCriteria || []),
    ],
  );
  return evalFixtureFromRow(result.rows[0] as Record<string, any>);
};

export const countAgentEvalFixtures = async (
  capabilityId: string,
  agentId: string,
): Promise<number> => {
  const result = await query(
    `
      SELECT COUNT(*)::int AS count
      FROM capability_agent_eval_fixtures
      WHERE capability_id = $1 AND agent_id = $2
    `,
    [capabilityId, agentId],
  );
  const countRow = result.rows[0] as { count?: number } | undefined;
  return Number(countRow?.count || 0);
};

/**
 * Best-effort bootstrap of eval fixtures for the judge gate. Pulls recent
 * user prompts + assistant replies from capability_messages for this agent
 * (limited to `maxFixtures`) and stores them as fixtures so the judge has
 * some reference data on the first post-migration refresh. Safe to call
 * repeatedly — it no-ops when the fixture count is already at target.
 */
export const bootstrapAgentEvalFixturesFromMessages = async ({
  capabilityId,
  agentId,
  targetCount = 10,
}: {
  capabilityId: string;
  agentId: string;
  targetCount?: number;
}): Promise<number> => {
  const existing = await countAgentEvalFixtures(capabilityId, agentId);
  if (existing >= targetCount) {
    return 0;
  }

  // Grab a window of recent agent messages + the immediately-preceding user
  // prompt. This is a heuristic seed; a follow-up pass can curate with
  // stronger positive-signal filters (no USER_CORRECTION follow-up, etc.).
  const agentMessages = await query(
    `
      SELECT id, content, created_at, session_id
      FROM capability_messages
      WHERE capability_id = $1 AND agent_id = $2 AND role = 'assistant'
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [capabilityId, agentId, targetCount * 3],
  );

  if (!agentMessages.rowCount) {
    return 0;
  }

  let inserted = 0;
  for (const row of agentMessages.rows as Array<Record<string, any>>) {
    if (existing + inserted >= targetCount) break;
    const assistantContent = String(row.content || '').trim();
    if (!assistantContent) continue;

    const priorResult = await query(
      `
        SELECT content
        FROM capability_messages
        WHERE capability_id = $1 AND role = 'user' AND created_at < $2
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [capabilityId, row.created_at],
    );
    const priorRow = priorResult.rows[0] as Record<string, any> | undefined;
    const prompt = String(priorRow?.content || '').trim();
    if (!prompt) continue;

    try {
      await insertAgentEvalFixture({
        capabilityId,
        agentId,
        prompt: prompt.slice(0, 4000),
        referenceResponse: assistantContent.slice(0, 6000),
        sourceSessionId: row.session_id ? String(row.session_id) : undefined,
      });
      inserted += 1;
    } catch {
      // Don't let a single insert failure block the rest; fixtures are a
      // best-effort seed.
    }
  }
  return inserted;
};
