import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { probeHttpSuccessUrl, probeRendererUrl } from '../desktop/rendererProbe.mjs';

const projectRoot = process.cwd();
const electronCommand = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
);

const devServerUrl = process.env.SINGULARITY_ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3200';
const controlPlaneUrl = process.env.SINGULARITY_CONTROL_PLANE_URL || 'http://127.0.0.1:3001';

const inspectDesktopRendererBuild = () => {
  const distIndexPath = path.join(projectRoot, 'dist', 'index.html');
  if (!fs.existsSync(distIndexPath)) {
    return {
      code: 'missing',
      ready: false,
      message:
        'No desktop renderer build was found. Run `npm run desktop:build` for a packaged renderer, or use `npm run dev` for the live desktop app.',
    };
  }

  const html = fs.readFileSync(distIndexPath, 'utf8');
  if (/src="\/assets\//.test(html) || /href="\/assets\//.test(html)) {
    return {
      code: 'web-build',
      ready: false,
      message:
        'The current dist/ renderer was built for the web (`npm run build`), so Electron will open a blank screen from file://. Run `npm run desktop:build` or start the live dev stack with `npm run dev`.',
    };
  }

  return {
    code: 'ready',
    ready: true,
    message: 'Using the packaged desktop renderer from dist/.',
  };
};

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const runDesktopBuild = () =>
  new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ['run', 'desktop:build'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve(true);
        return;
      }
      reject(new Error(`Desktop renderer build failed with code ${code ?? 'unknown'}.`));
    });
  });

const main = async () => {
  const env = { ...process.env };
  if (!env.SINGULARITY_ELECTRON_START_ROUTE) {
    env.SINGULARITY_ELECTRON_START_ROUTE = '/home';
  }
  const devServerIsReady = await probeRendererUrl(devServerUrl);
  const controlPlaneIsReady = await probeHttpSuccessUrl(
    `${controlPlaneUrl}/api/runtime/status`,
  );

  if (devServerIsReady) {
    env.SINGULARITY_ELECTRON_DEV_SERVER_URL = devServerUrl;
    env.SINGULARITY_CONTROL_PLANE_URL = controlPlaneUrl;
    console.log(`Using live renderer at ${devServerUrl}.`);
    if (!controlPlaneIsReady) {
      console.warn(
        `Backend did not respond at ${controlPlaneUrl}. The window will open, but data-backed features may fail until the API is running.`,
      );
    }
  } else {
    console.log(
      `No Singularity renderer responded at ${devServerUrl}. Falling back to the packaged renderer in dist/.`,
    );
    let rendererBuild = inspectDesktopRendererBuild();
    if (!rendererBuild.ready) {
      console.log(rendererBuild.message);
      console.log('Rebuilding the desktop renderer for Electron...');
      await runDesktopBuild();
      rendererBuild = inspectDesktopRendererBuild();
    }
    console.log(rendererBuild.message);
    if (!rendererBuild.ready) {
      throw new Error(
        'Desktop renderer is still not Electron-safe after rebuilding. Start the live stack with `npm run dev` or inspect the packaged build output.',
      );
    }
    if (!controlPlaneIsReady) {
      console.warn(
        `Backend did not respond at ${controlPlaneUrl}. The packaged window can open, but the app will not fully function until the API is running.`,
      );
    } else {
      env.SINGULARITY_CONTROL_PLANE_URL = controlPlaneUrl;
    }
  }

  const child = spawn(electronCommand, ['.'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
  });

  child.on('exit', code => {
    process.exit(code ?? 0);
  });
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
