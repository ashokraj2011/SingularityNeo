// @vitest-environment node
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorkItemCheckoutPath } from "../workItemCheckouts";

describe("buildWorkItemCheckoutPath", () => {
  it("creates a per-work-item checkout for a single repository capability", () => {
    const checkoutPath = buildWorkItemCheckoutPath({
      workingDirectoryPath: "/Users/example/code",
      capability: {
        id: "CAP-1",
        name: "Order Service",
      },
      workItemId: "WI-123ABC",
      repository: {
        id: "REPO-1",
        label: "order-service",
        url: "https://github.com/example/order-service.git",
      },
      repositoryCount: 1,
    });

    expect(checkoutPath).toBe(
      path.join("/Users/example/code", "order-service", "WI-123ABC"),
    );
  });

  it("adds a repository segment for multi-repo capabilities", () => {
    const checkoutPath = buildWorkItemCheckoutPath({
      workingDirectoryPath: "/Users/example/code",
      capability: {
        id: "CAP-2",
        name: "Payments Platform",
      },
      workItemId: "WI-789XYZ",
      repository: {
        id: "REPO-2",
        label: "gateway-api",
        url: "https://github.com/example/gateway-api.git",
      },
      repositoryCount: 2,
    });

    expect(checkoutPath).toBe(
      path.join(
        "/Users/example/code",
        "payments-platform",
        "WI-789XYZ",
        "gateway-api",
      ),
    );
  });
});
