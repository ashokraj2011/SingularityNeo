import MarkdownContent from './MarkdownContent';

type ArtifactPreviewProps = {
  content?: string;
  format?: string;
  emptyLabel?: string;
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

const ArtifactPreview = ({
  content,
  format,
  emptyLabel = 'This artifact does not have previewable content yet.',
}: ArtifactPreviewProps) => {
  if (!content?.trim()) {
    return <p className="text-sm leading-relaxed text-secondary">{emptyLabel}</p>;
  }

  if (format === 'JSON') {
    return (
      <pre className="overflow-x-auto rounded-2xl border border-outline-variant/35 bg-slate-950 px-4 py-3 text-[0.8125rem] leading-6 text-slate-100">
        <code>{content}</code>
      </pre>
    );
  }

  if (format === 'MARKDOWN') {
    return <MarkdownArtifactPreview content={content} emptyLabel={emptyLabel} />;
  }

  return <p className="whitespace-pre-wrap text-sm leading-7 text-secondary">{content}</p>;
};

export default ArtifactPreview;
