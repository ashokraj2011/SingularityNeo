import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  Capability,
  CapabilityAgent,
  CapabilityContractDraft,
  CapabilityDependency,
  CapabilityRepository,
  CapabilityWorkspace,
  UserPreference,
  WorkspaceOrganization,
  WorkspaceDatabaseBootstrapProfileSnapshot,
  WorkspaceDatabaseBootstrapResult,
} from '../src/types';
import {
  applyCapabilityArchitecture,
  normalizeCapabilityCollectionKind,
  normalizeCapabilityContractDraft,
  normalizeCapabilityDependencies,
  normalizeCapabilityKind,
  normalizeCapabilitySharedReferences,
} from '../src/lib/capabilityArchitecture';
import { normalizeCapabilityLifecycle } from '../src/lib/capabilityLifecycle';
import { normalizeCapabilityDatabaseConfigs } from '../src/lib/capabilityDatabases';
import { normalizeWorkspaceConnectorSettings } from '../src/lib/workspaceConnectors';
import {
  getLegacyArtifactListsFromContract,
  normalizeAgentOperatingContract,
  normalizeAgentRoleStarterKey,
} from '../src/lib/agentRuntime';
import {
  getPool,
  initializeDatabase,
  inspectDatabaseBootstrapStatus,
  setDatabaseRuntimeConfig,
} from './db';
import {
  readWorkspaceDatabaseBootstrapProfileSnapshot,
  writeWorkspaceDatabaseBootstrapProfileSnapshot,
  writeWorkspaceDatabaseBootstrapEnvSnapshot,
} from './databaseProfiles';
import {
  getCapabilityBundle,
  initializeWorkspaceFoundations,
  initializeSeedData,
} from './repository';
import { startExecutionWorker } from './execution/worker';
import {
  assertCapabilityPermission,
} from './access';
import { hasPermission } from '../src/lib/accessControl';
import {
  GitHubProviderRateLimitError,
  defaultModel,
  getConfiguredToken,
  getConfiguredTokenSource,
  getRuntimeDefaultModel,
  invokeCapabilityChat,
  invokeCapabilityChatStream,
  listManagedCopilotSessions,
  listAvailableRuntimeModels,
  normalizeModel,
  resolveRuntimeModel,
  type ChatHistoryMessage,
} from './githubModels';
import { buildMemoryContext } from './memory';
import {
  ensureAgentLearningBackfill,
  queueCapabilityAgentLearningRefresh,
  queueSingleAgentLearningRefresh,
} from './agentLearning/service';
import {
  startAgentLearningWorker,
  wakeAgentLearningWorker,
} from './agentLearning/worker';
import { evaluateBranchPolicy, listPolicyDecisions } from './policy';
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
import { buildRuntimeStatus } from './runtimeStatus';
import { registerRuntimeRoutes } from './routes/runtime';
import { registerExecutionRuntimeRoutes } from './routes/executionRuntime';
import { registerIncidentRoutes } from './routes/incidents';
import { registerBootstrapRoutes } from './routes/bootstrap';
import { registerCodeWorkspaceRoutes } from './routes/codeWorkspaces';
import { registerCapabilityManagementRoutes } from './routes/capabilityManagement';
import { registerDeliveryAssetRoutes } from './routes/deliveryAssets';
import { registerGovernanceRoutes } from './routes/governance';
import { registerReportingEvidenceRoutes } from './routes/reportingEvidence';
import { registerRuntimeChatRoutes } from './routes/runtimeChat';
import { registerSwarmChatRoutes } from './routes/swarmChat';
import { registerAgentGitRoutes } from './routes/agentGit';
import { registerWorkItemRoutes } from './routes/workItems';
import { registerWorkflowRunRoutes } from './routes/workflowRuns';
import { registerStoryProposalRoutes } from './routes/storyProposals';
import { registerPassportRoutes } from './routes/passport';
import { registerBlastRadiusRoutes } from './routes/blastRadius';
import { registerSentinelRoutes } from './routes/sentinel';
import { registerWorkspaceAccessRoutes } from './routes/workspaceAccess';
import { registerStepTemplateRoutes } from './routes/stepTemplates';
import { isDesktopExecutionRuntime, reconcileDesktopExecutionOwnerships } from './executionOwnership';
import { bindRequestActorContext, parseActorContext } from './requestActor';
import { resolveCorsOriginHeader } from './http/originPolicy';
import { buildCopilotSessionMonitorData } from './copilotSessions';
import {
  buildFocusedWorkItemDeveloperPrompt,
  buildWorkItemStageControlBriefing,
  buildLiveWorkspaceBriefing,
  buildWorkItemRuntimeBriefing,
  extractChatWorkspaceReferenceId,
  maybeHandleCapabilityChatAction,
  resolveMentionedWorkItem,
} from './chatWorkspace';
import {
  normalizeDirectoryPath,
} from './workspacePaths';
import { startIncidentWorker, wakeIncidentWorker } from './incidents/worker';

dotenv.config({ path: '.env.local' });
dotenv.config();

const port = Number(process.env.PORT || '3001');
const execFileAsync = promisify(execFile);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5,
  },
});

let workersStarted = false;
let startupInitializationPromise: Promise<void> | null = null;

const ensureWorkersStarted = () => {
  if (workersStarted) {
    return;
  }

  if (!isDesktopExecutionRuntime()) {
    startExecutionWorker();
  }
  startAgentLearningWorker();
  wakeAgentLearningWorker();
  startIncidentWorker();
  wakeIncidentWorker();
  workersStarted = true;
};

const bootstrapWorkspaceDatabaseAndStandards =
  async (): Promise<WorkspaceDatabaseBootstrapResult> => {
    await initializeDatabase();
    await initializeSeedData();
    const catalogSnapshot = await initializeWorkspaceFoundations();
    ensureWorkersStarted();

    return {
      status: await inspectDatabaseBootstrapStatus(),
      catalogSnapshot,
    };
  };

const initializePersistentWorkspace = async () => {
  await bootstrapWorkspaceDatabaseAndStandards();
};

const ensurePersistentWorkspaceInitialization = () => {
  if (!startupInitializationPromise) {
    startupInitializationPromise = initializePersistentWorkspace().catch(error => {
      startupInitializationPromise = null;
      throw error;
    });
  }

  return startupInitializationPromise;
};

const awaitStartupInitialization = async () => {
  if (!startupInitializationPromise) {
    return;
  }

  await startupInitializationPromise.catch(() => undefined);
};

const slugify = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

const createRuntimeId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const normalizeCapabilityRepositoriesPayload = (
  capabilityId: string,
  repositories: unknown,
): CapabilityRepository[] =>
  Array.isArray(repositories)
    ? repositories
        .map((repository, index) => {
          const candidate = repository as Partial<CapabilityRepository>;
          const url = String(candidate?.url || '').trim();
          const label = String(candidate?.label || '').trim();
          if (!url && !label) {
            return null;
          }

          return {
            id:
              String(candidate?.id || '').trim() ||
              `${createRuntimeId('REPO')}-${index + 1}`,
            capabilityId,
            label:
              label ||
              url.split('/').pop()?.replace(/\.git$/i, '') ||
              `Repository ${index + 1}`,
            url: url || label,
            defaultBranch: String(candidate?.defaultBranch || '').trim() || 'main',
            localRootHint: String(candidate?.localRootHint || '').trim() || undefined,
            isPrimary: Boolean(candidate?.isPrimary),
            status: candidate?.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
          } satisfies CapabilityRepository;
        })
        .filter(Boolean) as CapabilityRepository[]
    : [];

const ensureCapabilityCreatePayload = (
  capability: Partial<Capability> | undefined,
): Capability | null => {
  if (!capability?.name || !capability?.description) {
    return null;
  }

  const capabilityId = capability.id?.trim() || createRuntimeId('CAP');

  return {
    ...capability,
    id: capabilityId,
    domain: capability.domain || '',
    capabilityKind: normalizeCapabilityKind(
      capability.capabilityKind,
      capability.collectionKind,
    ),
    collectionKind: normalizeCapabilityCollectionKind(capability.collectionKind),
    description: capability.description,
    businessOutcome: capability.businessOutcome || '',
    successMetrics: capability.successMetrics || [],
    definitionOfDone: capability.definitionOfDone || '',
    requiredEvidenceKinds: capability.requiredEvidenceKinds || [],
    operatingPolicySummary: capability.operatingPolicySummary || '',
    applications: capability.applications || [],
    apis: capability.apis || [],
    databases: capability.databases || [],
    databaseConfigs: normalizeCapabilityDatabaseConfigs(
      capability.databaseConfigs || [],
    ),
    repositories: normalizeCapabilityRepositoriesPayload(capabilityId, capability.repositories),
    gitRepositories: capability.gitRepositories || [],
    localDirectories: capability.localDirectories || [],
    teamNames: capability.teamNames || [],
    stakeholders: capability.stakeholders || [],
    additionalMetadata: capability.additionalMetadata || [],
    dependencies: normalizeCapabilityDependencies(
      capabilityId,
      capability.dependencies as CapabilityDependency[] | undefined,
    ),
    sharedCapabilities:
      normalizeCapabilityKind(capability.capabilityKind, capability.collectionKind) ===
      'COLLECTION'
        ? normalizeCapabilitySharedReferences(
            capabilityId,
            capability.sharedCapabilities,
          )
        : [],
    contractDraft: normalizeCapabilityContractDraft(
      capability.contractDraft as Partial<CapabilityContractDraft> | undefined,
    ),
    publishedSnapshots: capability.publishedSnapshots || [],
    lifecycle: normalizeCapabilityLifecycle(capability.lifecycle),
    skillLibrary: capability.skillLibrary || [],
    status: capability.status || 'PENDING',
    isSystemCapability: false,
    systemCapabilityRole: undefined,
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

  const contract = normalizeAgentOperatingContract(agent.contract, {
    description: agent.objective || agent.role,
    suggestedInputArtifacts: agent.inputArtifacts || [],
    expectedOutputArtifacts: agent.outputArtifacts || [],
  });

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
    roleStarterKey: normalizeAgentRoleStarterKey(agent.roleStarterKey),
    objective: agent.objective,
    systemPrompt: agent.systemPrompt || '',
    contract,
    initializationStatus: agent.initializationStatus || 'READY',
    documentationSources: agent.documentationSources || [],
    ...getLegacyArtifactListsFromContract(contract),
    learningNotes: agent.learningNotes || [],
    skillIds: agent.skillIds || [],
    preferredToolIds: agent.preferredToolIds || [],
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
  const requested = normalizeModel(requestedModel || (await getRuntimeDefaultModel()));

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
    return resolveRuntimeModel(requested);
  }
};

type ChatRequestBody = {
  capability?: Capability;
  agent?: CapabilityAgent;
  history?: ChatHistoryMessage[];
  message?: string;
  sessionMode?: 'resume' | 'fresh';
  sessionScope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  sessionScopeId?: string;
  contextMode?: 'GENERAL' | 'WORK_ITEM_STAGE';
  workItemId?: string;
  runId?: string;
  workflowStepId?: string;
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
const envLocalPath = path.resolve(projectRoot, '.env.local');
const databaseBootstrapStatePath = path.resolve(
  projectRoot,
  '.singularity',
  'database-runtime.json',
);

const getDatabaseBootstrapProfileSnapshot =
  async (): Promise<WorkspaceDatabaseBootstrapProfileSnapshot> =>
    readWorkspaceDatabaseBootstrapProfileSnapshot(
      databaseBootstrapStatePath,
      envLocalPath,
    );

const persistDatabaseBootstrapProfileSnapshot = async (
  snapshot: WorkspaceDatabaseBootstrapProfileSnapshot,
) => {
  await writeWorkspaceDatabaseBootstrapProfileSnapshot(
    databaseBootstrapStatePath,
    snapshot,
  );
  await writeWorkspaceDatabaseBootstrapEnvSnapshot(envLocalPath, snapshot);
};

const hydratePersistedDatabaseBootstrapRuntime = async () => {
  const snapshot = await getDatabaseBootstrapProfileSnapshot();
  const activeProfile =
    snapshot.profiles.find(profile => profile.id === snapshot.activeProfileId) ||
    snapshot.profiles[0];

  if (!activeProfile) {
    return;
  }

  await setDatabaseRuntimeConfig({
    host: activeProfile.host,
    port: activeProfile.port,
    databaseName: activeProfile.databaseName,
    user: activeProfile.user,
    adminDatabaseName: activeProfile.adminDatabaseName,
    ...(activeProfile.password ? { password: activeProfile.password } : {}),
  });
};

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

const parseActor = (value: unknown, fallback: string) => {
  const actor = String(value || '').trim();
  return actor || fallback;
};

const assertCapabilitySupportsExecution = (capability: Capability) => {
  if (normalizeCapabilityKind(capability.capabilityKind, capability.collectionKind) === 'COLLECTION') {
    throw new Error(
      `${capability.name} is a collection capability. Collection nodes are architecture and planning layers, so they cannot own work items or execution runs.`,
    );
  }
};

const ZERO_RUNTIME_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
} as const;

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

const buildBranchPolicyTargetId = ({
  workspacePath,
  branchName,
}: {
  workspacePath: string;
  branchName: string;
}) => `workspacePath=${workspacePath};branch=${branchName}`;

const applyManualBranchPolicy = async ({
  capability,
  permissionSet,
  workspacePath,
  branchName,
}: {
  capability: Capability;
  permissionSet: Awaited<ReturnType<typeof assertCapabilityPermission>>['permissionSet'];
  workspacePath: string;
  branchName: string;
}) => {
  const policyDecision = await evaluateBranchPolicy({
    capability,
    targetId: buildBranchPolicyTargetId({
      workspacePath,
      branchName,
    }),
  });
  const actorCanApprove = hasPermission(permissionSet, 'approval.decide');
  const blocked = policyDecision.decision === 'REQUIRE_APPROVAL' && !actorCanApprove;

  return {
    policyDecision,
    actorCanApprove,
    blocked,
  };
};

const buildChatMemoryPrompt = ({
  liveBriefing,
  memoryPrompt,
}: {
  liveBriefing: string;
  memoryPrompt?: string;
}) =>
  [liveBriefing, memoryPrompt ? `Retrieved memory context:\n${memoryPrompt}` : null]
    .filter(Boolean)
    .join('\n\n');

const buildStageControlDeveloperPrompt = ({
  agentName,
}: {
  agentName: string;
}) =>
  [
    `You are ${agentName}, temporarily working with a human operator inside a direct stage-control window.`,
    'Stay focused on the current work item and current workflow stage only.',
    'Help the operator understand the current status, required inputs, expected outputs, and the smallest concrete next steps needed to complete this stage well.',
    'Be practical and action-oriented. Prefer clear proposed edits, decisions, tradeoffs, and acceptance checks over generic advice.',
    'Do not pretend the workflow has already advanced. The UI will decide when to continue the stage after the operator is satisfied.',
    'If the user asks for direct work-state changes such as approve, provide input, resolve conflict, restart, or unblock, those workspace-control actions may be executed by the system outside the model response.',
  ].join('\n');

const resolveChatRuntimeContext = async ({
  body,
  bundle,
  liveAgent,
}: {
  body: ChatRequestBody;
  bundle: {
    capability: Capability;
    workspace: CapabilityWorkspace;
  };
  liveAgent: CapabilityAgent;
}) => {
  const requestedWorkItem = body.workItemId
    ? bundle.workspace.workItems.find(item => item.id === body.workItemId)
    : undefined;
  const referencedRunId =
    body.runId || extractChatWorkspaceReferenceId(body.message || '', 'RUN');
  const mentionedWorkItem = !requestedWorkItem
    ? resolveMentionedWorkItem(bundle, body.message || '')
    : undefined;
  const referencedWorkItem =
    requestedWorkItem ||
    (referencedRunId
      ? bundle.workspace.workItems.find(
          item =>
            item.activeRunId === referencedRunId || item.lastRunId === referencedRunId,
        )
      : undefined) ||
    mentionedWorkItem?.workItem;
  const requestedWorkflow = requestedWorkItem
    ? bundle.workspace.workflows.find(workflow => workflow.id === requestedWorkItem.workflowId)
    : undefined;
  const referencedWorkflow =
    referencedWorkItem && referencedWorkItem.id !== requestedWorkItem?.id
      ? bundle.workspace.workflows.find(
          workflow => workflow.id === referencedWorkItem.workflowId,
        )
      : requestedWorkflow;
  const requestedStep =
    body.workflowStepId && requestedWorkflow
      ? requestedWorkflow.steps.find(step => step.id === body.workflowStepId)
      : requestedWorkItem?.currentStepId && requestedWorkflow
      ? requestedWorkflow.steps.find(step => step.id === requestedWorkItem.currentStepId)
      : undefined;
  const referencedStep =
    referencedWorkItem &&
    referencedWorkflow &&
    (body.workflowStepId || referencedWorkItem.currentStepId)
      ? referencedWorkflow.steps.find(
          step =>
            step.id === (body.workflowStepId || referencedWorkItem.currentStepId),
        )
      : undefined;
  const isStageControlRequest =
    body.contextMode === 'WORK_ITEM_STAGE' && Boolean(requestedWorkItem);
  const hasReferencedWorkItem = Boolean(
    referencedWorkItem && !mentionedWorkItem?.ambiguous?.length,
  );
  const liveBriefing = isStageControlRequest && requestedWorkItem
    ? await buildWorkItemStageControlBriefing({
        bundle,
        workItemId: requestedWorkItem.id,
      })
    : hasReferencedWorkItem && referencedWorkItem
      ? await buildWorkItemRuntimeBriefing({
          bundle,
          workItem: referencedWorkItem,
        })
      : buildLiveWorkspaceBriefing(bundle);
  const chatScope =
    isStageControlRequest || hasReferencedWorkItem
      ? 'WORK_ITEM'
      : body.sessionScope || 'GENERAL_CHAT';
  const chatScopeId =
    isStageControlRequest || hasReferencedWorkItem
      ? referencedWorkItem?.id
      : body.sessionScopeId || (chatScope === 'GENERAL_CHAT' ? bundle.capability.id : undefined);
  const memoryQueryText =
    isStageControlRequest && requestedWorkItem
      ? [
          body.message?.trim(),
          requestedWorkItem?.title,
          requestedWorkItem?.description,
          requestedStep?.name,
        ]
          .filter(Boolean)
          .join('\n')
      : hasReferencedWorkItem && referencedWorkItem
        ? [
            body.message?.trim(),
            referencedWorkItem.id,
            referencedWorkItem.title,
            referencedWorkItem.description,
            referencedStep?.name,
            referencedWorkItem.blocker?.message,
            referencedWorkItem.pendingRequest?.message,
            referencedRunId,
          ]
            .filter(Boolean)
            .join('\n')
        : body.message?.trim() || '';

  return {
    liveBriefing,
    chatScope,
    chatScopeId,
    memoryQueryText,
    developerPrompt: isStageControlRequest
      ? buildStageControlDeveloperPrompt({
          agentName: liveAgent.name || liveAgent.role || 'the current stage agent',
        })
      : mentionedWorkItem?.ambiguous?.length
        ? buildFocusedWorkItemDeveloperPrompt({
            agentName: liveAgent.name || liveAgent.role || 'the active agent',
            ambiguousWorkItems: mentionedWorkItem.ambiguous,
          })
        : hasReferencedWorkItem
          ? buildFocusedWorkItemDeveloperPrompt({
              agentName: liveAgent.name || liveAgent.role || 'the active agent',
            })
      : undefined,
  };
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
      hasStoredSummary: boolean;
      hasLiveSession: boolean;
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
        hasStoredSummary: true,
        hasLiveSession: liveSessionIds.has(session.sessionId),
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
      createdAt: current?.createdAt || session.createdAt,
      model: current?.model || session.model || runtimeStatus.defaultModel,
      requestCount: current?.requestCount || 0,
      totalTokens: current?.totalTokens || 0,
      hasStoredSummary: current?.hasStoredSummary || false,
      hasLiveSession: true,
    });
  });

  const { sessions, summary } = buildCopilotSessionMonitorData([...sessionRows.values()]);

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
    summary,
    sessions,
  };
};

export const buildApp = () => {
const app = express();

app.use((request, response, next) => {
  const requestOrigin = request.header('origin');
  const allowedOrigin = resolveCorsOriginHeader(requestOrigin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'x-singularity-actor-user-id',
      'x-singularity-actor-display-name',
      'x-singularity-actor-team-ids',
      'x-singularity-actor-stakeholder-ids',
    ].join(', '),
  );
  if (allowedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }

  if (request.method === 'OPTIONS') {
    if (requestOrigin && !allowedOrigin) {
      response.status(403).json({ error: `Origin ${requestOrigin} is not allowed.` });
      return;
    }
    response.sendStatus(204);
    return;
  }

  if (requestOrigin && !allowedOrigin) {
    response.status(403).json({ error: `Origin ${requestOrigin} is not allowed.` });
    return;
  }

  next();
});

app.use(
  express.json({
    limit: '12mb',
    verify: (request, _response, buffer) => {
      (request as express.Request & { rawBody?: string }).rawBody = buffer.toString('utf8');
    },
  }),
);

registerBootstrapRoutes(app, {
  bootstrapWorkspaceDatabaseAndStandards,
  getDatabaseBootstrapProfileSnapshot,
  persistDatabaseBootstrapProfileSnapshot,
});

app.use(bindRequestActorContext);
registerWorkspaceAccessRoutes(app, {
  awaitStartupInitialization,
  buildCopilotSessionMonitorSnapshot,
});
registerReportingEvidenceRoutes(app);
registerGovernanceRoutes(app);

registerDeliveryAssetRoutes(app, {
  assertCapabilitySupportsExecution,
  toSafeDownloadName,
  uploadFilesMiddleware: upload.array('files', 5),
});

registerCapabilityManagementRoutes(app, {
  ensureAgentCreatePayload,
  ensureCapabilityCreatePayload,
  normalizeCapabilityRepositoriesPayload,
  resolveWritableAgentModel,
});
registerAgentGitRoutes(app);
registerWorkItemRoutes(app, {
  applyManualBranchPolicy,
  assertCapabilitySupportsExecution,
  createRuntimeId,
  inspectCodeWorkspace,
  parseActor,
  runGitCommand,
});
registerStoryProposalRoutes(app, {
  parseActorContext,
});
registerWorkflowRunRoutes(app, {
  parseActor,
  writeSseEvent,
});

registerCodeWorkspaceRoutes(app, {
  applyManualBranchPolicy,
  inspectCodeWorkspace,
  runGitCommand,
});

registerRuntimeRoutes(app);
registerExecutionRuntimeRoutes(app);
registerStepTemplateRoutes(app);
registerIncidentRoutes(app, { parseActorContext });
registerPassportRoutes(app);
registerBlastRadiusRoutes(app);
registerSentinelRoutes(app, { parseActor });
registerRuntimeChatRoutes(app, {
  ZERO_RUNTIME_USAGE,
  GitHubProviderRateLimitError,
  buildChatMemoryPrompt,
  buildMemoryContext,
  createTraceId,
  finishTelemetrySpan,
  getMissingRuntimeConfigurationMessage,
  invokeCapabilityChat,
  invokeCapabilityChatStream,
  isRuntimeConfigured,
  maybeHandleCapabilityChatAction,
  recordUsageMetrics,
  resolveChatRuntimeContext,
  startTelemetrySpan,
  writeSseEvent,
});
registerSwarmChatRoutes(app, {
  parseActor,
  writeSseEvent,
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));

  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.resolve(distDir, 'index.html'));
  });
}

return app;
};

const app = buildApp();

export const startServer = async (serverApp = app) => {
  await hydratePersistedDatabaseBootstrapRuntime().catch(error => {
    console.warn(
      'Unable to restore the last saved database runtime profile. Falling back to environment defaults.',
      error,
    );
  });
  void ensurePersistentWorkspaceInitialization().catch(error => {
    console.error(
      'Singularity Neo started without a ready database. Open /workspace/databases to configure or repair the connection.',
      error,
    );
  });
  const server = serverApp.listen(port);
  server.on('listening', () => {
    console.log(`Singularity Neo API listening on http://localhost:${port}`);
    void buildRuntimeStatus()
      .then(status => {
        console.log(`Runtime preflight: ${status.readinessState || 'unknown'}.`);
        (status.checks || [])
          .filter(check => check.status !== 'healthy')
          .slice(0, 6)
          .forEach(check => {
            console.warn(
              `[preflight:${check.status}] ${check.label}: ${check.message}` +
                (check.remediation ? ` Remediation: ${check.remediation}` : ''),
            );
          });
      })
      .catch(error => {
        console.warn(
          'Runtime preflight could not complete.',
          error instanceof Error ? error.message : error,
        );
      });
  });

  // Background reconciliation — proactively clean up stale executors and
  // FAIL any steps that were RUNNING when the executor died, rather than
  // waiting for the next executor to try to claim work. Runs every 30 s.
  // Without this, a single-executor setup with a dead desktop can leave
  // steps stuck in RUNNING indefinitely.
  const reconciliationInterval = setInterval(() => {
    void reconcileDesktopExecutionOwnerships().catch(err => {
      console.error('[reconcile] background reconciliation failed:', err);
    });
  }, 30_000);
  // Don't keep the process alive solely for this timer.
  reconciliationInterval.unref();
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

  // Graceful shutdown — drain in-flight requests then close the DB pool
  // cleanly before exiting. Docker sends SIGTERM before SIGKILL (10 s
  // grace); without this handler the pool leaks connections and requests
  // are cut off mid-flight.
  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} — draining connections…`);
    server.close(async () => {
      try {
        const pool = await getPool();
        await pool.end();
      } catch {
        // pool may already be closed; ignore
      }
      console.log('[server] clean exit');
      process.exit(0);
    });
    // Force exit after 15 s in case an in-flight request never resolves.
    setTimeout(() => {
      console.error('[server] forced exit: drain timeout exceeded');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
};

const shouldAutoStartServer = () => {
  const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return Boolean(entryFile) && entryFile === __filename;
};

if (shouldAutoStartServer()) {
  void startServer().catch(error => {
    console.error('Failed to start Singularity Neo API.', error);
    process.exit(1);
  });
}
