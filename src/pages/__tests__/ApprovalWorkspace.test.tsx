import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApprovalWorkspace from '../ApprovalWorkspace';
import type { ApprovalWorkspaceContext, ApprovalStructuredPacket } from '../../types';

const mockUseCapability = vi.fn();
const mockSuccess = vi.fn();
const mockError = vi.fn();
const mockFetchApprovalWorkspaceContext = vi.fn();
const mockRefreshApprovalWorkspacePacket = vi.fn();
const mockSendBackApprovalForClarification = vi.fn();
const mockApproveCapabilityWorkflowRun = vi.fn();
const mockRequestCapabilityWorkflowRunChanges = vi.fn();

vi.mock('../../context/CapabilityContext', () => ({
  useCapability: () => mockUseCapability(),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({
    success: mockSuccess,
    error: mockError,
  }),
}));

vi.mock('../../components/ArtifactPreview', () => ({
  default: ({ content }: { content?: string }) => <div data-testid="artifact-preview">{content}</div>,
}));

vi.mock('../../components/InteractionTimeline', () => ({
  default: () => <div>Interaction timeline</div>,
}));

vi.mock('../../lib/api', () => ({
  fetchApprovalWorkspaceContext: (...args: unknown[]) => mockFetchApprovalWorkspaceContext(...args),
  refreshApprovalWorkspacePacket: (...args: unknown[]) => mockRefreshApprovalWorkspacePacket(...args),
  sendBackApprovalForClarification: (...args: unknown[]) =>
    mockSendBackApprovalForClarification(...args),
  approveCapabilityWorkflowRun: (...args: unknown[]) => mockApproveCapabilityWorkflowRun(...args),
  requestCapabilityWorkflowRunChanges: (...args: unknown[]) =>
    mockRequestCapabilityWorkflowRunChanges(...args),
}));

const permissionSet = {
  actorUserId: 'USR-1',
  actorDisplayName: 'Workspace Operator',
  capabilityId: 'CAP-1',
  workspaceRoles: [],
  capabilityRoles: [],
  allowedActions: ['workitem.read', 'artifact.read', 'approval.decide'],
  visibilityScope: 'LIVE_DETAIL',
  inheritedRollupAccess: [],
  explicitDescendantGrantIds: [],
  reasoning: [],
} as const;

const structuredPacket: ApprovalStructuredPacket = {
  waitId: 'WAIT-1',
  generatedAt: '2026-04-20T02:00:00.000Z',
  sourceFingerprint: 'fingerprint-1',
  artifactId: 'ART-PACKET',
  fileName: 'approval-packet.md',
  contentText: '# Approval packet',
  deterministic: {
    approvalSummary: 'Deterministic approval summary.',
    keyEvents: ['Approval wait opened.'],
    keyClaims: ['Developer says the fallback branch is safe.'],
    evidenceHighlights: ['Code diff attached.'],
    openQuestions: ['Why is the fallback branch safe?'],
    unresolvedConcerns: ['Retry handling still needs explicit proof.'],
    chatExcerpts: [
      {
        id: 'EXCERPT-1',
        title: 'Architect claim',
        timestamp: '2026-04-20T02:00:00.000Z',
        excerpt: 'The fallback branch is safe because retries are idempotent.',
      },
    ],
  },
  aiSummary: {
    status: 'READY',
    generatedAt: '2026-04-20T02:01:00.000Z',
    model: 'gpt-5.4',
    summary: 'AI summary of the approval packet.',
    topRisks: ['Retry semantics are not demonstrated in tests.'],
    missingEvidence: ['Attach retry proof.'],
    disagreements: ['Reviewer still wants stronger operational proof.'],
    suggestedClarifications: ['Show the retry path and evidence.'],
  },
};

const buildContext = (): ApprovalWorkspaceContext =>
  ({
    capabilityId: 'CAP-1',
    capabilityName: 'Rule Engine',
    runId: 'RUN-1',
    waitId: 'WAIT-1',
    workItem: {
      id: 'WI-1',
      title: 'Implement NOT_CONTAINS',
      description: 'Work item description',
      capabilityId: 'CAP-1',
      workflowId: 'WF-1',
      phase: 'DEVELOPMENT',
      status: 'PENDING_APPROVAL',
      priority: 'High',
      tags: [],
      history: [],
    },
    run: {
      id: 'RUN-1',
      capabilityId: 'CAP-1',
      workItemId: 'WI-1',
      workflowId: 'WF-1',
      status: 'WAITING_APPROVAL',
      attemptNumber: 1,
      workflowSnapshot: {
        id: 'WF-1',
        name: 'Workflow',
        description: 'Workflow description',
        status: 'PUBLISHED',
        steps: [],
        createdAt: '2026-04-20T01:00:00.000Z',
        updatedAt: '2026-04-20T01:00:00.000Z',
      },
      createdAt: '2026-04-20T01:00:00.000Z',
      updatedAt: '2026-04-20T02:00:00.000Z',
    },
    runStep: {
      id: 'RUNSTEP-1',
      workflowStepId: 'STEP-1',
      status: 'WAITING',
      name: 'Developer review',
      stepType: 'HUMAN_APPROVAL',
      phase: 'DEVELOPMENT',
      startedAt: '2026-04-20T01:30:00.000Z',
      updatedAt: '2026-04-20T02:00:00.000Z',
    },
    approvalWait: {
      id: 'WAIT-1',
      capabilityId: 'CAP-1',
      runId: 'RUN-1',
      runStepId: 'RUNSTEP-1',
      type: 'APPROVAL',
      status: 'OPEN',
      message: 'Review the generated patch and evidence.',
      requestedBy: 'AGENT-1',
      createdAt: '2026-04-20T02:00:00.000Z',
      approvalAssignments: [
        {
          id: 'ASSIGN-1',
          capabilityId: 'CAP-1',
          runId: 'RUN-1',
          waitId: 'WAIT-1',
          targetType: 'TEAM',
          targetId: 'TEAM-1',
          status: 'PENDING',
          createdAt: '2026-04-20T02:00:00.000Z',
          updatedAt: '2026-04-20T02:00:00.000Z',
        },
      ],
      approvalDecisions: [],
    },
    interactionFeed: {
      summary: {
        totalCount: 0,
        chatCount: 0,
        toolCount: 0,
        waitCount: 0,
        approvalCount: 0,
        learningCount: 0,
        artifactCount: 0,
        taskCount: 0,
      },
      records: [],
    },
    artifacts: [
      {
        id: 'ART-TEXT',
        capabilityId: 'CAP-1',
        workItemId: 'WI-1',
        runId: 'RUN-1',
        type: 'PHASE_OUTPUT',
        artifactKind: 'PHASE_OUTPUT',
        name: 'Implementation summary',
        description: 'Summary artifact',
        summary: 'Implementation summary',
        contentText: '# Summary',
        contentFormat: 'MARKDOWN',
        direction: 'OUTPUT',
        version: 1,
        agent: 'Developer',
        created: '2026-04-20T02:00:00.000Z',
      },
      {
        id: 'ART-DIFF',
        capabilityId: 'CAP-1',
        workItemId: 'WI-1',
        runId: 'RUN-1',
        type: 'CODE_PATCH',
        artifactKind: 'CODE_PATCH',
        name: 'Generated diff',
        description: 'Diff artifact',
        summary: 'Diff summary',
        contentText: 'diff --git a/file.ts b/file.ts',
        contentFormat: 'TEXT',
        direction: 'OUTPUT',
        version: 1,
        agent: 'Developer',
        created: '2026-04-20T02:00:00.000Z',
      },
    ],
    codeDiffArtifact: {
      id: 'ART-DIFF',
      capabilityId: 'CAP-1',
      workItemId: 'WI-1',
      runId: 'RUN-1',
      type: 'CODE_PATCH',
      artifactKind: 'CODE_PATCH',
      name: 'Generated diff',
      description: 'Diff artifact',
      summary: 'Diff summary',
      contentText: 'diff --git a/file.ts b/file.ts',
      contentFormat: 'TEXT',
      direction: 'OUTPUT',
      version: 1,
      agent: 'Developer',
      created: '2026-04-20T02:00:00.000Z',
    },
    selectedArtifactId: 'ART-TEXT',
    availableAgents: [
      {
        id: 'AGENT-DEV',
        name: 'Developer',
        role: 'SOFTWARE-DEVELOPER',
      },
    ],
    currentPhaseLabel: 'Development',
    currentStepName: 'Developer review',
    requestedByLabel: 'Architect',
    requestedAt: '2026-04-20T02:00:00.000Z',
    structuredPacket,
    clarificationRequests: [],
    clarificationResponses: [],
    clarificationStatus: 'IDLE',
  }) as unknown as ApprovalWorkspaceContext;

describe('ApprovalWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.requestAnimationFrame = vi.fn(callback => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    mockUseCapability.mockReturnValue({
      activeCapability: {
        id: 'CAP-1',
        name: 'Rule Engine',
        effectivePermissions: permissionSet,
      },
      capabilities: [
        {
          id: 'CAP-1',
          name: 'Rule Engine',
          effectivePermissions: permissionSet,
        },
      ],
      setActiveCapability: vi.fn(),
      refreshCapabilityBundle: vi.fn().mockResolvedValue(null),
      workspaceOrganization: {
        users: [{ id: 'USR-1', name: 'Workspace Operator' }],
        teams: [{ id: 'TEAM-1', name: 'Brokerage Team' }],
      },
      currentActorContext: {
        userId: 'USR-1',
        displayName: 'Workspace Operator',
        workspaceRoles: ['WORKSPACE_ADMIN'],
        teamIds: ['TEAM-1'],
      },
    });
    mockFetchApprovalWorkspaceContext.mockResolvedValue(buildContext());
    mockRefreshApprovalWorkspacePacket.mockResolvedValue(structuredPacket);
    mockSendBackApprovalForClarification.mockResolvedValue({
      ...buildContext(),
      clarificationStatus: 'RESPONDED',
      clarificationRequests: [
        {
          id: 'REQ-1',
          capabilityId: 'CAP-1',
          runId: 'RUN-1',
          waitId: 'WAIT-1',
          targetAgentId: 'AGENT-DEV',
          targetAgentName: 'Developer',
          summary: 'Clarify retry safety',
          clarificationQuestions: ['Show retry proof'],
          requestedBy: 'Workspace Operator',
          requestedAt: '2026-04-20T02:05:00.000Z',
          status: 'RESPONDED',
        },
      ],
      clarificationResponses: [
        {
          id: 'RESP-1',
          capabilityId: 'CAP-1',
          runId: 'RUN-1',
          waitId: 'WAIT-1',
          requestId: 'REQ-1',
          agentId: 'AGENT-DEV',
          agentName: 'Developer',
          content: 'Attached retry proof and clarification.',
          createdAt: '2026-04-20T02:06:00.000Z',
        },
      ],
    } as ApprovalWorkspaceContext);
  });

  it('hydrates the approval page, refreshes the packet, and sends back clarifications in place', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/work/approvals/CAP-1/RUN-1/WAIT-1']}>
        <Routes>
          <Route
            path="/work/approvals/:capabilityId/:runId/:waitId"
            element={<ApprovalWorkspace />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Implement NOT_CONTAINS')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockFetchApprovalWorkspaceContext).toHaveBeenCalledWith('CAP-1', 'RUN-1', 'WAIT-1');
      expect(mockRefreshApprovalWorkspacePacket).toHaveBeenCalledWith('CAP-1', 'RUN-1', 'WAIT-1');
    });

    await user.click(screen.getByRole('button', { name: /Open code diff artifact/i }));
    expect(screen.getAllByTestId('artifact-preview')[1]).toHaveTextContent(
      'diff --git a/file.ts b/file.ts',
    );

    await user.type(
      screen.getByPlaceholderText(/Explain what the reviewer disagrees with/i),
      'Clarify retry safety',
    );
    await user.type(
      screen.getByPlaceholderText(/One requested change or question per line/i),
      'Show retry proof',
    );
    await user.click(screen.getByRole('button', { name: /Send back to Developer/i }));

    await waitFor(() => {
      expect(mockSendBackApprovalForClarification).toHaveBeenCalledWith('CAP-1', 'RUN-1', 'WAIT-1', {
        targetAgentId: 'AGENT-DEV',
        summary: 'Clarify retry safety',
        clarificationQuestions: ['Show retry proof'],
        note: undefined,
      });
    });

    expect(await screen.findByText('Attached retry proof and clarification.')).toBeInTheDocument();
  });
});
