import type { WorkItem } from '../types';

export type WorkItemDisplayStatus = WorkItem['status'] | 'STAGED';

type WorkItemStateInput = Pick<WorkItem, 'status' | 'activeRunId' | 'phase'>;

export const isWorkItemStaged = (
  workItem?: WorkItemStateInput | null,
): boolean =>
  Boolean(
    workItem &&
      ((workItem.status === 'STAGED' &&
        workItem.phase !== 'DONE') ||
        (workItem.status === 'ACTIVE' &&
          !workItem.activeRunId &&
          workItem.phase !== 'DONE')),
  );

export const getWorkItemDisplayStatus = (
  workItem?: WorkItemStateInput | null,
): WorkItemDisplayStatus =>
  isWorkItemStaged(workItem) ? 'STAGED' : (workItem?.status || 'ACTIVE');

export const isWorkItemLiveExecution = (
  workItem?: WorkItemStateInput | null,
): boolean => Boolean(workItem?.activeRunId);
