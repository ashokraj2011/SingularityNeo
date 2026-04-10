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
import { resolveRuntimeAccessMode } from './runtimePolicy';

export const buildRuntimeStatus = async () => {
  const token = getConfiguredToken();
  const tokenSource = getConfiguredTokenSource();
  const headlessCli = tokenSource === 'headless-cli';
  const configured = headlessCli || Boolean(token);
  const platformFeatures = getPlatformFeatureState();
  const { models, fromRuntime } = await listAvailableRuntimeModels();
  const runtimeDefaultModel = configured
    ? await getRuntimeDefaultModel()
    : normalizeModel(defaultModel);
  const identityResult = configured
    ? await getConfiguredGitHubIdentity()
    : { identity: null, error: null };

  return {
    configured,
    provider: 'GitHub Copilot SDK',
    endpoint: headlessCli
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
