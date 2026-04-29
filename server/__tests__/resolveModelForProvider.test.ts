// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// Stub the per-provider default-model getters so the test is hermetic and
// does not depend on .llm-providers.local.json or env vars.
vi.mock('../localOpenAIProvider', () => ({
  getLocalOpenAIBaseUrl: vi.fn(() => 'http://localhost:11434/v1'),
  getLocalOpenAIDefaultModel: vi.fn(() => 'qwen2.5-coder:7b'),
  getLocalOpenAIEmbeddingModel: vi.fn(() => 'nomic-embed-text'),
  isLocalOpenAIConfigured: vi.fn(() => true),
  listLocalOpenAIModels: vi.fn(async () => []),
  LOCAL_OPENAI_API_KEY: vi.fn(() => 'none'),
  requestLocalOpenAIModel: vi.fn(),
  requestOpenAICompatModel: vi.fn(),
  listOpenAICompatModels: vi.fn(async () => []),
}));

vi.mock('../customRouterProvider', () => ({
  getCustomRouterBaseUrl: vi.fn(() => 'https://openrouter.ai/api/v1'),
  getCustomRouterApiKey: vi.fn(() => 'sk-or-test'),
  getCustomRouterDefaultModel: vi.fn(() => 'openrouter/free'),
  getCustomRouterLabel: vi.fn(() => 'OpenRouter'),
  isCustomRouterConfigured: vi.fn(() => true),
  listCustomRouterModels: vi.fn(async () => []),
  requestCustomRouterModel: vi.fn(),
}));

vi.mock('../geminiProvider', () => ({
  getGeminiApiKey: vi.fn(() => 'gemini-key'),
  getGeminiBaseUrl: vi.fn(() => 'https://generativelanguage.googleapis.com/v1beta/openai'),
  getGeminiDefaultModel: vi.fn(() => 'gemini-2.0-flash'),
  isGeminiConfigured: vi.fn(() => true),
  listGeminiModels: vi.fn(async () => []),
  requestGeminiModel: vi.fn(),
}));

const { resolveModelForProvider } = await import('../githubModels');

describe('resolveModelForProvider — cross-provider safety net', () => {
  // The bug this guards: an agent created when local-openai was the default
  // has model 'qwen2.5-coder:7b'. After the user switches the runtime default
  // to OpenRouter, that model name follows the agent through to OpenRouter
  // and the API rejects it with 'is not a valid model ID'.
  describe('custom-router (OpenRouter)', () => {
    it('keeps a vendor/model formatted id (openai/gpt-4)', () => {
      expect(resolveModelForProvider('custom-router', 'openai/gpt-4')).toBe('openai/gpt-4');
    });

    it('keeps a tagged vendor/model id (openrouter/free)', () => {
      expect(resolveModelForProvider('custom-router', 'openrouter/free')).toBe('openrouter/free');
    });

    it('FALLS BACK when given an Ollama-style tag (qwen2.5-coder:7b)', () => {
      expect(resolveModelForProvider('custom-router', 'qwen2.5-coder:7b')).toBe('openrouter/free');
    });

    it('FALLS BACK when given a bare GitHub Copilot id (gpt-4.1-mini)', () => {
      expect(resolveModelForProvider('custom-router', 'gpt-4.1-mini')).toBe('openrouter/free');
    });

    it('FALLS BACK when given a Gemini id (gemini-2.0-flash)', () => {
      expect(resolveModelForProvider('custom-router', 'gemini-2.0-flash')).toBe('openrouter/free');
    });

    it('falls back when the agent has no model', () => {
      expect(resolveModelForProvider('custom-router', '')).toBe('openrouter/free');
      expect(resolveModelForProvider('custom-router', null)).toBe('openrouter/free');
      expect(resolveModelForProvider('custom-router', undefined)).toBe('openrouter/free');
    });
  });

  describe('local-openai (Ollama / LM Studio)', () => {
    it('keeps an Ollama-style tag (qwen2.5-coder:7b)', () => {
      expect(resolveModelForProvider('local-openai', 'qwen2.5-coder:7b')).toBe('qwen2.5-coder:7b');
    });

    it('keeps a plain id (llama3.1)', () => {
      expect(resolveModelForProvider('local-openai', 'llama3.1')).toBe('llama3.1');
    });

    it('strips an OpenAI-style local prefix when the model is really local', () => {
      expect(resolveModelForProvider('local-openai', 'openai/qwen2.5-coder:7b')).toBe(
        'qwen2.5-coder:7b',
      );
    });

    it('FALLS BACK when given an OpenRouter vendor/model (openai/gpt-4)', () => {
      expect(resolveModelForProvider('local-openai', 'openai/gpt-4')).toBe('qwen2.5-coder:7b');
    });

    it('FALLS BACK when given a Gemini vendor/model (google/gemini-flash)', () => {
      expect(resolveModelForProvider('local-openai', 'google/gemini-flash')).toBe('qwen2.5-coder:7b');
    });
  });

  describe('gemini', () => {
    it('keeps a gemini-* id', () => {
      expect(resolveModelForProvider('gemini', 'gemini-2.0-flash')).toBe('gemini-2.0-flash');
      expect(resolveModelForProvider('gemini', 'gemini-1.5-pro')).toBe('gemini-1.5-pro');
    });

    it('FALLS BACK when given a non-gemini id', () => {
      expect(resolveModelForProvider('gemini', 'qwen2.5-coder:7b')).toBe('gemini-2.0-flash');
      expect(resolveModelForProvider('gemini', 'gpt-4.1-mini')).toBe('gemini-2.0-flash');
      expect(resolveModelForProvider('gemini', 'openrouter/free')).toBe('gemini-2.0-flash');
    });
  });

  describe('github-copilot (passthrough)', () => {
    it('passes the agent model through as-is', () => {
      expect(resolveModelForProvider('github-copilot', 'gpt-4.1-mini')).toBe('gpt-4.1-mini');
      expect(resolveModelForProvider('github-copilot', 'openai/gpt-4o')).toBe('openai/gpt-4o');
    });

    it('falls back to the package-level default when no model is set', () => {
      // Default exported by githubModels is 'gpt-4.1-mini'.
      expect(resolveModelForProvider('github-copilot', '')).toBe('gpt-4.1-mini');
    });
  });
});
