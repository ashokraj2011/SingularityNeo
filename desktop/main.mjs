import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import dotenv from 'dotenv';
import { probeRendererUrl } from './rendererProbe.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env.local') });
dotenv.config({ path: path.join(projectRoot, '.env') });
const tsxCliPath = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);

const normalizeUrl = value => String(value || '').trim().replace(/\/+$/, '');
const normalizeStartupRoute = value => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('#')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    return `#${trimmed}`;
  }
  return `#/${trimmed}`;
};
const isSafeExternalUrl = value => {
  try {
    const parsed = new URL(String(value || ''));
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};
const openSafeExternalUrl = url => {
  if (!isSafeExternalUrl(url)) {
    console.warn(`Blocked unsafe external desktop navigation: ${String(url || '')}`);
    return;
  }
  void shell.openExternal(url);
};

const logDesktopStartup = message => {
  console.log(`[desktop:main] ${message}`);
};

const controlPlaneUrl = normalizeUrl(
  process.env.SINGULARITY_CONTROL_PLANE_URL || 'http://127.0.0.1:3001',
);
const rendererDevUrl = normalizeUrl(process.env.SINGULARITY_ELECTRON_DEV_SERVER_URL || '');
const startupRouteHash = normalizeStartupRoute(
  process.env.SINGULARITY_ELECTRON_START_ROUTE || '',
);

const resolveDesktopExecutorId = () => {
  const configured = String(process.env.SINGULARITY_DESKTOP_EXECUTOR_ID || '').trim();
  if (configured) {
    return configured;
  }

  const userDataPath = app.getPath('userData');
  const executorIdPath = path.join(userDataPath, 'desktop-executor-id');
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
    if (fs.existsSync(executorIdPath)) {
      const existing = fs.readFileSync(executorIdPath, 'utf8').trim();
      if (existing) {
        return existing;
      }
    }
    const next = `desktop-executor-${randomUUID().slice(0, 12)}`;
    fs.writeFileSync(executorIdPath, `${next}\n`, 'utf8');
    return next;
  } catch {
    return `desktop-executor-${randomUUID().slice(0, 12)}`;
  }
};

const LOCAL_CONNECTOR_PROVIDERS = new Set([
  'github',
  'jira',
  'confluence',
  'jenkins',
  'datadog',
  'splunk',
  'servicenow',
]);

const LOCAL_CONNECTOR_DEFAULTS = {
  github: {
    label: 'GitHub',
    baseUrl: 'https://api.github.com',
    authType: 'TOKEN',
  },
  jira: {
    label: 'Jira',
    baseUrl: '',
    authType: 'BASIC',
  },
  confluence: {
    label: 'Confluence',
    baseUrl: '',
    authType: 'BASIC',
  },
  jenkins: {
    label: 'Jenkins',
    baseUrl: '',
    authType: 'BASIC',
  },
  datadog: {
    label: 'Datadog',
    baseUrl: 'https://api.datadoghq.com',
    authType: 'API_KEY',
  },
  splunk: {
    label: 'Splunk',
    baseUrl: '',
    authType: 'BEARER',
  },
  servicenow: {
    label: 'ServiceNow',
    baseUrl: '',
    authType: 'BASIC',
  },
};

const localConnectorStorePath = () =>
  path.join(app.getPath('userData'), 'local-connectors.json');

const normalizeProvider = value => {
  const provider = String(value || '').trim().toLowerCase();
  if (!LOCAL_CONNECTOR_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported local connector provider: ${String(value || 'unknown')}`);
  }
  return provider;
};

const normalizeConnectorUrl = value => String(value || '').trim().replace(/\/+$/, '');

const readLocalConnectorStore = () => {
  const storePath = localConnectorStorePath();
  try {
    if (!fs.existsSync(storePath)) {
      return { version: 1, connectors: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return {
      version: 1,
      connectors:
        parsed?.connectors && typeof parsed.connectors === 'object'
          ? parsed.connectors
          : {},
    };
  } catch (error) {
    console.warn('Unable to read local connector store.', error);
    return { version: 1, connectors: {} };
  }
};

const writeLocalConnectorStore = store => {
  const storePath = localConnectorStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
};

const encryptLocalSecret = value => {
  const token = String(value || '');
  if (!token) {
    return undefined;
  }
  if (safeStorage.isEncryptionAvailable()) {
    return {
      encryptedSecret: safeStorage.encryptString(token).toString('base64'),
      encryption: 'safeStorage',
    };
  }
  return {
    encryptedSecret: Buffer.from(token, 'utf8').toString('base64'),
    encryption: 'plaintext-local-fallback',
  };
};

const decryptLocalSecret = connector => {
  if (!connector?.encryptedSecret) {
    return '';
  }
  try {
    const payload = Buffer.from(connector.encryptedSecret, 'base64');
    if (connector.encryption === 'safeStorage') {
      return safeStorage.decryptString(payload);
    }
    return payload.toString('utf8');
  } catch {
    return '';
  }
};

const redactLocalConnector = connector => {
  const provider = normalizeProvider(connector?.provider);
  const defaults = LOCAL_CONNECTOR_DEFAULTS[provider];
  return {
    provider,
    enabled: Boolean(connector.enabled),
    label: String(connector.label || defaults.label),
    baseUrl: normalizeConnectorUrl(connector.baseUrl || defaults.baseUrl),
    authType: connector.authType || defaults.authType,
    username: String(connector.username || ''),
    projectKey: String(connector.projectKey || ''),
    spaceKey: String(connector.spaceKey || ''),
    organization: String(connector.organization || ''),
    notes: String(connector.notes || ''),
    tokenStored: Boolean(connector.encryptedSecret),
    encryption: connector.encryption || 'none',
    updatedAt: connector.updatedAt,
    lastValidatedAt: connector.lastValidatedAt,
    lastValidationStatus: connector.lastValidationStatus,
    lastValidationMessage: connector.lastValidationMessage,
  };
};

const listLocalConnectors = () => {
  const store = readLocalConnectorStore();
  return Array.from(LOCAL_CONNECTOR_PROVIDERS).map(provider =>
    redactLocalConnector({
      provider,
      ...LOCAL_CONNECTOR_DEFAULTS[provider],
      ...(store.connectors[provider] || {}),
    }),
  );
};

const upsertLocalConnector = payload => {
  const provider = normalizeProvider(payload?.provider);
  const store = readLocalConnectorStore();
  const existing = store.connectors[provider] || {};
  const defaults = LOCAL_CONNECTOR_DEFAULTS[provider];
  const next = {
    ...existing,
    provider,
    enabled: Boolean(payload?.enabled),
    label: String(payload?.label || existing.label || defaults.label),
    baseUrl: normalizeConnectorUrl(payload?.baseUrl ?? existing.baseUrl ?? defaults.baseUrl),
    authType: String(payload?.authType || existing.authType || defaults.authType),
    username: String(payload?.username ?? existing.username ?? ''),
    projectKey: String(payload?.projectKey ?? existing.projectKey ?? ''),
    spaceKey: String(payload?.spaceKey ?? existing.spaceKey ?? ''),
    organization: String(payload?.organization ?? existing.organization ?? ''),
    notes: String(payload?.notes ?? existing.notes ?? ''),
    updatedAt: new Date().toISOString(),
  };

  if (payload?.clearToken) {
    delete next.encryptedSecret;
    delete next.encryption;
  } else if (typeof payload?.token === 'string' && payload.token.length > 0) {
    Object.assign(next, encryptLocalSecret(payload.token));
  }

  store.connectors[provider] = next;
  writeLocalConnectorStore(store);
  return redactLocalConnector(next);
};

const deleteLocalConnector = payload => {
  const provider = normalizeProvider(payload?.provider);
  const store = readLocalConnectorStore();
  delete store.connectors[provider];
  writeLocalConnectorStore(store);
  return { deleted: true, provider };
};

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const basicAuthHeader = (username, token) =>
  `Basic ${Buffer.from(`${String(username || '')}:${String(token || '')}`, 'utf8').toString(
    'base64',
  )}`;

const validationResult = (provider, status, message, details = {}) => ({
  provider,
  status,
  message,
  checkedAt: new Date().toISOString(),
  details,
});

const validateLocalConnector = async payload => {
  const provider = normalizeProvider(payload?.provider);
  const store = readLocalConnectorStore();
  const connector = {
    provider,
    ...LOCAL_CONNECTOR_DEFAULTS[provider],
    ...(store.connectors[provider] || {}),
  };
  const baseUrl = normalizeConnectorUrl(connector.baseUrl);
  const token = decryptLocalSecret(connector);

  let result;
  try {
    if (!connector.enabled) {
      result = validationResult(provider, 'NEEDS_CONFIGURATION', 'Connector is saved but disabled.');
    } else if (!baseUrl) {
      result = validationResult(provider, 'NEEDS_CONFIGURATION', 'Base URL is required.');
    } else if (!token) {
      result = validationResult(provider, 'NEEDS_CONFIGURATION', 'A local token is required.');
    } else if (provider === 'github') {
      const response = await fetchWithTimeout(`${baseUrl}/user`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
        },
      });
      result = response.ok
        ? validationResult(provider, 'READY', 'GitHub token validated.')
        : validationResult(provider, 'ERROR', `GitHub validation failed with HTTP ${response.status}.`);
    } else if (provider === 'jira') {
      if (!connector.username) {
        result = validationResult(provider, 'NEEDS_CONFIGURATION', 'Jira email is required.');
      } else {
        const response = await fetchWithTimeout(`${baseUrl}/rest/api/3/myself`, {
          headers: {
            Accept: 'application/json',
            Authorization: basicAuthHeader(connector.username, token),
          },
        });
        result = response.ok
          ? validationResult(provider, 'READY', 'Jira credentials validated.')
          : validationResult(provider, 'ERROR', `Jira validation failed with HTTP ${response.status}.`);
      }
    } else if (provider === 'confluence') {
      if (!connector.username) {
        result = validationResult(provider, 'NEEDS_CONFIGURATION', 'Confluence email is required.');
      } else {
        const response = await fetchWithTimeout(`${baseUrl}/wiki/rest/api/user/current`, {
          headers: {
            Accept: 'application/json',
            Authorization: basicAuthHeader(connector.username, token),
          },
        });
        result = response.ok
          ? validationResult(provider, 'READY', 'Confluence credentials validated.')
          : validationResult(
              provider,
              'ERROR',
              `Confluence validation failed with HTTP ${response.status}.`,
            );
      }
    } else if (provider === 'jenkins') {
      const response = await fetchWithTimeout(`${baseUrl}/api/json`, {
        headers: {
          Accept: 'application/json',
          Authorization: connector.username
            ? basicAuthHeader(connector.username, token)
            : `Bearer ${token}`,
        },
      });
      result = response.ok
        ? validationResult(provider, 'READY', 'Jenkins credentials validated.')
        : validationResult(provider, 'ERROR', `Jenkins validation failed with HTTP ${response.status}.`);
    } else if (provider === 'datadog') {
      const response = await fetchWithTimeout(`${baseUrl}/api/v1/validate`, {
        headers: {
          Accept: 'application/json',
          'DD-API-KEY': token,
        },
      });
      result = response.ok
        ? validationResult(provider, 'READY', 'Datadog API key validated.')
        : validationResult(provider, 'ERROR', `Datadog validation failed with HTTP ${response.status}.`);
    } else if (provider === 'splunk') {
      const response = await fetchWithTimeout(`${baseUrl}/services/server/info?output_mode=json`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      result = response.ok
        ? validationResult(provider, 'READY', 'Splunk token validated.')
        : validationResult(provider, 'ERROR', `Splunk validation failed with HTTP ${response.status}.`);
    } else if (provider === 'servicenow') {
      if (!connector.username) {
        result = validationResult(provider, 'NEEDS_CONFIGURATION', 'ServiceNow username is required.');
      } else {
        const response = await fetchWithTimeout(`${baseUrl}/api/now/table/sys_user?sysparm_limit=1`, {
          headers: {
            Accept: 'application/json',
            Authorization: basicAuthHeader(connector.username, token),
          },
        });
        result = response.ok
          ? validationResult(provider, 'READY', 'ServiceNow credentials validated.')
          : validationResult(
              provider,
              'ERROR',
              `ServiceNow validation failed with HTTP ${response.status}.`,
            );
      }
    }
  } catch (error) {
    result = validationResult(
      provider,
      'ERROR',
      error?.name === 'AbortError'
        ? 'Validation timed out.'
        : 'Validation failed before the connector responded.',
    );
  }

  store.connectors[provider] = {
    ...connector,
    lastValidatedAt: result.checkedAt,
    lastValidationStatus: result.status,
    lastValidationMessage: result.message,
  };
  writeLocalConnectorStore(store);
  return result;
};

let mainWindow = null;
let localWorker = null;
const pendingWorkerRequests = new Map();
const cancelledStreamIds = new Set();

const DEFAULT_WORKER_TIMEOUT_MS = 90_000;
const RUNTIME_STATUS_WORKER_TIMEOUT_MS = 3 * 60_000;
const RUNTIME_ACTOR_CONTEXT_TIMEOUT_MS = 2 * 60_000;
const STREAM_CANCEL_GRACE_MS = 5 * 60_000;
const STREAM_WORKER_IDLE_TIMEOUT_MS = 5 * 60_000;

const detectDesktopRendererIssue = () => {
  const distIndexPath = path.join(projectRoot, 'dist', 'index.html');
  if (!fs.existsSync(distIndexPath)) {
    return 'No desktop renderer build was found. Run `npm run desktop:build` or use `npm run dev` to launch against the live development server.';
  }

  const html = fs.readFileSync(distIndexPath, 'utf8');
  if (/src="\/assets\//.test(html) || /href="\/assets\//.test(html)) {
    return 'The current dist/ renderer was built for the web with absolute /assets paths. Electron cannot load that from file://, so run `npm run desktop:build` or start the live desktop stack with `npm run dev`.';
  }

  return null;
};

const loadStartupIssuePage = async issue => {
  const body = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Singularity Desktop Startup</title>
      <style>
        :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; }
        body { margin: 0; background: #f4f7fb; color: #102034; }
        main { max-width: 760px; margin: 8vh auto; padding: 32px; }
        .card { background: #fff; border: 1px solid #d7e1ee; border-radius: 24px; padding: 28px; box-shadow: 0 20px 60px rgba(16,32,52,.08); }
        h1 { margin: 0 0 12px; font-size: 28px; }
        p { line-height: 1.6; margin: 0 0 12px; }
        code { background: #eef4fb; border-radius: 8px; padding: 2px 6px; }
        ul { padding-left: 20px; line-height: 1.7; }
      </style>
    </head>
    <body>
      <main>
        <div class="card">
          <h1>Desktop renderer could not start</h1>
          <p>${issue}</p>
          <ul>
            <li>Use <code>npm run dev</code> to launch the live desktop development stack.</li>
            <li>Or run <code>npm run desktop:build</code> and then <code>npm run desktop:start</code> for a packaged renderer.</li>
            <li>Make sure the backend is running on <code>${controlPlaneUrl}</code> for data-backed screens.</li>
          </ul>
        </div>
      </main>
    </body>
  </html>`;

  await mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(body)}`);
};

const createDesktopContext = () => ({
  isDesktop: true,
  controlPlaneUrl,
  platform: process.platform,
  appVersion: app.getVersion(),
  userDataPath: app.getPath('userData'),
  isPackaged: app.isPackaged,
});

const sendWorkerMessage = message => {
  if (!localWorker?.stdin || localWorker.killed) {
    throw new Error('Local worker is not available.');
  }

  localWorker.stdin.write(`${JSON.stringify(message)}\n`);
};

const createAbortError = (message = 'Worker request was cancelled.') => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

const markStreamCancelled = streamId => {
  if (!streamId) {
    return;
  }
  cancelledStreamIds.add(streamId);
  const cleanup = setTimeout(() => {
    cancelledStreamIds.delete(streamId);
  }, STREAM_CANCEL_GRACE_MS);
  if (typeof cleanup.unref === 'function') {
    cleanup.unref();
  }
};

const cancelPendingStreamRequest = streamId => {
  if (!streamId) {
    return false;
  }

  let cancelled = false;
  pendingWorkerRequests.forEach((pending, requestId) => {
    if (pending.streamId !== streamId) {
      return;
    }
    cancelled = true;
    clearTimeout(pending.timeout);
    pendingWorkerRequests.delete(requestId);
    pending.reject(createAbortError(`Worker request cancelled: ${streamId}`));
  });
  return cancelled;
};

const requestWorker = (type, payload = {}, options = {}) =>
  new Promise((resolve, reject) => {
    if (!localWorker?.stdin || localWorker.killed) {
      reject(new Error('Local worker is not available.'));
      return;
    }

    const requestId = randomUUID();
    const timeoutMs =
      Number.isFinite(options?.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : DEFAULT_WORKER_TIMEOUT_MS;
    const createTimeout = () =>
      setTimeout(() => {
        pendingWorkerRequests.delete(requestId);
        reject(new Error(`Worker request timed out: ${type}`));
      }, timeoutMs);
    let timeout = createTimeout();
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = createTimeout();
      const pending = pendingWorkerRequests.get(requestId);
      if (pending) {
        pending.timeout = timeout;
      }
    };

    pendingWorkerRequests.set(requestId, {
      resolve,
      reject,
      timeout,
      streamId:
        typeof payload?.streamId === 'string' && payload.streamId.trim()
          ? payload.streamId.trim()
          : undefined,
      resetTimeout,
    });

    sendWorkerMessage({
      type,
      requestId,
      payload,
    });
  });

const startLocalWorker = () => {
  localWorker = spawn(tsxCliPath, [path.join(projectRoot, 'desktop', 'worker.ts')], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      SINGULARITY_CONTROL_PLANE_URL: controlPlaneUrl,
      SINGULARITY_DESKTOP_EXECUTOR_ID: resolveDesktopExecutorId(),
      SINGULARITY_PROJECT_ROOT: projectRoot,
    },
  });

  const reader = readline.createInterface({
    input: localWorker.stdout,
    crlfDelay: Infinity,
  });

  reader.on('line', line => {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'worker:stream-event' && typeof message.streamId === 'string') {
      if (cancelledStreamIds.has(message.streamId)) {
        return;
      }

      pendingWorkerRequests.forEach(pending => {
        if (pending.streamId === message.streamId && typeof pending.resetTimeout === 'function') {
          pending.resetTimeout();
        }
      });

      mainWindow?.webContents.send(
        `desktop:runtime:chat-stream:${message.streamId}`,
        message.event,
      );
      return;
    }

    if (message.type === 'worker:response' && typeof message.requestId === 'string') {
      if (message.streamId) {
        cancelledStreamIds.delete(message.streamId);
      }

      const pending = pendingWorkerRequests.get(message.requestId);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      pendingWorkerRequests.delete(message.requestId);

      if (message.error) {
        pending.reject(new Error(message.error));
        return;
      }

      pending.resolve(message.payload);
    }
  });

  localWorker.on('error', error => {
    console.error('Desktop worker failed.', error);
  });

  localWorker.on('exit', code => {
    if (code !== 0) {
      console.error(`Desktop worker exited with code ${code}.`);
    }
    pendingWorkerRequests.forEach(pending => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Desktop worker stopped before the request completed.'));
    });
    pendingWorkerRequests.clear();
    localWorker = null;
  });
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    title: 'Singularity',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  let forcedShowTimer = null;
  const clearForcedShowTimer = () => {
    if (forcedShowTimer) {
      clearTimeout(forcedShowTimer);
      forcedShowTimer = null;
    }
  };
  const showAndFocusWindow = reason => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    clearForcedShowTimer();
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      logDesktopStartup(`Showing desktop window (${reason}).`);
      mainWindow.show();
    } else {
      logDesktopStartup(`Focusing desktop window (${reason}).`);
    }
    mainWindow.focus();
    try {
      app.focus({ steal: true });
    } catch {
      app.focus();
    }
  };

  mainWindow.once('ready-to-show', () => {
    showAndFocusWindow('ready-to-show');
  });
  mainWindow.on('show', () => {
    logDesktopStartup('Desktop window is visible.');
  });
  mainWindow.on('unresponsive', () => {
    console.error('[desktop:main] Desktop window became unresponsive.');
  });
  mainWindow.on('closed', () => {
    clearForcedShowTimer();
    if (mainWindow?.isDestroyed?.()) {
      logDesktopStartup('Desktop window closed.');
    }
  });
  mainWindow.webContents.on('did-start-loading', () => {
    logDesktopStartup('Renderer started loading.');
  });
  mainWindow.webContents.on('did-finish-load', () => {
    const currentUrl = mainWindow?.webContents.getURL() || '';
    logDesktopStartup(`Renderer finished loading ${currentUrl || '(unknown url)'}.`);
    showAndFocusWindow('did-finish-load');
  });
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      console.error(
        `[desktop:main] Renderer failed to load (${isMainFrame ? 'main-frame' : 'subframe'}) ${validatedUrl || '(unknown url)'}: [${errorCode}] ${errorDescription}`,
      );
      showAndFocusWindow('did-fail-load');
    },
  );
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `[desktop:main] Renderer process exited unexpectedly: ${details?.reason || 'unknown reason'}.`,
    );
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternalUrl(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', event => {
    const targetUrl = event.url;
    const currentUrl = mainWindow?.webContents.getURL() || '';
    if (!targetUrl || targetUrl === currentUrl || targetUrl.startsWith(`${currentUrl}#`)) {
      return;
    }
    if (rendererDevUrl && targetUrl.startsWith(rendererDevUrl)) {
      return;
    }
    event.preventDefault();
    openSafeExternalUrl(targetUrl);
  });

  forcedShowTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) {
      return;
    }
    console.warn(
      '[desktop:main] Desktop window was still hidden after 5s. Forcing it visible for debugging.',
    );
    showAndFocusWindow('forced-show-timeout');
  }, 5_000);
  if (typeof forcedShowTimer.unref === 'function') {
    forcedShowTimer.unref();
  }

  if (rendererDevUrl) {
    const devRendererIsValid = await probeRendererUrl(rendererDevUrl, 2_500);
    if (devRendererIsValid) {
      const targetUrl =
        startupRouteHash && !rendererDevUrl.includes('#')
          ? `${rendererDevUrl.replace(/\/+$/, '')}/${startupRouteHash}`
          : rendererDevUrl;
      logDesktopStartup(`Loading live renderer from ${targetUrl}.`);
      await mainWindow.loadURL(targetUrl);
      mainWindow.webContents.openDevTools({ mode: 'detach' });
      showAndFocusWindow('live-renderer-loaded');
      return;
    }

    console.warn(
      `Configured renderer URL ${rendererDevUrl} did not look like the Singularity renderer. Falling back to the packaged desktop build.`,
    );
  }

  const rendererIssue = detectDesktopRendererIssue();
  if (rendererIssue) {
    logDesktopStartup('Loading startup issue page because the desktop renderer is not ready.');
    await loadStartupIssuePage(rendererIssue);
    showAndFocusWindow('startup-issue-page');
    return;
  }

  const packagedRendererUrl = pathToFileURL(
    path.join(projectRoot, 'dist', 'index.html'),
  ).toString();
  logDesktopStartup(`Loading packaged renderer from ${packagedRendererUrl}.`);
  await mainWindow.loadURL(
    startupRouteHash ? `${packagedRendererUrl}${startupRouteHash}` : packagedRendererUrl,
  );
  showAndFocusWindow('packaged-renderer-loaded');
};

ipcMain.handle('desktop:get-shell-context', async () => createDesktopContext());
ipcMain.handle('desktop:worker:ping', async () =>
  requestWorker('worker:ping', {
    requestedAt: new Date().toISOString(),
  }),
);
ipcMain.handle('desktop:runtime:status', async (_event, payload) =>
  requestWorker('runtime:status', payload || {}, {
    timeoutMs: RUNTIME_STATUS_WORKER_TIMEOUT_MS,
  }),
);
ipcMain.handle('desktop:runtime:actor-context', async (_event, payload) =>
  requestWorker('runtime:actor-context', payload || {}, {
    timeoutMs: RUNTIME_ACTOR_CONTEXT_TIMEOUT_MS,
  }),
);
ipcMain.handle('desktop:runtime:set-token', async (_event, payload) =>
  requestWorker('runtime:set-token', payload || {}),
);
ipcMain.handle('desktop:runtime:clear-token', async () =>
  requestWorker('runtime:clear-token'),
);
ipcMain.handle('desktop:runtime:providers:list', async () =>
  requestWorker('runtime:providers:list'),
);
ipcMain.handle('desktop:runtime:providers:config:set', async (_event, payload) =>
  requestWorker('runtime:providers:config:set', payload || {}),
);
ipcMain.handle('desktop:runtime:providers:validate', async (_event, payload) =>
  requestWorker('runtime:providers:validate', payload || {}),
);
ipcMain.handle('desktop:runtime:providers:probe', async (_event, payload) =>
  requestWorker('runtime:providers:probe', payload || {}),
);
ipcMain.handle('desktop:runtime:providers:models', async (_event, payload) =>
  requestWorker('runtime:providers:models', payload || {}),
);
ipcMain.handle('desktop:runtime:set-embedding-config', async (_event, payload) =>
  requestWorker('runtime:set-embedding-config', payload || {}),
);
ipcMain.handle('desktop:runtime:clear-embedding-config', async () =>
  requestWorker('runtime:clear-embedding-config'),
);
ipcMain.handle('desktop:runtime:preferences:get', async () =>
  requestWorker('runtime:preferences:get'),
);
ipcMain.handle('desktop:runtime:preferences:set', async (_event, payload) =>
  requestWorker('runtime:preferences:set', payload || {}),
);
ipcMain.handle('desktop:runtime:chat', async (_event, payload) =>
  requestWorker('runtime:chat', payload || {}),
);
ipcMain.handle('desktop:runtime:execution:claim', async (_event, payload) =>
  requestWorker('runtime:execution:claim', payload || {}),
);
ipcMain.handle('desktop:runtime:execution:release', async (_event, payload) =>
  requestWorker('runtime:execution:release', payload || {}),
);
ipcMain.handle('desktop:runtime:chat-stream', async (_event, payload) => {
  const streamId = payload?.streamId || randomUUID();
  cancelledStreamIds.delete(streamId);
  return requestWorker('runtime:chat-stream', {
    ...(payload || {}),
    streamId,
  }, {
    timeoutMs: STREAM_WORKER_IDLE_TIMEOUT_MS,
  });
});
ipcMain.handle('desktop:runtime:chat-stream:cancel', async (_event, payload) => {
  const streamId =
    typeof payload?.streamId === 'string' && payload.streamId.trim()
      ? payload.streamId.trim()
      : '';
  if (streamId) {
    markStreamCancelled(streamId);
    cancelPendingStreamRequest(streamId);
    try {
      sendWorkerMessage({
        type: 'runtime:chat-stream:cancel',
        requestId: randomUUID(),
        payload: { streamId },
      });
    } catch {
      // The local worker may already be gone; cancelling the renderer-side
      // request is still enough to unblock the chat UI immediately.
    }
  }
  return { cancelled: Boolean(streamId) };
});
ipcMain.handle('desktop:local-connectors:list', async () => listLocalConnectors());
ipcMain.handle('desktop:local-connectors:save', async (_event, payload) =>
  upsertLocalConnector(payload || {}),
);
ipcMain.handle('desktop:local-connectors:delete', async (_event, payload) =>
  deleteLocalConnector(payload || {}),
);
ipcMain.handle('desktop:local-connectors:validate', async (_event, payload) =>
  validateLocalConnector(payload || {}),
);

app.whenReady().then(async () => {
  startLocalWorker();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  pendingWorkerRequests.forEach(pending => clearTimeout(pending.timeout));
  pendingWorkerRequests.clear();
  if (localWorker && !localWorker.killed) {
    localWorker.kill('SIGTERM');
  }
});
