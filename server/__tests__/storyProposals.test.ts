// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../execution/service', () => ({
  createWorkItemRecord: vi.fn(),
  extractJsonObject: vi.fn(),
}));

vi.mock('../githubModels', () => ({
  invokeCapabilityChat: vi.fn(),
}));

vi.mock('../repository', () => ({
  getCapabilityBundle: vi.fn(),
}));

import { __storyProposalTestUtils } from '../storyProposals';
import { transaction } from '../db';
import { createWorkItemRecord } from '../execution/service';
import { getCapabilityBundle } from '../repository';
import { promoteStoryProposalBatch } from '../storyProposals';

const buildBundle = () =>
  ({
    capability: {
      id: 'CAP-PLAN',
      name: 'Rule Engine',
      description: 'Evaluate rule expressions consistently across channels.',
      businessOutcome: 'Generate reliable rule-evaluation outcomes with clear evidence.',
      dependencies: [
        {
          dependencyKind: 'CAPABILITY',
          targetCapabilityId: 'CAP-INPUTS',
          description: 'Rule definitions are published by the inputs service.',
        },
      ],
      requiredEvidenceKinds: ['Requirements pack', 'Test evidence'],
      repositories: [{ id: 'REPO-1', label: 'rule-engine', url: 'git@example.com/rule-engine.git' }],
    },
    workspace: {
      agents: [],
      workflows: [{ id: 'WF-PLAN', name: 'Delivery' }],
      workItems: [],
    },
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCapabilityBundle).mockResolvedValue(buildBundle());
});

describe('story proposal helpers', () => {
  it('builds a fallback batch with one epic and multiple child stories', () => {
    const batch = __storyProposalTestUtils.buildFallbackBatch({
      bundle: buildBundle(),
      workflow: { id: 'WF-PLAN', name: 'Delivery' } as any,
      sourcePrompt: 'Prepare the next release for case-insensitive operator support.',
    });

    expect(batch.generationMode).toBe('FALLBACK');
    expect(batch.items.filter(item => item.itemType === 'EPIC')).toHaveLength(1);
    expect(batch.items.filter(item => item.itemType === 'STORY').length).toBeGreaterThanOrEqual(2);

    const epic = batch.items.find(item => item.itemType === 'EPIC');
    const stories = batch.items.filter(item => item.itemType === 'STORY');

    expect(epic?.storyPoints).toBe(8);
    expect(epic?.tShirtSize).toBe('L');
    expect(stories.every(item => item.parentProposalItemId === epic?.id)).toBe(true);
    expect(stories.every(item => item.recommendedWorkflowId === 'WF-PLAN')).toBe(true);
  });

  it('normalizes generated agent output into one epic and sized child stories', () => {
    const normalized = __storyProposalTestUtils.normalizeGeneratedBatch({
      capabilityId: 'CAP-PLAN',
      workflowId: 'WF-PLAN',
      raw: {
        title: 'Rule Engine release plan',
        summary: 'Break the release into reviewable slices.',
        assumptions: ['Core parser remains stable.'],
        items: [
          {
            itemType: 'EPIC',
            title: 'Ship case-insensitive operator support',
            description: 'Coordinate planning, implementation, and validation.',
            storyPoints: 13,
            tShirtSize: 'XL',
            recommendedTaskType: 'STRATEGIC_INITIATIVE',
          },
          {
            itemType: 'STORY',
            title: 'Update parser and evaluator',
            description: 'Implement lowercased operator handling.',
            tShirtSize: 'M',
            recommendedTaskType: 'FEATURE_ENHANCEMENT',
          },
          {
            itemType: 'STORY',
            title: 'Add regression coverage',
            description: 'Add tests for NOT_STARTSWITH and NOT_CONTAINS.',
            storyPoints: 3,
            recommendedTaskType: 'GENERAL',
          },
        ],
      },
    });

    const epic = normalized.items[0];
    const stories = normalized.items.slice(1);

    expect(epic.itemType).toBe('EPIC');
    expect(epic.storyPoints).toBe(13);
    expect(epic.tShirtSize).toBe('XL');
    expect(stories).toHaveLength(2);
    expect(stories[0]?.storyPoints).toBe(5);
    expect(stories[0]?.tShirtSize).toBe('M');
    expect(stories[1]?.storyPoints).toBe(3);
    expect(stories[1]?.parentProposalItemId).toBe(epic.id);
    expect(stories.every(item => item.recommendedWorkflowId === 'WF-PLAN')).toBe(true);
  });

  it('derives batch status from item review states without collapsing partial review', () => {
    const epic = {
      id: 'SPI-EPIC',
      itemType: 'EPIC',
      reviewState: 'APPROVED',
    } as any;
    const approvedStory = {
      id: 'SPI-1',
      itemType: 'STORY',
      reviewState: 'APPROVED',
    } as any;
    const proposedStory = {
      id: 'SPI-2',
      itemType: 'STORY',
      reviewState: 'PROPOSED',
    } as any;
    const rejectedStory = {
      id: 'SPI-3',
      itemType: 'STORY',
      reviewState: 'REJECTED',
    } as any;

    expect(
      __storyProposalTestUtils.deriveBatchStatus([epic, approvedStory, proposedStory]),
    ).toBe('PARTIALLY_APPROVED');
    expect(
      __storyProposalTestUtils.deriveBatchStatus([epic, approvedStory]),
    ).toBe('APPROVED');
    expect(
      __storyProposalTestUtils.deriveBatchStatus([rejectedStory]),
    ).toBe('DISCARDED');
    expect(
      __storyProposalTestUtils.deriveBatchStatus([proposedStory]),
    ).toBe('REVIEW_READY');
  });

  it('auto-starts git sessions when approved proposals are promoted into work items', async () => {
    const batchRow = {
      id: 'SPB-1',
      capability_id: 'CAP-PLAN',
      title: 'Rule Engine story plan',
      status: 'APPROVED',
      selected_workflow_id: 'WF-PLAN',
      source_prompt: 'Plan the next release.',
      summary: 'Break the work into a parent epic and one reviewable story.',
      assumptions: JSON.stringify([]),
      dependencies: JSON.stringify([]),
      risks: JSON.stringify([]),
      sizing_policy: 'Dual-size each item.',
      generated_by_agent_id: null,
      generation_mode: 'PLANNING_AGENT',
      planning_artifacts: JSON.stringify([]),
      created_by_user_id: 'USR-1',
      created_at: new Date('2026-04-22T07:00:00.000Z'),
      updated_at: new Date('2026-04-22T07:05:00.000Z'),
    };

    const epicRow = {
      id: 'SPI-EPIC',
      capability_id: 'CAP-PLAN',
      batch_id: 'SPB-1',
      item_type: 'EPIC',
      parent_item_id: null,
      title: 'Ship rule-engine upgrade',
      description: 'Coordinate delivery of the next rule-engine slice.',
      business_outcome: 'Safer, faster release planning.',
      acceptance_criteria: JSON.stringify(['Epic is approved.']),
      dependencies: JSON.stringify([]),
      risks: JSON.stringify([]),
      recommended_workflow_id: 'WF-PLAN',
      recommended_task_type: 'STRATEGIC_INITIATIVE',
      story_points: 8,
      t_shirt_size: 'L',
      sizing_confidence: 'HIGH',
      sizing_rationale: 'Broad cross-team planning scope.',
      implementation_notes: 'Promote this into a parent work item.',
      tags: JSON.stringify(['planning']),
      review_state: 'APPROVED',
      sort_order: 0,
      promoted_work_item_id: null,
      created_at: new Date('2026-04-22T07:00:00.000Z'),
      updated_at: new Date('2026-04-22T07:05:00.000Z'),
    };

    const storyRow = {
      id: 'SPI-STORY-1',
      capability_id: 'CAP-PLAN',
      batch_id: 'SPB-1',
      item_type: 'STORY',
      parent_item_id: 'SPI-EPIC',
      title: 'Implement operator parsing update',
      description: 'Add the concrete delivery slice.',
      business_outcome: 'Operators resolve correctly.',
      acceptance_criteria: JSON.stringify(['Tests cover the new behavior.']),
      dependencies: JSON.stringify([]),
      risks: JSON.stringify([]),
      recommended_workflow_id: 'WF-PLAN',
      recommended_task_type: 'FEATURE_ENHANCEMENT',
      story_points: 3,
      t_shirt_size: 'S',
      sizing_confidence: 'MEDIUM',
      sizing_rationale: 'Small isolated code change.',
      implementation_notes: 'Promote this into a child work item.',
      tags: JSON.stringify(['rule-engine']),
      review_state: 'APPROVED',
      sort_order: 1,
      promoted_work_item_id: null,
      created_at: new Date('2026-04-22T07:01:00.000Z'),
      updated_at: new Date('2026-04-22T07:05:00.000Z'),
    };

    let readPhase = 0;
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM capability_story_proposal_batches')) {
          return { rows: [batchRow], rowCount: 1 };
        }
        if (sql.includes('FROM capability_story_proposal_items')) {
          readPhase += 1;
          if (readPhase < 3) {
            return { rows: [epicRow, storyRow], rowCount: 2 };
          }
          return {
            rows: [
              { ...epicRow, review_state: 'PROMOTED', promoted_work_item_id: 'WI-EPIC01' },
              { ...storyRow, review_state: 'PROMOTED', promoted_work_item_id: 'WI-STORY1' },
            ],
            rowCount: 2,
          };
        }
        if (sql.includes('FROM capability_story_proposal_decisions')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    vi.mocked(transaction).mockImplementation(async callback => callback(client as any));
    vi.mocked(createWorkItemRecord)
      .mockResolvedValueOnce({ id: 'WI-EPIC01', title: 'Ship rule-engine upgrade' } as any)
      .mockResolvedValueOnce({
        id: 'WI-STORY1',
        title: 'Implement operator parsing update',
      } as any);

    const result = await promoteStoryProposalBatch({
      capabilityId: 'CAP-PLAN',
      batchId: 'SPB-1',
      actor: { userId: 'USR-1', displayName: 'Planner', teamIds: [] },
    });

    expect(result.workItems.map(item => item.id)).toEqual(['WI-EPIC01', 'WI-STORY1']);
    expect(createWorkItemRecord).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        claimOnCreate: false,
        autoStartGitSession: true,
      }),
    );
    expect(createWorkItemRecord).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        claimOnCreate: false,
        autoStartGitSession: true,
        planningMetadata: expect.objectContaining({
          parentWorkItemId: 'WI-EPIC01',
        }),
      }),
    );
  });

  it('reuses existing proposal work items when promotion is retried before proposal state is marked', async () => {
    const now = new Date('2026-04-22T07:00:00.000Z');
    const batchRow = {
      id: 'SPB-1',
      capability_id: 'CAP-PLAN',
      title: 'Rule Engine story plan',
      status: 'APPROVED',
      selected_workflow_id: 'WF-PLAN',
      source_prompt: 'Plan the next release.',
      summary: 'Break the work into a parent epic and one reviewable story.',
      assumptions: [],
      dependencies: [],
      risks: [],
      sizing_policy: 'Dual-size each item.',
      generated_by_agent_id: null,
      generation_mode: 'PLANNING_AGENT',
      planning_artifacts: [],
      created_by_user_id: 'USR-1',
      created_at: now,
      updated_at: now,
    };
    const epicRow = {
      id: 'SPI-EPIC',
      capability_id: 'CAP-PLAN',
      batch_id: 'SPB-1',
      item_type: 'EPIC',
      parent_item_id: null,
      title: 'Ship rule-engine upgrade',
      description: 'Coordinate delivery of the next rule-engine slice.',
      business_outcome: 'Safer, faster release planning.',
      acceptance_criteria: ['Epic is approved.'],
      dependencies: [],
      risks: [],
      recommended_workflow_id: 'WF-PLAN',
      recommended_task_type: 'STRATEGIC_INITIATIVE',
      story_points: 8,
      t_shirt_size: 'L',
      sizing_confidence: 'HIGH',
      sizing_rationale: 'Broad cross-team planning scope.',
      implementation_notes: 'Promote this into a parent work item.',
      tags: ['planning'],
      review_state: 'APPROVED',
      sort_order: 0,
      promoted_work_item_id: null,
      created_at: now,
      updated_at: now,
    };
    const storyRow = {
      id: 'SPI-STORY-1',
      capability_id: 'CAP-PLAN',
      batch_id: 'SPB-1',
      item_type: 'STORY',
      parent_item_id: 'SPI-EPIC',
      title: 'Implement operator parsing update',
      description: 'Add the concrete delivery slice.',
      business_outcome: 'Operators resolve correctly.',
      acceptance_criteria: ['Tests cover the new behavior.'],
      dependencies: [],
      risks: [],
      recommended_workflow_id: 'WF-PLAN',
      recommended_task_type: 'FEATURE_ENHANCEMENT',
      story_points: 3,
      t_shirt_size: 'S',
      sizing_confidence: 'MEDIUM',
      sizing_rationale: 'Small isolated code change.',
      implementation_notes: 'Promote this into a child work item.',
      tags: ['rule-engine'],
      review_state: 'APPROVED',
      sort_order: 1,
      promoted_work_item_id: null,
      created_at: now,
      updated_at: now,
    };
    const existingEpic = {
      id: 'WI-EPIC01',
      title: 'Ship rule-engine upgrade',
      planningBatchId: 'SPB-1',
      planningProposalItemId: 'SPI-EPIC',
    };
    const existingStory = {
      id: 'WI-STORY1',
      title: 'Implement operator parsing update',
      planningBatchId: 'SPB-1',
      planningProposalItemId: 'SPI-STORY-1',
      parentWorkItemId: 'WI-EPIC01',
    };
    vi.mocked(getCapabilityBundle).mockResolvedValue({
      ...buildBundle(),
      workspace: {
        ...buildBundle().workspace,
        workItems: [existingEpic, existingStory],
      },
    } as any);

    let readPhase = 0;
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM capability_story_proposal_batches')) {
          return { rows: [batchRow], rowCount: 1 };
        }
        if (
          sql.includes('SELECT') &&
          sql.includes('FROM capability_story_proposal_items')
        ) {
          readPhase += 1;
          if (readPhase < 3) {
            return { rows: [epicRow, storyRow], rowCount: 2 };
          }
          return {
            rows: [
              { ...epicRow, review_state: 'PROMOTED', promoted_work_item_id: 'WI-EPIC01' },
              { ...storyRow, review_state: 'PROMOTED', promoted_work_item_id: 'WI-STORY1' },
            ],
            rowCount: 2,
          };
        }
        if (sql.includes('FROM capability_story_proposal_decisions')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    vi.mocked(transaction).mockImplementation(async callback => callback(client as any));

    const result = await promoteStoryProposalBatch({
      capabilityId: 'CAP-PLAN',
      batchId: 'SPB-1',
      actor: { userId: 'USR-1', displayName: 'Planner', teamIds: [] },
    });

    expect(createWorkItemRecord).not.toHaveBeenCalled();
    expect(result.workItems.map(item => item.id)).toEqual(['WI-EPIC01', 'WI-STORY1']);
  });
});
