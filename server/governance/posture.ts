/**
 * Governance posture aggregator — Slice 5 (optional follow-up).
 *
 * Pure read over the four earlier slices' tables:
 *   - signer status + signed/unsigned packet counts (Slice 1)
 *   - controls + bindings (Slice 2)
 *   - active / expiring-soon exceptions (Slice 3)
 *   - provenance coverage gaps + unmapped-tool telemetry proxy (Slice 4)
 *
 * No writes, no new data. This module exists so operators and auditors get
 * a single-page answer to "are we compliant right now?" without having to
 * assemble it from four separate screens.
 *
 * Everything degrades gracefully: if a subsystem table is missing (e.g. a
 * fresh bootstrap before Slice 4's columns are applied), the field returns
 * a null/zero value and a short diagnostic note rather than throwing.
 */
import { query } from '../db';
import { describeSignerStatus, type SignerStatus } from './signer';
import { governanceExceptionsEnabled } from './exceptions';
import { governanceProvenanceEnabled } from './provenance';

const RECENT_PACKET_WINDOW_DAYS = 30;
const RECENT_DENIAL_LIMIT = 50;
const EXPIRING_SOON_HOURS = 24;

// ──────────────────────────────────────────────────────────────────────────
// Types — mirrored in src/types.ts so both sides share the exact shape.
// ──────────────────────────────────────────────────────────────────────────

export interface PostureSignerHealth {
  status: SignerStatus;
  recentPackets: {
    windowDays: number;
    total: number;
    signed: number;
    unsigned: number;
    signedRatio: number;
  };
}

export interface PostureControlCoverage {
  totalControls: number;
  boundControls: number;
  unboundControls: number;
  coverageRatio: number;
  byFramework: Array<{
    framework: string;
    total: number;
    bound: number;
    coverageRatio: number;
  }>;
}

export interface PostureExceptionsSummary {
  enabled: boolean;
  active: number;
  expiringSoon: number;
  expiringSoonHours: number;
  recentDecisions: Array<{
    exceptionId: string;
    capabilityId: string;
    controlId: string;
    status: string;
    decidedBy: string | null;
    decidedAt: string | null;
    expiresAt: string | null;
  }>;
}

export interface PostureProvenanceSummary {
  enabled: boolean;
  capabilitiesWithCoverage: number;
  coverageWindowCount: number;
  earliestWindowStart: string | null;
  latestWindowEnd: string | null;
  unmappedToolSamples: Array<{ toolId: string; sampleCount: number }>;
}

export interface PostureRecentDenial {
  decisionId: string;
  capabilityId: string;
  actionType: string;
  decision: string;
  reason: string;
  createdAt: string;
  controlId: string | null;
  exceptionId: string | null;
}

export interface GovernancePostureSnapshot {
  generatedAt: string;
  signer: PostureSignerHealth;
  controls: PostureControlCoverage;
  exceptions: PostureExceptionsSummary;
  provenance: PostureProvenanceSummary;
  recentDenials: PostureRecentDenial[];
  warnings: string[];
}

// ──────────────────────────────────────────────────────────────────────────
// Small helpers — safe query wrapper. The posture endpoint must never
// fail because a single subsystem table is missing; instead we collect a
// human-readable warning so the UI can flag it.
// ──────────────────────────────────────────────────────────────────────────

const safeQuery = async <R>(
  sql: string,
  params: unknown[] | undefined,
  warnings: string[],
  label: string,
): Promise<R[]> => {
  try {
    const res = await query<R>(sql, params);
    return res.rows;
  } catch (error) {
    warnings.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
};

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value instanceof Date) return value.getTime();
  return 0;
};

const toIso = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const ratio = (numerator: number, denominator: number): number => {
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(1, numerator / denominator));
};

// ──────────────────────────────────────────────────────────────────────────
// Signer health. Combines the in-process signer status (cheap, no DB)
// with a DB probe over the last 30 days of evidence packets to report
// the real signed-ratio operators care about at audit time.
// ──────────────────────────────────────────────────────────────────────────

const gatherSignerHealth = async (
  warnings: string[],
): Promise<PostureSignerHealth> => {
  const status = describeSignerStatus();
  const rows = await safeQuery<{ total: string | number; signed: string | number }>(
    `
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE signature IS NOT NULL)   AS signed
      FROM capability_evidence_packets
      WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
    `,
    [RECENT_PACKET_WINDOW_DAYS],
    warnings,
    'signer.recentPackets',
  );
  const row = rows[0] ?? { total: 0, signed: 0 };
  const total = toNumber(row.total);
  const signed = toNumber(row.signed);
  return {
    status,
    recentPackets: {
      windowDays: RECENT_PACKET_WINDOW_DAYS,
      total,
      signed,
      unsigned: Math.max(0, total - signed),
      signedRatio: ratio(signed, total),
    },
  };
};

// ──────────────────────────────────────────────────────────────────────────
// Control coverage. A control is "bound" if at least one binding exists
// that references it — the framework-level breakdown is the same question
// asked per framework.
// ──────────────────────────────────────────────────────────────────────────

const gatherControlCoverage = async (
  warnings: string[],
): Promise<PostureControlCoverage> => {
  const rows = await safeQuery<{
    framework: string;
    total: string | number;
    bound: string | number;
  }>(
    `
      SELECT
        c.framework,
        COUNT(DISTINCT c.control_id) AS total,
        COUNT(DISTINCT c.control_id) FILTER (WHERE b.binding_id IS NOT NULL) AS bound
      FROM governance_controls c
      LEFT JOIN governance_control_bindings b ON b.control_id = c.control_id
      WHERE c.status = 'ACTIVE'
      GROUP BY c.framework
      ORDER BY c.framework
    `,
    undefined,
    warnings,
    'controls.coverage',
  );

  let totalControls = 0;
  let boundControls = 0;
  const byFramework = rows.map(row => {
    const total = toNumber(row.total);
    const bound = toNumber(row.bound);
    totalControls += total;
    boundControls += bound;
    return {
      framework: row.framework,
      total,
      bound,
      coverageRatio: ratio(bound, total),
    };
  });
  return {
    totalControls,
    boundControls,
    unboundControls: Math.max(0, totalControls - boundControls),
    coverageRatio: ratio(boundControls, totalControls),
    byFramework,
  };
};

// ──────────────────────────────────────────────────────────────────────────
// Exceptions summary. Always queries the table (for audit visibility even
// when the policy hook is disabled); `enabled` reflects the policy-side
// flag so the UI can explain what an "active" exception does or doesn't do.
// ──────────────────────────────────────────────────────────────────────────

const gatherExceptionsSummary = async (
  warnings: string[],
): Promise<PostureExceptionsSummary> => {
  const activeRows = await safeQuery<{ active: string | number; expiring_soon: string | number }>(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'APPROVED' AND expires_at > NOW()
        ) AS active,
        COUNT(*) FILTER (
          WHERE status = 'APPROVED'
            AND expires_at > NOW()
            AND expires_at <= NOW() + ($1::int * INTERVAL '1 hour')
        ) AS expiring_soon
      FROM governance_exceptions
    `,
    [EXPIRING_SOON_HOURS],
    warnings,
    'exceptions.counts',
  );
  const active = toNumber(activeRows[0]?.active ?? 0);
  const expiringSoon = toNumber(activeRows[0]?.expiring_soon ?? 0);

  const recentRows = await safeQuery<Record<string, unknown>>(
    `
      SELECT exception_id, capability_id, control_id, status,
             decided_by, decided_at, expires_at
      FROM governance_exceptions
      WHERE status IN ('APPROVED','DENIED','EXPIRED','REVOKED')
      ORDER BY COALESCE(decided_at, revoked_at, requested_at) DESC, exception_id DESC
      LIMIT 10
    `,
    undefined,
    warnings,
    'exceptions.recent',
  );

  return {
    enabled: governanceExceptionsEnabled(),
    active,
    expiringSoon,
    expiringSoonHours: EXPIRING_SOON_HOURS,
    recentDecisions: recentRows.map(row => ({
      exceptionId: String(row.exception_id ?? ''),
      capabilityId: String(row.capability_id ?? ''),
      controlId: String(row.control_id ?? ''),
      status: String(row.status ?? ''),
      decidedBy: (row.decided_by as string | null) ?? null,
      decidedAt: toIso(row.decided_at),
      expiresAt: toIso(row.expires_at),
    })),
  };
};

// ──────────────────────────────────────────────────────────────────────────
// Provenance summary. We approximate "unmapped tool samples" by pulling
// the top tool_ids whose invocations have an empty `touched_paths` — that
// overcounts filesystem-inert tools (which legitimately have []), so the
// UI copy emphasises this is a shape-check, not a drift alarm. The real
// telemetry signal lives in the governance.provenance_unmapped_tool
// metric emitted at write time.
// ──────────────────────────────────────────────────────────────────────────

const gatherProvenanceSummary = async (
  warnings: string[],
): Promise<PostureProvenanceSummary> => {
  const rows = await safeQuery<{
    capabilities: string | number;
    windows: string | number;
    earliest: unknown;
    latest: unknown;
  }>(
    `
      SELECT
        COUNT(DISTINCT capability_id) AS capabilities,
        COUNT(*)                      AS windows,
        MIN(window_start)             AS earliest,
        MAX(window_end)               AS latest
      FROM governance_provenance_coverage
    `,
    undefined,
    warnings,
    'provenance.coverage',
  );
  const summary = rows[0] ?? { capabilities: 0, windows: 0, earliest: null, latest: null };

  const unmappedRows = await safeQuery<{ tool_id: string; sample_count: string | number }>(
    `
      SELECT tool_id, COUNT(*)::int AS sample_count
      FROM capability_tool_invocations
      WHERE started_at >= NOW() - INTERVAL '7 days'
        AND (touched_paths IS NULL OR cardinality(touched_paths) = 0)
      GROUP BY tool_id
      ORDER BY sample_count DESC
      LIMIT 10
    `,
    undefined,
    warnings,
    'provenance.unmapped',
  );

  return {
    enabled: governanceProvenanceEnabled(),
    capabilitiesWithCoverage: toNumber(summary.capabilities),
    coverageWindowCount: toNumber(summary.windows),
    earliestWindowStart: toIso(summary.earliest),
    latestWindowEnd: toIso(summary.latest),
    unmappedToolSamples: unmappedRows.map(row => ({
      toolId: row.tool_id,
      sampleCount: toNumber(row.sample_count),
    })),
  };
};

// ──────────────────────────────────────────────────────────────────────────
// Recent denials. Returns the last N non-ALLOW decisions joined against
// the controls binding table to surface which control each denial maps
// to. The join uses a JSONB containment check on the action_type selector
// so the relationship is audit-defensible (the binding's policy_selector
// contains `{"actionType": "run_deploy"}` → match for decisions on that
// action).
// ──────────────────────────────────────────────────────────────────────────

const gatherRecentDenials = async (
  warnings: string[],
): Promise<PostureRecentDenial[]> => {
  const rows = await safeQuery<Record<string, unknown>>(
    `
      WITH ranked AS (
        SELECT
          d.id            AS decision_id,
          d.capability_id,
          d.action_type,
          d.decision,
          d.reason,
          d.created_at,
          d.exception_id,
          (
            SELECT b.control_id
            FROM governance_control_bindings b
            WHERE b.policy_selector @> jsonb_build_object('actionType', d.action_type)
            LIMIT 1
          ) AS control_id
        FROM capability_policy_decisions d
        WHERE d.decision <> 'ALLOW'
        ORDER BY d.created_at DESC
        LIMIT $1
      )
      SELECT * FROM ranked
    `,
    [RECENT_DENIAL_LIMIT],
    warnings,
    'denials.recent',
  );
  return rows.map(row => ({
    decisionId: String(row.decision_id ?? ''),
    capabilityId: String(row.capability_id ?? ''),
    actionType: String(row.action_type ?? ''),
    decision: String(row.decision ?? ''),
    reason: String(row.reason ?? ''),
    createdAt: toIso(row.created_at) ?? '',
    controlId: (row.control_id as string | null) ?? null,
    exceptionId: (row.exception_id as string | null) ?? null,
  }));
};

// ──────────────────────────────────────────────────────────────────────────
// Public: one call, one snapshot. All five pillars are fetched in parallel;
// if any one subsystem is missing its table the corresponding section
// degrades to zero/empty with a warning appended.
// ──────────────────────────────────────────────────────────────────────────

export const getGovernancePostureSnapshot =
  async (): Promise<GovernancePostureSnapshot> => {
    const warnings: string[] = [];
    const [signer, controls, exceptions, provenance, recentDenials] = await Promise.all([
      gatherSignerHealth(warnings),
      gatherControlCoverage(warnings),
      gatherExceptionsSummary(warnings),
      gatherProvenanceSummary(warnings),
      gatherRecentDenials(warnings),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      signer,
      controls,
      exceptions,
      provenance,
      recentDenials,
      warnings,
    };
  };
