/**
 * Slice B — Quality gates before a new agent learning profile version can
 * flip the live pointer.
 *
 * Two-stage gate:
 *   1. Shape checks (synchronous, blocking): cheap JSON/shape assertions —
 *      non-empty summary, enough highlights, context-block token cap. A
 *      failure prevents the pointer from flipping; the prior version keeps
 *      serving. The candidate still lands in the version table with
 *      `status='REVIEW_PENDING'` so an operator can inspect it.
 *   2. LLM-judge (asynchronous, non-blocking in v1): runs the candidate
 *      against recorded fixtures and scores it. Drift signals are written
 *      as telemetry only — no auto-revert, per the locked decision.
 *
 * Keep this module pure / side-effect-free so the shape-check path can be
 * exercised hermetically from vitest.
 */
import type { AgentLearningProfile } from '../../src/types';

export const QUALITY_GATE_FLAG_ENV = 'LEARNING_QUALITY_GATE_ENABLED';
export const DEFAULT_CONTEXT_BLOCK_TOKEN_BUDGET = 2000;
export const DEFAULT_MIN_HIGHLIGHTS = 3;
export const DEFAULT_MIN_SUMMARY_CHARS = 40;
export const DEFAULT_JUDGE_PASS_THRESHOLD = 0.6;

export const isQualityGateEnabled = () => {
  // Default ON in dev/prod. Flip the flag to 'false' to revert to the
  // pre-Slice-B behavior while we observe the gate in production.
  const raw = (process.env[QUALITY_GATE_FLAG_ENV] || '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') {
    return false;
  }
  return true;
};

/**
 * Cheap token approximation — 4 chars ≈ 1 token is the widely-used heuristic
 * for English prose. Good enough for a safety cap; we can swap in a real
 * tokenizer (tiktoken) later without changing callers.
 */
export const estimateTokenCount = (value: string | undefined | null) => {
  if (!value) {
    return 0;
  }
  const chars = value.trim().length;
  if (!chars) {
    return 0;
  }
  return Math.ceil(chars / 4);
};

export interface ShapeCheckOutcome {
  code:
    | 'SUMMARY_EMPTY'
    | 'SUMMARY_TOO_SHORT'
    | 'HIGHLIGHTS_TOO_FEW'
    | 'CONTEXT_BLOCK_TOO_LARGE'
    | 'SOURCE_COUNT_ZERO'
    | 'INVALID_HIGHLIGHTS'
    | 'INVALID_SOURCES';
  message: string;
  severity: 'BLOCKING' | 'WARNING';
  detail?: Record<string, unknown>;
}

export interface ShapeCheckReport {
  passed: boolean;
  blockingFailures: ShapeCheckOutcome[];
  warnings: ShapeCheckOutcome[];
  measurements: {
    summaryChars: number;
    highlightCount: number;
    contextBlockTokens: number;
    sourceCount: number;
  };
  thresholds: {
    minSummaryChars: number;
    minHighlights: number;
    contextBlockTokenBudget: number;
  };
  evaluatedAt: string;
}

export interface ShapeCheckOptions {
  minSummaryChars?: number;
  minHighlights?: number;
  contextBlockTokenBudget?: number;
  /**
   * When false, an empty source set produces a WARNING rather than a
   * blocking failure. Used on the very first distillation where no
   * documents are attached yet.
   */
  requireSources?: boolean;
}

/**
 * Pure synchronous shape check — no IO, no LLM, no DB. Exercised directly
 * from tests. A BLOCKING failure means the profile version must NOT flip
 * the live pointer; it is saved with status='REVIEW_PENDING' instead.
 */
export const runProfileShapeChecks = (
  profile: AgentLearningProfile,
  options: ShapeCheckOptions = {},
): ShapeCheckReport => {
  const minSummaryChars = options.minSummaryChars ?? DEFAULT_MIN_SUMMARY_CHARS;
  const minHighlights = options.minHighlights ?? DEFAULT_MIN_HIGHLIGHTS;
  const contextBlockTokenBudget =
    options.contextBlockTokenBudget ?? DEFAULT_CONTEXT_BLOCK_TOKEN_BUDGET;
  const requireSources = options.requireSources ?? false;

  const summaryChars = (profile.summary || '').trim().length;
  const highlights = Array.isArray(profile.highlights) ? profile.highlights : [];
  const highlightCount = highlights.filter(
    item => typeof item === 'string' && item.trim().length > 0,
  ).length;
  const contextBlockTokens = estimateTokenCount(profile.contextBlock);
  const sourceCount = Number(profile.sourceCount || 0);

  const blockingFailures: ShapeCheckOutcome[] = [];
  const warnings: ShapeCheckOutcome[] = [];

  if (summaryChars === 0) {
    blockingFailures.push({
      code: 'SUMMARY_EMPTY',
      severity: 'BLOCKING',
      message: 'Distilled summary was empty.',
    });
  } else if (summaryChars < minSummaryChars) {
    blockingFailures.push({
      code: 'SUMMARY_TOO_SHORT',
      severity: 'BLOCKING',
      message: `Distilled summary is too short (${summaryChars} < ${minSummaryChars} chars).`,
      detail: { summaryChars, minSummaryChars },
    });
  }

  if (!Array.isArray(profile.highlights)) {
    blockingFailures.push({
      code: 'INVALID_HIGHLIGHTS',
      severity: 'BLOCKING',
      message: 'Highlights payload was not an array.',
    });
  } else if (highlightCount < minHighlights) {
    blockingFailures.push({
      code: 'HIGHLIGHTS_TOO_FEW',
      severity: 'BLOCKING',
      message: `Distilled profile only has ${highlightCount} highlight(s); expected at least ${minHighlights}.`,
      detail: { highlightCount, minHighlights },
    });
  }

  if (contextBlockTokens > contextBlockTokenBudget) {
    blockingFailures.push({
      code: 'CONTEXT_BLOCK_TOO_LARGE',
      severity: 'BLOCKING',
      message: `Context block is ${contextBlockTokens} tokens, exceeding cap of ${contextBlockTokenBudget}.`,
      detail: { contextBlockTokens, contextBlockTokenBudget },
    });
  }

  if (!Array.isArray(profile.sourceDocumentIds)) {
    warnings.push({
      code: 'INVALID_SOURCES',
      severity: 'WARNING',
      message: 'Source document IDs payload was not an array; treated as empty.',
    });
  }

  if (sourceCount === 0) {
    const outcome: ShapeCheckOutcome = {
      code: 'SOURCE_COUNT_ZERO',
      severity: requireSources ? 'BLOCKING' : 'WARNING',
      message: 'Distilled profile did not cite any source documents.',
    };
    if (requireSources) {
      blockingFailures.push(outcome);
    } else {
      warnings.push(outcome);
    }
  }

  return {
    passed: blockingFailures.length === 0,
    blockingFailures,
    warnings,
    measurements: {
      summaryChars,
      highlightCount,
      contextBlockTokens,
      sourceCount,
    },
    thresholds: {
      minSummaryChars,
      minHighlights,
      contextBlockTokenBudget,
    },
    evaluatedAt: new Date().toISOString(),
  };
};

// ─────────────────────────────────────────────────────────────────────────
// Async LLM-judge
// ─────────────────────────────────────────────────────────────────────────

export interface EvalFixture {
  fixtureId: string;
  prompt: string;
  referenceResponse?: string;
  expectedCriteria?: string[];
}

export interface JudgeFixtureOutcome {
  fixtureId: string;
  passed: boolean;
  score: number; // 0..1
  rationale?: string;
  failedCriteria?: string[];
  error?: string;
}

export interface JudgeReport {
  fixtureCount: number;
  passedCount: number;
  score: number; // 0..1 aggregate
  threshold: number;
  thresholdMet: boolean;
  fixtures: JudgeFixtureOutcome[];
  evaluatedAt: string;
  error?: string;
}

type RequestGitHubModel = (input: {
  model?: string;
  providerKey?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  timeoutMs?: number;
}) => Promise<{ content: string }>;

const extractJudgeJson = (raw: string): { score?: unknown; rationale?: unknown; failedCriteria?: unknown } => {
  if (!raw) {
    return {};
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return {};
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return {};
  }
};

const clamp01 = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const buildJudgePrompt = (
  profile: AgentLearningProfile,
  fixture: EvalFixture,
): Array<{ role: 'system' | 'user'; content: string }> => {
  const criteriaBlock =
    fixture.expectedCriteria && fixture.expectedCriteria.length > 0
      ? fixture.expectedCriteria.map(item => `- ${item}`).join('\n')
      : '- Stays on role\n- Uses the profile knowledge faithfully\n- Does not contradict prior cited memory';
  const reference = fixture.referenceResponse?.trim()
    ? `Previous successful response for this prompt:\n"""\n${fixture.referenceResponse.trim()}\n"""\n`
    : '';
  return [
    {
      role: 'system',
      content:
        'You are an evaluator judging whether an agent learning profile would produce a response at least as good as a known-good reference. Respond ONLY with a JSON object of the form {"score": 0..1, "rationale": "...", "failedCriteria": ["..."]}.',
    },
    {
      role: 'user',
      content: [
        `Agent profile summary:\n${profile.summary || '(empty)'}`,
        `Profile highlights:\n${(profile.highlights || []).map(h => `- ${h}`).join('\n') || '(none)'}`,
        `Evaluation prompt:\n"""\n${fixture.prompt}\n"""`,
        reference,
        `Criteria to check:\n${criteriaBlock}`,
        'Score 0..1 where 1 means the profile would clearly satisfy every criterion and 0 means it would clearly fail. Be strict.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
};

/**
 * Runs the candidate profile against each fixture via the configured model
 * and returns an aggregate judge report. All errors are captured per-fixture
 * so a single flaky call does not blank the report. If no fixtures are
 * provided the report short-circuits to a passing, zero-fixture result —
 * the judge is advisory in v1.
 */
export const runJudgeAgainstFixtures = async ({
  profile,
  fixtures,
  requestModel,
  model,
  providerKey,
  threshold = DEFAULT_JUDGE_PASS_THRESHOLD,
  perFixtureTimeoutMs = 15_000,
  maxFixtures = 10,
}: {
  profile: AgentLearningProfile;
  fixtures: EvalFixture[];
  requestModel: RequestGitHubModel;
  model?: string;
  providerKey?: string;
  threshold?: number;
  perFixtureTimeoutMs?: number;
  maxFixtures?: number;
}): Promise<JudgeReport> => {
  const limited = fixtures.slice(0, maxFixtures);
  if (limited.length === 0) {
    return {
      fixtureCount: 0,
      passedCount: 0,
      score: 1,
      threshold,
      thresholdMet: true,
      fixtures: [],
      evaluatedAt: new Date().toISOString(),
    };
  }

  const outcomes: JudgeFixtureOutcome[] = [];
  for (const fixture of limited) {
    try {
      const response = await requestModel({
        model,
        providerKey,
        messages: buildJudgePrompt(profile, fixture),
        timeoutMs: perFixtureTimeoutMs,
      });
      const parsed = extractJudgeJson(response.content || '');
      const scoreValue = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score);
      const score = clamp01(scoreValue);
      const rationale =
        typeof parsed.rationale === 'string' ? parsed.rationale.trim() : undefined;
      const failedCriteriaRaw = Array.isArray(parsed.failedCriteria) ? parsed.failedCriteria : [];
      const failedCriteria = failedCriteriaRaw
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);
      outcomes.push({
        fixtureId: fixture.fixtureId,
        passed: score >= threshold,
        score,
        rationale,
        failedCriteria: failedCriteria.length ? failedCriteria : undefined,
      });
    } catch (error) {
      outcomes.push({
        fixtureId: fixture.fixtureId,
        passed: false,
        score: 0,
        error: error instanceof Error ? error.message : 'judge-call-failed',
      });
    }
  }

  const passedCount = outcomes.filter(o => o.passed).length;
  const aggregate =
    outcomes.reduce((sum, o) => sum + (Number.isFinite(o.score) ? o.score : 0), 0) /
    outcomes.length;
  const score = clamp01(aggregate);

  return {
    fixtureCount: outcomes.length,
    passedCount,
    score,
    threshold,
    thresholdMet: score >= threshold,
    fixtures: outcomes,
    evaluatedAt: new Date().toISOString(),
  };
};
