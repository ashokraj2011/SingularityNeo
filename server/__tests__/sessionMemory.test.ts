// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildAgentSessionMemoryPrompt,
  didAssistantOfferRepoSearch,
  mergeAgentSessionMemoryState,
} from '../domains/context-fabric/sessionMemory';

describe('agent session memory helpers', () => {
  it('detects repo-search offers even when phrased as a required next step', () => {
    expect(
      didAssistantOfferRepoSearch(
        'Further code inspection or documentation review would be needed to determine the operators in this rule engine.',
      ),
    ).toBe(true);
  });

  it('merges user intent, assistant offer, and tool transcript into a rolling summary', () => {
    const merged = mergeAgentSessionMemoryState({
      existing: null,
      update: {
        rawMessage: 'How many operators are there in the rule engine?',
        effectiveMessage: 'Search the rule engine repo and list the operators.',
        recentRepoCodeTarget: 'operators in the rule engine',
        toolTranscript: [
          {
            role: 'agent',
            content: 'browse_code => Operator.java',
            kind: 'TOOL',
          },
        ],
      },
      assistantMessage:
        'I can browse the repository and inspect the codebase for operator definitions.',
    });

    expect(merged.lastUserIntent).toContain('Search the rule engine repo');
    expect(merged.lastAssistantActionableOffer).toContain('browse the repository');
    expect(merged.recentRepoCodeTarget).toContain('operators');
    expect(merged.rollingSummary).toContain('Latest user intent');
    expect(merged.salientTurns).toHaveLength(3);
  });

  it('renders a continuity-safe prompt block', () => {
    const prompt = buildAgentSessionMemoryPrompt({
      id: 'ASESSIONMEM-1',
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      sessionId: 'session-1',
      scope: 'GENERAL_CHAT',
      scopeId: 'CAP-1',
      rollingSummary: 'Latest user intent: inspect operators.',
      salientTurns: [
        { role: 'user', content: 'How many operators are there?' },
        { role: 'agent', content: 'I can inspect the repo.' },
      ],
      lastUserIntent: 'Inspect the repo for operators.',
      lastAssistantActionableOffer: 'I can inspect the repo.',
      recentRepoCodeTarget: 'operators in the rule engine',
      requestCount: 1,
      lastUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    expect(prompt).toContain('Session memory (short-term continuity only)');
    expect(prompt).toContain('Last assistant actionable offer');
    expect(prompt).toContain('Recent repo/code target');
    expect(prompt).toContain('Do not use it as proof');
  });
});
