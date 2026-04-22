import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorWorkbenchDetailContent } from '../OrchestratorWorkbenchDetailContent';

vi.mock('../OrchestratorWorkbenchDetailHeader', () => ({
  OrchestratorWorkbenchDetailHeader: () => <div>Detail header</div>,
}));

vi.mock('../OrchestratorOperatePanel', () => ({
  OrchestratorOperatePanel: () => <div>Operate panel</div>,
}));

vi.mock('../OrchestratorArtifactsPanel', () => ({
  OrchestratorArtifactsPanel: () => <div>Artifacts panel</div>,
}));

vi.mock('../OrchestratorAttemptsPanel', () => ({
  OrchestratorAttemptsPanel: () => <div>Attempts panel</div>,
}));

vi.mock('../../evidence/PromptReceiptPanel', () => ({
  PromptReceiptPanel: () => <div>Receipts panel</div>,
}));

vi.mock('../OrchestratorFailureRecoveryPanel', () => ({
  OrchestratorFailureRecoveryPanel: () => null,
}));

describe('OrchestratorWorkbenchDetailContent', () => {
  it('composes header plus all detail tabs and switches panels', async () => {
    const user = userEvent.setup();
    const onDetailTabChange = vi.fn();

    const { rerender } = render(
      <OrchestratorWorkbenchDetailContent
        detailTab="operate"
        onDetailTabChange={onDetailTabChange}
        headerProps={{} as never}
        operateProps={{} as never}
        artifactsProps={{} as never}
        attemptsProps={{} as never}
        receiptsProps={{ selectedRunEvents: [] }}
        failureRecoveryProps={{} as never}
      />,
    );

    expect(screen.getByText('Detail header')).toBeInTheDocument();
    expect(screen.getByText('Operate panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Artifacts' }));
    expect(onDetailTabChange).toHaveBeenCalledWith('artifacts');

    rerender(
      <OrchestratorWorkbenchDetailContent
        detailTab="attempts"
        onDetailTabChange={onDetailTabChange}
        headerProps={{} as never}
        operateProps={{} as never}
        artifactsProps={{} as never}
        attemptsProps={{} as never}
        receiptsProps={{ selectedRunEvents: [] }}
        failureRecoveryProps={{} as never}
      />,
    );

    expect(screen.getByText('Attempts panel')).toBeInTheDocument();
  });
});
