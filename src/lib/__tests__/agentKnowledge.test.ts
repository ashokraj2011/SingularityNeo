import { describe, expect, it } from 'vitest';
import { getStandardAgentContract, SKILL_LIBRARY } from '../../constants';
import { buildAgentKnowledgeLens, buildAgentKnowledgePrompt } from '../agentKnowledge';
import { buildCapabilityBriefing } from '../capabilityBriefing';
import { createDefaultCapabilityLifecycle } from '../capabilityLifecycle';
import type { Capability, CapabilityAgent, CapabilityWorkspace } from '../../types';

const capability = (): Capability => ({
  id: 'CAP-KNOW',
  name: 'Release Cockpit',
  description: 'Keep release work visible, safe, and fast.',
  ownerTeam: 'Release Engineering',
  businessOutcome: 'Deliver production-ready changes with tighter feedback loops.',
  successMetrics: ['Release blockers are visible before cutover.'],
  definitionOfDone: 'The team can explain what changed, why, and what evidence supports it.',
  requiredEvidenceKinds: ['Review packet', 'Test evidence'],
  operatingPolicySummary: 'Approvals and release evidence are mandatory for production changes.',
  applications: ['Release Portal'],
  apis: [],
  databases: [],
  gitRepositories: ['ssh://git.example.com/release.git'],
  localDirectories: ['/workspace/release'],
  teamNames: ['Release Engineering'],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    allowedWorkspacePaths: ['/workspace/release'],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: SKILL_LIBRARY,
});

const agent = (): CapabilityAgent => ({
  id: 'AGENT-REL',
  capabilityId: 'CAP-KNOW',
  name: 'Release Engineer',
  role: 'Release Engineer',
  objective: 'Keep releases safe and explainable.',
  systemPrompt: '',
  contract: getStandardAgentContract('DEVOPS'),
  initializationStatus: 'READY',
  documentationSources: [],
  inputArtifacts: [],
  outputArtifacts: [],
  isBuiltIn: true,
  standardTemplateKey: 'DEVOPS',
  learningNotes: [],
  skillIds: ['SKL-GENERAL-REPO-INSTRUCTIONS', 'SKL-ROLE-RELEASE-ENGINEER'],
  preferredToolIds: ['workspace_read', 'run_test', 'run_deploy'],
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
    status: 'READY',
    summary: 'This agent understands the release evidence path and rollout constraints.',
    highlights: ['Production rollouts must stay reversible.'],
    contextBlock: 'Focus on rollout safety, validation, and rollback readiness.',
    sourceDocumentIds: [],
    sourceArtifactIds: ['ART-1'],
    sourceCount: 5,
    refreshedAt: new Date().toISOString(),
  },
  sessionSummaries: [
    {
      sessionId: 'SESSION-1',
      scope: 'GENERAL_CHAT',
      scopeId: 'CAP-KNOW',
      lastUsedAt: new Date().toISOString(),
      model: 'gpt-4.1-mini',
      requestCount: 4,
      totalTokens: 1250,
    },
  ],
});

const workspace = (): CapabilityWorkspace => ({
  capabilityId: 'CAP-KNOW',
  briefing: buildCapabilityBriefing(capability()),
  agents: [agent()],
  workflows: [],
  artifacts: [
    {
      id: 'ART-1',
      name: 'Release review packet',
      capabilityId: 'CAP-KNOW',
      type: 'Review Packet',
      version: 'v1',
      agent: 'Release Engineer',
      created: new Date().toISOString(),
      summary: 'Documents rollout evidence and rollback checks.',
      direction: 'OUTPUT',
    },
  ],
  tasks: [],
  executionLogs: [],
  learningUpdates: [
    {
      id: 'LEARN-1',
      capabilityId: 'CAP-KNOW',
      agentId: 'AGENT-REL',
      sourceLogIds: ['LOG-1'],
      insight: 'Approval delays dropped after the team attached the release packet earlier.',
      triggerType: 'GUIDANCE',
      relatedWorkItemId: 'WI-1',
      relatedRunId: 'RUN-1',
      timestamp: new Date().toISOString(),
    },
  ],
  workItems: [],
  messages: [],
  createdAt: new Date().toISOString(),
});

describe('buildAgentKnowledgeLens', () => {
  it('surfaces role knowledge, live deltas, and provenance in one view model', () => {
    const lens = buildAgentKnowledgeLens({
      capability: capability(),
      workspace: workspace(),
      agent: agent(),
      workItemId: 'WI-1',
    });

    expect(lens.summary).toContain('release evidence path');
    expect(lens.freshnessSignal).toBe('FRESH');
    expect(lens.capabilityKnowledge).toContain(
      'Deliver production-ready changes with tighter feedback loops.',
    );
    expect(lens.liveExecutionLearning.join(' ')).toContain('Approval delays dropped');
    expect(lens.provenance.map(source => source.kind)).toEqual(
      expect.arrayContaining(['METADATA', 'ARTIFACT', 'SESSION', 'LEARNING']),
    );
    expect(lens.deltas).toHaveLength(1);
  });

  it('formats the lens into a reusable prompt block', () => {
    const prompt = buildAgentKnowledgePrompt(
      buildAgentKnowledgeLens({
        capability: capability(),
        workspace: workspace(),
        agent: agent(),
      }),
    );

    expect(prompt).toContain('Knowledge summary:');
    expect(prompt).toContain('Base role knowledge:');
    expect(prompt).toContain('Capability knowledge:');
    expect(prompt).toContain('Live execution learning:');
    expect(prompt).toContain('Context block:');
  });
});
