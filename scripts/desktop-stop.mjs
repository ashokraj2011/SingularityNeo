import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(process.cwd());
const stateDir = path.join(projectRoot, '.singularity');
const pidFile = path.join(stateDir, 'desktop-dev.pid');

const run = command => {
  try {
    return execSync(command, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
};

const readStoredPid = () => {
  try {
    const value = fs.readFileSync(pidFile, 'utf8').trim();
    return value ? Number(value) : null;
  } catch {
    return null;
  }
};

const killProcessGroup = pid => {
  if (!pid || !Number.isFinite(pid)) {
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Ignore stale pid values.
    }
  }
};

const killPids = pids => {
  const unique = [...new Set(pids.filter(Boolean))];
  if (!unique.length) {
    return;
  }

  try {
    execSync(`kill ${unique.join(' ')}`, {
      cwd: projectRoot,
      stdio: 'ignore',
    });
  } catch {
    // Processes may already be gone; that's fine for a stop script.
  }
};

killProcessGroup(readStoredPid());

const portPids = [3000, 3001]
  .flatMap(port => run(`lsof -ti tcp:${port}`).split('\n'))
  .map(value => value.trim())
  .filter(Boolean);

const electronPids = run('pgrep -af electron')
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)
  .filter(
    line =>
      line.includes(projectRoot) ||
      line.includes('scripts/electron-dev.mjs') ||
      line.includes('desktop/main.mjs'),
  )
  .map(line => line.split(/\s+/, 1)[0])
  .filter(Boolean);

killPids([...portPids, ...electronPids]);

try {
  fs.rmSync(pidFile, { force: true });
} catch {
  // Ignore pid-file cleanup issues during stop.
}

console.log('Stopped Singularity desktop dev processes for this workspace.');
