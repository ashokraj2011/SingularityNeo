import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promoteSwarmSessionToWorkItem } from '../../../lib/api';
import { SwarmReviewCard } from '../SwarmReviewCard';

vi.mock('../../../lib/api', () => ({
  promoteSwarmSessionToWorkItem: vi.fn(),
  reviewSwarmSession: vi.fn(),
}));

const promoteSwarmSessionToWorkItemMock = vi.mocked(
  promoteSwarmSessionToWorkItem,
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SwarmReviewCard', () => {
  it('forwards the created work item result to the caller after promotion', async () => {
    const user = userEvent.setup();
    const onWorkItemCreated = vi.fn();
    const onRefresh = vi.fn();

    promoteSwarmSessionToWorkItemMock.mockResolvedValue({
      workItem: {
        id: 'WI-123',
        title: 'Promoted swarm plan',
      } as any,
      swarmSessionId: 'SWS-1',
      linkedArtifactId: 'ART-1',
    });

    render(
      <SwarmReviewCard
        capabilityId="CAP-1"
        session={{
          session: {
            id: 'SWS-1',
            capabilityId: 'CAP-1',
            sessionScope: 'GENERAL_CHAT',
            status: 'APPROVED',
            initiatingPrompt: 'Debate the design.',
            tokenBudgetUsed: 10,
            maxTokenBudget: 100,
            createdAt: '2026-04-24T10:00:00.000Z',
            updatedAt: '2026-04-24T10:00:00.000Z',
          },
          participants: [],
          transcript: [],
          producedArtifactId: 'ART-1',
        }}
        onWorkItemCreated={onWorkItemCreated}
        onRefresh={onRefresh}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /promote to work item/i }),
    );

    expect(onWorkItemCreated).toHaveBeenCalledWith({
      workItem: expect.objectContaining({ id: 'WI-123' }),
      swarmSessionId: 'SWS-1',
      linkedArtifactId: 'ART-1',
    });
    expect(onRefresh).toHaveBeenCalled();
  });
});
