/**
 * Java symbol extraction.
 *
 * Preferred path: invoke a tiny helper backed by the JDK compiler AST
 * so nested types, constructors, record members, and multiline
 * signatures all get proper structural boundaries.
 *
 * Fallback path: retain the prior brace-depth scanner so indexing still
 * works on machines where `java` / `javac` is unavailable.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CapabilityCodeSymbolKind } from '../../src/types';
import type {
  ExtractedReference,
  ExtractedSymbol,
  ParsedSourceFile,
} from './parse';

const SIGNATURE_CLIP = 240;
const JAVA_AST_CLASS_NAME = 'JavaAstExtractor';
const JAVA_AST_SOURCE_PATH = fileURLToPath(
  new URL('./parsers/JavaAstExtractor.java', import.meta.url),
);
const JAVA_AST_BUILD_ROOT = path.join(os.tmpdir(), 'singularityneo-java-ast');
const JAVA_AST_CLASS_FILE = path.join(
  JAVA_AST_BUILD_ROOT,
  `${JAVA_AST_CLASS_NAME}.class`,
);

type JavaAstPayload = {
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

let cachedJavaCommand: string | null | undefined;
let cachedJavacCommand: string | null | undefined;
let javaAstCompilationReady: boolean | null = null;

const resolveJavaHomeBinary = (binaryName: string) => {
  const javaHome = String(process.env.JAVA_HOME || '').trim();
  if (!javaHome) return '';
  return path.join(
    javaHome,
    'bin',
    process.platform === 'win32' ? `${binaryName}.exe` : binaryName,
  );
};

const getJavaCandidates = () => {
  const configured = String(
    process.env.SINGULARITY_JAVA_BIN || process.env.JAVA_BIN || '',
  ).trim();
  return Array.from(
    new Set(
      [
        configured,
        cachedJavaCommand || '',
        resolveJavaHomeBinary('java'),
        process.platform === 'win32' ? 'java.exe' : 'java',
      ].filter(Boolean),
    ),
  );
};

const getJavacCandidates = () => {
  const configured = String(
    process.env.SINGULARITY_JAVAC_BIN || process.env.JAVAC_BIN || '',
  ).trim();
  return Array.from(
    new Set(
      [
        configured,
        cachedJavacCommand || '',
        resolveJavaHomeBinary('javac'),
        process.platform === 'win32' ? 'javac.exe' : 'javac',
      ].filter(Boolean),
    ),
  );
};

const clip = (raw: string): string => {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.length > SIGNATURE_CLIP
    ? `${collapsed.slice(0, SIGNATURE_CLIP - 1)}…`
    : collapsed;
};

const ensureJavaAstHelperCompiled = (): boolean => {
  const sourceStat = fs.statSync(JAVA_AST_SOURCE_PATH);

  if (javaAstCompilationReady === true && fs.existsSync(JAVA_AST_CLASS_FILE)) {
    const classStat = fs.statSync(JAVA_AST_CLASS_FILE);
    if (classStat.mtimeMs >= sourceStat.mtimeMs) {
      return true;
    }
  }

  fs.mkdirSync(JAVA_AST_BUILD_ROOT, { recursive: true });

  let needsCompile = true;
  if (fs.existsSync(JAVA_AST_CLASS_FILE)) {
    const classStat = fs.statSync(JAVA_AST_CLASS_FILE);
    needsCompile = classStat.mtimeMs < sourceStat.mtimeMs;
  }
  if (!needsCompile) {
    javaAstCompilationReady = true;
    return true;
  }

  for (const command of getJavacCandidates()) {
    const result = spawnSync(
      command,
      [
        '--add-modules',
        'jdk.compiler',
        '-d',
        JAVA_AST_BUILD_ROOT,
        JAVA_AST_SOURCE_PATH,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: 30_000,
      },
    );

    if (result.error) {
      if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      continue;
    }
    if (typeof result.status === 'number' && result.status === 0) {
      cachedJavacCommand = command;
      javaAstCompilationReady = true;
      return true;
    }
  }

  javaAstCompilationReady = false;
  return false;
};

const parseWithJavaAst = (
  filePath: string,
  rawContent: string,
): ParsedSourceFile | null => {
  if (!ensureJavaAstHelperCompiled()) {
    return null;
  }

  for (const command of getJavaCandidates()) {
    const result = spawnSync(
      command,
      [
        '--add-modules',
        'jdk.compiler',
        '-cp',
        JAVA_AST_BUILD_ROOT,
        JAVA_AST_CLASS_NAME,
        filePath,
      ],
      {
        input: rawContent,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        timeout: 15_000,
      },
    );

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
      const parsed = JSON.parse(String(result.stdout || '{}')) as JavaAstPayload;
      cachedJavaCommand = command;
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

    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }
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

const TYPE_DECL_RE =
  /\b(class|interface|enum|record|@interface)\s+([A-Z_][\w$]*)/;
const METHOD_DECL_RE =
  /^(?:@\w[\w.]*(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\s+)+(?:<[^>]+>\s+)?(?:[A-Za-z_][\w.<>,\s\[\]?&]*\s+)?([A-Za-z_][\w$]*)\s*\(/;
const CONSTRUCTOR_DECL_RE =
  /^(?:@\w[\w.]*(?:\([^)]*\))?\s+)*(?:public|private|protected)?\s*([A-Z][\w$]*)\s*\(/;
const FIELD_DECL_RE =
  /^(?:@\w[\w.]*(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|static|final|volatile|transient)\s+)+(?:[A-Za-z_][\w.<>,\s\[\]?&]*\s+)([A-Za-z_][\w$]*)\s*[=;,]/;

const extractSymbolsFromJavaHeuristicSource = (
  rawContent: string,
): ParsedSourceFile => {
  const scrubbed = scrub(rawContent);
  const lines = scrubbed.split('\n');
  const origLines = rawContent.split('\n');

  const symbols: ExtractedSymbol[] = [];
  const references: ExtractedReference[] = [];

  for (const line of lines) {
    const match = line.match(
      /^\s*import\s+(?:static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/,
    );
    if (match) references.push({ toModule: match[1], kind: 'IMPORTS' });
  }

  let depth = 0;
  let currentTypeName: string | null = null;
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
        else kind = 'class';
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

export const extractSymbolsFromJavaSource = (
  filePath: string,
  rawContent: string,
): ParsedSourceFile =>
  parseWithJavaAst(filePath, rawContent) ||
  extractSymbolsFromJavaHeuristicSource(rawContent);
