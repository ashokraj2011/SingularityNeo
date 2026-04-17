import { describe, expect, it } from 'vitest';
import { createDefaultCapabilityLifecycle } from '../capabilityLifecycle';
import { buildCapabilityBriefing } from '../capabilityBriefing';
import { buildLocalReadinessContract } from '../readinessContract';
import type { Capability, CapabilityWorkspace, Workflow } from '../../types';

const capability = (overrides: Partial<Capability> = {}): Capability => ({
  id: 'CAP-READY',
  name: 'Engineering Cockpit',
  description: 'A capability with explicit readiness gates.',
  ownerTeam: 'Platform',
  businessOutcome: 'Make delivery execution safe and visible.',
  successMetrics: ['Time to first evidence drops.'],
  definitionOfDone: 'At least one evidence packet exists.',
  requiredEvidenceKinds: ['Evidence packet'],
  operatingPolicySummary: 'Desktop execution is required.',
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: ['ssh://git.example.com/cockpit.git'],
  localDirectories: ['/workspace/cockpit'],
  teamNames: ['Platform'],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    defaultWorkspacePath: '/workspace/cockpit',
    allowedWorkspacePaths: ['/workspace/cockpit'],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: [],
  ...overrides,
});

const workflow = (overrides: Partial<Workflow> = {}): Workflow => ({
  id: 'WF-READY',
  name: 'Delivery',
  capabilityId: 'CAP-READY',
  steps: [
    {
      id: 'STEP-1',
      name: 'Plan',
      phase: 'ANALYSIS',
      stepType: 'DELIVERY',
      agentId: 'AGENT-1',
      action: 'Plan the work.',
    },
  ],
  publishState: 'PUBLISHED',
  status: 'STABLE',
  scope: 'CAPABILITY',
  ...overrides,
});

const workspace = (overrides: Partial<CapabilityWorkspace> = {}): CapabilityWorkspace => ({
  capabilityId: 'CAP-READY',
  briefing: buildCapabilityBriefing(capability()),
  agents: [],
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

describe('buildLocalReadinessContract', () => {
  it('marks all gates ready when the contract, workflow, workspace, and runtime are present', () => {
    const contract = buildLocalReadinessContract({
      capability: capability(),
      workspace: workspace(),
      runtimeStatus: {
        configured: true,
        provider: 'GitHub Copilot SDK',
        endpoint: 'http://127.0.0.1:4321',
        tokenSource: 'headless-cli',
        defaultModel: 'gpt-4.1',
        availableModels: [],
      },
    });

    expect(contract.allReady).toBe(true);
    expect(contract.gates.every(gate => gate.satisfied)).toBe(true);
  });

  it('blocks execution when no approved workspace or workflow exists', () => {
    const contract = buildLocalReadinessContract({
      capability: capability({
        localDirectories: [],
        gitRepositories: [],
        executionConfig: {
          allowedWorkspacePaths: [],
          commandTemplates: [],
          deploymentTargets: [],
        },
      }),
      workspace: workspace({
        workflows: [],
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

    expect(contract.allReady).toBe(false);
    expect(contract.gates.filter(gate => !gate.satisfied).map(gate => gate.id)).toEqual(
      expect.arrayContaining([
        'SOURCE_CONTEXT_CONNECTED',
        'APPROVED_WORKSPACE_PRESENT',
        'WORKFLOW_VALID_AND_PUBLISHED',
        'EXECUTION_RUNTIME_READY',
      ]),
    );
  });
});
