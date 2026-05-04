/**
 * WorkflowApprovalGate
 *
 * Self-contained component that:
 * 1. Fetches the active run → locates the open APPROVAL wait
 * 2. Fetches the full ApprovalWorkspaceContext (artifacts, assignments, decisions, feed)
 * 3. Renders OrchestratorApprovalReviewModal with all props wired
 * 4. Handles approve / request-changes; calls onResolved() after either.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  approveCapabilityWorkflowRun,
  fetchApprovalWorkspaceContext,
  fetchCapabilityWorkflowRun,
  requestCapabilityWorkflowRunChanges,
} from "../../lib/api";
import { OrchestratorApprovalReviewModal } from "../../components/orchestrator/OrchestratorApprovalReviewModal";
import {
  getArtifactDocumentBody,
  matchesArtifactWorkbenchFilter,
  type Artifact,
  type ApprovalAssignment,
  type ApprovalDecision,
  type ArtifactWorkbenchFilter,
  type RunWait,
} from "../../lib/orchestrator/support";
import type { ApprovalWorkspaceContext, CapabilityInteractionFeed } from "../../types";
import { useToast } from "../../context/ToastContext";

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  capabilityId: string;
  /** ID of the work item being approved. */
  workItemId: string;
  /** The active run ID (workItem.activeRunId). */
  runId: string;
  workItemTitle: string;
  onClose: () => void;
  /** Called once the approval decision is recorded (approve or request-changes). */
  onResolved: () => void;
};

// ── Empty-feed sentinel for the loading state ─────────────────────────────────

const buildEmptyFeed = (capabilityId: string): CapabilityInteractionFeed => ({
  capabilityId,
  scope: "WORK_ITEM",
  generatedAt: new Date().toISOString(),
  records: [],
  summary: {
    totalCount: 0,
    chatCount: 0,
    toolCount: 0,
    waitCount: 0,
    approvalCount: 0,
    learningCount: 0,
    artifactCount: 0,
    taskCount: 0,
  },
});

// ── Component ─────────────────────────────────────────────────────────────────

export const WorkflowApprovalGate = ({
  capabilityId,
  workItemId,
  runId,
  workItemTitle,
  onClose,
  onResolved,
}: Props) => {
  const { error: toastError, success } = useToast();
  const isMountedRef = useRef(true);

  // ── Fetch state ───────────────────────────────────────────────────────────
  const [approvalContext, setApprovalContext] =
    useState<ApprovalWorkspaceContext | null>(null);
  const [approvalWait, setApprovalWait] = useState<RunWait | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [artifactFilter, setArtifactFilter] =
    useState<ArtifactWorkbenchFilter>("ALL");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    null,
  );
  const [resolutionNote, setResolutionNote] = useState("");
  const [busyAction, setBusyAction] = useState<
    "resolve" | "requestChanges" | null
  >(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ── Load: run detail → open approval wait → approval workspace context ────
  useEffect(() => {
    const load = async () => {
      try {
        // Step 1: get run waits
        const runDetail = await fetchCapabilityWorkflowRun(capabilityId, runId);
        if (!isMountedRef.current) return;

        const openWait = runDetail.waits.find(
          (w) => w.type === "APPROVAL" && w.status === "OPEN",
        );
        if (!openWait) {
          setLoadError(
            "No open approval wait found for this run. It may have already been resolved.",
          );
          return;
        }
        setApprovalWait(openWait);

        // Step 2: full approval workspace context (artifacts, decisions, feed …)
        const ctx = await fetchApprovalWorkspaceContext(
          capabilityId,
          runId,
          openWait.id,
        );
        if (!isMountedRef.current) return;

        setApprovalContext(ctx);
        setIsHydrated(true);
      } catch (err) {
        if (!isMountedRef.current) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : "Failed to load approval context.",
        );
      }
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilityId, runId]);

  // ── Derived data ──────────────────────────────────────────────────────────

  const artifacts: Artifact[] = approvalContext?.artifacts ?? [];

  const filteredArtifacts = useMemo(
    () => artifacts.filter((a) => matchesArtifactWorkbenchFilter(a, artifactFilter)),
    [artifacts, artifactFilter],
  );

  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === selectedArtifactId) ?? null,
    [artifacts, selectedArtifactId],
  );

  const selectedArtifactDocument = useMemo(
    () => getArtifactDocumentBody(selectedArtifact),
    [selectedArtifact],
  );

  // Map decisions to assignments; collect unlinked ones separately.
  const { approvalAssignments, approvalDecisionByAssignmentId, unassignedApprovalDecisions } =
    useMemo(() => {
      const assignments: ApprovalAssignment[] =
        approvalWait?.approvalAssignments ?? [];
      const allDecisions: ApprovalDecision[] =
        approvalWait?.approvalDecisions ?? [];

      const assignmentIdSet = new Set(assignments.map((a) => a.id));
      const byId = new Map<string, ApprovalDecision>();
      const unassigned: ApprovalDecision[] = [];

      for (const d of allDecisions) {
        if (d.assignmentId && assignmentIdSet.has(d.assignmentId)) {
          byId.set(d.assignmentId, d);
        } else {
          unassigned.push(d);
        }
      }
      return {
        approvalAssignments: assignments,
        approvalDecisionByAssignmentId: byId,
        unassignedApprovalDecisions: unassigned,
      };
    }, [approvalWait]);

  const hasCodeDiffApproval = artifacts.some(
    (a) => a.artifactKind === "CODE_DIFF",
  );

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleApprove = useCallback(async () => {
    if (!approvalWait || busyAction) return;
    setBusyAction("resolve");
    try {
      await approveCapabilityWorkflowRun(capabilityId, runId, {
        resolution:
          resolutionNote.trim() || "Approved via Workflow Orchestrator.",
        resolvedBy: "You",
      });
      success(
        "Approval submitted",
        "The workflow will continue to the next stage.",
      );
      onResolved();
    } catch (err) {
      toastError(
        "Approval failed",
        err instanceof Error ? err.message : "Could not submit approval.",
      );
    } finally {
      if (isMountedRef.current) setBusyAction(null);
    }
  }, [
    approvalWait,
    busyAction,
    capabilityId,
    runId,
    resolutionNote,
    success,
    toastError,
    onResolved,
  ]);

  const handleRequestChanges = useCallback(async () => {
    if (!approvalWait || busyAction) return;
    setBusyAction("requestChanges");
    try {
      await requestCapabilityWorkflowRunChanges(capabilityId, runId, {
        resolution:
          resolutionNote.trim() ||
          "Changes requested via Workflow Orchestrator.",
        resolvedBy: "You",
      });
      success(
        "Changes requested",
        "The agent has been notified and will rework the submission.",
      );
      onResolved();
    } catch (err) {
      toastError(
        "Request failed",
        err instanceof Error ? err.message : "Could not request changes.",
      );
    } finally {
      if (isMountedRef.current) setBusyAction(null);
    }
  }, [
    approvalWait,
    busyAction,
    capabilityId,
    runId,
    resolutionNote,
    success,
    toastError,
    onResolved,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Error state
  if (loadError) {
    return (
      <div className="desktop-content-modal-overlay z-[91] px-4 py-10">
        <button
          type="button"
          onClick={onClose}
          className="desktop-content-modal-backdrop"
        />
        <div className="relative z-[1] mx-auto max-w-md rounded-2xl border border-rose-500/30 bg-surface-container-high p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-primary">
              Approval gate error
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-secondary hover:text-primary"
            >
              <X size={16} />
            </button>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-rose-600 dark:text-rose-400">
            {loadError}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs text-secondary hover:bg-surface-container-low"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Loading state (before wait is found)
  if (!approvalWait) {
    return (
      <div className="desktop-content-modal-overlay z-[91] px-4 py-10">
        <button
          type="button"
          onClick={onClose}
          className="desktop-content-modal-backdrop"
        />
        <div className="relative z-[1] mx-auto max-w-xs rounded-2xl border border-outline-variant/30 bg-surface-container-high p-6 text-center shadow-xl">
          <Loader2
            size={22}
            className="mx-auto animate-spin text-primary"
          />
          <p className="mt-3 text-sm text-secondary">
            Loading approval context&hellip;
          </p>
        </div>
      </div>
    );
  }

  // Full approval review modal
  return (
    <OrchestratorApprovalReviewModal
      workItemTitle={workItemTitle}
      approvalWait={approvalWait}
      isHydrated={isHydrated}
      onClose={onClose}
      currentPhaseLabel={approvalContext?.currentPhaseLabel ?? ""}
      currentStepName={approvalContext?.currentStepName ?? ""}
      currentRunId={runId}
      requestedByLabel={
        approvalContext?.requestedByLabel ?? approvalWait.requestedBy
      }
      requestedAt={approvalContext?.requestedAt ?? approvalWait.createdAt}
      totalDocuments={artifacts.length}
      hasCodeDiffApproval={hasCodeDiffApproval}
      approvalAssignments={approvalAssignments}
      approvalDecisionByAssignmentId={approvalDecisionByAssignmentId}
      unassignedApprovalDecisions={unassignedApprovalDecisions}
      // Users/teams are looked up for display names; empty maps degrade
      // gracefully — the target type + ID is shown instead.
      workspaceUsersById={new Map()}
      workspaceTeamsById={new Map()}
      interactionFeed={
        approvalContext?.interactionFeed ?? buildEmptyFeed(capabilityId)
      }
      onOpenArtifactFromTimeline={(id) => setSelectedArtifactId(id)}
      onOpenRunFromTimeline={() => undefined}
      onOpenTaskFromTimeline={() => undefined}
      filteredApprovalArtifacts={filteredArtifacts}
      approvalArtifactFilter={artifactFilter}
      onApprovalArtifactFilterChange={setArtifactFilter}
      selectedApprovalArtifact={selectedArtifact}
      selectedApprovalArtifactDocument={selectedArtifactDocument}
      onSelectApprovalArtifact={setSelectedArtifactId}
      resolutionNote={resolutionNote}
      onResolutionNoteChange={setResolutionNote}
      resolutionPlaceholder="Enter your approval rationale, sign-off conditions, or review notes…"
      requestChangesIsAvailable
      canRequestChanges={!busyAction}
      canResolveSelectedWait={!busyAction}
      busyAction={busyAction}
      onRequestChanges={() => void handleRequestChanges()}
      onResolveWait={() => void handleApprove()}
      actionButtonLabel="Approve"
      onOpenDiffReview={() => undefined}
      resetKey={`${workItemId}:${approvalWait.id}:${selectedArtifactId ?? "none"}`}
      approvalPolicy={undefined}
    />
  );
};
