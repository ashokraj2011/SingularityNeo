// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listLocalCheckoutAllSymbols, searchLocalCheckoutSymbols } from "../localCodeIndex";

const temporaryRoots: string[] = [];

const createRuleEngineCheckout = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "singularity-local-index-"));
  temporaryRoots.push(root);
  const rulesDir = path.join(root, "src/main/java/org/example/rules");
  const mainDir = path.join(root, "src/main/java/org/example");
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.mkdirSync(mainDir, { recursive: true });
  fs.writeFileSync(
    path.join(mainDir, "Main.java"),
    [
      "package org.example;",
      "",
      "public class Main {",
      "    public static void main(String[] args) {",
      "        System.out.println(\"hello\");",
      "    }",
      "}",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(rulesDir, "Operator.java"),
    [
      "package org.example.rules;",
      "",
      "public enum Operator {",
      "    // Comparison",
      "    eq, ne, lt, lte, gt, gte,",
      "    // Collection/String",
      "    contains, in,",
      "    // Pattern",
      "    regex,",
      "    // Range",
      "    between,",
      "    // Existence",
      "    exists, not_exists, isNull, isNotNull",
      "}",
    ].join("\n"),
  );
  return root;
};

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("local checkout code index", () => {
  it("assigns unique symbol IDs to Java enum parents and constants", async () => {
    const checkoutPath = createRuleEngineCheckout();
    const result = await listLocalCheckoutAllSymbols({
      checkoutPath,
      capabilityId: "CAP-RULES",
      repositoryId: "REPO-RULES",
      limit: 100,
    });

    const operatorSymbols = result.symbols.filter(symbol =>
      symbol.filePath.endsWith("Operator.java"),
    );
    const symbolIds = operatorSymbols.map(symbol => symbol.symbolId);

    expect(operatorSymbols.map(symbol => symbol.qualifiedSymbolName)).toEqual(
      expect.arrayContaining([
        "Operator",
        "Operator.eq",
        "Operator.ne",
        "Operator.isNotNull",
      ]),
    );
    expect(new Set(symbolIds).size).toBe(symbolIds.length);
  });

  it("returns the Operator enum and constants for operator searches", async () => {
    const checkoutPath = createRuleEngineCheckout();
    const result = await searchLocalCheckoutSymbols({
      checkoutPath,
      capabilityId: "CAP-RULES",
      repositoryId: "REPO-RULES",
      query: "operator",
      limit: 20,
    });

    expect(result.symbols.map(symbol => symbol.qualifiedSymbolName)).toEqual(
      expect.arrayContaining(["Operator", "Operator.eq", "Operator.isNotNull"]),
    );
    expect(result.symbols.map(symbol => symbol.qualifiedSymbolName)).not.toContain("Main");
  });
});
