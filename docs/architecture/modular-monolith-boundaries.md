# SingularityNeo Modular-Monolith Boundaries

SingularityNeo stays a single deployable product for now, but the codebase should behave like a set of internal services with explicit seams.

## Domain map

| Domain | Purpose | Public server entrypoint |
| --- | --- | --- |
| Self-Service | capabilities, workflows, work items, orchestration | `server/domains/self-service/index.ts` |
| Context Fabric | memory, AST grounding, live work context, continuity | `server/domains/context-fabric/index.ts` |
| LLM Gateway | provider adapters, sessions, invocation, model catalogs | `server/domains/llm-gateway/index.ts` |
| Agent Registry & Learning | agent profiles, learning refresh, sessions | `server/domains/agent-learning/index.ts` |
| Tool Registry & Execution Plane | tool catalog, tool loop, workflow execution | `server/domains/tool-plane/index.ts` |
| Local Runner | desktop execution ownership and local runtime wiring | `server/domains/local-runner/index.ts` |
| User Management | actor context, access control, approval authority | `server/domains/access/index.ts` |
| Model Policy Resolver | runtime readiness, token/model routing policy | `server/domains/model-policy/index.ts` |
| Platform / Observability | DB bootstrap, telemetry, health, HTTP infra | `server/domains/platform/index.ts` |

## Rules

1. `server/index.ts` is a composition root only.
2. Files under `server/app/` may depend on:
   - `server/domains/*`
   - `server/routes/*`
   - `server/ports/*`
   - `src/contracts/*`
3. Files under `server/app/` must not import `src/lib/*` or `src/types.ts` directly.
4. Shared contracts belong in `src/contracts/*`. `src/types.ts` remains a compatibility source during migration, but new boundary-facing code should prefer contracts.
5. Cross-domain collaboration should happen through:
   - domain entrypoints
   - explicit ports in `server/ports/*`
   - route-to-service handoff
6. Client feature/API splits should follow the same domain map over time.

## Current migration strategy

- `src/contracts/*` is the new boundary-safe shared contract layer.
- `server/domains/*` provides stable server-side public surfaces over legacy modules.
- `server/app/*` contains composition and request-assembly helpers that should stay thin.
- Future refactors should shrink the legacy hotspot files by moving logic behind these seams rather than adding new responsibilities to them.

## Ownership expectations

- Each domain should eventually own its repository module, service module, tests, and docs.
- Table ownership stays logical for now even though Postgres remains shared.
- New code should prefer adding to a domain entrypoint or domain-owned module instead of expanding generic shared utility files.
- Domain-by-domain ownership details live in `docs/architecture/domain-ownership.md`.
