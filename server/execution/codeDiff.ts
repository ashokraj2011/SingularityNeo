import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getLifecyclePhaseLabel } from '../../src/lib/capabilityLifecycle';
import type {
  Artifact,
  Capability,
  WorkflowRunDetail,
  WorkflowRunStep,
  WorkflowStep,
} from '../../src/types';
import {
  findApprovedWorkspaceRoot,
  getCapabilityWorkspaceRoots,
  normalizeDirectoryPath,
} from '../workspacePaths';

const execFileAsync = promisify(execFile);

const MAX_PATCH_CHARACTERS = 48_000;
const MAX_UNTRACKED_FILE_PATCHES = 8;
const MAX_INLINE_FILE_BYTES = 24_000;

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RepositorySelection = {
  repoRoot: string;
  touchedFiles: string[];
};

type RepositoryDiffSnapshot = RepositorySelection & {
  statusLines: string[];
  patchText: string;
};

const createArtifactId = () =>
  `ART-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const toFileSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const truncateText = (value: string, limit: number) => {
  if (value.length <= limit) {
    return { value, truncated: false };
  }

  return {
    value: `${value.slice(0, limit).trimEnd()}\n\n[Diff truncated for preview]`,
    truncated: true,
  };
};

const canonicalizePath = async (value: string) => {
  const normalized = normalizeDirectoryPath(value);
  if (!normalized) {
    return '';
  }

  const realPath = await fs.realpath(normalized).catch(() => normalized);
  return normalizeDirectoryPath(realPath);
};

const runCommand = async (
  file: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> => {
  try {
    const result = await execFileAsync(file, args, {
      cwd,
      maxBuffer: 1024 * 1024 * 8,
    });

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
      exitCode: typeof execError.code === 'number' ? execError.code : 1,
      stdout: execError.stdout || '',
      stderr: execError.stderr || execError.message || '',
    };
  }
};

const resolveGitRepositoryRoot = async (candidatePath: string) => {
  const currentPath = await canonicalizePath(candidatePath);
  if (!currentPath) {
    return null;
  }

  const stat = await fs.stat(currentPath).catch(() => null);
  if (!stat) {
    return null;
  }

  const cwd = stat.isDirectory() ? currentPath : path.dirname(currentPath);
  const result = await runCommand('git', ['rev-parse', '--show-toplevel'], cwd);
  if (result.exitCode !== 0) {
    return null;
  }

  return normalizeDirectoryPath(result.stdout.trim());
};

const buildAddedFilePatch = async (absolutePath: string, relativePath: string) => {
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return null;
  }

  if (stat.size > MAX_INLINE_FILE_BYTES) {
    return [
      `diff --git a/${relativePath} b/${relativePath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${relativePath}`,
      '@@ -0,0 +1 @@',
      `+[File too large to preview inline: ${relativePath}]`,
    ].join('\n');
  }

  const content = await fs.readFile(absolutePath, 'utf8').catch(() => null);
  if (content === null || content.includes('\u0000')) {
    return [
      `diff --git a/${relativePath} b/${relativePath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${relativePath}`,
      '@@ -0,0 +1 @@',
      `+[Binary or unreadable file omitted: ${relativePath}]`,
    ].join('\n');
  }

  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const lineCount = Math.max(lines.length, 1);
  const addedLines = lines.map(line => `+${line}`).join('\n');

  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${lineCount} @@`,
    addedLines || '+',
  ].join('\n');
};

const collectRepositorySelections = async ({
  capability,
  touchedPaths,
}: {
  capability: Capability;
  touchedPaths: string[];
}): Promise<RepositorySelection[]> => {
  const approvedWorkspaceRoots = getCapabilityWorkspaceRoots(capability);
  const byRepository = new Map<string, Set<string>>();

  for (const rawPath of touchedPaths) {
    const requestedPath = normalizeDirectoryPath(rawPath);
    if (!requestedPath) {
      continue;
    }

    if (!findApprovedWorkspaceRoot(requestedPath, approvedWorkspaceRoots)) {
      continue;
    }

    const absolutePath = await canonicalizePath(requestedPath);
    if (!absolutePath) {
      continue;
    }

    const repoRoot = await resolveGitRepositoryRoot(absolutePath);
    if (!repoRoot) {
      continue;
    }

    const relativePath = path.relative(repoRoot, absolutePath);
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      continue;
    }

    if (!byRepository.has(repoRoot)) {
      byRepository.set(repoRoot, new Set<string>());
    }
    byRepository.get(repoRoot)?.add(relativePath);
  }

  return Array.from(byRepository.entries()).map(([repoRoot, files]) => ({
    repoRoot,
    touchedFiles: Array.from(files).sort(),
  }));
};

const captureRepositoryDiff = async ({
  repoRoot,
  touchedFiles,
}: RepositorySelection): Promise<RepositoryDiffSnapshot | null> => {
  if (touchedFiles.length === 0) {
    return null;
  }

  const statusResult = await runCommand(
    'git',
    ['status', '--short', '--', ...touchedFiles],
    repoRoot,
  );
  if (statusResult.exitCode !== 0) {
    return null;
  }

  const statusLines = statusResult.stdout
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean);

  const trackedDiffResult = await runCommand(
    'git',
    ['diff', '--no-ext-diff', '--stat', '--patch', '--find-renames', '--', ...touchedFiles],
    repoRoot,
  );

  const trackedPatch =
    trackedDiffResult.exitCode === 0 ? trackedDiffResult.stdout.trim() : '';

  const untrackedFiles = statusLines
    .filter(line => line.startsWith('?? '))
    .map(line => line.slice(3).trim())
    .slice(0, MAX_UNTRACKED_FILE_PATCHES);

  const untrackedPatches: string[] = [];
  for (const relativeFile of untrackedFiles) {
    const patch = await buildAddedFilePatch(path.join(repoRoot, relativeFile), relativeFile);
    if (patch) {
      untrackedPatches.push(patch);
    }
  }

  const patchSections = [trackedPatch, ...untrackedPatches].filter(Boolean);
  if (patchSections.length === 0 && statusLines.length === 0) {
    return null;
  }

  const { value: patchText } = truncateText(
    patchSections.join('\n\n'),
    MAX_PATCH_CHARACTERS,
  );

  return {
    repoRoot,
    touchedFiles,
    statusLines,
    patchText,
  };
};

const renderMetadataTable = (rows: Array<[string, string]>) => [
  '| Field | Value |',
  '| --- | --- |',
  ...rows.map(([label, value]) => `| ${label} | ${value.replace(/\n/g, '<br/>')} |`),
].join('\n');

export const captureCodeDiffReviewArtifact = async ({
  capability,
  detail,
  step,
  runStep,
  touchedPaths,
}: {
  capability: Capability;
  detail: WorkflowRunDetail;
  step: WorkflowStep;
  runStep: WorkflowRunStep;
  touchedPaths: string[];
}): Promise<Artifact | null> => {
  const selections = await collectRepositorySelections({ capability, touchedPaths });
  if (selections.length === 0) {
    return null;
  }

  const snapshots = (
    await Promise.all(selections.map(selection => captureRepositoryDiff(selection)))
  ).filter(Boolean) as RepositoryDiffSnapshot[];

  if (snapshots.length === 0) {
    return null;
  }

  const totalTouchedFiles = snapshots.reduce(
    (count, snapshot) => count + snapshot.touchedFiles.length,
    0,
  );
  const repoCount = snapshots.length;
  const summary = `Review ${totalTouchedFiles} changed file${totalTouchedFiles === 1 ? '' : 's'} across ${repoCount} repositor${repoCount === 1 ? 'y' : 'ies'} before continuing ${step.name}.`;

  const contentSections = snapshots
    .map(snapshot => {
      const statusText =
        snapshot.statusLines.length > 0
          ? snapshot.statusLines.join('\n')
          : 'No git status entries were reported for the touched files.';
      const patchText =
        snapshot.patchText || 'No patch preview is available for these touched files.';

      return [
        `## Repository: ${path.basename(snapshot.repoRoot)}`,
        `Path: \`${snapshot.repoRoot}\``,
        `Touched files: ${snapshot.touchedFiles.map(file => `\`${file}\``).join(', ')}`,
        '',
        '### Git status',
        '```text',
        statusText,
        '```',
        '',
        '### Patch',
        '```diff',
        patchText,
        '```',
      ].join('\n');
    })
    .join('\n\n');

  return {
    id: createArtifactId(),
    name: `${step.name} Code Diff Review`,
    capabilityId: detail.run.capabilityId,
    type: 'Code Diff',
    version: `run-${detail.run.attemptNumber}`,
    agent: step.agentId,
    created: new Date().toISOString(),
    direction: 'OUTPUT',
    connectedAgentId: step.agentId,
    sourceWorkflowId: detail.run.workflowId,
    runId: detail.run.id,
    runStepId: runStep.id,
    toolInvocationId: runStep.lastToolInvocationId,
    summary,
    artifactKind: 'CODE_DIFF',
    phase: step.phase,
    workItemId: detail.run.workItemId,
    sourceRunId: detail.run.id,
    sourceRunStepId: runStep.id,
    contentFormat: 'MARKDOWN',
    mimeType: 'text/markdown',
    fileName: `${toFileSlug(detail.run.workItemId)}-${toFileSlug(step.name)}-code-diff.md`,
    contentText: `# ${step.name} Code Diff Review\n\n${renderMetadataTable([
      ['Work Item', detail.run.workItemId],
      ['Phase', getLifecyclePhaseLabel(undefined, step.phase)],
      ['Agent', step.agentId],
      ['Repositories', String(repoCount)],
      ['Touched files', String(totalTouchedFiles)],
      ['Review guidance', 'Approve this diff to let the workflow continue to the next step.'],
    ])}\n\n${contentSections}`,
    contentJson: {
      repositories: snapshots.map(snapshot => ({
        repoRoot: snapshot.repoRoot,
        touchedFiles: snapshot.touchedFiles,
        statusLines: snapshot.statusLines,
        // Raw unified-diff text is also mirrored here so the agent-git
        // auto-commit hook can read it structured without having to
        // regex-parse the markdown body in contentText.
        patchText: snapshot.patchText || '',
      })),
      touchedPaths: touchedPaths.map(value => normalizeDirectoryPath(value)).filter(Boolean),
    },
    downloadable: true,
    traceId: detail.run.traceId,
  };
};
