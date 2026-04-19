/**
 * Provenance extractor — Slice 4.
 *
 * Pure, synchronous function that normalizes the `request` JSONB of a tool
 * invocation into a `touched_paths TEXT[]` for GIN-indexed containment
 * queries. The extractor runs at write-time inside `createToolInvocation`
 * and during the 90-day backfill; both code paths must produce identical
 * output for a given (toolId, request) pair.
 *
 * Extractor contract:
 *   - Returns `[]` for tools with no filesystem surface (e.g. `run_test`).
 *   - Returns `null` for tools we have NOT mapped, so the caller can emit
 *     a `governance.provenance_unmapped_tool` telemetry metric and we can
 *     catch drift. A null extractor result must NOT be confused with an
 *     empty-array "no paths touched" result.
 *   - Normalizes path strings to forward slashes and strips leading `./`
 *     so `./src/foo.ts`, `src/foo.ts` and `SRC/FOO.ts` never accidentally
 *     evade a glob probe because of punctuation.
 *   - Never throws on malformed request blobs — a missing/wrong-shape
 *     field returns `[]` from that branch and the extractor keeps going.
 *     Throwing inside write-side extraction would mask real bugs behind
 *     a lost invocation row.
 */

export type ExtractorResult = string[] | null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const normalizePath = (raw: unknown): string | null => {
  if (!isNonEmptyString(raw)) return null;
  let path = raw.replace(/\\/g, '/').trim();
  while (path.startsWith('./')) path = path.slice(2);
  if (!path) return null;
  return path;
};

const pushPath = (bucket: Set<string>, raw: unknown) => {
  const norm = normalizePath(raw);
  if (norm) bucket.add(norm);
};

const collectFromArray = (bucket: Set<string>, arr: unknown) => {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (isNonEmptyString(item)) pushPath(bucket, item);
    else if (item && typeof item === 'object') {
      const maybePath = (item as Record<string, unknown>).path;
      if (isNonEmptyString(maybePath)) pushPath(bucket, maybePath);
    }
  }
};

// ─── Per-tool handlers ────────────────────────────────────────────────────

const fromWorkspaceWrite = (req: Record<string, unknown>): string[] => {
  const out = new Set<string>();
  pushPath(out, req.path);
  pushPath(out, (req as any).target);
  pushPath(out, (req as any).file);
  return Array.from(out);
};

const fromWorkspaceApplyPatch = (req: Record<string, unknown>): string[] => {
  const out = new Set<string>();
  const diff = (req as any).diff;
  if (diff && typeof diff === 'object') {
    collectFromArray(out, (diff as any).files);
  }
  collectFromArray(out, (req as any).paths);
  pushPath(out, (req as any).path);
  return Array.from(out);
};

const fromWorkspaceReplaceBlock = (req: Record<string, unknown>): string[] => {
  const out = new Set<string>();
  pushPath(out, (req as any).path);
  pushPath(out, (req as any).target);
  return Array.from(out);
};

const fromRunDeploy = (req: Record<string, unknown>): string[] => {
  const out = new Set<string>();
  collectFromArray(out, (req as any).targets);
  collectFromArray(out, (req as any).paths);
  pushPath(out, (req as any).target);
  return Array.from(out);
};

const fromWorkspaceRead = (req: Record<string, unknown>): string[] => {
  // Reads don't mutate the workspace — their prove-the-negative signal is
  // "was this file read by an AI?" which some auditors do care about, so
  // we still record the path.
  const out = new Set<string>();
  pushPath(out, (req as any).path);
  collectFromArray(out, (req as any).paths);
  return Array.from(out);
};

// Tools that explicitly have no filesystem surface — map to []
// so we don't trigger the "unmapped tool" telemetry.
const FILESYSTEM_INERT_TOOLS = new Set<string>([
  'run_build',
  'run_test',
  'run_docs',
  'web_fetch',
  'web_search',
]);

const EXTRACTORS: Record<string, (req: Record<string, unknown>) => string[]> = {
  workspace_write: fromWorkspaceWrite,
  workspace_apply_patch: fromWorkspaceApplyPatch,
  workspace_replace_block: fromWorkspaceReplaceBlock,
  workspace_read: fromWorkspaceRead,
  run_deploy: fromRunDeploy,
};

// ─── Public API ───────────────────────────────────────────────────────────

export const extractTouchedPaths = (
  toolId: string,
  request: unknown,
): ExtractorResult => {
  if (!toolId) return null;
  if (FILESYSTEM_INERT_TOOLS.has(toolId)) return [];
  const extractor = EXTRACTORS[toolId];
  if (!extractor) return null;

  const req: Record<string, unknown> =
    request && typeof request === 'object' && !Array.isArray(request)
      ? (request as Record<string, unknown>)
      : {};

  try {
    return extractor(req);
  } catch {
    // Write-side extraction must never throw — fall back to no paths so
    // the invocation row still lands. The coverage window + actor_kind
    // still keep the audit trail honest.
    return [];
  }
};

export const isMappedProvenanceTool = (toolId: string): boolean =>
  toolId in EXTRACTORS || FILESYSTEM_INERT_TOOLS.has(toolId);
