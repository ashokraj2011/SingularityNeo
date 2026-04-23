# SingularityNeo 🚀

SingularityNeo is a **capability delivery operating system** for governed, explainable, AI-assisted software delivery. It combines autonomous agent orchestration, workflow enforcement, verifiable evidence, and enterprise governance control into one local-first operating console.

Instead of treating delivery as scattered tools for planning, coding, approvals, incidents, and reporting, SingularityNeo unifies them under a single **Capability**. It is not trying to out-editor the best coding copilots; it is the governed, auditable, and resilient operating layer that makes their output usable inside an enterprise delivery system.

## Why SingularityNeo is Awesome

SingularityNeo isn't just about running agents; it's about **Enterprise Safety and Observability**. We've built state-of-the-art governance right into the core loop:

- 🛡️ **Dynamic Learning & Atomic Rollbacks**: Agents don't just act; they learn. When operators provide corrections, agents distill these into new guardrails. If a bad habit is learned, our **Agent State Versioning** lets you instantly roll back an agent's brain to a previous operational policy snapshot.
- 🔏 **Signed Change Attestations & Tamper-Evident Chain**: Every evidence packet is Ed25519-signed and linked into a `prev_bundle_id` chain rooted at the work item's first attestation. The packet page shows a `Signed · chain intact` chip and a verify drawer that walks the chain, recomputes the digest, and surfaces any gap/cycle/root mismatch. See [Governance](./docs/governance.md).
- 🧭 **Controls Catalog + Framework Mapping**: Every enforced policy binds to external controls across NIST CSF 2.0, SOC 2 TSC 2017, and ISO/IEC 27001:2022 — ~45 seeded controls visible at `/governance/controls` with an audit-legible binding graph so decisions read against a framework instead of an internal tool name.
- ⏱️ **Time-Bound Exception Lifecycle**: Policy denials can be waived through a first-class request → approve → expire flow. An active exception flips `evaluateToolPolicy` from `REQUIRE_APPROVAL` to `ALLOW` and stamps an `exception_id` on the audit row; the sweeper auto-expires at the deadline. Live at `/governance/exceptions`.
- 🔎 **Prove-the-Negative Provenance**: A single API call answers "did any AI touch `services/billing/**` between T1 and T2?" with three honest states — touched / not touched / gap. Logging gaps never masquerade as a silent "no". Live at `/governance/provenance`.
- 📊 **One-Screen Compliance Posture**: `/governance/posture` aggregates signer ratio, control coverage by framework, active / expiring-soon exceptions, recent denials joined to their bound control, and provenance coverage gaps — the screen to open first during an audit walkthrough.
- 🧪 **Gated, Versioned, Drift-Aware Learning Loop**: Every profile refresh is committed as an immutable version. Shape checks block empty-or-malformed distillations from going live, an async LLM-judge scores every new version against fixtures from real sessions, per-version canary counters feed a drift detector that surfaces regressions for operator-driven revert, and an advisory-lock + append-only audit path makes concurrent corrections race-safe. See [Self-Learning Loop](./docs/self-learning-loop.md).
- 👻 **Shadow Mode Execution**: Need to test a high-stakes deployment without risking production? Toggle a capability into **Shadow Mode**. The execution layer intercepts destructive commands across the entire platform, simulating successful runs to let you validate agent reasoning in a 100% risk-free environment.
- 📋 **Evidence-Based Execution**: Every run leaves behind a durable cryptographic-style evidence trail. Artifacts, handoffs, approvals, and wait states are comprehensively logged in the Flight Recorder, so you never have to ask "why did the agent do that?"
- 🤝 **Strict Human-in-the-Loop Governance**: Agents can plan, design, implement, and review, but the platform ensures humans retain ultimate control over approvals, policy boundaries, and conflict resolution.
- 💡 **9-Lever Token Optimization**: A principled context-budgeting layer keeps every main-model call lean. Phase-sliced guidance, semantic-hunk reads, tool-loop history rollup, diff-first prompting, per-phase token budgets with priority-based eviction, caller/callee retrieval bundles, diff-enforcement policy, structured rollup summaries, and per-call Prompt Receipts — all active by default, all tunable per capability. See [Token Optimization](./docs/token-optimization.md).
- 💻 **User-Scoped Desktop Workspaces**: Local execution paths are resolved from `Desktop Workspaces`, not shared capability metadata. Each operator can save a different local root and working directory per desktop executor, with repository rows taking precedence over a capability fallback.
- 🌿 **Work-Item Branch Standardization**: Repo-backed work-item execution now converges on one branch rule everywhere: the shared branch, checkout session, local commit flow, and push target all use the exact literal `workItem.id`.
- 🛂 **Release Passport**: A structured governance gate that aggregates run evidence, approval chains, risk signals, and open findings into a single release-readiness document. Passport approvals are linked to the run, signed, and stored alongside the evidence packet.
- 💥 **Blast Radius Analysis**: Before a proposed file change is deployed, Shadow Execution maps which capabilities and files would break. Dependents are classified `CRITICAL`, `WARNING`, or `SAFE` so teams can assess risk before a single line ships.
- 🔦 **Sentinel Mode**: Zero-prompt autonomous security remediation. Sentinel intercepts CVE alerts, maps the vulnerability to the affected workspace, patches it in isolation, signs the change, and delivers a Release Passport for 1-click human approval — no manual triage loop required.

## What SingularityNeo Is

SingularityNeo is best understood as a delivery operating system for a business capability.

A capability owns:

- its charter and business outcome
- lifecycle phases and workflow steps
- human collaborators and standard agents
- work items, runs, waits, and approvals
- evidence, handoffs, review packets, and audit trails
- memory, skills, tools, and agent learning

Local execution paths do not belong to shared capability metadata anymore.
They are resolved per operator and per desktop executor through `Desktop
Workspaces`, while capability metadata fields remain useful as documentation
and migration hints.

The product is strongest when a team wants to:

- move work through an explicit SDLC or org-specific lifecycle
- deploy autonomous agents safely with full administrative rollbacks
- explain why work is blocked, waiting, approved, or complete
- keep durable evidence for reviews, release readiness, and compliance audits

## Main Workspaces

- `Home` shows capability health, trust, readiness, and what matters now.
- `Work` is the delivery workbench for operating one work item well.
- `Agents` shows standard agents, custom agents, skills, tools, and dynamic learning snapshots.
- `Chat` gives capability-scoped and execution-aware collaboration.
- `Evidence` provides artifacts, completed work, approvals, and flight recorder history.
- `Designer` defines workflows, lifecycle lanes, and operating rules.
- `Governance` (admins) collects four audit-grade surfaces: `Posture` (one-screen compliance view), `Controls` (framework catalog), `Exceptions` (time-bound deviation lifecycle), and `Provenance` (prove-the-negative queries). See [Governance](./docs/governance.md).

### Advanced specialist tools

The sidebar organises specialist tools into four labelled groups visible to users with matching roles:

| Group          | Tools                                                                                                         | Who sees it               |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Governance** | Posture Dashboard, Controls Catalog, Exceptions, Provenance, Work Item Report                                 | Admins / Portfolio owners |
| **Security**   | Sentinel Mode, Blast Radius                                                                                   | Operators, Architects     |
| **Operations** | Ops Console, Incidents, MRM, Run Console, Memory, Evals                                                       | Operators                 |
| **Platform**   | Architecture, Access, Skills, Tools, Tool Access, Policies, Artifact Designer, Agent Studio, Tasks, Databases | Builders / Admins         |

## Operator Roles & Audiences

SingularityNeo ships a formal role model so the same workspace shows the
right surfaces to the right people. Evaluators can pick a persona from the
`/login` picker ([`src/pages/Login.tsx`](./src/pages/Login.tsx)); production
workspaces assign these roles via the admin user list.

### Workspace roles

Source of truth: `WorkspaceRole` in [`src/types.ts`](./src/types.ts).

| Role                 | What it's for                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `WORKSPACE_ADMIN`    | Full control plane — runtime config, connector secrets, user management, every governance surface.                  |
| `PORTFOLIO_OWNER`    | Owns outcomes across many capabilities. Sees every workspace, approves policy exceptions, reads posture dashboards. |
| `TEAM_LEAD`          | Owns a subset of capabilities. Approves team deploys, reviews evidence, manages team membership.                    |
| `INCIDENT_COMMANDER` | On-call overrides — can revoke active exceptions, trigger rollback runs, and read flight recorder live.             |
| `OPERATOR`           | Day-to-day work execution — runs workflows, approves routine actions, chats with capability agents.                 |
| `AUDITOR`            | Read-only across evidence, controls, exceptions, and provenance. Cannot execute tools or approve actions.           |
| `VIEWER`             | Read-only business view — capabilities, work items, dashboards. No governance surfaces.                             |

### Sidebar audiences

Each advanced tool is tagged with an `AdvancedToolAudience`. The sidebar
filters tools based on a role → audience match in
`matchesAdvancedToolAudience` ([`src/lib/capabilityExperience.ts`](./src/lib/capabilityExperience.ts)).

| Audience     | Who sees it                                         | Example tools                                          |
| ------------ | --------------------------------------------------- | ------------------------------------------------------ |
| `ALL`        | Everyone                                            | Chat, Work Items                                       |
| `OPERATORS`  | Anyone except `VIEWER`                              | Workflows, Approvals inbox                             |
| `BUILDERS`   | Anyone except `VIEWER` and `AUDITOR`                | Agent studio, Schema designer                          |
| `ADMINS`     | `WORKSPACE_ADMIN` / `PORTFOLIO_OWNER` / `TEAM_LEAD` | Posture Dashboard, Controls Catalog, Exception Console |
| `ARCHITECTS` | Same roles as `ADMINS`                              | Dependency graph, Published snapshots                  |

If a role does not match any listed audience for a tool, that tool is
hidden rather than shown-and-disabled — so an `AUDITOR` never sees the
Agent Studio entry at all, and a `VIEWER` never sees approvals.

## Core Product Ideas

### 1. Capability-Centered

The active capability is the center of gravity. Most of the application follows that selected capability, including its lifecycle, agents, evidence, database-backed state, and runtime context.

### 2. Human-Governed Agents

Agents operate semi-autonomously through workflow steps that strictly define their boundaries, capability restrictions, and tool access, pausing seamlessly for human approval when policies dictate.

### 3. Work With Proof

Every meaningful run can leave behind artifacts, handoffs, approvals, waits, policy decisions, and work-item explainability so the team can see what happened and why.

### 4. Adaptable Lifecycle

The platform supports capability-specific lifecycles, including organization-specific flows like Brokerage SDLC. Lifecycle phases drive the Work lanes, Designer structure, and Evidence timeline.

### 5. Desktop-Local Execution Authority

When work touches a real repository, SingularityNeo resolves the local root
and working directory from the current operator on the current desktop. A
repository-specific desktop mapping wins over a capability fallback, and
claim/start flows only succeed when that mapping validates on the local
filesystem.

## What A Normal Day Looks Like

1. Open a capability and check `Home` for readiness, blockers, and trust signals.
2. Use `Work` to start or continue a work item.
3. If the workflow pauses, review the wait, provide guidance, approve, or take control.
4. Use `Chat` for direct collaboration with the relevant agent or the execution agent.
5. Use `Evidence` to inspect artifacts, approvals, review packets, and flight recorder history.
6. Use `Designer` or `Agents` when the operating model itself needs to change.

## Quick Start

### Prerequisites

- Node.js 22+
- a reachable PostgreSQL instance
- one runtime path configured:
  - preferred: `COPILOT_CLI_URL`
  - fallback: `GITHUB_MODELS_TOKEN`

### Install

```bash
npm install
cp .env.example .env.local
```

### Configure Runtime

Recommended:

```bash
COPILOT_CLI_URL="http://127.0.0.1:4321"
```

Fallback:

```bash
GITHUB_MODELS_TOKEN="github_pat_..."
```

### Configure Database

Set the local Postgres connection in `.env.local`:

```bash
PGHOST="127.0.0.1"
PGPORT="5432"
PGDATABASE="singularity"
PGUSER="postgres"
PGPASSWORD=""
PGADMIN_DATABASE="postgres"
```

You do not need to pre-create every object manually. Singularity can bootstrap the target database from `Database Setup` at `/workspace/databases`.

### Start The App

```bash
npm run dev
```

This starts:

- frontend at `http://localhost:3000`
- API at `http://localhost:3001`

For a split deployment with a remote Express server and a local Electron desktop client, see:

- [Desktop + Control Plane Deployment](./docs/desktop-control-plane-deployment.md)

For boring startup diagnostics, open `Operations` and review **System facts**, or call
`GET /api/runtime/preflight` on the control plane. The preflight response reports
database readiness, active DB profile, model runtime status, renderer build
availability, and governance signing configuration.

## First 10 Minutes

If this is a fresh database or first run:

1. Open `http://localhost:3000/workspace/databases`
2. Confirm the Postgres connection
3. Initialize the database objects and shared foundations
4. Create or open a capability
5. Open `Operations` and save a `Desktop Workspaces` mapping for your current operator on this desktop
6. Review `Agents`, `Designer`, and `Work`

If the workspace looks empty after DB setup, that usually means the shared foundations are loaded but no visible business capability has been created yet.

## Development Commands

```bash
npm run dev          # client + server
npm run dev:client   # Vite only
npm run dev:server   # Express API only
npm run build        # production frontend build
npm run preview      # preview built frontend
npm run start        # serve backend + built frontend
npm run clean        # remove dist
npm run lint         # TypeScript check
npm run test         # all Vitest tests
npm run test:unit    # frontend-focused tests
npm run test:backend # backend-focused tests
npm run test:e2e     # Playwright browser tests
```

## Desktop Client

SingularityNeo ships an Electron desktop client alongside the browser app.
The Express **control plane** runs on a server; the Electron shell and its
**desktop worker** run on the operator's laptop and talk to the server over
`SINGULARITY_CONTROL_PLANE_URL`. Governance, workflow execution, and
Postgres stay server-side — the desktop adds a native chat surface and a
local runtime lane.

### Desktop Workspaces

Desktop execution does not read local roots from shared capability metadata.
Instead, each desktop executor stores mappings for the current operator:

- repository-scoped row: `(executor, user, capability, repository)`
- fallback row: `(executor, user, capability)`

You manage these rows from `Operations` → `Desktop Workspaces`. The UI labels
them clearly as "Stored for this operator on this desktop only."

The runtime uses this precedence:

1. repository-specific desktop mapping
2. capability-level desktop fallback
3. desktop `SINGULARITY_WORKING_DIRECTORY` fallback
4. no runtime fallback to capability metadata

`working_directory_path` must stay inside `local_root_path`. Capability
metadata fields such as repository `localRootHint`, `localDirectories`, and
`defaultWorkspacePath` remain visible as suggestions, but they are no longer
runtime authority for claim, branch creation, or local git execution.

### Work-Item Branch Rule

For repo-backed work, the branch name is standardized everywhere to the
literal `workItem.id`.

- local checkout branch: `workItem.id`
- shared branch context: `workItem.id`
- local commit + push target: `origin workItem.id`
- PR head branch: `workItem.id`

`main` or the repository default branch remains the base branch.

### Laptop env vars

```bash
SINGULARITY_CONTROL_PLANE_URL="https://neo.internal.example"   # required
COPILOT_CLI_URL="http://127.0.0.1:4321"                        # OR
GITHUB_MODELS_TOKEN="github_pat_..."                           # runtime choice
```

Postgres credentials (`PGHOST`/`PGPORT`/…/`PGPASSWORD`) stay on the server
only — the desktop never connects to the database directly.

### Commands

Defined in [`package.json`](./package.json).

| Command                 | Behaviour                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run desktop:start` | Foreground Electron launch. Uses `SINGULARITY_CONTROL_PLANE_URL` for the server and rebuilds an unsafe desktop renderer when needed. |
| `npm run desktop:up`    | Background launch. Writes PID to `.singularity/desktop-dev.pid`, logs to `.singularity/desktop-dev.log`. |
| `npm run desktop:down`  | Stops the backgrounded desktop using the PID file.                                                       |
| `npm run desktop:dev`   | Dev-mode Electron shell against a live-reloading Vite bundle.                                            |
| `npm run desktop:build` | Produces a distributable Electron binary.                                                                |

### Important caveat

Chat is **desktop-owned** — messages don't round-trip through the Express
control plane, so a chat transcript only exists on the operator's laptop
unless they explicitly save it as evidence. Workflow execution is still
**server-owned** and audit-logged through the normal governance pipeline.
Full topology, TLS, multi-machine deployment, and troubleshooting are in
[Desktop + Control Plane Deployment](./docs/desktop-control-plane-deployment.md).

## Architecture

Frontend:

- React 19
- Vite
- TypeScript
- React Router
- Tailwind CSS v4

Backend:

- Express
- PostgreSQL
- GitHub Copilot SDK runtime integration

Runtime model:

- the React app talks to the local Express API
- Postgres is the durable system of record
- workflow execution, waits, artifacts, approvals, and learning are persisted
- the runtime combines deterministic orchestration with agent-backed execution
- desktop-local git and workspace path resolution are derived from validated
  `Desktop Workspaces` mappings for the current operator and executor

## Repository Structure

```text
src/
  components/        shared UI and workspace shells
  context/           capability boot and workspace state
  lib/               lifecycle, workflow, UX, and client helpers
  pages/             Home, Work, Agents, Chat, Evidence, Designer, tools
  types.ts           shared application model

server/
  index.ts           API bootstrap and route registration
  repository.ts      durable persistence and workspace materialization
  db.ts              schema setup and Postgres helpers
  execution/
    service.ts       orchestration engine, requestStepDecision
    tools.ts         tool adapters (workspace_read/write/patch + diff enforcement)
    historyRollup.ts Lever 3 — tool-loop history compression
    contextBudget.ts Lever 5 — per-phase token budget + priority eviction
    tokenEstimate.ts char-based token estimator (provider-aware)
    worker.ts        run worker + scheduling
    repository.ts    run/step/wait/event persistence
    codeDiff.ts      code diff review artifact capture
  agentLearning/     learning profiles, jobs, summaries, quality gate,
                     drift detector, versioning, race hardening
  codeIndex/
    query.ts         symbol lookup, findFileDependents, findFileDependencies
    ingest.ts        code-index population
  governance/        signer, controls catalog, exceptions, provenance
                     extractor, posture aggregator
  routes/
    blastRadius.ts   Blast Radius shadow-execution analysis
    sentinel.ts      Sentinel Mode webhook trigger + autonomous run
  githubModels.ts    provider bridge, invokeBudgetModelSummary (Lever 3/8)
  ledger.ts          evidence aggregation and artifact access
  flightRecorder.ts  explainability and audit reconstruction
```

## Important Product Surfaces

### Work

`/orchestrator` is the main delivery workbench. It is where users:

- start or restart phases
- review blockers and waits
- guide agents
- approve or reject gated work
- inspect attempts and artifacts for the selected work item

### Evidence

`/ledger` is the audit and proof workspace. It is where users:

- browse artifacts and completed work
- inspect approvals and handoffs
- review flight recorder history
- generate or inspect review-ready outputs

### Agents

`/team` is the operating model for collaborators and agents. In the UI, this workspace is labeled `Agents`. It is where users:

- inspect standard agents
- review skills, tools, and learning
- adjust models or role setup
- understand who should help at each stage

### Release Passport

`/release-passport` is the release governance gate. A Release Passport is a structured document that aggregates run evidence, approval chains, risk signals, open findings, test coverage, and a go/no-go recommendation for every run that reaches the release phase. Key features:

- auto-populated from run artifacts and approval records
- each approval is role-scoped (e.g. `TECH_LEAD`, `QA_OWNER`, `COMPLIANCE`)
- passport status (`PENDING` / `APPROVED` / `REJECTED`) is stored and linked to the run
- the signed passport is part of the evidence chain — auditors can verify the release decision was formally approved

### Blast Radius

`/blast-radius` performs a dependency impact analysis before a change is shipped. A Shadow Execution dry-run maps which capabilities and workspace files would break if a proposed file change were deployed. Results are classified:

- **CRITICAL** — direct runtime dependency
- **WARNING** — indirect or soft dependency
- **SAFE** — no detected path to the changed file

Useful as a pre-merge gate and for compliance teams who need to prove a change was risk-assessed before deployment.

### Sentinel Mode

`/sentinel` is the autonomous security remediation surface. When a CVE alert arrives (via webhook), Sentinel:

1. Receives the alert at `POST /api/sentinel/trigger`
2. Identifies the affected workspace and vulnerability context
3. Spawns an execution run that patches, tests, and signs the fix
4. Delivers a Release Passport for human 1-click approval before anything ships

The trigger endpoint accepts an optional `capabilityId` to scope the remediation. Sentinel is integrated into the existing run + evidence + governance pipeline — every automated fix produces an auditable trail identical to a human-initiated run.

## Troubleshooting

### The frontend or backend is not responding

Check the ports:

```bash
lsof -iTCP:3000 -sTCP:LISTEN -n -P
lsof -iTCP:3001 -sTCP:LISTEN -n -P
```

Then restart what you need:

```bash
npm run dev:client
npm run dev:server
```

### The app is waiting for capability workspace or `/api/state`

Check the API directly:

```bash
curl -i http://127.0.0.1:3001/api/state
```

If it hangs or fails:

- confirm Postgres is reachable
- confirm the runtime DB is the expected one in `Database Setup`
- restart the backend cleanly

### Database initialization fails

Open `Database Setup` and verify:

- host
- port
- database name
- user
- password
- admin database

The app supports saved runtime DB profiles, so you can switch between known database connections without retyping each time.

### Copilot runtime is not configured

Set one of:

- `COPILOT_CLI_URL`
- `GITHUB_MODELS_TOKEN`

Then restart the backend.

### Playwright uses your configured database

The e2e suite uses the configured Postgres database. If you do not isolate it, tests can create test capabilities in your normal workspace.

Recommended:

- use a dedicated database for e2e
- or clean up test capabilities after the run

## Token Optimization

SingularityNeo ships a nine-lever token-optimization program that keeps every main-model LLM call as small as possible without losing execution quality. All levers are active by default and can be tuned per capability via `executionConfig`.

### Lever overview

| #   | Name                         | What it does                                                                                                                                                                                                                                                                            |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Phase-sliced guidance**    | `buildGuidanceBlockFromPack()` filters repo guidance to only the categories relevant to the current lifecycle phase. An 8-phase build uses only ~⅛ of the guidance corpus per call.                                                                                                     |
| 2   | **Semantic-hunk reads**      | `workspace_read` accepts a `symbol` name and returns only that function/class body plus ~10 lines of context instead of the whole file (80–95 % token saving). Pass `includeCallers` / `includeCallees` (0–3 each) to also pull in caller/callee signatures for cross-method refactors. |
| 3   | **Tool-loop history rollup** | After ≥ 10 tool turns, the oldest prefix is summarised by the cheapest model on the capability's provider. Only the summary + last 6 raw turns reach the expensive main model. Tunable via `executionConfig.historyRollup`.                                                             |
| 4   | **Diff-first prompting**     | Tool descriptions for `workspace_write`, `workspace_apply_patch`, and `workspace_replace_block` steer agents toward diffs instead of full-file rewrites.                                                                                                                                |
| 5   | **Context Budgeter**         | Every prompt is assembled as typed `BudgetFragment[]` with per-source priorities. When the total would exceed the per-phase token ceiling, the lowest-priority sources are evicted first. SYSTEM_CORE and TOOL_DESCRIPTIONS are never evicted.                                          |
| 6   | **Retrieval Bundle**         | `workspace_read` with `includeCallers` / `includeCallees` surfaces dependent-file paths and their top exported signatures in a single call, so cross-method invariants stay in scope without chaining extra reads.                                                                      |
| 7   | **Prompt Receipts**          | After every main-model call a `PROMPT_RECEIPT` run event is emitted listing which fragments were included, which were evicted, and the estimated token count. Operators can answer "why did the model decide X" by inspecting the receipt.                                              |
| 8   | **Structured Rollup**        | `invokeBudgetModelSummary` returns a JSON state note (`currentGoal`, `lastSuccessfulAction`, `currentBlocker`, `filesInPlay`, `pendingDecision`, `evidenceGenerated`) instead of prose — machine-consumable and more precise.                                                           |
| 9   | **Diff Enforcement**         | `workspace_write` on an existing file is blocked on the second attempt with a recoverable error pointing to `workspace_apply_patch`. The block lifts after two patch failures so agents are never permanently stuck.                                                                    |

### Per-phase token budgets

| Phase                              | Max input tokens | Reserved output |
| ---------------------------------- | ---------------- | --------------- |
| Build / Development / Construction | 64 k             | 16 k            |
| Plan / Design / Elaboration        | 48 k             | 8 k             |
| Analysis / Discover / Inception    | 32 k             | 4 k             |
| QA / Validate / Test / Delivery    | 32 k             | 4 k             |
| Governance / Review / Audit        | 24 k             | 2 k             |
| Release / Deploy / Ship            | 16 k             | 2 k             |
| Unknown / default                  | 64 k             | 16 k            |

### Capability-level tuning knob

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

Set `enabled: false` to bypass the rollup for a debugging session without redeploying.

Full engineering reference: [docs/token-optimization.md](./docs/token-optimization.md).

## Compliance Posture

SingularityNeo ships an audit-grade governance layer across five slices,
all live today. Open `/governance/posture` for a one-screen snapshot of
every pillar below.

### Signed evidence (Slice 1)

Every evidence packet is Ed25519-signed and chained to its predecessor.
Enable signing in three commands:

```bash
npm run governance:init-key
export GOVERNANCE_SIGNING_KEY_PATH="$(pwd)/.secrets/governance-signing.pem"
export GOVERNANCE_SIGNING_ACTIVE_KEY_ID="<printed key id>"
```

Then restart the backend. New packets land with `signature` and
`signing_key_id` set; the packet detail page shows a
`Signed · chain intact` chip and a verify drawer that re-runs signature +
chain verification on demand. Packets produced before a key was
provisioned stay valid and verify as `Unsigned (legacy)`.

The **public** half of every known key lives in
`governance/signing-keys.json` (committed) so downstream verifiers can
check signatures offline with only the repo checkout. The **private** key
stays in `.secrets/` (gitignored); move it to a KMS or sealed secret store
before production use.

### Controls catalog + framework mapping (Slice 2)

`/governance/controls` renders ~45 seeded controls across NIST CSF 2.0,
SOC 2 TSC 2017, and ISO/IEC 27001:2022 Annex A. Internal policies
(`workspace_write`, `run_deploy`, etc.) bind to control codes so
auditors can read platform decisions against a framework instead of an
internal tool name.

### Exception lifecycle (Slice 3)

`/governance/exceptions` is the request → approve → expire flow.
Approved exceptions flip `evaluateToolPolicy` from `REQUIRE_APPROVAL` to
`ALLOW` with `exception_id` stamped on the audit row. The scheduler
auto-expires past-due waivers every ~15 min on the existing learning-worker
tick. `GOVERNANCE_EXCEPTIONS_ENABLED=false` makes the policy hook inert
without losing CRUD or event history.

### Prove-the-negative provenance (Slice 4)

`/governance/provenance` answers "did any AI touch `services/billing/**`
between T1 and T2?" with three honest states — touched / not touched /
gap. A `touched_paths TEXT[]` GIN-indexed column is populated at write
time by a per-tool extractor; the query refines glob matches in-memory
so single-segment `*` behaves correctly. A one-shot backfill script
covers the last 90 days:

```bash
node scripts/governance-backfill-provenance.mjs
```

`GOVERNANCE_PROVENANCE_ENABLED=false` returns a conservative
"inconclusive" without querying; `touched_paths` keeps populating so
the flag is reversible without data loss.

### Posture dashboard (Slice 5)

`/governance/posture` aggregates signer ratio, control coverage by
framework, active + expiring-soon exceptions, recent denials joined to
their bound control, and provenance coverage gaps. Every query runs
behind a safe-query wrapper — a missing subsystem table surfaces as a
warning string, never a 500, so the dashboard is always honest about
what it knows.

Full reference: [docs/governance.md](./docs/governance.md).

## Additional Docs

- [Token Optimization — 9-lever program, per-phase budgets, tuning guide](./docs/token-optimization.md)
- [Governance & Compliance — signer, controls catalog, exceptions, provenance, posture](./docs/governance.md)
- [Desktop + Control Plane Deployment — split topology, env vars, multi-machine setup](./docs/desktop-control-plane-deployment.md)
- [Self-Learning Loop — versioning, quality gate, drift, race hardening](./docs/self-learning-loop.md)
- [Competitive positioning and product gap assessment](./docs/research/competitive-positioning.md)
- [Capability Mermaid diagrams](./docs/capability-mermaid-diagrams.md)
- [Demo video script](./docs/demo-video-script.md)
- [SQL schema and seed exports](./docs/sql/)

## Quality Checks

Run these before pushing:

```bash
npm run lint
npm run test
npm run build
git diff --check
```

If you changed UI flows, also run:

```bash
npm run test:e2e
```

## Notes

- The build currently warns about a large main JS chunk. This does not block the build, but code splitting is still a worthwhile follow-up.
- This repository looks like an active product workspace rather than a polished public package template. Add a license, contribution guide, and security policy before wider distribution.
