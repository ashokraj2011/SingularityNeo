/**
 * Slice C — Drift detection for agent learning profile versions.
 *
 * After a new version flips the pointer, we track its canary counters
 * (requests + negative signals) on the live profile row. The previous
 * version's final counters are frozen onto its version row as a baseline.
 *
 * Drift is flagged when:
 *   1. The canary has observed enough signal (request threshold) OR has
 *      been live long enough (time threshold).
 *   2. Its negative-rate exceeds the previous baseline's by more than the
 *      configured delta.
 *   3. The above holds for N consecutive evaluation runs (default 2) so a
 *      single bad burst doesn't trip the alarm.
 *
 * Flagging is **manual-approve only** per the locked plan decision — we
 * never auto-revert. Setting `drift_flagged_at` is what surfaces the
 * banner + revert button in the lens.
 */
import type {
  AgentLearningDriftState,
  AgentLearningProfile,
  AgentLearningProfileVersion,
} from '../../src/types';

export const DRIFT_FLAG_ENV = 'LEARNING_DRIFT_ENABLED';
export const DRIFT_DRY_RUN_ENV = 'LEARNING_DRIFT_DRY_RUN';

export const DEFAULT_DRIFT_MIN_REQUESTS = 30;
export const DEFAULT_DRIFT_MIN_CANARY_MS = 24 * 60 * 60 * 1000; // 24h
export const DEFAULT_DRIFT_RATE_DELTA = 0.15; // 15 percentage points
export const DEFAULT_DRIFT_CONSECUTIVE_CHECKS = 2;
export const DEFAULT_DRIFT_BASELINE_MIN_REQUESTS = 10;

export const isDriftDetectionEnabled = (): boolean => {
  const raw = (process.env[DRIFT_FLAG_ENV] || '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') {
    return false;
  }
  return true;
};

export const isDriftDryRun = (): boolean => {
  const raw = (process.env[DRIFT_DRY_RUN_ENV] || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
};

export interface DriftThresholds {
  minRequests: number;
  minCanaryMs: number;
  rateDelta: number;
  consecutiveChecks: number;
  baselineMinRequests: number;
}

export const defaultDriftThresholds = (): DriftThresholds => ({
  minRequests: DEFAULT_DRIFT_MIN_REQUESTS,
  minCanaryMs: DEFAULT_DRIFT_MIN_CANARY_MS,
  rateDelta: DEFAULT_DRIFT_RATE_DELTA,
  consecutiveChecks: DEFAULT_DRIFT_CONSECUTIVE_CHECKS,
  baselineMinRequests: DEFAULT_DRIFT_BASELINE_MIN_REQUESTS,
});

export type DriftEvaluationDecision =
  | {
      kind: 'INSUFFICIENT_SIGNAL';
      reason:
        | 'NO_CURRENT_VERSION'
        | 'NO_PREVIOUS_BASELINE'
        | 'BASELINE_TOO_SMALL'
        | 'CANARY_TOO_YOUNG'
        | 'CANARY_TOO_LIGHT';
    }
  | {
      kind: 'REGRESSING';
      newStreak: number;
      flagged: boolean;
      reason: string;
    }
  | {
      kind: 'HEALTHY';
      newStreak: number;
    };

export interface DriftEvaluationResult {
  decision: DriftEvaluationDecision;
  state: AgentLearningDriftState;
}

const safeRate = (negative: number, total: number): number => {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(1, negative / total));
};

const clampNonNegative = (value: number | undefined | null): number => {
  if (value === null || value === undefined) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
};

/**
 * Pure drift evaluation. Given a profile + previous version + optional
 * threshold overrides, returns the next state of the canary — including
 * the updated regression streak and whether the profile should be marked
 * drift_flagged. Side-effect-free; callers write the result to the DB.
 *
 * `now` is injected for hermetic testing.
 */
export const evaluateAgentLearningDrift = ({
  profile,
  previousVersion,
  thresholds = defaultDriftThresholds(),
  now = new Date(),
}: {
  profile: AgentLearningProfile;
  previousVersion: AgentLearningProfileVersion | null;
  thresholds?: DriftThresholds;
  now?: Date;
}): DriftEvaluationResult => {
  const canaryRequestCount = clampNonNegative(profile.canaryRequestCount);
  const canaryNegativeCount = clampNonNegative(profile.canaryNegativeCount);
  const canaryNegativeRate = safeRate(canaryNegativeCount, canaryRequestCount);
  const currentVersionId = profile.currentVersionId;
  const previousVersionId = profile.previousVersionId;
  const canaryStartedAt = profile.canaryStartedAt
    ? new Date(profile.canaryStartedAt)
    : null;
  const nowMs = now.getTime();
  const canaryAgeMs =
    canaryStartedAt && !Number.isNaN(canaryStartedAt.getTime())
      ? Math.max(0, nowMs - canaryStartedAt.getTime())
      : 0;
  const existingStreak = clampNonNegative(profile.driftRegressionStreak);

  const baselineState: {
    baselineRequestCount?: number;
    baselineNegativeCount?: number;
    baselineNegativeRate?: number;
  } = {};

  if (previousVersion) {
    const frozenRequest = clampNonNegative(previousVersion.frozenRequestCount);
    const frozenNegative = clampNonNegative(previousVersion.frozenNegativeCount);
    if (frozenRequest > 0 || frozenNegative > 0) {
      baselineState.baselineRequestCount = frozenRequest;
      baselineState.baselineNegativeCount = frozenNegative;
      baselineState.baselineNegativeRate = safeRate(frozenNegative, frozenRequest);
    }
  }

  const commonState: AgentLearningDriftState = {
    currentVersionId,
    previousVersionId,
    canaryStartedAt: profile.canaryStartedAt,
    canaryRequestCount,
    canaryNegativeCount,
    canaryNegativeRate,
    ...baselineState,
    negativeRateDelta:
      baselineState.baselineNegativeRate !== undefined
        ? canaryNegativeRate - baselineState.baselineNegativeRate
        : undefined,
    regressionStreak: existingStreak,
    driftFlaggedAt: profile.driftFlaggedAt,
    driftReason: profile.driftReason,
    lastCheckedAt: now.toISOString(),
    isFlagged: Boolean(profile.driftFlaggedAt),
  };

  if (!currentVersionId) {
    return {
      decision: { kind: 'INSUFFICIENT_SIGNAL', reason: 'NO_CURRENT_VERSION' },
      state: commonState,
    };
  }
  if (!previousVersion || baselineState.baselineRequestCount === undefined) {
    return {
      decision: { kind: 'INSUFFICIENT_SIGNAL', reason: 'NO_PREVIOUS_BASELINE' },
      state: commonState,
    };
  }
  if ((baselineState.baselineRequestCount || 0) < thresholds.baselineMinRequests) {
    return {
      decision: { kind: 'INSUFFICIENT_SIGNAL', reason: 'BASELINE_TOO_SMALL' },
      state: commonState,
    };
  }

  const hasEnoughRequests = canaryRequestCount >= thresholds.minRequests;
  const canaryOldEnough = canaryAgeMs >= thresholds.minCanaryMs;
  if (!hasEnoughRequests && !canaryOldEnough) {
    const reason: 'CANARY_TOO_YOUNG' | 'CANARY_TOO_LIGHT' =
      canaryAgeMs === 0 || canaryAgeMs < thresholds.minCanaryMs / 4
        ? 'CANARY_TOO_YOUNG'
        : 'CANARY_TOO_LIGHT';
    return {
      decision: { kind: 'INSUFFICIENT_SIGNAL', reason },
      state: commonState,
    };
  }

  const baselineRate = baselineState.baselineNegativeRate || 0;
  const delta = canaryNegativeRate - baselineRate;
  const regressing = delta >= thresholds.rateDelta;

  if (!regressing) {
    return {
      decision: { kind: 'HEALTHY', newStreak: 0 },
      state: { ...commonState, regressionStreak: 0 },
    };
  }

  const newStreak = existingStreak + 1;
  const flagged = newStreak >= thresholds.consecutiveChecks;
  const reason = [
    `negative-rate ${(canaryNegativeRate * 100).toFixed(1)}% vs baseline ${(
      baselineRate * 100
    ).toFixed(1)}%`,
    `Δ ${(delta * 100).toFixed(1)} pp across ${canaryRequestCount} canary requests`,
    `streak ${newStreak}/${thresholds.consecutiveChecks}`,
  ].join('; ');

  return {
    decision: {
      kind: 'REGRESSING',
      newStreak,
      flagged,
      reason,
    },
    state: {
      ...commonState,
      regressionStreak: newStreak,
      driftFlaggedAt: flagged ? now.toISOString() : commonState.driftFlaggedAt,
      driftReason: flagged ? reason : commonState.driftReason,
      isFlagged: flagged || commonState.isFlagged,
    },
  };
};
