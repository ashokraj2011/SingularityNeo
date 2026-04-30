// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  searchCodeSymbolsMock,
  searchLocalCheckoutSymbolsMock,
  getLocalCheckoutAstFreshnessMock,
  listLocalCheckoutAllSymbolsMock,
} = vi.hoisted(() => ({
  searchCodeSymbolsMock: vi.fn(),
  searchLocalCheckoutSymbolsMock: vi.fn(),
  getLocalCheckoutAstFreshnessMock: vi.fn(),
  listLocalCheckoutAllSymbolsMock: vi.fn(),
}));

vi.mock("../codeIndex/query", () => ({
  searchCodeSymbols: searchCodeSymbolsMock,
}));

vi.mock("../localCodeIndex", () => ({
  searchLocalCheckoutSymbols: searchLocalCheckoutSymbolsMock,
  getLocalCheckoutAstFreshness: getLocalCheckoutAstFreshnessMock,
  listLocalCheckoutAllSymbols: listLocalCheckoutAllSymbolsMock,
}));

import { buildAstGroundingSummary } from "../astGrounding";

describe("buildAstGroundingSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers local checkout AST results when a work-item checkout is available", async () => {
    searchLocalCheckoutSymbolsMock.mockResolvedValue({
      source: "local-checkout",
      builtAt: "2026-04-24T10:00:00.000Z",
      symbols: [
        {
          symbolId: "SYM-1",
          qualifiedSymbolName: "AuthService.login",
          kind: "METHOD",
          filePath: "src/AuthService.ts",
          sliceStartLine: 12,
          sliceEndLine: 32,
          signature: "login(user: User): Session",
        },
      ],
    });
    getLocalCheckoutAstFreshnessMock.mockReturnValue("2026-04-24T10:00:00.000Z");

    const summary = await buildAstGroundingSummary({
      capability: { id: "CAP-1", name: "Auth Capability" },
      workItem: { id: "WI-1", title: "Fix login" },
      message: "How does `AuthService.login` work?",
      checkoutPath: "/tmp/auth-capability/WI-1",
      repositoryId: "REPO-1",
      branchName: "WI-1",
    });

    expect(summary.astGroundingMode).toBe("ast-grounded-local-clone");
    expect(summary.codeIndexSource).toBe("local-checkout");
    expect(summary.prompt).toContain("AuthService.login");
    expect(summary.prompt).toContain("branch WI-1");
    expect(searchCodeSymbolsMock).not.toHaveBeenCalled();
  });

  it("falls back to the capability code index when local checkout AST is unavailable", async () => {
    searchLocalCheckoutSymbolsMock.mockResolvedValue({
      source: "local-checkout",
      builtAt: undefined,
      symbols: [],
    });
    listLocalCheckoutAllSymbolsMock.mockResolvedValue({
      symbols: [],
      builtAt: undefined,
    });
    searchCodeSymbolsMock.mockResolvedValue([
      {
        symbolId: "SYM-2",
        qualifiedSymbolName: "BillingService.charge",
        kind: "METHOD",
        filePath: "src/BillingService.ts",
        sliceStartLine: 40,
        sliceEndLine: 71,
        signature: "charge(invoice: Invoice): ChargeResult",
      },
    ]);

    const summary = await buildAstGroundingSummary({
      capability: { id: "CAP-2", name: "Billing Capability" },
      message: "What calls BillingService.charge?",
    });

    expect(summary.astGroundingMode).toBe("ast-grounded-remote-index");
    expect(summary.codeIndexSource).toBe("capability-index");
    expect(summary.prompt).toContain("BillingService.charge");
  });

  it("uses normalized candidate queries for plural inventory questions", async () => {
    searchLocalCheckoutSymbolsMock.mockImplementation(
      async ({ query }: { query: string }) => ({
        source: "local-checkout",
        builtAt: "2026-04-30T08:00:00.000Z",
        symbols:
          query === "operator"
            ? [
                {
                  symbolId: "SYM-OP-ENUM",
                  symbolName: "Operator",
                  qualifiedSymbolName: "org.example.rules.Operator",
                  kind: "ENUM",
                  filePath: "src/main/java/org/example/rules/Operator.java",
                  sliceStartLine: 1,
                  sliceEndLine: 22,
                },
              ]
            : [],
      }),
    );
    getLocalCheckoutAstFreshnessMock.mockReturnValue("2026-04-30T08:00:00.000Z");

    const summary = await buildAstGroundingSummary({
      capability: { id: "CAP-OP", name: "Rule Engine" },
      message: "What are the operators in the rule engine?",
      checkoutPath: "/tmp/rule-engine",
      repositoryId: "REPO-OP",
    });

    expect(summary.astGroundingMode).toBe("ast-grounded-local-clone");
    expect(summary.prompt).toContain("Operator");
    expect(
      searchLocalCheckoutSymbolsMock.mock.calls.map(
        ([input]: [{ query: string }]) => input.query,
      ),
    ).toEqual(expect.arrayContaining(["operators", "operator"]));
    expect(searchCodeSymbolsMock).not.toHaveBeenCalled();
  });

  it("uses local path-based fallback for broad code questions like operator counts", async () => {
    searchLocalCheckoutSymbolsMock.mockResolvedValue({
      source: "local-checkout",
      builtAt: "2026-04-25T08:00:00.000Z",
      symbols: [],
    });
    listLocalCheckoutAllSymbolsMock.mockResolvedValue({
      builtAt: "2026-04-25T08:00:00.000Z",
      symbols: [
        {
          symbolId: "SYM-3",
          symbolName: "EqualsOperator",
          qualifiedSymbolName: "operators.EqualsOperator",
          kind: "CLASS",
          filePath: "src/main/java/org/example/rules/operators/EqualsOperator.java",
          sliceStartLine: 1,
          sliceEndLine: 40,
        },
        {
          symbolId: "SYM-4",
          symbolName: "AndOperator",
          qualifiedSymbolName: "operators.AndOperator",
          kind: "CLASS",
          filePath: "src/main/java/org/example/rules/operators/AndOperator.java",
          sliceStartLine: 1,
          sliceEndLine: 38,
        },
      ],
    });

    const summary = await buildAstGroundingSummary({
      capability: { id: "CAP-3", name: "Rule Engine" },
      message: "How many operators are there in the rule engine?",
      checkoutPath: "/tmp/rule-engine",
      repositoryId: "REPO-3",
    });

    expect(summary.astGroundingMode).toBe("ast-grounded-local-clone");
    expect(summary.codeIndexSource).toBe("local-checkout");
    expect(summary.prompt).toContain("Indexed top-level matches: 2");
    expect(summary.prompt).toContain(
      "/tmp/rule-engine/src/main/java/org/example/rules/operators/EqualsOperator.java",
    );
    expect(searchCodeSymbolsMock).not.toHaveBeenCalled();
  });
});
