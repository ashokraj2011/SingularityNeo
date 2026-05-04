import { useState } from "react";
import { Loader2, UserPlus, X } from "lucide-react";
import { useToast } from "../../../context/ToastContext";
import {
  reassignBusinessApproval,
  reassignBusinessTask,
} from "../../../lib/api";
import { cn } from "../../../lib/utils";
import {
  AssigneePicker,
  type AssignmentValue,
} from "./components/AssigneePicker";
import type {
  AssignmentMode,
  BusinessApproval,
  BusinessTask,
  TaskStatus,
} from "../../../contracts/businessWorkflow";

/**
 * Reassign a task or approval mid-flight. The dialog is intentionally
 * the same shape for both (different endpoint under the hood) so the
 * operator's mental model stays consistent.
 *
 * Confirms a release-of-claim warning when reassigning a CLAIMED task —
 * this is the part of the workflow that's most "huh, where did my work
 * go" if not flagged.
 */
type Target =
  | { kind: "task"; task: BusinessTask }
  | { kind: "approval"; approval: BusinessApproval };

type Props = {
  open: boolean;
  capabilityId: string;
  target: Target;
  onClose: () => void;
  onReassigned?: () => void;
};

export const ReassignPopover = ({
  open,
  capabilityId,
  target,
  onClose,
  onReassigned,
}: Props) => {
  const { error: toastError, success } = useToast();
  // Seed with the current assignment so the picker reflects "you're
  // changing FROM this".
  const initialMode: AssignmentMode =
    target.kind === "task"
      ? target.task.assignmentMode
      : target.approval.assignedUserId
        ? "DIRECT_USER"
        : target.approval.assignedTeamId
          ? "TEAM_QUEUE"
          : "ROLE_BASED";
  const [value, setValue] = useState<AssignmentValue>(() =>
    target.kind === "task"
      ? {
          mode: target.task.assignmentMode,
          userId: target.task.assignedUserId,
          teamId: target.task.assignedTeamId,
          role: target.task.assignedRole,
          skill: target.task.assignedSkill,
        }
      : {
          mode: initialMode,
          userId: target.approval.assignedUserId,
          teamId: target.approval.assignedTeamId,
          role: target.approval.assignedRole,
        },
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const isClaimedTask =
    target.kind === "task" &&
    (target.task.status as TaskStatus) === "CLAIMED" &&
    Boolean(target.task.claimedBy);

  const handleSubmit = async () => {
    if (
      (value.mode === "DIRECT_USER" && !value.userId) ||
      (value.mode === "TEAM_QUEUE" && !value.teamId) ||
      (value.mode === "ROLE_BASED" && !value.role) ||
      (value.mode === "SKILL_BASED" && !value.skill?.trim())
    ) {
      toastError("Pick an assignee", "Choose who should own the work next.");
      return;
    }
    if (
      isClaimedTask &&
      !confirm(
        `Reassigning will release ${
          (target as { task: BusinessTask }).task.claimedBy
        }'s claim. Continue?`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      if (target.kind === "task") {
        await reassignBusinessTask(capabilityId, target.task.id, {
          assignmentMode: value.mode,
          assignedUserId: value.userId,
          assignedTeamId: value.teamId,
          assignedRole: value.role,
          assignedSkill: value.skill,
          reason: reason.trim() || undefined,
        });
      } else {
        await reassignBusinessApproval(capabilityId, target.approval.id, {
          assignedUserId: value.userId,
          assignedTeamId: value.teamId,
          assignedRole: value.role,
          reason: reason.trim() || undefined,
        });
      }
      success("Reassigned", "The new assignee has been notified.");
      onReassigned?.();
      onClose();
    } catch (err) {
      toastError(
        "Reassign failed",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-[1] flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-3">
          <div className="min-w-0">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              Reassign
            </p>
            <h2 className="truncate text-sm font-semibold text-on-surface">
              {target.kind === "task"
                ? target.task.title
                : `Approval at ${target.approval.nodeId}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant/40 p-1.5 text-secondary hover:text-primary"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {isClaimedTask && (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[0.7rem] text-amber-800">
              ⚠ This task is currently claimed by{" "}
              <strong>{(target as { task: BusinessTask }).task.claimedBy}</strong>.
              Reassigning releases their claim.
            </div>
          )}
          <AssigneePicker
            value={value}
            onChange={setValue}
            allowedModes={
              target.kind === "approval"
                ? ["DIRECT_USER", "TEAM_QUEUE", "ROLE_BASED"]
                : ["DIRECT_USER", "TEAM_QUEUE", "ROLE_BASED", "SKILL_BASED"]
            }
          />
          <label className="mt-4 block text-xs">
            <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              Reason (optional)
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='e.g. "out of office"'
              className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
            />
          </label>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-outline-variant/30 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground",
              submitting && "opacity-60 cursor-not-allowed",
            )}
          >
            {submitting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <UserPlus size={12} />
            )}
            Reassign
          </button>
        </footer>
      </div>
    </div>
  );
};
