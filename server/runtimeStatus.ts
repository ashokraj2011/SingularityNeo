import { getPlatformFeatureState } from './db';
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
import { isDesktopExecutionRuntime } from './executionOwnership';
import {
  getLocalOpenAIBaseUrl,
  getLocalOpenAIDefaultModel,
  isLocalOpenAIConfigured,
} from './localOpenAIProvider';
import {
  DEFAULT_EMBEDDING_PROVIDER_KEY,
  DEFAULT_PROVIDER_KEY,
  LOCAL_OPENAI_PROVIDER_KEY,
  resolveProviderDisplayName,
} from './providerRegistry';
import { resolveRuntimeAccessMode } from './runtimePolicy';

export const buildRuntimeStatus = async () => {
  const token = getConfiguredToken();
  const tokenSource = getConfiguredTokenSource();
  const headlessCli = tokenSource === 'headless-cli';
  const localProviderConfigured = isLocalOpenAIConfigured();
  const providerKey =
    !headlessCli && !token && localProviderConfigured
      ? LOCAL_OPENAI_PROVIDER_KEY
      : DEFAULT_PROVIDER_KEY;
  const configured = headlessCli || Boolean(token) || localProviderConfigured;
  const platformFeatures = getPlatformFeatureState();
  const { models, fromRuntime } = await listAvailableRuntimeModels();
  const runtimeDefaultModel =
    providerKey === LOCAL_OPENAI_PROVIDER_KEY
      ? normalizeModel(getLocalOpenAIDefaultModel())
      : configured
      ? await getRuntimeDefaultModel()
      : normalizeModel(defaultModel);
  const identityResult =
    configured && providerKey === DEFAULT_PROVIDER_KEY
    ? await getConfiguredGitHubIdentity()
    : { identity: null, error: null };

  return {
    configured,
    provider: resolveProviderDisplayName(providerKey),
    providerKey,
    embeddingProviderKey: localProviderConfigured
      ? DEFAULT_EMBEDDING_PROVIDER_KEY
      : 'deterministic-hash',
    embeddingConfigured: localProviderConfigured,
    availableProviders: [
      {
        key: DEFAULT_PROVIDER_KEY,
        label: resolveProviderDisplayName(DEFAULT_PROVIDER_KEY),
        configured: headlessCli || Boolean(token),
      },
      {
        key: LOCAL_OPENAI_PROVIDER_KEY,
        label: resolveProviderDisplayName(LOCAL_OPENAI_PROVIDER_KEY),
        configured: localProviderConfigured,
      },
    ],
    runtimeOwner: 'SERVER',
    executionRuntimeOwner: isDesktopExecutionRuntime() ? 'DESKTOP' : 'SERVER',
    endpoint:
      providerKey === LOCAL_OPENAI_PROVIDER_KEY
        ? getLocalOpenAIBaseUrl() || 'Unknown'
        : headlessCli
        ? process.env.COPILOT_CLI_URL || githubModelsApiUrl
        : githubModelsApiUrl,
    tokenSource,
    defaultModel: runtimeDefaultModel,
    modelCatalogSource: fromRuntime ? 'runtime' : 'fallback',
    runtimeAccessMode: resolveRuntimeAccessMode({
      tokenSource,
      token,
      modelCatalogFromRuntime: fromRuntime,
    }),
    httpFallbackEnabled: process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK === 'true',
    lastRuntimeError: identityResult.error,
    availableModels: models,
    streaming: true,
    platformFeatures,
    githubIdentity: identityResult.identity,
    githubIdentityError: identityResult.error,
  };
};
