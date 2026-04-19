import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileText } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorSelectedWorkPanel } from '../OrchestratorSelectedWorkPanel';
import type { WorkItem } from '../../../types';

const buildWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem =>
  ({
    id: 'WI-1',
    capabilityId: 'CAP-1',
    title: 'Implement orchestration fix',
    description: 'Keep delivery moving',
    status: 'ACTIVE',
    phase: 'DEVELOPMENT',
    priority: 'Med',
    createdAt: '2026-04-19T10:00:00.000Z',
    updatedAt: '2026-04-19T10:00:00.000Z',
    attachments: [],
    tags: [],
    history: [],
    ...overrides,
  }) as WorkItem;

describe('OrchestratorSelectedWorkPanel', () => {
  it('renders the empty state when nothing is selected', () => {
    render(
      <OrchestratorSelectedWorkPanel
        selectedWorkItem={null}
        emptyStateIcon={FileText}
        phaseLabel="Unknown"
        phaseTone="neutral"
        workItemStatusLabel="No selection"
        workItemStatusTone="neutral"
        canStartExecution={false}
        canReadChat={false}
        canControlWorkItems={false}
        currentRunIsActive={false}
        currentRunIsPaused={false}
        selectedCurrentStepLabel="Awaiting orchestration"
        selectedAgentLabel="Unassigned"
        selectedAttentionLabel="Action required"
        selectedNextActionSummary="Pick a work item"
        selectedStateSummary="No current state"
        selectedBlockerSummary="Nothing is blocked"
        actionError=""
        busyAction={null}
        onStartExecution={vi.fn()}
        onExplain={vi.fn()}
        onCreateEvidencePacket={vi.fn()}
        onOpenFullChat={vi.fn()}
        onPauseRun={vi.fn()}
        onResumeRun={vi.fn()}
        onOpenRestore={vi.fn()}
        onOpenArchive={vi.fn()}
        onOpenCancel={vi.fn()}
        formatTimestamp={() => 'Now'}
      />,
    );

    expect(screen.getByText('Select a work item')).toBeInTheDocument();
  });

  it('routes primary actions through callbacks for a selected item', async () => {
    const user = userEvent.setup();
    const onStartExecution = vi.fn();
    const onOpenArchive = vi.fn();

    render(
      <OrchestratorSelectedWorkPanel
        selectedWorkItem={buildWorkItem()}
        emptyStateIcon={FileText}
        phaseLabel="Development"
        phaseTone="brand"
        workItemStatusLabel="Active"
        workItemStatusTone="success"
        currentRunStatusLabel="Running"
        currentRunStatusTone="brand"
        canStartExecution
        canReadChat
        canControlWorkItems
        currentRunIsActive={false}
        currentRunIsPaused={false}
        selectedCurrentStepLabel="Build & Test"
        selectedAgentLabel="Architect"
        selectedAttentionTimestamp="2026-04-19T10:00:00.000Z"
        selectedAttentionLabel="Waiting for input"
        selectedNextActionSummary="Provide the missing business rule."
        selectedStateSummary="Awaiting operator detail."
        selectedBlockerSummary="Need an exact acceptance rule."
        actionError=""
        busyAction={null}
        onStartExecution={onStartExecution}
        onExplain={vi.fn()}
        onCreateEvidencePacket={vi.fn()}
        onOpenFullChat={vi.fn()}
        onPauseRun={vi.fn()}
        onResumeRun={vi.fn()}
        onOpenRestore={vi.fn()}
        onOpenArchive={onOpenArchive}
        onOpenCancel={vi.fn()}
        formatTimestamp={() => 'Apr 19, 10:00 AM'}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start execution' }));
    expect(onStartExecution).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onOpenArchive).toHaveBeenCalledTimes(1);
  });
});
