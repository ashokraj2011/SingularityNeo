import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
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

const controlPlaneUrl = normalizeUrl(
  process.env.SINGULARITY_CONTROL_PLANE_URL || 'http://127.0.0.1:3001',
);
const rendererDevUrl = normalizeUrl(process.env.SINGULARITY_ELECTRON_DEV_SERVER_URL || '');
const startupRouteHash = normalizeStartupRoute(
  process.env.SINGULARITY_ELECTRON_START_ROUTE || '',
);

let mainWindow = null;
let localWorker = null;
const pendingWorkerRequests = new Map();
const cancelledStreamIds = new Set();

const DEFAULT_WORKER_TIMEOUT_MS = 45_000;
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
      const pending = pendingWorkerRequests.get(message.requestId);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      pendingWorkerRequests.delete(message.requestId);

      if (message.streamId) {
        cancelledStreamIds.delete(message.streamId);
      }

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

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (rendererDevUrl) {
    const devRendererIsValid = await probeRendererUrl(rendererDevUrl, 2_500);
    if (devRendererIsValid) {
      const targetUrl =
        startupRouteHash && !rendererDevUrl.includes('#')
          ? `${rendererDevUrl.replace(/\/+$/, '')}/${startupRouteHash}`
          : rendererDevUrl;
      await mainWindow.loadURL(targetUrl);
      mainWindow.webContents.openDevTools({ mode: 'detach' });
      return;
    }

    console.warn(
      `Configured renderer URL ${rendererDevUrl} did not look like the Singularity renderer. Falling back to the packaged desktop build.`,
    );
  }

  const rendererIssue = detectDesktopRendererIssue();
  if (rendererIssue) {
    await loadStartupIssuePage(rendererIssue);
    return;
  }

  const packagedRendererUrl = pathToFileURL(
    path.join(projectRoot, 'dist', 'index.html'),
  ).toString();
  await mainWindow.loadURL(
    startupRouteHash ? `${packagedRendererUrl}${startupRouteHash}` : packagedRendererUrl,
  );
};

ipcMain.handle('desktop:get-shell-context', async () => createDesktopContext());
ipcMain.handle('desktop:worker:ping', async () =>
  requestWorker('worker:ping', {
    requestedAt: new Date().toISOString(),
  }),
);
ipcMain.handle('desktop:runtime:status', async () => requestWorker('runtime:status'));
ipcMain.handle('desktop:runtime:actor-context', async (_event, payload) =>
  requestWorker('runtime:actor-context', payload || {}),
);
ipcMain.handle('desktop:runtime:set-token', async (_event, payload) =>
  requestWorker('runtime:set-token', payload || {}),
);
ipcMain.handle('desktop:runtime:clear-token', async () =>
  requestWorker('runtime:clear-token'),
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
  if (payload?.streamId) {
    cancelledStreamIds.add(payload.streamId);
  }
  return { cancelled: true };
});

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
