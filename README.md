# Singulairy

Singulairy is a capability-centered delivery workspace for enterprise software teams. It combines workflow orchestration, agent collaboration, approvals, evidence, and auditability in one local-first operating console.

Instead of treating delivery as separate tools for planning, coding, approvals, and reporting, Singulairy keeps them connected inside one selected capability.

## What Singulairy Is

Singulairy is best understood as a delivery operating system for a business capability.

A capability owns:
- its charter and business outcome
- lifecycle phases and workflow steps
- human collaborators and standard agents
- work items, runs, waits, and approvals
- evidence, handoffs, review packets, and audit trails
- memory, skills, tools, and agent learning

The product is strongest when a team wants to:
- move work through an explicit SDLC or org-specific lifecycle
- let agents help, but keep humans in control
- explain why work is blocked, waiting, approved, or complete
- keep durable evidence for reviews, release readiness, and audit

## Main Workspaces

- `Home` shows capability health, trust, readiness, and what matters now.
- `Work` is the delivery workbench for operating one work item well.
- `Team` shows standard agents, custom agents, skills, tools, and learning.
- `Chat` gives capability-scoped and execution-aware collaboration.
- `Evidence` provides artifacts, completed work, approvals, and flight recorder history.
- `Designer` defines workflows, lifecycle lanes, and operating rules.

Advanced tools include:
- `Run Console`
- `Memory Explorer`
- `Eval Center`
- `Skill Library`
- `Artifact Designer`
- `Tool Access`
- `Tasks`
- `Studio`
- `Database Setup`

## Core Product Ideas

### 1. Capability-Centered

The active capability is the center of gravity. Most of the application follows that selected capability, including its lifecycle, agents, evidence, database-backed state, and runtime context.

### 2. Human-Governed Agents

Agents can plan, design, implement, validate, review, and explain. Workflow steps still control actual tool access, approvals, artifact contracts, and execution boundaries.

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
6. Use `Designer` or `Team` when the operating model itself needs to change.

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

## First 10 Minutes

If this is a fresh database or first run:

1. Open `http://localhost:3000/workspace/databases`
2. Confirm the Postgres connection
3. Initialize the database objects and shared foundations
4. Create or open a capability
5. Review `Team`, `Designer`, and `Work`

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
  pages/             Home, Work, Team, Chat, Evidence, Designer, tools
  types.ts           shared application model

server/
  index.ts           API bootstrap and route registration
  repository.ts      durable persistence and workspace materialization
  db.ts              schema setup and Postgres helpers
  execution/         runs, waits, worker, tools, orchestration
  agentLearning/     learning profiles, jobs, and summaries
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

### Team

`/team` is the operating model for collaborators and agents. It is where users:
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

## Additional Docs

- [Competitive positioning and product gap assessment](./docs/research/competitive-positioning.md)
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
