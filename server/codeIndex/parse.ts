/**
 * TypeScript / JavaScript symbol extraction.
 *
 * Keeps the existing TypeScript compiler pipeline, but enriches the
 * symbol records so downstream retrieval can ask for bounded semantic
 * hunks instead of whole files.
 */
import { createHash } from 'node:crypto';
import ts from 'typescript';
import type { CapabilityCodeSymbolKind } from '../../src/types';

const SIGNATURE_CLIP = 240;

export interface ExtractedSymbol {
  symbolName: string;
  kind: CapabilityCodeSymbolKind;
  parentSymbol?: string;
  qualifiedSymbolName?: string;
  symbolId?: string;
  containerSymbolId?: string;
  language?: string;
  startLine: number;
  endLine: number;
  sliceStartLine?: number;
  sliceEndLine?: number;
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

export const detectSourceLanguage = (filePath: string): string => {
  if (filePath.endsWith('.tsx')) return 'tsx';
  if (filePath.endsWith('.ts')) return 'ts';
  if (filePath.endsWith('.jsx')) return 'jsx';
  if (filePath.endsWith('.mjs')) return 'mjs';
  if (filePath.endsWith('.cjs')) return 'cjs';
  if (filePath.endsWith('.js')) return 'js';
  if (filePath.endsWith('.java')) return 'java';
  if (filePath.endsWith('.pyw')) return 'pyw';
  if (filePath.endsWith('.py')) return 'py';
  return 'text';
};

const hasExportModifier = (node: ts.Node): boolean => {
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

const readRange = (sourceFile: ts.SourceFile, node: ts.Node) => ({
  startLine: lineOf(sourceFile, node.getStart(sourceFile)),
  endLine: lineOf(sourceFile, node.getEnd()),
});

const qualifySymbolName = (symbolName: string, parentQualifiedName?: string) =>
  parentQualifiedName ? `${parentQualifiedName}.${symbolName}` : symbolName;

const buildSymbolId = ({
  filePath,
  qualifiedSymbolName,
  kind,
  startLine,
  endLine,
}: {
  filePath: string;
  qualifiedSymbolName: string;
  kind: CapabilityCodeSymbolKind;
  startLine: number;
  endLine: number;
}) =>
  `SYM-${createHash('sha1')
    .update(`${filePath}:${qualifiedSymbolName}:${kind}:${startLine}:${endLine}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase()}`;

const createSymbol = ({
  filePath,
  sourceFile,
  node,
  symbolName,
  kind,
  parentDisplayName,
  parentQualifiedName,
  isExported,
}: {
  filePath: string;
  sourceFile: ts.SourceFile;
  node: ts.Node;
  symbolName: string;
  kind: CapabilityCodeSymbolKind;
  parentDisplayName?: string;
  parentQualifiedName?: string;
  isExported: boolean;
}): ExtractedSymbol => {
  const range = readRange(sourceFile, node);
  return {
    symbolName,
    kind,
    parentSymbol: parentDisplayName,
    qualifiedSymbolName: qualifySymbolName(symbolName, parentQualifiedName),
    language: detectSourceLanguage(filePath),
    startLine: range.startLine,
    endLine: range.endLine,
    sliceStartLine: range.startLine,
    sliceEndLine: range.endLine,
    signature: readSignature(sourceFile, node),
    isExported,
  };
};

const extractImportAliasSymbols = (
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.ImportDeclaration | ts.ExportDeclaration,
): ExtractedSymbol[] => {
  const results: ExtractedSymbol[] = [];
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return results;
    if (clause.name) {
      results.push(
        createSymbol({
          filePath,
          sourceFile,
          node,
          symbolName: clause.name.text,
          kind: 'variable',
          isExported: false,
        }),
      );
    }
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        results.push(
          createSymbol({
            filePath,
            sourceFile,
            node,
            symbolName: clause.namedBindings.name.text,
            kind: 'variable',
            isExported: false,
          }),
        );
      } else {
        for (const element of clause.namedBindings.elements) {
          results.push(
            createSymbol({
              filePath,
              sourceFile,
              node,
              symbolName: element.name.text,
              kind: 'variable',
              isExported: false,
            }),
          );
        }
      }
    }
    return results;
  }

  if (!node.exportClause) {
    return results;
  }
  if (ts.isNamedExports(node.exportClause)) {
    for (const element of node.exportClause.elements) {
      results.push(
        createSymbol({
          filePath,
          sourceFile,
          node,
          symbolName: element.name.text,
          kind: 'variable',
          isExported: true,
        }),
      );
    }
    return results;
  }
  if (ts.isNamespaceExport(node.exportClause)) {
    results.push(
      createSymbol({
        filePath,
        sourceFile,
        node,
        symbolName: node.exportClause.name.text,
        kind: 'variable',
        isExported: true,
      }),
    );
  }
  return results;
};

const extractVariableSymbols = (
  filePath: string,
  sourceFile: ts.SourceFile,
  stmt: ts.VariableStatement,
  parentDisplayName?: string,
  parentQualifiedName?: string,
): ExtractedSymbol[] => {
  const exported = hasExportModifier(stmt);
  const results: ExtractedSymbol[] = [];
  for (const decl of stmt.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name)) continue;
    results.push(
      createSymbol({
        filePath,
        sourceFile,
        node: decl,
        symbolName: decl.name.text,
        kind: 'variable',
        parentDisplayName,
        parentQualifiedName,
        isExported: exported,
      }),
    );
  }
  return results;
};

const collectNestedNamedDeclarations = ({
  filePath,
  sourceFile,
  root,
  parentDisplayName,
  parentQualifiedName,
}: {
  filePath: string;
  sourceFile: ts.SourceFile;
  root: ts.Node | undefined;
  parentDisplayName: string;
  parentQualifiedName: string;
}): ExtractedSymbol[] => {
  if (!root) return [];
  const results: ExtractedSymbol[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const symbol = createSymbol({
        filePath,
        sourceFile,
        node,
        symbolName: node.name.text,
        kind: 'function',
        parentDisplayName,
        parentQualifiedName,
        isExported: false,
      });
      results.push(symbol);
      results.push(
        ...collectNestedNamedDeclarations({
          filePath,
          sourceFile,
          root: node.body,
          parentDisplayName: symbol.symbolName,
          parentQualifiedName: symbol.qualifiedSymbolName || symbol.symbolName,
        }),
      );
      return;
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const symbol = createSymbol({
        filePath,
        sourceFile,
        node,
        symbolName: node.name.text,
        kind: 'class',
        parentDisplayName,
        parentQualifiedName,
        isExported: false,
      });
      results.push(symbol);
      results.push(
        ...extractClassMembers({
          filePath,
          sourceFile,
          cls: node,
          parentQualifiedName: symbol.qualifiedSymbolName || symbol.symbolName,
        }),
      );
      return;
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(root, visit);
  return results;
};

const extractClassMembers = ({
  filePath,
  sourceFile,
  cls,
  parentQualifiedName,
}: {
  filePath: string;
  sourceFile: ts.SourceFile;
  cls: ts.ClassDeclaration;
  parentQualifiedName?: string;
}): ExtractedSymbol[] => {
  const className = cls.name?.getText(sourceFile) || '(anonymous)';
  const results: ExtractedSymbol[] = [];
  for (const member of cls.members) {
    let name: string | undefined;
    let kind: CapabilityCodeSymbolKind | null = null;
    let nestedRoot: ts.Node | undefined;
    if (ts.isMethodDeclaration(member)) {
      name = member.name.getText(sourceFile);
      kind = 'method';
      nestedRoot = member.body;
    } else if (ts.isPropertyDeclaration(member)) {
      name = member.name.getText(sourceFile);
      kind = 'property';
    } else if (ts.isConstructorDeclaration(member)) {
      name = 'constructor';
      kind = 'method';
      nestedRoot = member.body;
    } else if (ts.isGetAccessorDeclaration(member)) {
      name = `get ${member.name.getText(sourceFile)}`;
      kind = 'method';
      nestedRoot = member.body;
    } else if (ts.isSetAccessorDeclaration(member)) {
      name = `set ${member.name.getText(sourceFile)}`;
      kind = 'method';
      nestedRoot = member.body;
    }
    if (!name || !kind) continue;
    const symbol = createSymbol({
      filePath,
      sourceFile,
      node: member,
      symbolName: name,
      kind,
      parentDisplayName: className,
      parentQualifiedName,
      isExported: false,
    });
    results.push(symbol);
    results.push(
      ...collectNestedNamedDeclarations({
        filePath,
        sourceFile,
        root: nestedRoot,
        parentDisplayName: symbol.symbolName,
        parentQualifiedName: symbol.qualifiedSymbolName || symbol.symbolName,
      }),
    );
  }
  return results;
};

const extractTopLevelSymbol = (
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): ExtractedSymbol[] => {
  if (ts.isClassDeclaration(node) && node.name) {
    const classSymbol = createSymbol({
      filePath,
      sourceFile,
      node,
      symbolName: node.name.text,
      kind: 'class',
      isExported: hasExportModifier(node),
    });
    return [
      classSymbol,
      ...extractClassMembers({
        filePath,
        sourceFile,
        cls: node,
        parentQualifiedName: classSymbol.qualifiedSymbolName || classSymbol.symbolName,
      }),
    ];
  }
  if (ts.isFunctionDeclaration(node) && node.name) {
    const functionSymbol = createSymbol({
      filePath,
      sourceFile,
      node,
      symbolName: node.name.text,
      kind: 'function',
      isExported: hasExportModifier(node),
    });
    return [
      functionSymbol,
      ...collectNestedNamedDeclarations({
        filePath,
        sourceFile,
        root: node.body,
        parentDisplayName: functionSymbol.symbolName,
        parentQualifiedName:
          functionSymbol.qualifiedSymbolName || functionSymbol.symbolName,
      }),
    ];
  }
  if (ts.isInterfaceDeclaration(node)) {
    return [
      createSymbol({
        filePath,
        sourceFile,
        node,
        symbolName: node.name.text,
        kind: 'interface',
        isExported: hasExportModifier(node),
      }),
    ];
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return [
      createSymbol({
        filePath,
        sourceFile,
        node,
        symbolName: node.name.text,
        kind: 'type',
        isExported: hasExportModifier(node),
      }),
    ];
  }
  if (ts.isEnumDeclaration(node)) {
    return [
      createSymbol({
        filePath,
        sourceFile,
        node,
        symbolName: node.name.text,
        kind: 'enum',
        isExported: hasExportModifier(node),
      }),
    ];
  }
  if (ts.isVariableStatement(node)) {
    return extractVariableSymbols(filePath, sourceFile, node);
  }
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return extractImportAliasSymbols(filePath, sourceFile, node);
  }
  return [];
};

const extractModuleReference = (node: ts.Node): ExtractedReference | null => {
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

export const normalizeExtractedSymbols = (
  filePath: string,
  symbols: ExtractedSymbol[],
): ExtractedSymbol[] => {
  const language = detectSourceLanguage(filePath);
  const withIds = symbols.map(symbol => {
    const qualifiedSymbolName =
      String(symbol.qualifiedSymbolName || '').trim() ||
      qualifySymbolName(symbol.symbolName, symbol.parentSymbol);
    const startLine = Number(symbol.startLine) || 1;
    const endLine = Number(symbol.endLine) || startLine;
    return {
      ...symbol,
      language: symbol.language || language,
      qualifiedSymbolName,
      sliceStartLine: Number(symbol.sliceStartLine) || startLine,
      sliceEndLine: Number(symbol.sliceEndLine) || endLine,
      symbolId:
        symbol.symbolId ||
        buildSymbolId({
          filePath,
          qualifiedSymbolName,
          kind: symbol.kind,
          startLine,
          endLine,
        }),
    };
  });

  const idByQualifiedName = new Map<string, string>();
  for (const symbol of withIds) {
    if (!idByQualifiedName.has(symbol.qualifiedSymbolName || '')) {
      idByQualifiedName.set(symbol.qualifiedSymbolName || '', symbol.symbolId || '');
    }
  }

  return withIds.map(symbol => {
    if (symbol.containerSymbolId) {
      return symbol;
    }
    const parentQualifiedName = (() => {
      const qualified = String(symbol.qualifiedSymbolName || '').trim();
      if (qualified.includes('.')) {
        return qualified.split('.').slice(0, -1).join('.');
      }
      const parentSymbol = String(symbol.parentSymbol || '').trim();
      return parentSymbol || '';
    })();
    return {
      ...symbol,
      containerSymbolId: parentQualifiedName
        ? idByQualifiedName.get(parentQualifiedName) || undefined
        : undefined,
    };
  });
};

/**
 * Walk a single source file and extract its symbols + module references.
 * Pure function; no DB calls.
 */
export const extractSymbolsFromSource = (
  filePath: string,
  content: string,
): ParsedSourceFile => {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    pickScriptKind(filePath),
  );

  const symbols: ExtractedSymbol[] = [];
  const references: ExtractedReference[] = [];

  for (const statement of sourceFile.statements) {
    symbols.push(...extractTopLevelSymbol(filePath, sourceFile, statement));
    const ref = extractModuleReference(statement);
    if (ref) references.push(ref);
  }

  return { symbols: normalizeExtractedSymbols(filePath, symbols), references };
};
