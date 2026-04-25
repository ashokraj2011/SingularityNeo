import { getDatabaseRuntimeInfo, getPlatformFeatureState } from './db';
import {
  decodeWorkspaceDatabaseBootstrapProfileSnapshot,
  resolveActiveWorkspaceDatabaseBootstrapProfileId,
} from './databaseProfiles';
import {
  defaultModel,
  getConfiguredGitHubIdentity,
  getConfiguredToken,
  getConfiguredTokenSource,
  githubModelsApiUrl,
  normalizeModel,
} from './githubModels';
import { isDesktopExecutionRuntime } from './executionOwnership';
import {
  getLocalOpenAIBaseUrl,
  getLocalOpenAIDefaultModel,
  getLocalOpenAIEmbeddingModel,
  isLocalOpenAIConfigured,
} from './localOpenAIProvider';
import {
  DEFAULT_EMBEDDING_PROVIDER_KEY,
  DEFAULT_PROVIDER_KEY,
  LOCAL_OPENAI_PROVIDER_KEY,
} from './providerRegistry';
import { buildRuntimePreflight } from './runtimePreflight';
import { resolveRuntimeAccessMode } from './runtimePolicy';
import {
  listRuntimeProviderStatuses,
  resolveSelectedRuntimeProvider,
} from './runtimeProviders';

export const buildRuntimeStatus = async () => {
  const databaseRuntime = getDatabaseRuntimeInfo();
  const databaseProfileSnapshot = decodeWorkspaceDatabaseBootstrapProfileSnapshot({
    encodedProfiles: process.env.WORKSPACE_DB_PROFILES_B64,
    activeProfileId: process.env.WORKSPACE_ACTIVE_DB_PROFILE_ID,
  });
  const activeDatabaseProfileId =
    resolveActiveWorkspaceDatabaseBootstrapProfileId(
      databaseProfileSnapshot,
      databaseRuntime,
    ) || null;
  const activeDatabaseProfile =
    databaseProfileSnapshot.profiles.find(profile => profile.id === activeDatabaseProfileId) || null;
  const token = getConfiguredToken();
  const tokenSource = getConfiguredTokenSource();
  const localProviderConfigured = isLocalOpenAIConfigured();
  const availableProviders = await listRuntimeProviderStatuses();
  const selectedProvider = await resolveSelectedRuntimeProvider();
  const providerKey = selectedProvider?.key || DEFAULT_PROVIDER_KEY;
  const configured = Boolean(selectedProvider?.configured);
  const platformFeatures = getPlatformFeatureState();
  const models = selectedProvider?.availableModels || [];
  const fromRuntime =
    selectedProvider?.transportMode === 'sdk-session' ||
    selectedProvider?.transportMode === 'http-api' ||
    selectedProvider?.transportMode === 'local-openai';
  const runtimeDefaultModel =
    selectedProvider?.model ||
    (providerKey === LOCAL_OPENAI_PROVIDER_KEY
      ? normalizeModel(getLocalOpenAIDefaultModel())
      : normalizeModel(defaultModel));
  const identityResult =
    configured && providerKey === DEFAULT_PROVIDER_KEY
    ? await getConfiguredGitHubIdentity()
    : { identity: null, error: null };
  const runtimeAccessMode = resolveRuntimeAccessMode({
    providerKey,
    tokenSource,
    token,
    modelCatalogFromRuntime: fromRuntime,
  });
  const preflight = await buildRuntimePreflight({
    runtimeConfigured: configured,
    runtimeProvider: selectedProvider?.label || 'Runtime provider',
    runtimeAccessMode,
    tokenSource,
  });

  return {
    configured,
    provider: selectedProvider?.label || 'Runtime provider',
    providerKey,
    readinessState: preflight.readinessState,
    checks: preflight.checks,
    controlPlaneUrl: preflight.controlPlaneUrl,
    embeddingProviderKey: localProviderConfigured
      ? DEFAULT_EMBEDDING_PROVIDER_KEY
      : 'deterministic-hash',
    embeddingConfigured: localProviderConfigured,
    retrievalMode: databaseRuntime.retrievalMode,
    fallbackReason: databaseRuntime.fallbackReason || null,
    embeddingEndpoint: getLocalOpenAIBaseUrl() || null,
    embeddingModel: localProviderConfigured ? getLocalOpenAIEmbeddingModel() : null,
    embeddingApiKeyConfigured: Boolean(
      String(process.env.LOCAL_OPENAI_API_KEY || process.env.OPENAI_COMPAT_API_KEY || '').trim(),
    ),
    availableProviders,
    runtimeOwner: 'SERVER',
    executionRuntimeOwner: isDesktopExecutionRuntime() ? 'DESKTOP' : 'SERVER',
    endpoint: selectedProvider?.endpoint || githubModelsApiUrl,
    tokenSource,
    defaultModel: runtimeDefaultModel,
    modelCatalogSource: fromRuntime ? 'runtime' : 'fallback',
    runtimeAccessMode,
    databaseRuntime,
    activeDatabaseProfileId,
    activeDatabaseProfileLabel: activeDatabaseProfile?.label || null,
    httpFallbackEnabled: process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK === 'true',
    lastRuntimeError: identityResult.error,
    availableModels: models,
    streaming: true,
    platformFeatures,
    githubIdentity: identityResult.identity,
    githubIdentityError: identityResult.error,
  };
};
