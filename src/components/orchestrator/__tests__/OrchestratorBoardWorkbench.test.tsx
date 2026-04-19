import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorBoardWorkbench } from '../OrchestratorBoardWorkbench';

describe('OrchestratorBoardWorkbench', () => {
  it('renders the extracted board shell and routes header controls', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onOpenCreate = vi.fn();
    const onSwitchToList = vi.fn();
    const onSearchQueryChange = vi.fn();
    const onQueueViewChange = vi.fn();
    const onWorkflowFilterChange = vi.fn();
    const onStatusFilterChange = vi.fn();
    const onPriorityFilterChange = vi.fn();

    render(
      <OrchestratorBoardWorkbench
        capabilityName="Rule Engine"
        canStartDelivery
        runtimeReady
        stats={{ active: 4, blocked: 1, approvals: 2, running: 1 }}
        searchQuery="parser"
        onSearchQueryChange={onSearchQueryChange}
        queueView="MY_QUEUE"
        onQueueViewChange={onQueueViewChange}
        workflowFilter="ALL"
        onWorkflowFilterChange={onWorkflowFilterChange}
        statusFilter="ALL"
        onStatusFilterChange={onStatusFilterChange}
        priorityFilter="ALL"
        onPriorityFilterChange={onPriorityFilterChange}
        workflows={[
          { id: 'wf-1', name: 'Build' },
          { id: 'wf-2', name: 'Review' },
        ]}
        filteredWorkItemsCount={3}
        totalWorkItemsCount={5}
        currentActorDisplayName="Workspace Operator"
        runtimeError=""
        busyAction={null}
        canCreateWorkItems
        onRefresh={onRefresh}
        onOpenCreate={onOpenCreate}
        onSwitchToList={onSwitchToList}
        onSwitchToBoard={vi.fn()}
        capabilityCockpit={<div>capability cockpit</div>}
        liveDetailWarning={<div>live detail warning</div>}
        advancedDisclosure={<div>advanced disclosure</div>}
        attentionQueue={<div>attention queue</div>}
        boardSurface={<section>board surface</section>}
        detailRail={<aside>detail rail</aside>}
      />,
    );

    expect(screen.getByText('Rule Engine Work')).toBeInTheDocument();
    expect(screen.getByText('Showing 3 of 5 work items')).toBeInTheDocument();
    expect(screen.getByText("Workspace Operator's queue")).toBeInTheDocument();
    expect(screen.getByText('capability cockpit')).toBeInTheDocument();
    expect(screen.getByText('board surface')).toBeInTheDocument();
    expect(screen.getByText('detail rail')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'New Work Item' }));
    expect(onOpenCreate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Inbox' }));
    expect(onSwitchToList).toHaveBeenCalledTimes(1);

    await user.type(screen.getByPlaceholderText(/search work item/i), ' x');
    expect(onSearchQueryChange).toHaveBeenCalled();

    await user.selectOptions(screen.getByDisplayValue('All workflows'), 'wf-1');
    expect(onWorkflowFilterChange).toHaveBeenCalledWith('wf-1');

    await user.selectOptions(screen.getByDisplayValue('All statuses'), 'ACTIVE');
    expect(onStatusFilterChange).toHaveBeenCalledWith('ACTIVE');

    await user.selectOptions(screen.getByDisplayValue('All priorities'), 'High');
    expect(onPriorityFilterChange).toHaveBeenCalledWith('High');

    await user.click(screen.getByRole('button', { name: 'Needs approval' }));
    expect(onQueueViewChange).toHaveBeenCalledWith('ATTENTION');
  });
});
