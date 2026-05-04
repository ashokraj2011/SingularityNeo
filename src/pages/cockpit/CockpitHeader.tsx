import {
  BookOpen,
  CheckCircle2,
  FolderCode,
  GitBranch,
  Loader2,
  RefreshCw,
  Shield,
  XCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { WorkItem, Workflow, WorkflowRunDetail, WorkflowStep } from "../../types";
import type { WorkItemGitWorkspaceInitResult } from "../../lib/api";
import type { CockpitStatus } from "./types";

type Props = {
  capabilityName: string;
  workItem: WorkItem | null;
  workflow: Workflow | null;
  currentStep: WorkflowStep | null;
  runDetail: WorkflowRunDetail | null;
  gitWorkspace: WorkItemGitWorkspaceInitResult | null;
  status: CockpitStatus;
  onRefresh: () => void;
  onRefreshSource: () => void;
};

const runStatusColor = (s?: string) => {
  if (!s) return "text-secondary";
  if (s === "RUNNING") return "text-sky-600 dark:text-sky-400";
  if (s === "COMPLETED") return "text-emerald-600 dark:text-emerald-400";
  if (s.startsWith("WAITING")) return "text-amber-600 dark:text-amber-400";
  if (s === "FAILED" || s === "CANCELLED") return "text-rose-600 dark:text-rose-400";
  return "text-secondary";
};

const runStatusLabel = (s?: string) => {
  if (!s) return "No run";
  return s.replace(/_/g, " ");
};

const workItemStatusBadge = (s?: string) => {
  if (s === "BLOCKED") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (s === "ACTIVE") return "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400";
  if (s === "COMPLETED") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (s === "FAILED" || s === "CANCELLED") return "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400";
  return "border-outline-variant/40 bg-surface-container-low text-secondary";
};

export const CockpitHeader = ({
  capabilityName,
  workItem,
  workflow,
  currentStep,
  runDetail,
  gitWorkspace,
  status,
  onRefresh,
  onRefreshSource,
}: Props) => {
  const run = runDetail?.run;
  const isLoading = status === "LOADING";
  const isBlocked = workItem?.status === "BLOCKED" || Boolean(workItem?.pendingRequest);
  const approvalState = isBlocked && (workItem?.blocker?.type === "APPROVAL" || workItem?.pendingRequest?.type === "APPROVAL")
    ? "WAITING"
    : run?.status === "WAITING_APPROVAL"
    ? "WAITING"
    : run?.status === "COMPLETED"
    ? "APPROVED"
    : null;

  return (
    <header className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-outline-variant/30 bg-surface-container-high px-5 py-3">
      {/* ── Left: identity ─────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-outline">
          {capabilityName} · Work Item Cockpit
        </p>

        {workItem ? (
          <>
            <h1 className="mt-0.5 flex items-center gap-2 truncate text-lg font-semibold text-primary">
              {workItem.title}
              <span className="shrink-0 text-sm font-normal text-secondary">
                {workItem.id}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold uppercase",
                  workItemStatusBadge(workItem.status),
                )}
              >
                {workItem.status}
              </span>
            </h1>

            {/* Row 2 — workflow / phase / step / run */}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-secondary">
              {workflow && (
                <span className="flex items-center gap-1">
                  <BookOpen size={10} />
                  {workflow.name}
                </span>
              )}
              {workItem.phase && (
                <span>Phase: <strong className="text-primary">{workItem.phase}</strong></span>
              )}
              {currentStep && (
                <span>Step: <strong className="text-primary">{currentStep.name}</strong></span>
              )}
              {run && (
                <span className={cn("font-medium", runStatusColor(run.status))}>
                  {run.id.slice(-8)} · {runStatusLabel(run.status)}
                </span>
              )}
              {isLoading && (
                <span className="flex items-center gap-1 text-outline">
                  <Loader2 size={10} className="animate-spin" /> Loading…
                </span>
              )}
            </div>

            {/* Row 3 — git workspace + approval */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {gitWorkspace && (
                <>
                  <span
                    title={`Branch wi/<lowercase-id> — auto-created when this work item's run was started.${gitWorkspace.created ? " Newly created this session." : ""}`}
                    className="flex items-center gap-1 rounded bg-surface-container px-1.5 py-0.5 font-mono text-[0.62rem] text-secondary"
                  >
                    <GitBranch size={9} />
                    {gitWorkspace.branchName ||
                      gitWorkspace.workspacePath.split("/").slice(-2).join("/")}
                  </span>
                  {(() => {
                    const root = gitWorkspace.repoRoot || gitWorkspace.workspacePath;
                    const basename = root.split("/").filter(Boolean).pop();
                    return basename ? (
                      <span
                        title={root}
                        className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[0.62rem] text-outline"
                      >
                        {basename}
                      </span>
                    ) : null;
                  })()}
                </>
              )}
              {gitWorkspace?.sourceWorkspaceState && (
                <span
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold uppercase",
                    gitWorkspace.sourceWorkspaceState === "AST_READY"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : gitWorkspace.sourceWorkspaceState === "BLOCKED"
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                  )}
                >
                  <FolderCode size={9} />
                  {gitWorkspace.sourceWorkspaceState.replace(/_/g, " ")}
                </span>
              )}
              {approvalState === "WAITING" && (
                <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.62rem] font-semibold text-amber-700 dark:text-amber-300">
                  <Shield size={9} /> Approval required
                </span>
              )}
              {approvalState === "APPROVED" && (
                <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[0.62rem] font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 size={9} /> Approved
                </span>
              )}
              {run?.status === "FAILED" && (
                <span className="flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[0.62rem] font-semibold text-rose-700 dark:text-rose-300">
                  <XCircle size={9} /> Run failed
                </span>
              )}
            </div>
          </>
        ) : (
          <h1 className="mt-0.5 text-lg font-semibold text-secondary">
            Select a work item to begin
          </h1>
        )}
      </div>

      {/* ── Right: actions ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading || !workItem}
          title="Refresh"
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 px-2.5 py-1.5 text-xs text-secondary hover:bg-surface-container",
            (isLoading || !workItem) && "cursor-not-allowed opacity-50",
          )}
        >
          {isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          Refresh
        </button>
        <button
          type="button"
          onClick={onRefreshSource}
          disabled={isLoading || !workItem}
          title="Refresh source checkout and AST"
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300",
            (isLoading || !workItem) && "cursor-not-allowed opacity-50",
          )}
        >
          <FolderCode size={12} />
          Refresh source / AST
        </button>
      </div>
    </header>
  );
};
