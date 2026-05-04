import { CheckCircle2, Circle, Loader2, Lock, PlayCircle, XCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import type { LedgerArtifactRecord, WorkItem, Workflow, WorkflowRunDetail, WorkflowStep } from "../../types";

type Props = {
  workItem: WorkItem | null;
  workflow: Workflow | null;
  currentStep: WorkflowStep | null;
  runDetail: WorkflowRunDetail | null;
  ledgerArtifacts: LedgerArtifactRecord[];
  onSelectStep?: (stepId: string) => void;
};

const STEP_TYPE_LABELS: Record<string, string> = {
  AGENT_TASK: "Agent",
  HUMAN_TASK: "Human task",
  HUMAN_APPROVAL: "Approval gate",
  GOVERNANCE_GATE: "Governance",
  BUILD: "Build",
  DELIVERY: "Delivery",
  SUB_WORKFLOW: "Sub-workflow",
};

const stepIcon = (status: string | undefined, isCurrent: boolean) => {
  if (status === "COMPLETED") return <CheckCircle2 size={14} className="text-emerald-500" />;
  if (status === "FAILED") return <XCircle size={14} className="text-rose-500" />;
  if (status === "RUNNING" || isCurrent) return <Loader2 size={14} className="animate-spin text-sky-500" />;
  if (status === "WAITING") return <PlayCircle size={14} className="text-amber-500" />;
  if (status === "CANCELLED") return <XCircle size={14} className="text-secondary opacity-50" />;
  return <Circle size={14} className="text-outline/50" />;
};

const stepColor = (status: string | undefined, isCurrent: boolean) => {
  if (isCurrent) return "border-l-sky-500 bg-sky-500/5";
  if (status === "COMPLETED") return "border-l-emerald-500/60 bg-emerald-500/5";
  if (status === "FAILED") return "border-l-rose-500/60 bg-rose-500/5";
  if (status === "WAITING") return "border-l-amber-500/60 bg-amber-500/5";
  return "border-l-outline-variant/30";
};

export const CockpitLeftRail = ({
  workItem,
  workflow,
  currentStep,
  runDetail,
  ledgerArtifacts,
  onSelectStep,
}: Props) => {
  if (!workItem || !workflow) {
    return (
      <aside className="flex w-60 shrink-0 flex-col border-r border-outline-variant/30 bg-surface-container-low p-4">
        <p className="text-xs text-outline opacity-60">
          Pick a work item to see the workflow map.
        </p>
      </aside>
    );
  }

  // Map run-step statuses for display
  const runStepByWorkflowStepId = new Map(
    (runDetail?.steps ?? [])
      .filter((s) => s.workflowStepId)
      .map((s) => [s.workflowStepId!, s]),
  );

  const currentPhase = workItem.phase;

  // Artifacts for the current step
  const currentStepArtifacts = currentStep
    ? ledgerArtifacts.filter(
        (r) => r.artifact.workflowStepId === currentStep.id,
      )
    : [];

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-0 overflow-y-auto border-r border-outline-variant/30 bg-surface-container-low">
      {/* ── Workflow phase map ──────────────────────────────────────────── */}
      <div className="px-3 pb-2 pt-3">
        <p className="text-[0.65rem] uppercase tracking-[0.16em] text-outline">
          Workflow · {workflow.name}
        </p>
      </div>

      <div className="flex flex-col gap-0.5 px-2 pb-3">
        {workflow.steps.map((step, idx) => {
          const isCurrent = step.id === currentStep?.id;
          const runStep = runStepByWorkflowStepId.get(step.id);
          const status = runStep?.status;
          const isPast =
            runStep?.status === "COMPLETED" || runStep?.status === "CANCELLED";
          const isLocked = !isCurrent && !isPast && !runStep;

          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onSelectStep?.(step.id)}
              className={cn(
                "group flex items-start gap-2 rounded-r-lg border-l-2 px-2.5 py-2 text-left transition-colors hover:bg-primary/5",
                stepColor(status, isCurrent),
              )}
            >
              <span className="mt-0.5 shrink-0">{stepIcon(status, isCurrent)}</span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-xs font-medium",
                    isCurrent ? "text-primary" : isPast ? "text-secondary" : "text-secondary/70",
                  )}
                >
                  {step.name}
                </p>
                <p className="text-[0.62rem] text-outline">
                  {STEP_TYPE_LABELS[step.stepType] ?? step.stepType}
                  {step.phase && step.phase !== currentPhase ? ` · ${step.phase}` : ""}
                </p>
                {isCurrent && runStep?.outputSummary && (
                  <p className="mt-1 line-clamp-2 text-[0.62rem] leading-relaxed text-secondary opacity-80">
                    {runStep.outputSummary}
                  </p>
                )}
              </div>
              {isLocked && (
                <Lock size={10} className="mt-1 shrink-0 text-outline opacity-40" />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Artifact checklist for current step ────────────────────────── */}
      {currentStep && (
        <div className="border-t border-outline-variant/30 px-3 py-3">
          <p className="text-[0.65rem] uppercase tracking-[0.16em] text-outline">
            Step artifacts
          </p>

          {currentStepArtifacts.length === 0 ? (
            <p className="mt-2 text-[0.72rem] text-secondary opacity-70">
              No artifacts produced yet for this step.
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {currentStepArtifacts.map(({ artifact }) => (
                <div key={artifact.id} className="flex items-start gap-1.5">
                  <CheckCircle2
                    size={11}
                    className="mt-0.5 shrink-0 text-emerald-500"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[0.72rem] font-medium text-primary">
                      {artifact.name}
                    </p>
                    <p className="text-[0.62rem] text-outline">
                      {artifact.direction ?? "OUTPUT"} · {artifact.type}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Work item metadata ──────────────────────────────────────────── */}
      <div className="mt-auto border-t border-outline-variant/30 px-3 py-3">
        <div className="space-y-1 text-[0.72rem] text-secondary">
          <p>
            Priority:{" "}
            <strong
              className={cn(
                workItem.priority === "High"
                  ? "text-rose-600"
                  : workItem.priority === "Med"
                  ? "text-amber-600"
                  : "text-secondary",
              )}
            >
              {workItem.priority}
            </strong>
          </p>
          {workItem.tags?.length > 0 && (
            <p className="flex flex-wrap gap-1">
              {workItem.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.6rem] text-primary"
                >
                  {tag}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
};
