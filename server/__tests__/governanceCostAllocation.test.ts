// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, getAuthorizedAppStateMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getAuthorizedAppStateMock: vi.fn(),
}));

vi.mock('../db', () => ({
  query: queryMock,
}));

vi.mock('../access', () => ({
  getAuthorizedAppState: getAuthorizedAppStateMock,
}));

vi.mock('../../src/lib/accessControl', () => ({
  canReadCapabilityLiveDetail: () => true,
}));

import { buildGovernanceCostAllocationSnapshot } from '../reporting';

describe('buildGovernanceCostAllocationSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizedAppStateMock.mockResolvedValue({
      capabilities: [
        {
          id: 'CAP-ARCH',
          name: 'Architecture Studio',
          effectivePermissions: ['capability.read.rollup'],
        },
        {
          id: 'CAP-OPS',
          name: 'Operations Console',
          effectivePermissions: ['capability.read.rollup'],
        },
      ],
    });
  });

  it('groups prompt spend by capability and agent', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          capability_id: 'CAP-ARCH',
          capability_name: 'Architecture Studio',
          agent_id: 'architect-agent',
          agent_name: 'Architect Agent',
          span_count: '4',
          prompt_tokens: '900',
          completion_tokens: '300',
          total_tokens: '1200',
          total_cost_usd: '0.0124',
          last_seen_at: '2026-04-23T10:00:00.000Z',
          stages: ['capability_chat', 'approval_synthesis'],
        },
        {
          capability_id: 'CAP-OPS',
          capability_name: 'Operations Console',
          agent_id: 'devops-agent',
          agent_name: 'DevOps Agent',
          span_count: '2',
          prompt_tokens: '400',
          completion_tokens: '100',
          total_tokens: '500',
          total_cost_usd: '0.004',
          last_seen_at: '2026-04-23T11:00:00.000Z',
          stages: ['step'],
        },
      ],
    } as any);

    const snapshot = await buildGovernanceCostAllocationSnapshot({ windowDays: 7 });

    expect(snapshot.windowDays).toBe(7);
    expect(snapshot.capabilityCount).toBe(2);
    expect(snapshot.totalTokens).toBe(1700);
    expect(snapshot.totalCostUsd).toBe(0.0164);
    expect(snapshot.rows).toEqual([
      expect.objectContaining({
        capabilityId: 'CAP-ARCH',
        agentId: 'architect-agent',
        agentName: 'Architect Agent',
        totalTokens: 1200,
      }),
      expect.objectContaining({
        capabilityId: 'CAP-OPS',
        agentId: 'devops-agent',
        agentName: 'DevOps Agent',
        totalTokens: 500,
      }),
    ]);
  });
});
