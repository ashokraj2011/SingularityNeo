import { useState } from "react";
import { Loader2, PlusCircle, X } from "lucide-react";
import { useToast } from "../../../context/ToastContext";
import { createBusinessAdHocTask } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import {
  AssigneePicker,
  type AssignmentValue,
} from "./components/AssigneePicker";
import type { TaskPriority } from "../../../contracts/businessWorkflow";

const PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

/**
 * Inject an unplanned task onto a running (or paused) instance.
 *
 * `blocking=true` pauses the planned graph until the operator
 * completes the side errand — useful for "manager wants a quick
 * approval first" interruptions. Non-blocking ad-hoc tasks just
 * appear alongside the planned graph in the dashboard's ad-hoc panel.
 */
type Props = {
  open: boolean;
  capabilityId: string;
  instanceId: string;
  parentTaskId?: string;
  onClose: () => void;
  onCreated?: () => void;
};

export const AdHocTaskDialog = ({
  open,
  capabilityId,
  instanceId,
  parentTaskId,
  onClose,
  onCreated,
}: Props) => {
  const { error: toastError, success } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignment, setAssignment] = useState<AssignmentValue>({
    mode: "DIRECT_USER",
  });
  const [priority, setPriority] = useState<TaskPriority>("NORMAL");
  const [dueAt, setDueAt] = useState<string>("");
  const [blocking, setBlocking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!title.trim()) {
      toastError("Missing title", "What should the assignee do?");
      return;
    }
    if (
      (assignment.mode === "DIRECT_USER" && !assignment.userId) ||
      (assignment.mode === "TEAM_QUEUE" && !assignment.teamId) ||
      (assignment.mode === "ROLE_BASED" && !assignment.role) ||
      (assignment.mode === "SKILL_BASED" && !assignment.skill?.trim())
    ) {
      toastError("Pick an assignee", "Choose who should own this task.");
      return;
    }
    setSubmitting(true);
    try {
      await createBusinessAdHocTask(capabilityId, instanceId, {
        title: title.trim(),
        description: description.trim() || undefined,
        assignment: {
          mode: assignment.mode,
          userId: assignment.userId,
          teamId: assignment.teamId,
          role: assignment.role,
          skill: assignment.skill,
        },
        priority,
        dueAt: dueAt || undefined,
        blocking,
        parentTaskId,
      });
      success(
        blocking ? "Ad-hoc task created — instance paused" : "Ad-hoc task created",
        title.trim(),
      );
      onCreated?.();
      onClose();
    } catch (err) {
      toastError(
        "Could not create ad-hoc task",
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
      <div className="relative z-[1] flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-3">
          <div className="min-w-0">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              + Ad-hoc task
            </p>
            <h2 className="truncate text-sm font-semibold text-on-surface">
              Inject unplanned work
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
          <div className="flex flex-col gap-3">
            <label className="block text-xs">
              <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                Title
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder='e.g. "Confirm vendor PO before approval"'
                className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                Description (optional)
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full resize-y rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
              />
            </label>

            <div>
              <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                Assign to
              </p>
              <AssigneePicker value={assignment} onChange={setAssignment} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                  Priority
                </p>
                <div className="flex gap-1">
                  {PRIORITIES.map((p) => {
                    const selected = priority === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        className={cn(
                          "flex-1 rounded-lg border px-1.5 py-1 text-[0.62rem] font-semibold",
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-outline-variant/40 bg-white text-on-surface hover:bg-surface-container",
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="block text-xs">
                <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                  Due at (optional)
                </span>
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 text-xs"
                />
              </label>
            </div>

            <label className="flex items-start gap-2 rounded-lg border border-outline-variant/40 bg-surface-container p-2.5 text-xs">
              <input
                type="checkbox"
                checked={blocking}
                onChange={(e) => setBlocking(e.target.checked)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  Pause the instance until this is done
                </span>
                <span className="block text-[0.62rem] text-outline">
                  Blocking tasks pause the planned graph on creation and
                  auto-resume on completion. Use for "must finish first"
                  interruptions; leave off for parallel side-work.
                </span>
              </span>
            </label>
          </div>
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
              <PlusCircle size={12} />
            )}
            Create task
          </button>
        </footer>
      </div>
    </div>
  );
};
