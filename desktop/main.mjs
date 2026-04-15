import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import dotenv from 'dotenv';

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

const controlPlaneUrl = normalizeUrl(
  process.env.SINGULARITY_CONTROL_PLANE_URL || 'http://127.0.0.1:3001',
);
const rendererDevUrl = normalizeUrl(process.env.SINGULARITY_ELECTRON_DEV_SERVER_URL || '');

let mainWindow = null;
let localWorker = null;
const pendingWorkerRequests = new Map();
const cancelledStreamIds = new Set();

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

const requestWorker = (type, payload = {}) =>
  new Promise((resolve, reject) => {
    if (!localWorker?.stdin || localWorker.killed) {
      reject(new Error('Local worker is not available.'));
      return;
    }

    const requestId = randomUUID();
    const timeout = setTimeout(() => {
      pendingWorkerRequests.delete(requestId);
      reject(new Error(`Worker request timed out: ${type}`));
    }, 45_000);

    pendingWorkerRequests.set(requestId, {
      resolve,
      reject,
      timeout,
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
    await mainWindow.loadURL(rendererDevUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  await mainWindow.loadFile(path.join(projectRoot, 'dist', 'index.html'));
};

ipcMain.handle('desktop:get-shell-context', async () => createDesktopContext());
ipcMain.handle('desktop:worker:ping', async () =>
  requestWorker('worker:ping', {
    requestedAt: new Date().toISOString(),
  }),
);
ipcMain.handle('desktop:runtime:status', async () => requestWorker('runtime:status'));
ipcMain.handle('desktop:runtime:set-token', async (_event, payload) =>
  requestWorker('runtime:set-token', payload || {}),
);
ipcMain.handle('desktop:runtime:clear-token', async () =>
  requestWorker('runtime:clear-token'),
);
ipcMain.handle('desktop:runtime:chat', async (_event, payload) =>
  requestWorker('runtime:chat', payload || {}),
);
ipcMain.handle('desktop:runtime:chat-stream', async (_event, payload) => {
  const streamId = payload?.streamId || randomUUID();
  cancelledStreamIds.delete(streamId);
  return requestWorker('runtime:chat-stream', {
    ...(payload || {}),
    streamId,
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
