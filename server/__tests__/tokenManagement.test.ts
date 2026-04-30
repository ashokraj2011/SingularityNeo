// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Capability } from '../../src/types';
import {
  classifyModelComplexity,
  recommendModelForTurn,
  resolveTokenManagementPolicy,
  sanitizeTokenManagementPolicy,
} from '../tokenManagement';

const buildCapability = (executionConfig: Partial<Capability['executionConfig']> = {}) =>
  ({
    id: 'CAP-TOKENS',
    name: 'Token Test Capability',
    localDirectories: [],
    executionConfig: {
      allowedWorkspacePaths: [],
      commandTemplates: [],
      deploymentTargets: [],
      ...executionConfig,
    },
  }) as Capability;

describe('tokenManagement policy service', () => {
  it('defaults to advisor-first strategy modes with receipt auditing automatic', () => {
    const policy = resolveTokenManagementPolicy(buildCapability());

    expect(policy.mode).toBe('advisor');
    expect(policy.strategyModes['context-budgeting']).toBe('advisory');
    expect(policy.strategyModes['model-adaptive-routing']).toBe('advisory');
    expect(policy.strategyModes['receipt-auditing']).toBe('automatic');
    expect(policy.strictBudgetEnforcement).toBe(false);
  });

  it('lets strategy overrides beat global module mode', () => {
    const policy = resolveTokenManagementPolicy(
      buildCapability({
        tokenManagement: {
          mode: 'auto',
          strategyModes: {
            'history-rollup': 'disabled',
            'semantic-code-hunks': 'advisory',
          },
        },
      }),
    );

    expect(policy.strategyModes['context-budgeting']).toBe('automatic');
    expect(policy.strategyModes['history-rollup']).toBe('disabled');
    expect(policy.strategyModes['semantic-code-hunks']).toBe('advisory');
  });

  it('maps legacy history/model routing knobs into compatibility strategy modes', () => {
    const policy = resolveTokenManagementPolicy(
      buildCapability({
        historyRollup: { enabled: false },
        agentModelRouting: { enabled: true, budgetModel: 'qwen2.5-coder:7b' },
      }),
    );

    expect(policy.strategyModes['history-rollup']).toBe('disabled');
    expect(policy.strategyModes['model-adaptive-routing']).toBe('automatic');
    expect(policy.modelAdaptive?.budgetModel).toBe('qwen2.5-coder:7b');
  });

  it('keeps strict mode off until a budget is configured', () => {
    const capability = buildCapability();
    const sanitized = sanitizeTokenManagementPolicy(capability, {
      mode: 'strict',
      strictBudgetEnforcement: true,
      budgets: [],
    });

    expect(sanitized.mode).toBe('advisor');
    expect(sanitized.strictBudgetEnforcement).toBe(false);
  });

  it('records advisory model recommendations without changing selection', () => {
    const capability = buildCapability({
      tokenManagement: {
        mode: 'advisor',
        strategyModes: {
          'model-adaptive-routing': 'advisory',
        },
        modelAdaptive: {
          budgetModel: 'qwen2.5-coder:7b',
        },
      },
    });

    const recommendation = recommendModelForTurn({
      capability,
      selectedProviderKey: 'local-openai',
      selectedModel: 'gpt-4.1',
      toolId: 'workspace_search',
    });

    expect(recommendation.complexityTier).toBe('TRIVIAL');
    expect(recommendation.recommendedModel).toBe('qwen2.5-coder:7b');
    expect(recommendation.applied).toBe(false);
    expect(recommendation.appliedModel).toBe('gpt-4.1');
  });

  it('applies adaptive routing only when the strategy is automatic', () => {
    const capability = buildCapability({
      tokenManagement: {
        mode: 'auto',
        strategyModes: {
          'model-adaptive-routing': 'automatic',
        },
        modelAdaptive: {
          budgetModel: 'qwen2.5-coder:7b',
        },
      },
    });

    const recommendation = recommendModelForTurn({
      capability,
      selectedProviderKey: 'local-openai',
      selectedModel: 'gpt-4.1',
      toolId: 'workspace_search',
    });

    expect(recommendation.applied).toBe(true);
    expect(recommendation.appliedModel).toBe('qwen2.5-coder:7b');
  });

  it('preserves model selection when adaptive routing is disabled', () => {
    const capability = buildCapability({
      tokenManagement: {
        strategyModes: {
          'model-adaptive-routing': 'disabled',
        },
        modelAdaptive: {
          budgetModel: 'qwen2.5-coder:7b',
        },
      },
    });

    const recommendation = recommendModelForTurn({
      capability,
      selectedProviderKey: 'local-openai',
      selectedModel: 'gpt-4.1',
      toolId: 'workspace_search',
    });

    expect(recommendation.strategyMode).toBe('disabled');
    expect(recommendation.applied).toBe(false);
    expect(recommendation.appliedModel).toBe('gpt-4.1');
  });

  it('classifies governance and write turns above read-only discovery', () => {
    expect(classifyModelComplexity({ toolId: 'workspace_search' })).toBe('TRIVIAL');
    expect(classifyModelComplexity({ toolId: 'workspace_apply_patch' })).toBe('COMPLEX');
    expect(classifyModelComplexity({ requiresApproval: true })).toBe('CRITICAL');
  });
});
