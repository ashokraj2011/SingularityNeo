// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('runtimeProviderConfig', () => {
  let tempDir = '';
  let configPath = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sing-runtime-provider-config-'));
    configPath = path.join(tempDir, '.runtime-providers.local.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists provider config and default selection locally', async () => {
    const {
      getConfiguredDefaultRuntimeProviderKeySync,
      readRuntimeProviderConfigState,
      saveRuntimeProviderConfig,
    } = await import('../runtimeProviderConfig');

    await saveRuntimeProviderConfig({
      providerKey: 'codex-cli',
      config: {
        command: 'codex',
        model: 'gpt-5-codex',
        workingMode: 'read-only',
      },
      setDefault: true,
      configPath,
    });

    const stored = await readRuntimeProviderConfigState({ configPath });
    expect(stored.defaultProviderKey).toBe('codex-cli');
    expect(stored.providers?.['codex-cli']).toMatchObject({
      command: 'codex',
      model: 'gpt-5-codex',
      workingMode: 'read-only',
    });
    expect(getConfiguredDefaultRuntimeProviderKeySync({ configPath })).toBe('codex-cli');
  });
});
