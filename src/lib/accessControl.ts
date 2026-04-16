import type {
  ActorContext,
  Capability,
  CapabilityAccessRole,
  CapabilityGrant,
  CapabilityMembership,
  CapabilityVisibilityScope,
  ExplicitDescendantAccessGrant,
  EffectivePermissionSet,
  InheritedRollupAccess,
  PermissionAction,
  WorkspaceOrganization,
  WorkspaceRole,
  CapabilityWorkspace,
} from '../types';
import { normalizeCapabilityKind } from './capabilityArchitecture';
import { createEmptyCapabilityContractDraft } from './capabilityArchitecture';

const uniq = <T,>(values: T[]) => Array.from(new Set(values));

export const ALL_PERMISSION_ACTIONS: PermissionAction[] = [
  'workspace.manage',
  'access.manage',
  'capability.create',
  'capability.read',
  'capability.read.rollup',
  'capability.edit',
  'workflow.edit',
  'agents.manage',
  'contract.publish',
  'workitem.read',
  'workitem.create',
  'workitem.control',
  'workitem.restart',
  'approval.decide',
  'artifact.read',
  'artifact.publish',
  'telemetry.read',
  'chat.read',
  'chat.write',
  'report.view.operations',
  'report.view.portfolio',
  'report.view.executive',
  'report.view.audit',
];

const LIVE_DETAIL_ACTIONS: PermissionAction[] = [
  'capability.read',
  'capability.edit',
  'workflow.edit',
  'agents.manage',
  'contract.publish',
  'workitem.read',
  'workitem.create',
  'workitem.control',
  'workitem.restart',
  'approval.decide',
  'artifact.read',
  'artifact.publish',
  'telemetry.read',
  'chat.read',
  'chat.write',
];

const WORKSPACE_ROLE_ACTIONS: Record<WorkspaceRole, PermissionAction[]> = {
  WORKSPACE_ADMIN: ALL_PERMISSION_ACTIONS,
  PORTFOLIO_OWNER: [
    'capability.create',
    'capability.read.rollup',
    'report.view.operations',
    'report.view.portfolio',
    'report.view.executive',
    'report.view.audit',
  ],
  TEAM_LEAD: [
    'capability.read',
    'workitem.read',
    'approval.decide',
    'artifact.read',
    'telemetry.read',
    'chat.read',
    'report.view.operations',
  ],
  OPERATOR: [
    'capability.read',
    'workitem.read',
    'workitem.create',
    'workitem.control',
    'workitem.restart',
    'artifact.read',
    'telemetry.read',
    'chat.read',
    'chat.write',
    'report.view.operations',
  ],
  AUDITOR: [
    'capability.read.rollup',
    'artifact.read',
    'telemetry.read',
    'report.view.audit',
    'report.view.operations',
    'report.view.portfolio',
  ],
  VIEWER: ['capability.read.rollup'],
};

const CAPABILITY_ROLE_ACTIONS: Record<CapabilityAccessRole, PermissionAction[]> = {
  OWNER: [
    'capability.read',
    'capability.read.rollup',
    'capability.edit',
    'workflow.edit',
    'agents.manage',
    'contract.publish',
    'workitem.read',
    'workitem.create',
    'workitem.control',
    'workitem.restart',
    'approval.decide',
    'artifact.read',
    'artifact.publish',
    'telemetry.read',
    'chat.read',
    'chat.write',
    'report.view.operations',
    'report.view.portfolio',
  ],
  OPERATOR: [
    'capability.read',
    'capability.read.rollup',
    'workitem.read',
    'workitem.create',
    'workitem.control',
    'workitem.restart',
    'artifact.read',
    'telemetry.read',
    'chat.read',
    'chat.write',
    'report.view.operations',
  ],
  APPROVER: [
    'capability.read',
    'capability.read.rollup',
    'workitem.read',
    'approval.decide',
    'artifact.read',
    'report.view.operations',
  ],
  VIEWER: ['capability.read', 'capability.read.rollup', 'artifact.read'],
};

const normalizeCapabilityVisibilityScope = (
  value?: CapabilityVisibilityScope,
): CapabilityVisibilityScope =>
  value === 'LIVE_DETAIL' || value === 'ROLLUP_ONLY' ? value : 'NONE';

const getActorIdentity = (
  organization: WorkspaceOrganization,
  actor?: ActorContext | null,
) => {
  const fallbackUser =
    organization.users.find(user => user.id === organization.currentUserId) ||
    organization.users[0];
  const currentUser =
    (actor?.userId
      ? organization.users.find(user => user.id === actor.userId)
      : null) || fallbackUser;
  const actorTeamIds = uniq([
    ...(currentUser?.teamIds || []),
    ...(actor?.teamIds || []),
  ]).filter(Boolean);
  const workspaceRoles = uniq([
    ...(currentUser?.workspaceRoles || []),
    ...(actor?.workspaceRoles || []),
  ]) as WorkspaceRole[];

  return {
    userId: currentUser?.id,
    displayName: actor?.displayName || currentUser?.name || 'Workspace Operator',
    teamIds: actorTeamIds,
    workspaceRoles,
  };
};

export const evaluateWorkspacePermissions = ({
  organization,
  actor,
}: {
  organization: WorkspaceOrganization;
  actor?: ActorContext | null;
}): EffectivePermissionSet => {
  const identity = getActorIdentity(organization, actor);
  const allowedActions = uniq(getRoleBasedActions(identity.workspaceRoles));

  return {
    actorUserId: identity.userId,
    actorDisplayName: identity.displayName,
    capabilityId: undefined,
    workspaceRoles: identity.workspaceRoles,
    capabilityRoles: [],
    allowedActions,
    visibilityScope: 'NONE',
    inheritedRollupAccess: [],
    explicitDescendantGrantIds: [],
    reasoning:
      identity.workspaceRoles.length > 0
        ? [`Workspace roles: ${identity.workspaceRoles.join(', ')}.`]
        : ['No workspace-wide role grants are active.'],
  };
};

const matchesGrantTarget = (
  actorUserId: string | undefined,
  actorTeamIds: string[],
  grant: Pick<CapabilityGrant, 'userId' | 'teamId'>,
) =>
  Boolean(
    (grant.userId && actorUserId && grant.userId === actorUserId) ||
      (grant.teamId && actorTeamIds.includes(grant.teamId)),
  );

const getCapabilityAncestors = (capability: Capability, capabilities: Capability[]) => {
  const byId = new Map(capabilities.map(item => [item.id, item]));
  const seen = new Set<string>();
  const ancestorIds: string[] = [];
  let cursor = capability.parentCapabilityId;

  while (cursor && !seen.has(cursor)) {
    ancestorIds.push(cursor);
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentCapabilityId;
  }

  return ancestorIds;
};

const getRoleBasedActions = (roles: WorkspaceRole[]) =>
  roles.flatMap(role => WORKSPACE_ROLE_ACTIONS[role] || []);

const getCapabilityMemberships = ({
  organization,
  capabilityId,
  actorUserId,
  actorTeamIds,
}: {
  organization: WorkspaceOrganization;
  capabilityId: string;
  actorUserId?: string;
  actorTeamIds: string[];
}): CapabilityMembership[] =>
  (organization.capabilityMemberships || []).filter(
    membership =>
      membership.capabilityId === capabilityId &&
      ((actorUserId && membership.userId === actorUserId) ||
        (membership.teamId && actorTeamIds.includes(membership.teamId))),
  );

const getCapabilityGrants = ({
  organization,
  capabilityId,
  actorUserId,
  actorTeamIds,
}: {
  organization: WorkspaceOrganization;
  capabilityId: string;
  actorUserId?: string;
  actorTeamIds: string[];
}) =>
  (organization.capabilityGrants || []).filter(
    grant =>
      grant.capabilityId === capabilityId &&
      matchesGrantTarget(actorUserId, actorTeamIds, grant),
  );

const getExplicitDescendantGrants = ({
  organization,
  capability,
  capabilities,
  actorUserId,
  actorTeamIds,
}: {
  organization: WorkspaceOrganization;
  capability: Capability;
  capabilities: Capability[];
  actorUserId?: string;
  actorTeamIds: string[];
}) => {
  const ancestorIds = getCapabilityAncestors(capability, capabilities);
  return (organization.descendantAccessGrants || []).filter(
    grant =>
      grant.descendantCapabilityId === capability.id &&
      ancestorIds.includes(grant.parentCapabilityId) &&
      matchesGrantTarget(actorUserId, actorTeamIds, grant),
  );
};

export const evaluateCapabilityPermissions = ({
  organization,
  capability,
  capabilities,
  actor,
}: {
  organization: WorkspaceOrganization;
  capability: Capability;
  capabilities: Capability[];
  actor?: ActorContext | null;
}): EffectivePermissionSet => {
  const identity = getActorIdentity(organization, actor);
  const memberships = getCapabilityMemberships({
    organization,
    capabilityId: capability.id,
    actorUserId: identity.userId,
    actorTeamIds: identity.teamIds,
  });
  const capabilityRoles = uniq(memberships.map(membership => membership.role));
  const capabilityGrants = getCapabilityGrants({
    organization,
    capabilityId: capability.id,
    actorUserId: identity.userId,
    actorTeamIds: identity.teamIds,
  });
  const descendantGrants = getExplicitDescendantGrants({
    organization,
    capability,
    capabilities,
    actorUserId: identity.userId,
    actorTeamIds: identity.teamIds,
  });
  const allowedActions = new Set<PermissionAction>([
    ...getRoleBasedActions(identity.workspaceRoles),
    ...capabilityRoles.flatMap(role => CAPABILITY_ROLE_ACTIONS[role] || []),
    ...capabilityGrants.flatMap(grant => grant.actions || []),
    ...descendantGrants.flatMap(grant => grant.actions || []),
  ]);
  const inheritedRollupAccess: InheritedRollupAccess[] = [];
  const reasoning: string[] = [];

  if (identity.workspaceRoles.includes('WORKSPACE_ADMIN')) {
    reasoning.push('Workspace admin access grants live detail across all capabilities.');
  }

  const ancestorIds = getCapabilityAncestors(capability, capabilities);
  for (const ancestorId of ancestorIds) {
    const sourceCapability = capabilities.find(item => item.id === ancestorId);
    const sourceMemberships = getCapabilityMemberships({
      organization,
      capabilityId: ancestorId,
      actorUserId: identity.userId,
      actorTeamIds: identity.teamIds,
    });
    const sourceGrants = getCapabilityGrants({
      organization,
      capabilityId: ancestorId,
      actorUserId: identity.userId,
      actorTeamIds: identity.teamIds,
    });
    if (
      sourceMemberships.length > 0 ||
      sourceGrants.length > 0 ||
      identity.workspaceRoles.includes('PORTFOLIO_OWNER') ||
      identity.workspaceRoles.includes('AUDITOR') ||
      identity.workspaceRoles.includes('WORKSPACE_ADMIN')
    ) {
      inheritedRollupAccess.push({
        capabilityId: capability.id,
        sourceCapabilityId: ancestorId,
        sourceCapabilityName: sourceCapability?.name,
        reason:
          sourceMemberships.length > 0 || sourceGrants.length > 0
            ? 'Inherited from parent or collection access.'
            : 'Inherited from workspace-wide portfolio visibility.',
      });
    }
  }

  let visibilityScope: CapabilityVisibilityScope = 'NONE';
  if (
    identity.workspaceRoles.includes('WORKSPACE_ADMIN') ||
    Array.from(allowedActions).some(action => LIVE_DETAIL_ACTIONS.includes(action))
  ) {
    visibilityScope = 'LIVE_DETAIL';
    allowedActions.add('capability.read');
    allowedActions.add('capability.read.rollup');
    reasoning.push('Live capability detail is available through direct grants or elevated workspace role.');
  } else if (
    inheritedRollupAccess.length > 0 ||
    identity.workspaceRoles.includes('PORTFOLIO_OWNER') ||
    identity.workspaceRoles.includes('AUDITOR') ||
    allowedActions.has('capability.read.rollup')
  ) {
    visibilityScope = 'ROLLUP_ONLY';
    allowedActions.add('capability.read.rollup');
    reasoning.push('Only published rollups are visible for this capability.');
  }

  if (
    normalizeCapabilityKind(capability.capabilityKind, capability.collectionKind) ===
      'COLLECTION' &&
    visibilityScope === 'LIVE_DETAIL'
  ) {
    allowedActions.delete('workitem.create');
    allowedActions.delete('workitem.control');
    allowedActions.delete('workitem.restart');
    allowedActions.delete('approval.decide');
    allowedActions.delete('artifact.publish');
    allowedActions.delete('telemetry.read');
    reasoning.push('Collection capabilities remain non-executable even when metadata access is granted.');
  }

  if (capabilityRoles.length > 0) {
    reasoning.push(
      `Capability roles: ${capabilityRoles.join(', ')}.`,
    );
  }
  if (capabilityGrants.length > 0) {
    reasoning.push('Explicit capability grants extend this actor’s access.');
  }
  if (descendantGrants.length > 0) {
    reasoning.push('Explicit descendant grants unlock deeper child visibility.');
  }

  return {
    actorUserId: identity.userId,
    actorDisplayName: identity.displayName,
    capabilityId: capability.id,
    workspaceRoles: identity.workspaceRoles,
    capabilityRoles,
    allowedActions: uniq(Array.from(allowedActions)),
    visibilityScope: normalizeCapabilityVisibilityScope(visibilityScope),
    inheritedRollupAccess,
    explicitDescendantGrantIds: descendantGrants.map(grant => grant.id),
    reasoning,
  };
};

export const hasPermission = (
  permissionSet: EffectivePermissionSet | undefined,
  action: PermissionAction,
) => Boolean(permissionSet?.allowedActions.includes(action));

export const canReadCapabilityRollup = (permissionSet?: EffectivePermissionSet) =>
  Boolean(
    permissionSet &&
      (permissionSet.visibilityScope === 'ROLLUP_ONLY' ||
        permissionSet.visibilityScope === 'LIVE_DETAIL') &&
      hasPermission(permissionSet, 'capability.read.rollup'),
  );

export const canReadCapabilityLiveDetail = (permissionSet?: EffectivePermissionSet) =>
  Boolean(
    permissionSet &&
      permissionSet.visibilityScope === 'LIVE_DETAIL' &&
      hasPermission(permissionSet, 'capability.read'),
  );

export const sanitizeCapabilityForRollupAccess = (capability: Capability): Capability => ({
  ...capability,
  gitRepositories: [],
  localDirectories: [],
  repositories: [],
  skillLibrary: [],
  contractDraft: createEmptyCapabilityContractDraft(),
  executionConfig: {
    ...capability.executionConfig,
    defaultWorkspacePath: undefined,
    allowedWorkspacePaths: [],
    commandTemplates: [],
    deploymentTargets: [],
  },
});

export const sanitizeWorkspaceForRollupAccess = (
  workspace: CapabilityWorkspace,
): CapabilityWorkspace => ({
  ...workspace,
  agents: [],
  workflows: [],
  artifacts: [],
  tasks: [],
  executionLogs: [],
  learningUpdates: [],
  workItems: [],
  messages: [],
  activeChatAgentId: undefined,
});

export const buildAuthorizedCapabilityState = ({
  capability,
  workspace,
  capabilities,
  organization,
  actor,
}: {
  capability: Capability;
  workspace: CapabilityWorkspace;
  capabilities: Capability[];
  organization: WorkspaceOrganization;
  actor?: ActorContext | null;
}) => {
  const permissionSet = evaluateCapabilityPermissions({
    organization,
    capability,
    capabilities,
    actor,
  });

  if (permissionSet.visibilityScope === 'NONE') {
    return null;
  }

  if (permissionSet.visibilityScope === 'ROLLUP_ONLY') {
    return {
      capability: {
        ...sanitizeCapabilityForRollupAccess(capability),
        effectivePermissions: permissionSet,
      },
      workspace: sanitizeWorkspaceForRollupAccess(workspace),
    };
  }

  return {
    capability: {
      ...capability,
      effectivePermissions: permissionSet,
    },
    workspace,
  };
};

export const buildAuthorizedAppState = <
  T extends {
    capabilities: Capability[];
    capabilityWorkspaces: CapabilityWorkspace[];
    workspaceOrganization: WorkspaceOrganization;
  },
>(
  state: T,
  actor?: ActorContext | null,
) => {
  const authorized = state.capabilities
    .map(capability => {
      const workspace = state.capabilityWorkspaces.find(
        item => item.capabilityId === capability.id,
      );
      if (!workspace) {
        return null;
      }
      return buildAuthorizedCapabilityState({
        capability,
        workspace,
        capabilities: state.capabilities,
        organization: state.workspaceOrganization,
        actor,
      });
    })
    .filter(Boolean) as Array<{ capability: Capability; workspace: CapabilityWorkspace }>;

  return {
    ...state,
    capabilities: authorized.map(item => item.capability),
    capabilityWorkspaces: authorized.map(item => item.workspace),
  };
};
