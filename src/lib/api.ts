import {
  AgentLearningProfileDetail,
  ArtifactContentResponse,
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityDeploymentTarget,
  CapabilityExecutionCommandTemplate,
  CapabilityFlightRecorderSnapshot,
  CapabilityWorkspace,
  CommandTemplateValidationResult,
  CopilotSessionMonitorSnapshot,
  CompletedWorkOrderDetail,
  CompletedWorkOrderSummary,
  ConnectorValidationResult,
  DeploymentTargetValidationResult,
  ChatStreamEvent,
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
  TelemetryMetricSample,
  TelemetrySpan,
  WorkspacePathValidationResult,
  WorkItem,
  WorkItemFlightRecorderDetail,
  WorkItemPhase,
  WorkflowRun,
  WorkflowRunDetail,
} from '../types';

export interface RuntimeStatus {
  configured: boolean;
  provider: string;
  endpoint: string;
  tokenSource: string | null;
  defaultModel: string;
  modelCatalogSource?: 'runtime' | 'fallback';
  runtimeAccessMode?: 'copilot-session' | 'headless-cli' | 'http-fallback' | 'unconfigured';
  httpFallbackEnabled?: boolean;
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

export interface AppState {
  capabilities: Capability[];
  capabilityWorkspaces: CapabilityWorkspace[];
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

const requestJson = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(await getError(response));
  }

  return response.json() as Promise<T>;
};

export const fetchRuntimeStatus = async (): Promise<RuntimeStatus> =>
  requestJson<RuntimeStatus>('/api/runtime/status');

export const updateRuntimeCredentials = async (
  token: string,
): Promise<RuntimeStatus> =>
  requestJson<RuntimeStatus>('/api/runtime/credentials', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ token }),
  });

export const clearRuntimeCredentials = async (): Promise<RuntimeStatus> =>
  requestJson<RuntimeStatus>('/api/runtime/credentials', {
    method: 'DELETE',
  });

export const sendCapabilityChat = async (
  payload: CapabilityChatRequest,
): Promise<CapabilityChatResponse> =>
  requestJson<CapabilityChatResponse>('/api/runtime/chat', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });

export const fetchAppState = async (): Promise<AppState> =>
  requestJson<AppState>('/api/state');

export const fetchCapabilityBundle = async (
  capabilityId: string,
): Promise<CapabilityBundle> =>
  requestJson<CapabilityBundle>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}`,
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
  `/api/capabilities/${encodeURIComponent(capabilityId)}/flight-recorder/download?format=${format}`;

export const getWorkItemFlightRecorderDownloadUrl = (
  capabilityId: string,
  workItemId: string,
  format: 'json' | 'markdown',
) =>
  `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/flight-recorder/download?format=${format}`;

export const fetchWorkItemEvidence = async (
  capabilityId: string,
  workItemId: string,
): Promise<CompletedWorkOrderDetail> =>
  requestJson<CompletedWorkOrderDetail>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/evidence`,
  );

export const fetchArtifactContent = async (
  capabilityId: string,
  artifactId: string,
): Promise<ArtifactContentResponse> =>
  requestJson<ArtifactContentResponse>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
  );

export const getArtifactDownloadUrl = (capabilityId: string, artifactId: string) =>
  `/api/capabilities/${encodeURIComponent(capabilityId)}/artifacts/${encodeURIComponent(artifactId)}/download`;

export const getWorkItemEvidenceBundleDownloadUrl = (
  capabilityId: string,
  workItemId: string,
) =>
  `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/evidence-bundle`;

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
  payload: { targetPhase: WorkItemPhase; note?: string },
): Promise<WorkItem> =>
  requestJson<WorkItem>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(workItemId)}/move`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(payload),
    },
  );

export const startCapabilityWorkflowRun = async (
  capabilityId: string,
  workItemId: string,
  payload?: { restartFromPhase?: WorkItemPhase },
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

export const restartCapabilityWorkflowRun = async (
  capabilityId: string,
  runId: string,
  payload?: { restartFromPhase?: WorkItemPhase },
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
  let response: Response;
  try {
    response = await fetch('/api/runtime/chat/stream', {
      method: 'POST',
      headers: jsonHeaders,
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
  let draftContent = '';
  let completeEvent: ChatStreamEvent | null = null;
  let sawDelta = false;
  let sawComplete = false;
  let sawError = false;
  let streamError = '';
  let retryAfterMs: number | undefined;
  let memoryReferences: MemoryReference[] = [];
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
      const normalizedEvent = {
        ...streamEvent,
        type: streamEvent.type || (eventType as ChatStreamEvent['type']),
      };

      if (normalizedEvent.type === 'memory') {
        memoryReferences = normalizedEvent.memoryReferences || [];
      }
      if (normalizedEvent.type === 'delta' && normalizedEvent.content) {
        sawDelta = true;
        draftContent += normalizedEvent.content;
      }
      if (normalizedEvent.type === 'complete') {
        sawComplete = true;
        completeEvent = normalizedEvent;
        draftContent = normalizedEvent.content || draftContent;
        memoryReferences = normalizedEvent.memoryReferences || memoryReferences;
      }
      if (normalizedEvent.type === 'error') {
        sawError = true;
        streamError = normalizedEvent.error || 'The backend runtime ended this stream early.';
        retryAfterMs = normalizedEvent.retryAfterMs;
      }

      handlers.onEvent(normalizedEvent);
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

  const trimmedDraft = draftContent.trim();
  const termination = sawComplete
    ? 'complete'
    : trimmedDraft
      ? sawError || aborted
        ? 'interrupted'
        : 'recovered'
      : 'empty';

  return {
    termination,
    draftContent,
    completeEvent,
    error:
      streamError ||
      (aborted ? 'Streaming response was stopped before completion.' : undefined),
    retryAfterMs,
    memoryReferences,
    sawDelta,
    sawComplete,
    sawError,
  };
};
