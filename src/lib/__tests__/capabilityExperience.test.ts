import { describe, expect, it } from 'vitest';
import {
  buildCapabilityExperience,
  getLearningStatusLabel,
} from '../capabilityExperience';
import { buildCapabilityBriefing } from '../capabilityBriefing';
import { createDefaultCapabilityLifecycle } from '../capabilityLifecycle';
import { getStandardAgentContract } from '../../constants';
import type {
  Capability,
  CapabilityAgent,
  CapabilityWorkspace,
  Workflow,
} from '../../types';

const capability = (overrides: Partial<Capability> = {}): Capability => ({
  id: 'CAP-1',
  name: 'Payments',
  description: 'Payments capability',
  domain: 'Payments',
  businessUnit: 'Digital',
  ownerTeam: 'Payments Platform',
  businessOutcome: 'Deliver trustworthy payment processing outcomes.',
  successMetrics: ['Payments flow completes without manual intervention.'],
  definitionOfDone: 'Evidence exists for completed payment work.',
  requiredEvidenceKinds: ['Requirements pack', 'Test evidence'],
  operatingPolicySummary: 'Release actions remain approval-gated.',
  applications: ['Payments Portal'],
  apis: [],
  databases: [],
  gitRepositories: ['ssh://git.example.com/payments.git'],
  localDirectories: [],
  teamNames: ['Payments Platform'],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    allowedWorkspacePaths: [],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: [],
  ...overrides,
});

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
  isOwner: true,
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
    sourceCount: 3,
  },
  sessionSummaries: [],
  ...overrides,
});

const workflow = (overrides: Partial<Workflow> = {}): Workflow => ({
  id: 'WF-1',
  name: 'Enterprise SDLC Flow',
  capabilityId: 'CAP-1',
  steps: [],
  publishState: 'PUBLISHED',
  status: 'STABLE',
  workflowType: 'SDLC',
  scope: 'CAPABILITY',
  ...overrides,
});

const workspace = (overrides: Partial<CapabilityWorkspace> = {}): CapabilityWorkspace => ({
  capabilityId: 'CAP-1',
  briefing: buildCapabilityBriefing(capability()),
  agents: [agent()],
  workflows: [workflow()],
  artifacts: [],
  tasks: [],
  executionLogs: [],
  learningUpdates: [],
  workItems: [],
  messages: [],
  createdAt: new Date(0).toISOString(),
  ...overrides,
});

describe('capability experience model', () => {
  it('scores a ready capability and recommends creating work', () => {
    const experience = buildCapabilityExperience({
      capability: capability({
        localDirectories: ['/workspace/payments'],
        executionConfig: {
          defaultWorkspacePath: '/workspace/payments',
          allowedWorkspacePaths: ['/workspace/payments'],
          commandTemplates: [
            {
              id: 'test',
              label: 'Run tests',
              command: ['npm', 'test'],
              workingDirectory: '/workspace/payments',
              requiresApproval: false,
            },
          ],
          deploymentTargets: [
            {
              id: 'staging',
              label: 'Staging',
              commandTemplateId: 'test',
              workspacePath: '/workspace/payments',
            },
          ],
        },
      }),
      workspace: workspace(),
      runtimeStatus: {
        configured: true,
        provider: 'GitHub Copilot SDK',
        endpoint: 'http://localhost:4321',
        tokenSource: 'headless-cli',
        defaultModel: 'gpt-4.1',
        availableModels: [],
      },
    });

    expect(experience.readinessScore).toBe(92);
    expect(experience.trustLevel).toBe('OPERABLE');
    expect(experience.nextAction.title).toBe('Prove delivery with real work');
    expect(experience.runtimeHealth.label).toBe('Connected');
  });

  it('prioritizes blocked and approval work over setup actions', () => {
    const experience = buildCapabilityExperience({
      capability: capability({ description: '' }),
      workspace: workspace({
        workItems: [
          {
            id: 'WI-1',
            title: 'Add refund API',
            description: '',
            phase: 'DEVELOPMENT',
            capabilityId: 'CAP-1',
            workflowId: 'WF-1',
            status: 'BLOCKED',
            priority: 'High',
            tags: [],
            blocker: {
              type: 'HUMAN_INPUT',
              message: 'Needs product decision.',
              requestedBy: 'Business Analyst',
              timestamp: new Date(0).toISOString(),
              status: 'OPEN',
            },
            history: [],
          },
        ],
      }),
      runtimeStatus: {
        configured: false,
        provider: 'GitHub Copilot SDK',
        endpoint: '',
        tokenSource: null,
        defaultModel: '',
        availableModels: [],
      },
    });

    expect(experience.nextAction.title).toBe('Unblock Add refund API');
    expect(experience.nextAction.path).toContain('/orchestrator?selected=WI-1');
  });

  it('uses business-facing learning labels', () => {
    expect(getLearningStatusLabel('READY')).toBe('Ready to help');
    expect(getLearningStatusLabel('STALE')).toBe('Needs refresh');
    expect(getLearningStatusLabel('ERROR')).toBe('Learning failed');
  });

  it('does not treat default command placeholders as operational proof', () => {
    const experience = buildCapabilityExperience({
      capability: capability({
        localDirectories: ['/workspace/payments'],
        executionConfig: {
          defaultWorkspacePath: '/workspace/payments',
          allowedWorkspacePaths: ['/workspace/payments'],
          commandTemplates: [
            {
              id: 'build',
              label: 'Build',
              description: 'Compile and package the capability workspace.',
              command: ['npm', 'run', 'build'],
            },
          ],
          deploymentTargets: [],
        },
      }),
      workspace: workspace(),
      runtimeStatus: {
        configured: true,
        provider: 'GitHub Copilot SDK',
        endpoint: 'http://localhost:4321',
        tokenSource: 'headless-cli',
        defaultModel: 'gpt-4.1',
        availableModels: [],
      },
    });

    expect(experience.proofItems.find(item => item.level === 'OPERABLE')?.status).toBe(
      'IN_PROGRESS',
    );
  });
});
