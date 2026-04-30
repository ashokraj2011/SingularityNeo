// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import type { Capability, CapabilityAgent } from '../../src/types';
import { getStandardAgentContract } from '../../src/constants';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';
import { TOOL_ADAPTER_IDS } from '../../src/lib/toolCatalog';
import { __eventBusTestUtils } from '../eventBus';
import { buildProviderToolDefinitions, executeTool, getToolAdapter } from '../execution/tools';

const temporaryRoots: string[] = [];

const createWorkspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'singularity-tool-matrix-'));
  temporaryRoots.push(root);
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'main.ts'),
    'export const value = 1;\nexport function helloOperator() {\n  return value;\n}\n',
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'README.md'), 'hello operator runtime\n', 'utf8');
  return root;
};

const createCommittedPatchForFile = ({
  workspacePath,
  relativePath,
  originalContent,
  updatedContent,
}: {
  workspacePath: string;
  relativePath: string;
  originalContent: string;
  updatedContent: string;
}) => {
  const filePath = path.join(workspacePath, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, originalContent, 'utf8');
  execFileSync('git', ['add', relativePath], { cwd: workspacePath, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=Singularity Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'seed'],
    { cwd: workspacePath, stdio: 'ignore' },
  );
  fs.writeFileSync(filePath, updatedContent, 'utf8');
  const patchText = execFileSync('git', ['diff', '--', relativePath], {
    cwd: workspacePath,
    encoding: 'utf8',
  });
  fs.writeFileSync(filePath, originalContent, 'utf8');
  return { filePath, patchText };
};

const buildCapability = (workspacePath: string): Capability => ({
  id: 'CAP-TOOLS',
  name: 'Tool Matrix Capability',
  description: 'Capability for tool coverage tests.',
  businessOutcome: 'Keep the runtime registry complete and executable.',
  successMetrics: ['Every registered tool either executes or returns a clear guardrail error.'],
  definitionOfDone: 'Tool coverage stays comprehensive as the registry evolves.',
  requiredEvidenceKinds: ['Execution trace'],
  operatingPolicySummary: 'Tool execution stays inside approved desktop workspaces.',
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  repositories: [],
  localDirectories: [],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    defaultWorkspacePath: workspacePath,
    allowedWorkspacePaths: [workspacePath],
    commandTemplates: [
      {
        id: 'build',
        label: 'Build',
        command: ['node', '-e', 'console.log("build ok")'],
      },
      {
        id: 'test',
        label: 'Test',
        command: ['node', '-e', 'console.log("test ok")'],
      },
      {
        id: 'docs',
        label: 'Docs',
        command: ['node', '-e', 'console.log("docs ok")'],
      },
      {
        id: 'deploy',
        label: 'Deploy',
        command: ['node', '-e', 'console.log("deploy ok")'],
        requiresApproval: true,
      },
    ],
    deploymentTargets: [
      {
        id: 'staging',
        label: 'Staging',
        commandTemplateId: 'deploy',
        workspacePath,
      },
    ],
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
  capabilityId: 'CAP-TOOLS',
  name: role,
  role,
  objective: 'Exercise the tool runtime safely.',
  systemPrompt: '',
  contract: getStandardAgentContract('SOFTWARE-DEVELOPER'),
  initializationStatus: 'READY',
  documentationSources: [],
  inputArtifacts: [],
  outputArtifacts: [],
  learningNotes: [],
  skillIds: [],
  preferredToolIds: [...TOOL_ADAPTER_IDS],
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
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('tool registry coverage', () => {
  it('builds provider-function definitions for every registered tool', () => {
    const definitions = buildProviderToolDefinitions(TOOL_ADAPTER_IDS);
    expect(definitions).toHaveLength(TOOL_ADAPTER_IDS.length);
    expect(definitions.map(definition => definition.function.name).sort()).toEqual(
      [...TOOL_ADAPTER_IDS].sort(),
    );
  });

  it('exercises every registered tool through either success or an expected guardrail path', async () => {
    const workspacePath = createWorkspace();
    const capability = buildCapability(workspacePath);
    const architect = buildAgent('AGENT-ARCH', 'Architect');
    const developer = buildAgent('AGENT-DEV', 'Backend Developer');
    const { patchText } = createCommittedPatchForFile({
      workspacePath,
      relativePath: 'src/patched.ts',
      originalContent: 'export const patched = 1;\n',
      updatedContent: 'export const patched = 2;\n',
    });

    await expect(
      executeTool({
        capability,
        agent: architect,
        toolId: 'workspace_list',
        args: {},
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Listed'),
    });

    await expect(
      executeTool({
        capability,
        agent: architect,
        toolId: 'workspace_read',
        args: { path: 'src/main.ts' },
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Read src/main.ts'),
    });

    await expect(
      executeTool({
        capability,
        agent: architect,
        toolId: 'workspace_search',
        args: { pattern: 'helloOperator' },
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Search completed'),
    });

    await expect(
      executeTool({
        capability,
        agent: architect,
        toolId: 'browse_code',
        args: { kind: 'function' },
      }),
    ).resolves.toMatchObject({
      summary: expect.stringMatching(/AST index unavailable|Found/),
    });

    await expect(
      executeTool({
        capability,
        agent: architect,
        toolId: 'git_status',
        args: {},
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Loaded git status'),
    });

    await expect(
      executeTool({
        capability,
        agent: developer,
        toolId: 'workspace_write',
        args: {
          path: 'src/generated.ts',
          content: 'export const generated = true;\n',
        },
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Wrote src/generated.ts'),
    });

    await expect(
      executeTool({
        capability,
        agent: developer,
        toolId: 'workspace_replace_block',
        args: {
          path: 'src/main.ts',
          find: 'export const value = 1;',
          replace: 'export const value = 2;',
          expectedMatches: 1,
        },
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Replaced 1 block match'),
    });

    await expect(
      executeTool({
        capability,
        agent: developer,
        toolId: 'workspace_apply_patch',
        args: { patchText },
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Applied patch'),
    });

    await expect(
      executeTool({
        capability,
        agent: architect,
        toolId: 'delegate_task',
        args: {
          delegatedAgentId: developer.id,
          prompt: 'Inspect the latest failure.',
        },
      }),
    ).rejects.toThrow('cannot be executed outside an active workflow run');

    await expect(
      executeTool({
        capability,
        agent: architect,
        toolId: 'publish_bounty',
        args: {
          bountyId: 'B-COVERAGE-PUBLISH',
          targetRole: 'backend',
          instructions: 'Implement the route.',
        },
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Published experimental bounty'),
    });

    await executeTool({
      capability,
      agent: architect,
      toolId: 'publish_bounty',
      args: {
        bountyId: 'B-COVERAGE-RESOLVE',
        targetRole: 'backend',
        instructions: 'Resolve this work item.',
      },
    });
    await expect(
      executeTool({
        capability,
        agent: developer,
        toolId: 'resolve_bounty',
        args: {
          bountyId: 'B-COVERAGE-RESOLVE',
          status: 'RESOLVED',
          resultSummary: 'Implemented the route.',
        },
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Resolved experimental bounty'),
    });

    await executeTool({
      capability,
      agent: architect,
      toolId: 'publish_bounty',
      args: {
        bountyId: 'B-COVERAGE-WAIT',
        targetRole: 'backend',
        instructions: 'Resolve and signal completion.',
      },
    });
    const waitPromise = executeTool({
      capability,
      agent: architect,
      toolId: 'wait_for_signal',
      args: {
        bountyId: 'B-COVERAGE-WAIT',
        timeoutMs: 2000,
      },
    });
    setTimeout(() => {
      void executeTool({
        capability,
        agent: developer,
        toolId: 'resolve_bounty',
        args: {
          bountyId: 'B-COVERAGE-WAIT',
          status: 'RESOLVED',
          resultSummary: 'Signal sent.',
        },
      });
    }, 10);
    await expect(waitPromise).resolves.toMatchObject({
      summary: expect.stringContaining('was signaled with status: RESOLVED'),
    });

    await expect(
      executeTool({
        capability,
        agent: developer,
        toolId: 'run_build',
        args: {},
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Build completed successfully'),
    });

    await expect(
      executeTool({
        capability,
        agent: developer,
        toolId: 'run_test',
        args: {},
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Test completed successfully'),
    });

    await expect(
      executeTool({
        capability,
        agent: developer,
        toolId: 'run_docs',
        args: {},
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Docs completed successfully'),
    });

    await expect(
      executeTool({
        capability,
        agent: developer,
        toolId: 'run_deploy',
        args: { targetId: 'staging' },
        requireApprovedDeployment: true,
      }),
    ).resolves.toMatchObject({
      summary: expect.stringContaining('Deploy completed successfully'),
    });

    for (const toolId of TOOL_ADAPTER_IDS) {
      expect(getToolAdapter(toolId).id).toBe(toolId);
    }
  });
});
