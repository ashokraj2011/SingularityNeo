/**
 * Desktop Preferences
 *
 * Stores and loads non-secret, per-machine configuration from the
 * `desktop_preferences` PostgreSQL table.  Security tokens are intentionally
 * excluded — they remain in `.env.local` only.
 *
 * Preference keys:
 *   workingDirectory     ← SINGULARITY_WORKING_DIRECTORY
 *   copilotCliUrl        ← COPILOT_CLI_URL
 *   allowHttpFallback    ← ALLOW_GITHUB_MODELS_HTTP_FALLBACK
 *   embeddingBaseUrl     ← LOCAL_OPENAI_BASE_URL
 *   embeddingModel       ← LOCAL_OPENAI_EMBEDDING_MODEL
 *   runtimePort          ← PORT
 *   executorId           ← SINGULARITY_DESKTOP_EXECUTOR_ID (stable machine ID)
 *
 * Anything not in this list (GitHub tokens, DB passwords, API keys) is never
 * written here and is never read back into process.env by this module.
 */

import crypto from 'node:crypto';
import os from 'node:os';
import type { DesktopPreferences } from '../src/types';
import { query } from './db';

// ---------------------------------------------------------------------------
// Identity derivation
// ---------------------------------------------------------------------------

/**
 * Derives a stable, human-safe desktop identity from the machine hostname.
 * The same hostname always produces the same ID.  The ID is NOT a secret —
 * it is used only as a primary key in `desktop_preferences`.
 *
 * Format: "DID-<16 hex chars uppercase>" e.g. "DID-3A7F2B9C1D4E5F60"
 */
export const deriveDesktopId = (hostname?: string): string => {
  const host = (hostname || os.hostname() || 'unknown').toLowerCase().trim();
  const hash = crypto.createHash('sha256').update(host).digest('hex').slice(0, 16).toUpperCase();
  return `DID-${hash}`;
};

// ---------------------------------------------------------------------------
// DB mapping helpers
// ---------------------------------------------------------------------------

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value || '');

const asString = (value: unknown): string | undefined => {
  const s = String(value || '').trim();
  return s || undefined;
};

const asBoolean = (value: unknown): boolean | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
};

const asInt = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
};

const preferencesFromRow = (row: Record<string, any>): DesktopPreferences => ({
  id: row.id,
  hostname: row.hostname,
  workingDirectory: asString(row.working_directory),
  copilotCliUrl: asString(row.copilot_cli_url),
  allowHttpFallback: asBoolean(row.allow_http_fallback),
  embeddingBaseUrl: asString(row.embedding_base_url),
  embeddingModel: asString(row.embedding_model),
  runtimePort: asInt(row.runtime_port),
  executorId: asString(row.executor_id),
  extra:
    row.extra && typeof row.extra === 'object' && !Array.isArray(row.extra)
      ? row.extra
      : undefined,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const getDesktopPreferences = async (
  desktopId: string,
): Promise<DesktopPreferences | null> => {
  const result = await query<Record<string, any>>(
    `SELECT * FROM desktop_preferences WHERE id = $1`,
    [desktopId],
  );
  return result.rowCount ? preferencesFromRow(result.rows[0]) : null;
};

export const upsertDesktopPreferences = async (
  desktopId: string,
  hostname: string,
  prefs: Partial<Omit<DesktopPreferences, 'id' | 'hostname' | 'createdAt' | 'updatedAt'>>,
): Promise<DesktopPreferences> => {
  const result = await query<Record<string, any>>(
    `
      INSERT INTO desktop_preferences (
        id, hostname,
        working_directory, copilot_cli_url, allow_http_fallback,
        embedding_base_url, embedding_model, runtime_port, executor_id, extra,
        created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
      ON CONFLICT (id) DO UPDATE SET
        hostname              = EXCLUDED.hostname,
        working_directory     = COALESCE(EXCLUDED.working_directory,     desktop_preferences.working_directory),
        copilot_cli_url       = COALESCE(EXCLUDED.copilot_cli_url,       desktop_preferences.copilot_cli_url),
        allow_http_fallback   = COALESCE(EXCLUDED.allow_http_fallback,   desktop_preferences.allow_http_fallback),
        embedding_base_url    = COALESCE(EXCLUDED.embedding_base_url,    desktop_preferences.embedding_base_url),
        embedding_model       = COALESCE(EXCLUDED.embedding_model,       desktop_preferences.embedding_model),
        runtime_port          = COALESCE(EXCLUDED.runtime_port,          desktop_preferences.runtime_port),
        executor_id           = COALESCE(EXCLUDED.executor_id,           desktop_preferences.executor_id),
        extra                 = desktop_preferences.extra || EXCLUDED.extra,
        updated_at            = NOW()
      RETURNING *
    `,
    [
      desktopId,
      hostname.trim() || os.hostname(),
      prefs.workingDirectory?.trim() || null,
      prefs.copilotCliUrl?.trim() || null,
      prefs.allowHttpFallback ?? null,
      prefs.embeddingBaseUrl?.trim() || null,
      prefs.embeddingModel?.trim() || null,
      prefs.runtimePort ?? null,
      prefs.executorId?.trim() || null,
      JSON.stringify(prefs.extra || {}),
    ],
  );
  return preferencesFromRow(result.rows[0]);
};

/** Explicitly set individual fields — NULL values clear the column. */
export const patchDesktopPreferences = async (
  desktopId: string,
  hostname: string,
  patch: Partial<Omit<DesktopPreferences, 'id' | 'hostname' | 'createdAt' | 'updatedAt'>>,
): Promise<DesktopPreferences> => {
  const result = await query<Record<string, any>>(
    `
      INSERT INTO desktop_preferences (
        id, hostname,
        working_directory, copilot_cli_url, allow_http_fallback,
        embedding_base_url, embedding_model, runtime_port, executor_id, extra,
        created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
      ON CONFLICT (id) DO UPDATE SET
        hostname              = EXCLUDED.hostname,
        working_directory     = EXCLUDED.working_directory,
        copilot_cli_url       = EXCLUDED.copilot_cli_url,
        allow_http_fallback   = EXCLUDED.allow_http_fallback,
        embedding_base_url    = EXCLUDED.embedding_base_url,
        embedding_model       = EXCLUDED.embedding_model,
        runtime_port          = EXCLUDED.runtime_port,
        executor_id           = EXCLUDED.executor_id,
        extra                 = desktop_preferences.extra || EXCLUDED.extra,
        updated_at            = NOW()
      RETURNING *
    `,
    [
      desktopId,
      hostname.trim() || os.hostname(),
      patch.workingDirectory !== undefined ? (patch.workingDirectory?.trim() || null) : null,
      patch.copilotCliUrl !== undefined ? (patch.copilotCliUrl?.trim() || null) : null,
      patch.allowHttpFallback !== undefined ? patch.allowHttpFallback : null,
      patch.embeddingBaseUrl !== undefined ? (patch.embeddingBaseUrl?.trim() || null) : null,
      patch.embeddingModel !== undefined ? (patch.embeddingModel?.trim() || null) : null,
      patch.runtimePort !== undefined ? patch.runtimePort : null,
      patch.executorId !== undefined ? (patch.executorId?.trim() || null) : null,
      JSON.stringify(patch.extra || {}),
    ],
  );
  return preferencesFromRow(result.rows[0]);
};

// ---------------------------------------------------------------------------
// Apply to process.env
// ---------------------------------------------------------------------------

/**
 * Applies non-null preference values to the current process environment so
 * they take effect for all subsequent code that reads `process.env.*`.
 *
 * Only sets values that are explicitly present in `prefs` — never clears an
 * env var that came from `.env.local` unless the DB has an explicit value.
 *
 * Tokens and passwords are NOT touched here.
 */
export const applyPreferencesToEnv = (prefs: DesktopPreferences): void => {
  if (prefs.workingDirectory) {
    process.env.SINGULARITY_WORKING_DIRECTORY = prefs.workingDirectory;
  }
  if (prefs.copilotCliUrl) {
    process.env.COPILOT_CLI_URL = prefs.copilotCliUrl;
  }
  if (prefs.allowHttpFallback !== undefined) {
    process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK = prefs.allowHttpFallback ? 'true' : 'false';
  }
  if (prefs.embeddingBaseUrl) {
    process.env.LOCAL_OPENAI_BASE_URL = prefs.embeddingBaseUrl;
  }
  if (prefs.embeddingModel) {
    process.env.LOCAL_OPENAI_EMBEDDING_MODEL = prefs.embeddingModel;
  }
  if (prefs.runtimePort) {
    process.env.PORT = String(prefs.runtimePort);
  }
  if (prefs.executorId) {
    process.env.SINGULARITY_DESKTOP_EXECUTOR_ID = prefs.executorId;
  }
};

// ---------------------------------------------------------------------------
// Startup bootstrap
// ---------------------------------------------------------------------------

/**
 * Derives the current machine's desktop ID, loads its preferences from the
 * DB, and applies non-null values to `process.env`.
 *
 * Call once during server startup, after the DB pool is ready.
 * Failures are logged but never thrown — the server must start even if the
 * preferences row does not yet exist.
 */
export const loadAndApplyDesktopPreferences = async (): Promise<DesktopPreferences | null> => {
  try {
    const desktopId = deriveDesktopId();
    const prefs = await getDesktopPreferences(desktopId);
    if (prefs) {
      applyPreferencesToEnv(prefs);
      console.log(
        `[desktopPreferences] loaded preferences for ${prefs.hostname} (${desktopId})`,
      );
    }
    return prefs;
  } catch (err) {
    console.warn(
      '[desktopPreferences] could not load desktop preferences:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
};
