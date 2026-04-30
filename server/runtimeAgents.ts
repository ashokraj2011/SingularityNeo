import type {
  CapabilityAgent,
  CapabilityWorkspace,
  ToolAdapterId,
} from "../src/types";
import { getStandardAgentPreferredToolIds } from "../src/constants";
import { getReadOnlyToolIds } from "../src/lib/toolCatalog";

export type RuntimeResolvedAgentSource =
  | "bundle-agent-id"
  | "bundle-agent-template"
  | "bundle-primary-chat"
  | "bundle-active-chat"
  | "bundle-owner"
  | "bundle-first-agent"
  | "payload-agent"
  | "fallback-read-only-profile";

const READ_ONLY_TOOL_SET = new Set(getReadOnlyToolIds());

const DEFAULT_REPO_AWARE_READ_ONLY_TOOL_IDS = getStandardAgentPreferredToolIds(
  "EXECUTION-OPS",
).filter((toolId): toolId is ToolAdapterId => READ_ONLY_TOOL_SET.has(toolId));

const mergeAgents = (
  payloadAgent: Partial<CapabilityAgent> | undefined,
  liveAgent: Partial<CapabilityAgent>,
): Partial<CapabilityAgent> => ({
  ...(payloadAgent || {}),
  ...liveAgent,
  preferredToolIds:
    liveAgent.preferredToolIds !== undefined
      ? liveAgent.preferredToolIds
      : payloadAgent?.preferredToolIds,
  rolePolicy:
    liveAgent.rolePolicy !== undefined
      ? liveAgent.rolePolicy
      : payloadAgent?.rolePolicy,
  standardTemplateKey:
    liveAgent.standardTemplateKey !== undefined
      ? liveAgent.standardTemplateKey
      : payloadAgent?.standardTemplateKey,
  isOwner:
    liveAgent.isOwner !== undefined ? liveAgent.isOwner : payloadAgent?.isOwner,
});

const resolveWorkspaceAgent = ({
  workspace,
  payloadAgent,
  payloadAgentId,
}: {
  workspace?: Pick<
    CapabilityWorkspace,
    "agents" | "primaryCopilotAgentId" | "activeChatAgentId"
  >;
  payloadAgent?: Partial<CapabilityAgent>;
  payloadAgentId?: string;
}): { agent: Partial<CapabilityAgent>; source: RuntimeResolvedAgentSource } | null => {
  const agents = workspace?.agents || [];
  if (!agents.length) {
    return null;
  }

  const normalizedTemplateKey = String(payloadAgent?.standardTemplateKey || "").trim();
  const byId =
    (payloadAgentId
      ? agents.find((agent) => agent.id === payloadAgentId)
      : undefined) || null;
  if (byId) {
    return {
      agent: mergeAgents(payloadAgent, byId),
      source: "bundle-agent-id",
    };
  }

  const byTemplate =
    normalizedTemplateKey
      ? agents.find((agent) => agent.standardTemplateKey === normalizedTemplateKey)
      : undefined;
  if (byTemplate) {
    return {
      agent: mergeAgents(payloadAgent, byTemplate),
      source: "bundle-agent-template",
    };
  }

  const primaryAgent = workspace?.primaryCopilotAgentId
    ? agents.find((agent) => agent.id === workspace.primaryCopilotAgentId)
    : undefined;
  if (primaryAgent) {
    return {
      agent: mergeAgents(payloadAgent, primaryAgent),
      source: "bundle-primary-chat",
    };
  }

  const activeAgent = workspace?.activeChatAgentId
    ? agents.find((agent) => agent.id === workspace.activeChatAgentId)
    : undefined;
  if (activeAgent) {
    return {
      agent: mergeAgents(payloadAgent, activeAgent),
      source: "bundle-active-chat",
    };
  }

  const ownerAgent = agents.find((agent) => agent.isOwner);
  if (ownerAgent) {
    return {
      agent: mergeAgents(payloadAgent, ownerAgent),
      source: "bundle-owner",
    };
  }

  return {
    agent: mergeAgents(payloadAgent, agents[0]),
    source: "bundle-first-agent",
  };
};

export const resolveRuntimeAgentForWorkspace = ({
  workspace,
  payloadAgent,
  payloadAgentId,
}: {
  workspace?: Pick<
    CapabilityWorkspace,
    "agents" | "primaryCopilotAgentId" | "activeChatAgentId"
  >;
  payloadAgent?: Partial<CapabilityAgent>;
  payloadAgentId?: string;
}): { agent: Partial<CapabilityAgent>; source: RuntimeResolvedAgentSource } => {
  const resolved = resolveWorkspaceAgent({
    workspace,
    payloadAgent,
    payloadAgentId,
  });
  if (resolved) {
    return resolved;
  }

  if (payloadAgent && Object.keys(payloadAgent).length > 0) {
    return {
      agent: payloadAgent,
      source: "payload-agent",
    };
  }

  return {
    agent: {
      name: payloadAgent?.name || "Execution Agent",
      role: payloadAgent?.role || "Execution Agent",
      standardTemplateKey: "EXECUTION-OPS",
      preferredToolIds: DEFAULT_REPO_AWARE_READ_ONLY_TOOL_IDS,
    },
    source: "fallback-read-only-profile",
  };
};

export const getDefaultRepoAwareReadOnlyToolIds = () =>
  [...DEFAULT_REPO_AWARE_READ_ONLY_TOOL_IDS];
