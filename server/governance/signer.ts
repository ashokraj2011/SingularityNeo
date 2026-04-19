/**
 * Ed25519 signer for Signed Change Attestations.
 *
 * The private key is read from an environment variable (GOVERNANCE_SIGNING_KEY_PEM)
 * or, if present, from a file at GOVERNANCE_SIGNING_KEY_PATH. Verification
 * keys (public-only) live in governance/signing-keys.json so that downstream
 * consumers can verify attestations offline with only the repo checkout.
 *
 * Signed payload (deterministic, UTF-8):
 *   sha256(
 *     digest_sha256 || "\n" ||
 *     (prev_bundle_id ?? "") || "\n" ||
 *     (chain_root_bundle_id ?? bundle_id) || "\n" ||
 *     String(attestation_version)
 *   )
 *
 * HMAC was rejected — symmetric signing gives no non-repudiation.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SIGNING_ALGO = 'ed25519' as const;
const KEYS_FILE_ENV = 'GOVERNANCE_SIGNING_KEYS_PATH';
const PRIVATE_KEY_PEM_ENV = 'GOVERNANCE_SIGNING_KEY_PEM';
const PRIVATE_KEY_PATH_ENV = 'GOVERNANCE_SIGNING_KEY_PATH';
const ACTIVE_KEY_ID_ENV = 'GOVERNANCE_SIGNING_ACTIVE_KEY_ID';

export type AttestationSigningInputs = {
  digestSha256: string;
  prevBundleId?: string | null;
  chainRootBundleId: string;
  attestationVersion: number;
};

export type AttestationSignature = {
  signature: string | null;
  signingKeyId: string | null;
  signingAlgo: typeof SIGNING_ALGO;
};

export type AttestationSignatureVerification = {
  signatureValid: boolean;
  digestMatches: boolean;
  reason?: string;
};

type PublicKeyRegistryEntry = {
  signing_key_id: string;
  algorithm?: string;
  publicKeyPem: string;
  validFrom?: string;
  validUntil?: string | null;
  retired?: boolean;
};

type PublicKeyRegistry = {
  activeKeyId: string | null;
  keys: Record<string, PublicKeyRegistryEntry | Record<string, unknown>>;
};

const DEFAULT_KEYS_FILE_RELATIVE = 'governance/signing-keys.json';

const resolveKeysFilePath = (): string => {
  const override = process.env[KEYS_FILE_ENV];
  if (override && override.trim().length > 0) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }
  return path.resolve(process.cwd(), DEFAULT_KEYS_FILE_RELATIVE);
};

let cachedRegistry: PublicKeyRegistry | null = null;
let cachedRegistryPath: string | null = null;

const loadPublicKeyRegistry = (): PublicKeyRegistry => {
  const file = resolveKeysFilePath();
  if (cachedRegistry && cachedRegistryPath === file) {
    return cachedRegistry;
  }
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as PublicKeyRegistry;
    cachedRegistry = {
      activeKeyId:
        typeof parsed.activeKeyId === 'string' && parsed.activeKeyId.length > 0
          ? parsed.activeKeyId
          : null,
      keys: parsed.keys && typeof parsed.keys === 'object' ? parsed.keys : {},
    };
  } catch {
    cachedRegistry = { activeKeyId: null, keys: {} };
  }
  cachedRegistryPath = file;
  return cachedRegistry;
};

export const reloadSigningKeyRegistry = (): void => {
  cachedRegistry = null;
  cachedRegistryPath = null;
};

const isUsablePublicEntry = (
  entry: PublicKeyRegistryEntry | Record<string, unknown> | undefined,
): entry is PublicKeyRegistryEntry => {
  if (!entry || typeof entry !== 'object') return false;
  const candidate = entry as Partial<PublicKeyRegistryEntry>;
  if (typeof candidate.publicKeyPem !== 'string' || candidate.publicKeyPem.trim().length === 0) {
    return false;
  }
  if (candidate.retired) return false;
  return true;
};

const resolvePublicKey = (signingKeyId: string): string | null => {
  const registry = loadPublicKeyRegistry();
  const entry = registry.keys[signingKeyId];
  if (!isUsablePublicEntry(entry)) return null;
  return entry.publicKeyPem;
};

const resolveActiveKeyId = (): string | null => {
  const override = process.env[ACTIVE_KEY_ID_ENV];
  if (override && override.trim().length > 0) return override.trim();
  const registry = loadPublicKeyRegistry();
  if (registry.activeKeyId && isUsablePublicEntry(registry.keys[registry.activeKeyId])) {
    return registry.activeKeyId;
  }
  return null;
};

const loadPrivateKeyPem = (): string | null => {
  const inline = process.env[PRIVATE_KEY_PEM_ENV];
  if (inline && inline.trim().length > 0) {
    return inline.replace(/\\n/g, '\n');
  }
  const filePath = process.env[PRIVATE_KEY_PATH_ENV];
  if (filePath && filePath.trim().length > 0) {
    try {
      return readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Build the canonical bytes signed for an attestation. Exported so callers can
 * re-compute to verify an on-disk signature out-of-band.
 */
export const buildAttestationSigningPayload = (
  inputs: AttestationSigningInputs,
): Buffer => {
  const canonical = [
    inputs.digestSha256,
    inputs.prevBundleId ?? '',
    inputs.chainRootBundleId,
    String(inputs.attestationVersion),
  ].join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest();
};

/**
 * Sign an attestation. Returns nulls when signing is not configured — the
 * caller persists the row unsigned and downstream verify treats it as
 * legacy / v1-unsigned rather than failing.
 */
export const signAttestation = (
  inputs: AttestationSigningInputs,
): AttestationSignature => {
  const privateKeyPem = loadPrivateKeyPem();
  const activeKeyId = resolveActiveKeyId();
  if (!privateKeyPem || !activeKeyId) {
    return { signature: null, signingKeyId: null, signingAlgo: SIGNING_ALGO };
  }
  try {
    const privateKey = createPrivateKey({ key: privateKeyPem, format: 'pem' });
    const payload = buildAttestationSigningPayload(inputs);
    const signature = sign(null, payload, privateKey).toString('base64');
    return { signature, signingKeyId: activeKeyId, signingAlgo: SIGNING_ALGO };
  } catch {
    return { signature: null, signingKeyId: null, signingAlgo: SIGNING_ALGO };
  }
};

export const verifyAttestationSignature = (
  inputs: AttestationSigningInputs & {
    signature: string | null;
    signingKeyId: string | null;
    recomputedDigestSha256?: string | null;
  },
): AttestationSignatureVerification => {
  const digestMatches =
    typeof inputs.recomputedDigestSha256 === 'string'
      ? inputs.recomputedDigestSha256 === inputs.digestSha256
      : true;

  if (!inputs.signature || !inputs.signingKeyId) {
    return {
      signatureValid: false,
      digestMatches,
      reason: 'unsigned',
    };
  }

  const publicKeyPem = resolvePublicKey(inputs.signingKeyId);
  if (!publicKeyPem) {
    return {
      signatureValid: false,
      digestMatches,
      reason: 'unknown_signing_key',
    };
  }

  try {
    const publicKey = createPublicKey({ key: publicKeyPem, format: 'pem' });
    const payload = buildAttestationSigningPayload(inputs);
    const signatureBuffer = Buffer.from(inputs.signature, 'base64');
    const ok = verify(null, payload, publicKey, signatureBuffer);
    return {
      signatureValid: ok,
      digestMatches,
      reason: ok ? undefined : 'signature_mismatch',
    };
  } catch {
    return {
      signatureValid: false,
      digestMatches,
      reason: 'verify_error',
    };
  }
};

export const isSigningConfigured = (): boolean => {
  return loadPrivateKeyPem() !== null && resolveActiveKeyId() !== null;
};
