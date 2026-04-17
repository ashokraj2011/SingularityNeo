// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { executeTool } from '../execution/tools';
import { __eventBusTestUtils } from '../eventBus';
import type { Capability, CapabilityAgent } from '../../src/types';
import { getStandardAgentContract } from '../../src/constants';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';

const buildCapability = (): Capability => ({
  id: 'CAP-BOUNTY',
  name: 'Bounty Capability',
  description: 'Capability for bounty tool validation tests.',
  businessOutcome: 'Coordinate bounded agent handoffs safely.',
  successMetrics: ['Bounties remain scoped and ownership-aware.'],
  definitionOfDone: 'Experimental bounty tools reject unsafe resolutions.',
  requiredEvidenceKinds: ['Execution trace'],
  operatingPolicySummary: 'Experimental tools must not silently cross agent boundaries.',
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  localDirectories: [],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    defaultWorkspacePath: '/workspace/app',
    allowedWorkspacePaths: ['/workspace/app'],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: [],
});

const buildAgent = (
  id: string,
  role: string,
  overrides: Partial<CapabilityAgent> = {},
): CapabilityAgent => ({
  id,
  capabilityId: 'CAP-BOUNTY',
  name: role,
  role,
  objective: 'Coordinate the current step safely.',
  systemPrompt: '',
  contract: getStandardAgentContract('SOFTWARE-DEVELOPER'),
  initializationStatus: 'READY',
  documentationSources: [],
  inputArtifacts: [],
  outputArtifacts: [],
  skillIds: [],
  provider: 'GitHub Copilot SDK',
  model: 'test-model',
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
    summary: '',
    highlights: [],
    contextBlock: '',
    sourceDocumentIds: [],
    sourceArtifactIds: [],
    sourceCount: 0,
  },
  sessionSummaries: [],
  ...overrides,
});

afterEach(() => {
  __eventBusTestUtils.resetBounties();
});

describe('experimental bounty tools', () => {
  it('rejects duplicate bounty publish attempts', async () => {
    const capability = buildCapability();
    const architect = buildAgent('AGENT-ARCH', 'Architect');

    await executeTool({
      capability,
      agent: architect,
      toolId: 'publish_bounty',
      args: {
        bountyId: 'B-1',
        instructions: 'Inspect the backend route.',
      },
    });

    await expect(
      executeTool({
        capability,
        agent: architect,
        toolId: 'publish_bounty',
        args: {
          bountyId: 'B-1',
          instructions: 'Inspect the backend route again.',
        },
      }),
    ).rejects.toThrow('already exists');
  });

  it('prevents an agent from resolving its own bounty', async () => {
    const capability = buildCapability();
    const architect = buildAgent('AGENT-ARCH', 'Architect');

    await executeTool({
      capability,
      agent: architect,
      toolId: 'publish_bounty',
      args: {
        bountyId: 'B-2',
        instructions: 'Need a peer check on this step.',
      },
    });

    await expect(
      executeTool({
        capability,
        agent: architect,
        toolId: 'resolve_bounty',
        args: {
          bountyId: 'B-2',
          status: 'RESOLVED',
          resultSummary: 'Done',
        },
      }),
    ).rejects.toThrow('cannot resolve its own bounty');
  });

  it('enforces target role and publisher ownership checks', async () => {
    const capability = buildCapability();
    const architect = buildAgent('AGENT-ARCH', 'Architect');
    const qa = buildAgent('AGENT-QA', 'QA');
    const developer = buildAgent('AGENT-DEV', 'Backend Developer');

    await executeTool({
      capability,
      agent: architect,
      toolId: 'publish_bounty',
      args: {
        bountyId: 'B-3',
        targetRole: 'Backend',
        instructions: 'Implement the route.',
      },
    });

    await expect(
      executeTool({
        capability,
        agent: qa,
        toolId: 'resolve_bounty',
        args: {
          bountyId: 'B-3',
          status: 'RESOLVED',
        },
      }),
    ).rejects.toThrow('does not match');

    await expect(
      executeTool({
        capability,
        agent: developer,
        toolId: 'wait_for_signal',
        args: {
          bountyId: 'B-3',
        },
      }),
    ).rejects.toThrow('Only the publishing agent');
  });
});
