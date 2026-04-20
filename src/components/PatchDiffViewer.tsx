/**
 * Render a unified-diff CODE_PATCH artifact as a structured per-file
 * viewer — file-level summary at the top, expandable hunks below with
 * `+` / `-` / context lines colour-coded.
 *
 * Deliberately framework-free: we re-parse the diff client-side with
 * the same grammar we ship server-side (see server/patch/validate.ts)
 * so the two stay in lockstep. This component does NOT import the
 * server parser — the dependency direction is fixed by the frontend
 * build — but the grammar is narrow enough to duplicate here safely.
 */
import React, { useMemo, useState } from 'react';
import type { CodePatchPayload } from '../types';

export interface PatchDiffViewerProps {
  /** Raw unified-diff text — typically `Artifact.contentText`. */
  content?: string;
  /** Structured payload — typically `Artifact.contentJson`. Optional; the viewer parses `content` when omitted. */
  payload?: CodePatchPayload;
  /** Controls whether the default view starts with all files collapsed. */
  defaultCollapsed?: boolean;
  /** Shown above the file list when provided. */
  caption?: string;
}

interface ViewerHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header?: string;
  lines: string[];
}

interface ViewerFile {
  oldPath: string;
  newPath: string;
  status: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED';
  isBinary: boolean;
  hunks: ViewerHunk[];
  additions: number;
  deletions: number;
}

const HUNK_HEADER_RE =
  /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@\s*(.*)$/;

const stripGitPrefix = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed === '/dev/null') return '';
  if (trimmed.startsWith('a/')) return trimmed.slice(2);
  if (trimmed.startsWith('b/')) return trimmed.slice(2);
  return trimmed;
};

const parse = (raw: string): ViewerFile[] => {
  if (!raw) return [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const files: ViewerFile[] = [];
  let currentFile: ViewerFile | null = null;
  let currentHunk: ViewerHunk | null = null;
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

  const startFile = (oldPath: string, newPath: string): ViewerFile => {
    let status: ViewerFile['status'] = 'MODIFIED';
    if (!oldPath && newPath) status = 'ADDED';
    else if (oldPath && !newPath) status = 'DELETED';
    else if (oldPath && newPath && oldPath !== newPath) status = 'RENAMED';
    return {
      oldPath,
      newPath,
      status,
      isBinary: false,
      hunks: [],
      additions: 0,
      deletions: 0,
    };
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
        if (line.startsWith('+') && !line.startsWith('+++')) {
          currentFile.additions += 1;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          currentFile.deletions += 1;
        }
        continue;
      }
      flushHunk();
    }
  }
  pushFile();
  return files;
};

const statusTone: Record<ViewerFile['status'], string> = {
  ADDED: 'bg-emerald-100 text-emerald-700',
  MODIFIED: 'bg-sky-100 text-sky-700',
  DELETED: 'bg-rose-100 text-rose-700',
  RENAMED: 'bg-amber-100 text-amber-700',
};

const LineRow = ({ line }: { line: string }) => {
  const first = line[0] || ' ';
  let tone = '';
  if (first === '+') tone = 'bg-emerald-50 text-emerald-800';
  else if (first === '-') tone = 'bg-rose-50 text-rose-800';
  else if (first === '\\') tone = 'bg-slate-50 italic text-slate-500';
  else tone = 'text-slate-700';
  return (
    <pre
      className={`whitespace-pre overflow-x-auto px-3 py-[2px] font-mono text-[0.72rem] leading-[1.35rem] ${tone}`}
    >
      {line || ' '}
    </pre>
  );
};

const FileBlock = ({
  file,
  defaultCollapsed,
}: {
  file: ViewerFile;
  defaultCollapsed: boolean;
}) => {
  const [open, setOpen] = useState(!defaultCollapsed);
  const path = file.newPath || file.oldPath || '(unknown)';
  const renameHint =
    file.status === 'RENAMED' && file.oldPath && file.newPath
      ? `${file.oldPath} → ${file.newPath}`
      : null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[0.78rem] text-slate-900">
            {renameHint ?? path}
          </p>
          <p className="mt-0.5 text-[0.6875rem] uppercase tracking-[0.2em] text-outline">
            {file.hunks.length} hunk{file.hunks.length === 1 ? '' : 's'}
            {file.isBinary ? ' · binary' : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[0.6875rem] font-semibold">
          <span
            className={`rounded-full px-2 py-0.5 ${statusTone[file.status]}`}
          >
            {file.status}
          </span>
          <span className="text-emerald-600">+{file.additions}</span>
          <span className="text-rose-600">−{file.deletions}</span>
          <span aria-hidden className="text-outline">
            {open ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {open && !file.isBinary ? (
        <div className="border-t border-slate-100">
          {file.hunks.length === 0 ? (
            <p className="px-4 py-3 text-xs text-secondary">
              This file has no hunks (empty patch).
            </p>
          ) : (
            file.hunks.map((hunk, idx) => (
              <div key={idx} className="border-b border-slate-100 last:border-b-0">
                <div className="bg-slate-50 px-3 py-1 font-mono text-[0.6875rem] text-slate-500">
                  @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
                  {hunk.newLines} @@
                  {hunk.header ? (
                    <span className="pl-2 text-slate-400">{hunk.header}</span>
                  ) : null}
                </div>
                <div>
                  {hunk.lines.map((line, lineIdx) => (
                    <LineRow key={lineIdx} line={line} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {open && file.isBinary ? (
        <div className="border-t border-slate-100 px-4 py-3 text-xs text-secondary">
          Binary file — preview unavailable. The apply step will skip this entry.
        </div>
      ) : null}
    </div>
  );
};

const PatchDiffViewer: React.FC<PatchDiffViewerProps> = ({
  content,
  payload,
  defaultCollapsed = false,
  caption,
}) => {
  const files = useMemo(() => parse(content || ''), [content]);
  const totalAdditions =
    payload?.totalAdditions ?? files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions =
    payload?.totalDeletions ?? files.reduce((s, f) => s + f.deletions, 0);
  const validation = payload?.validation;

  if (!content?.trim() && !files.length) {
    return (
      <p className="text-sm leading-relaxed text-secondary">
        This CODE_PATCH artifact has no unified-diff body yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
        <div className="min-w-0">
          {caption ? (
            <p className="font-semibold text-primary">{caption}</p>
          ) : null}
          <p className="text-secondary">
            {files.length} file{files.length === 1 ? '' : 's'} changed
            {payload?.repositoryLabel
              ? ` · ${payload.repositoryLabel}`
              : ''}
            {payload?.targetBranch ? ` · ${payload.targetBranch}` : ''}
            {payload?.baseSha ? ` · ${payload.baseSha.slice(0, 7)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[0.6875rem] font-semibold">
          <span className="text-emerald-600">+{totalAdditions}</span>
          <span className="text-rose-600">−{totalDeletions}</span>
        </div>
      </div>

      {validation && !validation.ok ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          <p className="font-semibold">Patch failed validation</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {validation.errors.slice(0, 8).map((msg, idx) => (
              <li key={idx}>{msg}</li>
            ))}
            {validation.errors.length > 8 ? (
              <li>+ {validation.errors.length - 8} more…</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {validation?.warnings?.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          <p className="font-semibold">Warnings</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {validation.warnings.slice(0, 8).map((msg, idx) => (
              <li key={idx}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2">
        {files.map((file, idx) => (
          <FileBlock
            key={`${file.newPath || file.oldPath}-${idx}`}
            file={file}
            defaultCollapsed={defaultCollapsed}
          />
        ))}
      </div>
    </div>
  );
};

export default PatchDiffViewer;
