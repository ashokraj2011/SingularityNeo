// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildCapabilitySystemPrompt } from '../githubModels';
import type { Capability, CapabilityAgent } from '../../src/types';
import { SKILL_LIBRARY, getStandardAgentContract } from '../../src/constants';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';
import { getDefaultExecutionConfig } from '../../src/lib/executionConfig';

const capability: Capability = {
  id: 'CAP-PROMPT',
  name: 'Prompt Test Capability',
  description: 'Capability used to verify prompt skill grounding.',
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  localDirectories: [],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: getDefaultExecutionConfig({ localDirectories: [] }),
  status: 'STABLE',
  successMetrics: [],
  requiredEvidenceKinds: [],
  skillLibrary: SKILL_LIBRARY,
};

const agent: CapabilityAgent = {
  id: 'AGENT-DEV',
  capabilityId: capability.id,
  name: 'Software Developer',
  role: 'Software Developer',
  objective: 'Implement capability changes cleanly.',
  systemPrompt: 'Stay within the capability boundary.',
  contract: getStandardAgentContract('SOFTWARE-DEVELOPER'),
  initializationStatus: 'READY',
  documentationSources: [],
  inputArtifacts: [],
  outputArtifacts: [],
  skillIds: ['SKL-GENERAL-REPO-INSTRUCTIONS', 'SKL-ROLE-SOFTWARE-ENGINEER'],
  preferredToolIds: ['workspace_read', 'workspace_write', 'run_test'],
  provider: 'GitHub Copilot SDK',
  model: 'gpt-4.1-mini',
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
    status: 'NOT_STARTED',
    summary: '',
    highlights: [],
    contextBlock: '',
    sourceDocumentIds: [],
    sourceArtifactIds: [],
    sourceCount: 0,
  },
  sessionSummaries: [],
};

describe('buildCapabilitySystemPrompt', () => {
  it('includes full skill content and preferred tool profile, not only skill ids', () => {
    const prompt = buildCapabilitySystemPrompt({ capability, agent });

    expect(prompt).toContain('Capability briefing for Prompt Test Capability:');
    expect(prompt).toContain('Attached skill ids: SKL-GENERAL-REPO-INSTRUCTIONS, SKL-ROLE-SOFTWARE-ENGINEER');
    expect(prompt).toContain('Shared operating skills:');
    expect(prompt).toContain('Repository-wide Copilot Instructions');
    expect(prompt).toContain('Role skills:');
    expect(prompt).toContain('Software Engineer');
    expect(prompt).toContain('Preferred tool profile: workspace_read, workspace_write, run_test');
    expect(prompt).toContain('Structured agent contract:');
    expect(prompt).toContain('Primary responsibilities:');
  });
});
