// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildBudgetedPrompt,
  resolvePhaseBudget,
  type BudgetFragment,
} from '../execution/contextBudget';

const frag = (
  source: BudgetFragment['source'],
  estimatedTokens: number,
  textOverride?: string,
): BudgetFragment => ({
  source,
  estimatedTokens,
  // Text must be non-empty post-trim, otherwise buildBudgetedPrompt skips it.
  text: textOverride ?? `[${source}:${estimatedTokens}]`,
});

describe('buildBudgetedPrompt — happy path (everything fits)', () => {
  it('preserves input order and reports zero evictions', () => {
    const fragments: BudgetFragment[] = [
      frag('SYSTEM_CORE', 100),
      frag('TOOL_DESCRIPTIONS', 200),
      frag('STEP_CONTRACT', 300),
      frag('WORK_ITEM_BRIEFING', 400),
      frag('CODE_HUNKS', 500),
      frag('MEMORY_HITS', 600),
    ];

    const { assembled, receipt } = buildBudgetedPrompt({
      fragments,
      maxInputTokens: 10_000,
      reservedOutputTokens: 2_000,
    });

    expect(receipt.evicted).toHaveLength(0);
    expect(receipt.included.map(i => i.source)).toEqual([
      'SYSTEM_CORE',
      'TOOL_DESCRIPTIONS',
      'STEP_CONTRACT',
      'WORK_ITEM_BRIEFING',
      'CODE_HUNKS',
      'MEMORY_HITS',
    ]);
    expect(receipt.totalEstimatedTokens).toBe(2100);
    expect(receipt.maxInputTokens).toBe(10_000);
    expect(receipt.reservedOutputTokens).toBe(2_000);

    // Assembled output also preserves input order.
    const indexOf = (marker: string) => assembled.indexOf(marker);
    expect(indexOf('[SYSTEM_CORE')).toBeLessThan(indexOf('[TOOL_DESCRIPTIONS'));
    expect(indexOf('[TOOL_DESCRIPTIONS')).toBeLessThan(indexOf('[STEP_CONTRACT'));
    expect(indexOf('[CODE_HUNKS')).toBeLessThan(indexOf('[MEMORY_HITS'));
  });

  it('filters zero-token and empty-text fragments silently', () => {
    const fragments: BudgetFragment[] = [
      frag('SYSTEM_CORE', 100),
      { source: 'CODE_HUNKS', text: '   ', estimatedTokens: 500 }, // whitespace only
      { source: 'MEMORY_HITS', text: 'real content', estimatedTokens: 0 }, // zero tokens
      frag('WORK_ITEM_BRIEFING', 50),
    ];

    const { receipt } = buildBudgetedPrompt({
      fragments,
      maxInputTokens: 10_000,
    });

    expect(receipt.included.map(i => i.source)).toEqual([
      'SYSTEM_CORE',
      'WORK_ITEM_BRIEFING',
    ]);
    expect(receipt.evicted).toHaveLength(0);
  });
});

describe('buildBudgetedPrompt — eviction path', () => {
  it('evicts lowest-priority fragments first until the total fits', () => {
    // Total = 10_000 tokens. Budget = 6_000. Must evict 4_000 worth.
    // DEFAULT priorities: MEMORY_HITS=100, CODE_HUNKS=200, HISTORY_ROLLUP=300.
    // Lowest-first eviction should drop MEMORY_HITS (2000) and CODE_HUNKS (2000)
    // and spare HISTORY_ROLLUP / WORK_ITEM_BRIEFING / SYSTEM_CORE.
    const fragments: BudgetFragment[] = [
      frag('SYSTEM_CORE', 1_000),
      frag('WORK_ITEM_BRIEFING', 2_000),
      frag('HISTORY_ROLLUP', 1_000),
      frag('CODE_HUNKS', 2_000),
      frag('CODE_HUNKS', 2_000, '[CODE_HUNKS:2000-second]'),
      frag('MEMORY_HITS', 2_000),
    ];

    const { receipt } = buildBudgetedPrompt({
      fragments,
      maxInputTokens: 6_000,
    });

    const evictedSources = receipt.evicted.map(e => e.source);
    expect(evictedSources).toContain('MEMORY_HITS');
    expect(evictedSources).toContain('CODE_HUNKS');
    // The higher-priority survivors must still be there.
    expect(receipt.included.map(i => i.source)).toEqual(
      expect.arrayContaining(['SYSTEM_CORE', 'WORK_ITEM_BRIEFING', 'HISTORY_ROLLUP']),
    );
    // Every evicted entry is tagged with the overflow reason.
    for (const e of receipt.evicted) {
      expect(e.reason).toBe('budget_overflow');
    }
    // Total after eviction must fit under the ceiling.
    expect(receipt.totalEstimatedTokens).toBeLessThanOrEqual(6_000);
  });

  it('never evicts SYSTEM_CORE or TOOL_DESCRIPTIONS, even under extreme pressure', () => {
    const fragments: BudgetFragment[] = [
      frag('SYSTEM_CORE', 5_000),
      frag('TOOL_DESCRIPTIONS', 5_000),
      frag('CODE_HUNKS', 3_000),
      frag('MEMORY_HITS', 3_000),
    ];

    const { receipt } = buildBudgetedPrompt({
      fragments,
      maxInputTokens: 4_000, // tiny — forces aggressive eviction
    });

    const includedSources = receipt.included.map(i => i.source);
    expect(includedSources).toContain('SYSTEM_CORE');
    expect(includedSources).toContain('TOOL_DESCRIPTIONS');
    expect(includedSources).not.toContain('CODE_HUNKS');
    expect(includedSources).not.toContain('MEMORY_HITS');

    // All evictable fragments were dropped.
    const evictedSources = receipt.evicted.map(e => e.source);
    expect(evictedSources).toEqual(expect.arrayContaining(['CODE_HUNKS', 'MEMORY_HITS']));
  });

  it('included + evicted together account for every input fragment', () => {
    const fragments: BudgetFragment[] = [
      frag('SYSTEM_CORE', 800),
      frag('TOOL_DESCRIPTIONS', 800),
      frag('STEP_CONTRACT', 400),
      frag('WORK_ITEM_BRIEFING', 600),
      frag('PHASE_GUIDANCE', 500),
      frag('RAW_TAIL_TURNS', 900),
      frag('HISTORY_ROLLUP', 800),
      frag('CODE_HUNKS', 1_000),
      frag('CODE_HUNKS', 1_000, '[CODE_HUNKS:hunk-2]'),
      frag('MEMORY_HITS', 1_000),
    ];

    const { receipt } = buildBudgetedPrompt({
      fragments,
      maxInputTokens: 3_500, // well under the 7_800 total; heavy eviction
    });

    expect(receipt.included.length + receipt.evicted.length).toBe(fragments.length);
  });

  it('preserves input (original) order among survivors after eviction', () => {
    const fragments: BudgetFragment[] = [
      frag('SYSTEM_CORE', 500),
      frag('MEMORY_HITS', 2_000), // will be evicted
      frag('WORK_ITEM_BRIEFING', 1_000),
      frag('CODE_HUNKS', 2_000), // will be evicted
      frag('HISTORY_ROLLUP', 500),
    ];

    const { assembled, receipt } = buildBudgetedPrompt({
      fragments,
      maxInputTokens: 2_500,
    });

    // Surviving sources emitted in original order (SYSTEM_CORE, WORK_ITEM_BRIEFING, HISTORY_ROLLUP).
    expect(receipt.included.map(i => i.source)).toEqual([
      'SYSTEM_CORE',
      'WORK_ITEM_BRIEFING',
      'HISTORY_ROLLUP',
    ]);
    const idx = (m: string) => assembled.indexOf(m);
    expect(idx('[SYSTEM_CORE')).toBeLessThan(idx('[WORK_ITEM_BRIEFING'));
    expect(idx('[WORK_ITEM_BRIEFING')).toBeLessThan(idx('[HISTORY_ROLLUP'));
  });

  it('surfaces fragment meta on both included and evicted entries', () => {
    const fragments: BudgetFragment[] = [
      { source: 'SYSTEM_CORE', text: 'sys', estimatedTokens: 100, meta: { role: 'system' } },
      {
        source: 'CODE_HUNKS',
        text: 'hunk',
        estimatedTokens: 2_000,
        meta: { filePath: 'src/auth/token.ts', symbolName: 'validateToken' },
      },
    ];

    const { receipt } = buildBudgetedPrompt({
      fragments,
      maxInputTokens: 1_500, // forces CODE_HUNKS eviction
    });

    const sysFrag = receipt.included.find(i => i.source === 'SYSTEM_CORE');
    expect(sysFrag?.meta).toEqual({ role: 'system' });
    const evictedHunk = receipt.evicted.find(e => e.source === 'CODE_HUNKS');
    expect(evictedHunk?.meta).toEqual({
      filePath: 'src/auth/token.ts',
      symbolName: 'validateToken',
    });
  });
});

describe('resolvePhaseBudget', () => {
  it('maps phase buckets to the published per-phase budgets', () => {
    expect(resolvePhaseBudget('DISCOVER')).toEqual({ maxInputTokens: 32_000, reservedOutputTokens: 4_000 });
    expect(resolvePhaseBudget('PLAN')).toEqual({ maxInputTokens: 48_000, reservedOutputTokens: 8_000 });
    expect(resolvePhaseBudget('DEVELOPMENT')).toEqual({ maxInputTokens: 64_000, reservedOutputTokens: 16_000 });
    expect(resolvePhaseBudget('QA')).toEqual({ maxInputTokens: 32_000, reservedOutputTokens: 4_000 });
    expect(resolvePhaseBudget('GOVERNANCE')).toEqual({ maxInputTokens: 24_000, reservedOutputTokens: 2_000 });
    expect(resolvePhaseBudget('RELEASE')).toEqual({ maxInputTokens: 16_000, reservedOutputTokens: 2_000 });
  });

  it('falls back to the BUILD-class default for unknown phases and missing input', () => {
    expect(resolvePhaseBudget(undefined)).toEqual({ maxInputTokens: 64_000, reservedOutputTokens: 16_000 });
    expect(resolvePhaseBudget('MYSTERY_PHASE')).toEqual({ maxInputTokens: 64_000, reservedOutputTokens: 16_000 });
  });
});
