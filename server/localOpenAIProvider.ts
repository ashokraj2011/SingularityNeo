import type { EmbeddingProviderKey } from '../src/types';
import {
  DEFAULT_EMBEDDING_PROVIDER_KEY,
  HASH_EMBEDDING_PROVIDER_KEY,
  LOCAL_OPENAI_PROVIDER_KEY,
  resolveProviderDisplayName,
} from './providerRegistry';

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

export const getLocalOpenAIBaseUrl = () =>
  String(process.env.LOCAL_OPENAI_BASE_URL || process.env.OPENAI_COMPAT_BASE_URL || '').trim().replace(/\/+$/, '');

const LOCAL_OPENAI_API_KEY = () =>
  String(process.env.LOCAL_OPENAI_API_KEY || process.env.OPENAI_COMPAT_API_KEY || 'local').trim();

export const getLocalOpenAIDefaultModel = () =>
  String(process.env.LOCAL_OPENAI_DEFAULT_MODEL || process.env.OPENAI_COMPAT_MODEL || 'gpt-4.1-mini').trim();

export const getLocalOpenAIEmbeddingModel = () =>
  String(process.env.LOCAL_OPENAI_EMBEDDING_MODEL || process.env.OPENAI_COMPAT_EMBEDDING_MODEL || 'text-embedding-3-small').trim();

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
    const payload = (await response.json()) as { error?: { message?: string } | string };
    if (typeof payload.error === 'string') {
      return payload.error;
    }
    return payload.error?.message || `Local provider request failed with status ${response.status}.`;
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

export const requestLocalOpenAIModel = async ({
  model,
  messages,
  timeoutMs = 45_000,
}: {
  model?: string;
  messages: ProviderMessage[];
  timeoutMs?: number;
}): Promise<ProviderCompletion> => {
  if (!isLocalOpenAIConfigured()) {
    throw new Error(
      `${resolveProviderDisplayName(LOCAL_OPENAI_PROVIDER_KEY)} is not configured. Set LOCAL_OPENAI_BASE_URL and restart the app.`,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${getLocalOpenAIBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOCAL_OPENAI_API_KEY()}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model || getLocalOpenAIDefaultModel(),
        messages,
        temperature: 0.2,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(await getLocalProviderError(response));
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
          content?: string;
        };
      }>;
    };

    const content = payload.choices?.[0]?.message?.content?.trim() || '';
    if (!content) {
      throw new Error('The local OpenAI-compatible provider returned an empty response.');
    }

    const promptText = messages.map(message => `${message.role}: ${message.content}`).join('\n');
    const usage = payload.usage
      ? {
          promptTokens: Number(payload.usage.prompt_tokens || 0),
          completionTokens: Number(payload.usage.completion_tokens || 0),
          totalTokens: Number(payload.usage.total_tokens || 0),
          estimatedCostUsd: Number((Number(payload.usage.total_tokens || 0) * 0.000002).toFixed(6)),
        }
      : estimateUsage(promptText, content);

    return {
      content,
      model: String(payload.model || model || getLocalOpenAIDefaultModel()),
      usage,
      responseId: payload.id || null,
      createdAt: payload.created
        ? new Date(payload.created * 1000).toISOString()
        : new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The local OpenAI-compatible provider timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  } catch {
    return {
      providerKey: HASH_EMBEDDING_PROVIDER_KEY,
      model: 'deterministic-hash-v2',
      vectors: [],
    };
  } finally {
    clearTimeout(timeout);
  }
};
