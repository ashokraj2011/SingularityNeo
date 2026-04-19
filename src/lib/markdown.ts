export const stripMarkdownToText = (value?: string) =>
  String(value || '')
    .replace(/```[\s\S]*?```/g, match =>
      match
        .replace(/^```[\w-]*\n?/, '')
        .replace(/```$/, '')
        .trim(),
    )
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+(?:\s*:?-{3,}:?\s*)?$/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/^-{3,}$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

export const compactMarkdownPreview = (value?: string, maxLength = 220) => {
  const safeSubstring = String(value || '').slice(0, maxLength * 3 + 100);
  const plainText = stripMarkdownToText(safeSubstring);
  if (plainText.length <= maxLength && safeSubstring.length === String(value || '').length) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength).trimEnd()}...`;
};
