// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clearRuntimeTokenOverride = vi.fn(async () => undefined);
const validateGitHubRuntimeToken = vi.fn();
const validateLocalOpenAIEmbeddingProvider = vi.fn();

vi.mock('../githubModels', () => ({
  clearRuntimeTokenOverride,
  validateGitHubRuntimeToken,
}));

vi.mock('../localOpenAIProvider', () => ({
  validateLocalOpenAIEmbeddingProvider,
}));

describe('runtimeCredentials', () => {
  const originalEnv = { ...process.env };
  let tempDir = '';
  let envFilePath = '';

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sing-runtime-creds-'));
    envFilePath = path.join(tempDir, '.env.local');
    clearRuntimeTokenOverride.mockClear();
    validateGitHubRuntimeToken.mockReset();
    validateLocalOpenAIEmbeddingProvider.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists a validated token to .env.local and applies it to the process', async () => {
    validateGitHubRuntimeToken.mockResolvedValue({
      models: [{ id: 'gpt-4.1', label: 'GPT-4.1', profile: 'Balanced', apiModelId: 'gpt-4.1' }],
      fromRuntime: true,
      identity: {
        id: 1,
        login: 'octocat',
      },
      identityError: null,
      error: null,
    });

    const { persistRuntimeTokenAndValidate } = await import('../runtimeCredentials');
    const result = await persistRuntimeTokenAndValidate({
      token: 'ghp_live_token',
      envFilePath,
    });

    expect(result.identity?.login).toBe('octocat');
    expect(process.env.GITHUB_MODELS_TOKEN).toBe('ghp_live_token');
    expect(fs.readFileSync(envFilePath, 'utf8')).toContain('GITHUB_MODELS_TOKEN=ghp_live_token');
    expect(clearRuntimeTokenOverride).toHaveBeenCalledTimes(1);
  });

  it('leaves .env.local unchanged when validation fails', async () => {
    fs.writeFileSync(envFilePath, 'OTHER_KEY=keep-me\nGITHUB_MODELS_TOKEN=old_token\n', 'utf8');
    process.env.GITHUB_MODELS_TOKEN = 'old_token';
    validateGitHubRuntimeToken.mockResolvedValue({
      models: [],
      fromRuntime: false,
      identity: null,
      identityError: 'Bad credentials',
      error:
        'GitHub Models did not return a live model catalog for this token in the current environment.',
    });

    const { persistRuntimeTokenAndValidate } = await import('../runtimeCredentials');

    await expect(
      persistRuntimeTokenAndValidate({
        token: 'bad_token',
        envFilePath,
      }),
    ).rejects.toThrow(
      'GitHub Models did not return a live model catalog for this token in the current environment.',
    );

    expect(process.env.GITHUB_MODELS_TOKEN).toBe('old_token');
    expect(fs.readFileSync(envFilePath, 'utf8')).toContain('GITHUB_MODELS_TOKEN=old_token');
    expect(clearRuntimeTokenOverride).not.toHaveBeenCalled();
  });

  it('removes the persisted token from .env.local when cleared', async () => {
    fs.writeFileSync(envFilePath, 'OTHER_KEY=keep-me\nGITHUB_MODELS_TOKEN=old_token\n', 'utf8');
    process.env.GITHUB_MODELS_TOKEN = 'old_token';

    const { clearPersistedRuntimeToken } = await import('../runtimeCredentials');
    await clearPersistedRuntimeToken({ envFilePath });

    const nextContents = fs.readFileSync(envFilePath, 'utf8');
    expect(nextContents).toContain('OTHER_KEY=keep-me');
    expect(nextContents).not.toContain('GITHUB_MODELS_TOKEN=');
    expect(process.env.GITHUB_MODELS_TOKEN).toBeUndefined();
    expect(clearRuntimeTokenOverride).toHaveBeenCalledTimes(1);
  });

  it('persists validated local embedding settings to .env.local and applies them to the process', async () => {
    validateLocalOpenAIEmbeddingProvider.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'nomic-embed-text',
    });

    const { persistLocalEmbeddingSettingsAndValidate } = await import('../runtimeCredentials');
    const result = await persistLocalEmbeddingSettingsAndValidate({
      baseUrl: 'http://127.0.0.1:11434/v1/',
      apiKey: 'local',
      model: 'nomic-embed-text',
      envFilePath,
    });

    expect(result.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(result.model).toBe('nomic-embed-text');
    expect(process.env.LOCAL_OPENAI_BASE_URL).toBe('http://127.0.0.1:11434/v1');
    expect(process.env.LOCAL_OPENAI_API_KEY).toBe('local');
    expect(process.env.LOCAL_OPENAI_EMBEDDING_MODEL).toBe('nomic-embed-text');
    const nextContents = fs.readFileSync(envFilePath, 'utf8');
    expect(nextContents).toContain('LOCAL_OPENAI_BASE_URL=http://127.0.0.1:11434/v1');
    expect(nextContents).toContain('LOCAL_OPENAI_API_KEY=local');
    expect(nextContents).toContain('LOCAL_OPENAI_EMBEDDING_MODEL=nomic-embed-text');
  });

  it('clears persisted local embedding settings from .env.local and the process', async () => {
    fs.writeFileSync(
      envFilePath,
      [
        'OTHER_KEY=keep-me',
        'LOCAL_OPENAI_BASE_URL=http://127.0.0.1:11434/v1',
        'LOCAL_OPENAI_API_KEY=local',
        'LOCAL_OPENAI_EMBEDDING_MODEL=nomic-embed-text',
        '',
      ].join('\n'),
      'utf8',
    );
    process.env.LOCAL_OPENAI_BASE_URL = 'http://127.0.0.1:11434/v1';
    process.env.LOCAL_OPENAI_API_KEY = 'local';
    process.env.LOCAL_OPENAI_EMBEDDING_MODEL = 'nomic-embed-text';

    const { clearPersistedLocalEmbeddingSettings } = await import('../runtimeCredentials');
    await clearPersistedLocalEmbeddingSettings({ envFilePath });

    const nextContents = fs.readFileSync(envFilePath, 'utf8');
    expect(nextContents).toContain('OTHER_KEY=keep-me');
    expect(nextContents).not.toContain('LOCAL_OPENAI_BASE_URL=');
    expect(nextContents).not.toContain('LOCAL_OPENAI_API_KEY=');
    expect(nextContents).not.toContain('LOCAL_OPENAI_EMBEDDING_MODEL=');
    expect(process.env.LOCAL_OPENAI_BASE_URL).toBeUndefined();
    expect(process.env.LOCAL_OPENAI_API_KEY).toBeUndefined();
    expect(process.env.LOCAL_OPENAI_EMBEDDING_MODEL).toBeUndefined();
  });
});
