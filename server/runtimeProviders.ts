import type {
  ProviderKey,
  RuntimeModelOption,
  RuntimeProviderConfig,
  RuntimeProviderStatus,
  RuntimeProviderValidationResult,
  RuntimeTransportMode,
} from '../src/types';
import {
  defaultModel,
  getConfiguredGitHubIdentity,
  getConfiguredToken,
  getConfiguredTokenSource,
  getRuntimeDefaultModel,
  githubModelsApiUrl,
  listAvailableRuntimeModels,
  normalizeModel,
} from './githubModels';
import {
  getLocalOpenAIBaseUrl,
  getLocalOpenAIDefaultModel,
  isLocalOpenAIConfigured,
  listLocalOpenAIModels,
} from './localOpenAIProvider';
import {
  AIDER_CLI_PROVIDER_KEY,
  CLAUDE_CODE_CLI_PROVIDER_KEY,
  CODEX_CLI_PROVIDER_KEY,
  DEFAULT_PROVIDER_KEY,
  LOCAL_OPENAI_PROVIDER_KEY,
  getConfiguredDefaultRuntimeProviderKey,
  isCliRuntimeProviderKey,
  normalizeProviderKey,
  resolveProviderDisplayName,
} from './providerRegistry';
import { resolveRuntimeAccessMode } from './runtimePolicy';
import {
  getStoredRuntimeProviderConfig,
  getStoredRuntimeProviderConfigSync,
  saveRuntimeProviderConfig,
  setDefaultRuntimeProviderKey,
} from './runtimeProviderConfig';
import { listCliProviderModels, validateCliRuntimeProvider } from './runtimeCli';

type RuntimeProviderDefinition = {
  key: ProviderKey;
  label: string;
  transportMode: RuntimeTransportMode;
  supportsSessions: boolean;
  supportsTools: boolean;
  supportsWorkspaceAutonomy: boolean;
};

const runtimeProviderDefinitions: RuntimeProviderDefinition[] = [
  {
    key: DEFAULT_PROVIDER_KEY,
    label: resolveProviderDisplayName(DEFAULT_PROVIDER_KEY),
    transportMode: 'sdk-session',
    supportsSessions: true,
    supportsTools: true,
    supportsWorkspaceAutonomy: false,
  },
  {
    key: LOCAL_OPENAI_PROVIDER_KEY,
    label: resolveProviderDisplayName(LOCAL_OPENAI_PROVIDER_KEY),
    transportMode: 'local-openai',
    supportsSessions: true,
    supportsTools: true,
    supportsWorkspaceAutonomy: false,
  },
  {
    key: CLAUDE_CODE_CLI_PROVIDER_KEY,
    label: resolveProviderDisplayName(CLAUDE_CODE_CLI_PROVIDER_KEY),
    transportMode: 'desktop-cli',
    supportsSessions: false,
    supportsTools: false,
    supportsWorkspaceAutonomy: false,
  },
  {
    key: CODEX_CLI_PROVIDER_KEY,
    label: resolveProviderDisplayName(CODEX_CLI_PROVIDER_KEY),
    transportMode: 'desktop-cli',
    supportsSessions: false,
    supportsTools: false,
    supportsWorkspaceAutonomy: false,
  },
  {
    key: AIDER_CLI_PROVIDER_KEY,
    label: resolveProviderDisplayName(AIDER_CLI_PROVIDER_KEY),
    transportMode: 'desktop-cli',
    supportsSessions: false,
    supportsTools: false,
    supportsWorkspaceAutonomy: false,
  },
];

const getRuntimeProviderDefinition = (providerKey: ProviderKey) =>
  runtimeProviderDefinitions.find(definition => definition.key === providerKey) ||
  runtimeProviderDefinitions[0];

const filterGitHubRuntimeModels = (models: RuntimeModelOption[]) =>
  models.filter(model => model.profile !== 'Local OpenAI-compatible model');

const buildConfiguredStatus = ({
  providerKey,
  transportMode,
  configured,
  endpoint,
  command,
  model,
  availableModels,
  validation,
  config,
}: {
  providerKey: ProviderKey;
  transportMode: RuntimeTransportMode;
  configured: boolean;
  endpoint?: string | null;
  command?: string | null;
  model?: string | null;
  availableModels?: RuntimeModelOption[];
  validation?: RuntimeProviderValidationResult | null;
  config?: RuntimeProviderConfig | null;
}): RuntimeProviderStatus => {
  const definition = getRuntimeProviderDefinition(providerKey);
  return {
    key: providerKey,
    label: definition.label,
    transportMode,
    configured,
    endpoint: endpoint || null,
    command: command || null,
    model: model || null,
    supportsSessions: definition.supportsSessions,
    supportsTools: definition.supportsTools,
    supportsWorkspaceAutonomy: definition.supportsWorkspaceAutonomy,
    availableModels: availableModels || [],
    validation: validation || null,
    config: config || null,
  };
};

const listGitHubProviderModels = async () => {
  const { models, fromRuntime } = await listAvailableRuntimeModels().catch(() => ({
    models: [] as RuntimeModelOption[],
    fromRuntime: false,
  }));
  return {
    models: filterGitHubRuntimeModels(models),
    fromRuntime,
  };
};

const getGitHubProviderStatus = async (): Promise<RuntimeProviderStatus> => {
  const token = getConfiguredToken();
  const tokenSource = getConfiguredTokenSource();
  const hasToken = Boolean(token);
  const identityResult =
    hasToken && tokenSource !== 'headless-cli'
      ? await getConfiguredGitHubIdentity().catch(() => ({ identity: null, error: null }))
      : { identity: null, error: null };
  const { models, fromRuntime } =
    hasToken || tokenSource === 'headless-cli'
      ? await listGitHubProviderModels()
      : { models: [] as RuntimeModelOption[], fromRuntime: false };
  const runtimeAccessMode = resolveRuntimeAccessMode({
    providerKey: DEFAULT_PROVIDER_KEY,
    tokenSource,
    token,
    modelCatalogFromRuntime: fromRuntime,
  });

  return buildConfiguredStatus({
    providerKey: DEFAULT_PROVIDER_KEY,
    transportMode: runtimeAccessMode,
    configured: tokenSource === 'headless-cli' || hasToken,
    endpoint:
      tokenSource === 'headless-cli'
        ? process.env.COPILOT_CLI_URL || githubModelsApiUrl
        : githubModelsApiUrl,
    model:
      tokenSource === 'headless-cli' || hasToken
        ? await getRuntimeDefaultModel().catch(() => normalizeModel(defaultModel))
        : normalizeModel(defaultModel),
    availableModels: models,
    validation:
      tokenSource === 'headless-cli' || hasToken
        ? {
            providerKey: DEFAULT_PROVIDER_KEY,
            ok: true,
            status: 'configured',
            message:
              tokenSource === 'headless-cli'
                ? 'Configured through the GitHub Copilot SDK session endpoint.'
                : identityResult.identity?.login
                ? `Validated as @${identityResult.identity.login}.`
                : identityResult.error || 'GitHub Models token is configured.',
            transportMode: runtimeAccessMode,
            installed: true,
            authenticated:
              tokenSource === 'headless-cli' ? null : Boolean(identityResult.identity),
            workingDirectoryAllowed: null,
            usageEstimated: false,
            models,
            checkedAt: new Date().toISOString(),
          }
        : {
            providerKey: DEFAULT_PROVIDER_KEY,
            ok: false,
            status: 'missing',
            message: 'Configure COPILOT_CLI_URL or GITHUB_MODELS_TOKEN to use this provider.',
            transportMode: runtimeAccessMode,
            installed: false,
            authenticated: null,
            workingDirectoryAllowed: null,
            usageEstimated: false,
            checkedAt: new Date().toISOString(),
          },
  });
};

const getLocalOpenAIProviderStatus = async (): Promise<RuntimeProviderStatus> => {
  const configured = isLocalOpenAIConfigured();
  const models = configured ? await listLocalOpenAIModels().catch(() => []) : [];
  return buildConfiguredStatus({
    providerKey: LOCAL_OPENAI_PROVIDER_KEY,
    transportMode: 'local-openai',
    configured,
    endpoint: getLocalOpenAIBaseUrl() || null,
    model: configured ? getLocalOpenAIDefaultModel() : null,
    availableModels: models,
    validation: {
      providerKey: LOCAL_OPENAI_PROVIDER_KEY,
      ok: configured,
      status: configured ? 'configured' : 'missing',
      message: configured
        ? 'Local OpenAI-compatible runtime is configured.'
        : 'Set LOCAL_OPENAI_BASE_URL to enable this provider.',
      transportMode: 'local-openai',
      installed: configured,
      authenticated: null,
      workingDirectoryAllowed: null,
      usageEstimated: false,
      models,
      checkedAt: new Date().toISOString(),
    },
  });
};

const getCliProviderStatus = async (providerKey: ProviderKey): Promise<RuntimeProviderStatus> => {
  const config = (await getStoredRuntimeProviderConfig({ providerKey })) || null;
  const validation = await validateCliRuntimeProvider({
    providerKey,
    config,
  });
  const models = await listCliProviderModels({ providerKey, config });

  return buildConfiguredStatus({
    providerKey,
    transportMode: 'desktop-cli',
    configured: validation.ok && config?.enabled !== false,
    command: config?.command || null,
    model: config?.model || null,
    availableModels: models,
    validation,
    config,
  });
};

export const listRuntimeProviderDefinitions = () => [...runtimeProviderDefinitions];

export const getConfiguredRuntimeProviderStatus = async (
  providerKey: ProviderKey,
): Promise<RuntimeProviderStatus> => {
  if (providerKey === DEFAULT_PROVIDER_KEY) {
    return getGitHubProviderStatus();
  }
  if (providerKey === LOCAL_OPENAI_PROVIDER_KEY) {
    return getLocalOpenAIProviderStatus();
  }
  if (isCliRuntimeProviderKey(providerKey)) {
    return getCliProviderStatus(providerKey);
  }

  return buildConfiguredStatus({
    providerKey,
    transportMode: 'unconfigured',
    configured: false,
    validation: {
      providerKey,
      ok: false,
      status: 'unavailable',
      message: `${providerKey} is not supported in this environment yet.`,
      transportMode: 'unconfigured',
      installed: false,
      authenticated: null,
      workingDirectoryAllowed: null,
      checkedAt: new Date().toISOString(),
    },
  });
};

export const listRuntimeProviderStatuses = async (): Promise<RuntimeProviderStatus[]> => {
  const defaultProviderKey = normalizeProviderKey(getConfiguredDefaultRuntimeProviderKey());
  const statuses = await Promise.all(
    runtimeProviderDefinitions.map(definition =>
      getConfiguredRuntimeProviderStatus(definition.key),
    ),
  );
  return statuses.map(status => ({
    ...status,
    defaultSelected: status.key === defaultProviderKey,
  }));
};

export const getRuntimeProviderModels = async (
  providerKey: ProviderKey,
): Promise<RuntimeModelOption[]> => {
  const status = await getConfiguredRuntimeProviderStatus(providerKey);
  return status.availableModels || [];
};

export const validateRuntimeProviderStatus = async ({
  providerKey,
  config,
}: {
  providerKey: ProviderKey;
  config?: RuntimeProviderConfig | null;
}): Promise<RuntimeProviderValidationResult> => {
  if (providerKey === DEFAULT_PROVIDER_KEY) {
    return (await getConfiguredRuntimeProviderStatus(providerKey)).validation || {
      providerKey,
      ok: false,
      status: 'missing',
      message: 'GitHub Copilot runtime is not configured.',
      transportMode: 'unconfigured',
    };
  }

  if (providerKey === LOCAL_OPENAI_PROVIDER_KEY) {
    return (await getConfiguredRuntimeProviderStatus(providerKey)).validation || {
      providerKey,
      ok: false,
      status: 'missing',
      message: 'Local OpenAI-compatible runtime is not configured.',
      transportMode: 'unconfigured',
    };
  }

  if (isCliRuntimeProviderKey(providerKey)) {
    return validateCliRuntimeProvider({
      providerKey,
      config: config || (await getStoredRuntimeProviderConfig({ providerKey })) || null,
    });
  }

  return {
    providerKey,
    ok: false,
    status: 'unavailable',
    message: `${providerKey} is not available.`,
    transportMode: 'unconfigured',
    checkedAt: new Date().toISOString(),
  };
};

export const saveConfiguredRuntimeProvider = async ({
  providerKey,
  config,
  setDefault,
}: {
  providerKey: ProviderKey;
  config: RuntimeProviderConfig;
  setDefault?: boolean;
}) => {
  await saveRuntimeProviderConfig({
    providerKey,
    config,
    setDefault,
  });
  return getConfiguredRuntimeProviderStatus(providerKey);
};

export const selectDefaultRuntimeProvider = async ({
  providerKey,
}: {
  providerKey?: ProviderKey;
}) => {
  await setDefaultRuntimeProviderKey({ providerKey });
  return listRuntimeProviderStatuses();
};

export const resolveSelectedRuntimeProvider = async () => {
  const statuses = await listRuntimeProviderStatuses();
  const configuredDefault = normalizeProviderKey(getConfiguredDefaultRuntimeProviderKey());
  const preferred =
    statuses.find(status => status.key === configuredDefault && status.configured) ||
    statuses.find(status => status.defaultSelected && status.configured) ||
    statuses.find(status => status.configured) ||
    statuses.find(status => status.key === configuredDefault) ||
    statuses[0];

  return preferred;
};

export const getStoredCliProviderConfigSync = (providerKey: ProviderKey) =>
  isCliRuntimeProviderKey(providerKey)
    ? getStoredRuntimeProviderConfigSync({ providerKey }) || null
    : null;
