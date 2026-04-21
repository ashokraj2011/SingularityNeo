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

export const estimateTokens = (
  text: string,
  opts: { provider?: TokenEstimateProvider; kind?: TokenEstimateKind } = {},
): number => {
  if (!text) return 0;
  const provider = opts.provider || 'unknown';
  const kind = opts.kind || 'prose';
  const divisor = DIVISORS_BY_PROVIDER[provider][kind];
  // Round up so a 1-char fragment still costs at least 1 token.
  return Math.max(1, Math.ceil(text.length / divisor));
};

export const normalizeProviderForEstimate = (
  providerKey: string | null | undefined,
): TokenEstimateProvider => {
  const normalized = (providerKey || '').toLowerCase().trim();
  if (!normalized) return 'unknown';
  if (normalized.includes('anthropic') || normalized.includes('claude')) return 'anthropic';
  if (normalized.includes('copilot')) return 'github-copilot';
  if (normalized.includes('local')) return 'local-openai';
  if (normalized.includes('openai') || normalized.includes('gpt')) return 'openai';
  return 'unknown';
};
