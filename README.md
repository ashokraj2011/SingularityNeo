<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your capability workspace

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3777a1e7-b438-4857-8698-bd077eee3e3d

## Run Locally

**Prerequisites:** Node.js, PostgreSQL


1. Install dependencies:
   `npm install`
2. Create `.env.local` from [.env.example](/Users/ashokraj/Documents/agentGoogle/SingularityNeo/.env.example)
3. Choose one runtime mode in `.env.local`:
   `Preferred:` set `COPILOT_CLI_URL` to a running headless Copilot CLI server
   `Fallback:` set `GITHUB_MODELS_TOKEN` to a GitHub token the GitHub Copilot SDK can use
4. Confirm local Postgres is available for the capability workspace system of record:
   `PGHOST=127.0.0.1`
   `PGPORT=5432`
   `PGDATABASE=singularity`
   `PGUSER=postgres`
5. If your Postgres user cannot create databases automatically, create it once:
   `createdb singularity`
6. Run the app:
   `npm run dev`

The local dev script starts both:
- the Vite client on `http://localhost:3000`
- the Express API on `http://localhost:3001`

The React app only calls the local Express API.
The Express server handles the external GitHub Copilot SDK runtime, exposes permissive `allow all` CORS headers for API access, and persists the capability workspace into local Postgres with `capabilityId` as the top-level ownership key across capabilities, agents, skills, chats, workflows, artifacts, tasks, execution logs, learning updates, and work items.

For enterprise setups, prefer `COPILOT_CLI_URL` so the app connects to a stable headless Copilot CLI service instead of relying on the token-based HTTP fallback path.

## Quality Gates

Use these checks before committing stabilization or UX changes:

1. Type-check the full project:
   `npm run lint`
2. Run unit and backend smoke tests:
   `npm run test`
3. Run frontend-focused tests only:
   `npm run test:unit`
4. Run backend-focused tests only:
   `npm run test:backend`
5. Run browser smoke tests:
   `npm run test:e2e`
6. Build the production bundle:
   `npm run build`

Playwright uses `npm run dev` as its web server and reuses an existing local server when one is already running.

To serve the built app through the same API server:

1. Build the client:
   `npm run build`
2. Start the server:
   `npm run start`
