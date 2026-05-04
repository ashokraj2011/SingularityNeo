import type {
  CapabilityAgent,
  ProviderKey,
  RuntimeTransportMode,
  WorkflowStep,
} from "../../src/types";
import {
  defaultModel,
  getConfiguredToken,
  getConfiguredTokenSource,
  normalizeModel,
} from "../githubModels";
import {
  getLocalOpenAIDefaultModel,
  isLocalOpenAIConfigured,
} from "../localOpenAIProvider";
import { getCustomRouterDefaultModel } from "../customRouterProvider";
import { getGeminiDefaultModel } from "../geminiProvider";
import {
  CUSTOM_ROUTER_PROVIDER_KEY,
  DEFAULT_PROVIDER_KEY,
  GEMINI_PROVIDER_KEY,
  LOCAL_OPENAI_PROVIDER_KEY,
  getConfiguredDefaultRuntimeProviderKey,
  hasExplicitAgentProvider,
  isCliRuntimeProviderKey,
  normalizeProviderKey,
  resolveAgentProviderKey,
  resolveProviderDisplayName,
} from "../providerRegistry";
import { resolveRuntimeAccessMode } from "../runtimePolicy";
import { getStoredCliProviderConfigSync } from "../runtimeProviders";

export type ExecutionRuntimeSelectionSource =
  | "step"
  | "agent"
  | "desktop-default"
  | "fallback-internal";

export type ExecutionRuntimeSelection = {
  providerKey: ProviderKey;
  model: string;
  transportMode: RuntimeTransportMode;
  source: ExecutionRuntimeSelectionSource;
  requestedProviderKey?: ProviderKey;
  externalRuntimeEligible: boolean;
  usageEstimated: boolean;
};

const CODE_WORK_PHASES = new Set([
  "DEVELOPMENT",
  "IMPLEMENTATION",
  "FIX",
  "REFACTOR",
  "CONSTRUCTION",
]);

const trim = (value?: string | null) => String(value || "").trim();

const isCodeExecutionStepType = (stepType?: string | null) =>
  stepType === "DELIVERY" || stepType === "BUILD" || stepType === "AGENT_TASK";

export const isCodeExecutionPhase = (phase?: string | null) =>
  CODE_WORK_PHASES.has(trim(phase).toUpperCase());

export const isExternalRuntimeEligibleStep = (
  step?: Pick<WorkflowStep, "phase" | "stepType"> | null,
) => {
  if (!step) {
    return false;
  }
  if (step.stepType === "BUILD") {
    return true;
  }
  return isCodeExecutionStepType(step.stepType) && isCodeExecutionPhase(step.phase);
};

const resolveInternalExecutionProvider = ({
  agent,
  defaultProviderKey,
  localOpenAIAvailable,
}: {
  agent?: Partial<CapabilityAgent> | null;
  defaultProviderKey: ProviderKey;
  localOpenAIAvailable: boolean;
}): ProviderKey => {
  const explicitAgentProvider = hasExplicitAgentProvider(agent)
    ? normalizeProviderKey(agent?.providerKey || agent?.provider)
    : null;
  if (explicitAgentProvider && !isCliRuntimeProviderKey(explicitAgentProvider)) {
    return explicitAgentProvider;
  }
  if (!isCliRuntimeProviderKey(defaultProviderKey)) {
    return defaultProviderKey;
  }
  if (localOpenAIAvailable) {
    return LOCAL_OPENAI_PROVIDER_KEY;
  }
  return DEFAULT_PROVIDER_KEY;
};

const resolveProviderModel = ({
  providerKey,
  agent,
  step,
  sameAsAgentProvider,
  resolveCliModel,
  localOpenAIModel,
  githubProviderModel,
}: {
  providerKey: ProviderKey;
  agent?: Partial<CapabilityAgent> | null;
  step?: Pick<WorkflowStep, "runtimeModel"> | null;
  sameAsAgentProvider: boolean;
  resolveCliModel: (providerKey: ProviderKey) => string;
  localOpenAIModel: string;
  githubProviderModel: string;
}) => {
  const stepModel = trim(step?.runtimeModel);
  if (stepModel) {
    return stepModel;
  }

  const agentModel = trim(agent?.model);
  if (agentModel && sameAsAgentProvider) {
    return agentModel;
  }

  if (providerKey === LOCAL_OPENAI_PROVIDER_KEY) {
    return trim(localOpenAIModel);
  }

  // The agent's saved model only applies when we're routing to the SAME
  // provider it was authored for. When we route to a different provider
  // (e.g. agent.model is 'gpt-4.1-mini' but the active default is now
  // OpenRouter), we must use that provider's configured default model —
  // not the GitHub-Copilot model name, which would 404 at the endpoint.
  if (providerKey === CUSTOM_ROUTER_PROVIDER_KEY) {
    return trim(getCustomRouterDefaultModel());
  }

  if (providerKey === GEMINI_PROVIDER_KEY) {
    return trim(getGeminiDefaultModel());
  }

  if (isCliRuntimeProviderKey(providerKey)) {
    return trim(resolveCliModel(providerKey));
  }

  return normalizeModel(
    (sameAsAgentProvider ? agentModel : "") || githubProviderModel || defaultModel,
  );
};

export const resolveExecutionRuntimeForStep = ({
  step,
  agent,
  hasGitHubCodeRepository = true,
  defaultProviderKey = getConfiguredDefaultRuntimeProviderKey(),
  localOpenAIAvailable = isLocalOpenAIConfigured(),
  localOpenAIModel = getLocalOpenAIDefaultModel(),
  githubProviderModel = defaultModel,
  resolveCliModel = (providerKey: ProviderKey) =>
    trim(getStoredCliProviderConfigSync(providerKey)?.model),
  resolveTransportMode = (providerKey: ProviderKey) =>
    resolveRuntimeAccessMode({
      providerKey,
      tokenSource: getConfiguredTokenSource(),
      token: getConfiguredToken(),
      modelCatalogFromRuntime: false,
    }),
}: {
  step: Pick<WorkflowStep, "phase" | "stepType" | "runtimeProviderKey" | "runtimeModel">;
  agent?: Partial<CapabilityAgent> | null;
  hasGitHubCodeRepository?: boolean;
  defaultProviderKey?: ProviderKey;
  localOpenAIAvailable?: boolean;
  localOpenAIModel?: string;
  githubProviderModel?: string;
  resolveCliModel?: (providerKey: ProviderKey) => string;
  resolveTransportMode?: (providerKey: ProviderKey) => RuntimeTransportMode;
}): ExecutionRuntimeSelection => {
  const explicitStepProvider = trim(step.runtimeProviderKey);
  const requestedProviderKey = explicitStepProvider
    ? normalizeProviderKey(explicitStepProvider)
    : undefined;
  const explicitAgentProvider = hasExplicitAgentProvider(agent)
    ? normalizeProviderKey(agent?.providerKey || agent?.provider)
    : undefined;
  const normalizedDefaultProvider = normalizeProviderKey(defaultProviderKey);
  const externalRuntimeEligible =
    isExternalRuntimeEligibleStep(step) && hasGitHubCodeRepository;

  // Precedence (operator-first):
  //
  //   step override  >  operator's configured default  >  agent's saved
  //   provider  >  hardcoded fallback
  //
  // The operator's choice in the desktop console must win over an
  // agent's saved `providerKey` so a runtime swap (e.g. GitHub Copilot →
  // local-openai) takes effect everywhere immediately, without each
  // agent record needing to be re-saved. Workflow-step authors can
  // still pin a specific provider via `step.runtimeProviderKey` when a
  // particular tier is genuinely required for that step.
  //
  // The agent's provider remains a fallback used only when the
  // operator hasn't configured a default at all.
  let providerKey =
    requestedProviderKey ||
    normalizedDefaultProvider ||
    explicitAgentProvider;
  let source: ExecutionRuntimeSelectionSource = requestedProviderKey
    ? "step"
    : normalizedDefaultProvider
      ? "desktop-default"
      : explicitAgentProvider
        ? "agent"
        : "desktop-default";

  if (isCliRuntimeProviderKey(providerKey) && !externalRuntimeEligible) {
    providerKey = resolveInternalExecutionProvider({
      agent,
      defaultProviderKey: normalizedDefaultProvider,
      localOpenAIAvailable,
    });
    source = "fallback-internal";
  }

  // Re-use the SAME default the caller passed in (or the live config
  // default) so a config change between this line and the agent resolver
  // can't flip `sameAsAgentProvider` from true to false mid-decision.
  const agentProviderKey = resolveAgentProviderKey(agent, normalizedDefaultProvider);
  const model = resolveProviderModel({
    providerKey,
    agent,
    step,
    sameAsAgentProvider: providerKey === agentProviderKey,
    resolveCliModel,
    localOpenAIModel,
    githubProviderModel,
  });

  return {
    providerKey,
    model,
    transportMode: resolveTransportMode(providerKey),
    source,
    requestedProviderKey,
    externalRuntimeEligible,
    usageEstimated: isCliRuntimeProviderKey(providerKey),
  };
};

export const buildExecutionRuntimeAgent = ({
  agent,
  selection,
}: {
  agent: CapabilityAgent;
  selection: ExecutionRuntimeSelection;
}): CapabilityAgent => {
  const currentProviderKey = resolveAgentProviderKey(agent);
  const providerChanged = currentProviderKey !== selection.providerKey;

  return {
    ...agent,
    providerKey: selection.providerKey,
    provider: resolveProviderDisplayName(selection.providerKey),
    model:
      selection.model ||
      (providerChanged && isCliRuntimeProviderKey(selection.providerKey)
        ? ""
        : agent.model),
  };
};
