import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  completeCapabilityWorkflowRunHumanTask,
  continueCapabilityWorkItemStageControl,
  fetchCapabilityWorkflowRun,
  fetchCapabilityWorkflowRunEvents,
  fetchLedgerArtifacts,
  getWorkItemGitWorkspaceStatus,
  initWorkItemGitWorkspace,
  provideCapabilityWorkflowRunInput,
  resolveCapabilityWorkflowRunConflict,
  streamCapabilityChat,
  type WorkItemGitWorkspaceInitResult,
} from "../../lib/api";
import { useCapability } from "../../context/CapabilityContext";
import { useToast } from "../../context/ToastContext";
import type {
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  LedgerArtifactRecord,
  RunEvent,
  WorkItem,
  Workflow,
  WorkflowRunDetail,
  WorkflowStep,
} from "../../types";
import {
  type CockpitStatus,
  type RightPanelMode,
  type TimelineFilter,
} from "./types";

// ── State ─────────────────────────────────────────────────────────────────────

interface CockpitState {
  status: CockpitStatus;
  workItem: WorkItem | null;
  workflow: Workflow | null;
  currentStep: WorkflowStep | null;
  agent: CapabilityAgent | null;
  runDetail: WorkflowRunDetail | null;
  runEvents: RunEvent[];
  ledgerArtifacts: LedgerArtifactRecord[];
  gitWorkspace: WorkItemGitWorkspaceInitResult | null;

  // Chat
  messages: CapabilityChatMessage[];
  streamedDraft: string;
  requestToken: number;

  // UI
  timelineFilter: TimelineFilter;
  rightPanelMode: RightPanelMode;
  selectedArtifactId: string | null;
  showApprovalGate: boolean;
  error: string | null;
}

const initialState: CockpitState = {
  status: "IDLE",
  workItem: null,
  workflow: null,
  currentStep: null,
  agent: null,
  runDetail: null,
  runEvents: [],
  ledgerArtifacts: [],
  gitWorkspace: null,
  messages: [],
  streamedDraft: "",
  requestToken: 0,
  timelineFilter: "ALL",
  rightPanelMode: "NOW",
  selectedArtifactId: null,
  showApprovalGate: false,
  error: null,
};

// ── Actions ───────────────────────────────────────────────────────────────────

type CockpitAction =
  | { type: "RESET" }
  | { type: "BEGIN_LOAD" }
  | {
      type: "LOADED";
      workItem: WorkItem;
      workflow: Workflow | null;
      currentStep: WorkflowStep | null;
      agent: CapabilityAgent | null;
      runDetail: WorkflowRunDetail | null;
      runEvents: RunEvent[];
      ledgerArtifacts: LedgerArtifactRecord[];
    }
  | {
      type: "RUN_REFRESHED";
      workItem: WorkItem;
      runDetail: WorkflowRunDetail;
      runEvents: RunEvent[];
    }
  | { type: "SET_GIT_WORKSPACE"; gitWorkspace: WorkItemGitWorkspaceInitResult | null }
  | {
      type: "BEGIN_STREAM";
      userMessage: CapabilityChatMessage;
      requestToken: number;
    }
  | { type: "STREAM_DELTA"; chunk: string; requestToken: number }
  | {
      type: "STREAM_COMPLETE";
      agentMessage: CapabilityChatMessage;
      requestToken: number;
    }
  | {
      type: "STREAM_ABORTED";
      partialMessage: CapabilityChatMessage | null;
      requestToken: number;
    }
  | { type: "BEGIN_SUBMIT" }
  | { type: "SUBMIT_DONE"; workItem?: WorkItem }
  | { type: "SET_TIMELINE_FILTER"; filter: TimelineFilter }
  | { type: "SET_RIGHT_PANEL"; mode: RightPanelMode }
  | { type: "SELECT_ARTIFACT"; artifactId: string | null }
  | { type: "SET_APPROVAL_GATE"; open: boolean }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" };

// ── Reducer ───────────────────────────────────────────────────────────────────

const reducer = (state: CockpitState, action: CockpitAction): CockpitState => {
  switch (action.type) {
    case "RESET":
      return { ...initialState };
    case "BEGIN_LOAD":
      return { ...state, status: "LOADING", error: null };
    case "LOADED":
      return {
        ...state,
        status: "READY",
        workItem: action.workItem,
        workflow: action.workflow,
        currentStep: action.currentStep,
        agent: action.agent,
        runDetail: action.runDetail,
        runEvents: action.runEvents,
        ledgerArtifacts: action.ledgerArtifacts,
        messages: [],
        streamedDraft: "",
        error: null,
      };
    case "RUN_REFRESHED":
      return {
        ...state,
        workItem: action.workItem,
        runDetail: action.runDetail,
        runEvents: action.runEvents,
      };
    case "SET_GIT_WORKSPACE":
      return { ...state, gitWorkspace: action.gitWorkspace };
    case "BEGIN_STREAM":
      return {
        ...state,
        status: "STREAMING",
        messages: [...state.messages, action.userMessage],
        streamedDraft: "",
        requestToken: action.requestToken,
        error: null,
      };
    case "STREAM_DELTA":
      if (state.requestToken !== action.requestToken) return state;
      return { ...state, streamedDraft: state.streamedDraft + action.chunk };
    case "STREAM_COMPLETE":
      if (state.requestToken !== action.requestToken) return state;
      return {
        ...state,
        status: "READY",
        messages: [...state.messages, action.agentMessage],
        streamedDraft: "",
      };
    case "STREAM_ABORTED":
      if (state.requestToken !== action.requestToken) return state;
      return {
        ...state,
        status: "READY",
        messages: action.partialMessage
          ? [...state.messages, action.partialMessage]
          : state.messages,
        streamedDraft: "",
      };
    case "BEGIN_SUBMIT":
      return { ...state, status: "SUBMITTING", error: null };
    case "SUBMIT_DONE":
      return {
        ...state,
        status: "READY",
        workItem: action.workItem ?? state.workItem,
      };
    case "SET_TIMELINE_FILTER":
      return { ...state, timelineFilter: action.filter };
    case "SET_RIGHT_PANEL":
      return { ...state, rightPanelMode: action.mode };
    case "SELECT_ARTIFACT":
      return {
        ...state,
        selectedArtifactId: action.artifactId,
        rightPanelMode: action.artifactId ? "ARTIFACT" : state.rightPanelMode,
      };
    case "SET_APPROVAL_GATE":
      return { ...state, showApprovalGate: action.open };
    case "SET_ERROR":
      return { ...state, status: "ERROR", error: action.error };
    case "CLEAR_ERROR":
      return { ...state, error: null, status: state.status === "ERROR" ? "READY" : state.status };
    default:
      return state;
  }
};

// ── Hook ──────────────────────────────────────────────────────────────────────

/** Returns an ISO-8601 timestamp for timeline sort compatibility. */
const isoNow = () => new Date().toISOString();
/** Returns a human-readable time label for display. */
const formatTimestamp = (d = new Date()) =>
  d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const useCockpitState = (capability: Capability) => {
  const { getCapabilityWorkspace, refreshCapabilityBundle } = useCapability();
  const { error: toastError, success, info } = useToast();

  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  // ── Workspace helpers ─────────────────────────────────────────────────────

  const workspace = useMemo(
    () => getCapabilityWorkspace(capability.id),
    [capability.id, getCapabilityWorkspace],
  );

  const findWorkItem = useCallback(
    (id: string): WorkItem | null => {
      const ws = getCapabilityWorkspace(capability.id);
      return ws.workItems.find((w) => w.id === id) ?? null;
    },
    [capability.id, getCapabilityWorkspace],
  );

  const findWorkflow = useCallback(
    (id: string): Workflow | null => {
      const ws = getCapabilityWorkspace(capability.id);
      return ws.workflows.find((w) => w.id === id) ?? null;
    },
    [capability.id, getCapabilityWorkspace],
  );

  const findAgent = useCallback(
    (agentId?: string): CapabilityAgent | null => {
      if (!agentId) return null;
      const ws = getCapabilityWorkspace(capability.id);
      return ws.agents.find((a) => a.id === agentId) ?? null;
    },
    [capability.id, getCapabilityWorkspace],
  );

  // ── Load work item ────────────────────────────────────────────────────────

  const loadWorkItem = useCallback(
    async (workItemId: string) => {
      dispatch({ type: "BEGIN_LOAD" });
      try {
        await refreshCapabilityBundle(capability.id);
        const workItem = findWorkItem(workItemId);
        if (!workItem) throw new Error(`Work item ${workItemId} not found.`);

        const workflow = findWorkflow(workItem.workflowId);
        const currentStep = workflow?.steps.find(
          (s) => s.id === workItem.currentStepId,
        ) ?? workflow?.steps.find((s) => s.phase === workItem.phase) ?? null;
        const agent = findAgent(currentStep?.agentId);

        let runDetail: WorkflowRunDetail | null = null;
        let runEvents: RunEvent[] = [];
        if (workItem.activeRunId) {
          try {
            [runDetail, runEvents] = await Promise.all([
              fetchCapabilityWorkflowRun(capability.id, workItem.activeRunId),
              fetchCapabilityWorkflowRunEvents(capability.id, workItem.activeRunId),
            ]);
          } catch {
            // run detail is optional — cockpit still works without it
          }
        }

        const allRecords = await fetchLedgerArtifacts(capability.id).catch(() => []);
        const ledgerArtifacts = allRecords.filter(
          (r) => r.artifact.workItemId === workItemId,
        );

        if (!isMountedRef.current) return;
        dispatch({
          type: "LOADED",
          workItem,
          workflow: workflow ?? null,
          currentStep,
          agent,
          runDetail,
          runEvents,
          ledgerArtifacts,
        });

        // Git workspace — fire and forget
        initWorkItemGitWorkspace(capability.id, workItemId)
          .then((ws) => {
            if (isMountedRef.current)
              dispatch({ type: "SET_GIT_WORKSPACE", gitWorkspace: ws });
          })
          .catch(() => {
            // try status endpoint as fallback
            getWorkItemGitWorkspaceStatus(capability.id, workItemId)
              .then((s) => {
                if (isMountedRef.current && s.exists && s.workspacePath) {
                  dispatch({
                    type: "SET_GIT_WORKSPACE",
                    gitWorkspace: {
                      workspacePath: s.workspacePath,
                      branchName: s.branchName ?? "",
                      created: false,
                      source: "existing",
                    },
                  });
                }
              })
              .catch(() => undefined);
          });
      } catch (err) {
        if (!isMountedRef.current) return;
        dispatch({
          type: "SET_ERROR",
          error: err instanceof Error ? err.message : "Failed to load work item.",
        });
      }
    },
    [
      capability.id,
      findAgent,
      findWorkItem,
      findWorkflow,
      refreshCapabilityBundle,
    ],
  );

  // ── Refresh run (polling) ─────────────────────────────────────────────────

  const refreshRun = useCallback(async () => {
    const snap = stateRef.current;
    const runId = snap.workItem?.activeRunId;
    const workItemId = snap.workItem?.id;
    if (!runId || !workItemId) return;
    try {
      await refreshCapabilityBundle(capability.id);
      const workItem = findWorkItem(workItemId);
      if (!workItem) return;
      const [runDetail, runEvents] = await Promise.all([
        fetchCapabilityWorkflowRun(capability.id, runId),
        fetchCapabilityWorkflowRunEvents(capability.id, runId),
      ]);
      if (isMountedRef.current) {
        dispatch({ type: "RUN_REFRESHED", workItem, runDetail, runEvents });
      }
    } catch {
      // silent — polling is best-effort
    }
  }, [capability.id, findWorkItem, refreshCapabilityBundle]);

  // Poll every 8s while a run is active
  useEffect(() => {
    if (
      state.status !== "READY" ||
      !state.workItem?.activeRunId
    )
      return;
    const handle = window.setInterval(() => void refreshRun(), 8000);
    return () => window.clearInterval(handle);
  }, [state.status, state.workItem?.activeRunId, refreshRun]);

  // ── Send message (chat) ───────────────────────────────────────────────────

  const sendMessage = useCallback(
    async (rawContent: string) => {
      const trimmed = rawContent.trim();
      if (!trimmed) return;
      const snap = stateRef.current;
      const { workItem, currentStep, agent, messages } = snap;
      if (!workItem || !agent) {
        toastError("No agent", "This stage has no agent assigned.");
        return;
      }

      const requestToken = ++requestRef.current;
      const userMsg: CapabilityChatMessage = {
        id: `${Date.now()}-user`,
        capabilityId: capability.id,
        role: "user",
        content: trimmed,
        // ISO timestamp so timeline sort against run events is correct
        timestamp: isoNow(),
        workItemId: workItem.id,
        workflowStepId: currentStep?.id,
      };
      dispatch({ type: "BEGIN_STREAM", userMessage: userMsg, requestToken });

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const result = await streamCapabilityChat(
          {
            capability,
            agent,
            history: messages,
            message: trimmed,
            sessionMode: "resume",
            sessionScope: "WORK_ITEM",
            sessionScopeId: workItem.id,
            contextMode: "WORK_ITEM_STAGE",
            workItemId: workItem.id,
            runId: workItem.activeRunId,
            workflowStepId: currentStep?.id,
          },
          {
            onEvent: (ev) => {
              if (!isMountedRef.current || requestRef.current !== requestToken)
                return;
              if (ev.type === "delta" && ev.content)
                dispatch({
                  type: "STREAM_DELTA",
                  chunk: ev.content,
                  requestToken,
                });
            },
          },
          { signal: controller.signal },
        );

        if (!isMountedRef.current || requestRef.current !== requestToken)
          return;

        // Surface server-side errors that didn't throw (e.g. model quota, policy block)
        const rawContent = result.completeEvent?.content || result.draftContent;
        if (!rawContent?.trim()) {
          throw new Error(result.error || "The agent did not return a response. Check the run logs or try again.");
        }

        const isInterrupted = result.termination === "interrupted";
        const agentMsg: CapabilityChatMessage = {
          id: `${Date.now()}-agent`,
          capabilityId: capability.id,
          role: "agent",
          content: isInterrupted
            ? `${rawContent.trim()}\n\n_(paused)_`
            : rawContent.trim(),
          timestamp: isoNow(),
          agentId: agent.id,
          agentName: agent.name,
          workItemId: workItem.id,
          workflowStepId: currentStep?.id,
        };
        dispatch({ type: "STREAM_COMPLETE", agentMessage: agentMsg, requestToken });

        if (result.termination === "recovered") {
          info("Recovered draft", "A partial response was preserved.");
        }
      } catch (err) {
        if (!isMountedRef.current || requestRef.current !== requestToken)
          return;
        if (err instanceof DOMException && err.name === "AbortError") {
          const partial = stateRef.current.streamedDraft.trim();
          dispatch({
            type: "STREAM_ABORTED",
            partialMessage: partial
              ? {
                  id: `${Date.now()}-paused`,
                  capabilityId: capability.id,
                  role: "agent",
                  content: `${partial}\n\n_(paused)_`,
                  timestamp: isoNow(),
                  agentId: agent.id,
                  agentName: agent.name,
                  workItemId: workItem.id,
                }
              : null,
            requestToken,
          });
          return;
        }
        const errMsg = err instanceof Error ? err.message : "Chat stream failed.";
        dispatch({ type: "SET_ERROR", error: errMsg });
        toastError("Chat failed", errMsg);
      }
    },
    [capability, info, toastError],
  );

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  // ── Resolve block (input / conflict / task) ───────────────────────────────

  const resolveBlock = useCallback(
    async (resolution: string) => {
      const snap = stateRef.current;
      const { workItem } = snap;
      if (!workItem?.activeRunId) {
        toastError("Cannot resolve", "No active run.");
        return;
      }
      const blockType =
        workItem.blocker?.type || workItem.pendingRequest?.type;
      if (!blockType) return;
      dispatch({ type: "BEGIN_SUBMIT" });
      try {
        const payload = { resolution, resolvedBy: "cockpit-operator" };
        if (blockType === "HUMAN_INPUT" || blockType === "INPUT") {
          await provideCapabilityWorkflowRunInput(
            capability.id,
            workItem.activeRunId,
            payload,
          );
        } else if (blockType === "CONFLICT_RESOLUTION") {
          await resolveCapabilityWorkflowRunConflict(
            capability.id,
            workItem.activeRunId,
            payload,
          );
        } else if (blockType === "HUMAN_TASK") {
          await completeCapabilityWorkflowRunHumanTask(
            capability.id,
            workItem.activeRunId,
            payload,
          );
        }
        success("Resolved", "The work item is now unblocked.");
        dispatch({ type: "SUBMIT_DONE" });
        void loadWorkItem(workItem.id);
      } catch (err) {
        dispatch({ type: "SET_ERROR", error: err instanceof Error ? err.message : "Failed." });
        toastError("Failed to resolve", err instanceof Error ? err.message : "");
      }
    },
    [capability.id, loadWorkItem, success, toastError],
  );

  // ── Send guidance (recorded as stage-control note) ────────────────────────

  const sendGuidance = useCallback(
    async (instruction: string) => {
      const snap = stateRef.current;
      const { workItem, currentStep, agent, messages } = snap;
      if (!workItem) return;
      dispatch({ type: "BEGIN_SUBMIT" });
      try {
        await continueCapabilityWorkItemStageControl(capability.id, workItem.id, {
          agentId: agent?.id,
          conversation: messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          })),
          carryForwardNote: instruction,
        });
        info("Guidance sent", "The agent will receive your instructions on the next step.");
        dispatch({ type: "SUBMIT_DONE" });
      } catch (err) {
        dispatch({ type: "SET_ERROR", error: err instanceof Error ? err.message : "Failed." });
        toastError("Guidance failed", err instanceof Error ? err.message : "");
      }
    },
    [capability.id, info, toastError],
  );

  // ── Stable refs for polling ───────────────────────────────────────────────
  const refreshRunRef = useRef(refreshRun);
  refreshRunRef.current = refreshRun;

  return {
    state,
    workspace,
    dispatch,
    loadWorkItem,
    refreshRun,
    sendMessage,
    stopStream,
    resolveBlock,
    sendGuidance,
  };
};
