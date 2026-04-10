export type RuntimeAccessMode =
  | 'headless-cli'
  | 'copilot-session'
  | 'http-fallback'
  | 'unconfigured';

export const getConfiguredCopilotCliUrl = () => process.env.COPILOT_CLI_URL?.trim() || '';

export const isHeadlessCliConfigured = () => Boolean(getConfiguredCopilotCliUrl());

export const isHttpFallbackAllowed = () =>
  !isHeadlessCliConfigured() || process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK === 'true';

export const resolveRuntimeAccessMode = ({
  tokenSource,
  token,
  modelCatalogFromRuntime,
}: {
  tokenSource?: string | null;
  token?: string;
  modelCatalogFromRuntime: boolean;
}): RuntimeAccessMode => {
  if (tokenSource === 'headless-cli' || isHeadlessCliConfigured()) {
    return 'headless-cli';
  }

  if (modelCatalogFromRuntime) {
    return 'copilot-session';
  }

  if (token) {
    return 'http-fallback';
  }

  return 'unconfigured';
};

export const getMissingRuntimeConfigurationMessage = () =>
  'GitHub Copilot SDK is not configured. Set COPILOT_CLI_URL for a headless Copilot CLI server or add GITHUB_MODELS_TOKEN to .env.local, then restart the server.';
