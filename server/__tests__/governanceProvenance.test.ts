// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice 4 — provenance extractor + prove-no-touch tests.
 *
 * Covers:
 *   1. `extractTouchedPaths` returns the expected array per tool, `null` for
 *      unmapped tools, `[]` for filesystem-inert tools, and never throws.
 *   2. `globToLikePattern` escapes LIKE wildcards and translates `**`/`*`.
 *   3. `computeCoverageGaps` returns no gap when coverage spans the window,
 *      and returns the uncovered sub-windows otherwise.
 *   4. `proveNoTouch` returns the three states (green/red/amber) and honors
 *      the feature flag.
 */

import {
  extractTouchedPaths,
  isMappedProvenanceTool,
} from '../governance/provenanceExtractor';

describe('extractTouchedPaths', () => {
  it('workspace_write returns the single target path', () => {
    expect(extractTouchedPaths('workspace_write', { path: 'src/foo.ts' })).toEqual([
      'src/foo.ts',
    ]);
  });

  it('workspace_apply_patch collects paths from diff.files and normalizes slashes', () => {
    const result = extractTouchedPaths('workspace_apply_patch', {
      diff: {
        files: [
          { path: 'src\\win.ts' },
          { path: './src/rel.ts' },
          'src/plain.ts',
        ],
      },
    });
    expect(result?.sort()).toEqual(['src/plain.ts', 'src/rel.ts', 'src/win.ts']);
  });

  it('run_deploy collects target list', () => {
    expect(
      extractTouchedPaths('run_deploy', { targets: ['services/api', 'services/web'] }),
    ).toEqual(['services/api', 'services/web']);
  });

  it('returns [] for filesystem-inert tools', () => {
    expect(extractTouchedPaths('run_build', {})).toEqual([]);
    expect(extractTouchedPaths('run_test', {})).toEqual([]);
  });

  it('returns null for unmapped tools so telemetry can fire', () => {
    expect(extractTouchedPaths('custom_tool_xyz', { path: 'x' })).toBeNull();
    expect(isMappedProvenanceTool('custom_tool_xyz')).toBe(false);
    expect(isMappedProvenanceTool('workspace_write')).toBe(true);
  });

  it('never throws on a malformed request blob', () => {
    expect(() =>
      extractTouchedPaths('workspace_apply_patch', { diff: 'not-an-object' }),
    ).not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Query surface tests — mock the db layer.
// ──────────────────────────────────────────────────────────────────────────

const dbQueryMock = vi.fn();

vi.mock('../db', () => ({
  query: (sql: string, params?: unknown[]) => dbQueryMock(sql, params),
}));

import {
  computeCoverageGaps,
  globToLikePattern,
  listCoverageWindows,
  proveNoTouch,
  recordCoverageWindow,
} from '../governance/provenance';

beforeEach(() => {
  dbQueryMock.mockReset();
  delete process.env.GOVERNANCE_PROVENANCE_ENABLED;
});

describe('globToLikePattern', () => {
  it('`**` translates to `%`', () => {
    expect(globToLikePattern('services/billing/**')).toBe('services/billing/%');
  });

  it('`*` within a segment also translates to `%` (LIKE can\'t do single-segment)', () => {
    expect(globToLikePattern('src/*.ts')).toBe('src/%.ts');
  });

  it('escapes LIKE wildcards in literal text', () => {
    expect(globToLikePattern('a_b%c')).toBe('a\\_b\\%c');
  });
});

describe('computeCoverageGaps', () => {
  const ISO = (hoursAgo: number) =>
    new Date(Date.UTC(2026, 3, 1, 12 - hoursAgo, 0, 0)).toISOString();

  it('returns no gap when coverage fully spans the window', () => {
    const result = computeCoverageGaps(ISO(5), ISO(0), [
      {
        coverageId: 'c1',
        capabilityId: 'cap',
        windowStart: ISO(6),
        windowEnd: ISO(0),
        source: 'tool_invocation',
        notes: null,
      },
    ]);
    expect(result.hasGap).toBe(false);
    expect(result.gapWindows).toEqual([]);
  });

  it('returns the uncovered head and tail as gap windows', () => {
    const result = computeCoverageGaps(ISO(10), ISO(0), [
      {
        coverageId: 'c1',
        capabilityId: 'cap',
        windowStart: ISO(8),
        windowEnd: ISO(3),
        source: 'tool_invocation',
        notes: null,
      },
    ]);
    expect(result.hasGap).toBe(true);
    expect(result.gapWindows).toHaveLength(2);
  });

  it('merges overlapping coverage intervals', () => {
    const windows = [
      {
        coverageId: 'c1',
        capabilityId: 'cap',
        windowStart: ISO(8),
        windowEnd: ISO(4),
        source: 'backfill',
        notes: null,
      },
      {
        coverageId: 'c2',
        capabilityId: 'cap',
        windowStart: ISO(5),
        windowEnd: ISO(0),
        source: 'tool_invocation',
        notes: null,
      },
    ];
    const result = computeCoverageGaps(ISO(8), ISO(0), windows);
    expect(result.hasGap).toBe(false);
  });
});

describe('listCoverageWindows / recordCoverageWindow', () => {
  it('listCoverageWindows selects by capability_id', async () => {
    dbQueryMock.mockResolvedValue({
      rows: [
        {
          coverage_id: 'c1',
          capability_id: 'cap-alpha',
          window_start: '2026-04-18T00:00:00Z',
          window_end: '2026-04-19T00:00:00Z',
          source: 'backfill',
          notes: null,
        },
      ],
      rowCount: 1,
    });
    const rows = await listCoverageWindows('cap-alpha');
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('backfill');
    expect(dbQueryMock).toHaveBeenCalledWith(expect.stringContaining('governance_provenance_coverage'), [
      'cap-alpha',
    ]);
  });

  it('recordCoverageWindow emits an INSERT with a GOV-COV- id', async () => {
    dbQueryMock.mockResolvedValue({
      rows: [
        {
          coverage_id: 'GOV-COV-XYZ',
          capability_id: 'cap-alpha',
          window_start: '2026-04-18T00:00:00Z',
          window_end: '2026-04-19T00:00:00Z',
          source: 'runtime_start',
          notes: null,
        },
      ],
      rowCount: 1,
    });
    const coverage = await recordCoverageWindow({
      capabilityId: 'cap-alpha',
      windowStart: '2026-04-18T00:00:00Z',
      windowEnd: '2026-04-19T00:00:00Z',
      source: 'runtime_start',
    });
    expect(coverage.source).toBe('runtime_start');
    const call = dbQueryMock.mock.calls[0];
    expect(call[0]).toContain('INSERT INTO governance_provenance_coverage');
    expect(call[1][0]).toMatch(/^GOV-COV-/);
  });
});

describe('proveNoTouch', () => {
  const buildCoverageRow = (capabilityId: string) => ({
    coverage_id: 'COV-1',
    capability_id: capabilityId,
    window_start: '2026-04-17T00:00:00Z',
    window_end: '2026-04-20T00:00:00Z',
    source: 'tool_invocation',
    notes: null,
  });

  it('returns touched=true when matching invocations exist', async () => {
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM capability_tool_invocations')) {
        return {
          rows: [
            {
              id: 'INV-1',
              capability_id: 'cap-alpha',
              run_id: 'RUN-1',
              tool_id: 'workspace_write',
              actor_kind: 'AI',
              touched_paths: ['services/billing/pay.ts'],
              started_at: new Date('2026-04-18T03:00:00Z'),
              completed_at: new Date('2026-04-18T03:01:00Z'),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM governance_provenance_coverage')) {
        return { rows: [buildCoverageRow('cap-alpha')], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await proveNoTouch({
      capabilityId: 'cap-alpha',
      pathGlob: 'services/billing/**',
      from: '2026-04-18T00:00:00Z',
      to: '2026-04-19T00:00:00Z',
      actorKind: 'AI',
    });

    expect(result.touched).toBe(true);
    expect(result.matchingInvocations).toHaveLength(1);
    expect(result.coverage.hasGap).toBe(false);
  });

  it('returns touched=false + no gap when nothing touched and coverage is complete', async () => {
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM capability_tool_invocations')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM governance_provenance_coverage')) {
        return { rows: [buildCoverageRow('cap-alpha')], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await proveNoTouch({
      capabilityId: 'cap-alpha',
      pathGlob: 'services/billing/**',
      from: '2026-04-18T00:00:00Z',
      to: '2026-04-19T00:00:00Z',
    });

    expect(result.touched).toBe(false);
    expect(result.coverage.hasGap).toBe(false);
    expect(result.summary).toMatch(/No AI touched/);
  });

  it('flags hasGap when coverage is missing — answer is inconclusive', async () => {
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM capability_tool_invocations')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('FROM governance_provenance_coverage')) {
        return { rows: [], rowCount: 0 }; // no coverage at all
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await proveNoTouch({
      capabilityId: 'cap-alpha',
      pathGlob: 'services/billing/**',
      from: '2026-04-18T00:00:00Z',
      to: '2026-04-19T00:00:00Z',
    });

    expect(result.touched).toBe(false);
    expect(result.coverage.hasGap).toBe(true);
    expect(result.summary).toMatch(/inconclusive/);
  });

  it('refines glob matches so src/*.ts does not match src/sub/dir.ts', async () => {
    dbQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM capability_tool_invocations')) {
        return {
          rows: [
            {
              id: 'INV-1',
              capability_id: 'cap-alpha',
              run_id: 'RUN-1',
              tool_id: 'workspace_write',
              actor_kind: 'AI',
              touched_paths: ['src/sub/dir.ts'], // would be returned by LIKE but not the final regex
              started_at: new Date('2026-04-18T03:00:00Z'),
              completed_at: new Date('2026-04-18T03:01:00Z'),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM governance_provenance_coverage')) {
        return { rows: [buildCoverageRow('cap-alpha')], rowCount: 1 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });

    const result = await proveNoTouch({
      capabilityId: 'cap-alpha',
      pathGlob: 'src/*.ts',
      from: '2026-04-18T00:00:00Z',
      to: '2026-04-19T00:00:00Z',
    });

    // The DB returned a row that LIKE matched (src/%.ts matches src/sub/dir.ts),
    // but the in-memory regex refinement drops it because `*` doesn't cross '/'.
    expect(result.touched).toBe(false);
  });

  it('returns an inconclusive answer when the feature flag is off', async () => {
    process.env.GOVERNANCE_PROVENANCE_ENABLED = 'false';
    const result = await proveNoTouch({
      capabilityId: 'cap-alpha',
      pathGlob: 'services/**',
      from: '2026-04-18T00:00:00Z',
      to: '2026-04-19T00:00:00Z',
    });
    expect(result.coverage.hasGap).toBe(true);
    expect(result.summary).toMatch(/disabled/);
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('rejects invalid/empty inputs', async () => {
    await expect(
      proveNoTouch({
        capabilityId: '',
        pathGlob: 'x',
        from: '2026-04-18T00:00:00Z',
        to: '2026-04-19T00:00:00Z',
      }),
    ).rejects.toThrow(/capabilityId/);

    await expect(
      proveNoTouch({
        capabilityId: 'cap',
        pathGlob: 'x',
        from: '2026-04-19T00:00:00Z',
        to: '2026-04-18T00:00:00Z',
      }),
    ).rejects.toThrow(/strictly after/);
  });
});
