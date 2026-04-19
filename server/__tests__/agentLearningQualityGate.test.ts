// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice B — quality gate tests.
 *
 * Three focuses:
 *   1. runProfileShapeChecks (pure): every blocking failure we can emit fires
 *      at the right threshold, and benign inputs pass cleanly.
 *   2. commitAgentLearningProfileVersion with flipPointer=false: persists the
 *      candidate under REVIEW_PENDING *without* replacing the live profile's
 *      summary/highlights/context_block. Prior version keeps serving.
 *   3. runJudgeAgainstFixtures: parses scores out of a stubbed LLM response
 *      and yields a sensible aggregate (including graceful per-fixture error
 *      capture).
 */

import {
  DEFAULT_CONTEXT_BLOCK_TOKEN_BUDGET,
  DEFAULT_JUDGE_PASS_THRESHOLD,
  DEFAULT_MIN_HIGHLIGHTS,
  estimateTokenCount,
  isQualityGateEnabled,
  runJudgeAgainstFixtures,
  runProfileShapeChecks,
} from '../agentLearning/qualityGate';
import type { AgentLearningProfile } from '../../src/types';

type MockRow = Record<string, any>;
type MockQueryResult = { rows: MockRow[]; rowCount: number };
type MockQueryImpl = (sql: string, params?: unknown[]) => Promise<MockQueryResult>;

const makeQueryMock = () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const handlers: Array<{
    match: (sql: string) => boolean;
    respond: (params?: unknown[]) => MockQueryResult;
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
    on(match: (sql: string) => boolean, respond: (params?: unknown[]) => MockQueryResult) {
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

beforeEach(() => {
  queryMock = makeQueryMock();
  vi.clearAllMocks();
  delete process.env.LEARNING_QUALITY_GATE_ENABLED;
});

const baseProfile = (overrides: Partial<AgentLearningProfile> = {}): AgentLearningProfile => ({
  status: 'READY',
  summary:
    'This agent consolidates incident postmortems into concise remediation steps for the deployment team.',
  highlights: [
    'Always reference the incident ID in the first line.',
    'Cite the runbook section that was followed.',
    'Flag any step that took longer than 15 minutes.',
  ],
  contextBlock: 'Known remediation patterns for payment outages...',
  sourceDocumentIds: ['doc-1', 'doc-2'],
  sourceArtifactIds: [],
  sourceCount: 2,
  refreshedAt: '2026-04-19T12:00:00Z',
  ...overrides,
});

describe('isQualityGateEnabled', () => {
  it('defaults to enabled when the env flag is unset', () => {
    expect(isQualityGateEnabled()).toBe(true);
  });
  it('respects an explicit off switch', () => {
    process.env.LEARNING_QUALITY_GATE_ENABLED = 'false';
    expect(isQualityGateEnabled()).toBe(false);
    process.env.LEARNING_QUALITY_GATE_ENABLED = 'off';
    expect(isQualityGateEnabled()).toBe(false);
    process.env.LEARNING_QUALITY_GATE_ENABLED = 'true';
    expect(isQualityGateEnabled()).toBe(true);
  });
});

describe('estimateTokenCount', () => {
  it('returns 0 for empty/missing input', () => {
    expect(estimateTokenCount(undefined)).toBe(0);
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('   ')).toBe(0);
  });
  it('scales ~1 token per 4 characters', () => {
    expect(estimateTokenCount('abcd')).toBe(1);
    expect(estimateTokenCount('abcdefgh')).toBe(2);
    // 401 chars → ceil(401/4) = 101
    expect(estimateTokenCount('x'.repeat(401))).toBe(101);
  });
});

describe('runProfileShapeChecks', () => {
  it('passes a well-formed profile', () => {
    const report = runProfileShapeChecks(baseProfile());
    expect(report.passed).toBe(true);
    expect(report.blockingFailures).toEqual([]);
    expect(report.measurements.highlightCount).toBe(3);
    expect(report.thresholds.minHighlights).toBe(DEFAULT_MIN_HIGHLIGHTS);
    expect(report.thresholds.contextBlockTokenBudget).toBe(DEFAULT_CONTEXT_BLOCK_TOKEN_BUDGET);
  });

  it('blocks when the summary is empty', () => {
    const report = runProfileShapeChecks(baseProfile({ summary: '   ' }));
    expect(report.passed).toBe(false);
    expect(report.blockingFailures.map(f => f.code)).toContain('SUMMARY_EMPTY');
  });

  it('blocks when highlights are below the minimum', () => {
    const report = runProfileShapeChecks(baseProfile({ highlights: ['only one'] }));
    expect(report.passed).toBe(false);
    expect(report.blockingFailures.map(f => f.code)).toContain('HIGHLIGHTS_TOO_FEW');
  });

  it('blocks when the context block blows the token budget', () => {
    // Build a context block well over the default 2000-token cap.
    const oversized = 'x'.repeat((DEFAULT_CONTEXT_BLOCK_TOKEN_BUDGET + 50) * 4);
    const report = runProfileShapeChecks(baseProfile({ contextBlock: oversized }));
    expect(report.passed).toBe(false);
    expect(report.blockingFailures.map(f => f.code)).toContain('CONTEXT_BLOCK_TOO_LARGE');
  });

  it('warns (non-blocking) when no sources are cited by default', () => {
    const report = runProfileShapeChecks(
      baseProfile({ sourceDocumentIds: [], sourceCount: 0 }),
    );
    expect(report.passed).toBe(true);
    expect(report.warnings.map(w => w.code)).toContain('SOURCE_COUNT_ZERO');
  });

  it('escalates the source-missing warning to a blocker when requireSources=true', () => {
    const report = runProfileShapeChecks(
      baseProfile({ sourceDocumentIds: [], sourceCount: 0 }),
      { requireSources: true },
    );
    expect(report.passed).toBe(false);
    expect(report.blockingFailures.map(f => f.code)).toContain('SOURCE_COUNT_ZERO');
  });
});

describe('commitAgentLearningProfileVersion — REVIEW_PENDING staging', () => {
  it('persists the candidate version but does NOT flip the live pointer when flipPointer=false', async () => {
    const { commitAgentLearningProfileVersion } = await import('../agentLearning/repository');

    queryMock.on(
      sql => sql.includes('SELECT *\n        FROM capability_agent_learning_profiles'),
      () => ({
        rows: [{ current_version_id: 'PROFVER-EXISTING', previous_version_id: null }],
        rowCount: 1,
      }),
    );
    queryMock.on(
      sql => sql.includes('SELECT COALESCE(MAX(version_no)'),
      () => ({ rows: [{ max_version: 3 }], rowCount: 1 }),
    );
    queryMock.on(
      sql => sql.includes('INSERT INTO capability_agent_learning_profile_versions'),
      params => ({
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
            created_at: new Date('2026-04-19T11:00:00Z'),
          },
        ],
        rowCount: 1,
      }),
    );
    // Minimal "live profile unchanged" UPDATE path.
    queryMock.on(
      sql =>
        sql.includes('UPDATE capability_agent_learning_profiles') &&
        sql.includes('last_requested_at = COALESCE'),
      params => ({
        rows: [
          {
            capability_id: params?.[0],
            agent_id: params?.[1],
            status: 'READY',
            summary: 'previous summary still serving',
            highlights: ['prior a', 'prior b', 'prior c'],
            context_block: 'prior context',
            source_document_ids: ['doc-prior'],
            source_artifact_ids: [],
            source_count: 1,
            refreshed_at: '2026-04-18T00:00:00Z',
            last_requested_at: params?.[2],
            last_error: params?.[3],
            current_version_id: 'PROFVER-EXISTING',
            previous_version_id: null,
          },
        ],
        rowCount: 1,
      }),
    );

    const result = await commitAgentLearningProfileVersion({
      capabilityId: 'cap-1',
      agentId: 'agent-1',
      profile: baseProfile({
        status: 'REVIEW_PENDING',
        summary: '',
        lastError: 'Shape check failed — SUMMARY_EMPTY',
      }),
      flipPointer: false,
      versionStatusOverride: 'REVIEW_PENDING',
      shapeReport: { passed: false },
    });

    // 1. Version row got written with the REVIEW_PENDING status.
    expect(result.version.status).toBe('REVIEW_PENDING');
    expect(result.version.versionNo).toBe(4);

    // 2. Live profile's current_version_id did NOT get overwritten — the
    //    prior version still serves inference.
    expect(result.profile.currentVersionId).toBe('PROFVER-EXISTING');
    expect(result.profile.summary).toBe('previous summary still serving');
    expect(result.profile.lastError).toBe('Shape check failed — SUMMARY_EMPTY');

    // 3. No "flip pointer" UPDATE fired — the only UPDATE was the minimal
    //    last_requested_at/last_error touch.
    const flipQueries = queryMock.calls.filter(
      c =>
        c.sql.includes('UPDATE capability_agent_learning_profiles') &&
        c.sql.includes('current_version_id = $14'),
    );
    expect(flipQueries).toHaveLength(0);
  });
});

describe('runJudgeAgainstFixtures', () => {
  it('short-circuits to a passing zero-fixture report when fixtures are empty', async () => {
    const requestModel = vi.fn();
    const report = await runJudgeAgainstFixtures({
      profile: baseProfile(),
      fixtures: [],
      requestModel,
    });
    expect(report.fixtureCount).toBe(0);
    expect(report.thresholdMet).toBe(true);
    expect(requestModel).not.toHaveBeenCalled();
  });

  it('aggregates per-fixture scores and marks below-threshold reports', async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ content: '{"score": 0.9, "rationale": "solid"}' })
      .mockResolvedValueOnce({ content: '{"score": 0.2, "failedCriteria": ["role"]}' });
    const report = await runJudgeAgainstFixtures({
      profile: baseProfile(),
      fixtures: [
        { fixtureId: 'EVFX-1', prompt: 'What do you do when x?' },
        {
          fixtureId: 'EVFX-2',
          prompt: 'Summarize this incident',
          expectedCriteria: ['stays on role'],
        },
      ],
      requestModel,
    });
    expect(report.fixtureCount).toBe(2);
    expect(report.passedCount).toBe(1);
    expect(report.score).toBeCloseTo((0.9 + 0.2) / 2, 5);
    expect(report.thresholdMet).toBe(report.score >= DEFAULT_JUDGE_PASS_THRESHOLD);
    expect(report.fixtures[1].failedCriteria).toEqual(['role']);
  });

  it('captures per-fixture errors without blanking the whole report', async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ content: '{"score": 0.8}' })
      .mockRejectedValueOnce(new Error('model-timeout'));
    const report = await runJudgeAgainstFixtures({
      profile: baseProfile(),
      fixtures: [
        { fixtureId: 'EVFX-A', prompt: 'A' },
        { fixtureId: 'EVFX-B', prompt: 'B' },
      ],
      requestModel,
    });
    expect(report.fixtureCount).toBe(2);
    expect(report.passedCount).toBe(1);
    expect(report.fixtures[1].error).toBe('model-timeout');
    expect(report.fixtures[1].score).toBe(0);
  });

  it('clamps out-of-range LLM scores into [0, 1]', async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce({ content: '{"score": 1.4}' })
      .mockResolvedValueOnce({ content: '{"score": -0.3}' });
    const report = await runJudgeAgainstFixtures({
      profile: baseProfile(),
      fixtures: [
        { fixtureId: 'EVFX-A', prompt: 'A' },
        { fixtureId: 'EVFX-B', prompt: 'B' },
      ],
      requestModel,
    });
    expect(report.fixtures[0].score).toBe(1);
    expect(report.fixtures[1].score).toBe(0);
  });
});
