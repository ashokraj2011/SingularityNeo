import React from 'react';
import { cn } from '../../lib/utils';
import type { DetailTab } from '../../lib/orchestrator/support';

type Props = {
  detailTab: DetailTab;
  onDetailTabChange: (next: DetailTab) => void;
  operatePanel: React.ReactNode;
  artifactsPanel: React.ReactNode;
  attemptsPanel: React.ReactNode;
  receiptsPanel: React.ReactNode;
  // Optional so legacy call-sites that don't render a segments panel
  // (tests, embedded workbench) continue to compile. When absent, the
  // tab is not shown.
  segmentsPanel?: React.ReactNode;
};

export const OrchestratorWorkbenchDetailTabs = ({
  detailTab,
  onDetailTabChange,
  operatePanel,
  artifactsPanel,
  attemptsPanel,
  receiptsPanel,
  segmentsPanel,
}: Props) => (
  <>
    <div className="orchestrator-detail-tabs">
      {([
        ['operate', 'Operate'],
        ['artifacts', 'Artifacts'],
        ['attempts', 'Attempts'],
        ['receipts', 'Receipts'],
        ...(segmentsPanel ? ([['segments', 'Segments']] as const) : []),
      ] as const).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onDetailTabChange(id)}
          className={cn('workspace-tab-button', detailTab === id && 'workspace-tab-button-active')}
        >
          {label}
        </button>
      ))}
    </div>

    <div className="orchestrator-detail-body">
      {detailTab === 'operate' ? operatePanel : null}
      {detailTab === 'artifacts' ? artifactsPanel : null}
      {detailTab === 'attempts' ? attemptsPanel : null}
      {detailTab === 'receipts' ? receiptsPanel : null}
      {detailTab === 'segments' ? segmentsPanel : null}
    </div>
  </>
);
