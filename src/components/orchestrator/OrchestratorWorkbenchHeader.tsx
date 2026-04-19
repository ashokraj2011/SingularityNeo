import React from 'react';
import { LayoutGrid, List, Plus, RefreshCw } from 'lucide-react';
import { StatusBadge } from '../EnterpriseUI';

type QueueView =
  | 'MY_QUEUE'
  | 'ALL_WORK'
  | 'TEAM_QUEUE'
  | 'ATTENTION'
  | 'PAUSED'
  | 'ARCHIVE'
  | 'WATCHING';

type Props = {
  capabilityName: string;
  canStartDelivery: boolean;
  runtimeReady: boolean;
  filteredWorkItemsCount: number;
  totalWorkItemsCount: number;
  currentActorDisplayName: string;
  queueView: QueueView;
  runtimeError: string;
  busyAction: string | null;
  canCreateWorkItems: boolean;
  onRefresh: () => void;
  onOpenCreate: () => void;
  onSwitchToList: () => void;
  onSwitchToBoard: () => void;
};

const getQueueViewLabel = (
  queueView: QueueView,
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
    case 'ARCHIVE':
      return 'Archive';
    case 'WATCHING':
      return 'Watching queue';
    default:
      return 'Work items';
  }
};

export const OrchestratorWorkbenchHeader = ({
  capabilityName,
  canStartDelivery,
  runtimeReady,
  filteredWorkItemsCount,
  totalWorkItemsCount,
  currentActorDisplayName,
  queueView,
  runtimeError,
  busyAction,
  canCreateWorkItems,
  onRefresh,
  onOpenCreate,
  onSwitchToList,
  onSwitchToBoard,
}: Props) => (
  <section className="orchestrator-commandbar">
    <div className="orchestrator-commandbar-main">
      <div className="orchestrator-commandbar-heading">
        <div className="orchestrator-commandbar-copy">
          <p className="form-kicker">Work Inbox</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-[1.75rem] font-bold tracking-tight text-on-surface">
              {capabilityName} Inbox
            </h1>
            <StatusBadge
              tone={
                canStartDelivery
                  ? runtimeReady
                    ? 'success'
                    : 'danger'
                  : 'warning'
              }
            >
              {canStartDelivery
                ? runtimeReady
                  ? 'Execution ready'
                  : 'Needs setup'
                : 'Delivery gated'}
            </StatusBadge>
            <StatusBadge tone="neutral">Inbox view</StatusBadge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">
            Pick a work item, answer pending requests, and keep delivery moving with the Copilot
            Dock.
          </p>
        </div>

        <div className="orchestrator-commandbar-controls">
          <div className="orchestrator-toolbar-row orchestrator-toolbar-row-secondary">
            <div className="orchestrator-view-toggle" aria-label="Choose orchestrator view">
              <button
                type="button"
                onClick={onSwitchToList}
                className="orchestrator-view-toggle-button orchestrator-view-toggle-button-active"
              >
                <List size={16} />
                Inbox
              </button>
              <button
                type="button"
                onClick={onSwitchToBoard}
                className="orchestrator-view-toggle-button"
              >
                <LayoutGrid size={16} />
                Board
              </button>
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
        </div>
      </div>

      <div className="orchestrator-commandbar-footnote">
        <span className="orchestrator-commandbar-footnote-copy">
          Showing {filteredWorkItemsCount} of {totalWorkItemsCount} work items
        </span>
        <span className="orchestrator-commandbar-footnote-copy">
          {getQueueViewLabel(queueView, currentActorDisplayName)}
        </span>
        <span className="orchestrator-commandbar-footnote-copy">
          {runtimeError
            ? 'Agent connection needs attention'
            : 'Inbox mode is optimized for stakeholder unblocking'}
        </span>
      </div>
    </div>
  </section>
);
