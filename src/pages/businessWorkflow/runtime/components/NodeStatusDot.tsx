import { cn } from "../../../../lib/utils";
import type { NodeRuntimeState } from "../../../../lib/businessWorkflowRuntime";

/**
 * 8px dot that matches the canvas's node colouring. Used in the
 * active-tasks panel, timeline event rows, and the status report so
 * a glance at any list communicates the same state vocabulary as the
 * graph.
 */
export const NodeStatusDot = ({
  state,
  pulse = false,
  className,
}: {
  state: NodeRuntimeState;
  /** Animate-ping wrapper. Reserved for the "what's currently active"
   *  dot in the toolbar. Don't pulse 50 of these in a list. */
  pulse?: boolean;
  className?: string;
}) => {
  const tone =
    state === "active"
      ? "bg-emerald-500"
      : state === "completed"
        ? "bg-slate-400"
        : state === "sent-back-source"
          ? "bg-amber-500"
          : state === "failed"
            ? "bg-rose-500"
            : "bg-slate-200";
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      {pulse && state === "active" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", tone)} />
    </span>
  );
};
