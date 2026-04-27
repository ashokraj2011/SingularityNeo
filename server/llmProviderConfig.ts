import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderKey } from '../src/types';

export interface LLMProviderConfig {
  label?: string;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  updatedAt?: string;
}

type StoredLLMProviderConfigState = {
  version: 1;
  defaultProviderKey?: ProviderKey;
  providers?: Partial<Record<ProviderKey, LLMProviderConfig>>;
};

const moduleDirname = path.dirname(fileURLToPath(import.meta.url));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const trimString = (value: unknown) => {
  const normalized = String(value || '').trim();
  return normalized || undefined;
};

const sanitizeLLMProviderConfig = (value: unknown): LLMProviderConfig | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const nextConfig: LLMProviderConfig = {
    label: trimString(value.label),
    baseUrl: trimString(value.baseUrl),
    apiKey: trimString(value.apiKey),
    defaultModel: trimString(value.defaultModel),
    updatedAt: trimString(value.updatedAt),
  };

  if (!Object.values(nextConfig).some(Boolean)) {
    return undefined;
  }

  return nextConfig;
};

const sanitizeStoredState = (value: unknown): StoredLLMProviderConfigState => {
  if (!isRecord(value)) {
    return { version: 1, providers: {} };
  }

  const defaultProviderKey = trimString(value.defaultProviderKey) as ProviderKey | undefined;
  const providerEntries = isRecord(value.providers)
    ? Object.entries(value.providers)
        .map(([providerKey, rawConfig]) => [
          providerKey as ProviderKey,
          sanitizeLLMProviderConfig(rawConfig),
        ] as const)
        .filter((entry): entry is [ProviderKey, LLMProviderConfig] => Boolean(entry[1]))
    : [];

  return {
    version: 1,
    defaultProviderKey,
    providers: Object.fromEntries(providerEntries),
  };
};

export const resolveLLMProviderConfigPath = (
  appRoot = path.resolve(moduleDirname, '..'),
) => path.join(appRoot, '.llm-providers.local.json');

export const readLLMProviderConfigStateSync = ({
  configPath = resolveLLMProviderConfigPath(),
}: {
  configPath?: string;
} = {}): StoredLLMProviderConfigState => {
  try {
    if (!fs.existsSync(configPath)) {
      return { version: 1, providers: {} };
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
    return sanitizeStoredState(parsed);
  } catch (error) {
    console.error(`Failed to read LLM provider config from ${configPath}:`, error);
    return { version: 1, providers: {} };
  }
};

export const readLLMProviderConfigState = async ({
  configPath = resolveLLMProviderConfigPath(),
}: {
  configPath?: string;
} = {}): Promise<StoredLLMProviderConfigState> => {
  try {
    if (!fs.existsSync(configPath)) {
      return { version: 1, providers: {} };
    }

    const content = await fs.promises.readFile(configPath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return sanitizeStoredState(parsed);
  } catch (error) {
    console.error(`Failed to read LLM provider config from ${configPath}:`, error);
    return { version: 1, providers: {} };
  }
};

export const saveLLMProviderConfig = async ({
  providerKey,
  config,
  setDefault = false,
  configPath = resolveLLMProviderConfigPath(),
}: {
  providerKey: ProviderKey;
  config: LLMProviderConfig;
  setDefault?: boolean;
  configPath?: string;
}): Promise<void> => {
  try {
    const currentState = await readLLMProviderConfigState({ configPath });

    const nextState: StoredLLMProviderConfigState = {
      version: 1,
      defaultProviderKey: setDefault ? providerKey : currentState.defaultProviderKey,
      providers: {
        ...currentState.providers,
        [providerKey]: {
          ...config,
          updatedAt: new Date().toISOString(),
        },
      },
    };

    await fs.promises.writeFile(configPath, JSON.stringify(nextState, null, 2), 'utf8');
  } catch (error) {
    console.error(`Failed to save LLM provider config:`, error);
    throw error;
  }
};

export const setDefaultLLMProviderKey = async ({
  providerKey,
  configPath = resolveLLMProviderConfigPath(),
}: {
  providerKey: ProviderKey;
  configPath?: string;
}): Promise<void> => {
  try {
    const currentState = await readLLMProviderConfigState({ configPath });

    const nextState: StoredLLMProviderConfigState = {
      ...currentState,
      defaultProviderKey: providerKey,
    };

    await fs.promises.writeFile(configPath, JSON.stringify(nextState, null, 2), 'utf8');
  } catch (error) {
    console.error(`Failed to set default LLM provider key:`, error);
    throw error;
  }
};

export const getLLMProviderConfig = (
  providerKey: ProviderKey,
  configPath?: string,
): LLMProviderConfig | undefined => {
  const state = readLLMProviderConfigStateSync({ configPath });
  return state.providers?.[providerKey];
};

export const getDefaultLLMProviderKey = (
  configPath?: string,
): ProviderKey | undefined => {
  const state = readLLMProviderConfigStateSync({ configPath });
  return state.defaultProviderKey;
};
