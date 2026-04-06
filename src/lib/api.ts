import {
  ArtifactContentResponse,
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityWorkspace,
  CompletedWorkOrderDetail,
  CompletedWorkOrderSummary,
  LedgerArtifactRecord,
  RunEvent,
  Skill,
  WorkItem,
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
}

export interface AppState {
  capabilities: Capability[];
  capabilityWorkspaces: CapabilityWorkspace[];
}

export interface CapabilityBundle {
  capability: Capability;
  workspace: CapabilityWorkspace;
}

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
  capability: Capability,
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
  agent: Omit<CapabilityAgent, 'capabilityId'>,
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
