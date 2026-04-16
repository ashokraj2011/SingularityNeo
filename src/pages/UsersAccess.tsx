import React, { useEffect, useState } from 'react';
import {
  KeyRound,
  ShieldCheck,
  Users,
  Building2,
  Bell,
  History,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import {
  fetchCapabilityAccessSnapshot,
  fetchWorkspaceAccessSnapshot,
  updateCapabilityAccessSnapshot,
  updateWorkspaceAccessSnapshot,
} from '../lib/api';
import { PageHeader, SectionCard, EmptyState, StatusBadge } from '../components/EnterpriseUI';
import type {
  CapabilityAccessRole,
  CapabilityAccessSnapshot,
  CapabilityGrant,
  ExplicitDescendantAccessGrant,
  PermissionAction,
  WorkspaceAccessSnapshot,
  WorkspaceRole,
} from '../types';

const WORKSPACE_ROLE_OPTIONS: WorkspaceRole[] = [
  'WORKSPACE_ADMIN',
  'PORTFOLIO_OWNER',
  'TEAM_LEAD',
  'OPERATOR',
  'AUDITOR',
  'VIEWER',
];

const CAPABILITY_ROLE_OPTIONS: CapabilityAccessRole[] = [
  'OWNER',
  'OPERATOR',
  'APPROVER',
  'VIEWER',
];

const PERMISSION_OPTIONS: PermissionAction[] = [
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

const splitCsv = (value: string) =>
  Array.from(
    new Set(
      value
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean),
    ),
  );

const joinCsv = (values?: string[]) => (values || []).join(', ');

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const UsersAccess = () => {
  const { capabilities, currentActorContext } = useCapability();
  const { success, error: showError } = useToast();
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<WorkspaceAccessSnapshot | null>(null);
  const [capabilitySnapshot, setCapabilitySnapshot] = useState<CapabilityAccessSnapshot | null>(null);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [isSavingCapability, setIsSavingCapability] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadSnapshots = async (capabilityId?: string) => {
    setIsLoading(true);
    try {
      const nextWorkspace = await fetchWorkspaceAccessSnapshot();
      setWorkspaceSnapshot(nextWorkspace);
      const resolvedCapabilityId =
        capabilityId || selectedCapabilityId || capabilities[0]?.id || '';
      if (resolvedCapabilityId) {
        const nextCapability = await fetchCapabilityAccessSnapshot(resolvedCapabilityId);
        setCapabilitySnapshot(nextCapability);
        setSelectedCapabilityId(resolvedCapabilityId);
      } else {
        setCapabilitySnapshot(null);
      }
      setLoadError('');
    } catch (nextError) {
      setLoadError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to load workspace access settings.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSnapshots();
  }, []);

  const currentActorPermissions = workspaceSnapshot?.currentActorPermissions;
  const canManageAccess = currentActorPermissions?.allowedActions.includes('access.manage');

  const users = workspaceSnapshot?.organization.users || [];
  const teams = workspaceSnapshot?.organization.teams || [];
  const notificationRules = workspaceSnapshot?.organization.notificationRules || [];
  const accessAuditEvents = workspaceSnapshot?.organization.accessAuditEvents || [];
  const externalIdentityLinks = workspaceSnapshot?.organization.externalIdentityLinks || [];

  const handleWorkspaceUserField = (
    userId: string,
    field: 'name' | 'email' | 'title' | 'status' | 'teamIds' | 'workspaceRoles',
    value: string,
  ) => {
    if (!workspaceSnapshot) {
      return;
    }
    setWorkspaceSnapshot({
      ...workspaceSnapshot,
      organization: {
        ...workspaceSnapshot.organization,
        users: workspaceSnapshot.organization.users.map(user =>
          user.id === userId
            ? {
                ...user,
                ...(field === 'teamIds'
                  ? { teamIds: splitCsv(value) }
                  : field === 'workspaceRoles'
                  ? { workspaceRoles: splitCsv(value) as WorkspaceRole[] }
                  : { [field]: value }),
              }
            : user,
        ),
      },
    });
  };

  const handleTeamField = (
    teamId: string,
    field: 'name' | 'description' | 'memberUserIds',
    value: string,
  ) => {
    if (!workspaceSnapshot) {
      return;
    }
    setWorkspaceSnapshot({
      ...workspaceSnapshot,
      organization: {
        ...workspaceSnapshot.organization,
        teams: workspaceSnapshot.organization.teams.map(team =>
          team.id === teamId
            ? {
                ...team,
                ...(field === 'memberUserIds'
                  ? { memberUserIds: splitCsv(value) }
                  : { [field]: value }),
              }
            : team,
        ),
      },
    });
  };

  const handleMembershipField = (
    membershipId: string,
    field: 'userId' | 'teamId' | 'role',
    value: string,
  ) => {
    if (!workspaceSnapshot) {
      return;
    }
    setWorkspaceSnapshot({
      ...workspaceSnapshot,
      organization: {
        ...workspaceSnapshot.organization,
        memberships: workspaceSnapshot.organization.memberships.map(membership =>
          membership.id === membershipId
            ? {
                ...membership,
                [field]: value,
              }
            : membership,
        ),
      },
    });
  };

  const saveWorkspaceAccess = async () => {
    if (!workspaceSnapshot) {
      return;
    }
    setIsSavingWorkspace(true);
    try {
      const syncedTeams = workspaceSnapshot.organization.teams.map(team => ({
        ...team,
        capabilityIds: team.capabilityIds || [],
      }));
      const syncedMemberships = workspaceSnapshot.organization.memberships.map(membership => ({
        ...membership,
        id: membership.id || `${membership.userId}:${membership.teamId}`,
      }));
      const next = await updateWorkspaceAccessSnapshot({
        users: workspaceSnapshot.organization.users,
        teams: syncedTeams,
        memberships: syncedMemberships,
        externalIdentityLinks,
        notificationRules,
      });
      setWorkspaceSnapshot(next);
      success('Access updated', 'Workspace users, teams, and memberships were saved.');
    } catch (nextError) {
      showError(
        'Unable to save workspace access',
        nextError instanceof Error ? nextError.message : 'The update failed.',
      );
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const handleCapabilityMembershipField = (
    membershipId: string,
    field: 'userId' | 'teamId' | 'role',
    value: string,
  ) => {
    if (!capabilitySnapshot) {
      return;
    }
    setCapabilitySnapshot({
      ...capabilitySnapshot,
      capabilityMemberships: capabilitySnapshot.capabilityMemberships.map(membership =>
        membership.id === membershipId
          ? {
              ...membership,
              [field]: value || undefined,
            }
          : membership,
      ),
    });
  };

  const handleCapabilityGrantField = (
    grantId: string,
    field: 'userId' | 'teamId' | 'actions' | 'note',
    value: string,
  ) => {
    if (!capabilitySnapshot) {
      return;
    }
    setCapabilitySnapshot({
      ...capabilitySnapshot,
      capabilityGrants: capabilitySnapshot.capabilityGrants.map(grant =>
        grant.id === grantId
          ? {
              ...grant,
              ...(field === 'actions'
                ? { actions: splitCsv(value) as PermissionAction[] }
                : { [field]: value || undefined }),
            }
          : grant,
      ),
    });
  };

  const handleDescendantGrantField = (
    grantId: string,
    field:
      | 'parentCapabilityId'
      | 'descendantCapabilityId'
      | 'userId'
      | 'teamId'
      | 'actions'
      | 'note',
    value: string,
  ) => {
    if (!capabilitySnapshot) {
      return;
    }
    setCapabilitySnapshot({
      ...capabilitySnapshot,
      descendantAccessGrants: capabilitySnapshot.descendantAccessGrants.map(grant =>
        grant.id === grantId
          ? {
              ...grant,
              ...(field === 'actions'
                ? { actions: splitCsv(value) as PermissionAction[] }
                : { [field]: value || undefined }),
            }
          : grant,
      ),
    });
  };

  const saveCapabilityAccess = async () => {
    if (!capabilitySnapshot) {
      return;
    }
    setIsSavingCapability(true);
    try {
      const next = await updateCapabilityAccessSnapshot(capabilitySnapshot.capabilityId, {
        capabilityMemberships: capabilitySnapshot.capabilityMemberships,
        capabilityGrants: capabilitySnapshot.capabilityGrants,
        descendantAccessGrants: capabilitySnapshot.descendantAccessGrants,
      });
      setCapabilitySnapshot(next);
      success('Capability access updated', 'Capability memberships and grants were saved.');
    } catch (nextError) {
      showError(
        'Unable to save capability access',
        nextError instanceof Error ? nextError.message : 'The update failed.',
      );
    } finally {
      setIsSavingCapability(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Users & Access"
          title="Workspace access control"
          description="Loading permission-aware users, teams, and reporting access."
        />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Users & Access"
          title="Workspace access control"
          description="Manage workspace users, teams, capability grants, and audit visibility."
          actions={
            <button
              type="button"
              onClick={() => void loadSnapshots(selectedCapabilityId)}
              className="enterprise-button enterprise-button-secondary"
            >
              <RefreshCw size={16} />
              Retry
            </button>
          }
        />
        <EmptyState
          icon={ShieldCheck}
          title="Access workspace unavailable"
          description={loadError}
        />
      </div>
    );
  }

  if (!workspaceSnapshot) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Users & Access"
        title="Workspace access control"
        description="Manage users, teams, capability grants, inherited rollup access, notifications, and access audit history from one place."
        actions={
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void loadSnapshots(selectedCapabilityId)}
              className="enterprise-button enterprise-button-secondary"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        }
      >
        <div className="grid max-w-5xl gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
            <p className="form-kicker">Current actor</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {currentActorContext.displayName}
            </p>
            <p className="mt-2 text-xs text-secondary">
              {currentActorPermissions?.workspaceRoles.join(', ') || 'No workspace roles'}
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
            <p className="form-kicker">Users</p>
            <p className="mt-2 text-2xl font-bold text-on-surface">{users.length}</p>
            <p className="mt-2 text-xs text-secondary">Workspace principals</p>
          </div>
          <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
            <p className="form-kicker">Teams</p>
            <p className="mt-2 text-2xl font-bold text-on-surface">{teams.length}</p>
            <p className="mt-2 text-xs text-secondary">Operational groups</p>
          </div>
          <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
            <p className="form-kicker">Access mode</p>
            <div className="mt-2">
              <StatusBadge tone={canManageAccess ? 'success' : 'warning'}>
                {canManageAccess ? 'Manage access enabled' : 'Read-only actor'}
              </StatusBadge>
            </div>
            <p className="mt-2 text-xs text-secondary">
              {canManageAccess
                ? 'This operator can edit workspace and capability access.'
                : 'This operator can inspect access, but cannot change it.'}
            </p>
          </div>
        </div>
      </PageHeader>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)]">
        <div className="space-y-6">
          <SectionCard
            title="User Directory"
            description="Workspace users, roles, and team alignment."
            icon={Users}
          >
            <div className="space-y-3">
              {workspaceSnapshot.organization.users.map(user => (
                <div
                  key={user.id}
                  className="rounded-2xl border border-outline-variant/45 bg-white p-4"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1 text-xs font-medium text-secondary">
                      Name
                      <input
                        value={user.name}
                        onChange={event =>
                          handleWorkspaceUserField(user.id, 'name', event.target.value)
                        }
                        disabled={!canManageAccess}
                        className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-secondary">
                      Email
                      <input
                        value={user.email}
                        onChange={event =>
                          handleWorkspaceUserField(user.id, 'email', event.target.value)
                        }
                        disabled={!canManageAccess}
                        className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-secondary">
                      Title
                      <input
                        value={user.title || ''}
                        onChange={event =>
                          handleWorkspaceUserField(user.id, 'title', event.target.value)
                        }
                        disabled={!canManageAccess}
                        className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-secondary">
                      Status
                      <select
                        value={user.status}
                        onChange={event =>
                          handleWorkspaceUserField(user.id, 'status', event.target.value)
                        }
                        disabled={!canManageAccess}
                        className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INVITED">INVITED</option>
                        <option value="DISABLED">DISABLED</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-xs font-medium text-secondary md:col-span-2">
                      Workspace roles
                      <input
                        value={joinCsv(user.workspaceRoles)}
                        onChange={event =>
                          handleWorkspaceUserField(
                            user.id,
                            'workspaceRoles',
                            event.target.value,
                          )
                        }
                        placeholder={WORKSPACE_ROLE_OPTIONS.join(', ')}
                        disabled={!canManageAccess}
                        className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-secondary md:col-span-2">
                      Team IDs
                      <input
                        value={joinCsv(user.teamIds)}
                        onChange={event =>
                          handleWorkspaceUserField(user.id, 'teamIds', event.target.value)
                        }
                        placeholder="platform-team, qa-team"
                        disabled={!canManageAccess}
                        className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            {canManageAccess ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setWorkspaceSnapshot({
                      ...workspaceSnapshot,
                      organization: {
                        ...workspaceSnapshot.organization,
                        users: [
                          ...workspaceSnapshot.organization.users,
                          {
                            id: createId('USER'),
                            name: 'New user',
                            email: 'new.user@workspace.local',
                            title: 'Operator',
                            status: 'INVITED',
                            teamIds: [],
                            workspaceRoles: ['VIEWER'],
                          },
                        ],
                      },
                    })
                  }
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Plus size={16} />
                  Add user
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setWorkspaceSnapshot({
                      ...workspaceSnapshot,
                      organization: {
                        ...workspaceSnapshot.organization,
                        memberships: [
                          ...workspaceSnapshot.organization.memberships,
                          {
                            id: createId('MEM'),
                            userId: workspaceSnapshot.organization.users[0]?.id || '',
                            teamId: workspaceSnapshot.organization.teams[0]?.id || '',
                            role: 'MEMBER',
                          },
                        ],
                      },
                    })
                  }
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Plus size={16} />
                  Add membership
                </button>
                <button
                  type="button"
                  onClick={() => void saveWorkspaceAccess()}
                  disabled={isSavingWorkspace}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ShieldCheck size={16} />
                  Save workspace access
                </button>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Team Directory"
            description="Operational teams and explicit memberships."
            icon={Building2}
          >
            <div className="space-y-3">
              {workspaceSnapshot.organization.teams.map(team => (
                <div
                  key={team.id}
                  className="rounded-2xl border border-outline-variant/45 bg-white p-4"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1 text-xs font-medium text-secondary">
                      Team name
                      <input
                        value={team.name}
                        onChange={event =>
                          handleTeamField(team.id, 'name', event.target.value)
                        }
                        disabled={!canManageAccess}
                        className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-secondary">
                      Description
                      <input
                        value={team.description || ''}
                        onChange={event =>
                          handleTeamField(team.id, 'description', event.target.value)
                        }
                        disabled={!canManageAccess}
                        className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-secondary md:col-span-2">
                      Member user IDs
                      <input
                        value={joinCsv(team.memberUserIds)}
                        onChange={event =>
                          handleTeamField(team.id, 'memberUserIds', event.target.value)
                        }
                        disabled={!canManageAccess}
                        className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                    </label>
                    <div className="md:col-span-2 rounded-xl border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-xs text-secondary">
                      Capabilities: {joinCsv(team.capabilityIds) || 'No capability ownership yet'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {workspaceSnapshot.organization.memberships.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-outline-variant/45 bg-surface-container-low p-4">
                <p className="form-kicker">Team memberships</p>
                <div className="mt-3 space-y-2">
                  {workspaceSnapshot.organization.memberships.map(membership => (
                    <div
                      key={membership.id}
                      className="grid gap-2 rounded-xl bg-white p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem]"
                    >
                      <input
                        value={membership.userId}
                        onChange={event =>
                          handleMembershipField(membership.id, 'userId', event.target.value)
                        }
                        disabled={!canManageAccess}
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <input
                        value={membership.teamId}
                        onChange={event =>
                          handleMembershipField(membership.id, 'teamId', event.target.value)
                        }
                        disabled={!canManageAccess}
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <select
                        value={membership.role}
                        onChange={event =>
                          handleMembershipField(membership.id, 'role', event.target.value)
                        }
                        disabled={!canManageAccess}
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      >
                        <option value="LEAD">LEAD</option>
                        <option value="MEMBER">MEMBER</option>
                        <option value="APPROVER">APPROVER</option>
                        <option value="VIEWER">VIEWER</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {canManageAccess ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setWorkspaceSnapshot({
                      ...workspaceSnapshot,
                      organization: {
                        ...workspaceSnapshot.organization,
                        teams: [
                          ...workspaceSnapshot.organization.teams,
                          {
                            id: createId('TEAM'),
                            name: 'New team',
                            description: '',
                            memberUserIds: [],
                            capabilityIds: [],
                          },
                        ],
                      },
                    })
                  }
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Plus size={16} />
                  Add team
                </button>
                <button
                  type="button"
                  onClick={() => void saveWorkspaceAccess()}
                  disabled={isSavingWorkspace}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ShieldCheck size={16} />
                  Save teams
                </button>
              </div>
            ) : null}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard
            title="Capability Access Matrix"
            description="Direct capability memberships, explicit grants, and descendant visibility."
            icon={KeyRound}
          >
            <label className="space-y-1 text-xs font-medium text-secondary">
              Capability
              <select
                value={selectedCapabilityId}
                onChange={event => {
                  const nextCapabilityId = event.target.value;
                  setSelectedCapabilityId(nextCapabilityId);
                  void fetchCapabilityAccessSnapshot(nextCapabilityId)
                    .then(setCapabilitySnapshot)
                    .catch(nextError =>
                      showError(
                        'Unable to load capability access',
                        nextError instanceof Error ? nextError.message : 'The request failed.',
                      ),
                    );
                }}
                className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
              >
                {capabilities.map(capability => (
                  <option key={capability.id} value={capability.id}>
                    {capability.name}
                  </option>
                ))}
              </select>
            </label>

            {capabilitySnapshot ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-outline-variant/45 bg-surface-container-low p-4">
                  <p className="form-kicker">Actor permissions</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {capabilitySnapshot.currentActorPermissions.allowedActions.map(action => (
                      <StatusBadge key={action} tone="info">
                        {action}
                      </StatusBadge>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-secondary">
                    Visibility: {capabilitySnapshot.currentActorPermissions.visibilityScope}
                  </p>
                </div>

                <div className="space-y-3">
                  <p className="form-kicker">Capability memberships</p>
                  {capabilitySnapshot.capabilityMemberships.map(membership => (
                    <div
                      key={membership.id}
                      className="grid gap-2 rounded-xl border border-outline-variant/40 bg-white p-3"
                    >
                      <input
                        value={membership.userId}
                        onChange={event =>
                          handleCapabilityMembershipField(
                            membership.id,
                            'userId',
                            event.target.value,
                          )
                        }
                        disabled={!canManageAccess}
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <input
                        value={membership.teamId || ''}
                        onChange={event =>
                          handleCapabilityMembershipField(
                            membership.id,
                            'teamId',
                            event.target.value,
                          )
                        }
                        disabled={!canManageAccess}
                        placeholder="Optional team id"
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <select
                        value={membership.role}
                        onChange={event =>
                          handleCapabilityMembershipField(
                            membership.id,
                            'role',
                            event.target.value,
                          )
                        }
                        disabled={!canManageAccess}
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      >
                        {CAPABILITY_ROLE_OPTIONS.map(role => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <p className="form-kicker">Explicit capability grants</p>
                  {capabilitySnapshot.capabilityGrants.map(grant => (
                    <div
                      key={grant.id}
                      className="grid gap-2 rounded-xl border border-outline-variant/40 bg-white p-3"
                    >
                      <input
                        value={grant.userId || ''}
                        onChange={event =>
                          handleCapabilityGrantField(grant.id, 'userId', event.target.value)
                        }
                        disabled={!canManageAccess}
                        placeholder="User id"
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <input
                        value={grant.teamId || ''}
                        onChange={event =>
                          handleCapabilityGrantField(grant.id, 'teamId', event.target.value)
                        }
                        disabled={!canManageAccess}
                        placeholder="Optional team id"
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <input
                        value={joinCsv(grant.actions)}
                        onChange={event =>
                          handleCapabilityGrantField(grant.id, 'actions', event.target.value)
                        }
                        disabled={!canManageAccess}
                        placeholder={PERMISSION_OPTIONS.join(', ')}
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <input
                        value={grant.note || ''}
                        onChange={event =>
                          handleCapabilityGrantField(grant.id, 'note', event.target.value)
                        }
                        disabled={!canManageAccess}
                        placeholder="Why this grant exists"
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <p className="form-kicker">Descendant access grants</p>
                  {capabilitySnapshot.descendantAccessGrants.map(grant => (
                    <div
                      key={grant.id}
                      className="grid gap-2 rounded-xl border border-outline-variant/40 bg-white p-3"
                    >
                      <input
                        value={grant.parentCapabilityId}
                        onChange={event =>
                          handleDescendantGrantField(
                            grant.id,
                            'parentCapabilityId',
                            event.target.value,
                          )
                        }
                        disabled={!canManageAccess}
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <input
                        value={grant.descendantCapabilityId}
                        onChange={event =>
                          handleDescendantGrantField(
                            grant.id,
                            'descendantCapabilityId',
                            event.target.value,
                          )
                        }
                        disabled={!canManageAccess}
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <input
                        value={grant.userId || ''}
                        onChange={event =>
                          handleDescendantGrantField(grant.id, 'userId', event.target.value)
                        }
                        disabled={!canManageAccess}
                        placeholder="User id"
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <input
                        value={grant.teamId || ''}
                        onChange={event =>
                          handleDescendantGrantField(grant.id, 'teamId', event.target.value)
                        }
                        disabled={!canManageAccess}
                        placeholder="Optional team id"
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <input
                        value={joinCsv(grant.actions)}
                        onChange={event =>
                          handleDescendantGrantField(grant.id, 'actions', event.target.value)
                        }
                        disabled={!canManageAccess}
                        placeholder={PERMISSION_OPTIONS.join(', ')}
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                      <input
                        value={grant.note || ''}
                        onChange={event =>
                          handleDescendantGrantField(grant.id, 'note', event.target.value)
                        }
                        disabled={!canManageAccess}
                        placeholder="Rollup visibility note"
                        className="rounded-lg border border-outline-variant/45 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                      />
                    </div>
                  ))}
                </div>

                {canManageAccess ? (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setCapabilitySnapshot({
                          ...capabilitySnapshot,
                          capabilityMemberships: [
                            ...capabilitySnapshot.capabilityMemberships,
                            {
                              id: createId('CAPMEM'),
                              capabilityId: capabilitySnapshot.capabilityId,
                              userId: users[0]?.id || '',
                              role: 'VIEWER',
                            },
                          ],
                        })
                      }
                      className="enterprise-button enterprise-button-secondary"
                    >
                      <Plus size={16} />
                      Add membership
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCapabilitySnapshot({
                          ...capabilitySnapshot,
                          capabilityGrants: [
                            ...capabilitySnapshot.capabilityGrants,
                            {
                              id: createId('GRANT'),
                              capabilityId: capabilitySnapshot.capabilityId,
                              userId: users[0]?.id,
                              actions: ['capability.read.rollup'],
                              createdAt: new Date().toISOString(),
                              updatedAt: new Date().toISOString(),
                            } as CapabilityGrant,
                          ],
                        })
                      }
                      className="enterprise-button enterprise-button-secondary"
                    >
                      <Plus size={16} />
                      Add grant
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCapabilitySnapshot({
                          ...capabilitySnapshot,
                          descendantAccessGrants: [
                            ...capabilitySnapshot.descendantAccessGrants,
                            {
                              id: createId('DESC'),
                              parentCapabilityId: capabilitySnapshot.capabilityId,
                              descendantCapabilityId: capabilities.find(
                                capability => capability.id !== capabilitySnapshot.capabilityId,
                              )?.id || capabilitySnapshot.capabilityId,
                              userId: users[0]?.id,
                              actions: ['capability.read.rollup'],
                              createdAt: new Date().toISOString(),
                              updatedAt: new Date().toISOString(),
                            } as ExplicitDescendantAccessGrant,
                          ],
                        })
                      }
                      className="enterprise-button enterprise-button-secondary"
                    >
                      <Plus size={16} />
                      Add descendant grant
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveCapabilityAccess()}
                      disabled={isSavingCapability}
                      className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ShieldCheck size={16} />
                      Save capability access
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                icon={KeyRound}
                title="Select a capability"
                description="Choose a capability to inspect memberships, explicit grants, and descendant rollup access."
              />
            )}
          </SectionCard>

          <SectionCard
            title="Signals & Audit"
            description="Notification routing, external identities, and access history."
            icon={History}
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-outline-variant/45 bg-surface-container-low p-4">
                <p className="form-kicker">Notification rules</p>
                {notificationRules.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {notificationRules.map(rule => (
                      <div
                        key={rule.id}
                        className="rounded-xl border border-outline-variant/35 bg-white px-3 py-3"
                      >
                        <p className="text-sm font-semibold text-on-surface">{rule.trigger}</p>
                        <p className="mt-1 text-xs text-secondary">
                          Channels: {rule.channels.join(', ')} · Scope:{' '}
                          {[rule.userId, rule.teamId, rule.capabilityId].filter(Boolean).join(' / ') ||
                            'workspace'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-secondary">
                    No notification rules configured yet.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-outline-variant/45 bg-surface-container-low p-4">
                <p className="form-kicker">External identities</p>
                {externalIdentityLinks.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {externalIdentityLinks.map(link => (
                      <div
                        key={link.id}
                        className="rounded-xl border border-outline-variant/35 bg-white px-3 py-3"
                      >
                        <p className="text-sm font-semibold text-on-surface">
                          {link.provider} · {link.displayName || link.username || link.externalId}
                        </p>
                        <p className="mt-1 text-xs text-secondary">User: {link.userId}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-secondary">
                    No external identity links have been synced yet.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-outline-variant/45 bg-surface-container-low p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="form-kicker">Recent access audit</p>
                  <Bell size={16} className="text-secondary" />
                </div>
                {accessAuditEvents.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {accessAuditEvents.slice(0, 12).map(event => (
                      <div
                        key={event.id}
                        className="rounded-xl border border-outline-variant/35 bg-white px-3 py-3"
                      >
                        <p className="text-sm font-semibold text-on-surface">{event.summary}</p>
                        <p className="mt-1 text-xs text-secondary">
                          {event.actorDisplayName} · {event.action} · {new Date(event.createdAt).toLocaleString()}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          Target: {event.targetType} · {event.targetId}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-secondary">
                    No access audit events have been recorded yet.
                  </p>
                )}
              </div>
            </div>
          </SectionCard>

          {capabilitySnapshot?.inheritedRollupAccess?.length ? (
            <SectionCard
              title="Inherited Rollup Visibility"
              description="Parent and collection visibility is read-only by default."
              icon={ShieldCheck}
            >
              <div className="space-y-2">
                {capabilitySnapshot.inheritedRollupAccess.map(access => (
                  <div
                    key={`${access.sourceCapabilityId}:${access.capabilityId}`}
                    className="rounded-xl border border-outline-variant/40 bg-white px-3 py-3"
                  >
                    <p className="text-sm font-semibold text-on-surface">
                      {access.sourceCapabilityName || access.sourceCapabilityId}
                    </p>
                    <p className="mt-1 text-xs text-secondary">{access.reason}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default UsersAccess;
