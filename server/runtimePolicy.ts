export type RuntimeAccessMode =
  | 'headless-cli'
  | 'copilot-session'
  | 'http-fallback'
  | 'unconfigured';

export const getConfiguredCopilotCliUrl = () => process.env.COPILOT_CLI_URL?.trim() || '';

export const isHeadlessCliConfigured = () => Boolean(getConfiguredCopilotCliUrl());

export const isHttpFallbackAllowed = () => {
  // Always allowed when the Copilot CLI is not the primary transport.
  if (!isHeadlessCliConfigured()) return true;
  // Explicitly opted in.
  if (process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK === 'true') return true;
  // Automatically allow when the user has BOTH COPILOT_CLI_URL and a
  // GITHUB_MODELS_TOKEN / GITHUB_TOKEN configured — the CLI is primary but the
  // HTTP token acts as a ready fallback when the CLI rejects a model due to an
  // org-level "Additional AI models" policy.
  if (process.env.GITHUB_MODELS_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim()) return true;
  return false;
};

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
