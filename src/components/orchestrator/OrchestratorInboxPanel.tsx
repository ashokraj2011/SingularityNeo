import React, { useEffect } from 'react';
import {
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import { EmptyState, StatusBadge } from '../EnterpriseUI';
import { compactMarkdownPreview } from '../../lib/markdown';
import { cn } from '../../lib/utils';
import type { EnterpriseTone } from '../../lib/enterprise';
import type {
  WorkbenchQueueView,
  WorkItem,
  WorkItemPhase,
  WorkItemPriorityFilter,
  WorkItemStatusFilter,
} from '../../lib/orchestrator/support';
import { normalizeMarkdownishText } from '../../lib/orchestrator/support';

type WorkflowOption = {
  id: string;
  name: string;
};

type InboxEntryAttention = {
  attentionLabel?: string;
  attentionReason?: string;
  callToAction?: string;
} | null;

type InboxEntry = {
  item: WorkItem;
  meta: {
    currentStepName: string;
    agentName: string;
    ageLabel: string;
  };
  attention: InboxEntryAttention;
};

type OrchestratorInboxPanelProps = {
  filteredWorkItemsCount: number;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  queueView: WorkbenchQueueView;
  onQueueViewChange: (value: WorkbenchQueueView) => void;
  /** Per-queue item counts shown as badges on each tab. */
  queueCounts?: Partial<Record<WorkbenchQueueView, number>>;
  isInboxFilterTrayOpen: boolean;
  onToggleInboxFilterTray: () => void;
  workflowFilter: string;
  onWorkflowFilterChange: (value: string) => void;
  statusFilter: WorkItemStatusFilter;
  onStatusFilterChange: (value: WorkItemStatusFilter) => void;
  priorityFilter: WorkItemPriorityFilter;
  onPriorityFilterChange: (value: WorkItemPriorityFilter) => void;
  workflows: WorkflowOption[];
  inboxEntries: InboxEntry[];
  selectedWorkItemId: string | null;
  busyAction: string | null;
  onSelectInboxEntry: (workItemId: string, focusDock: boolean) => void;
  onPauseRun: (args: {
    runId: string;
    workItemId: string;
    workItemTitle: string;
  }) => Promise<void> | void;
  onResumeRun: (args: {
    runId: string;
    workItemId: string;
    workItemTitle: string;
  }) => Promise<void> | void;
  onOpenRestore: (workItemId: string) => void;
  onOpenArchive: (workItemId: string) => void;
  onOpenCancel: (workItemId: string) => void;
  getPhaseMeta: (phase?: WorkItemPhase) => { label: string; accent: string };
  getStatusTone: (status?: string) => EnterpriseTone;
  getStatusLabel: (status: WorkItem['status']) => string;
};

const QUEUE_OPTIONS: Array<[WorkbenchQueueView, string]> = [
  ['ALL_WORK', 'All'],
  ['MY_QUEUE', 'Mine'],
  ['TEAM_QUEUE', 'Team'],
  ['ATTENTION', 'Approvals'],
  ['PAUSED', 'Paused'],
  ['WATCHING', 'Watching'],
  ['ARCHIVE', 'Archive'],
];

export const OrchestratorInboxPanel = ({
  filteredWorkItemsCount,
  searchQuery,
  onSearchQueryChange,
  queueView,
  onQueueViewChange,
  queueCounts,
  isInboxFilterTrayOpen,
  onToggleInboxFilterTray,
  workflowFilter,
  onWorkflowFilterChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  workflows,
  inboxEntries,
  selectedWorkItemId,
  busyAction,
  onSelectInboxEntry,
  onPauseRun,
  onResumeRun,
  onOpenRestore,
  onOpenArchive,
  onOpenCancel,
  getPhaseMeta,
  getStatusTone,
  getStatusLabel,
}: OrchestratorInboxPanelProps) => {
  // J / K keyboard navigation — move selection up/down through the inbox list.
  // Only fires when focus is not inside a text input or textarea so typing is
  // never intercepted.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key !== 'j' && event.key !== 'k') return;
      event.preventDefault();

      if (inboxEntries.length === 0) return;

      const currentIndex = selectedWorkItemId
        ? inboxEntries.findIndex(e => e.item.id === selectedWorkItemId)
        : -1;

      let nextIndex: number;
      if (event.key === 'j') {
        nextIndex = currentIndex < inboxEntries.length - 1 ? currentIndex + 1 : currentIndex;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
      }

      const nextEntry = inboxEntries[nextIndex];
      if (nextEntry) {
        onSelectInboxEntry(nextEntry.item.id, false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inboxEntries, selectedWorkItemId, onSelectInboxEntry]);

  return (
    <aside className="workspace-surface orchestrator-list-inbox-panel overflow-hidden p-0">
      <div className="border-b border-outline-variant/25 px-4 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="form-kicker">Inbox</p>
            <h2 className="mt-1 text-lg font-bold text-on-surface">Needs action</h2>
            <p className="mt-1 text-sm text-secondary">
              Search, filter, and pick a work item to unblock.
            </p>
          </div>
          <StatusBadge tone="info">{filteredWorkItemsCount} items</StatusBadge>
        </div>

        <label className="mt-4 relative block">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline"
          />
          <input
            value={searchQuery}
            onChange={event => onSearchQueryChange(event.target.value)}
            placeholder="Search by id, title, tag, or agent"
            className="enterprise-input w-full pl-11"
          />
        </label>

        <div className="mt-4">
          <div className="orchestrator-view-toggle" aria-label="Choose work queue">
            {QUEUE_OPTIONS.map(([value, label]) => {
              const count = queueCounts?.[value];
              const isAttention = value === 'ATTENTION';
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onQueueViewChange(value)}
                  className={cn(
                    'orchestrator-view-toggle-button',
                    queueView === value && 'orchestrator-view-toggle-button-active',
                  )}
                >
                  {label}
                  {count !== undefined && count > 0 && (
                    <span
                      className={cn(
                        'ml-1.5 rounded-full px-1.5 py-px text-[0.6rem] font-bold leading-none',
                        queueView === value
                          ? 'bg-white/30 text-inherit'
                          : isAttention
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-secondary/10 text-secondary',
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={onToggleInboxFilterTray}
            className="enterprise-button enterprise-button-secondary w-full justify-between px-3 py-2 text-[0.72rem]"
            aria-expanded={isInboxFilterTrayOpen}
          >
            <span>More filters</span>
            <span className="text-[0.65rem] uppercase tracking-[0.16em] text-secondary">
              {workflowFilter !== 'ALL' || statusFilter !== 'ALL' || priorityFilter !== 'ALL'
                ? 'Active'
                : 'Optional'}
            </span>
          </button>

          {isInboxFilterTrayOpen ? (
            <div className="mt-3 grid gap-2">
              <select
                value={workflowFilter}
                onChange={event => onWorkflowFilterChange(event.target.value)}
                className="field-select"
              >
                <option value="ALL">All workflows</option>
                {workflows.map(workflow => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={event =>
                  onStatusFilterChange(event.target.value as WorkItemStatusFilter)
                }
                className="field-select"
              >
                <option value="ALL">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="BLOCKED">Blocked</option>
                <option value="PAUSED">Paused</option>
                <option value="PENDING_APPROVAL">Pending approval</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <select
                value={priorityFilter}
                onChange={event =>
                  onPriorityFilterChange(event.target.value as WorkItemPriorityFilter)
                }
                className="field-select"
              >
                <option value="ALL">All priorities</option>
                <option value="High">High</option>
                <option value="Med">Med</option>
                <option value="Low">Low</option>
              </select>
            </div>
          ) : null}
        </div>
      </div>

      <div className="orchestrator-list-inbox-scroll custom-scrollbar">
        {inboxEntries.length === 0 ? (
          <EmptyState
            title="Nothing in the inbox"
            description="Adjust the queue view or filters to bring items back into view."
            icon={WorkflowIcon}
            className="min-h-[18rem]"
          />
        ) : (
          <div className="space-y-3">
            {inboxEntries.map(entry => {
              const attention = entry.attention;
              const isSelected = selectedWorkItemId === entry.item.id;
              const cta =
                attention?.callToAction ||
                (!entry.item.activeRunId &&
                entry.item.phase !== 'DONE' &&
                entry.item.status !== 'COMPLETED'
                  ? 'Start'
                  : 'View');

              return (
                <div
                  key={entry.item.id}
                  className={cn(
                    'orchestrator-navigator-card',
                    isSelected && 'orchestrator-navigator-card-active',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectInboxEntry(entry.item.id, Boolean(attention?.callToAction));
                    }}
                    className={cn(
                      'orchestrator-navigator-item',
                      isSelected && 'orchestrator-navigator-item-active',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="form-kicker">{entry.item.id}</p>
                        <p className="mt-1 line-clamp-2 text-sm font-semibold text-on-surface">
                          {entry.item.title}
                        </p>
                      </div>
                      <StatusBadge tone={attention ? 'warning' : 'neutral'}>{cta}</StatusBadge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge tone="neutral">
                        {getPhaseMeta(entry.item.phase).label}
                      </StatusBadge>
                      <StatusBadge tone={getStatusTone(entry.item.status)}>
                        {getStatusLabel(entry.item.status)}
                      </StatusBadge>
                      {attention?.attentionLabel ? (
                        <StatusBadge tone="warning">{attention.attentionLabel}</StatusBadge>
                      ) : null}
                    </div>
                  </button>
                  <div className="border-t border-outline-variant/20 px-4 pb-4 pt-3">
                    <div className="space-y-1 text-xs leading-relaxed text-secondary">
                      <p>{entry.meta.currentStepName}</p>
                      <p>{entry.meta.agentName}</p>
                      <p>{entry.meta.ageLabel}</p>
                    </div>
                    {attention?.attentionReason ? (
                      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-secondary">
                        {compactMarkdownPreview(
                          normalizeMarkdownishText(attention.attentionReason),
                          180,
                        )}
                      </p>
                    ) : null}
                    {isSelected ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entry.item.activeRunId && entry.item.status !== 'PAUSED' ? (
                          <button
                            type="button"
                            onClick={() =>
                              void onPauseRun({
                                runId: entry.item.activeRunId || '',
                                workItemId: entry.item.id,
                                workItemTitle: entry.item.title,
                              })
                            }
                            disabled={busyAction !== null}
                            className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {busyAction === `pause-${entry.item.id}` ? (
                              <LoaderCircle size={14} className="animate-spin" />
                            ) : (
                              <Pause size={14} />
                            )}
                            Pause
                          </button>
                        ) : null}
                        {entry.item.activeRunId && entry.item.status === 'PAUSED' ? (
                          <button
                            type="button"
                            onClick={() =>
                              void onResumeRun({
                                runId: entry.item.activeRunId || '',
                                workItemId: entry.item.id,
                                workItemTitle: entry.item.title,
                              })
                            }
                            disabled={busyAction !== null}
                            className="enterprise-button enterprise-button-primary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {busyAction === `resume-${entry.item.id}` ? (
                              <LoaderCircle size={14} className="animate-spin" />
                            ) : (
                              <Play size={14} />
                            )}
                            Resume
                          </button>
                        ) : null}
                        {entry.item.status === 'ARCHIVED' ? (
                          <button
                            type="button"
                            onClick={() => onOpenRestore(entry.item.id)}
                            disabled={busyAction !== null}
                            className="enterprise-button enterprise-button-primary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <RefreshCw size={14} />
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onOpenArchive(entry.item.id)}
                            disabled={busyAction !== null}
                            className={cn(
                              'enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40',
                              'border-red-200 text-red-700 hover:bg-red-50',
                            )}
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        )}
                        {entry.item.status !== 'COMPLETED' &&
                        entry.item.status !== 'CANCELLED' &&
                        entry.item.status !== 'ARCHIVED' ? (
                          <button
                            type="button"
                            onClick={() => onOpenCancel(entry.item.id)}
                            disabled={busyAction !== null}
                            className="enterprise-button enterprise-button-danger px-3 py-2 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <X size={14} />
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
