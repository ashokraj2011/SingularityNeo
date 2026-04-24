// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../access', () => ({
  assertCapabilityPermission: vi.fn(),
}));

vi.mock('../db', () => ({
  query: vi.fn(),
}));

vi.mock('../repository', () => ({
  getCapabilityBundle: vi.fn(),
}));

import { assertCapabilityPermission } from '../access';
import { query } from '../db';
import { getCapabilityBundle } from '../repository';
import {
  buildAuthorizedParticipantDirectory,
  resolveAuthorizedSwarmParticipants,
} from '../swarmParticipants';

const assertCapabilityPermissionMock = vi.mocked(assertCapabilityPermission);
const queryMock = vi.mocked(query);
const getCapabilityBundleMock = vi.mocked(getCapabilityBundle);

const rowResult = <T>(rows: T[]) =>
  ({
    rows,
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  }) as any;

const bundle = (id: string, name: string, extra?: Record<string, unknown>) =>
  ({
    capability: {
      id,
      name,
      capabilityKind: 'DELIVERY',
      parentCapabilityId: extra?.parentCapabilityId,
    },
    workspace: {
      agents: [
        {
          id: `${id}-agent`,
          name: `${name} Agent`,
        },
      ],
    },
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('swarmParticipants', () => {
  it('filters the participant directory down to linked capabilities the actor may use', async () => {
    queryMock
      .mockResolvedValueOnce(rowResult([{ id: 'CAP-CHILD' }]))
      .mockResolvedValueOnce(
        rowResult([{ member_capability_id: 'CAP-SHARED' }]),
      );

    getCapabilityBundleMock.mockImplementation(async capabilityId => {
      if (capabilityId === 'CAP-ANCHOR') {
        return bundle('CAP-ANCHOR', 'Anchor', {
          parentCapabilityId: 'CAP-PARENT',
        });
      }
      if (capabilityId === 'CAP-PARENT') return bundle('CAP-PARENT', 'Parent');
      if (capabilityId === 'CAP-CHILD') return bundle('CAP-CHILD', 'Child');
      if (capabilityId === 'CAP-SHARED') return bundle('CAP-SHARED', 'Shared');
      throw new Error(`Unknown capability ${capabilityId}`);
    });

    assertCapabilityPermissionMock.mockImplementation(async ({ capabilityId }) => {
      if (capabilityId === 'CAP-SHARED') {
        throw new Error('Forbidden: shared capability is not allowed.');
      }
    });

    const directory = await buildAuthorizedParticipantDirectory({
      anchorCapabilityId: 'CAP-ANCHOR',
      actor: { userId: 'USR-1', displayName: 'Operator' } as any,
    });

    expect(directory.current).toHaveLength(1);
    expect(directory.parent.map(entry => entry.capabilityId)).toEqual([
      'CAP-PARENT',
    ]);
    expect(directory.children.map(entry => entry.capabilityId)).toEqual([
      'CAP-CHILD',
    ]);
    expect(directory.shared).toEqual([]);
  });

  it('rejects participants outside the linked capability set', async () => {
    queryMock
      .mockResolvedValueOnce(rowResult([]))
      .mockResolvedValueOnce(rowResult([]));
    getCapabilityBundleMock.mockResolvedValue(
      bundle('CAP-ANCHOR', 'Anchor') as any,
    );

    await expect(
      resolveAuthorizedSwarmParticipants({
        anchorCapabilityId: 'CAP-ANCHOR',
        actor: { userId: 'USR-1', displayName: 'Operator' } as any,
        participants: [
          { capabilityId: 'CAP-UNLINKED', agentId: 'ghost-agent' },
        ],
      }),
    ).rejects.toThrow('Forbidden: capability CAP-UNLINKED is not linked');
  });
});
