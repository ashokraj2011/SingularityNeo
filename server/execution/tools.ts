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

const execFileAsync = promisify(execFile);

export type ToolExecutionResult = {
  summary: string;
  details?: Record<string, unknown>;
  workingDirectory?: string;
  exitCode?: number;
  stdoutPreview?: string;
  stderrPreview?: string;
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

const normalizeDirectoryPath = (value: string) => path.resolve(value.trim());

const getAllowedWorkspacePaths = (capability: Capability) =>
  Array.from(
    new Set([
      ...(capability.executionConfig.allowedWorkspacePaths || []),
      ...(capability.localDirectories || []),
    ]),
  ).map(normalizeDirectoryPath);

const resolveWorkspacePath = (
  capability: Capability,
  preferredPath?: string,
) => {
  const allowed = getAllowedWorkspacePaths(capability);
  const defaultPath =
    capability.executionConfig.defaultWorkspacePath || allowed[0];
  const candidate = normalizeDirectoryPath(preferredPath || defaultPath || '');

  if (!candidate) {
    throw new Error(
      `Capability ${capability.name} does not have an approved local workspace path configured.`,
    );
  }

  if (!allowed.includes(candidate)) {
    throw new Error(
      `Workspace path ${candidate} is not approved for capability ${capability.name}.`,
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

const executeCommandTemplate = async (
  capability: Capability,
  template: CapabilityExecutionCommandTemplate,
  workspacePath?: string,
) => {
  const workingDirectory = template.workingDirectory
    ? resolveWorkspacePath(capability, template.workingDirectory)
    : resolveWorkspacePath(capability, workspacePath);
  const [file, ...args] = template.command;
  const result = await runProcess(file, args, workingDirectory);

  if (result.exitCode !== 0) {
    throw new Error(
      `${template.label} failed in ${workingDirectory}: ${
        previewText(result.stderr || result.stdout || 'Unknown error')
      }`,
    );
  }

  return {
    summary: `${template.label} completed successfully.`,
    workingDirectory,
    exitCode: result.exitCode,
    stdoutPreview: previewText(result.stdout),
    stderrPreview: previewText(result.stderr),
    details: {
      command: template.command,
      templateId: template.id,
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
      if (result.exitCode !== 0) {
        throw new Error(
          `Unable to list files in ${workspacePath}: ${previewText(result.stderr || result.stdout)}`,
        );
      }

      const files = result.stdout
        .split('\n')
        .filter(Boolean)
        .slice(0, 200);

      return {
        summary: `Listed ${files.length} files from ${workspacePath}.`,
        workingDirectory: workspacePath,
        stdoutPreview: previewText(files.join('\n')),
        details: { files },
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

      return {
        summary:
          result.exitCode === 0
            ? `Search completed for pattern ${pattern}.`
            : `Search found no matches for pattern ${pattern}.`,
        workingDirectory: workspacePath,
        exitCode: result.exitCode,
        stdoutPreview: previewText(result.stdout || result.stderr),
        details: {
          pattern,
          scopePath,
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

      const targetId = String(args.targetId || '').trim();
      if (!targetId) {
        throw new Error('run_deploy requires a deployment target id.');
      }

      const target = capability.executionConfig.deploymentTargets.find(
        item => item.id === targetId,
      );
      if (!target) {
        throw new Error(
          `Capability ${capability.name} does not define deployment target ${targetId}.`,
        );
      }

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
