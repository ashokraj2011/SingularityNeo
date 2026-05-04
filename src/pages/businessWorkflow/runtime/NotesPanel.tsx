import { useMemo, useState } from "react";
import { Loader2, Send, StickyNote } from "lucide-react";
import { addBusinessInstanceNote } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { useToast } from "../../../context/ToastContext";
import type { BusinessWorkflowEvent } from "../../../contracts/businessWorkflow";

/**
 * Threaded notes view + composer.
 *
 * Notes are not a separate table — they're INSTANCE_NOTE_ADDED events
 * with a `body` payload. We filter the instance event log for those
 * and render newest-last so the conversation reads top-to-bottom.
 */
type Props = {
  capabilityId: string;
  instanceId: string;
  events: readonly BusinessWorkflowEvent[];
  onAdded?: () => void;
  className?: string;
};

export const NotesPanel = ({
  capabilityId,
  instanceId,
  events,
  onAdded,
  className,
}: Props) => {
  const { error: toastError } = useToast();
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const notes = useMemo(
    () =>
      events
        .filter((e) => e.eventType === "INSTANCE_NOTE_ADDED")
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    [events],
  );

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setSubmitting(true);
    try {
      await addBusinessInstanceNote(capabilityId, instanceId, { note: body });
      setDraft("");
      onAdded?.();
    } catch (err) {
      toastError(
        "Could not add note",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {notes.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-outline-variant/40 bg-surface-container p-3 text-center">
          <StickyNote size={14} className="text-outline" />
          <p className="text-[0.7rem] text-outline">
            No notes yet. Drop context here so the next operator knows
            what's going on.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-outline-variant/30 bg-white p-2"
            >
              <div className="mb-0.5 flex items-center justify-between text-[0.6rem]">
                <strong className="text-on-surface">
                  {n.actorId || "Unknown"}
                </strong>
                <span className="text-outline">
                  {new Date(n.occurredAt).toLocaleString()}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[0.75rem] text-on-surface">
                {String((n.payload as { body?: string }).body || "")}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1.5 rounded-lg border border-outline-variant/40 bg-white p-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter submits — fast for power users.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder="Add a note… (Cmd+Enter to send)"
          className="min-w-0 flex-1 resize-none border-0 bg-transparent text-[0.7rem] outline-none"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !draft.trim()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90",
            (submitting || !draft.trim()) && "opacity-50 cursor-not-allowed",
          )}
        >
          {submitting ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Send size={11} />
          )}
        </button>
      </div>
    </div>
  );
};
