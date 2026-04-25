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
import {
  DEFAULT_PROVIDER_KEY,
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

  let providerKey =
    requestedProviderKey ||
    explicitAgentProvider ||
    normalizedDefaultProvider;
  let source: ExecutionRuntimeSelectionSource = requestedProviderKey
    ? "step"
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

  const agentProviderKey = resolveAgentProviderKey(agent);
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
