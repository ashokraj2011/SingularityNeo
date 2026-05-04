import React from 'react';
import {
  ExternalLink,
  FileCode,
  FileText,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import ArtifactPreview from '../ArtifactPreview';
import ErrorBoundary from '../ErrorBoundary';
import InteractionTimeline from '../InteractionTimeline';
import { formatEnumLabel, getStatusTone } from '../../lib/enterprise';
import { compactMarkdownPreview } from '../../lib/markdown';
import { cn } from '../../lib/utils';
import {
  describeApprovalTarget,
  formatTimestamp,
  type ArtifactWorkbenchFilter,
  type Artifact,
  type ApprovalAssignment,
  type ApprovalDecision,
  type RunWait,
} from '../../lib/orchestrator/support';
import type { ApprovalPolicy, CapabilityInteractionFeed } from '../../types';
import { ModalShell, StatusBadge } from '../EnterpriseUI';

type Props = {
  workItemTitle: string;
  approvalWait: RunWait;
  isHydrated: boolean;
  onClose: () => void;
  currentPhaseLabel: string;
  currentStepName: string;
  currentRunId: string;
  requestedByLabel: string;
  requestedAt?: string;
  totalDocuments: number;
  hasCodeDiffApproval: boolean;
  approvalAssignments: ApprovalAssignment[];
  approvalDecisionByAssignmentId: Map<string, ApprovalDecision>;
  unassignedApprovalDecisions: ApprovalDecision[];
  workspaceUsersById: Map<string, { name: string }>;
  workspaceTeamsById: Map<string, { name: string }>;
  interactionFeed: CapabilityInteractionFeed;
  onOpenArtifactFromTimeline: (artifactId: string) => void;
  onOpenRunFromTimeline: (runId: string) => void;
  onOpenTaskFromTimeline: (taskId: string) => void;
  filteredApprovalArtifacts: Artifact[];
  /** Optional pre-filter counts per category — when present, rendered next to each chip. */
  approvalArtifactFilterCounts?: Partial<Record<ArtifactWorkbenchFilter, number>>;
  /** Optional artifact search string. */
  approvalArtifactSearch?: string;
  onApprovalArtifactSearchChange?: (value: string) => void;
  approvalArtifactFilter: ArtifactWorkbenchFilter;
  onApprovalArtifactFilterChange: (value: ArtifactWorkbenchFilter) => void;
  selectedApprovalArtifact: Artifact | null;
  selectedApprovalArtifactDocument: string;
  onSelectApprovalArtifact: (artifactId: string) => void;
  resolutionNote: string;
  onResolutionNoteChange: (value: string) => void;
  resolutionPlaceholder: string;
  requestChangesIsAvailable: boolean;
  canRequestChanges: boolean;
  canResolveSelectedWait: boolean;
  busyAction: string | null;
  onRequestChanges: () => void;
  onResolveWait: () => void;
  actionButtonLabel: string;
  onOpenDiffReview: () => void;
  resetKey: string;
  approvalPolicy?: ApprovalPolicy | null;
};

export const OrchestratorApprovalReviewModal = ({
  workItemTitle,
  approvalWait,
  isHydrated,
  onClose,
  currentPhaseLabel,
  currentStepName,
  currentRunId,
  requestedByLabel,
  requestedAt,
  totalDocuments,
  hasCodeDiffApproval,
  approvalAssignments,
  approvalDecisionByAssignmentId,
  unassignedApprovalDecisions,
  workspaceUsersById,
  workspaceTeamsById,
  interactionFeed,
  onOpenArtifactFromTimeline,
  onOpenRunFromTimeline,
  onOpenTaskFromTimeline,
  filteredApprovalArtifacts,
  approvalArtifactFilter,
  onApprovalArtifactFilterChange,
  approvalArtifactFilterCounts,
  approvalArtifactSearch,
  onApprovalArtifactSearchChange,
  selectedApprovalArtifact,
  selectedApprovalArtifactDocument,
  onSelectApprovalArtifact,
  resolutionNote,
  onResolutionNoteChange,
  resolutionPlaceholder,
  requestChangesIsAvailable,
  canRequestChanges,
  canResolveSelectedWait,
  busyAction,
  onRequestChanges,
  onResolveWait,
  actionButtonLabel,
  onOpenDiffReview,
  resetKey,
  approvalPolicy,
}: Props) => {
  // ── Policy-progress computations ─────────────────────────────────────────
  const allDecisions = [
    ...Array.from(approvalDecisionByAssignmentId.values()),
    ...unassignedApprovalDecisions,
  ];
  const approvedCount = allDecisions.filter(d => d.disposition === 'APPROVE').length;

  const policyMode = approvalPolicy?.mode ?? 'ANY_ONE';
  const requiredCount = (() => {
    switch (policyMode) {
      case 'ANY_ONE':
        return 1;
      case 'ALL_REQUIRED':
        return Math.max(approvalAssignments.length, 1);
      case 'QUORUM':
        return approvalPolicy?.minimumApprovals && approvalPolicy.minimumApprovals > 0
          ? approvalPolicy.minimumApprovals
          : Math.max(Math.ceil(approvalAssignments.length / 2), 1);
      default:
        return 1;
    }
  })();

  const policyModeLabel = (() => {
    switch (policyMode) {
      case 'ANY_ONE':
        return 'Any one approval';
      case 'ALL_REQUIRED':
        return 'All approvers required';
      case 'QUORUM':
        return `Quorum — ${requiredCount} of ${Math.max(approvalAssignments.length, requiredCount)} required`;
      default:
        return 'Any one approval';
    }
  })();

  const coverageTone =
    approvedCount >= requiredCount
      ? 'success'
      : approvedCount > 0
        ? 'warning'
        : 'info';

  return (
    <div className="desktop-content-modal-overlay z-[91] px-4 py-10">
    <button
      type="button"
      aria-label="Close approval review"
      onClick={onClose}
      className="desktop-content-modal-backdrop"
    />
    <ModalShell
      title={`Approval review · ${workItemTitle}`}
      description="Review the full approval context here: the work-item artifacts, attempt story, approval routing, and your final decision all live in this screen."
      eyebrow="Human Approval Gate"
      className="relative z-[1] max-w-7xl"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warning">Approval required</StatusBadge>
          <button type="button" onClick={onClose} className="workspace-list-action">
            <X size={14} />
          </button>
        </div>
      }
    >
      <ErrorBoundary
        resetKey={resetKey}
        title="Approval review could not render"
        description="One of the approval documents could not be previewed safely. The route stays intact, and you can close this window or try a different document."
      >
        {!isHydrated ? (
          <div className="flex min-h-[18rem] items-center justify-center">
            <div className="flex items-center gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm text-secondary">
              <LoaderCircle size={16} className="animate-spin" />
              Preparing approval documents...
            </div>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,24rem)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="workspace-meta-card">
                <p className="workspace-meta-label">Approval summary</p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">{approvalWait.message}</p>
              </div>
              <div className="workspace-meta-card">
                <p className="workspace-meta-label">Current context</p>
                <div className="mt-3 space-y-2 text-sm text-secondary">
                  <p>
                    Phase: <strong className="text-on-surface">{currentPhaseLabel}</strong>
                  </p>
                  <p>
                    Step: <strong className="text-on-surface">{currentStepName}</strong>
                  </p>
                  <p>
                    Run: <strong className="text-on-surface">{currentRunId}</strong>
                  </p>
                  <p>
                    All approval decisions for this gate must be recorded from this review
                    window.
                  </p>
                </div>
              </div>
              <div className="workspace-meta-card">
                <p className="workspace-meta-label">Review facts</p>
                <div className="mt-3 space-y-2 text-sm text-secondary">
                  <p>
                    Requested by:{' '}
                    <strong className="text-on-surface">{requestedByLabel || 'System'}</strong>
                  </p>
                  <p>
                    Since:{' '}
                    <strong className="text-on-surface">{formatTimestamp(requestedAt)}</strong>
                  </p>
                  <p>
                    Documents so far:{' '}
                    <strong className="text-on-surface">{totalDocuments}</strong>
                  </p>
                  <p>
                    Code diff attached:{' '}
                    <strong className="text-on-surface">
                      {hasCodeDiffApproval ? 'Yes' : 'No'}
                    </strong>
                  </p>
                  <p>
                    Policy:{' '}
                    <strong className="text-on-surface">{policyModeLabel}</strong>
                  </p>
                  <p>
                    Progress:{' '}
                    <strong
                      className={
                        approvedCount >= requiredCount
                          ? 'text-emerald-600'
                          : approvedCount > 0
                            ? 'text-amber-600'
                            : 'text-on-surface'
                      }
                    >
                      {approvedCount} of {requiredCount} approval
                      {requiredCount === 1 ? '' : 's'} received
                    </strong>
                  </p>
                </div>
              </div>
              <div className="workspace-meta-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="workspace-meta-label">Approval coverage</p>
                    <p className="mt-2 text-sm leading-relaxed text-secondary">
                      These assignments are the durable approval records for this gate.
                    </p>
                  </div>
                  <StatusBadge tone={coverageTone}>
                    {approvedCount} / {requiredCount} approved
                  </StatusBadge>
                </div>
                {approvalAssignments.length === 0 ? (
                  <p className="mt-3 text-sm leading-relaxed text-secondary">
                    No explicit approval assignments were created for this gate. The phase owner
                    team or legacy approver roles will act as the fallback routing.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {approvalAssignments.map(assignment => {
                      const linkedDecision = approvalDecisionByAssignmentId.get(assignment.id);
                      return (
                        <div
                          key={assignment.id}
                          className="rounded-2xl border border-outline-variant/25 bg-white px-4 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-on-surface">
                                {describeApprovalTarget(assignment, {
                                  usersById: workspaceUsersById,
                                  teamsById: workspaceTeamsById,
                                })}
                              </p>
                              <p className="mt-1 text-xs text-secondary">
                                {formatEnumLabel(assignment.targetType)}
                                {assignment.dueAt
                                  ? ` · Due ${formatTimestamp(assignment.dueAt)}`
                                  : ''}
                              </p>
                            </div>
                            <StatusBadge tone={getStatusTone(assignment.status)}>
                              {formatEnumLabel(assignment.status)}
                            </StatusBadge>
                          </div>
                          {linkedDecision ? (
                            <p className="mt-2 text-xs leading-relaxed text-secondary">
                              {linkedDecision.actorDisplayName} recorded{' '}
                              <strong className="text-on-surface">
                                {formatEnumLabel(linkedDecision.disposition)}
                              </strong>
                              {linkedDecision.comment
                                ? ` · ${compactMarkdownPreview(linkedDecision.comment, 120)}`
                                : ''}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
                {unassignedApprovalDecisions.length > 0 ? (
                  <div className="mt-4 rounded-2xl border border-outline-variant/25 bg-white px-4 py-3">
                    <p className="workspace-meta-label">Recorded decisions without assignment link</p>
                    <div className="mt-3 space-y-2">
                      {unassignedApprovalDecisions.map(decision => (
                        <p key={decision.id} className="text-xs leading-relaxed text-secondary">
                          {decision.actorDisplayName} ·{' '}
                          <strong className="text-on-surface">
                            {formatEnumLabel(decision.disposition)}
                          </strong>
                          {decision.comment
                            ? ` · ${compactMarkdownPreview(decision.comment, 140)}`
                            : ''}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              <InteractionTimeline
                feed={interactionFeed}
                maxItems={6}
                title="Context story"
                emptyMessage="No linked interaction context is available for this approval yet."
                onOpenArtifact={onOpenArtifactFromTimeline}
                onOpenRun={onOpenRunFromTimeline}
                onOpenTask={onOpenTaskFromTimeline}
              />
              {hasCodeDiffApproval ? (
                <button
                  type="button"
                  onClick={onOpenDiffReview}
                  className="enterprise-button enterprise-button-secondary w-full justify-between"
                >
                  <span>Open code diff review</span>
                  <ExternalLink size={16} />
                </button>
              ) : null}
            </div>

            <div className="workspace-meta-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="workspace-meta-label">Documents so far</p>
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    Inputs, outputs, handoffs, approvals, and diffs attached to this work item.
                  </p>
                </div>
                <StatusBadge tone="info">{filteredApprovalArtifacts.length} items</StatusBadge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {([
                  ['ALL', 'All'],
                  ['INPUTS', 'Inputs'],
                  ['OUTPUTS', 'Outputs'],
                  ['DIFFS', 'Diffs'],
                  ['APPROVALS', 'Approvals'],
                  ['HANDOFFS', 'Handoffs'],
                ] as const).map(([value, label]) => {
                  const count = approvalArtifactFilterCounts?.[value];
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onApprovalArtifactFilterChange(value)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                        approvalArtifactFilter === value
                          ? 'border-primary/30 bg-primary text-white'
                          : 'border-outline-variant/30 bg-surface-container-low text-secondary hover:border-primary/20 hover:text-primary',
                      )}
                    >
                      <span>{label}</span>
                      {typeof count === 'number' && (
                        <span
                          className={cn(
                            'rounded-full px-1.5 text-[0.62rem] font-bold',
                            approvalArtifactFilter === value
                              ? 'bg-white/20 text-white'
                              : 'bg-primary/10 text-primary',
                          )}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Artifact search */}
              {onApprovalArtifactSearchChange && (
                <div className="mt-3">
                  <input
                    type="search"
                    value={approvalArtifactSearch ?? ''}
                    onChange={(e) => onApprovalArtifactSearchChange(e.target.value)}
                    placeholder="Search artifacts by name or description…"
                    className="w-full rounded-lg border border-outline-variant/40 bg-white px-3 py-1.5 text-xs text-on-surface placeholder-secondary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              )}

              {filteredApprovalArtifacts.length === 0 ? (
                <div className="mt-4 rounded-3xl border border-outline-variant/35 bg-surface-container-low px-4 py-4 text-sm text-secondary">
                  No documents match the selected filter yet for this approval review.
                </div>
              ) : (
                <div className="orchestrator-artifact-list max-h-[65vh] overflow-y-auto pr-1">
                  {filteredApprovalArtifacts.map(artifact => (
                    <button
                      key={artifact.id}
                      type="button"
                      onClick={() => onSelectApprovalArtifact(artifact.id)}
                      className={cn(
                        'orchestrator-artifact-list-item',
                        selectedApprovalArtifact?.id === artifact.id &&
                          'orchestrator-artifact-list-item-active',
                      )}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 rounded-2xl bg-primary/10 p-2 text-primary">
                          {artifact.contentFormat === 'MARKDOWN' ||
                          artifact.contentFormat === 'TEXT' ? (
                            <FileText size={16} />
                          ) : (
                            <FileCode size={16} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-on-surface">
                              {artifact.name}
                            </p>
                            <StatusBadge tone="brand">
                              {artifact.direction || 'OUTPUT'}
                            </StatusBadge>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-secondary">
                            {compactMarkdownPreview(
                              artifact.summary ||
                                artifact.description ||
                                `${artifact.type} · ${artifact.version}`,
                              120,
                            )}
                          </p>
                        </div>
                      </div>
                      <span className="text-[0.72rem] font-medium text-secondary">
                        {formatTimestamp(artifact.created)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="workspace-meta-card orchestrator-preview-panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="workspace-meta-label">Document preview</p>
                  <p className="mt-2 text-sm font-semibold text-on-surface">
                    {selectedApprovalArtifact?.name || 'No document selected'}
                  </p>
                  <p className="mt-1 text-xs text-secondary">
                    {selectedApprovalArtifact
                      ? compactMarkdownPreview(
                          selectedApprovalArtifact.summary ||
                            selectedApprovalArtifact.description ||
                            `${selectedApprovalArtifact.type} · ${selectedApprovalArtifact.version}`,
                          160,
                        )
                      : 'Select a document to inspect the approval packet body.'}
                  </p>
                </div>
                {selectedApprovalArtifact ? (
                  <StatusBadge tone="info">
                    {selectedApprovalArtifact.contentFormat || 'TEXT'}
                  </StatusBadge>
                ) : null}
              </div>

              <div className="mt-4 rounded-2xl border border-outline-variant/35 bg-white px-5 py-4">
                {selectedApprovalArtifactDocument ? (
                  <div className="max-h-[42vh] overflow-y-auto pr-1">
                    <ArtifactPreview
                      format={selectedApprovalArtifact?.contentFormat}
                      content={selectedApprovalArtifactDocument}
                    />
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-secondary">
                    The selected document does not have a previewable text body yet.
                  </p>
                )}
              </div>

              <div className="mt-4 rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-4">
                <p className="workspace-meta-label">Approval / change note</p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  Capture sign-off conditions, review comments, or the exact changes you want
                  before the workflow continues.
                </p>
                <textarea
                  value={resolutionNote}
                  onChange={event => onResolutionNoteChange(event.target.value)}
                  placeholder={resolutionPlaceholder}
                  className="field-textarea mt-3 h-28 bg-white"
                />
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {requestChangesIsAvailable ? (
                    <button
                      type="button"
                      onClick={onRequestChanges}
                      disabled={!canRequestChanges || busyAction !== null}
                      className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busyAction === 'requestChanges' ? (
                        <LoaderCircle size={16} className="animate-spin" />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                      Request changes
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onResolveWait}
                    disabled={!canResolveSelectedWait || busyAction !== null}
                    className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === 'resolve' ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <ShieldCheck size={16} />
                    )}
                    {actionButtonLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </ErrorBoundary>
    </ModalShell>
  </div>
  );
};
