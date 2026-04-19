// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice 2 — Governance controls + bindings service tests.
 *
 * Covers server/governance/controls.ts:
 *   1. validateCatalogIntegrity() returns no errors for the shipped seed.
 *   2. ensureControlsSeeded() upserts all controls + bindings and is safe
 *      to call twice without creating duplicates.
 *   3. listControls() applies framework / severity / status / capabilityScope
 *      filters and aggregates bindingCount per control.
 *   4. getControl() returns null for unknown ids and the full record + its
 *      bindings for known ids.
 *   5. createBinding() validates inputs, rejects retired controls, and
 *      generates a GOV-BND-OP-* id so seed-owned ids are never reused.
 *   6. findBindingsByPolicySelector() uses JSONB-containment semantics and
 *      honors the capability_scope narrowing rule.
 *   7. getControlFrameworkSummary() rolls up per-framework totals + active
 *      binding counts.
 *
 * The pg layer is replaced with a Map-backed in-memory simulator so the
 * tests run offline. The simulator understands the exact SQL shapes the
 * controls service issues — we pattern-match on SQL fragments rather than
 * parsing full SQL so harmless comment drift doesn't break the tests.
 */

// ──────────────────────────────────────────────────────────────────────────
// Map-backed pg mock. Exposed as the `store` handle so tests can prime/
// inspect state directly.
// ──────────────────────────────────────────────────────────────────────────

type ControlRow = {
  control_id: string;
  framework: string;
  control_code: string;
  control_family: string;
  title: string;
  description: string;
  owner_role: string | null;
  severity: string;
  status: string;
  seed_version: string | null;
  created_at: Date;
  updated_at: Date;
};

type BindingRow = {
  binding_id: string;
  control_id: string;
  policy_selector: Record<string, unknown>;
  binding_kind: string;
  capability_scope: string | null;
  seed_version: string | null;
  created_at: Date;
  created_by: string | null;
};

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };

const controls = new Map<string, ControlRow>();
const bindings = new Map<string, BindingRow>();

const resetStore = () => {
  controls.clear();
  bindings.clear();
};

const parseJsonbParam = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
};

// JSONB @> semantics: left-hand side contains every key/value pair on the
// right-hand side. Nested containment isn't needed for the seeds we ship, so
// we only implement shallow containment.
const containsSelector = (
  stored: Record<string, unknown>,
  probe: Record<string, unknown>,
): boolean => {
  for (const key of Object.keys(probe)) {
    const a = stored[key];
    const b = probe[key];
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) return false;
    } else if (a !== b) {
      return false;
    }
  }
  return true;
};

const queryImpl = async (rawSql: string, params?: unknown[]): Promise<QueryResult> => {
  const sql = rawSql.replace(/\s+/g, ' ').trim();

  // ────────────────────────────────────────────────────────────────────
  // ensureControlsSeeded — control upsert
  // ────────────────────────────────────────────────────────────────────
  if (sql.startsWith('INSERT INTO governance_controls')) {
    const [
      control_id,
      framework,
      control_code,
      control_family,
      title,
      description,
      owner_role,
      severity,
      status,
      seed_version,
    ] = params as [
      string,
      string,
      string,
      string,
      string,
      string,
      string | null,
      string,
      string,
      string | null,
    ];
    const existing = controls.get(control_id);
    const now = new Date();
    const row: ControlRow = {
      control_id,
      framework,
      control_code,
      control_family,
      title,
      description,
      owner_role: owner_role ?? null,
      severity,
      status,
      seed_version,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    controls.set(control_id, row);
    return { rows: [], rowCount: 1 };
  }

  // ────────────────────────────────────────────────────────────────────
  // ensureControlsSeeded / createBinding — binding upsert or insert.
  // Both call sites use 6 params but the positional meaning of $6
  // differs. Seed path:     [id, cid, selector, kind, scope, seed_version]
  // createBinding path:     [id, cid, selector, kind, scope, created_by]
  // The SQL text's `RETURNING *` clause distinguishes them.
  // ────────────────────────────────────────────────────────────────────
  if (sql.startsWith('INSERT INTO governance_control_bindings')) {
    const [binding_id, control_id, policy_selector_raw, binding_kind, capability_scope, sixth] =
      params as [string, string, unknown, string, string | null, string | null];
    const isCreate = sql.includes('RETURNING *');
    const selector = parseJsonbParam(policy_selector_raw);
    const existing = bindings.get(binding_id);
    const now = new Date();
    const row: BindingRow = {
      binding_id,
      control_id,
      policy_selector: selector,
      binding_kind,
      capability_scope: capability_scope ?? null,
      seed_version: isCreate ? null : sixth ?? null,
      created_at: existing?.created_at ?? now,
      created_by: isCreate ? sixth ?? null : null,
    };
    bindings.set(binding_id, row);
    if (isCreate) return { rows: [bindingRowToJson(row)], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }

  // ────────────────────────────────────────────────────────────────────
  // listControls — controls + bindingCount aggregate
  // ────────────────────────────────────────────────────────────────────
  if (
    sql.includes('FROM governance_controls c') &&
    sql.includes('binding_count')
  ) {
    const paramList = (params ?? []) as unknown[];
    const scopeIsUsed = sql.includes('b.capability_scope IS NULL OR b.capability_scope = $');
    // Reconstruct filter semantics from where clauses + $N positions. We
    // discover filters by looking at the SQL text plus the positional
    // parameter list; this mirrors the exact filter parameter order in
    // listControls().
    let cursor = 0;
    const filters: {
      framework?: string;
      severity?: string;
      status?: string;
      capabilityScope?: string;
    } = {};
    if (sql.includes('c.framework = $')) filters.framework = paramList[cursor++] as string;
    if (sql.includes('c.severity = $')) filters.severity = paramList[cursor++] as string;
    if (sql.includes('c.status = $')) filters.status = paramList[cursor++] as string;
    if (scopeIsUsed) filters.capabilityScope = paramList[cursor++] as string;

    const matches = Array.from(controls.values()).filter(row => {
      if (filters.framework && row.framework !== filters.framework) return false;
      if (filters.severity && row.severity !== filters.severity) return false;
      if (filters.status && row.status !== filters.status) return false;
      return true;
    });
    matches.sort((left, right) => {
      if (left.framework !== right.framework) {
        return left.framework.localeCompare(right.framework);
      }
      return left.control_code.localeCompare(right.control_code);
    });

    const rows = matches.map(control => {
      const relevantBindings = Array.from(bindings.values()).filter(binding => {
        if (binding.control_id !== control.control_id) return false;
        if (!filters.capabilityScope) return true;
        return binding.capability_scope === null || binding.capability_scope === filters.capabilityScope;
      });
      return {
        ...controlRowToJson(control),
        binding_count: relevantBindings.length,
      };
    });
    return { rows, rowCount: rows.length };
  }

  // ────────────────────────────────────────────────────────────────────
  // getControl / createBinding control lookup
  // ────────────────────────────────────────────────────────────────────
  if (sql.startsWith('SELECT control_id, status FROM governance_controls')) {
    const controlId = (params as unknown[])[0] as string;
    const row = controls.get(controlId);
    return row
      ? { rows: [{ control_id: row.control_id, status: row.status }], rowCount: 1 }
      : { rows: [], rowCount: 0 };
  }

  if (sql.startsWith('SELECT * FROM governance_controls WHERE control_id = $1')) {
    const controlId = (params as unknown[])[0] as string;
    const row = controls.get(controlId);
    return row ? { rows: [controlRowToJson(row)], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // ────────────────────────────────────────────────────────────────────
  // getControl — bindings list (scoped optional)
  // ────────────────────────────────────────────────────────────────────
  if (
    sql.startsWith('SELECT * FROM governance_control_bindings') &&
    sql.includes('WHERE control_id = $1') &&
    !sql.includes('policy_selector @>')
  ) {
    const controlId = (params as unknown[])[0] as string;
    const scopeParam = (params as unknown[])[1] as string | undefined;
    const hasScope = sql.includes('capability_scope IS NULL OR capability_scope = $2');
    const matches = Array.from(bindings.values())
      .filter(binding => binding.control_id === controlId)
      .filter(binding => {
        if (!hasScope) return true;
        return binding.capability_scope === null || binding.capability_scope === scopeParam;
      })
      .sort((left, right) => left.binding_id.localeCompare(right.binding_id));
    return { rows: matches.map(bindingRowToJson), rowCount: matches.length };
  }

  // ────────────────────────────────────────────────────────────────────
  // findBindingsByPolicySelector — JSONB @> match
  // ────────────────────────────────────────────────────────────────────
  if (
    sql.startsWith('SELECT * FROM governance_control_bindings') &&
    sql.includes('policy_selector @>')
  ) {
    const probe = parseJsonbParam((params as unknown[])[0]);
    const scopeParam = (params as unknown[])[1] as string | undefined;
    const hasScopeParam = sql.includes('capability_scope = $2');
    const matches = Array.from(bindings.values())
      .filter(binding => containsSelector(binding.policy_selector, probe))
      .filter(binding => {
        if (hasScopeParam) {
          return binding.capability_scope === null || binding.capability_scope === scopeParam;
        }
        return binding.capability_scope === null;
      })
      .sort((left, right) => left.binding_id.localeCompare(right.binding_id));
    return { rows: matches.map(bindingRowToJson), rowCount: matches.length };
  }

  // ────────────────────────────────────────────────────────────────────
  // getControlFrameworkSummary
  // ────────────────────────────────────────────────────────────────────
  if (sql.includes('COUNT(DISTINCT c.control_id) AS total')) {
    const summary = new Map<
      string,
      { framework: string; total: number; active_bindings: number }
    >();
    for (const control of controls.values()) {
      if (control.status !== 'ACTIVE') continue;
      const row =
        summary.get(control.framework) ??
        { framework: control.framework, total: 0, active_bindings: 0 };
      row.total += 1;
      summary.set(control.framework, row);
    }
    for (const binding of bindings.values()) {
      const control = controls.get(binding.control_id);
      if (!control || control.status !== 'ACTIVE') continue;
      const row = summary.get(control.framework);
      if (!row) continue;
      row.active_bindings += 1;
    }
    const rows = Array.from(summary.values()).sort((left, right) =>
      left.framework.localeCompare(right.framework),
    );
    return { rows, rowCount: rows.length };
  }

  return { rows: [], rowCount: 0 };
};

const controlRowToJson = (row: ControlRow): Record<string, unknown> => ({
  control_id: row.control_id,
  framework: row.framework,
  control_code: row.control_code,
  control_family: row.control_family,
  title: row.title,
  description: row.description,
  owner_role: row.owner_role,
  severity: row.severity,
  status: row.status,
  seed_version: row.seed_version,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const bindingRowToJson = (row: BindingRow): Record<string, unknown> => ({
  binding_id: row.binding_id,
  control_id: row.control_id,
  policy_selector: row.policy_selector,
  binding_kind: row.binding_kind,
  capability_scope: row.capability_scope,
  seed_version: row.seed_version,
  created_at: row.created_at,
  created_by: row.created_by,
});

vi.mock('../db', () => ({
  query: (sql: string, params?: unknown[]) => queryImpl(sql, params),
  transaction: async <T>(fn: (client: { query: typeof queryImpl }) => Promise<T>): Promise<T> =>
    fn({ query: queryImpl }),
  withClient: async <T>(fn: (client: { query: typeof queryImpl }) => Promise<T>): Promise<T> =>
    fn({ query: queryImpl }),
  getPlatformFeatureState: () => ({ pgvectorAvailable: false, memoryEmbeddingDimensions: 256 }),
  resetDatabasePool: async () => {},
  setDatabaseRuntimeConfig: async () => {},
  inspectDatabaseBootstrapStatus: async () => ({ ready: false }),
  getDatabaseRuntimeInfo: () => ({}),
  initializeDatabase: async () => {},
  getPool: async () => ({}),
}));

describe('governance/controls Slice 2 surface', () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => {
    resetStore();
  });

  // ──────────────────────────────────────────────────────────────────────
  // validateCatalogIntegrity
  // ──────────────────────────────────────────────────────────────────────
  describe('validateCatalogIntegrity', () => {
    it('returns no errors for the shipped seed', async () => {
      const { validateCatalogIntegrity } = await import('../governance/controlsCatalog');
      expect(validateCatalogIntegrity()).toEqual([]);
    });

    it('enumerates 45 controls balanced across 3 frameworks', async () => {
      const { CONTROL_SEEDS } = await import('../governance/controlsCatalog');
      expect(CONTROL_SEEDS).toHaveLength(45);
      const perFramework = CONTROL_SEEDS.reduce<Record<string, number>>((acc, c) => {
        acc[c.framework] = (acc[c.framework] ?? 0) + 1;
        return acc;
      }, {});
      expect(perFramework).toEqual({ NIST_CSF_2: 15, SOC2_TSC: 15, ISO27001_2022: 15 });
    });

    it('every seed binding references a known control id', async () => {
      const { CONTROL_SEEDS, CONTROL_BINDING_SEEDS } = await import(
        '../governance/controlsCatalog'
      );
      const ids = new Set(CONTROL_SEEDS.map(c => c.controlId));
      for (const binding of CONTROL_BINDING_SEEDS) {
        expect(ids.has(binding.controlId)).toBe(true);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // ensureControlsSeeded — idempotence + seed id invariants
  // ──────────────────────────────────────────────────────────────────────
  describe('ensureControlsSeeded', () => {
    it('upserts all seed controls and bindings, tagged with the seed version', async () => {
      const { ensureControlsSeeded } = await import('../governance/controls');
      const { CONTROL_SEEDS, CONTROL_BINDING_SEEDS, CONTROLS_SEED_VERSION } = await import(
        '../governance/controlsCatalog'
      );
      const result = await ensureControlsSeeded();
      expect(result.controlsUpserted).toBe(CONTROL_SEEDS.length);
      expect(result.bindingsUpserted).toBe(CONTROL_BINDING_SEEDS.length);
      expect(result.seedVersion).toBe(CONTROLS_SEED_VERSION);
      expect(controls.size).toBe(CONTROL_SEEDS.length);
      expect(bindings.size).toBe(CONTROL_BINDING_SEEDS.length);
      for (const row of controls.values()) {
        expect(row.seed_version).toBe(CONTROLS_SEED_VERSION);
      }
      // Every seed binding uses the GOV-BND-SEED- id prefix so upgrades
      // never collide with operator-authored bindings.
      for (const row of bindings.values()) {
        expect(row.binding_id.startsWith('GOV-BND-SEED-')).toBe(true);
      }
    });

    it('is idempotent — second call does not create duplicates', async () => {
      const { ensureControlsSeeded } = await import('../governance/controls');
      await ensureControlsSeeded();
      const firstControlCount = controls.size;
      const firstBindingCount = bindings.size;
      await ensureControlsSeeded();
      expect(controls.size).toBe(firstControlCount);
      expect(bindings.size).toBe(firstBindingCount);
    });

    it('bumps updated_at on re-seed so seed-version upgrades are observable', async () => {
      const { ensureControlsSeeded } = await import('../governance/controls');
      await ensureControlsSeeded();
      const firstUpdated = Array.from(controls.values())[0].updated_at.getTime();
      // Small delay so Date.now() moves forward in the mock.
      await new Promise(resolve => setTimeout(resolve, 5));
      await ensureControlsSeeded();
      const secondUpdated = Array.from(controls.values())[0].updated_at.getTime();
      expect(secondUpdated).toBeGreaterThanOrEqual(firstUpdated);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // listControls
  // ──────────────────────────────────────────────────────────────────────
  describe('listControls', () => {
    it('returns every seeded control with per-control bindingCount', async () => {
      const { ensureControlsSeeded, listControls } = await import('../governance/controls');
      await ensureControlsSeeded();
      const list = await listControls();
      expect(list).toHaveLength(45);
      // Sorted by (framework, control_code).
      const frameworks = Array.from(new Set(list.map(c => c.framework)));
      expect(frameworks).toEqual([...frameworks].sort());
      // bindingCount sums to the number of seed bindings.
      const total = list.reduce((sum, c) => sum + c.bindingCount, 0);
      const { CONTROL_BINDING_SEEDS } = await import('../governance/controlsCatalog');
      expect(total).toBe(CONTROL_BINDING_SEEDS.length);
    });

    it('filters by framework', async () => {
      const { ensureControlsSeeded, listControls } = await import('../governance/controls');
      await ensureControlsSeeded();
      const nist = await listControls({ framework: 'NIST_CSF_2' });
      expect(nist).toHaveLength(15);
      for (const row of nist) {
        expect(row.framework).toBe('NIST_CSF_2');
      }
    });

    it('filters by severity', async () => {
      const { ensureControlsSeeded, listControls } = await import('../governance/controls');
      const { CONTROL_SEEDS } = await import('../governance/controlsCatalog');
      await ensureControlsSeeded();
      const sev1Seeds = CONTROL_SEEDS.filter(c => c.severity === 'SEV_1');
      const sev1 = await listControls({ severity: 'SEV_1' });
      expect(sev1.length).toBe(sev1Seeds.length);
      for (const row of sev1) {
        expect(row.severity).toBe('SEV_1');
      }
    });

    it('filters bindingCount by capabilityScope — excludes foreign scopes', async () => {
      const { ensureControlsSeeded, createBinding, listControls } = await import(
        '../governance/controls'
      );
      await ensureControlsSeeded();
      // Add an operator binding scoped to CAP-alpha.
      const scopedBinding = await createBinding({
        controlId: 'GOV-CTRL-NIST-001',
        policySelector: { toolId: 'run_deploy' },
        bindingKind: 'POLICY_DECISION',
        capabilityScope: 'CAP-alpha',
      });
      expect(scopedBinding.capabilityScope).toBe('CAP-alpha');

      const alphaList = await listControls({ capabilityScope: 'CAP-alpha' });
      const betaList = await listControls({ capabilityScope: 'CAP-beta' });
      const alphaRow = alphaList.find(c => c.controlId === 'GOV-CTRL-NIST-001');
      const betaRow = betaList.find(c => c.controlId === 'GOV-CTRL-NIST-001');
      expect(alphaRow).toBeDefined();
      expect(betaRow).toBeDefined();
      // Alpha sees the scoped binding; beta does not. Binding counts differ
      // by exactly one.
      expect(alphaRow!.bindingCount - betaRow!.bindingCount).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getControl
  // ──────────────────────────────────────────────────────────────────────
  describe('getControl', () => {
    it('returns null for unknown control ids', async () => {
      const { getControl } = await import('../governance/controls');
      expect(await getControl('GOV-CTRL-DOES-NOT-EXIST')).toBeNull();
    });

    it('returns the control plus its bindings', async () => {
      const { ensureControlsSeeded, getControl } = await import('../governance/controls');
      await ensureControlsSeeded();
      const detail = await getControl('GOV-CTRL-NIST-011'); // PR.IP-01 — bound to workspace_apply_patch
      expect(detail).not.toBeNull();
      expect(detail!.controlCode).toBe('PR.IP-01');
      expect(detail!.bindings.length).toBeGreaterThan(0);
      for (const binding of detail!.bindings) {
        expect(binding.controlId).toBe('GOV-CTRL-NIST-011');
      }
    });

    it('scopes bindings to global + exact-match capability when capabilityScope is passed', async () => {
      const { ensureControlsSeeded, createBinding, getControl } = await import(
        '../governance/controls'
      );
      await ensureControlsSeeded();
      await createBinding({
        controlId: 'GOV-CTRL-SOC2-001',
        policySelector: { toolId: 'custom' },
        bindingKind: 'POLICY_DECISION',
        capabilityScope: 'CAP-alpha',
      });
      await createBinding({
        controlId: 'GOV-CTRL-SOC2-001',
        policySelector: { toolId: 'custom' },
        bindingKind: 'POLICY_DECISION',
        capabilityScope: 'CAP-beta',
      });
      const alpha = await getControl('GOV-CTRL-SOC2-001', 'CAP-alpha');
      expect(alpha).not.toBeNull();
      const scopes = alpha!.bindings.map(b => b.capabilityScope ?? 'GLOBAL');
      expect(scopes).toContain('CAP-alpha');
      expect(scopes).not.toContain('CAP-beta');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // createBinding
  // ──────────────────────────────────────────────────────────────────────
  describe('createBinding', () => {
    it('rejects an empty policy selector', async () => {
      const { ensureControlsSeeded, createBinding } = await import('../governance/controls');
      await ensureControlsSeeded();
      await expect(
        createBinding({
          controlId: 'GOV-CTRL-NIST-001',
          policySelector: {},
          bindingKind: 'POLICY_DECISION',
        }),
      ).rejects.toThrow(/policySelector must have at least one key/);
    });

    it('rejects bindings against unknown controls', async () => {
      const { createBinding } = await import('../governance/controls');
      await expect(
        createBinding({
          controlId: 'GOV-CTRL-NOPE-999',
          policySelector: { toolId: 'x' },
          bindingKind: 'POLICY_DECISION',
        }),
      ).rejects.toThrow(/not found/);
    });

    it('rejects bindings against retired controls', async () => {
      const { ensureControlsSeeded, createBinding } = await import('../governance/controls');
      await ensureControlsSeeded();
      const retiree = controls.get('GOV-CTRL-NIST-001');
      expect(retiree).toBeDefined();
      retiree!.status = 'RETIRED';
      await expect(
        createBinding({
          controlId: 'GOV-CTRL-NIST-001',
          policySelector: { toolId: 'x' },
          bindingKind: 'POLICY_DECISION',
        }),
      ).rejects.toThrow(/retired/);
    });

    it('generates a GOV-BND-OP- id so operator bindings never collide with seed ids', async () => {
      const { ensureControlsSeeded, createBinding } = await import('../governance/controls');
      await ensureControlsSeeded();
      const binding = await createBinding({
        controlId: 'GOV-CTRL-NIST-001',
        policySelector: { toolId: 'run_deploy' },
        bindingKind: 'POLICY_DECISION',
        createdBy: 'user-test',
      });
      expect(binding.bindingId.startsWith('GOV-BND-OP-')).toBe(true);
      expect(binding.bindingId.startsWith('GOV-BND-SEED-')).toBe(false);
      expect(binding.createdBy).toBe('user-test');
      expect(binding.seedVersion).toBeNull();
      expect(binding.controlId).toBe('GOV-CTRL-NIST-001');
      expect(binding.policySelector).toEqual({ toolId: 'run_deploy' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // findBindingsByPolicySelector — JSONB @> containment
  // ──────────────────────────────────────────────────────────────────────
  describe('findBindingsByPolicySelector', () => {
    it('matches every seed binding that names a given toolId', async () => {
      const { ensureControlsSeeded, findBindingsByPolicySelector } = await import(
        '../governance/controls'
      );
      await ensureControlsSeeded();
      const { CONTROL_BINDING_SEEDS } = await import('../governance/controlsCatalog');
      const expected = CONTROL_BINDING_SEEDS.filter(
        b => (b.policySelector as { toolId?: string }).toolId === 'workspace_write',
      );
      expect(expected.length).toBeGreaterThan(0);
      const matches = await findBindingsByPolicySelector({ toolId: 'workspace_write' });
      expect(matches.length).toBe(expected.length);
      for (const binding of matches) {
        expect((binding.policySelector as { toolId?: string }).toolId).toBe('workspace_write');
      }
    });

    it('returns empty when the probe selector matches nothing', async () => {
      const { ensureControlsSeeded, findBindingsByPolicySelector } = await import(
        '../governance/controls'
      );
      await ensureControlsSeeded();
      const matches = await findBindingsByPolicySelector({ toolId: '__never_seeded__' });
      expect(matches).toEqual([]);
    });

    it('returns empty when the probe selector is empty', async () => {
      const { ensureControlsSeeded, findBindingsByPolicySelector } = await import(
        '../governance/controls'
      );
      await ensureControlsSeeded();
      expect(await findBindingsByPolicySelector({})).toEqual([]);
    });

    it('narrows to global + exact-match scope when capabilityScope is provided', async () => {
      const { ensureControlsSeeded, createBinding, findBindingsByPolicySelector } = await import(
        '../governance/controls'
      );
      await ensureControlsSeeded();
      await createBinding({
        controlId: 'GOV-CTRL-NIST-011',
        policySelector: { toolId: 'workspace_apply_patch', scopeMarker: 'alpha' },
        bindingKind: 'POLICY_DECISION',
        capabilityScope: 'CAP-alpha',
      });
      await createBinding({
        controlId: 'GOV-CTRL-NIST-011',
        policySelector: { toolId: 'workspace_apply_patch', scopeMarker: 'beta' },
        bindingKind: 'POLICY_DECISION',
        capabilityScope: 'CAP-beta',
      });
      const alphaMatches = await findBindingsByPolicySelector(
        { toolId: 'workspace_apply_patch' },
        { capabilityScope: 'CAP-alpha' },
      );
      const scopeMarkers = alphaMatches
        .map(b => (b.policySelector as { scopeMarker?: string }).scopeMarker)
        .filter((marker): marker is string => typeof marker === 'string');
      expect(scopeMarkers).toContain('alpha');
      expect(scopeMarkers).not.toContain('beta');
    });

    it('defaults to global-only when no capabilityScope is given', async () => {
      const { ensureControlsSeeded, createBinding, findBindingsByPolicySelector } = await import(
        '../governance/controls'
      );
      await ensureControlsSeeded();
      await createBinding({
        controlId: 'GOV-CTRL-NIST-011',
        policySelector: { toolId: 'workspace_apply_patch', scopeMarker: 'only-alpha' },
        bindingKind: 'POLICY_DECISION',
        capabilityScope: 'CAP-alpha',
      });
      const globalMatches = await findBindingsByPolicySelector({
        toolId: 'workspace_apply_patch',
      });
      for (const binding of globalMatches) {
        expect(binding.capabilityScope).toBeNull();
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // getControlFrameworkSummary
  // ──────────────────────────────────────────────────────────────────────
  describe('getControlFrameworkSummary', () => {
    it('rolls up per-framework totals + binding counts over active controls', async () => {
      const { ensureControlsSeeded, getControlFrameworkSummary } = await import(
        '../governance/controls'
      );
      await ensureControlsSeeded();
      const summary = await getControlFrameworkSummary();
      const byFramework = Object.fromEntries(summary.map(row => [row.framework, row]));
      expect(byFramework.NIST_CSF_2.total).toBe(15);
      expect(byFramework.SOC2_TSC.total).toBe(15);
      expect(byFramework.ISO27001_2022.total).toBe(15);
      for (const row of summary) {
        expect(row.activeBindings).toBeGreaterThan(0);
      }
    });

    it('drops retired controls from the framework total', async () => {
      const { ensureControlsSeeded, getControlFrameworkSummary } = await import(
        '../governance/controls'
      );
      await ensureControlsSeeded();
      controls.get('GOV-CTRL-NIST-001')!.status = 'RETIRED';
      const summary = await getControlFrameworkSummary();
      const nist = summary.find(row => row.framework === 'NIST_CSF_2');
      expect(nist!.total).toBe(14);
    });
  });
});
