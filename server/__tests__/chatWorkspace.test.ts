// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';
import { buildCapabilityBriefing } from '../../src/lib/capabilityBriefing';
import type {
  Capability,
  CapabilityAgent,
  CapabilityWorkspace,
  Workflow,
  WorkflowRunDetail,
  WorkItem,
} from '../../src/types';
import {
  buildWorkItemStageControlBriefing,
  buildLiveWorkspaceBriefing,
  maybeHandleCapabilityChatAction,
  resolveMentionedWorkItem,
} from '../chatWorkspace';
import { getStandardAgentContract } from '../../src/constants';
import { getWorkflowRunDetail } from '../execution/repository';
import {
  approveWorkflowRun,
  cancelWorkflowRun,
  moveWorkItemToPhaseControl,
  provideWorkflowRunInput,
  requestChangesWorkflowRun,
  resolveWorkflowRunConflict,
  restartWorkflowRun,
  startWorkflowExecution,
} from '../execution/service';
import { buildWorkItemExplainDetail } from '../workItemExplain';

vi.mock('../execution/repository', () => ({
  getWorkflowRunDetail: vi.fn(),
}));

vi.mock('../execution/service', () => ({
  approveWorkflowRun: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  moveWorkItemToPhaseControl: vi.fn(),
  provideWorkflowRunInput: vi.fn(),
  requestChangesWorkflowRun: vi.fn(),
  resolveWorkflowRunConflict: vi.fn(),
  restartWorkflowRun: vi.fn(),
  startWorkflowExecution: vi.fn(),
}));

vi.mock('../workItemExplain', () => ({
  buildWorkItemExplainDetail: vi.fn(),
}));

const buildCapability = (): Capability => ({
  id: 'CAP-CHAT',
  name: 'ToDoAPpp',
  description: 'Manage delivery for the todo application.',
  domain: 'Engineering',
  ownerTeam: 'Product Engineering',
  businessOutcome: 'Ship the next release with clear execution visibility.',
  successMetrics: ['Approval delays drop below 1 day.'],
  definitionOfDone: 'Work can move through delivery with visible evidence.',
  requiredEvidenceKinds: ['Handoff', 'Code diff'],
  operatingPolicySummary: 'High-impact changes require approval before release.',
  applications: [],
  apis: [],
  databases: [],
  databaseConfigs: [
    {
      id: 'DB-1',
      label: 'Primary Postgres',
      engine: 'POSTGRES',
      host: 'db.internal',
      databaseName: 'todo',
      authentication: 'SECRET_REFERENCE',
      secretReference: 'vault://todo/postgres',
      sslMode: 'REQUIRE',
    },
  ],
  gitRepositories: ['https://github.com/example/todo-app'],
  localDirectories: ['/repo/todo-app'],
  teamNames: ['Product Engineering'],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    defaultWorkspacePath: '/repo/todo-app',
    allowedWorkspacePaths: ['/repo/todo-app'],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: [],
});

const buildWorkflow = (): Workflow => ({
  id: 'WF-1',
  capabilityId: 'CAP-CHAT',
  name: 'Enterprise SDLC Flow',
  steps: [
    {
      id: 'STEP-1',
      name: 'Implementation',
      phase: 'DEVELOPMENT',
      stepType: 'DELIVERY',
      agentId: 'AGENT-DEV',
      action: 'Implement the requested change.',
    },
  ],
  status: 'STABLE',
});

const buildWorkItem = (): WorkItem => ({
  id: 'WI-123',
  title: 'Ship todo filters',
  description: 'Add status filters and saved views.',
  phase: 'DEVELOPMENT',
  capabilityId: 'CAP-CHAT',
  workflowId: 'WF-1',
  currentStepId: 'STEP-1',
  assignedAgentId: 'AGENT-DEV',
  status: 'PENDING_APPROVAL',
  priority: 'High',
  tags: ['release'],
  pendingRequest: {
    type: 'APPROVAL',
    message: 'Review implementation changes.',
    requestedBy: 'Software Developer',
    timestamp: '2026-04-12T08:00:00.000Z',
  },
  activeRunId: 'RUN-123',
  lastRunId: 'RUN-123',
  history: [
    {
      id: 'HIST-1',
      timestamp: '2026-04-12T08:00:00.000Z',
      actor: 'Software Developer',
      action: 'WAITING_APPROVAL',
      detail: 'Waiting for human approval before continuing.',
      phase: 'DEVELOPMENT',
      status: 'PENDING_APPROVAL',
    },
  ],
});

const buildWorkspace = (): CapabilityWorkspace => ({
  capabilityId: 'CAP-CHAT',
  briefing: buildCapabilityBriefing(buildCapability()),
  agents: [
    {
      id: 'AGENT-OWNER',
      capabilityId: 'CAP-CHAT',
      name: 'Capability Owner',
      role: 'Capability Owner',
      objective: 'Own the end-to-end delivery context.',
      contract: getStandardAgentContract('OWNER'),
      initializationStatus: 'READY',
      inputArtifacts: [],
      outputArtifacts: [],
      isOwner: true,
      isBuiltIn: true,
      standardTemplateKey: 'capability-owner',
      learningNotes: [],
      skillIds: [],
      provider: 'GitHub Copilot SDK',
      model: 'claude-sonnet-4.6',
      tokenLimit: 128000,
      systemPrompt: '',
      documentationSources: [],
      learningProfile: {
        status: 'READY',
        summary: 'Ready to help.',
        highlights: [],
        contextBlock: '',
        sourceDocumentIds: [],
        sourceArtifactIds: [],
        sourceCount: 0,
        refreshedAt: '2026-04-12T08:00:00.000Z',
      },
      sessionSummaries: [],
      usage: {
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
      previousOutputs: [],
    },
  ],
  workflows: [buildWorkflow()],
  artifacts: [],
  tasks: [],
  executionLogs: [],
  learningUpdates: [],
  workItems: [buildWorkItem()],
  messages: [],
  activeChatAgentId: 'AGENT-OWNER',
  createdAt: '2026-04-12T08:00:00.000Z',
});

const buildRunDetail = (): WorkflowRunDetail => ({
  run: {
    id: 'RUN-123',
    capabilityId: 'CAP-CHAT',
    workItemId: 'WI-123',
    workflowId: 'WF-1',
    status: 'WAITING_APPROVAL',
    attemptNumber: 1,
    workflowSnapshot: buildWorkflow(),
    currentStepId: 'STEP-1',
    currentNodeId: 'STEP-1',
    currentPhase: 'DEVELOPMENT',
    assignedAgentId: 'AGENT-DEV',
    branchState: {
      pendingNodeIds: ['STEP-1'],
      activeNodeIds: ['STEP-1'],
      completedNodeIds: [],
    },
    currentWaitId: 'WAIT-1',
    createdAt: '2026-04-12T08:00:00.000Z',
    updatedAt: '2026-04-12T08:00:00.000Z',
  },
  steps: [],
  waits: [
    {
      id: 'WAIT-1',
      capabilityId: 'CAP-CHAT',
      runId: 'RUN-123',
      runStepId: 'RUNSTEP-1',
      type: 'APPROVAL',
      status: 'OPEN',
      message: 'Review the developer changes before continuing.',
      requestedBy: 'Software Developer',
      createdAt: '2026-04-12T08:00:00.000Z',
      payload: {},
    },
  ],
  toolInvocations: [],
});

const buildBundle = () => ({
  capability: buildCapability(),
  workspace: buildWorkspace(),
});

const buildBlockedRunDetail = (): WorkflowRunDetail => ({
  run: {
    id: 'RUN-123',
    capabilityId: 'CAP-CHAT',
    workItemId: 'WI-123',
    workflowId: 'WF-1',
    status: 'FAILED',
    attemptNumber: 1,
    workflowSnapshot: buildWorkflow(),
    currentStepId: 'STEP-1',
    currentNodeId: 'STEP-1',
    currentPhase: 'DEVELOPMENT',
    assignedAgentId: 'AGENT-DEV',
    branchState: {
      pendingNodeIds: [],
      activeNodeIds: [],
      completedNodeIds: ['STEP-1'],
    },
    createdAt: '2026-04-12T08:00:00.000Z',
    updatedAt: '2026-04-12T08:15:00.000Z',
  },
  steps: [],
  waits: [],
  toolInvocations: [],
});

const activeAgent: Partial<CapabilityAgent> = {
  id: 'AGENT-OWNER',
  name: 'Capability Owner',
  role: 'Capability Owner',
};

const executionAgent: Partial<CapabilityAgent> = {
  id: 'AGENT-EXECUTION',
  name: 'Execution Agent',
  role: 'Execution Agent',
  standardTemplateKey: 'EXECUTION-OPS',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWorkflowRunDetail).mockResolvedValue(buildRunDetail());
  vi.mocked(buildWorkItemExplainDetail).mockResolvedValue({
    capabilityId: 'CAP-CHAT',
    generatedAt: '2026-04-12T08:00:00.000Z',
    workItem: buildWorkItem(),
    summary: {
      headline: 'Ship todo filters is waiting on approval.',
      blockingState: 'Review implementation changes.',
      nextAction: 'Approve the current run or request changes before continuation.',
      latestRunStatus: 'WAITING_APPROVAL',
    },
    releaseReadiness: {
      status: 'WAITING_APPROVAL',
      score: 72,
      dimensions: [],
      blockingReasons: ['Review implementation changes.'],
    },
    attemptDiff: {
      hasPreviousAttempt: false,
      currentAttemptNumber: 1,
      summary: 'This is the first tracked attempt for this work item, so there is no earlier attempt to compare yet.',
      stepProgressDelta: [],
      waitDelta: [],
      policyDelta: [],
      evidenceDelta: [],
      handoffDelta: [],
      toolDelta: [],
      humanDelta: [],
    },
    latestRun: buildRunDetail().run,
    previousRun: undefined,
    flightRecorder: {
      verdict: 'NEEDS_APPROVAL',
      verdictReason: 'Human review is still required.',
    },
    evidence: {
      artifactCount: 1,
      handoffCount: 1,
      phaseCount: 1,
      latestCompletedAt: undefined,
    },
    humanGates: [],
    policyDecisions: [],
    artifacts: [],
    handoffArtifacts: [],
    telemetry: {
      traceIds: [],
      toolInvocationCount: 0,
      failedToolInvocationCount: 0,
      totalToolLatencyMs: 0,
      totalToolCostUsd: 0,
      runConsolePath: '/runs/RUN-123',
    },
    connectors: {
      capabilityId: 'CAP-CHAT',
      github: {
        provider: 'GITHUB',
        status: 'READY',
        message: 'GitHub repositories are linked and the workspace connector is enabled.',
        syncedAt: '2026-04-12T08:00:00.000Z',
        repositories: [],
        pullRequests: [],
        issues: [],
      },
      jira: {
        provider: 'JIRA',
        status: 'NEEDS_CONFIGURATION',
        message: 'No Jira board or issue URL is linked to this capability yet.',
        syncedAt: '2026-04-12T08:00:00.000Z',
        issues: [],
      },
      confluence: {
        provider: 'CONFLUENCE',
        status: 'NEEDS_CONFIGURATION',
        message: 'No Confluence page is linked to this capability yet.',
        syncedAt: '2026-04-12T08:00:00.000Z',
        pages: [],
      },
    },
    reviewPacket: undefined,
  });
});

describe('chat workspace bridge', () => {
  it('builds a live briefing with capability metadata and delivery context', () => {
    const briefing = buildLiveWorkspaceBriefing(buildBundle());

    expect(briefing).toContain('Live capability context');
    expect(briefing).toContain('Business outcome: Ship the next release with clear execution visibility.');
    expect(briefing).toContain('Legacy workspace hints: /repo/todo-app');
    expect(briefing).toContain(
      'Work summary: 0 staged, 1 active, 0 blocked, 1 pending approval, 0 completed.',
    );
    expect(briefing).toContain('WI-123 | Ship todo filters | Development | PENDING_APPROVAL');
  });

  it('routes approval commands through the existing orchestration control path', async () => {
    vi.mocked(approveWorkflowRun).mockResolvedValue({
      run: {
        ...buildRunDetail().run,
        status: 'RUNNING',
      },
    } as WorkflowRunDetail);

    const result = await maybeHandleCapabilityChatAction({
      bundle: buildBundle(),
      agent: activeAgent,
      message: 'approve RUN-123: looks good, continue',
    });

    expect(result.handled).toBe(true);
    expect(result.changedState).toBe(true);
    expect(result.wakeWorker).toBe(true);
    expect(result.content).toContain('Approved WI-123 - Ship todo filters.');
    expect(approveWorkflowRun).toHaveBeenCalledWith({
      capabilityId: 'CAP-CHAT',
      runId: 'RUN-123',
      resolution: 'looks good, continue',
      resolvedBy: 'Capability Owner via chat',
    });
  });

  it('lets the execution agent explain a work item from live DB-backed state', async () => {
    const result = await maybeHandleCapabilityChatAction({
      bundle: buildBundle(),
      agent: executionAgent,
      message: 'why is WI-123 blocked and what should I do next?',
    });

    expect(result.handled).toBe(true);
    expect(result.content).toContain('Execution view: WI-123 - Ship todo filters');
    expect(result.content).toContain('Ship todo filters is waiting on approval.');
    expect(result.content).toContain('Release readiness: WAITING_APPROVAL (72%)');
    expect(result.content).toContain('Suggested chat options:');
    expect(result.content).toContain('approve RUN-123: approve and continue');
    expect(buildWorkItemExplainDetail).toHaveBeenCalledWith('CAP-CHAT', 'WI-123');
  });

  it('keeps referenced work item resolution available without hijacking log interpretation chat', async () => {
    const bundle = buildBundle();
    const resolved = resolveMentionedWorkItem(
      bundle,
      'interpret the latest logs for WI-123 and tell me the likely root cause',
    );

    expect(resolved.workItem?.id).toBe('WI-123');

    const result = await maybeHandleCapabilityChatAction({
      bundle,
      agent: executionAgent,
      message: 'interpret the latest logs for WI-123 and tell me the likely root cause',
    });

    expect(result).toEqual({ handled: false });
  });

  it('builds a stage-control briefing from the current run step contract', async () => {
    const runDetail = buildRunDetail();
    runDetail.steps = [
      {
        id: 'RUNSTEP-1',
        capabilityId: 'CAP-CHAT',
        runId: 'RUN-123',
        workflowStepId: 'STEP-1',
        workflowNodeId: 'STEP-1',
        name: 'Implementation',
        stepType: 'DELIVERY',
        phase: 'DEVELOPMENT',
        agentId: 'AGENT-DEV',
        status: 'WAITING',
        attemptCount: 1,
        metadata: {
          compiledStepContext: {
            stepId: 'STEP-1',
            workflowId: 'WF-1',
            phase: 'DEVELOPMENT',
            objective: 'Implement the requested change.',
            description: 'Use the approved repo path and keep the API stable.',
            requiredInputs: [
              {
                id: 'approved-workspace',
                label: 'Approved workspace path',
                description: 'Use only an approved local directory.',
                required: true,
                source: 'CAPABILITY',
                kind: 'PATH',
                status: 'READY',
                valueSummary: '/repo/todo-app',
              },
            ],
            missingInputs: [],
            artifactChecklist: [
              {
                id: 'phase-output',
                label: 'Implementation summary',
                direction: 'OUTPUT',
                status: 'EXPECTED',
              },
            ],
            completionChecklist: ['Build passes cleanly'],
            nextActions: ['Read the existing code', 'Implement the change'],
            memoryBoundary: ['WORK_ITEM'],
            executionBoundary: {
              allowedToolIds: ['workspace_read'],
              requiresHumanApproval: false,
              allowedWorkspacePaths: ['/repo/todo-app'],
            },
          },
          compiledWorkItemPlan: {
            workItemId: 'WI-123',
            workflowId: 'WF-1',
            currentStepId: 'STEP-1',
            planSummary: 'Complete implementation, then hand off to the next stage.',
            stepSequence: [],
            currentStep: {
              stepId: 'STEP-1',
              workflowId: 'WF-1',
              phase: 'DEVELOPMENT',
              objective: 'Implement the requested change.',
              requiredInputs: [],
              missingInputs: [],
              artifactChecklist: [],
              completionChecklist: [],
              nextActions: [],
              memoryBoundary: [],
              executionBoundary: {
                allowedToolIds: ['workspace_read'],
                requiresHumanApproval: false,
                allowedWorkspacePaths: ['/repo/todo-app'],
              },
            },
          },
        },
      } as any,
    ];
    vi.mocked(getWorkflowRunDetail).mockResolvedValue(runDetail);

    const briefing = await buildWorkItemStageControlBriefing({
      bundle: buildBundle(),
      workItemId: 'WI-123',
    });

    expect(briefing).toContain('Stage control context for WI-123 - Ship todo filters');
    expect(briefing).toContain('Current step: Implementation');
    expect(briefing).toContain('Stage objective: Implement the requested change.');
    expect(briefing).toContain(
      'Required inputs: Approved workspace path (ready: /repo/todo-app)',
    );
    expect(briefing).toContain(
      'Artifact checklist: Implementation summary (output / expected)',
    );
  });

  it('lets the execution agent provide an overview when no work item is specified', async () => {
    const result = await maybeHandleCapabilityChatAction({
      bundle: buildBundle(),
      agent: executionAgent,
      message: 'what needs attention in execution right now?',
    });

    expect(result.handled).toBe(true);
    expect(result.content).toContain('Execution Agent view for ToDoAPpp');
    expect(result.content).toContain('Show the live status of WI-123.');
  });

  it('guides and restarts blocked work when no wait is open', async () => {
    const blockedBundle = buildBundle();
    blockedBundle.workspace.workItems = [
      {
        ...buildWorkItem(),
        status: 'BLOCKED',
        pendingRequest: undefined,
        blocker: {
          type: 'HUMAN_INPUT',
          message: 'The previous attempt needs clearer operator direction.',
          requestedBy: 'Software Developer',
          timestamp: '2026-04-12T08:10:00.000Z',
          status: 'OPEN',
        },
        activeRunId: undefined,
        lastRunId: 'RUN-123',
      },
    ];
    vi.mocked(getWorkflowRunDetail).mockResolvedValue(buildBlockedRunDetail());
    vi.mocked(restartWorkflowRun).mockResolvedValue({
      ...buildBlockedRunDetail(),
      run: {
        ...buildBlockedRunDetail().run,
        id: 'RUN-124',
        status: 'QUEUED',
      },
    } as WorkflowRunDetail);

    const result = await maybeHandleCapabilityChatAction({
      bundle: blockedBundle,
      agent: activeAgent,
      message:
        'guide agent for WI-123: use the approved workspace path /repo/todo-app and keep the API shape unchanged',
    });

    expect(result.handled).toBe(true);
    expect(result.changedState).toBe(true);
    expect(result.wakeWorker).toBe(true);
    expect(result.content).toContain('Guided WI-123 - Ship todo filters');
    expect(restartWorkflowRun).toHaveBeenCalledWith({
      capabilityId: 'CAP-CHAT',
      runId: 'RUN-123',
      restartFromPhase: 'DEVELOPMENT',
      guidance:
        'use the approved workspace path /repo/todo-app and keep the API shape unchanged',
      guidedBy: 'Capability Owner via chat',
    });
  });

  it('treats skip-build phrasing in execution chat as unblock guidance', async () => {
    const blockedBundle = buildBundle();
    blockedBundle.workspace.workItems = [
      {
        ...buildWorkItem(),
        status: 'BLOCKED',
        pendingRequest: undefined,
        blocker: {
          type: 'HUMAN_INPUT',
          message: 'Build command is not configured for this capability.',
          requestedBy: 'Software Developer',
          timestamp: '2026-04-12T08:10:00.000Z',
          status: 'OPEN',
        },
        activeRunId: undefined,
        lastRunId: 'RUN-123',
      },
    ];
    vi.mocked(getWorkflowRunDetail).mockResolvedValue(buildBlockedRunDetail());
    vi.mocked(restartWorkflowRun).mockResolvedValue({
      ...buildBlockedRunDetail(),
      run: {
        ...buildBlockedRunDetail().run,
        id: 'RUN-125',
        status: 'QUEUED',
      },
    } as WorkflowRunDetail);

    const result = await maybeHandleCapabilityChatAction({
      bundle: blockedBundle,
      agent: executionAgent,
      message: 'skip build for WI-123 and continue with the implementation output',
    });

    expect(result.handled).toBe(true);
    expect(result.changedState).toBe(true);
    expect(result.wakeWorker).toBe(true);
    expect(restartWorkflowRun).toHaveBeenCalledWith({
      capabilityId: 'CAP-CHAT',
      runId: 'RUN-123',
      restartFromPhase: 'DEVELOPMENT',
      guidance: 'skip build for WI-123 and continue with the implementation output',
      guidedBy: 'Execution Agent via chat',
    });
  });

  it('does not hijack normal collaboration questions as workspace actions', async () => {
    const result = await maybeHandleCapabilityChatAction({
      bundle: buildBundle(),
      agent: activeAgent,
      message: 'Can you explain the design tradeoffs for the todo filters workflow?',
    });

    expect(result).toEqual({ handled: false });
    expect(moveWorkItemToPhaseControl).not.toHaveBeenCalled();
    expect(startWorkflowExecution).not.toHaveBeenCalled();
    expect(cancelWorkflowRun).not.toHaveBeenCalled();
    expect(requestChangesWorkflowRun).not.toHaveBeenCalled();
    expect(provideWorkflowRunInput).not.toHaveBeenCalled();
    expect(resolveWorkflowRunConflict).not.toHaveBeenCalled();
    expect(restartWorkflowRun).not.toHaveBeenCalled();
  });
});
