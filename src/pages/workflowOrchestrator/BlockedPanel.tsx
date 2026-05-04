import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { WorkItemBlocker, WorkItemPendingRequest } from "../../types";

type BlockedPanelProps = {
  blocker: WorkItemBlocker | undefined;
  pendingRequest: WorkItemPendingRequest | undefined;
  /** Called when user submits a resolution note (non-approval blocks only). */
  onSubmit: (resolution: string) => Promise<void>;
  /** Called when user clicks "Review & Approve" on APPROVAL blocks. */
  onOpenApproval: () => void;
  isSubmitting: boolean;
};

const BLOCK_META: Record<
  string,
  { label: string; cta: string; placeholder: string }
> = {
  HUMAN_INPUT: {
    label: "Waiting for human input",
    cta: "Submit input",
    placeholder:
      "Provide the requested input or additional context so the agent can continue…",
  },
  INPUT: {
    label: "Waiting for input",
    cta: "Submit input",
    placeholder: "Provide the requested input to continue…",
  },
  CONFLICT_RESOLUTION: {
    label: "Waiting for conflict resolution",
    cta: "Resolve conflict",
    placeholder:
      "Describe how to resolve the conflict — what decision should the workflow follow?",
  },
  HUMAN_TASK: {
    label: "Waiting for delegated task completion",
    cta: "Mark task done",
    placeholder:
      "Describe what was done, the outcome, and any notes the next agent needs…",
  },
  APPROVAL: {
    label: "Waiting for approval",
    cta: "Review & Approve",
    placeholder: "",
  },
  SUB_WORKFLOW_WAIT: {
    label: "Waiting for sub-workflow",
    cta: "Provide update",
    placeholder: "Provide an update to let the sub-workflow continue…",
  },
};

export const BlockedPanel = ({
  blocker,
  pendingRequest,
  onSubmit,
  onOpenApproval,
  isSubmitting,
}: BlockedPanelProps) => {
  const [resolution, setResolution] = useState("");

  const effectiveType =
    blocker?.type || pendingRequest?.type || "HUMAN_INPUT";
  const effectiveMessage =
    blocker?.message ||
    pendingRequest?.message ||
    "This work item is blocked and requires your attention.";
  const effectiveRequestedBy =
    blocker?.requestedBy || pendingRequest?.requestedBy;
  const effectiveTimestamp =
    blocker?.timestamp || pendingRequest?.timestamp;

  const isApproval = effectiveType === "APPROVAL";
  const meta = BLOCK_META[effectiveType] ?? BLOCK_META["HUMAN_INPUT"];

  const handleSubmit = async () => {
    if (!resolution.trim() || isSubmitting) return;
    await onSubmit(resolution.trim());
    setResolution("");
  };

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <AlertTriangle
          size={15}
          className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {meta.label}
            </span>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide text-amber-700 dark:text-amber-300">
              {effectiveType.replace(/_/g, " ")}
            </span>
          </div>

          <p className="mt-1.5 text-sm leading-relaxed text-amber-900/90 dark:text-amber-100/80">
            {effectiveMessage}
          </p>

          {effectiveRequestedBy ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-700/70 dark:text-amber-300/60">
              <Clock size={10} />
              Requested by{" "}
              <strong className="font-medium">{effectiveRequestedBy}</strong>
              {effectiveTimestamp
                ? ` · ${new Date(effectiveTimestamp).toLocaleString()}`
                : ""}
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Action area ────────────────────────────────────────────────── */}
      <div className="mt-4">
        {isApproval ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onOpenApproval}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 active:bg-amber-800"
            >
              <ShieldCheck size={14} />
              Review &amp; Approve
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder={meta.placeholder}
              rows={3}
              className={cn(
                "w-full resize-none rounded-lg border border-amber-500/30 bg-white/70 px-3 py-2 text-sm text-primary placeholder-secondary/50 focus:border-amber-500 focus:outline-none dark:bg-black/20",
                isSubmitting && "cursor-not-allowed opacity-60",
              )}
              disabled={isSubmitting}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!resolution.trim() || isSubmitting}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700",
                  (!resolution.trim() || isSubmitting) &&
                    "cursor-not-allowed opacity-60",
                )}
              >
                {isSubmitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                {meta.cta}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
