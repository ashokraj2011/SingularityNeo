import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorApprovalReviewModal } from '../OrchestratorApprovalReviewModal';
import { OrchestratorDiffReviewModal } from '../OrchestratorDiffReviewModal';
import type { Artifact, ApprovalAssignment, ApprovalDecision, RunWait } from '../../../types';
import type { CapabilityInteractionFeed } from '../../../types';

const buildArtifact = (overrides: Partial<Artifact> = {}): Artifact =>
  ({
    id: 'ART-1',
    capabilityId: 'CAP-1',
    workItemId: 'WI-1',
    runId: 'RUN-1',
    runStepId: 'STEP-1',
    type: 'PHASE_OUTPUT',
    name: 'Implementation plan',
    description: 'Plan artifact',
    summary: 'Implementation plan summary',
    content: '# Plan',
    contentFormat: 'MARKDOWN',
    contentJson: null,
    direction: 'OUTPUT',
    version: 1,
    created: '2026-04-19T10:00:00.000Z',
    ...overrides,
  }) as Artifact;

const buildAssignment = (overrides: Partial<ApprovalAssignment> = {}): ApprovalAssignment =>
  ({
    id: 'ASSIGN-1',
    capabilityId: 'CAP-1',
    runId: 'RUN-1',
    runStepId: 'STEP-1',
    waitId: 'WAIT-1',
    targetType: 'TEAM',
    targetId: 'TEAM-1',
    status: 'PENDING',
    createdAt: '2026-04-19T10:00:00.000Z',
    ...overrides,
  }) as ApprovalAssignment;

const buildDecision = (overrides: Partial<ApprovalDecision> = {}): ApprovalDecision =>
  ({
    id: 'DECISION-1',
    capabilityId: 'CAP-1',
    runId: 'RUN-1',
    runStepId: 'STEP-1',
    waitId: 'WAIT-1',
    assignmentId: 'ASSIGN-1',
    actorType: 'USER',
    actorId: 'USR-1',
    actorDisplayName: 'Workspace Operator',
    disposition: 'APPROVE',
    createdAt: '2026-04-19T10:05:00.000Z',
    ...overrides,
  }) as ApprovalDecision;

const buildWait = (overrides: Partial<RunWait> = {}): RunWait =>
  ({
    id: 'WAIT-1',
    capabilityId: 'CAP-1',
    runId: 'RUN-1',
    runStepId: 'STEP-1',
    type: 'APPROVAL',
    status: 'OPEN',
    message: 'Please review the generated output.',
    requestedBy: 'AGENT-1',
    createdAt: '2026-04-19T10:00:00.000Z',
    approvalAssignments: [buildAssignment()],
    approvalDecisions: [buildDecision()],
    ...overrides,
  }) as RunWait;

const emptyFeed: CapabilityInteractionFeed = {
  summary: {
    totalCount: 0,
    chatCount: 0,
    toolCount: 0,
    artifactCount: 0,
    taskCount: 0,
    learningCount: 0,
  },
  records: [],
};

describe('OrchestratorApprovalReviewModal', () => {
  it('renders approval context and routes document actions through callbacks', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSelectApprovalArtifact = vi.fn();
    const onRequestChanges = vi.fn();

    render(
      <OrchestratorApprovalReviewModal
        workItemTitle="Implement orchestration fix"
        approvalWait={buildWait()}
        isHydrated
        onClose={onClose}
        currentPhaseLabel="Development"
        currentStepName="Build & Test"
        currentRunId="RUN-1"
        requestedByLabel="Architect"
        requestedAt="2026-04-19T10:00:00.000Z"
        totalDocuments={3}
        hasCodeDiffApproval
        approvalAssignments={[buildAssignment()]}
        approvalDecisionByAssignmentId={
          new Map([[ 'ASSIGN-1', buildDecision({ comment: 'Looks good.' }) ]])
        }
        unassignedApprovalDecisions={[]}
        workspaceUsersById={new Map([['USR-1', { name: 'Workspace Operator' }]])}
        workspaceTeamsById={new Map([['TEAM-1', { name: 'Brokerage Team' }]])}
        interactionFeed={emptyFeed}
        onOpenArtifactFromTimeline={vi.fn()}
        onOpenRunFromTimeline={vi.fn()}
        onOpenTaskFromTimeline={vi.fn()}
        filteredApprovalArtifacts={[buildArtifact()]}
        approvalArtifactFilter="ALL"
        onApprovalArtifactFilterChange={vi.fn()}
        selectedApprovalArtifact={buildArtifact()}
        selectedApprovalArtifactDocument="# Plan"
        onSelectApprovalArtifact={onSelectApprovalArtifact}
        resolutionNote=""
        onResolutionNoteChange={vi.fn()}
        resolutionPlaceholder="Add approval conditions"
        requestChangesIsAvailable
        canRequestChanges
        canResolveSelectedWait
        busyAction={null}
        onRequestChanges={onRequestChanges}
        onResolveWait={vi.fn()}
        actionButtonLabel="Approve and continue"
        onOpenDiffReview={vi.fn()}
        resetKey="WI-1:WAIT-1:ART-1"
      />,
    );

    expect(screen.getByText('Approval review · Implement orchestration fix')).toBeInTheDocument();
    expect(screen.getByText('Brokerage Team')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Implementation plan/ }));
    expect(onSelectApprovalArtifact).toHaveBeenCalledWith('ART-1');

    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(onRequestChanges).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText('Close approval review'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('OrchestratorDiffReviewModal', () => {
  it('renders the diff summary and closes from the extracted modal shell', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <OrchestratorDiffReviewModal
        selectedCodeDiffArtifact={buildArtifact({ name: 'Code diff', contentFormat: 'TEXT' })}
        selectedCodeDiffDocument="diff --git a/file.ts b/file.ts"
        summary="Touched the rule parser."
        repositoryCount={2}
        touchedFileCount={4}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('Touched the rule parser.')).toBeInTheDocument();
    expect(screen.getByText('Repositories:')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Close diff review'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
