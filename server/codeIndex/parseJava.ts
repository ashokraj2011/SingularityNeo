/**
 * Lightweight Java symbol extraction.
 *
 * We don't ship tree-sitter (native binding) or a full grammar like
 * java-parser (heavy). For "where is class X defined / where is method
 * Y declared" lookups a brace-depth walker over comment-and-string
 * stripped source is accurate enough:
 *
 *   - Top-level: class / interface / enum / record / @interface
 *   - Inside a type body (depth 1): methods + fields + constructor
 *   - Imports + package → emitted as IMPORTS references
 *
 * Same `ParsedSourceFile` shape as the TS parser, so ingest.ts just
 * dispatches on file extension and every downstream table /query
 * stays untouched.
 *
 * Known gaps (acceptable for v1):
 *   - Nested inner classes aren't emitted (depth-1 only).
 *   - Annotations that span multiple lines can confuse the method-line
 *     detector; we fall back to "no symbol" rather than false-positive.
 *   - Generic methods where `<T>` appears before the return type parse
 *     correctly; lambdas and records' compact constructors are
 *     deliberately skipped.
 */
import type { CapabilityCodeSymbolKind } from '../../src/types';
import type {
  ExtractedReference,
  ExtractedSymbol,
  ParsedSourceFile,
} from './parse';

const SIGNATURE_CLIP = 240;

/**
 * Replace every comment / string / char-literal character with a space
 * (newlines preserved) so line numbers stay accurate but the scanner
 * never has to reason about escapes or `}` inside a quoted string.
 */
const scrub = (source: string): string => {
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    const next = i + 1 < n ? source[i + 1] : '';

    // Line comment
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }
    // Block comment (also covers /** javadoc */)
    if (c === '/' && next === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out.push(source[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) {
        out.push(' ', ' ');
        i += 2;
      }
      continue;
    }
    // Text block `"""..."""` (Java 15+)
    if (
      c === '"' &&
      next === '"' &&
      i + 2 < n &&
      source[i + 2] === '"'
    ) {
      out.push(' ', ' ', ' ');
      i += 3;
      while (
        i + 2 < n &&
        !(source[i] === '"' && source[i + 1] === '"' && source[i + 2] === '"')
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
    // String literal
    if (c === '"') {
      out.push(' ');
      i++;
      while (i < n && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < n) {
          out.push(' ', ' ');
          i += 2;
          continue;
        }
        out.push(source[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) {
        out.push(' ');
        i++;
      }
      continue;
    }
    // Char literal
    if (c === "'") {
      out.push(' ');
      i++;
      while (i < n && source[i] !== "'") {
        if (source[i] === '\\' && i + 1 < n) {
          out.push(' ', ' ');
          i += 2;
          continue;
        }
        out.push(' ');
        i++;
      }
      if (i < n) {
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

/**
 * Walk forward from `startLine` (0-indexed) and return the 1-indexed
 * line number of the matching closing brace. Falls back to `startLine + 1`
 * if the block never closes (malformed source).
 */
const findBlockEnd = (scrubbedLines: string[], startLine: number): number => {
  let depth = 0;
  let opened = false;
  for (let i = startLine; i < scrubbedLines.length; i++) {
    for (const c of scrubbedLines[i]) {
      if (c === '{') {
        depth++;
        opened = true;
      } else if (c === '}') {
        depth--;
        if (opened && depth === 0) return i + 1;
      }
    }
  }
  return startLine + 1;
};

const RESERVED_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'synchronized', 'return', 'new',
  'catch', 'do', 'try', 'else', 'throw', 'assert', 'yield',
  'break', 'continue',
]);

// Type declaration at the start of a (trimmed) line.
// Capture group 1: kind literal. Capture group 2: name.
const TYPE_DECL_RE =
  /\b(class|interface|enum|record|@interface)\s+([A-Z_][\w$]*)/;

// Simple method detector: requires modifiers or annotation before name OR
// a constructor-style `UpperName(` at line start. Captures method name.
// We deliberately require `(` on the same line to avoid matching local
// variables with call-site `method(...)` patterns.
const METHOD_DECL_RE =
  /^(?:@\w[\w.]*(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\s+)+(?:<[^>]+>\s+)?(?:[A-Za-z_][\w.<>,\s\[\]?&]*\s+)?([A-Za-z_][\w$]*)\s*\(/;
const CONSTRUCTOR_DECL_RE =
  /^(?:@\w[\w.]*(?:\([^)]*\))?\s+)*(?:public|private|protected)?\s*([A-Z][\w$]*)\s*\(/;

// Field: no parens, ends with `=`, `;`, or `,` (multi-decl), with type+name pair.
const FIELD_DECL_RE =
  /^(?:@\w[\w.]*(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|static|final|volatile|transient)\s+)+(?:[A-Za-z_][\w.<>,\s\[\]?&]*\s+)([A-Za-z_][\w$]*)\s*[=;,]/;

export const extractSymbolsFromJavaSource = (
  filePath: string,
  rawContent: string,
): ParsedSourceFile => {
  const scrubbed = scrub(rawContent);
  const lines = scrubbed.split('\n');
  const origLines = rawContent.split('\n');

  const symbols: ExtractedSymbol[] = [];
  const references: ExtractedReference[] = [];

  // Imports — cheap separate pass.
  for (const line of lines) {
    const m = line.match(
      /^\s*import\s+(?:static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/,
    );
    if (m) references.push({ toModule: m[1], kind: 'IMPORTS' });
  }

  // Pass 2: type declarations + members with brace-depth tracking.
  let depth = 0;
  let currentTypeName: string | null = null;
  /** Remember the most recent top-level type declaration whose `{` hasn't been consumed yet. */
  let pendingTypeName: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (depth === 0) {
      const typeMatch = trimmed.match(TYPE_DECL_RE);
      if (typeMatch) {
        const kindRaw = typeMatch[1];
        const name = typeMatch[2];
        let kind: CapabilityCodeSymbolKind;
        if (kindRaw === 'interface' || kindRaw === '@interface') kind = 'interface';
        else if (kindRaw === 'enum') kind = 'enum';
        else kind = 'class'; // class | record
        const endLine = findBlockEnd(lines, i);
        symbols.push({
          symbolName: name,
          kind,
          startLine: i + 1,
          endLine,
          signature: clip(origLines[i] || ''),
          isExported: /\bpublic\b/.test(trimmed),
        });
        pendingTypeName = name;
      }
    } else if (depth === 1 && currentTypeName) {
      // Inside a top-level type body — extract member declarations.
      // Annotation-only line: no-op, let subsequent non-annotation line match.
      if (trimmed && !trimmed.startsWith('@') && !trimmed.startsWith('//')) {
        const methodMatch = trimmed.match(METHOD_DECL_RE);
        if (methodMatch && !RESERVED_KEYWORDS.has(methodMatch[1])) {
          const name = methodMatch[1];
          const endLine = line.includes('{') ? findBlockEnd(lines, i) : i + 1;
          symbols.push({
            symbolName: name === currentTypeName ? 'constructor' : name,
            kind: 'method',
            parentSymbol: currentTypeName,
            startLine: i + 1,
            endLine,
            signature: clip(origLines[i] || ''),
            isExported: false,
          });
        } else {
          const ctorMatch = trimmed.match(CONSTRUCTOR_DECL_RE);
          if (
            ctorMatch &&
            ctorMatch[1] === currentTypeName &&
            !RESERVED_KEYWORDS.has(ctorMatch[1])
          ) {
            const endLine = line.includes('{') ? findBlockEnd(lines, i) : i + 1;
            symbols.push({
              symbolName: 'constructor',
              kind: 'method',
              parentSymbol: currentTypeName,
              startLine: i + 1,
              endLine,
              signature: clip(origLines[i] || ''),
              isExported: false,
            });
          } else {
            const fieldMatch = trimmed.match(FIELD_DECL_RE);
            if (fieldMatch && !RESERVED_KEYWORDS.has(fieldMatch[1])) {
              symbols.push({
                symbolName: fieldMatch[1],
                kind: 'property',
                parentSymbol: currentTypeName,
                startLine: i + 1,
                endLine: i + 1,
                signature: clip(origLines[i] || ''),
                isExported: false,
              });
            }
          }
        }
      }
    }

    // Update depth from this line's brace count.
    for (const c of line) {
      if (c === '{') {
        depth++;
        if (depth === 1 && pendingTypeName) {
          currentTypeName = pendingTypeName;
          pendingTypeName = null;
        }
      } else if (c === '}') {
        depth--;
        if (depth <= 0) {
          depth = 0;
          currentTypeName = null;
          pendingTypeName = null;
        }
      }
    }
  }

  return { symbols, references };
};
