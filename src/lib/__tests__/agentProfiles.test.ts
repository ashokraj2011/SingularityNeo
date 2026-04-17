import { describe, expect, it } from 'vitest';
import { getStandardAgentContract } from '../../constants';
import { enrichCapabilityAgentProfile, selectPrimaryCopilotAgentId } from '../agentProfiles';
import type { CapabilityAgent } from '../../types';

const agent = (overrides: Partial<CapabilityAgent> = {}): CapabilityAgent => ({
  id: 'AGENT-1',
  capabilityId: 'CAP-1',
  name: 'Capability Owner',
  role: 'Owner',
  objective: 'Coordinate capability work.',
  systemPrompt: '',
  contract: getStandardAgentContract('OWNER'),
  initializationStatus: 'READY',
  documentationSources: [],
  inputArtifacts: [],
  outputArtifacts: [],
  isOwner: false,
  isBuiltIn: true,
  learningNotes: [],
  skillIds: [],
  provider: 'GitHub Copilot SDK',
  model: 'gpt-4.1',
  tokenLimit: 12000,
  usage: {
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  },
  previousOutputs: [],
  learningProfile: {
    status: 'READY',
    summary: 'Ready',
    highlights: [],
    contextBlock: '',
    sourceDocumentIds: [],
    sourceArtifactIds: [],
    sourceCount: 0,
  },
  sessionSummaries: [],
  preferredToolIds: [],
  ...overrides,
});

describe('agent operating profiles', () => {
  it('enriches execution ops as the primary capability copilot', () => {
    const profile = enrichCapabilityAgentProfile(
      agent({
        id: 'AGENT-OPS',
        name: 'Execution Ops',
        role: 'Execution Ops',
        roleStarterKey: 'EXECUTION-OPS',
      }),
    );

    expect(profile.userVisibility).toBe('PRIMARY_COPILOT');
    expect(profile.qualityBar?.label).toBe('Operational precision');
    expect(profile.memoryScope?.scopeLabels).toContain('Capability brain');
  });

  it('prefers execution ops when selecting the primary copilot agent', () => {
    const agents = [
      agent({
        id: 'AGENT-OWNER',
        isOwner: true,
        roleStarterKey: 'OWNER',
      }),
      agent({
        id: 'AGENT-OPS',
        roleStarterKey: 'EXECUTION-OPS',
      }),
    ];

    expect(selectPrimaryCopilotAgentId(agents)).toBe('AGENT-OPS');
  });
});
