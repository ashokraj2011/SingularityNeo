import { useMemo, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { useToast } from "../../../context/ToastContext";
import {
  sendBackBusinessApproval,
  sendBackBusinessTask,
} from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { sendBackCandidates } from "../../../lib/businessWorkflowRuntime";
import type {
  BusinessApproval,
  BusinessNode,
  BusinessTask,
  BusinessWorkflowEvent,
} from "../../../contracts/businessWorkflow";

/**
 * Pick a previously-completed node to bounce work back to.
 *
 * The candidate list is computed from the events log (so loops show
 * their LAST completion timestamp), filtered against the pinned
 * version's node list, with START / END excluded. Order is
 * chronological — closest in time at the top — because that matches
 * what the operator usually wants ("redo the last step", "redo the
 * step before that").
 *
 * On submit, the original task/approval flips to SENT_BACK /
 * NEEDS_MORE_INFORMATION and a fresh task is activated at the chosen
 * target node — inheriting THAT node's formSchema/SLA/assignment.
 */
type Target =
  | { kind: "task"; task: BusinessTask }
  | { kind: "approval"; approval: BusinessApproval };

type Props = {
  open: boolean;
  capabilityId: string;
  target: Target;
  /** Pinned version's nodes — used to label candidates and to filter
   *  out START/END. */
  templateNodes: readonly BusinessNode[];
  events: readonly BusinessWorkflowEvent[];
  onClose: () => void;
  onSent?: () => void;
};

export const SendBackPanel = ({
  open,
  capabilityId,
  target,
  templateNodes,
  events,
  onClose,
  onSent,
}: Props) => {
  const { error: toastError, success } = useToast();
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const candidates = useMemo(
    () => sendBackCandidates(events, templateNodes),
    [events, templateNodes],
  );

  if (!open) return null;

  const handleSubmit = async () => {
    if (!targetNodeId) {
      toastError(
        "Pick a node",
        "Click the previous step you want to send this back to.",
      );
      return;
    }
    if (!reason.trim()) {
      toastError(
        "Reason required",
        "Tell the next person why this is being bounced.",
      );
      return;
    }
    setSubmitting(true);
    try {
      if (target.kind === "task") {
        await sendBackBusinessTask(capabilityId, target.task.id, {
          targetNodeId,
          reason: reason.trim(),
        });
      } else {
        await sendBackBusinessApproval(capabilityId, target.approval.id, {
          targetNodeId,
          reason: reason.trim(),
        });
      }
      success(
        "Sent back",
        `A new task has been created at ${
          candidates.find((c) => c.nodeId === targetNodeId)?.label ||
          targetNodeId
        }.`,
      );
      onSent?.();
      onClose();
    } catch (err) {
      toastError(
        "Send-back failed",
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
      <div className="relative z-[1] flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-3">
          <div className="min-w-0">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-amber-700">
              Send back
            </p>
            <h2 className="truncate text-sm font-semibold text-on-surface">
              Bounce {target.kind === "task" ? "task" : "approval"} to a
              previous node
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
          <p className="mb-3 text-[0.7rem] text-outline">
            A fresh task will be created at the target node, inheriting that
            node's form schema, assignment, and SLA. The current{" "}
            {target.kind} stays in the audit trail with status{" "}
            <code>{target.kind === "task" ? "SENT_BACK" : "NEEDS_MORE_INFORMATION"}</code>.
          </p>

          {candidates.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-4 text-center text-[0.7rem] text-outline">
              No previously-completed nodes to send back to. (Send-back is
              only meaningful after at least one node has finished.)
            </div>
          ) : (
            <div>
              <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                Target node
              </p>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-outline-variant/30 bg-white p-1.5">
                {candidates
                  .slice()
                  .reverse() // most recent first
                  .map((c) => {
                    const selected = targetNodeId === c.nodeId;
                    return (
                      <li key={c.nodeId}>
                        <button
                          type="button"
                          onClick={() => setTargetNodeId(c.nodeId)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.7rem]",
                            selected
                              ? "bg-amber-100 text-amber-900 ring-1 ring-amber-400"
                              : "hover:bg-surface-container",
                          )}
                        >
                          <RotateCcw
                            size={11}
                            className={cn(
                              "shrink-0",
                              selected ? "text-amber-700" : "text-outline",
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">
                              {c.label}
                            </span>
                            <span className="block text-[0.6rem] text-outline">
                              completed{" "}
                              {new Date(c.completedAt).toLocaleString()}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}

          <label className="mt-3 block text-xs">
            <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              Reason
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder='e.g. "DOB on form is wrong, please confirm and re-submit"'
              className="w-full resize-y rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
            />
            <p className="mt-0.5 text-[0.6rem] text-outline">
              The reason is recorded on the audit trail and shown to the
              new assignee.
            </p>
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
            disabled={submitting || candidates.length === 0}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700",
              (submitting || candidates.length === 0) &&
                "opacity-60 cursor-not-allowed",
            )}
          >
            {submitting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RotateCcw size={12} />
            )}
            Send back
          </button>
        </footer>
      </div>
    </div>
  );
};
