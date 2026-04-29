// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { __executionServiceTestUtils } from '../execution/service';
import type { WorkflowRun } from '../../src/types';

const buildRun = (overrides: Partial<WorkflowRun> = {}): WorkflowRun =>
  ({
    id: 'RUN-1',
    capabilityId: 'CAP-1',
    workItemId: 'WI-1',
    workflowId: 'WF-1',
    status: 'RUNNING',
    attemptNumber: 1,
    workflowSnapshot: {
      id: 'WF-1',
      capabilityId: 'CAP-1',
      name: 'Workflow',
      steps: [],
      status: 'STABLE',
    },
    currentNodeId: 'STEP-2',
    currentStepId: 'STEP-2',
    currentPhase: 'DEVELOPMENT',
    assignedAgentId: 'AGENT-QA',
    assignedExecutorId: 'desktop-executor-1',
    branchState: {
      pendingNodeIds: ['STEP-2'],
      activeNodeIds: ['STEP-2'],
      completedNodeIds: ['STEP-1'],
      joinState: {},
      visitCount: 1,
    },
    currentWaitId: undefined,
    queueReason: undefined,
    pauseReason: undefined,
    terminalOutcome: undefined,
    traceId: 'TRACE-1',
    leaseOwner: 'desktop-executor:desktop-executor-1',
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    startedAt: new Date(0).toISOString(),
    completedAt: undefined,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  }) as WorkflowRun;

describe('buildQueuedRunForExternalAdvance', () => {
  it('re-queues an approval-advanced run for the next executor claim', () => {
    const queuedRun = __executionServiceTestUtils.buildQueuedRunForExternalAdvance({
      run: buildRun(),
      queuedDispatch: {
        assignedExecutorId: 'desktop-executor-2',
        queueReason: undefined,
      },
    });

    expect(queuedRun.status).toBe('QUEUED');
    expect(queuedRun.currentStepId).toBe('STEP-2');
    expect(queuedRun.currentPhase).toBe('DEVELOPMENT');
    expect(queuedRun.assignedAgentId).toBe('AGENT-QA');
    expect(queuedRun.assignedExecutorId).toBe('desktop-executor-2');
    expect(queuedRun.leaseOwner).toBeUndefined();
    expect(queuedRun.leaseExpiresAt).toBeUndefined();
    expect(queuedRun.currentWaitId).toBeUndefined();
  });

  it('marks the run as waiting for an executor when none is currently owned', () => {
    const queuedRun = __executionServiceTestUtils.buildQueuedRunForExternalAdvance({
      run: buildRun({
        assignedExecutorId: 'desktop-executor-1',
        leaseOwner: 'desktop-executor:desktop-executor-1',
      }),
      queuedDispatch: {
        assignedExecutorId: undefined,
        queueReason: 'WAITING_FOR_EXECUTOR',
      },
    });

    expect(queuedRun.status).toBe('QUEUED');
    expect(queuedRun.assignedExecutorId).toBeUndefined();
    expect(queuedRun.queueReason).toBe('WAITING_FOR_EXECUTOR');
    expect(queuedRun.leaseOwner).toBeUndefined();
    expect(queuedRun.leaseExpiresAt).toBeUndefined();
  });
});

describe('getRunStatusForWaitType', () => {
  it('maps delegated human tasks to WAITING_HUMAN_TASK', () => {
    expect(__executionServiceTestUtils.getRunStatusForWaitType('HUMAN_TASK')).toBe(
      'WAITING_HUMAN_TASK',
    );
  });
});
