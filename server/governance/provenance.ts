/**
 * Provenance query surface — Slice 4.
 *
 * Answers the "prove-the-negative" question: "Was PATH touched by an ACTOR
 * KIND between T1 and T2?" against the GIN-indexed `touched_paths` column
 * on `capability_tool_invocations`, with gap-awareness powered by the
 * `governance_provenance_coverage` table.
 *
 * Gap-awareness is load-bearing: a pure "touched=false" answer is a lie
 * if we weren't logging during part of the window. Every response reports
 * both the set of matching invocations AND the coverage windows; the UI
 * must show the amber "inconclusive" state whenever `hasGap=true`.
 *
 * Glob semantics: we translate a simple shell-style glob (`services/billing/**`)
 * into a Postgres `LIKE` pattern plus an optional prefix match. The GIN
 * index accelerates `touched_paths @> ARRAY[literal]` but not LIKE, so for
 * globs we also probe element-by-element in the app layer after an initial
 * prefix pull-down. For exact paths the GIN index is used directly.
 */
import { randomUUID } from 'node:crypto';
import { query } from '../db';
import type {
  ProveNoTouchInput,
  ProveNoTouchResult,
  ProvenanceCoverageResult,
  ProvenanceCoverageWindow,
  ProvenanceTouchMatch,
} from '../../src/types';

export const governanceProvenanceEnabled = (): boolean => {
  const raw = process.env.GOVERNANCE_PROVENANCE_ENABLED?.toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'no') return false;
  return true;
};

const asIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

const asIsoOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return asIso(value);
};

// ──────────────────────────────────────────────────────────────────────────
// Glob → LIKE + in-memory matcher. We keep the glob surface small (only `*`
// and `**`) — complex globs are a prove-the-negative foot-gun because the
// query surface is an audit tool, not a file-tree explorer.
// ──────────────────────────────────────────────────────────────────────────

export const globToLikePattern = (glob: string): string => {
  // `**` matches any number of path segments (incl. slashes).
  // `*` matches within a single path segment (no slashes).
  // Literal chars are escaped by Postgres via parameterization.
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      out += '%';
      i += 2;
      // Skip a trailing slash: `services/billing/**` = "services/billing/"
      // + anything, but also the bare prefix. We emit `%` alone so LIKE
      // matches any continuation.
      if (glob[i] === '/') i += 1;
    } else if (ch === '*') {
      out += '%';
      i += 1;
    } else if (ch === '%' || ch === '_' || ch === '\\') {
      // Escape LIKE wildcards + backslash.
      out += '\\' + ch;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
};

const globToRegex = (glob: string): RegExp => {
  let out = '^';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      out += '.*';
      i += 2;
      if (glob[i] === '/') i += 1;
    } else if (ch === '*') {
      out += '[^/]*';
      i += 1;
    } else if ('.+?^${}()|[]\\'.includes(ch)) {
      out += '\\' + ch;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  out += '$';
  return new RegExp(out);
};

// ──────────────────────────────────────────────────────────────────────────
// Coverage windows — provenance_coverage table reads.
// ──────────────────────────────────────────────────────────────────────────

const rowToCoverage = (row: Record<string, unknown>): ProvenanceCoverageWindow => ({
  coverageId: String(row.coverage_id),
  capabilityId: String(row.capability_id),
  windowStart: asIso(row.window_start),
  windowEnd: asIso(row.window_end),
  source: String(row.source),
  notes: row.notes ? String(row.notes) : null,
});

export const listCoverageWindows = async (
  capabilityId: string,
): Promise<ProvenanceCoverageWindow[]> => {
  const res = await query<Record<string, unknown>>(
    `
      SELECT *
      FROM governance_provenance_coverage
      WHERE capability_id = $1
      ORDER BY window_start ASC
    `,
    [capabilityId],
  );
  return res.rows.map(rowToCoverage);
};

export const recordCoverageWindow = async (args: {
  capabilityId: string;
  windowStart: string;
  windowEnd: string;
  source: string;
  notes?: string;
}): Promise<ProvenanceCoverageWindow> => {
  const coverageId = `GOV-COV-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const res = await query<Record<string, unknown>>(
    `
      INSERT INTO governance_provenance_coverage (
        coverage_id, capability_id, window_start, window_end, source, notes, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING *
    `,
    [
      coverageId,
      args.capabilityId,
      args.windowStart,
      args.windowEnd,
      args.source,
      args.notes ?? null,
    ],
  );
  return rowToCoverage(res.rows[0]);
};

/**
 * Given a requested [from, to] window and a set of known coverage windows,
 * return the list of gap sub-windows (where coverage was unknown) plus a
 * boolean hasGap. Coverage windows may overlap; we merge them first.
 */
export const computeCoverageGaps = (
  from: string,
  to: string,
  windows: ProvenanceCoverageWindow[],
): ProvenanceCoverageResult => {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) {
    return { windows, hasGap: true, gapWindows: [{ start: from, end: to }] };
  }

  // Sort and merge coverage intervals intersecting the request window.
  const intervals = windows
    .map(w => ({ start: new Date(w.windowStart).getTime(), end: new Date(w.windowEnd).getTime() }))
    .filter(({ start, end }) => end > fromMs && start < toMs)
    .map(({ start, end }) => ({
      start: Math.max(start, fromMs),
      end: Math.min(end, toMs),
    }))
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ ...iv });
  }

  const gaps: Array<{ start: string; end: string }> = [];
  let cursor = fromMs;
  for (const iv of merged) {
    if (iv.start > cursor) {
      gaps.push({
        start: new Date(cursor).toISOString(),
        end: new Date(iv.start).toISOString(),
      });
    }
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < toMs) {
    gaps.push({
      start: new Date(cursor).toISOString(),
      end: new Date(toMs).toISOString(),
    });
  }

  return { windows, hasGap: gaps.length > 0, gapWindows: gaps };
};

// ──────────────────────────────────────────────────────────────────────────
// proveNoTouch — the hot query surface.
// ──────────────────────────────────────────────────────────────────────────

const rowToMatch = (row: Record<string, unknown>): ProvenanceTouchMatch => ({
  toolInvocationId: String(row.id),
  capabilityId: String(row.capability_id),
  runId: String(row.run_id),
  toolId: String(row.tool_id),
  actorKind: (String(row.actor_kind) === 'HUMAN' ? 'HUMAN' : 'AI') as 'AI' | 'HUMAN',
  touchedPaths: Array.isArray(row.touched_paths)
    ? (row.touched_paths as string[])
    : [],
  startedAt: asIsoOrNull(row.started_at),
  completedAt: asIsoOrNull(row.completed_at),
});

export const proveNoTouch = async (
  input: ProveNoTouchInput,
): Promise<ProveNoTouchResult> => {
  if (!governanceProvenanceEnabled()) {
    // Feature flag off: return a conservative "inconclusive" answer so
    // callers never mistake flag-off for a silent "no touch".
    return {
      touched: false,
      matchingInvocations: [],
      coverage: { windows: [], hasGap: true, gapWindows: [{ start: input.from, end: input.to }] },
      summary:
        'Provenance query surface is disabled (GOVERNANCE_PROVENANCE_ENABLED=false). Answer is inconclusive.',
    };
  }

  if (!input.capabilityId) throw new Error('proveNoTouch: capabilityId is required');
  if (!input.pathGlob) throw new Error('proveNoTouch: pathGlob is required');
  if (!input.from || !input.to) throw new Error('proveNoTouch: from and to are required');

  const fromMs = new Date(input.from).getTime();
  const toMs = new Date(input.to).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw new Error('proveNoTouch: from/to must be valid ISO dates');
  }
  if (toMs <= fromMs) {
    throw new Error('proveNoTouch: `to` must be strictly after `from`');
  }

  const likePattern = globToLikePattern(input.pathGlob);
  const glob = input.pathGlob;
  const isExact = !glob.includes('*');

  const params: unknown[] = [input.capabilityId, input.from, input.to];
  let actorClause = '';
  if (input.actorKind && input.actorKind !== 'ANY') {
    params.push(input.actorKind);
    actorClause = ` AND actor_kind = $${params.length}`;
  }

  // For exact paths use the GIN @> operator directly — fastest path.
  // For globs we still filter down with a LIKE pattern at the DB layer
  // and then confirm with an in-memory regex so we don't over-report on
  // patterns LIKE can't express (e.g. single-segment `*`).
  let sql: string;
  if (isExact) {
    params.push([glob]);
    sql = `
      SELECT *
      FROM capability_tool_invocations
      WHERE capability_id = $1
        AND started_at >= $2
        AND started_at < $3
        ${actorClause}
        AND touched_paths @> $${params.length}::text[]
      ORDER BY started_at ASC
      LIMIT 200
    `;
  } else {
    params.push(likePattern);
    sql = `
      SELECT *
      FROM capability_tool_invocations
      WHERE capability_id = $1
        AND started_at >= $2
        AND started_at < $3
        ${actorClause}
        AND EXISTS (
          SELECT 1 FROM unnest(touched_paths) AS p
          WHERE p LIKE $${params.length} ESCAPE '\\'
        )
      ORDER BY started_at ASC
      LIMIT 200
    `;
  }

  const res = await query<Record<string, unknown>>(sql, params);
  let matches = res.rows.map(rowToMatch);

  // Refine with an in-memory regex for globs so `src/*.ts` doesn't bleed
  // into `src/sub/dir.ts`. Exact paths don't need this.
  if (!isExact) {
    const matcher = globToRegex(glob);
    matches = matches
      .map(match => ({
        ...match,
        touchedPaths: match.touchedPaths.filter(p => matcher.test(p)),
      }))
      .filter(match => match.touchedPaths.length > 0);
  }

  const coverageWindows = await listCoverageWindows(input.capabilityId);
  const coverage = computeCoverageGaps(input.from, input.to, coverageWindows);

  const touched = matches.length > 0;
  const summary = touched
    ? `${matches.length} matching invocation(s) touched ${glob} between ${input.from} and ${input.to}.`
    : coverage.hasGap
      ? `No match found, but coverage has gap(s) totaling ${coverage.gapWindows.length} window(s). Answer is inconclusive.`
      : `No AI touched ${glob} between ${input.from} and ${input.to}.`;

  return { touched, matchingInvocations: matches, coverage, summary };
};
