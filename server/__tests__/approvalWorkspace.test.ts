// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { __approvalWorkspaceTestUtils } from '../approvalWorkspace';
import type {
  ApprovalClarificationRequest,
  ApprovalClarificationResponse,
  Artifact,
  CapabilityInteractionFeed,
  RunWait,
  WorkItem,
} from '../../src/types';

const buildWorkItem = (): WorkItem =>
  ({
    id: 'WI-APPROVAL',
    capabilityId: 'CAP-1',
    workflowId: 'WF-1',
    title: 'Approve payment reconciliation change',
    description: 'Review the proposed payment reconciliation implementation.',
    phase: 'DEVELOPMENT',
    status: 'PENDING_APPROVAL',
    priority: 'High',
    tags: [],
    artifactIds: [],
    history: [],
    createdAt: '2026-04-19T10:00:00.000Z',
    updatedAt: '2026-04-19T10:00:00.000Z',
    taskType: 'FEATURE_DELIVERY',
  }) as unknown as WorkItem;

const buildWait = (): RunWait =>
  ({
    id: 'WAIT-1',
    capabilityId: 'CAP-1',
    runId: 'RUN-1',
    runStepId: 'STEP-1',
    type: 'APPROVAL',
    status: 'OPEN',
    message: 'Please verify the reconciliation logic and attached evidence.',
    requestedBy: 'Architect',
    createdAt: '2026-04-19T10:00:00.000Z',
    approvalDecisions: [
      {
        id: 'DECISION-1',
        capabilityId: 'CAP-1',
        runId: 'RUN-1',
        waitId: 'WAIT-1',
        disposition: 'REQUEST_CHANGES',
        actorDisplayName: 'Reviewer One',
        actorTeamIds: ['TEAM-1'],
        comment: 'Show why the fallback branch is safe before approval.',
        createdAt: '2026-04-19T10:10:00.000Z',
      },
    ],
  }) as unknown as RunWait;

const buildFeed = (): CapabilityInteractionFeed =>
  ({
    capabilityId: 'CAP-1',
    scope: 'WORK_ITEM',
    scopeId: 'WI-APPROVAL',
    generatedAt: '2026-04-19T10:15:00.000Z',
    summary: {
      totalCount: 4,
      chatCount: 1,
      toolCount: 1,
      waitCount: 1,
      approvalCount: 1,
      learningCount: 0,
      artifactCount: 1,
      taskCount: 0,
    },
    records: [
      {
        id: 'record-wait',
        capabilityId: 'CAP-1',
        interactionType: 'WAIT',
        title: 'Approval gate opened',
        summary: 'Waiting for a human decision.',
        timestamp: '2026-04-19T10:00:00.000Z',
        level: 'WARN',
      },
      {
        id: 'record-chat',
        capabilityId: 'CAP-1',
        interactionType: 'CHAT',
        title: 'Developer summary',
        summary: 'Implemented the reconciliation fallback and attached test notes.',
        timestamp: '2026-04-19T10:03:00.000Z',
        level: 'INFO',
        actorLabel: 'Software Developer',
      },
      {
        id: 'record-tool',
        capabilityId: 'CAP-1',
        interactionType: 'TOOL',
        title: 'Tests executed',
        summary: 'All targeted reconciliation checks passed.',
        timestamp: '2026-04-19T10:05:00.000Z',
        level: 'SUCCESS',
      },
      {
        id: 'record-approval',
        capabilityId: 'CAP-1',
        interactionType: 'APPROVAL',
        title: 'Reviewer requested changes',
        summary: 'Fallback safety needs stronger justification.',
        timestamp: '2026-04-19T10:10:00.000Z',
        level: 'WARN',
      },
    ],
  }) as CapabilityInteractionFeed;

const buildArtifacts = (): Artifact[] =>
  [
    {
      id: 'ART-1',
      capabilityId: 'CAP-1',
      workItemId: 'WI-APPROVAL',
      runId: 'RUN-1',
      runStepId: 'STEP-1',
      type: 'PHASE_OUTPUT',
      name: 'Reconciliation evidence',
      summary: 'Execution logs and test output for the reconciliation path.',
      artifactKind: 'PHASE_OUTPUT',
      direction: 'OUTPUT',
      version: 1,
      agent: 'Software Developer',
      created: '2026-04-19T10:04:00.000Z',
    },
  ] as unknown as Artifact[];

const buildClarificationRequests = (): ApprovalClarificationRequest[] => [
  {
    id: 'REQ-1',
    capabilityId: 'CAP-1',
    runId: 'RUN-1',
    waitId: 'WAIT-1',
    targetAgentId: 'AGENT-1',
    targetAgentName: 'Architect',
    summary: 'Clarify why the fallback branch is safe.',
    clarificationQuestions: ['Why is the fallback branch safe under retry conditions?'],
    requestedBy: 'Reviewer One',
    requestedAt: '2026-04-19T10:12:00.000Z',
    status: 'PENDING_RESPONSE',
  },
];

const buildClarificationResponses = (): ApprovalClarificationResponse[] => [
  {
    id: 'RESP-1',
    capabilityId: 'CAP-1',
    runId: 'RUN-1',
    waitId: 'WAIT-1',
    requestId: 'REQ-1',
    agentId: 'AGENT-1',
    agentName: 'Architect',
    content: '',
    createdAt: '2026-04-19T10:13:00.000Z',
    error: 'The agent response timed out before clarifications were generated.',
  },
];

describe('approval workspace packet mining', () => {
  it('builds a deterministic summary from waits, artifacts, chat, and clarification state', () => {
    const summary = __approvalWorkspaceTestUtils.mineApprovalDeterministicSummary({
      workItem: buildWorkItem(),
      wait: buildWait(),
      feed: buildFeed(),
      artifacts: buildArtifacts(),
      clarificationRequests: buildClarificationRequests(),
      clarificationResponses: buildClarificationResponses(),
      explainHeadline: 'Implementation is complete and waiting for sign-off.',
    });

    expect(summary.approvalSummary).toContain('Approve payment reconciliation change');
    expect(summary.approvalSummary).toContain('Please verify the reconciliation logic');
    expect(summary.keyEvents.some(item => item.includes('Approval gate opened'))).toBe(true);
    expect(summary.keyClaims.some(item => item.includes('Developer summary'))).toBe(true);
    expect(
      summary.evidenceHighlights.some(item => item.includes('Reconciliation evidence')),
    ).toBe(true);
    expect(
      summary.openQuestions.some(item =>
        item.includes('Why is the fallback branch safe under retry conditions?'),
      ),
    ).toBe(true);
    expect(
      summary.unresolvedConcerns.some(item =>
        item.includes('Reviewer One requested changes'),
      ),
    ).toBe(true);
    expect(
      summary.unresolvedConcerns.some(item =>
        item.includes('timed out before clarifications were generated'),
      ),
    ).toBe(true);
  });
});
