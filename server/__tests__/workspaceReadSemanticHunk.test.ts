// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Capability, CapabilityAgent } from '../../src/types';
import { getStandardAgentContract } from '../../src/constants';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';

const {
  findSymbolRangeInFileMock,
  findFileDependentsMock,
  findFileDependenciesMock,
  listTopExportsInFileMock,
} = vi.hoisted(() => ({
  findSymbolRangeInFileMock: vi.fn(),
  findFileDependentsMock: vi.fn(),
  findFileDependenciesMock: vi.fn(),
  listTopExportsInFileMock: vi.fn(),
}));

vi.mock('../codeIndex/query', () => ({
  findSymbolRangeInFile: findSymbolRangeInFileMock,
  findFileDependents: findFileDependentsMock,
  findFileDependencies: findFileDependenciesMock,
  listTopExportsInFile: listTopExportsInFileMock,
}));

import { executeTool } from '../execution/tools';

const temporaryRoots: string[] = [];

const createWorkspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'singularity-read-'));
  temporaryRoots.push(root);
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  return root;
};

const buildCapability = (workspacePath: string): Capability => ({
  id: 'CAP-READ',
  name: 'Semantic Read Capability',
  description: 'Capability for semantic workspace read tests.',
  businessOutcome: 'Read focused symbol hunks instead of whole files.',
  successMetrics: ['Workspace reads stay bounded to semantic slices.'],
  definitionOfDone: 'workspace_read returns bounded semantic hunks when symbol metadata exists.',
  requiredEvidenceKinds: ['Code diff'],
  operatingPolicySummary: 'Read only from approved workspace roots.',
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
  id: 'AGENT-READER',
  capabilityId: 'CAP-READ',
  name: 'Reader',
  role: 'Software Developer',
  objective: 'Read code precisely.',
  systemPrompt: '',
  contract: getStandardAgentContract('SOFTWARE-DEVELOPER'),
  initializationStatus: 'READY',
  documentationSources: [],
  inputArtifacts: [],
  outputArtifacts: [],
  learningNotes: [],
  skillIds: [],
  preferredToolIds: ['workspace_read'],
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
  vi.clearAllMocks();
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('workspace_read semantic hunk mode', () => {
  it('returns only the targeted semantic slice plus configured context lines', async () => {
    const workspacePath = createWorkspace();
    const filePath = path.join(workspacePath, 'src/AuthService.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const content = Array.from({ length: 220 }, (_, index) => `line ${index + 1}`).join('\n');
    fs.writeFileSync(filePath, content, 'utf8');

    findSymbolRangeInFileMock.mockResolvedValue({
      symbolId: 'SYM-LOGIN',
      containerSymbolId: 'SYM-AUTH',
      qualifiedSymbolName: 'AuthService.login',
      startLine: 80,
      endLine: 110,
      sliceStartLine: 84,
      sliceEndLine: 92,
      kind: 'method',
    });
    findFileDependentsMock.mockResolvedValue([]);
    findFileDependenciesMock.mockResolvedValue([]);
    listTopExportsInFileMock.mockResolvedValue([]);

    const result = await executeTool({
      capability: buildCapability(workspacePath),
      agent: buildAgent(),
      toolId: 'workspace_read',
      args: {
        path: 'src/AuthService.ts',
        symbol: 'AuthService.login',
        symbolContextLines: 2,
      },
    });

    expect(result.details).toMatchObject({
      mode: 'semantic-hunk',
      compression: 'none',
      symbolId: 'SYM-LOGIN',
      containerSymbolId: 'SYM-AUTH',
      qualifiedSymbolName: 'AuthService.login',
      semanticStartLine: 84,
      semanticEndLine: 92,
      sliceStartLine: 82,
      sliceEndLine: 94,
    });
    expect(result.summary).toContain('semantic lines 84-92');
    expect(result.stdoutPreview).toContain('   82  line 82');
    expect(result.stdoutPreview).toContain('   94  line 94');
    expect(result.stdoutPreview).not.toContain('line 20');
    expect(result.stdoutPreview).not.toContain('line 150');
  });

  it('collapses repeated blank lines only for whole-file reads', async () => {
    const workspacePath = createWorkspace();
    const filePath = path.join(workspacePath, 'README.md');
    fs.writeFileSync(
      filePath,
      ['alpha', '', '', '', 'beta', '  ', '', 'gamma'].join('\n'),
      'utf8',
    );

    findSymbolRangeInFileMock.mockResolvedValue(null);
    findFileDependentsMock.mockResolvedValue([]);
    findFileDependenciesMock.mockResolvedValue([]);
    listTopExportsInFileMock.mockResolvedValue([]);

    const result = await executeTool({
      capability: buildCapability(workspacePath),
      agent: buildAgent(),
      toolId: 'workspace_read',
      args: {
        path: 'README.md',
      },
    });

    expect(result.details).toMatchObject({
      mode: 'whole-file',
      compression: 'blank-line-collapse',
    });
    expect(result.stdoutPreview).toBe(['alpha', '', 'beta', '', 'gamma'].join('\n'));
  });

  it('applies the same safe compression for whole-file fallback reads', async () => {
    const workspacePath = createWorkspace();
    const filePath = path.join(workspacePath, 'src/AuthService.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      ['export const alpha = 1;', '', '', '', 'export const beta = 2;'].join('\n'),
      'utf8',
    );

    findSymbolRangeInFileMock.mockResolvedValue(null);
    findFileDependentsMock.mockResolvedValue([]);
    findFileDependenciesMock.mockResolvedValue([]);
    listTopExportsInFileMock.mockResolvedValue([]);

    const result = await executeTool({
      capability: buildCapability(workspacePath),
      agent: buildAgent(),
      toolId: 'workspace_read',
      args: {
        path: 'src/AuthService.ts',
        symbol: 'AuthService.login',
      },
    });

    expect(result.details).toMatchObject({
      mode: 'whole-file-fallback',
      compression: 'blank-line-collapse',
      symbolLookupMissed: true,
    });
    expect(result.stdoutPreview).toBe(
      ['export const alpha = 1;', '', 'export const beta = 2;'].join('\n'),
    );
  });
});
