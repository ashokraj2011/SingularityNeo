import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Clock3,
  ExternalLink,
  FileCode,
  FileText,
  LayoutGrid,
  List,
  Pause,
  Search,
  Send,
  Square,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ErrorBoundary from "../components/ErrorBoundary";
import { ExplainWorkItemDrawer } from "../components/ExplainWorkItemDrawer";
import StageControlModal from "../components/StageControlModal";
import { useCapability } from "../context/CapabilityContext";
import { useToast } from "../context/ToastContext";
import { formatEnumLabel, getStatusTone } from "../lib/enterprise";
import { buildCapabilityExperience } from "../lib/capabilityExperience";
import {
  canReadCapabilityLiveDetail,
  hasPermission,
} from "../lib/accessControl";
import { compactMarkdownPreview } from "../lib/markdown";
import { writeViewPreference } from "../lib/viewPreferences";
import {
  appendCapabilityMessageRecord,
  approveCapabilityWorkflowRun,
  acceptCapabilityWorkItemHandoff,
  archiveCapabilityWorkItem,
  cancelCapabilityWorkItem,
  cancelCapabilityWorkflowRun,
  clearCapabilityMessageHistoryRecord,
  claimCapabilityWorkItemControl,
  claimCapabilityWorkItemWriteControl,
  createCapabilityWorkItemHandoff,
  createCapabilityWorkItem,
  createEvidencePacketForWorkItem,
  createDesktopWorkspaceMapping,
  createCapabilityWorkItemSharedBranch,
  fetchCapabilityWorkflowRun,
  fetchCapabilityWorkflowRunEvents,
  fetchDesktopWorkspaceMappings,
  initializeCapabilityWorkItemExecutionContext,
  moveCapabilityWorkItem,
  pauseCapabilityWorkflowRun,
  provideCapabilityWorkflowRunInput,
  resumeCapabilityWorkflowRun,
  restoreCapabilityWorkItem,
  validateOnboardingWorkspacePath,
  releaseCapabilityWorkItemControl,
  releaseCapabilityWorkItemWriteControl,
  requestCapabilityWorkflowRunChanges,
  resolveCapabilityWorkflowRunConflict,
  restartCapabilityWorkflowRun,
  startCapabilityWorkflowRun,
  startCapabilityWorkItemSegment,
  startCapabilityWorkItemNextSegment,
  streamCapabilityChat,
  uploadCapabilityWorkItemFiles,
} from "../lib/api";
import {
  getCapabilityBoardPhaseIds,
  getCapabilityVisibleLifecyclePhases,
  getLifecyclePhaseLabel,
} from "../lib/capabilityLifecycle";
import {
  createEmptyWorkItemPhaseStakeholder,
  formatWorkItemPhaseStakeholderLine,
  getWorkItemPhaseStakeholders,
  normalizeWorkItemPhaseStakeholders,
} from "../lib/workItemStakeholders";
import {
  DEFAULT_WORK_ITEM_TASK_TYPE,
  getWorkItemTaskTypeDescription,
  getWorkItemTaskTypeEntryPhase,
  getWorkItemTaskTypeLabel,
  resolveWorkItemEntryStep,
} from "../lib/workItemTaskTypes";
import { buildAgentKnowledgeLens } from "../lib/agentKnowledge";
import { buildCapabilityInteractionFeed } from "../lib/interactionFeed";
import { normalizeCompiledStepContext } from "../lib/workflowRuntime";
import { cn } from "../lib/utils";
import { OrchestratorQuickActionDialogs } from "../components/orchestrator/OrchestratorQuickActionDialogs";
import { OrchestratorLifecycleRail } from "../components/orchestrator/OrchestratorLifecycleRail";
import { OrchestratorAttentionQueue } from "../components/orchestrator/OrchestratorAttentionQueue";
import { OrchestratorInboxPanel } from "../components/orchestrator/OrchestratorInboxPanel";
import {
  StartSegmentDialog,
  type StartSegmentDialogSubmit,
} from "../components/orchestrator/StartSegmentDialog";
import { OrchestratorSegmentsSection } from "../components/orchestrator/OrchestratorSegmentsSection";
import { OrchestratorApprovalReviewModal } from "../components/orchestrator/OrchestratorApprovalReviewModal";
import { OrchestratorDiffReviewModal } from "../components/orchestrator/OrchestratorDiffReviewModal";
import { OrchestratorCapabilityCockpit } from "../components/orchestrator/OrchestratorCapabilityCockpit";
import { OrchestratorListMode } from "../components/orchestrator/OrchestratorListMode";
import { OrchestratorBoardMode } from "../components/orchestrator/OrchestratorBoardMode";
import { OrchestratorSelectedWorkPanel } from "../components/orchestrator/OrchestratorSelectedWorkPanel";
import { OrchestratorCopilotDock } from "../components/orchestrator/OrchestratorCopilotDock";
import { OrchestratorCopilotStatusStack } from "../components/orchestrator/OrchestratorCopilotStatusStack";
import { OrchestratorCopilotThread } from "../components/orchestrator/OrchestratorCopilotThread";
import { OrchestratorListWorkbench } from "../components/orchestrator/OrchestratorListWorkbench";
import { OrchestratorBoardWorkbench } from "../components/orchestrator/OrchestratorBoardWorkbench";
import { OrchestratorBoardQuickCreateSheet } from "../components/orchestrator/OrchestratorBoardQuickCreateSheet";
import { OrchestratorBoardSurface } from "../components/orchestrator/OrchestratorBoardSurface";
import { OrchestratorQuickCreateSheet } from "../components/orchestrator/OrchestratorQuickCreateSheet";
import { OrchestratorListWorkbenchOverlays } from "../components/orchestrator/OrchestratorListWorkbenchOverlays";
import { OrchestratorDetailRail } from "../components/orchestrator/OrchestratorDetailRail";
import { OrchestratorWorkbenchCanvas } from "../components/orchestrator/OrchestratorWorkbenchCanvas";
import { OrchestratorWorkbenchDetailContent } from "../components/orchestrator/OrchestratorWorkbenchDetailContent";
import { OrchestratorSharedOverlays } from "../components/orchestrator/OrchestratorSharedOverlays";
import {
  CopilotMessageBody,
  CopilotThinkingIndicator,
} from "../components/orchestrator/OrchestratorCopilotTranscript";
import { useOrchestratorDock } from "../hooks/orchestrator/useOrchestratorDock";
import { useOrchestratorModals } from "../hooks/orchestrator/useOrchestratorModals";
import { useOrchestratorRuntime } from "../hooks/orchestrator/useOrchestratorRuntime";
import { useOrchestratorSelection } from "../hooks/orchestrator/useOrchestratorSelection";
import {
  type ArtifactWorkbenchFilter,
  buildApprovalWorkspacePath,
  type DetailTab,
  formatRelativeTime,
  formatTimestamp,
  getArtifactDocumentBody,
  getCurrentWorkflowStep,
  getPriorityTone,
  getSelectedRunWait,
  matchesArtifactWorkbenchFilter,
  normalizeMarkdownishText,
  readSessionValue,
  STORAGE_KEYS,
  type OrchestratorView,
  type StageChatMessage,
  type WorkbenchQueueView,
  type WorkbenchSelectionFocus,
  type WorkItemPriorityFilter,
  type WorkItemStatusFilter,
  type WorkNavigatorItem,
  type WorkNavigatorSection,
} from "../lib/orchestrator/support";
import type {
  AgentArtifactExpectation,
  ApprovalDecision,
  Artifact,
  CapabilityStakeholder,
  CompiledArtifactChecklistItem,
  CompiledRequiredInputField,
  CompiledStepContext,
  CompiledWorkItemPlan,
  ContrarianConflictReview,
  DesktopWorkspaceMapping,
  RunEvent,
  RunWait,
  WorkItem,
  WorkItemAttachmentUpload,
  WorkItemPhase,
  WorkItemPhaseStakeholderAssignment,
  WorkItemTaskType,
  WorkspacePathValidationResult,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
} from "../types";
import { ModalShell, StatusBadge } from "../components/EnterpriseUI";
import { AdvancedDisclosure } from "../components/WorkspaceUI";

const PHASE_ACCENTS = [
  "bg-sky-100 text-sky-700",
  "bg-indigo-100 text-indigo-700",
  "bg-primary/10 text-primary",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-cyan-100 text-cyan-700",
  "bg-orange-100 text-orange-700",
] as const;

const RUN_STATUS_META: Record<
  WorkflowRun["status"],
  { label: string; accent: string }
> = {
  QUEUED: { label: "Queued", accent: "bg-slate-100 text-slate-700" },
  RUNNING: { label: "Running", accent: "bg-primary/10 text-primary" },
  PAUSED: { label: "Paused", accent: "bg-slate-200 text-slate-700" },
  WAITING_APPROVAL: {
    label: "Waiting Approval",
    accent: "bg-amber-100 text-amber-700",
  },
  WAITING_INPUT: {
    label: "Waiting Input",
    accent: "bg-orange-100 text-orange-700",
  },
  WAITING_CONFLICT: {
    label: "Waiting Conflict",
    accent: "bg-red-100 text-red-700",
  },
  COMPLETED: { label: "Completed", accent: "bg-emerald-100 text-emerald-700" },
  FAILED: { label: "Failed", accent: "bg-red-100 text-red-700" },
  CANCELLED: { label: "Cancelled", accent: "bg-slate-200 text-slate-700" },
};

const WORK_ITEM_STATUS_META: Record<
  WorkItem["status"],
  { label: string; accent: string }
> = {
  ACTIVE: { label: "Active", accent: "bg-primary/10 text-primary" },
  BLOCKED: { label: "Blocked", accent: "bg-red-100 text-red-700" },
  PAUSED: { label: "Paused", accent: "bg-slate-200 text-slate-700" },
  PENDING_APPROVAL: {
    label: "Pending Approval",
    accent: "bg-amber-100 text-amber-700",
  },
  COMPLETED: { label: "Completed", accent: "bg-emerald-100 text-emerald-700" },
  CANCELLED: { label: "Cancelled", accent: "bg-slate-200 text-slate-700" },
  ARCHIVED: { label: "Archived", accent: "bg-slate-100 text-slate-700" },
};

const ACTIVE_RUN_STATUSES: WorkflowRun["status"][] = [
  "QUEUED",
  "RUNNING",
  "PAUSED",
  "WAITING_APPROVAL",
  "WAITING_INPUT",
  "WAITING_CONFLICT",
];

const LIVE_EXECUTION_RUN_STATUSES: WorkflowRun["status"][] = [
  "QUEUED",
  "RUNNING",
];

const PASSPORT_ELIGIBLE_RUN_STATUSES = new Set<WorkflowRun["status"]>([
  "WAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
]);

const toDraftPhaseStakeholder = (stakeholder?: CapabilityStakeholder) => ({
  role: stakeholder?.role || "Stakeholder",
  name: stakeholder?.name || "",
  email: stakeholder?.email || "",
  teamName: stakeholder?.teamName || "",
});

const MAX_WORK_ITEM_ATTACHMENT_BYTES = 300_000;

const formatAttachmentSizeLabel = (sizeBytes?: number): string => {
  if (
    typeof sizeBytes !== "number" ||
    Number.isNaN(sizeBytes) ||
    sizeBytes <= 0
  ) {
    return "";
  }

  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (sizeBytes >= 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }

  return `${sizeBytes} B`;
};

const renderAttachmentIcon = (attachment: WorkItemAttachmentUpload) => {
  const fileName = attachment.fileName.toLowerCase();
  const mimeType = (attachment.mimeType || "").toLowerCase();
  const isCodeLike =
    mimeType.includes("json") ||
    mimeType.includes("javascript") ||
    mimeType.includes("typescript") ||
    mimeType.includes("xml") ||
    mimeType.includes("yaml") ||
    mimeType.includes("x-sh") ||
    /\.(json|js|jsx|ts|tsx|py|java|kt|kts|go|rb|php|cs|cpp|c|h|sql|yaml|yml|xml|sh|mdx?)$/.test(
      fileName,
    );

  if (isCodeLike) {
    return <FileCode size={18} className="text-primary" />;
  }

  return <FileText size={18} className="text-primary" />;
};

const getAttentionReason = ({
  blocker,
  pendingRequest,
  wait,
}: {
  blocker?: WorkItem["blocker"];
  pendingRequest?: WorkItem["pendingRequest"];
  wait?: RunWait | null;
}) => blocker?.message || wait?.message || pendingRequest?.message || "";

const getAttentionLabel = ({
  blocker,
  pendingRequest,
  wait,
}: {
  blocker?: WorkItem["blocker"];
  pendingRequest?: WorkItem["pendingRequest"];
  wait?: RunWait | null;
}) => {
  if (blocker?.status === "OPEN") {
    return blocker.type === "HUMAN_INPUT"
      ? "Waiting for human input"
      : "Waiting for conflict resolution";
  }

  if (wait?.type === "APPROVAL" || pendingRequest?.type === "APPROVAL") {
    return "Waiting for approval";
  }

  if (wait?.type === "INPUT" || pendingRequest?.type === "INPUT") {
    return "Waiting for input";
  }

  if (
    wait?.type === "CONFLICT_RESOLUTION" ||
    pendingRequest?.type === "CONFLICT_RESOLUTION"
  ) {
    return "Waiting for conflict resolution";
  }

  return "Action required";
};

const getAttentionCallToAction = ({
  blocker,
  pendingRequest,
  wait,
}: {
  blocker?: WorkItem["blocker"];
  pendingRequest?: WorkItem["pendingRequest"];
  wait?: RunWait | null;
}) => {
  if (wait?.type === "APPROVAL" || pendingRequest?.type === "APPROVAL") {
    return "Review approval";
  }

  if (wait?.type === "INPUT" || pendingRequest?.type === "INPUT") {
    return "Provide input";
  }

  if (
    blocker?.type === "HUMAN_INPUT" ||
    wait?.type === "CONFLICT_RESOLUTION" ||
    pendingRequest?.type === "CONFLICT_RESOLUTION"
  ) {
    return "Resolve now";
  }

  return "Open controls";
};

const getWorkItemAttentionTimestamp = (item: WorkItem) =>
  item.blocker?.timestamp ||
  item.pendingRequest?.timestamp ||
  item.history.slice(-1)[0]?.timestamp;

const buildBlockedGuidanceSeed = (reason: string) =>
  `Blocking reason from agent:\n- ${reason}\n\nGuidance for the next attempt:\n- `;

const getRunEventTone = (event: RunEvent) => {
  if (
    event.level === "ERROR" ||
    event.type === "STEP_FAILED" ||
    event.type === "TOOL_FAILED"
  ) {
    return "danger" as const;
  }

  if (event.type === "STEP_WAITING") {
    return "warning" as const;
  }

  if (event.type === "STEP_COMPLETED" || event.type === "TOOL_COMPLETED") {
    return "success" as const;
  }

  if (event.type === "STEP_PROGRESS" || event.type === "TOOL_STARTED") {
    return "info" as const;
  }

  return getStatusTone(event.level);
};

const getRunEventLabel = (event: RunEvent) => {
  const stage =
    typeof event.details?.stage === "string" ? event.details.stage : event.type;
  return formatEnumLabel(stage);
};

const getContrarianReview = (
  wait?: RunWait | null,
): ContrarianConflictReview | undefined => {
  const review = wait?.payload?.contrarianReview;
  return review && typeof review === "object" ? review : undefined;
};

const buildGuidanceSuggestions = ({
  workItem,
  wait,
  requestedInputFields,
}: {
  workItem?: WorkItem | null;
  wait?: RunWait | null;
  requestedInputFields: CompiledRequiredInputField[];
}) => {
  const suggestions = new Set<string>();

  requestedInputFields.forEach((field) => {
    suggestions.add(
      `Provide ${field.label.toLowerCase()} with concrete values and constraints.`,
    );
  });

  if (wait?.type === "APPROVAL") {
    suggestions.add(
      "State the conditions the agent must satisfy before continuing.",
    );
  }

  if (wait?.type === "INPUT") {
    suggestions.add(
      "Give the exact missing business or technical detail instead of a general instruction.",
    );
  }

  if (wait?.type === "CONFLICT_RESOLUTION") {
    suggestions.add(
      "Choose the final path and explain the tradeoff the agent should honor.",
    );
  }

  if (workItem?.status === "BLOCKED" && !wait) {
    suggestions.add(
      "Explain what changed since the failed attempt and what the agent should do differently on retry.",
    );
    suggestions.add(
      "Reference approved paths, commands, constraints, or acceptance criteria the agent should follow.",
    );
  }

  return Array.from(suggestions).slice(0, 3);
};

const getContrarianReviewTone = (review?: ContrarianConflictReview) => {
  if (!review) {
    return "neutral" as const;
  }

  if (review.status === "ERROR" || review.severity === "CRITICAL") {
    return "danger" as const;
  }

  if (review.status === "PENDING" || review.severity === "HIGH") {
    return "warning" as const;
  }

  if (review.severity === "LOW" && review.recommendation === "CONTINUE") {
    return "success" as const;
  }

  return "info" as const;
};

const asCompiledStepContext = (
  value: unknown,
): CompiledStepContext | undefined =>
  value && typeof value === "object"
    ? normalizeCompiledStepContext(value as Partial<CompiledStepContext>)
    : undefined;

const asCompiledWorkItemPlan = (
  value: unknown,
): CompiledWorkItemPlan | undefined =>
  value && typeof value === "object"
    ? (value as CompiledWorkItemPlan)
    : undefined;

const asCompiledInputFields = (value: unknown): CompiledRequiredInputField[] =>
  Array.isArray(value) ? (value as CompiledRequiredInputField[]) : [];

const isConflictAttention = (item: WorkItem) =>
  item.blocker?.type === "CONFLICT_RESOLUTION" ||
  item.pendingRequest?.type === "CONFLICT_RESOLUTION";

const renderReviewList = (items: string[], emptyLabel: string) =>
  items.length > 0 ? (
    <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="mt-2 text-xs leading-relaxed text-secondary">{emptyLabel}</p>
  );

const renderStructuredInputs = (
  items: CompiledRequiredInputField[],
  emptyLabel: string,
) =>
  items.length > 0 ? (
    <div className="mt-3 space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-2xl border border-outline-variant/30 bg-white/85 px-3 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-on-surface">
              {item.label}
            </p>
            <StatusBadge tone={item.status === "READY" ? "success" : "warning"}>
              {item.status === "READY" ? "Ready" : "Missing"}
            </StatusBadge>
          </div>
          {item.description ? (
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              {item.description}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.72rem] text-secondary">
            <span>Source: {formatEnumLabel(item.source)}</span>
            <span>Type: {formatEnumLabel(item.kind)}</span>
            {item.valueSummary ? (
              <span>Current: {item.valueSummary}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p className="mt-3 text-xs leading-relaxed text-secondary">{emptyLabel}</p>
  );

const renderArtifactChecklist = (items: CompiledArtifactChecklistItem[]) =>
  items.length > 0 ? (
    <div className="mt-3 space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-outline-variant/30 bg-white/85 px-3 py-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface">
              {item.label}
            </p>
            {item.description ? (
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                {item.description}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={item.direction === "INPUT" ? "info" : "neutral"}>
              {item.direction}
            </StatusBadge>
            <StatusBadge tone={item.status === "READY" ? "success" : "warning"}>
              {item.status === "READY" ? "Ready" : "Expected"}
            </StatusBadge>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p className="mt-3 text-xs leading-relaxed text-secondary">
      This step does not declare an artifact checklist yet.
    </p>
  );

const renderAgentArtifactExpectations = (
  items: AgentArtifactExpectation[],
  emptyLabel: string,
  tone: "neutral" | "brand",
) =>
  items.length > 0 ? (
    <div className="mt-3 flex flex-wrap gap-2">
      {items.map((item) => (
        <StatusBadge key={`${item.direction}:${item.artifactName}`} tone={tone}>
          {item.artifactName}
        </StatusBadge>
      ))}
    </div>
  ) : (
    <p className="mt-3 text-xs leading-relaxed text-secondary">{emptyLabel}</p>
  );

const getLatestRunFailureReason = ({
  run,
  runSteps,
  runEvents,
}: {
  run?: WorkflowRun | null;
  runSteps?: WorkflowRunDetail["steps"];
  runEvents?: RunEvent[];
}) => {
  const failedStep = [...(runSteps || [])]
    .reverse()
    .find((step) => step.status === "FAILED");
  const failedEvent = [...(runEvents || [])]
    .reverse()
    .find((event) => event.level === "ERROR" || event.type === "STEP_FAILED");

  return (
    failedStep?.outputSummary ||
    failedStep?.evidenceSummary ||
    (typeof failedStep?.metadata?.lastError === "string"
      ? failedStep.metadata.lastError
      : undefined) ||
    run?.terminalOutcome ||
    failedEvent?.message ||
    ""
  );
};

const Orchestrator = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    activeCapability,
    currentActorContext,
    getCapabilityWorkspace,
    refreshCapabilityBundle,
    updateCapabilityMetadata,
    setActiveChatAgent,
    workspaceOrganization,
  } = useCapability();
  const { error: showError, success } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const permissionSet = activeCapability.effectivePermissions;
  const canReadLiveDetail = canReadCapabilityLiveDetail(permissionSet);
  const canEditCapability = hasPermission(permissionSet, "capability.edit");
  const canCreateWorkItems = hasPermission(permissionSet, "workitem.create");
  const canClaimExecution = hasPermission(
    permissionSet,
    "capability.execution.claim",
  );
  const canControlWorkItems = hasPermission(permissionSet, "workitem.control");
  const canRestartWorkItems = hasPermission(permissionSet, "workitem.restart");
  const canDecideApprovals = hasPermission(permissionSet, "approval.decide");
  const canReadChat = hasPermission(permissionSet, "chat.read");
  const canWriteChat = hasPermission(permissionSet, "chat.write");
  const lifecycleBoardPhases = useMemo(
    () => getCapabilityBoardPhaseIds(activeCapability),
    [activeCapability],
  );
  const phaseMeta = useMemo(() => {
    const visiblePhaseIds = lifecycleBoardPhases.filter(
      (phase) => phase !== "BACKLOG" && phase !== "DONE",
    );
    const meta = new Map<WorkItemPhase, { label: string; accent: string }>();
    meta.set("BACKLOG", {
      label: getLifecyclePhaseLabel(activeCapability, "BACKLOG"),
      accent: "bg-slate-100 text-slate-700",
    });
    meta.set("DONE", {
      label: getLifecyclePhaseLabel(activeCapability, "DONE"),
      accent: "bg-surface-container-high text-secondary",
    });
    visiblePhaseIds.forEach((phase, index) => {
      meta.set(phase, {
        label: getLifecyclePhaseLabel(activeCapability, phase),
        accent: PHASE_ACCENTS[index % PHASE_ACCENTS.length],
      });
    });
    return meta;
  }, [activeCapability, lifecycleBoardPhases]);
  const getPhaseMeta = useCallback(
    (phase?: WorkItemPhase) =>
      phaseMeta.get(phase || "") || {
        label: getLifecyclePhaseLabel(activeCapability, phase),
        accent: "bg-surface-container-high text-secondary",
      },
    [activeCapability, phaseMeta],
  );

  const [view, setView] = useState<OrchestratorView>(() =>
    readSessionValue(STORAGE_KEYS.view, "list"),
  );
  const [detailTab, setDetailTab] = useState<DetailTab>(() => {
    const stored = readSessionValue(
      STORAGE_KEYS.detailTab,
      "operate",
    ) as string;
    if (stored === "overview" || stored === "control") {
      return "operate";
    }
    if (stored === "progress") {
      return "attempts";
    }
    if (stored === "outputs") {
      return "artifacts";
    }
    return stored as DetailTab;
  });
  const [searchQuery, setSearchQuery] = useState<string>(() =>
    readSessionValue(STORAGE_KEYS.search, ""),
  );
  const [workflowFilter, setWorkflowFilter] = useState<string>(() =>
    readSessionValue(STORAGE_KEYS.workflow, "ALL"),
  );
  const [statusFilter, setStatusFilter] = useState<WorkItemStatusFilter>(
    () => readSessionValue(STORAGE_KEYS.status, "ALL") as WorkItemStatusFilter,
  );
  const [priorityFilter, setPriorityFilter] = useState<WorkItemPriorityFilter>(
    () =>
      readSessionValue(STORAGE_KEYS.priority, "ALL") as WorkItemPriorityFilter,
  );
  const [isInboxFilterTrayOpen, setIsInboxFilterTrayOpen] = useState<boolean>(
    () => {
      const workflow = readSessionValue(STORAGE_KEYS.workflow, "ALL");
      const status = readSessionValue(STORAGE_KEYS.status, "ALL");
      const priority = readSessionValue(STORAGE_KEYS.priority, "ALL");
      return workflow !== "ALL" || status !== "ALL" || priority !== "ALL";
    },
  );
  const [queueView, setQueueView] = useState<WorkbenchQueueView>(
    () =>
      readSessionValue(
        STORAGE_KEYS.queueView,
        "MY_QUEUE",
      ) as WorkbenchQueueView,
  );
  const [draggedWorkItemId, setDraggedWorkItemId] = useState<string | null>(
    null,
  );
  const [dragOverPhase, setDragOverPhase] = useState<WorkItemPhase | null>(
    null,
  );
  const [phaseRailPreviewPhase, setPhaseRailPreviewPhase] =
    useState<WorkItemPhase | null>(null);
  const [isPhaseRailDragging, setIsPhaseRailDragging] = useState(false);
  const [actionError, setActionError] = useState("");
  const [approvedWorkspaceDraft, setApprovedWorkspaceDraft] = useState("");
  const [approvedWorkspaceValidation, setApprovedWorkspaceValidation] =
    useState<WorkspacePathValidationResult | null>(null);
  const [desktopWorkspaceMappings, setDesktopWorkspaceMappings] = useState<
    DesktopWorkspaceMapping[]
  >([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [artifactFilter, setArtifactFilter] =
    useState<ArtifactWorkbenchFilter>("ALL");
  const [approvalArtifactFilter, setApprovalArtifactFilter] =
    useState<ArtifactWorkbenchFilter>("ALL");
  const [stageChatInput, setStageChatInput] = useState("");
  const [stageChatDraft, setStageChatDraft] = useState("");
  const [stageChatError, setStageChatError] = useState("");
  const [isStageChatSending, setIsStageChatSending] = useState(false);
  const [stageChatByScope, setStageChatByScope] = useState<
    Record<string, StageChatMessage[]>
  >({});
  const stageChatThreadRef = useRef<HTMLDivElement | null>(null);
  const stageChatStickToBottomRef = useRef(true);
  const stageChatScrollFrameRef = useRef(0);
  const stageChatRequestRef = useRef(0);
  const phaseRailTrackRef = useRef<HTMLDivElement | null>(null);
  const selectionFocusRef = useRef<WorkbenchSelectionFocus | null>(null);
  const resolutionNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const [draftWorkItem, setDraftWorkItem] = useState({
    title: "",
    description: "",
    workflowId: workspace.workflows[0]?.id || "",
    taskType: DEFAULT_WORK_ITEM_TASK_TYPE as WorkItemTaskType,
    phaseStakeholders: [] as WorkItemPhaseStakeholderAssignment[],
    attachments: [] as WorkItemAttachmentUpload[],
    priority: "Med" as WorkItem["priority"],
    tags: "",
  });

  const {
    runtimeStatus,
    runtimeError,
    executionClaimBusy,
    loadRuntime,
    handleClaimDesktopExecution,
    handleReleaseDesktopExecution,
  } = useOrchestratorRuntime({
    activeCapabilityId: activeCapability.id,
    activeCapabilityName: activeCapability.name,
    canClaimExecution,
    refreshCapabilityBundle,
    showError,
    success,
  });

  useEffect(() => {
    let isMounted = true;

    if (!runtimeStatus?.executorId || !currentActorContext.userId) {
      setDesktopWorkspaceMappings([]);
      return () => {
        isMounted = false;
      };
    }

    void fetchDesktopWorkspaceMappings({
      executorId: runtimeStatus.executorId,
      userId: currentActorContext.userId,
      capabilityId: activeCapability.id,
    })
      .then((mappings) => {
        if (isMounted) {
          setDesktopWorkspaceMappings(mappings);
        }
      })
      .catch(() => {
        if (isMounted) {
          setDesktopWorkspaceMappings([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [
    activeCapability.id,
    currentActorContext.userId,
    runtimeStatus?.executorId,
  ]);

  const {
    selectedWorkItemId,
    setSelectedWorkItemId,
    workItemOverrides,
    setWorkItemOverrides,
    workItems,
    selectedRunDetail,
    setSelectedRunDetail,
    selectedRunEvents,
    setSelectedRunEvents,
    selectedRunHistory,
    setSelectedRunHistory,
    selectedArtifactId,
    setSelectedArtifactId,
    selectedApprovalArtifactId,
    setSelectedApprovalArtifactId,
    selectedClaims,
    setSelectedClaims,
    selectedPresence,
    setSelectedPresence,
    selectedExecutionContext,
    setSelectedExecutionContext,
    selectedHandoffs,
    setSelectedHandoffs,
    loadSelectedRunData,
    refreshSelection,
  } = useOrchestratorSelection({
    activeCapabilityId: activeCapability.id,
    currentActorContext,
    workspaceWorkItems: workspace.workItems,
    refreshCapabilityBundle,
    onError: setActionError,
  });

  const {
    dockInput,
    setDockInput,
    dockDraft,
    setDockDraft,
    dockError,
    setDockError,
    isDockSending,
    setIsDockSending,
    dockUploads,
    setDockUploads,
    dockUploadsRef,
    dockThreadRef,
    dockTextareaRef,
    dockStickToBottomRef,
    dockScrollFrameRef,
    dockRequestRef,
    focusDockComposer,
    addDockUploadFiles,
    removeDockUpload,
    clearDockUploads,
  } = useOrchestratorDock({
    view,
    selectedWorkItemId,
    workspaceMessageCount: workspace.messages.length,
    showError,
  });

  const workflowsById = useMemo(
    () =>
      new Map(workspace.workflows.map((workflow) => [workflow.id, workflow])),
    [workspace.workflows],
  );
  const agentsById = useMemo(
    () => new Map(workspace.agents.map((agent) => [agent.id, agent])),
    [workspace.agents],
  );
  const visibleLifecyclePhases = useMemo(
    () => getCapabilityVisibleLifecyclePhases(activeCapability.lifecycle),
    [activeCapability.lifecycle],
  );
  const visibleLifecyclePhaseIds = useMemo(
    () => new Set(visibleLifecyclePhases.map((phase) => phase.id)),
    [visibleLifecyclePhases],
  );

  const focusGuidanceComposer = useCallback(() => {
    setDetailTab("operate");
    window.requestAnimationFrame(() => {
      resolutionNoteRef.current?.focus();
      resolutionNoteRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, []);

  const selectWorkItem = useCallback(
    (
      workItemId: string,
      options?: {
        focusBoard?: boolean;
        openControl?: boolean;
        focus?: WorkbenchSelectionFocus;
      },
    ) => {
      stageChatRequestRef.current += 1;
      if (options?.focus) {
        selectionFocusRef.current = options.focus;
      }
      setSelectedWorkItemId(workItemId);
      setActionError("");
      setResolutionNote("");
      setIsStageChatSending(false);
      setStageChatDraft("");
      setStageChatError("");
      if (options?.openControl) {
        setDetailTab("operate");
      }
      if (options?.focusBoard) {
        setView("board");
        window.setTimeout(() => {
          const element = document.getElementById(
            `orchestrator-item-${workItemId}`,
          );
          element?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
      }
    },
    [],
  );

  const clearSelectedWorkItem = useCallback(
    (options?: { focusBoard?: boolean }) => {
      stageChatRequestRef.current += 1;
      setSelectedWorkItemId(null);
      setResolutionNote("");
      setActionError("");
      setStageChatInput("");
      setStageChatDraft("");
      setStageChatError("");
      setIsStageChatSending(false);
      if (options?.focusBoard) {
        window.setTimeout(() => {
          const element = document.getElementById("orchestrator-flow-map");
          element?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      }
    },
    [setSelectedWorkItemId],
  );

  useEffect(() => {
    void refreshCapabilityBundle(activeCapability.id);
  }, [activeCapability.id, refreshCapabilityBundle]);

  useEffect(() => {
    const preferred =
      activeCapability.executionConfig.defaultWorkspacePath ||
      activeCapability.executionConfig.allowedWorkspacePaths[0] ||
      activeCapability.localDirectories[0] ||
      "";
    setApprovedWorkspaceDraft(preferred);
    setApprovedWorkspaceValidation(null);
  }, [activeCapability.id]);

  useEffect(() => {
    if (
      draftWorkItem.workflowId &&
      workspace.workflows.some(
        (workflow) => workflow.id === draftWorkItem.workflowId,
      )
    ) {
      return;
    }
    setDraftWorkItem((current) => ({
      ...current,
      workflowId: workspace.workflows[0]?.id || "",
    }));
  }, [draftWorkItem.workflowId, workspace.workflows]);

  useEffect(() => {
    const nextSearchParams = new URLSearchParams(searchParams);
    let shouldReplace = false;

    if (searchParams.get("new") === "1") {
      setIsCreateSheetOpen(true);
      nextSearchParams.delete("new");
      shouldReplace = true;
    }

    const selectedId = searchParams.get("selected");
    if (selectedId && workItems.some((item) => item.id === selectedId)) {
      setSelectedWorkItemId(selectedId);
      nextSearchParams.delete("selected");
      shouldReplace = true;
    }

    const queueParam = searchParams.get("queue") as WorkbenchQueueView | null;
    if (queueParam) {
      const valid: WorkbenchQueueView[] = [
        "ALL_WORK",
        "MY_QUEUE",
        "TEAM_QUEUE",
        "ATTENTION",
        "PAUSED",
        "WATCHING",
        "ARCHIVE",
      ];
      if (valid.includes(queueParam)) {
        setQueueView(queueParam);
        nextSearchParams.delete("queue");
        shouldReplace = true;
      }
    }

    if (shouldReplace) {
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, workItems]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeViewPreference(STORAGE_KEYS.view, view, { storage: "session" });
  }, [view]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeViewPreference(STORAGE_KEYS.detailTab, detailTab, {
      storage: "session",
    });
  }, [detailTab]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeViewPreference(STORAGE_KEYS.selected, selectedWorkItemId || "", {
      storage: "session",
    });
  }, [selectedWorkItemId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeViewPreference(STORAGE_KEYS.search, searchQuery, {
      storage: "session",
    });
  }, [searchQuery]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeViewPreference(STORAGE_KEYS.workflow, workflowFilter, {
      storage: "session",
    });
  }, [workflowFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeViewPreference(STORAGE_KEYS.status, statusFilter, {
      storage: "session",
    });
  }, [statusFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeViewPreference(STORAGE_KEYS.priority, priorityFilter, {
      storage: "session",
    });
  }, [priorityFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeViewPreference(STORAGE_KEYS.queueView, queueView, {
      storage: "session",
    });
  }, [queueView]);

  const filteredWorkItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const actorUserId = currentActorContext.userId;
    const actorTeamIds = currentActorContext.teamIds;

    return workItems.filter((item) => {
      const workflow = workflowsById.get(item.workflowId) || null;
      const currentStep = getCurrentWorkflowStep(workflow, null, item);
      const agentName = item.assignedAgentId
        ? agentsById.get(item.assignedAgentId)?.name || item.assignedAgentId
        : "";

      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.title.toLowerCase().includes(normalizedQuery) ||
        item.id.toLowerCase().includes(normalizedQuery) ||
        item.description.toLowerCase().includes(normalizedQuery) ||
        workflow?.name.toLowerCase().includes(normalizedQuery) ||
        currentStep?.name.toLowerCase().includes(normalizedQuery) ||
        agentName.toLowerCase().includes(normalizedQuery) ||
        item.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));

      const matchesWorkflow =
        workflowFilter === "ALL" || item.workflowId === workflowFilter;
      const matchesStatus =
        statusFilter === "ALL" || item.status === statusFilter;
      const matchesPriority =
        priorityFilter === "ALL" || item.priority === priorityFilter;
      const matchesQueueView =
        queueView === "ALL_WORK"
          ? true
          : queueView === "MY_QUEUE"
            ? Boolean(actorUserId) &&
              (item.claimOwnerUserId === actorUserId ||
                (item.phaseOwnerTeamId
                  ? actorTeamIds.includes(item.phaseOwnerTeamId)
                  : true))
            : queueView === "TEAM_QUEUE"
              ? Boolean(
                  item.phaseOwnerTeamId &&
                  actorTeamIds.includes(item.phaseOwnerTeamId),
                )
              : queueView === "ATTENTION"
                ? item.status !== "PAUSED" &&
                  (item.status === "BLOCKED" ||
                    item.status === "PENDING_APPROVAL" ||
                    Boolean(item.pendingRequest))
                : queueView === "PAUSED"
                  ? item.status === "PAUSED"
                  : queueView === "ARCHIVE"
                    ? item.status === "ARCHIVED"
                    : Boolean(
                        actorUserId &&
                        item.watchedByUserIds?.includes(actorUserId),
                      );

      const hideArchivedByDefault =
        item.status === "ARCHIVED" &&
        queueView !== "ARCHIVE" &&
        statusFilter === "ALL";
      const hideBacklogByDefault =
        item.phase === "BACKLOG" &&
        queueView !== "ALL_WORK" &&
        statusFilter === "ALL";

      return (
        matchesQuery &&
        matchesWorkflow &&
        matchesStatus &&
        matchesPriority &&
        matchesQueueView &&
        !hideArchivedByDefault &&
        !hideBacklogByDefault
      );
    });
  }, [
    currentActorContext.teamIds,
    currentActorContext.userId,
    agentsById,
    priorityFilter,
    queueView,
    searchQuery,
    statusFilter,
    workflowFilter,
    workItems,
    workflowsById,
  ]);

  // Per-queue counts displayed as badges on the inbox tab strip.
  // Computed from the raw workItems list (not filtered by the active queue/search)
  // so the counts are stable while the developer types in the search box.
  const queueCounts = useMemo(() => {
    const actorUserId = currentActorContext.userId;
    const actorTeamIds = currentActorContext.teamIds;
    const counts: Partial<Record<WorkbenchQueueView, number>> = {};
    for (const item of workItems) {
      if (item.status === "ARCHIVED") {
        counts.ARCHIVE = (counts.ARCHIVE ?? 0) + 1;
        continue;
      }
      counts.ALL_WORK = (counts.ALL_WORK ?? 0) + 1;
      if (
        actorUserId &&
        (item.claimOwnerUserId === actorUserId ||
          (item.phaseOwnerTeamId
            ? actorTeamIds.includes(item.phaseOwnerTeamId)
            : true))
      ) {
        counts.MY_QUEUE = (counts.MY_QUEUE ?? 0) + 1;
      }
      if (
        item.phaseOwnerTeamId &&
        actorTeamIds.includes(item.phaseOwnerTeamId)
      ) {
        counts.TEAM_QUEUE = (counts.TEAM_QUEUE ?? 0) + 1;
      }
      if (
        item.status !== "PAUSED" &&
        (item.status === "BLOCKED" ||
          item.status === "PENDING_APPROVAL" ||
          Boolean(item.pendingRequest))
      ) {
        counts.ATTENTION = (counts.ATTENTION ?? 0) + 1;
      }
      if (item.status === "PAUSED") {
        counts.PAUSED = (counts.PAUSED ?? 0) + 1;
      }
      if (actorUserId && item.watchedByUserIds?.includes(actorUserId)) {
        counts.WATCHING = (counts.WATCHING ?? 0) + 1;
      }
    }
    return counts;
  }, [workItems, currentActorContext.userId, currentActorContext.teamIds]);

  const attentionItems = useMemo(
    () =>
      filteredWorkItems
        .filter(
          (item) =>
            item.status !== "PAUSED" &&
            item.status !== "ARCHIVED" &&
            (item.blocker?.status === "OPEN" ||
              Boolean(item.pendingRequest) ||
              item.status === "BLOCKED" ||
              item.status === "PENDING_APPROVAL"),
        )
        .map((item) => {
          const workflow = workflowsById.get(item.workflowId) || null;
          const currentStep = getCurrentWorkflowStep(workflow, null, item);
          const agentId = item.assignedAgentId || currentStep?.agentId;
          const attentionReason =
            getAttentionReason({
              blocker: item.blocker,
              pendingRequest: item.pendingRequest,
            }) || "This work item needs operator attention.";
          const attentionLabel = getAttentionLabel({
            blocker: item.blocker,
            pendingRequest: item.pendingRequest,
          });
          return {
            item,
            workflow,
            currentStep,
            agentId,
            attentionReason,
            attentionLabel,
            attentionTimestamp: getWorkItemAttentionTimestamp(item),
            hasConflictReview: isConflictAttention(item),
            callToAction: getAttentionCallToAction({
              blocker: item.blocker,
              pendingRequest: item.pendingRequest,
            }),
          };
        })
        .sort((left, right) => {
          const leftTime = left.attentionTimestamp
            ? new Date(left.attentionTimestamp).getTime()
            : 0;
          const rightTime = right.attentionTimestamp
            ? new Date(right.attentionTimestamp).getTime()
            : 0;
          return rightTime - leftTime;
        }),
    [filteredWorkItems, workflowsById],
  );

  const activeBoardPhases = useMemo(
    () => lifecycleBoardPhases.filter((phase) => phase !== "DONE"),
    [lifecycleBoardPhases],
  );

  const groupedItems = useMemo(
    () =>
      activeBoardPhases.map((phase) => ({
        phase,
        items: filteredWorkItems.filter(
          (item) =>
            item.phase === phase &&
            item.status !== "COMPLETED" &&
            item.status !== "CANCELLED" &&
            item.status !== "ARCHIVED",
        ),
      })),
    [activeBoardPhases, filteredWorkItems],
  );

  const completedItems = useMemo(
    () =>
      filteredWorkItems
        .filter(
          (item) =>
            item.status !== "ARCHIVED" &&
            (item.phase === "DONE" ||
              item.status === "COMPLETED" ||
              item.status === "CANCELLED"),
        )
        .slice()
        .sort((left, right) => {
          const leftTime = new Date(
            left.history[left.history.length - 1]?.timestamp || 0,
          ).getTime();
          const rightTime = new Date(
            right.history[right.history.length - 1]?.timestamp || 0,
          ).getTime();
          return rightTime - leftTime;
        }),
    [filteredWorkItems],
  );

  const stats = useMemo(
    () => ({
      active: workItems.filter((item) => item.status === "ACTIVE").length,
      blocked: workItems.filter((item) => item.status === "BLOCKED").length,
      approvals: workItems.filter((item) => item.status === "PENDING_APPROVAL")
        .length,
      running: workItems.filter((item) => Boolean(item.activeRunId)).length,
    }),
    [workItems],
  );

  const buildNavigatorItem = useCallback(
    (item: WorkItem): WorkNavigatorItem => {
      const workflow = workflowsById.get(item.workflowId) || null;
      const currentStep = getCurrentWorkflowStep(workflow, null, item);
      const agentId = item.assignedAgentId || currentStep?.agentId;
      return {
        item,
        attentionLabel:
          item.blocker?.status === "OPEN" || item.pendingRequest
            ? getAttentionLabel({
                blocker: item.blocker,
                pendingRequest: item.pendingRequest,
              })
            : undefined,
        attentionReason:
          item.blocker?.status === "OPEN" || item.pendingRequest
            ? getAttentionReason({
                blocker: item.blocker,
                pendingRequest: item.pendingRequest,
              })
            : undefined,
        currentStepName: currentStep?.name || "Awaiting orchestration",
        agentName:
          agentsById.get(agentId || "")?.name || agentId || "Unassigned",
        ageLabel: formatRelativeTime(
          item.history[item.history.length - 1]?.timestamp,
        ),
      };
    },
    [agentsById, workflowsById],
  );

  const navigatorSections = useMemo<WorkNavigatorSection[]>(
    () => [
      {
        id: "attention",
        title: "Needs attention",
        helper: "Approvals, blockers, and waits that need operator action now.",
        items: attentionItems
          .slice(0, 6)
          .map((entry) => buildNavigatorItem(entry.item)),
      },
      {
        id: "active",
        title: "Active work",
        helper: "Current in-flight items across the capability.",
        items: filteredWorkItems
          .filter((item) => item.status !== "ARCHIVED")
          .filter(
            (item) => item.status !== "COMPLETED" && item.phase !== "DONE",
          )
          .filter((item) => item.status !== "CANCELLED")
          .filter((item) => item.status !== "PAUSED")
          .slice(0, 12)
          .map(buildNavigatorItem),
      },
      {
        id: "paused",
        title: "Paused",
        helper:
          "Items intentionally paused. Resume them when you are ready to re-enter the flow.",
        items: filteredWorkItems
          .filter((item) => item.status === "PAUSED")
          .slice(0, 12)
          .map(buildNavigatorItem),
      },
      {
        id: "completed",
        title: "Completed",
        helper:
          "Recently finished work kept nearby for review and traceability.",
        items: completedItems.slice(0, 8).map(buildNavigatorItem),
      },
      {
        id: "archive",
        title: "Archive",
        helper:
          "Soft-deleted items kept out of the active queues. Restore them to restart from intake.",
        items: filteredWorkItems
          .filter((item) => item.status === "ARCHIVED")
          .slice(0, 12)
          .map(buildNavigatorItem),
      },
    ],
    [attentionItems, buildNavigatorItem, completedItems, filteredWorkItems],
  );

  const selectedWorkItem =
    workItems.find((item) => item.id === selectedWorkItemId) || null;
  const selectedWorkflow = selectedWorkItem
    ? workflowsById.get(selectedWorkItem.workflowId) || null
    : null;
  const selectedRunRecord = selectedRunDetail?.run || null;

  useEffect(() => {
    setPhaseRailPreviewPhase(null);
    setIsPhaseRailDragging(false);
  }, [selectedWorkItemId, selectedWorkItem?.phase, view]);

  const selectedRunSteps = useMemo(
    () =>
      Array.isArray(selectedRunDetail?.steps) ? selectedRunDetail.steps : [],
    [selectedRunDetail?.steps],
  );
  const selectedCurrentStep = getCurrentWorkflowStep(
    selectedWorkflow,
    selectedRunDetail,
    selectedWorkItem,
  );
  const selectedRunStep =
    selectedRunSteps.find(
      (step) =>
        step.workflowStepId === selectedRunRecord?.currentStepId ||
        step.workflowNodeId === selectedRunRecord?.currentNodeId,
    ) || null;
  const selectedOpenWait = getSelectedRunWait(selectedRunDetail);
  const selectedCompiledStepContext =
    asCompiledStepContext(selectedRunStep?.metadata?.compiledStepContext) ||
    asCompiledStepContext(selectedOpenWait?.payload?.compiledStepContext);
  const selectedCompiledWorkItemPlan =
    asCompiledWorkItemPlan(selectedRunStep?.metadata?.compiledWorkItemPlan) ||
    asCompiledWorkItemPlan(selectedOpenWait?.payload?.compiledWorkItemPlan);
  const selectedRequestedInputFields = asCompiledInputFields(
    selectedOpenWait?.payload?.requestedInputFields,
  );
  const approvedWorkspaceRoots = useMemo(
    () =>
      Array.from(
        new Set(
          desktopWorkspaceMappings
            .filter((mapping) => mapping.validation.valid)
            .map((mapping) => mapping.localRootPath)
            .filter(Boolean),
        ),
      ),
    [desktopWorkspaceMappings],
  );
  const hasApprovedWorkspaceConfigured = approvedWorkspaceRoots.length > 0;
  const waitRequiresApprovedWorkspace = selectedRequestedInputFields.some(
    (field) => field.id === "approved-workspace",
  );
  const waitOnlyRequestsApprovedWorkspace = Boolean(
    waitRequiresApprovedWorkspace &&
    selectedRequestedInputFields.length > 0 &&
    selectedRequestedInputFields.every(
      (field) => field.id === "approved-workspace",
    ),
  );

  const preferredApprovedWorkspaceRoot = useMemo(() => {
    // Priority: user-level desktop dir → per-capability mapping → capability
    // metadata → first approved root. The user-level dir (from executor
    // registration's working_directory) wins when the desktop client includes
    // it in runtimeStatus — this makes workspace config capability-independent.
    const desktopUserLevelDir =
      typeof runtimeStatus?.workingDirectory === "string" &&
      runtimeStatus.workingDirectory.trim()
        ? runtimeStatus.workingDirectory.trim()
        : "";
    const mappedWorkingDirectory =
      desktopWorkspaceMappings.find((mapping) => mapping.validation.valid)
        ?.workingDirectoryPath ||
      desktopWorkspaceMappings.find((mapping) => mapping.validation.valid)
        ?.localRootPath ||
      "";
    const legacySuggestion =
      String(
        activeCapability.executionConfig.defaultWorkspacePath || "",
      ).trim() ||
      activeCapability.localDirectories.find(Boolean) ||
      "";
    return (
      desktopUserLevelDir ||
      mappedWorkingDirectory ||
      legacySuggestion ||
      approvedWorkspaceRoots[0] ||
      ""
    );
  }, [
    runtimeStatus?.workingDirectory,
    activeCapability.executionConfig.defaultWorkspacePath,
    activeCapability.localDirectories,
    approvedWorkspaceRoots,
    desktopWorkspaceMappings,
  ]);

  useEffect(() => {
    if (!waitRequiresApprovedWorkspace) {
      return;
    }

    if (approvedWorkspaceDraft.trim()) {
      return;
    }

    if (preferredApprovedWorkspaceRoot) {
      setApprovedWorkspaceDraft(preferredApprovedWorkspaceRoot);
    }
  }, [
    approvedWorkspaceDraft,
    preferredApprovedWorkspaceRoot,
    selectedWorkItemId,
    waitRequiresApprovedWorkspace,
  ]);

  useEffect(() => {
    const focus = selectionFocusRef.current;
    if (!focus || detailTab !== "operate") {
      return;
    }

    const targetId =
      focus === "INPUT" &&
      waitRequiresApprovedWorkspace &&
      !hasApprovedWorkspaceConfigured
        ? "orchestrator-structured-input"
        : "orchestrator-guidance";
    const element = document.getElementById(targetId);
    if (!element) {
      return;
    }

    selectionFocusRef.current = null;
    element.scrollIntoView({ behavior: "smooth", block: "center" });

    if (
      targetId === "orchestrator-guidance" &&
      (focus === "RESOLUTION" || focus === "INPUT")
    ) {
      window.requestAnimationFrame(() => {
        resolutionNoteRef.current?.focus();
      });
    }
  }, [
    detailTab,
    hasApprovedWorkspaceConfigured,
    selectedOpenWait?.type,
    selectedWorkItemId,
    waitRequiresApprovedWorkspace,
  ]);
  const selectedCodeDiffArtifactId =
    typeof selectedOpenWait?.payload?.codeDiffArtifactId === "string"
      ? selectedOpenWait.payload.codeDiffArtifactId
      : undefined;
  const selectedHasCodeDiffApproval =
    selectedOpenWait?.type === "APPROVAL" &&
    Boolean(selectedCodeDiffArtifactId);
  const {
    isCreateSheetOpen,
    setIsCreateSheetOpen,
    isCancelWorkItemOpen,
    setIsCancelWorkItemOpen,
    cancelWorkItemNote,
    setCancelWorkItemNote,
    isArchiveWorkItemOpen,
    setIsArchiveWorkItemOpen,
    archiveWorkItemNote,
    setArchiveWorkItemNote,
    isRestoreWorkItemOpen,
    setIsRestoreWorkItemOpen,
    restoreWorkItemNote,
    setRestoreWorkItemNote,
    phaseMoveRequest,
    setPhaseMoveRequest,
    phaseMoveNote,
    setPhaseMoveNote,
    isDiffReviewOpen,
    setIsDiffReviewOpen,
    isApprovalReviewOpen,
    setIsApprovalReviewOpen,
    isApprovalReviewHydrated,
    setIsApprovalReviewHydrated,
    approvalReviewWaitSnapshot,
    setApprovalReviewWaitSnapshot,
    isExplainOpen,
    setIsExplainOpen,
    isStageControlOpen,
    setIsStageControlOpen,
    handleOpenApprovalReview: openApprovalReviewModal,
  } = useOrchestratorModals({
    selectedOpenWait,
    selectedWorkItem,
    selectedHasCodeDiffApproval,
  });

  // Phase-segment dialog state. A single work-item id is tracked; null
  // means the dialog is closed. Kept here (not in useOrchestratorModals)
  // to avoid widening that hook's contract for a feature it doesn't
  // otherwise coordinate.
  const [startSegmentWorkItemId, setStartSegmentWorkItemId] = useState<
    string | null
  >(null);
  const [startSegmentError, setStartSegmentError] = useState<string | null>(
    null,
  );
  const [startSegmentBusy, setStartSegmentBusy] = useState(false);

  const openStartSegmentDialog = useCallback(
    (workItemId: string) => {
      setStartSegmentError(null);
      setStartSegmentWorkItemId(workItemId);
    },
    [],
  );
  const closeStartSegmentDialog = useCallback(() => {
    if (startSegmentBusy) return;
    setStartSegmentWorkItemId(null);
    setStartSegmentError(null);
  }, [startSegmentBusy]);
  const selectedContrarianReview =
    selectedOpenWait?.type === "CONFLICT_RESOLUTION"
      ? getContrarianReview(selectedOpenWait)
      : undefined;
  const selectedContrarianReviewTone = getContrarianReviewTone(
    selectedContrarianReview,
  );
  const selectedContrarianReviewIsReady =
    selectedContrarianReview?.status === "READY";
  const selectedAgentId =
    selectedRunRecord?.assignedAgentId ||
    selectedCurrentStep?.agentId ||
    selectedWorkItem?.assignedAgentId;
  const selectedAgent = selectedAgentId
    ? agentsById.get(selectedAgentId) || null
    : null;
  const selectedAttentionReason = selectedWorkItem
    ? getAttentionReason({
        blocker: selectedWorkItem.blocker,
        pendingRequest: selectedWorkItem.pendingRequest,
        wait: selectedOpenWait,
      }) ||
      (selectedWorkItem.status === "BLOCKED"
        ? "This work item is blocked and needs operator action before orchestration can continue."
        : "")
    : "";
  const selectedAttentionLabel = selectedWorkItem
    ? getAttentionLabel({
        blocker: selectedWorkItem.blocker,
        pendingRequest: selectedWorkItem.pendingRequest,
        wait: selectedOpenWait,
      })
    : "Action required";
  const selectedAttentionRequestedBy =
    selectedWorkItem?.blocker?.requestedBy ||
    selectedOpenWait?.requestedBy ||
    selectedWorkItem?.pendingRequest?.requestedBy ||
    selectedAgent?.id;
  const selectedAttentionTimestamp =
    selectedWorkItem?.blocker?.timestamp ||
    selectedOpenWait?.createdAt ||
    selectedWorkItem?.pendingRequest?.timestamp ||
    selectedWorkItem?.history.slice(-1)[0]?.timestamp;
  const selectedResetStep = selectedWorkflow?.steps[0] || null;
  const selectedResetPhase = selectedResetStep?.phase || "BACKLOG";
  const selectedResetAgent = selectedResetStep?.agentId
    ? agentsById.get(selectedResetStep.agentId) || null
    : null;
  const phaseMoveItem = phaseMoveRequest
    ? workItems.find((item) => item.id === phaseMoveRequest.workItemId) || null
    : null;
  const workspaceUsersById = useMemo(
    () => new Map(workspaceOrganization.users.map((user) => [user.id, user])),
    [workspaceOrganization.users],
  );
  const workspaceTeamsById = useMemo(
    () => new Map(workspaceOrganization.teams.map((team) => [team.id, team])),
    [workspaceOrganization.teams],
  );
  const selectedPhaseOwnerTeam =
    (selectedWorkItem?.phaseOwnerTeamId
      ? workspaceTeamsById.get(selectedWorkItem.phaseOwnerTeamId)
      : null) || null;
  const selectedClaimOwner =
    (selectedWorkItem?.claimOwnerUserId
      ? workspaceUsersById.get(selectedWorkItem.claimOwnerUserId)
      : null) || null;
  const selectedEffectiveExecutionContext =
    selectedExecutionContext || selectedWorkItem?.executionContext || null;
  const selectedSharedBranch =
    selectedEffectiveExecutionContext?.branch || null;
  const selectedExecutionRepository =
    activeCapability.repositories?.find(
      (repository) =>
        repository.id ===
        (selectedEffectiveExecutionContext?.primaryRepositoryId ||
          selectedSharedBranch?.repositoryId),
    ) || null;
  const selectedActiveWriter =
    (selectedEffectiveExecutionContext?.activeWriterUserId
      ? workspaceUsersById.get(
          selectedEffectiveExecutionContext.activeWriterUserId,
        )
      : null) || null;
  const latestSelectedHandoff = selectedHandoffs[0] || null;
  const selectedPresenceUsers = selectedPresence
    .map((entry) => workspaceUsersById.get(entry.userId) || null)
    .filter(Boolean) as NonNullable<typeof selectedClaimOwner>[];

  const currentRun = selectedRunRecord || selectedRunHistory[0] || null;
  const currentRunId =
    currentRun?.id ||
    selectedWorkItem?.activeRunId ||
    selectedRunHistory[0]?.id ||
    null;
  const releasePassportRun =
    currentRun && PASSPORT_ELIGIBLE_RUN_STATUSES.has(currentRun.status)
      ? currentRun
      : null;
  const canOpenReleasePassport = Boolean(
    selectedWorkItem && releasePassportRun,
  );
  const currentRunIsActive = Boolean(
    currentRun && ACTIVE_RUN_STATUSES.includes(currentRun.status),
  );
  const runtimeReady = Boolean(
    runtimeStatus &&
    (runtimeStatus.runtimeOwner === "DESKTOP"
      ? runtimeStatus.configured
      : runtimeStatus.executionRuntimeOwner === "DESKTOP" ||
        runtimeStatus.configured) &&
    !runtimeError,
  );
  const capabilityExperience = useMemo(
    () =>
      buildCapabilityExperience({
        capability: activeCapability,
        workspace,
        runtimeStatus,
      }),
    [activeCapability, runtimeStatus, workspace],
  );
  const readinessContract = capabilityExperience.readinessContract;
  const primaryReadinessGate =
    readinessContract.gates.find((gate) => !gate.satisfied) || null;
  const deliveryBlockingItem =
    capabilityExperience.blockingReadinessItems[0] || null;
  const primaryCopilotAgent =
    capabilityExperience.primaryCopilotAgent ||
    (workspace.primaryCopilotAgentId
      ? agentsById.get(workspace.primaryCopilotAgentId) || null
      : null) ||
    selectedAgent ||
    null;
  const executionOwnership = workspace.executionOwnership || null;
  const currentDesktopOwnsExecution = Boolean(
    executionOwnership?.executorId &&
    runtimeStatus?.executorId &&
    executionOwnership.executorId === runtimeStatus.executorId,
  );
  const executionOwnerLabel = executionOwnership
    ? `${executionOwnership.actorDisplayName}${
        currentDesktopOwnsExecution ? " (this desktop)" : ""
      }`
    : "No desktop owner";
  const executionDispatchLabel =
    workspace.executionDispatchState === "ASSIGNED"
      ? "Desktop assigned"
      : workspace.executionDispatchState === "WAITING_FOR_EXECUTOR"
        ? "Waiting for desktop"
        : workspace.executionDispatchState === "STALE_EXECUTOR"
          ? "Desktop disconnected"
          : "Unassigned";
  const selectedCanTakeControl = Boolean(
    selectedWorkItem &&
    selectedWorkItem.status !== "ARCHIVED" &&
    selectedAgent &&
    runtimeReady &&
    canControlWorkItems,
  );
  const selectedCanGuideBlockedAgent = Boolean(
    selectedWorkItem &&
    selectedWorkItem.status === "BLOCKED" &&
    !selectedOpenWait &&
    !currentRunIsActive &&
    runtimeReady &&
    canRestartWorkItems,
  );
  const guidanceSuggestions = buildGuidanceSuggestions({
    workItem: selectedWorkItem,
    wait: selectedOpenWait,
    requestedInputFields: selectedRequestedInputFields,
  });

  const canStartExecution =
    Boolean(selectedWorkItem) &&
    selectedWorkItem?.status !== "ARCHIVED" &&
    selectedWorkItem?.status !== "COMPLETED" &&
    selectedWorkItem?.status !== "CANCELLED" &&
    !selectedWorkItem?.activeRunId &&
    selectedWorkItem?.phase !== "DONE" &&
    capabilityExperience.canStartDelivery &&
    runtimeReady &&
    canControlWorkItems;
  const handleOpenReleasePassport = () => {
    if (!selectedWorkItem || !releasePassportRun) {
      return;
    }
    navigate(
      `/passport/${selectedWorkItem.capabilityId}/${releasePassportRun.id}`,
    );
  };
  const currentActorOwnsSelectedWorkItem = Boolean(
    selectedWorkItem &&
    currentActorContext.userId &&
    (selectedWorkItem.claimOwnerUserId === currentActorContext.userId ||
      (selectedWorkItem.phaseOwnerTeamId &&
        currentActorContext.teamIds.includes(
          selectedWorkItem.phaseOwnerTeamId,
        ))),
  );
  const currentActorOwnsWriteControl = Boolean(
    currentActorContext.userId &&
    selectedEffectiveExecutionContext?.activeWriterUserId ===
      currentActorContext.userId,
  );
  const canInitializeExecutionContext =
    Boolean(selectedWorkItem) &&
    selectedWorkItem?.status !== "ARCHIVED" &&
    canControlWorkItems;
  const canCreateSharedBranch = Boolean(
    selectedWorkItem &&
    selectedExecutionRepository?.localRootHint &&
    selectedEffectiveExecutionContext?.branch &&
    canControlWorkItems,
  );

  const canRestartFromPhase =
    Boolean(selectedWorkItem && currentRunId) &&
    selectedWorkItem?.status !== "ARCHIVED" &&
    selectedWorkItem?.status !== "COMPLETED" &&
    selectedWorkItem?.status !== "CANCELLED" &&
    selectedWorkItem?.phase !== "DONE" &&
    capabilityExperience.canStartDelivery &&
    runtimeReady &&
    canRestartWorkItems;
  const canResetAndRestart =
    Boolean(selectedWorkItem) &&
    selectedWorkItem?.status !== "ARCHIVED" &&
    selectedWorkItem?.status !== "COMPLETED" &&
    selectedWorkItem?.status !== "CANCELLED" &&
    capabilityExperience.canStartDelivery &&
    runtimeReady &&
    canRestartWorkItems;
  const codeDiffReviewRequiresResponse = Boolean(
    selectedOpenWait?.type === "APPROVAL" && selectedCodeDiffArtifactId,
  );

  const actionButtonLabel =
    selectedOpenWait?.type === "APPROVAL"
      ? "Approve and continue"
      : selectedOpenWait?.type === "INPUT"
        ? "Submit details and unblock"
        : selectedOpenWait?.type === "CONFLICT_RESOLUTION"
          ? "Resolve conflict and unblock"
          : "Continue";

  const resolutionPlaceholder =
    selectedOpenWait?.type === "APPROVAL" && selectedCodeDiffArtifactId
      ? "Guide the developer with code review notes, implementation conditions, or sign-off guidance before continuing."
      : selectedOpenWait?.type === "APPROVAL"
        ? "Add approval notes, release conditions, or sign-off details."
        : selectedOpenWait?.type === "INPUT"
          ? "Guide the agent with the missing business, technical, or governance details needed to unblock this work item."
          : selectedOpenWait?.type === "CONFLICT_RESOLUTION"
            ? "Guide the agent with the final conflict decision and any implementation constraints."
            : selectedCanGuideBlockedAgent
              ? "Guide the next attempt. Explain what changed, what the agent should do differently, and any constraints it must respect."
              : "Approval note, human input, restart note, or cancellation reason.";
  const dockComposerLabel = selectedOpenWait
    ? selectedOpenWait.type === "APPROVAL"
      ? "Prepare approval decision"
      : selectedOpenWait.type === "INPUT"
        ? "Provide requested details"
        : "Resolve the conflict"
    : selectedCanGuideBlockedAgent
      ? "Guide the next attempt"
      : canStartExecution
        ? "Kick off execution"
        : "Ask the copilot";
  const dockComposerPlaceholder = selectedOpenWait
    ? selectedOpenWait.type === "APPROVAL"
      ? "Approval decisions now happen in the review window. Use this dock to ask the agent follow-up questions or capture context before you open the approval review."
      : resolutionPlaceholder
    : selectedCanGuideBlockedAgent
      ? "Explain what changed, what the next attempt should do differently, and any constraints it must respect."
      : canStartExecution
        ? "Add optional kickoff guidance, file hints, or execution constraints before starting the workflow."
        : "Ask the copilot about this work item, upload context, or steer the next step.";
  const dockPrimaryActionLabel = selectedOpenWait
    ? selectedOpenWait.type === "APPROVAL"
      ? "Open approval review"
      : actionButtonLabel
    : selectedCanGuideBlockedAgent
      ? "Guide and restart"
      : canStartExecution
        ? "Start execution"
        : "Send";
  const dockInterventionMode =
    selectedOpenWait?.type === "INPUT" ||
    selectedOpenWait?.type === "CONFLICT_RESOLUTION" ||
    selectedCanGuideBlockedAgent;
  const dockAllowsChatOnly = !dockInterventionMode;

  const resolutionIsRequired =
    selectedOpenWait?.type === "INPUT" ||
    selectedOpenWait?.type === "CONFLICT_RESOLUTION";
  const requestChangesIsAvailable = codeDiffReviewRequiresResponse;
  const canResolveSelectedWait =
    Boolean(selectedOpenWait) &&
    (selectedOpenWait?.type === "APPROVAL"
      ? canDecideApprovals
      : canControlWorkItems) &&
    (!resolutionIsRequired || Boolean(resolutionNote.trim()));
  const hasMissingWorkspaceInput =
    selectedRequestedInputFields.some(
      (field) => field.source === "WORKSPACE" && field.status === "MISSING",
    ) && !hasApprovedWorkspaceConfigured;
  const canRequestChanges =
    requestChangesIsAvailable &&
    Boolean(resolutionNote.trim()) &&
    canDecideApprovals;
  const canGuideAndRestart =
    selectedCanGuideBlockedAgent &&
    Boolean(resolutionNote.trim()) &&
    canRestartWorkItems;

  const requirePermission = (allowed: boolean, summary: string) => {
    if (allowed) {
      return true;
    }
    showError("Access restricted", summary);
    return false;
  };

  const stepOrder = useMemo(
    () =>
      new Map(
        (selectedWorkflow?.steps || []).map(
          (step, index) => [step.id, index] as const,
        ),
      ),
    [selectedWorkflow],
  );

  const selectedTasks = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    return workspace.tasks
      .filter((task) => task.workItemId === selectedWorkItem.id)
      .slice()
      .sort(
        (left, right) =>
          (stepOrder.get(left.workflowStepId || "") ??
            Number.MAX_SAFE_INTEGER) -
          (stepOrder.get(right.workflowStepId || "") ??
            Number.MAX_SAFE_INTEGER),
      );
  }, [selectedWorkItem, stepOrder, workspace.tasks]);

  const selectedRunStepIds = useMemo(
    () => new Set(selectedRunSteps.map((step) => step.id)),
    [selectedRunSteps],
  );

  const selectedArtifacts = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    if (!selectedRunDetail) {
      return workspace.artifacts
        .filter((artifact) => artifact.workItemId === selectedWorkItem.id)
        .slice()
        .sort(
          (left, right) =>
            new Date(right.created).getTime() -
            new Date(left.created).getTime(),
        );
    }

    return workspace.artifacts
      .filter(
        (artifact) =>
          artifact.runId === selectedRunRecord?.id ||
          artifact.sourceRunId === selectedRunRecord?.id ||
          artifact.workItemId === selectedWorkItem.id ||
          (artifact.runStepId && selectedRunStepIds.has(artifact.runStepId)),
      )
      .slice()
      .sort(
        (left, right) =>
          new Date(right.created).getTime() - new Date(left.created).getTime(),
      );
  }, [
    selectedRunDetail,
    selectedRunRecord?.id,
    selectedRunStepIds,
    selectedWorkItem,
    workspace.artifacts,
  ]);
  const selectedRunIds = useMemo(
    () =>
      new Set(
        [
          selectedRunRecord?.id,
          ...selectedRunHistory.map((run) => run.id),
        ].filter(Boolean) as string[],
      ),
    [selectedRunHistory, selectedRunRecord?.id],
  );
  const selectedWorkItemArtifacts = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    return workspace.artifacts
      .filter((artifact) => {
        if (artifact.workItemId === selectedWorkItem.id) {
          return true;
        }

        if (artifact.runId && selectedRunIds.has(artifact.runId)) {
          return true;
        }

        if (artifact.sourceRunId && selectedRunIds.has(artifact.sourceRunId)) {
          return true;
        }

        return false;
      })
      .slice()
      .sort(
        (left, right) =>
          new Date(right.created).getTime() - new Date(left.created).getTime(),
      );
  }, [selectedRunIds, selectedWorkItem, workspace.artifacts]);
  const filteredArtifacts = useMemo(
    () =>
      selectedArtifacts.filter((artifact) =>
        matchesArtifactWorkbenchFilter(artifact, artifactFilter),
      ),
    [artifactFilter, selectedArtifacts],
  );
  const filteredApprovalArtifacts = useMemo(
    () =>
      selectedWorkItemArtifacts.filter((artifact) =>
        matchesArtifactWorkbenchFilter(artifact, approvalArtifactFilter),
      ),
    [approvalArtifactFilter, selectedWorkItemArtifacts],
  );
  const selectedArtifact = useMemo(
    () =>
      (selectedArtifactId
        ? filteredArtifacts.find(
            (artifact) => artifact.id === selectedArtifactId,
          )
        : null) ||
      filteredArtifacts[0] ||
      null,
    [filteredArtifacts, selectedArtifactId],
  );
  const selectedApprovalArtifact = useMemo(() => {
    if (isApprovalReviewOpen && !selectedApprovalArtifactId) {
      return null;
    }

    return (
      (selectedApprovalArtifactId
        ? filteredApprovalArtifacts.find(
            (artifact) => artifact.id === selectedApprovalArtifactId,
          )
        : null) ||
      filteredApprovalArtifacts.find(
        (artifact) => artifact.id === selectedCodeDiffArtifactId,
      ) ||
      filteredApprovalArtifacts[0] ||
      null
    );
  }, [
    filteredApprovalArtifacts,
    isApprovalReviewOpen,
    selectedApprovalArtifactId,
    selectedCodeDiffArtifactId,
  ]);
  const selectedCodeDiffArtifact = useMemo<Artifact | null>(() => {
    if (!selectedCodeDiffArtifactId) {
      return null;
    }

    return (
      workspace.artifacts.find(
        (artifact) => artifact.id === selectedCodeDiffArtifactId,
      ) || null
    );
  }, [selectedCodeDiffArtifactId, workspace.artifacts]);
  const selectedCodeDiffDocument = useMemo(() => {
    if (!selectedCodeDiffArtifact) {
      return "";
    }

    return (
      getArtifactDocumentBody(selectedCodeDiffArtifact) ||
      selectedOpenWait?.payload?.codeDiffSummary ||
      ""
    );
  }, [selectedCodeDiffArtifact, selectedOpenWait]);
  const selectedCodeDiffRepositories = useMemo(() => {
    const repositories = (
      selectedCodeDiffArtifact?.contentJson as
        | { repositories?: Array<{ touchedFiles?: string[] }> }
        | undefined
    )?.repositories;
    return Array.isArray(repositories) ? repositories : [];
  }, [selectedCodeDiffArtifact]);
  const selectedCodeDiffRepositoryCount = selectedCodeDiffRepositories.length;
  const selectedCodeDiffTouchedFileCount = selectedCodeDiffRepositories.reduce(
    (count, repository) => count + (repository.touchedFiles?.length || 0),
    0,
  );
  const approvalReviewWait =
    selectedOpenWait?.type === "APPROVAL"
      ? selectedOpenWait
      : approvalReviewWaitSnapshot;
  const approvalAssignments = approvalReviewWait?.approvalAssignments || [];
  const approvalDecisions = approvalReviewWait?.approvalDecisions || [];
  const approvalDecisionByAssignmentId = useMemo(
    () =>
      new Map(
        approvalDecisions
          .filter(
            (
              decision,
            ): decision is ApprovalDecision & { assignmentId: string } =>
              Boolean(decision.assignmentId),
          )
          .map((decision) => [decision.assignmentId, decision]),
      ),
    [approvalDecisions],
  );
  const unassignedApprovalDecisions = useMemo(
    () => approvalDecisions.filter((decision) => !decision.assignmentId),
    [approvalDecisions],
  );

  useEffect(() => {
    if (filteredArtifacts.length === 0) {
      setSelectedArtifactId(null);
      return;
    }

    if (
      !selectedArtifactId ||
      !filteredArtifacts.some((artifact) => artifact.id === selectedArtifactId)
    ) {
      setSelectedArtifactId(filteredArtifacts[0].id);
    }
  }, [filteredArtifacts, selectedArtifactId]);

  useEffect(() => {
    if (filteredApprovalArtifacts.length === 0) {
      setSelectedApprovalArtifactId(null);
      return;
    }

    if (isApprovalReviewOpen && !selectedApprovalArtifactId) {
      return;
    }

    if (
      selectedCodeDiffArtifactId &&
      filteredApprovalArtifacts.some(
        (artifact) => artifact.id === selectedCodeDiffArtifactId,
      )
    ) {
      setSelectedApprovalArtifactId((current) =>
        current === selectedCodeDiffArtifactId
          ? current
          : selectedCodeDiffArtifactId,
      );
      return;
    }

    if (
      !selectedApprovalArtifactId ||
      !filteredApprovalArtifacts.some(
        (artifact) => artifact.id === selectedApprovalArtifactId,
      )
    ) {
      setSelectedApprovalArtifactId(filteredApprovalArtifacts[0].id);
    }
  }, [
    filteredApprovalArtifacts,
    isApprovalReviewOpen,
    selectedApprovalArtifactId,
    selectedCodeDiffArtifactId,
  ]);

  const selectedLogs = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    const relatedTaskIds = new Set<string>([
      selectedWorkItem.id,
      ...selectedTasks.map((task) => task.id),
    ]);

    return workspace.executionLogs
      .filter((log) => {
        if (selectedRunRecord && log.runId === selectedRunRecord.id) {
          return true;
        }
        return relatedTaskIds.has(log.taskId);
      })
      .slice()
      .sort(
        (left, right) =>
          new Date(left.timestamp).getTime() -
          new Date(right.timestamp).getTime(),
      );
  }, [
    selectedRunRecord,
    selectedTasks,
    selectedWorkItem,
    workspace.executionLogs,
  ]);

  const recentRunActivity = useMemo(
    // Exclude LLM_DELTA and TOOL_FILE_CHANGED — these are rendered separately
    // in a dedicated "live streaming" section and would pollute the activity feed.
    () =>
      selectedRunEvents
        .filter(e => e.type !== 'LLM_DELTA' && e.type !== 'TOOL_FILE_CHANGED')
        .slice(-8)
        .reverse(),
    [selectedRunEvents],
  );

  // Concatenated LLM delta text for the current run — drives the "Live reasoning"
  // stream view. Only the tail (last 600 chars) is shown in the UI so the
  // panel doesn't balloon as tokens accumulate.
  const liveStreamingText = useMemo(
    () =>
      selectedRunEvents
        .filter(e => e.type === 'LLM_DELTA')
        .map(e => e.message)
        .join(''),
    [selectedRunEvents],
  );

  // Deduplicated list of file paths written this run — feeds the "Files changed"
  // section. Insertion-ordered, most-recent last.
  const recentlyChangedFiles = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const e of selectedRunEvents) {
      if (e.type === 'TOOL_FILE_CHANGED' && typeof e.message === 'string' && e.message.trim()) {
        if (!seen.has(e.message)) {
          seen.add(e.message);
          result.push(e.message);
        }
      }
    }
    return result;
  }, [selectedRunEvents]);

  const latestArtifact = selectedArtifact || null;
  const latestArtifactDocument = useMemo(() => {
    return getArtifactDocumentBody(selectedArtifact);
  }, [selectedArtifact]);
  const selectedApprovalArtifactDocument = useMemo(
    () => getArtifactDocumentBody(selectedApprovalArtifact),
    [selectedApprovalArtifact],
  );
  const openApprovalWorkspaceForWorkItem = useCallback(
    async (workItemId: string, preferredRunId?: string) => {
      const targetItem =
        workItems.find((item) => item.id === workItemId) || null;
      if (!targetItem) {
        return;
      }

      selectWorkItem(workItemId, {
        openControl: true,
        focus: "APPROVAL",
      });

      if (
        selectedWorkItem?.id === workItemId &&
        selectedOpenWait?.type === "APPROVAL" &&
        currentRun?.id
      ) {
        navigate(
          buildApprovalWorkspacePath({
            capabilityId: activeCapability.id,
            runId: currentRun.id,
            waitId: selectedOpenWait.id,
          }),
        );
        return;
      }

      const runId =
        preferredRunId || targetItem.activeRunId || targetItem.lastRunId;
      if (runId) {
        try {
          const detail = await fetchCapabilityWorkflowRun(
            activeCapability.id,
            runId,
          );
          const approvalWait =
            [...detail.waits]
              .reverse()
              .find(
                (wait) => wait.type === "APPROVAL" && wait.status === "OPEN",
              ) || detail.waits.find((wait) => wait.type === "APPROVAL");

          if (approvalWait) {
            navigate(
              buildApprovalWorkspacePath({
                capabilityId: activeCapability.id,
                runId,
                waitId: approvalWait.id,
              }),
            );
            return;
          }
        } catch {
          // Fall back to the in-work modal when the approval route cannot be hydrated.
        }
      }

      openApprovalReviewModal();
    },
    [
      activeCapability.id,
      currentRun?.id,
      navigate,
      openApprovalReviewModal,
      selectWorkItem,
      selectedOpenWait,
      selectedWorkItem?.id,
      workItems,
    ],
  );
  const handleOpenApprovalReview = useCallback(() => {
    if (!selectedWorkItem) {
      return;
    }
    setApprovalArtifactFilter("ALL");
    setSelectedApprovalArtifactId(null);
    void openApprovalWorkspaceForWorkItem(selectedWorkItem.id, currentRun?.id);
  }, [
    currentRun?.id,
    openApprovalWorkspaceForWorkItem,
    selectedWorkItem,
    setApprovalArtifactFilter,
    setSelectedApprovalArtifactId,
  ]);

  const handleApprovalReviewMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
    },
    [],
  );
  const handleSelectApprovalAttentionItem = useCallback(
    (
      workItemId: string,
      options?: {
        focusBoard?: boolean;
        openControl?: boolean;
        focus?: WorkbenchSelectionFocus;
      },
    ) => {
      const targetItem =
        workItems.find((item) => item.id === workItemId) || null;
      const shouldOpenApprovalWorkspace =
        options?.focus === "APPROVAL" ||
        targetItem?.pendingRequest?.type === "APPROVAL";

      if (shouldOpenApprovalWorkspace) {
        void openApprovalWorkspaceForWorkItem(workItemId);
        return;
      }

      selectWorkItem(workItemId, options);
    },
    [openApprovalWorkspaceForWorkItem, selectWorkItem, workItems],
  );
  const stageChatScopeKey =
    selectedWorkItem && selectedAgent
      ? `${selectedWorkItem.id}:${selectedAgent.id}:${selectedCurrentStep?.id || "stage"}`
      : null;
  const selectedStageChatMessages = stageChatScopeKey
    ? stageChatByScope[stageChatScopeKey] || []
    : [];
  const selectedStageChatTimelineMessages = useMemo(
    () =>
      selectedWorkItem && selectedAgent
        ? selectedStageChatMessages.map((message) => ({
            id: message.id,
            capabilityId: activeCapability.id,
            role: message.role,
            content: message.content,
            timestamp: message.timestamp,
            agentId: message.role === "agent" ? selectedAgent.id : undefined,
            agentName:
              message.role === "agent" ? selectedAgent.name : undefined,
            traceId: message.traceId,
            model: message.model,
            sessionId: message.sessionId,
            sessionScope: message.sessionScope || "WORK_ITEM",
            sessionScopeId: message.sessionScopeId || selectedWorkItem.id,
            workItemId: selectedWorkItem.id,
            runId: currentRun?.id,
            workflowStepId: selectedCurrentStep?.id,
          }))
        : [],
    [
      activeCapability.id,
      currentRun?.id,
      selectedAgent,
      selectedCurrentStep?.id,
      selectedStageChatMessages,
      selectedWorkItem,
    ],
  );
  const dockMessages = useMemo(
    () =>
      selectedWorkItem
        ? workspace.messages.filter(
            (message) => message.workItemId === selectedWorkItem.id,
          )
        : [],
    [selectedWorkItem, workspace.messages],
  );
  const dockResolutionRequired =
    selectedOpenWait?.type === "INPUT" ||
    selectedOpenWait?.type === "CONFLICT_RESOLUTION";
  const dockMissingFields = useMemo(
    () =>
      selectedRequestedInputFields.filter((field) => field.status !== "READY"),
    [selectedRequestedInputFields],
  );
  const handleDockFieldChipClick = useCallback(
    (label: string) => {
      setDockInput((prev) => {
        const trimmed = prev.trimEnd();
        const next = trimmed ? `${trimmed}\n` : "";
        return `${next}- ${label}: `;
      });
      focusDockComposer();
    },
    [focusDockComposer, setDockInput],
  );
  const dockStatusContent = (
    <OrchestratorCopilotStatusStack
      selectedWorkItemPresent={Boolean(selectedWorkItem)}
      deliveryBlockingItem={selectedOpenWait ? null : deliveryBlockingItem}
      onOpenBlockingAction={() => {
        if (deliveryBlockingItem) {
          navigate(deliveryBlockingItem.path);
        }
      }}
      canStartExecution={canStartExecution}
      executionDispatchLabel={executionDispatchLabel}
      canRestartFromPhase={Boolean(
        currentRun && selectedWorkItem && canRestartFromPhase,
      )}
      phaseLabel={
        selectedWorkItem
          ? getPhaseMeta(selectedWorkItem.phase).label
          : "Unknown"
      }
      busyAction={busyAction}
      onRestartExecution={() => void handleRestartExecution()}
      selectedCanGuideBlockedAgent={Boolean(
        !currentRun && selectedCanGuideBlockedAgent,
      )}
      isPaused={Boolean(
        selectedWorkItem?.status === "PAUSED" &&
        currentRun?.status === "PAUSED",
      )}
      canResumeRun={Boolean(
        currentRun && canControlWorkItems && busyAction === null,
      )}
      onResumeRun={() =>
        currentRun && selectedWorkItem
          ? void handleResumeRunById({
              runId: currentRun.id,
              workItemId: selectedWorkItem.id,
              workItemTitle: selectedWorkItem.title,
            })
          : undefined
      }
      selectedOpenWait={selectedOpenWait}
      selectedAttentionLabel={selectedAttentionLabel}
      dockMissingFieldLabels={dockMissingFields.map((field) => field.label)}
      onFieldChipClick={handleDockFieldChipClick}
      waitRequiresApprovedWorkspace={waitRequiresApprovedWorkspace}
      hasApprovedWorkspaceConfigured={hasApprovedWorkspaceConfigured}
      approvedWorkspaceRoots={approvedWorkspaceRoots}
      approvedWorkspaceDraft={approvedWorkspaceDraft}
      onApprovedWorkspaceDraftChange={(value) => {
        setApprovedWorkspaceDraft(value);
        setApprovedWorkspaceValidation(null);
      }}
      approvedWorkspaceSuggestions={[
        ...(selectedExecutionRepository?.localRootHint
          ? [selectedExecutionRepository.localRootHint]
          : []),
        ...approvedWorkspaceRoots.slice(0, 2),
        ...activeCapability.localDirectories.slice(0, 2),
      ].filter(
        (root, index, array): root is string =>
          Boolean(root) && array.indexOf(root) === index,
      )}
      onSelectApprovedWorkspaceDraft={(root) => {
        setApprovedWorkspaceDraft(root);
        setApprovedWorkspaceValidation(null);
        focusDockComposer();
      }}
      onApproveWorkspacePathAndContinue={() =>
        void handleApproveWorkspacePath({ unblock: true })
      }
      onApproveWorkspacePathOnly={() => void handleApproveWorkspacePath()}
      approvedWorkspaceValidation={approvedWorkspaceValidation}
      canEditCapability={canEditCapability}
    />
  );
  const dockThreadContent = (
    <OrchestratorCopilotThread
      messages={dockMessages}
      currentActorDisplayName={currentActorContext.displayName}
      selectedAgentName={selectedAgent?.name || null}
      dockDraft={dockDraft}
      isDockSending={isDockSending}
      threadRef={dockThreadRef}
      onScroll={(event) => {
        const target = event.currentTarget;
        if (dockScrollFrameRef.current) {
          window.cancelAnimationFrame(dockScrollFrameRef.current);
        }
        dockScrollFrameRef.current = window.requestAnimationFrame(() => {
          const distanceFromBottom =
            target.scrollHeight - target.scrollTop - target.clientHeight;
          dockStickToBottomRef.current = distanceFromBottom < 48;
          dockScrollFrameRef.current = 0;
        });
      }}
    />
  );
  const dockComposerHelperText = (
    <>
      {selectedOpenWait &&
      dockResolutionRequired &&
      !dockInput.trim() &&
      !waitOnlyRequestsApprovedWorkspace ? (
        <p className="mt-2 text-xs leading-relaxed text-secondary">
          Add a short response above to enable "{actionButtonLabel}".
        </p>
      ) : null}
      {selectedCanGuideBlockedAgent && !dockInput.trim() ? (
        <p className="mt-2 text-xs leading-relaxed text-secondary">
          Add a restart note above so the next attempt knows exactly what
          changed.
        </p>
      ) : null}
      {dockInterventionMode ? (
        <p className="mt-2 text-xs leading-relaxed text-secondary">
          The text in this composer is applied to unblock the workflow, not sent
          as a separate chat turn.
        </p>
      ) : null}
    </>
  );

  useEffect(() => {
    stageChatRequestRef.current += 1;
    setStageChatDraft("");
    setStageChatError("");
    setIsStageChatSending(false);
  }, [stageChatScopeKey]);

  const stageChatSuggestedPrompts = useMemo(() => {
    if (!selectedWorkItem || !selectedCurrentStep) {
      return [];
    }

    const prompts = [
      `Explain the current status of ${selectedWorkItem.id} in simple terms.`,
      `What exact files or artifacts do you expect to touch in ${selectedCurrentStep.name}?`,
      `What is blocking ${selectedWorkItem.id}, and what do you need from me to continue?`,
    ];

    if (selectedAttentionReason) {
      prompts.unshift(
        `Use this blocker context and tell me the safest next move: ${selectedAttentionReason}`,
      );
    }

    return prompts.slice(0, 3);
  }, [selectedAttentionReason, selectedCurrentStep, selectedWorkItem]);
  const selectedAgentKnowledgeLens = useMemo(
    () =>
      selectedAgent
        ? buildAgentKnowledgeLens({
            capability: activeCapability,
            workspace,
            agent: selectedAgent,
            workItemId: selectedWorkItem?.id,
          })
        : null,
    [activeCapability, selectedAgent, selectedWorkItem?.id, workspace],
  );
  const selectedInteractionFeed = useMemo(
    () =>
      buildCapabilityInteractionFeed({
        capability: activeCapability,
        workspace,
        workItemId: selectedWorkItem?.id,
        runDetail: selectedRunDetail,
        runEvents: selectedRunEvents,
        extraChatMessages: selectedStageChatTimelineMessages,
        agentId: selectedAgent?.id,
      }),
    [
      activeCapability,
      selectedAgent?.id,
      selectedRunDetail,
      selectedRunEvents,
      selectedStageChatTimelineMessages,
      selectedWorkItem?.id,
      workspace,
    ],
  );
  const handleOpenArtifactFromTimeline = useCallback((artifactId: string) => {
    setDetailTab("artifacts");
    setSelectedArtifactId(artifactId);
  }, []);
  const handleOpenRunFromTimeline = useCallback(
    async (runId: string) => {
      try {
        const [detail, events] = await Promise.all([
          fetchCapabilityWorkflowRun(activeCapability.id, runId),
          fetchCapabilityWorkflowRunEvents(activeCapability.id, runId),
        ]);
        setSelectedRunDetail(detail);
        setSelectedRunEvents(events);
        setDetailTab("attempts");
      } catch (error) {
        showError(
          "Unable to open run",
          error instanceof Error
            ? error.message
            : "Unable to load the selected run right now.",
        );
      }
    },
    [activeCapability.id, showError],
  );
  const handleOpenTaskFromTimeline = useCallback(
    (taskId: string) => {
      navigate(`/tasks?taskId=${encodeURIComponent(taskId)}`);
    },
    [navigate],
  );
  const handleCreateEvidencePacket = useCallback(async () => {
    if (!selectedWorkItem) {
      return;
    }

    await withAction(
      "evidencePacket",
      async () => {
        const packet = await createEvidencePacketForWorkItem(
          activeCapability.id,
          selectedWorkItem.id,
        );
        navigate(`/e/${encodeURIComponent(packet.bundleId)}`);
        void refreshCapabilityBundle(activeCapability.id).catch(
          () => undefined,
        );
      },
      {
        title: "Evidence packet created",
        description:
          "A durable evidence packet was generated from the current work item context and opened in the packet viewer.",
      },
    );
  }, [
    activeCapability.id,
    navigate,
    refreshCapabilityBundle,
    selectedWorkItem,
  ]);
  const handleClearDockChat = useCallback(async () => {
    if (!selectedWorkItem) {
      return;
    }

    const shouldClear = window.confirm(
      `Clear the copilot thread for ${selectedWorkItem.id}? This also resets the saved work-item chat session so the next turn starts cleanly.`,
    );
    if (!shouldClear) {
      return;
    }

    await withAction(
      "clearDockChat",
      async () => {
        await clearCapabilityMessageHistoryRecord(activeCapability.id, {
          workItemId: selectedWorkItem.id,
        });
        await refreshCapabilityBundle(activeCapability.id);
        setDockInput("");
        setDockUploads([]);
        setDockDraft("");
        setDockError("");
      },
      {
        title: "Work-item chat cleared",
        description:
          "The copilot dock thread was cleared and the saved work-item session was reset.",
      },
    );
  }, [
    activeCapability.id,
    refreshCapabilityBundle,
    selectedWorkItem,
    withAction,
  ]);
  const selectedStateSummary = useMemo(() => {
    if (!selectedWorkItem) {
      return "Select a work item to see the current delivery state.";
    }

    if (currentRun) {
      return `${RUN_STATUS_META[currentRun.status].label} in ${
        selectedCurrentStep?.name || getPhaseMeta(selectedWorkItem.phase).label
      } with ${selectedAgent?.name || "the assigned agent"} working this stage.`;
    }

    if (
      selectedWorkItem.status === "COMPLETED" ||
      selectedWorkItem.phase === "DONE"
    ) {
      return "This work item has completed and is ready for evidence review.";
    }

    return "This work item is staged but execution has not started yet.";
  }, [
    currentRun,
    getPhaseMeta,
    selectedAgent?.name,
    selectedCurrentStep?.name,
    selectedWorkItem,
  ]);
  const selectedFailureReason = useMemo(
    () =>
      getLatestRunFailureReason({
        run: currentRun,
        runSteps: selectedRunSteps,
        runEvents: selectedRunEvents,
      }),
    [currentRun, selectedRunEvents, selectedRunSteps],
  );
  const selectedBlockerSummary =
    selectedAttentionReason ||
    selectedFailureReason ||
    "No blocker is open right now. You can inspect context, review artifacts, or continue execution.";
  const selectedNextActionSummary = useMemo(() => {
    if (!selectedWorkItem) {
      return "Choose a work item to see the recommended next action.";
    }

    if (selectedOpenWait?.type === "APPROVAL") {
      return "Review the approval request and continue once the output meets the required conditions.";
    }
    if (selectedOpenWait?.type === "INPUT") {
      return "Provide the missing structured input so the engine can continue this stage.";
    }
    if (selectedOpenWait?.type === "CONFLICT_RESOLUTION") {
      return "Resolve the conflict and give the final decision the agent must honor.";
    }
    if (selectedCanGuideBlockedAgent) {
      return "Guide the agent with what changed, then restart the blocked step from this page.";
    }
    if (canStartExecution) {
      return "Start execution when the work item is ready to move into active delivery.";
    }
    if (currentRunIsActive) {
      return "Monitor the stage, answer agent questions inline, or wait for the next operator gate.";
    }
    if (
      selectedWorkItem.status === "COMPLETED" ||
      selectedWorkItem.phase === "DONE"
    ) {
      return "Review artifacts, explainability, and completion evidence for this finished item.";
    }
    return "Use the workbench to inspect context, talk to the agent, or restart the latest attempt.";
  }, [
    canStartExecution,
    currentRunIsActive,
    selectedCanGuideBlockedAgent,
    selectedOpenWait,
    selectedWorkItem,
  ]);
  const latestRunSummary = selectedRunHistory[0] || null;
  const previousRunSummary = selectedRunHistory[1] || null;
  const attemptComparisonLines = useMemo(() => {
    if (!latestRunSummary || !previousRunSummary) {
      return [];
    }

    const lines: string[] = [];

    if (latestRunSummary.status !== previousRunSummary.status) {
      lines.push(
        `Status changed from ${RUN_STATUS_META[previousRunSummary.status].label} to ${RUN_STATUS_META[latestRunSummary.status].label}.`,
      );
    }

    if (latestRunSummary.currentPhase !== previousRunSummary.currentPhase) {
      lines.push(
        `The latest attempt is now in ${getPhaseMeta(latestRunSummary.currentPhase).label} instead of ${getPhaseMeta(previousRunSummary.currentPhase).label}.`,
      );
    }

    if (
      latestRunSummary.terminalOutcome &&
      latestRunSummary.terminalOutcome !== previousRunSummary.terminalOutcome
    ) {
      lines.push(`Latest outcome note: ${latestRunSummary.terminalOutcome}`);
    }

    if (selectedArtifacts.length > 0) {
      lines.push(
        `${selectedArtifacts.length} artifacts are attached to the latest attempt.`,
      );
    }

    if (selectedOpenWait) {
      lines.push(
        `The current attempt is paused on ${formatEnumLabel(selectedOpenWait.type)}.`,
      );
    }

    return lines.slice(0, 4);
  }, [
    getPhaseMeta,
    latestRunSummary,
    previousRunSummary,
    selectedArtifacts.length,
    selectedOpenWait,
  ]);

  const handleStageChatScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      if (stageChatScrollFrameRef.current) {
        window.cancelAnimationFrame(stageChatScrollFrameRef.current);
      }
      stageChatScrollFrameRef.current = window.requestAnimationFrame(() => {
        const distanceFromBottom =
          target.scrollHeight - target.scrollTop - target.clientHeight;
        stageChatStickToBottomRef.current = distanceFromBottom < 48;
        stageChatScrollFrameRef.current = 0;
      });
    },
    [],
  );

  useEffect(() => {
    const thread = stageChatThreadRef.current;
    if (!thread) {
      return;
    }

    if (
      !stageChatStickToBottomRef.current &&
      !isStageChatSending &&
      !stageChatDraft
    ) {
      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [isStageChatSending, selectedStageChatMessages, stageChatDraft]);

  useEffect(() => {
    if (view !== "list") {
      return;
    }

    const thread = dockThreadRef.current;
    if (!thread) {
      return;
    }

    if (!dockStickToBottomRef.current && !isDockSending && !dockDraft) {
      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [dockDraft, isDockSending, selectedWorkItemId, view, workspace.messages]);

  const draftWorkflow = workflowsById.get(draftWorkItem.workflowId) || null;
  const draftFirstStep = draftWorkflow
    ? resolveWorkItemEntryStep(
        draftWorkflow,
        draftWorkItem.taskType,
        activeCapability.lifecycle,
      ) || draftWorkflow.steps[0]
    : null;
  const draftFirstAgent = draftFirstStep
    ? agentsById.get(draftFirstStep.agentId) || null
    : null;
  const draftTaskTypeEntryPhase = getWorkItemTaskTypeEntryPhase(
    draftWorkItem.taskType,
  );
  const draftPhaseStakeholderAssignments = useMemo(
    () =>
      normalizeWorkItemPhaseStakeholders(
        draftWorkItem.phaseStakeholders,
        activeCapability.lifecycle,
      ),
    [activeCapability.lifecycle, draftWorkItem.phaseStakeholders],
  );
  const draftLaunchSummary = useMemo(
    () => ({
      workflowName: draftWorkflow?.name || "Select a workflow",
      entryPointLabel: getWorkItemTaskTypeLabel(draftWorkItem.taskType),
      routedPhaseLabel: draftFirstStep
        ? getPhaseMeta(draftFirstStep.phase).label
        : draftTaskTypeEntryPhase
          ? getPhaseMeta(draftTaskTypeEntryPhase).label
          : "Not defined",
      entryAgentLabel:
        draftFirstAgent?.name ||
        (draftFirstStep ? draftFirstStep.agentId : "Unassigned"),
      stepsCount: draftWorkflow?.steps.length || 0,
      phaseSignoffLabel:
        draftPhaseStakeholderAssignments.length > 0
          ? `${draftPhaseStakeholderAssignments.length} phases configured`
          : "No phase stakeholders yet",
      inputFilesLabel:
        draftWorkItem.attachments.length > 0
          ? `${draftWorkItem.attachments.length} attached`
          : "No files attached",
      routingNote:
        draftTaskTypeEntryPhase &&
        draftFirstStep?.phase !== draftTaskTypeEntryPhase
          ? `This workflow does not define a separate ${getPhaseMeta(draftTaskTypeEntryPhase).label} entry step, so it will use the workflow default.`
          : null,
    }),
    [
      draftFirstAgent?.name,
      draftFirstStep,
      draftPhaseStakeholderAssignments.length,
      draftTaskTypeEntryPhase,
      draftWorkItem.attachments.length,
      draftWorkItem.taskType,
      draftWorkflow,
      getPhaseMeta,
    ],
  );
  const selectedPhaseStakeholderAssignments = useMemo(
    () =>
      normalizeWorkItemPhaseStakeholders(
        selectedWorkItem?.phaseStakeholders,
        activeCapability.lifecycle,
      ),
    [activeCapability.lifecycle, selectedWorkItem?.phaseStakeholders],
  );
  const selectedCurrentPhaseStakeholders = useMemo(
    () =>
      getWorkItemPhaseStakeholders(selectedWorkItem, selectedWorkItem?.phase),
    [selectedWorkItem],
  );

  const sanitizeDraftPhaseStakeholderAssignments = useCallback(
    (assignments: WorkItemPhaseStakeholderAssignment[]) => {
      const seen = new Set<string>();

      return assignments
        .map((assignment) => {
          const phaseId = String(assignment.phaseId || "")
            .trim()
            .toUpperCase();
          if (
            !phaseId ||
            seen.has(phaseId) ||
            !visibleLifecyclePhaseIds.has(phaseId)
          ) {
            return null;
          }
          seen.add(phaseId);
          return {
            phaseId,
            stakeholders: assignment.stakeholders.map((stakeholder) => ({
              role: stakeholder.role || "Stakeholder",
              name: stakeholder.name || "",
              email: stakeholder.email || "",
              teamName: stakeholder.teamName || "",
            })),
          } satisfies WorkItemPhaseStakeholderAssignment;
        })
        .filter(Boolean) as WorkItemPhaseStakeholderAssignment[];
    },
    [visibleLifecyclePhaseIds],
  );

  const getDraftPhaseStakeholders = useCallback(
    (phaseId: string) =>
      draftWorkItem.phaseStakeholders.find(
        (assignment) => assignment.phaseId === phaseId,
      )?.stakeholders || [],
    [draftWorkItem.phaseStakeholders],
  );

  const updateDraftPhaseStakeholders = useCallback(
    (
      phaseId: string,
      mutator: (
        current: ReturnType<typeof getWorkItemPhaseStakeholders>,
      ) => ReturnType<typeof getWorkItemPhaseStakeholders>,
    ) => {
      setDraftWorkItem((current) => {
        const existing = sanitizeDraftPhaseStakeholderAssignments(
          current.phaseStakeholders,
        );
        const currentStakeholders =
          existing.find((assignment) => assignment.phaseId === phaseId)
            ?.stakeholders || [];
        const nextStakeholders = mutator(currentStakeholders);
        const nextAssignments = [
          ...existing.filter((assignment) => assignment.phaseId !== phaseId),
          ...(nextStakeholders.length > 0
            ? [{ phaseId, stakeholders: nextStakeholders }]
            : []),
        ];

        return {
          ...current,
          phaseStakeholders:
            sanitizeDraftPhaseStakeholderAssignments(nextAssignments),
        };
      });
    },
    [sanitizeDraftPhaseStakeholderAssignments],
  );

  const addDraftPhaseStakeholder = useCallback(
    (phaseId: string, seededStakeholder?: CapabilityStakeholder) => {
      updateDraftPhaseStakeholders(phaseId, (currentStakeholders) => [
        ...currentStakeholders,
        seededStakeholder
          ? toDraftPhaseStakeholder(seededStakeholder)
          : createEmptyWorkItemPhaseStakeholder(),
      ]);
    },
    [updateDraftPhaseStakeholders],
  );

  const updateDraftPhaseStakeholderField = useCallback(
    (
      phaseId: string,
      index: number,
      field: "role" | "name" | "email" | "teamName",
      value: string,
    ) => {
      updateDraftPhaseStakeholders(phaseId, (currentStakeholders) =>
        currentStakeholders.map((stakeholder, stakeholderIndex) =>
          stakeholderIndex === index
            ? { ...stakeholder, [field]: value }
            : stakeholder,
        ),
      );
    },
    [updateDraftPhaseStakeholders],
  );

  const removeDraftPhaseStakeholder = useCallback(
    (phaseId: string, index: number) => {
      updateDraftPhaseStakeholders(phaseId, (currentStakeholders) =>
        currentStakeholders.filter(
          (_, stakeholderIndex) => stakeholderIndex !== index,
        ),
      );
    },
    [updateDraftPhaseStakeholders],
  );

  const applyCapabilityStakeholdersToPhase = useCallback(
    (phaseId: string) => {
      if (activeCapability.stakeholders.length === 0) {
        addDraftPhaseStakeholder(phaseId);
        return;
      }

      updateDraftPhaseStakeholders(phaseId, () =>
        activeCapability.stakeholders.map((stakeholder) =>
          toDraftPhaseStakeholder(stakeholder),
        ),
      );
    },
    [
      activeCapability.stakeholders,
      addDraftPhaseStakeholder,
      updateDraftPhaseStakeholders,
    ],
  );

  const handleDraftAttachmentUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }

      const uploadedFiles = await Promise.all(
        Array.from(files).map(async (file) => {
          const rawText = await file.text();
          const trimmed = rawText.trim();
          if (!trimmed) {
            return null;
          }

          const truncated =
            trimmed.length > MAX_WORK_ITEM_ATTACHMENT_BYTES
              ? `${trimmed.slice(0, MAX_WORK_ITEM_ATTACHMENT_BYTES)}\n\n[Truncated after ${MAX_WORK_ITEM_ATTACHMENT_BYTES} characters for work-item staging.]`
              : trimmed;

          return {
            fileName: file.name,
            mimeType: file.type || "text/plain",
            contentText: truncated,
            sizeBytes: file.size,
          } satisfies WorkItemAttachmentUpload;
        }),
      );

      const nextFiles = uploadedFiles.filter(
        Boolean,
      ) as WorkItemAttachmentUpload[];
      if (nextFiles.length === 0) {
        return;
      }

      setDraftWorkItem((current) => ({
        ...current,
        attachments: [...current.attachments, ...nextFiles],
      }));
    },
    [],
  );

  const removeDraftAttachment = useCallback((index: number) => {
    setDraftWorkItem((current) => ({
      ...current,
      attachments: current.attachments.filter(
        (_, attachmentIndex) => attachmentIndex !== index,
      ),
    }));
  }, []);

  useEffect(() => {
    setDraftWorkItem((current) => ({
      ...current,
      phaseStakeholders: sanitizeDraftPhaseStakeholderAssignments(
        current.phaseStakeholders,
      ),
    }));
  }, [sanitizeDraftPhaseStakeholderAssignments]);

  async function withAction(
    label: string,
    action: () => Promise<void>,
    successMessage?: { title: string; description?: string },
  ) {
    setBusyAction(label);
    setActionError("");
    try {
      await action();
      if (successMessage) {
        success(successMessage.title, successMessage.description);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The orchestration action failed.";
      setActionError(message);
      showError("Action failed", message);
    } finally {
      setBusyAction(null);
    }
  }

  const handleApproveWorkspacePath = async (options?: {
    unblock?: boolean;
  }) => {
    const requestedPath = approvedWorkspaceDraft.trim();
    if (!requestedPath) {
      showError(
        "Workspace path required",
        "Paste a local directory path to save it for this operator on the current desktop.",
      );
      return;
    }

    if (
      options?.unblock &&
      !requirePermission(
        canControlWorkItems,
        "This operator cannot unblock workflow waits for the selected run.",
      )
    ) {
      return;
    }

    if (!runtimeStatus?.executorId || !currentActorContext.userId) {
      showError(
        "Desktop workspace required",
        "Connect this desktop executor and choose a current operator before saving local workspace mappings.",
      );
      navigate("/operations#desktop-workspaces");
      return;
    }

    await withAction(
      "approveWorkspacePath",
      async () => {
        const validation = await validateOnboardingWorkspacePath({
          path: requestedPath,
        });
        setApprovedWorkspaceValidation(validation);

        if (!validation.valid || !validation.normalizedPath) {
          throw new Error(
            validation.message || "Workspace path could not be validated.",
          );
        }

        const normalizedPath = validation.normalizedPath;
        await createDesktopWorkspaceMapping(runtimeStatus.executorId, {
          userId: currentActorContext.userId,
          capabilityId: activeCapability.id,
          repositoryId: selectedExecutionRepository?.id,
          localRootPath: normalizedPath,
          workingDirectoryPath: normalizedPath,
        });

        const nextMappings = await fetchDesktopWorkspaceMappings({
          executorId: runtimeStatus.executorId,
          userId: currentActorContext.userId,
          capabilityId: activeCapability.id,
        });
        setDesktopWorkspaceMappings(nextMappings);
        setApprovedWorkspaceDraft(normalizedPath);
        setResolutionNote((current) =>
          current.trim()
            ? current
            : `Desktop workspace path: ${normalizedPath}`,
        );

        if (
          options?.unblock &&
          currentRun &&
          selectedOpenWait?.type === "INPUT" &&
          selectedWorkItem
        ) {
          await provideCapabilityWorkflowRunInput(
            activeCapability.id,
            currentRun.id,
            {
              resolution: `Desktop workspace path: ${normalizedPath}`,
              resolvedBy: currentActorContext.displayName,
            },
          );
          setResolutionNote("");
          await refreshSelection(selectedWorkItem.id);
          return;
        }

        await refreshCapabilityBundle(activeCapability.id);
      },
      {
        title: options?.unblock
          ? "Desktop workspace saved and run resumed"
          : "Desktop workspace saved",
        description: `${requestedPath} is now stored for ${currentActorContext.displayName} on this desktop.`,
      },
    );
  };

  const handleClaimControl = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot claim work-item control.",
      )
    ) {
      return;
    }

    await withAction(
      "claimControl",
      async () => {
        const result = await claimCapabilityWorkItemControl(
          activeCapability.id,
          selectedWorkItem.id,
        );
        setSelectedClaims((current) =>
          [
            result.claim,
            ...current.filter((claim) => claim.userId !== result.claim.userId),
          ].slice(0, 5),
        );
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Operator control claimed",
        description: `${currentActorContext.displayName} now holds active control for ${selectedWorkItem.title}.`,
      },
    );
  };

  const handleReleaseControl = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot release work-item control.",
      )
    ) {
      return;
    }

    await withAction(
      "releaseControl",
      async () => {
        await releaseCapabilityWorkItemControl(
          activeCapability.id,
          selectedWorkItem.id,
        );
        setSelectedClaims([]);
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Operator control released",
        description: `${selectedWorkItem.title} is available for another team member to take over.`,
      },
    );
  };

  const handleInitializeExecutionContext = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot initialize execution context for the selected work item.",
      )
    ) {
      return;
    }

    await withAction(
      "initExecutionContext",
      async () => {
        const context = await initializeCapabilityWorkItemExecutionContext(
          activeCapability.id,
          selectedWorkItem.id,
        );
        setSelectedExecutionContext(context);
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Execution context prepared",
        description: `${selectedWorkItem.title} now has a shared repository and branch context.`,
      },
    );
  };

  const handleCreateSharedBranch = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot create or reopen the shared work-item branch.",
      )
    ) {
      return;
    }

    await withAction(
      "createSharedBranch",
      async () => {
        if (!runtimeStatus?.executorId) {
          throw new Error(
            "Connect this desktop executor and save a Desktop Workspaces mapping before creating a shared branch.",
          );
        }
        const result = await createCapabilityWorkItemSharedBranch(
          activeCapability.id,
          selectedWorkItem.id,
          { executorId: runtimeStatus.executorId },
        );
        setSelectedExecutionContext(result.context);
        if (currentActorContext.userId) {
          setSelectedPresence((current) =>
            current.some((entry) => entry.userId === currentActorContext.userId)
              ? current
              : [
                  {
                    capabilityId: activeCapability.id,
                    workItemId: selectedWorkItem.id,
                    userId: currentActorContext.userId,
                    teamId: currentActorContext.teamIds[0],
                    viewContext: "WORKBENCH",
                    lastSeenAt: new Date().toISOString(),
                  },
                  ...current,
                ],
          );
        }
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Shared branch ready",
        description: `${selectedWorkItem.title} can now be worked from the shared branch ${
          selectedSharedBranch?.sharedBranch || "context"
        }.`,
      },
    );
  };

  const handleClaimWriteControl = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot claim write control.",
      )
    ) {
      return;
    }

    await withAction(
      "claimWriteControl",
      async () => {
        const result = await claimCapabilityWorkItemWriteControl(
          activeCapability.id,
          selectedWorkItem.id,
        );
        setSelectedExecutionContext(result.context);
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Write control claimed",
        description: `${currentActorContext.displayName} is now the active writer for ${selectedWorkItem.title}.`,
      },
    );
  };

  const handleReleaseWriteControl = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot release write control.",
      )
    ) {
      return;
    }

    await withAction(
      "releaseWriteControl",
      async () => {
        await releaseCapabilityWorkItemWriteControl(
          activeCapability.id,
          selectedWorkItem.id,
        );
        setSelectedExecutionContext((current) =>
          current
            ? {
                ...current,
                activeWriterUserId: undefined,
                claimExpiresAt: undefined,
              }
            : current,
        );
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Write control released",
        description: `${selectedWorkItem.title} is ready for another stakeholder to take over the shared branch.`,
      },
    );
  };

  const handleCreateHandoff = async () => {
    if (
      !selectedWorkItem ||
      !resolutionNote.trim() ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot capture a handoff packet.",
      )
    ) {
      return;
    }

    await withAction(
      "createHandoff",
      async () => {
        const packet = await createCapabilityWorkItemHandoff(
          activeCapability.id,
          selectedWorkItem.id,
          {
            fromUserId: currentActorContext.userId,
            toUserId: undefined,
            fromTeamId: currentActorContext.teamIds[0],
            toTeamId: selectedWorkItem.phaseOwnerTeamId,
            summary: resolutionNote.trim(),
            openQuestions: [],
            blockingDependencies: [],
            recommendedNextStep: selectedNextActionSummary,
            artifactIds: selectedWorkItemArtifacts
              .slice(0, 5)
              .map((artifact) => artifact.id),
            traceIds: selectedRunRecord?.traceId
              ? [selectedRunRecord.traceId]
              : [],
          },
        );
        setSelectedHandoffs((current) => [packet, ...current]);
        setResolutionNote("");
      },
      {
        title: "Handoff packet captured",
        description: `The shared branch context and next steps are now attached to ${selectedWorkItem.title}.`,
      },
    );
  };

  const handleAcceptLatestHandoff = async () => {
    if (
      !selectedWorkItem ||
      !latestSelectedHandoff ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot accept the latest handoff.",
      )
    ) {
      return;
    }

    await withAction(
      "acceptHandoff",
      async () => {
        const result = await acceptCapabilityWorkItemHandoff(
          activeCapability.id,
          selectedWorkItem.id,
          latestSelectedHandoff.id,
        );
        setSelectedExecutionContext(result.context);
        setSelectedHandoffs((current) =>
          current.map((packet) =>
            packet.id === result.packet.id ? result.packet : packet,
          ),
        );
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Handoff accepted",
        description: `${currentActorContext.displayName} accepted the latest shared-branch handoff for ${selectedWorkItem.title}.`,
      },
    );
  };

  const handleCreateWorkItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !draftWorkItem.title.trim() ||
      !draftWorkItem.workflowId ||
      !requirePermission(
        canCreateWorkItems,
        "This operator cannot create work items.",
      )
    ) {
      return;
    }

    await withAction(
      "create",
      async () => {
        const nextItem = await createCapabilityWorkItem(activeCapability.id, {
          title: draftWorkItem.title.trim(),
          description: draftWorkItem.description.trim() || undefined,
          workflowId: draftWorkItem.workflowId,
          taskType: draftWorkItem.taskType,
          phaseStakeholders: draftPhaseStakeholderAssignments,
          attachments: draftWorkItem.attachments,
          priority: draftWorkItem.priority,
          tags: draftWorkItem.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        });

        await refreshSelection(nextItem.id);
        setSelectedWorkItemId(nextItem.id);
        setIsCreateSheetOpen(false);
        setDetailTab("operate");
        setDraftWorkItem({
          title: "",
          description: "",
          workflowId: workspace.workflows[0]?.id || "",
          taskType: DEFAULT_WORK_ITEM_TASK_TYPE,
          phaseStakeholders: [],
          attachments: [],
          priority: "Med",
          tags: "",
        });
      },
      {
        title: "Work item created",
        description: `${draftWorkItem.title.trim()} is now staged in ${activeCapability.name}.`,
      },
    );
  };

  const handleStartExecution = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot start workflow execution.",
      )
    ) {
      return;
    }

    if (deliveryBlockingItem) {
      setActionError(
        deliveryBlockingItem.nextRequiredAction ||
          deliveryBlockingItem.blockingReason ||
          deliveryBlockingItem.description,
      );
      return;
    }

    await withAction(
      "start",
      async () => {
        await startCapabilityWorkflowRun(
          activeCapability.id,
          selectedWorkItem.id,
          {
            executorId: runtimeStatus?.executorId,
          },
        );
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Execution started",
        description: `${selectedWorkItem.title} is now running through the workflow.`,
      },
    );
  };

  const handleRestartExecution = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canRestartWorkItems,
        "This operator cannot restart workflow execution.",
      )
    ) {
      return;
    }

    const restartRunId = currentRunId;
    if (!restartRunId) {
      return;
    }

    if (deliveryBlockingItem) {
      setActionError(
        deliveryBlockingItem.nextRequiredAction ||
          deliveryBlockingItem.blockingReason ||
          deliveryBlockingItem.description,
      );
      return;
    }

    await withAction(
      "restart",
      async () => {
        let restartRun = currentRun;
        if (!restartRun || restartRun.id !== restartRunId) {
          const detail = await fetchCapabilityWorkflowRun(
            activeCapability.id,
            restartRunId,
          );
          restartRun = detail.run;
          setSelectedRunDetail(detail);
        }

        if (restartRun && ACTIVE_RUN_STATUSES.includes(restartRun.status)) {
          await cancelCapabilityWorkflowRun(
            activeCapability.id,
            restartRun.id,
            {
              note: `Run cancelled so ${selectedWorkItem.title} can restart from ${getPhaseMeta(selectedWorkItem.phase).label}.`,
            },
          );
        }

        await restartCapabilityWorkflowRun(activeCapability.id, restartRunId, {
          restartFromPhase: selectedWorkItem.phase,
        });
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Phase restarted",
        description: `${selectedWorkItem.title} restarted from ${getPhaseMeta(selectedWorkItem.phase).label}.`,
      },
    );
  };

  const handleResetAndRestart = async () => {
    if (
      !selectedWorkItem ||
      !requirePermission(
        canRestartWorkItems,
        "This operator cannot reset and restart the selected work item.",
      )
    ) {
      return;
    }

    if (deliveryBlockingItem) {
      setActionError(
        deliveryBlockingItem.nextRequiredAction ||
          deliveryBlockingItem.blockingReason ||
          deliveryBlockingItem.description,
      );
      return;
    }

    const resetPhase = selectedResetPhase;
    const resetPhaseLabel = getPhaseMeta(resetPhase).label;

    await withAction(
      "reset",
      async () => {
        if (currentRun && currentRunIsActive) {
          await cancelCapabilityWorkflowRun(
            activeCapability.id,
            currentRun.id,
            {
              note:
                resolutionNote.trim() ||
                `Run cancelled so ${selectedWorkItem.title} can be reset to ${resetPhaseLabel} and restarted.`,
            },
          );
        }

        if (selectedWorkItem.phase !== resetPhase) {
          await moveCapabilityWorkItem(
            activeCapability.id,
            selectedWorkItem.id,
            {
              targetPhase: resetPhase,
              note: `Work item reset to ${resetPhaseLabel} before restart.`,
            },
          );
        }

        if (currentRun) {
          await restartCapabilityWorkflowRun(
            activeCapability.id,
            currentRun.id,
            {
              restartFromPhase: resetPhase,
            },
          );
        } else {
          await startCapabilityWorkflowRun(
            activeCapability.id,
            selectedWorkItem.id,
            {
              restartFromPhase: resetPhase,
              executorId: runtimeStatus?.executorId,
            },
          );
        }

        setResolutionNote("");
        setDetailTab("attempts");
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Progress reset and restarted",
        description: `${selectedWorkItem.title} was reset to ${resetPhaseLabel} and relaunched from the beginning of the workflow path.`,
      },
    );
  };

  const handleResolveWait = async () => {
    if (!currentRun || !selectedOpenWait || !selectedWorkItem) {
      return;
    }

    if (
      selectedOpenWait.type === "INPUT" &&
      waitRequiresApprovedWorkspace &&
      !hasApprovedWorkspaceConfigured
    ) {
      selectionFocusRef.current = "INPUT";
      setDetailTab("operate");
      showError(
        "Desktop workspace required",
        "This run cannot continue until a desktop workspace mapping is saved for the current operator on this desktop.",
      );
      return;
    }

    if (
      !requirePermission(
        selectedOpenWait.type === "APPROVAL"
          ? canDecideApprovals
          : canControlWorkItems,
        selectedOpenWait.type === "APPROVAL"
          ? "This operator cannot decide approval waits for the selected run."
          : "This operator cannot resolve workflow waits for the selected run.",
      )
    ) {
      return;
    }

    const trimmedResolutionNote = resolutionNote.trim();
    const fallbackResolution =
      waitOnlyRequestsApprovedWorkspace && preferredApprovedWorkspaceRoot
        ? `Desktop workspace path: ${preferredApprovedWorkspaceRoot}`
        : actionButtonLabel;
    const resolution = trimmedResolutionNote || fallbackResolution;

    await withAction(
      "resolve",
      async () => {
        if (selectedOpenWait.type === "APPROVAL") {
          await approveCapabilityWorkflowRun(
            activeCapability.id,
            currentRun.id,
            {
              resolution,
              resolvedBy: currentActorContext.displayName,
            },
          );
          setIsDiffReviewOpen(false);
          setIsApprovalReviewOpen(false);
          setIsApprovalReviewHydrated(false);
        } else if (selectedOpenWait.type === "INPUT") {
          await provideCapabilityWorkflowRunInput(
            activeCapability.id,
            currentRun.id,
            {
              resolution,
              resolvedBy: currentActorContext.displayName,
            },
          );
        } else {
          await resolveCapabilityWorkflowRunConflict(
            activeCapability.id,
            currentRun.id,
            {
              resolution,
              resolvedBy: currentActorContext.displayName,
            },
          );
        }

        setResolutionNote("");
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title:
          selectedOpenWait.type === "APPROVAL"
            ? "Approval submitted"
            : selectedOpenWait.type === "INPUT"
              ? "Input submitted"
              : "Conflict resolved",
        description: `${selectedWorkItem.title} was updated and can continue through the workflow.`,
      },
    );
  };

  const uploadDockFilesIfNeeded = async (): Promise<Artifact[]> => {
    if (!selectedWorkItem || dockUploads.length === 0) {
      return [];
    }

    const uploadedArtifacts = await uploadCapabilityWorkItemFiles(
      activeCapability.id,
      selectedWorkItem.id,
      dockUploads.map((item) => item.file),
    );

    clearDockUploads();

    if (uploadedArtifacts.length > 0) {
      success(
        "Files uploaded",
        `${uploadedArtifacts.length} file${uploadedArtifacts.length === 1 ? "" : "s"} attached to ${selectedWorkItem.id}.`,
      );
    }

    await refreshCapabilityBundle(activeCapability.id);
    return uploadedArtifacts;
  };

  const handleDockResolveWait = async () => {
    if (!currentRun || !selectedOpenWait || !selectedWorkItem) {
      return;
    }

    if (selectedOpenWait.type === "APPROVAL") {
      handleOpenApprovalReview();
      return;
    }

    if (
      selectedOpenWait.type === "INPUT" &&
      waitRequiresApprovedWorkspace &&
      !hasApprovedWorkspaceConfigured
    ) {
      showError(
        "Desktop workspace required",
        "Save at least one desktop workspace mapping before submitting input for this wait.",
      );
      return;
    }

    const trimmedDockInput = dockInput.trim();
    const fallbackApprovedWorkspaceRoot =
      approvedWorkspaceDraft.trim() || preferredApprovedWorkspaceRoot;
    const fallbackResolution =
      waitOnlyRequestsApprovedWorkspace && fallbackApprovedWorkspaceRoot
        ? `Desktop workspace path: ${fallbackApprovedWorkspaceRoot}`
        : actionButtonLabel;
    const resolution = trimmedDockInput || fallbackResolution;
    const resolutionRequired =
      selectedOpenWait.type === "INPUT" ||
      selectedOpenWait.type === "CONFLICT_RESOLUTION";

    if (
      resolutionRequired &&
      !dockInput.trim() &&
      !waitOnlyRequestsApprovedWorkspace
    ) {
      setActionError(
        "Add the missing details before unblocking this workflow stage.",
      );
      return;
    }

    await withAction(
      "dockResolveWait",
      async () => {
        await uploadDockFilesIfNeeded();

        if (selectedOpenWait.type === "INPUT") {
          await provideCapabilityWorkflowRunInput(
            activeCapability.id,
            currentRun.id,
            {
              resolution,
              resolvedBy: currentActorContext.displayName,
            },
          );
        } else {
          await resolveCapabilityWorkflowRunConflict(
            activeCapability.id,
            currentRun.id,
            {
              resolution,
              resolvedBy: currentActorContext.displayName,
            },
          );
        }

        setDockInput("");
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title:
          selectedOpenWait.type === "INPUT"
            ? "Input submitted"
            : "Conflict resolved",
        description: `${selectedWorkItem.title} can continue through the workflow.`,
      },
    );
  };

  // Phase-segment handlers.
  // Submitting the StartSegmentDialog. Creates a segment + run in one
  // step. On success, closes the dialog and refreshes the work item so
  // the inbox re-renders with the active run and segment history.
  const handleSubmitStartSegment = useCallback(
    async (submit: StartSegmentDialogSubmit) => {
      if (!startSegmentWorkItemId || !activeCapability) return;
      setStartSegmentError(null);
      setStartSegmentBusy(true);
      try {
        await startCapabilityWorkItemSegment(
          activeCapability.id,
          startSegmentWorkItemId,
          {
            startPhase: submit.startPhase,
            stopAfterPhase: submit.stopAfterPhase,
            intention: submit.intention,
            saveAsPreset: submit.saveAsPreset,
            guidedBy: currentActorContext.displayName,
          },
        );
        await refreshSelection(startSegmentWorkItemId);
        setStartSegmentWorkItemId(null);
      } catch (error) {
        setStartSegmentError(
          error instanceof Error
            ? error.message
            : "Failed to start segment.",
        );
      } finally {
        setStartSegmentBusy(false);
      }
    },
    [
      startSegmentWorkItemId,
      activeCapability,
      currentActorContext.displayName,
      refreshSelection,
    ],
  );

  // One-click "Start next" — fires the saved preset without opening the
  // dialog. Uses the same action guard pattern as other inbox actions so
  // the button gets a busy spinner.
  const handleStartNextSegment = useCallback(
    async (workItemId: string) => {
      if (!activeCapability) return;
      const targetItem = workItems.find((item) => item.id === workItemId);
      const titleLabel = targetItem?.title || workItemId;
      await withAction(
        `start-next-${workItemId}`,
        async () => {
          await startCapabilityWorkItemNextSegment(
            activeCapability.id,
            workItemId,
            { guidedBy: currentActorContext.displayName },
          );
          await refreshSelection(workItemId);
        },
        {
          title: "Next segment started",
          description: `${titleLabel} — running the saved "start next" preset.`,
        },
      );
    },
    [
      activeCapability,
      workItems,
      currentActorContext.displayName,
      withAction,
      refreshSelection,
    ],
  );

  const handleDockStartExecution = async () => {
    if (
      !selectedWorkItem ||
      !canStartExecution ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot start workflow execution from the dock.",
      )
    ) {
      return;
    }

    if (deliveryBlockingItem) {
      const message =
        deliveryBlockingItem.nextRequiredAction ||
        deliveryBlockingItem.blockingReason ||
        deliveryBlockingItem.description;
      setDockError(message);
      setActionError(message);
      return;
    }

    const guidance = dockInput.trim() || undefined;

    await withAction(
      "dockStartExecution",
      async () => {
        await uploadDockFilesIfNeeded();
        await startCapabilityWorkflowRun(
          activeCapability.id,
          selectedWorkItem.id,
          {
            guidance,
            guidedBy: currentActorContext.displayName,
            executorId: runtimeStatus?.executorId,
          },
        );
        setDockInput("");
        setDockError("");
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Execution started from dock",
        description: guidance
          ? `${selectedWorkItem.title} started with your kickoff guidance attached to the run.`
          : `${selectedWorkItem.title} is now running through the workflow from the dock.`,
      },
    );
  };

  const handleDockGuideAndRestart = async () => {
    if (
      !selectedWorkItem ||
      !selectedCanGuideBlockedAgent ||
      !requirePermission(
        canRestartWorkItems,
        "This operator cannot guide and restart blocked work from the dock.",
      )
    ) {
      return;
    }

    const guidance = dockInput.trim();
    if (!guidance) {
      const message =
        "Add clear operator guidance before restarting the blocked work item.";
      setDockError(message);
      setActionError(message);
      return;
    }

    await withAction(
      "dockGuideRestart",
      async () => {
        await uploadDockFilesIfNeeded();

        if (currentRun) {
          await restartCapabilityWorkflowRun(
            activeCapability.id,
            currentRun.id,
            {
              restartFromPhase: selectedWorkItem.phase,
              guidance,
              guidedBy: currentActorContext.displayName,
            },
          );
        } else {
          await startCapabilityWorkflowRun(
            activeCapability.id,
            selectedWorkItem.id,
            {
              restartFromPhase: selectedWorkItem.phase,
              guidance,
              guidedBy: currentActorContext.displayName,
              executorId: runtimeStatus?.executorId,
            },
          );
        }

        setDockInput("");
        setDockError("");
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Blocked work restarted from dock",
        description: `${selectedWorkItem.title} restarted from ${getPhaseMeta(selectedWorkItem.phase).label} with your guidance attached to the next attempt.`,
      },
    );
  };

  const handleDockAskAgent = async () => {
    if (!selectedWorkItem) {
      return;
    }

    if (
      selectedOpenWait?.type === "INPUT" ||
      selectedOpenWait?.type === "CONFLICT_RESOLUTION"
    ) {
      await handleDockResolveWait();
      return;
    }

    if (selectedCanGuideBlockedAgent) {
      await handleDockGuideAndRestart();
      return;
    }

    const requestedMessage = dockInput.trim();
    if (!requestedMessage && dockUploads.length === 0) {
      return;
    }

    if (
      !requirePermission(
        canWriteChat,
        "This operator cannot send chat messages for the selected capability.",
      )
    ) {
      return;
    }

    if (!runtimeReady) {
      setDockError(
        runtimeError ||
          "Runtime is not configured yet. Fix the Copilot connection before sending chat.",
      );
      return;
    }

    const agentForChat =
      selectedAgent ||
      (workspace.primaryCopilotAgentId
        ? agentsById.get(workspace.primaryCopilotAgentId) || null
        : null) ||
      (workspace.activeChatAgentId
        ? agentsById.get(workspace.activeChatAgentId) || null
        : null) ||
      workspace.agents.find((agent) => agent.isOwner) ||
      workspace.agents[0] ||
      null;

    if (!agentForChat) {
      setDockError("No chat agent is available for this capability.");
      return;
    }

    const userMessageId = `${Date.now()}-dock-user`;
    const userTimestamp = formatTimestamp();

    setDockError("");
    setDockDraft("");
    setIsDockSending(true);

    const requestToken = ++dockRequestRef.current;

    try {
      const uploadedArtifacts =
        dockUploads.length > 0 ? await uploadDockFilesIfNeeded() : [];

      const attachmentLine =
        uploadedArtifacts.length > 0
          ? `\n\nAttachments:\n${uploadedArtifacts
              .map(
                (artifact) =>
                  `- ${artifact.fileName || artifact.name} (${artifact.id})`,
              )
              .join("\n")}`
          : "";
      const messageContent =
        requestedMessage ||
        (uploadedArtifacts.length > 0
          ? `Uploaded ${uploadedArtifacts.length} file${uploadedArtifacts.length === 1 ? "" : "s"} for ${selectedWorkItem.id}.${attachmentLine}`
          : "");

      const threadHistory = workspace.messages
        .filter((message) => message.workItemId === selectedWorkItem.id)
        .slice(-10);
      const historyForRequest = [
        ...threadHistory,
        {
          id: userMessageId,
          capabilityId: activeCapability.id,
          role: "user" as const,
          content: messageContent,
          timestamp: userTimestamp,
          workItemId: selectedWorkItem.id,
          runId: currentRun?.id,
          workflowStepId: selectedCurrentStep?.id,
        },
      ];

      await appendCapabilityMessageRecord(activeCapability.id, {
        id: userMessageId,
        role: "user",
        content: messageContent,
        timestamp: userTimestamp,
        sessionScope: "WORK_ITEM",
        sessionScopeId: selectedWorkItem.id,
        workItemId: selectedWorkItem.id,
        runId: currentRun?.id,
        workflowStepId: selectedCurrentStep?.id,
      });

      const streamResult = await streamCapabilityChat(
        {
          capability: activeCapability,
          agent: agentForChat,
          history: historyForRequest,
          message: messageContent,
          sessionScope: "WORK_ITEM",
          sessionScopeId: selectedWorkItem.id,
          contextMode: "WORK_ITEM_STAGE",
          workItemId: selectedWorkItem.id,
          runId: currentRun?.id,
          workflowStepId: selectedCurrentStep?.id,
        },
        {
          onEvent: (streamEvent) => {
            if (dockRequestRef.current !== requestToken) {
              return;
            }

            if (streamEvent.type === "delta" && streamEvent.content) {
              setDockDraft((current) => current + streamEvent.content);
            }

            if (streamEvent.type === "error" && streamEvent.error) {
              setDockError(streamEvent.error);
            }
          },
        },
      );

      if (dockRequestRef.current !== requestToken) {
        return;
      }

      const assistantContent =
        streamResult.completeEvent?.content || streamResult.draftContent;

      if (!assistantContent.trim()) {
        throw new Error(
          streamResult.error || "The agent did not return a response.",
        );
      }

      await appendCapabilityMessageRecord(activeCapability.id, {
        id: `${Date.now()}-dock-agent`,
        role: "agent",
        content: assistantContent,
        timestamp: formatTimestamp(
          streamResult.completeEvent?.createdAt
            ? new Date(streamResult.completeEvent.createdAt)
            : new Date(),
        ),
        agentId: agentForChat.id,
        agentName: agentForChat.name,
        traceId: streamResult.completeEvent?.traceId,
        model: streamResult.completeEvent?.model || agentForChat.model,
        sessionId: streamResult.completeEvent?.sessionId,
        sessionScope: streamResult.completeEvent?.sessionScope,
        sessionScopeId: streamResult.completeEvent?.sessionScopeId,
        workItemId: selectedWorkItem.id,
        runId: currentRun?.id,
        workflowStepId: selectedCurrentStep?.id,
      });

      setDockDraft("");
      setDockInput("");
      await refreshCapabilityBundle(activeCapability.id);
    } catch (error) {
      if (dockRequestRef.current !== requestToken) {
        return;
      }

      setDockDraft("");
      setDockError(
        error instanceof Error
          ? error.message
          : "The agent could not complete this request.",
      );
    } finally {
      if (dockRequestRef.current === requestToken) {
        setIsDockSending(false);
      }
    }
  };

  const handleRequestChanges = async () => {
    if (
      !currentRun ||
      !selectedWorkItem ||
      !selectedHasCodeDiffApproval ||
      !requirePermission(
        canDecideApprovals,
        "This operator cannot request changes on approvals.",
      )
    ) {
      return;
    }

    const resolution = resolutionNote.trim();
    if (!resolution) {
      setActionError(
        "Add review notes before requesting changes from the developer step.",
      );
      return;
    }

    await withAction(
      "requestChanges",
      async () => {
        await requestCapabilityWorkflowRunChanges(
          activeCapability.id,
          currentRun.id,
          {
            resolution,
            resolvedBy: currentActorContext.displayName,
          },
        );
        setResolutionNote("");
        setIsDiffReviewOpen(false);
        setIsApprovalReviewOpen(false);
        setIsApprovalReviewHydrated(false);
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Changes requested",
        description: `${selectedWorkItem.title} was sent back to the developer step with your review notes.`,
      },
    );
  };

  const handleGuideAndRestart = async () => {
    if (
      !selectedWorkItem ||
      !selectedCanGuideBlockedAgent ||
      !requirePermission(
        canRestartWorkItems,
        "This operator cannot guide and restart blocked work items.",
      )
    ) {
      return;
    }

    const guidance = resolutionNote.trim();
    if (!guidance) {
      setActionError(
        "Add clear operator guidance before restarting the blocked work item.",
      );
      return;
    }

    await withAction(
      "guideRestart",
      async () => {
        if (currentRun) {
          await restartCapabilityWorkflowRun(
            activeCapability.id,
            currentRun.id,
            {
              restartFromPhase: selectedWorkItem.phase,
              guidance,
              guidedBy: currentActorContext.displayName,
            },
          );
        } else {
          await startCapabilityWorkflowRun(
            activeCapability.id,
            selectedWorkItem.id,
            {
              restartFromPhase: selectedWorkItem.phase,
              guidance,
              guidedBy: currentActorContext.displayName,
              executorId: runtimeStatus?.executorId,
            },
          );
        }

        setResolutionNote("");
        setDetailTab("attempts");
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Agent guided and restarted",
        description: `${selectedWorkItem.title} restarted from ${getPhaseMeta(selectedWorkItem.phase).label} with your guidance attached to the next attempt.`,
      },
    );
  };

  const handleCancelRun = async () => {
    if (
      !currentRun ||
      !selectedWorkItem ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot cancel active runs.",
      )
    ) {
      return;
    }

    await withAction(
      "cancel",
      async () => {
        await cancelCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
          note:
            resolutionNote.trim() || "Run cancelled from the control plane.",
        });
        setResolutionNote("");
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: "Execution cancelled",
        description: `${selectedWorkItem.title} was stopped from the control plane.`,
      },
    );
  };

  const handlePauseRunById = async ({
    runId,
    workItemId,
    workItemTitle,
  }: {
    runId: string;
    workItemId?: string;
    workItemTitle?: string;
  }) => {
    if (
      !requirePermission(
        canControlWorkItems,
        "This operator cannot pause runs.",
      )
    ) {
      return;
    }

    await withAction(
      `pause-${workItemId || runId}`,
      async () => {
        await pauseCapabilityWorkflowRun(activeCapability.id, runId, {
          note: resolutionNote.trim() || "Execution paused from the inbox.",
        });
        setResolutionNote("");
        await refreshSelection(
          workItemId === selectedWorkItemId ? workItemId : undefined,
        );
      },
      {
        title: "Execution paused",
        description: workItemTitle ? `${workItemTitle} is paused.` : undefined,
      },
    );
  };

  const handleResumeRunById = async ({
    runId,
    workItemId,
    workItemTitle,
  }: {
    runId: string;
    workItemId?: string;
    workItemTitle?: string;
  }) => {
    if (
      !requirePermission(
        canControlWorkItems,
        "This operator cannot resume runs.",
      )
    ) {
      return;
    }

    await withAction(
      `resume-${workItemId || runId}`,
      async () => {
        await resumeCapabilityWorkflowRun(activeCapability.id, runId, {
          note: resolutionNote.trim() || "Execution resumed from the inbox.",
        });
        setResolutionNote("");
        await refreshSelection(
          workItemId === selectedWorkItemId ? workItemId : undefined,
        );
      },
      {
        title: "Execution resumed",
        description: workItemTitle
          ? `${workItemTitle} re-entered the queue.`
          : undefined,
      },
    );
  };

  const handleCancelWorkItem = async () => {
    if (
      !selectedWorkItem ||
      selectedWorkItem.status === "COMPLETED" ||
      selectedWorkItem.status === "CANCELLED" ||
      selectedWorkItem.status === "ARCHIVED" ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot cancel work items in this capability.",
      )
    ) {
      return;
    }

    const note =
      cancelWorkItemNote.trim() ||
      resolutionNote.trim() ||
      "Work item reset to the workflow entry step from the control plane.";

    await withAction(
      "cancelWorkItem",
      async () => {
        const nextWorkItem = await cancelCapabilityWorkItem(
          activeCapability.id,
          selectedWorkItem.id,
          {
            note,
          },
        );
        setWorkItemOverrides((current) => ({
          ...current,
          [nextWorkItem.id]: nextWorkItem,
        }));
        setCancelWorkItemNote("");
        setResolutionNote("");
        setIsCancelWorkItemOpen(false);
        setQueueView("MY_QUEUE");
        setSelectedWorkItemId(nextWorkItem.id);
        await refreshSelection(nextWorkItem.id).catch(() => undefined);
      },
      {
        title: "Work item reset",
        description: `${selectedWorkItem.title} was rolled back to the workflow entry step and is ready to start again.`,
      },
    );
  };

  const handleArchiveWorkItem = async () => {
    if (
      !selectedWorkItem ||
      selectedWorkItem.status === "ARCHIVED" ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot delete (archive) work items in this capability.",
      )
    ) {
      return;
    }

    const note =
      archiveWorkItemNote.trim() ||
      resolutionNote.trim() ||
      "Work item archived from the control plane.";
    const nextVisibleWorkItemId =
      filteredWorkItems.find(
        (item) => item.id !== selectedWorkItem.id && item.status !== "ARCHIVED",
      )?.id || null;

    await withAction(
      "archiveWorkItem",
      async () => {
        const nextWorkItem = await archiveCapabilityWorkItem(
          activeCapability.id,
          selectedWorkItem.id,
          { note },
        );
        setWorkItemOverrides((current) => ({
          ...current,
          [nextWorkItem.id]: nextWorkItem,
        }));
        setArchiveWorkItemNote("");
        setResolutionNote("");
        setIsArchiveWorkItemOpen(false);
        if (nextVisibleWorkItemId) {
          setSelectedWorkItemId(nextVisibleWorkItemId);
        } else {
          clearSelectedWorkItem();
        }
        await refreshSelection(nextWorkItem.id).catch(() => undefined);
      },
      {
        title: "Work item archived",
        description: `${selectedWorkItem.title} moved to the Archive and its run history was cleaned up.`,
      },
    );
  };

  const handleRestoreWorkItem = async () => {
    if (
      !selectedWorkItem ||
      selectedWorkItem.status !== "ARCHIVED" ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot restore archived work items in this capability.",
      )
    ) {
      return;
    }

    const note =
      restoreWorkItemNote.trim() ||
      resolutionNote.trim() ||
      "Work item restored from the archive.";

    await withAction(
      "restoreWorkItem",
      async () => {
        const nextWorkItem = await restoreCapabilityWorkItem(
          activeCapability.id,
          selectedWorkItem.id,
          { note },
        );
        setWorkItemOverrides((current) => ({
          ...current,
          [nextWorkItem.id]: nextWorkItem,
        }));
        setRestoreWorkItemNote("");
        setResolutionNote("");
        setIsRestoreWorkItemOpen(false);
        setQueueView("MY_QUEUE");
        await refreshSelection(nextWorkItem.id).catch(() => undefined);
      },
      {
        title: "Work item restored",
        description: `${selectedWorkItem.title} was restored to its initial phase so execution can restart.`,
      },
    );
  };

  const handleMoveWorkItem = async (
    workItemId: string,
    targetPhase: WorkItemPhase,
    options?: { cancelRunIfPresent?: boolean; note?: string },
  ) => {
    const item = workItems.find((current) => current.id === workItemId);
    if (
      !item ||
      item.phase === targetPhase ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot move work items across phases.",
      )
    ) {
      return;
    }

    await withAction(
      `move-${workItemId}`,
      async () => {
        await moveCapabilityWorkItem(activeCapability.id, workItemId, {
          targetPhase,
          cancelRunIfPresent: options?.cancelRunIfPresent,
          note:
            options?.note ||
            `Story moved to ${getPhaseMeta(targetPhase).label} from the orchestration board.`,
        });
        await refreshSelection(
          selectedWorkItemId === workItemId ? workItemId : undefined,
        );
      },
      {
        title: "Work item moved",
        description: `${item.title} moved to ${getPhaseMeta(targetPhase).label}.`,
      },
    );
  };

  const handleConfirmPhaseMove = async () => {
    if (
      !phaseMoveRequest ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot move work items across phases.",
      )
    ) {
      return;
    }

    const item = workItems.find(
      (current) => current.id === phaseMoveRequest.workItemId,
    );
    if (!item) {
      setPhaseMoveRequest(null);
      setPhaseMoveNote("");
      return;
    }

    if (item.phase === phaseMoveRequest.targetPhase) {
      setPhaseMoveRequest(null);
      setPhaseMoveNote("");
      return;
    }

    const targetLabel = getPhaseMeta(phaseMoveRequest.targetPhase).label;
    const note =
      phaseMoveNote.trim() ||
      `Phase changed to ${targetLabel} from the phase rail.`;

    await withAction(
      `move-${item.id}`,
      async () => {
        await moveCapabilityWorkItem(activeCapability.id, item.id, {
          targetPhase: phaseMoveRequest.targetPhase,
          cancelRunIfPresent: true,
          note,
        });
        setPhaseMoveRequest(null);
        setPhaseMoveNote("");
        await refreshSelection(
          selectedWorkItemId === item.id ? item.id : undefined,
        );
      },
      {
        title: "Work item moved",
        description: `${item.title} moved to ${targetLabel}.`,
      },
    );
  };

  const handleRefresh = async () => {
    await withAction("refresh", async () => {
      await Promise.all([refreshSelection(selectedWorkItemId), loadRuntime()]);
    });
  };

  const openPhaseMoveDialog = (
    workItemId: string,
    targetPhase: WorkItemPhase,
  ) => {
    const item = workItems.find((current) => current.id === workItemId);
    if (
      !item ||
      item.phase === targetPhase ||
      !requirePermission(
        canControlWorkItems,
        "This operator cannot move work items across phases.",
      ) ||
      busyAction !== null
    ) {
      return;
    }

    setActionError("");
    setPhaseMoveNote("");
    if (selectedWorkItem?.id !== workItemId) {
      selectWorkItem(workItemId);
    }
    setPhaseMoveRequest({
      workItemId,
      targetPhase,
    });
  };

  const handleStageControlRefresh = async () => {
    if (!selectedWorkItem) {
      return;
    }

    setDetailTab("attempts");
    await refreshSelection(selectedWorkItem.id);
  };

  const updateStageChatMessages = useCallback(
    (
      scopeKey: string,
      updater: (current: StageChatMessage[]) => StageChatMessage[],
    ) => {
      setStageChatByScope((current) => ({
        ...current,
        [scopeKey]: updater(current[scopeKey] || []),
      }));
    },
    [],
  );

  const handleOpenFullChat = async () => {
    if (
      !selectedAgent ||
      !requirePermission(
        canReadChat,
        "This operator cannot open the full chat workspace.",
      )
    ) {
      return;
    }

    try {
      await setActiveChatAgent(activeCapability.id, selectedAgent.id);
      navigate("/chat");
    } catch (error) {
      showError(
        "Unable to open chat",
        error instanceof Error
          ? error.message
          : "Unable to switch the active chat agent.",
      );
    }
  };

  const handleStageChatSend = async (event?: React.FormEvent) => {
    event?.preventDefault();

    if (
      !selectedAgent ||
      !selectedWorkItem ||
      !stageChatScopeKey ||
      !runtimeReady ||
      isStageChatSending ||
      !requirePermission(
        canWriteChat,
        "This operator cannot send chat guidance from the workbench.",
      )
    ) {
      return;
    }

    const nextMessage = stageChatInput.trim();
    if (!nextMessage) {
      return;
    }

    const userMessage: StageChatMessage = {
      id: `${Date.now()}-stage-user`,
      role: "user",
      content: nextMessage,
      timestamp: formatTimestamp(),
    };

    const history = [...selectedStageChatMessages, userMessage].map(
      (message) => ({
        id: message.id,
        capabilityId: activeCapability.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        ...(message.role === "agent"
          ? {
              agentId: selectedAgent.id,
              agentName: selectedAgent.name,
              traceId: message.traceId,
              model: message.model,
              sessionId: message.sessionId,
              sessionScope: message.sessionScope,
              sessionScopeId: message.sessionScopeId,
              workItemId: selectedWorkItem.id,
              runId: currentRun?.id,
              workflowStepId: selectedCurrentStep?.id,
            }
          : {
              sessionScope: "WORK_ITEM" as const,
              sessionScopeId: selectedWorkItem.id,
              workItemId: selectedWorkItem.id,
              runId: currentRun?.id,
              workflowStepId: selectedCurrentStep?.id,
            }),
      }),
    );

    updateStageChatMessages(stageChatScopeKey, (current) => [
      ...current,
      userMessage,
    ]);
    setStageChatInput("");
    setStageChatDraft("");
    setStageChatError("");
    setIsStageChatSending(true);
    const requestToken = ++stageChatRequestRef.current;

    try {
      await setActiveChatAgent(activeCapability.id, selectedAgent.id);
      const streamResult = await streamCapabilityChat(
        {
          capability: activeCapability,
          agent: selectedAgent,
          history,
          message: nextMessage,
          sessionMode: "resume",
          sessionScope: "WORK_ITEM",
          sessionScopeId: selectedWorkItem.id,
          contextMode: "WORK_ITEM_STAGE",
          workItemId: selectedWorkItem.id,
          runId: currentRun?.id,
          workflowStepId: selectedCurrentStep?.id,
        },
        {
          onEvent: (streamEvent) => {
            if (stageChatRequestRef.current !== requestToken) {
              return;
            }

            if (streamEvent.type === "delta" && streamEvent.content) {
              setStageChatDraft((current) => current + streamEvent.content);
            }

            if (streamEvent.type === "error" && streamEvent.error) {
              setStageChatError(streamEvent.error);
            }
          },
        },
      );

      if (stageChatRequestRef.current !== requestToken) {
        return;
      }

      const assistantContent =
        streamResult.completeEvent?.content || streamResult.draftContent;

      if (!assistantContent.trim()) {
        throw new Error(
          streamResult.error || "The stage agent did not return a response.",
        );
      }

      updateStageChatMessages(stageChatScopeKey, (current) => [
        ...current,
        {
          id: `${Date.now()}-stage-agent`,
          role: "agent",
          content: assistantContent,
          timestamp: formatTimestamp(
            streamResult.completeEvent?.createdAt
              ? new Date(streamResult.completeEvent.createdAt)
              : new Date(),
          ),
          deliveryState:
            streamResult.termination === "complete"
              ? "clean"
              : streamResult.termination === "recovered"
                ? "recovered"
                : "interrupted",
          error: streamResult.error,
          traceId: streamResult.completeEvent?.traceId,
          model: streamResult.completeEvent?.model || selectedAgent.model,
          sessionId: streamResult.completeEvent?.sessionId,
          sessionScope: streamResult.completeEvent?.sessionScope,
          sessionScopeId: streamResult.completeEvent?.sessionScopeId,
        },
      ]);
      setStageChatDraft("");
      await refreshCapabilityBundle(activeCapability.id);
    } catch (error) {
      if (stageChatRequestRef.current !== requestToken) {
        return;
      }

      const nextError =
        error instanceof Error
          ? error.message
          : "The stage agent could not complete this request.";
      setStageChatDraft("");
      setStageChatError(nextError);
    } finally {
      if (stageChatRequestRef.current === requestToken) {
        setIsStageChatSending(false);
      }
    }
  };

  const approvalReviewModalNode =
    isApprovalReviewOpen &&
    selectedWorkItem &&
    approvalReviewWait?.type === "APPROVAL" ? (
      <OrchestratorApprovalReviewModal
        workItemTitle={selectedWorkItem.title}
        approvalWait={approvalReviewWait}
        isHydrated={isApprovalReviewHydrated}
        onClose={() => {
          setIsApprovalReviewOpen(false);
          setIsApprovalReviewHydrated(false);
          if (selectedOpenWait?.type !== "APPROVAL") {
            setApprovalReviewWaitSnapshot(null);
          }
        }}
        currentPhaseLabel={getPhaseMeta(selectedWorkItem.phase).label}
        currentStepName={selectedCurrentStep?.name || "Awaiting orchestration"}
        currentRunId={
          currentRun?.id || selectedWorkItem.activeRunId || "Not attached"
        }
        requestedByLabel={
          agentsById.get(selectedAttentionRequestedBy || "")?.name ||
          selectedAttentionRequestedBy ||
          "System"
        }
        requestedAt={selectedAttentionTimestamp}
        totalDocuments={selectedWorkItemArtifacts.length}
        hasCodeDiffApproval={selectedHasCodeDiffApproval}
        approvalAssignments={approvalAssignments}
        approvalDecisionByAssignmentId={approvalDecisionByAssignmentId}
        unassignedApprovalDecisions={unassignedApprovalDecisions}
        workspaceUsersById={workspaceUsersById}
        workspaceTeamsById={workspaceTeamsById}
        interactionFeed={selectedInteractionFeed}
        onOpenArtifactFromTimeline={handleOpenArtifactFromTimeline}
        onOpenRunFromTimeline={(runId) => void handleOpenRunFromTimeline(runId)}
        onOpenTaskFromTimeline={handleOpenTaskFromTimeline}
        filteredApprovalArtifacts={filteredApprovalArtifacts}
        approvalArtifactFilter={approvalArtifactFilter}
        onApprovalArtifactFilterChange={setApprovalArtifactFilter}
        selectedApprovalArtifact={selectedApprovalArtifact}
        selectedApprovalArtifactDocument={selectedApprovalArtifactDocument}
        onSelectApprovalArtifact={setSelectedApprovalArtifactId}
        resolutionNote={resolutionNote}
        onResolutionNoteChange={setResolutionNote}
        resolutionPlaceholder={resolutionPlaceholder}
        requestChangesIsAvailable={requestChangesIsAvailable}
        canRequestChanges={canRequestChanges}
        canResolveSelectedWait={canResolveSelectedWait}
        busyAction={busyAction}
        onRequestChanges={() => void handleRequestChanges()}
        onResolveWait={() => void handleResolveWait()}
        actionButtonLabel={actionButtonLabel}
        onOpenDiffReview={() => setIsDiffReviewOpen(true)}
        resetKey={`${selectedWorkItem.id}:${approvalReviewWait.id}:${selectedApprovalArtifact?.id || "none"}`}
      />
    ) : null;

  const diffReviewModalNode =
    isDiffReviewOpen && selectedHasCodeDiffApproval ? (
      <OrchestratorDiffReviewModal
        selectedCodeDiffArtifact={selectedCodeDiffArtifact}
        selectedCodeDiffDocument={selectedCodeDiffDocument}
        summary={
          selectedCodeDiffArtifact?.summary ||
          selectedOpenWait?.payload?.codeDiffSummary ||
          ""
        }
        repositoryCount={selectedCodeDiffRepositoryCount}
        touchedFileCount={selectedCodeDiffTouchedFileCount || "Tracked in diff"}
        onClose={() => setIsDiffReviewOpen(false)}
      />
    ) : null;

  const quickActionDialogsNode = (
    <OrchestratorQuickActionDialogs
      phaseMoveRequest={phaseMoveRequest}
      phaseMoveItem={phaseMoveItem}
      phaseMoveNote={phaseMoveNote}
      setPhaseMoveNote={setPhaseMoveNote}
      closePhaseMove={() => {
        setPhaseMoveRequest(null);
        setPhaseMoveNote("");
      }}
      handleConfirmPhaseMove={handleConfirmPhaseMove}
      selectedWorkItem={selectedWorkItem}
      isArchiveWorkItemOpen={isArchiveWorkItemOpen}
      archiveWorkItemNote={archiveWorkItemNote}
      setArchiveWorkItemNote={setArchiveWorkItemNote}
      closeArchive={() => setIsArchiveWorkItemOpen(false)}
      handleArchiveWorkItem={handleArchiveWorkItem}
      isRestoreWorkItemOpen={isRestoreWorkItemOpen}
      restoreWorkItemNote={restoreWorkItemNote}
      setRestoreWorkItemNote={setRestoreWorkItemNote}
      closeRestore={() => setIsRestoreWorkItemOpen(false)}
      handleRestoreWorkItem={handleRestoreWorkItem}
      isCancelWorkItemOpen={isCancelWorkItemOpen}
      cancelWorkItemNote={cancelWorkItemNote}
      setCancelWorkItemNote={setCancelWorkItemNote}
      closeCancel={() => setIsCancelWorkItemOpen(false)}
      handleCancelWorkItem={handleCancelWorkItem}
      actionError={actionError}
      busyAction={busyAction}
      canControlWorkItems={canControlWorkItems}
      currentActorDisplayName={currentActorContext.displayName}
      getPhaseMeta={getPhaseMeta}
    />
  );

  // Phase-segment start dialog. Rendered as a sibling overlay so it stacks
  // above the quick-action dialogs when both are open (e.g. operator opens
  // Start Segment, then decides to archive instead — the archive dialog
  // wins by z-index z-[93], this one sits at z-[94]).
  const startSegmentDialogNode = (
    <StartSegmentDialog
      open={startSegmentWorkItemId !== null}
      workItem={
        startSegmentWorkItemId
          ? workItems.find((item) => item.id === startSegmentWorkItemId) || null
          : null
      }
      capability={activeCapability}
      busy={startSegmentBusy}
      error={startSegmentError}
      defaultIntention={
        startSegmentWorkItemId
          ? workItems.find((item) => item.id === startSegmentWorkItemId)
              ?.nextSegmentPreset?.intention || ""
          : ""
      }
      onClose={closeStartSegmentDialog}
      onSubmit={handleSubmitStartSegment}
    />
  );

  const stageControlOverlayNode = selectedWorkItem ? (
    <ErrorBoundary
      resetKey={`${selectedWorkItem.id}:${selectedAgent?.id || "none"}:${selectedCurrentStep?.id || "stage"}:${isStageControlOpen ? "open" : "closed"}`}
      title="Stage control could not render"
      description="The takeover window hit an unexpected UI problem. The workbench is still available, and you can reopen stage control or use Full Chat while we keep the route alive."
    >
      <StageControlModal
        isOpen={isStageControlOpen}
        capability={activeCapability}
        workItem={selectedWorkItem}
        agent={selectedAgent}
        currentRun={currentRun}
        currentStep={selectedCurrentStep}
        openWait={selectedOpenWait}
        compiledStepContext={selectedCompiledStepContext}
        failureReason={selectedFailureReason || undefined}
        runtimeReady={runtimeReady}
        runtimeError={runtimeError}
        onClose={() => setIsStageControlOpen(false)}
        onRefresh={handleStageControlRefresh}
      />
    </ErrorBoundary>
  ) : null;

  const explainDrawerOverlayNode = (
    <ExplainWorkItemDrawer
      capability={activeCapability}
      workItem={selectedWorkItem}
      isOpen={isExplainOpen}
      onClose={() => setIsExplainOpen(false)}
    />
  );

  if (view === "list") {
    const attentionById = new Map(
      attentionItems.map((entry) => [entry.item.id, entry]),
    );
    const remainingItems = filteredWorkItems
      .filter((item) => !attentionById.has(item.id))
      .slice()
      .sort((left, right) => {
        const leftTime = new Date(
          getWorkItemAttentionTimestamp(left) ||
            left.history[left.history.length - 1]?.timestamp ||
            0,
        ).getTime();
        const rightTime = new Date(
          getWorkItemAttentionTimestamp(right) ||
            right.history[right.history.length - 1]?.timestamp ||
            0,
        ).getTime();
        return rightTime - leftTime;
      });

    const inboxEntries = [
      ...attentionItems.map((entry) => ({
        item: entry.item,
        meta: buildNavigatorItem(entry.item),
        attention: entry,
      })),
      ...remainingItems.map((item) => ({
        item,
        meta: buildNavigatorItem(item),
        attention: null as (typeof attentionItems)[number] | null,
      })),
    ];

    const dockCanResolveWait = Boolean(
      selectedOpenWait &&
      selectedWorkItem?.status !== "PAUSED" &&
      currentRun?.status !== "PAUSED" &&
      (selectedOpenWait.type === "APPROVAL"
        ? canDecideApprovals
        : canControlWorkItems) &&
      (!dockResolutionRequired ||
        Boolean(dockInput.trim()) ||
        waitOnlyRequestsApprovedWorkspace) &&
      !(
        selectedOpenWait.type === "INPUT" &&
        waitRequiresApprovedWorkspace &&
        !hasApprovedWorkspaceConfigured
      ),
    );

    const phaseRailCurrentIndex = selectedWorkItem
      ? lifecycleBoardPhases.indexOf(selectedWorkItem.phase)
      : -1;
    const phaseRailTargetPhase =
      selectedWorkItem &&
      phaseRailPreviewPhase &&
      lifecycleBoardPhases.includes(phaseRailPreviewPhase)
        ? phaseRailPreviewPhase
        : selectedWorkItem?.phase || null;
    const phaseRailTargetIndex =
      phaseRailTargetPhase !== null
        ? lifecycleBoardPhases.indexOf(phaseRailTargetPhase)
        : -1;
    const phaseRailInsetPx = 16;
    const phaseRailCanInteract = Boolean(
      selectedWorkItem && canControlWorkItems && busyAction === null,
    );
    const phaseRailPreviewingMove = Boolean(
      selectedWorkItem &&
      phaseRailTargetPhase &&
      phaseRailTargetPhase !== selectedWorkItem.phase,
    );

    const resolvePhaseFromClientX = (clientX: number): WorkItemPhase | null => {
      const track = phaseRailTrackRef.current;
      if (!track || lifecycleBoardPhases.length === 0) {
        return null;
      }

      if (lifecycleBoardPhases.length === 1) {
        return lifecycleBoardPhases[0] || null;
      }

      const bounds = track.getBoundingClientRect();
      if (!bounds.width) {
        return selectedWorkItem?.phase || null;
      }

      const railStart = bounds.left + phaseRailInsetPx;
      const railEnd = bounds.right - phaseRailInsetPx;
      const usableWidth = Math.max(1, railEnd - railStart);
      const clampedClientX = Math.min(railEnd, Math.max(railStart, clientX));
      const ratio = Math.min(
        1,
        Math.max(0, (clampedClientX - railStart) / usableWidth),
      );
      const nextIndex = Math.round(ratio * (lifecycleBoardPhases.length - 1));
      return lifecycleBoardPhases[nextIndex] || null;
    };

    const previewPhaseFromClientX = (clientX: number) => {
      const nextPhase = resolvePhaseFromClientX(clientX);
      if (nextPhase) {
        setPhaseRailPreviewPhase(nextPhase);
      }
      return nextPhase;
    };

    const phaseRailMeasureForIndex = (index: number) => {
      if (lifecycleBoardPhases.length <= 1) {
        return { ratio: 0, cssValue: `${phaseRailInsetPx}px` };
      }

      const ratio = Math.min(
        1,
        Math.max(0, index / (lifecycleBoardPhases.length - 1)),
      );
      const offsetPx = (1 - ratio * 2) * phaseRailInsetPx;
      return {
        ratio,
        cssValue: `calc(${(ratio * 100).toFixed(4)}% + ${offsetPx.toFixed(2)}px)`,
      };
    };

    const commitPhaseRailPreview = (targetPhase?: WorkItemPhase | null) => {
      setIsPhaseRailDragging(false);
      const nextPhase =
        targetPhase || phaseRailPreviewPhase || selectedWorkItem?.phase || null;
      setPhaseRailPreviewPhase(null);
      if (
        !selectedWorkItem ||
        !nextPhase ||
        nextPhase === selectedWorkItem.phase
      ) {
        return;
      }
      openPhaseMoveDialog(selectedWorkItem.id, nextPhase);
    };

    const handlePhaseRailPointerDown = (
      event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>,
    ) => {
      if (!phaseRailCanInteract || !selectedWorkItem) {
        return;
      }

      if (
        (event.target as HTMLElement).closest(
          '[data-phase-station-button="true"]',
        )
      ) {
        return;
      }

      event.preventDefault();
      setIsPhaseRailDragging(true);
      const initialPhase = previewPhaseFromClientX(event.clientX);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        previewPhaseFromClientX(moveEvent.clientX);
      };

      const completeDrag = (pointerEvent?: PointerEvent) => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        commitPhaseRailPreview(
          pointerEvent
            ? previewPhaseFromClientX(pointerEvent.clientX)
            : initialPhase,
        );
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        completeDrag(upEvent);
      };

      const handlePointerCancel = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        setIsPhaseRailDragging(false);
        setPhaseRailPreviewPhase(null);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
    };

    return (
      <OrchestratorListMode
        workbench={
          <>
            <OrchestratorListWorkbench
              capabilityName={activeCapability.name}
              canStartDelivery={capabilityExperience.canStartDelivery}
              runtimeReady={runtimeReady}
              filteredWorkItemsCount={filteredWorkItems.length}
              totalWorkItemsCount={workItems.length}
              currentActorDisplayName={currentActorContext.displayName}
              queueView={queueView}
              runtimeError={runtimeError}
              busyAction={busyAction}
              canCreateWorkItems={canCreateWorkItems}
              onRefresh={() => void handleRefresh()}
              onOpenCreate={() => setIsCreateSheetOpen(true)}
              onSwitchToList={() => setView("list")}
              onSwitchToBoard={() => setView("board")}
              lifecycleRail={
                <OrchestratorLifecycleRail
                  selectedWorkItem={selectedWorkItem}
                  selectedWorkflowName={selectedWorkflow?.name || null}
                  selectedStatusTone={
                    selectedWorkItem
                      ? getStatusTone(selectedWorkItem.status)
                      : "neutral"
                  }
                  selectedStatusLabel={
                    selectedWorkItem
                      ? WORK_ITEM_STATUS_META[selectedWorkItem.status].label
                      : "No selection"
                  }
                  canControlWorkItems={canControlWorkItems}
                  phaseRailPreviewingMove={phaseRailPreviewingMove}
                  phaseRailTargetPhase={phaseRailTargetPhase}
                  lifecycleBoardPhases={lifecycleBoardPhases}
                  phaseRailTrackRef={phaseRailTrackRef}
                  onTrackPointerDown={handlePhaseRailPointerDown}
                  phaseRailCurrentIndex={phaseRailCurrentIndex}
                  phaseRailTargetIndex={phaseRailTargetIndex}
                  measureForIndex={phaseRailMeasureForIndex}
                  onOpenPhaseMoveDialog={openPhaseMoveDialog}
                  phaseRailCanInteract={phaseRailCanInteract}
                  isPhaseRailDragging={isPhaseRailDragging}
                  onHandleKeyDown={(event) => {
                    if (!phaseRailCanInteract || !selectedWorkItem) {
                      return;
                    }

                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      event.preventDefault();
                      const direction = event.key === "ArrowLeft" ? -1 : 1;
                      const nextIndex = Math.min(
                        lifecycleBoardPhases.length - 1,
                        Math.max(0, phaseRailTargetIndex + direction),
                      );
                      setPhaseRailPreviewPhase(
                        lifecycleBoardPhases[nextIndex] || null,
                      );
                      return;
                    }

                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      commitPhaseRailPreview();
                    }
                  }}
                  onSwitchOperator={() => navigate("/login")}
                  getPhaseMeta={getPhaseMeta}
                />
              }
              liveDetailWarning={
                !canReadLiveDetail ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    This operator currently has rollup-only visibility for this
                    capability. Live work items, execution traces, and control
                    actions are intentionally hidden until direct capability
                    access is granted.
                  </div>
                ) : null
              }
              inboxPanel={
                <OrchestratorInboxPanel
                  filteredWorkItemsCount={filteredWorkItems.length}
                  searchQuery={searchQuery}
                  onSearchQueryChange={setSearchQuery}
                  queueView={queueView}
                  onQueueViewChange={setQueueView}
                  queueCounts={queueCounts}
                  isInboxFilterTrayOpen={isInboxFilterTrayOpen}
                  onToggleInboxFilterTray={() =>
                    setIsInboxFilterTrayOpen((current) => !current)
                  }
                  workflowFilter={workflowFilter}
                  onWorkflowFilterChange={setWorkflowFilter}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  priorityFilter={priorityFilter}
                  onPriorityFilterChange={setPriorityFilter}
                  workflows={workspace.workflows.map((workflow) => ({
                    id: workflow.id,
                    name: workflow.name,
                  }))}
                  inboxEntries={inboxEntries}
                  selectedWorkItemId={selectedWorkItemId}
                  busyAction={busyAction}
                  onSelectInboxEntry={(workItemId, focusDock) => {
                    const targetItem =
                      workItems.find((item) => item.id === workItemId) || null;
                    // Awaiting-approval cards must land in the approval workspace,
                    // regardless of whether the signal comes from `pendingRequest`
                    // (request-driven flow) or `status === 'PENDING_APPROVAL'`
                    // (state-driven flow). Previously only pendingRequest was
                    // checked, so items that had dropped the pending request but
                    // kept the status landed on the main screen instead.
                    const isApprovalAttention =
                      targetItem?.pendingRequest?.type === "APPROVAL" ||
                      targetItem?.status === "PENDING_APPROVAL";
                    if (isApprovalAttention) {
                      void openApprovalWorkspaceForWorkItem(workItemId);
                      return;
                    }
                    selectWorkItem(workItemId);
                    if (focusDock) {
                      focusDockComposer();
                    }
                  }}
                  onPauseRun={handlePauseRunById}
                  onResumeRun={handleResumeRunById}
                  onOpenRestore={(workItemId) => {
                    selectWorkItem(workItemId);
                    setActionError("");
                    setRestoreWorkItemNote("");
                    setIsRestoreWorkItemOpen(true);
                  }}
                  onOpenArchive={(workItemId) => {
                    selectWorkItem(workItemId);
                    setActionError("");
                    setArchiveWorkItemNote("");
                    setIsArchiveWorkItemOpen(true);
                  }}
                  onOpenCancel={(workItemId) => {
                    selectWorkItem(workItemId);
                    setActionError("");
                    setCancelWorkItemNote("");
                    setIsCancelWorkItemOpen(true);
                  }}
                  onOpenStartSegment={(workItemId) => {
                    selectWorkItem(workItemId);
                    openStartSegmentDialog(workItemId);
                  }}
                  onStartNextSegment={handleStartNextSegment}
                  getPhaseMeta={getPhaseMeta}
                  getStatusTone={getStatusTone}
                  getStatusLabel={(status) =>
                    WORK_ITEM_STATUS_META[status].label
                  }
                />
              }
              selectedWorkPanel={
                <OrchestratorSelectedWorkPanel
                  selectedWorkItem={selectedWorkItem}
                  emptyStateIcon={WorkflowIcon}
                  phaseLabel={
                    selectedWorkItem
                      ? getPhaseMeta(selectedWorkItem.phase).label
                      : "Unknown"
                  }
                  phaseTone={
                    selectedWorkItem
                      ? getStatusTone(selectedWorkItem.phase)
                      : "neutral"
                  }
                  workItemStatusLabel={
                    selectedWorkItem
                      ? WORK_ITEM_STATUS_META[selectedWorkItem.status].label
                      : "No selection"
                  }
                  workItemStatusTone={
                    selectedWorkItem
                      ? getStatusTone(selectedWorkItem.status)
                      : "neutral"
                  }
                  currentRunStatusLabel={
                    currentRun ? RUN_STATUS_META[currentRun.status].label : null
                  }
                  currentRunStatusTone={
                    currentRun ? getStatusTone(currentRun.status) : null
                  }
                  canStartExecution={canStartExecution}
                  canReadChat={canReadChat}
                  canControlWorkItems={canControlWorkItems}
                  currentRunIsActive={Boolean(
                    currentRunIsActive &&
                    currentRun &&
                    currentRun.status !== "PAUSED",
                  )}
                  currentRunIsPaused={Boolean(
                    currentRun && currentRun.status === "PAUSED",
                  )}
                  selectedCurrentStepLabel={
                    selectedCurrentStep?.name || "Awaiting orchestration"
                  }
                  selectedAgentLabel={
                    selectedAgent?.name || selectedAgent?.id || "Unassigned"
                  }
                  selectedAttentionTimestamp={selectedAttentionTimestamp}
                  selectedAttentionLabel={selectedAttentionLabel}
                  selectedNextActionSummary={selectedNextActionSummary}
                  selectedStateSummary={selectedStateSummary}
                  selectedBlockerSummary={selectedBlockerSummary}
                  actionError={actionError}
                  busyAction={busyAction}
                  onStartExecution={() => void handleStartExecution()}
                  onExplain={() => setIsExplainOpen(true)}
                  onCreateEvidencePacket={() =>
                    void handleCreateEvidencePacket()
                  }
                  canOpenReleasePassport={canOpenReleasePassport}
                  onOpenReleasePassport={handleOpenReleasePassport}
                  onOpenFullChat={() => void handleOpenFullChat()}
                  onPauseRun={() =>
                    currentRun && selectedWorkItem
                      ? void handlePauseRunById({
                          runId: currentRun.id,
                          workItemId: selectedWorkItem.id,
                          workItemTitle: selectedWorkItem.title,
                        })
                      : undefined
                  }
                  onResumeRun={() =>
                    currentRun && selectedWorkItem
                      ? void handleResumeRunById({
                          runId: currentRun.id,
                          workItemId: selectedWorkItem.id,
                          workItemTitle: selectedWorkItem.title,
                        })
                      : undefined
                  }
                  onOpenRestore={() => {
                    setActionError("");
                    setRestoreWorkItemNote("");
                    setIsRestoreWorkItemOpen(true);
                  }}
                  onOpenArchive={() => {
                    setActionError("");
                    setArchiveWorkItemNote("");
                    setIsArchiveWorkItemOpen(true);
                  }}
                  onOpenCancel={() => {
                    setActionError("");
                    setCancelWorkItemNote("");
                    setIsCancelWorkItemOpen(true);
                  }}
                  formatTimestamp={formatTimestamp}
                />
              }
              copilotDock={
                <OrchestratorCopilotDock
                  selectedWorkItemPresent={Boolean(selectedWorkItem)}
                  selectedWorkItemId={selectedWorkItem?.id || null}
                  selectedWorkItemTitle={selectedWorkItem?.title || null}
                  primaryCopilotAgentName={primaryCopilotAgent?.name || null}
                  copilotRoutingLabel={
                    primaryCopilotAgent
                      ? selectedAgent?.id === primaryCopilotAgent.id
                        ? "Primary copilot active"
                        : `Routing with ${selectedAgent?.name || primaryCopilotAgent.role}`
                      : null
                  }
                  dockMessagesCount={dockMessages.length}
                  busyAction={busyAction}
                  canOpenReleasePassport={canOpenReleasePassport}
                  onOpenReleasePassport={handleOpenReleasePassport}
                  onClearChat={() => void handleClearDockChat()}
                  statusContent={dockStatusContent}
                  threadContent={dockThreadContent}
                  dockError={dockError}
                  onComposerDrop={addDockUploadFiles}
                  dockComposerLabel={dockComposerLabel}
                  dockInput={dockInput}
                  onDockInputChange={setDockInput}
                  dockComposerPlaceholder={dockComposerPlaceholder}
                  helperText={dockComposerHelperText}
                  dockUploads={dockUploads}
                  renderUploadIcon={(upload) =>
                    upload.kind === "image" && upload.previewUrl ? (
                      <img
                        src={upload.previewUrl}
                        alt={upload.file.name}
                        className="h-10 w-10 rounded-xl object-cover"
                      />
                    ) : (
                      <FileText size={14} className="text-secondary" />
                    )
                  }
                  formatAttachmentSizeLabel={formatAttachmentSizeLabel}
                  onRemoveUpload={removeDockUpload}
                  onAddUploads={addDockUploadFiles}
                  selectedOpenWaitPresent={Boolean(selectedOpenWait)}
                  dockAllowsChatOnly={dockAllowsChatOnly}
                  isDockSending={isDockSending}
                  canWriteChat={canWriteChat}
                  onAskAgent={() => void handleDockAskAgent()}
                  onResolveWait={() => void handleDockResolveWait()}
                  dockCanResolveWait={dockCanResolveWait}
                  dockPrimaryActionLabel={dockPrimaryActionLabel}
                  selectedOpenWaitType={selectedOpenWait?.type || null}
                  selectedCanGuideBlockedAgent={selectedCanGuideBlockedAgent}
                  onGuideAndRestart={() => void handleDockGuideAndRestart()}
                  canStartExecution={canStartExecution}
                  onStartExecution={() => void handleDockStartExecution()}
                  dockTextareaRef={dockTextareaRef}
                />
              }
            />
          </>
        }
        overlays={
          <OrchestratorSharedOverlays
            approvalReviewModal={approvalReviewModalNode}
            diffReviewModal={diffReviewModalNode}
            quickActionDialogs={
              <>
                {quickActionDialogsNode}
                {startSegmentDialogNode}
              </>
            }
            quickCreateSheet={
              <OrchestratorListWorkbenchOverlays
                quickCreateSheet={
                  <OrchestratorQuickCreateSheet
                    isOpen={isCreateSheetOpen}
                    workflows={workspace.workflows.map((workflow) => ({
                      id: workflow.id,
                      name: workflow.name,
                    }))}
                    draftWorkItem={{
                      title: draftWorkItem.title,
                      description: draftWorkItem.description,
                      workflowId: draftWorkItem.workflowId,
                      attachments: draftWorkItem.attachments,
                    }}
                    busyAction={busyAction}
                    canCreateWorkItems={canCreateWorkItems}
                    formatAttachmentSizeLabel={formatAttachmentSizeLabel}
                    onClose={() => setIsCreateSheetOpen(false)}
                    onSubmit={handleCreateWorkItem}
                    onTitleChange={(value) =>
                      setDraftWorkItem((prev) => ({ ...prev, title: value }))
                    }
                    onWorkflowChange={(value) =>
                      setDraftWorkItem((prev) => ({
                        ...prev,
                        workflowId: value,
                      }))
                    }
                    onDescriptionChange={(value) =>
                      setDraftWorkItem((prev) => ({
                        ...prev,
                        description: value,
                      }))
                    }
                    onUploadAttachments={(files) => {
                      void handleDraftAttachmentUpload(files);
                    }}
                    onClearAttachments={() =>
                      setDraftWorkItem((prev) => ({ ...prev, attachments: [] }))
                    }
                    onRemoveAttachment={removeDraftAttachment}
                  />
                }
                stageControl={stageControlOverlayNode}
                explainDrawer={explainDrawerOverlayNode}
              />
            }
          />
        }
      />
    );
  }

  return (
    <OrchestratorBoardMode
      workbench={
        <OrchestratorBoardWorkbench
          capabilityName={activeCapability.name}
          canStartDelivery={capabilityExperience.canStartDelivery}
          runtimeReady={runtimeReady}
          stats={stats}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          queueView={queueView}
          onQueueViewChange={setQueueView}
          workflowFilter={workflowFilter}
          onWorkflowFilterChange={setWorkflowFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          priorityFilter={priorityFilter}
          onPriorityFilterChange={setPriorityFilter}
          workflows={workspace.workflows.map((workflow) => ({
            id: workflow.id,
            name: workflow.name,
          }))}
          filteredWorkItemsCount={filteredWorkItems.length}
          totalWorkItemsCount={workItems.length}
          currentActorDisplayName={currentActorContext.displayName}
          runtimeError={runtimeError}
          busyAction={busyAction}
          canCreateWorkItems={canCreateWorkItems}
          onRefresh={() => void handleRefresh()}
          onOpenCreate={() => setIsCreateSheetOpen(true)}
          onSwitchToList={() => setView("list")}
          onSwitchToBoard={() => setView("board")}
          capabilityCockpit={
            <OrchestratorCapabilityCockpit
              canStartDelivery={capabilityExperience.canStartDelivery}
              deliveryBlockingItem={deliveryBlockingItem}
              nextActionTitle={capabilityExperience.nextAction.title}
              nextActionDescription={
                capabilityExperience.nextAction.description
              }
              goldenPathSummary={
                capabilityExperience.goldenPathProgress.summary
              }
              goldenPathPercentComplete={
                capabilityExperience.goldenPathProgress.percentComplete
              }
              goldenPathSteps={capabilityExperience.goldenPathProgress.steps.map(
                (step) => ({
                  id: step.id,
                  label: step.label,
                  path: step.path,
                  status: step.status as "COMPLETE" | "CURRENT" | "UP_NEXT",
                }),
              )}
              onNavigatePath={navigate}
              primaryCopilotAgentName={
                primaryCopilotAgent?.name || "Capability Copilot"
              }
              primaryCopilotAgentRole={
                primaryCopilotAgent?.role || "Unavailable"
              }
              primaryCopilotRoleSummary={
                primaryCopilotAgent?.rolePolicy?.summary ||
                "This copilot will interpret live work state and coordinate specialist responses."
              }
              selectedAgentName={
                selectedAgent?.name ||
                primaryCopilotAgent?.name ||
                "None selected"
              }
              selectedAgentQualitySummary={
                selectedAgent?.qualityBar?.label
                  ? `${selectedAgent.qualityBar.label}: ${selectedAgent.qualityBar.summary}`
                  : "Select a work item to see which specialist is currently active."
              }
              executionOwnerLabel={executionOwnerLabel}
              executionDispatchLabel={executionDispatchLabel}
              executionDispatchState={workspace.executionDispatchState}
              executionQueueReason={workspace.executionQueueReason}
              currentDesktopOwnsExecution={currentDesktopOwnsExecution}
              canClaimExecution={canClaimExecution}
              executionClaimBusy={executionClaimBusy}
              hasRuntimeExecutor={Boolean(runtimeStatus?.executorId)}
              onClaimDesktopExecution={(forceTakeover) =>
                void handleClaimDesktopExecution(forceTakeover)
              }
              onReleaseDesktopExecution={() =>
                void handleReleaseDesktopExecution()
              }
              canReadChat={canReadChat}
              primaryCopilotAvailable={Boolean(primaryCopilotAgent)}
              onOpenFullChat={() => void handleOpenFullChat()}
              onOpenTeam={() => navigate("/team")}
            />
          }
          liveDetailWarning={
            !canReadLiveDetail ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                This operator currently has rollup-only visibility for this
                capability. Live work items, execution traces, and control
                actions are intentionally hidden until direct capability access
                is granted.
              </div>
            ) : null
          }
          advancedDisclosure={
            <AdvancedDisclosure
              title="Advanced execution details"
              description="Runtime readiness, run-event counts, and telemetry links for operators who need deeper inspection."
              storageKey={STORAGE_KEYS.advanced}
              badge={
                <StatusBadge tone={runtimeReady ? "success" : "warning"}>
                  {runtimeReady ? "Connected" : "Needs attention"}
                </StatusBadge>
              }
            >
              <div className="grid gap-3 md:grid-cols-3">
                <div className="workspace-meta-card">
                  <p className="workspace-meta-label">Agent connection</p>
                  <p className="workspace-meta-value">
                    {runtimeReady ? "Ready" : "Needs setup"}
                  </p>
                  <p className="mt-1 text-xs text-secondary">
                    {runtimeError ||
                      "Agents can start or resume workflow execution."}
                  </p>
                </div>
                <div className="workspace-meta-card">
                  <p className="workspace-meta-label">Selected run events</p>
                  <p className="workspace-meta-value">
                    {selectedRunEvents.length}
                  </p>
                  <p className="mt-1 text-xs text-secondary">
                    Detailed run events remain available in Run Console.
                  </p>
                </div>
                <div className="workspace-meta-card">
                  <p className="workspace-meta-label">Run history</p>
                  <p className="workspace-meta-value">
                    {selectedRunHistory.length} runs
                  </p>
                  <p className="mt-1 text-xs text-secondary">
                    Attempts for the currently selected work item.
                  </p>
                </div>
              </div>
            </AdvancedDisclosure>
          }
          attentionQueue={
            <OrchestratorAttentionQueue
              attentionItems={attentionItems}
              selectedWorkItemId={selectedWorkItemId}
              onSelectWorkItem={handleSelectApprovalAttentionItem}
              resolveAgentName={(agentId) =>
                agentsById.get(agentId || "")?.name || agentId || "System"
              }
              getPhaseMeta={getPhaseMeta}
              formatRelativeTime={formatRelativeTime}
            />
          }
          boardSurface={
            <OrchestratorBoardSurface
              workflows={workspace.workflows}
              groupedItems={groupedItems}
              completedItems={completedItems}
              selectedWorkItemId={selectedWorkItemId}
              dragOverPhase={dragOverPhase}
              draggedWorkItemId={draggedWorkItemId}
              workflowsById={workflowsById}
              agentsById={agentsById}
              getPhaseMeta={getPhaseMeta}
              getStatusLabel={(status) => WORK_ITEM_STATUS_META[status].label}
              getAttentionLabel={getAttentionLabel}
              getAttentionReason={getAttentionReason}
              isConflictAttention={isConflictAttention}
              onSelectWorkItem={selectWorkItem}
              onDragOverPhase={(phase) => setDragOverPhase(phase)}
              onDragLeavePhase={(phase) =>
                setDragOverPhase((current) =>
                  current === phase ? null : current,
                )
              }
              onDropOnPhase={(phase, droppedId) => {
                setDragOverPhase(null);
                setDraggedWorkItemId(null);
                if (droppedId) {
                  void handleMoveWorkItem(droppedId, phase);
                }
              }}
              onDragStartWorkItem={(workItemId, event) => {
                setDraggedWorkItemId(workItemId);
                if ("dataTransfer" in event && event.dataTransfer) {
                  event.dataTransfer.setData("text/plain", workItemId);
                }
              }}
              onDragEndWorkItem={() => {
                setDraggedWorkItemId(null);
                setDragOverPhase(null);
              }}
            />
          }
          detailRail={
            <OrchestratorDetailRail
              filteredWorkItemsCount={filteredWorkItems.length}
              navigatorSections={navigatorSections}
              selectedWorkItemId={selectedWorkItemId}
              getPhaseMeta={getPhaseMeta}
              getStatusLabel={(status) => WORK_ITEM_STATUS_META[status].label}
              onSelectWorkItem={selectWorkItem}
              workbenchCanvas={
                <OrchestratorWorkbenchCanvas
                  selectedWorkItem={selectedWorkItem}
                >
                  {selectedWorkItem && (
                    <OrchestratorWorkbenchDetailContent
                      detailTab={detailTab}
                      onDetailTabChange={setDetailTab}
                      headerProps={{
                        selectedWorkItem,
                        phaseLabel: getPhaseMeta(selectedWorkItem.phase).label,
                        phaseTone: getStatusTone(selectedWorkItem.phase),
                        taskTypeLabel: getWorkItemTaskTypeLabel(
                          selectedWorkItem.taskType,
                        ),
                        workItemStatusLabel:
                          WORK_ITEM_STATUS_META[selectedWorkItem.status].label,
                        workItemStatusTone: getStatusTone(
                          selectedWorkItem.status,
                        ),
                        currentRunStatusLabel: currentRun
                          ? RUN_STATUS_META[currentRun.status].label
                          : null,
                        currentRunStatusTone: currentRun
                          ? getStatusTone(currentRun.status)
                          : null,
                        selectedPhaseOwnerTeamName:
                          selectedPhaseOwnerTeam?.name,
                        selectedClaimOwnerName: selectedClaimOwner?.name,
                        selectedPresenceUserNames: selectedPresenceUsers.map(
                          (user) => user.name,
                        ),
                        selectedCanGuideBlockedAgent,
                        showApprovalReviewButton:
                          selectedOpenWait?.type === "APPROVAL",
                        canStartExecution,
                        startExecutionLabel:
                          selectedRunHistory.length > 0
                            ? "Start current phase"
                            : "Start execution",
                        canRestartFromPhase,
                        restartPhaseLabel: `Restart ${getPhaseMeta(selectedWorkItem.phase).label}`,
                        canResetAndRestart,
                        selectedCanTakeControl,
                        currentActorOwnsSelectedWorkItem,
                        canControlWorkItems,
                        currentRunIsActive,
                        busyAction,
                        canReadChat,
                        hasSelectedAgent: Boolean(selectedAgent),
                        onBackToFlowMap: () =>
                          clearSelectedWorkItem({ focusBoard: true }),
                        onExplain: () => setIsExplainOpen(true),
                        onCreateEvidencePacket: () =>
                          void handleCreateEvidencePacket(),
                        canOpenReleasePassport,
                        onOpenReleasePassport: handleOpenReleasePassport,
                        onOpenFullChat: () => void handleOpenFullChat(),
                        onTakeControl: () => setIsStageControlOpen(true),
                        onToggleControl: () =>
                          void (currentActorOwnsSelectedWorkItem
                            ? handleReleaseControl()
                            : handleClaimControl()),
                        onApprovalReviewMouseDown:
                          handleApprovalReviewMouseDown,
                        onOpenApprovalReview: handleOpenApprovalReview,
                        onStartExecution: () => void handleStartExecution(),
                        onRestartExecution: () => void handleRestartExecution(),
                        onResetAndRestart: () => void handleResetAndRestart(),
                        onGuideBlockedAgent: focusGuidanceComposer,
                        onCancelRun: () => void handleCancelRun(),
                        onOpenRestore: () => {
                          setActionError("");
                          setRestoreWorkItemNote("");
                          setIsRestoreWorkItemOpen(true);
                        },
                        onOpenArchive: () => {
                          setActionError("");
                          setArchiveWorkItemNote("");
                          setIsArchiveWorkItemOpen(true);
                        },
                        onOpenCancel: () => {
                          setActionError("");
                          setCancelWorkItemNote("");
                          setIsCancelWorkItemOpen(true);
                        },
                      }}
                      operateProps={{
                        briefing: workspace.briefing,
                        selectedAgentKnowledgeLens,
                        selectedStateSummary,
                        selectedBlockerSummary,
                        selectedNextActionSummary,
                        readinessContract,
                        primaryReadinessGate,
                        selectedTasks,
                        onOpenTaskList: () => navigate("/tasks"),
                        onOpenTask: (taskId) =>
                          navigate(
                            "/tasks?taskId=" + encodeURIComponent(taskId),
                          ),
                        selectedAgent,
                        selectedInteractionFeed,
                        onOpenArtifactFromTimeline:
                          handleOpenArtifactFromTimeline,
                        onOpenRunFromTimeline: (runId) =>
                          void handleOpenRunFromTimeline(runId),
                        onOpenTaskFromTimeline: handleOpenTaskFromTimeline,
                        selectedAttentionReason,
                        selectedAttentionLabel,
                        selectedAttentionRequestedBy,
                        selectedAttentionTimestamp,
                        agentsById,
                        selectedCanGuideBlockedAgent,
                        selectedOpenWait,
                        requestChangesIsAvailable,
                        onGuideAndRestart: () => void handleGuideAndRestart(),
                        canGuideAndRestart,
                        busyAction,
                        actionError,
                        onApprovalReviewMouseDown:
                          handleApprovalReviewMouseDown,
                        onOpenApprovalReview: handleOpenApprovalReview,
                        onResolveWait: () => void handleResolveWait(),
                        canResolveSelectedWait,
                        actionButtonLabel,
                        selectedFailureReason,
                        selectedWorkItem,
                        canRestartWorkItems,
                        onUseBlockerInGuidance: () =>
                          setResolutionNote((current) =>
                            current.trim()
                              ? `${buildBlockedGuidanceSeed(selectedAttentionReason)}${current.trim()}`
                              : buildBlockedGuidanceSeed(
                                  selectedAttentionReason,
                                ),
                          ),
                        resolutionNoteRef,
                        resolutionNote,
                        onResolutionNoteChange: setResolutionNote,
                        resolutionPlaceholder,
                        guidanceSuggestions,
                        onAppendGuidanceSuggestion: (suggestion) =>
                          setResolutionNote((current) =>
                            current.trim()
                              ? `${current.trim()}\n- ${suggestion}`
                              : `- ${suggestion}`,
                          ),
                        resolutionIsRequired,
                        selectedWorkflow,
                        selectedCurrentStep,
                        currentRun,
                        currentRunStatusLabel: currentRun
                          ? `Started ${formatTimestamp(currentRun.startedAt || currentRun.createdAt)}`
                          : null,
                        selectedSharedBranch,
                        selectedExecutionRepository,
                        selectedEffectiveExecutionContext,
                        selectedActiveWriterLabel:
                          selectedActiveWriter?.name ||
                          selectedEffectiveExecutionContext?.activeWriterUserId ||
                          "No one has claimed write control",
                        onInitializeExecutionContext: () =>
                          void handleInitializeExecutionContext(),
                        canInitializeExecutionContext,
                        onCreateSharedBranch: () =>
                          void handleCreateSharedBranch(),
                        canCreateSharedBranch,
                        currentActorOwnsWriteControl,
                        onToggleWriteControl: () =>
                          void (currentActorOwnsWriteControl
                            ? handleReleaseWriteControl()
                            : handleClaimWriteControl()),
                        canControlWorkItems,
                        latestSelectedHandoff,
                        onCreateHandoff: () => void handleCreateHandoff(),
                        onAcceptLatestHandoff: () =>
                          void handleAcceptLatestHandoff(),
                        selectedCompiledStepContext,
                        workspaceTeamsById,
                        renderStructuredInputs,
                        renderArtifactChecklist,
                        renderAgentArtifactExpectations,
                        selectedCompiledWorkItemPlan,
                        selectedArtifacts,
                        selectedArtifact,
                        onOpenArtifactsTab: () => setDetailTab("artifacts"),
                        onSelectArtifactAndOpen: (artifactId) => {
                          setSelectedArtifactId(artifactId);
                          setDetailTab("artifacts");
                        },
                        selectedCurrentPhaseStakeholders,
                        selectedPhaseStakeholderAssignments,
                        getLifecyclePhaseLabelForPhase: (phase) =>
                          getLifecyclePhaseLabel(activeCapability, phase),
                        formatPhaseStakeholderLine:
                          formatWorkItemPhaseStakeholderLine,
                        selectedWorkItemTaskTypeLabel: getWorkItemTaskTypeLabel(
                          selectedWorkItem.taskType,
                        ),
                        selectedWorkItemTaskTypeDescription:
                          getWorkItemTaskTypeDescription(
                            selectedWorkItem.taskType,
                          ),
                        runtimeReady,
                        runtimeError,
                        selectedRequestedInputFields,
                        focusGuidanceComposer,
                        onOpenExecutionPolicyConfig: () =>
                          navigate("/operations#desktop-workspaces"),
                        hasMissingWorkspaceInput,
                        waitRequiresApprovedWorkspace,
                        hasApprovedWorkspaceConfigured,
                        approvedWorkspaceRoots,
                        approvedWorkspaceDraft,
                        onApprovedWorkspaceDraftChange: (value) => {
                          setApprovedWorkspaceDraft(value);
                          setApprovedWorkspaceValidation(null);
                        },
                        onApproveWorkspacePath: (options) =>
                          void handleApproveWorkspacePath(options),
                        activeCapabilityLocalDirectories:
                          activeCapability.localDirectories,
                        approvedWorkspaceValidation,
                        canEditCapability,
                        selectedCodeDiffArtifactId,
                        selectedCodeDiffArtifact,
                        selectedCodeDiffRepositoryCount,
                        selectedCodeDiffTouchedFileCount,
                        onOpenDiffReview: () => setIsDiffReviewOpen(true),
                        selectedContrarianReviewTone,
                        selectedContrarianReview,
                        selectedContrarianReviewIsReady,
                        renderReviewList,
                        selectedCanTakeControl,
                        onOpenStageControl: () => setIsStageControlOpen(true),
                        stageChatSuggestedPrompts,
                        onSelectStageChatPrompt: (prompt) =>
                          setStageChatInput(prompt),
                        stageChatThreadRef,
                        onStageChatScroll: handleStageChatScroll,
                        selectedStageChatMessages,
                        stageChatDraft,
                        isStageChatSending,
                        stageChatError,
                        onOpenFullChat: handleOpenFullChat,
                        stageChatInput,
                        onStageChatInputChange: setStageChatInput,
                        onStageChatSend: handleStageChatSend,
                        canWriteChat,
                        selectedResetStep,
                        selectedResetPhase,
                        selectedResetAgentName:
                          selectedResetAgent?.name ||
                          selectedResetStep?.agentId ||
                          null,
                        getPhaseMeta,
                      }}
                      artifactsProps={{
                        filteredArtifacts,
                        artifactFilter,
                        onArtifactFilterChange: setArtifactFilter,
                        selectedArtifact,
                        latestArtifactDocument,
                        onSelectArtifact: setSelectedArtifactId,
                        selectedTasks,
                        selectedLogs,
                        onOpenRunConsole: () => navigate("/run-console"),
                        onOpenLedger: () => navigate("/ledger"),
                        onOpenWorkflowDesigner: () => navigate("/designer"),
                      }}
                      attemptsProps={{
                        capabilityId: activeCapability.id,
                        currentRun,
                        selectedOpenWait,
                        previousRunSummary: previousRunSummary?.id || null,
                        attemptComparisonLines,
                        selectedWorkflow,
                        selectedRunSteps,
                        getPhaseMeta,
                        selectedRunEvents,
                        selectedRunDetail,
                        selectedRunHistory,
                        recentRunActivity,
                        agentsById,
                        getRunEventTone,
                        getRunEventLabel,
                        liveStreamingText,
                        recentlyChangedFiles,
                      }}
                      receiptsProps={{
                        selectedRunEvents,
                        capabilityId: activeCapability.id,
                        runId: currentRun?.id ?? null,
                      }}
                      failureRecoveryProps={{
                        selectedWorkItem,
                        currentRun,
                        selectedFailureReason,
                        selectedCurrentStep,
                        failedRunStep: selectedRunStep,
                        busyAction,
                        canRestartFromPhase,
                        restartPhaseLabel: `Restart ${getPhaseMeta(selectedWorkItem.phase).label}`,
                        canResetAndRestart,
                        selectedCanGuideBlockedAgent,
                        currentRunIsActive,
                        onRestartExecution: () => void handleRestartExecution(),
                        onResetAndRestart: () => void handleResetAndRestart(),
                        onGuideBlockedAgent: focusGuidanceComposer,
                        onCancelRun: () => void handleCancelRun(),
                      }}
                      segmentsPanel={
                        <OrchestratorSegmentsSection
                          capability={activeCapability}
                          workItemId={selectedWorkItem.id}
                          workItemBrief={selectedWorkItem.brief}
                          canEdit={canControlWorkItems}
                          onAfterRetry={() => {
                            void refreshSelection(selectedWorkItem.id);
                          }}
                        />
                      }
                    />
                  )}
                </OrchestratorWorkbenchCanvas>
              }
            />
          }
        />
      }
      overlays={
        <OrchestratorSharedOverlays
          approvalReviewModal={approvalReviewModalNode}
          diffReviewModal={diffReviewModalNode}
          quickCreateSheet={
            <OrchestratorBoardQuickCreateSheet
              isOpen={isCreateSheetOpen}
              workflows={workspace.workflows.map((workflow) => ({
                id: workflow.id,
                name: workflow.name,
              }))}
              draftWorkItem={{
                title: draftWorkItem.title,
                workflowId: draftWorkItem.workflowId,
                taskType: draftWorkItem.taskType,
                priority: draftWorkItem.priority,
                description: draftWorkItem.description,
                attachments: draftWorkItem.attachments,
                tags: draftWorkItem.tags,
              }}
              launchSummary={draftLaunchSummary}
              visibleLifecyclePhases={visibleLifecyclePhases}
              capabilityStakeholdersCount={activeCapability.stakeholders.length}
              busyAction={busyAction}
              canCreateWorkItems={canCreateWorkItems}
              getDraftPhaseStakeholders={getDraftPhaseStakeholders}
              onClose={() => setIsCreateSheetOpen(false)}
              onSubmit={handleCreateWorkItem}
              onTitleChange={(value) =>
                setDraftWorkItem((prev) => ({ ...prev, title: value }))
              }
              onWorkflowChange={(value) =>
                setDraftWorkItem((prev) => ({ ...prev, workflowId: value }))
              }
              onTaskTypeChange={(value) =>
                setDraftWorkItem((prev) => ({ ...prev, taskType: value }))
              }
              onPriorityChange={(value) =>
                setDraftWorkItem((prev) => ({ ...prev, priority: value }))
              }
              onDescriptionChange={(value) =>
                setDraftWorkItem((prev) => ({ ...prev, description: value }))
              }
              onTagsChange={(value) =>
                setDraftWorkItem((prev) => ({ ...prev, tags: value }))
              }
              onApplyCapabilityStakeholdersToPhase={
                applyCapabilityStakeholdersToPhase
              }
              onAddDraftPhaseStakeholder={addDraftPhaseStakeholder}
              onUpdateDraftPhaseStakeholderField={
                updateDraftPhaseStakeholderField
              }
              onRemoveDraftPhaseStakeholder={removeDraftPhaseStakeholder}
              onUploadAttachments={(files) => {
                void handleDraftAttachmentUpload(files);
              }}
              onRemoveAttachment={removeDraftAttachment}
              renderAttachmentIcon={renderAttachmentIcon}
              formatAttachmentSizeLabel={formatAttachmentSizeLabel}
            />
          }
          quickActionDialogs={quickActionDialogsNode}
          stageControl={stageControlOverlayNode}
          explainDrawer={explainDrawerOverlayNode}
        />
      }
    />
  );
};

export default Orchestrator;
