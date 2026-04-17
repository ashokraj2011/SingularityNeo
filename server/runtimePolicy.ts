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
  'Copilot runtime is not configured. Start the desktop runtime for the preferred local-owner model, or set COPILOT_CLI_URL / GITHUB_MODELS_TOKEN for a shared runtime, then restart the app.';
