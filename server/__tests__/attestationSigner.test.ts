// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildAttestationSigningPayload,
  isSigningConfigured,
  reloadSigningKeyRegistry,
  signAttestation,
  verifyAttestationSignature,
} from '../governance/signer';

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

describe('governance/signer', () => {
  let tempDir: string;
  let envBefore: Record<string, string | undefined>;

  beforeEach(() => {
    envBefore = snapshotEnv();
    tempDir = mkdtempSync(path.join(tmpdir(), 'attest-signer-'));
  });

  afterEach(() => {
    restoreEnv(envBefore);
    reloadSigningKeyRegistry();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const setupKey = (
    keyId = 'svc-ed25519-test-a',
  ): { privatePem: string; publicPem: string; keyId: string } => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
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
          },
        },
      }),
    );
    process.env.GOVERNANCE_SIGNING_KEYS_PATH = keysFile;
    process.env.GOVERNANCE_SIGNING_KEY_PEM = privatePem;
    process.env.GOVERNANCE_SIGNING_ACTIVE_KEY_ID = keyId;
    reloadSigningKeyRegistry();
    return { privatePem, publicPem, keyId };
  };

  it('reports unconfigured when no key material is present', () => {
    // Hide repo-level scaffold and any inherited env so the test is hermetic.
    process.env.GOVERNANCE_SIGNING_KEYS_PATH = path.join(tempDir, 'missing.json');
    delete process.env.GOVERNANCE_SIGNING_KEY_PEM;
    delete process.env.GOVERNANCE_SIGNING_KEY_PATH;
    delete process.env.GOVERNANCE_SIGNING_ACTIVE_KEY_ID;
    reloadSigningKeyRegistry();
    expect(isSigningConfigured()).toBe(false);
    const unsigned = signAttestation({
      digestSha256: 'a'.repeat(64),
      prevBundleId: null,
      chainRootBundleId: 'EVD-root',
      attestationVersion: 1,
    });
    expect(unsigned.signature).toBeNull();
    expect(unsigned.signingKeyId).toBeNull();
  });

  it('round-trips a signature with the canonical payload', () => {
    const { keyId } = setupKey();
    const inputs = {
      digestSha256: 'b'.repeat(64),
      prevBundleId: null,
      chainRootBundleId: 'EVD-root',
      attestationVersion: 1,
    };
    const signed = signAttestation(inputs);
    expect(signed.signature).toBeTypeOf('string');
    expect(signed.signingKeyId).toBe(keyId);
    expect(signed.signingAlgo).toBe('ed25519');
    const verified = verifyAttestationSignature({
      ...inputs,
      signature: signed.signature,
      signingKeyId: signed.signingKeyId,
      recomputedDigestSha256: inputs.digestSha256,
    });
    expect(verified.signatureValid).toBe(true);
    expect(verified.digestMatches).toBe(true);
  });

  it('rejects a tampered digest', () => {
    setupKey();
    const inputs = {
      digestSha256: 'c'.repeat(64),
      prevBundleId: null,
      chainRootBundleId: 'EVD-root',
      attestationVersion: 1,
    };
    const signed = signAttestation(inputs);
    const verified = verifyAttestationSignature({
      ...inputs,
      digestSha256: 'd'.repeat(64), // mutated
      signature: signed.signature,
      signingKeyId: signed.signingKeyId,
      recomputedDigestSha256: 'd'.repeat(64),
    });
    expect(verified.signatureValid).toBe(false);
    expect(verified.reason).toBe('signature_mismatch');
  });

  it('flags digest_matches=false when recomputed digest drifts', () => {
    setupKey();
    const inputs = {
      digestSha256: 'e'.repeat(64),
      prevBundleId: null,
      chainRootBundleId: 'EVD-root',
      attestationVersion: 1,
    };
    const signed = signAttestation(inputs);
    const verified = verifyAttestationSignature({
      ...inputs,
      signature: signed.signature,
      signingKeyId: signed.signingKeyId,
      recomputedDigestSha256: 'f'.repeat(64),
    });
    expect(verified.digestMatches).toBe(false);
    // Signature still valid — it's bound to digestSha256 not recomputed.
    expect(verified.signatureValid).toBe(true);
  });

  it('returns unsigned when signature or keyId is missing', () => {
    setupKey();
    const inputs = {
      digestSha256: 'a'.repeat(64),
      prevBundleId: null,
      chainRootBundleId: 'EVD-root',
      attestationVersion: 1,
    };
    const verified = verifyAttestationSignature({
      ...inputs,
      signature: null,
      signingKeyId: null,
    });
    expect(verified.signatureValid).toBe(false);
    expect(verified.reason).toBe('unsigned');
  });

  it('reports unknown_signing_key when keyId has no registry entry', () => {
    const { privatePem } = setupKey('svc-ed25519-test-a');
    // Replace keys file so the referenced key id is absent.
    const keysFile = path.join(tempDir, 'signing-keys.json');
    writeFileSync(
      keysFile,
      JSON.stringify({ activeKeyId: null, keys: {} }),
    );
    reloadSigningKeyRegistry();
    process.env.GOVERNANCE_SIGNING_KEY_PEM = privatePem;
    const inputs = {
      digestSha256: 'a'.repeat(64),
      prevBundleId: null,
      chainRootBundleId: 'EVD-root',
      attestationVersion: 1,
    };
    const verified = verifyAttestationSignature({
      ...inputs,
      signature: 'AA==',
      signingKeyId: 'svc-ed25519-test-a',
    });
    expect(verified.signatureValid).toBe(false);
    expect(verified.reason).toBe('unknown_signing_key');
  });

  it('payload bytes are stable across calls', () => {
    const a = buildAttestationSigningPayload({
      digestSha256: '11'.padEnd(64, '1'),
      prevBundleId: 'EVD-prev',
      chainRootBundleId: 'EVD-root',
      attestationVersion: 1,
    });
    const b = buildAttestationSigningPayload({
      digestSha256: '11'.padEnd(64, '1'),
      prevBundleId: 'EVD-prev',
      chainRootBundleId: 'EVD-root',
      attestationVersion: 1,
    });
    expect(a.equals(b)).toBe(true);
    const c = buildAttestationSigningPayload({
      digestSha256: '11'.padEnd(64, '1'),
      prevBundleId: null,
      chainRootBundleId: 'EVD-root',
      attestationVersion: 1,
    });
    expect(a.equals(c)).toBe(false);
  });
});
