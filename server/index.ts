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
  buildCapabilitySystemPrompt,
  defaultModel,
  getConfiguredToken,
  githubModelsApiUrl,
  invokeCapabilityChat,
  normalizeModel,
  requestGitHubModelStream,
  staticModels,
  type ChatHistoryMessage,
} from './githubModels';
import { buildMemoryContext, listMemoryDocuments, refreshCapabilityMemory, searchCapabilityMemory } from './memory';
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
import { getPlatformFeatureState } from './db';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || '3001');
const execFileAsync = promisify(execFile);

type ChatRequestBody = {
  capability?: Capability;
  agent?: CapabilityAgent;
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

const normalizeDirectoryPath = (value: string) => path.resolve(value.trim());
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
  const message =
    error instanceof Error ? error.message : 'The persistence request failed unexpectedly.';
  const status =
    /not found/i.test(message)
      ? 404
      : /already has an active or waiting workflow run|already exists/i.test(message)
      ? 409
      : /required|invalid|must/i.test(message)
      ? 400
      : /not configured/i.test(message)
      ? 503
      : /not registered|forbidden|not allowed/i.test(message)
      ? 403
      : 500;

  response.status(status).json({ error: message });
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
    response.json(await listMemoryDocuments(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/memory/search', async (request, response) => {
  try {
    response.json(
      await searchCapabilityMemory({
        capabilityId: request.params.capabilityId,
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
    response.json(await refreshCapabilityMemory(request.params.capabilityId));
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
  const capability = request.body as Capability | undefined;
  if (!capability?.id || !capability?.name || !capability?.description) {
    response.status(400).json({
      error: 'Capability id, name, and description are required.',
    });
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
    response.status(400).json({
      error: 'Skill id, name, and description are required.',
    });
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

app.delete('/api/capabilities/:capabilityId/skills/:skillId', async (request, response) => {
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
});

app.post('/api/capabilities/:capabilityId/agents', async (request, response) => {
  const agent = request.body as Omit<CapabilityAgent, 'capabilityId'> | undefined;
  if (!agent?.id || !agent?.name || !agent?.role || !agent?.objective) {
    response.status(400).json({
      error: 'Agent id, name, role, and objective are required.',
    });
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

app.patch('/api/capabilities/:capabilityId/agents/:agentId', async (request, response) => {
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
      bundle.capability.localDirectories.map(directoryPath =>
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
      bundle.capability.localDirectories.map(normalizeDirectoryPath),
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

app.get('/api/runtime/status', (_request, response) => {
  const token = getConfiguredToken();
  const platformFeatures = getPlatformFeatureState();

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
    streaming: true,
    platformFeatures,
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
  if (!message || !body.capability || !body.agent) {
    response.status(400).json({
      error: 'Capability, agent, and message are required.',
    });
    return;
  }

  try {
    const traceId = createTraceId();
    const span = await startTelemetrySpan({
      capabilityId: body.capability.id,
      traceId,
      entityType: 'CHAT',
      entityId: body.agent.id,
      name: `Capability chat: ${body.agent.name}`,
      status: 'RUNNING',
      model: body.agent.model,
      attributes: {
        capabilityId: body.capability.id,
        agentId: body.agent.id,
      },
    });
    const memoryContext = await buildMemoryContext({
      capabilityId: body.capability.id,
      queryText: message,
    });
    const chatResponse = await invokeCapabilityChat({
      capability: body.capability,
      agent: body.agent,
      history: body.history || [],
      message,
      memoryPrompt: memoryContext.prompt
        ? `Retrieved memory context:\n${memoryContext.prompt}`
        : undefined,
    });
    await finishTelemetrySpan({
      capabilityId: body.capability.id,
      spanId: span.id,
      status: 'OK',
      costUsd: chatResponse.usage.estimatedCostUsd,
      tokenUsage: chatResponse.usage,
      attributes: {
        memoryHits: memoryContext.results.length,
      },
    });
    await recordUsageMetrics({
      capabilityId: body.capability.id,
      traceId,
      scopeType: 'CHAT',
      scopeId: body.agent.id,
      totalTokens: chatResponse.usage.totalTokens,
      costUsd: chatResponse.usage.estimatedCostUsd,
      tags: {
        model: chatResponse.model,
      },
    });

    response.json({
      ...chatResponse,
      traceId,
      memoryReferences: memoryContext.results.map(result => result.reference),
    });
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/runtime/chat/stream', async (request, response) => {
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
  const memoryContext = await buildMemoryContext({
    capabilityId: body.capability.id,
    queryText: message,
  });

  writeSseEvent(response, 'start', {
    type: 'start',
    traceId,
    createdAt: new Date().toISOString(),
  });
  writeSseEvent(response, 'memory', {
    type: 'memory',
    traceId,
    memoryReferences: memoryContext.results.map(result => result.reference),
  });

  try {
    const span = await startTelemetrySpan({
      capabilityId: body.capability.id,
      traceId,
      entityType: 'CHAT',
      entityId: body.agent.id,
      name: `Capability chat stream: ${body.agent.name}`,
      status: 'RUNNING',
      model: body.agent.model,
      attributes: {
        capabilityId: body.capability.id,
        agentId: body.agent.id,
        streamed: true,
      },
    });
    const normalizedHistory = (body.history || [])
      .filter(item => item?.content?.trim())
      .slice(-10)
      .map(item => ({
        role: item.role === 'agent' ? 'assistant' : 'user',
        content: item.content!.trim(),
      })) as Array<{ role: 'assistant' | 'user'; content: string }>;

    const streamed = await requestGitHubModelStream({
      model: body.agent.model,
      maxTokens: Number(body.agent.tokenLimit || 1200),
      temperature: 0.2,
      messages: [
        {
          role: 'developer',
          content:
            'You are operating inside an enterprise capability workspace. Stay scoped to the provided capability and agent context, and be explicit when context is missing.',
        },
        {
          role: 'system',
          content: [
            buildCapabilitySystemPrompt({
              capability: body.capability,
              agent: body.agent,
            }),
            memoryContext.prompt ? `Retrieved memory context:\n${memoryContext.prompt}` : null,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        ...normalizedHistory,
        {
          role: 'user',
          content: message,
        },
      ],
      onDelta: delta => {
        writeSseEvent(response, 'delta', {
          type: 'delta',
          traceId,
          content: delta,
        });
      },
    });

    await finishTelemetrySpan({
      capabilityId: body.capability.id,
      spanId: span.id,
      status: 'OK',
      costUsd: streamed.usage.estimatedCostUsd,
      tokenUsage: streamed.usage,
      attributes: {
        memoryHits: memoryContext.results.length,
        streamed: true,
      },
    });
    await recordUsageMetrics({
      capabilityId: body.capability.id,
      traceId,
      scopeType: 'CHAT',
      scopeId: body.agent.id,
      totalTokens: streamed.usage.totalTokens,
      costUsd: streamed.usage.estimatedCostUsd,
      tags: {
        model: streamed.model,
        streamed: 'true',
      },
    });

    writeSseEvent(response, 'complete', {
      type: 'complete',
      traceId,
      content: streamed.content,
      createdAt: streamed.createdAt,
      model: streamed.model,
      usage: streamed.usage,
      memoryReferences: memoryContext.results.map(result => result.reference),
    });
    response.end();
  } catch (error) {
    writeSseEvent(response, 'error', {
      type: 'error',
      traceId,
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
      refreshCapabilityMemory(capability.id).catch(() => undefined),
    ),
  );
  await Promise.all(
    state.capabilities.map(capability =>
      listEvalSuites(capability.id).catch(() => undefined),
    ),
  );
  startExecutionWorker();

  app.listen(port, () => {
    console.log(`Singularity Neo API listening on http://localhost:${port}`);
  });
};

void startServer().catch(error => {
  console.error('Failed to start Singularity Neo API.', error);
  process.exit(1);
});
