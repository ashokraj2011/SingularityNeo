import fs from 'node:fs';
import path from 'node:path';
import {
  AgentTask,
  Artifact,
  Capability,
  CapabilityAgent,
  ContrarianConflictReview,
  ExecutionLog,
  MemoryReference,
  RunWait,
  RunEvent,
  RunWaitType,
  ToolAdapterId,
  Workflow,
  WorkflowEdge,
  WorkflowEdgeConditionType,
  WorkflowNode,
  WorkflowRun,
  WorkflowRunBranchState,
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
  getCapabilityBoardPhaseIds,
  getLifecyclePhaseLabel,
} from '../../src/lib/capabilityLifecycle';
import { isTestingWorkflowStep } from '../../src/lib/workflowStepSemantics';
import {
  findFirstExecutableNode,
  findFirstExecutableNodeForPhase,
  getDisplayStepIdForNode,
  getIncomingWorkflowEdges,
  getOutgoingWorkflowEdges,
  getWorkflowNode,
  getWorkflowNodeOrder,
  getWorkflowNodes,
  isWorkflowControlNode,
  isVisibleWorkflowNode,
} from '../../src/lib/workflowGraph';
import { invokeScopedCapabilitySession } from '../githubModels';
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
  updateRunWaitPayload,
  updateWorkflowRun,
  updateWorkflowRunStep,
} from './repository';
import {
  executeTool,
  listToolDescriptions,
} from './tools';
import { captureCodeDiffReviewArtifact } from './codeDiff';
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
import { getCapabilityWorkspaceRoots } from '../workspacePaths';

const MAX_AGENT_TOOL_LOOPS = 8;

const createHistoryId = () => `HIST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createLogId = () => `LOG-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createArtifactId = () => `ART-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const detectWorkspaceProfile = (workspaceRoots: string[]) => {
  const sampledFiles: string[] = [];
  let detectedStack = 'Generic text/code workspace';

  for (const root of workspaceRoots) {
    if (!root || !fs.existsSync(root)) {
      continue;
    }

    const candidates = [
      'pyproject.toml',
      'requirements.txt',
      'setup.py',
      'Pipfile',
      'pytest.ini',
      'tox.ini',
      'package.json',
      'README.md',
      'calculator.py',
    ];

    for (const relativePath of candidates) {
      const absolutePath = path.join(root, relativePath);
      if (fs.existsSync(absolutePath)) {
        sampledFiles.push(relativePath);
      }
    }

    const topLevel = fs.readdirSync(root, { withFileTypes: true }).slice(0, 80);
    const nestedPythonEntry = topLevel.find(entry => {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        return false;
      }
      return fs.existsSync(path.join(root, entry.name, 'pyproject.toml')) ||
        fs.existsSync(path.join(root, entry.name, 'requirements.txt')) ||
        fs.existsSync(path.join(root, entry.name, 'setup.py')) ||
        fs.existsSync(path.join(root, entry.name, 'calculator.py'));
    });

    if (nestedPythonEntry) {
      const nestedRoot = nestedPythonEntry.name;
      ['pyproject.toml', 'requirements.txt', 'setup.py', 'calculator.py', 'README.md'].forEach(file => {
        if (fs.existsSync(path.join(root, nestedRoot, file))) {
          sampledFiles.push(`${nestedRoot}/${file}`);
        }
      });
    }
  }

  const dedupedFiles = Array.from(new Set(sampledFiles));
  if (dedupedFiles.some(file => /(^|\/)(pyproject\.toml|requirements\.txt|setup\.py|Pipfile|calculator\.py)$/i.test(file))) {
    detectedStack = 'Python workspace';
  } else if (dedupedFiles.some(file => /(^|\/)package\.json$/i.test(file))) {
    detectedStack = 'Node.js workspace';
  }

  return {
    detectedStack,
    sampledFiles: dedupedFiles.slice(0, 8),
  };
};

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
      action: 'pause_for_input' | 'pause_for_approval' | 'pause_for_conflict';
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

const compactMarkdownSummary = (value: string) =>
  summarizeOutput(
    value
      .replace(/```[\s\S]*?```/g, match =>
        match
          .replace(/^```[\w-]*\n?/, '')
          .replace(/```$/, '')
          .trim(),
      )
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\|/g, ' ')
      .replace(/^-{3,}$/gm, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );

const formatToolLabel = (toolId: ToolAdapterId) =>
  toolId
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());

const buildDecisionProgressMessage = (decision: ExecutionDecision) => {
  if (decision.action === 'invoke_tool') {
    return `Prepared ${formatToolLabel(decision.toolCall.toolId)} for the next execution move.`;
  }

  if (decision.action === 'complete') {
    return 'Prepared a completion update for this workflow step.';
  }

  if (decision.action === 'pause_for_input') {
    return 'Prepared a human input request for this workflow step.';
  }

  if (decision.action === 'pause_for_approval') {
    return 'Prepared an approval request for this workflow step.';
  }

  if (decision.action === 'pause_for_conflict') {
    return 'Prepared a conflict-resolution wait for adversarial review.';
  }

  return 'Prepared a failure outcome for this workflow step.';
};

const emitRunProgressEvent = async ({
  capabilityId,
  runId,
  workItemId,
  runStepId,
  toolInvocationId,
  traceId,
  spanId,
  type = 'STEP_PROGRESS',
  level = 'INFO',
  message,
  details,
}: {
  capabilityId: string;
  runId: string;
  workItemId: string;
  runStepId?: string;
  toolInvocationId?: string;
  traceId?: string;
  spanId?: string;
  type?: string;
  level?: RunEvent['level'];
  message: string;
  details?: Record<string, unknown>;
}) => {
  try {
    await insertRunEvent(
      createRunEvent({
        capabilityId,
        runId,
        workItemId,
        runStepId,
        toolInvocationId,
        traceId,
        spanId,
        type,
        level,
        message,
        details,
      }),
    );
  } catch (error) {
    console.warn('Failed to emit workflow progress event.', error);
  }
};

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

const buildMarkdownArtifact = (sections: Array<[string, string | undefined]>) =>
  sections
    .filter(([, value]) => Boolean(value))
    .map(([heading, value]) => `## ${heading}\n${value}`)
    .join('\n\n');

const formatMarkdownList = (items: string[]) =>
  items.length > 0 ? items.map(item => `- ${item}`).join('\n') : 'None captured.';

const normalizeString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const normalizeStringArray = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map(item => normalizeString(item)).filter(Boolean);
  }

  const normalized = normalizeString(value);
  return normalized ? [normalized] : [];
};

const normalizeContrarianSeverity = (
  value: unknown,
): ContrarianConflictReview['severity'] => {
  const normalized = normalizeString(value).toUpperCase();
  return normalized === 'LOW' ||
    normalized === 'MEDIUM' ||
    normalized === 'HIGH' ||
    normalized === 'CRITICAL'
    ? normalized
    : 'MEDIUM';
};

const normalizeContrarianRecommendation = (
  value: unknown,
): ContrarianConflictReview['recommendation'] => {
  const normalized = normalizeString(value).toUpperCase().replace(/\s+/g, '_');
  return normalized === 'CONTINUE' ||
    normalized === 'REVISE_RESOLUTION' ||
    normalized === 'ESCALATE' ||
    normalized === 'STOP'
    ? normalized
    : 'ESCALATE';
};

const findContrarianReviewerAgent = (agents: CapabilityAgent[]) =>
  agents.find(
    agent =>
      agent.role === 'Contrarian Reviewer' ||
      agent.name === 'Contrarian Reviewer' ||
      agent.id.includes('CONTRARIAN-REVIEWER'),
  ) ||
  agents.find(agent => agent.isOwner) ||
  agents[0];

const createPendingContrarianReview = (
  reviewerAgentId: string,
): ContrarianConflictReview => ({
  status: 'PENDING',
  reviewerAgentId,
  generatedAt: new Date().toISOString(),
  severity: 'MEDIUM',
  recommendation: 'ESCALATE',
  summary: 'Contrarian review is being generated for this conflict wait.',
  challengedAssumptions: [],
  risks: [],
  missingEvidence: [],
  alternativePaths: [],
  sourceArtifactIds: [],
  sourceDocumentIds: [],
});

const createErroredContrarianReview = ({
  reviewerAgentId,
  error,
}: {
  reviewerAgentId: string;
  error: unknown;
}): ContrarianConflictReview => {
  const message =
    error instanceof Error
      ? error.message
      : 'Contrarian review could not be generated.';

  return {
    status: 'ERROR',
    reviewerAgentId,
    generatedAt: new Date().toISOString(),
    severity: 'MEDIUM',
    recommendation: 'ESCALATE',
    summary:
      'Contrarian review was unavailable. The operator can still resolve this advisory wait manually.',
    challengedAssumptions: [],
    risks: [],
    missingEvidence: [],
    alternativePaths: [],
    sourceArtifactIds: [],
    sourceDocumentIds: [],
    lastError: message.slice(0, 800),
  };
};

const formatContrarianReviewMarkdown = (review: ContrarianConflictReview) =>
  buildMarkdownArtifact([
    ['Status', review.status],
    ['Severity', review.severity],
    ['Recommendation', review.recommendation.replace(/_/g, ' ')],
    ['Summary', review.summary],
    ['Challenged Assumptions', formatMarkdownList(review.challengedAssumptions)],
    ['Risks', formatMarkdownList(review.risks)],
    ['Missing Evidence', formatMarkdownList(review.missingEvidence)],
    ['Alternative Paths', formatMarkdownList(review.alternativePaths)],
    ['Suggested Resolution', review.suggestedResolution],
    ['Last Error', review.lastError],
  ]);

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

const requestContrarianConflictReview = async ({
  capability,
  workItem,
  workflow,
  step,
  runStep,
  wait,
  reviewer,
  handoffContext,
  resolvedWaitContext,
}: {
  capability: Capability;
  workItem: WorkItem;
  workflow: Workflow;
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  wait: RunWait;
  reviewer: CapabilityAgent;
  handoffContext?: string;
  resolvedWaitContext?: string;
}): Promise<{
  review: ContrarianConflictReview;
  usage: DecisionEnvelope['usage'];
  latencyMs: number;
  retrievalReferences: MemoryReference[];
}> => {
  const startedAt = Date.now();
  const memoryContext = await buildMemoryContext({
    capabilityId: capability.id || workItem.capabilityId,
    agentId: reviewer.id,
    queryText: [
      workItem.title,
      workItem.description,
      workflow.name,
      step.name,
      step.action,
      wait.message,
      handoffContext,
      resolvedWaitContext,
    ]
      .filter(Boolean)
      .join('\n'),
    limit: 8,
  });

  const response = await invokeScopedCapabilitySession({
    capability,
    agent: reviewer,
    scope: 'WORK_ITEM',
    scopeId: workItem.id,
    developerPrompt:
      'You are an adversarial workflow reviewer. Return JSON only with no markdown.',
    memoryPrompt: memoryContext.prompt || undefined,
    prompt: [
      `Capability: ${capability.name}`,
      `Workflow: ${workflow.name}`,
      `Work item: ${workItem.title}`,
      `Work item request:\n${workItem.description || 'None'}`,
      `Current phase: ${workItem.phase}`,
      `Current step: ${step.name}`,
      `Step objective: ${step.action}`,
      `Step guidance: ${step.description || 'None'}`,
      `Current run step attempt: ${runStep.attemptCount}`,
      `Conflict wait message:\n${wait.message}`,
      `Prior hand-offs:\n${handoffContext || 'None'}`,
      `Resolved input/conflict context:\n${resolvedWaitContext || 'None'}`,
      'Challenge the proposed continuation path. Identify unsafe assumptions, missing evidence, contradictory handoffs, policy ambiguity, downstream risks, and alternative paths. Do not resolve the conflict yourself; advise the human operator.',
      'Return JSON with this exact shape:',
      '{"severity":"LOW|MEDIUM|HIGH|CRITICAL","recommendation":"CONTINUE|REVISE_RESOLUTION|ESCALATE|STOP","summary":"...","challengedAssumptions":["..."],"risks":["..."],"missingEvidence":["..."],"alternativePaths":["..."],"suggestedResolution":"optional operator-ready resolution text"}',
    ].join('\n\n'),
  });

  const parsed = extractJsonObject(response.content);
  const sourceDocumentIds = Array.from(
    new Set(memoryContext.results.map(result => result.document.id)),
  );
  const sourceArtifactIds = Array.from(
    new Set(
      memoryContext.results
        .map(result => {
          const metadataArtifactId = result.document.metadata?.artifactId;
          if (typeof metadataArtifactId === 'string' && metadataArtifactId.trim()) {
            return metadataArtifactId.trim();
          }

          if (
            ['ARTIFACT', 'HANDOFF', 'HUMAN_INTERACTION'].includes(
              result.document.sourceType,
            ) &&
            result.document.sourceId
          ) {
            return result.document.sourceId;
          }

          return undefined;
        })
        .filter(Boolean) as string[],
    ),
  );
  const suggestedResolution = normalizeString(parsed.suggestedResolution);

  return {
    review: {
      status: 'READY',
      reviewerAgentId: reviewer.id,
      generatedAt: new Date().toISOString(),
      severity: normalizeContrarianSeverity(parsed.severity),
      recommendation: normalizeContrarianRecommendation(parsed.recommendation),
      summary:
        normalizeString(parsed.summary) ||
        'Contrarian review completed without a summary.',
      challengedAssumptions: normalizeStringArray(parsed.challengedAssumptions),
      risks: normalizeStringArray(parsed.risks),
      missingEvidence: normalizeStringArray(parsed.missingEvidence),
      alternativePaths: normalizeStringArray(parsed.alternativePaths),
      suggestedResolution: suggestedResolution || undefined,
      sourceArtifactIds,
      sourceDocumentIds,
    },
    usage: response.usage,
    latencyMs: Date.now() - startedAt,
    retrievalReferences: memoryContext.results.map(result => result.reference),
  };
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
  const approvedWorkspacePaths = getCapabilityWorkspaceRoots(capability);
  const workspaceProfile = detectWorkspaceProfile(approvedWorkspacePaths);
  const workspaceGuidance = approvedWorkspacePaths.length
    ? [
        capability.executionConfig.defaultWorkspacePath
          ? `Default approved workspace path: ${capability.executionConfig.defaultWorkspacePath}`
          : null,
        `Approved workspace paths: ${approvedWorkspacePaths.join(', ')}`,
        `Detected workspace profile: ${workspaceProfile.detectedStack}`,
        workspaceProfile.sampledFiles.length
          ? `Observed workspace files: ${workspaceProfile.sampledFiles.join(', ')}`
          : null,
        'When using workspace tools, prefer relative file paths and omit workspacePath unless you intentionally need a non-default approved workspace or approved subfolder.',
        'If you do provide workspacePath, it must be the approved root or a child folder inside one approved workspace root. Do not use sibling paths or parent traversal.',
      ]
        .filter(Boolean)
        .join('\n')
    : 'No approved workspace paths are configured for this capability.';
  const startedAt = Date.now();
  const memoryContext = await buildMemoryContext({
    capabilityId: capability.id || workItem.capabilityId,
    agentId: agent.id,
    queryText: [workItem.title, workItem.description, step.action, step.name]
      .filter(Boolean)
      .join('\n'),
  });

  const response = await invokeScopedCapabilitySession({
    capability,
    agent,
    scope: workItem.id ? 'WORK_ITEM' : 'TASK',
    scopeId: workItem.id || runStep.id,
    developerPrompt:
      'You are an execution engine inside a capability workflow. Return JSON only with no markdown.',
    memoryPrompt: memoryContext.prompt || undefined,
    prompt: [
      `Current workflow: ${workflow.name}`,
      `Current step: ${step.name}`,
      `Current phase: ${workItem.phase}`,
      `Current step attempt: ${runStep.attemptCount}`,
      `Step objective: ${step.action}`,
      `Step guidance: ${step.description || 'None'}`,
      `Execution notes: ${step.executionNotes || 'None'}`,
      `Workflow hand-off context from prior completed steps:\n${handoffContext || 'None'}`,
      `Resolved human input/conflict context for this step:\n${resolvedWaitContext || 'None'}`,
      `Allowed tools:\n${toolDescriptions}`,
      `Workspace policy:\n${workspaceGuidance}`,
      toolHistory.length
        ? `Prior tool loop transcript:\n${toolHistory
            .map(item => `${item.role.toUpperCase()}: ${item.content}`)
            .join('\n\n')}`
        : null,
      'Use prior-step hand-offs, retrieved memory, and resolved human inputs as authoritative downstream context. Do not ask for information that is already present in those sections. If you truly need more input, explain exactly what new gap remains and why the existing context is insufficient.',
      'Return JSON with one of these shapes:',
      '1. {"action":"invoke_tool","reasoning":"...","summary":"...","toolCall":{"toolId":"workspace_read","args":{"path":"README.md"}}}',
      '2. {"action":"complete","reasoning":"...","summary":"..."}',
      '3. {"action":"pause_for_input","reasoning":"...","wait":{"type":"INPUT","message":"..."}}',
      '4. {"action":"pause_for_approval","reasoning":"...","wait":{"type":"APPROVAL","message":"..."}}',
      '5. {"action":"pause_for_conflict","reasoning":"...","wait":{"type":"CONFLICT_RESOLUTION","message":"..."}}',
      '6. {"action":"fail","reasoning":"...","summary":"..."}',
      'Only choose tool ids from the allowed list. If no tools are allowed, either complete, pause, or fail.',
      'Use pause_for_conflict when competing requirements, unsafe assumptions, policy disagreement, or contradictory evidence need an explicit operator decision before continuation.',
      `Story title: ${workItem.title}`,
      `Story request: ${workItem.description}`,
      'Decide the next execution action for this workflow step.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  });

  return {
    decision: extractJsonObject(response.content) as ExecutionDecision,
    model: response.model,
    usage: response.usage,
    latencyMs: Date.now() - startedAt,
    retrievalReferences: memoryContext.results.map(result => result.reference),
  } as DecisionEnvelope;
};

const getNormalizedWorkflowSnapshot = (detail: WorkflowRunDetail) =>
  detail.run.workflowSnapshot;

const getRunBranchState = (detail: WorkflowRunDetail): WorkflowRunBranchState => ({
  pendingNodeIds: detail.run.branchState?.pendingNodeIds || [],
  completedNodeIds: detail.run.branchState?.completedNodeIds || [],
  activeNodeIds: detail.run.branchState?.activeNodeIds || [],
  joinState: detail.run.branchState?.joinState || {},
  visitCount: detail.run.branchState?.visitCount || 0,
});

const getCurrentWorkflowNode = (detail: WorkflowRunDetail) => {
  const node = getWorkflowNode(
    getNormalizedWorkflowSnapshot(detail),
    detail.run.currentNodeId || detail.run.currentStepId,
  );
  if (!node) {
    throw new Error(`Run ${detail.run.id} has no current workflow node.`);
  }
  return node;
};

const getCurrentRunStep = (detail: WorkflowRunDetail) => {
  const currentNode = getCurrentWorkflowNode(detail);
  const runStep = detail.steps.find(
    item => item.workflowNodeId === currentNode.id,
  );
  if (!runStep) {
    throw new Error(`Run ${detail.run.id} is missing its current run-step record.`);
  }
  return runStep;
};

const getCurrentWorkflowStep = (detail: WorkflowRunDetail) => {
  const workflow = getNormalizedWorkflowSnapshot(detail);
  const step = workflow.steps.find(
    item => item.id === (detail.run.currentStepId || detail.run.currentNodeId),
  );
  if (!step) {
    throw new Error(`Run ${detail.run.id} has no current workflow step.`);
  }
  return step;
};

const getNodeTypeFromRunStep = (runStep: WorkflowRunStep, workflow: Workflow) =>
  getWorkflowNode(workflow, runStep.workflowNodeId)?.type ||
  (runStep.metadata?.nodeType as WorkflowNode['type'] | undefined) ||
  'DELIVERY';

const pickDecisionEdge = ({
  workflow,
  node,
  detail,
}: {
  workflow: Workflow;
  node: WorkflowNode;
  detail: WorkflowRunDetail;
}) => {
  const outgoingEdges = getOutgoingWorkflowEdges(workflow, node.id);
  if (outgoingEdges.length <= 1) {
    return outgoingEdges[0];
  }

  const latestCompletedStep = detail.steps
    .filter(step => step.status === 'COMPLETED')
    .slice()
    .reverse()
    .find(step => step.workflowNodeId !== node.id);
  const lastSummary = `${latestCompletedStep?.outputSummary || ''} ${latestCompletedStep?.evidenceSummary || ''}`.toLowerCase();
  const failureSignals = /(fail|defect|error|rework|retry|blocked|issue)/.test(lastSummary);
  const successSignals = /(pass|approved|ready|complete|successful|done)/.test(lastSummary);

  const matchingByCondition = (conditionType: WorkflowEdgeConditionType) =>
    outgoingEdges.find(edge => edge.conditionType === conditionType);

  if (failureSignals) {
    return matchingByCondition('FAILURE') || matchingByCondition('REJECTED') || outgoingEdges[0];
  }

  if (successSignals) {
    return matchingByCondition('SUCCESS') || matchingByCondition('APPROVED') || matchingByCondition('DEFAULT') || outgoingEdges[0];
  }

  return matchingByCondition('DEFAULT') || outgoingEdges[0];
};

const resolveGraphTransition = async ({
  detail,
  completedNode,
  completedRunStep,
  summary,
}: {
  detail: WorkflowRunDetail;
  completedNode: WorkflowNode;
  completedRunStep: WorkflowRunStep;
  summary: string;
}): Promise<{
  nextRun: WorkflowRun;
  nextDetail: WorkflowRunDetail;
  nextStep?: WorkflowStep;
}> => {
  const workflow = getNormalizedWorkflowSnapshot(detail);
  const nodes = getWorkflowNodes(workflow);
  const branchState = getRunBranchState(detail);
  const nextBranchState: WorkflowRunBranchState = {
    pendingNodeIds: branchState.pendingNodeIds.filter(nodeId => nodeId !== completedNode.id),
    activeNodeIds: branchState.activeNodeIds.filter(nodeId => nodeId !== completedNode.id),
    completedNodeIds: Array.from(new Set([...branchState.completedNodeIds, completedNode.id])),
    joinState: { ...(branchState.joinState || {}) },
    visitCount: (branchState.visitCount || 0) + 1,
  };

  const enqueueNode = (nodeId: string) => {
    const node = getWorkflowNode(workflow, nodeId);
    if (!node || nextBranchState.completedNodeIds.includes(node.id)) {
      return;
    }

    if (node.type === 'PARALLEL_JOIN') {
      const inboundNodeIds = getIncomingWorkflowEdges(workflow, node.id).map(edge => edge.fromNodeId);
      const completedInboundNodeIds = inboundNodeIds.filter(inboundId =>
        nextBranchState.completedNodeIds.includes(inboundId),
      );
      nextBranchState.joinState = {
        ...(nextBranchState.joinState || {}),
        [node.id]: {
          waitingOnNodeIds: inboundNodeIds.filter(
            inboundId => !nextBranchState.completedNodeIds.includes(inboundId),
          ),
          completedInboundNodeIds,
        },
      };

      if (completedInboundNodeIds.length !== inboundNodeIds.length) {
        return;
      }
    }

    if (!nextBranchState.pendingNodeIds.includes(node.id)) {
      nextBranchState.pendingNodeIds.push(node.id);
    }
    if (!nextBranchState.activeNodeIds.includes(node.id)) {
      nextBranchState.activeNodeIds.push(node.id);
    }
  };

  const selectEdgesForNode = (node: WorkflowNode): WorkflowEdge[] => {
    const outgoingEdges = getOutgoingWorkflowEdges(workflow, node.id);
    if (node.type === 'DECISION') {
      const chosenEdge = pickDecisionEdge({ workflow, node, detail });
      return chosenEdge ? [chosenEdge] : [];
    }
    if (node.type === 'PARALLEL_SPLIT') {
      return outgoingEdges;
    }
    return outgoingEdges.length > 0 ? [outgoingEdges[0]] : [];
  };

  selectEdgesForNode(completedNode).forEach(edge => enqueueNode(edge.toNodeId));

  let nextCurrentNode: WorkflowNode | undefined;
  let safetyCounter = 0;
  while (nextBranchState.pendingNodeIds.length > 0 && safetyCounter < Math.max(nodes.length * 3, 12)) {
    safetyCounter += 1;
    nextBranchState.pendingNodeIds = nextBranchState.pendingNodeIds
      .slice()
      .sort((left, right) => {
        const leftNode = getWorkflowNode(workflow, left);
        const rightNode = getWorkflowNode(workflow, right);
        const orderedIds = getWorkflowNodeOrder(workflow);
        return orderedIds.indexOf(leftNode?.id || '') - orderedIds.indexOf(rightNode?.id || '');
      });

    const candidateId = nextBranchState.pendingNodeIds[0];
    const candidateNode = getWorkflowNode(workflow, candidateId);
    if (!candidateNode) {
      nextBranchState.pendingNodeIds.shift();
      nextBranchState.activeNodeIds = nextBranchState.activeNodeIds.filter(nodeId => nodeId !== candidateId);
      continue;
    }

    if (candidateNode.type === 'END') {
      nextBranchState.pendingNodeIds.shift();
      nextBranchState.activeNodeIds = nextBranchState.activeNodeIds.filter(nodeId => nodeId !== candidateId);
      nextBranchState.completedNodeIds = Array.from(
        new Set([...nextBranchState.completedNodeIds, candidateNode.id]),
      );
      const endRunStep = detail.steps.find(step => step.workflowNodeId === candidateNode.id);
      if (endRunStep && endRunStep.status !== 'COMPLETED') {
        await updateWorkflowRunStep({
          ...endRunStep,
          status: 'COMPLETED',
          completedAt: new Date().toISOString(),
          outputSummary: summary,
          evidenceSummary: summary,
        });
      }
      break;
    }

    if (isWorkflowControlNode(candidateNode.type)) {
      nextBranchState.pendingNodeIds.shift();
      nextBranchState.activeNodeIds = nextBranchState.activeNodeIds.filter(nodeId => nodeId !== candidateNode.id);
      nextBranchState.completedNodeIds = Array.from(
        new Set([...nextBranchState.completedNodeIds, candidateNode.id]),
      );
      const controlRunStep = detail.steps.find(step => step.workflowNodeId === candidateNode.id);
      if (controlRunStep && controlRunStep.status !== 'COMPLETED') {
        await updateWorkflowRunStep({
          ...controlRunStep,
          status: 'COMPLETED',
          completedAt: new Date().toISOString(),
          outputSummary: `${candidateNode.name} automatically advanced the workflow.`,
          evidenceSummary: `${candidateNode.type} control node processed.`,
          metadata: {
            ...(controlRunStep.metadata || {}),
            nodeType: candidateNode.type,
          },
        });
      }
      selectEdgesForNode(candidateNode).forEach(edge => enqueueNode(edge.toNodeId));
      continue;
    }

    nextCurrentNode = candidateNode;
    break;
  }

  const nextStep = nextCurrentNode
    ? workflow.steps.find(step => step.id === getDisplayStepIdForNode(workflow, nextCurrentNode?.id))
    : undefined;
  const nextRun = (
    await updateWorkflowRun({
      ...detail.run,
      workflowSnapshot: workflow,
      status: nextCurrentNode ? 'RUNNING' : 'COMPLETED',
      currentNodeId: nextCurrentNode?.id,
      currentStepId: nextCurrentNode
        ? getDisplayStepIdForNode(workflow, nextCurrentNode.id) || nextCurrentNode.id
        : undefined,
      currentPhase: nextCurrentNode?.phase || 'DONE',
      assignedAgentId: nextCurrentNode?.agentId,
      branchState: nextBranchState,
      pauseReason: undefined,
      currentWaitId: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      completedAt: nextCurrentNode ? undefined : new Date().toISOString(),
      terminalOutcome: nextCurrentNode ? undefined : summary,
    })
  ).run;

  return {
    nextRun,
    nextDetail: await getWorkflowRunDetail(detail.run.capabilityId, nextRun.id),
    nextStep,
  };
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
  const currentStepIndex = getCurrentRunStep(detail).stepIndex;
  const priorCompletedSteps = detail.steps
    .filter(
      step =>
        step.status === 'COMPLETED' &&
        !isWorkflowControlNode(getNodeTypeFromRunStep(step, detail.run.workflowSnapshot)) &&
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
  artifacts,
}: {
  detail: WorkflowRunDetail;
  waitType: RunWaitType;
  waitMessage: string;
  artifacts?: Artifact[];
}) => {
  const projection = await resolveProjectionContext(detail.run.capabilityId, detail.run.workItemId, detail.run.workflowSnapshot);
  const currentStep = getCurrentWorkflowStep(detail);
  const nextArtifacts = artifacts
    ? replaceArtifacts(projection.workspace.artifacts, artifacts)
    : undefined;
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
    artifacts: nextArtifacts,
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
    isTestingWorkflowStep(step)
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
  summary: compactMarkdownSummary(summary),
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
    ['Phase', getLifecyclePhaseLabel(undefined, step.phase)],
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
  summary: compactMarkdownSummary(
    `Handoff from ${step.name} to ${nextStep.name}. ${summary}`,
  ),
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
    ['Source Phase', getLifecyclePhaseLabel(undefined, step.phase)],
    ['Target Phase', getLifecyclePhaseLabel(undefined, nextStep.phase)],
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
  const contrarianReview =
    wait.type === 'CONFLICT_RESOLUTION' ? wait.payload?.contrarianReview : undefined;
  const codeDiffArtifactId =
    wait.type === 'APPROVAL' && typeof wait.payload?.codeDiffArtifactId === 'string'
      ? wait.payload.codeDiffArtifactId
      : undefined;
  const codeDiffSummary =
    wait.type === 'APPROVAL' && typeof wait.payload?.codeDiffSummary === 'string'
      ? wait.payload.codeDiffSummary
      : undefined;
  const isCodeDiffApproval = Boolean(codeDiffArtifactId);
  const artifactKind =
    wait.type === 'APPROVAL'
      ? 'APPROVAL_RECORD'
      : wait.type === 'CONFLICT_RESOLUTION'
      ? 'CONFLICT_RESOLUTION'
      : 'INPUT_NOTE';

  const artifactName =
    wait.type === 'APPROVAL' && isCodeDiffApproval
      ? `${step.name} Code Review Approval`
      : wait.type === 'APPROVAL'
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
    summary: compactMarkdownSummary(resolution),
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
      ['Phase', getLifecyclePhaseLabel(undefined, step.phase)],
      ['Requested By', wait.requestedBy],
      ['Request', wait.message],
      ['Resolved By', resolvedBy],
      ['Resolution', resolution],
      isCodeDiffApproval ? ['Code Diff Summary', codeDiffSummary] : ['Code Diff Summary', undefined],
      isCodeDiffApproval
        ? ['Linked Code Diff Artifact', codeDiffArtifactId]
        : ['Linked Code Diff Artifact', undefined],
      contrarianReview
        ? ['Contrarian Review', formatContrarianReviewMarkdown(contrarianReview)]
        : ['Contrarian Review', undefined],
    ])}`,
    downloadable: true,
    traceId: detail.run.traceId,
  };
};

const buildContrarianReviewArtifact = ({
  detail,
  step,
  runStep,
  wait,
  review,
  retrievalReferences,
  latencyMs,
  costUsd,
}: {
  detail: WorkflowRunDetail;
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  wait: RunWait;
  review: ContrarianConflictReview;
  retrievalReferences: MemoryReference[];
  latencyMs?: number;
  costUsd?: number;
}): Artifact => {
  const artifactName = `${step.name} Contrarian Review`;

  return {
    id: createArtifactId(),
    name: artifactName,
    capabilityId: detail.run.capabilityId,
    type: 'Adversarial Review',
    version: `run-${detail.run.attemptNumber}`,
    agent: review.reviewerAgentId,
    created: review.generatedAt,
    direction: 'OUTPUT',
    connectedAgentId: review.reviewerAgentId,
    sourceWorkflowId: detail.run.workflowId,
    runId: detail.run.id,
    runStepId: runStep.id,
    summary: compactMarkdownSummary(review.summary),
    artifactKind: 'CONTRARIAN_REVIEW',
    phase: step.phase,
    workItemId: detail.run.workItemId,
    sourceRunId: detail.run.id,
    sourceRunStepId: runStep.id,
    sourceWaitId: wait.id,
    contentFormat: 'MARKDOWN',
    mimeType: 'text/markdown',
    fileName: `${toFileSlug(detail.run.workItemId)}-contrarian-review-${toFileSlug(step.name)}.md`,
    contentText: `# ${artifactName}\n\n${buildMarkdownArtifact([
      ['Work Item', detail.run.workItemId],
      ['Phase', getLifecyclePhaseLabel(undefined, step.phase)],
      ['Conflict Wait', wait.message],
      ['Reviewer Agent', review.reviewerAgentId],
      ['Review', formatContrarianReviewMarkdown(review)],
    ])}`,
    contentJson: review,
    downloadable: true,
    traceId: detail.run.traceId,
    latencyMs,
    costUsd,
    retrievalReferences,
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

  const firstNode = findFirstExecutableNode(workflow);
  const firstStep = firstNode
    ? workflow.steps.find(step => step.id === firstNode.id)
    : undefined;
  if (!firstStep) {
    throw new Error(`Workflow ${workflow.name} does not define any executable nodes.`);
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
  if (!getCapabilityBoardPhaseIds(projection.capability).includes(targetPhase)) {
    throw new Error(
      `Phase ${targetPhase} is not part of ${projection.capability.name}'s lifecycle.`,
    );
  }
  const targetNode =
    targetPhase === 'BACKLOG' || targetPhase === 'DONE'
      ? undefined
      : findFirstExecutableNodeForPhase(projection.workflow, targetPhase) ||
        findFirstExecutableNode(projection.workflow);
  const targetStep = targetNode
    ? projection.workflow.steps.find(step => step.id === targetNode.id)
    : undefined;

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
  if (
    restartFromPhase &&
    !getCapabilityBoardPhaseIds(projection.capability).includes(restartFromPhase)
  ) {
    throw new Error(
      `Phase ${restartFromPhase} is not part of ${projection.capability.name}'s lifecycle.`,
    );
  }
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
  approvalDisposition = 'APPROVE',
}: {
  capabilityId: string;
  runId: string;
  expectedType: RunWaitType;
  resolution: string;
  resolvedBy: string;
  approvalDisposition?: 'APPROVE' | 'REQUEST_CHANGES';
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
  const isRequestChangesApproval =
    expectedType === 'APPROVAL' && approvalDisposition === 'REQUEST_CHANGES';
  const approvalAdvancesWorkflow =
    expectedType === 'APPROVAL' &&
    !isRequestChangesApproval &&
    (
      currentStep.stepType === 'HUMAN_APPROVAL' ||
      openWait.payload?.postStepApproval === true
    );
  const approvalCompletionSummary =
    typeof openWait.payload?.completionSummary === 'string' &&
    openWait.payload.completionSummary.trim()
      ? openWait.payload.completionSummary.trim()
      : resolution;
  let nextRun = detail.run;
  let nextRunStep = currentRunStep;
  let nextWorkflowStep: WorkflowStep | undefined;

  if (approvalAdvancesWorkflow) {
    nextRunStep = await updateWorkflowRunStep({
      ...currentRunStep,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      evidenceSummary: approvalCompletionSummary,
      outputSummary: approvalCompletionSummary,
      waitId: openWait.id,
      metadata: {
        ...(currentRunStep.metadata || {}),
        lastResolution: resolution,
      },
    });

    const currentNode = getCurrentWorkflowNode(detail);
    const transition = await resolveGraphTransition({
      detail,
      completedNode: currentNode,
      completedRunStep: nextRunStep,
      summary: approvalCompletionSummary,
    });
    nextWorkflowStep = transition.nextStep;
    nextRun = transition.nextRun;
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
        approvalDisposition:
          expectedType === 'APPROVAL' ? approvalDisposition : undefined,
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

  if (approvalAdvancesWorkflow) {
    await insertRunEvent(
      createRunEvent({
        capabilityId,
        runId,
        workItemId: detail.run.workItemId,
        runStepId: nextRunStep.id,
        traceId: detail.run.traceId,
        spanId: currentRunStep.spanId,
        type: 'STEP_COMPLETED',
        level: 'INFO',
        message: approvalCompletionSummary,
        details: {
          stage: 'STEP_COMPLETED',
          stepName: currentStep.name,
          phase: currentStep.phase,
          approvedAfterWait: true,
        },
      }),
    );

    const projection = await resolveProjectionContext(
      capabilityId,
      detail.run.workItemId,
      detail.run.workflowSnapshot,
    );
    const generatedArtifactIds = Array.isArray(openWait.payload?.generatedArtifactIds)
      ? openWait.payload.generatedArtifactIds.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        )
      : [];
    const generatedArtifacts = generatedArtifactIds
      .map(artifactId =>
        projection.workspace.artifacts.find(artifact => artifact.id === artifactId),
      )
      .filter(Boolean) as Artifact[];
    const handoffArtifact = nextWorkflowStep
      ? buildHandoffArtifact({
          detail,
          step: currentStep,
          nextStep: nextWorkflowStep,
          runStep: currentRunStep,
          summary: approvalCompletionSummary,
        })
      : null;

    const completionArtifacts = [
      ...generatedArtifacts.filter(artifact => artifact.artifactKind === 'PHASE_OUTPUT'),
      ...generatedArtifacts.filter(artifact => artifact.artifactKind !== 'PHASE_OUTPUT'),
      interactionArtifact,
      ...(handoffArtifact ? [handoffArtifact] : []),
    ];

    await syncCompletedProjection({
      detail: nextDetail,
      completedStep: currentStep,
      completedRunStep: nextRunStep,
      nextStep: nextWorkflowStep,
      summary: approvalCompletionSummary,
      artifacts: completionArtifacts,
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
        isRequestChangesApproval
          ? 'Changes requested'
          : expectedType === 'CONFLICT_RESOLUTION'
          ? 'Conflict resolved'
          : 'Human input provided',
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
          approvalDisposition:
            expectedType === 'APPROVAL' ? approvalDisposition : undefined,
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

export const requestChangesWorkflowRun = async ({
  capabilityId,
  runId,
  resolution,
  resolvedBy,
}: {
  capabilityId: string;
  runId: string;
  resolution: string;
  resolvedBy: string;
}) => {
  const detail = await getWorkflowRunDetail(capabilityId, runId);
  const openWait = [...detail.waits].reverse().find(wait => wait.status === 'OPEN');
  if (!openWait || openWait.type !== 'APPROVAL' || openWait.payload?.postStepApproval !== true) {
    throw new Error('Changes can only be requested for an open code diff approval wait.');
  }

  return resolveRunWaitAndQueue({
    capabilityId,
    runId,
    expectedType: 'APPROVAL',
    resolution,
    resolvedBy,
    approvalDisposition: 'REQUEST_CHANGES',
  });
};

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
  waitPayload,
  artifacts,
  runStepOverride,
}: {
  detail: WorkflowRunDetail;
  waitType: RunWaitType;
  waitMessage: string;
  waitPayload?: Record<string, any>;
  artifacts?: Artifact[];
  runStepOverride?: WorkflowRunStep;
}) => {
  const currentRunStep = runStepOverride || getCurrentRunStep(detail);
  const currentStep = getCurrentWorkflowStep(detail);
  const projection =
    waitType === 'CONFLICT_RESOLUTION'
      ? await resolveProjectionContext(
          detail.run.capabilityId,
          detail.run.workItemId,
          detail.run.workflowSnapshot,
        )
      : null;
  const contrarianReviewer = projection
    ? findContrarianReviewerAgent(projection.workspace.agents)
    : undefined;
  let wait = await createRunWait({
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
      ...(waitPayload || {}),
      contrarianReview:
        waitType === 'CONFLICT_RESOLUTION' && contrarianReviewer
          ? createPendingContrarianReview(contrarianReviewer.id)
          : undefined,
    },
  });
  const waitingRunStep = await updateWorkflowRunStep({
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
  await emitRunProgressEvent({
    capabilityId: detail.run.capabilityId,
    runId: detail.run.id,
    workItemId: detail.run.workItemId,
    runStepId: currentRunStep.id,
    traceId: detail.run.traceId,
    spanId: currentRunStep.spanId,
    type: 'STEP_WAITING',
    level: waitType === 'CONFLICT_RESOLUTION' ? 'WARN' : 'INFO',
    message: waitMessage,
    details: {
      stage: 'STEP_WAITING',
      waitType,
      stepName: currentRunStep.name,
      phase: detail.run.currentPhase,
    },
  });
  let nextDetail = await getWorkflowRunDetail(detail.run.capabilityId, nextRun.id);
  await syncWaitingProjection({
    detail: nextDetail,
    waitType,
    waitMessage,
    artifacts,
  });

  if (waitType === 'CONFLICT_RESOLUTION' && projection && contrarianReviewer) {
    let review: ContrarianConflictReview;
    let retrievalReferences: MemoryReference[] = [];
    let latencyMs: number | undefined;
    let costUsd: number | undefined;

    try {
      const handoffContext = buildWorkflowHandoffContext({
        detail: nextDetail,
        workItem: projection.workItem,
        artifacts: projection.workspace.artifacts,
      });
      const resolvedWaitContext = buildResolvedWaitContext({
        detail: nextDetail,
        runStep: waitingRunStep,
      });
      const reviewEnvelope = await requestContrarianConflictReview({
        capability: projection.capability,
        workItem: projection.workItem,
        workflow: detail.run.workflowSnapshot,
        step: currentStep,
        runStep: waitingRunStep,
        wait,
        reviewer: contrarianReviewer,
        handoffContext,
        resolvedWaitContext,
      });

      review = reviewEnvelope.review;
      retrievalReferences = reviewEnvelope.retrievalReferences;
      latencyMs = reviewEnvelope.latencyMs;
      costUsd = reviewEnvelope.usage.estimatedCostUsd;
      await recordUsageMetrics({
        capabilityId: detail.run.capabilityId,
        traceId: detail.run.traceId,
        scopeType: 'STEP',
        scopeId: waitingRunStep.id,
        latencyMs: reviewEnvelope.latencyMs,
        totalTokens: reviewEnvelope.usage.totalTokens,
        costUsd: reviewEnvelope.usage.estimatedCostUsd,
        tags: {
          phase: currentStep.phase,
          model: contrarianReviewer.model,
          review: 'contrarian',
        },
      });
    } catch (error) {
      review = createErroredContrarianReview({
        reviewerAgentId: contrarianReviewer.id,
        error,
      });
    }

    try {
      wait = await updateRunWaitPayload({
        capabilityId: detail.run.capabilityId,
        waitId: wait.id,
        payload: {
          ...(wait.payload || {}),
          contrarianReview: review,
        },
      });

      if (review.status === 'READY') {
        const reviewProjection = await resolveProjectionContext(
          detail.run.capabilityId,
          detail.run.workItemId,
          detail.run.workflowSnapshot,
        );
        const reviewArtifact = buildContrarianReviewArtifact({
          detail: nextDetail,
          step: currentStep,
          runStep: waitingRunStep,
          wait,
          review,
          retrievalReferences,
          latencyMs,
          costUsd,
        });
        await replaceCapabilityWorkspaceContentRecord(detail.run.capabilityId, {
          artifacts: replaceArtifacts(reviewProjection.workspace.artifacts, [
            reviewArtifact,
          ]),
        });
      }

      await emitRunProgressEvent({
        capabilityId: detail.run.capabilityId,
        runId: detail.run.id,
        workItemId: detail.run.workItemId,
        runStepId: waitingRunStep.id,
        traceId: detail.run.traceId,
        spanId: waitingRunStep.spanId,
        type:
          review.status === 'READY'
            ? 'CONTRARIAN_REVIEW_READY'
            : 'CONTRARIAN_REVIEW_FAILED',
        level:
          review.status === 'ERROR' ||
          review.severity === 'HIGH' ||
          review.severity === 'CRITICAL'
            ? 'WARN'
            : 'INFO',
        message:
          review.status === 'READY'
            ? `Contrarian review completed with ${review.severity.toLowerCase()} severity.`
            : 'Contrarian review was unavailable; conflict can still be resolved manually.',
        details: {
          stage:
            review.status === 'READY'
              ? 'CONTRARIAN_REVIEW_READY'
              : 'CONTRARIAN_REVIEW_FAILED',
          waitId: wait.id,
          reviewerAgentId: review.reviewerAgentId,
          severity: review.severity,
          recommendation: review.recommendation,
        },
      });
      nextDetail = await getWorkflowRunDetail(detail.run.capabilityId, nextRun.id);
    } catch (error) {
      console.warn('Contrarian review persistence failed; leaving wait open.', error);
    }
  }

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
  await emitRunProgressEvent({
    capabilityId: detail.run.capabilityId,
    runId: detail.run.id,
    workItemId: detail.run.workItemId,
    runStepId: currentRunStep.id,
    traceId: detail.run.traceId,
    spanId: currentRunStep.spanId,
    type: 'STEP_FAILED',
    level: 'ERROR',
    message,
    details: {
      stage: 'STEP_FAILED',
      stepName: currentRunStep.name,
      phase: detail.run.currentPhase,
    },
  });
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

export const reconcileWorkflowRunFailure = async ({
  capabilityId,
  runId,
  message,
}: {
  capabilityId: string;
  runId: string;
  message: string;
}) => {
  const detail = await getWorkflowRunDetail(capabilityId, runId);
  const currentRunStep = getCurrentRunStep(detail);

  if (
    currentRunStep.status !== 'FAILED' &&
    currentRunStep.status !== 'COMPLETED'
  ) {
    await updateWorkflowRunStep({
      ...currentRunStep,
      status: 'FAILED',
      completedAt: currentRunStep.completedAt || new Date().toISOString(),
      outputSummary: message,
      evidenceSummary: message,
    });
  }

  const nextRun = (
    await updateWorkflowRun({
      ...detail.run,
      status: 'FAILED',
      terminalOutcome: message,
      completedAt: detail.run.completedAt || new Date().toISOString(),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      currentWaitId: undefined,
    })
  ).run;

  await emitRunProgressEvent({
    capabilityId,
    runId,
    workItemId: detail.run.workItemId,
    runStepId: currentRunStep.id,
    traceId: detail.run.traceId,
    spanId: currentRunStep.spanId,
    type: 'STEP_FAILED',
    level: 'ERROR',
    message,
    details: {
      stage: 'STEP_FAILED',
      stepName: currentRunStep.name,
      phase: detail.run.currentPhase,
    },
  });

  const nextDetail = await getWorkflowRunDetail(capabilityId, nextRun.id);
  await syncFailedProjection({
    detail: nextDetail,
    message,
  });
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);
  await releaseRunLease({
    capabilityId,
    runId,
  }).catch(() => undefined);
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
  await emitRunProgressEvent({
    capabilityId: detail.run.capabilityId,
    runId: detail.run.id,
    workItemId: detail.run.workItemId,
    runStepId: currentRunStep.id,
    traceId,
    spanId: stepSpan.id,
    message: `${agent.name} started ${step.name}.`,
    details: {
      stage: 'STEP_STARTED',
      stepName: step.name,
      phase: step.phase,
      attemptCount: currentRunStep.attemptCount,
      agentId: agent.id,
      agentName: agent.name,
    },
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
  const stepTouchedPaths = new Set<string>();

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
    await emitRunProgressEvent({
      capabilityId: detail.run.capabilityId,
      runId: detail.run.id,
      workItemId: detail.run.workItemId,
      runStepId: currentRunStep.id,
      traceId,
      spanId: stepSpan.id,
      message: `Grounded ${step.name} with ${decisionEnvelope.retrievalReferences.length} capability reference${decisionEnvelope.retrievalReferences.length === 1 ? '' : 's'}.`,
      details: {
        stage: 'CONTEXT_GROUNDED',
        stepName: step.name,
        retrievalCount: decisionEnvelope.retrievalReferences.length,
        model: decisionEnvelope.model,
        iteration: iteration + 1,
      },
    });
    currentRunStep = await updateWorkflowRunStep({
      ...currentRunStep,
      retrievalReferences: decisionEnvelope.retrievalReferences,
      metadata: {
        ...(currentRunStep.metadata || {}),
        lastDecisionModel: decisionEnvelope.model,
        lastDecisionTokens: decisionEnvelope.usage.totalTokens,
      },
    });
    await emitRunProgressEvent({
      capabilityId: detail.run.capabilityId,
      runId: detail.run.id,
      workItemId: detail.run.workItemId,
      runStepId: currentRunStep.id,
      traceId,
      spanId: stepSpan.id,
      message: buildDecisionProgressMessage(decision),
      details: {
        stage: 'DECISION_READY',
        stepName: step.name,
        action: decision.action,
        model: decisionEnvelope.model,
        retrievalCount: decisionEnvelope.retrievalReferences.length,
        iteration: iteration + 1,
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
      await emitRunProgressEvent({
        capabilityId: detail.run.capabilityId,
        runId: detail.run.id,
        workItemId: detail.run.workItemId,
        runStepId: currentRunStep.id,
        traceId,
        spanId: toolSpan.id,
        type: 'TOOL_STARTED',
        message: `Running ${formatToolLabel(decision.toolCall.toolId)} for ${step.name}.`,
        details: {
          stage: 'TOOL_STARTED',
          stepName: step.name,
          toolId: decision.toolCall.toolId,
          iteration: iteration + 1,
        },
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
        if (
          decision.toolCall.toolId === 'workspace_write' &&
          typeof result.details?.path === 'string' &&
          result.details.path.trim()
        ) {
          stepTouchedPaths.add(result.details.path.trim());
        }
        continue;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Tool execution failed unexpectedly.';
        await emitRunProgressEvent({
          capabilityId: detail.run.capabilityId,
          runId: detail.run.id,
          workItemId: detail.run.workItemId,
          runStepId: currentRunStep.id,
          toolInvocationId,
          traceId,
          spanId: toolSpan.id,
          type: 'TOOL_FAILED',
          level: 'ERROR',
          message: `${formatToolLabel(decision.toolCall.toolId)} failed: ${message}`,
          details: {
            stage: 'TOOL_FAILED',
            stepName: step.name,
            toolId: decision.toolCall.toolId,
          },
        });
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
      const codeDiffArtifact =
        stepTouchedPaths.size > 0
          ? await captureCodeDiffReviewArtifact({
              capability: projection.capability,
              detail: runningDetail,
              step,
              runStep: currentRunStep,
              touchedPaths: Array.from(stepTouchedPaths),
            })
          : null;

      if (codeDiffArtifact) {
        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: stepSpan.id,
          status: 'WAITING',
          costUsd: decisionEnvelope.usage.estimatedCostUsd,
          tokenUsage: decisionEnvelope.usage,
          attributes: {
            outputSummary: decision.summary,
            waitType: 'APPROVAL',
            codeDiffArtifactId: codeDiffArtifact.id,
          },
        });
        return completeRunWithWait({
          detail: runningDetail,
          waitType: 'APPROVAL',
          waitMessage: `${step.name} changed workspace files. Review the code diff and approve before the workflow continues.`,
          waitPayload: {
            postStepApproval: true,
            completionSummary: decision.summary,
            generatedArtifactIds: [artifact.id, codeDiffArtifact.id],
            codeDiffArtifactId: codeDiffArtifact.id,
            codeDiffSummary: codeDiffArtifact.summary,
          },
          artifacts: [artifact, codeDiffArtifact],
          runStepOverride: currentRunStep,
        });
      }

      currentRunStep = await updateWorkflowRunStep({
        ...currentRunStep,
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        evidenceSummary: decision.reasoning,
        outputSummary: decision.summary,
        retrievalReferences: decisionEnvelope.retrievalReferences,
      });
      await emitRunProgressEvent({
        capabilityId: detail.run.capabilityId,
        runId: detail.run.id,
        workItemId: detail.run.workItemId,
        runStepId: currentRunStep.id,
        traceId,
        spanId: stepSpan.id,
        type: 'STEP_COMPLETED',
        message: decision.summary,
        details: {
          stage: 'STEP_COMPLETED',
          stepName: step.name,
          phase: step.phase,
          artifactName: artifact.name,
        },
      });
      const currentNode = getCurrentWorkflowNode(runningDetail);
      const transition = await resolveGraphTransition({
        detail: runningDetail,
        completedNode: currentNode,
        completedRunStep: currentRunStep,
        summary: decision.summary,
      });
      const nextStep = transition.nextStep;
      const nextDetail = transition.nextDetail;
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

    if (
      decision.action === 'pause_for_input' ||
      decision.action === 'pause_for_approval' ||
      decision.action === 'pause_for_conflict'
    ) {
      const waitType =
        decision.action === 'pause_for_conflict'
          ? 'CONFLICT_RESOLUTION'
          : decision.wait.type;
      await finishTelemetrySpan({
        capabilityId: detail.run.capabilityId,
        spanId: stepSpan.id,
        status: 'WAITING',
        costUsd: decisionEnvelope.usage.estimatedCostUsd,
        tokenUsage: decisionEnvelope.usage,
        attributes: {
          waitType,
          waitMessage: decision.wait.message,
        },
      });
      return completeRunWithWait({
        detail: runningDetail,
        waitType,
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
  const maxTransitions =
    Math.max(getWorkflowNodes(currentDetail.run.workflowSnapshot).length, currentDetail.run.workflowSnapshot.steps.length) +
    2;
  for (let index = 0; index < maxTransitions; index += 1) {
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
