// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  classifyToolExecutionError,
  executeTool,
} from '../execution/tools';
import type { Capability, CapabilityAgent } from '../../src/types';
import { getStandardAgentContract } from '../../src/constants';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';

const buildCapability = (): Capability => ({
  id: 'CAP-TEST',
  name: 'Test Capability',
  description: 'Capability for tool validation tests.',
  businessOutcome: 'Validate recoverable tool-argument errors.',
  successMetrics: ['Tool validation issues feed back cleanly.'],
  definitionOfDone: 'Recoverable tool failures are classified correctly.',
  requiredEvidenceKinds: ['Execution trace'],
  operatingPolicySummary: 'Tool arguments must stay inside approved boundaries.',
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

const buildAgent = (): CapabilityAgent => ({
  id: 'AGENT-TEST',
  capabilityId: 'CAP-TEST',
  name: 'Developer',
  role: 'Software Developer',
  objective: 'Implement the requested step safely.',
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
});

describe('tool execution validation helpers', () => {
  it('classifies missing required tool arguments as recoverable feedback', () => {
    expect(
      classifyToolExecutionError({
        toolId: 'workspace_search',
        message: 'workspace_search requires a pattern.',
      }),
    ).toEqual({
      recoverable: true,
      feedback:
        'Tool workspace_search validation failed: workspace_search requires a pattern. Fix the missing required argument and try again.',
    });
  });

  it('classifies invalid workspace path usage as recoverable feedback', () => {
    expect(
      classifyToolExecutionError({
        toolId: 'workspace_read',
        message:
          'Workspace path /tmp/outside is not approved for capability Test Capability.',
      }),
    ).toEqual({
      recoverable: true,
      feedback:
        'Tool workspace_read used an invalid workspace path: Workspace path /tmp/outside is not approved for capability Test Capability. Pick an approved workspace root or child path and try again.',
    });
  });

  it('classifies missing build/test/docs templates as recoverable operator-decision feedback', () => {
    expect(
      classifyToolExecutionError({
        toolId: 'run_build',
        message: 'Capability Rule Engine does not define the build command template.',
      }),
    ).toEqual({
      recoverable: true,
      feedback:
        'Tool run_build cannot run because Capability Rule Engine does not define the build command template. If explicit operator guidance says to skip this command for the current attempt, do not call run_build again. Complete the step and clearly state that the validation was skipped by operator direction. Otherwise pause_for_input and ask whether to configure the missing command template or skip this command for this attempt.',
    });
  });

  it('throws explicit validation errors for missing workspace_read paths', async () => {
    await expect(
      executeTool({
        capability: buildCapability(),
        agent: buildAgent(),
        toolId: 'workspace_read',
        args: {},
      }),
    ).rejects.toThrow('workspace_read requires a path.');
  });

  it('throws explicit validation errors for multi-path workspace_read payloads', async () => {
    await expect(
      executeTool({
        capability: buildCapability(),
        agent: buildAgent(),
        toolId: 'workspace_read',
        args: {
          path: ['src/A.java', 'src/B.java'],
        },
      }),
    ).rejects.toThrow('workspace_read requires a single path string.');
  });
});
