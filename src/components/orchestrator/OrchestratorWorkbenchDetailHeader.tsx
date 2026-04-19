import React from 'react';
import {
  ArrowRight,
  FileText,
  LoaderCircle,
  MessageSquareText,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { WorkItem } from '../../types';
import { StatusBadge } from '../EnterpriseUI';

type Tone = React.ComponentProps<typeof StatusBadge>['tone'];

type Props = {
  selectedWorkItem: WorkItem;
  phaseLabel: string;
  phaseTone: Tone;
  taskTypeLabel: string;
  workItemStatusLabel: string;
  workItemStatusTone: Tone;
  currentRunStatusLabel?: string | null;
  currentRunStatusTone?: Tone | null;
  selectedPhaseOwnerTeamName?: string | null;
  selectedClaimOwnerName?: string | null;
  selectedPresenceUserNames: string[];
  selectedCanGuideBlockedAgent: boolean;
  showApprovalReviewButton: boolean;
  canStartExecution: boolean;
  startExecutionLabel: string;
  canRestartFromPhase: boolean;
  restartPhaseLabel: string;
  canResetAndRestart: boolean;
  selectedCanTakeControl: boolean;
  currentActorOwnsSelectedWorkItem: boolean;
  canControlWorkItems: boolean;
  currentRunIsActive: boolean;
  busyAction: string | null;
  canReadChat: boolean;
  hasSelectedAgent: boolean;
  onBackToFlowMap: () => void;
  onExplain: () => void;
  onCreateEvidencePacket: () => void;
  onOpenFullChat: () => void;
  onTakeControl: () => void;
  onToggleControl: () => void;
  onApprovalReviewMouseDown: React.MouseEventHandler<HTMLButtonElement>;
  onOpenApprovalReview: () => void;
  onStartExecution: () => void;
  onRestartExecution: () => void;
  onResetAndRestart: () => void;
  onGuideBlockedAgent: () => void;
  onCancelRun: () => void;
  onOpenRestore: () => void;
  onOpenArchive: () => void;
  onOpenCancel: () => void;
};

export const OrchestratorWorkbenchDetailHeader = ({
  selectedWorkItem,
  phaseLabel,
  phaseTone,
  taskTypeLabel,
  workItemStatusLabel,
  workItemStatusTone,
  currentRunStatusLabel,
  currentRunStatusTone,
  selectedPhaseOwnerTeamName,
  selectedClaimOwnerName,
  selectedPresenceUserNames,
  selectedCanGuideBlockedAgent,
  showApprovalReviewButton,
  canStartExecution,
  startExecutionLabel,
  canRestartFromPhase,
  restartPhaseLabel,
  canResetAndRestart,
  selectedCanTakeControl,
  currentActorOwnsSelectedWorkItem,
  canControlWorkItems,
  currentRunIsActive,
  busyAction,
  canReadChat,
  hasSelectedAgent,
  onBackToFlowMap,
  onExplain,
  onCreateEvidencePacket,
  onOpenFullChat,
  onTakeControl,
  onToggleControl,
  onApprovalReviewMouseDown,
  onOpenApprovalReview,
  onStartExecution,
  onRestartExecution,
  onResetAndRestart,
  onGuideBlockedAgent,
  onCancelRun,
  onOpenRestore,
  onOpenArchive,
  onOpenCancel,
}: Props) => (
  <div className="orchestrator-detail-header">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="form-kicker">{selectedWorkItem.id}</p>
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={phaseTone}>{phaseLabel}</StatusBadge>
        <StatusBadge tone="neutral">{taskTypeLabel}</StatusBadge>
        <StatusBadge tone={workItemStatusTone}>{workItemStatusLabel}</StatusBadge>
        {currentRunStatusLabel && currentRunStatusTone ? (
          <StatusBadge tone={currentRunStatusTone}>{currentRunStatusLabel}</StatusBadge>
        ) : null}
      </div>
    </div>

    <div className="mt-4 min-w-0">
      <h2 className="text-xl font-bold tracking-tight text-on-surface">{selectedWorkItem.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-secondary">
        {selectedWorkItem.description ||
          'No description was captured when this work item was staged into execution.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-secondary">
        {selectedPhaseOwnerTeamName ? (
          <span className="rounded-full bg-surface-container px-3 py-1">
            Phase owner team: {selectedPhaseOwnerTeamName}
          </span>
        ) : null}
        {selectedClaimOwnerName ? (
          <span className="rounded-full bg-surface-container px-3 py-1">
            Active operator: {selectedClaimOwnerName}
          </span>
        ) : null}
        {selectedPresenceUserNames.length > 0 ? (
          <span className="rounded-full bg-surface-container px-3 py-1">
            Watching: {selectedPresenceUserNames.join(', ')}
          </span>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onBackToFlowMap}
          className="enterprise-button enterprise-button-secondary"
        >
          <ArrowRight size={16} className="rotate-180" />
          Back to flow map
        </button>
        <button
          type="button"
          onClick={onExplain}
          className="enterprise-button enterprise-button-secondary"
        >
          Explain
        </button>
        <button
          type="button"
          onClick={onCreateEvidencePacket}
          disabled={busyAction !== null}
          className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busyAction === 'evidencePacket' ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <FileText size={16} />
          )}
          Evidence packet
        </button>
        <button
          type="button"
          onClick={onOpenFullChat}
          disabled={!hasSelectedAgent || !canReadChat}
          className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MessageSquareText size={16} />
          Open full chat
        </button>
        <button
          type="button"
          onClick={onTakeControl}
          disabled={!selectedCanTakeControl}
          className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MessageSquareText size={16} />
          Take control
        </button>
        <button
          type="button"
          onClick={onToggleControl}
          disabled={!canControlWorkItems}
          className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <User size={16} />
          {currentActorOwnsSelectedWorkItem ? 'Release control' : 'Claim control'}
        </button>
      </div>

      <div className="mt-4 rounded-[1.5rem] border border-outline-variant/25 bg-surface-container-low/60 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Top controls</p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Keep the primary run actions close to the title so you can start, restart, review
              approvals, or guide blocked work without hunting through the page.
            </p>
          </div>
          {selectedCanGuideBlockedAgent ? (
            <StatusBadge tone="warning">Blocked work needs guidance</StatusBadge>
          ) : showApprovalReviewButton ? (
            <StatusBadge tone="warning">Approval review waiting</StatusBadge>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {showApprovalReviewButton ? (
            <button
              type="button"
              onMouseDown={onApprovalReviewMouseDown}
              onClick={onOpenApprovalReview}
              className="enterprise-button enterprise-button-primary"
            >
              <ShieldCheck size={16} />
              Review approval gate
            </button>
          ) : null}

          <button
            type="button"
            onClick={onStartExecution}
            disabled={!canStartExecution || busyAction !== null}
            className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyAction === 'start' ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {startExecutionLabel}
          </button>

          <button
            type="button"
            onClick={onRestartExecution}
            disabled={!canRestartFromPhase || busyAction !== null}
            className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyAction === 'restart' ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            {restartPhaseLabel}
          </button>

          <button
            type="button"
            onClick={onResetAndRestart}
            disabled={!canResetAndRestart || busyAction !== null}
            className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyAction === 'reset' ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Reset and restart
          </button>

          {selectedCanGuideBlockedAgent ? (
            <button
              type="button"
              onClick={onGuideBlockedAgent}
              className="enterprise-button enterprise-button-brand-muted"
            >
              <ArrowRight size={16} />
              Guide blocked agent
            </button>
          ) : null}

          <button
            type="button"
            onClick={onCancelRun}
            disabled={!currentRunIsActive || busyAction !== null}
            className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyAction === 'cancel' ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Square size={16} />
            )}
            Cancel run
          </button>

          {selectedWorkItem.status === 'ARCHIVED' ? (
            <button
              type="button"
              onClick={onOpenRestore}
              disabled={busyAction !== null}
              className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw size={16} />
              Restore
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onOpenArchive}
                disabled={busyAction !== null}
                className={cn(
                  'enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40',
                  'border-red-200 text-red-700 hover:bg-red-50',
                )}
              >
                <Trash2 size={16} />
                Delete
              </button>
              <button
                type="button"
                onClick={onOpenCancel}
                disabled={
                  busyAction !== null ||
                  selectedWorkItem.status === 'COMPLETED' ||
                  selectedWorkItem.status === 'CANCELLED'
                }
                className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={16} />
                Cancel work item
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  </div>
);
