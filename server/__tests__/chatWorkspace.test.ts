// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';
import type {
  Capability,
  CapabilityAgent,
  CapabilityWorkspace,
  Workflow,
  WorkflowRunDetail,
  WorkItem,
} from '../../src/types';
import {
  buildLiveWorkspaceBriefing,
  maybeHandleCapabilityChatAction,
} from '../chatWorkspace';
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
  agents: [
    {
      id: 'AGENT-OWNER',
      capabilityId: 'CAP-CHAT',
      name: 'Capability Owner',
      role: 'Capability Owner',
      objective: 'Own the end-to-end delivery context.',
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

const activeAgent: Partial<CapabilityAgent> = {
  id: 'AGENT-OWNER',
  name: 'Capability Owner',
  role: 'Capability Owner',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWorkflowRunDetail).mockResolvedValue(buildRunDetail());
});

describe('chat workspace bridge', () => {
  it('builds a live briefing with capability metadata and delivery context', () => {
    const briefing = buildLiveWorkspaceBriefing(buildBundle());

    expect(briefing).toContain('Live capability context');
    expect(briefing).toContain('Business outcome: Ship the next release with clear execution visibility.');
    expect(briefing).toContain('Approved workspaces: /repo/todo-app');
    expect(briefing).toContain('Work summary: 0 active, 0 blocked, 1 pending approval, 0 completed.');
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
