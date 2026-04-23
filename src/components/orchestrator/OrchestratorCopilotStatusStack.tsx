import React from "react";
import {
  ArrowRight,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import MarkdownContent from "../MarkdownContent";
import { StatusBadge } from "../EnterpriseUI";
import { formatEnumLabel } from "../../lib/enterprise";
import { normalizeMarkdownishText } from "../../lib/orchestrator/support";
import type { RunWait, WorkspacePathValidationResult } from "../../types";
import type { CapabilityReadinessItem } from "../../lib/capabilityExperience";
import { cn } from "../../lib/utils";

type Props = {
  selectedWorkItemPresent: boolean;
  deliveryBlockingItem: CapabilityReadinessItem | null;
  onOpenBlockingAction: () => void;
  canStartExecution: boolean;
  executionDispatchLabel: string;
  canRestartFromPhase: boolean;
  phaseLabel: string;
  busyAction: string | null;
  onRestartExecution: () => void;
  selectedCanGuideBlockedAgent: boolean;
  isPaused: boolean;
  canResumeRun: boolean;
  onResumeRun: () => void;
  selectedOpenWait: RunWait | null;
  selectedAttentionLabel: string;
  dockMissingFieldLabels: string[];
  onFieldChipClick: (label: string) => void;
  waitRequiresApprovedWorkspace: boolean;
  hasApprovedWorkspaceConfigured: boolean;
  approvedWorkspaceRoots: string[];
  approvedWorkspaceDraft: string;
  onApprovedWorkspaceDraftChange: (value: string) => void;
  approvedWorkspaceSuggestions: string[];
  onSelectApprovedWorkspaceDraft: (root: string) => void;
  onApproveWorkspacePathAndContinue: () => void;
  onApproveWorkspacePathOnly: () => void;
  approvedWorkspaceValidation: WorkspacePathValidationResult | null;
  canEditCapability: boolean;
};

const summarizeWaitMessage = (message: string) => {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const firstTwo = sentences.slice(0, 2).join(" ");
  const summary = firstTwo || normalized;

  return summary.length > 260
    ? `${summary.slice(0, 257).trimEnd()}...`
    : summary;
};

const getWaitModeMeta = (wait: RunWait | null) => {
  switch (wait?.type) {
    case "APPROVAL":
      return {
        title: "Decision required",
        subtitle:
          "Review the evidence, ask follow-up questions if needed, then move into the approval review flow.",
        tone: "warning" as const,
      };
    case "CONFLICT_RESOLUTION":
      return {
        title: "Conflict resolution needed",
        subtitle:
          "Choose the final path, constraints, or escalation outcome so the workflow can proceed cleanly.",
        tone: "warning" as const,
      };
    case "INPUT":
      return {
        title: "Specific input needed",
        subtitle:
          "Give the agent concrete business or implementation guidance. Generic replies will not unblock the run.",
        tone: "warning" as const,
      };
    default:
      return {
        title: "No pending request",
        subtitle: "The workflow is not waiting on a human decision right now.",
        tone: "neutral" as const,
      };
  }
};

export const OrchestratorCopilotStatusStack = ({
  selectedWorkItemPresent,
  deliveryBlockingItem,
  onOpenBlockingAction,
  canStartExecution,
  executionDispatchLabel,
  canRestartFromPhase,
  phaseLabel,
  busyAction,
  onRestartExecution,
  selectedCanGuideBlockedAgent,
  isPaused,
  canResumeRun,
  onResumeRun,
  selectedOpenWait,
  selectedAttentionLabel,
  dockMissingFieldLabels,
  onFieldChipClick,
  waitRequiresApprovedWorkspace,
  hasApprovedWorkspaceConfigured,
  approvedWorkspaceRoots,
  approvedWorkspaceDraft,
  onApprovedWorkspaceDraftChange,
  approvedWorkspaceSuggestions,
  onSelectApprovedWorkspaceDraft,
  onApproveWorkspacePathAndContinue,
  onApproveWorkspacePathOnly,
  approvedWorkspaceValidation,
  canEditCapability,
}: Props) => {
  if (!selectedWorkItemPresent) {
    return (
      <div className="workspace-meta-card">
        Select a work item to see the current decision state, pending requests,
        and the focused copilot thread for that item.
      </div>
    );
  }

  const normalizedWaitMessage = selectedOpenWait
    ? normalizeMarkdownishText(selectedOpenWait.message)
    : "";
  const waitSummary = summarizeWaitMessage(normalizedWaitMessage);
  const waitMeta = getWaitModeMeta(selectedOpenWait);
  const showFullWaitRequest =
    Boolean(normalizedWaitMessage.trim()) &&
    normalizedWaitMessage.replace(/\s+/g, " ").trim() !== waitSummary;

  const phaseCard = (
    <div className="workspace-meta-card border-primary/18 bg-primary/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="workspace-meta-label">Current phase</p>
          <p className="mt-2 text-base font-semibold text-on-surface">
            {phaseLabel}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-secondary">
            Keep the response grounded in what this phase must decide or produce
            next.
          </p>
        </div>
        {canRestartFromPhase ? (
          <button
            type="button"
            onClick={onRestartExecution}
            disabled={busyAction !== null}
            className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyAction === "restart" ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Restart {phaseLabel}
          </button>
        ) : (
          <StatusBadge tone="brand">{phaseLabel}</StatusBadge>
        )}
      </div>
    </div>
  );

  const pausedCard = isPaused ? (
    <div className="workspace-meta-card border-slate-200 bg-slate-50/70">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="workspace-meta-label">Paused</p>
          <p className="mt-2 text-sm font-semibold text-on-surface">
            Execution is paused
          </p>
          <p className="mt-1 text-xs leading-relaxed text-secondary">
            Resume to continue, or capture the required decision from this dock
            first.
          </p>
        </div>
        <button
          type="button"
          onClick={onResumeRun}
          disabled={!canResumeRun}
          className="enterprise-button enterprise-button-primary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busyAction?.startsWith("resume-") ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          Resume
        </button>
      </div>
    </div>
  ) : null;

  const readyCard =
    !selectedOpenWait && !deliveryBlockingItem && canStartExecution ? (
      <div className="workspace-meta-card border-emerald-200/75 bg-emerald-50/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Execution ready</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              This work item can start from the dock
            </p>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              Add optional kickoff guidance below, upload any context that
              matters, then start the workflow from here.
            </p>
          </div>
          <StatusBadge tone="success">{executionDispatchLabel}</StatusBadge>
        </div>
      </div>
    ) : null;

  const blockingCard =
    !selectedOpenWait && deliveryBlockingItem ? (
      <div className="workspace-meta-card border-amber-200/85 bg-amber-50/65">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Execution blocked</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {deliveryBlockingItem.label}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              {deliveryBlockingItem.nextRequiredAction ||
                deliveryBlockingItem.blockingReason ||
                'Review the readiness blocker before continuing.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenBlockingAction}
            className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem]"
          >
            <ArrowRight size={14} />
            {deliveryBlockingItem.actionLabel}
          </button>
        </div>
      </div>
    ) : null;

  const restartGuidanceCard =
    !selectedOpenWait && selectedCanGuideBlockedAgent ? (
      <div className="workspace-meta-card border-primary/18 bg-primary/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Blocked execution</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              Restart from this dock with explicit guidance
            </p>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              Explain what changed and what the next attempt should do
              differently. The composer below becomes the new restart brief.
            </p>
          </div>
          <StatusBadge tone="brand">Restart-ready</StatusBadge>
        </div>
      </div>
    ) : null;

  const workspacePathCard = waitRequiresApprovedWorkspace ? (
    <div className="workspace-meta-card border-outline-variant/30 bg-white/92">
      <p className="workspace-meta-label">Desktop workspace</p>
      {hasApprovedWorkspaceConfigured ? (
        <>
          <p className="mt-2 text-xs leading-relaxed text-secondary">
            Validated roots for this operator on this desktop:
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
            {approvedWorkspaceRoots.slice(0, 4).map((root) => (
              <li key={root} className="font-mono text-[0.72rem]">
                {root}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-secondary">
          No desktop workspace mappings are saved yet.
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-secondary">
        {hasApprovedWorkspaceConfigured
          ? "Add another mapped path if this work item needs a different codebase."
          : "Save a local directory path for this operator on this desktop."}
      </p>
      <input
        value={approvedWorkspaceDraft}
        onChange={(event) => onApprovedWorkspaceDraftChange(event.target.value)}
        placeholder="/Users/you/projects/my-repo"
        className="mt-3 field-input font-mono text-[0.8rem]"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {approvedWorkspaceSuggestions.map((root) => (
          <button
            key={root}
            type="button"
            onClick={() => onSelectApprovedWorkspaceDraft(root)}
            className="enterprise-button enterprise-button-secondary"
          >
            {root}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onApproveWorkspacePathAndContinue}
          disabled={busyAction !== null}
          className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busyAction === "approveWorkspacePath" ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <ShieldCheck size={16} />
          )}
          Approve and continue
        </button>
        <button
          type="button"
          onClick={onApproveWorkspacePathOnly}
          disabled={busyAction !== null}
          className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          Approve only
        </button>
      </div>
      {approvedWorkspaceValidation ? (
        <p
          className={cn(
            "mt-2 text-xs font-medium",
            approvedWorkspaceValidation.valid
              ? "text-emerald-700"
              : "text-amber-800",
          )}
        >
          {approvedWorkspaceValidation.message}
        </p>
      ) : null}
      {!canEditCapability ? (
        <p className="mt-2 text-xs font-medium text-amber-800">
          Approving new paths requires capability edit access. Switch Current
          Operator to a workspace admin if needed.
        </p>
      ) : null}
    </div>
  ) : null;

  if (selectedOpenWait) {
    return (
      <div className="orchestrator-copilot-status-grid">
        <div className="workspace-meta-card orchestrator-copilot-status-hero border-amber-200/85 bg-amber-50/55">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Pending request</p>
              <p className="mt-2 text-base font-semibold text-on-surface">
                {selectedAttentionLabel}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-secondary">
                {waitMeta.subtitle}
              </p>
            </div>
            <StatusBadge tone={waitMeta.tone}>
              {formatEnumLabel(selectedOpenWait.type)}
            </StatusBadge>
          </div>

          <div className="orchestrator-copilot-status-summary mt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="workspace-meta-label">What needs your decision</p>
                <p className="mt-2 text-sm font-semibold text-on-surface">
                  {waitMeta.title}
                </p>
              </div>
              <StatusBadge tone="neutral">Respond from the dock</StatusBadge>
            </div>
            <p className="mt-3 text-sm leading-7 text-on-surface">
              {waitSummary || normalizedWaitMessage}
            </p>
          </div>

          {dockMissingFieldLabels.length > 0 ? (
            <div className="mt-4">
              <p className="workspace-meta-label">
                Still missing from your response
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {dockMissingFieldLabels.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onFieldChipClick(label)}
                    className="rounded-full border border-outline-variant/30 bg-white/92 px-3 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {showFullWaitRequest ? (
            <details className="orchestrator-copilot-status-details mt-4">
              <summary>Show full request</summary>
              <div className="mt-3 rounded-2xl border border-outline-variant/25 bg-white/92 px-4 py-3">
                <MarkdownContent content={normalizedWaitMessage} />
              </div>
            </details>
          ) : null}

          {workspacePathCard ? (
            <div className="mt-4">{workspacePathCard}</div>
          ) : null}
        </div>

        <div className="orchestrator-copilot-status-rail">
          {phaseCard}
          {pausedCard}
        </div>
      </div>
    );
  }

  const passiveCards = [
    { key: "blocking", node: blockingCard },
    { key: "ready", node: readyCard },
    { key: "restart-guidance", node: restartGuidanceCard },
    { key: "paused", node: pausedCard },
  ].filter((entry): entry is { key: string; node: React.ReactElement } =>
    Boolean(entry.node),
  );

  return (
    <div className="orchestrator-copilot-status-grid">
      <div className="orchestrator-copilot-status-rail">{phaseCard}</div>
      <div className="orchestrator-copilot-status-grid-cards">
        {passiveCards.length > 0 ? (
          passiveCards.map((entry) => (
            <React.Fragment key={entry.key}>{entry.node}</React.Fragment>
          ))
        ) : (
          <div className="workspace-meta-card">
            No open approval, input, or conflict wait is attached to the
            selected work item right now.
          </div>
        )}
      </div>
    </div>
  );
};
