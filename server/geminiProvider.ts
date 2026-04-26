/**
 * Google Gemini provider.
 *
 * Uses Google's officially supported OpenAI-compatible endpoint:
 *   https://generativelanguage.googleapis.com/v1beta/openai
 *
 * Auth:  Authorization: Bearer <GEMINI_API_KEY>
 * Docs:  https://ai.google.dev/gemini-api/docs/openai
 *
 * No extra SDK needed — the same fetch-based core as local-openai.
 *
 * Environment variables:
 *   GEMINI_API_KEY          — required (or GOOGLE_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY)
 *   GEMINI_DEFAULT_MODEL    — optional, defaults to gemini-2.0-flash
 *   GEMINI_BASE_URL         — optional override (e.g. for Vertex AI proxy)
 */

import {
  listOpenAICompatModels,
  requestOpenAICompatModel,
  type ProviderCompletion,
  type ProviderMessage,
  type ProviderTool,
  type ProviderToolChoice,
} from './localOpenAIProvider';

// ─── Config ───────────────────────────────────────────────────────────────────

export const GEMINI_DEFAULT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai';

export const getGeminiApiKey = (): string =>
  String(
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    '',
  ).trim();

export const getGeminiBaseUrl = (): string =>
  String(process.env.GEMINI_BASE_URL || GEMINI_DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');

export const getGeminiDefaultModel = (): string =>
  String(process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.0-flash').trim();

export const isGeminiConfigured = (): boolean => Boolean(getGeminiApiKey());

// ─── Known models (fallback when /models endpoint is unavailable) ─────────────

export const KNOWN_GEMINI_MODELS = [
  'gemini-2.5-pro-preview-05-06',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

// ─── Model listing ────────────────────────────────────────────────────────────

export const listGeminiModels = async (): Promise<
  Array<{ id: string; label: string; profile: string; apiModelId: string }>
> => {
  if (!isGeminiConfigured()) return [];

  // Try dynamic listing first; Gemini's /models endpoint may not follow
  // the OpenAI format exactly — fall back to the known-model list.
  const dynamic = await listOpenAICompatModels({
    baseUrl: getGeminiBaseUrl(),
    apiKey:  getGeminiApiKey(),
    profile: 'Google Gemini',
  });

  if (dynamic.length > 0) return dynamic;

  return KNOWN_GEMINI_MODELS.map(id => ({
    id,
    label:      id,
    profile:    'Google Gemini',
    apiModelId: id,
  }));
};

// ─── Chat completion ──────────────────────────────────────────────────────────

export const requestGeminiModel = async ({
  model,
  messages,
  timeoutMs = 60_000,   // Gemini can be slower than local models
  tools,
  tool_choice,
}: {
  model?: string;
  messages: ProviderMessage[];
  timeoutMs?: number;
  tools?: ProviderTool[];
  tool_choice?: ProviderToolChoice;
}): Promise<ProviderCompletion> => {
  if (!isGeminiConfigured()) {
    throw new Error(
      'Google Gemini is not configured. Set GEMINI_API_KEY (or GOOGLE_API_KEY) and restart the app.',
    );
  }

  return requestOpenAICompatModel({
    baseUrl:       getGeminiBaseUrl(),
    apiKey:        getGeminiApiKey(),
    model:         model || getGeminiDefaultModel(),
    messages,
    timeoutMs,
    tools,
    tool_choice,
    providerLabel: 'Google Gemini',
  });
};

export const requestGeminiModelStream = async ({
  model,
  messages,
  timeoutMs = 60_000,
  onDelta,
}: {
  model?: string;
  messages: ProviderMessage[];
  timeoutMs?: number;
  onDelta: (delta: string) => void;
}): Promise<ProviderCompletion> => {
  const completion = await requestGeminiModel({ model, messages, timeoutMs });
  if (completion.content) onDelta(completion.content);
  return completion;
};

// ─── Validation (health check) ────────────────────────────────────────────────

export const validateGeminiProvider = async ({
  apiKey,
  model,
  timeoutMs = 15_000,
}: {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ model: string; models: Array<{ id: string; label: string; profile: string; apiModelId: string }> }> => {
  const resolvedKey = (apiKey || getGeminiApiKey()).trim();
  if (!resolvedKey) {
    throw new Error('A Gemini API key is required. Get one at https://aistudio.google.com/app/apikey');
  }

  // Probe with a tiny completion request
  await requestOpenAICompatModel({
    baseUrl:       getGeminiBaseUrl(),
    apiKey:        resolvedKey,
    model:         model || getGeminiDefaultModel(),
    messages:      [{ role: 'user', content: 'hi' }],
    timeoutMs,
    providerLabel: 'Google Gemini',
  });

  const models = await listGeminiModels();
  return {
    model:  model || getGeminiDefaultModel(),
    models: models.length > 0 ? models : KNOWN_GEMINI_MODELS.map(id => ({ id, label: id, profile: 'Google Gemini', apiModelId: id })),
  };
};
