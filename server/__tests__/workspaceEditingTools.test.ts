// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { executeTool } from '../execution/tools';
import type { Capability, CapabilityAgent } from '../../src/types';
import { getStandardAgentContract } from '../../src/constants';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';

const temporaryRoots: string[] = [];

const createWorkspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'singularity-tools-'));
  temporaryRoots.push(root);
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
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
  name: 'Tool Capability',
  description: 'Capability for advanced editing tool tests.',
  businessOutcome: 'Keep workspace edits reviewable and safe.',
  successMetrics: ['Workspace edits stay inside approved roots.'],
  definitionOfDone: 'Editing tools fail safely on invalid mutations.',
  requiredEvidenceKinds: ['Code diff'],
  operatingPolicySummary: 'All edits stay inside approved workspaces.',
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
    defaultWorkspacePath: workspacePath,
    allowedWorkspacePaths: [workspacePath],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: [],
});

const buildAgent = (): CapabilityAgent => ({
  id: 'AGENT-DEV',
  capabilityId: 'CAP-TOOLS',
  name: 'Developer',
  role: 'Software Developer',
  objective: 'Edit files safely inside the approved workspace.',
  systemPrompt: '',
  contract: getStandardAgentContract('SOFTWARE-DEVELOPER'),
  initializationStatus: 'READY',
  documentationSources: [],
  inputArtifacts: [],
  outputArtifacts: [],
  learningNotes: [],
  skillIds: [],
  preferredToolIds: ['workspace_replace_block', 'workspace_apply_patch'],
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

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('advanced workspace editing tools', () => {
  it('replaces one exact block and reports touched paths', async () => {
    const workspacePath = createWorkspace();
    const filePath = path.join(workspacePath, 'src/App.tsx');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'const value = 1;\n', 'utf8');

    const result = await executeTool({
      capability: buildCapability(workspacePath),
      agent: buildAgent(),
      toolId: 'workspace_replace_block',
      args: {
        path: 'src/App.tsx',
        find: 'const value = 1;',
        replace: 'const value = 2;',
        expectedMatches: 1,
      },
    });

    expect(fs.readFileSync(filePath, 'utf8')).toContain('const value = 2;');
    expect(result.details?.touchedPaths).toEqual([filePath]);
  });

  it('fails block replacement when no match exists', async () => {
    const workspacePath = createWorkspace();
    const filePath = path.join(workspacePath, 'src/App.tsx');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'const value = 1;\n', 'utf8');

    await expect(
      executeTool({
        capability: buildCapability(workspacePath),
        agent: buildAgent(),
        toolId: 'workspace_replace_block',
        args: {
          path: 'src/App.tsx',
          find: 'const missing = 0;',
          replace: 'const value = 2;',
        },
      }),
    ).rejects.toThrow(`Could not find the requested block in ${filePath}.`);
  });

  it('fails block replacement when the anchor is ambiguous', async () => {
    const workspacePath = createWorkspace();
    const filePath = path.join(workspacePath, 'src/App.tsx');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'const value = 1;\nconst value = 1;\n', 'utf8');

    await expect(
      executeTool({
        capability: buildCapability(workspacePath),
        agent: buildAgent(),
        toolId: 'workspace_replace_block',
        args: {
          path: 'src/App.tsx',
          find: 'const value = 1;',
          replace: 'const value = 2;',
        },
      }),
    ).rejects.toThrow(`Expected 1 block match(es) in ${filePath}, but found 2.`);
  });

  it('applies a unified diff patch inside the approved workspace', async () => {
    const workspacePath = createWorkspace();
    const { filePath, patchText } = createCommittedPatchForFile({
      workspacePath,
      relativePath: 'src/App.tsx',
      originalContent: 'const value = 1;\n',
      updatedContent: 'const value = 2;\n',
    });

    const result = await executeTool({
      capability: buildCapability(workspacePath),
      agent: buildAgent(),
      toolId: 'workspace_apply_patch',
      args: { patchText },
    });

    expect(fs.readFileSync(filePath, 'utf8')).toContain('const value = 2;');
    expect(result.details?.touchedPaths).toEqual([filePath]);
  });

  it('fails patch application when no touched files are inferred', async () => {
    const workspacePath = createWorkspace();

    await expect(
      executeTool({
        capability: buildCapability(workspacePath),
        agent: buildAgent(),
        toolId: 'workspace_apply_patch',
        args: {
          patchText: 'not a valid patch',
        },
      }),
    ).rejects.toThrow('workspace_apply_patch requires at least one touched file in the patch.');
  });

  it('fails patch application when a touched file escapes the approved root', async () => {
    const workspacePath = createWorkspace();

    const patchText = [
      'diff --git a/../outside.txt b/../outside.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/../outside.txt',
      '@@ -0,0 +1 @@',
      '+blocked',
      '',
    ].join('\n');

    await expect(
      executeTool({
        capability: buildCapability(workspacePath),
        agent: buildAgent(),
        toolId: 'workspace_apply_patch',
        args: { patchText },
      }),
    ).rejects.toThrow('escapes the desktop workspace root');
  });

  it('fails patch application cleanly when the hunk is stale', async () => {
    const workspacePath = createWorkspace();
    const { patchText } = createCommittedPatchForFile({
      workspacePath,
      relativePath: 'src/App.tsx',
      originalContent: 'const value = 1;\n',
      updatedContent: 'const value = 2;\n',
    });
    const filePath = path.join(workspacePath, 'src/App.tsx');
    fs.writeFileSync(filePath, 'const value = 3;\n', 'utf8');

    await expect(
      executeTool({
        capability: buildCapability(workspacePath),
        agent: buildAgent(),
        toolId: 'workspace_apply_patch',
        args: { patchText },
      }),
    ).rejects.toThrow(`Unable to apply patch in ${workspacePath}`);
  });
});
