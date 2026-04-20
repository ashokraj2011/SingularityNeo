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
