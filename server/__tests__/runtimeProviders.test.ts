// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getConfiguredGitHubIdentity = vi.fn(async () => ({
  identity: { id: 1, login: 'octocat' },
  error: null,
}));
const getConfiguredToken = vi.fn(() => 'ghp_live');
const getConfiguredTokenSource = vi.fn(() => 'GITHUB_MODELS_TOKEN');
const getRuntimeDefaultModel = vi.fn(async () => 'gpt-4.1');
const listAvailableRuntimeModels = vi.fn(async () => ({
  models: [
    {
      id: 'gpt-4.1',
      label: 'GPT-4.1',
      profile: 'Balanced',
      apiModelId: 'gpt-4.1',
    },
  ],
  fromRuntime: true,
}));

vi.mock('../githubModels', () => ({
  defaultModel: 'gpt-4.1-mini',
  getConfiguredGitHubIdentity,
  getConfiguredToken,
  getConfiguredTokenSource,
  getRuntimeDefaultModel,
  githubModelsApiUrl: 'https://models.github.test',
  listAvailableRuntimeModels,
  normalizeModel: (value: string) => value,
}));

const getLocalOpenAIBaseUrl = vi.fn(() => '');
const getLocalOpenAIDefaultModel = vi.fn(() => 'local-model');
const isLocalOpenAIConfigured = vi.fn(() => false);
const listLocalOpenAIModels = vi.fn(async () => []);

vi.mock('../localOpenAIProvider', () => ({
  getLocalOpenAIBaseUrl,
  getLocalOpenAIDefaultModel,
  isLocalOpenAIConfigured,
  listLocalOpenAIModels,
}));

const getStoredRuntimeProviderConfig = vi.fn(async () => undefined);
const getStoredRuntimeProviderConfigSync = vi.fn(() => undefined);
const getConfiguredDefaultRuntimeProviderKeySync = vi.fn(() => 'codex-cli');
const saveRuntimeProviderConfig = vi.fn(async () => undefined);
const setDefaultRuntimeProviderKey = vi.fn(async () => undefined);

vi.mock('../runtimeProviderConfig', () => ({
  getStoredRuntimeProviderConfig,
  getStoredRuntimeProviderConfigSync,
  getConfiguredDefaultRuntimeProviderKeySync,
  saveRuntimeProviderConfig,
  setDefaultRuntimeProviderKey,
}));

const getDefaultLLMProviderKey = vi.fn(() => undefined);
const getLLMProviderConfig = vi.fn(() => undefined);
vi.mock('../llmProviderConfig', () => ({
  getDefaultLLMProviderKey,
  getLLMProviderConfig,
  readLLMProviderConfigStateSync: () => ({ version: 1, providers: {} }),
  readLLMProviderConfigState: async () => ({ version: 1, providers: {} }),
  saveLLMProviderConfig: async () => undefined,
  setDefaultLLMProviderKey: async () => undefined,
  resolveLLMProviderConfigPath: () => '/tmp/test-llm-providers.json',
}));

const validateCliRuntimeProvider = vi.fn(async () => ({
  providerKey: 'codex-cli',
  ok: true,
  status: 'configured',
  message: 'CLI binary and local login session are valid.',
  transportMode: 'desktop-cli',
  detectedCommand: 'codex',
  installed: true,
  authenticated: true,
  workingDirectoryAllowed: true,
  usageEstimated: true,
  models: [
    {
      id: 'gpt-5-codex',
      label: 'gpt-5-codex',
      profile: 'Codex CLI configured model',
      apiModelId: 'gpt-5-codex',
    },
  ],
  checkedAt: new Date().toISOString(),
}));
const listCliProviderModels = vi.fn(async () => [
  {
    id: 'gpt-5-codex',
    label: 'gpt-5-codex',
    profile: 'Codex CLI configured model',
    apiModelId: 'gpt-5-codex',
  },
]);

vi.mock('../runtimeCli', () => ({
  validateCliRuntimeProvider,
  listCliProviderModels,
}));

describe('runtimeProviders', () => {
  beforeEach(() => {
    vi.resetModules();
    getStoredRuntimeProviderConfig.mockReset();
    getStoredRuntimeProviderConfigSync.mockReset();
    getConfiguredDefaultRuntimeProviderKeySync.mockReset();
    validateCliRuntimeProvider.mockClear();
    listCliProviderModels.mockClear();
    getLocalOpenAIBaseUrl.mockReset();
    getLocalOpenAIDefaultModel.mockReset();
    isLocalOpenAIConfigured.mockReset();
    listLocalOpenAIModels.mockReset();
    getConfiguredDefaultRuntimeProviderKeySync.mockReturnValue('codex-cli');
    getStoredRuntimeProviderConfig.mockImplementation(async ({ providerKey }: { providerKey: string }) =>
      providerKey === 'codex-cli'
        ? {
            command: 'codex',
            model: 'gpt-5-codex',
            workingMode: 'read-only',
            enabled: true,
          }
        : undefined,
    );
    getStoredRuntimeProviderConfigSync.mockImplementation(({ providerKey }: { providerKey: string }) =>
      providerKey === 'codex-cli'
        ? {
            command: 'codex',
            model: 'gpt-5-codex',
            workingMode: 'read-only',
            enabled: true,
          }
        : undefined,
    );
    getLocalOpenAIBaseUrl.mockReturnValue('');
    getLocalOpenAIDefaultModel.mockReturnValue('local-model');
    isLocalOpenAIConfigured.mockReturnValue(false);
    listLocalOpenAIModels.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefers the configured desktop default provider when it is valid', async () => {
    const { listRuntimeProviderStatuses, resolveSelectedRuntimeProvider } = await import('../runtimeProviders');

    const selected = await resolveSelectedRuntimeProvider();
    const providers = await listRuntimeProviderStatuses();

    expect(selected.key).toBe('codex-cli');
    expect(providers.find(provider => provider.key === 'codex-cli')?.defaultSelected).toBe(true);
  });

  it('falls back to the first configured provider when the desktop default is unavailable', async () => {
    getConfiguredDefaultRuntimeProviderKeySync.mockReturnValue('claude-code-cli');
    getStoredRuntimeProviderConfig.mockResolvedValueOnce(undefined);
    getStoredRuntimeProviderConfigSync.mockReturnValue(undefined);
    validateCliRuntimeProvider.mockResolvedValue({
      providerKey: 'claude-code-cli',
      ok: false,
      status: 'missing',
      message: 'Configure a command path for Claude Code CLI.',
      transportMode: 'desktop-cli',
      installed: false,
      authenticated: null,
      workingDirectoryAllowed: null,
      usageEstimated: true,
      checkedAt: new Date().toISOString(),
    });

    const { resolveSelectedRuntimeProvider } = await import('../runtimeProviders');
    const selected = await resolveSelectedRuntimeProvider();

    expect(selected.key).toBe('github-copilot');
  });

  it('marks local-openai invalid when the endpoint is OpenAI but the model looks local', async () => {
    getConfiguredDefaultRuntimeProviderKeySync.mockReturnValue('local-openai');
    getLocalOpenAIBaseUrl.mockReturnValue('https://api.openai.com/v1');
    getLocalOpenAIDefaultModel.mockReturnValue('qwen2.5-coder:7b');
    isLocalOpenAIConfigured.mockReturnValue(true);
    listLocalOpenAIModels.mockResolvedValue([
      {
        id: 'gpt-4.1-mini',
        label: 'gpt-4.1-mini',
        profile: 'OpenAI',
        apiModelId: 'gpt-4.1-mini',
      },
    ]);

    const { getConfiguredRuntimeProviderStatus } = await import('../runtimeProviders');
    const status = await getConfiguredRuntimeProviderStatus('local-openai');

    expect(status.configured).toBe(false);
    expect(status.validation?.status).toBe('invalid');
    expect(status.validation?.message).toContain('api.openai.com');
    expect(status.validation?.message).toContain('qwen2.5-coder:7b');
  });
});
