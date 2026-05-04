import type {
  DesktopLocalConnectorConfig,
  DesktopLocalConnectorProvider,
  DesktopLocalConnectorSavePayload,
  DesktopLocalConnectorValidationResult,
  ProviderKey,
  RuntimeProviderProbeResult,
  RuntimeProviderConfig,
} from '../types';

export interface DesktopWorkerPing {
  status: string;
  pid: number;
  platform: string;
  cwd: string;
  homedir: string;
  controlPlaneUrl: string;
  projectRoot: string;
  timestamp: string;
  versions: {
    node: string;
  };
}

export interface DesktopShellContext {
  isDesktop: boolean;
  controlPlaneUrl: string;
  platform: string;
  appVersion: string;
  userDataPath: string;
  isPackaged: boolean;
}

export interface SingularityDesktopBridge {
  isDesktop: true;
  controlPlaneUrl: string;
  getShellContext: () => Promise<DesktopShellContext>;
  pingWorker: () => Promise<DesktopWorkerPing>;
  getRuntimeStatus: (payload?: { actorContext?: unknown }) => Promise<unknown>;
  setActorContext: (actor: unknown) => Promise<unknown>;
  setRuntimeToken: (token: string) => Promise<unknown>;
  clearRuntimeToken: () => Promise<unknown>;
  listRuntimeProviders: () => Promise<unknown>;
  saveRuntimeProviderConfig: (payload: {
    providerKey: ProviderKey;
    config: RuntimeProviderConfig;
    setDefault?: boolean;
    clearDefault?: boolean;
  }) => Promise<unknown>;
  validateRuntimeProvider: (payload: {
    providerKey: ProviderKey;
    config?: RuntimeProviderConfig;
  }) => Promise<unknown>;
  probeRuntimeProvider: (payload: {
    providerKey: ProviderKey;
    endpointHint?: string;
    commandHint?: string;
    modelHint?: string;
  }) => Promise<RuntimeProviderProbeResult>;
  getRuntimeProviderModels: (providerKey: ProviderKey) => Promise<unknown>;
  setEmbeddingConfig: (payload: {
    baseUrl: string;
    apiKey?: string;
    model?: string;
  }) => Promise<unknown>;
  clearEmbeddingConfig: () => Promise<unknown>;
  getDesktopPreferences: () => Promise<unknown>;
  setDesktopPreferences: (prefs: unknown) => Promise<unknown>;
  sendRuntimeChat: (payload: unknown) => Promise<unknown>;
  claimCapabilityExecution: (payload: unknown) => Promise<unknown>;
  releaseCapabilityExecution: (payload: unknown) => Promise<unknown>;
  streamRuntimeChat: (
    payload: unknown,
    onEvent: (event: unknown) => void,
  ) => Promise<unknown>;
  cancelRuntimeChatStream: (streamId: string) => Promise<unknown>;
  listLocalConnectors: () => Promise<DesktopLocalConnectorConfig[]>;
  saveLocalConnector: (
    payload: DesktopLocalConnectorSavePayload,
  ) => Promise<DesktopLocalConnectorConfig>;
  deleteLocalConnector: (
    provider: DesktopLocalConnectorProvider,
  ) => Promise<{ deleted: boolean; provider: DesktopLocalConnectorProvider }>;
  validateLocalConnector: (
    provider: DesktopLocalConnectorProvider,
  ) => Promise<DesktopLocalConnectorValidationResult>;
}

declare global {
  interface Window {
    singularityDesktop?: SingularityDesktopBridge;
  }
}

const normalizeBaseUrl = (value?: string | null) =>
  String(value || '').trim().replace(/\/+$/, '');

export const getDesktopBridge = () =>
  typeof window !== 'undefined' ? window.singularityDesktop : undefined;

export const isDesktopRuntime = () => Boolean(getDesktopBridge()?.isDesktop);

export const resolveApiUrl = (path: string) => {
  if (!path || /^[a-z]+:\/\//i.test(path)) {
    return path;
  }

  const desktopBaseUrl = normalizeBaseUrl(getDesktopBridge()?.controlPlaneUrl);
  const envBaseUrl = normalizeBaseUrl(
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      ?.VITE_API_BASE_URL,
  );
  const baseUrl = desktopBaseUrl || envBaseUrl;

  if (!baseUrl || !path.startsWith('/')) {
    return path;
  }

  return new URL(path, `${baseUrl}/`).toString();
};

export const createApiEventSource = (path: string) =>
  new EventSource(resolveApiUrl(path));
