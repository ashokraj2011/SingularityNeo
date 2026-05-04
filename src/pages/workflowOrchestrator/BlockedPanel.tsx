import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldCheck,
  User,
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
  { label: string; cta: string; placeholder: string; color: "amber" | "rose" | "sky" | "violet" }
> = {
  HUMAN_INPUT: {
    label: "Waiting for human input",
    cta: "Submit input",
    placeholder:
      "Provide the requested input or additional context so the agent can continue…",
    color: "amber",
  },
  INPUT: {
    label: "Waiting for input",
    cta: "Submit input",
    placeholder: "Provide the requested input to continue…",
    color: "amber",
  },
  CONFLICT_RESOLUTION: {
    label: "Conflict resolution required",
    cta: "Resolve conflict",
    placeholder:
      "Describe how to resolve the conflict — what decision should the workflow follow?",
    color: "rose",
  },
  HUMAN_TASK: {
    label: "Delegated task — awaiting completion",
    cta: "Mark task done",
    placeholder:
      "Describe what was done, the outcome, and any notes the next agent needs…",
    color: "sky",
  },
  APPROVAL: {
    label: "Waiting for approval",
    cta: "Review & Approve",
    placeholder: "",
    color: "violet",
  },
  SUB_WORKFLOW_WAIT: {
    label: "Sub-workflow in progress",
    cta: "Provide update",
    placeholder: "Provide an update to let the sub-workflow continue…",
    color: "amber",
  },
};

const colorMap = {
  amber: {
    border: "border-amber-400",
    bar: "bg-amber-400",
    badge: "bg-amber-100 text-amber-800 border-amber-300",
    icon: "text-amber-500",
    btn: "bg-amber-500 hover:bg-amber-600 active:bg-amber-700",
    focus: "focus:ring-amber-400",
  },
  rose: {
    border: "border-rose-400",
    bar: "bg-rose-400",
    badge: "bg-rose-100 text-rose-800 border-rose-300",
    icon: "text-rose-500",
    btn: "bg-rose-500 hover:bg-rose-600 active:bg-rose-700",
    focus: "focus:ring-rose-400",
  },
  sky: {
    border: "border-sky-400",
    bar: "bg-sky-400",
    badge: "bg-sky-100 text-sky-800 border-sky-300",
    icon: "text-sky-500",
    btn: "bg-sky-600 hover:bg-sky-700 active:bg-sky-800",
    focus: "focus:ring-sky-400",
  },
  violet: {
    border: "border-violet-400",
    bar: "bg-violet-400",
    badge: "bg-violet-100 text-violet-800 border-violet-300",
    icon: "text-violet-500",
    btn: "bg-violet-600 hover:bg-violet-700 active:bg-violet-800",
    focus: "focus:ring-violet-400",
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
  const c = colorMap[meta.color];

  const handleSubmit = async () => {
    if (!resolution.trim() || isSubmitting) return;
    await onSubmit(resolution.trim());
    setResolution("");
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-surface-container",
        c.border,
      )}
    >
      {/* Colour bar at top */}
      <div className={cn("h-1 w-full", c.bar)} />

      <div className="p-4">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={16}
            className={cn("mt-0.5 shrink-0", c.icon)}
          />
          <div className="min-w-0 flex-1">
            {/* Title + badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {meta.label}
              </span>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 font-mono text-[0.6rem] font-medium uppercase tracking-wider",
                  c.badge,
                )}
              >
                {effectiveType.replace(/_/g, " ")}
              </span>
            </div>

            {/* Reason / message */}
            <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2.5 text-sm leading-relaxed text-gray-800 dark:bg-black/20 dark:text-gray-200">
              {effectiveMessage}
            </p>

            {/* Requested by */}
            {effectiveRequestedBy ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <User size={11} />
                <span>
                  Requested by{" "}
                  <strong className="font-semibold text-gray-700 dark:text-gray-300">
                    {effectiveRequestedBy}
                  </strong>
                </span>
                {effectiveTimestamp ? (
                  <>
                    <span className="mx-0.5 text-gray-300 dark:text-gray-600">·</span>
                    <Clock size={11} />
                    <span>{new Date(effectiveTimestamp).toLocaleString()}</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Action area ─────────────────────────────────────────── */}
        <div className="mt-4">
          {isApproval ? (
            <button
              type="button"
              onClick={onOpenApproval}
              className={cn(
                "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-colors",
                c.btn,
              )}
            >
              <ShieldCheck size={15} />
              Review &amp; Approve
            </button>
          ) : (
            <div className="space-y-2.5">
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
                  "w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-sm transition-colors",
                  "focus:border-transparent focus:outline-none focus:ring-2",
                  c.focus,
                  "dark:border-gray-700 dark:bg-black/20 dark:text-gray-100 dark:placeholder-gray-500",
                  isSubmitting && "cursor-not-allowed opacity-60",
                )}
                disabled={isSubmitting}
              />
              <div className="flex items-center justify-between">
                <p className="text-[0.7rem] text-gray-400 dark:text-gray-500">
                  Press Enter to submit · Shift+Enter for new line
                </p>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!resolution.trim() || isSubmitting}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors",
                    c.btn,
                    (!resolution.trim() || isSubmitting) &&
                      "cursor-not-allowed opacity-50",
                  )}
                >
                  {isSubmitting ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={13} />
                  )}
                  {meta.cta}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
