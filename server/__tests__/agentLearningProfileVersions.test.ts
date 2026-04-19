// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice A — profile versioning tests. The repository depends on pg, so we
 * mock `server/db` wholesale to route every `query` / `transaction` call
 * through an in-memory fake. This lets us assert:
 *   1. commitAgentLearningProfileVersion inserts a version row AND flips the
 *      live pointer inside a single transaction.
 *   2. activateAgentLearningProfileVersion flips the pointer back to a prior
 *      version without creating a new row.
 *   3. listAgentLearningProfileVersions returns rows newest-first.
 *   4. getAgentLearningProfileVersionDiff produces a structured delta that
 *      the UI can render without a full text-diff engine.
 */

type MockRow = Record<string, any>;
type MockQueryResult = { rows: MockRow[]; rowCount: number };
type MockQueryImpl = (sql: string, params?: unknown[]) => Promise<MockQueryResult>;

const makeQueryMock = () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const handlers: Array<{
    match: (sql: string) => boolean;
    respond: (params?: unknown[]) => MockQueryResult;
  }> = [];

  const impl: MockQueryImpl = async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const handler = handlers.find(h => h.match(sql));
    if (!handler) {
      // Default: return an empty result so ensureAgentLearningProfileTx /
      // UPDATEs that don't need rows can no-op.
      return { rows: [], rowCount: 0 };
    }
    return handler.respond(params);
  };

  return {
    impl,
    calls,
    on(match: (sql: string) => boolean, respond: (params?: unknown[]) => MockQueryResult) {
      handlers.push({ match, respond });
    },
  };
};

let queryMock: ReturnType<typeof makeQueryMock>;

vi.mock('../db', () => {
  return {
    query: (sql: string, params?: unknown[]) => queryMock.impl(sql, params),
    transaction: async <T>(fn: (client: { query: MockQueryImpl }) => Promise<T>): Promise<T> => {
      return fn({ query: queryMock.impl });
    },
    withClient: async <T>(fn: (client: { query: MockQueryImpl }) => Promise<T>): Promise<T> => {
      return fn({ query: queryMock.impl });
    },
  };
});

// Service-module upstream deps — the profile-versioning code path does NOT
// touch these, but importing `../agentLearning/service` pulls them in at
// module-load time, so we mock them to keep the test hermetic.
vi.mock('../githubModels', () => ({ requestGitHubModel: vi.fn() }));
vi.mock('../memory', () => ({
  getCapabilityMemoryCorpus: vi.fn(),
  listMemoryDocuments: vi.fn(),
  rankMemoryCorpusByQuery: vi.fn(),
  refreshCapabilityMemory: vi.fn(),
}));
vi.mock('../repository', () => ({
  addCapabilitySkillRecord: vi.fn(),
  getCapabilityBundle: vi.fn(),
  replaceCapabilityWorkspaceContentRecord: vi.fn(),
  updateCapabilityAgentRecord: vi.fn(),
}));
vi.mock('../execution/runtimeClient', () => ({
  executionRuntimeRpc: vi.fn(),
  isRemoteExecutionClient: () => false,
}));
vi.mock('../execution/repository', () => ({
  getWorkflowRunDetail: vi.fn(),
  listWorkflowRunEvents: vi.fn(),
}));

beforeEach(() => {
  queryMock = makeQueryMock();
  vi.clearAllMocks();
});

describe('commitAgentLearningProfileVersion', () => {
  it('writes an immutable version row then flips the live pointer in one transaction', async () => {
    // Arrange — the profile row has no prior pointer; this is the first
    // version being committed. nextProfileVersionNoTx sees max_version=0 so
    // the new version should land as version_no=1.
    queryMock.on(
      sql =>
        sql.includes('SELECT *\n        FROM capability_agent_learning_profiles'),
      () => ({ rows: [{ current_version_id: null }], rowCount: 1 }),
    );
    queryMock.on(
      sql => sql.includes('SELECT COALESCE(MAX(version_no)'),
      () => ({ rows: [{ max_version: 0 }], rowCount: 1 }),
    );
    queryMock.on(
      sql => sql.includes('INSERT INTO capability_agent_learning_profile_versions'),
      (params) => ({
        rows: [
          {
            capability_id: params?.[0],
            version_id: params?.[1],
            agent_id: params?.[2],
            version_no: params?.[3],
            status: params?.[4],
            summary: params?.[5],
            highlights: JSON.parse(String(params?.[6] ?? '[]')),
            context_block: params?.[7],
            source_document_ids: params?.[8],
            source_artifact_ids: params?.[9],
            source_count: params?.[10],
            context_block_tokens: params?.[11],
            judge_score: params?.[12],
            judge_report: params?.[13],
            shape_report: params?.[14],
            created_by_update_id: params?.[15],
            notes: params?.[16],
            created_at: new Date('2026-04-19T10:00:00Z'),
          },
        ],
        rowCount: 1,
      }),
    );
    queryMock.on(
      sql => sql.includes('UPDATE capability_agent_learning_profiles'),
      (params) => ({
        rows: [
          {
            capability_id: params?.[0],
            agent_id: params?.[1],
            status: params?.[2],
            summary: params?.[3],
            highlights: JSON.parse(String(params?.[4] ?? '[]')),
            context_block: params?.[5],
            source_document_ids: params?.[6],
            source_artifact_ids: params?.[7],
            source_count: params?.[8],
            refreshed_at: params?.[9],
            last_requested_at: params?.[10],
            last_error: params?.[11],
            previous_version_id: params?.[12],
            current_version_id: params?.[13],
          },
        ],
        rowCount: 1,
      }),
    );

    const { commitAgentLearningProfileVersion } = await import('../agentLearning/repository');

    // Act
    const result = await commitAgentLearningProfileVersion({
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      profile: {
        status: 'READY',
        summary: 'v1 summary',
        highlights: ['h1', 'h2'],
        contextBlock: 'ctx v1',
        sourceDocumentIds: ['DOC-1'],
        sourceArtifactIds: ['ART-1'],
        sourceCount: 1,
        refreshedAt: '2026-04-19T10:00:00Z',
      },
      notes: 'manual-agent-refresh',
    });

    // Assert — version_no=1 (first version), pointer now references the new
    // version id, no previous pointer (first ever write).
    expect(result.version.versionNo).toBe(1);
    expect(result.version.status).toBe('READY');
    expect(result.profile.currentVersionId).toBe(result.version.versionId);
    expect(result.profile.previousVersionId).toBeUndefined();

    // The insert + pointer flip happen in the same mocked transaction —
    // no concurrent writer can observe a half-applied state.
    const insertIdx = queryMock.calls.findIndex(call =>
      call.sql.includes('INSERT INTO capability_agent_learning_profile_versions'),
    );
    const pointerIdx = queryMock.calls.findIndex(call =>
      call.sql.includes('UPDATE capability_agent_learning_profiles'),
    );
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(pointerIdx).toBeGreaterThan(insertIdx);
  });

  it('preserves the prior pointer as previous_version_id on subsequent commits', async () => {
    // Arrange — pretend a prior version already exists. The commit should
    // capture that pointer into previous_version_id so operator revert +
    // Slice C drift detection have a clean baseline.
    queryMock.on(
      sql =>
        sql.includes('SELECT *\n        FROM capability_agent_learning_profiles'),
      () => ({ rows: [{ current_version_id: 'PROFVER-OLD' }], rowCount: 1 }),
    );
    queryMock.on(
      sql => sql.includes('SELECT COALESCE(MAX(version_no)'),
      () => ({ rows: [{ max_version: 4 }], rowCount: 1 }),
    );
    queryMock.on(
      sql => sql.includes('INSERT INTO capability_agent_learning_profile_versions'),
      (params) => ({
        rows: [
          {
            capability_id: params?.[0],
            version_id: params?.[1],
            agent_id: params?.[2],
            version_no: params?.[3],
            status: params?.[4],
            summary: params?.[5],
            highlights: JSON.parse(String(params?.[6] ?? '[]')),
            context_block: params?.[7],
            source_document_ids: params?.[8],
            source_artifact_ids: params?.[9],
            source_count: params?.[10],
            created_at: new Date(),
          },
        ],
        rowCount: 1,
      }),
    );
    queryMock.on(
      sql => sql.includes('UPDATE capability_agent_learning_profiles'),
      (params) => ({
        rows: [
          {
            capability_id: params?.[0],
            agent_id: params?.[1],
            status: params?.[2],
            summary: params?.[3],
            highlights: JSON.parse(String(params?.[4] ?? '[]')),
            context_block: params?.[5],
            source_document_ids: params?.[6],
            source_artifact_ids: params?.[7],
            source_count: params?.[8],
            previous_version_id: params?.[12],
            current_version_id: params?.[13],
          },
        ],
        rowCount: 1,
      }),
    );

    const { commitAgentLearningProfileVersion } = await import('../agentLearning/repository');

    const result = await commitAgentLearningProfileVersion({
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      profile: {
        status: 'READY',
        summary: 'v5 summary',
        highlights: [],
        contextBlock: '',
        sourceDocumentIds: [],
        sourceArtifactIds: [],
        sourceCount: 0,
      },
    });

    expect(result.version.versionNo).toBe(5);
    expect(result.profile.previousVersionId).toBe('PROFVER-OLD');
    expect(result.profile.currentVersionId).toBe(result.version.versionId);
  });
});

describe('activateAgentLearningProfileVersion', () => {
  it('flips the pointer to a prior version without creating a new version row', async () => {
    // Arrange — the version we want to revert to exists and is READY.
    queryMock.on(
      sql => sql.includes('FROM capability_agent_learning_profile_versions')
        && sql.includes('version_id = $3'),
      () => ({
        rows: [
          {
            capability_id: 'CAP-1',
            version_id: 'PROFVER-OLD',
            agent_id: 'AGENT-1',
            version_no: 3,
            status: 'READY',
            summary: 'old summary',
            highlights: ['old-h1'],
            context_block: 'old ctx',
            source_document_ids: ['DOC-A'],
            source_artifact_ids: [],
            source_count: 1,
            created_at: new Date(),
          },
        ],
        rowCount: 1,
      }),
    );
    queryMock.on(
      sql =>
        sql.includes('SELECT *\n        FROM capability_agent_learning_profiles'),
      () => ({
        rows: [
          {
            current_version_id: 'PROFVER-CURRENT',
            canary_request_count: 0,
            canary_negative_count: 0,
          },
        ],
        rowCount: 1,
      }),
    );
    queryMock.on(
      sql => sql.includes('UPDATE capability_agent_learning_profiles'),
      (params) => ({
        rows: [
          {
            capability_id: params?.[0],
            agent_id: params?.[1],
            status: params?.[2],
            summary: params?.[3],
            highlights: JSON.parse(String(params?.[4] ?? '[]')),
            context_block: params?.[5],
            source_document_ids: params?.[6],
            source_artifact_ids: params?.[7],
            source_count: params?.[8],
            previous_version_id: params?.[9],
            current_version_id: params?.[10],
          },
        ],
        rowCount: 1,
      }),
    );

    const { activateAgentLearningProfileVersion } = await import(
      '../agentLearning/repository'
    );

    // Act
    const result = await activateAgentLearningProfileVersion({
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      versionId: 'PROFVER-OLD',
    });

    // Assert — pointer moved back to PROFVER-OLD, previous_version_id
    // captures the version that was live before the revert.
    expect(result.profile.currentVersionId).toBe('PROFVER-OLD');
    expect(result.profile.previousVersionId).toBe('PROFVER-CURRENT');

    // Reverts are idempotent — they must NOT append to the version history.
    const insertedVersion = queryMock.calls.find(call =>
      call.sql.includes('INSERT INTO capability_agent_learning_profile_versions'),
    );
    expect(insertedVersion).toBeUndefined();
  });

  it('throws a descriptive error when the requested version is missing', async () => {
    queryMock.on(
      sql => sql.includes('FROM capability_agent_learning_profile_versions')
        && sql.includes('version_id = $3'),
      () => ({ rows: [], rowCount: 0 }),
    );

    const { activateAgentLearningProfileVersion } = await import(
      '../agentLearning/repository'
    );

    await expect(
      activateAgentLearningProfileVersion({
        capabilityId: 'CAP-1',
        agentId: 'AGENT-1',
        versionId: 'PROFVER-MISSING',
      }),
    ).rejects.toThrow(/PROFVER-MISSING/);
  });
});

describe('listAgentLearningProfileVersions', () => {
  it('returns rows newest-first and maps column names to the client shape', async () => {
    queryMock.on(
      sql => sql.includes('FROM capability_agent_learning_profile_versions')
        && sql.includes('ORDER BY version_no DESC'),
      () => ({
        rows: [
          {
            capability_id: 'CAP-1',
            version_id: 'PROFVER-3',
            agent_id: 'AGENT-1',
            version_no: 3,
            status: 'READY',
            summary: 's3',
            highlights: ['h3'],
            context_block: 'ctx3',
            source_document_ids: ['DOC-3'],
            source_artifact_ids: [],
            source_count: 1,
            created_at: new Date('2026-04-19T12:00:00Z'),
          },
          {
            capability_id: 'CAP-1',
            version_id: 'PROFVER-2',
            agent_id: 'AGENT-1',
            version_no: 2,
            status: 'READY',
            summary: 's2',
            highlights: [],
            context_block: '',
            source_document_ids: [],
            source_artifact_ids: [],
            source_count: 0,
            created_at: new Date('2026-04-18T09:00:00Z'),
          },
        ],
        rowCount: 2,
      }),
    );

    const { listAgentLearningProfileVersions } = await import(
      '../agentLearning/repository'
    );

    const versions = await listAgentLearningProfileVersions('CAP-1', 'AGENT-1');

    expect(versions).toHaveLength(2);
    expect(versions[0].versionNo).toBe(3);
    expect(versions[0].summary).toBe('s3');
    expect(versions[1].versionNo).toBe(2);
  });
});

describe('computeAgentLearningProfileVersionDiff', () => {
  it('produces an add/remove delta on highlights + source docs and a token delta', async () => {
    const { computeAgentLearningProfileVersionDiff } = await import(
      '../agentLearning/service'
    );

    const fromVersion = {
      versionId: 'PROFVER-OLD',
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      versionNo: 1,
      status: 'READY' as const,
      summary: 'old summary',
      highlights: ['kept', 'dropped'],
      contextBlock: 'ctx',
      sourceDocumentIds: ['DOC-1', 'DOC-2'],
      sourceArtifactIds: [],
      sourceCount: 2,
      createdAt: '2026-04-18T09:00:00Z',
    };

    const toVersion = {
      versionId: 'PROFVER-NEW',
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      versionNo: 2,
      status: 'READY' as const,
      summary: 'new summary text',
      highlights: ['kept', 'added-1', 'added-2'],
      contextBlock: 'ctx after with more words',
      sourceDocumentIds: ['DOC-1', 'DOC-3'],
      sourceArtifactIds: [],
      sourceCount: 2,
      createdAt: '2026-04-19T10:00:00Z',
    };

    const result = computeAgentLearningProfileVersionDiff(fromVersion, toVersion);

    expect(result.fromVersionId).toBe('PROFVER-OLD');
    expect(result.toVersionId).toBe('PROFVER-NEW');
    expect(result.highlightsAdded.sort()).toEqual(['added-1', 'added-2']);
    expect(result.highlightsRemoved).toEqual(['dropped']);
    expect(result.sourceDocumentsAdded).toEqual(['DOC-3']);
    expect(result.sourceDocumentsRemoved).toEqual(['DOC-2']);
    expect(result.summaryBefore).toBe('old summary');
    expect(result.summaryAfter).toBe('new summary text');
    // Token delta falls back to ceil(len/4) when neither side has measured
    // tokens, so a longer after-context yields a positive delta.
    expect(result.contextBlockTokenDelta).toBeGreaterThan(0);
  });

  it('prefers measured contextBlockTokens over the char-length fallback when available', async () => {
    const { computeAgentLearningProfileVersionDiff } = await import(
      '../agentLearning/service'
    );

    const base = {
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      status: 'READY' as const,
      summary: '',
      highlights: [],
      contextBlock: 'short',
      sourceDocumentIds: [],
      sourceArtifactIds: [],
      sourceCount: 0,
      createdAt: '2026-04-19T10:00:00Z',
    };

    const result = computeAgentLearningProfileVersionDiff(
      { ...base, versionId: 'v1', versionNo: 1, contextBlockTokens: 1500 },
      { ...base, versionId: 'v2', versionNo: 2, contextBlockTokens: 1200 },
    );

    expect(result.contextBlockTokenDelta).toBe(-300);
  });
});
