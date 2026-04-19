import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorListWorkbench } from '../OrchestratorListWorkbench';

describe('OrchestratorListWorkbench', () => {
  it('renders the extracted list shell and routes header actions', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onOpenCreate = vi.fn();
    const onSwitchToBoard = vi.fn();

    render(
      <OrchestratorListWorkbench
        capabilityName="Rule Engine"
        canStartDelivery
        runtimeReady
        filteredWorkItemsCount={3}
        totalWorkItemsCount={5}
        currentActorDisplayName="Workspace Operator"
        queueView="MY_QUEUE"
        runtimeError=""
        busyAction={null}
        canCreateWorkItems
        onRefresh={onRefresh}
        onOpenCreate={onOpenCreate}
        onSwitchToList={vi.fn()}
        onSwitchToBoard={onSwitchToBoard}
        lifecycleRail={<div>lifecycle rail</div>}
        liveDetailWarning={<div>detail warning</div>}
        inboxPanel={<div>inbox panel</div>}
        selectedWorkPanel={<div>selected work panel</div>}
        copilotDock={<div>copilot dock</div>}
      />,
    );

    expect(screen.getByText('Rule Engine Inbox')).toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 5 work items')).toBeInTheDocument();
    expect(screen.getByText("Workspace Operator's queue")).toBeInTheDocument();
    expect(screen.getByText('lifecycle rail')).toBeInTheDocument();
    expect(screen.getByText('copilot dock')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'New Work Item' }));
    expect(onOpenCreate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Board' }));
    expect(onSwitchToBoard).toHaveBeenCalledTimes(1);
  });
});
