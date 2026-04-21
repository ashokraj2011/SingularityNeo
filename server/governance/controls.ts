/**
 * Governance controls service — Slice 2.
 *
 * Read + write operations for the governance_controls and
 * governance_control_bindings tables. The data model is described in
 * docs/governance.md (Slice 2 section) and the seed in
 * ./controlsCatalog.ts.
 *
 * Invariants:
 *  - A binding whose id begins with `GOV-BND-SEED-` is owned by the seed
 *    catalog; operator-created bindings MUST use a different id prefix so
 *    upgrades never clobber custom bindings.
 *  - `ensureControlsSeeded()` is idempotent. It writes the seed INSIDE the
 *    caller-provided transaction so bootstrap failures never leave the
 *    catalog partially populated.
 *  - Every control enumerates to at least one framework; listControls
 *    accepts a framework filter so the UI can render one framework at a
 *    time without pulling all 45 rows.
 */
import type { PoolClient } from 'pg';
import { query, transaction } from '../db';
import { matchesPolicySelector } from '../policy';
import {
  CONTROLS_SEED_VERSION,
  CONTROL_BINDING_SEEDS,
  CONTROL_SEEDS,
  validateCatalogIntegrity,
  type BindingKind,
  type ControlFramework,
  type ControlOwnerRole,
  type ControlSeverity,
  type ControlStatus,
} from './controlsCatalog';

const SEED_BINDING_ID_PREFIX = 'GOV-BND-SEED-';
const OPERATOR_BINDING_ID_PREFIX = 'GOV-BND-';

export type ControlRecord = {
  controlId: string;
  framework: ControlFramework;
  controlCode: string;
  controlFamily: string;
  title: string;
  description: string;
  ownerRole: ControlOwnerRole | null;
  severity: ControlSeverity;
  status: ControlStatus;
  seedVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ControlBindingRecord = {
  bindingId: string;
  controlId: string;
  policySelector: Record<string, unknown>;
  bindingKind: BindingKind;
  capabilityScope: string | null;
  seedVersion: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type ControlWithBindings = ControlRecord & {
  bindings: ControlBindingRecord[];
};

export type ControlListItem = ControlRecord & {
  bindingCount: number;
};

export type ControlFilter = {
  framework?: ControlFramework;
  severity?: ControlSeverity;
  status?: ControlStatus;
  capabilityScope?: string;
};

const asIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

const rowToControl = (row: Record<string, unknown>): ControlRecord => ({
  controlId: String(row.control_id),
  framework: String(row.framework) as ControlFramework,
  controlCode: String(row.control_code),
  controlFamily: String(row.control_family),
  title: String(row.title),
  description: String(row.description),
  ownerRole: row.owner_role ? (String(row.owner_role) as ControlOwnerRole) : null,
  severity: String(row.severity) as ControlSeverity,
  status: String(row.status) as ControlStatus,
  seedVersion: row.seed_version ? String(row.seed_version) : null,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
});

const rowToBinding = (row: Record<string, unknown>): ControlBindingRecord => {
  const raw = row.policy_selector;
  // pg returns jsonb as already-parsed object; fall through is defensive.
  let selector: Record<string, unknown> = {};
  if (raw && typeof raw === 'object') {
    selector = raw as Record<string, unknown>;
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') selector = parsed as Record<string, unknown>;
    } catch {
      selector = {};
    }
  }
  return {
    bindingId: String(row.binding_id),
    controlId: String(row.control_id),
    policySelector: selector,
    bindingKind: String(row.binding_kind) as BindingKind,
    capabilityScope: row.capability_scope ? String(row.capability_scope) : null,
    seedVersion: row.seed_version ? String(row.seed_version) : null,
    createdAt: asIso(row.created_at),
    createdBy: row.created_by ? String(row.created_by) : null,
  };
};

/**
 * Upsert the seed catalog into the DB. Safe to call on every server boot:
 *  - INSERTs with ON CONFLICT UPDATE refresh descriptions and
 *    metadata without losing operator-created bindings (which never
 *    match a seed binding_id).
 *  - Seed bindings are scoped by the `GOV-BND-SEED-` id prefix so this
 *    function never touches operator-added bindings.
 */
export const ensureControlsSeeded = async (client?: PoolClient): Promise<{
  controlsUpserted: number;
  bindingsUpserted: number;
  seedVersion: string;
}> => {
  const integrity = validateCatalogIntegrity();
  if (integrity.length > 0) {
    // Fail loud — a bad seed catalog is a build-time bug.
    throw new Error(
      `governance controls catalog integrity errors:\n  - ${integrity.join('\n  - ')}`,
    );
  }

  const runUpserts = async (executor: Pick<PoolClient, 'query'>) => {
    for (const control of CONTROL_SEEDS) {
      await executor.query(
        `
          INSERT INTO governance_controls (
            control_id, framework, control_code, control_family, title,
            description, owner_role, severity, status, seed_version,
            created_at, updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
          ON CONFLICT (control_id) DO UPDATE SET
            framework = EXCLUDED.framework,
            control_code = EXCLUDED.control_code,
            control_family = EXCLUDED.control_family,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            owner_role = EXCLUDED.owner_role,
            severity = EXCLUDED.severity,
            status = EXCLUDED.status,
            seed_version = EXCLUDED.seed_version,
            updated_at = NOW()
        `,
        [
          control.controlId,
          control.framework,
          control.controlCode,
          control.controlFamily,
          control.title,
          control.description,
          control.ownerRole,
          control.severity,
          control.status,
          CONTROLS_SEED_VERSION,
        ],
      );
    }

    for (const binding of CONTROL_BINDING_SEEDS) {
      if (!binding.bindingId.startsWith(SEED_BINDING_ID_PREFIX)) {
        throw new Error(
          `seed binding ${binding.bindingId} must use the ${SEED_BINDING_ID_PREFIX} prefix`,
        );
      }
      await executor.query(
        `
          INSERT INTO governance_control_bindings (
            binding_id, control_id, policy_selector, binding_kind,
            capability_scope, seed_version, created_at, created_by
          )
          VALUES ($1,$2,$3::jsonb,$4,$5,$6,NOW(),NULL)
          ON CONFLICT (binding_id) DO UPDATE SET
            control_id = EXCLUDED.control_id,
            policy_selector = EXCLUDED.policy_selector,
            binding_kind = EXCLUDED.binding_kind,
            capability_scope = EXCLUDED.capability_scope,
            seed_version = EXCLUDED.seed_version
        `,
        [
          binding.bindingId,
          binding.controlId,
          JSON.stringify(binding.policySelector ?? {}),
          binding.bindingKind,
          binding.capabilityScope ?? null,
          CONTROLS_SEED_VERSION,
        ],
      );
    }
  };

  if (client) {
    await runUpserts(client);
  } else {
    await transaction(async inner => {
      await runUpserts(inner);
    });
  }

  return {
    controlsUpserted: CONTROL_SEEDS.length,
    bindingsUpserted: CONTROL_BINDING_SEEDS.length,
    seedVersion: CONTROLS_SEED_VERSION,
  };
};

/**
 * List controls, optionally filtered, with a binding-count tally per row.
 * capabilityScope=<id> narrows bindings to global (NULL) + exact-match
 * scope so the UI can render "controls that apply to this capability".
 */
export const listControls = async (filter: ControlFilter = {}): Promise<ControlListItem[]> => {
  const params: unknown[] = [];
  const where: string[] = [];

  if (filter.framework) {
    params.push(filter.framework);
    where.push(`c.framework = $${params.length}`);
  }
  if (filter.severity) {
    params.push(filter.severity);
    where.push(`c.severity = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`c.status = $${params.length}`);
  }

  let bindingJoin = 'LEFT JOIN governance_control_bindings b ON b.control_id = c.control_id';
  if (filter.capabilityScope) {
    params.push(filter.capabilityScope);
    bindingJoin = `
      LEFT JOIN governance_control_bindings b
        ON b.control_id = c.control_id
       AND (b.capability_scope IS NULL OR b.capability_scope = $${params.length})
    `;
  }

  const sql = `
    SELECT
      c.*,
      COUNT(b.binding_id)::int AS binding_count
    FROM governance_controls c
    ${bindingJoin}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY c.control_id
    ORDER BY c.framework, c.control_code
  `;

  const result = await query<Record<string, unknown>>(sql, params);
  return result.rows.map(row => ({
    ...rowToControl(row),
    bindingCount: Number(row.binding_count ?? 0),
  }));
};

export const getControl = async (
  controlId: string,
  capabilityScope?: string,
): Promise<ControlWithBindings | null> => {
  const controlRes = await query<Record<string, unknown>>(
    `SELECT * FROM governance_controls WHERE control_id = $1`,
    [controlId],
  );
  if (controlRes.rowCount === 0) return null;

  const scopedFilter = capabilityScope
    ? `AND (capability_scope IS NULL OR capability_scope = $2)`
    : '';
  const bindingParams: unknown[] = [controlId];
  if (capabilityScope) bindingParams.push(capabilityScope);

  const bindingsRes = await query<Record<string, unknown>>(
    `
      SELECT *
      FROM governance_control_bindings
      WHERE control_id = $1 ${scopedFilter}
      ORDER BY binding_id
    `,
    bindingParams,
  );
  return {
    ...rowToControl(controlRes.rows[0]),
    bindings: bindingsRes.rows.map(rowToBinding),
  };
};

export type CreateBindingInput = {
  controlId: string;
  policySelector: Record<string, unknown>;
  bindingKind: BindingKind;
  capabilityScope?: string | null;
  createdBy?: string | null;
};

/**
 * Create an operator-owned binding. The binding_id auto-generates with the
 * `GOV-BND-OP-` prefix — never with the `GOV-BND-SEED-` prefix, which is
 * reserved for the catalog seed.
 */
export const createBinding = async (
  input: CreateBindingInput,
): Promise<ControlBindingRecord> => {
  if (!input.controlId) {
    throw new Error('createBinding: controlId is required');
  }
  if (!input.bindingKind) {
    throw new Error('createBinding: bindingKind is required');
  }
  if (!input.policySelector || typeof input.policySelector !== 'object') {
    throw new Error('createBinding: policySelector must be an object');
  }
  if (Object.keys(input.policySelector).length === 0) {
    throw new Error('createBinding: policySelector must have at least one key');
  }

  const controlRes = await query<{ control_id: string; status: string }>(
    `SELECT control_id, status FROM governance_controls WHERE control_id = $1`,
    [input.controlId],
  );
  if (controlRes.rowCount === 0) {
    throw new Error(`createBinding: control ${input.controlId} not found`);
  }
  if (controlRes.rows[0].status === 'RETIRED') {
    throw new Error(`createBinding: control ${input.controlId} is retired`);
  }

  const bindingId = `${OPERATOR_BINDING_ID_PREFIX}OP-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

  const insertRes = await query<Record<string, unknown>>(
    `
      INSERT INTO governance_control_bindings (
        binding_id, control_id, policy_selector, binding_kind,
        capability_scope, seed_version, created_at, created_by
      )
      VALUES ($1,$2,$3::jsonb,$4,$5,NULL,NOW(),$6)
      RETURNING *
    `,
    [
      bindingId,
      input.controlId,
      JSON.stringify(input.policySelector),
      input.bindingKind,
      input.capabilityScope ?? null,
      input.createdBy ?? null,
    ],
  );

  return rowToBinding(insertRes.rows[0]);
};

/**
 * List bindings matching a policy selector shape. Used by Slice 3's
 * exception lifecycle + the evidence-packet UI's "which controls this
 * attestation satisfies" chip.
 *
 * A binding matches if every key in `probe` exists in the stored
 * policy_selector with the same value. Extra keys on the stored selector
 * don't disqualify it — stored selectors are AND-narrowed, probes are
 * ask-by-example. Scope narrows to global (NULL) plus an optional exact
 * capability match.
 */
export const findBindingsByPolicySelector = async (
  probe: Record<string, unknown>,
  options: { capabilityScope?: string | null } = {},
): Promise<ControlBindingRecord[]> => {
  if (!probe || typeof probe !== 'object' || Object.keys(probe).length === 0) {
    return [];
  }
  const params: unknown[] = [];
  const scopeClause = options.capabilityScope
    ? `WHERE capability_scope IS NULL OR capability_scope = $1`
    : `WHERE capability_scope IS NULL`;
  if (options.capabilityScope) {
    params.push(options.capabilityScope);
  }
  const sql = `
    SELECT *
    FROM governance_control_bindings
    ${scopeClause}
    ORDER BY binding_id
  `;
  const res = await query<Record<string, unknown>>(sql, params);
  return res.rows
    .map(rowToBinding)
    .filter(binding =>
      matchesPolicySelector({
        selector: binding.policySelector,
        actionType: typeof probe.actionType === 'string' ? probe.actionType : undefined,
        toolId: typeof probe.toolId === 'string' ? probe.toolId : undefined,
      }),
    );
};

/**
 * Count controls per framework — cheap aggregate for a posture header
 * card. Called by the /controls index page so we can render "15 NIST,
 * 15 SOC 2, 15 ISO" without pulling every row.
 */
export const getControlFrameworkSummary = async (): Promise<
  Array<{ framework: ControlFramework; total: number; activeBindings: number }>
> => {
  const res = await query<{
    framework: string;
    total: string | number;
    active_bindings: string | number;
  }>(
    `
      SELECT
        c.framework,
        COUNT(DISTINCT c.control_id) AS total,
        COUNT(DISTINCT b.binding_id) AS active_bindings
      FROM governance_controls c
      LEFT JOIN governance_control_bindings b ON b.control_id = c.control_id
      WHERE c.status = 'ACTIVE'
      GROUP BY c.framework
      ORDER BY c.framework
    `,
  );
  return res.rows.map(row => ({
    framework: row.framework as ControlFramework,
    total: Number(row.total ?? 0),
    activeBindings: Number(row.active_bindings ?? 0),
  }));
};
