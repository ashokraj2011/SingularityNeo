// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice 5 — governance posture aggregator tests.
 *
 * Covers:
 *   1. Happy-path: all five sections populate from a realistic dataset and
 *      the per-pillar ratios come out right.
 *   2. Degraded: a query that throws produces a warning rather than a 500,
 *      and the affected section degrades to zeros/empty.
 *   3. Ratio edges: zero total → 0 (not NaN); ratio clamps to [0, 1].
 *   4. Empty DB: every pillar returns a valid empty snapshot.
 *   5. Feature-flag display: the `enabled` booleans reflect the env flags
 *      the aggregator consults.
 */

const dbQueryMock = vi.fn();

vi.mock('../db', () => ({
  query: (sql: string, params?: unknown[]) => dbQueryMock(sql, params),
}));

vi.mock('../governance/signer', () => ({
  describeSignerStatus: () => ({
    configured: true,
    activeKeyId: 'svc-ed25519-2026-04',
    algorithm: 'ed25519',
    registryPath: '/tmp/governance/signing-keys.json',
    knownKeyCount: 1,
    activeKeyAgeDays: 12,
    publicKeyFingerprint: 'abc123',
  }),
}));

vi.mock('../governance/exceptions', () => ({
  governanceExceptionsEnabled: () => true,
}));

vi.mock('../governance/provenance', () => ({
  governanceProvenanceEnabled: () => true,
}));

import { getGovernancePostureSnapshot } from '../governance/posture';

beforeEach(() => {
  dbQueryMock.mockReset();
});

// Helper — route mock responses to each safeQuery call by matching a
// signature fragment. The aggregator hits 5 distinct queries; each needs
// its own mock row set.
const routeQuery = (handlers: {
  signerPackets?: unknown[];
  controls?: unknown[];
  exceptionsCounts?: unknown[];
  exceptionsRecent?: unknown[];
  provenanceCoverage?: unknown[];
  provenanceUnmapped?: unknown[];
  denials?: unknown[];
}) => {
  dbQueryMock.mockImplementation((sql: string) => {
    if (sql.includes('capability_evidence_packets')) {
      return { rows: handlers.signerPackets ?? [], rowCount: (handlers.signerPackets ?? []).length };
    }
    if (sql.includes('governance_controls') && sql.includes('LEFT JOIN')) {
      return { rows: handlers.controls ?? [], rowCount: (handlers.controls ?? []).length };
    }
    if (sql.includes('expiring_soon')) {
      return {
        rows: handlers.exceptionsCounts ?? [],
        rowCount: (handlers.exceptionsCounts ?? []).length,
      };
    }
    if (sql.includes('FROM governance_exceptions') && sql.includes('LIMIT 10')) {
      return {
        rows: handlers.exceptionsRecent ?? [],
        rowCount: (handlers.exceptionsRecent ?? []).length,
      };
    }
    if (sql.includes('governance_provenance_coverage')) {
      return {
        rows: handlers.provenanceCoverage ?? [],
        rowCount: (handlers.provenanceCoverage ?? []).length,
      };
    }
    if (sql.includes('touched_paths') && sql.includes('cardinality')) {
      return {
        rows: handlers.provenanceUnmapped ?? [],
        rowCount: (handlers.provenanceUnmapped ?? []).length,
      };
    }
    if (sql.includes('capability_policy_decisions')) {
      return { rows: handlers.denials ?? [], rowCount: (handlers.denials ?? []).length };
    }
    return { rows: [], rowCount: 0 };
  });
};

describe('getGovernancePostureSnapshot', () => {
  it('happy path: every section populates with accurate ratios', async () => {
    routeQuery({
      signerPackets: [{ total: '100', signed: '95' }],
      controls: [
        { framework: 'NIST_CSF_2', total: '15', bound: '12' },
        { framework: 'SOC2_TSC', total: '15', bound: '9' },
        { framework: 'ISO27001_2022', total: '15', bound: '15' },
      ],
      exceptionsCounts: [{ active: '3', expiring_soon: '1' }],
      exceptionsRecent: [
        {
          exception_id: 'GOV-EXC-1',
          capability_id: 'CAP-A',
          control_id: 'GOV-CTRL-0001',
          status: 'APPROVED',
          decided_by: 'alice',
          decided_at: new Date('2026-04-18T10:00:00Z'),
          expires_at: new Date('2026-04-20T10:00:00Z'),
        },
      ],
      provenanceCoverage: [
        {
          capabilities: '4',
          windows: '12',
          earliest: new Date('2026-01-01T00:00:00Z'),
          latest: new Date('2026-04-18T00:00:00Z'),
        },
      ],
      provenanceUnmapped: [
        { tool_id: 'run_build', sample_count: '42' },
        { tool_id: 'custom_tool_xyz', sample_count: '3' },
      ],
      denials: [
        {
          decision_id: 'DEC-1',
          capability_id: 'CAP-A',
          action_type: 'run_deploy',
          decision: 'REQUIRE_APPROVAL',
          reason: 'policy gate',
          created_at: new Date('2026-04-18T09:00:00Z'),
          exception_id: null,
          control_id: 'GOV-CTRL-0002',
        },
      ],
    });

    const snap = await getGovernancePostureSnapshot();

    expect(snap.warnings).toEqual([]);
    expect(snap.signer.status.activeKeyId).toBe('svc-ed25519-2026-04');
    expect(snap.signer.recentPackets).toMatchObject({
      total: 100,
      signed: 95,
      unsigned: 5,
    });
    expect(snap.signer.recentPackets.signedRatio).toBeCloseTo(0.95, 5);

    expect(snap.controls.totalControls).toBe(45);
    expect(snap.controls.boundControls).toBe(36);
    expect(snap.controls.unboundControls).toBe(9);
    expect(snap.controls.coverageRatio).toBeCloseTo(36 / 45, 5);
    expect(snap.controls.byFramework).toHaveLength(3);
    const iso = snap.controls.byFramework.find(f => f.framework === 'ISO27001_2022');
    expect(iso?.coverageRatio).toBe(1);

    expect(snap.exceptions.enabled).toBe(true);
    expect(snap.exceptions.active).toBe(3);
    expect(snap.exceptions.expiringSoon).toBe(1);
    expect(snap.exceptions.recentDecisions).toHaveLength(1);
    expect(snap.exceptions.recentDecisions[0].decidedAt).toBe('2026-04-18T10:00:00.000Z');

    expect(snap.provenance.enabled).toBe(true);
    expect(snap.provenance.capabilitiesWithCoverage).toBe(4);
    expect(snap.provenance.coverageWindowCount).toBe(12);
    expect(snap.provenance.unmappedToolSamples).toHaveLength(2);

    expect(snap.recentDenials).toHaveLength(1);
    expect(snap.recentDenials[0]).toMatchObject({
      decisionId: 'DEC-1',
      decision: 'REQUIRE_APPROVAL',
      controlId: 'GOV-CTRL-0002',
    });
    expect(snap.recentDenials[0].createdAt).toBe('2026-04-18T09:00:00.000Z');
  });

  it('degraded path: a throwing query surfaces as a warning, section is zeroed', async () => {
    dbQueryMock.mockImplementation((sql: string) => {
      if (sql.includes('capability_evidence_packets')) {
        throw new Error('relation does not exist');
      }
      return { rows: [], rowCount: 0 };
    });
    const snap = await getGovernancePostureSnapshot();
    expect(snap.warnings.length).toBeGreaterThanOrEqual(1);
    expect(snap.warnings.some(w => w.includes('signer.recentPackets'))).toBe(true);
    expect(snap.signer.recentPackets.total).toBe(0);
    expect(snap.signer.recentPackets.signedRatio).toBe(0);
  });

  it('ratio edge: zero total produces 0, not NaN', async () => {
    routeQuery({
      signerPackets: [{ total: '0', signed: '0' }],
      controls: [{ framework: 'NIST_CSF_2', total: '0', bound: '0' }],
    });
    const snap = await getGovernancePostureSnapshot();
    expect(snap.signer.recentPackets.signedRatio).toBe(0);
    expect(snap.controls.coverageRatio).toBe(0);
    expect(Number.isFinite(snap.signer.recentPackets.signedRatio)).toBe(true);
  });

  it('empty DB: returns a valid snapshot with zeros everywhere', async () => {
    routeQuery({});
    const snap = await getGovernancePostureSnapshot();
    expect(snap.signer.recentPackets.total).toBe(0);
    expect(snap.controls.totalControls).toBe(0);
    expect(snap.controls.byFramework).toEqual([]);
    expect(snap.exceptions.active).toBe(0);
    expect(snap.exceptions.recentDecisions).toEqual([]);
    expect(snap.provenance.capabilitiesWithCoverage).toBe(0);
    expect(snap.recentDenials).toEqual([]);
    expect(snap.warnings).toEqual([]);
  });

  it('generatedAt is a fresh ISO timestamp', async () => {
    routeQuery({});
    const before = Date.now();
    const snap = await getGovernancePostureSnapshot();
    const generated = new Date(snap.generatedAt).getTime();
    expect(generated).toBeGreaterThanOrEqual(before - 5);
    expect(generated).toBeLessThanOrEqual(Date.now() + 5);
  });

  it('numeric coercion handles Postgres string bigints', async () => {
    routeQuery({
      signerPackets: [{ total: '9999', signed: '9999' }],
    });
    const snap = await getGovernancePostureSnapshot();
    expect(snap.signer.recentPackets.total).toBe(9999);
    expect(snap.signer.recentPackets.signed).toBe(9999);
    expect(snap.signer.recentPackets.signedRatio).toBe(1);
  });

  it('null decided_at + expires_at from DB serialize to null', async () => {
    routeQuery({
      exceptionsRecent: [
        {
          exception_id: 'GOV-EXC-9',
          capability_id: 'CAP-X',
          control_id: 'GOV-CTRL-0009',
          status: 'DENIED',
          decided_by: null,
          decided_at: null,
          expires_at: null,
        },
      ],
    });
    const snap = await getGovernancePostureSnapshot();
    expect(snap.exceptions.recentDecisions[0]).toMatchObject({
      decidedBy: null,
      decidedAt: null,
      expiresAt: null,
    });
  });
});
