// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Capability, CapabilityAgent } from '../../src/types';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';
import { executeTool, resolveDeploymentTarget } from '../execution/tools';

const buildCapability = (
  deploymentTargets: Capability['executionConfig']['deploymentTargets'],
  options?: {
    workspacePath?: string;
    deployCommand?: string[];
  },
): Capability => ({
  id: 'CAP-TEST',
  name: 'Test Capability',
  description: 'Capability for deployment target tests.',
  businessOutcome: 'Verify deployment targets resolve correctly.',
  successMetrics: ['Deployment target resolution selects the intended target.'],
  definitionOfDone: 'Deployment commands execute only against approved targets.',
  requiredEvidenceKinds: ['Deployment summary'],
  operatingPolicySummary: 'Deployments remain approval-gated.',
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
    defaultWorkspacePath: options?.workspacePath || '/workspace/app',
    allowedWorkspacePaths: [options?.workspacePath || '/workspace/app'],
    commandTemplates: [
      { id: 'build', label: 'Build', command: ['npm', 'run', 'build'] },
      {
        id: 'deploy',
        label: 'Deploy',
        command: options?.deployCommand || ['npm', 'run', 'deploy'],
        requiresApproval: true,
      },
    ],
    deploymentTargets,
  },
  status: 'STABLE',
  skillLibrary: [],
});

const buildAgent = (): CapabilityAgent => ({
  id: 'AGENT-TEST',
  capabilityId: 'CAP-TEST',
  name: 'Release Agent',
  role: 'Release Manager',
  objective: 'Handle deployment verification.',
  systemPrompt: '',
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

describe('resolveDeploymentTarget', () => {
  it('uses the only deployment target when one exists', () => {
    const capability = buildCapability([
      {
        id: 'target-1',
        label: 'Build Output',
        commandTemplateId: 'build',
        workspacePath: '/workspace/app',
      },
    ]);

    expect(resolveDeploymentTarget(capability).id).toBe('target-1');
    expect(resolveDeploymentTarget(capability, 'build').id).toBe('target-1');
  });

  it('prefers an exact target id match', () => {
    const capability = buildCapability([
      {
        id: 'staging',
        label: 'Staging',
        commandTemplateId: 'deploy',
        workspacePath: '/workspace/app',
      },
      {
        id: 'build',
        label: 'Build Output',
        commandTemplateId: 'build',
        workspacePath: '/workspace/app',
      },
    ]);

    expect(resolveDeploymentTarget(capability, 'build').commandTemplateId).toBe(
      'build',
    );
  });

  it('lists available targets when the request is ambiguous or unknown', () => {
    const capability = buildCapability([
      {
        id: 'staging',
        label: 'Staging',
        commandTemplateId: 'deploy',
        workspacePath: '/workspace/app',
      },
      {
        id: 'production',
        label: 'Production',
        commandTemplateId: 'deploy',
        workspacePath: '/workspace/app',
      },
    ]);

    expect(() => resolveDeploymentTarget(capability, 'build')).toThrow(
      /Available deployment targets: staging -> deploy, production -> deploy/,
    );
  });

  it('blocks run_deploy until an approved deployment gate is present', async () => {
    const capability = buildCapability([
      {
        id: 'staging',
        label: 'Staging',
        commandTemplateId: 'deploy',
        workspacePath: '/workspace/app',
      },
    ]);

    await expect(
      executeTool({
        capability,
        agent: buildAgent(),
        toolId: 'run_deploy',
        args: { targetId: 'staging' },
        requireApprovedDeployment: false,
      }),
    ).rejects.toThrow(/approval-gated/i);
  });

  it('executes the deployment target once approval is granted', async () => {
    const workspacePath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'singularity-deploy-'),
    );
    const capability = buildCapability(
      [
        {
          id: 'staging',
          label: 'Staging',
          commandTemplateId: 'deploy',
          workspacePath,
        },
      ],
      {
        workspacePath,
        deployCommand: ['node', '-e', 'console.log("deploy ok")'],
      },
    );

    try {
      const result = await executeTool({
        capability,
        agent: buildAgent(),
        toolId: 'run_deploy',
        args: { targetId: 'staging' },
        requireApprovedDeployment: true,
      });

      expect(result.summary).toContain('Deploy completed successfully');
      expect(result.workingDirectory).toBe(workspacePath);
      expect(result.stdoutPreview).toContain('deploy ok');
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  });
});
