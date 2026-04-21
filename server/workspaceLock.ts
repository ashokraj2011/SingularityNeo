import { query } from './db';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class WorkspaceLockConflictError extends Error {
  constructor(
    public readonly holder: {
      agentId: string;
      stepName: string;
      runId: string;
      expiresAt: string;
    },
  ) {
    super(
      `WRITE_CONTROL lock held by agent "${holder.agentId}" (step: ${holder.stepName}) ` +
        `until ${holder.expiresAt}. Wait and retry.`,
    );
    this.name = 'WorkspaceLockConflictError';
  }
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

interface LockRow {
  runStepId: string;
  runId: string;
  agentId: string;
  stepName: string;
  acquiredAt: string;
  expiresAt: string;
}

const rowToLock = (row: Record<string, unknown>): LockRow => ({
  runStepId: String(row.run_step_id || ''),
  runId: String(row.run_id || ''),
  agentId: String(row.agent_id || ''),
  stepName: String(row.step_name || ''),
  acquiredAt: row.acquired_at instanceof Date ? row.acquired_at.toISOString() : String(row.acquired_at || ''),
  expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at || ''),
});

// ---------------------------------------------------------------------------
// acquireWorkspaceWriteLock
//
// Atomic upsert via INSERT ... ON CONFLICT DO UPDATE WHERE (expires_at < NOW()
// OR run_step_id = EXCLUDED.run_step_id).
//
// If the existing row is unexpired AND belongs to a different run_step_id,
// the ON CONFLICT DO UPDATE's WHERE clause is false → Postgres skips the
// update and returns 0 rows from RETURNING → we read the current holder and
// throw WorkspaceLockConflictError.
// ---------------------------------------------------------------------------

export const acquireWorkspaceWriteLock = async (params: {
  capabilityId: string;
  runStepId: string;
  runId: string;
  agentId: string;
  stepName: string;
}): Promise<void> => {
  const { capabilityId, runStepId, runId, agentId, stepName } = params;

  const result = await query(
    `
    INSERT INTO capability_workspace_write_locks
      (capability_id, run_step_id, run_id, agent_id, step_name, acquired_at, expires_at)
    VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '5 minutes')
    ON CONFLICT (capability_id) DO UPDATE
      SET run_step_id = EXCLUDED.run_step_id,
          run_id      = EXCLUDED.run_id,
          agent_id    = EXCLUDED.agent_id,
          step_name   = EXCLUDED.step_name,
          acquired_at = NOW(),
          expires_at  = NOW() + INTERVAL '5 minutes'
      WHERE capability_workspace_write_locks.expires_at < NOW()
         OR capability_workspace_write_locks.run_step_id = EXCLUDED.run_step_id
    RETURNING capability_id
    `,
    [capabilityId, runStepId, runId, agentId, stepName],
  );

  if (result.rows.length === 0) {
    // Lock is held by a different, unexpired run_step — read current holder
    const holderResult = await query(
      `SELECT run_step_id, run_id, agent_id, step_name, acquired_at, expires_at
       FROM capability_workspace_write_locks
       WHERE capability_id = $1`,
      [capabilityId],
    );
    if (holderResult.rows.length > 0) {
      const holder = rowToLock(holderResult.rows[0] as Record<string, unknown>);
      throw new WorkspaceLockConflictError({
        agentId: holder.agentId,
        stepName: holder.stepName,
        runId: holder.runId,
        expiresAt: holder.expiresAt,
      });
    }
    // Race: lock disappeared between our INSERT and SELECT — safe to proceed
  }
};

// ---------------------------------------------------------------------------
// releaseWorkspaceWriteLock
//
// Only releases the lock if the caller still owns it (run_step_id match).
// A no-op if the row is already gone (e.g. expired and superseded).
// ---------------------------------------------------------------------------

export const releaseWorkspaceWriteLock = async (params: {
  capabilityId: string;
  runStepId: string;
}): Promise<void> => {
  const { capabilityId, runStepId } = params;
  await query(
    `DELETE FROM capability_workspace_write_locks
     WHERE capability_id = $1 AND run_step_id = $2`,
    [capabilityId, runStepId],
  );
};

// ---------------------------------------------------------------------------
// getWorkspaceWriteLock
// ---------------------------------------------------------------------------

export const getWorkspaceWriteLock = async (
  capabilityId: string,
): Promise<LockRow | null> => {
  const result = await query(
    `SELECT run_step_id, run_id, agent_id, step_name, acquired_at, expires_at
     FROM capability_workspace_write_locks
     WHERE capability_id = $1`,
    [capabilityId],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return rowToLock(result.rows[0] as Record<string, unknown>);
};
