import React from "react";
import { motion } from "motion/react";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Lock,
  MessageSquare,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  User,
  Workflow as WorkflowIcon,
} from "lucide-react";
import AgentGitSessionCard from "./AgentGitSessionCard";
import ErrorBoundary from "../ErrorBoundary";
import InteractionTimeline from "../InteractionTimeline";
import MarkdownContent from "../MarkdownContent";
import {
  CopilotMessageBody,
  CopilotThinkingIndicator,
} from "./OrchestratorCopilotTranscript";
import { formatEnumLabel, getStatusTone } from "../../lib/enterprise";
import { compactMarkdownPreview } from "../../lib/markdown";
import { cn } from "../../lib/utils";
import { StatusBadge } from "../EnterpriseUI";
import type {
  AgentArtifactExpectation,
  AgentTask,
  Artifact,
  CapabilityAgent,
  CapabilityInteractionFeed,
  CapabilityRepository,
  CapabilityStakeholder,
  CompiledArtifactChecklistItem,
  CompiledRequiredInputField,
  CompiledStepContext,
  CompiledWorkItemPlan,
  ContrarianConflictReview,
  ExecutionLog,
  ReadinessContract,
  ReadinessGate,
  RunWait,
  WorkItem,
  WorkItemBranch,
  WorkItemExecutionContext,
  WorkItemHandoffPacket,
  WorkItemPhase,
  WorkItemPhaseStakeholderAssignment,
  WorkspacePathValidationResult,
  Workflow,
  WorkflowRun,
} from "../../types";
import {
  type StageChatMessage,
  formatTimestamp,
  normalizeMarkdownishText,
} from "../../lib/orchestrator/support";

type Tone = React.ComponentProps<typeof StatusBadge>["tone"];

type Props = {
  selectedStateSummary: string;
  selectedBlockerSummary: string;
  selectedNextActionSummary: string;
  readinessContract: ReadinessContract;
  primaryReadinessGate: ReadinessGate | null;
  selectedTasks: AgentTask[];
  onOpenTaskList: () => void;
  onOpenTask: (taskId: string) => void;
  selectedAgent: CapabilityAgent | null;
  selectedInteractionFeed: CapabilityInteractionFeed;
  onOpenArtifactFromTimeline: (artifactId: string) => void;
  onOpenRunFromTimeline: (runId: string) => void;
  onOpenTaskFromTimeline: (taskId: string) => void;
  selectedAttentionReason: string;
  selectedAttentionLabel: string;
  selectedAttentionRequestedBy?: string;
  selectedAttentionTimestamp?: string;
  agentsById: Map<string, CapabilityAgent>;
  selectedCanGuideBlockedAgent: boolean;
  selectedOpenWait: RunWait | null;
  requestChangesIsAvailable: boolean;
  onGuideAndRestart: () => void;
  canGuideAndRestart: boolean;
  busyAction: string | null;
  actionError: string;
  onApprovalReviewMouseDown: React.MouseEventHandler<HTMLButtonElement>;
  onOpenApprovalReview: () => void;
  onResolveWait: () => void;
  onDelegateToHuman?: () => void;
  canDelegateToHuman?: boolean;
  canResolveSelectedWait: boolean;
  actionButtonLabel: string;
  selectedFailureReason: string;
  selectedWorkItem: WorkItem;
  canRestartWorkItems: boolean;
  onUseBlockerInGuidance: () => void;
  resolutionNoteRef: React.RefObject<HTMLTextAreaElement | null>;
  resolutionNote: string;
  onResolutionNoteChange: (value: string) => void;
  resolutionPlaceholder: string;
  guidanceSuggestions: string[];
  onAppendGuidanceSuggestion: (suggestion: string) => void;
  resolutionIsRequired: boolean;
  selectedWorkflow: Workflow | null;
  selectedCurrentStep: Workflow["steps"][number] | null;
  currentRun: WorkflowRun | null;
  currentRunStatusLabel: string | null;
  selectedSharedBranch: WorkItemBranch | null;
  selectedExecutionRepository: CapabilityRepository | null;
  selectedEffectiveExecutionContext: WorkItemExecutionContext | null;
  selectedActiveWriterLabel: string;
  onInitializeExecutionContext: () => void;
  canInitializeExecutionContext: boolean;
  onCreateSharedBranch: () => void;
  canCreateSharedBranch: boolean;
  currentActorOwnsWriteControl: boolean;
  onToggleWriteControl: () => void;
  canControlWorkItems: boolean;
  latestSelectedHandoff: WorkItemHandoffPacket | null;
  onCreateHandoff: () => void;
  onAcceptLatestHandoff: () => void;
  selectedCompiledStepContext: CompiledStepContext | null;
  workspaceTeamsById: Map<string, { name: string }>;
  renderStructuredInputs: (
    items: CompiledRequiredInputField[],
    emptyLabel: string,
  ) => React.ReactNode;
  renderArtifactChecklist: (
    items: CompiledArtifactChecklistItem[],
  ) => React.ReactNode;
  renderAgentArtifactExpectations: (
    items: AgentArtifactExpectation[],
    emptyLabel: string,
    tone: "neutral" | "brand",
  ) => React.ReactNode;
  selectedCompiledWorkItemPlan: CompiledWorkItemPlan | null;
  selectedArtifacts: Artifact[];
  selectedArtifact: Artifact | null;
  onOpenArtifactsTab: () => void;
  onSelectArtifactAndOpen: (artifactId: string) => void;
  selectedCurrentPhaseStakeholders: CapabilityStakeholder[];
  selectedPhaseStakeholderAssignments: WorkItemPhaseStakeholderAssignment[];
  getLifecyclePhaseLabelForPhase: (phase: WorkItemPhase) => string;
  formatPhaseStakeholderLine: (stakeholder: CapabilityStakeholder) => string;
  selectedWorkItemTaskTypeLabel: string;
  selectedWorkItemTaskTypeDescription: string;
  runtimeReady: boolean;
  runtimeError: string;
  selectedRequestedInputFields: CompiledRequiredInputField[];
  focusGuidanceComposer: () => void;
  onOpenExecutionPolicyConfig: () => void;
  hasMissingWorkspaceInput: boolean;
  waitRequiresApprovedWorkspace: boolean;
  hasApprovedWorkspaceConfigured: boolean;
  approvedWorkspaceRoots: string[];
  approvedWorkspaceDraft: string;
  onApprovedWorkspaceDraftChange: (value: string) => void;
  onApproveWorkspacePath: (options?: { unblock?: boolean }) => void;
  activeCapabilityLocalDirectories: string[];
  approvedWorkspaceValidation: WorkspacePathValidationResult | null;
  canEditCapability: boolean;
  selectedCodeDiffArtifactId?: string;
  selectedCodeDiffArtifact: Artifact | null;
  selectedCodeDiffRepositoryCount: number;
  selectedCodeDiffTouchedFileCount: number;
  onOpenDiffReview: () => void;
  selectedContrarianReviewTone: Tone;
  selectedContrarianReview: ContrarianConflictReview | null;
  selectedContrarianReviewIsReady: boolean;
  renderReviewList: (items: string[], emptyLabel: string) => React.ReactNode;
  selectedCanTakeControl: boolean;
  onOpenStageControl: () => void;
  onOpenStageOwnership: () => void;
  stageChatSuggestedPrompts: string[];
  onSelectStageChatPrompt: (prompt: string) => void;
  stageChatThreadRef: React.RefObject<HTMLDivElement | null>;
  onStageChatScroll: React.UIEventHandler<HTMLDivElement>;
  selectedStageChatMessages: StageChatMessage[];
  stageChatDraft: string;
  isStageChatSending: boolean;
  stageChatError: string;
  onOpenFullChat: () => void;
  stageChatInput: string;
  onStageChatInputChange: (value: string) => void;
  onStageChatSend: React.FormEventHandler<HTMLFormElement>;
  canWriteChat: boolean;
  selectedResetStep: Workflow["steps"][number] | null;
  selectedResetPhase: WorkItemPhase;
  selectedResetAgentName: string | null;
  getPhaseMeta: (phase: WorkItemPhase) => { label: string };
};

export const OrchestratorOperatePanel = ({
  selectedStateSummary,
  selectedBlockerSummary,
  selectedNextActionSummary,
  readinessContract,
  primaryReadinessGate,
  selectedTasks,
  onOpenTaskList,
  onOpenTask,
  selectedAgent,
  selectedInteractionFeed,
  onOpenArtifactFromTimeline,
  onOpenRunFromTimeline,
  onOpenTaskFromTimeline,
  selectedAttentionReason,
  selectedAttentionLabel,
  selectedAttentionRequestedBy,
  selectedAttentionTimestamp,
  agentsById,
  selectedCanGuideBlockedAgent,
  selectedOpenWait,
  requestChangesIsAvailable,
  onGuideAndRestart,
  canGuideAndRestart,
  busyAction,
  actionError,
  onApprovalReviewMouseDown,
  onOpenApprovalReview,
  onResolveWait,
  onDelegateToHuman,
  canDelegateToHuman = false,
  canResolveSelectedWait,
  actionButtonLabel,
  selectedFailureReason,
  selectedWorkItem,
  canRestartWorkItems,
  onUseBlockerInGuidance,
  resolutionNoteRef,
  resolutionNote,
  onResolutionNoteChange,
  resolutionPlaceholder,
  guidanceSuggestions,
  onAppendGuidanceSuggestion,
  resolutionIsRequired,
  selectedWorkflow,
  selectedCurrentStep,
  currentRun,
  currentRunStatusLabel,
  selectedSharedBranch,
  selectedExecutionRepository,
  selectedEffectiveExecutionContext,
  selectedActiveWriterLabel,
  onInitializeExecutionContext,
  canInitializeExecutionContext,
  onCreateSharedBranch,
  canCreateSharedBranch,
  currentActorOwnsWriteControl,
  onToggleWriteControl,
  canControlWorkItems,
  latestSelectedHandoff,
  onCreateHandoff,
  onAcceptLatestHandoff,
  selectedCompiledStepContext,
  workspaceTeamsById,
  renderStructuredInputs,
  renderArtifactChecklist,
  renderAgentArtifactExpectations,
  selectedCompiledWorkItemPlan,
  selectedArtifacts,
  selectedArtifact,
  onOpenArtifactsTab,
  onSelectArtifactAndOpen,
  selectedCurrentPhaseStakeholders,
  selectedPhaseStakeholderAssignments,
  getLifecyclePhaseLabelForPhase,
  formatPhaseStakeholderLine,
  selectedWorkItemTaskTypeLabel,
  selectedWorkItemTaskTypeDescription,
  runtimeReady,
  runtimeError,
  selectedRequestedInputFields,
  focusGuidanceComposer,
  onOpenExecutionPolicyConfig,
  hasMissingWorkspaceInput,
  waitRequiresApprovedWorkspace,
  hasApprovedWorkspaceConfigured,
  approvedWorkspaceRoots,
  approvedWorkspaceDraft,
  onApprovedWorkspaceDraftChange,
  onApproveWorkspacePath,
  activeCapabilityLocalDirectories,
  approvedWorkspaceValidation,
  canEditCapability,
  selectedCodeDiffArtifactId,
  selectedCodeDiffArtifact,
  selectedCodeDiffRepositoryCount,
  selectedCodeDiffTouchedFileCount,
  onOpenDiffReview,
  selectedContrarianReviewTone,
  selectedContrarianReview,
  selectedContrarianReviewIsReady,
  renderReviewList,
  selectedCanTakeControl,
  onOpenStageControl,
  onOpenStageOwnership,
  stageChatSuggestedPrompts,
  onSelectStageChatPrompt,
  stageChatThreadRef,
  onStageChatScroll,
  selectedStageChatMessages,
  stageChatDraft,
  isStageChatSending,
  stageChatError,
  onOpenFullChat,
  stageChatInput,
  onStageChatInputChange,
  onStageChatSend,
  canWriteChat,
  selectedResetStep,
  selectedResetPhase,
  selectedResetAgentName,
  getPhaseMeta,
}: Props) => (
  <>
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">What is happening</p>
          <p className="mt-2 text-sm leading-relaxed text-on-surface">
            {selectedStateSummary}
          </p>
        </div>
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">What is blocked</p>
          <p className="mt-2 text-sm leading-relaxed text-on-surface">
            {selectedBlockerSummary}
          </p>
        </div>
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">What is next</p>
          <p className="mt-2 text-sm leading-relaxed text-on-surface">
            {selectedNextActionSummary}
          </p>
        </div>
      </div>

      {/* ── Operator Quick Actions ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-secondary">
            {selectedCurrentStep?.phase ?? "Stage"}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-on-surface">
            {selectedCurrentStep?.name ?? "Awaiting orchestration"}
            {selectedAgent ? (
              <span className="ml-2 font-normal text-secondary">
                · {selectedAgent.name}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleWriteControl}
            disabled={busyAction !== null || !canControlWorkItems}
            className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyAction === "claimWriteControl" ||
            busyAction === "releaseWriteControl" ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Lock size={14} />
            )}
            {currentActorOwnsWriteControl ? "Release lock" : "Claim lock"}
          </button>

          <button
            type="button"
            onClick={onOpenFullChat}
            disabled={!selectedAgent}
            className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageSquare size={14} />
            Chat
          </button>

          <button
            type="button"
            onClick={onOpenStageControl}
            disabled={!selectedCanTakeControl}
            className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageSquareText size={14} />
            Take control
          </button>

          <button
            type="button"
            onClick={onOpenStageOwnership}
            disabled={!selectedWorkflow}
            className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <User size={14} />
            Stage owner & uploads
          </button>

          {selectedOpenWait?.type === "APPROVAL" ? (
            <button
              type="button"
              onMouseDown={onApprovalReviewMouseDown}
              onClick={onOpenApprovalReview}
              className="enterprise-button enterprise-button-primary"
            >
              <ShieldCheck size={14} />
              Approve
            </button>
          ) : null}

          {selectedCanGuideBlockedAgent && !selectedOpenWait ? (
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById("orchestrator-guidance")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="enterprise-button enterprise-button-secondary"
            >
              <ArrowRight size={14} />
              Guide agent ↓
            </button>
          ) : null}

          {canDelegateToHuman && !selectedOpenWait && onDelegateToHuman ? (
            <button
              type="button"
              onClick={onDelegateToHuman}
              disabled={busyAction !== null}
              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === "delegateToHuman" ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <User size={14} />
              )}
              Delegate to human
            </button>
          ) : null}
        </div>
      </div>
      {/* ─────────────────────────────────────────────────────────────────── */}

      {/* Direct agent chat — surfaced at the top for quick operator access */}
      <ErrorBoundary
        resetKey={`${selectedWorkItem.id}:${selectedAgent?.id || "none"}:${selectedCurrentStep?.id || "stage"}`}
        title="Direct agent chat could not render"
        description="The inline stage chat hit an unexpected UI problem. The rest of the workbench stays available, and you can still use Full Chat or Take control while we keep this route stable."
      >
        <div className="workspace-meta-card orchestrator-stage-chat-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Direct agent chat</p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {selectedAgent
                  ? `Ask ${selectedAgent.name} what it's working on, clarify blockers, or steer the next attempt.`
                  : "Chat with the stage agent to get more context or guide the next attempt."}
              </p>
            </div>
          </div>

          {!runtimeReady ? (
            <p className="mt-4 text-sm leading-relaxed text-secondary">
              Agent chat will unlock once the runtime connection is ready.
            </p>
          ) : !selectedAgent ? (
            <p className="mt-4 text-sm leading-relaxed text-secondary">
              This step does not have an assigned agent to chat with yet.
            </p>
          ) : (
            <>
              {stageChatSuggestedPrompts.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {stageChatSuggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => onSelectStageChatPrompt(prompt)}
                      className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-primary/20 hover:text-primary"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}

              <div
                ref={stageChatThreadRef}
                className="orchestrator-stage-chat-thread"
                onScroll={onStageChatScroll}
              >
                {selectedStageChatMessages.length === 0 &&
                !stageChatDraft &&
                !isStageChatSending ? (
                  <div className="orchestrator-stage-chat-empty">
                    Ask <strong>{selectedAgent.name}</strong> what is happening
                    in{" "}
                    <strong>{selectedCurrentStep?.name || "this stage"}</strong>
                    , what it needs, or which files and artifacts it plans to
                    change.
                  </div>
                ) : (
                  <>
                    {selectedStageChatMessages.map((message) => (
                      <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className={cn(
                          "orchestrator-stage-chat-message",
                          message.role === "user"
                            ? "orchestrator-stage-chat-message-user"
                            : "orchestrator-stage-chat-message-agent",
                        )}
                      >
                        <div className="orchestrator-stage-chat-message-meta">
                          <span className="inline-flex items-center gap-2">
                            {message.role === "user" ? (
                              <User size={14} />
                            ) : (
                              <Bot size={14} />
                            )}
                            {message.role === "user"
                              ? "You"
                              : selectedAgent.name}
                          </span>
                          <span>{message.timestamp}</span>
                        </div>
                        <CopilotMessageBody
                          content={message.content}
                          tone={message.role === "user" ? "user" : "agent"}
                        />
                        {message.deliveryState &&
                        message.deliveryState !== "clean" ? (
                          <p className="mt-2 text-xs text-secondary">
                            {message.deliveryState === "recovered"
                              ? "Recovered draft"
                              : "Partial response"}
                            {message.error ? ` · ${message.error}` : ""}
                          </p>
                        ) : null}
                      </motion.div>
                    ))}
                    {stageChatDraft ? (
                      <motion.div
                        key="stage-chat-draft"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="orchestrator-stage-chat-message orchestrator-stage-chat-message-agent"
                      >
                        <div className="orchestrator-stage-chat-message-meta">
                          <span className="inline-flex items-center gap-2">
                            <Bot size={14} />
                            {selectedAgent.name}
                          </span>
                          <CopilotThinkingIndicator label="Typing" />
                        </div>
                        <CopilotMessageBody
                          content={stageChatDraft}
                          tone="draft"
                          isStreaming
                        />
                      </motion.div>
                    ) : isStageChatSending ? (
                      <motion.div
                        key="stage-chat-thinking"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="orchestrator-stage-chat-message orchestrator-stage-chat-message-agent orchestrator-stage-chat-message-thinking"
                      >
                        <div className="orchestrator-stage-chat-message-meta">
                          <span className="inline-flex items-center gap-2">
                            <Bot size={14} />
                            {selectedAgent.name}
                          </span>
                          <span>Just now</span>
                        </div>
                        <div className="mt-3">
                          <CopilotThinkingIndicator label="Thinking" />
                        </div>
                      </motion.div>
                    ) : null}
                  </>
                )}
              </div>

              {stageChatError ? (
                <div className="mt-4 rounded-2xl border border-red-200/70 bg-red-50/70 px-4 py-3 text-sm text-red-900">
                  {stageChatError}
                </div>
              ) : null}

              <form onSubmit={onStageChatSend} className="mt-4 space-y-3">
                <textarea
                  value={stageChatInput}
                  onChange={(event) =>
                    onStageChatInputChange(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      event.currentTarget.closest("form")?.requestSubmit();
                    }
                  }}
                  placeholder={`Ask ${selectedAgent.name} about this stage, blockers, files, artifacts, or next steps.`}
                  className="field-textarea h-28 bg-white"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs leading-relaxed text-secondary">
                    Scoped to <strong>{selectedWorkItem.id}</strong> and{" "}
                    <strong>
                      {selectedCurrentStep?.name || "the active stage"}
                    </strong>
                    . <span className="opacity-60">⌘↵ to send.</span>
                  </p>
                  <button
                    type="submit"
                    disabled={
                      !stageChatInput.trim() ||
                      isStageChatSending ||
                      !canWriteChat
                    }
                    title={
                      !canWriteChat
                        ? "Chat is read-only — take control to send messages."
                        : undefined
                    }
                    className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isStageChatSending ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <Send size={16} />
                    )}
                    Send to agent
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </ErrorBoundary>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="workspace-meta-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Readiness contract</p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                Starts and restarts are now gated by six hard readiness checks.
              </p>
            </div>
            <StatusBadge
              tone={readinessContract.allReady ? "success" : "warning"}
            >
              {readinessContract.allReady
                ? "Ready to start"
                : "Execution gated"}
            </StatusBadge>
          </div>
          <p className="mt-3 text-sm font-semibold text-on-surface">
            {readinessContract.summary}
          </p>
          {primaryReadinessGate ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-800">
                Blocking gate
              </p>
              <p className="mt-2 text-sm font-semibold text-amber-950">
                {primaryReadinessGate.label}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-amber-800">
                {primaryReadinessGate.blockingReason ||
                  primaryReadinessGate.nextRequiredAction ||
                  primaryReadinessGate.summary}
              </p>
            </div>
          ) : null}
        </div>

        <div className="workspace-meta-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Task projection</p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                Lower-level workflow task records stay visible here so you can
                keep operating from Work.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenTaskList}
              className="enterprise-button enterprise-button-secondary"
            >
              Open tasks
            </button>
          </div>
          {selectedTasks.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-secondary">
              No workflow-managed tasks are linked to this work item yet.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {selectedTasks.slice(0, 3).map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="w-full rounded-2xl border border-outline-variant/25 bg-white px-4 py-3 text-left transition hover:border-primary/20 hover:bg-primary/5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-on-surface">
                      {task.title}
                    </p>
                    <StatusBadge tone={getStatusTone(task.status)}>
                      {task.status}
                    </StatusBadge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    {task.workflowStepId || "Workflow task"} • {task.agent}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedAgent ? (
        <div className="grid gap-3 xl:grid-cols-3">
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Tool policy</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {selectedAgent.rolePolicy?.summary || "Use approved tools only."}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              {(
                selectedAgent.rolePolicy?.allowedToolIds ||
                selectedAgent.preferredToolIds ||
                []
              )
                .slice(0, 4)
                .join(", ") || "No preferred tools recorded"}
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Memory scope</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {selectedAgent.memoryScope?.summary ||
                "Capability context and current work state."}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              {selectedAgent.memoryScope?.scopeLabels.join(" • ") ||
                "Capability briefing • Work item context"}
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Quality bar</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {selectedAgent.qualityBar?.label || "Execution quality"}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              {selectedAgent.evalProfile?.summary ||
                selectedAgent.qualityBar?.summary ||
                "The specialist should leave usable evidence and clear next steps."}
            </p>
          </div>
        </div>
      ) : null}

      <InteractionTimeline
        feed={selectedInteractionFeed}
        maxItems={12}
        title="Attempt story"
        emptyMessage="This work item has not produced a linked interaction story yet."
        onOpenArtifact={onOpenArtifactFromTimeline}
        onOpenRun={(runId) => onOpenRunFromTimeline(runId)}
        onOpenTask={onOpenTaskFromTimeline}
      />

      {selectedAttentionReason && (
        <div className="workspace-inline-alert workspace-inline-alert-warning">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em]">
              {selectedAttentionLabel}
            </p>
            <p className="mt-2 text-sm font-semibold leading-relaxed">
              {selectedAttentionReason}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>
                Requested by:{" "}
                <strong>
                  {agentsById.get(selectedAttentionRequestedBy || "")?.name ||
                    selectedAttentionRequestedBy ||
                    "System"}
                </strong>
              </span>
              <span>
                Since:{" "}
                <strong>{formatTimestamp(selectedAttentionTimestamp)}</strong>
              </span>
            </div>
          </div>
        </div>
      )}

      {(selectedCanGuideBlockedAgent ||
        selectedOpenWait ||
        requestChangesIsAvailable) && (
        <div
          id="orchestrator-guidance"
          className="workspace-meta-card border-outline-variant/30 bg-white/90"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Agent guidance</p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {selectedOpenWait
                  ? "Use this note to guide the agent before the run continues. Approval, human input, and conflict decisions all carry this guidance forward."
                  : selectedCanGuideBlockedAgent
                    ? "The item is blocked. Add what changed and how the agent should retry, then restart from the current phase."
                    : "Use this note field for approvals, human input, restart notes, or cancellation reasons."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedCanGuideBlockedAgent ? (
                <button
                  type="button"
                  onClick={onGuideAndRestart}
                  disabled={!canGuideAndRestart || busyAction !== null}
                  title={
                    !canGuideAndRestart
                      ? "Add operator guidance to the note field above, then use this button to restart."
                      : undefined
                  }
                  className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === "guideRestart" ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                  Guide agent and restart
                </button>
              ) : null}
              {selectedOpenWait?.type === "APPROVAL" ? (
                <button
                  type="button"
                  onMouseDown={onApprovalReviewMouseDown}
                  onClick={onOpenApprovalReview}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <ShieldCheck size={16} />
                  Open approval review
                </button>
              ) : null}
              {canDelegateToHuman && !selectedOpenWait && onDelegateToHuman ? (
                <button
                  type="button"
                  onClick={onDelegateToHuman}
                  disabled={busyAction !== null}
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === "delegateToHuman" ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <User size={16} />
                  )}
                  Delegate to human
                </button>
              ) : null}
              {selectedOpenWait && selectedOpenWait.type !== "APPROVAL" ? (
                <button
                  type="button"
                  onClick={onResolveWait}
                  disabled={!canResolveSelectedWait || busyAction !== null}
                  title={
                    !canResolveSelectedWait
                      ? "Complete the required note field above to resolve this wait state."
                      : undefined
                  }
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === "resolve" ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  {actionButtonLabel}
                </button>
              ) : null}
            </div>
          </div>
          {selectedFailureReason &&
          selectedWorkItem.status === "BLOCKED" &&
          !selectedOpenWait ? (
            <div className="mt-3 rounded-2xl border border-red-200/80 bg-red-50/60 px-4 py-3">
              <p className="workspace-meta-label">Latest failure from engine</p>
              <p className="mt-2 text-sm leading-relaxed text-on-surface">
                {selectedFailureReason}
              </p>
            </div>
          ) : null}
          {selectedCanGuideBlockedAgent && selectedAttentionReason && (
            <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/60 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="workspace-meta-label">
                    Current blocker from agent
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-on-surface">
                    {selectedAttentionReason}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onUseBlockerInGuidance}
                  disabled={!canRestartWorkItems}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <ArrowRight size={14} />
                  Use blocker in guidance
                </button>
              </div>
            </div>
          )}
          <textarea
            ref={resolutionNoteRef}
            value={resolutionNote}
            onChange={(event) => onResolutionNoteChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                if (canGuideAndRestart && busyAction === null)
                  onGuideAndRestart();
                else if (canResolveSelectedWait && busyAction === null)
                  onResolveWait();
              }
            }}
            placeholder={resolutionPlaceholder}
            className="field-textarea mt-3 h-28 bg-white"
          />
          {guidanceSuggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {guidanceSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onAppendGuidanceSuggestion(suggestion)}
                  className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1.5 text-xs font-medium text-secondary transition-colors hover:border-primary/20 hover:text-primary"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          {requestChangesIsAvailable && (
            <p className="mt-2 text-xs text-secondary">
              Review notes entered here also carry into the approval review
              window.
            </p>
          )}
          {selectedCanGuideBlockedAgent && !resolutionNote.trim() && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              Add operator guidance above before restarting the blocked work
              item.
            </p>
          )}
          {resolutionIsRequired &&
            !resolutionNote.trim() &&
            selectedOpenWait && (
              <p className="mt-2 text-xs font-medium text-amber-700">
                Add the missing detail above to unblock this work item and
                continue execution.
              </p>
            )}
          {requestChangesIsAvailable && !resolutionNote.trim() && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              Requesting changes requires review notes.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">Workflow</p>
          <p className="workspace-meta-value">
            {selectedWorkflow?.name || "Workflow missing"}
          </p>
          <p className="mt-1 text-xs text-secondary">
            {selectedWorkflow?.steps.length || 0} steps staged across SDLC lanes
          </p>
        </div>
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">Current Step</p>
          <p className="workspace-meta-value">
            {selectedCurrentStep?.name || "Awaiting orchestration"}
          </p>
          <p className="mt-1 text-xs text-secondary">
            {selectedCurrentStep?.stepType
              ? formatEnumLabel(selectedCurrentStep.stepType)
              : "Not assigned yet"}
          </p>
        </div>
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">Active Agent</p>
          <p className="workspace-meta-value">
            {selectedAgent?.name || "Unassigned"}
          </p>
          <p className="mt-1 text-xs text-secondary">
            {selectedAgent?.role ||
              "No agent has been activated for this step yet."}
          </p>
        </div>
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">Current Run</p>
          <p className="workspace-meta-value">
            {currentRun
              ? `Attempt ${currentRun.attemptNumber}`
              : "No run started yet"}
          </p>
          <p className="mt-1 text-xs text-secondary">
            {currentRunStatusLabel ||
              "Stage the item and start execution to create a durable run."}
          </p>
        </div>
      </div>

      <div className="workspace-meta-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Shared branch collaboration</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {selectedSharedBranch?.sharedBranch ||
                "No shared branch has been prepared for this work item yet."}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              {selectedExecutionRepository
                ? `${selectedExecutionRepository.label} · base ${
                    selectedSharedBranch?.baseBranch ||
                    selectedExecutionRepository.defaultBranch
                  }${selectedExecutionRepository.localRootHint ? ` · ${selectedExecutionRepository.localRootHint}` : ""}`
                : "Execution defaults now belong to the work item, not the capability-wide local workspace."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onInitializeExecutionContext}
              disabled={!canInitializeExecutionContext || busyAction !== null}
              title={
                !canInitializeExecutionContext
                  ? "An execution repository must be configured before the context can be initialized."
                  : undefined
              }
              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === "initExecutionContext" ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <WorkflowIcon size={16} />
              )}
              {selectedEffectiveExecutionContext
                ? "Refresh context"
                : "Initialize context"}
            </button>
            <button
              type="button"
              onClick={onCreateSharedBranch}
              disabled={!canCreateSharedBranch || busyAction !== null}
              title={
                !canCreateSharedBranch
                  ? "Initialize an execution context first to create a shared branch."
                  : undefined
              }
              className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === "createSharedBranch" ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <ArrowRight size={16} />
              )}
              {selectedSharedBranch?.status === "ACTIVE"
                ? "Re-open branch"
                : "Create shared branch"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
            <p className="workspace-meta-label">Primary repository</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {selectedExecutionRepository?.label || "Not attached"}
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
            <p className="workspace-meta-label">Active writer</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {selectedActiveWriterLabel}
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
            <p className="workspace-meta-label">Writer claim</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onToggleWriteControl}
                disabled={busyAction !== null || !canControlWorkItems}
                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === "claimWriteControl" ||
                busyAction === "releaseWriteControl" ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <User size={14} />
                )}
                {currentActorOwnsWriteControl
                  ? "Release write control"
                  : "Take write control"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <AgentGitSessionCard
            capabilityId={selectedWorkItem.capabilityId}
            workItem={{
              id: selectedWorkItem.id,
              title: selectedWorkItem.title,
              capabilityId: selectedWorkItem.capabilityId,
            }}
            hasRepository={Boolean(selectedExecutionRepository)}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="workspace-meta-label">Latest handoff</p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  {latestSelectedHandoff?.summary ||
                    "Capture a handoff packet when another stakeholder needs to continue this same shared branch."}
                </p>
              </div>
              {latestSelectedHandoff?.acceptedAt ? (
                <StatusBadge tone="success">Accepted</StatusBadge>
              ) : latestSelectedHandoff ? (
                <StatusBadge tone="warning">Pending acceptance</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">No packet</StatusBadge>
              )}
            </div>
            {latestSelectedHandoff?.recommendedNextStep ? (
              <p className="mt-3 text-xs leading-relaxed text-secondary">
                Next: {latestSelectedHandoff.recommendedNextStep}
              </p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
            <p className="workspace-meta-label">Handoff actions</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCreateHandoff}
                disabled={
                  !resolutionNote.trim() ||
                  busyAction !== null ||
                  !canControlWorkItems
                }
                title={
                  !resolutionNote.trim()
                    ? "Add a resolution note above to create a handoff packet."
                    : !canControlWorkItems
                      ? "Write control is required to create a handoff."
                      : undefined
                }
                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === "createHandoff" ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Capture handoff
              </button>
              <button
                type="button"
                onClick={onAcceptLatestHandoff}
                disabled={
                  !latestSelectedHandoff ||
                  busyAction !== null ||
                  !canControlWorkItems
                }
                className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === "acceptHandoff" ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <ShieldCheck size={14} />
                )}
                Accept latest handoff
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-secondary">
              Use the guidance note above as the handoff summary so the next
              stakeholder inherits the branch context, artifacts, and next step
              clearly.
            </p>
          </div>
        </div>
      </div>

      {selectedCompiledStepContext ? (
        <div className="grid gap-3">
          <div className="workspace-meta-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="workspace-meta-label">Current step contract</p>
                <p className="mt-2 text-sm font-semibold text-on-surface">
                  {selectedCompiledStepContext.objective}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  {selectedCompiledStepContext.description ||
                    selectedCompiledStepContext.executionNotes ||
                    "The engine compiled this step into a bounded execution contract."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge
                  tone={
                    selectedCompiledStepContext.executionBoundary
                      .workspaceMode === "APPROVED_WRITE"
                      ? "warning"
                      : selectedCompiledStepContext.executionBoundary
                            .workspaceMode === "READ_ONLY"
                        ? "info"
                        : "neutral"
                  }
                >
                  {selectedCompiledStepContext.executionBoundary.workspaceMode.replace(
                    /_/g,
                    " ",
                  )}
                </StatusBadge>
                <StatusBadge
                  tone={
                    selectedCompiledStepContext.executionBoundary
                      .requiresHumanApproval
                      ? "warning"
                      : "success"
                  }
                >
                  {selectedCompiledStepContext.executionBoundary
                    .requiresHumanApproval
                    ? "Approval-aware"
                    : "Engine-managed"}
                </StatusBadge>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                <p className="workspace-meta-label">Allowed tools</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedCompiledStepContext.executionBoundary.allowedToolIds
                    .length > 0 ? (
                    selectedCompiledStepContext.executionBoundary.allowedToolIds.map(
                      (toolId) => (
                        <StatusBadge key={toolId} tone="info">
                          {formatEnumLabel(toolId)}
                        </StatusBadge>
                      ),
                    )
                  ) : (
                    <span className="text-sm text-secondary">
                      No tools for this step
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                <p className="workspace-meta-label">Next allowed actions</p>
                <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
                  {selectedCompiledStepContext.nextActions.map((action) => (
                    <li key={action} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {selectedCompiledStepContext.ownership ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                  <p className="workspace-meta-label">Primary owner</p>
                  <p className="mt-2 text-sm font-semibold text-on-surface">
                    {selectedCompiledStepContext.ownership.stepOwnerTeamId ||
                    selectedCompiledStepContext.ownership.phaseOwnerTeamId
                      ? workspaceTeamsById.get(
                          selectedCompiledStepContext.ownership
                            .stepOwnerTeamId ||
                            selectedCompiledStepContext.ownership
                              .phaseOwnerTeamId ||
                            "",
                        )?.name ||
                        selectedCompiledStepContext.ownership.stepOwnerTeamId ||
                        selectedCompiledStepContext.ownership.phaseOwnerTeamId
                      : "Phase default"}
                  </p>
                  <p className="mt-1 text-xs text-secondary">
                    Current queue routing follows this team unless an operator
                    claim is active.
                  </p>
                </div>
                <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                  <p className="workspace-meta-label">Approval routing</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedCompiledStepContext.ownership.approvalTeamIds
                      .length > 0 ? (
                      selectedCompiledStepContext.ownership.approvalTeamIds.map(
                        (teamId) => (
                          <StatusBadge key={teamId} tone="warning">
                            {workspaceTeamsById.get(teamId)?.name || teamId}
                          </StatusBadge>
                        ),
                      )
                    ) : (
                      <span className="text-sm text-secondary">
                        No explicit approval team override
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                  <p className="workspace-meta-label">Escalation / handoff</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedCompiledStepContext.ownership.escalationTeamIds
                      .length > 0 ? (
                      selectedCompiledStepContext.ownership.escalationTeamIds.map(
                        (teamId) => (
                          <StatusBadge key={teamId} tone="danger">
                            {workspaceTeamsById.get(teamId)?.name || teamId}
                          </StatusBadge>
                        ),
                      )
                    ) : (
                      <StatusBadge tone="neutral">
                        No escalation teams
                      </StatusBadge>
                    )}
                    {selectedCompiledStepContext.ownership
                      .requireHandoffAcceptance ? (
                      <StatusBadge tone="info">
                        Handoff acceptance required
                      </StatusBadge>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="workspace-meta-card">
              <div className="flex items-center justify-between gap-3">
                <p className="workspace-meta-label">Required inputs</p>
                <StatusBadge
                  tone={
                    selectedCompiledStepContext.missingInputs.length > 0
                      ? "warning"
                      : "success"
                  }
                >
                  {selectedCompiledStepContext.missingInputs.length > 0
                    ? `${selectedCompiledStepContext.missingInputs.length} missing`
                    : "Ready"}
                </StatusBadge>
              </div>
              {renderStructuredInputs(
                selectedCompiledStepContext.requiredInputs,
                "No structured inputs are declared for this step.",
              )}
            </div>

            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Artifact checklist</p>
              {renderArtifactChecklist(
                selectedCompiledStepContext.artifactChecklist,
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Agent suggested inputs</p>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                Advisory defaults from the assigned agent contract. These do not
                block execution unless the workflow step explicitly requires
                them.
              </p>
              {renderAgentArtifactExpectations(
                selectedCompiledStepContext.agentSuggestedInputs,
                "No advisory input suggestions are attached to this agent.",
                "neutral",
              )}
            </div>

            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Agent expected outputs</p>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                Default outputs the assigned agent is shaped to produce.
                Workflow artifact contracts still remain the execution source of
                truth.
              </p>
              {renderAgentArtifactExpectations(
                selectedCompiledStepContext.agentExpectedOutputs,
                "No default output expectations are attached to this agent.",
                "brand",
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Completion checklist</p>
              {selectedCompiledStepContext.completionChecklist.length > 0 ? (
                <ul className="mt-3 space-y-1 text-xs leading-relaxed text-secondary">
                  {selectedCompiledStepContext.completionChecklist.map(
                    (item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                        <span>{item}</span>
                      </li>
                    ),
                  )}
                </ul>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-secondary">
                  This step does not define an explicit completion checklist
                  yet.
                </p>
              )}
            </div>

            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Memory boundary</p>
              {selectedCompiledStepContext.memoryBoundary.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedCompiledStepContext.memoryBoundary.map((item) => (
                    <StatusBadge key={item} tone="neutral">
                      {item}
                    </StatusBadge>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-relaxed text-secondary">
                  The engine will rely on retrieved capability memory and
                  current step context.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {selectedCompiledWorkItemPlan ? (
        <div className="workspace-meta-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Compiled work plan</p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {selectedCompiledWorkItemPlan.planSummary}
              </p>
            </div>
            <StatusBadge tone="info">
              {selectedCompiledWorkItemPlan.stepSequence.length} steps
            </StatusBadge>
          </div>
        </div>
      ) : null}

      <div className="workspace-meta-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Recent artifacts</p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Keep the latest working documents close while you operate the
              step.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenArtifactsTab}
            className="enterprise-button enterprise-button-secondary"
          >
            Open artifacts
          </button>
        </div>

        {selectedArtifacts.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-secondary">
            No run artifacts are attached to this work item yet.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {selectedArtifacts.slice(0, 3).map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => onSelectArtifactAndOpen(artifact.id)}
                className={cn(
                  "rounded-[1.35rem] border border-outline-variant/30 bg-white px-4 py-4 text-left transition-colors hover:border-primary/30 hover:bg-primary/5",
                  selectedArtifact?.id === artifact.id &&
                    "border-primary/35 bg-primary/5",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-on-surface">
                    {artifact.name}
                  </p>
                  <StatusBadge tone="brand">
                    {artifact.direction || "OUTPUT"}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-secondary">
                  {compactMarkdownPreview(
                    artifact.summary ||
                      artifact.description ||
                      `${artifact.type} · ${artifact.version}`,
                    150,
                  )}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="workspace-meta-card">
        <p className="workspace-meta-label">Tags and routing</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone="neutral">
            {selectedWorkItemTaskTypeLabel}
          </StatusBadge>
          {selectedWorkItem.tags.map((tag) => (
            <span key={tag}>
              <StatusBadge tone="neutral">{tag}</StatusBadge>
            </span>
          ))}
          {selectedWorkItem.tags.length === 0 ? (
            <span className="text-sm text-secondary">
              No extra tags were attached to this work item.
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-secondary">
          {selectedWorkItemTaskTypeDescription}
        </p>
      </div>

      <div className="workspace-meta-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">
              Phase stakeholders & sign-off
            </p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              These stakeholders are carried into phase-specific human documents
              and sign-off records for this work item.
            </p>
          </div>
          <StatusBadge
            tone={
              selectedCurrentPhaseStakeholders.length > 0 ? "info" : "neutral"
            }
          >
            {selectedPhaseStakeholderAssignments.length > 0
              ? `${selectedPhaseStakeholderAssignments.length} phases configured`
              : "No phase stakeholders"}
          </StatusBadge>
        </div>

        <div className="mt-4 rounded-[1.25rem] border border-outline-variant/30 bg-white/80 px-4 py-3">
          <p className="workspace-meta-label">
            Current phase ·{" "}
            {getLifecyclePhaseLabelForPhase(selectedWorkItem.phase)}
          </p>
          {selectedCurrentPhaseStakeholders.length > 0 ? (
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-secondary">
              {selectedCurrentPhaseStakeholders.map((stakeholder, index) => (
                <li
                  key={`${selectedWorkItem.phase}-${stakeholder.email || stakeholder.name}-${index}`}
                  className="flex gap-2"
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                  <span>{formatPhaseStakeholderLine(stakeholder)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-secondary">
              No specific stakeholders were assigned for the current phase.
            </p>
          )}
        </div>

        {selectedPhaseStakeholderAssignments.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {selectedPhaseStakeholderAssignments.map((assignment) => (
              <div
                key={assignment.phaseId}
                className="rounded-[1.25rem] border border-outline-variant/20 bg-surface-container-low/35 px-4 py-3"
              >
                <p className="text-sm font-semibold text-on-surface">
                  {getLifecyclePhaseLabelForPhase(assignment.phaseId)}
                </p>
                <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
                  {assignment.stakeholders.map((stakeholder, index) => (
                    <li
                      key={`${assignment.phaseId}-${stakeholder.email || stakeholder.name}-${index}`}
                    >
                      {formatPhaseStakeholderLine(stakeholder)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>

    <div className="space-y-4">
      {!runtimeReady ? (
        <div className="workspace-inline-alert workspace-inline-alert-warning">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">
              Agent connection is not ready
            </p>
            <p className="mt-1 text-sm leading-relaxed">
              {runtimeError ||
                "Configure the agent connection before starting or restarting execution."}
            </p>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="workspace-inline-alert workspace-inline-alert-danger">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Action failed</p>
            <p className="mt-1 text-sm leading-relaxed">{actionError}</p>
          </div>
        </div>
      ) : null}

      {selectedOpenWait ? (
        <div className="workspace-inline-alert workspace-inline-alert-warning">
          <Clock3 size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em]">
              Waiting for {formatEnumLabel(selectedOpenWait.type)}
            </p>
            <div className="mt-2 rounded-2xl border border-outline-variant/25 bg-white/90 px-4 py-3">
              <MarkdownContent
                content={normalizeMarkdownishText(selectedOpenWait.message)}
              />
            </div>
          </div>
        </div>
      ) : null}

      {selectedOpenWait?.type === "INPUT" ? (
        <div
          id="orchestrator-structured-input"
          className="workspace-meta-card border-amber-200/80 bg-amber-50/50"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Structured input request</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                Fill the exact gaps the engine detected for this step
              </p>
            </div>
            <StatusBadge tone="warning">
              {selectedRequestedInputFields.length || 1} inputs
            </StatusBadge>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={focusGuidanceComposer}
              className="enterprise-button enterprise-button-secondary"
            >
              Open input note
            </button>
            {hasMissingWorkspaceInput ? (
              <button
                type="button"
                onClick={onOpenExecutionPolicyConfig}
                className="enterprise-button enterprise-button-primary"
              >
                Open Desktop Workspaces
              </button>
            ) : null}
          </div>

          {waitRequiresApprovedWorkspace ? (
            <div className="mt-4 rounded-2xl border border-outline-variant/25 bg-white/85 px-4 py-3">
              <p className="workspace-meta-label">Desktop workspace</p>
              {hasApprovedWorkspaceConfigured ? (
                <>
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    Validated roots for this operator on this desktop:
                  </p>
                  <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
                    {approvedWorkspaceRoots.slice(0, 4).map((root) => (
                      <li key={root} className="font-mono text-[0.72rem]">
                        {root}
                      </li>
                    ))}
                  </ul>
                  {approvedWorkspaceRoots.length > 4 ? (
                    <p className="mt-2 text-xs text-secondary">
                      +{approvedWorkspaceRoots.length - 4} more
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-secondary">
                  No desktop workspace mappings are saved yet.
                </p>
              )}

              <p className="mt-3 text-xs leading-relaxed text-secondary">
                {hasApprovedWorkspaceConfigured
                  ? "Add another mapped local directory if this work item needs a different codebase."
                  : "Save a readable local directory for this operator so the engine can safely run workspace tools."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={approvedWorkspaceDraft}
                  onChange={(event) =>
                    onApprovedWorkspaceDraftChange(event.target.value)
                  }
                  placeholder="/path/to/your/repo"
                  className="field-input min-w-[16rem] flex-1 bg-white"
                />
                <button
                  type="button"
                  onClick={() => onApproveWorkspacePath({ unblock: true })}
                  disabled={busyAction !== null}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === "approveWorkspacePath" ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  Save and continue
                </button>
                <button
                  type="button"
                  onClick={() => onApproveWorkspacePath()}
                  disabled={busyAction !== null}
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Save only
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedExecutionRepository?.localRootHint ? (
                  <button
                    type="button"
                    onClick={() =>
                      onApprovedWorkspaceDraftChange(
                        selectedExecutionRepository.localRootHint || "",
                      )
                    }
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Use repo root hint
                  </button>
                ) : null}
                {approvedWorkspaceRoots.slice(0, 2).map((root) => (
                  <button
                    key={root}
                    type="button"
                    onClick={() => onApprovedWorkspaceDraftChange(root)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    {root}
                  </button>
                ))}
                {activeCapabilityLocalDirectories.slice(0, 2).map((root) => (
                  <button
                    key={root}
                    type="button"
                    onClick={() => onApprovedWorkspaceDraftChange(root)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    {root}
                  </button>
                ))}
              </div>
              {approvedWorkspaceValidation ? (
                <p
                  className={cn(
                    "mt-2 text-xs font-medium",
                    approvedWorkspaceValidation.valid
                      ? "text-emerald-700"
                      : "text-amber-800",
                  )}
                >
                  {approvedWorkspaceValidation.message}
                </p>
              ) : null}
              {!canEditCapability ? (
                <p className="mt-2 text-xs font-medium text-amber-800">
                  Approving new paths requires capability edit access. Switch
                  Current Operator (top right) to a workspace admin if needed.
                </p>
              ) : null}
            </div>
          ) : null}

          {renderStructuredInputs(
            selectedRequestedInputFields,
            "The step is waiting for operator input, but no structured field list was attached to this wait.",
          )}
        </div>
      ) : null}

      {selectedOpenWait?.type === "APPROVAL" && selectedCodeDiffArtifactId ? (
        <div className="workspace-meta-card border-primary/15 bg-primary/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Code Diff Review</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                Review developer changes before approving continuation
              </p>
            </div>
            <StatusBadge tone="info">Diff attached</StatusBadge>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-secondary">
            {selectedCodeDiffArtifact?.summary ||
              selectedOpenWait.payload?.codeDiffSummary ||
              "This approval gate includes a code diff generated from the developer step."}
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-outline-variant/25 bg-white/90 px-4 py-3">
              <p className="workspace-meta-label">Repositories</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {selectedCodeDiffRepositoryCount || 1}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/25 bg-white/90 px-4 py-3">
              <p className="workspace-meta-label">Touched files</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {selectedCodeDiffTouchedFileCount || "Tracked in diff"}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/25 bg-white/90 px-4 py-3">
              <p className="workspace-meta-label">Review surface</p>
              <button
                type="button"
                onClick={onOpenDiffReview}
                className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-primary"
              >
                Open full diff review
                <ExternalLink size={14} />
              </button>
            </div>
          </div>

          {!selectedCodeDiffArtifact ? (
            <p className="mt-4 text-sm leading-relaxed text-secondary">
              The approval is waiting on a stored code diff artifact, but it is
              not loaded in the current workspace snapshot yet.
            </p>
          ) : null}
        </div>
      ) : null}

      {selectedOpenWait?.type === "CONFLICT_RESOLUTION" ? (
        <div className="workspace-meta-card border-red-200/70 bg-red-50/55">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Contrarian Review</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                Advisory adversarial pass before continuation
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={selectedContrarianReviewTone}>
                {selectedContrarianReview
                  ? selectedContrarianReview.status === "READY"
                    ? "Review ready"
                    : selectedContrarianReview.status === "PENDING"
                      ? "Review pending"
                      : "Review unavailable"
                  : "Review unavailable"}
              </StatusBadge>
              {selectedContrarianReview ? (
                <StatusBadge tone={selectedContrarianReviewTone}>
                  {selectedContrarianReview.severity}
                </StatusBadge>
              ) : null}
            </div>
          </div>

          {!selectedContrarianReview ? (
            <p className="mt-3 text-sm leading-relaxed text-secondary">
              No contrarian payload is attached to this wait yet. You can still
              resolve the conflict manually.
            </p>
          ) : null}

          {selectedContrarianReview?.status === "PENDING" ? (
            <p className="mt-3 text-sm leading-relaxed text-secondary">
              The Contrarian Reviewer is challenging the assumptions behind this
              conflict wait. The operator decision remains available while the
              advisory pass completes.
            </p>
          ) : null}

          {selectedContrarianReview?.status === "ERROR" ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-white/80 px-4 py-3">
              <p className="text-sm font-semibold text-red-800">
                Review unavailable
              </p>
              <p className="mt-1 text-sm leading-relaxed text-secondary">
                {selectedContrarianReview.lastError ||
                  selectedContrarianReview.summary}
              </p>
            </div>
          ) : null}

          {selectedContrarianReviewIsReady && selectedContrarianReview ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm leading-relaxed text-on-surface">
                {selectedContrarianReview.summary}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                  <p className="workspace-meta-label">Recommendation</p>
                  <p className="mt-2 text-sm font-semibold text-on-surface">
                    {formatEnumLabel(selectedContrarianReview.recommendation)}
                  </p>
                </div>
                <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                  <p className="workspace-meta-label">Sources</p>
                  <p className="mt-2 text-sm font-semibold text-on-surface">
                    {selectedContrarianReview.sourceDocumentIds?.length || 0}{" "}
                    documents
                  </p>
                </div>
              </div>

              {selectedContrarianReview.suggestedResolution ? (
                <button
                  type="button"
                  onClick={() =>
                    onResolutionNoteChange(
                      selectedContrarianReview.suggestedResolution || "",
                    )
                  }
                  className="enterprise-button enterprise-button-secondary"
                >
                  <ShieldCheck size={16} />
                  Use suggested resolution
                </button>
              ) : null}

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                  <p className="workspace-meta-label">Challenged assumptions</p>
                  {renderReviewList(
                    selectedContrarianReview.challengedAssumptions || [],
                    "No assumptions were challenged.",
                  )}
                </div>
                <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                  <p className="workspace-meta-label">Risks</p>
                  {renderReviewList(
                    selectedContrarianReview.risks || [],
                    "No major risks were flagged.",
                  )}
                </div>
                <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                  <p className="workspace-meta-label">Missing evidence</p>
                  {renderReviewList(
                    selectedContrarianReview.missingEvidence || [],
                    "No missing evidence was identified.",
                  )}
                </div>
                <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                  <p className="workspace-meta-label">Alternative paths</p>
                  {renderReviewList(
                    selectedContrarianReview.alternativePaths || [],
                    "No alternative path was proposed.",
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="workspace-meta-card">
        <p className="workspace-meta-label">Reset target</p>
        <p className="workspace-meta-value">
          {selectedResetStep?.name || "Workflow start"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-secondary">
          Reset moves the work item back to{" "}
          <strong>{getPhaseMeta(selectedResetPhase).label}</strong>
          {selectedResetAgentName
            ? ` and restarts with ${selectedResetAgentName}.`
            : "."}
        </p>
      </div>
    </div>
  </>
);
