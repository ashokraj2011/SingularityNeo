import React from 'react';
import {
  ArrowRight,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { FileText } from 'lucide-react';

export type OrchestratorCopilotUploadChip = {
  id: string;
  file: File;
  kind: 'image' | 'file';
  previewUrl?: string;
};

type Props = {
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
  busyAction: string | null;
  dockTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
};

export const OrchestratorCopilotComposer = ({
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
  busyAction,
  dockTextareaRef,
}: Props) => {
  const composerModeLabel = selectedOpenWaitPresent
    ? dockAllowsChatOnly
      ? 'Follow-up chat'
      : 'Workflow response'
    : selectedCanGuideBlockedAgent
      ? 'Restart brief'
      : canStartExecution
        ? 'Kickoff guidance'
        : 'Chat turn';
  const composerModeCopy = selectedOpenWaitPresent
    ? dockAllowsChatOnly
      ? 'Use this note to ask the agent a clarifying question before you resolve the gate.'
      : 'What you write here becomes the response that unblocks the workflow.'
    : selectedCanGuideBlockedAgent
      ? 'This note becomes the guidance for the next execution attempt.'
      : canStartExecution
        ? 'Optional context here is applied before the workflow starts.'
        : 'Use this area for normal copilot conversation and evidence uploads.';
  const primaryActionKind = selectedOpenWaitPresent
    ? 'Unblock action'
    : selectedCanGuideBlockedAgent
      ? 'Restart action'
      : canStartExecution
        ? 'Start action'
        : 'Send action';

  const renderAttachmentIcon = (upload: OrchestratorCopilotUploadChip) => {
    if (renderUploadIcon) {
      return renderUploadIcon(upload);
    }
    if (upload.kind === 'image' && upload.previewUrl) {
      return (
        <img
          src={upload.previewUrl}
          alt={upload.file.name}
          className="h-10 w-10 rounded-xl object-cover"
        />
      );
    }
    return <FileText size={14} className="text-secondary" />;
  };

  return (
    <div
      className="orchestrator-copilot-dock-composer"
      onDragOver={event => event.preventDefault()}
      onDrop={event => {
        event.preventDefault();
        onComposerDrop(event.dataTransfer.files);
      }}
    >
      <div className="orchestrator-copilot-composer-mode">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-secondary">
            {dockComposerLabel}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-outline-variant/30 bg-white px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface">
              {composerModeLabel}
            </span>
            <span className="text-xs leading-relaxed text-secondary">{composerModeCopy}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-outline">
            {primaryActionKind}
          </p>
          <p className="mt-1 text-sm font-semibold text-on-surface">{dockPrimaryActionLabel}</p>
        </div>
      </div>
      <textarea
        ref={dockTextareaRef}
        value={dockInput}
        onChange={event => onDockInputChange(event.target.value)}
        placeholder={dockComposerPlaceholder}
        className="mt-4 min-h-[6rem] w-full resize-none rounded-2xl border border-outline-variant/35 bg-surface-container-low/35 px-4 py-3 text-sm leading-6 text-on-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] focus:border-primary/40 focus:outline-none"
      />
      {helperText}

      {dockUploads.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {dockUploads.map(upload => (
            <div
              key={upload.id}
              className="flex items-center gap-2 rounded-2xl border border-outline-variant/30 bg-white px-3 py-2 text-xs font-semibold text-on-surface"
            >
              {renderAttachmentIcon(upload)}
              <span className="max-w-[10rem] truncate">{upload.file.name}</span>
              <span className="text-secondary">{formatAttachmentSizeLabel(upload.file.size)}</span>
              <button
                type="button"
                onClick={() => onRemoveUpload(upload.id)}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/20 pt-4">
        <label className="enterprise-button enterprise-button-secondary cursor-pointer">
          <Plus size={14} />
          Upload files
          <input
            type="file"
            multiple
            className="hidden"
            onChange={event => {
              onAddUploads(event.target.files);
              event.currentTarget.value = '';
            }}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {selectedOpenWaitPresent ? (
            <>
              {dockAllowsChatOnly ? (
                <button
                  type="button"
                  onClick={onAskAgent}
                  disabled={isDockSending || !canWriteChat}
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isDockSending ? (
                    <RefreshCw size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}
                  Ask agent
                </button>
              ) : null}
              <button
                type="button"
                onClick={onResolveWait}
                disabled={busyAction !== null || !dockCanResolveWait}
                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === 'dockResolveWait' ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : selectedOpenWaitType === 'APPROVAL' ? (
                  <ShieldCheck size={16} />
                ) : (
                  <ArrowRight size={16} />
                )}
                {dockPrimaryActionLabel}
              </button>
            </>
          ) : selectedCanGuideBlockedAgent ? (
            <button
              type="button"
              onClick={onGuideAndRestart}
              disabled={busyAction !== null || !dockInput.trim()}
              className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === 'dockGuideRestart' ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <ArrowRight size={16} />
              )}
              {dockPrimaryActionLabel}
            </button>
          ) : canStartExecution ? (
            <>
              <button
                type="button"
                onClick={onAskAgent}
                disabled={isDockSending || !canWriteChat}
                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isDockSending ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                Ask copilot
              </button>
              <button
                type="button"
                onClick={onStartExecution}
                disabled={busyAction !== null || !canStartExecution}
                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === 'dockStartExecution' ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Play size={16} />
                )}
                {dockPrimaryActionLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onAskAgent}
              disabled={isDockSending || !canWriteChat}
              className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isDockSending ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
