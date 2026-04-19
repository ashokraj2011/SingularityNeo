# Self-Learning Loop — Robustness Upgrade

The self-learning loop takes signals from runs, corrections, and reflections and
distills them into a per-agent knowledge profile that the inference path injects
into system prompts. The upgrade described here makes every profile transition
**versioned, gated, observable, and reversible** while preserving the existing
async-job architecture (queue + worker + lease).

> Status: Slices A–D shipped. Slice E (correction preview + undo) and Slice F
> (rule attribution at inference time) are follow-ups.

## Design principles (locked)

- **Safety first**. Never silently overwrite a live profile. A failed refresh
  must not leave operators without a working agent.
- **Operator-driven revert, never auto-revert**. Drift is flagged and surfaced;
  a human decides whether to roll back.
- **Append-only audit**. Every state transition is a row in
  `capability_learning_updates`. No new audit table.
- **Reuse the queue**. Judge evaluations, memory refreshes, and drift checks
  ride the existing learning job worker — no second runner.
- **Retain the recent history**. Keep the last 20 profile versions per agent
  plus every `USER_CORRECTION` version. Older versions can be archived behind
  a flag.

## Data model

### `capability_agent_learning_profiles` (live pointer — extended)

```
current_version_id        -- pointer into *_profile_versions
previous_version_id       -- prior live version, used for revert + drift baseline
canary_started_at         -- reset on every pointer flip
canary_request_count
canary_negative_count
drift_flagged_at
drift_reason
drift_regression_streak
drift_last_checked_at
```

The existing denormalized fields (`summary`, `highlights`, `context_block`, and
`source_*`) remain as a cheap "current view" for hot-path reads.

### `capability_agent_learning_profile_versions` (new — append-only)

Every refresh writes a row here inside the same transaction that flips the live
pointer. Versions are keyed by `(capability_id, version_id)` with a monotonic
`version_no` per `(capability_id, agent_id)`. Quality-gate outcomes
(`shape_report`, `judge_score`, `judge_report`) and the frozen outgoing canary
counters (`frozen_request_count`, `frozen_negative_count`, `frozen_at`) live on
the version row so drift detection can compare against a stable baseline.

### `capability_agent_eval_fixtures` (new)

Small evaluation set bootstrapped from recent high-signal agent sessions. The
async LLM-judge scores each new profile version against up to 10 fixtures. The
bootstrap keys on sessions with no `USER_CORRECTION` follow-up and at least two
turns, refreshed weekly.

## Slice A — Profile versioning & append-only history

Writes go through `commitAgentLearningProfileVersion`:

1. `SELECT ... FOR UPDATE` the live profile row.
2. `SELECT COALESCE(MAX(version_no), 0) + 1` to get the next version number.
3. `INSERT` the version row with the candidate payload + shape/judge metadata.
4. `UPDATE` the live profile to flip `current_version_id` and roll
   `previous_version_id` forward.

`activateAgentLearningProfileVersion` flips the pointer back to a prior version
without producing a new row. `listAgentLearningProfileVersions` returns the
history newest-first for the UI disclosure.

Reverts emit a `VERSION_REVERTED` update event.

## Slice B — Quality gate before READY

Before the pointer flips:

1. **Synchronous shape checks (blocking)**
   - summary non-empty, highlights ≥ 3, context-block token budget (default
     2000 tokens via `estimateTokenCount`), optional `requireSources`. A
     blocking failure persists the candidate with `status='REVIEW_PENDING'`,
     populates `last_error`, and holds the pointer on the prior version.
2. **Async LLM-judge (non-blocking, advisory)**
   - `scheduleJudgeEvaluation` bootstraps fixtures from `capability_agent_sessions`
     when none exist, replays up to 10 fixtures with `requestGitHubModel`, and
     writes `judge_score` + `judge_report` back onto the version row. Scores
     below the pass threshold emit telemetry; they do not auto-revert.

Shape-check failures never blank the live agent — the prior version keeps
serving inference. The error chip on the lens surfaces the specific failure
code (`SUMMARY_EMPTY`, `HIGHLIGHTS_TOO_FEW`, `CONTEXT_BLOCK_TOO_LARGE`,
`SOURCE_COUNT_ZERO`).

## Slice C — Drift detection & operator-flagged revert

On each flip, the outgoing version's canary counters are frozen onto its
version row and the live profile's counters reset to zero. Traffic against the
new version feeds `canary_request_count` / `canary_negative_count`; strong
negative signals like user corrections bump both counters.

`evaluateAgentLearningDrift` is a pure function (takes `now: Date`) that classifies:

- `INSUFFICIENT_SIGNAL` — baseline too small, canary too young, or canary too light.
- `HEALTHY` — delta below threshold (default 15pp); resets the regression streak.
- `REGRESSING` — delta above threshold. Streak increments; flagged on the second
  consecutive check.

When newly flagged, `drift_flagged_at` + `drift_reason` are written and a
`DRIFT_FLAGGED` audit event is appended. The lens renders a red banner with
the reason + a "Revert to v{N-1}" action; reverts route through the Slice A
activate path.

Environment flags:
- `LEARNING_DRIFT_ENABLED=false` disables detection entirely.
- `LEARNING_DRIFT_DRY_RUN=true` computes + emits telemetry without mutating
  state (observability-only rollout mode).

## Slice D — Failure observability & race hardening

**Advisory lock**. `withAgentLearningLock({ capabilityId, agentId, attempts, delayMs }, work)`
runs `work` inside a pg transaction holding
`pg_try_advisory_xact_lock(hashtextextended(key, 0))` with
`key = "agent-learning:{capabilityId}|{agentId}"`. Three attempts × 50 ms
default; on timeout the thrown error carries `.code = 'AGENT_LEARNING_LOCK_TIMEOUT'`
and the caller falls through to the idempotent queue.

`applyAgentLearningCorrection` wraps ONLY the critical state writes (bundle
load, agent lookup, learning note update, append-only `USER_CORRECTION` audit
row, canary bump, opportunistic drift check). The long-running memory refresh
and queue enqueue happen outside the lock so throughput is not sacrificed for
correctness.

**Append-only audit writes**. `appendLearningUpdateRecord` inserts one row with
`INSERT ... ON CONFLICT (capability_id, id) DO NOTHING`. This replaces the
legacy DELETE + bulk-INSERT path that was the race window motivating the lock
in the first place.

**Structured pipeline-error logging**. `recordPipelineError({ capabilityId,
agentId, stage, error, workItemId, runId })` writes a `PIPELINE_ERROR` audit
row and emits a `learning.pipeline_errors_count` metric sample tagged with
`{ stage, code }`. The helper never throws — audit or metric failures are
logged to stderr as an SLO backstop. Stage labels are canonicalised in
`LEARNING_PIPELINE_STAGE_LABELS`:

```
memory-refresh, memory-refresh-reflection, judge-evaluation,
judge-persist, judge-fixture-bootstrap, fixture-usage,
drift-evaluation, drift-audit-emit, correction-canary-bump,
correction-lock, revert-audit-emit, revert-memory-refresh,
lease-renew, lease-release, llm-parse
```

Every `.catch(() => undefined)` in the learning pipeline has been replaced with
`recordPipelineError(...)`.

**LLM parse-failure fallback**. If `summarizeAgentLearning` or
`summarizeExperienceDistillation` throws (malformed JSON, timeout, etc.), the
processor substitutes the previous profile's summary/highlights/contextBlock
into the candidate and forces `status='REVIEW_PENDING'` with
`lastError='LLM_PARSE_FAILED (...): ...'`. The pointer stays on the prior
version, an error chip appears on the lens, and operators can retry via the
refresh button. No empty-summary version ever lands.

**Lock-wait telemetry**. `learning.lock_wait_ms` is emitted on every
acquisition attempt tagged `{ outcome: 'acquired' | 'timeout' }` for p50/p99
dashboards.

## API surface

Existing endpoints transparently route through the new version pipeline; old
clients continue to see the denormalized fields unchanged.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/capabilities/:cap/agents/:agent/learning` | Live profile snapshot (unchanged shape + new pointer/canary/drift fields) |
| `POST /api/capabilities/:cap/agents/:agent/learning/refresh` | Enqueue a refresh job |
| `POST /api/capabilities/:cap/agents/:agent/learning/corrections` | Submit an operator correction (lock-serialized, append-only) |
| `GET /api/capabilities/:cap/agents/:agent/learning/versions` | Paginated version history (newest-first) |
| `GET /api/capabilities/:cap/agents/:agent/learning/versions/:versionId/diff?against=:otherVersionId` | Structured diff (summary, highlights added/removed, source-doc delta, context-block token delta) |
| `POST /api/capabilities/:cap/agents/:agent/learning/versions/:versionId/activate` | Operator-initiated revert; writes `VERSION_REVERTED` |
| `GET /api/capabilities/:cap/agents/:agent/learning/drift` | Current canary state + flagged reason |

## UI surfaces (`AgentKnowledgeLensPanel.tsx`)

- Status badges: `Fresh`, `Active`, `Stale`, `Error`, plus `Review pending`
  when the latest candidate failed the gate.
- Red error chip when `lastError` is populated — shows the pipeline error
  message, a "previous version still serving" hint when `REVIEW_PENDING`, and
  a copy-to-clipboard button.
- Drift banner (Slice C) with the regression reason and a "Revert to v{N-1}"
  action wired to the activate endpoint.
- Version history disclosure (Slice A) listing each version with status and
  judge score.

## Feature flags

| Flag | Default | Effect |
| --- | --- | --- |
| `LEARNING_QUALITY_GATE_ENABLED` | `true` | Set `false` to skip shape + judge gates and promote as before. |
| `LEARNING_DRIFT_ENABLED` | `true` | Set `false` to disable drift detection. |
| `LEARNING_DRIFT_DRY_RUN` | `false` | Set `true` to compute drift + telemetry without writing drift state. |

## Observability

Metrics emitted to `capability_metric_samples` (existing table) under
`scope_type='AGENT'`:

- `learning.pipeline_errors_count` tagged `{ stage, code }`.
- `learning.lock_wait_ms` tagged `{ outcome: 'acquired' | 'timeout' }`.
- `learning.judge_score` per version (written by the judge job).

Audit trigger types appended to `capability_learning_updates`:

- `USER_CORRECTION`, `EXPERIENCE_DISTILLATION`, `INCIDENT_DERIVED` — pre-existing.
- `PIPELINE_ERROR`, `DRIFT_FLAGGED`, `VERSION_REVERTED` — new.

## Verification

Run the targeted suites plus the full vitest run:

```bash
npx vitest run server/__tests__/agentLearningProfileVersions.test.ts
npx vitest run server/__tests__/agentLearningQualityGate.test.ts
npx vitest run server/__tests__/agentLearningDriftDetector.test.ts
npx vitest run server/__tests__/agentLearningRaceHardening.test.ts
npx vitest run
```

Slice-by-slice scenarios:

1. **Slice A** — Refresh → row in `*_profile_versions` with `version_no=1`,
   `status='READY'`; profile `current_version_id` points at it. Refresh again
   with a correction → `version_no=2`, `previous_version_id` updated.
   `POST /versions/:v1/activate` flips the pointer back and writes
   `VERSION_REVERTED`.
2. **Slice B** — Inject a corrupt LLM response → candidate saved with
   `status='REVIEW_PENDING'`, `shape_report` explains the failure, pointer
   does not flip, inference still uses the prior version. Async judge job
   populates `judge_score` + `judge_report`.
3. **Slice C** — After a flip, 10 corrections + 20 thumbs-down within 1h →
   two consecutive 15-minute checks flip `drift_flagged_at`, banner appears,
   "Revert to v{N-1}" fires activate.
4. **Slice D** — Kill memory-refresh mid-job → `PIPELINE_ERROR` update + lens
   warning. Two parallel corrections → both serialize via the advisory lock
   (inspectable via `pg_locks` or the `learning.lock_wait_ms` p99). Force bad
   JSON → prior summary preserved, `status='REVIEW_PENDING'`, error chip shows
   the error code.

## Out of scope (for this pass)

- Auto-revert on drift (locked decision: manual only).
- Per-capability curated eval fixtures (bootstrapped from sessions for v1).
- Slice E — correction preview + undo. Planned: `<CorrectionComposer>`
  consolidation, `/corrections/preview` + `/corrections/commit` endpoints, diff
  modal, undo affordance.
- Slice F — rule attribution at inference time. Planned: tag injected
  highlights with `{ version_id, highlight_index }` + citation drawer on
  responses.
