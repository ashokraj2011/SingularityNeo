/**
 * Custom OpenAI-compatible router provider.
 *
 * Supports any service that speaks the OpenAI chat-completions API:
 *   • OpenRouter   (https://openrouter.ai/api/v1)
 *   • OpenCode     (http://localhost:port/v1)
 *   • LiteLLM      (http://localhost:8000)
 *   • Together AI  (https://api.together.xyz/v1)
 *   • Groq         (https://api.groq.com/openai/v1)
 *   • Anyscale, Perplexity, Fireworks, … any OpenAI-compat endpoint
 *
 * Configuration — two ways:
 *
 *  1. Environment variables (simple, works out of the box):
 *       CUSTOM_ROUTER_BASE_URL          required
 *       CUSTOM_ROUTER_API_KEY           optional (default: "none")
 *       CUSTOM_ROUTER_DEFAULT_MODEL     optional
 *       CUSTOM_ROUTER_LABEL             optional display name
 *
 *  2. Runtime config (stored in .runtime-providers.local.json via Settings UI):
 *       cliUrl  → treated as base URL
 *       model   → default model
 *       env.CUSTOM_ROUTER_API_KEY → API key
 *       env.CUSTOM_ROUTER_LABEL   → display label
 */

import {
  listOpenAICompatModels,
  requestOpenAICompatModel,
  type ProviderCompletion,
  type ProviderMessage,
  type ProviderTool,
  type ProviderToolChoice,
} from './localOpenAIProvider';
import type { RuntimeProviderConfig } from '../src/types';

// ─── Config helpers ───────────────────────────────────────────────────────────

export const getCustomRouterBaseUrl = (config?: RuntimeProviderConfig | null): string =>
  String(
    config?.cliUrl ||
    process.env.CUSTOM_ROUTER_BASE_URL ||
    '',
  ).trim().replace(/\/+$/, '');

export const getCustomRouterApiKey = (config?: RuntimeProviderConfig | null): string =>
  String(
    config?.env?.['CUSTOM_ROUTER_API_KEY'] ||
    process.env.CUSTOM_ROUTER_API_KEY ||
    'none',
  ).trim();

export const getCustomRouterDefaultModel = (config?: RuntimeProviderConfig | null): string =>
  String(
    config?.model ||
    process.env.CUSTOM_ROUTER_DEFAULT_MODEL ||
    '',
  ).trim();

export const getCustomRouterLabel = (config?: RuntimeProviderConfig | null): string =>
  String(
    config?.env?.['CUSTOM_ROUTER_LABEL'] ||
    process.env.CUSTOM_ROUTER_LABEL ||
    'Custom Router',
  ).trim();

export const isCustomRouterConfigured = (config?: RuntimeProviderConfig | null): boolean =>
  Boolean(getCustomRouterBaseUrl(config));

// ─── Model listing ────────────────────────────────────────────────────────────

export const listCustomRouterModels = async (
  config?: RuntimeProviderConfig | null,
): Promise<Array<{ id: string; label: string; profile: string; apiModelId: string }>> => {
  const baseUrl = getCustomRouterBaseUrl(config);
  if (!baseUrl) return [];
  const label = getCustomRouterLabel(config);
  return listOpenAICompatModels({
    baseUrl,
    apiKey:  getCustomRouterApiKey(config),
    profile: label,
  });
};

// ─── Chat completion ──────────────────────────────────────────────────────────

export const requestCustomRouterModel = async ({
  model,
  messages,
  timeoutMs = 60_000,
  tools,
  tool_choice,
  config,
}: {
  model?: string;
  messages: ProviderMessage[];
  timeoutMs?: number;
  tools?: ProviderTool[];
  tool_choice?: ProviderToolChoice;
  config?: RuntimeProviderConfig | null;
}): Promise<ProviderCompletion> => {
  const baseUrl = getCustomRouterBaseUrl(config);
  if (!baseUrl) {
    throw new Error(
      'Custom Router is not configured. Set CUSTOM_ROUTER_BASE_URL and restart the app.',
    );
  }

  const resolvedModel = model || getCustomRouterDefaultModel(config);
  if (!resolvedModel) {
    throw new Error(
      'Custom Router: no model specified. Set CUSTOM_ROUTER_DEFAULT_MODEL or pass a model name explicitly.',
    );
  }

  return requestOpenAICompatModel({
    baseUrl,
    apiKey:        getCustomRouterApiKey(config),
    model:         resolvedModel,
    messages,
    timeoutMs,
    tools,
    tool_choice,
    providerLabel: getCustomRouterLabel(config),
  });
};

export const requestCustomRouterModelStream = async ({
  model,
  messages,
  timeoutMs = 60_000,
  onDelta,
  config,
}: {
  model?: string;
  messages: ProviderMessage[];
  timeoutMs?: number;
  onDelta: (delta: string) => void;
  config?: RuntimeProviderConfig | null;
}): Promise<ProviderCompletion> => {
  const completion = await requestCustomRouterModel({ model, messages, timeoutMs, config });
  if (completion.content) onDelta(completion.content);
  return completion;
};

// ─── Validation ───────────────────────────────────────────────────────────────

export const validateCustomRouterProvider = async ({
  baseUrl,
  apiKey,
  model,
  timeoutMs = 15_000,
}: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ model: string; baseUrl: string; models: Array<{ id: string; label: string; profile: string; apiModelId: string }> }> => {
  const resolvedUrl = String(baseUrl || getCustomRouterBaseUrl()).trim().replace(/\/+$/, '');
  if (!resolvedUrl) {
    throw new Error('A base URL is required (e.g. https://openrouter.ai/api/v1).');
  }

  const resolvedKey = String(apiKey || getCustomRouterApiKey()).trim() || 'none';
  const models = await listOpenAICompatModels({ baseUrl: resolvedUrl, apiKey: resolvedKey, profile: 'Custom Router' });

  // If the router lists no models, probe with a tiny completion
  if (models.length === 0) {
    if (!model) throw new Error('Router lists no models — specify a model to probe with.');
    await requestOpenAICompatModel({
      baseUrl:       resolvedUrl,
      apiKey:        resolvedKey,
      model,
      messages:      [{ role: 'user', content: 'hi' }],
      timeoutMs,
      providerLabel: 'Custom Router',
    });
  }

  return {
    baseUrl: resolvedUrl,
    model:   model || models[0]?.apiModelId || '',
    models,
  };
};
