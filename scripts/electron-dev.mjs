import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronCommand = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
);

const devServerUrl = process.env.SINGULARITY_ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3000';
const controlPlaneUrl = process.env.SINGULARITY_CONTROL_PLANE_URL || 'http://127.0.0.1:3001';

let isShuttingDown = false;

const waitForUrl = (url, timeoutMs = 120_000) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const attempt = () => {
      const request = http.get(url, response => {
        response.resume();
        if ((response.statusCode || 500) < 500) {
          resolve(undefined);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 1000);
      });

      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 1000);
      });
    };

    attempt();
  });

const devProcess = spawn(npmCommand, ['run', 'dev:web'], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

let electronProcess = null;

const shutdown = (signal = 'SIGTERM') => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill(signal);
  }
  if (!devProcess.killed) {
    devProcess.kill(signal);
  }
};

const startElectron = async () => {
  await waitForUrl(devServerUrl);
  await waitForUrl(`${controlPlaneUrl}/api/state`);

  electronProcess = spawn(electronCommand, ['.'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      SINGULARITY_ELECTRON_DEV_SERVER_URL: devServerUrl,
      SINGULARITY_CONTROL_PLANE_URL: controlPlaneUrl,
    },
  });

  electronProcess.on('exit', code => {
    if (!isShuttingDown) {
      shutdown();
      process.exit(code ?? 0);
    }
  });
};

devProcess.on('exit', code => {
  if (!isShuttingDown) {
    shutdown();
    process.exit(code ?? 0);
  }
});

process.on('SIGINT', () => {
  shutdown('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
  process.exit(0);
});

startElectron().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  shutdown();
  process.exit(1);
});
