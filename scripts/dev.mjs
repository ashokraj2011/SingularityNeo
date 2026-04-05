import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const cwd = process.cwd();
let isShuttingDown = false;

const children = [
  spawn(npmCommand, ['run', 'dev:server'], { cwd, stdio: 'inherit' }),
  spawn(npmCommand, ['run', 'dev:client'], { cwd, stdio: 'inherit' }),
];

const shutdown = (signal = 'SIGTERM') => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  children.forEach(child => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
};

children.forEach(child => {
  child.on('exit', code => {
    if (!isShuttingDown) {
      shutdown();
      process.exit(code ?? 0);
    }
  });
});

process.on('SIGINT', () => {
  shutdown('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
  process.exit(0);
});
