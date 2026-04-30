import { randomUUID } from "node:crypto";
import type {
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  ToolAdapterId,
  WorkItem,
} from "../src/types";
import { getStandardAgentPreferredToolIds } from "../src/constants";
import {
  invokeCapabilityChat,
  invokeCapabilityChatStream,
  type ChatHistoryMessage,
  evictManagedCapabilitySessions,
} from "./githubModels";
import {
  READ_ONLY_AGENT_TOOL_IDS,
  executeTool,
  listToolDescriptions,
} from "./execution/tools";
import { normalizeToolAdapterId } from "./toolIds";

type AgentRuntimeLane =
  | "server-runtime-route"
  | "desktop-runtime-worker"
  | "workflow-execution"
  | "swarm-runtime";

type AgentRuntimeUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

type SharedAgentRuntimeResult = Awaited<ReturnType<typeof invokeCapabilityChat>> & {
  toolLoopUsed?: boolean;
  attemptedToolIds?: ToolAdapterId[];
  codeDiscoveryMode?: "prompt-only" | "ast-first-tool-loop";
  codeDiscoveryFallback?: "none" | "capability-index" | "text-search";
  astSource?: "none" | "local-checkout" | "capability-index" | "text-search";
  runtimeLane?: AgentRuntimeLane;
};

type InvokeCommonAgentRuntimeArgs = {
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  history?: ChatHistoryMessage[] | CapabilityChatMessage[];
  message: string;
  developerPrompt?: string;
  memoryPrompt?: string;
  scope?: "GENERAL_CHAT" | "WORK_ITEM" | "TASK";
  scopeId?: string;
  resetSession?: boolean;
  onDelta?: (delta: string) => void;
  workItem?: WorkItem;
  preferReadOnlyToolLoop?: boolean;
  allowedToolIds?: ToolAdapterId[];
  runtimeLane: AgentRuntimeLane;
};

type ToolLoopDecision =
  | {
      action: "invoke_tool";
      reasoning: string;
      summary?: string;
      toolCall: {
        toolId: ToolAdapterId;
        args: Record<string, any>;
      };
    }
  | {
      action: "answer";
      reasoning: string;
      content: string;
    }
  | {
      action: "clarify";
      reasoning: string;
      message: string;
    };

const MAX_READ_ONLY_TOOL_LOOPS = 4;

const normalizeString = (value: unknown) => String(value || "").trim();

const combineUsage = (left: AgentRuntimeUsage, right: AgentRuntimeUsage): AgentRuntimeUsage => ({
  promptTokens: left.promptTokens + right.promptTokens,
  completionTokens: left.completionTokens + right.completionTokens,
  totalTokens: left.totalTokens + right.totalTokens,
  estimatedCostUsd: Number(
    (left.estimatedCostUsd + right.estimatedCostUsd).toFixed(4),
  ),
});

const extractBalancedJsonCandidates = (value: string) => {
  const candidates: string[] = [];
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (startIndex === -1) {
      if (character === "{") {
        startIndex = index;
        depth = 1;
        inString = false;
        escaping = false;
      }
      continue;
    }

    if (escaping) {
      escaping = false;
      continue;
    }

    if (character === "\\" && inString) {
      escaping = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        candidates.push(value.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return candidates;
};

const tryParseJsonObject = (value?: string | null) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : null;
  } catch {
    return null;
  }
};

const extractJsonObject = (value: string) => {
  const trimmed = value.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1],
    trimmed.match(/```\s*([\s\S]*?)```/i)?.[1],
    ...extractBalancedJsonCandidates(trimmed),
    trimmed.includes("{") && trimmed.includes("}")
      ? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)
      : undefined,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const parsed = tryParseJsonObject(candidate);
    if (parsed) {
      return parsed;
    }
  }

  throw new Error("Model response did not contain valid JSON.");
};

const parseToolLoopDecision = (
  responseContent: string,
  allowedToolIds: ToolAdapterId[],
): ToolLoopDecision | null => {
  const parsed = extractJsonObject(responseContent);
  const action = normalizeString(parsed.action).toLowerCase();
  const reasoning =
    normalizeString(parsed.reasoning) ||
    "No reasoning was returned by the runtime.";

  if (action === "invoke_tool") {
    const toolId = normalizeToolAdapterId(parsed.toolCall?.toolId);
    if (!toolId || !allowedToolIds.includes(toolId)) {
      return null;
    }
    return {
      action: "invoke_tool",
      reasoning,
      summary: normalizeString(parsed.summary) || undefined,
      toolCall: {
        toolId,
        args:
          parsed.toolCall?.args && typeof parsed.toolCall.args === "object"
            ? parsed.toolCall.args
            : {},
      },
    };
  }

  if (action === "answer") {
    const content = normalizeString(parsed.content);
    if (!content) {
      return null;
    }
    return {
      action: "answer",
      reasoning,
      content,
    };
  }

  if (action === "clarify") {
    const message = normalizeString(parsed.message);
    if (!message) {
      return null;
    }
    return {
      action: "clarify",
      reasoning,
      message,
    };
  }

  return null;
};

const buildToolLoopPrompt = (allowedToolIds: ToolAdapterId[]) =>
  [
    "You are operating inside the shared SingularityNeo agent runtime.",
    "When repo or workspace discovery is needed, use the allowed tools yourself instead of suggesting them to the user.",
    "Return exactly one JSON object with no markdown.",
    '1. {"action":"invoke_tool","reasoning":"...","summary":"...","toolCall":{"toolId":"browse_code","args":{"kind":"class"}}}',
    '2. {"action":"answer","reasoning":"...","content":"final user-facing answer"}',
    '3. {"action":"clarify","reasoning":"...","message":"one concise follow-up question"}',
    "Rules:",
    "- Prefer browse_code or workspace_search for structure and inventory questions.",
    "- Use workspace_read only after a concrete file path or symbol has been discovered.",
    "- Never invent file paths, counts, or repo structure.",
    "- Invoke at most one tool per response.",
    `Allowed tools:\n${listToolDescriptions(allowedToolIds).join("\n")}`,
  ].join("\n\n");

const summarizeToolResult = (
  toolId: ToolAdapterId,
  result: Awaited<ReturnType<typeof executeTool>>,
) => {
  const detailJson = result.details
    ? JSON.stringify(result.details, null, 2).slice(0, 2400)
    : "{}";
  const output = normalizeString(result.stdoutPreview || result.stderrPreview);
  return [
    `Tool result for ${toolId}:`,
    `Summary: ${result.summary}`,
    output ? `Output preview:\n${output}` : null,
    `Details:\n${detailJson}`,
    "Now continue answering the original request. Either answer directly or invoke exactly one more allowed tool.",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const resolveReadOnlyToolIds = (
  agent: Partial<CapabilityAgent>,
  explicitToolIds?: ToolAdapterId[],
) => {
  const rolePolicyTools = Array.isArray(agent.rolePolicy?.allowedToolIds)
    ? agent.rolePolicy?.allowedToolIds || []
    : [];
  const preferredTools = Array.isArray(agent.preferredToolIds)
    ? agent.preferredToolIds || []
    : [];
  const fallbackTools =
    agent.standardTemplateKey ||
    (agent.isOwner ? "OWNER" : undefined)
      ? getStandardAgentPreferredToolIds(
          (agent.standardTemplateKey || (agent.isOwner ? "OWNER" : "OWNER")) as any,
        )
      : [];

  const merged = [
    ...(explicitToolIds || []),
    ...rolePolicyTools,
    ...preferredTools,
    ...fallbackTools,
  ];
  const allowed = new Set(READ_ONLY_AGENT_TOOL_IDS);
  return [...new Set(merged)].filter((toolId): toolId is ToolAdapterId =>
    allowed.has(toolId),
  );
};

const deriveDiscoveryMetadata = (
  attemptedToolIds: ToolAdapterId[],
  toolResults: Array<Awaited<ReturnType<typeof executeTool>>>,
) => {
  let astSource: SharedAgentRuntimeResult["astSource"] = "none";
  let codeDiscoveryFallback: SharedAgentRuntimeResult["codeDiscoveryFallback"] = "none";

  for (const result of toolResults) {
    const details = (result.details || {}) as {
      codeIndexSource?: "local-checkout" | "capability-index";
      mode?: string;
    };
    if (details.codeIndexSource === "local-checkout") {
      astSource = "local-checkout";
      codeDiscoveryFallback = "none";
      break;
    }
    if (details.codeIndexSource === "capability-index") {
      astSource = "capability-index";
      codeDiscoveryFallback = "capability-index";
    }
    if (details.mode === "text-search") {
      astSource = "text-search";
      codeDiscoveryFallback = "text-search";
    }
  }

  return {
    toolLoopUsed: attemptedToolIds.length > 0,
    attemptedToolIds,
    codeDiscoveryMode:
      attemptedToolIds.length > 0 ? ("ast-first-tool-loop" as const) : ("prompt-only" as const),
    codeDiscoveryFallback,
    astSource,
  };
};

export const invokeCommonAgentRuntime = async ({
  capability,
  agent,
  history = [],
  message,
  developerPrompt,
  memoryPrompt,
  scope = "GENERAL_CHAT",
  scopeId,
  resetSession = false,
  onDelta,
  workItem,
  preferReadOnlyToolLoop = false,
  allowedToolIds,
  runtimeLane,
}: InvokeCommonAgentRuntimeArgs): Promise<SharedAgentRuntimeResult> => {
  const readOnlyToolIds = resolveReadOnlyToolIds(agent, allowedToolIds);
  if (!preferReadOnlyToolLoop || readOnlyToolIds.length === 0) {
    const directResult = onDelta
      ? await invokeCapabilityChatStream({
          capability,
          agent,
          history,
          message,
          developerPrompt,
          memoryPrompt,
          scope,
          scopeId,
          resetSession,
          onDelta,
        })
      : await invokeCapabilityChat({
          capability,
          agent,
          history,
          message,
          developerPrompt,
          memoryPrompt,
          scope,
          scopeId,
          resetSession,
        });
    return {
      ...directResult,
      toolLoopUsed: false,
      attemptedToolIds: [],
      codeDiscoveryMode: "prompt-only",
      codeDiscoveryFallback: "none",
      astSource: "none",
      runtimeLane,
    };
  }

  const toolLoopScopeId = `tool-loop-${randomUUID()}`;
  const toolHistory: ChatHistoryMessage[] = [];
  const toolResults: Array<Awaited<ReturnType<typeof executeTool>>> = [];
  const attemptedToolIds: ToolAdapterId[] = [];
  let aggregatedUsage: AgentRuntimeUsage | null = null;
  let lastResult: Awaited<ReturnType<typeof invokeCapabilityChat>> | null = null;
  let currentMessage = message;

  try {
    for (let iteration = 0; iteration < MAX_READ_ONLY_TOOL_LOOPS; iteration += 1) {
      const loopResponse = await invokeCapabilityChat({
        capability,
        agent,
        history: [...history, ...toolHistory],
        message: currentMessage,
        developerPrompt: [developerPrompt, buildToolLoopPrompt(readOnlyToolIds)]
          .filter(Boolean)
          .join("\n\n"),
        memoryPrompt,
        scope: "TASK",
        scopeId: toolLoopScopeId,
        resetSession: iteration === 0 ? resetSession : false,
      });

      lastResult = loopResponse;
      aggregatedUsage = aggregatedUsage
        ? combineUsage(aggregatedUsage, loopResponse.usage)
        : loopResponse.usage;

      const decision = parseToolLoopDecision(loopResponse.content || "", readOnlyToolIds);
      if (!decision) {
        if (onDelta && loopResponse.content) {
          onDelta(loopResponse.content);
        }
        return {
          ...loopResponse,
          usage: aggregatedUsage || loopResponse.usage,
          sessionScope: scope,
          sessionScopeId: scopeId,
          ...deriveDiscoveryMetadata(attemptedToolIds, toolResults),
          runtimeLane,
        };
      }

      if (decision.action === "answer") {
        if (onDelta && decision.content) {
          onDelta(decision.content);
        }
        return {
          ...loopResponse,
          content: decision.content,
          usage: aggregatedUsage || loopResponse.usage,
          sessionScope: scope,
          sessionScopeId: scopeId,
          ...deriveDiscoveryMetadata(attemptedToolIds, toolResults),
          runtimeLane,
        };
      }

      if (decision.action === "clarify") {
        if (onDelta && decision.message) {
          onDelta(decision.message);
        }
        return {
          ...loopResponse,
          content: decision.message,
          usage: aggregatedUsage || loopResponse.usage,
          sessionScope: scope,
          sessionScopeId: scopeId,
          ...deriveDiscoveryMetadata(attemptedToolIds, toolResults),
          runtimeLane,
        };
      }

      const toolResult = await executeTool({
        capability: capability as Capability,
        agent: agent as CapabilityAgent,
        workItem,
        toolId: decision.toolCall.toolId,
        args: decision.toolCall.args,
      });
      attemptedToolIds.push(decision.toolCall.toolId);
      toolResults.push(toolResult);
      toolHistory.push(
        {
          role: "agent",
          content: loopResponse.content,
        },
        {
          role: "user",
          content: summarizeToolResult(decision.toolCall.toolId, toolResult),
        },
      );
      currentMessage = `Continue answering the original request: ${message}`;
    }

    const fallbackResponse =
      lastResult ||
      (await invokeCapabilityChat({
        capability,
        agent,
        history,
        message,
        developerPrompt,
        memoryPrompt,
        scope,
        scopeId,
        resetSession,
      }));
    if (onDelta && fallbackResponse.content) {
      onDelta(fallbackResponse.content);
    }
    return {
      ...fallbackResponse,
      usage: aggregatedUsage
        ? combineUsage(aggregatedUsage, fallbackResponse.usage)
        : fallbackResponse.usage,
      sessionScope: scope,
      sessionScopeId: scopeId,
      ...deriveDiscoveryMetadata(attemptedToolIds, toolResults),
      runtimeLane,
    };
  } finally {
    await evictManagedCapabilitySessions({
      capabilityId: capability.id,
      agentId: agent.id,
      scope: "TASK",
      scopeId: toolLoopScopeId,
    }).catch(() => undefined);
  }
};
