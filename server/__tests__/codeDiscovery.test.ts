// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildCodeSearchCandidates,
  looksLikeCodeQuestion,
  looksLikeSymbolPattern,
} from "../codeDiscovery";

describe("code discovery helpers", () => {
  it("treats natural-language inventory questions as code discovery prompts", () => {
    const result = buildCodeSearchCandidates(
      "How many operators are there in this rule engine?",
    );

    expect(result.isCodeQuestion).toBe(true);
    expect(result.questionType).toBe("count");
    expect(result.candidates.slice(0, 4)).toEqual([
      "operators",
      "rule",
      "engine",
      "operator",
    ]);
    expect(result.textSearchTerms).toEqual(
      expect.arrayContaining(["operators", "rule", "engine", "rule engine"]),
    );
  });

  it("keeps broad imperative browse prompts on the inventory path", () => {
    const result = buildCodeSearchCandidates(
      "Browse code for existing operator classes or functions to understand current implementation and design patterns for operators in the rule engine.",
    );

    expect(result.isCodeQuestion).toBe(true);
    expect(result.questionType).toBe("inventory");
    expect(result.candidates.slice(0, 4)).toEqual([
      "operator",
      "operators",
      "rule",
      "engine",
    ]);
    expect(result.candidates).not.toContain("browse");
    expect(result.textSearchTerms).toEqual(
      expect.arrayContaining(["operator", "operators", "rule engine"]),
    );
    expect(result.textSearchTerms).not.toContain("operators rule");
  });

  it("normalizes common typos and preserves the dominant concept", () => {
    const typo = buildCodeSearchCandidates("operaotrs in rule engine");

    expect(typo.isCodeQuestion).toBe(true);
    expect(typo.candidates[0]).toBe("operators");
    expect(typo.candidates).toEqual(
      expect.arrayContaining(["operators", "operator", "rule", "engine"]),
    );
    expect(typo.textSearchTerms).toContain("rule engine");
  });

  it("recognizes broad implementation questions as code questions", () => {
    const retry = buildCodeSearchCandidates("How does retry logic work?");
    const auth = buildCodeSearchCandidates("which classes handle auth");
    const validation = buildCodeSearchCandidates(
      "search and tell me how validation is implemented",
    );

    expect(looksLikeCodeQuestion("How does retry logic work?")).toBe(true);
    expect(retry.questionType).toBe("implementation");
    expect(retry.candidates.slice(0, 2)).toEqual(["retry", "logic"]);
    expect(retry.candidates).not.toContain("work");

    expect(looksLikeCodeQuestion("which classes handle auth")).toBe(true);
    expect(auth.questionType).toBe("inventory");
    expect(auth.candidates[0]).toBe("auth");
    expect(auth.candidates).toEqual(
      expect.arrayContaining(["class", "classes"]),
    );

    expect(
      looksLikeCodeQuestion("search and tell me how validation is implemented"),
    ).toBe(true);
    expect(validation.questionType).toBe("implementation");
    expect(validation.candidates[0]).toBe("validation");
    expect(validation.candidates).not.toContain("search");
  });

  it("keeps symbol-shaped queries available as direct candidates", () => {
    const result = buildCodeSearchCandidates("RuleEngineService");

    expect(looksLikeCodeQuestion("RuleEngineService")).toBe(true);
    expect(looksLikeSymbolPattern("RuleEngineService")).toBe(true);
    expect(result.candidates[0]).toBe("RuleEngineService");
  });
});
