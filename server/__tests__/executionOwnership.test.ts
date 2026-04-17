// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActorContext } from '../../src/types';

vi.mock('../db', () => ({
  query: vi.fn(),
}));

import { query } from '../db';
import { claimCapabilityExecution } from '../executionOwnership';

const queryMock = vi.mocked(query);

const nowIso = new Date().toISOString();
const staleIso = new Date(Date.now() - 120_000).toISOString();

type RegistrationRow = {
  id: string;
  actor_user_id?: string | null;
  actor_display_name: string;
  actor_team_ids: string[];
  owned_capability_ids: string[];
  approved_workspace_roots: Record<string, string[]>;
  heartbeat_at: string;
  created_at: string;
  updated_at: string;
  runtime_summary?: Record<string, unknown>;
};

type OwnershipRow = {
  capability_id: string;
  executor_id: string;
  actor_user_id?: string | null;
  actor_display_name: string;
  actor_team_ids: string[];
  approved_workspace_roots: string[];
  claimed_at: string;
  heartbeat_at: string;
  updated_at: string;
};

type MockState = {
  staleExecutors: string[];
  registrations: Map<string, RegistrationRow>;
  ownerships: Map<string, OwnershipRow>;
  runAssignmentUpdates: Array<{ capabilityId: string; executorId: string | null }>;
};

const rowResult = <T>(rows: T[]) => ({
  rows,
  rowCount: rows.length,
  command: '',
  oid: 0,
  fields: [],
}) as any;

const baseActor: ActorContext = {
  userId: 'user-1',
  displayName: 'Ashok',
  teamIds: ['TEAM-OPS'],
};

const createRegistration = (
  id: string,
  overrides: Partial<RegistrationRow> = {},
): RegistrationRow => ({
  id,
  actor_user_id: 'user-1',
  actor_display_name: 'Ashok',
  actor_team_ids: ['TEAM-OPS'],
  owned_capability_ids: [],
  approved_workspace_roots: {
    'CAP-1': ['/tmp/app'],
  },
  heartbeat_at: nowIso,
  created_at: nowIso,
  updated_at: nowIso,
  runtime_summary: {},
  ...overrides,
});

const createOwnership = (
  capabilityId: string,
  executorId: string,
  overrides: Partial<OwnershipRow> = {},
): OwnershipRow => ({
  capability_id: capabilityId,
  executor_id: executorId,
  actor_user_id: 'user-1',
  actor_display_name: 'Ashok',
  actor_team_ids: ['TEAM-OPS'],
  approved_workspace_roots: ['/tmp/app'],
  claimed_at: nowIso,
  heartbeat_at: nowIso,
  updated_at: nowIso,
  ...overrides,
});

const installQueryMock = (state: MockState) => {
  queryMock.mockImplementation((async (sql: any, params: any[] = []) => {
    const text = String(sql);

    if (text.includes('SELECT id') && text.includes('FROM desktop_executor_registrations') && text.includes('heartbeat_at < NOW()')) {
      return rowResult(state.staleExecutors.map(id => ({ id })));
    }

    if (text.includes('SELECT *') && text.includes('FROM desktop_executor_registrations') && text.includes('WHERE id = $1')) {
      const record = state.registrations.get(String(params[0]));
      return rowResult(record ? [record] : []);
    }

    if (text.includes('SELECT *') && text.includes('FROM capability_execution_ownership') && text.includes('WHERE capability_id = $1')) {
      const record = state.ownerships.get(String(params[0]));
      return rowResult(record ? [record] : []);
    }

    if (text.includes('DELETE FROM capability_execution_ownership') && text.includes('RETURNING capability_id')) {
      const executorId = String(params[0]);
      const deleted: Array<{ capability_id: string }> = [];
      for (const [capabilityId, row] of state.ownerships.entries()) {
        if (row.executor_id === executorId) {
          state.ownerships.delete(capabilityId);
          deleted.push({ capability_id: capabilityId });
        }
      }
      return rowResult(deleted);
    }

    if (text.includes('INSERT INTO capability_execution_ownership')) {
      const capabilityId = String(params[0]);
      const executorId = String(params[1]);
      const next: OwnershipRow = {
        capability_id: capabilityId,
        executor_id: executorId,
        actor_user_id: params[2] || null,
        actor_display_name: String(params[3]),
        actor_team_ids: Array.isArray(params[4]) ? params[4] : [],
        approved_workspace_roots: Array.isArray(params[5]) ? params[5] : [],
        claimed_at: nowIso,
        heartbeat_at: nowIso,
        updated_at: nowIso,
      };
      state.ownerships.set(capabilityId, next);
      return rowResult([next]);
    }

    if (text.includes('array_remove(owned_capability_ids, $2)')) {
      const executorId = String(params[0]);
      const capabilityId = String(params[1]);
      const registration = state.registrations.get(executorId);
      if (registration) {
        registration.owned_capability_ids = registration.owned_capability_ids.filter(
          current => current !== capabilityId,
        );
        registration.updated_at = nowIso;
      }
      return rowResult([]);
    }

    if (text.includes('array_append(owned_capability_ids, $2)')) {
      const executorId = String(params[0]);
      const capabilityId = String(params[1]);
      const registration = state.registrations.get(executorId);
      if (registration && !registration.owned_capability_ids.includes(capabilityId)) {
        registration.owned_capability_ids.push(capabilityId);
        registration.updated_at = nowIso;
      }
      return rowResult([]);
    }

    if (text.includes('UPDATE capability_workflow_runs')) {
      state.runAssignmentUpdates.push({
        capabilityId: String(params[0]),
        executorId: params[1] === null || params[1] === undefined ? null : String(params[1]),
      });
      return rowResult([]);
    }

    throw new Error(`Unhandled query in test:\n${text}`);
  }) as any);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('claimCapabilityExecution', () => {
  it('allows same-user reclaim for the same executor', async () => {
    const state: MockState = {
      staleExecutors: [],
      registrations: new Map([['exec-1', createRegistration('exec-1')]]),
      ownerships: new Map([['CAP-1', createOwnership('CAP-1', 'exec-1')]]),
      runAssignmentUpdates: [],
    };
    installQueryMock(state);

    const ownership = await claimCapabilityExecution({
      capabilityId: 'CAP-1',
      executorId: 'exec-1',
      actor: baseActor,
      approvedWorkspaceRoots: ['/tmp/app', '/tmp/app/'],
    });

    expect(ownership.executorId).toBe('exec-1');
    expect(state.registrations.get('exec-1')?.owned_capability_ids).toContain('CAP-1');
    expect(state.runAssignmentUpdates).toEqual([{ capabilityId: 'CAP-1', executorId: 'exec-1' }]);
    expect(queryMock.mock.calls.some(call => String(call[0]).includes('array_remove'))).toBe(false);
  });

  it('rejects claims when the desktop executor belongs to another user', async () => {
    const state: MockState = {
      staleExecutors: [],
      registrations: new Map([
        ['exec-1', createRegistration('exec-1', { actor_user_id: 'user-2', actor_display_name: 'Other User' })],
      ]),
      ownerships: new Map(),
      runAssignmentUpdates: [],
    };
    installQueryMock(state);

    await expect(
      claimCapabilityExecution({
        capabilityId: 'CAP-1',
        executorId: 'exec-1',
        actor: baseActor,
        approvedWorkspaceRoots: ['/tmp/app'],
      }),
    ).rejects.toThrow('different workspace operator');
  });

  it('supports force takeover from another fresh executor', async () => {
    const state: MockState = {
      staleExecutors: [],
      registrations: new Map([
        ['exec-1', createRegistration('exec-1')],
        ['exec-2', createRegistration('exec-2', { actor_user_id: 'user-2', actor_display_name: 'Remote Owner', owned_capability_ids: ['CAP-1'] })],
      ]),
      ownerships: new Map([
        ['CAP-1', createOwnership('CAP-1', 'exec-2', { actor_user_id: 'user-2', actor_display_name: 'Remote Owner' })],
      ]),
      runAssignmentUpdates: [],
    };
    installQueryMock(state);

    const ownership = await claimCapabilityExecution({
      capabilityId: 'CAP-1',
      executorId: 'exec-1',
      actor: baseActor,
      approvedWorkspaceRoots: ['/tmp/app'],
      forceTakeover: true,
    });

    expect(ownership.executorId).toBe('exec-1');
    expect(state.registrations.get('exec-1')?.owned_capability_ids).toContain('CAP-1');
    expect(state.registrations.get('exec-2')?.owned_capability_ids).not.toContain('CAP-1');
  });

  it('replaces stale ownership without requiring force takeover', async () => {
    const state: MockState = {
      staleExecutors: [],
      registrations: new Map([
        ['exec-1', createRegistration('exec-1')],
        ['exec-stale', createRegistration('exec-stale', { owned_capability_ids: ['CAP-1'], heartbeat_at: staleIso })],
      ]),
      ownerships: new Map([
        ['CAP-1', createOwnership('CAP-1', 'exec-stale', { heartbeat_at: staleIso })],
      ]),
      runAssignmentUpdates: [],
    };
    installQueryMock(state);

    const ownership = await claimCapabilityExecution({
      capabilityId: 'CAP-1',
      executorId: 'exec-1',
      actor: baseActor,
      approvedWorkspaceRoots: ['/tmp/app'],
    });

    expect(ownership.executorId).toBe('exec-1');
    expect(state.registrations.get('exec-stale')?.owned_capability_ids).not.toContain('CAP-1');
  });

  it('rejects a concurrent claim when another fresh executor already owns the capability', async () => {
    const state: MockState = {
      staleExecutors: [],
      registrations: new Map([
        ['exec-1', createRegistration('exec-1')],
        ['exec-2', createRegistration('exec-2', { actor_user_id: 'user-2', actor_display_name: 'Remote Owner' })],
      ]),
      ownerships: new Map([
        ['CAP-1', createOwnership('CAP-1', 'exec-2', { actor_user_id: 'user-2', actor_display_name: 'Remote Owner' })],
      ]),
      runAssignmentUpdates: [],
    };
    installQueryMock(state);

    await expect(
      claimCapabilityExecution({
        capabilityId: 'CAP-1',
        executorId: 'exec-1',
        actor: baseActor,
        approvedWorkspaceRoots: ['/tmp/app'],
      }),
    ).rejects.toThrow('already owns execution');
  });
});
