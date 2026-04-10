import type { PoolClient } from 'pg';
import {
  RunEvent,
  RunWait,
  ToolInvocation,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunStep,
  WorkflowRunStatus,
  WorkItem,
  WorkItemPhase,
} from '../../src/types';
import { query, transaction } from '../db';
import { publishRunEvent } from '../eventBus';
import { createSpanId, createTraceId } from '../telemetry';
import {
  buildWorkflowFromGraph,
  findFirstExecutableNode,
  findFirstExecutableNodeForPhase,
  getDisplayStepIdForNode,
  getWorkflowNodeOrder,
  getWorkflowNodes,
  normalizeWorkflowGraph,
} from '../../src/lib/workflowGraph';

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value || '');

const asJson = <T>(value: unknown, fallback: T): T =>
  value && typeof value === 'object' ? (value as T) : fallback;

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
  'WAITING_APPROVAL',
  'WAITING_INPUT',
  'WAITING_CONFLICT',
];

const runFromRow = (row: Record<string, any>): WorkflowRun => ({
  id: row.id,
  capabilityId: row.capability_id,
  workItemId: row.work_item_id,
  workflowId: row.workflow_id,
  status: row.status,
  attemptNumber: Number(row.attempt_number || 1),
  workflowSnapshot: buildWorkflowFromGraph(
    normalizeWorkflowGraph(
      asJson<Workflow>(row.workflow_snapshot, {
        id: row.workflow_id,
        capabilityId: row.capability_id,
        name: 'Workflow',
        steps: [],
        status: 'STABLE',
      }),
    ),
  ),
  currentNodeId: row.current_node_id || undefined,
  currentStepId: row.current_step_id || undefined,
  currentPhase: row.current_phase || undefined,
  assignedAgentId: row.assigned_agent_id || undefined,
  branchState: asJson(row.branch_state, undefined),
  pauseReason: row.pause_reason || undefined,
  currentWaitId: row.current_wait_id || undefined,
  terminalOutcome: row.terminal_outcome || undefined,
  restartFromPhase: row.restart_from_phase || undefined,
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
  resolution: row.resolution || undefined,
  resolvedBy: row.resolved_by || undefined,
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

  if (!runResult.rowCount) {
    throw new Error(`Workflow run ${runId} was not found.`);
  }

  return {
    run: runFromRow(runResult.rows[0]),
    steps: stepResult.rows.map(stepFromRow),
    waits: waitResult.rows.map(waitFromRow),
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
  transaction(client => getRunDetailTx(client, capabilityId, runId));

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
}: {
  capabilityId: string;
  workItem: WorkItem;
  workflow: Workflow;
  restartFromPhase?: WorkItemPhase;
}): Promise<WorkflowRunDetail> =>
  transaction(async client => {
    const normalizedWorkflow = buildWorkflowFromGraph(normalizeWorkflowGraph(workflow));
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
    const run: WorkflowRun = {
      id: runId,
      capabilityId,
      workItemId: workItem.id,
      workflowId: normalizedWorkflow.id,
      status: 'QUEUED',
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
          attempt_number,
          workflow_snapshot,
          current_node_id,
          current_step_id,
          current_phase,
          assigned_agent_id,
          branch_state,
          restart_from_phase,
          trace_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `,
      [
        capabilityId,
        run.id,
        workItem.id,
        normalizedWorkflow.id,
        run.status,
        run.attemptNumber,
        JSON.stringify(normalizedWorkflow),
        run.currentNodeId || null,
        run.currentStepId || null,
        run.currentPhase || null,
        run.assignedAgentId || null,
        JSON.stringify(run.branchState || {}),
        run.restartFromPhase || null,
        run.traceId,
      ],
    );

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

export const updateWorkflowRun = async (run: WorkflowRun): Promise<WorkflowRunDetail> =>
  transaction(async client => {
    await client.query(
      `
        UPDATE capability_workflow_runs
        SET
          status = $3,
          workflow_snapshot = $4,
          current_node_id = $5,
          current_step_id = $6,
          current_phase = $7,
          assigned_agent_id = $8,
          branch_state = $9,
          pause_reason = $10,
          current_wait_id = $11,
          terminal_outcome = $12,
          restart_from_phase = $13,
          trace_id = $14,
          lease_owner = $15,
          lease_expires_at = $16,
          started_at = $17,
          completed_at = $18,
          updated_at = NOW()
        WHERE capability_id = $1 AND id = $2
      `,
      [
        run.capabilityId,
        run.id,
        run.status,
        JSON.stringify(buildWorkflowFromGraph(normalizeWorkflowGraph(run.workflowSnapshot))),
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
      ],
    );

    return getRunDetailTx(client, run.capabilityId, run.id);
  });

export const updateWorkflowRunStep = async (
  step: WorkflowRunStep,
): Promise<WorkflowRunStep> =>
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
        payload,
        created_at,
        resolved_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
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
}: {
  capabilityId: string;
  waitId: string;
  resolution: string;
  resolvedBy: string;
}): Promise<RunWait> => {
  const result = await query(
    `
      UPDATE capability_run_waits
      SET
        status = 'RESOLVED',
        resolution = $3,
        resolved_by = $4,
        resolved_at = NOW(),
        updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
      RETURNING *
    `,
    [capabilityId, waitId, resolution, resolvedBy],
  );

  if (!result.rowCount) {
    throw new Error(`Run wait ${waitId} was not found.`);
  }

  return waitFromRow(result.rows[0]);
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
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
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
      invocation.createdAt || new Date().toISOString(),
    ],
  );

  return toolFromRow(result.rows[0]);
};

export const updateToolInvocation = async (
  invocation: ToolInvocation,
): Promise<ToolInvocation> => {
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
          ORDER BY updated_at ASC
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
      WHERE capability_id = $1 AND id = $2
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
