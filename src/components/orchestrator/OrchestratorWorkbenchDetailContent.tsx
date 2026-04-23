import React from 'react';
import type { DetailTab } from '../../lib/orchestrator/support';
import { PromptReceiptPanel } from '../evidence/PromptReceiptPanel';
import { OrchestratorArtifactsPanel } from './OrchestratorArtifactsPanel';
import { OrchestratorAttemptsPanel } from './OrchestratorAttemptsPanel';
import { OrchestratorFailureRecoveryPanel } from './OrchestratorFailureRecoveryPanel';
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
  receiptsProps: React.ComponentProps<typeof PromptReceiptPanel>;
  failureRecoveryProps: React.ComponentProps<typeof OrchestratorFailureRecoveryPanel>;
  // Optional — the Segments tab is rendered only when a panel is supplied.
  segmentsPanel?: React.ReactNode;
};

export const OrchestratorWorkbenchDetailContent = ({
  detailTab,
  onDetailTabChange,
  headerProps,
  operateProps,
  artifactsProps,
  attemptsProps,
  receiptsProps,
  failureRecoveryProps,
  segmentsPanel,
}: Props) => (
  <div className="flex h-full flex-col">
    <OrchestratorWorkbenchDetailHeader {...headerProps} />
    {/* Inline failure recovery — visible regardless of active tab */}
    <OrchestratorFailureRecoveryPanel {...failureRecoveryProps} />
    <OrchestratorWorkbenchDetailTabs
      detailTab={detailTab}
      onDetailTabChange={onDetailTabChange}
      operatePanel={<OrchestratorOperatePanel {...operateProps} />}
      artifactsPanel={<OrchestratorArtifactsPanel {...artifactsProps} />}
      attemptsPanel={<OrchestratorAttemptsPanel {...attemptsProps} />}
      receiptsPanel={<PromptReceiptPanel {...receiptsProps} />}
      segmentsPanel={segmentsPanel}
    />
  </div>
);
