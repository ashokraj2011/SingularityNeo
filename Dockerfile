# syntax=docker/dockerfile:1.7

# ---------- build stage ----------
# Compiles the Vite client bundle into /app/dist. We keep this in its
# own stage so the final image doesn't carry build-time caches.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install deps using the lockfile for reproducibility.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source tree and build the client.
COPY . .
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# server/agentGit/* shells out to `git` at runtime; ca-certificates is
# needed for any HTTPS remotes (GitHub, internal registries, etc).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001

# `npm start` runs `tsx server/index.ts`, so we need tsx + typescript
# at runtime. tsx is in devDependencies, so do NOT pass --omit=dev here.
# If you later compile server to JS, switch to `npm ci --omit=dev`.
COPY package.json package-lock.json ./
RUN npm ci

# Built client + server source.
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY tsconfig.json ./
COPY scripts ./scripts

# Persist runtime state (database-runtime.json, uploaded artifacts, etc).
# Mount a named volume or host path here to survive container rebuilds.
RUN mkdir -p /app/.singularity
VOLUME ["/app/.singularity"]

EXPOSE 3001

# HTTP health check — hits /api/health which tests DB connectivity too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
