import type {
  ActorContext,
  Capability,
  CapabilityMembership,
  NotificationRule,
  UserPreference,
  WorkspaceMembership,
  WorkspaceOrganization,
  WorkspaceTeam,
  WorkspaceUser,
} from '../types';

const trim = (value?: string | null) => String(value || '').trim();

export const toWorkspaceEntityId = (prefix: string, value: string) =>
  `${prefix}-${value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'DEFAULT'}`;

export const toWorkspaceTeamId = (value: string) => toWorkspaceEntityId('TEAM', value);
export const toWorkspaceUserId = (value: string) => toWorkspaceEntityId('USR', value);
export const toWorkspaceMembershipId = (userId: string, teamId: string) =>
  toWorkspaceEntityId('MEM', `${userId}-${teamId}`);
export const toCapabilityMembershipId = (
  capabilityId: string,
  userId: string,
  role: string,
) => toWorkspaceEntityId('CAPMEM', `${capabilityId}-${userId}-${role}`);

export const createDefaultWorkspaceUser = (): WorkspaceUser => ({
  id: 'USR-WORKSPACE-OPERATOR',
  name: 'Workspace Operator',
  email: 'operator@local.workspace',
  title: 'Platform Operator',
  status: 'ACTIVE',
  teamIds: ['TEAM-PLATFORM-OPERATIONS'],
});

export const createDefaultWorkspaceOrganization = (): WorkspaceOrganization => ({
  users: [createDefaultWorkspaceUser()],
  teams: [
    {
      id: 'TEAM-PLATFORM-OPERATIONS',
      name: 'Platform Operations',
      description: 'Default workspace operating team.',
      memberUserIds: ['USR-WORKSPACE-OPERATOR'],
      capabilityIds: [],
    },
  ],
  memberships: [
    {
      id: 'MEM-USR-WORKSPACE-OPERATOR-TEAM-PLATFORM-OPERATIONS',
      userId: 'USR-WORKSPACE-OPERATOR',
      teamId: 'TEAM-PLATFORM-OPERATIONS',
      role: 'LEAD',
    },
  ],
  capabilityMemberships: [],
  externalIdentityLinks: [],
  userPreferences: [],
  notificationRules: [],
  currentUserId: 'USR-WORKSPACE-OPERATOR',
});

export const normalizeWorkspaceUsers = (
  users: WorkspaceUser[] | undefined,
): WorkspaceUser[] =>
  (users || [])
    .map(user => ({
      id: trim(user?.id) || toWorkspaceUserId(trim(user?.email) || trim(user?.name) || 'USER'),
      name: trim(user?.name) || trim(user?.email) || 'Workspace User',
      email: trim(user?.email) || `${trim(user?.id).toLowerCase() || 'user'}@local.workspace`,
      title: trim(user?.title) || undefined,
      status:
        user?.status === 'INVITED' || user?.status === 'DISABLED' ? user.status : 'ACTIVE',
      teamIds: Array.from(new Set((user?.teamIds || []).map(teamId => trim(teamId)).filter(Boolean))),
    } satisfies WorkspaceUser))
    .filter(user => Boolean(user.id));

export const normalizeWorkspaceTeams = (
  teams: WorkspaceTeam[] | undefined,
): WorkspaceTeam[] =>
  (teams || [])
    .map(team => ({
      id: trim(team?.id) || toWorkspaceTeamId(trim(team?.name) || 'TEAM'),
      name: trim(team?.name) || 'Workspace Team',
      description: trim(team?.description) || undefined,
      memberUserIds: Array.from(
        new Set((team?.memberUserIds || []).map(userId => trim(userId)).filter(Boolean)),
      ),
      capabilityIds: Array.from(
        new Set((team?.capabilityIds || []).map(capabilityId => trim(capabilityId)).filter(Boolean)),
      ),
    }))
    .filter(team => Boolean(team.id));

export const normalizeWorkspaceMemberships = (
  memberships: WorkspaceMembership[] | undefined,
): WorkspaceMembership[] =>
  (memberships || [])
    .map(membership => ({
      id:
        trim(membership?.id) ||
        toWorkspaceMembershipId(trim(membership?.userId), trim(membership?.teamId)),
      userId: trim(membership?.userId),
      teamId: trim(membership?.teamId),
      role:
        membership?.role === 'LEAD' ||
        membership?.role === 'APPROVER' ||
        membership?.role === 'VIEWER'
          ? membership.role
          : 'MEMBER',
    } satisfies WorkspaceMembership))
    .filter(membership => membership.userId && membership.teamId);

export const normalizeCapabilityMemberships = (
  memberships: CapabilityMembership[] | undefined,
): CapabilityMembership[] =>
  (memberships || [])
    .map(membership => ({
      id:
        trim(membership?.id) ||
        toCapabilityMembershipId(
          trim(membership?.capabilityId),
          trim(membership?.userId),
          trim(membership?.role) || 'VIEWER',
        ),
      capabilityId: trim(membership?.capabilityId),
      userId: trim(membership?.userId),
      teamId: trim(membership?.teamId) || undefined,
      role:
        membership?.role === 'OWNER' ||
        membership?.role === 'OPERATOR' ||
        membership?.role === 'APPROVER'
          ? membership.role
          : 'VIEWER',
    } satisfies CapabilityMembership))
    .filter(membership => membership.capabilityId && membership.userId);

const normalizeNotificationRules = (
  rules: NotificationRule[] | undefined,
): NotificationRule[] =>
  (rules || [])
    .map(rule => ({
      id: trim(rule?.id) || toWorkspaceEntityId('NOTIFY', trim(rule?.trigger) || 'RULE'),
      trigger:
        rule?.trigger === 'PHASE_ENTERED' ||
        rule?.trigger === 'SLA_BREACHED' ||
        rule?.trigger === 'REQUEST_CHANGES' ||
        rule?.trigger === 'CONFLICT_NEEDS_RESOLUTION' ||
        rule?.trigger === 'HANDOFF_ACCEPTANCE_REQUIRED'
          ? rule.trigger
          : 'APPROVAL_REQUESTED',
      channels: Array.from(
        new Set(
          (rule?.channels || ['INBOX']).filter(
            channel =>
              channel === 'INBOX' ||
              channel === 'EMAIL' ||
              channel === 'SLACK' ||
              channel === 'TEAMS',
          ),
        ),
      ),
      teamId: trim(rule?.teamId) || undefined,
      userId: trim(rule?.userId) || undefined,
      capabilityId: trim(rule?.capabilityId) || undefined,
      immediate: rule?.immediate !== false,
      digest: Boolean(rule?.digest),
    } satisfies NotificationRule))
    .filter(rule => Boolean(rule.id));

const normalizeUserPreferences = (
  preferences: UserPreference[] | undefined,
): UserPreference[] =>
  (preferences || [])
    .map(preference => ({
      userId: trim(preference?.userId),
      defaultCapabilityId: trim(preference?.defaultCapabilityId) || undefined,
      lastSelectedTeamId: trim(preference?.lastSelectedTeamId) || undefined,
      workbenchView:
        preference?.workbenchView === 'TEAM_QUEUE' ||
        preference?.workbenchView === 'ATTENTION' ||
        preference?.workbenchView === 'WATCHING'
          ? preference.workbenchView
          : 'MY_QUEUE',
    } satisfies UserPreference))
    .filter(preference => Boolean(preference.userId));

export const normalizeWorkspaceOrganization = (
  organization?: Partial<WorkspaceOrganization> | null,
): WorkspaceOrganization => {
  const fallback = createDefaultWorkspaceOrganization();
  const users = normalizeWorkspaceUsers(organization?.users);
  const teams = normalizeWorkspaceTeams(organization?.teams);
  const memberships = normalizeWorkspaceMemberships(organization?.memberships);
  const capabilityMemberships = normalizeCapabilityMemberships(
    organization?.capabilityMemberships,
  );
  const externalIdentityLinks = (organization?.externalIdentityLinks || [])
    .map(link => ({
      id:
        trim(link?.id) ||
        toWorkspaceEntityId(
          'IDENTITY',
          `${trim(link?.provider) || 'PROVIDER'}-${trim(link?.externalId) || 'LINK'}`,
        ),
      userId: trim(link?.userId),
      provider:
        link?.provider === 'JIRA' ||
        link?.provider === 'CONFLUENCE' ||
        link?.provider === 'SSO'
          ? link.provider
          : 'GITHUB',
      externalId: trim(link?.externalId),
      username: trim(link?.username) || undefined,
      displayName: trim(link?.displayName) || undefined,
      profileUrl: trim(link?.profileUrl) || undefined,
    } satisfies WorkspaceOrganization['externalIdentityLinks'][number]))
    .filter(link => link.userId && link.externalId);
  const userPreferences = normalizeUserPreferences(organization?.userPreferences);
  const notificationRules = normalizeNotificationRules(organization?.notificationRules);
  const currentUserId = trim(organization?.currentUserId);

  return {
    users: users.length > 0 ? users : fallback.users,
    teams: teams.length > 0 ? teams : fallback.teams,
    memberships: memberships.length > 0 ? memberships : fallback.memberships,
    capabilityMemberships,
    externalIdentityLinks,
    userPreferences,
    notificationRules,
    currentUserId:
      currentUserId ||
      users[0]?.id ||
      fallback.currentUserId,
  };
};

export const seedWorkspaceOrganizationFromCapabilities = (
  capabilities: Capability[],
  organization?: Partial<WorkspaceOrganization> | null,
): WorkspaceOrganization => {
  const base = normalizeWorkspaceOrganization(organization);
  const teams = new Map(base.teams.map(team => [team.id, team]));
  const users = new Map(base.users.map(user => [user.id, user]));
  const memberships = new Map(base.memberships.map(membership => [membership.id, membership]));
  const capabilityMemberships = new Map(
    base.capabilityMemberships.map(membership => [membership.id, membership]),
  );

  for (const capability of capabilities) {
    const capabilityTeamNames = Array.from(
      new Set([capability.ownerTeam, ...(capability.teamNames || [])].map(trim).filter(Boolean)),
    );

    for (const teamName of capabilityTeamNames) {
      const teamId = toWorkspaceTeamId(teamName);
      const existing = teams.get(teamId);
      teams.set(teamId, {
        id: teamId,
        name: teamName,
        description: existing?.description,
        memberUserIds: existing?.memberUserIds || [],
        capabilityIds: Array.from(new Set([...(existing?.capabilityIds || []), capability.id])),
      });
    }

    for (const stakeholder of capability.stakeholders || []) {
      const name = trim(stakeholder.name) || trim(stakeholder.email);
      if (!name) {
        continue;
      }
      const email = trim(stakeholder.email) || `${toWorkspaceUserId(name).toLowerCase()}@local.workspace`;
      const userId = toWorkspaceUserId(email || name);
      const teamIds = [stakeholder.teamName, capability.ownerTeam]
        .map(trim)
        .filter(Boolean)
        .map(toWorkspaceTeamId);
      const existingUser = users.get(userId);
      users.set(userId, {
        id: userId,
        name,
        email,
        title: trim(stakeholder.role) || existingUser?.title,
        status: existingUser?.status || 'ACTIVE',
        teamIds: Array.from(new Set([...(existingUser?.teamIds || []), ...teamIds])),
      });

      for (const teamId of teamIds) {
        const team = teams.get(teamId);
        if (team) {
          teams.set(teamId, {
            ...team,
            memberUserIds: Array.from(new Set([...team.memberUserIds, userId])),
          });
        }
        const membershipId = toWorkspaceMembershipId(userId, teamId);
        memberships.set(membershipId, {
          id: membershipId,
          userId,
          teamId,
          role: trim(stakeholder.role).toLowerCase().includes('lead') ? 'LEAD' : 'MEMBER',
        });
      }

      const capabilityMembershipId = toCapabilityMembershipId(
        capability.id,
        userId,
        trim(stakeholder.role) || 'VIEWER',
      );
      capabilityMemberships.set(capabilityMembershipId, {
        id: capabilityMembershipId,
        capabilityId: capability.id,
        userId,
        teamId: teamIds[0] || undefined,
        role:
          trim(stakeholder.role).toLowerCase().includes('owner')
            ? 'OWNER'
            : trim(stakeholder.role).toLowerCase().includes('approv')
            ? 'APPROVER'
            : 'VIEWER',
      });
    }
  }

  const next = normalizeWorkspaceOrganization({
    ...base,
    users: [...users.values()],
    teams: [...teams.values()],
    memberships: [...memberships.values()],
    capabilityMemberships: [...capabilityMemberships.values()],
  });

  return next.users.length > 0 ? next : base;
};

export const getCurrentWorkspaceUser = (
  organization?: WorkspaceOrganization | null,
): WorkspaceUser | undefined => {
  const normalized = normalizeWorkspaceOrganization(organization);
  return (
    normalized.users.find(user => user.id === normalized.currentUserId) ||
    normalized.users[0]
  );
};

export const buildActorContextFromOrganization = (
  organization?: WorkspaceOrganization | null,
): ActorContext => {
  const currentUser = getCurrentWorkspaceUser(organization);
  return {
    userId: currentUser?.id,
    displayName: currentUser?.name || 'Workspace Operator',
    teamIds: currentUser?.teamIds || [],
  };
};
