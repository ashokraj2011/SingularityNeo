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
import { getCapabilityRepositoriesRecord } from '../domains/self-service/repository';
import { detectSourceLanguage } from './parse';
import type {
  ArchLayer,
  BlastRadiusSymbolGraph,
  BlastRadiusSymbolGraphEdge,
  BlastRadiusSymbolGraphNode,
  CapabilityCodeGraph,
  CapabilityCodeIndexRepoSummary,
  CapabilityCodeIndexRunStatus,
  CapabilityCodeIndexSnapshot,
  CapabilityCodeSymbolEdgeKind,
  CapabilityCodeSymbol,
  CapabilityCodeSymbolKind,
  CodeGraphEdge,
  CodeGraphFileNode,
  CodeGraphSymbolNode,
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
  symbol_id: string | null;
  container_symbol_id: string | null;
  symbol_name: string;
  qualified_symbol_name: string | null;
  kind: string;
  language: string | null;
  parent_symbol: string | null;
  start_line: number;
  end_line: number;
  slice_start_line: number | null;
  slice_end_line: number | null;
  signature: string;
  is_exported: boolean;
  sha: string | null;
  indexed_at: string;
}

const buildQualifiedSymbolName = (
  symbolName: string,
  parentSymbol?: string | null,
  qualifiedSymbolName?: string | null,
) => {
  const qualified = String(qualifiedSymbolName || '').trim();
  if (qualified) {
    return qualified;
  }
  const parent = String(parentSymbol || '').trim();
  return parent ? `${parent}.${symbolName}` : symbolName;
};

const buildFallbackSymbolId = ({
  capabilityId,
  repositoryId,
  filePath,
  qualifiedSymbolName,
  kind,
  startLine,
  endLine,
}: {
  capabilityId: string;
  repositoryId: string;
  filePath: string;
  qualifiedSymbolName: string;
  kind: string;
  startLine: number;
  endLine: number;
}) =>
  `LEGACY-${Buffer.from(
    `${capabilityId}:${repositoryId}:${filePath}:${qualifiedSymbolName}:${kind}:${startLine}:${endLine}`,
  )
    .toString('base64')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 20)}`;

const mapCapabilitySymbol = ({
  capabilityId,
  row,
  labelByRepoId,
}: {
  capabilityId: string;
  row: SearchRow;
  labelByRepoId: Map<string, string>;
}): CapabilityCodeSymbol => {
  const qualifiedSymbolName = buildQualifiedSymbolName(
    row.symbol_name,
    row.parent_symbol,
    row.qualified_symbol_name,
  );
  const startLine = Number(row.start_line) || 1;
  const endLine = Number(row.end_line) || startLine;
  return {
    capabilityId,
    repositoryId: row.repository_id,
    repositoryLabel: labelByRepoId.get(row.repository_id),
    filePath: row.file_path,
    symbolId:
      String(row.symbol_id || '').trim() ||
      buildFallbackSymbolId({
        capabilityId,
        repositoryId: row.repository_id,
        filePath: row.file_path,
        qualifiedSymbolName,
        kind: row.kind,
        startLine,
        endLine,
      }),
    containerSymbolId: row.container_symbol_id || undefined,
    symbolName: row.symbol_name,
    qualifiedSymbolName,
    kind: row.kind as CapabilityCodeSymbolKind,
    language: String(row.language || '').trim() || detectSourceLanguage(row.file_path),
    parentSymbol: row.parent_symbol || undefined,
    startLine,
    endLine,
    sliceStartLine: Number(row.slice_start_line) || startLine,
    sliceEndLine: Number(row.slice_end_line) || endLine,
    signature: row.signature,
    isExported: Boolean(row.is_exported),
    sha: row.sha || undefined,
    indexedAt: row.indexed_at,
  };
};

export const searchCodeSymbols = async (
  capabilityId: string,
  searchQuery: string,
  options: {
    limit?: number;
    kind?: CapabilityCodeSymbolKind;
    repositoryId?: string;
    nearFilePath?: string;
  } = {},
): Promise<CapabilityCodeSymbol[]> => {
  const trimmed = (searchQuery || '').trim();
  if (!trimmed) return [];
  const limit = Math.min(Math.max(options.limit || 25, 1), MAX_SEARCH_LIMIT);
  const qualifiedExpr = `
    COALESCE(
      NULLIF(qualified_symbol_name, ''),
      CASE
        WHEN parent_symbol IS NOT NULL AND parent_symbol <> ''
          THEN parent_symbol || '.' || symbol_name
        ELSE symbol_name
      END
    )
  `;
  const lowerTrimmed = trimmed.toLowerCase();
  const prefixPattern = `${trimmed}%`;
  const containsPattern = `%${trimmed}%`;
  const pathSegments = String(options.nearFilePath || '')
    .split('/')
    .filter(Boolean);
  const nearDirectoryPattern =
    pathSegments.length > 1 ? `%/${pathSegments.slice(0, -1).join('/')}/%` : '';

  const filters = ['capability_id = $1', `(${qualifiedExpr} ILIKE $3 OR symbol_name ILIKE $3)`];
  const params: unknown[] = [capabilityId, lowerTrimmed, containsPattern];
  let parameterIndex = params.length;
  if (options.kind) {
    parameterIndex += 1;
    filters.push(`kind = $${parameterIndex}`);
    params.push(options.kind);
  }

  let repositoryRankClause = '0';
  if (options.repositoryId) {
    parameterIndex += 1;
    params.push(options.repositoryId);
    repositoryRankClause = `CASE WHEN repository_id = $${parameterIndex} THEN 0 ELSE 1 END`;
  }

  let pathRankClause = '0';
  if (options.nearFilePath) {
    parameterIndex += 1;
    params.push(options.nearFilePath);
    const exactPathIndex = parameterIndex;
    if (nearDirectoryPattern) {
      parameterIndex += 1;
      params.push(nearDirectoryPattern);
      pathRankClause = `
        CASE
          WHEN file_path = $${exactPathIndex} OR file_path LIKE ('%/' || $${exactPathIndex}) THEN 0
          WHEN file_path LIKE $${parameterIndex} THEN 1
          ELSE 2
        END
      `;
    } else {
      pathRankClause = `
        CASE
          WHEN file_path = $${exactPathIndex} OR file_path LIKE ('%/' || $${exactPathIndex}) THEN 0
          ELSE 1
        END
      `;
    }
  }

  parameterIndex += 1;
  params.push(prefixPattern);
  const prefixIndex = parameterIndex;
  parameterIndex += 1;
  params.push(limit);

  const result = await query(
    `
      SELECT repository_id, file_path, symbol_id, container_symbol_id,
             symbol_name, qualified_symbol_name, kind, language, parent_symbol,
             start_line, end_line, slice_start_line, slice_end_line,
             signature, is_exported, sha, indexed_at
      FROM capability_code_symbols
      WHERE ${filters.join('\n        AND ')}
      ORDER BY
        CASE
          WHEN LOWER(${qualifiedExpr}) = $2 THEN 0
          WHEN LOWER(symbol_name) = $2 THEN 1
          WHEN ${qualifiedExpr} ILIKE $${prefixIndex} THEN 2
          WHEN symbol_name ILIKE $${prefixIndex} THEN 3
          WHEN ${qualifiedExpr} ILIKE $3 THEN 4
          ELSE 5
        END,
        CASE WHEN is_exported THEN 0 ELSE 1 END,
        ${repositoryRankClause},
        ${pathRankClause},
        LENGTH(file_path) ASC,
        symbol_name ASC
      LIMIT $${parameterIndex}
    `,
    params,
  );

  // Resolve repository labels in a second pass rather than joining — repo
  // count per capability is always tiny.
  const repositories = await getCapabilityRepositoriesRecord(capabilityId);
  const labelByRepoId = new Map(
    repositories.map(r => [r.id, r.label || r.url || r.id] as const),
  );

  return ((result.rows as SearchRow[]) || []).map(row =>
    mapCapabilitySymbol({
      capabilityId,
      row,
      labelByRepoId,
    }),
  );
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
): Promise<{
  symbolId?: string;
  containerSymbolId?: string;
  qualifiedSymbolName?: string;
  startLine: number;
  endLine: number;
  sliceStartLine: number;
  sliceEndLine: number;
  kind: string;
} | null> => {
  const trimmedPath = (filePath || '').trim();
  const trimmedName = (symbolName || '').trim();
  if (!trimmedPath || !trimmedName) return null;

  const result = await query(
    `
      SELECT symbol_id, container_symbol_id, symbol_name, qualified_symbol_name,
             parent_symbol, start_line, end_line, slice_start_line, slice_end_line,
             kind, file_path
      FROM capability_code_symbols
      WHERE capability_id = $1
        AND (
          symbol_name = $2
          OR COALESCE(
            NULLIF(qualified_symbol_name, ''),
            CASE
              WHEN parent_symbol IS NOT NULL AND parent_symbol <> ''
                THEN parent_symbol || '.' || symbol_name
              ELSE symbol_name
            END
          ) = $2
        )
        AND (file_path = $3 OR file_path LIKE $4)
      ORDER BY
        CASE WHEN file_path = $3 THEN 0 ELSE 1 END,
        is_exported DESC,
        LENGTH(file_path) ASC
      LIMIT 1
    `,
    [capabilityId, trimmedName, trimmedPath, `%/${trimmedPath}`],
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0] as {
    symbol_id?: string | null;
    container_symbol_id?: string | null;
    symbol_name: string;
    qualified_symbol_name?: string | null;
    parent_symbol?: string | null;
    start_line: number;
    end_line: number;
    slice_start_line?: number | null;
    slice_end_line?: number | null;
    kind: string;
  };
  const startLine = Number(row.start_line) || 1;
  const endLine = Number(row.end_line) || startLine;
  return {
    symbolId: row.symbol_id || undefined,
    containerSymbolId: row.container_symbol_id || undefined,
    qualifiedSymbolName: buildQualifiedSymbolName(
      row.symbol_name,
      row.parent_symbol,
      row.qualified_symbol_name,
    ),
    startLine,
    endLine,
    sliceStartLine: Number(row.slice_start_line) || startLine,
    sliceEndLine: Number(row.slice_end_line) || endLine,
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

interface BlastGraphRow extends SearchRow {
  root_symbol_id: string;
  depth: number;
  relation: BlastRadiusSymbolGraphNode['relation'];
}

interface BlastGraphEdgeRow {
  repository_id: string;
  from_symbol_id: string;
  to_symbol_id: string;
  from_file_path: string;
  to_file_path: string;
  edge_kind: CapabilityCodeSymbolEdgeKind;
  from_symbol_name: string | null;
  to_symbol_name: string | null;
  from_qualified_symbol_name: string | null;
  to_qualified_symbol_name: string | null;
}

const BLAST_GRAPH_SEED_LIMIT = 8;
const BLAST_GRAPH_DEPTH_CAP = 5;
const BLAST_GRAPH_NODE_CAP = 80;

export const readBlastRadiusSymbolGraph = async (
  capabilityId: string,
  options: {
    filePath?: string;
    symbolId?: string;
    maxDepth?: number;
    maxNodes?: number;
  },
): Promise<BlastRadiusSymbolGraph> => {
  const symbolId = String(options.symbolId || '').trim();
  const filePath = String(options.filePath || '').trim();
  const maxDepth = Math.min(Math.max(Number(options.maxDepth) || 2, 1), BLAST_GRAPH_DEPTH_CAP);
  const maxNodes = Math.min(Math.max(Number(options.maxNodes) || 40, 1), BLAST_GRAPH_NODE_CAP);

  if (!symbolId && !filePath) {
    return {
      capabilityId,
      seedSymbolIds: [],
      maxDepth,
      totalNodes: 0,
      nodes: [],
      edges: [],
      analyzedAt: new Date().toISOString(),
    };
  }

  const repositories = await getCapabilityRepositoriesRecord(capabilityId);
  const labelByRepoId = new Map(
    repositories.map(repository => [repository.id, repository.label || repository.url || repository.id] as const),
  );

  const nodeResult = await query<BlastGraphRow>(
    `
      WITH RECURSIVE seed_symbols AS (
        SELECT
          symbol_id,
          repository_id,
          file_path,
          symbol_name,
          qualified_symbol_name,
          start_line,
          is_exported,
          container_symbol_id
        FROM capability_code_symbols
        WHERE capability_id = $1
          AND (
            ($2::text <> '' AND symbol_id = $2)
            OR (
              $2::text = ''
              AND $3::text <> ''
              AND (file_path = $3 OR file_path LIKE $4)
              AND (is_exported = TRUE OR container_symbol_id IS NULL)
            )
          )
        ORDER BY
          is_exported DESC,
          CASE WHEN container_symbol_id IS NULL THEN 0 ELSE 1 END,
          start_line ASC,
          symbol_name ASC
        LIMIT $5
      ),
      walk AS (
        SELECT
          symbol_id,
          symbol_id AS root_symbol_id,
          0 AS depth,
          'SEED'::text AS relation,
          ARRAY[symbol_id]::text[] AS path_ids
        FROM seed_symbols
        UNION ALL
        SELECT
          CASE
            WHEN edge.from_symbol_id = walk.symbol_id THEN edge.to_symbol_id
            ELSE edge.from_symbol_id
          END AS symbol_id,
          walk.root_symbol_id,
          walk.depth + 1 AS depth,
          CASE
            WHEN edge.edge_kind = 'CONTAINS' AND edge.from_symbol_id = walk.symbol_id
              THEN 'DESCENDANT'
            WHEN edge.edge_kind = 'CONTAINS' AND edge.to_symbol_id = walk.symbol_id
              THEN 'ANCESTOR'
            ELSE 'DESCENDANT'
          END AS relation,
          walk.path_ids || CASE
            WHEN edge.from_symbol_id = walk.symbol_id THEN edge.to_symbol_id
            ELSE edge.from_symbol_id
          END AS path_ids
        FROM walk
        JOIN capability_code_symbol_edges AS edge
          ON edge.capability_id = $1
         AND (edge.from_symbol_id = walk.symbol_id OR edge.to_symbol_id = walk.symbol_id)
        WHERE walk.depth < $6
          AND NOT (
            CASE
              WHEN edge.from_symbol_id = walk.symbol_id THEN edge.to_symbol_id
              ELSE edge.from_symbol_id
            END = ANY(walk.path_ids)
          )
      ),
      ranked AS (
        SELECT
          walk.*,
          ROW_NUMBER() OVER (
            PARTITION BY walk.symbol_id
            ORDER BY
              walk.depth ASC,
              CASE walk.relation
                WHEN 'SEED' THEN 0
                WHEN 'ANCESTOR' THEN 1
                ELSE 2
              END ASC,
              walk.root_symbol_id ASC
          ) AS rn
        FROM walk
      )
      SELECT
        symbol.repository_id,
        symbol.file_path,
        symbol.symbol_id,
        symbol.container_symbol_id,
        symbol.symbol_name,
        symbol.qualified_symbol_name,
        symbol.kind,
        symbol.language,
        symbol.parent_symbol,
        symbol.start_line,
        symbol.end_line,
        symbol.slice_start_line,
        symbol.slice_end_line,
        symbol.signature,
        symbol.is_exported,
        symbol.sha,
        symbol.indexed_at,
        ranked.root_symbol_id,
        ranked.depth,
        ranked.relation
      FROM ranked
      JOIN capability_code_symbols AS symbol
        ON symbol.capability_id = $1
       AND symbol.symbol_id = ranked.symbol_id
      WHERE ranked.rn = 1
      ORDER BY
        CASE ranked.relation
          WHEN 'SEED' THEN 0
          WHEN 'ANCESTOR' THEN 1
          ELSE 2
        END ASC,
        ranked.depth ASC,
        symbol.file_path ASC,
        symbol.start_line ASC
      LIMIT $7
    `,
    [
      capabilityId,
      symbolId,
      filePath,
      `%/${filePath}`,
      BLAST_GRAPH_SEED_LIMIT,
      maxDepth,
      maxNodes,
    ],
  );

  const rows = (nodeResult.rows as BlastGraphRow[]) || [];
  const nodes: BlastRadiusSymbolGraphNode[] = rows.map(row => ({
    ...mapCapabilitySymbol({
      capabilityId,
      row,
      labelByRepoId,
    }),
    rootSymbolId: row.root_symbol_id,
    relation: row.relation,
    depth: Number(row.depth) || 0,
  }));

  const nodeIds = nodes.map(node => node.symbolId);
  const seedSymbolIds = nodes
    .filter(node => node.relation === 'SEED')
    .map(node => node.symbolId);

  const edgeResult =
    nodeIds.length > 0
      ? await query<BlastGraphEdgeRow>(
          `
            SELECT
              edge.repository_id,
              edge.from_symbol_id,
              edge.to_symbol_id,
              edge.from_file_path,
              edge.to_file_path,
              edge.edge_kind,
              from_symbol.symbol_name AS from_symbol_name,
              to_symbol.symbol_name AS to_symbol_name,
              COALESCE(from_symbol.qualified_symbol_name, from_symbol.symbol_name) AS from_qualified_symbol_name,
              COALESCE(to_symbol.qualified_symbol_name, to_symbol.symbol_name) AS to_qualified_symbol_name
            FROM capability_code_symbol_edges AS edge
            LEFT JOIN capability_code_symbols AS from_symbol
              ON from_symbol.capability_id = edge.capability_id
             AND from_symbol.symbol_id = edge.from_symbol_id
            LEFT JOIN capability_code_symbols AS to_symbol
              ON to_symbol.capability_id = edge.capability_id
             AND to_symbol.symbol_id = edge.to_symbol_id
            WHERE edge.capability_id = $1
              AND edge.from_symbol_id = ANY($2::text[])
              AND edge.to_symbol_id = ANY($2::text[])
            ORDER BY edge.from_file_path ASC, edge.to_file_path ASC, edge.from_symbol_id ASC
          `,
          [capabilityId, nodeIds],
        )
      : { rows: [] as BlastGraphEdgeRow[] };

  const edges: BlastRadiusSymbolGraphEdge[] = ((edgeResult.rows as BlastGraphEdgeRow[]) || []).map(
    row => ({
      capabilityId,
      repositoryId: row.repository_id,
      fromSymbolId: row.from_symbol_id,
      toSymbolId: row.to_symbol_id,
      fromFilePath: row.from_file_path,
      toFilePath: row.to_file_path,
      edgeKind: row.edge_kind,
      fromSymbolName: row.from_symbol_name || undefined,
      toSymbolName: row.to_symbol_name || undefined,
      fromQualifiedSymbolName: row.from_qualified_symbol_name || undefined,
      toQualifiedSymbolName: row.to_qualified_symbol_name || undefined,
    }),
  );

  return {
    capabilityId,
    filePath: filePath || undefined,
    symbolId: symbolId || undefined,
    seedSymbolIds,
    maxDepth,
    totalNodes: nodes.length,
    nodes,
    edges,
    analyzedAt: new Date().toISOString(),
  };
};

// ─── Symbol AST context ────────────────────────────────────────────────────────

export interface AstSymbolEntry {
  symbolId: string;
  symbolName: string;
  kind: string;
  signature: string;
  startLine: number;
  endLine: number;
}

export interface SymbolAstContext {
  /** The container symbol (parent class / module) of the focal symbol, if any. */
  parent: { symbolId: string; symbolName: string; kind: string } | null;
  /** Symbols that the focal symbol directly contains (e.g. methods of a class). */
  children: AstSymbolEntry[];
  /** Sibling symbols that share the same container as the focal symbol. */
  siblings: AstSymbolEntry[];
}

/**
 * Fetch the real structural context of a symbol from the code index:
 *   parent  — the container symbol (e.g. the class that owns a method)
 *   children — symbols contained within this symbol (e.g. methods of a class)
 *   siblings — other symbols that share the same parent container
 *
 * All data comes from `capability_code_symbols` — no AST parser needed at
 * runtime, the indexer already recorded containment relationships.
 */
export const getSymbolAstContext = async (
  capabilityId: string,
  symbolId: string,
): Promise<SymbolAstContext> => {
  // ── 1. Focal symbol row (need containerSymbolId) ────────────────────────────
  const focalRes = await query<{ container_symbol_id: string | null }>(
    `SELECT container_symbol_id
       FROM capability_code_symbols
      WHERE capability_id = $1 AND symbol_id = $2
      LIMIT 1`,
    [capabilityId, symbolId],
  );
  const containerSymbolId = focalRes.rows[0]?.container_symbol_id ?? null;

  // ── 2. Parent ────────────────────────────────────────────────────────────────
  let parent: SymbolAstContext['parent'] = null;
  if (containerSymbolId) {
    const parentRes = await query<{ symbol_id: string; symbol_name: string; kind: string }>(
      `SELECT symbol_id, symbol_name, kind
         FROM capability_code_symbols
        WHERE capability_id = $1 AND symbol_id = $2
        LIMIT 1`,
      [capabilityId, containerSymbolId],
    );
    const p = parentRes.rows[0];
    if (p) parent = { symbolId: p.symbol_id, symbolName: p.symbol_name, kind: p.kind };
  }

  // ── 3. Children (symbols whose container_symbol_id = focal symbolId) ─────────
  const childRes = await query<{
    symbol_id: string; symbol_name: string; kind: string;
    signature: string | null; start_line: number; end_line: number;
  }>(
    `SELECT symbol_id, symbol_name, kind, signature, start_line, end_line
       FROM capability_code_symbols
      WHERE capability_id = $1 AND container_symbol_id = $2
      ORDER BY start_line ASC
      LIMIT 40`,
    [capabilityId, symbolId],
  );
  const children: AstSymbolEntry[] = childRes.rows.map(r => ({
    symbolId:   r.symbol_id,
    symbolName: r.symbol_name,
    kind:       r.kind,
    signature:  r.signature ?? '',
    startLine:  Number(r.start_line) || 0,
    endLine:    Number(r.end_line)   || 0,
  }));

  // ── 4. Siblings (same container, excluding focal itself) ─────────────────────
  let siblings: AstSymbolEntry[] = [];
  if (containerSymbolId) {
    const sibRes = await query<{
      symbol_id: string; symbol_name: string; kind: string;
      signature: string | null; start_line: number; end_line: number;
    }>(
      `SELECT symbol_id, symbol_name, kind, signature, start_line, end_line
         FROM capability_code_symbols
        WHERE capability_id = $1
          AND container_symbol_id = $2
          AND symbol_id != $3
        ORDER BY start_line ASC
        LIMIT 30`,
      [capabilityId, containerSymbolId, symbolId],
    );
    siblings = sibRes.rows.map(r => ({
      symbolId:   r.symbol_id,
      symbolName: r.symbol_name,
      kind:       r.kind,
      signature:  r.signature ?? '',
      startLine:  Number(r.start_line) || 0,
      endLine:    Number(r.end_line)   || 0,
    }));
  }

  return { parent, children, siblings };
};

// ─── Code Graph ───────────────────────────────────────────────────────────────

const ENDPOINT_FILE_RE = /\/(route|controller|handler|api|endpoint|servlet|resource|rest|webhook|router)s?\./i;
const ENDPOINT_SYMBOL_NAME_RE = /^(get|post|put|patch|delete|head|handle)[A-Z]|Controller$|Resource$|Route$|Endpoint$|Resolver$/;
const ENDPOINT_SIGNATURE_RE =
  /@(Get|Post|Put|Patch|Delete|RequestMapping|Route|RestController|Controller|WebMvcConfigurer)\b|app\.(get|post|put|patch|delete)\s*\(|router\.(get|post|put|patch|delete)\s*\(/;

const isEndpointFile = (filePath: string) => ENDPOINT_FILE_RE.test(filePath);
const isEndpointSymbol = (name: string, sig: string) =>
  ENDPOINT_SYMBOL_NAME_RE.test(name) || ENDPOINT_SIGNATURE_RE.test(sig);

// Pick the candidate whose path has the most segments in common with target
const pickBestPathMatch = (target: string, candidates: string[]): string => {
  if (candidates.length === 1) return candidates[0];
  const tParts = target.toLowerCase().split('/');
  let best = candidates[0], bestScore = -1;
  for (const c of candidates) {
    const cParts = c.toLowerCase().split('/');
    let score = 0;
    for (const p of tParts) { if (cParts.includes(p)) score++; }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
};

const detectArchLayer = (fp: string): ArchLayer => {
  const f = fp.toLowerCase();
  if (/\/(routes?|routers?|endpoints?)\//i.test(f) || /[./](routes?|router|endpoint)\.[a-z]+$/.test(f)) return 'route';
  if (/\/(controllers?|handlers?)\//i.test(f) || /[./](controller|handler)\.[a-z]+$/.test(f)) return 'controller';
  if (/\/(services?|managers?|providers?|usecases?)\//i.test(f) || /[./](service|manager|provider|usecase)\.[a-z]+$/.test(f)) return 'service';
  if (/\/(repositories?|repos?|daos?|stores?)\//i.test(f) || /[./](repository|repo|dao|store)\.[a-z]+$/.test(f)) return 'repository';
  if (/\/(models?|entities?|schemas?|domain|dtos?)\//i.test(f) || /[./](model|entity|schema|dto)\.[a-z]+$/.test(f)) return 'model';
  if (/\/(utils?|helpers?|lib|shared|common)\//i.test(f) || /[./](util|utils|helper|helpers)\.[a-z]+$/.test(f)) return 'util';
  return 'other';
};

const extractHttpMethod = (name: string, sig: string): string | undefined => {
  if (/@(Get|GetMapping)\b/.test(sig))    return 'GET';
  if (/@(Post|PostMapping)\b/.test(sig))  return 'POST';
  if (/@(Put|PutMapping)\b/.test(sig))    return 'PUT';
  if (/@(Patch|PatchMapping)\b/.test(sig)) return 'PATCH';
  if (/@(Delete|DeleteMapping)\b/.test(sig)) return 'DELETE';
  if (/(?:app|router)\.get\s*\(/.test(sig))    return 'GET';
  if (/(?:app|router)\.post\s*\(/.test(sig))   return 'POST';
  if (/(?:app|router)\.put\s*\(/.test(sig))    return 'PUT';
  if (/(?:app|router)\.patch\s*\(/.test(sig))  return 'PATCH';
  if (/(?:app|router)\.delete\s*\(/.test(sig)) return 'DELETE';
  return undefined;
};

/**
 * Build a lightweight code graph for visualization — file nodes, top-level
 * symbol nodes, and their import / containment edges.
 *
 * Used by the CodeGraph visualization page (`/code-graph`).
 */
export const getCapabilityCodeGraph = async (
  capabilityId: string,
  options: { maxFiles?: number; maxSymbols?: number } = {},
): Promise<CapabilityCodeGraph> => {
  const maxFiles  = Math.min(Math.max(options.maxFiles  ?? 120, 10), 200);
  const maxSymbols = Math.min(Math.max(options.maxSymbols ?? 280, 10), 500);

  const repositories = await getCapabilityRepositoriesRecord(capabilityId);
  const labelByRepoId = new Map(repositories.map(r => [r.id, r.label || r.url || r.id] as const));

  // 1. Top files by symbol count
  const fileRows = await query(`
    SELECT file_path, repository_id, COUNT(*) AS symbol_count, MAX(language) AS language
    FROM capability_code_symbols
    WHERE capability_id = $1
    GROUP BY file_path, repository_id
    ORDER BY symbol_count DESC
    LIMIT $2
  `, [capabilityId, maxFiles]);

  const fileList = (fileRows.rows as Array<{
    file_path: string; repository_id: string; symbol_count: string; language: string | null;
  }>).map(r => ({
    filePath: r.file_path,
    repositoryId: r.repository_id,
    symbolCount: Number(r.symbol_count) || 0,
    language: String(r.language || '').trim() || detectSourceLanguage(r.file_path),
  }));

  const filePaths  = fileList.map(f => f.filePath);
  const filePathSet = new Set(filePaths);

  // Build basename → [filePaths] for O(1) resolution
  const basenameToFiles = new Map<string, string[]>();
  for (const fp of filePaths) {
    const base = (fp.split('/').pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase();
    if (base.length >= 2) {
      const arr = basenameToFiles.get(base) ?? [];
      arr.push(fp);
      basenameToFiles.set(base, arr);
    }
  }

  // 2. Top-level symbols
  const symRows = await query(`
    SELECT repository_id, file_path, symbol_id, container_symbol_id,
           symbol_name, qualified_symbol_name, kind, language,
           parent_symbol, start_line, signature, is_exported
    FROM capability_code_symbols
    WHERE capability_id = $1
      AND file_path = ANY($2::text[])
      AND (
        is_exported = TRUE
        OR kind IN ('class', 'interface', 'type', 'enum', 'function')
        OR container_symbol_id IS NULL
      )
    ORDER BY CASE WHEN is_exported THEN 0 ELSE 1 END, start_line ASC
    LIMIT $3
  `, [capabilityId, filePaths, maxSymbols]);

  interface SymRow {
    repository_id: string; file_path: string; symbol_id: string | null;
    container_symbol_id: string | null; symbol_name: string;
    qualified_symbol_name: string | null; kind: string; language: string | null;
    parent_symbol: string | null; start_line: number; signature: string;
    is_exported: boolean;
  }

  const symbolIds: string[] = [];
  const symbolNodes: CodeGraphSymbolNode[] = [];

  for (const r of (symRows.rows as SymRow[]) ?? []) {
    const qualified = String(r.qualified_symbol_name || r.symbol_name || '').trim();
    const sig  = String(r.signature || '').trim();
    const name = String(r.symbol_name || '').trim();
    const sid  = String(r.symbol_id || '').trim() || `${r.file_path}#${name}`;
    symbolIds.push(sid);
    const rawKind = r.kind as CapabilityCodeSymbolKind;
    const isEp    = isEndpointSymbol(name, sig) || isEndpointFile(r.file_path);
    symbolNodes.push({
      id: sid,
      kind: isEp ? 'endpoint' : rawKind,
      label: name,
      qualifiedName: qualified,
      filePath: r.file_path,
      repositoryId: r.repository_id,
      startLine: Number(r.start_line) || 1,
      signature: sig.slice(0, 180),
      isExported: Boolean(r.is_exported),
      language: String(r.language || '').trim() || detectSourceLanguage(r.file_path),
      containerSymbolId: r.container_symbol_id || undefined,
      isEndpoint: isEp,
      httpMethod: isEp ? extractHttpMethod(name, sig) : undefined,
    });
  }

  // 3. Robust file import edges
  // Do NOT filter by from_file in SQL — paths may differ between tables.
  // Resolve both from_file and to_module via basename matching in JS.
  const refRows = await query(`
    SELECT DISTINCT from_file, to_module
    FROM capability_code_references
    WHERE capability_id = $1
    LIMIT 5000
  `, [capabilityId]);

  const fileEdges: CodeGraphEdge[]   = [];
  const seenFileEdges = new Set<string>();

  for (const ref of (refRows.rows as Array<{ from_file: string; to_module: string }>) ?? []) {
    const rawFrom = String(ref.from_file ?? '').trim();
    const spec    = String(ref.to_module  ?? '').trim();
    if (!rawFrom || !spec) continue;

    // Resolve from_file → nodeId (exact first, then basename fallback)
    let fromId = rawFrom;
    if (!filePathSet.has(fromId)) {
      const fromBase = (rawFrom.split('/').pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase();
      const cands = basenameToFiles.get(fromBase) ?? [];
      if (cands.length === 0) continue;
      fromId = pickBestPathMatch(rawFrom, cands);
      if (!filePathSet.has(fromId)) continue;
    }

    // Resolve to_module → nodeId
    const toSeg = (spec.split(/[/\\]/).pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase();
    if (toSeg.length < 2) continue;
    const toMatches = basenameToFiles.get(toSeg) ?? [];
    if (toMatches.length === 0) continue;
    const toId = toMatches.length === 1 ? toMatches[0] : pickBestPathMatch(spec, toMatches);
    if (toId === fromId) continue;

    const edgeId = `${fromId}→${toId}`;
    if (seenFileEdges.has(edgeId)) continue;
    seenFileEdges.add(edgeId);
    fileEdges.push({ id: edgeId, from: fromId, to: toId, kind: 'imports' });
  }

  // 4. Symbol containment edges
  const symbolEdges: CodeGraphEdge[] = [];
  if (symbolIds.length > 0) {
    const edgeRows = await query(`
      SELECT from_symbol_id, to_symbol_id, edge_kind
      FROM capability_code_symbol_edges
      WHERE capability_id = $1
        AND from_symbol_id = ANY($2::text[])
        AND to_symbol_id   = ANY($2::text[])
      LIMIT 500
    `, [capabilityId, symbolIds]);
    for (const r of (edgeRows.rows as Array<{
      from_symbol_id: string; to_symbol_id: string; edge_kind: string;
    }>) ?? []) {
      symbolEdges.push({
        id: `${r.from_symbol_id}→${r.to_symbol_id}`,
        from: r.from_symbol_id,
        to: r.to_symbol_id,
        kind: 'contains',
      });
    }
  }

  // 5. Build file nodes with layer
  const fileNodes: CodeGraphFileNode[] = fileList.map(f => ({
    id: f.filePath,
    kind: 'file' as const,
    label: f.filePath.split('/').pop() || f.filePath,
    filePath: f.filePath,
    repositoryId: f.repositoryId,
    repositoryLabel: labelByRepoId.get(f.repositoryId),
    language: f.language,
    symbolCount: f.symbolCount,
    isEndpoint: isEndpointFile(f.filePath),
    layer: detectArchLayer(f.filePath),
  }));

  return { capabilityId, generatedAt: new Date().toISOString(), fileNodes, symbolNodes, fileEdges, symbolEdges };
};
