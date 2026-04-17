# Spec: Runtime Role-Policy Enforcement (Pillar D)

**Owner:** Engineering · **Target sprint:** 1 sprint (5–7 eng-days) · **Depends on:** unified-timeline spec (recommended, not required)
**Goal:** Make agent role differences **enforced at runtime and visible in the UI** — not just declared in types or prompts. This completes the pitch's "provable differentiation" claim and is the single action that answers "why do I need five agents instead of one ChatGPT tab?"

---

## 1. Problem

The current tool-policy layer (`server/policy.ts:32-175`) is **per-tool-class**, not **per-role**:

- `HIGH_IMPACT_TOOLS` (line 32) is a static set — applies identically to every agent regardless of role.
- `evaluateToolPolicy` (line 98) decides approval based on tool id, not on who is calling it.
- Agent roles exist as string labels (`OWNER`, `PLANNING`, `ARCHITECT`, etc.) but are not bound to policy, memory scope, quality bar, or eval criteria.
- Policy decisions are logged to `capability_policy_decisions` but no role-level fields are persisted.

Effect: every agent has the same capabilities. A `REVIEWER` can mutate files. A `BUILDER` can self-approve. Role differentiation is folklore, not a mechanism.

---

## 2. Success criteria (acceptance)

1. Every agent role has a declarative **`AgentRoleProfile`** with `toolPolicy`, `memoryScope`, `qualityBar`, and `evalCriteria` fields, persisted and versioned.
2. Every tool invocation is intercepted and compared to the active role profile **before** execution; blocked calls never reach the adapter and emit a `BLOCKED_BY_POLICY` event.
3. Every memory read and every memory write is checked against the role's `memoryScope`.
4. Every timeline `TOOL_CALL` item shows a **role chip** with tool policy outcome (`ALLOWED`, `APPROVAL_REQUIRED`, `BLOCKED`).
5. A **Role Comparison** view in Studio renders a matrix of all roles × tool policy × memory scope × quality bar; non-trivial differences are visible without reading code.
6. Role policy violations cannot be self-approved: a role with `qualityBar.requiresPeerApproval=true` must have a different role sign off before progression.
7. No regression in existing workflow runs: existing role labels get a default profile that matches today's behaviour; teams opt in to stricter profiles.

---

## 3. Design

### 3.1 The `AgentRoleProfile` object

```ts
// src/types/agentRoleProfile.ts
export type AgentRole =
  | 'OWNER'
  | 'PLANNING'
  | 'ARCHITECT'
  | 'BUILDER'
  | 'REVIEWER'
  | 'CRITIC'
  | 'OPERATOR'
  | 'AUDITOR'
  | string;   // tenants may define custom roles

export type ToolPolicyOutcome = 'ALLOW' | 'APPROVAL_REQUIRED' | 'DENY';

export interface AgentRoleProfile {
  id: string;                      // uuid
  role: AgentRole;                 // stable key
  version: number;                 // monotonically increasing per role
  displayName: string;
  description: string;
  toolPolicy: {
    // Precedence: denyList > approvalList > allowList > default
    allow: ToolAdapterId[];
    approvalRequired: ToolAdapterId[];
    deny: ToolAdapterId[];
    defaultOutcome: ToolPolicyOutcome;   // for unlisted tools
    rateLimit: {
      perTool: Record<ToolAdapterId, { maxPerHour: number }>;
      global: { maxPerHour: number };
    };
  };
  memoryScope: {
    reads:  MemoryClass[];         // e.g. ['capability', 'workItem', 'phase', 'personal']
    writes: MemoryClass[];         // strict subset recommended
  };
  qualityBar: {
    minCitations: number;          // 0..N
    requiresEvidenceArtifact: boolean;
    contrarianRequired: boolean;   // CRITIC must record disagreement before sign-off
    requiresPeerApproval: boolean; // cannot self-approve
    maxSelfRetry: number;
  };
  evalCriteria: {
    suiteIds: string[];            // capability_eval_suites.id
    minPassingScore: number;       // 0..1
    gatesRelease: boolean;         // if true, workflow is blocked by failing eval
  };
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type MemoryClass =
  | 'capability'     // capability-wide memory, docs, contracts
  | 'workItem'       // this work item's own history
  | 'phase'          // phase-scoped notes
  | 'personal'       // agent's own scratchpad
  | 'peerAgent'      // other agents' scratchpads (rarely granted)
  | 'secrets';       // credentials — never writable, rarely readable
```

**Defaults (shipped with the product):**

| Role | allow | deny | memory reads | memory writes | qualityBar |
|---|---|---|---|---|---|
| OWNER | read_* | workspace_write, workspace_apply_patch, run_deploy | capability, workItem, phase | — | requiresPeerApproval=false |
| PLANNING | read_*, create_plan | workspace_* | capability, workItem, phase, personal | workItem, personal | minCitations=1 |
| ARCHITECT | read_*, create_plan, publish_contract | workspace_write, run_deploy | capability, workItem, phase, personal | capability, workItem, phase, personal | minCitations=2 |
| BUILDER | read_*, workspace_* (except apply_patch), run_tests | run_deploy | workItem, phase, personal | workItem, phase, personal | requiresPeerApproval=true |
| REVIEWER | read_*, run_tests | workspace_*, run_deploy | capability, workItem, phase | — (cannot write) | minCitations=3, requiresEvidenceArtifact=true |
| CRITIC | read_* | workspace_*, run_deploy | capability, workItem, phase | personal | contrarianRequired=true |
| OPERATOR | read_*, run_deploy | workspace_apply_patch | capability, workItem | workItem | requiresPeerApproval=true |
| AUDITOR | read_* | everything else | capability, workItem, phase | — | gatesRelease=true |

These defaults match or relax today's behaviour so existing runs keep working after the flag flip.

### 3.2 Persistence

```sql
-- migration 00NN_create_agent_role_profiles.sql
CREATE TABLE IF NOT EXISTS agent_role_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  capability_id   UUID NULL REFERENCES capabilities(id) ON DELETE CASCADE,  -- null = workspace-wide default
  role            TEXT NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  display_name    TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  tool_policy     JSONB NOT NULL,
  memory_scope    JSONB NOT NULL,
  quality_bar     JSONB NOT NULL,
  eval_criteria   JSONB NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL,
  UNIQUE (workspace_id, capability_id, role, version)
);

CREATE INDEX IF NOT EXISTS idx_role_profiles_active
  ON agent_role_profiles (workspace_id, capability_id, role)
  WHERE is_active = true;

-- bind agents to a profile at time of run
ALTER TABLE capability_agents
  ADD COLUMN IF NOT EXISTS active_role_profile_id UUID REFERENCES agent_role_profiles(id);

-- evidence on every decision
ALTER TABLE capability_policy_decisions
  ADD COLUMN IF NOT EXISTS role_profile_id UUID REFERENCES agent_role_profiles(id),
  ADD COLUMN IF NOT EXISTS role_profile_version INT,
  ADD COLUMN IF NOT EXISTS role TEXT,
  ADD COLUMN IF NOT EXISTS memory_classes_read JSONB,
  ADD COLUMN IF NOT EXISTS quality_bar_snapshot JSONB;
```

**Resolution order at runtime** (most specific wins):
1. Capability-scoped active profile for `(capability, role)`
2. Workspace-scoped active profile for `(null, role)`
3. Built-in default profile (shipped in code)

Profiles are **versioned**; active runs pin the exact `role_profile_id` so mid-run policy changes never affect an in-flight run (deterministic replay for Pillar C).

### 3.3 The compiler

`server/policy/compileRoleProfile.ts` turns a persisted `AgentRoleProfile` row into a lightweight in-memory interceptor:

```ts
export interface CompiledRolePolicy {
  roleProfileId: string;
  roleProfileVersion: number;
  role: AgentRole;
  evaluateTool(tool: ToolAdapterId, recentCallCount: RateCounters):
    { outcome: ToolPolicyOutcome; reason: string };
  evaluateMemoryRead(klass: MemoryClass):
    { allowed: boolean; reason: string };
  evaluateMemoryWrite(klass: MemoryClass):
    { allowed: boolean; reason: string };
  qualityBar: AgentRoleProfile['qualityBar'];
}

export function compileRoleProfile(profile: AgentRoleProfile): CompiledRolePolicy;
```

**Cache:** LRU keyed by `roleProfileId` with TTL 5 min. Invalidation on profile update via pub/sub ping.

### 3.4 Interceptor — the mandatory gate

Replace the body of `server/policy.ts::evaluateToolPolicy` with a role-aware version. Keep the signature.

```ts
// server/policy.ts
export const evaluateToolPolicy = async (input: EvaluateToolPolicyInput) => {
  // 1. Resolve active role profile for (capabilityId, agentId)
  const profile = await resolveActiveRoleProfile({
    capabilityId: input.capabilityId,
    agentId: input.agentId,
  });

  const compiled = compileRoleProfile(profile);

  // 2. Rate-limit check
  const counters = await getRateCounters(profile.id, input.agentId);

  // 3. Tool decision
  const toolDecision = compiled.evaluateTool(input.toolId, counters);

  // 4. High-impact override still applies but now combined with role
  const effective = combineWithLegacyHighImpact(toolDecision, input.toolId);

  // 5. Persist decision with role context
  const decision = await createPolicyDecision({
    ...input,
    outcome: effective.outcome,
    reason: effective.reason,
    roleProfileId: profile.id,
    roleProfileVersion: profile.version,
    role: profile.role,
    qualityBarSnapshot: profile.qualityBar,
  });

  // 6. Publish to timeline bus so UI role chips update live
  timelineBus.publish({
    kind: 'TOOL_CALL',
    /* ... */
    payload: {
      ...toolCallPayload,
      status: effective.outcome === 'DENY' ? 'BLOCKED_BY_POLICY' : 'PENDING',
      policyDecisionId: decision.id,
      roleProfile: profile.role,
      roleProfileVersion: profile.version,
    },
  });

  return decision;
};
```

**Call site:** `server/execution/service.ts` already calls `evaluateToolPolicy` before tool dispatch. No other change needed to block execution; `DENY` already short-circuits.

### 3.5 Memory scope enforcement

Introduce `server/policy/memoryGuard.ts` and route **every** memory access through it:

```ts
export async function guardedMemoryRead(args: {
  agentId: string;
  capabilityId: string;
  klass: MemoryClass;
  query: string;
}) {
  const profile = await resolveActiveRoleProfile(args);
  const compiled = compileRoleProfile(profile);
  const { allowed, reason } = compiled.evaluateMemoryRead(args.klass);
  if (!allowed) {
    await recordMemoryViolation({ ...args, outcome: 'DENY', reason });
    throw new PolicyViolation(`Role ${profile.role} cannot read ${args.klass}: ${reason}`);
  }
  await recordMemoryDecision({ ...args, outcome: 'ALLOW', reason });
  return memoryStore.search(args);
}

export async function guardedMemoryWrite(/* ... */);
```

Call sites to update (grep-hunt list):
- `server/agentLearning/service.ts` — profile refresh reads peer memory
- `server/execution/service.ts` — any retrieval before tool call
- `src/lib/api.ts::searchCapabilityMemory` — via server endpoint wrapper
- `server/memory/*` — all direct reads and writes

### 3.6 Quality-bar enforcement points

| Rule | Enforced at | Action on violation |
|---|---|---|
| `minCitations` | Artifact / decision submission | Refuse submission; return list of missing citations |
| `requiresEvidenceArtifact` | Approval gate | Approval cannot be submitted without linked artifact |
| `contrarianRequired` (CRITIC) | Before approving any `subjectType=decision` | Require a recorded `DISAGREE` event first in the timeline |
| `requiresPeerApproval` | Workflow progression | Block phase exit unless approver role ≠ submitter role |
| `maxSelfRetry` | Tool retry loop | Cap retries per `(agentId, toolId, runId)` triple |
| `gatesRelease` on eval | Workflow `RELEASE` step | Read latest eval run; block if score < `minPassingScore` |

All violations emit a `POLICY_VIOLATION` run event on the unified timeline.

### 3.7 API surface

```
GET    /api/workspace/role-profiles
GET    /api/workspace/role-profiles/:role
POST   /api/workspace/role-profiles                      # create new version
PATCH  /api/workspace/role-profiles/:id                  # update (creates new version)
POST   /api/workspace/role-profiles/:id/activate         # set is_active=true, others in (role) false
GET    /api/capabilities/:capabilityId/role-profiles
POST   /api/capabilities/:capabilityId/role-profiles     # capability override

GET    /api/capabilities/:capabilityId/agents/:agentId/effective-role-profile
GET    /api/role-profiles/compare                        # workspace-wide matrix for UI

GET    /api/capabilities/:capabilityId/policy-decisions?runId=...
```

All admin endpoints require `capability.admin` or `workspace.admin`.

### 3.8 UI: visible differentiation

**A. Role chip in timeline (cheap, high impact)**
On `TOOL_CALL` items the unified timeline spec renders a chip:

```
[ REVIEWER · read-only · cites 3 · peer-approve ]
```

Color-coded:
- Grey: allowed
- Amber: approval required
- Red: denied

Clicking the chip opens the policy decision drawer with full reason + role profile snapshot.

**B. Studio → Role Comparison matrix**

New page: `src/pages/studio/RoleComparison.tsx`. Default matrix:

| | OWNER | PLANNING | ARCHITECT | BUILDER | REVIEWER | CRITIC |
|---|---|---|---|---|---|---|
| Can write files | — | — | — | ✓ | — | — |
| Can deploy | — | — | — | — | — | — |
| Reads capability memory | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| Writes capability memory | — | — | ✓ | — | — | — |
| Min citations | 0 | 1 | 2 | 1 | **3** | 1 |
| Requires peer approval | — | — | — | **✓** | — | — |
| Contrarian required | — | — | — | — | — | **✓** |
| Eval suites bound | — | planning | architect | builder | reviewer | critic |

Inline editor per cell. "Save" creates a new version. Diff viewer between versions.

**C. Agent row badge**
In Orchestrator and Agents views, each agent shows: `role @ vN` tag. Hover reveals top 3 differentiators vs default.

### 3.9 Deterministic replay (supports Pillar C)

Every policy decision is persisted with `role_profile_id` + `role_profile_version`. Evidence Packet builder must include:

```json
{
  "roleProfileVersions": {
    "<agentId>": { "roleProfileId": "...", "version": 3 }
  },
  "policyDecisions": [ /* all rows for runId */ ]
}
```

The packet replay tool (Pillar C) can reconstruct the exact policy context that governed the run. This is the "replayable autonomy" promise made literal.

---

## 4. Work breakdown

### PR 1 — Data model (1 day)
- Migration: `agent_role_profiles` table + `active_role_profile_id` on `capability_agents` + new columns on `capability_policy_decisions`
- Seed built-in default profiles for 8 roles
- Repository helpers: `listRoleProfiles`, `getEffectiveRoleProfile`, `createRoleProfileVersion`, `activateRoleProfile`

### PR 2 — Compiler + resolver (1 day)
- `server/policy/compileRoleProfile.ts` with LRU cache + invalidation pub/sub
- `resolveActiveRoleProfile(capabilityId, agentId)` with three-tier fallback
- Unit tests with property-based coverage (allow vs deny vs approval precedence)

### PR 3 — Tool interceptor rewrite (1 day)
- Replace `evaluateToolPolicy` body
- Publish to `timelineBus` with role metadata
- Wire `combineWithLegacyHighImpact` so today's `HIGH_IMPACT_TOOLS` still yields `APPROVAL_REQUIRED` for roles that currently get it

### PR 4 — Memory guard + quality bar (1.5 days)
- `guardedMemoryRead` / `guardedMemoryWrite`
- Migrate all memory access call sites (enumerate in a checklist)
- Approval gate enforcement for `requiresPeerApproval` and `requiresEvidenceArtifact`
- `contrarianRequired` check in approval submission handler
- Eval release gate: read latest run score before `RELEASE` step

### PR 5 — API + UI (2 days)
- Endpoints listed in §3.7
- `RoleComparison.tsx` matrix view with inline editor and version diff
- Role chip component for timeline `TOOL_CALL` renderer (plugs into existing unified-timeline component)
- Agent row badge

### PR 6 — Evidence packet + docs (0.5 day)
- Add `roleProfileVersions` and `policyDecisions` slice to packet builder
- Update `docs/pitch-deck.md` section on provable differentiation with screenshots
- Update `README.md` architecture section

---

## 5. Test plan

**Unit**
- Tool policy precedence: deny > approval > allow > default
- Rate limit: per-tool and global honoured separately
- Memory scope: reads and writes checked independently
- Quality bar: each rule triggers its refusal path
- Profile versioning: activating v3 deactivates v2; in-flight runs still see v2

**Integration**
- BUILDER agent blocked from calling `workspace_apply_patch`
- REVIEWER agent cannot submit artifact without 3 citations
- CRITIC agent cannot approve without prior DISAGREE event
- BUILDER submission + BUILDER approval → blocked; BUILDER submission + REVIEWER approval → allowed
- Eval gate: RELEASE step refused when suite score < threshold

**E2E (Playwright)**
- Operator opens Studio → edits REVIEWER to require 4 citations → saves → run resubmits artifact with 3 citations → blocked with visible reason
- Timeline shows role chip on every tool call; clicking opens decision drawer
- Evidence packet exported after run contains role-profile snapshot and all decisions

**Replay**
- Given a packet from run X, rebuilding the context from `roleProfileVersions` + `policyDecisions` produces bit-identical allow/deny decisions for the same tool calls.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Existing runs break because stricter defaults deny previously-allowed tools | Ship defaults that **match today's behaviour**; opt-in tightening only; release under feature flag `policy.roleScoped` |
| Memory guard slows every retrieval | Compile + cache profile per run; guard cost is one map lookup per call |
| Role explosion (tenants add 50 custom roles) | Versioning is per-role; UI collapses unchanged columns in comparison matrix |
| Profile changes mid-run cause nondeterminism | Runs pin `role_profile_id` at start; profile versions are append-only |
| `requiresPeerApproval` deadlocks single-person teams | Workspace setting `allowSoloApproval=true` (default in small workspaces); logged as an exception in evidence packet |
| Eval gate blocks releases unexpectedly | `gatesRelease=false` by default; opt-in per role; show dry-run banner for 1 week before enforcing |

---

## 7. Rollout

1. Merge PR 1–6 behind flag `policy.roleScoped`, seeded with today's-behaviour defaults
2. Enable flag in dev + dogfood capability; ensure zero new denials on existing workloads
3. Introduce Studio matrix and encourage teams to tighten profiles voluntarily
4. Monitor `policy.decisions.deny_rate` per role — alert if sudden spike after profile edit (likely misconfiguration, not an attack)
5. Remove flag after 1 clean release
6. Next sprint: add **"Recommend tighter profile"** action — analyzes the last 30 days of accepted tool calls per role and proposes a minimal allow-list

---

## 8. Out of scope (explicit non-goals)

- Cross-tenant role marketplace — each workspace defines its own profiles
- ML-inferred role profiles from observed behaviour (future work, stub hooks present)
- Fine-grained per-field permissions inside artifacts (Gap #25, separate spec)
- Delegating role assignment to agents — only humans assign profiles

---

## 9. Definition of done

- All 8 default profiles seeded; customisable per workspace and per capability
- Every tool call persists a role-aware `capability_policy_decisions` row
- Every memory read / write routes through the guard
- Every timeline `TOOL_CALL` renders a role chip
- Studio Role Comparison matrix shipped with inline edit + version diff
- Evidence packets include full role profile snapshot and decision list
- Feature flag removed
- Load test: 1000 tool calls / sec with guard enabled, p95 overhead < 5 ms
- Dogfooded for ≥ 3 days with no false-deny incidents
- Docs and pitch-deck screenshots updated

---

## 10. Post-ship compounding

- **Gap #8 Eval Center** plugs directly in via `evalCriteria.suiteIds` — release gates become meaningful the day this ships.
- **Gap #9 Agent continuous learning** can now specialize: learning jobs record which policies were hit most often and propose profile tightening.
- **Pillar C (Evidence Packet)** becomes a compliance artifact — a packet now proves *which policy version was in force* at run time, which is what auditors actually need.
- **Sales moment:** the matrix view is the new screenshot on the website. The "why do I need five agents" question has a one-slide answer that no competitor can copy without a similar substrate.

Once this spec ships, the product stops *claiming* provable autonomy and starts *demonstrating* it in every tool call.
