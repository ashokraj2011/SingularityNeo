import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  CopilotClient,
  approveAll,
  type AssistantMessageEvent,
  type CopilotSession,
  type ModelInfo,
  type SessionEvent,
  type SessionConfig,
} from '@github/copilot-sdk';
import type {
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityMetadataEntry,
  CapabilityStakeholder,
} from '../src/types';
import {
  findAgentSessionRecord,
  upsertAgentSessionRecord,
} from './agentLearning/repository';
import {
  getConfiguredCopilotCliUrl,
  getMissingRuntimeConfigurationMessage,
  isHeadlessCliConfigured,
  isHttpFallbackAllowed,
} from './runtimePolicy';

export type ChatHistoryMessage = {
  role?: 'user' | 'agent';
  content?: string;
};

type InferenceUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type CopilotUsageEvent = Extract<SessionEvent, { type: 'assistant.usage' }>;

export type GitHubModelsMessage = {
  role: 'developer' | 'system' | 'user' | 'assistant';
  content: string;
};

type SessionExchangeResult = {
  content: string;
  model: string;
  usage: ReturnType<typeof toUsage>;
  responseId: string | null;
  createdAt: string;
  raw: {
    assistantMessage: AssistantMessageEvent | null;
    usageEvent: CopilotUsageEvent | null;
  };
};

type ManagedChatSessionRecord = {
  sessionId: string;
  session: CopilotSession;
  fingerprint: string;
  capabilityId?: string;
  capabilityName?: string;
  agentId?: string;
  agentName?: string;
  scope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
  model?: string;
  createdAt: string;
  lastUsedAt: string;
};

export class GitHubProviderRateLimitError extends Error {
  retryAfterMs: number;
  statusCode?: number;

  constructor(message: string, retryAfterMs = 30_000, statusCode?: number) {
    super(message);
    this.name = 'GitHubProviderRateLimitError';
    this.retryAfterMs = retryAfterMs;
    this.statusCode = statusCode;
  }
}

export type RuntimeTokenSource =
  | 'headless-cli'
  | 'runtime-override'
  | 'GITHUB_MODELS_TOKEN'
  | 'GITHUB_TOKEN'
  | null;

export type RuntimeGitHubIdentity = {
  id: number;
  login: string;
  name?: string;
  avatarUrl?: string;
  profileUrl?: string;
  type?: string;
};

export const githubModelsApiUrl =
  getConfiguredCopilotCliUrl() ||
  process.env.GITHUB_MODELS_API_URL ||
  'copilot-sdk://embedded-cli';

const githubModelsHttpApiUrl = (
  process.env.GITHUB_MODELS_HTTP_API_URL ||
  (githubModelsApiUrl.startsWith('http')
    ? githubModelsApiUrl
    : 'https://models.github.ai/inference')
).replace(/\/$/, '');

export const defaultModel = 'gpt-4.1-mini';

export const staticModels = [
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', profile: 'Lower cost' },
  { id: 'gpt-4.1', label: 'GPT-4.1', profile: 'Balanced reasoning' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', profile: 'Fast multimodal' },
  { id: 'gpt-4o', label: 'GPT-4o', profile: 'Broader capability' },
] as const;

type RuntimeModelOption = {
  id: string;
  label: string;
  profile: string;
  apiModelId: string;
};

const modelAliases: Record<string, string> = {
  'openai/gpt-4.1-mini': 'gpt-4.1-mini',
  'gpt-4.1-mini': 'gpt-4.1-mini',
  'openai/gpt-4.1': 'gpt-4.1',
  'gpt-4.1': 'gpt-4.1',
  'openai/gpt-4o-mini': 'gpt-4o-mini',
  'gpt-4o-mini': 'gpt-4o-mini',
  'openai/gpt-4o': 'gpt-4o',
  'gpt-4o': 'gpt-4o',
  'openai/o4-mini': 'o4-mini',
  'o4-mini': 'o4-mini',
  'openai/o3': 'o3',
  o3: 'o3',
};

const managedChatSessions = new Map<string, ManagedChatSessionRecord>();
const sessionLocks = new Map<string, Promise<unknown>>();

let copilotClient: CopilotClient | null = null;
let copilotClientPromise: Promise<CopilotClient> | null = null;

const updateManagedSessionRecord = (
  sessionId: string,
  updates: Partial<Omit<ManagedChatSessionRecord, 'sessionId' | 'session' | 'fingerprint'>>,
) => {
  const current = managedChatSessions.get(sessionId);
  if (!current) {
    return;
  }

  managedChatSessions.set(sessionId, {
    ...current,
    ...updates,
  });
};

const evictManagedSessionRecord = async (sessionId?: string | null) => {
  if (!sessionId) {
    return;
  }

  const existing = managedChatSessions.get(sessionId);
  managedChatSessions.delete(sessionId);
  await disconnectSessionQuietly(existing?.session);
};

export const listManagedCopilotSessions = () =>
  [...managedChatSessions.values()].map(record => ({
    sessionId: record.sessionId,
    fingerprint: record.fingerprint,
    capabilityId: record.capabilityId,
    capabilityName: record.capabilityName,
    agentId: record.agentId,
    agentName: record.agentName,
    scope: record.scope,
    scopeId: record.scopeId,
    model: record.model,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  }));
let runtimeTokenOverride: string | null = null;
let runtimeModelCache:
  | {
      fetchedAt: number;
      models: RuntimeModelOption[];
      fromRuntime: boolean;
    }
  | null = null;
let runtimeIdentityCache:
  | {
      fetchedAt: number;
      tokenHash: string;
      identity: RuntimeGitHubIdentity | null;
      error: string | null;
    }
  | null = null;

const toPromptSection = (label: string, values?: Array<string | undefined>) => {
  const content = (values || []).filter(Boolean).join(', ');
  return content ? `${label}: ${content}` : null;
};

const toStakeholderSection = (stakeholders?: CapabilityStakeholder[]) => {
  const content = (stakeholders || [])
    .filter(stakeholder => stakeholder.role || stakeholder.name || stakeholder.email)
    .map(stakeholder =>
      [
        stakeholder.role || 'Stakeholder',
        stakeholder.name || 'Unknown',
        stakeholder.teamName ? `team ${stakeholder.teamName}` : null,
        stakeholder.email ? `email ${stakeholder.email}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
    );

  return content.length > 0 ? `Stakeholders: ${content.join('; ')}` : null;
};

const toMetadataEntrySection = (entries?: CapabilityMetadataEntry[]) => {
  const content = (entries || [])
    .filter(entry => entry.key || entry.value)
    .map(entry => `${entry.key || 'Key'}=${entry.value || ''}`);

  return content.length > 0 ? `Additional metadata: ${content.join('; ')}` : null;
};

const hashText = (value: string) =>
  createHash('sha1').update(value).digest('hex').slice(0, 12);

const sanitizeSessionValue = (value?: string) =>
  (value || 'workspace').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48) || 'workspace';

const toTranscriptLine = (role: 'assistant' | 'user', content: string) =>
  `${role === 'assistant' ? 'Assistant' : 'User'}:\n${content}`;

const buildPromptFromConversation = ({
  conversation,
  includeHistory,
}: {
  conversation: Array<{ role: 'assistant' | 'user'; content: string }>;
  includeHistory: boolean;
}) => {
  const filteredConversation = conversation.filter(message => message.content.trim());
  if (filteredConversation.length === 0) {
    return '';
  }

  if (!includeHistory) {
    const latestUserMessage =
      [...filteredConversation].reverse().find(message => message.role === 'user') ||
      filteredConversation.at(-1);
    return latestUserMessage?.content?.trim() || '';
  }

  if (
    filteredConversation.length === 1 &&
    filteredConversation[0]?.role === 'user'
  ) {
    return filteredConversation[0].content.trim();
  }

  const transcript = filteredConversation
    .map(message => toTranscriptLine(message.role, message.content.trim()))
    .join('\n\n');

  return `Use the following conversation transcript as context.\n\n${transcript}\n\nRespond to the latest user request without repeating the transcript verbatim.`;
};

const splitMessages = (messages: GitHubModelsMessage[]) => {
  const developerMessages: string[] = [];
  const systemMessages: string[] = [];
  const conversation: Array<{ role: 'assistant' | 'user'; content: string }> = [];

  for (const message of messages) {
    const content = message.content?.trim();
    if (!content) {
      continue;
    }

    if (message.role === 'developer') {
      developerMessages.push(content);
      continue;
    }

    if (message.role === 'system') {
      systemMessages.push(content);
      continue;
    }

    conversation.push({
      role: message.role,
      content,
    });
  }

  const systemPrompt = [
    developerMessages.length
      ? `Developer instructions:\n${developerMessages.join('\n\n')}`
      : null,
    systemMessages.join('\n\n') || null,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    systemPrompt,
    conversation,
  };
};

const normalizeDirectoryPath = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? path.resolve(trimmed) : '';
};

const getCapabilityWorkspacePaths = (capability?: Partial<Capability>) =>
  Array.from(
    new Set(
      [
        capability?.executionConfig?.defaultWorkspacePath,
        ...(capability?.executionConfig?.allowedWorkspacePaths || []),
        ...(capability?.localDirectories || []),
      ]
        .map(value => normalizeDirectoryPath(value || ''))
        .filter(Boolean),
    ),
  );

const selectWorkingDirectory = (capability?: Partial<Capability>) =>
  getCapabilityWorkspacePaths(capability).find(directory => existsSync(directory)) ||
  process.cwd();

const getConfiguredTokenState = (): {
  token: string;
  source: RuntimeTokenSource;
} => {
  if (getConfiguredCopilotCliUrl()) {
    return {
      token: '',
      source: 'headless-cli',
    };
  }

  const override = runtimeTokenOverride?.trim();
  if (override) {
    return {
      token: override,
      source: 'runtime-override',
    };
  }

  if (process.env.GITHUB_MODELS_TOKEN) {
    return {
      token: process.env.GITHUB_MODELS_TOKEN,
      source: 'GITHUB_MODELS_TOKEN',
    };
  }

  if (process.env.GITHUB_TOKEN) {
    return {
      token: process.env.GITHUB_TOKEN,
      source: 'GITHUB_TOKEN',
    };
  }

  return {
    token: '',
    source: null,
  };
};

const getConfiguredHttpTokenState = (): {
  token: string;
  source: Exclude<RuntimeTokenSource, 'headless-cli'> | null;
} => {
  const override = runtimeTokenOverride?.trim();
  if (override) {
    return {
      token: override,
      source: 'runtime-override',
    };
  }

  if (process.env.GITHUB_MODELS_TOKEN) {
    return {
      token: process.env.GITHUB_MODELS_TOKEN,
      source: 'GITHUB_MODELS_TOKEN',
    };
  }

  if (process.env.GITHUB_TOKEN) {
    return {
      token: process.env.GITHUB_TOKEN,
      source: 'GITHUB_TOKEN',
    };
  }

  return {
    token: '',
    source: null,
  };
};

const resetRuntimeClients = async () => {
  runtimeModelCache = null;
  runtimeIdentityCache = null;

  const sessions = [...managedChatSessions.values()];
  managedChatSessions.clear();
  sessionLocks.clear();

  await Promise.all(
    sessions.map(record => disconnectSessionQuietly(record.session).catch(() => undefined)),
  );

  copilotClient = null;
  copilotClientPromise = null;
};

export const setRuntimeTokenOverride = async (token?: string | null) => {
  runtimeTokenOverride = token?.trim() || null;
  await resetRuntimeClients();
};

export const clearRuntimeTokenOverride = async () => {
  runtimeTokenOverride = null;
  await resetRuntimeClients();
};

export const getConfiguredToken = () => getConfiguredTokenState().token;

export const getConfiguredTokenSource = () => getConfiguredTokenState().source;

export const getConfiguredGitHubIdentity = async ({
  refresh = false,
}: {
  refresh?: boolean;
} = {}): Promise<{
  identity: RuntimeGitHubIdentity | null;
  error: string | null;
}> => {
  const { token } = getConfiguredTokenState();
  if (!token) {
    if (getConfiguredCopilotCliUrl()) {
      return {
        identity: null,
        error: 'Identity is managed by the configured headless Copilot CLI server.',
      };
    }

    return {
      identity: null,
      error: null,
    };
  }

  const tokenHash = hashText(token);
  if (
    !refresh &&
    runtimeIdentityCache &&
    runtimeIdentityCache.tokenHash === tokenHash &&
    Date.now() - runtimeIdentityCache.fetchedAt < 60_000
  ) {
    return {
      identity: runtimeIdentityCache.identity,
      error: runtimeIdentityCache.error,
    };
  }

  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      const error = text || `GitHub identity lookup failed with status ${response.status}.`;
      runtimeIdentityCache = {
        fetchedAt: Date.now(),
        tokenHash,
        identity: null,
        error,
      };
      return {
        identity: null,
        error,
      };
    }

    const payload = (await response.json()) as {
      id?: number;
      login?: string;
      name?: string;
      avatar_url?: string;
      html_url?: string;
      type?: string;
    };

    const identity =
      payload.id && payload.login
        ? {
            id: payload.id,
            login: payload.login,
            name: payload.name || undefined,
            avatarUrl: payload.avatar_url || undefined,
            profileUrl: payload.html_url || undefined,
            type: payload.type || undefined,
          }
        : null;

    runtimeIdentityCache = {
      fetchedAt: Date.now(),
      tokenHash,
      identity,
      error: identity ? null : 'GitHub identity could not be resolved for this token.',
    };

    return {
      identity,
      error: identity ? null : 'GitHub identity could not be resolved for this token.',
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'GitHub identity lookup failed unexpectedly.';
    runtimeIdentityCache = {
      fetchedAt: Date.now(),
      tokenHash,
      identity: null,
      error: message,
    };
    return {
      identity: null,
      error: message,
    };
  }
};

export const normalizeModel = (model?: string) => {
  const cleaned = model?.trim();
  if (!cleaned) {
    return defaultModel;
  }

  if (modelAliases[cleaned]) {
    return modelAliases[cleaned];
  }

  const withoutProvider = cleaned.includes('/') ? cleaned.split('/').pop() || cleaned : cleaned;
  return modelAliases[withoutProvider] || withoutProvider;
};

const normalizeHttpModel = (model?: string) => {
  const normalized = normalizeModel(model);
  return normalized.includes('/') ? normalized : `openai/${normalized}`;
};

const RATE_LIMIT_PATTERNS = [
  /too many requests/i,
  /rate limit/i,
  /secondary rate limit/i,
  /retry after/i,
  /abuse detection/i,
];

const parseRetryAfterMs = (value?: string | null) => {
  if (!value?.trim()) {
    return undefined;
  }

  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds * 1000;
  }

  const absoluteTimestamp = Date.parse(value);
  if (Number.isFinite(absoluteTimestamp)) {
    return Math.max(0, absoluteTimestamp - Date.now());
  }

  return undefined;
};

const clampRetryAfterMs = (value?: number) => Math.min(Math.max(value || 30_000, 5_000), 120_000);

const getRateLimitBackoffMs = (attempt: number, retryAfterHeader?: string | null) =>
  clampRetryAfterMs(parseRetryAfterMs(retryAfterHeader) ?? 4_000 * Math.pow(2, attempt));

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const isGitHubProviderRateLimitError = (error: unknown) => {
  if (error instanceof GitHubProviderRateLimitError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error || '');
  return RATE_LIMIT_PATTERNS.some(pattern => pattern.test(message));
};

const shouldFallbackToHttp = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    /Request session\.create failed/i.test(message) ||
    /Request session\.resume failed/i.test(message) ||
    /Model ".*" is not available/i.test(message) ||
    /Personal Access Tokens are not supported/i.test(message) ||
    /Copilot SDK timed out while waiting for an assistant response/i.test(message) ||
    /Copilot SDK session returned an empty response/i.test(message) ||
    isGitHubProviderRateLimitError(error)
  );
};

const shouldPreferHttpFallback = async () => {
  if (getConfiguredCopilotCliUrl()) {
    return false;
  }

  const token = getConfiguredToken();
  if (!token) {
    return false;
  }

  const { fromRuntime } = await listAvailableRuntimeModels();
  return !fromRuntime;
};

const shouldAllowHttpFallback = () =>
  isHttpFallbackAllowed();

const toRuntimeModelProfile = (model: ModelInfo) => {
  if (typeof model.capabilities?.limits?.max_context_window_tokens === 'number') {
    return `${model.capabilities.limits.max_context_window_tokens.toLocaleString()} ctx`;
  }

  if (model.capabilities?.supports?.vision) {
    return 'Vision capable';
  }

  if (model.supportedReasoningEfforts?.length) {
    return 'Reasoning supported';
  }

  return 'Available';
};

const toRuntimeModelOption = (model: ModelInfo): RuntimeModelOption => ({
  id: model.id,
  label: model.name || model.id,
  profile:
    staticModels.find(staticModel => normalizeModel(staticModel.id) === normalizeModel(model.id))
      ?.profile || toRuntimeModelProfile(model),
  apiModelId: normalizeModel(model.id),
});

const getStaticRuntimeModels = (): RuntimeModelOption[] =>
  staticModels.map(model => ({
    ...model,
    apiModelId: normalizeModel(model.id),
  }));

export const listAvailableRuntimeModels = async ({
  refresh = false,
}: {
  refresh?: boolean;
} = {}): Promise<{
  models: RuntimeModelOption[];
  fromRuntime: boolean;
}> => {
  const cacheAgeMs = 60_000;
  if (
    !refresh &&
    runtimeModelCache &&
    Date.now() - runtimeModelCache.fetchedAt < cacheAgeMs
  ) {
    return {
      models: runtimeModelCache.models,
      fromRuntime: runtimeModelCache.fromRuntime,
    };
  }

  const token = getConfiguredToken();
  if (!token && !getConfiguredCopilotCliUrl()) {
    const fallback = getStaticRuntimeModels();
    runtimeModelCache = {
      fetchedAt: Date.now(),
      models: fallback,
      fromRuntime: false,
    };
    return {
      models: fallback,
      fromRuntime: false,
    };
  }

  try {
    const client = await getCopilotClient();
    const discoveredModels = await client.listModels();
    const normalized = discoveredModels
      .map(toRuntimeModelOption)
      .filter(model => Boolean(model.id))
      .filter(
        (model, index, models) =>
          models.findIndex(candidate => candidate.id === model.id) === index,
      );

    if (normalized.length > 0) {
      runtimeModelCache = {
        fetchedAt: Date.now(),
        models: normalized,
        fromRuntime: true,
      };
      return {
        models: normalized,
        fromRuntime: true,
      };
    }
  } catch {
    // Fall through to the static fallback when the SDK cannot enumerate models.
  }

  const fallback = getStaticRuntimeModels();
  runtimeModelCache = {
    fetchedAt: Date.now(),
    models: fallback,
    fromRuntime: false,
  };
  return {
    models: fallback,
    fromRuntime: false,
  };
};

export const getRuntimeDefaultModel = async () => {
  const { models } = await listAvailableRuntimeModels();
  return models[0]?.apiModelId || normalizeModel(defaultModel);
};

const resolveRuntimeModel = async (requestedModel?: string) => {
  const normalizedRequested = normalizeModel(requestedModel);

  try {
    const { models, fromRuntime } = await listAvailableRuntimeModels();
    if (fromRuntime && models.length > 0) {
      const supportedModel = models.find(
        model =>
          normalizeModel(model.id) === normalizedRequested ||
          model.apiModelId === normalizedRequested,
      );
      return supportedModel?.apiModelId || models[0].apiModelId;
    }
  } catch {
    // Fall back to the requested model when the runtime catalog cannot be loaded.
  }

  return normalizedRequested;
};

export const buildCapabilitySystemPrompt = ({
  capability,
  agent,
}: {
  capability?: Partial<Capability>;
  agent?: Partial<CapabilityAgent>;
}) =>
  [
    `Capability boundary: ${capability?.name || capability?.id || 'Unknown capability'}`,
    capability?.description ? `Capability description: ${capability.description}` : null,
    capability?.domain ? `Capability domain: ${capability.domain}` : null,
    capability?.parentCapabilityId
      ? `Parent capability: ${capability.parentCapabilityId}`
      : null,
    capability?.businessUnit ? `Business unit: ${capability.businessUnit}` : null,
    capability?.ownerTeam ? `Owner team: ${capability.ownerTeam}` : null,
    toPromptSection('Associated teams', capability?.teamNames),
    toStakeholderSection(capability?.stakeholders),
    agent?.name ? `Active agent: ${agent.name}` : null,
    agent?.role ? `Agent role: ${agent.role}` : null,
    agent?.objective ? `Agent objective: ${agent.objective}` : null,
    agent?.systemPrompt ? `Agent instructions: ${agent.systemPrompt}` : null,
    toPromptSection('Documentation sources', agent?.documentationSources),
    toPromptSection('Learning notes', agent?.learningNotes),
    toPromptSection('Input artifacts', agent?.inputArtifacts),
    toPromptSection('Output artifacts', agent?.outputArtifacts),
    toPromptSection('Skill tags', agent?.skillIds),
    toPromptSection('Applications', capability?.applications),
    toPromptSection('APIs', capability?.apis),
    toPromptSection('Databases', capability?.databases),
    toPromptSection('Git repositories', capability?.gitRepositories),
    capability?.executionConfig?.defaultWorkspacePath
      ? `Default workspace path: ${capability.executionConfig.defaultWorkspacePath}`
      : null,
    toPromptSection(
      'Approved workspace paths',
      capability?.executionConfig?.allowedWorkspacePaths,
    ),
    toPromptSection('Local directories', capability?.localDirectories),
    toMetadataEntrySection(capability?.additionalMetadata),
    capability?.confluenceLink ? `Confluence reference: ${capability.confluenceLink}` : null,
    capability?.jiraBoardLink ? `Jira board reference: ${capability.jiraBoardLink}` : null,
    capability?.documentationNotes
      ? `Capability documentation notes: ${capability.documentationNotes}`
      : null,
    'Keep the response inside this capability context. If capability context is missing for a claim, say so clearly instead of inventing it.',
    'Prefer practical, execution-ready answers that help the team move work forward.',
  ]
    .filter(Boolean)
    .join('\n');

export const toUsage = (usage: InferenceUsage | undefined) => {
  const promptTokens = Number(usage?.prompt_tokens || 0);
  const completionTokens = Number(usage?.completion_tokens || 0);
  const totalTokens =
    Number(usage?.total_tokens || 0) || promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd: Number((totalTokens * 0.000003).toFixed(4)),
  };
};

const toUsageFromCopilot = (usageEvent: CopilotUsageEvent | null, fallbackOutputTokens = 0) =>
  toUsage({
    prompt_tokens: usageEvent?.data.inputTokens || 0,
    completion_tokens: usageEvent?.data.outputTokens || fallbackOutputTokens,
    total_tokens:
      Number(usageEvent?.data.inputTokens || 0) +
      Number(usageEvent?.data.outputTokens || fallbackOutputTokens),
  });

const getMissingTokenError = () =>
  getMissingRuntimeConfigurationMessage();

const getCopilotClient = async () => {
  const cliUrl = getConfiguredCopilotCliUrl();
  const token = getConfiguredToken();
  if (!cliUrl && !token) {
    throw new Error(getMissingTokenError());
  }

  if (copilotClient) {
    return copilotClient;
  }

  if (!copilotClientPromise) {
    copilotClientPromise = (async () => {
      const client = new CopilotClient({
        ...(cliUrl
          ? {
              cliUrl,
            }
          : {
              githubToken: token,
              useLoggedInUser: false,
            }),
        autoStart: true,
        logLevel: process.env.NODE_ENV === 'development' ? 'warning' : 'error',
        telemetry: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
          ? {
              otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
            }
          : undefined,
      });
      await client.start();
      copilotClient = client;
      return client;
    })().catch(error => {
      copilotClientPromise = null;
      throw error;
    });
  }

  return copilotClientPromise;
};

const withSessionLock = async <T>(key: string, task: () => Promise<T>) => {
  const previous = sessionLocks.get(key) || Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>(resolve => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  sessionLocks.set(key, tail);

  await previous.catch(() => undefined);

  try {
    return await task();
  } finally {
    releaseCurrent();
    if (sessionLocks.get(key) === tail) {
      sessionLocks.delete(key);
    }
  }
};

const createSessionConfig = ({
  model,
  systemPrompt,
  workingDirectory,
  streaming,
  sessionId,
  infinite,
}: {
  model?: string;
  systemPrompt?: string;
  workingDirectory: string;
  streaming: boolean;
  sessionId?: string;
  infinite: boolean;
}): SessionConfig => ({
  sessionId,
  clientName: 'SingularityNeo',
  model,
  onPermissionRequest: approveAll,
  workingDirectory,
  streaming,
  availableTools: [],
  infiniteSessions: { enabled: infinite },
  systemMessage: systemPrompt
    ? {
        content: systemPrompt,
      }
    : undefined,
});

const disconnectSessionQuietly = async (session?: CopilotSession | null) => {
  if (!session) {
    return;
  }

  try {
    await session.disconnect();
  } catch {
    // Ignore disconnect errors during cleanup.
  }
};

const requestGitHubModelsHttp = async ({
  model,
  messages,
  timeoutMs = 45000,
  maxAttempts = 3,
  maxRetryAfterMs = 120_000,
}: {
  model?: string;
  messages: GitHubModelsMessage[];
  timeoutMs?: number;
  maxAttempts?: number;
  maxRetryAfterMs?: number;
}) => {
  const token = getConfiguredHttpTokenState().token;
  if (!token) {
    throw new Error(getMissingTokenError());
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${githubModelsHttpApiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: normalizeHttpModel(model),
          messages,
          max_tokens: 1200,
          temperature: 0.2,
          stream: false,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 429 || isGitHubProviderRateLimitError(text)) {
          const retryAfterMs = Math.min(
            getRateLimitBackoffMs(attempt, response.headers.get('retry-after')),
            maxRetryAfterMs,
          );
          if (attempt < maxAttempts - 1) {
            await sleep(retryAfterMs);
            continue;
          }
          throw new GitHubProviderRateLimitError(
            text || `GitHub Models HTTP request was rate-limited with status ${response.status}.`,
            retryAfterMs,
            response.status,
          );
        }

        throw new Error(text || `GitHub Models HTTP request failed with status ${response.status}.`);
      }

      const result = (await response.json()) as {
        id?: string;
        created?: number;
        model?: string;
        usage?: InferenceUsage;
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };

      const content = result.choices?.[0]?.message?.content?.trim() || '';
      if (!content) {
        throw new Error('GitHub Models HTTP fallback returned an empty response.');
      }

      return {
        content,
        model: normalizeModel(result.model || model),
        usage: toUsage(result.usage),
        responseId: result.id || null,
        createdAt: result.created
          ? new Date(result.created * 1000).toISOString()
          : new Date().toISOString(),
        raw: {
          assistantMessage: null,
          usageEvent: null,
        },
      };
    } catch (error) {
      if (isGitHubProviderRateLimitError(error)) {
        const retryAfterMs =
          error instanceof GitHubProviderRateLimitError
            ? clampRetryAfterMs(error.retryAfterMs)
            : getRateLimitBackoffMs(attempt);
        if (attempt < maxAttempts - 1) {
          await sleep(retryAfterMs);
          continue;
        }
        throw error instanceof GitHubProviderRateLimitError
          ? error
          : new GitHubProviderRateLimitError(
              error instanceof Error ? error.message : 'GitHub provider rate limit reached.',
              retryAfterMs,
            );
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('GitHub Models HTTP request timed out.');
      }

      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new Error('GitHub Models HTTP request failed unexpectedly.');
};

const runSessionExchange = async ({
  session,
  prompt,
  model,
  timeoutMs = 45000,
  onDelta,
}: {
  session: CopilotSession;
  prompt: string;
  model?: string;
  timeoutMs?: number;
  onDelta?: (delta: string) => void;
}): Promise<SessionExchangeResult> => {
  if (!prompt.trim()) {
    throw new Error('Copilot SDK received an empty prompt.');
  }

  let finalAssistantMessage: AssistantMessageEvent | null = null;
  let usageEvent: CopilotUsageEvent | null = null;

  const unbindAssistantMessage = session.on('assistant.message', event => {
    finalAssistantMessage = event;
  });
  const unbindAssistantUsage = session.on('assistant.usage', event => {
    usageEvent = event;
  });
  const unbindAssistantDelta = onDelta
    ? session.on('assistant.message_delta', event => {
        onDelta(event.data.deltaContent);
      })
    : () => undefined;

  try {
    const messageEvent = await new Promise<AssistantMessageEvent | null>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(
          new Error('GitHub Copilot SDK timed out while waiting for an assistant response.'),
        );
      }, timeoutMs);

      session
        .sendAndWait(
          {
            prompt,
            mode: 'immediate',
          },
          timeoutMs,
        )
        .then(result => {
          clearTimeout(timeoutHandle);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutHandle);
          reject(error);
        });
    });

    finalAssistantMessage = messageEvent || finalAssistantMessage;

    const content = finalAssistantMessage?.data.content?.trim() || '';
    if (!content) {
      throw new Error('GitHub Copilot SDK session returned an empty response.');
    }

    return {
      content,
      model: usageEvent?.data.model || normalizeModel(model),
      usage: toUsageFromCopilot(
        usageEvent,
        Number(finalAssistantMessage?.data.outputTokens || 0),
      ),
      responseId:
        usageEvent?.data.apiCallId ||
        finalAssistantMessage?.data.interactionId ||
        finalAssistantMessage?.data.messageId ||
        null,
      createdAt: new Date().toISOString(),
      raw: {
        assistantMessage: finalAssistantMessage,
        usageEvent,
      },
    };
  } finally {
    unbindAssistantMessage();
    unbindAssistantUsage();
    unbindAssistantDelta();
  }
};

const getChatSessionFingerprint = ({
  capability,
  agent,
  developerPrompt,
  learningContextBlock,
  workingDirectory,
  scope,
  scopeId,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  developerPrompt?: string;
  learningContextBlock?: string;
  workingDirectory: string;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
}) =>
  hashText(
    [
      capability.id || capability.name || 'capability',
      agent.id || agent.name || 'agent',
      scope,
      scopeId || '',
      normalizeModel(agent.model),
      buildCapabilitySystemPrompt({ capability, agent }),
      developerPrompt || '',
      learningContextBlock || '',
      workingDirectory,
    ].join('\n---\n'),
  );

const buildScopedSystemPrompt = ({
  capability,
  agent,
  developerPrompt,
  learningContextBlock,
  scope,
  scopeId,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  developerPrompt?: string;
  learningContextBlock?: string;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
}) =>
  [
    developerPrompt ||
      'You are operating inside an enterprise capability workspace. Stay scoped to the provided capability and agent context, and be explicit when context is missing.',
    buildCapabilitySystemPrompt({ capability, agent }),
    learningContextBlock
      ? `Agent learning profile context:\n${learningContextBlock}`
      : null,
    scopeId
      ? `Active session scope: ${scope}${scope === 'GENERAL_CHAT' ? '' : ` / ${scopeId}`}`
      : `Active session scope: ${scope}`,
  ]
    .filter(Boolean)
    .join('\n\n');

const buildSessionModelCandidates = async (requestedModel?: string) => {
  const requested = normalizeModel(requestedModel);
  const candidates = [requested];

  try {
    const { models } = await listAvailableRuntimeModels();
    for (const model of models) {
      candidates.push(model.apiModelId || normalizeModel(model.id));
    }
  } catch {
    // Ignore model catalog failures and fall back to the static candidate list.
  }

  candidates.push(
    normalizeModel(defaultModel),
    normalizeModel('gpt-4.1'),
    normalizeModel('gpt-4o-mini'),
    normalizeModel('gpt-4o'),
    normalizeModel('o4-mini'),
    normalizeModel('o3'),
  );

  return [...new Set(candidates.filter(Boolean))];
};

const getManagedScopedSession = async ({
  capability,
  agent,
  developerPrompt,
  learningContextBlock,
  scope,
  scopeId,
  resetSession = false,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  developerPrompt?: string;
  learningContextBlock?: string;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
  resetSession?: boolean;
}) => {
  const workingDirectory = selectWorkingDirectory(capability);
  const fingerprint = getChatSessionFingerprint({
    capability,
    agent,
    developerPrompt,
    learningContextBlock,
    workingDirectory,
    scope,
    scopeId,
  });
  const persistedSession = capability.id && agent.id
    ? await findAgentSessionRecord({
        capabilityId: capability.id,
        agentId: agent.id,
        scope,
        scopeId,
        fingerprint,
      })
    : null;
  if (resetSession && persistedSession?.sessionId) {
    const cached = managedChatSessions.get(persistedSession.sessionId);
    managedChatSessions.delete(persistedSession.sessionId);
    await disconnectSessionQuietly(cached?.session);
  }

  const sessionId = resetSession
    ? [
        'singularity',
        sanitizeSessionValue(capability.id || capability.name),
        sanitizeSessionValue(agent.id || agent.name),
        scope.toLowerCase(),
        sanitizeSessionValue(scopeId),
        fingerprint,
        'fresh',
        randomUUID().slice(0, 8),
      ].join('--')
    : persistedSession?.sessionId ||
      [
        'singularity',
        sanitizeSessionValue(capability.id || capability.name),
        sanitizeSessionValue(agent.id || agent.name),
        scope.toLowerCase(),
        sanitizeSessionValue(scopeId),
        fingerprint,
      ].join('--');
  const cacheKey = sessionId;
  const cached = !resetSession ? managedChatSessions.get(cacheKey) : null;
  if (cached?.fingerprint === fingerprint) {
    return {
      session: cached.session,
      isNewSession: false,
      sessionId,
      cacheKey,
      fingerprint,
    };
  }

  const client = await getCopilotClient();
  const systemPrompt = buildScopedSystemPrompt({
    capability,
    agent,
    developerPrompt,
    learningContextBlock,
    scope,
    scopeId,
  });
  const modelCandidates = await buildSessionModelCandidates(agent.model);

  let session: CopilotSession | null = null;
  let isNewSession = false;
  let lastError: unknown = null;
  let selectedModel = normalizeModel(agent.model);

  for (const candidateModel of modelCandidates) {
    const sessionConfig = createSessionConfig({
      sessionId,
      model: candidateModel,
      systemPrompt,
      workingDirectory,
      streaming: true,
      infinite: true,
    });
    const { sessionId: _ignoredSessionId, ...resumeConfig } = sessionConfig;

    try {
      if (resetSession) {
        session = await client.createSession(sessionConfig);
        isNewSession = true;
      } else {
        try {
          session = await client.resumeSession(sessionId, resumeConfig);
        } catch {
          session = await client.createSession(sessionConfig);
          isNewSession = true;
        }
      }

      selectedModel = candidateModel;
      break;
    } catch (error) {
      lastError = error;
      if (!shouldFallbackToHttp(error)) {
        throw error;
      }
    }
  }

  if (!session) {
    throw (lastError instanceof Error
      ? lastError
      : new Error('Unable to create or resume a Copilot session.'));
  }

  managedChatSessions.set(cacheKey, {
    sessionId,
    session,
    fingerprint,
    capabilityId: capability.id,
    capabilityName: capability.name,
    agentId: agent.id,
    agentName: agent.name,
    scope,
    scopeId,
    model: selectedModel,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  });

  return {
    session,
    isNewSession: resetSession || (isNewSession && !persistedSession),
    sessionId,
    cacheKey,
    fingerprint,
  };
};

const prependRetrievedMemory = (prompt: string, memoryPrompt?: string) =>
  memoryPrompt?.trim()
    ? `Use this retrieved capability memory as current-turn context.\n\n${memoryPrompt.trim()}\n\n${prompt}`
    : prompt;

export const invokeScopedCapabilitySession = async ({
  capability,
  agent,
  scope,
  scopeId,
  prompt,
  initialPrompt,
  developerPrompt,
  memoryPrompt,
  timeoutMs,
  onDelta,
  resetSession = false,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
  prompt: string;
  initialPrompt?: string;
  developerPrompt?: string;
  memoryPrompt?: string;
  timeoutMs?: number;
  onDelta?: (delta: string) => void;
  resetSession?: boolean;
}) => {
  const learningContextBlock = agent.learningProfile?.contextBlock?.trim() || '';
  const effectivePrompt = prependRetrievedMemory(
    initialPrompt && resetSession ? initialPrompt : prompt,
    memoryPrompt,
  );

  if (!(await shouldPreferHttpFallback())) {
    let managedSession:
      | {
          session: CopilotSession;
          isNewSession: boolean;
          sessionId: string;
          cacheKey: string;
          fingerprint: string;
        }
      | null = null;

    try {
      managedSession = await getManagedScopedSession({
        capability,
        agent,
        developerPrompt,
        learningContextBlock,
        scope,
        scopeId,
        resetSession,
      });

      const result = await withSessionLock(managedSession.cacheKey, async () =>
        runSessionExchange({
          session: managedSession!.session,
          prompt: prependRetrievedMemory(
            managedSession!.isNewSession && initialPrompt ? initialPrompt : prompt,
            memoryPrompt,
          ),
          model: agent.model,
          timeoutMs,
          onDelta,
        }),
      );

      updateManagedSessionRecord(managedSession.sessionId, {
        lastUsedAt: new Date().toISOString(),
        model: result.model,
      });

      if (capability.id && agent.id) {
        await upsertAgentSessionRecord({
          capabilityId: capability.id,
          agentId: agent.id,
          scope,
          scopeId,
          sessionId: managedSession.sessionId,
          fingerprint: managedSession.fingerprint,
          model: result.model,
          tokenDelta: result.usage.totalTokens,
        }).catch(() => undefined);
      }

      return {
        ...result,
        isNewSession: managedSession.isNewSession,
        sessionId: managedSession.sessionId,
        sessionScope: scope,
        sessionScopeId: scopeId,
      };
    } catch (error) {
      if (managedSession) {
        await evictManagedSessionRecord(managedSession.sessionId);
      }

      if (!shouldFallbackToHttp(error) || !shouldAllowHttpFallback()) {
        throw error;
      }
    }
  }

  const fallbackResult = await requestGitHubModelsHttp({
    model: agent.model,
    messages: [
      {
        role: 'system',
        content: buildScopedSystemPrompt({
          capability,
          agent,
          developerPrompt,
          learningContextBlock,
          scope,
          scopeId,
        }),
      },
      {
        role: 'user',
        content: effectivePrompt,
      },
    ],
    timeoutMs,
    maxAttempts: scope === 'GENERAL_CHAT' ? 1 : 3,
    maxRetryAfterMs: scope === 'GENERAL_CHAT' ? 5_000 : 120_000,
  });

  if (onDelta && fallbackResult.content) {
    onDelta(fallbackResult.content);
  }

  return {
    ...fallbackResult,
    isNewSession: true,
    sessionId: undefined,
    sessionScope: scope,
    sessionScopeId: scopeId,
  };
};

export const requestGitHubModel = async ({
  model,
  messages,
  timeoutMs = 45000,
}: {
  model?: string;
  messages: GitHubModelsMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) => {
  if (await shouldPreferHttpFallback()) {
    return requestGitHubModelsHttp({
      model,
      messages,
      timeoutMs,
    });
  }

  try {
    await getCopilotClient();

    const { systemPrompt, conversation } = splitMessages(messages);
    const prompt = buildPromptFromConversation({
      conversation,
      includeHistory: true,
    });
    const workingDirectory = process.cwd();
    const session = await (await getCopilotClient()).createSession(
      createSessionConfig({
        model: await resolveRuntimeModel(model),
        systemPrompt,
        workingDirectory,
        streaming: false,
        infinite: false,
        sessionId: `singularity-tmp-${randomUUID()}`,
      }),
    );

    try {
      return await runSessionExchange({
        session,
        prompt,
        model,
        timeoutMs,
      });
    } finally {
      await disconnectSessionQuietly(session);
    }
  } catch (error) {
    if (!shouldFallbackToHttp(error) || !shouldAllowHttpFallback()) {
      throw error;
    }

    return requestGitHubModelsHttp({
      model,
      messages,
      timeoutMs,
    });
  }
};

export const requestGitHubModelStream = async ({
  model,
  messages,
  timeoutMs = 45000,
  onDelta,
}: {
  model?: string;
  messages: GitHubModelsMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  onDelta: (delta: string) => void;
}) => {
  if (await shouldPreferHttpFallback()) {
    const fallbackResult = await requestGitHubModelsHttp({
      model,
      messages,
      timeoutMs,
    });
    if (fallbackResult.content) {
      onDelta(fallbackResult.content);
    }
    return fallbackResult;
  }

  await getCopilotClient();

  const { systemPrompt, conversation } = splitMessages(messages);
  const prompt = buildPromptFromConversation({
    conversation,
    includeHistory: true,
  });
  const workingDirectory = process.cwd();
  const session = await (await getCopilotClient()).createSession(
    createSessionConfig({
      model: await resolveRuntimeModel(model),
      systemPrompt,
      workingDirectory,
      streaming: true,
      infinite: false,
      sessionId: `singularity-tmp-stream-${randomUUID()}`,
    }),
  );

  try {
    return await runSessionExchange({
      session,
      prompt,
      model,
      timeoutMs,
      onDelta,
    });
  } finally {
    await disconnectSessionQuietly(session);
  }
};

export const invokeCapabilityChat = async ({
  capability,
  agent,
  history = [],
  message,
  developerPrompt,
  memoryPrompt,
  resetSession = false,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  history?: ChatHistoryMessage[] | CapabilityChatMessage[];
  message: string;
  developerPrompt?: string;
  memoryPrompt?: string;
  temperature?: number;
  resetSession?: boolean;
}) => {
  const normalizedHistory = (history || [])
    .filter(item => item?.content?.trim())
    .slice(-10)
    .map(item => ({
      role: item.role === 'agent' ? 'assistant' : 'user',
      content: item.content!.trim(),
    })) as Array<{ role: 'assistant' | 'user'; content: string }>;

  const latestConversation = [
    ...normalizedHistory,
    {
      role: 'user' as const,
      content: message.trim(),
    },
  ];

  const conversationPrompt = buildPromptFromConversation({
    conversation: latestConversation,
    includeHistory: false,
  });
  const initialConversationPrompt = buildPromptFromConversation({
    conversation: latestConversation,
    includeHistory: true,
  });

  const result = await invokeScopedCapabilitySession({
    capability,
    agent,
    scope: 'GENERAL_CHAT',
    scopeId: capability.id,
    prompt: conversationPrompt,
    initialPrompt: initialConversationPrompt,
    developerPrompt,
    memoryPrompt,
    resetSession,
  });

  return result;
};

export const invokeCapabilityChatStream = async ({
  capability,
  agent,
  history = [],
  message,
  developerPrompt,
  memoryPrompt,
  onDelta,
  resetSession = false,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  history?: ChatHistoryMessage[] | CapabilityChatMessage[];
  message: string;
  developerPrompt?: string;
  memoryPrompt?: string;
  onDelta: (delta: string) => void;
  temperature?: number;
  resetSession?: boolean;
}) => {
  const normalizedHistory = (history || [])
    .filter(item => item?.content?.trim())
    .slice(-10)
    .map(item => ({
      role: item.role === 'agent' ? 'assistant' : 'user',
      content: item.content!.trim(),
    })) as Array<{ role: 'assistant' | 'user'; content: string }>;

  const latestConversation = [
    ...normalizedHistory,
    {
      role: 'user' as const,
      content: message.trim(),
    },
  ];

  const conversationPrompt = buildPromptFromConversation({
    conversation: latestConversation,
    includeHistory: false,
  });
  const initialConversationPrompt = buildPromptFromConversation({
    conversation: latestConversation,
    includeHistory: true,
  });

  const result = await invokeScopedCapabilitySession({
    capability,
    agent,
    scope: 'GENERAL_CHAT',
    scopeId: capability.id,
    prompt: conversationPrompt,
    initialPrompt: initialConversationPrompt,
    developerPrompt,
    memoryPrompt,
    onDelta,
    resetSession,
  });

  return result;
};
