// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type {
  ApprovalStructuredPacketDeterministicSummary,
  MemorySearchResult,
} from '../../src/types';
import {
  buildBudgetedMemoryPrompt,
  buildBudgetedSectionPrompt,
  buildDeterministicChatRollup,
  compactApprovalDeterministicSummary,
  resolveTokenOptimizationPolicy,
} from '../tokenOptimization';

const buildMemoryResult = (overrides?: Partial<MemorySearchResult>): MemorySearchResult =>
  ({
    reference: {
      id: `REF-${Math.random().toString(36).slice(2, 8)}`,
      capabilityId: 'CAP-MEM',
      documentId: 'DOC-1',
      sourceType: 'ARTIFACT',
      tier: 'CAPABILITY',
      title: 'Memory Reference',
      sourceId: 'SRC-1',
      semanticScore: 0.92,
      rerankScore: 0.88,
      createdAt: '2026-04-22T12:00:00.000Z',
      updatedAt: '2026-04-22T12:00:00.000Z',
    },
    document: {
      id: 'DOC-1',
      capabilityId: 'CAP-MEM',
      title: 'Memory Reference',
      sourceType: 'ARTIFACT',
      tier: 'CAPABILITY',
      contentPreview: 'preview',
      createdAt: '2026-04-22T12:00:00.000Z',
      updatedAt: '2026-04-22T12:00:00.000Z',
    },
    chunk: {
      id: 'CHUNK-1',
      capabilityId: 'CAP-MEM',
      documentId: 'DOC-1',
      chunkIndex: 0,
      content: 'alpha '.repeat(300),
      tokenEstimate: 300,
      createdAt: '2026-04-22T12:00:00.000Z',
    },
    ...overrides,
  }) as MemorySearchResult;

describe('tokenOptimization helpers', () => {
  it('keeps the latest user message when chat fragments overflow budget', () => {
    const result = buildBudgetedSectionPrompt({
      protectedFragments: [
        {
          source: 'SYSTEM_CORE',
          text: 'You are a careful agent.',
        },
      ],
      promptFragments: [
        {
          source: 'CONVERSATION_HISTORY',
          text: 'Earlier conversation:\n' + 'history '.repeat(500),
        },
        {
          source: 'LATEST_USER_MESSAGE',
          text: 'Latest user request:\nStart writing the fix now.',
        },
      ],
      maxInputTokens: 120,
    });

    expect(result.prompt).toContain('Start writing the fix now.');
    expect(result.receipt.included.some(fragment => fragment.source === 'LATEST_USER_MESSAGE')).toBe(true);
    expect(result.receipt.evicted.some(fragment => fragment.source === 'CONVERSATION_HISTORY')).toBe(true);
  });

  it('builds a token-capped memory prompt with truncated chunk content', () => {
    const prompt = buildBudgetedMemoryPrompt({
      results: [
        buildMemoryResult(),
        buildMemoryResult({
          document: {
            id: 'DOC-2',
            capabilityId: 'CAP-MEM',
            title: 'Second Memory',
            sourceType: 'ARTIFACT',
            tier: 'CAPABILITY',
            contentPreview: 'preview',
            createdAt: '2026-04-22T12:00:00.000Z',
            updatedAt: '2026-04-22T12:00:00.000Z',
          } as any,
          chunk: {
            id: 'CHUNK-2',
            capabilityId: 'CAP-MEM',
            documentId: 'DOC-2',
            chunkIndex: 0,
            content: 'beta '.repeat(250),
            tokenEstimate: 250,
            createdAt: '2026-04-22T12:00:00.000Z',
          } as any,
        }),
      ],
      maxPromptTokens: 180,
      perChunkMaxTokens: 40,
    });

    expect(prompt).toContain('[Memory 1]');
    expect(prompt).toContain('truncated for token budget');
  });

  it('compacts approval packet excerpts without dropping the deterministic structure', () => {
    const deterministic: ApprovalStructuredPacketDeterministicSummary = {
      approvalSummary: 'summary '.repeat(120),
      keyEvents: ['event '.repeat(80)],
      keyClaims: ['claim '.repeat(80)],
      evidenceHighlights: ['evidence '.repeat(80)],
      openQuestions: ['question '.repeat(80)],
      unresolvedConcerns: ['concern '.repeat(80)],
      chatExcerpts: [
        {
          id: 'EX-1',
          title: 'Very long approval discussion title '.repeat(10),
          timestamp: '2026-04-22T12:00:00.000Z',
          excerpt: 'excerpt '.repeat(120),
        },
      ],
    };

    const compacted = compactApprovalDeterministicSummary({
      deterministic,
      excerptMaxChars: 120,
    });

    expect(compacted.approvalSummary.length).toBeLessThan(deterministic.approvalSummary.length);
    expect(compacted.keyEvents[0]?.length).toBeLessThan(deterministic.keyEvents[0]!.length);
    expect(compacted.chatExcerpts[0]?.excerpt.length).toBeLessThan(
      deterministic.chatExcerpts[0]!.excerpt.length,
    );
    expect(compacted.openQuestions).toHaveLength(1);
  });

  it('builds a structured deterministic chat rollup with blockers and files in play', () => {
    const rollup = buildDeterministicChatRollup([
      {
        role: 'user',
        content: 'Please update src/main/java/org/example/rules/Operator.java to support ENDS_WITH.',
      },
      {
        role: 'assistant',
        content: 'I updated src/main/java/org/example/rules/RuleEngineService.java and added test evidence.',
      },
      {
        role: 'user',
        content: 'The build is blocked while waiting for approval on the QA evidence packet.',
      },
    ]);

    expect(rollup).toContain('currentGoal');
    expect(rollup).toContain('currentBlocker');
    expect(rollup).toContain('Operator.java');
    expect(rollup).toContain('RuleEngineService.java');
  });

  it('merges conservative default token settings into capability execution config', () => {
    const policy = resolveTokenOptimizationPolicy({
      executionConfig: {
        defaultWorkspacePath: '/workspace/demo',
        allowedWorkspacePaths: [],
        commandTemplates: [],
        deploymentTargets: [],
        tokenOptimization: {
          chatMaxInputTokens: 9000,
        },
      },
    } as any);

    expect(policy.chatMaxInputTokens).toBe(9000);
    expect(policy.chatHistoryKeepLastN).toBeGreaterThan(0);
    expect(policy.approvalSynthesisMaxInputTokens).toBeGreaterThan(0);
  });
});
