/**
 * Edge condition evaluator for the Business Workflow Designer.
 *
 * Supports:
 *   - clauses: { left, op, right } where left is a dotted context path
 *   - groups: { logic: 'AND'|'OR', clauses: [Clause | Group, ...] }
 *   - operators: eq, neq, gt, gte, lt, lte, in, contains, exists
 *
 * Deliberately scoped to a small, testable subset. NOT supported:
 *   - regex match
 *   - querying inside arrays-of-objects
 *   - dotted-path globs (`results.*.score`)
 *   - left being a literal — `left` is always a context path
 *   - functions / arithmetic in clauses
 *
 * Paths use dot syntax. Bracket notation isn't supported; use plain
 * keys. Numeric strings are parsed as numbers when both sides look
 * numeric.
 */

import type {
  ConditionClause,
  ConditionGroup,
  EdgeCondition,
} from "../contracts/businessWorkflow";

/** Resolve a dotted path against a context object. */
const resolvePath = (
  context: Record<string, unknown>,
  path: string,
): unknown => {
  if (!path) return undefined;
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cursor: unknown = context;
  for (const part of parts) {
    if (cursor == null) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
};

const looksNumeric = (value: unknown): boolean =>
  typeof value === "number" ||
  (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)));

const coerceNumeric = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const compareLoose = (a: unknown, b: unknown): number => {
  // Numeric compare when both look numeric (handles `"42" > 7`).
  if (looksNumeric(a) && looksNumeric(b)) {
    const an = coerceNumeric(a)!;
    const bn = coerceNumeric(b)!;
    if (an === bn) return 0;
    return an < bn ? -1 : 1;
  }
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
};

const equalsLoose = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (looksNumeric(a) && looksNumeric(b)) {
    return coerceNumeric(a) === coerceNumeric(b);
  }
  return String(a) === String(b);
};

const evaluateClause = (
  clause: ConditionClause,
  context: Record<string, unknown>,
): boolean => {
  const leftValue = resolvePath(context, clause.left);
  const right = clause.right;

  switch (clause.op) {
    case "exists":
      return leftValue !== undefined && leftValue !== null;
    case "eq":
      return equalsLoose(leftValue, right);
    case "neq":
      return !equalsLoose(leftValue, right);
    case "gt":
      return leftValue !== undefined && compareLoose(leftValue, right) > 0;
    case "gte":
      return leftValue !== undefined && compareLoose(leftValue, right) >= 0;
    case "lt":
      return leftValue !== undefined && compareLoose(leftValue, right) < 0;
    case "lte":
      return leftValue !== undefined && compareLoose(leftValue, right) <= 0;
    case "in": {
      // Right is comma-separated list. Match any.
      const tokens =
        typeof right === "string"
          ? right.split(",").map((s) => s.trim()).filter(Boolean)
          : right == null
            ? []
            : [String(right)];
      return tokens.some((token) => equalsLoose(leftValue, token));
    }
    case "contains": {
      // String / array containment.
      if (Array.isArray(leftValue)) {
        return leftValue.some((item) => equalsLoose(item, right));
      }
      if (typeof leftValue === "string") {
        return leftValue.includes(String(right ?? ""));
      }
      return false;
    }
    default:
      // Unknown operator → conservatively false.
      return false;
  }
};

const isGroup = (
  node: ConditionClause | ConditionGroup,
): node is ConditionGroup =>
  typeof (node as ConditionGroup).logic === "string" &&
  Array.isArray((node as ConditionGroup).clauses);

const evaluateGroup = (
  group: ConditionGroup,
  context: Record<string, unknown>,
): boolean => {
  if (group.clauses.length === 0) return true; // empty → vacuously true
  const evaluator = (child: ConditionClause | ConditionGroup): boolean =>
    isGroup(child)
      ? evaluateGroup(child, context)
      : evaluateClause(child, context);

  return group.logic === "OR"
    ? group.clauses.some(evaluator)
    : group.clauses.every(evaluator);
};

/**
 * Evaluate an edge's `condition` against an instance context. A `null`
 * condition (the default for non-conditional edges) is always true.
 */
export const evaluateEdgeCondition = (
  condition: EdgeCondition | undefined,
  context: Record<string, unknown>,
): boolean => {
  if (!condition) return true;
  return evaluateGroup(condition, context || {});
};
