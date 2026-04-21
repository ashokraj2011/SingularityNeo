import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  Capability,
  CapabilityAgent,
  CapabilityExecutionCommandTemplate,
  ToolAdapterId,
  WorkItem,
} from '../../src/types';
import { runSandboxedCommand, type SandboxProfile, summarizeSandboxFailure } from '../sandbox';
import {
  findApprovedWorkspaceRoot,
  formatApprovedWorkspaceRoots,
  getCapabilityWorkspaceRoots,
  normalizeDirectoryPath,
} from '../workspacePaths';
import {
  listIndexedWorkspaceFiles,
  searchIndexedWorkspaceFiles,
} from '../workspaceIndex';
import {
  getPublishedBounty,
  getPublishedBountySignal,
  publishBounty,
  publishBountySignal,
  waitForBountySignal,
} from '../eventBus';
import {
  acquireWorkspaceWriteLock,
  releaseWorkspaceWriteLock,
  WorkspaceLockConflictError,
} from '../workspaceLock';

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
  workItem?: WorkItem;
  requireApprovedDeployment?: boolean;
};

type ToolAdapter = {
  id: ToolAdapterId;
  description: string;
  usageExample?: string;
  retryable: boolean;
  execute: (
    context: ToolExecutionContext,
    args: Record<string, any>,
  ) => Promise<ToolExecutionResult>;
};

const previewText = (value: string, limit = 1600) =>
  value.replace(/\0/g, '').slice(0, limit);

const clampLimit = (value: unknown, fallback: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(parsed), max));
};

const paginateValues = ({
  values,
  cursor,
  limit,
}: {
  values: string[];
  cursor?: string;
  limit: number;
}) => {
  const offset = (() => {
    if (!cursor) {
      return 0;
    }

    try {
      const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
        offset?: number;
      };
      return Math.max(0, Number(payload.offset || 0));
    } catch {
      return 0;
    }
  })();
  const page = values.slice(offset, offset + limit);
  const nextCursor =
    offset + limit < values.length
      ? Buffer.from(JSON.stringify({ offset: offset + limit }), 'utf8').toString('base64url')
      : undefined;

  return {
    page,
    nextCursor,
    total: values.length,
    truncated: Boolean(nextCursor),
  };
};

const getRequiredStringArg = (
  args: Record<string, any>,
  key: string,
  toolId: ToolAdapterId,
) => {
  if (Array.isArray(args[key])) {
    const label =
      key === 'path' || key === 'pattern' || key === 'workspacePath'
        ? `${key} string`
        : `${key} value`;
    throw new Error(`${toolId} requires a single ${label}.`);
  }

  const value = String(args[key] || '').trim();
  if (!value) {
    const label =
      key === 'path' || key === 'pattern' || key === 'workspacePath'
        ? `a ${key}`
        : key;
    throw new Error(`${toolId} requires ${label}.`);
  }
  return value;
};

const getRequiredRawStringArg = (
  args: Record<string, any>,
  key: string,
  toolId: ToolAdapterId,
) => {
  if (Array.isArray(args[key])) {
    throw new Error(`${toolId} requires a single ${key} value.`);
  }

  const value = args[key];
  if (value === undefined || value === null || String(value).length === 0) {
    throw new Error(`${toolId} requires ${key}.`);
  }
  return String(value);
};

const normalizeBountyRole = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');

const agentMatchesBountyRole = (agent: CapabilityAgent, targetRole?: string) => {
  const expected = normalizeBountyRole(targetRole);
  if (!expected) {
    return true;
  }

  const candidates = [
    agent.role,
    agent.name,
    agent.standardTemplateKey,
    agent.roleStarterKey,
  ]
    .map(value => normalizeBountyRole(value))
    .filter(Boolean);

  return candidates.some(
    candidate =>
      candidate === expected ||
      candidate.includes(expected) ||
      expected.includes(candidate),
  );
};

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

const runProcessWithInput = async ({
  command,
  args,
  cwd,
  stdin,
}: {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
}) =>
  new Promise<{ exitCode: number; stdout: string; stderr: string }>(resolve => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk || '');
    });
    child.on('error', error => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message,
      });
    });
    child.on('close', exitCode => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });

const extractPatchTouchedFiles = (patchText: string) => {
  const touched = new Set<string>();
  patchText.split('\n').forEach(line => {
    const match = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
    if (!match) {
      return;
    }
    const candidate = match[1]?.trim();
    if (!candidate || candidate === '/dev/null') {
      return;
    }
    touched.add(candidate);
  });
  return [...touched];
};

const resolveWorkspacePath = (
  capability: Capability,
  workItem?: WorkItem,
  preferredPath?: string,
) => {
  const allowed = getCapabilityWorkspaceRoots(capability);
  const configuredDefault = normalizeDirectoryPath(
    capability.executionConfig.defaultWorkspacePath || '',
  );
  const workItemRepositoryId =
    workItem?.executionContext?.primaryRepositoryId ||
    workItem?.executionContext?.branch?.repositoryId;
  const workItemRepositoryRoot = normalizeDirectoryPath(
    (capability.repositories || []).find(repository => repository.id === workItemRepositoryId)
      ?.localRootHint || '',
  );
  const defaultPath = workItemRepositoryRoot || configuredDefault || allowed[0] || '';
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

export const classifyToolExecutionError = ({
  toolId,
  message,
}: {
  toolId: ToolAdapterId;
  message: string;
}) => {
  const normalized = message.trim();
  if (!normalized) {
    return null;
  }

  if (/^WRITE_CONTROL lock held by agent\b/i.test(normalized)) {
    return {
      recoverable: true,
      feedback: `The workspace write lock is currently held by another agent. ${normalized} Wait a moment, then retry the write operation.`,
    };
  }

  if (new RegExp(`^${toolId}\\s+requires\\b`, 'i').test(normalized)) {
    return {
      recoverable: true,
      feedback: `Tool ${toolId} validation failed: ${normalized} Fix the missing required argument and try again.`,
    };
  }

  if (
    /is not approved for capability/i.test(normalized) ||
    /escapes the approved workspace root/i.test(normalized)
  ) {
    return {
      recoverable: true,
      feedback: `Tool ${toolId} used an invalid workspace path: ${normalized} Pick an approved workspace root or child path and try again.`,
    };
  }

  if (
    toolId === 'run_deploy' &&
    /does not define deployment target|must remain approval-gated/i.test(normalized)
  ) {
    return {
      recoverable: true,
      feedback: `Tool ${toolId} could not run with the provided deployment target: ${normalized} Use one of the approved deployment targets or wait for the required approval gate.`,
    };
  }

  if (
    (toolId === 'run_build' || toolId === 'run_test' || toolId === 'run_docs') &&
    /does not define the (build|test|docs) command template/i.test(normalized)
  ) {
    return {
      recoverable: true,
      feedback: `Tool ${toolId} cannot run because ${normalized} If explicit operator guidance says to skip this command for the current attempt, do not call ${toolId} again. Complete the step and clearly state that the validation was skipped by operator direction. Otherwise pause_for_input and ask whether to configure the missing command template or skip this command for this attempt.`,
    };
  }

  return null;
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
  workItem: WorkItem | undefined,
  template: CapabilityExecutionCommandTemplate,
  workspacePath?: string,
  sandboxProfile: SandboxProfile = 'workspace',
) => {
  const workingDirectory = template.workingDirectory
    ? resolveWorkspacePath(capability, workItem, template.workingDirectory)
    : resolveWorkspacePath(capability, workItem, workspacePath);
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
    usageExample: '{"path":"src","limit":200,"cursor":"..."}',
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = resolveWorkspacePath(
        capability,
        workItem,
        args.workspacePath || args.path,
      );
      const scopePath = args.path
        ? resolvePathWithinWorkspace(workspacePath, String(args.path))
        : workspacePath;
      const limit = clampLimit(args.limit, 200, 1000);
      const cursor = typeof args.cursor === 'string' ? args.cursor.trim() : undefined;
      const result = await runProcess('rg', ['--files', scopePath], workspacePath);
      const paged = result.exitCode === 0
        ? paginateValues({
            values: result.stdout.split('\n').filter(Boolean),
            cursor,
            limit,
          })
        : isCommandMissing(result)
          ? {
              page: [],
              nextCursor: undefined,
              total: 0,
              truncated: false,
              ...(await listIndexedWorkspaceFiles({
                workspacePath,
                scopePath,
                cursor,
                limit,
              })),
            }
          : { page: [], nextCursor: undefined, total: 0, truncated: false };

      if (result.exitCode !== 0 && !isCommandMissing(result)) {
        throw new Error(
          `Unable to list files in ${workspacePath}: ${previewText(result.stderr || result.stdout)}`,
        );
      }

      return {
        summary: `Listed ${paged.page.length} files from ${workspacePath}.`,
        workingDirectory: workspacePath,
        stdoutPreview: previewText(paged.page.join('\n')),
        details: {
          files: paged.page,
          scopePath,
          total: paged.total,
          nextCursor: paged.nextCursor,
          truncated: paged.truncated,
          fallback: result.exitCode !== 0 ? 'node-filesystem' : undefined,
        },
      };
    },
  },
  workspace_read: {
    id: 'workspace_read',
    description: 'Read a text file from an approved workspace path.',
    usageExample: '{"path":"src/main/java/App.java"}',
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = resolveWorkspacePath(capability, workItem, args.workspacePath);
      const targetPath = resolvePathWithinWorkspace(
        workspacePath,
        getRequiredStringArg(args, 'path', 'workspace_read'),
      );
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
    usageExample: '{"pattern":"Operator","path":"src","limit":100,"cursor":"..."}',
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      const pattern = getRequiredStringArg(args, 'pattern', 'workspace_search');

      const workspacePath = resolveWorkspacePath(capability, workItem, args.workspacePath);
      const scopePath = args.path
        ? resolvePathWithinWorkspace(workspacePath, String(args.path))
        : workspacePath;
      const limit = clampLimit(args.limit, 100, 500);
      const cursor = typeof args.cursor === 'string' ? args.cursor.trim() : undefined;
      const result = await runProcess('rg', ['-n', pattern, scopePath], workspacePath);
      const paged = isCommandMissing(result)
        ? await searchIndexedWorkspaceFiles({
            workspacePath,
            scopePath,
            pattern,
            cursor,
            limit,
          })
        : {
            matches: paginateValues({
              values: (result.stdout || result.stderr).split('\n').filter(Boolean),
              cursor,
              limit,
            }).page,
            totalScanned: (result.stdout || result.stderr).split('\n').filter(Boolean).length,
            nextCursor: paginateValues({
              values: (result.stdout || result.stderr).split('\n').filter(Boolean),
              cursor,
              limit,
            }).nextCursor,
            truncated: paginateValues({
              values: (result.stdout || result.stderr).split('\n').filter(Boolean),
              cursor,
              limit,
            }).truncated,
          };
      const output = paged.matches.join('\n');

      return {
        summary:
          result.exitCode === 0 || paged.matches.length > 0
            ? `Search completed for pattern ${pattern}.`
            : `Search found no matches for pattern ${pattern}.`,
        workingDirectory: workspacePath,
        exitCode: isCommandMissing(result) ? (paged.matches.length > 0 ? 0 : 1) : result.exitCode,
        stdoutPreview: previewText(output),
        details: {
          pattern,
          scopePath,
          matches: paged.matches,
          nextCursor: paged.nextCursor,
          totalScanned: paged.totalScanned,
          truncated: paged.truncated,
          fallback: isCommandMissing(result) ? 'node-filesystem' : undefined,
        },
      };
    },
  },
  git_status: {
    id: 'git_status',
    description: 'Inspect git status for an approved workspace repository.',
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = resolveWorkspacePath(capability, workItem, args.workspacePath);
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
    usageExample: '{"path":"src/main/java/App.java","content":"..."}',
    retryable: false,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = resolveWorkspacePath(capability, workItem, args.workspacePath);
      const targetPath = resolvePathWithinWorkspace(
        workspacePath,
        getRequiredStringArg(args, 'path', 'workspace_write'),
      );
      const content = String(args.content || '');
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, 'utf8');

      return {
        summary: `Wrote ${path.relative(workspacePath, targetPath)}.`,
        workingDirectory: workspacePath,
        details: {
          path: targetPath,
          touchedPaths: [targetPath],
          bytesWritten: Buffer.byteLength(content, 'utf8'),
        },
      };
    },
  },
  workspace_replace_block: {
    id: 'workspace_replace_block',
    description:
      'Replace a specific block of text inside an approved workspace file with anchor safety checks.',
    usageExample:
      '{"path":"src/App.tsx","find":"const oldValue = 1;","replace":"const oldValue = 2;","expectedMatches":1}',
    retryable: false,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = resolveWorkspacePath(capability, workItem, args.workspacePath);
      const targetPath = resolvePathWithinWorkspace(
        workspacePath,
        getRequiredStringArg(args, 'path', 'workspace_replace_block'),
      );
      const find = getRequiredRawStringArg(args, 'find', 'workspace_replace_block');
      const replace = String(args.replace ?? '');
      const expectedMatches = clampLimit(args.expectedMatches, 1, 1000);
      const replaceAll = Boolean(args.replaceAll);
      const current = await fs.readFile(targetPath, 'utf8');
      const matchCount = current.split(find).length - 1;

      if (matchCount === 0) {
        throw new Error(`Could not find the requested block in ${targetPath}.`);
      }
      if (matchCount !== expectedMatches) {
        throw new Error(
          `Expected ${expectedMatches} block match(es) in ${targetPath}, but found ${matchCount}.`,
        );
      }

      const nextContent = replaceAll
        ? current.split(find).join(replace)
        : current.replace(find, replace);
      await fs.writeFile(targetPath, nextContent, 'utf8');

      return {
        summary: `Replaced ${matchCount} block match(es) in ${path.relative(workspacePath, targetPath)}.`,
        workingDirectory: workspacePath,
        details: {
          path: targetPath,
          touchedPaths: [targetPath],
          matchCount,
          bytesWritten: Buffer.byteLength(nextContent, 'utf8'),
        },
      };
    },
  },
  workspace_apply_patch: {
    id: 'workspace_apply_patch',
    description: 'Apply a unified diff patch inside an approved workspace root.',
    usageExample:
      '{"patchText":"diff --git a/src/App.tsx b/src/App.tsx\\n--- a/src/App.tsx\\n+++ b/src/App.tsx\\n@@ ..."}',
    retryable: false,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = resolveWorkspacePath(capability, workItem, args.workspacePath);
      const patchText = getRequiredRawStringArg(
        args,
        'patchText',
        'workspace_apply_patch',
      );
      const touchedRelativePaths = extractPatchTouchedFiles(patchText);
      if (touchedRelativePaths.length === 0) {
        throw new Error('workspace_apply_patch requires at least one touched file in the patch.');
      }
      const touchedPaths = touchedRelativePaths.map(relativePath =>
        resolvePathWithinWorkspace(workspacePath, relativePath),
      );

      const result = await runProcessWithInput({
        command: 'git',
        args: ['apply', '--recount', '--reject', '--whitespace=nowarn', '--verbose', '-'],
        cwd: workspacePath,
        stdin: patchText,
      });

      if (result.exitCode !== 0) {
        throw new Error(
          `Unable to apply patch in ${workspacePath}: ${previewText(result.stderr || result.stdout)}`,
        );
      }

      return {
        summary: `Applied patch touching ${touchedRelativePaths.length} file(s).`,
        workingDirectory: workspacePath,
        stdoutPreview: previewText(result.stdout || result.stderr),
        details: {
          touchedPaths,
          touchedRelativePaths,
        },
      };
    },
  },
  delegate_task: {
    id: 'delegate_task',
    description:
      'Delegate a bounded specialist subtask to another agent inside the current capability execution.',
    usageExample:
      '{"delegatedAgentId":"AGENT-...","title":"Inspect failing tests","prompt":"Review the latest test failures and summarize the root cause."}',
    retryable: false,
    execute: async () => {
      throw new Error(
        'delegate_task is orchestrated by the execution service and cannot be executed outside an active workflow run.',
      );
    },
  },
  run_build: {
    id: 'run_build',
    description: 'Run the approved build command template.',
    usageExample: '{"templateId":"build"}',
    retryable: true,
    execute: async ({ capability, workItem }, args) =>
      executeCommandTemplate(
        capability,
        workItem,
        resolveCommandTemplate(capability, String(args.templateId || 'build')),
        args.workspacePath,
        'build',
      ),
  },
  run_test: {
    id: 'run_test',
    description: 'Run the approved test command template.',
    usageExample: '{"templateId":"test"}',
    retryable: true,
    execute: async ({ capability, workItem }, args) =>
      executeCommandTemplate(
        capability,
        workItem,
        resolveCommandTemplate(capability, String(args.templateId || 'test')),
        args.workspacePath,
        'test',
      ),
  },
  run_docs: {
    id: 'run_docs',
    description: 'Run the approved docs command template.',
    usageExample: '{"templateId":"docs"}',
    retryable: true,
    execute: async ({ capability, workItem }, args) =>
      executeCommandTemplate(
        capability,
        workItem,
        resolveCommandTemplate(capability, String(args.templateId || 'docs')),
        args.workspacePath,
        'docs',
      ),
  },
  run_deploy: {
    id: 'run_deploy',
    description:
      'Execute an approved deployment target using a named command template after approval.',
    usageExample: '{"targetId":"staging"}',
    retryable: false,
    execute: async ({ capability, workItem, requireApprovedDeployment }, args) => {
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
        workItem,
        template,
        target.workspacePath || args.workspacePath,
        'deploy',
      );
    },
  },
  publish_bounty: {
    id: 'publish_bounty',
    description:
      'Experimental: broadcast an in-process bounty request to other agents in the current desktop runtime.',
    usageExample: '{"bountyId":"req-123","targetRole":"Backend","instructions":"..."}',
    retryable: false,
    execute: async ({ capability, agent }, args) => {
      const bountyId = getRequiredStringArg(args, 'bountyId', 'publish_bounty');
      const instructions = getRequiredStringArg(args, 'instructions', 'publish_bounty');
      const targetRole = args.targetRole ? String(args.targetRole) : undefined;

      if (getPublishedBounty(bountyId) || getPublishedBountySignal(bountyId)) {
        throw new Error(
          `Bounty ${bountyId} already exists in this runtime. Use a new bountyId instead of retrying the same publish request.`,
        );
      }
      
      publishBounty({
        id: bountyId,
        capabilityId: capability.id,
        sourceAgentId: agent.id,
        targetRole,
        instructions,
        status: 'OPEN',
        createdAt: new Date().toISOString(),
        timeoutMs: Number(args.timeoutMs) || undefined
      });
      
      return {
        summary: `Published experimental bounty ${bountyId}. Only the publishing agent may wait on it, and only an eligible peer may resolve it in this runtime.`,
        details: { bountyId, targetRole, experimental: true }
      };
    }
  },
  resolve_bounty: {
    id: 'resolve_bounty',
    description:
      'Experimental: resolve an active in-process bounty published by another agent in the same runtime.',
    usageExample: '{"bountyId":"req-123","status":"RESOLVED","resultSummary":"Created route"}',
    retryable: false,
    execute: async ({ capability, agent }, args) => {
      const bountyId = getRequiredStringArg(args, 'bountyId', 'resolve_bounty');
      const status = args.status === 'FAILED' ? 'FAILED' : 'RESOLVED';
      const resultSummary = args.resultSummary ? String(args.resultSummary) : undefined;
      const bounty = getPublishedBounty(bountyId);

      if (!bounty) {
        throw new Error(`Bounty ${bountyId} is not active in this runtime.`);
      }
      if (bounty.capabilityId !== capability.id) {
        throw new Error(`Bounty ${bountyId} belongs to another capability runtime.`);
      }
      if (bounty.sourceAgentId === agent.id) {
        throw new Error(`Agent ${agent.id} cannot resolve its own bounty ${bountyId}.`);
      }
      if (!agentMatchesBountyRole(agent, bounty.targetRole)) {
        throw new Error(
          `Bounty ${bountyId} targets role ${bounty.targetRole}, which does not match ${agent.role}.`,
        );
      }
      
      publishBountySignal({
        bountyId,
        status,
        resultSummary,
        resolvedByAgentId: agent.id,
        resolvedAt: new Date().toISOString()
      });
      
      return {
        summary: `Resolved experimental bounty ${bountyId} with status ${status}.`,
        details: { bountyId, status, experimental: true }
      };
    }
  },
  wait_for_signal: {
    id: 'wait_for_signal',
    description:
      'Experimental: wait for an in-process bounty published by this same agent to be resolved.',
    usageExample: '{"bountyId":"req-123"}',
    retryable: false,
    execute: async ({ capability, agent }, args) => {
      const bountyId = getRequiredStringArg(args, 'bountyId', 'wait_for_signal');
      const timeoutMs = Number(args.timeoutMs) || 60000; // default 1 minute
      const bounty = getPublishedBounty(bountyId);
      const priorSignal = getPublishedBountySignal(bountyId);

      if (bounty) {
        if (bounty.capabilityId !== capability.id) {
          throw new Error(`Bounty ${bountyId} belongs to another capability runtime.`);
        }
        if (bounty.sourceAgentId !== agent.id) {
          throw new Error(
            `Only the publishing agent ${bounty.sourceAgentId} may wait on bounty ${bountyId}.`,
          );
        }
      } else if (!priorSignal) {
        throw new Error(`Bounty ${bountyId} is not active in this runtime.`);
      }
      
      try {
        const result = await waitForBountySignal(bountyId, timeoutMs);
        return {
          summary: `Experimental bounty ${bountyId} was signaled with status: ${result.status}`,
          details: {
            resolvedByAgentId: result.resolvedByAgentId,
            resultSummary: result.resultSummary,
            payload: result.detailPayload,
            experimental: true,
          }
        };
      } catch (err: any) {
        throw new Error(err.message || 'Error occurred while waiting for signal');
      }
    }
  }
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
    return `- ${adapter.id}: ${adapter.description}${adapter.usageExample ? ` Example args: ${adapter.usageExample}` : ''}`;
  });

const SHADOW_MOCKED_TOOLS = new Set([
  'workspace_write',
  'workspace_replace_block',
  'workspace_apply_patch',
  'run_build',
  'run_test',
  'run_docs',
  'run_deploy'
]);

const WRITE_LOCK_TOOLS = new Set<ToolAdapterId>([
  'workspace_write',
  'workspace_replace_block',
  'workspace_apply_patch',
]);

export const executeTool = async ({
  capability,
  agent,
  workItem,
  toolId,
  args,
  requireApprovedDeployment,
  runId,
  runStepId,
  stepName,
}: {
  capability: Capability;
  agent: CapabilityAgent;
  workItem?: WorkItem;
  toolId: ToolAdapterId;
  args: Record<string, any>;
  requireApprovedDeployment?: boolean;
  runId?: string;
  runStepId?: string;
  stepName?: string;
}) => {
  const adapter = getToolAdapter(toolId);

  if (
    capability.executionConfig?.executionMode === 'SHADOW' &&
    SHADOW_MOCKED_TOOLS.has(toolId)
  ) {
    return {
      summary: `[SHADOW MODE INTERCEPT]: Simulated successful execution of ${toolId}.`,
      workingDirectory: capability.executionConfig.defaultWorkspacePath || '/shadow',
      exitCode: 0,
      stdoutPreview: 'Shadow mode simulation successful. No actual changes were made.',
      stderrPreview: '',
      sandboxProfile: 'shadow',
      details: { shadowIntercept: true, simulated: true, originalArgs: args },
      retryable: false,
    };
  }

  if (WRITE_LOCK_TOOLS.has(toolId) && runId && runStepId) {
    await acquireWorkspaceWriteLock({
      capabilityId: capability.id,
      runStepId,
      runId,
      agentId: agent.id,
      stepName: stepName ?? toolId,
    });
  }

  try {
    const result = await adapter.execute(
      { capability, agent, workItem, requireApprovedDeployment },
      args,
    );

    return {
      ...result,
      retryable: adapter.retryable,
    };
  } finally {
    if (WRITE_LOCK_TOOLS.has(toolId) && runId && runStepId) {
      await releaseWorkspaceWriteLock({ capabilityId: capability.id, runStepId });
    }
  }
};
