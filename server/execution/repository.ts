import type { PoolClient } from 'pg';
import {
  ApprovalAssignment,
  ApprovalDecision,
  RunEvent,
  RunWait,
  ToolInvocation,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunQueueReason,
  WorkflowRunStep,
  WorkflowRunStatus,
  WorkItem,
  WorkItemClaim,
  WorkItemPresence,
  WorkItemPhase,
} from '../../src/types';
import { query, transaction } from '../db';
import { publishRunEvent } from '../eventBus';
import { createSpanId, createTraceId } from '../telemetry';
import {
  listOwnedCapabilityIdsForExecutor,
  reconcileDesktopExecutionOwnerships,
  resolveQueuedRunDispatch,
} from '../executionOwnership';
import {
  executionRuntimeRpc,
  isRemoteExecutionClient,
} from './runtimeClient';
import {
  extractTouchedPaths,
  isMappedProvenanceTool,
} from '../governance/provenanceExtractor';
import {
  findFirstExecutableNode,
  findFirstExecutableNodeForPhase,
  getDisplayStepIdForNode,
  getWorkflowNodeOrder,
  getWorkflowNodes,
} from '../../src/lib/workflowGraph';
import { attachRunToSegmentTx } from './segments';

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value || '');

const asJson = <T>(value: unknown, fallback: T): T =>
  value && typeof value === 'object' ? (value as T) : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

const serializeJson = (value: unknown, fallback?: unknown) => {
  if (value === undefined) {
    return fallback === undefined ? null : JSON.stringify(fallback);
  }

  if (value === null) {
    return null;
  }

  return JSON.stringify(value);
};

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

export const ACTIVE_RUN_STATUSES: WorkflowRunStatus[] = [
  'QUEUED',
  'RUNNING',
  'PAUSED',
  'WAITING_APPROVAL',
  'WAITING_HUMAN_TASK',
  'WAITING_INPUT',
  'WAITING_CONFLICT',
];

const runFromRow = (row: Record<string, any>): WorkflowRun => ({
  id: row.id,
  capabilityId: row.capability_id,
  workItemId: row.work_item_id,
  workflowId: row.workflow_id,
  status: row.status,
  queueReason: row.queue_reason || undefined,
  assignedExecutorId: row.assigned_executor_id || undefined,
  attemptNumber: Number(row.attempt_number || 1),
  workflowSnapshot: asJson<Workflow>(row.workflow_snapshot, {
    id: row.workflow_id,
    capabilityId: row.capability_id,
    name: 'Workflow',
    steps: [],
    status: 'STABLE',
  }),
  currentNodeId: row.current_node_id || undefined,
  currentStepId: row.current_step_id || undefined,
  currentPhase: row.current_phase || undefined,
  assignedAgentId: row.assigned_agent_id || undefined,
  branchState: asJson(row.branch_state, undefined),
  pauseReason: row.pause_reason || undefined,
  currentWaitId: row.current_wait_id || undefined,
  terminalOutcome: row.terminal_outcome || undefined,
  restartFromPhase: row.restart_from_phase || undefined,
  segmentId: row.segment_id || undefined,
  prioritySnapshot:
    row.priority_snapshot === 'High' ||
    row.priority_snapshot === 'Med' ||
    row.priority_snapshot === 'Low'
      ? row.priority_snapshot
      : undefined,
  traceId: row.trace_id || undefined,
  leaseOwner: row.lease_owner || undefined,
  leaseExpiresAt: row.lease_expires_at ? asIso(row.lease_expires_at) : undefined,
  startedAt: row.started_at ? asIso(row.started_at) : undefined,
  completedAt: row.completed_at ? asIso(row.completed_at) : undefined,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
});

const stepFromRow = (row: Record<string, any>): WorkflowRunStep => ({
  id: row.id,
  capabilityId: row.capability_id,
  runId: row.run_id,
  workflowNodeId: row.workflow_node_id || row.workflow_step_id,
  workflowStepId: row.workflow_step_id || undefined,
  stepIndex: Number(row.step_index || 0),
  phase: row.phase,
  name: row.name,
  stepType: row.step_type,
  agentId: row.agent_id,
  status: row.status,
  attemptCount: Number(row.attempt_count || 0),
  spanId: row.span_id || undefined,
  evidenceSummary: row.evidence_summary || undefined,
  outputSummary: row.output_summary || undefined,
  waitId: row.wait_id || undefined,
  lastToolInvocationId: row.last_tool_invocation_id || undefined,
  retrievalReferences: Array.isArray(row.retrieval_references)
    ? row.retrieval_references
    : undefined,
  startedAt: row.started_at ? asIso(row.started_at) : undefined,
  completedAt: row.completed_at ? asIso(row.completed_at) : undefined,
  metadata: row.metadata || undefined,
});

const toolFromRow = (row: Record<string, any>): ToolInvocation => ({
  id: row.id,
  capabilityId: row.capability_id,
  runId: row.run_id,
  runStepId: row.run_step_id,
  traceId: row.trace_id || undefined,
  spanId: row.span_id || undefined,
  toolId: row.tool_id,
  status: row.status,
  request: asJson<Record<string, any>>(row.request, {}),
  resultSummary: row.result_summary || undefined,
  workingDirectory: row.working_directory || undefined,
  exitCode: row.exit_code ?? undefined,
  stdoutPreview: row.stdout_preview || undefined,
  stderrPreview: row.stderr_preview || undefined,
  retryable: Boolean(row.retryable),
  sandboxProfile: row.sandbox_profile || undefined,
  policyDecisionId: row.policy_decision_id || undefined,
  latencyMs: row.latency_ms ?? undefined,
  costUsd: row.cost_usd ? Number(row.cost_usd) : undefined,
  startedAt: row.started_at ? asIso(row.started_at) : undefined,
  completedAt: row.completed_at ? asIso(row.completed_at) : undefined,
  createdAt: asIso(row.created_at),
});

const eventFromRow = (row: Record<string, any>): RunEvent => ({
  id: row.id,
  capabilityId: row.capability_id,
  runId: row.run_id,
  workItemId: row.work_item_id,
  traceId: row.trace_id || undefined,
  spanId: row.span_id || undefined,
  timestamp: row.timestamp,
  level: row.level,
  type: row.type,
  message: row.message,
  runStepId: row.run_step_id || undefined,
  toolInvocationId: row.tool_invocation_id || undefined,
  details: row.details || undefined,
});

const approvalAssignmentFromRow = (row: Record<string, any>): ApprovalAssignment => ({
  id: row.id,
  capabilityId: row.capability_id,
  runId: row.run_id,
  waitId: row.wait_id,
  phase: row.phase || undefined,
  stepName: row.step_name || undefined,
  approvalPolicyId: row.approval_policy_id || undefined,
  status: row.status,
  targetType: row.target_type,
  targetId: row.target_id,
  assignedUserId: row.assigned_user_id || undefined,
  assignedTeamId: row.assigned_team_id || undefined,
  dueAt: row.due_at ? asIso(row.due_at) : undefined,
  delegatedToUserId: row.delegated_to_user_id || undefined,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
});

const approvalDecisionFromRow = (row: Record<string, any>): ApprovalDecision => ({
  id: row.id,
  capabilityId: row.capability_id,
  runId: row.run_id,
  waitId: row.wait_id,
  assignmentId: row.assignment_id || undefined,
  disposition: row.disposition,
  actorUserId: row.actor_user_id || undefined,
  actorDisplayName: row.actor_display_name,
  actorTeamIds: asStringArray(row.actor_team_ids),
  comment: row.comment || undefined,
  createdAt: asIso(row.created_at),
});

const workItemClaimFromRow = (row: Record<string, any>): WorkItemClaim => ({
  capabilityId: row.capability_id,
  workItemId: row.work_item_id,
  userId: row.user_id,
  teamId: row.team_id || undefined,
  status: row.status,
  claimedAt: asIso(row.claimed_at),
  expiresAt: asIso(row.expires_at),
  releasedAt: row.released_at ? asIso(row.released_at) : undefined,
});

const workItemPresenceFromRow = (row: Record<string, any>): WorkItemPresence => ({
  capabilityId: row.capability_id,
  workItemId: row.work_item_id,
  userId: row.user_id,
  teamId: row.team_id || undefined,
  viewContext: row.view_context || undefined,
  lastSeenAt: asIso(row.last_seen_at),
});

const waitFromRow = (row: Record<string, any>): RunWait => ({
  id: row.id,
  capabilityId: row.capability_id,
  runId: row.run_id,
  runStepId: row.run_step_id,
  traceId: row.trace_id || undefined,
  spanId: row.span_id || undefined,
  type: row.type,
  status: row.status,
  message: row.message,
  requestedBy: row.requested_by,
  requestedByActorUserId: row.requested_by_actor_user_id || undefined,
  requestedByActorTeamIds: asStringArray(row.requested_by_actor_team_ids),
  resolution: row.resolution || undefined,
  resolvedBy: row.resolved_by || undefined,
  resolvedByActorUserId: row.resolved_by_actor_user_id || undefined,
  resolvedByActorTeamIds: asStringArray(row.resolved_by_actor_team_ids),
  approvalPolicyId: row.approval_policy_id || undefined,
  payload: row.payload || undefined,
  createdAt: asIso(row.created_at),
  resolvedAt: row.resolved_at ? asIso(row.resolved_at) : undefined,
});

const getRunDetailTx = async (
  client: PoolClient,
  capabilityId: string,
  runId: string,
): Promise<WorkflowRunDetail> => {
  const runResult = await client.query(
    `
      SELECT *
      FROM capability_workflow_runs
      WHERE capability_id = $1 AND id = $2
    `,
    [capabilityId, runId],
  );
  const stepResult = await client.query(
    `
      SELECT *
      FROM capability_workflow_run_steps
      WHERE capability_id = $1 AND run_id = $2
      ORDER BY step_index ASC, created_at ASC
    `,
    [capabilityId, runId],
  );
  const waitResult = await client.query(
    `
      SELECT *
      FROM capability_run_waits
      WHERE capability_id = $1 AND run_id = $2
      ORDER BY created_at ASC, id ASC
    `,
    [capabilityId, runId],
  );
  const toolResult = await client.query(
    `
      SELECT *
      FROM capability_tool_invocations
      WHERE capability_id = $1 AND run_id = $2
      ORDER BY created_at ASC, id ASC
    `,
    [capabilityId, runId],
  );
  const waitIds = waitResult.rows.map(row => String(row.id)).filter(Boolean);
  const [assignmentResult, decisionResult] = waitIds.length
    ? await Promise.all([
        client.query(
          `
            SELECT *
            FROM capability_approval_assignments
            WHERE capability_id = $1
              AND run_id = $2
              AND wait_id = ANY($3::text[])
            ORDER BY created_at ASC, id ASC
          `,
          [capabilityId, runId, waitIds],
        ),
        client.query(
          `
            SELECT *
            FROM capability_approval_decisions
            WHERE capability_id = $1
              AND run_id = $2
              AND wait_id = ANY($3::text[])
            ORDER BY created_at ASC, id ASC
          `,
          [capabilityId, runId, waitIds],
        ),
      ])
    : [{ rows: [] }, { rows: [] }];

  if (!runResult.rowCount) {
    throw new Error(`Workflow run ${runId} was not found.`);
  }

  return {
    run: runFromRow(runResult.rows[0]),
    steps: stepResult.rows.map(stepFromRow),
    waits: waitResult.rows.map(row => {
      const wait = waitFromRow(row);
      wait.approvalAssignments = assignmentResult.rows
        .filter(assignment => assignment.wait_id === wait.id)
        .map(approvalAssignmentFromRow);
      wait.approvalDecisions = decisionResult.rows
        .filter(decision => decision.wait_id === wait.id)
        .map(approvalDecisionFromRow);
      return wait;
    }),
    toolInvocations: toolResult.rows.map(toolFromRow),
  };
};

export const listWorkflowRunEvents = async (
  capabilityId: string,
  runId: string,
): Promise<RunEvent[]> => {
  const result = await query(
    `
      SELECT *
      FROM capability_run_events
      WHERE capability_id = $1 AND run_id = $2
      ORDER BY created_at ASC, id ASC
    `,
    [capabilityId, runId],
  );

  return result.rows.map(eventFromRow);
};

export const listRecentWorkflowRunEvents = async (
  capabilityId: string,
  limit = 40,
): Promise<RunEvent[]> => {
  const result = await query(
    `
      SELECT *
      FROM capability_run_events
      WHERE capability_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `,
    [capabilityId, limit],
  );

  return result.rows.map(eventFromRow);
};

export const listWorkflowRunsForWorkItem = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkflowRun[]> => {
  const result = await query(
    `
      SELECT *
      FROM capability_workflow_runs
      WHERE capability_id = $1 AND work_item_id = $2
      ORDER BY attempt_number DESC, created_at DESC
    `,
    [capabilityId, workItemId],
  );

  return result.rows.map(runFromRow);
};

export const listWorkflowRunsByCapability = async (
  capabilityId: string,
): Promise<WorkflowRun[]> => {
  const result = await query(
    `
      SELECT *
      FROM capability_workflow_runs
      WHERE capability_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [capabilityId],
  );

  return result.rows.map(runFromRow);
};

export const getWorkflowRunDetail = async (
  capabilityId: string,
  runId: string,
): Promise<WorkflowRunDetail> =>
  isRemoteExecutionClient()
    ? executionRuntimeRpc<WorkflowRunDetail>('getWorkflowRunDetail', {
        capabilityId,
        runId,
      })
    :
  transaction(client => getRunDetailTx(client, capabilityId, runId));

export const getWorkflowRunStatus = async (
  capabilityId: string,
  runId: string,
): Promise<WorkflowRunStatus> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<WorkflowRunStatus>('getWorkflowRunStatus', {
      capabilityId,
      runId,
    });
  }

  const result = await query(
    `
      SELECT status
      FROM capability_workflow_runs
      WHERE capability_id = $1 AND id = $2
    `,
    [capabilityId, runId],
  );

  if (!result.rowCount) {
    throw new Error(`Workflow run ${runId} was not found.`);
  }

  return (result.rows[0] as { status: WorkflowRunStatus }).status;
};

export const getWorkflowRun = async (
  capabilityId: string,
  runId: string,
): Promise<WorkflowRun> => {
  const detail = await getWorkflowRunDetail(capabilityId, runId);
  return detail.run;
};

export const getLatestRunForWorkItem = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkflowRun | null> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<WorkflowRun | null>('getLatestRunForWorkItem', {
      capabilityId,
      workItemId,
    });
  }

  const result = await query(
    `
      SELECT *
      FROM capability_workflow_runs
      WHERE capability_id = $1 AND work_item_id = $2
      ORDER BY attempt_number DESC, created_at DESC
      LIMIT 1
    `,
    [capabilityId, workItemId],
  );

  return result.rowCount ? runFromRow(result.rows[0]) : null;
};

export const getActiveRunForWorkItem = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkflowRun | null> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<WorkflowRun | null>('getActiveRunForWorkItem', {
      capabilityId,
      workItemId,
    });
  }

  const result = await query(
    `
      SELECT *
      FROM capability_workflow_runs
      WHERE capability_id = $1
        AND work_item_id = $2
        AND status = ANY($3::text[])
      ORDER BY attempt_number DESC, created_at DESC
      LIMIT 1
    `,
    [capabilityId, workItemId, ACTIVE_RUN_STATUSES],
  );

  return result.rowCount ? runFromRow(result.rows[0]) : null;
};

export const createWorkflowRun = async ({
  capabilityId,
  workItem,
  workflow,
  restartFromPhase,
  segment,
}: {
  capabilityId: string;
  workItem: WorkItem;
  workflow: Workflow;
  restartFromPhase?: WorkItemPhase;
  // Phase-segment linkage: when the caller is starting a new segment
  // or retrying a failed segment, it passes the segment descriptor here
  // so the run row captures segment_id + priority_snapshot and the
  // segment's current_run_id / attempt_count update in the same tx.
  segment?: {
    id: string;
    prioritySnapshot: 'High' | 'Med' | 'Low';
    isRetry: boolean;
  };
}): Promise<WorkflowRunDetail> => {
  return transaction(async client => {
    const normalizedWorkflow = workflow;
    const activeRunResult = await client.query(
      `
        SELECT id
        FROM capability_workflow_runs
        WHERE capability_id = $1
          AND work_item_id = $2
          AND status = ANY($3::text[])
        LIMIT 1
      `,
      [capabilityId, workItem.id, ACTIVE_RUN_STATUSES],
    );

    if (activeRunResult.rowCount) {
      throw new Error(
        `Work item ${workItem.id} already has an active or waiting workflow run.`,
      );
    }

    const attemptResult = await client.query<{ attempt_number: number }>(
      `
        SELECT COALESCE(MAX(attempt_number), 0) AS attempt_number
        FROM capability_workflow_runs
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [capabilityId, workItem.id],
    );

    const attemptNumber = Number(attemptResult.rows[0]?.attempt_number || 0) + 1;
    const runId = createId('RUN');
    const traceId = createTraceId();
    const orderedNodeIds = getWorkflowNodeOrder(normalizedWorkflow);
    const orderedNodes = orderedNodeIds
      .map(nodeId => getWorkflowNodes(normalizedWorkflow).find(node => node.id === nodeId))
      .filter(Boolean);
    const startingNode =
      (restartFromPhase
        ? findFirstExecutableNodeForPhase(normalizedWorkflow, restartFromPhase)
        : null) ||
      (workItem.currentStepId
        ? getWorkflowNodes(normalizedWorkflow).find(node => node.id === workItem.currentStepId)
        : null) ||
      findFirstExecutableNode(normalizedWorkflow);

    if (!startingNode) {
      throw new Error(`Workflow ${normalizedWorkflow.name} does not define any executable nodes.`);
    }

    const startingIndex = orderedNodes.findIndex(node => node?.id === startingNode.id);
    const completedNodeIds = orderedNodes
      .slice(0, Math.max(startingIndex, 0))
      .map(node => node!.id);
    const queuedDispatch = await resolveQueuedRunDispatch({ capabilityId });
    const run: WorkflowRun = {
      id: runId,
      capabilityId,
      workItemId: workItem.id,
      workflowId: normalizedWorkflow.id,
      status: 'QUEUED',
      queueReason: queuedDispatch.queueReason,
      assignedExecutorId: queuedDispatch.assignedExecutorId,
      attemptNumber,
      workflowSnapshot: normalizedWorkflow,
      currentNodeId: startingNode.id,
      currentStepId: getDisplayStepIdForNode(normalizedWorkflow, startingNode.id) || startingNode.id,
      currentPhase: startingNode.phase,
      assignedAgentId: startingNode.agentId,
      branchState: {
        pendingNodeIds: [startingNode.id],
        activeNodeIds: [startingNode.id],
        completedNodeIds,
        joinState: {},
        visitCount: 0,
      },
      restartFromPhase,
      segmentId: segment?.id,
      prioritySnapshot: segment?.prioritySnapshot,
      traceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await client.query(
      `
        INSERT INTO capability_workflow_runs (
          capability_id,
          id,
          work_item_id,
          workflow_id,
          status,
          queue_reason,
          assigned_executor_id,
          attempt_number,
          workflow_snapshot,
          current_node_id,
          current_step_id,
          current_phase,
          assigned_agent_id,
          branch_state,
          restart_from_phase,
          trace_id,
          segment_id,
          priority_snapshot
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      `,
      [
        capabilityId,
        run.id,
        workItem.id,
        normalizedWorkflow.id,
        run.status,
        run.queueReason || null,
        run.assignedExecutorId || null,
        run.attemptNumber,
        JSON.stringify(normalizedWorkflow),
        run.currentNodeId || null,
        run.currentStepId || null,
        run.currentPhase || null,
        run.assignedAgentId || null,
        JSON.stringify(run.branchState || {}),
        run.restartFromPhase || null,
        run.traceId,
        run.segmentId || null,
        run.prioritySnapshot || null,
      ],
    );

    // Link the run to its segment (if supplied). This update the
    // segment's current_run_id, first_run_id (if null), attempt_count,
    // and status within the same transaction so a transaction failure
    // rolls back both sides together — no dangling run without a
    // segment owner, no half-initialized segment.
    if (segment?.id) {
      await attachRunToSegmentTx(client, {
        capabilityId,
        segmentId: segment.id,
        runId: run.id,
        isRetry: segment.isRetry,
        initialStatus: run.status,
      });
    }

    for (const [index, node] of orderedNodes.entries()) {
      await client.query(
        `
          INSERT INTO capability_workflow_run_steps (
            capability_id,
            id,
            run_id,
            workflow_node_id,
            workflow_step_id,
            step_index,
            phase,
            name,
            step_type,
            agent_id,
            status,
            attempt_count,
            span_id,
            retrieval_references,
            metadata
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `,
        [
          capabilityId,
          createId('RUNSTEP'),
          run.id,
          node!.id,
          getDisplayStepIdForNode(normalizedWorkflow, node!.id) || node!.id,
          index,
          node!.phase,
          node!.name,
          node!.type === 'GOVERNANCE_GATE'
            ? 'GOVERNANCE_GATE'
            : node!.type === 'HUMAN_APPROVAL'
            ? 'HUMAN_APPROVAL'
            : 'DELIVERY',
          node!.agentId || 'SYSTEM',
          completedNodeIds.includes(node!.id) ? 'COMPLETED' : 'PENDING',
          0,
          createSpanId(),
          JSON.stringify([]),
          JSON.stringify({
            nodeType: node!.type,
            allowedToolIds: node!.allowedToolIds || [],
            preferredWorkspacePath: node!.preferredWorkspacePath || null,
          }),
        ],
      );
    }

    await client.query(
      `
        INSERT INTO capability_run_events (
          capability_id,
          id,
          run_id,
          work_item_id,
          timestamp,
          trace_id,
          level,
          type,
          message,
          details
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        capabilityId,
        createId('RUNEVENT'),
        run.id,
        workItem.id,
        new Date().toISOString(),
        traceId,
        'INFO',
        'RUN_CREATED',
        `Workflow run ${run.id} was created for ${workItem.title}.`,
        JSON.stringify({
          workflowId: workflow.id,
          workflowName: normalizedWorkflow.name,
          restartFromPhase: restartFromPhase || null,
        }),
      ],
    );

    return getRunDetailTx(client, capabilityId, run.id);
  });
};

export const updateWorkflowRun = async (run: WorkflowRun): Promise<WorkflowRunDetail> =>
  isRemoteExecutionClient()
    ? executionRuntimeRpc<WorkflowRunDetail>('updateWorkflowRun', {
        run,
      })
    :
  transaction(async client => {
    await client.query(
      `
        UPDATE capability_workflow_runs
        SET
          status = $3,
          queue_reason = $4,
          assigned_executor_id = $5,
          workflow_snapshot = $6,
          current_node_id = $7,
          current_step_id = $8,
          current_phase = $9,
          assigned_agent_id = $10,
          branch_state = $11,
          pause_reason = $12,
          current_wait_id = $13,
          terminal_outcome = $14,
          restart_from_phase = $15,
          trace_id = $16,
          lease_owner = $17,
          lease_expires_at = $18,
          started_at = $19,
          completed_at = $20,
          segment_id = COALESCE(segment_id, $21),
          priority_snapshot = COALESCE($22, priority_snapshot),
          updated_at = NOW()
        WHERE capability_id = $1
          AND id = $2
          AND status NOT IN ('CANCELLED', 'COMPLETED', 'FAILED', 'PAUSED')
      `,
      [
        run.capabilityId,
        run.id,
        run.status,
        run.queueReason || null,
        run.assignedExecutorId || null,
        JSON.stringify(run.workflowSnapshot),
        run.currentNodeId || null,
        run.currentStepId || null,
        run.currentPhase || null,
        run.assignedAgentId || null,
        serializeJson(run.branchState, {}),
        run.pauseReason || null,
        run.currentWaitId || null,
        run.terminalOutcome || null,
        run.restartFromPhase || null,
        run.traceId || null,
        run.leaseOwner || null,
        run.leaseExpiresAt || null,
        run.startedAt || null,
        run.completedAt || null,
        run.segmentId || null,
        run.prioritySnapshot || null,
      ],
    );

    return getRunDetailTx(client, run.capabilityId, run.id);
  });

export const updateWorkflowRunControl = async (run: WorkflowRun): Promise<WorkflowRunDetail> =>
  isRemoteExecutionClient()
    ? executionRuntimeRpc<WorkflowRunDetail>('updateWorkflowRunControl', {
        run,
      })
    :
  transaction(async client => {
    await client.query(
      `
        UPDATE capability_workflow_runs
        SET
          status = $3,
          queue_reason = $4,
          assigned_executor_id = $5,
          workflow_snapshot = $6,
          current_node_id = $7,
          current_step_id = $8,
          current_phase = $9,
          assigned_agent_id = $10,
          branch_state = $11,
          pause_reason = $12,
          current_wait_id = $13,
          terminal_outcome = $14,
          restart_from_phase = $15,
          trace_id = $16,
          lease_owner = $17,
          lease_expires_at = $18,
          started_at = $19,
          completed_at = $20,
          segment_id = COALESCE(segment_id, $21),
          priority_snapshot = COALESCE($22, priority_snapshot),
          updated_at = NOW()
        WHERE capability_id = $1
          AND id = $2
          AND status NOT IN ('CANCELLED', 'COMPLETED', 'FAILED')
      `,
      [
        run.capabilityId,
        run.id,
        run.status,
        run.queueReason || null,
        run.assignedExecutorId || null,
        JSON.stringify(run.workflowSnapshot),
        run.currentNodeId || null,
        run.currentStepId || null,
        run.currentPhase || null,
        run.assignedAgentId || null,
        serializeJson(run.branchState, {}),
        run.pauseReason || null,
        run.currentWaitId || null,
        run.terminalOutcome || null,
        run.restartFromPhase || null,
        run.traceId || null,
        run.leaseOwner || null,
        run.leaseExpiresAt || null,
        run.startedAt || null,
        run.completedAt || null,
        run.segmentId || null,
        run.prioritySnapshot || null,
      ],
    );

    return getRunDetailTx(client, run.capabilityId, run.id);
  });

export const updateWorkflowRunStep = async (
  step: WorkflowRunStep,
): Promise<WorkflowRunStep> =>
  isRemoteExecutionClient()
    ? executionRuntimeRpc<WorkflowRunStep>('updateWorkflowRunStep', {
        step,
      })
    :
  transaction(async client => {
    const result = await client.query(
      `
        UPDATE capability_workflow_run_steps
        SET
          status = $3,
          attempt_count = $4,
          span_id = $5,
          evidence_summary = $6,
          output_summary = $7,
          wait_id = $8,
          last_tool_invocation_id = $9,
          retrieval_references = $10,
          started_at = $11,
          completed_at = $12,
          metadata = $13,
          updated_at = NOW()
        WHERE capability_id = $1 AND id = $2
        RETURNING *
      `,
      [
        step.capabilityId,
        step.id,
        step.status,
        step.attemptCount,
        step.spanId || null,
        step.evidenceSummary || null,
        step.outputSummary || null,
        step.waitId || null,
        step.lastToolInvocationId || null,
        serializeJson(step.retrievalReferences, []),
        step.startedAt || null,
        step.completedAt || null,
        serializeJson(step.metadata),
      ],
    );

    return stepFromRow(result.rows[0]);
  });

export const insertRunEvent = async (event: RunEvent): Promise<RunEvent> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<RunEvent>('insertRunEvent', {
      event,
    });
  }

  const result = await query(
    `
      INSERT INTO capability_run_events (
        capability_id,
        id,
        run_id,
        work_item_id,
        timestamp,
        trace_id,
        level,
        type,
        message,
        run_step_id,
        tool_invocation_id,
        span_id,
        details
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `,
    [
      event.capabilityId,
      event.id,
      event.runId,
      event.workItemId,
      event.timestamp,
      event.traceId || null,
      event.level,
      event.type,
      event.message,
      event.runStepId || null,
      event.toolInvocationId || null,
      event.spanId || null,
      serializeJson(event.details),
    ],
  );

  const nextEvent = eventFromRow(result.rows[0]);
  publishRunEvent(nextEvent);
  return nextEvent;
};

export const createRunEvent = (
  values: Omit<RunEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): RunEvent => ({
  id: values.id || createId('RUNEVENT'),
  timestamp: values.timestamp || new Date().toISOString(),
  ...values,
});

export const createRunWait = async (
  wait: Omit<RunWait, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): Promise<RunWait> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<RunWait>('createRunWait', {
      wait,
    });
  }

  const result = await query(
    `
      INSERT INTO capability_run_waits (
        capability_id,
        id,
        run_id,
        run_step_id,
        type,
        status,
        message,
        requested_by,
        trace_id,
        span_id,
        resolution,
        resolved_by,
        requested_by_actor_user_id,
        requested_by_actor_team_ids,
        resolved_by_actor_user_id,
        resolved_by_actor_team_ids,
        approval_policy_id,
        payload,
        created_at,
        resolved_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW())
      RETURNING *
    `,
    [
      wait.capabilityId,
      wait.id || createId('RUNWAIT'),
      wait.runId,
      wait.runStepId,
      wait.type,
      wait.status,
      wait.message,
      wait.requestedBy,
      wait.traceId || null,
      wait.spanId || null,
      wait.resolution || null,
      wait.resolvedBy || null,
      wait.requestedByActorUserId || null,
      wait.requestedByActorTeamIds || [],
      wait.resolvedByActorUserId || null,
      wait.resolvedByActorTeamIds || [],
      wait.approvalPolicyId || null,
      serializeJson(wait.payload),
      wait.createdAt || new Date().toISOString(),
      wait.resolvedAt || null,
    ],
  );

  return waitFromRow(result.rows[0]);
};

export const resolveRunWait = async ({
  capabilityId,
  waitId,
  resolution,
  resolvedBy,
  resolvedByActorUserId,
  resolvedByActorTeamIds,
}: {
  capabilityId: string;
  waitId: string;
  resolution: string;
  resolvedBy: string;
  resolvedByActorUserId?: string;
  resolvedByActorTeamIds?: string[];
}): Promise<RunWait> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<RunWait>('resolveRunWait', {
      capabilityId,
      waitId,
      resolution,
      resolvedBy,
      resolvedByActorUserId,
      resolvedByActorTeamIds,
    });
  }

  const result = await query(
    `
      UPDATE capability_run_waits
      SET
        status = 'RESOLVED',
        resolution = $3,
        resolved_by = $4,
        resolved_by_actor_user_id = $5,
        resolved_by_actor_team_ids = $6,
        resolved_at = NOW(),
        updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
      RETURNING *
    `,
    [
      capabilityId,
      waitId,
      resolution,
      resolvedBy,
      resolvedByActorUserId || null,
      resolvedByActorTeamIds || [],
    ],
  );

  if (!result.rowCount) {
    throw new Error(`Run wait ${waitId} was not found.`);
  }

  return waitFromRow(result.rows[0]);
};

export const createApprovalAssignments = async (
  assignments: ApprovalAssignment[],
): Promise<ApprovalAssignment[]> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<ApprovalAssignment[]>('createApprovalAssignments', {
      assignments,
    });
  }

  const created: ApprovalAssignment[] = [];

  for (const assignment of assignments) {
    const result = await query(
      `
        INSERT INTO capability_approval_assignments (
          capability_id,
          id,
          run_id,
          wait_id,
          phase,
          step_name,
          approval_policy_id,
          status,
          target_type,
          target_id,
          assigned_user_id,
          assigned_team_id,
          due_at,
          delegated_to_user_id,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        RETURNING *
      `,
      [
        assignment.capabilityId,
        assignment.id,
        assignment.runId,
        assignment.waitId,
        assignment.phase || null,
        assignment.stepName || null,
        assignment.approvalPolicyId || null,
        assignment.status,
        assignment.targetType,
        assignment.targetId,
        assignment.assignedUserId || null,
        assignment.assignedTeamId || null,
        assignment.dueAt || null,
        assignment.delegatedToUserId || null,
      ],
    );
    created.push(approvalAssignmentFromRow(result.rows[0]));
  }

  return created;
};

/**
 * Update a single assignment by its id. Used when recording a partial
 * approval (threshold not yet met) so only the acting approver's row
 * transitions to APPROVED / REQUEST_CHANGES, leaving others PENDING.
 */
export const updateSingleApprovalAssignment = async ({
  capabilityId,
  assignmentId,
  status,
}: {
  capabilityId: string;
  assignmentId: string;
  status: ApprovalAssignment['status'];
}) => {
  if (isRemoteExecutionClient()) {
    await executionRuntimeRpc<void>('updateSingleApprovalAssignment', {
      capabilityId,
      assignmentId,
      status,
    });
    return;
  }

  await query(
    `
      UPDATE capability_approval_assignments
      SET status = $3, updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
    `,
    [capabilityId, assignmentId, status],
  );
};

export const updateApprovalAssignmentsForWait = async ({
  capabilityId,
  waitId,
  status,
}: {
  capabilityId: string;
  waitId: string;
  status: ApprovalAssignment['status'];
}) => {
  if (isRemoteExecutionClient()) {
    await executionRuntimeRpc<void>('updateApprovalAssignmentsForWait', {
      capabilityId,
      waitId,
      status,
    });
    return;
  }

  await query(
    `
      UPDATE capability_approval_assignments
      SET
        status = $3,
        updated_at = NOW()
      WHERE capability_id = $1
        AND wait_id = $2
        AND status = 'PENDING'
    `,
    [capabilityId, waitId, status],
  );
};

export const createApprovalDecision = async (
  decision: ApprovalDecision,
): Promise<ApprovalDecision> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<ApprovalDecision>('createApprovalDecision', {
      decision,
    });
  }

  const result = await query(
    `
      INSERT INTO capability_approval_decisions (
        capability_id,
        id,
        run_id,
        wait_id,
        assignment_id,
        disposition,
        actor_user_id,
        actor_display_name,
        actor_team_ids,
        comment,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `,
    [
      decision.capabilityId,
      decision.id,
      decision.runId,
      decision.waitId,
      decision.assignmentId || null,
      decision.disposition,
      decision.actorUserId || null,
      decision.actorDisplayName,
      decision.actorTeamIds,
      decision.comment || null,
      decision.createdAt || new Date().toISOString(),
    ],
  );

  return approvalDecisionFromRow(result.rows[0]);
};

export const listActiveWorkItemClaims = async (
  capabilityId: string,
  workItemId?: string,
): Promise<WorkItemClaim[]> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<WorkItemClaim[]>('listActiveWorkItemClaims', {
      capabilityId,
      workItemId,
    });
  }

  const result = await query(
    `
      SELECT *
      FROM capability_work_item_claims
      WHERE capability_id = $1
        AND status = 'ACTIVE'
        AND ($2::text IS NULL OR work_item_id = $2)
      ORDER BY claimed_at DESC
    `,
    [capabilityId, workItemId || null],
  );

  return result.rows.map(workItemClaimFromRow);
};

export const upsertWorkItemClaim = async (
  claim: WorkItemClaim,
): Promise<WorkItemClaim> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<WorkItemClaim>('upsertWorkItemClaim', {
      claim,
    });
  }

  const result = await query(
    `
      INSERT INTO capability_work_item_claims (
        capability_id,
        work_item_id,
        user_id,
        team_id,
        status,
        claimed_at,
        expires_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (capability_id, work_item_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        team_id = EXCLUDED.team_id,
        status = EXCLUDED.status,
        claimed_at = EXCLUDED.claimed_at,
        expires_at = EXCLUDED.expires_at,
        released_at = NULL,
        updated_at = NOW()
      RETURNING *
    `,
    [
      claim.capabilityId,
      claim.workItemId,
      claim.userId,
      claim.teamId || null,
      claim.status,
      claim.claimedAt,
      claim.expiresAt,
    ],
  );

  return result.rowCount ? workItemClaimFromRow(result.rows[0]) : claim;
};

export const releaseWorkItemClaim = async ({
  capabilityId,
  workItemId,
  userId,
}: {
  capabilityId: string;
  workItemId: string;
  userId: string;
}) => {
  if (isRemoteExecutionClient()) {
    await executionRuntimeRpc<void>('releaseWorkItemClaim', {
      capabilityId,
      workItemId,
      userId,
    });
    return;
  }

  await query(
    `
      UPDATE capability_work_item_claims
      SET
        status = 'RELEASED',
        released_at = NOW()
      WHERE capability_id = $1
        AND work_item_id = $2
        AND user_id = $3
        AND status = 'ACTIVE'
    `,
    [capabilityId, workItemId, userId],
  );
};

export const upsertWorkItemPresence = async (
  presence: WorkItemPresence,
): Promise<WorkItemPresence> => {
  const result = await query(
    `
      INSERT INTO capability_work_item_presence (
        capability_id,
        work_item_id,
        user_id,
        team_id,
        view_context,
        last_seen_at
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (capability_id, work_item_id, user_id) DO UPDATE SET
        team_id = EXCLUDED.team_id,
        view_context = EXCLUDED.view_context,
        last_seen_at = EXCLUDED.last_seen_at
      RETURNING *
    `,
    [
      presence.capabilityId,
      presence.workItemId,
      presence.userId,
      presence.teamId || null,
      presence.viewContext || null,
      presence.lastSeenAt,
    ],
  );

  return workItemPresenceFromRow(result.rows[0]);
};

export const listWorkItemPresence = async (
  capabilityId: string,
  workItemId?: string,
): Promise<WorkItemPresence[]> => {
  const result = await query(
    `
      SELECT *
      FROM capability_work_item_presence
      WHERE capability_id = $1
        AND ($2::text IS NULL OR work_item_id = $2)
      ORDER BY last_seen_at DESC
    `,
    [capabilityId, workItemId || null],
  );

  return result.rows.map(workItemPresenceFromRow);
};

export const updateRunWaitPayload = async ({
  capabilityId,
  waitId,
  payload,
}: {
  capabilityId: string;
  waitId: string;
  payload: RunWait['payload'];
}): Promise<RunWait> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<RunWait>('updateRunWaitPayload', {
      capabilityId,
      waitId,
      payload,
    });
  }

  const result = await query(
    `
      UPDATE capability_run_waits
      SET
        payload = $3,
        updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
      RETURNING *
    `,
    [capabilityId, waitId, serializeJson(payload)],
  );

  if (!result.rowCount) {
    throw new Error(`Run wait ${waitId} was not found.`);
  }

  return waitFromRow(result.rows[0]);
};

export const createToolInvocation = async (
  invocation: Omit<ToolInvocation, 'createdAt'> & { createdAt?: string },
): Promise<ToolInvocation> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<ToolInvocation>('createToolInvocation', {
      invocation,
    });
  }

  // Slice 4 — extract touched_paths at write time. A null result means the
  // tool isn't mapped yet; log-and-continue (we log once per-tool to avoid
  // spam) so the invocation row still lands while telemetry catches drift.
  const extracted = extractTouchedPaths(invocation.toolId, invocation.request);
  const touchedPaths = extracted ?? [];
  if (extracted === null && !isMappedProvenanceTool(invocation.toolId)) {
    warnUnmappedProvenanceTool(invocation.toolId);
  }

  const result = await query(
    `
      INSERT INTO capability_tool_invocations (
        capability_id,
        id,
        run_id,
        run_step_id,
        trace_id,
        span_id,
        tool_id,
        status,
        request,
        result_summary,
        working_directory,
        exit_code,
        stdout_preview,
        stderr_preview,
        retryable,
        sandbox_profile,
        policy_decision_id,
        latency_ms,
        cost_usd,
        started_at,
        completed_at,
        touched_paths,
        actor_kind,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW())
      RETURNING *
    `,
    [
      invocation.capabilityId,
      invocation.id,
      invocation.runId,
      invocation.runStepId,
      invocation.traceId || null,
      invocation.spanId || null,
      invocation.toolId,
      invocation.status,
      serializeJson(invocation.request, {}),
      invocation.resultSummary || null,
      invocation.workingDirectory || null,
      invocation.exitCode ?? null,
      invocation.stdoutPreview || null,
      invocation.stderrPreview || null,
      invocation.retryable,
      invocation.sandboxProfile || null,
      invocation.policyDecisionId || null,
      invocation.latencyMs ?? null,
      invocation.costUsd ?? null,
      invocation.startedAt || null,
      invocation.completedAt || null,
      touchedPaths,
      'AI', // all tool invocations are AI-initiated today; HUMAN is a
            // follow-up when operator-triggered actions land.
      invocation.createdAt || new Date().toISOString(),
    ],
  );

  return toolFromRow(result.rows[0]);
};

// Rate-limited "unmapped tool" warning so Slice 4 extractor drift is
// surfaced via logs instead of a silent coverage hole. We keep a Set of
// tools we've already warned about so the logs don't spam.
const warnedUnmappedTools = new Set<string>();
const warnUnmappedProvenanceTool = (toolId: string) => {
  if (warnedUnmappedTools.has(toolId)) return;
  warnedUnmappedTools.add(toolId);
  console.warn(
    `[governance.provenance] tool "${toolId}" has no touched_paths extractor; invocation will land with an empty touched_paths array. Add a handler in server/governance/provenanceExtractor.ts.`,
  );
};

export const updateToolInvocation = async (
  invocation: ToolInvocation,
): Promise<ToolInvocation> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<ToolInvocation>('updateToolInvocation', {
      invocation,
    });
  }

  const result = await query(
    `
      UPDATE capability_tool_invocations
      SET
        status = $3,
        request = $4,
        result_summary = $5,
        working_directory = $6,
        exit_code = $7,
        stdout_preview = $8,
        stderr_preview = $9,
        retryable = $10,
        sandbox_profile = $11,
        policy_decision_id = $12,
        latency_ms = $13,
        cost_usd = $14,
        started_at = $15,
        completed_at = $16,
        updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
      RETURNING *
    `,
    [
      invocation.capabilityId,
      invocation.id,
      invocation.status,
      serializeJson(invocation.request, {}),
      invocation.resultSummary || null,
      invocation.workingDirectory || null,
      invocation.exitCode ?? null,
      invocation.stdoutPreview || null,
      invocation.stderrPreview || null,
      invocation.retryable,
      invocation.sandboxProfile || null,
      invocation.policyDecisionId || null,
      invocation.latencyMs ?? null,
      invocation.costUsd ?? null,
      invocation.startedAt || null,
      invocation.completedAt || null,
    ],
  );

  if (!result.rowCount) {
    throw new Error(`Tool invocation ${invocation.id} was not found.`);
  }

  return toolFromRow(result.rows[0]);
};

export const claimRunnableRuns = async ({
  workerId,
  limit,
  leaseMs,
}: {
  workerId: string;
  limit: number;
  leaseMs: number;
}): Promise<WorkflowRun[]> =>
  transaction(async client => {
    const result = await client.query(
      `
        WITH candidates AS (
          SELECT capability_id, id
          FROM capability_workflow_runs
          WHERE status IN ('QUEUED', 'RUNNING')
            AND (
              status = 'QUEUED'
              OR lease_expires_at IS NULL
              OR lease_expires_at <= NOW()
            )
          -- Phase-segment claim order: High > Med > Low, then FIFO within
          -- tier. priority_snapshot is a string column; the CASE folds
          -- it to a numeric rank for ORDER BY without a join to
          -- capability_work_items. Legacy runs with NULL snapshot fall
          -- into the 'Med' bucket so they don't silently outrun newer
          -- High-priority work.
          ORDER BY
            CASE COALESCE(priority_snapshot, 'Med')
              WHEN 'High' THEN 0
              WHEN 'Med'  THEN 1
              WHEN 'Low'  THEN 2
              ELSE 1
            END ASC,
            updated_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE capability_workflow_runs runs
        SET
          status = CASE WHEN runs.status = 'QUEUED' THEN 'RUNNING' ELSE runs.status END,
          lease_owner = $2,
          lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
          started_at = COALESCE(runs.started_at, NOW()),
          updated_at = NOW()
        FROM candidates
        WHERE runs.capability_id = candidates.capability_id
          AND runs.id = candidates.id
        RETURNING runs.*
      `,
      [limit, workerId, leaseMs],
    );

    return result.rows.map(runFromRow);
  });

export const claimNextRunnableRunForExecutor = async ({
  executorId,
  leaseMs,
}: {
  executorId: string;
  leaseMs: number;
}): Promise<WorkflowRun | null> => {
  await reconcileDesktopExecutionOwnerships();
  const ownedCapabilityIds = await listOwnedCapabilityIdsForExecutor(executorId);

  if (ownedCapabilityIds.length === 0) {
    return null;
  }

  const result = await transaction(async client =>
    client.query(
      `
        WITH candidates AS (
          SELECT capability_id, id
          FROM capability_workflow_runs
          WHERE capability_id = ANY($1::text[])
            AND status IN ('QUEUED', 'RUNNING')
            AND (
              assigned_executor_id IS NULL
              OR assigned_executor_id = $2
            )
            AND (
              lease_expires_at IS NULL
              OR lease_expires_at <= NOW()
            )
          -- Same priority ordering as claimRunnableRuns above, applied
          -- to the desktop-executor-scoped claim so both paths respect
          -- operator priority.
          ORDER BY
            CASE COALESCE(priority_snapshot, 'Med')
              WHEN 'High' THEN 0
              WHEN 'Med'  THEN 1
              WHEN 'Low'  THEN 2
              ELSE 1
            END ASC,
            updated_at ASC,
            created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE capability_workflow_runs runs
        SET
          status = CASE WHEN runs.status = 'QUEUED' THEN 'RUNNING' ELSE runs.status END,
          queue_reason = NULL,
          assigned_executor_id = $2,
          lease_owner = $3,
          lease_expires_at = NOW() + ($4 * INTERVAL '1 millisecond'),
          started_at = COALESCE(runs.started_at, NOW()),
          updated_at = NOW()
        FROM candidates
        WHERE runs.capability_id = candidates.capability_id
          AND runs.id = candidates.id
        RETURNING runs.*
      `,
      [ownedCapabilityIds, executorId, `desktop-executor:${executorId}`, leaseMs],
    ),
  );

  return result.rowCount ? runFromRow(result.rows[0]) : null;
};

export const renewExecutorRunLease = async ({
  capabilityId,
  runId,
  executorId,
  leaseMs,
}: {
  capabilityId: string;
  runId: string;
  executorId: string;
  leaseMs: number;
}) => {
  await query(
    `
      UPDATE capability_workflow_runs
      SET
        assigned_executor_id = $3,
        lease_owner = $4,
        lease_expires_at = NOW() + ($5 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      WHERE capability_id = $1
        AND id = $2
        AND status = 'RUNNING'
        AND assigned_executor_id = $3
    `,
    [capabilityId, runId, executorId, `desktop-executor:${executorId}`, leaseMs],
  );
};

export const renewRunLease = async ({
  capabilityId,
  runId,
  workerId,
  leaseMs,
}: {
  capabilityId: string;
  runId: string;
  workerId: string;
  leaseMs: number;
}) => {
  await query(
    `
      UPDATE capability_workflow_runs
      SET
        lease_owner = $3,
        lease_expires_at = NOW() + ($4 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      WHERE capability_id = $1
        AND id = $2
        AND status = 'RUNNING'
        AND lease_owner = $3
    `,
    [capabilityId, runId, workerId, leaseMs],
  );
};

export const releaseRunLease = async ({
  capabilityId,
  runId,
}: {
  capabilityId: string;
  runId: string;
}) => {
  if (isRemoteExecutionClient()) {
    await executionRuntimeRpc<void>('releaseRunLease', {
      capabilityId,
      runId,
    });
    return;
  }

  await query(
    `
      UPDATE capability_workflow_runs
      SET
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
    `,
    [capabilityId, runId],
  );
};

export const markOpenToolInvocationsAborted = async ({
  capabilityId,
  runId,
}: {
  capabilityId: string;
  runId: string;
}) => {
  if (isRemoteExecutionClient()) {
    await executionRuntimeRpc<void>('markOpenToolInvocationsAborted', {
      capabilityId,
      runId,
    });
    return;
  }

  await query(
    `
      UPDATE capability_tool_invocations
      SET
        status = 'FAILED',
        result_summary = COALESCE(result_summary, 'Tool invocation was interrupted and will need to be re-run.'),
        completed_at = NOW(),
        updated_at = NOW()
      WHERE capability_id = $1
        AND run_id = $2
        AND status IN ('PENDING', 'RUNNING')
    `,
    [capabilityId, runId],
  );
};

export const cancelOpenWaitsForRun = async ({
  capabilityId,
  runId,
}: {
  capabilityId: string;
  runId: string;
}) => {
  if (isRemoteExecutionClient()) {
    await executionRuntimeRpc<void>('cancelOpenWaitsForRun', {
      capabilityId,
      runId,
    });
    return;
  }

  await query(
    `
      UPDATE capability_run_waits
      SET
        status = 'CANCELLED',
        resolved_at = NOW(),
        updated_at = NOW()
      WHERE capability_id = $1
        AND run_id = $2
        AND status = 'OPEN'
    `,
    [capabilityId, runId],
  );
};
