// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../workspaceOrganization', () => ({
  getWorkspaceOrganization: vi.fn(),
}));

import { getWorkspaceOrganization } from '../workspaceOrganization';
import {
  bindRequestActorContext,
  parseActorContext,
  resolveCanonicalActorFromOrganization,
} from '../requestActor';

const getWorkspaceOrganizationMock = vi.mocked(getWorkspaceOrganization);

const buildOrganization = () => ({
  currentUserId: 'USR-2',
  users: [
    {
      id: 'USR-1',
      name: 'Alice Reviewer',
      email: 'alice@example.com',
      teamIds: ['TEAM-A'],
      workspaceRoles: ['AUDITOR'],
      status: 'ACTIVE',
    },
    {
      id: 'USR-2',
      name: 'Bob Operator',
      email: 'bob@example.com',
      teamIds: ['TEAM-B'],
      workspaceRoles: ['WORKSPACE_ADMIN'],
      status: 'ACTIVE',
    },
  ],
  teams: [
    { id: 'TEAM-A', name: 'Audit', memberUserIds: ['USR-1'], capabilityIds: [] },
    { id: 'TEAM-B', name: 'Platform', memberUserIds: ['USR-2'], capabilityIds: [] },
    { id: 'TEAM-C', name: 'Delivery', memberUserIds: ['USR-2'], capabilityIds: [] },
  ],
  memberships: [],
  capabilityMemberships: [],
  capabilityGrants: [],
  descendantAccessGrants: [],
  externalIdentityLinks: [],
  userPreferences: [],
  notificationRules: [],
  accessAuditEvents: [],
});

const buildRequest = (headers: Record<string, string> = {}) =>
  ({
    header: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? undefined,
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspaceOrganizationMock.mockResolvedValue(buildOrganization() as any);
});

describe('request actor binding', () => {
  it('resolves a known actor from the server-side workspace organization and ignores spoofed display/team headers', async () => {
    const request = buildRequest({
      'x-singularity-actor-user-id': 'USR-1',
      'x-singularity-actor-display-name': 'Spoofed Name',
      'x-singularity-actor-team-ids': 'TEAM-SPOOFED',
      'x-singularity-actor-stakeholder-ids': 'STK-1,STK-2',
    });

    await bindRequestActorContext(request, {} as any, () => undefined);
    const actor = parseActorContext(request, 'Fallback');

    expect(actor).toMatchObject({
      userId: 'USR-1',
      displayName: 'Alice Reviewer',
      teamIds: ['TEAM-A'],
      workspaceRoles: ['AUDITOR'],
      actedOnBehalfOfStakeholderIds: ['STK-1', 'STK-2'],
    });
  });

  it('falls back to the current workspace user when no actor id header is supplied', async () => {
    const request = buildRequest();

    await bindRequestActorContext(request, {} as any, () => undefined);
    const actor = parseActorContext(request, 'Fallback');

    expect(actor.userId).toBe('USR-2');
    expect(actor.displayName).toBe('Bob Operator');
    expect(actor.teamIds).toEqual(['TEAM-A', 'TEAM-B', 'TEAM-C']);
    expect(actor.workspaceRoles).toEqual(['WORKSPACE_ADMIN']);
  });

  it('rejects an unknown actor id instead of silently falling back', async () => {
    const request = buildRequest({
      'x-singularity-actor-user-id': 'USR-404',
    });

    await bindRequestActorContext(request, {} as any, () => undefined);

    expect(() => parseActorContext(request, 'Fallback')).toThrow(
      'Unauthorized: actor USR-404 is not registered in this workspace.',
    );
  });

  it('can resolve directly from an organization snapshot without request plumbing', () => {
    const resolution = resolveCanonicalActorFromOrganization({
      organization: buildOrganization() as any,
      fallbackDisplayName: 'Fallback',
      requestedUserId: 'USR-1',
      actedOnBehalfOfStakeholderIds: ['STK-99'],
    });

    expect(resolution.actor.displayName).toBe('Alice Reviewer');
    expect(resolution.actor.teamIds).toEqual(['TEAM-A']);
    expect(resolution.actor.actedOnBehalfOfStakeholderIds).toEqual(['STK-99']);
  });
});
