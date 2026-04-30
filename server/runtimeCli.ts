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
  GITHUB_COPILOT_CLI_PROVIDER_KEY,
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

/**
 * Build an augmented PATH string that covers all common CLI tool install
 * locations on macOS and Linux.  When Singularity is launched as a desktop
 * app (Electron / npm run desktop:start) the process inherits a minimal
 * system PATH (/usr/bin:/bin:…) that does NOT include Homebrew, nvm, npm
 * global bins, or user-local installs.  Any `spawn('claude', …)` call would
 * fail with ENOENT even though `claude` is reachable from the user's terminal.
 *
 * Priority: user-configured env.PATH (if set) → standard macOS/Linux locations.
 */
const buildAugmentedPath = (extraEnv?: Record<string, string> | null): string => {
  const existing = extraEnv?.PATH || process.env.PATH || '';
  const homedir = os.homedir();

  const extraDirs = [
    // Homebrew — Apple Silicon
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    // Homebrew — Intel
    '/usr/local/bin',
    '/usr/local/sbin',
    // npm global (typical locations)
    path.join(homedir, '.npm-global', 'bin'),
    path.join(homedir, '.npm', 'bin'),
    // nvm (common version patterns)
    path.join(homedir, '.nvm', 'versions', 'node', 'current', 'bin'),
    // fnm / volta
    path.join(homedir, '.fnm', 'current', 'bin'),
    path.join(homedir, '.volta', 'bin'),
    // user-local
    path.join(homedir, '.local', 'bin'),
    // pyenv / pipx for aider
    path.join(homedir, '.pyenv', 'shims'),
    path.join(homedir, '.local', 'pipx', 'venvs', 'aider-chat', 'bin'),
    // Standard system bins
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].filter(Boolean);

  const parts = [
    ...extraDirs,
    ...existing.split(':').filter(Boolean),
  ];
  // Deduplicate while preserving first-wins order.
  return [...new Set(parts)].join(':');
};

/**
 * Resolve a short command name (e.g. "claude") to its full absolute path by
 * running `which` inside a login shell that has the augmented PATH.  Falls
 * back to the original command if resolution fails (e.g. it's already an
 * absolute path, or `which` is unavailable).
 */
const resolveCommandPath = async (
  command: string,
  extraEnv?: Record<string, string> | null,
): Promise<string> => {
  // Already absolute — nothing to do.
  if (path.isAbsolute(command)) return command;

  try {
    const augmentedPath = buildAugmentedPath(extraEnv);
    const result = await execFileAsync('which', [command], {
      env: { ...process.env, PATH: augmentedPath },
      timeout: 5_000,
    });
    const resolved = result.stdout.trim();
    if (resolved && path.isAbsolute(resolved)) {
      return resolved;
    }
  } catch {
    // `which` not available or command not found — fall through.
  }
  return command;
};

const trim = (value?: string | null) => String(value || '').trim();

const providerDefaultCommand: Record<ProviderKey, string> = {
  'github-copilot': '',
  'github-copilot-cli': 'gh-copilot',
  'local-openai': '',
  'gemini': '',
  'custom-router': '',
  'claude-code-cli': 'claude',
  'codex-cli': 'codex',
  'aider-cli': 'aider',
};

/**
 * Known Claude models available via the Claude Code CLI — cheapest first.
 * Haiku is the default because it is the fastest and most cost-effective.
 */
export const KNOWN_CLAUDE_CODE_MODELS = [
  { id: 'claude-haiku-3-5',          label: 'Claude 3.5 Haiku (cheapest)',   profile: 'Claude Code CLI', apiModelId: 'claude-haiku-3-5' },
  { id: 'claude-3-5-haiku-20241022',  label: 'Claude 3.5 Haiku (dated)',      profile: 'Claude Code CLI', apiModelId: 'claude-3-5-haiku-20241022' },
  { id: 'claude-sonnet-4-5',          label: 'Claude Sonnet 4.5',             profile: 'Claude Code CLI', apiModelId: 'claude-sonnet-4-5' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (dated)',     profile: 'Claude Code CLI', apiModelId: 'claude-3-5-sonnet-20241022' },
  { id: 'claude-opus-4-5',            label: 'Claude Opus 4.5 (most capable)', profile: 'Claude Code CLI', apiModelId: 'claude-opus-4-5' },
  { id: 'claude-3-opus-20240229',     label: 'Claude 3 Opus (dated)',         profile: 'Claude Code CLI', apiModelId: 'claude-3-opus-20240229' },
];

/**
 * Known models exposed by the GitHub Copilot CLI.  The CLI itself routes the
 * actual model selection internally, so these are mostly informational labels
 * shown in the Agents screen — pick the cheapest gpt-4.1-mini as default.
 */
export const KNOWN_COPILOT_CLI_MODELS = [
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini (cheapest)', profile: 'GitHub Copilot CLI', apiModelId: 'gpt-4.1-mini' },
  { id: 'gpt-4.1',      label: 'GPT-4.1',                  profile: 'GitHub Copilot CLI', apiModelId: 'gpt-4.1' },
  { id: 'gpt-4o',       label: 'GPT-4o',                   profile: 'GitHub Copilot CLI', apiModelId: 'gpt-4o' },
  { id: 'gpt-4o-mini',  label: 'GPT-4o mini',              profile: 'GitHub Copilot CLI', apiModelId: 'gpt-4o-mini' },
];

/** Cheapest/default model for each CLI provider. */
const providerDefaultModel: Partial<Record<ProviderKey, string>> = {
  'claude-code-cli': 'claude-haiku-3-5',
  'github-copilot-cli': 'gpt-4.1-mini',
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
  providerKey,
}: {
  explicitModel?: string;
  config?: RuntimeProviderConfig | null;
  providerKey?: ProviderKey;
}) =>
  trim(explicitModel) ||
  trim(config?.model) ||
  (providerKey ? providerDefaultModel[providerKey] ?? '' : '') ||
  '';

/**
 * Return true only if `model` is a valid model identifier for the given CLI
 * provider.  Agents store the model they were created with, which may come
 * from a completely different provider (e.g. 'gpt-4.1-mini' from github-copilot,
 * 'openrouter/free' from custom-router).  Passing those to a CLI binary that
 * doesn't recognise them causes a hard error — better to let the CLI use its
 * own default.
 */
const isModelValidForCli = (providerKey: ProviderKey, model: string): boolean => {
  if (!model) return false;
  if (providerKey === CLAUDE_CODE_CLI_PROVIDER_KEY) {
    // claude CLI only accepts Claude model names
    return /^claude[-/]/i.test(model);
  }
  if (providerKey === CODEX_CLI_PROVIDER_KEY) {
    // codex CLI uses OpenAI model names — reject vendor-prefixed router IDs
    return !/\//.test(model) && !/^claude/i.test(model) && !/^gemini/i.test(model);
  }
  if (providerKey === GITHUB_COPILOT_CLI_PROVIDER_KEY) {
    // gh-copilot routes the model internally — accept gpt-* style ids only.
    return /^gpt-/i.test(model);
  }
  // aider is permissive — accept anything
  return true;
};

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

  if (model && isModelValidForCli(CODEX_CLI_PROVIDER_KEY, model)) {
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
  // Working directory is set via cwd: in spawn options — not a CLI flag.
  const args = ['-p', commandPrompt];
  const configuredMode = resolveConfiguredWorkingMode(config);
  if (configuredMode === 'danger-full-access') {
    args.push('--permission-mode', 'bypassPermissions');
  } else if (configuredMode === 'workspace-write') {
    args.push('--permission-mode', 'acceptEdits');
  } else {
    args.push('--permission-mode', 'plan');
  }

  // Only pass --model when the name is actually a Claude model.
  // Agents may carry a stale model from a different provider (e.g. 'gpt-4.1-mini').
  if (model && isModelValidForCli(CLAUDE_CODE_CLI_PROVIDER_KEY, model)) {
    args.push('--model', model);
  }

  return {
    args,
    stdin: '',
  };
};

const buildCopilotCliExecArgs = ({
  commandPrompt,
  model,
  config,
}: {
  commandPrompt: string;
  workingDirectory: string;
  model?: string;
  config?: RuntimeProviderConfig | null;
}) => {
  // The `gh copilot` extension takes the prompt either via stdin or as a
  // positional argument on `gh copilot suggest`.  We pass the prompt on
  // stdin (works for both `gh-copilot` direct binary and the `gh copilot
  // suggest` subcommand spelling) and let the binary pick its own model.
  // Most installs only accept `--target` / `--shell`, so we keep the args
  // surface minimal and pass-through model only when explicitly compatible.
  const args: string[] = ['suggest', '--target', 'shell'];

  if (model && isModelValidForCli(GITHUB_COPILOT_CLI_PROVIDER_KEY, model)) {
    // No native --model flag — surfaced as env var the upstream CLI honours.
    // Caller may also set this in `config.env` if they want full control.
    args.unshift(`--model=${model}`);
  }

  // Re-route depending on the configured profile (advanced users may set
  // `config.profile` to `"explain"` to call the explain subcommand instead).
  const profile = trim(config?.profile);
  if (profile === 'explain') {
    args[0] = 'explain';
  }

  return {
    args,
    stdin: commandPrompt,
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
        PATH: buildAugmentedPath(env),
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
  // For Claude Code CLI we always expose the full known model list so the
  // Agents screen can show a populated dropdown even before the operator has
  // explicitly configured a model.  Haiku comes first because it is the
  // cheapest and is the recommended default.
  if (providerKey === CLAUDE_CODE_CLI_PROVIDER_KEY) {
    return KNOWN_CLAUDE_CODE_MODELS;
  }

  if (providerKey === GITHUB_COPILOT_CLI_PROVIDER_KEY) {
    return KNOWN_COPILOT_CLI_MODELS;
  }

  // For other CLIs fall back to whatever is configured (single entry) or empty.
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

  // Resolve the command to its absolute path so execFile/spawn don't fail
  // with ENOENT when the Electron process has a limited system PATH.
  const resolvedCommand = await resolveCommandPath(command, config?.env);

  try {
    const spawnEnv = {
      ...process.env,
      ...(config?.env || {}),
      PATH: buildAugmentedPath(config?.env),
    };
    const versionResult = await execFileAsync(resolvedCommand, ['--version'], {
      cwd: workingDirectory || process.cwd(),
      env: spawnEnv,
      timeout: 15_000,
    });
    let authenticated: boolean | null = null;
    let authMessage = 'CLI binary started successfully.';

    if (providerKey === CODEX_CLI_PROVIDER_KEY) {
      try {
        const loginStatus = await execFileAsync(resolvedCommand, ['login', 'status'], {
          cwd: workingDirectory || process.cwd(),
          env: spawnEnv,
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
      detectedCommand: resolvedCommand,
      installed: true,
      authenticated,
      workingDirectoryAllowed:
        workingDirectory !== undefined ? fs.existsSync(workingDirectory) : null,
      usageEstimated: true,
      models,
      details: [
        trim(versionResult.stdout) || trim(versionResult.stderr) || `${resolvedCommand} --version succeeded.`,
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
      message: /ENOENT/i.test(message)
        ? `Cannot find '${command}' — install it and run Validate to confirm the path. Checked in: ${buildAugmentedPath(config?.env).split(':').slice(0, 6).join(', ')}…`
        : message,
      transportMode,
      detectedCommand: resolvedCommand,
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

  // Resolve the short command name to its absolute path before spawning.
  // Electron processes inherit a minimal system PATH that omits Homebrew,
  // npm globals, and user-local bins — resolveCommandPath bridges that gap.
  const resolvedCommand = await resolveCommandPath(command, config?.env);

  const prompt = buildCliPrompt(messages);
  const resolvedModel = resolveCliModel({ explicitModel: model, config, providerKey });
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
      : providerKey === GITHUB_COPILOT_CLI_PROVIDER_KEY
      ? buildCopilotCliExecArgs({
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
    command: resolvedCommand,
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
