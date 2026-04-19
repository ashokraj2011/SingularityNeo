import React from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import { StatusBadge } from '../EnterpriseUI';
import {
  OrchestratorCopilotComposer,
  type OrchestratorCopilotUploadChip,
} from './OrchestratorCopilotComposer';

type Props = {
  selectedWorkItemPresent: boolean;
  primaryCopilotAgentName?: string | null;
  copilotRoutingLabel?: string | null;
  dockMessagesCount: number;
  busyAction: string | null;
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
  dockCanResolveWait: boolean;
  dockPrimaryActionLabel: string;
  selectedOpenWaitType?: 'APPROVAL' | 'INPUT' | 'CONFLICT_RESOLUTION' | null;
  selectedCanGuideBlockedAgent: boolean;
  onGuideAndRestart: () => void;
  canStartExecution: boolean;
  onStartExecution: () => void;
  dockTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
};

export const OrchestratorCopilotDock = ({
  selectedWorkItemPresent,
  primaryCopilotAgentName,
  copilotRoutingLabel,
  dockMessagesCount,
  busyAction,
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
  dockCanResolveWait,
  dockPrimaryActionLabel,
  selectedOpenWaitType,
  selectedCanGuideBlockedAgent,
  onGuideAndRestart,
  canStartExecution,
  onStartExecution,
  dockTextareaRef,
}: Props) => (
  <section className="workspace-surface orchestrator-copilot-dock-shell flex min-h-0 flex-col p-0">
    <div className="border-b border-outline-variant/25 px-5 pb-4 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="form-kicker">Capability Copilot</p>
          <h2 className="mt-1 text-lg font-bold text-on-surface">Operate from one dock</h2>
          <p className="mt-1 text-sm leading-relaxed text-secondary">
            Upload evidence, ask questions, and resolve pending requests without switching screens.
          </p>
          {primaryCopilotAgentName ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge tone="brand">{primaryCopilotAgentName}</StatusBadge>
              {copilotRoutingLabel ? (
                <StatusBadge tone="neutral">{copilotRoutingLabel}</StatusBadge>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

      {threadContent}

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
        dockCanResolveWait={dockCanResolveWait}
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
