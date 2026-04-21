import { describe, expect, it } from 'vitest';
import { reformatPseudoToolCalls } from '../chatContent';

// Build XML fixtures at runtime. If these appeared as literals in the
// source file, some tool-use-aware environments (e.g. code assistants)
// could mis-parse the file itself.
const LT = '<';
const GT = '>';
const tag = (name: string, attrs = '', body = '') =>
  body === ''
    ? `${LT}${name}${attrs ? ' ' + attrs : ''}/${GT}`
    : `${LT}${name}${attrs ? ' ' + attrs : ''}${GT}${body}${LT}/${name}${GT}`;

describe('reformatPseudoToolCalls', () => {
  it('passes through content with no tool-use tags untouched', () => {
    const input = 'Hello world. Here is **markdown** and a [link](#).';
    expect(reformatPseudoToolCalls(input)).toBe(input);
  });

  it('rewrites a well-formed function_calls / invoke block', () => {
    const input = [
      'Let me search:',
      tag(
        'function_calls',
        '',
        tag(
          'invoke',
          'name="glob"',
          tag('parameter', 'name="pattern"', 'src/**/*.java'),
        ),
      ),
    ].join('\n');

    const out = reformatPseudoToolCalls(input);

    expect(out).toContain('```tool-call');
    expect(out).toContain('glob(');
    expect(out).toContain('pattern: "src/**/*.java"');
    expect(out).toContain('```');
    expect(out).not.toContain(`${LT}function_calls`);
    expect(out).not.toContain(`${LT}invoke`);
    expect(out).not.toContain(`${LT}parameter`);
  });

  it('strips the Anthropic antml: namespace prefix', () => {
    const opener = `${LT}antml:function_calls${GT}`;
    const closer = `${LT}/antml:function_calls${GT}`;
    const invoke = `${LT}antml:invoke name="grep"${GT}${LT}antml:parameter name="pattern"${GT}TODO${LT}/antml:parameter${GT}${LT}/antml:invoke${GT}`;
    const input = `${opener}${invoke}${closer}`;

    const out = reformatPseudoToolCalls(input);

    expect(out).toContain('grep(');
    expect(out).toContain('pattern: "TODO"');
    expect(out).not.toContain('antml:');
  });

  it('handles a truncated block with no closing tag', () => {
    const input = `${LT}function_calls${GT}${LT}invoke name="view"${GT}${LT}parameter name="path"${GT}/etc${LT}/parameter${GT}`;

    const out = reformatPseudoToolCalls(input);

    expect(out).toContain('view(');
    expect(out).toContain('path: "/etc"');
    // Even though the closing tag never arrived, no raw XML leaks.
    expect(out).not.toContain(`${LT}function_calls`);
    expect(out).not.toContain(`${LT}invoke`);
  });

  it('handles two adjacent blocks where the first close is missing', () => {
    const firstOpen = `${LT}function_calls${GT}${LT}invoke name="a"${GT}${LT}parameter name="x"${GT}1${LT}/parameter${GT}${LT}/invoke${GT}`;
    // intentionally no closing </function_calls> before next opener
    const secondOpen = `${LT}function_calls${GT}${LT}invoke name="b"${GT}${LT}parameter name="y"${GT}2${LT}/parameter${GT}${LT}/invoke${GT}${LT}/function_calls${GT}`;
    const input = `${firstOpen}${secondOpen}`;

    const out = reformatPseudoToolCalls(input);

    expect(out).toContain('a(');
    expect(out).toContain('x: "1"');
    expect(out).toContain('b(');
    expect(out).toContain('y: "2"');
  });

  it('reformats a bare invoke block that was never wrapped', () => {
    const input = `${LT}invoke name="read"${GT}${LT}parameter name="file"${GT}README.md${LT}/parameter${GT}${LT}/invoke${GT}`;

    const out = reformatPseudoToolCalls(input);

    expect(out).toContain('read(');
    expect(out).toContain('file: "README.md"');
    expect(out).not.toContain(`${LT}invoke`);
  });

  it('strips orphan closing tags left by malformed streams', () => {
    const input = `Here is some prose.${LT}/invoke${GT} And more prose.${LT}/parameter${GT}`;

    const out = reformatPseudoToolCalls(input);

    expect(out).toContain('Here is some prose.');
    expect(out).toContain('And more prose.');
    expect(out).not.toContain(`${LT}/invoke`);
    expect(out).not.toContain(`${LT}/parameter`);
  });

  it('handles the tool_name variant as a name source', () => {
    const input = `${LT}function_calls${GT}${LT}tool_name${GT}bash${LT}/tool_name${GT}${LT}parameter name="cmd"${GT}ls${LT}/parameter${GT}${LT}/function_calls${GT}`;

    const out = reformatPseudoToolCalls(input);

    expect(out).toContain('bash(');
    expect(out).toContain('cmd: "ls"');
  });

  it('renders multi-line parameter values in a readable block', () => {
    const body = 'line1\nline2\nline3';
    const input = `${LT}function_calls${GT}${LT}invoke name="write"${GT}${LT}parameter name="content"${GT}${body}${LT}/parameter${GT}${LT}/invoke${GT}${LT}/function_calls${GT}`;

    const out = reformatPseudoToolCalls(input);

    expect(out).toContain('write(');
    expect(out).toContain('"""');
    expect(out).toContain('line1');
    expect(out).toContain('line2');
    expect(out).toContain('line3');
  });
});
