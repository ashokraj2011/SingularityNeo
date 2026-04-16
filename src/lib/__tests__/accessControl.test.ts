import { describe, expect, it } from 'vitest';
import type { Capability, WorkspaceOrganization } from '../../types';
import { createDefaultCapabilityLifecycle } from '../capabilityLifecycle';
import { evaluateCapabilityPermissions, evaluateWorkspacePermissions } from '../accessControl';

const baseCapability = (overrides: Partial<Capability> = {}): Capability => ({
  id: 'CAP-BASE',
  name: 'Base Capability',
  description: 'Access control test capability.',
  capabilityKind: 'DELIVERY',
  businessOutcome: 'Keep the test surface stable.',
  successMetrics: [],
  requiredEvidenceKinds: [],
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  localDirectories: [],
  repositories: [],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  dependencies: [],
  sharedCapabilities: [],
  contractDraft: {
    overview: 'Draft contract',
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    apiContracts: [],
    softwareVersions: [],
    almReferences: [],
    sections: [],
    additionalMetadata: [],
  },
  publishedSnapshots: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    allowedWorkspacePaths: [],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: [],
  ...overrides,
});

const baseOrganization = (
  overrides: Partial<WorkspaceOrganization> = {},
): WorkspaceOrganization => ({
  users: [
    {
      id: 'USER-1',
      name: 'Operator One',
      email: 'operator@example.com',
      status: 'ACTIVE',
      teamIds: ['TEAM-1'],
      workspaceRoles: ['VIEWER'],
    },
  ],
  teams: [
    {
      id: 'TEAM-1',
      name: 'Platform Team',
      memberUserIds: ['USER-1'],
      capabilityIds: ['CAP-BASE'],
    },
  ],
  memberships: [
    {
      id: 'MEM-1',
      userId: 'USER-1',
      teamId: 'TEAM-1',
      role: 'MEMBER',
    },
  ],
  capabilityMemberships: [],
  capabilityGrants: [],
  descendantAccessGrants: [],
  externalIdentityLinks: [],
  userPreferences: [],
  notificationRules: [],
  accessAuditEvents: [],
  currentUserId: 'USER-1',
  ...overrides,
});

describe('accessControl', () => {
  it('grants live detail across capabilities to workspace admins', () => {
    const capability = baseCapability();
    const organization = baseOrganization({
      users: [
        {
          id: 'USER-1',
          name: 'Admin',
          email: 'admin@example.com',
          status: 'ACTIVE',
          teamIds: ['TEAM-1'],
          workspaceRoles: ['WORKSPACE_ADMIN'],
        },
      ],
    });

    const permissions = evaluateCapabilityPermissions({
      organization,
      capability,
      capabilities: [capability],
      actor: {
        userId: 'USER-1',
        displayName: 'Admin',
        teamIds: ['TEAM-1'],
      },
    });

    expect(permissions.visibilityScope).toBe('LIVE_DETAIL');
    expect(permissions.allowedActions).toContain('workitem.control');
    expect(permissions.allowedActions).toContain('access.manage');
  });

  it('limits portfolio owners to rollup-only access without direct child grants', () => {
    const parent = baseCapability({
      id: 'CAP-PARENT',
      name: 'Payments Portfolio',
      capabilityKind: 'COLLECTION',
      parentCapabilityId: undefined,
    });
    const child = baseCapability({
      id: 'CAP-CHILD',
      name: 'Payments API',
      parentCapabilityId: 'CAP-PARENT',
    });
    const organization = baseOrganization({
      users: [
        {
          id: 'USER-1',
          name: 'Portfolio Owner',
          email: 'portfolio@example.com',
          status: 'ACTIVE',
          teamIds: ['TEAM-1'],
          workspaceRoles: ['PORTFOLIO_OWNER'],
        },
      ],
      capabilityMemberships: [
        {
          id: 'CAPMEM-1',
          capabilityId: 'CAP-PARENT',
          userId: 'USER-1',
          role: 'OWNER',
        },
      ],
    });

    const permissions = evaluateCapabilityPermissions({
      organization,
      capability: child,
      capabilities: [parent, child],
      actor: {
        userId: 'USER-1',
        displayName: 'Portfolio Owner',
        teamIds: ['TEAM-1'],
      },
    });

    expect(permissions.visibilityScope).toBe('ROLLUP_ONLY');
    expect(permissions.allowedActions).not.toContain('workitem.control');
    expect(permissions.inheritedRollupAccess).toHaveLength(1);
  });

  it('uses explicit descendant grants to unlock deeper child access', () => {
    const parent = baseCapability({
      id: 'CAP-PARENT',
      name: 'Enterprise Layer',
      capabilityKind: 'COLLECTION',
    });
    const child = baseCapability({
      id: 'CAP-CHILD',
      name: 'Settlement Engine',
      parentCapabilityId: 'CAP-PARENT',
    });
    const organization = baseOrganization({
      descendantAccessGrants: [
        {
          id: 'DESC-1',
          parentCapabilityId: 'CAP-PARENT',
          descendantCapabilityId: 'CAP-CHILD',
          userId: 'USER-1',
          actions: ['capability.read', 'workitem.read', 'artifact.read'],
          createdAt: '2026-04-15T00:00:00.000Z',
          updatedAt: '2026-04-15T00:00:00.000Z',
        },
      ],
    });

    const permissions = evaluateCapabilityPermissions({
      organization,
      capability: child,
      capabilities: [parent, child],
      actor: {
        userId: 'USER-1',
        displayName: 'Operator One',
        teamIds: ['TEAM-1'],
      },
    });

    expect(permissions.visibilityScope).toBe('LIVE_DETAIL');
    expect(permissions.allowedActions).toContain('workitem.read');
    expect(permissions.explicitDescendantGrantIds).toEqual(['DESC-1']);
  });

  it('keeps collection capabilities non-executable even for direct owners', () => {
    const collection = baseCapability({
      id: 'CAP-COLLECTION',
      name: 'Payments Domain',
      capabilityKind: 'COLLECTION',
      collectionKind: 'BUSINESS_DOMAIN',
    });
    const organization = baseOrganization({
      capabilityMemberships: [
        {
          id: 'CAPMEM-1',
          capabilityId: 'CAP-COLLECTION',
          userId: 'USER-1',
          role: 'OWNER',
        },
      ],
    });

    const permissions = evaluateCapabilityPermissions({
      organization,
      capability: collection,
      capabilities: [collection],
      actor: {
        userId: 'USER-1',
        displayName: 'Operator One',
        teamIds: ['TEAM-1'],
      },
    });

    expect(permissions.visibilityScope).toBe('LIVE_DETAIL');
    expect(permissions.allowedActions).toContain('capability.edit');
    expect(permissions.allowedActions).not.toContain('workitem.control');
    expect(permissions.allowedActions).not.toContain('telemetry.read');
  });

  it('evaluates workspace roles into a stable workspace permission set', () => {
    const organization = baseOrganization({
      users: [
        {
          id: 'USER-1',
          name: 'Audit Lead',
          email: 'audit@example.com',
          status: 'ACTIVE',
          teamIds: ['TEAM-1'],
          workspaceRoles: ['AUDITOR'],
        },
      ],
    });

    const permissions = evaluateWorkspacePermissions({
      organization,
      actor: {
        userId: 'USER-1',
        displayName: 'Audit Lead',
        teamIds: ['TEAM-1'],
      },
    });

    expect(permissions.allowedActions).toContain('report.view.audit');
    expect(permissions.allowedActions).toContain('report.view.portfolio');
    expect(permissions.allowedActions).not.toContain('workitem.control');
  });
});
