import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Flag,
  Hand,
  Loader2,
  RotateCcw,
  ShieldCheck,
  UserPlus,
  XCircle,
} from "lucide-react";
import {
  claimBusinessTask,
  completeBusinessTask,
  decideBusinessApproval,
} from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useToast } from "../../../context/ToastContext";
import { SlaChip } from "./components/SlaChip";
import { PriorityBadge } from "./components/PriorityBadge";
import { DocumentsCountChip } from "./components/DocumentsCountChip";
import { ReassignPopover } from "./ReassignPopover";
import { SendBackPanel } from "./SendBackPanel";
import { TaskCompletionDialog } from "./TaskCompletionDialog";
import type {
  ApprovalStatus,
  BusinessApproval,
  BusinessNode,
  BusinessTask,
  BusinessWorkflowEvent,
} from "../../../contracts/businessWorkflow";

/**
 * Right-rail panel that lists every OPEN task and PENDING approval
 * the operator can act on RIGHT NOW.
 *
 * Per row: title, SLA chip, priority, who-it's-assigned-to, plus the
 * action buttons (Claim / Complete / Send-back / Reassign or
 * Approve / Reject / Send-back / Reassign for approvals).
 *
 * We DON'T render a full form for each — completing a task with a
 * complex form schema is best done in a dedicated dialog. For V2 the
 * Complete button submits an empty payload; if the task has a
 * formSchema and the operator wants to fill it, they can click into
 * the inbox where the existing form-fill UI handles it. (Wiring a
 * form modal HERE too is a polish item we left for V2.1.)
 */
type Props = {
  capabilityId: string;
  /** Tasks belonging to THIS instance — caller filters. */
  tasks: BusinessTask[];
  /** Approvals belonging to THIS instance — caller filters. */
  approvals: BusinessApproval[];
  templateNodes: readonly BusinessNode[];
  events: readonly BusinessWorkflowEvent[];
  onChanged?: () => void;
  className?: string;
};

export const ActiveTasksPanel = ({
  capabilityId,
  tasks,
  approvals,
  templateNodes,
  events,
  onChanged,
  className,
}: Props) => {
  const { error: toastError, success } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState<
    | { kind: "task"; task: BusinessTask }
    | { kind: "approval"; approval: BusinessApproval }
    | null
  >(null);
  const [sendBackTarget, setSendBackTarget] = useState<
    | { kind: "task"; task: BusinessTask }
    | { kind: "approval"; approval: BusinessApproval }
    | null
  >(null);
  const [completeTarget, setCompleteTarget] = useState<BusinessTask | null>(
    null,
  );

  // Open tasks first (acting), then claimed, then ad-hoc — operator's
  // attention should land on the row that needs them right now.
  const sortedTasks = useMemo(() => {
    const order: Record<string, number> = {
      OPEN: 0,
      CLAIMED: 1,
      IN_PROGRESS: 2,
      SENT_BACK: 3,
      COMPLETED: 4,
      CANCELLED: 5,
    };
    return [...tasks]
      .filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED")
      .sort((a, b) => (order[a.status] || 0) - (order[b.status] || 0));
  }, [tasks]);

  const pendingApprovals = useMemo(
    () => approvals.filter((a) => a.status === "PENDING"),
    [approvals],
  );

  const handleClaim = async (task: BusinessTask) => {
    setBusyId(task.id);
    try {
      await claimBusinessTask(capabilityId, task.id);
      success("Claimed", task.title);
      onChanged?.();
    } catch (err) {
      toastError(
        "Claim failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleComplete = async (task: BusinessTask) => {
    // Tasks with a formSchema or sent-back history open the dialog so
    // the operator can fill the form (or edit a prior submission).
    // Schemaless tasks complete in one click — no friction for trivial
    // nodes.
    if (task.formSchema || task.sentBackFromNodeId) {
      setCompleteTarget(task);
      return;
    }
    setBusyId(task.id);
    try {
      await completeBusinessTask(capabilityId, task.id, {});
      success("Completed", task.title);
      onChanged?.();
    } catch (err) {
      toastError(
        "Complete failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDecide = async (
    approval: BusinessApproval,
    decision: ApprovalStatus,
  ) => {
    setBusyId(approval.id);
    try {
      await decideBusinessApproval(capabilityId, approval.id, { decision });
      success(
        "Decided",
        `${decision} on approval at ${approval.nodeId}`,
      );
      onChanged?.();
    } catch (err) {
      toastError(
        "Decide failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setBusyId(null);
    }
  };

  const total = sortedTasks.length + pendingApprovals.length;
  if (total === 0) {
    return (
      <div className={cn("p-3 text-center text-[0.7rem] text-outline", className)}>
        Nothing active right now. Tasks and approvals will appear here as
        the workflow advances.
      </div>
    );
  }

  return (
    <>
      <div className={cn("flex flex-col gap-1.5", className)}>
        {sortedTasks.map((task) => {
          const busy = busyId === task.id;
          return (
            <div
              key={task.id}
              className={cn(
                "rounded-lg border bg-white p-2",
                task.isAdHoc
                  ? "border-pink-300 bg-pink-50/40"
                  : "border-outline-variant/40",
              )}
            >
              <div className="flex items-start gap-1.5">
                <Hand size={12} className="mt-0.5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.7rem] font-semibold text-on-surface">
                    {task.title}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <SlaChip dueAt={task.dueAt} size="xs" />
                    <PriorityBadge
                      priority={task.priority}
                      size="xs"
                      withLabel={false}
                    />
                    <DocumentsCountChip count={task.documentsCount} />
                    {task.isAdHoc && (
                      <span className="rounded-full bg-pink-100 px-1.5 py-0.5 text-[0.55rem] font-semibold text-pink-700 ring-1 ring-pink-300">
                        ad-hoc
                        {task.adHocBlocking ? " · blocking" : ""}
                      </span>
                    )}
                    {task.sentBackFromNodeId && (
                      <span
                        className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[0.55rem] font-semibold text-amber-800 ring-1 ring-amber-300"
                        title={`Sent back from ${task.sentBackFromNodeId}: ${task.sentBackReason || ""}`}
                      >
                        sent back
                      </span>
                    )}
                    {task.claimedBy && (
                      <span className="text-[0.6rem] text-outline">
                        claimed by <strong>{task.claimedBy}</strong>
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {task.status === "OPEN" && (
                      <button
                        type="button"
                        onClick={() => void handleClaim(task)}
                        disabled={busy}
                        className="inline-flex items-center gap-0.5 rounded border border-outline-variant/40 bg-white px-1.5 py-0.5 text-[0.6rem] font-semibold hover:bg-surface-container disabled:opacity-60"
                      >
                        {busy ? (
                          <Loader2 size={9} className="animate-spin" />
                        ) : (
                          <Flag size={9} />
                        )}
                        Claim
                      </button>
                    )}
                    {(task.status === "CLAIMED" ||
                      task.status === "IN_PROGRESS" ||
                      task.status === "OPEN") && (
                      <button
                        type="button"
                        onClick={() => void handleComplete(task)}
                        disabled={busy}
                        className="inline-flex items-center gap-0.5 rounded bg-primary px-1.5 py-0.5 text-[0.6rem] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                      >
                        {busy ? (
                          <Loader2 size={9} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={9} />
                        )}
                        Complete
                      </button>
                    )}
                    {!task.isAdHoc && (
                      <button
                        type="button"
                        onClick={() =>
                          setSendBackTarget({ kind: "task", task })
                        }
                        className="inline-flex items-center gap-0.5 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[0.6rem] font-semibold text-amber-800 hover:bg-amber-100"
                      >
                        <RotateCcw size={9} /> Send back
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setReassignTarget({ kind: "task", task })}
                      className="inline-flex items-center gap-0.5 rounded border border-outline-variant/40 bg-white px-1.5 py-0.5 text-[0.6rem] font-semibold hover:bg-surface-container"
                    >
                      <UserPlus size={9} /> Reassign
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {pendingApprovals.map((approval) => {
          const busy = busyId === approval.id;
          return (
            <div
              key={approval.id}
              className="rounded-lg border border-indigo-300 bg-indigo-50/40 p-2"
            >
              <div className="flex items-start gap-1.5">
                <ShieldCheck
                  size={12}
                  className="mt-0.5 shrink-0 text-indigo-600"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.7rem] font-semibold text-on-surface">
                    Approval at <span className="font-mono">{approval.nodeId}</span>
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <SlaChip dueAt={approval.dueAt} size="xs" />
                    {approval.assignedUserId && (
                      <span className="text-[0.6rem] text-outline">
                        → user {approval.assignedUserId}
                      </span>
                    )}
                    {approval.assignedTeamId && (
                      <span className="text-[0.6rem] text-outline">
                        → team {approval.assignedTeamId}
                      </span>
                    )}
                    {approval.assignedRole && (
                      <span className="text-[0.6rem] text-outline">
                        → role {approval.assignedRole}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => void handleDecide(approval, "APPROVED")}
                      disabled={busy}
                      className="inline-flex items-center gap-0.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[0.6rem] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {busy ? (
                        <Loader2 size={9} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={9} />
                      )}
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDecide(approval, "REJECTED")}
                      disabled={busy}
                      className="inline-flex items-center gap-0.5 rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[0.6rem] font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      <XCircle size={9} /> Reject
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSendBackTarget({ kind: "approval", approval })
                      }
                      className="inline-flex items-center gap-0.5 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[0.6rem] font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      <RotateCcw size={9} /> Send back
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setReassignTarget({ kind: "approval", approval })
                      }
                      className="inline-flex items-center gap-0.5 rounded border border-outline-variant/40 bg-white px-1.5 py-0.5 text-[0.6rem] font-semibold hover:bg-surface-container"
                    >
                      <UserPlus size={9} /> Reassign
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {reassignTarget && (
        <ReassignPopover
          open
          capabilityId={capabilityId}
          target={reassignTarget}
          onClose={() => setReassignTarget(null)}
          onReassigned={() => {
            setReassignTarget(null);
            onChanged?.();
          }}
        />
      )}
      {sendBackTarget && (
        <SendBackPanel
          open
          capabilityId={capabilityId}
          target={sendBackTarget}
          templateNodes={templateNodes}
          events={events}
          onClose={() => setSendBackTarget(null)}
          onSent={() => {
            setSendBackTarget(null);
            onChanged?.();
          }}
        />
      )}
      {completeTarget && (
        <TaskCompletionDialog
          open
          capabilityId={capabilityId}
          task={completeTarget}
          onClose={() => setCompleteTarget(null)}
          onCompleted={() => {
            setCompleteTarget(null);
            onChanged?.();
          }}
        />
      )}
    </>
  );
};
