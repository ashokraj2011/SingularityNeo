// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolveRuntimeAgentForWorkspace } from "../runtimeAgents";

describe("resolveRuntimeAgentForWorkspace", () => {
  it("prefers the live bundle agent matched by id over a stale payload copy", () => {
    const resolved = resolveRuntimeAgentForWorkspace({
      payloadAgentId: "AGENT-EXEC",
      payloadAgent: {
        id: "AGENT-EXEC",
        name: "Execution Agent",
        preferredToolIds: ["workspace_read"],
      },
      workspace: {
        primaryCopilotAgentId: "AGENT-OWNER",
        activeChatAgentId: "AGENT-OWNER",
        agents: [
          {
            id: "AGENT-OWNER",
            name: "Owner",
            isOwner: true,
            preferredToolIds: ["workspace_search"],
          },
          {
            id: "AGENT-EXEC",
            name: "Execution Agent",
            standardTemplateKey: "EXECUTION-OPS",
            preferredToolIds: ["browse_code", "workspace_search"],
          },
        ],
      } as any,
    });

    expect(resolved.source).toBe("bundle-agent-id");
    expect(resolved.agent.id).toBe("AGENT-EXEC");
    expect(resolved.agent.preferredToolIds).toEqual([
      "browse_code",
      "workspace_search",
    ]);
  });

  it("falls back to the owner agent when the payload agent cannot be resolved", () => {
    const resolved = resolveRuntimeAgentForWorkspace({
      payloadAgentId: "AGENT-MISSING",
      payloadAgent: {
        id: "AGENT-MISSING",
        name: "Missing Agent",
      },
      workspace: {
        primaryCopilotAgentId: undefined,
        activeChatAgentId: undefined,
        agents: [
          {
            id: "AGENT-OWNER",
            name: "Owner",
            isOwner: true,
            preferredToolIds: ["browse_code", "workspace_search"],
          },
        ],
      } as any,
    });

    expect(resolved.source).toBe("bundle-owner");
    expect(resolved.agent.id).toBe("AGENT-OWNER");
  });

  it("returns a repo-aware fallback profile when no live or payload agent exists", () => {
    const resolved = resolveRuntimeAgentForWorkspace({});

    expect(resolved.source).toBe("fallback-read-only-profile");
    expect(resolved.agent.standardTemplateKey).toBe("EXECUTION-OPS");
    expect(resolved.agent.preferredToolIds).toContain("browse_code");
  });
});
