import type {
  ActorContext,
  CapabilityExecutionOwnership,
  DesktopExecutorRegistration,
  ExecutorRegistryEntry,
  ExecutorRegistrySummary,
  ExecutionDispatchState,
  ExecutorHeartbeatStatus,
  WorkflowRunQueueReason,
} from '../src/types';
import { query } from './db';
import { listValidatedWorkspaceRootsByCapability } from './desktopWorkspaces';
import { normalizeDirectoryPath } from './workspacePaths';

const EXECUTOR_HEARTBEAT_TTL_MS = 45_000;

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value || '');

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

const asApprovedWorkspaceRootMap = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, string[]>;
  }

  return Object.fromEntries(
    Object.entries(value).map(([capabilityId, roots]) => [
      capabilityId,
      Array.from(
        new Set(
          (Array.isArray(roots) ? roots : [])
            .map(root => normalizeDirectoryPath(String(root || '')))
            .filter(Boolean),
        ),
      ),
    ]),
  );
};

const normalizeActorDisplayName = (actor?: ActorContext | null) =>
  String(actor?.displayName || 'Desktop Executor').trim() || 'Desktop Executor';

const normalizeActorTeamIds = (actor?: ActorContext | null) =>
  Array.from(
    new Set((actor?.teamIds || []).map(teamId => String(teamId || '').trim()).filter(Boolean)),
  );

const normalizeApprovedWorkspaceRoots = (
  capabilityRoots?: Record<string, string[]> | null,
) =>
  Object.fromEntries(
    Object.entries(capabilityRoots || {}).map(([capabilityId, roots]) => [
      capabilityId,
      Array.from(
        new Set(
          (roots || [])
            .map(root => normalizeDirectoryPath(String(root || '')))
            .filter(Boolean),
        ),
      ),
    ]),
  );

export const getExecutorHeartbeatStatus = (heartbeatAt?: string | null): ExecutorHeartbeatStatus => {
  if (!heartbeatAt) {
    return 'OFFLINE';
  }

  const heartbeatTime = new Date(heartbeatAt).getTime();
  if (!Number.isFinite(heartbeatTime)) {
    return 'OFFLINE';
  }

  return Date.now() - heartbeatTime <= EXECUTOR_HEARTBEAT_TTL_MS ? 'FRESH' : 'STALE';
};

const executorRegistrationFromRow = (
  row: Record<string, any>,
): DesktopExecutorRegistration => ({
  id: row.id,
  actorUserId: row.actor_user_id || undefined,
  actorDisplayName: row.actor_display_name,
  actorTeamIds: asStringArray(row.actor_team_ids),
  ownedCapabilityIds: asStringArray(row.owned_capability_ids),
  approvedWorkspaceRoots: asApprovedWorkspaceRootMap(row.approved_workspace_roots),
  heartbeatStatus: getExecutorHeartbeatStatus(asIso(row.heartbeat_at)),
  heartbeatAt: asIso(row.heartbeat_at),
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
  runtimeSummary:
    row.runtime_summary && typeof row.runtime_summary === 'object'
      ? row.runtime_summary
      : undefined,
});

const capabilityExecutionOwnershipFromRow = (
  row: Record<string, any>,
): CapabilityExecutionOwnership => ({
  capabilityId: row.capability_id,
  executorId: row.executor_id,
  actorUserId: row.actor_user_id || undefined,
  actorDisplayName: row.actor_display_name,
  actorTeamIds: asStringArray(row.actor_team_ids),
  approvedWorkspaceRoots: asStringArray(row.approved_workspace_roots),
  heartbeatStatus: getExecutorHeartbeatStatus(asIso(row.heartbeat_at)),
  claimedAt: asIso(row.claimed_at),
  heartbeatAt: asIso(row.heartbeat_at),
  updatedAt: asIso(row.updated_at),
});

export const getExecutionRuntimeMode = () =>
  process.env.EXECUTION_RUNTIME_MODE === 'server' ? 'server' : 'desktop';

export const isDesktopExecutionRuntime = () => getExecutionRuntimeMode() === 'desktop';

const listOwnedCapabilityIdsForExecutorInternal = async (
  executorId: string,
): Promise<string[]> => {
  const result = await query<{ capability_id: string }>(
    `
      SELECT capability_id
      FROM capability_execution_ownership
      WHERE executor_id = $1
      ORDER BY capability_id ASC
    `,
    [executorId],
  );

  return result.rows
    .map(row => String(row.capability_id || '').trim())
    .filter(Boolean);
};

export const registerDesktopExecutor = async ({
  executorId,
  actor,
  approvedWorkspaceRoots,
  runtimeSummary,
}: {
  executorId: string;
  actor?: ActorContext | null;
  approvedWorkspaceRoots?: Record<string, string[]>;
  runtimeSummary?: Record<string, unknown>;
}): Promise<DesktopExecutorRegistration> => {
  const existingRegistration = await getDesktopExecutorRegistration(executorId);
  if (
    existingRegistration?.actorUserId &&
    actor?.userId &&
    existingRegistration.actorUserId !== actor.userId
  ) {
    throw new Error('This desktop executor is already registered for a different workspace operator.');
  }

  // Resolve roots from the user's mappings — preferring the request's
  // userId, but falling back to the registration's persisted userId so a
  // brief anonymous heartbeat (caused by a renderer re-render) doesn't
  // wipe approved_workspace_roots to {}. Only when neither is available
  // do we trust the caller-supplied map, which the worker normally sends
  // as `{}` anyway.
  const userIdForRootLookup = actor?.userId || existingRegistration?.actorUserId;
  const normalizedRoots = userIdForRootLookup
    ? normalizeApprovedWorkspaceRoots(
        await listValidatedWorkspaceRootsByCapability({
          executorId,
          userId: userIdForRootLookup,
        }),
      )
    : normalizeApprovedWorkspaceRoots(approvedWorkspaceRoots);
  const ownedCapabilityIds =
    await listOwnedCapabilityIdsForExecutorInternal(executorId);
  const result = await query(
    `
      INSERT INTO desktop_executor_registrations (
        id,
        actor_user_id,
        actor_display_name,
        actor_team_ids,
        owned_capability_ids,
        approved_workspace_roots,
        runtime_summary,
        heartbeat_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      ON CONFLICT (id) DO UPDATE SET
        -- Preserve actor identity on anonymous heartbeats. The renderer's
        -- React effect can briefly publish an actor with no userId between
        -- two real-user pushes (e.g. while workspaceOrganization is being
        -- refetched). Without COALESCE the row would flap NULL ↔ user-id
        -- every few seconds and approved_workspace_roots — which is keyed
        -- on userId — would be wiped to {}.
        actor_user_id = COALESCE(
          EXCLUDED.actor_user_id,
          desktop_executor_registrations.actor_user_id
        ),
        actor_display_name = CASE
          WHEN EXCLUDED.actor_user_id IS NULL
               AND desktop_executor_registrations.actor_user_id IS NOT NULL
            THEN desktop_executor_registrations.actor_display_name
          ELSE EXCLUDED.actor_display_name
        END,
        actor_team_ids = CASE
          WHEN EXCLUDED.actor_user_id IS NULL
               AND desktop_executor_registrations.actor_user_id IS NOT NULL
            THEN desktop_executor_registrations.actor_team_ids
          ELSE EXCLUDED.actor_team_ids
        END,
        approved_workspace_roots = CASE
          WHEN EXCLUDED.approved_workspace_roots = '{}'::jsonb
            THEN desktop_executor_registrations.approved_workspace_roots
          ELSE EXCLUDED.approved_workspace_roots
        END,
        owned_capability_ids = EXCLUDED.owned_capability_ids,
        runtime_summary = EXCLUDED.runtime_summary,
        heartbeat_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `,
    [
      executorId,
      actor?.userId || null,
      normalizeActorDisplayName(actor),
      normalizeActorTeamIds(actor),
      ownedCapabilityIds,
      JSON.stringify(normalizedRoots),
      JSON.stringify(runtimeSummary || {}),
    ],
  );

  await query(
    `
      UPDATE capability_execution_ownership
      SET
        heartbeat_at = NOW(),
        updated_at = NOW()
      WHERE executor_id = $1
    `,
    [executorId],
  );

  return executorRegistrationFromRow(result.rows[0]);
};

export const heartbeatDesktopExecutor = async ({
  executorId,
  actor,
  approvedWorkspaceRoots,
  runtimeSummary,
}: {
  executorId: string;
  actor?: ActorContext | null;
  approvedWorkspaceRoots?: Record<string, string[]>;
  runtimeSummary?: Record<string, unknown>;
}): Promise<DesktopExecutorRegistration> =>
  registerDesktopExecutor({
    executorId,
    actor,
    approvedWorkspaceRoots,
    runtimeSummary,
  });

export const getDesktopExecutorRegistration = async (
  executorId: string,
): Promise<DesktopExecutorRegistration | null> => {
  const result = await query(
    `
      SELECT *
      FROM desktop_executor_registrations
      WHERE id = $1
    `,
    [executorId],
  );

  return result.rowCount ? executorRegistrationFromRow(result.rows[0]) : null;
};

export const listDesktopExecutorRegistrations = async (): Promise<DesktopExecutorRegistration[]> => {
  const result = await query(
    `
      SELECT *
      FROM desktop_executor_registrations
      ORDER BY updated_at DESC, id ASC
    `,
  );

  return result.rows.map(executorRegistrationFromRow);
};

export const unregisterDesktopExecutor = async (executorId: string): Promise<void> => {
  const ownedCapabilityRows = await query<{ capability_id: string }>(
    `
      DELETE FROM capability_execution_ownership
      WHERE executor_id = $1
      RETURNING capability_id
    `,
    [executorId],
  );

  for (const row of ownedCapabilityRows.rows) {
    const capabilityId = String(row.capability_id || '').trim();
    if (!capabilityId) {
      continue;
    }

    await query(
      `
        UPDATE capability_workflow_runs
        SET
          status = CASE
            WHEN status IN ('RUNNING', 'PAUSED') THEN 'QUEUED'
            ELSE status
          END,
          queue_reason = CASE
            WHEN status IN ('QUEUED', 'RUNNING', 'PAUSED') THEN 'EXECUTOR_DISCONNECTED'
            ELSE queue_reason
          END,
          assigned_executor_id = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = NOW()
        WHERE capability_id = $1
          AND assigned_executor_id = $2
          AND status IN ('QUEUED', 'RUNNING', 'PAUSED', 'WAITING_APPROVAL', 'WAITING_HUMAN_TASK', 'WAITING_INPUT', 'WAITING_CONFLICT')
      `,
      [capabilityId, executorId],
    );
  }

  await query(
    `
      DELETE FROM desktop_executor_registrations
      WHERE id = $1
    `,
    [executorId],
  );
};

export const getCapabilityExecutionOwnership = async (
  capabilityId: string,
): Promise<CapabilityExecutionOwnership | null> => {
  const result = await query(
    `
      SELECT *
      FROM capability_execution_ownership
      WHERE capability_id = $1
    `,
    [capabilityId],
  );

  return result.rowCount ? capabilityExecutionOwnershipFromRow(result.rows[0]) : null;
};

export const listCapabilityExecutionOwnerships = async (): Promise<
  CapabilityExecutionOwnership[]
> => {
  const result = await query(
    `
      SELECT *
      FROM capability_execution_ownership
      ORDER BY updated_at DESC, capability_id ASC
    `,
  );

  return result.rows.map(capabilityExecutionOwnershipFromRow);
};

export const listOwnedCapabilityIdsForExecutor = async (
  executorId: string,
): Promise<string[]> => listOwnedCapabilityIdsForExecutorInternal(executorId);

export const buildExecutorRegistrySummary = async (): Promise<ExecutorRegistrySummary> => {
  await reconcileDesktopExecutionOwnerships();
  const [registrations, capabilityResult, runCountsResult] = await Promise.all([
    listDesktopExecutorRegistrations(),
    query<{ id: string; name: string }>(
      `
        SELECT id, name
        FROM capabilities
      `,
    ),
    query<{
      executor_id: string;
      capability_id: string;
      active_run_count: string;
      queued_run_count: string;
      total_count: string;
    }>(
      `
        SELECT
          assigned_executor_id AS executor_id,
          capability_id,
          COUNT(*) FILTER (
            WHERE status IN ('RUNNING', 'PAUSED', 'WAITING_APPROVAL', 'WAITING_HUMAN_TASK', 'WAITING_INPUT', 'WAITING_CONFLICT')
          )::text AS active_run_count,
          COUNT(*) FILTER (WHERE status = 'QUEUED')::text AS queued_run_count,
          COUNT(*)::text AS total_count
        FROM capability_workflow_runs
        WHERE assigned_executor_id IS NOT NULL
        GROUP BY assigned_executor_id, capability_id
      `,
    ),
  ]);

  const capabilityNamesById = new Map(
    capabilityResult.rows.map(row => [String(row.id || '').trim(), String(row.name || '').trim()]),
  );
  const runCountsByExecutor = new Map<
    string,
    Map<string, { activeRunCount: number; queuedRunCount: number; totalCount: number }>
  >();

  for (const row of runCountsResult.rows) {
    const executorId = String(row.executor_id || '').trim();
    const capabilityId = String(row.capability_id || '').trim();
    if (!executorId || !capabilityId) {
      continue;
    }

    const counts = {
      activeRunCount: Number(row.active_run_count || 0),
      queuedRunCount: Number(row.queued_run_count || 0),
      totalCount: Number(row.total_count || 0),
    };
    const byCapability = runCountsByExecutor.get(executorId) || new Map();
    byCapability.set(capabilityId, counts);
    runCountsByExecutor.set(executorId, byCapability);
  }

  const entries: ExecutorRegistryEntry[] = registrations.map(registration => {
    const runCounts = runCountsByExecutor.get(registration.id) || new Map();
    const ownedCapabilities = registration.ownedCapabilityIds.map(capabilityId => {
      const counts = runCounts.get(capabilityId);
      return {
        capabilityId,
        capabilityName: capabilityNamesById.get(capabilityId) || capabilityId,
        approvedWorkspaceRoots: registration.approvedWorkspaceRoots?.[capabilityId] || [],
        activeRunCount: counts?.activeRunCount || 0,
        queuedRunCount: counts?.queuedRunCount || 0,
      };
    });

    return {
      registration,
      runAssignmentCount: Array.from(runCounts.values()).reduce(
        (total, counts) => total + counts.totalCount,
        0,
      ),
      ownedCapabilities,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    entries,
    activeCount: entries.filter(entry => entry.registration.heartbeatStatus === 'FRESH').length,
    staleCount: entries.filter(entry => entry.registration.heartbeatStatus === 'STALE').length,
    disconnectedCount: entries.filter(entry => entry.registration.heartbeatStatus === 'OFFLINE')
      .length,
  };
};

const removeCapabilityFromExecutor = async (executorId: string, capabilityId: string) => {
  await query(
    `
      UPDATE desktop_executor_registrations
      SET
        owned_capability_ids = array_remove(owned_capability_ids, $2),
        updated_at = NOW()
      WHERE id = $1
    `,
    [executorId, capabilityId],
  );
};

const addCapabilityToExecutor = async (executorId: string, capabilityId: string) => {
  await query(
    `
      UPDATE desktop_executor_registrations
      SET
        owned_capability_ids = (
          SELECT ARRAY(
            SELECT DISTINCT item
            FROM unnest(array_append(owned_capability_ids, $2)) AS item
          )
        ),
        updated_at = NOW()
      WHERE id = $1
    `,
    [executorId, capabilityId],
  );
};

export const reconcileDesktopExecutionOwnerships = async (): Promise<void> => {
  const staleExecutors = await query<{ id: string }>(
    `
      SELECT id
      FROM desktop_executor_registrations
      WHERE heartbeat_at < NOW() - ($1 * INTERVAL '1 millisecond')
    `,
    [EXECUTOR_HEARTBEAT_TTL_MS],
  );

  for (const row of staleExecutors.rows) {
    const executorId = String(row.id || '').trim();
    if (!executorId) {
      continue;
    }

    const ownedCapabilityRows = await query<{ capability_id: string }>(
      `
        DELETE FROM capability_execution_ownership
        WHERE executor_id = $1
        RETURNING capability_id
      `,
      [executorId],
    );

    for (const capabilityRow of ownedCapabilityRows.rows) {
      const capabilityId = String(capabilityRow.capability_id || '').trim();
      if (!capabilityId) {
        continue;
      }

      // Move orphaned runs back to QUEUED and capture which run IDs were
      // affected so we can transition any stuck RUNNING steps below.
      const requeued = await query<{ id: string }>(
        `
          UPDATE capability_workflow_runs
          SET
            status = CASE
              WHEN status IN ('RUNNING', 'PAUSED') THEN 'QUEUED'
              ELSE status
            END,
            queue_reason = CASE
              WHEN status IN ('QUEUED', 'RUNNING', 'PAUSED') THEN 'EXECUTOR_DISCONNECTED'
              ELSE queue_reason
            END,
            assigned_executor_id = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
          WHERE capability_id = $1
            AND assigned_executor_id = $2
            AND status IN ('QUEUED', 'RUNNING', 'PAUSED', 'WAITING_APPROVAL', 'WAITING_HUMAN_TASK', 'WAITING_INPUT', 'WAITING_CONFLICT')
          RETURNING id
        `,
        [capabilityId, executorId],
      );

      // Fail any steps that were mid-execution when the executor died.
      // A step cannot safely resume from an arbitrary mid-point; marking
      // it FAILED surfaces the problem immediately rather than leaving it
      // stuck in RUNNING indefinitely. The run itself is QUEUED so the
      // next executor will restart execution from the beginning of the
      // pending steps.
      const requeuedRunIds = requeued.rows
        .map(r => String(r.id || '').trim())
        .filter(Boolean);
      if (requeuedRunIds.length > 0) {
        await query(
          `
            UPDATE capability_workflow_run_steps
            SET
              status = 'FAILED',
              output_summary = 'Executor disconnected while this step was running. '
                || 'The run has been requeued and execution will restart.',
              completed_at = NOW(),
              updated_at = NOW()
            WHERE capability_id = $1
              AND run_id = ANY($2::text[])
              AND status = 'RUNNING'
          `,
          [capabilityId, requeuedRunIds],
        );
      }

      await removeCapabilityFromExecutor(executorId, capabilityId);
    }
  }
};

export const claimCapabilityExecution = async ({
  capabilityId,
  executorId,
  actor,
  approvedWorkspaceRoots,
  forceTakeover = false,
}: {
  capabilityId: string;
  executorId: string;
  actor?: ActorContext | null;
  approvedWorkspaceRoots: string[];
  forceTakeover?: boolean;
}): Promise<CapabilityExecutionOwnership> => {
  await reconcileDesktopExecutionOwnerships();

  const registration = await getDesktopExecutorRegistration(executorId);
  if (!registration) {
    throw new Error('The desktop executor is not registered yet.');
  }

  if (actor?.userId && registration.actorUserId && registration.actorUserId !== actor.userId) {
    throw new Error('The desktop executor is registered for a different workspace operator.');
  }

  // Use the caller-supplied desktop workspace roots directly.  The route
  // handler already builds this list server-side (including the
  // executor's workingDir fallback when no
  // per-capability mapping exists), so re-querying here would discard
  // that fallback and cause a spurious "no desktop workspace root"
  // error even when the operator has set a working directory.
  const normalizedRoots = Array.from(
    new Set(
      approvedWorkspaceRoots.map(root => normalizeDirectoryPath(root)).filter(Boolean),
    ),
  );
  if (normalizedRoots.length === 0) {
    throw new Error(
      'This desktop operator does not have a validated workspace root for the selected capability.',
    );
  }

  const currentOwnership = await getCapabilityExecutionOwnership(capabilityId);
  if (
    currentOwnership &&
    currentOwnership.executorId !== executorId &&
    currentOwnership.heartbeatStatus === 'FRESH' &&
    !forceTakeover
  ) {
    throw new Error(
      `${currentOwnership.actorDisplayName} already owns execution for this capability. Use takeover to replace that desktop owner.`,
    );
  }

  const result = await query(
    `
      INSERT INTO capability_execution_ownership (
        capability_id,
        executor_id,
        actor_user_id,
        actor_display_name,
        actor_team_ids,
        approved_workspace_roots,
        claimed_at,
        heartbeat_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW(),NOW())
      ON CONFLICT (capability_id) DO UPDATE SET
        executor_id = EXCLUDED.executor_id,
        actor_user_id = EXCLUDED.actor_user_id,
        actor_display_name = EXCLUDED.actor_display_name,
        actor_team_ids = EXCLUDED.actor_team_ids,
        approved_workspace_roots = EXCLUDED.approved_workspace_roots,
        claimed_at = NOW(),
        heartbeat_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `,
    [
      capabilityId,
      executorId,
      actor?.userId || registration.actorUserId || null,
      normalizeActorDisplayName(actor) || registration.actorDisplayName,
      normalizeActorTeamIds(actor).length
        ? normalizeActorTeamIds(actor)
        : registration.actorTeamIds,
      normalizedRoots,
    ],
  );

  if (currentOwnership?.executorId && currentOwnership.executorId !== executorId) {
    await removeCapabilityFromExecutor(currentOwnership.executorId, capabilityId);
  }

  await addCapabilityToExecutor(executorId, capabilityId);

  await query(
    `
      UPDATE capability_workflow_runs
      SET
        assigned_executor_id = $2,
        queue_reason = CASE
          WHEN status = 'QUEUED' THEN NULL
          ELSE queue_reason
        END,
        updated_at = NOW()
      WHERE capability_id = $1
        AND status = 'QUEUED'
    `,
    [capabilityId, executorId],
  );

  return capabilityExecutionOwnershipFromRow(result.rows[0]);
};

export const releaseCapabilityExecution = async ({
  capabilityId,
  executorId,
}: {
  capabilityId: string;
  executorId: string;
}): Promise<void> => {
  await query(
    `
      DELETE FROM capability_execution_ownership
      WHERE capability_id = $1 AND executor_id = $2
    `,
    [capabilityId, executorId],
  );

  await removeCapabilityFromExecutor(executorId, capabilityId);

  await query(
    `
      UPDATE capability_workflow_runs
      SET
        status = CASE
          WHEN status IN ('RUNNING', 'PAUSED') THEN 'QUEUED'
          ELSE status
        END,
        queue_reason = CASE
          WHEN status IN ('QUEUED', 'RUNNING', 'PAUSED') THEN 'EXECUTOR_RELEASED'
          ELSE queue_reason
        END,
        assigned_executor_id = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
      WHERE capability_id = $1
        AND assigned_executor_id = $2
        AND status IN ('QUEUED', 'RUNNING', 'PAUSED', 'WAITING_APPROVAL', 'WAITING_HUMAN_TASK', 'WAITING_INPUT', 'WAITING_CONFLICT')
    `,
    [capabilityId, executorId],
  );
};

export const buildCapabilityExecutionSurface = async ({
  capabilityId,
  queueReason,
}: {
  capabilityId: string;
  queueReason?: WorkflowRunQueueReason;
}): Promise<{
  executionOwnership: CapabilityExecutionOwnership | null;
  executionDispatchState: ExecutionDispatchState;
  executionQueueReason?: WorkflowRunQueueReason;
}> => {
  await reconcileDesktopExecutionOwnerships();
  const ownership = await getCapabilityExecutionOwnership(capabilityId);

  if (ownership?.heartbeatStatus === 'FRESH') {
    return {
      executionOwnership: ownership,
      executionDispatchState: 'ASSIGNED',
      executionQueueReason: queueReason,
    };
  }

  if (queueReason === 'EXECUTOR_DISCONNECTED') {
    return {
      executionOwnership: ownership,
      executionDispatchState: 'STALE_EXECUTOR',
      executionQueueReason: queueReason,
    };
  }

  if (queueReason === 'WAITING_FOR_EXECUTOR' || queueReason === 'EXECUTOR_RELEASED') {
    return {
      executionOwnership: ownership,
      executionDispatchState: 'WAITING_FOR_EXECUTOR',
      executionQueueReason: queueReason,
    };
  }

  return {
    executionOwnership: ownership,
    executionDispatchState: ownership ? 'STALE_EXECUTOR' : 'UNASSIGNED',
    executionQueueReason: queueReason,
  };
};

export const resolveQueuedRunDispatch = async ({
  capabilityId,
}: {
  capabilityId: string;
}): Promise<{
  assignedExecutorId?: string;
  queueReason?: WorkflowRunQueueReason;
}> => {
  await reconcileDesktopExecutionOwnerships();
  const ownership = await getCapabilityExecutionOwnership(capabilityId);

  if (ownership?.heartbeatStatus === 'FRESH') {
    return {
      assignedExecutorId: ownership.executorId,
      queueReason: undefined,
    };
  }

  return {
    assignedExecutorId: undefined,
    queueReason: 'WAITING_FOR_EXECUTOR',
  };
};

export const getExecutorHeartbeatTtlMs = () => EXECUTOR_HEARTBEAT_TTL_MS;
