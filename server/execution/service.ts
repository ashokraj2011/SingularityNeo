import {
  ActorContext,
  ApprovalAssignment,
  ApprovalDecision,
  AgentTask,
  Artifact,
  Capability,
  CapabilityAgent,
  CapabilityWorkspace,
  CompiledRequiredInputField,
  CompiledStepContext,
  CompiledWorkItemPlan,
  ContrarianConflictReview,
  ExecutionLog,
  LearningUpdate,
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
  WorkItemAttachmentUpload,
  WorkItemBlocker,
  WorkItemHistoryEntry,
  WorkItemPhase,
  WorkItemPendingRequest,
  WorkItemStatus,
  WorkflowStep,
} from '../../src/types';
import { syncWorkflowManagedTasksForWorkItem } from '../../src/lib/workflowTaskAutomation';
import {
  compileStepContext,
  compileWorkItemPlan,
} from '../../src/lib/workflowRuntime';
import {
  buildCapabilityBriefing,
  buildCapabilityBriefingPrompt,
} from '../../src/lib/capabilityBriefing';
import { buildAgentKnowledgeLens, buildAgentKnowledgePrompt } from '../../src/lib/agentKnowledge';
import { compileStepOwnership, resolveWorkItemPhaseOwnerTeamId } from '../../src/lib/capabilityOwnership';
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
import {
  getWorkItemTaskTypeLabel,
  normalizeWorkItemTaskType,
  resolveWorkItemEntryStep,
} from '../../src/lib/workItemTaskTypes';
import {
  buildWorkItemPhaseSignatureMarkdown,
  normalizeWorkItemPhaseStakeholders,
} from '../../src/lib/workItemStakeholders';
import { invokeScopedCapabilitySession } from '../githubModels';
import { queueSingleAgentLearningRefresh } from '../agentLearning/service';
import { wakeAgentLearningWorker } from '../agentLearning/worker';
import { buildMemoryContext, refreshCapabilityMemory } from '../memory';
import { evaluateToolPolicy } from '../policy';
import { transaction } from '../db';
import {
  createApprovalAssignments,
  createApprovalDecision,
  cancelOpenWaitsForRun,
  createRunEvent,
  createRunWait,
  createToolInvocation,
  getActiveRunForWorkItem,
  getLatestRunForWorkItem,
  getWorkflowRunDetail,
  getWorkflowRunStatus,
  insertRunEvent,
  listActiveWorkItemClaims,
  markOpenToolInvocationsAborted,
  releaseWorkItemClaim,
  releaseRunLease,
  resolveRunWait,
  upsertWorkItemClaim,
  updateApprovalAssignmentsForWait,
  updateToolInvocation,
  updateRunWaitPayload,
  updateWorkflowRun,
  updateWorkflowRunControl,
  updateWorkflowRunStep,
} from './repository';
import {
  classifyToolExecutionError,
  executeTool,
  listToolDescriptions,
} from './tools';
import { captureCodeDiffReviewArtifact } from './codeDiff';
import {
  getCapabilityBundle,
  releaseWorkItemCodeClaimRecord,
  replaceCapabilityWorkspaceContentRecord,
} from '../repository';
import {
  createTraceId,
  finishTelemetrySpan,
  recordUsageMetrics,
  startTelemetrySpan,
} from '../telemetry';
import { getCapabilityWorkspaceRoots } from '../workspacePaths';
import {
  buildWorkspaceProfilePromptLines,
  detectWorkspaceProfile,
} from '../workspaceProfile';

const MAX_AGENT_TOOL_LOOPS = 8;

const createHistoryId = () => `HIST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createLogId = () => `LOG-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createArtifactId = () => `ART-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createLearningUpdateId = () =>
  `LEARN-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createApprovalAssignmentId = () =>
  `APPROVAL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createApprovalDecisionId = () =>
  `APPDEC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

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

const summarizeOutput = (value?: unknown) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);

const compactMarkdownSummary = (value?: unknown) =>
  summarizeOutput(
    String(value || '')
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
  String(toolId || 'tool')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());

const TOOL_ID_ALIASES: Record<string, ToolAdapterId> = {
  workspace_list: 'workspace_list',
  code_list: 'workspace_list',
  file_list: 'workspace_list',
  list_files: 'workspace_list',
  workspace_read: 'workspace_read',
  code_read: 'workspace_read',
  file_read: 'workspace_read',
  read_file: 'workspace_read',
  workspace_search: 'workspace_search',
  code_search: 'workspace_search',
  file_search: 'workspace_search',
  search_code: 'workspace_search',
  workspace_write: 'workspace_write',
  code_write: 'workspace_write',
  file_write: 'workspace_write',
  write_file: 'workspace_write',
  edit_file: 'workspace_write',
  git_status: 'git_status',
  repo_status: 'git_status',
  run_build: 'run_build',
  build: 'run_build',
  run_test: 'run_test',
  test: 'run_test',
  run_docs: 'run_docs',
  docs: 'run_docs',
  run_deploy: 'run_deploy',
  deploy: 'run_deploy',
};

const normalizeToolAdapterId = (value: unknown): ToolAdapterId | null => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return null;
  }

  return TOOL_ID_ALIASES[normalized] || null;
};

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

const normalizeDecisionSummary = (
  action: ExecutionDecision['action'],
  summary: unknown,
) => {
  const normalized = normalizeString(summary);
  if (normalized) {
    return normalized;
  }

  switch (action) {
    case 'invoke_tool':
      return 'Prepared the next tool action for this workflow step.';
    case 'complete':
      return 'Completed the current workflow step.';
    case 'pause_for_input':
      return 'Paused the step for structured operator input.';
    case 'pause_for_approval':
      return 'Paused the step for human approval.';
    case 'pause_for_conflict':
      return 'Paused the step for conflict resolution.';
    case 'fail':
      return 'Failed the current workflow step.';
    default:
      return 'Updated the workflow step state.';
  }
};

export const normalizeExecutionDecision = (
  value: Record<string, any>,
): ExecutionDecision => {
  const action = normalizeString(value.action);
  const reasoning =
    normalizeString(value.reasoning) || 'No reasoning was returned by the execution model.';

  if (action === 'invoke_tool') {
    const toolId = normalizeToolAdapterId(value.toolCall?.toolId);
    if (!toolId) {
      return {
        action: 'fail',
        reasoning,
        summary:
          'Execution model requested a tool action without specifying a valid tool id.',
      };
    }

    return {
      action,
      reasoning,
      summary: normalizeDecisionSummary(action, value.summary),
      toolCall: {
        toolId,
        args:
          value.toolCall?.args && typeof value.toolCall.args === 'object'
            ? value.toolCall.args
            : {},
      },
    };
  }

  if (action === 'complete' || action === 'fail') {
    return {
      action,
      reasoning,
      summary: normalizeDecisionSummary(action, value.summary),
    };
  }

  if (
    action === 'pause_for_input' ||
    action === 'pause_for_approval' ||
    action === 'pause_for_conflict'
  ) {
    return {
      action,
      reasoning,
      summary: normalizeDecisionSummary(action, value.summary),
      wait: {
        type: value.wait?.type,
        message:
          normalizeString(value.wait?.message) ||
          'The workflow is waiting for operator action.',
      },
    };
  }

  return {
    action: 'fail',
    reasoning,
    summary: normalizeDecisionSummary('fail', value.summary || value.action),
  };
};

export const getExecutionDecisionRepairReason = (value: Record<string, any>) => {
  const action = normalizeString(value.action);

  if (action === 'invoke_tool' && !normalizeString(value.toolCall?.toolId)) {
    return 'Tool action was missing toolCall.toolId.';
  }

  if (
    (action === 'pause_for_input' ||
      action === 'pause_for_approval' ||
      action === 'pause_for_conflict') &&
    !normalizeString(value.wait?.type)
  ) {
    return 'Wait action was missing wait.type.';
  }

  return null;
};

export const getRecoverableDecisionFeedback = (
  decision: ExecutionDecision,
) => {
  if (
    decision.action === 'fail' &&
    decision.summary ===
      'Execution model requested a tool action without specifying a valid tool id.'
  ) {
    return 'The previous response attempted a tool call without toolCall.toolId. Choose exactly one tool from the allowed list and return a complete invoke_tool decision with valid args.';
  }

  return null;
};

export const buildToolLoopExhaustedWaitMessage = ({
  step,
  inspectedPaths,
  attemptedTools,
}: {
  step: WorkflowStep;
  inspectedPaths: string[];
  attemptedTools: ToolAdapterId[];
}) => {
  const attemptedSummary = attemptedTools.length
    ? attemptedTools.map(formatToolLabel).join(', ')
    : 'No tools were executed';
  const inspectedSummary = inspectedPaths.length
    ? inspectedPaths.join(', ')
    : 'No specific files were inspected';

  return `${step.name} explored the workspace for too long without moving into a concrete implementation result. It already used: ${attemptedSummary}. Recent files or paths inspected: ${inspectedSummary}. Provide direct implementation guidance such as the exact files to edit, the change to make, or confirmation that it should start writing code now.`;
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

const getActorDisplayName = (
  actor?: ActorContext | null,
  fallback = 'Capability Owner',
) => normalizeString(actor?.displayName) || fallback;

const getActorTeamIds = (actor?: ActorContext | null) =>
  Array.from(new Set((actor?.teamIds || []).map(teamId => normalizeString(teamId)).filter(Boolean)));

const canActorOperateWorkItem = ({
  actor,
  workItem,
}: {
  actor?: ActorContext | null;
  workItem: WorkItem;
}) => {
  if (!actor?.userId && getActorTeamIds(actor).length === 0) {
    return true;
  }

  if (actor?.userId && workItem.claimOwnerUserId && actor.userId === workItem.claimOwnerUserId) {
    return true;
  }

  const actorTeamIds = getActorTeamIds(actor);
  return Boolean(
    actorTeamIds.length > 0 &&
      workItem.phaseOwnerTeamId &&
      actorTeamIds.includes(workItem.phaseOwnerTeamId),
  );
};

const canActorApproveWait = ({
  actor,
  workItem,
  wait,
}: {
  actor?: ActorContext | null;
  workItem: WorkItem;
  wait: RunWait;
}) => {
  if (!actor?.userId && getActorTeamIds(actor).length === 0) {
    return true;
  }

  const actorTeamIds = getActorTeamIds(actor);
  const pendingAssignments = (wait.approvalAssignments || []).filter(
    assignment => assignment.status === 'PENDING',
  );

  if (pendingAssignments.length === 0) {
    const ownershipTeams = wait.payload?.compiledStepContext?.ownership?.approvalTeamIds || [];
    return Boolean(
      actorTeamIds.some(teamId => ownershipTeams.includes(teamId)) ||
        (workItem.phaseOwnerTeamId && actorTeamIds.includes(workItem.phaseOwnerTeamId)),
    );
  }

  return pendingAssignments.some(assignment => {
    if (assignment.targetType === 'USER') {
      return Boolean(actor.userId) && (assignment.assignedUserId || assignment.targetId) === actor.userId;
    }

    if (assignment.targetType === 'TEAM') {
      const teamId = assignment.assignedTeamId || assignment.targetId;
      return actorTeamIds.includes(teamId);
    }

    return Boolean(actor.userId) || actorTeamIds.length > 0;
  });
};

const buildApprovalAssignmentsForWait = ({
  capability,
  workItem,
  step,
  runId,
  waitId,
  waitMessage,
}: {
  capability: Capability;
  workItem: WorkItem;
  step: WorkflowStep;
  runId: string;
  waitId: string;
  waitMessage: string;
}) => {
  const ownership = compileStepOwnership({ capability, step });
  const policy = step.approvalPolicy;
  const fallbackTeamIds =
    ownership.approvalTeamIds.length > 0
      ? ownership.approvalTeamIds
      : workItem.phaseOwnerTeamId
      ? [workItem.phaseOwnerTeamId]
      : [];

  const targets =
    policy?.targets && policy.targets.length > 0
      ? policy.targets
      : step.approverRoles && step.approverRoles.length > 0
      ? step.approverRoles.map(role => ({
          targetType: 'CAPABILITY_ROLE' as const,
          targetId: role,
          label: role,
        }))
      : fallbackTeamIds.map(teamId => ({
          targetType: 'TEAM' as const,
          targetId: teamId,
          label: teamId,
        }));

  const dueAt =
    policy?.dueAt ||
    (policy?.escalationAfterMinutes
      ? new Date(Date.now() + policy.escalationAfterMinutes * 60_000).toISOString()
      : undefined);

  return targets.map(target => ({
    id: createApprovalAssignmentId(),
    capabilityId: capability.id,
    runId,
    waitId,
    phase: step.phase,
    stepName: step.name,
    approvalPolicyId: policy?.id,
    status: 'PENDING' as const,
    targetType: target.targetType,
    targetId: target.targetId,
    assignedUserId: target.targetType === 'USER' ? target.targetId : undefined,
    assignedTeamId: target.targetType === 'TEAM' ? target.targetId : undefined,
    dueAt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })) satisfies ApprovalAssignment[];
};

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

const summarizeText = (value: string, limit = 240) => {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
};

const inferAttachmentContentFormat = (
  attachment: WorkItemAttachmentUpload,
): Artifact['contentFormat'] => {
  const lowerName = attachment.fileName.toLowerCase();
  const lowerMime = String(attachment.mimeType || '').toLowerCase();
  if (lowerName.endsWith('.md') || lowerMime.includes('markdown')) {
    return 'MARKDOWN';
  }
  return 'TEXT';
};

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
  learningUpdates,
  taskMutator,
}: {
  capabilityId: string;
  workspace: ProjectionContext['workspace'];
  workItem: WorkItem;
  workflow: Workflow;
  logsToAppend?: ExecutionLog[];
  artifacts?: Artifact[];
  learningUpdates?: LearningUpdate[];
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
    learningUpdates: learningUpdates || workspace.learningUpdates,
  });
};

const buildTargetedLearningUpdates = ({
  workspace,
  capabilityId,
  focusedAgentId,
  insight,
  triggerType,
  relatedWorkItemId,
  relatedRunId,
  sourceLogIds = [],
}: {
  workspace: ProjectionContext['workspace'];
  capabilityId: string;
  focusedAgentId?: string;
  insight: string;
  triggerType: NonNullable<LearningUpdate['triggerType']>;
  relatedWorkItemId?: string;
  relatedRunId?: string;
  sourceLogIds?: string[];
}) => {
  const ownerAgentId = workspace.agents.find(agent => agent.isOwner)?.id;
  const executionAgentId = workspace.agents.find(
    agent => agent.standardTemplateKey === 'EXECUTION-OPS',
  )?.id;
  const targetAgentIds = [...new Set([focusedAgentId, ownerAgentId, executionAgentId])]
    .filter((value): value is string => Boolean(value));

  const nextUpdates = targetAgentIds.map(
    agentId =>
      ({
        id: createLearningUpdateId(),
        capabilityId,
        agentId,
        sourceLogIds,
        insight,
        timestamp: new Date().toISOString(),
        triggerType,
        relatedWorkItemId,
        relatedRunId,
      }) satisfies LearningUpdate,
  );

  return [...workspace.learningUpdates, ...nextUpdates];
};

const queueTargetedLearningRefresh = async ({
  workspace,
  capabilityId,
  focusedAgentId,
  triggerType,
}: {
  workspace: ProjectionContext['workspace'];
  capabilityId: string;
  focusedAgentId?: string;
  triggerType: NonNullable<LearningUpdate['triggerType']>;
}) => {
  const ownerAgentId = workspace.agents.find(agent => agent.isOwner)?.id;
  const executionAgentId = workspace.agents.find(
    agent => agent.standardTemplateKey === 'EXECUTION-OPS',
  )?.id;
  const targetAgentIds = [...new Set([focusedAgentId, ownerAgentId, executionAgentId])]
    .filter((value): value is string => Boolean(value));

  await Promise.all(
    targetAgentIds.map(agentId =>
      queueSingleAgentLearningRefresh(
        capabilityId,
        agentId,
        `execution-feedback:${triggerType.toLowerCase()}`,
      ),
    ),
  ).catch(() => undefined);
  wakeAgentLearningWorker();
};

const extractBalancedJsonCandidates = (value: string) => {
  const candidates: string[] = [];
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (startIndex === -1) {
      if (character === '{') {
        startIndex = index;
        depth = 1;
        inString = false;
        escaping = false;
      }
      continue;
    }

    if (escaping) {
      escaping = false;
      continue;
    }

    if (character === '\\' && inString) {
      escaping = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        candidates.push(value.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return candidates;
};

const tryParseJsonObject = (value?: string | null) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : null;
  } catch {
    return null;
  }
};

export const extractJsonObject = (value: string) => {
  const trimmed = value.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1],
    trimmed.match(/```\s*([\s\S]*?)```/i)?.[1],
    ...extractBalancedJsonCandidates(trimmed),
    trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed) {
      return parsed;
    }
  }

  throw new Error('Model response did not contain valid JSON.');
};

const combineUsage = (
  left: DecisionEnvelope['usage'],
  right: DecisionEnvelope['usage'],
): DecisionEnvelope['usage'] => ({
  promptTokens: left.promptTokens + right.promptTokens,
  completionTokens: left.completionTokens + right.completionTokens,
  totalTokens: left.totalTokens + right.totalTokens,
  estimatedCostUsd: Number((left.estimatedCostUsd + right.estimatedCostUsd).toFixed(4)),
});

export const buildExecutionFailureRecoveryMessage = (
  step: WorkflowStep,
  message: string,
) => {
  const normalizedMessage = String(message || '').trim();
  const appendFailureDetail = (base: string) => {
    if (!normalizedMessage) {
      return base;
    }

    const condensed = normalizedMessage.replace(/\s+/g, ' ').trim();
    if (!condensed) {
      return base;
    }

    const detail = condensed.length > 240 ? `${condensed.slice(0, 237)}...` : condensed;
    return `${base} Actual failure: ${detail}`;
  };

  if (/valid JSON/i.test(normalizedMessage)) {
    return appendFailureDetail(
      `${step.name} returned malformed structured output. Add guidance for this step and restart the workflow from ${step.phase}.`,
    );
  }

  if (/timed out|timeout/i.test(normalizedMessage)) {
    return appendFailureDetail(
      `${step.name} timed out while waiting for the agent response. Add guidance or retry the step when the runtime is healthy.`,
    );
  }

  if (/rate limit|too many requests/i.test(normalizedMessage)) {
    return appendFailureDetail(
      `${step.name} hit a model rate limit. Wait briefly, then add guidance or retry the step.`,
    );
  }

  return appendFailureDetail(
    `${step.name} could not complete automatically. Add guidance for the agent and restart this step.`,
  );
};

const repairMalformedExecutionDecision = async ({
  capability,
  workItem,
  workflow,
  step,
  runStep,
  agent,
  malformedResponse,
  repairReason,
}: {
  capability: Capability;
  workItem: WorkItem;
  workflow: Workflow;
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  agent: CapabilityAgent;
  malformedResponse: string;
  repairReason?: string;
}) => {
  const startedAt = Date.now();
  const repaired = await invokeScopedCapabilitySession({
    capability,
    agent,
    scope: workItem.id ? 'WORK_ITEM' : 'TASK',
    scopeId: workItem.id || runStep.id,
    developerPrompt:
      'You repair malformed workflow execution responses. Return one valid JSON object only with no markdown.',
    prompt: [
      `Workflow: ${workflow.name}`,
      `Step: ${step.name}`,
      `Phase: ${step.phase}`,
      `Attempt: ${runStep.attemptCount}`,
      repairReason
        ? `The previous assistant response for this step was incomplete or invalid: ${repairReason}`
        : 'The previous assistant response for this step was malformed and could not be parsed as JSON.',
      'Repair it into exactly one valid JSON object without adding commentary.',
      'If the intent is ambiguous after reading the malformed response, choose pause_for_input and ask for the smallest missing clarification.',
      'Allowed shapes:',
      '1. {"action":"invoke_tool","reasoning":"...","summary":"...","toolCall":{"toolId":"workspace_read","args":{"path":"README.md"}}}',
      '2. {"action":"complete","reasoning":"...","summary":"..."}',
      '3. {"action":"pause_for_input","reasoning":"...","wait":{"type":"INPUT","message":"..."}}',
      '4. {"action":"pause_for_approval","reasoning":"...","wait":{"type":"APPROVAL","message":"..."}}',
      '5. {"action":"pause_for_conflict","reasoning":"...","wait":{"type":"CONFLICT_RESOLUTION","message":"..."}}',
      '6. {"action":"fail","reasoning":"...","summary":"..."}',
      `Malformed response:\n${malformedResponse}`,
    ].join('\n\n'),
    timeoutMs: 45_000,
    resetSession: true,
  });

  const repairedObject = extractJsonObject(repaired.content) as Record<string, any>;

  return {
    decision: normalizeExecutionDecision(repairedObject),
    model: repaired.model,
    usage: repaired.usage,
    latencyMs: Date.now() - startedAt,
  };
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
  workspace,
  artifacts,
  compiledStepContext,
  compiledWorkItemPlan,
  toolHistory,
  operatorGuidanceContext,
}: {
  capability: Capability;
  workItem: WorkItem;
  workflow: Workflow;
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  agent: CapabilityAgent;
  workspace: CapabilityWorkspace;
  artifacts: Artifact[];
  compiledStepContext: CompiledStepContext;
  compiledWorkItemPlan: CompiledWorkItemPlan;
  toolHistory: Array<{ role: 'assistant' | 'user'; content: string }>;
  operatorGuidanceContext?: string;
}): Promise<DecisionEnvelope> => {
  const allowedToolIds = compiledStepContext.executionBoundary.allowedToolIds;
  const toolDescriptions = allowedToolIds.length
    ? listToolDescriptions(allowedToolIds).join('\n')
    : 'No tools are allowed for this step.';
  const approvedWorkspacePaths = getCapabilityWorkspaceRoots(capability);
  const workspaceProfile = detectWorkspaceProfile({
    defaultWorkspacePath: capability.executionConfig.defaultWorkspacePath,
    workspaceRoots: approvedWorkspacePaths,
  });
  const workspaceGuidance = approvedWorkspacePaths.length
    ? [
        workItem.executionContext?.branch
          ? `Shared work-item branch: ${workItem.executionContext.branch.sharedBranch} (base ${workItem.executionContext.branch.baseBranch}, status ${workItem.executionContext.branch.status})`
          : null,
        workItem.executionContext?.primaryRepositoryId
          ? `Primary work-item repository: ${
              capability.repositories?.find(
                repository => repository.id === workItem.executionContext?.primaryRepositoryId,
              )?.label ||
              workItem.executionContext.primaryRepositoryId
            }`
          : null,
        capability.executionConfig.defaultWorkspacePath
          ? `Default approved workspace path: ${capability.executionConfig.defaultWorkspacePath}`
          : null,
        `Approved workspace paths: ${approvedWorkspacePaths.join(', ')}`,
        ...buildWorkspaceProfilePromptLines(workspaceProfile),
        'When using workspace tools, prefer relative file paths and omit workspacePath unless you intentionally need a non-default approved workspace or approved subfolder.',
        'If you do provide workspacePath, it must be the approved root or a child folder inside one approved workspace root. Do not use sibling paths or parent traversal.',
      ]
        .filter(Boolean)
        .join('\n')
    : 'No approved workspace paths are configured for this capability.';
  const startedAt = Date.now();
  const workItemInputArtifacts = artifacts
    .filter(
      artifact =>
        artifact.workItemId === workItem.id &&
        artifact.direction === 'INPUT' &&
        Boolean(artifact.contentText || artifact.summary),
    )
    .slice(0, 4);
  const workItemInputArtifactPrompt = workItemInputArtifacts.length
    ? workItemInputArtifacts
        .map(
          artifact =>
            `- ${artifact.name}${artifact.mimeType ? ` (${artifact.mimeType})` : ''}\n${summarizeText(artifact.contentText || artifact.summary || '', 1200)}`,
        )
        .join('\n\n')
    : 'No uploaded work item input files were attached.';
  const memoryContext = await buildMemoryContext({
    capabilityId: capability.id || workItem.capabilityId,
    agentId: agent.id,
    queryText: [
      workItem.title,
      workItem.description,
      step.action,
      step.name,
      ...workItemInputArtifacts.map(artifact => artifact.name),
    ]
      .filter(Boolean)
      .join('\n'),
  });
  const capabilityBriefingPrompt = buildCapabilityBriefingPrompt(
    buildCapabilityBriefing(capability),
  );
  const agentKnowledgePrompt = buildAgentKnowledgePrompt(
    buildAgentKnowledgeLens({
      capability,
      workspace,
      agent,
      workItemId: workItem.id,
    }),
  );

  const response = await invokeScopedCapabilitySession({
    capability,
    agent,
    scope: workItem.id ? 'WORK_ITEM' : 'TASK',
    scopeId: workItem.id || runStep.id,
    developerPrompt:
      'You are an execution engine inside a capability workflow. Return JSON only with no markdown.',
    memoryPrompt: memoryContext.prompt || undefined,
    prompt: [
      `Capability briefing:\n${capabilityBriefingPrompt}`,
      `Agent knowledge lens:\n${agentKnowledgePrompt}`,
      `Execution plan summary: ${compiledWorkItemPlan.planSummary}`,
      `Current workflow: ${workflow.name}`,
      `Current step: ${step.name}`,
      `Current phase: ${workItem.phase}`,
      `Current step attempt: ${runStep.attemptCount}`,
      `Step contract:\n${JSON.stringify(compiledStepContext, null, 2)}`,
      `Step objective: ${compiledStepContext.objective}`,
      `Step guidance: ${compiledStepContext.description || 'None'}`,
      `Execution notes: ${compiledStepContext.executionNotes || 'None'}`,
      `Attached work item input files:\n${workItemInputArtifactPrompt}`,
      `Workflow hand-off context from prior completed steps:\n${compiledStepContext.handoffContext || 'None'}`,
      `Resolved human input/conflict context for this step:\n${compiledStepContext.resolvedWaitContext || 'None'}`,
      `Explicit operator guidance and override context:\n${operatorGuidanceContext || 'None'}`,
      `Allowed tools:\n${toolDescriptions}`,
      `Workspace policy:\n${workspaceGuidance}`,
      toolHistory.length
        ? `Prior tool loop transcript:\n${toolHistory
            .map(item => `${item.role.toUpperCase()}: ${item.content}`)
            .join('\n\n')}`
        : null,
      'Treat the compiled step contract as authoritative. Stay inside the execution boundary, use the required inputs and artifact checklist as the operating contract, and never invent orchestration outside this single step.',
      'Use prior-step hand-offs, retrieved memory, and resolved human inputs as authoritative downstream context. Do not ask for information that is already present in those sections. If you truly need more input, explain exactly what new gap remains and why the existing context is insufficient.',
      'If explicit operator guidance says to skip build, test, or docs execution for this attempt because the command template is unavailable or intentionally waived, do not keep retrying that tool. Complete the step with a clear note about the skipped validation, or pause for input only if the operator instruction is genuinely ambiguous.',
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

  try {
    const parsed = extractJsonObject(response.content) as Record<string, any>;
    const repairReason = getExecutionDecisionRepairReason(parsed);
    if (repairReason) {
      const repaired = await repairMalformedExecutionDecision({
        capability,
        workItem,
        workflow,
        step,
        runStep,
        agent,
        malformedResponse: response.content,
        repairReason,
      });

      return {
        decision: repaired.decision,
        model: repaired.model,
        usage: combineUsage(response.usage, repaired.usage),
        latencyMs: Date.now() - startedAt,
        retrievalReferences: memoryContext.results.map(result => result.reference),
      } as DecisionEnvelope;
    }

    return {
      decision: normalizeExecutionDecision(parsed),
      model: response.model,
      usage: response.usage,
      latencyMs: Date.now() - startedAt,
      retrievalReferences: memoryContext.results.map(result => result.reference),
    } as DecisionEnvelope;
  } catch (error) {
    if (!(error instanceof Error) || !/valid JSON/i.test(error.message)) {
      throw error;
    }

    const repaired = await repairMalformedExecutionDecision({
      capability,
      workItem,
      workflow,
        step,
        runStep,
        agent,
        malformedResponse: response.content,
        repairReason: 'The response did not contain valid JSON.',
      });

    return {
      decision: repaired.decision,
      model: repaired.model,
      usage: combineUsage(response.usage, repaired.usage),
      latencyMs: Date.now() - startedAt,
      retrievalReferences: memoryContext.results.map(result => result.reference),
    } as DecisionEnvelope;
  }
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

const buildOperatorGuidanceContext = ({
  workItem,
  artifacts,
}: {
  workItem: WorkItem;
  artifacts: Artifact[];
}) => {
  const guidanceHistory = workItem.history
    .filter(entry =>
      [
        'Agent guidance added',
        'Stage control session completed',
        'Changes requested',
        'Conflict resolved',
        'Human input provided',
      ].includes(entry.action),
    )
    .slice(-6)
    .map(entry => `${entry.action}: ${entry.detail}`);

  const guidanceArtifacts = artifacts
    .filter(
      artifact =>
        artifact.workItemId === workItem.id &&
        (
          artifact.artifactKind === 'INPUT_NOTE' ||
          artifact.artifactKind === 'STAGE_CONTROL_NOTE' ||
          artifact.artifactKind === 'CONFLICT_RESOLUTION' ||
          artifact.artifactKind === 'APPROVAL_RECORD'
        ),
    )
    .slice()
    .sort(
      (left, right) =>
        new Date(right.created || 0).getTime() - new Date(left.created || 0).getTime(),
    )
    .slice(0, 4)
    .reverse()
    .map(
      artifact =>
        `${artifact.name}: ${artifact.summary || compactMarkdownSummary(artifact.contentText || '')}`,
    );

  const sections = [
    guidanceHistory.length > 0
      ? `Recent operator guidance history:\n${guidanceHistory.join('\n')}`
      : null,
    guidanceArtifacts.length > 0
      ? `Latest operator guidance artifacts:\n${guidanceArtifacts.join('\n')}`
      : null,
  ].filter(Boolean) as string[];

  return sections.length > 0 ? sections.join('\n\n') : undefined;
};

const buildStructuredInputWaitMessage = (
  step: WorkflowStep,
  missingInputs: CompiledRequiredInputField[],
) => {
  const labels = missingInputs.map(input => input.label);

  if (labels.length === 1) {
    return `${step.name} needs one more structured input before execution can continue: ${labels[0]}.`;
  }

  if (labels.length === 2) {
    return `${step.name} needs two structured inputs before execution can continue: ${labels.join(' and ')}.`;
  }

  return `${step.name} is waiting for ${labels.length} structured inputs before execution can continue: ${labels.join(', ')}.`;
};

const buildExecutionPlanArtifact = ({
  detail,
  step,
  runStep,
  plan,
}: {
  detail: WorkflowRunDetail;
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  plan: CompiledWorkItemPlan;
}): Artifact => ({
  id: createArtifactId(),
  name: `${step.name} Execution Plan`,
  capabilityId: detail.run.capabilityId,
  type: 'Execution Plan',
  version: `run-${detail.run.attemptNumber}`,
  agent: step.agentId,
  created: plan.compiledAt,
  direction: 'OUTPUT',
  connectedAgentId: step.agentId,
  sourceWorkflowId: detail.run.workflowId,
  runId: detail.run.id,
  runStepId: runStep.id,
  summary: compactMarkdownSummary(plan.planSummary),
  artifactKind: 'EXECUTION_PLAN',
  phase: step.phase,
  workItemId: detail.run.workItemId,
  sourceRunId: detail.run.id,
  sourceRunStepId: runStep.id,
  contentFormat: 'MARKDOWN',
  mimeType: 'text/markdown',
  fileName: `${toFileSlug(detail.run.workItemId)}-${toFileSlug(step.name)}-execution-plan.md`,
  contentText: `# ${step.name} Execution Plan\n\n${buildMarkdownArtifact([
    ['Work Item', detail.run.workItemId],
    ['Workflow', detail.run.workflowSnapshot.name],
    ['Phase', getLifecyclePhaseLabel(undefined, step.phase)],
    ['Current Step', step.name],
    ['Plan Summary', plan.planSummary],
    [
      'Required Inputs',
      plan.currentStep.requiredInputs
        .map(input => `${input.label} (${input.status})`)
        .join(', '),
    ],
    [
      'Completion Checklist',
      plan.currentStep.completionChecklist.length > 0
        ? plan.currentStep.completionChecklist.join('\n')
        : 'Complete the step when the current objective and evidence contract are satisfied.',
    ],
    [
      'Allowed Tools',
      plan.currentStep.executionBoundary.allowedToolIds.length > 0
        ? plan.currentStep.executionBoundary.allowedToolIds.join(', ')
        : 'No tools allowed',
    ],
  ])}`,
  contentJson: plan,
  downloadable: true,
  traceId: detail.run.traceId,
});

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
    phaseOwnerTeamId: resolveWorkItemPhaseOwnerTeamId({
      capability,
      phaseId: currentStep.phase,
      step: currentStep,
    }),
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
    phaseOwnerTeamId: resolveWorkItemPhaseOwnerTeamId({
      capability: projection.capability,
      phaseId: currentStep.phase,
      step: currentStep,
    }),
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
        phaseOwnerTeamId: resolveWorkItemPhaseOwnerTeamId({
          capability: projection.capability,
          phaseId: nextStep.phase,
          step: nextStep,
        }),
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
  const recoveryMessage = buildExecutionFailureRecoveryMessage(currentStep, message);
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    phase: currentStep.phase,
    phaseOwnerTeamId: resolveWorkItemPhaseOwnerTeamId({
      capability: projection.capability,
      phaseId: currentStep.phase,
      step: currentStep,
    }),
    currentStepId: currentStep.id,
    assignedAgentId: currentStep.agentId,
    status: 'BLOCKED',
    pendingRequest: {
      type: 'INPUT',
      message: recoveryMessage,
      requestedBy: currentStep.agentId,
      timestamp: new Date().toISOString(),
    },
    blocker: {
      type: 'HUMAN_INPUT',
      message: recoveryMessage,
      requestedBy: currentStep.agentId,
      timestamp: new Date().toISOString(),
      status: 'OPEN',
    },
    activeRunId: undefined,
    lastRunId: detail.run.id,
    history: [
      ...projection.workItem.history,
      createHistoryEntry('System', 'Execution failed', message, currentStep.phase, 'BLOCKED'),
      createHistoryEntry(
        'System',
        'Guidance requested',
        recoveryMessage,
        currentStep.phase,
        'BLOCKED',
      ),
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
  workItem,
  lifecycle,
  step,
  nextStep,
  runStep,
  summary,
}: {
  detail: WorkflowRunDetail;
  workItem?: WorkItem;
  lifecycle?: Capability['lifecycle'];
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
    ['Source Phase', getLifecyclePhaseLabel(lifecycle, step.phase)],
    ['Target Phase', getLifecyclePhaseLabel(lifecycle, nextStep.phase)],
    ['Source Agent', step.agentId],
    ['Target Agent', nextStep.agentId],
    ['Carry Forward Summary', summary],
    [
      'Signed On Behalf Of',
      buildWorkItemPhaseSignatureMarkdown({
        workItem,
        source: lifecycle,
        phaseId: nextStep.phase,
      }),
    ],
  ])}`,
  downloadable: true,
  traceId: detail.run.traceId,
});

const buildHumanInteractionArtifact = ({
  detail,
  workItem,
  lifecycle,
  step,
  runStep,
  wait,
  resolution,
  resolvedBy,
}: {
  detail: WorkflowRunDetail;
  workItem?: WorkItem;
  lifecycle?: Capability['lifecycle'];
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  wait: RunWait;
  resolution: string;
  resolvedBy: string;
}): Artifact => {
  const contrarianReview =
    wait.type === 'CONFLICT_RESOLUTION' ? wait.payload?.contrarianReview : undefined;
  const requestedInputFields = Array.isArray(wait.payload?.requestedInputFields)
    ? (wait.payload?.requestedInputFields as CompiledRequiredInputField[])
    : [];
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
      ['Phase', getLifecyclePhaseLabel(lifecycle, step.phase)],
      ['Requested By', wait.requestedBy],
      ['Request', wait.message],
      requestedInputFields.length > 0
        ? [
            'Requested Inputs',
            requestedInputFields
              .map(field => `${field.label}${field.description ? ` - ${field.description}` : ''}`)
              .join('\n'),
          ]
        : ['Requested Inputs', undefined],
      ['Resolved By', resolvedBy],
      ['Resolution', resolution],
      [
        'Signed On Behalf Of',
        buildWorkItemPhaseSignatureMarkdown({
          workItem,
          source: lifecycle,
          phaseId: step.phase,
        }),
      ],
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

const buildOperatorGuidanceArtifact = ({
  capabilityId,
  workItem,
  lifecycle,
  workflow,
  guidance,
  guidedBy,
}: {
  capabilityId: string;
  workItem: WorkItem;
  lifecycle?: Capability['lifecycle'];
  workflow: Workflow;
  guidance: string;
  guidedBy: string;
}): Artifact => ({
  id: createArtifactId(),
  name: `${workItem.title} Agent Guidance`,
  capabilityId,
  type: 'Human Interaction',
  version: `phase-${toFileSlug(workItem.phase)}`,
  agent: guidedBy,
  created: new Date().toISOString(),
  direction: 'OUTPUT',
  connectedAgentId: workItem.assignedAgentId,
  sourceWorkflowId: workflow.id,
  summary: compactMarkdownSummary(guidance),
  artifactKind: 'INPUT_NOTE',
  phase: workItem.phase,
  workItemId: workItem.id,
  contentFormat: 'MARKDOWN',
  mimeType: 'text/markdown',
  fileName: `${toFileSlug(workItem.id)}-agent-guidance.md`,
  contentText: `# Agent Guidance\n\n${buildMarkdownArtifact([
    ['Work Item', workItem.id],
    ['Phase', getLifecyclePhaseLabel(lifecycle, workItem.phase)],
    ['Guided By', guidedBy],
    ['Current Status', workItem.status],
    ['Guidance', guidance],
    [
      'Signed On Behalf Of',
      buildWorkItemPhaseSignatureMarkdown({
        workItem,
        source: lifecycle,
        phaseId: workItem.phase,
      }),
    ],
  ])}`,
  downloadable: true,
});

const buildWorkItemAttachmentArtifact = ({
  capability,
  workflow,
  workItem,
  attachment,
}: {
  capability: Capability;
  workflow: Workflow;
  workItem: WorkItem;
  attachment: WorkItemAttachmentUpload;
}): Artifact => {
  const preview = summarizeText(attachment.contentText);
  const artifactName = `${workItem.title} · ${attachment.fileName}`;
  const contentFormat = inferAttachmentContentFormat(attachment);

  return {
    id: createArtifactId(),
    name: artifactName,
    capabilityId: capability.id,
    type: 'Reference Document',
    version: `phase-${toFileSlug(workItem.phase)}`,
    agent: 'User Upload',
    created: new Date().toISOString(),
    direction: 'INPUT',
    connectedAgentId: workItem.assignedAgentId,
    sourceWorkflowId: workflow.id,
    summary: compactMarkdownSummary(
      `Uploaded work item reference file ${attachment.fileName}. ${preview}`,
    ),
    artifactKind: 'INPUT_NOTE',
    phase: workItem.phase,
    workItemId: workItem.id,
    contentFormat,
    mimeType: attachment.mimeType || 'text/plain',
    fileName: attachment.fileName,
    contentText:
      contentFormat === 'MARKDOWN'
        ? `# ${attachment.fileName}\n\n${buildMarkdownArtifact([
            ['Work Item', workItem.id],
            ['Phase', getLifecyclePhaseLabel(capability.lifecycle, workItem.phase)],
            ['Uploaded For', workItem.title],
            ['Summary', preview],
          ])}\n\n## Source Content\n\n${attachment.contentText}`
        : `# ${attachment.fileName}\n\n${buildMarkdownArtifact([
            ['Work Item', workItem.id],
            ['Phase', getLifecyclePhaseLabel(capability.lifecycle, workItem.phase)],
            ['Uploaded For', workItem.title],
            ['Summary', preview],
          ])}\n\n## Source Content\n\n${attachment.contentText}`,
    downloadable: true,
  };
};

const recordOperatorGuidance = async ({
  capabilityId,
  workItemId,
  workflowOverride,
  guidance,
  guidedBy,
}: {
  capabilityId: string;
  workItemId: string;
  workflowOverride?: Workflow;
  guidance?: string;
  guidedBy?: string;
}) => {
  const trimmedGuidance = guidance?.trim();
  if (!trimmedGuidance) {
    return resolveProjectionContext(capabilityId, workItemId, workflowOverride);
  }

  const projection = await resolveProjectionContext(
    capabilityId,
    workItemId,
    workflowOverride,
  );
  const actor = guidedBy?.trim() || 'Capability Owner';
  const guidanceArtifact = buildOperatorGuidanceArtifact({
    capabilityId,
    workItem: projection.workItem,
    lifecycle: projection.capability.lifecycle,
    workflow: projection.workflow,
    guidance: trimmedGuidance,
    guidedBy: actor,
  });
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        actor,
        'Agent guidance added',
        trimmedGuidance,
        projection.workItem.phase,
        projection.workItem.status,
      ),
    ],
  };
  const nextArtifacts = replaceArtifacts(projection.workspace.artifacts, [
    guidanceArtifact,
  ]);
  const guidanceLog = createExecutionLog({
    capabilityId,
    taskId: projection.workItem.id,
    agentId: projection.workItem.assignedAgentId || 'SYSTEM',
    message: trimmedGuidance,
    metadata: {
      interactionType: 'AGENT_GUIDANCE',
      artifactId: guidanceArtifact.id,
      guidedBy: actor,
    },
  });
  const nextLearningUpdates = buildTargetedLearningUpdates({
    workspace: projection.workspace,
    capabilityId,
    focusedAgentId: projection.workItem.assignedAgentId,
    insight: `Operator guidance was added for ${projection.workItem.title}: ${trimmedGuidance}`,
    triggerType: 'GUIDANCE',
    relatedWorkItemId: projection.workItem.id,
    relatedRunId: projection.workItem.activeRunId || projection.workItem.lastRunId,
    sourceLogIds: [guidanceLog.id],
  });

  await persistProjection({
    capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: projection.workflow,
    artifacts: nextArtifacts,
    logsToAppend: [guidanceLog],
    learningUpdates: nextLearningUpdates,
  });
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);
  await queueTargetedLearningRefresh({
    workspace: projection.workspace,
    capabilityId,
    focusedAgentId: projection.workItem.assignedAgentId,
    triggerType: 'GUIDANCE',
  });

  return {
    ...projection,
    workItem: nextWorkItem,
    workspace: {
      ...projection.workspace,
      workItems: replaceWorkItem(projection.workspace.workItems, nextWorkItem),
      artifacts: nextArtifacts,
    },
  };
};

type StageControlConversationEntry = {
  role: 'user' | 'agent';
  content: string;
  timestamp?: string;
};

const buildStageControlTranscriptMarkdown = (
  conversation: StageControlConversationEntry[],
) =>
  conversation
    .filter(entry => entry.content?.trim())
    .map(entry => {
      const speaker = entry.role === 'agent' ? 'Agent' : 'Operator';
      const timestamp = entry.timestamp?.trim() ? ` (${entry.timestamp.trim()})` : '';
      return `### ${speaker}${timestamp}\n\n${entry.content.trim()}`;
    })
    .join('\n\n');

const buildStageControlCarryForwardNote = ({
  workItem,
  step,
  conversation,
  carryForwardNote,
}: {
  workItem: WorkItem;
  step?: WorkflowStep;
  conversation: StageControlConversationEntry[];
  carryForwardNote?: string;
}) => {
  const trimmedCarryForward = carryForwardNote?.trim();
  const latestOperatorMessage = [...conversation]
    .reverse()
    .find(entry => entry.role === 'user' && entry.content?.trim())
    ?.content?.trim();
  const latestAgentMessage = [...conversation]
    .reverse()
    .find(entry => entry.role === 'agent' && entry.content?.trim())
    ?.content?.trim();

  return [
    trimmedCarryForward ? `Operator continuation note: ${trimmedCarryForward}` : null,
    latestOperatorMessage ? `Latest operator direction: ${latestOperatorMessage}` : null,
    latestAgentMessage ? `Latest agent conclusion: ${latestAgentMessage}` : null,
    `Continue ${workItem.title}${step ? ` at ${step.name}` : ''} using the stage-control conversation as authoritative operator context.`,
  ]
    .filter(Boolean)
    .join('\n');
};

const buildStageControlArtifact = ({
  capabilityId,
  workItem,
  lifecycle,
  workflow,
  step,
  run,
  runStepId,
  conversation,
  carryForwardNote,
  resolvedBy,
}: {
  capabilityId: string;
  workItem: WorkItem;
  lifecycle?: Capability['lifecycle'];
  workflow: Workflow;
  step?: WorkflowStep;
  run?: WorkflowRun | null;
  runStepId?: string;
  conversation: StageControlConversationEntry[];
  carryForwardNote?: string;
  resolvedBy: string;
}): Artifact => ({
  id: createArtifactId(),
  name: `${workItem.title} Stage Control Note`,
  capabilityId,
  type: 'Human Interaction',
  version: `phase-${toFileSlug(workItem.phase)}`,
  agent: resolvedBy,
  created: new Date().toISOString(),
  direction: 'OUTPUT',
  connectedAgentId: step?.agentId || workItem.assignedAgentId,
  sourceWorkflowId: workflow.id,
  runId: run?.id,
  runStepId,
  summary: compactMarkdownSummary(
    buildStageControlCarryForwardNote({
      workItem,
      step,
      conversation,
      carryForwardNote,
    }),
  ),
  artifactKind: 'STAGE_CONTROL_NOTE',
  phase: workItem.phase,
  workItemId: workItem.id,
  contentFormat: 'MARKDOWN',
  mimeType: 'text/markdown',
  fileName: `${toFileSlug(workItem.id)}-stage-control-note.md`,
  contentText: `# Stage Control Note\n\n${buildMarkdownArtifact([
    ['Work Item', workItem.id],
    ['Phase', getLifecyclePhaseLabel(lifecycle, workItem.phase)],
    ['Stage', step?.name],
    ['Resolved By', resolvedBy],
    ['Run', run?.id],
    ['Carry Forward', carryForwardNote?.trim() || undefined],
    [
      'Signed On Behalf Of',
      buildWorkItemPhaseSignatureMarkdown({
        workItem,
        source: lifecycle,
        phaseId: workItem.phase,
      }),
    ],
  ])}\n\n## Conversation\n\n${buildStageControlTranscriptMarkdown(conversation) || 'No conversation transcript was captured.'}`,
  downloadable: true,
});

export const continueWorkflowStageControl = async ({
  capabilityId,
  workItemId,
  conversation,
  carryForwardNote,
  resolvedBy,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  conversation: StageControlConversationEntry[];
  carryForwardNote?: string;
  resolvedBy: string;
  actor?: ActorContext;
}) => {
  const trimmedConversation = conversation.filter(entry => entry.content?.trim());
  const trimmedCarryForward = carryForwardNote?.trim();

  if (trimmedConversation.length === 0 && !trimmedCarryForward) {
    throw new Error('Add stage-control conversation or a carry-forward note before continuing.');
  }

  const projection = await resolveProjectionContext(capabilityId, workItemId);
  const runId = projection.workItem.activeRunId || projection.workItem.lastRunId;
  const runDetail = runId
    ? await getWorkflowRunDetail(capabilityId, runId).catch(() => null)
    : null;
  const currentRunStep = runDetail
    ? (() => {
        try {
          return getCurrentRunStep(runDetail);
        } catch {
          return null;
        }
      })()
    : null;
  const currentStep =
    (runDetail ? getCurrentWorkflowStep(runDetail) : null) ||
    (projection.workItem.currentStepId
      ? projection.workflow.steps.find(step => step.id === projection.workItem.currentStepId)
      : undefined) ||
    projection.workflow.steps.find(step => step.phase === projection.workItem.phase) ||
    projection.workflow.steps[0];
  const carryForward = buildStageControlCarryForwardNote({
    workItem: projection.workItem,
    step: currentStep,
    conversation: trimmedConversation,
    carryForwardNote: trimmedCarryForward,
  });
  const stageControlArtifact = buildStageControlArtifact({
    capabilityId,
    workItem: projection.workItem,
    lifecycle: projection.capability.lifecycle,
    workflow: projection.workflow,
    step: currentStep,
    run: runDetail?.run || null,
    runStepId: currentRunStep?.id,
    conversation: trimmedConversation,
    carryForwardNote: trimmedCarryForward,
    resolvedBy,
  });
  const nextArtifacts = replaceArtifacts(projection.workspace.artifacts, [stageControlArtifact]);
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        resolvedBy,
        'Stage control session completed',
        trimmedCarryForward || carryForward,
        projection.workItem.phase,
        projection.workItem.status,
      ),
    ],
  };
  const stageControlLog = createExecutionLog({
    capabilityId,
    taskId: projection.workItem.id,
    agentId: currentStep?.agentId || projection.workItem.assignedAgentId || 'SYSTEM',
    message: trimmedCarryForward || carryForward,
    runId: runDetail?.run.id,
    runStepId: currentRunStep?.id,
    traceId: runDetail?.run.traceId,
    metadata: {
      interactionType: 'STAGE_CONTROL',
      artifactId: stageControlArtifact.id,
      resolvedBy,
      messageCount: trimmedConversation.length,
    },
  });
  const nextLearningUpdates = buildTargetedLearningUpdates({
    workspace: projection.workspace,
    capabilityId,
    focusedAgentId: currentStep?.agentId || projection.workItem.assignedAgentId,
    insight: `Stage control guidance was finalized for ${projection.workItem.title}: ${trimmedCarryForward || carryForward}`,
    triggerType: 'STAGE_CONTROL',
    relatedWorkItemId: projection.workItem.id,
    relatedRunId: runDetail?.run.id,
    sourceLogIds: [stageControlLog.id],
  });

  await persistProjection({
    capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: projection.workflow,
    artifacts: nextArtifacts,
    logsToAppend: [stageControlLog],
    learningUpdates: nextLearningUpdates,
  });
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);
  await queueTargetedLearningRefresh({
    workspace: projection.workspace,
    capabilityId,
    focusedAgentId: currentStep?.agentId || projection.workItem.assignedAgentId,
    triggerType: 'STAGE_CONTROL',
  });

  const openWait =
    runDetail?.waits.find(wait => wait.status === 'OPEN') || null;

  if (runDetail && openWait) {
    if (openWait.type === 'APPROVAL') {
      const detail = await approveWorkflowRun({
        capabilityId,
        runId: runDetail.run.id,
        resolution: carryForward,
        resolvedBy,
        actor,
      });
      return {
        action: 'APPROVED_WAIT' as const,
        summary: `${projection.workItem.title} was approved from the stage-control session and can move to the next stage once the current output is accepted.`,
        artifactId: stageControlArtifact.id,
        run: detail.run,
      };
    }

    if (openWait.type === 'INPUT') {
      const detail = await provideWorkflowRunInput({
        capabilityId,
        runId: runDetail.run.id,
        resolution: carryForward,
        resolvedBy,
        actor,
      });
      return {
        action: 'PROVIDED_INPUT' as const,
        summary: `${projection.workItem.title} received the missing stage guidance and resumed from the current stage.`,
        artifactId: stageControlArtifact.id,
        run: detail.run,
      };
    }

    const detail = await resolveWorkflowRunConflict({
      capabilityId,
      runId: runDetail.run.id,
      resolution: carryForward,
      resolvedBy,
      actor,
    });
    return {
      action: 'RESOLVED_CONFLICT' as const,
      summary: `${projection.workItem.title} received an operator decision from stage control and resumed from the current stage.`,
      artifactId: stageControlArtifact.id,
      run: detail.run,
    };
  }

  if (runDetail && ['QUEUED', 'RUNNING'].includes(runDetail.run.status)) {
    await cancelWorkflowRun({
      capabilityId,
      runId: runDetail.run.id,
      note: `Cancelled so ${resolvedBy} can take direct stage control.`,
    });
    const detail = await startWorkflowExecution({
      capabilityId,
      workItemId,
      restartFromPhase: projection.workItem.phase,
      guidance: carryForward,
      guidedBy: resolvedBy,
      actor,
    });
    return {
      action: 'CANCELLED_AND_RESTARTED' as const,
      summary: `${projection.workItem.title} was restarted from ${getLifecyclePhaseLabel(undefined, projection.workItem.phase)} with the stage-control guidance attached to the next attempt.`,
      artifactId: stageControlArtifact.id,
      run: detail.run,
    };
  }

  if (runDetail) {
    const detail = await restartWorkflowRun({
      capabilityId,
      runId: runDetail.run.id,
      restartFromPhase: projection.workItem.phase,
      guidance: carryForward,
      guidedBy: resolvedBy,
      actor,
    });
    return {
      action: 'RESTARTED' as const,
      summary: `${projection.workItem.title} was restarted from the current stage with the stage-control guidance attached to the next attempt.`,
      artifactId: stageControlArtifact.id,
      run: detail.run,
    };
  }

  const detail = await startWorkflowExecution({
    capabilityId,
    workItemId,
    restartFromPhase: projection.workItem.phase,
    guidance: carryForward,
    guidedBy: resolvedBy,
    actor,
  });
  return {
    action: 'STARTED' as const,
    summary: `${projection.workItem.title} started from ${getLifecyclePhaseLabel(undefined, projection.workItem.phase)} with the stage-control guidance attached to the first attempt.`,
    artifactId: stageControlArtifact.id,
    run: detail.run,
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
  taskType,
  phaseStakeholders,
  attachments,
  priority,
  tags,
  actor,
}: {
  capabilityId: string;
  title: string;
  description?: string;
  workflowId: string;
  taskType?: WorkItem['taskType'];
  phaseStakeholders?: WorkItem['phaseStakeholders'];
  attachments?: WorkItemAttachmentUpload[];
  priority: WorkItem['priority'];
  tags: string[];
  actor?: ActorContext;
}) => {
  const bundle = await getCapabilityBundle(capabilityId);
  if (bundle.capability.isSystemCapability) {
    throw new Error(
      `${bundle.capability.name} is a system foundation capability and cannot accept work items.`,
    );
  }
  const workflow = bundle.workspace.workflows.find(item => item.id === workflowId);
  if (!workflow) {
    throw new Error(`Workflow ${workflowId} was not found.`);
  }

  const normalizedTaskType = normalizeWorkItemTaskType(taskType);
  const normalizedPhaseStakeholders = normalizeWorkItemPhaseStakeholders(
    phaseStakeholders,
    bundle.capability.lifecycle,
  );
  const normalizedAttachments = (attachments || [])
    .map(attachment => ({
      fileName: normalizeString(attachment.fileName),
      mimeType: normalizeString(attachment.mimeType) || undefined,
      contentText: typeof attachment.contentText === 'string' ? attachment.contentText : '',
      sizeBytes:
        typeof attachment.sizeBytes === 'number' && Number.isFinite(attachment.sizeBytes)
          ? attachment.sizeBytes
          : undefined,
    }))
    .filter(attachment => attachment.fileName && attachment.contentText.trim().length > 0);
  const firstStep = resolveWorkItemEntryStep(
    workflow,
    normalizedTaskType,
    bundle.capability.lifecycle,
  );
  if (!firstStep) {
    throw new Error(`Workflow ${workflow.name} does not define any executable nodes.`);
  }
  const phaseOwnerTeamId = resolveWorkItemPhaseOwnerTeamId({
    capability: bundle.capability,
    phaseId: firstStep.phase,
    step: firstStep,
  });
  const actorName = getActorDisplayName(actor, 'System');
  const shouldClaim = Boolean(actor?.userId);

  const nextWorkItem: WorkItem = {
    id: `WI-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    title: title.trim(),
    description: description?.trim() || `Delivery story for ${bundle.capability.name}.`,
    taskType: normalizedTaskType,
    phaseStakeholders: normalizedPhaseStakeholders,
    phase: firstStep.phase,
    phaseOwnerTeamId,
    claimOwnerUserId: shouldClaim ? actor?.userId : undefined,
    watchedByUserIds: shouldClaim && actor?.userId ? [actor.userId] : [],
    capabilityId,
    workflowId,
    currentStepId: firstStep.id,
    assignedAgentId: firstStep.agentId,
    status: getStepStatus(firstStep),
    priority,
    tags,
    recordVersion: 1,
    history: [
      createHistoryEntry(
        actorName,
        'Story created',
        `${getWorkItemTaskTypeLabel(normalizedTaskType)} work entered ${firstStep.name} in ${workflow.name}.${normalizedPhaseStakeholders.length > 0 ? ` Stakeholder sign-off was configured for ${normalizedPhaseStakeholders.length} phases.` : ''}${normalizedAttachments.length > 0 ? ` ${normalizedAttachments.length} supporting file${normalizedAttachments.length === 1 ? '' : 's'} were attached for agent context.` : ''}`,
        firstStep.phase,
        getStepStatus(firstStep),
      ),
      ...(shouldClaim
        ? [
            createHistoryEntry(
              actorName,
              'Operator control claimed',
              `${actorName} automatically took initial operator control so execution can begin immediately. Release control to hand off to the phase owner team when ready.`,
              firstStep.phase,
              getStepStatus(firstStep),
            ),
          ]
        : []),
    ],
  };

  if (shouldClaim && actor?.userId) {
    await upsertWorkItemClaim({
      capabilityId,
      workItemId: nextWorkItem.id,
      userId: actor.userId,
      teamId: actor.teamIds?.[0],
      status: 'ACTIVE',
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  }

  const attachmentArtifacts = normalizedAttachments.map(attachment =>
    buildWorkItemAttachmentArtifact({
      capability: bundle.capability,
      workflow,
      workItem: nextWorkItem,
      attachment,
    }),
  );
  const nextArtifacts = attachmentArtifacts.length
    ? replaceArtifacts(bundle.workspace.artifacts, attachmentArtifacts)
    : bundle.workspace.artifacts;

  const nextTasks = syncWorkflowManagedTasksForWorkItem({
    allTasks: bundle.workspace.tasks,
    workItem: nextWorkItem,
    workflow,
    artifacts: nextArtifacts,
  });

  await replaceCapabilityWorkspaceContentRecord(capabilityId, {
    workItems: [...bundle.workspace.workItems, nextWorkItem],
    tasks: nextTasks,
    artifacts: nextArtifacts,
    executionLogs: [
      ...bundle.workspace.executionLogs,
      createExecutionLog({
        capabilityId,
        taskId: nextWorkItem.id,
        agentId: firstStep.agentId,
        message: `${nextWorkItem.title} entered ${firstStep.name} in ${workflow.name}.${normalizedAttachments.length > 0 ? ` ${normalizedAttachments.length} uploaded file${normalizedAttachments.length === 1 ? '' : 's'} were attached.` : ''}`,
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
  cancelRunIfPresent,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  targetPhase: WorkItemPhase;
  note?: string;
  cancelRunIfPresent?: boolean;
  actor?: ActorContext;
}) => {
  let projection = await resolveProjectionContext(capabilityId, workItemId);
  if (!getCapabilityBoardPhaseIds(projection.capability).includes(targetPhase)) {
    throw new Error(
      `Phase ${targetPhase} is not part of ${projection.capability.name}'s lifecycle.`,
    );
  }

  const activeRun = await getActiveRunForWorkItem(capabilityId, workItemId);
  if (activeRun) {
    if (!cancelRunIfPresent) {
      throw new Error(
        'This work item already has an active or waiting run. Cancel or complete it before moving the board card.',
      );
    }

    await cancelWorkflowRun({
      capabilityId,
      runId: activeRun.id,
      note: `Cancelled due to phase change to ${getLifecyclePhaseLabel(projection.capability, targetPhase)}.`,
    });

    projection = await resolveProjectionContext(capabilityId, workItemId);
  }

  const targetNode =
    targetPhase === 'BACKLOG' || targetPhase === 'DONE'
      ? undefined
      : findFirstExecutableNodeForPhase(projection.workflow, targetPhase) ||
        findFirstExecutableNode(projection.workflow);
  const targetStep = targetNode
    ? projection.workflow.steps.find(step => step.id === targetNode.id)
    : undefined;
  const nextPhaseOwnerTeamId =
    targetPhase === 'BACKLOG' || targetPhase === 'DONE'
      ? resolveWorkItemPhaseOwnerTeamId({
          capability: projection.capability,
          phaseId: targetPhase,
        })
      : resolveWorkItemPhaseOwnerTeamId({
          capability: projection.capability,
          phaseId: targetPhase,
          step: targetStep,
        });
  const actorName = getActorDisplayName(actor, 'User');

  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    phase: targetPhase,
    phaseOwnerTeamId: nextPhaseOwnerTeamId,
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
    claimOwnerUserId:
      actor?.userId && targetPhase !== 'BACKLOG' && targetPhase !== 'DONE'
        ? actor.userId
        : undefined,
    recordVersion: (projection.workItem.recordVersion || 1) + 1,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        actorName,
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
  guidance,
  guidedBy,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  restartFromPhase?: WorkItemPhase;
  guidance?: string;
  guidedBy?: string;
  actor?: ActorContext;
}) => {
  const existingActiveRun = await getActiveRunForWorkItem(capabilityId, workItemId);
  if (existingActiveRun) {
    throw new Error(
      `Work item ${workItemId} already has an active or waiting workflow run.`,
    );
  }

  let projection = await recordOperatorGuidance({
    capabilityId,
    workItemId,
    guidance,
    guidedBy,
  });

  // Starting execution is an operator action. If the work item is still unclaimed, implicitly
  // claim operator control for the starting actor so the flow "just works" in multi-team work.
  if (actor?.userId && !projection.workItem.claimOwnerUserId) {
    const actorName = getActorDisplayName(actor, guidedBy || 'Capability Owner');
    const claimedAt = new Date().toISOString();

    await upsertWorkItemClaim({
      capabilityId,
      workItemId,
      userId: actor.userId,
      teamId: actor.teamIds?.[0],
      status: 'ACTIVE',
      claimedAt,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });

    const nextWorkItem: WorkItem = {
      ...projection.workItem,
      claimOwnerUserId: actor.userId,
      watchedByUserIds: Array.from(
        new Set([...(projection.workItem.watchedByUserIds || []), actor.userId]),
      ),
      recordVersion: (projection.workItem.recordVersion || 1) + 1,
      history: [
        ...projection.workItem.history,
        createHistoryEntry(
          actorName,
          'Operator control claimed',
          `${actorName} claimed operator control while starting execution.`,
          projection.workItem.phase,
          projection.workItem.status,
        ),
      ],
    };

    await persistProjection({
      capabilityId,
      workspace: projection.workspace,
      workItem: nextWorkItem,
      workflow: projection.workflow,
    });

    projection = {
      ...projection,
      workItem: nextWorkItem,
      workspace: {
        ...projection.workspace,
        workItems: replaceWorkItem(projection.workspace.workItems, nextWorkItem),
      },
    };
  }

  if (!canActorOperateWorkItem({ actor, workItem: projection.workItem })) {
    throw new Error('Only the current phase owner can start or restart this phase.');
  }
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
  actor,
}: {
  capabilityId: string;
  runId: string;
  expectedType: RunWaitType;
  resolution: string;
  resolvedBy: string;
  approvalDisposition?: 'APPROVE' | 'REQUEST_CHANGES';
  actor?: ActorContext;
}) => {
  const detail = await getWorkflowRunDetail(capabilityId, runId);
  if (detail.run.status === 'PAUSED') {
    throw new Error('Resume this run before resolving its wait.');
  }
  const projection = await resolveProjectionContext(
    capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  const openWait = [...detail.waits].reverse().find(wait => wait.status === 'OPEN');
  if (!openWait) {
    throw new Error(`Run ${runId} does not have an open wait to resolve.`);
  }
  if (openWait.type !== expectedType) {
    throw new Error(`Run ${runId} is waiting for ${openWait.type}, not ${expectedType}.`);
  }
  if (
    expectedType === 'APPROVAL' &&
    !canActorApproveWait({ actor, workItem: projection.workItem, wait: openWait })
  ) {
    throw new Error('This approval is assigned to another user or team.');
  }
  if (
    expectedType !== 'APPROVAL' &&
    !canActorOperateWorkItem({ actor, workItem: projection.workItem })
  ) {
    throw new Error('Only the current phase owner can resolve this workflow wait.');
  }

  await resolveRunWait({
    capabilityId,
    waitId: openWait.id,
    resolution,
    resolvedBy,
    resolvedByActorUserId: actor?.userId,
    resolvedByActorTeamIds: getActorTeamIds(actor),
  });
  if (expectedType === 'APPROVAL') {
    await updateApprovalAssignmentsForWait({
      capabilityId,
      waitId: openWait.id,
      status:
        approvalDisposition === 'REQUEST_CHANGES'
          ? 'REQUEST_CHANGES'
          : ('APPROVED' as const),
    });
    await createApprovalDecision({
      id: createApprovalDecisionId(),
      capabilityId,
      runId,
      waitId: openWait.id,
      assignmentId: (openWait.approvalAssignments || []).find(assignment => {
        if (!actor?.userId && getActorTeamIds(actor).length === 0) {
          return true;
        }
        if (assignment.targetType === 'USER') {
          return (assignment.assignedUserId || assignment.targetId) === actor?.userId;
        }
        if (assignment.targetType === 'TEAM') {
          const teamId = assignment.assignedTeamId || assignment.targetId;
          return getActorTeamIds(actor).includes(teamId);
        }
        return true;
      })?.id,
      disposition: approvalDisposition,
      actorUserId: actor?.userId,
      actorDisplayName: getActorDisplayName(actor, resolvedBy),
      actorTeamIds: getActorTeamIds(actor),
      comment: resolution,
      createdAt: new Date().toISOString(),
    });
  }

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
    workItem: projection.workItem,
    lifecycle: projection.capability.lifecycle,
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
          workItem: projection.workItem,
          lifecycle: projection.capability.lifecycle,
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
  const resolutionLog = createExecutionLog({
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
      actorUserId: actor?.userId,
      actorTeamIds: getActorTeamIds(actor),
      approvalDisposition:
        expectedType === 'APPROVAL' ? approvalDisposition : undefined,
      artifactId: interactionArtifact.id,
    },
  });
  const learningTriggerType =
    expectedType === 'CONFLICT_RESOLUTION'
      ? ('CONFLICT_RESOLUTION' as const)
      : isRequestChangesApproval
      ? ('REQUEST_CHANGES' as const)
      : null;
  const nextLearningUpdates = learningTriggerType
    ? buildTargetedLearningUpdates({
        workspace: projection.workspace,
        capabilityId,
        focusedAgentId: currentStep.agentId,
        insight:
          learningTriggerType === 'REQUEST_CHANGES'
            ? `Changes were requested for ${projection.workItem.title}: ${resolution}`
            : `Conflict resolution was provided for ${projection.workItem.title}: ${resolution}`,
        triggerType: learningTriggerType,
        relatedWorkItemId: projection.workItem.id,
        relatedRunId: detail.run.id,
        sourceLogIds: [resolutionLog.id],
      })
    : projection.workspace.learningUpdates;

  await persistProjection({
    capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: detail.run.workflowSnapshot,
    artifacts: nextArtifacts,
    logsToAppend: [resolutionLog],
    learningUpdates: nextLearningUpdates,
  });
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);
  if (learningTriggerType) {
    await queueTargetedLearningRefresh({
      workspace: projection.workspace,
      capabilityId,
      focusedAgentId: currentStep.agentId,
      triggerType: learningTriggerType,
    });
  }

  return nextDetail;
};

export const approveWorkflowRun = async ({
  capabilityId,
  runId,
  resolution,
  resolvedBy,
  actor,
}: {
  capabilityId: string;
  runId: string;
  resolution: string;
  resolvedBy: string;
  actor?: ActorContext;
}) =>
  resolveRunWaitAndQueue({
    capabilityId,
    runId,
    expectedType: 'APPROVAL',
    resolution,
    resolvedBy,
    actor,
  });

export const requestChangesWorkflowRun = async ({
  capabilityId,
  runId,
  resolution,
  resolvedBy,
  actor,
}: {
  capabilityId: string;
  runId: string;
  resolution: string;
  resolvedBy: string;
  actor?: ActorContext;
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
    actor,
  });
};

export const provideWorkflowRunInput = async ({
  capabilityId,
  runId,
  resolution,
  resolvedBy,
  actor,
}: {
  capabilityId: string;
  runId: string;
  resolution: string;
  resolvedBy: string;
  actor?: ActorContext;
}) =>
  resolveRunWaitAndQueue({
    capabilityId,
    runId,
    expectedType: 'INPUT',
    resolution,
    resolvedBy,
    actor,
  });

export const resolveWorkflowRunConflict = async ({
  capabilityId,
  runId,
  resolution,
  resolvedBy,
  actor,
}: {
  capabilityId: string;
  runId: string;
  resolution: string;
  resolvedBy: string;
  actor?: ActorContext;
}) =>
  resolveRunWaitAndQueue({
    capabilityId,
    runId,
    expectedType: 'CONFLICT_RESOLUTION',
    resolution,
    resolvedBy,
    actor,
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
  await Promise.all([
    cancelOpenWaitsForRun({ capabilityId, runId }),
    markOpenToolInvocationsAborted({ capabilityId, runId }),
  ]);
  await updateWorkflowRunControl({
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
  const nextWorkItemStatus: WorkItemStatus =
    projection.workItem.status === 'COMPLETED' || projection.workItem.status === 'CANCELLED'
      ? projection.workItem.status
      : 'ACTIVE';
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    status: nextWorkItemStatus,
    pendingRequest: undefined,
    blocker: undefined,
    activeRunId: undefined,
    lastRunId: runId,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        'User',
        'Run cancelled',
        note || 'Run cancelled by user.',
        projection.workItem.phase,
        nextWorkItemStatus,
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

const getRunStatusForWaitType = (waitType: RunWaitType): WorkflowRun['status'] => {
  if (waitType === 'APPROVAL') {
    return 'WAITING_APPROVAL';
  }
  if (waitType === 'INPUT') {
    return 'WAITING_INPUT';
  }
  return 'WAITING_CONFLICT';
};

const getWorkItemStatusForWaitType = (waitType: RunWaitType): WorkItemStatus =>
  waitType === 'APPROVAL' ? 'PENDING_APPROVAL' : 'BLOCKED';

export const pauseWorkflowRun = async ({
  capabilityId,
  runId,
  note,
  actor,
}: {
  capabilityId: string;
  runId: string;
  note?: string;
  actor?: ActorContext;
}) => {
  const detail = await getWorkflowRunDetail(capabilityId, runId);
  if (
    detail.run.status === 'CANCELLED' ||
    detail.run.status === 'COMPLETED' ||
    detail.run.status === 'FAILED'
  ) {
    return detail;
  }
  if (detail.run.status === 'PAUSED') {
    return detail;
  }

  const actorName = getActorDisplayName(actor, 'User');
  const pauseNote = note?.trim() || 'Execution paused by user.';

  await updateWorkflowRunControl({
    ...detail.run,
    status: 'PAUSED',
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
  });
  await releaseRunLease({ capabilityId, runId });

  const projection = await resolveProjectionContext(
    capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    status: 'PAUSED',
    recordVersion: (projection.workItem.recordVersion || 1) + 1,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        actorName,
        'Execution paused',
        pauseNote,
        projection.workItem.phase,
        'PAUSED',
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
        taskId: projection.workItem.id,
        agentId: projection.workItem.assignedAgentId || 'SYSTEM',
        message: pauseNote,
        level: 'WARN',
        runId,
        traceId: detail.run.traceId,
      }),
    ],
  });

  return getWorkflowRunDetail(capabilityId, runId);
};

export const resumeWorkflowRun = async ({
  capabilityId,
  runId,
  note,
  actor,
}: {
  capabilityId: string;
  runId: string;
  note?: string;
  actor?: ActorContext;
}) => {
  const detail = await getWorkflowRunDetail(capabilityId, runId);
  if (detail.run.status !== 'PAUSED') {
    return detail;
  }

  const actorName = getActorDisplayName(actor, 'User');
  const resumeNote = note?.trim() || 'Execution resumed by user.';
  const openWait = [...detail.waits].reverse().find(wait => wait.status === 'OPEN') || null;

  const projection = await resolveProjectionContext(
    capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );

  if (openWait) {
    const waitType = openWait.type;
    const nextRunStatus = getRunStatusForWaitType(waitType);
    const nextWorkItemStatus = getWorkItemStatusForWaitType(waitType);

    await updateWorkflowRunControl({
      ...detail.run,
      status: nextRunStatus,
      pauseReason: waitType,
      currentWaitId: openWait.id,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });

    const nextWorkItem: WorkItem = {
      ...projection.workItem,
      status: nextWorkItemStatus,
      recordVersion: (projection.workItem.recordVersion || 1) + 1,
      history: [
        ...projection.workItem.history,
        createHistoryEntry(
          actorName,
          'Execution resumed',
          resumeNote,
          projection.workItem.phase,
          nextWorkItemStatus,
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
          taskId: projection.workItem.id,
          agentId: projection.workItem.assignedAgentId || 'SYSTEM',
          message: resumeNote,
          level: 'INFO',
          runId,
          traceId: detail.run.traceId,
        }),
      ],
    });

    return getWorkflowRunDetail(capabilityId, runId);
  }

  await updateWorkflowRunControl({
    ...detail.run,
    status: 'QUEUED',
    pauseReason: undefined,
    currentWaitId: undefined,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
  });

  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    status: 'ACTIVE',
    pendingRequest: undefined,
    blocker: undefined,
    recordVersion: (projection.workItem.recordVersion || 1) + 1,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        actorName,
        'Execution resumed',
        resumeNote,
        projection.workItem.phase,
        'ACTIVE',
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
        taskId: projection.workItem.id,
        agentId: projection.workItem.assignedAgentId || 'SYSTEM',
        message: resumeNote,
        level: 'INFO',
        runId,
        traceId: detail.run.traceId,
      }),
    ],
  });

  return getWorkflowRunDetail(capabilityId, runId);
};

export const cancelWorkItemControl = async ({
  capabilityId,
  workItemId,
  note,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  note?: string;
  actor?: ActorContext;
}) => {
  const actorName = getActorDisplayName(actor, 'User');
  const cancellationNote = note?.trim() || 'Work item cancelled by user.';

  const activeRun = await getActiveRunForWorkItem(capabilityId, workItemId);
  if (activeRun) {
    await cancelWorkflowRun({
      capabilityId,
      runId: activeRun.id,
      note: cancellationNote,
    });
  }

  const activeClaims = await listActiveWorkItemClaims(capabilityId, workItemId);
  await Promise.all(
    activeClaims.map(claim =>
      releaseWorkItemClaim({
        capabilityId,
        workItemId: claim.workItemId,
        userId: claim.userId,
      }),
    ),
  );

  await Promise.all([
    releaseWorkItemCodeClaimRecord({ capabilityId, workItemId, claimType: 'WRITE' }),
    releaseWorkItemCodeClaimRecord({ capabilityId, workItemId, claimType: 'REVIEW' }),
  ]);

  const projection = await resolveProjectionContext(capabilityId, workItemId);

  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    status: 'CANCELLED',
    pendingRequest: undefined,
    blocker: undefined,
    pendingHandoff: undefined,
    activeRunId: undefined,
    claimOwnerUserId: undefined,
    recordVersion: (projection.workItem.recordVersion || 1) + 1,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        actorName,
        'Work item cancelled',
        cancellationNote,
        projection.workItem.phase,
        'CANCELLED',
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
        agentId: projection.workItem.assignedAgentId || projection.capability.specialAgentId || 'SYSTEM',
        message: cancellationNote,
        level: 'WARN',
        runId: activeRun?.id,
      }),
    ],
  });
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);

  return nextWorkItem;
};

export const archiveWorkItemControl = async ({
  capabilityId,
  workItemId,
  note,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  note?: string;
  actor?: ActorContext;
}) => {
  const actorName = getActorDisplayName(actor, 'User');
  const archiveNote = note?.trim() || 'Work item archived by user.';

  const activeRun = await getActiveRunForWorkItem(capabilityId, workItemId);
  if (activeRun) {
    await cancelWorkflowRun({
      capabilityId,
      runId: activeRun.id,
      note: archiveNote,
    });
  }

  const activeClaims = await listActiveWorkItemClaims(capabilityId, workItemId);
  await Promise.all(
    activeClaims.map(claim =>
      releaseWorkItemClaim({
        capabilityId,
        workItemId: claim.workItemId,
        userId: claim.userId,
      }),
    ),
  );

  await Promise.all([
    releaseWorkItemCodeClaimRecord({ capabilityId, workItemId, claimType: 'WRITE' }),
    releaseWorkItemCodeClaimRecord({ capabilityId, workItemId, claimType: 'REVIEW' }),
  ]);

  const projection = await resolveProjectionContext(capabilityId, workItemId);
  const archivedEntry = createHistoryEntry(
    actorName,
    'Work item archived',
    archiveNote,
    projection.workItem.phase,
    'ARCHIVED',
  );

  await transaction(async client => {
    const [runsResult, tasksResult, artifactsResult] = await Promise.all([
      client.query<{ id: string }>(
        `
          SELECT id
          FROM capability_workflow_runs
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
      client.query<{ id: string }>(
        `
          SELECT id
          FROM capability_tasks
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
      client.query<{ id: string }>(
        `
          SELECT id
          FROM capability_artifacts
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
    ]);

    const runIds = runsResult.rows.map(row => row.id);
    const taskIds = tasksResult.rows.map(row => row.id);
    const artifactIds = artifactsResult.rows.map(row => row.id);

    if (artifactIds.length > 0) {
      await client.query(
        `
          DELETE FROM capability_artifact_files
          WHERE capability_id = $1 AND artifact_id = ANY($2::text[])
        `,
        [capabilityId, artifactIds],
      );
    }

    await client.query(
      `
        DELETE FROM capability_artifacts
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [capabilityId, workItemId],
    );

    await client.query(
      `
        DELETE FROM capability_tasks
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [capabilityId, workItemId],
    );

    await client.query(
      `
        DELETE FROM capability_execution_logs
        WHERE capability_id = $1
          AND (
            task_id = $2
            OR task_id = ANY($3::text[])
            OR run_id = ANY($4::text[])
          )
      `,
      [capabilityId, workItemId, taskIds, runIds],
    );

    await client.query(
      `
        DELETE FROM capability_learning_updates
        WHERE capability_id = $1 AND related_work_item_id = $2
      `,
      [capabilityId, workItemId],
    );

    await client.query(
      `
        DELETE FROM capability_messages
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [capabilityId, workItemId],
    );

    await Promise.all([
      client.query(
        `
          DELETE FROM capability_work_item_repository_assignments
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
      client.query(
        `
          DELETE FROM capability_work_item_branches
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
      client.query(
        `
          DELETE FROM capability_work_item_code_claims
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
      client.query(
        `
          DELETE FROM capability_work_item_checkout_sessions
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
      client.query(
        `
          DELETE FROM capability_work_item_handoff_packets
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
      client.query(
        `
          DELETE FROM capability_work_item_claims
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
      client.query(
        `
          DELETE FROM capability_work_item_presence
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
      client.query(
        `
          DELETE FROM capability_ownership_transfers
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
      client.query(
        `
          DELETE FROM capability_phase_handoffs
          WHERE capability_id = $1 AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      ),
    ]);

    if (runIds.length > 0) {
      await Promise.all([
        client.query(
          `
            DELETE FROM capability_approval_assignments
            WHERE capability_id = $1 AND run_id = ANY($2::text[])
          `,
          [capabilityId, runIds],
        ),
        client.query(
          `
            DELETE FROM capability_approval_decisions
            WHERE capability_id = $1 AND run_id = ANY($2::text[])
          `,
          [capabilityId, runIds],
        ),
      ]);
    }

    // Removing workflow runs removes run steps/tool invocations/events/waits via cascade.
    await client.query(
      `
        DELETE FROM capability_workflow_runs
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [capabilityId, workItemId],
    );

    await client.query(
      `
        UPDATE capability_work_items
        SET
          status = $3,
          phase_owner_team_id = NULL,
          claim_owner_user_id = NULL,
          watched_by_user_ids = '{}',
          pending_handoff = NULL,
          current_step_id = NULL,
          assigned_agent_id = NULL,
          pending_request = NULL,
          blocker = NULL,
          active_run_id = NULL,
          last_run_id = NULL,
          history = $4::jsonb,
          record_version = record_version + 1,
          updated_at = NOW()
        WHERE capability_id = $1 AND id = $2
      `,
      [capabilityId, workItemId, 'ARCHIVED', JSON.stringify([archivedEntry])],
    );
  });

  await refreshCapabilityMemory(capabilityId).catch(() => undefined);

  return {
    ...projection.workItem,
    status: 'ARCHIVED',
    phaseOwnerTeamId: undefined,
    claimOwnerUserId: undefined,
    watchedByUserIds: [],
    pendingHandoff: undefined,
    currentStepId: undefined,
    assignedAgentId: undefined,
    pendingRequest: undefined,
    blocker: undefined,
    activeRunId: undefined,
    lastRunId: undefined,
    recordVersion: (projection.workItem.recordVersion || 1) + 1,
    history: [archivedEntry],
  };
};

export const restoreWorkItemControl = async ({
  capabilityId,
  workItemId,
  note,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  note?: string;
  actor?: ActorContext;
}) => {
  const projection = await resolveProjectionContext(capabilityId, workItemId);
  if (projection.workItem.status !== 'ARCHIVED') {
    throw new Error(`Work item ${workItemId} is not archived.`);
  }

  const workflow = projection.workflow;
  const normalizedTaskType = normalizeWorkItemTaskType(projection.workItem.taskType);
  const firstStep = resolveWorkItemEntryStep(
    workflow,
    normalizedTaskType,
    projection.capability.lifecycle,
  );
  if (!firstStep) {
    throw new Error(`Workflow ${workflow.name} does not define any executable nodes.`);
  }

  const phaseOwnerTeamId = resolveWorkItemPhaseOwnerTeamId({
    capability: projection.capability,
    phaseId: firstStep.phase,
    step: firstStep,
  });

  const actorName = getActorDisplayName(actor, 'User');
  const restoreNote = note?.trim() || 'Work item restored from archive.';
  const shouldClaim = Boolean(actor?.userId);

  if (shouldClaim && actor?.userId) {
    await upsertWorkItemClaim({
      capabilityId,
      workItemId,
      userId: actor.userId,
      teamId: actor.teamIds?.[0],
      status: 'ACTIVE',
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  }

  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    taskType: normalizedTaskType,
    phase: firstStep.phase,
    phaseOwnerTeamId,
    claimOwnerUserId: shouldClaim ? actor?.userId : undefined,
    watchedByUserIds: shouldClaim && actor?.userId ? [actor.userId] : [],
    workflowId: projection.workItem.workflowId,
    currentStepId: firstStep.id,
    assignedAgentId: firstStep.agentId,
    status: getStepStatus(firstStep),
    pendingRequest: undefined,
    blocker: undefined,
    pendingHandoff: undefined,
    activeRunId: undefined,
    lastRunId: undefined,
    recordVersion: (projection.workItem.recordVersion || 1) + 1,
    history: [
      createHistoryEntry(
        actorName,
        'Work item restored',
        restoreNote,
        firstStep.phase,
        getStepStatus(firstStep),
      ),
      ...(shouldClaim
        ? [
            createHistoryEntry(
              actorName,
              'Operator control claimed',
              `${actorName} reclaimed operator control while restoring the work item.`,
              firstStep.phase,
              getStepStatus(firstStep),
            ),
          ]
        : []),
    ],
  };

  await persistProjection({
    capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow,
    logsToAppend: [
      createExecutionLog({
        capabilityId,
        taskId: workItemId,
        agentId: firstStep.agentId,
        message: restoreNote,
        level: 'INFO',
      }),
    ],
  });
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);

  return nextWorkItem;
};

export const restartWorkflowRun = async ({
  capabilityId,
  runId,
  restartFromPhase,
  guidance,
  guidedBy,
  actor,
}: {
  capabilityId: string;
  runId: string;
  restartFromPhase?: WorkItemPhase;
  guidance?: string;
  guidedBy?: string;
  actor?: ActorContext;
}) => {
  const latest = await getWorkflowRunDetail(capabilityId, runId);
  return startWorkflowExecution({
    capabilityId,
    workItemId: latest.run.workItemId,
    restartFromPhase:
      restartFromPhase || latest.run.restartFromPhase || latest.run.currentPhase,
    guidance,
    guidedBy,
    actor,
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
  const waitRunStatus = await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id);
  if (waitRunStatus === 'CANCELLED' || waitRunStatus === 'PAUSED') {
    return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
  }

  const currentRunStep = runStepOverride || getCurrentRunStep(detail);
  const currentStep = getCurrentWorkflowStep(detail);
  const projection = await resolveProjectionContext(
    detail.run.capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
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
    approvalPolicyId: currentStep.approvalPolicy?.id,
    payload: {
      stepName: currentRunStep.name,
      ...(waitPayload || {}),
      contrarianReview:
        waitType === 'CONFLICT_RESOLUTION' && contrarianReviewer
          ? createPendingContrarianReview(contrarianReviewer.id)
          : undefined,
    },
  });
  if (waitType === 'APPROVAL') {
    const assignments = buildApprovalAssignmentsForWait({
      capability: projection.capability,
      workItem: projection.workItem,
      step: currentStep,
      runId: detail.run.id,
      waitId: wait.id,
      waitMessage,
    });
    if (assignments.length > 0) {
      wait.approvalAssignments = await createApprovalAssignments(assignments);
    }
  }
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
  if (
    ['CANCELLED', 'PAUSED'].includes(
      await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
    )
  ) {
    return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
  }

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
  const inspectedPaths = new Set<string>();
  const attemptedTools: ToolAdapterId[] = [];
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
  const operatorGuidanceContext = buildOperatorGuidanceContext({
    workItem: projection.workItem,
    artifacts: projection.workspace.artifacts,
  });
  const stepTouchedPaths = new Set<string>();
  const compiledStepContext = compileStepContext({
    capability: projection.capability,
    workItem: projection.workItem,
    workflow: detail.run.workflowSnapshot,
    step,
    agent,
    handoffContext,
    resolvedWaitContext,
    artifacts: projection.workspace.artifacts,
  });
  const compiledWorkItemPlan = compileWorkItemPlan({
    capability: projection.capability,
    workItem: projection.workItem,
    workflow: detail.run.workflowSnapshot,
    currentStep: step,
    currentStepContext: compiledStepContext,
  });
  const executionPlanArtifact = buildExecutionPlanArtifact({
    detail: runningDetail,
    step,
    runStep: currentRunStep,
    plan: compiledWorkItemPlan,
  });

  currentRunStep = await updateWorkflowRunStep({
    ...currentRunStep,
    metadata: {
      ...(currentRunStep.metadata || {}),
      compiledStepContext,
      compiledWorkItemPlan,
      executionPlanArtifactId: executionPlanArtifact.id,
    },
  });

  await replaceCapabilityWorkspaceContentRecord(detail.run.capabilityId, {
    artifacts: replaceArtifacts(projection.workspace.artifacts, [executionPlanArtifact]),
  });
  await emitRunProgressEvent({
    capabilityId: detail.run.capabilityId,
    runId: detail.run.id,
    workItemId: detail.run.workItemId,
    runStepId: currentRunStep.id,
    traceId,
    spanId: stepSpan.id,
    message: `${step.name} compiled a bounded execution plan for this step.`,
    details: {
      stage: 'STEP_CONTRACT_COMPILED',
      stepName: step.name,
      missingInputs: compiledStepContext.missingInputs.length,
      allowedToolCount: compiledStepContext.executionBoundary.allowedToolIds.length,
    },
  });

  if (compiledStepContext.missingInputs.length > 0) {
    if (
      ['CANCELLED', 'PAUSED'].includes(
        await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
      )
    ) {
      return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
    }

    await finishTelemetrySpan({
      capabilityId: detail.run.capabilityId,
      spanId: stepSpan.id,
      status: 'WAITING',
      attributes: {
        waitType: 'INPUT',
        missingInputs: compiledStepContext.missingInputs
          .map(input => input.label)
          .join(', '),
      },
    });
    return completeRunWithWait({
      detail: runningDetail,
      waitType: 'INPUT',
      waitMessage: buildStructuredInputWaitMessage(
        step,
        compiledStepContext.missingInputs,
      ),
      waitPayload: {
        requestedInputFields: compiledStepContext.missingInputs,
        compiledStepContext,
        compiledWorkItemPlan,
      },
      artifacts: [executionPlanArtifact],
      runStepOverride: currentRunStep,
    });
  }

  for (let iteration = 0; iteration < MAX_AGENT_TOOL_LOOPS; iteration += 1) {
    if (
      ['CANCELLED', 'PAUSED'].includes(
        await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
      )
    ) {
      return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
    }

    const decisionEnvelope = await requestStepDecision({
      capability: projection.capability,
      workItem: projection.workItem,
      workflow: detail.run.workflowSnapshot,
      step,
      runStep: currentRunStep,
      agent,
      workspace: projection.workspace,
      artifacts: projection.workspace.artifacts,
      compiledStepContext,
      compiledWorkItemPlan,
      toolHistory,
      operatorGuidanceContext,
    });
    const decision = decisionEnvelope.decision;

    if (
      ['CANCELLED', 'PAUSED'].includes(
        await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
      )
    ) {
      return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
    }

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
    const recoverableDecisionFeedback = getRecoverableDecisionFeedback(decision);
    if (recoverableDecisionFeedback) {
      toolHistory.push({
        role: 'assistant',
        content: JSON.stringify(decision),
      });
      toolHistory.push({
        role: 'user',
        content: recoverableDecisionFeedback,
      });
      currentRunStep = await updateWorkflowRunStep({
        ...currentRunStep,
        metadata: {
          ...(currentRunStep.metadata || {}),
          lastToolSummary: recoverableDecisionFeedback,
        },
      });
      await emitRunProgressEvent({
        capabilityId: detail.run.capabilityId,
        runId: detail.run.id,
        workItemId: detail.run.workItemId,
        runStepId: currentRunStep.id,
        traceId,
        spanId: stepSpan.id,
        level: 'WARN',
        message: recoverableDecisionFeedback,
        details: {
          stage: 'DECISION_REPAIRED',
          stepName: step.name,
          iteration: iteration + 1,
        },
      });
      continue;
    }

    if (decision.action === 'invoke_tool') {
    if (
      ['CANCELLED', 'PAUSED'].includes(
        await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
      )
    ) {
      return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
    }

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
        if (
          ['CANCELLED', 'PAUSED'].includes(
            await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
          )
        ) {
          return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
        }

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
          waitPayload: {
            compiledStepContext,
            compiledWorkItemPlan,
          },
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
        attemptedTools.push(decision.toolCall.toolId);
        const result = await executeTool({
          capability: projection.capability,
          agent,
          workItem: projection.workItem,
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
        if (typeof decision.toolCall.args?.path === 'string' && decision.toolCall.args.path.trim()) {
          inspectedPaths.add(decision.toolCall.args.path.trim());
        }
        continue;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Tool execution failed unexpectedly.';
        const recoverableToolError = classifyToolExecutionError({
          toolId: decision.toolCall.toolId,
          message,
        });
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
        if (recoverableToolError?.recoverable) {
          toolHistory.push({
            role: 'assistant',
            content: JSON.stringify(decision),
          });
          toolHistory.push({
            role: 'user',
            content: recoverableToolError.feedback,
          });
          currentRunStep = await updateWorkflowRunStep({
            ...currentRunStep,
            lastToolInvocationId: toolInvocation.id,
            metadata: {
              ...(currentRunStep.metadata || {}),
              lastToolSummary: recoverableToolError.feedback,
            },
          });
          continue;
        }
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
        if (
          ['CANCELLED', 'PAUSED'].includes(
            await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
          )
        ) {
          return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
        }

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
            compiledStepContext,
            compiledWorkItemPlan,
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
            workItem: projection.workItem,
            lifecycle: projection.capability.lifecycle,
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

      if (
        ['CANCELLED', 'PAUSED'].includes(
          await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
        )
      ) {
        return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
      }

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
        waitPayload:
          waitType === 'INPUT'
            ? {
                requestedInputFields:
                  compiledStepContext.missingInputs.length > 0
                    ? compiledStepContext.missingInputs
                    : [
                        {
                          id: 'operator-input',
                          label: 'Operator input',
                          description: decision.wait.message,
                          required: true,
                          source: 'HUMAN_INPUT',
                          kind: 'MARKDOWN',
                          status: 'MISSING',
                        },
                      ],
                compiledStepContext,
                compiledWorkItemPlan,
              }
            : {
                compiledStepContext,
                compiledWorkItemPlan,
              },
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

  if (
    ['CANCELLED', 'PAUSED'].includes(
      await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
    )
  ) {
    return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
  }

  await finishTelemetrySpan({
    capabilityId: detail.run.capabilityId,
    spanId: stepSpan.id,
    status: 'WAITING',
    attributes: {
      waitType: 'INPUT',
      error: `${step.name} exceeded the maximum tool loop iterations.`,
    },
  });
  return completeRunWithWait({
    detail: runningDetail,
    waitType: 'INPUT',
    waitMessage: buildToolLoopExhaustedWaitMessage({
      step,
      inspectedPaths: Array.from(inspectedPaths).slice(-5),
      attemptedTools: Array.from(new Set(attemptedTools)).slice(-5),
    }),
    waitPayload: {
      requestedInputFields: [
        {
          id: 'implementation-direction',
          label: 'Implementation direction',
          description:
            'Tell the agent exactly which files to edit or what concrete change to make next.',
          required: true,
          source: 'HUMAN_INPUT',
          kind: 'MARKDOWN',
          status: 'MISSING',
        } satisfies CompiledRequiredInputField,
      ],
      compiledStepContext,
      compiledWorkItemPlan,
      attemptedTools: Array.from(new Set(attemptedTools)),
      inspectedPaths: Array.from(inspectedPaths),
    },
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
    const latestStatus = await getWorkflowRunStatus(
      currentDetail.run.capabilityId,
      currentDetail.run.id,
    );
    if (latestStatus === 'CANCELLED' || latestStatus === 'PAUSED') {
      return getWorkflowRunDetail(currentDetail.run.capabilityId, currentDetail.run.id);
    }

    const currentStep = getCurrentWorkflowStep(currentDetail);
    if (currentStep.stepType === 'HUMAN_APPROVAL') {
      const projection = await resolveProjectionContext(
        currentDetail.run.capabilityId,
        currentDetail.run.workItemId,
        currentDetail.run.workflowSnapshot,
      );
      const currentRunStep = getCurrentRunStep(currentDetail);
      const handoffContext = buildWorkflowHandoffContext({
        detail: currentDetail,
        workItem: projection.workItem,
        artifacts: projection.workspace.artifacts,
      });
      const resolvedWaitContext = buildResolvedWaitContext({
        detail: currentDetail,
        runStep: currentRunStep,
      });
      const compiledStepContext = compileStepContext({
        capability: projection.capability,
        workItem: projection.workItem,
        workflow: currentDetail.run.workflowSnapshot,
        step: currentStep,
        agent:
          projection.workspace.agents.find(agent => agent.id === currentStep.agentId) || null,
        handoffContext,
        resolvedWaitContext,
        artifacts: projection.workspace.artifacts,
      });
      const compiledWorkItemPlan = compileWorkItemPlan({
        capability: projection.capability,
        workItem: projection.workItem,
        workflow: currentDetail.run.workflowSnapshot,
        currentStep,
        currentStepContext: compiledStepContext,
      });
      const executionPlanArtifact = buildExecutionPlanArtifact({
        detail: currentDetail,
        step: currentStep,
        runStep: currentRunStep,
        plan: compiledWorkItemPlan,
      });

      await updateWorkflowRunStep({
        ...currentRunStep,
        metadata: {
          ...(currentRunStep.metadata || {}),
          compiledStepContext,
          compiledWorkItemPlan,
          executionPlanArtifactId: executionPlanArtifact.id,
        },
      });
      await replaceCapabilityWorkspaceContentRecord(currentDetail.run.capabilityId, {
        artifacts: replaceArtifacts(projection.workspace.artifacts, [
          executionPlanArtifact,
        ]),
      });

      return completeRunWithWait({
        detail: currentDetail,
        waitType: 'APPROVAL',
        waitMessage:
          currentStep.approverRoles?.length
            ? `${currentStep.name} is waiting for ${currentStep.approverRoles.join(', ')} approval.`
            : `${currentStep.name} is waiting for human approval.`,
        waitPayload: {
          compiledStepContext,
          compiledWorkItemPlan,
        },
        artifacts: [executionPlanArtifact],
        runStepOverride: currentRunStep,
      });
    }

    currentDetail = await executeAutomatedStep(currentDetail);
    if (
      currentDetail.run.status === 'COMPLETED' ||
      currentDetail.run.status === 'FAILED' ||
      currentDetail.run.status === 'WAITING_APPROVAL' ||
      currentDetail.run.status === 'WAITING_INPUT' ||
      currentDetail.run.status === 'WAITING_CONFLICT' ||
      currentDetail.run.status === 'PAUSED' ||
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
