#!/usr/bin/env node
/**
 * Slice 4 — one-shot backfill for capability_tool_invocations.touched_paths.
 *
 * Walks the last 90 days (configurable via BACKFILL_DAYS) of tool
 * invocations, applies the per-tool extractor to each `request` JSONB, and
 * updates `touched_paths` in place. Commits every 500 rows so a crash
 * halfway through doesn't strand a partial transaction.
 *
 * Also writes one `governance_provenance_coverage` row spanning the
 * earliest → latest observed `started_at` so the prove-no-touch query
 * surface can cite the exact window it's confident about.
 *
 * Re-running is safe: rows whose extracted paths equal the current column
 * value are skipped.
 *
 * Usage:
 *   node scripts/governance-backfill-provenance.mjs
 *   BACKFILL_DAYS=30 node scripts/governance-backfill-provenance.mjs
 *
 * The extractor logic lives in server/governance/provenanceExtractor.ts
 * (TS) — we reimplement it here in plain JS so this script doesn't require
 * a build step. Keep the two in sync when adding new tools.
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Extractor (mirror of server/governance/provenanceExtractor.ts) ────

const FILESYSTEM_INERT_TOOLS = new Set([
  'run_build',
  'run_test',
  'run_docs',
  'web_fetch',
  'web_search',
]);

const normalizePath = raw => {
  if (typeof raw !== 'string' || !raw.length) return null;
  let p = raw.replace(/\\/g, '/').trim();
  while (p.startsWith('./')) p = p.slice(2);
  return p || null;
};

const pushPath = (bucket, raw) => {
  const n = normalizePath(raw);
  if (n) bucket.add(n);
};

const collectFromArray = (bucket, arr) => {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (typeof item === 'string') pushPath(bucket, item);
    else if (item && typeof item === 'object' && typeof item.path === 'string') {
      pushPath(bucket, item.path);
    }
  }
};

const EXTRACTORS = {
  workspace_write: req => {
    const out = new Set();
    pushPath(out, req.path);
    pushPath(out, req.target);
    pushPath(out, req.file);
    return [...out];
  },
  workspace_apply_patch: req => {
    const out = new Set();
    if (req.diff && typeof req.diff === 'object') collectFromArray(out, req.diff.files);
    collectFromArray(out, req.paths);
    pushPath(out, req.path);
    return [...out];
  },
  workspace_replace_block: req => {
    const out = new Set();
    pushPath(out, req.path);
    pushPath(out, req.target);
    return [...out];
  },
  workspace_read: req => {
    const out = new Set();
    pushPath(out, req.path);
    collectFromArray(out, req.paths);
    return [...out];
  },
  run_deploy: req => {
    const out = new Set();
    collectFromArray(out, req.targets);
    collectFromArray(out, req.paths);
    pushPath(out, req.target);
    return [...out];
  },
};

const extractTouchedPaths = (toolId, request) => {
  if (!toolId) return null;
  if (FILESYSTEM_INERT_TOOLS.has(toolId)) return [];
  const fn = EXTRACTORS[toolId];
  if (!fn) return null;
  const req =
    request && typeof request === 'object' && !Array.isArray(request) ? request : {};
  try {
    return fn(req);
  } catch {
    return [];
  }
};

// ─── Connection ────────────────────────────────────────────────────────

const readEnv = key => process.env[key] || '';
const resolveConnectionString = () => {
  const direct = readEnv('DATABASE_URL') || readEnv('PGDATABASE_URL');
  if (direct) return direct;
  // Fall back to the repo's convention, matching server/db.ts.
  const host = readEnv('PGHOST') || '127.0.0.1';
  const port = readEnv('PGPORT') || '5432';
  const user = readEnv('PGUSER') || 'postgres';
  const password = readEnv('PGPASSWORD') || 'postgres';
  const database = readEnv('PGDATABASE') || 'singularityneo';
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
};

// ─── Main ──────────────────────────────────────────────────────────────

const BACKFILL_DAYS = Number(readEnv('BACKFILL_DAYS') || '90');
const BATCH_SIZE = 500;

const main = async () => {
  const client = new pg.Client({ connectionString: resolveConnectionString() });
  await client.connect();

  const cutoff = new Date(Date.now() - BACKFILL_DAYS * 24 * 3600 * 1000);
  console.log(
    `[provenance-backfill] walking capability_tool_invocations since ${cutoff.toISOString()} (BACKFILL_DAYS=${BACKFILL_DAYS})`,
  );

  let processed = 0;
  let updated = 0;
  const unmappedTools = new Map();
  let earliest = null;
  let latest = null;
  const capabilityIds = new Set();

  let cursorStartedAt = null;
  let cursorId = null;

  while (true) {
    const params = [cutoff.toISOString(), BATCH_SIZE];
    let whereExtra = '';
    if (cursorStartedAt && cursorId) {
      params.push(cursorStartedAt, cursorId);
      whereExtra = ` AND (started_at, id) > ($3::timestamptz, $4::text)`;
    }
    const { rows } = await client.query(
      `
        SELECT capability_id, id, tool_id, request, touched_paths, started_at
        FROM capability_tool_invocations
        WHERE started_at IS NOT NULL
          AND started_at >= $1${whereExtra}
        ORDER BY started_at ASC, id ASC
        LIMIT $2
      `,
      params,
    );
    if (!rows.length) break;

    await client.query('BEGIN');
    for (const row of rows) {
      processed += 1;
      capabilityIds.add(row.capability_id);
      if (!earliest || row.started_at < earliest) earliest = row.started_at;
      if (!latest || row.started_at > latest) latest = row.started_at;

      const extracted = extractTouchedPaths(row.tool_id, row.request);
      if (extracted === null) {
        unmappedTools.set(row.tool_id, (unmappedTools.get(row.tool_id) || 0) + 1);
        continue;
      }
      const current = Array.isArray(row.touched_paths) ? [...row.touched_paths].sort() : [];
      const next = [...extracted].sort();
      if (JSON.stringify(current) === JSON.stringify(next)) continue;

      await client.query(
        `
          UPDATE capability_tool_invocations
          SET touched_paths = $3, updated_at = NOW()
          WHERE capability_id = $1 AND id = $2
        `,
        [row.capability_id, row.id, next],
      );
      updated += 1;
    }
    await client.query('COMMIT');

    const last = rows[rows.length - 1];
    cursorStartedAt = last.started_at;
    cursorId = last.id;
    if (rows.length < BATCH_SIZE) break;
  }

  // Write a coverage row per capability so prove-no-touch can cite the
  // exact window this backfill is confident about.
  if (earliest && latest) {
    for (const capabilityId of capabilityIds) {
      const coverageId = `GOV-COV-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
      await client.query(
        `
          INSERT INTO governance_provenance_coverage (
            coverage_id, capability_id, window_start, window_end, source, notes, created_at
          )
          VALUES ($1,$2,$3,$4,'backfill',$5,NOW())
        `,
        [
          coverageId,
          capabilityId,
          earliest,
          latest,
          `backfill over last ${BACKFILL_DAYS} day(s)`,
        ],
      );
    }
  }

  console.log(
    `[provenance-backfill] processed=${processed} updated=${updated} capabilities=${capabilityIds.size}`,
  );
  if (unmappedTools.size > 0) {
    console.warn(
      `[provenance-backfill] unmapped tools (add extractors): ${[...unmappedTools.entries()]
        .map(([k, v]) => `${k} (${v})`)
        .join(', ')}`,
    );
  }
  await client.end();
};

main().catch(err => {
  console.error('[provenance-backfill] failed:', err);
  process.exit(1);
});
