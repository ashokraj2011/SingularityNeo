import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MarkdownContent from '../MarkdownContent';

describe('MarkdownContent', () => {
  it('renders GitHub-style tables as tables instead of plain text', () => {
    render(
      <MarkdownContent
        content={[
          '## Acceptance Criteria',
          '',
          '| # | Criterion | Test Signal |',
          '|---|-----------|-------------|',
          '| AC-1 | POW(2,4) returns 16 | Functional test |',
          '| AC-2 | POW(3,3) returns 27 | Functional test |',
        ].join('\n')}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Acceptance Criteria' }),
    ).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Criterion' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'POW(2,4) returns 16' })).toBeInTheDocument();
  });

  it('renders fenced code blocks with the original code content', () => {
    render(
      <MarkdownContent
        content={['```python', 'def add(a, b):', '    return a + b', '```'].join('\n')}
      />,
    );

    expect(screen.getByText(/def add/)).toBeInTheDocument();
  });
});
