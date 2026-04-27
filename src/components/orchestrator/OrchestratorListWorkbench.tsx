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

    {/* Two-column workspace:
        Left  (22 rem) — inbox panel only
        Right (1fr)    — Capability Copilot dock (full width) then work detail below */}
    <div className="orchestrator-list-workspace">
      <div className="orchestrator-list-top-grid">
        {/* Left column: inbox only */}
        {inboxPanel}

        {/* Right column: copilot dock spans full column width, work panel sits below */}
        <div className="flex flex-col gap-4">
          {copilotDock}
          {selectedWorkPanel}
        </div>
      </div>
    </div>
  </div>
);
