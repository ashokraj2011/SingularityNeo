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

const INVENTORY_ENTITY_PATTERN =
  /\b(classes?|functions?|interfaces?|enums?|methods?|files?|symbols?|handlers?|validators?|operators?|predicates?|comparators?|conditions?|services?|repositories?|controllers?)\b/;

const CODE_PROMPT_PATTERNS = [
  // Generic code-structure vocabulary — not tied to any specific codebase or domain.
  /\b(code|functions?|methods?|classes?|symbols?|ast|call(s|er|ee)?|implement(?:ed|ation|ing|s)?|change|patch|diff|bug|fix|refactor|files?|modules?|api|query|branch|repo(?:sitory)?|repositories|operators?|op|ops|predicates?|comparators?|conditions?|interfaces?|enums?|packages?|imports?|extends|implements|handlers?|validators?|services?|repositories?|controllers?|retry|validation|validator|auth|authentication|authorization|workflow|queue|state|logic)\b/i,
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

// Generic code-browsing instruction words and vague qualifiers that should not
// dominate AST/text retrieval. These are intentionally repo-agnostic.
const LOW_SIGNAL_CODE_TERMS = new Set([
  "browse",
  "search",
  "find",
  "inspect",
  "check",
  "look",
  "code",
  "existing",
  "current",
  "understand",
  "understanding",
  "implementation",
  "implementations",
  "design",
  "pattern",
  "patterns",
  "current",
  "tell",
  "details",
  "information",
  "work",
  "works",
  "working",
  "handled",
  "handling",
  "implemented",
  "implementation",
  "implementing",
  "show",
  "handle",
  "handles",
]);

// Generic structure words that help classify the question but are usually less
// informative than the domain concept being asked about.
const STRUCTURE_ONLY_CODE_TERMS = new Set([
  "class",
  "classes",
  "function",
  "functions",
  "method",
  "methods",
  "file",
  "files",
  "interface",
  "interfaces",
  "enum",
  "enums",
  "type",
  "types",
  "struct",
  "structs",
  "symbol",
  "symbols",
  "module",
  "modules",
  "package",
  "packages",
  "import",
  "imports",
  "handler",
  "handlers",
  "validator",
  "validators",
  "service",
  "services",
  "repository",
  "repositories",
  "controller",
  "controllers",
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
  ["operaotrs", "operators"],
  ["opertors", "operators"],
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

const CODE_HINT_TERMS = new Set([
  "api",
  "auth",
  "authentication",
  "authorization",
  "class",
  "classes",
  "comparator",
  "comparators",
  "condition",
  "conditions",
  "controller",
  "controllers",
  "enum",
  "enums",
  "file",
  "files",
  "function",
  "functions",
  "handler",
  "handlers",
  "interface",
  "interfaces",
  "logic",
  "method",
  "methods",
  "module",
  "modules",
  "operator",
  "operators",
  "package",
  "packages",
  "predicate",
  "predicates",
  "queue",
  "repository",
  "repositories",
  "retry",
  "service",
  "services",
  "state",
  "symbol",
  "symbols",
  "type",
  "types",
  "validation",
  "validator",
  "validators",
  "workflow",
]);

const normalizeIdentifierCandidate = (value: string) =>
  value
    .replace(/^[`'"(<[{]+|[`'")>\]},.:;!?]+$/g, "")
    .trim();

const normalizeCodeTerm = (value: string) => {
  const normalized = normalizeIdentifierCandidate(value).toLowerCase();
  return TERM_CORRECTIONS.get(normalized) || normalized;
};

const isLowSignalCodeTerm = (value: string) =>
  LOW_SIGNAL_CODE_TERMS.has(normalizeCodeTerm(value));

const isStructureOnlyCodeTerm = (value: string) =>
  STRUCTURE_ONLY_CODE_TERMS.has(normalizeCodeTerm(value));

const singularizeSearchTerm = (value: string) => {
  const normalized = normalizeCodeTerm(value);
  if (!normalized) {
    return normalized;
  }
  if (normalized.endsWith("ies") && normalized.length > 4) {
    return `${normalized.slice(0, -3)}y`;
  }
  if (/(sses|shes|ches|xes|zes)$/.test(normalized) && normalized.length > 4) {
    return normalized.slice(0, -2);
  }
  if (normalized.endsWith("s") && normalized.length > 3) {
    return normalized.slice(0, -1);
  }
  return normalized;
};

export const looksLikeCodeQuestion = (message: string) =>
  CODE_PROMPT_PATTERNS.some((pattern) => pattern.test(String(message || ""))) ||
  (String(message || "").match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [])
    .map((token) => normalizeCodeTerm(token))
    .some((token) => CODE_HINT_TERMS.has(token));

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
    if (STOP_WORDS.has(normalized) || isLowSignalCodeTerm(normalized)) {
      return;
    }
    const keepOriginal =
      normalized === match.toLowerCase() ||
      (looksLikeSymbolPattern(match) && /[A-Z_.$-]/.test(match));
    if (keepOriginal) {
      queries.add(match);
    }
    if (normalized !== match.toLowerCase() || !keepOriginal) {
      queries.add(normalized);
    }
  });

  return [...queries].slice(0, 6);
};

const extractCodePhrases = (message: string) => {
  const tokens = [...String(message || "").matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)]
    .map((match, index) => ({
      token: normalizeCodeTerm(match[0] || ""),
      index,
    }))
    .filter(
      (entry) =>
        entry.token &&
        !STOP_WORDS.has(entry.token) &&
        !isLowSignalCodeTerm(entry.token),
    );
  const phrases = new Set<string>();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index];
    const right = tokens[index + 1];
    if (!left || !right) {
      continue;
    }
    if (right.index - left.index !== 1) {
      continue;
    }
    if (
      isStructureOnlyCodeTerm(left.token) ||
      isStructureOnlyCodeTerm(right.token)
    ) {
      continue;
    }
    phrases.add(`${left.token} ${right.token}`);
  }
  return [...phrases].slice(0, 6);
};

export const toSearchTerms = (queries: string[]) => {
  const terms = new Set<string>();
  queries.forEach((query) => {
    const normalized = normalizeCodeTerm(query);
    if (!normalized || STOP_WORDS.has(normalized) || isLowSignalCodeTerm(normalized)) {
      return;
    }
    terms.add(normalized);
    const singular = singularizeSearchTerm(normalized);
    if (singular && singular !== normalized) {
      terms.add(singular);
    }
  });
  return [...terms];
};

const classifyCodeQuestionType = (message: string): CodeQuestionType => {
  const text = String(message || "").toLowerCase();
  if (!looksLikeCodeQuestion(text)) return "unknown";
  if (/\b(how many|count|number of|total)\b/.test(text)) return "count";
  if (
    /\b(list|show|what all|what are|which)\b/.test(text) ||
    ((/\b(existing|available|supported|present|defined|implemented|browse|inspect|check|look)\b/.test(
      text,
    ) ||
      /\bdo we have\b/.test(text)) &&
      INVENTORY_ENTITY_PATTERN.test(text))
  ) {
    return "inventory";
  }
  if (/\b(where|location|defined|definition|file|path)\b/.test(text)) {
    return "location";
  }
  if (/\b(implement|change|patch|fix|refactor|add|update)\b/.test(text)) {
    return "implementation";
  }
  if (/\bhow\b.*\b(work|works|working|implemented|implementation|handled|handling|flow|flows)\b/.test(text)) {
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
  const normalizedMessage = trimmed.toLowerCase();
  const candidatePositions = new Map<string, number>();
  for (const match of String(message || "").matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const rawToken = normalizeIdentifierCandidate(match[0] || "");
    const normalizedToken = normalizeCodeTerm(rawToken);
    const position = match.index ?? Number.MAX_SAFE_INTEGER;
    if (rawToken && !candidatePositions.has(rawToken)) {
      candidatePositions.set(rawToken, position);
    }
    if (normalizedToken && !candidatePositions.has(normalizedToken)) {
      candidatePositions.set(normalizedToken, position);
    }
  }
  const symbolLike = looksLikeSymbolPattern(trimmed);
  const queries = extractCodeQueries(trimmed);
  const searchTerms = toSearchTerms(queries);
  const phraseQueries = extractCodePhrases(trimmed);
  const weighted = new Map<string, WeightedCodeSearchCandidate>();
  const questionType = classifyCodeQuestionType(trimmed);
  const domainBearingTerms = searchTerms.filter(
    (term) => !isStructureOnlyCodeTerm(term),
  );

  const explicitWeightFor = (query: string) => {
    const normalized = normalizeCodeTerm(query);
    if (isLowSignalCodeTerm(normalized)) {
      return 0;
    }
    if (isStructureOnlyCodeTerm(normalized)) {
      return domainBearingTerms.length > 0 ? 650 : 860;
    }
    return 950;
  };

  const normalizedWeightFor = (term: string) => {
    const normalized = normalizeCodeTerm(term);
    if (isLowSignalCodeTerm(normalized)) {
      return 0;
    }
    if (isStructureOnlyCodeTerm(normalized)) {
      return domainBearingTerms.length > 0 ? 600 : 820;
    }
    return 900;
  };

  if (symbolLike) {
    addWeightedCandidate(weighted, trimmed, 1000, "explicit");
  }
  queries.forEach((query) => {
    const weight = explicitWeightFor(query);
    if (weight > 0) {
      addWeightedCandidate(weighted, query, weight, "explicit");
    }
  });
  searchTerms.forEach((term) => {
    const weight = normalizedWeightFor(term);
    if (weight > 0) {
      addWeightedCandidate(weighted, term, weight, "normalized");
    }
  });
  phraseQueries.forEach((phrase) =>
    addWeightedCandidate(weighted, phrase, 720, "text-fallback"),
  );

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
      if (delta !== 0) {
        return delta;
      }
      const leftIndex =
        candidatePositions.get(left.query) ??
        candidatePositions.get(normalizeCodeTerm(left.query)) ??
        normalizedMessage.indexOf(normalizeCodeTerm(left.query));
      const rightIndex =
        candidatePositions.get(right.query) ??
        candidatePositions.get(normalizeCodeTerm(right.query)) ??
        normalizedMessage.indexOf(normalizeCodeTerm(right.query));
      if (leftIndex !== rightIndex) {
        if (leftIndex === -1) return 1;
        if (rightIndex === -1) return -1;
        return leftIndex - rightIndex;
      }
      return left.query.localeCompare(right.query);
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
    textSearchTerms: weightedCandidates
      .map((candidate) => candidate.query)
      .filter(Boolean)
      .slice(0, 20),
    weightedCandidates,
    questionType,
  };
};
