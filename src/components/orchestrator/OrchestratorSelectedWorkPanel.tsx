import React from 'react';
import {
  AlertCircle,
  FileText,
  LoaderCircle,
  MessageSquareText,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { EmptyState, StatusBadge } from '../EnterpriseUI';
import type { WorkItem } from '../../types';

type Props = {
  selectedWorkItem: WorkItem | null;
  emptyStateIcon: React.ComponentType<{ size?: number; className?: string }>;
  phaseLabel: string;
  phaseTone: string;
  workItemStatusLabel: string;
  workItemStatusTone: string;
  currentRunStatusLabel?: string | null;
  currentRunStatusTone?: string | null;
  canStartExecution: boolean;
  canReadChat: boolean;
  canControlWorkItems: boolean;
  currentRunIsActive: boolean;
  currentRunIsPaused: boolean;
  selectedCurrentStepLabel: string;
  selectedAgentLabel: string;
  selectedAttentionTimestamp?: string;
  selectedAttentionLabel: string;
  selectedNextActionSummary: string;
  selectedStateSummary: string;
  selectedBlockerSummary: string;
  actionError: string;
  busyAction: string | null;
  onStartExecution: () => void;
  onExplain: () => void;
  onCreateEvidencePacket: () => void;
  onOpenFullChat: () => void;
  onPauseRun: () => void;
  onResumeRun: () => void;
  onOpenRestore: () => void;
  onOpenArchive: () => void;
  onOpenCancel: () => void;
  formatTimestamp: (value?: string) => string;
};

export const OrchestratorSelectedWorkPanel = ({
  selectedWorkItem,
  emptyStateIcon,
  phaseLabel,
  phaseTone,
  workItemStatusLabel,
  workItemStatusTone,
  currentRunStatusLabel,
  currentRunStatusTone,
  canStartExecution,
  canReadChat,
  canControlWorkItems,
  currentRunIsActive,
  currentRunIsPaused,
  selectedCurrentStepLabel,
  selectedAgentLabel,
  selectedAttentionTimestamp,
  selectedAttentionLabel,
  selectedNextActionSummary,
  selectedStateSummary,
  selectedBlockerSummary,
  actionError,
  busyAction,
  onStartExecution,
  onExplain,
  onCreateEvidencePacket,
  onOpenFullChat,
  onPauseRun,
  onResumeRun,
  onOpenRestore,
  onOpenArchive,
  onOpenCancel,
  formatTimestamp,
}: Props) => (
  <section className="workspace-surface orchestrator-list-summary-panel overflow-hidden p-0">
    {!selectedWorkItem ? (
      <EmptyState
        title="Select a work item"
        description="Choose an item from the inbox to see the current state, controls, and next action."
        icon={emptyStateIcon}
        className="h-full min-h-[28rem]"
      />
    ) : (
      <div className="flex h-full flex-col">
        <div className="border-b border-outline-variant/25 px-5 pb-4 pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="form-kicker">{selectedWorkItem.id}</p>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={phaseTone}>{phaseLabel}</StatusBadge>
              <StatusBadge tone={workItemStatusTone}>{workItemStatusLabel}</StatusBadge>
              {currentRunStatusLabel && currentRunStatusTone ? (
                <StatusBadge tone={currentRunStatusTone}>{currentRunStatusLabel}</StatusBadge>
              ) : null}
            </div>
          </div>

          <h2 className="mt-4 text-xl font-bold tracking-tight text-on-surface">
            {selectedWorkItem.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            {selectedWorkItem.description || 'No description was captured for this work item.'}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {canStartExecution ? (
              <button
                type="button"
                onClick={onStartExecution}
                disabled={busyAction !== null}
                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === 'start' ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Play size={16} />
                )}
                Start execution
              </button>
            ) : null}
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
              disabled={!canReadChat}
              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MessageSquareText size={16} />
              Open full chat
            </button>
            {currentRunIsActive ? (
              <button
                type="button"
                onClick={onPauseRun}
                disabled={!canControlWorkItems || busyAction !== null}
                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === `pause-${selectedWorkItem.id}` ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Pause size={16} />
                )}
                Pause
              </button>
            ) : null}
            {currentRunIsPaused ? (
              <button
                type="button"
                onClick={onResumeRun}
                disabled={!canControlWorkItems || busyAction !== null}
                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === `resume-${selectedWorkItem.id}` ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Play size={16} />
                )}
                Resume
              </button>
            ) : null}
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
                  className="enterprise-button enterprise-button-secondary border-red-200 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
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

        <div className="custom-scrollbar flex-1 overflow-y-auto px-5 py-4">
          {actionError ? (
            <div className="workspace-inline-alert workspace-inline-alert-danger">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Action failed</p>
                <p className="mt-1 text-sm leading-relaxed">{actionError}</p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">What’s next</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {selectedAttentionLabel}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {selectedNextActionSummary}
              </p>
            </div>
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Current step</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {selectedCurrentStepLabel}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Agent: {selectedAgentLabel}
              </p>
              {selectedAttentionTimestamp ? (
                <p className="mt-2 text-xs text-secondary">
                  Updated {formatTimestamp(selectedAttentionTimestamp)}
                </p>
              ) : null}
            </div>
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Current state</p>
              <p className="mt-2 text-sm leading-relaxed text-on-surface">
                {selectedStateSummary}
              </p>
            </div>
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">What is blocked</p>
              <p className="mt-2 text-sm leading-relaxed text-on-surface">
                {selectedBlockerSummary}
              </p>
            </div>
          </div>
        </div>
      </div>
    )}
  </section>
);
