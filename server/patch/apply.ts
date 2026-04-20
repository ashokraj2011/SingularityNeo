/**
 * In-memory unified-diff application.
 *
 * Given a parsed patch (see ./validate.ts) and a map of
 * `filePath -> originalContent`, produce
 * `filePath -> { applied: boolean, resultContent, conflicts }`.
 *
 * Phase B scope is "compute what the post-patch tree would look like"
 * — we explicitly do NOT touch the filesystem or call git. Phase C
 * picks up the resulting per-file map and turns it into a branch +
 * commit + PR via Octokit.
 *
 * Matching strategy: for every hunk we trust the hunk header's
 * `oldStart` line first (strict mode). If the original content at that
 * position doesn't match the hunk's context/`-` lines, we fall back to
 * searching a small ±20-line window for a match, then record a
 * `conflict` and leave the file unmodified. That tolerance handles the
 * common case where an agent's patch was generated against a base SHA
 * that drifted by a few lines, without opening us up to applying a
 * patch to the wrong region.
 */
import type { ParsedHunk, ParsedPatch } from './validate';

export interface FileApplyResult {
  /** True when all hunks landed cleanly. */
  applied: boolean;
  /** Reason/status when `applied` is false. */
  status:
    | 'CLEAN'
    | 'CONFLICT'
    | 'MISSING_ORIGINAL'
    | 'BINARY_SKIPPED'
    | 'DELETED'
    | 'CREATED';
  /**
   * The post-apply content. For deleted files this is an empty string
   * with `status: 'DELETED'`. For binary / conflicted files this is
   * the unchanged original.
   */
  resultContent: string;
  /**
   * Any hunks that couldn't be placed. Indexes into the file's hunk list.
   */
  conflicts: Array<{
    hunkIndex: number;
    reason: string;
    /** 1-indexed line where we attempted to apply. */
    attemptedAtLine: number;
  }>;
}

export interface PatchApplyResult {
  /** One entry per file in the parsed patch, keyed by new-side path. */
  perFile: Record<string, FileApplyResult>;
  cleanFiles: number;
  conflictFiles: number;
}

/** Rebuild the original-side of a hunk by concatenating context + `-` lines (no `+`, no `\`). */
const oldSideOf = (hunk: ParsedHunk): string[] =>
  hunk.lines
    .filter(line => !line.startsWith('+') && !line.startsWith('\\'))
    .map(line => (line.length ? line.slice(1) : ''));

/** Rebuild the new-side (context + `+`). */
const newSideOf = (hunk: ParsedHunk): string[] =>
  hunk.lines
    .filter(line => !line.startsWith('-') && !line.startsWith('\\'))
    .map(line => (line.length ? line.slice(1) : ''));

/**
 * Does `needle` match `lines[offset..offset+needle.length]` exactly?
 * Used to verify the original content's context before we splice the
 * new side in.
 */
const matchesAt = (
  lines: string[],
  offset: number,
  needle: string[],
): boolean => {
  if (offset < 0 || offset + needle.length > lines.length) return false;
  for (let i = 0; i < needle.length; i++) {
    if (lines[offset + i] !== needle[i]) return false;
  }
  return true;
};

/**
 * Scan a bounded window around `preferredOffset` for an exact match of
 * `needle`. Returns -1 if no match. We stay near the hunk's advertised
 * location rather than searching the whole file, both for speed and
 * to avoid applying a hunk at a semantically wrong spot that happens
 * to be textually identical (rare, but possible for one-liner hunks).
 */
const FUZZY_WINDOW = 20;
const findBestMatch = (
  lines: string[],
  preferredOffset: number,
  needle: string[],
): number => {
  if (matchesAt(lines, preferredOffset, needle)) return preferredOffset;
  for (let delta = 1; delta <= FUZZY_WINDOW; delta++) {
    if (matchesAt(lines, preferredOffset - delta, needle)) {
      return preferredOffset - delta;
    }
    if (matchesAt(lines, preferredOffset + delta, needle)) {
      return preferredOffset + delta;
    }
  }
  return -1;
};

/**
 * Apply every hunk of one file to one original string. Returns the
 * post-apply content. The caller is responsible for detecting
 * `MISSING_ORIGINAL` when a `MODIFIED` file's original isn't in the
 * supplied map.
 */
export const applyHunksToContent = (
  original: string,
  hunks: ParsedHunk[],
): { resultContent: string; conflicts: FileApplyResult['conflicts'] } => {
  // Split preserving trailing newline semantics: a file ending with
  // `\n` produces a trailing empty entry we need to handle symmetrically.
  const lines = original.split('\n');
  const conflicts: FileApplyResult['conflicts'] = [];

  // We apply hunks in order and track a running offset so hunk N's
  // target line number is adjusted for the length changes of hunks
  // 0..N-1. Each hunk header is relative to the *original* file.
  let runningOffset = 0;
  // We mutate `lines` in place.
  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h];
    const oldSide = oldSideOf(hunk);
    const newSide = newSideOf(hunk);

    // `oldStart` is 1-indexed. An oldStart of 0 means "before line 1"
    // which only happens for pure additions with oldLines=0.
    const preferredOffset =
      hunk.oldLines === 0
        ? Math.max(0, hunk.oldStart) + runningOffset
        : Math.max(0, hunk.oldStart - 1) + runningOffset;

    // Pure addition: no original content to match, splice directly.
    if (hunk.oldLines === 0) {
      lines.splice(preferredOffset, 0, ...newSide);
      runningOffset += newSide.length;
      continue;
    }

    const matchAt = findBestMatch(lines, preferredOffset, oldSide);
    if (matchAt === -1) {
      conflicts.push({
        hunkIndex: h,
        reason:
          'Context did not match the original content within the fuzzy window.',
        attemptedAtLine: hunk.oldStart,
      });
      continue;
    }

    lines.splice(matchAt, oldSide.length, ...newSide);
    runningOffset += newSide.length - oldSide.length;
  }

  return { resultContent: lines.join('\n'), conflicts };
};

/**
 * Apply an entire parsed patch to a bag of file originals. Returns one
 * result per file. Files listed in the patch but missing from the
 * original map are flagged MISSING_ORIGINAL (the caller — Phase C —
 * will typically pre-fetch them via Octokit blobs).
 *
 * Added files (status: 'ADDED') don't require an original; their
 * post-apply content is the new-side assembly.
 * Deleted files (status: 'DELETED') produce an empty `resultContent`
 * so the caller can decide whether to issue a delete on the commit.
 */
export const applyPatch = (
  patch: ParsedPatch,
  originals: Record<string, string | null | undefined>,
): PatchApplyResult => {
  const perFile: Record<string, FileApplyResult> = {};
  let cleanFiles = 0;
  let conflictFiles = 0;

  for (const file of patch.files) {
    const key = file.newPath || file.oldPath || '(anonymous)';

    if (file.isBinary) {
      perFile[key] = {
        applied: false,
        status: 'BINARY_SKIPPED',
        resultContent: '',
        conflicts: [],
      };
      continue;
    }

    if (file.status === 'ADDED') {
      // Assemble new-side lines from every hunk (typically just one).
      const assembled: string[] = [];
      for (const hunk of file.hunks) {
        assembled.push(...newSideOf(hunk));
      }
      perFile[key] = {
        applied: true,
        status: 'CREATED',
        resultContent: assembled.join('\n'),
        conflicts: [],
      };
      cleanFiles += 1;
      continue;
    }

    if (file.status === 'DELETED') {
      perFile[key] = {
        applied: true,
        status: 'DELETED',
        resultContent: '',
        conflicts: [],
      };
      cleanFiles += 1;
      continue;
    }

    const lookupKey = file.oldPath || file.newPath;
    const original = lookupKey ? originals[lookupKey] : undefined;
    if (typeof original !== 'string') {
      perFile[key] = {
        applied: false,
        status: 'MISSING_ORIGINAL',
        resultContent: '',
        conflicts: [],
      };
      continue;
    }

    const { resultContent, conflicts } = applyHunksToContent(
      original,
      file.hunks,
    );
    const applied = conflicts.length === 0;
    perFile[key] = {
      applied,
      status: applied ? 'CLEAN' : 'CONFLICT',
      resultContent: applied ? resultContent : original,
      conflicts,
    };
    if (applied) cleanFiles += 1;
    else conflictFiles += 1;
  }

  return { perFile, cleanFiles, conflictFiles };
};

/**
 * List of file paths this patch expects to find originals for. Useful
 * when the caller (Phase C) needs to pre-fetch blobs from GitHub
 * before running `applyPatch`.
 */
export const collectPatchSources = (patch: ParsedPatch): string[] => {
  const paths = new Set<string>();
  for (const file of patch.files) {
    if (file.isBinary) continue;
    if (file.status === 'MODIFIED' || file.status === 'DELETED' || file.status === 'RENAMED') {
      const key = file.oldPath || file.newPath;
      if (key) paths.add(key);
    }
  }
  return Array.from(paths);
};
