import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type SandboxProfile =
  | 'workspace'
  | 'build'
  | 'test'
  | 'docs'
  | 'deploy';

export type SandboxExecutionResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  sandboxProfile: string;
  executionMode: 'docker' | 'local';
};

const DOCKER_PROFILE_IMAGES: Record<SandboxProfile, string> = {
  workspace: process.env.SINGULARITY_SANDBOX_IMAGE_WORKSPACE || 'alpine:3.20',
  build: process.env.SINGULARITY_SANDBOX_IMAGE_BUILD || 'node:20-bookworm-slim',
  test: process.env.SINGULARITY_SANDBOX_IMAGE_TEST || 'node:20-bookworm-slim',
  docs: process.env.SINGULARITY_SANDBOX_IMAGE_DOCS || 'node:20-bookworm-slim',
  deploy: process.env.SINGULARITY_SANDBOX_IMAGE_DEPLOY || 'node:20-bookworm-slim',
};

const previewError = (value: string) => value.replace(/\0/g, '').slice(0, 2000);

const runLocalProcess = async ({
  command,
  cwd,
  timeoutMs,
  profile,
}: {
  command: string[];
  cwd: string;
  timeoutMs: number;
  profile: SandboxProfile;
}): Promise<SandboxExecutionResult> => {
  const [file, ...args] = command;
  try {
    const result = await execFileAsync(file, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
    });
    return {
      exitCode: 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      sandboxProfile: `${profile}:local`,
      executionMode: 'local',
    };
  } catch (error) {
    const execError = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      exitCode: typeof execError.code === 'number' ? execError.code : 1,
      stdout: execError.stdout || '',
      stderr: execError.stderr || execError.message || '',
      sandboxProfile: `${profile}:local`,
      executionMode: 'local',
    };
  }
};

const dockerAvailable = async () => {
  try {
    await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], {
      timeout: 4000,
    });
    return true;
  } catch {
    return false;
  }
};

const runDockerProcess = async ({
  command,
  cwd,
  timeoutMs,
  workspacePath,
  profile,
}: {
  command: string[];
  cwd: string;
  timeoutMs: number;
  workspacePath: string;
  profile: SandboxProfile;
}): Promise<SandboxExecutionResult> => {
  const relativeCwd = path.relative(workspacePath, cwd) || '.';
  const containerCwd = path.posix.join('/workspace', relativeCwd.replace(/\\/g, '/'));
  const image = DOCKER_PROFILE_IMAGES[profile];
  const dockerArgs = [
    'run',
    '--rm',
    '--network',
    'none',
    '--memory',
    process.env.SINGULARITY_SANDBOX_MEMORY || '1024m',
    '--cpus',
    process.env.SINGULARITY_SANDBOX_CPUS || '1.5',
    '-v',
    `${workspacePath}:/workspace:rw`,
    '-w',
    containerCwd,
    image,
    ...command,
  ];

  try {
    const result = await execFileAsync('docker', dockerArgs, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 8,
    });
    return {
      exitCode: 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      sandboxProfile: `${profile}:docker`,
      executionMode: 'docker',
    };
  } catch (error) {
    const execError = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      exitCode: typeof execError.code === 'number' ? execError.code : 1,
      stdout: execError.stdout || '',
      stderr: execError.stderr || execError.message || '',
      sandboxProfile: `${profile}:docker`,
      executionMode: 'docker',
    };
  }
};

export const runSandboxedCommand = async ({
  command,
  cwd,
  workspacePath,
  profile,
  timeoutMs = 120000,
}: {
  command: string[];
  cwd: string;
  workspacePath: string;
  profile: SandboxProfile;
  timeoutMs?: number;
}) => {
  if (command.length === 0) {
    throw new Error('Sandbox runner requires a non-empty command.');
  }

  const preferredMode = process.env.SINGULARITY_SANDBOX_MODE || 'docker';
  if (preferredMode !== 'local' && (await dockerAvailable())) {
    return runDockerProcess({
      command,
      cwd,
      workspacePath,
      profile,
      timeoutMs,
    });
  }

  return runLocalProcess({
    command,
    cwd,
    timeoutMs,
    profile,
  });
};

export const summarizeSandboxFailure = (stderr: string, stdout: string) =>
  previewError(stderr || stdout || 'Unknown sandbox execution error.');
