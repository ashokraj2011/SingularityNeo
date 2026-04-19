// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Slice 1 — Governance signer surface tests.
 *
 * The unit tests in attestationSigner.test.ts already cover sign/verify
 * round-trip at the primitive level. This suite exercises the additions
 * layered on top for Slice 1:
 *
 *   1. describeSignerStatus() — operator health view. Must return
 *      configured=true / active key id / fingerprint / age-in-days when a
 *      key is provisioned, and configured=false when no key material is
 *      reachable.
 *   2. verifyEvidencePacket() chain-walk — intact chain, missing-prev
 *      (tampered / deleted middle link), cycle detection, chain-root
 *      mismatch. The walk is the only way the UI can prove the full
 *      audit chain is intact, so each failure reason is asserted
 *      explicitly.
 */

// ──────────────────────────────────────────────────────────────────────────
// Module-level pg-mock — verifyEvidencePacket reads capability_evidence_packets
// via `query`. We back it with a Map keyed on bundle_id and respond based on
// the $1 parameter shape (sql matchers keep the test resilient to comment
// drift).
// ──────────────────────────────────────────────────────────────────────────

type MockRow = Record<string, any>;
type MockQueryResult = { rows: MockRow[]; rowCount: number };

const store = new Map<string, MockRow>();
const queryImpl = async (sql: string, params?: unknown[]): Promise<MockQueryResult> => {
  if (
    sql.includes('FROM capability_evidence_packets') &&
    sql.includes('bundle_id = $1')
  ) {
    const bundleId = params?.[0] as string;
    const row = store.get(bundleId);
    return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  return { rows: [], rowCount: 0 };
};

vi.mock('../db', () => ({
  query: (sql: string, params?: unknown[]) => queryImpl(sql, params),
  transaction: async <T>(fn: (client: { query: typeof queryImpl }) => Promise<T>): Promise<T> =>
    fn({ query: queryImpl }),
  withClient: async <T>(fn: (client: { query: typeof queryImpl }) => Promise<T>): Promise<T> =>
    fn({ query: queryImpl }),
  getPlatformFeatureState: () => ({
    pgvectorAvailable: false,
    memoryEmbeddingDimensions: 256,
  }),
  resetDatabasePool: async () => {},
  setDatabaseRuntimeConfig: async () => {},
  inspectDatabaseBootstrapStatus: async () => ({ ready: false }),
  getDatabaseRuntimeInfo: () => ({}),
  initializeDatabase: async () => {},
  getPool: async () => ({}),
}));

// `getIncidentLinksForPacket` is imported by evidencePackets at module load;
// we don't exercise the incidents path so stub it out.
vi.mock('../incidents/repository', () => ({
  getIncidentLinksForPacket: async () => [],
}));

const ENV_KEYS = [
  'GOVERNANCE_SIGNING_KEY_PEM',
  'GOVERNANCE_SIGNING_KEY_PATH',
  'GOVERNANCE_SIGNING_ACTIVE_KEY_ID',
  'GOVERNANCE_SIGNING_KEYS_PATH',
] as const;

const snapshotEnv = (): Record<string, string | undefined> => {
  const prev: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) prev[key] = process.env[key];
  return prev;
};

const restoreEnv = (snapshot: Record<string, string | undefined>) => {
  for (const key of ENV_KEYS) {
    const prev = snapshot[key];
    if (typeof prev === 'string') process.env[key] = prev;
    else delete process.env[key];
  }
};

describe('governance/signer Slice 1 surface', () => {
  let tempDir: string;
  let envBefore: Record<string, string | undefined>;

  beforeEach(() => {
    envBefore = snapshotEnv();
    tempDir = mkdtempSync(path.join(tmpdir(), 'gov-signer-slice1-'));
    store.clear();
  });

  afterEach(() => {
    restoreEnv(envBefore);
    rmSync(tempDir, { recursive: true, force: true });
  });

  const configureSigner = (keyId = 'svc-ed25519-test-slice1') => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const validFrom = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const keysFile = path.join(tempDir, 'signing-keys.json');
    writeFileSync(
      keysFile,
      JSON.stringify({
        activeKeyId: keyId,
        keys: {
          [keyId]: {
            signing_key_id: keyId,
            algorithm: 'ed25519',
            publicKeyPem: publicPem,
            validFrom,
          },
        },
      }),
    );
    process.env.GOVERNANCE_SIGNING_KEYS_PATH = keysFile;
    process.env.GOVERNANCE_SIGNING_KEY_PEM = privatePem;
    process.env.GOVERNANCE_SIGNING_ACTIVE_KEY_ID = keyId;
    return { keyId, publicPem, fingerprint: createHash('sha256').update(publicPem, 'utf8').digest('hex') };
  };

  // ──────────────────────────────────────────────────────────────────────
  // describeSignerStatus — operator health view
  // ──────────────────────────────────────────────────────────────────────
  describe('describeSignerStatus', () => {
    it('reports configured=false with null key id when nothing is provisioned', async () => {
      process.env.GOVERNANCE_SIGNING_KEYS_PATH = path.join(tempDir, 'missing.json');
      delete process.env.GOVERNANCE_SIGNING_KEY_PEM;
      delete process.env.GOVERNANCE_SIGNING_KEY_PATH;
      delete process.env.GOVERNANCE_SIGNING_ACTIVE_KEY_ID;
      const { describeSignerStatus, reloadSigningKeyRegistry } = await import('../governance/signer');
      reloadSigningKeyRegistry();
      const status = describeSignerStatus();
      expect(status.configured).toBe(false);
      expect(status.activeKeyId).toBeNull();
      expect(status.publicKeyFingerprint).toBeNull();
      expect(status.knownKeyCount).toBe(0);
      expect(status.algorithm).toBe('ed25519');
    });

    it('reports configured=true with fingerprint and age when a key is active', async () => {
      const { fingerprint, keyId } = configureSigner();
      const { describeSignerStatus, reloadSigningKeyRegistry } = await import('../governance/signer');
      reloadSigningKeyRegistry();
      const status = describeSignerStatus();
      expect(status.configured).toBe(true);
      expect(status.activeKeyId).toBe(keyId);
      expect(status.publicKeyFingerprint).toBe(fingerprint);
      expect(status.activeKeyAgeDays).toBeGreaterThanOrEqual(3);
      expect(status.knownKeyCount).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // verifyEvidencePacket chain-walk
  // ──────────────────────────────────────────────────────────────────────
  describe('verifyEvidencePacket chain walk', () => {
    // Helper: build a row compatible with evidencePacketFromRow, sign it
    // against the configured key, and shove it into the pg-mock store.
    const insertSignedPacket = async (args: {
      bundleId: string;
      prevBundleId: string | null;
      chainRootBundleId: string;
      payload?: Record<string, unknown>;
      tamperPayload?: boolean;
    }) => {
      const { signAttestation } = await import('../governance/signer');
      const payload = args.payload ?? { runEvents: [], bundleId: args.bundleId };
      const stableStringify = (value: unknown): string => {
        if (value === null || value === undefined) return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
        if (typeof value === 'object') {
          return `{${Object.keys(value as Record<string, unknown>)
            .sort((left, right) => left.localeCompare(right))
            .map(
              key =>
                `${JSON.stringify(key)}:${stableStringify(
                  (value as Record<string, unknown>)[key],
                )}`,
            )
            .join(',')}}`;
        }
        return JSON.stringify(value);
      };
      const digestSha256 = createHash('sha256')
        .update(stableStringify(payload))
        .digest('hex');
      const signed = signAttestation({
        digestSha256,
        prevBundleId: args.prevBundleId,
        chainRootBundleId: args.chainRootBundleId,
        attestationVersion: 1,
      });
      store.set(args.bundleId, {
        bundle_id: args.bundleId,
        capability_id: 'CAP-test',
        work_item_id: 'WI-test',
        run_id: null,
        title: `t-${args.bundleId}`,
        summary: 's',
        digest_sha256: digestSha256,
        generated_by_actor_display_name: 'Test',
        created_at: new Date().toISOString(),
        touched_paths: [],
        attestation_version: 1,
        prev_bundle_id: args.prevBundleId,
        chain_root_bundle_id: args.chainRootBundleId,
        signature: signed.signature,
        signing_key_id: signed.signingKeyId,
        signing_algo: signed.signingAlgo,
        is_ai_assisted: true,
        ai_attribution: null,
        // Tampered payload: digest stored but payload mutated, so the
        // recomputed digest inside verifyEvidencePacket will drift.
        payload: args.tamperPayload
          ? { ...payload, __tampered__: true }
          : payload,
      });
    };

    it('reports signatureValid + digestMatches + chainIntact for a clean 3-link chain', async () => {
      configureSigner();
      const { reloadSigningKeyRegistry } = await import('../governance/signer');
      reloadSigningKeyRegistry();

      const root = 'EVD-root';
      const middle = 'EVD-middle';
      const leaf = 'EVD-leaf';
      await insertSignedPacket({ bundleId: root, prevBundleId: null, chainRootBundleId: root });
      await insertSignedPacket({
        bundleId: middle,
        prevBundleId: root,
        chainRootBundleId: root,
      });
      await insertSignedPacket({
        bundleId: leaf,
        prevBundleId: middle,
        chainRootBundleId: root,
      });

      const { verifyEvidencePacket } = await import('../evidencePackets');
      const result = await verifyEvidencePacket(leaf);
      expect(result).not.toBeNull();
      expect(result!.signatureValid).toBe(true);
      expect(result!.digestMatches).toBe(true);
      expect(result!.chainIntact).toBe(true);
      expect(result!.chainDepth).toBe(2); // leaf → middle → root = 2 hops back
      expect(result!.chainRootBundleId).toBe(root);
      expect(result!.reason).toBeUndefined();
    });

    it('flags chainIntact=false with missing_prev_bundle when a middle link is gone', async () => {
      configureSigner();
      const { reloadSigningKeyRegistry } = await import('../governance/signer');
      reloadSigningKeyRegistry();

      const root = 'EVD-root';
      const leaf = 'EVD-leaf';
      await insertSignedPacket({ bundleId: root, prevBundleId: null, chainRootBundleId: root });
      // Leaf claims prev=EVD-middle but EVD-middle is not in the store.
      await insertSignedPacket({
        bundleId: leaf,
        prevBundleId: 'EVD-middle',
        chainRootBundleId: root,
      });

      const { verifyEvidencePacket } = await import('../evidencePackets');
      const result = await verifyEvidencePacket(leaf);
      expect(result!.chainIntact).toBe(false);
      expect(result!.reason).toBe('missing_prev_bundle');
    });

    it('detects a prev_bundle_id cycle', async () => {
      configureSigner();
      const { reloadSigningKeyRegistry } = await import('../governance/signer');
      reloadSigningKeyRegistry();

      // A → B → A (cycle). The walk should terminate on visited-set hit.
      await insertSignedPacket({ bundleId: 'EVD-A', prevBundleId: 'EVD-B', chainRootBundleId: 'EVD-A' });
      await insertSignedPacket({ bundleId: 'EVD-B', prevBundleId: 'EVD-A', chainRootBundleId: 'EVD-A' });

      const { verifyEvidencePacket } = await import('../evidencePackets');
      const result = await verifyEvidencePacket('EVD-A');
      expect(result!.chainIntact).toBe(false);
      expect(result!.reason).toBe('chain_cycle_detected');
    });

    it('flags chain_root_mismatch when prev-chain terminates at a different root', async () => {
      configureSigner();
      const { reloadSigningKeyRegistry } = await import('../governance/signer');
      reloadSigningKeyRegistry();

      const claimedRoot = 'EVD-claimed-root';
      const actualRoot = 'EVD-actual-root';
      await insertSignedPacket({
        bundleId: actualRoot,
        prevBundleId: null,
        chainRootBundleId: actualRoot,
      });
      // Leaf claims its root is `claimedRoot` but the prev-walk lands on
      // `actualRoot`. That's a mismatch, not a missing link.
      await insertSignedPacket({
        bundleId: 'EVD-leaf',
        prevBundleId: actualRoot,
        chainRootBundleId: claimedRoot,
      });

      const { verifyEvidencePacket } = await import('../evidencePackets');
      const result = await verifyEvidencePacket('EVD-leaf');
      expect(result!.chainIntact).toBe(false);
      expect(result!.reason).toBe('chain_root_mismatch');
    });

    it('flags digestMatches=false when the persisted payload drifts from the stored digest', async () => {
      configureSigner();
      const { reloadSigningKeyRegistry } = await import('../governance/signer');
      reloadSigningKeyRegistry();

      await insertSignedPacket({
        bundleId: 'EVD-tampered',
        prevBundleId: null,
        chainRootBundleId: 'EVD-tampered',
        tamperPayload: true,
      });

      const { verifyEvidencePacket } = await import('../evidencePackets');
      const result = await verifyEvidencePacket('EVD-tampered');
      expect(result!.digestMatches).toBe(false);
      // Chain is fine — only the payload is tampered.
      expect(result!.chainIntact).toBe(true);
    });

    it('returns null when the bundle does not exist', async () => {
      const { verifyEvidencePacket } = await import('../evidencePackets');
      const result = await verifyEvidencePacket('EVD-does-not-exist');
      expect(result).toBeNull();
    });
  });
});
