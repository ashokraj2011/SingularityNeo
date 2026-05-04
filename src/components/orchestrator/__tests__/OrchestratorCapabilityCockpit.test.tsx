import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorCapabilityCockpit } from '../OrchestratorCapabilityCockpit';

describe('OrchestratorCapabilityCockpit', () => {
  it('renders cockpit summaries and routes major actions', async () => {
    const user = userEvent.setup();
    const onNavigatePath = vi.fn();
    const onClaimDesktopExecution = vi.fn();
    const onOpenFullChat = vi.fn();

    render(
      <OrchestratorCapabilityCockpit
        canStartDelivery
        deliveryBlockingItem={null}
        nextActionTitle="Start the next active story"
        nextActionDescription="Move the selected item into execution."
        goldenPathSummary="Most setup steps are complete."
        goldenPathPercentComplete={83}
        goldenPathSteps={[
          { id: 'one', label: 'Contracts', path: '/contracts', status: 'COMPLETE' },
          { id: 'two', label: 'Work', path: '/work', status: 'CURRENT' },
        ]}
        onNavigatePath={onNavigatePath}
        primaryCopilotAgentName="Capability Copilot"
        primaryCopilotAgentRole="Coordinator"
        primaryCopilotRoleSummary="Routes work across specialists."
        selectedAgentName="Builder"
        selectedAgentQualitySummary="Quality: produces evidence and clear next steps."
        executionOwnerLabel="desktop-executor-1"
        executionDispatchLabel="Assigned"
        executionDispatchState="ASSIGNED"
        executionQueueReason={null}
        currentDesktopOwnsExecution={false}
        canClaimExecution
        executionClaimBusy={false}
        hasRuntimeExecutor
        onClaimDesktopExecution={onClaimDesktopExecution}
        onReleaseDesktopExecution={vi.fn()}
        canReadChat
        primaryCopilotAvailable
        onOpenFullChat={onOpenFullChat}
        onOpenTeam={vi.fn()}
      />,
    );

    expect(screen.getByText('Capability cockpit')).toBeInTheDocument();
    expect(screen.getByText('Start the next active story')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /current work/i }));
    expect(onNavigatePath).toHaveBeenCalledWith('/work');

    await user.click(screen.getByRole('button', { name: /take over desktop execution/i }));
    expect(onClaimDesktopExecution).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole('button', { name: /open companion chat/i }));
    expect(onOpenFullChat).toHaveBeenCalledTimes(1);
  });

  it('explains the preparing queue state when execution is queued for workspace prep', () => {
    render(
      <OrchestratorCapabilityCockpit
        canStartDelivery
        deliveryBlockingItem={null}
        nextActionTitle="Start the next active story"
        nextActionDescription="Move the selected item into execution."
        goldenPathSummary="Most setup steps are complete."
        goldenPathPercentComplete={83}
        goldenPathSteps={[]}
        onNavigatePath={vi.fn()}
        primaryCopilotAgentName="Capability Copilot"
        primaryCopilotAgentRole="Coordinator"
        primaryCopilotRoleSummary="Routes work across specialists."
        selectedAgentName="Builder"
        selectedAgentQualitySummary="Quality: produces evidence and clear next steps."
        executionOwnerLabel="desktop-executor-1"
        executionDispatchLabel="Assigned"
        executionDispatchState="ASSIGNED"
        executionQueueReason="PREPARING_EXECUTION_CONTEXT"
        currentDesktopOwnsExecution
        canClaimExecution
        executionClaimBusy={false}
        hasRuntimeExecutor
        onClaimDesktopExecution={vi.fn()}
        onReleaseDesktopExecution={vi.fn()}
        canReadChat
        primaryCopilotAvailable
        onOpenFullChat={vi.fn()}
        onOpenTeam={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        /prepares the workspace, checkout, and shared branch before agent execution begins/i,
      ),
    ).toBeInTheDocument();
  });
});
