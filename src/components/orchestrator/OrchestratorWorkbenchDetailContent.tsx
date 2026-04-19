import React from 'react';
import type { DetailTab } from '../../lib/orchestrator/support';
import { OrchestratorArtifactsPanel } from './OrchestratorArtifactsPanel';
import { OrchestratorAttemptsPanel } from './OrchestratorAttemptsPanel';
import { OrchestratorOperatePanel } from './OrchestratorOperatePanel';
import { OrchestratorWorkbenchDetailHeader } from './OrchestratorWorkbenchDetailHeader';
import { OrchestratorWorkbenchDetailTabs } from './OrchestratorWorkbenchDetailTabs';

type Props = {
  detailTab: DetailTab;
  onDetailTabChange: (next: DetailTab) => void;
  headerProps: React.ComponentProps<typeof OrchestratorWorkbenchDetailHeader>;
  operateProps: React.ComponentProps<typeof OrchestratorOperatePanel>;
  artifactsProps: React.ComponentProps<typeof OrchestratorArtifactsPanel>;
  attemptsProps: React.ComponentProps<typeof OrchestratorAttemptsPanel>;
};

export const OrchestratorWorkbenchDetailContent = ({
  detailTab,
  onDetailTabChange,
  headerProps,
  operateProps,
  artifactsProps,
  attemptsProps,
}: Props) => (
  <div className="flex h-full flex-col">
    <OrchestratorWorkbenchDetailHeader {...headerProps} />
    <OrchestratorWorkbenchDetailTabs
      detailTab={detailTab}
      onDetailTabChange={onDetailTabChange}
      operatePanel={<OrchestratorOperatePanel {...operateProps} />}
      artifactsPanel={<OrchestratorArtifactsPanel {...artifactsProps} />}
      attemptsPanel={<OrchestratorAttemptsPanel {...attemptsProps} />}
    />
  </div>
);
