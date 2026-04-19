import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorLifecycleRail } from '../OrchestratorLifecycleRail';
import type { WorkItem } from '../../../types';

const buildWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem =>
  ({
    id: 'WI-1',
    capabilityId: 'CAP-1',
    workflowId: 'WF-1',
    title: 'Implement parser',
    description: 'Selected work item',
    status: 'ACTIVE',
    phase: 'DEVELOPMENT',
    priority: 'Med',
    attachments: [],
    tags: [],
    history: [],
    createdAt: '2026-04-19T10:00:00.000Z',
    updatedAt: '2026-04-19T10:00:00.000Z',
    ...overrides,
  }) as WorkItem;

describe('OrchestratorLifecycleRail', () => {
  it('opens a phase move when a reachable station is clicked', async () => {
    const user = userEvent.setup();
    const onOpenPhaseMoveDialog = vi.fn();

    render(
      <OrchestratorLifecycleRail
        selectedWorkItem={buildWorkItem()}
        selectedWorkflowName="Delivery Workflow"
        selectedStatusTone="brand"
        selectedStatusLabel="Active"
        canControlWorkItems
        phaseRailPreviewingMove={false}
        phaseRailTargetPhase="DEVELOPMENT"
        lifecycleBoardPhases={['BACKLOG', 'ANALYSIS', 'DEVELOPMENT', 'QA', 'DONE']}
        phaseRailTrackRef={createRef<HTMLDivElement>()}
        onTrackPointerDown={vi.fn()}
        phaseRailCurrentIndex={2}
        phaseRailTargetIndex={2}
        measureForIndex={index => ({ ratio: index / 4, cssValue: `${index * 20}%` })}
        onOpenPhaseMoveDialog={onOpenPhaseMoveDialog}
        phaseRailCanInteract
        isPhaseRailDragging={false}
        onHandleKeyDown={vi.fn()}
        onSwitchOperator={vi.fn()}
        getPhaseMeta={phase => ({ label: phase || 'Unknown', accent: 'neutral' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Move to QA' }));

    expect(onOpenPhaseMoveDialog).toHaveBeenCalledWith('WI-1', 'QA');
  });

  it('shows the operator switch affordance when the rail is read-only', () => {
    render(
      <OrchestratorLifecycleRail
        selectedWorkItem={null}
        selectedWorkflowName={null}
        selectedStatusTone="neutral"
        selectedStatusLabel="No selection"
        canControlWorkItems={false}
        phaseRailPreviewingMove={false}
        phaseRailTargetPhase={null}
        lifecycleBoardPhases={['BACKLOG', 'ANALYSIS', 'DEVELOPMENT', 'QA', 'DONE']}
        phaseRailTrackRef={createRef<HTMLDivElement>()}
        onTrackPointerDown={vi.fn()}
        phaseRailCurrentIndex={-1}
        phaseRailTargetIndex={-1}
        measureForIndex={() => ({ ratio: 0, cssValue: '0%' })}
        onOpenPhaseMoveDialog={vi.fn()}
        phaseRailCanInteract={false}
        isPhaseRailDragging={false}
        onHandleKeyDown={vi.fn()}
        onSwitchOperator={vi.fn()}
        getPhaseMeta={phase => ({ label: phase || 'Unknown', accent: 'neutral' })}
      />,
    );

    expect(screen.getByRole('button', { name: /switch operator/i })).toBeInTheDocument();
  });
});
