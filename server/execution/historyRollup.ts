/**
 * Tool-loop history rollup — Lever 3 of the token-optimization program
 * (see /Users/ashokraj/.claude/plans/iridescent-tinkering-cocoa.md).
 *
 * The execution engine's inner loop (`runStepExecution` in service.ts)
 * accumulates every tool call into a single `toolHistory` array and
 * serializes the entire transcript into the prompt sent to the expensive
 * main model on *every* iteration — see service.ts:1876–1880. A 30-call
 * debugging run therefore pays for all 30 exchanges on call 31.
 *
 * `rollupToolHistory` collapses the oldest prefix into a short state note
 * produced by the cheapest model on the same provider. The compressed
 * transcript looks like:
 *
 *   [assistant] "Prior tool loop summary (turns 1–N, condensed): <note>"
 *   [...last keepLastN raw turns verbatim]
 *
 * Because the synthetic summary turn is still a plain `{ role, content }`
 * record, it drops in as a drop-in replacement for the raw `toolHistory`
 * array — the existing serializer at service.ts:1876 handles it unchanged.
 *
 * The cache lets us avoid re-summarizing the same prefix on each
 * iteration: callers pass in the previous `RollupCacheEntry` and receive
 * back the next one to stash. Only the newly-added older turns are sent
 * to the budget model each tick.
 */
import type { Capability, CapabilityAgent } from '../../src/types';
import {
  invokeBudgetModelSummary,
  type BudgetSummaryTurn,
} from '../githubModels';

export interface ToolHistoryEntry {
  role: 'assistant' | 'user';
  content: string;
}

export interface RolledHistory {
  /** Drop-in replacement for the raw toolHistory array. */
  compressed: ToolHistoryEntry[];
  /** The synthetic summary turn's content, or '' when no rollup happened. */
  summaryPrefix: string;
  /** Number of oldest turns collapsed into the summary. 0 means no-op. */
  summarizedTurnCount: number;
  /** Budget model id that produced the (delta of the) summary, or null. */
  usedModel: string | null;
  /** Size of the raw tail kept verbatim. */
  retainedTurnCount: number;
}

export interface RollupCacheEntry {
  summary: string;
  /** How many oldest turns are already folded into `summary`. */
  coveredTurns: number;
}

const DEFAULT_KEEP_LAST_N = 6;
const DEFAULT_THRESHOLD = 10;

export const rollupToolHistory = async (args: {
  capability: Capability;
  agent: CapabilityAgent;
  toolHistory: ToolHistoryEntry[];
  cache?: RollupCacheEntry | null;
  keepLastN?: number;
  rollupThreshold?: number;
}): Promise<{ rolled: RolledHistory; nextCache: RollupCacheEntry | null }> => {
  const keepLastN = Math.max(1, args.keepLastN ?? DEFAULT_KEEP_LAST_N);
  const threshold = Math.max(keepLastN + 1, args.rollupThreshold ?? DEFAULT_THRESHOLD);
  const history = args.toolHistory;

  if (history.length <= threshold) {
    return {
      rolled: {
        compressed: history,
        summaryPrefix: '',
        summarizedTurnCount: 0,
        usedModel: null,
        retainedTurnCount: history.length,
      },
      nextCache: args.cache || null,
    };
  }

  const splitAt = history.length - keepLastN;
  const oldest = history.slice(0, splitAt);
  const tail = history.slice(splitAt);

  const priorCoverage = Math.min(args.cache?.coveredTurns ?? 0, oldest.length);
  const newOlder: BudgetSummaryTurn[] = oldest.slice(priorCoverage).map(entry => ({
    role: entry.role,
    content: entry.content,
  }));

  let summaryText = args.cache?.summary || '';
  let usedModel: string | null = null;

  if (newOlder.length > 0) {
    try {
      const result = await invokeBudgetModelSummary({
        capability: args.capability,
        agent: args.agent,
        priorSummary: summaryText,
        newTurns: newOlder,
      });
      summaryText = result.summary || summaryText;
      usedModel = result.model || null;
    } catch (error) {
      // Budget-model failure is non-fatal — the rollup is a cost
      // optimization. Fall back to a truncated raw transcript so the main
      // model still receives *something* coherent. We keep only the tail
      // and emit a stub prefix noting the condensation failed.
      console.warn('[historyRollup] budget-model summary failed; using truncated fallback', error);
      const stub = `[rollup unavailable — showing only last ${keepLastN} of ${history.length} turns]`;
      return {
        rolled: {
          compressed: [{ role: 'assistant', content: stub }, ...tail],
          summaryPrefix: stub,
          summarizedTurnCount: splitAt,
          usedModel: null,
          retainedTurnCount: tail.length,
        },
        nextCache: args.cache || null,
      };
    }
  }

  const prefix = `Prior tool loop summary (turns 1–${splitAt}, condensed): ${summaryText}`;
  const compressed: ToolHistoryEntry[] = [
    { role: 'assistant', content: prefix },
    ...tail,
  ];

  return {
    rolled: {
      compressed,
      summaryPrefix: prefix,
      summarizedTurnCount: splitAt,
      usedModel,
      retainedTurnCount: tail.length,
    },
    nextCache: { summary: summaryText, coveredTurns: splitAt },
  };
};
