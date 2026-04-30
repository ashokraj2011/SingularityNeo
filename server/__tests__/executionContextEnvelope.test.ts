// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildExecutionLlmContinuitySections,
  buildRecentWorkItemConversationText,
} from "../execution/llmContextEnvelope";

describe("execution LLM context envelope helpers", () => {
  it("builds bounded recent work-item conversation text", () => {
    const conversation = buildRecentWorkItemConversationText({
      messages: [
        {
          workItemId: "WI-1",
          role: "user",
          content: "Please search the repo and tell me what operators exist.",
        },
        {
          workItemId: "WI-1",
          role: "agent",
          agentName: "Execution Agent",
          content: "I will inspect the code and summarize the operators.",
        },
      ],
      workItemId: "WI-1",
      runId: "RUN-1",
    });

    expect(conversation).toContain("Operator: Please search the repo");
    expect(conversation).toContain("Execution Agent: I will inspect the code");
  });

  it("assembles a shared execution continuity envelope", () => {
    const sections = buildExecutionLlmContinuitySections({
      mode: "repair",
      workItem: {
        id: "WI-1",
        title: "Rule engine",
        description: "List supported operators",
        phase: "DEVELOPMENT",
      } as any,
      workflow: {
        name: "Delivery workflow",
      } as any,
      step: {
        name: "Inspect repo",
        phase: "DEVELOPMENT",
        action: "Browse code and summarize operators",
        description: "Inspect operator definitions",
      } as any,
      runStep: {
        attemptCount: 2,
      } as any,
      recentConversationText:
        "- Operator: search and tell me\n- Execution Agent: I will inspect the repo",
      toolHistory: [
        {
          role: "assistant",
          content:
            '{"action":"invoke_tool","toolCall":{"toolId":"browse_code","args":{"query":"operators"}}}',
        },
      ],
      handoffContext: "Completed prior-step hand-offs:\nDiscovery finished.",
      resolvedWaitContext: "Resolved input: user asked for operator inventory.",
      operatorGuidanceContext: "Operator guidance: answer from code evidence only.",
    });

    expect(sections.envelopeText).toContain("Execution continuity envelope (repair)");
    expect(sections.envelopeText).toContain("Recent operator and stage conversation");
    expect(sections.envelopeText).toContain("Prior tool loop transcript");
    expect(sections.envelopeText).toContain("Workflow hand-off context");
    expect(sections.envelopeText).toContain("Operator guidance: answer from code evidence only.");
    expect(sections.executionContextHydrated).toBe(true);
    expect(sections.contextEnvelopeSource).toBe("shared-execution-envelope");
  });
});
