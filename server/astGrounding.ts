import type { Capability, CapabilityCodeSymbolKind, WorkItem } from "../src/types";
import { searchCodeSymbols } from "./codeIndex/query";
import { buildCodeSearchCandidates, looksLikeCodeQuestion } from "./codeDiscovery";
import {
  getLocalCheckoutAstFreshness,
  listLocalCheckoutAllSymbols,
  searchLocalCheckoutSymbols,
} from "./localCodeIndex";
import { resolveCapabilityCodeRoots } from "./codeRoots";

export type AstGroundingSummary = {
  prompt?: string;
  astGroundingMode:
    | "ast-grounded-local-clone"
    | "ast-grounded-remote-index"
    | "no-ast-grounding";
  isCodeQuestion: boolean;
  checkoutPath?: string;
  branchName?: string;
  codeIndexSource?: "local-checkout" | "capability-index";
  codeIndexFreshness?: string;
  verifiedPaths?: string[];
  groundingEvidenceSource?: "local-checkout" | "capability-index" | "none";
  /**
   * True when a code question was detected but neither a local clone nor a
   * remote capability code index was available. The caller should schedule an
   * on-demand index bootstrap so the NEXT chat turn gets grounding.
   */
  shouldBootstrapIndex?: boolean;
};


const buildLocalPathFallback = async ({
  checkoutPath,
  capabilityId,
  repositoryId,
  terms,
}: {
  checkoutPath: string;
  capabilityId: string;
  repositoryId: string;
  terms: string[];
}) => {
  if (terms.length === 0) {
    return null;
  }
  const { symbols, builtAt } = await listLocalCheckoutAllSymbols({
    checkoutPath,
    capabilityId,
    repositoryId,
    limit: 3000,
  }).catch(() => ({
    symbols: [] as Awaited<ReturnType<typeof listLocalCheckoutAllSymbols>>["symbols"],
    builtAt: undefined,
  }));
  if (symbols.length === 0) {
    return null;
  }

  const scored = symbols
    .map((symbol) => {
      const pathValue = symbol.filePath.toLowerCase();
      const qualified = String(symbol.qualifiedSymbolName || "").toLowerCase();
      const name = symbol.symbolName.toLowerCase();
      const symbolKind = String(symbol.kind || "").toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (pathValue.includes(term)) score += 90;
        if (qualified.includes(term)) score += 60;
        if (name.includes(term)) score += 45;
      }
      if (
        symbolKind === "class" ||
        symbolKind === "interface" ||
        symbolKind === "enum"
      ) {
        score += 10;
      }
      return { symbol, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.symbol.filePath.localeCompare(right.symbol.filePath);
    });

  if (scored.length === 0) {
    return null;
  }

  const topSymbols = scored.slice(0, 10).map((entry) => entry.symbol);
  const uniqueFiles = new Set(topSymbols.map((symbol) => symbol.filePath));
  const topLevelMatches = new Set(
    scored
      .filter(
        (entry) => {
          const symbolKind = String(entry.symbol.kind || "").toLowerCase();
          return (
            symbolKind === "class" ||
            symbolKind === "interface" ||
            symbolKind === "enum"
          );
        },
      )
      .map((entry) => `${entry.symbol.filePath}:${entry.symbol.qualifiedSymbolName}`),
  );

  return {
    builtAt,
    fileCount: uniqueFiles.size,
    topLevelCount: topLevelMatches.size,
    symbols: topSymbols,
  };
};

const toVerifiedPath = (symbolFilePath: string, checkoutRoot?: string) =>
  checkoutRoot
    ? `${checkoutRoot.replace(/\/+$/, "")}/${symbolFilePath.replace(/^\/+/, "")}`
    : symbolFilePath;

const formatSymbolRows = (
  symbols: Array<{
    qualifiedSymbolName?: string;
    symbolName?: string;
    kind: CapabilityCodeSymbolKind;
    filePath: string;
    sliceStartLine?: number;
    sliceEndLine?: number;
    signature?: string;
  }>,
  checkoutRoot?: string,
) =>
  symbols.map((symbol) => {
    const range = `${symbol.sliceStartLine || 1}-${symbol.sliceEndLine || symbol.sliceStartLine || 1}`;
    const signature = symbol.signature ? ` — ${symbol.signature}` : "";
    const displayName =
      String(symbol.qualifiedSymbolName || "").trim() ||
      String(symbol.symbolName || "").trim() ||
      symbol.filePath;
    // Emit absolute path so the agent can pass it directly to workspace_read
    // without constructing or guessing any directory structure.
    const absolutePath = toVerifiedPath(symbol.filePath, checkoutRoot);
    return `- ${displayName} (${symbol.kind}) at ${absolutePath}:${range}${signature}`;
  });

export const buildAstGroundingSummary = async ({
  capability,
  workItem,
  message,
  checkoutPath,
  repositoryId,
  branchName,
}: {
  capability: Pick<Capability, "id" | "name">;
  workItem?: Pick<WorkItem, "id" | "title">;
  message: string;
  checkoutPath?: string;
  repositoryId?: string;
  branchName?: string;
}): Promise<AstGroundingSummary> => {
  const isCodeQuestion = looksLikeCodeQuestion(message);
  if (!isCodeQuestion) {
    return {
      astGroundingMode: "no-ast-grounding",
      isCodeQuestion: false,
      verifiedPaths: [],
      groundingEvidenceSource: "none",
    };
  }

  const { queries, searchTerms, candidates } = buildCodeSearchCandidates(message);
  if (candidates.length === 0) {
    return {
      astGroundingMode: "no-ast-grounding",
      isCodeQuestion,
      verifiedPaths: [],
      groundingEvidenceSource: "none",
      // No candidates means the query was too vague — not a missing index.
    };
  }

  const localCloneCandidates = await resolveCapabilityCodeRoots({
    capability: {
      id: capability.id,
      name: capability.name,
      repositories: [],
    },
    workItem,
    explicitCheckoutPath: checkoutPath,
    explicitRepositoryId: repositoryId,
  });

  // Track the first valid candidate for fallback (even if no symbols match).
  let firstValidCandidate: { checkoutPath: string; repositoryId: string } | null = null;

  for (const candidate of localCloneCandidates) {
    if (!firstValidCandidate) firstValidCandidate = candidate;

    const localResults = [];
    for (const query of candidates) {
      const result = await searchLocalCheckoutSymbols({
        checkoutPath: candidate.checkoutPath,
        capabilityId: capability.id,
        repositoryId: candidate.repositoryId,
        query,
        limit: 6,
      }).catch(() => null);
      if (result?.symbols?.length) {
        localResults.push(...result.symbols);
      }
      if (localResults.length >= 6) break;
    }

    if (localResults.length > 0) {
      const deduped = Array.from(
        new Map(localResults.map((symbol) => [symbol.symbolId, symbol])).values(),
      ).slice(0, 6);
      const freshness = getLocalCheckoutAstFreshness(candidate.checkoutPath);
      const isBaseClone = !checkoutPath;
      const resolvedRoot = candidate.checkoutPath.replace(/\/+$/, "");
      return {
        prompt: [
          `AST grounding from local ${isBaseClone ? "base clone" : "checkout"}${workItem ? ` for ${workItem.id}` : ""}${branchName ? ` on branch ${branchName}` : ""}:`,
          `Repository root on disk: ${resolvedRoot}`,
          `IMPORTANT: The file paths below are absolute. Use the workspace_read or browse_code tool`,
          `with these exact paths. Do NOT use shell commands (cd, ls, find) or construct directory`,
          `paths manually — only the paths shown here are guaranteed to exist.`,
          ...formatSymbolRows(deduped, resolvedRoot),
        ].join("\n"),
        astGroundingMode: "ast-grounded-local-clone",
        isCodeQuestion,
        checkoutPath: candidate.checkoutPath,
        branchName,
        codeIndexSource: "local-checkout",
        codeIndexFreshness: freshness,
        verifiedPaths: deduped.map(symbol =>
          toVerifiedPath(symbol.filePath, resolvedRoot),
        ),
        groundingEvidenceSource: "local-checkout",
      };
    }

    const localPathFallback = await buildLocalPathFallback({
      checkoutPath: candidate.checkoutPath,
      capabilityId: capability.id,
      repositoryId: candidate.repositoryId,
      terms: searchTerms,
    });
    if (localPathFallback) {
      const resolvedRoot = candidate.checkoutPath.replace(/\/+$/, "");
      const isBaseClone = !checkoutPath;
      return {
        prompt: [
          `Repository-backed grounding from local ${isBaseClone ? "base clone" : "checkout"}${workItem ? ` for ${workItem.id}` : ""}${branchName ? ` on branch ${branchName}` : ""}:`,
          `Repository root on disk: ${resolvedRoot}`,
          `Indexed top-level matches: ${localPathFallback.topLevelCount}; matching files: ${localPathFallback.fileCount}.`,
          `Use only the concrete paths below when you answer. If they are not enough, say the evidence is incomplete instead of inventing more files.`,
          ...formatSymbolRows(localPathFallback.symbols, resolvedRoot),
        ].join("\n"),
        astGroundingMode: "ast-grounded-local-clone",
        isCodeQuestion,
        checkoutPath: candidate.checkoutPath,
        branchName,
        codeIndexSource: "local-checkout",
        codeIndexFreshness: localPathFallback.builtAt,
        verifiedPaths: localPathFallback.symbols.map(symbol =>
          toVerifiedPath(symbol.filePath, resolvedRoot),
        ),
        groundingEvidenceSource: "local-checkout",
      };
    }
  }

  // No symbol matches from any local clone, but we know where the repo lives.
  // Provide a minimal grounding so the agent uses tools rather than hallucinating.
  if (firstValidCandidate) {
    const resolvedRoot = firstValidCandidate.checkoutPath.replace(/\/+$/, "");
    return {
      prompt: [
        `Code grounding: repository root on disk is ${resolvedRoot}`,
        `No indexed symbols matched your query — use the browse_code tool to list`,
        `actual classes/functions, or workspace_search to find symbols by name.`,
        `Do NOT construct file paths manually or use shell commands (bash, cd, find).`,
        `All file paths must come from browse_code or workspace_search output.`,
      ].join("\n"),
      astGroundingMode: "ast-grounded-local-clone",
      isCodeQuestion,
      checkoutPath: firstValidCandidate.checkoutPath,
      branchName,
      codeIndexSource: "local-checkout",
      verifiedPaths: [],
      groundingEvidenceSource: "local-checkout",
      // Clone exists but AST index had no hits — queue a refresh automatically.
      shouldBootstrapIndex: true,
    };
  }

  const remoteResults = [];
  for (const query of candidates) {
    const result = await searchCodeSymbols(capability.id, query, {
      limit: 6,
    }).catch(() => []);
    if (result.length) {
      remoteResults.push(...result);
    }
    if (remoteResults.length >= 6) break;
  }

  if (remoteResults.length === 0) {
    // Even with no symbol hits, tell the agent to use structured tools.
    // Also signal that the index needs bootstrapping — the chat route will
    // schedule a background sync so the next query gets grounding.
    return {
      prompt: [
        `Code grounding: no symbols matched your query in the capability code index.`,
        `Use the browse_code tool to list actual classes/functions in the indexed repositories,`,
        `or workspace_search to find symbols by name.`,
        `Do NOT construct file paths manually or use bash/shell commands for file discovery.`,
      ].join("\n"),
      astGroundingMode: "no-ast-grounding",
      isCodeQuestion,
      checkoutPath,
      branchName,
      verifiedPaths: [],
      groundingEvidenceSource: "none",
      shouldBootstrapIndex: true,
    };
  }

  const deduped = Array.from(
    new Map(remoteResults.map((symbol) => [symbol.symbolId, symbol])).values(),
  ).slice(0, 6);
  return {
    prompt: [
      `AST grounding from the capability code index${workItem ? ` for ${workItem.id}` : ""}:`,
      `IMPORTANT: Use workspace_search or browse_code to discover actual file locations.`,
      `Do NOT guess or construct file paths — use only paths returned by tools.`,
      ...formatSymbolRows(deduped),
    ].join("\n"),
    astGroundingMode: "ast-grounded-remote-index",
    isCodeQuestion,
    checkoutPath,
    branchName,
    codeIndexSource: "capability-index",
    verifiedPaths: deduped.map(symbol => symbol.filePath),
    groundingEvidenceSource: "capability-index",
  };
};
