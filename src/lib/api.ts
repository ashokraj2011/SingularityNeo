import {
  ActorContext,
  AgentTask,
  AgentLearningDriftState,
  AgentLearningProfileDetail,
  AgentLearningProfileVersion,
  AgentLearningVersionDiff,
  Artifact,
  ArtifactContentResponse,
  Capability,
  CapabilityAgent,
  CapabilityExecutionOwnership,
  CapabilityAlmExportPayload,
  CapabilityArchitectureSnapshot,
  CapabilityChatMessage,
  CapabilityCodeIndexSnapshot,
  CapabilityCodeSymbol,
  CapabilityCodeSymbolKind,
  LocalAstSnapshot,
  CapabilityCopilotGuidancePack,
  CodePatchPayload,
  AgentBranchSession,
  AgentBranchCommitResult,
  AgentPullRequest,
  CapabilityRepository,
  CapabilityPublishedSnapshot,
  CapabilityDeploymentTarget,
  ChatDistillationResult,
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
  ToolAdapterId,
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
  WorkItemEfficiencySnapshot,
  ApprovalWorkspaceContext,
  ApprovalStructuredPacket,
  AttestationChain,
  EvidencePacket,
  EvidencePacketVerification,
  SignerStatus,
  GovernanceControlBinding,
  GovernanceControlBindingInput,
  GovernanceControlsListResponse,
  GovernanceControlWithBindings,
  GovernanceException,
  GovernanceExceptionDecisionInput,
  GovernanceExceptionRequestInput,
  GovernanceExceptionWithEvents,
  GovernanceExceptionsListResponse,
  GovernanceExceptionStatus,
  ProveNoTouchInput,
  ProveNoTouchResult,
  ProvenanceCoverageWindow,
  BlastRadiusSymbolGraph,
  GovernancePostureSnapshot,
  GovernanceCostAllocationSnapshot,
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
  PlanningGenerationRequest,
  ApprovalPolicy,
  ApprovalAssignment,
  AgentSessionScope,
  StoryProposalBatch,
  StoryProposalBatchSummary,
  StoryProposalPromotionResult,
  StoryProposalItem,
  MemoryRetrievalMode,
  RuntimePreflightSnapshot,
  RuntimeReadinessCheck,
  RuntimeReadinessState,
  WorkspaceDatabaseRuntimeInfo,
  WorkspaceWriteLock,
  DesktopWorkspaceMapping,
  WorkItemSegment,
  NextSegmentPreset,
  ChatParticipantDirectory,
  SwarmSessionDetail,
  SwarmSessionSummary,
  ProviderKey,
  RuntimeModelOption,
  RuntimeProviderConfig,
  RuntimeProviderProbeResult,
  RuntimeProviderStatus,
  RuntimeProviderValidationResult,
  RuntimeTransportMode,
  AgentMindSnapshot,
  PersistedPromptReceiptFragment,
  PersistedPromptReceiptEviction,
  PersistedPromptReceipt,
  PromptReceiptReplayResponse,
} from "../types";
import { getDesktopBridge, isDesktopRuntime, resolveApiUrl } from "./desktop";

export interface RuntimeStatus {
  configured: boolean;
  provider: string;
  providerKey?: ProviderKey;
  readinessState?: RuntimeReadinessState;
  checks?: RuntimeReadinessCheck[];
  controlPlaneUrl?: string;
  desktopExecutorId?: string;
  /** Stable hash-based machine identity e.g. "DID-3A7F2B9C1D4E5F60" */
  desktopId?: string;
  /** OS hostname of the desktop machine */
  desktopHostname?: string;
  workingDirectorySource?: "mapping" | "env" | "project-root" | "missing";
  embeddingProviderKey?: "local-openai" | "deterministic-hash";
  embeddingConfigured?: boolean;
  retrievalMode?: MemoryRetrievalMode;
  fallbackReason?: string | null;
  embeddingEndpoint?: string | null;
  embeddingModel?: string | null;
  embeddingApiKeyConfigured?: boolean;
  availableProviders?: RuntimeProviderStatus[];
  endpoint: string;
  runtimeOwner?: "DESKTOP" | "SERVER";
  executionRuntimeOwner?: "DESKTOP" | "SERVER";
  tokenSource: string | null;
  defaultModel: string;
  modelCatalogSource?: "runtime" | "fallback";
  runtimeAccessMode?: RuntimeTransportMode;
  httpFallbackEnabled?: boolean;
  databaseRuntime?: WorkspaceDatabaseRuntimeInfo;
  activeDatabaseProfileId?: string | null;
  activeDatabaseProfileLabel?: string | null;
  executorId?: string;
  executorHeartbeatAt?: string;
  executorHeartbeatStatus?: "FRESH" | "STALE" | "OFFLINE";
  actorUserId?: string;
  actorDisplayName?: string;
  ownedCapabilityIds?: string[];
  /** User-level working directory for the active desktop executor (if set). */
  workingDirectory?: string;
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
  availableModels: RuntimeModelOption[];
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
  runtimeProviderKey?: ProviderKey;
  runtimeTransportMode?: RuntimeTransportMode;
  runtimeEndpoint?: string | null;
  runtimeCommand?: string | null;
  sessionId?: string;
  sessionScope?: "GENERAL_CHAT" | "WORK_ITEM" | "TASK";
  sessionScopeId?: string;
  isNewSession?: boolean;
  groundingEvidenceSource?: "local-checkout" | "capability-index" | "none";
  memoryTrustMode?: "standard" | "repo-evidence-only";
  pathValidationState?: "verified" | "repaired" | "stripped" | "none";
  unverifiedPathClaimsRemoved?: string[];
  historyTurnCount?: number;
  historyRolledUp?: boolean;
  workContextHydrated?: boolean;
  workContextSource?: "live-work-item" | "live-workspace";
  followUpBindingMode?: "none" | "latest-assistant-turn" | "active-work-scope";
  chatRuntimeLane?: "server-runtime-route" | "desktop-runtime-worker";
  toolLoopUsed?: boolean;
  attemptedToolIds?: ToolAdapterId[];
  codeDiscoveryMode?: "prompt-only" | "ast-first-tool-loop";
  codeDiscoveryFallback?: "none" | "capability-index" | "text-search";
  astSource?: "none" | "local-checkout" | "capability-index" | "text-search";
}

export interface CapabilityChatStreamResult {
  termination: "complete" | "recovered" | "interrupted" | "empty";
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

export type CreateCapabilityInput = Omit<Capability, "id"> & { id?: string };

export type CreateCapabilityAgentInput = Omit<
  CapabilityAgent,
  "capabilityId" | "id"
> & {
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
    | "workflows"
    | "artifacts"
    | "tasks"
    | "executionLogs"
    | "learningUpdates"
    | "workItems"
    | "activeChatAgentId"
  >
>;

interface CapabilityChatRequest {
  capability: Capability;
  agent: CapabilityAgent;
  history: CapabilityChatMessage[];
  message: string;
  sessionMode?: "resume" | "fresh";
  sessionScope?: "GENERAL_CHAT" | "WORK_ITEM" | "TASK";
  sessionScopeId?: string;
  contextMode?: "GENERAL" | "WORK_ITEM_STAGE";
  workItemId?: string;
  runId?: string;
  workflowStepId?: string;
  /**
   * Optional cross-capability participants. The anchor (`capability`) is
   * unchanged; participants identify which agents the operator tagged from
   * linked capabilities. 0 or 1 participants stay on the single-agent path;
   * 2-3 participants should be routed through `startSwarmDebate` instead.
   */
  participants?: Array<{ capabilityId: string; agentId: string }>;
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
  "Content-Type": "application/json",
};

let currentActorContext: ActorContext | null = null;

const withActorHeaders = (headers?: HeadersInit): HeadersInit => {
  const nextHeaders = new Headers(headers || {});

  if (currentActorContext?.userId) {
    nextHeaders.set("x-singularity-actor-user-id", currentActorContext.userId);
  }
  if (currentActorContext?.displayName) {
    nextHeaders.set(
      "x-singularity-actor-display-name",
      currentActorContext.displayName,
    );
  }
  if (currentActorContext?.teamIds?.length) {
    nextHeaders.set(
      "x-singularity-actor-team-ids",
      JSON.stringify(currentActorContext.teamIds),
    );
  }
  if (currentActorContext?.actedOnBehalfOfStakeholderIds?.length) {
    nextHeaders.set(
      "x-singularity-actor-stakeholder-ids",
      JSON.stringify(currentActorContext.actedOnBehalfOfStakeholderIds),
    );
  }

  return nextHeaders;
};

const requestJson = async <T>(
  input: string,
  init?: RequestInit,
): Promise<T> => {
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

const requestText = async (
  input: string,
  init?: RequestInit,
): Promise<string> => {
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

  return requestJson<RuntimeStatus>("/api/runtime/status");
};

export const fetchRuntimePreflight = async (): Promise<RuntimePreflightSnapshot> => {
  return requestJson<RuntimePreflightSnapshot>("/api/runtime/preflight");
};

export const fetchWorkspaceWriteLock = async (
  capabilityId: string,
): Promise<WorkspaceWriteLock | null> => {
  const data = await requestJson<{ lock: WorkspaceWriteLock | null }>(
    `/api/capabilities/${capabilityId}/workspace-lock`,
  );
  return data.lock;
};

export const updateRuntimeCredentials = async (
  token: string,
): Promise<RuntimeStatus> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return desktop.setRuntimeToken(token) as Promise<RuntimeStatus>;
  }

  return requestJson<RuntimeStatus>("/api/runtime/credentials", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ token }),
  });
};

export const clearRuntimeCredentials = async (): Promise<RuntimeStatus> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return desktop.clearRuntimeToken() as Promise<RuntimeStatus>;
  }

  return requestJson<RuntimeStatus>("/api/runtime/credentials", {
    method: "DELETE",
  });
};

export const fetchRuntimeProviders = async (): Promise<RuntimeProviderStatus[]> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop && typeof desktop.listRuntimeProviders === 'function') {
    return desktop.listRuntimeProviders() as Promise<RuntimeProviderStatus[]>;
  }

  const payload = await requestJson<{ providers: RuntimeProviderStatus[] }>(
    '/api/runtime/providers',
  );
  return payload.providers || [];
};

export const saveRuntimeProviderConfig = async ({
  providerKey,
  config,
  setDefault,
  clearDefault,
}: {
  providerKey: ProviderKey;
  config: RuntimeProviderConfig;
  setDefault?: boolean;
  clearDefault?: boolean;
}): Promise<{
  provider: RuntimeProviderStatus;
  providers: RuntimeProviderStatus[];
}> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop && typeof desktop.saveRuntimeProviderConfig === 'function') {
    return desktop.saveRuntimeProviderConfig({
      providerKey,
      config,
      setDefault,
      clearDefault,
    }) as Promise<{
      provider: RuntimeProviderStatus;
      providers: RuntimeProviderStatus[];
    }>;
  }

  return requestJson<{
    provider: RuntimeProviderStatus;
    providers: RuntimeProviderStatus[];
  }>(`/api/runtime/providers/${encodeURIComponent(providerKey)}/config`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({
      config,
      setDefault,
      clearDefault,
    }),
  });
};

export const validateRuntimeProvider = async ({
  providerKey,
  config,
}: {
  providerKey: ProviderKey;
  config?: RuntimeProviderConfig;
}): Promise<RuntimeProviderValidationResult> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop && typeof desktop.validateRuntimeProvider === 'function') {
    return desktop.validateRuntimeProvider({
      providerKey,
      config,
    }) as Promise<RuntimeProviderValidationResult>;
  }

  return requestJson<RuntimeProviderValidationResult>(
    `/api/runtime/providers/${encodeURIComponent(providerKey)}/validate`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        config,
      }),
    },
  );
};

export const probeRuntimeProvider = async ({
  providerKey,
  endpointHint,
  commandHint,
  modelHint,
}: {
  providerKey: ProviderKey;
  endpointHint?: string;
  commandHint?: string;
  modelHint?: string;
}): Promise<RuntimeProviderProbeResult> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop && typeof desktop.probeRuntimeProvider === 'function') {
    return desktop.probeRuntimeProvider({
      providerKey,
      endpointHint,
      commandHint,
      modelHint,
    }) as Promise<RuntimeProviderProbeResult>;
  }

  return requestJson<RuntimeProviderProbeResult>(
    `/api/runtime/providers/${encodeURIComponent(providerKey)}/probe`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        endpointHint,
        commandHint,
        modelHint,
      }),
    },
  );
};

export const fetchRuntimeProviderModels = async (
  providerKey: ProviderKey,
): Promise<RuntimeModelOption[]> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop && typeof desktop.getRuntimeProviderModels === 'function') {
    return desktop.getRuntimeProviderModels(providerKey) as Promise<RuntimeModelOption[]>;
  }

  const payload = await requestJson<{ models: RuntimeModelOption[] }>(
    `/api/runtime/providers/${encodeURIComponent(providerKey)}/models`,
  );
  return payload.models || [];
};

export const updateLocalEmbeddingSettings = async ({
  baseUrl,
  apiKey,
  model,
}: {
  baseUrl: string;
  apiKey?: string;
  model?: string;
}): Promise<RuntimeStatus> => {
  const desktop = getDesktopBridge();
  if (!desktop?.isDesktop) {
    throw new Error('Local embedding settings can only be configured from the desktop runtime.');
  }

  return desktop.setEmbeddingConfig({
    baseUrl,
    apiKey,
    model,
  }) as Promise<RuntimeStatus>;
};

export const clearLocalEmbeddingSettings = async (): Promise<RuntimeStatus> => {
  const desktop = getDesktopBridge();
  if (!desktop?.isDesktop) {
    throw new Error('Local embedding settings can only be configured from the desktop runtime.');
  }

  return desktop.clearEmbeddingConfig() as Promise<RuntimeStatus>;
};

/**
 * Fetches stored non-secret desktop preferences from the control plane.
 * Passes the current machine hostname via a header so the server returns
 * the correct row without requiring auth.
 */
export const fetchDesktopPreferences = async (): Promise<import('../types').DesktopPreferences | null> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return desktop.getDesktopPreferences() as Promise<import('../types').DesktopPreferences | null>;
  }
  return requestJson<import('../types').DesktopPreferences | null>(
    '/api/runtime/desktop-preferences',
  );
};

/**
 * Saves non-secret desktop preferences to the DB and applies them immediately.
 * Security tokens are not accepted here — use the credentials endpoints instead.
 */
export const saveDesktopPreferences = async (
  prefs: Partial<import('../types').DesktopPreferences>,
): Promise<import('../types').DesktopPreferences> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return (desktop.setDesktopPreferences(prefs) as Promise<{ saved: import('../types').DesktopPreferences }>)
      .then(r => r.saved);
  }
  return requestJson<import('../types').DesktopPreferences>(
    '/api/runtime/desktop-preferences',
    {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(prefs),
    },
  );
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

  throw new Error(
    "A desktop runtime is required to claim capability execution.",
  );
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

  throw new Error(
    "A desktop runtime is required to release capability execution.",
  );
};

export interface RepoSyncResult {
  repositoryId: string;
  repositoryLabel: string;
  checkoutPath: string;
  status: 'cloned' | 'updated' | 'already-current' | 'skipped' | 'error';
  error?: string;
}

export interface CapabilityRepoSyncReport {
  capabilityId: string;
  executorId: string;
  workingDirectory: string;
  repos: RepoSyncResult[];
  syncedAt: string;
}

/**
 * Explicitly triggers git clone + AST index build for all repositories
 * configured on a capability.  Pass `fetch: true` to also pull the latest
 * remote changes into existing clones.
 */
export const syncCapabilityRepositories = async ({
  capabilityId,
  executorId,
  fetch = false,
}: {
  capabilityId: string;
  executorId: string;
  fetch?: boolean;
}): Promise<CapabilityRepoSyncReport> =>
  requestJson<CapabilityRepoSyncReport>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/execution/repo-sync`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ executorId, fetch }),
    },
  );

export const fetchDesktopWorkspaceMappings = async ({
  executorId,
  userId,
  capabilityId,
}: {
  executorId: string;
  userId?: string;
  capabilityId?: string;
}): Promise<DesktopWorkspaceMapping[]> => {
  const params = new URLSearchParams();
  if (userId) {
    params.set("userId", userId);
  }
  if (capabilityId) {
    params.set("capabilityId", capabilityId);
  }

  const payload = await requestJson<{ mappings: DesktopWorkspaceMapping[] }>(
    `/api/runtime/executors/${encodeURIComponent(executorId)}/workspace-mappings${
      params.size ? `?${params.toString()}` : ""
    }`,
  );
  return payload.mappings || [];
};

export const createDesktopWorkspaceMapping = async (
  executorId: string,
  payload: {
    userId?: string;
    capabilityId: string;
    repositoryId?: string;
    localRootPath?: string;
    workingDirectoryPath?: string;
  },
): Promise<DesktopWorkspaceMapping> =>
  requestJson<DesktopWorkspaceMapping>(
    `/api/runtime/executors/${encodeURIComponent(executorId)}/workspace-mappings`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const updateDesktopWorkspaceMapping = async (
  executorId: string,
  mappingId: string,
  payload: Partial<{
    capabilityId: string;
    repositoryId?: string;
    localRootPath?: string;
    workingDirectoryPath?: string;
  }>,
): Promise<DesktopWorkspaceMapping> =>
  requestJson<DesktopWorkspaceMapping>(
    `/api/runtime/executors/${encodeURIComponent(executorId)}/workspace-mappings/${encodeURIComponent(mappingId)}`,
    {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const deleteDesktopWorkspaceMapping = async (
  executorId: string,
  mappingId: string,
): Promise<void> =>
  requestJson<void>(
    `/api/runtime/executors/${encodeURIComponent(executorId)}/workspace-mappings/${encodeURIComponent(mappingId)}`,
    {
      method: "DELETE",
    },
  );

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

  return requestJson<CapabilityChatResponse>("/api/runtime/chat", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
};

// ─── Swarm Debate ─────────────────────────────────────────────────────────
// Client helpers for the multi-agent debate flow. Kept near sendCapabilityChat
// so callers can pivot from single-agent chat to a swarm without hunting for
// the right module.

export interface SwarmKickoffInput {
  capabilityId: string;
  workItemId?: string;
  sessionScope?: "WORK_ITEM" | "GENERAL_CHAT";
  initiatingPrompt: string;
  leadParticipantIndex?: number;
  maxTokenBudget?: number;
  participants: Array<{ capabilityId: string; agentId: string }>;
}

export interface SwarmKickoffResponse {
  sessionId: string;
  session: SwarmSessionSummary;
  participants: SwarmSessionDetail["participants"];
  voteTool: { name: string; schema: Record<string, unknown> };
}

export const getChatParticipants = async (
  capabilityId: string,
): Promise<ChatParticipantDirectory> =>
  requestJson<ChatParticipantDirectory>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/chat-participants`,
  );

export const startSwarmDebate = async (
  input: SwarmKickoffInput,
): Promise<SwarmKickoffResponse> =>
  requestJson<SwarmKickoffResponse>("/api/runtime/chat/swarm", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(input),
  });

export const getSwarmSession = async (
  capabilityId: string,
  sessionId: string,
): Promise<SwarmSessionDetail> =>
  requestJson<SwarmSessionDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/swarm-sessions/${encodeURIComponent(sessionId)}`,
  );

export const listSwarmSessionsForWorkItem = async (
  capabilityId: string,
  workItemId: string,
): Promise<{ sessions: SwarmSessionSummary[] }> =>
  requestJson<{ sessions: SwarmSessionSummary[] }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/swarm-sessions`,
  );

export const reviewSwarmSession = async (
  capabilityId: string,
  sessionId: string,
  decision: "APPROVE" | "REJECT",
  comment?: string,
): Promise<SwarmSessionDetail> =>
  requestJson<SwarmSessionDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/swarm-sessions/${encodeURIComponent(sessionId)}/review`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ decision, comment }),
    },
  );

export const promoteSwarmSessionToWorkItem = async (
  capabilityId: string,
  sessionId: string,
  overrides?: { title?: string; brief?: string },
): Promise<{
  workItem: WorkItem;
  swarmSessionId: string;
  linkedArtifactId?: string;
}> =>
  requestJson(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/swarm-sessions/${encodeURIComponent(sessionId)}/promote-to-work-item`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(overrides || {}),
    },
  );

export const cancelSwarmSession = async (
  capabilityId: string,
  sessionId: string,
): Promise<void> => {
  await requestJson(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/swarm-sessions/${encodeURIComponent(sessionId)}/cancel`,
    { method: "POST", headers: jsonHeaders },
  );
};

/**
 * Subscribe to a swarm session's SSE event stream. Returns an unsubscribe
 * function; the caller is responsible for invoking it when the UI unmounts
 * (or when the session reaches a terminal state, whichever comes first).
 */
export const streamSwarmDebate = (
  capabilityId: string,
  sessionId: string,
  handlers: {
    onTurn?: (turn: CapabilityChatMessage) => void;
    onStatus?: (status: string) => void;
    onTerminal?: (payload: {
      status: string;
      terminalReason: string;
      artifactId?: string;
    }) => void;
    onError?: (error: Error) => void;
  },
): (() => void) => {
  const url = resolveApiUrl(
    `/api/runtime/chat/swarm/stream?sessionId=${encodeURIComponent(sessionId)}&capabilityId=${encodeURIComponent(capabilityId)}`,
  );
  const source = new EventSource(url, { withCredentials: false });
  source.addEventListener("turn", (event: MessageEvent) => {
    try {
      const payload = JSON.parse(event.data) as { turn: CapabilityChatMessage };
      handlers.onTurn?.(payload.turn);
    } catch (error) {
      handlers.onError?.(error as Error);
    }
  });
  source.addEventListener("status", (event: MessageEvent) => {
    try {
      const payload = JSON.parse(event.data) as { status: string };
      handlers.onStatus?.(payload.status);
    } catch (error) {
      handlers.onError?.(error as Error);
    }
  });
  source.addEventListener("terminal", (event: MessageEvent) => {
    try {
      const payload = JSON.parse(event.data) as {
        status: string;
        terminalReason: string;
        artifactId?: string;
      };
      handlers.onTerminal?.(payload);
      source.close();
    } catch (error) {
      handlers.onError?.(error as Error);
    }
  });
  source.addEventListener("error", () => {
    handlers.onError?.(new Error("Swarm stream disconnected."));
  });
  return () => source.close();
};

const createCapabilityChatStreamAccumulator =
  (): CapabilityChatStreamAccumulator => ({
    draftContent: "",
    completeEvent: null,
    sawDelta: false,
    sawComplete: false,
    sawError: false,
    streamError: "",
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
  if (event.type === "memory") {
    state.memoryReferences = event.memoryReferences || [];
  }
  if (event.type === "delta" && event.content) {
    state.sawDelta = true;
    state.draftContent += event.content;
  }
  if (event.type === "complete") {
    state.sawComplete = true;
    state.completeEvent = event;
    state.draftContent = event.content || state.draftContent;
    state.memoryReferences = event.memoryReferences || state.memoryReferences;
  }
  if (event.type === "error") {
    state.sawError = true;
    state.streamError = event.error || "The runtime ended this stream early.";
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
    ? "complete"
    : trimmedDraft
      ? state.sawError || aborted
        ? "interrupted"
        : "recovered"
      : "empty";

  return {
    termination,
    draftContent: state.draftContent,
    completeEvent: state.completeEvent,
    error:
      state.streamError ||
      (aborted
        ? "Streaming response was stopped before completion."
        : undefined),
    retryAfterMs: state.retryAfterMs,
    memoryReferences: state.memoryReferences,
    sawDelta: state.sawDelta,
    sawComplete: state.sawComplete,
    sawError: state.sawError,
  };
};

export const fetchAppState = async (): Promise<AppState> =>
  requestJson<AppState>("/api/state");

export const fetchWorkspaceOrganization =
  async (): Promise<WorkspaceOrganization> =>
    requestJson<WorkspaceOrganization>("/api/workspace/organization");

export const updateWorkspaceOrganizationRecord = async (
  updates: Partial<WorkspaceOrganization>,
): Promise<WorkspaceOrganization> =>
  requestJson<WorkspaceOrganization>("/api/workspace/organization", {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });

export const fetchWorkspaceAccessSnapshot =
  async (): Promise<WorkspaceAccessSnapshot> =>
    requestJson<WorkspaceAccessSnapshot>("/api/workspace/access");

export const updateWorkspaceAccessSnapshot = async (
  updates: Partial<WorkspaceOrganization>,
): Promise<WorkspaceAccessSnapshot> =>
  requestJson<WorkspaceAccessSnapshot>("/api/workspace/access", {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });

export const updateWorkspaceUserPreferenceRecord = async (
  userId: string,
  updates: Partial<UserPreference>,
): Promise<UserPreference> =>
  requestJson<UserPreference>(
    `/api/workspace/users/${encodeURIComponent(userId)}/preferences`,
    {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(updates),
    },
  );

export const fetchDatabaseBootstrapStatus =
  async (): Promise<WorkspaceDatabaseBootstrapStatus> =>
    requestJson<WorkspaceDatabaseBootstrapStatus>(
      "/api/bootstrap/database/status",
    );

export const setupDatabaseBootstrap = async (
  payload: WorkspaceDatabaseBootstrapConfig,
): Promise<WorkspaceDatabaseBootstrapResult> =>
  requestJson<WorkspaceDatabaseBootstrapResult>(
    "/api/bootstrap/database/setup",
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const fetchDatabaseBootstrapProfiles =
  async (): Promise<WorkspaceDatabaseBootstrapProfileSnapshot> =>
    requestJson<WorkspaceDatabaseBootstrapProfileSnapshot>(
      "/api/bootstrap/database/profiles",
    );

export const activateDatabaseBootstrapProfile = async (
  profileId: string,
): Promise<WorkspaceDatabaseBootstrapResult> =>
  requestJson<WorkspaceDatabaseBootstrapResult>(
    `/api/bootstrap/database/profiles/${encodeURIComponent(profileId)}/activate`,
    {
      method: "POST",
      headers: jsonHeaders,
    },
  );

export const fetchWorkspaceSettings = async (): Promise<WorkspaceSettings> =>
  requestJson<WorkspaceSettings>("/api/workspace/settings");

export const updateWorkspaceSettingsRecord = async (
  updates: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> =>
  requestJson<WorkspaceSettings>("/api/workspace/settings", {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });

export const fetchWorkspaceConnectors =
  async (): Promise<WorkspaceConnectorSettings> =>
    requestJson<WorkspaceConnectorSettings>("/api/workspace/connectors");

export const updateWorkspaceConnectors = async (
  updates: Partial<WorkspaceConnectorSettings>,
): Promise<WorkspaceConnectorSettings> =>
  requestJson<WorkspaceConnectorSettings>("/api/workspace/connectors", {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify(updates),
  });

export const fetchWorkspaceCatalogSnapshot =
  async (): Promise<WorkspaceCatalogSnapshot> =>
    requestJson<WorkspaceCatalogSnapshot>("/api/workspace/catalog");

export const initializeWorkspaceFoundationCatalog =
  async (): Promise<WorkspaceCatalogSnapshot> =>
    requestJson<WorkspaceCatalogSnapshot>("/api/workspace/catalog/initialize", {
      method: "POST",
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
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ repositories }),
    },
  );

/**
 * Read the last-fetched copilot guidance pack for a capability (the
 * CLAUDE.md / AGENTS.md / .cursor/rules bundle that gets injected into
 * scoped agent system prompts). Pure read — does not hit GitHub.
 */
export const fetchCapabilityCopilotGuidance = async (
  capabilityId: string,
): Promise<CapabilityCopilotGuidancePack> =>
  requestJson<CapabilityCopilotGuidancePack>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/copilot-guidance`,
  );

/**
 * Trigger a fresh fetch from GitHub for every linked repository. The
 * server walks the well-known path list, persists the latest blobs, and
 * returns the refreshed pack.
 */
export const refreshCapabilityCopilotGuidance = async (
  capabilityId: string,
): Promise<CapabilityCopilotGuidancePack> =>
  requestJson<CapabilityCopilotGuidancePack>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/copilot-guidance/refresh`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

/**
 * Distill the current chat session into a durable learning correction for
 * the agent. Idempotent per (capability, agent, session); pass force=true
 * to re-distill a session that was already processed.
 */
export const distillAgentChatSession = async (
  capabilityId: string,
  agentId: string,
  sessionId: string,
  payload: {
    agentName?: string;
    workItemId?: string;
    runId?: string;
    force?: boolean;
  } = {},
): Promise<ChatDistillationResult> =>
  requestJson<ChatDistillationResult>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/${encodeURIComponent(agentId)}/chat-sessions/${encodeURIComponent(sessionId)}/distill`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

/**
 * Read the structured summary of the parsed code index for a capability —
 * per-repo symbol / file / reference counts plus the latest audit row.
 * Cheap: no GitHub traffic, no AST work. Used to drive the metadata card.
 */
export const fetchCapabilityCodeIndex = async (
  capabilityId: string,
): Promise<CapabilityCodeIndexSnapshot> =>
  requestJson<CapabilityCodeIndexSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-index`,
  );

/**
 * Kick off a fresh walk of every linked repository: tree + blob fetch
 * against GitHub, AST extract, transactional replace in Postgres. Returns
 * the same snapshot shape as the read endpoint. Heavy — gate behind an
 * explicit user action.
 */
export const refreshCapabilityCodeIndex = async (
  capabilityId: string,
): Promise<CapabilityCodeIndexSnapshot> =>
  requestJson<CapabilityCodeIndexSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-index/refresh`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

/**
 * Prefix-then-contains match against indexed symbol names, scoped to the
 * capability. Empty `query` short-circuits to `[]` server-side so callers
 * can hook this straight to a debounced input without extra guards.
 */
export const searchCapabilityCodeSymbols = async (
  capabilityId: string,
  query: string,
  options: { limit?: number; kind?: CapabilityCodeSymbolKind } = {},
): Promise<CapabilityCodeSymbol[]> => {
  const params = new URLSearchParams();
  const trimmed = (query || "").trim();
  if (!trimmed) return [];
  params.set("q", trimmed);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.kind) params.set("kind", options.kind);
  return requestJson<CapabilityCodeSymbol[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-index/symbols?${params.toString()}`,
  );
};

/**
 * Fetch all symbols from the in-memory local AST built from base-clone repos.
 * These are indexed at desktop claim time — no GitHub traffic.
 *
 * Optional filters: `kind` (class|function|interface|…), `filePathPrefix`,
 * `limit` (default 2000). Pass `force=true` to force a synchronous re-index.
 */
export const fetchLocalAstSnapshot = async (
  capabilityId: string,
  options: {
    kind?: CapabilityCodeSymbolKind;
    filePathPrefix?: string;
    limit?: number;
    force?: boolean;
  } = {},
): Promise<LocalAstSnapshot> => {
  const params = new URLSearchParams();
  if (options.kind) params.set("kind", options.kind);
  if (options.filePathPrefix) params.set("filePathPrefix", options.filePathPrefix);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.force) params.set("force", "true");
  return requestJson<LocalAstSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-index/local-ast?${params.toString()}`,
  );
};

/**
 * Force a synchronous re-index of all base-clone repos for a capability.
 */
export const refreshLocalAst = async (capabilityId: string): Promise<{ refreshed: Array<{ repositoryId: string; symbolCount: number; builtAt: string | undefined }> }> =>
  requestJson(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-index/local-ast/refresh`,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify({}) },
  );

/**
 * Validate a unified-diff body and return the structured
 * `CodePatchPayload` (file stats, additions/deletions, validation
 * errors). Server-side is stateless — this is the same call the
 * BUILD-step runtime uses before persisting a CODE_PATCH artifact,
 * so the UI "preview before commit" and runtime validation stay in
 * lockstep.
 */
export const validateCapabilityPatch = async (
  capabilityId: string,
  payload: {
    raw: string;
    repositoryId?: string;
    repositoryLabel?: string;
    baseSha?: string;
    targetBranch?: string;
    summary?: string;
  },
): Promise<CodePatchPayload> =>
  requestJson<CodePatchPayload>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/patches/validate`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

/**
 * Agent-as-git-author client wrappers (Phase C).
 *
 * These talk to the endpoints in `server/index.ts` registered after the
 * patches/validate route. They all operate on a capability + work item
 * scope and return typed shapes from `src/types.ts`.
 */

export interface WorkItemAgentGitSnapshot {
  sessions: AgentBranchSession[];
  pullRequests: AgentPullRequest[];
}

export const fetchWorkItemAgentGitSnapshot = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkItemAgentGitSnapshot> =>
  requestJson<WorkItemAgentGitSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/agent-git`,
  );

export const startAgentBranchSession = async (
  capabilityId: string,
  workItemId: string,
  payload: { repositoryId?: string } = {},
): Promise<{ session: AgentBranchSession; reused: boolean }> =>
  requestJson<{ session: AgentBranchSession; reused: boolean }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/agent-git/start-session`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const commitAgentSessionPatch = async (
  capabilityId: string,
  sessionId: string,
  payload: {
    artifactId?: string;
    message?: string;
    authorName?: string;
    authorEmail?: string;
  } = {},
): Promise<AgentBranchCommitResult> =>
  requestJson<AgentBranchCommitResult>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agent-git/sessions/${encodeURIComponent(sessionId)}/commit-patch`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const openAgentSessionPullRequest = async (
  capabilityId: string,
  sessionId: string,
  payload: { title?: string; body?: string; draft?: boolean } = {},
): Promise<{ session: AgentBranchSession; pullRequest: AgentPullRequest }> =>
  requestJson<{ session: AgentBranchSession; pullRequest: AgentPullRequest }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agent-git/sessions/${encodeURIComponent(sessionId)}/open-pr`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const closeAgentSession = async (
  capabilityId: string,
  sessionId: string,
): Promise<{ session: AgentBranchSession }> =>
  requestJson<{ session: AgentBranchSession }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agent-git/sessions/${encodeURIComponent(sessionId)}/close`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const validateOnboardingConnectors = async (payload: {
  githubRepositories: string[];
  jiraBoardLink?: string;
  confluenceLink?: string;
}): Promise<ConnectorValidationResult> =>
  requestJson<ConnectorValidationResult>(
    "/api/onboarding/validate-connectors",
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const validateOnboardingWorkspacePath = async (payload: {
  path: string;
}): Promise<WorkspacePathValidationResult> =>
  requestJson<WorkspacePathValidationResult>(
    "/api/onboarding/validate-workspace-path",
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const detectOnboardingWorkspaceProfile = async (payload: {
  defaultWorkspacePath?: string;
  approvedWorkspacePaths?: string[];
}): Promise<WorkspaceDetectionResult> =>
  requestJson<WorkspaceDetectionResult>(
    "/api/onboarding/detect-workspace-profile",
    {
      method: "POST",
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
      method: "POST",
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
    "/api/onboarding/validate-command-template",
    {
      method: "POST",
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
    "/api/onboarding/validate-deployment-target",
    {
      method: "POST",
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
  format: "json" | "markdown",
) =>
  resolveApiUrl(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/flight-recorder/download?format=${format}`,
  );

export const getWorkItemFlightRecorderDownloadUrl = (
  capabilityId: string,
  workItemId: string,
  format: "json" | "markdown",
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
      method: "POST",
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
      workItemId ? `?workItemId=${encodeURIComponent(workItemId)}` : ""
    }`,
  );

export const createEvidencePacketForWorkItem = async (
  capabilityId: string,
  workItemId: string,
): Promise<EvidencePacketSummary> =>
  requestJson<EvidencePacketSummary>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/evidence-packets`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const fetchEvidencePacket = async (
  bundleId: string,
): Promise<EvidencePacket> =>
  requestJson<EvidencePacket>(
    `/api/evidence-packets/${encodeURIComponent(bundleId)}`,
  );

export const verifyEvidencePacket = async (
  bundleId: string,
): Promise<EvidencePacketVerification> =>
  requestJson<EvidencePacketVerification>(
    `/api/evidence-packets/${encodeURIComponent(bundleId)}/verify`,
  );

export const fetchAttestationChain = async (
  bundleId: string,
): Promise<AttestationChain> =>
  requestJson<AttestationChain>(
    `/api/attestations/${encodeURIComponent(bundleId)}/chain`,
  );

export const fetchSignerStatus = async (): Promise<SignerStatus> =>
  requestJson<SignerStatus>("/api/governance/signer/status");

// Slice 2 — governance controls catalog.
export const listGovernanceControls = async (filter?: {
  framework?: string;
  severity?: string;
  status?: string;
  capabilityScope?: string;
}): Promise<GovernanceControlsListResponse> => {
  const search = new URLSearchParams();
  if (filter?.framework) search.set("framework", filter.framework);
  if (filter?.severity) search.set("severity", filter.severity);
  if (filter?.status) search.set("status", filter.status);
  if (filter?.capabilityScope)
    search.set("capabilityScope", filter.capabilityScope);
  const query = search.toString();
  return requestJson<GovernanceControlsListResponse>(
    `/api/governance/controls${query ? `?${query}` : ""}`,
  );
};

export const getGovernanceControl = async (
  controlId: string,
  capabilityScope?: string,
): Promise<GovernanceControlWithBindings> => {
  const search = new URLSearchParams();
  if (capabilityScope) search.set("capabilityScope", capabilityScope);
  const query = search.toString();
  return requestJson<GovernanceControlWithBindings>(
    `/api/governance/controls/${encodeURIComponent(controlId)}${query ? `?${query}` : ""}`,
  );
};

export const createGovernanceControlBinding = async (
  controlId: string,
  input: GovernanceControlBindingInput,
): Promise<GovernanceControlBinding> =>
  requestJson<GovernanceControlBinding>(
    `/api/governance/controls/${encodeURIComponent(controlId)}/bindings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );

// Slice 3 — governance exception lifecycle wrappers.
export const listGovernanceExceptions = async (filter?: {
  capabilityId?: string;
  controlId?: string;
  status?: GovernanceExceptionStatus | GovernanceExceptionStatus[];
}): Promise<GovernanceExceptionsListResponse> => {
  const search = new URLSearchParams();
  if (filter?.capabilityId) search.set("capabilityId", filter.capabilityId);
  if (filter?.controlId) search.set("controlId", filter.controlId);
  if (filter?.status) {
    const statuses = Array.isArray(filter.status)
      ? filter.status
      : [filter.status];
    for (const status of statuses) search.append("status", status);
  }
  const query = search.toString();
  return requestJson<GovernanceExceptionsListResponse>(
    `/api/governance/exceptions${query ? `?${query}` : ""}`,
  );
};

export const getGovernanceException = async (
  exceptionId: string,
): Promise<GovernanceExceptionWithEvents> =>
  requestJson<GovernanceExceptionWithEvents>(
    `/api/governance/exceptions/${encodeURIComponent(exceptionId)}`,
  );

export const fetchActiveGovernanceException = async (
  capabilityId: string,
  toolId: string,
): Promise<{ exception: GovernanceException | null }> => {
  const search = new URLSearchParams({ capabilityId, toolId });
  return requestJson<{ exception: GovernanceException | null }>(
    `/api/governance/exceptions/active?${search.toString()}`,
  );
};

export const requestGovernanceException = async (
  input: GovernanceExceptionRequestInput,
): Promise<GovernanceExceptionWithEvents> =>
  requestJson<GovernanceExceptionWithEvents>(`/api/governance/exceptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const decideGovernanceException = async (
  exceptionId: string,
  decision: GovernanceExceptionDecisionInput,
): Promise<GovernanceExceptionWithEvents> =>
  requestJson<GovernanceExceptionWithEvents>(
    `/api/governance/exceptions/${encodeURIComponent(exceptionId)}/decide`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(decision),
    },
  );

export const revokeGovernanceException = async (
  exceptionId: string,
  comment?: string,
): Promise<GovernanceExceptionWithEvents> =>
  requestJson<GovernanceExceptionWithEvents>(
    `/api/governance/exceptions/${encodeURIComponent(exceptionId)}/revoke`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    },
  );

// ──────────────────────────────────────────────────────────────────────────
// Slice 4 — prove-the-negative provenance wrappers.
// ──────────────────────────────────────────────────────────────────────────

export const proveNoTouch = async (
  input: ProveNoTouchInput,
): Promise<ProveNoTouchResult> =>
  requestJson<ProveNoTouchResult>("/api/governance/provenance/prove-no-touch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const listProvenanceCoverage = async (
  capabilityId: string,
): Promise<{ windows: ProvenanceCoverageWindow[] }> =>
  requestJson<{ windows: ProvenanceCoverageWindow[] }>(
    `/api/governance/provenance/coverage?capabilityId=${encodeURIComponent(capabilityId)}`,
  );

// ──────────────────────────────────────────────────────────────────────────
// Slice 5 — governance posture snapshot.
// ──────────────────────────────────────────────────────────────────────────

export const fetchGovernancePosture =
  async (): Promise<GovernancePostureSnapshot> =>
    requestJson<GovernancePostureSnapshot>("/api/governance/posture");

export const listIncidents = async (params?: {
  capabilityId?: string;
  severity?: string;
  status?: string;
}): Promise<CapabilityIncident[]> => {
  const search = new URLSearchParams();
  if (params?.capabilityId) {
    search.set("capabilityId", params.capabilityId);
  }
  if (params?.severity) {
    search.set("severity", params.severity);
  }
  if (params?.status) {
    search.set("status", params.status);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson<CapabilityIncident[]>(`/api/incidents${suffix}`);
};

export const fetchIncident = async (
  incidentId: string,
): Promise<CapabilityIncident> =>
  requestJson<CapabilityIncident>(
    `/api/incidents/${encodeURIComponent(incidentId)}`,
  );

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
  requestJson<CapabilityIncident>("/api/incidents", {
    method: "POST",
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
  requestJson<IncidentPacketLink>(
    `/api/incidents/${encodeURIComponent(incidentId)}/links`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

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
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const deleteIncidentPacketLink = async (
  incidentId: string,
  bundleId: string,
) =>
  requestJson<{ status: "deleted" }>(
    `/api/incidents/${encodeURIComponent(incidentId)}/links/${encodeURIComponent(bundleId)}`,
    {
      method: "DELETE",
    },
  );

export const fetchPacketIncidentLinks = async (
  bundleId: string,
): Promise<IncidentPacketLink[]> =>
  requestJson<IncidentPacketLink[]>(
    `/api/incidents/packets/${encodeURIComponent(bundleId)}/links`,
  );

export const correlateIncidentPackets = async (
  incidentId: string,
): Promise<{
  incident: CapabilityIncident;
  candidates: IncidentCorrelationCandidate[];
  persisted: IncidentCorrelationCandidate[];
}> =>
  requestJson(`/api/incidents/${encodeURIComponent(incidentId)}/correlate`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({}),
  });

export const fetchIncidentPostmortemMarkdown = async (
  incidentId: string,
): Promise<string> =>
  requestText(`/api/incidents/${encodeURIComponent(incidentId)}/postmortem.md`);

export const fetchIncidentAlibiMarkdown = async (
  incidentId: string,
): Promise<string> =>
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
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ concernText }),
    },
  );

export const listIncidentSourceConfigs = async (): Promise<
  IncidentSourceConfig[]
> => requestJson<IncidentSourceConfig[]>("/api/incidents/config/sources");

export const updateIncidentSourceConfig = async (
  source: IncidentSource,
  config: Partial<IncidentSourceConfig>,
): Promise<IncidentSourceConfig> =>
  requestJson<IncidentSourceConfig>(
    `/api/incidents/config/sources/${encodeURIComponent(source)}`,
    {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(config),
    },
  );

export const deleteIncidentSourceConfig = async (source: IncidentSource) =>
  requestJson<{ status: "deleted" }>(
    `/api/incidents/config/sources/${encodeURIComponent(source)}`,
    { method: "DELETE" },
  );

export const listIncidentServiceCapabilityMaps = async (): Promise<
  IncidentServiceCapabilityMap[]
> =>
  requestJson<IncidentServiceCapabilityMap[]>("/api/incidents/config/services");

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
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const deleteIncidentServiceCapabilityMap = async (serviceName: string) =>
  requestJson<{ status: "deleted" }>(
    `/api/incidents/config/services/${encodeURIComponent(serviceName)}`,
    { method: "DELETE" },
  );

export const listIncidentExportTargetConfigs = async (): Promise<
  IncidentExportTargetConfig[]
> =>
  requestJson<IncidentExportTargetConfig[]>("/api/incidents/exports/targets");

export const updateIncidentExportTargetConfig = async (
  target: IncidentExportTarget,
  config: Partial<IncidentExportTargetConfig>,
): Promise<IncidentExportTargetConfig> =>
  requestJson<IncidentExportTargetConfig>(
    `/api/incidents/exports/targets/${encodeURIComponent(target)}`,
    {
      method: "PUT",
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
    search.set("incidentId", params.incidentId);
  }
  if (params?.capabilityId) {
    search.set("capabilityId", params.capabilityId);
  }
  if (params?.target) {
    search.set("target", params.target);
  }
  if (params?.limit) {
    search.set("limit", String(params.limit));
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson<IncidentExportDelivery[]>(
    `/api/incidents/exports/deliveries${suffix}`,
  );
};

export const exportIncidentToTarget = async (
  incidentId: string,
  target: IncidentExportTarget,
): Promise<IncidentExportDelivery> =>
  requestJson<IncidentExportDelivery>(
    `/api/incidents/${encodeURIComponent(incidentId)}/export/${encodeURIComponent(target)}`,
    {
      method: "POST",
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
    search.set("capabilityId", params.capabilityId);
  }
  if (params?.windowDays) {
    search.set("windowDays", String(params.windowDays));
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson<ModelRiskMonitoringSummary>(`/api/mrm/summary${suffix}`);
};

export const fetchModelRiskMonitoringExport = async (params?: {
  capabilityId?: string;
  windowDays?: number;
  format?: "markdown" | "json";
}): Promise<string> => {
  const search = new URLSearchParams();
  if (params?.capabilityId) {
    search.set("capabilityId", params.capabilityId);
  }
  if (params?.windowDays) {
    search.set("windowDays", String(params.windowDays));
  }
  if (params?.format) {
    search.set("format", params.format);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
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
  requestJson<IncidentExportDelivery>(
    `/api/mrm/export/${encodeURIComponent(target)}`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        capabilityId,
        windowDays,
      }),
    },
  );

export const fetchCapabilityConnectorContext = async (
  capabilityId: string,
): Promise<CapabilityConnectorContext> =>
  requestJson<CapabilityConnectorContext>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors`,
  );

export const syncCapabilityGithubConnector = async (capabilityId: string) =>
  requestJson<CapabilityConnectorContext["github"]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors/github/sync`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const syncCapabilityJiraConnector = async (capabilityId: string) =>
  requestJson<CapabilityConnectorContext["jira"]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors/jira/sync`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const transitionCapabilityJiraIssue = async (
  capabilityId: string,
  payload: { issueKey: string; transitionId: string },
) =>
  requestJson<{ status: "READY"; message: string }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors/jira/transition`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const syncCapabilityConfluenceConnector = async (capabilityId: string) =>
  requestJson<CapabilityConnectorContext["confluence"]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors/confluence/sync`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const publishCapabilityArtifactToConfluence = async (
  capabilityId: string,
  payload: { artifactId: string; title?: string; parentPageId?: string },
) =>
  requestJson<{
    status: "READY";
    message: string;
    url?: string;
    pageId?: string;
  }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/connectors/confluence/publish`,
    {
      method: "POST",
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

export const getArtifactDownloadUrl = (
  capabilityId: string,
  artifactId: string,
) =>
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
      options?.inline ? "?inline=1" : ""
    }`,
  );

export const uploadCapabilityWorkItemFiles = async (
  capabilityId: string,
  workItemId: string,
  files: File[],
): Promise<Artifact[]> => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("files", file);
  });

  const response = await fetch(
    resolveApiUrl(
      `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/uploads`,
    ),
    {
      method: "POST",
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
  requestJson<CapabilityBundle>("/api/capabilities", {
    method: "POST",
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
      method: "PATCH",
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
      method: "PATCH",
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
  }>("/api/permissions/evaluate", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ capabilityId, action }),
  });

export const publishCapabilityContract = async (
  capabilityId: string,
): Promise<{ capability: Capability; snapshot: CapabilityPublishedSnapshot }> =>
  requestJson<{
    capability: Capability;
    snapshot: CapabilityPublishedSnapshot;
  }>(`/api/capabilities/${encodeURIComponent(capabilityId)}/publish-contract`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({}),
  });

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
      method: "POST",
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
      method: "DELETE",
    },
  );

export const addCapabilityAgentRecord = async (
  capabilityId: string,
  agent: CreateCapabilityAgentInput,
): Promise<CapabilityBundle> =>
  requestJson<CapabilityBundle>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents`,
    {
      method: "POST",
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
      method: "PATCH",
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
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const appendCapabilityMessageRecord = async (
  capabilityId: string,
  message: Omit<CapabilityChatMessage, "capabilityId">,
): Promise<CapabilityWorkspace> =>
  requestJson<CapabilityWorkspace>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/messages`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(message),
    },
  );

export const clearCapabilityMessageHistoryRecord = async (
  capabilityId: string,
  payload?: {
    workItemId?: string;
    sessionScope?: AgentSessionScope;
    sessionScopeId?: string;
  },
): Promise<CapabilityWorkspace> =>
  requestJson<CapabilityWorkspace>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/messages`,
    {
      method: "DELETE",
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const setActiveChatAgentRecord = async (
  capabilityId: string,
  agentId: string,
): Promise<CapabilityWorkspace> =>
  requestJson<CapabilityWorkspace>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/chat-agent`,
    {
      method: "PATCH",
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
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(updates),
    },
  );

export const fetchCapabilityCodeWorkspaces = async (
  capabilityId: string,
  executorId?: string,
): Promise<CodeWorkspaceStatus[]> =>
  requestJson<CodeWorkspaceStatus[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-workspaces${
      executorId ? `?executorId=${encodeURIComponent(executorId)}` : ""
    }`,
  );

export const createCapabilityCodeBranch = async (
  capabilityId: string,
  payload: { path: string; branchName: string; executorId?: string },
): Promise<CodeWorkspaceStatus> =>
  requestJson<CodeWorkspaceStatus>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-workspaces/branch`,
    {
      method: "POST",
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
    taskType?: WorkItem["taskType"];
    phaseStakeholders?: WorkItemPhaseStakeholderAssignment[];
    attachments?: WorkItemAttachmentUpload[];
    priority: WorkItem["priority"];
    tags: string[];
  },
): Promise<WorkItem> =>
  requestJson<WorkItem>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const listStoryProposalBatches = async (
  capabilityId: string,
): Promise<StoryProposalBatchSummary[]> =>
  requestJson<StoryProposalBatchSummary[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/story-proposals`,
  );

export const createStoryProposalBatch = async (
  capabilityId: string,
  payload: PlanningGenerationRequest,
): Promise<StoryProposalBatch> =>
  requestJson<StoryProposalBatch>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/story-proposals`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const fetchStoryProposalBatch = async (
  capabilityId: string,
  batchId: string,
): Promise<StoryProposalBatch> =>
  requestJson<StoryProposalBatch>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/story-proposals/${encodeURIComponent(batchId)}`,
  );

export const updateStoryProposalItem = async (
  capabilityId: string,
  batchId: string,
  itemId: string,
  payload: Partial<
    Pick<
      StoryProposalItem,
      | "title"
      | "description"
      | "businessOutcome"
      | "acceptanceCriteria"
      | "dependencies"
      | "risks"
      | "recommendedWorkflowId"
      | "recommendedTaskType"
      | "storyPoints"
      | "tShirtSize"
      | "sizingConfidence"
      | "sizingRationale"
      | "implementationNotes"
      | "tags"
      | "reviewState"
    >
  >,
): Promise<StoryProposalBatch> =>
  requestJson<StoryProposalBatch>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/story-proposals/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const regenerateStoryProposalBatch = async (
  capabilityId: string,
  batchId: string,
  payload: PlanningGenerationRequest,
): Promise<StoryProposalBatch> =>
  requestJson<StoryProposalBatch>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/story-proposals/${encodeURIComponent(batchId)}/regenerate`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const promoteStoryProposalBatch = async (
  capabilityId: string,
  batchId: string,
  payload?: { itemIds?: string[] },
): Promise<StoryProposalPromotionResult> =>
  requestJson<StoryProposalPromotionResult>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/story-proposals/${encodeURIComponent(batchId)}/promote`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const moveCapabilityWorkItem = async (
  capabilityId: string,
  workItemId: string,
  payload: {
    targetPhase: WorkItemPhase;
    note?: string;
    cancelRunIfPresent?: boolean;
  },
): Promise<WorkItem> =>
  requestJson<WorkItem>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/move`,
    {
      method: "POST",
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
      method: "POST",
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
      method: "POST",
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
      method: "POST",
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
): Promise<{
  context: WorkItemExecutionContext | null;
  handoffs: WorkItemHandoffPacket[];
}> =>
  requestJson<{
    context: WorkItemExecutionContext | null;
    handoffs: WorkItemHandoffPacket[];
  }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/execution-context`,
  );

export const initializeCapabilityWorkItemExecutionContext = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkItemExecutionContext> =>
  requestJson<WorkItemExecutionContext>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/execution-context/initialize`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const createCapabilityWorkItemSharedBranch = async (
  capabilityId: string,
  workItemId: string,
  payload?: {
    executorId?: string;
  },
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
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const claimCapabilityWorkItemWriteControl = async (
  capabilityId: string,
  workItemId: string,
): Promise<{
  claim: WorkItemCodeClaim;
  context: WorkItemExecutionContext | null;
}> =>
  requestJson<{
    claim: WorkItemCodeClaim;
    context: WorkItemExecutionContext | null;
  }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/claim/write`,
    {
      method: "POST",
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
      method: "DELETE",
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
  payload: Omit<
    WorkItemHandoffPacket,
    "id" | "workItemId" | "createdAt" | "acceptedAt"
  >,
): Promise<WorkItemHandoffPacket> =>
  requestJson<WorkItemHandoffPacket>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/handoff`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const acceptCapabilityWorkItemHandoff = async (
  capabilityId: string,
  workItemId: string,
  packetId: string,
): Promise<{
  packet: WorkItemHandoffPacket;
  context: WorkItemExecutionContext | null;
}> =>
  requestJson<{
    packet: WorkItemHandoffPacket;
    context: WorkItemExecutionContext | null;
  }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/handoff/${encodeURIComponent(packetId)}/accept`,
    {
      method: "POST",
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
      method: "POST",
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
      method: "POST",
    },
  );

export const releaseCapabilityWorkItemControl = async (
  capabilityId: string,
  workItemId: string,
): Promise<void> =>
  requestJson<void>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/claim`,
    {
      method: "DELETE",
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
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const startCapabilityWorkflowRun = async (
  capabilityId: string,
  workItemId: string,
  payload?: {
    // Legacy name; still accepted by the server.
    restartFromPhase?: WorkItemPhase;
    // Phase-segment aliases. `startPhase` reads more naturally in the
    // new model; the server treats it as an alias for `restartFromPhase`.
    startPhase?: WorkItemPhase;
    stopAfterPhase?: WorkItemPhase;
    intention?: string;
    guidance?: string;
    guidedBy?: string;
    executorId?: string;
  },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/runs`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

// --- Phase-segment client API -------------------------------------------

/**
 * Start a new segment for a work item (intention required). Optionally
 * save the start/stop/intention as the work item's "start next" preset
 * so the inbox can render a one-click resume next time.
 */
export const startCapabilityWorkItemSegment = async (
  capabilityId: string,
  workItemId: string,
  payload: {
    startPhase?: WorkItemPhase;
    stopAfterPhase?: WorkItemPhase;
    intention: string;
    saveAsPreset?: boolean;
    guidance?: string;
    guidedBy?: string;
  },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/segments`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const retryCapabilityWorkItemSegment = async (
  capabilityId: string,
  workItemId: string,
  segmentId: string,
  payload?: { guidedBy?: string },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/segments/${encodeURIComponent(segmentId)}/retry`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const startCapabilityWorkItemNextSegment = async (
  capabilityId: string,
  workItemId: string,
  payload?: { guidedBy?: string },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/start-next`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload || {}),
    },
  );

export const listCapabilityWorkItemSegments = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkItemSegment[]> =>
  requestJson<WorkItemSegment[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/segments`,
  );

export const updateCapabilityWorkItemBrief = async (
  capabilityId: string,
  workItemId: string,
  brief: string | null,
): Promise<{ brief: string | null }> =>
  requestJson<{ brief: string | null }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/brief`,
    {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ brief }),
    },
  );

export const updateCapabilityWorkItemNextSegmentPreset = async (
  capabilityId: string,
  workItemId: string,
  preset: NextSegmentPreset | null,
): Promise<{ preset: NextSegmentPreset | null }> =>
  requestJson<{ preset: NextSegmentPreset | null }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/next-segment-preset`,
    {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ preset }),
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
      method: "POST",
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
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const fetchApprovalWorkspaceContext = async (
  capabilityId: string,
  runId: string,
  waitId: string,
): Promise<ApprovalWorkspaceContext> =>
  requestJson<ApprovalWorkspaceContext>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(waitId)}`,
  );

export const refreshApprovalWorkspacePacket = async (
  capabilityId: string,
  runId: string,
  waitId: string,
): Promise<ApprovalStructuredPacket> =>
  requestJson<ApprovalStructuredPacket>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(waitId)}/refresh-packet`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    },
  );

export const sendBackApprovalForClarification = async (
  capabilityId: string,
  runId: string,
  waitId: string,
  payload: {
    targetAgentId: string;
    summary: string;
    clarificationQuestions: string[];
    note?: string;
  },
): Promise<ApprovalWorkspaceContext> =>
  requestJson<ApprovalWorkspaceContext>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(waitId)}/send-back`,
    {
      method: "POST",
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
      method: "POST",
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
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const delegateCapabilityWorkflowRunToHuman = async (
  capabilityId: string,
  runId: string,
  payload: {
    instructions: string;
    checklist?: string[];
    assigneeUserId?: string;
    assigneeRole?: string;
    approvalPolicy?: ApprovalPolicy;
    note?: string;
  },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/delegate-to-human`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const completeCapabilityWorkflowRunHumanTask = async (
  capabilityId: string,
  runId: string,
  payload: { resolution: string; resolvedBy: string },
): Promise<WorkflowRunDetail> =>
  requestJson<WorkflowRunDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/complete-human-task`,
    {
      method: "POST",
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
      method: "POST",
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
      method: "POST",
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
      method: "POST",
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
      method: "POST",
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
    requestJson<OperationsDashboardSnapshot>("/api/reports/operations");

export const fetchExecutorRegistry =
  async (): Promise<ExecutorRegistrySummary> =>
    requestJson<ExecutorRegistrySummary>("/api/runtime/executors");

export const fetchExecutorRegistryEntry = async (
  executorId: string,
): Promise<ExecutorRegistryEntry> =>
  requestJson<ExecutorRegistryEntry>(
    `/api/runtime/executors/${encodeURIComponent(executorId)}`,
  );

export const removeDesktopExecutor = async (
  executorId: string,
): Promise<void> => {
  await requestJson<void>(
    `/api/runtime/executors/${encodeURIComponent(executorId)}`,
    {
      method: "DELETE",
    },
  );
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
    requestJson<ExecutiveSummarySnapshot>("/api/reports/executive");

export const fetchAuditReportSnapshot =
  async (): Promise<AuditReportSnapshot> =>
    requestJson<AuditReportSnapshot>("/api/reports/audit");

export const fetchGovernanceCostAllocationSnapshot = async (
  days = 7,
): Promise<GovernanceCostAllocationSnapshot> =>
  requestJson<GovernanceCostAllocationSnapshot>(
    `/api/reports/governance-cost-allocation?days=${encodeURIComponent(String(days))}`,
  );

export const fetchWorkItemEfficiencySnapshot = async (
  capabilityId: string,
): Promise<WorkItemEfficiencySnapshot> =>
  requestJson<WorkItemEfficiencySnapshot>(
    `/api/reports/work-items/${encodeURIComponent(capabilityId)}`,
  );

export const fetchReportExportPayload = async (
  reportType: ReportExportPayload["reportType"],
  params?: {
    capabilityId?: string;
    teamId?: string;
  },
): Promise<ReportExportPayload> => {
  const search = new URLSearchParams();
  if (params?.capabilityId) {
    search.set("capabilityId", params.capabilityId);
  }
  if (params?.teamId) {
    search.set("teamId", params.teamId);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
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
      agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""
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
      agentId ? `&agentId=${encodeURIComponent(agentId)}` : ""
    }`,
  );

export const refreshCapabilityMemoryIndex = async (
  capabilityId: string,
): Promise<MemoryDocument[]> =>
  requestJson<MemoryDocument[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/memory/refresh`,
    {
      method: "POST",
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
      method: "POST",
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
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

/**
 * Slice A — list the immutable version history for an agent's learning
 * profile. Newest-first; `current_version_id` on the profile identifies which
 * entry is currently serving inference.
 */
export const fetchAgentLearningProfileVersions = async (
  capabilityId: string,
  agentId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<{ versions: AgentLearningProfileVersion[] }> => {
  const query = new URLSearchParams();
  if (typeof options.limit === "number") {
    query.set("limit", String(options.limit));
  }
  if (typeof options.offset === "number") {
    query.set("offset", String(options.offset));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestJson<{ versions: AgentLearningProfileVersion[] }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/${encodeURIComponent(agentId)}/learning/versions${suffix}`,
  );
};

/**
 * Slice A — structured diff between two versions. `against` is the older
 * baseline we're comparing `versionId` against.
 */
export const fetchAgentLearningVersionDiff = async (
  capabilityId: string,
  agentId: string,
  versionId: string,
  againstVersionId: string,
): Promise<AgentLearningVersionDiff> =>
  requestJson<AgentLearningVersionDiff>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/${encodeURIComponent(agentId)}/learning/versions/${encodeURIComponent(versionId)}/diff?against=${encodeURIComponent(againstVersionId)}`,
  );

/**
 * Slice A — flip the live pointer to a prior version. Requires `agents.manage`
 * and writes a VERSION_REVERTED audit event into the learning update log.
 */
export const activateAgentLearningProfileVersion = async (
  capabilityId: string,
  agentId: string,
  versionId: string,
  payload: { reason?: string } = {},
): Promise<AgentLearningProfileDetail> =>
  requestJson<AgentLearningProfileDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/${encodeURIComponent(agentId)}/learning/versions/${encodeURIComponent(versionId)}/activate`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

/**
 * Slice C — current canary + drift state for the agent's learning profile.
 * Used by the lens to surface the drift banner + revert CTA.
 */
export const fetchAgentLearningDriftState = async (
  capabilityId: string,
  agentId: string,
): Promise<{ state: AgentLearningDriftState | null }> =>
  requestJson<{ state: AgentLearningDriftState | null }>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/${encodeURIComponent(agentId)}/learning/drift`,
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
      method: "POST",
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
      throw new Error("Desktop runtime bridge is not available.");
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

    options?.signal?.addEventListener("abort", abortHandler, { once: true });

    try {
      await desktop.streamRuntimeChat(
        {
          ...payload,
          streamId,
          actorContext: currentActorContext,
        },
        (event) => {
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
      options?.signal?.removeEventListener("abort", abortHandler);
    }

    return finalizeCapabilityChatStream({
      state,
      aborted,
    });
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl("/api/runtime/chat/stream"), {
      method: "POST",
      headers: withActorHeaders(jsonHeaders),
      body: JSON.stringify(payload),
      signal: options?.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        termination: "empty",
        draftContent: "",
        completeEvent: null,
        error: "Streaming response was stopped before completion.",
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
    throw new Error("Streaming response body was not available.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const state = createCapabilityChatStreamAccumulator();
  let aborted = false;

  const processFrame = (frame: string) => {
    const trimmedFrame = frame.trim();
    if (!trimmedFrame) {
      return;
    }

    const eventType =
      trimmedFrame
        .split("\n")
        .find((line) => line.startsWith("event:"))
        ?.replace(/^event:\s*/, "")
        .trim() || "message";
    const data = trimmedFrame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s*/, ""))
      .join("\n");

    if (!data) {
      return;
    }

    try {
      const streamEvent = JSON.parse(data) as ChatStreamEvent;
      processCapabilityChatStreamEvent({
        event: {
          ...streamEvent,
          type: streamEvent.type || (eventType as ChatStreamEvent["type"]),
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

      const frames = buffered.split("\n\n");
      const trailingFrame = done ? "" : frames.pop() || "";

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
    if (error instanceof DOMException && error.name === "AbortError") {
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
      role: "user" | "agent";
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
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

// ─────────────────────────────────────────────────────────────────────────────
// Release Passport
// ─────────────────────────────────────────────────────────────────────────────

export interface ReleasePassportApproval {
  role: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REQUEST_CHANGES";
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface ReleasePassportData {
  documentId: string;
  recommendation: "APPROVE" | "HOLD" | "REJECT";
  recommendationReason: string;
  workItem: {
    id: string;
    title: string;
    description: string;
    phase: string;
    taskType: string;
    status: string;
  };
  runId: string;
  codeImpact: {
    additions: number;
    deletions: number;
    filesChanged: number;
    primarySymbols: string[];
    targetRepository?: string;
  };
  evidence: Array<{
    label: string;
    kind: "ANALYSIS" | "COMMIT" | "SIGNATURE" | "TEST" | "ARTIFACT";
    status: "VERIFIED" | "PENDING" | "MISSING";
    ref?: string;
  }>;
  governance: {
    sensitivePaths: "UNTOUCHED" | "MODIFIED";
    policyExceptions: number;
    executionRole: string;
    memoryDrift: "ALIGNED" | "DRIFTED" | "UNKNOWN";
  };
  approvals: ReleasePassportApproval[];
  generatedAt: string;
}

export const fetchReleasePassport = async (
  capabilityId: string,
  runId: string,
): Promise<ReleasePassportData> =>
  requestJson<ReleasePassportData>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/passport`,
  );

// ─────────────────────────────────────────────────────────────────────────────
// Blast Radius
// ─────────────────────────────────────────────────────────────────────────────

export type BlastImpactLevel = "CRITICAL" | "WARNING" | "SAFE";

export interface BlastNode {
  id: string;
  label: string;
  filePath: string;
  capabilityId: string;
  capabilityName?: string;
  impactLevel: BlastImpactLevel;
  reason: string;
  couplingKind: "DIRECT_IMPORT" | "INDIRECT" | "TYPE_ONLY";
}

export interface BlastRadiusResult {
  targetFile: string;
  targetCapabilityId: string;
  targetExports: string[];
  totalDependents: number;
  criticalCount: number;
  warningCount: number;
  safeCount: number;
  nodes: BlastNode[];
  analyzedAt: string;
}

export const fetchBlastRadius = async (
  capabilityId: string,
  filePath: string,
): Promise<BlastRadiusResult> =>
  requestJson<BlastRadiusResult>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/blast-radius?filePath=${encodeURIComponent(filePath)}`,
  );

export type { BlastRadiusSymbolGraph };

export const fetchBlastRadiusSymbolGraph = async (
  capabilityId: string,
  options: {
    filePath?: string;
    symbolId?: string;
    maxDepth?: number;
    maxNodes?: number;
  },
): Promise<BlastRadiusSymbolGraph> => {
  const search = new URLSearchParams();
  if (options.filePath) {
    search.set('filePath', options.filePath);
  }
  if (options.symbolId) {
    search.set('symbolId', options.symbolId);
  }
  if (typeof options.maxDepth === 'number') {
    search.set('maxDepth', String(options.maxDepth));
  }
  if (typeof options.maxNodes === 'number') {
    search.set('maxNodes', String(options.maxNodes));
  }
  return requestJson<BlastRadiusSymbolGraph>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-index/blast-radius?${search.toString()}`,
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Code Graph
// ─────────────────────────────────────────────────────────────────────────────

export type { CapabilityCodeGraph, CodeGraphNode, CodeGraphEdge, CodeGraphFileNode, CodeGraphSymbolNode } from '../types';

export const fetchCodeGraph = async (
  capabilityId: string,
  options: { maxFiles?: number; maxSymbols?: number } = {},
): Promise<import('../types').CapabilityCodeGraph> => {
  const params = new URLSearchParams();
  if (typeof options.maxFiles === 'number') params.set('maxFiles', String(options.maxFiles));
  if (typeof options.maxSymbols === 'number') params.set('maxSymbols', String(options.maxSymbols));
  const qs = params.toString();
  return requestJson<import('../types').CapabilityCodeGraph>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/code-index/graph${qs ? `?${qs}` : ''}`,
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel Mode
// ─────────────────────────────────────────────────────────────────────────────

export type SentinelAlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface SentinelAlertPayload {
  cveId: string;
  description: string;
  severity: SentinelAlertSeverity;
  affectedFile?: string;
  source?: "sonarqube" | "snyk" | "github-security" | "manual";
  capabilityId?: string;
  workflowId?: string;
}

export interface SentinelMissionStatus {
  missionId: string;
  workItemId: string;
  capabilityId: string;
  cveId: string;
  severity: SentinelAlertSeverity;
  description: string;
  status: string;
  createdAt: string;
  runId?: string;
}

export const triggerSentinelAlert = async (
  payload: SentinelAlertPayload,
): Promise<SentinelMissionStatus> =>
  requestJson<SentinelMissionStatus>("/api/sentinel/alert", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const fetchSentinelMissions = async (
  capabilityId?: string,
): Promise<SentinelMissionStatus[]> =>
  requestJson<SentinelMissionStatus[]>(
    `/api/sentinel/missions${capabilityId ? `?capabilityId=${encodeURIComponent(capabilityId)}` : ""}`,
  );

// ────────────────────────────────────────────────────────────────────
// Time-travel debugging — persisted prompt receipts.
//
// Every main-model LLM call inside the execution engine is persisted.
// These calls feed the "Replay" UI that lets operators rerun any
// receipt against an alternate model without re-driving the whole step.
// ────────────────────────────────────────────────────────────────────

// PersistedPromptReceipt types are defined in ../types and re-exported here
// for backwards compatibility with importers that reference api.ts directly.
export type {
  PersistedPromptReceiptFragment,
  PersistedPromptReceiptEviction,
  PersistedPromptReceipt,
  PromptReceiptReplayResponse,
} from "../types";

export const fetchPromptReceiptsForRun = async (
  capabilityId: string,
  runId: string,
): Promise<PersistedPromptReceipt[]> =>
  requestJson<PersistedPromptReceipt[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(runId)}/prompt-receipts`,
  );

export const fetchPromptReceiptsForRunStep = async (
  capabilityId: string,
  runStepId: string,
): Promise<PersistedPromptReceipt[]> =>
  requestJson<PersistedPromptReceipt[]>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/run-steps/${encodeURIComponent(runStepId)}/prompt-receipts`,
  );

export const fetchPromptReceipt = async (
  capabilityId: string,
  receiptId: string,
): Promise<PersistedPromptReceipt> =>
  requestJson<PersistedPromptReceipt>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/prompt-receipts/${encodeURIComponent(receiptId)}`,
  );

export const replayPromptReceipt = async (
  capabilityId: string,
  receiptId: string,
  options?: { model?: string },
): Promise<PromptReceiptReplayResponse> =>
  requestJson<PromptReceiptReplayResponse>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/prompt-receipts/${encodeURIComponent(receiptId)}/replay`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ model: options?.model }),
    },
  );

// ─── Agent Mind ───────────────────────────────────────────────────────────────

/**
 * Fetch the full Agent Mind snapshot for a single agent.
 * GET /api/capabilities/:capabilityId/agents/:agentId/mind
 */
export const fetchAgentMindSnapshot = async (
  capabilityId: string,
  agentId: string,
): Promise<AgentMindSnapshot> =>
  requestJson<AgentMindSnapshot>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/agents/${encodeURIComponent(agentId)}/mind`,
  );

// ─── LLM / HTTP provider settings ────────────────────────────────────────────
//
// These mirror what RuntimeSettings.tsx previously called directly with fetch().
// Moving them here keeps the Operations page consistent with the rest of api.ts.

export interface LLMProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  label?: string;
}

export interface LLMProviderEntry {
  key: string;
  label: string;
  configured: boolean;
  transportMode: string;
}

export interface LLMSettingsPayload {
  defaultProvider: string | null;
  effectiveDefaultProvider: string | null;
  providers: Record<string, LLMProviderConfig>;
  availableProviders: LLMProviderEntry[];
}

export const fetchLLMSettings = async (): Promise<LLMSettingsPayload> =>
  requestJson<LLMSettingsPayload>('/api/runtime-settings');

export const saveLLMProviderSettings = async ({
  providerKey,
  config,
  setDefault,
}: {
  providerKey: string;
  config: LLMProviderConfig;
  setDefault?: boolean;
}): Promise<{ success: boolean }> =>
  requestJson<{ success: boolean }>('/api/runtime-settings/provider', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ providerKey, config, setDefault }),
  });

export const setLLMDefaultProvider = async (providerKey: string): Promise<{ success: boolean }> =>
  requestJson<{ success: boolean }>('/api/runtime-settings/default', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ providerKey }),
  });
