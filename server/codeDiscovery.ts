const CODE_PROMPT_PATTERNS = [
  /\b(code|function|method|class|symbol|ast|call(s|er|ee)?|implement|change|patch|diff|bug|fix|refactor|file|module|api|query|branch|repo|repository|operator|operators|interface|enum|package|import|extends|implements)\b/i,
  /\bhow many\b.*\b(classes?|operators?|interfaces?|enums?|methods?|files?)\b/i,
  /[`'"]?[A-Z][A-Za-z0-9_]+[`'"]?/,
  /\b[a-z][A-Za-z0-9_]*\.[a-z][A-Za-z0-9_]*\b/,
  /\b[a-z][A-Za-z0-9_]*(?:Service|Controller|Repository|Manager|Client|Handler|Operator)\b/,
  /\bsrc\/|\.ts\b|\.tsx\b|\.js\b|\.java\b|\.py\b/i,
];

const STOP_WORDS = new Set([
  "how",
  "what",
  "when",
  "where",
  "which",
  "should",
  "would",
  "could",
  "there",
  "their",
  "about",
  "have",
  "with",
  "from",
  "into",
  "after",
  "before",
  "needs",
  "need",
  "this",
  "that",
  "these",
  "those",
  "many",
  "much",
  "rule",
  "engine",
  "count",
  "total",
  "there",
  "are",
  "is",
  "the",
  "in",
]);

const normalizeIdentifierCandidate = (value: string) =>
  value
    .replace(/^[`'"(<[{]+|[`'")>\]},.:;!?]+$/g, "")
    .trim();

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
    if (STOP_WORDS.has(match.toLowerCase())) {
      return;
    }
    queries.add(match);
  });

  return [...queries].slice(0, 6);
};

export const toSearchTerms = (queries: string[]) => {
  const terms = new Set<string>();
  queries.forEach((query) => {
    const normalized = normalizeIdentifierCandidate(query).toLowerCase();
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

export const buildCodeSearchCandidates = (message: string) => {
  const trimmed = String(message || "").trim();
  const symbolLike = looksLikeSymbolPattern(trimmed);
  const queries = extractCodeQueries(trimmed);
  const searchTerms = toSearchTerms(queries);
  const candidates = new Set<string>();

  if (symbolLike) {
    candidates.add(trimmed);
  }
  queries.forEach((query) => candidates.add(query));
  searchTerms.forEach((term) => candidates.add(term));

  return {
    isCodeQuestion: looksLikeCodeQuestion(trimmed),
    queries,
    searchTerms,
    candidates: [...candidates].filter(Boolean).slice(0, 10),
  };
};
