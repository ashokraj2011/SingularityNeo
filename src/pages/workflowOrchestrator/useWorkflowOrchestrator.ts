import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  completeCapabilityWorkItemHumanStage,
  continueCapabilityWorkItemStageControl,
  createCapabilityWorkItem,
  streamCapabilityChat,
} from "../../lib/api";
import { useCapability } from "../../context/CapabilityContext";
import { useToast } from "../../context/ToastContext";
import type {
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  WorkItem,
  Workflow,
  WorkflowStep,
} from "../../types";
import {
  STAGE_COMPLETE_INSTRUCTION,
  detectStageComplete,
  stripStageCompleteSentinel,
} from "./detectStageComplete";

/**
 * Stages whose `stepType` starts with `HUMAN_` (HUMAN_APPROVAL, HUMAN_TASK)
 * accept the `complete-human-stage` server call.  All other types — AGENT_TASK,
 * BUILD, DELIVERY, GOVERNANCE_GATE, SUB_WORKFLOW — are advanced by the worker.
 */
export const isHumanStage = (step: WorkflowStep | null | undefined): boolean =>
  Boolean(step && step.stepType.startsWith("HUMAN_"));

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type WorkflowOrchestratorStatus =
  | "IDLE"
  | "CREATING"
  | "LOADING_STAGE"
  | "STAGE_AWAITING_USER"
  | "STREAMING"
  | "STAGE_COMPLETE_DETECTED"
  | "ADVANCING"
  | "WORKFLOW_DONE"
  | "PAUSED"
  | "ERROR";

export interface OrchestratorErrorPayload {
  phase:
    | "load"
    | "create"
    | "stream"
    | "record"
    | "complete"
    | "advance";
  message: string;
  retryable: boolean;
}

interface State {
  status: WorkflowOrchestratorStatus;
  workItem: WorkItem | null;
  workflow: Workflow | null;
  currentStep: WorkflowStep | null;
  agent: CapabilityAgent | null;
  messages: CapabilityChatMessage[];
  streamedDraft: string;
  autoAdvance: boolean;
  error: OrchestratorErrorPayload | null;
  hint: string | null;
  /** Number of consecutive completed turns without a sentinel — drives the soft hint. */
  turnsSinceSentinel: number;
  /** Bumped on every send; lets stream callbacks drop deltas from superseded requests. */
  requestToken: number;
}

const initialState: State = {
  status: "IDLE",
  workItem: null,
  workflow: null,
  currentStep: null,
  agent: null,
  messages: [],
  streamedDraft: "",
  autoAdvance: true,
  error: null,
  hint: null,
  turnsSinceSentinel: 0,
  requestToken: 0,
};

type Action =
  | { type: "RESET" }
  | { type: "SET_AUTO_ADVANCE"; value: boolean }
  | { type: "BEGIN_LOAD" }
  | { type: "BEGIN_CREATE" }
  | { type: "BIND_STAGE"; workItem: WorkItem; workflow: Workflow; currentStep: WorkflowStep | null; agent: CapabilityAgent | null; intro?: CapabilityChatMessage }
  | { type: "BEGIN_STREAM"; userMessage: CapabilityChatMessage; requestToken: number }
  | { type: "STREAM_DELTA"; chunk: string; requestToken: number }
  | { type: "STREAM_COMPLETE"; agentMessage: CapabilityChatMessage; sentinelDetected: boolean; requestToken: number }
  | { type: "STREAM_ABORTED"; partialMessage: CapabilityChatMessage | null; requestToken: number }
  | { type: "BEGIN_ADVANCE" }
  | { type: "WORKFLOW_DONE" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "SET_ERROR"; error: OrchestratorErrorPayload }
  | { type: "CLEAR_ERROR" };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "RESET":
      return { ...initialState, autoAdvance: state.autoAdvance };
    case "SET_AUTO_ADVANCE":
      return { ...state, autoAdvance: action.value };
    case "BEGIN_LOAD":
      return { ...state, status: "LOADING_STAGE", error: null };
    case "BEGIN_CREATE":
      return { ...state, status: "CREATING", error: null };
    case "BIND_STAGE":
      return {
        ...state,
        status: "STAGE_AWAITING_USER",
        workItem: action.workItem,
        workflow: action.workflow,
        currentStep: action.currentStep,
        agent: action.agent,
        messages: action.intro ? [action.intro] : [],
        streamedDraft: "",
        error: null,
        hint: null,
        turnsSinceSentinel: 0,
      };
    case "BEGIN_STREAM":
      return {
        ...state,
        status: "STREAMING",
        messages: [...state.messages, action.userMessage],
        streamedDraft: "",
        error: null,
        requestToken: action.requestToken,
      };
    case "STREAM_DELTA":
      if (state.requestToken !== action.requestToken) return state;
      return { ...state, streamedDraft: state.streamedDraft + action.chunk };
    case "STREAM_COMPLETE": {
      if (state.requestToken !== action.requestToken) return state;
      const nextTurns = action.sentinelDetected ? 0 : state.turnsSinceSentinel + 1;
      const hint =
        !action.sentinelDetected && nextTurns >= 3
          ? "The agent hasn't signaled completion yet. Click \"Mark stage done\" when you're ready."
          : null;
      return {
        ...state,
        status: action.sentinelDetected ? "STAGE_COMPLETE_DETECTED" : "STAGE_AWAITING_USER",
        messages: [...state.messages, action.agentMessage],
        streamedDraft: "",
        hint,
        turnsSinceSentinel: nextTurns,
      };
    }
    case "STREAM_ABORTED": {
      if (state.requestToken !== action.requestToken) return state;
      return {
        ...state,
        status: "PAUSED",
        messages: action.partialMessage ? [...state.messages, action.partialMessage] : state.messages,
        streamedDraft: "",
      };
    }
    case "BEGIN_ADVANCE":
      return { ...state, status: "ADVANCING", error: null };
    case "WORKFLOW_DONE":
      return { ...state, status: "WORKFLOW_DONE" };
    case "PAUSE":
      return { ...state, status: "PAUSED", autoAdvance: false };
    case "RESUME":
      return { ...state, status: "STAGE_AWAITING_USER" };
    case "SET_ERROR":
      return { ...state, status: "ERROR", error: action.error };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    default:
      return state;
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const formatTimestamp = (value = new Date()) =>
  value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const buildIntroMessage = (
  capabilityId: string,
  step: WorkflowStep,
  agent: CapabilityAgent | null,
): CapabilityChatMessage => ({
  id: `intro-${step.id}-${Date.now()}`,
  capabilityId,
  role: "agent",
  content: `**Stage \"${step.name}\" started.** ${
    step.description ? step.description.trim() : "Type a message below to begin."
  }`,
  timestamp: formatTimestamp(),
  agentId: agent?.id,
  agentName: agent?.name,
});

const findCurrentStep = (
  workflow: Workflow | undefined,
  workItem: WorkItem,
): WorkflowStep | null => {
  if (!workflow) return null;
  const byId = workItem.currentStepId
    ? workflow.steps.find((step) => step.id === workItem.currentStepId)
    : null;
  if (byId) return byId;
  return workflow.steps.find((step) => step.phase === workItem.phase) || null;
};

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

export interface UseWorkflowOrchestratorOptions {
  capability: Capability;
  /** When set, the hook auto-loads this work item on mount and capability change. */
  initialWorkItemId?: string;
  /** Initial value for the auto-advance toggle (URL override). */
  initialAutoAdvance?: boolean;
}

export const useWorkflowOrchestrator = ({
  capability,
  initialWorkItemId,
  initialAutoAdvance,
}: UseWorkflowOrchestratorOptions) => {
  const { getCapabilityWorkspace, refreshCapabilityBundle } = useCapability();
  const { error: toastError, info, success } = useToast();

  const [state, dispatch] = useReducer(
    reducer,
    initialState,
    (base) =>
      typeof initialAutoAdvance === "boolean"
        ? { ...base, autoAdvance: initialAutoAdvance }
        : base,
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const isMountedRef = useRef(true);
  // Latest state snapshot for callbacks that must read post-dispatch values
  // (e.g. the auto-advance handler which fires inside an async function).
  const stateRef = useRef(state);
  stateRef.current = state;

  // Guard that prevents the initial auto-load from firing more than once per
  // (capabilityId, workItemId) pair.  Without this, any context update that
  // causes `initialWorkItemId` to be seen as "changed" would re-trigger
  // pickWorkItem, resetting the orchestrator in an infinite loop.
  const autoLoadedForRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  // ── Workspace lookup helpers ──────────────────────────────────────────
  const workspace = useMemo(
    () => getCapabilityWorkspace(capability.id),
    [capability.id, getCapabilityWorkspace],
  );

  const findWorkItem = useCallback(
    (workItemId: string): WorkItem | null => {
      const ws = getCapabilityWorkspace(capability.id);
      return ws.workItems.find((entry) => entry.id === workItemId) || null;
    },
    [capability.id, getCapabilityWorkspace],
  );

  const findWorkflow = useCallback(
    (workflowId: string): Workflow | null => {
      const ws = getCapabilityWorkspace(capability.id);
      return ws.workflows.find((entry) => entry.id === workflowId) || null;
    },
    [capability.id, getCapabilityWorkspace],
  );

  const findAgent = useCallback(
    (agentId?: string): CapabilityAgent | null => {
      if (!agentId) return null;
      const ws = getCapabilityWorkspace(capability.id);
      return ws.agents.find((entry) => entry.id === agentId) || null;
    },
    [capability.id, getCapabilityWorkspace],
  );

  // ── Stage binding: refetch bundle, find current step + agent, push intro
  const bindStage = useCallback(
    async (workItemId: string, options?: { skipIntro?: boolean }) => {
      try {
        await refreshCapabilityBundle(capability.id);
        const workItem = findWorkItem(workItemId);
        if (!workItem) {
          throw new Error(`Work item ${workItemId} not found in this capability.`);
        }
        const workflow = findWorkflow(workItem.workflowId);
        if (!workflow) {
          throw new Error(`Workflow ${workItem.workflowId} not found.`);
        }
        const currentStep = findCurrentStep(workflow, workItem);
        if (!currentStep) {
          dispatch({
            type: "BIND_STAGE",
            workItem,
            workflow,
            currentStep: null,
            agent: null,
          });
          dispatch({ type: "WORKFLOW_DONE" });
          return;
        }
        const agent = findAgent(currentStep.agentId);
        const intro = options?.skipIntro
          ? undefined
          : buildIntroMessage(capability.id, currentStep, agent);
        dispatch({
          type: "BIND_STAGE",
          workItem,
          workflow,
          currentStep,
          agent,
          intro,
        });
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          error: {
            phase: "load",
            message: err instanceof Error ? err.message : "Failed to load stage.",
            retryable: true,
          },
        });
      }
    },
    [capability.id, findAgent, findWorkItem, findWorkflow, refreshCapabilityBundle],
  );

  // ── Pick existing work item (URL or dropdown) ────────────────────────
  const pickWorkItem = useCallback(
    async (workItemId: string) => {
      abortControllerRef.current?.abort();
      dispatch({ type: "RESET" });
      dispatch({ type: "BEGIN_LOAD" });
      await bindStage(workItemId);
    },
    [bindStage],
  );

  // Auto-load if initialWorkItemId provided — at most once per unique
  // (capabilityId, workItemId) pair so that the URL-sync effect in the page
  // writing workItemId into searchParams doesn't re-trigger this.
  useEffect(() => {
    if (!initialWorkItemId) return;
    const key = `${capability.id}::${initialWorkItemId}`;
    if (autoLoadedForRef.current === key) return;
    autoLoadedForRef.current = key;
    void pickWorkItem(initialWorkItemId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWorkItemId, capability.id]);

  // ── Create new work item from a workflow template ────────────────────
  const createWorkItem = useCallback(
    async (payload: {
      title: string;
      description?: string;
      workflowId: string;
      priority: WorkItem["priority"];
      tags: string[];
    }) => {
      dispatch({ type: "BEGIN_CREATE" });
      try {
        const created = await createCapabilityWorkItem(capability.id, payload);
        await bindStage(created.id);
        success(
          "Work item created",
          `${created.title} is now running through ${payload.workflowId}.`,
        );
        return created;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create work item.";
        dispatch({
          type: "SET_ERROR",
          error: { phase: "create", message, retryable: true },
        });
        toastError("Could not create work item", message);
        return null;
      }
    },
    [bindStage, capability.id, success, toastError],
  );

  // ── Auto-advance pipeline ────────────────────────────────────────────
  const runAdvancePipeline = useCallback(async () => {
    const snapshot = stateRef.current;
    const { workItem, currentStep, agent, messages } = snapshot;
    if (!workItem || !currentStep) return;

    dispatch({ type: "BEGIN_ADVANCE" });
    try {
      // 1. Record the conversation as a stage-control continuation.
      await continueCapabilityWorkItemStageControl(capability.id, workItem.id, {
        agentId: agent?.id,
        conversation: messages.map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
        })),
        carryForwardNote: "Auto-advanced by Workflow Orchestrator.",
      });

      // 2. If HUMAN stage, mark complete.
      if (isHumanStage(currentStep)) {
        const lastAgentMessage = [...messages]
          .reverse()
          .find((entry) => entry.role === "agent");
        await completeCapabilityWorkItemHumanStage(
          capability.id,
          workItem.id,
          currentStep.id,
          {
            resolution:
              lastAgentMessage?.content?.slice(0, 600) ||
              "Stage marked complete via Workflow Orchestrator.",
            resolvedBy: "workflow-orchestrator",
          },
        );
      }

      // 3. Refetch bundle and bind the next stage (or finish).
      await refreshCapabilityBundle(capability.id);
      const refreshed = findWorkItem(workItem.id);
      if (!refreshed || !refreshed.currentStepId) {
        dispatch({ type: "WORKFLOW_DONE" });
        success("Workflow complete", `${workItem.title} reached its terminal stage.`);
        return;
      }
      if (refreshed.currentStepId === currentStep.id) {
        // Server didn't advance (e.g. AGENT stage worker hasn't picked up yet).
        // Treat this as a soft outcome — re-bind the same stage so the user
        // sees up-to-date data and can either wait for the worker or send
        // another message.
        info(
          "Stage hasn't moved yet",
          "The worker is still running. Hold tight or use Pause to take over.",
        );
        await bindStage(refreshed.id, { skipIntro: true });
        return;
      }
      await bindStage(refreshed.id);
      success("Stage advanced", `Now on \"${refreshed.phase}\".`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to advance the stage.";
      dispatch({
        type: "SET_ERROR",
        error: { phase: "advance", message, retryable: true },
      });
      toastError("Stage advance failed", message);
    }
  }, [bindStage, capability.id, findWorkItem, info, refreshCapabilityBundle, success, toastError]);

  // Trigger advance when sentinel detected and auto-advance is on.
  useEffect(() => {
    if (
      state.status === "STAGE_COMPLETE_DETECTED" &&
      state.autoAdvance &&
      state.workItem &&
      state.currentStep
    ) {
      void runAdvancePipeline();
    }
  }, [state.status, state.autoAdvance, state.workItem, state.currentStep, runAdvancePipeline]);

  // ── Send message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (rawContent: string) => {
      const trimmed = stripStageCompleteSentinel(rawContent).trim();
      if (!trimmed) return;
      const snapshot = stateRef.current;
      const { workItem, currentStep, agent, messages, autoAdvance } = snapshot;
      if (!workItem || !currentStep || !agent) {
        toastError(
          "No agent for stage",
          "This stage has no agent assigned, so chat is unavailable.",
        );
        return;
      }
      const requestToken = ++requestRef.current;
      const userMessage: CapabilityChatMessage = {
        id: `${Date.now()}-user`,
        capabilityId: capability.id,
        role: "user",
        content: trimmed,
        timestamp: formatTimestamp(),
        workItemId: workItem.id,
        workflowStepId: currentStep.id,
      };
      dispatch({ type: "BEGIN_STREAM", userMessage, requestToken });

      // First user turn of the stage gets the sentinel instruction prepended
      // so the agent learns the completion contract for this stage.
      const isFirstUserTurn =
        messages.filter((entry) => entry.role === "user").length === 0;
      const messageForLlm = isFirstUserTurn
        ? `${trimmed}\n\n---\nSystem: ${STAGE_COMPLETE_INSTRUCTION}`
        : trimmed;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const result = await streamCapabilityChat(
          {
            capability,
            agent,
            history: messages,
            message: messageForLlm,
            sessionMode: "resume",
            sessionScope: "WORK_ITEM",
            sessionScopeId: workItem.id,
            contextMode: "WORK_ITEM_STAGE",
            workItemId: workItem.id,
            runId: workItem.activeRunId,
            workflowStepId: currentStep.id,
          },
          {
            onEvent: (event) => {
              if (!isMountedRef.current || requestRef.current !== requestToken) return;
              if (event.type === "delta" && event.content) {
                dispatch({ type: "STREAM_DELTA", chunk: event.content, requestToken });
              }
            },
          },
          { signal: controller.signal },
        );

        if (!isMountedRef.current || requestRef.current !== requestToken) return;

        const rawContent = result.completeEvent?.content || result.draftContent;
        if (!rawContent.trim()) {
          throw new Error(
            result.error || "The agent did not return a response.",
          );
        }

        const detection = detectStageComplete(rawContent);
        const isPausedResult = result.termination === "interrupted";
        const agentMessage: CapabilityChatMessage = {
          id: `${Date.now()}-agent`,
          capabilityId: capability.id,
          role: "agent",
          content: isPausedResult
            ? `${detection.cleanedContent}\n\n_(paused)_`
            : detection.cleanedContent,
          timestamp: formatTimestamp(
            new Date(result.completeEvent?.createdAt || Date.now()),
          ),
          agentId: agent.id,
          agentName: agent.name,
          traceId: result.completeEvent?.traceId,
          model: result.completeEvent?.model || agent.model,
          workItemId: workItem.id,
          workflowStepId: currentStep.id,
        };

        // Never auto-advance from a paused stream, even if the sentinel was
        // in the partial draft.
        const shouldSignalComplete =
          detection.detected && !isPausedResult && autoAdvance;

        dispatch({
          type: "STREAM_COMPLETE",
          agentMessage,
          sentinelDetected: shouldSignalComplete,
          requestToken,
        });

        if (result.termination === "recovered") {
          info("Recovered draft", "A partial response was preserved.");
        }
      } catch (err) {
        if (!isMountedRef.current || requestRef.current !== requestToken) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          dispatch({
            type: "STREAM_ABORTED",
            partialMessage: stateRef.current.streamedDraft.trim()
              ? {
                  id: `${Date.now()}-paused`,
                  capabilityId: capability.id,
                  role: "agent",
                  content: `${stripStageCompleteSentinel(stateRef.current.streamedDraft).trim()}\n\n_(paused)_`,
                  timestamp: formatTimestamp(),
                  agentId: agent.id,
                  agentName: agent.name,
                  workItemId: workItem.id,
                  workflowStepId: currentStep.id,
                }
              : null,
            requestToken,
          });
          return;
        }
        const message = err instanceof Error ? err.message : "Stream failed.";
        dispatch({
          type: "SET_ERROR",
          error: { phase: "stream", message, retryable: true },
        });
        toastError("Chat stream failed", message);
      } finally {
        if (requestRef.current === requestToken) {
          abortControllerRef.current = null;
        }
      }
    },
    [capability, info, toastError],
  );

  // ── Pause / resume / manual advance ──────────────────────────────────
  const pause = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    dispatch({ type: "PAUSE" });
  }, []);

  const resume = useCallback(() => {
    dispatch({ type: "RESUME" });
  }, []);

  const markStageDone = useCallback(() => {
    if (!stateRef.current.workItem || !stateRef.current.currentStep) return;
    void runAdvancePipeline();
  }, [runAdvancePipeline]);

  const setAutoAdvance = useCallback((value: boolean) => {
    dispatch({ type: "SET_AUTO_ADVANCE", value });
  }, []);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    dispatch({ type: "RESET" });
  }, []);

  // ── Stable refs for polling callbacks ───────────────────────────────
  // `getCapabilityWorkspace` and `refreshCapabilityBundle` are plain functions
  // inside the context provider (not memoized), so they receive new references
  // on every context update.  Storing them in refs lets the polling interval
  // always call the latest version without adding unstable values to the
  // dependency array — which would cause the interval to be torn down and
  // restarted on every bundle refresh, creating a runaway re-registration loop.
  const bindStageRef = useRef(bindStage);
  bindStageRef.current = bindStage;
  const findWorkItemRef = useRef(findWorkItem);
  findWorkItemRef.current = findWorkItem;
  const refreshCapabilityBundleRef = useRef(refreshCapabilityBundle);
  refreshCapabilityBundleRef.current = refreshCapabilityBundle;

  // ── AGENT-stage polling: detect server-side advancement ─────────────
  useEffect(() => {
    if (
      state.status !== "STAGE_AWAITING_USER" ||
      !state.workItem?.id ||
      !state.currentStep?.id ||
      isHumanStage(state.currentStep)
    ) {
      return;
    }
    // Capture primitive IDs so the interval callback doesn't form a stale
    // closure over the full work-item / step objects.
    const workItemId = state.workItem.id;
    const currentStepId = state.currentStep.id;
    const capId = capability.id;

    const handle = window.setInterval(() => {
      void (async () => {
        try {
          await refreshCapabilityBundleRef.current(capId);
          const refreshed = findWorkItemRef.current(workItemId);
          if (refreshed && !refreshed.currentStepId) {
            dispatch({ type: "WORKFLOW_DONE" });
          } else if (
            refreshed?.currentStepId &&
            refreshed.currentStepId !== currentStepId
          ) {
            await bindStageRef.current(refreshed.id);
          }
        } catch {
          // Silent — polling is best-effort.
        }
      })();
    }, 3000);
    return () => window.clearInterval(handle);
  }, [
    // Only primitive-stable values here — object/function references are
    // accessed via refs (see above) so they don't trigger re-registration.
    state.status,
    state.workItem?.id,
    state.currentStep?.id,
    capability.id,
  ]);

  return {
    state,
    workspace,
    pickWorkItem,
    createWorkItem,
    sendMessage,
    pause,
    resume,
    markStageDone,
    setAutoAdvance,
    reset,
  };
};
