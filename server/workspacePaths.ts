import path from 'node:path';
import type { Capability } from '../src/types';

export const normalizeDirectoryPath = (value?: string | null) => {
  const trimmed = String(value || '').trim();
  return trimmed ? path.resolve(trimmed) : '';
};

/**
 * Returns the ordered set of desktop workspace root paths for a capability run.
 *
 * When `desktopWorkingDirectory` is provided it takes priority over
 * everything else — the user-level directory registered on
 * `desktop_executor_registrations.working_directory` makes capability-level
 * path config irrelevant for that machine.
 */
export const getCapabilityWorkspaceRoots = (
  capability?: Partial<Capability>,
  desktopWorkingDirectory?: string,
): string[] => {
  if (desktopWorkingDirectory) {
    const normalized = normalizeDirectoryPath(desktopWorkingDirectory);
    if (normalized) return [normalized];
  }
  return Array.from(
    new Set(
      [
        capability?.executionConfig?.defaultWorkspacePath,
        ...(capability?.executionConfig?.allowedWorkspacePaths || []),
        ...(capability?.localDirectories || []),
        ...((capability?.repositories || [])
          .map(repository => repository.localRootHint)
          .filter(Boolean) as string[]),
      ]
        .map(value => normalizeDirectoryPath(value))
        .filter(Boolean),
    ),
  );
};

export const isPathInsideWorkspaceRoot = (
  candidatePath: string,
  workspaceRoot: string,
) => {
  const candidate = normalizeDirectoryPath(candidatePath);
  const root = normalizeDirectoryPath(workspaceRoot);

  if (!candidate || !root) {
    return false;
  }

  const relativePath = path.relative(root, candidate);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
};

export const findApprovedWorkspaceRoot = (
  candidatePath: string,
  approvedWorkspaceRoots: string[],
) => {
  const candidate = normalizeDirectoryPath(candidatePath);
  return approvedWorkspaceRoots
    .map(root => normalizeDirectoryPath(root))
    .find(root => isPathInsideWorkspaceRoot(candidate, root));
};

export const isWorkspacePathApproved = (
  candidatePath: string,
  approvedWorkspaceRoots: string[],
) => Boolean(findApprovedWorkspaceRoot(candidatePath, approvedWorkspaceRoots));

export const formatApprovedWorkspaceRoots = (approvedWorkspaceRoots: string[]) =>
  approvedWorkspaceRoots.length ? approvedWorkspaceRoots.join(', ') : 'none configured';
