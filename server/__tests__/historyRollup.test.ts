// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability, CapabilityAgent } from '../../src/types';
import type { BudgetSummaryTurn } from '../githubModels';

// Mock the budget-model summarizer. The real implementation hits the
// GitHub Models runtime; the rollup logic under test should exercise it
// purely for its args — we return a deterministic summary so we can
// assert on priorSummary/newTurns wiring.
type BudgetArgs = {
  capability?: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  priorSummary: string;
  newTurns: BudgetSummaryTurn[];
  timeoutMs?: number;
};

const invokeBudgetModelSummaryMock = vi.fn(async (args: BudgetArgs) => ({
  summary: `SUMMARY(prior=${args.priorSummary.length}chars, new=${args.newTurns.length}turns)`,
  model: 'gpt-4o-mini',
  usage: null,
}));

vi.mock('../githubModels', () => ({
  invokeBudgetModelSummary: (args: BudgetArgs) => invokeBudgetModelSummaryMock(args),
}));

// Import *after* the mock is registered.
import {
  rollupToolHistory,
  type RollupCacheEntry,
  type ToolHistoryEntry,
} from '../execution/historyRollup';

const makeHistory = (count: number): ToolHistoryEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
    content: `turn-${i + 1}`,
  }));

const capability = { id: 'CAP-TEST' } as unknown as Capability;
const agent = {
  id: 'AGENT-TEST',
  capabilityId: 'CAP-TEST',
  provider: 'GitHub Copilot SDK',
} as unknown as CapabilityAgent;

beforeEach(() => {
  invokeBudgetModelSummaryMock.mockClear();
});

describe('rollupToolHistory — no-op path', () => {
  it('returns history untouched when under threshold and does not call the summarizer', async () => {
    const history = makeHistory(8); // < default threshold (10)

    const { rolled, nextCache } = await rollupToolHistory({
      capability,
      agent,
      toolHistory: history,
    });

    expect(invokeBudgetModelSummaryMock).not.toHaveBeenCalled();
    expect(rolled.summarizedTurnCount).toBe(0);
    expect(rolled.usedModel).toBeNull();
    expect(rolled.compressed).toEqual(history);
    expect(rolled.compressed).toHaveLength(8);
    expect(rolled.summaryPrefix).toBe('');
    expect(nextCache).toBeNull();
  });

  it('passes through a prior cache when under threshold', async () => {
    const history = makeHistory(5);
    const cache: RollupCacheEntry = { summary: 'cached', coveredTurns: 2 };

    const { nextCache } = await rollupToolHistory({
      capability,
      agent,
      toolHistory: history,
      cache,
    });

    expect(invokeBudgetModelSummaryMock).not.toHaveBeenCalled();
    expect(nextCache).toBe(cache);
  });
});

describe('rollupToolHistory — first compression', () => {
  it('collapses the oldest prefix once we cross threshold, keeping keepLastN raw turns', async () => {
    const history = makeHistory(12); // threshold=10, keepLastN=6 → split at 6.

    const { rolled, nextCache } = await rollupToolHistory({
      capability,
      agent,
      toolHistory: history,
    });

    // Summarizer was called exactly once, with an empty priorSummary and the 6 oldest turns.
    expect(invokeBudgetModelSummaryMock).toHaveBeenCalledTimes(1);
    const call = invokeBudgetModelSummaryMock.mock.calls[0][0];
    expect(call.priorSummary).toBe('');
    expect(call.newTurns).toHaveLength(6);
    expect(call.newTurns.map(t => t.content)).toEqual([
      'turn-1',
      'turn-2',
      'turn-3',
      'turn-4',
      'turn-5',
      'turn-6',
    ]);

    // Compressed transcript = 1 synthetic summary + 6 raw tail turns.
    expect(rolled.compressed).toHaveLength(7);
    expect(rolled.compressed[0].role).toBe('assistant');
    expect(rolled.compressed[0].content).toContain('Prior tool loop summary (turns 1–6');
    expect(rolled.compressed.slice(1).map(c => c.content)).toEqual([
      'turn-7',
      'turn-8',
      'turn-9',
      'turn-10',
      'turn-11',
      'turn-12',
    ]);

    expect(rolled.summarizedTurnCount).toBe(6);
    expect(rolled.retainedTurnCount).toBe(6);
    expect(rolled.usedModel).toBe('gpt-4o-mini');
    expect(nextCache).toEqual({
      summary: 'SUMMARY(prior=0chars, new=6turns)',
      coveredTurns: 6,
    });
  });
});

describe('rollupToolHistory — incremental compression (cache hit)', () => {
  it('only re-summarizes the newly-older turns and reuses the prior summary', async () => {
    // Simulate iteration 1 on 12-turn history (already verified above).
    const first = await rollupToolHistory({
      capability,
      agent,
      toolHistory: makeHistory(12),
    });
    expect(first.nextCache?.coveredTurns).toBe(6);
    invokeBudgetModelSummaryMock.mockClear();

    // Iteration 2: history grew to 14. keepLastN=6 → split at 8.
    // Cache already covers 6 of those 8 → only 2 newOlder should hit the summarizer.
    const { rolled, nextCache } = await rollupToolHistory({
      capability,
      agent,
      toolHistory: makeHistory(14),
      cache: first.nextCache!,
    });

    expect(invokeBudgetModelSummaryMock).toHaveBeenCalledTimes(1);
    const call = invokeBudgetModelSummaryMock.mock.calls[0][0];
    // priorSummary is the cached summary, not empty.
    expect(call.priorSummary).toBe(first.nextCache!.summary);
    expect(call.priorSummary.length).toBeGreaterThan(0);
    // Only 2 turns (#7 and #8) are newly-older; #1–#6 are already folded in.
    expect(call.newTurns).toHaveLength(2);
    expect(call.newTurns.map(t => t.content)).toEqual(['turn-7', 'turn-8']);

    // Next cache advances coverage to 8 (= history.length - keepLastN).
    expect(nextCache?.coveredTurns).toBe(8);
    // Compressed is still 1 summary + 6 raw tail (the last 6).
    expect(rolled.compressed).toHaveLength(7);
    expect(rolled.compressed.slice(1).map(c => c.content)).toEqual([
      'turn-9',
      'turn-10',
      'turn-11',
      'turn-12',
      'turn-13',
      'turn-14',
    ]);
    expect(rolled.summarizedTurnCount).toBe(8);
  });
});

describe('rollupToolHistory — forceRollup override', () => {
  it('compresses below the turn-count threshold when force flag is set', async () => {
    // 8 turns — normally a no-op. forceRollup should bypass the threshold
    // as long as history.length > keepLastN (8 > 6).
    const history = makeHistory(8);

    const { rolled } = await rollupToolHistory({
      capability,
      agent,
      toolHistory: history,
      forceRollup: true,
    });

    expect(invokeBudgetModelSummaryMock).toHaveBeenCalledTimes(1);
    expect(rolled.summarizedTurnCount).toBe(2); // 8 - keepLastN(6)
    expect(rolled.compressed).toHaveLength(7); // 1 summary + 6 tail
  });

  it('still no-ops when forceRollup is set but history ≤ keepLastN', async () => {
    const history = makeHistory(5); // ≤ keepLastN default
    const { rolled } = await rollupToolHistory({
      capability,
      agent,
      toolHistory: history,
      forceRollup: true,
    });

    expect(invokeBudgetModelSummaryMock).not.toHaveBeenCalled();
    expect(rolled.summarizedTurnCount).toBe(0);
    expect(rolled.compressed).toEqual(history);
  });
});

describe('rollupToolHistory — budget-model failure fallback', () => {
  it('returns a truncated stub transcript instead of throwing', async () => {
    invokeBudgetModelSummaryMock.mockRejectedValueOnce(new Error('budget provider down'));

    const history = makeHistory(12);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { rolled, nextCache } = await rollupToolHistory({
      capability,
      agent,
      toolHistory: history,
    });

    warnSpy.mockRestore();

    expect(rolled.usedModel).toBeNull();
    expect(rolled.compressed[0].content).toContain('rollup unavailable');
    expect(rolled.compressed[0].content).toContain('last 6 of 12');
    expect(rolled.compressed.slice(1)).toHaveLength(6);
    // Cache is preserved unchanged on failure so the next tick can retry.
    expect(nextCache).toBeNull();
  });
});
