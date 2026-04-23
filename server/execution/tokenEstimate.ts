/**
 * Hybrid token estimator for the Context Budgeter (Phase 2, Lever 5).
 *
 * Two paths:
 *   1. Exact BPE via js-tiktoken for OpenAI-family models
 *      (gpt-4o, gpt-4.1, o1/o3/o4 → o200k_base;
 *       gpt-4-turbo, gpt-4-32k, bare gpt-4, gpt-3.5-* → cl100k_base).
 *      Encoders are loaded lazily and cached per-encoding.
 *   2. Char-divisor heuristic for everything else (Anthropic, unknown,
 *      provider-without-model-hint). English-ish prose ≈ 4 chars/token
 *      on OpenAI / ~3.8 on Anthropic; code / JSON trends denser
 *      (~3.2 chars/token) because of punctuation and identifiers.
 *
 * Off-by-5% is fine on the openai-exact path; off-by-20% is fine on the
 * heuristic path — what matters is that eviction order in the budgeter
 * is sensible, not that the count is perfect.
 *
 * If js-tiktoken fails to load (WASM unavailable), we silently fall
 * through to the heuristic so the service keeps running.
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

// Per-encoding lazy singletons. Two encodings are in play:
//   o200k_base — GPT-4o, GPT-4.1, o1, o3, o4 families
//   cl100k_base — GPT-4-turbo, GPT-4-32k, GPT-3.5-turbo (legacy)
// Both are cached once loaded; a single unavailability flag covers both so
// a WASM load failure doesn't retry on every call.
const encoderCache = new Map<'o200k_base' | 'cl100k_base', Tiktoken>();
let encoderUnavailable = false;

const normalizeModelForEstimate = (model: string | null | undefined) => {
  const normalized = String(model || '')
    .trim()
    .toLowerCase();
  if (!normalized) return '';
  return normalized.includes('/') ? normalized.split('/').pop() || normalized : normalized;
};

// Works on an already-normalized model string. Internal helpers use this
// form so `estimateTokens` can normalize once and reuse the result across
// family detection AND encoding selection on the hot path.
const isOpenAiFamilyNormalized = (normalized: string): boolean => {
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

const isOpenAiFamilyModel = (model: string | null | undefined): boolean =>
  isOpenAiFamilyNormalized(normalizeModelForEstimate(model));

/**
 * GPT-4o / GPT-4.1 / o-series use o200k_base.
 * Older GPT-4 variants (gpt-4-turbo, gpt-4-32k, gpt-4 itself) and all
 * GPT-3.5 models use cl100k_base.
 *
 * Note: `gpt-4.1` (dot) is distinct from `gpt-4-` (hyphen) — the former
 * is a modern o200k_base model, the latter is a legacy cl100k_base family.
 */
const resolveEncodingFromNormalized = (
  normalized: string,
): 'o200k_base' | 'cl100k_base' => {
  if (
    normalized.startsWith('gpt-3.5') ||
    normalized === 'gpt-4' ||
    normalized.startsWith('gpt-4-')
  ) {
    return 'cl100k_base';
  }
  return 'o200k_base';
};

const getEncoder = (encoding: 'o200k_base' | 'cl100k_base'): Tiktoken | null => {
  if (encoderUnavailable) return null;
  const cached = encoderCache.get(encoding);
  if (cached) return cached;
  try {
    const enc = getEncoding(encoding);
    encoderCache.set(encoding, enc);
    return enc;
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
  // Normalize once and reuse for both family detection and encoding selection.
  const normalizedModel = normalizeModelForEstimate(opts.model);

  if (isOpenAiFamilyNormalized(normalizedModel)) {
    const encoder = getEncoder(resolveEncodingFromNormalized(normalizedModel));
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
