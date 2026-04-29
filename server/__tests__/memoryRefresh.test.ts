// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  poolQueryMock,
  transactionMock,
  clientQueryMock,
  getCapabilityBundleMock,
  queueAgentLearningJobMock,
  requestLocalOpenAIEmbeddingsMock,
  getWorkspaceFileIndexMock,
} = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  transactionMock: vi.fn(),
  clientQueryMock: vi.fn(),
  getCapabilityBundleMock: vi.fn(),
  queueAgentLearningJobMock: vi.fn(),
  requestLocalOpenAIEmbeddingsMock: vi.fn(),
  getWorkspaceFileIndexMock: vi.fn(),
}));

vi.mock('../db', () => ({
  getPlatformFeatureState: () => ({
    pgvectorAvailable: false,
    memoryEmbeddingDimensions: 4,
  }),
  getMemoryRetrievalDiagnostics: () => ({
    retrievalMode: 'deterministic-hash',
    embeddingConfigured: false,
    embeddingProviderKey: 'deterministic-hash',
    fallbackReason: 'Local embedding provider is not configured.',
  }),
  query: poolQueryMock,
  transaction: transactionMock,
}));

vi.mock('../repository', () => ({
  getCapabilityBundle: getCapabilityBundleMock,
}));

vi.mock('../agentLearning/repository', () => ({
  getAgentLearningProfile: vi.fn().mockResolvedValue({
    capabilityId: 'CAP-REFRESH',
    agentId: 'AG-1',
    profile: {
      status: 'READY',
      summary: '',
      highlights: [],
      contextBlock: '',
      sourceDocumentIds: [],
      sourceArtifactIds: [],
      sourceCount: 0,
    },
  }),
  queueAgentLearningJob: queueAgentLearningJobMock,
}));

vi.mock('../execution/runtimeClient', () => ({
  executionRuntimeRpc: vi.fn(),
  isRemoteExecutionClient: () => false,
}));

vi.mock('../localOpenAIProvider', () => ({
  requestLocalOpenAIEmbeddings: requestLocalOpenAIEmbeddingsMock,
}));

vi.mock('../workspaceIndex', () => ({
  getWorkspaceFileIndex: getWorkspaceFileIndexMock,
}));

import { refreshCapabilityMemory } from '../memory';

const buildBundle = () => ({
  capability: {
    id: 'CAP-REFRESH',
    name: 'Memory Capability',
    description: 'Refresh this capability memory corpus.',
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
    artifacts: [],
    workItems: [],
    messages: [],
    agents: [],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(async callback =>
    callback({
      query: clientQueryMock,
    }),
  );
  clientQueryMock.mockImplementation(async () => ({ rows: [], rowCount: 1 }));
  getCapabilityBundleMock.mockResolvedValue(buildBundle() as any);
  queueAgentLearningJobMock.mockResolvedValue(undefined);
  requestLocalOpenAIEmbeddingsMock.mockImplementation(async ({ texts }: { texts: string[] }) => ({
    providerKey: 'local-openai',
    model: 'text-embedding-3-small',
    vectors: texts.map(() => [1, 0, 0, 0]),
  }));
  getWorkspaceFileIndexMock.mockResolvedValue([]);
  poolQueryMock.mockResolvedValue({
    rows: [],
  });
});

describe('memory refresh transactionality', () => {
  it('writes managed memory rows through the transaction client and only reads via pool after commit', async () => {
    await refreshCapabilityMemory('CAP-REFRESH', {
      requeueAgents: false,
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(clientQueryMock).toHaveBeenCalled();
    expect(
      clientQueryMock.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO capability_memory_documents'),
      ),
    ).toBe(true);
    expect(
      clientQueryMock.mock.calls.some(([sql]) =>
        String(sql).includes('DELETE FROM capability_memory_documents'),
      ),
    ).toBe(true);
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
    expect(String(poolQueryMock.mock.calls[0]?.[0] || '')).toContain(
      'FROM capability_memory_documents',
    );
    expect(queueAgentLearningJobMock).not.toHaveBeenCalled();
  });

  it('aborts before the final read when a transactional write fails', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO capability_memory_chunks')) {
        throw new Error('chunk insert failed');
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(
      refreshCapabilityMemory('CAP-REFRESH', {
        requeueAgents: false,
      }),
    ).rejects.toThrow('chunk insert failed');

    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(
      clientQueryMock.mock.calls.some(([sql]) =>
        String(sql).includes('DELETE FROM capability_memory_documents'),
      ),
    ).toBe(false);
  });

  it('requeues only the owner agent after a capability-wide refresh', async () => {
    getCapabilityBundleMock.mockResolvedValue({
      ...buildBundle(),
      workspace: {
        ...buildBundle().workspace,
        agents: [
          { id: 'AGENT-OWNER', name: 'Owner', role: 'Owner', isOwner: true },
          { id: 'AGENT-DEV', name: 'Developer', role: 'Developer' },
        ],
      },
    } as any);

    await refreshCapabilityMemory('CAP-REFRESH', {
      requeueAgents: true,
      requestReason: 'manual-memory-refresh',
    });

    expect(queueAgentLearningJobMock).toHaveBeenCalledTimes(1);
    expect(queueAgentLearningJobMock).toHaveBeenCalledWith({
      capabilityId: 'CAP-REFRESH',
      agentId: 'AGENT-OWNER',
      requestReason: 'manual-memory-refresh',
      makeStale: true,
    });
  });
});
