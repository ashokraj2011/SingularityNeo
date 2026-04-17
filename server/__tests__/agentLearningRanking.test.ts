// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityAgent, Skill } from '../../src/types';
import { getStandardAgentContract } from '../../src/constants';

vi.mock('../githubModels', () => ({
  requestGitHubModel: vi.fn(),
}));

vi.mock('../memory', () => ({
  getCapabilityMemoryCorpus: vi.fn(),
  listMemoryDocuments: vi.fn(),
  rankMemoryCorpusByQuery: vi.fn(),
  refreshCapabilityMemory: vi.fn(),
}));

vi.mock('../repository', () => ({
  getCapabilityBundle: vi.fn(),
}));

vi.mock('../execution/runtimeClient', () => ({
  executionRuntimeRpc: vi.fn(),
  isRemoteExecutionClient: () => false,
}));

vi.mock('../agentLearning/repository', () => ({
  getAgentLearningProfile: vi.fn(),
  listAgentSessionSummaries: vi.fn(),
  listAgentsNeedingLearning: vi.fn(),
  queueAgentLearningJob: vi.fn(),
  updateAgentLearningJob: vi.fn(),
  upsertAgentLearningProfile: vi.fn(),
}));

import { rankMemoryCorpusByQuery } from '../memory';
import { __agentLearningTestUtils } from '../agentLearning/service';

const rankMemoryCorpusByQueryMock = vi.mocked(rankMemoryCorpusByQuery);

const buildAgent = (): CapabilityAgent => ({
  id: 'AGENT-ARCH',
  capabilityId: 'CAP-LEARN',
  name: 'Architecture Guide',
  role: 'Architect',
  objective: 'Shape implementation plans using repository and artifact context.',
  systemPrompt: 'Prefer structured architecture guidance.',
  contract: getStandardAgentContract('ARCHITECT'),
  initializationStatus: 'READY',
  documentationSources: ['architecture.md'],
  inputArtifacts: ['Requirements pack'],
  outputArtifacts: ['Design brief'],
  learningNotes: ['Prioritize capability constraints.'],
  skillIds: ['SKL-ARCH'],
  preferredToolIds: ['workspace_read'],
  provider: 'GitHub Copilot SDK',
  model: 'test-model',
  tokenLimit: 8000,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('agent learning ranking', () => {
  it('delegates corpus ranking to the shared semantic retrieval pipeline', async () => {
    rankMemoryCorpusByQueryMock.mockResolvedValue([{ document: { id: 'DOC-1' } }] as any);
    const agent = buildAgent();
    const skills: Skill[] = [
      {
        id: 'SKL-ARCH',
        name: 'Architecture Patterns',
        description: 'Reference patterns for architecture reviews.',
        category: 'Analysis',
        version: '1.0.0',
        contentMarkdown: 'Prefer bounded changes and strong interface contracts.',
        kind: 'GENERAL',
        origin: 'FOUNDATION',
      },
    ];
    const corpus = [
      {
        document: {
          id: 'DOC-1',
          capabilityId: 'CAP-LEARN',
          title: 'Architecture Memo',
          sourceType: 'REPOSITORY_FILE' as const,
          tier: 'LONG_TERM' as const,
          contentPreview: 'Bounded interfaces',
          createdAt: '2026-04-17T00:00:00.000Z',
          updatedAt: '2026-04-17T00:00:00.000Z',
        },
        chunks: [],
        combinedContent: 'Bounded interfaces and delivery guidance.',
      },
    ];

    const result = await __agentLearningTestUtils.rankCorpusForAgent(
      'CAP-LEARN',
      agent,
      corpus as any,
      skills,
    );

    expect(result).toEqual([{ document: { id: 'DOC-1' } }]);
    expect(rankMemoryCorpusByQueryMock).toHaveBeenCalledTimes(1);
    expect(rankMemoryCorpusByQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        corpus,
        queryText: expect.stringContaining('CAP-LEARN'),
      }),
    );

    const queryText = rankMemoryCorpusByQueryMock.mock.calls[0]?.[0]?.queryText || '';
    expect(queryText).toContain('Architecture Guide');
    expect(queryText).toContain('Architect');
    expect(queryText).toContain('Requirements pack');
    expect(queryText).toContain('Design brief');
    expect(queryText).toContain('architecture');
  });
});
