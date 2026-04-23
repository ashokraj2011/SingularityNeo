/**
 * Dynamic model routing for the agent tool loop.
 *
 * Rather than sending every tool call — including cheap reads like
 * `workspace_list` and `git_status` — to the capability's primary (often
 * expensive) model, this module classifies each tool by complexity tier and
 * returns the appropriate model override for the next decision turn.
 *
 * Three tiers:
 *   TRIVIAL  — read-only, no state change, low cognitive demand
 *              → use the configured budget model (default: gpt-4o-mini)
 *   STANDARD — moderate reads, build/test execution
 *              → use configured standard model or fall back to agent.model
 *   PRIMARY  — file writes, patch application, deployment, delegation
 *              → always use agent.model (the capability owner's choice)
 *
 * The router is active only when `executionConfig.agentModelRouting.enabled`
 * is `true`. When disabled (or when the config is absent) it returns
 * `agent.model` unchanged, making it a perfect no-op in production until an
 * operator explicitly opts a capability in.
 */

import type { CapabilityAgent } from '../../src/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolComplexityTier = 'TRIVIAL' | 'STANDARD' | 'PRIMARY';

export interface ModelRoutingConfig {
  enabled: boolean;
  /** Model used for TRIVIAL tool turns. Defaults to 'gpt-4o-mini'. */
  budgetModel?: string;
  /** Model used for STANDARD tool turns. Defaults to agent.model. */
  standardModel?: string;
}

// ---------------------------------------------------------------------------
// Tool tier table
// ---------------------------------------------------------------------------

const TOOL_TIERS: Readonly<Record<string, ToolComplexityTier>> = {
  // TRIVIAL — read-only, zero state change
  workspace_list:   'TRIVIAL',
  workspace_search: 'TRIVIAL',
  git_status:       'TRIVIAL',

  // STANDARD — reads with context or build/test execution
  workspace_read:   'STANDARD',
  run_build:        'STANDARD',
  run_test:         'STANDARD',
  run_docs:         'STANDARD',
  publish_bounty:   'STANDARD',
  resolve_bounty:   'STANDARD',
  wait_for_signal:  'STANDARD',

  // PRIMARY — writes, patches, deployment, inter-agent delegation
  workspace_write:         'PRIMARY',
  workspace_apply_patch:   'PRIMARY',
  workspace_replace_block: 'PRIMARY',
  run_deploy:              'PRIMARY',
  delegate_task:           'PRIMARY',
};

const DEFAULT_BUDGET_MODEL = 'gpt-4o-mini';

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Returns the model that should be used for the NEXT decision turn given the
 * tool that was just called.
 *
 * @param agent         The active CapabilityAgent (provides `agent.model`).
 * @param lastToolName  The `toolId` of the tool that just completed. Pass
 *                      `null` on the very first turn (no prior tool) — the
 *                      initial decision always uses the PRIMARY model.
 * @param config        The capability's `agentModelRouting` config.
 * @returns             A model identifier string.
 */
export const resolveModelForTurn = (
  agent: CapabilityAgent,
  lastToolName: string | null,
  config: ModelRoutingConfig | null | undefined,
): string => {
  // Feature flag — off by default; opt-in per capability.
  if (!config?.enabled) return agent.model;

  // First turn / unknown tool → use the primary model to ensure the agent
  // has the best possible context when starting fresh.
  if (!lastToolName) return agent.model;

  const tier = TOOL_TIERS[lastToolName] ?? 'STANDARD';

  if (tier === 'TRIVIAL') {
    return config.budgetModel ?? DEFAULT_BUDGET_MODEL;
  }
  if (tier === 'STANDARD') {
    return config.standardModel ?? agent.model;
  }
  // PRIMARY (or any unknown tier) → always the primary model.
  return agent.model;
};
