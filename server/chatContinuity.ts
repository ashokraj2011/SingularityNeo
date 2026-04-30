import type { CapabilityChatMessage } from '../src/types';
import type { ChatHistoryMessage } from './githubModels';

type ChatHistoryItem = ChatHistoryMessage | CapabilityChatMessage;

export type FollowUpBindingMode =
  | 'none'
  | 'latest-assistant-turn'
  | 'active-work-scope';

export type FollowUpIntent =
  | 'none'
  | 'continue-thread'
  | 'run-proposed-search'
  | 'active-work-scope';

export type EffectiveMessageSource =
  | 'raw-user'
  | 'bound-follow-up'
  | 'active-work-scope'
  | 'tool-continuation';

export interface ResolvedChatFollowUpContext {
  history: ReturnType<typeof normalizeChatHistory>;
  rawMessage: string;
  contextMessage: string;
  effectiveMessage: string;
  effectiveMessageSource: EffectiveMessageSource;
  followUpIntent: FollowUpIntent;
  followUpContextPrompt?: string;
  followUpBindingMode: FollowUpBindingMode;
}

const EXPLICIT_FOLLOW_UP_PATTERNS = [
  /^(yes|yeah|yep|yup|ok|okay|sure|please do|do it|do that|go ahead|continue|proceed|same)$/i,
  /^(show me|retry|mark done|approve|reject|delegate)$/i,
  /^(search(?: and tell me)?|look it up|find it|check the repo|go ahead and search)$/i,
  /^(why|how so|what else|and then)$/i,
];

const SEARCH_ACCEPTANCE_PATTERNS = [
  /^(yes|yeah|yep|yup|ok|okay|sure|please do|do it|do that|go ahead|continue|proceed|same)$/i,
  /^(search(?: and tell me)?|look it up|find it|check the repo|go ahead and search)$/i,
];

const hasExplicitReference = (value: string) =>
  /\b(?:WI|RUN)-[A-Z0-9-]+\b/i.test(value) ||
  /\b(work item|run|phase|stage|approval|blocker|operator|class|function|symbol|file|repo|repository)\b/i.test(
    value,
  );

const summarizeTurn = (value: string, maxLength = 420) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const didAssistantOfferRepoSearch = (value: string) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }
  const hasRepoTarget =
    /\b(?:repo|repository|workspace|codebase|source code|source|code)\b/i.test(
      normalized,
    ) || /\b(?:browse_code|workspace_search|workspace_read)\b/i.test(normalized);
  const hasSearchVerb =
    /\b(?:search|browse|inspect|scan|find|check|look(?:\s+up|\s+through)?)\b/i.test(
      normalized,
    );
  const hasOfferFrame =
    /\b(?:would you like me to|if you want, i can|i can assist in|next recommended action|the next safe step would be|we would need to|you would need to)\b/i.test(
      normalized,
    ) || /\?\s*$/.test(normalized);

  return hasRepoTarget && hasSearchVerb && hasOfferFrame;
};

const buildFollowUpResponse = ({
  history,
  trimmedLatestMessage,
  followUpBindingMode,
  followUpIntent,
  effectiveMessage,
  effectiveMessageSource,
  followUpContextPrompt,
}: {
  history: ReturnType<typeof normalizeChatHistory>;
  trimmedLatestMessage: string;
  followUpBindingMode: FollowUpBindingMode;
  followUpIntent: FollowUpIntent;
  effectiveMessage: string;
  effectiveMessageSource: EffectiveMessageSource;
  followUpContextPrompt?: string;
}): ResolvedChatFollowUpContext => ({
  history,
  rawMessage: trimmedLatestMessage,
  contextMessage: effectiveMessage,
  effectiveMessage,
  effectiveMessageSource,
  followUpIntent,
  followUpContextPrompt,
  followUpBindingMode,
});

const buildScopeLabel = ({
  sessionScope,
  sessionScopeId,
  workItemId,
  runId,
  workflowStepId,
}: {
  sessionScope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  sessionScopeId?: string;
  workItemId?: string;
  runId?: string;
  workflowStepId?: string;
}) => {
  if (workItemId) {
    return `work item ${workItemId}`;
  }
  if (runId) {
    return `run ${runId}`;
  }
  if (workflowStepId) {
    return `workflow step ${workflowStepId}`;
  }
  if (sessionScope === 'WORK_ITEM' && sessionScopeId) {
    return `work item ${sessionScopeId}`;
  }
  if (sessionScope === 'TASK' && sessionScopeId) {
    return `task ${sessionScopeId}`;
  }
  if (sessionScope === 'GENERAL_CHAT' && sessionScopeId) {
    return `capability chat ${sessionScopeId}`;
  }
  return 'current thread';
};

export const normalizeChatHistory = ({
  history,
  latestMessage,
}: {
  history?: ChatHistoryItem[];
  latestMessage?: string;
}) => {
  const trimmedLatestMessage = String(latestMessage || '').trim();
  const normalizedHistory = (history || [])
    .filter(item => String(item?.content || '').trim())
    .map(item => ({
      ...item,
      content: String(item.content || '').trim(),
    }));

  if (!trimmedLatestMessage || normalizedHistory.length === 0) {
    return normalizedHistory;
  }

  const last = normalizedHistory[normalizedHistory.length - 1];
  if (
    String(last.role || '').toLowerCase() === 'user' &&
    String(last.content || '').trim().toLowerCase() === trimmedLatestMessage.toLowerCase()
  ) {
    return normalizedHistory.slice(0, -1);
  }

  return normalizedHistory;
};

export const resolveChatFollowUpContext = ({
  history,
  latestMessage,
  sessionScope,
  sessionScopeId,
  workItemId,
  runId,
  workflowStepId,
}: {
  history?: ChatHistoryItem[];
  latestMessage?: string;
  sessionScope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  sessionScopeId?: string;
  workItemId?: string;
  runId?: string;
  workflowStepId?: string;
}): ResolvedChatFollowUpContext => {
  const normalizedHistory = normalizeChatHistory({
    history,
    latestMessage,
  });
  const trimmedLatestMessage = String(latestMessage || '').trim();
  if (!trimmedLatestMessage) {
    return buildFollowUpResponse({
      history: normalizedHistory,
      trimmedLatestMessage,
      effectiveMessage: '',
      effectiveMessageSource: 'raw-user',
      followUpIntent: 'none',
      followUpBindingMode: 'none',
    });
  }

  const wordCount = trimmedLatestMessage.split(/\s+/).filter(Boolean).length;
  const looksLikeFollowUp =
    !hasExplicitReference(trimmedLatestMessage) &&
    (trimmedLatestMessage.length <= 48 || wordCount <= 6) &&
    EXPLICIT_FOLLOW_UP_PATTERNS.some(pattern => pattern.test(trimmedLatestMessage));

  if (!looksLikeFollowUp) {
    return buildFollowUpResponse({
      history: normalizedHistory,
      trimmedLatestMessage,
      effectiveMessage: trimmedLatestMessage,
      effectiveMessageSource: 'raw-user',
      followUpIntent: 'none',
      followUpBindingMode: 'none',
    });
  }

  const lastAssistantTurn = [...normalizedHistory]
    .reverse()
    .find(item =>
      ['agent', 'assistant'].includes(String(item.role || '').toLowerCase()),
    );
  const scopeLabel = buildScopeLabel({
    sessionScope,
    sessionScopeId,
    workItemId,
    runId,
    workflowStepId,
  });

  if (lastAssistantTurn?.content?.trim()) {
    const assistantSummary = summarizeTurn(lastAssistantTurn.content);
    const isSearchAcceptance = SEARCH_ACCEPTANCE_PATTERNS.some(pattern =>
      pattern.test(trimmedLatestMessage),
    );
    const followUpIntent: FollowUpIntent =
      isSearchAcceptance && didAssistantOfferRepoSearch(lastAssistantTurn.content)
        ? 'run-proposed-search'
        : 'continue-thread';
    const effectiveMessage =
      followUpIntent === 'run-proposed-search'
        ? [
            `Continue the same ${scopeLabel}.`,
            `Previous assistant turn: ${assistantSummary}`,
            `Latest user follow-up reply: ${trimmedLatestMessage}`,
            'The user accepted the previously proposed repository/code search. Execute that grounded search now, carry forward the existing thread target, and answer from verified evidence instead of asking what to search for again.',
          ].join('\n')
        : [
            `Follow-up reply in the same ${scopeLabel}.`,
            `Previous assistant turn: ${assistantSummary}`,
            `Operator reply: ${trimmedLatestMessage}`,
          ].join('\n');
    const followUpContextPrompt =
      followUpIntent === 'run-proposed-search'
        ? [
            'Follow-up continuity context:',
            `Treat the latest user message as acceptance of the previously proposed repository/code search in the same ${scopeLabel}.`,
            `Most recent assistant turn in this thread:\n${assistantSummary}`,
            `Latest user follow-up reply:\n${trimmedLatestMessage}`,
            'Do not ask the user what to search for again. Continue the established repo/code search target from the thread, execute the internal discovery flow, and answer from grounded evidence.',
          ].join('\n\n')
        : [
            'Follow-up continuity context:',
            `Treat the latest user message as a direct follow-up inside the same ${scopeLabel}.`,
            `Most recent assistant turn in this thread:\n${assistantSummary}`,
            `Latest user follow-up reply:\n${trimmedLatestMessage}`,
          ].join('\n\n');
    return buildFollowUpResponse({
      history: normalizedHistory,
      trimmedLatestMessage,
      effectiveMessage,
      effectiveMessageSource: 'bound-follow-up',
      followUpIntent,
      followUpContextPrompt,
      followUpBindingMode: 'latest-assistant-turn',
    });
  }

  if (sessionScope === 'WORK_ITEM' || workItemId || runId || workflowStepId) {
    return buildFollowUpResponse({
      history: normalizedHistory,
      trimmedLatestMessage,
      effectiveMessage: [
        `Follow-up reply in the same ${scopeLabel}.`,
        `Operator reply: ${trimmedLatestMessage}`,
      ].join('\n'),
      effectiveMessageSource: 'active-work-scope',
      followUpIntent: 'active-work-scope',
      followUpContextPrompt: [
        'Follow-up continuity context:',
        `Treat the latest user message as a continuation inside the same ${scopeLabel}.`,
        `Latest user follow-up reply:\n${trimmedLatestMessage}`,
      ].join('\n\n'),
      followUpBindingMode: 'active-work-scope',
    });
  }

  return buildFollowUpResponse({
    history: normalizedHistory,
    trimmedLatestMessage,
    effectiveMessage: trimmedLatestMessage,
    effectiveMessageSource: 'raw-user',
    followUpIntent: 'none',
    followUpBindingMode: 'none',
  });
};

export const buildUnifiedChatContextPrompt = ({
  liveContext,
  followUpContextPrompt,
  evidencePrompt,
}: {
  liveContext?: string;
  followUpContextPrompt?: string;
  evidencePrompt?: string;
}) =>
  [
    liveContext?.trim() ? `Live work context:\n${liveContext.trim()}` : null,
    followUpContextPrompt?.trim() ? followUpContextPrompt.trim() : null,
    evidencePrompt?.trim() ? evidencePrompt.trim() : null,
  ]
    .filter(Boolean)
    .join('\n\n');
