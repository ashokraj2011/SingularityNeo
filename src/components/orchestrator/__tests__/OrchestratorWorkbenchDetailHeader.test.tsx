import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorWorkbenchDetailHeader } from '../OrchestratorWorkbenchDetailHeader';

describe('OrchestratorWorkbenchDetailHeader', () => {
  it('renders selected work commands and routes actions through callbacks', async () => {
    const user = userEvent.setup();
    const onOpenApprovalReview = vi.fn();
    const onTakeControl = vi.fn();
    const onStartExecution = vi.fn();
    const onOpenCancel = vi.fn();

    render(
      <OrchestratorWorkbenchDetailHeader
        selectedWorkItem={{
          id: 'WI-42',
          title: 'Implement rule engine updates',
          description: 'Add rule execution improvements.',
          status: 'ACTIVE',
        } as never}
        phaseLabel="Development"
        phaseTone="brand"
        taskTypeLabel="Implementation"
        workItemStatusLabel="Active"
        workItemStatusTone="info"
        currentRunStatusLabel="Running"
        currentRunStatusTone="brand"
        selectedPhaseOwnerTeamName="Platform Operations"
        selectedClaimOwnerName="Workspace Operator"
        selectedPresenceUserNames={['Analyst', 'Reviewer']}
        selectedCanGuideBlockedAgent
        showApprovalReviewButton
        canStartExecution
        startExecutionLabel="Start current phase"
        canRestartFromPhase
        restartPhaseLabel="Restart Development"
        canResetAndRestart
        selectedCanTakeControl
        currentActorOwnsSelectedWorkItem
        canControlWorkItems
        currentRunIsActive
        busyAction={null}
        canReadChat
        hasSelectedAgent
        onBackToFlowMap={vi.fn()}
        onExplain={vi.fn()}
        onCreateEvidencePacket={vi.fn()}
        onOpenFullChat={vi.fn()}
        onTakeControl={onTakeControl}
        onToggleControl={vi.fn()}
        onApprovalReviewMouseDown={vi.fn()}
        onOpenApprovalReview={onOpenApprovalReview}
        onStartExecution={onStartExecution}
        onRestartExecution={vi.fn()}
        onResetAndRestart={vi.fn()}
        onGuideBlockedAgent={vi.fn()}
        onCancelRun={vi.fn()}
        onOpenRestore={vi.fn()}
        onOpenArchive={vi.fn()}
        onOpenCancel={onOpenCancel}
      />,
    );

    expect(screen.getByText('Implement rule engine updates')).toBeInTheDocument();
    expect(screen.getByText('Blocked work needs guidance')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review approval gate' }));
    expect(onOpenApprovalReview).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Take control' }));
    expect(onTakeControl).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Start current phase' }));
    expect(onStartExecution).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Cancel work item' }));
    expect(onOpenCancel).toHaveBeenCalledTimes(1);
  });
});
