import type {
  AgentSessionMemory,
  AgentSessionMemorySummary,
  AgentSessionMemoryTurn,
  SessionMemoryUpdate,
} from '../../../src/types';

export type AgentSessionMemorySource =
  | 'durable-agent-session'
  | 'legacy-chat-session'
  | 'none';

const normalizeText = (value: unknown, maxLength = 420) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const REPO_SEARCH_PATTERNS = [
  /\b(?:search|browse|inspect|scan|find|check|look(?:\s+up|\s+through)?|examine|review)\b/i,
  /\b(?:workspace_search|workspace_read|browse_code)\b/i,
];

const REPO_TARGET_PATTERNS = [
  /\b(?:repo|repository|workspace|codebase|source code|source|code)\b/i,
  /\b(?:operator|class|function|symbol|file|interface|enum|method|package|path)\b/i,
];

const REPO_SEARCH_OFFER_FRAMES = [
  /\b(?:would you like me to|if you want, i can|i can assist in|i can|next recommended action|the next safe step would be|we would need to|you would need to|further .* would be needed|additional .* would be needed)\b/i,
  /\?\s*$/i,
];

export const didAssistantOfferRepoSearch = (value?: string | null) => {
  const normalized = normalizeText(value, 1200);
  if (!normalized) {
    return false;
  }
  const hasRepoTarget = REPO_TARGET_PATTERNS.some(pattern => pattern.test(normalized));
  const hasSearchVerb = REPO_SEARCH_PATTERNS.some(pattern => pattern.test(normalized));
  const hasOfferFrame = REPO_SEARCH_OFFER_FRAMES.some(pattern =>
    pattern.test(normalized),
  );
  return hasRepoTarget && hasSearchVerb && hasOfferFrame;
};

export const inferRecentRepoCodeTarget = (value?: string | null) => {
  const normalized = normalizeText(value, 280);
  if (!normalized) {
    return undefined;
  }
  const pathMatch = normalized.match(/(?:\/[\w.\-\/]+|[A-Za-z]:\\[\w.\-\\]+)/);
  if (pathMatch?.[0]) {
    return pathMatch[0].slice(0, 220);
  }
  if (REPO_TARGET_PATTERNS.some(pattern => pattern.test(normalized))) {
    return normalized;
  }
  return undefined;
};

export const inferAssistantActionableOffer = (value?: string | null) => {
  const normalized = normalizeText(value, 420);
  if (!normalized) {
    return undefined;
  }
  if (
    didAssistantOfferRepoSearch(normalized) ||
    /\b(?:would you like|should i|i can|please retry|next recommended action|the next safe step|you would need to|we would need to)\b/i.test(
      normalized,
    )
  ) {
    return normalized;
  }
  return undefined;
};

const capTurns = (turns: AgentSessionMemoryTurn[]) =>
  turns
    .map(turn => ({
      role: turn.role,
      content: normalizeText(turn.content, 260),
      timestamp: turn.timestamp,
      kind: turn.kind,
    }))
    .filter(turn => turn.content)
    .slice(-8);

export const buildRollingSessionSummary = ({
  lastUserIntent,
  lastAssistantActionableOffer,
  recentRepoCodeTarget,
  salientTurns,
}: {
  lastUserIntent?: string;
  lastAssistantActionableOffer?: string;
  recentRepoCodeTarget?: string;
  salientTurns?: AgentSessionMemoryTurn[];
}) =>
  [
    lastUserIntent ? `Latest user intent: ${lastUserIntent}` : null,
    lastAssistantActionableOffer
      ? `Latest assistant actionable offer: ${lastAssistantActionableOffer}`
      : null,
    recentRepoCodeTarget ? `Recent repo/code target: ${recentRepoCodeTarget}` : null,
    salientTurns?.length
      ? `Recent salient turns:\n${salientTurns
          .slice(-4)
          .map(turn => `${turn.role.toUpperCase()}: ${turn.content}`)
          .join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

export const mergeAgentSessionMemoryState = ({
  existing,
  update,
  assistantMessage,
}: {
  existing?: AgentSessionMemory | null;
  update: SessionMemoryUpdate;
  assistantMessage?: string;
}): Pick<
  AgentSessionMemory,
  | 'rollingSummary'
  | 'salientTurns'
  | 'lastUserIntent'
  | 'lastAssistantActionableOffer'
  | 'recentRepoCodeTarget'
  | 'requestCount'
> => {
  const effectiveUserMessage =
    normalizeText(update.effectiveMessage, 420) || normalizeText(update.rawMessage, 420);
  const normalizedAssistantMessage = normalizeText(
    assistantMessage || update.assistantMessage,
    420,
  );
  const priorTurns = Array.isArray(existing?.salientTurns)
    ? existing!.salientTurns
    : [];
  const appendedTurns = [
    effectiveUserMessage
      ? ({
          role: 'user',
          content: effectiveUserMessage,
          kind: 'TRANSCRIPT',
        } satisfies AgentSessionMemoryTurn)
      : null,
    ...((update.toolTranscript || []).map(turn => ({
      role: turn.role === 'agent' ? 'agent' : 'user',
      content: normalizeText(turn.content, 260),
      kind: turn.kind || 'TOOL',
      timestamp: turn.timestamp,
    })) satisfies AgentSessionMemoryTurn[]),
    normalizedAssistantMessage
      ? ({
          role: 'agent',
          content: normalizedAssistantMessage,
          kind: 'TRANSCRIPT',
        } satisfies AgentSessionMemoryTurn)
      : null,
  ].filter(Boolean) as AgentSessionMemoryTurn[];
  const salientTurns = capTurns([...priorTurns, ...appendedTurns]);
  const lastUserIntent = effectiveUserMessage || existing?.lastUserIntent;
  const lastAssistantActionableOffer =
    inferAssistantActionableOffer(normalizedAssistantMessage) ||
    existing?.lastAssistantActionableOffer;
  const recentRepoCodeTarget =
    inferRecentRepoCodeTarget(update.recentRepoCodeTarget) ||
    inferRecentRepoCodeTarget(effectiveUserMessage) ||
    inferRecentRepoCodeTarget(normalizedAssistantMessage) ||
    existing?.recentRepoCodeTarget;

  return {
    rollingSummary: buildRollingSessionSummary({
      lastUserIntent,
      lastAssistantActionableOffer,
      recentRepoCodeTarget,
      salientTurns,
    }),
    salientTurns,
    lastUserIntent,
    lastAssistantActionableOffer,
    recentRepoCodeTarget,
    requestCount: Number(existing?.requestCount || 0) + 1,
  };
};

export const buildAgentSessionMemoryPrompt = (
  memory?: AgentSessionMemorySummary | AgentSessionMemory | null,
) => {
  if (!memory) {
    return '';
  }

  const salientTurns = Array.isArray((memory as AgentSessionMemory).salientTurns)
    ? (memory as AgentSessionMemory).salientTurns
    : [];

  return [
    'Session memory (short-term continuity only):',
    'Use this to preserve the thread target, follow-up intent, and working context. Do not use it as proof for exact repository paths, symbol locations, or code counts.',
    memory.rollingSummary?.trim() ? `Rolling summary:\n${memory.rollingSummary.trim()}` : null,
    memory.lastUserIntent ? `Last user intent: ${memory.lastUserIntent}` : null,
    memory.lastAssistantActionableOffer
      ? `Last assistant actionable offer: ${memory.lastAssistantActionableOffer}`
      : null,
    memory.recentRepoCodeTarget
      ? `Recent repo/code target: ${memory.recentRepoCodeTarget}`
      : null,
    salientTurns.length
      ? `Recent salient turns:\n${salientTurns
          .slice(-4)
          .map(turn => `${turn.role.toUpperCase()}: ${turn.content}`)
          .join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');
};
