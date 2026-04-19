// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Slice C — drift detector tests.
 *
 * `evaluateAgentLearningDrift` is pure (takes `now: Date` so tests pin time
 * without clock mocks). We exercise every decision branch plus the
 * freeze-on-flip behavior in `commitAgentLearningProfileVersion` — the latter
 * re-uses the same in-memory pg mock as Slice A/B tests so we can inspect
 * the exact UPDATE params that freeze the outgoing baseline.
 */

import {
  DEFAULT_DRIFT_BASELINE_MIN_REQUESTS,
  DEFAULT_DRIFT_MIN_CANARY_MS,
  DEFAULT_DRIFT_MIN_REQUESTS,
  DEFAULT_DRIFT_RATE_DELTA,
  defaultDriftThresholds,
  evaluateAgentLearningDrift,
  isDriftDetectionEnabled,
  isDriftDryRun,
} from '../agentLearning/driftDetector';
import type {
  AgentLearningProfile,
  AgentLearningProfileVersion,
} from '../../src/types';

const baseProfile = (
  overrides: Partial<AgentLearningProfile> = {},
): AgentLearningProfile => ({
  status: 'READY',
  summary: 'live summary',
  highlights: ['h1', 'h2', 'h3'],
  contextBlock: 'ctx',
  sourceDocumentIds: ['d1'],
  sourceArtifactIds: [],
  sourceCount: 1,
  refreshedAt: '2026-04-18T00:00:00Z',
  currentVersionId: 'PROFVER-CURRENT',
  previousVersionId: 'PROFVER-PREV',
  canaryStartedAt: '2026-04-18T00:00:00Z',
  canaryRequestCount: 60,
  canaryNegativeCount: 20,
  driftRegressionStreak: 0,
  ...overrides,
});

const baselineVersion = (
  overrides: Partial<AgentLearningProfileVersion> = {},
): AgentLearningProfileVersion => ({
  versionId: 'PROFVER-PREV',
  capabilityId: 'CAP-1',
  agentId: 'AGENT-1',
  versionNo: 1,
  status: 'READY',
  summary: 'baseline',
  highlights: ['b1', 'b2', 'b3'],
  contextBlock: '',
  sourceDocumentIds: [],
  sourceArtifactIds: [],
  sourceCount: 0,
  createdAt: '2026-04-17T00:00:00Z',
  frozenRequestCount: 200,
  frozenNegativeCount: 20, // 10% baseline negative rate
  frozenAt: '2026-04-18T00:00:00Z',
  ...overrides,
});

describe('env flag helpers', () => {
  beforeEach(() => {
    delete process.env.LEARNING_DRIFT_ENABLED;
    delete process.env.LEARNING_DRIFT_DRY_RUN;
  });
  it('drift detection defaults on', () => {
    expect(isDriftDetectionEnabled()).toBe(true);
  });
  it('respects explicit off switches', () => {
    for (const v of ['false', '0', 'no', 'off']) {
      process.env.LEARNING_DRIFT_ENABLED = v;
      expect(isDriftDetectionEnabled()).toBe(false);
    }
  });
  it('dry-run defaults off, flips on explicit truthy values', () => {
    expect(isDriftDryRun()).toBe(false);
    for (const v of ['true', '1', 'yes', 'on']) {
      process.env.LEARNING_DRIFT_DRY_RUN = v;
      expect(isDriftDryRun()).toBe(true);
    }
  });
});

describe('defaultDriftThresholds', () => {
  it('exports the documented slice-C defaults', () => {
    const t = defaultDriftThresholds();
    expect(t.minRequests).toBe(DEFAULT_DRIFT_MIN_REQUESTS);
    expect(t.minCanaryMs).toBe(DEFAULT_DRIFT_MIN_CANARY_MS);
    expect(t.rateDelta).toBe(DEFAULT_DRIFT_RATE_DELTA);
    expect(t.consecutiveChecks).toBe(2);
    expect(t.baselineMinRequests).toBe(DEFAULT_DRIFT_BASELINE_MIN_REQUESTS);
  });
});

describe('evaluateAgentLearningDrift — insufficient signal branches', () => {
  it('returns NO_CURRENT_VERSION when the profile has no active version', () => {
    const { decision } = evaluateAgentLearningDrift({
      profile: baseProfile({ currentVersionId: undefined }),
      previousVersion: baselineVersion(),
    });
    expect(decision.kind).toBe('INSUFFICIENT_SIGNAL');
    if (decision.kind === 'INSUFFICIENT_SIGNAL') {
      expect(decision.reason).toBe('NO_CURRENT_VERSION');
    }
  });

  it('returns NO_PREVIOUS_BASELINE when there is no frozen previous version', () => {
    const { decision } = evaluateAgentLearningDrift({
      profile: baseProfile(),
      previousVersion: null,
    });
    expect(decision.kind).toBe('INSUFFICIENT_SIGNAL');
    if (decision.kind === 'INSUFFICIENT_SIGNAL') {
      expect(decision.reason).toBe('NO_PREVIOUS_BASELINE');
    }
  });

  it('returns NO_PREVIOUS_BASELINE when the previous version has no frozen counters', () => {
    const { decision } = evaluateAgentLearningDrift({
      profile: baseProfile(),
      previousVersion: baselineVersion({
        frozenRequestCount: 0,
        frozenNegativeCount: 0,
      }),
    });
    expect(decision.kind).toBe('INSUFFICIENT_SIGNAL');
    if (decision.kind === 'INSUFFICIENT_SIGNAL') {
      expect(decision.reason).toBe('NO_PREVIOUS_BASELINE');
    }
  });

  it('returns BASELINE_TOO_SMALL when baseline request count is below threshold', () => {
    const { decision } = evaluateAgentLearningDrift({
      profile: baseProfile(),
      previousVersion: baselineVersion({
        frozenRequestCount: 5,
        frozenNegativeCount: 1,
      }),
    });
    expect(decision.kind).toBe('INSUFFICIENT_SIGNAL');
    if (decision.kind === 'INSUFFICIENT_SIGNAL') {
      expect(decision.reason).toBe('BASELINE_TOO_SMALL');
    }
  });

  it('returns CANARY_TOO_YOUNG when canary is fresh and has little traffic', () => {
    const now = new Date('2026-04-19T00:00:00Z');
    // Just-armed canary (minutes ago), very little traffic.
    const { decision } = evaluateAgentLearningDrift({
      profile: baseProfile({
        canaryStartedAt: '2026-04-18T23:55:00Z',
        canaryRequestCount: 2,
        canaryNegativeCount: 1,
      }),
      previousVersion: baselineVersion(),
      now,
    });
    expect(decision.kind).toBe('INSUFFICIENT_SIGNAL');
    if (decision.kind === 'INSUFFICIENT_SIGNAL') {
      expect(decision.reason).toBe('CANARY_TOO_YOUNG');
    }
  });

  it('returns CANARY_TOO_LIGHT when canary is mid-age but still sparse', () => {
    const now = new Date('2026-04-19T12:00:00Z');
    // ~12h old (> 6h quarter-threshold) but only 3 requests — so we've been
    // live a meaningful amount of time but the signal is just too thin.
    const { decision } = evaluateAgentLearningDrift({
      profile: baseProfile({
        canaryStartedAt: '2026-04-19T00:00:00Z',
        canaryRequestCount: 3,
        canaryNegativeCount: 1,
      }),
      previousVersion: baselineVersion(),
      now,
    });
    expect(decision.kind).toBe('INSUFFICIENT_SIGNAL');
    if (decision.kind === 'INSUFFICIENT_SIGNAL') {
      expect(decision.reason).toBe('CANARY_TOO_LIGHT');
    }
  });
});

describe('evaluateAgentLearningDrift — healthy + regressing branches', () => {
  it('returns HEALTHY and resets the streak when delta is below threshold', () => {
    const now = new Date('2026-04-19T12:00:00Z');
    const result = evaluateAgentLearningDrift({
      profile: baseProfile({
        // baseline 10%, canary 12% → Δ +2pp, under 15pp default threshold.
        canaryRequestCount: 100,
        canaryNegativeCount: 12,
        canaryStartedAt: '2026-04-18T00:00:00Z',
        driftRegressionStreak: 1, // should be cleared.
      }),
      previousVersion: baselineVersion(),
      now,
    });
    expect(result.decision.kind).toBe('HEALTHY');
    if (result.decision.kind === 'HEALTHY') {
      expect(result.decision.newStreak).toBe(0);
    }
    expect(result.state.regressionStreak).toBe(0);
    expect(result.state.isFlagged).toBe(false);
  });

  it('returns REGRESSING (streak=1, not flagged) on the first regressing check', () => {
    const now = new Date('2026-04-19T12:00:00Z');
    const result = evaluateAgentLearningDrift({
      profile: baseProfile({
        // baseline 10%, canary 40% → Δ +30pp, well above 15pp.
        canaryRequestCount: 100,
        canaryNegativeCount: 40,
        driftRegressionStreak: 0,
      }),
      previousVersion: baselineVersion(),
      now,
    });
    expect(result.decision.kind).toBe('REGRESSING');
    if (result.decision.kind === 'REGRESSING') {
      expect(result.decision.newStreak).toBe(1);
      expect(result.decision.flagged).toBe(false);
    }
    expect(result.state.regressionStreak).toBe(1);
    // Not flagged yet — the live profile's drift_flagged_at stays null.
    expect(result.state.isFlagged).toBe(false);
    expect(result.state.driftFlaggedAt).toBeUndefined();
  });

  it('flips to flagged on the second consecutive regressing check', () => {
    const now = new Date('2026-04-19T12:00:00Z');
    const result = evaluateAgentLearningDrift({
      profile: baseProfile({
        canaryRequestCount: 100,
        canaryNegativeCount: 40,
        driftRegressionStreak: 1, // already regressed once.
      }),
      previousVersion: baselineVersion(),
      now,
    });
    expect(result.decision.kind).toBe('REGRESSING');
    if (result.decision.kind === 'REGRESSING') {
      expect(result.decision.newStreak).toBe(2);
      expect(result.decision.flagged).toBe(true);
      expect(result.decision.reason).toMatch(/negative-rate/);
      expect(result.decision.reason).toMatch(/streak 2\/2/);
    }
    expect(result.state.regressionStreak).toBe(2);
    expect(result.state.isFlagged).toBe(true);
    expect(result.state.driftFlaggedAt).toBe(now.toISOString());
  });

  it('passes the time-elapsed gate even when request count is below threshold', () => {
    // 25 requests (< 30 threshold) but canary is 25h old (> 24h threshold).
    // Regressing delta → should flag after 2 consecutive runs.
    const now = new Date('2026-04-19T12:00:00Z');
    const result = evaluateAgentLearningDrift({
      profile: baseProfile({
        canaryStartedAt: '2026-04-18T11:00:00Z',
        canaryRequestCount: 25,
        canaryNegativeCount: 12,
        driftRegressionStreak: 1,
      }),
      previousVersion: baselineVersion(),
      now,
    });
    expect(result.decision.kind).toBe('REGRESSING');
    if (result.decision.kind === 'REGRESSING') {
      expect(result.decision.flagged).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// commitAgentLearningProfileVersion — freeze outgoing + reset canary on flip
// ──────────────────────────────────────────────────────────────────────────

type MockRow = Record<string, any>;
type MockQueryResult = { rows: MockRow[]; rowCount: number };
type MockQueryImpl = (sql: string, params?: unknown[]) => Promise<MockQueryResult>;

describe('commitAgentLearningProfileVersion — slice C freeze + reset', () => {
  it('freezes the outgoing version baseline and resets canary on flip', async () => {
    const { vi } = await import('vitest');

    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const handlers: Array<{
      match: (sql: string) => boolean;
      respond: (params?: unknown[]) => MockQueryResult;
    }> = [];
    const impl: MockQueryImpl = async (sql, params) => {
      calls.push({ sql, params });
      const h = handlers.find(x => x.match(sql));
      if (!h) return { rows: [], rowCount: 0 };
      return h.respond(params);
    };
    const on = (
      match: (sql: string) => boolean,
      respond: (params?: unknown[]) => MockQueryResult,
    ) => handlers.push({ match, respond });

    vi.resetModules();
    vi.doMock('../db', () => ({
      query: (sql: string, params?: unknown[]) => impl(sql, params),
      transaction: async <T>(fn: (client: { query: MockQueryImpl }) => Promise<T>): Promise<T> =>
        fn({ query: impl }),
      withClient: async <T>(fn: (client: { query: MockQueryImpl }) => Promise<T>): Promise<T> =>
        fn({ query: impl }),
    }));

    on(
      sql => sql.includes('SELECT *\n        FROM capability_agent_learning_profiles'),
      () => ({
        rows: [
          {
            current_version_id: 'PROFVER-OLD',
            previous_version_id: 'PROFVER-ANCIENT',
            canary_request_count: 87,
            canary_negative_count: 14,
          },
        ],
        rowCount: 1,
      }),
    );
    on(
      sql => sql.includes('SELECT COALESCE(MAX(version_no)'),
      () => ({ rows: [{ max_version: 2 }], rowCount: 1 }),
    );
    on(
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
            created_at: new Date(),
          },
        ],
        rowCount: 1,
      }),
    );
    on(
      sql => sql.includes('UPDATE capability_agent_learning_profile_versions'),
      () => ({ rows: [], rowCount: 1 }),
    );
    on(
      sql =>
        sql.includes('UPDATE capability_agent_learning_profiles') &&
        sql.includes('current_version_id = $14'),
      params => ({
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
            canary_request_count: 0,
            canary_negative_count: 0,
            drift_regression_streak: 0,
            drift_flagged_at: null,
            drift_reason: null,
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
        summary: 'v3 summary',
        highlights: ['h1', 'h2', 'h3'],
        contextBlock: 'ctx',
        sourceDocumentIds: ['D-1'],
        sourceArtifactIds: [],
        sourceCount: 1,
        refreshedAt: '2026-04-19T00:00:00Z',
      },
    });

    // Freeze UPDATE fired for the outgoing version with the exact counters
    // pulled off the profile row (87 req / 14 neg).
    const freezeCall = calls.find(c =>
      c.sql.includes('UPDATE capability_agent_learning_profile_versions') &&
      c.sql.includes('frozen_request_count'),
    );
    expect(freezeCall).toBeDefined();
    expect(freezeCall?.params).toEqual([
      'CAP-1',
      'PROFVER-OLD',
      87,
      14,
    ]);

    // Flip UPDATE fired and the returned profile has the fresh canary reset.
    expect(result.profile.currentVersionId).toBe(result.version.versionId);
    expect(result.profile.previousVersionId).toBe('PROFVER-OLD');
    expect(result.profile.canaryRequestCount ?? 0).toBe(0);
    expect(result.profile.canaryNegativeCount ?? 0).toBe(0);
    expect(result.profile.driftRegressionStreak ?? 0).toBe(0);
    expect(result.profile.driftFlaggedAt).toBeFalsy();
  });
});
