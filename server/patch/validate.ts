/**
 * Unified-diff parser + validator for CODE_PATCH artifacts.
 *
 * We deliberately do not pull in `jsdiff` / `parse-diff` — a unified
 * diff is a simple line-oriented format and the pieces we care about
 * (file headers, hunk headers, +/- lines) have a narrow, testable
 * grammar. Keeping the dependency surface small matters for the
 * sandboxed agent runtime.
 *
 * What this module does:
 *   - `parseUnifiedDiff(raw)` — structured representation (files + hunks)
 *   - `computePatchStats(parsed)` — rollup counts used to populate
 *     `CodePatchPayload`
 *   - `validatePatch(raw)` — parse + sanity-check + hunk-header math so
 *     we refuse to persist malformed patches
 *
 * What it explicitly does not do:
 *   - Touch the filesystem
 *   - Apply the patch (see ./apply.ts)
 *   - Talk to git / GitHub
 */
import type {
  CodePatchFileStat,
  CodePatchPayload,
} from '../../src/types';

export interface ParsedHunk {
  /** Old-side starting line, 1-indexed as in the hunk header `-L,C`. */
  oldStart: number;
  oldLines: number;
  /** New-side starting line. */
  newStart: number;
  newLines: number;
  /** Header text after the `@@ ... @@` marker (function context hint). */
  header?: string;
  /**
   * Raw body lines with their leading `+`, `-`, or ` ` preserved.
   * The parser strips the trailing newline so each entry is one body row.
   */
  lines: string[];
}

export interface ParsedFile {
  oldPath: string;
  newPath: string;
  status: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED';
  isBinary: boolean;
  hunks: ParsedHunk[];
}

export interface ParsedPatch {
  files: ParsedFile[];
}

/**
 * Strip the leading `a/` or `b/` that git conventionally prepends to
 * old/new paths. Standalone diffs (`diff -u`) don't include the
 * prefix, so we only strip when we see it.
 */
const stripGitPrefix = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed === '/dev/null') return '';
  if (trimmed.startsWith('a/')) return trimmed.slice(2);
  if (trimmed.startsWith('b/')) return trimmed.slice(2);
  return trimmed;
};

const HUNK_HEADER_RE =
  /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@\s*(.*)$/;

/**
 * Parse a unified-diff string into a structured representation.
 *
 * The parser tolerates:
 *   - Missing file headers when only `@@` markers are present (treated
 *     as a single anonymous file — rare but valid `diff -u` output).
 *   - Windows line endings (stripped).
 *   - Binary-file markers (the file enters the list with `isBinary=true`
 *     and an empty hunks array).
 *
 * The parser refuses:
 *   - Hunks whose line count doesn't match the header's `old,new`
 *     counts — surfaced via `validatePatch()` as an error, not an
 *     exception, so bad agent output shows up in the UI as a failed
 *     validation rather than a 500.
 */
export const parseUnifiedDiff = (raw: string): ParsedPatch => {
  if (!raw || typeof raw !== 'string') return { files: [] };
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  const files: ParsedFile[] = [];
  let currentFile: ParsedFile | null = null;
  let currentHunk: ParsedHunk | null = null;
  let pendingOldPath: string | null = null;

  const pushFile = () => {
    if (currentFile) {
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
        currentHunk = null;
      }
      files.push(currentFile);
    }
    currentFile = null;
    pendingOldPath = null;
  };

  const startFile = (oldPath: string, newPath: string): ParsedFile => {
    let status: ParsedFile['status'] = 'MODIFIED';
    if (!oldPath && newPath) status = 'ADDED';
    else if (oldPath && !newPath) status = 'DELETED';
    else if (oldPath && newPath && oldPath !== newPath) status = 'RENAMED';
    return {
      oldPath,
      newPath,
      status,
      isBinary: false,
      hunks: [],
    };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // `diff --git a/x b/y` — boundary between files. We only use this
    // to close out the previous file; the actual paths come from the
    // `--- ` / `+++ ` headers that follow.
    if (line.startsWith('diff --git ')) {
      pushFile();
      continue;
    }

    if (line.startsWith('--- ')) {
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk);
        currentHunk = null;
      }
      if (currentFile) {
        files.push(currentFile);
        currentFile = null;
      }
      pendingOldPath = stripGitPrefix(line.slice(4));
      continue;
    }

    if (line.startsWith('+++ ')) {
      const newPath = stripGitPrefix(line.slice(4));
      currentFile = startFile(pendingOldPath ?? '', newPath);
      pendingOldPath = null;
      continue;
    }

    // Binary-file marker — persists the file entry but we can't apply
    // binary hunks from a unified diff on their own.
    if (line.startsWith('Binary files ') && line.includes(' differ')) {
      if (!currentFile) {
        currentFile = startFile('', '');
      }
      currentFile.isBinary = true;
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      if (!currentFile) {
        // Anonymous diff (no file headers) — synthesize a placeholder.
        currentFile = startFile('', '');
      }
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
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

    // Hunk body — accumulate while we're inside one.
    if (currentHunk && currentFile) {
      // Some tools emit `\ No newline at end of file` — keep it around
      // so apply.ts can honour the no-trailing-newline case, but don't
      // count it toward additions/deletions.
      if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line.startsWith('\\')) {
        currentHunk.lines.push(line);
        continue;
      }
      // Anything else ends the current hunk.
      currentFile.hunks.push(currentHunk);
      currentHunk = null;
    }
  }

  pushFile();
  return { files };
};

/**
 * Roll parsed files up into the `CodePatchPayload.files` + total
 * counts. Pure.
 */
export const computePatchStats = (
  parsed: ParsedPatch,
): {
  files: CodePatchFileStat[];
  totalAdditions: number;
  totalDeletions: number;
} => {
  let totalAdditions = 0;
  let totalDeletions = 0;
  const files: CodePatchFileStat[] = parsed.files.map(file => {
    let additions = 0;
    let deletions = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
        else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
      }
    }
    totalAdditions += additions;
    totalDeletions += deletions;
    return {
      path: file.newPath || file.oldPath,
      oldPath: file.oldPath || undefined,
      status: file.status,
      additions,
      deletions,
      hunkCount: file.hunks.length,
      isBinary: file.isBinary || undefined,
    };
  });
  return { files, totalAdditions, totalDeletions };
};

export interface PatchValidationResult {
  ok: boolean;
  parsed: ParsedPatch;
  stats: {
    files: CodePatchFileStat[];
    totalAdditions: number;
    totalDeletions: number;
  };
  errors: string[];
  warnings: string[];
}

/**
 * Parse + sanity-check a unified-diff payload. Returns structured
 * errors rather than throwing so the caller can persist a
 * `CodePatchPayload` with `validation.ok = false` and let operators
 * see the problem in the UI instead of getting a 500.
 */
export const validatePatch = (raw: string): PatchValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || !raw.trim()) {
    return {
      ok: false,
      parsed: { files: [] },
      stats: { files: [], totalAdditions: 0, totalDeletions: 0 },
      errors: ['Patch body is empty.'],
      warnings: [],
    };
  }

  const parsed = parseUnifiedDiff(raw);
  if (!parsed.files.length) {
    errors.push('No file headers or hunks detected in the patch.');
  }

  for (const file of parsed.files) {
    if (file.isBinary) {
      warnings.push(
        `Binary file marker present for ${file.newPath || file.oldPath || '(unknown)'} — apply step will skip it.`,
      );
      continue;
    }
    if (!file.newPath && !file.oldPath) {
      errors.push('File entry missing both old and new path.');
      continue;
    }
    if (!file.hunks.length) {
      warnings.push(
        `File ${file.newPath || file.oldPath} has no hunks (empty patch).`,
      );
      continue;
    }
    for (const hunk of file.hunks) {
      let oldObserved = 0;
      let newObserved = 0;
      for (const line of hunk.lines) {
        if (line.startsWith('\\')) continue; // `\ No newline at end of file`
        if (line.startsWith('-')) oldObserved += 1;
        else if (line.startsWith('+')) newObserved += 1;
        else {
          oldObserved += 1;
          newObserved += 1;
        }
      }
      if (oldObserved !== hunk.oldLines) {
        errors.push(
          `Hunk in ${file.newPath || file.oldPath} @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@: expected ${hunk.oldLines} old-side lines, saw ${oldObserved}.`,
        );
      }
      if (newObserved !== hunk.newLines) {
        errors.push(
          `Hunk in ${file.newPath || file.oldPath} @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@: expected ${hunk.newLines} new-side lines, saw ${newObserved}.`,
        );
      }
    }
  }

  const stats = computePatchStats(parsed);
  return {
    ok: errors.length === 0,
    parsed,
    stats,
    errors,
    warnings,
  };
};

/**
 * Convenience: build the `CodePatchPayload` that gets stored in
 * `Artifact.contentJson` given the raw diff + any known targeting
 * metadata (repo + base SHA + target branch come from the BUILD step's
 * context, not the diff text itself).
 */
export const buildCodePatchPayload = (
  raw: string,
  meta: {
    repositoryId?: string;
    repositoryLabel?: string;
    baseSha?: string;
    targetBranch?: string;
    summary?: string;
  } = {},
): CodePatchPayload => {
  const result = validatePatch(raw);
  return {
    repositoryId: meta.repositoryId,
    repositoryLabel: meta.repositoryLabel,
    baseSha: meta.baseSha,
    targetBranch: meta.targetBranch,
    summary: meta.summary,
    files: result.stats.files,
    totalAdditions: result.stats.totalAdditions,
    totalDeletions: result.stats.totalDeletions,
    validation: {
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
    },
  };
};
