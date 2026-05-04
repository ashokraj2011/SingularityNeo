import { useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileText,
  FolderCode,
  GitBranch,
  Loader2,
  Send,
  Shield,
  Sparkles,
} from "lucide-react";
import { cn } from "../../lib/utils";
import ArtifactPreview from "../../components/ArtifactPreview";
import {
  getArtifactDocumentBody,
} from "../../lib/orchestrator/support";
import type {
  CapabilityAgent,
  LedgerArtifactRecord,
  WorkItem,
  WorkflowRunDetail,
  WorkflowStep,
} from "../../types";
import type { WorkItemGitWorkspaceInitResult } from "../../lib/api";
import type { GuidanceDraft, GuidanceIntent, RightPanelMode } from "./types";
import { GUIDANCE_INTENT_LABELS } from "./types";
import { BlockedPanel } from "../workflowOrchestrator/BlockedPanel";

type Props = {
  mode: RightPanelMode;
  workItem: WorkItem | null;
  currentStep: WorkflowStep | null;
  agent: CapabilityAgent | null;
  runDetail: WorkflowRunDetail | null;
  ledgerArtifacts: LedgerArtifactRecord[];
  selectedArtifactId: string | null;
  gitWorkspace: WorkItemGitWorkspaceInitResult | null;
  isSubmitting: boolean;
  onModeChange: (m: RightPanelMode) => void;
  onSelectArtifact: (id: string | null) => void;
  onOpenApproval: () => void;
  onResolveBlock: (resolution: string) => Promise<void>;
  onSendGuidance: (instruction: string) => Promise<void>;
  onStartRun: (guidance?: string) => Promise<void>;
  onResumeRun: (note?: string) => Promise<void>;
  onRestartRun: (guidance?: string) => Promise<void>;
};

const PANEL_TABS: { id: RightPanelMode; label: string }[] = [
  { id: "NOW", label: "Now" },
  { id: "ARTIFACT", label: "Artifact" },
  { id: "APPROVAL", label: "Approval" },
  { id: "GUIDANCE", label: "Guidance" },
];

const GUIDANCE_INTENTS: GuidanceIntent[] = [
  "CLARIFY_REQUIREMENT",
  "ADD_CONSTRAINT",
  "CHANGE_DIRECTION",
  "REQUEST_EVIDENCE",
  "ASK_AGENT_TO_EXPLAIN",
  "OVERRIDE_NEXT_STEP",
  "STOP_AND_WAIT",
];

// ── Run status helpers ────────────────────────────────────────────────────────

type RunStatusMeta = {
  label: string;
  color: string;          // badge text color class
  bg: string;             // badge bg class
  actionLabel?: string;   // CTA button label
  actionVariant?: "start" | "resume" | "restart";
  hint?: string;          // one-line explanation below the badge
};

const RUN_STATUS_META: Record<string, RunStatusMeta> = {
  RUNNING: {
    label: "Running",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-500/10",
    hint: "Agent is executing — chat is active.",
  },
  QUEUED: {
    label: "Queued",
    color: "text-sky-700 dark:text-sky-300",
    bg: "bg-sky-500/10",
    hint: "Waiting for an executor to pick this up.",
  },
  PAUSED: {
    label: "Paused",
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-500/10",
    actionLabel: "Resume run",
    actionVariant: "resume",
    hint: "Run is paused. Resume to continue execution.",
  },
  WAITING_APPROVAL: {
    label: "Waiting — approval",
    color: "text-violet-700 dark:text-violet-300",
    bg: "bg-violet-500/10",
    hint: "Pending human approval before the run can continue.",
  },
  WAITING_HUMAN_TASK: {
    label: "Waiting — human task",
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-500/10",
    hint: "Agent delegated a task to a human. Complete it below.",
  },
  WAITING_INPUT: {
    label: "Waiting — input",
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-500/10",
    hint: "Agent is waiting for your input to continue.",
  },
  WAITING_CONFLICT: {
    label: "Waiting — conflict",
    color: "text-rose-700 dark:text-rose-300",
    bg: "bg-rose-500/10",
    hint: "A conflict was detected. Resolve it below to continue.",
  },
  FAILED: {
    label: "Failed",
    color: "text-rose-700 dark:text-rose-300",
    bg: "bg-rose-500/10",
    actionLabel: "Restart step",
    actionVariant: "restart",
    hint: "The run failed. Provide guidance and restart.",
  },
  CANCELLED: {
    label: "Cancelled",
    color: "text-secondary",
    bg: "bg-surface-container",
    actionLabel: "Restart step",
    actionVariant: "restart",
    hint: "Run was cancelled. Restart to continue.",
  },
  COMPLETED: {
    label: "Completed",
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-500/10",
    hint: "This run completed. The work item may be done.",
  },
};

// ── NOW panel ─────────────────────────────────────────────────────────────────

const NowPanel = ({
  workItem,
  currentStep,
  agent,
  runDetail,
  ledgerArtifacts,
  gitWorkspace,
  isSubmitting,
  onOpenApproval,
  onResolveBlock,
  onSelectArtifact,
  onStartRun,
  onResumeRun,
  onRestartRun,
}: Pick<
  Props,
  | "workItem"
  | "currentStep"
  | "agent"
  | "runDetail"
  | "ledgerArtifacts"
  | "gitWorkspace"
  | "isSubmitting"
  | "onOpenApproval"
  | "onResolveBlock"
  | "onSelectArtifact"
  | "onStartRun"
  | "onResumeRun"
  | "onRestartRun"
>) => {
  const [guidanceInput, setGuidanceInput] = useState("");

  const run = runDetail?.run;
  const runMeta = run ? (RUN_STATUS_META[run.status] ?? null) : null;

  const isBlocked =
    workItem?.status === "BLOCKED" ||
    Boolean(workItem?.pendingRequest?.type);

  const hasNoRun = !workItem?.activeRunId;

  const recentArtifacts = ledgerArtifacts
    .filter((r) => r.artifact.workItemId === workItem?.id)
    .slice(-5)
    .reverse();

  const handleAction = () => {
    if (!runMeta?.actionVariant) return;
    const g = guidanceInput.trim() || undefined;
    if (runMeta.actionVariant === "resume") void onResumeRun?.(g);
    else if (runMeta.actionVariant === "restart") void onRestartRun?.(g);
    setGuidanceInput("");
  };

  if (!workItem) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center">
        <Sparkles size={28} className="text-primary opacity-40" />
        <p className="mt-3 text-sm text-secondary opacity-70">
          Select a work item to see its current state.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">

      {/* ── No active run — start it ─────────────────────────────── */}
      {hasNoRun && (
        <div className="overflow-hidden rounded-xl border border-sky-300 bg-white shadow-sm dark:bg-surface-container">
          <div className="h-1 w-full bg-sky-400" />
          <div className="p-4">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              No active run
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              This work item has not been started yet. Add optional guidance and
              click Start to begin execution.
            </p>
            <textarea
              value={guidanceInput}
              onChange={(e) => setGuidanceInput(e.target.value)}
              placeholder="Optional guidance for the agent…"
              rows={2}
              className="mt-3 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400 dark:border-gray-700 dark:bg-black/20 dark:text-gray-100"
            />
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                void onStartRun?.(guidanceInput.trim() || undefined);
                setGuidanceInput("");
              }}
              className={cn(
                "mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700",
                isSubmitting && "cursor-not-allowed opacity-60",
              )}
            >
              {isSubmitting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <CheckCircle2 size={13} />
              )}
              Start run
            </button>
          </div>
        </div>
      )}

      {/* ── Run status card ──────────────────────────────────────── */}
      {run && runMeta && (
        <div className="workspace-meta-card">
          <div className="flex items-center justify-between">
            <p className="workspace-meta-label">Run status</p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide",
                runMeta.bg,
                runMeta.color,
              )}
            >
              {runMeta.label}
            </span>
          </div>
          {runMeta.hint && (
            <p className="mt-1.5 text-xs text-secondary">{runMeta.hint}</p>
          )}
          <p className="mt-1 font-mono text-[0.62rem] text-outline">
            {run.id.slice(-14)}
            {run.startedAt
              ? ` · started ${new Date(run.startedAt).toLocaleTimeString()}`
              : ""}
          </p>

          {/* Action for FAILED / PAUSED / CANCELLED */}
          {runMeta.actionVariant && (
            <div className="mt-3 space-y-2">
              <textarea
                value={guidanceInput}
                onChange={(e) => setGuidanceInput(e.target.value)}
                placeholder="Optional guidance before restarting…"
                rows={2}
                className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-gray-700 dark:bg-black/20 dark:text-gray-100"
              />
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleAction}
                className={cn(
                  "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors",
                  runMeta.actionVariant === "resume"
                    ? "bg-sky-600 hover:bg-sky-700"
                    : "bg-rose-600 hover:bg-rose-700",
                  isSubmitting && "cursor-not-allowed opacity-60",
                )}
              >
                {isSubmitting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                {runMeta.actionLabel}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Block panel (WAITING_* states and explicit BLOCKED status) ─ */}
      {isBlocked && (
        <BlockedPanel
          blocker={workItem.blocker}
          pendingRequest={workItem.pendingRequest}
          onSubmit={onResolveBlock}
          onOpenApproval={onOpenApproval}
          isSubmitting={isSubmitting}
        />
      )}

      {/* ── Current agent ────────────────────────────────────────── */}
      {agent && (
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">Current agent</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="rounded-lg bg-primary/10 p-1.5">
              <Bot size={14} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-primary">{agent.name}</p>
              {agent.role && (
                <p className="text-xs text-secondary">{agent.role}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Current step ─────────────────────────────────────────── */}
      {currentStep && (
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">Current step</p>
          <p className="mt-1.5 text-sm font-medium text-primary">
            {currentStep.name}
          </p>
          {currentStep.description && (
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              {currentStep.description}
            </p>
          )}
          {currentStep.stepType && (
            <span className="mt-1.5 inline-block rounded bg-primary/5 px-1.5 py-0.5 text-[0.62rem] text-secondary">
              {currentStep.stepType.replace(/_/g, " ")}
            </span>
          )}
        </div>
      )}

      {/* ── Git workspace ────────────────────────────────────────── */}
      {gitWorkspace && (
        <div className="workspace-meta-card">
          <p className="workspace-meta-label flex items-center gap-1">
            <GitBranch size={10} /> Git workspace
          </p>
          <p
            className="mt-1.5 break-all font-mono text-[0.68rem] text-secondary"
            title={gitWorkspace.workspacePath}
          >
            {gitWorkspace.workspacePath}
          </p>
          <span className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.62rem] text-emerald-700 dark:text-emerald-300">
            <GitBranch size={9} /> {gitWorkspace.branchName}
          </span>
          <p className="mt-1.5 text-[0.65rem] text-outline">
            Source code checked out here · AST index built from this path
          </p>
          <a
            href="/code-graph"
            className="mt-2 inline-flex items-center gap-1 text-[0.68rem] text-primary hover:underline"
          >
            <FolderCode size={11} /> Browse code graph →
          </a>
        </div>
      )}

      {/* ── Evidence artifacts ───────────────────────────────────── */}
      <div className="workspace-meta-card">
        <div className="flex items-center justify-between">
          <p className="workspace-meta-label">Evidence</p>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.6rem] font-semibold text-primary">
            {recentArtifacts.length} artifact{recentArtifacts.length !== 1 ? "s" : ""}
          </span>
        </div>
        {recentArtifacts.length === 0 ? (
          <p className="mt-2 text-xs text-secondary opacity-70">
            No artifacts produced yet.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {recentArtifacts.map(({ artifact }) => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => onSelectArtifact(artifact.id)}
                className="flex w-full items-start gap-2 text-left hover:text-primary"
              >
                <FileText size={11} className="mt-0.5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-primary">
                    {artifact.name}
                  </p>
                  <p className="text-[0.62rem] text-outline">
                    {artifact.type} · {artifact.direction ?? "OUTPUT"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── ARTIFACT panel ────────────────────────────────────────────────────────────

const ArtifactPanel = ({
  ledgerArtifacts,
  selectedArtifactId,
  workItemId,
  onSelectArtifact,
}: {
  ledgerArtifacts: LedgerArtifactRecord[];
  selectedArtifactId: string | null;
  workItemId: string | null;
  onSelectArtifact: (id: string | null) => void;
}) => {
  const records = workItemId
    ? ledgerArtifacts.filter((r) => r.artifact.workItemId === workItemId)
    : ledgerArtifacts;

  const selected = records.find(
    (r) => r.artifact.id === selectedArtifactId,
  );
  const document = selected ? getArtifactDocumentBody(selected.artifact) : "";

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Artifact picker */}
      <div className="workspace-meta-card max-h-40 overflow-y-auto">
        <p className="workspace-meta-label">Documents</p>
        {records.length === 0 ? (
          <p className="mt-2 text-xs text-secondary opacity-70">
            No artifacts yet.
          </p>
        ) : (
          <div className="mt-2 space-y-1">
            {records.map(({ artifact }) => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => onSelectArtifact(artifact.id)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                  selectedArtifactId === artifact.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-surface-container",
                )}
              >
                <FileText size={11} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {artifact.name}
                  </p>
                  <p className="text-[0.6rem] text-outline">{artifact.type}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Preview */}
      {selected ? (
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">{selected.artifact.name}</p>
          <p className="mt-1 text-[0.68rem] text-secondary">
            {selected.artifact.type} · {selected.artifact.direction ?? "OUTPUT"}
          </p>
          <div className="mt-3 max-h-[40vh] overflow-y-auto rounded-xl border border-outline-variant/30 bg-white px-4 py-3">
            {document ? (
              <ArtifactPreview
                format={selected.artifact.contentFormat}
                content={document}
              />
            ) : (
              <p className="text-xs text-secondary opacity-70">
                No previewable content.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-center text-xs text-secondary opacity-60">
          Select a document above to preview it.
        </p>
      )}
    </div>
  );
};

// ── APPROVAL panel ────────────────────────────────────────────────────────────

const ApprovalPanel = ({
  workItem,
  onOpenApproval,
}: {
  workItem: WorkItem | null;
  onOpenApproval: () => void;
}) => {
  const needsApproval =
    workItem?.status === "BLOCKED" &&
    (workItem.blocker?.type === "APPROVAL" ||
      workItem.pendingRequest?.type === "APPROVAL");

  return (
    <div className="p-4">
      {needsApproval ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle
                size={14}
                className="mt-0.5 text-amber-600 dark:text-amber-400"
              />
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  Approval required
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-700/80 dark:text-amber-300/80">
                  {workItem?.blocker?.message ||
                    workItem?.pendingRequest?.message ||
                    "This work item is waiting for your approval decision."}
                </p>
                {workItem?.blocker?.requestedBy && (
                  <p className="mt-1.5 text-[0.65rem] text-amber-600/70">
                    Requested by {workItem.blocker.requestedBy}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenApproval}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              <Shield size={14} />
              Open Approval Review
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <CheckCircle2 size={28} className="text-emerald-500 opacity-60" />
          <p className="mt-3 text-sm text-secondary opacity-70">
            No approval gate is currently open.
          </p>
        </div>
      )}
    </div>
  );
};

// ── GUIDANCE panel ────────────────────────────────────────────────────────────

const GuidancePanel = ({
  agent,
  currentStep,
  isSubmitting,
  onSendGuidance,
}: {
  agent: CapabilityAgent | null;
  currentStep: WorkflowStep | null;
  isSubmitting: boolean;
  onSendGuidance: (instruction: string) => Promise<void>;
}) => {
  const [intent, setIntent] = useState<GuidanceIntent>("CLARIFY_REQUIREMENT");
  const [instruction, setInstruction] = useState("");
  const [constraints, setConstraints] = useState("");

  const handleSend = async () => {
    if (!instruction.trim()) return;
    const full =
      `[${GUIDANCE_INTENT_LABELS[intent]}]\n${instruction.trim()}` +
      (constraints.trim() ? `\n\nConstraints: ${constraints.trim()}` : "");
    await onSendGuidance(full);
    setInstruction("");
    setConstraints("");
  };

  return (
    <div className="space-y-3 p-4">
      <div className="workspace-meta-card">
        <p className="workspace-meta-label">Target</p>
        <div className="mt-2 flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <Bot size={13} className="text-primary" />
          </div>
          <p className="text-sm font-medium text-primary">
            {agent?.name ?? "Current agent"}
          </p>
        </div>
        {currentStep && (
          <p className="mt-1 text-xs text-secondary">
            Step: {currentStep.name}
          </p>
        )}
      </div>

      <div className="workspace-meta-card space-y-3">
        <div>
          <p className="workspace-meta-label">Intent</p>
          <select
            value={intent}
            onChange={(e) => setIntent(e.target.value as GuidanceIntent)}
            className="mt-1.5 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-2.5 py-1.5 text-xs text-primary focus:border-primary focus:outline-none"
          >
            {GUIDANCE_INTENTS.map((gi) => (
              <option key={gi} value={gi}>
                {GUIDANCE_INTENT_LABELS[gi]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className="workspace-meta-label">Instruction</p>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={4}
            placeholder="Tell the agent what to do next, clarify a requirement, or change direction…"
            className="mt-1.5 w-full resize-none rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-xs text-primary placeholder-secondary/50 focus:border-primary focus:outline-none"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <p className="workspace-meta-label">Constraints (optional)</p>
          <input
            type="text"
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            placeholder="e.g. Do not modify auth module, use existing test suite"
            className="mt-1.5 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-3 py-1.5 text-xs text-primary placeholder-secondary/50 focus:border-primary focus:outline-none"
            disabled={isSubmitting}
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!instruction.trim() || isSubmitting}
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground",
            (!instruction.trim() || isSubmitting) &&
              "cursor-not-allowed opacity-60",
          )}
        >
          {isSubmitting ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Send size={13} />
          )}
          Send guidance
        </button>

        <p className="text-[0.65rem] leading-relaxed text-secondary opacity-70">
          Guidance is stored as a durable instruction and injected into the
          agent's context on its next step.
        </p>
      </div>
    </div>
  );
};

// ── Main right panel ──────────────────────────────────────────────────────────

export const CockpitRightPanel = ({
  mode,
  workItem,
  currentStep,
  agent,
  runDetail,
  ledgerArtifacts,
  selectedArtifactId,
  gitWorkspace,
  isSubmitting,
  onModeChange,
  onSelectArtifact,
  onOpenApproval,
  onResolveBlock,
  onSendGuidance,
  onStartRun,
  onResumeRun,
  onRestartRun,
}: Props) => {
  const hasApproval =
    workItem?.status === "BLOCKED" &&
    (workItem?.blocker?.type === "APPROVAL" ||
      workItem?.pendingRequest?.type === "APPROVAL");

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-outline-variant/30 bg-surface-container-low">
      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 border-b border-outline-variant/30">
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onModeChange(tab.id)}
            className={cn(
              "relative flex-1 px-2 py-2.5 text-[0.7rem] font-semibold transition-colors",
              mode === tab.id
                ? "border-b-2 border-primary text-primary"
                : "text-secondary hover:text-primary",
            )}
          >
            {tab.label}
            {tab.id === "APPROVAL" && hasApproval && (
              <span className="ml-1 inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            )}
          </button>
        ))}
      </div>

      {/* ── Panel content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {mode === "NOW" && (
          <NowPanel
            workItem={workItem}
            currentStep={currentStep}
            agent={agent}
            runDetail={runDetail}
            ledgerArtifacts={ledgerArtifacts}
            gitWorkspace={gitWorkspace}
            isSubmitting={isSubmitting}
            onOpenApproval={onOpenApproval}
            onResolveBlock={onResolveBlock}
            onSelectArtifact={onSelectArtifact}
            onStartRun={onStartRun}
            onResumeRun={onResumeRun}
            onRestartRun={onRestartRun}
          />
        )}
        {mode === "ARTIFACT" && (
          <ArtifactPanel
            ledgerArtifacts={ledgerArtifacts}
            selectedArtifactId={selectedArtifactId}
            workItemId={workItem?.id ?? null}
            onSelectArtifact={onSelectArtifact}
          />
        )}
        {mode === "APPROVAL" && (
          <ApprovalPanel
            workItem={workItem}
            onOpenApproval={onOpenApproval}
          />
        )}
        {mode === "GUIDANCE" && (
          <GuidancePanel
            agent={agent}
            currentStep={currentStep}
            isSubmitting={isSubmitting}
            onSendGuidance={onSendGuidance}
          />
        )}
      </div>
    </aside>
  );
};
