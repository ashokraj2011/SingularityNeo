import fs from "node:fs/promises";
import path from "node:path";
import type {
  CapabilityCodeSymbol,
  CapabilityCodeSymbolKind,
} from "../src/types";
import {
  detectSourceLanguage,
  extractSymbolsFromSource,
  type ExtractedSymbol,
} from "./codeIndex/parse";
import { extractSymbolsFromJavaSource } from "./codeIndex/parseJava";
import { extractSymbolsFromPythonSource } from "./codeIndex/parsePython";
import { normalizeDirectoryPath } from "./workspacePaths";

const MAX_FILES_PER_CHECKOUT = 1500;
const MAX_FILE_BYTES = 256 * 1024;
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|java|py|pyw)$/i;
const DENY_PATH_PATTERNS: RegExp[] = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)dist(\/|$)/,
  /(^|\/)build(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.turbo(\/|$)/,
  /(^|\/)\.cache(\/|$)/,
  /(^|\/)coverage(\/|$)/,
  /(^|\/)out(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)vendor(\/|$)/,
  /(^|\/)target(\/|$)/,
  /(^|\/)\.gradle(\/|$)/,
  /(^|\/)generated(\/|$)/,
  /(^|\/)generated-sources(\/|$)/,
  /(^|\/)__pycache__(\/|$)/,
  /(^|\/)\.venv(\/|$)/,
  /(^|\/)venv(\/|$)/,
  /(^|\/)env(\/|$)/,
  /(^|\/)\.tox(\/|$)/,
  /(^|\/)\.mypy_cache(\/|$)/,
  /(^|\/)\.pytest_cache(\/|$)/,
  /(^|\/)\.ruff_cache(\/|$)/,
  /(^|\/)site-packages(\/|$)/,
  /\.egg-info(\/|$)/,
  /\.min\.(js|mjs|cjs)$/i,
  /\.d\.ts$/i,
  /\.pyi$/i,
];
const SOURCE_PATH_PRIORITY_PATTERNS: Array<{ pattern: RegExp; score: number }> =
  [
    { pattern: /(^|\/)(src|app|server|client|lib|internal)\//i, score: 0 },
    { pattern: /(^|\/)packages\/[^/]+\/src\//i, score: 0 },
    { pattern: /(^|\/)(components|services|modules|domain|api)\//i, score: 1 },
    { pattern: /(^|\/)(tests?|spec|__tests__)\//i, score: 3 },
    { pattern: /(^|\/)(examples?|sample|demo|scripts)\//i, score: 4 },
  ];

type LocalSymbolEntry = CapabilityCodeSymbol & {
  repositoryId: string;
  checkoutPath: string;
};

type LocalCodeIndexSnapshot = {
  builtAt: string;
  symbols: LocalSymbolEntry[];
};

const localCodeIndexCache = new Map<string, LocalCodeIndexSnapshot>();
const localCodeIndexRefreshes = new Map<string, Promise<LocalCodeIndexSnapshot>>();
const localCodeIndexQueued = new Set<string>();

const shouldIndex = (filePath: string) =>
  SOURCE_EXTENSIONS.test(filePath) &&
  !DENY_PATH_PATTERNS.some((pattern) => pattern.test(filePath));

const scoreIndexCandidatePath = (filePath: string) => {
  for (const entry of SOURCE_PATH_PRIORITY_PATTERNS) {
    if (entry.pattern.test(filePath)) {
      return entry.score;
    }
  }
  return 2;
};

const parseSourceFile = (filePath: string, content: string) => {
  if (/\.java$/i.test(filePath)) {
    return extractSymbolsFromJavaSource(filePath, content);
  }
  if (/\.pyw?$/i.test(filePath)) {
    return extractSymbolsFromPythonSource(filePath, content);
  }
  return extractSymbolsFromSource(filePath, content);
};

const normalizeQualifiedSymbolName = (
  symbolName: string,
  parentSymbol?: string,
  qualifiedSymbolName?: string,
) => {
  const explicit = String(qualifiedSymbolName || "").trim();
  if (explicit) {
    return explicit;
  }
  const parent = String(parentSymbol || "").trim();
  return parent ? `${parent}.${symbolName}` : symbolName;
};

const buildLocalSymbolId = ({
  repositoryId,
  filePath,
  qualifiedSymbolName,
  kind,
  startLine,
  endLine,
}: {
  repositoryId: string;
  filePath: string;
  qualifiedSymbolName: string;
  kind: string;
  startLine: number;
  endLine: number;
}) =>
  `LOCAL-${Buffer.from(
    `${repositoryId}:${filePath}:${qualifiedSymbolName}:${kind}:${startLine}:${endLine}`,
  )
    .toString("base64")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 20)}`;

const toCapabilityCodeSymbol = ({
  capabilityId,
  repositoryId,
  checkoutPath,
  filePath,
  symbol,
}: {
  capabilityId: string;
  repositoryId: string;
  checkoutPath: string;
  filePath: string;
  symbol: ExtractedSymbol;
}): LocalSymbolEntry => {
  const qualifiedSymbolName = normalizeQualifiedSymbolName(
    symbol.symbolName,
    symbol.parentSymbol,
    symbol.qualifiedSymbolName,
  );
  return {
    capabilityId,
    repositoryId,
    filePath,
    symbolId:
      String(symbol.symbolId || "").trim() ||
      buildLocalSymbolId({
        repositoryId,
        filePath,
        qualifiedSymbolName,
        kind: symbol.kind,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
      }),
    containerSymbolId: symbol.containerSymbolId || undefined,
    symbolName: symbol.symbolName,
    qualifiedSymbolName,
    kind: symbol.kind,
    language:
      String(symbol.language || "").trim() || detectSourceLanguage(filePath),
    parentSymbol: symbol.parentSymbol || undefined,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    sliceStartLine: symbol.sliceStartLine || symbol.startLine,
    sliceEndLine: symbol.sliceEndLine || symbol.endLine,
    signature: symbol.signature,
    isExported: Boolean(symbol.isExported),
    indexedAt: new Date().toISOString(),
    repositoryLabel: repositoryId,
    sha: undefined,
    checkoutPath,
  };
};

const listIndexableFiles = async (checkoutPath: string) => {
  const root = normalizeDirectoryPath(checkoutPath);
  const files: string[] = [];

  const walk = async (currentDirectory: string) => {
    const children = await fs.readdir(currentDirectory, { withFileTypes: true });
    for (const child of children) {
      const absolutePath = path.join(currentDirectory, child.name);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
      if (!relativePath || DENY_PATH_PATTERNS.some((pattern) => pattern.test(relativePath))) {
        continue;
      }
      if (child.isDirectory()) {
        await walk(absolutePath);
        if (files.length >= MAX_FILES_PER_CHECKOUT) {
          return;
        }
        continue;
      }
      if (!child.isFile() || !shouldIndex(relativePath)) {
        continue;
      }
      const stats = await fs.stat(absolutePath);
      if (stats.size <= MAX_FILE_BYTES) {
        files.push(relativePath);
      }
      if (files.length >= MAX_FILES_PER_CHECKOUT) {
        return;
      }
    }
  };

  await walk(root);
  return files
    .sort((left, right) => {
      const scoreDelta = scoreIndexCandidatePath(left) - scoreIndexCandidatePath(right);
      if (scoreDelta !== 0) return scoreDelta;
      const lengthDelta = left.length - right.length;
      if (lengthDelta !== 0) return lengthDelta;
      return left.localeCompare(right);
    })
    .slice(0, MAX_FILES_PER_CHECKOUT);
};

const buildLocalCheckoutIndex = async ({
  checkoutPath,
  capabilityId,
  repositoryId,
}: {
  checkoutPath: string;
  capabilityId: string;
  repositoryId: string;
}) => {
  const normalizedCheckoutPath = normalizeDirectoryPath(checkoutPath);
  const files = await listIndexableFiles(normalizedCheckoutPath);
  const symbols: LocalSymbolEntry[] = [];

  for (const relativePath of files) {
    const absolutePath = path.join(normalizedCheckoutPath, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    const parsed = parseSourceFile(relativePath, content);
    parsed.symbols.forEach((symbol) => {
      symbols.push(
        toCapabilityCodeSymbol({
          capabilityId,
          repositoryId,
          checkoutPath: normalizedCheckoutPath,
          filePath: relativePath,
          symbol,
        }),
      );
    });
  }

  return {
    builtAt: new Date().toISOString(),
    symbols,
  } satisfies LocalCodeIndexSnapshot;
};

const refreshLocalCheckoutIndex = async ({
  checkoutPath,
  capabilityId,
  repositoryId,
}: {
  checkoutPath: string;
  capabilityId: string;
  repositoryId: string;
}) => {
  const cacheKey = normalizeDirectoryPath(checkoutPath);
  const refresh = buildLocalCheckoutIndex({
    checkoutPath: cacheKey,
    capabilityId,
    repositoryId,
  }).then((snapshot) => {
    localCodeIndexCache.set(cacheKey, snapshot);
    localCodeIndexRefreshes.delete(cacheKey);
    return snapshot;
  });
  localCodeIndexRefreshes.set(cacheKey, refresh);
  return refresh;
};

const getOrBuildLocalCheckoutIndex = async ({
  checkoutPath,
  capabilityId,
  repositoryId,
}: {
  checkoutPath: string;
  capabilityId: string;
  repositoryId: string;
}) => {
  const cacheKey = normalizeDirectoryPath(checkoutPath);
  const existing = localCodeIndexCache.get(cacheKey);
  if (existing) {
    return existing;
  }
  const inFlight = localCodeIndexRefreshes.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }
  return refreshLocalCheckoutIndex({ checkoutPath: cacheKey, capabilityId, repositoryId });
};

const scoreLocalSymbolMatch = (
  symbol: LocalSymbolEntry,
  normalizedQuery: string,
) => {
  const normalizedQualified = symbol.qualifiedSymbolName.toLowerCase();
  const normalizedName = symbol.symbolName.toLowerCase();
  let score = 0;

  if (normalizedQualified === normalizedQuery) score += 1000;
  else if (normalizedName === normalizedQuery) score += 900;
  else if (normalizedQualified.startsWith(normalizedQuery)) score += 700;
  else if (normalizedName.startsWith(normalizedQuery)) score += 650;
  else if (normalizedQualified.includes(normalizedQuery)) score += 500;
  else if (normalizedName.includes(normalizedQuery)) score += 450;

  if (symbol.isExported) score += 40;
  score -= Math.min(symbol.filePath.length, 120);
  return score;
};

export const searchLocalCheckoutSymbols = async ({
  checkoutPath,
  capabilityId,
  repositoryId,
  query,
  kind,
  limit = 8,
}: {
  checkoutPath: string;
  capabilityId: string;
  repositoryId: string;
  query: string;
  kind?: CapabilityCodeSymbolKind;
  limit?: number;
}) => {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return {
      symbols: [] as LocalSymbolEntry[],
      source: "local-checkout" as const,
      builtAt: undefined,
    };
  }

  const snapshot = await getOrBuildLocalCheckoutIndex({
    checkoutPath,
    capabilityId,
    repositoryId,
  });
  const symbols = snapshot.symbols
    .filter((symbol) => (kind ? symbol.kind === kind : true))
    .map((symbol) => ({
      symbol,
      score: scoreLocalSymbolMatch(symbol, normalizedQuery),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.symbol.filePath.localeCompare(right.symbol.filePath);
    })
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map((entry) => entry.symbol);

  return {
    symbols,
    source: "local-checkout" as const,
    builtAt: snapshot.builtAt,
  };
};

export const findLocalCheckoutSymbolRange = async ({
  checkoutPath,
  capabilityId,
  repositoryId,
  relativePath,
  symbolQuery,
}: {
  checkoutPath: string;
  capabilityId: string;
  repositoryId: string;
  relativePath: string;
  symbolQuery: string;
}) => {
  const snapshot = await getOrBuildLocalCheckoutIndex({
    checkoutPath,
    capabilityId,
    repositoryId,
  });
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const normalizedQuery = String(symbolQuery || "").trim().toLowerCase();
  const match = snapshot.symbols.find(
    (symbol) =>
      symbol.filePath === normalizedPath &&
      (symbol.qualifiedSymbolName.toLowerCase() === normalizedQuery ||
        symbol.symbolName.toLowerCase() === normalizedQuery),
  );
  if (!match) {
    return null;
  }
  return {
    symbolId: match.symbolId,
    containerSymbolId: match.containerSymbolId,
    qualifiedSymbolName: match.qualifiedSymbolName,
    kind: match.kind,
    startLine: match.startLine,
    endLine: match.endLine,
    sliceStartLine: match.sliceStartLine,
    sliceEndLine: match.sliceEndLine,
    source: "local-checkout" as const,
    builtAt: snapshot.builtAt,
  };
};

export const queueLocalCheckoutAstRefresh = ({
  checkoutPath,
  capabilityId,
  repositoryId,
}: {
  checkoutPath: string;
  capabilityId: string;
  repositoryId: string;
}) => {
  const cacheKey = normalizeDirectoryPath(checkoutPath);
  if (!cacheKey) {
    return;
  }

  localCodeIndexCache.delete(cacheKey);
  if (localCodeIndexRefreshes.has(cacheKey)) {
    localCodeIndexQueued.add(cacheKey);
    return;
  }

  void refreshLocalCheckoutIndex({
    checkoutPath: cacheKey,
    capabilityId,
    repositoryId,
  }).finally(() => {
    if (!localCodeIndexQueued.has(cacheKey)) {
      return;
    }
    localCodeIndexQueued.delete(cacheKey);
    queueLocalCheckoutAstRefresh({
      checkoutPath: cacheKey,
      capabilityId,
      repositoryId,
    });
  });
};

export const forceLocalCheckoutAstRefresh = async ({
  checkoutPath,
  capabilityId,
  repositoryId,
}: {
  checkoutPath: string;
  capabilityId: string;
  repositoryId: string;
}) => {
  const cacheKey = normalizeDirectoryPath(checkoutPath);
  localCodeIndexCache.delete(cacheKey);
  return refreshLocalCheckoutIndex({
    checkoutPath: cacheKey,
    capabilityId,
    repositoryId,
  });
};

export const getLocalCheckoutAstFreshness = (checkoutPath: string) => {
  const snapshot = localCodeIndexCache.get(normalizeDirectoryPath(checkoutPath));
  return snapshot?.builtAt;
};
