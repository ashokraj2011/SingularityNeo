/**
 * VSCode-style diff viewer for CODE_DIFF / CODE_PATCH artifacts.
 *
 * Parses a unified-diff blob into per-file hunks, reconstructs the
 * before/after text *from the hunks alone* (no GitHub round-trip), and
 * renders each selected file in a Monaco `DiffEditor` pane. Good enough
 * for "review what the agent changed"; not trying to be a full IDE.
 *
 * Design notes:
 *   - The parser is copy-compatible with the one in PatchDiffViewer.tsx
 *     (same grammar, same HUNK_HEADER_RE). Duplication is intentional
 *     for now — the two viewers can coexist, and we can extract to a
 *     shared util in a follow-up once both callers are locked.
 *   - Hunk-only reconstruction means the diff shows only the changed
 *     regions + their 3-line context, not the whole file. That matches
 *     how GitHub's compact diff view works, and avoids an auth'd
 *     round-trip to fetch base revisions. A "load full file" button
 *     is a logical step-2 enhancement.
 *   - Monaco worker + loader bootstrap is done lazily the first time
 *     this component mounts; see `./lib/monacoBootstrap.ts`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { bootstrapMonaco } from '../lib/monacoBootstrap';
import {
  type DiffFile,
  type DiffHunk,
  parseUnifiedDiff,
} from '../lib/diffParser';

// ─────────────────────────────────────────────────────────────────────
// Hunk → original/modified reconstruction
//
// For each hunk, we emit the context + removed lines into the "original"
// buffer and context + added lines into the "modified" buffer. Hunks
// are separated by a header line (`@@ -a,b +c,d @@ optional-header`) so
// the reader can see the skipped regions. This mirrors GitHub's
// "compact" view — we're not reconstructing full files.
// ─────────────────────────────────────────────────────────────────────

interface ReconstructedSides {
  original: string;
  modified: string;
}

const reconstructSides = (file: DiffFile): ReconstructedSides => {
  const original: string[] = [];
  const modified: string[] = [];
  for (const hunk of file.hunks) {
    const headerSuffix = hunk.header ? ` ${hunk.header}` : '';
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${headerSuffix}`;
    // Prefix blank line between hunks for readability in the editor.
    if (original.length > 0) original.push('');
    if (modified.length > 0) modified.push('');
    original.push(header);
    modified.push(header);
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue; // "\ No newline at end of file"
      const first = line[0];
      const body = line.slice(1);
      if (first === '+') {
        modified.push(body);
      } else if (first === '-') {
        original.push(body);
      } else {
        original.push(body);
        modified.push(body);
      }
    }
  }
  return {
    original: original.join('\n'),
    modified: modified.join('\n'),
  };
};

// ─────────────────────────────────────────────────────────────────────
// Language inference from file extension
//
// Kept deliberately small — Monaco has a much larger registry but
// every language id we pass in must be one the runtime recognises, or
// it silently falls back to "plaintext" and costs a console warning.
// Extend the table as new file types show up in diffs.
// ─────────────────────────────────────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  dockerfile: 'dockerfile',
  toml: 'ini',
  xml: 'xml',
};

const inferLanguage = (path: string): string => {
  const base = path.split('/').pop() || path;
  if (base.toLowerCase() === 'dockerfile') return 'dockerfile';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'plaintext';
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_TO_LANGUAGE[ext] || 'plaintext';
};

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

const statusTone: Record<DiffFile['status'], string> = {
  ADDED: 'bg-emerald-100 text-emerald-700',
  MODIFIED: 'bg-sky-100 text-sky-700',
  DELETED: 'bg-rose-100 text-rose-700',
  RENAMED: 'bg-amber-100 text-amber-700',
};

export interface ArtifactDiffViewerProps {
  /** Raw unified-diff text. */
  patchText: string;
  /** Optional caption/filename label above the editor. */
  caption?: string;
  /** Editor height in px. Defaults to 420. */
  height?: number;
}

const ArtifactDiffViewer = ({
  patchText,
  caption,
  height = 420,
}: ArtifactDiffViewerProps) => {
  // Bootstrap Monaco's local loader + worker on first mount. Idempotent.
  useEffect(() => {
    bootstrapMonaco();
  }, []);

  const files = useMemo(() => parseUnifiedDiff(patchText || ''), [patchText]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Clamp to the current file list so removing a file doesn't leave
  // `selectedIdx` pointing past the end.
  const safeIdx = files.length === 0 ? 0 : Math.min(selectedIdx, files.length - 1);
  const active = files[safeIdx] ?? null;

  // All hook calls happen BEFORE the empty-files early return so React's
  // rules-of-hooks stay happy across re-renders with different patch text.
  const sides = useMemo(
    () => (active ? reconstructSides(active) : { original: '', modified: '' }),
    [active],
  );
  const language = useMemo(
    () => (active ? inferLanguage(active.newPath || active.oldPath || '') : 'plaintext'),
    [active],
  );

  if (files.length === 0 || !active) {
    return (
      <p className="text-sm leading-relaxed text-secondary">
        No diff content could be parsed from this artifact.
      </p>
    );
  }

  const activePath = active.newPath || active.oldPath || '(unknown)';

  return (
    <div className="overflow-hidden rounded-2xl border border-outline-variant/35 bg-white">
      {caption ? (
        <div className="border-b border-outline-variant/35 bg-surface-container-low px-4 py-2 text-xs font-semibold uppercase tracking-wide text-secondary">
          {caption}
        </div>
      ) : null}

      <div className="flex flex-col md:flex-row">
        {/* File list — left rail */}
        <aside className="w-full shrink-0 border-b border-outline-variant/35 bg-surface-container-low md:w-64 md:border-b-0 md:border-r">
          <ul className="max-h-80 overflow-y-auto py-1 md:max-h-[420px]">
            {files.map((file, idx) => {
              const path = file.newPath || file.oldPath || '(unknown)';
              const isActive = idx === selectedIdx;
              return (
                <li key={`${path}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => setSelectedIdx(idx)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                      isActive
                        ? 'bg-white text-on-surface shadow-[inset_2px_0_0_0_rgba(16,185,129,0.8)]'
                        : 'text-secondary hover:bg-white/60'
                    }`}
                    title={path}
                  >
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] font-bold uppercase ${statusTone[file.status]}`}
                    >
                      {file.status.slice(0, 3)}
                    </span>
                    <span className="flex-1 truncate font-mono">{path}</span>
                    <span className="shrink-0 font-mono text-[0.6875rem] text-emerald-700">
                      +{file.additions}
                    </span>
                    <span className="shrink-0 font-mono text-[0.6875rem] text-rose-700">
                      -{file.deletions}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Diff pane — right */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 border-b border-outline-variant/35 bg-white px-4 py-2">
            <div className="min-w-0 truncate font-mono text-xs text-on-surface">
              {activePath}
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[0.6875rem] font-mono">
              <span className="text-emerald-700">+{active.additions}</span>
              <span className="text-rose-700">-{active.deletions}</span>
              <span className="uppercase tracking-wide text-secondary">
                {language}
              </span>
            </div>
          </div>

          {active.isBinary ? (
            <div className="px-4 py-6 text-sm italic text-secondary">
              Binary file — no inline diff available.
            </div>
          ) : active.hunks.length === 0 ? (
            <div className="px-4 py-6 text-sm italic text-secondary">
              File listed with no hunks (likely a rename without content change).
            </div>
          ) : (
            <DiffEditor
              height={height}
              language={language}
              original={sides.original}
              modified={sides.modified}
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontSize: 12,
                fontFamily:
                  "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                renderWhitespace: 'selection',
                wordWrap: 'off',
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ArtifactDiffViewer;
