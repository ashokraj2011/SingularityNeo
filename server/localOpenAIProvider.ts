import type { EmbeddingProviderKey } from '../src/types';
import {
  DEFAULT_EMBEDDING_PROVIDER_KEY,
  HASH_EMBEDDING_PROVIDER_KEY,
  LOCAL_OPENAI_PROVIDER_KEY,
  resolveProviderDisplayName,
} from './providerRegistry';
import { getLLMProviderConfig } from './llmProviderConfig';
import { getLocalOpenAIConfigIssue } from '../src/contracts/runtimeProviderDiagnostics';

export type ProviderMessage = {
  role: 'developer' | 'system' | 'user' | 'assistant';
  content: string;
};

export type ProviderUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type ProviderCompletion = {
  content: string;
  model: string;
  usage: ProviderUsage;
  responseId: string | null;
  createdAt: string;
};

const normalizeLocalCompatModel = (value: unknown) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  if (/^(openai|anthropic|google|openrouter|meta|mistralai)\//i.test(normalized)) {
    const stripped = normalized.split('/').slice(1).join('/').trim();
    return stripped || normalized;
  }
  return normalized;
};

export const getLocalOpenAIBaseUrl = () => {
  // Check LLM config file first (for UI-managed settings)
  const config = getLLMProviderConfig('local-openai');
  if (config?.baseUrl) {
    return config.baseUrl.trim().replace(/\/+$/, '');
  }

  // Fall back to environment variables
  return String(process.env.LOCAL_OPENAI_BASE_URL || process.env.OPENAI_COMPAT_BASE_URL || '').trim().replace(/\/+$/, '');
};

const LOCAL_OPENAI_API_KEY = () => {
  // Check LLM config file first (for UI-managed settings)
  const config = getLLMProviderConfig('local-openai');
  if (config?.apiKey) {
    return config.apiKey.trim();
  }

  // Fall back to environment variables
  return String(process.env.LOCAL_OPENAI_API_KEY || process.env.OPENAI_COMPAT_API_KEY || 'local').trim();
};

export const getLocalOpenAIDefaultModel = () => {
  // Check LLM config file first (for UI-managed settings)
  const config = getLLMProviderConfig('local-openai');
  if (config?.defaultModel) {
    return normalizeLocalCompatModel(config.defaultModel) || 'gpt-4.1-mini';
  }

  // Fall back to environment variables
  return (
    normalizeLocalCompatModel(
      process.env.LOCAL_OPENAI_DEFAULT_MODEL || process.env.OPENAI_COMPAT_MODEL,
    ) || 'gpt-4.1-mini'
  );
};

export const getLocalOpenAIEmbeddingModel = () =>
  String(process.env.LOCAL_OPENAI_EMBEDDING_MODEL || process.env.OPENAI_COMPAT_EMBEDDING_MODEL || 'text-embedding-3-small').trim();

export const validateLocalOpenAIEmbeddingProvider = async ({
  baseUrl,
  apiKey,
  model,
  timeoutMs = 45_000,
}: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}) => {
  const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalizedBaseUrl) {
    throw new Error('A local embedding base URL is required.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${normalizedBaseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(apiKey || 'local').trim() || 'local'}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: String(model || getLocalOpenAIEmbeddingModel()).trim() || getLocalOpenAIEmbeddingModel(),
        input: ['singularity-embedding-healthcheck'],
      }),
    });

    if (!response.ok) {
      throw new Error(await getLocalProviderError(response));
    }

    const payload = (await response.json()) as {
      model?: string;
      data?: Array<{ embedding?: number[] }>;
    };

    if (!Array.isArray(payload.data) || payload.data.length === 0) {
      throw new Error('The local embedding provider returned no vectors.');
    }

    return {
      baseUrl: normalizedBaseUrl,
      model:
        String(payload.model || model || getLocalOpenAIEmbeddingModel()).trim() ||
        getLocalOpenAIEmbeddingModel(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The local embedding provider timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const estimateUsage = (prompt: string, completion: string): ProviderUsage => {
  const promptTokens = Math.max(1, Math.ceil(prompt.split(/\s+/).filter(Boolean).length * 1.25));
  const completionTokens = Math.max(
    1,
    Math.ceil(completion.split(/\s+/).filter(Boolean).length * 1.25),
  );
  const totalTokens = promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd: Number((totalTokens * 0.000002).toFixed(6)),
  };
};

const getLocalProviderError = async (response: Response) => {
  try {
    const rawPayload = await response.json();
    const payload = Array.isArray(rawPayload) ? rawPayload[0] : rawPayload;
    if (typeof payload?.error === 'string') {
      return payload.error;
    }
    return payload?.error?.message || `Local provider request failed with status ${response.status}.`;
  } catch {
    return `Local provider request failed with status ${response.status}.`;
  }
};

export const isLocalOpenAIConfigured = () => Boolean(getLocalOpenAIBaseUrl());

export const listLocalOpenAIModels = async () => {
  if (!isLocalOpenAIConfigured()) {
    return [] as Array<{ id: string; label: string; profile: string; apiModelId: string }>;
  }

  try {
    const response = await fetch(`${getLocalOpenAIBaseUrl()}/models`, {
      headers: {
        Authorization: `Bearer ${LOCAL_OPENAI_API_KEY()}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };

    return (payload.data || [])
      .map(model => String(model.id || '').trim())
      .filter(Boolean)
      .map(modelId => ({
        id: modelId,
        label: modelId,
        profile: 'Local OpenAI-compatible model',
        apiModelId: modelId,
      }));
  } catch {
    return [];
  }
};

export const validateLocalOpenAIChatProvider = async ({
  baseUrl,
  apiKey,
  model,
  timeoutMs = 15_000,
}: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}) => {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl) {
    throw new Error("A local OpenAI-compatible base URL is required.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${normalizedBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${String(apiKey || "local").trim() || "local"}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(await getLocalProviderError(response));
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    const models = (payload.data || [])
      .map(item => String(item.id || "").trim())
      .filter(Boolean)
      .map(modelId => ({
        id: modelId,
        label: modelId,
        profile: "Local OpenAI-compatible model",
        apiModelId: modelId,
      }));

    return {
      baseUrl: normalizedBaseUrl,
      model:
        String(model || models[0]?.apiModelId || getLocalOpenAIDefaultModel()).trim() ||
        getLocalOpenAIDefaultModel(),
      models,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The local OpenAI-compatible provider timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

// ─── Shared OpenAI-compatible HTTP core ──────────────────────────────────────
//
// All three HTTP providers (local-openai, gemini, custom-router) call this
// with their own base URL and API key. Keeping it in one place avoids drift.

// Minimal tool-call types for OpenAI-compatible API requests.
export interface ProviderTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type ProviderToolChoice =
  | 'auto'
  | 'none'
  | { type: 'function'; function: { name: string } };

/**
 * Low-level OpenAI-compatible chat completion.
 * Accepts explicit baseUrl + apiKey so any provider (local-openai, gemini,
 * custom-router) can call it without re-implementing the fetch logic.
 */
export const requestOpenAICompatModel = async ({
  baseUrl,
  apiKey,
  model,
  messages,
  timeoutMs = 45_000,
  tools,
  tool_choice,
  providerLabel = 'OpenAI-compatible provider',
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ProviderMessage[];
  timeoutMs?: number;
  tools?: ProviderTool[];
  tool_choice?: ProviderToolChoice;
  providerLabel?: string;
}): Promise<ProviderCompletion> => {
  const maxRetries = 2;
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // ── LLM Request logging ───────────────────────────────────────
      const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      console.log(
        `[LLM REQUEST] provider=${providerLabel} | model=${model} | messages=${messages.length} | chars=${totalChars} | tools=${tools?.length ?? 0} | attempt=${attempt + 1} | url=${baseUrl}/chat/completions`,
      );
      for (const m of messages) {
        console.log(`[LLM REQUEST]   [${m.role}] (${m.content.length} chars):\n${m.content}`);
      }
      // ──────────────────────────────────────────────────────────────

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          stream: false,
          ...(tools && tools.length > 0 ? { tools } : {}),
          ...(tool_choice != null ? { tool_choice } : {}),
        }),
      });

      if (!response.ok) {
        const errorMsg = await getLocalProviderError(response);
        console.error(`[LLM ERROR] provider=${providerLabel} | status=${response.status} | error=${errorMsg}`);
        if (response.status === 429 && attempt < maxRetries) {
          attempt++;
          let delayMs = 5000;
          const retryMatch = errorMsg.match(/retry in ([\d\.]+)/i);
          if (retryMatch && retryMatch[1]) {
            delayMs = Math.ceil(parseFloat(retryMatch[1])) * 1000 + 1000;
          } else {
            delayMs = attempt * 5000;
          }
          console.warn(`[${providerLabel}] 429 Quota Exceeded. Retrying in ${delayMs / 1000}s... (Attempt ${attempt}/${maxRetries}): ${errorMsg}`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        throw new Error(errorMsg);
      }

      const payload = (await response.json()) as {
        id?: string;
        created?: number;
        model?: string;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };

      const toolCall = payload.choices?.[0]?.message?.tool_calls?.[0];
      const content =
        toolCall?.function?.arguments?.trim() ||
        payload.choices?.[0]?.message?.content?.trim() ||
        '';
      if (!content) {
        throw new Error(`${providerLabel} returned an empty response.`);
      }

      const promptText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
      const usage = payload.usage
        ? {
            promptTokens:     Number(payload.usage.prompt_tokens    || 0),
            completionTokens: Number(payload.usage.completion_tokens || 0),
            totalTokens:      Number(payload.usage.total_tokens      || 0),
            estimatedCostUsd: Number((Number(payload.usage.total_tokens || 0) * 0.000002).toFixed(6)),
          }
        : estimateUsage(promptText, content);

      // ── LLM Response logging ──────────────────────────────────────
      console.log(
        `[LLM RESPONSE] provider=${providerLabel} | model=${payload.model || model} | promptTokens=${usage.promptTokens} | completionTokens=${usage.completionTokens} | totalTokens=${usage.totalTokens} | cost=$${usage.estimatedCostUsd} | responseId=${payload.id || 'n/a'}`,
      );
      console.log(`[LLM RAW RESPONSE]:\n${JSON.stringify(payload, null, 2)}`);
      // ──────────────────────────────────────────────────────────────

      return {
        content,
        model:      String(payload.model || model),
        usage,
        responseId: payload.id || null,
        createdAt:  payload.created
          ? new Date(payload.created * 1000).toISOString()
          : new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`[LLM TIMEOUT] provider=${providerLabel} | model=${model} | timeoutMs=${timeoutMs}`);
        throw new Error(`${providerLabel} timed out.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
};

/**
 * Fetch the model list from any OpenAI-compatible /models endpoint.
 * Returns an empty array on any error (provider offline / no list endpoint).
 */
export const listOpenAICompatModels = async ({
  baseUrl,
  apiKey,
  profile,
}: {
  baseUrl: string;
  apiKey: string;
  profile: string;
}): Promise<Array<{ id: string; label: string; profile: string; apiModelId: string }>> => {
  try {
    const resp = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    const payload = (await resp.json()) as { data?: Array<{ id?: string }> };
    return (payload.data || [])
      .map(m => String(m.id || '').trim())
      .filter(Boolean)
      .map(id => ({ id, label: id, profile, apiModelId: id }));
  } catch {
    return [];
  }
};

export const requestLocalOpenAIModel = async ({
  model,
  messages,
  timeoutMs = 45_000,
  tools,
  tool_choice,
}: {
  model?: string;
  messages: ProviderMessage[];
  timeoutMs?: number;
  tools?: ProviderTool[];
  tool_choice?: ProviderToolChoice;
}): Promise<ProviderCompletion> => {
  if (!isLocalOpenAIConfigured()) {
    throw new Error(
      `${resolveProviderDisplayName(LOCAL_OPENAI_PROVIDER_KEY)} is not configured. Set LOCAL_OPENAI_BASE_URL and restart the app.`,
    );
  }
  const resolvedModel = model || getLocalOpenAIDefaultModel();
  const configIssue = getLocalOpenAIConfigIssue({
    baseUrl: getLocalOpenAIBaseUrl(),
    model: resolvedModel,
  });
  if (configIssue) {
    throw new Error(configIssue.message);
  }
  return requestOpenAICompatModel({
    baseUrl:       getLocalOpenAIBaseUrl(),
    apiKey:        LOCAL_OPENAI_API_KEY(),
    model:         resolvedModel,
    messages,
    timeoutMs,
    tools,
    tool_choice,
    providerLabel: 'Local OpenAI-compatible provider',
  });
};

export const requestLocalOpenAIModelStream = async ({
  model,
  messages,
  timeoutMs = 45_000,
  onDelta,
}: {
  model?: string;
  messages: ProviderMessage[];
  timeoutMs?: number;
  onDelta: (delta: string) => void;
}) => {
  const completion = await requestLocalOpenAIModel({ model, messages, timeoutMs });
  if (completion.content) {
    onDelta(completion.content);
  }
  return completion;
};

const normalizeEmbedding = (values: unknown, dimensions: number) => {
  const input = Array.isArray(values)
    ? values.map(value => Number(value || 0))
    : [];
  if (input.length === 0) {
    return Array.from({ length: dimensions }, () => 0);
  }

  const resized = Array.from({ length: dimensions }, (_, index) => input[index] || 0);
  const magnitude = Math.sqrt(resized.reduce((sum, value) => sum + value ** 2, 0)) || 1;
  return resized.map(value => Number((value / magnitude).toFixed(6)));
};

export const requestLocalOpenAIEmbeddings = async ({
  texts,
  dimensions,
  timeoutMs = 60_000,
}: {
  texts: string[];
  dimensions: number;
  timeoutMs?: number;
}): Promise<{
  providerKey: EmbeddingProviderKey;
  model: string;
  vectors: number[][];
  fallbackReason?: string;
}> => {
  if (!texts.length) {
    return {
      providerKey: DEFAULT_EMBEDDING_PROVIDER_KEY,
      model: getLocalOpenAIEmbeddingModel(),
      vectors: [],
    };
  }

  if (!isLocalOpenAIConfigured()) {
    return {
      providerKey: HASH_EMBEDDING_PROVIDER_KEY,
      model: 'deterministic-hash-v2',
      vectors: [],
      fallbackReason: 'Local embedding provider is not configured.',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getLocalOpenAIBaseUrl()}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOCAL_OPENAI_API_KEY()}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: getLocalOpenAIEmbeddingModel(),
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(await getLocalProviderError(response));
    }

    const payload = (await response.json()) as {
      data?: Array<{
        embedding?: number[];
      }>;
      model?: string;
    };

    return {
      providerKey: DEFAULT_EMBEDDING_PROVIDER_KEY,
      model: String(payload.model || getLocalOpenAIEmbeddingModel()),
      vectors: (payload.data || []).map(item => normalizeEmbedding(item.embedding, dimensions)),
    };
  } catch (error) {
    return {
      providerKey: HASH_EMBEDDING_PROVIDER_KEY,
      model: 'deterministic-hash-v2',
      vectors: [],
      fallbackReason:
        error instanceof Error
          ? error.message
          : 'Local embedding provider request failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
};
