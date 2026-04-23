/**
 * Cheap provider-agnostic token estimator.
 *
 * We deliberately avoid pulling in tiktoken / anthropic-tokenizer — those
 * are large binary deps, version-skewed per provider, and require network
 * to stay accurate as model vocabularies evolve. For the Context Budgeter
 * (Phase 2, Lever 5) we only need a rough-but-stable estimate so eviction
 * order is sensible. Off-by-20% is fine; off-by-100x is not.
 *
 * Heuristic: English-ish text is ~4 chars/token on OpenAI, ~3.8 on
 * Anthropic. Code / JSON trends denser (~3.2 chars/token) because of
 * punctuation and identifiers. We pick the right divisor based on the
 * provider key and a `kind` hint from the caller.
 */
import { getEncoding, type Tiktoken } from 'js-tiktoken';

export type TokenEstimateKind = 'prose' | 'code' | 'json';
export type TokenEstimateProvider =
  | 'openai'
  | 'github-copilot'
  | 'anthropic'
  | 'local-openai'
  | 'unknown';

interface ProviderDivisors {
  prose: number;
  code: number;
  json: number;
}

// Chars per token. Lower = denser = more tokens per char.
const DIVISORS_BY_PROVIDER: Record<TokenEstimateProvider, ProviderDivisors> = {
  openai: { prose: 4.0, code: 3.2, json: 3.0 },
  'github-copilot': { prose: 4.0, code: 3.2, json: 3.0 },
  anthropic: { prose: 3.8, code: 3.1, json: 2.9 },
  'local-openai': { prose: 4.0, code: 3.2, json: 3.0 },
  unknown: { prose: 3.8, code: 3.1, json: 2.9 }, // conservative: assume denser
};

type TokenEstimateFamily = 'openai-exact' | 'heuristic';

let cachedEncoder: Tiktoken | null = null;
let encoderUnavailable = false;

const normalizeModelForEstimate = (model: string | null | undefined) => {
  const normalized = String(model || '')
    .trim()
    .toLowerCase();
  if (!normalized) return '';
  return normalized.includes('/') ? normalized.split('/').pop() || normalized : normalized;
};

const isOpenAiFamilyModel = (model: string | null | undefined) => {
  const normalized = normalizeModelForEstimate(model);
  if (!normalized) return false;
  if (normalized.includes('claude') || normalized.includes('anthropic')) {
    return false;
  }
  return (
    normalized.startsWith('gpt-') ||
    normalized.startsWith('chatgpt-') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  );
};

const resolveEstimateFamily = ({
  provider,
  model,
}: {
  provider: TokenEstimateProvider;
  model?: string | null;
}): TokenEstimateFamily => {
  if (isOpenAiFamilyModel(model)) {
    return 'openai-exact';
  }
  if (provider === 'openai' && !model) {
    return 'heuristic';
  }
  if (provider === 'local-openai' && !model) {
    return 'heuristic';
  }
  return 'heuristic';
};

const getEncoder = (): Tiktoken | null => {
  if (cachedEncoder) {
    return cachedEncoder;
  }
  if (encoderUnavailable) {
    return null;
  }

  try {
    cachedEncoder = getEncoding('o200k_base');
    return cachedEncoder;
  } catch {
    encoderUnavailable = true;
    return null;
  }
};

export const estimateTokens = (
  text: string,
  opts: {
    provider?: TokenEstimateProvider;
    model?: string | null;
    kind?: TokenEstimateKind;
  } = {},
): number => {
  if (!text) return 0;
  const provider = opts.provider || 'unknown';
  const kind = opts.kind || 'prose';
  const family = resolveEstimateFamily({
    provider,
    model: opts.model,
  });

  if (family === 'openai-exact') {
    const encoder = getEncoder();
    if (encoder) {
      try {
        return Math.max(1, encoder.encode(text).length);
      } catch {
        // Fall through to the heuristic estimator below.
      }
    }
  }

  const divisor = DIVISORS_BY_PROVIDER[provider][kind];
  // Round up so a 1-char fragment still costs at least 1 token.
  return Math.max(1, Math.ceil(text.length / divisor));
};

export const normalizeProviderForEstimate = (
  providerKey: string | null | undefined,
  model?: string | null | undefined,
): TokenEstimateProvider => {
  const normalizedModel = normalizeModelForEstimate(model);
  if (normalizedModel.includes('claude') || normalizedModel.includes('anthropic')) {
    return 'anthropic';
  }
  if (isOpenAiFamilyModel(model)) {
    return 'openai';
  }

  const normalized = (providerKey || '').toLowerCase().trim();
  if (!normalized) return 'unknown';
  if (normalized.includes('anthropic') || normalized.includes('claude')) return 'anthropic';
  if (normalized.includes('copilot')) return 'github-copilot';
  if (normalized.includes('local')) return 'local-openai';
  if (normalized.includes('openai') || normalized.includes('gpt')) return 'openai';
  return 'unknown';
};
