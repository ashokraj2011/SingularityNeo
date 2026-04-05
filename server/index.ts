import dotenv from 'dotenv';
import express from 'express';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityMetadataEntry,
  CapabilityStakeholder,
  CapabilityWorkspace,
  Skill,
} from '../src/types';
import { initializeDatabase } from './db';
import {
  addCapabilityAgentRecord,
  addCapabilitySkillRecord,
  appendCapabilityMessageRecord,
  createCapabilityRecord,
  fetchAppState,
  getCapabilityBundle,
  initializeSeedData,
  removeCapabilitySkillRecord,
  replaceCapabilityWorkspaceContentRecord,
  setActiveChatAgentRecord,
  updateCapabilityAgentRecord,
  updateCapabilityRecord,
} from './repository';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || '3001');
const githubModelsApiUrl = (
  process.env.GITHUB_MODELS_API_URL || 'https://models.github.ai/inference'
).replace(/\/$/, '');
const defaultModel = 'openai/gpt-4.1-mini';
const execFileAsync = promisify(execFile);
const staticModels = [
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

type ChatHistoryMessage = {
  role?: 'user' | 'agent';
  content?: string;
};

type ChatRequestBody = {
  capability?: {
    id?: string;
    name?: string;
    description?: string;
    domain?: string;
    parentCapabilityId?: string;
    businessUnit?: string;
    ownerTeam?: string;
    teamNames?: string[];
    stakeholders?: CapabilityStakeholder[];
    confluenceLink?: string;
    jiraBoardLink?: string;
    documentationNotes?: string;
    applications?: string[];
    apis?: string[];
    databases?: string[];
    gitRepositories?: string[];
    localDirectories?: string[];
    additionalMetadata?: CapabilityMetadataEntry[];
  };
  agent?: {
    id?: string;
    name?: string;
    role?: string;
    objective?: string;
    systemPrompt?: string;
    documentationSources?: string[];
    learningNotes?: string[];
    inputArtifacts?: string[];
    outputArtifacts?: string[];
    skillIds?: string[];
    model?: string;
    tokenLimit?: number;
  };
  history?: ChatHistoryMessage[];
  message?: string;
};

type WorkspacePatchBody = Partial<
  Pick<
    CapabilityWorkspace,
    | 'workflows'
    | 'artifacts'
    | 'tasks'
    | 'executionLogs'
    | 'learningUpdates'
    | 'workItems'
    | 'activeChatAgentId'
  >
>;

type InferenceUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type CodeWorkspaceStatus = {
  path: string;
  exists: boolean;
  isGitRepository: boolean;
  currentBranch: string | null;
  pendingChanges: number;
  lastCommit: string | null;
  error?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(projectRoot, 'dist');

const getConfiguredToken = () =>
  process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN || '';

const normalizeModel = (model?: string) => {
  const cleaned = model?.trim();
  if (!cleaned) {
    return defaultModel;
  }

  if (cleaned.includes('/')) {
    return cleaned;
  }

  return modelAliases[cleaned] || `openai/${cleaned}`;
};

const normalizeDirectoryPath = (value: string) => path.resolve(value.trim());

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

const runGitCommand = async (directoryPath: string, args: string[]) => {
  const result = await execFileAsync('git', ['-C', directoryPath, ...args], {
    cwd: directoryPath,
  });
  return (result.stdout || '').trim();
};

const inspectCodeWorkspace = async (directoryPath: string): Promise<CodeWorkspaceStatus> => {
  const resolvedPath = normalizeDirectoryPath(directoryPath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      exists: false,
      isGitRepository: false,
      currentBranch: null,
      pendingChanges: 0,
      lastCommit: null,
      error: 'Directory not found.',
    };
  }

  try {
    const gitStatus = await runGitCommand(resolvedPath, ['rev-parse', '--is-inside-work-tree']);
    if (gitStatus !== 'true') {
      return {
        path: resolvedPath,
        exists: true,
        isGitRepository: false,
        currentBranch: null,
        pendingChanges: 0,
        lastCommit: null,
        error: 'Directory is not a Git repository.',
      };
    }

    const [currentBranch, pendingStatus, lastCommit] = await Promise.all([
      runGitCommand(resolvedPath, ['branch', '--show-current']),
      runGitCommand(resolvedPath, ['status', '--short']),
      runGitCommand(resolvedPath, ['log', '-1', '--pretty=%h %s']).catch(() => ''),
    ]);

    return {
      path: resolvedPath,
      exists: true,
      isGitRepository: true,
      currentBranch: currentBranch || null,
      pendingChanges: pendingStatus ? pendingStatus.split('\n').filter(Boolean).length : 0,
      lastCommit: lastCommit || null,
    };
  } catch (error) {
    return {
      path: resolvedPath,
      exists: true,
      isGitRepository: false,
      currentBranch: null,
      pendingChanges: 0,
      lastCommit: null,
      error: error instanceof Error ? error.message : 'Unable to inspect repository.',
    };
  }
};

const buildSystemPrompt = (body: ChatRequestBody) => {
  const capability = body.capability || {};
  const agent = body.agent || {};

  return [
    `Capability boundary: ${capability.name || capability.id || 'Unknown capability'}`,
    capability.description ? `Capability description: ${capability.description}` : null,
    capability.domain ? `Capability domain: ${capability.domain}` : null,
    capability.parentCapabilityId
      ? `Parent capability: ${capability.parentCapabilityId}`
      : null,
    capability.businessUnit ? `Business unit: ${capability.businessUnit}` : null,
    capability.ownerTeam ? `Owner team: ${capability.ownerTeam}` : null,
    toPromptSection('Associated teams', capability.teamNames),
    toStakeholderSection(capability.stakeholders),
    agent.name ? `Active agent: ${agent.name}` : null,
    agent.role ? `Agent role: ${agent.role}` : null,
    agent.objective ? `Agent objective: ${agent.objective}` : null,
    agent.systemPrompt ? `Agent instructions: ${agent.systemPrompt}` : null,
    toPromptSection('Documentation sources', agent.documentationSources),
    toPromptSection('Learning notes', agent.learningNotes),
    toPromptSection('Input artifacts', agent.inputArtifacts),
    toPromptSection('Output artifacts', agent.outputArtifacts),
    toPromptSection('Skill tags', agent.skillIds),
    toPromptSection('Applications', capability.applications),
    toPromptSection('APIs', capability.apis),
    toPromptSection('Databases', capability.databases),
    toPromptSection('Git repositories', capability.gitRepositories),
    toPromptSection('Local directories', capability.localDirectories),
    toMetadataEntrySection(capability.additionalMetadata),
    capability.confluenceLink ? `Confluence reference: ${capability.confluenceLink}` : null,
    capability.jiraBoardLink ? `Jira board reference: ${capability.jiraBoardLink}` : null,
    capability.documentationNotes
      ? `Capability documentation notes: ${capability.documentationNotes}`
      : null,
    'Keep the response inside this capability context. If capability context is missing for a claim, say so clearly instead of inventing it.',
    'Prefer practical, execution-ready answers that help the team move work forward.',
  ]
    .filter(Boolean)
    .join('\n');
};

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

const toUsage = (usage: InferenceUsage | undefined) => {
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

const getErrorMessage = async (response: Response) => {
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

const sendRepositoryError = (response: express.Response, error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'The persistence request failed unexpectedly.';
  const status = /not found/i.test(message) ? 404 : 500;

  response.status(status).json({ error: message });
};

app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization',
  );

  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: '2mb' }));

app.get('/api/state', async (_request, response) => {
  try {
    response.json(await fetchAppState());
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId', async (request, response) => {
  try {
    response.json(await getCapabilityBundle(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities', async (request, response) => {
  const capability = request.body as Capability | undefined;
  if (!capability?.id || !capability?.name || !capability?.description) {
    response
      .status(400)
      .json({ error: 'Capability id, name, and description are required.' });
    return;
  }

  try {
    response.status(201).json(await createCapabilityRecord(capability));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/capabilities/:capabilityId', async (request, response) => {
  try {
    response.json(
      await updateCapabilityRecord(
        request.params.capabilityId,
        request.body as Partial<Capability>,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/skills', async (request, response) => {
  const skill = request.body as Skill | undefined;
  if (!skill?.id || !skill?.name || !skill?.description) {
    response
      .status(400)
      .json({ error: 'Skill id, name, and description are required.' });
    return;
  }

  try {
    response.status(201).json(
      await addCapabilitySkillRecord(request.params.capabilityId, skill),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.delete(
  '/api/capabilities/:capabilityId/skills/:skillId',
  async (request, response) => {
    try {
      response.json(
        await removeCapabilitySkillRecord(
          request.params.capabilityId,
          request.params.skillId,
        ),
      );
    } catch (error) {
      sendRepositoryError(response, error);
    }
  },
);

app.post('/api/capabilities/:capabilityId/agents', async (request, response) => {
  const agent = request.body as Omit<CapabilityAgent, 'capabilityId'> | undefined;
  if (!agent?.id || !agent?.name || !agent?.role || !agent?.objective) {
    response
      .status(400)
      .json({ error: 'Agent id, name, role, and objective are required.' });
    return;
  }

  try {
    response.status(201).json(
      await addCapabilityAgentRecord(request.params.capabilityId, agent),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch(
  '/api/capabilities/:capabilityId/agents/:agentId',
  async (request, response) => {
    try {
      response.json(
        await updateCapabilityAgentRecord(
          request.params.capabilityId,
          request.params.agentId,
          request.body as Partial<CapabilityAgent>,
        ),
      );
    } catch (error) {
      sendRepositoryError(response, error);
    }
  },
);

app.post('/api/capabilities/:capabilityId/messages', async (request, response) => {
  const message = request.body as Omit<CapabilityChatMessage, 'capabilityId'> | undefined;
  if (!message?.id || !message?.content || !message?.role || !message?.timestamp) {
    response.status(400).json({
      error: 'Message id, role, content, and timestamp are required.',
    });
    return;
  }

  try {
    response.status(201).json(
      await appendCapabilityMessageRecord(request.params.capabilityId, message),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/capabilities/:capabilityId/chat-agent', async (request, response) => {
  const agentId = String(request.body?.agentId || '').trim();
  if (!agentId) {
    response.status(400).json({ error: 'An agentId is required.' });
    return;
  }

  try {
    response.json(
      await setActiveChatAgentRecord(request.params.capabilityId, agentId),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/capabilities/:capabilityId/workspace', async (request, response) => {
  try {
    response.json(
      await replaceCapabilityWorkspaceContentRecord(
        request.params.capabilityId,
        request.body as WorkspacePatchBody,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/code-workspaces', async (request, response) => {
  try {
    const bundle = await getCapabilityBundle(request.params.capabilityId);
    const workspaces = await Promise.all(
      bundle.capability.localDirectories.map(directoryPath =>
        inspectCodeWorkspace(directoryPath),
      ),
    );

    response.json(workspaces);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post(
  '/api/capabilities/:capabilityId/code-workspaces/branch',
  async (request, response) => {
    const requestedPath = String(request.body?.path || '').trim();
    const branchName = String(request.body?.branchName || '').trim();

    if (!requestedPath || !branchName) {
      response.status(400).json({
        error: 'Both path and branchName are required.',
      });
      return;
    }

    try {
      const bundle = await getCapabilityBundle(request.params.capabilityId);
      const allowedPaths = new Set(
        bundle.capability.localDirectories.map(normalizeDirectoryPath),
      );
      const resolvedPath = normalizeDirectoryPath(requestedPath);

      if (!allowedPaths.has(resolvedPath)) {
        response.status(403).json({
          error:
            'This directory is not registered under the selected capability.',
        });
        return;
      }

      const existingBranch = await runGitCommand(resolvedPath, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${branchName}`,
      ]).catch(() => '');

      if (existingBranch) {
        response.status(409).json({
          error: `Branch ${branchName} already exists in ${resolvedPath}.`,
        });
        return;
      }

      await runGitCommand(resolvedPath, ['switch', '-c', branchName]);
      response.status(201).json(await inspectCodeWorkspace(resolvedPath));
    } catch (error) {
      response.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create the Git branch for this directory.',
      });
    }
  },
);

app.get('/api/runtime/status', (_request, response) => {
  const token = getConfiguredToken();

  response.json({
    configured: Boolean(token),
    provider: 'GitHub Copilot API',
    endpoint: `${githubModelsApiUrl}/chat/completions`,
    tokenSource: process.env.GITHUB_MODELS_TOKEN
      ? 'GITHUB_MODELS_TOKEN'
      : process.env.GITHUB_TOKEN
        ? 'GITHUB_TOKEN'
        : null,
    defaultModel,
    availableModels: staticModels.map(model => ({
      ...model,
      apiModelId: normalizeModel(model.id),
    })),
  });
});

app.post('/api/runtime/chat', async (request, response) => {
  const token = getConfiguredToken();
  if (!token) {
    response.status(503).json({
      error:
        'GitHub Models is not configured. Add GITHUB_MODELS_TOKEN to .env.local and restart the server.',
    });
    return;
  }

  const body = request.body as ChatRequestBody;
  const message = body.message?.trim();

  if (!message) {
    response.status(400).json({ error: 'A chat message is required.' });
    return;
  }

  const model = normalizeModel(body.agent?.model);
  const history = (body.history || [])
    .filter(item => item?.content?.trim())
    .slice(-10)
    .map(item => ({
      role: item.role === 'agent' ? 'assistant' : 'user',
      content: item.content!.trim(),
    }));

  const payload = {
    model,
    messages: [
      {
        role: 'developer',
        content:
          'You are operating inside an enterprise capability workspace. Stay scoped to the provided capability and agent context, and be explicit when context is missing.',
      },
      {
        role: 'system',
        content: buildSystemPrompt(body),
      },
      ...history,
      {
        role: 'user',
        content: message,
      },
    ],
    max_tokens: Math.max(256, Math.min(Number(body.agent?.tokenLimit || 1200), 8000)),
    temperature: 0.2,
    stream: false,
  };

  try {
    const githubResponse = await fetch(`${githubModelsApiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(payload),
    });

    if (!githubResponse.ok) {
      response.status(githubResponse.status).json({
        error: await getErrorMessage(githubResponse),
      });
      return;
    }

    const result = await githubResponse.json();
    const content = getAssistantContent(result);

    if (!content) {
      response.status(502).json({
        error: 'GitHub Models returned an empty response for this request.',
      });
      return;
    }

    response.json({
      content,
      model,
      usage: toUsage(result?.usage),
      responseId: result?.id || null,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    response.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'The GitHub Models request failed unexpectedly.',
    });
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));

  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.resolve(distDir, 'index.html'));
  });
}

const startServer = async () => {
  await initializeDatabase();
  await initializeSeedData();

  app.listen(port, () => {
    console.log(`Singularity Neo API listening on http://localhost:${port}`);
  });
};

void startServer().catch(error => {
  console.error('Failed to start Singularity Neo API.', error);
  process.exit(1);
});
