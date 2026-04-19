# Governance & Compliance

SingularityNeo's governance layer closes the five load-bearing gaps that
blocked a real audit claim: evidence that can be cryptographically verified,
a controls catalog mapped to external frameworks, a time-bound exception
lifecycle, an indexed prove-the-negative surface, and a one-screen posture
view that aggregates all four. This document is the operator-facing
reference.

## Status at a glance

| Slice | Area                                                                         | Status  |
|-------|------------------------------------------------------------------------------|---------|
| 1     | Signed Change Attestations (signer active + chain verification UI)           | Shipped |
| 2     | Controls catalog + framework mapping (NIST CSF 2.0 / SOC 2 TSC / ISO 27001)  | Shipped |
| 3     | Exception lifecycle (request → approve → expire + policy hook)               | Shipped |
| 4     | Prove-the-negative provenance queries (gap-aware)                            | Shipped |
| 5     | Posture dashboard (read-only aggregate)                                      | Shipped |

Each slice is feature-flag gated (`GOVERNANCE_*` env vars) and independently
reversible. The UI lives under `/governance/*` and is permissioned behind
`report.view.audit` (read) and `access.manage` (write).

## Slice 1 — Signed Change Attestations

Every evidence packet already carries a SHA-256 content digest and a
chain-link to its predecessor. Slice 1 activates the Ed25519 signer so the
chain is cryptographically sealed, and surfaces a verify UI so operators
can prove tamper-evidence without leaving the app.

### Architecture

```
┌────────────────────────────┐
│ Evidence Packet create     │
│  server/evidencePackets.ts │
│                            │
│   digest = sha256(payload) │
│   prev   = latest prior    │
│   root   = prior.root ?? id│
│                            │
│   signAttestation({         │ ─────► governance/signing-keys.json
│     digest, prev,          │        (public registry, committed)
│     root, version          │
│   })                       │
│                            │
│  → signature, signing_key_id
│  → persisted on the row    │
└────────────────────────────┘

Later, on verify:
  GET /api/evidence-packets/:bundleId/verify
    1. Recompute digest over persisted payload.
    2. verifyAttestationSignature() against the registered public key.
    3. Walk prev_bundle_id back to chain_root_bundle_id.
    4. Return { signatureValid, digestMatches, chainIntact, chainDepth, reason }.
```

### Provisioning a signing key

The signer never auto-generates a key at startup — an unaudited key is
worse than no key at all. Provision explicitly:

```bash
npm run governance:init-key
```

This:

1. Generates an Ed25519 keypair via `node:crypto`.
2. Writes the **private** PEM to `.secrets/governance-signing.pem`
   (gitignored, `chmod 600`).
3. Merges the **public** half + metadata into
   `governance/signing-keys.json` (committed, offline-verifiable) and sets
   `activeKeyId` to the new key.
4. Retires the previous active key by flipping `retired: true` and
   stamping `validUntil` so older packets keep verifying.
5. Prints the key id + sha256 fingerprint so you can attest the key
   out-of-band before enabling production signing.

Then point the backend at the key:

```bash
export GOVERNANCE_SIGNING_KEY_PATH="$(pwd)/.secrets/governance-signing.pem"
export GOVERNANCE_SIGNING_ACTIVE_KEY_ID="svc-ed25519-YYYY-MM"
npm run dev:server
```

**Before production**: move the private PEM into a KMS or sealed secret
store. The repo-local PEM is a bootstrapping aid, not a production key
lifecycle tool. The public half must remain in
`governance/signing-keys.json` so downstream verifiers can check signatures
offline with only the repo checkout.

### Verifying a packet

Any evidence packet page now shows a chip band:

- **Signed · svc-ed25519-...** — signature present and valid.
- **Unsigned (legacy)** — packet pre-dates a provisioned signer.
- **Signature invalid** / **Digest mismatch** — tampering detected.
- **Chain v1 intact · depth N** — `prev_bundle_id` walk reached the root
  cleanly.
- **Chain broken · missing_prev_bundle** / `chain_cycle_detected` /
  `chain_root_mismatch` — structural audit failure.

Clicking the chip opens the verify drawer, which re-runs verification
on demand and shows per-link metadata for the full chain.

### API surface (Slice 1)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/evidence-packets/:bundleId/verify` | Verify one packet + walk its chain. Returns `{ signatureValid, digestMatches, chainIntact, chainDepth, chainRootBundleId, signingKeyId, signingAlgo, attestationVersion, reason? }`. |
| `POST` | `/api/attestations/:bundleId/verify`    | Legacy alias; same behavior. |
| `GET`  | `/api/attestations/:bundleId/chain`     | Root-first ordered chain for the work item owning the bundle. |
| `GET`  | `/api/governance/signer/status`          | Operator health: configured, activeKeyId, algorithm, registryPath, knownKeyCount, activeKeyAgeDays, publicKeyFingerprint. Never leaks private-key bytes. |

### What happens if I rotate or lose a key?

- **Rotation**: re-run `npm run governance:init-key`. The old key is
  marked `retired: true` in `governance/signing-keys.json` but its public
  half stays so older packets keep verifying.
- **Key loss (private PEM deleted)**: new packets fall back to
  `signature=NULL` (treated as v1-unsigned). Existing packets keep
  verifying as long as the public half is in the registry. Re-run
  `governance:init-key` to mint a replacement.
- **Registry drift across environments**: commit
  `governance/signing-keys.json`. The registry is intentionally a flat
  JSON file so it travels with the repo and survives a DB wipe.

### Feature flags

Slice 1 has no feature flag — signer activation is purely opt-in via
environment variables. Packets created without key material are written
with `signature=NULL`, a first-class "unsigned" state the verify flow
already understands.

## Slice 2 — Controls Catalog + Framework Mapping

Every enforced policy is bound to at least one external control so auditors
can read platform decisions against a framework instead of internal tool
names.

### Data model

- `governance_controls` — ~45 seeded controls across three frameworks:
  NIST CSF 2.0, SOC 2 TSC 2017, ISO/IEC 27001:2022 Annex A. Each row
  carries `framework`, `control_code`, `control_family`, `title`,
  `description`, `owner_role`, `severity` (`STANDARD`|`SEV_1`), `status`,
  and a `seed_version` so upgrades never clobber operator-added bindings.
- `governance_control_bindings` — many-to-many: an internal policy
  (`{ "actionType": "run_deploy" }`, `{ "toolId": "workspace_write" }`,
  etc.) satisfies one or more external controls. `binding_kind` tags
  whether the binding is a `POLICY_DECISION`, `APPROVAL_FLOW`,
  `SIGNING_REQUIRED`, or `EVIDENCE_PACKET` surface. Seed-owned bindings
  use a `GOV-BND-SEED-` id prefix; operator-created bindings use
  `GOV-BND-` so seed refreshes don't clobber operator work.

Seed source: [`server/governance/controlsCatalog.ts`](../server/governance/controlsCatalog.ts).
The catalog is idempotent — `ensureControlsSeeded()` is invoked inside the
bootstrap transaction so a partial DB wipe never leaves the catalog half
populated.

### Workspace

`/governance/controls` renders the catalog with per-framework filters
and per-control detail (bindings + active-exception count). Binding
creation requires `access.manage` so changing how internal policies map
to external controls is an audit-worthy event.

### API surface (Slice 2)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/governance/controls` | List + per-framework summary. Filter by `framework`, `severity`, `status`, `capabilityScope`. |
| `GET`  | `/api/governance/controls/:controlId` | Control + its bindings + active-exception count. |
| `POST` | `/api/governance/controls/:controlId/bindings` | Admin: add a new binding. `access.manage` required. |

## Slice 3 — Exception Lifecycle

Policy denials can be waived via a first-class, time-bound deviation flow
that's audit-linked and surfaced in the existing approval inbox. This is
the "approved deviation" story auditors expect.

### Data model

- `governance_exceptions` — one row per request. Statuses cycle
  `REQUESTED → APPROVED | DENIED → EXPIRED | REVOKED`. `expires_at` is
  required on creation (v1 rejects null), `decided_at`/`decided_by`
  record the approver, `scope_selector` JSONB narrows the waiver to a
  specific `toolId` / `actionType` / work item.
- `governance_exception_events` — append-only per-exception audit trail
  with one event per state transition
  (`REQUESTED`/`APPROVED`/`DENIED`/`EXPIRED`/`REVOKED`/`COMMENTED`).

### Policy hook

`server/policy.ts:evaluateToolPolicy` consults
`findActiveException({ capabilityId, probe })` before returning a
`REQUIRE_APPROVAL` / `DENY` decision. A matching active exception flips
the decision to `ALLOW` and stamps `exception_id` +
`exception_expires_at` on both the returned `PolicyDecision` and the
`capability_policy_decisions` audit row. If the exceptions query
throws, the hook **fails closed** — a busted flag never silently
bypasses a gate.

### Expiry

Exceptions flip from `APPROVED` to `EXPIRED` via the existing
agent-learning worker tick (no new runner). Every ~15 min,
`expireDueExceptions()` sweeps rows whose `expires_at <= NOW()`, updates
status, writes the terminal event in the same transaction, and emits
`governance.exceptions_expired_count`. The UI surfaces exceptions
expiring in <24h as an amber banner.

### Workspace

`/governance/exceptions` renders the list (filterable by capability,
control, status) plus a request modal and a per-exception drawer that
shows the full event chain. Decisions are also emitted to
`capability_learning_updates` as `GOVERNANCE_EXCEPTION` entries so they
appear on the unified learning/audit timeline alongside corrections.

### Feature flag

`GOVERNANCE_EXCEPTIONS_ENABLED=false` leaves CRUD + audit in place but
makes `findActiveException()` return `null`. In that state the policy
hook behaves as if exceptions don't exist — useful for rolling the
feature back without losing the request history.

### API surface (Slice 3)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/governance/exceptions` | Request. Writes `REQUESTED` event. |
| `POST` | `/api/governance/exceptions/:id/decide` | Approve or deny. Writes terminal event, emits learning update when approved. |
| `POST` | `/api/governance/exceptions/:id/revoke` | Revoke before expiry. |
| `GET`  | `/api/governance/exceptions` | List; filter by `capabilityId`, `controlId`, `status`. |
| `GET`  | `/api/governance/exceptions/active` | Hot path for `evaluateToolPolicy` (`findActiveException`). |
| `GET`  | `/api/governance/exceptions/:id` | Single exception with its event chain. |

## Slice 4 — Prove-the-Negative Provenance

A single API call answers "did any AI touch `services/billing/**`
between T1 and T2?" with three states — touched / not touched / gap — and
never a silent false.

### Data model

```sql
ALTER TABLE capability_tool_invocations
  ADD COLUMN touched_paths TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN actor_kind    TEXT   NOT NULL DEFAULT 'AI';

CREATE INDEX cti_touched_paths_gin ON capability_tool_invocations USING GIN (touched_paths);
CREATE INDEX cti_actor_started_idx ON capability_tool_invocations (actor_kind, started_at DESC);

CREATE TABLE governance_provenance_coverage (
  coverage_id   TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  window_start  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL,
  source        TEXT NOT NULL,   -- 'tool_invocation' | 'flight_recorder' | 'backfill'
  notes         TEXT
);
```

`touched_paths` is populated at write time by a per-tool extractor in
[`server/governance/provenanceExtractor.ts`](../server/governance/provenanceExtractor.ts):
`workspace_write` → `request.path`; `workspace_apply_patch` →
`request.diff.files[*].path`; `run_deploy` → `request.targets[*]`;
filesystem-inert tools (`run_build`, `run_test`, `web_fetch`, …) land
with `[]`. Unknown tools return `null` and fire the
`governance.provenance_unmapped_tool` metric so telemetry catches
extractor drift instead of silent gaps.

### Query surface

```
POST /api/governance/provenance/prove-no-touch
{
  "capabilityId": "cap-123",
  "pathGlob":     "services/billing/**",
  "from":         "2026-04-01T00:00:00Z",
  "to":           "2026-04-18T00:00:00Z",
  "actorKind":    "AI" | "HUMAN" | "ANY"
}
```

The service:

1. Pulls candidate rows using `touched_paths @> $::text[]` for literal
   paths (GIN-indexed) or `EXISTS (... unnest() ... LIKE $)` for globs.
2. For glob queries, refines matches in-memory with a regex that
   honors `**` (any-depth) vs `*` (single-segment) — LIKE alone can't
   tell `src/*.ts` apart from `src/sub/dir.ts`.
3. Fetches the overlapping coverage windows and computes the unclaimed
   gap sub-windows.

Response:

```jsonc
{
  "touched": false,
  "matchingInvocations": [],
  "coverage": {
    "windows":     [{ "start": "...", "end": "...", "source": "tool_invocation" }],
    "hasGap":      true,
    "gapWindows":  [{ "start": "2026-04-12T02:13:00Z", "end": "2026-04-12T04:26:00Z" }]
  },
  "summary": "Inconclusive — logging had a 2h13m gap in the queried window."
}
```

When `hasGap=true`, the UI renders **amber** ("we cannot prove the
negative"); when `hasGap=false` and `touched=false`, it renders
**green**; when `touched=true`, it renders **red** with the matching
invocations.

### Backfill

The `touched_paths` column is additive — rows written before Slice 4
have `[]`. A one-shot script walks the last 90 days:

```bash
node scripts/governance-backfill-provenance.mjs
```

It cursor-paginates by `(started_at, id)` in batches of 500, applies a
plain-JS mirror of the TS extractor (kept hand-synced), commits per
batch, and writes a `governance_provenance_coverage` row per capability
so the query surface knows the backfill window. Re-running is safe.

### Workspace

`/governance/provenance` is the operator query form: capability +
path-glob + date range + actor chip → one of three honest answers, with
a coverage-windows list underneath.

### Feature flag

`GOVERNANCE_PROVENANCE_ENABLED=false` makes the API return a
conservative "inconclusive" result instead of querying. The
`touched_paths` column keeps populating at write time regardless, so
toggling the flag off is reversible without data loss.

### API surface (Slice 4)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/governance/provenance/prove-no-touch` | Three-state gap-aware query. |
| `GET`  | `/api/governance/provenance/coverage?capabilityId=...` | Current logging windows. |

## Slice 5 — Posture Dashboard

`/governance/posture` is the single-page read-over-everything view. It
exists so an operator (or an auditor on a screen-share) gets one glance
that answers "are we compliant right now?" without assembling the picture
from four separate screens.

Pillars:

- **Signer tile** — active key id + `signed / total` ratio over the
  last 30 days of evidence packets. Green ≥99%, amber ≥90%, red below.
- **Control coverage tile** — bound / total controls and per-framework
  breakdown bars. Green ≥80%, amber ≥50%, red below.
- **Active exceptions tile** — count + "N expire in <24h" warning.
- **Provenance tile** — capabilities with coverage rows + total window
  count; reports `Disabled` when `GOVERNANCE_PROVENANCE_ENABLED=false`.
- **Recent exception decisions** — last 10 terminal-state exceptions.
- **Recent non-ALLOW decisions** — last 50 `REQUIRE_APPROVAL` / `DENY`
  outcomes joined to the bound control via JSONB containment on the
  binding's `policy_selector`.
- **Provenance health** — earliest/latest coverage window + a shape-check
  list of top tools landing with empty `touched_paths` (for spotting
  extractor drift).

Every query runs behind a `safeQuery` wrapper — a missing subsystem
table surfaces as a warning string, never a 500. This is important: the
dashboard is often the first thing opened on a fresh bootstrap, and it
needs to explain the state of the world rather than crash against it.

### API surface (Slice 5)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/governance/posture` | Aggregated read-only snapshot. `report.view.audit` required. |

## Observability

Each slice emits structured metric samples into
`capability_metric_samples` using the existing `recordMetricSample` helper:

- `governance.signer_configured` — 0/1 gauge per health check.
- `governance.exceptions_active_count` — gauge, per (capability_id, control_id).
- `governance.exceptions_expired_count` — counter; incremented each sweep tick.
- `governance.provenance_unmapped_tool` — counter; fires when a new tool
  lands without a `touched_paths` extractor mapping so drift surfaces
  as telemetry rather than a silent gap.

## Feature flags

| Env var | Default | Effect when off |
|---------|---------|-----------------|
| `GOVERNANCE_SIGNING_KEY_PATH` / `GOVERNANCE_SIGNING_ACTIVE_KEY_ID` | unset | New packets land with `signature=NULL` (first-class "unsigned"); existing signed packets keep verifying against the registered public key. |
| `GOVERNANCE_EXCEPTIONS_ENABLED` | `true` | `findActiveException()` returns `null` so the policy hook is inert; CRUD, events, and UI keep working for audit. |
| `GOVERNANCE_PROVENANCE_ENABLED` | `true` | `/prove-no-touch` returns a conservative "inconclusive" without querying; `touched_paths` still populates at write time. |

## Tests

| Suite | Coverage |
|-------|----------|
| `server/__tests__/governanceSigner.test.ts` | sign/verify roundtrip + chain-walk invariants. |
| `server/__tests__/governanceControls.test.ts` | list/get/createBinding + seed integrity. |
| `server/__tests__/governanceExceptions.test.ts` | request → decide → expire → revoke lifecycle + chronology. |
| `server/__tests__/policyExceptionHook.test.ts` | `evaluateToolPolicy` flip + stamp + fail-closed. |
| `server/__tests__/governanceProvenance.test.ts` | extractor + glob regex + gap computation + three-state answer. |
| `server/__tests__/governancePosture.test.ts` | aggregator happy path + degraded warning path + ratio edges. |
| `src/components/__tests__/EvidencePacketSignedChip.test.tsx` | UI chip band states. |

## Related

- [Self-Learning Loop — versioning, quality gate, drift, race hardening](./self-learning-loop.md)
- Source: `server/governance/`, `server/evidencePackets.ts`,
  `src/pages/EvidencePacket.tsx`, `src/pages/GovernanceControls.tsx`,
  `src/pages/GovernanceExceptions.tsx`, `src/pages/GovernanceProvenance.tsx`,
  `src/pages/GovernancePosture.tsx`
