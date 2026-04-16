import React, { useMemo, useState } from 'react';
import { KeyRound, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { updateWorkspaceOrganizationRecord } from '../lib/api';
import { evaluateWorkspacePermissions, hasPermission } from '../lib/accessControl';
import type { WorkspaceMembership, WorkspaceRole, WorkspaceTeam, WorkspaceUser } from '../types';

const PLATFORM_TEAM_ID = 'TEAM-PLATFORM-OPERATIONS';

const ROLE_USER_TEMPLATES: Array<Pick<
  WorkspaceUser,
  'id' | 'name' | 'email' | 'title' | 'status' | 'teamIds' | 'workspaceRoles'
>> = [
  {
    id: 'USR-PORTFOLIO-OWNER',
    name: 'Portfolio Owner',
    email: 'portfolio@local.workspace',
    title: 'Portfolio Owner',
    status: 'ACTIVE',
    teamIds: [PLATFORM_TEAM_ID],
    workspaceRoles: ['PORTFOLIO_OWNER'],
  },
  {
    id: 'USR-TEAM-LEAD',
    name: 'Team Lead',
    email: 'lead@local.workspace',
    title: 'Team Lead',
    status: 'ACTIVE',
    teamIds: [PLATFORM_TEAM_ID],
    workspaceRoles: ['TEAM_LEAD'],
  },
  {
    id: 'USR-OPERATOR',
    name: 'Operator',
    email: 'operator+runtime@local.workspace',
    title: 'Operator',
    status: 'ACTIVE',
    teamIds: [PLATFORM_TEAM_ID],
    workspaceRoles: ['OPERATOR'],
  },
  {
    id: 'USR-AUDITOR',
    name: 'Auditor',
    email: 'auditor@local.workspace',
    title: 'Auditor',
    status: 'ACTIVE',
    teamIds: [PLATFORM_TEAM_ID],
    workspaceRoles: ['AUDITOR'],
  },
  {
    id: 'USR-VIEWER',
    name: 'Viewer',
    email: 'viewer@local.workspace',
    title: 'Viewer',
    status: 'ACTIVE',
    teamIds: [PLATFORM_TEAM_ID],
    workspaceRoles: ['VIEWER'],
  },
];

const uniq = <T,>(values: T[]) => Array.from(new Set(values));

const ensurePlatformTeam = (teams: WorkspaceTeam[], userIds: string[]) => {
  const existing = teams.find(team => team.id === PLATFORM_TEAM_ID);
  if (existing) {
    return teams.map(team =>
      team.id === PLATFORM_TEAM_ID
        ? {
            ...team,
            memberUserIds: uniq([...(team.memberUserIds || []), ...userIds]),
          }
        : team,
    );
  }

  return [
    {
      id: PLATFORM_TEAM_ID,
      name: 'Platform Operations',
      description: 'Default workspace operating team.',
      memberUserIds: uniq(userIds),
      capabilityIds: [],
    },
    ...teams,
  ];
};

const ensurePlatformMemberships = (memberships: WorkspaceMembership[], userIds: string[]) => {
  const next = new Map(memberships.map(membership => [membership.id, membership]));

  for (const userId of userIds) {
    const membershipId = `MEM-${userId}-${PLATFORM_TEAM_ID}`;
    if (next.has(membershipId)) {
      continue;
    }
    next.set(membershipId, {
      id: membershipId,
      userId,
      teamId: PLATFORM_TEAM_ID,
      role: 'MEMBER',
    });
  }

  return Array.from(next.values());
};

const formatRoles = (roles?: WorkspaceRole[]) =>
  roles && roles.length > 0 ? roles.join(', ') : 'No workspace roles';

const Login = () => {
  const navigate = useNavigate();
  const { success, error: showError } = useToast();
  const {
    workspaceOrganization,
    currentWorkspaceUserId,
    currentActorContext,
    setCurrentWorkspaceUserId,
    retryInitialSync,
  } = useCapability();

  const users = workspaceOrganization.users || [];
  const initialSelection =
    currentWorkspaceUserId ||
    workspaceOrganization.currentUserId ||
    users[0]?.id ||
    '';
  const [selectedUserId, setSelectedUserId] = useState(initialSelection);
  const [isSeeding, setIsSeeding] = useState(false);

  const selectedUser = useMemo(
    () => users.find(user => user.id === selectedUserId) || null,
    [selectedUserId, users],
  );

  const permissions = useMemo(
    () =>
      evaluateWorkspacePermissions({
        organization: workspaceOrganization,
        actor: currentActorContext,
      }),
    [currentActorContext, workspaceOrganization],
  );
  const canManageAccess = hasPermission(permissions, 'access.manage');

  const handleContinue = () => {
    if (!selectedUserId) {
      return;
    }
    setCurrentWorkspaceUserId(selectedUserId);
    success('Login updated', `Operating as ${selectedUser?.name || selectedUserId}.`);
    navigate('/');
  };

  const seedRoleAccounts = async () => {
    if (!canManageAccess) {
      showError(
        'Access denied',
        'You need access.manage to create additional workspace users.',
      );
      return;
    }

    setIsSeeding(true);
    try {
      const existingById = new Map(users.map(user => [user.id, user]));
      const nextUsers: WorkspaceUser[] = [...users];

      for (const template of ROLE_USER_TEMPLATES) {
        if (existingById.has(template.id)) {
          continue;
        }
        nextUsers.push({
          ...template,
        });
      }

      const nextUserIds = nextUsers.map(user => user.id);
      const nextTeams = ensurePlatformTeam(workspaceOrganization.teams || [], nextUserIds);
      const nextMemberships = ensurePlatformMemberships(
        workspaceOrganization.memberships || [],
        nextUserIds,
      );

      await updateWorkspaceOrganizationRecord({
        users: nextUsers,
        teams: nextTeams,
        memberships: nextMemberships,
      });
      await retryInitialSync();
      success('Role accounts created', 'You can now switch operators from this screen.');
    } catch (error) {
      showError(
        'Unable to create role accounts',
        error instanceof Error ? error.message : 'Workspace user seeding failed.',
      );
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Identity"
        context="Workspace session"
        title="Login"
        description="Pick who you are in this workspace. Roles are evaluated on the server for every action."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/access')}
              className="enterprise-button enterprise-button-secondary"
            >
              <ShieldCheck size={16} />
              Users & Access
            </button>
            <button
              type="button"
              onClick={handleContinue}
              disabled={!selectedUserId}
              className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KeyRound size={16} />
              Continue
            </button>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <StatTile
            label="Signed-in actor"
            value={selectedUser?.name || 'Unknown'}
            helper={
              selectedUser ? (
                <span className="text-xs text-secondary">{selectedUser.email}</span>
              ) : (
                <span className="text-xs text-secondary">Pick a workspace operator.</span>
              )
            }
            tone="brand"
          />
          <StatTile
            label="Workspace roles"
            value={selectedUser ? formatRoles(selectedUser.workspaceRoles) : 'None'}
            helper={
              <span className="text-xs text-secondary">
                These roles drive `workspace.manage`, `access.manage`, reports, and
                rollout visibility.
              </span>
            }
            icon={ShieldCheck}
            tone="info"
          />
          <StatTile
            label="Access status"
            value={canManageAccess ? 'Admin ready' : 'Limited'}
            helper={
              <span className="text-xs text-secondary">
                {canManageAccess
                  ? 'You can manage users, grants, and workspace settings.'
                  : 'Ask a workspace admin to grant access.manage.'}
              </span>
            }
            icon={KeyRound}
            tone={canManageAccess ? 'success' : 'warning'}
          />
        </div>
      </PageHeader>

      <SectionCard
        title="Workspace operators"
        description="Switch the active operator for API calls, approvals, and audit trails."
        icon={Users}
        action={
          canManageAccess ? (
            <button
              type="button"
              onClick={() => void seedRoleAccounts()}
              disabled={isSeeding}
              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-60"
              title="Create standard role accounts (admin/operator/auditor/viewer)"
            >
              <UserPlus size={16} />
              {isSeeding ? 'Seeding…' : 'Create role accounts'}
            </button>
          ) : (
            <StatusBadge tone="warning">Requires access.manage</StatusBadge>
          )
        }
      >
        {users.length === 0 ? (
          <EmptyState
            title="No workspace users"
            description="The backend has not seeded any workspace principals yet. Create one via Users & Access."
            icon={Users}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {users.map(user => {
              const isSelected = user.id === selectedUserId;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUserId(user.id)}
                  className={
                    isSelected
                      ? 'rounded-2xl border border-primary/20 bg-primary/5 p-4 text-left shadow-[0_10px_26px_rgba(0,132,61,0.08)] transition hover:bg-primary/10'
                      : 'rounded-2xl border border-outline-variant/60 bg-white p-4 text-left shadow-[0_10px_26px_rgba(12,23,39,0.04)] transition hover:border-primary/20 hover:bg-surface-container-low'
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-on-surface">{user.name}</p>
                        {user.workspaceRoles?.length ? (
                          <StatusBadge tone="brand">
                            {user.workspaceRoles.join(', ')}
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">No roles</StatusBadge>
                        )}
                      </div>
                      <p className="text-xs text-secondary">
                        {user.title || 'Workspace user'} • {user.email}
                      </p>
                      <p className="text-[0.7rem] font-mono text-outline">{user.id}</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-outline-variant/60 bg-surface-container-low text-sm font-bold text-primary">
                      {user.name.slice(0, 1).toUpperCase()}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default Login;
