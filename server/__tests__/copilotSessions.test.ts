// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildCopilotSessionMonitorData } from '../copilotSessions';

describe('copilot session monitor summary semantics', () => {
  it('keeps active, stored, and resumable counts aligned to the merged session record', () => {
    const { sessions, summary } = buildCopilotSessionMonitorData([
      {
        sessionId: 'S-1',
        agentId: 'AG-1',
        agentName: 'Builder',
        scope: 'WORK_ITEM',
        scopeId: 'WI-1',
        lastUsedAt: '2026-04-21T10:00:00.000Z',
        model: 'gpt-5.4',
        requestCount: 4,
        totalTokens: 100,
        hasStoredSummary: true,
        hasLiveSession: true,
      },
      {
        sessionId: 'S-2',
        agentId: 'AG-2',
        agentName: 'Reviewer',
        scope: 'GENERAL_CHAT',
        lastUsedAt: '2026-04-21T09:00:00.000Z',
        model: 'gpt-5.4-mini',
        requestCount: 2,
        totalTokens: 80,
        hasStoredSummary: false,
        hasLiveSession: true,
      },
      {
        sessionId: 'S-3',
        agentId: 'AG-3',
        agentName: 'Planner',
        scope: 'TASK',
        scopeId: 'TASK-9',
        lastUsedAt: '2026-04-21T08:00:00.000Z',
        model: 'gpt-5.4',
        requestCount: 3,
        totalTokens: 60,
        hasStoredSummary: true,
        hasLiveSession: false,
      },
    ]);

    expect(sessions).toHaveLength(3);
    expect(summary).toEqual({
      activeSessionCount: 2,
      storedSessionCount: 2,
      resumableSessionCount: 2,
      totalTokens: 240,
      generalChatCount: 1,
      workItemCount: 1,
      taskCount: 1,
    });
    expect(sessions.find(session => session.sessionId === 'S-2')).toMatchObject({
      live: true,
      resumable: false,
      state: 'ACTIVE',
    });
    expect(sessions.find(session => session.sessionId === 'S-3')).toMatchObject({
      live: false,
      resumable: true,
      state: 'STORED',
    });
  });
});
