import type { Capability, CapabilityAgent } from "../../src/types";
import {
  buildAgentSessionMemoryPrompt,
  getAgentSessionMemory,
  upsertAgentSessionMemory,
} from "../domains/context-fabric";

export const loadExecutionSessionMemoryPrompt = async ({
  capabilityId,
  agentId,
  scope,
  scopeId,
}: {
  capabilityId: string;
  agentId?: string;
  scope: "GENERAL_CHAT" | "WORK_ITEM" | "TASK";
  scopeId?: string;
}) => {
  if (!agentId) {
    return "";
  }
  const memory = await getAgentSessionMemory({
    capabilityId,
    agentId,
    scope,
    scopeId,
  }).catch(() => null);
  return buildAgentSessionMemoryPrompt(memory);
};

export const persistExecutionSessionMemory = async ({
  capability,
  agent,
  scope,
  scopeId,
  sessionId,
  prompt,
  assistantMessage,
  recentRepoCodeTarget,
  toolHistory,
}: {
  capability: Capability;
  agent: CapabilityAgent;
  scope: "GENERAL_CHAT" | "WORK_ITEM" | "TASK";
  scopeId?: string;
  sessionId?: string | null;
  prompt: string;
  assistantMessage: string;
  recentRepoCodeTarget?: string;
  toolHistory?: Array<{ role: string; content: string }>;
}) => {
  if (!capability.id || !agent.id) {
    return;
  }

  await upsertAgentSessionMemory({
    capabilityId: capability.id,
    agentId: agent.id,
    scope,
    scopeId,
    sessionId: sessionId || `${scope}:${scopeId || capability.id}:${agent.id}`,
    update: {
      rawMessage: prompt,
      effectiveMessage: prompt,
      assistantMessage,
      recentRepoCodeTarget,
      toolTranscript: (toolHistory || []).map(entry => ({
        role: entry.role === "agent" || entry.role === "assistant" ? "agent" : "user",
        content: entry.content,
        kind: "TOOL",
      })),
    },
    assistantMessage,
  }).catch(() => undefined);
};
