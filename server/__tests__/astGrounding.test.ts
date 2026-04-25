// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  searchCodeSymbolsMock,
  searchLocalCheckoutSymbolsMock,
  getLocalCheckoutAstFreshnessMock,
} = vi.hoisted(() => ({
  searchCodeSymbolsMock: vi.fn(),
  searchLocalCheckoutSymbolsMock: vi.fn(),
  getLocalCheckoutAstFreshnessMock: vi.fn(),
}));

vi.mock("../codeIndex/query", () => ({
  searchCodeSymbols: searchCodeSymbolsMock,
}));

vi.mock("../localCodeIndex", () => ({
  searchLocalCheckoutSymbols: searchLocalCheckoutSymbolsMock,
  getLocalCheckoutAstFreshness: getLocalCheckoutAstFreshnessMock,
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
});
