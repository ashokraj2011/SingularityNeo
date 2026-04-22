// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionExecutorQueryMock = vi.fn();

vi.mock('../db', () => ({
  getPlatformFeatureState: () => ({
    pgvectorAvailable: false,
    memoryEmbeddingDimensions: 4,
  }),
  query: vi.fn(),
  transaction: vi.fn(async callback => callback({ query: transactionExecutorQueryMock })),
}));

vi.mock('../repository', () => ({
  getCapabilityBundle: vi.fn(),
}));

vi.mock('../agentLearning/repository', () => ({
  getAgentLearningProfile: vi.fn(),
  queueAgentLearningJob: vi.fn(),
}));

vi.mock('../execution/runtimeClient', () => ({
  executionRuntimeRpc: vi.fn(),
  isRemoteExecutionClient: () => false,
}));

vi.mock('../localOpenAIProvider', () => ({
  requestLocalOpenAIEmbeddings: vi.fn(),
}));

vi.mock('../workspaceIndex', () => ({
  getWorkspaceFileIndex: vi.fn(),
}));

import { query } from '../db';
import { getAgentLearningProfile } from '../agentLearning/repository';
import { getCapabilityBundle } from '../repository';
import { requestLocalOpenAIEmbeddings } from '../localOpenAIProvider';
import {
  buildMemoryEmbeddingRefreshSummary,
  buildMemoryContext,
  rankMemoryCorpusByQuery,
  refreshCapabilityMemory,
  searchCapabilityMemory,
} from '../memory';

const queryMock = vi.mocked(query);
const getAgentLearningProfileMock = vi.mocked(getAgentLearningProfile);
const getCapabilityBundleMock = vi.mocked(getCapabilityBundle);
const requestLocalOpenAIEmbeddingsMock = vi.mocked(requestLocalOpenAIEmbeddings);

const buildSearchRow = ({
  documentId,
  title,
  content,
  embedding,
  sourceType = 'REPOSITORY_FILE',
}: {
  documentId: string;
  title: string;
  content: string;
  embedding: number[];
  sourceType?: 'REPOSITORY_FILE' | 'ARTIFACT';
}) => {
  const timestamp = '2026-04-17T00:00:00.000Z';
  return {
    id: documentId,
    capability_id: 'CAP-MEM',
    title,
    source_type: sourceType,
    tier: 'LONG_TERM',
    content_preview: content,
    created_at: timestamp,
    updated_at: timestamp,
    chunk_id: `${documentId}-chunk`,
    document_id: documentId,
    chunk_index: 0,
    content,
    token_estimate: 10,
    chunk_metadata: {},
    chunk_created_at: timestamp,
    embedding_json: embedding,
    vector_model: 'stored-vector-model',
  };
};

const buildCorpus = () => [
  {
    document: {
      id: 'DOC-1',
      capabilityId: 'CAP-MEM',
      title: 'Alpha Architecture',
      sourceType: 'REPOSITORY_FILE' as const,
      tier: 'LONG_TERM' as const,
      contentPreview: 'implementation details',
      createdAt: '2026-04-17T00:00:00.000Z',
      updatedAt: '2026-04-17T00:00:00.000Z',
    },
    chunks: [],
    combinedContent: 'implementation details',
  },
  {
    document: {
      id: 'DOC-2',
      capabilityId: 'CAP-MEM',
      title: 'Beta Notes',
      sourceType: 'REPOSITORY_FILE' as const,
      tier: 'LONG_TERM' as const,
      contentPreview: 'release notes',
      createdAt: '2026-04-17T00:00:00.000Z',
      updatedAt: '2026-04-17T00:00:00.000Z',
    },
    chunks: [],
    combinedContent: 'release notes',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  transactionExecutorQueryMock.mockReset();
  transactionExecutorQueryMock.mockResolvedValue({ rows: [] } as any);
  getAgentLearningProfileMock.mockResolvedValue({
    capabilityId: 'CAP-MEM',
    agentId: 'AGENT-1',
    profile: {
      status: 'READY',
      summary: '',
      highlights: [],
      contextBlock: '',
      sourceDocumentIds: [],
      sourceArtifactIds: [],
      sourceCount: 0,
    },
  } as any);
});

describe('memory retrieval hardening', () => {
  it('builds a single refresh summary for deterministic-hash fallback', () => {
    const summary = buildMemoryEmbeddingRefreshSummary({
      capabilityId: 'CAP-MEM',
      documents: [
        {
          capabilityId: 'CAP-MEM',
          id: 'DOC-1',
          title: 'Human interaction',
          sourceType: 'HUMAN_INTERACTION',
          tier: 'SESSION',
          contentPreview: 'Need exact repository root',
          vectorModel: 'deterministic-hash-v2',
          embeddingProviderKey: 'deterministic-hash',
          embeddingFallbackReason: 'Local embedding provider is not configured.',
          embeddingInputCount: 2,
          embeddingVectorCount: 0,
          chunks: [],
        },
        {
          capabilityId: 'CAP-MEM',
          id: 'DOC-2',
          title: 'Work item',
          sourceType: 'WORK_ITEM',
          tier: 'WORKING',
          contentPreview: 'Implement operator support',
          vectorModel: 'deterministic-hash-v2',
          embeddingProviderKey: 'deterministic-hash',
          embeddingFallbackReason: 'Local embedding provider is not configured.',
          embeddingInputCount: 1,
          embeddingVectorCount: 0,
          chunks: [],
        },
      ],
    });

    expect(summary).toContain('2/2 memory documents used deterministic hash embeddings');
    expect(summary).toContain('Sources: HUMAN_INTERACTION: 1, WORK_ITEM: 1');
    expect(summary).toContain('2x Local embedding provider is not configured.');
    expect(summary).toContain('Set LOCAL_OPENAI_BASE_URL');
  });

  it('logs one refresh summary instead of one warning per document fallback', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    requestLocalOpenAIEmbeddingsMock.mockResolvedValue({
      providerKey: 'deterministic-hash',
      model: 'deterministic-hash-v2',
      vectors: [],
      fallbackReason: 'Local embedding provider is not configured.',
    });
    getCapabilityBundleMock.mockResolvedValue({
      capability: {
        id: 'CAP-MEM',
        name: 'Memory Capability',
        description: 'Tracks memory refresh behavior.',
        domain: '',
        businessUnit: '',
        ownerTeam: '',
        teamNames: [],
        databaseConfigs: [],
        gitRepositories: [],
        executionConfig: {
          defaultWorkspacePath: '',
          allowedWorkspacePaths: [],
        },
        localDirectories: [],
        documentationNotes: '',
        stakeholders: [],
      },
      workspace: {
        artifacts: [
          {
            id: 'ART-1',
            name: 'Operator note',
            artifactKind: 'INPUT_NOTE',
            workItemId: 'WI-1',
            phase: 'ANALYSIS',
            traceId: null,
            contentText: 'Confirm whether operator names are case insensitive.',
            summary: '',
            description: '',
            sourceRunId: null,
            runId: null,
            sourceRunStepId: null,
            runStepId: null,
            handoffFromAgentId: null,
            handoffToAgentId: null,
          },
        ],
        workItems: [
          {
            id: 'WI-1',
            title: 'Implement operator',
            description: 'Need endsWith support.',
            phase: 'ANALYSIS',
            status: 'ACTIVE',
            history: [],
          },
        ],
        messages: [],
        agents: [],
      },
    } as any);
    queryMock.mockResolvedValue({ rows: [] } as any);

    await refreshCapabilityMemory('CAP-MEM', { requeueAgents: false });

    const memoryWarnings = warnSpy.mock.calls
      .map(call => String(call[0] || ''))
      .filter(message => message.startsWith('[memory]'));

    expect(memoryWarnings).toHaveLength(1);
    expect(memoryWarnings[0]).toContain('CAP-MEM: 3/3 memory documents used deterministic hash embeddings');
    expect(memoryWarnings[0]).toContain('CAPABILITY_METADATA: 1, HUMAN_INTERACTION: 1, WORK_ITEM: 1');

    warnSpy.mockRestore();
  });

  it('falls back to deterministic hash when the embedding provider is unavailable', async () => {
    requestLocalOpenAIEmbeddingsMock.mockResolvedValue({
      providerKey: 'deterministic-hash',
      model: 'deterministic-hash-v2',
      vectors: [],
    });
    queryMock.mockResolvedValue({
      rows: [buildSearchRow({ documentId: 'DOC-1', title: 'Alpha Doc', content: 'alpha beta', embedding: [1, 0, 0, 0] })],
    } as any);

    const results = await searchCapabilityMemory({
      capabilityId: 'CAP-MEM',
      queryText: 'alpha',
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.embeddingProviderKey).toBe('deterministic-hash');
    expect(results[0]?.reference.retrievalMethod).toBe('BLENDED');
  });

  it('falls back to deterministic hash when the provider returns the wrong vector count', async () => {
    requestLocalOpenAIEmbeddingsMock.mockResolvedValue({
      providerKey: 'local-openai',
      model: 'text-embedding-3-small',
      vectors: [],
    });
    queryMock.mockResolvedValue({
      rows: [buildSearchRow({ documentId: 'DOC-2', title: 'Beta Doc', content: 'beta gamma', embedding: [0, 1, 0, 0] })],
    } as any);

    const results = await searchCapabilityMemory({
      capabilityId: 'CAP-MEM',
      queryText: 'beta',
      limit: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.embeddingProviderKey).toBe('deterministic-hash');
    expect(results[0]?.vectorModel).toBe('stored-vector-model');
  });

  it('ranks corpus entries by cosine similarity using the shared retrieval pipeline', async () => {
    requestLocalOpenAIEmbeddingsMock
      .mockResolvedValueOnce({
        providerKey: 'local-openai',
        model: 'text-embedding-3-small',
        vectors: [[1, 0]],
      })
      .mockResolvedValueOnce({
        providerKey: 'local-openai',
        model: 'text-embedding-3-small',
        vectors: [
          [0.9, 0.1],
          [0.1, 0.9],
        ],
      });

    const ranked = await rankMemoryCorpusByQuery({
      corpus: buildCorpus(),
      queryText: 'alpha-query',
    });

    expect(ranked.map(item => item.document.id)).toEqual(['DOC-1', 'DOC-2']);
  });

  it('keeps lexical overlap secondary to vector similarity', async () => {
    requestLocalOpenAIEmbeddingsMock
      .mockResolvedValueOnce({
        providerKey: 'local-openai',
        model: 'text-embedding-3-small',
        vectors: [[1, 0]],
      })
      .mockResolvedValueOnce({
        providerKey: 'local-openai',
        model: 'text-embedding-3-small',
        vectors: [
          [0, 1],
          [1, 0],
        ],
      });

    const ranked = await rankMemoryCorpusByQuery({
      corpus: [
        {
          ...buildCorpus()[0],
          combinedContent: 'needle appears once',
          document: {
            ...buildCorpus()[0].document,
            title: 'Needle Memo',
            contentPreview: 'needle appears once',
          },
        },
        {
          ...buildCorpus()[1],
          combinedContent: 'completely unrelated wording',
          document: {
            ...buildCorpus()[1].document,
            title: 'Semantic Match',
            contentPreview: 'completely unrelated wording',
          },
        },
      ],
      queryText: 'needle',
    });

    expect(ranked[0]?.document.title).toBe('Semantic Match');
  });

  it('builds memory context from the same scored retrieval results', async () => {
    requestLocalOpenAIEmbeddingsMock.mockResolvedValue({
      providerKey: 'local-openai',
      model: 'text-embedding-3-small',
      vectors: [[1, 0, 0, 0]],
    });
    queryMock.mockResolvedValue({
      rows: [
        buildSearchRow({
          documentId: 'DOC-3',
          title: 'Gamma Guide',
          content: 'gamma instructions',
          embedding: [1, 0, 0, 0],
          sourceType: 'ARTIFACT',
        }),
      ],
    } as any);

    const context = await buildMemoryContext({
      capabilityId: 'CAP-MEM',
      queryText: 'gamma',
      limit: 3,
    });

    expect(context.results).toHaveLength(1);
    expect(context.results[0]?.reference.semanticScore).toBeGreaterThan(0);
    expect(context.results[0]?.reference.rerankScore).toBeGreaterThan(0);
    expect(context.prompt).toContain('[Memory 1] Gamma Guide');
    expect(context.prompt).toContain('gamma instructions');
  });
});
