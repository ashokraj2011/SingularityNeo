// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildCodeSearchCandidates,
  looksLikeCodeQuestion,
  looksLikeSymbolPattern,
} from "../codeDiscovery";

describe("code discovery helpers", () => {
  it("treats natural-language operator questions as code discovery prompts", () => {
    const result = buildCodeSearchCandidates(
      "How many operators are there in this rule engine?",
    );

    expect(result.isCodeQuestion).toBe(true);
    expect(result.candidates).toContain("operators");
    expect(result.candidates).toContain("operator");
    expect(result.questionType).toBe("count");
    expect(result.textSearchTerms).toEqual(
      expect.arrayContaining(["enum Operator", "field op", "switch op"]),
    );
  });

  it("normalizes common operator typos and aliases", () => {
    const typo = buildCodeSearchCandidates("operaotrs in rule engine");
    const aliases = buildCodeSearchCandidates("condition comparators");

    expect(typo.candidates).toEqual(expect.arrayContaining(["operators", "operator"]));
    expect(aliases.candidates).toEqual(
      expect.arrayContaining(["condition", "comparator", "operator", "evalCondition"]),
    );
    expect(aliases.textSearchTerms).toContain("switch op");
  });

  it("keeps symbol-shaped queries available as direct candidates", () => {
    const result = buildCodeSearchCandidates("RuleEngineService");

    expect(looksLikeCodeQuestion("RuleEngineService")).toBe(true);
    expect(looksLikeSymbolPattern("RuleEngineService")).toBe(true);
    expect(result.candidates[0]).toBe("RuleEngineService");
  });
});
