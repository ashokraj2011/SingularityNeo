import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorQuickActionDialogs } from '../OrchestratorQuickActionDialogs';
import type { WorkItem } from '../../../types';

const buildWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem =>
  ({
    id: 'WI-1',
    capabilityId: 'CAP-1',
    title: 'Implement orchestration fix',
    description: 'Test item',
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

describe('OrchestratorQuickActionDialogs', () => {
  it('renders the phase move dialog and closes it from the secondary action', async () => {
    const user = userEvent.setup();
    const closePhaseMove = vi.fn();

    render(
      <MemoryRouter>
        <OrchestratorQuickActionDialogs
          phaseMoveRequest={{ workItemId: 'WI-1', targetPhase: 'QA' }}
          phaseMoveItem={buildWorkItem()}
          phaseMoveNote=""
          setPhaseMoveNote={vi.fn()}
          closePhaseMove={closePhaseMove}
          handleConfirmPhaseMove={vi.fn()}
          selectedWorkItem={buildWorkItem()}
          isArchiveWorkItemOpen={false}
          archiveWorkItemNote=""
          setArchiveWorkItemNote={vi.fn()}
          closeArchive={vi.fn()}
          handleArchiveWorkItem={vi.fn()}
          isRestoreWorkItemOpen={false}
          restoreWorkItemNote=""
          setRestoreWorkItemNote={vi.fn()}
          closeRestore={vi.fn()}
          handleRestoreWorkItem={vi.fn()}
          isCancelWorkItemOpen={false}
          cancelWorkItemNote=""
          setCancelWorkItemNote={vi.fn()}
          closeCancel={vi.fn()}
          handleCancelWorkItem={vi.fn()}
          actionError=""
          busyAction={null}
          canControlWorkItems
          currentActorDisplayName="Workspace Operator"
          getPhaseMeta={phase => ({ label: phase || 'Unknown', accent: 'neutral' })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Move phase · Implement orchestration fix')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep current phase' }));

    expect(closePhaseMove).toHaveBeenCalledTimes(1);
  });

  it('fires the archive action from the extracted archive dialog', async () => {
    const user = userEvent.setup();
    const handleArchiveWorkItem = vi.fn();

    render(
      <MemoryRouter>
        <OrchestratorQuickActionDialogs
          phaseMoveRequest={null}
          phaseMoveItem={null}
          phaseMoveNote=""
          setPhaseMoveNote={vi.fn()}
          closePhaseMove={vi.fn()}
          handleConfirmPhaseMove={vi.fn()}
          selectedWorkItem={buildWorkItem()}
          isArchiveWorkItemOpen
          archiveWorkItemNote=""
          setArchiveWorkItemNote={vi.fn()}
          closeArchive={vi.fn()}
          handleArchiveWorkItem={handleArchiveWorkItem}
          isRestoreWorkItemOpen={false}
          restoreWorkItemNote=""
          setRestoreWorkItemNote={vi.fn()}
          closeRestore={vi.fn()}
          handleRestoreWorkItem={vi.fn()}
          isCancelWorkItemOpen={false}
          cancelWorkItemNote=""
          setCancelWorkItemNote={vi.fn()}
          closeCancel={vi.fn()}
          handleCancelWorkItem={vi.fn()}
          actionError=""
          busyAction={null}
          canControlWorkItems
          currentActorDisplayName="Workspace Operator"
          getPhaseMeta={phase => ({ label: phase || 'Unknown', accent: 'neutral' })}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Delete and archive' }));

    expect(handleArchiveWorkItem).toHaveBeenCalledTimes(1);
  });
});
