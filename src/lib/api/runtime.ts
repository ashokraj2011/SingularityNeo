import type {
  CapabilityExecutionOwnership,
  DesktopPreferences,
  DesktopWorkspaceMapping,
  MemoryRetrievalMode,
  ProviderKey,
  RuntimeModelOption,
  RuntimePreflightSnapshot,
  RuntimeProviderConfig,
  RuntimeProviderProbeResult,
  RuntimeProviderStatus,
  RuntimeProviderValidationResult,
  RuntimeReadinessCheck,
  RuntimeReadinessState,
  RuntimeTransportMode,
  WorkspaceDatabaseRuntimeInfo,
  WorkspaceWriteLock,
} from '../../types';
import { getDesktopBridge } from '../desktop';
import { getCurrentActorContext, jsonHeaders, requestJson } from './shared';

export interface RuntimeStatus {
  configured: boolean;
  provider: string;
  providerKey?: ProviderKey;
  readinessState?: RuntimeReadinessState;
  checks?: RuntimeReadinessCheck[];
  controlPlaneUrl?: string;
  desktopExecutorId?: string;
  desktopId?: string;
  desktopHostname?: string;
  workingDirectorySource?: 'mapping' | 'env' | 'project-root' | 'missing';
  embeddingProviderKey?: 'local-openai' | 'deterministic-hash';
  embeddingConfigured?: boolean;
  retrievalMode?: MemoryRetrievalMode;
  fallbackReason?: string | null;
  embeddingEndpoint?: string | null;
  embeddingModel?: string | null;
  embeddingApiKeyConfigured?: boolean;
  availableProviders?: RuntimeProviderStatus[];
  endpoint: string;
  runtimeOwner?: 'DESKTOP' | 'SERVER';
  executionRuntimeOwner?: 'DESKTOP' | 'SERVER';
  tokenSource: string | null;
  defaultModel: string;
  modelCatalogSource?: 'runtime' | 'fallback';
  runtimeAccessMode?: RuntimeTransportMode;
  httpFallbackEnabled?: boolean;
  databaseRuntime?: WorkspaceDatabaseRuntimeInfo;
  activeDatabaseProfileId?: string | null;
  activeDatabaseProfileLabel?: string | null;
  executorId?: string;
  executorHeartbeatAt?: string;
  executorHeartbeatStatus?: 'FRESH' | 'STALE' | 'OFFLINE';
  actorUserId?: string;
  actorDisplayName?: string;
  ownedCapabilityIds?: string[];
  workingDirectory?: string;
  lastRuntimeError?: string | null;
  lastExecutorDispatchState?: "idle" | "skipped" | "claimed" | "error";
  lastExecutorDispatchReason?: string | null;
  lastExecutorDispatchAt?: string | null;
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

export const fetchRuntimeStatus = async (): Promise<RuntimeStatus> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return desktop.getRuntimeStatus({
      actorContext: getCurrentActorContext(),
    }) as Promise<RuntimeStatus>;
  }

  return requestJson<RuntimeStatus>('/api/runtime/status');
};

export const fetchRuntimePreflight = async (): Promise<RuntimePreflightSnapshot> =>
  requestJson<RuntimePreflightSnapshot>('/api/runtime/preflight');

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

export const fetchDesktopPreferences = async (): Promise<DesktopPreferences | null> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return desktop.getDesktopPreferences() as Promise<DesktopPreferences | null>;
  }
  return requestJson<DesktopPreferences | null>(
    '/api/runtime/desktop-preferences',
  );
};

export const saveDesktopPreferences = async (
  prefs: Partial<DesktopPreferences>,
): Promise<DesktopPreferences> => {
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    return (desktop.setDesktopPreferences(prefs) as Promise<{ saved: DesktopPreferences }>)
      .then(r => r.saved);
  }
  return requestJson<DesktopPreferences>(
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
    'A desktop runtime is required to claim capability execution.',
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
    'A desktop runtime is required to release capability execution.',
  );
};

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
      method: 'POST',
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
    params.set('userId', userId);
  }
  if (capabilityId) {
    params.set('capabilityId', capabilityId);
  }

  const payload = await requestJson<{ mappings: DesktopWorkspaceMapping[] }>(
    `/api/runtime/executors/${encodeURIComponent(executorId)}/workspace-mappings${
      params.size ? `?${params.toString()}` : ''
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
      method: 'POST',
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
      method: 'PATCH',
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
      method: 'DELETE',
    },
  );
