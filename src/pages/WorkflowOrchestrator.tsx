import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  StopCircle,
} from "lucide-react";
import { useCapability } from "../context/CapabilityContext";
import { OrchestratorCopilotThread } from "../components/orchestrator/OrchestratorCopilotThread";
import { cn } from "../lib/utils";
import type { WorkItem } from "../types";
import { StageRail } from "./workflowOrchestrator/StageRail";
import { NewWorkItemForm } from "./workflowOrchestrator/NewWorkItemForm";
import {
  isHumanStage,
  useWorkflowOrchestrator,
} from "./workflowOrchestrator/useWorkflowOrchestrator";

const STREAMING_STATUSES = new Set([
  "STREAMING",
  "ADVANCING",
  "LOADING_STAGE",
  "CREATING",
]);

const statusBadgeStyles = (status: string) => {
  switch (status) {
    case "STREAMING":
    case "LOADING_STAGE":
    case "CREATING":
      return "border-primary/30 bg-primary/10 text-primary";
    case "ADVANCING":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "STAGE_AWAITING_USER":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "PAUSED":
      return "border-outline-variant/40 bg-surface-container-low text-secondary";
    case "WORKFLOW_DONE":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "ERROR":
      return "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    default:
      return "border-outline-variant/40 bg-surface-container-low text-secondary";
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case "IDLE":
      return "Pick a work item";
    case "CREATING":
      return "Creating work item…";
    case "LOADING_STAGE":
      return "Loading stage…";
    case "STAGE_AWAITING_USER":
      return "Stage running";
    case "STREAMING":
      return "Streaming response…";
    case "STAGE_COMPLETE_DETECTED":
      return "Stage complete — advancing";
    case "ADVANCING":
      return "Advancing…";
    case "WORKFLOW_DONE":
      return "Workflow complete";
    case "PAUSED":
      return "Paused";
    case "ERROR":
      return "Error";
    default:
      return status;
  }
};

const WorkflowOrchestrator = () => {
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const [searchParams, setSearchParams] = useSearchParams();

  // Snapshot URL params once at mount so the URL-sync effect (which writes
  // workItemId back into searchParams after every pick) doesn't flip
  // initialWorkItemId and re-trigger the auto-load effect in the hook,
  // causing an infinite pick → reset → URL-update → pick loop.
  const mountSearchParamsRef = useRef(searchParams);
  const initialWorkItemId = mountSearchParamsRef.current.get("workItemId") || undefined;
  const initialAutoAdvance = mountSearchParamsRef.current.get("autoAdvance") !== "0";
  const initialShowCreate = mountSearchParamsRef.current.get("new") === "1";

  const workspace = useMemo(
    () => getCapabilityWorkspace(activeCapability.id),
    [activeCapability.id, getCapabilityWorkspace],
  );

  const orchestrator = useWorkflowOrchestrator({
    capability: activeCapability,
    initialWorkItemId,
    initialAutoAdvance,
  });

  const [showCreateForm, setShowCreateForm] = useState(initialShowCreate);
  const [composerInput, setComposerInput] = useState("");
  const [showWorkItemPicker, setShowWorkItemPicker] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Sync URL when workItem / autoAdvance change
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (orchestrator.state.workItem) {
      next.set("workItemId", orchestrator.state.workItem.id);
    } else {
      next.delete("workItemId");
    }
    if (!orchestrator.state.autoAdvance) {
      next.set("autoAdvance", "0");
    } else {
      next.delete("autoAdvance");
    }
    if (showCreateForm) {
      next.set("new", "1");
    } else {
      next.delete("new");
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchestrator.state.workItem?.id, orchestrator.state.autoAdvance, showCreateForm]);

  const isComposerDisabled = STREAMING_STATUSES.has(orchestrator.state.status);
  // True when the current stage is run by an agent/worker (NOT a human task).
  // Drives the "running on worker" banner and hides the manual "Mark done" button.
  const isAgentStage =
    Boolean(orchestrator.state.currentStep) &&
    !isHumanStage(orchestrator.state.currentStep);

  const handleSend = useCallback(() => {
    const value = composerInput.trim();
    if (!value || isComposerDisabled) return;
    setComposerInput("");
    void orchestrator.sendMessage(value);
  }, [composerInput, isComposerDisabled, orchestrator]);

  const handlePickWorkItem = useCallback(
    (workItemId: string) => {
      setShowWorkItemPicker(false);
      setShowCreateForm(false);
      void orchestrator.pickWorkItem(workItemId);
    },
    [orchestrator],
  );

  const handleCreate = useCallback(
    async (payload: {
      title: string;
      description?: string;
      workflowId: string;
      priority: WorkItem["priority"];
      tags: string[];
    }) => {
      const created = await orchestrator.createWorkItem(payload);
      if (created) {
        setShowCreateForm(false);
      }
    },
    [orchestrator],
  );

  // Auto-scroll thread on new message / draft
  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [orchestrator.state.messages.length, orchestrator.state.streamedDraft]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="section-card ambient-shadow flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[0.7rem] uppercase tracking-[0.18em] text-outline">
              Workflow Orchestrator
            </p>
            <h1 className="text-2xl font-semibold text-primary">
              {orchestrator.state.workItem ? (
                <>
                  {orchestrator.state.workItem.title}
                  <span className="ml-2 text-base font-normal text-secondary">
                    · {orchestrator.state.workItem.id}
                  </span>
                </>
              ) : (
                "Drive a workflow stage by stage"
              )}
            </h1>
            {orchestrator.state.workflow ? (
              <p className="mt-1 text-sm text-secondary">
                Workflow: <strong>{orchestrator.state.workflow.name}</strong>
                {orchestrator.state.agent ? (
                  <span> · agent: {orchestrator.state.agent.name}</span>
                ) : null}
              </p>
            ) : (
              <p className="mt-1 text-sm text-secondary">
                Pick an existing work item or create a new one to begin.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowWorkItemPicker((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/50 bg-surface-container-low px-3 py-1.5 text-xs text-primary hover:bg-surface-container"
              >
                {orchestrator.state.workItem ? "Switch work item" : "Pick work item"}
                <ChevronDown size={12} />
              </button>
              {showWorkItemPicker ? (
                <div className="absolute right-0 z-10 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-outline-variant/50 bg-surface-container-high shadow-lg">
                  {workspace.workItems.length === 0 ? (
                    <div className="p-3 text-xs text-secondary">
                      No work items in this capability yet.
                    </div>
                  ) : (
                    workspace.workItems.map((workItem) => (
                      <button
                        key={workItem.id}
                        type="button"
                        onClick={() => handlePickWorkItem(workItem.id)}
                        className="flex w-full flex-col gap-0.5 border-b border-outline-variant/20 px-3 py-2 text-left text-xs hover:bg-primary/10"
                      >
                        <span className="font-medium text-primary">
                          {workItem.title}
                        </span>
                        <span className="text-[0.65rem] uppercase tracking-[0.12em] text-outline">
                          {workItem.id} · {workItem.phase} · {workItem.status}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm((v) => !v);
                setShowWorkItemPicker(false);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Plus size={12} /> New work item
            </button>
          </div>
        </div>

        {showCreateForm ? (
          <NewWorkItemForm
            workflows={workspace.workflows}
            capabilityName={activeCapability.name}
            isSubmitting={orchestrator.state.status === "CREATING"}
            error={
              orchestrator.state.error?.phase === "create"
                ? orchestrator.state.error.message
                : null
            }
            onSubmit={(payload) => void handleCreate(payload)}
            onCancel={() => setShowCreateForm(false)}
          />
        ) : null}

        {orchestrator.state.workflow ? (
          <StageRail
            steps={orchestrator.state.workflow.steps}
            currentStepId={orchestrator.state.currentStep?.id}
            isAdvancing={orchestrator.state.status === "ADVANCING"}
          />
        ) : null}

        {isAgentStage && orchestrator.state.currentStep ? (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
            Agent stage — running on the worker. The page polls for advancement; you can still send messages to nudge the agent.
          </div>
        ) : null}
      </header>

      {/* ── Chat thread + composer ─────────────────────────────────── */}
      {orchestrator.state.workItem ? (
        <section className="section-card ambient-shadow flex flex-col gap-3 p-5">
          <OrchestratorCopilotThread
            messages={orchestrator.state.messages}
            currentActorDisplayName="You"
            selectedAgentName={orchestrator.state.agent?.name || null}
            dockDraft={orchestrator.state.streamedDraft}
            isDockSending={orchestrator.state.status === "STREAMING"}
            threadRef={threadRef}
            onScroll={() => undefined}
          />

          {orchestrator.state.hint ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {orchestrator.state.hint}
            </div>
          ) : null}

          {orchestrator.state.error ? (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              <AlertCircle size={14} className="mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">{orchestrator.state.error.phase} failed</p>
                <p className="opacity-80">{orchestrator.state.error.message}</p>
              </div>
              {orchestrator.state.error.retryable ? (
                <button
                  type="button"
                  onClick={() => {
                    if (orchestrator.state.workItem) {
                      void orchestrator.pickWorkItem(orchestrator.state.workItem.id);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 px-2 py-1 text-[0.7rem]"
                >
                  <RefreshCw size={10} /> Retry
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <textarea
              ref={composerRef}
              value={composerInput}
              onChange={(event) => setComposerInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                orchestrator.state.status === "WORKFLOW_DONE"
                  ? "Workflow complete — chat is closed."
                  : isComposerDisabled
                    ? "Streaming…"
                    : "Type a message · Enter to send · Shift+Enter for newline"
              }
              disabled={
                isComposerDisabled || orchestrator.state.status === "WORKFLOW_DONE"
              }
              rows={3}
              className={cn(
                "w-full resize-none rounded-xl border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-sm text-primary focus:border-primary focus:outline-none",
                (isComposerDisabled || orchestrator.state.status === "WORKFLOW_DONE") &&
                  "cursor-not-allowed opacity-60",
              )}
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {orchestrator.state.status === "STREAMING" ? (
                  <button
                    type="button"
                    onClick={orchestrator.pause}
                    className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs text-secondary hover:bg-surface-container-low"
                  >
                    <StopCircle size={12} /> Stop
                  </button>
                ) : null}
                {orchestrator.state.status === "PAUSED" ? (
                  <button
                    type="button"
                    onClick={orchestrator.resume}
                    className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs text-secondary hover:bg-surface-container-low"
                  >
                    <Play size={12} /> Resume
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={handleSend}
                disabled={
                  !composerInput.trim() ||
                  isComposerDisabled ||
                  orchestrator.state.status === "WORKFLOW_DONE"
                }
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground",
                  (!composerInput.trim() || isComposerDisabled) &&
                    "cursor-not-allowed opacity-60",
                )}
              >
                {orchestrator.state.status === "STREAMING" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Send size={12} />
                )}
                Send
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="section-card ambient-shadow flex flex-col items-center justify-center gap-3 p-10 text-center">
          <Sparkles size={32} className="text-primary" />
          <p className="text-sm text-secondary">
            Pick a work item from the menu above, or create a new one to start a workflow chat.
          </p>
        </section>
      )}

      {/* ── Footer status bar ───────────────────────────────────────── */}
      <footer className="section-card ambient-shadow flex flex-wrap items-center justify-between gap-3 p-4 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium",
              statusBadgeStyles(orchestrator.state.status),
            )}
          >
            {orchestrator.state.status === "ADVANCING" ||
            orchestrator.state.status === "STREAMING" ||
            orchestrator.state.status === "LOADING_STAGE" ? (
              <Loader2 size={10} className="animate-spin" />
            ) : orchestrator.state.status === "WORKFLOW_DONE" ? (
              <CheckCircle2 size={10} />
            ) : null}
            {statusLabel(orchestrator.state.status)}
          </span>
          {orchestrator.state.workItem ? (
            <label className="inline-flex cursor-pointer items-center gap-2 text-secondary">
              <input
                type="checkbox"
                checked={orchestrator.state.autoAdvance}
                onChange={(event) =>
                  orchestrator.setAutoAdvance(event.target.checked)
                }
                className="h-3.5 w-3.5 rounded border-outline-variant/50"
              />
              <span>Auto-advance</span>
            </label>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {orchestrator.state.status === "STREAMING" ||
          orchestrator.state.status === "STAGE_AWAITING_USER" ||
          orchestrator.state.status === "PAUSED" ? (
            <button
              type="button"
              onClick={orchestrator.pause}
              disabled={orchestrator.state.status === "PAUSED"}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 px-3 py-1.5 text-secondary hover:bg-surface-container-low",
                orchestrator.state.status === "PAUSED" && "cursor-not-allowed opacity-60",
              )}
            >
              <Pause size={10} /> Pause
            </button>
          ) : null}
          {!isAgentStage &&
          orchestrator.state.workItem &&
          orchestrator.state.status !== "WORKFLOW_DONE" ? (
            <button
              type="button"
              onClick={orchestrator.markStageDone}
              disabled={
                orchestrator.state.status === "ADVANCING" ||
                orchestrator.state.status === "STREAMING" ||
                orchestrator.state.messages.length === 0
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-lg bg-emerald-500/90 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500",
                (orchestrator.state.status === "ADVANCING" ||
                  orchestrator.state.status === "STREAMING" ||
                  orchestrator.state.messages.length === 0) &&
                  "cursor-not-allowed opacity-60",
              )}
            >
              <CheckCircle2 size={10} /> Mark stage done
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  );
};

export default WorkflowOrchestrator;
