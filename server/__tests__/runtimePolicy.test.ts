// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  getMissingRuntimeConfigurationMessage,
  isHttpFallbackAllowed,
  resolveRuntimeAccessMode,
} from '../runtimePolicy';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('runtime policy', () => {
  it('makes headless CLI authoritative when configured', () => {
    process.env.COPILOT_CLI_URL = 'http://127.0.0.1:4321';
    delete process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK;

    expect(
      resolveRuntimeAccessMode({
        tokenSource: 'headless-cli',
        token: '',
        modelCatalogFromRuntime: true,
      }),
    ).toBe('sdk-session');
    expect(isHttpFallbackAllowed()).toBe(false);
  });

  it('allows HTTP fallback only when explicitly enabled in headless mode', () => {
    process.env.COPILOT_CLI_URL = 'http://127.0.0.1:4321';
    process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK = 'true';

    expect(isHttpFallbackAllowed()).toBe(true);
  });

  it('classifies token-only runtime as HTTP fallback when no runtime catalog is available', () => {
    delete process.env.COPILOT_CLI_URL;

    expect(
      resolveRuntimeAccessMode({
        tokenSource: 'GITHUB_MODELS_TOKEN',
        token: 'token',
        modelCatalogFromRuntime: false,
      }),
    ).toBe('http-api');
  });

  it('keeps the missing-runtime message stable for API and stream errors', () => {
    expect(getMissingRuntimeConfigurationMessage()).toMatch(
      /Start the desktop runtime|COPILOT_CLI_URL/,
    );
  });
});
