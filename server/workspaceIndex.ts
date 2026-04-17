import fs from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const DEFAULT_INDEX_TTL_MS = 30_000;

type WorkspaceIndexRecord = {
  generatedAt: number;
  files: string[];
};

const workspaceIndexCache = new Map<string, WorkspaceIndexRecord>();

const encodeCursor = (offset: number) =>
  Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');

const decodeCursor = (cursor?: string) => {
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
};

const normalizeRelativePath = (rootPath: string, absolutePath: string) =>
  path.relative(rootPath, absolutePath).split(path.sep).join('/');

const isPathWithinRoot = (rootPath: string, candidatePath: string) => {
  const relative = path.relative(rootPath, candidatePath);
  return !(
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
};

export const clearWorkspaceIndexCache = (workspacePath?: string) => {
  if (workspacePath) {
    workspaceIndexCache.delete(path.resolve(workspacePath));
    return;
  }

  workspaceIndexCache.clear();
};

export const getWorkspaceFileIndex = async (
  workspacePath: string,
  options?: {
    refresh?: boolean;
    maxFiles?: number;
    ttlMs?: number;
  },
) => {
  const resolvedRoot = path.resolve(workspacePath);
  const ttlMs = Math.max(5_000, Number(options?.ttlMs || DEFAULT_INDEX_TTL_MS));
  const cached = workspaceIndexCache.get(resolvedRoot);
  if (
    !options?.refresh &&
    cached &&
    Date.now() - cached.generatedAt < ttlMs
  ) {
    return cached.files;
  }

  const maxFiles = Math.max(200, Number(options?.maxFiles || 20_000));
  const files: string[] = [];
  const queue: string[] = [resolvedRoot];

  while (queue.length > 0 && files.length < maxFiles) {
    const currentPath = queue.shift()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      files.push(normalizeRelativePath(resolvedRoot, absolutePath));
      if (files.length >= maxFiles) {
        break;
      }
    }
  }

  const record = {
    generatedAt: Date.now(),
    files,
  };
  workspaceIndexCache.set(resolvedRoot, record);
  return record.files;
};

export const listIndexedWorkspaceFiles = async ({
  workspacePath,
  scopePath,
  cursor,
  limit = 200,
}: {
  workspacePath: string;
  scopePath?: string;
  cursor?: string;
  limit?: number;
}) => {
  const resolvedRoot = path.resolve(workspacePath);
  const files = await getWorkspaceFileIndex(resolvedRoot);
  const scopedPrefix = scopePath
    ? normalizeRelativePath(
        resolvedRoot,
        path.resolve(scopePath),
      ).replace(/\/+$/, '')
    : '';
  const filtered = scopedPrefix
    ? files.filter(file => file === scopedPrefix || file.startsWith(`${scopedPrefix}/`))
    : files;
  const offset = decodeCursor(cursor);
  const safeLimit = Math.max(1, Math.min(Number(limit || 200), 1000));
  const page = filtered.slice(offset, offset + safeLimit);

  return {
    files: page,
    total: filtered.length,
    nextCursor:
      offset + safeLimit < filtered.length ? encodeCursor(offset + safeLimit) : undefined,
    truncated: offset + safeLimit < filtered.length,
    indexedAt: workspaceIndexCache.get(resolvedRoot)?.generatedAt
      ? new Date(workspaceIndexCache.get(resolvedRoot)!.generatedAt).toISOString()
      : undefined,
  };
};

export const searchIndexedWorkspaceFiles = async ({
  workspacePath,
  scopePath,
  pattern,
  cursor,
  limit = 100,
  maxFileBytes = 200_000,
}: {
  workspacePath: string;
  scopePath?: string;
  pattern: string;
  cursor?: string;
  limit?: number;
  maxFileBytes?: number;
}) => {
  const resolvedRoot = path.resolve(workspacePath);
  const resolvedScope = scopePath ? path.resolve(scopePath) : resolvedRoot;
  const indexPage = await listIndexedWorkspaceFiles({
    workspacePath: resolvedRoot,
    scopePath: resolvedScope,
    cursor,
    limit: Math.max(limit * 6, 300),
  });
  const safeLimit = Math.max(1, Math.min(Number(limit || 100), 500));
  const matcher = (() => {
    try {
      return new RegExp(pattern, 'i');
    } catch {
      const lowered = pattern.toLowerCase();
      return {
        test: (value: string) => value.toLowerCase().includes(lowered),
      };
    }
  })();

  const matches: string[] = [];
  for (const relativeFile of indexPage.files) {
    if (matches.length >= safeLimit) {
      break;
    }

    const absoluteFile = path.join(resolvedRoot, relativeFile);
    if (!isPathWithinRoot(resolvedRoot, absoluteFile)) {
      continue;
    }

    try {
      const stat = await fs.stat(absoluteFile);
      if (stat.size > maxFileBytes) {
        continue;
      }
      const content = await fs.readFile(absoluteFile, 'utf8');
      content.split('\n').some((line, index) => {
        if (!matcher.test(line)) {
          return false;
        }

        matches.push(`${relativeFile}:${index + 1}:${line}`);
        return matches.length >= safeLimit;
      });
    } catch {
      // Ignore unreadable or binary-ish files.
    }
  }

  return {
    matches,
    totalScanned: indexPage.files.length,
    nextCursor: indexPage.nextCursor,
    truncated: Boolean(indexPage.nextCursor),
    indexedAt: indexPage.indexedAt,
  };
};
