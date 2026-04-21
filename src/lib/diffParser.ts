/**
 * Shared unified-diff parser used by both the inline PatchDiffViewer
 * and the Monaco-based ArtifactDiffViewer.
 *
 * Previously each component carried its own copy (acknowledged in
 * ArtifactDiffViewer.tsx's design notes). Extracted here so a bug fix
 * or grammar extension only needs to happen once.
 *
 * Grammar: standard git unified-diff format.
 *   diff --git a/foo b/foo
 *   --- a/foo
 *   +++ b/foo
 *   @@ -1,4 +1,6 @@ optional context
 *   -removed line
 *   +added line
 *    context line
 */

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Optional hunk context string after the @@ header. */
  header?: string;
  lines: string[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED';
  isBinary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export const HUNK_HEADER_RE =
  /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@\s*(.*)$/;

export const stripGitPrefix = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed === '/dev/null') return '';
  if (trimmed.startsWith('a/')) return trimmed.slice(2);
  if (trimmed.startsWith('b/')) return trimmed.slice(2);
  return trimmed;
};

export const parseUnifiedDiff = (raw: string): DiffFile[] => {
  if (!raw) return [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let pendingOldPath: string | null = null;

  const flushHunk = () => {
    if (currentFile && currentHunk) {
      currentFile.hunks.push(currentHunk);
      currentHunk = null;
    }
  };

  const pushFile = () => {
    flushHunk();
    if (currentFile) files.push(currentFile);
    currentFile = null;
  };

  const startFile = (oldPath: string, newPath: string): DiffFile => {
    let status: DiffFile['status'] = 'MODIFIED';
    if (!oldPath && newPath) status = 'ADDED';
    else if (oldPath && !newPath) status = 'DELETED';
    else if (oldPath && newPath && oldPath !== newPath) status = 'RENAMED';
    return { oldPath, newPath, status, isBinary: false, hunks: [], additions: 0, deletions: 0 };
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      pushFile();
      continue;
    }
    if (line.startsWith('--- ')) {
      flushHunk();
      if (currentFile) {
        files.push(currentFile);
        currentFile = null;
      }
      pendingOldPath = stripGitPrefix(line.slice(4));
      continue;
    }
    if (line.startsWith('+++ ')) {
      currentFile = startFile(pendingOldPath ?? '', stripGitPrefix(line.slice(4)));
      pendingOldPath = null;
      continue;
    }
    if (line.startsWith('Binary files ') && line.includes(' differ')) {
      if (!currentFile) currentFile = startFile('', '');
      currentFile.isBinary = true;
      continue;
    }
    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      if (!currentFile) currentFile = startFile('', '');
      flushHunk();
      currentHunk = {
        oldStart: Number.parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] ? Number.parseInt(hunkMatch[2], 10) : 1,
        newStart: Number.parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] ? Number.parseInt(hunkMatch[4], 10) : 1,
        header: hunkMatch[5] || undefined,
        lines: [],
      };
      continue;
    }
    if (currentHunk && currentFile) {
      if (
        line.startsWith('+') ||
        line.startsWith('-') ||
        line.startsWith(' ') ||
        line.startsWith('\\')
      ) {
        currentHunk.lines.push(line);
        if (line.startsWith('+') && !line.startsWith('+++')) currentFile.additions += 1;
        else if (line.startsWith('-') && !line.startsWith('---')) currentFile.deletions += 1;
        continue;
      }
      flushHunk();
    }
  }
  pushFile();
  return files;
};
