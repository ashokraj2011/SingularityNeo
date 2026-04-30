# Domain Ownership

This document defines the intended ownership boundaries for the modular monolith.

## Self-Service

Purpose: capability/workspace management, workflow design, work-item planning, and workspace settings.

Public entrypoints:
- `server/domains/self-service`

Owns:
- capability metadata and hierarchy
- workspace settings and catalog
- capability agents, skills, repositories, contracts
- workflow designer and task/work-item read surfaces

Allowed dependencies:
- shared contracts in `src/contracts/*`
- pure shared logic in `src/lib/*`
- explicit ports in `server/ports/*`
- owned repository helpers

## Context Fabric

Purpose: conversation continuity, memory shaping, runtime chat evidence, and message persistence.

Public entrypoints:
- `server/domains/context-fabric`

Owns:
- runtime chat audit persistence
- capability message history operations
- memory/context prompt assembly helpers

Allowed dependencies:
- shared contracts in `src/contracts/*`
- explicit ports in `server/ports/*`
- memory/chat services

## Tool Plane

Purpose: tool registry, tool execution coordination, artifact persistence, and code-work execution context.

Public entrypoints:
- `server/domains/tool-plane`

Owns:
- artifact reads and uploads
- code patch artifact lookup
- work-item execution context, claims, checkout sessions, and handoff packets
- tool receipts and tool-facing persistence

Allowed dependencies:
- shared contracts in `src/contracts/*`
- explicit ports in `server/ports/*`
- execution/tool services and owned repository helpers

## Agent Learning

Purpose: learning refresh, distillation, derived learning, and learning worker coordination.

Public entrypoints:
- `server/domains/agent-learning`

Owns:
- learning profiles and versions
- capability/agent learning refresh orchestration
- learning provenance

## LLM Gateway

Purpose: provider adapters, model catalog, session handling, and normalized invocation.

Public entrypoints:
- `server/domains/llm-gateway`

Owns:
- provider/model normalization
- invoke and invoke-stream paths
- provider validation and model listing

## Model Policy

Purpose: model selection, runtime policy, branch policy, and token-management policy surfaces.

Public entrypoints:
- `server/domains/model-policy`

Owns:
- policy templates
- model-routing policy decisions
- runtime fallback and policy-facing helpers

## Platform

Purpose: cross-cutting infrastructure state that does not belong to a product-facing domain.

Public entrypoints:
- `server/domains/platform`

Owns:
- incidents and exports
- identity/external mapping helpers
- shared operational persistence

## Boundary Rules

- Routes import domain entrypoints, not `server/repository.ts`.
- Cross-domain access goes through a domain entrypoint or an explicit port.
- `server/repository.ts` is a temporary compatibility shim during extraction, not a place for new feature work.
- New shared boundary-facing types belong in `src/contracts/*` first; `src/types.ts` remains compatibility only during migration.
