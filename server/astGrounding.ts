import type { Capability, CapabilityCodeSymbolKind, WorkItem } from "../src/types";
import { searchCodeSymbols } from "./codeIndex/query";
import {
  getLocalCheckoutAstFreshness,
  searchLocalCheckoutSymbols,
} from "./localCodeIndex";
import { getCapabilityBaseClones } from "./desktopRepoSync";

const CODE_PROMPT_PATTERNS = [
  /\b(code|function|method|class|symbol|ast|call(s|er|ee)?|implement|change|patch|diff|bug|fix|refactor|file|module|api|query|branch|repo|repository)\b/i,
  /[`'"]?[A-Z][A-Za-z0-9_]+[`'"]?/,
  /\b[a-z][A-Za-z0-9_]*\.[a-z][A-Za-z0-9_]*\b/,
  /\b[a-z][A-Za-z0-9_]*(?:Service|Controller|Repository|Manager|Client|Handler)\b/,
  /\bsrc\/|\.ts\b|\.tsx\b|\.js\b|\.java\b|\.py\b/i,
];

export type AstGroundingSummary = {
  prompt?: string;
  astGroundingMode:
    | "ast-grounded-local-clone"
    | "ast-grounded-remote-index"
    | "no-ast-grounding";
  checkoutPath?: string;
  branchName?: string;
  codeIndexSource?: "local-checkout" | "capability-index";
  codeIndexFreshness?: string;
};

const normalizeIdentifierCandidate = (value: string) =>
  value
    .replace(/^[`'"(<[{]+|[`'")>\]},.:;!?]+$/g, "")
    .trim();

const extractCodeQueries = (message: string) => {
  const queries = new Set<string>();
  const trimmed = String(message || "").trim();
  if (!trimmed) return [];

  const backtickMatches: string[] = trimmed.match(/`([^`]+)`/g) || [];
  backtickMatches.forEach((match) => {
    const normalized = normalizeIdentifierCandidate(match.slice(1, -1));
    if (normalized) queries.add(normalized);
  });

  const dotMatches =
    trimmed.match(/\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
  dotMatches.forEach((match) => queries.add(match));

  const identifierMatches =
    trimmed.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [];
  identifierMatches.forEach((match) => {
    if (
      /^(what|when|where|which|should|would|could|there|their|about|have|with|from|into|after|before|needs|need|this|that|these|those)$/i.test(
        match,
      )
    ) {
      return;
    }
    queries.add(match);
  });

  return [...queries].slice(0, 6);
};

const formatSymbolRows = (
  symbols: Array<{
    qualifiedSymbolName: string;
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
    // Emit absolute path so the agent can pass it directly to workspace_read
    // without constructing or guessing any directory structure.
    const absolutePath = checkoutRoot
      ? `${checkoutRoot.replace(/\/+$/, "")}/${symbol.filePath.replace(/^\/+/, "")}`
      : symbol.filePath;
    return `- ${symbol.qualifiedSymbolName} (${symbol.kind}) at ${absolutePath}:${range}${signature}`;
  });

const looksLikeCodeQuestion = (message: string) =>
  CODE_PROMPT_PATTERNS.some((pattern) => pattern.test(String(message || "")));

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
  if (!looksLikeCodeQuestion(message)) {
    return {
      astGroundingMode: "no-ast-grounding",
    };
  }

  const queries = extractCodeQueries(message);
  if (queries.length === 0) {
    return {
      astGroundingMode: "no-ast-grounding",
    };
  }

  // Build a list of (checkoutPath, repositoryId) pairs to try for local grounding.
  // Priority: explicit work-item clone → base clones registered at desktop claim time.
  const localCloneCandidates: Array<{ checkoutPath: string; repositoryId: string }> = [];

  if (checkoutPath && repositoryId) {
    localCloneCandidates.push({ checkoutPath, repositoryId });
  }

  // Fall back to base clones seeded by desktop claim when no work-item checkout is given.
  if (!checkoutPath) {
    const baseClones = getCapabilityBaseClones(capability.id).filter(e => e.isGitRepo);
    // Primary repo first.
    const sorted = [
      ...baseClones.filter(e => e.isPrimary),
      ...baseClones.filter(e => !e.isPrimary),
    ];
    for (const clone of sorted) {
      localCloneCandidates.push({ checkoutPath: clone.checkoutPath, repositoryId: clone.repositoryId });
    }
  }

  // Track the first valid candidate for fallback (even if no symbols match).
  let firstValidCandidate: { checkoutPath: string; repositoryId: string } | null = null;

  for (const candidate of localCloneCandidates) {
    if (!firstValidCandidate) firstValidCandidate = candidate;

    const localResults = [];
    for (const query of queries) {
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
        checkoutPath: candidate.checkoutPath,
        branchName,
        codeIndexSource: "local-checkout",
        codeIndexFreshness: freshness,
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
      checkoutPath: firstValidCandidate.checkoutPath,
      branchName,
      codeIndexSource: "local-checkout",
    };
  }

  const remoteResults = [];
  for (const query of queries) {
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
    return {
      prompt: [
        `Code grounding: no symbols matched your query in the capability code index.`,
        `Use the browse_code tool to list actual classes/functions in the indexed repositories,`,
        `or workspace_search to find symbols by name.`,
        `Do NOT construct file paths manually or use bash/shell commands for file discovery.`,
      ].join("\n"),
      astGroundingMode: "no-ast-grounding",
      checkoutPath,
      branchName,
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
    checkoutPath,
    branchName,
    codeIndexSource: "capability-index",
  };
};
