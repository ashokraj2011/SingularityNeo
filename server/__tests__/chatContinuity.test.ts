// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  normalizeChatHistory,
  resolveChatFollowUpContext,
} from '../chatContinuity';

describe('chat continuity helpers', () => {
  it('strips a duplicated latest user turn from history', () => {
    const history = normalizeChatHistory({
      history: [
        { role: 'agent', content: 'Would you like me to search the workspace?' },
        { role: 'user', content: 'yes' },
      ],
      latestMessage: 'yes',
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.content).toContain('search the workspace');
  });

  it('binds short follow-up replies to the previous assistant turn', () => {
    const resolved = resolveChatFollowUpContext({
      history: [
        {
          role: 'agent',
          content:
            'I can search the workspace for operator-related classes and functions. Would you like me to do that?',
        },
      ],
      latestMessage: 'yes',
      sessionScope: 'GENERAL_CHAT',
      sessionScopeId: 'CAP-1',
    });

    expect(resolved.followUpBindingMode).toBe('latest-assistant-turn');
    expect(resolved.followUpContextPrompt).toContain('Most recent assistant turn');
    expect(resolved.contextMessage).toContain('Operator reply: yes');
  });

  it('binds short follow-up replies to the active work scope when no assistant turn exists', () => {
    const resolved = resolveChatFollowUpContext({
      history: [],
      latestMessage: 'continue',
      sessionScope: 'WORK_ITEM',
      sessionScopeId: 'WI-123',
      workItemId: 'WI-123',
      runId: 'RUN-1',
    });

    expect(resolved.followUpBindingMode).toBe('active-work-scope');
    expect(resolved.followUpContextPrompt).toContain('same work item WI-123');
  });
});
