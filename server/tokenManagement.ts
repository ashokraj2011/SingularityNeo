import type {
  Capability,
  CapabilityWorkspace,
  ModelComplexityTier,
  ModelRoutingRecommendation,
  PersistedPromptReceipt,
  ProviderKey,
  RuntimeModelOption,
  TokenBudgetLimit,
  TokenBudgetScope,
  TokenManagementCapabilitySnapshot,
  TokenManagementPolicy,
  TokenManagementRecommendation,
  TokenManagementSummary,
  TokenOptimizationReceipt,
  TokenPolicyMode,
  TokenPromptEstimateResponse,
  TokenSavingStrategyKey,
  TokenStrategyMode,
  TokenUsageBreakdown,
} from '../src/types';
import { query } from './db';
import { estimateTokens, normalizeProviderForEstimate, type TokenEstimateKind } from './execution/tokenEstimate';
import {
  mapPromptReceiptRow,
  type PromptReceiptRecord,
} from './execution/promptReceipts';
import {
  fetchAppState,
  getCapabilityBundle,
} from './domains/self-service/repository';

export const TOKEN_SAVING_STRATEGIES: TokenSavingStrategyKey[] = [
  'context-budgeting',
  'history-rollup',
  'semantic-code-hunks',
  'ast-first-discovery',
  'memory-budgeting',
  'diff-first-editing',
  'model-adaptive-routing',
  'receipt-auditing',
];

const PROVIDER_KEYS: ProviderKey[] = [
  'github-copilot',
  'local-openai',
  'gemini',
  'custom-router',
  'claude-code-cli',
  'codex-cli',
  'aider-cli',
];

const DEFAULT_TOKEN_POLICY_MODE: TokenPolicyMode = 'advisor';
const DEFAULT_BUDGET_MODEL = 'gpt-4o-mini';
const DEFAULT_STANDARD_MODEL = 'gpt-4.1-mini';

const isProviderKey = (value: unknown): value is ProviderKey =>
  typeof value === 'string' && PROVIDER_KEYS.includes(value as ProviderKey);

const isStrategyKey = (value: unknown): value is TokenSavingStrategyKey =>
  typeof value === 'string' &&
  TOKEN_SAVING_STRATEGIES.includes(value as TokenSavingStrategyKey);

const normalizePolicyMode = (value: unknown): TokenPolicyMode =>
  value === 'auto' || value === 'strict' || value === 'advisor'
    ? value
    : DEFAULT_TOKEN_POLICY_MODE;

const normalizeStrategyMode = (value: unknown): TokenStrategyMode | null =>
  value === 'disabled' || value === 'advisory' || value === 'automatic'
    ? value
    : null;

const baselineStrategyModeForPolicy = (
  mode: TokenPolicyMode,
): TokenStrategyMode => (mode === 'advisor' ? 'advisory' : 'automatic');

const estimateCostUsd = (tokens: number, model?: string | null) => {
  const normalized = String(model || '').toLowerCase();
  const rate =
    normalized.includes('mini') ||
    normalized.includes('flash') ||
    normalized.includes('haiku') ||
    normalized.includes('small') ||
    normalized.includes(':7b')
      ? 0.000001
      : normalized.includes('opus') ||
          normalized.includes('o3') ||
          normalized.includes('critical')
        ? 0.000008
        : 0.000003;
  return Number((Math.max(0, tokens) * rate).toFixed(6));
};

const normalizeBudget = (budget: Partial<TokenBudgetLimit>): TokenBudgetLimit | null => {
  const scope =
    budget.scope === 'CAPABILITY' ||
    budget.scope === 'AGENT' ||
    budget.scope === 'WORK_ITEM' ||
    budget.scope === 'PHASE'
      ? budget.scope
      : null;
  if (!scope) return null;

  const tokenBudget = Number(budget.tokenBudget || 0);
  const costBudgetUsd = Number(budget.costBudgetUsd || 0);
  if (tokenBudget <= 0 && costBudgetUsd <= 0) return null;

  return {
    scope,
    scopeId: budget.scopeId ? String(budget.scopeId) : undefined,
    tokenBudget: tokenBudget > 0 ? Math.floor(tokenBudget) : undefined,
    costBudgetUsd: costBudgetUsd > 0 ? Number(costBudgetUsd.toFixed(4)) : undefined,
    phase: budget.phase ? String(budget.phase) : undefined,
    agentId: budget.agentId ? String(budget.agentId) : undefined,
    workItemId: budget.workItemId ? String(budget.workItemId) : undefined,
  };
};

const normalizeStrategyModes = (
  capability: Capability,
  mode: TokenPolicyMode,
  inputModes: TokenManagementPolicy['strategyModes'] | undefined,
  diagnosticsOff: boolean,
): Record<TokenSavingStrategyKey, TokenStrategyMode> => {
  const baseline = baselineStrategyModeForPolicy(mode);
  const modes = TOKEN_SAVING_STRATEGIES.reduce(
    (acc, key) => {
      acc[key] = key === 'receipt-auditing' ? 'automatic' : baseline;
      return acc;
    },
    {} as Record<TokenSavingStrategyKey, TokenStrategyMode>,
  );

  if (capability.executionConfig?.historyRollup?.enabled === false) {
    modes['history-rollup'] = 'disabled';
  }
  if (capability.executionConfig?.agentModelRouting?.enabled === true) {
    modes['model-adaptive-routing'] = 'automatic';
  }

  Object.entries(inputModes || {}).forEach(([key, value]) => {
    if (!isStrategyKey(key)) return;
    const normalized = normalizeStrategyMode(value);
    if (normalized) {
      modes[key] = normalized;
    }
  });

  if (!diagnosticsOff) {
    modes['receipt-auditing'] = 'automatic';
  }

  return modes;
};

export const resolveTokenManagementPolicy = (
  capability: Capability,
): TokenManagementPolicy & {
  mode: TokenPolicyMode;
  strategyModes: Record<TokenSavingStrategyKey, TokenStrategyMode>;
  budgets: TokenBudgetLimit[];
  strictBudgetEnforcement: boolean;
  diagnosticsOff: boolean;
} => {
  const configured = capability.executionConfig?.tokenManagement || {};
  const diagnosticsOff = Boolean(configured.diagnosticsOff);
  const budgets = (configured.budgets || [])
    .map(budget => normalizeBudget(budget))
    .filter((budget): budget is TokenBudgetLimit => Boolean(budget));
  const requestedMode = normalizePolicyMode(configured.mode);
  const mode = requestedMode === 'strict' && budgets.length === 0 ? 'advisor' : requestedMode;
  const strategyModes = normalizeStrategyModes(
    capability,
    mode,
    configured.strategyModes,
    diagnosticsOff,
  );

  return {
    ...configured,
    mode,
    strategyModes,
    budgets,
    strictBudgetEnforcement:
      mode === 'strict' && budgets.length > 0 && configured.strictBudgetEnforcement === true,
    diagnosticsOff,
    modelAdaptive: {
      enabled: configured.modelAdaptive?.enabled ?? true,
      providerKey: configured.modelAdaptive?.providerKey,
      budgetModel:
        configured.modelAdaptive?.budgetModel ||
        capability.executionConfig?.agentModelRouting?.budgetModel ||
        DEFAULT_BUDGET_MODEL,
      standardModel:
        configured.modelAdaptive?.standardModel ||
        capability.executionConfig?.agentModelRouting?.standardModel ||
        DEFAULT_STANDARD_MODEL,
      complexModel: configured.modelAdaptive?.complexModel,
      criticalModel: configured.modelAdaptive?.criticalModel,
    },
  };
};

export const sanitizeTokenManagementPolicy = (
  capability: Capability,
  input: Partial<TokenManagementPolicy>,
): TokenManagementPolicy => {
  const current = resolveTokenManagementPolicy(capability);
  const diagnosticsOff = Boolean(input.diagnosticsOff);
  const budgets = (input.budgets || current.budgets || [])
    .map(budget => normalizeBudget(budget))
    .filter((budget): budget is TokenBudgetLimit => Boolean(budget));
  const requestedMode = normalizePolicyMode(input.mode ?? current.mode);
  const mode = requestedMode === 'strict' && budgets.length === 0 ? 'advisor' : requestedMode;
  const strategyModes: TokenManagementPolicy['strategyModes'] = {};

  Object.entries(input.strategyModes || {}).forEach(([key, value]) => {
    if (!isStrategyKey(key)) return;
    const normalized = normalizeStrategyMode(value);
    if (normalized) strategyModes[key] = normalized;
  });
  if (!diagnosticsOff) {
    strategyModes['receipt-auditing'] = 'automatic';
  }

  const providerKey = isProviderKey(input.modelAdaptive?.providerKey)
    ? input.modelAdaptive?.providerKey
    : current.modelAdaptive?.providerKey;

  return {
    mode,
    strategyModes,
    budgets,
    strictBudgetEnforcement:
      mode === 'strict' && budgets.length > 0 && input.strictBudgetEnforcement === true,
    diagnosticsOff,
    modelAdaptive: {
      enabled: input.modelAdaptive?.enabled ?? current.modelAdaptive?.enabled ?? true,
      providerKey,
      budgetModel:
        input.modelAdaptive?.budgetModel || current.modelAdaptive?.budgetModel,
      standardModel:
        input.modelAdaptive?.standardModel || current.modelAdaptive?.standardModel,
      complexModel:
        input.modelAdaptive?.complexModel || current.modelAdaptive?.complexModel,
      criticalModel:
        input.modelAdaptive?.criticalModel || current.modelAdaptive?.criticalModel,
    },
    updatedAt: new Date().toISOString(),
  };
};

export const getEnabledTokenStrategies = (
  strategyModes: Record<TokenSavingStrategyKey, TokenStrategyMode>,
) => TOKEN_SAVING_STRATEGIES.filter(key => strategyModes[key] === 'automatic');

export const getDisabledTokenStrategies = (
  strategyModes: Record<TokenSavingStrategyKey, TokenStrategyMode>,
) => TOKEN_SAVING_STRATEGIES.filter(key => strategyModes[key] === 'disabled');

export interface ModelRoutingRecommendationInput {
  capability: Capability;
  selectedProviderKey?: ProviderKey | null;
  selectedModel?: string | null;
  phase?: string | null;
  toolId?: string | null;
  intent?: string | null;
  writeMode?: boolean;
  requiresApproval?: boolean;
  governanceState?: string | null;
  complexityTier?: ModelComplexityTier;
  availableModels?: RuntimeModelOption[];
  budgetScope?: TokenBudgetScope;
  budgetRemainingTokens?: number | null;
  budgetRemainingUsd?: number | null;
}

export const classifyModelComplexity = ({
  phase,
  toolId,
  intent,
  writeMode,
  requiresApproval,
  governanceState,
  complexityTier,
}: Omit<ModelRoutingRecommendationInput, 'capability'>): ModelComplexityTier => {
  if (complexityTier) return complexityTier;
  const text = [phase, toolId, intent, governanceState].filter(Boolean).join(' ').toLowerCase();
  if (
    requiresApproval ||
    /approval|governance|incident|conflict|deploy|release|critical|security|policy/.test(text)
  ) {
    return 'CRITICAL';
  }
  if (
    writeMode ||
    /write|patch|apply|edit|refactor|architecture|migration|design|implementation|code_diff/.test(text)
  ) {
    return 'COMPLEX';
  }
  if (/workspace_read|run_build|run_test|test|build|analysis|planning|learning/.test(text)) {
    return 'STANDARD';
  }
  if (/workspace_list|workspace_search|browse_code|git_status|read-only|lookup|search/.test(text)) {
    return 'TRIVIAL';
  }
  return 'STANDARD';
};

const chooseModelForTier = (
  tier: ModelComplexityTier,
  policy: ReturnType<typeof resolveTokenManagementPolicy>,
  selectedModel?: string | null,
  availableModels: RuntimeModelOption[] = [],
) => {
  const configured = policy.modelAdaptive || {};
  const availableIds = new Set(
    availableModels.flatMap(model => [model.id, model.apiModelId, model.label].filter(Boolean)),
  );
  const firstAvailable = (...candidates: Array<string | null | undefined>) =>
    candidates.find(candidate => candidate && (!availableIds.size || availableIds.has(candidate))) ||
    candidates.find(Boolean) ||
    selectedModel ||
    null;

  if (tier === 'TRIVIAL') {
    return firstAvailable(configured.budgetModel, DEFAULT_BUDGET_MODEL, selectedModel);
  }
  if (tier === 'STANDARD') {
    return firstAvailable(configured.standardModel, selectedModel, configured.budgetModel);
  }
  if (tier === 'COMPLEX') {
    return firstAvailable(configured.complexModel, selectedModel, configured.standardModel);
  }
  return firstAvailable(configured.criticalModel, configured.complexModel, selectedModel);
};

export const recommendModelForTurn = (
  input: ModelRoutingRecommendationInput,
): ModelRoutingRecommendation => {
  const policy = resolveTokenManagementPolicy(input.capability);
  const strategyMode = policy.strategyModes['model-adaptive-routing'];
  const tier = classifyModelComplexity(input);
  const recommendedModel = chooseModelForTier(
    tier,
    policy,
    input.selectedModel,
    input.availableModels,
  );
  const recommendedProviderKey =
    policy.modelAdaptive?.providerKey || input.selectedProviderKey || null;
  const canApply =
    policy.modelAdaptive?.enabled !== false && strategyMode === 'automatic';
  const disabled = strategyMode === 'disabled' || policy.modelAdaptive?.enabled === false;
  const applied = canApply && !disabled;
  const selectedModel = input.selectedModel || recommendedModel || null;
  const selectedProviderKey = input.selectedProviderKey || recommendedProviderKey || null;
  const routingReason = disabled
    ? 'Model-adaptive routing is disabled; preserving the existing provider/model selection.'
    : applied
      ? `${tier} turn routed automatically using the Token Intelligence policy.`
      : `${tier} turn recommendation recorded in advisory mode; existing provider/model selection is preserved.`;

  return {
    complexityTier: tier,
    recommendedProviderKey,
    recommendedModel,
    selectedProviderKey,
    selectedModel,
    appliedProviderKey: applied ? recommendedProviderKey : selectedProviderKey,
    appliedModel: applied ? recommendedModel : selectedModel,
    applied,
    strategyMode,
    tokenPolicyMode: policy.mode,
    routingReason,
    budgetScope: input.budgetScope,
    budgetRemainingTokens: input.budgetRemainingTokens ?? null,
    budgetRemainingUsd: input.budgetRemainingUsd ?? null,
  };
};

const parseUsageNumber = (
  usage: Record<string, unknown> | null | undefined,
  camelKey: string,
  snakeKey: string,
) => {
  if (!usage) return 0;
  return Number(usage[camelKey] ?? usage[snakeKey] ?? 0) || 0;
};

const capabilityUsageFromWorkspace = (
  capability: Capability,
  workspace?: CapabilityWorkspace,
  receipts: PromptReceiptRecord[] = [],
): TokenUsageBreakdown => {
  const agentUsage = (workspace?.agents || []).reduce(
    (acc, agent) => {
      acc.promptTokens += Number(agent.usage?.promptTokens || 0);
      acc.completionTokens += Number(agent.usage?.completionTokens || 0);
      acc.totalTokens += Number(agent.usage?.totalTokens || 0);
      acc.estimatedCostUsd += Number(agent.usage?.estimatedCostUsd || 0);
      return acc;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
  );

  const receiptUsage = receipts.reduce(
    (acc, receipt) => {
      const usage = receipt.responseUsage || {};
      const prompt = parseUsageNumber(usage, 'promptTokens', 'prompt_tokens') || receipt.totalEstimatedTokens;
      const completion = parseUsageNumber(usage, 'completionTokens', 'completion_tokens');
      const total = parseUsageNumber(usage, 'totalTokens', 'total_tokens') || prompt + completion;
      acc.promptTokens += prompt;
      acc.completionTokens += completion;
      acc.totalTokens += total;
      acc.estimatedCostUsd += Number(usage.estimatedCostUsd || estimateCostUsd(total, receipt.model));
      return acc;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
  );

  const source = agentUsage.totalTokens > 0 ? agentUsage : receiptUsage;
  return {
    scope: 'CAPABILITY',
    scopeId: capability.id,
    label: capability.name,
    estimatedInputTokens: source.promptTokens,
    actualInputTokens: source.promptTokens,
    completionTokens: source.completionTokens,
    totalTokens: source.totalTokens,
    estimatedCostUsd: Number(source.estimatedCostUsd.toFixed(4)),
    usageEstimated: agentUsage.totalTokens === 0,
  };
};

const buildRecommendations = ({
  capability,
  usage,
  receipts,
}: {
  capability: Capability;
  usage: TokenUsageBreakdown;
  receipts: PromptReceiptRecord[];
}): TokenManagementRecommendation[] => {
  const policy = resolveTokenManagementPolicy(capability);
  const recommendations: TokenManagementRecommendation[] = [];
  const add = (
    strategyKey: TokenSavingStrategyKey,
    title: string,
    description: string,
    estimatedSavingsRatio: number,
    source: TokenManagementRecommendation['source'],
    severity: TokenManagementRecommendation['severity'] = 'OPPORTUNITY',
  ) => {
    const mode = policy.strategyModes[strategyKey];
    if (mode === 'disabled') return;
    recommendations.push({
      id: `${capability.id}:${strategyKey}:${source}`.replace(/[^A-Z0-9:_-]/gi, '-'),
      capabilityId: capability.id,
      strategyKey,
      title,
      description,
      mode,
      estimatedSavingsTokens: Math.round(usage.totalTokens * estimatedSavingsRatio),
      estimatedSavingsUsd: Number((usage.estimatedCostUsd * estimatedSavingsRatio).toFixed(4)),
      severity,
      source,
    });
  };

  if (usage.totalTokens > 5_000) {
    add(
      'model-adaptive-routing',
      'Route easy turns to budget models',
      'Low-complexity read and search turns can use a cheaper model while preserving current behavior in advisory mode.',
      0.18,
      'MODEL_ROUTING',
    );
  }
  if (receipts.some(receipt => receipt.totalEstimatedTokens > 8_000)) {
    add(
      'context-budgeting',
      'Cap oversized prompt assemblies',
      'Several prompt receipts are large enough that deterministic eviction or condensation can save tokens.',
      0.12,
      'PROMPT_RECEIPT',
    );
  }
  if (receipts.some(receipt => receipt.fragments.some(fragment => /RAW_TAIL_TURNS|CONVERSATION_HISTORY/i.test(fragment.source)))) {
    add(
      'history-rollup',
      'Roll up repeated history',
      'Recent receipts include raw conversation or tool-loop history that can be summarized after the bounded tail.',
      0.1,
      'PROMPT_RECEIPT',
    );
  }
  if (receipts.some(receipt => receipt.memoryPrompt && estimateTokens(receipt.memoryPrompt) > 1_800)) {
    add(
      'memory-budgeting',
      'Budget memory prompt retrieval',
      'Memory context is large enough to benefit from chunk caps and source prioritization.',
      0.08,
      'PROMPT_RECEIPT',
    );
  }
  if (policy.strategyModes['receipt-auditing'] === 'advisory') {
    add(
      'receipt-auditing',
      'Keep receipts automatic',
      'Automatic receipts make routing, evictions, and savings decisions inspectable after the fact.',
      0,
      'POLICY',
      'INFO',
    );
  }

  return recommendations;
};

const buildModelRoutingPreview = (
  capability: Capability,
): ModelRoutingRecommendation[] =>
  (['TRIVIAL', 'STANDARD', 'COMPLEX', 'CRITICAL'] as ModelComplexityTier[]).map(tier =>
    recommendModelForTurn({
      capability,
      selectedProviderKey: null,
      selectedModel: capability.executionConfig?.tokenManagement?.modelAdaptive?.standardModel || null,
      complexityTier: tier,
      intent: `${tier.toLowerCase()} preview`,
    }),
  );

const listPromptReceipts = async ({
  capabilityIds,
  capabilityId,
  limit = 50,
}: {
  capabilityIds?: string[];
  capabilityId?: string;
  limit?: number;
} = {}): Promise<PromptReceiptRecord[]> => {
  const boundedLimit = Math.max(1, Math.min(250, Number(limit || 50)));
  const ids = capabilityId ? [capabilityId] : capabilityIds || [];
  if (ids.length > 0) {
    const result = await query<Record<string, unknown>>(
      `SELECT * FROM run_step_prompt_receipts
       WHERE capability_id = ANY($1::text[])
       ORDER BY created_at DESC
       LIMIT $2`,
      [ids, boundedLimit],
    );
    return result.rows.map(mapPromptReceiptRow);
  }

  const result = await query<Record<string, unknown>>(
    `SELECT * FROM run_step_prompt_receipts
     ORDER BY created_at DESC
     LIMIT $1`,
    [boundedLimit],
  );
  return result.rows.map(mapPromptReceiptRow);
};

const toPersistedReceipt = (receipt: PromptReceiptRecord): PersistedPromptReceipt =>
  receipt as unknown as PersistedPromptReceipt;

export const buildTokenManagementCapabilitySnapshot = async (
  capabilityId: string,
): Promise<TokenManagementCapabilitySnapshot> => {
  const bundle = await getCapabilityBundle(capabilityId);
  const receipts = await listPromptReceipts({ capabilityId, limit: 25 });
  const policy = resolveTokenManagementPolicy(bundle.capability);
  const usage = capabilityUsageFromWorkspace(bundle.capability, bundle.workspace, receipts);
  const recommendations = buildRecommendations({
    capability: bundle.capability,
    usage,
    receipts,
  });

  return {
    capabilityId: bundle.capability.id,
    capabilityName: bundle.capability.name,
    policy,
    effectiveStrategyModes: policy.strategyModes,
    usage,
    budgets: policy.budgets,
    recommendations,
    recentReceipts: receipts.map(toPersistedReceipt),
    modelRoutingPreview: buildModelRoutingPreview(bundle.capability),
  };
};

export const buildTokenManagementSummary = async (
  capabilityIds?: string[],
): Promise<TokenManagementSummary> => {
  const state = await fetchAppState();
  const allowedCapabilities = capabilityIds?.length
    ? state.capabilities.filter(capability => capabilityIds.includes(capability.id))
    : state.capabilities;
  const recentReceipts = await listPromptReceipts({
    capabilityIds: allowedCapabilities.map(capability => capability.id),
    limit: 50,
  });
  const snapshots = allowedCapabilities.map(capability => {
    const workspace = state.capabilityWorkspaces.find(item => item.capabilityId === capability.id);
    const capabilityReceipts = recentReceipts.filter(receipt => receipt.capabilityId === capability.id);
    const policy = resolveTokenManagementPolicy(capability);
    const usage = capabilityUsageFromWorkspace(capability, workspace, capabilityReceipts);
    const recommendations = buildRecommendations({
      capability,
      usage,
      receipts: capabilityReceipts,
    });
    return {
      capabilityId: capability.id,
      capabilityName: capability.name,
      policy,
      effectiveStrategyModes: policy.strategyModes,
      usage,
      budgets: policy.budgets,
      recommendations,
      recentReceipts: capabilityReceipts.slice(0, 10).map(toPersistedReceipt),
      modelRoutingPreview: buildModelRoutingPreview(capability),
    };
  });

  const totalTokens = snapshots.reduce((sum, snapshot) => sum + snapshot.usage.totalTokens, 0);
  const estimatedCostUsd = Number(
    snapshots.reduce((sum, snapshot) => sum + snapshot.usage.estimatedCostUsd, 0).toFixed(4),
  );
  const recommendations = snapshots.flatMap(snapshot => snapshot.recommendations);

  return {
    generatedAt: new Date().toISOString(),
    totalTokens,
    estimatedCostUsd,
    estimatedSavingsTokens: recommendations.reduce(
      (sum, item) => sum + item.estimatedSavingsTokens,
      0,
    ),
    estimatedSavingsUsd: Number(
      recommendations.reduce((sum, item) => sum + item.estimatedSavingsUsd, 0).toFixed(4),
    ),
    capabilityCount: snapshots.length,
    receiptCount: recentReceipts.length,
    topUsage: snapshots
      .map(snapshot => snapshot.usage)
      .sort((left, right) => right.totalTokens - left.totalTokens)
      .slice(0, 8),
    capabilities: snapshots,
    recommendations,
    recentReceipts: recentReceipts.map(toPersistedReceipt),
  };
};

export const listTokenOptimizationReceipts = async ({
  capabilityId,
  limit = 50,
}: {
  capabilityId?: string;
  limit?: number;
} = {}): Promise<TokenOptimizationReceipt[]> => {
  const state = await fetchAppState();
  const receipts = await listPromptReceipts({ capabilityId, limit });
  const capabilityById = new Map(state.capabilities.map(capability => [capability.id, capability]));

  return receipts.map(receipt => {
    const capability = capabilityById.get(receipt.capabilityId);
    const policy = capability
      ? resolveTokenManagementPolicy(capability)
      : null;
    const strategyModes =
      policy?.strategyModes ||
      TOKEN_SAVING_STRATEGIES.reduce(
        (acc, key) => {
          acc[key] = key === 'receipt-auditing' ? 'automatic' : 'advisory';
          return acc;
        },
        {} as Record<TokenSavingStrategyKey, TokenStrategyMode>,
      );
    const usage = receipt.responseUsage || {};
    const actualInputTokens =
      parseUsageNumber(usage, 'promptTokens', 'prompt_tokens') || null;
    const totalTokens =
      parseUsageNumber(usage, 'totalTokens', 'total_tokens') ||
      receipt.totalEstimatedTokens;
    const evictedTokens = receipt.evicted.reduce((sum, item) => sum + Number(item.tokens || 0), 0);

    return {
      id: receipt.id,
      capabilityId: receipt.capabilityId,
      workItemId: receipt.workItemId,
      agentId: receipt.agentId,
      source: 'PROMPT_RECEIPT',
      createdAt: receipt.createdAt,
      tokenPolicyMode: policy?.mode || 'advisor',
      strategyModes,
      enabledStrategies: getEnabledTokenStrategies(strategyModes),
      disabledStrategies: getDisabledTokenStrategies(strategyModes),
      complexityTier: usage.complexityTier as ModelComplexityTier | undefined,
      recommendedProviderKey: isProviderKey(usage.recommendedProviderKey)
        ? usage.recommendedProviderKey
        : null,
      recommendedModel:
        typeof usage.recommendedModel === 'string' ? usage.recommendedModel : null,
      selectedProviderKey: isProviderKey(receipt.providerKey)
        ? receipt.providerKey
        : null,
      selectedModel: receipt.model,
      routingReason:
        typeof usage.routingReason === 'string' ? usage.routingReason : null,
      estimatedInputTokens: receipt.totalEstimatedTokens,
      actualInputTokens,
      estimatedSavingsTokens: evictedTokens,
      estimatedSavingsUsd: estimateCostUsd(evictedTokens, receipt.model),
      budgetScope: (usage.budgetScope as TokenBudgetScope | undefined) || null,
      budgetRemainingTokens:
        typeof usage.budgetRemainingTokens === 'number'
          ? usage.budgetRemainingTokens
          : null,
      budgetRemainingUsd:
        typeof usage.budgetRemainingUsd === 'number'
          ? usage.budgetRemainingUsd
          : null,
    };
  });
};

export const listTokenManagementRecommendations = async (
  capabilityId?: string,
): Promise<TokenManagementRecommendation[]> => {
  if (capabilityId) {
    const snapshot = await buildTokenManagementCapabilitySnapshot(capabilityId);
    return snapshot.recommendations;
  }
  const summary = await buildTokenManagementSummary();
  return summary.recommendations;
};

export const estimatePromptForTokenManagement = ({
  capability,
  prompt,
  providerKey,
  model,
  kind = 'prose',
}: {
  capability?: Capability | null;
  prompt: string;
  providerKey?: ProviderKey | null;
  model?: string | null;
  kind?: TokenEstimateKind;
}): TokenPromptEstimateResponse => {
  const tokens = estimateTokens(prompt, {
    provider: normalizeProviderForEstimate(providerKey, model),
    model,
    kind,
  });
  const policy = capability
    ? resolveTokenManagementPolicy(capability)
    : ({
        mode: 'advisor',
        strategyModes: TOKEN_SAVING_STRATEGIES.reduce(
          (acc, key) => {
            acc[key] = key === 'receipt-auditing' ? 'automatic' : 'advisory';
            return acc;
          },
          {} as Record<TokenSavingStrategyKey, TokenStrategyMode>,
        ),
      } as ReturnType<typeof resolveTokenManagementPolicy>);
  const receipt: TokenOptimizationReceipt = {
    id: `EST-${Date.now().toString(36).toUpperCase()}`,
    capabilityId: capability?.id || 'workspace',
    source: 'ESTIMATE',
    createdAt: new Date().toISOString(),
    tokenPolicyMode: policy.mode,
    strategyModes: policy.strategyModes,
    enabledStrategies: getEnabledTokenStrategies(policy.strategyModes),
    disabledStrategies: getDisabledTokenStrategies(policy.strategyModes),
    estimatedInputTokens: tokens,
    actualInputTokens: null,
    estimatedSavingsTokens: 0,
    estimatedSavingsUsd: 0,
  };

  return {
    estimatedTokens: tokens,
    estimatedCostUsd: estimateCostUsd(tokens, model),
    providerKey: providerKey || null,
    model: model || null,
    kind,
    receipt,
  };
};
