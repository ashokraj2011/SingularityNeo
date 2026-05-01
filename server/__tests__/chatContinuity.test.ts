// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  normalizeChatHistory,
  resolveChatFollowUpContext,
  shouldPreferFollowUpContinuation,
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
    expect(resolved.followUpIntent).toBe('run-proposed-search');
    expect(resolved.effectiveMessageSource).toBe('bound-follow-up');
    expect(resolved.followUpContextPrompt).toContain('Most recent assistant turn');
    expect(resolved.contextMessage).toContain('Latest user follow-up reply: yes');
    expect(resolved.effectiveMessage).toContain(
      'Execute that grounded search now',
    );
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
    expect(resolved.followUpIntent).toBe('active-work-scope');
    expect(resolved.effectiveMessageSource).toBe('active-work-scope');
    expect(resolved.followUpContextPrompt).toContain('same work item WI-123');
  });

  it('treats explicit repo-search follow-ups as acceptance of the previous search offer', () => {
    const resolved = resolveChatFollowUpContext({
      history: [
        {
          role: 'agent',
          content:
            'I can browse the repository and search the codebase for operator definitions. Would you like me to do that now?',
        },
      ],
      latestMessage: 'search and tell me',
      sessionScope: 'GENERAL_CHAT',
      sessionScopeId: 'CAP-1',
    });

    expect(resolved.followUpBindingMode).toBe('latest-assistant-turn');
    expect(resolved.followUpIntent).toBe('run-proposed-search');
    expect(resolved.effectiveMessageSource).toBe('bound-follow-up');
    expect(resolved.followUpContextPrompt).toContain(
      'Do not ask the user what to search for again.',
    );
  });

  it('binds "yes do that" to a prior repo inspection recommendation', () => {
    const resolved = resolveChatFollowUpContext({
      history: [
        {
          role: 'agent',
          content:
            'The exact operator list is not yet available. Further code inspection or documentation review would be needed to determine this.',
        },
      ],
      latestMessage: 'yes do that',
      sessionScope: 'GENERAL_CHAT',
      sessionScopeId: 'CAP-1',
    });

    expect(resolved.followUpBindingMode).toBe('latest-assistant-turn');
    expect(resolved.followUpIntent).toBe('run-proposed-search');
    expect(resolved.effectiveMessage).toContain('Execute that grounded search now');
  });

  it('falls back to durable session memory when transcript tail is missing', () => {
    const resolved = resolveChatFollowUpContext({
      history: [],
      latestMessage: 'search and tell me',
      sessionScope: 'GENERAL_CHAT',
      sessionScopeId: 'CAP-1',
      sessionMemory: {
        rollingSummary: 'The agent previously proposed searching the repo.',
        lastAssistantActionableOffer:
          'I can browse the repository and inspect the codebase for operator definitions.',
        recentRepoCodeTarget: 'operators in the rule engine',
      },
    });

    expect(resolved.followUpBindingMode).toBe('latest-assistant-turn');
    expect(resolved.followUpIntent).toBe('run-proposed-search');
  });

  it('prefers follow-up continuation over workspace control when the reply is ambiguous', () => {
    expect(
      shouldPreferFollowUpContinuation({
        latestMessage: 'yes do that',
        followUpBindingMode: 'latest-assistant-turn',
      }),
    ).toBe(true);

    expect(
      shouldPreferFollowUpContinuation({
        latestMessage: 'approve work item WI-123',
        followUpBindingMode: 'latest-assistant-turn',
      }),
    ).toBe(false);
  });

  it('passes through non-follow-up messages unchanged', () => {
    const resolved = resolveChatFollowUpContext({
      history: [
        {
          role: 'agent',
          content: 'Would you like me to search the workspace?',
        },
      ],
      latestMessage: 'List the operator classes and their package names.',
      sessionScope: 'GENERAL_CHAT',
      sessionScopeId: 'CAP-1',
    });

    expect(resolved.followUpBindingMode).toBe('none');
    expect(resolved.followUpIntent).toBe('none');
    expect(resolved.effectiveMessageSource).toBe('raw-user');
    expect(resolved.effectiveMessage).toBe(
      'List the operator classes and their package names.',
    );
  });
});
