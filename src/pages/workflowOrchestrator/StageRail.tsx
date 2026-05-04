import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { WorkflowStep } from "../../types";

export type StageRailStatus = "complete" | "current" | "pending";

interface StageRailProps {
  steps: WorkflowStep[];
  currentStepId?: string | null;
  /** When true, the current pill shows a spinner (status is ADVANCING). */
  isAdvancing?: boolean;
  /** Optional click handler for past stages — read-only history view. */
  onSelectStep?: (step: WorkflowStep) => void;
}

const statusForStep = (
  step: WorkflowStep,
  currentStepId: string | null | undefined,
  steps: WorkflowStep[],
): StageRailStatus => {
  if (!currentStepId) return "pending";
  if (step.id === currentStepId) return "current";
  const currentIndex = steps.findIndex((entry) => entry.id === currentStepId);
  const stepIndex = steps.findIndex((entry) => entry.id === step.id);
  if (currentIndex === -1 || stepIndex === -1) return "pending";
  return stepIndex < currentIndex ? "complete" : "pending";
};

export const StageRail = ({
  steps,
  currentStepId,
  isAdvancing,
  onSelectStep,
}: StageRailProps) => {
  if (!steps.length) {
    return (
      <div className="text-xs text-secondary">
        This workflow has no stages defined.
      </div>
    );
  }

  const currentIndex = currentStepId
    ? steps.findIndex((step) => step.id === currentStepId)
    : -1;
  const positionLabel =
    currentIndex >= 0 ? `${currentIndex + 1} of ${steps.length}` : `${steps.length} stage${steps.length === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, index) => {
          const status = statusForStep(step, currentStepId, steps);
          const Icon =
            status === "complete"
              ? CheckCircle2
              : status === "current"
                ? isAdvancing
                  ? Loader2
                  : Circle
                : Circle;
          const isClickable = Boolean(onSelectStep) && status === "complete";
          return (
            <button
              key={step.id}
              type="button"
              disabled={!isClickable}
              onClick={isClickable ? () => onSelectStep?.(step) : undefined}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                status === "complete" &&
                  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                status === "current" &&
                  "border-primary/40 bg-primary/10 text-primary shadow-sm",
                status === "pending" &&
                  "border-outline-variant/40 bg-surface-container-low text-secondary",
                isClickable && "cursor-pointer hover:bg-emerald-500/20",
                !isClickable && "cursor-default",
              )}
              title={step.description || step.name}
            >
              <Icon
                size={14}
                className={cn(
                  status === "current" && isAdvancing && "animate-spin",
                )}
              />
              <span className="text-[0.65rem] uppercase tracking-[0.12em] opacity-60">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="truncate max-w-[12rem]">{step.name}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[0.7rem] uppercase tracking-[0.16em] text-outline">
        <span>{positionLabel}</span>
        {currentIndex >= 0 ? (
          <span>
            current · {steps[currentIndex].stepType.toLowerCase()}
            {steps[currentIndex].agentId ? ` · agent ${steps[currentIndex].agentId}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
};
