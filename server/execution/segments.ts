/**
 * Phase-Segment workflow model — CRUD and status aggregation.
 *
 * A "segment" is an operator-scoped advance of a work item across a
 * contiguous phase range. One segment spawns N runs (retries share the
 * segment's intention). See the approved plan (Phase-Segment Workflow
 * Model) for the full conceptual model.
 *
 * Ownership:
 *   - This module owns the `capability_work_item_segments` table.
 *   - It also owns the mapping between run status transitions and
 *     segment-level status (§3d). All run-status writes that go through
 *     `updateWorkflowRun` should also go through `mirrorRunStatusToSegment`.
 *
 * Everything here is DB-only; execution orchestration lives in
 * `server/execution/service.ts`, which calls into this module at three
 * seams: segment creation, run-status transition mirror, and
 * stop-at-phase halt.
 */

import type { PoolClient } from 'pg';
import type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkItem,
  WorkItemPhase,
  WorkItemSegment,
  WorkItemSegmentStatus,
} from '../../src/types';
import { query, transaction } from '../db';

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value || '');

const createSegmentId = () =>
  `SEG-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const normalizePriority = (
  value: unknown,
): 'High' | 'Med' | 'Low' => {
  const raw = String(value || '').trim();
  if (raw === 'High' || raw === 'Med' || raw === 'Low') {
    return raw;
  }
  return 'Med';
};

const segmentFromRow = (row: Record<string, any>): WorkItemSegment => ({
  id: row.id,
  capabilityId: row.capability_id,
  workItemId: row.work_item_id,
  segmentIndex: Number(row.segment_index || 1),
  startPhase: row.start_phase,
  stopAfterPhase: row.stop_after_phase || undefined,
  intention: row.intention,
  status: row.status,
  terminalOutcome: row.terminal_outcome || undefined,
  prioritySnapshot: normalizePriority(row.priority_snapshot),
  currentRunId: row.current_run_id || undefined,
  firstRunId: row.first_run_id || undefined,
  attemptCount: Number(row.attempt_count || 0),
  actorUserId: row.actor_user_id || undefined,
  startedAt: row.started_at ? asIso(row.started_at) : undefined,
  completedAt: row.completed_at ? asIso(row.completed_at) : undefined,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
});

/**
 * Create a new segment row. Caller is responsible for creating the
 * associated run via `createWorkflowRun` (and wiring `segment_id` into
 * that run). The first run's id should be written back via
 * `attachFirstRunToSegment` immediately after.
 */
export const createSegment = async ({
  capabilityId,
  workItem,
  startPhase,
  stopAfterPhase,
  intention,
  actorUserId,
}: {
  capabilityId: string;
  workItem: WorkItem;
  startPhase: WorkItemPhase;
  stopAfterPhase?: WorkItemPhase | null;
  intention: string;
  actorUserId?: string;
}): Promise<WorkItemSegment> =>
  transaction(async client => {
    const nextIndexResult = await client.query<{ next_index: number }>(
      `
        SELECT COALESCE(MAX(segment_index), 0) + 1 AS next_index
        FROM capability_work_item_segments
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [capabilityId, workItem.id],
    );
    const segmentIndex = Number(nextIndexResult.rows[0]?.next_index || 1);
    const segmentId = createSegmentId();
    const prioritySnapshot = normalizePriority(workItem.priority);

    const result = await client.query(
      `
        INSERT INTO capability_work_item_segments (
          capability_id,
          id,
          work_item_id,
          segment_index,
          start_phase,
          stop_after_phase,
          intention,
          status,
          priority_snapshot,
          attempt_count,
          actor_user_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,'QUEUED',$8,0,$9)
        RETURNING *
      `,
      [
        capabilityId,
        segmentId,
        workItem.id,
        segmentIndex,
        startPhase,
        stopAfterPhase || null,
        intention,
        prioritySnapshot,
        actorUserId || null,
      ],
    );

    return segmentFromRow(result.rows[0]);
  });

/**
 * Called right after `createWorkflowRun` for a new segment. Sets both
 * `first_run_id` and `current_run_id`, bumps `attempt_count` to 1, and
 * advances segment status to match the newly created run's status
 * (typically QUEUED). Safe to call multiple times; only the first call
 * sets `first_run_id`.
 */
export const attachFirstRunToSegment = async ({
  capabilityId,
  segmentId,
  runId,
  initialStatus,
}: {
  capabilityId: string;
  segmentId: string;
  runId: string;
  initialStatus: WorkflowRunStatus;
}): Promise<void> => {
  const segmentStatus = mapRunStatusToSegmentStatus(initialStatus);
  await query(
    `
      UPDATE capability_work_item_segments
      SET
        first_run_id = COALESCE(first_run_id, $3),
        current_run_id = $3,
        attempt_count = GREATEST(attempt_count, 1),
        status = $4,
        started_at = COALESCE(started_at, NOW()),
        updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
    `,
    [capabilityId, segmentId, runId, segmentStatus],
  );
};

/**
 * Called when a retry is triggered for a FAILED/CANCELLED segment. New
 * run has already been created; this bumps `attempt_count` and sets the
 * segment status to match the new run's initial status.
 */
export const attachRetryRunToSegment = async ({
  capabilityId,
  segmentId,
  runId,
  initialStatus,
}: {
  capabilityId: string;
  segmentId: string;
  runId: string;
  initialStatus: WorkflowRunStatus;
}): Promise<void> => {
  const segmentStatus = mapRunStatusToSegmentStatus(initialStatus);
  await query(
    `
      UPDATE capability_work_item_segments
      SET
        current_run_id = $3,
        attempt_count = attempt_count + 1,
        status = $4,
        terminal_outcome = NULL,
        completed_at = NULL,
        updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
    `,
    [capabilityId, segmentId, runId, segmentStatus],
  );
};

/**
 * Translate a run-level status into the segment-level status. The
 * segment collapses all WAITING_* statuses into a single "WAITING" bucket
 * since, at the segment level, the difference between "waiting for
 * approval" vs "waiting for input" vs "waiting for conflict resolution"
 * is only interesting to the operate panel, not the inbox queue.
 */
export const mapRunStatusToSegmentStatus = (
  runStatus: WorkflowRunStatus,
): WorkItemSegmentStatus => {
  switch (runStatus) {
    case 'QUEUED':
      return 'QUEUED';
    case 'RUNNING':
      return 'RUNNING';
    case 'PAUSED':
      return 'WAITING';
    case 'WAITING_APPROVAL':
    case 'WAITING_INPUT':
    case 'WAITING_CONFLICT':
      return 'WAITING';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'QUEUED';
  }
};

/**
 * Mirror a run status transition onto the owning segment. This runs
 * after every `updateWorkflowRun`. No-op for runs that have no
 * `segmentId` (legacy runs that predate the migration). Separate path
 * `markSegmentComplete` is called for the stop-at-phase seam because
 * the run's own terminal_outcome is SEGMENT_COMPLETE rather than a
 * natural COMPLETE.
 */
export const mirrorRunStatusToSegment = async (run: WorkflowRun): Promise<void> => {
  if (!run.segmentId) return;
  const segmentStatus = mapRunStatusToSegmentStatus(run.status);
  const isTerminal =
    run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED';
  await query(
    `
      UPDATE capability_work_item_segments
      SET
        status = $3,
        terminal_outcome = CASE WHEN $4::boolean THEN $5 ELSE terminal_outcome END,
        completed_at = CASE WHEN $4::boolean THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
        updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
    `,
    [
      run.capabilityId,
      run.segmentId,
      segmentStatus,
      isTerminal,
      run.terminalOutcome || null,
    ],
  );
};

/**
 * Called from the stop-at-phase seam (§3a). The run is COMPLETED with
 * terminal_outcome = 'SEGMENT_COMPLETE'; the segment should mirror
 * that directly.
 */
export const markSegmentComplete = async ({
  capabilityId,
  segmentId,
  terminalOutcome,
}: {
  capabilityId: string;
  segmentId: string;
  terminalOutcome: string;
}): Promise<void> => {
  await query(
    `
      UPDATE capability_work_item_segments
      SET
        status = 'COMPLETED',
        terminal_outcome = $3,
        completed_at = COALESCE(completed_at, NOW()),
        updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
    `,
    [capabilityId, segmentId, terminalOutcome],
  );
};

export const getSegmentById = async ({
  capabilityId,
  segmentId,
}: {
  capabilityId: string;
  segmentId: string;
}): Promise<WorkItemSegment | null> => {
  const result = await query(
    `
      SELECT *
      FROM capability_work_item_segments
      WHERE capability_id = $1 AND id = $2
      LIMIT 1
    `,
    [capabilityId, segmentId],
  );
  return result.rowCount ? segmentFromRow(result.rows[0]) : null;
};

export const getSegmentForRun = async (run: WorkflowRun): Promise<WorkItemSegment | null> => {
  if (!run.segmentId) return null;
  return getSegmentById({ capabilityId: run.capabilityId, segmentId: run.segmentId });
};

export const listSegmentsForWorkItem = async ({
  capabilityId,
  workItemId,
}: {
  capabilityId: string;
  workItemId: string;
}): Promise<WorkItemSegment[]> => {
  const result = await query(
    `
      SELECT *
      FROM capability_work_item_segments
      WHERE capability_id = $1 AND work_item_id = $2
      ORDER BY segment_index DESC
    `,
    [capabilityId, workItemId],
  );
  return result.rows.map(segmentFromRow);
};

/**
 * When a work item's priority changes, propagate the new priority to
 * (a) the priority_snapshot on all of its non-terminal segments, and
 * (b) the priority_snapshot on all of its non-terminal runs. This keeps
 * the claim SQL's ORDER BY in sync with operator intent without needing
 * a trigger.
 */
export const propagatePriorityChange = async ({
  capabilityId,
  workItemId,
  newPriority,
}: {
  capabilityId: string;
  workItemId: string;
  newPriority: string;
}): Promise<void> => {
  const normalized = normalizePriority(newPriority);
  await transaction(async client => {
    await client.query(
      `
        UPDATE capability_work_item_segments
        SET priority_snapshot = $3, updated_at = NOW()
        WHERE capability_id = $1 AND work_item_id = $2
          AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
      `,
      [capabilityId, workItemId, normalized],
    );
    await client.query(
      `
        UPDATE capability_workflow_runs
        SET priority_snapshot = $3, updated_at = NOW()
        WHERE capability_id = $1 AND work_item_id = $2
          AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
      `,
      [capabilityId, workItemId, normalized],
    );
  });
};

/**
 * Transaction-scoped helper used inside `createWorkflowRun` when the
 * run is being created within the same transaction as the segment (new
 * segment start) or retry (segment already exists).
 */
export const attachRunToSegmentTx = async (
  client: PoolClient,
  args: {
    capabilityId: string;
    segmentId: string;
    runId: string;
    isRetry: boolean;
    initialStatus: WorkflowRunStatus;
  },
): Promise<void> => {
  const segmentStatus = mapRunStatusToSegmentStatus(args.initialStatus);
  if (args.isRetry) {
    await client.query(
      `
        UPDATE capability_work_item_segments
        SET
          current_run_id = $3,
          attempt_count = attempt_count + 1,
          status = $4,
          terminal_outcome = NULL,
          completed_at = NULL,
          updated_at = NOW()
        WHERE capability_id = $1 AND id = $2
      `,
      [args.capabilityId, args.segmentId, args.runId, segmentStatus],
    );
  } else {
    await client.query(
      `
        UPDATE capability_work_item_segments
        SET
          first_run_id = COALESCE(first_run_id, $3),
          current_run_id = $3,
          attempt_count = GREATEST(attempt_count, 1),
          status = $4,
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW()
        WHERE capability_id = $1 AND id = $2
      `,
      [args.capabilityId, args.segmentId, args.runId, segmentStatus],
    );
  }
};
