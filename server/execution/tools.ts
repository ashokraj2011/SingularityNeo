import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  Capability,
  CapabilityAgent,
  CapabilityExecutionCommandTemplate,
  ToolAdapterId,
} from '../../src/types';
import { runSandboxedCommand, type SandboxProfile, summarizeSandboxFailure } from '../sandbox';
import {
  findApprovedWorkspaceRoot,
  formatApprovedWorkspaceRoots,
  getCapabilityWorkspaceRoots,
  normalizeDirectoryPath,
} from '../workspacePaths';

const execFileAsync = promisify(execFile);

export type ToolExecutionResult = {
  summary: string;
  details?: Record<string, unknown>;
  workingDirectory?: string;
  exitCode?: number;
  stdoutPreview?: string;
  stderrPreview?: string;
  sandboxProfile?: string;
};

type ToolExecutionContext = {
  capability: Capability;
  agent: CapabilityAgent;
  requireApprovedDeployment?: boolean;
};

type ToolAdapter = {
  id: ToolAdapterId;
  description: string;
  retryable: boolean;
  execute: (
    context: ToolExecutionContext,
    args: Record<string, any>,
  ) => Promise<ToolExecutionResult>;
};

const previewText = (value: string, limit = 1600) =>
  value.replace(/\0/g, '').slice(0, limit);

const describeDeploymentTargets = (
  targets: Capability['executionConfig']['deploymentTargets'],
) => targets.map(target => `${target.id} -> ${target.commandTemplateId}`).join(', ');

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const isCommandMissing = (result: { stderr?: string; stdout?: string }) =>
  /spawn\s+\S+\s+ENOENT/i.test(`${result.stderr || ''}\n${result.stdout || ''}`);

const listWorkspaceFilesFallback = async (
  workspacePath: string,
  limit = 200,
) => {
  const files: string[] = [];

  const visit = async (currentPath: string, depth: number): Promise<void> => {
    if (files.length >= limit || depth > 5) {
      return;
    }

    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= limit) {
        return;
      }

      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(workspacePath, absolutePath);

      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath, depth + 1);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };

  await visit(workspacePath, 0);
  return files;
};

const searchWorkspaceFilesFallback = async ({
  workspacePath,
  scopePath,
  pattern,
  limit = 100,
}: {
  workspacePath: string;
  scopePath: string;
  pattern: string;
  limit?: number;
}) => {
  const stat = await fs.stat(scopePath).catch(() => null);
  const searchRoot = stat?.isDirectory() ? scopePath : path.dirname(scopePath);
  const scopedFiles = stat?.isFile()
    ? [path.relative(workspacePath, scopePath)]
    : await listWorkspaceFilesFallback(searchRoot, 500);
  const matcher = (() => {
    try {
      return new RegExp(pattern, 'i');
    } catch {
      const loweredPattern = pattern.toLowerCase();
      return {
        test: (value: string) => value.toLowerCase().includes(loweredPattern),
      };
    }
  })();
  const matches: string[] = [];

  for (const relativeFile of scopedFiles) {
    if (matches.length >= limit) {
      break;
    }

    const absoluteFile = stat?.isFile()
      ? scopePath
      : path.join(searchRoot, relativeFile);
    const displayPath = path.relative(workspacePath, absoluteFile);
    let content = '';

    try {
      const fileStat = await fs.stat(absoluteFile);
      if (fileStat.size > 200_000) {
        continue;
      }
      content = await fs.readFile(absoluteFile, 'utf8');
    } catch {
      continue;
    }

    content.split('\n').some((line, index) => {
      if (!matcher.test(line)) {
        return false;
      }

      matches.push(`${displayPath}:${index + 1}:${line}`);
      return matches.length >= limit;
    });
  }

  return matches;
};

const resolveWorkspacePath = (
  capability: Capability,
  preferredPath?: string,
) => {
  const allowed = getCapabilityWorkspaceRoots(capability);
  const configuredDefault = normalizeDirectoryPath(
    capability.executionConfig.defaultWorkspacePath || '',
  );
  const defaultPath = configuredDefault || allowed[0] || '';
  const requestedPath = normalizeDirectoryPath(preferredPath || '');
  const candidate = requestedPath || defaultPath;

  if (!candidate) {
    throw new Error(
      `Capability ${capability.name} does not have an approved local workspace path configured.`,
    );
  }

  if (!findApprovedWorkspaceRoot(candidate, allowed)) {
    if (requestedPath && allowed.length === 1) {
      return allowed[0];
    }

    throw new Error(
      `Workspace path ${candidate} is not approved for capability ${capability.name}. Approved workspace roots: ${formatApprovedWorkspaceRoots(allowed)}.`,
    );
  }

  return candidate;
};

const resolvePathWithinWorkspace = (
  workspacePath: string,
  filePath: string,
) => {
  const nextPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workspacePath, filePath);

  const relative = path.relative(workspacePath, nextPath);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path ${filePath} escapes the approved workspace root.`);
  }

  return nextPath;
};

const runProcess = async (
  file: string,
  args: string[],
  cwd: string,
) => {
  try {
    const result = await execFileAsync(file, args, { cwd, maxBuffer: 1024 * 1024 * 8 });
    return {
      exitCode: 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  } catch (error) {
    const execError = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      exitCode:
        typeof execError.code === 'number' ? execError.code : 1,
      stdout: execError.stdout || '',
      stderr: execError.stderr || execError.message || '',
    };
  }
};

const resolveCommandTemplate = (
  capability: Capability,
  templateId: string,
): CapabilityExecutionCommandTemplate => {
  const template = capability.executionConfig.commandTemplates.find(
    item => item.id === templateId,
  );
  if (!template) {
    throw new Error(
      `Capability ${capability.name} does not define the ${templateId} command template.`,
    );
  }
  if (!Array.isArray(template.command) || template.command.length === 0) {
    throw new Error(`Command template ${templateId} is not configured correctly.`);
  }
  return template;
};

export const resolveDeploymentTarget = (
  capability: Capability,
  requestedTargetId?: string,
) => {
  const targets = capability.executionConfig.deploymentTargets || [];
  const targetId = String(requestedTargetId || '').trim();

  if (targets.length === 0) {
    throw new Error(
      `Capability ${capability.name} does not define any deployment targets.`,
    );
  }

  if (!targetId) {
    if (targets.length === 1) {
      return targets[0];
    }

    throw new Error(
      `run_deploy requires a deployment target id. Available deployment targets: ${describeDeploymentTargets(targets)}.`,
    );
  }

  const exactMatch = targets.find(item => item.id === targetId);
  if (exactMatch) {
    return exactMatch;
  }

  const templateMatches = targets.filter(
    item => item.commandTemplateId === targetId,
  );
  if (templateMatches.length === 1) {
    return templateMatches[0];
  }

  if (targets.length === 1) {
    return targets[0];
  }

  throw new Error(
    `Capability ${capability.name} does not define deployment target ${targetId}. Available deployment targets: ${describeDeploymentTargets(targets)}.`,
  );
};

const executeCommandTemplate = async (
  capability: Capability,
  template: CapabilityExecutionCommandTemplate,
  workspacePath?: string,
  sandboxProfile: SandboxProfile = 'workspace',
) => {
  const workingDirectory = template.workingDirectory
    ? resolveWorkspacePath(capability, template.workingDirectory)
    : resolveWorkspacePath(capability, workspacePath);
  const result = await runSandboxedCommand({
    command: template.command,
    cwd: workingDirectory,
    workspacePath: workingDirectory,
    profile: sandboxProfile,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${template.label} failed in ${workingDirectory}: ${
        summarizeSandboxFailure(result.stderr, result.stdout)
      }`,
    );
  }

  return {
    summary: `${template.label} completed successfully.`,
    workingDirectory,
    exitCode: result.exitCode,
    stdoutPreview: previewText(result.stdout),
    stderrPreview: previewText(result.stderr),
    sandboxProfile: result.sandboxProfile,
    details: {
      command: template.command,
      templateId: template.id,
      executionMode: result.executionMode,
    },
  } satisfies ToolExecutionResult;
};

const TOOL_REGISTRY: Record<ToolAdapterId, ToolAdapter> = {
  workspace_list: {
    id: 'workspace_list',
    description: 'List files inside an approved workspace path.',
    retryable: true,
    execute: async ({ capability }, args) => {
      const workspacePath = resolveWorkspacePath(capability, args.workspacePath || args.path);
      const result = await runProcess('rg', ['--files', workspacePath], workspacePath);
      const files = result.exitCode === 0
        ? result.stdout.split('\n').filter(Boolean).slice(0, 200)
        : isCommandMissing(result)
          ? await listWorkspaceFilesFallback(workspacePath)
          : [];

      if (result.exitCode !== 0 && !isCommandMissing(result)) {
        throw new Error(
          `Unable to list files in ${workspacePath}: ${previewText(result.stderr || result.stdout)}`,
        );
      }

      return {
        summary: `Listed ${files.length} files from ${workspacePath}.`,
        workingDirectory: workspacePath,
        stdoutPreview: previewText(files.join('\n')),
        details: {
          files,
          fallback: result.exitCode !== 0 ? 'node-filesystem' : undefined,
        },
      };
    },
  },
  workspace_read: {
    id: 'workspace_read',
    description: 'Read a text file from an approved workspace path.',
    retryable: true,
    execute: async ({ capability }, args) => {
      const workspacePath = resolveWorkspacePath(capability, args.workspacePath);
      const targetPath = resolvePathWithinWorkspace(workspacePath, String(args.path || ''));
      const maxBytes = Math.max(256, Math.min(Number(args.maxBytes || 8000), 20000));
      const content = await fs.readFile(targetPath, 'utf8');

      return {
        summary: `Read ${path.relative(workspacePath, targetPath)}.`,
        workingDirectory: workspacePath,
        stdoutPreview: previewText(content, maxBytes),
        details: {
          path: targetPath,
          truncated: content.length > maxBytes,
        },
      };
    },
  },
  workspace_search: {
    id: 'workspace_search',
    description: 'Search within an approved workspace for a string or regex pattern.',
    retryable: true,
    execute: async ({ capability }, args) => {
      const pattern = String(args.pattern || '').trim();
      if (!pattern) {
        throw new Error('workspace_search requires a pattern.');
      }

      const workspacePath = resolveWorkspacePath(capability, args.workspacePath);
      const scopePath = args.path
        ? resolvePathWithinWorkspace(workspacePath, String(args.path))
        : workspacePath;
      const result = await runProcess('rg', ['-n', pattern, scopePath], workspacePath);
      const matches = isCommandMissing(result)
        ? await searchWorkspaceFilesFallback({ workspacePath, scopePath, pattern })
        : [];
      const output = isCommandMissing(result)
        ? matches.join('\n')
        : result.stdout || result.stderr;

      return {
        summary:
          result.exitCode === 0 || matches.length > 0
            ? `Search completed for pattern ${pattern}.`
            : `Search found no matches for pattern ${pattern}.`,
        workingDirectory: workspacePath,
        exitCode: isCommandMissing(result) ? (matches.length > 0 ? 0 : 1) : result.exitCode,
        stdoutPreview: previewText(output),
        details: {
          pattern,
          scopePath,
          fallback: isCommandMissing(result) ? 'node-filesystem' : undefined,
        },
      };
    },
  },
  git_status: {
    id: 'git_status',
    description: 'Inspect git status for an approved workspace repository.',
    retryable: true,
    execute: async ({ capability }, args) => {
      const workspacePath = resolveWorkspacePath(capability, args.workspacePath);
      const result = await runProcess(
        'git',
        ['-C', workspacePath, 'status', '--short', '--branch'],
        workspacePath,
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `git status failed in ${workspacePath}: ${previewText(result.stderr || result.stdout)}`,
        );
      }

      return {
        summary: `Loaded git status for ${workspacePath}.`,
        workingDirectory: workspacePath,
        stdoutPreview: previewText(result.stdout),
      };
    },
  },
  workspace_write: {
    id: 'workspace_write',
    description: 'Write a text file inside an approved workspace path.',
    retryable: false,
    execute: async ({ capability }, args) => {
      const workspacePath = resolveWorkspacePath(capability, args.workspacePath);
      const targetPath = resolvePathWithinWorkspace(workspacePath, String(args.path || ''));
      const content = String(args.content || '');
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, 'utf8');

      return {
        summary: `Wrote ${path.relative(workspacePath, targetPath)}.`,
        workingDirectory: workspacePath,
        details: {
          path: targetPath,
          bytesWritten: Buffer.byteLength(content, 'utf8'),
        },
      };
    },
  },
  run_build: {
    id: 'run_build',
    description: 'Run the approved build command template.',
    retryable: true,
    execute: async ({ capability }, args) =>
      executeCommandTemplate(
        capability,
        resolveCommandTemplate(capability, String(args.templateId || 'build')),
        args.workspacePath,
        'build',
      ),
  },
  run_test: {
    id: 'run_test',
    description: 'Run the approved test command template.',
    retryable: true,
    execute: async ({ capability }, args) =>
      executeCommandTemplate(
        capability,
        resolveCommandTemplate(capability, String(args.templateId || 'test')),
        args.workspacePath,
        'test',
      ),
  },
  run_docs: {
    id: 'run_docs',
    description: 'Run the approved docs command template.',
    retryable: true,
    execute: async ({ capability }, args) =>
      executeCommandTemplate(
        capability,
        resolveCommandTemplate(capability, String(args.templateId || 'docs')),
        args.workspacePath,
        'docs',
      ),
  },
  run_deploy: {
    id: 'run_deploy',
    description:
      'Execute an approved deployment target using a named command template after approval.',
    retryable: false,
    execute: async ({ capability, requireApprovedDeployment }, args) => {
      if (!requireApprovedDeployment) {
        throw new Error(
          'Deployment commands are approval-gated and cannot run until the release approval step is resolved.',
        );
      }

      const target = resolveDeploymentTarget(
        capability,
        typeof args.targetId === 'string' ? args.targetId : undefined,
      );

      const template = resolveCommandTemplate(capability, target.commandTemplateId);
      if (template.requiresApproval === false) {
        throw new Error(
          `Deployment template ${template.id} must remain approval-gated in this environment.`,
        );
      }

      return executeCommandTemplate(
        capability,
        template,
        target.workspacePath || args.workspacePath,
        'deploy',
      );
    },
  },
};

export const getToolAdapter = (toolId: ToolAdapterId) => {
  const adapter = TOOL_REGISTRY[toolId];
  if (!adapter) {
    throw new Error(`Tool adapter ${toolId} is not registered.`);
  }
  return adapter;
};

export const listToolDescriptions = (toolIds: ToolAdapterId[]) =>
  toolIds.map(toolId => {
    const adapter = getToolAdapter(toolId);
    return `- ${adapter.id}: ${adapter.description}`;
  });

export const executeTool = async ({
  capability,
  agent,
  toolId,
  args,
  requireApprovedDeployment,
}: {
  capability: Capability;
  agent: CapabilityAgent;
  toolId: ToolAdapterId;
  args: Record<string, any>;
  requireApprovedDeployment?: boolean;
}) => {
  const adapter = getToolAdapter(toolId);
  const result = await adapter.execute(
    { capability, agent, requireApprovedDeployment },
    args,
  );

  return {
    ...result,
    retryable: adapter.retryable,
  };
};
