import React from 'react';
import { AlertCircle, ScrollText, Trash2 } from 'lucide-react';
import { StatusBadge } from '../EnterpriseUI';
import {
  OrchestratorCopilotComposer,
  type OrchestratorCopilotUploadChip,
} from './OrchestratorCopilotComposer';

type Props = {
  selectedWorkItemPresent: boolean;
  selectedWorkItemId?: string | null;
  selectedWorkItemTitle?: string | null;
  primaryCopilotAgentName?: string | null;
  copilotRoutingLabel?: string | null;
  dockMessagesCount: number;
  busyAction: string | null;
  canOpenReleasePassport?: boolean;
  onOpenReleasePassport?: () => void;
  onClearChat: () => void;
  statusContent: React.ReactNode;
  threadContent: React.ReactNode;
  dockError: string;
  onComposerDrop: (files: FileList | null) => void;
  dockComposerLabel: string;
  dockInput: string;
  onDockInputChange: (value: string) => void;
  dockComposerPlaceholder: string;
  helperText?: React.ReactNode;
  dockUploads: OrchestratorCopilotUploadChip[];
  renderUploadIcon?: (upload: OrchestratorCopilotUploadChip) => React.ReactNode;
  formatAttachmentSizeLabel: (sizeBytes?: number) => string;
  onRemoveUpload: (uploadId: string) => void;
  onAddUploads: (files: FileList | null) => void;
  selectedOpenWaitPresent: boolean;
  dockAllowsChatOnly: boolean;
  isDockSending: boolean;
  canWriteChat: boolean;
  onAskAgent: () => void;
  onResolveWait: () => void;
  onDelegateToHuman?: () => void;
  dockCanResolveWait: boolean;
  dockCanDelegateToHuman?: boolean;
  dockPrimaryActionLabel: string;
  selectedOpenWaitType?: 'APPROVAL' | 'HUMAN_TASK' | 'INPUT' | 'CONFLICT_RESOLUTION' | 'SUB_WORKFLOW_WAIT' | null;
  selectedCanGuideBlockedAgent: boolean;
  onGuideAndRestart: () => void;
  canStartExecution: boolean;
  onStartExecution: () => void;
  dockTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * Optional swarm-composer ribbon. Rendered between the thread and the
   * composer when 2–3 participants are tagged. When no swarm is staged the
   * parent should pass `null` so the ribbon doesn't eat vertical space.
   */
  swarmRibbon?: React.ReactNode;
  /**
   * Optional full replacement for the transcript when a swarm session is
   * active. Falls back to `threadContent` when undefined.
   */
  swarmTranscriptOverride?: React.ReactNode;
  /**
   * Optional review card (plan vs. disagreement) rendered below the
   * transcript when the active swarm session has reached a terminal state.
   */
  swarmReviewCard?: React.ReactNode;
};

export const OrchestratorCopilotDock = ({
  selectedWorkItemPresent,
  selectedWorkItemId,
  selectedWorkItemTitle,
  primaryCopilotAgentName,
  copilotRoutingLabel,
  dockMessagesCount,
  busyAction,
  canOpenReleasePassport,
  onOpenReleasePassport,
  onClearChat,
  statusContent,
  threadContent,
  dockError,
  onComposerDrop,
  dockComposerLabel,
  dockInput,
  onDockInputChange,
  dockComposerPlaceholder,
  helperText,
  dockUploads,
  renderUploadIcon,
  formatAttachmentSizeLabel,
  onRemoveUpload,
  onAddUploads,
  selectedOpenWaitPresent,
  dockAllowsChatOnly,
  isDockSending,
  canWriteChat,
  onAskAgent,
  onResolveWait,
  onDelegateToHuman,
  dockCanResolveWait,
  dockCanDelegateToHuman = false,
  dockPrimaryActionLabel,
  selectedOpenWaitType,
  selectedCanGuideBlockedAgent,
  onGuideAndRestart,
  canStartExecution,
  onStartExecution,
  dockTextareaRef,
  swarmRibbon,
  swarmTranscriptOverride,
  swarmReviewCard,
}: Props) => (
  <section className="workspace-surface orchestrator-copilot-dock-shell flex min-h-0 flex-col p-0">
    <div className="orchestrator-copilot-dock-header border-b border-outline-variant/25 px-5 pb-4 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="form-kicker">Capability Copilot</p>
          <h2 className="mt-1 text-xl font-bold text-on-surface">Operate from one dock</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-secondary">
            Keep the developer loop in one place: review what is blocked, ask follow-up questions,
            upload evidence, and unblock or restart execution without jumping between surfaces.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedWorkItemPresent && selectedWorkItemId ? (
              <StatusBadge tone="neutral">
                {selectedWorkItemId}
                {selectedWorkItemTitle ? ` · ${selectedWorkItemTitle}` : ''}
              </StatusBadge>
            ) : null}
            {primaryCopilotAgentName ? (
              <StatusBadge tone="brand">{primaryCopilotAgentName}</StatusBadge>
            ) : null}
            {copilotRoutingLabel ? (
              <StatusBadge tone="neutral">{copilotRoutingLabel}</StatusBadge>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          {canOpenReleasePassport ? (
            <button
              type="button"
              onClick={onOpenReleasePassport}
              className="enterprise-button enterprise-button-brand-muted px-3 py-2 text-[0.72rem]"
            >
              <ScrollText size={14} />
              Release Passport
            </button>
          ) : null}
          <StatusBadge tone="neutral">
            {dockMessagesCount} message{dockMessagesCount === 1 ? '' : 's'}
          </StatusBadge>
          <button
            type="button"
            onClick={onClearChat}
            disabled={!selectedWorkItemPresent || dockMessagesCount === 0 || busyAction !== null}
            className="enterprise-button enterprise-button-secondary border-red-200 px-3 py-2 text-[0.72rem] text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={14} />
            Clear chat
          </button>
        </div>
      </div>
    </div>

    <div className="orchestrator-copilot-dock-body">
      <div className="orchestrator-copilot-dock-status custom-scrollbar">{statusContent}</div>

      {swarmTranscriptOverride ?? threadContent}

      {swarmReviewCard ? (
        <div className="px-5 pb-2">{swarmReviewCard}</div>
      ) : null}

      {swarmRibbon ? <div className="px-5 pt-2">{swarmRibbon}</div> : null}

      {dockError ? (
        <div className="workspace-inline-alert workspace-inline-alert-danger mx-5 mt-4">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Copilot dock error</p>
            <p className="mt-1 text-sm leading-relaxed">{dockError}</p>
          </div>
        </div>
      ) : null}

      <OrchestratorCopilotComposer
        onComposerDrop={onComposerDrop}
        dockComposerLabel={dockComposerLabel}
        dockInput={dockInput}
        onDockInputChange={onDockInputChange}
        dockComposerPlaceholder={dockComposerPlaceholder}
        helperText={helperText}
        dockUploads={dockUploads}
        renderUploadIcon={renderUploadIcon}
        formatAttachmentSizeLabel={formatAttachmentSizeLabel}
        onRemoveUpload={onRemoveUpload}
        onAddUploads={onAddUploads}
        selectedOpenWaitPresent={selectedOpenWaitPresent}
        dockAllowsChatOnly={dockAllowsChatOnly}
        isDockSending={isDockSending}
        canWriteChat={canWriteChat}
        onAskAgent={onAskAgent}
        onResolveWait={onResolveWait}
        onDelegateToHuman={onDelegateToHuman}
        dockCanResolveWait={dockCanResolveWait}
        dockCanDelegateToHuman={dockCanDelegateToHuman}
        dockPrimaryActionLabel={dockPrimaryActionLabel}
        selectedOpenWaitType={selectedOpenWaitType}
        selectedCanGuideBlockedAgent={selectedCanGuideBlockedAgent}
        onGuideAndRestart={onGuideAndRestart}
        canStartExecution={canStartExecution}
        onStartExecution={onStartExecution}
        busyAction={busyAction}
        dockTextareaRef={dockTextareaRef}
      />
    </div>
  </section>
);
