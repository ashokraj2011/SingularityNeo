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
  CapabilityWorkspace,
  Skill,
  WorkItem,
  WorkItemPhase,
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
import {
  getWorkflowRunDetail,
  listRecentWorkflowRunEvents,
  listWorkflowRunEvents,
  listWorkflowRunsByCapability,
  listWorkflowRunsForWorkItem,
} from './execution/repository';
import {
  approveWorkflowRun,
  cancelWorkflowRun,
  createWorkItemRecord,
  moveWorkItemToPhaseControl,
  provideWorkflowRunInput,
  resolveWorkflowRunConflict,
  restartWorkflowRun,
  startWorkflowExecution,
} from './execution/service';
import { startExecutionWorker, wakeExecutionWorker } from './execution/worker';
import {
  buildWorkItemEvidenceBundle,
  getCompletedWorkOrderEvidence,
  getLedgerArtifactContent,
  listCompletedWorkOrders,
  listLedgerArtifacts,
} from './ledger';
import {
  GitHubProviderRateLimitError,
  defaultModel,
  getConfiguredToken,
  getConfiguredTokenSource,
  invokeCapabilityChat,
  invokeCapabilityChatStream,
  listManagedCopilotSessions,
  listAvailableRuntimeModels,
  normalizeModel,
  type ChatHistoryMessage,
} from './githubModels';
import { buildMemoryContext, listMemoryDocuments, refreshCapabilityMemory, searchCapabilityMemory } from './memory';
import {
  ensureAgentLearningBackfill,
  getAgentLearningProfileDetail,
  queueCapabilityAgentLearningRefresh,
  queueSingleAgentLearningRefresh,
} from './agentLearning/service';
import {
  startAgentLearningWorker,
  wakeAgentLearningWorker,
} from './agentLearning/worker';
import { evaluateBranchPolicy, listPolicyDecisions } from './policy';
import { subscribeToRunEvents } from './eventBus';
import { getEvalRunDetail, listEvalRuns, listEvalSuites, runEvalSuite } from './evals';
import {
  buildRunConsoleSnapshot,
  createTraceId,
  finishTelemetrySpan,
  listTelemetryMetrics,
  listTelemetrySpans,
  recordUsageMetrics,
  startTelemetrySpan,
} from './telemetry';
import { getMissingRuntimeConfigurationMessage } from './runtimePolicy';
import { sendApiError } from './api/errors';
import { buildRuntimeStatus } from './runtimeStatus';
import { registerRuntimeRoutes } from './routes/runtime';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || '3001');
const execFileAsync = promisify(execFile);

const slugify = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

const createRuntimeId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const ensureCapabilityCreatePayload = (
  capability: Partial<Capability> | undefined,
): Capability | null => {
  if (!capability?.name || !capability?.description) {
    return null;
  }

  return {
    ...capability,
    id: capability.id?.trim() || createRuntimeId('CAP'),
    domain: capability.domain || '',
    description: capability.description,
    applications: capability.applications || [],
    apis: capability.apis || [],
    databases: capability.databases || [],
    gitRepositories: capability.gitRepositories || [],
    localDirectories: capability.localDirectories || [],
    teamNames: capability.teamNames || [],
    stakeholders: capability.stakeholders || [],
    additionalMetadata: capability.additionalMetadata || [],
    skillLibrary: capability.skillLibrary || [],
    status: capability.status || 'PENDING',
    executionConfig: capability.executionConfig || {
      allowedWorkspacePaths: [],
      commandTemplates: [],
      deploymentTargets: [],
    },
  } as Capability;
};

const ensureAgentCreatePayload = (
  capabilityId: string,
  agent: Partial<Omit<CapabilityAgent, 'capabilityId'>> | undefined,
): Omit<CapabilityAgent, 'capabilityId'> | null => {
  if (!agent?.name || !agent?.role || !agent?.objective) {
    return null;
  }

  return {
    ...agent,
    id:
      agent.id?.trim() ||
      `AGENT-${slugify(capabilityId)}-${slugify(agent.name || 'CUSTOM')}-${Math.random()
        .toString(36)
        .slice(2, 5)
        .toUpperCase()}`,
    name: agent.name,
    role: agent.role,
    objective: agent.objective,
    systemPrompt: agent.systemPrompt || '',
    initializationStatus: agent.initializationStatus || 'READY',
    documentationSources: agent.documentationSources || [],
    inputArtifacts: agent.inputArtifacts || [],
    outputArtifacts: agent.outputArtifacts || [],
    learningNotes: agent.learningNotes || [],
    skillIds: agent.skillIds || [],
    provider: agent.provider || 'GitHub Copilot SDK',
    model: agent.model || defaultModel,
    tokenLimit:
      typeof agent.tokenLimit === 'number' && Number.isFinite(agent.tokenLimit)
        ? agent.tokenLimit
        : 12000,
    learningProfile: agent.learningProfile,
    sessionSummaries: agent.sessionSummaries || [],
    usage: agent.usage,
    previousOutputs: agent.previousOutputs || [],
    isBuiltIn: agent.isBuiltIn,
    isOwner: agent.isOwner,
  } as Omit<CapabilityAgent, 'capabilityId'>;
};

const resolveWritableAgentModel = async (requestedModel?: string) => {
  const requested = normalizeModel(requestedModel || defaultModel);

  try {
    const { models } = await listAvailableRuntimeModels();
    const selected =
      models.find(
        model =>
          normalizeModel(model.id) === requested ||
          normalizeModel(model.apiModelId) === requested,
      ) || models[0];

    return selected?.apiModelId || requested;
  } catch {
    return requested;
  }
};

type ChatRequestBody = {
  capability?: Capability;
  agent?: CapabilityAgent;
  history?: ChatHistoryMessage[];
  message?: string;
  sessionMode?: 'resume' | 'fresh';
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

const normalizeDirectoryPath = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? path.resolve(trimmed) : '';
};

const getCapabilityWorkspaceRoots = (capability: Capability) =>
  Array.from(
    new Set(
      [
        capability.executionConfig?.defaultWorkspacePath,
        ...(capability.executionConfig?.allowedWorkspacePaths || []),
        ...(capability.localDirectories || []),
      ]
        .map(value => normalizeDirectoryPath(value || ''))
        .filter(Boolean),
    ),
  );
const toSafeDownloadName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'evidence';

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

const sendRepositoryError = (response: express.Response, error: unknown) => {
  sendApiError(response, error);
};

const parseActor = (value: unknown, fallback: string) => {
  const actor = String(value || '').trim();
  return actor || fallback;
};

const writeSseEvent = (
  response: express.Response,
  event: string,
  payload: unknown,
) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const isRuntimeConfigured = () => {
  const tokenSource = getConfiguredTokenSource();
  return tokenSource === 'headless-cli' || Boolean(getConfiguredToken());
};

const buildCopilotSessionMonitorSnapshot = async (capabilityId: string) => {
  const [bundle, runtimeStatus] = await Promise.all([
    getCapabilityBundle(capabilityId),
    buildRuntimeStatus(),
  ]);
  const managedSessions = listManagedCopilotSessions().filter(
    session => session.capabilityId === capabilityId,
  );
  const liveSessionIds = new Set(managedSessions.map(session => session.sessionId));
  const sessionRows = new Map<
    string,
    {
      sessionId: string;
      agentId?: string;
      agentName: string;
      scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
      scopeId?: string;
      lastUsedAt: string;
      createdAt?: string;
      model: string;
      requestCount: number;
      totalTokens: number;
      live: boolean;
      resumable: boolean;
      state: 'ACTIVE' | 'STORED';
    }
  >();

  bundle.workspace.agents.forEach(agent => {
    agent.sessionSummaries.forEach(session => {
      sessionRows.set(session.sessionId, {
        sessionId: session.sessionId,
        agentId: agent.id,
        agentName: agent.name,
        scope: session.scope,
        scopeId: session.scopeId,
        lastUsedAt: session.lastUsedAt,
        model: session.model,
        requestCount: session.requestCount,
        totalTokens: session.totalTokens,
        live: liveSessionIds.has(session.sessionId),
        resumable: true,
        state: liveSessionIds.has(session.sessionId) ? 'ACTIVE' : 'STORED',
      });
    });
  });

  managedSessions.forEach(session => {
    const current = sessionRows.get(session.sessionId);
    sessionRows.set(session.sessionId, {
      sessionId: session.sessionId,
      agentId: current?.agentId || session.agentId,
      agentName: current?.agentName || session.agentName || 'Unknown agent',
      scope: current?.scope || session.scope || 'GENERAL_CHAT',
      scopeId: current?.scopeId || session.scopeId,
      lastUsedAt: current?.lastUsedAt || session.lastUsedAt,
      createdAt: session.createdAt,
      model: current?.model || session.model || runtimeStatus.defaultModel,
      requestCount: current?.requestCount || 0,
      totalTokens: current?.totalTokens || 0,
      live: true,
      resumable: true,
      state: 'ACTIVE',
    });
  });

  const sessions = [...sessionRows.values()].sort(
    (left, right) =>
      new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime(),
  );

  return {
    capabilityId,
    runtime: {
      configured: runtimeStatus.configured,
      provider: runtimeStatus.provider,
      runtimeAccessMode: runtimeStatus.runtimeAccessMode,
      tokenSource: runtimeStatus.tokenSource,
      defaultModel: runtimeStatus.defaultModel,
      githubIdentity: runtimeStatus.githubIdentity
        ? {
            login: runtimeStatus.githubIdentity.login,
            name: runtimeStatus.githubIdentity.name,
          }
        : null,
      activeManagedSessions: managedSessions.length,
    },
    summary: {
      activeSessionCount: sessions.filter(session => session.live).length,
      storedSessionCount: sessions.length,
      resumableSessionCount: sessions.filter(session => session.resumable).length,
      totalTokens: sessions.reduce((total, session) => total + session.totalTokens, 0),
      generalChatCount: sessions.filter(session => session.scope === 'GENERAL_CHAT').length,
      workItemCount: sessions.filter(session => session.scope === 'WORK_ITEM').length,
      taskCount: sessions.filter(session => session.scope === 'TASK').length,
    },
    sessions,
  };
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

app.get('/api/capabilities/:capabilityId/run-console', async (request, response) => {
  try {
    const capabilityId = request.params.capabilityId;
    const [recentRuns, recentEvents, recentPolicyDecisions] = await Promise.all([
      listWorkflowRunsByCapability(capabilityId),
      listRecentWorkflowRunEvents(capabilityId),
      listPolicyDecisions(capabilityId),
    ]);

    response.json(
      await buildRunConsoleSnapshot(
        capabilityId,
        recentRuns,
        recentEvents,
        recentPolicyDecisions,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/copilot-sessions', async (request, response) => {
  try {
    response.json(
      await buildCopilotSessionMonitorSnapshot(request.params.capabilityId),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/telemetry/spans', async (request, response) => {
  try {
    response.json(
      await listTelemetrySpans(
        request.params.capabilityId,
        Number(request.query.limit || 80),
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/telemetry/metrics', async (request, response) => {
  try {
    response.json(
      await listTelemetryMetrics(
        request.params.capabilityId,
        Number(request.query.limit || 120),
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/memory/documents', async (request, response) => {
  try {
    response.json(
      await listMemoryDocuments(
        request.params.capabilityId,
        String(request.query.agentId || '').trim() || undefined,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/memory/search', async (request, response) => {
  try {
    response.json(
      await searchCapabilityMemory({
        capabilityId: request.params.capabilityId,
        agentId: String(request.query.agentId || '').trim() || undefined,
        queryText: String(request.query.q || ''),
        limit: Number(request.query.limit || 8),
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/memory/refresh', async (request, response) => {
  try {
    const documents = await refreshCapabilityMemory(request.params.capabilityId, {
      requeueAgents: true,
      requestReason: 'manual-memory-refresh',
    });
    wakeAgentLearningWorker();
    response.json(documents);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/agents/:agentId/learning', async (request, response) => {
  try {
    response.json(
      await getAgentLearningProfileDetail(
        request.params.capabilityId,
        request.params.agentId,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/agents/:agentId/learning/refresh', async (request, response) => {
  try {
    await queueSingleAgentLearningRefresh(
      request.params.capabilityId,
      request.params.agentId,
      'manual-agent-refresh',
    );
    wakeAgentLearningWorker();
    response.json(
      await getAgentLearningProfileDetail(
        request.params.capabilityId,
        request.params.agentId,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/evals/suites', async (request, response) => {
  try {
    response.json(await listEvalSuites(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/evals/runs', async (request, response) => {
  try {
    response.json(await listEvalRuns(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/evals/runs/:runId', async (request, response) => {
  try {
    response.json(
      await getEvalRunDetail(
        request.params.capabilityId,
        request.params.runId,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/evals/suites/:suiteId/run', async (request, response) => {
  try {
    response.status(201).json(
      await runEvalSuite(
        request.params.capabilityId,
        request.params.suiteId,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/ledger/artifacts', async (request, response) => {
  try {
    response.json(await listLedgerArtifacts(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get(
  '/api/capabilities/:capabilityId/ledger/completed-work-orders',
  async (request, response) => {
    try {
      response.json(await listCompletedWorkOrders(request.params.capabilityId));
    } catch (error) {
      sendRepositoryError(response, error);
    }
  },
);

app.get('/api/capabilities/:capabilityId/work-items/:workItemId/evidence', async (request, response) => {
  try {
    response.json(
      await getCompletedWorkOrderEvidence(
        request.params.capabilityId,
        request.params.workItemId,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/artifacts/:artifactId/content', async (request, response) => {
  try {
    response.json(
      await getLedgerArtifactContent(
        request.params.capabilityId,
        request.params.artifactId,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/artifacts/:artifactId/download', async (request, response) => {
  try {
    const content = await getLedgerArtifactContent(
      request.params.capabilityId,
      request.params.artifactId,
    );
    response.setHeader('Content-Type', content.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${content.fileName}"`,
    );
    response.send(
      content.contentFormat === 'JSON'
        ? JSON.stringify(content.contentJson || {}, null, 2)
        : content.contentText || '',
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get(
  '/api/capabilities/:capabilityId/work-items/:workItemId/evidence-bundle',
  async (request, response) => {
    try {
      const bundle = await buildWorkItemEvidenceBundle(
        request.params.capabilityId,
        request.params.workItemId,
      );
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${toSafeDownloadName(bundle.detail.workItem.title)}-evidence-bundle.json"`,
      );
      response.send(JSON.stringify(bundle, null, 2));
    } catch (error) {
      sendRepositoryError(response, error);
    }
  },
);

app.post('/api/capabilities', async (request, response) => {
  const capability = ensureCapabilityCreatePayload(
    request.body as Partial<Capability> | undefined,
  );
  if (!capability) {
    response.status(400).json({
      error: 'Capability name and description are required.',
    });
    return;
  }

  try {
    await createCapabilityRecord(capability);
    await queueCapabilityAgentLearningRefresh(capability.id, 'capability-created');
    wakeAgentLearningWorker();
    response.status(201).json(await getCapabilityBundle(capability.id));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/capabilities/:capabilityId', async (request, response) => {
  try {
    await updateCapabilityRecord(
      request.params.capabilityId,
      request.body as Partial<Capability>,
    );
    await refreshCapabilityMemory(request.params.capabilityId, {
      requeueAgents: true,
      requestReason: 'capability-updated',
    }).catch(() => undefined);
    await queueCapabilityAgentLearningRefresh(
      request.params.capabilityId,
      'capability-updated',
    );
    wakeAgentLearningWorker();
    response.json(await getCapabilityBundle(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/skills', async (request, response) => {
  const skill = request.body as Skill | undefined;
  if (!skill?.id || !skill?.name || !skill?.description) {
    response.status(400).json({
      error: 'Skill id, name, and description are required.',
    });
    return;
  }

  try {
    await addCapabilitySkillRecord(request.params.capabilityId, skill);
    await queueCapabilityAgentLearningRefresh(
      request.params.capabilityId,
      'capability-skill-added',
    );
    wakeAgentLearningWorker();
    response.status(201).json(
      await getCapabilityBundle(request.params.capabilityId),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.delete('/api/capabilities/:capabilityId/skills/:skillId', async (request, response) => {
  try {
    await removeCapabilitySkillRecord(
      request.params.capabilityId,
      request.params.skillId,
    );
    await queueCapabilityAgentLearningRefresh(
      request.params.capabilityId,
      'capability-skill-removed',
    );
    wakeAgentLearningWorker();
    response.json(await getCapabilityBundle(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/agents', async (request, response) => {
  const agent = ensureAgentCreatePayload(
    request.params.capabilityId,
    request.body as Partial<Omit<CapabilityAgent, 'capabilityId'>> | undefined,
  );
  if (!agent) {
    response.status(400).json({
      error: 'Agent name, role, and objective are required.',
    });
    return;
  }

  try {
    agent.model = await resolveWritableAgentModel(agent.model);
    await addCapabilityAgentRecord(request.params.capabilityId, agent);
    await queueSingleAgentLearningRefresh(
      request.params.capabilityId,
      agent.id,
      'agent-created',
    );
    wakeAgentLearningWorker();
    response.status(201).json(
      await getCapabilityBundle(request.params.capabilityId),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/capabilities/:capabilityId/agents/:agentId', async (request, response) => {
  try {
    const updates = request.body as Partial<CapabilityAgent>;
    if (updates.model) {
      updates.model = await resolveWritableAgentModel(updates.model);
    }

    await updateCapabilityAgentRecord(
      request.params.capabilityId,
      request.params.agentId,
      updates,
    );
    await queueSingleAgentLearningRefresh(
      request.params.capabilityId,
      request.params.agentId,
      'agent-updated',
    );
    wakeAgentLearningWorker();
    response.json(await getCapabilityBundle(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

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
    const workspace = await replaceCapabilityWorkspaceContentRecord(
      request.params.capabilityId,
      request.body as WorkspacePatchBody,
    );
    if (
      request.body?.artifacts ||
      request.body?.workItems ||
      request.body?.workflows ||
      request.body?.learningUpdates
    ) {
      await refreshCapabilityMemory(request.params.capabilityId, {
        requeueAgents: true,
        requestReason: 'workspace-content-updated',
      }).catch(() => undefined);
      wakeAgentLearningWorker();
    }
    response.json(workspace);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/work-items', async (request, response) => {
  const title = String(request.body?.title || '').trim();
  const workflowId = String(request.body?.workflowId || '').trim();
  const description = String(request.body?.description || '').trim();
  const priority = String(request.body?.priority || 'Med') as WorkItem['priority'];
  const tags = Array.isArray(request.body?.tags)
    ? request.body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
    : [];

  if (!title || !workflowId) {
    response.status(400).json({
      error: 'Both title and workflowId are required.',
    });
    return;
  }

  try {
    response.status(201).json(
      await createWorkItemRecord({
        capabilityId: request.params.capabilityId,
        title,
        description,
        workflowId,
        priority,
        tags,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/work-items/:workItemId/move', async (request, response) => {
  const targetPhase = String(request.body?.targetPhase || '').trim() as WorkItemPhase;
  const note = String(request.body?.note || '').trim();

  if (!targetPhase) {
    response.status(400).json({ error: 'A targetPhase is required.' });
    return;
  }

  try {
    response.json(
      await moveWorkItemToPhaseControl({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        targetPhase,
        note: note || undefined,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/work-items/:workItemId/runs', async (request, response) => {
  try {
    const detail = await startWorkflowExecution({
      capabilityId: request.params.capabilityId,
      workItemId: request.params.workItemId,
      restartFromPhase: request.body?.restartFromPhase as WorkItemPhase | undefined,
    });
    wakeExecutionWorker();
    response.status(201).json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/work-items/:workItemId/runs', async (request, response) => {
  try {
    response.json(
      await listWorkflowRunsForWorkItem(
        request.params.capabilityId,
        request.params.workItemId,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/runs/:runId', async (request, response) => {
  try {
    response.json(
      await getWorkflowRunDetail(
        request.params.capabilityId,
        request.params.runId,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/runs/:runId/events', async (request, response) => {
  try {
    response.json(
      await listWorkflowRunEvents(
        request.params.capabilityId,
        request.params.runId,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/runs/:runId/stream', async (request, response) => {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders?.();

  const { capabilityId, runId } = request.params;

  try {
    const [detail, events] = await Promise.all([
      getWorkflowRunDetail(capabilityId, runId),
      listWorkflowRunEvents(capabilityId, runId),
    ]);
    writeSseEvent(response, 'snapshot', { detail, events });
  } catch (error) {
    writeSseEvent(response, 'error', {
      error: error instanceof Error ? error.message : 'Unable to load run stream snapshot.',
    });
    response.end();
    return;
  }

  const unsubscribe = subscribeToRunEvents(runId, event => {
    writeSseEvent(response, 'event', event);
  });

  const interval = setInterval(() => {
    void getWorkflowRunDetail(capabilityId, runId)
      .then(detail => {
        writeSseEvent(response, 'heartbeat', { detail });
      })
      .catch(error => {
        writeSseEvent(response, 'error', {
          error: error instanceof Error ? error.message : 'Run stream refresh failed.',
        });
      });
  }, 3000);

  request.on('close', () => {
    clearInterval(interval);
    unsubscribe();
    response.end();
  });
});

app.post('/api/capabilities/:capabilityId/runs/:runId/approve', async (request, response) => {
  try {
    const detail = await approveWorkflowRun({
      capabilityId: request.params.capabilityId,
      runId: request.params.runId,
      resolution:
        String(request.body?.resolution || '').trim() || 'Approved for continuation.',
      resolvedBy: parseActor(request.body?.resolvedBy, 'Capability Owner'),
    });
    wakeExecutionWorker();
    response.json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/runs/:runId/provide-input', async (request, response) => {
  try {
    const detail = await provideWorkflowRunInput({
      capabilityId: request.params.capabilityId,
      runId: request.params.runId,
      resolution:
        String(request.body?.resolution || '').trim() || 'Input provided for continuation.',
      resolvedBy: parseActor(request.body?.resolvedBy, 'Capability Owner'),
    });
    wakeExecutionWorker();
    response.json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/runs/:runId/resolve-conflict', async (request, response) => {
  try {
    const detail = await resolveWorkflowRunConflict({
      capabilityId: request.params.capabilityId,
      runId: request.params.runId,
      resolution:
        String(request.body?.resolution || '').trim() ||
        'Conflict resolved for continuation.',
      resolvedBy: parseActor(request.body?.resolvedBy, 'Capability Owner'),
    });
    wakeExecutionWorker();
    response.json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/runs/:runId/cancel', async (request, response) => {
  try {
    response.json(
      await cancelWorkflowRun({
        capabilityId: request.params.capabilityId,
        runId: request.params.runId,
        note: String(request.body?.note || '').trim() || undefined,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/runs/:runId/restart', async (request, response) => {
  try {
    const detail = await restartWorkflowRun({
      capabilityId: request.params.capabilityId,
      runId: request.params.runId,
      restartFromPhase: request.body?.restartFromPhase as WorkItemPhase | undefined,
    });
    wakeExecutionWorker();
    response.status(201).json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/code-workspaces', async (request, response) => {
  try {
    const bundle = await getCapabilityBundle(request.params.capabilityId);
    const workspaces = await Promise.all(
      getCapabilityWorkspaceRoots(bundle.capability).map(directoryPath =>
        inspectCodeWorkspace(directoryPath),
      ),
    );

    response.json(workspaces);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/code-workspaces/branch', async (request, response) => {
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
      getCapabilityWorkspaceRoots(bundle.capability),
    );
    const resolvedPath = normalizeDirectoryPath(requestedPath);

    if (!allowedPaths.has(resolvedPath)) {
      response.status(403).json({
        error: 'This directory is not registered under the selected capability.',
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
});

registerRuntimeRoutes(app);

app.post('/api/runtime/chat', async (request, response) => {
  if (!isRuntimeConfigured()) {
    response.status(503).json({
      error: getMissingRuntimeConfigurationMessage(),
    });
    return;
  }

  const body = request.body as ChatRequestBody;
  const message = body.message?.trim();
  if (!message || !body.capability || !body.agent) {
    response.status(400).json({
      error: 'Capability, agent, and message are required.',
    });
    return;
  }

  try {
    const bundle = await getCapabilityBundle(body.capability.id);
    const liveAgent =
      bundle.workspace.agents.find(agent => agent.id === body.agent?.id) || body.agent;
    const liveCapability = bundle.capability;
    const traceId = createTraceId();
    const span = await startTelemetrySpan({
      capabilityId: liveCapability.id,
      traceId,
      entityType: 'CHAT',
      entityId: liveAgent.id,
      name: `Capability chat: ${liveAgent.name}`,
      status: 'RUNNING',
      model: liveAgent.model,
      attributes: {
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
      },
    });
    const memoryContext = await buildMemoryContext({
      capabilityId: liveCapability.id,
      agentId: liveAgent.id,
      queryText: message,
    });
    const chatResponse = await invokeCapabilityChat({
      capability: liveCapability,
      agent: liveAgent,
      history: body.history || [],
      message,
      resetSession: body.sessionMode === 'fresh',
      memoryPrompt: memoryContext.prompt
        ? `Retrieved memory context:\n${memoryContext.prompt}`
        : undefined,
    });
    await finishTelemetrySpan({
      capabilityId: liveCapability.id,
      spanId: span.id,
      status: 'OK',
      costUsd: chatResponse.usage.estimatedCostUsd,
      tokenUsage: chatResponse.usage,
      attributes: {
        memoryHits: memoryContext.results.length,
        sessionMode: body.sessionMode || 'resume',
        isNewSession: String(Boolean(chatResponse.isNewSession)),
      },
    });
    await recordUsageMetrics({
      capabilityId: liveCapability.id,
      traceId,
      scopeType: 'CHAT',
      scopeId: liveAgent.id,
      totalTokens: chatResponse.usage.totalTokens,
      costUsd: chatResponse.usage.estimatedCostUsd,
      tags: {
        model: chatResponse.model,
        sessionMode: body.sessionMode || 'resume',
      },
    });

    response.json({
      ...chatResponse,
      traceId,
      sessionMode: body.sessionMode || 'resume',
      memoryReferences: memoryContext.results.map(result => result.reference),
    });
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/runtime/chat/stream', async (request, response) => {
  if (!isRuntimeConfigured()) {
    response.status(503).json({
      error: getMissingRuntimeConfigurationMessage(),
    });
    return;
  }

  const body = request.body as ChatRequestBody;
  const message = body.message?.trim();
  if (!message || !body.capability || !body.agent) {
    response.status(400).json({
      error: 'Capability, agent, and message are required.',
    });
    return;
  }

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders?.();

  const traceId = createTraceId();

  writeSseEvent(response, 'start', {
    type: 'start',
    traceId,
    createdAt: new Date().toISOString(),
    sessionMode: body.sessionMode || 'resume',
  });

  try {
    const bundle = await getCapabilityBundle(body.capability.id);
    const liveAgent =
      bundle.workspace.agents.find(agent => agent.id === body.agent?.id) || body.agent;
    const liveCapability = bundle.capability;
    const memoryContext = await buildMemoryContext({
      capabilityId: liveCapability.id,
      agentId: liveAgent.id,
      queryText: message,
    });
    writeSseEvent(response, 'memory', {
      type: 'memory',
      traceId,
      memoryReferences: memoryContext.results.map(result => result.reference),
    });
    const span = await startTelemetrySpan({
      capabilityId: liveCapability.id,
      traceId,
      entityType: 'CHAT',
      entityId: liveAgent.id,
      name: `Capability chat stream: ${liveAgent.name}`,
      status: 'RUNNING',
      model: liveAgent.model,
      attributes: {
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        streamed: true,
      },
    });
    const streamed = await invokeCapabilityChatStream({
      capability: liveCapability,
      agent: liveAgent,
      history: body.history || [],
      message,
      resetSession: body.sessionMode === 'fresh',
      memoryPrompt: memoryContext.prompt
        ? `Retrieved memory context:\n${memoryContext.prompt}`
        : undefined,
      onDelta: delta => {
        writeSseEvent(response, 'delta', {
          type: 'delta',
          traceId,
          content: delta,
        });
      },
    });

    await finishTelemetrySpan({
      capabilityId: liveCapability.id,
      spanId: span.id,
      status: 'OK',
      costUsd: streamed.usage.estimatedCostUsd,
      tokenUsage: streamed.usage,
      attributes: {
        memoryHits: memoryContext.results.length,
        streamed: true,
        sessionMode: body.sessionMode || 'resume',
        isNewSession: String(Boolean(streamed.isNewSession)),
      },
    });
    await recordUsageMetrics({
      capabilityId: liveCapability.id,
      traceId,
      scopeType: 'CHAT',
      scopeId: liveAgent.id,
      totalTokens: streamed.usage.totalTokens,
      costUsd: streamed.usage.estimatedCostUsd,
      tags: {
        model: streamed.model,
        streamed: 'true',
        sessionMode: body.sessionMode || 'resume',
      },
    });

    writeSseEvent(response, 'complete', {
      type: 'complete',
      traceId,
      content: streamed.content,
      createdAt: streamed.createdAt,
      model: streamed.model,
      usage: streamed.usage,
      sessionId: streamed.sessionId,
      sessionScope: streamed.sessionScope,
      sessionScopeId: streamed.sessionScopeId,
      isNewSession: streamed.isNewSession,
      sessionMode: body.sessionMode || 'resume',
      memoryReferences: memoryContext.results.map(result => result.reference),
    });
    response.end();
  } catch (error) {
    writeSseEvent(response, 'error', {
      type: 'error',
      traceId,
      sessionMode: body.sessionMode || 'resume',
      retryAfterMs:
        error instanceof GitHubProviderRateLimitError ? error.retryAfterMs : undefined,
      error:
        error instanceof Error
          ? error.message
          : 'The backend runtime could not complete this streaming request.',
    });
    response.end();
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
  const state = await fetchAppState();
  await Promise.all(
    state.capabilities.map(capability =>
      refreshCapabilityMemory(capability.id, {
        requeueAgents: true,
        requestReason: 'startup-memory-refresh',
      }).catch(() => undefined),
    ),
  );
  await Promise.all(
    state.capabilities.map(capability =>
      listEvalSuites(capability.id).catch(() => undefined),
    ),
  );
  await ensureAgentLearningBackfill().catch(() => undefined);
  startExecutionWorker();
  startAgentLearningWorker();
  wakeAgentLearningWorker();

  const server = app.listen(port);
  server.on('listening', () => {
    console.log(`Singularity Neo API listening on http://localhost:${port}`);
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Singularity Neo API could not start because port ${port} is already in use. ` +
          `Stop the existing backend process or start this server with PORT=<free-port>.`,
      );
      process.exit(1);
    }

    console.error('Singularity Neo API listener failed.', error);
    process.exit(1);
  });
};

void startServer().catch(error => {
  console.error('Failed to start Singularity Neo API.', error);
  process.exit(1);
});
