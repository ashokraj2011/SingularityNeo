import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderKey, RuntimeProviderConfig } from '../src/types';

type StoredRuntimeProviderConfigState = {
  version: 1;
  defaultProviderKey?: ProviderKey;
  providers?: Partial<Record<ProviderKey, RuntimeProviderConfig>>;
};

const moduleDirname = path.dirname(fileURLToPath(import.meta.url));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const trimString = (value: unknown) => {
  const normalized = String(value || '').trim();
  return normalized || undefined;
};

const normalizeEnvMap = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .map(([key, raw]) => [String(key || '').trim(), String(raw || '').trim()] as const)
    .filter(([key, raw]) => key && raw);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

const sanitizeRuntimeProviderConfig = (value: unknown): RuntimeProviderConfig | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const nextConfig: RuntimeProviderConfig = {
    command: trimString(value.command),
    cliUrl: trimString(value.cliUrl),
    model: trimString(value.model),
    profile: trimString(value.profile),
    workingMode: trimString(value.workingMode) as RuntimeProviderConfig['workingMode'],
    enabled:
      value.enabled === undefined || value.enabled === null
        ? undefined
        : Boolean(value.enabled),
    env: normalizeEnvMap(value.env),
    updatedAt: trimString(value.updatedAt),
  };

  if (!Object.values(nextConfig).some(Boolean)) {
    return undefined;
  }

  return nextConfig;
};

const sanitizeStoredState = (value: unknown): StoredRuntimeProviderConfigState => {
  if (!isRecord(value)) {
    return { version: 1, providers: {} };
  }

  const defaultProviderKey = trimString(value.defaultProviderKey) as ProviderKey | undefined;
  const providerEntries = isRecord(value.providers)
    ? Object.entries(value.providers)
        .map(([providerKey, rawConfig]) => [
          providerKey as ProviderKey,
          sanitizeRuntimeProviderConfig(rawConfig),
        ] as const)
        .filter((entry): entry is [ProviderKey, RuntimeProviderConfig] => Boolean(entry[1]))
    : [];

  return {
    version: 1,
    defaultProviderKey,
    providers: Object.fromEntries(providerEntries),
  };
};

export const resolveRuntimeProviderConfigPath = (
  appRoot = path.resolve(moduleDirname, '..'),
) => path.join(appRoot, '.runtime-providers.local.json');

export const readRuntimeProviderConfigStateSync = ({
  configPath = resolveRuntimeProviderConfigPath(),
}: {
  configPath?: string;
} = {}): StoredRuntimeProviderConfigState => {
  try {
    if (!fs.existsSync(configPath)) {
      return { version: 1, providers: {} };
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
    return sanitizeStoredState(parsed);
  } catch {
    return { version: 1, providers: {} };
  }
};

export const readRuntimeProviderConfigState = async ({
  configPath = resolveRuntimeProviderConfigPath(),
}: {
  configPath?: string;
} = {}): Promise<StoredRuntimeProviderConfigState> => {
  try {
    if (!fs.existsSync(configPath)) {
      return { version: 1, providers: {} };
    }

    const parsed = JSON.parse(await fs.promises.readFile(configPath, 'utf8')) as unknown;
    return sanitizeStoredState(parsed);
  } catch {
    return { version: 1, providers: {} };
  }
};

export const getConfiguredDefaultRuntimeProviderKeySync = ({
  configPath = resolveRuntimeProviderConfigPath(),
}: {
  configPath?: string;
} = {}): ProviderKey | undefined =>
  readRuntimeProviderConfigStateSync({ configPath }).defaultProviderKey;

export const getStoredRuntimeProviderConfigSync = ({
  providerKey,
  configPath = resolveRuntimeProviderConfigPath(),
}: {
  providerKey: ProviderKey;
  configPath?: string;
}): RuntimeProviderConfig | undefined =>
  readRuntimeProviderConfigStateSync({ configPath }).providers?.[providerKey];

export const getStoredRuntimeProviderConfig = async ({
  providerKey,
  configPath = resolveRuntimeProviderConfigPath(),
}: {
  providerKey: ProviderKey;
  configPath?: string;
}): Promise<RuntimeProviderConfig | undefined> =>
  (await readRuntimeProviderConfigState({ configPath })).providers?.[providerKey];

const writeRuntimeProviderConfigState = async ({
  state,
  configPath = resolveRuntimeProviderConfigPath(),
}: {
  state: StoredRuntimeProviderConfigState;
  configPath?: string;
}) => {
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await fs.promises.writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: 1,
        defaultProviderKey: state.defaultProviderKey,
        providers: state.providers || {},
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
};

export const saveRuntimeProviderConfig = async ({
  providerKey,
  config,
  setDefault,
  configPath = resolveRuntimeProviderConfigPath(),
}: {
  providerKey: ProviderKey;
  config: RuntimeProviderConfig;
  setDefault?: boolean;
  configPath?: string;
}) => {
  const state = await readRuntimeProviderConfigState({ configPath });
  const providers = { ...(state.providers || {}) };
  const sanitized = sanitizeRuntimeProviderConfig({
    ...config,
    updatedAt: new Date().toISOString(),
  });

  if (sanitized) {
    providers[providerKey] = sanitized;
  } else {
    delete providers[providerKey];
  }

  const nextState: StoredRuntimeProviderConfigState = {
    version: 1,
    defaultProviderKey: setDefault ? providerKey : state.defaultProviderKey,
    providers,
  };
  await writeRuntimeProviderConfigState({ state: nextState, configPath });
  return nextState;
};

export const clearRuntimeProviderConfig = async ({
  providerKey,
  clearDefault,
  configPath = resolveRuntimeProviderConfigPath(),
}: {
  providerKey: ProviderKey;
  clearDefault?: boolean;
  configPath?: string;
}) => {
  const state = await readRuntimeProviderConfigState({ configPath });
  const providers = { ...(state.providers || {}) };
  delete providers[providerKey];

  const nextState: StoredRuntimeProviderConfigState = {
    version: 1,
    defaultProviderKey:
      clearDefault && state.defaultProviderKey === providerKey
        ? undefined
        : state.defaultProviderKey,
    providers,
  };
  await writeRuntimeProviderConfigState({ state: nextState, configPath });
  return nextState;
};

export const setDefaultRuntimeProviderKey = async ({
  providerKey,
  configPath = resolveRuntimeProviderConfigPath(),
}: {
  providerKey?: ProviderKey;
  configPath?: string;
}) => {
  const state = await readRuntimeProviderConfigState({ configPath });
  const nextState: StoredRuntimeProviderConfigState = {
    ...state,
    version: 1,
    defaultProviderKey: providerKey,
  };
  await writeRuntimeProviderConfigState({ state: nextState, configPath });
  return nextState;
};
