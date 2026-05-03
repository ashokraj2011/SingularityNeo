import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../../types';
import {
  getWorkItemDisplayStatus,
  isWorkItemLiveExecution,
  isWorkItemStaged,
} from '../workItemState';

const makeWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'WI-1',
  capabilityId: 'cap-1',
  workflowId: 'wf-1',
  title: 'Implement parser',
  description: '',
  phase: 'ANALYSIS',
  status: 'ACTIVE',
  priority: 'Med',
  tags: [],
  artifactIds: [],
  history: [],
  createdAt: '2026-05-03T00:00:00.000Z',
  updatedAt: '2026-05-03T00:00:00.000Z',
  taskType: 'FEATURE',
  ...overrides,
});

describe('workItemState', () => {
  it('treats active work without a run as staged for display', () => {
    const workItem = makeWorkItem();

    expect(isWorkItemStaged(workItem)).toBe(true);
    expect(isWorkItemLiveExecution(workItem)).toBe(false);
    expect(getWorkItemDisplayStatus(workItem)).toBe('STAGED');
  });

  it('keeps explicitly staged work staged', () => {
    const workItem = makeWorkItem({ status: 'STAGED' });

    expect(isWorkItemStaged(workItem)).toBe(true);
    expect(isWorkItemLiveExecution(workItem)).toBe(false);
    expect(getWorkItemDisplayStatus(workItem)).toBe('STAGED');
  });

  it('treats active work with a run as live execution', () => {
    const workItem = makeWorkItem({ activeRunId: 'RUN-1' });

    expect(isWorkItemStaged(workItem)).toBe(false);
    expect(isWorkItemLiveExecution(workItem)).toBe(true);
    expect(getWorkItemDisplayStatus(workItem)).toBe('ACTIVE');
  });

  it('does not relabel completed work as staged', () => {
    const workItem = makeWorkItem({
      phase: 'DONE',
      status: 'COMPLETED',
    });

    expect(isWorkItemStaged(workItem)).toBe(false);
    expect(getWorkItemDisplayStatus(workItem)).toBe('COMPLETED');
  });
});
