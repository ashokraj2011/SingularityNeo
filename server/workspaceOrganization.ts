import type { PoolClient } from 'pg';
import type {
  AccessAuditEvent,
  Capability,
  CapabilityGrant,
  ExplicitDescendantAccessGrant,
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
  workspaceRoles: asStringArray(row.workspace_roles) as WorkspaceUser['workspaceRoles'],
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

const capabilityGrantFromRow = (row: Record<string, any>): CapabilityGrant => ({
  id: row.id,
  capabilityId: row.capability_id,
  userId: row.user_id || undefined,
  teamId: row.team_id || undefined,
  actions: asStringArray(row.actions) as CapabilityGrant['actions'],
  note: row.note || undefined,
  createdByUserId: row.created_by_user_id || undefined,
  createdAt: row.created_at?.toISOString?.() || row.created_at,
  updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
});

const descendantAccessGrantFromRow = (
  row: Record<string, any>,
): ExplicitDescendantAccessGrant => ({
  id: row.id,
  parentCapabilityId: row.parent_capability_id,
  descendantCapabilityId: row.descendant_capability_id,
  userId: row.user_id || undefined,
  teamId: row.team_id || undefined,
  actions: asStringArray(row.actions) as ExplicitDescendantAccessGrant['actions'],
  note: row.note || undefined,
  createdByUserId: row.created_by_user_id || undefined,
  createdAt: row.created_at?.toISOString?.() || row.created_at,
  updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
});

const accessAuditEventFromRow = (row: Record<string, any>): AccessAuditEvent => ({
  id: row.id,
  actorUserId: row.actor_user_id || undefined,
  actorDisplayName: row.actor_display_name,
  action: row.action,
  targetType: row.target_type,
  targetId: row.target_id,
  capabilityId: row.capability_id || undefined,
  summary: row.summary,
  metadata:
    row.metadata && typeof row.metadata === 'object' ? row.metadata : undefined,
  createdAt: row.created_at?.toISOString?.() || row.created_at,
});

export const getWorkspaceOrganizationTx = async (
  client: PoolClient,
): Promise<WorkspaceOrganization> => {
  const [
    usersResult,
    teamsResult,
    membershipsResult,
    capabilityMembershipsResult,
    capabilityGrantsResult,
    descendantAccessGrantsResult,
    identityLinksResult,
    preferencesResult,
    notificationRulesResult,
    accessAuditResult,
  ] = await Promise.all([
    client.query(`SELECT * FROM workspace_users ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM workspace_teams ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM workspace_memberships ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM capability_memberships ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM capability_grants ORDER BY created_at ASC, id ASC`),
    client.query(
      `SELECT * FROM capability_descendant_access_grants ORDER BY created_at ASC, id ASC`,
    ),
    client.query(`SELECT * FROM workspace_external_identity_links ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM workspace_user_preferences ORDER BY user_id ASC`),
    client.query(`SELECT * FROM workspace_notification_rules ORDER BY created_at ASC, id ASC`),
    client.query(`SELECT * FROM access_audit_events ORDER BY created_at DESC, id DESC LIMIT 250`),
  ]);

  return normalizeWorkspaceOrganization({
    users: usersResult.rows.map(userFromRow),
    teams: teamsResult.rows.map(teamFromRow),
    memberships: membershipsResult.rows.map(membershipFromRow),
    capabilityMemberships: capabilityMembershipsResult.rows.map(capabilityMembershipFromRow),
    capabilityGrants: capabilityGrantsResult.rows.map(capabilityGrantFromRow),
    descendantAccessGrants: descendantAccessGrantsResult.rows.map(
      descendantAccessGrantFromRow,
    ),
    externalIdentityLinks: identityLinksResult.rows.map(identityLinkFromRow),
    userPreferences: preferencesResult.rows.map(userPreferenceFromRow),
    notificationRules: notificationRulesResult.rows.map(notificationRuleFromRow),
    accessAuditEvents: accessAuditResult.rows.map(accessAuditEventFromRow),
  });
};

const replaceWorkspaceUsersTx = async (client: PoolClient, users: WorkspaceUser[]) => {
  // ⚠ Critical: do NOT use DELETE-then-INSERT here. `workspace_users.id` is
  // the FK target for nine tables — including `desktop_user_workspace_mappings`
  // (ON DELETE CASCADE), `desktop_work_item_checkout_sessions` (CASCADE),
  // and `capability_execution_ownership.actor_user_id` (SET NULL). If we
  // wipe and re-insert on every /api/state fetch (which is what was
  // happening — fetchAppState calls syncWorkspaceOrganizationFromCapabilities
  // unconditionally), the cascade silently nukes desktop workspace
  // mappings and zeros out execution ownership, causing the executor's
  // `approved_workspace_roots` to flap to {} on every page load and the
  // EXECUTION_RUNTIME_READY readiness gate to permanently fail.
  //
  // Instead: UPSERT new/changed rows, then prune only rows whose id is
  // no longer in the new set. Stable rows keep their identity so the
  // FK cascades never fire.
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
          workspace_roles,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          title = EXCLUDED.title,
          status = EXCLUDED.status,
          team_ids = EXCLUDED.team_ids,
          workspace_roles = EXCLUDED.workspace_roles,
          updated_at = NOW()
      `,
      [
        user.id,
        user.name,
        user.email,
        user.title || null,
        user.status,
        user.teamIds,
        user.workspaceRoles,
      ],
    );
  }

  // Defensive: only prune when the new set is non-empty. An empty input
  // is more likely a bug in the caller than a legitimate "no users" state,
  // and pruning everything would still cascade-wipe desktop mappings.
  if (users.length > 0) {
    await client.query(
      `DELETE FROM workspace_users WHERE id <> ALL($1::text[])`,
      [users.map(user => user.id)],
    );
  }
};

const replaceWorkspaceTeamsTx = async (client: PoolClient, teams: WorkspaceTeam[]) => {
  // Same pattern as replaceWorkspaceUsersTx — UPSERT + prune. workspace_teams.id
  // cascades into workspace_memberships, capability_grants and others; a
  // wholesale wipe-and-replace would tear down user→team membership rows
  // on every state fetch and cause downstream readiness/permission flicker.
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
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          member_user_ids = EXCLUDED.member_user_ids,
          capability_ids = EXCLUDED.capability_ids,
          updated_at = NOW()
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

  if (teams.length > 0) {
    await client.query(
      `DELETE FROM workspace_teams WHERE id <> ALL($1::text[])`,
      [teams.map(team => team.id)],
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

const replaceCapabilityGrantsTx = async (
  client: PoolClient,
  grants: CapabilityGrant[],
) => {
  await client.query(`DELETE FROM capability_grants`);
  for (const grant of grants) {
    await client.query(
      `
        INSERT INTO capability_grants (
          id,
          capability_id,
          user_id,
          team_id,
          actions,
          note,
          created_by_user_id,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      `,
      [
        grant.id,
        grant.capabilityId,
        grant.userId || null,
        grant.teamId || null,
        grant.actions,
        grant.note || null,
        grant.createdByUserId || null,
      ],
    );
  }
};

const replaceDescendantAccessGrantsTx = async (
  client: PoolClient,
  grants: ExplicitDescendantAccessGrant[],
) => {
  await client.query(`DELETE FROM capability_descendant_access_grants`);
  for (const grant of grants) {
    await client.query(
      `
        INSERT INTO capability_descendant_access_grants (
          id,
          parent_capability_id,
          descendant_capability_id,
          user_id,
          team_id,
          actions,
          note,
          created_by_user_id,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      `,
      [
        grant.id,
        grant.parentCapabilityId,
        grant.descendantCapabilityId,
        grant.userId || null,
        grant.teamId || null,
        grant.actions,
        grant.note || null,
        grant.createdByUserId || null,
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
      capabilityGrants: updates.capabilityGrants ?? current.capabilityGrants,
      descendantAccessGrants:
        updates.descendantAccessGrants ?? current.descendantAccessGrants,
      externalIdentityLinks:
        updates.externalIdentityLinks ?? current.externalIdentityLinks,
      userPreferences: updates.userPreferences ?? current.userPreferences,
      notificationRules: updates.notificationRules ?? current.notificationRules,
      accessAuditEvents: current.accessAuditEvents,
      currentUserId: updates.currentUserId ?? current.currentUserId,
    });

    await replaceWorkspaceUsersTx(client, next.users);
    await replaceWorkspaceTeamsTx(client, next.teams);
    await replaceWorkspaceMembershipsTx(client, next.memberships);
    await replaceCapabilityMembershipsTx(client, next.capabilityMemberships);
    await replaceCapabilityGrantsTx(client, next.capabilityGrants);
    await replaceDescendantAccessGrantsTx(client, next.descendantAccessGrants);
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
    await replaceCapabilityGrantsTx(client, next.capabilityGrants);
    await replaceDescendantAccessGrantsTx(client, next.descendantAccessGrants);
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

export const appendAccessAuditEvent = async (
  event: AccessAuditEvent,
): Promise<AccessAuditEvent> => {
  const result = await query(
    `
      INSERT INTO access_audit_events (
        id,
        actor_user_id,
        actor_display_name,
        action,
        target_type,
        target_id,
        capability_id,
        summary,
        metadata,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `,
    [
      event.id,
      event.actorUserId || null,
      event.actorDisplayName,
      event.action,
      event.targetType,
      event.targetId,
      event.capabilityId || null,
      event.summary,
      JSON.stringify(event.metadata || {}),
      event.createdAt,
    ],
  );

  return accessAuditEventFromRow(result.rows[0]);
};
