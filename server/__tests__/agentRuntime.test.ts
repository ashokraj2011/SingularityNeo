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
        args: expect.objectContaining({
          kind: "class",
          query: "How many operators are there in this rule engine?",
        }),
      }),
    );
    expect(result.content).toBe(
      "There are 2 operator classes in the indexed checkout.",
    );
    expect(result.toolLoopEnabled).toBe(true);
    expect(result.toolLoopReason).toBe("repo-aware-code-question");
    expect(result.toolLoopUsed).toBe(true);
    expect(result.attemptedToolIds).toEqual(["browse_code"]);
    expect(result.resolvedAllowedToolIds).toEqual([
      "browse_code",
      "workspace_search",
    ]);
    expect(result.toolIntentDisposition).toBe("executed");
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

  it("executes direct tool-action JSON instead of showing it to the user", async () => {
    invokeCapabilityChatMock
      .mockResolvedValueOnce({
        content:
          '{"action":"browse_code","reasoning":"Need actual operator symbols.","summary":"Browsing code.","toolCall":{"kind":"class"}}',
        model: "test-model",
        usage,
        responseId: "resp-direct-tool",
        createdAt: "2026-04-30T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        content:
          '{"action":"answer","reasoning":"Grounded in browse_code.","content":"The rule engine defines EqualsOperator and ContainsOperator."}',
        model: "test-model",
        usage,
        responseId: "resp-answer",
        createdAt: "2026-04-30T00:00:01.000Z",
      });
    executeToolMock.mockResolvedValue({
      summary: "Found 2 operator classes from the local checkout index.",
      details: {
        codeIndexSource: "local-checkout",
        mode: "symbol-search",
      },
      stdoutPreview:
        "/tmp/rule-engine/src/main/java/org/example/rules/EqualsOperator.java\n/tmp/rule-engine/src/main/java/org/example/rules/ContainsOperator.java",
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
      message: "what all are the operators in this rule engine",
      preferReadOnlyToolLoop: true,
      runtimeLane: "desktop-runtime-worker",
    });

    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "browse_code",
        args: {
          kind: "class",
          query: "what all are the operators in this rule engine",
        },
      }),
    );
    expect(result.content).toBe(
      "The rule engine defines EqualsOperator and ContainsOperator.",
    );
    expect(result.parsedToolIntent).toEqual({
      action: "invoke_tool",
      toolId: "browse_code",
      requestedToolId: "browse_code",
      args: {
        kind: "class",
        query: "what all are the operators in this rule engine",
      },
    });
    expect(result.toolIntentDisposition).toBe("executed");
    expect(result.content).not.toContain('"action":"browse_code"');
  });

  it("repairs stale agent tool policy using explicitly resolved allowed tools", async () => {
    invokeCapabilityChatMock
      .mockResolvedValueOnce({
        content:
          '{"action":"browse_code","reasoning":"Need code structure.","summary":"Browsing code.","toolCall":{"kind":"class"}}',
        model: "test-model",
        usage,
        responseId: "resp-repair-1",
        createdAt: "2026-04-30T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        content:
          '{"action":"answer","reasoning":"Grounded after repair.","content":"The rule engine defines EqualsOperator."}',
        model: "test-model",
        usage,
        responseId: "resp-repair-2",
        createdAt: "2026-04-30T00:00:01.000Z",
      });
    executeToolMock.mockResolvedValue({
      summary: "Found EqualsOperator from the local checkout index.",
      details: {
        codeIndexSource: "local-checkout",
        mode: "symbol-search",
      },
      stdoutPreview:
        "/tmp/rule-engine/src/main/java/org/example/rules/EqualsOperator.java",
    });

    const result = await invokeCommonAgentRuntime({
      capability: {
        id: "CAP-RULES",
        name: "Rule Engine",
      },
      agent: {
        id: "AGENT-STALE",
        name: "Execution Agent",
        preferredToolIds: ["workspace_read"],
      },
      allowedToolIds: ["browse_code", "workspace_search"],
      history: [],
      message: "how many operators are there in the rule engine",
      preferReadOnlyToolLoop: true,
      resolvedAgentSource: "bundle-agent-id",
      runtimeLane: "desktop-runtime-worker",
    });

    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "browse_code",
      }),
    );
    expect(result.toolIntentDisposition).toBe("repaired");
    expect(result.resolvedAgentSource).toBe("bundle-agent-id");
    expect(result.resolvedAllowedToolIds).toEqual([
      "browse_code",
      "workspace_search",
      "workspace_read",
    ]);
    expect(result.content).toBe("The rule engine defines EqualsOperator.");
  });

  it("rejects disallowed tool intents without leaking raw JSON", async () => {
    invokeCapabilityChatMock
      .mockResolvedValueOnce({
        content:
          '{"action":"workspace_apply_patch","reasoning":"Need to patch files.","summary":"Applying patch.","toolCall":{"path":"src/RuleEngine.java"}}',
        model: "test-model",
        usage,
        responseId: "resp-reject-1",
        createdAt: "2026-04-30T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        content:
          '{"action":"answer","reasoning":"Cannot use write tools here.","content":"I need a read-only repo pass first before making any changes."}',
        model: "test-model",
        usage,
        responseId: "resp-reject-2",
        createdAt: "2026-04-30T00:00:01.000Z",
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
      message: "how many operators are there in the rule engine",
      preferReadOnlyToolLoop: true,
      runtimeLane: "desktop-runtime-worker",
    });

    expect(executeToolMock).not.toHaveBeenCalled();
    expect(result.toolIntentDisposition).toBe("rejected");
    expect(result.toolIntentRejectionReason).toBe("tool-not-allowed");
    expect(result.content).toBe(
      "I need a read-only repo pass first before making any changes.",
    );
    expect(result.content).not.toContain('"action":"workspace_apply_patch"');
  });

  it("recovers read-only tool intents even when the initial tool loop is disabled", async () => {
    invokeCapabilityChatMock
      .mockResolvedValueOnce({
        content:
          '{"action":"browse_code","reasoning":"Need repo structure first.","summary":"Browsing code.","toolCall":{"kind":"class"}}',
        model: "test-model",
        usage,
        responseId: "resp-direct-recover",
        createdAt: "2026-04-30T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        content: "The rule engine currently exposes 2 indexed operator classes.",
        model: "test-model",
        usage,
        responseId: "resp-direct-recover-answer",
        createdAt: "2026-04-30T00:00:01.000Z",
      });
    executeToolMock.mockResolvedValue({
      summary: "Found 2 operator classes from the local checkout index.",
      details: {
        codeIndexSource: "local-checkout",
        mode: "symbol-search",
      },
      stdoutPreview:
        "/tmp/rule-engine/src/main/java/org/example/rules/EqualsOperator.java\n/tmp/rule-engine/src/main/java/org/example/rules/ContainsOperator.java",
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
      message: "hello",
      preferReadOnlyToolLoop: false,
      runtimeLane: "desktop-runtime-worker",
    });

    expect(result.toolLoopEnabled).toBe(false);
    expect(result.toolIntentDisposition).toBe("repaired");
    expect(result.toolIntentRejectionReason).toBe("disabled-by-caller");
    expect(result.content).toBe(
      "The rule engine currently exposes 2 indexed operator classes.",
    );
    expect(result.content).not.toContain('"action":"browse_code"');
  });

  it("auto-runs browse_code once before accepting a direct non-tool answer on code questions", async () => {
    invokeCapabilityChatMock
      .mockResolvedValueOnce({
        content:
          '{"action":"answer","reasoning":"Not enough evidence yet.","content":"The current evidence does not list the operators."}',
        model: "test-model",
        usage,
        responseId: "resp-auto-1",
        createdAt: "2026-04-30T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        content:
          '{"action":"answer","reasoning":"Grounded after browse_code.","content":"The rule engine defines the Operator enum and related group operators."}',
        model: "test-model",
        usage,
        responseId: "resp-auto-2",
        createdAt: "2026-04-30T00:00:01.000Z",
      });
    executeToolMock.mockResolvedValue({
      summary: "Found Operator enum from the local checkout index.",
      details: {
        codeIndexSource: "local-checkout",
        mode: "symbol-search",
      },
      stdoutPreview:
        "/tmp/rule-engine/src/main/java/org/example/rules/Operator.java",
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
      message: "What are the operators in the rule engine?",
      preferReadOnlyToolLoop: true,
      runtimeLane: "desktop-runtime-worker",
    });

    expect(executeToolMock).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "browse_code",
        args: {
          query: "What are the operators in the rule engine?",
          limit: 12,
        },
      }),
    );
    expect(result.content).toBe(
      "The rule engine defines the Operator enum and related group operators.",
    );
    expect(result.toolIntentDisposition).toBe("repaired");
    expect(result.toolIntentRejectionReason).toBe("auto-discovery-browse-code");
    expect(result.attemptedToolIds).toEqual(["browse_code"]);
  });

  it("auto-runs workspace_read after browse_code when inventory questions need file contents", async () => {
    invokeCapabilityChatMock
      .mockResolvedValueOnce({
        content:
          '{"action":"browse_code","reasoning":"Need actual operator definitions.","summary":"Browsing code.","toolCall":{"kind":"class"}}',
        model: "test-model",
        usage,
        responseId: "resp-browse-read-1",
        createdAt: "2026-04-30T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        content:
          '{"action":"answer","reasoning":"Grounded after reading the enum.","content":"The rule engine defines operators in the Operator enum."}',
        model: "test-model",
        usage,
        responseId: "resp-browse-read-2",
        createdAt: "2026-04-30T00:00:01.000Z",
      });
    executeToolMock
      .mockResolvedValueOnce({
        summary: "Found Operator enum from the local checkout index.",
        details: {
          codeIndexSource: "local-checkout",
          mode: "symbol-search",
          symbols: [
            {
              symbolId: "SYM-OP",
              symbolName: "Operator",
              qualifiedSymbolName: "org.example.rules.Operator",
              kind: "ENUM",
              filePath: "/tmp/rule-engine/src/main/java/org/example/rules/Operator.java",
            },
          ],
        },
        stdoutPreview:
          "/tmp/rule-engine/src/main/java/org/example/rules/Operator.java",
      })
      .mockResolvedValueOnce({
        summary: "Read Operator enum.",
        details: {
          path: "/tmp/rule-engine/src/main/java/org/example/rules/Operator.java",
          mode: "semantic-hunk",
          codeIndexSource: "local-checkout",
        },
        stdoutPreview: "enum Operator { eq, ne, lt, lte, gt, gte }",
      });

    const result = await invokeCommonAgentRuntime({
      capability: {
        id: "CAP-RULES",
        name: "Rule Engine",
      },
      agent: {
        id: "AGENT-OWNER",
        name: "Owner",
        preferredToolIds: ["browse_code", "workspace_search", "workspace_read"],
      },
      history: [],
      message: "What are the operators in the rule engine?",
      preferReadOnlyToolLoop: true,
      runtimeLane: "desktop-runtime-worker",
    });

    expect(executeToolMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        toolId: "browse_code",
      }),
    );
    expect(executeToolMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        toolId: "workspace_read",
        args: {
          path: "/tmp/rule-engine/src/main/java/org/example/rules/Operator.java",
          symbol: "Operator",
          maxBytes: 12000,
        },
      }),
    );
    expect(result.attemptedToolIds).toEqual(["browse_code", "workspace_read"]);
    expect(result.content).toBe(
      "The rule engine defines operators in the Operator enum.",
    );
  });

  it("forces a final answer after repeated tool calls instead of leaking the last tool intent", async () => {
    // New flow with the dedup guard:
    //   - Iter 1: LLM emits browse_code(class) → executed (mock #1).
    //   - Iter 2: LLM emits browse_code(class) again → dedup skip (mock #2 consumed).
    //   - Iter 3: LLM emits browse_code(class) again → dedup skip + BREAK (mock #3 consumed).
    //   - Forced-answer recovery: returns plain text (mock #4).
    invokeCapabilityChatMock
      .mockResolvedValueOnce({
        content:
          '{"action":"browse_code","reasoning":"Need class symbols.","summary":"Browsing code.","toolCall":{"kind":"class"}}',
        model: "test-model",
        usage,
        responseId: "resp-loop-1",
        createdAt: "2026-04-30T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        content:
          '{"action":"browse_code","reasoning":"Need more symbols.","summary":"Browsing code again.","toolCall":{"kind":"class"}}',
        model: "test-model",
        usage,
        responseId: "resp-loop-2",
        createdAt: "2026-04-30T00:00:01.000Z",
      })
      .mockResolvedValueOnce({
        content:
          '{"action":"browse_code","reasoning":"Need one more pass.","summary":"Browsing code again.","toolCall":{"kind":"class"}}',
        model: "test-model",
        usage,
        responseId: "resp-loop-3",
        createdAt: "2026-04-30T00:00:02.000Z",
      })
      .mockResolvedValueOnce({
        content: "The indexed checkout shows 2 operator classes.",
        model: "test-model",
        usage,
        responseId: "resp-loop-final",
        createdAt: "2026-04-30T00:00:04.000Z",
      });
    executeToolMock.mockResolvedValue({
      summary: "Found operator classes from the local checkout index.",
      details: {
        codeIndexSource: "local-checkout",
        mode: "symbol-search",
      },
      stdoutPreview:
        "/tmp/rule-engine/src/main/java/org/example/rules/EqualsOperator.java",
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
      runtimeLane: "desktop-runtime-worker",
    });

    // The runtime now dedups repeated (toolId, args) emissions inside a
    // single user turn — see the `attemptedToolSignatures` guard in
    // agentRuntime.ts.  Earlier the LLM could re-call browse_code 4× and
    // burn every iteration; now the second emission is rejected and after
    // MAX_DUPLICATE_TOOL_ATTEMPTS the loop breaks into the forced-answer
    // recovery path with a distinct rejection reason.
    expect(executeToolMock).toHaveBeenCalledTimes(1);
    expect(result.toolIntentDisposition).toBe("repaired");
    expect(result.toolIntentRejectionReason).toBe(
      "tool-loop-duplicate-call-exhausted",
    );
    expect(result.content).toBe(
      "The indexed checkout shows 2 operator classes.",
    );
    expect(result.content).not.toContain('"action":"browse_code"');
  });
});
