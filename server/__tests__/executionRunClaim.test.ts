// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  transaction: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../executionOwnership', () => ({
  reconcileDesktopExecutionOwnerships: vi.fn(),
  listOwnedCapabilityIdsForExecutor: vi.fn(),
  resolveQueuedRunDispatch: vi.fn(),
}));

import { transaction } from '../db';
import {
  listOwnedCapabilityIdsForExecutor,
  reconcileDesktopExecutionOwnerships,
} from '../executionOwnership';
import { claimNextRunnableRunForExecutor } from '../execution/repository';

const transactionMock = vi.mocked(transaction);
const listOwnedCapabilityIdsForExecutorMock = vi.mocked(listOwnedCapabilityIdsForExecutor);
const reconcileDesktopExecutionOwnershipsMock = vi.mocked(reconcileDesktopExecutionOwnerships);

const rowResult = <T>(rows: T[]) =>
  ({
    rows,
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  }) as any;

const baseRunRow = {
  id: 'RUN-1',
  capability_id: 'CAP-1',
  work_item_id: 'WI-1',
  workflow_id: 'WF-1',
  status: 'RUNNING',
  queue_reason: null,
  assigned_executor_id: 'desktop-executor-1',
  attempt_number: 1,
  workflow_snapshot: {
    id: 'WF-1',
    capabilityId: 'CAP-1',
    name: 'Workflow',
    steps: [],
    status: 'STABLE',
  },
  current_node_id: null,
  current_step_id: 'STEP-1',
  current_phase: 'ANALYSIS',
  assigned_agent_id: null,
  branch_state: null,
  pause_reason: null,
  current_wait_id: null,
  terminal_outcome: null,
  restart_from_phase: null,
  trace_id: 'TRACE-1',
  lease_owner: 'desktop-executor:desktop-executor-1',
  lease_expires_at: null,
  started_at: new Date(0).toISOString(),
  completed_at: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

describe('claimNextRunnableRunForExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcileDesktopExecutionOwnershipsMock.mockResolvedValue(undefined as any);
    listOwnedCapabilityIdsForExecutorMock.mockResolvedValue(['CAP-1']);
  });

  it('can reclaim an expired running run already assigned to the same executor', async () => {
    const clientQuery = vi.fn().mockResolvedValue(rowResult([baseRunRow]));
    transactionMock.mockImplementation(async callback =>
      callback({ query: clientQuery } as any),
    );

    const run = await claimNextRunnableRunForExecutor({
      executorId: 'desktop-executor-1',
      leaseMs: 30_000,
    });

    expect(run?.id).toBe('RUN-1');
    expect(clientQuery).toHaveBeenCalledTimes(1);
    expect(String(clientQuery.mock.calls[0]?.[0])).toContain("status IN ('QUEUED', 'RUNNING')");
  });

  it('returns null when the executor owns no capabilities', async () => {
    listOwnedCapabilityIdsForExecutorMock.mockResolvedValue([]);

    const run = await claimNextRunnableRunForExecutor({
      executorId: 'desktop-executor-1',
      leaseMs: 30_000,
    });

    expect(run).toBeNull();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
