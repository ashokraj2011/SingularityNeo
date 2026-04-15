import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const child = spawn(npmCommand, ['run', 'build'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DESKTOP_BUILD: 'true',
  },
});

child.on('exit', code => {
  process.exit(code ?? 0);
});
