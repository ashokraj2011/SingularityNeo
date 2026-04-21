import React from 'react';
import { cn } from '../lib/utils';
import { reformatPseudoToolCalls } from '../lib/chatContent';

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'code'; language?: string; code: string };

const isOrderedListItem = (line: string) => /^\d+\.\s+/.test(line);
const isUnorderedListItem = (line: string) => /^[-*]\s+/.test(line);
const isHeading = (line: string) => /^(#{1,3})\s+/.test(line);
const isCodeFence = (line: string) => /^```/.test(line.trim());
const isBlockquote = (line: string) => /^>\s?/.test(line);
const isTableDivider = (line: string) =>
  /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+(?:\s*:?-{3,}:?\s*)?$/.test(line.trim());
const looksLikeTableRow = (line: string) => {
  const trimmed = line.trim();
  return trimmed.includes('|') && !isCodeFence(trimmed);
};

const splitTableCells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim());

const parseBlocks = (value: string): MarkdownBlock[] => {
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];

  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index] || '';
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^```([\w-]+)?\s*$/);
    if (fenceMatch) {
      const codeLines: string[] = [];
      const language = fenceMatch[1];
      index += 1;
      while (index < lines.length && !isCodeFence(lines[index] || '')) {
        codeLines.push(lines[index] || '');
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({
        type: 'code',
        language,
        code: codeLines.join('\n').trimEnd(),
      });
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (isBlockquote(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && isBlockquote(lines[index] || '')) {
        quoteLines.push((lines[index] || '').replace(/^>\s?/, '').trim());
        index += 1;
      }
      blocks.push({
        type: 'blockquote',
        text: quoteLines.join(' ').trim(),
      });
      continue;
    }

    if (
      looksLikeTableRow(line) &&
      index + 1 < lines.length &&
      isTableDivider(lines[index + 1] || '')
    ) {
      const headers = splitTableCells(line);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && looksLikeTableRow(lines[index] || '')) {
        rows.push(splitTableCells(lines[index] || ''));
        index += 1;
      }

      blocks.push({
        type: 'table',
        headers,
        rows,
      });
      continue;
    }

    if (isUnorderedListItem(line)) {
      const items: string[] = [];
      while (index < lines.length && isUnorderedListItem((lines[index] || '').trim())) {
        items.push((lines[index] || '').trim().replace(/^[-*]\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    if (isOrderedListItem(line)) {
      const items: string[] = [];
      while (index < lines.length && isOrderedListItem((lines[index] || '').trim())) {
        items.push((lines[index] || '').trim().replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index]?.trim() &&
      !isHeading(lines[index] || '') &&
      !isCodeFence(lines[index] || '') &&
      !isBlockquote(lines[index] || '') &&
      !isUnorderedListItem((lines[index] || '').trim()) &&
      !isOrderedListItem((lines[index] || '').trim())
    ) {
      paragraphLines.push((lines[index] || '').trim());
      index += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        text: paragraphLines.join(' '),
      });
    } else {
      // Fallback: If a line was skipped by the paragraph builder due to a strict
      // match (like isCodeFence) but failed its dedicated block parser (like fenceMatch),
      // force it to render as a paragraph string to avoid a parsing infinite loop.
      blocks.push({
        type: 'paragraph',
        text: line,
      });
      index += 1;
    }
  }

  return blocks;
};

const renderInline = (value: string, keyPrefix: string) => {
  const nodes: React.ReactNode[] = [];
  let remaining = value;
  let index = 0;

  const tokenPattern =
    /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`)/;

  while (remaining.length > 0) {
    const match = remaining.match(tokenPattern);
    if (!match || match.index === undefined) {
      nodes.push(remaining);
      break;
    }

    if (match.index > 0) {
      nodes.push(remaining.slice(0, match.index));
    }

    if (match[2] && match[3]) {
      nodes.push(
        <a
          key={`${keyPrefix}-link-${index}`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
        >
          {match[2]}
        </a>,
      );
    } else if (match[4]) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${index}`}>{match[4]}</strong>,
      );
    } else if (match[5]) {
      nodes.push(<code key={`${keyPrefix}-code-${index}`}>{match[5]}</code>);
    }

    remaining = remaining.slice(match.index + match[0].length);
    index += 1;
  }

  return nodes;
};

type MarkdownContentProps = {
  content: string;
  className?: string;
};

const MarkdownContent = ({ content, className }: MarkdownContentProps) => {
  // Rewrite Claude-style tool-use XML (<function_calls>…) into a
  // readable fenced "tool-call" code block BEFORE markdown parsing.
  // Without this, the raw XML leaks straight into the transcript.
  // Idempotent and cheap — probe short-circuits when there's no tag.
  const prepared = reformatPseudoToolCalls(content);
  const trimmed = prepared.trim();
  if (!trimmed) {
    return null;
  }

  const blocks = parseBlocks(trimmed);

  return (
    <div className={cn('markdown-content', className)}>
      {blocks.map((block, index) => {
        const key = `markdown-block-${index}`;

        if (block.type === 'heading') {
          if (block.level === 1) {
            return <h1 key={key}>{renderInline(block.text, key)}</h1>;
          }
          if (block.level === 2) {
            return <h2 key={key}>{renderInline(block.text, key)}</h2>;
          }
          return <h3 key={key}>{renderInline(block.text, key)}</h3>;
        }

        if (block.type === 'unordered-list') {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>
                  {renderInline(item, `${key}-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>
                  {renderInline(item, `${key}-${itemIndex}`)}
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote key={key}>
              {renderInline(block.text, key)}
            </blockquote>
          );
        }

        if (block.type === 'table') {
          return (
            <div key={key} className="markdown-table-scroll">
              <table>
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={`${key}-header-${headerIndex}`}>
                        {renderInline(header, `${key}-header-${headerIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${key}-row-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${key}-row-${rowIndex}-cell-${cellIndex}`}>
                          {renderInline(
                            cell,
                            `${key}-row-${rowIndex}-cell-${cellIndex}`,
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === 'code') {
          // Expose language on the <pre> too so CSS can style specific
          // languages without :has() — notably `tool-call` for the
          // Claude-style tool-use blocks we rewrite in chatContent.ts.
          return (
            <pre key={key} data-language={block.language || undefined}>
              <code data-language={block.language || undefined}>{block.code}</code>
            </pre>
          );
        }

        return <p key={key}>{renderInline(block.text, key)}</p>;
      })}
    </div>
  );
};

export default MarkdownContent;
