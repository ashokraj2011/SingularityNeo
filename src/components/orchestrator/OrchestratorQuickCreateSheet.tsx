import React from 'react';
import { motion } from 'motion/react';
import { LoaderCircle, Plus, Workflow as WorkflowIcon, X } from 'lucide-react';
import { EmptyState } from '../EnterpriseUI';
import type { WorkItemAttachmentUpload } from '../../types';

type WorkflowOption = {
  id: string;
  name: string;
};

type DraftWorkItem = {
  title: string;
  description: string;
  workflowId: string;
  attachments: WorkItemAttachmentUpload[];
};

type Props = {
  isOpen: boolean;
  workflows: WorkflowOption[];
  draftWorkItem: DraftWorkItem;
  busyAction: string | null;
  canCreateWorkItems: boolean;
  formatAttachmentSizeLabel: (sizeBytes?: number) => string;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onTitleChange: (value: string) => void;
  onWorkflowChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onUploadAttachments: (files: FileList | null) => void;
  onClearAttachments: () => void;
  onRemoveAttachment: (index: number) => void;
};

export const OrchestratorQuickCreateSheet = ({
  isOpen,
  workflows,
  draftWorkItem,
  busyAction,
  canCreateWorkItems,
  formatAttachmentSizeLabel,
  onClose,
  onSubmit,
  onTitleChange,
  onWorkflowChange,
  onDescriptionChange,
  onUploadAttachments,
  onClearAttachments,
  onRemoveAttachment,
}: Props) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="desktop-content-overlay">
      <button
        type="button"
        aria-label="Close create work item sheet"
        onClick={onClose}
        className="desktop-content-overlay-backdrop"
      />
      <motion.aside
        initial={{ opacity: 0, x: 48 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 48 }}
        className="desktop-content-overlay-panel-right orchestrator-quick-sheet"
      >
        <div className="orchestrator-quick-sheet-header">
          <div>
            <p className="form-kicker">Quick Create</p>
            <h2 className="mt-1 text-xl font-bold text-on-surface">Stage new work</h2>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Keep creation lightweight, pick the workflow, and let the execution engine own
              progression.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close quick create sheet"
            onClick={onClose}
            className="workspace-list-action"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {workflows.length === 0 ? (
            <EmptyState
              title="No workflow is available"
              description="Create or restore a workflow before staging new work into orchestration."
              icon={WorkflowIcon}
              className="min-h-[20rem]"
            />
          ) : (
            <form
              id="orchestrator-create-work-item"
              onSubmit={onSubmit}
              className="grid gap-5"
            >
              <label className="space-y-2">
                <span className="field-label">Work item title</span>
                <input
                  value={draftWorkItem.title}
                  onChange={event => onTitleChange(event.target.value)}
                  placeholder="Implement expression parser"
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="field-label">Workflow</span>
                <select
                  value={draftWorkItem.workflowId}
                  onChange={event => onWorkflowChange(event.target.value)}
                  className="field-select"
                >
                  {workflows.map(workflow => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="field-label">Description</span>
                <textarea
                  value={draftWorkItem.description}
                  onChange={event => onDescriptionChange(event.target.value)}
                  placeholder="Summarize what success looks like..."
                  className="field-input min-h-[7rem]"
                />
              </label>

              <label className="space-y-2">
                <span className="field-label">Upload supporting docs (text only)</span>
                <div className="flex flex-wrap gap-2">
                  <label className="enterprise-button enterprise-button-secondary cursor-pointer">
                    <Plus size={14} />
                    Upload files
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={event => {
                        onUploadAttachments(event.target.files);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                  {draftWorkItem.attachments.length > 0 ? (
                    <button
                      type="button"
                      onClick={onClearAttachments}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                {draftWorkItem.attachments.length > 0 ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {draftWorkItem.attachments.map((attachment, index) => (
                      <div
                        key={`${attachment.fileName}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-[1.25rem] border border-outline-variant/20 bg-surface-container-low/35 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-on-surface">
                            {attachment.fileName}
                          </p>
                          <p className="mt-1 truncate text-xs leading-relaxed text-secondary">
                            {[
                              attachment.mimeType || 'text/plain',
                              formatAttachmentSizeLabel(attachment.sizeBytes),
                            ]
                              .filter(Boolean)
                              .join(' • ')}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove attachment ${attachment.fileName}`}
                          onClick={() => onRemoveAttachment(index)}
                          className="workspace-list-action shrink-0"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs leading-relaxed text-secondary">
                    No files uploaded yet.
                  </p>
                )}
              </label>
            </form>
          )}
        </div>

        {workflows.length > 0 ? (
          <div className="orchestrator-quick-sheet-footer">
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="enterprise-button enterprise-button-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="orchestrator-create-work-item"
                disabled={busyAction !== null || !canCreateWorkItems}
                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === 'create' ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Plus size={16} />
                )}
                Create work item
              </button>
            </div>
          </div>
        ) : null}
      </motion.aside>
    </div>
  );
};
