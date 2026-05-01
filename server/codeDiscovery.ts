export type CodeQuestionType =
  | "inventory"
  | "count"
  | "location"
  | "explanation"
  | "implementation"
  | "file-wide"
  | "unknown";

export type WeightedCodeSearchCandidate = {
  query: string;
  weight: number;
  reason: "explicit" | "normalized" | "alias" | "text-fallback";
};

const CODE_PROMPT_PATTERNS = [
  // Generic code-structure vocabulary — not tied to any specific codebase or domain.
  /\b(code|function|method|class|symbol|ast|call(s|er|ee)?|implement|change|patch|diff|bug|fix|refactor|file|module|api|query|branch|repo|repository|operator|operators|op|ops|predicate|predicates|comparator|comparators|condition|conditions|interface|enum|package|import|extends|implements)\b/i,
  /\bhow many\b.*\b(classes?|operators?|interfaces?|enums?|methods?|files?)\b/i,
  // PascalCase identifiers — likely a class, type, or interface name.
  /[`'"]?[A-Z][A-Za-z0-9_]+[`'"]?/,
  // Dot-access patterns — likely a method or field reference.
  /\b[a-z][A-Za-z0-9_]*\.[a-z][A-Za-z0-9_]*\b/,
  // Common architectural suffix patterns — framework-agnostic.
  /\b[a-z][A-Za-z0-9_]*(?:Service|Controller|Repository|Manager|Client|Handler|Operator)\b/,
  // File extension hints in the message.
  /\bsrc\/|\.ts\b|\.tsx\b|\.js\b|\.java\b|\.py\b/i,
];

// Universal English function/grammar words that carry no structural meaning
// for code search. Do NOT add domain terms here (e.g. "rule", "engine",
// "service") — those are meaningful search tokens in any codebase.
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "into",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "how",
  "what",
  "when",
  "where",
  "which",
  "who",
  "there",
  "their",
  "about",
  "after",
  "before",
  "need",
  "needs",
  "many",
  "much",
  "some",
  "any",
  "all",
]);

// Common phonetic/keyboard typo corrections for code identifiers.
// Only include universally common misspellings — never project-specific names.
const TERM_CORRECTIONS = new Map<string, string>([
  ["fucntion", "function"],
  ["funciton", "function"],
  ["calss", "class"],
  ["inteface", "interface"],
  ["impelment", "implement"],
  ["implment", "implement"],
  ["methdo", "method"],
  ["retrun", "return"],
]);

// Generic structural alias groups — maps common informal terms to their
// canonical code-structure equivalents.
// Do NOT add project-specific synonyms (e.g. "evalCondition", "enum Operator").
const CODE_ALIAS_GROUPS: Array<{
  triggers: string[];
  aliases: string[];
}> = [
  {
    // "method" and "function" are semantically interchangeable in most languages.
    triggers: ["method", "methods", "func", "function", "functions"],
    aliases: ["function", "method"],
  },
  {
    // "interface" often appears alongside "type" and "contract" in typed languages.
    triggers: ["interface", "interfaces"],
    aliases: ["interface", "type"],
  },
  {
    // "class" often appears alongside "type" and "struct".
    triggers: ["class", "classes", "struct", "structs"],
    aliases: ["class", "struct", "type"],
  },
];

const normalizeIdentifierCandidate = (value: string) =>
  value
    .replace(/^[`'"(<[{]+|[`'")>\]},.:;!?]+$/g, "")
    .trim();

const normalizeCodeTerm = (value: string) => {
  const normalized = normalizeIdentifierCandidate(value).toLowerCase();
  return TERM_CORRECTIONS.get(normalized) || normalized;
};

export const looksLikeCodeQuestion = (message: string) =>
  CODE_PROMPT_PATTERNS.some((pattern) => pattern.test(String(message || "")));

export const looksLikeSymbolPattern = (value: string) =>
  /^[A-Za-z_][A-Za-z0-9_.$-]{1,120}$/.test(String(value || "").trim()) &&
  !/\s/.test(String(value || ""));

export const extractCodeQueries = (message: string) => {
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

  const identifierMatches: string[] =
    trimmed.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [];
  identifierMatches.forEach((match) => {
    const normalized = normalizeCodeTerm(match);
    if (STOP_WORDS.has(normalized)) {
      return;
    }
    queries.add(match);
    if (normalized !== match.toLowerCase()) {
      queries.add(normalized);
    }
  });

  return [...queries].slice(0, 6);
};

export const toSearchTerms = (queries: string[]) => {
  const terms = new Set<string>();
  queries.forEach((query) => {
    const normalized = normalizeCodeTerm(query);
    if (!normalized || STOP_WORDS.has(normalized)) {
      return;
    }
    terms.add(normalized);
    if (normalized.endsWith("ies") && normalized.length > 4) {
      terms.add(`${normalized.slice(0, -3)}y`);
    } else if (normalized.endsWith("s") && normalized.length > 3) {
      terms.add(normalized.slice(0, -1));
    }
  });
  return [...terms];
};

const classifyCodeQuestionType = (message: string): CodeQuestionType => {
  const text = String(message || "").toLowerCase();
  if (!looksLikeCodeQuestion(text)) return "unknown";
  if (/\b(how many|count|number of|total)\b/.test(text)) return "count";
  if (/\b(list|show|what all|what are|which)\b/.test(text)) return "inventory";
  if (/\b(where|location|defined|definition|file|path)\b/.test(text)) {
    return "location";
  }
  if (/\b(implement|change|patch|fix|refactor|add|update)\b/.test(text)) {
    return "implementation";
  }
  if (/\b(source code|whole file|entire file|all files|overview)\b/.test(text)) {
    return "file-wide";
  }
  return "explanation";
};

const addWeightedCandidate = (
  candidates: Map<string, WeightedCodeSearchCandidate>,
  query: string,
  weight: number,
  reason: WeightedCodeSearchCandidate["reason"],
) => {
  const normalized = normalizeIdentifierCandidate(query);
  if (!normalized) return;
  const existing = candidates.get(normalized);
  if (!existing || existing.weight < weight) {
    candidates.set(normalized, { query: normalized, weight, reason });
  }
};

export const buildCodeSearchCandidates = (message: string) => {
  const trimmed = String(message || "").trim();
  const symbolLike = looksLikeSymbolPattern(trimmed);
  const queries = extractCodeQueries(trimmed);
  const searchTerms = toSearchTerms(queries);
  const weighted = new Map<string, WeightedCodeSearchCandidate>();
  const questionType = classifyCodeQuestionType(trimmed);

  if (symbolLike) {
    addWeightedCandidate(weighted, trimmed, 1000, "explicit");
  }
  queries.forEach((query) => addWeightedCandidate(weighted, query, 900, "explicit"));
  searchTerms.forEach((term) => addWeightedCandidate(weighted, term, 850, "normalized"));

  const aliasTriggers = new Set(searchTerms.map(normalizeCodeTerm));
  for (const group of CODE_ALIAS_GROUPS) {
    if (!group.triggers.some((trigger) => aliasTriggers.has(trigger))) {
      continue;
    }
    group.aliases.forEach((alias) =>
      addWeightedCandidate(
        weighted,
        alias,
        alias.includes(" ") ? 500 : 700,
        alias.includes(" ") ? "text-fallback" : "alias",
      ),
    );
  }

  const weightedCandidates = [...weighted.values()]
    .sort((left, right) => {
      const delta = right.weight - left.weight;
      return delta !== 0 ? delta : left.query.localeCompare(right.query);
    })
    .slice(0, 20);
  const explicitCandidateTerms = new Set(
    [...queries, ...searchTerms].map((query) => normalizeCodeTerm(query)),
  );

  return {
    isCodeQuestion: looksLikeCodeQuestion(trimmed),
    queries,
    searchTerms,
    candidates: weightedCandidates
      .filter((candidate) => {
        if (candidate.query.includes(" ")) return false;
        const normalized = normalizeCodeTerm(candidate.query);
        return candidate.query.length >= 3 || explicitCandidateTerms.has(normalized);
      })
      .map((candidate) => candidate.query)
      .slice(0, 12),
    textSearchTerms: weightedCandidates.map((candidate) => candidate.query).slice(0, 20),
    weightedCandidates,
    questionType,
  };
};
