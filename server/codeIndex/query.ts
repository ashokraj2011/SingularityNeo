/**
 * Read helpers for the code index.
 *
 * `readCodeIndexSnapshot` returns the structured summary surfaced in the
 * CapabilityMetadata card — per-repo counts + the latest audit row.
 *
 * `searchCodeSymbols` runs a prefix-then-contains match against symbol
 * names, scoped to the capability. It's intentionally dumb (LIKE, no
 * ranking, no trigrams): good enough for "find me the class called
 * PaymentController" lookups, and keeps us off pg extensions we haven't
 * provisioned. A later phase can swap in pg_trgm or embeddings without
 * changing the call shape.
 */
import { query } from '../db';
import { getCapabilityRepositoriesRecord } from '../repository';
import type {
  CapabilityCodeIndexRepoSummary,
  CapabilityCodeIndexRunStatus,
  CapabilityCodeIndexSnapshot,
  CapabilityCodeSymbol,
  CapabilityCodeSymbolKind,
} from '../../src/types';

const MAX_SEARCH_LIMIT = 100;

interface SymbolCountRow {
  repository_id: string;
  symbol_count: string;
  file_count: string;
}

interface ReferenceCountRow {
  repository_id: string;
  reference_count: string;
}

interface LatestRunRow {
  started_at: string;
  ended_at: string | null;
  status: CapabilityCodeIndexRunStatus;
  message: string | null;
}

export const readCodeIndexSnapshot = async (
  capabilityId: string,
): Promise<CapabilityCodeIndexSnapshot> => {
  const [repositories, symbolCountsResult, referenceCountsResult, latestRunResult] =
    await Promise.all([
      getCapabilityRepositoriesRecord(capabilityId),
      query(
        `
          SELECT repository_id,
                 COUNT(*)::text AS symbol_count,
                 COUNT(DISTINCT file_path)::text AS file_count
          FROM capability_code_symbols
          WHERE capability_id = $1
          GROUP BY repository_id
        `,
        [capabilityId],
      ),
      query(
        `
          SELECT repository_id, COUNT(*)::text AS reference_count
          FROM capability_code_references
          WHERE capability_id = $1
          GROUP BY repository_id
        `,
        [capabilityId],
      ),
      query(
        `
          SELECT started_at, ended_at, status, message
          FROM capability_code_index_runs
          WHERE capability_id = $1
          ORDER BY started_at DESC
          LIMIT 1
        `,
        [capabilityId],
      ),
    ]);

  const symbolCounts = new Map<string, { symbols: number; files: number }>();
  for (const row of (symbolCountsResult.rows as SymbolCountRow[]) || []) {
    symbolCounts.set(row.repository_id, {
      symbols: Number.parseInt(row.symbol_count, 10) || 0,
      files: Number.parseInt(row.file_count, 10) || 0,
    });
  }

  const referenceCounts = new Map<string, number>();
  for (const row of (referenceCountsResult.rows as ReferenceCountRow[]) || []) {
    referenceCounts.set(row.repository_id, Number.parseInt(row.reference_count, 10) || 0);
  }

  const perRepo: CapabilityCodeIndexRepoSummary[] = repositories.map(repo => {
    const symbolInfo = symbolCounts.get(repo.id) || { symbols: 0, files: 0 };
    return {
      repositoryId: repo.id,
      repositoryLabel: repo.label || repo.url || repo.id,
      filesIndexed: symbolInfo.files,
      symbolsIndexed: symbolInfo.symbols,
      referencesIndexed: referenceCounts.get(repo.id) || 0,
    };
  });

  const latestRun = (latestRunResult.rows as LatestRunRow[])?.[0];

  return {
    capabilityId,
    repositories: perRepo,
    lastRunAt: latestRun?.ended_at || latestRun?.started_at,
    lastRunStatus: latestRun?.status,
    lastRunMessage: latestRun?.message || undefined,
    totalFiles: perRepo.reduce((sum, r) => sum + r.filesIndexed, 0),
    totalSymbols: perRepo.reduce((sum, r) => sum + r.symbolsIndexed, 0),
  };
};

interface SearchRow {
  repository_id: string;
  file_path: string;
  symbol_name: string;
  kind: string;
  parent_symbol: string | null;
  start_line: number;
  end_line: number;
  signature: string;
  is_exported: boolean;
  sha: string | null;
  indexed_at: string;
}

export const searchCodeSymbols = async (
  capabilityId: string,
  searchQuery: string,
  options: { limit?: number; kind?: CapabilityCodeSymbolKind } = {},
): Promise<CapabilityCodeSymbol[]> => {
  const trimmed = (searchQuery || '').trim();
  if (!trimmed) return [];
  const limit = Math.min(Math.max(options.limit || 25, 1), MAX_SEARCH_LIMIT);
  // Rank: exact match (0) > prefix (1) > contains (2). Ties broken by
  // isExported desc then symbol_name asc so the public API surfaces first.
  const kindFilter = options.kind ? ' AND kind = $4' : '';
  const params: unknown[] = [capabilityId, trimmed, `%${trimmed}%`];
  if (options.kind) params.push(options.kind);
  params.push(limit);

  const result = await query(
    `
      SELECT repository_id, file_path, symbol_name, kind, parent_symbol,
             start_line, end_line, signature, is_exported, sha, indexed_at
      FROM capability_code_symbols
      WHERE capability_id = $1
        AND symbol_name ILIKE $3${kindFilter}
      ORDER BY
        CASE
          WHEN symbol_name = $2 THEN 0
          WHEN symbol_name ILIKE ($2 || '%') THEN 1
          ELSE 2
        END,
        is_exported DESC,
        symbol_name ASC
      LIMIT $${params.length}
    `,
    params,
  );

  // Resolve repository labels in a second pass rather than joining — repo
  // count per capability is always tiny.
  const repositories = await getCapabilityRepositoriesRecord(capabilityId);
  const labelByRepoId = new Map(
    repositories.map(r => [r.id, r.label || r.url || r.id] as const),
  );

  return ((result.rows as SearchRow[]) || []).map(row => ({
    capabilityId,
    repositoryId: row.repository_id,
    repositoryLabel: labelByRepoId.get(row.repository_id),
    filePath: row.file_path,
    symbolName: row.symbol_name,
    kind: row.kind as CapabilityCodeSymbolKind,
    parentSymbol: row.parent_symbol || undefined,
    startLine: row.start_line,
    endLine: row.end_line,
    signature: row.signature,
    isExported: Boolean(row.is_exported),
    sha: row.sha || undefined,
    indexedAt: row.indexed_at,
  }));
};

/**
 * Look up a single symbol by exact (file_path, symbol_name) match, scoped
 * to a capability. Used by `workspace_read` to return semantic hunks
 * (only the function/class body) instead of whole files.
 *
 * Matches either a relative file path or a suffix match so callers can pass
 * `src/foo/bar.ts` even when the index stores `<repoRoot>/src/foo/bar.ts`.
 * Returns the first match (is_exported desc, shortest path first).
 */
export const findSymbolRangeInFile = async (
  capabilityId: string,
  filePath: string,
  symbolName: string,
): Promise<{ startLine: number; endLine: number; kind: string } | null> => {
  const trimmedPath = (filePath || '').trim();
  const trimmedName = (symbolName || '').trim();
  if (!trimmedPath || !trimmedName) return null;

  const result = await query(
    `
      SELECT start_line, end_line, kind, file_path
      FROM capability_code_symbols
      WHERE capability_id = $1
        AND symbol_name = $2
        AND (file_path = $3 OR file_path LIKE $4)
      ORDER BY is_exported DESC, LENGTH(file_path) ASC
      LIMIT 1
    `,
    [capabilityId, trimmedName, trimmedPath, `%/${trimmedPath}`],
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0] as {
    start_line: number;
    end_line: number;
    kind: string;
  };
  return {
    startLine: Number(row.start_line) || 1,
    endLine: Number(row.end_line) || 1,
    kind: String(row.kind || ''),
  };
};

interface NeighborRow {
  from_file: string;
  kind: string;
  to_module: string;
}

export interface FileNeighbor {
  filePath: string;
  refKind: string;
  /** Module specifier for dependencies; empty for dependents. */
  moduleSpecifier?: string;
}

/**
 * Find files that import (or otherwise reference) the given file — i.e.
 * the "callers" in a file-level dependency graph. Because
 * `capability_code_references.to_module` stores the raw import specifier
 * (`"./token"`, `"express"`, `"com.foo.Bar"`) and not a resolved file
 * path, we match by the target's filename stem as a suffix. This is
 * fuzzy — a specifier like `./token` in `src/auth/index.ts` will
 * correctly resolve to `src/auth/token.ts`, but a specifier like `token`
 * could match the wrong repo file. Good enough as a retrieval hint.
 *
 * Used by the Retrieval Bundle (Phase 2 / Lever 6): when the agent asks
 * to read a symbol with `includeCallers > 0`, we surface the top N files
 * that depend on the target file so cross-method invariants stay in
 * scope without forcing the agent to guess.
 */
export const findFileDependents = async (
  capabilityId: string,
  filePath: string,
  limit = 3,
): Promise<FileNeighbor[]> => {
  const trimmed = (filePath || '').trim();
  if (!trimmed) return [];
  // Derive the filename stem — "src/auth/token.ts" → "token". We match on
  // `to_module LIKE '%<stem>%'` which catches both relative and module
  // imports. LIMIT is small by design (max 6 per plan).
  const base = trimmed.split('/').pop() || trimmed;
  const stem = base.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|java)$/i, '');
  if (!stem) return [];

  const cap = Math.min(Math.max(limit, 1), 6);
  const result = await query(
    `
      SELECT DISTINCT from_file, kind, to_module
      FROM capability_code_references
      WHERE capability_id = $1
        AND to_module LIKE $2
        AND from_file <> $3
        AND from_file NOT LIKE $4
      ORDER BY from_file ASC
      LIMIT $5
    `,
    [capabilityId, `%${stem}%`, trimmed, `%/${trimmed}`, cap],
  );

  return ((result.rows as NeighborRow[]) || []).map(row => ({
    filePath: row.from_file,
    refKind: row.kind || 'IMPORTS',
    moduleSpecifier: row.to_module,
  }));
};

/**
 * Find files referenced *by* the given file — i.e. the "callees" in a
 * file-level dependency graph. The raw `to_module` values are import
 * specifiers (e.g. "./utils", "express", "com.foo.Bar"). We attempt to
 * resolve each back to a real indexed file via a suffix match on
 * `capability_code_symbols.file_path`; specifiers that don't resolve
 * (external libraries, stdlib) are dropped.
 */
export const findFileDependencies = async (
  capabilityId: string,
  filePath: string,
  limit = 3,
): Promise<FileNeighbor[]> => {
  const trimmed = (filePath || '').trim();
  if (!trimmed) return [];
  const cap = Math.min(Math.max(limit, 1), 6);

  // Pull the specifiers this file imports.
  const refs = await query(
    `
      SELECT DISTINCT to_module, kind
      FROM capability_code_references
      WHERE capability_id = $1
        AND (from_file = $2 OR from_file LIKE $3)
      ORDER BY to_module ASC
      LIMIT $4
    `,
    [capabilityId, trimmed, `%/${trimmed}`, cap * 3],
  );

  const specifiers = (refs.rows as Array<{ to_module: string; kind: string }>) || [];
  if (specifiers.length === 0) return [];

  // Resolve each specifier by matching its last path segment to an
  // indexed file_path suffix. Stdlib / 3rd-party imports won't resolve
  // and are dropped silently.
  const resolved: FileNeighbor[] = [];
  for (const ref of specifiers) {
    if (resolved.length >= cap) break;
    const spec = (ref.to_module || '').trim();
    if (!spec) continue;
    const segment = spec.split(/[\\/.]/).filter(Boolean).pop();
    if (!segment) continue;
    const match = await query(
      `
        SELECT DISTINCT file_path
        FROM capability_code_symbols
        WHERE capability_id = $1
          AND (
            file_path LIKE $2
            OR file_path LIKE $3
          )
        ORDER BY LENGTH(file_path) ASC
        LIMIT 1
      `,
      [capabilityId, `%/${segment}.%`, `%/${segment}/index.%`],
    );
    const hit = match.rows[0] as { file_path?: string } | undefined;
    if (hit?.file_path && !resolved.some(r => r.filePath === hit.file_path)) {
      resolved.push({
        filePath: hit.file_path,
        refKind: ref.kind || 'IMPORTS',
        moduleSpecifier: spec,
      });
    }
  }
  return resolved;
};

export interface FileExportSummary {
  symbolName: string;
  kind: string;
  signature: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
}

/**
 * Summarize the top exported symbols in a file as compact signature
 * lines. Used by the Retrieval Bundle to describe neighbor files
 * without pulling their full content — the agent sees *what* each
 * neighbor offers and can decide whether to read it.
 */
export const listTopExportsInFile = async (
  capabilityId: string,
  filePath: string,
  limit = 3,
): Promise<FileExportSummary[]> => {
  const trimmed = (filePath || '').trim();
  if (!trimmed) return [];
  const cap = Math.min(Math.max(limit, 1), 8);
  const result = await query(
    `
      SELECT symbol_name, kind, signature, start_line, end_line, is_exported
      FROM capability_code_symbols
      WHERE capability_id = $1
        AND (file_path = $2 OR file_path LIKE $3)
      ORDER BY is_exported DESC, start_line ASC
      LIMIT $4
    `,
    [capabilityId, trimmed, `%/${trimmed}`, cap],
  );

  return ((result.rows as Array<{
    symbol_name: string;
    kind: string;
    signature: string;
    start_line: number;
    end_line: number;
    is_exported: boolean;
  }>) || []).map(row => ({
    symbolName: row.symbol_name,
    kind: String(row.kind || ''),
    signature: String(row.signature || ''),
    startLine: Number(row.start_line) || 1,
    endLine: Number(row.end_line) || 1,
    isExported: Boolean(row.is_exported),
  }));
};
