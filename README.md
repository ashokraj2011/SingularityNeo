# Singularity Neo

Singularity Neo is a capability-centered delivery workspace for enterprise software teams. It combines business-facing capability management with AI-assisted collaboration, workflow design, orchestration, evidence tracking, and runtime-backed execution.

The current product direction is:
- `Home` tells a business owner what matters now
- `Work` moves delivery through a capability-owned lifecycle
- `Team` shows who can help and whether they are ready
- `Chat` gives capability-scoped collaboration with resumable context
- `Evidence` shows artifacts, handoffs, and flight recorder history
- `Designer` defines the workflow and lifecycle lanes that drive execution

## What It Does

Singularity Neo treats a `capability` as the operating unit of the workspace. A capability owns:
- its business charter
- collaborators and agents
- approved workspaces and command templates
- workflows and lifecycle phases
- work items and workflow runs
- artifacts, handoffs, and evidence
- memory and agent learning

Primary surfaces:
- `Home` (`/`) - capability trust, next action, delivery, and evidence
- `Work` (`/orchestrator`) - orchestration board, waits, approvals, restart/reset
- `Team` (`/team`) - collaborators, readiness, learning refresh, chat handoff
- `Chat` (`/chat`) - capability-scoped collaboration with context inspector
- `Evidence` (`/ledger`) - artifacts, completed work, and work-item flight recorder
- `Designer` (`/designer`) - full-screen Workflow Designer Neo

Advanced tools:
- `Run Console` (`/run-console`)
- `Memory Explorer` (`/memory`)
- `Eval Center` (`/evals`)
- `Skill Library` (`/skills`)
- `Artifact Designer` (`/artifact-designer`)
- `Tasks` (`/tasks`)
- `Studio` (`/studio`)

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
- GitHub Copilot SDK

Runtime model:
- the React app talks only to the local Express API
- the Express API is the system of record for capabilities and workspace state
- capability data is persisted in Postgres
- runtime-backed chat and execution use the GitHub Copilot SDK

Persistence model:
- capability records live in Postgres
- workspace entities are capability-scoped
- workflow runs, waits, artifacts, learning profiles, and sessions are durable

## Prerequisites

- Node.js 22+ recommended
- PostgreSQL running locally or reachable from the API server
- one Copilot runtime path configured:
  - preferred: `COPILOT_CLI_URL`
  - fallback: `GITHUB_MODELS_TOKEN`

## Quick Start

1. Install dependencies.

```bash
npm install
```

2. Create `.env.local` from `.env.example`.

```bash
cp .env.example .env.local
```

3. Set your runtime configuration in `.env.local`.

Recommended enterprise path:

```bash
COPILOT_CLI_URL="http://127.0.0.1:4321"
```

Token fallback:

```bash
GITHUB_MODELS_TOKEN="github_pat_..."
```

4. Set your local Postgres connection in `.env.local`.

```bash
PGHOST="127.0.0.1"
PGPORT="5432"
PGDATABASE="singularity"
PGUSER="postgres"
PGPASSWORD=""
PGADMIN_DATABASE="postgres"
```

5. If the database does not exist yet, create it once.

```bash
createdb singularity
```

6. Start the app.

```bash
npm run dev
```

This starts:
- Vite on `http://localhost:3000`
- the Express API on `http://localhost:3001`

## Useful Scripts

```bash
npm run dev          # client + server
npm run dev:client   # Vite only
npm run dev:server   # Express API only
npm run build        # production frontend build
npm run start        # serve backend + built frontend
npm run lint         # TypeScript check
npm run test         # all Vitest tests
npm run test:unit    # frontend-focused tests
npm run test:backend # backend-focused tests
npm run test:e2e     # Playwright browser tests
```

## Environment Variables

Important variables:

```bash
COPILOT_CLI_URL=""
GITHUB_MODELS_TOKEN=""
PORT="3001"
VITE_ENABLE_DEMO_MODE="false"
ENABLE_DEMO_SEED="false"
PGHOST="127.0.0.1"
PGPORT="5432"
PGDATABASE="singularity"
PGUSER="postgres"
PGPASSWORD=""
PGADMIN_DATABASE="postgres"
```

Notes:
- `COPILOT_CLI_URL` is the preferred long-term enterprise runtime path
- `GITHUB_MODELS_TOKEN` is a fallback, not the preferred production setup
- `VITE_ENABLE_DEMO_MODE` and `ENABLE_DEMO_SEED` should stay `false` for real workspaces
- the Vite dev server proxies `/api` to `http://127.0.0.1:3001` unless `VITE_API_PROXY_TARGET` overrides it

## Repo Structure

```text
src/
  components/        shared UI and layout
  context/           capability state and app boot flow
  lib/               client helpers, lifecycle, workflow, UX models
  pages/             Home, Work, Team, Chat, Evidence, Designer, Advanced tools
  types.ts           shared frontend domain model

server/
  index.ts           Express bootstrap and route registration
  repository.ts      capability and workspace persistence
  execution/         workflow runs, waits, orchestration, worker
  agentLearning/     learning profiles, jobs, sessions
  memory.ts          capability memory indexing and retrieval
  ledger.ts          evidence and artifact aggregation
  flightRecorder.ts  work-item audit reconstruction
  db.ts              Postgres init and schema evolution

tests/
  e2e/               Playwright flows
```

## Product Highlights

- Business-first capability home with trust and proof milestones
- Capability-owned lifecycle phases that drive workflow lanes and work board columns
- Full-screen Workflow Designer Neo
- Team workspace with agent learning and resumable session visibility
- Collaboration-first chat with context inspector and stream recovery
- Orchestrator with approvals, blockers, restart, and reset controls
- Evidence and Flight Recorder views for artifacts and end-to-end audit history
- Built-in contrarian reviewer support for conflict-resolution waits

## Quality Gates

Run these before pushing changes:

```bash
npm run lint
npm run test
npm run build
git diff --check
```

If you are touching UI flows, also run:

```bash
npm run test:e2e
```

## Troubleshooting

### Port 3001 is already in use

Check what owns the API port:

```bash
lsof -iTCP:3001 -sTCP:LISTEN -n -P
```

If you need a clean restart:

```bash
pkill -f "server/index.ts"
npm run dev:server
```

### App hangs on “Waiting for the authoritative capability workspace”

This means the frontend is waiting for `/api/state`.

Check the API directly:

```bash
curl -i http://127.0.0.1:3001/api/state
```

If it hangs:
- confirm Postgres is reachable
- confirm the API process is healthy
- restart the backend cleanly

### Copilot is not configured

You must set one of:
- `COPILOT_CLI_URL`
- `GITHUB_MODELS_TOKEN`

Then restart the backend.

### Playwright creates test capabilities

The e2e suite currently uses the configured Postgres database. If you run Playwright against your normal local database, it will create test capabilities unless you isolate it to a separate DB.

Recommended:
- use a dedicated Postgres database for e2e runs
- or clean up test capabilities after the suite

### Large bundle warning during build

The production build currently warns about a large main JS chunk. This does not block the build, but it is a good candidate for future code-splitting work.

## Current Defaults And Assumptions

- business-owner-first UX for primary navigation
- desktop-first design
- Postgres as the durable system of record
- GitHub Copilot SDK as the AI runtime path
- demo data disabled by default

## License / Internal Use

This repository appears to be an active product workspace rather than a polished public package template. If you plan to publish or distribute it outside your organization, add the appropriate license, contribution guide, and security policy first.
