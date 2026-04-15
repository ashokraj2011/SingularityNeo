import type { PoolClient } from 'pg';
import type {
  Capability,
  ExternalIdentityLink,
  NotificationRule,
  UserPreference,
  WorkspaceMembership,
  WorkspaceOrganization,
  WorkspaceTeam,
  WorkspaceUser,
} from '../src/types';
import {
  normalizeWorkspaceOrganization,
  seedWorkspaceOrganizationFromCapabilities,
} from '../src/lib/workspaceOrganization';
import { query, transaction } from './db';

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

const userFromRow = (row: Record<string, any>): WorkspaceUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  title: row.title || undefined,
  status: row.status,
  teamIds: asStringArray(row.team_ids),
});

const teamFromRow = (row: Record<string, any>): WorkspaceTeam => ({
  id: row.id,
  name: row.name,
  description: row.description || undefined,
  memberUserIds: asStringArray(row.member_user_ids),
  capabilityIds: asStringArray(row.capability_ids),
});

const membershipFromRow = (row: Record<string, any>): WorkspaceMembership => ({
  id: row.id,
  userId: row.user_id,
  teamId: row.team_id,
  role: row.role,
});

const capabilityMembershipFromRow = (row: Record<string, any>) => ({
  id: row.id,
  capabilityId: row.capability_id,
  userId: row.user_id,
  teamId: row.team_id || undefined,
  role: row.role,
});

const identityLinkFromRow = (row: Record<string, any>): ExternalIdentityLink => ({
  id: row.id,
  userId: row.user_id,
  provider: row.provider,
  externalId: row.external_id,
  username: row.username || undefined,
  displayName: row.display_name || undefined,
  profileUrl: row.profile_url || undefined,
});

const userPreferenceFromRow = (row: Record<string, any>): UserPreference => ({
  userId: row.user_id,
  defaultCapabilityId: row.default_capability_id || undefined,
  lastSelectedTeamId: row.last_selected_team_id || undefined,
  workbenchView: row.workbench_view || 'MY_QUEUE',
});

const notificationRuleFromRow = (row: Record<string, any>): NotificationRule => ({
  id: row.id,
  trigger: row.trigger,
  channels: Array.isArray(row.channels) ? row.channels : ['INBOX'],
  teamId: row.team_id || undefined,
  userId: row.user_id || undefined,
  capabilityId: row.capability_id || undefined,
  immediate: Boolean(row.immediate),
  digest: Boolean(row.digest),
});

export const getWorkspaceOrganizationTx = async (
  client: PoolClient,
): Promise<WorkspaceOrganization> => {
  const [
    usersResult,
    teamsResult,
    membershipsResult,
    capabilityMembershipsResult,
    identityLinksResult,
    preferencesResult,
    notificationRulesResult,
  ] = await Promise.all([
    client.query(`SELECT * FROM workspace_users ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM workspace_teams ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM workspace_memberships ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM capability_memberships ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM workspace_external_identity_links ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM workspace_user_preferences ORDER BY user_id ASC`),
    client.query(`SELECT * FROM workspace_notification_rules ORDER BY created_at ASC, id ASC`),
  ]);

  return normalizeWorkspaceOrganization({
    users: usersResult.rows.map(userFromRow),
    teams: teamsResult.rows.map(teamFromRow),
    memberships: membershipsResult.rows.map(membershipFromRow),
    capabilityMemberships: capabilityMembershipsResult.rows.map(capabilityMembershipFromRow),
    externalIdentityLinks: identityLinksResult.rows.map(identityLinkFromRow),
    userPreferences: preferencesResult.rows.map(userPreferenceFromRow),
    notificationRules: notificationRulesResult.rows.map(notificationRuleFromRow),
  });
};

const replaceWorkspaceUsersTx = async (client: PoolClient, users: WorkspaceUser[]) => {
  await client.query(`DELETE FROM workspace_users`);
  for (const user of users) {
    await client.query(
      `
        INSERT INTO workspace_users (
          id,
          name,
          email,
          title,
          status,
          team_ids,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
      `,
      [
        user.id,
        user.name,
        user.email,
        user.title || null,
        user.status,
        user.teamIds,
      ],
    );
  }
};

const replaceWorkspaceTeamsTx = async (client: PoolClient, teams: WorkspaceTeam[]) => {
  await client.query(`DELETE FROM workspace_teams`);
  for (const team of teams) {
    await client.query(
      `
        INSERT INTO workspace_teams (
          id,
          name,
          description,
          member_user_ids,
          capability_ids,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,NOW())
      `,
      [
        team.id,
        team.name,
        team.description || null,
        team.memberUserIds,
        team.capabilityIds,
      ],
    );
  }
};

const replaceWorkspaceMembershipsTx = async (
  client: PoolClient,
  memberships: WorkspaceMembership[],
) => {
  await client.query(`DELETE FROM workspace_memberships`);
  for (const membership of memberships) {
    await client.query(
      `
        INSERT INTO workspace_memberships (
          id,
          user_id,
          team_id,
          role,
          updated_at
        )
        VALUES ($1,$2,$3,$4,NOW())
      `,
      [membership.id, membership.userId, membership.teamId, membership.role],
    );
  }
};

const replaceCapabilityMembershipsTx = async (
  client: PoolClient,
  memberships: WorkspaceOrganization['capabilityMemberships'],
) => {
  await client.query(`DELETE FROM capability_memberships`);
  for (const membership of memberships) {
    await client.query(
      `
        INSERT INTO capability_memberships (
          id,
          capability_id,
          user_id,
          team_id,
          role,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,NOW())
      `,
      [
        membership.id,
        membership.capabilityId,
        membership.userId,
        membership.teamId || null,
        membership.role,
      ],
    );
  }
};

const replaceExternalIdentityLinksTx = async (
  client: PoolClient,
  links: ExternalIdentityLink[],
) => {
  await client.query(`DELETE FROM workspace_external_identity_links`);
  for (const link of links) {
    await client.query(
      `
        INSERT INTO workspace_external_identity_links (
          id,
          user_id,
          provider,
          external_id,
          username,
          display_name,
          profile_url,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      `,
      [
        link.id,
        link.userId,
        link.provider,
        link.externalId,
        link.username || null,
        link.displayName || null,
        link.profileUrl || null,
      ],
    );
  }
};

const replaceUserPreferencesTx = async (client: PoolClient, preferences: UserPreference[]) => {
  await client.query(`DELETE FROM workspace_user_preferences`);
  for (const preference of preferences) {
    await client.query(
      `
        INSERT INTO workspace_user_preferences (
          user_id,
          default_capability_id,
          last_selected_team_id,
          workbench_view,
          updated_at
        )
        VALUES ($1,$2,$3,$4,NOW())
      `,
      [
        preference.userId,
        preference.defaultCapabilityId || null,
        preference.lastSelectedTeamId || null,
        preference.workbenchView || 'MY_QUEUE',
      ],
    );
  }
};

const replaceNotificationRulesTx = async (
  client: PoolClient,
  rules: NotificationRule[],
) => {
  await client.query(`DELETE FROM workspace_notification_rules`);
  for (const rule of rules) {
    await client.query(
      `
        INSERT INTO workspace_notification_rules (
          id,
          trigger,
          channels,
          team_id,
          user_id,
          capability_id,
          immediate,
          digest,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      `,
      [
        rule.id,
        rule.trigger,
        JSON.stringify(rule.channels),
        rule.teamId || null,
        rule.userId || null,
        rule.capabilityId || null,
        rule.immediate,
        rule.digest,
      ],
    );
  }
};

export const updateWorkspaceOrganization = async (
  updates: Partial<WorkspaceOrganization>,
): Promise<WorkspaceOrganization> =>
  transaction(async client => {
    const current = await getWorkspaceOrganizationTx(client);
    const next = normalizeWorkspaceOrganization({
      ...current,
      ...updates,
      users: updates.users ?? current.users,
      teams: updates.teams ?? current.teams,
      memberships: updates.memberships ?? current.memberships,
      capabilityMemberships:
        updates.capabilityMemberships ?? current.capabilityMemberships,
      externalIdentityLinks:
        updates.externalIdentityLinks ?? current.externalIdentityLinks,
      userPreferences: updates.userPreferences ?? current.userPreferences,
      notificationRules: updates.notificationRules ?? current.notificationRules,
      currentUserId: updates.currentUserId ?? current.currentUserId,
    });

    await replaceWorkspaceUsersTx(client, next.users);
    await replaceWorkspaceTeamsTx(client, next.teams);
    await replaceWorkspaceMembershipsTx(client, next.memberships);
    await replaceCapabilityMembershipsTx(client, next.capabilityMemberships);
    await replaceExternalIdentityLinksTx(client, next.externalIdentityLinks);
    await replaceUserPreferencesTx(client, next.userPreferences);
    await replaceNotificationRulesTx(client, next.notificationRules);

    return next;
  });

export const getWorkspaceOrganization = async (): Promise<WorkspaceOrganization> =>
  transaction(client => getWorkspaceOrganizationTx(client));

export const syncWorkspaceOrganizationFromCapabilities = async (
  capabilities: Capability[],
): Promise<WorkspaceOrganization> =>
  transaction(async client => {
    const current = await getWorkspaceOrganizationTx(client);
    const next = seedWorkspaceOrganizationFromCapabilities(capabilities, current);
    await replaceWorkspaceUsersTx(client, next.users);
    await replaceWorkspaceTeamsTx(client, next.teams);
    await replaceWorkspaceMembershipsTx(client, next.memberships);
    await replaceCapabilityMembershipsTx(client, next.capabilityMemberships);
    await replaceExternalIdentityLinksTx(client, next.externalIdentityLinks);
    await replaceUserPreferencesTx(client, next.userPreferences);
    await replaceNotificationRulesTx(client, next.notificationRules);
    return next;
  });

export const upsertUserPreference = async ({
  userId,
  defaultCapabilityId,
  lastSelectedTeamId,
  workbenchView,
}: UserPreference): Promise<UserPreference> => {
  const result = await query(
    `
      INSERT INTO workspace_user_preferences (
        user_id,
        default_capability_id,
        last_selected_team_id,
        workbench_view,
        updated_at
      )
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        default_capability_id = EXCLUDED.default_capability_id,
        last_selected_team_id = EXCLUDED.last_selected_team_id,
        workbench_view = EXCLUDED.workbench_view,
        updated_at = NOW()
      RETURNING *
    `,
    [userId, defaultCapabilityId || null, lastSelectedTeamId || null, workbenchView || 'MY_QUEUE'],
  );

  return userPreferenceFromRow(result.rows[0]);
};
