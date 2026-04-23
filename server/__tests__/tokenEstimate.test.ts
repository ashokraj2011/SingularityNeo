// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEncoding } from 'js-tiktoken';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('js-tiktoken');
});

describe('tokenEstimate model-aware routing', () => {
  it('uses exact OpenAI BPE counts for GPT-family models reached via Copilot', async () => {
    const { estimateTokens, normalizeProviderForEstimate } = await import(
      '../execution/tokenEstimate'
    );
    const text = 'function validateToken(token) { return token?.trim() ?? ""; }';
    const provider = normalizeProviderForEstimate('github-copilot', 'gpt-5.4');
    const expected = getEncoding('o200k_base').encode(text).length;

    expect(provider).toBe('openai');
    expect(estimateTokens(text, { provider, model: 'gpt-5.4', kind: 'code' })).toBe(expected);
  });

  it('keeps Claude-on-Copilot traffic on the heuristic path', async () => {
    const { estimateTokens, normalizeProviderForEstimate } = await import(
      '../execution/tokenEstimate'
    );
    const text = 'Need a concise approval summary for this packet.';
    const provider = normalizeProviderForEstimate('github-copilot', 'claude-sonnet-4.6');

    expect(provider).toBe('anthropic');
    expect(estimateTokens(text, { provider, model: 'claude-sonnet-4.6' })).toBe(
      Math.ceil(text.length / 3.8),
    );
  });

  it('keeps provider-based heuristic behavior when the model is missing', async () => {
    const { estimateTokens, normalizeProviderForEstimate } = await import(
      '../execution/tokenEstimate'
    );
    const text = 'Recent conversation turns';
    const provider = normalizeProviderForEstimate('github-copilot');

    expect(provider).toBe('github-copilot');
    expect(estimateTokens(text, { provider })).toBe(Math.ceil(text.length / 4));
  });

  it('falls back cleanly to the heuristic path when encoder initialization fails', async () => {
    vi.doMock('js-tiktoken', () => ({
      getEncoding: vi.fn(() => {
        throw new Error('encoder init failed');
      }),
    }));

    const { estimateTokens, normalizeProviderForEstimate } = await import(
      '../execution/tokenEstimate'
    );
    const text = 'const run = () => execute();';
    const provider = normalizeProviderForEstimate('github-copilot', 'gpt-4o');

    expect(estimateTokens(text, { provider, model: 'gpt-4o', kind: 'code' })).toBe(
      Math.ceil(text.length / 3.2),
    );
  });
});
