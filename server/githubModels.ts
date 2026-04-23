import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
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
  ProviderKey,
} from '../src/types';
import {
  buildCapabilityBriefing,
  buildCapabilityBriefingPrompt,
} from '../src/lib/capabilityBriefing';
import { enrichCapabilityAgentProfile } from '../src/lib/agentProfiles';
import {
  findAgentSessionRecord,
  incrementAgentLearningCanaryCounters,
  upsertAgentSessionRecord,
} from './agentLearning/repository';
import {
  getConfiguredCopilotCliUrl,
  getMissingRuntimeConfigurationMessage,
  isHeadlessCliConfigured,
  isHttpFallbackAllowed,
} from './runtimePolicy';
import { getCapabilityWorkspaceRoots } from './workspacePaths';
import { loadGuidanceSystemPromptBlock } from './repoGuidance';
import {
  isLocalOpenAIConfigured,
  listLocalOpenAIModels,
  requestLocalOpenAIEmbeddings,
  requestLocalOpenAIModel,
  requestLocalOpenAIModelStream,
  type ProviderMessage,
} from './localOpenAIProvider';
import {
  DEFAULT_PROVIDER_KEY,
  LOCAL_OPENAI_PROVIDER_KEY,
  normalizeProviderKey,
  resolveAgentProviderKey,
  resolveProviderDisplayName,
} from './providerRegistry';
import {
  buildBudgetedSectionPrompt,
  buildDeterministicChatRollup,
  renderChatTranscript,
  resolveTokenOptimizationPolicy,
  truncateTextToTokenBudget,
} from './tokenOptimization';

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
  session?: CopilotSession | null;
  fingerprint: string;
  providerKey: string;
  capabilityId?: string;
  capabilityName?: string;
  agentId?: string;
  agentName?: string;
  scope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
  model?: string;
  createdAt: string;
  lastUsedAt: string;
  localHistoryRollup?: string;
  localMessages?: ProviderMessage[];
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

const BUDGET_MODEL_HINTS = [
  { pattern: /\b(free|included|no[- ]?cost)\b/i, score: 0 },
  { pattern: /\b(lowest cost|lower cost|low cost|cheap|cheapest|budget|economy)\b/i, score: 1 },
  { pattern: /\b(nano|mini|small|haiku|flash-lite|flash|lite)\b/i, score: 2 },
  { pattern: /\b(fast)\b/i, score: 3 },
  { pattern: /\b(balanced)\b/i, score: 4 },
] as const;

const EXPENSIVE_MODEL_HINTS = /\b(opus|pro|max|broad|premium)\b/i;

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

const toSkillInstructionSections = (
  capability?: Partial<Capability>,
  agent?: Partial<CapabilityAgent>,
) => {
  const skillMap = new Map((capability?.skillLibrary || []).map(skill => [skill.id, skill]));
  const attachedSkills = (agent?.skillIds || [])
    .map(skillId => skillMap.get(skillId))
    .filter(Boolean);

  const generalSkills = attachedSkills.filter(skill => skill?.kind === 'GENERAL');
  const roleSkills = attachedSkills.filter(skill => skill?.kind !== 'GENERAL');

  const buildSection = (label: string, skills: typeof attachedSkills) => {
    if (skills.length === 0) {
      return null;
    }

    return [
      `${label}:`,
      ...skills.map(
        skill =>
          `- ${skill?.name}: ${(skill?.contentMarkdown || skill?.description || '').trim()}`,
      ),
    ].join('\n');
  };

  return [
    buildSection('Shared operating skills', generalSkills),
    buildSection('Role skills', roleSkills),
  ].filter(Boolean);
};

const toMetadataEntrySection = (entries?: CapabilityMetadataEntry[]) => {
  const content = (entries || [])
    .filter(entry => entry.key || entry.value)
    .map(entry => `${entry.key || 'Key'}=${entry.value || ''}`);

  return content.length > 0 ? `Additional metadata: ${content.join('; ')}` : null;
};

const toAgentContractSection = (agent?: Partial<CapabilityAgent>) => {
  const contract = agent?.contract;
  if (!contract) {
    return null;
  }

  const renderList = (label: string, items?: string[]) =>
    items && items.length > 0 ? `${label}:\n${items.map(item => `- ${item}`).join('\n')}` : null;

  const renderArtifacts = (
    label: string,
    items?: typeof contract.suggestedInputArtifacts,
  ) =>
    items && items.length > 0
      ? `${label}:\n${items
          .map(
            item =>
              `- ${item.artifactName} (${item.requiredByDefault ? 'required by default' : 'advisory'})${
                item.description ? `: ${item.description}` : ''
              }`,
          )
          .join('\n')}`
      : null;

  return [
    'Structured agent contract:',
    contract.description ? `Description: ${contract.description}` : null,
    renderList('Primary responsibilities', contract.primaryResponsibilities),
    renderList('Working approach', contract.workingApproach),
    renderList('Preferred outputs', contract.preferredOutputs),
    renderList('Guardrails', contract.guardrails),
    renderList('Conflict resolution guidance', contract.conflictResolution),
    contract.definitionOfDone ? `Definition of done: ${contract.definitionOfDone}` : null,
    renderArtifacts('Suggested input artifacts', contract.suggestedInputArtifacts),
    renderArtifacts('Expected output artifacts', contract.expectedOutputArtifacts),
  ]
    .filter(Boolean)
    .join('\n');
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

const selectWorkingDirectory = (capability?: Partial<Capability>) =>
  getCapabilityWorkspaceRoots(capability).find(directory => existsSync(directory)) ||
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
  if (/^claude-/i.test(normalized)) {
    return 'openai/gpt-4.1';
  }

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

const DEFAULT_SESSION_RESPONSE_TIMEOUT_MS = 120_000;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30_000;

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
    /Copilot SDK stopped sending output before the assistant finished responding/i.test(message) ||
    /Copilot SDK session returned an empty response/i.test(message) ||
    isGitHubProviderRateLimitError(error)
  );
};

const shouldRetryWithFreshSession = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    /Request session\.resume failed/i.test(message) ||
    /Copilot SDK timed out while waiting for an assistant response/i.test(message) ||
    /Copilot SDK stopped sending output before the assistant finished responding/i.test(message) ||
    /Copilot SDK session returned an empty response/i.test(message)
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

const scoreRuntimeModelAffordability = (model: RuntimeModelOption) => {
  const text = `${model.id} ${model.label} ${model.profile}`.toLowerCase();
  const hintMatch = BUDGET_MODEL_HINTS.find(hint => hint.pattern.test(text));
  const expensivePenalty = EXPENSIVE_MODEL_HINTS.test(text) ? 4 : 0;

  return {
    score: (hintMatch?.score ?? 6) + expensivePenalty,
    tieBreaker: `${normalizeModel(model.apiModelId || model.id)}|${text}`,
  };
};

export const rankRuntimeModelsByAffordability = (
  models: RuntimeModelOption[],
) =>
  [...models].sort((left, right) => {
    const leftScore = scoreRuntimeModelAffordability(left);
    const rightScore = scoreRuntimeModelAffordability(right);

    if (leftScore.score !== rightScore.score) {
      return leftScore.score - rightScore.score;
    }

    return leftScore.tieBreaker.localeCompare(rightScore.tieBreaker);
  });

export const pickLowestCostRuntimeModel = (
  models: RuntimeModelOption[],
) => rankRuntimeModelsByAffordability(models)[0];

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
  const localModels = await listLocalOpenAIModels().catch(() => []);
  if (!token && !getConfiguredCopilotCliUrl()) {
    const fallback = localModels.length > 0 ? localModels : getStaticRuntimeModels();
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
    const merged = [...normalized, ...localModels].filter(
      (model, index, models) =>
        models.findIndex(candidate => candidate.apiModelId === model.apiModelId) === index,
    );

    if (merged.length > 0) {
      runtimeModelCache = {
        fetchedAt: Date.now(),
        models: merged,
        fromRuntime: true,
      };
      return {
        models: merged,
        fromRuntime: true,
      };
    }
  } catch {
    // Fall through to the static fallback when the SDK cannot enumerate models.
  }

  const fallback = localModels.length > 0 ? localModels : getStaticRuntimeModels();
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
  return pickLowestCostRuntimeModel(models)?.apiModelId || normalizeModel(defaultModel);
};

export const resolveRuntimeModel = async (requestedModel?: string) => {
  const normalizedRequested = normalizeModel(requestedModel);

  try {
    const { models, fromRuntime } = await listAvailableRuntimeModels();
    if (fromRuntime && models.length > 0) {
      const supportedModel = models.find(
        model =>
          normalizeModel(model.id) === normalizedRequested ||
          model.apiModelId === normalizedRequested,
      );
      return (
        supportedModel?.apiModelId ||
        pickLowestCostRuntimeModel(models)?.apiModelId ||
        models[0].apiModelId
      );
    }
  } catch {
    // Fall back to the requested model when the runtime catalog cannot be loaded.
  }

  return normalizedRequested || normalizeModel(defaultModel);
};

export const buildCapabilitySystemPrompt = ({
  capability,
  agent,
}: {
  capability?: Partial<Capability>;
  agent?: Partial<CapabilityAgent>;
}) => {
  const briefing = buildCapabilityBriefing(capability);
  const operatingAgent = agent
    ? enrichCapabilityAgentProfile(agent as CapabilityAgent)
    : undefined;

  return [
    `Capability boundary: ${capability?.name || capability?.id || 'Unknown capability'}`,
    buildCapabilityBriefingPrompt(briefing),
    capability?.domain ? `Capability domain: ${capability.domain}` : null,
    capability?.parentCapabilityId
      ? `Parent capability: ${capability.parentCapabilityId}`
      : null,
    capability?.businessUnit ? `Business unit: ${capability.businessUnit}` : null,
    capability?.databaseConfigs?.length
      ? `Database profiles: ${capability.databaseConfigs
          .map(config =>
            [
              config.label || config.databaseName,
              config.engine,
              config.host,
              config.port,
              config.databaseName,
              config.schema,
              config.secretReference
                ? `Secret reference: ${config.secretReference}`
                : null,
            ]
              .filter(Boolean)
              .join(' | '),
          )
          .join('; ')}`
      : null,
    toMetadataEntrySection(capability?.additionalMetadata),
    capability?.confluenceLink ? `Confluence reference: ${capability.confluenceLink}` : null,
    capability?.jiraBoardLink ? `Jira board reference: ${capability.jiraBoardLink}` : null,
    capability?.documentationNotes
      ? `Capability documentation notes: ${capability.documentationNotes}`
      : null,
    operatingAgent?.name ? `Active agent: ${operatingAgent.name}` : null,
    operatingAgent?.role ? `Agent role: ${operatingAgent.role}` : null,
    operatingAgent?.objective ? `Agent objective: ${operatingAgent.objective}` : null,
    operatingAgent?.userVisibility
      ? `Agent visibility model: ${operatingAgent.userVisibility}`
      : null,
    operatingAgent?.rolePolicy
      ? [
          'Agent operating policy:',
          `Summary: ${operatingAgent.rolePolicy.summary}`,
          operatingAgent.rolePolicy.allowedToolIds?.length
            ? `Allowed tool policy: ${operatingAgent.rolePolicy.allowedToolIds.join(', ')}`
            : null,
          operatingAgent.rolePolicy.escalationTriggers?.length
            ? `Escalation triggers: ${operatingAgent.rolePolicy.escalationTriggers.join('; ')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null,
    operatingAgent?.memoryScope
      ? [
          'Agent memory scope:',
          `Summary: ${operatingAgent.memoryScope.summary}`,
          operatingAgent.memoryScope.scopeLabels?.length
            ? `Memory lenses: ${operatingAgent.memoryScope.scopeLabels.join(', ')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null,
    operatingAgent?.qualityBar
      ? [
          `Agent quality bar: ${operatingAgent.qualityBar.label}`,
          operatingAgent.qualityBar.summary,
          operatingAgent.qualityBar.checklist?.length
            ? `Checklist: ${operatingAgent.qualityBar.checklist.join('; ')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null,
    operatingAgent?.evalProfile
      ? [
          `Agent eval profile: ${operatingAgent.evalProfile.label}`,
          operatingAgent.evalProfile.summary,
          operatingAgent.evalProfile.criteria?.length
            ? `Evaluation criteria: ${operatingAgent.evalProfile.criteria.join('; ')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null,
    operatingAgent?.systemPrompt
      ? `Agent instructions: ${operatingAgent.systemPrompt}`
      : null,
    toPromptSection('Documentation sources', operatingAgent?.documentationSources),
    toPromptSection('Learning notes', operatingAgent?.learningNotes),
    toPromptSection('Input artifacts', operatingAgent?.inputArtifacts),
    toPromptSection('Output artifacts', operatingAgent?.outputArtifacts),
    toAgentContractSection(operatingAgent),
    toPromptSection('Attached skill ids', operatingAgent?.skillIds),
    ...toSkillInstructionSections(capability, operatingAgent),
    toPromptSection('Preferred tool profile', operatingAgent?.preferredToolIds),
    'Keep the response inside this capability context. If capability context is missing for a claim, say so clearly instead of inventing it.',
    'Prefer practical, execution-ready answers that help the team move work forward.',
  ]
    .filter(Boolean)
    .join('\n\n');
};

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
  timeoutMs = DEFAULT_SESSION_RESPONSE_TIMEOUT_MS,
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
  let timeoutHandle: NodeJS.Timeout | null = null;

  const idleTimeoutMs = Math.min(timeoutMs, DEFAULT_SESSION_IDLE_TIMEOUT_MS);
  const clearWatchdog = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };
  const armWatchdog = (message: string) => {
    clearWatchdog();
    timeoutHandle = setTimeout(() => {
      timeoutHandle = null;
      throwTimeout(message);
    }, message === RESPONSE_TIMEOUT_MESSAGE ? timeoutMs : idleTimeoutMs);
  };
  let rejectPending: ((reason?: unknown) => void) | null = null;
  const throwTimeout = (message: string) => {
    if (rejectPending) {
      rejectPending(new Error(message));
    }
  };
  const RESPONSE_TIMEOUT_MESSAGE =
    'GitHub Copilot SDK timed out while waiting for an assistant response.';
  const IDLE_TIMEOUT_MESSAGE =
    'GitHub Copilot SDK stopped sending output before the assistant finished responding.';

  const unbindAssistantMessage = session.on('assistant.message', event => {
    finalAssistantMessage = event;
    armWatchdog(IDLE_TIMEOUT_MESSAGE);
  });
  const unbindAssistantUsage = session.on('assistant.usage', event => {
    usageEvent = event;
  });
  const unbindAssistantDelta = onDelta
    ? session.on('assistant.message_delta', event => {
        onDelta(event.data.deltaContent);
        armWatchdog(IDLE_TIMEOUT_MESSAGE);
      })
    : () => undefined;

  try {
    const messageEvent = await new Promise<AssistantMessageEvent | null>((resolve, reject) => {
      rejectPending = reject;
      armWatchdog(RESPONSE_TIMEOUT_MESSAGE);

      session
        .sendAndWait(
          {
            prompt,
            mode: 'immediate',
          },
          timeoutMs,
        )
        .then(result => {
          clearWatchdog();
          rejectPending = null;
          resolve(result);
        })
        .catch(error => {
          clearWatchdog();
          rejectPending = null;
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
    clearWatchdog();
    rejectPending = null;
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
  copilotGuidanceBlock,
  workingDirectory,
  scope,
  scopeId,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  developerPrompt?: string;
  learningContextBlock?: string;
  copilotGuidanceBlock?: string;
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
      copilotGuidanceBlock || '',
      workingDirectory,
    ].join('\n---\n'),
  );

const buildScopedSystemPromptSections = ({
  capability,
  agent,
  developerPrompt,
  learningContextBlock,
  copilotGuidanceBlock,
  scope,
  scopeId,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  developerPrompt?: string;
  learningContextBlock?: string;
  copilotGuidanceBlock?: string;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
}) => ({
  developerPrompt:
    developerPrompt ||
    'You are operating inside an enterprise capability workspace. Stay scoped to the provided capability and agent context, and be explicit when context is missing.',
  systemCore: buildCapabilitySystemPrompt({ capability, agent }),
  learningContext: learningContextBlock
    ? `Agent learning profile context:\n${learningContextBlock}`
    : null,
  repoGuidance: copilotGuidanceBlock
    ? `Repository copilot guidance (house rules authored by the team):\n${copilotGuidanceBlock}`
    : null,
  activeScope: scopeId
    ? `Active session scope: ${scope}${scope === 'GENERAL_CHAT' ? '' : ` / ${scopeId}`}`
    : `Active session scope: ${scope}`,
});

const buildScopedSystemPrompt = ({
  capability,
  agent,
  developerPrompt,
  learningContextBlock,
  copilotGuidanceBlock,
  scope,
  scopeId,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  developerPrompt?: string;
  learningContextBlock?: string;
  copilotGuidanceBlock?: string;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
}) =>
  Object.values(
    buildScopedSystemPromptSections({
      capability,
      agent,
      developerPrompt,
      learningContextBlock,
      copilotGuidanceBlock,
      scope,
      scopeId,
    }),
  )
    .filter(Boolean)
    .join('\n\n');

const formatHistorySummaryFragment = (summary?: string | null) =>
  summary?.trim()
    ? /^Earlier conversation state/i.test(summary.trim())
      ? summary.trim()
      : `Earlier conversation state summary:\n${summary.trim()}`
    : '';

const formatMemoryFragment = (memoryPrompt?: string | null) =>
  memoryPrompt?.trim() ? `Retrieved memory context:\n${memoryPrompt.trim()}` : '';

const buildChatPromptPlan = ({
  capability,
  providerKey,
  model,
  developerPrompt,
  systemCore,
  learningContext,
  repoGuidance,
  activeScope,
  history,
  message,
  memoryPrompt,
}: {
  capability: Partial<Capability>;
  providerKey?: string;
  model?: string;
  developerPrompt: string;
  systemCore: string;
  learningContext?: string | null;
  repoGuidance?: string | null;
  activeScope: string;
  history: Array<{ role: 'assistant' | 'user'; content: string }>;
  message: string;
  memoryPrompt?: string;
}) => {
  const tokenPolicy = resolveTokenOptimizationPolicy(capability);
  const keepLastN = tokenPolicy.chatHistoryKeepLastN;
  const recentHistory = history.slice(-keepLastN);
  const olderHistory = history.slice(0, Math.max(0, history.length - keepLastN));
  const historySummary =
    olderHistory.length > 0
      ? buildDeterministicChatRollup(olderHistory, {
          maxChars: tokenPolicy.approvalExcerptMaxChars,
        })
      : '';

  const protectedFragments = [
    {
      source: 'DEVELOPER_PROMPT' as const,
      text: developerPrompt,
    },
    {
      source: 'SYSTEM_CORE' as const,
      text: `${systemCore}\n\n${activeScope}`,
    },
    learningContext
      ? {
          source: 'LEARNING_CONTEXT' as const,
          text: learningContext,
        }
      : null,
    repoGuidance
      ? {
          source: 'REPO_GUIDANCE' as const,
          text: repoGuidance,
        }
      : null,
  ].filter(Boolean) as Array<{
    source: 'DEVELOPER_PROMPT' | 'SYSTEM_CORE' | 'LEARNING_CONTEXT' | 'REPO_GUIDANCE';
    text: string;
  }>;

  const initialBudget = buildBudgetedSectionPrompt({
    protectedFragments,
    promptFragments: [
      historySummary
        ? {
            source: 'HISTORY_ROLLUP' as const,
            text: formatHistorySummaryFragment(historySummary),
          }
        : null,
      recentHistory.length > 0
        ? {
            source: 'CONVERSATION_HISTORY' as const,
            text: `Recent conversation turns:\n${renderChatTranscript(recentHistory, {
              maxTurns: recentHistory.length,
              maxCharsPerTurn: 280,
            })}`,
          }
        : null,
      memoryPrompt?.trim()
        ? {
            source: 'MEMORY_HITS' as const,
            text: formatMemoryFragment(memoryPrompt),
          }
        : null,
      {
        source: 'LATEST_USER_MESSAGE' as const,
        text: `Latest user request:\n${message.trim()}`,
      },
      {
        source: 'WORK_ITEM_BRIEFING' as const,
        text: 'Respond directly to the latest user request. Use earlier context only where it materially helps.',
      },
    ].filter(Boolean) as Array<{
      source:
        | 'HISTORY_ROLLUP'
        | 'CONVERSATION_HISTORY'
        | 'MEMORY_HITS'
        | 'LATEST_USER_MESSAGE'
        | 'WORK_ITEM_BRIEFING';
      text: string;
    }>,
    maxInputTokens: tokenPolicy.chatMaxInputTokens,
    providerKey,
    model,
  });

  const currentBudget = buildBudgetedSectionPrompt({
    protectedFragments,
    promptFragments: [
      memoryPrompt?.trim()
        ? {
            source: 'MEMORY_HITS' as const,
            text: formatMemoryFragment(memoryPrompt),
          }
        : null,
      {
        source: 'LATEST_USER_MESSAGE' as const,
        text: `Latest user request:\n${message.trim()}`,
      },
      {
        source: 'WORK_ITEM_BRIEFING' as const,
        text: 'Respond directly to the latest user request. Use earlier context only where it materially helps.',
      },
    ].filter(Boolean) as Array<{
      source: 'MEMORY_HITS' | 'LATEST_USER_MESSAGE' | 'WORK_ITEM_BRIEFING';
      text: string;
    }>,
    maxInputTokens: tokenPolicy.chatMaxInputTokens,
    providerKey,
    model,
  });

  return {
    tokenPolicy,
    historySummary,
    recentHistory,
    prompt: currentBudget.prompt,
    initialPrompt: initialBudget.prompt || currentBudget.prompt,
    currentReceipt: currentBudget.receipt,
    initialReceipt: initialBudget.receipt,
  };
};

const normalizeLocalConversationTail = (messages: ProviderMessage[]) =>
  messages
    .filter(message => (message.role === 'assistant' || message.role === 'user') && message.content.trim())
    .map(message => ({
      role: message.role,
      content: message.content.trim(),
    })) as Array<{ role: 'assistant' | 'user'; content: string }>;

const condenseLocalConversationState = async ({
  capability,
  agent,
  priorSummary,
  messages,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  priorSummary?: string;
  messages: ProviderMessage[];
}) => {
  const tokenPolicy = resolveTokenOptimizationPolicy(capability);
  const keepLastN = tokenPolicy.chatHistoryKeepLastN;
  if (messages.length <= tokenPolicy.chatRollupThreshold) {
    return {
      summary: priorSummary || '',
      messages,
    };
  }

  const tailMessages = messages.slice(-keepLastN);
  const olderTurns = normalizeLocalConversationTail(
    messages.slice(0, Math.max(0, messages.length - keepLastN)),
  );

  if (olderTurns.length === 0) {
    return {
      summary: priorSummary || '',
      messages: tailMessages,
    };
  }

  let summary = priorSummary || '';
  try {
    const rolled = await invokeBudgetModelSummary({
      capability,
      agent,
      priorSummary,
      newTurns: olderTurns,
    });
    summary = rolled.summary || summary;
  } catch {
    const deterministicSummary = buildDeterministicChatRollup(olderTurns, {
      maxChars: tokenPolicy.approvalExcerptMaxChars,
    });
    summary = [priorSummary, deterministicSummary].filter(Boolean).join('\n\n');
  }

  summary = truncateTextToTokenBudget({
    text: summary,
    maxTokens: Math.max(400, Math.floor(tokenPolicy.chatMaxInputTokens / 5)),
    providerKey: resolveAgentProviderKey(agent),
  });

  return {
    summary,
    messages: tailMessages,
  };
};

const buildSessionModelCandidates = async (requestedModel?: string) => {
  const requested = normalizeModel(requestedModel);
  const candidates: string[] = [];

  try {
    const { models, fromRuntime } = await listAvailableRuntimeModels();
    if (fromRuntime && models.length > 0) {
      const requestedMatch = models.find(
        model =>
          normalizeModel(model.id) === requested ||
          model.apiModelId === requested,
      );
      if (requestedMatch) {
        candidates.push(requestedMatch.apiModelId);
      }
      for (const model of models) {
        candidates.push(model.apiModelId || normalizeModel(model.id));
      }
    } else {
      candidates.push(requested);
      for (const model of models) {
        candidates.push(model.apiModelId || normalizeModel(model.id));
      }
    }
  } catch {
    candidates.push(requested);
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
  copilotGuidanceBlock,
  scope,
  scopeId,
  resetSession = false,
  modelOverride,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  developerPrompt?: string;
  learningContextBlock?: string;
  copilotGuidanceBlock?: string;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
  resetSession?: boolean;
  /** Optional model override from dynamic routing (Fix 2). */
  modelOverride?: string;
}) => {
  // Dynamic model routing: use the caller-supplied override when present so
  // the session is created/looked up with the right model (budget vs primary).
  const effectiveModel = modelOverride ?? agent.model;
  const workingDirectory = selectWorkingDirectory(capability);
  const providerKey = resolveAgentProviderKey(agent);
  const fingerprint = getChatSessionFingerprint({
    capability,
    agent,
    developerPrompt,
    learningContextBlock,
    copilotGuidanceBlock,
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
  if (cached?.fingerprint === fingerprint && cached.providerKey === providerKey) {
    return {
      session: cached.session,
      isNewSession: false,
      sessionId,
      cacheKey,
      fingerprint,
      model: cached.model,
      providerKey,
      localHistoryRollup: cached.localHistoryRollup || '',
      localMessages: cached.localMessages || [],
    };
  }

  if (providerKey === LOCAL_OPENAI_PROVIDER_KEY) {
    const initialMessages: ProviderMessage[] =
      !resetSession && cached?.localMessages?.length
        ? cached.localMessages
        : [];

    managedChatSessions.set(cacheKey, {
      sessionId,
      session: null,
      fingerprint,
      providerKey,
      capabilityId: capability.id,
      capabilityName: capability.name,
      agentId: agent.id,
      agentName: agent.name,
      scope,
      scopeId,
      model: agent.model || undefined,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      localHistoryRollup: cached?.localHistoryRollup || '',
      localMessages: initialMessages,
    });

    return {
      session: null,
      isNewSession: resetSession || !cached,
      sessionId,
      cacheKey,
      fingerprint,
      model: agent.model,
      providerKey,
      localHistoryRollup: cached?.localHistoryRollup || '',
      localMessages: initialMessages,
    };
  }

  const client = await getCopilotClient();
  const systemPrompt = buildScopedSystemPrompt({
    capability,
    agent,
    developerPrompt,
    learningContextBlock,
    copilotGuidanceBlock,
    scope,
    scopeId,
  });
  const modelCandidates = await buildSessionModelCandidates(effectiveModel);

  let session: CopilotSession | null = null;
  let isNewSession = false;
  let lastError: unknown = null;
  let selectedModel = normalizeModel(effectiveModel);

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
    providerKey,
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
    model: selectedModel,
    providerKey,
    localHistoryRollup: '',
    localMessages: [],
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
  promptReceipt,
  initialPromptReceipt,
  developerPrompt,
  memoryPrompt,
  timeoutMs,
  onDelta,
  resetSession = false,
  workItemPhase,
  modelOverride,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
  prompt: string;
  initialPrompt?: string;
  promptReceipt?: Record<string, unknown>;
  initialPromptReceipt?: Record<string, unknown>;
  developerPrompt?: string;
  memoryPrompt?: string;
  timeoutMs?: number;
  onDelta?: (delta: string) => void;
  resetSession?: boolean;
  /**
   * Current WorkItemPhase (e.g. "DEVELOPMENT", "QA", "RELEASE"). When
   * provided, the copilot guidance pack is phase-sliced — QA-phase agents
   * only receive testing rules; release-phase agents get a compact
   * policy-focused block; dev agents get guidance + testing. Omit for
   * full pack (chat / ad-hoc sessions).
   */
  workItemPhase?: string | null;
  /**
   * Optional model override for dynamic model routing (Fix 2).
   * When provided, bypasses agent.model for this specific call so the
   * execution engine can route trivial tool turns to a cheaper model.
   * Falls back to agent.model when absent.
   */
  modelOverride?: string;
}) => {
  // Dynamic model routing: prefer the caller-supplied override so the
  // execution engine can direct trivial tool turns to a cheaper model.
  const effectiveModel = modelOverride ?? agent.model;
  const learningContextBlock = agent.learningProfile?.contextBlock?.trim() || '';
  // Load cached copilot guidance (CLAUDE.md / AGENTS.md / .cursor/rules /
  // .github/copilot-instructions.md / CONTRIBUTING.md) for this capability.
  // No network I/O here — the refresh happens on its own endpoint; we read
  // what's cached so session init stays fast. Failures are swallowed so a
  // corrupted guidance row can never block inference.
  // Phase slicing: when workItemPhase is provided, the injected block is
  // scoped to just the categories relevant to that phase (biggest single
  // input-token reduction — see `selectGuidanceCategoriesForPhase`).
  const copilotGuidanceBlock = capability.id
    ? await loadGuidanceSystemPromptBlock(capability.id, {
        phase: workItemPhase ?? null,
      }).catch(() => null)
    : null;
  const systemPromptSections = buildScopedSystemPromptSections({
    capability,
    agent,
    developerPrompt,
    learningContextBlock,
    copilotGuidanceBlock: copilotGuidanceBlock || undefined,
    scope,
    scopeId,
  });
  const systemPrompt = Object.values(systemPromptSections)
    .filter(Boolean)
    .join('\n\n');
  const effectivePrompt = prependRetrievedMemory(
    initialPrompt && resetSession ? initialPrompt : prompt,
    memoryPrompt,
  );

  if (!(await shouldPreferHttpFallback())) {
    let managedSession:
        | {
          session: CopilotSession | null;
          isNewSession: boolean;
          sessionId: string;
          cacheKey: string;
          fingerprint: string;
          model?: string;
          providerKey: string;
          localHistoryRollup?: string;
          localMessages: ProviderMessage[];
        }
      | null = null;

    try {
      managedSession = await getManagedScopedSession({
        capability,
        agent,
        developerPrompt,
        learningContextBlock,
        copilotGuidanceBlock: copilotGuidanceBlock || undefined,
        scope,
        scopeId,
        resetSession,
        modelOverride,
      });

      const result =
        managedSession.providerKey === LOCAL_OPENAI_PROVIDER_KEY
          ? await withSessionLock(managedSession.cacheKey, async () => {
              const localMessages: ProviderMessage[] = [
                { role: 'system', content: systemPrompt },
                ...(managedSession!.localHistoryRollup?.trim()
                  ? [
                      {
                        role: 'system' as const,
                        content: managedSession!.localHistoryRollup!.trim(),
                      },
                    ]
                  : []),
                ...managedSession!.localMessages,
              ];
              const nextPrompt =
                managedSession!.isNewSession && initialPrompt ? initialPrompt : prompt;
              localMessages.push({
                role: 'user',
                content: nextPrompt,
              });
              const completion = onDelta
                ? await requestLocalOpenAIModelStream({
                    model: managedSession!.model || agent.model,
                    messages: localMessages,
                    timeoutMs,
                    onDelta,
                  })
                : await requestLocalOpenAIModel({
                    model: managedSession!.model || agent.model,
                    messages: localMessages,
                    timeoutMs,
                  });

              const condensedState = await condenseLocalConversationState({
                capability,
                agent,
                priorSummary: managedSession!.localHistoryRollup,
                messages: [
                  ...managedSession!.localMessages,
                  { role: 'user', content: nextPrompt },
                  { role: 'assistant', content: completion.content },
                ],
              });
              updateManagedSessionRecord(managedSession!.sessionId, {
                localHistoryRollup: condensedState.summary,
                localMessages: condensedState.messages,
              });
              return {
                ...completion,
                raw: {
                  assistantMessage: null,
                  usageEvent: null,
                },
              };
            })
          : await withSessionLock(managedSession.cacheKey, async () =>
              runSessionExchange({
                session: managedSession!.session!,
                prompt: prependRetrievedMemory(
                  managedSession!.isNewSession && initialPrompt ? initialPrompt : prompt,
                  memoryPrompt,
                ),
                model: managedSession!.model || agent.model,
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
        // Slice C — every successful agent exchange bumps the canary
        // request count so the drift detector has a denominator for the
        // live version. Fire-and-forget; inference never blocks on this.
        void incrementAgentLearningCanaryCounters({
          capabilityId: capability.id,
          agentId: agent.id,
          requestDelta: 1,
        }).catch(() => undefined);
      }

      return {
        ...result,
        isNewSession: managedSession.isNewSession,
        sessionId: managedSession.sessionId,
        sessionScope: scope,
        sessionScopeId: scopeId,
        promptReceipt:
          managedSession.isNewSession && initialPromptReceipt
            ? initialPromptReceipt
            : promptReceipt,
      };
    } catch (error) {
      if (managedSession) {
        await evictManagedSessionRecord(managedSession.sessionId);
      }

      if (
        scope === 'GENERAL_CHAT' &&
        !resetSession &&
        shouldRetryWithFreshSession(error)
      ) {
        return invokeScopedCapabilitySession({
          capability,
          agent,
          scope,
          scopeId,
          prompt,
          initialPrompt,
          promptReceipt,
          initialPromptReceipt,
          developerPrompt,
          memoryPrompt,
          timeoutMs,
          onDelta,
          resetSession: true,
        });
      }

      if (!shouldFallbackToHttp(error) || !shouldAllowHttpFallback()) {
        throw error;
      }
    }
  }

  const fallbackMessages: ProviderMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: effectivePrompt,
    },
  ];
  const fallbackResult =
    resolveAgentProviderKey(agent) === LOCAL_OPENAI_PROVIDER_KEY
      ? await requestLocalOpenAIModel({
          model: effectiveModel,
          messages: fallbackMessages,
          timeoutMs,
        })
      : await requestGitHubModelsHttp({
          model: await resolveRuntimeModel(effectiveModel),
          messages: fallbackMessages,
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
    promptReceipt: initialPromptReceipt || promptReceipt,
  };
};

export interface BudgetSummaryTurn {
  role: 'assistant' | 'user';
  content: string;
}

export interface BudgetSummaryResult {
  summary: string;
  model: string;
  usage: SessionExchangeResult['usage'] | null;
}

/**
 * Cheap-model summarizer for long tool-loop transcripts (Lever 3 of the
 * token-optimization program — see /Users/ashokraj/.claude/plans/iridescent-tinkering-cocoa.md).
 *
 * Reuses the capability's provider but forces the lowest-affordability model
 * available, using the existing BUDGET_MODEL_HINTS scoring via
 * `pickLowestCostRuntimeModel`. When a prior summary exists, the caller is
 * expected to pass only the new (as-yet unsummarized) older turns so we
 * compound instead of re-summarizing every tick.
 *
 * Returns a 3–4 sentence state note. On any failure (provider down, model
 * unavailable, etc.) the caller is expected to fall back to a truncated raw
 * transcript — the rollup is a cost optimization, not a correctness gate.
 */
export const invokeBudgetModelSummary = async ({
  agent,
  priorSummary,
  newTurns,
  timeoutMs = 30_000,
}: {
  capability?: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  priorSummary: string;
  newTurns: BudgetSummaryTurn[];
  timeoutMs?: number;
}): Promise<BudgetSummaryResult> => {
  if (newTurns.length === 0) {
    return { summary: priorSummary, model: '', usage: null };
  }

  const providerKey = resolveAgentProviderKey(agent);
  const { models } = await listAvailableRuntimeModels().catch(() => ({
    models: getStaticRuntimeModels(),
    fromRuntime: false,
  }));
  const cheapest = pickLowestCostRuntimeModel(models);
  const chosenModel = cheapest?.apiModelId || normalizeModel('gpt-4o-mini');

  const transcript = newTurns
    .map(turn => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join('\n\n');

  // Structured output (Phase 2 / Lever 8): request a JSON state note
  // rather than prose. The main model parses this naturally and can
  // reason about specific fields ("we're blocked on X, pending approval
  // on Y") instead of fuzzy-matching a 3-sentence paragraph.
  const systemPrompt =
    'You compress an agent tool-loop transcript into a compact JSON state note. ' +
    'Output ONLY a single JSON object with these keys (all strings unless noted): ' +
    '{"currentGoal": "...", "lastSuccessfulAction": "...", "currentBlocker": "..." | null, ' +
    '"filesInPlay": ["src/...", "..."], "pendingDecision": "..." | null, ' +
    '"evidenceGenerated": ["artifact:...", "..."]}. ' +
    'Keep every string under 200 chars. Use [] for empty arrays, null for empty scalars. ' +
    'Do not emit markdown fences, prose explanations, or tool JSON outside this object.';

  const userPrompt = [
    priorSummary
      ? `PRIOR STATE NOTE (extend and correct, do not repeat verbatim):\n${priorSummary}`
      : null,
    `NEW TURNS TO FOLD IN:\n${transcript}`,
    'Emit the updated JSON state note now. Return ONLY the JSON object.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: GitHubModelsMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const result = await requestGitHubModel({
    model: chosenModel,
    providerKey,
    messages,
    timeoutMs,
  });

  return {
    summary: (result.content || priorSummary || '').trim(),
    model: result.model || chosenModel,
    usage: result.usage ?? null,
  };
};

export const requestGitHubModel = async ({
  model,
  providerKey,
  messages,
  timeoutMs = 45000,
}: {
  model?: string;
  providerKey?: ProviderKey | string;
  messages: GitHubModelsMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) => {
  if (normalizeProviderKey(providerKey) === LOCAL_OPENAI_PROVIDER_KEY) {
    return requestLocalOpenAIModel({
      model,
      messages,
      timeoutMs,
    });
  }

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
  providerKey,
  messages,
  timeoutMs = 45000,
  onDelta,
}: {
  model?: string;
  providerKey?: ProviderKey | string;
  messages: GitHubModelsMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  onDelta: (delta: string) => void;
}) => {
  if (normalizeProviderKey(providerKey) === LOCAL_OPENAI_PROVIDER_KEY) {
    return requestLocalOpenAIModelStream({
      model,
      messages,
      timeoutMs,
      onDelta,
    });
  }

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
  scope = 'GENERAL_CHAT',
  scopeId,
  resetSession = false,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  history?: ChatHistoryMessage[] | CapabilityChatMessage[];
  message: string;
  developerPrompt?: string;
  memoryPrompt?: string;
  scope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
  temperature?: number;
  resetSession?: boolean;
}) => {
  const normalizedHistory = (history || [])
    .filter(item => item?.content?.trim())
    .map(item => ({
      role: item.role === 'agent' ? 'assistant' : 'user',
      content: item.content!.trim(),
    })) as Array<{ role: 'assistant' | 'user'; content: string }>;
  const resolvedScopeId =
    scopeId || (scope === 'GENERAL_CHAT' ? capability.id : undefined);
  const learningContextBlock = agent.learningProfile?.contextBlock?.trim() || '';
  const copilotGuidanceBlock = capability.id
    ? await loadGuidanceSystemPromptBlock(capability.id, {
        phase: null,
      }).catch(() => null)
    : null;
  const systemPromptSections = buildScopedSystemPromptSections({
    capability,
    agent,
    developerPrompt,
    learningContextBlock,
    copilotGuidanceBlock: copilotGuidanceBlock || undefined,
    scope,
    scopeId: resolvedScopeId,
  });
  const promptPlan = buildChatPromptPlan({
    capability,
    providerKey: resolveAgentProviderKey(agent),
    model: agent.model,
    developerPrompt: systemPromptSections.developerPrompt,
    systemCore: systemPromptSections.systemCore,
    learningContext: systemPromptSections.learningContext,
    repoGuidance: systemPromptSections.repoGuidance,
    activeScope: systemPromptSections.activeScope,
    history: normalizedHistory,
    message: message.trim(),
    memoryPrompt,
  });

  const result = await invokeScopedCapabilitySession({
    capability,
    agent,
    scope,
    scopeId: resolvedScopeId,
    prompt: promptPlan.prompt,
    initialPrompt: promptPlan.initialPrompt,
    promptReceipt: {
      stage: 'capability_chat',
      ...promptPlan.currentReceipt,
    },
    initialPromptReceipt: {
      stage: 'capability_chat',
      ...promptPlan.initialReceipt,
    },
    developerPrompt,
    memoryPrompt: undefined,
    resetSession,
  });

  return {
    ...result,
    tokenPolicy: promptPlan.tokenPolicy,
  };
};

export const invokeCapabilityChatStream = async ({
  capability,
  agent,
  history = [],
  message,
  developerPrompt,
  memoryPrompt,
  onDelta,
  scope = 'GENERAL_CHAT',
  scopeId,
  resetSession = false,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  history?: ChatHistoryMessage[] | CapabilityChatMessage[];
  message: string;
  developerPrompt?: string;
  memoryPrompt?: string;
  onDelta: (delta: string) => void;
  scope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
  temperature?: number;
  resetSession?: boolean;
}) => {
  const normalizedHistory = (history || [])
    .filter(item => item?.content?.trim())
    .map(item => ({
      role: item.role === 'agent' ? 'assistant' : 'user',
      content: item.content!.trim(),
    })) as Array<{ role: 'assistant' | 'user'; content: string }>;
  const resolvedScopeId =
    scopeId || (scope === 'GENERAL_CHAT' ? capability.id : undefined);
  const learningContextBlock = agent.learningProfile?.contextBlock?.trim() || '';
  const copilotGuidanceBlock = capability.id
    ? await loadGuidanceSystemPromptBlock(capability.id, {
        phase: null,
      }).catch(() => null)
    : null;
  const systemPromptSections = buildScopedSystemPromptSections({
    capability,
    agent,
    developerPrompt,
    learningContextBlock,
    copilotGuidanceBlock: copilotGuidanceBlock || undefined,
    scope,
    scopeId: resolvedScopeId,
  });
  const promptPlan = buildChatPromptPlan({
    capability,
    providerKey: resolveAgentProviderKey(agent),
    model: agent.model,
    developerPrompt: systemPromptSections.developerPrompt,
    systemCore: systemPromptSections.systemCore,
    learningContext: systemPromptSections.learningContext,
    repoGuidance: systemPromptSections.repoGuidance,
    activeScope: systemPromptSections.activeScope,
    history: normalizedHistory,
    message: message.trim(),
    memoryPrompt,
  });

  const result = await invokeScopedCapabilitySession({
    capability,
    agent,
    scope,
    scopeId: resolvedScopeId,
    prompt: promptPlan.prompt,
    initialPrompt: promptPlan.initialPrompt,
    promptReceipt: {
      stage: 'capability_chat',
      ...promptPlan.currentReceipt,
    },
    initialPromptReceipt: {
      stage: 'capability_chat',
      ...promptPlan.initialReceipt,
    },
    developerPrompt,
    memoryPrompt: undefined,
    onDelta,
    resetSession,
  });

  return {
    ...result,
    tokenPolicy: promptPlan.tokenPolicy,
  };
};
