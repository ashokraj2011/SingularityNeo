// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

import { query } from '../db';
import {
  appendSwarmTranscriptTurn,
  findOpenSwarmSessionForScope,
} from '../swarmRepository';

const queryMock = vi.mocked(query);

const rowResult = <T>(rows: T[]) =>
  ({
    rows,
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('swarm repository', () => {
  it('persists general-chat transcript turns with the real session scope', async () => {
    queryMock.mockResolvedValueOnce(rowResult([]));

    const turn = await appendSwarmTranscriptTurn({
      capabilityId: 'CAP-1',
      sessionId: 'SWS-1',
      turnType: 'SYNTHESIS',
      sessionScope: 'GENERAL_CHAT',
      sessionScopeId: 'CAP-1',
      sourceCapabilityId: 'CAP-2',
      agentId: 'AG-2',
      agentName: 'Security Agent',
      content: 'Here is the synthesized plan.',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, params] = queryMock.mock.calls[0]!;
    expect(params?.[9]).toBe('GENERAL_CHAT');
    expect(params?.[10]).toBe('CAP-1');
    expect(params?.[11]).toBeNull();
    expect(turn.sessionScope).toBe('GENERAL_CHAT');
    expect(turn.sessionScopeId).toBe('CAP-1');
    expect(turn.workItemId).toBeUndefined();
  });

  it('looks up open sessions by scope bucket using the null-safe key', async () => {
    queryMock.mockResolvedValueOnce(
      rowResult([
        {
          id: 'SWS-2',
          capability_id: 'CAP-1',
          work_item_id: null,
          session_scope: 'GENERAL_CHAT',
          initiator_user_id: 'USR-1',
          status: 'RUNNING',
          lead_participant_id: 'SWP-1',
          promoted_work_item_id: null,
          initiating_prompt: 'Debate the change.',
          token_budget_used: 10,
          max_token_budget: 100,
          terminal_reason: null,
          created_at: '2026-04-24T10:00:00.000Z',
          updated_at: '2026-04-24T10:00:00.000Z',
          completed_at: null,
        },
      ]),
    );

    const session = await findOpenSwarmSessionForScope(
      'CAP-1',
      'GENERAL_CHAT',
      null,
    );

    expect(queryMock.mock.calls[0]?.[0]).toContain(
      "COALESCE(work_item_id, '__none__') = COALESCE($3, '__none__')",
    );
    expect(session?.id).toBe('SWS-2');
  });
});
