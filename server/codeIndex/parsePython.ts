/**
 * Python symbol extraction.
 *
 * Preferred path: invoke a tiny helper backed by Python's real `ast`
 * module so nested classes/functions, decorators, async defs, and
 * multiline signatures all get proper structural boundaries.
 *
 * Fallback path: retain the prior indentation-based scanner so indexing
 * still works on machines where `python3`/`python` is unavailable.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  ExtractedReference,
  ExtractedSymbol,
  ParsedSourceFile,
} from './parse';

const SIGNATURE_CLIP = 240;
const PYTHON_AST_SCRIPT_PATH = fileURLToPath(
  new URL('./parsers/python_ast.py', import.meta.url),
);

type PythonAstPayload = {
  symbols?: Array<{
    symbolName?: string;
    kind?: ExtractedSymbol['kind'];
    parentSymbol?: string | null;
    qualifiedSymbolName?: string | null;
    startLine?: number;
    endLine?: number;
    sliceStartLine?: number;
    sliceEndLine?: number;
    signature?: string;
    isExported?: boolean;
  }>;
  references?: Array<{
    toModule?: string;
    kind?: ExtractedReference['kind'];
  }>;
};

let cachedPythonInterpreter: string | null | undefined;

const getPythonCandidates = () => {
  const configured = String(
    process.env.SINGULARITY_PYTHON_BIN ||
      process.env.PYTHON3 ||
      process.env.PYTHON ||
      '',
  ).trim();
  return Array.from(
    new Set([configured, cachedPythonInterpreter || '', 'python3', 'python'].filter(Boolean)),
  );
};

const clip = (raw: string): string => {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.length > SIGNATURE_CLIP
    ? `${collapsed.slice(0, SIGNATURE_CLIP - 1)}…`
    : collapsed;
};

const parseWithPythonAst = (
  filePath: string,
  rawContent: string,
): ParsedSourceFile | null => {
  const payload = JSON.stringify({
    filePath,
    content: rawContent,
  });

  for (const command of getPythonCandidates()) {
    const result = spawnSync(command, [PYTHON_AST_SCRIPT_PATH], {
      input: payload,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 15_000,
    });

    if (result.error) {
      if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      continue;
    }
    if (typeof result.status === 'number' && result.status !== 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(String(result.stdout || '{}')) as PythonAstPayload;
      cachedPythonInterpreter = command;
      return {
        symbols: (parsed.symbols || [])
          .filter(symbol => symbol?.symbolName && symbol?.kind)
          .map(symbol => {
            const startLine = Math.max(1, Number(symbol.startLine) || 1);
            const endLine = Math.max(startLine, Number(symbol.endLine) || startLine);
            return {
              symbolName: String(symbol.symbolName || ''),
              kind: symbol.kind as ExtractedSymbol['kind'],
              parentSymbol: String(symbol.parentSymbol || '').trim() || undefined,
              qualifiedSymbolName:
                String(symbol.qualifiedSymbolName || '').trim() || undefined,
              startLine,
              endLine,
              sliceStartLine:
                Math.max(startLine, Number(symbol.sliceStartLine) || startLine),
              sliceEndLine:
                Math.max(
                  Math.max(startLine, Number(symbol.sliceStartLine) || startLine),
                  Number(symbol.sliceEndLine) || endLine,
                ),
              signature: clip(String(symbol.signature || '')),
              isExported: Boolean(symbol.isExported),
            };
          }),
        references: (parsed.references || [])
          .filter(reference => reference?.toModule)
          .map(reference => ({
            toModule: String(reference.toModule || '').trim(),
            kind:
              String(reference.kind || '').trim() === 'REEXPORTS'
                ? 'REEXPORTS'
                : 'IMPORTS',
          })),
      };
    } catch {
      continue;
    }
  }

  return null;
};

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

    if (c === '#') {
      while (i < n && source[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }

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

const indentOf = (line: string): number => {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i;
};

const isBlank = (line: string): boolean => /^\s*$/.test(line);

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

const CLASS_DECL_RE = /^class\s+([A-Za-z_][\w]*)\s*(?:\([^)]*\))?\s*:/;
const FUNC_DECL_RE = /^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/;
const ASSIGN_DECL_RE = /^([A-Za-z_][\w]*)\s*(?::\s*[^=]+)?=\s*[^=]/;
const IMPORT_RE =
  /^\s*import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*)/;
const FROM_IMPORT_RE = /^\s*from\s+(\.*[A-Za-z_][\w.]*|\.+)\s+import\s+/;

const extractSymbolsFromPythonHeuristicSource = (
  rawContent: string,
): ParsedSourceFile => {
  const scrubbed = scrub(rawContent);
  const scrubbedLines = scrubbed.split('\n');
  const origLines = rawContent.split('\n');

  const symbols: ExtractedSymbol[] = [];
  const references: ExtractedReference[] = [];

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

  let currentClass: { name: string; indent: number } | null = null;

  for (let i = 0; i < scrubbedLines.length; i++) {
    const scrubbedLine = scrubbedLines[i];
    if (isBlank(scrubbedLine)) continue;

    const indent = indentOf(scrubbedLine);
    const trimmed = scrubbedLine.slice(indent);

    if (currentClass && indent <= currentClass.indent) {
      currentClass = null;
    }

    if (trimmed.startsWith('@')) continue;

    if (!currentClass) {
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
          isExported: false,
        });
        continue;
      }
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

export const extractSymbolsFromPythonSource = (
  filePath: string,
  rawContent: string,
): ParsedSourceFile =>
  parseWithPythonAst(filePath, rawContent) ||
  extractSymbolsFromPythonHeuristicSource(rawContent);
