import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ProviderKey,
  RuntimeModelOption,
  RuntimeProviderConfig,
  RuntimeProviderValidationResult,
} from '../src/types';
import { estimateTokens, normalizeProviderForEstimate } from './execution/tokenEstimate';
import {
  AIDER_CLI_PROVIDER_KEY,
  CLAUDE_CODE_CLI_PROVIDER_KEY,
  CODEX_CLI_PROVIDER_KEY,
  isCliRuntimeProviderKey,
  resolveProviderDisplayName,
} from './providerRegistry';

export type RuntimeCliMessage = {
  role: 'developer' | 'system' | 'user' | 'assistant';
  content: string;
};

export type RuntimeCliInvocationResult = {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  responseId: string | null;
  createdAt: string;
  estimatedUsage: boolean;
  raw: {
    assistantMessage: null;
    usageEvent: null;
  };
};

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;

const trim = (value?: string | null) => String(value || '').trim();

const providerDefaultCommand: Record<ProviderKey, string> = {
  'github-copilot': '',
  'local-openai': '',
  'gemini': '',
  'custom-router': '',
  'claude-code-cli': 'claude',
  'codex-cli': 'codex',
  'aider-cli': 'aider',
};

const normalizeCliMessages = (messages: RuntimeCliMessage[]) =>
  messages
    .map(message => ({
      role: message.role,
      content: trim(message.content),
    }))
    .filter(message => message.content);

const buildCliPrompt = (messages: RuntimeCliMessage[]) => {
  const normalized = normalizeCliMessages(messages);
  const instructionBlocks = normalized
    .filter(message => message.role === 'developer' || message.role === 'system')
    .map(message =>
      `${message.role === 'developer' ? 'Developer instructions' : 'System instructions'}:\n${message.content}`,
    );
  const conversation = normalized.filter(
    message => message.role === 'assistant' || message.role === 'user',
  );

  const transcript = conversation
    .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}:\n${message.content}`)
    .join('\n\n');

  return [instructionBlocks.join('\n\n'), transcript].filter(Boolean).join('\n\n');
};

const resolveCliCommand = ({
  providerKey,
  config,
}: {
  providerKey: ProviderKey;
  config?: RuntimeProviderConfig | null;
}) => trim(config?.command) || providerDefaultCommand[providerKey];

const resolveCliModel = ({
  explicitModel,
  config,
}: {
  explicitModel?: string;
  config?: RuntimeProviderConfig | null;
}) => trim(explicitModel) || trim(config?.model) || '';

const toEstimatedUsage = ({
  providerKey,
  model,
  prompt,
  output,
}: {
  providerKey: ProviderKey;
  model?: string;
  prompt: string;
  output: string;
}) => {
  const estimateProvider = normalizeProviderForEstimate(providerKey, model);
  const promptTokens = estimateTokens(prompt, {
    provider: estimateProvider,
    model,
    kind: 'prose',
  });
  const completionTokens = estimateTokens(output, {
    provider: estimateProvider,
    model,
    kind: 'prose',
  });
  const totalTokens = promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd: Number((totalTokens * 0.000003).toFixed(4)),
  };
};

const resolveConfiguredWorkingMode = (config?: RuntimeProviderConfig | null) => {
  const normalized = trim(config?.workingMode);
  if (
    normalized === 'plan' ||
    normalized === 'read-only' ||
    normalized === 'workspace-write' ||
    normalized === 'danger-full-access'
  ) {
    return normalized;
  }
  return undefined;
};

const buildCodexExecArgs = ({
  commandPrompt,
  workingDirectory,
  model,
  config,
  outputPath,
}: {
  commandPrompt: string;
  workingDirectory: string;
  model?: string;
  config?: RuntimeProviderConfig | null;
  outputPath: string;
}) => {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--cd',
    workingDirectory,
    '--output-last-message',
    outputPath,
    '--ask-for-approval',
    'never',
    '--sandbox',
    resolveConfiguredWorkingMode(config) || 'read-only',
  ];

  const profile = trim(config?.profile);
  if (profile) {
    args.push('--profile', profile);
  }

  if (model) {
    args.push('--model', model);
  }

  args.push('-');
  return {
    args,
    stdin: commandPrompt,
  };
};

const buildClaudeExecArgs = ({
  commandPrompt,
  workingDirectory,
  model,
  config,
}: {
  commandPrompt: string;
  workingDirectory: string;
  model?: string;
  config?: RuntimeProviderConfig | null;
}) => {
  const args = ['-p', commandPrompt, '--cwd', workingDirectory];
  const configuredMode = resolveConfiguredWorkingMode(config);
  if (configuredMode === 'danger-full-access') {
    args.push('--permission-mode', 'bypassPermissions');
  } else if (configuredMode === 'workspace-write') {
    args.push('--permission-mode', 'acceptEdits');
  } else {
    args.push('--permission-mode', 'plan');
  }

  if (model) {
    args.push('--model', model);
  }

  return {
    args,
    stdin: '',
  };
};

const buildAiderExecArgs = ({
  commandPrompt,
  workingDirectory,
  model,
}: {
  commandPrompt: string;
  workingDirectory: string;
  model?: string;
}) => {
  const args = ['--message', commandPrompt, '--yes', '--no-pretty', '--read', workingDirectory];
  if (model) {
    args.push('--model', model);
  }
  return {
    args,
    stdin: '',
  };
};

const runCliProcess = async ({
  command,
  args,
  env,
  workingDirectory,
  stdin,
  timeoutMs,
  outputPath,
}: {
  command: string;
  args: string[];
  env?: Record<string, string>;
  workingDirectory: string;
  stdin?: string;
  timeoutMs?: number;
  outputPath?: string;
}) =>
  new Promise<{
    stdout: string;
    stderr: string;
    output: string;
  }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...(env || {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${timeoutMs || DEFAULT_TIMEOUT_MS}ms.`));
    }, timeoutMs || DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', error => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', async code => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `${command} exited with code ${code}.`,
          ),
        );
        return;
      }

      let output = stdout.trim();
      if (outputPath && fs.existsSync(outputPath)) {
        try {
          output = trim(await fs.promises.readFile(outputPath, 'utf8')) || output;
        } catch {
          // Keep stdout fallback when the output file cannot be read.
        }
      }

      resolve({ stdout, stderr, output });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });

export const listCliProviderModels = async ({
  providerKey,
  config,
}: {
  providerKey: ProviderKey;
  config?: RuntimeProviderConfig | null;
}): Promise<RuntimeModelOption[]> => {
  const configuredModel = trim(config?.model);
  if (!configuredModel) {
    return [];
  }

  return [
    {
      id: configuredModel,
      label: configuredModel,
      profile: `${resolveProviderDisplayName(providerKey)} configured model`,
      apiModelId: configuredModel,
    },
  ];
};

export const validateCliRuntimeProvider = async ({
  providerKey,
  config,
  workingDirectory,
}: {
  providerKey: ProviderKey;
  config?: RuntimeProviderConfig | null;
  workingDirectory?: string;
}): Promise<RuntimeProviderValidationResult> => {
  const command = resolveCliCommand({ providerKey, config });
  const transportMode = 'desktop-cli' as const;

  if (!isCliRuntimeProviderKey(providerKey)) {
    return {
      providerKey,
      ok: false,
      status: 'invalid',
      message: `${providerKey} is not a desktop CLI runtime provider.`,
      transportMode,
      checkedAt: new Date().toISOString(),
    };
  }

  if (!command) {
    return {
      providerKey,
      ok: false,
      status: 'missing',
      message: `Configure a command path for ${resolveProviderDisplayName(providerKey)}.`,
      transportMode,
      installed: false,
      authenticated: null,
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const versionResult = await execFileAsync(command, ['--version'], {
      cwd: workingDirectory || process.cwd(),
      env: {
        ...process.env,
        ...(config?.env || {}),
      },
      timeout: 15_000,
    });
    let authenticated: boolean | null = null;
    let authMessage = 'CLI binary started successfully.';

    if (providerKey === CODEX_CLI_PROVIDER_KEY) {
      try {
        const loginStatus = await execFileAsync(command, ['login', 'status'], {
          cwd: workingDirectory || process.cwd(),
          env: {
            ...process.env,
            ...(config?.env || {}),
          },
          timeout: 15_000,
        });
        authenticated = /logged in/i.test(`${loginStatus.stdout}\n${loginStatus.stderr}`);
        authMessage = authenticated
          ? 'CLI binary and local login session are valid.'
          : 'CLI binary is available, but login status could not be confirmed.';
      } catch {
        authenticated = false;
        authMessage = 'CLI binary is available, but local login status could not be confirmed.';
      }
    }

    const models = await listCliProviderModels({ providerKey, config });
    return {
      providerKey,
      ok: authenticated !== false,
      status: authenticated === false ? 'invalid' : 'configured',
      message: authMessage,
      transportMode,
      detectedCommand: command,
      installed: true,
      authenticated,
      workingDirectoryAllowed:
        workingDirectory !== undefined ? fs.existsSync(workingDirectory) : null,
      usageEstimated: true,
      models,
      details: [
        trim(versionResult.stdout) || trim(versionResult.stderr) || `${command} --version succeeded.`,
      ].filter(Boolean),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `${resolveProviderDisplayName(providerKey)} is unavailable.`;
    return {
      providerKey,
      ok: false,
      status: /ENOENT|not found/i.test(message) ? 'missing' : 'unavailable',
      message,
      transportMode,
      detectedCommand: command,
      installed: false,
      authenticated: null,
      workingDirectoryAllowed:
        workingDirectory !== undefined ? fs.existsSync(workingDirectory) : null,
      usageEstimated: true,
      checkedAt: new Date().toISOString(),
    };
  }
};

export const invokeCliRuntime = async ({
  providerKey,
  config,
  messages,
  workingDirectory,
  model,
  timeoutMs,
  onDelta,
}: {
  providerKey: ProviderKey;
  config?: RuntimeProviderConfig | null;
  messages: RuntimeCliMessage[];
  workingDirectory: string;
  model?: string;
  timeoutMs?: number;
  onDelta?: (delta: string) => void;
}): Promise<RuntimeCliInvocationResult> => {
  if (!isCliRuntimeProviderKey(providerKey)) {
    throw new Error(`${providerKey} is not a CLI runtime provider.`);
  }

  const command = resolveCliCommand({ providerKey, config });
  if (!command) {
    throw new Error(`Configure a command path for ${resolveProviderDisplayName(providerKey)} first.`);
  }

  const prompt = buildCliPrompt(messages);
  const resolvedModel = resolveCliModel({ explicitModel: model, config });
  const tempOutputPath = path.join(os.tmpdir(), `singularity-runtime-${randomUUID()}.txt`);

  const invocation =
    providerKey === CODEX_CLI_PROVIDER_KEY
      ? buildCodexExecArgs({
          commandPrompt: prompt,
          workingDirectory,
          model: resolvedModel,
          config,
          outputPath: tempOutputPath,
        })
      : providerKey === CLAUDE_CODE_CLI_PROVIDER_KEY
      ? buildClaudeExecArgs({
          commandPrompt: prompt,
          workingDirectory,
          model: resolvedModel,
          config,
        })
      : buildAiderExecArgs({
          commandPrompt: prompt,
          workingDirectory,
          model: resolvedModel,
        });

  const result = await runCliProcess({
    command,
    args: invocation.args,
    env: config?.env,
    workingDirectory,
    stdin: invocation.stdin,
    timeoutMs,
    outputPath: providerKey === CODEX_CLI_PROVIDER_KEY ? tempOutputPath : undefined,
  }).finally(async () => {
    if (fs.existsSync(tempOutputPath)) {
      await fs.promises.rm(tempOutputPath, { force: true }).catch(() => undefined);
    }
  });

  const content = trim(result.output);
  if (!content) {
    throw new Error(`${resolveProviderDisplayName(providerKey)} returned an empty response.`);
  }

  if (onDelta) {
    onDelta(content);
  }

  return {
    content,
    model: resolvedModel || resolveProviderDisplayName(providerKey),
    usage: toEstimatedUsage({
      providerKey,
      model: resolvedModel,
      prompt,
      output: content,
    }),
    responseId: null,
    createdAt: new Date().toISOString(),
    estimatedUsage: true,
    raw: {
      assistantMessage: null,
      usageEvent: null,
    },
  };
};
