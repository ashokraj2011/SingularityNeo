// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  invokeCapabilityChatMock,
  invokeCapabilityChatStreamMock,
  evictManagedCapabilitySessionsMock,
  executeToolMock,
} = vi.hoisted(() => ({
  invokeCapabilityChatMock: vi.fn(),
  invokeCapabilityChatStreamMock: vi.fn(),
  evictManagedCapabilitySessionsMock: vi.fn(),
  executeToolMock: vi.fn(),
}));

vi.mock("../githubModels", () => ({
  invokeCapabilityChat: invokeCapabilityChatMock,
  invokeCapabilityChatStream: invokeCapabilityChatStreamMock,
  evictManagedCapabilitySessions: evictManagedCapabilitySessionsMock,
}));

vi.mock("../execution/tools", () => ({
  READ_ONLY_AGENT_TOOL_IDS: [
    "browse_code",
    "workspace_search",
    "workspace_read",
    "workspace_list",
    "git_status",
  ],
  executeTool: executeToolMock,
  listToolDescriptions: (toolIds: string[]) =>
    toolIds.map((toolId) => `- ${toolId}: test tool`),
}));

import { invokeCommonAgentRuntime } from "../agentRuntime";

const usage = {
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
  estimatedCostUsd: 0.0015,
};

describe("invokeCommonAgentRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evictManagedCapabilitySessionsMock.mockResolvedValue(undefined);
  });

  it("uses the shared read-only tool loop for repo discovery questions", async () => {
    invokeCapabilityChatMock
      .mockResolvedValueOnce({
        content:
          '{"action":"invoke_tool","reasoning":"Need repo structure first.","toolCall":{"toolId":"code_browse","args":{"kind":"class"}}}',
        model: "test-model",
        usage,
        responseId: "resp-1",
        createdAt: "2026-04-30T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        content:
          '{"action":"answer","reasoning":"Now grounded.","content":"There are 2 operator classes in the indexed checkout."}',
        model: "test-model",
        usage,
        responseId: "resp-2",
        createdAt: "2026-04-30T00:00:01.000Z",
      });
    executeToolMock.mockResolvedValue({
      summary: "Found 2 classes from the local checkout index.",
      details: {
        codeIndexSource: "local-checkout",
        mode: "symbol-search",
      },
      stdoutPreview:
        "/tmp/rule-engine/src/main/java/org/example/rules/operators/EqualsOperator.java",
    });

    const result = await invokeCommonAgentRuntime({
      capability: {
        id: "CAP-RULES",
        name: "Rule Engine",
      },
      agent: {
        id: "AGENT-OWNER",
        name: "Owner",
        preferredToolIds: ["browse_code", "workspace_search"],
      },
      history: [],
      message: "How many operators are there in this rule engine?",
      preferReadOnlyToolLoop: true,
      runtimeLane: "server-runtime-route",
    });

    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "browse_code",
      }),
    );
    expect(result.content).toBe(
      "There are 2 operator classes in the indexed checkout.",
    );
    expect(result.toolLoopUsed).toBe(true);
    expect(result.attemptedToolIds).toEqual(["browse_code"]);
    expect(result.codeDiscoveryMode).toBe("ast-first-tool-loop");
    expect(result.codeDiscoveryFallback).toBe("none");
    expect(result.astSource).toBe("local-checkout");
    expect(result.runtimeLane).toBe("server-runtime-route");
    expect(evictManagedCapabilitySessionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: "CAP-RULES",
        agentId: "AGENT-OWNER",
        scope: "TASK",
      }),
    );
  });
});
