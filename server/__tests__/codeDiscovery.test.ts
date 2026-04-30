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
  });

  it("keeps symbol-shaped queries available as direct candidates", () => {
    const result = buildCodeSearchCandidates("RuleEngineService");

    expect(looksLikeCodeQuestion("RuleEngineService")).toBe(true);
    expect(looksLikeSymbolPattern("RuleEngineService")).toBe(true);
    expect(result.candidates[0]).toBe("RuleEngineService");
  });
});
