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
3. Set `GITHUB_MODELS_TOKEN` in `.env.local` to a GitHub token with GitHub Models access
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
The Express server handles the external GitHub Copilot / GitHub Models request, exposes permissive `allow all` CORS headers for API access, and persists the capability workspace into local Postgres with `capabilityId` as the top-level ownership key across capabilities, agents, skills, chats, workflows, artifacts, tasks, execution logs, learning updates, and work items.

To serve the built app through the same API server:

1. Build the client:
   `npm run build`
2. Start the server:
   `npm run start`
