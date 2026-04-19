// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice D — failure observability + race-hardening tests.
 *
 * What these exercise:
 *   1. `buildAgentLearningLockKey` shape is stable across callers (the
 *      advisory-lock key lives on both the service and the repository side,
 *      so drift here would silently disable serialization).
 *   2. `withAgentLearningLock` acquires + runs `work`, retries on
 *      contention, and throws an AGENT_LEARNING_LOCK_TIMEOUT when the lock
 *      is never available. The lockWaitMs telemetry is non-negative.
 *   3. `appendLearningUpdateRecord` uses the append-only INSERT ... ON
 *      CONFLICT DO NOTHING path (the race window that motivated the lock).
 *   4. `recordPipelineError` writes a PIPELINE_ERROR audit row AND emits a
 *      `learning.pipeline_errors_count` metric sample. Both paths swallow
 *      their own failure so the caller never sees an audit write break the
 *      primary operation.
 *
 * We stick to the same pg-mocking pattern the other agentLearning test
 * files use (query + transaction in-memory fake) so any schema drift shows
 * up as a missing SQL-matcher failure, not a silent pass.
 */

type MockRow = Record<string, any>;
type MockQueryResult = { rows: MockRow[]; rowCount: number };
type MockQueryImpl = (sql: string, params?: unknown[]) => Promise<MockQueryResult>;

const makeQueryMock = () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const handlers: Array<{
    match: (sql: string) => boolean;
    respond: (params?: unknown[]) => MockQueryResult | Promise<MockQueryResult>;
  }> = [];
  const impl: MockQueryImpl = async (sql, params) => {
    calls.push({ sql, params });
    const handler = handlers.find(h => h.match(sql));
    if (!handler) return { rows: [], rowCount: 0 };
    return handler.respond(params);
  };
  return {
    impl,
    calls,
    on(
      match: (sql: string) => boolean,
      respond: (params?: unknown[]) => MockQueryResult | Promise<MockQueryResult>,
    ) {
      handlers.push({ match, respond });
    },
  };
};

let queryMock: ReturnType<typeof makeQueryMock>;

vi.mock('../db', () => ({
  query: (sql: string, params?: unknown[]) => queryMock.impl(sql, params),
  transaction: async <T>(fn: (client: { query: MockQueryImpl }) => Promise<T>): Promise<T> =>
    fn({ query: queryMock.impl }),
  withClient: async <T>(fn: (client: { query: MockQueryImpl }) => Promise<T>): Promise<T> =>
    fn({ query: queryMock.impl }),
}));

// Service-module upstream deps — the pipeline-error + lock tests don't hit
// these, but `../agentLearning/service` imports them at module-load time.
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

// ──────────────────────────────────────────────────────────────────────────
// buildAgentLearningLockKey — deterministic, namespaced
// ──────────────────────────────────────────────────────────────────────────

describe('buildAgentLearningLockKey', () => {
  it('returns a deterministic, namespaced string keyed on (capability, agent)', async () => {
    const { buildAgentLearningLockKey } = await import('../agentLearning/repository');
    expect(buildAgentLearningLockKey('CAP-1', 'AGENT-1')).toBe('agent-learning:CAP-1|AGENT-1');
    // Stable across calls.
    expect(buildAgentLearningLockKey('CAP-2', 'AGENT-Z')).toBe(
      buildAgentLearningLockKey('CAP-2', 'AGENT-Z'),
    );
    // Different pairs produce different keys.
    expect(buildAgentLearningLockKey('CAP-1', 'AGENT-1')).not.toBe(
      buildAgentLearningLockKey('CAP-1', 'AGENT-2'),
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// withAgentLearningLock — acquire, retry, timeout
// ──────────────────────────────────────────────────────────────────────────

describe('withAgentLearningLock', () => {
  it('acquires the lock, runs work inside the transaction, and returns lockWaitMs', async () => {
    queryMock.on(
      sql => sql.includes('pg_try_advisory_xact_lock'),
      () => ({ rows: [{ locked: true }], rowCount: 1 }),
    );

    const { withAgentLearningLock } = await import('../agentLearning/repository');

    const workSpy = vi.fn(async () => 'work-return-value');
    const result = await withAgentLearningLock(
      { capabilityId: 'CAP-1', agentId: 'AGENT-1', attempts: 3, delayMs: 5 },
      workSpy,
    );

    expect(workSpy).toHaveBeenCalledTimes(1);
    expect(result.value).toBe('work-return-value');
    expect(result.lockWaitMs).toBeGreaterThanOrEqual(0);
    // The try-lock query fired with the built lock key.
    const tryCall = queryMock.calls.find(c => c.sql.includes('pg_try_advisory_xact_lock'));
    expect(tryCall?.params?.[0]).toBe('agent-learning:CAP-1|AGENT-1');
  });

  it('retries on contention and still acquires within the attempt budget', async () => {
    let tries = 0;
    queryMock.on(
      sql => sql.includes('pg_try_advisory_xact_lock'),
      () => {
        tries += 1;
        // First two tries fail (lock held by an imagined concurrent writer),
        // third succeeds.
        return { rows: [{ locked: tries >= 3 }], rowCount: 1 };
      },
    );

    const { withAgentLearningLock } = await import('../agentLearning/repository');
    const workSpy = vi.fn(async () => 42);
    const result = await withAgentLearningLock(
      { capabilityId: 'CAP-1', agentId: 'AGENT-X', attempts: 5, delayMs: 2 },
      workSpy,
    );

    expect(tries).toBe(3);
    expect(workSpy).toHaveBeenCalledTimes(1);
    expect(result.value).toBe(42);
  });

  it('throws AGENT_LEARNING_LOCK_TIMEOUT when the lock is never available', async () => {
    queryMock.on(
      sql => sql.includes('pg_try_advisory_xact_lock'),
      () => ({ rows: [{ locked: false }], rowCount: 1 }),
    );

    const { withAgentLearningLock } = await import('../agentLearning/repository');
    const workSpy = vi.fn(async () => 'never-runs');

    await expect(
      withAgentLearningLock(
        { capabilityId: 'CAP-1', agentId: 'AGENT-HOT', attempts: 2, delayMs: 2 },
        workSpy,
      ),
    ).rejects.toMatchObject({ code: 'AGENT_LEARNING_LOCK_TIMEOUT' });

    expect(workSpy).not.toHaveBeenCalled();
  });

  it('does not run `work` in a session that failed the try-lock', async () => {
    // Alternating pattern: fail, succeed, fail. We only allow 1 attempt so
    // the first "fail" must surface as a timeout and `work` never runs even
    // though later responses would be "succeed".
    const sequence = [false, true, false];
    let idx = 0;
    queryMock.on(
      sql => sql.includes('pg_try_advisory_xact_lock'),
      () => ({
        rows: [{ locked: sequence[idx++ % sequence.length] }],
        rowCount: 1,
      }),
    );

    const { withAgentLearningLock } = await import('../agentLearning/repository');
    const workSpy = vi.fn(async () => 'not-allowed');
    await expect(
      withAgentLearningLock(
        { capabilityId: 'CAP-1', agentId: 'AGENT-A', attempts: 1, delayMs: 1 },
        workSpy,
      ),
    ).rejects.toMatchObject({ code: 'AGENT_LEARNING_LOCK_TIMEOUT' });
    expect(workSpy).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// appendLearningUpdateRecord — append-only INSERT with ON CONFLICT DO NOTHING
// ──────────────────────────────────────────────────────────────────────────

describe('appendLearningUpdateRecord', () => {
  it('inserts a single row via ON CONFLICT DO NOTHING and returns the id it wrote', async () => {
    queryMock.on(
      sql => sql.includes('INSERT INTO capability_learning_updates'),
      () => ({ rows: [], rowCount: 1 }),
    );

    const { appendLearningUpdateRecord } = await import('../agentLearning/repository');
    const result = await appendLearningUpdateRecord({
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      id: 'LEARN-FIXED-1',
      insight: 'Pipeline error in memory-refresh: boom',
      triggerType: 'PIPELINE_ERROR',
      timestamp: '2026-04-19T12:00:00Z',
      sourceLogIds: [],
      relatedWorkItemId: 'WI-9',
      relatedRunId: 'RUN-3',
    });

    expect(result).toEqual({ id: 'LEARN-FIXED-1' });

    const insert = queryMock.calls.find(
      c => c.sql.includes('INSERT INTO capability_learning_updates'),
    );
    expect(insert).toBeDefined();
    // The append-only contract — race-safe against concurrent writers of
    // other rows for the same capability. If this matcher ever fails it's a
    // sign someone reverted to the legacy DELETE + bulk-INSERT path.
    expect(insert?.sql).toContain('ON CONFLICT (capability_id, id) DO NOTHING');

    expect(insert?.params?.[0]).toBe('CAP-1');
    expect(insert?.params?.[1]).toBe('LEARN-FIXED-1');
    expect(insert?.params?.[2]).toBe('AGENT-1');
    expect(insert?.params?.[3]).toEqual([]);
    expect(insert?.params?.[4]).toBe('Pipeline error in memory-refresh: boom');
    expect(insert?.params?.[5]).toBeNull(); // skillUpdate
    expect(insert?.params?.[6]).toBe('2026-04-19T12:00:00Z');
    expect(insert?.params?.[7]).toBe('PIPELINE_ERROR');
    expect(insert?.params?.[8]).toBe('WI-9');
    expect(insert?.params?.[9]).toBe('RUN-3');
  });

  it('auto-generates an id and a timestamp when not provided', async () => {
    queryMock.on(
      sql => sql.includes('INSERT INTO capability_learning_updates'),
      () => ({ rows: [], rowCount: 1 }),
    );

    const { appendLearningUpdateRecord } = await import('../agentLearning/repository');
    const result = await appendLearningUpdateRecord({
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      insight: 'heartbeat',
      triggerType: 'PIPELINE_ERROR',
    });

    expect(result.id).toMatch(/^LEARN-/);
    const insert = queryMock.calls.find(
      c => c.sql.includes('INSERT INTO capability_learning_updates'),
    );
    // Timestamp was defaulted to an ISO string.
    expect(typeof insert?.params?.[6]).toBe('string');
    expect(insert?.params?.[6]).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// recordPipelineError — audit row + metric sample, never throws
// ──────────────────────────────────────────────────────────────────────────

describe('recordPipelineError', () => {
  it('writes a PIPELINE_ERROR audit row AND emits a learning.pipeline_errors_count metric', async () => {
    queryMock.on(
      sql => sql.includes('INSERT INTO capability_learning_updates'),
      () => ({ rows: [], rowCount: 1 }),
    );
    queryMock.on(
      sql => sql.includes('INSERT INTO capability_metric_samples'),
      () => ({
        rows: [
          {
            capability_id: 'CAP-1',
            id: 'METRIC-1',
            scope_type: 'AGENT',
            scope_id: 'AGENT-1',
            metric_name: 'learning.pipeline_errors_count',
            metric_value: 1,
            unit: 'count',
            tags: {},
            recorded_at: '2026-04-19T12:00:00Z',
          },
        ],
        rowCount: 1,
      }),
    );

    const { recordPipelineError } = await import('../agentLearning/service');
    const boom = Object.assign(new Error('memory pool exhausted'), { code: 'ERESOURCE' });

    // Silence the console.error emitted for the SLO backstop log so the
    // test output stays readable.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await recordPipelineError({
      capabilityId: 'CAP-1',
      agentId: 'AGENT-1',
      stage: 'memory-refresh',
      error: boom,
      workItemId: 'WI-42',
      runId: 'RUN-99',
    });

    errSpy.mockRestore();

    const auditInsert = queryMock.calls.find(
      c => c.sql.includes('INSERT INTO capability_learning_updates'),
    );
    expect(auditInsert).toBeDefined();
    // trigger_type parameter is at position 7.
    expect(auditInsert?.params?.[7]).toBe('PIPELINE_ERROR');
    // insight describes the stage + error message + code suffix.
    expect(String(auditInsert?.params?.[4])).toContain('Pipeline error in memory-refresh');
    expect(String(auditInsert?.params?.[4])).toContain('memory pool exhausted');
    expect(String(auditInsert?.params?.[4])).toContain('[ERESOURCE]');
    // related_work_item_id + related_run_id thread through.
    expect(auditInsert?.params?.[8]).toBe('WI-42');
    expect(auditInsert?.params?.[9]).toBe('RUN-99');

    const metricInsert = queryMock.calls.find(
      c => c.sql.includes('INSERT INTO capability_metric_samples'),
    );
    expect(metricInsert).toBeDefined();
    // metric_name param is at index 5 in the INSERT.
    expect(metricInsert?.params?.[5]).toBe('learning.pipeline_errors_count');
    expect(metricInsert?.params?.[6]).toBe(1);
    expect(metricInsert?.params?.[7]).toBe('count');
    // Tags carry stage + code for dashboard filtering.
    expect(metricInsert?.params?.[8]).toEqual({
      stage: 'memory-refresh',
      code: 'ERESOURCE',
    });
  });

  it('skips the audit row when no agentId is in scope but still emits a metric', async () => {
    queryMock.on(
      sql => sql.includes('INSERT INTO capability_metric_samples'),
      () => ({ rows: [{}], rowCount: 1 }),
    );

    const { recordPipelineError } = await import('../agentLearning/service');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await recordPipelineError({
      capabilityId: 'CAP-1',
      stage: 'lease-release',
      error: new Error('pool closed'),
    });

    errSpy.mockRestore();

    // No audit INSERT fired — agent-less errors are logged + metric-only.
    const auditInsert = queryMock.calls.find(c =>
      c.sql.includes('INSERT INTO capability_learning_updates'),
    );
    expect(auditInsert).toBeUndefined();

    const metricInsert = queryMock.calls.find(c =>
      c.sql.includes('INSERT INTO capability_metric_samples'),
    );
    expect(metricInsert).toBeDefined();
    expect(metricInsert?.params?.[5]).toBe('learning.pipeline_errors_count');
    // scope_id falls back to '-' when there's no agentId.
    expect(metricInsert?.params?.[4]).toBe('-');
  });

  it('never throws even when both the audit write and metric emission fail', async () => {
    // Both INSERTs throw; recordPipelineError should still resolve cleanly.
    queryMock.on(
      sql => sql.includes('INSERT INTO capability_learning_updates'),
      () => {
        throw new Error('audit db down');
      },
    );
    queryMock.on(
      sql => sql.includes('INSERT INTO capability_metric_samples'),
      () => {
        throw new Error('metric db down');
      },
    );

    const { recordPipelineError } = await import('../agentLearning/service');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      recordPipelineError({
        capabilityId: 'CAP-1',
        agentId: 'AGENT-1',
        stage: 'judge-evaluation',
        error: new Error('llm 500'),
      }),
    ).resolves.toBeUndefined();

    // We logged both failures to stderr (the SLO backstop).
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
