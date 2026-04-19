# SingularityNeo 🚀

SingularityNeo is an **Enterprise AI Operating System** that transforms how teams deliver software. It is a capability-centered delivery workspace that combines autonomous agent orchestration, workflow enforcement, verifiable evidence, and unprecedented governance control into one local-first operating console.

Instead of treating delivery as scattered tools for planning, coding, and reporting, SingularityNeo unifies them under a single **Capability**. It’s not just an orchestrator; it's a governed, auditable, and resilient foundation for human-AI collaboration.

## Why SingularityNeo is Awesome

SingularityNeo isn't just about running agents; it's about **Enterprise Safety and Observability**. We've built state-of-the-art governance right into the core loop:

*   🛡️ **Dynamic Learning & Atomic Rollbacks**: Agents don't just act; they learn. When operators provide corrections, agents distill these into new guardrails. If a bad habit is learned, our **Agent State Versioning** lets you instantly roll back an agent's brain to a previous operational policy snapshot.
*   🔏 **Signed Change Attestations & Tamper-Evident Chain**: Every evidence packet is Ed25519-signed and linked into a `prev_bundle_id` chain rooted at the work item's first attestation. The packet page shows a `Signed · chain intact` chip and a verify drawer that walks the chain, recomputes the digest, and surfaces any gap/cycle/root mismatch. See [Governance](./docs/governance.md).
*   🧭 **Controls Catalog + Framework Mapping**: Every enforced policy binds to external controls across NIST CSF 2.0, SOC 2 TSC 2017, and ISO/IEC 27001:2022 — ~45 seeded controls visible at `/governance/controls` with an audit-legible binding graph so decisions read against a framework instead of an internal tool name.
*   ⏱️ **Time-Bound Exception Lifecycle**: Policy denials can be waived through a first-class request → approve → expire flow. An active exception flips `evaluateToolPolicy` from `REQUIRE_APPROVAL` to `ALLOW` and stamps an `exception_id` on the audit row; the sweeper auto-expires at the deadline. Live at `/governance/exceptions`.
*   🔎 **Prove-the-Negative Provenance**: A single API call answers "did any AI touch `services/billing/**` between T1 and T2?" with three honest states — touched / not touched / gap. Logging gaps never masquerade as a silent "no". Live at `/governance/provenance`.
*   📊 **One-Screen Compliance Posture**: `/governance/posture` aggregates signer ratio, control coverage by framework, active / expiring-soon exceptions, recent denials joined to their bound control, and provenance coverage gaps — the screen to open first during an audit walkthrough.
*   🧪 **Gated, Versioned, Drift-Aware Learning Loop**: Every profile refresh is committed as an immutable version. Shape checks block empty-or-malformed distillations from going live, an async LLM-judge scores every new version against fixtures from real sessions, per-version canary counters feed a drift detector that surfaces regressions for operator-driven revert, and an advisory-lock + append-only audit path makes concurrent corrections race-safe. See [Self-Learning Loop](./docs/self-learning-loop.md).
*   👻 **Shadow Mode Execution**: Need to test a high-stakes deployment without risking production? Toggle a capability into **Shadow Mode**. The execution layer intercepts destructive commands across the entire platform, simulating successful runs to let you validate agent reasoning in a 100% risk-free environment.
*   📋 **Evidence-Based Execution**: Every run leaves behind a durable cryptographic-style evidence trail. Artifacts, handoffs, approvals, and wait states are comprehensively logged in the Flight Recorder, so you never have to ask "why did the agent do that?"
*   🤝 **Strict Human-in-the-Loop Governance**: Agents can plan, design, implement, and review, but the platform ensures humans retain ultimate control over approvals, policy boundaries, and conflict resolution.

## What SingularityNeo Is

SingularityNeo is best understood as a delivery operating system for a business capability.

A capability owns:
- its charter and business outcome
- lifecycle phases and workflow steps
- human collaborators and standard agents
- work items, runs, waits, and approvals
- evidence, handoffs, review packets, and audit trails
- memory, skills, tools, and agent learning

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

## Core Product Ideas

### 1. Capability-Centered
The active capability is the center of gravity. Most of the application follows that selected capability, including its lifecycle, agents, evidence, database-backed state, and runtime context.

### 2. Human-Governed Agents
Agents operate semi-autonomously through workflow steps that strictly define their boundaries, capability restrictions, and tool access, pausing seamlessly for human approval when policies dictate.

### 3. Work With Proof
Every meaningful run can leave behind artifacts, handoffs, approvals, waits, policy decisions, and work-item explainability so the team can see what happened and why.

### 4. Adaptable Lifecycle
The platform supports capability-specific lifecycles, including organization-specific flows like Brokerage SDLC. Lifecycle phases drive the Work lanes, Designer structure, and Evidence timeline.

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

You do not need to pre-create every object manually. Singulairy can bootstrap the target database from `Database Setup` at `/workspace/databases`.

### Start The App

```bash
npm run dev
```

This starts:
- frontend at `http://localhost:3000`
- API at `http://localhost:3001`

For a split deployment with a remote Express server and a local Electron desktop client, see:

- [Desktop + Control Plane Deployment](./docs/desktop-control-plane-deployment.md)

## First 10 Minutes

If this is a fresh database or first run:

1. Open `http://localhost:3000/workspace/databases`
2. Confirm the Postgres connection
3. Initialize the database objects and shared foundations
4. Create or open a capability
5. Review `Agents`, `Designer`, and `Work`

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
  execution/         runs, waits, worker, tools, orchestration
  agentLearning/     learning profiles, jobs, summaries, quality gate,
                     drift detector, versioning, race hardening
  governance/        signer, controls catalog, exceptions, provenance
                     extractor, posture aggregator
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

- [Governance & Compliance — signer, controls catalog, exceptions, provenance, posture](./docs/governance.md)
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
