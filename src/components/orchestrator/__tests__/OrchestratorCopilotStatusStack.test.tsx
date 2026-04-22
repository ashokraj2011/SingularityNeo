import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorCopilotStatusStack } from '../OrchestratorCopilotStatusStack';
import type { RunWait, WorkspacePathValidationResult } from '../../../types';
import type { CapabilityReadinessItem } from '../../../lib/capabilityExperience';

const buildBlockingItem = (
  overrides: Partial<CapabilityReadinessItem> = {},
): CapabilityReadinessItem => ({
  id: 'approved-workspace',
  label: 'Approved workspace required',
  description: 'Add an approved root before execution can continue.',
  status: 'NEEDS_SETUP',
  actionLabel: 'Approve workspace',
  path: '/capabilities/CAP-1/metadata',
  isBlocking: true,
  nextRequiredAction: 'Approve a local repository root.',
  ...overrides,
});

const buildWait = (overrides: Partial<RunWait> = {}): RunWait =>
  ({
    id: 'WAIT-1',
    capabilityId: 'CAP-1',
    runId: 'RUN-1',
    runStepId: 'STEP-1',
    type: 'INPUT',
    status: 'OPEN',
    message: 'Please provide the exact repository root and missing acceptance criteria.',
    requestedBy: 'AGENT-1',
    createdAt: '2026-04-19T10:00:00.000Z',
    ...overrides,
  }) as RunWait;

describe('OrchestratorCopilotStatusStack', () => {
  it('renders a blocking readiness card and routes the primary action', async () => {
    const user = userEvent.setup();
    const onOpenBlockingAction = vi.fn();

    render(
      <OrchestratorCopilotStatusStack
        selectedWorkItemPresent
        deliveryBlockingItem={buildBlockingItem()}
        onOpenBlockingAction={onOpenBlockingAction}
        canStartExecution={false}
        executionDispatchLabel="Desktop ready"
        canRestartFromPhase={false}
        phaseLabel="Development"
        busyAction={null}
        onRestartExecution={vi.fn()}
        selectedCanGuideBlockedAgent={false}
        isPaused={false}
        canResumeRun={false}
        onResumeRun={vi.fn()}
        selectedOpenWait={null}
        selectedAttentionLabel=""
        dockMissingFieldLabels={[]}
        onFieldChipClick={vi.fn()}
        waitRequiresApprovedWorkspace={false}
        hasApprovedWorkspaceConfigured={false}
        approvedWorkspaceRoots={[]}
        approvedWorkspaceDraft=""
        onApprovedWorkspaceDraftChange={vi.fn()}
        approvedWorkspaceSuggestions={[]}
        onSelectApprovedWorkspaceDraft={vi.fn()}
        onApproveWorkspacePathAndContinue={vi.fn()}
        onApproveWorkspacePathOnly={vi.fn()}
        approvedWorkspaceValidation={null}
        canEditCapability
      />,
    );

    expect(screen.getByText('Execution blocked')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve workspace' }));
    expect(onOpenBlockingAction).toHaveBeenCalledTimes(1);
  });

  it('renders the pending-request workspace flow and routes chip and approve actions', async () => {
    const user = userEvent.setup();
    const onFieldChipClick = vi.fn();
    const onSelectApprovedWorkspaceDraft = vi.fn();
    const onApproveWorkspacePathAndContinue = vi.fn();
    const onApproveWorkspacePathOnly = vi.fn();
    const validation: WorkspacePathValidationResult = {
      path: '/Users/ashokraj/project',
      normalizedPath: '/Users/ashokraj/project',
      valid: true,
      exists: true,
      isDirectory: true,
      readable: true,
      message: 'Workspace path is valid.',
    };

    render(
      <OrchestratorCopilotStatusStack
        selectedWorkItemPresent
        deliveryBlockingItem={null}
        onOpenBlockingAction={vi.fn()}
        canStartExecution={false}
        executionDispatchLabel="Desktop ready"
        canRestartFromPhase={false}
        phaseLabel="Development"
        busyAction={null}
        onRestartExecution={vi.fn()}
        selectedCanGuideBlockedAgent={false}
        isPaused={false}
        canResumeRun={false}
        onResumeRun={vi.fn()}
        selectedOpenWait={buildWait()}
        selectedAttentionLabel="Waiting for input"
        dockMissingFieldLabels={['Approved workspace path']}
        onFieldChipClick={onFieldChipClick}
        waitRequiresApprovedWorkspace
        hasApprovedWorkspaceConfigured={false}
        approvedWorkspaceRoots={[]}
        approvedWorkspaceDraft=""
        onApprovedWorkspaceDraftChange={vi.fn()}
        approvedWorkspaceSuggestions={['/Users/ashokraj/project']}
        onSelectApprovedWorkspaceDraft={onSelectApprovedWorkspaceDraft}
        onApproveWorkspacePathAndContinue={onApproveWorkspacePathAndContinue}
        onApproveWorkspacePathOnly={onApproveWorkspacePathOnly}
        approvedWorkspaceValidation={validation}
        canEditCapability
      />,
    );

    expect(screen.getByText('Pending request')).toBeInTheDocument();
    expect(screen.getByText('Still missing from your response')).toBeInTheDocument();
    expect(screen.getByText('Workspace path is valid.')).toBeInTheDocument();
    expect(screen.getByText('Specific input needed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approved workspace path' }));
    expect(onFieldChipClick).toHaveBeenCalledWith('Approved workspace path');

    await user.click(screen.getByRole('button', { name: '/Users/ashokraj/project' }));
    expect(onSelectApprovedWorkspaceDraft).toHaveBeenCalledWith('/Users/ashokraj/project');

    await user.click(screen.getByRole('button', { name: 'Approve and continue' }));
    expect(onApproveWorkspacePathAndContinue).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Approve only' }));
    expect(onApproveWorkspacePathOnly).toHaveBeenCalledTimes(1);
  });
});
