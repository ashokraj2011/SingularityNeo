import {
  Artifact,
  ArtifactContentResponse,
  CompletedWorkOrderDetail,
  CompletedWorkOrderSummary,
  HumanInteractionRecord,
  LedgerArtifactRecord,
  PhaseEvidenceGroup,
  RunEvent,
  RunWait,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
  WorkItem,
  WorkItemPhase,
  WorkItemStatus,
} from '../src/types';
import { getLifecyclePhaseLabel } from '../src/lib/capabilityLifecycle';
import { query } from './db';
import {
  getWorkflowRunDetail,
  listWorkflowRunEvents,
  listWorkflowRunsByCapability,
  listWorkflowRunsForWorkItem,
} from './execution/repository';
import { getCapabilityArtifact, getCapabilityArtifactFileMeta, getCapabilityBundle } from './repository';

const ACTIVE_RUN_STATUSES = new Set([
  'QUEUED',
  'RUNNING',
  'WAITING_APPROVAL',
  'WAITING_INPUT',
  'WAITING_CONFLICT',
]);

const sortIsoDesc = (left?: string, right?: string) =>
  String(right || '').localeCompare(String(left || ''));

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value || '');

const toSafeFileSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'evidence';

const waitFromRow = (row: Record<string, any>): RunWait => ({
  id: row.id,
  capabilityId: row.capability_id,
  runId: row.run_id,
  runStepId: row.run_step_id,
  type: row.type,
  status: row.status,
  message: row.message,
  requestedBy: row.requested_by,
  resolution: row.resolution || undefined,
  resolvedBy: row.resolved_by || undefined,
  payload: row.payload || undefined,
  createdAt:
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  resolvedAt:
    row.resolved_at instanceof Date ? row.resolved_at.toISOString() : row.resolved_at || undefined,
});

const eventFromRow = (row: Record<string, any>): RunEvent => ({
  id: row.id,
  capabilityId: row.capability_id,
  runId: row.run_id,
  workItemId: row.work_item_id,
  timestamp: row.timestamp,
  level: row.level,
  type: row.type,
  message: row.message,
  runStepId: row.run_step_id || undefined,
  toolInvocationId: row.tool_invocation_id || undefined,
  details: row.details || undefined,
});

const mapRunStatusToWorkItemStatus = (status: string): WorkItemStatus => {
  if (status === 'COMPLETED') {
    return 'COMPLETED';
  }
  if (status === 'WAITING_APPROVAL') {
    return 'PENDING_APPROVAL';
  }
  if (status === 'WAITING_INPUT' || status === 'WAITING_CONFLICT' || status === 'FAILED') {
    return 'BLOCKED';
  }
  return 'ACTIVE';
};

const buildFallbackWorkItem = ({
  capabilityId,
  workItemId,
  run,
  taskTitle,
}: {
  capabilityId: string;
  workItemId: string;
  run: WorkflowRun;
  taskTitle?: string;
}): WorkItem => ({
  id: workItemId,
  title: (taskTitle || `Recovered ${workItemId}`).split(' · ')[0].trim(),
  description: `Recovered from workflow execution history for ${workItemId}.`,
  phase: run.status === 'COMPLETED' ? 'DONE' : (run.currentPhase || 'BACKLOG'),
  capabilityId,
  workflowId: run.workflowId,
  currentStepId: run.currentStepId || undefined,
  assignedAgentId: run.assignedAgentId || undefined,
  status: mapRunStatusToWorkItemStatus(run.status),
  priority: 'Med',
  tags: [],
  activeRunId: ACTIVE_RUN_STATUSES.has(run.status) ? run.id : undefined,
  lastRunId: run.id,
  history: [],
});

const buildArtifactContent = (
  artifact: Artifact,
  fileMeta?: { sizeBytes: number; sha256: string } | null,
): ArtifactContentResponse => {
  const hasBinary = Boolean(fileMeta);
  const sizeBytes = fileMeta?.sizeBytes;

  let contentFormat: ArtifactContentResponse['contentFormat'];
  if (artifact.contentFormat) {
    contentFormat = artifact.contentFormat;
  } else if (artifact.contentJson) {
    contentFormat = 'JSON';
  } else if (artifact.contentText) {
    contentFormat = artifact.mimeType === 'text/plain' ? 'TEXT' : 'MARKDOWN';
  } else if (hasBinary) {
    contentFormat = 'BINARY';
  } else {
    contentFormat = artifact.mimeType === 'text/plain' ? 'TEXT' : 'MARKDOWN';
  }

  const mimeType =
    artifact.mimeType ||
    (contentFormat === 'JSON'
      ? 'application/json; charset=utf-8'
      : contentFormat === 'TEXT'
      ? 'text/plain; charset=utf-8'
      : contentFormat === 'MARKDOWN'
      ? 'text/markdown; charset=utf-8'
      : 'application/octet-stream');

  const fileName =
    artifact.fileName ||
    `${toSafeFileSlug(artifact.name)}.${
      contentFormat === 'JSON'
        ? 'json'
        : contentFormat === 'TEXT'
        ? 'txt'
        : contentFormat === 'MARKDOWN'
        ? 'md'
        : 'bin'
    }`;

  if (contentFormat === 'BINARY') {
    return {
      artifact,
      contentFormat,
      mimeType,
      fileName,
      hasBinary,
      sizeBytes,
    };
  }

  const fallbackText = [
    `# ${artifact.name}`,
    artifact.summary ? `Summary: ${artifact.summary}` : null,
    artifact.description ? `Description: ${artifact.description}` : null,
    artifact.type ? `Type: ${artifact.type}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    artifact,
    contentFormat,
    mimeType,
    fileName,
    hasBinary,
    sizeBytes,
    contentText:
      artifact.contentText || (contentFormat === 'JSON' ? undefined : fallbackText),
    contentJson: artifact.contentJson,
  };
};

const artifactSummaryFromRow = (row: Record<string, any>): Artifact => ({
  id: row.id,
  name: row.name,
  capabilityId: row.capability_id,
  type: row.type,
  version: row.version,
  agent: row.agent,
  created: row.created,
  description: row.description || undefined,
  connectedAgentId: row.connected_agent_id || undefined,
  runId: row.run_id || undefined,
  summary: row.summary || undefined,
  workItemId: row.work_item_id || undefined,
  artifactKind: row.artifact_kind || undefined,
  phase: row.phase || undefined,
  sourceRunId: row.source_run_id || undefined,
  handoffFromAgentId: row.handoff_from_agent_id || undefined,
  handoffToAgentId: row.handoff_to_agent_id || undefined,
});

const workflowRunSummaryFromRow = (row: Record<string, any>): WorkflowRun => ({
  id: row.id,
  capabilityId: row.capability_id,
  workItemId: row.work_item_id,
  workflowId: row.workflow_id,
  status: row.status,
  attemptNumber: Number(row.attempt_number || 1),
  workflowSnapshot: {
    id: row.workflow_id,
    capabilityId: row.capability_id,
    name: 'Workflow',
    steps: [],
    status: 'STABLE',
  } as Workflow,
  currentNodeId: row.current_node_id || undefined,
  currentStepId: row.current_step_id || undefined,
  currentPhase: row.current_phase || undefined,
  assignedAgentId: row.assigned_agent_id || undefined,
  branchState: undefined,
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

const buildHumanInteractionRecords = ({
  waits,
  runsById,
  workItemsById,
  stepContextByRunStepId,
  agentsById,
  artifacts,
}: {
  waits: RunWait[];
  runsById: Map<string, WorkflowRun>;
  workItemsById: Map<string, WorkItem>;
  stepContextByRunStepId: Map<string, { phase?: WorkItemPhase; stepName?: string }>;
  agentsById: Map<string, string>;
  artifacts: Artifact[];
}): HumanInteractionRecord[] => {
  const artifactByWaitId = new Map(
    artifacts
      .filter(artifact => artifact.sourceWaitId)
      .map(artifact => [artifact.sourceWaitId as string, artifact.id]),
  );

  return waits
    .map(wait => {
      const run = runsById.get(wait.runId);
      const workItem = run ? workItemsById.get(run.workItemId) : undefined;
      const stepContext = stepContextByRunStepId.get(wait.runStepId);

      return {
        id: wait.id,
        capabilityId: wait.capabilityId,
        workItemId: run?.workItemId,
        workItemTitle: workItem?.title,
        runId: wait.runId,
        runStepId: wait.runStepId,
        waitId: wait.id,
        phase: stepContext?.phase,
        stepName: stepContext?.stepName,
        interactionType: wait.type,
        status: wait.status,
        message: wait.message,
        requestedBy: wait.requestedBy,
        requestedByName: agentsById.get(wait.requestedBy),
        createdAt: wait.createdAt,
        resolution: wait.resolution,
        resolvedBy: wait.resolvedBy,
        resolvedByName: wait.resolvedBy ? agentsById.get(wait.resolvedBy) : undefined,
        resolvedAt: wait.resolvedAt,
        artifactId: artifactByWaitId.get(wait.id),
      };
    })
    .sort((left, right) => sortIsoDesc(left.resolvedAt || left.createdAt, right.resolvedAt || right.createdAt));
};

const buildLedgerArtifactRecords = ({
  artifacts,
  workItemsById,
  runsById,
  agentsById,
  stepContextByRunStepId,
}: {
  artifacts: Artifact[];
  workItemsById: Map<string, WorkItem>;
  runsById: Map<string, WorkflowRun>;
  agentsById: Map<string, string>;
  stepContextByRunStepId?: Map<
    string,
    { phase?: WorkItemPhase; stepName?: string; stepType?: string }
  >;
}): LedgerArtifactRecord[] =>
  artifacts
    .map(artifact => {
      const runId = artifact.sourceRunId || artifact.runId;
      const run = runId ? runsById.get(runId) : undefined;
      const workItemId = artifact.workItemId || run?.workItemId;
      const workItem = workItemId ? workItemsById.get(workItemId) : undefined;
      const stepContext = stepContextByRunStepId?.get(
        artifact.sourceRunStepId || artifact.runStepId || '',
      );

      return {
        artifact: {
          ...artifact,
          workItemId,
          contentText: undefined,
          contentJson: undefined,
          retrievalReferences: undefined,
        },
        workItemTitle: workItem?.title,
        runStatus: run?.status,
        stepName: stepContext?.stepName,
        stepType: stepContext?.stepType as LedgerArtifactRecord['stepType'],
        runAttempt: run?.attemptNumber,
        sourceAgentName: agentsById.get(
          artifact.handoffFromAgentId || artifact.connectedAgentId || artifact.agent,
        ),
        targetAgentName: artifact.handoffToAgentId
          ? agentsById.get(artifact.handoffToAgentId)
          : undefined,
      };
    })
    .sort((left, right) => sortIsoDesc(left.artifact.created, right.artifact.created));

const buildStepContextByRunStepId = (runDetails: WorkflowRunDetail[]) => {
  const map = new Map<
    string,
    { phase?: WorkItemPhase; stepName?: string; stepType?: string; runId?: string }
  >();

  runDetails.forEach(detail => {
    detail.steps.forEach(step => {
      map.set(step.id, {
        phase: step.phase,
        stepName: step.name,
        stepType: step.stepType,
        runId: detail.run.id,
      });
    });
  });

  return map;
};

const buildCompletedWorkOrders = async (
  capabilityId: string,
): Promise<{
  workItemsById: Map<string, WorkItem>;
  runsByWorkItemId: Map<string, WorkflowRun[]>;
  artifacts: Artifact[];
  waits: RunWait[];
  events: RunEvent[];
  bundle: Awaited<ReturnType<typeof getCapabilityBundle>>;
}> => {
  const [bundle, runs, waitRows, eventRows] = await Promise.all([
    getCapabilityBundle(capabilityId),
    listWorkflowRunsByCapability(capabilityId),
    query('SELECT * FROM capability_run_waits WHERE capability_id = $1 ORDER BY created_at DESC, id DESC', [
      capabilityId,
    ]),
    query(
      'SELECT * FROM capability_run_events WHERE capability_id = $1 ORDER BY created_at DESC, id DESC',
      [capabilityId],
    ),
  ]);

  const workItemsById = new Map(bundle.workspace.workItems.map(workItem => [workItem.id, workItem]));
  const taskTitleByWorkItemId = new Map(
    bundle.workspace.tasks
      .filter(task => task.workItemId)
      .map(task => [task.workItemId as string, task.title]),
  );
  const runsByWorkItemId = new Map<string, WorkflowRun[]>();

  runs.forEach(run => {
    if (!workItemsById.has(run.workItemId)) {
      workItemsById.set(
        run.workItemId,
        buildFallbackWorkItem({
          capabilityId,
          workItemId: run.workItemId,
          run,
          taskTitle: taskTitleByWorkItemId.get(run.workItemId),
        }),
      );
    }

    const current = runsByWorkItemId.get(run.workItemId) || [];
    current.push(run);
    current.sort((left, right) => sortIsoDesc(left.createdAt, right.createdAt));
    runsByWorkItemId.set(run.workItemId, current);
  });

  return {
    workItemsById,
    runsByWorkItemId,
    artifacts: bundle.workspace.artifacts,
    waits: waitRows.rows.map(waitFromRow),
    events: eventRows.rows.map(eventFromRow),
    bundle,
  };
};

export const listLedgerArtifacts = async (
  capabilityId: string,
): Promise<LedgerArtifactRecord[]> => {
  const [artifactResult, workItemResult, agentResult, taskResult, runsResult] = await Promise.all([
    query(
      `
        SELECT
          id,
          name,
          capability_id,
          type,
          version,
          agent,
          created,
          description,
          connected_agent_id,
          run_id,
          summary,
          work_item_id,
          artifact_kind,
          phase,
          source_run_id,
          handoff_from_agent_id,
          handoff_to_agent_id
        FROM capability_artifacts
        WHERE capability_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [capabilityId],
    ),
    query(
      `
        SELECT id, title
        FROM capability_work_items
        WHERE capability_id = $1
      `,
      [capabilityId],
    ),
    query(
      `
        SELECT id, name
        FROM capability_agents
        WHERE capability_id = $1
      `,
      [capabilityId],
    ),
    query(
      `
        SELECT work_item_id, title
        FROM capability_tasks
        WHERE capability_id = $1
          AND work_item_id IS NOT NULL
      `,
      [capabilityId],
    ),
    query(
      `
        SELECT
          id,
          capability_id,
          work_item_id,
          workflow_id,
          status,
          attempt_number,
          current_node_id,
          current_step_id,
          current_phase,
          assigned_agent_id,
          pause_reason,
          current_wait_id,
          terminal_outcome,
          restart_from_phase,
          trace_id,
          lease_owner,
          lease_expires_at,
          started_at,
          completed_at,
          created_at,
          updated_at
        FROM capability_workflow_runs
        WHERE capability_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [capabilityId],
    ),
  ]);

  const workItemsById = new Map<string, WorkItem>(
    workItemResult.rows.map(row => {
      const workItemRow = row as { id: string; title: string };
      return [
        String(workItemRow.id),
        {
          id: String(workItemRow.id),
          title: String(workItemRow.title),
        } as WorkItem,
      ];
    }),
  );
  const taskTitleByWorkItemId = new Map<string, string>(
    taskResult.rows.map(row => {
      const taskRow = row as { work_item_id: string; title: string };
      return [String(taskRow.work_item_id), String(taskRow.title)];
    }),
  );

  const runs = runsResult.rows.map(workflowRunSummaryFromRow);

  runs.forEach(run => {
    if (!workItemsById.has(run.workItemId)) {
      workItemsById.set(
        run.workItemId,
        buildFallbackWorkItem({
          capabilityId,
          workItemId: run.workItemId,
          run,
          taskTitle: taskTitleByWorkItemId.get(run.workItemId),
        }),
      );
    }
  });

  const runsById = new Map(runs.map(run => [run.id, run]));
  const agentsById = new Map<string, string>(
    agentResult.rows.map(row => {
      const agentRow = row as { id: string; name: string };
      return [String(agentRow.id), String(agentRow.name)];
    }),
  );

  return buildLedgerArtifactRecords({
    artifacts: artifactResult.rows.map(artifactSummaryFromRow),
    workItemsById,
    runsById,
    agentsById,
  });
};

export const listCompletedWorkOrders = async (
  capabilityId: string,
): Promise<CompletedWorkOrderSummary[]> => {
  const { bundle, workItemsById, runsByWorkItemId, artifacts, waits, events } =
    await buildCompletedWorkOrders(capabilityId);

  const summaries = Array.from(workItemsById.values())
    .filter(workItem => {
      const runs = runsByWorkItemId.get(workItem.id) || [];
      const workflowTasks = bundle.workspace.tasks.filter(
        task => task.workItemId === workItem.id && task.managedByWorkflow,
      );
      const hasLegacyCompletedFlow =
        workflowTasks.length > 0 &&
        workflowTasks.every(task => task.status === 'COMPLETED');
      return (
        workItem.status === 'COMPLETED' ||
        runs.some(run => run.status === 'COMPLETED') ||
        hasLegacyCompletedFlow
      );
    })
    .map(workItem => {
      const runHistory = runsByWorkItemId.get(workItem.id) || [];
      const latestCompletedRun = runHistory.find(run => run.status === 'COMPLETED');
      const workflowTasks = bundle.workspace.tasks.filter(
        task => task.workItemId === workItem.id && task.managedByWorkflow,
      );
      const hasLegacyCompletedFlow =
        workflowTasks.length > 0 &&
        workflowTasks.every(task => task.status === 'COMPLETED');
      const displayWorkItem =
        (latestCompletedRun || hasLegacyCompletedFlow) && workItem.status !== 'COMPLETED'
          ? {
              ...workItem,
              phase: 'DONE' as WorkItemPhase,
              status: 'COMPLETED' as WorkItemStatus,
              activeRunId: undefined,
              lastRunId: latestCompletedRun?.id || workItem.lastRunId,
            }
          : workItem;
      const runIds = new Set(runHistory.map(run => run.id));
      const relatedArtifacts = artifacts.filter(artifact => {
        const artifactWorkItemId =
          artifact.workItemId ||
          (artifact.sourceRunId ? runHistory.find(run => run.id === artifact.sourceRunId)?.workItemId : undefined) ||
          (artifact.runId ? runHistory.find(run => run.id === artifact.runId)?.workItemId : undefined);
        return artifactWorkItemId === workItem.id;
      });
      const relatedWaits = waits.filter(wait => runIds.has(wait.runId));
      const relatedEvents = events.filter(event => runIds.has(event.runId));
      const relatedLogs = bundle.workspace.executionLogs.filter(
        log => log.taskId === workItem.id || (log.runId ? runIds.has(log.runId) : false),
      );

      return {
        workItem: displayWorkItem,
        latestCompletedRun,
        supersededRuns: runHistory.filter(run => run.id !== latestCompletedRun?.id),
        artifactCount: relatedArtifacts.length,
        handoffCount: relatedArtifacts.filter(
          artifact => artifact.artifactKind === 'HANDOFF_PACKET',
        ).length,
        interactionCount: relatedWaits.length,
        eventCount: relatedEvents.length,
        logCount: relatedLogs.length,
        completedAt:
          latestCompletedRun?.completedAt ||
          latestCompletedRun?.updatedAt ||
          workflowTasks[workflowTasks.length - 1]?.timestamp,
      };
    })
    .sort((left, right) => sortIsoDesc(left.completedAt, right.completedAt));

  return summaries;
};

export const getCompletedWorkOrderEvidence = async (
  capabilityId: string,
  workItemId: string,
): Promise<CompletedWorkOrderDetail> => {
  const { bundle, workItemsById } = await buildCompletedWorkOrders(capabilityId);
  const workItem =
    workItemsById.get(workItemId) ||
    bundle.workspace.workItems.find(current => current.id === workItemId);

  const runHistory = await listWorkflowRunsForWorkItem(capabilityId, workItemId);
  if (!workItem && runHistory.length === 0) {
    throw new Error(`Work item ${workItemId} was not found.`);
  }

  const runDetails = await Promise.all(
    runHistory.map(run => getWorkflowRunDetail(capabilityId, run.id)),
  );
  const eventLists = await Promise.all(
    runHistory.map(run => listWorkflowRunEvents(capabilityId, run.id)),
  );
  const latestCompletedRun =
    runHistory.find(run => run.status === 'COMPLETED') || runHistory[0] || undefined;
  const workflowTasks = bundle.workspace.tasks.filter(
    task => task.workItemId === workItemId && task.managedByWorkflow,
  );
  const hasLegacyCompletedFlow =
    workflowTasks.length > 0 &&
    workflowTasks.every(task => task.status === 'COMPLETED');
  const latestRunDetail = latestCompletedRun
    ? runDetails.find(detail => detail.run.id === latestCompletedRun.id)
    : undefined;
  const runsById = new Map(runHistory.map(run => [run.id, run]));
  const stepContextByRunStepId = buildStepContextByRunStepId(runDetails);
  const agentsById = new Map(bundle.workspace.agents.map(agent => [agent.id, agent.name]));
  const allArtifacts = bundle.workspace.artifacts.filter(artifact => {
    const artifactRunId = artifact.sourceRunId || artifact.runId;
    const artifactWorkItemId =
      artifact.workItemId ||
      (artifactRunId ? runsById.get(artifactRunId)?.workItemId : undefined);
    return artifactWorkItemId === workItemId;
  });
  const artifactRecords = buildLedgerArtifactRecords({
    artifacts: allArtifacts,
    workItemsById,
    runsById,
    agentsById,
    stepContextByRunStepId,
  });
  const waits = runDetails.flatMap(detail => detail.waits);
  const humanInteractions = buildHumanInteractionRecords({
    waits,
    runsById,
    workItemsById,
    stepContextByRunStepId,
    agentsById,
    artifacts: allArtifacts,
  });
  const events = eventLists.flat().sort((left, right) => sortIsoDesc(left.timestamp, right.timestamp));
  const logs = bundle.workspace.executionLogs
    .filter(log => log.taskId === workItemId || (log.runId ? runsById.has(log.runId) : false))
    .sort((left, right) => sortIsoDesc(left.timestamp, right.timestamp));
  const phaseGroups: PhaseEvidenceGroup[] = latestRunDetail
    ? latestRunDetail.steps.map(step => ({
        phase: step.phase,
        label: getLifecyclePhaseLabel(bundle.capability, step.phase),
        stepName: step.name,
        stepType: step.stepType,
        artifacts: artifactRecords.filter(
          record =>
            record.artifact.artifactKind !== 'HANDOFF_PACKET' &&
            (record.artifact.sourceRunStepId || record.artifact.runStepId) === step.id,
        ),
        handoffArtifacts: artifactRecords.filter(
          record =>
            record.artifact.artifactKind === 'HANDOFF_PACKET' &&
            (record.artifact.sourceRunStepId || record.artifact.runStepId) === step.id,
        ),
        toolInvocations: latestRunDetail.toolInvocations.filter(
          tool => tool.runStepId === step.id,
        ),
        logs: logs.filter(log => log.runId === latestRunDetail.run.id && log.runStepId === step.id),
        events: events.filter(
          event => event.runId === latestRunDetail.run.id && event.runStepId === step.id,
        ),
        interactions: humanInteractions.filter(
          interaction =>
            interaction.runId === latestRunDetail.run.id &&
            interaction.runStepId === step.id,
        ),
      }))
    : [];

  return {
    workItem:
      (workItem &&
      (latestCompletedRun || hasLegacyCompletedFlow) &&
      workItem.status !== 'COMPLETED'
        ? {
            ...workItem,
            phase: 'DONE',
            status: 'COMPLETED',
            activeRunId: undefined,
            lastRunId: latestCompletedRun?.id || workItem.lastRunId,
          }
        : workItem) ||
      buildFallbackWorkItem({
        capabilityId,
        workItemId,
        run: latestCompletedRun || runHistory[0],
      }),
    workflow:
      latestRunDetail?.run.workflowSnapshot ||
      bundle.workspace.workflows.find(workflow => workflow.id === workItem?.workflowId),
    latestCompletedRun,
    runHistory,
    latestRunDetail,
    artifacts: artifactRecords,
    humanInteractions,
    phaseGroups,
    events,
    logs,
  };
};

export const getLedgerArtifactContent = async (
  capabilityId: string,
  artifactId: string,
): Promise<ArtifactContentResponse> => {
  const artifact = await getCapabilityArtifact(capabilityId, artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} was not found.`);
  }

  const fileMeta = await getCapabilityArtifactFileMeta(capabilityId, artifactId);
  return buildArtifactContent(artifact, fileMeta);
};

export const buildWorkItemEvidenceBundle = async (
  capabilityId: string,
  workItemId: string,
) => {
  const detail = await getCompletedWorkOrderEvidence(capabilityId, workItemId);
  return {
    generatedAt: new Date().toISOString(),
    capabilityId,
    workItemId,
    detail,
  };
};
