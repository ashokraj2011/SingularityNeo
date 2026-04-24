/**
 * Context Budgeter — Phase 2 / Lever 5 of the token-optimization program.
 *
 * Today every context source (phase guidance, work-item briefing, memory
 * hits, code hunks, rolled history, raw tool turns, tool descriptions)
 * pushes bytes into the same LLM call with no awareness of each other.
 * Under pressure nothing gets evicted — the call just gets bigger.
 *
 * This module turns prompt assembly into a principled policy:
 *
 *  1. Each context source contributes one or more `BudgetFragment`s with
 *     a `source` tag, a `priority` (lower = evict first), and a token
 *     estimate.
 *  2. The budgeter accepts a `maxInputTokens` ceiling and evicts the
 *     lowest-priority fragments until the total fits — unless their
 *     source is marked non-evictable (SYSTEM_CORE, TOOL_DESCRIPTIONS).
 *  3. Output is a deterministic prompt assembly plus a receipt listing
 *     what went in, what got evicted, and why.
 *
 * The receipt is the raw material for `PROMPT_RECEIPT` run events
 * (Lever 7) — operators can answer "why did the model decide X" with
 * "because it saw these exact fragments."
 */

import type { WorkItemPhase } from '../../src/types';

export type ContextSource =
  | 'SYSTEM_CORE'          // safety/contract — never evict
  | 'DEVELOPER_PROMPT'     // route/operator developer framing
  | 'LEARNING_CONTEXT'     // learned profile / context block
  | 'REPO_GUIDANCE'        // cached repository-authored house rules
  | 'TOOL_DESCRIPTIONS'    // required for structured tool calls
  | 'PHASE_GUIDANCE'       // Lever 1 output
  | 'WORK_ITEM_BRIEFING'   // current intent + hand-off
  | 'RAW_TAIL_TURNS'       // last K raw tool turns
  | 'HISTORY_ROLLUP'       // Lever 3 summary
  | 'CONVERSATION_HISTORY' // recent user/assistant transcript
  | 'LATEST_USER_MESSAGE'  // newest user ask — never evict
  | 'CODE_HUNKS'           // Lever 2 symbol hunks (can appear N times)
  | 'MEMORY_HITS'          // retrieved memory references
  | 'OPERATOR_GUIDANCE'    // explicit operator overrides
  | 'PLAN_SUMMARY'         // compiled work-item plan summary
  | 'APPROVAL_PACKET'      // compact approval synthesis context
  | 'POLICY_DOCUMENT'     // step-level policy/template loaded from templatePath
  | 'STEP_CONTRACT'        // compiled step context (objective, inputs, etc.)
  | 'SWARM_SHARED_MEMORY'  // anchor-capability memory slice shared across swarm participants
  | 'SWARM_HOME_MEMORY';   // participant's own home-capability memory slice

export interface BudgetFragment {
  source: ContextSource;
  /**
   * The fragment text. The budgeter does not mutate this; whatever the
   * caller passes is what the main model sees (or doesn't, if evicted).
   */
  text: string;
  /**
   * Lower number = evict first. Non-evictable sources (SYSTEM_CORE,
   * TOOL_DESCRIPTIONS) use priority Infinity; the fragment-priority
   * resolver below handles that.
   */
  priority?: number;
  /** Pre-computed token estimate. */
  estimatedTokens: number;
  /** Optional free-form metadata surfaced into prompt receipts. */
  meta?: Record<string, unknown>;
}

export interface EvictedFragment {
  source: ContextSource;
  estimatedTokens: number;
  reason: 'budget_overflow' | 'duplicate';
  meta?: Record<string, unknown>;
}

export interface BudgetReceipt {
  /** Ordered list of fragments actually included in the prompt. */
  included: Array<{
    source: ContextSource;
    estimatedTokens: number;
    meta?: Record<string, unknown>;
  }>;
  evicted: EvictedFragment[];
  totalEstimatedTokens: number;
  maxInputTokens: number;
  reservedOutputTokens: number;
}

export interface BudgetedPrompt {
  /** Concatenated prompt body (fragments joined by blank line). */
  assembled: string;
  receipt: BudgetReceipt;
}

const NEVER_EVICT: ReadonlySet<ContextSource> = new Set([
  'SYSTEM_CORE',
  'DEVELOPER_PROMPT',
  'LATEST_USER_MESSAGE',
  'TOOL_DESCRIPTIONS',
]);

/**
 * Default eviction priorities. Lower = evict first. The budgeter sorts
 * by priority ascending when shedding load, but fragments flagged in
 * `NEVER_EVICT` are preserved regardless.
 */
const DEFAULT_PRIORITY: Record<ContextSource, number> = {
  SYSTEM_CORE: 1_000_000,
  DEVELOPER_PROMPT: 950_000,
  LATEST_USER_MESSAGE: 925_000,
  TOOL_DESCRIPTIONS: 900_000,
  STEP_CONTRACT: 800,
  POLICY_DOCUMENT: 780,
  WORK_ITEM_BRIEFING: 700,
  LEARNING_CONTEXT: 675,
  OPERATOR_GUIDANCE: 650,
  PLAN_SUMMARY: 600,
  PHASE_GUIDANCE: 500,
  REPO_GUIDANCE: 450,
  RAW_TAIL_TURNS: 400,
  CONVERSATION_HISTORY: 350,
  HISTORY_ROLLUP: 300,
  APPROVAL_PACKET: 250,
  CODE_HUNKS: 200,
  MEMORY_HITS: 100,
  SWARM_SHARED_MEMORY: 160,
  SWARM_HOME_MEMORY: 140,
};

/**
 * Per-phase token ceilings. Input budget = what we send TO the main
 * model; reserved output = headroom for its response. Tune via telemetry.
 * Unknown phases fall back to DEVELOPMENT-class budgets.
 */
export interface PhaseBudget {
  maxInputTokens: number;
  reservedOutputTokens: number;
}

const PHASE_BUDGETS: Array<{ pattern: RegExp; budget: PhaseBudget }> = [
  { pattern: /\b(discover|analy|incept|elabor)/i, budget: { maxInputTokens: 32_000, reservedOutputTokens: 4_000 } },
  { pattern: /\b(plan|design)/i, budget: { maxInputTokens: 48_000, reservedOutputTokens: 8_000 } },
  { pattern: /\b(dev|build|constr|impl|code)/i, budget: { maxInputTokens: 64_000, reservedOutputTokens: 16_000 } },
  { pattern: /\b(qa|test|valid|verif)/i, budget: { maxInputTokens: 32_000, reservedOutputTokens: 4_000 } },
  { pattern: /\b(govern|review|audit)/i, budget: { maxInputTokens: 24_000, reservedOutputTokens: 2_000 } },
  { pattern: /\b(release|deliver|deploy|launch)/i, budget: { maxInputTokens: 16_000, reservedOutputTokens: 2_000 } },
];

const DEFAULT_PHASE_BUDGET: PhaseBudget = { maxInputTokens: 64_000, reservedOutputTokens: 16_000 };

export const resolvePhaseBudget = (phase?: WorkItemPhase | string | null): PhaseBudget => {
  if (!phase) return DEFAULT_PHASE_BUDGET;
  const hit = PHASE_BUDGETS.find(entry => entry.pattern.test(String(phase)));
  return hit?.budget || DEFAULT_PHASE_BUDGET;
};

const resolveFragmentPriority = (fragment: BudgetFragment): number => {
  if (NEVER_EVICT.has(fragment.source)) return Number.POSITIVE_INFINITY;
  if (typeof fragment.priority === 'number') return fragment.priority;
  return DEFAULT_PRIORITY[fragment.source] ?? 0;
};

/**
 * Assemble a budgeted prompt from a list of fragments.
 *
 * Strategy:
 *  1. Compute total tokens.
 *  2. If it fits, emit in input order with a receipt.
 *  3. Otherwise, sort a mutable copy by priority ascending and evict the
 *     lowest-priority fragments first until the remainder fits.
 *     Non-evictable sources are skipped during eviction — if the budget
 *     can't accommodate them alone, we emit what we can and let the
 *     receipt flag the overflow (better than silently dropping safety).
 *  4. Re-emit the surviving fragments in the *original* input order so
 *     the prompt remains stable/readable.
 */
export const buildBudgetedPrompt = (args: {
  fragments: BudgetFragment[];
  maxInputTokens: number;
  reservedOutputTokens?: number;
  joiner?: string;
}): BudgetedPrompt => {
  const joiner = args.joiner ?? '\n\n';
  const maxInputTokens = Math.max(1_000, args.maxInputTokens);
  const reservedOutputTokens = args.reservedOutputTokens ?? 0;

  // Skip zero-token fragments (empty after trimming) entirely.
  const nonEmpty = args.fragments.filter(f => f.text && f.text.trim().length > 0 && f.estimatedTokens > 0);

  const total = nonEmpty.reduce((sum, f) => sum + f.estimatedTokens, 0);

  if (total <= maxInputTokens) {
    return {
      assembled: nonEmpty.map(f => f.text).join(joiner),
      receipt: {
        included: nonEmpty.map(f => ({
          source: f.source,
          estimatedTokens: f.estimatedTokens,
          meta: f.meta,
        })),
        evicted: [],
        totalEstimatedTokens: total,
        maxInputTokens,
        reservedOutputTokens,
      },
    };
  }

  // Overflow path. Evict from lowest priority upward, but never touch
  // NEVER_EVICT sources (SYSTEM_CORE, TOOL_DESCRIPTIONS).
  const evictionOrder = [...nonEmpty]
    .map((fragment, index) => ({ fragment, index }))
    .sort((left, right) => {
      const lp = resolveFragmentPriority(left.fragment);
      const rp = resolveFragmentPriority(right.fragment);
      if (lp !== rp) return lp - rp; // lowest first
      // Tie break: larger fragments evict first (bigger bang for buck).
      return right.fragment.estimatedTokens - left.fragment.estimatedTokens;
    });

  const evictedIndices = new Set<number>();
  const evicted: EvictedFragment[] = [];
  let runningTotal = total;

  for (const { fragment, index } of evictionOrder) {
    if (runningTotal <= maxInputTokens) break;
    if (NEVER_EVICT.has(fragment.source)) continue;
    evictedIndices.add(index);
    evicted.push({
      source: fragment.source,
      estimatedTokens: fragment.estimatedTokens,
      reason: 'budget_overflow',
      meta: fragment.meta,
    });
    runningTotal -= fragment.estimatedTokens;
  }

  const survivors = nonEmpty.filter((_, index) => !evictedIndices.has(index));

  return {
    assembled: survivors.map(f => f.text).join(joiner),
    receipt: {
      included: survivors.map(f => ({
        source: f.source,
        estimatedTokens: f.estimatedTokens,
        meta: f.meta,
      })),
      evicted,
      totalEstimatedTokens: runningTotal,
      maxInputTokens,
      reservedOutputTokens,
    },
  };
};
