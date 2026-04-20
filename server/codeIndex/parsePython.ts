/**
 * Lightweight Python symbol extraction.
 *
 * Same contract as parse.ts / parseJava.ts — a pure function that takes
 * `(filePath, content)` and returns `{ symbols, references }`. No AST
 * library, no native bindings. We walk the file by indentation with
 * comments, string literals, and triple-quoted string bodies scrubbed
 * to spaces so tokens inside a docstring can't fool the scanner.
 *
 * What we emit:
 *   - Top-level: `class Foo:` → class; `def foo(...)` / `async def
 *     foo(...)` → function; bare `NAME = …` / `NAME: T = …` → variable
 *     (only when it looks like a module-level constant — no self./cls.)
 *   - Inside a class body: `def …` → method (parent = class name);
 *     name-only class attributes → property
 *   - References: `import foo.bar` and `from foo.bar import …` → IMPORTS
 *
 * Scope boundaries are derived purely from whitespace indentation: a
 * declaration at indent N owns every subsequent non-blank line whose
 * indent > N. That matches CPython's own grammar and keeps us from
 * needing a tokenizer.
 *
 * Known v1 gaps (deliberate):
 *   - Nested classes / closures are skipped — only one class layer deep.
 *   - `x.y.z = …` style assignments never emit a symbol.
 *   - Type aliases (`X: TypeAlias = …` / `X = Union[…]`) look identical
 *     to regular constants; they all get `kind: 'variable'`.
 */
import type {
  ExtractedReference,
  ExtractedSymbol,
  ParsedSourceFile,
} from './parse';

const SIGNATURE_CLIP = 240;

/**
 * Replace comment bodies, single-line string contents, and triple-quoted
 * string bodies with spaces (newlines preserved). Keeps line numbers
 * correct for downstream positional logic while making sure a `def` or
 * `class` token inside a docstring never gets picked up.
 */
const scrub = (source: string): string => {
  const out: string[] = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    const c = source[i];

    // `#` line comment — eat to newline.
    if (c === '#') {
      while (i < n && source[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }

    // Triple-quoted string """ or '''. Python string prefixes
    // (r, b, f, rb, br, fr, rf, u …) are ordinary identifier chars
    // already emitted when we hit this branch.
    if (
      (c === '"' || c === "'") &&
      i + 2 < n &&
      source[i + 1] === c &&
      source[i + 2] === c
    ) {
      const q = c;
      out.push(' ', ' ', ' ');
      i += 3;
      while (
        i + 2 < n &&
        !(source[i] === q && source[i + 1] === q && source[i + 2] === q)
      ) {
        out.push(source[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i + 2 < n) {
        out.push(' ', ' ', ' ');
        i += 3;
      }
      continue;
    }

    // Single-line string (Python doesn't allow unescaped newlines inside
    // non-triple-quoted strings). Stop on matching quote or EOL.
    if (c === '"' || c === "'") {
      const q = c;
      out.push(' ');
      i++;
      while (i < n && source[i] !== q && source[i] !== '\n') {
        if (source[i] === '\\' && i + 1 < n) {
          out.push(' ', ' ');
          i += 2;
          continue;
        }
        out.push(' ');
        i++;
      }
      if (i < n && source[i] === q) {
        out.push(' ');
        i++;
      }
      continue;
    }

    out.push(c);
    i++;
  }
  return out.join('');
};

const clip = (raw: string): string => {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.length > SIGNATURE_CLIP
    ? `${collapsed.slice(0, SIGNATURE_CLIP - 1)}…`
    : collapsed;
};

/** Length of the leading run of space/tab characters on a line. Tabs and spaces both count as 1. */
const indentOf = (line: string): number => {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i;
};

const isBlank = (line: string): boolean => /^\s*$/.test(line);

/**
 * Given a 0-indexed `startLine` that holds a declaration, walk forward
 * and return the 1-indexed line of the last line belonging to its body
 * (i.e. the last non-blank line with indent > startIndent). If the
 * declaration has no body below it (single-line `def f(): pass`), just
 * return startLine + 1.
 */
const findBlockEnd = (
  lines: string[],
  startLine: number,
  startIndent: number,
): number => {
  let lastBodyLine = startLine;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (isBlank(lines[i])) continue;
    if (indentOf(lines[i]) > startIndent) {
      lastBodyLine = i;
    } else {
      break;
    }
  }
  return lastBodyLine + 1;
};

// Top-level + member declarations. All anchored to start-of-trim so we
// don't misread the token in the middle of an expression.
const CLASS_DECL_RE = /^class\s+([A-Za-z_][\w]*)\s*(?:\([^)]*\))?\s*:/;
const FUNC_DECL_RE = /^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/;
/** Module-level constant / class attribute: `NAME = …` or `NAME: T = …`. */
const ASSIGN_DECL_RE = /^([A-Za-z_][\w]*)\s*(?::\s*[^=]+)?=\s*[^=]/;

// Import forms — always at indent 0 in idiomatic Python; we don't
// bother collecting conditional imports nested inside try-blocks.
const IMPORT_RE =
  /^\s*import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*)/;
const FROM_IMPORT_RE = /^\s*from\s+(\.*[A-Za-z_][\w.]*|\.+)\s+import\s+/;

export const extractSymbolsFromPythonSource = (
  _filePath: string,
  rawContent: string,
): ParsedSourceFile => {
  const scrubbed = scrub(rawContent);
  const scrubbedLines = scrubbed.split('\n');
  const origLines = rawContent.split('\n');

  const symbols: ExtractedSymbol[] = [];
  const references: ExtractedReference[] = [];

  // Imports — cheap independent pass over the scrubbed text so we see
  // through docstrings/string-literals.
  for (const line of scrubbedLines) {
    const fromMatch = line.match(FROM_IMPORT_RE);
    if (fromMatch) {
      references.push({ toModule: fromMatch[1], kind: 'IMPORTS' });
      continue;
    }
    const importMatch = line.match(IMPORT_RE);
    if (importMatch) {
      for (const part of importMatch[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name) references.push({ toModule: name, kind: 'IMPORTS' });
      }
    }
  }

  // Pass 2: walk by indentation. Track at most one layer of enclosing
  // class so we can tag methods/properties with `parentSymbol`.
  let currentClass: { name: string; indent: number } | null = null;

  for (let i = 0; i < scrubbedLines.length; i++) {
    const scrubbedLine = scrubbedLines[i];
    if (isBlank(scrubbedLine)) continue;

    const indent = indentOf(scrubbedLine);
    const trimmed = scrubbedLine.slice(indent);

    // Dedented out of the current class body.
    if (currentClass && indent <= currentClass.indent) {
      currentClass = null;
    }

    // Decorator lines don't introduce a symbol on their own; we wait
    // for the `def` / `class` that follows.
    if (trimmed.startsWith('@')) continue;

    if (!currentClass) {
      // Module-level detection.
      const classMatch = trimmed.match(CLASS_DECL_RE);
      if (classMatch) {
        const name = classMatch[1];
        const endLine = findBlockEnd(scrubbedLines, i, indent);
        symbols.push({
          symbolName: name,
          kind: 'class',
          startLine: i + 1,
          endLine,
          signature: clip(origLines[i] || ''),
          isExported: !name.startsWith('_'),
        });
        currentClass = { name, indent };
        continue;
      }
      const funcMatch = trimmed.match(FUNC_DECL_RE);
      if (funcMatch) {
        const name = funcMatch[1];
        const endLine = findBlockEnd(scrubbedLines, i, indent);
        symbols.push({
          symbolName: name,
          kind: 'function',
          startLine: i + 1,
          endLine,
          signature: clip(origLines[i] || ''),
          isExported: !name.startsWith('_'),
        });
        continue;
      }
      // Module-level constant — only catch assignments at indent 0 so
      // we don't light up every local variable.
      if (indent === 0) {
        const assignMatch = trimmed.match(ASSIGN_DECL_RE);
        if (assignMatch) {
          const name = assignMatch[1];
          symbols.push({
            symbolName: name,
            kind: 'variable',
            startLine: i + 1,
            endLine: i + 1,
            signature: clip(origLines[i] || ''),
            isExported: !name.startsWith('_'),
          });
        }
      }
    } else if (indent > currentClass.indent) {
      // Inside a class body.
      const funcMatch = trimmed.match(FUNC_DECL_RE);
      if (funcMatch) {
        const name = funcMatch[1];
        const endLine = findBlockEnd(scrubbedLines, i, indent);
        symbols.push({
          symbolName: name,
          kind: 'method',
          parentSymbol: currentClass.name,
          startLine: i + 1,
          endLine,
          signature: clip(origLines[i] || ''),
          isExported: false, // membership on an exported class
        });
        continue;
      }
      // Class attribute — only at the body's primary indent; skip
      // deeper nested assignments.
      const assignMatch = trimmed.match(ASSIGN_DECL_RE);
      if (assignMatch) {
        symbols.push({
          symbolName: assignMatch[1],
          kind: 'property',
          parentSymbol: currentClass.name,
          startLine: i + 1,
          endLine: i + 1,
          signature: clip(origLines[i] || ''),
          isExported: false,
        });
      }
    }
  }

  return { symbols, references };
};
