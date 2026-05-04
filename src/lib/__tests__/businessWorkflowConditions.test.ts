import { describe, expect, it } from "vitest";
import { evaluateEdgeCondition } from "../businessWorkflowConditions";

describe("evaluateEdgeCondition", () => {
  it("null condition is always true (default edge)", () => {
    expect(evaluateEdgeCondition(null, {})).toBe(true);
    expect(evaluateEdgeCondition(undefined, { a: 1 })).toBe(true);
  });

  it("empty group is vacuously true", () => {
    expect(evaluateEdgeCondition({ logic: "AND", clauses: [] }, {})).toBe(true);
    expect(evaluateEdgeCondition({ logic: "OR", clauses: [] }, {})).toBe(true);
  });

  describe("eq / neq", () => {
    it("string equality", () => {
      expect(
        evaluateEdgeCondition(
          { logic: "AND", clauses: [{ left: "tier", op: "eq", right: "gold" }] },
          { tier: "gold" },
        ),
      ).toBe(true);
      expect(
        evaluateEdgeCondition(
          { logic: "AND", clauses: [{ left: "tier", op: "neq", right: "gold" }] },
          { tier: "gold" },
        ),
      ).toBe(false);
    });

    it("numeric equality (loose, '42' == 42)", () => {
      expect(
        evaluateEdgeCondition(
          { logic: "AND", clauses: [{ left: "score", op: "eq", right: 42 }] },
          { score: "42" },
        ),
      ).toBe(true);
    });
  });

  describe("gt / gte / lt / lte", () => {
    it("numeric comparison", () => {
      expect(
        evaluateEdgeCondition(
          { logic: "AND", clauses: [{ left: "score", op: "gte", right: 75 }] },
          { score: 80 },
        ),
      ).toBe(true);
      expect(
        evaluateEdgeCondition(
          { logic: "AND", clauses: [{ left: "score", op: "lt", right: 75 }] },
          { score: 80 },
        ),
      ).toBe(false);
    });

    it("string comparison falls back to lexicographic", () => {
      expect(
        evaluateEdgeCondition(
          {
            logic: "AND",
            clauses: [{ left: "stage", op: "gt", right: "A" }],
          },
          { stage: "B" },
        ),
      ).toBe(true);
    });
  });

  describe("in", () => {
    it("comma-separated whitelist", () => {
      const cond = {
        logic: "AND" as const,
        clauses: [{ left: "region", op: "in" as const, right: "us, eu, apac" }],
      };
      expect(evaluateEdgeCondition(cond, { region: "eu" })).toBe(true);
      expect(evaluateEdgeCondition(cond, { region: "latam" })).toBe(false);
    });
  });

  describe("contains", () => {
    it("matches substring on string left", () => {
      expect(
        evaluateEdgeCondition(
          {
            logic: "AND",
            clauses: [{ left: "title", op: "contains", right: "Urgent" }],
          },
          { title: "Urgent: review" },
        ),
      ).toBe(true);
    });

    it("matches array containment on array left", () => {
      expect(
        evaluateEdgeCondition(
          {
            logic: "AND",
            clauses: [{ left: "tags", op: "contains", right: "compliance" }],
          },
          { tags: ["sla", "compliance", "audit"] },
        ),
      ).toBe(true);
    });
  });

  describe("exists", () => {
    it("true when path resolves to a non-null value", () => {
      expect(
        evaluateEdgeCondition(
          {
            logic: "AND",
            clauses: [{ left: "approval.decidedAt", op: "exists" }],
          },
          { approval: { decidedAt: "2026-05-04" } },
        ),
      ).toBe(true);
    });
    it("false when path missing or null", () => {
      expect(
        evaluateEdgeCondition(
          {
            logic: "AND",
            clauses: [{ left: "approval.decidedAt", op: "exists" }],
          },
          { approval: { decidedAt: null } },
        ),
      ).toBe(false);
    });
  });

  describe("nesting + AND/OR", () => {
    it("AND requires all", () => {
      expect(
        evaluateEdgeCondition(
          {
            logic: "AND",
            clauses: [
              { left: "tier", op: "eq", right: "gold" },
              { left: "score", op: "gte", right: 80 },
            ],
          },
          { tier: "gold", score: 85 },
        ),
      ).toBe(true);
      expect(
        evaluateEdgeCondition(
          {
            logic: "AND",
            clauses: [
              { left: "tier", op: "eq", right: "gold" },
              { left: "score", op: "gte", right: 80 },
            ],
          },
          { tier: "gold", score: 50 },
        ),
      ).toBe(false);
    });

    it("OR requires any", () => {
      expect(
        evaluateEdgeCondition(
          {
            logic: "OR",
            clauses: [
              { left: "tier", op: "eq", right: "gold" },
              { left: "score", op: "gte", right: 90 },
            ],
          },
          { tier: "silver", score: 95 },
        ),
      ).toBe(true);
    });

    it("nested AND inside OR", () => {
      const cond = {
        logic: "OR" as const,
        clauses: [
          { left: "vip", op: "eq" as const, right: true },
          {
            logic: "AND" as const,
            clauses: [
              { left: "tier", op: "eq" as const, right: "gold" },
              { left: "score", op: "gte" as const, right: 80 },
            ],
          },
        ],
      };
      expect(evaluateEdgeCondition(cond, { vip: false, tier: "gold", score: 90 })).toBe(true);
      expect(evaluateEdgeCondition(cond, { vip: true })).toBe(true);
      expect(evaluateEdgeCondition(cond, { vip: false, tier: "gold", score: 50 })).toBe(false);
    });
  });

  describe("dotted paths", () => {
    it("resolves nested values", () => {
      expect(
        evaluateEdgeCondition(
          {
            logic: "AND",
            clauses: [{ left: "approval.status", op: "eq", right: "APPROVED" }],
          },
          { approval: { status: "APPROVED" } },
        ),
      ).toBe(true);
    });

    it("missing path is undefined → eq false, exists false", () => {
      expect(
        evaluateEdgeCondition(
          {
            logic: "AND",
            clauses: [{ left: "missing.path", op: "eq", right: "x" }],
          },
          {},
        ),
      ).toBe(false);
    });
  });
});
