import { describe, expect, it } from 'vitest';
import { compactMarkdownPreview, stripMarkdownToText } from '../markdown';

describe('markdown preview helpers', () => {
  it('removes common markdown syntax from compact previews', () => {
    expect(
      stripMarkdownToText(
        '## Acceptance Criteria\n\n| # | Criterion |\n|---|---|\n| AC-1 | **POW(2,4)** returns `16` |',
      ),
    ).toContain('Acceptance Criteria # Criterion AC-1 POW(2,4) returns 16');
  });

  it('truncates long markdown previews without preserving raw markdown punctuation', () => {
    const preview = compactMarkdownPreview(
      `# Handoff\n${'**Important** output '.repeat(20)}`,
      80,
    );

    expect(preview).toHaveLength(83);
    expect(preview).not.toContain('**');
    expect(preview.endsWith('...')).toBe(true);
  });
});
