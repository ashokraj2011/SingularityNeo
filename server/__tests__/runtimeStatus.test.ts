// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeWorkspaceDatabaseBootstrapProfileSnapshot,
} from '../databaseProfiles';
import {
  getDatabaseRuntimeInfo,
  setDatabaseRuntimeConfig,
} from '../db';

vi.mock('../githubModels', () => ({
  defaultModel: 'gpt-5.4',
  getConfiguredGitHubIdentity: vi.fn(async () => ({ identity: null, error: null })),
  getConfiguredToken: vi.fn(() => null),
  getConfiguredTokenSource: vi.fn(() => null),
  getRuntimeDefaultModel: vi.fn(async () => 'gpt-5.4'),
  githubModelsApiUrl: 'https://models.github.test',
  listAvailableRuntimeModels: vi.fn(async () => ({
    models: [
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        profile: 'Balanced',
        apiModelId: 'gpt-5.4',
      },
    ],
    fromRuntime: false,
  })),
  normalizeModel: (value: string) => value,
}));

vi.mock('../executionOwnership', () => ({
  isDesktopExecutionRuntime: vi.fn(() => false),
}));

vi.mock('../localOpenAIProvider', () => ({
  getLocalOpenAIBaseUrl: vi.fn(() => ''),
  getLocalOpenAIDefaultModel: vi.fn(() => 'local-model'),
  isLocalOpenAIConfigured: vi.fn(() => false),
}));

vi.mock('../providerRegistry', () => ({
  DEFAULT_EMBEDDING_PROVIDER_KEY: 'local-openai',
  DEFAULT_PROVIDER_KEY: 'github-copilot',
  LOCAL_OPENAI_PROVIDER_KEY: 'local-openai',
  resolveProviderDisplayName: vi.fn((key: string) =>
    key === 'local-openai' ? 'Local OpenAI' : 'GitHub Copilot',
  ),
}));

vi.mock('../runtimePolicy', () => ({
  resolveRuntimeAccessMode: vi.fn(() => 'unconfigured'),
}));

describe('buildRuntimeStatus', () => {
  const originalEnv = { ...process.env };
  const originalRuntime = getDatabaseRuntimeInfo();
  const originalPassword = process.env.PGPASSWORD;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.WORKSPACE_DB_PROFILES_B64;
    delete process.env.WORKSPACE_ACTIVE_DB_PROFILE_ID;
    await setDatabaseRuntimeConfig({
      host: '127.0.0.1',
      port: 5432,
      databaseName: 'sing5',
      user: 'postgres',
      adminDatabaseName: 'postgres',
    });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await setDatabaseRuntimeConfig({
      host: originalRuntime.host,
      port: originalRuntime.port,
      databaseName: originalRuntime.databaseName,
      user: originalRuntime.user,
      adminDatabaseName: originalRuntime.adminDatabaseName,
      ...(originalPassword ? { password: originalPassword } : {}),
    });
  });

  it('includes the active runtime database and resolved saved profile', async () => {
    process.env.WORKSPACE_DB_PROFILES_B64 = encodeWorkspaceDatabaseBootstrapProfileSnapshot({
      activeProfileId: 'DBP-SING5',
      profiles: [
        {
          id: 'DBP-SING5',
          label: 'sing5 @ 127.0.0.1:5432',
          host: '127.0.0.1',
          port: 5432,
          databaseName: 'sing5',
          user: 'postgres',
          adminDatabaseName: 'postgres',
          lastUsedAt: '2026-04-19T00:00:00.000Z',
        },
      ],
    });
    process.env.WORKSPACE_ACTIVE_DB_PROFILE_ID = 'DBP-SING5';

    const { buildRuntimeStatus } = await import('../runtimeStatus');
    const status = await buildRuntimeStatus();

    expect(status.databaseRuntime).toMatchObject({
      host: '127.0.0.1',
      port: 5432,
      databaseName: 'sing5',
      user: 'postgres',
      adminDatabaseName: 'postgres',
    });
    expect(status.activeDatabaseProfileId).toBe('DBP-SING5');
    expect(status.activeDatabaseProfileLabel).toBe('sing5 @ 127.0.0.1:5432');
  });
});
