import React from 'react';
import { motion } from 'motion/react';
import { LoaderCircle, Plus, Workflow as WorkflowIcon, X } from 'lucide-react';
import { EmptyState, StatusBadge } from '../EnterpriseUI';
import type {
  WorkItem,
  WorkItemAttachmentUpload,
  WorkItemPhaseStakeholder,
  WorkItemTaskType,
} from '../../types';
import {
  getWorkItemTaskTypeDescription,
  WORK_ITEM_TASK_TYPE_OPTIONS,
} from '../../lib/workItemTaskTypes';

type WorkflowOption = {
  id: string;
  name: string;
};

type LifecyclePhaseOption = {
  id: string;
  label: string;
  description?: string | null;
};

type DraftLaunchSummary = {
  workflowName: string;
  entryPointLabel: string;
  routedPhaseLabel: string;
  entryAgentLabel: string;
  stepsCount: number;
  phaseSignoffLabel: string;
  inputFilesLabel: string;
  routingNote?: string | null;
};

type DraftWorkItem = {
  title: string;
  workflowId: string;
  taskType: WorkItemTaskType;
  priority: WorkItem['priority'];
  description: string;
  attachments: WorkItemAttachmentUpload[];
  tags: string;
};

type Props = {
  isOpen: boolean;
  workflows: WorkflowOption[];
  draftWorkItem: DraftWorkItem;
  launchSummary: DraftLaunchSummary;
  visibleLifecyclePhases: LifecyclePhaseOption[];
  capabilityStakeholdersCount: number;
  busyAction: string | null;
  canCreateWorkItems: boolean;
  getDraftPhaseStakeholders: (phaseId: string) => WorkItemPhaseStakeholder[];
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onTitleChange: (value: string) => void;
  onWorkflowChange: (value: string) => void;
  onTaskTypeChange: (value: WorkItemTaskType) => void;
  onPriorityChange: (value: WorkItem['priority']) => void;
  onDescriptionChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onApplyCapabilityStakeholdersToPhase: (phaseId: string) => void;
  onAddDraftPhaseStakeholder: (phaseId: string) => void;
  onUpdateDraftPhaseStakeholderField: (
    phaseId: string,
    index: number,
    field: keyof WorkItemPhaseStakeholder,
    value: string,
  ) => void;
  onRemoveDraftPhaseStakeholder: (phaseId: string, index: number) => void;
  onUploadAttachments: (files: FileList | null) => void;
  onRemoveAttachment: (index: number) => void;
  renderAttachmentIcon: (attachment: WorkItemAttachmentUpload) => React.ReactNode;
  formatAttachmentSizeLabel: (sizeBytes?: number) => string;
};

export const OrchestratorBoardQuickCreateSheet = ({
  isOpen,
  workflows,
  draftWorkItem,
  launchSummary,
  visibleLifecyclePhases,
  capabilityStakeholdersCount,
  busyAction,
  canCreateWorkItems,
  getDraftPhaseStakeholders,
  onClose,
  onSubmit,
  onTitleChange,
  onWorkflowChange,
  onTaskTypeChange,
  onPriorityChange,
  onDescriptionChange,
  onTagsChange,
  onApplyCapabilityStakeholdersToPhase,
  onAddDraftPhaseStakeholder,
  onUpdateDraftPhaseStakeholderField,
  onRemoveDraftPhaseStakeholder,
  onUploadAttachments,
  onRemoveAttachment,
  renderAttachmentIcon,
  formatAttachmentSizeLabel,
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
              progression, waits, and durable output.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close board quick create sheet"
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
                <span className="field-label">Task type</span>
                <select
                  value={draftWorkItem.taskType}
                  onChange={event => onTaskTypeChange(event.target.value as WorkItemTaskType)}
                  className="field-select"
                >
                  {WORK_ITEM_TASK_TYPE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs leading-relaxed text-secondary">
                  {getWorkItemTaskTypeDescription(draftWorkItem.taskType)}
                </p>
              </label>

              <div className="workspace-meta-card orchestrator-quick-sheet-summary">
                <p className="workspace-meta-label">Workflow launch summary</p>
                <p className="workspace-meta-value">{launchSummary.workflowName}</p>
                <div className="mt-3 grid gap-2 text-sm text-secondary">
                  <p>
                    Entry point:{' '}
                    <strong className="text-on-surface">{launchSummary.entryPointLabel}</strong>
                  </p>
                  <p>
                    Routed phase:{' '}
                    <strong className="text-on-surface">{launchSummary.routedPhaseLabel}</strong>
                  </p>
                  <p>
                    Entry agent:{' '}
                    <strong className="text-on-surface">{launchSummary.entryAgentLabel}</strong>
                  </p>
                  <p>
                    Steps:{' '}
                    <strong className="text-on-surface">{launchSummary.stepsCount}</strong>
                  </p>
                  <p>
                    Phase sign-off:{' '}
                    <strong className="text-on-surface">
                      {launchSummary.phaseSignoffLabel}
                    </strong>
                  </p>
                  <p>
                    Input files:{' '}
                    <strong className="text-on-surface">{launchSummary.inputFilesLabel}</strong>
                  </p>
                  {launchSummary.routingNote ? (
                    <p>
                      Routing note:{' '}
                      <strong className="text-on-surface">{launchSummary.routingNote}</strong>
                    </p>
                  ) : null}
                </div>
              </div>

              <label className="space-y-2">
                <span className="field-label">Priority</span>
                <select
                  value={draftWorkItem.priority}
                  onChange={event => onPriorityChange(event.target.value as WorkItem['priority'])}
                  className="field-select"
                >
                  <option value="High">High</option>
                  <option value="Med">Med</option>
                  <option value="Low">Low</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="field-label">Description</span>
                <textarea
                  value={draftWorkItem.description}
                  onChange={event => onDescriptionChange(event.target.value)}
                  placeholder="Add scope, acceptance criteria, or decision context."
                  className="field-textarea h-28"
                />
              </label>

              <div className="workspace-meta-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="workspace-meta-label">Phase stakeholders & sign-off</p>
                    <p className="mt-2 text-sm leading-relaxed text-secondary">
                      Add the stakeholders who should be represented in each phase. Human
                      interaction and sign-off documents for that phase will carry these names
                      and email ids.
                    </p>
                  </div>
                  {capabilityStakeholdersCount > 0 ? (
                    <StatusBadge tone="info">
                      {capabilityStakeholdersCount} capability stakeholders available
                    </StatusBadge>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-4">
                  {visibleLifecyclePhases.map(phase => {
                    const phaseStakeholders = getDraftPhaseStakeholders(phase.id);

                    return (
                      <div
                        key={phase.id}
                        className="rounded-[1.5rem] border border-outline-variant/30 bg-white/80 px-4 py-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-on-surface">{phase.label}</p>
                            <p className="mt-1 text-xs leading-relaxed text-secondary">
                              {phase.description ||
                                'Stakeholders listed here will appear in phase-specific sign-off records.'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {capabilityStakeholdersCount > 0 ? (
                              <button
                                type="button"
                                onClick={() => onApplyCapabilityStakeholdersToPhase(phase.id)}
                                className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem]"
                              >
                                Use capability stakeholders
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => onAddDraftPhaseStakeholder(phase.id)}
                              className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem]"
                            >
                              <Plus size={14} />
                              Add stakeholder
                            </button>
                          </div>
                        </div>

                        {phaseStakeholders.length > 0 ? (
                          <div className="mt-4 space-y-3">
                            {phaseStakeholders.map((stakeholder, index) => (
                              <div
                                key={`${phase.id}-${index}`}
                                className="rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/40 p-3"
                              >
                                <div className="grid gap-3 md:grid-cols-2">
                                  <input
                                    value={stakeholder.role}
                                    onChange={event =>
                                      onUpdateDraftPhaseStakeholderField(
                                        phase.id,
                                        index,
                                        'role',
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Role"
                                    className="field-input"
                                  />
                                  <input
                                    value={stakeholder.name}
                                    onChange={event =>
                                      onUpdateDraftPhaseStakeholderField(
                                        phase.id,
                                        index,
                                        'name',
                                        event.target.value,
                                      )
                                    }
                                    placeholder="Stakeholder name"
                                    className="field-input"
                                  />
                                  <input
                                    value={stakeholder.email}
                                    onChange={event =>
                                      onUpdateDraftPhaseStakeholderField(
                                        phase.id,
                                        index,
                                        'email',
                                        event.target.value,
                                      )
                                    }
                                    placeholder="name@company.com"
                                    className="field-input"
                                  />
                                  <div className="flex gap-2">
                                    <input
                                      value={stakeholder.teamName || ''}
                                      onChange={event =>
                                        onUpdateDraftPhaseStakeholderField(
                                          phase.id,
                                          index,
                                          'teamName',
                                          event.target.value,
                                        )
                                      }
                                      placeholder="Team"
                                      className="field-input"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onRemoveDraftPhaseStakeholder(phase.id, index)
                                      }
                                      aria-label={`Remove stakeholder ${phase.label} ${index + 1}`}
                                      className="workspace-list-action shrink-0 self-center"
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-4 text-xs leading-relaxed text-secondary">
                            No phase stakeholders assigned yet.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="workspace-meta-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="workspace-meta-label">Supporting files for the agent</p>
                    <p className="mt-2 text-sm leading-relaxed text-secondary">
                      Upload text-based files like requirements, design notes, samples, or
                      decision docs. They will be stored as work-item input artifacts and
                      included in agent context for this work item.
                    </p>
                  </div>
                  <label className="enterprise-button enterprise-button-secondary cursor-pointer px-3 py-2 text-[0.68rem]">
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
                </div>

                {draftWorkItem.attachments.length > 0 ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {draftWorkItem.attachments.map((attachment, index) => (
                      <div
                        key={`${attachment.fileName}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-[1.25rem] border border-outline-variant/20 bg-surface-container-low/35 px-4 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                            {renderAttachmentIcon(attachment)}
                          </div>
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
                            <p className="mt-1 text-[0.68rem] uppercase tracking-[0.2em] text-secondary/80">
                              Stored on create
                            </p>
                          </div>
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
                  <p className="mt-4 text-xs leading-relaxed text-secondary">
                    No files uploaded yet.
                  </p>
                )}
              </div>

              <label className="space-y-2">
                <span className="field-label">Tags</span>
                <input
                  value={draftWorkItem.tags}
                  onChange={event => onTagsChange(event.target.value)}
                  placeholder="parser, math, compiler"
                  className="field-input"
                />
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
