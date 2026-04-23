# Desktop + Control Plane Deployment

This guide documents the recommended split when Singularity is used across two machines:

- a `server machine` running the Express control plane and Postgres access
- a `user laptop` running the Electron desktop client

It is the right setup when the shared system of record should live on a server, but the operator experience and Copilot runtime should live on the user's workstation.

This guide also documents the current local-workspace rule: execution paths
are resolved from **user-scoped desktop mappings**, not from shared
capability metadata.

## Current Architecture Boundary

Today, the platform is split like this:

- `Express control plane`
  - database access
  - capability and workspace state
  - work items, runs, waits, approvals, artifacts
  - memory search and shared APIs
  - background workflow execution worker
- `Electron desktop client`
  - desktop shell
  - user-facing runtime status
  - runtime token handling
  - direct chat and streamed chat
  - desktop worker

Important current limitation:

- direct interactive Copilot chat is desktop-owned
- automated workflow execution is still server-owned today

That means the server still needs runtime access for background execution until the execution worker is moved fully to desktop mode.

## Desktop Workspace Authority

For local execution, SingularityNeo now treats the laptop as the authority
for local roots and working directories.

- shared capability metadata can still hold repository labels, default
  branches, and local-root hints
- the runtime does **not** claim, inspect, branch, or execute against those
  paths directly
- instead, the current operator on the current desktop saves validated
  mappings in `Operations` → `Desktop Workspaces`

Resolution precedence is:

1. `(executor, user, capability, repository)`
2. `(executor, user, capability)` fallback
3. no metadata fallback

`working_directory_path` must stay inside `local_root_path`.

## Recommended Topology

```text
Server machine
  Express API on :3001
  Postgres access
  shared state / orchestration

Office laptop
  Electron desktop app
  desktop worker
  Copilot CLI or GitHub Models token
```

## Machine Roles

### 1. Server Machine

Use the server machine for:

- Express API
- DB access
- shared workflow state
- approvals
- evidence and artifacts
- shared memory APIs

### 2. User Laptop

Use the laptop for:

- Electron desktop app
- local runtime integration
- direct chat with agents
- Desktop Workspaces configuration for this operator on this machine
- validated local roots and working directories
- future local execution ownership

## Server Machine Setup

### Environment

Create `.env.local` on the server machine with the shared/server-side values:

```env
PGHOST="127.0.0.1"
PGPORT="5432"
PGDATABASE="singularity"
PGUSER="postgres"
PGPASSWORD=""
PGADMIN_DATABASE="postgres"

PORT="3001"

VITE_ENABLE_DEMO_MODE="false"
ENABLE_DEMO_SEED="false"
```

If automated workflow execution is expected to run on the server today, the server still also needs one runtime path:

```env
COPILOT_CLI_URL="http://127.0.0.1:4321"
```

or:

```env
GITHUB_MODELS_TOKEN="github_pat_..."
```

### Start Commands

Development/watch mode:

```bash
cd /path/to/SingularityNeo
npm install
npm run dev:server
```

Production-style backend start:

```bash
cd /path/to/SingularityNeo
npm install
npm run start
```

### What Must Be Reachable

The laptop must be able to reach:

- `http://<server-host>:3001`

So make sure:

- the server binds to a reachable interface
- the firewall allows port `3001`
- the hostname or IP is reachable from the laptop network

## Laptop Setup

### Environment

On the laptop, `.env.local` only needs the desktop/runtime-side values.

Preferred:

```env
COPILOT_CLI_URL="http://127.0.0.1:4321"
```

Fallback:

```env
GITHUB_MODELS_TOKEN="github_pat_..."
```

In the split deployment model, the laptop does not need the Postgres variables if it is not running Express locally.

### First-time desktop setup

After the Electron shell connects:

1. choose the current operator in the top bar
2. open `Operations`
3. go to `Desktop Workspaces`
4. save a local root and optional working directory for each repo-backed
   capability repository you plan to run here

Repository mappings win over the capability fallback row. Saved mappings are
scoped to this operator on this desktop only.

### Start Commands

Foreground Electron start:

```bash
cd /Users/ashokraj/Documents/agentGoogle/SingularityNeo
SINGULARITY_CONTROL_PLANE_URL="http://<server-host>:3001" npm run desktop:start
```

Background desktop dev start:

```bash
cd /Users/ashokraj/Documents/agentGoogle/SingularityNeo
SINGULARITY_CONTROL_PLANE_URL="http://<server-host>:3001" npm run desktop:up
```

Background desktop stop:

```bash
cd /Users/ashokraj/Documents/agentGoogle/SingularityNeo
npm run desktop:down
```

### Useful Desktop Files

When using `desktop:up`, the local launcher writes:

- PID file: `.singularity/desktop-dev.pid`
- log file: `.singularity/desktop-dev.log`

## Day-to-Day Commands

### Server Machine

```bash
cd /path/to/SingularityNeo
npm run dev:server
```

### Office Laptop

```bash
cd /Users/ashokraj/Documents/agentGoogle/SingularityNeo
SINGULARITY_CONTROL_PLANE_URL="http://<server-host>:3001" npm run desktop:up
```

To stop it later:

```bash
cd /Users/ashokraj/Documents/agentGoogle/SingularityNeo
npm run desktop:down
```

## What Runs Where

### Runs On The Server

- capability APIs
- work item APIs
- workflow run persistence
- approvals and waits
- artifact storage and evidence APIs
- memory search APIs
- database bootstrap

### Runs On The Laptop

- Electron shell
- desktop worker
- runtime status checks
- runtime token handling
- direct agent chat
- streamed agent chat
- desktop workspace validation
- local branch / checkout setup for repo-backed work

## Current Important Caveat

If you want Express to be `DB-only`, that is not fully true yet.

Today:

- interactive chat is desktop-owned
- workflow execution is still server-owned

So for the current version:

- the laptop owns direct Copilot chat
- the server still needs runtime configuration for automated runs
- claim and local branch setup still depend on a validated desktop mapping on
  the laptop

## Branch Standard

For work-item-owned repo flows, branch naming is now fixed:

- branch name = exact `workItem.id`
- base branch = repository default branch
- local commit flow pushes `origin workItem.id`

This keeps the local checkout, execution context, agent session, and remote
push path aligned to one identifier.

The target architecture is:

- server: DB + control plane only
- desktop: runtime + execution worker

That final step still requires moving the execution worker off the server.

## Troubleshooting

### Electron cannot connect to the server

Check:

- `SINGULARITY_CONTROL_PLANE_URL` points at the real server host
- port `3001` is open
- `http://<server-host>:3001/api/state` responds

### Desktop starts but chat says runtime is not configured

Check on the laptop:

- `COPILOT_CLI_URL`
- or `GITHUB_MODELS_TOKEN`

### Claim fails because no approved local workspace roots are available

This usually means the current operator has not saved a valid Desktop
Workspaces mapping for this capability on this desktop.

Check:

- the correct operator is selected in the top bar
- the Electron desktop has connected and published an executor id
- `Operations` → `Desktop Workspaces` contains a row for the capability or
  repository
- the local root still exists on disk
- the working directory, if set, is inside the local root

If the repo path changed on the laptop, update the mapping there. Do not
expect capability metadata to fix claim eligibility anymore.

### Workflow runs fail on the server due to runtime configuration

That is expected if the server is still executing workflow runs but has no runtime configured. Until execution moves to desktop, the server still needs its own runtime path.

## Summary

Use this split today:

- `server machine` for Express + DB/shared state
- `user laptop` for Electron + desktop runtime

Keep in mind the temporary bridge:

- desktop owns chat now
- server still owns automated workflow execution for now
