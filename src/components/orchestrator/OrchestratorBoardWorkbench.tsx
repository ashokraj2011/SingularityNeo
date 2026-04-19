import React from 'react';
import { LayoutGrid, Plus, RefreshCw, Search, List } from 'lucide-react';
import { cn } from '../../lib/utils';
import type {
  WorkbenchQueueView,
  WorkItemPriorityFilter,
  WorkItemStatusFilter,
} from '../../lib/orchestrator/support';
import { StatusBadge } from '../EnterpriseUI';

type WorkflowOption = {
  id: string;
  name: string;
};

type Stats = {
  active: number;
  blocked: number;
  approvals: number;
  running: number;
};

type Props = {
  capabilityName: string;
  canStartDelivery: boolean;
  runtimeReady: boolean;
  stats: Stats;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  queueView: WorkbenchQueueView;
  onQueueViewChange: (value: WorkbenchQueueView) => void;
  workflowFilter: string;
  onWorkflowFilterChange: (value: string) => void;
  statusFilter: WorkItemStatusFilter;
  onStatusFilterChange: (value: WorkItemStatusFilter) => void;
  priorityFilter: WorkItemPriorityFilter;
  onPriorityFilterChange: (value: WorkItemPriorityFilter) => void;
  workflows: WorkflowOption[];
  filteredWorkItemsCount: number;
  totalWorkItemsCount: number;
  currentActorDisplayName: string;
  runtimeError: string;
  busyAction: string | null;
  canCreateWorkItems: boolean;
  onRefresh: () => void;
  onOpenCreate: () => void;
  onSwitchToList: () => void;
  onSwitchToBoard: () => void;
  capabilityCockpit: React.ReactNode;
  liveDetailWarning?: React.ReactNode;
  advancedDisclosure: React.ReactNode;
  attentionQueue: React.ReactNode;
  boardSurface: React.ReactNode;
  detailRail: React.ReactNode;
};

const QUEUE_OPTIONS: Array<[WorkbenchQueueView, string]> = [
  ['ALL_WORK', 'All work'],
  ['MY_QUEUE', 'My queue'],
  ['TEAM_QUEUE', 'Team queue'],
  ['ATTENTION', 'Needs approval'],
  ['PAUSED', 'Paused'],
  ['WATCHING', 'Watching'],
  ['ARCHIVE', 'Archive'],
];

const getQueueFootnote = (
  queueView: WorkbenchQueueView,
  currentActorDisplayName: string,
) => {
  switch (queueView) {
    case 'MY_QUEUE':
      return `${currentActorDisplayName}'s queue`;
    case 'ALL_WORK':
      return 'All work items';
    case 'TEAM_QUEUE':
      return 'Current team queue';
    case 'ATTENTION':
      return 'Attention queue';
    case 'PAUSED':
      return 'Paused queue';
    case 'WATCHING':
      return 'Watching queue';
    case 'ARCHIVE':
      return 'Archive';
    default:
      return 'Work items';
  }
};

export const OrchestratorBoardWorkbench = ({
  capabilityName,
  canStartDelivery,
  runtimeReady,
  stats,
  searchQuery,
  onSearchQueryChange,
  queueView,
  onQueueViewChange,
  workflowFilter,
  onWorkflowFilterChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  workflows,
  filteredWorkItemsCount,
  totalWorkItemsCount,
  currentActorDisplayName,
  runtimeError,
  busyAction,
  canCreateWorkItems,
  onRefresh,
  onOpenCreate,
  onSwitchToList,
  onSwitchToBoard,
  capabilityCockpit,
  liveDetailWarning,
  advancedDisclosure,
  attentionQueue,
  boardSurface,
  detailRail,
}: Props) => (
  <div className="orchestrator-page-shell space-y-4">
    <section className="orchestrator-commandbar">
      <div className="orchestrator-commandbar-main">
        <div className="orchestrator-commandbar-heading">
          <div className="orchestrator-commandbar-copy">
            <p className="form-kicker">Work</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-[1.75rem] font-bold tracking-tight text-on-surface">
                {capabilityName} Work
              </h1>
              <StatusBadge
                tone={
                  canStartDelivery ? (runtimeReady ? 'success' : 'danger') : 'warning'
                }
              >
                {canStartDelivery
                  ? runtimeReady
                    ? 'Execution ready'
                    : 'Needs setup'
                  : 'Delivery gated'}
              </StatusBadge>
              <StatusBadge tone="neutral">Board view</StatusBadge>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">
              Stage work, clear approvals and blockers, restart when needed, and keep delivery
              moving from one focused board.
            </p>
          </div>

          <div className="orchestrator-commandbar-kpis">
            {[
              { label: 'Active', value: stats.active, tone: 'brand' as const },
              { label: 'Blocked', value: stats.blocked, tone: 'danger' as const },
              { label: 'Pending Approval', value: stats.approvals, tone: 'warning' as const },
              { label: 'Running', value: stats.running, tone: 'info' as const },
            ].map(chip => (
              <div key={chip.label} className="orchestrator-kpi-chip">
                <StatusBadge tone={chip.tone}>{chip.label}</StatusBadge>
                <span className="text-sm font-semibold text-on-surface">{chip.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="orchestrator-commandbar-controls">
          <div className="orchestrator-toolbar-row orchestrator-toolbar-row-primary">
            <label className="orchestrator-search-shell">
              <Search
                size={16}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline"
              />
              <input
                value={searchQuery}
                onChange={event => onSearchQueryChange(event.target.value)}
                placeholder="Search work item, workflow, step, tag, or agent"
                className="enterprise-input pl-11"
              />
            </label>

            <div className="orchestrator-view-toggle" aria-label="Choose orchestrator view">
              <button
                type="button"
                onClick={onSwitchToBoard}
                className="orchestrator-view-toggle-button orchestrator-view-toggle-button-active"
              >
                <LayoutGrid size={16} />
                Board
              </button>
              <button
                type="button"
                onClick={onSwitchToList}
                className="orchestrator-view-toggle-button"
              >
                <List size={16} />
                Inbox
              </button>
            </div>
          </div>

          <div className="orchestrator-toolbar-row orchestrator-toolbar-row-secondary">
            <div className="orchestrator-filter-strip">
              <div className="orchestrator-view-toggle" aria-label="Choose work queue">
                {QUEUE_OPTIONS.map(([value, label]) => (
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
                  </button>
                ))}
              </div>

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
                onChange={event => onStatusFilterChange(event.target.value as WorkItemStatusFilter)}
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

            <div className="orchestrator-commandbar-actions">
              <button
                type="button"
                onClick={onRefresh}
                disabled={busyAction === 'refresh'}
                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw
                  size={16}
                  className={busyAction === 'refresh' ? 'animate-spin' : ''}
                />
                Refresh
              </button>
              <button
                type="button"
                onClick={onOpenCreate}
                disabled={!canCreateWorkItems}
                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={16} />
                New Work Item
              </button>
            </div>
          </div>

          <div className="orchestrator-commandbar-footnote">
            <span className="orchestrator-commandbar-footnote-copy">
              Showing {filteredWorkItemsCount} of {totalWorkItemsCount} work items
            </span>
            <span className="orchestrator-commandbar-footnote-copy">
              {getQueueFootnote(queueView, currentActorDisplayName)}
            </span>
            <span className="orchestrator-commandbar-footnote-copy">
              {runtimeError
                ? 'Agent connection needs attention'
                : 'Advanced execution details are collapsed below'}
            </span>
          </div>
        </div>
      </div>
    </section>

    {capabilityCockpit}

    {liveDetailWarning}

    {advancedDisclosure}

    {attentionQueue}

    <div className="orchestrator-workspace-grid">
      {boardSurface}
      {detailRail}
    </div>
  </div>
);
