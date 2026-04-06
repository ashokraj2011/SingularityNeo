import {
  AgentTask,
  Artifact,
  Capability,
  CapabilityAgent,
  ExecutionLog,
  MemoryReference,
  RunWait,
  RunWaitType,
  ToolAdapterId,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunStep,
  WorkItem,
  WorkItemBlocker,
  WorkItemHistoryEntry,
  WorkItemPhase,
  WorkItemPendingRequest,
  WorkItemStatus,
  WorkflowStep,
} from '../../src/types';
import { syncWorkflowManagedTasksForWorkItem } from '../../src/lib/workflowTaskAutomation';
import {
  buildCapabilitySystemPrompt,
  requestGitHubModel,
} from '../githubModels';
import { buildMemoryContext, refreshCapabilityMemory } from '../memory';
import { evaluateToolPolicy } from '../policy';
import {
  createRunEvent,
  createRunWait,
  createToolInvocation,
  getActiveRunForWorkItem,
  getLatestRunForWorkItem,
  getWorkflowRunDetail,
  insertRunEvent,
  markOpenToolInvocationsAborted,
  releaseRunLease,
  resolveRunWait,
  updateToolInvocation,
  updateWorkflowRun,
  updateWorkflowRunStep,
} from './repository';
import {
  executeTool,
  listToolDescriptions,
} from './tools';
import {
  getCapabilityBundle,
  replaceCapabilityWorkspaceContentRecord,
} from '../repository';
import {
  createTraceId,
  finishTelemetrySpan,
  recordUsageMetrics,
  startTelemetrySpan,
} from '../telemetry';

const MAX_AGENT_TOOL_LOOPS = 8;

const createHistoryId = () => `HIST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createLogId = () => `LOG-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createArtifactId = () => `ART-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

type ExecutionDecision =
  | {
      action: 'invoke_tool';
      reasoning: string;
      summary?: string;
      toolCall: {
        toolId: ToolAdapterId;
        args: Record<string, any>;
      };
    }
  | {
      action: 'complete';
      reasoning: string;
      summary: string;
    }
  | {
      action: 'pause_for_input' | 'pause_for_approval';
      reasoning: string;
      summary?: string;
      wait: {
        type: RunWaitType;
        message: string;
      };
    }
  | {
      action: 'fail';
      reasoning: string;
      summary: string;
    };

type DecisionEnvelope = {
  decision: ExecutionDecision;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  latencyMs: number;
  retrievalReferences: MemoryReference[];
};

type ProjectionContext = {
  capability: Capability;
  workspace: ReturnType<typeof mapBundleWorkspace>;
  workItem: WorkItem;
  workflow: Workflow;
};

const mapBundleWorkspace = (bundle: Awaited<ReturnType<typeof getCapabilityBundle>>) =>
  bundle.workspace;

const formatTaskTimestamp = () =>
  new Date().toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const summarizeOutput = (value: string) =>
  value.replace(/\s+/g, ' ').trim().slice(0, 280);

const createHistoryEntry = (
  actor: string,
  action: string,
  detail: string,
  phase?: WorkItemPhase,
  status?: WorkItemStatus,
): WorkItemHistoryEntry => ({
  id: createHistoryId(),
  timestamp: new Date().toISOString(),
  actor,
  action,
  detail,
  phase,
  status,
});

const createExecutionLog = ({
  capabilityId,
  taskId,
  agentId,
  message,
  level = 'INFO',
  metadata,
  runId,
  runStepId,
  toolInvocationId,
  traceId,
  latencyMs,
  costUsd,
}: {
  capabilityId: string;
  taskId: string;
  agentId: string;
  message: string;
  level?: ExecutionLog['level'];
  metadata?: Record<string, unknown>;
  runId?: string;
  runStepId?: string;
  toolInvocationId?: string;
  traceId?: string;
  latencyMs?: number;
  costUsd?: number;
}): ExecutionLog => ({
  id: createLogId(),
  capabilityId,
  taskId,
  agentId,
  timestamp: new Date().toISOString(),
  level,
  message,
  runId,
  runStepId,
  toolInvocationId,
  traceId,
  latencyMs,
  costUsd,
  metadata,
});

const toFileSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'artifact';

const formatPhaseLabel = (phase: WorkItemPhase) =>
  phase
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const buildMarkdownArtifact = (sections: Array<[string, string | undefined]>) =>
  sections
    .filter(([, value]) => Boolean(value))
    .map(([heading, value]) => `## ${heading}\n${value}`)
    .join('\n\n');

const getStepStatus = (step?: WorkflowStep): WorkItemStatus =>
  step?.stepType === 'HUMAN_APPROVAL' ? 'PENDING_APPROVAL' : 'ACTIVE';

const buildPendingRequest = (
  step: WorkflowStep | undefined,
  wait?: { type: RunWaitType; message: string },
): WorkItemPendingRequest | undefined => {
  if (!step || !wait) {
    return undefined;
  }

  return {
    type: wait.type,
    message: wait.message,
    requestedBy: step.agentId,
    timestamp: new Date().toISOString(),
  };
};

const buildBlocker = (
  step: WorkflowStep | undefined,
  wait?: { type: RunWaitType; message: string },
): WorkItemBlocker | undefined => {
  if (!step || !wait) {
    return undefined;
  }

  if (wait.type === 'APPROVAL') {
    return undefined;
  }

  return {
    type: wait.type === 'CONFLICT_RESOLUTION' ? 'CONFLICT_RESOLUTION' : 'HUMAN_INPUT',
    message: wait.message,
    requestedBy: step.agentId,
    timestamp: new Date().toISOString(),
    status: 'OPEN',
  };
};

const replaceWorkItem = (items: WorkItem[], next: WorkItem) =>
  items.map(item => (item.id === next.id ? next : item));

const replaceArtifact = (items: Artifact[], next: Artifact) => {
  const existingIndex = items.findIndex(
    artifact =>
      artifact.id === next.id ||
      (
        artifact.artifactKind === next.artifactKind &&
        (artifact.sourceWaitId || null) === (next.sourceWaitId || null) &&
        (artifact.runId || artifact.sourceRunId || null) ===
          (next.runId || next.sourceRunId || null) &&
        (artifact.runStepId || artifact.sourceRunStepId || null) ===
          (next.runStepId || next.sourceRunStepId || null)
      ),
  );

  if (existingIndex === -1) {
    return [...items, next];
  }

  return items.map((artifact, index) =>
    index === existingIndex ? next : artifact,
  );
};

const replaceArtifacts = (items: Artifact[], nextArtifacts: Artifact[]) =>
  nextArtifacts.reduce((current, artifact) => replaceArtifact(current, artifact), items);

const updateTasksForCurrentStep = ({
  tasks,
  workItem,
  step,
  run,
  runStep,
  status,
  executionNotes,
  producedOutputs,
  toolInvocationId,
}: {
  tasks: AgentTask[];
  workItem: WorkItem;
  step: WorkflowStep;
  run: WorkflowRun;
  runStep: WorkflowRunStep;
  status: AgentTask['status'];
  executionNotes?: string;
  producedOutputs?: NonNullable<AgentTask['producedOutputs']>;
  toolInvocationId?: string;
}) =>
  tasks.map(task => {
    if (task.workItemId !== workItem.id || task.workflowStepId !== step.id) {
      return task;
    }

    return {
      ...task,
      status,
      timestamp: formatTaskTimestamp(),
      runId: run.id,
      runStepId: runStep.id,
      toolInvocationId,
      executionNotes: executionNotes || task.executionNotes,
      producedOutputs: producedOutputs || task.producedOutputs,
    };
  });

const resolveProjectionContext = async (
  capabilityId: string,
  workItemId: string,
  workflowOverride?: Workflow,
): Promise<ProjectionContext> => {
  const bundle = await getCapabilityBundle(capabilityId);
  const workspace = mapBundleWorkspace(bundle);
  const workItem = workspace.workItems.find(item => item.id === workItemId);
  if (!workItem) {
    throw new Error(`Work item ${workItemId} was not found.`);
  }

  const workflow =
    workflowOverride ||
    workspace.workflows.find(item => item.id === workItem.workflowId) ||
    null;

  if (!workflow) {
    throw new Error(`Workflow ${workItem.workflowId} was not found.`);
  }

  return {
    capability: bundle.capability,
    workspace,
    workItem,
    workflow,
  };
};

const persistProjection = async ({
  capabilityId,
  workspace,
  workItem,
  workflow,
  logsToAppend = [],
  artifacts,
  taskMutator,
}: {
  capabilityId: string;
  workspace: ProjectionContext['workspace'];
  workItem: WorkItem;
  workflow: Workflow;
  logsToAppend?: ExecutionLog[];
  artifacts?: Artifact[];
  taskMutator?: (tasks: AgentTask[]) => AgentTask[];
}) => {
  const syncedTasks = syncWorkflowManagedTasksForWorkItem({
    allTasks: workspace.tasks,
    workItem,
    workflow,
    artifacts: artifacts || workspace.artifacts,
  });
  const nextTasks = taskMutator ? taskMutator(syncedTasks) : syncedTasks;

  return replaceCapabilityWorkspaceContentRecord(capabilityId, {
    workItems: replaceWorkItem(workspace.workItems, workItem),
    tasks: nextTasks,
    executionLogs: [...workspace.executionLogs, ...logsToAppend],
    artifacts: artifacts || workspace.artifacts,
  });
};

const extractJsonObject = (value: string) => {
  const trimmed = value.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1],
    trimmed.match(/```\s*([\s\S]*?)```/i)?.[1],
    trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as Record<string, any>;
    } catch {
      continue;
    }
  }

  throw new Error('Model response did not contain valid JSON.');
};

const requestStepDecision = async ({
  capability,
  workItem,
  workflow,
  step,
  runStep,
  agent,
  toolHistory,
  handoffContext,
  resolvedWaitContext,
}: {
  capability: Capability;
  workItem: WorkItem;
  workflow: Workflow;
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  agent: CapabilityAgent;
  toolHistory: Array<{ role: 'assistant' | 'user'; content: string }>;
  handoffContext?: string;
  resolvedWaitContext?: string;
}): Promise<DecisionEnvelope> => {
  const allowedToolIds = step.allowedToolIds || [];
  const toolDescriptions = allowedToolIds.length
    ? listToolDescriptions(allowedToolIds).join('\n')
    : 'No tools are allowed for this step.';
  const startedAt = Date.now();
  const memoryContext = await buildMemoryContext({
    capabilityId: capability.id || workItem.capabilityId,
    queryText: [workItem.title, workItem.description, step.action, step.name]
      .filter(Boolean)
      .join('\n'),
  });

  const response = await requestGitHubModel({
    model: agent.model,
    maxTokens: Math.min(agent.tokenLimit, 2000),
    temperature: 0.1,
    messages: [
      {
        role: 'developer',
        content:
          'You are an execution engine inside a capability workflow. Return JSON only with no markdown.',
      },
      {
        role: 'system',
        content: `${buildCapabilitySystemPrompt({
          capability,
          agent,
        })}\n\nCurrent workflow: ${workflow.name}\nCurrent step: ${step.name}\nCurrent phase: ${workItem.phase}\nCurrent step attempt: ${runStep.attemptCount}\nStep objective: ${step.action}\nStep guidance: ${step.description || 'None'}\nExecution notes: ${step.executionNotes || 'None'}\nWorkflow hand-off context from prior completed steps:\n${handoffContext || 'None'}\nResolved human input/conflict context for this step:\n${resolvedWaitContext || 'None'}\nRetrieved memory context:\n${memoryContext.prompt || 'None'}\nAllowed tools:\n${toolDescriptions}\n\nUse prior-step hand-offs, retrieved memory, and resolved human inputs as authoritative downstream context. Do not ask for information that is already present in those sections. If you truly need more input, explain exactly what new gap remains and why the existing context is insufficient.\n\nReturn JSON with one of these shapes:\n1. {"action":"invoke_tool","reasoning":"...","summary":"...","toolCall":{"toolId":"workspace_read","args":{"path":"src/index.ts"}}}\n2. {"action":"complete","reasoning":"...","summary":"..."}\n3. {"action":"pause_for_input","reasoning":"...","wait":{"type":"INPUT","message":"..."}}\n4. {"action":"pause_for_approval","reasoning":"...","wait":{"type":"APPROVAL","message":"..."}}\n5. {"action":"fail","reasoning":"...","summary":"..."}\nOnly choose tool ids from the allowed list. If no tools are allowed, either complete, pause, or fail.`,
      },
      ...toolHistory,
      {
        role: 'user',
        content: `Story title: ${workItem.title}\nStory request: ${workItem.description}\nDecide the next execution action for this workflow step.`,
      },
    ],
  });

  return {
    decision: extractJsonObject(response.content) as ExecutionDecision,
    model: response.model,
    usage: response.usage,
    latencyMs: Date.now() - startedAt,
    retrievalReferences: memoryContext.results.map(result => result.reference),
  } as DecisionEnvelope;
};

const getCurrentRunStep = (detail: WorkflowRunDetail) => {
  const runStep = detail.steps.find(
    item => item.workflowStepId === detail.run.currentStepId,
  );
  if (!runStep) {
    throw new Error(`Run ${detail.run.id} is missing its current run-step record.`);
  }
  return runStep;
};

const getCurrentWorkflowStep = (detail: WorkflowRunDetail) => {
  const step = detail.run.workflowSnapshot.steps.find(
    item => item.id === detail.run.currentStepId,
  );
  if (!step) {
    throw new Error(`Run ${detail.run.id} has no current workflow step.`);
  }
  return step;
};

const getNextWorkflowStep = (workflow: Workflow, currentStepId: string | undefined) => {
  const index = workflow.steps.findIndex(step => step.id === currentStepId);
  return index >= 0 ? workflow.steps[index + 1] : undefined;
};

const buildWorkflowHandoffContext = ({
  detail,
  workItem,
  artifacts,
}: {
  detail: WorkflowRunDetail;
  workItem: WorkItem;
  artifacts: Artifact[];
}) => {
  const currentStepIndex = detail.run.workflowSnapshot.steps.findIndex(
    step => step.id === detail.run.currentStepId,
  );
  const priorCompletedSteps = detail.steps
    .filter(
      step =>
        step.status === 'COMPLETED' &&
        (currentStepIndex === -1 || step.stepIndex < currentStepIndex),
    )
    .sort((left, right) => left.stepIndex - right.stepIndex);

  const priorStepLines = priorCompletedSteps.map(step => {
    const artifactSummaries = artifacts
      .filter(artifact => artifact.runId === detail.run.id && artifact.runStepId === step.id)
      .map(artifact =>
        artifact.summary ? `${artifact.name}: ${artifact.summary}` : artifact.name,
      );
    const resolvedInputs = detail.waits
      .filter(wait => wait.runStepId === step.id && wait.status === 'RESOLVED')
      .map(wait =>
        `${wait.type.toLowerCase().replace(/_/g, ' ')} resolved: ${wait.resolution || 'resolved'}`,
      );

    return [
      `${step.name}: ${step.outputSummary || step.evidenceSummary || 'Completed.'}`,
      resolvedInputs.length > 0
        ? `Resolved inputs: ${resolvedInputs.join(' | ')}`
        : null,
      artifactSummaries.length > 0
        ? `Artifacts: ${artifactSummaries.join(' | ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
  });

  const recentHistory = workItem.history
    .slice(-6)
    .map(entry => `${entry.action}: ${entry.detail}`);

  const runWideResolvedInputs = detail.waits
    .filter(wait => wait.status === 'RESOLVED')
    .map(wait =>
      `${wait.type.toLowerCase().replace(/_/g, ' ')} by ${wait.resolvedBy || 'unknown'}: ${wait.resolution || 'resolved'}`,
    );

  const sections = [
    priorStepLines.length > 0
      ? `Completed prior-step hand-offs:\n${priorStepLines.join('\n\n')}`
      : null,
    runWideResolvedInputs.length > 0
      ? `Resolved human inputs and decisions:\n${runWideResolvedInputs.join('\n')}`
      : null,
    recentHistory.length > 0
      ? `Recent workflow history:\n${recentHistory.join('\n')}`
      : null,
  ].filter(Boolean) as string[];

  return sections.length > 0 ? sections.join('\n\n') : undefined;
};

const buildResolvedWaitContext = ({
  detail,
  runStep,
}: {
  detail: WorkflowRunDetail;
  runStep: WorkflowRunStep;
}) => {
  const stepWaits = detail.waits
    .filter(wait => wait.runStepId === runStep.id && wait.status === 'RESOLVED')
    .map(wait =>
      [
        `Resolved ${wait.type.toLowerCase().replace(/_/g, ' ')}`,
        `requested by ${wait.requestedBy}`,
        wait.resolvedBy ? `resolved by ${wait.resolvedBy}` : null,
        wait.resolution ? `details: ${wait.resolution}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
    );

  const lastResolution =
    typeof runStep.metadata?.lastResolution === 'string'
      ? runStep.metadata.lastResolution
      : null;

  const lines = [
    ...stepWaits,
    lastResolution ? `Latest provided detail: ${lastResolution}` : null,
  ].filter(Boolean) as string[];

  return lines.length > 0 ? lines.join('\n') : undefined;
};

const syncRunningProjection = async ({
  detail,
  capability,
  agent,
  historyMessage,
}: {
  detail: WorkflowRunDetail;
  capability: Capability;
  agent: CapabilityAgent;
  historyMessage: string;
}) => {
  const projection = await resolveProjectionContext(detail.run.capabilityId, detail.run.workItemId, detail.run.workflowSnapshot);
  const currentStep = getCurrentWorkflowStep(detail);
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    phase: currentStep.phase,
    currentStepId: currentStep.id,
    assignedAgentId: currentStep.agentId,
    status: 'ACTIVE',
    pendingRequest: undefined,
    blocker: undefined,
    activeRunId: detail.run.id,
    lastRunId: detail.run.id,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(agent.name, 'Execution running', historyMessage, currentStep.phase, 'ACTIVE'),
    ],
  };

  await persistProjection({
    capabilityId: capability.id,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: detail.run.workflowSnapshot,
    logsToAppend: [
      createExecutionLog({
        capabilityId: capability.id,
        taskId: projection.workItem.id,
        agentId: agent.id,
        message: historyMessage,
        runId: detail.run.id,
        runStepId: getCurrentRunStep(detail).id,
        traceId: detail.run.traceId,
      }),
    ],
  });
};

const syncWaitingProjection = async ({
  detail,
  waitType,
  waitMessage,
}: {
  detail: WorkflowRunDetail;
  waitType: RunWaitType;
  waitMessage: string;
}) => {
  const projection = await resolveProjectionContext(detail.run.capabilityId, detail.run.workItemId, detail.run.workflowSnapshot);
  const currentStep = getCurrentWorkflowStep(detail);
  const nextStatus: WorkItemStatus =
    waitType === 'APPROVAL' ? 'PENDING_APPROVAL' : 'BLOCKED';
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    phase: currentStep.phase,
    currentStepId: currentStep.id,
    assignedAgentId: currentStep.agentId,
    status: nextStatus,
    pendingRequest: buildPendingRequest(currentStep, {
      type: waitType,
      message: waitMessage,
    }),
    blocker: buildBlocker(currentStep, {
      type: waitType,
      message: waitMessage,
    }),
    activeRunId: detail.run.id,
    lastRunId: detail.run.id,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        'System',
        waitType === 'APPROVAL' ? 'Approval requested' : 'Execution paused',
        waitMessage,
        currentStep.phase,
        nextStatus,
      ),
    ],
  };

  await persistProjection({
    capabilityId: detail.run.capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: detail.run.workflowSnapshot,
    logsToAppend: [
      createExecutionLog({
        capabilityId: detail.run.capabilityId,
        taskId: projection.workItem.id,
        agentId: currentStep.agentId,
        message: waitMessage,
        runId: detail.run.id,
        runStepId: getCurrentRunStep(detail).id,
        traceId: detail.run.traceId,
      }),
    ],
  });
};

const syncCompletedProjection = async ({
  detail,
  completedStep,
  completedRunStep,
  nextStep,
  summary,
  artifacts,
  toolInvocationId,
}: {
  detail: WorkflowRunDetail;
  completedStep: WorkflowStep;
  completedRunStep: WorkflowRunStep;
  nextStep?: WorkflowStep;
  summary: string;
  artifacts: Artifact[];
  toolInvocationId?: string;
}) => {
  const projection = await resolveProjectionContext(detail.run.capabilityId, detail.run.workItemId, detail.run.workflowSnapshot);
  const primaryArtifact =
    artifacts.find(artifact => artifact.artifactKind === 'PHASE_OUTPUT') || artifacts[0];
  const nextWorkItem: WorkItem = nextStep
    ? {
        ...projection.workItem,
        phase: nextStep.phase,
        currentStepId: nextStep.id,
        assignedAgentId: nextStep.agentId,
        status: getStepStatus(nextStep),
        pendingRequest: undefined,
        blocker: undefined,
        activeRunId: detail.run.id,
        lastRunId: detail.run.id,
        history: [
          ...projection.workItem.history,
          createHistoryEntry(
            completedStep.agentId,
            'Execution completed',
            `${completedStep.name} completed. ${summary}`,
            nextStep.phase,
            getStepStatus(nextStep),
          ),
        ],
      }
    : {
        ...projection.workItem,
        phase: 'DONE',
        currentStepId: undefined,
        assignedAgentId: undefined,
        status: 'COMPLETED',
        pendingRequest: undefined,
        blocker: undefined,
        activeRunId: undefined,
        lastRunId: detail.run.id,
        history: [
          ...projection.workItem.history,
          createHistoryEntry(
            completedStep.agentId,
            'Story completed',
            summary,
            'DONE',
            'COMPLETED',
          ),
        ],
      };

  const nextArtifacts = replaceArtifacts(projection.workspace.artifacts, artifacts);
  await persistProjection({
    capabilityId: detail.run.capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: detail.run.workflowSnapshot,
    artifacts: nextArtifacts,
    taskMutator: tasks =>
      updateTasksForCurrentStep({
        tasks,
        workItem: nextWorkItem,
        step: completedStep,
        run: detail.run,
        runStep: completedRunStep,
        status: 'COMPLETED',
        executionNotes: `${completedStep.name} completed. ${summary}`,
        producedOutputs: [
          {
            name: primaryArtifact?.name || `${completedStep.name} Output`,
            status: 'completed',
            artifactId: primaryArtifact?.id,
            runId: detail.run.id,
            runStepId: completedRunStep.id,
          },
        ],
        toolInvocationId,
      }),
    logsToAppend: [
      createExecutionLog({
        capabilityId: detail.run.capabilityId,
        taskId: projection.workItem.id,
        agentId: completedStep.agentId,
        message: nextStep
          ? `${completedStep.name} completed and advanced to ${nextStep.name}.`
          : `${projection.workItem.title} completed successfully.`,
        runId: detail.run.id,
        runStepId: completedRunStep.id,
        toolInvocationId,
        traceId: detail.run.traceId,
        metadata: {
          outputSummary: summary,
          outputTitle: primaryArtifact?.name || `${completedStep.name} Output`,
          artifactId: primaryArtifact?.id,
          outputStatus: 'completed',
        },
      }),
    ],
  });
};

const syncFailedProjection = async ({
  detail,
  message,
}: {
  detail: WorkflowRunDetail;
  message: string;
}) => {
  const projection = await resolveProjectionContext(detail.run.capabilityId, detail.run.workItemId, detail.run.workflowSnapshot);
  const currentStep = getCurrentWorkflowStep(detail);
  const runStep = getCurrentRunStep(detail);
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    phase: currentStep.phase,
    currentStepId: currentStep.id,
    assignedAgentId: currentStep.agentId,
    status: 'BLOCKED',
    pendingRequest: {
      type: 'CONFLICT_RESOLUTION',
      message,
      requestedBy: currentStep.agentId,
      timestamp: new Date().toISOString(),
    },
    blocker: {
      type: 'CONFLICT_RESOLUTION',
      message,
      requestedBy: currentStep.agentId,
      timestamp: new Date().toISOString(),
      status: 'OPEN',
    },
    activeRunId: undefined,
    lastRunId: detail.run.id,
    history: [
      ...projection.workItem.history,
      createHistoryEntry('System', 'Execution failed', message, currentStep.phase, 'BLOCKED'),
    ],
  };

  await persistProjection({
    capabilityId: detail.run.capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: detail.run.workflowSnapshot,
    taskMutator: tasks =>
      updateTasksForCurrentStep({
        tasks,
        workItem: nextWorkItem,
        step: currentStep,
        run: detail.run,
        runStep,
        status: 'ALERT',
        executionNotes: message,
      }),
    logsToAppend: [
      createExecutionLog({
        capabilityId: detail.run.capabilityId,
        taskId: projection.workItem.id,
        agentId: currentStep.agentId,
        message,
        level: 'ERROR',
        runId: detail.run.id,
        runStepId: runStep.id,
        traceId: detail.run.traceId,
      }),
    ],
  });
};

const buildArtifactFromStepCompletion = ({
  detail,
  step,
  summary,
  toolInvocationId,
  retrievalReferences,
  costUsd,
  latencyMs,
}: {
  detail: WorkflowRunDetail;
  step: WorkflowStep;
  summary: string;
  toolInvocationId?: string;
  retrievalReferences?: MemoryReference[];
  costUsd?: number;
  latencyMs?: number;
}): Artifact => ({
  id: createArtifactId(),
  name: `${step.name} Output`,
  capabilityId: detail.run.capabilityId,
  type:
    step.phase === 'QA'
      ? 'Test Evidence'
      : step.stepType === 'GOVERNANCE_GATE'
      ? 'Governance Evidence'
      : 'Execution Output',
  version: `run-${detail.run.attemptNumber}`,
  agent: step.agentId,
  created: new Date().toISOString(),
  direction: 'OUTPUT',
  connectedAgentId: step.agentId,
  sourceWorkflowId: detail.run.workflowId,
  runId: detail.run.id,
  runStepId: getCurrentRunStep(detail).id,
  toolInvocationId,
  summary,
  artifactKind: 'PHASE_OUTPUT',
  phase: step.phase,
  workItemId: detail.run.workItemId,
  sourceRunId: detail.run.id,
  sourceRunStepId: getCurrentRunStep(detail).id,
  contentFormat: 'MARKDOWN',
  mimeType: 'text/markdown',
  fileName: `${toFileSlug(detail.run.workItemId)}-${toFileSlug(step.name)}-output.md`,
  contentText: `# ${step.name} Output\n\n${buildMarkdownArtifact([
    ['Work Item', `${detail.run.workItemId}`],
    ['Phase', formatPhaseLabel(step.phase)],
    ['Agent', step.agentId],
    ['Summary', summary],
  ])}`,
  downloadable: true,
  traceId: detail.run.traceId,
  latencyMs,
  costUsd,
  retrievalReferences,
});

const buildHandoffArtifact = ({
  detail,
  step,
  nextStep,
  runStep,
  summary,
}: {
  detail: WorkflowRunDetail;
  step: WorkflowStep;
  nextStep: WorkflowStep;
  runStep: WorkflowRunStep;
  summary: string;
}): Artifact => ({
  id: createArtifactId(),
  name: `${step.name} to ${nextStep.name} Handoff`,
  capabilityId: detail.run.capabilityId,
  type: 'Handoff Packet',
  version: `run-${detail.run.attemptNumber}`,
  agent: step.agentId,
  created: new Date().toISOString(),
  direction: 'OUTPUT',
  connectedAgentId: nextStep.agentId,
  sourceWorkflowId: detail.run.workflowId,
  runId: detail.run.id,
  runStepId: runStep.id,
  summary: `Handoff from ${step.name} to ${nextStep.name}. ${summary}`,
  artifactKind: 'HANDOFF_PACKET',
  phase: nextStep.phase,
  workItemId: detail.run.workItemId,
  sourceRunId: detail.run.id,
  sourceRunStepId: runStep.id,
  handoffFromAgentId: step.agentId,
  handoffToAgentId: nextStep.agentId,
  contentFormat: 'MARKDOWN',
  mimeType: 'text/markdown',
  fileName: `${toFileSlug(detail.run.workItemId)}-${toFileSlug(step.name)}-handoff.md`,
  contentText: `# ${step.name} to ${nextStep.name} Handoff\n\n${buildMarkdownArtifact([
    ['Work Item', detail.run.workItemId],
    ['Source Phase', formatPhaseLabel(step.phase)],
    ['Target Phase', formatPhaseLabel(nextStep.phase)],
    ['Source Agent', step.agentId],
    ['Target Agent', nextStep.agentId],
    ['Carry Forward Summary', summary],
  ])}`,
  downloadable: true,
  traceId: detail.run.traceId,
});

const buildHumanInteractionArtifact = ({
  detail,
  step,
  runStep,
  wait,
  resolution,
  resolvedBy,
}: {
  detail: WorkflowRunDetail;
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  wait: RunWait;
  resolution: string;
  resolvedBy: string;
}): Artifact => {
  const artifactKind =
    wait.type === 'APPROVAL'
      ? 'APPROVAL_RECORD'
      : wait.type === 'CONFLICT_RESOLUTION'
      ? 'CONFLICT_RESOLUTION'
      : 'INPUT_NOTE';

  const artifactName =
    wait.type === 'APPROVAL'
      ? `${step.name} Approval Record`
      : wait.type === 'CONFLICT_RESOLUTION'
      ? `${step.name} Conflict Resolution`
      : `${step.name} Human Input Note`;

  return {
    id: createArtifactId(),
    name: artifactName,
    capabilityId: detail.run.capabilityId,
    type: 'Human Interaction',
    version: `run-${detail.run.attemptNumber}`,
    agent: wait.requestedBy,
    created: wait.resolvedAt || new Date().toISOString(),
    direction: 'OUTPUT',
    connectedAgentId: step.agentId,
    sourceWorkflowId: detail.run.workflowId,
    runId: detail.run.id,
    runStepId: runStep.id,
    summary: resolution,
    artifactKind,
    phase: step.phase,
    workItemId: detail.run.workItemId,
    sourceRunId: detail.run.id,
    sourceRunStepId: runStep.id,
    sourceWaitId: wait.id,
    contentFormat: 'MARKDOWN',
    mimeType: 'text/markdown',
    fileName: `${toFileSlug(detail.run.workItemId)}-${toFileSlug(wait.type)}-${toFileSlug(step.name)}.md`,
    contentText: `# ${artifactName}\n\n${buildMarkdownArtifact([
      ['Work Item', detail.run.workItemId],
      ['Phase', formatPhaseLabel(step.phase)],
      ['Requested By', wait.requestedBy],
      ['Request', wait.message],
      ['Resolved By', resolvedBy],
      ['Resolution', resolution],
    ])}`,
    downloadable: true,
    traceId: detail.run.traceId,
  };
};

export const createWorkItemRecord = async ({
  capabilityId,
  title,
  description,
  workflowId,
  priority,
  tags,
}: {
  capabilityId: string;
  title: string;
  description?: string;
  workflowId: string;
  priority: WorkItem['priority'];
  tags: string[];
}) => {
  const bundle = await getCapabilityBundle(capabilityId);
  const workflow = bundle.workspace.workflows.find(item => item.id === workflowId);
  if (!workflow) {
    throw new Error(`Workflow ${workflowId} was not found.`);
  }

  const firstStep = workflow.steps[0];
  if (!firstStep) {
    throw new Error(`Workflow ${workflow.name} does not define any steps.`);
  }

  const nextWorkItem: WorkItem = {
    id: `WI-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    title: title.trim(),
    description: description?.trim() || `Delivery story for ${bundle.capability.name}.`,
    phase: firstStep.phase,
    capabilityId,
    workflowId,
    currentStepId: firstStep.id,
    assignedAgentId: firstStep.agentId,
    status: getStepStatus(firstStep),
    priority,
    tags,
    history: [
      createHistoryEntry(
        'System',
        'Story created',
        `Story entered ${firstStep.name} in ${workflow.name}.`,
        firstStep.phase,
        getStepStatus(firstStep),
      ),
    ],
  };

  const nextTasks = syncWorkflowManagedTasksForWorkItem({
    allTasks: bundle.workspace.tasks,
    workItem: nextWorkItem,
    workflow,
    artifacts: bundle.workspace.artifacts,
  });

  await replaceCapabilityWorkspaceContentRecord(capabilityId, {
    workItems: [...bundle.workspace.workItems, nextWorkItem],
    tasks: nextTasks,
    executionLogs: [
      ...bundle.workspace.executionLogs,
      createExecutionLog({
        capabilityId,
        taskId: nextWorkItem.id,
        agentId: firstStep.agentId,
        message: `${nextWorkItem.title} entered ${firstStep.name} in ${workflow.name}.`,
        traceId: undefined,
      }),
    ],
  });
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);

  return nextWorkItem;
};

export const moveWorkItemToPhaseControl = async ({
  capabilityId,
  workItemId,
  targetPhase,
  note,
}: {
  capabilityId: string;
  workItemId: string;
  targetPhase: WorkItemPhase;
  note?: string;
}) => {
  if (await getActiveRunForWorkItem(capabilityId, workItemId)) {
    throw new Error(
      'This work item already has an active or waiting run. Cancel or complete it before moving the board card.',
    );
  }

  const projection = await resolveProjectionContext(capabilityId, workItemId);
  const targetStep =
    targetPhase === 'BACKLOG' || targetPhase === 'DONE'
      ? undefined
      : projection.workflow.steps.find(step => step.phase === targetPhase) ||
        projection.workflow.steps[0];

  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    phase: targetPhase,
    currentStepId:
      targetPhase === 'BACKLOG' || targetPhase === 'DONE'
        ? undefined
        : targetStep?.id,
    assignedAgentId:
      targetPhase === 'BACKLOG' || targetPhase === 'DONE'
        ? undefined
        : targetStep?.agentId,
    status:
      targetPhase === 'DONE'
        ? 'COMPLETED'
        : targetStep
        ? getStepStatus(targetStep)
        : 'ACTIVE',
    pendingRequest: undefined,
    blocker: undefined,
    activeRunId: undefined,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        'User',
        'Board stage updated',
        note ||
          `Story was moved to ${targetPhase} from the delivery board.`,
        targetPhase,
        targetPhase === 'DONE' ? 'COMPLETED' : targetStep ? getStepStatus(targetStep) : 'ACTIVE',
      ),
    ],
  };

  await persistProjection({
    capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: projection.workflow,
    logsToAppend: [
      createExecutionLog({
        capabilityId,
        taskId: workItemId,
        agentId: targetStep?.agentId || projection.capability.specialAgentId || 'SYSTEM',
        message: note || `${projection.workItem.title} moved to ${targetPhase}.`,
      }),
    ],
  });
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);

  return nextWorkItem;
};

export const startWorkflowExecution = async ({
  capabilityId,
  workItemId,
  restartFromPhase,
}: {
  capabilityId: string;
  workItemId: string;
  restartFromPhase?: WorkItemPhase;
}) => {
  const projection = await resolveProjectionContext(capabilityId, workItemId);
  const detail = await (await import('./repository')).createWorkflowRun({
    capabilityId,
    workItem: projection.workItem,
    workflow: projection.workflow,
    restartFromPhase,
  });

  await syncRunningProjection({
    detail,
    capability: projection.capability,
    agent:
      projection.workspace.agents.find(agent => agent.id === detail.run.assignedAgentId) ||
      projection.workspace.agents[0],
    historyMessage: `Workflow run ${detail.run.id} queued for execution.`,
  });

  return detail;
};

const resolveRunWaitAndQueue = async ({
  capabilityId,
  runId,
  expectedType,
  resolution,
  resolvedBy,
}: {
  capabilityId: string;
  runId: string;
  expectedType: RunWaitType;
  resolution: string;
  resolvedBy: string;
}) => {
  const detail = await getWorkflowRunDetail(capabilityId, runId);
  const openWait = [...detail.waits].reverse().find(wait => wait.status === 'OPEN');
  if (!openWait) {
    throw new Error(`Run ${runId} does not have an open wait to resolve.`);
  }
  if (openWait.type !== expectedType) {
    throw new Error(`Run ${runId} is waiting for ${openWait.type}, not ${expectedType}.`);
  }

  await resolveRunWait({
    capabilityId,
    waitId: openWait.id,
    resolution,
    resolvedBy,
  });

  const currentStep = getCurrentWorkflowStep(detail);
  const currentRunStep = getCurrentRunStep(detail);
  let nextRun = detail.run;
  let nextRunStep = currentRunStep;
  let nextWorkflowStep: WorkflowStep | undefined;

  if (expectedType === 'APPROVAL' && currentStep.stepType === 'HUMAN_APPROVAL') {
    const nextStep = getNextWorkflowStep(detail.run.workflowSnapshot, currentStep.id);
    nextWorkflowStep = nextStep;
    nextRunStep = await updateWorkflowRunStep({
      ...currentRunStep,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      evidenceSummary: resolution,
      outputSummary: resolution,
      waitId: openWait.id,
    });

    nextRun = (
      await updateWorkflowRun({
        ...detail.run,
        status: nextStep ? 'QUEUED' : 'COMPLETED',
        currentStepId: nextStep?.id,
        currentPhase: nextStep?.phase || 'DONE',
        assignedAgentId: nextStep?.agentId,
        pauseReason: undefined,
        currentWaitId: undefined,
        completedAt: nextStep ? undefined : new Date().toISOString(),
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        terminalOutcome: nextStep ? undefined : resolution,
      })
    ).run;
  } else {
    nextRunStep = await updateWorkflowRunStep({
      ...currentRunStep,
      status: 'PENDING',
      waitId: openWait.id,
      metadata: {
        ...(currentRunStep.metadata || {}),
        lastResolution: resolution,
      },
    });

    nextRun = (
      await updateWorkflowRun({
        ...detail.run,
        status: 'QUEUED',
        pauseReason: undefined,
        currentWaitId: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      })
    ).run;
  }

  await insertRunEvent(
    createRunEvent({
      capabilityId,
      runId,
      workItemId: detail.run.workItemId,
      runStepId: nextRunStep.id,
      traceId: detail.run.traceId,
      spanId: currentRunStep.spanId,
      type: 'RUN_RESUMED',
      level: 'INFO',
      message: resolution,
      details: {
        waitType: expectedType,
        resolvedBy,
      },
    }),
  );

  const nextDetail = await getWorkflowRunDetail(capabilityId, nextRun.id);
  const interactionArtifact = buildHumanInteractionArtifact({
    detail,
    step: currentStep,
    runStep: currentRunStep,
    wait: openWait,
    resolution,
    resolvedBy,
  });

  if (expectedType === 'APPROVAL' && currentStep.stepType === 'HUMAN_APPROVAL') {
    const handoffArtifact = nextWorkflowStep
      ? buildHandoffArtifact({
          detail,
          step: currentStep,
          nextStep: nextWorkflowStep,
          runStep: currentRunStep,
          summary: resolution,
        })
      : null;

    await syncCompletedProjection({
      detail: nextDetail,
      completedStep: currentStep,
      completedRunStep: nextRunStep,
      nextStep: nextWorkflowStep,
      summary: resolution,
      artifacts: handoffArtifact
        ? [interactionArtifact, handoffArtifact]
        : [interactionArtifact],
    });

    return nextDetail;
  }

  const projection = await resolveProjectionContext(
    capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  const nextArtifacts = replaceArtifacts(projection.workspace.artifacts, [interactionArtifact]);
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    pendingRequest: undefined,
    blocker: undefined,
    status: 'ACTIVE',
    activeRunId: nextRun.id,
    lastRunId: nextRun.id,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        resolvedBy,
        expectedType === 'CONFLICT_RESOLUTION' ? 'Conflict resolved' : 'Human input provided',
        resolution,
        projection.workItem.phase,
        'ACTIVE',
      ),
    ],
  };

  await persistProjection({
    capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: detail.run.workflowSnapshot,
    artifacts: nextArtifacts,
    logsToAppend: [
      createExecutionLog({
        capabilityId,
        taskId: projection.workItem.id,
        agentId: currentStep.agentId,
        message: resolution,
        runId: detail.run.id,
        runStepId: currentRunStep.id,
        traceId: detail.run.traceId,
        metadata: {
          waitId: openWait.id,
          waitType: expectedType,
          resolvedBy,
          artifactId: interactionArtifact.id,
        },
      }),
    ],
  });
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);

  return nextDetail;
};

export const approveWorkflowRun = async ({
  capabilityId,
  runId,
  resolution,
  resolvedBy,
}: {
  capabilityId: string;
  runId: string;
  resolution: string;
  resolvedBy: string;
}) =>
  resolveRunWaitAndQueue({
    capabilityId,
    runId,
    expectedType: 'APPROVAL',
    resolution,
    resolvedBy,
  });

export const provideWorkflowRunInput = async ({
  capabilityId,
  runId,
  resolution,
  resolvedBy,
}: {
  capabilityId: string;
  runId: string;
  resolution: string;
  resolvedBy: string;
}) =>
  resolveRunWaitAndQueue({
    capabilityId,
    runId,
    expectedType: 'INPUT',
    resolution,
    resolvedBy,
  });

export const resolveWorkflowRunConflict = async ({
  capabilityId,
  runId,
  resolution,
  resolvedBy,
}: {
  capabilityId: string;
  runId: string;
  resolution: string;
  resolvedBy: string;
}) =>
  resolveRunWaitAndQueue({
    capabilityId,
    runId,
    expectedType: 'CONFLICT_RESOLUTION',
    resolution,
    resolvedBy,
  });

export const cancelWorkflowRun = async ({
  capabilityId,
  runId,
  note,
}: {
  capabilityId: string;
  runId: string;
  note?: string;
}) => {
  const detail = await getWorkflowRunDetail(capabilityId, runId);
  await updateWorkflowRun({
    ...detail.run,
    status: 'CANCELLED',
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    terminalOutcome: note || 'Run cancelled by user.',
    completedAt: new Date().toISOString(),
    currentWaitId: undefined,
  });
  await releaseRunLease({ capabilityId, runId });

  const projection = await resolveProjectionContext(capabilityId, detail.run.workItemId, detail.run.workflowSnapshot);
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    activeRunId: undefined,
    lastRunId: runId,
    history: [
      ...projection.workItem.history,
      createHistoryEntry('User', 'Run cancelled', note || 'Run cancelled by user.', projection.workItem.phase, projection.workItem.status),
    ],
  };

  await persistProjection({
    capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: projection.workflow,
    logsToAppend: [
      createExecutionLog({
        capabilityId,
        taskId: projection.workItem.id,
        agentId: projection.workItem.assignedAgentId || 'SYSTEM',
        message: note || 'Run cancelled by user.',
        level: 'WARN',
        runId,
        traceId: detail.run.traceId,
      }),
    ],
  });

  return getWorkflowRunDetail(capabilityId, runId);
};

export const restartWorkflowRun = async ({
  capabilityId,
  runId,
  restartFromPhase,
}: {
  capabilityId: string;
  runId: string;
  restartFromPhase?: WorkItemPhase;
}) => {
  const latest = await getWorkflowRunDetail(capabilityId, runId);
  return startWorkflowExecution({
    capabilityId,
    workItemId: latest.run.workItemId,
    restartFromPhase:
      restartFromPhase || latest.run.restartFromPhase || latest.run.currentPhase,
  });
};

const completeRunWithWait = async ({
  detail,
  waitType,
  waitMessage,
}: {
  detail: WorkflowRunDetail;
  waitType: RunWaitType;
  waitMessage: string;
}) => {
  const currentRunStep = getCurrentRunStep(detail);
  const wait = await createRunWait({
    capabilityId: detail.run.capabilityId,
    runId: detail.run.id,
    runStepId: currentRunStep.id,
    traceId: detail.run.traceId,
    spanId: currentRunStep.spanId,
    type: waitType,
    status: 'OPEN',
    message: waitMessage,
    requestedBy: currentRunStep.agentId,
    payload: {
      stepName: currentRunStep.name,
    },
  });
  await updateWorkflowRunStep({
    ...currentRunStep,
    status: 'WAITING',
    waitId: wait.id,
  });
  const nextRun = (
    await updateWorkflowRun({
      ...detail.run,
      status:
        waitType === 'APPROVAL'
          ? 'WAITING_APPROVAL'
          : waitType === 'INPUT'
          ? 'WAITING_INPUT'
          : 'WAITING_CONFLICT',
      pauseReason: waitType,
      currentWaitId: wait.id,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    })
  ).run;
  const nextDetail = await getWorkflowRunDetail(detail.run.capabilityId, nextRun.id);
  await syncWaitingProjection({
    detail: nextDetail,
    waitType,
    waitMessage,
  });
  await refreshCapabilityMemory(detail.run.capabilityId).catch(() => undefined);
  await releaseRunLease({
    capabilityId: detail.run.capabilityId,
    runId: detail.run.id,
  });
  return nextDetail;
};

const failRun = async ({
  detail,
  message,
}: {
  detail: WorkflowRunDetail;
  message: string;
}) => {
  const currentRunStep = getCurrentRunStep(detail);
  await updateWorkflowRunStep({
    ...currentRunStep,
    status: 'FAILED',
    completedAt: new Date().toISOString(),
    outputSummary: message,
    evidenceSummary: message,
  });
  const nextRun = (
    await updateWorkflowRun({
      ...detail.run,
      status: 'FAILED',
      terminalOutcome: message,
      completedAt: new Date().toISOString(),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      currentWaitId: undefined,
    })
  ).run;
  const nextDetail = await getWorkflowRunDetail(detail.run.capabilityId, nextRun.id);
  await syncFailedProjection({
    detail: nextDetail,
    message,
  });
  await refreshCapabilityMemory(detail.run.capabilityId).catch(() => undefined);
  await releaseRunLease({
    capabilityId: detail.run.capabilityId,
    runId: detail.run.id,
  });
  return nextDetail;
};

const executeAutomatedStep = async (
  detail: WorkflowRunDetail,
): Promise<WorkflowRunDetail> => {
  const projection = await resolveProjectionContext(
    detail.run.capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  const step = getCurrentWorkflowStep(detail);
  const runStep = getCurrentRunStep(detail);
  const agent =
    projection.workspace.agents.find(item => item.id === step.agentId) ||
    projection.workspace.agents[0];
  const traceId = detail.run.traceId || createTraceId();

  let currentRunStep = await updateWorkflowRunStep({
    ...runStep,
    status: 'RUNNING',
    attemptCount: runStep.attemptCount + 1,
    startedAt: runStep.startedAt || new Date().toISOString(),
    spanId: runStep.spanId || createTraceId().slice(0, 16),
  });
  const updatedRun = (
    await updateWorkflowRun({
      ...detail.run,
      status: 'RUNNING',
      startedAt: detail.run.startedAt || new Date().toISOString(),
      currentStepId: step.id,
      currentPhase: step.phase,
      assignedAgentId: step.agentId,
      traceId,
    })
  ).run;
  const runningDetail = await getWorkflowRunDetail(detail.run.capabilityId, updatedRun.id);
  const stepSpan = await startTelemetrySpan({
    capabilityId: detail.run.capabilityId,
    traceId,
    parentSpanId: undefined,
    entityType: 'STEP',
    entityId: currentRunStep.id,
    name: `${step.name} execution`,
    status: 'RUNNING',
    model: agent.model,
    attributes: {
      workItemId: detail.run.workItemId,
      workflowId: detail.run.workflowId,
      phase: step.phase,
      stepType: step.stepType,
    },
  });
  currentRunStep = await updateWorkflowRunStep({
    ...currentRunStep,
    spanId: stepSpan.id,
  });
  await syncRunningProjection({
    detail: runningDetail,
    capability: projection.capability,
    agent,
    historyMessage: `${step.name} is now executing on the backend worker.`,
  });

  const toolHistory: Array<{ role: 'assistant' | 'user'; content: string }> = [];
  let hasApprovedDeployment = runningDetail.steps.some(
    item => item.stepType === 'HUMAN_APPROVAL' && item.status === 'COMPLETED',
  ) || runningDetail.waits.some(
    wait => wait.type === 'APPROVAL' && wait.status === 'RESOLVED',
  );
  const handoffContext = buildWorkflowHandoffContext({
    detail: runningDetail,
    workItem: projection.workItem,
    artifacts: projection.workspace.artifacts,
  });
  const resolvedWaitContext = buildResolvedWaitContext({
    detail: runningDetail,
    runStep: currentRunStep,
  });

  for (let iteration = 0; iteration < MAX_AGENT_TOOL_LOOPS; iteration += 1) {
    const decisionEnvelope = await requestStepDecision({
      capability: projection.capability,
      workItem: projection.workItem,
      workflow: detail.run.workflowSnapshot,
      step,
      runStep: currentRunStep,
      agent,
      toolHistory,
      handoffContext,
      resolvedWaitContext,
    });
    const decision = decisionEnvelope.decision;
    currentRunStep = await updateWorkflowRunStep({
      ...currentRunStep,
      retrievalReferences: decisionEnvelope.retrievalReferences,
      metadata: {
        ...(currentRunStep.metadata || {}),
        lastDecisionModel: decisionEnvelope.model,
        lastDecisionTokens: decisionEnvelope.usage.totalTokens,
      },
    });
    await recordUsageMetrics({
      capabilityId: detail.run.capabilityId,
      traceId,
      scopeType: 'STEP',
      scopeId: currentRunStep.id,
      latencyMs: decisionEnvelope.latencyMs,
      totalTokens: decisionEnvelope.usage.totalTokens,
      costUsd: decisionEnvelope.usage.estimatedCostUsd,
      tags: {
        phase: step.phase,
        model: decisionEnvelope.model,
      },
    });

    if (decision.action === 'invoke_tool') {
      const allowedToolIds = step.allowedToolIds || [];
      if (!allowedToolIds.includes(decision.toolCall.toolId)) {
        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: stepSpan.id,
          status: 'ERROR',
          costUsd: decisionEnvelope.usage.estimatedCostUsd,
          tokenUsage: decisionEnvelope.usage,
          attributes: {
            reason: `Tool ${decision.toolCall.toolId} is not allowed for ${step.name}.`,
          },
        });
        return failRun({
          detail: runningDetail,
          message: `Tool ${decision.toolCall.toolId} is not allowed for ${step.name}.`,
        });
      }

      const policyDecision = await evaluateToolPolicy({
        capability: projection.capability,
        traceId,
        toolId: decision.toolCall.toolId,
        requestedByAgentId: agent.id,
        runId: detail.run.id,
        runStepId: currentRunStep.id,
        targetId:
          typeof decision.toolCall.args?.path === 'string'
            ? decision.toolCall.args.path
            : typeof decision.toolCall.args?.templateId === 'string'
            ? decision.toolCall.args.templateId
            : undefined,
        hasApprovalBypass: hasApprovedDeployment,
      });

      if (policyDecision.decision === 'DENY') {
        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: stepSpan.id,
          status: 'ERROR',
          costUsd: decisionEnvelope.usage.estimatedCostUsd,
          tokenUsage: decisionEnvelope.usage,
          attributes: {
            policyDecisionId: policyDecision.id,
            policyResult: policyDecision.decision,
          },
        });
        return failRun({
          detail: runningDetail,
          message: policyDecision.reason,
        });
      }

      if (policyDecision.decision === 'REQUIRE_APPROVAL') {
        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: stepSpan.id,
          status: 'WAITING',
          costUsd: decisionEnvelope.usage.estimatedCostUsd,
          tokenUsage: decisionEnvelope.usage,
          attributes: {
            policyDecisionId: policyDecision.id,
            policyResult: policyDecision.decision,
          },
        });
        return completeRunWithWait({
          detail: runningDetail,
          waitType: 'APPROVAL',
          waitMessage: policyDecision.reason,
        });
      }

      const toolInvocationId = `TOOL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      const toolSpan = await startTelemetrySpan({
        capabilityId: detail.run.capabilityId,
        traceId,
        parentSpanId: stepSpan.id,
        entityType: 'TOOL',
        entityId: toolInvocationId,
        name: `${decision.toolCall.toolId} tool`,
        status: 'RUNNING',
        attributes: {
          stepName: step.name,
          toolId: decision.toolCall.toolId,
          policyDecisionId: policyDecision.id,
        },
      });
      const toolInvocation = await createToolInvocation({
        id: toolInvocationId,
        capabilityId: detail.run.capabilityId,
        runId: detail.run.id,
        runStepId: currentRunStep.id,
        traceId,
        spanId: toolSpan.id,
        toolId: decision.toolCall.toolId,
        status: 'RUNNING',
        request: decision.toolCall.args || {},
        retryable: false,
        policyDecisionId: policyDecision.id,
        startedAt: new Date().toISOString(),
      });
      const toolStartedAt = Date.now();

      try {
        const result = await executeTool({
          capability: projection.capability,
          agent,
          toolId: decision.toolCall.toolId,
          args: decision.toolCall.args || {},
          requireApprovedDeployment: hasApprovedDeployment,
        });
        const toolLatency = Date.now() - toolStartedAt;
        const completedTool = await updateToolInvocation({
          ...toolInvocation,
          status: 'COMPLETED',
          resultSummary: result.summary,
          workingDirectory: result.workingDirectory,
          exitCode: result.exitCode,
          stdoutPreview: result.stdoutPreview,
          stderrPreview: result.stderrPreview,
          retryable: result.retryable,
          sandboxProfile: result.sandboxProfile,
          latencyMs: toolLatency,
          completedAt: new Date().toISOString(),
        });
        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: toolSpan.id,
          status: 'OK',
          attributes: {
            sandboxProfile: result.sandboxProfile,
            policyDecisionId: policyDecision.id,
          },
        });
        await recordUsageMetrics({
          capabilityId: detail.run.capabilityId,
          traceId,
          scopeType: 'TOOL',
          scopeId: completedTool.id,
          latencyMs: toolLatency,
          tags: {
            toolId: completedTool.toolId,
            sandbox: result.sandboxProfile || 'unknown',
          },
        });
        await insertRunEvent(
          createRunEvent({
            capabilityId: detail.run.capabilityId,
            runId: detail.run.id,
            workItemId: detail.run.workItemId,
            runStepId: currentRunStep.id,
            toolInvocationId: completedTool.id,
            traceId,
            spanId: toolSpan.id,
            type: 'TOOL_COMPLETED',
            level: 'INFO',
            message: result.summary,
            details: result.details,
          }),
        );
        toolHistory.push({
          role: 'assistant',
          content: JSON.stringify(decision),
        });
        toolHistory.push({
          role: 'user',
          content: `Tool ${completedTool.toolId} result:\n${JSON.stringify(
            {
              summary: result.summary,
              details: result.details,
              stdoutPreview: result.stdoutPreview,
              stderrPreview: result.stderrPreview,
            },
            null,
            2,
          )}`,
        });
        currentRunStep = await updateWorkflowRunStep({
          ...currentRunStep,
          lastToolInvocationId: completedTool.id,
          metadata: {
            ...(currentRunStep.metadata || {}),
            lastToolSummary: result.summary,
          },
        });
        continue;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Tool execution failed unexpectedly.';
        await updateToolInvocation({
          ...toolInvocation,
          status: 'FAILED',
          resultSummary: message,
          sandboxProfile: toolInvocation.sandboxProfile,
          completedAt: new Date().toISOString(),
        });
        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: toolSpan.id,
          status: 'ERROR',
          attributes: {
            error: message,
            policyDecisionId: policyDecision.id,
          },
        });
        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: stepSpan.id,
          status: 'ERROR',
          costUsd: decisionEnvelope.usage.estimatedCostUsd,
          tokenUsage: decisionEnvelope.usage,
          attributes: {
            error: message,
          },
        });
        return failRun({
          detail: runningDetail,
          message,
        });
      }
    }

    if (decision.action === 'complete') {
      const artifact = buildArtifactFromStepCompletion({
        detail: runningDetail,
        step,
        summary: decision.summary,
        retrievalReferences: decisionEnvelope.retrievalReferences,
        costUsd: decisionEnvelope.usage.estimatedCostUsd,
        latencyMs: decisionEnvelope.latencyMs,
      });
      currentRunStep = await updateWorkflowRunStep({
        ...currentRunStep,
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        evidenceSummary: decision.reasoning,
        outputSummary: decision.summary,
        retrievalReferences: decisionEnvelope.retrievalReferences,
      });
      const nextStep = getNextWorkflowStep(detail.run.workflowSnapshot, step.id);
      const nextRun = (
        await updateWorkflowRun({
          ...updatedRun,
          status: nextStep ? 'RUNNING' : 'COMPLETED',
          currentStepId: nextStep?.id,
          currentPhase: nextStep?.phase || 'DONE',
          assignedAgentId: nextStep?.agentId,
          completedAt: nextStep ? undefined : new Date().toISOString(),
          terminalOutcome: nextStep ? undefined : decision.summary,
        })
      ).run;
      const nextDetail = await getWorkflowRunDetail(detail.run.capabilityId, nextRun.id);
      const handoffArtifact = nextStep
        ? buildHandoffArtifact({
            detail: runningDetail,
            step,
            nextStep,
            runStep: currentRunStep,
            summary: decision.summary,
          })
        : null;
      await syncCompletedProjection({
        detail: nextDetail,
        completedStep: step,
        completedRunStep: currentRunStep,
        nextStep,
        summary: decision.summary,
        artifacts: handoffArtifact ? [artifact, handoffArtifact] : [artifact],
      });
      await finishTelemetrySpan({
        capabilityId: detail.run.capabilityId,
        spanId: stepSpan.id,
        status: 'OK',
        costUsd: decisionEnvelope.usage.estimatedCostUsd,
        tokenUsage: decisionEnvelope.usage,
        attributes: {
          outputSummary: decision.summary,
        },
      });
      await refreshCapabilityMemory(detail.run.capabilityId).catch(() => undefined);

      if (!nextStep) {
        await releaseRunLease({
          capabilityId: detail.run.capabilityId,
          runId: detail.run.id,
        });
      }

      return nextDetail;
    }

    if (decision.action === 'pause_for_input' || decision.action === 'pause_for_approval') {
      await finishTelemetrySpan({
        capabilityId: detail.run.capabilityId,
        spanId: stepSpan.id,
        status: 'WAITING',
        costUsd: decisionEnvelope.usage.estimatedCostUsd,
        tokenUsage: decisionEnvelope.usage,
        attributes: {
          waitType: decision.wait.type,
          waitMessage: decision.wait.message,
        },
      });
      return completeRunWithWait({
        detail: runningDetail,
        waitType: decision.wait.type,
        waitMessage: decision.wait.message,
      });
    }

    if (decision.action === 'fail') {
      await finishTelemetrySpan({
        capabilityId: detail.run.capabilityId,
        spanId: stepSpan.id,
        status: 'ERROR',
        costUsd: decisionEnvelope.usage.estimatedCostUsd,
        tokenUsage: decisionEnvelope.usage,
        attributes: {
          error: decision.summary,
        },
      });
      return failRun({
        detail: runningDetail,
        message: decision.summary,
      });
    }
  }

  await finishTelemetrySpan({
    capabilityId: detail.run.capabilityId,
    spanId: stepSpan.id,
    status: 'ERROR',
    attributes: {
      error: `${step.name} exceeded the maximum tool loop iterations.`,
    },
  });
  return failRun({
    detail: runningDetail,
    message: `${step.name} exceeded the maximum tool loop iterations.`,
  });
};

export const processWorkflowRun = async (
  detail: WorkflowRunDetail,
): Promise<WorkflowRunDetail> => {
  await markOpenToolInvocationsAborted({
    capabilityId: detail.run.capabilityId,
    runId: detail.run.id,
  });

  let currentDetail = detail;
  for (let index = 0; index < currentDetail.run.workflowSnapshot.steps.length + 1; index += 1) {
    const currentStep = getCurrentWorkflowStep(currentDetail);
    if (currentStep.stepType === 'HUMAN_APPROVAL') {
      return completeRunWithWait({
        detail: currentDetail,
        waitType: 'APPROVAL',
        waitMessage:
          currentStep.approverRoles?.length
            ? `${currentStep.name} is waiting for ${currentStep.approverRoles.join(', ')} approval.`
            : `${currentStep.name} is waiting for human approval.`,
      });
    }

    currentDetail = await executeAutomatedStep(currentDetail);
    if (
      currentDetail.run.status === 'COMPLETED' ||
      currentDetail.run.status === 'FAILED' ||
      currentDetail.run.status === 'WAITING_APPROVAL' ||
      currentDetail.run.status === 'WAITING_INPUT' ||
      currentDetail.run.status === 'WAITING_CONFLICT' ||
      currentDetail.run.status === 'CANCELLED'
    ) {
      return currentDetail;
    }
  }

  return failRun({
    detail: currentDetail,
    message: 'Workflow execution exceeded the maximum step transitions.',
  });
};
