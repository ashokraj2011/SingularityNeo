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

vi.mock('../localOpenAIProvider', () => ({
  getLocalOpenAIBaseUrl: vi.fn(() => ''),
  getLocalOpenAIDefaultModel: vi.fn(() => 'local-model'),
  isLocalOpenAIConfigured: vi.fn(() => false),
  listLocalOpenAIModels: vi.fn(async () => []),
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

// `getConfiguredDefaultRuntimeProviderKey()` now reads `.llm-providers.local.json`
// FIRST so the Runtime Settings UI default takes effect across the app. Tests
// must mock this layer too — otherwise a non-empty user config file leaks
// through and clobbers the runtime-provider mock above.
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
    getStoredRuntimeProviderConfig.mockReset();
    getStoredRuntimeProviderConfigSync.mockReset();
    getConfiguredDefaultRuntimeProviderKeySync.mockReset();
    validateCliRuntimeProvider.mockClear();
    listCliProviderModels.mockClear();
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
});
