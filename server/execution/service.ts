import type { PoolClient } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ActorContext,
  ApprovalAssignment,
  ApprovalDecision,
  ApprovalPolicy,
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
  WorkflowRunQueueReason,
  WorkflowRunBranchState,
  WorkflowRunDetail,
  WorkflowRunStep,
  WorkItem,
  WorkItemAttachmentUpload,
  WorkItemBlocker,
  WorkItemHistoryEntry,
  WorkItemPhase,
  WorkItemPendingRequest,
  WorkItemStageOverride,
  WorkItemStageOverrideStatus,
  WorkItemStatus,
  WorkflowStep,
} from "../../src/types";
import { syncWorkflowManagedTasksForWorkItem } from "../../src/lib/workflowTaskAutomation";
import {
  compileStepContext,
  compileWorkItemPlan,
} from "../../src/lib/workflowRuntime";
import {
  buildCapabilityBriefing,
  buildCapabilityBriefingPrompt,
} from "../../src/lib/capabilityBriefing";
import { hasGitHubCapabilityRepository } from "../../src/lib/githubRepositories";
import {
  auditOutputContractSections,
  buildOutputContractInstruction,
} from "../../src/lib/outputContract";
import {
  buildAgentKnowledgeLens,
  buildAgentKnowledgePrompt,
} from "../../src/lib/agentKnowledge";
import {
  compileStepOwnership,
  resolveWorkItemPhaseOwnerTeamId,
} from "../../src/lib/capabilityOwnership";
import {
  getCapabilityBoardPhaseIds,
  getLifecyclePhaseLabel,
} from "../../src/lib/capabilityLifecycle";
import { isTestingWorkflowStep } from "../../src/lib/workflowStepSemantics";
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
} from "../../src/lib/workflowGraph";
import { dispatchAlert } from "../lib/notificationDispatcher";
import {
  getWorkItemTaskTypeLabel,
  normalizeWorkItemTaskType,
  resolveWorkItemEntryStep,
} from "../../src/lib/workItemTaskTypes";
import {
  buildWorkItemPhaseSignatureMarkdown,
  normalizeWorkItemPhaseStakeholders,
} from "../../src/lib/workItemStakeholders";
import { invokeScopedCapabilitySession } from "../githubModels";
import { normalizeToolAdapterId } from "../toolIds";
import { publishRunEvent } from "../eventBus";
import { DEFAULT_PROVIDER_KEY, resolveAgentProviderKey } from "../providerRegistry";
import { rollupToolHistory, type RollupCacheEntry } from "./historyRollup";
import {
  buildExecutionLlmContinuitySections,
  buildRecentWorkItemConversationText,
} from "./llmContextEnvelope";
import { resolveModelForTurn } from "./modelRouter";
import { prepareWorkItemExecutionWorkspace } from "./startPreparation";
import {
  buildExecutionRuntimeAgent,
  resolveExecutionRuntimeForStep,
} from "./runtimeSelection";
import {
  buildBudgetedPrompt,
  resolvePhaseBudget,
  type BudgetFragment,
  type ContextSource,
} from "./contextBudget";
import { estimateTokens, normalizeProviderForEstimate } from "./tokenEstimate";
import { persistPromptReceipt } from "./promptReceipts";
import {
  getDisabledTokenStrategies,
  getEnabledTokenStrategies,
  recommendModelForTurn,
  resolveTokenManagementPolicy,
} from "../tokenManagement";
import {
  queueExperienceDistillationRefresh,
  queueSingleAgentLearningRefresh,
} from "../agentLearning/service";
import { wakeAgentLearningWorker } from "../agentLearning/worker";
import { buildMemoryContext, refreshCapabilityMemory } from "../memory";
import {
  forceWorkItemAstRefresh,
  queueWorkItemAstRefresh,
} from "../workItemAst";
import { evaluateToolPolicy } from "../policy";
import { transaction, query as dbQuery } from "../db";
import {
  createApprovalAssignments,
  createApprovalDecision,
  updateSingleApprovalAssignment,
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
} from "./repository";
import {
  createSegment,
  getSegmentById,
  getSegmentForRun,
  listSegmentsForWorkItem,
  markSegmentComplete,
  mirrorRunStatusToSegment,
  propagatePriorityChange,
} from "./segments";
import {
  classifyToolExecutionError,
  executeTool,
  listToolDescriptions,
  type ToolExecutionResult,
} from "./tools";
import { captureCodeDiffReviewArtifact } from "./codeDiff";
import {
  createWorkItemHandoffPacketRecord,
  releaseWorkItemCodeClaimRecord,
} from "../domains/tool-plane";
import {
  getCapabilityBundle,
  replaceCapabilityWorkspaceContentRecord,
} from "../domains/self-service";
import {
  createTraceId,
  finishTelemetrySpan,
  recordUsageMetrics,
  startTelemetrySpan,
} from "../telemetry";
import { getCapabilityWorkspaceRoots } from "../workspacePaths";
import {
  buildWorkspaceProfilePromptLines,
  detectWorkspaceProfile,
} from "../workspaceProfile";
import {
  resolveQueuedRunDispatch,
  getDesktopExecutorRegistration,
} from "../executionOwnership";
import { isRemoteExecutionClient } from "./runtimeClient";
import {
  loadExecutionSessionMemoryPrompt,
  persistExecutionSessionMemory,
} from "./sessionMemory";

/**
 * Try to load a step policy/template document from `step.templatePath`.
 * Paths starting with "/" are resolved relative to the project root
 * (i.e. cwd at server start). Returns undefined silently if the file
 * is absent or unreadable — missing templates should never block execution.
 */
const loadStepPolicyDocument = async (
  templatePath: string | undefined,
): Promise<string | undefined> => {
  if (!templatePath) return undefined;
  try {
    const resolved = templatePath.startsWith("/")
      ? path.join(process.cwd(), templatePath)
      : path.resolve(templatePath);
    const content = await readFile(resolved, "utf-8");
    return content.trim() || undefined;
  } catch {
    // File not found or unreadable — non-fatal; log nothing to avoid noise
    return undefined;
  }
};

const MAX_AGENT_TOOL_LOOPS = 8;
const TOOL_LOOP_EXHAUSTION_WAIT_REASON = "TOOL_LOOP_EXHAUSTED";
const MAX_RESOLVED_TOOL_LOOP_EXHAUSTION_WAITS = 2;

const createHistoryId = () =>
  `HIST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createLogId = () =>
  `LOG-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createArtifactId = () =>
  `ART-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const ACTIVE_WORKFLOW_RUN_STATUSES = new Set<WorkflowRun["status"]>([
  "QUEUED",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_HUMAN_TASK",
  "WAITING_INPUT",
  "WAITING_CONFLICT",
]);

const normalizeHumanChecklist = (checklist?: string[]) =>
  Array.isArray(checklist)
    ? checklist
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : [];

const getWorkItemStageOverride = (
  workItem: WorkItem,
  workflowStepId?: string,
) =>
  (workItem.stageOverrides || []).find(
    (override) => override.workflowStepId === workflowStepId,
  );

const replaceWorkItemStageOverride = (
  workItem: WorkItem,
  nextOverride: WorkItemStageOverride,
) => ({
  ...workItem,
  stageOverrides: [
    ...(workItem.stageOverrides || []).filter(
      (override) => override.workflowStepId !== nextOverride.workflowStepId,
    ),
    nextOverride,
  ],
});

const updateWorkItemStageOverrideStatus = ({
  workItem,
  workflowStepId,
  status,
  completedBy,
  completedAt,
  completionSummary,
}: {
  workItem: WorkItem;
  workflowStepId: string;
  status: WorkItemStageOverrideStatus;
  completedBy?: string;
  completedAt?: string;
  completionSummary?: string;
}) => {
  const currentOverride = getWorkItemStageOverride(workItem, workflowStepId);
  if (!currentOverride || currentOverride.ownerType !== "HUMAN") {
    return workItem;
  }

  return replaceWorkItemStageOverride(workItem, {
    ...currentOverride,
    status,
    completedBy:
      completedBy !== undefined ? completedBy : currentOverride.completedBy,
    completedAt:
      completedAt !== undefined ? completedAt : currentOverride.completedAt,
    completionSummary:
      completionSummary !== undefined
        ? completionSummary
        : currentOverride.completionSummary,
  });
};
const createLearningUpdateId = () =>
  `LEARN-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createApprovalAssignmentId = () =>
  `APPROVAL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const createApprovalDecisionId = () =>
  `APPDEC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

type ExecutionDecision =
  | {
      action: "invoke_tool";
      reasoning: string;
      summary?: string;
      toolCall: {
        toolId: ToolAdapterId;
        args: Record<string, any>;
      };
    }
  | {
      action: "complete";
      reasoning: string;
      summary: string;
    }
  | {
      action: "pause_for_input" | "pause_for_approval" | "pause_for_conflict";
      reasoning: string;
      summary?: string;
      wait: {
        type: RunWaitType;
        message: string;
      };
    }
  | {
      action: "fail";
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

const mapBundleWorkspace = (
  bundle: Awaited<ReturnType<typeof getCapabilityBundle>>,
) => bundle.workspace;

const formatTaskTimestamp = () =>
  new Date().toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const summarizeOutput = (value?: unknown) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);

const compactMarkdownSummary = (value?: unknown) =>
  summarizeOutput(
    String(value || "")
      .replace(/```[\s\S]*?```/g, (match) =>
        match
          .replace(/^```[\w-]*\n?/, "")
          .replace(/```$/, "")
          .trim(),
      )
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/^\s*[-*]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/\|/g, " ")
      .replace(/^-{3,}$/gm, "")
      .replace(/\s+/g, " ")
      .trim(),
  );

const formatToolLabel = (toolId: ToolAdapterId) =>
  String(toolId || "tool")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const buildDecisionProgressMessage = (decision: ExecutionDecision) => {
  if (decision.action === "invoke_tool") {
    return `Prepared ${formatToolLabel(decision.toolCall.toolId)} for the next execution move.`;
  }

  if (decision.action === "complete") {
    return "Prepared a completion update for this workflow step.";
  }

  if (decision.action === "pause_for_input") {
    return "Prepared a human input request for this workflow step.";
  }

  if (decision.action === "pause_for_approval") {
    return "Prepared an approval request for this workflow step.";
  }

  if (decision.action === "pause_for_conflict") {
    return "Prepared a conflict-resolution wait for adversarial review.";
  }

  return "Prepared a failure outcome for this workflow step.";
};

const normalizeDecisionSummary = (
  action: ExecutionDecision["action"],
  summary: unknown,
) => {
  const normalized = normalizeString(summary);
  if (normalized) {
    return normalized;
  }

  switch (action) {
    case "invoke_tool":
      return "Prepared the next tool action for this workflow step.";
    case "complete":
      return "Completed the current workflow step.";
    case "pause_for_input":
      return "Paused the step for structured operator input.";
    case "pause_for_approval":
      return "Paused the step for human approval.";
    case "pause_for_conflict":
      return "Paused the step for conflict resolution.";
    case "fail":
      return "Failed the current workflow step.";
    default:
      return "Updated the workflow step state.";
  }
};

export const normalizeExecutionDecision = (
  value: Record<string, any>,
): ExecutionDecision => {
  const action = normalizeString(value.action);
  const reasoning =
    normalizeString(value.reasoning) ||
    "No reasoning was returned by the execution model.";

  if (action === "invoke_tool") {
    const toolId = normalizeToolAdapterId(value.toolCall?.toolId);
    if (!toolId) {
      return {
        action: "fail",
        reasoning,
        summary:
          "Execution model requested a tool action without specifying a valid tool id.",
      };
    }

    return {
      action,
      reasoning,
      summary: normalizeDecisionSummary(action, value.summary),
      toolCall: {
        toolId,
        args:
          value.toolCall?.args && typeof value.toolCall.args === "object"
            ? value.toolCall.args
            : {},
      },
    };
  }

  if (action === "complete" || action === "fail") {
    return {
      action,
      reasoning,
      summary: normalizeDecisionSummary(action, value.summary),
    };
  }

  if (
    action === "pause_for_input" ||
    action === "pause_for_approval" ||
    action === "pause_for_conflict"
  ) {
    return {
      action,
      reasoning,
      summary: normalizeDecisionSummary(action, value.summary),
      wait: {
        type: value.wait?.type,
        message:
          normalizeString(value.wait?.message) ||
          "The workflow is waiting for operator action.",
      },
    };
  }

  return {
    action: "fail",
    reasoning,
    summary: normalizeDecisionSummary("fail", value.summary || value.action),
  };
};

export const getExecutionDecisionRepairReason = (
  value: Record<string, any>,
) => {
  const action = normalizeString(value.action);

  if (action === "invoke_tool" && !normalizeString(value.toolCall?.toolId)) {
    return "Tool action was missing toolCall.toolId.";
  }

  if (
    (action === "pause_for_input" ||
      action === "pause_for_approval" ||
      action === "pause_for_conflict") &&
    !normalizeString(value.wait?.type)
  ) {
    return "Wait action was missing wait.type.";
  }

  return null;
};

export const getRecoverableDecisionFeedback = (decision: ExecutionDecision) => {
  if (
    decision.action === "fail" &&
    decision.summary ===
      "Execution model requested a tool action without specifying a valid tool id."
  ) {
    return "The previous response attempted a tool call without toolCall.toolId. Choose exactly one tool from the allowed list and return a complete invoke_tool decision with valid args.";
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
    ? attemptedTools.map(formatToolLabel).join(", ")
    : "No tools were executed";
  const inspectedSummary = inspectedPaths.length
    ? inspectedPaths.join(", ")
    : "No specific files were inspected";

  return `${step.name} explored the workspace for too long without moving into a concrete implementation result. It already used: ${attemptedSummary}. Recent files or paths inspected: ${inspectedSummary}. Provide direct implementation guidance such as the exact files to edit, the change to make, or confirmation that it should start writing code now.`;
};

const buildEscalatedToolLoopWaitMessage = ({
  step,
  inspectedPaths,
  attemptedTools,
}: {
  step: WorkflowStep;
  inspectedPaths: string[];
  attemptedTools: ToolAdapterId[];
}) => {
  const attemptedSummary = attemptedTools.length
    ? attemptedTools.map(formatToolLabel).join(", ")
    : "No tools were executed";
  const inspectedSummary = inspectedPaths.length
    ? inspectedPaths.join(", ")
    : "No specific files were inspected";

  return `${step.name} exhausted its tool loop again after prior operator guidance. It already used: ${attemptedSummary}. Recent files or paths inspected: ${inspectedSummary}. Do not answer with a general instruction. Specify the exact files to edit, the exact code change to make, and any build or test command the agent should run next.`;
};

export const buildRepeatedToolLoopFailureMessage = ({
  step,
  inspectedPaths,
  attemptedTools,
}: {
  step: WorkflowStep;
  inspectedPaths: string[];
  attemptedTools: ToolAdapterId[];
}) => {
  const attemptedSummary = attemptedTools.length
    ? attemptedTools.map(formatToolLabel).join(", ")
    : "No tools were executed";
  const inspectedSummary = inspectedPaths.length
    ? inspectedPaths.join(", ")
    : "No specific files were inspected";

  return `${step.name} exhausted its tool loop repeatedly even after human guidance. It already used: ${attemptedSummary}. Recent files or paths inspected: ${inspectedSummary}. Stop retrying this step until the operator supplies an exact implementation plan with target files and any required build/test command.`;
};

const buildToolLoopRequestedInputFields = ({
  escalated,
}: {
  escalated: boolean;
}): CompiledRequiredInputField[] => [
  {
    id: "implementation-direction",
    label: "Implementation direction",
    description: escalated
      ? 'State the exact code change to make next. Generic replies like "go ahead" are not enough.'
      : "Tell the agent exactly what change it should make next.",
    required: true,
    source: "HUMAN_INPUT",
    kind: "MARKDOWN",
    status: "MISSING",
  },
  {
    id: "target-files",
    label: "Target files",
    description:
      "List the exact files to edit or create, for example src/main/java/.../Operator.java.",
    required: escalated,
    source: "HUMAN_INPUT",
    kind: "MARKDOWN",
    status: "MISSING",
  },
  {
    id: "build-test-command",
    label: "Build/test command",
    description:
      "If validation matters here, give the exact command to run, for example mvn test from the repo root.",
    required: false,
    source: "HUMAN_INPUT",
    kind: "MARKDOWN",
    status: "MISSING",
  },
];

const isToolLoopExhaustionWait = (
  wait: Pick<RunWait, "type" | "message" | "payload">,
) =>
  wait.type === "INPUT" &&
  (wait.payload?.reason === TOOL_LOOP_EXHAUSTION_WAIT_REASON ||
    wait.message.includes(
      "explored the workspace for too long without moving into a concrete implementation result.",
    ));

const countResolvedToolLoopExhaustionWaits = ({
  detail,
  runStepId,
}: {
  detail: WorkflowRunDetail;
  runStepId: string;
}) =>
  detail.waits.filter(
    (wait) =>
      wait.runStepId === runStepId &&
      wait.status === "RESOLVED" &&
      isToolLoopExhaustionWait(wait),
  ).length;

export const hasConcreteImplementationGuidance = (value: string) => {
  const normalized = normalizeString(value);
  if (!normalized || normalized.length < 24) {
    return false;
  }

  const lower = normalized.toLowerCase();
  const hasPathHint =
    /(?:^|[\s(])(?:\/|\.\/|\.\.\/)[^\s,;]+/.test(normalized) ||
    /\b[\w./-]+\.(java|kt|kts|ts|tsx|js|jsx|py|rb|php|cs|cpp|c|h|hpp|sql|json|ya?ml|md|go)\b/i.test(
      normalized,
    );
  const hasActionVerb =
    /\b(edit|update|change|modify|create|add|implement|write|patch|replace|rename|extend|test)\b/i.test(
      lower,
    );
  const hasCommandHint =
    /\b(mvn|gradle|npm|pnpm|yarn|bun|go test|pytest|jest|vitest|cargo test|dotnet test|make)\b/i.test(
      lower,
    );

  return (hasPathHint && hasActionVerb) || (hasActionVerb && hasCommandHint);
};

const emitRunProgressEvent = async ({
  capabilityId,
  runId,
  workItemId,
  runStepId,
  toolInvocationId,
  traceId,
  spanId,
  type = "STEP_PROGRESS",
  level = "INFO",
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
  level?: RunEvent["level"];
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
    console.warn("Failed to emit workflow progress event.", error);
  }
};

const buildExecutionPreparationErrorMessage = (error: unknown) => {
  const baseMessage =
    error instanceof Error
      ? error.message
      : "Execution preparation failed unexpectedly.";

  if (/Choose an operator before using desktop workspaces/i.test(baseMessage)) {
    return `${baseMessage} Select the active workspace operator, then retry the run.`;
  }
  if (/could not be initialized/i.test(baseMessage)) {
    return `${baseMessage} Verify the repository URL and desktop working directory, then retry.`;
  }
  if (/desktop workspace/i.test(baseMessage) || /working directory/i.test(baseMessage)) {
    return `${baseMessage} Fix the desktop workspace mapping in Operations before restarting this run.`;
  }
  return baseMessage;
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
  level = "INFO",
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
  level?: ExecutionLog["level"];
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
  fallback = "Capability Owner",
) => normalizeString(actor?.displayName) || fallback;

const getActorTeamIds = (actor?: ActorContext | null) =>
  Array.from(
    new Set(
      (actor?.teamIds || [])
        .map((teamId) => normalizeString(teamId))
        .filter(Boolean),
    ),
  );

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

  if (
    actor?.userId &&
    workItem.claimOwnerUserId &&
    actor.userId === workItem.claimOwnerUserId
  ) {
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
    (assignment) => assignment.status === "PENDING",
  );

  if (pendingAssignments.length === 0) {
    const ownershipTeams =
      wait.payload?.compiledStepContext?.ownership?.approvalTeamIds || [];
    return Boolean(
      actorTeamIds.some((teamId) => ownershipTeams.includes(teamId)) ||
      (workItem.phaseOwnerTeamId &&
        actorTeamIds.includes(workItem.phaseOwnerTeamId)),
    );
  }

  const hasOnlyImplicitTeamAssignments = pendingAssignments.every(
    (assignment) =>
      assignment.targetType === "TEAM" && !assignment.approvalPolicyId,
  );
  if (
    hasOnlyImplicitTeamAssignments &&
    actor?.userId &&
    workItem.claimOwnerUserId &&
    actor.userId === workItem.claimOwnerUserId
  ) {
    return true;
  }

  return pendingAssignments.some((assignment) => {
    if (assignment.targetType === "USER") {
      return (
        Boolean(actor.userId) &&
        (assignment.assignedUserId || assignment.targetId) === actor.userId
      );
    }

    if (assignment.targetType === "TEAM") {
      const teamId = assignment.assignedTeamId || assignment.targetId;
      return actorTeamIds.includes(teamId);
    }

    return Boolean(actor.userId) || actorTeamIds.length > 0;
  });
};

export const __executionServiceTestUtils = {
  canActorApproveWait,
  buildQueuedRunForExternalAdvance,
  getRunStatusForWaitType: (waitType: "APPROVAL" | "HUMAN_TASK" | "INPUT" | "CONFLICT_RESOLUTION") =>
    getRunStatusForWaitType(waitType),
};

/**
 * Evaluate whether a completed approval decision satisfies the policy gate,
 * so we know whether to advance the workflow or hold it for more approvals.
 *
 * Returns { shouldAdvance, approvedCount, requiredCount } so callers can
 * build a meaningful "X of Y approvals received" progress message.
 *
 * Rules:
 *  ANY_ONE    — first APPROVE advances. (Default / legacy.)
 *  ALL_REQUIRED — every assignment target must approve.
 *  QUORUM     — at least policy.minimumApprovals (or ⌈n/2⌉) must approve.
 *  REQUEST_CHANGES on any disposition always blocks regardless of mode.
 */
const evaluateApprovalPolicy = ({
  policy,
  existingDecisions,
  thisDisposition,
  assignments,
}: {
  policy?: ApprovalPolicy | null;
  existingDecisions: ApprovalDecision[];
  thisDisposition: "APPROVE" | "REQUEST_CHANGES";
  assignments: ApprovalAssignment[];
}): { shouldAdvance: boolean; approvedCount: number; requiredCount: number } => {
  if (thisDisposition === "REQUEST_CHANGES") {
    return { shouldAdvance: false, approvedCount: 0, requiredCount: 1 };
  }

  // Count all prior APPROVE decisions + this one.
  const approvedCount =
    existingDecisions.filter((d) => d.disposition === "APPROVE").length + 1;

  const mode = policy?.mode ?? "ANY_ONE";

  switch (mode) {
    case "ANY_ONE":
      return { shouldAdvance: true, approvedCount, requiredCount: 1 };

    case "ALL_REQUIRED": {
      const requiredCount = Math.max(assignments.length, 1);
      return {
        shouldAdvance: approvedCount >= requiredCount,
        approvedCount,
        requiredCount,
      };
    }

    case "QUORUM": {
      const requiredCount =
        policy?.minimumApprovals != null && policy.minimumApprovals > 0
          ? policy.minimumApprovals
          : Math.max(Math.ceil(assignments.length / 2), 1);
      return {
        shouldAdvance: approvedCount >= requiredCount,
        approvedCount,
        requiredCount,
      };
    }

    default:
      return { shouldAdvance: approvedCount >= 1, approvedCount, requiredCount: 1 };
  }
};

const buildApprovalAssignmentsForWait = ({
  capability,
  workItem,
  step,
  runId,
  waitId,
  waitMessage,
  approvalPolicyOverride,
}: {
  capability: Capability;
  workItem: WorkItem;
  step: WorkflowStep;
  runId: string;
  waitId: string;
  waitMessage: string;
  approvalPolicyOverride?: ApprovalPolicy;
}) => {
  const ownership = compileStepOwnership({ capability, step });
  const policy = approvalPolicyOverride || step.approvalPolicy;
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
        ? step.approverRoles.map((role) => ({
            targetType: "CAPABILITY_ROLE" as const,
            targetId: role,
            label: role,
          }))
        : fallbackTeamIds.map((teamId) => ({
            targetType: "TEAM" as const,
            targetId: teamId,
            label: teamId,
          }));

  const dueAt =
    policy?.dueAt ||
    (policy?.escalationAfterMinutes
      ? new Date(
          Date.now() + policy.escalationAfterMinutes * 60_000,
        ).toISOString()
      : undefined);

  return targets.map((target) => ({
    id: createApprovalAssignmentId(),
    capabilityId: capability.id,
    runId,
    waitId,
    phase: step.phase,
    stepName: step.name,
    approvalPolicyId: policy?.id,
    status: "PENDING" as const,
    targetType: target.targetType,
    targetId: target.targetId,
    assignedUserId: target.targetType === "USER" ? target.targetId : undefined,
    assignedTeamId: target.targetType === "TEAM" ? target.targetId : undefined,
    dueAt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })) satisfies ApprovalAssignment[];
};

const toFileSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "artifact";

const buildMarkdownArtifact = (sections: Array<[string, string | undefined]>) =>
  sections
    .filter(([, value]) => Boolean(value))
    .map(([heading, value]) => `## ${heading}\n${value}`)
    .join("\n\n");

const summarizeText = (value: string, limit = 240) => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
};

const inferAttachmentContentFormat = (
  attachment: WorkItemAttachmentUpload,
): Artifact["contentFormat"] => {
  const lowerName = attachment.fileName.toLowerCase();
  const lowerMime = String(attachment.mimeType || "").toLowerCase();
  if (lowerName.endsWith(".md") || lowerMime.includes("markdown")) {
    return "MARKDOWN";
  }
  return "TEXT";
};

const formatMarkdownList = (items: string[]) =>
  items.length > 0
    ? items.map((item) => `- ${item}`).join("\n")
    : "None captured.";

const normalizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const normalizeStringArray = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }

  const normalized = normalizeString(value);
  return normalized ? [normalized] : [];
};

const normalizeContrarianSeverity = (
  value: unknown,
): ContrarianConflictReview["severity"] => {
  const normalized = normalizeString(value).toUpperCase();
  return normalized === "LOW" ||
    normalized === "MEDIUM" ||
    normalized === "HIGH" ||
    normalized === "CRITICAL"
    ? normalized
    : "MEDIUM";
};

const normalizeContrarianRecommendation = (
  value: unknown,
): ContrarianConflictReview["recommendation"] => {
  const normalized = normalizeString(value).toUpperCase().replace(/\s+/g, "_");
  return normalized === "CONTINUE" ||
    normalized === "REVISE_RESOLUTION" ||
    normalized === "ESCALATE" ||
    normalized === "STOP"
    ? normalized
    : "ESCALATE";
};

const findContrarianReviewerAgent = (agents: CapabilityAgent[]) =>
  agents.find(
    (agent) =>
      agent.role === "Contrarian Reviewer" ||
      agent.name === "Contrarian Reviewer" ||
      agent.id.includes("CONTRARIAN-REVIEWER"),
  ) ||
  agents.find((agent) => agent.isOwner) ||
  agents[0];

const createPendingContrarianReview = (
  reviewerAgentId: string,
): ContrarianConflictReview => ({
  status: "PENDING",
  reviewerAgentId,
  generatedAt: new Date().toISOString(),
  severity: "MEDIUM",
  recommendation: "ESCALATE",
  summary: "Contrarian review is being generated for this conflict wait.",
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
      : "Contrarian review could not be generated.";

  return {
    status: "ERROR",
    reviewerAgentId,
    generatedAt: new Date().toISOString(),
    severity: "MEDIUM",
    recommendation: "ESCALATE",
    summary:
      "Contrarian review was unavailable. The operator can still resolve this advisory wait manually.",
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
    ["Status", review.status],
    ["Severity", review.severity],
    ["Recommendation", review.recommendation.replace(/_/g, " ")],
    ["Summary", review.summary],
    [
      "Challenged Assumptions",
      formatMarkdownList(review.challengedAssumptions),
    ],
    ["Risks", formatMarkdownList(review.risks)],
    ["Missing Evidence", formatMarkdownList(review.missingEvidence)],
    ["Alternative Paths", formatMarkdownList(review.alternativePaths)],
    ["Suggested Resolution", review.suggestedResolution],
    ["Last Error", review.lastError],
  ]);

const getStepStatus = (step?: WorkflowStep): WorkItemStatus =>
  step?.stepType === "HUMAN_APPROVAL"
    ? "PENDING_APPROVAL"
    : step?.stepType === "HUMAN_TASK"
      ? "BLOCKED"
      : "ACTIVE";

const getPreExecutionStepStatus = (_step?: WorkflowStep): WorkItemStatus =>
  "STAGED";

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

  if (wait.type === "APPROVAL") {
    return undefined;
  }

  return {
    type:
      wait.type === "CONFLICT_RESOLUTION"
        ? "CONFLICT_RESOLUTION"
        : wait.type === "HUMAN_TASK"
          ? "HUMAN_TASK"
        : "HUMAN_INPUT",
    message: wait.message,
    requestedBy: step.agentId,
    timestamp: new Date().toISOString(),
    status: "OPEN",
  };
};

const replaceWorkItem = (items: WorkItem[], next: WorkItem) =>
  items.map((item) => (item.id === next.id ? next : item));

const replaceTask = (items: AgentTask[], next: AgentTask) => {
  const existingIndex = items.findIndex((task) => task.id === next.id);
  if (existingIndex === -1) {
    return [next, ...items];
  }

  return items.map((task, index) => (index === existingIndex ? next : task));
};

const replaceArtifact = (items: Artifact[], next: Artifact) => {
  const existingIndex = items.findIndex(
    (artifact) =>
      artifact.id === next.id ||
      (artifact.artifactKind === next.artifactKind &&
        (artifact.sourceWaitId || null) === (next.sourceWaitId || null) &&
        (artifact.runId || artifact.sourceRunId || null) ===
          (next.runId || next.sourceRunId || null) &&
        (artifact.runStepId || artifact.sourceRunStepId || null) ===
          (next.runStepId || next.sourceRunStepId || null)),
  );

  if (existingIndex === -1) {
    return [...items, next];
  }

  return items.map((artifact, index) =>
    index === existingIndex ? next : artifact,
  );
};

const replaceArtifacts = (items: Artifact[], nextArtifacts: Artifact[]) =>
  nextArtifacts.reduce(
    (current, artifact) => replaceArtifact(current, artifact),
    items,
  );

const executeDelegatedTask = async ({
  projection,
  detail,
  step,
  parentAgent,
  delegatedAgentId,
  title,
  prompt,
  toolInvocationId,
  traceId,
  promoteToHandoff,
  openQuestions,
  blockingDependencies,
  recommendedNextStep,
}: {
  projection: ProjectionContext;
  detail: WorkflowRunDetail;
  step: WorkflowStep;
  parentAgent: CapabilityAgent;
  delegatedAgentId: string;
  title: string;
  prompt: string;
  toolInvocationId: string;
  traceId?: string;
  promoteToHandoff?: boolean;
  openQuestions?: string[];
  blockingDependencies?: string[];
  recommendedNextStep?: string;
}): Promise<ToolExecutionResult & { retryable: boolean }> => {
  if (!delegatedAgentId.trim()) {
    throw new Error("delegate_task requires delegatedAgentId.");
  }
  if (!prompt.trim()) {
    throw new Error("delegate_task requires a non-empty prompt.");
  }
  const delegatedAgent =
    projection.workspace.agents.find(
      (candidate) => candidate.id === delegatedAgentId,
    ) || null;
  if (!delegatedAgent) {
    throw new Error(
      `Delegated agent ${delegatedAgentId} was not found in this capability.`,
    );
  }

  const childTaskId = `TASK-DELEGATE-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const childTask: AgentTask = {
    id: childTaskId,
    title:
      title.trim() ||
      `${projection.workItem.title} · Delegated Specialist Review`,
    agent: delegatedAgent.name,
    capabilityId: projection.capability.id,
    taskSubtype: "DELEGATED_RUN",
    workItemId: projection.workItem.id,
    workflowId: detail.run.workflowId,
    workflowStepId: step.id,
    managedByWorkflow: false,
    taskType: "DELIVERY",
    phase: step.phase,
    priority: projection.workItem.priority,
    status: "PROCESSING",
    timestamp: formatTaskTimestamp(),
    prompt,
    executionNotes: `Delegated by ${parentAgent.name} during ${step.name}.`,
    runId: detail.run.id,
    runStepId: detail.steps.find((item) => item.status === "RUNNING")?.id,
    parentRunId: detail.run.id,
    parentRunStepId: detail.steps.find((item) => item.status === "RUNNING")?.id,
    delegatedAgentId: delegatedAgent.id,
    toolInvocationId,
    linkedArtifacts: [],
    producedOutputs: [],
  };

  const queuedLog = createExecutionLog({
    capabilityId: projection.capability.id,
    taskId: childTask.id,
    agentId: delegatedAgent.id,
    message: `Delegated specialist task started: ${childTask.title}`,
    runId: detail.run.id,
    runStepId: childTask.runStepId,
    toolInvocationId,
    traceId,
    metadata: {
      parentAgentId: parentAgent.id,
      parentAgentName: parentAgent.name,
      delegatedAgentId: delegatedAgent.id,
      delegatedAgentName: delegatedAgent.name,
    },
  });

  projection.workspace.tasks = replaceTask(
    projection.workspace.tasks,
    childTask,
  );
  projection.workspace.executionLogs = [
    ...projection.workspace.executionLogs,
    queuedLog,
  ];
  await replaceCapabilityWorkspaceContentRecord(projection.capability.id, {
    tasks: projection.workspace.tasks,
    executionLogs: projection.workspace.executionLogs,
  });

  try {
    const memoryContext = await buildMemoryContext({
      capabilityId: projection.capability.id,
      agentId: delegatedAgent.id,
      queryText: [
        childTask.title,
        prompt,
        projection.workItem.title,
        projection.workItem.description,
        step.name,
        step.action,
      ]
        .filter(Boolean)
        .join("\n"),
      limit: 5,
    });
    const parentRunStep =
      detail.steps.find((item) => item.id === childTask.runStepId) ||
      detail.steps.find((item) => item.status === "RUNNING") ||
      null;
    const delegatedSessionMemoryPrompt = await loadExecutionSessionMemoryPrompt({
      capabilityId: projection.capability.id,
      agentId: delegatedAgent.id,
      scope: "TASK",
      scopeId: childTask.id,
    });
    const delegatedContinuity = buildExecutionLlmContinuitySections({
      mode: "delegated-subtask",
      workItem: projection.workItem,
      workflow: detail.run.workflowSnapshot,
      step,
      runStep: parentRunStep,
      recentConversationText: buildRecentWorkItemConversationText({
        messages: projection.workspace.messages,
        workItemId: projection.workItem.id,
        runId: detail.run.id,
      }),
      sessionMemoryPrompt: delegatedSessionMemoryPrompt,
      handoffContext: buildWorkflowHandoffContext({
        detail,
        workItem: projection.workItem,
        artifacts: projection.workspace.artifacts,
      }),
      resolvedWaitContext: parentRunStep
        ? buildResolvedWaitContext({
            detail,
            runStep: parentRunStep,
          })
        : undefined,
      operatorGuidanceContext: buildOperatorGuidanceContext({
        workItem: projection.workItem,
        artifacts: projection.workspace.artifacts,
      }),
    });

    const initialPrompt = [
      `You are handling a delegated specialist subtask inside capability ${projection.capability.name}.`,
      `Parent agent: ${parentAgent.name} (${parentAgent.role}).`,
      `Delegated specialist: ${delegatedAgent.name} (${delegatedAgent.role}).`,
      `Work item: ${projection.workItem.title} (${projection.workItem.id}).`,
      `Workflow step: ${step.name} (${step.phase}).`,
      `Task title: ${childTask.title}`,
      "",
      "Return concise markdown with these sections:",
      "1. Summary",
      "2. Findings",
      "3. Recommended next step",
      "4. Open questions",
      "",
      delegatedContinuity.envelopeText,
      "",
      `Delegated prompt:\n${prompt}`,
    ].join("\n");

    const delegatedRuntime = resolveExecutionRuntimeForStep({
      step,
      agent: delegatedAgent,
      hasGitHubCodeRepository: hasGitHubCapabilityRepository(
        projection.capability.repositories,
      ),
    });
    const delegatedRuntimeAgent = buildExecutionRuntimeAgent({
      agent: delegatedAgent,
      selection: delegatedRuntime,
    });

    const response = await invokeScopedCapabilitySession({
      capability: projection.capability,
      agent: delegatedRuntimeAgent,
      scope: "TASK",
      scopeId: childTask.id,
      prompt,
      initialPrompt,
      memoryPrompt: memoryContext.prompt,
      timeoutMs: 90_000,
      resetSession: true,
      modelOverride: delegatedRuntime.model || undefined,
    });
    await persistExecutionSessionMemory({
      capability: projection.capability,
      agent: delegatedRuntimeAgent,
      scope: "TASK",
      scopeId: childTask.id,
      sessionId: response.sessionId,
      prompt,
      assistantMessage: response.content,
      recentRepoCodeTarget: projection.workItem.title,
    });

    const artifact: Artifact = {
      id: createArtifactId(),
      name: `${delegatedAgent.name} Delegation Result`,
      capabilityId: projection.capability.id,
      type: "Delegation Result",
      version: `run-${detail.run.attemptNumber}`,
      agent: delegatedAgent.id,
      connectedAgentId: parentAgent.id,
      created: new Date().toISOString(),
      direction: "OUTPUT",
      sourceWorkflowId: detail.run.workflowId,
      runId: detail.run.id,
      runStepId: childTask.runStepId,
      summary: compactMarkdownSummary(response.content),
      artifactKind: "DELEGATION_RESULT",
      phase: step.phase,
      workItemId: projection.workItem.id,
      sourceRunId: detail.run.id,
      sourceRunStepId: childTask.runStepId,
      handoffFromAgentId: parentAgent.id,
      handoffToAgentId: delegatedAgent.id,
      contentFormat: "MARKDOWN",
      mimeType: "text/markdown",
      fileName: `${toFileSlug(projection.workItem.id)}-${toFileSlug(step.name)}-${toFileSlug(delegatedAgent.name)}-delegation.md`,
      contentText: `# ${delegatedAgent.name} Delegation Result\n\n${buildMarkdownArtifact(
        [
          [
            "Work Item",
            `${projection.workItem.title} (${projection.workItem.id})`,
          ],
          [
            "Phase",
            getLifecyclePhaseLabel(projection.capability.lifecycle, step.phase),
          ],
          ["Parent Agent", `${parentAgent.name} (${parentAgent.role})`],
          [
            "Delegated Agent",
            `${delegatedAgent.name} (${delegatedAgent.role})`,
          ],
          ["Delegated Task", childTask.title],
          ["Prompt", prompt],
          ["Result Summary", compactMarkdownSummary(response.content)],
        ],
      )}\n\n## Full Result\n\n${response.content}`,
      retrievalReferences: memoryContext.results.map((item) => item.reference),
    };

    let handoffPacketId: string | undefined;
    if (promoteToHandoff) {
      const handoffPacket = await createWorkItemHandoffPacketRecord({
        capabilityId: projection.capability.id,
        packet: {
          id: `HANDOFF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          workItemId: projection.workItem.id,
          summary: compactMarkdownSummary(response.content) || childTask.title,
          openQuestions: openQuestions || [],
          blockingDependencies: blockingDependencies || [],
          recommendedNextStep:
            recommendedNextStep ||
            "Review the delegated result artifact and continue the parent run.",
          artifactIds: [artifact.id],
          traceIds: traceId ? [traceId] : [],
          delegationOriginTaskId: childTask.id,
          delegationOriginAgentId: delegatedAgent.id,
          createdAt: new Date().toISOString(),
        },
      });
      handoffPacketId = handoffPacket.id;
    }

    const completedTask: AgentTask = {
      ...childTask,
      status: "COMPLETED",
      timestamp: formatTaskTimestamp(),
      executionNotes: compactMarkdownSummary(response.content),
      linkedArtifacts: [
        {
          name: artifact.name,
          size: artifact.version,
          type: "file",
        },
      ],
      producedOutputs: [
        {
          name: artifact.name,
          status: "completed",
          artifactId: artifact.id,
          runId: detail.run.id,
          runStepId: childTask.runStepId,
        },
      ],
      handoffPacketId,
    };

    const completionLog = createExecutionLog({
      capabilityId: projection.capability.id,
      taskId: childTask.id,
      agentId: delegatedAgent.id,
      message: `Delegated specialist task completed: ${artifact.summary}`,
      runId: detail.run.id,
      runStepId: childTask.runStepId,
      toolInvocationId,
      traceId,
      metadata: {
        artifactId: artifact.id,
        handoffPacketId,
        model: response.model,
      },
      costUsd: response.usage.estimatedCostUsd,
      latencyMs: undefined,
    });

    projection.workspace.tasks = replaceTask(
      projection.workspace.tasks,
      completedTask,
    );
    projection.workspace.artifacts = replaceArtifact(
      projection.workspace.artifacts,
      artifact,
    );
    projection.workspace.executionLogs = [
      ...projection.workspace.executionLogs,
      completionLog,
    ];

    await replaceCapabilityWorkspaceContentRecord(projection.capability.id, {
      tasks: projection.workspace.tasks,
      artifacts: projection.workspace.artifacts,
      executionLogs: projection.workspace.executionLogs,
    });
    await refreshCapabilityMemory(projection.capability.id).catch(
      () => undefined,
    );
    await queueTargetedLearningRefresh({
      workspace: projection.workspace,
      capabilityId: projection.capability.id,
      focusedAgentId: delegatedAgent.id,
      triggerType: "MANUAL_REFRESH",
    });

    return {
      summary: `Delegated ${childTask.title} to ${delegatedAgent.name}.`,
      retryable: false,
      details: {
        childTaskId: childTask.id,
        delegatedAgentId: delegatedAgent.id,
        delegatedAgentName: delegatedAgent.name,
        artifactId: artifact.id,
        handoffPacketId,
        model: response.model,
        usage: response.usage,
      },
    };
  } catch (error) {
    const failedTask: AgentTask = {
      ...childTask,
      status: "ALERT",
      timestamp: formatTaskTimestamp(),
      executionNotes:
        error instanceof Error
          ? error.message
          : "Delegated specialist task failed unexpectedly.",
    };
    const failureLog = createExecutionLog({
      capabilityId: projection.capability.id,
      taskId: childTask.id,
      agentId: delegatedAgent.id,
      level: "ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Delegated specialist task failed unexpectedly.",
      runId: detail.run.id,
      runStepId: childTask.runStepId,
      toolInvocationId,
      traceId,
    });
    projection.workspace.tasks = replaceTask(
      projection.workspace.tasks,
      failedTask,
    );
    projection.workspace.executionLogs = [
      ...projection.workspace.executionLogs,
      failureLog,
    ];
    await replaceCapabilityWorkspaceContentRecord(projection.capability.id, {
      tasks: projection.workspace.tasks,
      executionLogs: projection.workspace.executionLogs,
    });
    throw error;
  }
};

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
  status: AgentTask["status"];
  executionNotes?: string;
  producedOutputs?: NonNullable<AgentTask["producedOutputs"]>;
  toolInvocationId?: string;
}) =>
  tasks.map((task) => {
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
  const workItem = workspace.workItems.find((item) => item.id === workItemId);
  if (!workItem) {
    throw new Error(`Work item ${workItemId} was not found.`);
  }

  const workflow =
    workflowOverride ||
    workspace.workflows.find((item) => item.id === workItem.workflowId) ||
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
  workspace: ProjectionContext["workspace"];
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

const persistWorkItemStageOverride = async ({
  capabilityId,
  workItemId,
  workflowOverride,
  mutate,
}: {
  capabilityId: string;
  workItemId: string;
  workflowOverride?: Workflow;
  mutate: (workItem: WorkItem, workflow: Workflow) => WorkItem;
}) => {
  const projection = await resolveProjectionContext(
    capabilityId,
    workItemId,
    workflowOverride,
  );
  const nextWorkItem = mutate(projection.workItem, projection.workflow);

  if (nextWorkItem === projection.workItem) {
    return nextWorkItem;
  }

  await persistProjection({
    capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: projection.workflow,
  });

  return nextWorkItem;
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
  workspace: ProjectionContext["workspace"];
  capabilityId: string;
  focusedAgentId?: string;
  insight: string;
  triggerType: NonNullable<LearningUpdate["triggerType"]>;
  relatedWorkItemId?: string;
  relatedRunId?: string;
  sourceLogIds?: string[];
}) => {
  const ownerAgentId = workspace.agents.find((agent) => agent.isOwner)?.id;
  const executionAgentId = workspace.agents.find(
    (agent) => agent.standardTemplateKey === "EXECUTION-OPS",
  )?.id;
  const targetAgentIds = [
    ...new Set([focusedAgentId, ownerAgentId, executionAgentId]),
  ].filter((value): value is string => Boolean(value));

  const nextUpdates = targetAgentIds.map(
    (agentId) =>
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
  workspace: ProjectionContext["workspace"];
  capabilityId: string;
  focusedAgentId?: string;
  triggerType: NonNullable<LearningUpdate["triggerType"]>;
}) => {
  const ownerAgentId = workspace.agents.find((agent) => agent.isOwner)?.id;
  const executionAgentId = workspace.agents.find(
    (agent) => agent.standardTemplateKey === "EXECUTION-OPS",
  )?.id;
  const targetAgentIds = [
    ...new Set([focusedAgentId, ownerAgentId, executionAgentId]),
  ].filter((value): value is string => Boolean(value));

  await Promise.all(
    targetAgentIds.map((agentId) =>
      queueSingleAgentLearningRefresh(
        capabilityId,
        agentId,
        `execution-feedback:${triggerType.toLowerCase()}`,
      ),
    ),
  ).catch(() => undefined);
  if (!isRemoteExecutionClient()) {
    wakeAgentLearningWorker();
  }
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
      if (character === "{") {
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

    if (character === "\\" && inString) {
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

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
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
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
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
    trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed) {
      return parsed;
    }
  }

  throw new Error("Model response did not contain valid JSON.");
};

const combineUsage = (
  left: DecisionEnvelope["usage"],
  right: DecisionEnvelope["usage"],
): DecisionEnvelope["usage"] => ({
  promptTokens: left.promptTokens + right.promptTokens,
  completionTokens: left.completionTokens + right.completionTokens,
  totalTokens: left.totalTokens + right.totalTokens,
  estimatedCostUsd: Number(
    (left.estimatedCostUsd + right.estimatedCostUsd).toFixed(4),
  ),
});

export const buildExecutionFailureRecoveryMessage = (
  step: WorkflowStep,
  message: string,
) => {
  const normalizedMessage = String(message || "").trim();
  const appendFailureDetail = (base: string) => {
    if (!normalizedMessage) {
      return base;
    }

    const condensed = normalizedMessage.replace(/\s+/g, " ").trim();
    if (!condensed) {
      return base;
    }

    const detail =
      condensed.length > 240 ? `${condensed.slice(0, 237)}...` : condensed;
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
  recentConversationText,
  toolHistory,
  handoffContext,
  resolvedWaitContext,
  operatorGuidanceContext,
}: {
  capability: Capability;
  workItem: WorkItem;
  workflow: Workflow;
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  agent: CapabilityAgent;
  malformedResponse: string;
  repairReason?: string;
  recentConversationText?: string;
  toolHistory?: Array<{ role: string; content: string }>;
  handoffContext?: string;
  resolvedWaitContext?: string;
  operatorGuidanceContext?: string;
}) => {
  const startedAt = Date.now();
  const runtimeSelection = resolveExecutionRuntimeForStep({
    step,
    agent,
    hasGitHubCodeRepository: hasGitHubCapabilityRepository(
      capability.repositories,
    ),
  });
  const runtimeAgent = buildExecutionRuntimeAgent({
    agent,
    selection: runtimeSelection,
  });
  const repairSessionMemoryPrompt = await loadExecutionSessionMemoryPrompt({
    capabilityId: capability.id,
    agentId: runtimeAgent.id,
    scope: workItem.id ? "WORK_ITEM" : "TASK",
    scopeId: workItem.id || runStep.id,
  });
  const repairContinuity = buildExecutionLlmContinuitySections({
    mode: "repair",
    workItem,
    workflow,
    step,
    runStep,
    recentConversationText,
    sessionMemoryPrompt: repairSessionMemoryPrompt,
    toolHistory,
    handoffContext,
    resolvedWaitContext,
    operatorGuidanceContext,
  });
  const repaired = await invokeScopedCapabilitySession({
    capability,
    agent: runtimeAgent,
    scope: workItem.id ? "WORK_ITEM" : "TASK",
    scopeId: workItem.id || runStep.id,
    workItemPhase: step.phase,
    developerPrompt:
      "You repair malformed workflow execution responses. Return one valid JSON object only with no markdown.",
    prompt: [
      `Workflow: ${workflow.name}`,
      `Step: ${step.name}`,
      `Phase: ${step.phase}`,
      `Attempt: ${runStep.attemptCount}`,
      repairReason
        ? `The previous assistant response for this step was incomplete or invalid: ${repairReason}`
        : "The previous assistant response for this step was malformed and could not be parsed as JSON.",
      "Repair it into exactly one valid JSON object without adding commentary.",
      "If the intent is ambiguous after reading the malformed response, choose pause_for_input and ask for the smallest missing clarification.",
      "Allowed shapes:",
      '1. {"action":"invoke_tool","reasoning":"...","summary":"...","toolCall":{"toolId":"workspace_read","args":{"path":"README.md"}}}',
      '2. {"action":"complete","reasoning":"...","summary":"..."}',
      '3. {"action":"pause_for_input","reasoning":"...","wait":{"type":"INPUT","message":"..."}}',
      '4. {"action":"pause_for_approval","reasoning":"...","wait":{"type":"APPROVAL","message":"..."}}',
      '5. {"action":"pause_for_conflict","reasoning":"...","wait":{"type":"CONFLICT_RESOLUTION","message":"..."}}',
      '6. {"action":"fail","reasoning":"...","summary":"..."}',
      repairContinuity.envelopeText,
      `Malformed response:\n${malformedResponse}`,
    ].join("\n\n"),
    timeoutMs: 45_000,
    resetSession: true,
    modelOverride: runtimeSelection.model || undefined,
  });

  const repairedObject = extractJsonObject(repaired.content) as Record<
    string,
    any
  >;
  await persistExecutionSessionMemory({
    capability,
    agent: runtimeAgent,
    scope: workItem.id ? "WORK_ITEM" : "TASK",
    scopeId: workItem.id || runStep.id,
    sessionId: repaired.sessionId,
    prompt: malformedResponse,
    assistantMessage: repaired.content,
    recentRepoCodeTarget: workItem.title,
    toolHistory,
  });

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
  recentConversationText,
  toolHistory,
  operatorGuidanceContext,
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
  recentConversationText?: string;
  toolHistory?: Array<{ role: string; content: string }>;
  operatorGuidanceContext?: string;
}): Promise<{
  review: ContrarianConflictReview;
  usage: DecisionEnvelope["usage"];
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
      .join("\n"),
    limit: 8,
  });
  const reviewContinuity = buildExecutionLlmContinuitySections({
    mode: "conflict-review",
    workItem,
    workflow,
    step,
    runStep,
    recentConversationText,
    sessionMemoryPrompt: await loadExecutionSessionMemoryPrompt({
      capabilityId: capability.id,
      agentId: reviewer.id,
      scope: "WORK_ITEM",
      scopeId: workItem.id,
    }),
    toolHistory,
    handoffContext,
    resolvedWaitContext,
    operatorGuidanceContext,
  });

  const response = await invokeScopedCapabilitySession({
    capability,
    agent: reviewer,
    scope: "WORK_ITEM",
    scopeId: workItem.id,
    workItemPhase: step.phase,
    developerPrompt:
      "You are an adversarial workflow reviewer. Return JSON only with no markdown.",
    memoryPrompt: memoryContext.prompt || undefined,
    prompt: [
      `Capability: ${capability.name}`,
      `Workflow: ${workflow.name}`,
      `Work item: ${workItem.title}`,
      `Work item request:\n${workItem.description || "None"}`,
      `Current phase: ${workItem.phase}`,
      `Current step: ${step.name}`,
      `Step objective: ${step.action}`,
      `Step guidance: ${step.description || "None"}`,
      `Current run step attempt: ${runStep.attemptCount}`,
      `Conflict wait message:\n${wait.message}`,
      reviewContinuity.envelopeText,
      "Challenge the proposed continuation path. Identify unsafe assumptions, missing evidence, contradictory handoffs, policy ambiguity, downstream risks, and alternative paths. Do not resolve the conflict yourself; advise the human operator.",
      "Return JSON with this exact shape:",
      '{"severity":"LOW|MEDIUM|HIGH|CRITICAL","recommendation":"CONTINUE|REVISE_RESOLUTION|ESCALATE|STOP","summary":"...","challengedAssumptions":["..."],"risks":["..."],"missingEvidence":["..."],"alternativePaths":["..."],"suggestedResolution":"optional operator-ready resolution text"}',
    ].join("\n\n"),
  });
  await persistExecutionSessionMemory({
    capability,
    agent: reviewer,
    scope: "WORK_ITEM",
    scopeId: workItem.id,
    sessionId: response.sessionId,
    prompt: wait.message,
    assistantMessage: response.content,
    recentRepoCodeTarget: workItem.title,
    toolHistory,
  });

  const parsed = extractJsonObject(response.content);
  const sourceDocumentIds = Array.from(
    new Set(memoryContext.results.map((result) => result.document.id)),
  );
  const sourceArtifactIds = Array.from(
    new Set(
      memoryContext.results
        .map((result) => {
          const metadataArtifactId = result.document.metadata?.artifactId;
          if (
            typeof metadataArtifactId === "string" &&
            metadataArtifactId.trim()
          ) {
            return metadataArtifactId.trim();
          }

          if (
            ["ARTIFACT", "HANDOFF", "HUMAN_INTERACTION"].includes(
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
      status: "READY",
      reviewerAgentId: reviewer.id,
      generatedAt: new Date().toISOString(),
      severity: normalizeContrarianSeverity(parsed.severity),
      recommendation: normalizeContrarianRecommendation(parsed.recommendation),
      summary:
        normalizeString(parsed.summary) ||
        "Contrarian review completed without a summary.",
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
    retrievalReferences: memoryContext.results.map(
      (result) => result.reference,
    ),
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
  rollupCacheRef,
  runId,
  traceId,
  spanId,
  onLlmDelta,
  lastToolName,
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
  toolHistory: Array<{ role: "assistant" | "user"; content: string }>;
  operatorGuidanceContext?: string;
  /**
   * Mutable carrier so the outer iteration loop can share the rollup
   * cache across ticks without an extra return channel (Lever 3).
   */
  rollupCacheRef?: { current: RollupCacheEntry | null };
  runId?: string;
  traceId?: string;
  spanId?: string;
  /**
   * SSE-only streaming callback for LLM token deltas (Fix 4).
   * Each token published here is forwarded to SSE subscribers via
   * publishRunEvent so operators see the agent reasoning in real time.
   * Not persisted to the DB — ephemeral per-turn telemetry only.
   */
  onLlmDelta?: (delta: string) => void;
  /**
   * The toolId of the tool that was just called (Fix 2 — model routing).
   * Null on the very first turn. Used by resolveModelForTurn to select a
   * cheaper model for subsequent trivial read turns.
   */
  lastToolName?: string | null;
}): Promise<DecisionEnvelope> => {
  // History rollup (Lever 3): when toolHistory is long, collapse the oldest
  // prefix into a single summary turn produced by the cheapest model on the
  // capability's provider. Only the last `keepLastN` turns reach the main
  // (expensive) model verbatim. Respects the optional
  // `executionConfig.historyRollup` knobs and fails open on any error.
  const rollupConfig = capability.executionConfig?.historyRollup;
  const rollupEnabled = rollupConfig?.enabled !== false;
  let effectiveToolHistory = toolHistory;
  // Event-driven rollup trigger (Phase 2 / Lever 8): force a rollup
  // when state has materially shifted since the last turn — a recoverable
  // tool error, a phase change, or a wait/approval just resolved.
  // These are moments the main model benefits from a fresh condensed
  // snapshot rather than replaying noise.
  const lastTurnContent = toolHistory[toolHistory.length - 1]?.content ?? "";
  const forceRollup =
    /recoverable|write[_ ]control lock|lock held|policy[_ ]denied/i.test(
      lastTurnContent,
    ) ||
    (runStep.metadata as Record<string, unknown> | undefined)
      ?.phaseTransitioned === true;
  if (rollupEnabled && toolHistory.length > 0) {
    try {
      const { rolled, nextCache } = await rollupToolHistory({
        capability,
        agent,
        toolHistory,
        cache: rollupCacheRef?.current ?? null,
        keepLastN: rollupConfig?.keepLastN,
        rollupThreshold: rollupConfig?.threshold,
        forceRollup,
      });
      effectiveToolHistory = rolled.compressed;
      if (rollupCacheRef) rollupCacheRef.current = nextCache;
      if (rolled.summarizedTurnCount > 0 && runId) {
        await emitRunProgressEvent({
          capabilityId: capability.id,
          runId,
          workItemId: workItem.id,
          runStepId: runStep.id,
          traceId,
          spanId,
          type: "HISTORY_ROLLUP",
          message: `Condensed ${rolled.summarizedTurnCount} older tool turn${rolled.summarizedTurnCount === 1 ? "" : "s"} via budget model${rolled.usedModel ? ` (${rolled.usedModel})` : ""}.`,
          details: {
            stage: "HISTORY_ROLLUP",
            summarizedTurns: rolled.summarizedTurnCount,
            retainedTurns: rolled.retainedTurnCount,
            usedModel: rolled.usedModel,
            totalTurns: toolHistory.length,
          },
        });
      }
    } catch (error) {
      console.warn(
        "[requestStepDecision] history rollup failed; passing raw toolHistory",
        error,
      );
      effectiveToolHistory = toolHistory;
    }
  }
  const allowedToolIds = compiledStepContext.executionBoundary.allowedToolIds;
  const toolDescriptions = allowedToolIds.length
    ? listToolDescriptions(allowedToolIds).join("\n")
    : "No tools are allowed for this step.";
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
                (repository) =>
                  repository.id ===
                  workItem.executionContext?.primaryRepositoryId,
              )?.label || workItem.executionContext.primaryRepositoryId
            }`
          : null,
        capability.executionConfig.defaultWorkspacePath
          ? `Legacy default workspace hint: ${capability.executionConfig.defaultWorkspacePath}`
          : null,
        `Desktop workspace roots for this run: ${approvedWorkspacePaths.join(", ")}`,
        ...buildWorkspaceProfilePromptLines(workspaceProfile),
        "When using workspace tools, prefer relative file paths and omit workspacePath unless you intentionally need a non-default desktop workspace root or child folder.",
        "If you do provide workspacePath, it must be the desktop workspace root or a child folder inside one desktop workspace root. Do not use sibling paths or parent traversal.",
      ]
        .filter(Boolean)
        .join("\n")
    : "No desktop workspace path is available for this run.";
  const startedAt = Date.now();
  const workItemInputArtifacts = artifacts
    .filter(
      (artifact) =>
        artifact.workItemId === workItem.id &&
        artifact.direction === "INPUT" &&
        Boolean(artifact.contentText || artifact.summary),
    )
    .slice(0, 4);
  const workItemInputArtifactPrompt = workItemInputArtifacts.length
    ? workItemInputArtifacts
        .map(
          (artifact) =>
            `- ${artifact.name}${artifact.mimeType ? ` (${artifact.mimeType})` : ""}\n${summarizeText(artifact.contentText || artifact.summary || "", 1200)}`,
        )
        .join("\n\n")
    : "No uploaded work item input files were attached.";
  const recentWorkItemConversationText = buildRecentWorkItemConversationText({
    messages: workspace.messages,
    workItemId: workItem.id,
    runId: runId || null,
  });
  const memoryContext = await buildMemoryContext({
    capabilityId: capability.id || workItem.capabilityId,
    agentId: agent.id,
    queryText: [
      workItem.title,
      workItem.description,
      step.action,
      step.name,
      ...workItemInputArtifacts.map((artifact) => artifact.name),
    ]
      .filter(Boolean)
      .join("\n"),
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
  const executionRuntime = resolveExecutionRuntimeForStep({
    step,
    agent,
    hasGitHubCodeRepository: hasGitHubCapabilityRepository(
      capability.repositories,
    ),
  });
  const executionRuntimeAgent = buildExecutionRuntimeAgent({
    agent,
    selection: executionRuntime,
  });
  const legacyRoutedModel = resolveModelForTurn(
    executionRuntimeAgent,
    lastToolName ?? null,
    executionRuntime.providerKey === DEFAULT_PROVIDER_KEY
      ? capability.executionConfig?.agentModelRouting ?? null
      : null,
  );
  const legacyEffectiveRuntimeModel =
    executionRuntime.providerKey === DEFAULT_PROVIDER_KEY &&
    !normalizeString(step.runtimeModel)
      ? legacyRoutedModel
      : executionRuntime.model || executionRuntimeAgent.model;
  const tokenPolicy = resolveTokenManagementPolicy(capability);
  const modelRoutingRecommendation = recommendModelForTurn({
    capability,
    selectedProviderKey: executionRuntime.providerKey,
    selectedModel: legacyEffectiveRuntimeModel,
    phase: step.phase || workItem.phase,
    toolId: lastToolName ?? null,
    intent: `${step.name} ${step.action}`,
    writeMode: compiledStepContext.executionBoundary.allowedToolIds.some(toolId =>
      /write|patch|replace|deploy|delegate/i.test(toolId),
    ),
    requiresApproval:
      compiledStepContext.executionBoundary.requiresHumanApproval === true,
  });
  const effectiveRuntimeProviderKey =
    modelRoutingRecommendation.appliedProviderKey || executionRuntime.providerKey;
  const effectiveRuntimeModel =
    modelRoutingRecommendation.appliedModel ||
    legacyEffectiveRuntimeModel ||
    executionRuntimeAgent.model;
  const effectiveRuntimeAgent =
    modelRoutingRecommendation.applied &&
    modelRoutingRecommendation.appliedProviderKey
      ? {
          ...executionRuntimeAgent,
          providerKey: modelRoutingRecommendation.appliedProviderKey,
          provider: modelRoutingRecommendation.appliedProviderKey,
          model: effectiveRuntimeModel,
        }
      : {
          ...executionRuntimeAgent,
          model: effectiveRuntimeModel,
        };

  // Context Budgeter (Phase 2 / Lever 5): assemble the prompt as
  // typed fragments with priorities + token estimates so we can evict
  // the lowest-priority sources if a call would exceed the phase budget.
  // Happy path (call fits under the budget) is identical to the old
  // flat .join('\n\n'): fragments emit in input order, nothing evicted.
  const providerForEstimate = normalizeProviderForEstimate(
    effectiveRuntimeProviderKey,
    effectiveRuntimeModel,
  );
  const tok = (text: string, kind: "prose" | "code" | "json" = "prose") =>
    estimateTokens(text, {
      provider: providerForEstimate,
      model: effectiveRuntimeModel,
      kind,
    });

  const historySource: ContextSource = rollupCacheRef?.current?.summary
    ? "HISTORY_ROLLUP"
    : "RAW_TAIL_TURNS";
  const executionSessionMemoryPrompt = await loadExecutionSessionMemoryPrompt({
    capabilityId: capability.id || workItem.capabilityId,
    agentId: effectiveRuntimeAgent.id,
    scope: workItem.id ? "WORK_ITEM" : "TASK",
    scopeId: workItem.id || runStep.id,
  });
  const liveExecutionContextText = [
    `Work item ${workItem.id}: ${workItem.title}`,
    `Workflow: ${workflow.name}`,
    `Current step: ${step.name}`,
    `Objective: ${compiledStepContext.objective}`,
    `Plan summary: ${compiledWorkItemPlan.planSummary}`,
  ].join("\n");
  const executionContinuity = buildExecutionLlmContinuitySections({
    mode: "workflow-step",
    workItem,
    workflow,
    step,
    runStep,
    rawMessage: `${step.name}\n${step.action}`,
    effectiveMessage: `${step.name}\n${step.action}`,
    recentConversationText: recentWorkItemConversationText,
    sessionMemoryPrompt: executionSessionMemoryPrompt,
    toolHistory: effectiveToolHistory,
    handoffContext: compiledStepContext.handoffContext,
    resolvedWaitContext: compiledStepContext.resolvedWaitContext,
    operatorGuidanceContext,
    liveContext: liveExecutionContextText,
    advisoryMemory: memoryContext.prompt,
  });
  const historyText = executionContinuity.toolTranscriptText;

  const systemCoreText = [
    "Treat the compiled step contract as authoritative. Stay inside the execution boundary, use the required inputs and artifact checklist as the operating contract, and never invent orchestration outside this single step.",
    "Use prior-step hand-offs, retrieved memory, and resolved human inputs as authoritative downstream context. Do not ask for information that is already present in those sections. If you truly need more input, explain exactly what new gap remains and why the existing context is insufficient.",
    "If explicit operator guidance says to skip build, test, or docs execution for this attempt because the command template is unavailable or intentionally waived, do not keep retrying that tool. Complete the step with a clear note about the skipped validation, or pause for input only if the operator instruction is genuinely ambiguous.",
    "Return JSON with one of these shapes:",
    '1. {"action":"invoke_tool","reasoning":"...","summary":"...","toolCall":{"toolId":"workspace_read","args":{"path":"README.md"}}}',
    '2. {"action":"complete","reasoning":"...","summary":"..."}',
    '3. {"action":"pause_for_input","reasoning":"...","wait":{"type":"INPUT","message":"..."}}',
    '4. {"action":"pause_for_approval","reasoning":"...","wait":{"type":"APPROVAL","message":"..."}}',
    '5. {"action":"pause_for_conflict","reasoning":"...","wait":{"type":"CONFLICT_RESOLUTION","message":"..."}}',
    '6. {"action":"fail","reasoning":"...","summary":"..."}',
    "Only choose tool ids from the allowed list. If no tools are allowed, either complete, pause, or fail.",
    "Use pause_for_conflict when competing requirements, unsafe assumptions, policy disagreement, or contradictory evidence need an explicit operator decision before continuation.",
    `Story title: ${workItem.title}`,
    `Story request: ${workItem.description}`,
    "Decide the next execution action for this workflow step.",
  ].join("\n\n");

  const briefingText = [
    `Capability briefing:\n${capabilityBriefingPrompt}`,
    `Agent knowledge lens:\n${agentKnowledgePrompt}`,
    `Current workflow: ${workflow.name}`,
    `Current step: ${step.name}`,
    `Current phase: ${workItem.phase}`,
    `Current step attempt: ${runStep.attemptCount}`,
  ].join("\n\n");

  const stepContractJson = JSON.stringify(compiledStepContext, null, 2);
  // The artifact contract's expectedOutputs are advisory metadata in the
  // JSON dump above, but the agent often misses them when they're buried
  // inside the JSON. Lift them into a top-level instruction at the END of
  // the step-contract block so the LLM treats them as a hard requirement
  // on the response shape (one `## <Output>` section per expected output).
  const expectedOutputContractInstruction = buildOutputContractInstruction(
    step.artifactContract?.expectedOutputs || [],
  );
  const stepContractText = [
    `Step contract:\n${stepContractJson}`,
    `Step objective: ${compiledStepContext.objective}`,
    `Step guidance: ${compiledStepContext.description || "None"}`,
    `Execution notes: ${compiledStepContext.executionNotes || "None"}`,
    executionContinuity.handoffText,
    executionContinuity.resolvedWaitText,
    expectedOutputContractInstruction || undefined,
  ]
    .filter((entry): entry is string => Boolean(entry?.trim()))
    .join("\n\n");

  const memoryHitsText = `Attached work item input files:\n${workItemInputArtifactPrompt}`;
  const conversationContextText = executionContinuity.conversationText;

  const toolDescriptionsText = [
    `Allowed tools:\n${toolDescriptions}`,
    `Workspace policy:\n${workspaceGuidance}`,
  ].join("\n\n");

  const planSummaryText = `Execution plan summary: ${compiledWorkItemPlan.planSummary}`;
  const operatorGuidanceText = executionContinuity.operatorGuidanceText;

  // Load the step-level policy document from templatePath (non-blocking;
  // returns undefined when the file is absent so execution is never blocked).
  const policyDocumentContent = await loadStepPolicyDocument(step.templatePath);
  const policyDocumentText = policyDocumentContent
    ? `Step policy document (${step.templatePath}):\n${policyDocumentContent}`
    : undefined;

  const fragments: BudgetFragment[] = [
    {
      source: "SYSTEM_CORE",
      text: systemCoreText,
      estimatedTokens: tok(systemCoreText, "prose"),
    },
    {
      source: "TOOL_DESCRIPTIONS",
      text: toolDescriptionsText,
      estimatedTokens: tok(toolDescriptionsText, "prose"),
    },
    {
      source: "STEP_CONTRACT",
      text: stepContractText,
      estimatedTokens: tok(stepContractText, "json"),
      meta: { stepName: step.name, attempt: runStep.attemptCount },
    },
    ...(policyDocumentText
      ? [
          {
            source: "POLICY_DOCUMENT" as const,
            text: policyDocumentText,
            estimatedTokens: tok(policyDocumentText, "prose"),
            meta: { templatePath: step.templatePath },
          } satisfies BudgetFragment,
        ]
      : []),
    {
      source: "WORK_ITEM_BRIEFING",
      text: briefingText,
      estimatedTokens: tok(briefingText, "prose"),
      meta: { workflow: workflow.name, phase: workItem.phase },
    },
    {
      source: "OPERATOR_GUIDANCE",
      text: operatorGuidanceText,
      estimatedTokens: tok(operatorGuidanceText, "prose"),
    },
    {
      source: "PLAN_SUMMARY",
      text: planSummaryText,
      estimatedTokens: tok(planSummaryText, "prose"),
    },
    {
      source: "MEMORY_HITS",
      text: memoryHitsText,
      estimatedTokens: tok(memoryHitsText, "prose"),
    },
    ...(conversationContextText
      ? [
          {
            source: "CONVERSATION_HISTORY" as const,
            text: conversationContextText,
            estimatedTokens: tok(conversationContextText, "prose"),
            meta: {
              conversationTurns: recentWorkItemConversationText.split("\n").length,
              workItemId: workItem.id,
              runId: runId || null,
            },
          } satisfies BudgetFragment,
        ]
      : []),
    ...(historyText
      ? [
          {
            source: historySource,
            text: historyText,
            estimatedTokens: tok(historyText, "prose"),
            meta: {
              turnCount: effectiveToolHistory.length,
              rolledUp: historySource === "HISTORY_ROLLUP",
            },
          } as BudgetFragment,
        ]
      : []),
  ];

  const phaseBudget = resolvePhaseBudget(step.phase || workItem.phase);
  const budgeted = buildBudgetedPrompt({
    fragments,
    maxInputTokens: phaseBudget.maxInputTokens,
    reservedOutputTokens: phaseBudget.reservedOutputTokens,
  });

  const response = await invokeScopedCapabilitySession({
    capability,
    agent: effectiveRuntimeAgent,
    scope: workItem.id ? "WORK_ITEM" : "TASK",
    scopeId: workItem.id || runStep.id,
    workItemPhase: step.phase || workItem.phase,
    developerPrompt:
      "You are an execution engine inside a capability workflow. Return JSON only with no markdown.",
    memoryPrompt: memoryContext.prompt || undefined,
    prompt: budgeted.assembled,
    // Real-time LLM token streaming (Fix 4): forward deltas to SSE so
    // operators see the agent reasoning as it happens.
    onDelta: onLlmDelta,
    // Token Intelligence can keep this advisory or apply the selected model
    // when `model-adaptive-routing` is explicitly automatic.
    modelOverride: effectiveRuntimeModel || undefined,
  });
  console.log(`\n[orchestrator:debug] ══════ LLM RAW RESPONSE ══════`);
  console.log(`[orchestrator:debug]   step: ${step.name}`);
  console.log(`[orchestrator:debug]   model: ${response.model}`);
  console.log(`[orchestrator:debug]   content: ${response.content}`);
  console.log(`[orchestrator:debug] ════════════════════════════════\n`);
  
  await persistExecutionSessionMemory({
    capability,
    agent: effectiveRuntimeAgent,
    scope: workItem.id ? "WORK_ITEM" : "TASK",
    scopeId: workItem.id || runStep.id,
    sessionId: response.sessionId,
    prompt: budgeted.assembled,
    assistantMessage: response.content,
    recentRepoCodeTarget: workItem.title,
    toolHistory: effectiveToolHistory,
  });

  // Emit a Prompt Receipt (Phase 2 / Lever 7): per-call record of which
  // context fragments the main model actually saw. On-brand for the
  // evidence/flight-recorder story — operators can answer "why did the
  // model decide X" with "because it saw these N fragments."
  if (runId) {
    try {
      await emitRunProgressEvent({
        capabilityId: capability.id,
        runId,
        workItemId: workItem.id,
        runStepId: runStep.id,
        traceId,
        spanId,
        type: "PROMPT_RECEIPT",
        message:
          budgeted.receipt.evicted.length > 0
            ? `Prompt fit under ${phaseBudget.maxInputTokens}-token budget after evicting ${budgeted.receipt.evicted.length} fragment${budgeted.receipt.evicted.length === 1 ? "" : "s"}.`
            : `Prompt assembled: ${budgeted.receipt.totalEstimatedTokens} / ${phaseBudget.maxInputTokens} estimated tokens across ${budgeted.receipt.included.length} fragments.`,
        details: {
          stage: "PROMPT_RECEIPT",
          included: budgeted.receipt.included,
          evicted: budgeted.receipt.evicted,
          totalEstimatedTokens: budgeted.receipt.totalEstimatedTokens,
          maxInputTokens: budgeted.receipt.maxInputTokens,
          reservedOutputTokens: budgeted.receipt.reservedOutputTokens,
          phase: step.phase || workItem.phase,
          runtimeProviderKey: effectiveRuntimeProviderKey,
          runtimeTransportMode: executionRuntime.transportMode,
          executionRuntimeSource: executionRuntime.source,
          toolingMode: "singularity-owned",
          model: response.model || null,
          actualUsage: response.usage || null,
          tokenPolicyMode: tokenPolicy.mode,
          strategyModes: tokenPolicy.strategyModes,
          enabledStrategies: getEnabledTokenStrategies(tokenPolicy.strategyModes),
          disabledStrategies: getDisabledTokenStrategies(tokenPolicy.strategyModes),
          complexityTier: modelRoutingRecommendation.complexityTier,
          recommendedProviderKey: modelRoutingRecommendation.recommendedProviderKey,
          recommendedModel: modelRoutingRecommendation.recommendedModel,
          selectedProviderKey: modelRoutingRecommendation.selectedProviderKey,
          selectedModel: modelRoutingRecommendation.selectedModel,
          routingReason: modelRoutingRecommendation.routingReason,
          contextEnvelopeSource: executionContinuity.contextEnvelopeSource,
          executionContextHydrated: executionContinuity.executionContextHydrated,
          liveWorkContextIncluded: Boolean(
            executionContinuity.envelope.liveContext,
          ),
          advisoryMemoryIncluded: Boolean(
            executionContinuity.envelope.advisoryMemory,
          ),
          conversationTailCount: recentWorkItemConversationText
            ? recentWorkItemConversationText.split("\n").length
            : 0,
          toolTranscriptIncluded: Boolean(effectiveToolHistory.length),
          usageEstimated:
            typeof response.usageEstimated === "boolean"
              ? response.usageEstimated
              : executionRuntime.usageEstimated,
        },
      });
    } catch (error) {
      console.warn(
        "[requestStepDecision] failed to emit PROMPT_RECEIPT event",
        error,
      );
    }

    // Emit a `LLM_CONTEXT_PREPARED` event carrying the FULL assembled
    // prompt body (sibling of PROMPT_RECEIPT, which only captures the
    // metadata). Powers the operator's "View context" drawer — clicking
    // any agent step in the timeline opens the exact text the model saw.
    //
    // Best-effort: a failure here MUST NOT block the run.
    try {
      await emitRunProgressEvent({
        capabilityId: capability.id,
        runId,
        workItemId: workItem.id,
        runStepId: runStep.id,
        traceId,
        spanId,
        type: "LLM_CONTEXT_PREPARED",
        level: "INFO",
        message: `Sent ${budgeted.receipt.totalEstimatedTokens} tok to ${effectiveRuntimeProviderKey}/${response.model || "default"}.`,
        details: {
          stage: "LLM_CONTEXT_PREPARED",
          provider: effectiveRuntimeProviderKey,
          model: response.model || effectiveRuntimeModel || null,
          // Execution mode invokes the model with a single JSON-only
          // system prompt; there's no user turn separately — the
          // assembled body is the whole instruction.
          messages: [
            {
              role: "system",
              content: budgeted.assembled,
            },
          ],
          budgetReceipt: {
            included: budgeted.receipt.included,
            evicted: budgeted.receipt.evicted,
            totalEstimatedTokens: budgeted.receipt.totalEstimatedTokens,
            maxInputTokens: budgeted.receipt.maxInputTokens,
            reservedOutputTokens: budgeted.receipt.reservedOutputTokens,
          },
          phase: step.phase || workItem.phase,
          actualUsage: response.usage || null,
        },
      });
    } catch (error) {
      console.warn(
        "[requestStepDecision] failed to emit LLM_CONTEXT_PREPARED event",
        error,
      );
    }
  }

  // Time-travel debugging for AI decisions: persist the receipt so the
  // replay endpoint can rehydrate the exact context and re-invoke any
  // model. Fire-and-forget — inference never blocks on durable audit.
  void persistPromptReceipt({
    runStepId: runStep.id,
    runId: runId ?? null,
    workItemId: workItem.id ?? null,
    capability,
    agent: effectiveRuntimeAgent,
    scope: workItem.id ? "WORK_ITEM" : "TASK",
    scopeId: workItem.id || runStep.id,
    phase: step.phase || workItem.phase || null,
    model: response.model || effectiveRuntimeModel || effectiveRuntimeAgent.model || null,
    providerKey: effectiveRuntimeProviderKey || null,
    userPrompt: budgeted.assembled,
    memoryPrompt: memoryContext.prompt || null,
    developerPrompt:
      "You are an execution engine inside a capability workflow. Return JSON only with no markdown.",
    responseContent: response.content,
    responseUsage: {
      ...((response.usage || {}) as unknown as Record<string, unknown>),
      runtimeTransportMode: executionRuntime.transportMode,
      usageEstimated:
        typeof response.usageEstimated === "boolean"
          ? response.usageEstimated
          : executionRuntime.usageEstimated,
      toolingMode: "singularity-owned",
      executionContextHydrated: true,
      runContextSource: "live-run-state",
      tokenPolicyMode: tokenPolicy.mode,
      strategyModes: tokenPolicy.strategyModes,
      enabledStrategies: getEnabledTokenStrategies(tokenPolicy.strategyModes),
      disabledStrategies: getDisabledTokenStrategies(tokenPolicy.strategyModes),
      complexityTier: modelRoutingRecommendation.complexityTier,
      recommendedProviderKey: modelRoutingRecommendation.recommendedProviderKey,
      recommendedModel: modelRoutingRecommendation.recommendedModel,
      selectedProviderKey: modelRoutingRecommendation.selectedProviderKey,
      selectedModel: modelRoutingRecommendation.selectedModel,
      routingReason: modelRoutingRecommendation.routingReason,
      estimatedInputTokens: budgeted.receipt.totalEstimatedTokens,
      estimatedSavingsTokens: budgeted.receipt.evicted.reduce(
        (sum, entry) => sum + Number(entry.estimatedTokens || 0),
        0,
      ),
    },
    fragments: budgeted.receipt.included.map(entry => ({
      source: String(entry.source),
      tokens: Number(entry.estimatedTokens || 0),
      meta: entry.meta ?? undefined,
    })),
    evicted: budgeted.receipt.evicted.map(entry => ({
      source: String(entry.source),
      tokens: Number(entry.estimatedTokens || 0),
      reason: String(entry.reason || ""),
    })),
    totalEstimatedTokens: budgeted.receipt.totalEstimatedTokens,
    maxInputTokens: budgeted.receipt.maxInputTokens,
    reservedOutputTokens: budgeted.receipt.reservedOutputTokens,
  }).catch(() => undefined);

  try {
    const parsed = extractJsonObject(response.content) as Record<string, any>;
    console.log(`[orchestrator:debug]   parsed json object successfully`);
    const repairReason = getExecutionDecisionRepairReason(parsed);
    if (repairReason) {
      console.log(`[orchestrator:debug]   malformed decision, triggering repair. reason: ${repairReason}`);
      const repaired = await repairMalformedExecutionDecision({
        capability,
        workItem,
        workflow,
        step,
        runStep,
        agent,
        malformedResponse: response.content,
        repairReason,
        recentConversationText: recentWorkItemConversationText,
        toolHistory: effectiveToolHistory,
        handoffContext: compiledStepContext.handoffContext,
        resolvedWaitContext: compiledStepContext.resolvedWaitContext,
        operatorGuidanceContext,
      });

      return {
        decision: repaired.decision,
        model: repaired.model,
        usage: combineUsage(response.usage, repaired.usage),
        latencyMs: Date.now() - startedAt,
        retrievalReferences: memoryContext.results.map(
          (result) => result.reference,
        ),
      } as DecisionEnvelope;
    }

    return {
      decision: normalizeExecutionDecision(parsed),
      model: response.model,
      usage: response.usage,
      latencyMs: Date.now() - startedAt,
      retrievalReferences: memoryContext.results.map(
        (result) => result.reference,
      ),
    } as DecisionEnvelope;
  } catch (error) {
    console.warn(`[orchestrator:debug]   error extracting json:`, error);
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
      repairReason: "The response did not contain valid JSON.",
      recentConversationText: recentWorkItemConversationText,
      toolHistory: effectiveToolHistory,
      handoffContext: compiledStepContext.handoffContext,
      resolvedWaitContext: compiledStepContext.resolvedWaitContext,
      operatorGuidanceContext,
    });

    return {
      decision: repaired.decision,
      model: repaired.model,
      usage: combineUsage(response.usage, repaired.usage),
      latencyMs: Date.now() - startedAt,
      retrievalReferences: memoryContext.results.map(
        (result) => result.reference,
      ),
    } as DecisionEnvelope;
  }
};

const getNormalizedWorkflowSnapshot = (detail: WorkflowRunDetail) =>
  detail.run.workflowSnapshot;

const getRunBranchState = (
  detail: WorkflowRunDetail,
): WorkflowRunBranchState => ({
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
    (item) => item.workflowNodeId === currentNode.id,
  );
  if (!runStep) {
    throw new Error(
      `Run ${detail.run.id} is missing its current run-step record.`,
    );
  }
  return runStep;
};

const getCurrentWorkflowStep = (detail: WorkflowRunDetail) => {
  const workflow = getNormalizedWorkflowSnapshot(detail);
  const step = workflow.steps.find(
    (item) =>
      item.id === (detail.run.currentStepId || detail.run.currentNodeId),
  );
  if (!step) {
    throw new Error(`Run ${detail.run.id} has no current workflow step.`);
  }
  return step;
};

const maybePauseForHumanStageOverride = async ({
  detail,
  projection,
  step,
  runStep,
}: {
  detail: WorkflowRunDetail;
  projection: ProjectionContext;
  step: WorkflowStep;
  runStep: WorkflowRunStep;
}) => {
  const stageOverride = getWorkItemStageOverride(projection.workItem, step.id);
  if (
    !stageOverride ||
    stageOverride.ownerType !== "HUMAN" ||
    stageOverride.status === "COMPLETED" ||
    stageOverride.status === "CANCELLED"
  ) {
    return null;
  }

  const trimmedInstructions = stageOverride.instructions.trim();
  if (!trimmedInstructions) {
    throw new Error(
      `Human stage override for ${step.name} is missing instructions.`,
    );
  }

  const effectiveApprovalPolicy =
    step.approvalPolicy || stageOverride.approvalPolicy;
  if (!effectiveApprovalPolicy || effectiveApprovalPolicy.targets.length === 0) {
    throw new Error(
      `Human stage override for ${step.name} requires an approval policy before execution can continue.`,
    );
  }

  const updatedRunStep = await updateWorkflowRunStep({
    ...runStep,
    status: "WAITING",
    metadata: {
      ...(runStep.metadata || {}),
      delegatedHumanTask: {
        delegatedAt: new Date().toISOString(),
        delegatedBy: stageOverride.requestedBy,
        delegatedByUserId: stageOverride.assigneeUserId,
        instructions: trimmedInstructions,
        checklist: normalizeHumanChecklist(stageOverride.checklist),
        assigneeUserId: stageOverride.assigneeUserId || undefined,
        assigneeRole: stageOverride.assigneeRole || undefined,
        note: "Activated from a work-item stage ownership override.",
      },
    },
  });

  await insertRunEvent(
    createRunEvent({
      capabilityId: detail.run.capabilityId,
      runId: detail.run.id,
      workItemId: detail.run.workItemId,
      runStepId: runStep.id,
      traceId: detail.run.traceId,
      spanId: runStep.spanId,
      type: "STEP_DELEGATED_TO_HUMAN",
      level: "INFO",
      message: `${step.name} was routed to a human from its stage override.`,
      details: {
        source: "STAGE_OVERRIDE",
        instructions: trimmedInstructions,
        assigneeUserId: stageOverride.assigneeUserId || null,
        assigneeRole: stageOverride.assigneeRole || null,
      },
    }),
  );

  const waitDetail = await completeRunWithWait({
    detail,
    waitType: "HUMAN_TASK",
    waitMessage: trimmedInstructions,
    waitPayload: {
      checklist: normalizeHumanChecklist(stageOverride.checklist),
      assigneeUserId: stageOverride.assigneeUserId || undefined,
      assigneeRole: stageOverride.assigneeRole || undefined,
      approvalPolicy: effectiveApprovalPolicy,
      delegatedBy: stageOverride.requestedBy,
      stageOverrideActivated: true,
    },
    runStepOverride: updatedRunStep,
    approvalPolicyOverride: effectiveApprovalPolicy,
  });

  await persistWorkItemStageOverride({
    capabilityId: detail.run.capabilityId,
    workItemId: detail.run.workItemId,
    workflowOverride: detail.run.workflowSnapshot,
    mutate: (workItem) =>
      replaceWorkItemStageOverride(workItem, {
        ...stageOverride,
        status: "ACTIVE",
        approvalPolicy: effectiveApprovalPolicy,
      }),
  });

  return waitDetail;
};

const getNodeTypeFromRunStep = (runStep: WorkflowRunStep, workflow: Workflow) =>
  getWorkflowNode(workflow, runStep.workflowNodeId)?.type ||
  (runStep.metadata?.nodeType as WorkflowNode["type"] | undefined) ||
  "DELIVERY";

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
    .filter((step) => step.status === "COMPLETED")
    .slice()
    .reverse()
    .find((step) => step.workflowNodeId !== node.id);
  const lastSummary =
    `${latestCompletedStep?.outputSummary || ""} ${latestCompletedStep?.evidenceSummary || ""}`.toLowerCase();
  const failureSignals = /(fail|defect|error|rework|retry|blocked|issue)/.test(
    lastSummary,
  );
  const successSignals = /(pass|approved|ready|complete|successful|done)/.test(
    lastSummary,
  );

  const matchingByCondition = (conditionType: WorkflowEdgeConditionType) =>
    outgoingEdges.find((edge) => edge.conditionType === conditionType);

  if (failureSignals) {
    return (
      matchingByCondition("FAILURE") ||
      matchingByCondition("REJECTED") ||
      outgoingEdges[0]
    );
  }

  if (successSignals) {
    return (
      matchingByCondition("SUCCESS") ||
      matchingByCondition("APPROVED") ||
      matchingByCondition("DEFAULT") ||
      outgoingEdges[0]
    );
  }

  return matchingByCondition("DEFAULT") || outgoingEdges[0];
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
    pendingNodeIds: branchState.pendingNodeIds.filter(
      (nodeId) => nodeId !== completedNode.id,
    ),
    activeNodeIds: branchState.activeNodeIds.filter(
      (nodeId) => nodeId !== completedNode.id,
    ),
    completedNodeIds: Array.from(
      new Set([...branchState.completedNodeIds, completedNode.id]),
    ),
    joinState: { ...(branchState.joinState || {}) },
    visitCount: (branchState.visitCount || 0) + 1,
  };

  const enqueueNode = (nodeId: string) => {
    const node = getWorkflowNode(workflow, nodeId);
    if (!node || nextBranchState.completedNodeIds.includes(node.id)) {
      return;
    }

    if (node.type === "PARALLEL_JOIN") {
      const inboundNodeIds = getIncomingWorkflowEdges(workflow, node.id).map(
        (edge) => edge.fromNodeId,
      );
      const completedInboundNodeIds = inboundNodeIds.filter((inboundId) =>
        nextBranchState.completedNodeIds.includes(inboundId),
      );
      nextBranchState.joinState = {
        ...(nextBranchState.joinState || {}),
        [node.id]: {
          waitingOnNodeIds: inboundNodeIds.filter(
            (inboundId) =>
              !nextBranchState.completedNodeIds.includes(inboundId),
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
    if (node.type === "DECISION") {
      const chosenEdge = pickDecisionEdge({ workflow, node, detail });
      return chosenEdge ? [chosenEdge] : [];
    }
    if (node.type === "PARALLEL_SPLIT") {
      return outgoingEdges;
    }
    return outgoingEdges.length > 0 ? [outgoingEdges[0]] : [];
  };

  selectEdgesForNode(completedNode).forEach((edge) =>
    enqueueNode(edge.toNodeId),
  );

  let nextCurrentNode: WorkflowNode | undefined;
  let safetyCounter = 0;
  while (
    nextBranchState.pendingNodeIds.length > 0 &&
    safetyCounter < Math.max(nodes.length * 3, 12)
  ) {
    safetyCounter += 1;
    nextBranchState.pendingNodeIds = nextBranchState.pendingNodeIds
      .slice()
      .sort((left, right) => {
        const leftNode = getWorkflowNode(workflow, left);
        const rightNode = getWorkflowNode(workflow, right);
        const orderedIds = getWorkflowNodeOrder(workflow);
        return (
          orderedIds.indexOf(leftNode?.id || "") -
          orderedIds.indexOf(rightNode?.id || "")
        );
      });

    const candidateId = nextBranchState.pendingNodeIds[0];
    const candidateNode = getWorkflowNode(workflow, candidateId);
    if (!candidateNode) {
      nextBranchState.pendingNodeIds.shift();
      nextBranchState.activeNodeIds = nextBranchState.activeNodeIds.filter(
        (nodeId) => nodeId !== candidateId,
      );
      continue;
    }

    if (candidateNode.type === "END") {
      nextBranchState.pendingNodeIds.shift();
      nextBranchState.activeNodeIds = nextBranchState.activeNodeIds.filter(
        (nodeId) => nodeId !== candidateId,
      );
      nextBranchState.completedNodeIds = Array.from(
        new Set([...nextBranchState.completedNodeIds, candidateNode.id]),
      );
      const endRunStep = detail.steps.find(
        (step) => step.workflowNodeId === candidateNode.id,
      );
      if (endRunStep && endRunStep.status !== "COMPLETED") {
        await updateWorkflowRunStep({
          ...endRunStep,
          status: "COMPLETED",
          completedAt: new Date().toISOString(),
          outputSummary: summary,
          evidenceSummary: summary,
        });
      }
      break;
    }

    if (isWorkflowControlNode(candidateNode.type)) {
      nextBranchState.pendingNodeIds.shift();
      nextBranchState.activeNodeIds = nextBranchState.activeNodeIds.filter(
        (nodeId) => nodeId !== candidateNode.id,
      );
      nextBranchState.completedNodeIds = Array.from(
        new Set([...nextBranchState.completedNodeIds, candidateNode.id]),
      );
      const controlRunStep = detail.steps.find(
        (step) => step.workflowNodeId === candidateNode.id,
      );
      if (controlRunStep && controlRunStep.status !== "COMPLETED") {
        await updateWorkflowRunStep({
          ...controlRunStep,
          status: "COMPLETED",
          completedAt: new Date().toISOString(),
          outputSummary: `${candidateNode.name} automatically advanced the workflow.`,
          evidenceSummary: `${candidateNode.type} control node processed.`,
          metadata: {
            ...(controlRunStep.metadata || {}),
            nodeType: candidateNode.type,
          },
        });
      }
      selectEdgesForNode(candidateNode).forEach((edge) =>
        enqueueNode(edge.toNodeId),
      );
      continue;
    }

    // ALERT nodes: fire the dispatcher and auto-advance (fire-and-forget delivery)
    if (candidateNode.type === "ALERT" && candidateNode.alertConfig) {
      nextBranchState.pendingNodeIds.shift();
      nextBranchState.activeNodeIds = nextBranchState.activeNodeIds.filter(
        (nodeId) => nodeId !== candidateNode.id,
      );
      nextBranchState.completedNodeIds = Array.from(
        new Set([...nextBranchState.completedNodeIds, candidateNode.id]),
      );
      // Dispatch alert asynchronously — don't block graph advancement
      dispatchAlert(candidateNode.alertConfig, {
        workflowName: workflow.name,
        capabilityId: detail.run.capabilityId,
        runId: detail.run.id,
        nodeId: candidateNode.id,
        resolvedRecipients: [],
      }).catch((err) =>
        console.error("[execution/service] Alert dispatch failed:", err),
      );
      const alertRunStep = detail.steps.find(
        (step) => step.workflowNodeId === candidateNode.id,
      );
      if (alertRunStep && alertRunStep.status !== "COMPLETED") {
        await updateWorkflowRunStep({
          ...alertRunStep,
          status: "COMPLETED",
          completedAt: new Date().toISOString(),
          outputSummary: `Alert dispatched: ${candidateNode.alertConfig.severity ?? "INFO"}`,
          evidenceSummary: `Alert sent via ${candidateNode.alertConfig.channel ?? "IN_APP"}.`,
          metadata: { ...(alertRunStep.metadata || {}), nodeType: "ALERT" },
        });
      }
      selectEdgesForNode(candidateNode).forEach((edge) =>
        enqueueNode(edge.toNodeId),
      );
      continue;
    }

    // SUB_WORKFLOW nodes: spawn a child run then advance (or pause) the parent
    if (candidateNode.type === "SUB_WORKFLOW" && candidateNode.subWorkflowConfig) {
      const swConfig = candidateNode.subWorkflowConfig;
      const childRunId = `CHILD-${detail.run.id}-${candidateNode.id}-${Date.now()}`;
      // synthetic work_item_id — no FK constraint on this column
      const syntheticWorkItemId = `sub-wf-${detail.run.workItemId}-${candidateNode.id}`;

      // Attempt to load the referenced workflow from the current capability bundle
      let referencedWorkflowSnapshot: unknown = null;
      try {
        const bundle = await getCapabilityBundle(swConfig.referencedCapabilityId ?? detail.run.capabilityId);
        const refWf = bundle.workspace.workflows.find(
          (wf) => wf.id === swConfig.referencedWorkflowId,
        );
        if (refWf) referencedWorkflowSnapshot = refWf;
      } catch (err) {
        console.warn("[execution/service] SUB_WORKFLOW: could not load referenced workflow:", err);
      }

      // Insert a child run row (direct insert bypasses the active-run check)
      try {
        await dbQuery(
          `INSERT INTO capability_workflow_runs
             (capability_id, id, work_item_id, workflow_id, status, attempt_number,
              workflow_snapshot, branch_state, parent_run_id, parent_run_node_id,
              created_at, updated_at)
           VALUES ($1,$2,$3,$4,'QUEUED',1,$5,'{}', $6, $7, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [
            detail.run.capabilityId,
            childRunId,
            syntheticWorkItemId,
            swConfig.referencedWorkflowId,
            JSON.stringify(referencedWorkflowSnapshot ?? {}),
            detail.run.id,
            candidateNode.id,
          ],
        );
        console.log(
          `[execution/service] SUB_WORKFLOW: spawned child run ${childRunId} ` +
          `(referencedWorkflow=${swConfig.referencedWorkflowId}, waitForCompletion=${swConfig.waitForCompletion})`,
        );
      } catch (err) {
        console.error("[execution/service] SUB_WORKFLOW: failed to create child run:", err);
      }

      // Advance the step record
      const subWfStep = detail.steps.find(
        (step) => step.workflowNodeId === candidateNode.id,
      );
      if (subWfStep && subWfStep.status !== "COMPLETED") {
        await updateWorkflowRunStep({
          ...subWfStep,
          status: swConfig.waitForCompletion ? "WAITING" : "COMPLETED",
          outputSummary: `Sub-workflow ${swConfig.referencedWorkflowName ?? swConfig.referencedWorkflowId} ${swConfig.waitForCompletion ? "spawned — awaiting completion" : "spawned (fire-and-forget)"}`,
          metadata: { ...(subWfStep.metadata || {}), nodeType: "SUB_WORKFLOW", childRunId },
        });
      }

      if (swConfig.waitForCompletion) {
        // Pause parent with a SUB_WORKFLOW_WAIT
        await createRunWait({
          capabilityId: detail.run.capabilityId,
          runId: detail.run.id,
          runStepId: subWfStep?.id ?? candidateNode.id,
          type: "SUB_WORKFLOW_WAIT" as RunWaitType,
          status: "OPEN",
          message: `Waiting for sub-workflow "${swConfig.referencedWorkflowName ?? swConfig.referencedWorkflowId}" (${childRunId}) to complete.`,
          requestedBy: "system",
        });
        nextBranchState.pendingNodeIds.shift();
        nextBranchState.activeNodeIds = nextBranchState.activeNodeIds.filter(
          (nodeId) => nodeId !== candidateNode.id,
        );
        nextCurrentNode = candidateNode;
        break;
      }

      // Fire-and-forget: advance parent to next nodes
      nextBranchState.pendingNodeIds.shift();
      nextBranchState.activeNodeIds = nextBranchState.activeNodeIds.filter(
        (nodeId) => nodeId !== candidateNode.id,
      );
      nextBranchState.completedNodeIds = Array.from(
        new Set([...nextBranchState.completedNodeIds, candidateNode.id]),
      );
      selectEdgesForNode(candidateNode).forEach((edge) =>
        enqueueNode(edge.toNodeId),
      );
      continue;
    }

    nextCurrentNode = candidateNode;
    break;
  }

  const nextStep = nextCurrentNode
    ? workflow.steps.find(
        (step) =>
          step.id === getDisplayStepIdForNode(workflow, nextCurrentNode?.id),
      )
    : undefined;

  // --- Phase-segment stop-at-phase seam ------------------------------
  // If the run belongs to a segment with a stop_after_phase set, and the
  // just-completed node was the final node of that phase (next node
  // lives in a later phase), halt the run here with
  // terminal_outcome = 'SEGMENT_COMPLETE'. The work item's phase
  // advances to the next phase (so it sits at the new boundary in the
  // inbox), active_run_id clears, and the segment's status mirrors to
  // COMPLETED via markSegmentComplete.
  const segment = await getSegmentForRun(detail.run);
  const stopAfter = segment?.stopAfterPhase || detail.run.stopAfterPhase;
  const crossedPhaseBoundary = Boolean(
    nextCurrentNode && nextCurrentNode.phase !== completedNode.phase,
  );
  const shouldHaltSegment = Boolean(
    stopAfter && completedNode.phase === stopAfter && crossedPhaseBoundary,
  );

  if (shouldHaltSegment && nextCurrentNode) {
    const haltedRun = (
      await updateWorkflowRun({
        ...detail.run,
        workflowSnapshot: workflow,
        status: "COMPLETED",
        currentNodeId: undefined,
        currentStepId: undefined,
        // Advance to the boundary phase so the work item projection lands
        // on the next phase (operator sees "ready to pick up at BUILD").
        currentPhase: nextCurrentNode.phase,
        assignedAgentId: undefined,
        branchState: nextBranchState,
        pauseReason: undefined,
        currentWaitId: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        completedAt: new Date().toISOString(),
        terminalOutcome: "SEGMENT_COMPLETE",
      })
    ).run;

    if (segment) {
      await markSegmentComplete({
        capabilityId: segment.capabilityId,
        segmentId: segment.id,
        terminalOutcome: "SEGMENT_COMPLETE",
      });
    }

    return {
      nextRun: haltedRun,
      nextDetail: await getWorkflowRunDetail(
        detail.run.capabilityId,
        haltedRun.id,
      ),
      nextStep: undefined,
    };
  }
  // --- end stop-at-phase seam ---------------------------------------

  const nextRun = (
    await updateWorkflowRun({
      ...detail.run,
      workflowSnapshot: workflow,
      status: nextCurrentNode ? "RUNNING" : "COMPLETED",
      currentNodeId: nextCurrentNode?.id,
      currentStepId: nextCurrentNode
        ? getDisplayStepIdForNode(workflow, nextCurrentNode.id) ||
          nextCurrentNode.id
        : undefined,
      currentPhase: nextCurrentNode?.phase || "DONE",
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

  // Mirror the run's new status onto its owning segment. No-op for legacy
  // runs without a segmentId. Fire-and-forget is fine (same DB connection
  // semantics as mirrorRunStatusToSegment which uses its own query).
  if (nextRun.segmentId) {
    await mirrorRunStatusToSegment(nextRun);
  }

  return {
    nextRun,
    nextDetail: await getWorkflowRunDetail(detail.run.capabilityId, nextRun.id),
    nextStep,
  };
};

function buildQueuedRunForExternalAdvance({
  run,
  queuedDispatch,
}: {
  run: WorkflowRun;
  queuedDispatch: {
    assignedExecutorId?: string;
    queueReason?: WorkflowRunQueueReason;
  };
}): WorkflowRun {
  return {
    ...run,
    // Wait resolution happens outside the worker step loop, so once an
    // approval advances the graph we must hand the next step back to the
    // executor dispatcher. Leaving the run in RUNNING here strands the
    // workflow on the next step with no active worker holding the lease.
    status: "QUEUED",
    queueReason: queuedDispatch.queueReason,
    assignedExecutorId: queuedDispatch.assignedExecutorId,
    pauseReason: undefined,
    currentWaitId: undefined,
    terminalOutcome: undefined,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    completedAt: undefined,
  };
}

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
      (step) =>
        step.status === "COMPLETED" &&
        !isWorkflowControlNode(
          getNodeTypeFromRunStep(step, detail.run.workflowSnapshot),
        ) &&
        (currentStepIndex === -1 || step.stepIndex < currentStepIndex),
    )
    .sort((left, right) => left.stepIndex - right.stepIndex);

  const priorStepLines = priorCompletedSteps.map((step) => {
    const artifactSummaries = artifacts
      .filter(
        (artifact) =>
          artifact.runId === detail.run.id && artifact.runStepId === step.id,
      )
      .map((artifact) =>
        artifact.summary
          ? `${artifact.name}: ${artifact.summary}`
          : artifact.name,
      );
    const resolvedInputs = detail.waits
      .filter(
        (wait) => wait.runStepId === step.id && wait.status === "RESOLVED",
      )
      .map(
        (wait) =>
          `${wait.type.toLowerCase().replace(/_/g, " ")} resolved: ${wait.resolution || "resolved"}`,
      );

    return [
      `${step.name}: ${step.outputSummary || step.evidenceSummary || "Completed."}`,
      resolvedInputs.length > 0
        ? `Resolved inputs: ${resolvedInputs.join(" | ")}`
        : null,
      artifactSummaries.length > 0
        ? `Artifacts: ${artifactSummaries.join(" | ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const recentHistory = workItem.history
    .slice(-6)
    .map((entry) => `${entry.action}: ${entry.detail}`);

  const runWideResolvedInputs = detail.waits
    .filter((wait) => wait.status === "RESOLVED")
    .map(
      (wait) =>
        `${wait.type.toLowerCase().replace(/_/g, " ")} by ${wait.resolvedBy || "unknown"}: ${wait.resolution || "resolved"}`,
    );

  const sections = [
    priorStepLines.length > 0
      ? `Completed prior-step hand-offs:\n${priorStepLines.join("\n\n")}`
      : null,
    runWideResolvedInputs.length > 0
      ? `Resolved human inputs and decisions:\n${runWideResolvedInputs.join("\n")}`
      : null,
    recentHistory.length > 0
      ? `Recent workflow history:\n${recentHistory.join("\n")}`
      : null,
  ].filter(Boolean) as string[];

  return sections.length > 0 ? sections.join("\n\n") : undefined;
};

const buildResolvedWaitContext = ({
  detail,
  runStep,
}: {
  detail: WorkflowRunDetail;
  runStep: WorkflowRunStep;
}) => {
  const stepWaits = detail.waits
    .filter(
      (wait) => wait.runStepId === runStep.id && wait.status === "RESOLVED",
    )
    .map((wait) =>
      [
        `Resolved ${wait.type.toLowerCase().replace(/_/g, " ")}`,
        `requested by ${wait.requestedBy}`,
        wait.resolvedBy ? `resolved by ${wait.resolvedBy}` : null,
        wait.resolution ? `details: ${wait.resolution}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    );

  const lastResolution =
    typeof runStep.metadata?.lastResolution === "string"
      ? runStep.metadata.lastResolution
      : null;

  const lines = [
    ...stepWaits,
    lastResolution ? `Latest provided detail: ${lastResolution}` : null,
  ].filter(Boolean) as string[];

  return lines.length > 0 ? lines.join("\n") : undefined;
};

const buildOperatorGuidanceContext = ({
  workItem,
  artifacts,
}: {
  workItem: WorkItem;
  artifacts: Artifact[];
}) => {
  const guidanceHistory = workItem.history
    .filter((entry) =>
      [
        "Agent guidance added",
        "Stage control session completed",
        "Changes requested",
        "Conflict resolved",
        "Human input provided",
      ].includes(entry.action),
    )
    .slice(-6)
    .map((entry) => `${entry.action}: ${entry.detail}`);

  const guidanceArtifacts = artifacts
    .filter(
      (artifact) =>
        artifact.workItemId === workItem.id &&
        (artifact.artifactKind === "INPUT_NOTE" ||
          artifact.artifactKind === "STAGE_CONTROL_NOTE" ||
          artifact.artifactKind === "CONFLICT_RESOLUTION" ||
          artifact.artifactKind === "APPROVAL_RECORD"),
    )
    .slice()
    .sort(
      (left, right) =>
        new Date(right.created || 0).getTime() -
        new Date(left.created || 0).getTime(),
    )
    .slice(0, 4)
    .reverse()
    .map(
      (artifact) =>
        `${artifact.name}: ${artifact.summary || compactMarkdownSummary(artifact.contentText || "")}`,
    );

  const sections = [
    guidanceHistory.length > 0
      ? `Recent operator guidance history:\n${guidanceHistory.join("\n")}`
      : null,
    guidanceArtifacts.length > 0
      ? `Latest operator guidance artifacts:\n${guidanceArtifacts.join("\n")}`
      : null,
  ].filter(Boolean) as string[];

  return sections.length > 0 ? sections.join("\n\n") : undefined;
};

const buildStructuredInputWaitMessage = (
  step: WorkflowStep,
  missingInputs: CompiledRequiredInputField[],
) => {
  const labels = missingInputs.map((input) => input.label);

  if (labels.length === 1) {
    return `${step.name} needs one more structured input before execution can continue: ${labels[0]}.`;
  }

  if (labels.length === 2) {
    return `${step.name} needs two structured inputs before execution can continue: ${labels.join(" and ")}.`;
  }

  return `${step.name} is waiting for ${labels.length} structured inputs before execution can continue: ${labels.join(", ")}.`;
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
  type: "Execution Plan",
  version: `run-${detail.run.attemptNumber}`,
  agent: step.agentId,
  created: plan.compiledAt,
  direction: "OUTPUT",
  connectedAgentId: step.agentId,
  sourceWorkflowId: detail.run.workflowId,
  runId: detail.run.id,
  runStepId: runStep.id,
  summary: compactMarkdownSummary(plan.planSummary),
  artifactKind: "EXECUTION_PLAN",
  phase: step.phase,
  workItemId: detail.run.workItemId,
  sourceRunId: detail.run.id,
  sourceRunStepId: runStep.id,
  contentFormat: "MARKDOWN",
  mimeType: "text/markdown",
  fileName: `${toFileSlug(detail.run.workItemId)}-${toFileSlug(step.name)}-execution-plan.md`,
  contentText: `# ${step.name} Execution Plan\n\n${buildMarkdownArtifact([
    ["Work Item", detail.run.workItemId],
    ["Workflow", detail.run.workflowSnapshot.name],
    ["Phase", getLifecyclePhaseLabel(undefined, step.phase)],
    ["Current Step", step.name],
    ["Plan Summary", plan.planSummary],
    [
      "Required Inputs",
      plan.currentStep.requiredInputs
        .map((input) => `${input.label} (${input.status})`)
        .join(", "),
    ],
    [
      "Completion Checklist",
      plan.currentStep.completionChecklist.length > 0
        ? plan.currentStep.completionChecklist.join("\n")
        : "Complete the step when the current objective and evidence contract are satisfied.",
    ],
    [
      "Allowed Tools",
      plan.currentStep.executionBoundary.allowedToolIds.length > 0
        ? plan.currentStep.executionBoundary.allowedToolIds.join(", ")
        : "No tools allowed",
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
  const projection = await resolveProjectionContext(
    detail.run.capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
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
    status: "ACTIVE",
    pendingRequest: undefined,
    blocker: undefined,
    activeRunId: detail.run.id,
    lastRunId: detail.run.id,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        agent.name,
        "Execution running",
        historyMessage,
        currentStep.phase,
        "ACTIVE",
      ),
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
  const projection = await resolveProjectionContext(
    detail.run.capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  const currentStep = getCurrentWorkflowStep(detail);
  const nextArtifacts = artifacts
    ? replaceArtifacts(projection.workspace.artifacts, artifacts)
    : undefined;
  const nextStatus: WorkItemStatus =
    waitType === "APPROVAL" ? "PENDING_APPROVAL" : "BLOCKED";
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
        "System",
        waitType === "APPROVAL"
          ? "Approval requested"
          : waitType === "HUMAN_TASK"
            ? "Delegated to human"
            : "Execution paused",
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
  completeHumanOverride = false,
}: {
  detail: WorkflowRunDetail;
  completedStep: WorkflowStep;
  completedRunStep: WorkflowRunStep;
  nextStep?: WorkflowStep;
  summary: string;
  artifacts: Artifact[];
  toolInvocationId?: string;
  completeHumanOverride?: boolean;
}) => {
  const projection = await resolveProjectionContext(
    detail.run.capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  const primaryArtifact =
    artifacts.find((artifact) => artifact.artifactKind === "PHASE_OUTPUT") ||
    artifacts[0];
  const completedWorkItem = completeHumanOverride
    ? updateWorkItemStageOverrideStatus({
        workItem: projection.workItem,
        workflowStepId: completedStep.id,
        status: "COMPLETED",
      })
    : projection.workItem;
  const nextWorkItem: WorkItem = nextStep
    ? {
        ...completedWorkItem,
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
          ...completedWorkItem.history,
          createHistoryEntry(
            completedStep.agentId,
            "Execution completed",
            `${completedStep.name} completed. ${summary}`,
            nextStep.phase,
            getStepStatus(nextStep),
          ),
        ],
      }
    : {
        ...completedWorkItem,
        phase: "DONE",
        currentStepId: undefined,
        assignedAgentId: undefined,
        status: "COMPLETED",
        pendingRequest: undefined,
        blocker: undefined,
        activeRunId: undefined,
        lastRunId: detail.run.id,
        history: [
          ...completedWorkItem.history,
          createHistoryEntry(
            completedStep.agentId,
            "Story completed",
            summary,
            "DONE",
            "COMPLETED",
          ),
        ],
      };

  const nextArtifacts = replaceArtifacts(
    projection.workspace.artifacts,
    artifacts,
  );
  await persistProjection({
    capabilityId: detail.run.capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: detail.run.workflowSnapshot,
    artifacts: nextArtifacts,
    taskMutator: (tasks) =>
      updateTasksForCurrentStep({
        tasks,
        workItem: nextWorkItem,
        step: completedStep,
        run: detail.run,
        runStep: completedRunStep,
        status: "COMPLETED",
        executionNotes: `${completedStep.name} completed. ${summary}`,
        producedOutputs: [
          {
            name: primaryArtifact?.name || `${completedStep.name} Output`,
            status: "completed",
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
          outputStatus: "completed",
        },
      }),
    ],
  });
  if (!nextStep) {
    await forceWorkItemAstRefresh({
      capability: projection.capability,
      workItem: nextWorkItem,
    }).catch(() => undefined);
  }
  await queueExperienceDistillationRefresh({
    capabilityId: detail.run.capabilityId,
    agentId: completedStep.agentId,
    outcome: "COMPLETED",
    workItemId: projection.workItem.id,
    runId: detail.run.id,
  }).catch(() => undefined);
  if (!isRemoteExecutionClient()) {
    wakeAgentLearningWorker();
  }
};

const syncFailedProjection = async ({
  detail,
  message,
}: {
  detail: WorkflowRunDetail;
  message: string;
}) => {
  const projection = await resolveProjectionContext(
    detail.run.capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  const currentStep = getCurrentWorkflowStep(detail);
  const runStep = getCurrentRunStep(detail);
  const recoveryMessage = buildExecutionFailureRecoveryMessage(
    currentStep,
    message,
  );
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
    status: "BLOCKED",
    pendingRequest: {
      type: "INPUT",
      message: recoveryMessage,
      requestedBy: currentStep.agentId,
      timestamp: new Date().toISOString(),
    },
    blocker: {
      type: "HUMAN_INPUT",
      message: recoveryMessage,
      requestedBy: currentStep.agentId,
      timestamp: new Date().toISOString(),
      status: "OPEN",
    },
    activeRunId: undefined,
    lastRunId: detail.run.id,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        "System",
        "Execution failed",
        message,
        currentStep.phase,
        "BLOCKED",
      ),
      createHistoryEntry(
        "System",
        "Guidance requested",
        recoveryMessage,
        currentStep.phase,
        "BLOCKED",
      ),
    ],
  };

  await persistProjection({
    capabilityId: detail.run.capabilityId,
    workspace: projection.workspace,
    workItem: nextWorkItem,
    workflow: detail.run.workflowSnapshot,
    taskMutator: (tasks) =>
      updateTasksForCurrentStep({
        tasks,
        workItem: nextWorkItem,
        step: currentStep,
        run: detail.run,
        runStep,
        status: "ALERT",
        executionNotes: message,
      }),
    logsToAppend: [
      createExecutionLog({
        capabilityId: detail.run.capabilityId,
        taskId: projection.workItem.id,
        agentId: currentStep.agentId,
        message,
        level: "ERROR",
        runId: detail.run.id,
        runStepId: runStep.id,
        traceId: detail.run.traceId,
      }),
    ],
  });
  await queueExperienceDistillationRefresh({
    capabilityId: detail.run.capabilityId,
    agentId: currentStep.agentId,
    outcome: "FAILED",
    workItemId: projection.workItem.id,
    runId: detail.run.id,
  }).catch(() => undefined);
  if (!isRemoteExecutionClient()) {
    wakeAgentLearningWorker();
  }
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
  type: isTestingWorkflowStep(step)
    ? "Test Evidence"
    : step.stepType === "GOVERNANCE_GATE"
      ? "Governance Evidence"
      : "Execution Output",
  version: `run-${detail.run.attemptNumber}`,
  agent: step.agentId,
  created: new Date().toISOString(),
  direction: "OUTPUT",
  connectedAgentId: step.agentId,
  sourceWorkflowId: detail.run.workflowId,
  runId: detail.run.id,
  runStepId: getCurrentRunStep(detail).id,
  toolInvocationId,
  summary: compactMarkdownSummary(summary),
  artifactKind: "PHASE_OUTPUT",
  phase: step.phase,
  workItemId: detail.run.workItemId,
  sourceRunId: detail.run.id,
  sourceRunStepId: getCurrentRunStep(detail).id,
  contentFormat: "MARKDOWN",
  mimeType: "text/markdown",
  fileName: `${toFileSlug(detail.run.workItemId)}-${toFileSlug(step.name)}-output.md`,
  contentText: `# ${step.name} Output\n\n${buildMarkdownArtifact([
    ["Work Item", `${detail.run.workItemId}`],
    ["Phase", getLifecyclePhaseLabel(undefined, step.phase)],
    ["Agent", step.agentId],
    ["Summary", summary],
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
  lifecycle?: Capability["lifecycle"];
  step: WorkflowStep;
  nextStep: WorkflowStep;
  runStep: WorkflowRunStep;
  summary: string;
}): Artifact => ({
  id: createArtifactId(),
  name: `${step.name} to ${nextStep.name} Handoff`,
  capabilityId: detail.run.capabilityId,
  type: "Handoff Packet",
  version: `run-${detail.run.attemptNumber}`,
  agent: step.agentId,
  created: new Date().toISOString(),
  direction: "OUTPUT",
  connectedAgentId: nextStep.agentId,
  sourceWorkflowId: detail.run.workflowId,
  runId: detail.run.id,
  runStepId: runStep.id,
  summary: compactMarkdownSummary(
    `Handoff from ${step.name} to ${nextStep.name}. ${summary}`,
  ),
  artifactKind: "HANDOFF_PACKET",
  phase: nextStep.phase,
  workItemId: detail.run.workItemId,
  sourceRunId: detail.run.id,
  sourceRunStepId: runStep.id,
  handoffFromAgentId: step.agentId,
  handoffToAgentId: nextStep.agentId,
  contentFormat: "MARKDOWN",
  mimeType: "text/markdown",
  fileName: `${toFileSlug(detail.run.workItemId)}-${toFileSlug(step.name)}-handoff.md`,
  contentText: `# ${step.name} to ${nextStep.name} Handoff\n\n${buildMarkdownArtifact(
    [
      ["Work Item", detail.run.workItemId],
      ["Source Phase", getLifecyclePhaseLabel(lifecycle, step.phase)],
      ["Target Phase", getLifecyclePhaseLabel(lifecycle, nextStep.phase)],
      ["Source Agent", step.agentId],
      ["Target Agent", nextStep.agentId],
      ["Carry Forward Summary", summary],
      [
        "Signed On Behalf Of",
        buildWorkItemPhaseSignatureMarkdown({
          workItem,
          source: lifecycle,
          phaseId: nextStep.phase,
        }),
      ],
    ],
  )}`,
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
  lifecycle?: Capability["lifecycle"];
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  wait: RunWait;
  resolution: string;
  resolvedBy: string;
}): Artifact => {
  const contrarianReview =
    wait.type === "CONFLICT_RESOLUTION"
      ? wait.payload?.contrarianReview
      : undefined;
  const requestedInputFields = Array.isArray(wait.payload?.requestedInputFields)
    ? (wait.payload?.requestedInputFields as CompiledRequiredInputField[])
    : [];
  const codeDiffArtifactId =
    wait.type === "APPROVAL" &&
    typeof wait.payload?.codeDiffArtifactId === "string"
      ? wait.payload.codeDiffArtifactId
      : undefined;
  const codeDiffSummary =
    wait.type === "APPROVAL" &&
    typeof wait.payload?.codeDiffSummary === "string"
      ? wait.payload.codeDiffSummary
      : undefined;
  const isCodeDiffApproval = Boolean(codeDiffArtifactId);
  const artifactKind =
    wait.type === "APPROVAL"
      ? "APPROVAL_RECORD"
      : wait.type === "HUMAN_TASK"
        ? "INPUT_NOTE"
      : wait.type === "CONFLICT_RESOLUTION"
        ? "CONFLICT_RESOLUTION"
        : "INPUT_NOTE";

  const artifactName =
    wait.type === "APPROVAL" && isCodeDiffApproval
      ? `${step.name} Code Review Approval`
      : wait.type === "APPROVAL"
        ? `${step.name} Approval Record`
        : wait.type === "HUMAN_TASK"
          ? `${step.name} Human Task Record`
        : wait.type === "CONFLICT_RESOLUTION"
          ? `${step.name} Conflict Resolution`
          : `${step.name} Human Input Note`;

  return {
    id: createArtifactId(),
    name: artifactName,
    capabilityId: detail.run.capabilityId,
    type: "Human Interaction",
    version: `run-${detail.run.attemptNumber}`,
    agent: wait.requestedBy,
    created: wait.resolvedAt || new Date().toISOString(),
    direction: "OUTPUT",
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
    contentFormat: "MARKDOWN",
    mimeType: "text/markdown",
    fileName: `${toFileSlug(detail.run.workItemId)}-${toFileSlug(wait.type)}-${toFileSlug(step.name)}.md`,
    contentText: `# ${artifactName}\n\n${buildMarkdownArtifact([
      ["Work Item", detail.run.workItemId],
      ["Phase", getLifecyclePhaseLabel(lifecycle, step.phase)],
      ["Requested By", wait.requestedBy],
      ["Request", wait.message],
      requestedInputFields.length > 0
        ? [
            "Requested Inputs",
            requestedInputFields
              .map(
                (field) =>
                  `${field.label}${field.description ? ` - ${field.description}` : ""}`,
              )
              .join("\n"),
          ]
        : ["Requested Inputs", undefined],
      ["Resolved By", resolvedBy],
      ["Resolution", resolution],
      [
        "Signed On Behalf Of",
        buildWorkItemPhaseSignatureMarkdown({
          workItem,
          source: lifecycle,
          phaseId: step.phase,
        }),
      ],
      isCodeDiffApproval
        ? ["Code Diff Summary", codeDiffSummary]
        : ["Code Diff Summary", undefined],
      isCodeDiffApproval
        ? ["Linked Code Diff Artifact", codeDiffArtifactId]
        : ["Linked Code Diff Artifact", undefined],
      contrarianReview
        ? [
            "Contrarian Review",
            formatContrarianReviewMarkdown(contrarianReview),
          ]
        : ["Contrarian Review", undefined],
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
  lifecycle?: Capability["lifecycle"];
  workflow: Workflow;
  guidance: string;
  guidedBy: string;
}): Artifact => ({
  id: createArtifactId(),
  name: `${workItem.title} Agent Guidance`,
  capabilityId,
  type: "Human Interaction",
  version: `phase-${toFileSlug(workItem.phase)}`,
  agent: guidedBy,
  created: new Date().toISOString(),
  direction: "OUTPUT",
  connectedAgentId: workItem.assignedAgentId,
  sourceWorkflowId: workflow.id,
  summary: compactMarkdownSummary(guidance),
  artifactKind: "INPUT_NOTE",
  phase: workItem.phase,
  workItemId: workItem.id,
  contentFormat: "MARKDOWN",
  mimeType: "text/markdown",
  fileName: `${toFileSlug(workItem.id)}-agent-guidance.md`,
  contentText: `# Agent Guidance\n\n${buildMarkdownArtifact([
    ["Work Item", workItem.id],
    ["Phase", getLifecyclePhaseLabel(lifecycle, workItem.phase)],
    ["Guided By", guidedBy],
    ["Current Status", workItem.status],
    ["Guidance", guidance],
    [
      "Signed On Behalf Of",
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
    type: "Reference Document",
    version: `phase-${toFileSlug(workItem.phase)}`,
    agent: "User Upload",
    created: new Date().toISOString(),
    direction: "INPUT",
    connectedAgentId: workItem.assignedAgentId,
    sourceWorkflowId: workflow.id,
    summary: compactMarkdownSummary(
      `Uploaded work item reference file ${attachment.fileName}. ${preview}`,
    ),
    artifactKind: "INPUT_NOTE",
    phase: workItem.phase,
    workItemId: workItem.id,
    contentFormat,
    mimeType: attachment.mimeType || "text/plain",
    fileName: attachment.fileName,
    contentText:
      contentFormat === "MARKDOWN"
        ? `# ${attachment.fileName}\n\n${buildMarkdownArtifact([
            ["Work Item", workItem.id],
            [
              "Phase",
              getLifecyclePhaseLabel(capability.lifecycle, workItem.phase),
            ],
            ["Uploaded For", workItem.title],
            ["Summary", preview],
          ])}\n\n## Source Content\n\n${attachment.contentText}`
        : `# ${attachment.fileName}\n\n${buildMarkdownArtifact([
            ["Work Item", workItem.id],
            [
              "Phase",
              getLifecyclePhaseLabel(capability.lifecycle, workItem.phase),
            ],
            ["Uploaded For", workItem.title],
            ["Summary", preview],
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
  const actor = guidedBy?.trim() || "Capability Owner";
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
        "Agent guidance added",
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
    agentId: projection.workItem.assignedAgentId || "SYSTEM",
    message: trimmedGuidance,
    metadata: {
      interactionType: "AGENT_GUIDANCE",
      artifactId: guidanceArtifact.id,
      guidedBy: actor,
    },
  });
  const nextLearningUpdates = buildTargetedLearningUpdates({
    workspace: projection.workspace,
    capabilityId,
    focusedAgentId: projection.workItem.assignedAgentId,
    insight: `Operator guidance was added for ${projection.workItem.title}: ${trimmedGuidance}`,
    triggerType: "GUIDANCE",
    relatedWorkItemId: projection.workItem.id,
    relatedRunId:
      projection.workItem.activeRunId || projection.workItem.lastRunId,
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
    triggerType: "GUIDANCE",
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
  role: "user" | "agent";
  content: string;
  timestamp?: string;
};

const buildStageControlTranscriptMarkdown = (
  conversation: StageControlConversationEntry[],
) =>
  conversation
    .filter((entry) => entry.content?.trim())
    .map((entry) => {
      const speaker = entry.role === "agent" ? "Agent" : "Operator";
      const timestamp = entry.timestamp?.trim()
        ? ` (${entry.timestamp.trim()})`
        : "";
      return `### ${speaker}${timestamp}\n\n${entry.content.trim()}`;
    })
    .join("\n\n");

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
    .find((entry) => entry.role === "user" && entry.content?.trim())
    ?.content?.trim();
  const latestAgentMessage = [...conversation]
    .reverse()
    .find((entry) => entry.role === "agent" && entry.content?.trim())
    ?.content?.trim();

  return [
    trimmedCarryForward
      ? `Operator continuation note: ${trimmedCarryForward}`
      : null,
    latestOperatorMessage
      ? `Latest operator direction: ${latestOperatorMessage}`
      : null,
    latestAgentMessage
      ? `Latest agent conclusion: ${latestAgentMessage}`
      : null,
    `Continue ${workItem.title}${step ? ` at ${step.name}` : ""} using the stage-control conversation as authoritative operator context.`,
  ]
    .filter(Boolean)
    .join("\n");
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
  lifecycle?: Capability["lifecycle"];
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
  type: "Human Interaction",
  version: `phase-${toFileSlug(workItem.phase)}`,
  agent: resolvedBy,
  created: new Date().toISOString(),
  direction: "OUTPUT",
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
  artifactKind: "STAGE_CONTROL_NOTE",
  phase: workItem.phase,
  workItemId: workItem.id,
  contentFormat: "MARKDOWN",
  mimeType: "text/markdown",
  fileName: `${toFileSlug(workItem.id)}-stage-control-note.md`,
  contentText: `# Stage Control Note\n\n${buildMarkdownArtifact([
    ["Work Item", workItem.id],
    ["Phase", getLifecyclePhaseLabel(lifecycle, workItem.phase)],
    ["Stage", step?.name],
    ["Resolved By", resolvedBy],
    ["Run", run?.id],
    ["Carry Forward", carryForwardNote?.trim() || undefined],
    [
      "Signed On Behalf Of",
      buildWorkItemPhaseSignatureMarkdown({
        workItem,
        source: lifecycle,
        phaseId: workItem.phase,
      }),
    ],
  ])}\n\n## Conversation\n\n${buildStageControlTranscriptMarkdown(conversation) || "No conversation transcript was captured."}`,
  downloadable: true,
});

export const continueWorkflowStageControl = async ({
  capabilityId,
  workItemId,
  conversation,
  carryForwardNote,
  resolvedBy,
  markComplete,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  conversation: StageControlConversationEntry[];
  carryForwardNote?: string;
  resolvedBy: string;
  markComplete?: boolean;
  actor?: ActorContext;
}) => {
  const trimmedConversation = conversation.filter((entry) =>
    entry.content?.trim(),
  );
  const trimmedCarryForward = carryForwardNote?.trim();

  if (trimmedConversation.length === 0 && !trimmedCarryForward) {
    throw new Error(
      "Add stage-control conversation or a carry-forward note before continuing.",
    );
  }

  const projection = await resolveProjectionContext(capabilityId, workItemId);
  const runId =
    projection.workItem.activeRunId || projection.workItem.lastRunId;
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
      ? projection.workflow.steps.find(
          (step) => step.id === projection.workItem.currentStepId,
        )
      : undefined) ||
    projection.workflow.steps.find(
      (step) => step.phase === projection.workItem.phase,
    ) ||
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
  const nextArtifacts = replaceArtifacts(projection.workspace.artifacts, [
    stageControlArtifact,
  ]);
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        resolvedBy,
        "Stage control session completed",
        trimmedCarryForward || carryForward,
        projection.workItem.phase,
        projection.workItem.status,
      ),
    ],
  };
  const stageControlLog = createExecutionLog({
    capabilityId,
    taskId: projection.workItem.id,
    agentId:
      currentStep?.agentId || projection.workItem.assignedAgentId || "SYSTEM",
    message: trimmedCarryForward || carryForward,
    runId: runDetail?.run.id,
    runStepId: currentRunStep?.id,
    traceId: runDetail?.run.traceId,
    metadata: {
      interactionType: "STAGE_CONTROL",
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
    triggerType: "STAGE_CONTROL",
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
    triggerType: "STAGE_CONTROL",
  });

  const openWait =
    runDetail?.waits.find((wait) => wait.status === "OPEN") || null;

  if (markComplete && runDetail) {
    if (openWait) {
      await resolveRunWait({
        capabilityId,
        waitId: openWait.id,
        resolution: carryForward,
        resolvedBy,
        resolvedByActorUserId: actor?.userId,
        resolvedByActorTeamIds: getActorTeamIds(actor),
      });
    }
    const currentRunStep = getCurrentRunStep(runDetail);
    const updatedRunStep = await updateWorkflowRunStep({
      ...currentRunStep,
      status: "COMPLETED",
      outputSummary: "Forced complete by " + resolvedBy,
      completedAt: new Date().toISOString(),
    });
    const currentNode = getCurrentWorkflowNode(runDetail);
    const transition = await resolveGraphTransition({
      detail: runDetail,
      completedNode: currentNode,
      completedRunStep: updatedRunStep,
      summary: carryForward,
    });
    await syncCompletedProjection({
      detail: runDetail,
      completedStep: currentStep as WorkflowStep,
      completedRunStep: updatedRunStep,
      nextStep: transition.nextStep,
      summary: carryForward || "Forced complete by " + resolvedBy,
      artifacts: [stageControlArtifact],
      completeHumanOverride: true,
    });
    return {
      action: "COMPLETED_STAGE" as any,
      summary: `${projection.workItem.title} stage was manually completed from stage control.`,
      artifactId: stageControlArtifact.id,
      run: runDetail.run,
    };
  }

  if (runDetail && openWait) {
    if (openWait.type === "APPROVAL") {
      const detail = await approveWorkflowRun({
        capabilityId,
        runId: runDetail.run.id,
        resolution: carryForward,
        resolvedBy,
        actor,
      });
      return {
        action: "APPROVED_WAIT" as const,
        summary: `${projection.workItem.title} was approved from the stage-control session and can move to the next stage once the current output is accepted.`,
        artifactId: stageControlArtifact.id,
        run: detail.run,
      };
    }

    if (openWait.type === "INPUT") {
      const detail = await provideWorkflowRunInput({
        capabilityId,
        runId: runDetail.run.id,
        resolution: carryForward,
        resolvedBy,
        actor,
      });
      return {
        action: "PROVIDED_INPUT" as const,
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
      action: "RESOLVED_CONFLICT" as const,
      summary: `${projection.workItem.title} received an operator decision from stage control and resumed from the current stage.`,
      artifactId: stageControlArtifact.id,
      run: detail.run,
    };
  }

  if (runDetail && ["QUEUED", "RUNNING"].includes(runDetail.run.status)) {
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
      action: "CANCELLED_AND_RESTARTED" as const,
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
      action: "RESTARTED" as const,
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
    action: "STARTED" as const,
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
    type: "Adversarial Review",
    version: `run-${detail.run.attemptNumber}`,
    agent: review.reviewerAgentId,
    created: review.generatedAt,
    direction: "OUTPUT",
    connectedAgentId: review.reviewerAgentId,
    sourceWorkflowId: detail.run.workflowId,
    runId: detail.run.id,
    runStepId: runStep.id,
    summary: compactMarkdownSummary(review.summary),
    artifactKind: "CONTRARIAN_REVIEW",
    phase: step.phase,
    workItemId: detail.run.workItemId,
    sourceRunId: detail.run.id,
    sourceRunStepId: runStep.id,
    sourceWaitId: wait.id,
    contentFormat: "MARKDOWN",
    mimeType: "text/markdown",
    fileName: `${toFileSlug(detail.run.workItemId)}-contrarian-review-${toFileSlug(step.name)}.md`,
    contentText: `# ${artifactName}\n\n${buildMarkdownArtifact([
      ["Work Item", detail.run.workItemId],
      ["Phase", getLifecyclePhaseLabel(undefined, step.phase)],
      ["Conflict Wait", wait.message],
      ["Reviewer Agent", review.reviewerAgentId],
      ["Review", formatContrarianReviewMarkdown(review)],
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
  claimOnCreate = true,
  autoStartGitSession = true,
  planningMetadata,
}: {
  capabilityId: string;
  title: string;
  description?: string;
  workflowId: string;
  taskType?: WorkItem["taskType"];
  phaseStakeholders?: WorkItem["phaseStakeholders"];
  attachments?: WorkItemAttachmentUpload[];
  priority: WorkItem["priority"];
  tags: string[];
  actor?: ActorContext;
  claimOnCreate?: boolean;
  autoStartGitSession?: boolean;
  planningMetadata?: Pick<
    WorkItem,
    | "parentWorkItemId"
    | "storyPoints"
    | "tShirtSize"
    | "sizingConfidence"
    | "planningBatchId"
    | "planningProposalItemId"
  >;
}) => {
  const bundle = await getCapabilityBundle(capabilityId);
  if (bundle.capability.isSystemCapability) {
    throw new Error(
      `${bundle.capability.name} is a system foundation capability and cannot accept work items.`,
    );
  }
  const workflow = bundle.workspace.workflows.find(
    (item) => item.id === workflowId,
  );
  if (!workflow) {
    throw new Error(`Workflow ${workflowId} was not found.`);
  }

  const normalizedTaskType = normalizeWorkItemTaskType(taskType);
  const normalizedPhaseStakeholders = normalizeWorkItemPhaseStakeholders(
    phaseStakeholders,
    bundle.capability.lifecycle,
  );
  const normalizedAttachments = (attachments || [])
    .map((attachment) => ({
      fileName: normalizeString(attachment.fileName),
      mimeType: normalizeString(attachment.mimeType) || undefined,
      contentText:
        typeof attachment.contentText === "string"
          ? attachment.contentText
          : "",
      sizeBytes:
        typeof attachment.sizeBytes === "number" &&
        Number.isFinite(attachment.sizeBytes)
          ? attachment.sizeBytes
          : undefined,
    }))
    .filter(
      (attachment) =>
        attachment.fileName && attachment.contentText.trim().length > 0,
    );
  const firstStep = resolveWorkItemEntryStep(
    workflow,
    normalizedTaskType,
    bundle.capability.lifecycle,
  );
  if (!firstStep) {
    throw new Error(
      `Workflow ${workflow.name} does not define any executable nodes.`,
    );
  }
  const phaseOwnerTeamId = resolveWorkItemPhaseOwnerTeamId({
    capability: bundle.capability,
    phaseId: firstStep.phase,
    step: firstStep,
  });
  const actorName = getActorDisplayName(actor, "System");
  const shouldClaim = Boolean(actor?.userId) && claimOnCreate;
  const initialStatus = getPreExecutionStepStatus(firstStep);

  const nextWorkItem: WorkItem = {
    id: `WI-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    title: title.trim(),
    description:
      description?.trim() || `Delivery story for ${bundle.capability.name}.`,
    taskType: normalizedTaskType,
    parentWorkItemId: planningMetadata?.parentWorkItemId,
    storyPoints: planningMetadata?.storyPoints,
    tShirtSize: planningMetadata?.tShirtSize,
    sizingConfidence: planningMetadata?.sizingConfidence,
    planningBatchId: planningMetadata?.planningBatchId,
    planningProposalItemId: planningMetadata?.planningProposalItemId,
    phaseStakeholders: normalizedPhaseStakeholders,
    phase: firstStep.phase,
    phaseOwnerTeamId,
    claimOwnerUserId: shouldClaim ? actor?.userId : undefined,
    watchedByUserIds: shouldClaim && actor?.userId ? [actor.userId] : [],
    capabilityId,
    workflowId,
    currentStepId: firstStep.id,
    assignedAgentId: firstStep.agentId,
    status: initialStatus,
    priority,
    tags,
    recordVersion: 1,
    history: [
      createHistoryEntry(
        actorName,
        "Story created",
        `${getWorkItemTaskTypeLabel(normalizedTaskType)} work entered ${firstStep.name} in ${workflow.name}.${normalizedPhaseStakeholders.length > 0 ? ` Stakeholder sign-off was configured for ${normalizedPhaseStakeholders.length} phases.` : ""}${normalizedAttachments.length > 0 ? ` ${normalizedAttachments.length} supporting file${normalizedAttachments.length === 1 ? "" : "s"} were attached for agent context.` : ""}`,
        firstStep.phase,
        initialStatus,
      ),
      ...(shouldClaim
        ? [
            createHistoryEntry(
              actorName,
              "Operator control claimed",
              `${actorName} automatically took initial operator control so this work item is ready to start when you are. Release control to hand off to the phase owner team when ready.`,
              firstStep.phase,
              initialStatus,
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
      status: "ACTIVE",
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  }

  const attachmentArtifacts = normalizedAttachments.map((attachment) =>
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
        message: `${nextWorkItem.title} entered ${firstStep.name} in ${workflow.name}.${normalizedAttachments.length > 0 ? ` ${normalizedAttachments.length} uploaded file${normalizedAttachments.length === 1 ? "" : "s"} were attached.` : ""}`,
        traceId: undefined,
      }),
    ],
  });
  await refreshCapabilityMemory(capabilityId).catch(() => undefined);

  // Auto-open a GitHub branch for this work item (fire-and-forget). Dynamic
  // import avoids a static cycle between execution/service → agentGit/*
  // modules, which themselves import from server/repository via agentGit.
  // The helper silently no-ops when the capability has no repo or token.
  if (autoStartGitSession) {
    void (async () => {
      try {
        const { autoStartSessionForWorkItem } =
          await import("../agentGit/autoWire");
        await autoStartSessionForWorkItem({
          capabilityId,
          capabilityName: bundle.capability.name,
          workItem: { id: nextWorkItem.id, title: nextWorkItem.title },
          repositories: bundle.capability.repositories || [],
          workspaceRoots: getCapabilityWorkspaceRoots(bundle.capability),
        });
      } catch (error) {
        console.error("[agentGit/autoWire] autoStart dispatch failed", error);
      }
    })();
  }

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
  if (
    !getCapabilityBoardPhaseIds(projection.capability).includes(targetPhase)
  ) {
    throw new Error(
      `Phase ${targetPhase} is not part of ${projection.capability.name}'s lifecycle.`,
    );
  }

  const activeRun = await getActiveRunForWorkItem(capabilityId, workItemId);
  if (activeRun) {
    if (!cancelRunIfPresent) {
      throw new Error(
        "This work item already has an active or waiting run. Cancel or complete it before moving the board card.",
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
    targetPhase === "BACKLOG" || targetPhase === "DONE"
      ? undefined
      : findFirstExecutableNodeForPhase(projection.workflow, targetPhase) ||
        findFirstExecutableNode(projection.workflow);
  const targetStep = targetNode
    ? projection.workflow.steps.find((step) => step.id === targetNode.id)
    : undefined;
  const nextPhaseOwnerTeamId =
    targetPhase === "BACKLOG" || targetPhase === "DONE"
      ? resolveWorkItemPhaseOwnerTeamId({
          capability: projection.capability,
          phaseId: targetPhase,
        })
      : resolveWorkItemPhaseOwnerTeamId({
          capability: projection.capability,
          phaseId: targetPhase,
          step: targetStep,
        });
  const actorName = getActorDisplayName(actor, "User");
  const stagedTargetStatus =
    targetStep ? getPreExecutionStepStatus(targetStep) : "STAGED";

  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    phase: targetPhase,
    phaseOwnerTeamId: nextPhaseOwnerTeamId,
    currentStepId:
      targetPhase === "BACKLOG" || targetPhase === "DONE"
        ? undefined
        : targetStep?.id,
    assignedAgentId:
      targetPhase === "BACKLOG" || targetPhase === "DONE"
        ? undefined
        : targetStep?.agentId,
    status:
      targetPhase === "DONE"
        ? "COMPLETED"
        : targetStep
          ? stagedTargetStatus
          : "STAGED",
    pendingRequest: undefined,
    blocker: undefined,
    activeRunId: undefined,
    claimOwnerUserId:
      actor?.userId && targetPhase !== "BACKLOG" && targetPhase !== "DONE"
        ? actor.userId
        : undefined,
    recordVersion: (projection.workItem.recordVersion || 1) + 1,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        actorName,
        "Board stage updated",
        note || `Story was moved to ${targetPhase} from the delivery board.`,
        targetPhase,
        targetPhase === "DONE"
          ? "COMPLETED"
          : targetStep
            ? stagedTargetStatus
            : "STAGED",
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
        agentId:
          targetStep?.agentId ||
          projection.capability.specialAgentId ||
          "SYSTEM",
        message:
          note || `${projection.workItem.title} moved to ${targetPhase}.`,
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
  stopAfterPhase,
  intention,
  segmentId,
  queuedDispatchOverride,
}: {
  capabilityId: string;
  workItemId: string;
  restartFromPhase?: WorkItemPhase;
  guidance?: string;
  guidedBy?: string;
  actor?: ActorContext;
  // Phase-segment model: when `intention` is provided (or `segmentId` for
  // a retry), a segment row is created/linked and the run is bound to it.
  // Legacy callers that pass none of the three get today's behavior:
  // no segment row, a run that traverses to DONE.
  stopAfterPhase?: WorkItemPhase;
  intention?: string;
  segmentId?: string;
  queuedDispatchOverride?: {
    assignedExecutorId?: string;
    queueReason?: WorkflowRunQueueReason;
  };
}) => {
  const existingActiveRun = await getActiveRunForWorkItem(
    capabilityId,
    workItemId,
  );
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
    const actorName = getActorDisplayName(
      actor,
      guidedBy || "Capability Owner",
    );
    const claimedAt = new Date().toISOString();

    await upsertWorkItemClaim({
      capabilityId,
      workItemId,
      userId: actor.userId,
      teamId: actor.teamIds?.[0],
      status: "ACTIVE",
      claimedAt,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });

    const nextWorkItem: WorkItem = {
      ...projection.workItem,
      claimOwnerUserId: actor.userId,
      watchedByUserIds: Array.from(
        new Set([
          ...(projection.workItem.watchedByUserIds || []),
          actor.userId,
        ]),
      ),
      recordVersion: (projection.workItem.recordVersion || 1) + 1,
      history: [
        ...projection.workItem.history,
        createHistoryEntry(
          actorName,
          "Operator control claimed",
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
        workItems: replaceWorkItem(
          projection.workspace.workItems,
          nextWorkItem,
        ),
      },
    };
  }

  if (!canActorOperateWorkItem({ actor, workItem: projection.workItem })) {
    throw new Error(
      "Only the current phase owner can start or restart this phase.",
    );
  }
  if (
    restartFromPhase &&
    !getCapabilityBoardPhaseIds(projection.capability).includes(
      restartFromPhase,
    )
  ) {
    throw new Error(
      `Phase ${restartFromPhase} is not part of ${projection.capability.name}'s lifecycle.`,
    );
  }
  const readinessContract = projection.workspace.readinessContract;
  if (readinessContract && !readinessContract.allReady) {
    const firstBlockedGate = readinessContract.gates.find(
      (gate) => !gate.satisfied,
    );
    throw new Error(
      firstBlockedGate?.blockingReason ||
        readinessContract.summary ||
        "This capability is not ready to start delivery yet.",
    );
  }
  // Phase-segment resolution. Three cases:
  //  (a) segmentId provided -> this is a retry against an existing segment.
  //  (b) intention provided (no segmentId) -> create a fresh segment.
  //  (c) neither -> legacy path; no segment row; run traverses to DONE.
  let segmentForRun: {
    id: string;
    prioritySnapshot: "High" | "Med" | "Low";
    isRetry: boolean;
  } | undefined;
  let effectiveStopAfterPhase = stopAfterPhase;

  if (segmentId) {
    const existing = await getSegmentById({ capabilityId, segmentId });
    if (!existing) {
      throw new Error(`Segment ${segmentId} does not exist for this capability.`);
    }
    if (existing.workItemId !== workItemId) {
      throw new Error(
        `Segment ${segmentId} belongs to a different work item.`,
      );
    }
    if (
      existing.status !== "FAILED" &&
      existing.status !== "CANCELLED"
    ) {
      throw new Error(
        `Segment ${segmentId} is not in a retryable state (status=${existing.status}).`,
      );
    }
    segmentForRun = {
      id: existing.id,
      prioritySnapshot: existing.prioritySnapshot,
      isRetry: true,
    };
    effectiveStopAfterPhase = existing.stopAfterPhase;
  } else if (intention && intention.trim()) {
    const effectiveStartPhase =
      restartFromPhase || projection.workItem.phase;
    const created = await createSegment({
      capabilityId,
      workItem: projection.workItem,
      startPhase: effectiveStartPhase,
      stopAfterPhase: stopAfterPhase || null,
      intention: intention.trim(),
      actorUserId: actor?.userId,
    });
    segmentForRun = {
      id: created.id,
      prioritySnapshot: created.prioritySnapshot,
      isRetry: false,
    };
  }

  const detail = await (
    await import("./repository")
  ).createWorkflowRun({
    capabilityId,
    workItem: projection.workItem,
    workflow: projection.workflow,
    restartFromPhase,
    segment: segmentForRun,
    queuedDispatchOverride,
  });

  // Note: stop_after_phase lives on the segment row, not duplicated on
  // the run. resolveGraphTransition reads it lazily via
  // getSegmentForRun when it needs to decide whether to halt.
  void effectiveStopAfterPhase;

  await syncRunningProjection({
    detail,
    capability: projection.capability,
    agent:
      projection.workspace.agents.find(
        (agent) => agent.id === detail.run.assignedAgentId,
      ) || projection.workspace.agents[0],
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
  approvalDisposition = "APPROVE",
  actor,
}: {
  capabilityId: string;
  runId: string;
  expectedType: RunWaitType;
  resolution: string;
  resolvedBy: string;
  approvalDisposition?: "APPROVE" | "REQUEST_CHANGES";
  actor?: ActorContext;
}) => {
  const detail = await getWorkflowRunDetail(capabilityId, runId);
  if (detail.run.status === "PAUSED") {
    throw new Error("Resume this run before resolving its wait.");
  }
  const projection = await resolveProjectionContext(
    capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  const openWait = [...detail.waits]
    .reverse()
    .find((wait) => wait.status === "OPEN");
  if (!openWait) {
    throw new Error(`Run ${runId} does not have an open wait to resolve.`);
  }
  if (openWait.type !== expectedType) {
    throw new Error(
      `Run ${runId} is waiting for ${openWait.type}, not ${expectedType}.`,
    );
  }
  if (
    expectedType === "APPROVAL" &&
    !canActorApproveWait({
      actor,
      workItem: projection.workItem,
      wait: openWait,
    })
  ) {
    throw new Error("This approval is assigned to another user or team.");
  }
  if (
    expectedType !== "APPROVAL" &&
    !canActorOperateWorkItem({ actor, workItem: projection.workItem })
  ) {
    throw new Error(
      "Only the current phase owner can resolve this workflow wait.",
    );
  }
  if (
    expectedType === "INPUT" &&
    isToolLoopExhaustionWait(openWait) &&
    !hasConcreteImplementationGuidance(resolution)
  ) {
    throw new Error(
      'This stalled execution needs exact implementation guidance. Include the files to edit and, if relevant, the build/test command. Example: "Edit src/.../Operator.java and src/.../RuleEngineService.java to add endsWith support, then run mvn test from /repo/root."',
    );
  }

  const currentStep = getCurrentWorkflowStep(detail);
  const currentRunStep = getCurrentRunStep(detail);

  // ── Approval path ──────────────────────────────────────────────────────────
  if (expectedType === "APPROVAL") {
    const actorTeamIds = getActorTeamIds(actor);
    const assignments = openWait.approvalAssignments || [];
    const existingDecisions = openWait.approvalDecisions || [];

    // Guard: actor already voted on this wait — prevent double-counting.
    const alreadyVoted = existingDecisions.some(
      (d) =>
        (actor?.userId && d.actorUserId === actor.userId) ||
        (actorTeamIds.length > 0 &&
          actorTeamIds.some((t) => d.actorTeamIds.includes(t))),
    );
    if (alreadyVoted) {
      throw new Error("You have already submitted an approval decision for this step.");
    }

    // Delegation guard — if the policy disallows delegation, reject delegated decisions.
    const policy =
      (openWait.payload?.approvalPolicy as ApprovalPolicy | undefined) ||
      (currentStep.approvalPolicy as ApprovalPolicy | undefined);
    if (
      policy &&
      !policy.delegationAllowed &&
      openWait.payload?.isDelegated === true
    ) {
      throw new Error("Delegated approvals are not permitted by the policy attached to this step.");
    }

    // Due-date check — warn in the event log but do not block (past-due approval
    // is still better than a permanently stuck run).
    const dueAt = assignments[0]?.dueAt;
    const isPastDue = dueAt ? new Date(dueAt) < new Date() : false;

    // Find which assignment belongs to this actor so we only update that row.
    const actorAssignment = assignments.find((assignment) => {
      if (!actor?.userId && actorTeamIds.length === 0) return true;
      if (assignment.status !== "PENDING") return false;
      if (assignment.targetType === "USER") {
        return (assignment.assignedUserId || assignment.targetId) === actor?.userId;
      }
      if (assignment.targetType === "TEAM") {
        const teamId = assignment.assignedTeamId || assignment.targetId;
        return actorTeamIds.includes(teamId);
      }
      return true;
    });

    // Record the decision first (before resolving the wait).
    await createApprovalDecision({
      id: createApprovalDecisionId(),
      capabilityId,
      runId,
      waitId: openWait.id,
      assignmentId: actorAssignment?.id,
      disposition: approvalDisposition,
      actorUserId: actor?.userId,
      actorDisplayName: getActorDisplayName(actor, resolvedBy),
      actorTeamIds,
      comment: resolution,
      createdAt: new Date().toISOString(),
    });

    // Update only this actor's assignment (not all pending ones).
    if (actorAssignment) {
      await updateSingleApprovalAssignment({
        capabilityId,
        assignmentId: actorAssignment.id,
        status: approvalDisposition === "REQUEST_CHANGES" ? "REQUEST_CHANGES" : "APPROVED",
      });
    }

    // Evaluate policy: does this approval meet the threshold?
    const evaluation = evaluateApprovalPolicy({
      policy,
      existingDecisions,
      thisDisposition: approvalDisposition,
      assignments,
    });

    if (!evaluation.shouldAdvance) {
      // Policy threshold not yet met — keep the wait OPEN, emit progress.
      const progressMsg = approvalDisposition === "REQUEST_CHANGES"
        ? `Changes requested by ${getActorDisplayName(actor, resolvedBy)}. Run held for revision.${isPastDue ? " (Approval was past due.)" : ""}`
        : `${evaluation.approvedCount} of ${evaluation.requiredCount} required approvals received${isPastDue ? " (past due)" : ""}.`;

      await insertRunEvent(
        createRunEvent({
          capabilityId,
          runId,
          workItemId: detail.run.workItemId,
          runStepId: currentRunStep.id,
          traceId: detail.run.traceId,
          spanId: currentRunStep.spanId,
          type: "APPROVAL_PROGRESS",
          level: approvalDisposition === "REQUEST_CHANGES" ? "WARN" : "INFO",
          message: progressMsg,
          details: {
            waitId: openWait.id,
            approvedCount: evaluation.approvedCount,
            requiredCount: evaluation.requiredCount,
            mode: policy?.mode ?? "ANY_ONE",
            disposition: approvalDisposition,
            actorUserId: actor?.userId,
            isPastDue,
          },
        }),
      );
      // Return the current detail unchanged — run stays in WAITING_APPROVAL.
      return getWorkflowRunDetail(capabilityId, runId);
    }

    // Threshold met — close the wait and mark remaining PENDING assignments.
    await resolveRunWait({
      capabilityId,
      waitId: openWait.id,
      resolution,
      resolvedBy,
      resolvedByActorUserId: actor?.userId,
      resolvedByActorTeamIds: actorTeamIds,
    });
    // Any assignments still PENDING (other approvers who hadn't acted yet) are
    // closed as APPROVED since the threshold is satisfied.
    await updateApprovalAssignmentsForWait({
      capabilityId,
      waitId: openWait.id,
      status: "APPROVED",
    });
  } else {
    // Non-approval wait (INPUT, CONFLICT_RESOLUTION) — resolve immediately.
    await resolveRunWait({
      capabilityId,
      waitId: openWait.id,
      resolution,
      resolvedBy,
      resolvedByActorUserId: actor?.userId,
      resolvedByActorTeamIds: getActorTeamIds(actor),
    });
  }

  const isRequestChangesApproval =
    expectedType === "APPROVAL" && approvalDisposition === "REQUEST_CHANGES";
  const approvalAdvancesWorkflow =
    expectedType === "APPROVAL" &&
    !isRequestChangesApproval &&
    (currentStep.stepType === "HUMAN_APPROVAL" ||
      openWait.payload?.postStepApproval === true);
  const approvalCompletionSummary =
    typeof openWait.payload?.completionSummary === "string" &&
    openWait.payload.completionSummary.trim()
      ? openWait.payload.completionSummary.trim()
      : resolution;
  let nextRun = detail.run;
  let nextRunStep = currentRunStep;
  let nextWorkflowStep: WorkflowStep | undefined;

  if (approvalAdvancesWorkflow) {
    nextRunStep = await updateWorkflowRunStep({
      ...currentRunStep,
      status: "COMPLETED",
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
    if (transition.nextStep) {
      const queuedDispatch = await resolveQueuedRunDispatch({ capabilityId });
      nextRun = (
        await updateWorkflowRunControl(
          buildQueuedRunForExternalAdvance({
            run: transition.nextRun,
            queuedDispatch,
          }),
        )
      ).run;
    } else {
      nextRun = transition.nextRun;
    }
  } else {
    const queuedDispatch = await resolveQueuedRunDispatch({ capabilityId });
    nextRunStep = await updateWorkflowRunStep({
      ...currentRunStep,
      status: "PENDING",
      waitId: openWait.id,
      metadata: {
        ...(currentRunStep.metadata || {}),
        lastResolution: resolution,
      },
    });

    nextRun = (
      await updateWorkflowRun({
        ...detail.run,
        status: "QUEUED",
        queueReason: queuedDispatch.queueReason,
        assignedExecutorId: queuedDispatch.assignedExecutorId,
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
      type: "RUN_RESUMED",
      level: "INFO",
      message: resolution,
      details: {
        waitType: expectedType,
        resolvedBy,
        approvalDisposition:
          expectedType === "APPROVAL" ? approvalDisposition : undefined,
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
        type: "STEP_COMPLETED",
        level: "INFO",
        message: approvalCompletionSummary,
        details: {
          stage: "STEP_COMPLETED",
          stepName: currentStep.name,
          phase: currentStep.phase,
          approvedAfterWait: true,
        },
      }),
    );

    const generatedArtifactIds = Array.isArray(
      openWait.payload?.generatedArtifactIds,
    )
      ? openWait.payload.generatedArtifactIds.filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
      : [];
    const generatedArtifacts = generatedArtifactIds
      .map((artifactId) =>
        projection.workspace.artifacts.find(
          (artifact) => artifact.id === artifactId,
        ),
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
      ...generatedArtifacts.filter(
        (artifact) => artifact.artifactKind === "PHASE_OUTPUT",
      ),
      ...generatedArtifacts.filter(
        (artifact) => artifact.artifactKind !== "PHASE_OUTPUT",
      ),
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
      completeHumanOverride:
        typeof openWait.payload?.humanTaskWaitId === "string" &&
        openWait.payload.humanTaskWaitId.trim().length > 0,
    });

    return nextDetail;
  }

  const nextArtifacts = replaceArtifacts(projection.workspace.artifacts, [
    interactionArtifact,
  ]);
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    pendingRequest: undefined,
    blocker: undefined,
    status: "ACTIVE",
    activeRunId: nextRun.id,
    lastRunId: nextRun.id,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        resolvedBy,
        isRequestChangesApproval
          ? "Changes requested"
          : expectedType === "CONFLICT_RESOLUTION"
            ? "Conflict resolved"
            : "Human input provided",
        resolution,
        projection.workItem.phase,
        "ACTIVE",
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
        expectedType === "APPROVAL" ? approvalDisposition : undefined,
      artifactId: interactionArtifact.id,
    },
  });
  const learningTriggerType =
    expectedType === "CONFLICT_RESOLUTION"
      ? ("CONFLICT_RESOLUTION" as const)
      : isRequestChangesApproval
        ? ("REQUEST_CHANGES" as const)
        : null;
  const nextLearningUpdates = learningTriggerType
    ? buildTargetedLearningUpdates({
        workspace: projection.workspace,
        capabilityId,
        focusedAgentId: currentStep.agentId,
        insight:
          learningTriggerType === "REQUEST_CHANGES"
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
    expectedType: "APPROVAL",
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
  const openWait = [...detail.waits]
    .reverse()
    .find((wait) => wait.status === "OPEN");
  if (
    !openWait ||
    openWait.type !== "APPROVAL" ||
    openWait.payload?.postStepApproval !== true
  ) {
    throw new Error(
      "Changes can only be requested for an open code diff approval wait.",
    );
  }

  return resolveRunWaitAndQueue({
    capabilityId,
    runId,
    expectedType: "APPROVAL",
    resolution,
    resolvedBy,
    approvalDisposition: "REQUEST_CHANGES",
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
    expectedType: "INPUT",
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
    expectedType: "CONFLICT_RESOLUTION",
    resolution,
    resolvedBy,
    actor,
  });

export const delegateWorkflowRunToHuman = async ({
  capabilityId,
  runId,
  instructions,
  checklist,
  assigneeUserId,
  assigneeRole,
  approvalPolicy,
  note,
  delegatedBy,
  actor,
}: {
  capabilityId: string;
  runId: string;
  instructions: string;
  checklist?: string[];
  assigneeUserId?: string;
  assigneeRole?: string;
  approvalPolicy?: ApprovalPolicy;
  note?: string;
  delegatedBy: string;
  actor?: ActorContext;
}) => {
  const detail = await getWorkflowRunDetail(capabilityId, runId);
  if (
    detail.run.status === "CANCELLED" ||
    detail.run.status === "COMPLETED" ||
    detail.run.status === "FAILED"
  ) {
    throw new Error("Only active workflow runs can be delegated to a human.");
  }
  if (detail.run.status === "WAITING_HUMAN_TASK") {
    throw new Error("This run is already waiting on a delegated human task.");
  }

  const projection = await resolveProjectionContext(
    capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  if (!canActorOperateWorkItem({ actor, workItem: projection.workItem })) {
    throw new Error("Only the current phase owner can delegate this workflow stage.");
  }

  const currentStep = getCurrentWorkflowStep(detail);
  const currentRunStep = getCurrentRunStep(detail);
  const trimmedInstructions = instructions.trim();
  if (!trimmedInstructions) {
    throw new Error("Add human instructions before delegating this stage.");
  }

  const effectiveApprovalPolicy = currentStep.approvalPolicy || approvalPolicy;
  if (
    !currentStep.approvalPolicy &&
    (!effectiveApprovalPolicy || effectiveApprovalPolicy.targets.length === 0)
  ) {
    throw new Error(
      "Delegating a stage without an existing approval policy requires explicit approver targets.",
    );
  }

  const openWait = [...detail.waits].reverse().find(wait => wait.status === "OPEN");
  if (openWait) {
    await resolveRunWait({
      capabilityId,
      waitId: openWait.id,
      resolution: `Superseded by delegated human task. ${note?.trim() || trimmedInstructions}`,
      resolvedBy: delegatedBy,
      resolvedByActorUserId: actor?.userId,
      resolvedByActorTeamIds: getActorTeamIds(actor),
    });
    if (openWait.type === "APPROVAL" && (openWait.approvalAssignments || []).length > 0) {
      await updateApprovalAssignmentsForWait({
        capabilityId,
        waitId: openWait.id,
        status: "CANCELLED",
      });
    }
  }

  const updatedRunStep = await updateWorkflowRunStep({
    ...currentRunStep,
    status: "WAITING",
    metadata: {
      ...(currentRunStep.metadata || {}),
      delegatedHumanTask: {
        delegatedAt: new Date().toISOString(),
        delegatedBy,
        delegatedByUserId: actor?.userId,
        instructions: trimmedInstructions,
        checklist: checklist || [],
        assigneeUserId: assigneeUserId || undefined,
        assigneeRole: assigneeRole || undefined,
        note: note?.trim() || undefined,
      },
    },
  });

  await insertRunEvent(
    createRunEvent({
      capabilityId,
      runId,
      workItemId: detail.run.workItemId,
      runStepId: currentRunStep.id,
      traceId: detail.run.traceId,
      spanId: currentRunStep.spanId,
      type: "STEP_DELEGATED_TO_HUMAN",
      level: "INFO",
      message: `${currentStep.name} was delegated to a human.`,
      details: {
        instructions: trimmedInstructions,
        assigneeUserId: assigneeUserId || null,
        assigneeRole: assigneeRole || null,
      },
    }),
  );

  const waitDetail = await completeRunWithWait({
    detail,
    waitType: "HUMAN_TASK",
    waitMessage: trimmedInstructions,
    waitPayload: {
      checklist: checklist || [],
      assigneeUserId: assigneeUserId || undefined,
      assigneeRole: assigneeRole || undefined,
      approvalPolicy: effectiveApprovalPolicy,
      operatorNote: note?.trim() || undefined,
      delegatedBy,
    },
    runStepOverride: updatedRunStep,
  });

  await persistWorkItemStageOverride({
    capabilityId,
    workItemId: detail.run.workItemId,
    workflowOverride: detail.run.workflowSnapshot,
    mutate: (workItem) =>
      replaceWorkItemStageOverride(workItem, {
        workflowStepId: currentStep.id,
        ownerType: "HUMAN",
        status: "ACTIVE",
        instructions: trimmedInstructions,
        checklist: normalizeHumanChecklist(checklist),
        assigneeUserId: assigneeUserId || undefined,
        assigneeRole: assigneeRole || undefined,
        approvalPolicy: effectiveApprovalPolicy,
        requestedBy: delegatedBy,
        requestedAt:
          getWorkItemStageOverride(workItem, currentStep.id)?.requestedAt ||
          new Date().toISOString(),
      }),
  });

  return waitDetail;
};

export const completeWorkflowRunHumanTask = async ({
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
  const projection = await resolveProjectionContext(
    capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  if (!canActorOperateWorkItem({ actor, workItem: projection.workItem })) {
    throw new Error("Only the current phase owner can mark this human task done.");
  }

  const openWait = [...detail.waits]
    .reverse()
    .find(wait => wait.status === "OPEN" && wait.type === "HUMAN_TASK");
  if (!openWait) {
    throw new Error(`Run ${runId} does not have an open delegated human task.`);
  }

  const currentStep = getCurrentWorkflowStep(detail);
  const currentRunStep = getCurrentRunStep(detail);
  const effectiveApprovalPolicy =
    (openWait.payload?.approvalPolicy as ApprovalPolicy | undefined) ||
    currentStep.approvalPolicy;
  if (!effectiveApprovalPolicy || effectiveApprovalPolicy.targets.length === 0) {
    throw new Error(
      "This delegated human task cannot be completed without an approval configuration.",
    );
  }

  const trimmedResolution = resolution.trim();
  if (!trimmedResolution) {
    throw new Error("Add a completion summary before marking the human task done.");
  }

  const resolvedWait = await resolveRunWait({
    capabilityId,
    waitId: openWait.id,
    resolution: trimmedResolution,
    resolvedBy,
    resolvedByActorUserId: actor?.userId,
    resolvedByActorTeamIds: getActorTeamIds(actor),
  });

  const humanTaskArtifact = buildHumanInteractionArtifact({
    detail,
    workItem: projection.workItem,
    lifecycle: projection.capability.lifecycle,
    step: currentStep,
    runStep: currentRunStep,
    wait: resolvedWait,
    resolution: trimmedResolution,
    resolvedBy,
  });

  const updatedRunStep = await updateWorkflowRunStep({
    ...currentRunStep,
    status: "WAITING",
    metadata: {
      ...(currentRunStep.metadata || {}),
      delegatedHumanTask: {
        ...((currentRunStep.metadata?.delegatedHumanTask as Record<string, unknown>) || {}),
        completedAt: new Date().toISOString(),
        completedBy: resolvedBy,
        completionSummary: trimmedResolution,
      },
    },
  });

  await insertRunEvent(
    createRunEvent({
      capabilityId,
      runId,
      workItemId: detail.run.workItemId,
      runStepId: currentRunStep.id,
      traceId: detail.run.traceId,
      spanId: currentRunStep.spanId,
      type: "HUMAN_TASK_COMPLETED",
      level: "INFO",
      message: `${currentStep.name} was marked complete by a human and is waiting for approval.`,
      details: {
        waitId: openWait.id,
        resolution: trimmedResolution,
      },
    }),
  );

  const approvalDetail = await completeRunWithWait({
    detail,
    waitType: "APPROVAL",
    waitMessage: `${currentStep.name} is waiting for approval after human completion.`,
    waitPayload: {
      postStepApproval: true,
      completionSummary: trimmedResolution,
      generatedArtifactIds: [humanTaskArtifact.id],
      humanTaskWaitId: openWait.id,
      approvalPolicy: effectiveApprovalPolicy,
    },
    artifacts: [humanTaskArtifact],
    runStepOverride: updatedRunStep,
    approvalPolicyOverride: effectiveApprovalPolicy,
  });

  await persistWorkItemStageOverride({
    capabilityId,
    workItemId: detail.run.workItemId,
    workflowOverride: detail.run.workflowSnapshot,
    mutate: (workItem) =>
      updateWorkItemStageOverrideStatus({
        workItem,
        workflowStepId: currentStep.id,
        status: "ACTIVE",
        completedBy: resolvedBy,
        completedAt: new Date().toISOString(),
        completionSummary: trimmedResolution,
      }),
  });

  return approvalDetail;
};

export const setWorkItemStageOwner = async ({
  capabilityId,
  workItemId,
  workflowStepId,
  ownerType,
  instructions,
  checklist,
  assigneeUserId,
  assigneeRole,
  approvalPolicy,
  note,
  requestedBy,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  workflowStepId: string;
  ownerType: "AGENT" | "HUMAN";
  instructions?: string;
  checklist?: string[];
  assigneeUserId?: string;
  assigneeRole?: string;
  approvalPolicy?: ApprovalPolicy;
  note?: string;
  requestedBy: string;
  actor?: ActorContext;
}) => {
  const projection = await resolveProjectionContext(capabilityId, workItemId);
  if (!canActorOperateWorkItem({ actor, workItem: projection.workItem })) {
    throw new Error("Only the current phase owner can change this stage owner.");
  }

  const step = projection.workflow.steps.find((item) => item.id === workflowStepId);
  if (!step) {
    throw new Error(`Workflow step ${workflowStepId} was not found.`);
  }

  const existingOverride = getWorkItemStageOverride(
    projection.workItem,
    workflowStepId,
  );
  const activeRun = projection.workItem.activeRunId
    ? await getWorkflowRunDetail(
        capabilityId,
        projection.workItem.activeRunId,
      ).catch(() => null)
    : null;
  const activeStepId = activeRun
    ? (() => {
        try {
          return getCurrentWorkflowStep(activeRun).id;
        } catch {
          return undefined;
        }
      })()
    : undefined;

  if (ownerType === "AGENT") {
    if (
      activeRun &&
      activeStepId === workflowStepId &&
      activeRun.run.status === "WAITING_HUMAN_TASK"
    ) {
      throw new Error(
        "This stage is already waiting on human completion. Mark it done or cancel the run before returning it to the agent.",
      );
    }
    if (
      !existingOverride ||
      existingOverride.ownerType !== "HUMAN" ||
      existingOverride.status !== "PENDING"
    ) {
      throw new Error(
        "Only pending human stage assignments can be returned to the agent before the stage starts.",
      );
    }

    const detailMessage =
      note?.trim() || `${step.name} will return to agent ownership.`;
    const nextWorkItem: WorkItem = {
      ...projection.workItem,
      stageOverrides: [
        ...(projection.workItem.stageOverrides || []).filter(
          (override) => override.workflowStepId !== workflowStepId,
        ),
        {
          ...existingOverride,
          status: "CANCELLED",
        },
      ],
      history: [
        ...projection.workItem.history,
        createHistoryEntry(
          requestedBy,
          "Stage returned to agent",
          detailMessage,
          step.phase,
          projection.workItem.status,
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
          agentId: step.agentId,
          message: detailMessage,
          metadata: {
            interactionType: "STAGE_OWNER_OVERRIDE",
            workflowStepId,
            ownerType: "AGENT",
          },
        }),
      ],
    });

    return nextWorkItem;
  }

  const trimmedInstructions = String(instructions || "").trim();
  if (!trimmedInstructions) {
    throw new Error("Add human instructions before assigning this stage.");
  }

  const effectiveApprovalPolicy = step.approvalPolicy || approvalPolicy;
  if (!effectiveApprovalPolicy || effectiveApprovalPolicy.targets.length === 0) {
    throw new Error(
      "Assigning a stage to a human requires an approval owner for the return gate.",
    );
  }

  const normalizedChecklist = normalizeHumanChecklist(checklist);

  if (
    activeRun &&
    activeStepId === workflowStepId &&
    ACTIVE_WORKFLOW_RUN_STATUSES.has(activeRun.run.status)
  ) {
    if (activeRun.run.status === "WAITING_HUMAN_TASK") {
      throw new Error(
        "This stage is already waiting on human completion.",
      );
    }
    await delegateWorkflowRunToHuman({
      capabilityId,
      runId: activeRun.run.id,
      instructions: trimmedInstructions,
      checklist: normalizedChecklist,
      assigneeUserId,
      assigneeRole,
      approvalPolicy: effectiveApprovalPolicy,
      note: note?.trim() || `Delegated from ${step.name}`,
      delegatedBy: requestedBy,
      actor,
    });
    const updatedProjection = await resolveProjectionContext(
      capabilityId,
      workItemId,
      activeRun.run.workflowSnapshot,
    );
    return updatedProjection.workItem;
  }

  const nextOverride: WorkItemStageOverride = {
    workflowStepId,
    ownerType: "HUMAN",
    status: "PENDING",
    instructions: trimmedInstructions,
    checklist: normalizedChecklist,
    assigneeUserId: assigneeUserId || undefined,
    assigneeRole: assigneeRole || undefined,
    approvalPolicy: effectiveApprovalPolicy,
    requestedBy,
    requestedAt: existingOverride?.requestedAt || new Date().toISOString(),
  };
  const detailMessage =
    note?.trim() ||
    `${step.name} will pause for human completion when execution reaches it.`;
  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    stageOverrides: [
      ...(projection.workItem.stageOverrides || []).filter(
        (override) => override.workflowStepId !== workflowStepId,
      ),
      nextOverride,
    ],
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        requestedBy,
        "Stage assigned to human",
        detailMessage,
        step.phase,
        projection.workItem.status,
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
        agentId: step.agentId,
        message: detailMessage,
        metadata: {
          interactionType: "STAGE_OWNER_OVERRIDE",
          workflowStepId,
          ownerType: "HUMAN",
          overrideStatus: "PENDING",
        },
      }),
    ],
  });

  return nextWorkItem;
};

export const completeWorkItemHumanStage = async ({
  capabilityId,
  workItemId,
  workflowStepId,
  resolution,
  resolvedBy,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  workflowStepId: string;
  resolution: string;
  resolvedBy: string;
  actor?: ActorContext;
}) => {
  const projection = await resolveProjectionContext(capabilityId, workItemId);
  if (!canActorOperateWorkItem({ actor, workItem: projection.workItem })) {
    throw new Error("Only the current phase owner can mark this human stage done.");
  }

  const stageOverride = getWorkItemStageOverride(
    projection.workItem,
    workflowStepId,
  );
  if (
    !stageOverride ||
    stageOverride.ownerType !== "HUMAN" ||
    stageOverride.status === "CANCELLED" ||
    stageOverride.status === "COMPLETED"
  ) {
    throw new Error("This workflow step is not currently assigned to a human.");
  }

  if (!projection.workItem.activeRunId) {
    throw new Error(
      "This human-owned stage cannot be completed until execution reaches it.",
    );
  }

  const detail = await getWorkflowRunDetail(
    capabilityId,
    projection.workItem.activeRunId,
  );
  const currentStep = getCurrentWorkflowStep(detail);
  if (currentStep.id !== workflowStepId) {
    throw new Error(
      "Only the current reachable human-owned stage can be marked complete.",
    );
  }

  const openWait = [...detail.waits]
    .reverse()
    .find((wait) => wait.status === "OPEN" && wait.type === "HUMAN_TASK");
  if (!openWait) {
    throw new Error(
      "This stage is not currently waiting on human completion.",
    );
  }

  return completeWorkflowRunHumanTask({
    capabilityId,
    runId: detail.run.id,
    resolution,
    resolvedBy,
    actor,
  });
};

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
    status: "CANCELLED",
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    terminalOutcome: note || "Run cancelled by user.",
    completedAt: new Date().toISOString(),
    currentWaitId: undefined,
  });
  await releaseRunLease({ capabilityId, runId });

  const projection = await resolveProjectionContext(
    capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  const nextWorkItemStatus: WorkItemStatus =
    projection.workItem.status === "COMPLETED" ||
    projection.workItem.status === "CANCELLED"
      ? projection.workItem.status
      : "ACTIVE";
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
        "User",
        "Run cancelled",
        note || "Run cancelled by user.",
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
        agentId: projection.workItem.assignedAgentId || "SYSTEM",
        message: note || "Run cancelled by user.",
        level: "WARN",
        runId,
        traceId: detail.run.traceId,
      }),
    ],
  });

  return getWorkflowRunDetail(capabilityId, runId);
};

const getRunStatusForWaitType = (
  waitType: RunWaitType,
): WorkflowRun["status"] => {
  if (waitType === "APPROVAL") {
    return "WAITING_APPROVAL";
  }
  if (waitType === "HUMAN_TASK") {
    return "WAITING_HUMAN_TASK";
  }
  if (waitType === "INPUT") {
    return "WAITING_INPUT";
  }
  return "WAITING_CONFLICT";
};

const getWorkItemStatusForWaitType = (waitType: RunWaitType): WorkItemStatus =>
  waitType === "APPROVAL" ? "PENDING_APPROVAL" : "BLOCKED";

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
    detail.run.status === "CANCELLED" ||
    detail.run.status === "COMPLETED" ||
    detail.run.status === "FAILED"
  ) {
    return detail;
  }
  if (detail.run.status === "PAUSED") {
    return detail;
  }

  const actorName = getActorDisplayName(actor, "User");
  const pauseNote = note?.trim() || "Execution paused by user.";

  await updateWorkflowRunControl({
    ...detail.run,
    status: "PAUSED",
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
    status: "PAUSED",
    recordVersion: (projection.workItem.recordVersion || 1) + 1,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        actorName,
        "Execution paused",
        pauseNote,
        projection.workItem.phase,
        "PAUSED",
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
        agentId: projection.workItem.assignedAgentId || "SYSTEM",
        message: pauseNote,
        level: "WARN",
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
  if (detail.run.status !== "PAUSED") {
    return detail;
  }

  const actorName = getActorDisplayName(actor, "User");
  const resumeNote = note?.trim() || "Execution resumed by user.";
  const openWait =
    [...detail.waits].reverse().find((wait) => wait.status === "OPEN") || null;

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
          "Execution resumed",
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
          agentId: projection.workItem.assignedAgentId || "SYSTEM",
          message: resumeNote,
          level: "INFO",
          runId,
          traceId: detail.run.traceId,
        }),
      ],
    });

    return getWorkflowRunDetail(capabilityId, runId);
  }

  const queuedDispatch = await resolveQueuedRunDispatch({ capabilityId });
  await updateWorkflowRunControl({
    ...detail.run,
    status: "QUEUED",
    queueReason: queuedDispatch.queueReason,
    assignedExecutorId: queuedDispatch.assignedExecutorId,
    pauseReason: undefined,
    currentWaitId: undefined,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
  });

  const nextWorkItem: WorkItem = {
    ...projection.workItem,
    status: "ACTIVE",
    pendingRequest: undefined,
    blocker: undefined,
    recordVersion: (projection.workItem.recordVersion || 1) + 1,
    history: [
      ...projection.workItem.history,
      createHistoryEntry(
        actorName,
        "Execution resumed",
        resumeNote,
        projection.workItem.phase,
        "ACTIVE",
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
        agentId: projection.workItem.assignedAgentId || "SYSTEM",
        message: resumeNote,
        level: "INFO",
        runId,
        traceId: detail.run.traceId,
      }),
    ],
  });

  return getWorkflowRunDetail(capabilityId, runId);
};

const purgeWorkItemDataTx = async (
  client: PoolClient,
  params: { capabilityId: string; workItemId: string },
) => {
  const [runsResult, tasksResult, artifactsResult] = await Promise.all([
    client.query<{ id: string }>(
      `
        SELECT id
        FROM capability_workflow_runs
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
    client.query<{ id: string }>(
      `
        SELECT id
        FROM capability_tasks
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
    client.query<{ id: string }>(
      `
        SELECT id
        FROM capability_artifacts
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
  ]);

  const runIds = runsResult.rows.map((row) => row.id);
  const taskIds = tasksResult.rows.map((row) => row.id);
  const artifactIds = artifactsResult.rows.map((row) => row.id);

  if (artifactIds.length > 0) {
    await client.query(
      `
        DELETE FROM capability_artifact_files
        WHERE capability_id = $1 AND artifact_id = ANY($2::text[])
      `,
      [params.capabilityId, artifactIds],
    );
  }

  await client.query(
    `
      DELETE FROM capability_artifacts
      WHERE capability_id = $1 AND work_item_id = $2
    `,
    [params.capabilityId, params.workItemId],
  );

  await client.query(
    `
      DELETE FROM capability_tasks
      WHERE capability_id = $1 AND work_item_id = $2
    `,
    [params.capabilityId, params.workItemId],
  );

  await client.query(
    `
      DELETE FROM capability_evidence_packets
      WHERE capability_id = $1 AND work_item_id = $2
    `,
    [params.capabilityId, params.workItemId],
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
    [params.capabilityId, params.workItemId, taskIds, runIds],
  );

  await client.query(
    `
      DELETE FROM capability_learning_updates
      WHERE capability_id = $1 AND related_work_item_id = $2
    `,
    [params.capabilityId, params.workItemId],
  );

  await client.query(
    `
      DELETE FROM capability_messages
      WHERE capability_id = $1 AND work_item_id = $2
    `,
    [params.capabilityId, params.workItemId],
  );

  await Promise.all([
    client.query(
      `
        DELETE FROM capability_work_item_repository_assignments
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
    client.query(
      `
        DELETE FROM capability_work_item_branches
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
    client.query(
      `
        DELETE FROM capability_work_item_code_claims
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
    client.query(
      `
        DELETE FROM desktop_work_item_checkout_sessions
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
    client.query(
      `
        DELETE FROM capability_work_item_handoff_packets
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
    client.query(
      `
        DELETE FROM capability_work_item_claims
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
    client.query(
      `
        DELETE FROM capability_work_item_presence
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
    client.query(
      `
        DELETE FROM capability_ownership_transfers
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
    client.query(
      `
        DELETE FROM capability_phase_handoffs
        WHERE capability_id = $1 AND work_item_id = $2
      `,
      [params.capabilityId, params.workItemId],
    ),
  ]);

  if (runIds.length > 0) {
    await Promise.all([
      client.query(
        `
          DELETE FROM capability_approval_assignments
          WHERE capability_id = $1 AND run_id = ANY($2::text[])
        `,
        [params.capabilityId, runIds],
      ),
      client.query(
        `
          DELETE FROM capability_approval_decisions
          WHERE capability_id = $1 AND run_id = ANY($2::text[])
        `,
        [params.capabilityId, runIds],
      ),
    ]);
  }

  await client.query(
    `
      DELETE FROM capability_workflow_runs
      WHERE capability_id = $1 AND work_item_id = $2
    `,
    [params.capabilityId, params.workItemId],
  );

  return { runIds };
};

const buildEntryStepResetWorkItemState = ({
  workItem,
  capability,
  workflow,
  actor,
  note,
  actionTitle,
  claimMessage,
}: {
  workItem: WorkItem;
  capability: Capability;
  workflow: Workflow;
  actor?: ActorContext;
  note: string;
  actionTitle: string;
  claimMessage: string;
}) => {
  const normalizedTaskType = normalizeWorkItemTaskType(workItem.taskType);
  const firstStep = resolveWorkItemEntryStep(
    workflow,
    normalizedTaskType,
    capability.lifecycle,
  );
  if (!firstStep) {
    throw new Error(
      `Workflow ${workflow.name} does not define any executable nodes.`,
    );
  }

  const phaseOwnerTeamId = resolveWorkItemPhaseOwnerTeamId({
    capability,
    phaseId: firstStep.phase,
    step: firstStep,
  });
  const actorName = getActorDisplayName(actor, "User");
  const shouldClaim = Boolean(actor?.userId);
  const nextStatus = getPreExecutionStepStatus(firstStep);

  const nextWorkItem: WorkItem = {
    ...workItem,
    taskType: normalizedTaskType,
    phase: firstStep.phase,
    phaseOwnerTeamId,
    claimOwnerUserId: shouldClaim ? actor?.userId : undefined,
    watchedByUserIds: shouldClaim && actor?.userId ? [actor.userId] : [],
    workflowId: workItem.workflowId,
    currentStepId: firstStep.id,
    assignedAgentId: firstStep.agentId,
    status: nextStatus,
    pendingRequest: undefined,
    blocker: undefined,
    pendingHandoff: undefined,
    activeRunId: undefined,
    lastRunId: undefined,
    executionContext: undefined,
    recordVersion: (workItem.recordVersion || 1) + 1,
    history: [
      createHistoryEntry(
        actorName,
        actionTitle,
        note,
        firstStep.phase,
        nextStatus,
      ),
      ...(shouldClaim
        ? [
            createHistoryEntry(
              actorName,
              "Operator control claimed",
              claimMessage,
              firstStep.phase,
              nextStatus,
            ),
          ]
        : []),
    ],
  };

  return {
    nextWorkItem,
    firstStep,
    shouldClaim,
  };
};

export const __executionControlTestUtils = {
  purgeWorkItemDataTx,
  buildEntryStepResetWorkItemState,
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
  const actorName = getActorDisplayName(actor, "User");
  const resetNote =
    note?.trim() || "Work item reset to the workflow entry step by user.";

  const activeRun = await getActiveRunForWorkItem(capabilityId, workItemId);
  if (activeRun) {
    await cancelWorkflowRun({
      capabilityId,
      runId: activeRun.id,
      note: resetNote,
    });
  }

  const activeClaims = await listActiveWorkItemClaims(capabilityId, workItemId);
  await Promise.all(
    activeClaims.map((claim) =>
      releaseWorkItemClaim({
        capabilityId,
        workItemId: claim.workItemId,
        userId: claim.userId,
      }),
    ),
  );

  await Promise.all([
    releaseWorkItemCodeClaimRecord({
      capabilityId,
      workItemId,
      claimType: "WRITE",
    }),
    releaseWorkItemCodeClaimRecord({
      capabilityId,
      workItemId,
      claimType: "REVIEW",
    }),
  ]);

  const projection = await resolveProjectionContext(capabilityId, workItemId);
  const { nextWorkItem, shouldClaim } = buildEntryStepResetWorkItemState({
    workItem: projection.workItem,
    capability: projection.capability,
    workflow: projection.workflow,
    actor,
    note: resetNote,
    actionTitle: "Work item reset",
    claimMessage: `${actorName} claimed operator control while resetting the work item.`,
  });

  await transaction(async (client) => {
    await purgeWorkItemDataTx(client, { capabilityId, workItemId });

    await client.query(
      `
        UPDATE capability_work_items
        SET
          phase = $3,
          phase_owner_team_id = $4,
          claim_owner_user_id = $5,
          watched_by_user_ids = $6,
          pending_handoff = NULL,
          current_step_id = $7,
          assigned_agent_id = $8,
          status = $9,
          pending_request = NULL,
          blocker = NULL,
          active_run_id = NULL,
          last_run_id = NULL,
          history = $10::jsonb,
          record_version = record_version + 1,
          updated_at = NOW()
        WHERE capability_id = $1 AND id = $2
      `,
      [
        capabilityId,
        workItemId,
        nextWorkItem.phase,
        nextWorkItem.phaseOwnerTeamId || null,
        nextWorkItem.claimOwnerUserId || null,
        nextWorkItem.watchedByUserIds || [],
        nextWorkItem.currentStepId || null,
        nextWorkItem.assignedAgentId || null,
        nextWorkItem.status,
        JSON.stringify(nextWorkItem.history),
      ],
    );
  });

  if (shouldClaim && actor?.userId) {
    await upsertWorkItemClaim({
      capabilityId,
      workItemId,
      userId: actor.userId,
      teamId: getActorTeamIds(actor)[0],
      status: "ACTIVE",
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  }

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
  const actorName = getActorDisplayName(actor, "User");
  const archiveNote = note?.trim() || "Work item archived by user.";

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
    activeClaims.map((claim) =>
      releaseWorkItemClaim({
        capabilityId,
        workItemId: claim.workItemId,
        userId: claim.userId,
      }),
    ),
  );

  await Promise.all([
    releaseWorkItemCodeClaimRecord({
      capabilityId,
      workItemId,
      claimType: "WRITE",
    }),
    releaseWorkItemCodeClaimRecord({
      capabilityId,
      workItemId,
      claimType: "REVIEW",
    }),
  ]);

  const projection = await resolveProjectionContext(capabilityId, workItemId);
  const archivedEntry = createHistoryEntry(
    actorName,
    "Work item archived",
    archiveNote,
    projection.workItem.phase,
    "ARCHIVED",
  );

  await transaction(async (client) => {
    await purgeWorkItemDataTx(client, { capabilityId, workItemId });

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
      [capabilityId, workItemId, "ARCHIVED", JSON.stringify([archivedEntry])],
    );
  });

  await refreshCapabilityMemory(capabilityId).catch(() => undefined);

  return {
    ...projection.workItem,
    status: "ARCHIVED",
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
    executionContext: undefined,
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
  if (projection.workItem.status !== "ARCHIVED") {
    throw new Error(`Work item ${workItemId} is not archived.`);
  }

  const workflow = projection.workflow;
  const restoreNote = note?.trim() || "Work item restored from archive.";
  const actorName = getActorDisplayName(actor, "User");
  const { nextWorkItem, firstStep, shouldClaim } =
    buildEntryStepResetWorkItemState({
      workItem: projection.workItem,
      capability: projection.capability,
      workflow,
      actor,
      note: restoreNote,
      actionTitle: "Work item restored",
      claimMessage: `${actorName} reclaimed operator control while restoring the work item.`,
    });

  if (shouldClaim && actor?.userId) {
    await upsertWorkItemClaim({
      capabilityId,
      workItemId,
      userId: actor.userId,
      teamId: actor.teamIds?.[0],
      status: "ACTIVE",
      claimedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
  }

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
        level: "INFO",
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
  stopAfterPhase,
  intention,
  segmentId,
}: {
  capabilityId: string;
  runId: string;
  restartFromPhase?: WorkItemPhase;
  guidance?: string;
  guidedBy?: string;
  actor?: ActorContext;
  stopAfterPhase?: WorkItemPhase;
  intention?: string;
  segmentId?: string;
}) => {
  const latest = await getWorkflowRunDetail(capabilityId, runId);
  return startWorkflowExecution({
    capabilityId,
    workItemId: latest.run.workItemId,
    restartFromPhase:
      restartFromPhase ||
      latest.run.restartFromPhase ||
      latest.run.currentPhase,
    guidance,
    guidedBy,
    actor,
    stopAfterPhase,
    intention,
    segmentId,
  });
};

// ---------------------------------------------------------------------
// Phase-segment work-item helpers
// ---------------------------------------------------------------------

/**
 * Start a new segment for a work item. This is the public entry point
 * used by the new `POST /work-items/:wiId/segments` endpoint. When
 * `saveAsPreset` is true, the start/stop/intention are also persisted
 * to `capability_work_items.next_segment_preset` so the inbox can
 * render a one-click "Start next" button next time.
 */
export const startWorkItemSegment = async ({
  capabilityId,
  workItemId,
  startPhase,
  stopAfterPhase,
  intention,
  saveAsPreset,
  guidance,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  startPhase?: WorkItemPhase;
  stopAfterPhase?: WorkItemPhase;
  intention: string;
  saveAsPreset?: boolean;
  guidance?: string;
  actor?: ActorContext;
}) => {
  const trimmed = intention?.trim();
  if (!trimmed) {
    throw new Error("Segment intention is required.");
  }

  if (saveAsPreset) {
    const preset = {
      startPhase: startPhase || null,
      stopAfterPhase: stopAfterPhase || null,
      intention: trimmed,
    };
    await transaction(async (client) => {
      await client.query(
        `UPDATE capability_work_items
         SET next_segment_preset = $3::jsonb, updated_at = NOW()
         WHERE capability_id = $1 AND id = $2`,
        [capabilityId, workItemId, JSON.stringify(preset)],
      );
    });
  }

  return startWorkflowExecution({
    capabilityId,
    workItemId,
    restartFromPhase: startPhase,
    stopAfterPhase,
    intention: trimmed,
    guidance,
    guidedBy: actor ? getActorDisplayName(actor, "Capability Owner") : undefined,
    actor,
  });
};

/**
 * Retry a FAILED or CANCELLED segment. A new run is created under the
 * same segment row so the intention and phase range are preserved.
 */
export const retryWorkItemSegment = async ({
  capabilityId,
  segmentId,
  actor,
}: {
  capabilityId: string;
  segmentId: string;
  actor?: ActorContext;
}) => {
  const segment = await getSegmentById({ capabilityId, segmentId });
  if (!segment) {
    throw new Error(`Segment ${segmentId} not found.`);
  }
  return startWorkflowExecution({
    capabilityId,
    workItemId: segment.workItemId,
    restartFromPhase: segment.startPhase,
    stopAfterPhase: segment.stopAfterPhase,
    // intention is inherited from the segment row; passing undefined
    // causes startWorkflowExecution to use the segmentId path (retry)
    // rather than creating a fresh segment.
    intention: undefined,
    segmentId,
    guidedBy: actor ? getActorDisplayName(actor, "Capability Owner") : undefined,
    actor,
  });
};

/**
 * Kick off the next segment using the work item's saved preset. 409-eq
 * if no preset is set or a run is already active.
 */
export const startNextSegmentFromPreset = async ({
  capabilityId,
  workItemId,
  actor,
}: {
  capabilityId: string;
  workItemId: string;
  actor?: ActorContext;
}) => {
  const result = await transaction(async (client) =>
    client.query(
      `SELECT next_segment_preset, active_run_id, phase
       FROM capability_work_items
       WHERE capability_id = $1 AND id = $2
       LIMIT 1`,
      [capabilityId, workItemId],
    ),
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Work item ${workItemId} not found.`);
  }
  if (row.active_run_id) {
    throw new Error(`Work item ${workItemId} already has an active run.`);
  }
  const preset = row.next_segment_preset as
    | { startPhase?: string | null; stopAfterPhase?: string | null; intention?: string }
    | null;
  if (!preset || !preset.intention) {
    throw new Error(
      `Work item ${workItemId} has no saved "start next" preset. Use the Start Segment dialog instead.`,
    );
  }

  return startWorkflowExecution({
    capabilityId,
    workItemId,
    restartFromPhase: (preset.startPhase || row.phase) as WorkItemPhase,
    stopAfterPhase: (preset.stopAfterPhase || undefined) as
      | WorkItemPhase
      | undefined,
    intention: preset.intention,
    guidedBy: actor ? getActorDisplayName(actor, "Capability Owner") : undefined,
    actor,
  });
};

export const listWorkItemSegments = async ({
  capabilityId,
  workItemId,
}: {
  capabilityId: string;
  workItemId: string;
}) => listSegmentsForWorkItem({ capabilityId, workItemId });

export const updateWorkItemBrief = async ({
  capabilityId,
  workItemId,
  brief,
}: {
  capabilityId: string;
  workItemId: string;
  brief: string | null;
}) => {
  const trimmed = brief == null ? null : String(brief).trim() || null;
  await transaction(async (client) => {
    await client.query(
      `UPDATE capability_work_items
       SET brief = $3, updated_at = NOW()
       WHERE capability_id = $1 AND id = $2`,
      [capabilityId, workItemId, trimmed],
    );
  });
  return { brief: trimmed };
};

export const updateWorkItemNextSegmentPreset = async ({
  capabilityId,
  workItemId,
  preset,
}: {
  capabilityId: string;
  workItemId: string;
  preset: {
    startPhase?: string | null;
    stopAfterPhase?: string | null;
    intention?: string;
  } | null;
}) => {
  const serialized =
    preset && preset.intention
      ? JSON.stringify({
          startPhase: preset.startPhase || null,
          stopAfterPhase: preset.stopAfterPhase || null,
          intention: String(preset.intention).trim(),
        })
      : null;
  await transaction(async (client) => {
    await client.query(
      `UPDATE capability_work_items
       SET next_segment_preset = $3::jsonb, updated_at = NOW()
       WHERE capability_id = $1 AND id = $2`,
      [capabilityId, workItemId, serialized],
    );
  });
  return { preset: serialized ? JSON.parse(serialized) : null };
};

/**
 * Called from wherever a work item's priority changes so the claim SQL
 * sees the new value on already-queued segments/runs.
 */
export const propagateWorkItemPriorityChange = propagatePriorityChange;

const completeRunWithWait = async ({
  detail,
  waitType,
  waitMessage,
  waitPayload,
  artifacts,
  runStepOverride,
  approvalPolicyOverride,
}: {
  detail: WorkflowRunDetail;
  waitType: RunWaitType;
  waitMessage: string;
  waitPayload?: Record<string, any>;
  artifacts?: Artifact[];
  runStepOverride?: WorkflowRunStep;
  approvalPolicyOverride?: ApprovalPolicy;
}) => {
  const waitRunStatus = await getWorkflowRunStatus(
    detail.run.capabilityId,
    detail.run.id,
  );
  if (waitRunStatus === "CANCELLED" || waitRunStatus === "PAUSED") {
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
    status: "OPEN",
    message: waitMessage,
    requestedBy: currentRunStep.agentId,
    approvalPolicyId: approvalPolicyOverride?.id || currentStep.approvalPolicy?.id,
    payload: {
      stepName: currentRunStep.name,
      ...(waitPayload || {}),
      contrarianReview:
        waitType === "CONFLICT_RESOLUTION" && contrarianReviewer
          ? createPendingContrarianReview(contrarianReviewer.id)
          : undefined,
    },
  });
  if (waitType === "APPROVAL") {
    const assignments = buildApprovalAssignmentsForWait({
      capability: projection.capability,
      workItem: projection.workItem,
      step: currentStep,
      runId: detail.run.id,
      waitId: wait.id,
      waitMessage,
      approvalPolicyOverride,
    });
    if (assignments.length > 0) {
      wait.approvalAssignments = await createApprovalAssignments(assignments);
    }
  }
  const waitingRunStep = await updateWorkflowRunStep({
    ...currentRunStep,
    status: "WAITING",
    waitId: wait.id,
  });
  const nextRun = (
    await updateWorkflowRun({
      ...detail.run,
      status:
        waitType === "APPROVAL"
          ? "WAITING_APPROVAL"
          : waitType === "HUMAN_TASK"
            ? "WAITING_HUMAN_TASK"
          : waitType === "INPUT"
            ? "WAITING_INPUT"
            : "WAITING_CONFLICT",
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
    type: "STEP_WAITING",
    level: waitType === "CONFLICT_RESOLUTION" ? "WARN" : "INFO",
    message: waitMessage,
    details: {
      stage: "STEP_WAITING",
      waitType,
      stepName: currentRunStep.name,
      phase: detail.run.currentPhase,
    },
  });
  let nextDetail = await getWorkflowRunDetail(
    detail.run.capabilityId,
    nextRun.id,
  );
  await syncWaitingProjection({
    detail: nextDetail,
    waitType,
    waitMessage,
    artifacts,
  });

  if (waitType === "CONFLICT_RESOLUTION" && projection && contrarianReviewer) {
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
      const operatorGuidanceContext = buildOperatorGuidanceContext({
        workItem: projection.workItem,
        artifacts: projection.workspace.artifacts,
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
        recentConversationText: buildRecentWorkItemConversationText({
          messages: projection.workspace.messages,
          workItemId: projection.workItem.id,
          runId: nextDetail.run.id,
        }),
        operatorGuidanceContext,
      });

      review = reviewEnvelope.review;
      retrievalReferences = reviewEnvelope.retrievalReferences;
      latencyMs = reviewEnvelope.latencyMs;
      costUsd = reviewEnvelope.usage.estimatedCostUsd;
      await recordUsageMetrics({
        capabilityId: detail.run.capabilityId,
        traceId: detail.run.traceId,
        scopeType: "STEP",
        scopeId: waitingRunStep.id,
        latencyMs: reviewEnvelope.latencyMs,
        totalTokens: reviewEnvelope.usage.totalTokens,
        costUsd: reviewEnvelope.usage.estimatedCostUsd,
        tags: {
          phase: currentStep.phase,
          model: contrarianReviewer.model,
          review: "contrarian",
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

      if (review.status === "READY") {
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
          review.status === "READY"
            ? "CONTRARIAN_REVIEW_READY"
            : "CONTRARIAN_REVIEW_FAILED",
        level:
          review.status === "ERROR" ||
          review.severity === "HIGH" ||
          review.severity === "CRITICAL"
            ? "WARN"
            : "INFO",
        message:
          review.status === "READY"
            ? `Contrarian review completed with ${review.severity.toLowerCase()} severity.`
            : "Contrarian review was unavailable; conflict can still be resolved manually.",
        details: {
          stage:
            review.status === "READY"
              ? "CONTRARIAN_REVIEW_READY"
              : "CONTRARIAN_REVIEW_FAILED",
          waitId: wait.id,
          reviewerAgentId: review.reviewerAgentId,
          severity: review.severity,
          recommendation: review.recommendation,
        },
      });
      nextDetail = await getWorkflowRunDetail(
        detail.run.capabilityId,
        nextRun.id,
      );
    } catch (error) {
      console.warn(
        "Contrarian review persistence failed; leaving wait open.",
        error,
      );
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
    status: "FAILED",
    completedAt: new Date().toISOString(),
    outputSummary: message,
    evidenceSummary: message,
  });
  const nextRun = (
    await updateWorkflowRun({
      ...detail.run,
      status: "FAILED",
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
    type: "STEP_FAILED",
    level: "ERROR",
    message,
    details: {
      stage: "STEP_FAILED",
      stepName: currentRunStep.name,
      phase: detail.run.currentPhase,
    },
  });
  const nextDetail = await getWorkflowRunDetail(
    detail.run.capabilityId,
    nextRun.id,
  );
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
    currentRunStep.status !== "FAILED" &&
    currentRunStep.status !== "COMPLETED"
  ) {
    await updateWorkflowRunStep({
      ...currentRunStep,
      status: "FAILED",
      completedAt: currentRunStep.completedAt || new Date().toISOString(),
      outputSummary: message,
      evidenceSummary: message,
    });
  }

  const nextRun = (
    await updateWorkflowRun({
      ...detail.run,
      status: "FAILED",
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
    type: "STEP_FAILED",
    level: "ERROR",
    message,
    details: {
      stage: "STEP_FAILED",
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

const prepareWorkflowRunExecutionContext = async (
  detail: WorkflowRunDetail,
): Promise<WorkflowRunDetail> => {
  if (detail.run.queueReason !== "PREPARING_EXECUTION_CONTEXT") {
    return detail;
  }

  const currentStep = getCurrentWorkflowStep(detail);
  const currentRunStep = getCurrentRunStep(detail);
  const projection = await resolveProjectionContext(
    detail.run.capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  const activeClaims = await listActiveWorkItemClaims(
    detail.run.capabilityId,
    detail.run.workItemId,
  );
  const actorUserId =
    projection.workItem.claimOwnerUserId || activeClaims[0]?.userId;
  const executorId = detail.run.assignedExecutorId;

  await emitRunProgressEvent({
    capabilityId: detail.run.capabilityId,
    runId: detail.run.id,
    workItemId: detail.run.workItemId,
    runStepId: currentRunStep.id,
    traceId: detail.run.traceId,
    spanId: currentRunStep.spanId,
    type: "RUN_PREPARATION_STARTED",
    message: `Preparing execution context for ${currentStep.name}.`,
    details: {
      stage: "RUN_PREPARATION_STARTED",
      queueReason: detail.run.queueReason,
      executorId: executorId || null,
      actorUserId: actorUserId || null,
      stepName: currentStep.name,
      phase: currentStep.phase,
    },
  });

  if (!executorId) {
    const queuedDispatch = await resolveQueuedRunDispatch({
      capabilityId: detail.run.capabilityId,
    });
    const nextRun = (
      await updateWorkflowRun({
        ...detail.run,
        status: "QUEUED",
        queueReason:
          queuedDispatch.queueReason || "WAITING_FOR_EXECUTOR",
        assignedExecutorId: queuedDispatch.assignedExecutorId,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      })
    ).run;
    return getWorkflowRunDetail(detail.run.capabilityId, nextRun.id);
  }

  if (!actorUserId) {
    return completeRunWithWait({
      detail,
      waitType: "INPUT",
      waitMessage:
        "Execution preparation needs an assigned operator before the desktop workspace can be prepared. Choose the operator, then resume the run.",
      waitPayload: {
        stage: "RUN_PREPARATION_BLOCKED",
        remediation:
          "Choose the active workspace operator, then resume execution.",
      },
    });
  }

  try {
    const prepared = await prepareWorkItemExecutionWorkspace({
      capabilityId: detail.run.capabilityId,
      workItemId: detail.run.workItemId,
      actorUserId,
      executorId,
    });
    const nextRun = (
      await updateWorkflowRun({
        ...detail.run,
        queueReason: undefined,
        assignedExecutorId: executorId,
      })
    ).run;

    await emitRunProgressEvent({
      capabilityId: detail.run.capabilityId,
      runId: detail.run.id,
      workItemId: detail.run.workItemId,
      runStepId: currentRunStep.id,
      traceId: detail.run.traceId,
      spanId: currentRunStep.spanId,
      type: prepared.cloned
        ? "SOURCE_WORKSPACE_CLONED"
        : "SOURCE_WORKSPACE_REUSED",
      message: prepared.cloned
        ? `Created work-item checkout at ${prepared.workspacePath}.`
        : `Reused work-item checkout at ${prepared.workspacePath}.`,
      details: {
        stage: prepared.cloned
          ? "SOURCE_WORKSPACE_CLONED"
          : "SOURCE_WORKSPACE_REUSED",
        sourceWorkspaceState: prepared.sourceWorkspace?.sourceWorkspaceState,
        operatorWorkDir: prepared.sourceWorkspace?.operatorWorkDir,
        repoRoot: prepared.sourceWorkspace?.repoRoot || prepared.workspacePath,
        repositoryId: prepared.repository.id,
        repositoryLabel: prepared.repository.label,
      },
    });

    await emitRunProgressEvent({
      capabilityId: detail.run.capabilityId,
      runId: detail.run.id,
      workItemId: detail.run.workItemId,
      runStepId: currentRunStep.id,
      traceId: detail.run.traceId,
      spanId: currentRunStep.spanId,
      type: "WORK_ITEM_BRANCH_READY",
      message: `Work-item branch ${prepared.branchName} is ready.`,
      details: {
        stage: "WORK_ITEM_BRANCH_READY",
        branchName: prepared.branchName,
        baseBranch: prepared.baseBranch,
        headSha: prepared.headSha || null,
      },
    });

    await emitRunProgressEvent({
      capabilityId: detail.run.capabilityId,
      runId: detail.run.id,
      workItemId: detail.run.workItemId,
      runStepId: currentRunStep.id,
      traceId: detail.run.traceId,
      spanId: currentRunStep.spanId,
      type:
        prepared.sourceWorkspace?.astStatus === "READY"
          ? "AST_REFRESH_COMPLETED"
          : "AST_REFRESH_QUEUED",
      message:
        prepared.sourceWorkspace?.astStatus === "READY"
          ? "AST is ready for the work-item checkout."
          : "AST refresh queued for the work-item checkout.",
      details: {
        stage:
          prepared.sourceWorkspace?.astStatus === "READY"
            ? "AST_REFRESH_COMPLETED"
            : "AST_REFRESH_QUEUED",
        astStatus: prepared.sourceWorkspace?.astStatus || "BUILDING",
        astFreshness: prepared.sourceWorkspace?.astFreshness || null,
        repoRoot: prepared.sourceWorkspace?.repoRoot || prepared.workspacePath,
      },
    });

    await emitRunProgressEvent({
      capabilityId: detail.run.capabilityId,
      runId: detail.run.id,
      workItemId: detail.run.workItemId,
      runStepId: currentRunStep.id,
      traceId: detail.run.traceId,
      spanId: currentRunStep.spanId,
      type: "RUN_PREPARATION_COMPLETED",
      message: `Prepared ${prepared.repository.label} on branch ${prepared.branchName}.`,
      details: {
        stage: "RUN_PREPARATION_COMPLETED",
        workspacePath: prepared.workspacePath,
        branchName: prepared.branchName,
        baseBranch: prepared.baseBranch,
        repositoryId: prepared.repository.id,
        repositoryLabel: prepared.repository.label,
        headSha: prepared.headSha || null,
        cloned: prepared.cloned,
      },
    });

    await persistProjection({
      capabilityId: detail.run.capabilityId,
      workspace: projection.workspace,
      workflow: projection.workflow,
      workItem: {
        ...projection.workItem,
        sourceWorkspace: {
          sourceWorkspaceState:
            prepared.sourceWorkspace?.sourceWorkspaceState ||
            "WORK_ITEM_CHECKOUT_READY",
          operatorWorkDir: prepared.sourceWorkspace?.operatorWorkDir,
          repoRoot: prepared.sourceWorkspace?.repoRoot || prepared.workspacePath,
          branchName: prepared.branchName,
          expectedBranchName: prepared.branchName,
          repositoryId: prepared.repository.id,
          repositoryLabel: prepared.repository.label,
          astStatus: prepared.sourceWorkspace?.astStatus || "BUILDING",
          astFreshness: prepared.sourceWorkspace?.astFreshness,
          sourceWorkspaceError: prepared.sourceWorkspace?.sourceWorkspaceError,
          remediation: prepared.sourceWorkspace?.remediation,
        },
      },
    });

    return getWorkflowRunDetail(detail.run.capabilityId, nextRun.id);
  } catch (error) {
    const remediationMessage = buildExecutionPreparationErrorMessage(error);
    await emitRunProgressEvent({
      capabilityId: detail.run.capabilityId,
      runId: detail.run.id,
      workItemId: detail.run.workItemId,
      runStepId: currentRunStep.id,
      traceId: detail.run.traceId,
      spanId: currentRunStep.spanId,
      type: "RUN_PREPARATION_BLOCKED",
      level: "WARN",
      message: remediationMessage,
      details: {
        stage: "RUN_PREPARATION_BLOCKED",
        failureReason: remediationMessage,
      },
    });
    return completeRunWithWait({
      detail,
      waitType: "INPUT",
      waitMessage: remediationMessage,
      waitPayload: {
        stage: "RUN_PREPARATION_BLOCKED",
        remediation: remediationMessage,
      },
    });
  }
};

const executeAutomatedStep = async (
  detail: WorkflowRunDetail,
): Promise<WorkflowRunDetail> => {
  if (
    ["CANCELLED", "PAUSED"].includes(
      await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
    )
  ) {
    return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
  }

  const rawProjection = await resolveProjectionContext(
    detail.run.capabilityId,
    detail.run.workItemId,
    detail.run.workflowSnapshot,
  );
  // Inject the executor's user-level working_directory (if set) into this
  // run projection so workspace tooling resolves the desktop user's path
  // independently of capability metadata.
  const executorRegistration = detail.run.assignedExecutorId
    ? await getDesktopExecutorRegistration(detail.run.assignedExecutorId).catch(() => null)
    : null;
  const projection =
    executorRegistration?.workingDirectory
      ? {
          ...rawProjection,
          capability: {
            ...rawProjection.capability,
            // Prepend so the user-level dir sorts first in the runtime roots.
            localDirectories: [
              executorRegistration.workingDirectory,
              ...(rawProjection.capability.localDirectories || []),
            ],
          },
        }
      : rawProjection;
  const step = getCurrentWorkflowStep(detail);
  const runStep = getCurrentRunStep(detail);
  const agent =
    projection.workspace.agents.find((item) => item.id === step.agentId) ||
    projection.workspace.agents[0];
  const traceId = detail.run.traceId || createTraceId();

  let currentRunStep = await updateWorkflowRunStep({
    ...runStep,
    status: "RUNNING",
    attemptCount: runStep.attemptCount + 1,
    startedAt: runStep.startedAt || new Date().toISOString(),
    spanId: runStep.spanId || createTraceId().slice(0, 16),
  });
  const updatedRun = (
    await updateWorkflowRun({
      ...detail.run,
      status: "RUNNING",
      startedAt: detail.run.startedAt || new Date().toISOString(),
      currentStepId: step.id,
      currentPhase: step.phase,
      assignedAgentId: step.agentId,
      traceId,
    })
  ).run;
  const runningDetail = await getWorkflowRunDetail(
    detail.run.capabilityId,
    updatedRun.id,
  );
  const stepSpan = await startTelemetrySpan({
    capabilityId: detail.run.capabilityId,
    traceId,
    parentSpanId: undefined,
    entityType: "STEP",
    entityId: currentRunStep.id,
    name: `${step.name} execution`,
    status: "RUNNING",
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
      stage: "STEP_STARTED",
      stepName: step.name,
      phase: step.phase,
      attemptCount: currentRunStep.attemptCount,
      agentId: agent.id,
      agentName: agent.name,
    },
  });

  const humanStageOverrideDetail = await maybePauseForHumanStageOverride({
    detail: runningDetail,
    projection,
    step,
    runStep: currentRunStep,
  });
  if (humanStageOverrideDetail) {
    await finishTelemetrySpan({
      capabilityId: detail.run.capabilityId,
      spanId: stepSpan.id,
      status: "WAITING",
      attributes: {
        waitType: "HUMAN_TASK",
        reason: "STAGE_OVERRIDE",
      },
    });
    return humanStageOverrideDetail;
  }

  const toolHistory: Array<{ role: "assistant" | "user"; content: string }> =
    [];
  // Ephemeral cache for the Lever-3 history rollup — lives for the duration
  // of this step execution only. Lets `requestStepDecision` fold only the
  // new older turns into the cached summary instead of re-summarizing the
  // same prefix on every iteration.
  const rollupCacheRef: { current: RollupCacheEntry | null } = {
    current: null,
  };
  // Fix 2 — Dynamic model routing: track the last tool called so
  // resolveModelForTurn can choose a cheaper model for trivial read turns.
  let lastToolName: string | null = null;
  // Fix 4 — Real-time LLM delta streaming: SSE-only (not persisted to DB).
  // Each token delta is forwarded to the run's SSE channel so operators see
  // the agent's reasoning as it streams, without flooding the DB.
  const onLlmDelta = (delta: string) => {
    publishRunEvent({
      id: `DELTA-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      capabilityId: detail.run.capabilityId,
      runId: detail.run.id,
      workItemId: detail.run.workItemId,
      runStepId: currentRunStep.id,
      traceId,
      timestamp: new Date().toISOString(),
      type: "LLM_DELTA",
      level: "INFO",
      message: delta,
    });
  };
  const inspectedPaths = new Set<string>();
  const attemptedTools: ToolAdapterId[] = [];
  let hasApprovedDeployment =
    runningDetail.steps.some(
      (item) =>
        item.stepType === "HUMAN_APPROVAL" && item.status === "COMPLETED",
    ) ||
    runningDetail.waits.some(
      (wait) => wait.type === "APPROVAL" && wait.status === "RESOLVED",
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
    artifacts: replaceArtifacts(projection.workspace.artifacts, [
      executionPlanArtifact,
    ]),
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
      stage: "STEP_CONTRACT_COMPILED",
      stepName: step.name,
      missingInputs: compiledStepContext.missingInputs.length,
      allowedToolCount:
        compiledStepContext.executionBoundary.allowedToolIds.length,
    },
  });

  if (compiledStepContext.missingInputs.length > 0) {
    if (
      ["CANCELLED", "PAUSED"].includes(
        await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
      )
    ) {
      return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
    }

    await finishTelemetrySpan({
      capabilityId: detail.run.capabilityId,
      spanId: stepSpan.id,
      status: "WAITING",
      attributes: {
        waitType: "INPUT",
        missingInputs: compiledStepContext.missingInputs
          .map((input) => input.label)
          .join(", "),
      },
    });
    return completeRunWithWait({
      detail: runningDetail,
      waitType: "INPUT",
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
      ["CANCELLED", "PAUSED"].includes(
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
      rollupCacheRef,
      runId: detail.run.id,
      traceId,
      spanId: stepSpan.id,
      onLlmDelta,
      lastToolName,
    });
    const decision = decisionEnvelope.decision;
    
    console.log(`\n[orchestrator:debug] ══════ LLM DECISION EVALUATION ══════`);
    console.log(`[orchestrator:debug]   action: ${decision.action}`);
    console.log(`[orchestrator:debug]   summary: ${decision.summary}`);
    if (decision.action === 'invoke_tool') {
      console.log(`[orchestrator:debug]   toolCall: ${decision.toolCall?.toolId}`);
    }
    console.log(`[orchestrator:debug] ═════════════════════════════════════════\n`);

    if (
      ["CANCELLED", "PAUSED"].includes(
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
      message: `Grounded ${step.name} with ${decisionEnvelope.retrievalReferences.length} capability reference${decisionEnvelope.retrievalReferences.length === 1 ? "" : "s"}.`,
      details: {
        stage: "CONTEXT_GROUNDED",
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
        stage: "DECISION_READY",
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
      scopeType: "STEP",
      scopeId: currentRunStep.id,
      latencyMs: decisionEnvelope.latencyMs,
      totalTokens: decisionEnvelope.usage.totalTokens,
      costUsd: decisionEnvelope.usage.estimatedCostUsd,
      tags: {
        phase: step.phase,
        model: decisionEnvelope.model,
      },
    });
    const recoverableDecisionFeedback =
      getRecoverableDecisionFeedback(decision);
    if (recoverableDecisionFeedback) {
      toolHistory.push({
        role: "assistant",
        content: JSON.stringify(decision),
      });
      toolHistory.push({
        role: "user",
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
        level: "WARN",
        message: recoverableDecisionFeedback,
        details: {
          stage: "DECISION_REPAIRED",
          stepName: step.name,
          iteration: iteration + 1,
        },
      });
      continue;
    }

    if (decision.action === "invoke_tool") {
      if (
        ["CANCELLED", "PAUSED"].includes(
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
          status: "ERROR",
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
          typeof decision.toolCall.args?.path === "string"
            ? decision.toolCall.args.path
            : typeof decision.toolCall.args?.templateId === "string"
              ? decision.toolCall.args.templateId
              : undefined,
        hasApprovalBypass: hasApprovedDeployment,
      });

      if (policyDecision.decision === "DENY") {
        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: stepSpan.id,
          status: "ERROR",
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

      if (policyDecision.decision === "REQUIRE_APPROVAL") {
        if (
          ["CANCELLED", "PAUSED"].includes(
            await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
          )
        ) {
          return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
        }

        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: stepSpan.id,
          status: "WAITING",
          costUsd: decisionEnvelope.usage.estimatedCostUsd,
          tokenUsage: decisionEnvelope.usage,
          attributes: {
            policyDecisionId: policyDecision.id,
            policyResult: policyDecision.decision,
          },
        });
        return completeRunWithWait({
          detail: runningDetail,
          waitType: "APPROVAL",
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
        entityType: "TOOL",
        entityId: toolInvocationId,
        name: `${decision.toolCall.toolId} tool`,
        status: "RUNNING",
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
        status: "RUNNING",
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
        type: "TOOL_STARTED",
        message: `Running ${formatToolLabel(decision.toolCall.toolId)} for ${step.name}.`,
        details: {
          stage: "TOOL_STARTED",
          stepName: step.name,
          toolId: decision.toolCall.toolId,
          iteration: iteration + 1,
        },
      });
      const toolStartedAt = Date.now();

      try {
        attemptedTools.push(decision.toolCall.toolId);
        const result =
          decision.toolCall.toolId === "delegate_task"
            ? await executeDelegatedTask({
                projection,
                detail: runningDetail,
                step,
                parentAgent: agent,
                delegatedAgentId:
                  typeof decision.toolCall.args?.delegatedAgentId === "string"
                    ? decision.toolCall.args.delegatedAgentId
                    : "",
                title:
                  typeof decision.toolCall.args?.title === "string"
                    ? decision.toolCall.args.title
                    : `${step.name} specialist delegation`,
                prompt:
                  typeof decision.toolCall.args?.prompt === "string"
                    ? decision.toolCall.args.prompt
                    : "",
                toolInvocationId,
                traceId,
                promoteToHandoff: Boolean(
                  decision.toolCall.args?.promoteToHandoff,
                ),
                openQuestions: Array.isArray(
                  decision.toolCall.args?.openQuestions,
                )
                  ? decision.toolCall.args.openQuestions.filter(
                      (value): value is string =>
                        typeof value === "string" && value.trim().length > 0,
                    )
                  : undefined,
                blockingDependencies: Array.isArray(
                  decision.toolCall.args?.blockingDependencies,
                )
                  ? decision.toolCall.args.blockingDependencies.filter(
                      (value): value is string =>
                        typeof value === "string" && value.trim().length > 0,
                    )
                  : undefined,
                recommendedNextStep:
                  typeof decision.toolCall.args?.recommendedNextStep ===
                  "string"
                    ? decision.toolCall.args.recommendedNextStep
                    : undefined,
              })
            : await executeTool({
                capability: projection.capability,
                agent,
                workItem: projection.workItem,
                toolId: decision.toolCall.toolId,
                args: decision.toolCall.args || {},
                requireApprovedDeployment: hasApprovedDeployment,
                runId: detail.run.id,
                runStepId: currentRunStep.id,
                stepName: step.name,
              });
        const toolLatency = Date.now() - toolStartedAt;
        const completedTool = await updateToolInvocation({
          ...toolInvocation,
          status: "COMPLETED",
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
          status: "OK",
          attributes: {
            sandboxProfile: result.sandboxProfile,
            policyDecisionId: policyDecision.id,
          },
        });
        await recordUsageMetrics({
          capabilityId: detail.run.capabilityId,
          traceId,
          scopeType: "TOOL",
          scopeId: completedTool.id,
          latencyMs: toolLatency,
          tags: {
            toolId: completedTool.toolId,
            sandbox: result.sandboxProfile || "unknown",
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
            type: "TOOL_COMPLETED",
            level: "INFO",
            message: result.summary,
            details: result.details,
          }),
        );
        toolHistory.push({
          role: "assistant",
          content: JSON.stringify(decision),
        });
        toolHistory.push({
          role: "user",
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
        const touchedPaths = Array.isArray(result.details?.touchedPaths)
          ? result.details.touchedPaths.filter(
              (value): value is string =>
                typeof value === "string" && value.trim().length > 0,
            )
          : typeof result.details?.path === "string" &&
              result.details.path.trim()
            ? [result.details.path.trim()]
            : [];
        touchedPaths.forEach((touchedPath) => {
          stepTouchedPaths.add(touchedPath);
        });
        // Fix 4 — emit TOOL_FILE_CHANGED for write/patch tools so the frontend
        // can show live file-change activity in the Attempts panel. SSE-only,
        // not persisted to DB (publishRunEvent, not insertRunEvent).
        const FILE_WRITING_TOOLS = new Set([
          "workspace_write",
          "workspace_apply_patch",
          "workspace_replace_block",
        ]);
        if (FILE_WRITING_TOOLS.has(decision.toolCall.toolId)) {
          const changedPaths =
            touchedPaths.length > 0
              ? touchedPaths
              : typeof decision.toolCall.args?.path === "string" &&
                  decision.toolCall.args.path.trim()
                ? [decision.toolCall.args.path.trim()]
                : [];
          changedPaths.forEach((changedPath) => {
            publishRunEvent({
              id: `FCH-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
              capabilityId: detail.run.capabilityId,
              runId: detail.run.id,
              workItemId: detail.run.workItemId,
              runStepId: currentRunStep.id,
              traceId,
              timestamp: new Date().toISOString(),
              type: "TOOL_FILE_CHANGED",
              level: "INFO",
              message: changedPath,
              details: {
                toolId: decision.toolCall.toolId,
                path: changedPath,
                },
            });
          });
          await queueWorkItemAstRefresh({
            capability: projection.capability,
            workItem: projection.workItem,
            checkoutPath:
              typeof result.workingDirectory === "string" &&
              result.workingDirectory.trim()
                ? result.workingDirectory
                : undefined,
          }).catch(() => undefined);
        }
        // Fix 2 — update routing state so the next requestStepDecision call
        // can route trivial follow-up reads to the budget model.
        lastToolName = decision.toolCall.toolId;
        if (
          typeof decision.toolCall.args?.path === "string" &&
          decision.toolCall.args.path.trim()
        ) {
          inspectedPaths.add(decision.toolCall.args.path.trim());
        }
        continue;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Tool execution failed unexpectedly.";
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
          type: "TOOL_FAILED",
          level: "ERROR",
          message: `${formatToolLabel(decision.toolCall.toolId)} failed: ${message}`,
          details: {
            stage: "TOOL_FAILED",
            stepName: step.name,
            toolId: decision.toolCall.toolId,
          },
        });
        await updateToolInvocation({
          ...toolInvocation,
          status: "FAILED",
          resultSummary: message,
          sandboxProfile: toolInvocation.sandboxProfile,
          completedAt: new Date().toISOString(),
        });
        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: toolSpan.id,
          status: "ERROR",
          attributes: {
            error: message,
            policyDecisionId: policyDecision.id,
          },
        });
        if (recoverableToolError?.recoverable) {
          toolHistory.push({
            role: "assistant",
            content: JSON.stringify(decision),
          });
          toolHistory.push({
            role: "user",
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
          status: "ERROR",
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

    if (decision.action === "complete") {
      const artifact = buildArtifactFromStepCompletion({
        detail: runningDetail,
        step,
        summary: decision.summary,
        retrievalReferences: decisionEnvelope.retrievalReferences,
        costUsd: decisionEnvelope.usage.estimatedCostUsd,
        latencyMs: decisionEnvelope.latencyMs,
      });

      // Audit the agent's response against the step's expectedOutputs
      // contract. Non-fatal: we record a run event so operators see which
      // named outputs are missing without blocking the run. The agent
      // already received the explicit `## <Name>` instruction in its
      // system prompt, so a mismatch here is a real signal.
      const outputContractAudit = auditOutputContractSections(
        decision.summary,
        step.artifactContract?.expectedOutputs || [],
      );
      if (!outputContractAudit.vacuous && outputContractAudit.missing.length > 0) {
        await emitRunProgressEvent({
          capabilityId: detail.run.capabilityId,
          runId: detail.run.id,
          workItemId: detail.run.workItemId,
          runStepId: currentRunStep.id,
          traceId: detail.run.traceId,
          spanId: currentRunStep.spanId,
          type: "STEP_OUTPUT_CONTRACT_INCOMPLETE",
          level: "WARN",
          message: `${step.name} produced ${outputContractAudit.present.length} of ${outputContractAudit.present.length + outputContractAudit.missing.length} expected output sections. Missing: ${outputContractAudit.missing.join(", ")}.`,
          details: {
            stage: "STEP_OUTPUT_CONTRACT_INCOMPLETE",
            stepName: step.name,
            expectedOutputs: step.artifactContract?.expectedOutputs || [],
            present: outputContractAudit.present,
            missing: outputContractAudit.missing,
            artifactId: artifact.id,
          },
        });
      }
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
          ["CANCELLED", "PAUSED"].includes(
            await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
          )
        ) {
          return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
        }

        await finishTelemetrySpan({
          capabilityId: detail.run.capabilityId,
          spanId: stepSpan.id,
          status: "WAITING",
          costUsd: decisionEnvelope.usage.estimatedCostUsd,
          tokenUsage: decisionEnvelope.usage,
          attributes: {
            outputSummary: decision.summary,
            waitType: "APPROVAL",
            codeDiffArtifactId: codeDiffArtifact.id,
          },
        });
        return completeRunWithWait({
          detail: runningDetail,
          waitType: "APPROVAL",
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
        status: "COMPLETED",
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
        type: "STEP_COMPLETED",
        message: decision.summary,
        details: {
          stage: "STEP_COMPLETED",
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
        status: "OK",
        costUsd: decisionEnvelope.usage.estimatedCostUsd,
        tokenUsage: decisionEnvelope.usage,
        attributes: {
          outputSummary: decision.summary,
        },
      });
      await refreshCapabilityMemory(detail.run.capabilityId).catch(
        () => undefined,
      );

      if (!nextStep) {
        await releaseRunLease({
          capabilityId: detail.run.capabilityId,
          runId: detail.run.id,
        });
      }

      return nextDetail;
    }

    if (
      decision.action === "pause_for_input" ||
      decision.action === "pause_for_approval" ||
      decision.action === "pause_for_conflict"
    ) {
      const waitType =
        decision.action === "pause_for_conflict"
          ? "CONFLICT_RESOLUTION"
          : decision.wait.type;

      if (
        ["CANCELLED", "PAUSED"].includes(
          await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
        )
      ) {
        return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
      }

      await finishTelemetrySpan({
        capabilityId: detail.run.capabilityId,
        spanId: stepSpan.id,
        status: "WAITING",
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
          waitType === "INPUT"
            ? {
                requestedInputFields:
                  compiledStepContext.missingInputs.length > 0
                    ? compiledStepContext.missingInputs
                    : [
                        {
                          id: "operator-input",
                          label: "Operator input",
                          description: decision.wait.message,
                          required: true,
                          source: "HUMAN_INPUT",
                          kind: "MARKDOWN",
                          status: "MISSING",
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

    if (decision.action === "fail") {
      await finishTelemetrySpan({
        capabilityId: detail.run.capabilityId,
        spanId: stepSpan.id,
        status: "ERROR",
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
    ["CANCELLED", "PAUSED"].includes(
      await getWorkflowRunStatus(detail.run.capabilityId, detail.run.id),
    )
  ) {
    return getWorkflowRunDetail(detail.run.capabilityId, detail.run.id);
  }

  await finishTelemetrySpan({
    capabilityId: detail.run.capabilityId,
    spanId: stepSpan.id,
    status:
      countResolvedToolLoopExhaustionWaits({
        detail: runningDetail,
        runStepId: currentRunStep.id,
      }) >= MAX_RESOLVED_TOOL_LOOP_EXHAUSTION_WAITS
        ? "ERROR"
        : "WAITING",
    attributes: {
      waitType: "INPUT",
      error: `${step.name} exceeded the maximum tool loop iterations.`,
    },
  });

  const resolvedLoopExhaustionCount = countResolvedToolLoopExhaustionWaits({
    detail: runningDetail,
    runStepId: currentRunStep.id,
  });
  const attemptedToolList = Array.from(new Set(attemptedTools));
  const inspectedPathList = Array.from(inspectedPaths);

  if (resolvedLoopExhaustionCount >= MAX_RESOLVED_TOOL_LOOP_EXHAUSTION_WAITS) {
    return failRun({
      detail: runningDetail,
      message: buildRepeatedToolLoopFailureMessage({
        step,
        inspectedPaths: inspectedPathList.slice(-5),
        attemptedTools: attemptedToolList.slice(-5),
      }),
    });
  }

  const escalatedToolLoopWait = resolvedLoopExhaustionCount > 0;
  return completeRunWithWait({
    detail: runningDetail,
    waitType: "INPUT",
    waitMessage: escalatedToolLoopWait
      ? buildEscalatedToolLoopWaitMessage({
          step,
          inspectedPaths: inspectedPathList.slice(-5),
          attemptedTools: attemptedToolList.slice(-5),
        })
      : buildToolLoopExhaustedWaitMessage({
          step,
          inspectedPaths: inspectedPathList.slice(-5),
          attemptedTools: attemptedToolList.slice(-5),
        }),
    waitPayload: {
      reason: TOOL_LOOP_EXHAUSTION_WAIT_REASON,
      escalationCount: resolvedLoopExhaustionCount + 1,
      requestedInputFields: buildToolLoopRequestedInputFields({
        escalated: escalatedToolLoopWait,
      }),
      compiledStepContext,
      compiledWorkItemPlan,
      attemptedTools: attemptedToolList,
      inspectedPaths: inspectedPathList,
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
    Math.max(
      getWorkflowNodes(currentDetail.run.workflowSnapshot).length,
      currentDetail.run.workflowSnapshot.steps.length,
    ) + 2;
  for (let index = 0; index < maxTransitions; index += 1) {
    const latestStatus = await getWorkflowRunStatus(
      currentDetail.run.capabilityId,
      currentDetail.run.id,
    );
    if (latestStatus === "CANCELLED" || latestStatus === "PAUSED") {
      return getWorkflowRunDetail(
        currentDetail.run.capabilityId,
        currentDetail.run.id,
      );
    }

    if (currentDetail.run.queueReason === "PREPARING_EXECUTION_CONTEXT") {
      currentDetail = await prepareWorkflowRunExecutionContext(currentDetail);
      if (
        currentDetail.run.status === "QUEUED" ||
        currentDetail.run.status === "FAILED" ||
        currentDetail.run.status === "WAITING_APPROVAL" ||
        currentDetail.run.status === "WAITING_HUMAN_TASK" ||
        currentDetail.run.status === "WAITING_INPUT" ||
        currentDetail.run.status === "WAITING_CONFLICT" ||
        currentDetail.run.status === "PAUSED" ||
        currentDetail.run.status === "CANCELLED"
      ) {
        return currentDetail;
      }
    }

    const currentStep = getCurrentWorkflowStep(currentDetail);
    if (currentStep.stepType === "HUMAN_APPROVAL") {
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
          projection.workspace.agents.find(
            (agent) => agent.id === currentStep.agentId,
          ) || null,
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
      await replaceCapabilityWorkspaceContentRecord(
        currentDetail.run.capabilityId,
        {
          artifacts: replaceArtifacts(projection.workspace.artifacts, [
            executionPlanArtifact,
          ]),
        },
      );

      return completeRunWithWait({
        detail: currentDetail,
        waitType: "APPROVAL",
        waitMessage: currentStep.approverRoles?.length
          ? `${currentStep.name} is waiting for ${currentStep.approverRoles.join(", ")} approval.`
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
      currentDetail.run.status === "COMPLETED" ||
      currentDetail.run.status === "FAILED" ||
      currentDetail.run.status === "WAITING_APPROVAL" ||
      currentDetail.run.status === "WAITING_HUMAN_TASK" ||
      currentDetail.run.status === "WAITING_INPUT" ||
      currentDetail.run.status === "WAITING_CONFLICT" ||
      currentDetail.run.status === "PAUSED" ||
      currentDetail.run.status === "CANCELLED"
    ) {
      return currentDetail;
    }
  }

  return failRun({
    detail: currentDetail,
    message: "Workflow execution exceeded the maximum step transitions.",
  });
};
