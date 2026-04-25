import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearRuntimeTokenOverride,
  type RuntimeGitHubIdentity,
  validateGitHubRuntimeToken,
} from './githubModels';
import { validateLocalOpenAIEmbeddingProvider } from './localOpenAIProvider';

const RUNTIME_TOKEN_ENV_KEY = 'GITHUB_MODELS_TOKEN';
const LOCAL_EMBEDDING_BASE_URL_ENV_KEY = 'LOCAL_OPENAI_BASE_URL';
const LOCAL_EMBEDDING_API_KEY_ENV_KEY = 'LOCAL_OPENAI_API_KEY';
const LOCAL_EMBEDDING_MODEL_ENV_KEY = 'LOCAL_OPENAI_EMBEDDING_MODEL';
const moduleDirname = path.dirname(fileURLToPath(import.meta.url));

const upsertEnvLine = (contents: string, key: string, value: string) => {
  const nextLine = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');

  if (pattern.test(contents)) {
    return contents.replace(pattern, nextLine);
  }

  const suffix = contents.endsWith('\n') || contents.length === 0 ? '' : '\n';
  return `${contents}${suffix}${nextLine}\n`;
};

const removeEnvLine = (contents: string, key: string) => {
  const pattern = new RegExp(`^${key}=.*(?:\\n|$)`, 'gm');
  return contents.replace(pattern, '').replace(/\n{3,}/g, '\n\n');
};

const setRuntimeEnvToken = (token?: string | null) => {
  const nextToken = String(token || '').trim();
  if (nextToken) {
    process.env.GITHUB_MODELS_TOKEN = nextToken;
    return;
  }

  delete process.env.GITHUB_MODELS_TOKEN;
};

const updateRuntimeEnvFile = async ({
  envFilePath,
  token,
}: {
  envFilePath: string;
  token?: string | null;
}) => {
  const trimmedToken = String(token || '').trim();
  let contents = '';
  if (fs.existsSync(envFilePath)) {
    contents = await fs.promises.readFile(envFilePath, 'utf8');
  } else {
    await fs.promises.mkdir(path.dirname(envFilePath), { recursive: true });
  }

  const nextContents = trimmedToken
    ? upsertEnvLine(contents, RUNTIME_TOKEN_ENV_KEY, trimmedToken)
    : removeEnvLine(contents, RUNTIME_TOKEN_ENV_KEY);

  if (!trimmedToken && !fs.existsSync(envFilePath) && nextContents.length === 0) {
    return;
  }

  if (nextContents === contents) {
    return;
  }

  await fs.promises.writeFile(envFilePath, nextContents, 'utf8');
};

export const resolveRuntimeEnvLocalPath = (appRoot = path.resolve(moduleDirname, '..')) =>
  path.join(appRoot, '.env.local');

export const persistRuntimeTokenAndValidate = async ({
  token,
  envFilePath,
}: {
  token: string;
  envFilePath: string;
}): Promise<{
  identity: RuntimeGitHubIdentity | null;
  identityError: string | null;
}> => {
  const trimmedToken = String(token || '').trim();
  if (!trimmedToken) {
    throw new Error('A GitHub token is required.');
  }

  try {
    const validation = await validateGitHubRuntimeToken(trimmedToken);
    if (!validation.fromRuntime || validation.models.length === 0) {
      throw new Error(
        validation.error ||
          'GitHub Models could not be validated with this token in this environment.',
      );
    }

    await updateRuntimeEnvFile({
      envFilePath,
      token: trimmedToken,
    });
    setRuntimeEnvToken(trimmedToken);
    await clearRuntimeTokenOverride();

    return {
      identity: validation.identity,
      identityError: validation.identityError,
    };
  } catch (error) {
    throw error;
  }
};

export const clearPersistedRuntimeToken = async ({
  envFilePath,
}: {
  envFilePath: string;
}) => {
  await updateRuntimeEnvFile({
    envFilePath,
    token: undefined,
  });
  setRuntimeEnvToken(undefined);
  await clearRuntimeTokenOverride();
};

const setLocalEmbeddingEnv = ({
  baseUrl,
  apiKey,
  model,
}: {
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
}) => {
  const nextBaseUrl = String(baseUrl || '').trim();
  const nextApiKey = String(apiKey || '').trim();
  const nextModel = String(model || '').trim();

  if (nextBaseUrl) {
    process.env.LOCAL_OPENAI_BASE_URL = nextBaseUrl;
  } else {
    delete process.env.LOCAL_OPENAI_BASE_URL;
  }

  if (nextApiKey) {
    process.env.LOCAL_OPENAI_API_KEY = nextApiKey;
  } else {
    delete process.env.LOCAL_OPENAI_API_KEY;
  }

  if (nextModel) {
    process.env.LOCAL_OPENAI_EMBEDDING_MODEL = nextModel;
  } else {
    delete process.env.LOCAL_OPENAI_EMBEDDING_MODEL;
  }
};

export const persistLocalEmbeddingSettingsAndValidate = async ({
  baseUrl,
  apiKey,
  model,
  envFilePath,
}: {
  baseUrl: string;
  apiKey?: string | null;
  model?: string | null;
  envFilePath: string;
}) => {
  const trimmedBaseUrl = String(baseUrl || '').trim();
  const trimmedApiKey = String(apiKey || '').trim();
  const trimmedModel = String(model || '').trim();

  if (!trimmedBaseUrl) {
    throw new Error('A local embedding base URL is required.');
  }

  const validation = await validateLocalOpenAIEmbeddingProvider({
    baseUrl: trimmedBaseUrl,
    apiKey: trimmedApiKey || 'local',
    model: trimmedModel || undefined,
  });

  let contents = '';
  if (fs.existsSync(envFilePath)) {
    contents = await fs.promises.readFile(envFilePath, 'utf8');
  } else {
    await fs.promises.mkdir(path.dirname(envFilePath), { recursive: true });
  }

  let nextContents = upsertEnvLine(contents, LOCAL_EMBEDDING_BASE_URL_ENV_KEY, validation.baseUrl);
  nextContents = trimmedApiKey
    ? upsertEnvLine(nextContents, LOCAL_EMBEDDING_API_KEY_ENV_KEY, trimmedApiKey)
    : removeEnvLine(nextContents, LOCAL_EMBEDDING_API_KEY_ENV_KEY);
  nextContents = trimmedModel
    ? upsertEnvLine(nextContents, LOCAL_EMBEDDING_MODEL_ENV_KEY, validation.model)
    : removeEnvLine(nextContents, LOCAL_EMBEDDING_MODEL_ENV_KEY);

  if (nextContents !== contents) {
    await fs.promises.writeFile(envFilePath, nextContents, 'utf8');
  }

  setLocalEmbeddingEnv({
    baseUrl: validation.baseUrl,
    apiKey: trimmedApiKey,
    model: trimmedModel ? validation.model : undefined,
  });

  return validation;
};

export const clearPersistedLocalEmbeddingSettings = async ({
  envFilePath,
}: {
  envFilePath: string;
}) => {
  let contents = '';
  if (fs.existsSync(envFilePath)) {
    contents = await fs.promises.readFile(envFilePath, 'utf8');
  }

  let nextContents = removeEnvLine(contents, LOCAL_EMBEDDING_BASE_URL_ENV_KEY);
  nextContents = removeEnvLine(nextContents, LOCAL_EMBEDDING_API_KEY_ENV_KEY);
  nextContents = removeEnvLine(nextContents, LOCAL_EMBEDDING_MODEL_ENV_KEY);

  if (nextContents !== contents) {
    await fs.promises.writeFile(envFilePath, nextContents, 'utf8');
  }

  setLocalEmbeddingEnv({
    baseUrl: undefined,
    apiKey: undefined,
    model: undefined,
  });
};
