import React, { useEffect, useMemo, useState } from "react";
import {
  BrainCircuit,
  Coins,
  Gauge,
  LoaderCircle,
  ReceiptText,
  RefreshCw,
  Route,
  Save,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from "../components/EnterpriseUI";
import { useCapability } from "../context/CapabilityContext";
import { useToast } from "../context/ToastContext";
import {
  fetchTokenManagementCapability,
  fetchTokenManagementSummary,
  updateTokenManagementPolicy,
} from "../lib/api";
import { cn } from "../lib/utils";
import type {
  TokenBudgetLimit,
  TokenManagementCapabilitySnapshot,
  TokenManagementPolicy,
  TokenManagementSummary,
  TokenSavingStrategyKey,
  TokenStrategyMode,
} from "../types";

const STRATEGY_LABELS: Record<TokenSavingStrategyKey, { label: string; helper: string }> = {
  "context-budgeting": {
    label: "Context Budgeting",
    helper: "Evict or compact lower-priority prompt fragments when a turn exceeds budget.",
  },
  "history-rollup": {
    label: "History Rollup",
    helper: "Summarize older chat and tool-loop turns while keeping a fresh tail.",
  },
  "semantic-code-hunks": {
    label: "Semantic Code Hunks",
    helper: "Prefer symbol-level and hunk reads over broad whole-file context.",
  },
  "ast-first-discovery": {
    label: "AST-First Discovery",
    helper: "Use local checkout AST and code index before falling back to text search.",
  },
  "memory-budgeting": {
    label: "Memory Budgeting",
    helper: "Cap retrieved learning and memory context by source value.",
  },
  "diff-first-editing": {
    label: "Diff-First Editing",
    helper: "Prefer targeted diffs and patches over restating full files.",
  },
  "model-adaptive-routing": {
    label: "Model Adaptive Routing",
    helper: "Recommend or apply cheaper models for low-complexity turns.",
  },
  "receipt-auditing": {
    label: "Receipt Auditing",
    helper: "Persist token, context, and routing decisions for audit and replay.",
  },
};

const STRATEGY_ORDER = Object.keys(STRATEGY_LABELS) as TokenSavingStrategyKey[];
const MODE_OPTIONS: Array<{ value: TokenStrategyMode; label: string }> = [
  { value: "disabled", label: "Off" },
  { value: "advisory", label: "Advise" },
  { value: "automatic", label: "Auto" },
];

const formatNumber = (value: number) => new Intl.NumberFormat().format(Math.round(value || 0));
const formatCurrency = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value || 0);

const defaultPolicy = (): TokenManagementPolicy => ({
  mode: "advisor",
  strictBudgetEnforcement: false,
  diagnosticsOff: false,
  budgets: [],
  strategyModes: {
    "context-budgeting": "advisory",
    "history-rollup": "advisory",
    "semantic-code-hunks": "advisory",
    "ast-first-discovery": "advisory",
    "memory-budgeting": "advisory",
    "diff-first-editing": "advisory",
    "model-adaptive-routing": "advisory",
    "receipt-auditing": "automatic",
  },
});

const getCapabilityBudget = (policy: TokenManagementPolicy): TokenBudgetLimit => {
  return (
    policy.budgets?.find(budget => budget.scope === "CAPABILITY") || {
      scope: "CAPABILITY",
    }
  );
};

export default function TokenIntelligence() {
  const { activeCapability } = useCapability();
  const toast = useToast();
  const [summary, setSummary] = useState<TokenManagementSummary | null>(null);
  const [detail, setDetail] = useState<TokenManagementCapabilitySnapshot | null>(null);
  const [draftPolicy, setDraftPolicy] = useState<TokenManagementPolicy>(defaultPolicy());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const nextSummary = await fetchTokenManagementSummary();
      setSummary(nextSummary);
      if (activeCapability) {
        const nextDetail = await fetchTokenManagementCapability(activeCapability.id);
        setDetail(nextDetail);
        setDraftPolicy({
          ...defaultPolicy(),
          ...nextDetail.policy,
          strategyModes: {
            ...defaultPolicy().strategyModes,
            ...nextDetail.effectiveStrategyModes,
          },
          budgets: nextDetail.budgets,
        });
      } else {
        setDetail(null);
        setDraftPolicy(defaultPolicy());
      }
    } catch (error) {
      toast.error("Token Intelligence could not load", error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [activeCapability?.id]);

  const capabilityBudget = useMemo(() => getCapabilityBudget(draftPolicy), [draftPolicy]);
  const hasConfiguredBudget = Boolean(
    (capabilityBudget.tokenBudget || 0) > 0 || (capabilityBudget.costBudgetUsd || 0) > 0,
  );
  const selectedSummaryCapability = summary?.capabilities.find(
    capability => capability.capabilityId === activeCapability?.id,
  );
  const currentDetail = detail || selectedSummaryCapability || null;

  const setStrategyMode = (strategy: TokenSavingStrategyKey, mode: TokenStrategyMode) => {
    if (strategy === "receipt-auditing" && mode === "disabled") {
      toast.warning("Receipt auditing stays on", "Use the advanced diagnostics-off control before disabling audit receipts.");
      return;
    }
    setDraftPolicy(current => ({
      ...current,
      strategyModes: {
        ...(current.strategyModes || {}),
        [strategy]: mode,
      },
    }));
  };

  const setCapabilityBudget = (patch: Partial<TokenBudgetLimit>) => {
    setDraftPolicy(current => {
      const existing = getCapabilityBudget(current);
      const nextBudget = {
        ...existing,
        ...patch,
        scope: "CAPABILITY" as const,
      };
      const remainingBudgets = (current.budgets || []).filter(
        budget => budget.scope !== "CAPABILITY",
      );
      const keepBudget =
        Number(nextBudget.tokenBudget || 0) > 0 ||
        Number(nextBudget.costBudgetUsd || 0) > 0;
      return {
        ...current,
        budgets: keepBudget ? [...remainingBudgets, nextBudget] : remainingBudgets,
      };
    });
  };

  const savePolicy = async () => {
    if (!activeCapability) return;
    if (draftPolicy.mode === "strict" && !hasConfiguredBudget) {
      toast.warning("Strict mode needs a budget", "Add a token or cost budget before enabling strict enforcement.");
      return;
    }
    setIsSaving(true);
    try {
      const saved = await updateTokenManagementPolicy(activeCapability.id, draftPolicy);
      setDetail(saved);
      setDraftPolicy({
        ...defaultPolicy(),
        ...saved.policy,
        strategyModes: {
          ...defaultPolicy().strategyModes,
          ...saved.effectiveStrategyModes,
        },
        budgets: saved.budgets,
      });
      setSummary(await fetchTokenManagementSummary());
      toast.success("Token policy saved", "The next runtime turn will use the updated strategy modes.");
    } catch (error) {
      toast.error("Token policy save failed", error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const resetPolicy = () => {
    setDraftPolicy(defaultPolicy());
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Token Intelligence"
        context={activeCapability?.name || "Workspace"}
        title="Token Intelligence"
        description="Advisor-first token policy, model routing recommendations, prompt receipts, budgets, and strategy controls."
        actions={
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" type="button" onClick={() => void load()} disabled={isLoading}>
              {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
            <button className="btn-primary" type="button" onClick={savePolicy} disabled={!activeCapability || isSaving}>
              {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Policy
            </button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total Tokens"
          value={formatNumber(summary?.totalTokens || 0)}
          helper={`${summary?.capabilityCount || 0} capabilities tracked`}
          icon={Gauge}
          tone="brand"
        />
        <StatTile
          label="Estimated Cost"
          value={formatCurrency(summary?.estimatedCostUsd || 0)}
          helper="Actual where provider usage is available"
          icon={Coins}
          tone="info"
        />
        <StatTile
          label="Savings Opportunity"
          value={formatNumber(summary?.estimatedSavingsTokens || 0)}
          helper={formatCurrency(summary?.estimatedSavingsUsd || 0)}
          icon={Zap}
          tone="success"
        />
        <StatTile
          label="Prompt Receipts"
          value={formatNumber(summary?.receiptCount || 0)}
          helper="Recent execution receipts indexed"
          icon={ReceiptText}
          tone="neutral"
        />
      </div>

      {!activeCapability ? (
        <EmptyState
          icon={BrainCircuit}
          title="Select a capability"
          description="Choose a capability to edit token policy. Workspace-wide usage and receipts remain visible below."
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.9fr]">
        <SectionCard
          title="Strategy Matrix"
          description="Each strategy can be Off, advisory-only, or automatic. Advisor mode records recommendations without silently changing runtime behavior."
          icon={SlidersHorizontal}
          action={
            <button className="btn-secondary" type="button" onClick={resetPolicy}>
              Reset Defaults
            </button>
          }
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-secondary">
                Module Mode
              </span>
              {(["advisor", "auto", "strict"] as const).map(mode => {
                const disabled = mode === "strict" && !hasConfiguredBudget;
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      setDraftPolicy(current => ({
                        ...current,
                        mode,
                        strictBudgetEnforcement: mode === "strict",
                      }))
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] transition",
                      draftPolicy.mode === mode
                        ? "border-primary bg-primary text-on-primary"
                        : "border-outline-variant/60 bg-white text-secondary hover:border-primary/40",
                      disabled && "cursor-not-allowed opacity-40",
                    )}
                  >
                    {mode}
                  </button>
                );
              })}
              {draftPolicy.mode === "strict" && !hasConfiguredBudget ? (
                <StatusBadge tone="warning">Budget Required</StatusBadge>
              ) : null}
            </div>

            <div className="grid gap-3">
              {STRATEGY_ORDER.map(strategy => {
                const mode = draftPolicy.strategyModes?.[strategy] || "advisory";
                const defaultMode =
                  strategy === "receipt-auditing" ? "automatic" : "advisory";
                return (
                  <div
                    key={strategy}
                    className="rounded-2xl border border-outline-variant/50 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-on-surface">
                            {STRATEGY_LABELS[strategy].label}
                          </h3>
                          <StatusBadge tone={mode === "automatic" ? "success" : mode === "disabled" ? "neutral" : "info"}>
                            {mode === defaultMode ? "Default" : "Override"}
                          </StatusBadge>
                        </div>
                        <p className="text-sm leading-relaxed text-secondary">
                          {STRATEGY_LABELS[strategy].helper}
                        </p>
                      </div>
                      <div className="inline-flex rounded-full border border-outline-variant/60 bg-surface-container-low p-1">
                        {MODE_OPTIONS.map(option => {
                          const disabled = strategy === "receipt-auditing" && option.value === "disabled";
                          return (
                            <button
                              key={option.value}
                              type="button"
                              disabled={disabled}
                              onClick={() => setStrategyMode(strategy, option.value)}
                              className={cn(
                                "rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] transition",
                                mode === option.value
                                  ? "bg-primary text-on-primary shadow-sm"
                                  : "text-secondary hover:bg-white",
                                disabled && "cursor-not-allowed opacity-40",
                              )}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard
            title="Budgets"
            description="Capability budget controls. Strict enforcement remains blocked until a budget exists."
            icon={Gauge}
          >
            <label className="block space-y-2">
              <span className="form-label">Capability Token Budget</span>
              <input
                className="input-field"
                type="number"
                min={0}
                value={capabilityBudget.tokenBudget || ""}
                onChange={event =>
                  setCapabilityBudget({
                    tokenBudget: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
                placeholder="No token budget"
              />
            </label>
            <label className="block space-y-2">
              <span className="form-label">Capability Cost Budget (USD)</span>
              <input
                className="input-field"
                type="number"
                min={0}
                step="0.01"
                value={capabilityBudget.costBudgetUsd || ""}
                onChange={event =>
                  setCapabilityBudget({
                    costBudgetUsd: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
                placeholder="No cost budget"
              />
            </label>
            <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4 text-sm text-secondary">
              {hasConfiguredBudget
                ? "Budget is configured. Strict mode can be enabled if you want enforcement."
                : "No budget is configured. Advisor and Auto modes remain available; Strict is held back."}
            </div>
          </SectionCard>

          <SectionCard
            title="Model Routing"
            description="Preview of complexity tiers and selected routing behavior."
            icon={Route}
          >
            <div className="space-y-3">
              {(currentDetail?.modelRoutingPreview || []).map(item => (
                <div
                  key={item.complexityTier}
                  className="rounded-2xl border border-outline-variant/50 bg-white p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge tone={item.applied ? "success" : "info"}>
                      {item.complexityTier}
                    </StatusBadge>
                    <span className="text-xs font-semibold text-secondary">
                      {item.strategyMode}
                    </span>
                  </div>
                  <p className="mt-3 font-semibold text-on-surface">
                    {item.recommendedModel || "Existing model"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-secondary">
                    {item.routingReason}
                  </p>
                </div>
              ))}
              {!currentDetail?.modelRoutingPreview?.length ? (
                <p className="text-sm text-secondary">No routing preview is available yet.</p>
              ) : null}
            </div>
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="Recommendations"
          description="Advisory savings opportunities disappear when the related strategy is disabled."
          icon={Zap}
        >
          <div className="space-y-3">
            {(currentDetail?.recommendations || summary?.recommendations || []).slice(0, 8).map(item => (
              <div
                key={item.id}
                className="rounded-2xl border border-outline-variant/50 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold text-on-surface">{item.title}</h3>
                  <StatusBadge tone={item.mode === "automatic" ? "success" : "info"}>
                    {item.mode}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  {item.description}
                </p>
                <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-primary">
                  {formatNumber(item.estimatedSavingsTokens)} tokens · {formatCurrency(item.estimatedSavingsUsd)}
                </p>
              </div>
            ))}
            {!(currentDetail?.recommendations || summary?.recommendations || []).length ? (
              <p className="text-sm text-secondary">No savings recommendations are active for the selected policy.</p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Receipts"
          description="Recent prompt receipts with token totals, selected model, provider, and context sizing."
          icon={ReceiptText}
        >
          <div className="space-y-3">
            {(currentDetail?.recentReceipts || summary?.recentReceipts || []).slice(0, 8).map(receipt => (
              <div
                key={receipt.id}
                className="rounded-2xl border border-outline-variant/50 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs text-secondary">{receipt.id}</p>
                    <h3 className="mt-1 font-bold text-on-surface">
                      {receipt.phase || receipt.scope}
                    </h3>
                  </div>
                  <StatusBadge tone="neutral">
                    {formatNumber(receipt.totalEstimatedTokens)} tokens
                  </StatusBadge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-secondary md:grid-cols-2">
                  <span>Model: {receipt.model || "Unknown"}</span>
                  <span>Provider: {receipt.providerKey || "Unknown"}</span>
                  <span>Included: {receipt.fragments.length}</span>
                  <span>Evicted: {receipt.evicted.length}</span>
                </div>
              </div>
            ))}
            {!(currentDetail?.recentReceipts || summary?.recentReceipts || []).length ? (
              <p className="text-sm text-secondary">No prompt receipts have been captured yet.</p>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
