import { describe, expect, it } from 'vitest';
import type { WorkspaceOrganization } from '../../types';
import { buildActorContextFromOrganization } from '../workspaceOrganization';

const baseOrganization = (
  workspaceRoles: string[] = ['WORKSPACE_ADMIN'],
  extraUsers: WorkspaceOrganization['users'] = [],
): WorkspaceOrganization => ({
  users: [
    {
      id: 'USR-WORKSPACE-OPERATOR',
      name: 'Workspace Operator',
      email: 'operator@example.com',
      status: 'ACTIVE',
      teamIds: ['TEAM-PLATFORM-OPERATIONS'],
      workspaceRoles: workspaceRoles as any,
    },
    ...extraUsers,
  ],
  teams: [
    {
      id: 'TEAM-PLATFORM-OPERATIONS',
      name: 'Platform Operations',
      memberUserIds: ['USR-WORKSPACE-OPERATOR'],
      capabilityIds: [],
    },
    {
      id: 'TEAM-BROKERAGE',
      name: 'Brokerage',
      memberUserIds: [],
      capabilityIds: [],
    },
    {
      id: 'TEAM-RISK',
      name: 'Risk',
      memberUserIds: [],
      capabilityIds: [],
    },
  ],
  memberships: [],
  capabilityMemberships: [],
  capabilityGrants: [],
  descendantAccessGrants: [],
  externalIdentityLinks: [],
  userPreferences: [],
  notificationRules: [],
  accessAuditEvents: [],
  currentUserId: 'USR-WORKSPACE-OPERATOR',
});

describe('workspaceOrganization actor context', () => {
  it('expands workspace admins to all workspace teams', () => {
    const actor = buildActorContextFromOrganization(baseOrganization());

    expect(actor.workspaceRoles).toContain('WORKSPACE_ADMIN');
    expect(actor.teamIds).toEqual([
      'TEAM-PLATFORM-OPERATIONS',
      'TEAM-BROKERAGE',
      'TEAM-RISK',
    ]);
  });

  it('keeps non-admin operators scoped to their assigned teams', () => {
    const actor = buildActorContextFromOrganization(
      baseOrganization(['OPERATOR'], [
        {
          id: 'USR-ADMIN',
          name: 'Workspace Admin',
          email: 'admin@example.com',
          status: 'ACTIVE',
          teamIds: ['TEAM-BROKERAGE'],
          workspaceRoles: ['WORKSPACE_ADMIN'],
        },
      ]),
    );

    expect(actor.workspaceRoles).toEqual(['OPERATOR']);
    expect(actor.teamIds).toEqual(['TEAM-PLATFORM-OPERATIONS']);
  });
});
