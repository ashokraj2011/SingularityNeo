import React, { useMemo, useState } from 'react';
import MarkdownContent from './MarkdownContent';

type ArtifactPreviewProps = {
  content?: string;
  format?: string;
  jsonValue?: unknown;
  emptyLabel?: string;
  maxChars?: number;
  maxLines?: number;
};

export const MarkdownArtifactPreview = ({
  content,
  emptyLabel = 'This artifact does not have previewable Markdown content yet.',
}: {
  content?: string;
  emptyLabel?: string;
}) => {
  if (!content?.trim()) {
    return <p className="text-sm leading-relaxed text-secondary">{emptyLabel}</p>;
  }

  return <MarkdownContent content={content} />;
};

const truncateText = ({
  content,
  maxChars,
  maxLines,
}: {
  content: string;
  maxChars: number;
  maxLines: number;
}) => {
  const normalized = content || '';
  if (!normalized.trim()) {
    return {
      preview: '',
      truncated: false,
      totalChars: 0,
      totalLines: 0,
    };
  }

  const totalChars = normalized.length;

  // Avoid `split()` here: for very large artifacts it can allocate huge arrays and lock the UI.
  // Instead, scan just enough to create a bounded preview and (optionally) count lines.
  let previewEndIndex = Math.min(totalChars, maxChars);
  let truncated = totalChars > maxChars;

  if (maxLines > 0 && totalChars > 0) {
    let newlinesSeen = 0;

    // Only scan as far as our current preview end; if we hit maxLines first, cut earlier.
    for (let i = 0; i < previewEndIndex; i += 1) {
      if (normalized[i] !== '\n') continue;
      newlinesSeen += 1;
      if (newlinesSeen === maxLines) {
        previewEndIndex = i; // exclude the newline itself (matches previous join behavior)
        truncated = true;
        break;
      }
    }
  }

  let preview = normalized.slice(0, previewEndIndex);

  const LINE_COUNT_SCAN_LIMIT = 1_000_000;
  let totalLines: number;
  if (totalChars <= LINE_COUNT_SCAN_LIMIT) {
    let newlineCount = 0;
    for (let i = 0; i < totalChars; i += 1) {
      if (normalized[i] === '\n') newlineCount += 1;
    }
    totalLines = newlineCount + 1;
  } else if (truncated) {
    // For extremely large payloads, avoid scanning the full content.
    totalLines = maxLines + 1;
  } else {
    // If callers opted into a huge preview, pay the linear scan cost without allocating arrays.
    let newlineCount = 0;
    for (let i = 0; i < totalChars; i += 1) {
      if (normalized[i] === '\n') newlineCount += 1;
    }
    totalLines = newlineCount + 1;
  }

  if (truncated) {
    preview = `${preview.trimEnd()}\n\n…`;
  }

  return {
    preview,
    truncated,
    totalChars,
    totalLines,
  };
};

const ArtifactPreview = ({
  content,
  format,
  jsonValue,
  emptyLabel = 'This artifact does not have previewable content yet.',
  maxChars = 24_000,
  maxLines = 500,
}: ArtifactPreviewProps) => {
  const normalizedContent = String(content || '');
  const [isExpanded, setIsExpanded] = useState(false);
  const [renderJson, setRenderJson] = useState(false);

  const shouldTreatAsJson = format === 'JSON' && jsonValue !== undefined;
  const resolvedContent = useMemo(() => {
    if (!shouldTreatAsJson) {
      return normalizedContent;
    }

    if (!renderJson) {
      return '';
    }

    try {
      return JSON.stringify(jsonValue, null, 2);
    } catch {
      return 'Unable to render JSON preview.';
    }
  }, [jsonValue, normalizedContent, renderJson, shouldTreatAsJson]);

  const truncation = useMemo(
    () =>
      truncateText({
        content: resolvedContent,
        maxChars,
        maxLines,
      }),
    [maxChars, maxLines, resolvedContent],
  );
  const displayContent = isExpanded ? resolvedContent : truncation.preview;

  if (!shouldTreatAsJson && !normalizedContent.trim()) {
    return <p className="text-sm leading-relaxed text-secondary">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      {shouldTreatAsJson && !renderJson ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-outline-variant/35 bg-white px-3 py-2">
          <p className="text-xs font-semibold text-secondary">
            JSON payload detected. Rendering is on-demand to keep the UI responsive.
          </p>
          <button
            type="button"
            onClick={() => setRenderJson(true)}
            className="rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-1.5 text-xs font-bold text-on-surface transition hover:border-primary/20 hover:bg-white"
          >
            Render JSON preview
          </button>
        </div>
      ) : truncation.truncated ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">
            Preview truncated (showing {Math.min(truncation.totalLines, maxLines)} lines,{' '}
            {Math.min(truncation.totalChars, maxChars).toLocaleString()} chars).
          </p>
          <button
            type="button"
            onClick={() => setIsExpanded(current => !current)}
            className="rounded-xl border border-amber-200 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 transition hover:border-amber-300"
          >
            {isExpanded ? 'Collapse' : 'Show full'}
          </button>
        </div>
      ) : null}

      {format === 'JSON' ? (
        <pre className="overflow-x-auto rounded-2xl border border-outline-variant/35 bg-slate-950 px-4 py-3 text-[0.8125rem] leading-6 text-slate-100">
          <code>{displayContent}</code>
        </pre>
      ) : format === 'MARKDOWN' ? (
        <MarkdownArtifactPreview content={displayContent} emptyLabel={emptyLabel} />
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-7 text-secondary">
          {displayContent}
        </p>
      )}
    </div>
  );
};

export default ArtifactPreview;
