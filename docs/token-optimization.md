# Token Optimization — Engineering Reference

SingularityNeo's execution engine ships a nine-lever token-optimization program. Every lever is independently active; together they keep the average main-model call 60–80 % smaller than a naïve "dump everything" approach without losing execution quality. This document describes each lever's design, the files involved, and how operators can tune the system.

---

## Why it matters

The inner execution loop in `server/execution/service.ts` calls an expensive main model on every tool turn. A 30-tool-call debugging run that naïvely re-sends the full transcript on each tick pays:

```
call_31 = system_prompt + full_briefing + all_30_prior_turns
```

At ~4 k tokens/turn that is 120 k input tokens on the final call alone — and the model only cares about the last few turns. The nine levers collectively address every layer of this problem: guidance bloat, file-read bloat, history bloat, full-file-write overhead, and missed eviction opportunities.

---

## Lever 1 — Phase-sliced guidance

**File:** `server/repoGuidance.ts`

Every capability has a repo-guidance pack attached. Before this lever, the full pack was included on every call regardless of the current phase. After:

- `buildGuidanceBlockFromPack(pack, { phase })` calls `selectGuidanceCategoriesForPhase(phase)` to pick only the relevant guidance categories.
- A BUILD-phase call gets coding, testing, and security guidance. An ANALYSIS-phase call gets requirements, scoping, and domain categories. Governance categories only appear in GOVERNANCE/RELEASE.
- Typical saving: **6–8× reduction** in guidance tokens when a capability has a full 8-category pack.

`invokeScopedCapabilitySession` threads `workItemPhase` through the three call sites at `service.ts:1580`, `1666`, and `1849`.

---

## Lever 2 — Semantic-hunk reads

**Files:** `server/execution/tools.ts`, `server/codeIndex/query.ts`

`workspace_read` accepts two extra args:

| Arg | Default | Effect |
|-----|---------|--------|
| `symbol` | — | Return only the named function / class body + `symbolContextLines` (default 10) of surrounding context |
| `symbolContextLines` | 10 | Lines of context around the symbol (max 50) |
| `includeCallers` | 0 | Surface up to N files that import/depend on this file (max 3) |
| `includeCallees` | 0 | Surface up to N files this file imports (max 3) |

When `symbol` is supplied, `findSymbolRangeInFile()` in `server/codeIndex/query.ts` locates the declaration, and only that slice is returned. A 2 000-line file with a 40-line function becomes a 50-line read — **98 % smaller**.

When `includeCallers > 0`, `findFileDependents()` queries `capability_code_references` to surface the top N dependent files and their exported signatures. When `includeCallees > 0`, `findFileDependencies()` resolves the file's own imports back to indexed paths.

Whole-file fallback: if `symbol` is omitted, or the symbol is not found in the code index, the full file is returned unchanged.

---

## Lever 3 — Tool-loop history rollup

**Files:** `server/execution/historyRollup.ts`, `server/githubModels.ts`

After `threshold` tool turns (default 10), the oldest `history.length - keepLastN` turns are compressed into a single summary produced by the **cheapest model** available on the capability's provider. Only `summary + last keepLastN raw turns` reach the expensive main model.

```
Before:  [t1, t2, t3, …, t10, t11]  → 11 raw turns to main model
After:   [summary(t1–t5), t6, t7, t8, t9, t10, t11]  → 1 summary + 6 raw
```

**Incremental compression:** the cache (`RollupCacheEntry`) records how many turns are already folded in. The next rollup only summarises the _new_ older turns and appends to the existing summary — the cheap model is never asked to re-read what it already processed.

**Force triggers (Lever 8 integration):** a rollup is forced immediately on:
- A recoverable tool error (write-lock, policy denial)
- A phase transition (`runStep.metadata.phaseTransitioned === true`)

### Budget model selection

`invokeBudgetModelSummary()` in `server/githubModels.ts` picks the lowest-cost runtime model via `pickLowestCostRuntimeModel()`. For github-copilot / openai this resolves to `gpt-4o-mini`; for anthropic to the first Haiku variant available.

### Capability-level knob

```json
{
  "executionConfig": {
    "historyRollup": {
      "enabled": true,
      "keepLastN": 6,
      "threshold": 10
    }
  }
}
```

Set `enabled: false` to bypass rollup for a debugging session. `keepLastN` and `threshold` are clamped to sensible ranges at runtime.

### Run event

When a rollup fires, a `HISTORY_ROLLUP` run event is emitted:

```json
{
  "type": "HISTORY_ROLLUP",
  "details": {
    "summarizedTurns": 6,
    "retainedTurns": 5,
    "usedModel": "gpt-4o-mini",
    "totalTurns": 11
  }
}
```

---

## Lever 4 — Diff-first prompting

**File:** `server/execution/tools.ts`

The tool descriptions for `workspace_write`, `workspace_apply_patch`, and `workspace_replace_block` are written to steer agents toward diffs first:

- `workspace_apply_patch` — described as the **preferred** way to edit existing files; produces a reviewable diff and uses far fewer tokens than a full rewrite.
- `workspace_replace_block` — described as the lightweight alternative for single-block replacements.
- `workspace_write` — described as **for new files only**; the description explicitly warns that re-writing existing files is penalised (see Lever 9).

---

## Lever 5 — Context Budgeter

**Files:** `server/execution/contextBudget.ts`, `server/execution/tokenEstimate.ts`

Every prompt is assembled as a typed `BudgetFragment[]` list before being sent to the main model. Each fragment carries a `source` tag, a pre-computed `estimatedTokens` count, and an eviction `priority`.

### Source taxonomy and eviction order

| Source | Priority | Evictable |
|--------|----------|-----------|
| `SYSTEM_CORE` | 1 000 000 | ❌ Never |
| `TOOL_DESCRIPTIONS` | 900 000 | ❌ Never |
| `STEP_CONTRACT` | 800 | ✅ |
| `WORK_ITEM_BRIEFING` | 700 | ✅ |
| `OPERATOR_GUIDANCE` | 650 | ✅ |
| `PLAN_SUMMARY` | 600 | ✅ |
| `PHASE_GUIDANCE` | 500 | ✅ |
| `RAW_TAIL_TURNS` | 400 | ✅ |
| `HISTORY_ROLLUP` | 300 | ✅ |
| `CODE_HUNKS` | 200 | ✅ |
| `MEMORY_HITS` | 100 | ✅ (evict first) |

When `totalTokens > maxInputTokens`, fragments are evicted in ascending priority order (lowest first) until the total fits. Fragments are always emitted in their original **insertion order** — eviction is invisible to the model beyond the missing content.

### Per-phase token ceilings

| Phase pattern | Max input | Reserved output |
|---------------|-----------|-----------------|
| build / develop / construction | 64 k | 16 k |
| plan / design / elaboration | 48 k | 8 k |
| analysis / discover / inception | 32 k | 4 k |
| qa / validate / test / delivery | 32 k | 4 k |
| govern / review / audit | 24 k | 2 k |
| release / deploy / ship | 16 k | 2 k |
| (unknown / default) | 64 k | 16 k |

### Token estimator

`server/execution/tokenEstimate.ts` provides a cheap char-based estimator:

```ts
estimateTokens(text, { provider: 'openai', kind: 'code' })
```

Provider-specific divisors:

| Provider | prose | code | json |
|----------|-------|------|------|
| openai / github-copilot | 4.0 | 3.2 | 3.0 |
| anthropic | 3.8 | 3.1 | 2.9 |
| local-openai | 4.0 | 3.2 | 3.0 |
| unknown | 3.8 | 3.1 | 2.9 |

Accuracy is intentionally ~±20 % — enough for correct eviction ordering without the overhead of tiktoken.

---

## Lever 6 — Retrieval Bundle

**Files:** `server/execution/tools.ts` (`workspace_read` adapter), `server/codeIndex/query.ts`

When the agent needs to understand cross-file invariants (e.g. "rename `validateToken` and fix its callers"), it can request neighbour context in a single `workspace_read` call:

```json
{
  "path": "src/auth/token.ts",
  "symbol": "validateToken",
  "includeCallers": 2,
  "includeCallees": 1
}
```

This returns the symbol hunk **plus** up to 2 caller-file paths with their top exported signatures, and up to 1 callee-file path. The agent no longer needs to chain 3+ reads to gather the same information.

**Hard limits:** max 3 callers, max 3 callees, max 6 additional hunks or 4 k chars — whichever comes first. The Budgeter (Lever 5) sees each hunk as its own `CODE_HUNKS` fragment so individual callee hunks can be evicted independently.

---

## Lever 7 — Prompt Receipts

**File:** `server/execution/service.ts` (lines 2068–2101)

After every main-model call, a `PROMPT_RECEIPT` run event is emitted:

```json
{
  "type": "PROMPT_RECEIPT",
  "details": {
    "stage": "PROMPT_RECEIPT",
    "included": [
      { "source": "SYSTEM_CORE", "estimatedTokens": 312 },
      { "source": "TOOL_DESCRIPTIONS", "estimatedTokens": 1840 },
      { "source": "STEP_CONTRACT", "estimatedTokens": 2100 },
      { "source": "HISTORY_ROLLUP", "estimatedTokens": 420, "meta": { "rolledUp": true } }
    ],
    "evicted": [
      { "source": "MEMORY_HITS", "estimatedTokens": 8200, "reason": "budget_overflow" }
    ],
    "totalEstimatedTokens": 4672,
    "maxInputTokens": 32000,
    "reservedOutputTokens": 4000,
    "phase": "QA",
    "model": "gpt-4o",
    "actualUsage": { "promptTokens": 4801, "completionTokens": 203 }
  }
}
```

This receipt answers "why did the model decide X?" with "because it saw these exact N fragments." It is stored in `run_events` and visible in the Flight Recorder.

---

## Lever 8 — Structured Rollup

**File:** `server/githubModels.ts` (`invokeBudgetModelSummary`)

Instead of 3–4 sentences of prose, the budget model is asked for a JSON state note:

```json
{
  "currentGoal": "implement validateToken refresh logic",
  "lastSuccessfulAction": "wrote tests in src/auth/token.test.ts",
  "currentBlocker": "write-lock held on src/auth/token.ts",
  "filesInPlay": ["src/auth/token.ts", "src/auth/token.test.ts"],
  "pendingDecision": "should retry after lock expires or pause for input?",
  "evidenceGenerated": []
}
```

The main model receives this as a fenced JSON block in its tool-loop history. Structured fields let it reason about specific facts ("we're blocked on X") rather than fuzzy-matching a prose paragraph.

---

## Lever 9 — Diff Enforcement

**File:** `server/execution/tools.ts`

`workspace_write` on an **existing file** is intercepted by the edit-policy tracker:

1. **First attempt** — allowed (agent may not know the file exists).
2. **Second attempt** — blocked with a recoverable `DiffEnforcementError` that explains how to use `workspace_apply_patch` or `workspace_replace_block`.
3. **Override after two patch failures** — if the agent has tried patching twice and both failed, the `workspace_write` block lifts so the agent is never permanently stuck.

The per-step tracker is stored in `editPolicyTrackers` (a `Map<string, EditPolicyEntry>`) with a 30-minute TTL. The run step metadata records `writeAttemptsOnExisting` and `patchFailuresByPath` for observability.

---

## Implementation map

```
server/execution/
  contextBudget.ts   ContextSource, BudgetFragment, buildBudgetedPrompt, resolvePhaseBudget
  tokenEstimate.ts   estimateTokens, normalizeProviderForEstimate
  historyRollup.ts   rollupToolHistory, RollupCacheEntry, RolledHistory
  tools.ts           workspace_read (Levers 2, 6), workspace_write (Lever 9)
  service.ts         requestStepDecision wires Levers 1–9

server/githubModels.ts
  invokeBudgetModelSummary   budget-model compression call (Levers 3, 8)

server/repoGuidance.ts
  buildGuidanceBlockFromPack   phase-sliced guidance (Lever 1)
  selectGuidanceCategoriesForPhase

server/codeIndex/query.ts
  findSymbolRangeInFile    symbol-hunk read (Lever 2)
  findFileDependents       caller lookup (Lever 6)
  findFileDependencies     callee lookup (Lever 6)
```

---

## Verification checklist

| Test | What to check |
|------|--------------|
| No-op path (≤ 10 turns) | `rolled.summarizedTurnCount === 0`, no `HISTORY_ROLLUP` event |
| First compression (12 turns) | `HISTORY_ROLLUP` fires once; `usedModel` is a budget model; prompt has summary + 6 raw turns |
| Incremental compression (20 turns) | `invokeBudgetModelSummary` called with non-empty `priorSummary`; `newTurns.length` covers only the 8 new older turns |
| Provider fallback | Set capability to `anthropic`; confirm summary model resolves to a Haiku variant |
| Feature flag off | Set `historyRollup.enabled = false`; confirm raw `toolHistory` passes through; no `HISTORY_ROLLUP` events |
| Budget eviction | Construct fragments totalling > `maxInputTokens`; verify `MEMORY_HITS` is evicted first and `SYSTEM_CORE` is never evicted |
| Diff enforcement | Call `workspace_write` on the same existing file twice; confirm second call throws `DiffEnforcementError` |
| Prompt receipt | Inspect run events after any tool-loop execution; confirm `PROMPT_RECEIPT` event with accurate fragment list |

---

## Phase 2 follow-up ideas (not yet implemented)

- **Token-count-based rollup trigger** — supplement the turn-count threshold with a running byte total so one very large tool response triggers rollup early.
- **Tiktoken integration** — swap the char-based estimator for tiktoken when accuracy matters enough to justify the binary dep.
- **Prompt Receipt UI panel** — render the `PROMPT_RECEIPT` event as a stacked bar in the Flight Recorder ("Prompt Receipt" tab alongside the existing evidence viewer).
- **Structured rollup event triggers** — force a rollup on approval/wait resume in addition to recoverable-error and phase-transition triggers.
