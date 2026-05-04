import path from 'node:path';
import { spawn } from 'node:child_process';
import { probeHttpSuccessUrl, probeRendererUrl } from '../desktop/rendererProbe.mjs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronCommand = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
);

const devServerUrl =
  process.env.SINGULARITY_ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3200';
const controlPlaneUrl = process.env.SINGULARITY_CONTROL_PLANE_URL || 'http://127.0.0.1:3001';

let isShuttingDown = false;

const waitForCondition = (predicate, timeoutLabel, timeoutMs = 120_000) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const attempt = async () => {
      const ready = await predicate().catch(() => false);
      if (ready) {
        resolve(undefined);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${timeoutLabel}`));
        return;
      }

      setTimeout(() => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${timeoutLabel}`));
        } else {
          void attempt();
        }
      }, 1000);
    };

    void attempt();
  });

const devProcess = spawn(npmCommand, ['run', 'dev:web'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    SINGULARITY_ELECTRON_DEV_SERVER_URL: devServerUrl,
    SINGULARITY_CONTROL_PLANE_URL: controlPlaneUrl,
  },
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
  console.log(`[desktop:dev] Waiting for renderer at ${devServerUrl} ...`);
  await waitForCondition(
    () => probeRendererUrl(devServerUrl),
    `Singularity renderer at ${devServerUrl}`,
  );
  console.log(`[desktop:dev] Renderer ready at ${devServerUrl}. Waiting for control plane at ${controlPlaneUrl} ...`);
  await waitForCondition(
    () => probeHttpSuccessUrl(`${controlPlaneUrl}/api/state`),
    `control plane at ${controlPlaneUrl}/api/state`,
  );
  console.log('[desktop:dev] Control plane is ready. Launching Electron...');

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
