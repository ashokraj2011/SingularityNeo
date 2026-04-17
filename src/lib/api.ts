import {
  ActorContext,
  AgentTask,
  AgentLearningProfileDetail,
  Artifact,
  ArtifactContentResponse,
  Capability,
  CapabilityAgent,
  CapabilityExecutionOwnership,
  CapabilityAlmExportPayload,
  CapabilityArchitectureSnapshot,
  CapabilityChatMessage,
  CapabilityRepository,
  CapabilityPublishedSnapshot,
  CapabilityDeploymentTarget,
  CapabilityAccessSnapshot,
  CapabilityExecutionCommandTemplate,
  CapabilityFlightRecorderSnapshot,
  CapabilityHealthSnapshot,
  CapabilityInteractionFeed,
  CapabilityWorkspace,
  CollectionRollupSnapshot,
  CommandTemplateValidationResult,
  CopilotSessionMonitorSnapshot,
  CompletedWorkOrderDetail,
  CompletedWorkOrderSummary,
  ConnectorValidationResult,
  CapabilityConnectorContext,
  DeploymentTargetValidationResult,
  ChatStreamEvent,
  ExecutiveSummarySnapshot,
  EvalRun,
  EvalRunDetail,
  EvalSuite,
  LedgerArtifactRecord,
  MemoryDocument,
  MemoryReference,
  MemorySearchResult,
  RunEvent,
  RunConsoleSnapshot,
  Skill,
  StageControlContinueResponse,
  TelemetryMetricSample,
  TelemetrySpan,
  UserPreference,
  ReviewPacketArtifactSummary,
  ReportExportPayload,
  WorkspaceDatabaseBootstrapConfig,
  WorkspaceDatabaseBootstrapProfileSnapshot,
  WorkspaceDatabaseBootstrapResult,
  WorkspaceDatabaseBootstrapStatus,
  WorkspaceAccessSnapshot,
  WorkspaceSettings,
  WorkspaceConnectorSettings,
  WorkspaceCatalogSnapshot,
  WorkspaceOrganization,
  WorkspaceDetectionResult,
  WorkspacePathValidationResult,
  WorkItemClaim,
  WorkItemCodeClaim,
  WorkItemCheckoutSession,
  WorkItemExecutionContext,
  WorkItemHandoffPacket,
  WorkItem,
  WorkItemAttachmentUpload,
  WorkItemPresence,
  WorkItemPhaseStakeholderAssignment,
  WorkItemExplainDetail,
  WorkItemFlightRecorderDetail,
  WorkItemPhase,
  WorkflowRun,
  WorkflowRunDetail,
  OperationsDashboardSnapshot,
  ReadinessContract,
  TeamQueueSnapshot,
  AuditReportSnapshot,
  EvidencePacket,
  EvidencePacketSummary,
  ExecutorRegistryEntry,
  ExecutorRegistrySummary,
  PermissionAction,
  EffectivePermissionSet,
  CapabilityIncident,
  IncidentExportDelivery,
  IncidentExportTarget,
  IncidentExportTargetConfig,
  IncidentCorrelationCandidate,
  IncidentPacketLink,
  IncidentServiceCapabilityMap,
  IncidentSource,
  IncidentSourceConfig,
  ModelRiskMonitoringSummary,
  ApprovalPolicy,
  ApprovalAssignment,
} from '../types';
import { getDesktopBridge, isDesktopRuntime, resolveApiUrl } from './desktop';

export interface RuntimeStatus {
  configured: boolean;
  provider: string;
  providerKey?: 'github-copilot' | 'local-openai';
  embeddingProviderKey?: 'local-openai' | 'deterministic-hash';
  embeddingConfigured?: boolean;
  availableProviders?: Array<{
    key: 'github-copilot' | 'local-openai';
    label: string;
    configured: boolean;
  }>;
  endpoint: string;
  runtimeOwner?: 'DESKTOP' | 'SERVER';
  executionRuntimeOwner?: 'DESKTOP' | 'SERVER';
  tokenSource: string | null;
  defaultModel: string;
  modelCatalogSource?: 'runtime' | 'fallback';
  runtimeAccessMode?: 'copilot-session' | 'headless-cli' | 'http-fallback' | 'unconfigured';
  httpFallbackEnabled?: boolean;
  executorId?: string;
  executorHeartbeatAt?: string;
  executorHeartbeatStatus?: 'FRESH' | 'STALE' | 'OFFLINE';
  actorUserId?: string;
  actorDisplayName?: string;
  ownedCapabilityIds?: string[];
  lastRuntimeError?: string | null;
  streaming?: boolean;
  githubIdentity?: {
    id: number;
    login: string;
    name?: string;
    avatarUrl?: string;
    profileUrl?: string;
    type?: string;
  } | null;
  githubIdentityError?: string | null;
  platformFeatures?: {
    pgvectorAvailable: boolean;
    memoryEmbeddingDimensions: number;
  };
  availableModels: Array<{
    id: string;
    label: string;
    profile: string;
    apiModelId: string;
  }>;
}

export interface RuntimeUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface CapabilityChatResponse {
  content: string;
  model: string;
  usage: RuntimeUsage;
  responseId: string | null;
  createdAt: string;
  traceId?: string;
  sessionId?: string;
  sessionScope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  sessionScopeId?: string;
  isNewSession?: boolean;
}

export interface CapabilityChatStreamResult {
  termination: 'complete' | 'recovered' | 'interrupted' | 'empty';
  draftContent: string;
  completeEvent: ChatStreamEvent | null;
  error?: string;
  retryAfterMs?: number;
  memoryReferences: MemoryReference[];
  sawDelta: boolean;
  sawComplete: boolean;
  sawError: boolean;
}

type CapabilityChatStreamAccumulator = {
  draftContent: string;
  completeEvent: ChatStreamEvent | null;
  sawDelta: boolean;
  sawComplete: boolean;
  sawError: boolean;
  streamError: string;
  retryAfterMs?: number;
  memoryReferences: MemoryReference[];
};

export interface AppState {
  capabilities: Capability[];
  capabilityWorkspaces: CapabilityWorkspace[];
  workspaceSettings: WorkspaceSettings;
  workspaceOrganization: WorkspaceOrganization;
}

export interface CapabilityBundle {
  capability: Capability;
  workspace: CapabilityWorkspace;
}

export type CreateCapabilityInput = Omit<Capability, 'id'> & { id?: string };

export type CreateCapabilityAgentInput = Omit<CapabilityAgent, 'capabilityId' | 'id'> & {
  id?: string;
};

export interface CodeWorkspaceStatus {
  path: string;
  exists: boolean;
  isGitRepository: boolean;
  currentBranch: string | null;
  pendingChanges: number;
  lastCommit: string | null;
  error?: string;
}

export type WorkspaceContentUpdate = Partial<
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

interface CapabilityChatRequest {
  capability: Capability;
  agent: CapabilityAgent;
  history: CapabilityChatMessage[];
  message: string;
  sessionMode?: 'resume' | 'fresh';
  sessionScope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  sessionScopeId?: string;
  contextMode?: 'GENERAL' | 'WORK_ITEM_STAGE';
  workItemId?: string;
  runId?: string;
  workflowStepId?: string;
}

const getError = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
};

const jsonHeaders = {
  'Content-Type': 'application/json',
};

let currentActorContext: ActorContext | null = null;

const withActorHeaders = (headers?: HeadersInit): HeadersInit => {
  const nextHeaders = new Headers(headers || {});

  if (currentActorContext?.userId) {
    nextHeaders.set('x-singularity-actor-user-id', currentActorContext.userId);
  }
  if (currentActorContext?.displayName) {
    nextHeaders.set('x-singularity-actor-display-name', currentActorContext.displayName);
  }
  if (currentActorContext?.teamIds?.length) {
    nextHeaders.set(
      'x-singularity-actor-team-ids',
      JSON.stringify(currentActorContext.teamIds),
    );
  }
  if (currentActorContext?.actedOnBehalfOfStakeholderIds?.length) {
    nextHeaders.set(
      'x-singularity-actor-stakeholder-ids',
      JSON.stringify(currentActorContext.actedOnBehalfOfStakeholderIds),
    );
  }

  return nextHeaders;
};

const requestJson = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(resolveApiUrl(input), {
    ...init,
    headers: withActorHeaders(init?.headers),
  });
  if (!response.ok) {
    throw new Error(await getError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
};

const requestText = async (input: string, init?: RequestInit): Promise<string> => {
  const response = await fetch(resolveApiUrl(input), {
    ...init,
    headers: withActorHeaders(init?.headers),
  });
  if (!response.ok) {
    throw new Error(await getError(response));
  }
  return response.text();
};

export const setCurrentActorContext = (actor: ActorContext | null) => {
  currentActorContext = actor;
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    void desktop.setActorContext(actor);
  }
};

export const fetchRuntimeStatus = async (): Promise<RuntimeStatus> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return desktop.getRuntimeStatus() as Promise<RuntimeStatus>;
  }

  return requestJson<RuntimeStatus>('/api/runtime/status');
};

export const updateRuntimeCredentials = async (
  token: string,
): Promise<RuntimeStatus> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return desktop.setRuntimeToken(token) as Promise<RuntimeStatus>;
  }

  return requestJson<RuntimeStatus>('/api/runtime/credentials', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ token }),
  });
};

export const clearRuntimeCredentials = async (): Promise<RuntimeStatus> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return desktop.clearRuntimeToken() as Promise<RuntimeStatus>;
  }

  return requestJson<RuntimeStatus>('/api/runtime/credentials', {
    method: 'DELETE',
  });
};

export const claimCapabilityExecution = async ({
  capabilityId,
  forceTakeover,
}: {
  capabilityId: string;
  forceTakeover?: boolean;
}): Promise<{
  ownership: CapabilityExecutionOwnership;
}> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return desktop.claimCapabilityExecution({
      capabilityId,
      forceTakeover,
    }) as Promise<{
      ownership: CapabilityExecutionOwnership;
    }>;
  }

  throw new Error('A desktop runtime is required to claim capability execution.');
};

export const releaseCapabilityExecution = async ({
  capabilityId,
}: {
  capabilityId: string;
}): Promise<void> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    await (desktop.releaseCapabilityExecution({
      capabilityId,
    }) as Promise<unknown>);
    return;
  }

  throw new Error('A desktop runtime is required to release capability execution.');
};

export const sendCapabilityChat = async (
  payload: CapabilityChatRequest,
): Promise<CapabilityChatResponse> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return desktop.sendRuntimeChat({
      ...payload,
      actorContext: currentActorContext,
    }) as Promise<CapabilityChatResponse>;
  }

  return requestJson<CapabilityChatResponse>('/api/runtime/chat', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
};

const createCapabilityChatStreamAccumulator = (): CapabilityChatStreamAccumulator => ({
  draftContent: '',
  completeEvent: null,
  sawDelta: false,
  sawComplete: false,
  sawError: false,
  streamError: '',
  retryAfterMs: undefined,
  memoryReferences: [],
});

const processCapabilityChatStreamEvent = ({
  event,
  handlers,
  state,
}: {
  event: ChatStreamEvent;
  handlers: {
    onEvent: (event: ChatStreamEvent) => void;
  };
  state: CapabilityChatStreamAccumulator;
}) => {
  if (event.type === 'memory') {
    state.memoryReferences = event.memoryReferences || [];
  }
  if (event.type === 'delta' && event.content) {
    state.sawDelta = true;
    state.draftContent += event.content;
  }
  if (event.type === 'complete') {
    state.sawComplete = true;
    state.completeEvent = event;
    state.draftContent = event.content || state.draftContent;
    state.memoryReferences = event.memoryReferences || state.memoryReferences;
  }
  if (event.type === 'error') {
    state.sawError = true;
    state.streamError = event.error || 'The runtime ended this stream early.';
    state.retryAfterMs = event.retryAfterMs;
  }

  handlers.onEvent(event);
};

const finalizeCapabilityChatStream = ({
  state,
  aborted,
}: {
  state: CapabilityChatStreamAccumulator;
  aborted: boolean;
}): CapabilityChatStreamResult => {
  const trimmedDraft = state.draftContent.trim();
  const termination = state.sawComplete
    ? 'complete'
    : trimmedDraft
      ? state.sawError || aborted
        ? 'interrupted'
        : 'recovered'
      : 'empty';

  return {
    termination,
    draftContent: state.draftContent,
    completeEvent: state.completeEvent,
    error:
      state.streamError ||
      (aborted ? 'Streaming response was stopped before completion.' : undefined),
    retryAfterMs: state.retryAfterMs,
    memoryReferences: state.memoryReferences,
    sawDelta: state.sawDelta,
    sawComplete: state.sawComplete,
    sawError: state.sawError,
  };
};

export const fetchAppState = async (): Promise<AppState> =>
  requestJson<AppState>('/api/state');

export const fetchWorkspaceOrganization = async (): Promise<WorkspaceOrganization> =>
  requestJson<WorkspaceOrganization>('/api/workspace/organization');

export const updateWorkspaceOrganizationRecord = async (
  updates: Partial<WorkspaceOrganization>,
): Promise<WorkspaceOrganization> =>
  requestJson<WorkspaceOrganization>('/api/workspace/organization', {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });

export const fetchWorkspaceAccessSnapshot = async (): Promise<WorkspaceAccessSnapshot> =>
  requestJson<WorkspaceAccessSnapshot>('/api/workspace/access');

export const updateWorkspaceAccessSnapshot = async (
  updates: Partial<WorkspaceOrganization>,
): Promise<WorkspaceAccessSnapshot> =>
  requestJson<WorkspaceAccessSnapshot>('/api/workspace/access', {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });

export const updateWorkspaceUserPreferenceRecord = async (
  userId: string,
  updates: Partial<UserPreference>,
): Promise<UserPreference> =>
  requestJson<UserPreference>(`/api/workspace/users/${encodeURIComponent(userId)}/preferences`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });

export const fetchDatabaseBootstrapStatus = async (): Promise<WorkspaceDatabaseBootstrapStatus> =>
  requestJson<WorkspaceDatabaseBootstrapStatus>('/api/bootstrap/database/status');

export const setupDatabaseBootstrap = async (
  payload: WorkspaceDatabaseBootstrapConfig,
): Promise<WorkspaceDatabaseBootstrapResult> =>
  requestJson<WorkspaceDatabaseBootstrapResult>('/api/bootstrap/database/setup', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const fetchDatabaseBootstrapProfiles =
  async (): Promise<WorkspaceDatabaseBootstrapProfileSnapshot> =>
    requestJson<WorkspaceDatabaseBootstrapProfileSnapshot>(
      '/api/bootstrap/database/profiles',
    );

export const activateDatabaseBootstrapProfile = async (
  profileId: string,
): Promise<WorkspaceDatabaseBootstrapResult> =>
  requestJson<WorkspaceDatabaseBootstrapResult>(
    `/api/bootstrap/database/profiles/${encodeURIComponent(profileId)}/activate`,
    {
      method: 'POST',
      headers: jsonHeaders,
    },
  );

export const fetchWorkspaceSettings = async (): Promise<WorkspaceSettings> =>
  requestJson<WorkspaceSettings>('/api/workspace/settings');

export const updateWorkspaceSettingsRecord = async (
  updates: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> =>
  requestJson<WorkspaceSettings>('/api/workspace/settings', {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });

export const fetchWorkspaceConnectors = async (): Promise<WorkspaceConnectorSettings> =>
  requestJson<WorkspaceConnectorSettings>('/api/workspace/connectors');

export const updateWorkspaceConnectors = async (
  updates: Partial<WorkspaceConnectorSettings>,
): Promise<WorkspaceConnectorSettings> =>
  requestJson<WorkspaceConnectorSettings>('/api/workspace/connectors', {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });

export const fetchWorkspaceCatalogSnapshot = async (): Promise<WorkspaceCatalogSnapshot> =>
  requestJson<WorkspaceCatalogSnapshot>('/api/workspace/catalog');

export const initializeWorkspaceFoundationCatalog = async (): Promise<WorkspaceCatalogSnapshot> =>
  requestJson<WorkspaceCatalogSnapshot>('/api/workspace/catalog/initialize', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({}),
  });

export const fetchCapabilityBundle = async (
  capabilityId: string,
): Promise<CapabilityBundle> =>
  requestJson<CapabilityBundle>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}`,
  );

export const fetchCapabilityRepositories = async (
  capabilityId: string,
): Promise<CapabilityRepository[]> =>
  requestJson<CapabilityRepository[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/repositories`,
  );

export const updateCapabilityRepositories = async (
  capabilityId: string,
  repositories: CapabilityRepository[],
): Promise<CapabilityRepository[]> =>
  requestJson<CapabilityRepository[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/repositories`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ repositories }),
    },
  );

export const validateOnboardingConnectors = async (payload: {
  githubRepositories: string[];
  jiraBoardLink?: string;
  confluenceLink?: string;
}): Promise<ConnectorValidationResult> =>
  requestJson<ConnectorValidationResult>('/api/onboarding/validate-connectors', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const validateOnboardingWorkspacePath = async (payload: {
  path: string;
}): Promise<WorkspacePathValidationResult> =>
  requestJson<WorkspacePathValidationResult>(
    '/api/onboarding/validate-workspace-path',
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const detectOnboardingWorkspaceProfile = async (payload: {
  defaultWorkspacePath?: string;
  approvedWorkspacePaths?: string[];
}): Promise<WorkspaceDetectionResult> =>
  requestJson<WorkspaceDetectionResult>(
    '/api/onboarding/detect-workspace-profile',
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const detectCapabilityWorkspaceProfile = async (
  capabilityId: string,
  payload?: {
    defaultWorkspacePath?: string;
    approvedWorkspacePaths?: string[];
  },
): Promise<WorkspaceDetectionResult> =>
  requestJson<WorkspaceDetectionResult>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/detect-workspace-profile`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const validateOnboardingCommandTemplate = async (payload: {
  template: CapabilityExecutionCommandTemplate;
  existingTemplateIds?: string[];
  allowedWorkspacePaths?: string[];
}): Promise<CommandTemplateValidationResult> =>
  requestJson<CommandTemplateValidationResult>(
    '/api/onboarding/validate-command-template',
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const validateOnboardingDeploymentTarget = async (payload: {
  target: CapabilityDeploymentTarget;
  commandTemplates: CapabilityExecutionCommandTemplate[];
  allowedWorkspacePaths?: string[];
}): Promise<DeploymentTargetValidationResult> =>
  requestJson<DeploymentTargetValidationResult>(
    '/api/onboarding/validate-deployment-target',
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const fetchLedgerArtifacts = async (
  capabilityId: string,
): Promise<LedgerArtifactRecord[]> =>
  requestJson<LedgerArtifactRecord[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/ledger/artifacts`,
  );

export const fetchCompletedWorkOrders = async (
  capabilityId: string,
): Promise<CompletedWorkOrderSummary[]> =>
  requestJson<CompletedWorkOrderSummary[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/ledger/completed-work-orders`,
  );

export const fetchCapabilityFlightRecorder = async (
  capabilityId: string,
): Promise<CapabilityFlightRecorderSnapshot> =>
  requestJson<CapabilityFlightRecorderSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/flight-recorder`,
  );

export const fetchWorkItemFlightRecorder = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkItemFlightRecorderDetail> =>
  requestJson<WorkItemFlightRecorderDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/flight-recorder`,
  );

export const getCapabilityFlightRecorderDownloadUrl = (
  capabilityId: string,
  format: 'json' | 'markdown',
) =>
  resolveApiUrl(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/flight-recorder/download?format=${format}`,
  );

export const getWorkItemFlightRecorderDownloadUrl = (
  capabilityId: string,
  workItemId: string,
  format: 'json' | 'markdown',
) =>
  resolveApiUrl(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/flight-recorder/download?format=${format}`,
  );

export const fetchWorkItemEvidence = async (
  capabilityId: string,
  workItemId: string,
): Promise<CompletedWorkOrderDetail> =>
  requestJson<CompletedWorkOrderDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/evidence`,
  );

export const fetchWorkItemExplainDetail = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkItemExplainDetail> =>
  requestJson<WorkItemExplainDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/explain`,
  );

export const generateWorkItemReviewPacket = async (
  capabilityId: string,
  workItemId: string,
): Promise<ReviewPacketArtifactSummary> =>
  requestJson<ReviewPacketArtifactSummary>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/review-packet`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const fetchCapabilityReadinessContract = async (
  capabilityId: string,
): Promise<ReadinessContract> =>
  requestJson<ReadinessContract>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/readiness-contract`,
  );

export const fetchCapabilityInteractionFeed = async ({
  capabilityId,
  workItemId,
}: {
  capabilityId: string;
  workItemId?: string;
}): Promise<CapabilityInteractionFeed> =>
  requestJson<CapabilityInteractionFeed>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/interaction-feed${
      workItemId ? `?workItemId=${encodeURIComponent(workItemId)}` : ''
    }`,
  );

export const createEvidencePacketForWorkItem = async (
  capabilityId: string,
  workItemId: string,
): Promise<EvidencePacketSummary> =>
  requestJson<EvidencePacketSummary>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/evidence-packets`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const fetchEvidencePacket = async (bundleId: string): Promise<EvidencePacket> =>
  requestJson<EvidencePacket>(`/api/evidence-packets/${encodeURIComponent(bundleId)}`);

export const listIncidents = async (params?: {
  capabilityId?: string;
  severity?: string;
  status?: string;
}): Promise<CapabilityIncident[]> => {
  const search = new URLSearchParams();
  if (params?.capabilityId) {
    search.set('capabilityId', params.capabilityId);
  }
  if (params?.severity) {
    search.set('severity', params.severity);
  }
  if (params?.status) {
    search.set('status', params.status);
  }
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return requestJson<CapabilityIncident[]>(`/api/incidents${suffix}`);
};

export const fetchIncident = async (incidentId: string): Promise<CapabilityIncident> =>
  requestJson<CapabilityIncident>(`/api/incidents/${encodeURIComponent(incidentId)}`);

export const createIncidentRecord = async (payload: {
  capabilityId?: string;
  title: string;
  severity: string;
  status?: string;
  summary?: string;
  affectedServices?: string[];
  affectedPaths?: string[];
  detectedAt?: string;
  postmortemUrl?: string;
  initialPacketBundleId?: string;
}): Promise<CapabilityIncident> =>
  requestJson<CapabilityIncident>('/api/incidents', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const linkIncidentPacket = async (
  incidentId: string,
  payload: {
    packetBundleId: string;
    correlation?: string;
    correlationScore?: number;
    correlationReasons?: string[];
  },
): Promise<IncidentPacketLink> =>
  requestJson<IncidentPacketLink>(`/api/incidents/${encodeURIComponent(incidentId)}/links`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const updateIncidentPacketLink = async (
  incidentId: string,
  bundleId: string,
  payload: {
    correlation: string;
    correlationScore?: number;
    correlationReasons?: string[];
  },
): Promise<IncidentPacketLink> =>
  requestJson<IncidentPacketLink>(
    `/api/incidents/${encodeURIComponent(incidentId)}/links/${encodeURIComponent(bundleId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const deleteIncidentPacketLink = async (incidentId: string, bundleId: string) =>
  requestJson<{ status: 'deleted' }>(
    `/api/incidents/${encodeURIComponent(incidentId)}/links/${encodeURIComponent(bundleId)}`,
    {
      method: 'DELETE',
    },
  );

export const fetchPacketIncidentLinks = async (
  bundleId: string,
): Promise<IncidentPacketLink[]> =>
  requestJson<IncidentPacketLink[]>(
    `/api/incidents/packets/${encodeURIComponent(bundleId)}/links`,
  );

export const correlateIncidentPackets = async (incidentId: string): Promise<{
  incident: CapabilityIncident;
  candidates: IncidentCorrelationCandidate[];
  persisted: IncidentCorrelationCandidate[];
}> =>
  requestJson(`/api/incidents/${encodeURIComponent(incidentId)}/correlate`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({}),
  });

export const fetchIncidentPostmortemMarkdown = async (incidentId: string): Promise<string> =>
  requestText(`/api/incidents/${encodeURIComponent(incidentId)}/postmortem.md`);

export const fetchIncidentAlibiMarkdown = async (incidentId: string): Promise<string> =>
  requestText(`/api/incidents/${encodeURIComponent(incidentId)}/alibi.md`);

export const requestIncidentGuardrailPromotion = async (
  incidentId: string,
  bundleId: string,
  concernText: string,
): Promise<{
  promotion: Record<string, unknown>;
  approvalPolicy: ApprovalPolicy;
  assignments: ApprovalAssignment[];
}> =>
  requestJson(
    `/api/incidents/${encodeURIComponent(incidentId)}/links/${encodeURIComponent(bundleId)}/promote-guardrail`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ concernText }),
    },
  );

export const listIncidentSourceConfigs = async (): Promise<IncidentSourceConfig[]> =>
  requestJson<IncidentSourceConfig[]>('/api/incidents/config/sources');

export const updateIncidentSourceConfig = async (
  source: IncidentSource,
  config: Partial<IncidentSourceConfig>,
): Promise<IncidentSourceConfig> =>
  requestJson<IncidentSourceConfig>(`/api/incidents/config/sources/${encodeURIComponent(source)}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(config),
  });

export const deleteIncidentSourceConfig = async (source: IncidentSource) =>
  requestJson<{ status: 'deleted' }>(
    `/api/incidents/config/sources/${encodeURIComponent(source)}`,
    { method: 'DELETE' },
  );

export const listIncidentServiceCapabilityMaps = async (): Promise<IncidentServiceCapabilityMap[]> =>
  requestJson<IncidentServiceCapabilityMap[]>('/api/incidents/config/services');

export const updateIncidentServiceCapabilityMap = async (
  serviceName: string,
  payload: {
    capabilityId: string;
    defaultAffectedPaths?: string[];
    ownerEmail?: string;
  },
): Promise<IncidentServiceCapabilityMap> =>
  requestJson<IncidentServiceCapabilityMap>(
    `/api/incidents/config/services/${encodeURIComponent(serviceName)}`,
    {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const deleteIncidentServiceCapabilityMap = async (serviceName: string) =>
  requestJson<{ status: 'deleted' }>(
    `/api/incidents/config/services/${encodeURIComponent(serviceName)}`,
    { method: 'DELETE' },
  );

export const listIncidentExportTargetConfigs = async (): Promise<IncidentExportTargetConfig[]> =>
  requestJson<IncidentExportTargetConfig[]>('/api/incidents/exports/targets');

export const updateIncidentExportTargetConfig = async (
  target: IncidentExportTarget,
  config: Partial<IncidentExportTargetConfig>,
): Promise<IncidentExportTargetConfig> =>
  requestJson<IncidentExportTargetConfig>(
    `/api/incidents/exports/targets/${encodeURIComponent(target)}`,
    {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(config),
    },
  );

export const listIncidentExportDeliveries = async (params?: {
  incidentId?: string;
  capabilityId?: string;
  target?: IncidentExportTarget;
  limit?: number;
}): Promise<IncidentExportDelivery[]> => {
  const search = new URLSearchParams();
  if (params?.incidentId) {
    search.set('incidentId', params.incidentId);
  }
  if (params?.capabilityId) {
    search.set('capabilityId', params.capabilityId);
  }
  if (params?.target) {
    search.set('target', params.target);
  }
  if (params?.limit) {
    search.set('limit', String(params.limit));
  }
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return requestJson<IncidentExportDelivery[]>(`/api/incidents/exports/deliveries${suffix}`);
};

export const exportIncidentToTarget = async (
  incidentId: string,
  target: IncidentExportTarget,
): Promise<IncidentExportDelivery> =>
  requestJson<IncidentExportDelivery>(
    `/api/incidents/${encodeURIComponent(incidentId)}/export/${encodeURIComponent(target)}`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const fetchModelRiskMonitoringSummary = async (params?: {
  capabilityId?: string;
  windowDays?: number;
}): Promise<ModelRiskMonitoringSummary> => {
  const search = new URLSearchParams();
  if (params?.capabilityId) {
    search.set('capabilityId', params.capabilityId);
  }
  if (params?.windowDays) {
    search.set('windowDays', String(params.windowDays));
  }
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return requestJson<ModelRiskMonitoringSummary>(`/api/mrm/summary${suffix}`);
};

export const fetchModelRiskMonitoringExport = async (params?: {
  capabilityId?: string;
  windowDays?: number;
  format?: 'markdown' | 'json';
}): Promise<string> => {
  const search = new URLSearchParams();
  if (params?.capabilityId) {
    search.set('capabilityId', params.capabilityId);
  }
  if (params?.windowDays) {
    search.set('windowDays', String(params.windowDays));
  }
  if (params?.format) {
    search.set('format', params.format);
  }
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return requestText(`/api/mrm/export${suffix}`);
};

export const exportModelRiskMonitoringToTarget = async ({
  target,
  capabilityId,
  windowDays,
}: {
  target: IncidentExportTarget;
  capabilityId?: string;
  windowDays?: number;
}): Promise<IncidentExportDelivery> =>
  requestJson<IncidentExportDelivery>(`/api/mrm/export/${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      capabilityId,
      windowDays,
    }),
  });

export const fetchCapabilityConnectorContext = async (
  capabilityId: string,
): Promise<CapabilityConnectorContext> =>
  requestJson<CapabilityConnectorContext>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors`,
  );

export const syncCapabilityGithubConnector = async (
  capabilityId: string,
) =>
  requestJson<CapabilityConnectorContext['github']>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors/github/sync`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const syncCapabilityJiraConnector = async (
  capabilityId: string,
) =>
  requestJson<CapabilityConnectorContext['jira']>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors/jira/sync`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const transitionCapabilityJiraIssue = async (
  capabilityId: string,
  payload: { issueKey: string; transitionId: string },
) =>
  requestJson<{ status: 'READY'; message: string }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors/jira/transition`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const syncCapabilityConfluenceConnector = async (
  capabilityId: string,
) =>
  requestJson<CapabilityConnectorContext['confluence']>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors/confluence/sync`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const publishCapabilityArtifactToConfluence = async (
  capabilityId: string,
  payload: { artifactId: string; title?: string; parentPageId?: string },
) =>
  requestJson<{ status: 'READY'; message: string; url?: string; pageId?: string }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors/confluence/publish`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const fetchArtifactContent = async (
  capabilityId: string,
  artifactId: string,
): Promise<ArtifactContentResponse> =>
  requestJson<ArtifactContentResponse>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
  );

export const getArtifactDownloadUrl = (capabilityId: string, artifactId: string) =>
  resolveApiUrl(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/artifacts/${encodeURIComponent(artifactId)}/download`,
  );

export const getArtifactBlobUrl = (
  capabilityId: string,
  artifactId: string,
  options?: { inline?: boolean },
) =>
  resolveApiUrl(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/artifacts/${encodeURIComponent(artifactId)}/blob${
      options?.inline ? '?inline=1' : ''
    }`,
  );

export const uploadCapabilityWorkItemFiles = async (
  capabilityId: string,
  workItemId: string,
  files: File[],
): Promise<Artifact[]> => {
  const formData = new FormData();
  files.forEach(file => {
    formData.append('files', file);
  });

  const response = await fetch(
    resolveApiUrl(
      `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/uploads`,
    ),
    {
      method: 'POST',
      headers: withActorHeaders(),
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error(await getError(response));
  }

  const payload = (await response.json()) as { artifacts?: Artifact[] };
  return Array.isArray(payload.artifacts) ? payload.artifacts : [];
};

export const getWorkItemEvidenceBundleDownloadUrl = (
  capabilityId: string,
  workItemId: string,
) =>
  resolveApiUrl(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/evidence-bundle`,
  );

export const createCapabilityRecord = async (
  capability: CreateCapabilityInput,
): Promise<CapabilityBundle> =>
  requestJson<CapabilityBundle>('/api/capabilities', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(capability),
  });

export const updateCapabilityRecord = async (
  capabilityId: string,
  updates: Partial<Capability>,
): Promise<CapabilityBundle> =>
  requestJson<CapabilityBundle>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(updates),
    },
  );

export const fetchCapabilityArchitecture = async (
  capabilityId: string,
): Promise<CapabilityArchitectureSnapshot> =>
  requestJson<CapabilityArchitectureSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/architecture`,
  );

export const fetchCapabilityAccessSnapshot = async (
  capabilityId: string,
): Promise<CapabilityAccessSnapshot> =>
  requestJson<CapabilityAccessSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/access`,
  );

export const updateCapabilityAccessSnapshot = async (
  capabilityId: string,
  updates: Partial<CapabilityAccessSnapshot>,
): Promise<CapabilityAccessSnapshot> =>
  requestJson<CapabilityAccessSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/access`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(updates),
    },
  );

export const evaluateCapabilityPermission = async (
  capabilityId: string,
  action: PermissionAction,
): Promise<{
  capabilityId: string;
  action: PermissionAction;
  allowed: boolean;
  permissionSet: EffectivePermissionSet;
}> =>
  requestJson<{
    capabilityId: string;
    action: PermissionAction;
    allowed: boolean;
    permissionSet: EffectivePermissionSet;
  }>('/api/permissions/evaluate', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ capabilityId, action }),
  });

export const publishCapabilityContract = async (
  capabilityId: string,
): Promise<{ capability: Capability; snapshot: CapabilityPublishedSnapshot }> =>
  requestJson<{ capability: Capability; snapshot: CapabilityPublishedSnapshot }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/publish-contract`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const fetchCapabilityAlmExport = async (
  capabilityId: string,
): Promise<CapabilityAlmExportPayload> =>
  requestJson<CapabilityAlmExportPayload>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/alm-export`,
  );

export const addCapabilitySkillRecord = async (
  capabilityId: string,
  skill: Skill,
): Promise<CapabilityBundle> =>
  requestJson<CapabilityBundle>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/skills`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(skill),
    },
  );

export const removeCapabilitySkillRecord = async (
  capabilityId: string,
  skillId: string,
): Promise<CapabilityBundle> =>
  requestJson<CapabilityBundle>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/skills/${encodeURIComponent(skillId)}`,
    {
      method: 'DELETE',
    },
  );

export const addCapabilityAgentRecord = async (
  capabilityId: string,
  agent: CreateCapabilityAgentInput,
): Promise<CapabilityBundle> =>
  requestJson<CapabilityBundle>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(agent),
    },
  );

export const updateCapabilityAgentRecord = async (
  capabilityId: string,
  agentId: string,
  updates: Partial<CapabilityAgent>,
): Promise<CapabilityBundle> =>
  requestJson<CapabilityBundle>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/${encodeURIComponent(agentId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(updates),
    },
  );

export const updateCapabilityAgentModelsRecord = async (
  capabilityId: string,
  payload: { model: string },
): Promise<CapabilityBundle> =>
  requestJson<CapabilityBundle>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/bulk-model`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const appendCapabilityMessageRecord = async (
  capabilityId: string,
  message: Omit<CapabilityChatMessage, 'capabilityId'>,
): Promise<CapabilityWorkspace> =>
  requestJson<CapabilityWorkspace>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/messages`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(message),
    },
  );

export const setActiveChatAgentRecord = async (
  capabilityId: string,
  agentId: string,
): Promise<CapabilityWorkspace> =>
  requestJson<CapabilityWorkspace>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/chat-agent`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ agentId }),
    },
  );

export const replaceCapabilityWorkspaceContentRecord = async (
  capabilityId: string,
  updates: WorkspaceContentUpdate,
): Promise<CapabilityWorkspace> =>
  requestJson<CapabilityWorkspace>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/workspace`,
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(updates),
    },
  );

export const fetchCapabilityCodeWorkspaces = async (
  capabilityId: string,
): Promise<CodeWorkspaceStatus[]> =>
  requestJson<CodeWorkspaceStatus[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-workspaces`,
  );

export const createCapabilityCodeBranch = async (
  capabilityId: string,
  payload: { path: string; branchName: string },
): Promise<CodeWorkspaceStatus> =>
  requestJson<CodeWorkspaceStatus>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-workspaces/branch`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const createCapabilityWorkItem = async (
  capabilityId: string,
  payload: {
    title: string;
    description?: string;
    workflowId: string;
    taskType?: WorkItem['taskType'];
    phaseStakeholders?: WorkItemPhaseStakeholderAssignment[];
    attachments?: WorkItemAttachmentUpload[];
    priority: WorkItem['priority'];
    tags: string[];
  },
): Promise<WorkItem> =>
  requestJson<WorkItem>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const moveCapabilityWorkItem = async (
  capabilityId: string,
  workItemId: string,
  payload: { targetPhase: WorkItemPhase; note?: string; cancelRunIfPresent?: boolean },
): Promise<WorkItem> =>
  requestJson<WorkItem>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/move`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const cancelCapabilityWorkItem = async (
  capabilityId: string,
  workItemId: string,
  payload?: { note?: string },
): Promise<WorkItem> =>
  requestJson<WorkItem>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/cancel`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const archiveCapabilityWorkItem = async (
  capabilityId: string,
  workItemId: string,
  payload?: { note?: string },
): Promise<WorkItem> =>
  requestJson<WorkItem>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/archive`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const restoreCapabilityWorkItem = async (
  capabilityId: string,
  workItemId: string,
  payload?: { note?: string },
): Promise<WorkItem> =>
  requestJson<WorkItem>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/restore`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const fetchCapabilityWorkItemCollaboration = async (
  capabilityId: string,
  workItemId: string,
): Promise<{ claims: WorkItemClaim[]; presence: WorkItemPresence[] }> =>
  requestJson<{ claims: WorkItemClaim[]; presence: WorkItemPresence[] }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/collaboration`,
  );

export const fetchCapabilityWorkItemExecutionContext = async (
  capabilityId: string,
  workItemId: string,
): Promise<{ context: WorkItemExecutionContext | null; handoffs: WorkItemHandoffPacket[] }> =>
  requestJson<{ context: WorkItemExecutionContext | null; handoffs: WorkItemHandoffPacket[] }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/execution-context`,
  );

export const initializeCapabilityWorkItemExecutionContext = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkItemExecutionContext> =>
  requestJson<WorkItemExecutionContext>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/execution-context/initialize`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const createCapabilityWorkItemSharedBranch = async (
  capabilityId: string,
  workItemId: string,
): Promise<{
  context: WorkItemExecutionContext;
  repository?: CapabilityRepository;
  workspace?: CodeWorkspaceStatus;
}> =>
  requestJson<{
    context: WorkItemExecutionContext;
    repository?: CapabilityRepository;
    workspace?: CodeWorkspaceStatus;
  }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/branch/create`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const claimCapabilityWorkItemWriteControl = async (
  capabilityId: string,
  workItemId: string,
): Promise<{ claim: WorkItemCodeClaim; context: WorkItemExecutionContext | null }> =>
  requestJson<{ claim: WorkItemCodeClaim; context: WorkItemExecutionContext | null }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/claim/write`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const releaseCapabilityWorkItemWriteControl = async (
  capabilityId: string,
  workItemId: string,
): Promise<void> =>
  requestJson<void>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/claim/write`,
    {
      method: 'DELETE',
    },
  );

export const listCapabilityWorkItemHandoffs = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkItemHandoffPacket[]> =>
  requestJson<WorkItemHandoffPacket[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/handoff`,
  );

export const createCapabilityWorkItemHandoff = async (
  capabilityId: string,
  workItemId: string,
  payload: Omit<WorkItemHandoffPacket, 'id' | 'workItemId' | 'createdAt' | 'acceptedAt'>,
): Promise<WorkItemHandoffPacket> =>
  requestJson<WorkItemHandoffPacket>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/handoff`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const acceptCapabilityWorkItemHandoff = async (
  capabilityId: string,
  workItemId: string,
  packetId: string,
): Promise<{ packet: WorkItemHandoffPacket; context: WorkItemExecutionContext | null }> =>
  requestJson<{ packet: WorkItemHandoffPacket; context: WorkItemExecutionContext | null }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/handoff/${encodeURIComponent(packetId)}/accept`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const registerCapabilityWorkItemCheckout = async (
  capabilityId: string,
  workItemId: string,
  payload: WorkItemCheckoutSession,
): Promise<WorkItemCheckoutSession> =>
  requestJson<WorkItemCheckoutSession>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/checkout/register`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const claimCapabilityWorkItemControl = async (
  capabilityId: string,
  workItemId: string,
): Promise<{ claim: WorkItemClaim; workItem: WorkItem }> =>
  requestJson<{ claim: WorkItemClaim; workItem: WorkItem }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/claim`,
    {
      method: 'POST',
    },
  );

export const releaseCapabilityWorkItemControl = async (
  capabilityId: string,
  workItemId: string,
): Promise<void> =>
  requestJson<void>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/claim`,
    {
      method: 'DELETE',
    },
  );

export const updateCapabilityWorkItemPresence = async (
  capabilityId: string,
  workItemId: string,
  payload?: { viewContext?: string },
): Promise<WorkItemPresence> =>
  requestJson<WorkItemPresence>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/presence`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const startCapabilityWorkflowRun = async (
  capabilityId: string,
  workItemId: string,
  payload?: {
    restartFromPhase?: WorkItemPhase;
    guidance?: string;
    guidedBy?: string;
  },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/runs`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const listCapabilityWorkflowRuns = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkflowRun[]> =>
  requestJson<WorkflowRun[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/runs`,
  );

export const fetchCapabilityWorkflowRun = async (
  capabilityId: string,
  runId: string,
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}`,
  );

export const fetchCapabilityWorkflowRunEvents = async (
  capabilityId: string,
  runId: string,
): Promise<RunEvent[]> =>
  requestJson<RunEvent[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/events`,
  );

export const approveCapabilityWorkflowRun = async (
  capabilityId: string,
  runId: string,
  payload: { resolution: string; resolvedBy: string },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/approve`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const requestCapabilityWorkflowRunChanges = async (
  capabilityId: string,
  runId: string,
  payload: { resolution: string; resolvedBy: string },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/request-changes`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const provideCapabilityWorkflowRunInput = async (
  capabilityId: string,
  runId: string,
  payload: { resolution: string; resolvedBy: string },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/provide-input`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const resolveCapabilityWorkflowRunConflict = async (
  capabilityId: string,
  runId: string,
  payload: { resolution: string; resolvedBy: string },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/resolve-conflict`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const cancelCapabilityWorkflowRun = async (
  capabilityId: string,
  runId: string,
  payload?: { note?: string },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const pauseCapabilityWorkflowRun = async (
  capabilityId: string,
  runId: string,
  payload?: { note?: string },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/pause`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const resumeCapabilityWorkflowRun = async (
  capabilityId: string,
  runId: string,
  payload?: { note?: string },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/resume`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const restartCapabilityWorkflowRun = async (
  capabilityId: string,
  runId: string,
  payload?: {
    restartFromPhase?: WorkItemPhase;
    guidance?: string;
    guidedBy?: string;
  },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/restart`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const fetchRunConsoleSnapshot = async (
  capabilityId: string,
): Promise<RunConsoleSnapshot> =>
  requestJson<RunConsoleSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/run-console`,
  );

export const fetchOperationsDashboardSnapshot =
  async (): Promise<OperationsDashboardSnapshot> =>
    requestJson<OperationsDashboardSnapshot>('/api/reports/operations');

export const fetchExecutorRegistry = async (): Promise<ExecutorRegistrySummary> =>
  requestJson<ExecutorRegistrySummary>('/api/runtime/executors');

export const fetchExecutorRegistryEntry = async (
  executorId: string,
): Promise<ExecutorRegistryEntry> =>
  requestJson<ExecutorRegistryEntry>(
    `/api/runtime/executors/${encodeURIComponent(executorId)}`,
  );

export const removeDesktopExecutor = async (executorId: string): Promise<void> => {
  await requestJson<void>(`/api/runtime/executors/${encodeURIComponent(executorId)}`, {
    method: 'DELETE',
  });
};

export const fetchCapabilityTasks = async (
  capabilityId: string,
): Promise<AgentTask[]> =>
  requestJson<AgentTask[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/tasks`,
  );

export const fetchCapabilityTask = async (
  capabilityId: string,
  taskId: string,
): Promise<AgentTask> =>
  requestJson<AgentTask>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/tasks/${encodeURIComponent(taskId)}`,
  );

export const fetchTeamQueueSnapshot = async (
  teamId: string,
): Promise<TeamQueueSnapshot> =>
  requestJson<TeamQueueSnapshot>(
    `/api/reports/team/${encodeURIComponent(teamId)}`,
  );

export const fetchCapabilityHealthSnapshot = async (
  capabilityId: string,
): Promise<CapabilityHealthSnapshot> =>
  requestJson<CapabilityHealthSnapshot>(
    `/api/reports/capability/${encodeURIComponent(capabilityId)}`,
  );

export const fetchCollectionRollupSnapshot = async (
  capabilityId: string,
): Promise<CollectionRollupSnapshot> =>
  requestJson<CollectionRollupSnapshot>(
    `/api/reports/collection/${encodeURIComponent(capabilityId)}`,
  );

export const fetchExecutiveSummarySnapshot =
  async (): Promise<ExecutiveSummarySnapshot> =>
    requestJson<ExecutiveSummarySnapshot>('/api/reports/executive');

export const fetchAuditReportSnapshot = async (): Promise<AuditReportSnapshot> =>
  requestJson<AuditReportSnapshot>('/api/reports/audit');

export const fetchReportExportPayload = async (
  reportType: ReportExportPayload['reportType'],
  params?: {
    capabilityId?: string;
    teamId?: string;
  },
): Promise<ReportExportPayload> => {
  const search = new URLSearchParams();
  if (params?.capabilityId) {
    search.set('capabilityId', params.capabilityId);
  }
  if (params?.teamId) {
    search.set('teamId', params.teamId);
  }
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return requestJson<ReportExportPayload>(
    `/api/reports/export/${encodeURIComponent(reportType)}${suffix}`,
  );
};

export const fetchCopilotSessionMonitor = async (
  capabilityId: string,
): Promise<CopilotSessionMonitorSnapshot> =>
  requestJson<CopilotSessionMonitorSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/copilot-sessions`,
  );

export const fetchTelemetrySpans = async (
  capabilityId: string,
  limit = 80,
): Promise<TelemetrySpan[]> =>
  requestJson<TelemetrySpan[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/telemetry/spans?limit=${limit}`,
  );

export const fetchTelemetryMetrics = async (
  capabilityId: string,
  limit = 120,
): Promise<TelemetryMetricSample[]> =>
  requestJson<TelemetryMetricSample[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/telemetry/metrics?limit=${limit}`,
  );

export const fetchMemoryDocuments = async (
  capabilityId: string,
  agentId?: string,
): Promise<MemoryDocument[]> =>
  requestJson<MemoryDocument[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/memory/documents${
      agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''
    }`,
  );

export const searchCapabilityMemory = async (
  capabilityId: string,
  queryText: string,
  limit = 8,
  agentId?: string,
): Promise<MemorySearchResult[]> =>
  requestJson<MemorySearchResult[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/memory/search?q=${encodeURIComponent(queryText)}&limit=${limit}${
      agentId ? `&agentId=${encodeURIComponent(agentId)}` : ''
    }`,
  );

export const refreshCapabilityMemoryIndex = async (
  capabilityId: string,
): Promise<MemoryDocument[]> =>
  requestJson<MemoryDocument[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/memory/refresh`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const fetchAgentLearningProfile = async (
  capabilityId: string,
  agentId: string,
): Promise<AgentLearningProfileDetail> =>
  requestJson<AgentLearningProfileDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/${encodeURIComponent(agentId)}/learning`,
  );

export const refreshAgentLearningProfile = async (
  capabilityId: string,
  agentId: string,
): Promise<AgentLearningProfileDetail> =>
  requestJson<AgentLearningProfileDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/${encodeURIComponent(agentId)}/learning/refresh`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const submitAgentLearningCorrection = async (
  capabilityId: string,
  agentId: string,
  payload: {
    correction: string;
    workItemId?: string;
    runId?: string;
  },
): Promise<AgentLearningProfileDetail> =>
  requestJson<AgentLearningProfileDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/${encodeURIComponent(agentId)}/learning/corrections`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const listCapabilityEvalSuites = async (
  capabilityId: string,
): Promise<EvalSuite[]> =>
  requestJson<EvalSuite[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/evals/suites`,
  );

export const listCapabilityEvalRuns = async (
  capabilityId: string,
): Promise<EvalRun[]> =>
  requestJson<EvalRun[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/evals/runs`,
  );

export const fetchCapabilityEvalRun = async (
  capabilityId: string,
  runId: string,
): Promise<EvalRunDetail> =>
  requestJson<EvalRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/evals/runs/${encodeURIComponent(runId)}`,
  );

export const runCapabilityEvalSuite = async (
  capabilityId: string,
  suiteId: string,
): Promise<EvalRunDetail> =>
  requestJson<EvalRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/evals/suites/${encodeURIComponent(suiteId)}/run`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const streamCapabilityChat = async (
  payload: CapabilityChatRequest,
  handlers: {
    onEvent: (event: ChatStreamEvent) => void;
  },
  options?: {
    signal?: AbortSignal;
  },
): Promise<CapabilityChatStreamResult> => {
  if (isDesktopRuntime()) {
    const desktop = getDesktopBridge();
    if (!desktop) {
      throw new Error('Desktop runtime bridge is not available.');
    }

    const streamId = `desktop-chat-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const state = createCapabilityChatStreamAccumulator();
    let aborted = false;

    const abortHandler = () => {
      aborted = true;
      void desktop.cancelRuntimeChatStream(streamId).catch(() => undefined);
    };

    options?.signal?.addEventListener('abort', abortHandler, { once: true });

    try {
      await desktop.streamRuntimeChat(
        {
          ...payload,
          streamId,
          actorContext: currentActorContext,
        },
        event => {
          if (aborted) {
            return;
          }

          processCapabilityChatStreamEvent({
            event: event as ChatStreamEvent,
            handlers,
            state,
          });
        },
      );
    } catch (error) {
      if (aborted) {
        return finalizeCapabilityChatStream({
          state,
          aborted: true,
        });
      }

      throw error;
    } finally {
      options?.signal?.removeEventListener('abort', abortHandler);
    }

    return finalizeCapabilityChatStream({
      state,
      aborted,
    });
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl('/api/runtime/chat/stream'), {
      method: 'POST',
      headers: withActorHeaders(jsonHeaders),
      body: JSON.stringify(payload),
      signal: options?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        termination: 'empty',
        draftContent: '',
        completeEvent: null,
        error: 'Streaming response was stopped before completion.',
        memoryReferences: [],
        sawDelta: false,
        sawComplete: false,
        sawError: false,
      };
    }

    throw error;
  }

  if (!response.ok) {
    throw new Error(await getError(response));
  }

  if (!response.body) {
    throw new Error('Streaming response body was not available.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const state = createCapabilityChatStreamAccumulator();
  let aborted = false;

  const processFrame = (frame: string) => {
    const trimmedFrame = frame.trim();
    if (!trimmedFrame) {
      return;
    }

    const eventType =
      trimmedFrame
        .split('\n')
        .find(line => line.startsWith('event:'))
        ?.replace(/^event:\s*/, '')
        .trim() || 'message';
    const data = trimmedFrame
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.replace(/^data:\s*/, ''))
      .join('\n');

    if (!data) {
      return;
    }

    try {
      const streamEvent = JSON.parse(data) as ChatStreamEvent;
      processCapabilityChatStreamEvent({
        event: {
          ...streamEvent,
          type: streamEvent.type || (eventType as ChatStreamEvent['type']),
        },
        handlers,
        state,
      });
    } catch {
      // Ignore malformed trailing frames so partial streamed output can still recover.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });

      const frames = buffered.split('\n\n');
      const trailingFrame = done ? '' : frames.pop() || '';

      for (const frame of frames) {
        processFrame(frame);
      }

      if (done) {
        if (trailingFrame.trim()) {
          processFrame(trailingFrame);
        }
        break;
      }

      buffered = trailingFrame;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      aborted = true;
    } else {
      throw error;
    }
  }

  return finalizeCapabilityChatStream({
    state,
    aborted,
  });
};

export const continueCapabilityWorkItemStageControl = async (
  capabilityId: string,
  workItemId: string,
  payload: {
    agentId?: string;
    conversation: Array<{
      role: 'user' | 'agent';
      content: string;
      timestamp?: string;
    }>;
    carryForwardNote?: string;
    resolvedBy?: string;
  },
): Promise<StageControlContinueResponse> =>
  requestJson<StageControlContinueResponse>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/stage-control/continue`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );
