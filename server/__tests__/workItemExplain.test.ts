// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  deriveReleaseReadiness,
  deriveWorkItemAttemptDiff,
} from '../workItemExplain';
import type {
  CompletedWorkOrderDetail,
  WorkItem,
  WorkItemFlightRecorderDetail,
  Workflow,
  WorkflowRun,
  WorkflowStep,
} from '../../src/types';

const buildWorkItem = (overrides?: Partial<WorkItem>): WorkItem => ({
  id: 'WI-EXPLAIN',
  title: 'Ship explain drawer',
  description: 'Turn audit traces into an operator-facing explanation flow.',
  capabilityId: 'CAP-EXPLAIN',
  workflowId: 'WF-EXPLAIN',
  phase: 'RELEASE',
  status: 'ACTIVE',
  priority: 'Med',
  tags: [],
  history: [],
  ...overrides,
});

const buildRun = (overrides?: Partial<WorkflowRun>): WorkflowRun => ({
  id: 'RUN-2',
  capabilityId: 'CAP-EXPLAIN',
  workflowId: 'WF-EXPLAIN',
  workItemId: 'WI-EXPLAIN',
  workflowSnapshot: buildWorkflow([qaStep, releaseStep]),
  currentStepId: 'STEP-RELEASE',
  currentNodeId: undefined,
  currentPhase: 'RELEASE',
  assignedAgentId: 'AGENT-DEV',
  attemptNumber: 2,
  status: 'COMPLETED',
  startedAt: '2026-04-12T10:00:00.000Z',
  completedAt: '2026-04-12T10:10:00.000Z',
  createdAt: '2026-04-12T10:00:00.000Z',
  updatedAt: '2026-04-12T10:10:00.000Z',
  traceId: 'TRACE-2',
  terminalOutcome: 'Completed successfully',
  leaseOwner: undefined,
  leaseExpiresAt: undefined,
  ...overrides,
});

const buildWorkflow = (steps: WorkflowStep[]): Workflow => ({
  id: 'WF-EXPLAIN',
  name: 'Explain Workflow',
  capabilityId: 'CAP-EXPLAIN',
  steps,
  status: 'STABLE',
});

const qaStep: WorkflowStep = {
  id: 'STEP-QA',
  name: 'QA Verification',
  phase: 'QA',
  stepType: 'DELIVERY',
  agentId: 'AGENT-QA',
  action: 'Run QA verification and regression testing',
  allowedToolIds: ['run_test'],
};

const releaseStep: WorkflowStep = {
  id: 'STEP-RELEASE',
  name: 'Release Approval',
  phase: 'RELEASE',
  stepType: 'HUMAN_APPROVAL',
  agentId: 'AGENT-OWNER',
  action: 'Review release evidence and authorize deployment',
  allowedToolIds: ['run_deploy'],
};

const buildEvidence = (
  overrides?: Partial<CompletedWorkOrderDetail>,
): CompletedWorkOrderDetail => ({
  workItem: buildWorkItem({ status: 'COMPLETED', phase: 'DONE' }),
  workflow: buildWorkflow([qaStep, releaseStep]),
  latestCompletedRun: buildRun(),
  runHistory: [buildRun()],
  latestRunDetail: undefined,
  artifacts: [],
  humanInteractions: [],
  phaseGroups: [
    {
      phase: 'QA',
      label: 'QA',
      stepName: qaStep.name,
      stepType: qaStep.stepType,
      artifacts: [],
      handoffArtifacts: [],
      toolInvocations: [],
      logs: [],
      events: [],
      interactions: [],
    },
  ],
  events: [],
  logs: [],
  ...overrides,
});

const buildRecorderDetail = (
  overrides?: Partial<WorkItemFlightRecorderDetail>,
): WorkItemFlightRecorderDetail => ({
  capabilityId: 'CAP-EXPLAIN',
  generatedAt: '2026-04-12T10:20:00.000Z',
  workItem: buildWorkItem({ status: 'COMPLETED', phase: 'DONE' }),
  verdict: 'ALLOWED',
  verdictReason: 'All gates are resolved and evidence plus handoffs exist.',
  latestRun: buildRun(),
  runHistory: [
    buildRun(),
    buildRun({
      id: 'RUN-1',
      attemptNumber: 1,
      status: 'FAILED',
      completedAt: '2026-04-12T09:15:00.000Z',
      updatedAt: '2026-04-12T09:15:00.000Z',
      terminalOutcome: 'Previous run failed in QA',
      traceId: 'TRACE-1',
    }),
  ],
  humanGates: [
    {
      waitId: 'WAIT-APPROVAL',
      runId: 'RUN-2',
      runStepId: 'STEP-RELEASE',
      type: 'APPROVAL',
      status: 'RESOLVED',
      message: 'Review the final release evidence.',
      requestedBy: 'AGENT-OWNER',
      createdAt: '2026-04-12T10:05:00.000Z',
      resolvedAt: '2026-04-12T10:06:00.000Z',
      resolution: 'Approved',
    },
  ],
  policyDecisions: [
    {
      id: 'POL-ALLOW',
      actionType: 'run_deploy',
      decision: 'ALLOW',
      reason: 'Deployment target is approved.',
      createdAt: '2026-04-12T10:04:00.000Z',
    },
  ],
  artifacts: [
    {
      artifactId: 'ART-EVIDENCE',
      name: 'QA Report',
      kind: 'PHASE_OUTPUT',
      createdAt: '2026-04-12T10:03:00.000Z',
      runId: 'RUN-2',
      phase: 'QA',
    },
  ],
  handoffArtifacts: [
    {
      artifactId: 'ART-HANDOFF',
      name: 'Release Handoff',
      kind: 'HANDOFF_PACKET',
      createdAt: '2026-04-12T10:04:30.000Z',
      runId: 'RUN-2',
      phase: 'RELEASE',
    },
  ],
  toolInvocations: [
    {
      id: 'TOOL-DEPLOY',
      capabilityId: 'CAP-EXPLAIN',
      runId: 'RUN-2',
      runStepId: 'STEP-RELEASE',
      toolId: 'run_deploy',
      status: 'COMPLETED',
      request: {},
      retryable: false,
      createdAt: '2026-04-12T10:04:00.000Z',
    },
  ],
  events: [
    {
      id: 'EVENT-STEP-2',
      capabilityId: 'CAP-EXPLAIN',
      runId: 'RUN-2',
      workItemId: 'WI-EXPLAIN',
      timestamp: '2026-04-12T10:02:00.000Z',
      type: 'STEP_COMPLETED',
      title: 'QA completed',
      description: 'QA verification completed.',
    },
    {
      id: 'EVENT-STEP-1',
      capabilityId: 'CAP-EXPLAIN',
      runId: 'RUN-1',
      workItemId: 'WI-EXPLAIN',
      timestamp: '2026-04-12T09:10:00.000Z',
      type: 'STEP_COMPLETED',
      title: 'Analysis completed',
      description: 'Analysis completed.',
    },
  ],
  telemetry: {
    traceIds: ['TRACE-2'],
    toolInvocationCount: 1,
    failedToolInvocationCount: 0,
    totalToolLatencyMs: 250,
    totalToolCostUsd: 0.01,
    runConsolePath: '/run-console?runId=RUN-2',
  },
  ...overrides,
});

describe('workItemExplain', () => {
  it('marks a work item ready when applicable release dimensions pass', () => {
    const readiness = deriveReleaseReadiness({
      detail: buildRecorderDetail(),
      evidence: buildEvidence(),
    });

    expect(readiness.status).toBe('READY');
    expect(readiness.score).toBe(100);
    expect(
      readiness.dimensions.find(dimension => dimension.id === 'qa_complete')?.passed,
    ).toBe(true);
  });

  it('blocks readiness when a denied policy exists', () => {
    const readiness = deriveReleaseReadiness({
      detail: buildRecorderDetail({
        verdict: 'DENIED',
        policyDecisions: [
          {
            id: 'POL-DENY',
            actionType: 'run_deploy',
            decision: 'DENY',
            reason: 'Deployment target is not approved.',
            createdAt: '2026-04-12T10:04:00.000Z',
          },
        ],
      }),
      evidence: buildEvidence(),
    });

    expect(readiness.status).toBe('BLOCKED');
    expect(readiness.blockingReasons[0]).toContain('denied policy');
  });

  it('summarizes what changed between attempts', () => {
    const attemptDiff = deriveWorkItemAttemptDiff({
      detail: buildRecorderDetail({
        humanGates: [
          {
            waitId: 'WAIT-APPROVAL',
            runId: 'RUN-2',
            runStepId: 'STEP-RELEASE',
            type: 'APPROVAL',
            status: 'RESOLVED',
            message: 'Review the final release evidence.',
            requestedBy: 'AGENT-OWNER',
            createdAt: '2026-04-12T10:05:00.000Z',
            resolvedAt: '2026-04-12T10:06:00.000Z',
            resolution: 'Approved',
          },
          {
            waitId: 'WAIT-CONFLICT',
            runId: 'RUN-1',
            runStepId: 'STEP-QA',
            type: 'CONFLICT_RESOLUTION',
            status: 'OPEN',
            message: 'Clarify release scope.',
            requestedBy: 'AGENT-QA',
            createdAt: '2026-04-12T09:05:00.000Z',
          },
        ],
        policyDecisions: [
          {
            id: 'POL-ALLOW',
            actionType: 'run_deploy',
            decision: 'ALLOW',
            reason: 'Deployment target is approved.',
            createdAt: '2026-04-12T10:04:00.000Z',
            runId: 'RUN-2',
          },
        ],
        artifacts: [
          {
            artifactId: 'ART-EVIDENCE',
            name: 'QA Report',
            kind: 'PHASE_OUTPUT',
            createdAt: '2026-04-12T10:03:00.000Z',
            runId: 'RUN-2',
          },
        ],
      }),
    });

    expect(attemptDiff.hasPreviousAttempt).toBe(true);
    expect(attemptDiff.summary).toContain('new completed step');
    expect(attemptDiff.waitDelta.join(' ')).toContain('Resolved gate');
    expect(attemptDiff.evidenceDelta.join(' ')).toContain('New evidence artifact');
  });
});
