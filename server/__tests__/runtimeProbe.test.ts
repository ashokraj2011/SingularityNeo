// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const validateCopilotCliEndpoint = vi.fn();
const validateLocalOpenAIChatProvider = vi.fn();
const getStoredRuntimeProviderConfig = vi.fn();
const validateCliRuntimeProvider = vi.fn();
const getConfiguredRuntimeProviderStatus = vi.fn();

vi.mock('../githubModels', () => ({
  validateCopilotCliEndpoint,
}));

vi.mock('../localOpenAIProvider', () => ({
  validateLocalOpenAIChatProvider,
}));

vi.mock('../runtimeProviderConfig', () => ({
  getStoredRuntimeProviderConfig,
}));

vi.mock('../runtimeCli', () => ({
  validateCliRuntimeProvider,
}));

vi.mock('../runtimeProviders', () => ({
  getConfiguredRuntimeProviderStatus,
}));

describe('runtimeProbe', () => {
  beforeEach(() => {
    vi.resetModules();
    validateCopilotCliEndpoint.mockReset();
    validateLocalOpenAIChatProvider.mockReset();
    getStoredRuntimeProviderConfig.mockReset();
    validateCliRuntimeProvider.mockReset();
    getConfiguredRuntimeProviderStatus.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns a detected local SDK endpoint for GitHub Copilot when one responds', async () => {
    validateCopilotCliEndpoint.mockResolvedValue({
      cliUrl: 'http://127.0.0.1:4321',
      message: 'Connected to local SDK session.',
      models: [],
    });
    getConfiguredRuntimeProviderStatus.mockResolvedValue({
      configured: false,
    });

    const { probeRuntimeProvider } = await import('../runtimeProbe');
    const result = await probeRuntimeProvider({
      providerKey: 'github-copilot',
    });

    expect(result.ok).toBe(true);
    expect(result.detectedEndpoint).toBe('http://127.0.0.1:4321');
    expect(result.preferencePatch).toMatchObject({
      copilotCliUrl: 'http://127.0.0.1:4321',
    });
  });

  it('accepts the configured HTTP runtime when no local SDK endpoint is reachable', async () => {
    validateCopilotCliEndpoint.mockRejectedValue(new Error('connect ECONNREFUSED'));
    getConfiguredRuntimeProviderStatus.mockResolvedValue({
      configured: true,
      transportMode: 'http-api',
      endpoint: 'https://models.github.ai/inference',
      validation: {
        providerKey: 'github-copilot',
        ok: true,
        status: 'configured',
        message: 'GitHub Models token is configured.',
        transportMode: 'http-api',
      },
    });

    const { probeRuntimeProvider } = await import('../runtimeProbe');
    const result = await probeRuntimeProvider({
      providerKey: 'github-copilot',
    });

    expect(result.ok).toBe(true);
    expect(result.detectedEndpoint).toBe('https://models.github.ai/inference');
    expect(result.message).toContain('GitHub Models HTTP runtime');
  });

  it('passes command and model hints through to CLI validation', async () => {
    getStoredRuntimeProviderConfig.mockResolvedValue({
      profile: 'default',
    });
    validateCliRuntimeProvider.mockResolvedValue({
      providerKey: 'codex-cli',
      ok: true,
      status: 'configured',
      message: 'Codex CLI is ready.',
      transportMode: 'desktop-cli',
      detectedCommand: 'codex',
      checkedAt: new Date().toISOString(),
    });

    const { probeRuntimeProvider } = await import('../runtimeProbe');
    const result = await probeRuntimeProvider({
      providerKey: 'codex-cli',
      commandHint: 'codex',
      modelHint: 'gpt-5-codex',
    });

    expect(validateCliRuntimeProvider).toHaveBeenCalledWith({
      providerKey: 'codex-cli',
      config: expect.objectContaining({
        command: 'codex',
        model: 'gpt-5-codex',
        profile: 'default',
      }),
    });
    expect(result.detectedCommand).toBe('codex');
  });
});
