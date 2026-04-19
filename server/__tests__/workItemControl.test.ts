// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';
import { __executionControlTestUtils } from '../execution/service';
import type { Capability, WorkItem, Workflow, WorkflowStep } from '../../src/types';

const rowResult = <T>(rows: T[]) =>
  ({
    rows,
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  }) as any;

const buildWorkflow = (steps: WorkflowStep[]): Workflow =>
  ({
    id: 'WF-1',
    name: 'Delivery Workflow',
    capabilityId: 'CAP-1',
    steps,
    status: 'STABLE',
  }) as Workflow;

const buildCapability = (): Capability =>
  ({
    id: 'CAP-1',
    name: 'Payments Capability',
    lifecycle: createDefaultCapabilityLifecycle(),
  }) as Capability;

const buildWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem =>
  ({
    id: 'WI-1',
    capabilityId: 'CAP-1',
    workflowId: 'WF-1',
    title: 'Reconcile payment fallback',
    description: 'Reset me cleanly.',
    phase: 'DEVELOPMENT',
    currentStepId: 'STEP-OLD',
    assignedAgentId: 'AGENT-OLD',
    status: 'ACTIVE',
    priority: 'Med',
    tags: [],
    history: [],
    executionContext: {
      repositoryAssignments: [],
      primaryRepositoryId: 'REPO-1',
    },
    recordVersion: 3,
    ...overrides,
  }) as WorkItem;

describe('work item control helpers', () => {
  it('reinitializes a work item at the workflow entry step', () => {
    const workflow = buildWorkflow([
      {
        id: 'STEP-ANALYSIS',
        name: 'Initial Analysis',
        phase: 'ANALYSIS',
        stepType: 'DELIVERY',
        agentId: 'AGENT-ANALYST',
        action: 'Start with the first analysis task',
        allowedToolIds: [],
      },
      {
        id: 'STEP-DEVELOPMENT',
        name: 'Implementation',
        phase: 'DEVELOPMENT',
        stepType: 'DELIVERY',
        agentId: 'AGENT-DEV',
        action: 'Build the change',
        allowedToolIds: [],
      },
    ]);

    const { nextWorkItem, firstStep, shouldClaim } =
      __executionControlTestUtils.buildEntryStepResetWorkItemState({
        workItem: buildWorkItem(),
        capability: buildCapability(),
        workflow,
        actor: {
          userId: 'USR-1',
          displayName: 'Ashok',
          teamIds: ['TEAM-OPS'],
        },
        note: 'Reset back to the beginning.',
        actionTitle: 'Work item reset',
        claimMessage: 'Ashok reclaimed the work item.',
      });

    expect(firstStep.id).toBe('STEP-ANALYSIS');
    expect(shouldClaim).toBe(true);
    expect(nextWorkItem.phase).toBe('ANALYSIS');
    expect(nextWorkItem.currentStepId).toBe('STEP-ANALYSIS');
    expect(nextWorkItem.assignedAgentId).toBe('AGENT-ANALYST');
    expect(nextWorkItem.executionContext).toBeUndefined();
    expect(nextWorkItem.recordVersion).toBe(4);
    expect(nextWorkItem.history).toHaveLength(2);
    expect(nextWorkItem.history[0]?.detail).toContain('Reset back to the beginning.');
  });

  it('purges evidence packets alongside run history and approval rows', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        const text = String(sql);
        if (text.includes('FROM capability_workflow_runs')) {
          return rowResult([{ id: 'RUN-1' }]);
        }
        if (text.includes('FROM capability_tasks')) {
          return rowResult([{ id: 'TASK-1' }]);
        }
        if (text.includes('FROM capability_artifacts')) {
          return rowResult([{ id: 'ART-1' }]);
        }
        return rowResult([]);
      }),
    } as any;

    await __executionControlTestUtils.purgeWorkItemDataTx(client, {
      capabilityId: 'CAP-1',
      workItemId: 'WI-1',
    });

    const executedSql = client.query.mock.calls.map((call: [string]) => String(call[0]));
    expect(executedSql.some(sql => sql.includes('DELETE FROM capability_evidence_packets'))).toBe(
      true,
    );
    expect(
      executedSql.some(sql => sql.includes('DELETE FROM capability_approval_assignments')),
    ).toBe(true);
    expect(
      executedSql.some(sql => sql.includes('DELETE FROM capability_approval_decisions')),
    ).toBe(true);
    expect(executedSql.some(sql => sql.includes('DELETE FROM capability_workflow_runs'))).toBe(
      true,
    );
  });
});
