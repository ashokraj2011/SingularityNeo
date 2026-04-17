import { describe, expect, it } from 'vitest';
import { createDefaultCapabilityLifecycle } from '../capabilityLifecycle';
import { buildCapabilityBriefing } from '../capabilityBriefing';
import { buildCapabilityInteractionFeed } from '../interactionFeed';
import type { Capability, CapabilityWorkspace, WorkflowRunDetail } from '../../types';

const capability = (): Capability => ({
  id: 'CAP-FEED',
  name: 'Developer Cockpit',
  description: 'Unify workbench context into one interaction story.',
  ownerTeam: 'Platform Engineering',
  businessOutcome: 'Reduce context switching for developers during delivery.',
  successMetrics: [],
  requiredEvidenceKinds: [],
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  localDirectories: [],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    allowedWorkspacePaths: [],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: [],
});

const workspace = (): CapabilityWorkspace => ({
  capabilityId: 'CAP-FEED',
  briefing: buildCapabilityBriefing(capability()),
  agents: [],
  workflows: [],
  artifacts: [
    {
      id: 'ART-1',
      name: 'Build failure evidence',
      capabilityId: 'CAP-FEED',
      type: 'Review Packet',
      version: 'v1',
      agent: 'AGENT-1',
      created: '2026-04-15T10:06:00.000Z',
      workItemId: 'WI-1',
      runId: 'RUN-1',
      artifactKind: 'REVIEW_PACKET',
      direction: 'OUTPUT',
      summary: 'Captured the failing build evidence for operator review.',
    },
  ],
  tasks: [
    {
      id: 'TASK-1',
      title: 'Review failing build output',
      agent: 'AGENT-1',
      capabilityId: 'CAP-FEED',
      workItemId: 'WI-1',
      workflowStepId: 'STEP-1',
      managedByWorkflow: true,
      taskType: 'DELIVERY',
      priority: 'High',
      status: 'PROCESSING',
      timestamp: '2026-04-15T10:01:00.000Z',
      executionNotes: 'Task projection created from the implementation step.',
      producedOutputs: [],
    },
  ],
  executionLogs: [
    {
      id: 'LOG-1',
      taskId: 'WI-1',
      capabilityId: 'CAP-FEED',
      agentId: 'AGENT-1',
      timestamp: '2026-04-15T10:05:00.000Z',
      level: 'INFO',
      message: 'Captured tool result summary.',
      runId: 'RUN-1',
      runStepId: 'RUNSTEP-1',
      traceId: 'TRACE-LOG',
      metadata: {
        outputSummary: 'Build output captured for this attempt.',
      },
    },
  ],
  learningUpdates: [
    {
      id: 'LEARN-1',
      capabilityId: 'CAP-FEED',
      agentId: 'AGENT-1',
      sourceLogIds: ['LOG-1'],
      insight: 'Use the failing build output to guide the next attempt.',
      triggerType: 'GUIDANCE',
      relatedWorkItemId: 'WI-1',
      relatedRunId: 'RUN-1',
      timestamp: '2026-04-15T10:07:00.000Z',
    },
  ],
  workItems: [],
  messages: [
    {
      id: 'MSG-1',
      capabilityId: 'CAP-FEED',
      role: 'agent',
      content: 'I traced the failing build and need guidance on the next retry.',
      timestamp: '2026-04-15T10:00:00.000Z',
      agentId: 'AGENT-1',
      agentName: 'Software Developer',
      workItemId: 'WI-1',
      runId: 'RUN-1',
      workflowStepId: 'STEP-1',
      traceId: 'TRACE-CHAT',
      sessionId: 'SESSION-1',
      sessionScope: 'WORK_ITEM',
      sessionScopeId: 'WI-1',
    },
  ],
  createdAt: '2026-04-15T09:50:00.000Z',
});

const runDetail = (): WorkflowRunDetail => ({
  run: {
    id: 'RUN-1',
    capabilityId: 'CAP-FEED',
    workItemId: 'WI-1',
    workflowId: 'WF-1',
    status: 'WAITING_APPROVAL',
    attemptNumber: 1,
    workflowSnapshot: {
      id: 'WF-1',
      capabilityId: 'CAP-FEED',
      name: 'Delivery',
      steps: [],
      status: 'STABLE',
    },
    currentStepId: 'STEP-1',
    currentPhase: 'DEVELOPMENT',
    assignedAgentId: 'AGENT-1',
    createdAt: '2026-04-15T09:55:00.000Z',
    updatedAt: '2026-04-15T10:06:00.000Z',
  },
  steps: [],
  waits: [
    {
      id: 'WAIT-1',
      capabilityId: 'CAP-FEED',
      runId: 'RUN-1',
      runStepId: 'RUNSTEP-1',
      type: 'APPROVAL',
      status: 'OPEN',
      message: 'Review the code diff before continuation.',
      requestedBy: 'Software Developer',
      createdAt: '2026-04-15T10:04:00.000Z',
      approvalDecisions: [
        {
          id: 'DEC-1',
          capabilityId: 'CAP-FEED',
          runId: 'RUN-1',
          waitId: 'WAIT-1',
          disposition: 'APPROVE',
          actorDisplayName: 'Release Lead',
          actorTeamIds: ['TEAM-1'],
          comment: 'Looks good to continue.',
          createdAt: '2026-04-15T10:06:30.000Z',
        },
      ],
    },
  ],
  toolInvocations: [
    {
      id: 'TOOL-1',
      capabilityId: 'CAP-FEED',
      runId: 'RUN-1',
      runStepId: 'RUNSTEP-1',
      toolId: 'run_build',
      status: 'FAILED',
      request: { command: ['npm', 'run', 'build'] },
      stderrPreview: 'Type error in payment service',
      retryable: true,
      createdAt: '2026-04-15T10:03:00.000Z',
      completedAt: '2026-04-15T10:03:20.000Z',
    },
  ],
});

describe('buildCapabilityInteractionFeed', () => {
  it('merges chat, tool, run, wait, approval, artifact, task, and learning records into one feed', () => {
    const feed = buildCapabilityInteractionFeed({
      capability: capability(),
      workspace: workspace(),
      workItemId: 'WI-1',
      runDetail: runDetail(),
      runEvents: [
        {
          id: 'EVENT-1',
          capabilityId: 'CAP-FEED',
          runId: 'RUN-1',
          workItemId: 'WI-1',
          timestamp: '2026-04-15T10:02:00.000Z',
          level: 'WARN',
          type: 'STEP_WARNING',
          message: 'Build step reported a failure.',
        },
      ],
    });

    expect(feed.scope).toBe('WORK_ITEM');
    expect(feed.summary.totalCount).toBe(9);
    expect(feed.summary.chatCount).toBe(1);
    expect(feed.summary.toolCount).toBe(1);
    expect(feed.summary.waitCount).toBe(1);
    expect(feed.summary.approvalCount).toBe(1);
    expect(feed.summary.learningCount).toBe(1);
    expect(feed.summary.artifactCount).toBe(1);
    expect(feed.summary.taskCount).toBe(1);
    expect(feed.records[0].timestamp).toBe('2026-04-15T10:07:00.000Z');
    expect(feed.records.map(record => record.interactionType)).toEqual(
      expect.arrayContaining([
        'CHAT',
        'TOOL',
        'RUN_EVENT',
        'WAIT',
        'APPROVAL',
        'LEARNING',
        'ARTIFACT',
        'TASK',
      ]),
    );
  });
});
