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

type ToolLoopReason =
  | "repo-aware-code-question"
  | "disabled-by-caller"
  | "no-read-only-tools";

type ParsedToolIntent = {
  action: "invoke_tool";
  reasoning: string;
  summary?: string;
  toolCall: {
    toolId?: ToolAdapterId;
    requestedToolId?: string;
    args: Record<string, any>;
  };
};

type ToolIntentDisposition =
  | "none"
  | "executed"
  | "repaired"
  | "rejected"
  | "stripped";

type SharedAgentRuntimeResult = Awaited<ReturnType<typeof invokeCapabilityChat>> & {
  toolLoopEnabled?: boolean;
  toolLoopReason?: ToolLoopReason;
  toolLoopUsed?: boolean;
  attemptedToolIds?: ToolAdapterId[];
  resolvedAllowedToolIds?: ToolAdapterId[];
  resolvedAgentSource?: string;
  parsedToolIntent?: {
    action: "invoke_tool";
    toolId?: ToolAdapterId;
    requestedToolId?: string;
    args: Record<string, any>;
  };
  toolIntentDisposition?: ToolIntentDisposition;
  toolIntentRejectionReason?: string;
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
  resolvedAgentSource?: string;
  runtimeLane: AgentRuntimeLane;
};

type ToolLoopDecision =
  | ParsedToolIntent
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

const SAFE_TOOL_INTENT_MESSAGE =
  "I omitted an internal tool instruction instead of showing it directly. Please retry and I’ll rerun the grounded code lookup.";

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
): ToolLoopDecision | null => {
  let parsed: Record<string, any>;
  try {
    parsed = extractJsonObject(responseContent);
  } catch {
    return null;
  }
  const action = normalizeString(parsed.action).toLowerCase();
  const reasoning =
    normalizeString(parsed.reasoning) ||
    "No reasoning was returned by the runtime.";

  const directActionToolId = normalizeToolAdapterId(action);
  const explicitToolId = normalizeToolAdapterId(
    parsed.toolCall?.toolId ||
      parsed.toolId ||
      parsed.tool ||
      parsed.name ||
      parsed.functionName ||
      parsed.function,
  );
  const requestedToolId =
    action === "invoke_tool" ? explicitToolId : directActionToolId || explicitToolId;

  if (requestedToolId) {
    const toolCall = parsed.toolCall && typeof parsed.toolCall === "object"
      ? parsed.toolCall
      : {};
    const args =
      toolCall.args && typeof toolCall.args === "object"
        ? toolCall.args
        : parsed.args && typeof parsed.args === "object"
          ? parsed.args
          : parsed.arguments && typeof parsed.arguments === "object"
            ? parsed.arguments
            : Object.keys(toolCall).some(key => key !== "toolId")
              ? Object.fromEntries(
                  Object.entries(toolCall).filter(([key]) => key !== "toolId"),
                )
              : {};
    return {
      action: "invoke_tool",
      reasoning,
      summary: normalizeString(parsed.summary) || undefined,
      toolCall: {
        toolId: requestedToolId || undefined,
        requestedToolId:
          normalizeString(
            parsed.toolCall?.toolId ||
              parsed.toolId ||
              parsed.tool ||
              parsed.name ||
              parsed.functionName ||
              parsed.function ||
              action,
          ) || undefined,
        args,
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
    '1. {"action":"invoke_tool","reasoning":"...","summary":"...","toolCall":{"toolId":"browse_code","args":{"query":"How many operators are there in the rule engine?","kind":"class"}}}',
    '2. {"action":"answer","reasoning":"...","content":"final user-facing answer"}',
    '3. {"action":"clarify","reasoning":"...","message":"one concise follow-up question"}',
    "Rules:",
    "- Prefer browse_code or workspace_search for structure and inventory questions.",
    "- For browse_code on code inventory questions, include args.query using the user's request.",
    "- Use workspace_read only after a concrete file path or symbol has been discovered.",
    "- Never invent file paths, counts, or repo structure.",
    "- Once tool evidence is sufficient, answer directly instead of repeating the same tool call.",
    "- Invoke at most one tool per response.",
    `Allowed tools:\n${listToolDescriptions(allowedToolIds).join("\n")}`,
  ].join("\n\n");

const buildRejectedToolIntentPrompt = ({
  requestedToolId,
  allowedToolIds,
  reason,
}: {
  requestedToolId?: string;
  allowedToolIds: ToolAdapterId[];
  reason: string;
}) =>
  [
    "The previous response attempted an internal tool call that cannot be executed as-is.",
    requestedToolId ? `Requested tool: ${requestedToolId}` : null,
    `Reason: ${reason}.`,
    `Allowed read-only tools for this turn: ${allowedToolIds.join(", ") || "none"}.`,
    "Return exactly one JSON object with no markdown.",
    '- If one of the allowed tools can help, invoke it.',
    '- Otherwise return {"action":"answer",...} or {"action":"clarify",...}.',
    "- Do not emit raw tool JSON for a disallowed or unavailable tool.",
  ]
    .filter(Boolean)
    .join("\n");

const formatToolResultSummary = (
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
  ]
    .filter(Boolean)
    .join("\n\n");
};

const summarizeToolResult = (
  toolId: ToolAdapterId,
  result: Awaited<ReturnType<typeof executeTool>>,
) =>
  [
    formatToolResultSummary(toolId, result),
    "Now continue answering the original request. Either answer directly or invoke exactly one more allowed tool.",
  ].join("\n\n");

const summarizeToolResults = (
  entries: Array<{
    toolId: ToolAdapterId;
    result: Awaited<ReturnType<typeof executeTool>>;
  }>,
) =>
  [
    ...entries.map(entry => formatToolResultSummary(entry.toolId, entry.result)),
    "Now continue answering the original request. Either answer directly or invoke exactly one more allowed tool.",
  ].join("\n\n");

export const resolveReadOnlyToolIds = (
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

const resolveToolLoopReason = (
  preferReadOnlyToolLoop: boolean,
  resolvedToolIds: ToolAdapterId[],
): ToolLoopReason =>
  !preferReadOnlyToolLoop
    ? "disabled-by-caller"
    : resolvedToolIds.length === 0
      ? "no-read-only-tools"
      : "repo-aware-code-question";

const buildSafeToolIntentContent = (requestedToolId?: string) =>
  requestedToolId
    ? `${SAFE_TOOL_INTENT_MESSAGE} Requested internal tool: ${requestedToolId}.`
    : SAFE_TOOL_INTENT_MESSAGE;

const normalizeReadOnlyToolArgs = ({
  toolId,
  args,
  message,
}: {
  toolId: ToolAdapterId;
  args: Record<string, any>;
  message: string;
}) => {
  const normalizedArgs = { ...(args || {}) };
  const trimmedMessage = String(message || "").trim();

  if (toolId === "browse_code" && !String(normalizedArgs.query || "").trim()) {
    if (trimmedMessage) {
      normalizedArgs.query = trimmedMessage;
    }
  }

  if (toolId === "workspace_search" && !String(normalizedArgs.pattern || "").trim()) {
    if (trimmedMessage) {
      normalizedArgs.pattern = trimmedMessage;
    }
  }

  return normalizedArgs;
};

const buildAutomaticDiscoveryToolCall = ({
  message,
  allowedToolIds,
}: {
  message: string;
  allowedToolIds: ToolAdapterId[];
}) => {
  const trimmedMessage = String(message || "").trim();
  if (!trimmedMessage) {
    return null;
  }
  if (allowedToolIds.includes("browse_code")) {
    return {
      toolId: "browse_code" as const,
      args: {
        query: trimmedMessage,
        limit: 12,
      },
      reason: "auto-discovery-browse-code",
    };
  }
  if (allowedToolIds.includes("workspace_search")) {
    return {
      toolId: "workspace_search" as const,
      args: {
        pattern: trimmedMessage,
        limit: 20,
      },
      reason: "auto-discovery-workspace-search",
    };
  }
  return null;
};

const INVENTORY_CODE_QUESTION_PATTERN =
  /\b(what|which|list|show|how many|count|enumerate)\b.*\b(operator|operators|class|classes|interface|interfaces|enum|enums|function|functions|method|methods|file|files|rule engine)\b/i;

const shouldAutoReadFromBrowseCode = (message: string) =>
  INVENTORY_CODE_QUESTION_PATTERN.test(String(message || ""));

const buildAutomaticWorkspaceReadCalls = ({
  message,
  browseResult,
  attemptedToolIds,
}: {
  message: string;
  browseResult: Awaited<ReturnType<typeof executeTool>>;
  attemptedToolIds: ToolAdapterId[];
}) => {
  if (!shouldAutoReadFromBrowseCode(message)) {
    return [];
  }
  if (attemptedToolIds.includes("workspace_read")) {
    return [];
  }

  const details = (browseResult.details || {}) as {
    symbols?: Array<{
      filePath?: string;
      symbolName?: string;
      kind?: string;
    }>;
    files?: string[];
  };
  const preferredKinds = new Set(["ENUM", "CLASS", "INTERFACE", "TYPE", "METHOD", "FUNCTION"]);
  const symbols = Array.isArray(details.symbols) ? details.symbols : [];
  const rankedSymbols = [...symbols].sort((left, right) => {
    const leftPreferred = preferredKinds.has(String(left.kind || "").toUpperCase()) ? 1 : 0;
    const rightPreferred = preferredKinds.has(String(right.kind || "").toUpperCase()) ? 1 : 0;
    return rightPreferred - leftPreferred;
  });

  const calls: Array<{
    toolId: "workspace_read";
    args: Record<string, any>;
    reason: string;
  }> = [];
  const seenPaths = new Set<string>();

  for (const symbol of rankedSymbols) {
    const filePath = String(symbol.filePath || "").trim();
    if (!filePath || seenPaths.has(filePath)) {
      continue;
    }
    seenPaths.add(filePath);
    const symbolName = String(symbol.symbolName || "").trim();
    const kind = String(symbol.kind || "").toUpperCase();
    calls.push({
      toolId: "workspace_read",
      args: {
        path: filePath,
        ...(preferredKinds.has(kind) && symbolName ? { symbol: symbolName } : {}),
        maxBytes: 12000,
      },
      reason: "auto-read-from-browse-code",
    });
    if (calls.length >= 2) {
      return calls;
    }
  }

  const files = Array.isArray(details.files) ? details.files : [];
  for (const filePath of files) {
    const trimmed = String(filePath || "").trim();
    if (!trimmed || seenPaths.has(trimmed)) {
      continue;
    }
    seenPaths.add(trimmed);
    calls.push({
      toolId: "workspace_read",
      args: {
        path: trimmed,
        maxBytes: 12000,
      },
      reason: "auto-read-from-browse-code",
    });
    if (calls.length >= 2) {
      break;
    }
  }

  return calls;
};

const executeReadOnlyToolChain = async ({
  capability,
  agent,
  workItem,
  message,
  toolId,
  args,
  attemptedToolIds,
  runtimeLane,
}: {
  capability: Capability;
  agent: CapabilityAgent;
  workItem?: WorkItem;
  message: string;
  toolId: ToolAdapterId;
  args: Record<string, any>;
  attemptedToolIds: ToolAdapterId[];
  runtimeLane?: string;
}) => {
  const normalizedArgs = normalizeReadOnlyToolArgs({
    toolId,
    args,
    message,
  });
  const primaryResult = await executeTool({
    capability,
    agent,
    workItem,
    toolId,
    args: normalizedArgs,
  });
  const executed: Array<{
    toolId: ToolAdapterId;
    args: Record<string, any>;
    result: Awaited<ReturnType<typeof executeTool>>;
    reason?: string;
  }> = [
    {
      toolId,
      args: normalizedArgs,
      result: primaryResult,
    },
  ];

  if (toolId === "browse_code") {
    const followUpCalls = buildAutomaticWorkspaceReadCalls({
      message,
      browseResult: primaryResult,
      attemptedToolIds: [...attemptedToolIds, toolId],
    });
    for (const followUp of followUpCalls) {
      const followUpResult = await executeTool({
        capability,
        agent,
        workItem,
        toolId: followUp.toolId,
        args: followUp.args,
      });
      executed.push({
        toolId: followUp.toolId,
        args: followUp.args,
        result: followUpResult,
        reason: followUp.reason,
      });
      console.warn("[agentRuntime] auto-ran workspace_read after browse_code", {
        runtimeLane,
        reason: followUp.reason,
        path: followUp.args.path,
        symbol: followUp.args.symbol,
      });
    }
  }

  return executed;
};

const buildForcedAnswerPrompt = () =>
  [
    "You already have tool evidence for the original request.",
    "Answer the user directly in plain text.",
    "Do not return JSON.",
    "Do not request or invoke any more tools.",
    "Use only the gathered tool evidence. If it is insufficient, say what remains uncertain.",
  ].join("\n");

const extractUserFacingContent = (content: string) => {
  const decision = parseToolLoopDecision(content);
  if (!decision) {
    const normalized = normalizeString(content);
    return normalized || null;
  }
  if (decision.action === "answer") {
    return decision.content;
  }
  if (decision.action === "clarify") {
    return decision.message;
  }
  return null;
};

const isRecoverableReadOnlyTool = (toolId?: ToolAdapterId) =>
  Boolean(toolId && READ_ONLY_AGENT_TOOL_IDS.includes(toolId));

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
  resolvedAgentSource,
  runtimeLane,
}: InvokeCommonAgentRuntimeArgs): Promise<SharedAgentRuntimeResult> => {
  const agentReadOnlyToolIds = resolveReadOnlyToolIds(agent);
  const readOnlyToolIds = resolveReadOnlyToolIds(agent, allowedToolIds);
  const toolLoopEnabled = preferReadOnlyToolLoop && readOnlyToolIds.length > 0;
  const toolLoopReason = resolveToolLoopReason(preferReadOnlyToolLoop, readOnlyToolIds);
  const automaticDiscoveryToolCall = buildAutomaticDiscoveryToolCall({
    message,
    allowedToolIds: readOnlyToolIds,
  });

  const recoverToolIntentToAnswer = async ({
    toolId,
    requestedToolId,
    args,
    priorAgentContent,
    recoveryReason,
    recoveryAllowedToolIds,
    disposition,
  }: {
    toolId: ToolAdapterId;
    requestedToolId?: string;
    args: Record<string, any>;
    priorAgentContent: string;
    recoveryReason: string;
    recoveryAllowedToolIds: ToolAdapterId[];
    disposition: ToolIntentDisposition;
  }) => {
    const recoveryScopeId = `tool-recovery-${randomUUID()}`;
    try {
      const executedToolCalls = await executeReadOnlyToolChain({
        capability: capability as Capability,
        agent: agent as CapabilityAgent,
        workItem,
        message,
        toolId,
        args,
        attemptedToolIds: [],
        runtimeLane,
      });
      const toolResult = executedToolCalls[executedToolCalls.length - 1]!.result;
      const normalizedToolArgs = executedToolCalls[0]!.args;
      const forcedAnswer = await invokeCapabilityChat({
        capability,
        agent,
        history: [
          ...history,
          {
            role: "agent",
            content: priorAgentContent,
          },
          {
            role: "user",
            content: summarizeToolResults(
              executedToolCalls.map(entry => ({
                toolId: entry.toolId,
                result: entry.result,
              })),
            ),
          },
        ],
        message: `Answer the original request directly: ${message}`,
        developerPrompt: [developerPrompt, buildForcedAnswerPrompt()]
          .filter(Boolean)
          .join("\n\n"),
        memoryPrompt,
        scope: "TASK",
        scopeId: recoveryScopeId,
        resetSession: false,
      });
      const forcedAnswerContent = extractUserFacingContent(forcedAnswer.content || "");
      if (!forcedAnswerContent) {
        return null;
      }
      if (onDelta) {
        onDelta(forcedAnswerContent);
      }
      console.warn("[agentRuntime] recovered read-only tool intent", {
        runtimeLane,
        toolId,
        requestedToolId,
        recoveryReason,
      });
      return {
        response: forcedAnswer,
        content: forcedAnswerContent,
        toolResult,
        usage: combineUsage(
          {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
          },
          forcedAnswer.usage,
        ),
        attemptedToolIds: executedToolCalls.map(entry => entry.toolId),
        parsedToolIntent: {
          action: "invoke_tool" as const,
          toolId,
          requestedToolId,
          args: normalizedToolArgs,
        },
        toolIntentDisposition: disposition,
        toolIntentRejectionReason: recoveryReason,
        resolvedAllowedToolIds: recoveryAllowedToolIds,
      };
    } finally {
      await evictManagedCapabilitySessions({
        capabilityId: capability.id,
        agentId: agent.id,
        scope: "TASK",
        scopeId: recoveryScopeId,
      }).catch(() => undefined);
    }
  };

  if (!toolLoopEnabled) {
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
    const directDecision = parseToolLoopDecision(directResult.content || "");
    const directToolIntent =
      directDecision?.action === "invoke_tool"
        ? {
            action: "invoke_tool" as const,
            toolId: directDecision.toolCall.toolId,
            requestedToolId: directDecision.toolCall.requestedToolId,
            args: directDecision.toolCall.args,
          }
        : undefined;
    if (directToolIntent?.toolId && isRecoverableReadOnlyTool(directToolIntent.toolId)) {
      const recoveryAllowedToolIds =
        readOnlyToolIds.length > 0
          ? readOnlyToolIds
          : agentReadOnlyToolIds.length > 0
            ? agentReadOnlyToolIds
            : [directToolIntent.toolId];
      const recovered = await recoverToolIntentToAnswer({
        toolId: directToolIntent.toolId,
        requestedToolId: directToolIntent.requestedToolId,
        args: directToolIntent.args,
        priorAgentContent: directResult.content || "",
        recoveryReason: toolLoopReason,
        recoveryAllowedToolIds,
        disposition: "repaired",
      });
      if (recovered) {
        return {
          ...directResult,
          ...recovered.response,
          content: recovered.content,
          usage: combineUsage(directResult.usage, recovered.response.usage),
          sessionScope: scope,
          sessionScopeId: scopeId,
          toolLoopEnabled,
          toolLoopReason,
          ...deriveDiscoveryMetadata(recovered.attemptedToolIds, [recovered.toolResult]),
          resolvedAllowedToolIds: recoveryAllowedToolIds,
          resolvedAgentSource,
          parsedToolIntent: recovered.parsedToolIntent,
          toolIntentDisposition: recovered.toolIntentDisposition,
          toolIntentRejectionReason: recovered.toolIntentRejectionReason,
          runtimeLane,
        };
      }
    }
    if (directToolIntent) {
      console.warn("[agentRuntime] stripped raw tool intent from direct response", {
        runtimeLane,
        requestedToolId:
          directToolIntent.toolId || directToolIntent.requestedToolId || "unknown",
        toolLoopReason,
      });
    }
    return {
      ...directResult,
      content: directToolIntent
        ? buildSafeToolIntentContent(
            directToolIntent.toolId || directToolIntent.requestedToolId,
          )
        : directResult.content,
      toolLoopEnabled,
      toolLoopReason,
      toolLoopUsed: false,
      attemptedToolIds: [],
      resolvedAllowedToolIds: readOnlyToolIds,
      resolvedAgentSource,
      parsedToolIntent: directToolIntent,
      toolIntentDisposition: directToolIntent ? "stripped" : "none",
      toolIntentRejectionReason: directToolIntent ? toolLoopReason : undefined,
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
  let parsedToolIntent: SharedAgentRuntimeResult["parsedToolIntent"];
  let toolIntentDisposition: ToolIntentDisposition = "none";
  let toolIntentRejectionReason: string | undefined;
  let aggregatedUsage: AgentRuntimeUsage | null = null;
  let lastResult: Awaited<ReturnType<typeof invokeCapabilityChat>> | null = null;
  let currentMessage = message;
  let autoDiscoveryAttempted = false;

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

      const decision = parseToolLoopDecision(loopResponse.content || "");
      if (!decision) {
        if (
          !autoDiscoveryAttempted &&
          attemptedToolIds.length === 0 &&
          toolIntentDisposition === "none" &&
          automaticDiscoveryToolCall
        ) {
          autoDiscoveryAttempted = true;
          const executedToolCalls = await executeReadOnlyToolChain({
            capability: capability as Capability,
            agent: agent as CapabilityAgent,
            workItem,
            message,
            toolId: automaticDiscoveryToolCall.toolId,
            args: automaticDiscoveryToolCall.args,
            attemptedToolIds,
            runtimeLane,
          });
          attemptedToolIds.push(...executedToolCalls.map(entry => entry.toolId));
          toolResults.push(...executedToolCalls.map(entry => entry.result));
          parsedToolIntent = {
            action: "invoke_tool",
            toolId: automaticDiscoveryToolCall.toolId,
            requestedToolId: automaticDiscoveryToolCall.toolId,
            args: executedToolCalls[0]!.args,
          };
          toolIntentDisposition = "repaired";
          toolIntentRejectionReason = automaticDiscoveryToolCall.reason;
          toolHistory.push({
            role: "user",
            content: summarizeToolResults(
              executedToolCalls.map(entry => ({
                toolId: entry.toolId,
                result: entry.result,
              })),
            ),
          });
          currentMessage = `Continue answering the original request directly using the gathered tool evidence: ${message}`;
          console.warn("[agentRuntime] auto-ran read-only discovery after non-tool response", {
            runtimeLane,
            toolId: automaticDiscoveryToolCall.toolId,
            reason: automaticDiscoveryToolCall.reason,
          });
          continue;
        }
        if (onDelta && loopResponse.content) {
          onDelta(loopResponse.content);
        }
        return {
          ...loopResponse,
          usage: aggregatedUsage || loopResponse.usage,
          sessionScope: scope,
          sessionScopeId: scopeId,
          toolLoopEnabled,
          toolLoopReason,
          ...deriveDiscoveryMetadata(attemptedToolIds, toolResults),
          resolvedAllowedToolIds: readOnlyToolIds,
          resolvedAgentSource,
          parsedToolIntent,
          toolIntentDisposition,
          toolIntentRejectionReason,
          runtimeLane,
        };
      }

      if (decision.action === "answer") {
        if (
          !autoDiscoveryAttempted &&
          attemptedToolIds.length === 0 &&
          toolIntentDisposition === "none" &&
          automaticDiscoveryToolCall
        ) {
          autoDiscoveryAttempted = true;
          const executedToolCalls = await executeReadOnlyToolChain({
            capability: capability as Capability,
            agent: agent as CapabilityAgent,
            workItem,
            message,
            toolId: automaticDiscoveryToolCall.toolId,
            args: automaticDiscoveryToolCall.args,
            attemptedToolIds,
            runtimeLane,
          });
          attemptedToolIds.push(...executedToolCalls.map(entry => entry.toolId));
          toolResults.push(...executedToolCalls.map(entry => entry.result));
          parsedToolIntent = {
            action: "invoke_tool",
            toolId: automaticDiscoveryToolCall.toolId,
            requestedToolId: automaticDiscoveryToolCall.toolId,
            args: executedToolCalls[0]!.args,
          };
          toolIntentDisposition = "repaired";
          toolIntentRejectionReason = automaticDiscoveryToolCall.reason;
          toolHistory.push({
            role: "user",
            content: summarizeToolResults(
              executedToolCalls.map(entry => ({
                toolId: entry.toolId,
                result: entry.result,
              })),
            ),
          });
          currentMessage = `Continue answering the original request directly using the gathered tool evidence: ${message}`;
          console.warn("[agentRuntime] auto-ran read-only discovery before accepting direct answer", {
            runtimeLane,
            toolId: automaticDiscoveryToolCall.toolId,
            reason: automaticDiscoveryToolCall.reason,
          });
          continue;
        }
        if (onDelta && decision.content) {
          onDelta(decision.content);
        }
        return {
          ...loopResponse,
          content: decision.content,
          usage: aggregatedUsage || loopResponse.usage,
          sessionScope: scope,
          sessionScopeId: scopeId,
          toolLoopEnabled,
          toolLoopReason,
          ...deriveDiscoveryMetadata(attemptedToolIds, toolResults),
          resolvedAllowedToolIds: readOnlyToolIds,
          resolvedAgentSource,
          parsedToolIntent,
          toolIntentDisposition,
          toolIntentRejectionReason,
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
          toolLoopEnabled,
          toolLoopReason,
          ...deriveDiscoveryMetadata(attemptedToolIds, toolResults),
          resolvedAllowedToolIds: readOnlyToolIds,
          resolvedAgentSource,
          parsedToolIntent,
          toolIntentDisposition,
          toolIntentRejectionReason,
          runtimeLane,
        };
      }

      parsedToolIntent = {
        action: "invoke_tool",
        toolId: decision.toolCall.toolId,
        requestedToolId: decision.toolCall.requestedToolId,
        args: decision.toolCall.args,
      };

      const requestedToolId =
        decision.toolCall.toolId || decision.toolCall.requestedToolId;
      if (!decision.toolCall.toolId) {
        toolIntentDisposition = "rejected";
        toolIntentRejectionReason = "unrecognized-tool";
        console.warn("[agentRuntime] rejected unrecognized tool intent", {
          runtimeLane,
          requestedToolId,
          allowedToolIds: readOnlyToolIds,
        });
        toolHistory.push(
          {
            role: "agent",
            content: loopResponse.content,
          },
          {
            role: "user",
            content: buildRejectedToolIntentPrompt({
              requestedToolId,
              allowedToolIds: readOnlyToolIds,
              reason: "unrecognized tool",
            }),
          },
        );
        currentMessage = `Continue answering the original request: ${message}`;
        continue;
      }

      if (!readOnlyToolIds.includes(decision.toolCall.toolId)) {
        toolIntentDisposition = "rejected";
        toolIntentRejectionReason = "tool-not-allowed";
        console.warn("[agentRuntime] rejected disallowed tool intent", {
          runtimeLane,
          requestedToolId,
          allowedToolIds: readOnlyToolIds,
          agentReadOnlyToolIds,
        });
        toolHistory.push(
          {
            role: "agent",
            content: loopResponse.content,
          },
          {
            role: "user",
            content: buildRejectedToolIntentPrompt({
              requestedToolId,
              allowedToolIds: readOnlyToolIds,
              reason: "tool not allowed for this turn",
            }),
          },
        );
        currentMessage = `Continue answering the original request: ${message}`;
        continue;
      }

      const executedToolCalls = await executeReadOnlyToolChain({
        capability: capability as Capability,
        agent: agent as CapabilityAgent,
        workItem,
        message,
        toolId: decision.toolCall.toolId,
        args: decision.toolCall.args,
        attemptedToolIds,
        runtimeLane,
      });
      const normalizedToolArgs = executedToolCalls[0]!.args;
      toolIntentDisposition = agentReadOnlyToolIds.includes(decision.toolCall.toolId)
        ? "executed"
        : "repaired";
      toolIntentRejectionReason = undefined;
      attemptedToolIds.push(...executedToolCalls.map(entry => entry.toolId));
      toolResults.push(...executedToolCalls.map(entry => entry.result));
      parsedToolIntent = {
        action: "invoke_tool",
        toolId: decision.toolCall.toolId,
        requestedToolId: decision.toolCall.requestedToolId,
        args: normalizedToolArgs,
      };
      toolHistory.push(
        {
          role: "agent",
          content: loopResponse.content,
        },
        {
          role: "user",
          content: summarizeToolResults(
            executedToolCalls.map(entry => ({
              toolId: entry.toolId,
              result: entry.result,
            })),
          ),
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
    const fallbackDecision = parseToolLoopDecision(fallbackResponse.content || "");
    const fallbackToolIntent =
      fallbackDecision?.action === "invoke_tool"
        ? fallbackDecision
        : null;
    if (fallbackToolIntent && attemptedToolIds.length > 0) {
      const forcedAnswerScopeId = `tool-final-answer-${randomUUID()}`;
      try {
        const forcedAnswer = await invokeCapabilityChat({
          capability,
          agent,
          history: [...history, ...toolHistory],
          message: `Answer the original request directly using the gathered tool evidence: ${message}`,
          developerPrompt: [developerPrompt, buildForcedAnswerPrompt()]
            .filter(Boolean)
            .join("\n\n"),
          memoryPrompt,
          scope: "TASK",
          scopeId: forcedAnswerScopeId,
          resetSession: false,
        });
        const forcedAnswerContent = extractUserFacingContent(forcedAnswer.content || "");
        if (forcedAnswerContent) {
          if (onDelta) {
            onDelta(forcedAnswerContent);
          }
          console.warn("[agentRuntime] recovered final answer after tool-loop exhaustion", {
            runtimeLane,
            attemptedToolIds,
          });
          return {
            ...forcedAnswer,
            content: forcedAnswerContent,
            usage: aggregatedUsage
              ? combineUsage(aggregatedUsage, forcedAnswer.usage)
              : forcedAnswer.usage,
            sessionScope: scope,
            sessionScopeId: scopeId,
            toolLoopEnabled,
            toolLoopReason,
            ...deriveDiscoveryMetadata(attemptedToolIds, toolResults),
            resolvedAllowedToolIds: readOnlyToolIds,
            resolvedAgentSource,
            parsedToolIntent: {
              action: "invoke_tool",
              toolId: fallbackToolIntent.toolCall.toolId,
              requestedToolId: fallbackToolIntent.toolCall.requestedToolId,
              args: fallbackToolIntent.toolCall.args,
            },
            toolIntentDisposition: "repaired",
            toolIntentRejectionReason: "tool-loop-exhausted-final-answer-recovery",
            runtimeLane,
          };
        }
      } finally {
        await evictManagedCapabilitySessions({
          capabilityId: capability.id,
          agentId: agent.id,
          scope: "TASK",
          scopeId: forcedAnswerScopeId,
        }).catch(() => undefined);
      }
    }
    const fallbackContent = fallbackToolIntent
      ? buildSafeToolIntentContent(
          fallbackToolIntent.toolCall.toolId ||
            fallbackToolIntent.toolCall.requestedToolId,
        )
      : fallbackResponse.content;
    if (onDelta && fallbackContent) {
      onDelta(fallbackContent);
    }
    if (fallbackToolIntent) {
      parsedToolIntent = {
        action: "invoke_tool",
        toolId: fallbackToolIntent.toolCall.toolId,
        requestedToolId: fallbackToolIntent.toolCall.requestedToolId,
        args: fallbackToolIntent.toolCall.args,
      };
      toolIntentDisposition = "stripped";
      toolIntentRejectionReason =
        toolIntentRejectionReason || "tool-intent-leaked-after-repair";
      console.warn("[agentRuntime] stripped raw tool intent after loop exhaustion", {
        runtimeLane,
        requestedToolId:
          fallbackToolIntent.toolCall.toolId ||
          fallbackToolIntent.toolCall.requestedToolId,
        allowedToolIds: readOnlyToolIds,
      });
    }
    return {
      ...fallbackResponse,
      content: fallbackContent,
      usage: aggregatedUsage
        ? combineUsage(aggregatedUsage, fallbackResponse.usage)
        : fallbackResponse.usage,
      sessionScope: scope,
      sessionScopeId: scopeId,
      toolLoopEnabled,
      toolLoopReason,
      ...deriveDiscoveryMetadata(attemptedToolIds, toolResults),
      resolvedAllowedToolIds: readOnlyToolIds,
      resolvedAgentSource,
      parsedToolIntent,
      toolIntentDisposition,
      toolIntentRejectionReason,
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
