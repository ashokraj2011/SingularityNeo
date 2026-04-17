import type {
  CapabilityAgent,
  EmbeddingProviderKey,
  ProviderKey,
} from '../src/types';

export const DEFAULT_PROVIDER_KEY: ProviderKey = 'github-copilot';
export const DEFAULT_PROVIDER_LABEL = 'GitHub Copilot SDK';
export const LOCAL_OPENAI_PROVIDER_KEY: ProviderKey = 'local-openai';
export const LOCAL_OPENAI_PROVIDER_LABEL = 'Local OpenAI-Compatible';
export const DEFAULT_EMBEDDING_PROVIDER_KEY: EmbeddingProviderKey = 'local-openai';
export const HASH_EMBEDDING_PROVIDER_KEY: EmbeddingProviderKey = 'deterministic-hash';

const trim = (value?: string | null) => String(value || '').trim();

export const normalizeProviderKey = (value?: string | null): ProviderKey => {
  const normalized = trim(value).toLowerCase();
  if (!normalized) {
    return DEFAULT_PROVIDER_KEY;
  }

  if (
    normalized === LOCAL_OPENAI_PROVIDER_KEY ||
    normalized.includes('local openai') ||
    normalized.includes('openai-compatible') ||
    normalized.includes('openai compatible') ||
    normalized.includes('ollama') ||
    normalized.includes('lm studio')
  ) {
    return LOCAL_OPENAI_PROVIDER_KEY;
  }

  return DEFAULT_PROVIDER_KEY;
};

export const resolveProviderDisplayName = (providerKey?: ProviderKey | string | null) =>
  normalizeProviderKey(providerKey) === LOCAL_OPENAI_PROVIDER_KEY
    ? LOCAL_OPENAI_PROVIDER_LABEL
    : DEFAULT_PROVIDER_LABEL;

export const normalizeEmbeddingProviderKey = (
  value?: string | null,
): EmbeddingProviderKey => {
  const normalized = trim(value).toLowerCase();
  if (
    normalized === DEFAULT_EMBEDDING_PROVIDER_KEY ||
    normalized.includes('local openai') ||
    normalized.includes('embedding')
  ) {
    return DEFAULT_EMBEDDING_PROVIDER_KEY;
  }

  if (normalized === HASH_EMBEDDING_PROVIDER_KEY || normalized.includes('hash')) {
    return HASH_EMBEDDING_PROVIDER_KEY;
  }

  return DEFAULT_EMBEDDING_PROVIDER_KEY;
};

export const resolveAgentProviderKey = (
  agent?: Partial<CapabilityAgent> | null,
): ProviderKey => normalizeProviderKey(agent?.providerKey || agent?.provider);

export const resolveAgentEmbeddingProviderKey = (
  agent?: Partial<CapabilityAgent> | null,
): EmbeddingProviderKey =>
  normalizeEmbeddingProviderKey(agent?.embeddingProviderKey || agent?.providerKey || agent?.provider);
