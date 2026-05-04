import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Hand,
  Loader2,
  Paperclip,
  X,
} from "lucide-react";
import { useToast } from "../../../context/ToastContext";
import {
  claimBusinessTask,
  completeBusinessTask,
  fetchBusinessInstance,
} from "../../../lib/api";
import { interpretFormSchema } from "../../../lib/businessFormSchema";
import { cn } from "../../../lib/utils";
import { SlaChip } from "./components/SlaChip";
import { PriorityBadge } from "./components/PriorityBadge";
import { StructuredFormFieldInput } from "./components/StructuredFormFieldInput";
import type {
  BusinessDocument,
  BusinessTask,
  TaskPriority,
} from "../../../contracts/businessWorkflow";

/**
 * Modal that wraps task completion. The dashboard's right-rail and
 * the inbox both opened to a "Complete" button that submitted an
 * empty payload — fine for trivial nodes, broken for any HUMAN_TASK
 * with a real `formSchema`. This dialog is the form.
 *
 * Behaviours:
 *   - If the task isn't claimed yet, a "Claim & complete" path is
 *     offered (single click claims first, then completes).
 *   - If `task.formSchema` parses as STRUCTURED via
 *     `interpretFormSchema`, we render a real form. Submit validates
 *     required fields client-side, applies defaults, posts as
 *     `formData` (and as `output` so output bindings into the
 *     instance context still work — the engine looks at output, not
 *     formData, when applying bindings).
 *   - If schema is RAW or absent, we expose a JSON textarea so the
 *     operator can submit arbitrary structure without being blocked.
 *   - Documents attached to the instance show as a read-only side
 *     section so the assignee has the full context they need to
 *     complete the work.
 *
 * Polling is intentionally absent — when this dialog is open, the
 * operator is mid-action; refreshing the dashboard's polling cycle
 * will pick up the result on close.
 */

type Props = {
  open: boolean;
  capabilityId: string;
  task: BusinessTask;
  onClose: () => void;
  onCompleted?: () => void;
};

export const TaskCompletionDialog = ({
  open,
  capabilityId,
  task,
  onClose,
  onCompleted,
}: Props) => {
  const { error: toastError, success } = useToast();
  const interp = useMemo(
    () => interpretFormSchema(task.formSchema),
    [task.formSchema],
  );
  const [structured, setStructured] = useState<Record<string, string>>(() => {
    // Seed with whatever formData is already on the task (e.g. a
    // SENT_BACK task carries the previous submission so the operator
    // can edit instead of retype) PLUS schema defaults.
    const seed: Record<string, string> = {};
    if (interp.kind === "structured") {
      for (const f of interp.fields) {
        const prior = (task.formData as Record<string, unknown> | undefined)?.[
          f.key
        ];
        seed[f.key] =
          typeof prior === "string"
            ? prior
            : prior != null
              ? JSON.stringify(prior)
              : f.defaultValue || "";
      }
    }
    return seed;
  });
  const [rawJson, setRawJson] = useState(() => {
    if (interp.kind === "raw" && task.formData) {
      try {
        return JSON.stringify(task.formData, null, 2);
      } catch {
        return "{}";
      }
    }
    return "{}";
  });

  /** Documents attached to the instance — fetched lazily on open so
   *  we don't pay the cost when the dialog never appears. */
  const [docs, setDocs] = useState<BusinessDocument[] | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingDocs(true);
    fetchBusinessInstance(capabilityId, task.instanceId)
      .then((data) => {
        if (cancelled) return;
        const raw = (data.instance.context as Record<string, unknown>)
          ?.__documents;
        setDocs(Array.isArray(raw) ? (raw as BusinessDocument[]) : []);
      })
      .catch(() => {
        if (!cancelled) setDocs([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDocs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, capabilityId, task.instanceId]);

  if (!open) return null;

  const claimed = task.status === "CLAIMED" || task.status === "IN_PROGRESS";
  const needsClaim = task.status === "OPEN";

  const validateAndBuild = (): Record<string, unknown> | null => {
    if (interp.kind === "structured") {
      const out: Record<string, unknown> = {};
      const missing: string[] = [];
      for (const f of interp.fields) {
        const v = structured[f.key];
        const final = v != null && v !== "" ? v : f.defaultValue || "";
        if (f.required && !final) missing.push(f.label);
        out[f.key] = final;
      }
      if (missing.length > 0) {
        toastError(
          "Missing required field" + (missing.length === 1 ? "" : "s"),
          missing.join(" · "),
        );
        return null;
      }
      return out;
    }
    try {
      const parsed = rawJson.trim() ? JSON.parse(rawJson) : {};
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("JSON must be an object.");
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      toastError(
        "Invalid JSON",
        err instanceof Error ? err.message : "Could not parse",
      );
      return null;
    }
  };

  const submit = async (alsoClaim: boolean) => {
    const payload = validateAndBuild();
    if (!payload) return;
    setSubmitting(true);
    try {
      if (alsoClaim) {
        await claimBusinessTask(capabilityId, task.id);
      }
      await completeBusinessTask(capabilityId, task.id, {
        formData: payload,
        // Pass payload as output too — output bindings on the node
        // read from `output`, not `formData`, when copying values into
        // the instance context. Sending both means structured fields
        // become referenceable as both `task.formData.foo` and
        // `bound.foo` depending on the binding's source.
        output: payload,
      });
      success("Completed", task.title);
      onCompleted?.();
      onClose();
    } catch (err) {
      toastError(
        "Could not complete",
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
      <div className="relative z-[1] flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              Complete task
            </p>
            <h2 className="truncate text-base font-semibold text-on-surface">
              {task.title}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <SlaChip dueAt={task.dueAt} size="xs" />
              <PriorityBadge
                priority={task.priority as TaskPriority}
                size="xs"
              />
              {task.claimedBy && (
                <span className="text-[0.6rem] text-outline">
                  claimed by <strong>{task.claimedBy}</strong>
                </span>
              )}
              {task.sentBackFromNodeId && (
                <span
                  className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[0.55rem] font-semibold text-amber-800 ring-1 ring-amber-300"
                  title={task.sentBackReason || ""}
                >
                  sent back
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant/40 p-1.5 text-secondary hover:text-primary"
          >
            <X size={14} />
          </button>
        </header>

        {/* Body — two columns: form on the left, attachments on the right */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
            {task.description && (
              <p className="rounded-lg bg-surface-container p-2 text-[0.7rem] text-on-surface">
                {task.description}
              </p>
            )}

            {task.sentBackFromNodeId && task.sentBackReason && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[0.7rem] text-amber-900">
                <p className="font-semibold">Sent back · reason:</p>
                <p className="mt-0.5">{task.sentBackReason}</p>
              </div>
            )}

            {interp.kind === "structured" ? (
              <div className="flex flex-col gap-2.5">
                {interp.fields.map((f) => (
                  <label key={f.key} className="block text-xs">
                    <span className="mb-1 flex items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                      {f.label}
                      {f.required && (
                        <span className="text-rose-600" title="Required">
                          *
                        </span>
                      )}
                    </span>
                    <StructuredFormFieldInput
                      field={f}
                      value={structured[f.key] ?? ""}
                      onChange={(next) =>
                        setStructured((prev) => ({
                          ...prev,
                          [f.key]: next,
                        }))
                      }
                    />
                    {f.helpText && (
                      <p className="mt-0.5 text-[0.6rem] text-outline">
                        {f.helpText}
                      </p>
                    )}
                    <p className="mt-0.5 font-mono text-[0.55rem] text-outline">
                      formData.{f.key}
                    </p>
                  </label>
                ))}
              </div>
            ) : (
              <label className="block text-xs">
                <span className="mb-1 block text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                  Form data (JSON)
                </span>
                <textarea
                  value={rawJson}
                  onChange={(e) => setRawJson(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="w-full resize-y rounded-lg border border-outline-variant/40 bg-white px-2 py-1.5 font-mono text-[0.7rem]"
                />
                <p className="mt-0.5 text-[0.6rem] text-outline">
                  This task has no structured schema. Submit any object
                  shape you like — it'll be stored as the task's
                  formData and surfaced via output bindings.
                </p>
              </label>
            )}
          </div>

          {/* Attached docs side panel */}
          <aside className="flex w-64 shrink-0 flex-col border-l border-outline-variant/30 bg-surface-container-low">
            <div className="border-b border-outline-variant/30 px-3 py-2">
              <p className="inline-flex items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
                <Paperclip size={10} /> Attached
              </p>
              <p className="text-[0.6rem] text-outline">
                Documents on this instance — read these to inform the
                form.
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loadingDocs ? (
                <div className="flex items-center gap-1 text-[0.65rem] text-secondary">
                  <Loader2 size={10} className="animate-spin" />
                  Loading…
                </div>
              ) : !docs || docs.length === 0 ? (
                <p className="rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-2 text-center text-[0.6rem] text-outline">
                  No documents attached.
                </p>
              ) : (
                <ul className="space-y-1">
                  {docs.map((d) => (
                    <li
                      key={d.id}
                      className="rounded-lg border border-outline-variant/30 bg-white p-1.5"
                    >
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[0.65rem] font-semibold text-primary hover:underline"
                      >
                        <span className="truncate">{d.name}</span>
                        <ExternalLink size={9} className="shrink-0 opacity-70" />
                      </a>
                      {d.description && (
                        <p className="mt-0.5 text-[0.55rem] text-outline">
                          {d.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 border-t border-outline-variant/30 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant/40 px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
          {needsClaim && (
            <button
              type="button"
              onClick={() => void submit(true)}
              disabled={submitting}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10",
                submitting && "opacity-60 cursor-not-allowed",
              )}
            >
              {submitting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Hand size={12} />
              )}
              Claim &amp; complete
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit(false)}
            disabled={submitting || (needsClaim && !claimed)}
            title={
              needsClaim && !claimed
                ? "Claim the task first (or use Claim & complete)"
                : "Mark task complete"
            }
            className={cn(
              "inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90",
              (submitting || (needsClaim && !claimed)) &&
                "cursor-not-allowed opacity-60",
            )}
          >
            {submitting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CheckCircle2 size={12} />
            )}
            Complete
          </button>
        </footer>
      </div>
    </div>
  );
};
