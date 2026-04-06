import type {
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityMetadataEntry,
  CapabilityStakeholder,
} from '../src/types';

export type ChatHistoryMessage = {
  role?: 'user' | 'agent';
  content?: string;
};

type InferenceUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type GitHubModelsMessage = {
  role: 'developer' | 'system' | 'user' | 'assistant';
  content: string;
};

export const githubModelsApiUrl = (
  process.env.GITHUB_MODELS_API_URL || 'https://models.github.ai/inference'
).replace(/\/$/, '');

export const defaultModel = 'openai/gpt-4.1-mini';

export const staticModels = [
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', profile: 'Lower cost' },
  { id: 'gpt-4.1', label: 'GPT-4.1', profile: 'Balanced reasoning' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', profile: 'Fast multimodal' },
  { id: 'gpt-4o', label: 'GPT-4o', profile: 'Broader capability' },
] as const;

const modelAliases: Record<string, string> = {
  'gpt-4.1-mini': 'openai/gpt-4.1-mini',
  'gpt-4.1': 'openai/gpt-4.1',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gpt-4o': 'openai/gpt-4o',
  'o4-mini': 'openai/o4-mini',
  'o3': 'openai/o3',
};

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

export const getConfiguredToken = () =>
  process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN || '';

export const normalizeModel = (model?: string) => {
  const cleaned = model?.trim();
  if (!cleaned) {
    return defaultModel;
  }

  if (cleaned.includes('/')) {
    return cleaned;
  }

  return modelAliases[cleaned] || `openai/${cleaned}`;
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

const getAssistantContent = (payload: any) => {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }
        if (typeof item?.text === 'string') {
          return item.text;
        }
        if (typeof item?.content === 'string') {
          return item.content;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
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

export const getErrorMessage = async (response: Response) => {
  const fallback = `GitHub Models request failed with status ${response.status}.`;

  try {
    const payload = await response.json();
    if (typeof payload?.error === 'string') {
      return payload.error;
    }
    if (typeof payload?.message === 'string') {
      return payload.message;
    }
    return fallback;
  } catch {
    try {
      const text = await response.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
};

export const requestGitHubModel = async ({
  model,
  messages,
  maxTokens = 1200,
  temperature = 0.2,
  timeoutMs = 45000,
}: {
  model?: string;
  messages: GitHubModelsMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) => {
  const token = getConfiguredToken();
  if (!token) {
    throw new Error(
      'GitHub Models is not configured. Add GITHUB_MODELS_TOKEN to .env.local and restart the server.',
    );
  }

  const resolvedModel = normalizeModel(model);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${githubModelsApiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: resolvedModel,
      messages,
      max_tokens: Math.max(256, Math.min(Number(maxTokens || 1200), 8000)),
      temperature,
      stream: false,
    }),
  });
  clearTimeout(timeoutHandle);

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  const result = await response.json();
  const content = getAssistantContent(result);
  if (!content) {
    throw new Error('GitHub Models returned an empty response for this request.');
  }

  return {
    content,
    model: resolvedModel,
    usage: toUsage(result?.usage),
    responseId: result?.id || null,
    createdAt: new Date().toISOString(),
    raw: result,
  };
};

const getDeltaContent = (payload: any) => {
  const delta = payload?.choices?.[0]?.delta;
  if (typeof delta?.content === 'string') {
    return delta.content;
  }
  if (Array.isArray(delta?.content)) {
    return delta.content
      .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
      .join('');
  }
  return '';
};

export const requestGitHubModelStream = async ({
  model,
  messages,
  maxTokens = 1200,
  temperature = 0.2,
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
  const token = getConfiguredToken();
  if (!token) {
    throw new Error(
      'GitHub Models is not configured. Add GITHUB_MODELS_TOKEN to .env.local and restart the server.',
    );
  }

  const resolvedModel = normalizeModel(model);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(`${githubModelsApiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: resolvedModel,
      messages,
      max_tokens: Math.max(256, Math.min(Number(maxTokens || 1200), 8000)),
      temperature,
      stream: true,
    }),
  });

  if (!response.ok) {
    clearTimeout(timeoutHandle);
    throw new Error(await getErrorMessage(response));
  }

  if (!response.body) {
    clearTimeout(timeoutHandle);
    throw new Error('Streaming response body was not available.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let fullContent = '';
  let usage: ReturnType<typeof toUsage> | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffered += decoder.decode(value, { stream: true });
    const frames = buffered.split('\n\n');
    buffered = frames.pop() || '';

    for (const frame of frames) {
      const dataLines = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.replace(/^data:\s*/, '').trim())
        .filter(Boolean);

      for (const line of dataLines) {
        if (line === '[DONE]') {
          continue;
        }
        const payload = JSON.parse(line);
        if (payload?.usage) {
          usage = toUsage(payload.usage);
        }
        const delta = getDeltaContent(payload);
        if (delta) {
          fullContent += delta;
          onDelta(delta);
        }
      }
    }
  }
  clearTimeout(timeoutHandle);

  return {
    content: fullContent,
    model: resolvedModel,
    createdAt: new Date().toISOString(),
    usage: usage || toUsage(undefined),
  };
};

export const invokeCapabilityChat = async ({
  capability,
  agent,
  history = [],
  message,
  developerPrompt,
  memoryPrompt,
  temperature = 0.2,
}: {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  history?: ChatHistoryMessage[] | CapabilityChatMessage[];
  message: string;
  developerPrompt?: string;
  memoryPrompt?: string;
  temperature?: number;
}) => {
  const normalizedHistory = (history || [])
    .filter(item => item?.content?.trim())
    .slice(-10)
    .map(item => ({
      role: item.role === 'agent' ? 'assistant' : 'user',
      content: item.content!.trim(),
    })) as GitHubModelsMessage[];

  return requestGitHubModel({
    model: agent.model,
    temperature,
    maxTokens: Number(agent.tokenLimit || 1200),
    messages: [
      {
        role: 'developer',
        content:
          developerPrompt ||
          'You are operating inside an enterprise capability workspace. Stay scoped to the provided capability and agent context, and be explicit when context is missing.',
      },
      {
        role: 'system',
        content: [buildCapabilitySystemPrompt({ capability, agent }), memoryPrompt]
          .filter(Boolean)
          .join('\n\n'),
      },
      ...normalizedHistory,
      {
        role: 'user',
        content: message.trim(),
      },
    ],
  });
};
