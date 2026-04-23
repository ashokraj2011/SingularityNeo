import type {
  ApprovalStructuredPacketDeterministicSummary,
  Capability,
  MemorySearchResult,
} from '../src/types';
import {
  buildBudgetedPrompt,
  type BudgetFragment,
  type BudgetReceipt,
  type ContextSource,
} from './execution/contextBudget';
import {
  estimateTokens,
  normalizeProviderForEstimate,
  type TokenEstimateKind,
} from './execution/tokenEstimate';
import { normalizeProviderKey } from './providerRegistry';

export interface ResolvedTokenOptimizationPolicy {
  chatHistoryKeepLastN: number;
  chatRollupThreshold: number;
  chatMaxInputTokens: number;
  memoryPromptMaxTokens: number;
  memoryChunkMaxTokens: number;
  approvalSynthesisMaxInputTokens: number;
  approvalExcerptMaxChars: number;
}

export interface ChatTurnLike {
  role: 'assistant' | 'user';
  content: string;
}

type SectionFragment = {
  source: ContextSource;
  text: string;
  priority?: number;
  meta?: Record<string, unknown>;
};

const DEFAULT_TOKEN_POLICY: ResolvedTokenOptimizationPolicy = {
  chatHistoryKeepLastN: 6,
  chatRollupThreshold: 12,
  chatMaxInputTokens: 12_000,
  memoryPromptMaxTokens: 2_200,
  memoryChunkMaxTokens: 350,
  approvalSynthesisMaxInputTokens: 8_000,
  approvalExcerptMaxChars: 420,
};

const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, ' ').trim();

const toPositiveInteger = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.floor(numeric);
};

const readEnvNumber = (name: string) => toPositiveInteger(process.env[name]);

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const resolveTokenOptimizationPolicy = (
  capability?: Partial<Capability> | null,
): ResolvedTokenOptimizationPolicy => {
  const config = capability?.executionConfig?.tokenOptimization || {};

  return {
    chatHistoryKeepLastN: clamp(
      toPositiveInteger(config.chatHistoryKeepLastN) ??
        readEnvNumber('SINGULARITY_CHAT_HISTORY_KEEP_LAST_N') ??
        DEFAULT_TOKEN_POLICY.chatHistoryKeepLastN,
      2,
      12,
    ),
    chatRollupThreshold: clamp(
      toPositiveInteger(config.chatRollupThreshold) ??
        readEnvNumber('SINGULARITY_CHAT_ROLLUP_THRESHOLD') ??
        DEFAULT_TOKEN_POLICY.chatRollupThreshold,
      4,
      24,
    ),
    chatMaxInputTokens: clamp(
      toPositiveInteger(config.chatMaxInputTokens) ??
        readEnvNumber('SINGULARITY_CHAT_MAX_INPUT_TOKENS') ??
        DEFAULT_TOKEN_POLICY.chatMaxInputTokens,
      2_000,
      128_000,
    ),
    memoryPromptMaxTokens: clamp(
      toPositiveInteger(config.memoryPromptMaxTokens) ??
        readEnvNumber('SINGULARITY_MEMORY_PROMPT_MAX_TOKENS') ??
        DEFAULT_TOKEN_POLICY.memoryPromptMaxTokens,
      250,
      16_000,
    ),
    memoryChunkMaxTokens: clamp(
      toPositiveInteger(config.memoryChunkMaxTokens) ??
        readEnvNumber('SINGULARITY_MEMORY_CHUNK_MAX_TOKENS') ??
        DEFAULT_TOKEN_POLICY.memoryChunkMaxTokens,
      80,
      4_000,
    ),
    approvalSynthesisMaxInputTokens: clamp(
      toPositiveInteger(config.approvalSynthesisMaxInputTokens) ??
        readEnvNumber('SINGULARITY_APPROVAL_SYNTHESIS_MAX_INPUT_TOKENS') ??
        DEFAULT_TOKEN_POLICY.approvalSynthesisMaxInputTokens,
      1_500,
      64_000,
    ),
    approvalExcerptMaxChars: clamp(
      toPositiveInteger(config.approvalExcerptMaxChars) ??
        readEnvNumber('SINGULARITY_APPROVAL_EXCERPT_MAX_CHARS') ??
        DEFAULT_TOKEN_POLICY.approvalExcerptMaxChars,
      120,
      4_000,
    ),
  };
};

const toEstimatedTokens = (
  text: string,
  providerKey?: string,
  model?: string,
  kind: TokenEstimateKind = 'prose',
) =>
  estimateTokens(text, {
    provider: normalizeProviderForEstimate(
      normalizeProviderKey(providerKey) || providerKey,
      model,
    ),
    model,
    kind,
  });

export const truncateTextToTokenBudget = ({
  text,
  maxTokens,
  providerKey,
  model,
  kind = 'prose',
}: {
  text: string;
  maxTokens: number;
  providerKey?: string;
  model?: string;
  kind?: TokenEstimateKind;
}) => {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return '';
  }

  if (toEstimatedTokens(normalized, providerKey, model, kind) <= maxTokens) {
    return normalized;
  }

  const suffix = '\n...[truncated for token budget]';
  let low = 0;
  let high = normalized.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${normalized.slice(0, mid).trimEnd()}${suffix}`;
    if (toEstimatedTokens(candidate, providerKey, model, kind) <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best || suffix.trim();
};

export const renderChatTranscript = (
  turns: ChatTurnLike[],
  options?: {
    maxTurns?: number;
    maxCharsPerTurn?: number;
  },
) => {
  const maxTurns = options?.maxTurns ?? turns.length;
  const maxCharsPerTurn = options?.maxCharsPerTurn ?? 280;
  return turns
    .slice(-maxTurns)
    .map(turn => {
      const label = turn.role === 'assistant' ? 'Assistant' : 'User';
      const content = normalizeWhitespace(turn.content || '').slice(0, maxCharsPerTurn);
      return `${label}:\n${content}`;
    })
    .join('\n\n');
};

const findLastTurn = (turns: ChatTurnLike[], role: ChatTurnLike['role']) =>
  [...turns].reverse().find(turn => turn.role === role && turn.content.trim());

const findBlockerSnippet = (turns: ChatTurnLike[], maxChars = 220) => {
  const blockerPattern =
    /\b(blocked|stuck|waiting|approval|approve|clarif|need|needs|missing|error|failed|cannot|can't|unable|risk)\b/i;
  const match = [...turns]
    .reverse()
    .find(turn => blockerPattern.test(turn.content || ''));
  return match ? normalizeWhitespace(match.content).slice(0, maxChars) : null;
};

const findPendingDecision = (turns: ChatTurnLike[], maxChars = 220) => {
  const decisionPattern =
    /\b(decide|decision|confirm|choose|approval|approve|review|question|clarify|next step)\b/i;
  const match = [...turns]
    .reverse()
    .find(turn => decisionPattern.test(turn.content || ''));
  return match ? normalizeWhitespace(match.content).slice(0, maxChars) : null;
};

const extractLikelyFiles = (turns: ChatTurnLike[]) => {
  const filePattern =
    /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+/g;
  const matches = turns.flatMap(turn => turn.content.match(filePattern) || []);
  return [...new Set(matches)].slice(0, 6);
};

const extractEvidenceSnippets = (turns: ChatTurnLike[], maxChars = 180) => {
  const evidencePattern = /\b(test|artifact|evidence|log|diff|packet|build|screenshot|output)\b/i;
  return [...new Set(
    turns
      .filter(turn => evidencePattern.test(turn.content || ''))
      .map(turn => normalizeWhitespace(turn.content).slice(0, maxChars))
      .filter(Boolean),
  )].slice(0, 4);
};

export const buildDeterministicChatRollup = (
  turns: ChatTurnLike[],
  options?: {
    maxChars?: number;
  },
) => {
  if (turns.length === 0) {
    return '';
  }

  const maxChars = options?.maxChars ?? 220;
  const latestUser = findLastTurn(turns, 'user');
  const latestAssistant = findLastTurn(turns, 'assistant');
  const payload = {
    currentGoal: latestUser
      ? normalizeWhitespace(latestUser.content).slice(0, maxChars)
      : 'No explicit user goal recorded yet.',
    lastSuccessfulAction: latestAssistant
      ? normalizeWhitespace(latestAssistant.content).slice(0, maxChars)
      : 'No assistant action has been recorded yet.',
    currentBlocker: findBlockerSnippet(turns, maxChars),
    filesInPlay: extractLikelyFiles(turns),
    pendingDecision: findPendingDecision(turns, maxChars),
    evidenceGenerated: extractEvidenceSnippets(turns, Math.min(maxChars, 180)),
  };

  return `Earlier conversation state note:\n${JSON.stringify(payload, null, 2)}`;
};

export const buildBudgetedSectionPrompt = ({
  protectedFragments,
  promptFragments,
  maxInputTokens,
  reservedOutputTokens = 0,
  providerKey,
  model,
  joiner = '\n\n',
}: {
  protectedFragments?: SectionFragment[];
  promptFragments: SectionFragment[];
  maxInputTokens: number;
  reservedOutputTokens?: number;
  providerKey?: string;
  model?: string;
  joiner?: string;
}): {
  prompt: string;
  receipt: BudgetReceipt;
  includedSources: ContextSource[];
} => {
  const protectedBudgetFragments: BudgetFragment[] = (protectedFragments || [])
    .filter(fragment => fragment.text.trim())
    .map(fragment => ({
      source: fragment.source,
      text: fragment.text,
      priority: fragment.priority,
      meta: fragment.meta,
      estimatedTokens: toEstimatedTokens(fragment.text, providerKey, model),
    }));

  const protectedTokens = protectedBudgetFragments.reduce(
    (sum, fragment) => sum + fragment.estimatedTokens,
    0,
  );
  const promptBudget = Math.max(1_000, maxInputTokens - protectedTokens);
  const budgetedPrompt = buildBudgetedPrompt({
    fragments: promptFragments
      .filter(fragment => fragment.text.trim())
      .map(fragment => ({
        source: fragment.source,
        text: fragment.text,
        priority: fragment.priority,
        meta: fragment.meta,
        estimatedTokens: toEstimatedTokens(fragment.text, providerKey, model),
      })),
    maxInputTokens: promptBudget,
    reservedOutputTokens,
    joiner,
  });

  const receipt: BudgetReceipt = {
    included: [
      ...protectedBudgetFragments.map(fragment => ({
        source: fragment.source,
        estimatedTokens: fragment.estimatedTokens,
        meta: fragment.meta,
      })),
      ...budgetedPrompt.receipt.included,
    ],
    evicted: budgetedPrompt.receipt.evicted,
    totalEstimatedTokens: protectedTokens + budgetedPrompt.receipt.totalEstimatedTokens,
    maxInputTokens,
    reservedOutputTokens,
  };

  return {
    prompt: budgetedPrompt.assembled,
    receipt,
    includedSources: receipt.included.map(fragment => fragment.source),
  };
};

export const buildBudgetedMemoryPrompt = ({
  results,
  providerKey,
  model,
  maxPromptTokens,
  perChunkMaxTokens,
}: {
  results: MemorySearchResult[];
  providerKey?: string;
  model?: string;
  maxPromptTokens: number;
  perChunkMaxTokens: number;
}) => {
  if (results.length === 0) {
    return '';
  }

  const budgeted = buildBudgetedPrompt({
    fragments: results.map((result, index) => {
      const header = [
        `[Memory ${index + 1}] ${result.document.title}`,
        `${result.document.sourceType}, ${result.document.tier}`,
      ].join(' (') + ')';
      const content = truncateTextToTokenBudget({
        text: result.chunk.content,
        maxTokens: perChunkMaxTokens,
        providerKey,
        model,
      });
      return {
        source: 'MEMORY_HITS' as const,
        text: `${header}\n${content}`,
        priority: 100 + (results.length - index),
        meta: {
          documentId: result.document.id,
          chunkId: result.chunk.id,
          rank: index + 1,
        },
        estimatedTokens: toEstimatedTokens(`${header}\n${content}`, providerKey, model),
      };
    }),
    maxInputTokens: maxPromptTokens,
  });

  return budgeted.assembled;
};

const compactList = (items: string[], excerptMaxChars: number, maxItems = 6) =>
  items
    .map(item => normalizeWhitespace(item || ''))
    .filter(Boolean)
    .slice(0, maxItems)
    .map(item => (item.length > excerptMaxChars ? `${item.slice(0, excerptMaxChars).trimEnd()}...` : item));

export const compactApprovalDeterministicSummary = ({
  deterministic,
  excerptMaxChars,
}: {
  deterministic: ApprovalStructuredPacketDeterministicSummary;
  excerptMaxChars: number;
}): ApprovalStructuredPacketDeterministicSummary => ({
  approvalSummary:
    deterministic.approvalSummary.length > excerptMaxChars * 2
      ? `${deterministic.approvalSummary.slice(0, excerptMaxChars * 2).trimEnd()}...`
      : deterministic.approvalSummary,
  keyEvents: compactList(deterministic.keyEvents, excerptMaxChars, 6),
  keyClaims: compactList(deterministic.keyClaims, excerptMaxChars, 6),
  evidenceHighlights: compactList(deterministic.evidenceHighlights, excerptMaxChars, 6),
  openQuestions: compactList(deterministic.openQuestions, excerptMaxChars, 6),
  unresolvedConcerns: compactList(deterministic.unresolvedConcerns, excerptMaxChars, 6),
  chatExcerpts: deterministic.chatExcerpts.slice(0, 4).map(excerpt => ({
    ...excerpt,
    title:
      excerpt.title.length > Math.floor(excerptMaxChars / 2)
        ? `${excerpt.title.slice(0, Math.floor(excerptMaxChars / 2)).trimEnd()}...`
        : excerpt.title,
    excerpt:
      excerpt.excerpt.length > excerptMaxChars
        ? `${excerpt.excerpt.slice(0, excerptMaxChars).trimEnd()}...`
        : excerpt.excerpt,
  })),
});
