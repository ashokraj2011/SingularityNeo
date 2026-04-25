export type RuntimeAccessMode =
  | 'desktop-cli'
  | 'sdk-session'
  | 'http-api'
  | 'local-openai'
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
  providerKey,
  tokenSource,
  token,
  modelCatalogFromRuntime,
}: {
  providerKey?: string | null;
  tokenSource?: string | null;
  token?: string;
  modelCatalogFromRuntime: boolean;
}): RuntimeAccessMode => {
  const normalizedProvider = String(providerKey || '').trim().toLowerCase();
  if (normalizedProvider === 'local-openai') {
    return 'local-openai';
  }

  if (
    normalizedProvider === 'codex-cli' ||
    normalizedProvider === 'claude-code-cli' ||
    normalizedProvider === 'aider-cli'
  ) {
    return 'desktop-cli';
  }

  if (tokenSource === 'headless-cli' || isHeadlessCliConfigured() || modelCatalogFromRuntime) {
    return 'sdk-session';
  }

  if (token) {
    return 'http-api';
  }

  return 'unconfigured';
};

export const getMissingRuntimeConfigurationMessage = () =>
  'No agent runtime is configured. Start the desktop runtime for the preferred local provider, or configure COPILOT_CLI_URL / GITHUB_MODELS_TOKEN / a desktop CLI provider, then restart the app.';
