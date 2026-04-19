#!/usr/bin/env node
/**
 * governance-init-key — Provision an Ed25519 signing key for Signed Change
 * Attestations.
 *
 * We deliberately do NOT auto-generate a key at backend startup: a key nobody
 * audited is worse than no key. This script is run explicitly by an operator,
 * produces a keypair locally, writes the *public* half into
 * `governance/signing-keys.json` (committed, offline-verifiable), and keeps
 * the *private* half in `.secrets/governance-signing.pem` (gitignored).
 *
 * Flow (idempotent on re-run with --force):
 *   1. Generate an ed25519 keypair via node:crypto.
 *   2. Write the PEM-encoded private key to .secrets/governance-signing.pem
 *      (chmod 600). Bail if the file already exists unless --force is set.
 *   3. Merge the public half + metadata into governance/signing-keys.json
 *      and set it as activeKeyId.
 *   4. Print the key id and sha256 fingerprint so the operator can attest it
 *      out-of-band before enabling production signing.
 *
 * After running:
 *   export GOVERNANCE_SIGNING_KEY_PATH=$(pwd)/.secrets/governance-signing.pem
 *   export GOVERNANCE_SIGNING_ACTIVE_KEY_ID=<printed key id>
 *   restart the backend → new evidence packets now sign.
 *
 * The private key should be moved to a KMS or sealed secret store before
 * production use. This script is a bootstrapping step, not a production
 * key lifecycle tool.
 */
import { createHash, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);

const force = hasFlag('--force');
const showHelp = hasFlag('--help') || hasFlag('-h');

if (showHelp) {
  console.log(`Usage: npm run governance:init-key [-- --force] [-- --id <key-id>]

Generates a new ed25519 keypair for Signed Change Attestations.

Writes:
  .secrets/governance-signing.pem       (private key, chmod 600, gitignored)
  governance/signing-keys.json          (public registry, committed)

Prints the key id + sha256 fingerprint so the operator can attest the new
key out-of-band before enabling production signing.

Options:
  --force        Overwrite an existing .secrets/governance-signing.pem
  --id <id>      Use the given signing key id instead of the auto-generated one
  --help, -h     Show this help text
`);
  process.exit(0);
}

const resolveArgValue = (name) => {
  const idx = args.indexOf(name);
  if (idx === -1 || idx === args.length - 1) return null;
  const value = args[idx + 1];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const repoRoot = process.cwd();
const secretsDir = path.join(repoRoot, '.secrets');
const privateKeyPath = path.join(secretsDir, 'governance-signing.pem');
const registryPath = path.join(repoRoot, 'governance', 'signing-keys.json');

if (existsSync(privateKeyPath) && !force) {
  console.error(
    `error: ${path.relative(repoRoot, privateKeyPath)} already exists. ` +
      `Re-run with --force to overwrite (the old key's public half stays in ` +
      `signing-keys.json marked retired so previously-signed packets keep verifying).`,
  );
  process.exit(1);
}

if (!existsSync(secretsDir)) {
  mkdirSync(secretsDir, { recursive: true });
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

writeFileSync(privateKeyPath, privatePem, { encoding: 'utf8', mode: 0o600 });
try {
  chmodSync(privateKeyPath, 0o600);
} catch {
  // Best-effort; Windows filesystems don't honor POSIX bits.
}

const yyyymm = new Date().toISOString().slice(0, 7); // '2026-04'
const generatedKeyId = resolveArgValue('--id') || `svc-ed25519-${yyyymm}`;

const registry = (() => {
  if (!existsSync(registryPath)) {
    return { activeKeyId: null, keys: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
    return {
      activeKeyId: typeof parsed.activeKeyId === 'string' ? parsed.activeKeyId : null,
      keys: parsed.keys && typeof parsed.keys === 'object' ? parsed.keys : {},
    };
  } catch {
    return { activeKeyId: null, keys: {} };
  }
})();

// Strip the `__scaffold__` placeholder (if any) so the registry is clean.
if (registry.keys.__scaffold__) {
  delete registry.keys.__scaffold__;
}

// Retire the previous active key rather than deleting it — old packets must
// keep verifying against its public half.
if (registry.activeKeyId && registry.keys[registry.activeKeyId]) {
  const prior = registry.keys[registry.activeKeyId];
  registry.keys[registry.activeKeyId] = {
    ...prior,
    retired: true,
    validUntil: new Date().toISOString(),
  };
}

registry.activeKeyId = generatedKeyId;
registry.keys[generatedKeyId] = {
  signing_key_id: generatedKeyId,
  algorithm: 'ed25519',
  publicKeyPem: publicPem,
  validFrom: new Date().toISOString(),
  validUntil: null,
  retired: false,
};

if (!existsSync(path.dirname(registryPath))) {
  mkdirSync(path.dirname(registryPath), { recursive: true });
}
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

const fingerprint = createHash('sha256').update(publicPem, 'utf8').digest('hex');

console.log('Governance signing key provisioned.');
console.log('');
console.log(`  key id:       ${generatedKeyId}`);
console.log(`  algorithm:    ed25519`);
console.log(`  public sha256: ${fingerprint}`);
console.log('');
console.log(`  private key:  ${path.relative(repoRoot, privateKeyPath)}   (chmod 600, gitignored)`);
console.log(`  public keys:  ${path.relative(repoRoot, registryPath)}   (committed, offline-verifiable)`);
console.log('');
console.log('Next:');
console.log(`  export GOVERNANCE_SIGNING_KEY_PATH="${privateKeyPath}"`);
console.log(`  export GOVERNANCE_SIGNING_ACTIVE_KEY_ID="${generatedKeyId}"`);
console.log('  # then restart the backend; new evidence packets will be signed.');
console.log('');
console.log('Before production use: move the private PEM into a KMS / sealed');
console.log('secret store and distribute the fingerprint above via an out-of-band');
console.log('channel so verifiers can attest the key was not swapped in transit.');
