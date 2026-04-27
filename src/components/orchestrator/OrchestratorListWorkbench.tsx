import React from 'react';
import { OrchestratorWorkbenchHeader } from './OrchestratorWorkbenchHeader';

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
  lifecycleRail: React.ReactNode;
  liveDetailWarning?: React.ReactNode;
  inboxPanel: React.ReactNode;
  selectedWorkPanel: React.ReactNode;
  copilotDock: React.ReactNode;
};

export const OrchestratorListWorkbench = ({
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
  lifecycleRail,
  liveDetailWarning,
  inboxPanel,
  selectedWorkPanel,
  copilotDock,
}: Props) => (
  <div className="orchestrator-page-shell space-y-4">
    <OrchestratorWorkbenchHeader
      capabilityName={capabilityName}
      canStartDelivery={canStartDelivery}
      runtimeReady={runtimeReady}
      filteredWorkItemsCount={filteredWorkItemsCount}
      totalWorkItemsCount={totalWorkItemsCount}
      currentActorDisplayName={currentActorDisplayName}
      queueView={queueView}
      runtimeError={runtimeError}
      busyAction={busyAction}
      canCreateWorkItems={canCreateWorkItems}
      onRefresh={onRefresh}
      onOpenCreate={onOpenCreate}
      onSwitchToList={onSwitchToList}
      onSwitchToBoard={onSwitchToBoard}
    />

    {lifecycleRail}

    {liveDetailWarning}

    {/* Workspace layout:
        Top row  — inbox (22 rem) | selected work panel (1fr)
        Below    — Capability Copilot dock full width, visually right under the inbox */}
    <div className="orchestrator-list-workspace">
      <div className="orchestrator-list-top-grid">
        {inboxPanel}
        {selectedWorkPanel}
      </div>

      {copilotDock}
    </div>
  </div>
);
