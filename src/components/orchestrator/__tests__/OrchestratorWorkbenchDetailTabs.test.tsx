import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorWorkbenchDetailTabs } from '../OrchestratorWorkbenchDetailTabs';

describe('OrchestratorWorkbenchDetailTabs', () => {
  it('renders the selected panel and routes tab changes', async () => {
    const user = userEvent.setup();
    const onDetailTabChange = vi.fn();

    render(
      <OrchestratorWorkbenchDetailTabs
        detailTab="operate"
        onDetailTabChange={onDetailTabChange}
        operatePanel={<div>Operate panel</div>}
        artifactsPanel={<div>Artifacts panel</div>}
        attemptsPanel={<div>Attempts panel</div>}
        receiptsPanel={<div>Receipts panel</div>}
      />,
    );

    expect(screen.getByText('Operate panel')).toBeInTheDocument();
    expect(screen.queryByText('Artifacts panel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Artifacts' }));
    expect(onDetailTabChange).toHaveBeenCalledWith('artifacts');

    await user.click(screen.getByRole('button', { name: 'Attempts' }));
    expect(onDetailTabChange).toHaveBeenCalledWith('attempts');

    await user.click(screen.getByRole('button', { name: 'Receipts' }));
    expect(onDetailTabChange).toHaveBeenCalledWith('receipts');
  });
});
