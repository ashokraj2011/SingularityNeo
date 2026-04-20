/**
 * TypeScript / JavaScript symbol extraction.
 *
 * Uses the TypeScript compiler API (already a dep) so we don't pull in
 * tree-sitter's native bindings. For a first cut this covers the
 * languages where the biggest concentration of agent-authored code
 * lives; polyglot support (Python, Go, Java) can add parse.py.ts etc.
 * later without changing the DB shape.
 *
 * The walker is intentionally shallow:
 *   - Top-level: class / function / interface / type / enum / variable
 *   - Inside a class: methods + properties (so "where is User.save()"
 *     answers correctly)
 *   - Nested functions inside functions are NOT extracted — they rarely
 *     matter for "where does capability X define Y" queries and doubling
 *     symbol count just bloats storage.
 *
 * Signatures are clipped to 240 chars. We're storing them for "show me
 * the line in the UI", not for a type checker.
 */
import ts from 'typescript';
import type { CapabilityCodeSymbolKind } from '../../src/types';

const SIGNATURE_CLIP = 240;

export interface ExtractedSymbol {
  symbolName: string;
  kind: CapabilityCodeSymbolKind;
  parentSymbol?: string;
  startLine: number;
  endLine: number;
  signature: string;
  isExported: boolean;
}

export interface ExtractedReference {
  toModule: string;
  kind: 'IMPORTS' | 'REEXPORTS';
}

export interface ParsedSourceFile {
  symbols: ExtractedSymbol[];
  references: ExtractedReference[];
}

const pickScriptKind = (filePath: string): ts.ScriptKind => {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
};

const hasExportModifier = (node: ts.Node): boolean => {
  // `ts.canHaveModifiers` + `ts.getModifiers` are the 5.x-safe accessors.
  // Older code reads `(node as any).modifiers` which is fine but noisier.
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  if (!modifiers) return false;
  return modifiers.some(
    modifier =>
      modifier.kind === ts.SyntaxKind.ExportKeyword ||
      modifier.kind === ts.SyntaxKind.DefaultKeyword,
  );
};

const lineOf = (sourceFile: ts.SourceFile, pos: number) =>
  sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

const readSignature = (sourceFile: ts.SourceFile, node: ts.Node) => {
  const raw = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  return raw.length > SIGNATURE_CLIP ? `${raw.slice(0, SIGNATURE_CLIP - 1)}…` : raw;
};

const extractClassMembers = (
  sourceFile: ts.SourceFile,
  cls: ts.ClassDeclaration,
): ExtractedSymbol[] => {
  const className = cls.name?.getText(sourceFile) || '(anonymous)';
  const results: ExtractedSymbol[] = [];
  for (const member of cls.members) {
    let name: string | undefined;
    let kind: CapabilityCodeSymbolKind | null = null;
    if (ts.isMethodDeclaration(member)) {
      name = member.name.getText(sourceFile);
      kind = 'method';
    } else if (ts.isPropertyDeclaration(member)) {
      name = member.name.getText(sourceFile);
      kind = 'property';
    } else if (ts.isConstructorDeclaration(member)) {
      name = 'constructor';
      kind = 'method';
    } else if (ts.isGetAccessorDeclaration(member)) {
      name = `get ${member.name.getText(sourceFile)}`;
      kind = 'method';
    } else if (ts.isSetAccessorDeclaration(member)) {
      name = `set ${member.name.getText(sourceFile)}`;
      kind = 'method';
    }
    if (!name || !kind) continue;
    results.push({
      symbolName: name,
      kind,
      parentSymbol: className,
      startLine: lineOf(sourceFile, member.getStart(sourceFile)),
      endLine: lineOf(sourceFile, member.getEnd()),
      signature: readSignature(sourceFile, member),
      isExported: false, // membership on an exported class; keep this false to avoid double-counting
    });
  }
  return results;
};

const extractVariableSymbols = (
  sourceFile: ts.SourceFile,
  stmt: ts.VariableStatement,
): ExtractedSymbol[] => {
  const exported = hasExportModifier(stmt);
  const results: ExtractedSymbol[] = [];
  for (const decl of stmt.declarationList.declarations) {
    // Only bare identifiers — skip `const { x, y } = …` for v1 (noise).
    if (!ts.isIdentifier(decl.name)) continue;
    results.push({
      symbolName: decl.name.text,
      kind: 'variable',
      startLine: lineOf(sourceFile, decl.getStart(sourceFile)),
      endLine: lineOf(sourceFile, decl.getEnd()),
      signature: readSignature(sourceFile, decl),
      isExported: exported,
    });
  }
  return results;
};

const extractTopLevelSymbol = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): ExtractedSymbol[] => {
  if (ts.isClassDeclaration(node) && node.name) {
    const classSymbol: ExtractedSymbol = {
      symbolName: node.name.text,
      kind: 'class',
      startLine: lineOf(sourceFile, node.getStart(sourceFile)),
      endLine: lineOf(sourceFile, node.getEnd()),
      signature: readSignature(sourceFile, node),
      isExported: hasExportModifier(node),
    };
    return [classSymbol, ...extractClassMembers(sourceFile, node)];
  }
  if (ts.isFunctionDeclaration(node) && node.name) {
    return [
      {
        symbolName: node.name.text,
        kind: 'function',
        startLine: lineOf(sourceFile, node.getStart(sourceFile)),
        endLine: lineOf(sourceFile, node.getEnd()),
        signature: readSignature(sourceFile, node),
        isExported: hasExportModifier(node),
      },
    ];
  }
  if (ts.isInterfaceDeclaration(node)) {
    return [
      {
        symbolName: node.name.text,
        kind: 'interface',
        startLine: lineOf(sourceFile, node.getStart(sourceFile)),
        endLine: lineOf(sourceFile, node.getEnd()),
        signature: readSignature(sourceFile, node),
        isExported: hasExportModifier(node),
      },
    ];
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return [
      {
        symbolName: node.name.text,
        kind: 'type',
        startLine: lineOf(sourceFile, node.getStart(sourceFile)),
        endLine: lineOf(sourceFile, node.getEnd()),
        signature: readSignature(sourceFile, node),
        isExported: hasExportModifier(node),
      },
    ];
  }
  if (ts.isEnumDeclaration(node)) {
    return [
      {
        symbolName: node.name.text,
        kind: 'enum',
        startLine: lineOf(sourceFile, node.getStart(sourceFile)),
        endLine: lineOf(sourceFile, node.getEnd()),
        signature: readSignature(sourceFile, node),
        isExported: hasExportModifier(node),
      },
    ];
  }
  if (ts.isVariableStatement(node)) {
    return extractVariableSymbols(sourceFile, node);
  }
  return [];
};

const extractModuleReference = (
  node: ts.Node,
): ExtractedReference | null => {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    return { toModule: node.moduleSpecifier.text, kind: 'IMPORTS' };
  }
  if (
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return { toModule: node.moduleSpecifier.text, kind: 'REEXPORTS' };
  }
  return null;
};

/**
 * Walk a single source file and extract its public symbols + module
 * reference edges. Pure function; no DB calls.
 */
export const extractSymbolsFromSource = (
  filePath: string,
  content: string,
): ParsedSourceFile => {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    pickScriptKind(filePath),
  );

  const symbols: ExtractedSymbol[] = [];
  const references: ExtractedReference[] = [];

  for (const statement of sourceFile.statements) {
    const statementSymbols = extractTopLevelSymbol(sourceFile, statement);
    symbols.push(...statementSymbols);

    const ref = extractModuleReference(statement);
    if (ref) references.push(ref);
  }

  return { symbols, references };
};
