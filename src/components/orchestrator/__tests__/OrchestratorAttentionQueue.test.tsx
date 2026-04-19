import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorAttentionQueue } from '../OrchestratorAttentionQueue';
import type { WorkItem } from '../../../types';

const buildWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem =>
  ({
    id: 'WI-1',
    capabilityId: 'CAP-1',
    workflowId: 'WF-1',
    title: 'Approval required',
    description: 'Selected work item',
    status: 'PENDING_APPROVAL',
    phase: 'DEVELOPMENT',
    priority: 'Med',
    attachments: [],
    tags: [],
    history: [],
    pendingRequest: { type: 'APPROVAL' },
    createdAt: '2026-04-19T10:00:00.000Z',
    updatedAt: '2026-04-19T10:00:00.000Z',
    ...overrides,
  }) as WorkItem;

describe('OrchestratorAttentionQueue', () => {
  it('routes approval items back into focused selection with approval focus', async () => {
    const user = userEvent.setup();
    const onSelectWorkItem = vi.fn();

    render(
      <OrchestratorAttentionQueue
        attentionItems={[
          {
            item: buildWorkItem(),
            agentId: 'AG-1',
            attentionLabel: 'Approval',
            attentionReason: 'A human needs to approve the current gate.',
            attentionTimestamp: '2026-04-19T10:00:00.000Z',
            hasConflictReview: false,
            callToAction: 'Review approval',
          },
        ]}
        selectedWorkItemId={null}
        onSelectWorkItem={onSelectWorkItem}
        resolveAgentName={() => 'Reviewer'}
        getPhaseMeta={phase => ({ label: phase || 'Unknown', accent: 'neutral' })}
        formatRelativeTime={() => 'just now'}
      />,
    );

    await user.click(screen.getByRole('button', { name: /approval required/i }));

    expect(onSelectWorkItem).toHaveBeenCalledWith('WI-1', {
      openControl: true,
      focus: 'APPROVAL',
    });
  });
});
