import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  ActorContext,
  Capability,
  CapabilityAgent,
  CapabilityAccessSnapshot,
  CapabilityChatMessage,
  CapabilityContractDraft,
  CapabilityDependency,
  CapabilityRepository,
  CapabilityDeploymentTarget,
  CapabilityExecutionCommandTemplate,
  CapabilityWorkspace,
  PermissionAction,
  ReportExportPayload,
  Skill,
  UserPreference,
  WorkItem,
  WorkItemAttachmentUpload,
  WorkItemBranch,
  WorkItemCheckoutSession,
  WorkItemCodeClaim,
  WorkItemHandoffPacket,
  WorkItemPhase,
  WorkspaceOrganization,
  WorkspaceDatabaseBootstrapProfileSnapshot,
  WorkspaceDatabaseBootstrapResult,
} from '../src/types';
import {
  applyCapabilityArchitecture,
  buildCapabilityHierarchyNode,
  normalizeCapabilityCollectionKind,
  normalizeCapabilityContractDraft,
  normalizeCapabilityDependencies,
  normalizeCapabilityKind,
  normalizeCapabilitySharedReferences,
} from '../src/lib/capabilityArchitecture';
import { normalizeCapabilityLifecycle } from '../src/lib/capabilityLifecycle';
import { normalizeCapabilityDatabaseConfigs } from '../src/lib/capabilityDatabases';
import { normalizeWorkItemPhaseStakeholders } from '../src/lib/workItemStakeholders';
import { normalizeWorkItemTaskType } from '../src/lib/workItemTaskTypes';
import { normalizeWorkspaceConnectorSettings } from '../src/lib/workspaceConnectors';
import {
  getLegacyArtifactListsFromContract,
  normalizeAgentOperatingContract,
  normalizeAgentRoleStarterKey,
} from '../src/lib/agentRuntime';
import {
  initializeDatabase,
  inspectDatabaseBootstrapStatus,
  setDatabaseRuntimeConfig,
} from './db';
import {
  findMatchingWorkspaceDatabaseBootstrapProfile,
  readWorkspaceDatabaseBootstrapProfileSnapshot,
  resolveActiveWorkspaceDatabaseBootstrapProfileId,
  upsertWorkspaceDatabaseBootstrapProfile,
  writeWorkspaceDatabaseBootstrapProfileSnapshot,
  writeWorkspaceDatabaseBootstrapEnvSnapshot,
} from './databaseProfiles';
import {
  addCapabilityAgentRecord,
  addCapabilitySkillRecord,
  appendCapabilityMessageRecord,
  clearCapabilityMessageHistoryRecord,
  createCapabilityArtifactUploadRecord,
  createCapabilityRecord,
  fetchAppState,
  getCapabilityAlmExportRecord,
  getCapabilityArtifact,
  getCapabilityArtifactFileBytes,
  getCapabilityBundle,
  getCapabilityTask,
  getCapabilityRepositoriesRecord,
  getWorkspaceCatalogSnapshot,
  getWorkspaceSettings,
  getWorkItemExecutionContextRecord,
  initializeWorkspaceFoundations,
  initializeWorkItemExecutionContextRecord,
  listWorkItemHandoffPacketsRecord,
  initializeSeedData,
  listCapabilityTasks,
  publishCapabilityContractRecord,
  removeCapabilitySkillRecord,
  replaceCapabilityWorkspaceContentRecord,
  setActiveChatAgentRecord,
  updateCapabilityRepositoriesRecord,
  updateCapabilityAgentRecord,
  updateCapabilityAgentModelsRecord,
  updateCapabilityRecord,
  updateWorkItemBranchRecord,
  updateWorkspaceSettings,
  upsertWorkItemCheckoutSessionRecord,
  upsertWorkItemCodeClaimRecord,
  releaseWorkItemCodeClaimRecord,
  createWorkItemHandoffPacketRecord,
  acceptWorkItemHandoffPacketRecord,
} from './repository';
import {
  getWorkflowRunDetail,
  listActiveWorkItemClaims,
  listWorkItemPresence,
  listRecentWorkflowRunEvents,
  listWorkflowRunEvents,
  listWorkflowRunsByCapability,
  listWorkflowRunsForWorkItem,
  releaseWorkItemClaim,
  upsertWorkItemClaim,
  upsertWorkItemPresence,
} from './execution/repository';
import {
  approveWorkflowRun,
  archiveWorkItemControl,
  cancelWorkflowRun,
  cancelWorkItemControl,
  continueWorkflowStageControl,
  createWorkItemRecord,
  moveWorkItemToPhaseControl,
  pauseWorkflowRun,
  provideWorkflowRunInput,
  requestChangesWorkflowRun,
  restoreWorkItemControl,
  resumeWorkflowRun,
  resolveWorkflowRunConflict,
  restartWorkflowRun,
  startWorkflowExecution,
} from './execution/service';
import { startExecutionWorker, wakeExecutionWorker } from './execution/worker';
import {
  getWorkspaceOrganization,
  updateWorkspaceOrganization,
  upsertUserPreference,
} from './workspaceOrganization';
import {
  assertCapabilityPermission,
  assertWorkspacePermission,
  getAuthorizedAppState,
  getCapabilityAccessSnapshot,
  getWorkspaceAccessSnapshot,
  updateCapabilityAccessSnapshot,
  updateWorkspaceAccessSnapshot,
} from './access';
import {
  buildAuditReportSnapshot,
  buildCapabilityHealthSnapshot,
  buildCollectionRollupSnapshot,
  buildExecutiveSummarySnapshot,
  buildOperationsDashboardSnapshot,
  buildReportExportPayload,
  buildTeamQueueSnapshot,
} from './reporting';
import { hasPermission } from '../src/lib/accessControl';
import {
  buildWorkItemEvidenceBundle,
  getCompletedWorkOrderEvidence,
  getLedgerArtifactContent,
  listCompletedWorkOrders,
  listLedgerArtifacts,
} from './ledger';
import {
  buildCapabilityConnectorContext,
  publishArtifactToConfluence,
  syncCapabilityConfluenceContext,
  syncCapabilityGithubContext,
  syncCapabilityJiraContext,
  transitionJiraIssue,
} from './connectors';
import {
  buildWorkItemExplainDetail,
  generateReviewPacketForWorkItem,
} from './workItemExplain';
import { buildCapabilityInteractionFeedSnapshot } from './interactionFeed';
import {
  createEvidencePacketForWorkItem,
  getEvidencePacket,
} from './evidencePackets';
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
import { buildMemoryContext, listMemoryDocuments, refreshCapabilityMemory, searchCapabilityMemory } from './memory';
import {
  buildCapabilityFlightRecorderSnapshot,
  buildWorkItemFlightRecorderDetail,
  getFlightRecorderDownloadName,
  renderCapabilityFlightRecorderMarkdown,
  renderWorkItemFlightRecorderMarkdown,
} from './flightRecorder';
import {
  applyAgentLearningCorrection,
  ensureAgentLearningBackfill,
  getAgentLearningProfileDetail,
  queueCapabilityAgentLearningRefresh,
  queueSingleAgentLearningRefresh,
} from './agentLearning/service';
import {
  getOperatingPolicySnapshots,
  revertOperatingPolicyToSnapshot,
} from './agentLearning/repository';
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
import { registerExecutionRuntimeRoutes } from './routes/executionRuntime';
import { registerIncidentRoutes } from './routes/incidents';
import { isDesktopExecutionRuntime } from './executionOwnership';
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
  getCapabilityWorkspaceRoots,
  isWorkspacePathApproved,
  normalizeDirectoryPath,
} from './workspacePaths';
import {
  detectCapabilityWorkspaceProfile,
  detectWorkspaceProfile,
} from './workspaceProfile';
import { startIncidentWorker, wakeIncidentWorker } from './incidents/worker';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
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

const parseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const validateConnectorUrl = ({
  connector,
  value,
}: {
  connector: 'GITHUB' | 'JIRA' | 'CONFLUENCE';
  value: string;
}) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      connector,
      value,
      valid: true,
      message: `${connector.toLowerCase()} connector is optional for onboarding.`,
    };
  }

  const parsed = parseUrl(trimmed);
  if (!parsed || !['http:', 'https:', 'ssh:'].includes(parsed.protocol)) {
    return {
      connector,
      value,
      valid: false,
      message: 'Use a valid http(s) or ssh URL.',
    };
  }

  const normalizedHost = parsed.hostname.toLowerCase();
  const connectorLooksRight =
    connector === 'GITHUB'
      ? /github|git|bitbucket|azure|devops|gitlab/.test(normalizedHost) ||
        trimmed.endsWith('.git')
      : connector === 'JIRA'
      ? /jira|atlassian/.test(normalizedHost)
      : /confluence|atlassian/.test(normalizedHost);

  return {
    connector,
    value,
    valid: connectorLooksRight,
    message: connectorLooksRight
      ? `${connector.toLowerCase()} link looks valid.`
      : `This URL does not look like a ${connector.toLowerCase()} connector.`,
  };
};

const validateCommandTemplatePayload = ({
  template,
  existingTemplateIds = [],
  allowedWorkspacePaths = [],
}: {
  template?: Partial<CapabilityExecutionCommandTemplate>;
  existingTemplateIds?: string[];
  allowedWorkspacePaths?: string[];
}) => {
  const issues: string[] = [];
  const templateId = String(template?.id || '').trim();

  if (!templateId) {
    issues.push('Template id is required.');
  }
  if (!String(template?.label || '').trim()) {
    issues.push('Template label is required.');
  }
  if (!Array.isArray(template?.command) || template.command.length === 0) {
    issues.push('Command must contain at least one token.');
  }
  if (
    templateId &&
    existingTemplateIds.filter(id => id === templateId).length > 1
  ) {
    issues.push(`Template id ${templateId} is duplicated.`);
  }
  if (
    template?.workingDirectory &&
    allowedWorkspacePaths.length > 0 &&
    !isWorkspacePathApproved(template.workingDirectory, allowedWorkspacePaths)
  ) {
    issues.push('Working directory must be inside an approved workspace path.');
  }

  return {
    templateId: templateId || 'unassigned',
    valid: issues.length === 0,
    issues,
    message:
      issues.length === 0
        ? 'Command template is ready.'
        : 'Command template needs attention.',
  };
};

const validateDeploymentTargetPayload = ({
  target,
  commandTemplates = [],
  allowedWorkspacePaths = [],
}: {
  target?: Partial<CapabilityDeploymentTarget>;
  commandTemplates?: CapabilityExecutionCommandTemplate[];
  allowedWorkspacePaths?: string[];
}) => {
  const issues: string[] = [];
  const targetId = String(target?.id || '').trim();

  if (!targetId) {
    issues.push('Deployment target id is required.');
  }
  if (!String(target?.label || '').trim()) {
    issues.push('Deployment target label is required.');
  }
  if (!target?.commandTemplateId) {
    issues.push('A command template is required.');
  } else if (!commandTemplates.some(template => template.id === target.commandTemplateId)) {
    issues.push(`Command template ${target.commandTemplateId} was not found.`);
  }
  if (
    target?.workspacePath &&
    allowedWorkspacePaths.length > 0 &&
    !isWorkspacePathApproved(target.workspacePath, allowedWorkspacePaths)
  ) {
    issues.push('Deployment workspace path must be inside an approved workspace path.');
  }

  return {
    targetId: targetId || 'unassigned',
    valid: issues.length === 0,
    issues,
    message:
      issues.length === 0
        ? 'Deployment target is ready.'
        : 'Deployment target needs attention.',
  };
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

const sendRepositoryError = (response: express.Response, error: unknown) => {
  sendApiError(response, error);
};

const parseActor = (value: unknown, fallback: string) => {
  const actor = String(value || '').trim();
  return actor || fallback;
};

const parseHeaderStringList = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(item => String(item || '').trim())
        .filter(Boolean);
    }
  } catch {
    // Ignore invalid JSON and fall back to CSV parsing.
  }

  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const parseActorContext = (
  request: express.Request,
  fallbackDisplayName: string,
): ActorContext => ({
  userId: String(request.header('x-singularity-actor-user-id') || '').trim() || undefined,
  displayName:
    String(request.header('x-singularity-actor-display-name') || '').trim() ||
    fallbackDisplayName,
  teamIds: parseHeaderStringList(request.header('x-singularity-actor-team-ids')),
  actedOnBehalfOfStakeholderIds: parseHeaderStringList(
    request.header('x-singularity-actor-stakeholder-ids'),
  ),
});

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

  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
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

app.post('/api/onboarding/validate-connectors', (request, response) => {
  const body = request.body as {
    githubRepositories?: string[];
    jiraBoardLink?: string;
    confluenceLink?: string;
  };
  const items = [
    ...(body.githubRepositories || []).map(value =>
      validateConnectorUrl({ connector: 'GITHUB', value }),
    ),
    validateConnectorUrl({ connector: 'JIRA', value: body.jiraBoardLink || '' }),
    validateConnectorUrl({
      connector: 'CONFLUENCE',
      value: body.confluenceLink || '',
    }),
  ].filter(item => item.value.trim() || !item.valid);

  response.json({
    valid: items.every(item => item.valid),
    items,
  });
});

app.post('/api/onboarding/validate-workspace-path', async (request, response) => {
  const requestedPath = String(request.body?.path || '').trim();
  const normalizedPath = normalizeDirectoryPath(requestedPath);

  if (!normalizedPath) {
    response.json({
      path: requestedPath,
      valid: false,
      exists: false,
      isDirectory: false,
      readable: false,
      message: 'Workspace path is required.',
    });
    return;
  }

  try {
    const stat = await fs.promises.stat(normalizedPath);
    const isDirectory = stat.isDirectory();
    let readable = false;

    if (isDirectory) {
      await fs.promises.access(normalizedPath, fs.constants.R_OK);
      readable = true;
    }

    response.json({
      path: requestedPath,
      normalizedPath,
      valid: isDirectory && readable,
      exists: true,
      isDirectory,
      readable,
      message:
        isDirectory && readable
          ? 'Workspace path is approved for onboarding.'
          : 'Workspace path exists but is not a readable directory.',
    });
  } catch (error) {
    response.json({
      path: requestedPath,
      normalizedPath,
      valid: false,
      exists: false,
      isDirectory: false,
      readable: false,
      message:
        error instanceof Error
          ? error.message
          : 'Workspace path could not be validated.',
    });
  }
});

app.post('/api/onboarding/detect-workspace-profile', (request, response) => {
  const defaultWorkspacePath = String(request.body?.defaultWorkspacePath || '').trim();
  const approvedWorkspacePaths = Array.isArray(request.body?.approvedWorkspacePaths)
    ? request.body.approvedWorkspacePaths
        .map((value: unknown) => String(value || '').trim())
        .filter(Boolean)
    : [];

  response.json(
    detectWorkspaceProfile({
      defaultWorkspacePath,
      workspaceRoots: approvedWorkspacePaths,
    }),
  );
});

app.post('/api/onboarding/validate-command-template', (request, response) => {
  response.json(
    validateCommandTemplatePayload({
      template: request.body?.template,
      existingTemplateIds: request.body?.existingTemplateIds || [],
      allowedWorkspacePaths: request.body?.allowedWorkspacePaths || [],
    }),
  );
});

app.post('/api/onboarding/validate-deployment-target', (request, response) => {
  response.json(
    validateDeploymentTargetPayload({
      target: request.body?.target,
      commandTemplates: request.body?.commandTemplates || [],
      allowedWorkspacePaths: request.body?.allowedWorkspacePaths || [],
    }),
  );
});

app.post(
  '/api/capabilities/:capabilityId/detect-workspace-profile',
  async (request, response) => {
    try {
      const bundle = await getCapabilityBundle(request.params.capabilityId);
      const defaultWorkspacePath = String(request.body?.defaultWorkspacePath || '').trim();
      const approvedWorkspacePaths = Array.isArray(request.body?.approvedWorkspacePaths)
        ? request.body.approvedWorkspacePaths
            .map((value: unknown) => String(value || '').trim())
            .filter(Boolean)
        : [];

      response.json(
        detectCapabilityWorkspaceProfile(bundle.capability, {
          defaultWorkspacePath:
            defaultWorkspacePath || bundle.capability.executionConfig.defaultWorkspacePath,
          workspaceRoots: approvedWorkspacePaths.length
            ? approvedWorkspacePaths
            : getCapabilityWorkspaceRoots(bundle.capability),
        }),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get('/api/bootstrap/database/status', async (_request, response) => {
  try {
    response.json(await inspectDatabaseBootstrapStatus());
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/bootstrap/database/profiles', async (_request, response) => {
  try {
    const [snapshot, status] = await Promise.all([
      getDatabaseBootstrapProfileSnapshot(),
      inspectDatabaseBootstrapStatus(),
    ]);

    response.json({
      ...snapshot,
      activeProfileId:
        resolveActiveWorkspaceDatabaseBootstrapProfileId(snapshot, status.runtime) ||
        snapshot.activeProfileId,
    } satisfies WorkspaceDatabaseBootstrapProfileSnapshot);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/bootstrap/database/setup', async (request, response) => {
  const body = request.body as Partial<{
    host: string;
    port: number;
    databaseName: string;
    user: string;
    adminDatabaseName: string;
    password: string;
  }>;

  const host = String(body.host || '').trim();
  const user = String(body.user || '').trim();
  const databaseName = String(body.databaseName || '').trim();
  const adminDatabaseName = String(body.adminDatabaseName || 'postgres').trim() || 'postgres';
  const port = Number(body.port || 0);

  if (!host || !user || !databaseName || !Number.isFinite(port) || port <= 0) {
    response.status(400).json({
      error: 'Host, port, database name, and user are required to initialize the database.',
    });
    return;
  }

  try {
    const currentProfileSnapshot = await getDatabaseBootstrapProfileSnapshot();
    const matchingSavedProfile = findMatchingWorkspaceDatabaseBootstrapProfile(
      currentProfileSnapshot,
      {
        host,
        port,
        databaseName,
        user,
        adminDatabaseName,
      },
    );
    const resolvedPassword =
      body.password?.trim() || matchingSavedProfile?.password || undefined;

    await setDatabaseRuntimeConfig({
      host,
      port,
      databaseName,
      user,
      adminDatabaseName,
      ...(resolvedPassword ? { password: resolvedPassword } : {}),
    });
    const bootstrapResult = await bootstrapWorkspaceDatabaseAndStandards();
    const profileSnapshot = upsertWorkspaceDatabaseBootstrapProfile(
      currentProfileSnapshot,
      {
        host,
        port,
        databaseName,
        user,
        adminDatabaseName,
        ...(resolvedPassword ? { password: resolvedPassword } : {}),
      },
      { makeActive: true },
    );
    await persistDatabaseBootstrapProfileSnapshot(profileSnapshot);
    response.json({
      ...bootstrapResult,
      profileSnapshot,
    } satisfies WorkspaceDatabaseBootstrapResult);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/bootstrap/database/profiles/:profileId/activate', async (request, response) => {
  const profileId = String(request.params.profileId || '').trim();
  if (!profileId) {
    response.status(400).json({ error: 'A saved database profile id is required.' });
    return;
  }

  try {
    const currentSnapshot = await getDatabaseBootstrapProfileSnapshot();
    const profile = currentSnapshot.profiles.find(item => item.id === profileId);

    if (!profile) {
      response.status(404).json({ error: `Saved database profile ${profileId} was not found.` });
      return;
    }

    await setDatabaseRuntimeConfig({
      host: profile.host,
      port: profile.port,
      databaseName: profile.databaseName,
      user: profile.user,
      adminDatabaseName: profile.adminDatabaseName,
      ...(profile.password ? { password: profile.password } : {}),
    });

    const bootstrapResult = await bootstrapWorkspaceDatabaseAndStandards();
    const profileSnapshot = upsertWorkspaceDatabaseBootstrapProfile(
      currentSnapshot,
      profile,
      { makeActive: true },
    );
    await persistDatabaseBootstrapProfileSnapshot(profileSnapshot);

    response.json({
      ...bootstrapResult,
      profileSnapshot,
    } satisfies WorkspaceDatabaseBootstrapResult);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/state', async (request, response) => {
  try {
    await awaitStartupInitialization();
    response.json(await getAuthorizedAppState(parseActorContext(request, 'Workspace Operator')));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/workspace/organization', async (request, response) => {
  try {
    await awaitStartupInitialization();
    const actor = parseActorContext(request, 'Workspace Operator');
    const accessSnapshot = await getWorkspaceAccessSnapshot(actor);
    response.json(
      hasPermission(accessSnapshot.currentActorPermissions, 'access.manage') ||
        hasPermission(accessSnapshot.currentActorPermissions, 'workspace.manage')
        ? accessSnapshot.organization
        : {
            ...accessSnapshot.organization,
            capabilityGrants: [],
            descendantAccessGrants: [],
            accessAuditEvents: [],
          },
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/workspace/organization', async (request, response) => {
  try {
    await awaitStartupInitialization();
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertWorkspacePermission({ actor, action: 'access.manage' });
    response.json(
      (
        await updateWorkspaceAccessSnapshot({
          updates: request.body as Partial<WorkspaceOrganization>,
          actor,
        })
      ).organization,
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.put('/api/workspace/users/:userId/preferences', async (request, response) => {
  try {
    await awaitStartupInitialization();
    const actor = parseActorContext(request, 'Workspace Operator');
    if (actor.userId !== request.params.userId) {
      await assertWorkspacePermission({ actor, action: 'access.manage' });
    }
    response.json(
      await upsertUserPreference({
        userId: request.params.userId,
        defaultCapabilityId:
          String(request.body?.defaultCapabilityId || '').trim() || undefined,
        lastSelectedTeamId:
          String(request.body?.lastSelectedTeamId || '').trim() || undefined,
        workbenchView:
          String(request.body?.workbenchView || '').trim() || undefined,
      } as UserPreference),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/workspace/access', async (request, response) => {
  try {
    await awaitStartupInitialization();
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertWorkspacePermission({ actor, action: 'access.manage' });
    response.json(await getWorkspaceAccessSnapshot(actor));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/workspace/access', async (request, response) => {
  try {
    await awaitStartupInitialization();
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertWorkspacePermission({ actor, action: 'access.manage' });
    response.json(
      await updateWorkspaceAccessSnapshot({
        updates: request.body as Partial<WorkspaceOrganization>,
        actor,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/workspace/settings', async (request, response) => {
  try {
    await awaitStartupInitialization();
    await assertWorkspacePermission({
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workspace.manage',
    });
    response.json(await getWorkspaceSettings());
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/workspace/settings', async (request, response) => {
  try {
    await assertWorkspacePermission({
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workspace.manage',
    });
    response.json(
      await updateWorkspaceSettings({
        databaseConfigs: normalizeCapabilityDatabaseConfigs(
          request.body?.databaseConfigs || [],
        ),
        connectors: request.body?.connectors
          ? normalizeWorkspaceConnectorSettings(request.body.connectors)
          : undefined,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/workspace/connectors', async (request, response) => {
  try {
    await assertWorkspacePermission({
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workspace.manage',
    });
    response.json((await getWorkspaceSettings()).connectors);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/workspace/connectors', async (request, response) => {
  try {
    await assertWorkspacePermission({
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workspace.manage',
    });
    response.json(
      (
        await updateWorkspaceSettings({
          connectors: normalizeWorkspaceConnectorSettings(request.body || {}),
        })
      ).connectors,
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/workspace/catalog', async (request, response) => {
  try {
    await awaitStartupInitialization();
    await assertWorkspacePermission({
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workspace.manage',
    });
    response.json(await getWorkspaceCatalogSnapshot());
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/workspace/catalog/initialize', async (request, response) => {
  try {
    await awaitStartupInitialization();
    await assertWorkspacePermission({
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workspace.manage',
    });
    response.json(await initializeWorkspaceFoundations());
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    const state = await getAuthorizedAppState(actor);
    const capability = state.capabilities.find(item => item.id === request.params.capabilityId);
    const workspace = state.capabilityWorkspaces.find(
      item => item.capabilityId === request.params.capabilityId,
    );
    if (!capability || !workspace) {
      response.status(404).json({ error: 'Capability was not found or is not visible.' });
      return;
    }
    response.json({ capability, workspace });
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/readiness-contract', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.read',
    });
    const bundle = await getCapabilityBundle(request.params.capabilityId);
    response.json(bundle.workspace.readinessContract);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/interaction-feed', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workitem.read',
    });
    response.json(
      await buildCapabilityInteractionFeedSnapshot({
        capabilityId: request.params.capabilityId,
        workItemId: String(request.query.workItemId || '').trim() || undefined,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/tasks', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workitem.read',
    });
    response.json(await listCapabilityTasks(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/tasks/:taskId', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workitem.read',
    });
    const task = await getCapabilityTask(
      request.params.capabilityId,
      request.params.taskId,
    );
    if (!task) {
      response.status(404).json({ error: 'Task was not found.' });
      return;
    }
    response.json(task);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/run-console', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'telemetry.read',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'telemetry.read',
    });
    response.json(
      await buildCopilotSessionMonitorSnapshot(request.params.capabilityId),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/telemetry/spans', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'telemetry.read',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'telemetry.read',
    });
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

app.post('/api/permissions/evaluate', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    const capabilityId = String(request.body?.capabilityId || '').trim();
    const action = String(request.body?.action || '').trim() as PermissionAction;
    if (!capabilityId || !action) {
      response.status(400).json({
        error: 'capabilityId and action are required for permission evaluation.',
      });
      return;
    }
    const { permissionSet } = await assertCapabilityPermission({
      capabilityId,
      actor,
      action:
        action === 'capability.read.rollup' || action === 'capability.read'
          ? action
          : 'capability.read.rollup',
    });
    response.json({
      capabilityId,
      action,
      allowed: hasPermission(permissionSet, action),
      permissionSet,
    });
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/reports/operations', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertWorkspacePermission({ actor, action: 'report.view.operations' });
    response.json(await buildOperationsDashboardSnapshot(actor));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/reports/team/:teamId', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    const permissions = await assertWorkspacePermission({
      actor,
      action: 'report.view.operations',
    });
    if (
      !permissions.workspaceRoles.includes('WORKSPACE_ADMIN') &&
      !permissions.workspaceRoles.includes('PORTFOLIO_OWNER') &&
      !permissions.workspaceRoles.includes('AUDITOR') &&
      !actor.teamIds.includes(request.params.teamId)
    ) {
      throw new Error('Forbidden: team reports are not allowed outside the current actor team scope.');
    }
    response.json(
      await buildTeamQueueSnapshot({
        actor,
        teamId: request.params.teamId,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/reports/capability/:capabilityId', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'capability.read.rollup',
    });
    response.json(
      await buildCapabilityHealthSnapshot({
        actor,
        capabilityId: request.params.capabilityId,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/reports/collection/:capabilityId', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'capability.read.rollup',
    });
    response.json(
      await buildCollectionRollupSnapshot({
        actor,
        capabilityId: request.params.capabilityId,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/reports/executive', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertWorkspacePermission({ actor, action: 'report.view.executive' });
    response.json(await buildExecutiveSummarySnapshot(actor));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/reports/audit', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertWorkspacePermission({ actor, action: 'report.view.audit' });
    response.json(await buildAuditReportSnapshot(actor));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/reports/export/:reportType', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    const reportType = String(request.params.reportType || '').trim();
    let payload:
      | Awaited<ReturnType<typeof buildOperationsDashboardSnapshot>>
      | Awaited<ReturnType<typeof buildTeamQueueSnapshot>>
      | Awaited<ReturnType<typeof buildCapabilityHealthSnapshot>>
      | Awaited<ReturnType<typeof buildCollectionRollupSnapshot>>
      | Awaited<ReturnType<typeof buildExecutiveSummarySnapshot>>
      | Awaited<ReturnType<typeof buildAuditReportSnapshot>>;

    if (reportType === 'operations') {
      await assertWorkspacePermission({ actor, action: 'report.view.operations' });
      payload = await buildOperationsDashboardSnapshot(actor);
    } else if (reportType === 'team') {
      await assertWorkspacePermission({ actor, action: 'report.view.operations' });
      payload = await buildTeamQueueSnapshot({
        actor,
        teamId: String(request.query.teamId || ''),
      });
    } else if (reportType === 'capability') {
      const capabilityId = String(request.query.capabilityId || '');
      await assertCapabilityPermission({
        capabilityId,
        actor,
        action: 'capability.read.rollup',
      });
      payload = await buildCapabilityHealthSnapshot({ actor, capabilityId });
    } else if (reportType === 'collection') {
      const capabilityId = String(request.query.capabilityId || '');
      await assertCapabilityPermission({
        capabilityId,
        actor,
        action: 'capability.read.rollup',
      });
      payload = await buildCollectionRollupSnapshot({ actor, capabilityId });
    } else if (reportType === 'executive') {
      await assertWorkspacePermission({ actor, action: 'report.view.executive' });
      payload = await buildExecutiveSummarySnapshot(actor);
    } else if (reportType === 'audit') {
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });
      payload = await buildAuditReportSnapshot(actor);
    } else {
      response.status(400).json({ error: 'Unknown report type.' });
      return;
    }

    response.json(
      buildReportExportPayload({
        reportType: reportType as ReportExportPayload['reportType'],
        payload,
        filters: {
          capabilityId: String(request.query.capabilityId || '').trim() || undefined,
          teamId: String(request.query.teamId || '').trim() || undefined,
        },
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/memory/documents', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.read',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.read',
    });
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
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'agents.manage',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.read',
    });
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
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'agents.manage',
    });
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

app.post('/api/capabilities/:capabilityId/agents/:agentId/learning/corrections', async (request, response) => {
  const correction = String(request.body?.correction || '').trim();
  if (!correction) {
    response.status(400).json({
      error: 'A learning correction is required.',
    });
    return;
  }

  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'capability.edit',
    });
    await applyAgentLearningCorrection({
      capabilityId: request.params.capabilityId,
      agentId: request.params.agentId,
      correction,
      workItemId: String(request.body?.workItemId || '').trim() || undefined,
      runId: String(request.body?.runId || '').trim() || undefined,
      actor,
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.read',
    });
    response.json(await listEvalSuites(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/evals/runs', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.read',
    });
    response.json(await listEvalRuns(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/evals/runs/:runId', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.read',
    });
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
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'workflow.edit',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'artifact.read',
    });
    response.json(await listLedgerArtifacts(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get(
  '/api/capabilities/:capabilityId/ledger/completed-work-orders',
  async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'artifact.read',
      });
      response.json(await listCompletedWorkOrders(request.params.capabilityId));
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get('/api/capabilities/:capabilityId/flight-recorder', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'telemetry.read',
    });
    response.json(await buildCapabilityFlightRecorderSnapshot(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/flight-recorder/download', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'telemetry.read',
    });
    const format = request.query.format === 'markdown' ? 'markdown' : 'json';
    const snapshot = await buildCapabilityFlightRecorderSnapshot(request.params.capabilityId);
    response.setHeader(
      'Content-Type',
      format === 'markdown'
        ? 'text/markdown; charset=utf-8'
        : 'application/json; charset=utf-8',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${getFlightRecorderDownloadName({
        title: `${request.params.capabilityId}-flight-recorder`,
        format,
      })}"`,
    );
    response.send(
      format === 'markdown'
        ? renderCapabilityFlightRecorderMarkdown(snapshot)
        : JSON.stringify(snapshot, null, 2),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get(
  '/api/capabilities/:capabilityId/work-items/:workItemId/flight-recorder',
  async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
      response.json(
        await buildWorkItemFlightRecorderDetail(
          request.params.capabilityId,
          request.params.workItemId,
        ),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get(
  '/api/capabilities/:capabilityId/work-items/:workItemId/explain',
  async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workitem.read',
      });
      response.json(
        await buildWorkItemExplainDetail(
          request.params.capabilityId,
          request.params.workItemId,
        ),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/review-packet',
  async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'artifact.read',
      });
      response.status(201).json(
        await generateReviewPacketForWorkItem(
          request.params.capabilityId,
          request.params.workItemId,
        ),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/evidence-packets',
  async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'artifact.read',
      });
      response.status(201).json(
        await createEvidencePacketForWorkItem({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          actor,
        }),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get('/api/evidence-packets/:bundleId', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    const packet = await getEvidencePacket(request.params.bundleId);
    if (!packet) {
      response.status(404).json({ error: 'Evidence packet was not found.' });
      return;
    }
    await assertCapabilityPermission({
      capabilityId: packet.capabilityId,
      actor,
      action: 'artifact.read',
    });
    response.json(packet);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/stage-control/continue',
  async (request, response) => {
    const body = request.body as {
      conversation?: Array<{
        role?: 'user' | 'agent';
        content?: string;
        timestamp?: string;
      }>;
      carryForwardNote?: string;
      resolvedBy?: string;
    };

    try {
      const actor = parseActorContext(
        request,
        typeof body.resolvedBy === 'string' && body.resolvedBy.trim()
          ? body.resolvedBy.trim()
          : 'Capability Owner',
      );
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      response.json(
        await continueWorkflowStageControl({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          conversation: (body.conversation || [])
            .filter(
              entry =>
                (entry.role === 'user' || entry.role === 'agent') &&
                typeof entry.content === 'string',
            )
            .map(entry => ({
              role: entry.role as 'user' | 'agent',
              content: String(entry.content || ''),
              timestamp:
                typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
            })),
          carryForwardNote:
            typeof body.carryForwardNote === 'string'
              ? body.carryForwardNote
              : undefined,
          resolvedBy: actor.displayName,
          actor,
        }),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get(
  '/api/capabilities/:capabilityId/work-items/:workItemId/flight-recorder/download',
  async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
      const format = request.query.format === 'markdown' ? 'markdown' : 'json';
      const detail = await buildWorkItemFlightRecorderDetail(
        request.params.capabilityId,
        request.params.workItemId,
      );
      response.setHeader(
        'Content-Type',
        format === 'markdown'
          ? 'text/markdown; charset=utf-8'
          : 'application/json; charset=utf-8',
      );
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${getFlightRecorderDownloadName({
          title: `${detail.workItem.id}-${detail.workItem.title}-flight-recorder`,
          format,
        })}"`,
      );
      response.send(
        format === 'markdown'
          ? renderWorkItemFlightRecorderMarkdown(detail)
          : JSON.stringify(detail, null, 2),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get('/api/capabilities/:capabilityId/work-items/:workItemId/evidence', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'artifact.read',
    });
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

app.get('/api/capabilities/:capabilityId/connectors', async (request, response) => {
  try {
    response.json(await buildCapabilityConnectorContext(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/connectors/github/sync', async (request, response) => {
  try {
    const [bundle, settings] = await Promise.all([
      getCapabilityBundle(request.params.capabilityId),
      getWorkspaceSettings(),
    ]);
    response.json(
      await syncCapabilityGithubContext(bundle.capability, settings.connectors),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/connectors/jira/sync', async (request, response) => {
  try {
    const [bundle, settings] = await Promise.all([
      getCapabilityBundle(request.params.capabilityId),
      getWorkspaceSettings(),
    ]);
    response.json(await syncCapabilityJiraContext(bundle.capability, settings.connectors));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/connectors/jira/transition', async (request, response) => {
  try {
    response.json(
      await transitionJiraIssue({
        capabilityId: request.params.capabilityId,
        issueKey: String(request.body?.issueKey || ''),
        transitionId: String(request.body?.transitionId || ''),
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post(
  '/api/capabilities/:capabilityId/connectors/confluence/sync',
  async (request, response) => {
    try {
      const [bundle, settings] = await Promise.all([
        getCapabilityBundle(request.params.capabilityId),
        getWorkspaceSettings(),
      ]);
      response.json(
        await syncCapabilityConfluenceContext(bundle.capability, settings.connectors),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/connectors/confluence/publish',
  async (request, response) => {
    try {
      response.json(
        await publishArtifactToConfluence({
          capabilityId: request.params.capabilityId,
          artifactId: String(request.body?.artifactId || ''),
          title:
            typeof request.body?.title === 'string' ? request.body.title : undefined,
          parentPageId:
            typeof request.body?.parentPageId === 'string'
              ? request.body.parentPageId
              : undefined,
        }),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get(
  '/api/capabilities/:capabilityId/artifacts/:artifactId/blob',
  async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'artifact.read',
      });

      const artifact = await getCapabilityArtifact(
        request.params.capabilityId,
        request.params.artifactId,
      );

      if (!artifact) {
        response.status(404).json({ error: 'Artifact was not found.' });
        return;
      }

      const file = await getCapabilityArtifactFileBytes(
        request.params.capabilityId,
        request.params.artifactId,
      );

      if (!file) {
        response.status(404).json({ error: 'Artifact blob was not found.' });
        return;
      }

      const inline =
        request.query.inline === '1' || String(request.query.inline || '') === 'true';
      const fileName = artifact.fileName || `${request.params.artifactId}.bin`;

      response.setHeader('Content-Type', artifact.mimeType || 'application/octet-stream');
      response.setHeader('Content-Length', String(file.sizeBytes));
      response.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`,
      );
      response.send(file.bytes);
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get('/api/capabilities/:capabilityId/artifacts/:artifactId/content', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'artifact.read',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'artifact.read',
    });
    const content = await getLedgerArtifactContent(
      request.params.capabilityId,
      request.params.artifactId,
    );

    if (content.contentFormat === 'BINARY' || content.hasBinary) {
      const file = await getCapabilityArtifactFileBytes(
        request.params.capabilityId,
        request.params.artifactId,
      );

      if (file) {
        response.setHeader('Content-Type', content.mimeType);
        response.setHeader('Content-Length', String(file.sizeBytes));
        response.setHeader(
          'Content-Disposition',
          `attachment; filename="${content.fileName}"`,
        );
        response.send(file.bytes);
        return;
      }
    }

    response.setHeader('Content-Type', content.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${content.fileName}"`);
    response.send(
      content.contentFormat === 'JSON'
        ? JSON.stringify(content.contentJson || {}, null, 2)
        : content.contentText || '',
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/uploads',
  upload.array('files', 5),
  async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');

      // Allow stakeholders who can control work or decide approvals to attach evidence.
      const authActions: PermissionAction[] = [
        'workitem.control',
        'approval.decide',
        'artifact.publish',
      ];
      let authorized = false;
      let firstError: unknown = null;

      for (const action of authActions) {
        try {
          await assertCapabilityPermission({
            capabilityId: request.params.capabilityId,
            actor,
            action,
          });
          authorized = true;
          break;
        } catch (error) {
          if (!firstError) firstError = error;
        }
      }

      if (!authorized) {
        throw firstError instanceof Error ? firstError : new Error('Forbidden.');
      }

      const bundle = await getCapabilityBundle(request.params.capabilityId);
      assertCapabilitySupportsExecution(bundle.capability);

      const workItem = bundle.workspace.workItems.find(
        item => item.id === request.params.workItemId,
      );
      if (!workItem) {
        response.status(404).json({ error: 'Work item was not found.' });
        return;
      }

      const workflow = bundle.workspace.workflows.find(
        item => item.id === workItem.workflowId,
      );

      const files = Array.isArray(request.files) ? request.files : [];
      if (files.length === 0) {
        response.status(400).json({ error: 'At least one file is required.' });
        return;
      }

      const allowedExtensions = new Set([
        '.png',
        '.jpg',
        '.jpeg',
        '.webp',
        '.gif',
        '.pdf',
        '.txt',
        '.md',
        '.json',
        '.csv',
        '.doc',
        '.docx',
      ]);
      const allowedMimePrefixes = ['image/', 'text/'];
      const allowedMimes = new Set([
        'application/pdf',
        'application/json',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/csv',
      ]);

      const toFileSlug = (value: string) =>
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 80) || 'artifact';

      const createArtifactId = () =>
        `ART-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

      const normalizeMime = (value: string) => String(value || '').trim().toLowerCase();
      const inferContentFormat = (file: Express.Multer.File) => {
        const mime = normalizeMime(file.mimetype);
        const ext = path.extname(file.originalname || '').toLowerCase();

        if (mime.includes('json') || ext === '.json') {
          return 'JSON' as const;
        }

        if (mime.includes('markdown') || ext === '.md') {
          return 'MARKDOWN' as const;
        }

        if (mime.startsWith('text/')) {
          return 'TEXT' as const;
        }

        return 'BINARY' as const;
      };

      const createdArtifacts = [];

      for (const file of files) {
        const mime = normalizeMime(file.mimetype);
        const ext = path.extname(file.originalname || '').toLowerCase();
        const passesAllowlist =
          Boolean(mime && (allowedMimePrefixes.some(prefix => mime.startsWith(prefix)) || allowedMimes.has(mime))) ||
          allowedExtensions.has(ext);

        if (!passesAllowlist) {
          response.status(400).json({
            error: `Unsupported upload type for "${file.originalname}".`,
          });
          return;
        }

        const contentFormat = inferContentFormat(file);
        let contentText: string | undefined;
        let contentJson: Record<string, any> | any[] | undefined;

        if (contentFormat !== 'BINARY') {
          const decoded = file.buffer.toString('utf-8');
          if (contentFormat === 'JSON') {
            try {
              contentJson = JSON.parse(decoded);
            } catch {
              contentText = decoded;
            }
          } else {
            contentText = decoded;
          }
        }

        const sha256 = createHash('sha256').update(file.buffer).digest('hex');
        const artifact = {
          id: createArtifactId(),
          name: `${workItem.title} · ${file.originalname}`,
          capabilityId: bundle.capability.id,
          type: mime.startsWith('image/') ? 'Reference Image' : 'Reference Document',
          inputs: [],
          version: `phase-${toFileSlug(workItem.phase || 'work')}`,
          agent: actor.displayName || 'User Upload',
          created: new Date().toISOString(),
          direction: 'INPUT' as const,
          connectedAgentId: workItem.assignedAgentId,
          sourceWorkflowId: workflow?.id,
          summary: `Uploaded ${file.originalname} for ${workItem.id}.`,
          artifactKind: 'UPLOAD' as const,
          phase: workItem.phase,
          workItemId: workItem.id,
          contentFormat,
          mimeType: mime || 'application/octet-stream',
          fileName: file.originalname,
          contentText,
          contentJson,
          downloadable: true,
        };

        await createCapabilityArtifactUploadRecord({
          capabilityId: request.params.capabilityId,
          artifact,
          file: {
            bytes: file.buffer,
            sizeBytes: file.size,
            sha256,
          },
        });

        createdArtifacts.push(artifact);
      }

      await refreshCapabilityMemory(request.params.capabilityId, {
        requeueAgents: true,
        requestReason: 'work-item-uploaded',
      }).catch(() => undefined);
      wakeAgentLearningWorker();

      response.status(201).json({ artifacts: createdArtifacts });
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get(
  '/api/capabilities/:capabilityId/work-items/:workItemId/evidence-bundle',
  async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'artifact.read',
      });
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
      console.error("API ERROR:", error);
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
    await assertWorkspacePermission({
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.create',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.edit',
    });
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

app.get('/api/capabilities/:capabilityId/architecture', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'capability.read.rollup',
    });
    const state = await getAuthorizedAppState(actor);
    const capability = state.capabilities.find(
      item => item.id === request.params.capabilityId,
    );
    if (!capability) {
      response.status(404).json({ error: 'Capability was not found.' });
      return;
    }

    const relatedCapabilities = state.capabilities.filter(item => {
      if (item.id === capability.id) {
        return true;
      }
      if (item.parentCapabilityId === capability.id) {
        return true;
      }
      if (capability.parentCapabilityId && item.id === capability.parentCapabilityId) {
        return true;
      }
      if ((capability.dependencies || []).some(dep => dep.targetCapabilityId === item.id)) {
        return true;
      }
      if ((item.dependencies || []).some(dep => dep.targetCapabilityId === capability.id)) {
        return true;
      }
      return false;
    });

    response.json({
      capability,
      hierarchy: capability.hierarchyNode || buildCapabilityHierarchyNode(capability, state.capabilities),
      rollupSummary: capability.rollupSummary,
      relatedCapabilities,
    });
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/publish-contract', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Capability Owner');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'contract.publish',
    });
    const result = await publishCapabilityContractRecord({
      capabilityId: request.params.capabilityId,
      publishedBy: actor.displayName,
    });
    await refreshCapabilityMemory(request.params.capabilityId, {
      requeueAgents: true,
      requestReason: 'capability-contract-published',
    }).catch(() => undefined);
    response.status(201).json(result);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/alm-export', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.read.rollup',
    });
    response.json(await getCapabilityAlmExportRecord(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/access', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'capability.read',
    });
    response.json(await getCapabilityAccessSnapshot(request.params.capabilityId, actor));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/capabilities/:capabilityId/access', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertWorkspacePermission({ actor, action: 'access.manage' });
    response.json(
      await updateCapabilityAccessSnapshot({
        capabilityId: request.params.capabilityId,
        updates: request.body as Partial<CapabilityAccessSnapshot>,
        actor,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/repositories', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.read',
    });
    response.json(await getCapabilityRepositoriesRecord(request.params.capabilityId));
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/capabilities/:capabilityId/repositories', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.edit',
    });
    const repositories = normalizeCapabilityRepositoriesPayload(
      request.params.capabilityId,
      request.body?.repositories,
    );
    response.json(
      await updateCapabilityRepositoriesRecord(request.params.capabilityId, repositories),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

  app.get('/api/capabilities/:capabilityId/policy-history', async (request, response) => {
    try {
      const capabilityId = request.params.capabilityId;
      await assertCapabilityPermission(request, capabilityId, 'READ_CAPABILITY');
      const snapshots = await getOperatingPolicySnapshots(capabilityId);
      response.json(snapshots);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/revert-policy/:snapshotId', async (request, response) => {
    try {
      const capabilityId = request.params.capabilityId;
      const snapshotId = request.params.snapshotId;
      await assertCapabilityPermission(request, capabilityId, 'UPDATE_CAPABILITY_CONFIG');
      const newSummary = await revertOperatingPolicyToSnapshot(capabilityId, snapshotId);
      response.json({ success: true, operatingPolicySummary: newSummary });
    } catch (error) {
      sendApiError(response, error);
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.edit',
    });
    await addCapabilitySkillRecord(request.params.capabilityId, {
      ...skill,
      contentMarkdown:
        skill.contentMarkdown?.trim() || `# ${skill.name}\n\n${skill.description}`,
      kind: skill.kind || 'CUSTOM',
      origin: skill.origin || 'CAPABILITY',
      defaultTemplateKeys: skill.defaultTemplateKeys || [],
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.edit',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'agents.manage',
    });
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

app.patch('/api/capabilities/:capabilityId/agents/bulk-model', async (request, response) => {
  const requestedModel = String(request.body?.model || '').trim();
  if (!requestedModel) {
    response.status(400).json({
      error: 'Target model is required for bulk agent updates.',
    });
    return;
  }

  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'agents.manage',
    });
    const resolvedModel = await resolveWritableAgentModel(requestedModel);
    response.json(
      await updateCapabilityAgentModelsRecord(
        request.params.capabilityId,
        resolvedModel,
      ),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/capabilities/:capabilityId/agents/:agentId', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'agents.manage',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'chat.write',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'chat.read',
    });
    response.json(
      await setActiveChatAgentRecord(request.params.capabilityId, agentId),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.delete('/api/capabilities/:capabilityId/messages', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'chat.write',
    });
    response.json(
      await clearCapabilityMessageHistoryRecord(request.params.capabilityId, {
        workItemId:
          typeof request.body?.workItemId === 'string'
            ? request.body.workItemId
            : undefined,
        sessionScope:
          request.body?.sessionScope === 'GENERAL_CHAT' ||
          request.body?.sessionScope === 'WORK_ITEM' ||
          request.body?.sessionScope === 'TASK'
            ? request.body.sessionScope
            : undefined,
        sessionScopeId:
          typeof request.body?.sessionScopeId === 'string'
            ? request.body.sessionScopeId
            : undefined,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.patch('/api/capabilities/:capabilityId/workspace', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.edit',
    });
    const capability = (await getCapabilityBundle(request.params.capabilityId)).capability;
    if (
      normalizeCapabilityKind(capability.capabilityKind, capability.collectionKind) ===
        'COLLECTION' &&
      (request.body?.workflows ||
        request.body?.workItems ||
        request.body?.tasks ||
        request.body?.executionLogs)
    ) {
      throw new Error(
        `${capability.name} is a collection capability and cannot persist execution workspace content.`,
      );
    }

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
  const rawTaskType = String(request.body?.taskType || '').trim();
  const taskType = rawTaskType ? normalizeWorkItemTaskType(rawTaskType) : undefined;
  const priority = String(request.body?.priority || 'Med') as WorkItem['priority'];
  const tags = Array.isArray(request.body?.tags)
    ? request.body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
    : [];
  const phaseStakeholders = normalizeWorkItemPhaseStakeholders(
    Array.isArray(request.body?.phaseStakeholders) ? request.body.phaseStakeholders : [],
  );
  const attachments = Array.isArray(request.body?.attachments)
    ? request.body.attachments
        .map((attachment: Partial<WorkItemAttachmentUpload>) => ({
          fileName: String(attachment?.fileName || '').trim(),
          mimeType: String(attachment?.mimeType || '').trim() || undefined,
          contentText: String(attachment?.contentText || ''),
          sizeBytes:
            typeof attachment?.sizeBytes === 'number' && Number.isFinite(attachment.sizeBytes)
              ? attachment.sizeBytes
              : undefined,
        }))
        .filter(attachment => attachment.fileName && attachment.contentText.trim().length > 0)
    : [];

  if (!title || !workflowId) {
    response.status(400).json({
      error: 'Both title and workflowId are required.',
    });
    return;
  }

  try {
    assertCapabilitySupportsExecution(
      (await getCapabilityBundle(request.params.capabilityId)).capability,
    );
    const actor = parseActorContext(request, parseActor(request.body?.guidedBy, 'Capability Owner'));
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'workitem.create',
    });
    response.status(201).json(
      await createWorkItemRecord({
        capabilityId: request.params.capabilityId,
        title,
        description,
        workflowId,
        taskType,
        phaseStakeholders,
        attachments,
        priority,
        tags,
        actor,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/work-items/:workItemId/move', async (request, response) => {
  const targetPhase = String(request.body?.targetPhase || '').trim() as WorkItemPhase;
  const note = String(request.body?.note || '').trim();
  const cancelRunIfPresent = Boolean(request.body?.cancelRunIfPresent);

  if (!targetPhase) {
    response.status(400).json({ error: 'A targetPhase is required.' });
    return;
  }

  try {
    const actor = parseActorContext(request, 'Capability Owner');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'workitem.control',
    });
    response.json(
      await moveWorkItemToPhaseControl({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        targetPhase,
        note: note || undefined,
        cancelRunIfPresent,
        actor,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/cancel',
  async (request, response) => {
    try {
      const bundle = await getCapabilityBundle(request.params.capabilityId);
      assertCapabilitySupportsExecution(bundle.capability);

      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });

      response.json(
        await cancelWorkItemControl({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          note: String(request.body?.note || '').trim() || undefined,
          actor,
        }),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/archive',
  async (request, response) => {
    try {
      const bundle = await getCapabilityBundle(request.params.capabilityId);
      assertCapabilitySupportsExecution(bundle.capability);

      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });

      response.json(
        await archiveWorkItemControl({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          note: String(request.body?.note || '').trim() || undefined,
          actor,
        }),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/restore',
  async (request, response) => {
    try {
      const bundle = await getCapabilityBundle(request.params.capabilityId);
      assertCapabilitySupportsExecution(bundle.capability);

      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });

      response.json(
        await restoreWorkItemControl({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          note: String(request.body?.note || '').trim() || undefined,
          actor,
        }),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get(
  '/api/capabilities/:capabilityId/work-items/:workItemId/collaboration',
  async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workitem.read',
      });
      const [claims, presence] = await Promise.all([
        listActiveWorkItemClaims(request.params.capabilityId, request.params.workItemId),
        listWorkItemPresence(request.params.capabilityId, request.params.workItemId),
      ]);
      response.json({ claims, presence });
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get(
  '/api/capabilities/:capabilityId/work-items/:workItemId/execution-context',
  async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workitem.read',
      });
      const [context, handoffs] = await Promise.all([
        getWorkItemExecutionContextRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
        }),
        listWorkItemHandoffPacketsRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
        }),
      ]);
      response.json({ context, handoffs });
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/execution-context/initialize',
  async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Capability Owner');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const context = await initializeWorkItemExecutionContextRecord({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        actorUserId: actor.userId,
      });
      response.status(201).json(context);
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/branch/create',
  async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Capability Owner');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const context = await initializeWorkItemExecutionContextRecord({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        actorUserId: actor.userId,
      });
      if (!context.branch || !context.primaryRepositoryId) {
        throw new Error('Work item execution context did not resolve a primary repository.');
      }

      const bundle = await getCapabilityBundle(request.params.capabilityId);
      const repository = (bundle.capability.repositories || []).find(
        item => item.id === context.primaryRepositoryId,
      );
      const workspaceRoot = normalizeDirectoryPath(repository?.localRootHint || '');
      if (!workspaceRoot) {
        throw new Error(
          'This repository does not have a local root hint yet, so Singulairy cannot create the shared Git branch.',
        );
      }

      const approvedPaths = getCapabilityWorkspaceRoots(bundle.capability);
      if (!isWorkspacePathApproved(workspaceRoot, approvedPaths)) {
        throw new Error(
          'The repository local root is not inside an approved capability workspace path.',
        );
      }

      const workspaceStatus = await inspectCodeWorkspace(workspaceRoot);
      if (!workspaceStatus.exists || !workspaceStatus.isGitRepository) {
        throw new Error(
          workspaceStatus.error ||
            'The repository local root exists but is not a Git repository.',
        );
      }

      const branchName = context.branch.sharedBranch;
      const baseBranch = context.branch.baseBranch || repository?.defaultBranch || 'main';
      const existingBranch = await runGitCommand(workspaceRoot, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${branchName}`,
      ]).catch(() => '');

      if (existingBranch) {
        await runGitCommand(workspaceRoot, ['switch', branchName]);
      } else {
        try {
          await runGitCommand(workspaceRoot, ['switch', '-c', branchName, baseBranch]);
        } catch {
          await runGitCommand(workspaceRoot, ['switch', '-c', branchName]);
        }
      }

      const headSha = await runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']).catch(
        () => '',
      );
      const nextContext = await updateWorkItemBranchRecord({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        branch: {
          ...context.branch,
          createdByUserId: actor.userId || context.branch.createdByUserId,
          headSha: headSha || context.branch.headSha,
          status: 'ACTIVE',
        },
      });

      if (actor.userId) {
        await upsertWorkItemCheckoutSessionRecord({
          capabilityId: request.params.capabilityId,
          session: {
            workItemId: request.params.workItemId,
            userId: actor.userId,
            repositoryId: context.primaryRepositoryId,
            localPath: workspaceRoot,
            branch: branchName,
            lastSeenHeadSha: headSha || undefined,
            lastSyncedAt: new Date().toISOString(),
          },
        });
      }

      response.status(201).json({
        context: nextContext,
        workspace: await inspectCodeWorkspace(workspaceRoot),
        repository,
      });
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/claim/write',
  async (request, response) => {
    const actor = parseActorContext(request, 'Capability Owner');
    if (!actor.userId) {
      response.status(400).json({ error: 'Choose an operator before taking write control.' });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      await initializeWorkItemExecutionContextRecord({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        actorUserId: actor.userId,
      });
      const claim = await upsertWorkItemCodeClaimRecord({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        userId: actor.userId,
        teamId: actor.teamIds[0],
        claimType: 'WRITE',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      });
      const context = await getWorkItemExecutionContextRecord({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
      });
      response.status(201).json({ claim, context });
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.delete(
  '/api/capabilities/:capabilityId/work-items/:workItemId/claim/write',
  async (request, response) => {
    const actor = parseActorContext(request, 'Capability Owner');
    if (!actor.userId) {
      response.status(400).json({ error: 'Choose an operator before releasing write control.' });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      await releaseWorkItemCodeClaimRecord({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        claimType: 'WRITE',
        userId: actor.userId,
      });
      response.status(204).end();
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.get(
  '/api/capabilities/:capabilityId/work-items/:workItemId/handoff',
  async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workitem.read',
      });
      response.json(
        await listWorkItemHandoffPacketsRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
        }),
      );
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/handoff',
  async (request, response) => {
    const actor = parseActorContext(request, 'Capability Owner');
    const summary = String(request.body?.summary || '').trim();
    if (!summary) {
      response.status(400).json({ error: 'A handoff summary is required.' });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const packet = await createWorkItemHandoffPacketRecord({
        capabilityId: request.params.capabilityId,
        packet: {
          id: createRuntimeId('HANDOFF'),
          workItemId: request.params.workItemId,
          fromUserId: actor.userId,
          toUserId: String(request.body?.toUserId || '').trim() || undefined,
          fromTeamId: actor.teamIds[0],
          toTeamId: String(request.body?.toTeamId || '').trim() || undefined,
          summary,
          openQuestions: Array.isArray(request.body?.openQuestions)
            ? request.body.openQuestions
                .map((value: unknown) => String(value || '').trim())
                .filter(Boolean)
            : [],
          blockingDependencies: Array.isArray(request.body?.blockingDependencies)
            ? request.body.blockingDependencies
                .map((value: unknown) => String(value || '').trim())
                .filter(Boolean)
            : [],
          recommendedNextStep:
            String(request.body?.recommendedNextStep || '').trim() || undefined,
          artifactIds: Array.isArray(request.body?.artifactIds)
            ? request.body.artifactIds
                .map((value: unknown) => String(value || '').trim())
                .filter(Boolean)
            : [],
          traceIds: Array.isArray(request.body?.traceIds)
            ? request.body.traceIds
                .map((value: unknown) => String(value || '').trim())
                .filter(Boolean)
            : [],
          createdAt: new Date().toISOString(),
        },
      });
      response.status(201).json(packet);
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/handoff/:packetId/accept',
  async (request, response) => {
    const actor = parseActorContext(request, 'Capability Owner');
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const packet = await acceptWorkItemHandoffPacketRecord({
        capabilityId: request.params.capabilityId,
        packetId: request.params.packetId,
      });
      if (actor.userId) {
        await upsertWorkItemCodeClaimRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          userId: actor.userId,
          teamId: actor.teamIds[0],
          claimType: 'WRITE',
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        });
      }
      const context = await getWorkItemExecutionContextRecord({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
      });
      response.json({ packet, context });
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/checkout/register',
  async (request, response) => {
    const actor = parseActorContext(request, 'Capability Owner');
    const userId = actor.userId || String(request.body?.userId || '').trim();
    if (!userId) {
      response.status(400).json({ error: 'A user id is required to register a checkout.' });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const session = await upsertWorkItemCheckoutSessionRecord({
        capabilityId: request.params.capabilityId,
        session: {
          workItemId: request.params.workItemId,
          userId,
          repositoryId: String(request.body?.repositoryId || '').trim(),
          localPath: String(request.body?.localPath || '').trim() || undefined,
          branch: String(request.body?.branch || '').trim(),
          lastSeenHeadSha:
            String(request.body?.lastSeenHeadSha || '').trim() || undefined,
          lastSyncedAt:
            String(request.body?.lastSyncedAt || '').trim() || new Date().toISOString(),
        } satisfies WorkItemCheckoutSession,
      });
      response.status(201).json(session);
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/claim',
  async (request, response) => {
    const actor = parseActorContext(request, 'Capability Owner');
    if (!actor.userId) {
      response.status(400).json({ error: 'Choose an operator before taking control.' });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const bundle = await getCapabilityBundle(request.params.capabilityId);
      const workItem = bundle.workspace.workItems.find(
        item => item.id === request.params.workItemId,
      );
      if (!workItem) {
        throw new Error(`Work item ${request.params.workItemId} was not found.`);
      }

      const claim = await upsertWorkItemClaim({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        userId: actor.userId,
        teamId: actor.teamIds[0],
        status: 'ACTIVE',
        claimedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      });
      const nextWorkItem = {
        ...workItem,
        claimOwnerUserId: actor.userId,
        recordVersion: (workItem.recordVersion || 1) + 1,
        history: [
          ...workItem.history,
          {
            id: `HIST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
            timestamp: new Date().toISOString(),
            actor: actor.displayName,
            action: 'Work item claimed',
            detail: `${actor.displayName} took active operator control of this work item.`,
            phase: workItem.phase,
            status: workItem.status,
          },
        ],
      };
      await replaceCapabilityWorkspaceContentRecord(request.params.capabilityId, {
        workItems: bundle.workspace.workItems.map(item =>
          item.id === nextWorkItem.id ? nextWorkItem : item,
        ),
      });
      response.status(201).json({ claim, workItem: nextWorkItem });
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.delete(
  '/api/capabilities/:capabilityId/work-items/:workItemId/claim',
  async (request, response) => {
    const actor = parseActorContext(request, 'Capability Owner');
    if (!actor.userId) {
      response.status(400).json({ error: 'Choose an operator before releasing control.' });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      await releaseWorkItemClaim({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        userId: actor.userId,
      });
      const bundle = await getCapabilityBundle(request.params.capabilityId);
      const nextWorkItems = bundle.workspace.workItems.map(item =>
        item.id === request.params.workItemId && item.claimOwnerUserId === actor.userId
          ? {
              ...item,
              claimOwnerUserId: undefined,
              recordVersion: (item.recordVersion || 1) + 1,
            }
          : item,
      );
      await replaceCapabilityWorkspaceContentRecord(request.params.capabilityId, {
        workItems: nextWorkItems,
      });
      response.status(204).end();
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post(
  '/api/capabilities/:capabilityId/work-items/:workItemId/presence',
  async (request, response) => {
    const actor = parseActorContext(request, 'Capability Owner');
    if (!actor.userId) {
      response.status(400).json({ error: 'Choose an operator before updating presence.' });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.read',
      });
      const presence = await upsertWorkItemPresence({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        userId: actor.userId,
        teamId: actor.teamIds[0],
        viewContext: String(request.body?.viewContext || '').trim() || undefined,
        lastSeenAt: new Date().toISOString(),
      });
      response.status(201).json(presence);
    } catch (error) {
      console.error("API ERROR:", error);
      sendRepositoryError(response, error);
    }
  },
);

app.post('/api/capabilities/:capabilityId/work-items/:workItemId/runs', async (request, response) => {
  try {
    assertCapabilitySupportsExecution(
      (await getCapabilityBundle(request.params.capabilityId)).capability,
    );
    const actor = parseActorContext(
      request,
      parseActor(request.body?.guidedBy, 'Capability Owner'),
    );
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'workitem.control',
    });
    await initializeWorkItemExecutionContextRecord({
      capabilityId: request.params.capabilityId,
      workItemId: request.params.workItemId,
      actorUserId: actor.userId,
    }).catch(() => null);
    const detail = await startWorkflowExecution({
      capabilityId: request.params.capabilityId,
      workItemId: request.params.workItemId,
      restartFromPhase: request.body?.restartFromPhase as WorkItemPhase | undefined,
      guidance: String(request.body?.guidance || '').trim() || undefined,
      guidedBy: actor.displayName,
      actor,
    });
    wakeExecutionWorker();
    response.status(201).json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/work-items/:workItemId/runs', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workitem.read',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workitem.read',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'telemetry.read',
    });
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
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'telemetry.read',
    });
  } catch (error) {
    sendRepositoryError(response, error);
    return;
  }

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
    const actor = parseActorContext(
      request,
      parseActor(request.body?.resolvedBy, 'Capability Owner'),
    );
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'approval.decide',
    });
    const detail = await approveWorkflowRun({
      capabilityId: request.params.capabilityId,
      runId: request.params.runId,
      resolution:
        String(request.body?.resolution || '').trim() || 'Approved for continuation.',
      resolvedBy: actor.displayName,
      actor,
    });
    wakeExecutionWorker();
    response.json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/runs/:runId/request-changes', async (request, response) => {
  try {
    const actor = parseActorContext(
      request,
      parseActor(request.body?.resolvedBy, 'Capability Owner'),
    );
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'approval.decide',
    });
    const detail = await requestChangesWorkflowRun({
      capabilityId: request.params.capabilityId,
      runId: request.params.runId,
      resolution:
        String(request.body?.resolution || '').trim() ||
        'Changes requested before continuation.',
      resolvedBy: actor.displayName,
      actor,
    });
    wakeExecutionWorker();
    response.json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/runs/:runId/provide-input', async (request, response) => {
  try {
    const actor = parseActorContext(
      request,
      parseActor(request.body?.resolvedBy, 'Capability Owner'),
    );
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'workitem.control',
    });
    const detail = await provideWorkflowRunInput({
      capabilityId: request.params.capabilityId,
      runId: request.params.runId,
      resolution:
        String(request.body?.resolution || '').trim() || 'Input provided for continuation.',
      resolvedBy: actor.displayName,
      actor,
    });
    wakeExecutionWorker();
    response.json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/runs/:runId/resolve-conflict', async (request, response) => {
  try {
    const actor = parseActorContext(
      request,
      parseActor(request.body?.resolvedBy, 'Capability Owner'),
    );
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'workitem.control',
    });
    const detail = await resolveWorkflowRunConflict({
      capabilityId: request.params.capabilityId,
      runId: request.params.runId,
      resolution:
        String(request.body?.resolution || '').trim() ||
        'Conflict resolved for continuation.',
      resolvedBy: actor.displayName,
      actor,
    });
    wakeExecutionWorker();
    response.json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/runs/:runId/cancel', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'workitem.control',
    });
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

app.post('/api/capabilities/:capabilityId/runs/:runId/pause', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'workitem.control',
    });
    response.json(
      await pauseWorkflowRun({
        capabilityId: request.params.capabilityId,
        runId: request.params.runId,
        note: String(request.body?.note || '').trim() || undefined,
        actor,
      }),
    );
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/runs/:runId/resume', async (request, response) => {
  try {
    const actor = parseActorContext(request, 'Workspace Operator');
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'workitem.control',
    });
    const detail = await resumeWorkflowRun({
      capabilityId: request.params.capabilityId,
      runId: request.params.runId,
      note: String(request.body?.note || '').trim() || undefined,
      actor,
    });
    wakeExecutionWorker();
    response.json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.post('/api/capabilities/:capabilityId/runs/:runId/restart', async (request, response) => {
  try {
    const actor = parseActorContext(
      request,
      parseActor(request.body?.guidedBy, 'Capability Owner'),
    );
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor,
      action: 'workitem.restart',
    });
    const detail = await restartWorkflowRun({
      capabilityId: request.params.capabilityId,
      runId: request.params.runId,
      restartFromPhase: request.body?.restartFromPhase as WorkItemPhase | undefined,
      guidance: String(request.body?.guidance || '').trim() || undefined,
      guidedBy: actor.displayName,
      actor,
    });
    wakeExecutionWorker();
    response.status(201).json(detail);
  } catch (error) {
    sendRepositoryError(response, error);
  }
});

app.get('/api/capabilities/:capabilityId/code-workspaces', async (request, response) => {
  try {
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.read',
    });
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
    await assertCapabilityPermission({
      capabilityId: request.params.capabilityId,
      actor: parseActorContext(request, 'Workspace Operator'),
      action: 'capability.edit',
    });
    const bundle = await getCapabilityBundle(request.params.capabilityId);
    const allowedPaths = getCapabilityWorkspaceRoots(bundle.capability);
    const resolvedPath = normalizeDirectoryPath(requestedPath);

    if (!isWorkspacePathApproved(resolvedPath, allowedPaths)) {
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
registerExecutionRuntimeRoutes(app);
registerIncidentRoutes(app, { parseActorContext });

app.post('/api/runtime/chat', async (request, response) => {
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
    const chatAction = await maybeHandleCapabilityChatAction({
      bundle,
      agent: liveAgent,
      message,
    });
    if (chatAction.handled) {
      if (chatAction.wakeWorker) {
        wakeExecutionWorker();
      }

      response.json({
        content:
          chatAction.content ||
          'The workspace request completed, but there was no additional message to show.',
        model: 'workspace-control',
        usage: ZERO_RUNTIME_USAGE,
        responseId: null,
        createdAt: new Date().toISOString(),
        traceId: createTraceId(),
        sessionMode: body.sessionMode || 'resume',
        memoryReferences: [],
      });
      return;
    }

    if (!isRuntimeConfigured()) {
      response.status(503).json({
        error: getMissingRuntimeConfigurationMessage(),
      });
      return;
    }

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
    const chatContext = await resolveChatRuntimeContext({
      body,
      bundle,
      liveAgent,
    });
    const memoryContext = await buildMemoryContext({
      capabilityId: liveCapability.id,
      agentId: liveAgent.id,
      queryText: chatContext.memoryQueryText || message,
    });
    const chatResponse = await invokeCapabilityChat({
      capability: liveCapability,
      agent: liveAgent,
      history: body.history || [],
      message,
      resetSession: body.sessionMode === 'fresh',
      scope: chatContext.chatScope,
      scopeId: chatContext.chatScopeId,
      developerPrompt: chatContext.developerPrompt,
      memoryPrompt: buildChatMemoryPrompt({
        liveBriefing: chatContext.liveBriefing,
        memoryPrompt: memoryContext.prompt,
      }),
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
    const chatAction = await maybeHandleCapabilityChatAction({
      bundle,
      agent: liveAgent,
      message,
    });

    if (chatAction.handled) {
      if (chatAction.wakeWorker) {
        wakeExecutionWorker();
      }

      writeSseEvent(response, 'complete', {
        type: 'complete',
        traceId,
        content:
          chatAction.content ||
          'The workspace request completed, but there was no additional message to show.',
        createdAt: new Date().toISOString(),
        model: 'workspace-control',
        usage: ZERO_RUNTIME_USAGE,
        sessionMode: body.sessionMode || 'resume',
        memoryReferences: [],
      });
      response.end();
      return;
    }

    if (!isRuntimeConfigured()) {
      writeSseEvent(response, 'error', {
        type: 'error',
        traceId,
        sessionMode: body.sessionMode || 'resume',
        error: getMissingRuntimeConfigurationMessage(),
      });
      response.end();
      return;
    }

    const chatContext = await resolveChatRuntimeContext({
      body,
      bundle,
      liveAgent,
    });
    const memoryContext = await buildMemoryContext({
      capabilityId: liveCapability.id,
      agentId: liveAgent.id,
      queryText: chatContext.memoryQueryText || message,
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
      scope: chatContext.chatScope,
      scopeId: chatContext.chatScopeId,
      developerPrompt: chatContext.developerPrompt,
      memoryPrompt: buildChatMemoryPrompt({
        liveBriefing: chatContext.liveBriefing,
        memoryPrompt: memoryContext.prompt,
      }),
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
