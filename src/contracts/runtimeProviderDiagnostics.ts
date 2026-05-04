import type { RuntimeProviderStatus } from './runtime';

const parseBaseUrl = (baseUrl: string) => {
  try {
    return new URL(baseUrl);
  } catch {
    return null;
  }
};

const OPENAI_MODEL_PATTERNS = [
  /^gpt-/i,
  /^o[134](?:$|[-:])/i,
  /^computer-use-preview/i,
  /^text-embedding-/i,
  /^omni-moderation-/i,
  /^whisper-/i,
  /^tts-/i,
];

const LOCAL_MODEL_PATTERNS = [
  /^qwen/i,
  /^llama/i,
  /^mistral/i,
  /^mixtral/i,
  /^deepseek/i,
  /^gemma/i,
  /^phi/i,
  /^codestral/i,
  /^codellama/i,
  /^starcoder/i,
  /^yi/i,
  /:\d+[a-z]*$/i,
];

const normalizeModel = (value: string | null | undefined) => String(value || '').trim();

const looksLikeOpenAIModel = (model: string) =>
  OPENAI_MODEL_PATTERNS.some(pattern => pattern.test(model));

const looksLikeLocalModel = (model: string) =>
  LOCAL_MODEL_PATTERNS.some(pattern => pattern.test(model));

const isOpenAIEndpoint = (baseUrl: string) => {
  const parsed = parseBaseUrl(baseUrl);
  if (!parsed) {
    return false;
  }
  return (
    parsed.hostname === 'api.openai.com' ||
    parsed.hostname.endsWith('.openai.com')
  );
};

const isLikelyOllamaEndpoint = (baseUrl: string) => {
  const parsed = parseBaseUrl(baseUrl);
  if (!parsed) {
    return false;
  }
  return (
    ['127.0.0.1', 'localhost', '0.0.0.0'].includes(parsed.hostname) &&
    parsed.port === '11434'
  );
};

export const getLocalOpenAIConfigIssue = ({
  baseUrl,
  model,
}: {
  baseUrl?: string | null;
  model?: string | null;
}) => {
  const normalizedBaseUrl = String(baseUrl || '').trim();
  const normalizedModel = normalizeModel(model);
  if (!normalizedBaseUrl || !normalizedModel) {
    return null;
  }

  if (isOpenAIEndpoint(normalizedBaseUrl) && looksLikeLocalModel(normalizedModel)) {
    return {
      status: 'invalid' as const,
      message: `Local OpenAI-compatible runtime is misconfigured: endpoint is OpenAI (${normalizedBaseUrl}) but model "${normalizedModel}" looks local/Ollama. Point it to Ollama or another OpenAI-compatible local endpoint, or switch to a real OpenAI model.`,
      details: [
        'Example Ollama endpoint: http://127.0.0.1:11434/v1',
        'Example OpenAI model: gpt-4.1-mini',
      ],
    };
  }

  if (isLikelyOllamaEndpoint(normalizedBaseUrl) && looksLikeOpenAIModel(normalizedModel)) {
    return {
      status: 'invalid' as const,
      message: `Local OpenAI-compatible runtime is misconfigured: endpoint ${normalizedBaseUrl} looks like Ollama, but model "${normalizedModel}" looks like an OpenAI-hosted model. Choose an Ollama model name or switch the endpoint to the provider that serves this model.`,
      details: [
        'Example Ollama model: qwen2.5-coder:7b',
        'Example OpenAI endpoint: https://api.openai.com/v1',
      ],
    };
  }

  return null;
};

export const getRuntimeStatusProviderIssue = ({
  configured,
  providerKey,
  availableProviders,
}: {
  configured?: boolean | null;
  providerKey?: string | null;
  availableProviders?: RuntimeProviderStatus[] | null;
}) => {
  const providers = availableProviders || [];
  const selectedProvider =
    providers.find(provider => provider.key === providerKey) ||
    providers.find(provider => provider.defaultSelected) ||
    providers.find(provider => provider.configured) ||
    providers[0] ||
    null;

  if (selectedProvider?.validation && !selectedProvider.validation.ok) {
    return selectedProvider.validation.message;
  }

  if (!configured && selectedProvider?.validation?.message) {
    return selectedProvider.validation.message;
  }

  return null;
};
