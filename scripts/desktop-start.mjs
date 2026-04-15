import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve(process.cwd());
const stateDir = path.join(projectRoot, '.singularity');
const pidFile = path.join(stateDir, 'desktop-dev.pid');
const logFile = path.join(stateDir, 'desktop-dev.log');

const ensureStateDir = () => {
  fs.mkdirSync(stateDir, { recursive: true });
};

const readExistingPid = () => {
  try {
    const value = fs.readFileSync(pidFile, 'utf8').trim();
    return value ? Number(value) : null;
  } catch {
    return null;
  }
};

const isProcessAlive = pid => {
  if (!pid || !Number.isFinite(pid)) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

ensureStateDir();

const existingPid = readExistingPid();
if (isProcessAlive(existingPid)) {
  console.log(`Singularity desktop dev is already running with PID ${existingPid}.`);
  console.log(`Log file: ${logFile}`);
  process.exit(0);
}

const logStream = fs.openSync(logFile, 'a');
const child = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'electron-dev.mjs')], {
  cwd: projectRoot,
  detached: true,
  stdio: ['ignore', logStream, logStream],
  env: {
    ...process.env,
    SINGULARITY_PROJECT_ROOT: projectRoot,
  },
});

child.unref();

fs.writeFileSync(pidFile, `${child.pid}\n`, 'utf8');

console.log(`Started Singularity desktop dev in the background.`);
console.log(`PID: ${child.pid}`);
console.log(`Log file: ${logFile}`);
console.log(`Stop it with: npm run desktop:down`);
