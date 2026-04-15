import path from 'node:path';
import type { Capability } from '../src/types';

export const normalizeDirectoryPath = (value?: string | null) => {
  const trimmed = String(value || '').trim();
  return trimmed ? path.resolve(trimmed) : '';
};

export const getCapabilityWorkspaceRoots = (capability?: Partial<Capability>) =>
  Array.from(
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
