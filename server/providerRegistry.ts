import type {
  CapabilityAgent,
  EmbeddingProviderKey,
  ProviderKey,
} from '../src/types';
import { getConfiguredDefaultRuntimeProviderKeySync } from './runtimeProviderConfig';

export const DEFAULT_PROVIDER_KEY: ProviderKey = 'github-copilot';
export const DEFAULT_PROVIDER_LABEL = 'GitHub Copilot SDK';
export const LOCAL_OPENAI_PROVIDER_KEY: ProviderKey = 'local-openai';
export const LOCAL_OPENAI_PROVIDER_LABEL = 'Local OpenAI-Compatible';
export const GEMINI_PROVIDER_KEY: ProviderKey = 'gemini';
export const GEMINI_PROVIDER_LABEL = 'Google Gemini';
export const CUSTOM_ROUTER_PROVIDER_KEY: ProviderKey = 'custom-router';
export const CUSTOM_ROUTER_PROVIDER_LABEL = 'Custom OpenAI Router';
export const CLAUDE_CODE_CLI_PROVIDER_KEY: ProviderKey = 'claude-code-cli';
export const CLAUDE_CODE_CLI_PROVIDER_LABEL = 'Claude Code CLI';
export const CODEX_CLI_PROVIDER_KEY: ProviderKey = 'codex-cli';
export const CODEX_CLI_PROVIDER_LABEL = 'Codex CLI';
export const AIDER_CLI_PROVIDER_KEY: ProviderKey = 'aider-cli';
export const AIDER_CLI_PROVIDER_LABEL = 'Aider CLI';
export const DEFAULT_EMBEDDING_PROVIDER_KEY: EmbeddingProviderKey = 'local-openai';
export const HASH_EMBEDDING_PROVIDER_KEY: EmbeddingProviderKey = 'deterministic-hash';

const trim = (value?: string | null) => String(value || '').trim();
const DEFAULT_PROVIDER_LABEL_NORMALIZED = DEFAULT_PROVIDER_LABEL.toLowerCase();

export const isCliRuntimeProviderKey = (providerKey?: string | null): providerKey is ProviderKey => {
  const normalized = trim(providerKey).toLowerCase();
  return (
    normalized === CLAUDE_CODE_CLI_PROVIDER_KEY ||
    normalized === CODEX_CLI_PROVIDER_KEY ||
    normalized === AIDER_CLI_PROVIDER_KEY
  );
};

export const getConfiguredDefaultRuntimeProviderKey = (): ProviderKey =>
  getConfiguredDefaultRuntimeProviderKeySync() || DEFAULT_PROVIDER_KEY;

export const normalizeProviderKey = (value?: string | null): ProviderKey => {
  const normalized = trim(value).toLowerCase();
  if (!normalized) {
    return getConfiguredDefaultRuntimeProviderKey();
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

  if (
    normalized === GEMINI_PROVIDER_KEY ||
    normalized.includes('gemini') ||
    normalized.includes('google gemini') ||
    normalized.includes('google ai')
  ) {
    return GEMINI_PROVIDER_KEY;
  }

  if (
    normalized === CUSTOM_ROUTER_PROVIDER_KEY ||
    normalized.includes('custom router') ||
    normalized.includes('custom-router') ||
    normalized.includes('openrouter') ||
    normalized.includes('open router') ||
    normalized.includes('opencode') ||
    normalized.includes('open code') ||
    normalized.includes('litellm') ||
    normalized.includes('together') ||
    normalized.includes('groq') ||
    normalized.includes('anyscale')
  ) {
    return CUSTOM_ROUTER_PROVIDER_KEY;
  }

  if (
    normalized === CLAUDE_CODE_CLI_PROVIDER_KEY ||
    normalized === 'claude' ||
    normalized.includes('claude code')
  ) {
    return CLAUDE_CODE_CLI_PROVIDER_KEY;
  }

  if (
    normalized === CODEX_CLI_PROVIDER_KEY ||
    normalized === 'codex' ||
    normalized.includes('codex cli')
  ) {
    return CODEX_CLI_PROVIDER_KEY;
  }

  if (
    normalized === AIDER_CLI_PROVIDER_KEY ||
    normalized === 'aider' ||
    normalized.includes('aider cli')
  ) {
    return AIDER_CLI_PROVIDER_KEY;
  }

  return DEFAULT_PROVIDER_KEY;
};

const isLegacyDefaultProviderLabel = (value?: string | null) => {
  const normalized = trim(value).toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    normalized === DEFAULT_PROVIDER_KEY ||
    normalized === DEFAULT_PROVIDER_LABEL_NORMALIZED ||
    normalized.includes('github copilot')
  );
};

export const resolveProviderDisplayName = (providerKey?: ProviderKey | string | null) => {
  switch (normalizeProviderKey(providerKey)) {
    case LOCAL_OPENAI_PROVIDER_KEY:   return LOCAL_OPENAI_PROVIDER_LABEL;
    case GEMINI_PROVIDER_KEY:         return GEMINI_PROVIDER_LABEL;
    case CUSTOM_ROUTER_PROVIDER_KEY:  return CUSTOM_ROUTER_PROVIDER_LABEL;
    case CLAUDE_CODE_CLI_PROVIDER_KEY: return CLAUDE_CODE_CLI_PROVIDER_LABEL;
    case CODEX_CLI_PROVIDER_KEY:      return CODEX_CLI_PROVIDER_LABEL;
    case AIDER_CLI_PROVIDER_KEY:      return AIDER_CLI_PROVIDER_LABEL;
    default:                          return DEFAULT_PROVIDER_LABEL;
  }
};

export const hasExplicitAgentProvider = (
  agent?: Partial<CapabilityAgent> | null,
) => {
  if (trim(agent?.providerKey)) {
    return true;
  }

  return !isLegacyDefaultProviderLabel(agent?.provider);
};

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
): ProviderKey => {
  const explicitKey = trim(agent?.providerKey);
  // Treat the DEFAULT_PROVIDER_KEY ('github-copilot') stored in providerKey as
  // a legacy sentinel — the same as an empty value — so that changing the
  // configured runtime default (e.g. to 'local-openai') automatically re-routes
  // agents that were created before the switch without requiring a DB migration.
  if (explicitKey && !isLegacyDefaultProviderLabel(explicitKey)) {
    return normalizeProviderKey(explicitKey);
  }

  if (isLegacyDefaultProviderLabel(agent?.provider)) {
    return getConfiguredDefaultRuntimeProviderKey();
  }

  return normalizeProviderKey(agent?.provider);
};

export const resolveAgentEmbeddingProviderKey = (
  agent?: Partial<CapabilityAgent> | null,
): EmbeddingProviderKey =>
  normalizeEmbeddingProviderKey(agent?.embeddingProviderKey || agent?.providerKey || agent?.provider);
