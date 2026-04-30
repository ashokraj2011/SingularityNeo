import type {
  ActorContext,
  CapabilityAccessSnapshot,
  EffectivePermissionSet,
  PermissionAction,
  WorkspaceAccessSnapshot,
  WorkspaceOrganization,
} from '../src/types';
import {
  buildAuthorizedAppState,
  evaluateCapabilityPermissions,
  evaluateWorkspacePermissions,
  hasPermission,
} from '../src/lib/accessControl';
import { fetchAppState } from './domains/self-service/repository';
import {
  appendAccessAuditEvent,
  getWorkspaceOrganization,
  updateWorkspaceOrganization,
} from './workspaceOrganization';

const createAccessEventId = () =>
  `AUDIT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

export const getAuthorizedAppState = async (actor?: ActorContext | null) =>
  buildAuthorizedAppState(await fetchAppState(), actor);

export const getWorkspaceAccessSnapshot = async (
  actor?: ActorContext | null,
): Promise<WorkspaceAccessSnapshot> => {
  const organization = await getWorkspaceOrganization();
  return {
    organization,
    currentActorPermissions: evaluateWorkspacePermissions({ organization, actor }),
  };
};

export const getCapabilityAccessSnapshot = async (
  capabilityId: string,
  actor?: ActorContext | null,
): Promise<CapabilityAccessSnapshot> => {
  const state = await fetchAppState();
  const capability = state.capabilities.find(item => item.id === capabilityId);
  if (!capability) {
    throw new Error(`Capability ${capabilityId} was not found.`);
  }
  const currentActorPermissions = evaluateCapabilityPermissions({
    organization: state.workspaceOrganization,
    capability,
    capabilities: state.capabilities,
    actor,
  });

  return {
    capabilityId,
    capabilityMemberships: state.workspaceOrganization.capabilityMemberships.filter(
      membership => membership.capabilityId === capabilityId,
    ),
    capabilityGrants: state.workspaceOrganization.capabilityGrants.filter(
      grant => grant.capabilityId === capabilityId,
    ),
    descendantAccessGrants:
      state.workspaceOrganization.descendantAccessGrants.filter(
        grant => grant.parentCapabilityId === capabilityId,
      ),
    inheritedRollupAccess: currentActorPermissions.inheritedRollupAccess,
    currentActorPermissions,
  };
};

export const updateWorkspaceAccessSnapshot = async ({
  updates,
  actor,
}: {
  updates: Partial<WorkspaceOrganization>;
  actor?: ActorContext | null;
}): Promise<WorkspaceAccessSnapshot> => {
  const next = await updateWorkspaceOrganization({
    users: updates.users,
    teams: updates.teams,
    memberships: updates.memberships,
    externalIdentityLinks: updates.externalIdentityLinks,
    notificationRules: updates.notificationRules,
  });
  await appendAccessAuditEvent({
    id: createAccessEventId(),
    actorUserId: actor?.userId,
    actorDisplayName: actor?.displayName || 'Workspace Operator',
    action: 'workspace.access.updated',
    targetType: 'WORKSPACE_TEAM',
    targetId: 'workspace-access',
    summary: 'Workspace users, teams, or notification access settings were updated.',
    metadata: {
      userCount: next.users.length,
      teamCount: next.teams.length,
      membershipCount: next.memberships.length,
    },
    createdAt: new Date().toISOString(),
  });
  return {
    organization: next,
    currentActorPermissions: evaluateWorkspacePermissions({
      organization: next,
      actor,
    }),
  };
};

export const updateCapabilityAccessSnapshot = async ({
  capabilityId,
  updates,
  actor,
}: {
  capabilityId: string;
  updates: Partial<CapabilityAccessSnapshot>;
  actor?: ActorContext | null;
}): Promise<CapabilityAccessSnapshot> => {
  const current = await getWorkspaceOrganization();
  const next = await updateWorkspaceOrganization({
    capabilityMemberships: updates.capabilityMemberships
      ? [
          ...current.capabilityMemberships.filter(
            membership => membership.capabilityId !== capabilityId,
          ),
          ...updates.capabilityMemberships,
        ]
      : current.capabilityMemberships,
    capabilityGrants: updates.capabilityGrants
      ? [
          ...current.capabilityGrants.filter(
            grant => grant.capabilityId !== capabilityId,
          ),
          ...updates.capabilityGrants,
        ]
      : current.capabilityGrants,
    descendantAccessGrants: updates.descendantAccessGrants
      ? [
          ...current.descendantAccessGrants.filter(
            grant => grant.parentCapabilityId !== capabilityId,
          ),
          ...updates.descendantAccessGrants,
        ]
      : current.descendantAccessGrants,
  });

  await appendAccessAuditEvent({
    id: createAccessEventId(),
    actorUserId: actor?.userId,
    actorDisplayName: actor?.displayName || 'Workspace Operator',
    action: 'capability.access.updated',
    targetType: 'CAPABILITY_ACCESS',
    targetId: capabilityId,
    capabilityId,
    summary: 'Capability access grants or descendant visibility were updated.',
    metadata: {
      capabilityMembershipCount: next.capabilityMemberships.filter(
        membership => membership.capabilityId === capabilityId,
      ).length,
      capabilityGrantCount: next.capabilityGrants.filter(
        grant => grant.capabilityId === capabilityId,
      ).length,
      descendantGrantCount: next.descendantAccessGrants.filter(
        grant => grant.parentCapabilityId === capabilityId,
      ).length,
    },
    createdAt: new Date().toISOString(),
  });

  return getCapabilityAccessSnapshot(capabilityId, actor);
};

export const assertWorkspacePermission = async ({
  actor,
  action,
}: {
  actor?: ActorContext | null;
  action: PermissionAction;
}): Promise<EffectivePermissionSet> => {
  const organization = await getWorkspaceOrganization();
  const permissionSet = evaluateWorkspacePermissions({ organization, actor });
  if (!hasPermission(permissionSet, action)) {
    throw new Error(`Forbidden: ${action} is not allowed for the current actor.`);
  }
  return permissionSet;
};

export const assertCapabilityPermission = async ({
  capabilityId,
  actor,
  action,
}: {
  capabilityId: string;
  actor?: ActorContext | null;
  action: PermissionAction;
}) => {
  const state = await fetchAppState();
  const capability = state.capabilities.find(item => item.id === capabilityId);
  if (!capability) {
    throw new Error(`Capability ${capabilityId} was not found.`);
  }
  const permissionSet = evaluateCapabilityPermissions({
    organization: state.workspaceOrganization,
    capability,
    capabilities: state.capabilities,
    actor,
  });

  if (!hasPermission(permissionSet, action)) {
    throw new Error(`Forbidden: ${action} is not allowed for ${capability.name}.`);
  }

  if (
    permissionSet.visibilityScope !== 'LIVE_DETAIL' &&
    action !== 'capability.read.rollup' &&
    action !== 'report.view.portfolio' &&
    action !== 'report.view.executive'
  ) {
    throw new Error(
      `Forbidden: ${capability.name} is only visible through published rollups for the current actor.`,
    );
  }

  return { state, capability, permissionSet };
};
