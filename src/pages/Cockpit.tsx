/**
 * Work Item Cockpit
 *
 * One governed delivery cockpit: pick a work item and see every agent action,
 * artifact, wait, approval, and human instruction in one frame.
 *
 * Layout:
 *   ┌─ Header ──────────────────────────────────────────────────────┐
 *   │ Left Rail │ Center: Unified Timeline  │ Right: Decision Panel │
 *   └─ Command Bar ─────────────────────────────────────────────────┘
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, Layers, Plus, Sparkles } from "lucide-react";
import { useCapability } from "../context/CapabilityContext";
import { WorkflowApprovalGate } from "./workflowOrchestrator/WorkflowApprovalGate";
import { CockpitHeader } from "./cockpit/CockpitHeader";
import { CockpitLeftRail } from "./cockpit/CockpitLeftRail";
import { CockpitTimeline } from "./cockpit/CockpitTimeline";
import { CockpitRightPanel } from "./cockpit/CockpitRightPanel";
import { CockpitCommandBar } from "./cockpit/CockpitCommandBar";
import { useCockpitState } from "./cockpit/useCockpitState";
import type { WorkItem } from "../types";

// ── Component ─────────────────────────────────────────────────────────────────

const Cockpit = () => {
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const [searchParams, setSearchParams] = useSearchParams();

  // Snapshot URL params once at mount to avoid auto-load loops
  const mountParamsRef = useRef(searchParams);
  const initialWorkItemId =
    mountParamsRef.current.get("workItemId") || undefined;

  const {
    state,
    workspace,
    dispatch,
    loadWorkItem,
    refreshRun,
    sendMessage,
    stopStream,
    resolveBlock,
    sendGuidance,
  } = useCockpitState(activeCapability);

  const [showPicker, setShowPicker] = useState(false);

  // Auto-load if URL has workItemId
  const autoLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialWorkItemId) return;
    const key = `${activeCapability.id}::${initialWorkItemId}`;
    if (autoLoadedRef.current === key) return;
    autoLoadedRef.current = key;
    void loadWorkItem(initialWorkItemId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWorkItemId, activeCapability.id]);

  // Sync URL
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (state.workItem) {
      next.set("workItemId", state.workItem.id);
    } else {
      next.delete("workItemId");
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workItem?.id]);

  const handlePickWorkItem = useCallback(
    (id: string) => {
      setShowPicker(false);
      void loadWorkItem(id);
    },
    [loadWorkItem],
  );

  const handleSend = useCallback(
    (message: string) => {
      void sendMessage(message);
    },
    [sendMessage],
  );

  const handleCommand = useCallback(
    (cmd: string) => {
      if (cmd === "/refresh") void refreshRun();
    },
    [refreshRun],
  );

  const handleApprovalResolved = useCallback(async () => {
    dispatch({ type: "SET_APPROVAL_GATE", open: false });
    if (state.workItem) await loadWorkItem(state.workItem.id);
  }, [dispatch, loadWorkItem, state.workItem]);

  const isBlocked =
    state.workItem?.status === "BLOCKED" ||
    Boolean(state.workItem?.pendingRequest?.type);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <CockpitHeader
        capabilityName={activeCapability.name}
        workItem={state.workItem}
        workflow={state.workflow}
        currentStep={state.currentStep}
        runDetail={state.runDetail}
        gitWorkspace={state.gitWorkspace}
        status={state.status}
        onRefresh={() => state.workItem && void loadWorkItem(state.workItem.id)}
      />

      {/* ── Work item picker bar (always visible when no work item) ───── */}
      {!state.workItem || showPicker ? (
        <div className="relative flex shrink-0 items-center gap-3 border-b border-outline-variant/30 bg-surface-container px-5 py-2.5">
          <Layers size={14} className="text-secondary" />
          <span className="text-xs text-secondary">
            {state.workItem ? "Switch work item" : "No work item selected"}
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/50 bg-surface-container-low px-3 py-1.5 text-xs text-primary hover:bg-surface-container"
            >
              {state.workItem ? state.workItem.title : "Pick work item"}
              <ChevronDown size={12} />
            </button>
            {showPicker && (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-80 overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container-high shadow-xl">
                {workspace.workItems.length === 0 ? (
                  <p className="p-3 text-xs text-secondary">
                    No work items in this capability.
                  </p>
                ) : (
                  workspace.workItems.map((wi) => (
                    <button
                      key={wi.id}
                      type="button"
                      onClick={() => handlePickWorkItem(wi.id)}
                      className="flex w-full flex-col gap-0.5 border-b border-outline-variant/20 px-3 py-2.5 text-left text-xs hover:bg-primary/10"
                    >
                      <span className="font-semibold text-primary">
                        {wi.title}
                      </span>
                      <span className="text-[0.65rem] text-outline">
                        {wi.id} · {wi.phase} · {wi.status}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {state.workItem && (
            <button
              type="button"
              onClick={() => setShowPicker(false)}
              className="ml-auto text-[0.7rem] text-secondary hover:text-primary"
            >
              Close picker
            </button>
          )}
        </div>
      ) : (
        /* Compact "switch" button when a work item is active */
        <div className="flex shrink-0 items-center gap-2 border-b border-outline-variant/30 bg-surface-container px-5 py-1.5">
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center gap-1 text-[0.7rem] text-secondary hover:text-primary"
          >
            <ChevronDown size={11} />
            {state.workItem?.id}
          </button>
        </div>
      )}

      {/* ── 3-column body ─────────────────────────────────────────────── */}
      {state.workItem ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left rail */}
          <CockpitLeftRail
            workItem={state.workItem}
            workflow={state.workflow}
            currentStep={state.currentStep}
            runDetail={state.runDetail}
            ledgerArtifacts={state.ledgerArtifacts}
          />

          {/* Center timeline */}
          <CockpitTimeline
            runDetail={state.runDetail}
            ledgerArtifacts={state.ledgerArtifacts}
            messages={state.messages}
            streamedDraft={state.streamedDraft}
            isStreaming={state.status === "STREAMING"}
            filter={state.timelineFilter}
            workItemId={state.workItem.id}
            onFilterChange={(f) =>
              dispatch({ type: "SET_TIMELINE_FILTER", filter: f })
            }
            onSelectArtifact={(id) =>
              dispatch({ type: "SELECT_ARTIFACT", artifactId: id })
            }
            onOpenApproval={() =>
              dispatch({ type: "SET_APPROVAL_GATE", open: true })
            }
          />

          {/* Right decision panel */}
          <CockpitRightPanel
            mode={state.rightPanelMode}
            workItem={state.workItem}
            currentStep={state.currentStep}
            agent={state.agent}
            runDetail={state.runDetail}
            ledgerArtifacts={state.ledgerArtifacts}
            selectedArtifactId={state.selectedArtifactId}
            gitWorkspace={state.gitWorkspace}
            isSubmitting={state.status === "SUBMITTING"}
            onModeChange={(m) =>
              dispatch({ type: "SET_RIGHT_PANEL", mode: m })
            }
            onSelectArtifact={(id) =>
              dispatch({ type: "SELECT_ARTIFACT", artifactId: id })
            }
            onOpenApproval={() =>
              dispatch({ type: "SET_APPROVAL_GATE", open: true })
            }
            onResolveBlock={resolveBlock}
            onSendGuidance={sendGuidance}
          />
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
          <Sparkles size={40} className="text-primary opacity-30" />
          <div>
            <h2 className="text-lg font-semibold text-primary">
              Work Item Cockpit
            </h2>
            <p className="mt-2 max-w-sm text-sm text-secondary">
              One governed delivery cockpit. Pick a work item above to see every
              agent action, artifact, approval, and human instruction in one
              place.
            </p>
          </div>
        </div>
      )}

      {/* ── Bottom command bar ─────────────────────────────────────────── */}
      <CockpitCommandBar
        status={state.status}
        hasWorkItem={Boolean(state.workItem)}
        onSend={handleSend}
        onCommand={handleCommand}
        onPanelSwitch={(m) => dispatch({ type: "SET_RIGHT_PANEL", mode: m })}
      />

      {/* ── Approval gate modal ────────────────────────────────────────── */}
      {state.showApprovalGate && state.workItem?.activeRunId ? (
        <WorkflowApprovalGate
          capabilityId={activeCapability.id}
          workItemId={state.workItem.id}
          runId={state.workItem.activeRunId}
          workItemTitle={state.workItem.title}
          onClose={() => dispatch({ type: "SET_APPROVAL_GATE", open: false })}
          onResolved={() => void handleApprovalResolved()}
        />
      ) : null}
    </div>
  );
};

export default Cockpit;
