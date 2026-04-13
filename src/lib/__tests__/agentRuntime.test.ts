import { describe, expect, it } from 'vitest';
import {
  getLegacyArtifactListsFromContract,
  normalizeAgentLearningProfile,
  normalizeAgentOperatingContract,
  normalizeAgentRoleStarterKey,
  normalizeAgentSessionSummary,
  normalizeAgentUsage,
  normalizeLearningUpdate,
  normalizeSkill,
} from '../agentRuntime';

describe('agent runtime normalization', () => {
  it('fills safe defaults for partial skills', () => {
    const skill = normalizeSkill({
      id: 'SKL-PARTIAL',
      name: 'Partial skill',
      description: '',
      category: 'Analysis',
      version: '',
      contentMarkdown: '',
    });

    expect(skill.version).toBe('1.0.0');
    expect(skill.contentMarkdown).toContain('# Partial skill');
    expect(skill.origin).toBe('CAPABILITY');
    expect(skill.kind).toBe('CUSTOM');
  });

  it('fills missing learning profile collections', () => {
    const profile = normalizeAgentLearningProfile({
      status: 'READY',
      summary: 'Understands the repo',
    });

    expect(profile.highlights).toEqual([]);
    expect(profile.sourceDocumentIds).toEqual([]);
    expect(profile.sourceArtifactIds).toEqual([]);
    expect(profile.sourceCount).toBe(0);
  });

  it('normalizes missing learning insight to a stable placeholder', () => {
    const update = normalizeLearningUpdate({
      id: 'LUP-1',
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      sourceLogIds: [],
      insight: '',
      timestamp: '2026-04-13T12:00:00.000Z',
    });

    expect(update.insight).toBe('No learning insight was captured for this update yet.');
  });

  it('normalizes partial session and usage records', () => {
    const session = normalizeAgentSessionSummary({
      sessionId: 'S-1',
      lastUsedAt: '2026-04-13T12:00:00.000Z',
      model: 'gpt-test',
    });
    const usage = normalizeAgentUsage({
      totalTokens: 42,
    });

    expect(session.scope).toBe('GENERAL_CHAT');
    expect(session.requestCount).toBe(0);
    expect(usage.totalTokens).toBe(42);
    expect(usage.requestCount).toBe(0);
  });

  it('normalizes structured contracts and preserves advisory-vs-expected artifact defaults', () => {
    const contract = normalizeAgentOperatingContract(
      {
        description: 'Implement safely.',
        suggestedInputArtifacts: [
          {
            artifactName: 'Design notes',
            direction: 'INPUT',
            requiredByDefault: false,
          },
        ],
        expectedOutputArtifacts: [
          {
            artifactName: 'Code diff summary',
            direction: 'OUTPUT',
            requiredByDefault: true,
          },
        ],
      },
      {
        suggestedInputArtifacts: ['Fallback input'],
        expectedOutputArtifacts: ['Fallback output'],
      },
    );

    expect(contract.suggestedInputArtifacts).toEqual([
      {
        artifactName: 'Design notes',
        direction: 'INPUT',
        requiredByDefault: false,
      },
    ]);
    expect(contract.expectedOutputArtifacts).toEqual([
      {
        artifactName: 'Code diff summary',
        direction: 'OUTPUT',
        requiredByDefault: true,
      },
    ]);
    expect(getLegacyArtifactListsFromContract(contract)).toEqual({
      inputArtifacts: ['Design notes'],
      outputArtifacts: ['Code diff summary'],
    });
  });

  it('normalizes starter keys safely', () => {
    expect(normalizeAgentRoleStarterKey('software-developer')).toBe('SOFTWARE-DEVELOPER');
    expect(normalizeAgentRoleStarterKey('not-a-starter')).toBeUndefined();
  });
});
