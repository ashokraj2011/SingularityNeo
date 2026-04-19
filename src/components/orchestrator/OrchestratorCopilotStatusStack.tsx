import React from 'react';
import { ArrowRight, LoaderCircle, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import MarkdownContent from '../MarkdownContent';
import { StatusBadge } from '../EnterpriseUI';
import { formatEnumLabel } from '../../lib/enterprise';
import { normalizeMarkdownishText } from '../../lib/orchestrator/support';
import type { RunWait, WorkspacePathValidationResult } from '../../types';
import type { CapabilityReadinessItem } from '../../lib/capabilityExperience';
import { cn } from '../../lib/utils';

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
        Select a work item to see pending requests and start a focused copilot thread.
      </div>
    );
  }

  return (
    <>
      {!selectedOpenWait && deliveryBlockingItem ? (
        <div className="workspace-meta-card border-amber-200/80 bg-amber-50/60">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Execution blocked</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {deliveryBlockingItem.label}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                {deliveryBlockingItem.nextRequiredAction ||
                  deliveryBlockingItem.blockingReason ||
                  deliveryBlockingItem.summary}
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
      ) : null}

      {!selectedOpenWait && !deliveryBlockingItem && canStartExecution ? (
        <div className="workspace-meta-card border-emerald-200/70 bg-emerald-50/55">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Execution ready</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                This work item can start from the dock
              </p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Add optional kickoff guidance below, upload context if needed, then start execution
                to generate real workflow artifacts, waits, and approvals.
              </p>
            </div>
            <StatusBadge tone="success">{executionDispatchLabel}</StatusBadge>
          </div>
        </div>
      ) : null}

      {canRestartFromPhase ? (
        <div className="workspace-meta-card border-primary/20 bg-primary/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Current phase</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">{phaseLabel}</p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Restart this phase if you want to rerun the current stage from a clean attempt.
              </p>
            </div>
            <button
              type="button"
              onClick={onRestartExecution}
              disabled={busyAction !== null}
              className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === 'restart' ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Restart {phaseLabel}
            </button>
          </div>
        </div>
      ) : null}

      {!selectedOpenWait && selectedCanGuideBlockedAgent ? (
        <div className="workspace-meta-card border-primary/20 bg-primary/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Blocked execution</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                Restart from this dock with explicit guidance
              </p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Explain what changed and what the next attempt should do differently, then restart
                directly from the composer below.
              </p>
            </div>
            <StatusBadge tone="brand">Restart-ready</StatusBadge>
          </div>
        </div>
      ) : null}

      {isPaused ? (
        <div className="workspace-meta-card border-slate-200 bg-slate-50/60">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Paused</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">Execution is paused</p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Resume to continue, or resolve pending requests from this dock.
              </p>
            </div>
            <button
              type="button"
              onClick={onResumeRun}
              disabled={!canResumeRun}
              className="enterprise-button enterprise-button-primary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction?.startsWith('resume-') ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              Resume
            </button>
          </div>
        </div>
      ) : null}

      {selectedOpenWait ? (
        <div className="workspace-meta-card border-amber-200/80 bg-amber-50/50">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="workspace-meta-label">Pending request</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {selectedAttentionLabel}
              </p>
            </div>
            <StatusBadge tone="warning">{formatEnumLabel(selectedOpenWait.type)}</StatusBadge>
          </div>
          <div className="mt-3 rounded-2xl border border-outline-variant/25 bg-white/85 px-4 py-3">
            <MarkdownContent content={normalizeMarkdownishText(selectedOpenWait.message)} />
          </div>

          {dockMissingFieldLabels.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs leading-relaxed text-secondary">
                Click a chip to add it to your response.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {dockMissingFieldLabels.map(label => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onFieldChipClick(label)}
                    className="rounded-full border border-outline-variant/30 bg-white/85 px-3 py-1 text-xs font-semibold text-on-surface"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {waitRequiresApprovedWorkspace ? (
            <div className="mt-4 rounded-2xl border border-outline-variant/25 bg-white/85 px-4 py-3">
              <p className="workspace-meta-label">Approved workspace path</p>
              {hasApprovedWorkspaceConfigured ? (
                <>
                  <p className="mt-2 text-xs leading-relaxed text-secondary">Configured roots:</p>
                  <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
                    {approvedWorkspaceRoots.slice(0, 4).map(root => (
                      <li key={root} className="font-mono text-[0.72rem]">
                        {root}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-secondary">
                  No approved workspace paths are configured yet.
                </p>
              )}

              <p className="mt-3 text-xs leading-relaxed text-secondary">
                {hasApprovedWorkspaceConfigured
                  ? 'Add another path if this work item needs a different codebase.'
                  : 'Add a local directory path that tools are allowed to read and write.'}
              </p>
              <input
                value={approvedWorkspaceDraft}
                onChange={event => onApprovedWorkspaceDraftChange(event.target.value)}
                placeholder="/Users/you/projects/my-repo"
                className="mt-3 field-input font-mono text-[0.8rem]"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {approvedWorkspaceSuggestions.map(root => (
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
                  {busyAction === 'approveWorkspacePath' ? (
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
                    'mt-2 text-xs font-medium',
                    approvedWorkspaceValidation.valid ? 'text-emerald-700' : 'text-amber-800',
                  )}
                >
                  {approvedWorkspaceValidation.message}
                </p>
              ) : null}
              {!canEditCapability ? (
                <p className="mt-2 text-xs font-medium text-amber-800">
                  Approving new paths requires capability edit access. Switch Current Operator to a
                  workspace admin if needed.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="workspace-meta-card">
          No open approval, input, or conflict wait is attached to the selected work item right
          now.
        </div>
      )}
    </>
  );
};
