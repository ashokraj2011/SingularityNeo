// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ActorContext, RunWait, WorkItem } from '../../src/types';
import { __executionServiceTestUtils } from '../execution/service';

const baseWorkItem = (): WorkItem =>
  ({
    id: 'WI-1',
    capabilityId: 'CAP-1',
    title: 'Review code diff',
    description: 'Review pending approval.',
    workflowId: 'WF-1',
    phase: 'DESIGN',
    status: 'PENDING_APPROVAL',
    priority: 'MEDIUM',
    tags: [],
    watchedByUserIds: [],
    phaseStakeholders: [],
    history: [],
    phaseOwnerTeamId: 'TEAM-BROKERAGE',
    claimOwnerUserId: 'USR-WORKSPACE-OPERATOR',
    pendingRequest: {
      type: 'APPROVAL',
      message: 'Approve the code diff to continue.',
      timestamp: '2026-04-18T03:29:33.642Z',
      requestedBy: 'AGENT-1',
    },
    activeRunId: 'RUN-1',
    recordVersion: 1,
    createdAt: '2026-04-18T03:29:33.642Z',
    updatedAt: '2026-04-18T03:29:33.642Z',
  }) as WorkItem;

const actor = (overrides: Partial<ActorContext> = {}): ActorContext => ({
  userId: 'USR-WORKSPACE-OPERATOR',
  displayName: 'Workspace Operator',
  teamIds: ['TEAM-PLATFORM-OPERATIONS'],
  ...overrides,
});

const wait = (overrides: Partial<RunWait> = {}): RunWait =>
  ({
    id: 'WAIT-1',
    capabilityId: 'CAP-1',
    runId: 'RUN-1',
    type: 'APPROVAL',
    status: 'OPEN',
    message: 'Changed workspace files.',
    requestedBy: 'AGENT-1',
    approvalAssignments: [
      {
        id: 'APPROVAL-1',
        capabilityId: 'CAP-1',
        runId: 'RUN-1',
        waitId: 'WAIT-1',
        status: 'PENDING',
        targetType: 'TEAM',
        targetId: 'TEAM-BROKERAGE',
        assignedTeamId: 'TEAM-BROKERAGE',
        createdAt: '2026-04-18T03:29:33.642Z',
        updatedAt: '2026-04-18T03:29:33.642Z',
      },
    ],
    createdAt: '2026-04-18T03:29:33.642Z',
    updatedAt: '2026-04-18T03:29:33.642Z',
    ...overrides,
  }) as RunWait;

describe('approval assignment fallback', () => {
  it('allows the claimed work-item owner to approve implicit team assignments', () => {
    expect(
      __executionServiceTestUtils.canActorApproveWait({
        actor: actor(),
        workItem: baseWorkItem(),
        wait: wait(),
      }),
    ).toBe(true);
  });

  it('does not bypass explicit approval policy assignments', () => {
    expect(
      __executionServiceTestUtils.canActorApproveWait({
        actor: actor(),
        workItem: baseWorkItem(),
        wait: wait({
          approvalAssignments: [
            {
              id: 'APPROVAL-1',
              capabilityId: 'CAP-1',
              runId: 'RUN-1',
              waitId: 'WAIT-1',
              approvalPolicyId: 'POLICY-1',
              status: 'PENDING',
              targetType: 'TEAM',
              targetId: 'TEAM-BROKERAGE',
              assignedTeamId: 'TEAM-BROKERAGE',
              createdAt: '2026-04-18T03:29:33.642Z',
              updatedAt: '2026-04-18T03:29:33.642Z',
            },
          ],
        }),
      }),
    ).toBe(false);
  });
});
