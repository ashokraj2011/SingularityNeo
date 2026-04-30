import type { PoolClient } from 'pg';
import {
  AGENT_TASKS,
  ARTIFACTS,
  CAPABILITIES,
  EXECUTION_LOGS,
  LEARNING_UPDATES,
  WORKFLOWS,
  WORK_ITEMS,
} from '../src/constants';
import {
  normalizeCapabilityLifecycle,
} from '../src/lib/capabilityLifecycle';
import { normalizeCapabilityPhaseOwnershipRules } from '../src/lib/capabilityOwnership';
import {
  mergeCapabilityDatabaseConfigs,
  normalizeCapabilityDatabaseConfigs,
} from '../src/lib/capabilityDatabases';
import { normalizeWorkspaceConnectorSettings } from '../src/lib/workspaceConnectors';
import {
  AgentTask,
  Artifact,
  ArtifactTemplateSection,
  Capability,
  CapabilityAlmExportPayload,
  CapabilityAgent,
  CapabilityContractDraft,
  CapabilityDependency,
  CapabilityDatabaseConfig,
  CapabilityPublishedSnapshot,
  CapabilityRepository,
  CapabilitySharedReference,
  CapabilityChatMessage,
  CapabilityMetadataEntry,
  CapabilityStakeholder,
  CapabilityWorkspace,
  AgentSessionScope,
  ExecutionLog,
  LearningUpdate,
  Skill,
  WorkspaceCatalogSnapshot,
  WorkspaceFoundationCatalog,
  WorkspaceOrganization,
  WorkspaceSettings,
  WorkItem,
  WorkItemBranch,
  WorkItemCheckoutSession,
  WorkItemCodeClaim,
  WorkItemExecutionContext,
  WorkItemPhase,
  WorkItemRepositoryAssignment,
  WorkItemStatus,
  WorkItemHandoffPacket,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowVersion,
} from '../src/types';
import {
  applyCapabilityArchitecture,
  buildCapabilityAlmExport,
  createEmptyCapabilityContractDraft,
  normalizeCapabilityContractDraft,
  normalizeCapabilityDependencies,
  normalizeCapabilityKind,
  normalizeCapabilityPublishedSnapshots,
  normalizeCapabilitySharedReferences,
} from '../src/lib/capabilityArchitecture';
import { query, transaction, getDatabaseRuntimeInfo } from './db';
import { resolveRuntimeModel } from './githubModels';
import {
  normalizeEmbeddingProviderKey,
  normalizeProviderKey,
  resolveProviderDisplayName,
} from './providerRegistry';
import { syncWorkspaceOrganizationFromCapabilities } from './workspaceOrganization';
import {
  applyWorkspaceRuntime,
  buildBaseAgents,
  buildOwnerAgent,
  buildSeededAgents,
  buildWelcomeMessage,
  createDefaultAgentLearningProfile,
  materializeWorkspace,
} from './workspace';
import {
  getDefaultCapabilityWorkflows,
  createBrokerageCapabilityWorkflow,
  createStandardCapabilityWorkflow,
  createFdasBusinessWorkflow,
  STANDARD_WORKFLOW_TEMPLATE_ID,
  FDAS_WORKFLOW_TEMPLATE_ID,
} from '../src/lib/standardWorkflow';
import {
  createWorkspaceFoundationCapability,
  isSystemFoundationCapability,
  createDefaultWorkspaceFoundationCatalog,
  materializeCapabilityStarterArtifacts,
  mergeCapabilitySkillLibrary,
  summarizeWorkspaceFoundationCatalog,
  SYSTEM_FOUNDATION_CAPABILITY_ID,
} from '../src/lib/workspaceFoundations';
import { normalizeExecutionConfig } from '../src/lib/executionConfig';
import { buildWorkflowFromGraph, normalizeWorkflowGraph } from '../src/lib/workflowGraph';
import {
  getLegacyArtifactListsFromContract,
  normalizeAgentOperatingContract,
  normalizeAgentRoleStarterKey,
  normalizeLearningUpdate,
  normalizeSkill,
} from '../src/lib/agentRuntime';
import {
  listAgentLearningProfilesTx,
  listAgentSessionSummariesTx,
} from './agentLearning/repository';
import {
  buildCapabilityExecutionSurface,
  listDesktopExecutorRegistrations,
} from './executionOwnership';
import {
  executionRuntimeRpc,
  isRemoteExecutionClient,
} from './execution/runtimeClient';
import { buildCapabilityReadinessContract } from './readinessContract';
import { getCapabilityWorkspaceRoots } from './workspacePaths';

export type CapabilityBundle = {
  capability: Capability;
  workspace: CapabilityWorkspace;
};

type AppState = {
  capabilities: Capability[];
  capabilityWorkspaces: CapabilityWorkspace[];
  workspaceSettings: WorkspaceSettings;
  workspaceOrganization: WorkspaceOrganization;
};

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  databaseConfigs: [],
  connectors: normalizeWorkspaceConnectorSettings(),
};

const withUpdatedTimestamp = 'NOW()';
const LEGACY_DEMO_CAPABILITY_IDS = ['CAP-001', 'CAP-002', 'CAP-003'];

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

const asJsonArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const toStableSlug = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

const normalizeCapabilityRepository = (
  capabilityId: string,
  repository: Partial<CapabilityRepository>,
  fallbackIndex = 0,
): CapabilityRepository | null => {
  const url = String(repository.url || '').trim();
  const label = String(repository.label || '').trim();
  const defaultBranch = String(repository.defaultBranch || '').trim() || 'main';

  if (!url && !label) {
    return null;
  }

  return {
    id:
      String(repository.id || '').trim() ||
      `REPO-${toStableSlug(capabilityId)}-${
        toStableSlug(url || label || `REPOSITORY-${fallbackIndex + 1}`) ||
        `REPOSITORY-${fallbackIndex + 1}`
      }`,
    capabilityId,
    label: label || url.split('/').pop()?.replace(/\.git$/i, '') || `Repository ${fallbackIndex + 1}`,
    url: url || label,
    defaultBranch,
    localRootHint: String(repository.localRootHint || '').trim() || undefined,
    isPrimary: Boolean(repository.isPrimary),
    status: repository.status || 'ACTIVE',
  };
};

const buildLegacyCapabilityRepositories = (
  capabilityId: string,
  gitRepositories: string[],
  localDirectories: string[],
): CapabilityRepository[] => {
  const repoUrls = gitRepositories.map(value => String(value || '').trim()).filter(Boolean);
  const repoRoots = localDirectories.map(value => String(value || '').trim()).filter(Boolean);
  const total = Math.max(repoUrls.length, repoRoots.length);

  return Array.from({ length: total }).flatMap((_, index) => {
    const normalized = normalizeCapabilityRepository(
      capabilityId,
      {
        label: repoUrls[index]
          ? repoUrls[index].split('/').pop()?.replace(/\.git$/i, '')
          : repoRoots[index]
          ? repoRoots[index].split('/').pop()
          : `Repository ${index + 1}`,
        url: repoUrls[index] || repoRoots[index] || '',
        defaultBranch: 'main',
        localRootHint: repoRoots[index] || undefined,
        isPrimary: index === 0,
        status: 'ACTIVE',
      },
      index,
    );

    return normalized ? [normalized] : [];
  });
};

const normalizeCapabilityRepositories = (
  capabilityId: string,
  repositories: Array<Partial<CapabilityRepository>> | undefined,
  gitRepositories: string[],
  localDirectories: string[],
): CapabilityRepository[] => {
  const normalized = (repositories || [])
    .map((repository, index) =>
      normalizeCapabilityRepository(capabilityId, repository, index),
    )
    .filter(Boolean) as CapabilityRepository[];

  if (normalized.length === 0) {
    return buildLegacyCapabilityRepositories(capabilityId, gitRepositories, localDirectories);
  }

  return normalized.map((repository, index) => ({
    ...repository,
    isPrimary: index === 0 ? true : repository.isPrimary,
  }));
};

const toLegacyRepositoryLists = (repositories: CapabilityRepository[]) => ({
  gitRepositories: Array.from(
    new Set(
      repositories
        .filter(repository => repository.status !== 'ARCHIVED')
        .map(repository => repository.url)
        .filter(Boolean),
    ),
  ),
  localDirectories: Array.from(
    new Set(
      repositories
        .filter(repository => repository.status !== 'ARCHIVED')
        .map(repository => repository.localRootHint)
        .filter(Boolean) as string[],
    ),
  ),
});

const repositoryAssignmentFromRow = (
  row: Record<string, any>,
): WorkItemRepositoryAssignment => ({
  workItemId: row.work_item_id,
  repositoryId: row.repository_id,
  role: row.role,
  checkoutRequired: Boolean(row.checkout_required),
});

const workItemBranchFromRow = (row: Record<string, any>): WorkItemBranch => ({
  id: row.id,
  workItemId: row.work_item_id,
  repositoryId: row.repository_id,
  baseBranch: row.base_branch,
  sharedBranch: row.shared_branch,
  createdByUserId: row.created_by_user_id || undefined,
  createdAt:
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
  headSha: row.head_sha || undefined,
  linkedPrUrl: row.linked_pr_url || undefined,
  status: row.status,
});

const workItemCodeClaimFromRow = (row: Record<string, any>): WorkItemCodeClaim => ({
  workItemId: row.work_item_id,
  userId: row.user_id,
  teamId: row.team_id || undefined,
  claimType: row.claim_type,
  status: row.status,
  claimedAt:
    row.claimed_at instanceof Date ? row.claimed_at.toISOString() : String(row.claimed_at || ''),
  expiresAt:
    row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at || ''),
  releasedAt:
    row.released_at instanceof Date
      ? row.released_at.toISOString()
      : row.released_at
      ? String(row.released_at)
      : undefined,
});

const workItemCheckoutSessionFromRow = (
  row: Record<string, any>,
): WorkItemCheckoutSession => ({
  executorId: row.executor_id,
  workItemId: row.work_item_id,
  userId: row.user_id,
  repositoryId: row.repository_id,
  localPath: row.local_path || undefined,
  workingDirectoryPath: row.working_directory_path || undefined,
  branch: row.branch,
  lastSeenHeadSha: row.last_seen_head_sha || undefined,
  lastSyncedAt:
    row.last_synced_at instanceof Date
      ? row.last_synced_at.toISOString()
      : row.last_synced_at
      ? String(row.last_synced_at)
      : undefined,
});

const workItemHandoffPacketFromRow = (
  row: Record<string, any>,
): WorkItemHandoffPacket => ({
  id: row.id,
  workItemId: row.work_item_id,
  fromUserId: row.from_user_id || undefined,
  toUserId: row.to_user_id || undefined,
  fromTeamId: row.from_team_id || undefined,
  toTeamId: row.to_team_id || undefined,
  summary: row.summary,
  openQuestions: asStringArray(row.open_questions),
  blockingDependencies: asStringArray(row.blocking_dependencies),
  recommendedNextStep: row.recommended_next_step || undefined,
  artifactIds: asStringArray(row.artifact_ids),
  traceIds: asStringArray(row.trace_ids),
  delegationOriginTaskId: row.delegation_origin_task_id || undefined,
  delegationOriginAgentId: row.delegation_origin_agent_id || undefined,
  createdAt:
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
  acceptedAt:
    row.accepted_at instanceof Date
      ? row.accepted_at.toISOString()
      : row.accepted_at
      ? String(row.accepted_at)
      : undefined,
});

const capabilityFromRow = (
  row: Record<string, any>,
  skills: Skill[],
  repositories: CapabilityRepository[] = [],
  dependencies: CapabilityDependency[] = [],
  sharedReferences: CapabilitySharedReference[] = [],
  publishedSnapshots: CapabilityPublishedSnapshot[] = [],
  workspaceSettings: WorkspaceSettings = DEFAULT_WORKSPACE_SETTINGS,
): Capability => ({
  id: row.id,
  name: row.name,
  description: row.description,
  domain: row.domain || undefined,
  parentCapabilityId: row.parent_capability_id || undefined,
  capabilityKind: normalizeCapabilityKind(row.capability_kind, row.collection_kind),
  collectionKind: row.collection_kind || undefined,
  businessUnit: row.business_unit || undefined,
  ownerTeam: row.owner_team || undefined,
  businessOutcome: row.business_outcome || undefined,
  successMetrics: asStringArray(row.success_metrics),
  definitionOfDone: row.definition_of_done || undefined,
  requiredEvidenceKinds: asStringArray(row.required_evidence_kinds),
  operatingPolicySummary: row.operating_policy_summary || undefined,
  confluenceLink: row.confluence_link || undefined,
  jiraBoardLink: row.jira_board_link || undefined,
  documentationNotes: row.documentation_notes || undefined,
  applications: asStringArray(row.applications),
  apis: asStringArray(row.apis),
  databases: asStringArray(row.databases),
  databaseConfigs: mergeCapabilityDatabaseConfigs(
    workspaceSettings.databaseConfigs,
    asJsonArray<CapabilityDatabaseConfig>(row.database_configs),
  ),
  gitRepositories: asStringArray(row.git_repositories),
  localDirectories: asStringArray(row.local_directories),
  repositories: normalizeCapabilityRepositories(
    row.id,
    repositories,
    asStringArray(row.git_repositories),
    asStringArray(row.local_directories),
  ),
  teamNames: asStringArray(row.team_names),
  stakeholders: asJsonArray<CapabilityStakeholder>(row.stakeholders),
  additionalMetadata: asJsonArray<CapabilityMetadataEntry>(row.additional_metadata),
  dependencies: normalizeCapabilityDependencies(row.id, dependencies),
  sharedCapabilities: normalizeCapabilitySharedReferences(row.id, sharedReferences),
  contractDraft: normalizeCapabilityContractDraft(
    row.contract_draft as Partial<CapabilityContractDraft> | undefined,
  ),
  publishedSnapshots: normalizeCapabilityPublishedSnapshots(row.id, publishedSnapshots),
  lifecycle: normalizeCapabilityLifecycle(row.lifecycle || undefined),
  phaseOwnershipRules: normalizeCapabilityPhaseOwnershipRules({
    lifecycle: normalizeCapabilityLifecycle(row.lifecycle || undefined),
    ownerTeam: row.owner_team || undefined,
    phaseOwnershipRules: asJsonArray(row.phase_ownership_rules),
  }),
  executionConfig: normalizeExecutionConfig(
    { localDirectories: asStringArray(row.local_directories) },
    row.execution_config || undefined,
  ),
  status: row.status,
  specialAgentId: row.special_agent_id || undefined,
  isSystemCapability: Boolean(row.is_system_capability),
  systemCapabilityRole: row.system_capability_role || undefined,
  skillLibrary: skills,
});

const skillFromRow = (row: Record<string, any>): Skill =>
  normalizeSkill({
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    version: row.version,
    contentMarkdown: row.content_markdown || `# ${row.name}\n\n${row.description}`,
    kind: row.kind || 'CUSTOM',
    origin: row.origin || 'CAPABILITY',
    defaultTemplateKeys: asStringArray(row.default_template_keys),
  });

const workspaceSettingsFromRow = (
  row?: Record<string, any>,
): WorkspaceSettings => ({
  databaseConfigs: normalizeCapabilityDatabaseConfigs(
    asJsonArray<CapabilityDatabaseConfig>(row?.database_configs),
  ),
  connectors: normalizeWorkspaceConnectorSettings(row?.connector_settings),
});

const workspaceFoundationCatalogFromRow = (
  row?: Record<string, any>,
): WorkspaceFoundationCatalog => ({
  agentTemplates: asJsonArray<WorkspaceFoundationCatalog['agentTemplates'][number]>(
    row?.foundation_agent_templates,
  ),
  workflowTemplates: asJsonArray<
    WorkspaceFoundationCatalog['workflowTemplates'][number]
  >(row?.foundation_workflow_templates),
  evalSuiteTemplates: asJsonArray<
    WorkspaceFoundationCatalog['evalSuiteTemplates'][number]
  >(row?.foundation_eval_suite_templates),
  skillTemplates: asJsonArray<WorkspaceFoundationCatalog['skillTemplates'][number]>(
    row?.foundation_skill_templates,
  ),
  artifactTemplates: asJsonArray<
    WorkspaceFoundationCatalog['artifactTemplates'][number]
  >(row?.foundation_artifact_templates),
  toolTemplates: asJsonArray<
    WorkspaceFoundationCatalog['toolTemplates'][number]
  >(row?.foundation_tool_templates),
  initializedAt:
    row?.foundations_initialized_at instanceof Date
      ? row.foundations_initialized_at.toISOString()
      : row?.foundations_initialized_at
      ? String(row.foundations_initialized_at)
      : undefined,
});

const listCapabilityRepositoriesTx = async (
  client: PoolClient,
  capabilityId: string,
  legacy?: {
    gitRepositories: string[];
    localDirectories: string[];
  },
): Promise<CapabilityRepository[]> => {
  const result = await client.query(
    `
      SELECT *
      FROM capability_repositories
      WHERE capability_id = $1
      ORDER BY is_primary DESC, created_at ASC, id ASC
    `,
    [capabilityId],
  );

  if (result.rowCount === 0) {
    return buildLegacyCapabilityRepositories(
      capabilityId,
      legacy?.gitRepositories || [],
      legacy?.localDirectories || [],
    );
  }

  return result.rows
    .map((row, index) =>
      normalizeCapabilityRepository(
        capabilityId,
        {
          id: row.id,
          label: row.label,
          url: row.url,
          defaultBranch: row.default_branch,
          localRootHint: row.local_root_hint || undefined,
          isPrimary: row.is_primary,
          status: row.status,
        },
        index,
      ),
    )
    .filter(Boolean) as CapabilityRepository[];
};

const replaceCapabilityRepositoriesTx = async (
  client: PoolClient,
  capabilityId: string,
  repositories: CapabilityRepository[],
) => {
  await client.query('DELETE FROM capability_repositories WHERE capability_id = $1', [
    capabilityId,
  ]);

  for (const repository of repositories) {
    await client.query(
      `
        INSERT INTO capability_repositories (
          capability_id,
          id,
          label,
          url,
          default_branch,
          local_root_hint,
          is_primary,
          status,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${withUpdatedTimestamp})
      `,
      [
        capabilityId,
        repository.id,
        repository.label,
        repository.url,
        repository.defaultBranch,
        repository.localRootHint || null,
        repository.isPrimary,
        repository.status || 'ACTIVE',
      ],
    );
  }
};

const listCapabilityDependenciesTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<CapabilityDependency[]> => {
  const result = await client.query(
    `
      SELECT *
      FROM capability_dependencies
      WHERE capability_id = $1
      ORDER BY updated_at ASC, created_at ASC, id ASC
    `,
    [capabilityId],
  );

  return normalizeCapabilityDependencies(
    capabilityId,
    result.rows.map(row => ({
      id: row.id,
      capabilityId,
      targetCapabilityId: row.target_capability_id,
      dependencyKind: row.dependency_kind,
      description: row.description,
      criticality: row.criticality,
      versionConstraint: row.version_constraint || undefined,
    })),
  );
};

const replaceCapabilityDependenciesTx = async (
  client: PoolClient,
  capabilityId: string,
  dependencies: CapabilityDependency[],
) => {
  await client.query('DELETE FROM capability_dependencies WHERE capability_id = $1', [
    capabilityId,
  ]);

  for (const dependency of normalizeCapabilityDependencies(capabilityId, dependencies)) {
    await client.query(
      `
        INSERT INTO capability_dependencies (
          capability_id,
          id,
          target_capability_id,
          dependency_kind,
          description,
          criticality,
          version_constraint,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,${withUpdatedTimestamp})
      `,
      [
        capabilityId,
        dependency.id,
        dependency.targetCapabilityId,
        dependency.dependencyKind,
        dependency.description,
        dependency.criticality,
        dependency.versionConstraint || null,
      ],
    );
  }
};

const listCapabilitySharedReferencesTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<CapabilitySharedReference[]> => {
  const result = await client.query(
    `
      SELECT *
      FROM capability_shared_references
      WHERE collection_capability_id = $1
      ORDER BY updated_at ASC, created_at ASC, id ASC
    `,
    [capabilityId],
  );

  return normalizeCapabilitySharedReferences(
    capabilityId,
    result.rows.map(row => ({
      id: row.id,
      collectionCapabilityId: capabilityId,
      memberCapabilityId: row.member_capability_id,
      label: row.label || undefined,
    })),
  );
};

const replaceCapabilitySharedReferencesTx = async (
  client: PoolClient,
  capabilityId: string,
  references: CapabilitySharedReference[],
) => {
  await client.query(
    'DELETE FROM capability_shared_references WHERE collection_capability_id = $1',
    [capabilityId],
  );

  for (const reference of normalizeCapabilitySharedReferences(capabilityId, references)) {
    await client.query(
      `
        INSERT INTO capability_shared_references (
          collection_capability_id,
          id,
          member_capability_id,
          label,
          updated_at
        )
        VALUES ($1,$2,$3,$4,${withUpdatedTimestamp})
      `,
      [
        capabilityId,
        reference.id,
        reference.memberCapabilityId,
        reference.label || null,
      ],
    );
  }
};

const listCapabilityPublishedSnapshotsTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<CapabilityPublishedSnapshot[]> => {
  const result = await client.query(
    `
      SELECT *
      FROM capability_published_snapshots
      WHERE capability_id = $1
      ORDER BY publish_version DESC, published_at DESC, created_at DESC
    `,
    [capabilityId],
  );

  return normalizeCapabilityPublishedSnapshots(
    capabilityId,
    result.rows.map(row => ({
      id: row.id,
      capabilityId,
      publishVersion:
        typeof row.publish_version === 'number'
          ? row.publish_version
          : Number(row.publish_version || 0),
      publishedAt:
        row.published_at instanceof Date
          ? row.published_at.toISOString()
          : String(row.published_at || ''),
      publishedBy: row.published_by,
      supersedesSnapshotId: row.supersedes_snapshot_id || undefined,
      contract: row.snapshot_json,
    })),
  );
};

const createCapabilityPublishedSnapshotTx = async (
  client: PoolClient,
  capabilityId: string,
  snapshot: CapabilityPublishedSnapshot,
) => {
  await client.query(
    `
      INSERT INTO capability_published_snapshots (
        capability_id,
        id,
        publish_version,
        published_at,
        published_by,
        supersedes_snapshot_id,
        snapshot_json,
        updated_at
      )
      VALUES ($1,$2,$3,$4::timestamptz,$5,$6,$7::jsonb,${withUpdatedTimestamp})
    `,
    [
      capabilityId,
      snapshot.id,
      snapshot.publishVersion,
      snapshot.publishedAt,
      snapshot.publishedBy,
      snapshot.supersedesSnapshotId || null,
      JSON.stringify(normalizeCapabilityContractDraft(snapshot.contract)),
    ],
  );
};

const buildWorkItemExecutionContextsTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<Map<string, WorkItemExecutionContext>> => {
  const [assignmentResult, branchResult, claimResult] = await Promise.all([
    client.query(
      `
        SELECT *
        FROM capability_work_item_repository_assignments
        WHERE capability_id = $1
        ORDER BY created_at ASC
      `,
      [capabilityId],
    ),
    client.query(
      `
        SELECT *
        FROM capability_work_item_branches
        WHERE capability_id = $1
        ORDER BY created_at DESC
      `,
      [capabilityId],
    ),
    client.query(
      `
        SELECT *
        FROM capability_work_item_code_claims
        WHERE capability_id = $1
          AND status = 'ACTIVE'
          AND claim_type = 'WRITE'
        ORDER BY claimed_at DESC
      `,
      [capabilityId],
    ),
  ]);

  const assignmentsByWorkItem = new Map<string, WorkItemRepositoryAssignment[]>();
  for (const row of assignmentResult.rows) {
    const assignment = repositoryAssignmentFromRow(row);
    const next = assignmentsByWorkItem.get(assignment.workItemId) || [];
    next.push(assignment);
    assignmentsByWorkItem.set(assignment.workItemId, next);
  }

  const branchesByWorkItem = new Map<string, WorkItemBranch[]>();
  for (const row of branchResult.rows) {
    const branch = workItemBranchFromRow(row);
    const next = branchesByWorkItem.get(branch.workItemId) || [];
    next.push(branch);
    branchesByWorkItem.set(branch.workItemId, next);
  }

  const activeClaimByWorkItem = new Map<string, WorkItemCodeClaim>();
  for (const row of claimResult.rows) {
    const claim = workItemCodeClaimFromRow(row);
    if (!activeClaimByWorkItem.has(claim.workItemId)) {
      activeClaimByWorkItem.set(claim.workItemId, claim);
    }
  }

  const workItemIds = new Set<string>([
    ...assignmentsByWorkItem.keys(),
    ...branchesByWorkItem.keys(),
    ...activeClaimByWorkItem.keys(),
  ]);
  const contexts = new Map<string, WorkItemExecutionContext>();

  for (const workItemId of workItemIds) {
    const assignments = assignmentsByWorkItem.get(workItemId) || [];
    const branches = branchesByWorkItem.get(workItemId) || [];
    const activeBranch =
      branches.find(branch => branch.status === 'ACTIVE') ||
      branches.find(branch => branch.status === 'NOT_CREATED') ||
      branches[0];
    const activeClaim = activeClaimByWorkItem.get(workItemId);
    const primaryRepositoryId =
      assignments.find(assignment => assignment.role === 'PRIMARY')?.repositoryId ||
      activeBranch?.repositoryId ||
      assignments[0]?.repositoryId;

    contexts.set(workItemId, {
      workItemId,
      primaryRepositoryId,
      repositoryAssignments:
        assignments.length > 0
          ? assignments
          : activeBranch
          ? [
              {
                workItemId,
                repositoryId: activeBranch.repositoryId,
                role: 'PRIMARY',
                checkoutRequired: true,
              },
            ]
          : [],
      branch: activeBranch,
      activeWriterUserId: activeClaim?.userId,
      claimExpiresAt: activeClaim?.expiresAt,
      strategy: 'SHARED_BRANCH',
    });
  }

  return contexts;
};

const getWorkspaceFoundationCatalogTx = async (
  client: PoolClient,
): Promise<WorkspaceFoundationCatalog> => {
  const result = await client.query(
    `
      SELECT
        foundation_agent_templates,
        foundation_workflow_templates,
        foundation_eval_suite_templates,
        foundation_skill_templates,
        foundation_artifact_templates,
        foundation_tool_templates,
        foundations_initialized_at
      FROM workspace_settings
      WHERE id = $1
    `,
    ['DEFAULT'],
  );

  return result.rowCount
    ? workspaceFoundationCatalogFromRow(result.rows[0])
    : createDefaultWorkspaceFoundationCatalog();
};

const agentFromRow = (row: Record<string, any>): CapabilityAgent => ({
  id: row.id,
  capabilityId: row.capability_id,
  name: row.name,
  role: row.role,
  roleStarterKey: normalizeAgentRoleStarterKey(row.role_starter_key),
  objective: row.objective,
  systemPrompt: row.system_prompt,
  contract: normalizeAgentOperatingContract(row.contract || undefined, {
    description: row.objective || row.role,
    suggestedInputArtifacts: asStringArray(row.input_artifacts),
    expectedOutputArtifacts: asStringArray(row.output_artifacts),
  }),
  initializationStatus: row.initialization_status,
  documentationSources: asStringArray(row.documentation_sources),
  ...getLegacyArtifactListsFromContract(
    normalizeAgentOperatingContract(row.contract || undefined, {
      description: row.objective || row.role,
      suggestedInputArtifacts: asStringArray(row.input_artifacts),
      expectedOutputArtifacts: asStringArray(row.output_artifacts),
    }),
  ),
  isOwner: Boolean(row.is_owner),
  isBuiltIn: Boolean(row.is_built_in),
  standardTemplateKey: row.standard_template_key || undefined,
  learningNotes: asStringArray(row.learning_notes),
  skillIds: asStringArray(row.skill_ids),
  preferredToolIds: asStringArray(row.preferred_tool_ids) as CapabilityAgent['preferredToolIds'],
  provider: resolveProviderDisplayName(row.provider_key || row.provider),
  providerKey: row.provider_key ? normalizeProviderKey(row.provider_key) : undefined,
  embeddingProviderKey: normalizeEmbeddingProviderKey(
    row.embedding_provider_key || row.provider_key || row.provider,
  ),
  model: row.model,
  tokenLimit: Number(row.token_limit || 0),
  learningProfile: createDefaultAgentLearningProfile(),
  sessionSummaries: [],
  usage: {
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  },
  previousOutputs: [],
});

const messageFromRow = (row: Record<string, any>): CapabilityChatMessage => ({
  id: row.id,
  capabilityId: row.capability_id,
  role: row.role,
  content: row.content,
  timestamp: row.timestamp,
  agentId: row.agent_id || undefined,
  agentName: row.agent_name || undefined,
  traceId: row.trace_id || undefined,
  model: row.model || undefined,
  sessionId: row.session_id || undefined,
  sessionScope: row.session_scope || undefined,
  sessionScopeId: row.session_scope_id || undefined,
  workItemId: row.work_item_id || undefined,
  runId: row.run_id || undefined,
  workflowStepId: row.workflow_step_id || undefined,
  hidden: row.hidden === true ? true : undefined,
});

const workflowFromRow = (
  row: Record<string, any>,
  capability: Pick<Capability, 'lifecycle'>,
): Workflow =>
  buildWorkflowFromGraph(
    normalizeWorkflowGraph({
      id: row.id,
      name: row.name,
      capabilityId: row.capability_id,
      templateId: row.template_id || undefined,
      schemaVersion: row.schema_version ? Number(row.schema_version) : undefined,
      version: row.version ? Number(row.version) : 1,
      lockedAt: row.locked_at ? new Date(row.locked_at).toISOString() : undefined,
      lockedBy: row.locked_by || undefined,
      entryNodeId: row.entry_node_id || undefined,
      nodes: asJsonArray<Workflow['nodes'][number]>(row.nodes),
      edges: asJsonArray<Workflow['edges'][number]>(row.edges),
      steps: asJsonArray<Workflow['steps'][number]>(row.steps),
      status: row.status,
      workflowType: row.workflow_type || undefined,
      scope: row.scope || 'CAPABILITY',
      summary: row.summary || undefined,
      publishState: row.publish_state || undefined,
    }, capability.lifecycle),
    capability.lifecycle,
  );

const artifactFromRow = (row: Record<string, any>): Artifact => ({
  id: row.id,
  name: row.name,
  capabilityId: row.capability_id,
  type: row.type,
  inputs: asStringArray(row.inputs),
  version: row.version,
  agent: row.agent,
  created: row.created,
  template: row.template || undefined,
  templateSections: asJsonArray<ArtifactTemplateSection>(row.template_sections),
  documentationStatus: row.documentation_status || undefined,
  isLearningArtifact: row.is_learning_artifact ?? undefined,
  isMasterArtifact: row.is_master_artifact ?? undefined,
  decisions: asStringArray(row.decisions),
  changes: asStringArray(row.changes),
  learningInsights: asStringArray(row.learning_insights),
  governanceRules: asStringArray(row.governance_rules),
  description: row.description || undefined,
  direction: row.direction || undefined,
  connectedAgentId: row.connected_agent_id || undefined,
  sourceWorkflowId: row.source_workflow_id || undefined,
  runId: row.run_id || undefined,
  runStepId: row.run_step_id || undefined,
  toolInvocationId: row.tool_invocation_id || undefined,
  summary: row.summary || undefined,
  workItemId: row.work_item_id || undefined,
  artifactKind: row.artifact_kind || undefined,
  phase: row.phase || undefined,
  sourceRunId: row.source_run_id || undefined,
  sourceRunStepId: row.source_run_step_id || undefined,
  sourceWaitId: row.source_wait_id || undefined,
  handoffFromAgentId: row.handoff_from_agent_id || undefined,
  handoffToAgentId: row.handoff_to_agent_id || undefined,
  contentFormat: row.content_format || undefined,
  mimeType: row.mime_type || undefined,
  fileName: row.file_name || undefined,
  contentText: row.content_text || undefined,
  contentJson: row.content_json || undefined,
  downloadable: row.downloadable ?? undefined,
  traceId: row.trace_id || undefined,
  latencyMs: row.latency_ms ?? undefined,
  costUsd: row.cost_usd ? Number(row.cost_usd) : undefined,
  policyDecisionId: row.policy_decision_id || undefined,
  retrievalReferences: Array.isArray(row.retrieval_references)
    ? row.retrieval_references
    : undefined,
});

const taskFromRow = (row: Record<string, any>): AgentTask => ({
  id: row.id,
  title: row.title,
  agent: row.agent,
  capabilityId: row.capability_id,
  workItemId: row.work_item_id || undefined,
  workflowId: row.workflow_id || undefined,
  workflowStepId: row.workflow_step_id || undefined,
  managedByWorkflow: row.managed_by_workflow ?? undefined,
  taskType: row.task_type || undefined,
  phase: row.phase || undefined,
  priority: row.priority,
  status: row.status,
  timestamp: row.timestamp,
  prompt: row.prompt || undefined,
  executionNotes: row.execution_notes || undefined,
  runId: row.run_id || undefined,
  runStepId: row.run_step_id || undefined,
  toolInvocationId: row.tool_invocation_id || undefined,
  taskSubtype: row.task_subtype || undefined,
  parentTaskId: row.parent_task_id || undefined,
  parentRunId: row.parent_run_id || undefined,
  parentRunStepId: row.parent_run_step_id || undefined,
  delegatedAgentId: row.delegated_agent_id || undefined,
  handoffPacketId: row.handoff_packet_id || undefined,
  linkedArtifacts: asJsonArray<NonNullable<AgentTask['linkedArtifacts']>[number]>(row.linked_artifacts),
  producedOutputs: asJsonArray<NonNullable<AgentTask['producedOutputs']>[number]>(row.produced_outputs),
});

const executionLogFromRow = (row: Record<string, any>): ExecutionLog => ({
  id: row.id,
  taskId: row.task_id,
  capabilityId: row.capability_id,
  agentId: row.agent_id,
  timestamp: row.timestamp,
  level: row.level,
  message: row.message,
  runId: row.run_id || undefined,
  runStepId: row.run_step_id || undefined,
  toolInvocationId: row.tool_invocation_id || undefined,
  traceId: row.trace_id || undefined,
  latencyMs: row.latency_ms ?? undefined,
  costUsd: row.cost_usd ? Number(row.cost_usd) : undefined,
  metadata: row.metadata || undefined,
});

const learningUpdateFromRow = (row: Record<string, any>): LearningUpdate =>
  normalizeLearningUpdate({
    id: row.id,
    capabilityId: row.capability_id,
    agentId: row.agent_id,
    sourceLogIds: asStringArray(row.source_log_ids),
    insight: row.insight,
    skillUpdate: row.skill_update || undefined,
    timestamp: row.timestamp,
    triggerType: row.trigger_type || undefined,
    relatedWorkItemId: row.related_work_item_id || undefined,
    relatedRunId: row.related_run_id || undefined,
  });

const workItemFromRow = (
  row: Record<string, any>,
  executionContext?: WorkItemExecutionContext,
): WorkItem => ({
  id: row.id,
  title: row.title,
  description: row.description,
  taskType: row.task_type || undefined,
  parentWorkItemId: row.parent_work_item_id || undefined,
  storyPoints:
    typeof row.story_points === 'number'
      ? row.story_points
      : row.story_points
      ? Number(row.story_points)
      : undefined,
  tShirtSize: row.t_shirt_size || undefined,
  sizingConfidence: row.sizing_confidence || undefined,
  planningBatchId: row.planning_batch_id || undefined,
  planningProposalItemId: row.planning_proposal_item_id || undefined,
  phaseStakeholders: asJsonArray<NonNullable<WorkItem['phaseStakeholders']>[number]>(
    row.phase_stakeholders,
  ),
  phase: row.phase,
  capabilityId: row.capability_id,
  workflowId: row.workflow_id,
  currentStepId: row.current_step_id || undefined,
  assignedAgentId: row.assigned_agent_id || undefined,
  phaseOwnerTeamId: row.phase_owner_team_id || undefined,
  claimOwnerUserId: row.claim_owner_user_id || undefined,
  watchedByUserIds: asStringArray(row.watched_by_user_ids),
  pendingHandoff:
    row.pending_handoff && typeof row.pending_handoff === 'object'
      ? row.pending_handoff
      : undefined,
  status: row.status,
  priority: row.priority,
  tags: asStringArray(row.tags),
  pendingRequest: row.pending_request || undefined,
  blocker: row.blocker || undefined,
  activeRunId: row.active_run_id || undefined,
  lastRunId: row.last_run_id || undefined,
  recordVersion:
    typeof row.record_version === 'number' && Number.isFinite(row.record_version)
      ? row.record_version
      : Number(row.record_version || 1) || 1,
  executionContext,
  history: asJsonArray<WorkItem['history'][number]>(row.history),
  // Phase-segment additions (columns may not exist on legacy rows — the
  // DDL uses ADD COLUMN IF NOT EXISTS so every fresh or migrated DB has
  // them; hydrate as undefined when null).
  brief: row.brief || undefined,
  nextSegmentPreset:
    row.next_segment_preset && typeof row.next_segment_preset === 'object'
      ? (row.next_segment_preset as WorkItem['nextSegmentPreset'])
      : undefined,
});

const workspaceCreatedAt = (row: Record<string, any> | undefined) =>
  row?.created_at instanceof Date ? row.created_at.toISOString() : new Date().toISOString();

const mergeCapability = (current: Capability, updates: Partial<Capability>): Capability => {
  const capabilityKind = normalizeCapabilityKind(
    updates.capabilityKind ?? current.capabilityKind,
    updates.collectionKind ?? current.collectionKind,
  );

  return {
    ...current,
    ...updates,
    capabilityKind,
    collectionKind: updates.collectionKind ?? current.collectionKind,
  successMetrics: updates.successMetrics ?? current.successMetrics,
  requiredEvidenceKinds:
    updates.requiredEvidenceKinds ?? current.requiredEvidenceKinds,
  applications: updates.applications ?? current.applications,
  apis: updates.apis ?? current.apis,
  databases: updates.databases ?? current.databases,
  databaseConfigs:
    updates.databaseConfigs ?? current.databaseConfigs ?? [],
  gitRepositories:
    updates.repositories !== undefined
      ? toLegacyRepositoryLists(
          normalizeCapabilityRepositories(
            current.id,
            updates.repositories,
            updates.gitRepositories ?? current.gitRepositories,
            updates.localDirectories ?? current.localDirectories,
          ),
        ).gitRepositories
      : updates.gitRepositories ?? current.gitRepositories,
  localDirectories:
    updates.repositories !== undefined
      ? toLegacyRepositoryLists(
          normalizeCapabilityRepositories(
            current.id,
            updates.repositories,
            updates.gitRepositories ?? current.gitRepositories,
            updates.localDirectories ?? current.localDirectories,
          ),
        ).localDirectories
      : updates.localDirectories ?? current.localDirectories,
  repositories:
    updates.repositories !== undefined
      ? normalizeCapabilityRepositories(
          current.id,
          updates.repositories,
          updates.gitRepositories ?? current.gitRepositories,
          updates.localDirectories ?? current.localDirectories,
        )
      : current.repositories,
  teamNames: updates.teamNames ?? current.teamNames,
  stakeholders: updates.stakeholders ?? current.stakeholders,
  additionalMetadata: updates.additionalMetadata ?? current.additionalMetadata,
  dependencies: normalizeCapabilityDependencies(
    current.id,
    updates.dependencies ?? current.dependencies,
  ),
  sharedCapabilities:
    capabilityKind === 'COLLECTION'
      ? normalizeCapabilitySharedReferences(
          current.id,
          updates.sharedCapabilities ?? current.sharedCapabilities,
        )
      : [],
  contractDraft: normalizeCapabilityContractDraft(
    updates.contractDraft ?? current.contractDraft ?? createEmptyCapabilityContractDraft(),
  ),
  publishedSnapshots: normalizeCapabilityPublishedSnapshots(
    current.id,
    updates.publishedSnapshots ?? current.publishedSnapshots,
  ),
  lifecycle: normalizeCapabilityLifecycle(updates.lifecycle ?? current.lifecycle),
  phaseOwnershipRules: normalizeCapabilityPhaseOwnershipRules({
    lifecycle: normalizeCapabilityLifecycle(updates.lifecycle ?? current.lifecycle),
    ownerTeam: updates.ownerTeam ?? current.ownerTeam,
    phaseOwnershipRules: updates.phaseOwnershipRules ?? current.phaseOwnershipRules,
  }),
  executionConfig:
    updates.executionConfig ??
    normalizeExecutionConfig(current, current.executionConfig),
  skillLibrary: updates.skillLibrary ?? current.skillLibrary,
  };
};

const collectLegacyWorkspaceDatabaseConfigsTx = async (
  client: PoolClient,
) => {
  const result = await client.query<{ database_configs: unknown }>(
    `
      SELECT database_configs
      FROM capabilities
    `,
  );

  return mergeCapabilityDatabaseConfigs(
    ...result.rows.map(row => asJsonArray<CapabilityDatabaseConfig>(row.database_configs)),
  );
};

const getWorkspaceSettingsTx = async (
  client: PoolClient,
): Promise<WorkspaceSettings> => {
  const result = await client.query('SELECT * FROM workspace_settings WHERE id = $1', ['DEFAULT']);

  if (result.rowCount) {
    const settings = workspaceSettingsFromRow(result.rows[0]);
    if (settings.databaseConfigs.length > 0) {
      return settings;
    }
  }

  const legacyDatabaseConfigs = await collectLegacyWorkspaceDatabaseConfigsTx(client);
  const nextSettings = {
    databaseConfigs: legacyDatabaseConfigs,
    connectors: normalizeWorkspaceConnectorSettings(),
  };

  await client.query(
    `
      INSERT INTO workspace_settings (
        id,
        database_configs,
        connector_settings,
        updated_at
      )
      VALUES ($1, $2, $3, ${withUpdatedTimestamp})
      ON CONFLICT (id) DO UPDATE SET
        database_configs = EXCLUDED.database_configs,
        connector_settings = EXCLUDED.connector_settings,
        updated_at = ${withUpdatedTimestamp}
    `,
    [
      'DEFAULT',
      JSON.stringify(legacyDatabaseConfigs),
      JSON.stringify(nextSettings.connectors),
    ],
  );

  return nextSettings;
};

const upsertWorkspaceSettingsTx = async (
  client: PoolClient,
  settings: WorkspaceSettings,
) => {
  const normalizedDatabaseConfigs = normalizeCapabilityDatabaseConfigs(
    settings.databaseConfigs,
  );
  const normalizedConnectors = normalizeWorkspaceConnectorSettings(settings.connectors);

  await client.query(
    `
      INSERT INTO workspace_settings (
        id,
        database_configs,
        connector_settings,
        updated_at
      )
      VALUES ($1, $2, $3, ${withUpdatedTimestamp})
      ON CONFLICT (id) DO UPDATE SET
        database_configs = EXCLUDED.database_configs,
        connector_settings = EXCLUDED.connector_settings,
        updated_at = ${withUpdatedTimestamp}
    `,
    [
      'DEFAULT',
      JSON.stringify(normalizedDatabaseConfigs),
      JSON.stringify(normalizedConnectors),
    ],
  );

  await client.query(
    `
      UPDATE capabilities
      SET
        database_configs = $1,
        databases = $2,
        updated_at = ${withUpdatedTimestamp}
    `,
    [
      JSON.stringify(normalizedDatabaseConfigs),
      normalizedDatabaseConfigs.map(config => config.label).filter(Boolean),
    ],
  );

  return {
    databaseConfigs: normalizedDatabaseConfigs,
    connectors: normalizedConnectors,
  } satisfies WorkspaceSettings;
};

const assertCapabilityHierarchyValidTx = async (
  client: PoolClient,
  capability: Capability,
) => {
  const parentId = String(capability.parentCapabilityId || '').trim();
  if (!parentId) {
    return;
  }

  if (parentId === capability.id) {
    throw new Error('A capability cannot be its own parent.');
  }

  const parentResult = await client.query(
    'SELECT id, parent_capability_id FROM capabilities WHERE id = $1 LIMIT 1',
    [parentId],
  );
  if (!parentResult.rowCount) {
    throw new Error(`Parent capability ${parentId} could not be found.`);
  }

  const visited = new Set<string>([capability.id]);
  let cursor = parentResult.rows[0] as { id: string; parent_capability_id?: string | null };
  while (cursor) {
    if (visited.has(cursor.id)) {
      throw new Error('The selected parent would create a hierarchy cycle.');
    }
    visited.add(cursor.id);
    const nextParentId = String(cursor.parent_capability_id || '').trim();
    if (!nextParentId) {
      break;
    }
    const nextResult = await client.query(
      'SELECT id, parent_capability_id FROM capabilities WHERE id = $1 LIMIT 1',
      [nextParentId],
    );
    cursor = nextResult.rows[0] as { id: string; parent_capability_id?: string | null };
  }
};

const upsertCapabilityTx = async (client: PoolClient, capability: Capability) => {
  const repositories = normalizeCapabilityRepositories(
    capability.id,
    capability.repositories,
    capability.gitRepositories,
    capability.localDirectories,
  );
  const legacyLists = toLegacyRepositoryLists(repositories);
  const normalizedDependencies = normalizeCapabilityDependencies(
    capability.id,
    capability.dependencies,
  );
  const normalizedSharedReferences =
    normalizeCapabilityKind(capability.capabilityKind, capability.collectionKind) ===
    'COLLECTION'
      ? normalizeCapabilitySharedReferences(
          capability.id,
          capability.sharedCapabilities,
        )
      : [];
  const normalizedContractDraft = normalizeCapabilityContractDraft(
    capability.contractDraft ?? createEmptyCapabilityContractDraft(),
  );

  await assertCapabilityHierarchyValidTx(client, capability);

  await client.query(
    `
      INSERT INTO capabilities (
        id,
        name,
        description,
        domain,
        parent_capability_id,
        capability_kind,
        collection_kind,
        business_unit,
        owner_team,
        business_outcome,
        success_metrics,
        definition_of_done,
        required_evidence_kinds,
        operating_policy_summary,
        confluence_link,
        jira_board_link,
        documentation_notes,
        applications,
        apis,
        databases,
        database_configs,
        git_repositories,
        local_directories,
        team_names,
        stakeholders,
        additional_metadata,
        contract_draft,
        lifecycle,
        phase_ownership_rules,
        execution_config,
        status,
        special_agent_id,
        is_system_capability,
        system_capability_role,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,${withUpdatedTimestamp}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        domain = EXCLUDED.domain,
        parent_capability_id = EXCLUDED.parent_capability_id,
        capability_kind = EXCLUDED.capability_kind,
        collection_kind = EXCLUDED.collection_kind,
        business_unit = EXCLUDED.business_unit,
        owner_team = EXCLUDED.owner_team,
        business_outcome = EXCLUDED.business_outcome,
        success_metrics = EXCLUDED.success_metrics,
        definition_of_done = EXCLUDED.definition_of_done,
        required_evidence_kinds = EXCLUDED.required_evidence_kinds,
        operating_policy_summary = EXCLUDED.operating_policy_summary,
        confluence_link = EXCLUDED.confluence_link,
        jira_board_link = EXCLUDED.jira_board_link,
        documentation_notes = EXCLUDED.documentation_notes,
        applications = EXCLUDED.applications,
        apis = EXCLUDED.apis,
        databases = EXCLUDED.databases,
        database_configs = EXCLUDED.database_configs,
        git_repositories = EXCLUDED.git_repositories,
        local_directories = EXCLUDED.local_directories,
        team_names = EXCLUDED.team_names,
        stakeholders = EXCLUDED.stakeholders,
        additional_metadata = EXCLUDED.additional_metadata,
        contract_draft = EXCLUDED.contract_draft,
        lifecycle = EXCLUDED.lifecycle,
        phase_ownership_rules = EXCLUDED.phase_ownership_rules,
        execution_config = EXCLUDED.execution_config,
        status = EXCLUDED.status,
        special_agent_id = EXCLUDED.special_agent_id,
        is_system_capability = EXCLUDED.is_system_capability,
        system_capability_role = EXCLUDED.system_capability_role,
        updated_at = ${withUpdatedTimestamp}
    `,
    [
      capability.id,
      capability.name,
      capability.description,
      capability.domain || null,
      capability.parentCapabilityId || null,
      normalizeCapabilityKind(capability.capabilityKind, capability.collectionKind),
      capability.collectionKind || null,
      capability.businessUnit || null,
      capability.ownerTeam || null,
      capability.businessOutcome || null,
      capability.successMetrics,
      capability.definitionOfDone || null,
      capability.requiredEvidenceKinds,
      capability.operatingPolicySummary || null,
      capability.confluenceLink || null,
      capability.jiraBoardLink || null,
      capability.documentationNotes || null,
      capability.applications,
      capability.apis,
      capability.databases,
      JSON.stringify(
        normalizeCapabilityDatabaseConfigs(capability.databaseConfigs),
      ),
      legacyLists.gitRepositories,
      legacyLists.localDirectories,
      capability.teamNames,
      JSON.stringify(capability.stakeholders),
      JSON.stringify(capability.additionalMetadata),
      JSON.stringify(normalizedContractDraft),
      JSON.stringify(normalizeCapabilityLifecycle(capability.lifecycle)),
      JSON.stringify(normalizeCapabilityPhaseOwnershipRules(capability)),
      JSON.stringify(normalizeExecutionConfig(capability, capability.executionConfig)),
      capability.status,
      capability.specialAgentId || null,
      capability.isSystemCapability || false,
      capability.systemCapabilityRole || null,
    ],
  );
  await replaceCapabilityRepositoriesTx(client, capability.id, repositories);
  await replaceCapabilityDependenciesTx(client, capability.id, normalizedDependencies);
  await replaceCapabilitySharedReferencesTx(
    client,
    capability.id,
    normalizedSharedReferences,
  );
};

const upsertWorkspaceMetaTx = async (
  client: PoolClient,
  capabilityId: string,
  activeChatAgentId: string | null,
  createdAt?: string,
) => {
  await client.query(
    `
      INSERT INTO capability_workspaces (
        capability_id,
        active_chat_agent_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), ${withUpdatedTimestamp})
      ON CONFLICT (capability_id) DO UPDATE SET
        active_chat_agent_id = EXCLUDED.active_chat_agent_id,
        updated_at = ${withUpdatedTimestamp}
    `,
    [capabilityId, activeChatAgentId, createdAt || null],
  );
};

const replaceSkillsTx = async (client: PoolClient, capabilityId: string, skills: Skill[]) => {
  await client.query('DELETE FROM capability_skills WHERE capability_id = $1', [capabilityId]);

  for (const skill of skills) {
    await client.query(
      `
        INSERT INTO capability_skills (
          capability_id,
          id,
          name,
          description,
          category,
          version,
          content_markdown,
          kind,
          origin,
          default_template_keys,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,${withUpdatedTimestamp})
      `,
      [
        capabilityId,
        skill.id,
        skill.name,
        skill.description,
        skill.category,
        skill.version,
        skill.contentMarkdown || `# ${skill.name}\n\n${skill.description}`,
        skill.kind || 'CUSTOM',
        skill.origin || 'CAPABILITY',
        skill.defaultTemplateKeys || [],
      ],
    );
  }
};

const upsertAgentTx = async (
  client: PoolClient,
  capabilityId: string,
  agent: Omit<CapabilityAgent, 'usage' | 'previousOutputs'>,
) => {
  const normalizedModel = await resolveRuntimeModel(agent.model || undefined);
  const contract = normalizeAgentOperatingContract(agent.contract, {
    description: agent.objective || agent.role,
    suggestedInputArtifacts: agent.inputArtifacts,
    expectedOutputArtifacts: agent.outputArtifacts,
  });
  const legacyArtifacts = getLegacyArtifactListsFromContract(contract);

  await client.query(
    `
      INSERT INTO capability_agents (
        capability_id,
        id,
        name,
        role,
        objective,
        system_prompt,
        initialization_status,
        documentation_sources,
        input_artifacts,
        output_artifacts,
        is_owner,
        is_built_in,
        standard_template_key,
        role_starter_key,
        learning_notes,
        contract,
        skill_ids,
        preferred_tool_ids,
        provider,
        provider_key,
        embedding_provider_key,
        model,
        token_limit,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,${withUpdatedTimestamp}
      )
      ON CONFLICT (capability_id, id) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        objective = EXCLUDED.objective,
        system_prompt = EXCLUDED.system_prompt,
        initialization_status = EXCLUDED.initialization_status,
        documentation_sources = EXCLUDED.documentation_sources,
        input_artifacts = EXCLUDED.input_artifacts,
        output_artifacts = EXCLUDED.output_artifacts,
        is_owner = EXCLUDED.is_owner,
        is_built_in = EXCLUDED.is_built_in,
        standard_template_key = EXCLUDED.standard_template_key,
        role_starter_key = EXCLUDED.role_starter_key,
        learning_notes = EXCLUDED.learning_notes,
        contract = EXCLUDED.contract,
        skill_ids = EXCLUDED.skill_ids,
        preferred_tool_ids = EXCLUDED.preferred_tool_ids,
        provider = EXCLUDED.provider,
        provider_key = EXCLUDED.provider_key,
        embedding_provider_key = EXCLUDED.embedding_provider_key,
        model = EXCLUDED.model,
        token_limit = EXCLUDED.token_limit,
        updated_at = ${withUpdatedTimestamp}
    `,
    [
      capabilityId,
      agent.id,
      agent.name,
      agent.role,
      agent.objective,
      agent.systemPrompt,
      agent.initializationStatus,
      agent.documentationSources,
      legacyArtifacts.inputArtifacts,
      legacyArtifacts.outputArtifacts,
      Boolean(agent.isOwner),
      Boolean(agent.isBuiltIn),
      agent.standardTemplateKey || null,
      normalizeAgentRoleStarterKey(agent.roleStarterKey) || null,
      agent.learningNotes || [],
      JSON.stringify(contract),
      agent.skillIds,
      agent.preferredToolIds || [],
      agent.provider || resolveProviderDisplayName(agent.providerKey),
      normalizeProviderKey(agent.providerKey || agent.provider),
      normalizeEmbeddingProviderKey(
        agent.embeddingProviderKey || agent.providerKey || agent.provider,
      ),
      normalizedModel,
      agent.tokenLimit,
    ],
  );
};

const replaceAgentsTx = async (client: PoolClient, capabilityId: string, agents: CapabilityAgent[]) => {
  await client.query('DELETE FROM capability_agents WHERE capability_id = $1', [capabilityId]);

  for (const agent of agents) {
    await upsertAgentTx(client, capabilityId, agent);
  }
};

const ensureBaseAgentsTx = async (client: PoolClient, capability: Capability) => {
  const existingAgents = await client.query<{ id: string }>(
    `
      SELECT id
      FROM capability_agents
      WHERE capability_id = $1
    `,
    [capability.id],
  );
  const existingAgentIds = new Set(existingAgents.rows.map(row => row.id));

  for (const agent of buildBaseAgents(capability, buildOwnerAgent(capability))) {
    if (existingAgentIds.has(agent.id)) {
      continue;
    }

    await upsertAgentTx(client, capability.id, agent);
  }
};

const replaceMessagesTx = async (
  client: PoolClient,
  capabilityId: string,
  messages: CapabilityChatMessage[],
) => {
  await client.query('DELETE FROM capability_messages WHERE capability_id = $1', [capabilityId]);

  for (const message of messages) {
    await client.query(
      `
        INSERT INTO capability_messages (
          capability_id,
          id,
          role,
          content,
          timestamp,
          agent_id,
          agent_name,
          trace_id,
          model,
          session_id,
          session_scope,
          session_scope_id,
          work_item_id,
          run_id,
          workflow_step_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      `,
      [
        capabilityId,
        message.id,
        message.role,
        message.content,
        message.timestamp,
        message.agentId || null,
        message.agentName || null,
        message.traceId || null,
        message.model || null,
        message.sessionId || null,
        message.sessionScope || null,
        message.sessionScopeId || null,
        message.workItemId || null,
        message.runId || null,
        message.workflowStepId || null,
      ],
    );
  }
};

const appendMessageTx = async (
  client: PoolClient,
  capabilityId: string,
  message: CapabilityChatMessage,
) => {
  await client.query(
    `
      INSERT INTO capability_messages (
        capability_id,
        id,
        role,
        content,
        timestamp,
        agent_id,
        agent_name,
        trace_id,
        model,
        session_id,
        session_scope,
        session_scope_id,
        work_item_id,
        run_id,
        workflow_step_id,
        hidden
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (capability_id, id) DO UPDATE SET
        content = EXCLUDED.content,
        timestamp = EXCLUDED.timestamp,
        agent_id = EXCLUDED.agent_id,
        agent_name = EXCLUDED.agent_name,
        trace_id = EXCLUDED.trace_id,
        model = EXCLUDED.model,
        session_id = EXCLUDED.session_id,
        session_scope = EXCLUDED.session_scope,
        session_scope_id = EXCLUDED.session_scope_id,
        work_item_id = EXCLUDED.work_item_id,
        run_id = EXCLUDED.run_id,
        workflow_step_id = EXCLUDED.workflow_step_id,
        hidden = EXCLUDED.hidden
    `,
    [
      capabilityId,
      message.id,
      message.role,
      message.content,
      message.timestamp,
      message.agentId || null,
      message.agentName || null,
      message.traceId || null,
      message.model || null,
      message.sessionId || null,
      message.sessionScope || null,
      message.sessionScopeId || null,
      message.workItemId || null,
      message.runId || null,
      message.workflowStepId || null,
      message.hidden === true,
    ],
  );
};

const replaceWorkflowsTx = async (
  client: PoolClient,
  capabilityId: string,
  workflows: Workflow[],
  capability?: Pick<Capability, 'lifecycle'>,
) => {
  await client.query('DELETE FROM capability_workflows WHERE capability_id = $1', [capabilityId]);

  for (const workflow of workflows) {
    const lifecycle = capability?.lifecycle;
    const normalizedWorkflow = buildWorkflowFromGraph(
      normalizeWorkflowGraph(workflow, lifecycle),
      lifecycle,
    );
    await client.query(
      `
        INSERT INTO capability_workflows (
          capability_id,
          id,
          name,
          status,
          workflow_type,
          scope,
          summary,
          schema_version,
          entry_node_id,
          template_id,
          nodes,
          edges,
          steps,
          publish_state,
          updated_at
        )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,${withUpdatedTimestamp})
      `,
      [
        capabilityId,
        normalizedWorkflow.id,
        normalizedWorkflow.name,
        normalizedWorkflow.status,
        normalizedWorkflow.workflowType || null,
        normalizedWorkflow.scope || 'CAPABILITY',
        normalizedWorkflow.summary || null,
        normalizedWorkflow.schemaVersion || null,
        normalizedWorkflow.entryNodeId || null,
        normalizedWorkflow.templateId || null,
        JSON.stringify(normalizedWorkflow.nodes || []),
        JSON.stringify(normalizedWorkflow.edges || []),
        JSON.stringify(normalizedWorkflow.steps),
        normalizedWorkflow.publishState || 'DRAFT',
      ],
    );
  }
};

const insertArtifactTx = async (
  client: PoolClient,
  capabilityId: string,
  artifact: Artifact,
) => {
  await client.query(
    `
        INSERT INTO capability_artifacts (
          capability_id,
          id,
          name,
          type,
          inputs,
          version,
          agent,
          created,
          template,
          template_sections,
          documentation_status,
          is_learning_artifact,
          is_master_artifact,
          decisions,
          changes,
          learning_insights,
          governance_rules,
          description,
          direction,
          connected_agent_id,
          source_workflow_id,
          run_id,
          run_step_id,
          tool_invocation_id,
          summary,
          work_item_id,
          artifact_kind,
          phase,
          source_run_id,
          source_run_step_id,
          source_wait_id,
          handoff_from_agent_id,
          handoff_to_agent_id,
          content_format,
          mime_type,
          file_name,
          content_text,
          content_json,
          downloadable,
          trace_id,
          latency_ms,
          cost_usd,
          policy_decision_id,
          retrieval_references,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,${withUpdatedTimestamp}
        )
      `,
    [
      capabilityId,
      artifact.id,
      artifact.name,
      artifact.type,
      artifact.inputs || [],
      artifact.version,
      artifact.agent,
      artifact.created,
      artifact.template || null,
      JSON.stringify(artifact.templateSections || []),
      artifact.documentationStatus || null,
      artifact.isLearningArtifact ?? null,
      artifact.isMasterArtifact ?? null,
      artifact.decisions || [],
      artifact.changes || [],
      artifact.learningInsights || [],
      artifact.governanceRules || [],
      artifact.description || null,
      artifact.direction || null,
      artifact.connectedAgentId || null,
      artifact.sourceWorkflowId || null,
      artifact.runId || null,
      artifact.runStepId || null,
      artifact.toolInvocationId || null,
      artifact.summary || null,
      artifact.workItemId || null,
      artifact.artifactKind || null,
      artifact.phase || null,
      artifact.sourceRunId || null,
      artifact.sourceRunStepId || null,
      artifact.sourceWaitId || null,
      artifact.handoffFromAgentId || null,
      artifact.handoffToAgentId || null,
      artifact.contentFormat || null,
      artifact.mimeType || null,
      artifact.fileName || null,
      artifact.contentText || null,
      artifact.contentJson || null,
      artifact.downloadable ?? false,
      artifact.traceId || null,
      artifact.latencyMs ?? null,
      artifact.costUsd ?? null,
      artifact.policyDecisionId || null,
      JSON.stringify(artifact.retrievalReferences || []),
    ],
  );
};

const upsertArtifactFileTx = async (
  client: PoolClient,
  capabilityId: string,
  artifactId: string,
  payload: {
    bytes: Buffer;
    sizeBytes: number;
    sha256: string;
  },
) => {
  await client.query(
    `
      INSERT INTO capability_artifact_files (
        capability_id,
        artifact_id,
        bytes,
        size_bytes,
        sha256,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,${withUpdatedTimestamp})
      ON CONFLICT (capability_id, artifact_id)
      DO UPDATE SET
        bytes = EXCLUDED.bytes,
        size_bytes = EXCLUDED.size_bytes,
        sha256 = EXCLUDED.sha256,
        updated_at = ${withUpdatedTimestamp}
    `,
    [capabilityId, artifactId, payload.bytes, payload.sizeBytes, payload.sha256],
  );
};

const replaceArtifactsTx = async (
  client: PoolClient,
  capabilityId: string,
  artifacts: CapabilityWorkspace['artifacts'],
) => {
  await client.query('DELETE FROM capability_artifacts WHERE capability_id = $1', [capabilityId]);

  for (const artifact of artifacts) {
    await client.query(
      `
        INSERT INTO capability_artifacts (
          capability_id,
          id,
          name,
          type,
          inputs,
          version,
          agent,
          created,
          template,
          template_sections,
          documentation_status,
          is_learning_artifact,
          is_master_artifact,
          decisions,
          changes,
          learning_insights,
          governance_rules,
          description,
          direction,
          connected_agent_id,
          source_workflow_id,
          run_id,
          run_step_id,
          tool_invocation_id,
          summary,
          work_item_id,
          artifact_kind,
          phase,
          source_run_id,
          source_run_step_id,
          source_wait_id,
          handoff_from_agent_id,
          handoff_to_agent_id,
          content_format,
          mime_type,
          file_name,
          content_text,
          content_json,
          downloadable,
          trace_id,
          latency_ms,
          cost_usd,
          policy_decision_id,
          retrieval_references,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,${withUpdatedTimestamp}
        )
      `,
      [
        capabilityId,
        artifact.id,
        artifact.name,
        artifact.type,
        artifact.inputs || [],
        artifact.version,
        artifact.agent,
        artifact.created,
        artifact.template || null,
        JSON.stringify(artifact.templateSections || []),
        artifact.documentationStatus || null,
        artifact.isLearningArtifact ?? null,
        artifact.isMasterArtifact ?? null,
        artifact.decisions || [],
        artifact.changes || [],
        artifact.learningInsights || [],
        artifact.governanceRules || [],
        artifact.description || null,
        artifact.direction || null,
        artifact.connectedAgentId || null,
        artifact.sourceWorkflowId || null,
        artifact.runId || null,
        artifact.runStepId || null,
        artifact.toolInvocationId || null,
        artifact.summary || null,
        artifact.workItemId || null,
        artifact.artifactKind || null,
        artifact.phase || null,
        artifact.sourceRunId || null,
        artifact.sourceRunStepId || null,
        artifact.sourceWaitId || null,
        artifact.handoffFromAgentId || null,
        artifact.handoffToAgentId || null,
        artifact.contentFormat || null,
        artifact.mimeType || null,
        artifact.fileName || null,
        artifact.contentText || null,
        artifact.contentJson || null,
        artifact.downloadable ?? false,
        artifact.traceId || null,
        artifact.latencyMs ?? null,
        artifact.costUsd ?? null,
        artifact.policyDecisionId || null,
        JSON.stringify(artifact.retrievalReferences || []),
      ],
    );
  }

  // `replaceCapabilityWorkspaceContentRecord` rewrites the artifact table wholesale, so keep
  // binary blobs in a separate table and clean up only the rows that no longer exist.
  await client.query(
    `
      DELETE FROM capability_artifact_files
      WHERE capability_id = $1 AND artifact_id <> ALL($2::text[])
    `,
    [capabilityId, artifacts.map(artifact => artifact.id)],
  );
};

const replaceTasksTx = async (
  client: PoolClient,
  capabilityId: string,
  tasks: AgentTask[],
) => {
  await client.query('DELETE FROM capability_tasks WHERE capability_id = $1', [capabilityId]);

  for (const task of tasks) {
    await client.query(
      `
        INSERT INTO capability_tasks (
          capability_id,
          id,
          title,
          agent,
          work_item_id,
          workflow_id,
          workflow_step_id,
          managed_by_workflow,
          task_type,
          phase,
          priority,
          status,
          timestamp,
          prompt,
          execution_notes,
          run_id,
          run_step_id,
          tool_invocation_id,
          task_subtype,
          parent_task_id,
          parent_run_id,
          parent_run_step_id,
          delegated_agent_id,
          handoff_packet_id,
          linked_artifacts,
          produced_outputs,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,${withUpdatedTimestamp})
      `,
      [
        capabilityId,
        task.id,
        task.title,
        task.agent,
        task.workItemId || null,
        task.workflowId || null,
        task.workflowStepId || null,
        task.managedByWorkflow ?? false,
        task.taskType || null,
        task.phase || null,
        task.priority,
        task.status,
        task.timestamp,
        task.prompt || null,
        task.executionNotes || null,
        task.runId || null,
        task.runStepId || null,
        task.toolInvocationId || null,
        task.taskSubtype || null,
        task.parentTaskId || null,
        task.parentRunId || null,
        task.parentRunStepId || null,
        task.delegatedAgentId || null,
        task.handoffPacketId || null,
        JSON.stringify(task.linkedArtifacts || []),
        JSON.stringify(task.producedOutputs || []),
      ],
    );
  }
};

const replaceExecutionLogsTx = async (
  client: PoolClient,
  capabilityId: string,
  logs: ExecutionLog[],
) => {
  await client.query('DELETE FROM capability_execution_logs WHERE capability_id = $1', [
    capabilityId,
  ]);

  for (const log of logs) {
    await client.query(
      `
        INSERT INTO capability_execution_logs (
          capability_id,
          id,
          task_id,
          agent_id,
          timestamp,
          level,
          message,
          run_id,
          run_step_id,
          tool_invocation_id,
          trace_id,
          latency_ms,
          cost_usd,
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `,
      [
        capabilityId,
        log.id,
        log.taskId,
        log.agentId,
        log.timestamp,
        log.level,
        log.message,
        log.runId || null,
        log.runStepId || null,
        log.toolInvocationId || null,
        log.traceId || null,
        log.latencyMs ?? null,
        log.costUsd ?? null,
        log.metadata || null,
      ],
    );
  }
};

const replaceLearningUpdatesTx = async (
  client: PoolClient,
  capabilityId: string,
  updates: LearningUpdate[],
) => {
  await client.query('DELETE FROM capability_learning_updates WHERE capability_id = $1', [
    capabilityId,
  ]);

  for (const update of updates) {
    await client.query(
      `
        INSERT INTO capability_learning_updates (
          capability_id,
          id,
          agent_id,
        source_log_ids,
        insight,
        skill_update,
        timestamp,
        trigger_type,
        related_work_item_id,
        related_run_id
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        capabilityId,
        update.id,
        update.agentId,
        update.sourceLogIds,
        update.insight,
        update.skillUpdate || null,
        update.timestamp,
        update.triggerType || null,
        update.relatedWorkItemId || null,
        update.relatedRunId || null,
      ],
    );
  }
};

const replaceWorkItemsTx = async (
  client: PoolClient,
  capabilityId: string,
  workItems: WorkItem[],
) => {
  await client.query('DELETE FROM capability_work_items WHERE capability_id = $1', [capabilityId]);
  await client.query(
    'DELETE FROM capability_work_item_repository_assignments WHERE capability_id = $1',
    [capabilityId],
  );
  await client.query('DELETE FROM capability_work_item_branches WHERE capability_id = $1', [
    capabilityId,
  ]);
  await client.query(
    'DELETE FROM capability_work_item_code_claims WHERE capability_id = $1',
    [capabilityId],
  );

  for (const item of workItems) {
    await client.query(
      `
	        INSERT INTO capability_work_items (
	          capability_id,
	          id,
	          title,
	          description,
	          task_type,
	          parent_work_item_id,
	          story_points,
	          t_shirt_size,
	          sizing_confidence,
	          planning_batch_id,
	          planning_proposal_item_id,
	          phase_stakeholders,
	          phase,
	          workflow_id,
	          current_step_id,
	          assigned_agent_id,
	          phase_owner_team_id,
	          claim_owner_user_id,
	          watched_by_user_ids,
	          pending_handoff,
	          status,
	          priority,
	          tags,
	          pending_request,
	          blocker,
	          active_run_id,
	          last_run_id,
	          record_version,
	          history,
	          updated_at
	        )
	        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,${withUpdatedTimestamp})
	      `,
	      [
	        capabilityId,
	        item.id,
        item.title,
        item.description,
        item.taskType || null,
        item.parentWorkItemId || null,
        item.storyPoints || null,
        item.tShirtSize || null,
        item.sizingConfidence || null,
        item.planningBatchId || null,
        item.planningProposalItemId || null,
        JSON.stringify(item.phaseStakeholders || []),
        item.phase,
        item.workflowId,
        item.currentStepId || null,
        item.assignedAgentId || null,
        item.phaseOwnerTeamId || null,
        item.claimOwnerUserId || null,
        item.watchedByUserIds || [],
        item.pendingHandoff ? JSON.stringify(item.pendingHandoff) : null,
        item.status,
        item.priority,
        item.tags,
        item.pendingRequest || null,
        item.blocker || null,
        item.activeRunId || null,
        item.lastRunId || null,
        item.recordVersion || 1,
        JSON.stringify(item.history || []),
      ],
    );

    for (const assignment of item.executionContext?.repositoryAssignments || []) {
      await client.query(
        `
          INSERT INTO capability_work_item_repository_assignments (
            capability_id,
            work_item_id,
            repository_id,
            role,
            checkout_required,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,${withUpdatedTimestamp})
        `,
        [
          capabilityId,
          item.id,
          assignment.repositoryId,
          assignment.role,
          assignment.checkoutRequired,
        ],
      );
    }

    if (item.executionContext?.branch) {
      const branch = item.executionContext.branch;
      await client.query(
        `
          INSERT INTO capability_work_item_branches (
            capability_id,
            id,
            work_item_id,
            repository_id,
            base_branch,
            shared_branch,
            created_by_user_id,
            head_sha,
            linked_pr_url,
            status,
            created_at,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,${withUpdatedTimestamp})
        `,
        [
          capabilityId,
          branch.id,
          item.id,
          branch.repositoryId,
          branch.baseBranch,
          branch.sharedBranch,
          branch.createdByUserId || null,
          branch.headSha || null,
          branch.linkedPrUrl || null,
          branch.status,
          branch.createdAt,
        ],
      );
    }

    if (item.executionContext?.activeWriterUserId && item.executionContext.claimExpiresAt) {
      await client.query(
        `
          INSERT INTO capability_work_item_code_claims (
            capability_id,
            work_item_id,
            user_id,
            team_id,
            claim_type,
            status,
            claimed_at,
            expires_at,
            updated_at
          )
          VALUES ($1,$2,$3,$4,'WRITE','ACTIVE',NOW(),$5,${withUpdatedTimestamp})
        `,
        [
          capabilityId,
          item.id,
          item.executionContext.activeWriterUserId,
          null,
          item.executionContext.claimExpiresAt,
        ],
      );
    }
  }
};

const hasModernWorkflowShape = (steps: unknown) =>
  Array.isArray(steps) &&
  steps.every(
    step =>
      step &&
      typeof step === 'object' &&
      typeof (step as { name?: unknown }).name === 'string' &&
      typeof (step as { phase?: unknown }).phase === 'string' &&
      typeof (step as { stepType?: unknown }).stepType === 'string' &&
      Array.isArray((step as { allowedToolIds?: unknown }).allowedToolIds) &&
      typeof (step as { executionNotes?: unknown }).executionNotes === 'string',
  );

const createRecoveredHistoryEntry = ({
  workItemId,
  phase,
  status,
  detail,
}: {
  workItemId: string;
  phase: WorkItemPhase;
  status: WorkItemStatus;
  detail: string;
}) => ({
  id: `HIST-RECOVERED-${workItemId}`,
  timestamp: new Date().toISOString(),
  actor: 'System',
  action: 'Recovered projection',
  detail,
  phase,
  status,
});

const stripWorkflowStepSuffix = (value: string) => value.split(' · ')[0].trim();

const extractTitleFromRunEvent = (message: string) => {
  const match = message.match(/was created for\s+(.+?)\.\s*$/i);
  return match?.[1]?.trim() || '';
};

const mapRunStatusToWorkItemStatus = (status: string): WorkItemStatus => {
  if (status === 'COMPLETED') {
    return 'COMPLETED';
  }
  if (status === 'WAITING_APPROVAL') {
    return 'PENDING_APPROVAL';
  }
  if (
    status === 'WAITING_HUMAN_TASK' ||
    status === 'WAITING_INPUT' ||
    status === 'WAITING_CONFLICT' ||
    status === 'FAILED'
  ) {
    return 'BLOCKED';
  }
  return 'ACTIVE';
};

const mapRunStatusToPhase = (status: string, currentPhase?: string | null): WorkItemPhase => {
  if (status === 'COMPLETED') {
    return 'DONE';
  }

  if (currentPhase) {
    return currentPhase as WorkItemPhase;
  }

  return 'BACKLOG';
};

const buildRecoveredPendingRequest = (
  wait: Record<string, any> | undefined,
) => {
  if (!wait || wait.status !== 'OPEN') {
    return null;
  }

  return {
    type: wait.type,
    message: wait.message,
    requestedBy: wait.requested_by,
    timestamp:
      wait.created_at instanceof Date ? wait.created_at.toISOString() : new Date().toISOString(),
  };
};

const buildRecoveredBlocker = (wait: Record<string, any> | undefined) => {
  if (!wait || wait.status !== 'OPEN' || wait.type === 'APPROVAL') {
    return null;
  }

  return {
    type:
      wait.type === 'CONFLICT_RESOLUTION'
        ? 'CONFLICT_RESOLUTION'
        : wait.type === 'HUMAN_TASK'
          ? 'HUMAN_TASK'
          : 'HUMAN_INPUT',
    message: wait.message,
    requestedBy: wait.requested_by,
    timestamp:
      wait.created_at instanceof Date ? wait.created_at.toISOString() : new Date().toISOString(),
    status: 'OPEN' as const,
  };
};

const repairWorkItemProjectionsTx = async (client: PoolClient) => {
  const missingResult = await client.query<{
    capability_id: string;
    work_item_id: string;
  }>(
    `
      SELECT DISTINCT source.capability_id, source.work_item_id
      FROM (
        SELECT capability_id, work_item_id
        FROM capability_workflow_runs
        WHERE work_item_id IS NOT NULL
        UNION
        SELECT capability_id, work_item_id
        FROM capability_tasks
        WHERE work_item_id IS NOT NULL
      ) AS source
      WHERE NOT EXISTS (
        SELECT 1
        FROM capability_work_items items
        WHERE items.capability_id = source.capability_id
          AND items.id = source.work_item_id
      )
      ORDER BY source.capability_id ASC, source.work_item_id ASC
    `,
  );

  for (const missing of missingResult.rows) {
    const runResult = await client.query(
      `
        SELECT *
        FROM capability_workflow_runs
        WHERE capability_id = $1 AND work_item_id = $2
        ORDER BY attempt_number DESC, created_at DESC
        LIMIT 1
      `,
      [missing.capability_id, missing.work_item_id],
    );
    const firstTaskResult = await client.query(
      `
        SELECT *
        FROM capability_tasks
        WHERE capability_id = $1 AND work_item_id = $2
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [missing.capability_id, missing.work_item_id],
    );
    const runEventResult = await client.query(
      `
        SELECT *
        FROM capability_run_events
        WHERE capability_id = $1 AND work_item_id = $2 AND type = 'RUN_CREATED'
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [missing.capability_id, missing.work_item_id],
    );
    const waitResult = await client.query(
      `
        SELECT waits.*
        FROM capability_workflow_runs runs
        JOIN capability_run_waits waits
          ON waits.capability_id = runs.capability_id
         AND waits.run_id = runs.id
        WHERE runs.capability_id = $1
          AND runs.work_item_id = $2
          AND waits.status = 'OPEN'
        ORDER BY waits.created_at DESC, waits.id DESC
        LIMIT 1
      `,
      [missing.capability_id, missing.work_item_id],
    );
    const workflowFallbackResult = await client.query(
      `
        SELECT id
        FROM capability_workflows
        WHERE capability_id = $1
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [missing.capability_id],
    );

    const latestRun = runResult.rows[0];
    const firstTask = firstTaskResult.rows[0];
    const creationEvent = runEventResult.rows[0];
    const openWait = waitResult.rows[0];
    const fallbackWorkflowId = workflowFallbackResult.rows[0]?.id || null;

    const title =
      (firstTask?.title ? stripWorkflowStepSuffix(firstTask.title) : '') ||
      (creationEvent?.message ? extractTitleFromRunEvent(creationEvent.message) : '') ||
      `Recovered ${missing.work_item_id}`;
    const phase = mapRunStatusToPhase(latestRun?.status || '', latestRun?.current_phase || firstTask?.phase);
    const status = mapRunStatusToWorkItemStatus(latestRun?.status || '');
    const pendingRequest = buildRecoveredPendingRequest(openWait);
    const blocker = buildRecoveredBlocker(openWait);

    await client.query(
      `
        INSERT INTO capability_work_items (
          capability_id,
          id,
          title,
          description,
          task_type,
          phase,
          workflow_id,
          current_step_id,
          assigned_agent_id,
          status,
          priority,
          tags,
          pending_request,
          blocker,
          active_run_id,
          last_run_id,
          history,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,${withUpdatedTimestamp}
        )
      `,
      [
        missing.capability_id,
        missing.work_item_id,
        title,
        `Recovered from workflow execution history for ${title}.`,
        null,
        phase,
        latestRun?.workflow_id || firstTask?.workflow_id || fallbackWorkflowId || '',
        phase === 'DONE' ? null : latestRun?.current_step_id || firstTask?.workflow_step_id || null,
        phase === 'DONE' ? null : latestRun?.assigned_agent_id || null,
        status,
        'Med',
        [],
        pendingRequest ? JSON.stringify(pendingRequest) : null,
        blocker ? JSON.stringify(blocker) : null,
        latestRun &&
        ['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_HUMAN_TASK', 'WAITING_INPUT', 'WAITING_CONFLICT'].includes(
          latestRun.status,
        )
          ? latestRun.id
          : null,
        latestRun?.id || null,
        JSON.stringify([
          createRecoveredHistoryEntry({
            workItemId: missing.work_item_id,
            phase,
            status,
            detail: latestRun
              ? `Recovered from workflow run ${latestRun.id}.`
              : 'Recovered from workflow-managed task history.',
          }),
        ]),
      ],
    );
  }
};

const seedCapabilityTx = async (client: PoolClient, capability: Capability) => {
  const ownerAgent = buildOwnerAgent(capability);
  const defaultWorkflows =
    capability.capabilityKind === 'COLLECTION' ? [] : getDefaultCapabilityWorkflows(capability);

  await upsertCapabilityTx(client, capability);
  await upsertWorkspaceMetaTx(client, capability.id, ownerAgent.id);
  await replaceSkillsTx(client, capability.id, capability.skillLibrary);
  await replaceAgentsTx(client, capability.id, buildSeededAgents(capability, ownerAgent));
  await replaceMessagesTx(client, capability.id, [buildWelcomeMessage(capability, ownerAgent)]);
  await replaceWorkflowsTx(client, capability.id, defaultWorkflows, capability);
  await replaceArtifactsTx(
    client,
    capability.id,
    capability.capabilityKind === 'COLLECTION'
      ? []
      : ARTIFACTS.filter(artifact => artifact.capabilityId === capability.id),
  );
  await replaceTasksTx(
    client,
    capability.id,
    AGENT_TASKS.filter(task => task.capabilityId === capability.id),
  );
  await replaceExecutionLogsTx(
    client,
    capability.id,
    EXECUTION_LOGS.filter(log => log.capabilityId === capability.id),
  );
  await replaceLearningUpdatesTx(
    client,
    capability.id,
    LEARNING_UPDATES.filter(update => update.capabilityId === capability.id),
  );
  await replaceWorkItemsTx(
    client,
    capability.id,
    capability.capabilityKind === 'COLLECTION'
      ? []
      : WORK_ITEMS.filter(item => item.capabilityId === capability.id),
  );
};

const getCapabilityByIdTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<Capability | null> => {
  const workspaceSettings = await getWorkspaceSettingsTx(client);
  const capabilityResult = await client.query('SELECT * FROM capabilities WHERE id = $1', [
    capabilityId,
  ]);

  if (!capabilityResult.rowCount) {
    return null;
  }

  const skillsResult = await client.query(
    `
      SELECT *
      FROM capability_skills
      WHERE capability_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [capabilityId],
  );
  const [repositories, dependencies, sharedReferences, publishedSnapshots] = await Promise.all([
    listCapabilityRepositoriesTx(client, capabilityId, {
      gitRepositories: asStringArray(capabilityResult.rows[0].git_repositories),
      localDirectories: asStringArray(capabilityResult.rows[0].local_directories),
    }),
    listCapabilityDependenciesTx(client, capabilityId),
    listCapabilitySharedReferencesTx(client, capabilityId),
    listCapabilityPublishedSnapshotsTx(client, capabilityId),
  ]);

  const foundationCatalog = await getWorkspaceFoundationCatalogTx(client);

  return capabilityFromRow(
    capabilityResult.rows[0],
    mergeCapabilitySkillLibrary(skillsResult.rows.map(skillFromRow), foundationCatalog),
    repositories,
    dependencies,
    sharedReferences,
    publishedSnapshots,
    workspaceSettings,
  );
};

const assertCapabilityEditableTx = async (
  client: PoolClient,
  capabilityId: string,
) => {
  const capability = await getCapabilityByIdTx(client, capabilityId);
  if (!capability) {
    throw new Error(`Capability ${capabilityId} was not found.`);
  }
  if (capability.isSystemCapability) {
    throw new Error(
      `${capability.name} is a system foundation capability and cannot be edited.`,
    );
  }

  return capability;
};

const listCapabilitiesForArchitectureTx = async (
  client: PoolClient,
  options?: { includeSystem?: boolean },
): Promise<Capability[]> => {
  const includeSystem = Boolean(options?.includeSystem);
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM capabilities
      ${includeSystem ? '' : 'WHERE COALESCE(is_system_capability, FALSE) = FALSE'}
      ORDER BY created_at ASC, id ASC
    `,
  );

  const capabilities: Capability[] = [];
  for (const row of result.rows) {
    const capability = await getCapabilityByIdTx(client, row.id);
    if (capability) {
      capabilities.push(capability);
    }
  }

  return applyCapabilityArchitecture(capabilities);
};

const getCapabilityWorkspaceTx = async (
  client: PoolClient,
  capability: Capability,
): Promise<CapabilityWorkspace> => {
  const workspaceResult = await client.query(
    'SELECT * FROM capability_workspaces WHERE capability_id = $1',
    [capability.id],
  );
  const agentResult = await client.query(
    `
      SELECT *
      FROM capability_agents
      WHERE capability_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [capability.id],
  );
  const messageResult = await client.query(
    `
      SELECT *
      FROM capability_messages
      WHERE capability_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [capability.id],
  );
  const workflowResult = await client.query(
    `
      SELECT *
      FROM capability_workflows
      WHERE capability_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [capability.id],
  );
  const artifactResult = await client.query(
    `
      SELECT *
      FROM capability_artifacts
      WHERE capability_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [capability.id],
  );
  const taskResult = await client.query(
    `
      SELECT *
      FROM capability_tasks
      WHERE capability_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [capability.id],
  );
  const logResult = await client.query(
    `
      SELECT *
      FROM capability_execution_logs
      WHERE capability_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [capability.id],
  );
  const learningResult = await client.query(
    `
      SELECT *
      FROM capability_learning_updates
      WHERE capability_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [capability.id],
  );
  const workItemResult = await client.query(
    `
      SELECT *
      FROM capability_work_items
      WHERE capability_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [capability.id],
  );
  const workItemExecutionContexts = await buildWorkItemExecutionContextsTx(
    client,
    capability.id,
  );
  const latestExecutionStateResult = await client.query(
    `
      SELECT queue_reason
      FROM capability_workflow_runs
      WHERE capability_id = $1
        AND status IN ('QUEUED', 'RUNNING', 'PAUSED', 'WAITING_APPROVAL', 'WAITING_HUMAN_TASK', 'WAITING_INPUT', 'WAITING_CONFLICT')
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `,
    [capability.id],
  );
  const learningProfilesByAgent = await listAgentLearningProfilesTx(client, capability.id);
  const sessionSummariesByAgent = await listAgentSessionSummariesTx(client, capability.id);
  const executionSurface = await buildCapabilityExecutionSurface({
    capabilityId: capability.id,
    queueReason: latestExecutionStateResult.rows[0]?.queue_reason || undefined,
  });

  const agents = agentResult.rows.map(agentFromRow).map(agent => ({
    ...agent,
    learningProfile:
      learningProfilesByAgent.get(agent.id) || agent.learningProfile,
    sessionSummaries:
      sessionSummariesByAgent.get(agent.id) || agent.sessionSummaries,
  }));
  const tasks = taskResult.rows.map(taskFromRow);
  const executionLogs = logResult.rows.map(executionLogFromRow);
  const storedWorkflows = workflowResult.rows.map(row => workflowFromRow(row, capability));
  const hasSharedStandardWorkflow = storedWorkflows.some(
    workflow =>
      workflow.templateId === STANDARD_WORKFLOW_TEMPLATE_ID ||
      workflow.name === 'Enterprise SDLC Flow',
  );
  const effectiveWorkflows = hasSharedStandardWorkflow
    ? storedWorkflows
    : [...getDefaultCapabilityWorkflows(capability), ...storedWorkflows];
  const baseWorkspace = materializeWorkspace(capability, {
    capabilityId: capability.id,
    agents: applyWorkspaceRuntime(capability, agents, tasks, executionLogs),
    workflows: effectiveWorkflows,
    artifacts: artifactResult.rows.map(artifactFromRow),
    tasks,
    executionLogs,
    learningUpdates: learningResult.rows.map(learningUpdateFromRow),
    workItems: workItemResult.rows.map(row =>
      workItemFromRow(row, workItemExecutionContexts.get(row.id)),
    ),
    messages: messageResult.rows.map(messageFromRow),
    activeChatAgentId: workspaceResult.rows[0]?.active_chat_agent_id || undefined,
    executionOwnership: executionSurface.executionOwnership,
    executionDispatchState: executionSurface.executionDispatchState,
    executionQueueReason: executionSurface.executionQueueReason,
    createdAt: workspaceCreatedAt(workspaceResult.rows[0]),
  });
  const readinessContract = buildCapabilityReadinessContract({
    capability,
    workspace: baseWorkspace,
    executionOwnership: executionSurface.executionOwnership,
    desktopExecutors: await listDesktopExecutorRegistrations(),
  });

  return {
    ...baseWorkspace,
    readinessContract,
  };
};

const getCapabilityBundleTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<CapabilityBundle> => {
  const capability = await getCapabilityByIdTx(client, capabilityId);
  if (!capability) {
    throw new Error(`Capability ${capabilityId} was not found.`);
  }

  const architectureCapabilities = await listCapabilitiesForArchitectureTx(client, {
    includeSystem: false,
  });
  const enrichedCapability =
    architectureCapabilities.find(item => item.id === capabilityId) || capability;

  const workspace = await getCapabilityWorkspaceTx(client, enrichedCapability);
  return { capability: enrichedCapability, workspace };
};

// Work-item-owned branches use the exact literal work item id so local
// checkout sessions, agent-git, PR heads, and execution context never split
// across separate naming schemes.
export const getCapabilityRepositoriesRecord = async (
  capabilityId: string,
): Promise<CapabilityRepository[]> =>
  transaction(async client => {
    const capability = await getCapabilityByIdTx(client, capabilityId);
    if (!capability) {
      throw new Error(`Capability ${capabilityId} was not found.`);
    }

    return capability.repositories || [];
  });

export const updateCapabilityRepositoriesRecord = async (
  capabilityId: string,
  repositories: CapabilityRepository[],
): Promise<CapabilityRepository[]> =>
  transaction(async client => {
    const capability = await assertCapabilityEditableTx(client, capabilityId);
    const normalizedRepositories = normalizeCapabilityRepositories(
      capabilityId,
      repositories,
      capability.gitRepositories,
      capability.localDirectories,
    );
    const legacyLists = toLegacyRepositoryLists(normalizedRepositories);
    await upsertCapabilityTx(client, {
      ...capability,
      repositories: normalizedRepositories,
      gitRepositories: legacyLists.gitRepositories,
      localDirectories: legacyLists.localDirectories,
    });
    return normalizedRepositories;
  });

export {
  acceptWorkItemHandoffPacketRecord,
  createWorkItemHandoffPacketRecord,
  getWorkItemExecutionContextRecord,
  initializeWorkItemExecutionContextRecord,
  listWorkItemHandoffPacketsRecord,
  releaseWorkItemCodeClaimRecord,
  updateWorkItemBranchRecord,
  upsertWorkItemCheckoutSessionRecord,
  upsertWorkItemCodeClaimRecord,
} from './domains/tool-plane/repository';

export const initializeSeedData = async () => {
  await transaction(async client => {
    const demoSeedEnabled = ['1', 'true', 'yes'].includes(
      String(process.env.ENABLE_DEMO_SEED || '').toLowerCase(),
    );

    if (demoSeedEnabled) {
      const currentSeedIds = new Set(CAPABILITIES.map(capability => capability.id));
      const demoCapabilityIdsToRemove = LEGACY_DEMO_CAPABILITY_IDS.filter(
        capabilityId => !currentSeedIds.has(capabilityId),
      );

      if (demoCapabilityIdsToRemove.length > 0) {
        await client.query('DELETE FROM capabilities WHERE id = ANY($1::text[])', [
          demoCapabilityIdsToRemove,
        ]);
      }

      const existing = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM capabilities
         WHERE COALESCE(is_system_capability, FALSE) = FALSE`,
      );
      const hasCapabilities = Number(existing.rows[0]?.count || '0') > 0;

      if (!hasCapabilities) {
        for (const capability of CAPABILITIES) {
          await seedCapabilityTx(client, capability);
        }
      }

      for (const seededCapability of CAPABILITIES) {
        const currentCapability = await getCapabilityByIdTx(client, seededCapability.id);
        if (!currentCapability) {
          await seedCapabilityTx(client, seededCapability);
          continue;
        }

        const backfilledCapability: Capability = {
          ...currentCapability,
          gitRepositories:
            currentCapability.gitRepositories.length > 0
              ? currentCapability.gitRepositories
              : seededCapability.gitRepositories,
          localDirectories:
            currentCapability.localDirectories.length > 0
              ? currentCapability.localDirectories
              : seededCapability.localDirectories,
          teamNames:
            currentCapability.teamNames.length > 0
              ? currentCapability.teamNames
              : seededCapability.teamNames,
          stakeholders:
            currentCapability.stakeholders.length > 0
              ? currentCapability.stakeholders
              : seededCapability.stakeholders,
          additionalMetadata:
            currentCapability.additionalMetadata.length > 0
              ? currentCapability.additionalMetadata
              : seededCapability.additionalMetadata,
        };

        await upsertCapabilityTx(client, backfilledCapability);

        const workflowCountResult = await client.query<{ count: string }>(
          `
            SELECT COUNT(*)::text AS count
            FROM capability_workflows
            WHERE capability_id = $1
          `,
          [seededCapability.id],
        );

        const workflowRowsResult = await client.query<{ steps: unknown }>(
          `
            SELECT steps
            FROM capability_workflows
            WHERE capability_id = $1
          `,
          [seededCapability.id],
        );

        const hasModernWorkflows = workflowRowsResult.rows.some(row =>
          hasModernWorkflowShape(row.steps),
        );

        if (
          Number(workflowCountResult.rows[0]?.count || '0') === 0 ||
          !hasModernWorkflows
        ) {
          await replaceWorkflowsTx(
            client,
            seededCapability.id,
            getDefaultCapabilityWorkflows(backfilledCapability),
            backfilledCapability,
          );
        }
      }
    }

    const capabilityResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM capabilities
        ORDER BY created_at ASC, id ASC
      `,
    );

    for (const row of capabilityResult.rows) {
      const capability = await getCapabilityByIdTx(client, row.id);
      if (!capability) {
        continue;
      }

      await ensureBaseAgentsTx(client, capability);

      // ── Backfill FDAS Business Use Case workflow ───────────────────────────
      // Insert FDAS for any capability that is missing it.  ON CONFLICT DO
      // NOTHING makes this idempotent — existing workflows are never touched.
      if (capability.capabilityKind !== 'COLLECTION') {
        const fdasWorkflowId = `WF-${row.id.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)}-FDAS-BUSINESS`;
        const fdasExists = await client.query<{ exists: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM capability_workflows
             WHERE capability_id = $1
               AND (id = $2 OR template_id = $3)
           ) AS exists`,
          [row.id, fdasWorkflowId, FDAS_WORKFLOW_TEMPLATE_ID],
        );

        if (!fdasExists.rows[0]?.exists) {
          const fdasWorkflow = createFdasBusinessWorkflow(capability);
          const normalizedFdas = buildWorkflowFromGraph(
            normalizeWorkflowGraph(fdasWorkflow, capability.lifecycle),
            capability.lifecycle,
          );
          await client.query(
            `INSERT INTO capability_workflows (
               capability_id, id, name, status, workflow_type, scope, summary,
               schema_version, entry_node_id, template_id,
               nodes, edges, steps, publish_state, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,${withUpdatedTimestamp})
             ON CONFLICT (capability_id, id) DO NOTHING`,
            [
              row.id,
              normalizedFdas.id,
              normalizedFdas.name,
              normalizedFdas.status,
              normalizedFdas.workflowType || null,
              normalizedFdas.scope || 'CAPABILITY',
              normalizedFdas.summary || null,
              normalizedFdas.schemaVersion || null,
              normalizedFdas.entryNodeId || null,
              normalizedFdas.templateId || null,
              JSON.stringify(normalizedFdas.nodes || []),
              JSON.stringify(normalizedFdas.edges || []),
              JSON.stringify(normalizedFdas.steps),
              normalizedFdas.publishState || 'DRAFT',
            ],
          );
        }
      }
      // ── end FDAS backfill ──────────────────────────────────────────────────
    }

    await repairWorkItemProjectionsTx(client);
  });
};

export const fetchAppState = async (): Promise<AppState> => {
  return transaction(async client => {
    const workspaceSettings = await getWorkspaceSettingsTx(client);
    const capabilities = await listCapabilitiesForArchitectureTx(client, {
      includeSystem: false,
    });
    const bundles: CapabilityBundle[] = [];

    for (const capability of capabilities) {
      bundles.push({
        capability,
        workspace: await getCapabilityWorkspaceTx(client, capability),
      });
    }

    const workspaceOrganization = await syncWorkspaceOrganizationFromCapabilities(
      bundles.map(bundle => bundle.capability),
    );

    return {
      capabilities: bundles.map(bundle => bundle.capability),
      capabilityWorkspaces: bundles.map(bundle => bundle.workspace),
      workspaceSettings,
      workspaceOrganization,
    };
  });
};

export const getWorkspaceSettings = async (): Promise<WorkspaceSettings> =>
  transaction(client => getWorkspaceSettingsTx(client));

export const updateWorkspaceSettings = async (
  updates: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> =>
  transaction(async client => {
    const current = await getWorkspaceSettingsTx(client);
    return upsertWorkspaceSettingsTx(client, {
      ...current,
      ...updates,
      databaseConfigs: updates.databaseConfigs ?? current.databaseConfigs,
      connectors: updates.connectors ?? current.connectors,
    });
  });

export const getWorkspaceCatalogSnapshot = async (): Promise<WorkspaceCatalogSnapshot> =>
  transaction(async client => {
    await getWorkspaceSettingsTx(client);
    const result = await client.query(
      `
        SELECT
          foundation_agent_templates,
          foundation_workflow_templates,
          foundation_eval_suite_templates,
          foundation_skill_templates,
          foundation_artifact_templates,
          foundation_tool_templates,
          foundations_initialized_at
        FROM workspace_settings
        WHERE id = $1
      `,
      ['DEFAULT'],
    );

    const foundations = workspaceFoundationCatalogFromRow(result.rows[0]);
    return {
      databaseRuntime: getDatabaseRuntimeInfo(),
      foundations,
      summary: summarizeWorkspaceFoundationCatalog(foundations),
    };
  });

export const initializeWorkspaceFoundations = async (): Promise<WorkspaceCatalogSnapshot> =>
  transaction(async client => {
    await getWorkspaceSettingsTx(client);
    const initializedAt = new Date().toISOString();
    const foundations = {
      ...createDefaultWorkspaceFoundationCatalog(),
      initializedAt,
    } satisfies WorkspaceFoundationCatalog;

    await client.query(
      `
        UPDATE workspace_settings
        SET
          foundation_agent_templates = $2,
          foundation_workflow_templates = $3,
          foundation_eval_suite_templates = $4,
          foundation_skill_templates = $5,
          foundation_artifact_templates = $6,
          foundation_tool_templates = $7,
          foundations_initialized_at = $8,
          updated_at = ${withUpdatedTimestamp}
        WHERE id = $1
      `,
      [
        'DEFAULT',
        JSON.stringify(foundations.agentTemplates),
        JSON.stringify(foundations.workflowTemplates),
        JSON.stringify(foundations.evalSuiteTemplates),
        JSON.stringify(foundations.skillTemplates),
        JSON.stringify(foundations.artifactTemplates),
        JSON.stringify(foundations.toolTemplates),
        initializedAt,
      ],
    );

    const foundationCapability = createWorkspaceFoundationCapability(foundations);
    const foundationOwnerAgent = buildOwnerAgent(foundationCapability);
    const foundationAgents = buildBaseAgents(
      foundationCapability,
      foundationOwnerAgent,
    );
    const foundationArtifacts = materializeCapabilityStarterArtifacts({
      capability: foundationCapability,
      agents: foundationAgents,
      foundationCatalog: foundations,
      createdAt: initializedAt,
    });
    const foundationWorkflows = [
      createStandardCapabilityWorkflow(foundationCapability),
      createBrokerageCapabilityWorkflow(foundationCapability),
      createFdasBusinessWorkflow(foundationCapability),
    ];

    await upsertCapabilityTx(client, foundationCapability);
    await replaceSkillsTx(
      client,
      foundationCapability.id,
      foundationCapability.skillLibrary,
    );
    await upsertWorkspaceMetaTx(
      client,
      foundationCapability.id,
      foundationOwnerAgent.id,
    );
    await replaceAgentsTx(client, foundationCapability.id, foundationAgents);
    await replaceMessagesTx(client, foundationCapability.id, [
      buildWelcomeMessage(foundationCapability, foundationOwnerAgent),
    ]);
    await replaceWorkflowsTx(
      client,
      foundationCapability.id,
      foundationWorkflows,
      foundationCapability,
    );
    await replaceArtifactsTx(
      client,
      foundationCapability.id,
      foundationArtifacts,
    );
    await replaceTasksTx(client, foundationCapability.id, []);
    await replaceExecutionLogsTx(client, foundationCapability.id, []);
    await replaceLearningUpdatesTx(client, foundationCapability.id, []);
    await replaceWorkItemsTx(client, foundationCapability.id, []);

    return {
      databaseRuntime: getDatabaseRuntimeInfo(),
      foundations,
      summary: summarizeWorkspaceFoundationCatalog(foundations),
    };
  });

export const getCapabilityBundle = async (capabilityId: string): Promise<CapabilityBundle> =>
  isRemoteExecutionClient()
    ? executionRuntimeRpc<CapabilityBundle>('getCapabilityBundle', {
        capabilityId,
      })
    :
  transaction(client => getCapabilityBundleTx(client, capabilityId));

export const listCapabilityTasks = async (
  capabilityId: string,
): Promise<AgentTask[]> => {
  const result = await query(
    `
      SELECT *
      FROM capability_tasks
      WHERE capability_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [capabilityId],
  );

  return result.rows.map(taskFromRow);
};

export const getCapabilityTask = async (
  capabilityId: string,
  taskId: string,
): Promise<AgentTask | null> => {
  const result = await query(
    `
      SELECT *
      FROM capability_tasks
      WHERE capability_id = $1 AND id = $2
      LIMIT 1
    `,
    [capabilityId, taskId],
  );

  return result.rowCount ? taskFromRow(result.rows[0]) : null;
};

export const publishCapabilityContractRecord = async ({
  capabilityId,
  publishedBy,
}: {
  capabilityId: string;
  publishedBy: string;
}): Promise<{ capability: Capability; snapshot: CapabilityPublishedSnapshot }> =>
  transaction(async client => {
    const capability = await assertCapabilityEditableTx(client, capabilityId);
    const existingSnapshots = await listCapabilityPublishedSnapshotsTx(client, capabilityId);
    const nextVersion = (existingSnapshots[0]?.publishVersion || 0) + 1;
    const snapshot: CapabilityPublishedSnapshot = {
      id: `PUB-${toStableSlug(capabilityId)}-${nextVersion}`,
      capabilityId,
      publishVersion: nextVersion,
      publishedAt: new Date().toISOString(),
      publishedBy,
      supersedesSnapshotId: existingSnapshots[0]?.id,
      contract: normalizeCapabilityContractDraft(
        capability.contractDraft ?? createEmptyCapabilityContractDraft(),
      ),
    };

    await createCapabilityPublishedSnapshotTx(client, capabilityId, snapshot);
    const capabilities = await listCapabilitiesForArchitectureTx(client, {
      includeSystem: false,
    });
    const nextCapability =
      capabilities.find(item => item.id === capabilityId) ||
      applyCapabilityArchitecture([
        {
          ...capability,
          publishedSnapshots: [snapshot, ...(capability.publishedSnapshots || [])],
        },
      ])[0];

    return { capability: nextCapability, snapshot };
  });

export const getCapabilityAlmExportRecord = async (
  capabilityId: string,
): Promise<CapabilityAlmExportPayload> =>
  transaction(async client => {
    const capabilities = await listCapabilitiesForArchitectureTx(client, {
      includeSystem: false,
    });
    const capability = capabilities.find(item => item.id === capabilityId);
    if (!capability) {
      throw new Error(`Capability ${capabilityId} was not found.`);
    }
    return buildCapabilityAlmExport(capability, capabilities);
  });

export {
  getCapabilityArtifact,
  getCapabilityArtifactFileBytes,
  getCapabilityArtifactFileMeta,
  listWorkItemCodePatchArtifacts,
} from './domains/tool-plane/repository';

export const createCapabilityArtifactUploadRecord = async ({
  capabilityId,
  artifact,
  file,
}: {
  capabilityId: string;
  artifact: Artifact;
  file: { bytes: Buffer; sizeBytes: number; sha256: string };
}): Promise<Artifact> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId);
    await insertArtifactTx(client, capabilityId, {
      ...artifact,
      capabilityId,
    });
    await upsertArtifactFileTx(client, capabilityId, artifact.id, file);
    return artifact;
  });

const remapAgentReference = (
  agentId: string | undefined,
  agentIdMap: Map<string, string>,
) => (agentId ? agentIdMap.get(agentId) || agentId : undefined);

const cloneFoundationWorkflowForCapability = (
  workflow: Workflow,
  capability: Pick<Capability, 'id' | 'lifecycle'>,
  agentIdMap: Map<string, string>,
): Workflow =>
  buildWorkflowFromGraph(
    normalizeWorkflowGraph(
      {
        ...workflow,
        capabilityId: capability.id,
        nodes: (workflow.nodes || []).map(node => ({
          ...node,
          agentId: remapAgentReference(node.agentId, agentIdMap),
        })),
        steps: workflow.steps.map(step => ({
          ...step,
          agentId: remapAgentReference(step.agentId, agentIdMap) || step.agentId,
          handoffToAgentId: remapAgentReference(step.handoffToAgentId, agentIdMap),
        })),
        handoffProtocols: workflow.handoffProtocols?.map(protocol => ({
          ...protocol,
          targetAgentId: remapAgentReference(protocol.targetAgentId, agentIdMap),
        })),
      },
      capability.lifecycle,
    ),
    capability.lifecycle,
  );

const cloneFoundationArtifactForCapability = (
  artifact: CapabilityWorkspace['artifacts'][number],
  capabilityId: string,
  agentIdMap: Map<string, string>,
  agentNameById: Map<string, string>,
  createdAt: string,
) => {
  const connectedAgentId = remapAgentReference(artifact.connectedAgentId, agentIdMap);
  const handoffFromAgentId = remapAgentReference(artifact.handoffFromAgentId, agentIdMap);
  const handoffToAgentId = remapAgentReference(artifact.handoffToAgentId, agentIdMap);

  return {
    ...artifact,
    capabilityId,
    created: createdAt,
    connectedAgentId,
    handoffFromAgentId,
    handoffToAgentId,
    agent:
      (connectedAgentId && agentNameById.get(connectedAgentId)) ||
      artifact.agent,
  };
};

const buildCapabilityStarterSeed = async (
  client: PoolClient,
  capability: Capability,
) => {
  const foundationCatalog = await getWorkspaceFoundationCatalogTx(client);
  const isCollectionCapability = capability.capabilityKind === 'COLLECTION';
  const foundationCapability = await getCapabilityByIdTx(
    client,
    SYSTEM_FOUNDATION_CAPABILITY_ID,
  );

  if (!foundationCapability || !isSystemFoundationCapability(foundationCapability)) {
    const nextCapability = {
      ...capability,
      skillLibrary: mergeCapabilitySkillLibrary(
        capability.skillLibrary,
        foundationCatalog,
      ),
    };
    const ownerAgent = buildOwnerAgent(nextCapability);
    const baseAgents = buildBaseAgents(nextCapability, ownerAgent);

    return {
      capability: nextCapability,
      persistedSkills: capability.skillLibrary,
      ownerAgent,
      agents: baseAgents,
      workflows: isCollectionCapability ? [] : getDefaultCapabilityWorkflows(nextCapability),
      artifacts: isCollectionCapability
        ? []
        : materializeCapabilityStarterArtifacts({
            capability: nextCapability,
            agents: baseAgents,
            foundationCatalog,
          }),
    };
  }

  const foundationWorkspace = await getCapabilityWorkspaceTx(client, foundationCapability);
  const nextCapability = {
    ...capability,
    skillLibrary: mergeCapabilitySkillLibrary(capability.skillLibrary, {
      ...foundationCatalog,
      skillTemplates: foundationCapability.skillLibrary,
    }),
  };
  const ownerAgent = buildOwnerAgent(nextCapability);
  const baseAgents = buildBaseAgents(nextCapability, ownerAgent);

  const agentIdMap = new Map<string, string>();
  for (const foundationAgent of foundationWorkspace.agents) {
    if (foundationAgent.isOwner) {
      agentIdMap.set(foundationAgent.id, ownerAgent.id);
      continue;
    }

    const targetAgent = baseAgents.find(
      agent =>
        !agent.isOwner &&
        agent.standardTemplateKey &&
        agent.standardTemplateKey === foundationAgent.standardTemplateKey,
    );
    if (targetAgent) {
      agentIdMap.set(foundationAgent.id, targetAgent.id);
    }
  }

  const agentNameById = new Map(
    baseAgents.map(agent => [agent.id, agent.name] as const),
  );
  const createdAt = new Date().toISOString();

  return {
    capability: nextCapability,
    persistedSkills: capability.skillLibrary,
    ownerAgent,
    agents: baseAgents,
    workflows: isCollectionCapability
      ? []
      : foundationWorkspace.workflows.map(workflow =>
          cloneFoundationWorkflowForCapability(workflow, nextCapability, agentIdMap),
        ),
    artifacts: isCollectionCapability
      ? []
      : foundationWorkspace.artifacts.map(artifact =>
          cloneFoundationArtifactForCapability(
            artifact,
            nextCapability.id,
            agentIdMap,
            agentNameById,
            createdAt,
          ),
        ),
  };
};

export const createCapabilityRecord = async (
  capability: Capability,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    const starterSeed = await buildCapabilityStarterSeed(client, capability);
    const initializedAt = new Date().toISOString();
    const initialLearningUpdates = starterSeed.agents.map(agent => ({
      id: `LEARN-${agent.id}-INIT`,
      capabilityId: starterSeed.capability.id,
      agentId: agent.id,
      sourceLogIds: [],
      insight: `Initial learning queued for ${agent.name} during capability initialization.`,
      timestamp: initializedAt,
      triggerType: 'INITIALIZATION' as const,
    }));

    await upsertCapabilityTx(client, starterSeed.capability);
    await replaceSkillsTx(
      client,
      starterSeed.capability.id,
      starterSeed.persistedSkills,
    );

    await upsertWorkspaceMetaTx(
      client,
      starterSeed.capability.id,
      starterSeed.ownerAgent.id,
    );
    await replaceAgentsTx(client, starterSeed.capability.id, starterSeed.agents);
    await replaceMessagesTx(client, starterSeed.capability.id, [
      buildWelcomeMessage(starterSeed.capability, starterSeed.ownerAgent),
    ]);
    await replaceWorkflowsTx(
      client,
      starterSeed.capability.id,
      starterSeed.workflows,
      starterSeed.capability,
    );
    await replaceArtifactsTx(
      client,
      starterSeed.capability.id,
      starterSeed.artifacts,
    );
    await replaceTasksTx(client, starterSeed.capability.id, []);
    await replaceExecutionLogsTx(client, starterSeed.capability.id, []);
    await replaceLearningUpdatesTx(
      client,
      starterSeed.capability.id,
      initialLearningUpdates,
    );
    await replaceWorkItemsTx(client, starterSeed.capability.id, []);

    return getCapabilityBundleTx(client, starterSeed.capability.id);
  });

export const updateCapabilityRecord = async (
  capabilityId: string,
  updates: Partial<Capability>,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    const current = await assertCapabilityEditableTx(client, capabilityId);

    const mergedCapability = mergeCapability(current, updates);
    await upsertCapabilityTx(client, mergedCapability);

    const existingWorkspace = await getCapabilityWorkspaceTx(client, mergedCapability);
    const currentOwner =
      existingWorkspace.agents.find(agent => agent.isOwner) || buildOwnerAgent(mergedCapability);
    const nextOwner = {
      ...currentOwner,
      ...buildOwnerAgent(mergedCapability),
      id: mergedCapability.specialAgentId || currentOwner.id,
    };

    if (currentOwner.id !== nextOwner.id) {
      await client.query(
        'DELETE FROM capability_agents WHERE capability_id = $1 AND id = $2',
        [capabilityId, currentOwner.id],
      );
    }

    await upsertAgentTx(client, capabilityId, nextOwner);
    await upsertWorkspaceMetaTx(
      client,
      capabilityId,
      existingWorkspace.activeChatAgentId === currentOwner.id || !existingWorkspace.activeChatAgentId
        ? nextOwner.id
        : existingWorkspace.activeChatAgentId,
      existingWorkspace.createdAt,
    );

    if (mergedCapability.capabilityKind === 'COLLECTION') {
      await replaceWorkflowsTx(client, capabilityId, [], mergedCapability);
      await replaceTasksTx(client, capabilityId, []);
      await replaceExecutionLogsTx(client, capabilityId, []);
      await replaceWorkItemsTx(client, capabilityId, []);
    }

    return getCapabilityBundleTx(client, capabilityId);
  });

export const addCapabilitySkillRecord = async (
  capabilityId: string,
  skill: Skill,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId);

    await client.query(
      `
        INSERT INTO capability_skills (
          capability_id,
          id,
          name,
          description,
          category,
          version,
          content_markdown,
          kind,
          origin,
          default_template_keys,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,${withUpdatedTimestamp})
        ON CONFLICT (capability_id, id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          version = EXCLUDED.version,
          content_markdown = EXCLUDED.content_markdown,
          kind = EXCLUDED.kind,
          origin = EXCLUDED.origin,
          default_template_keys = EXCLUDED.default_template_keys,
          updated_at = ${withUpdatedTimestamp}
      `,
      [
        capabilityId,
        skill.id,
        skill.name,
        skill.description,
        skill.category,
        skill.version,
        skill.contentMarkdown || `# ${skill.name}\n\n${skill.description}`,
        skill.kind || 'CUSTOM',
        skill.origin || 'CAPABILITY',
        skill.defaultTemplateKeys || [],
      ],
    );

    return getCapabilityBundleTx(client, capabilityId);
  });

export const removeCapabilitySkillRecord = async (
  capabilityId: string,
  skillId: string,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId);
    await client.query(
      'DELETE FROM capability_skills WHERE capability_id = $1 AND id = $2',
      [capabilityId, skillId],
    );

    const workspaceBundle = await getCapabilityBundleTx(client, capabilityId);
    const stillAvailable = new Set(
      workspaceBundle.capability.skillLibrary.map(skill => skill.id),
    );
    for (const agent of workspaceBundle.workspace.agents) {
      if (agent.skillIds.includes(skillId) && !stillAvailable.has(skillId)) {
        await upsertAgentTx(client, capabilityId, {
          ...agent,
          skillIds: agent.skillIds.filter(id => id !== skillId),
        });
      }
    }

    return getCapabilityBundleTx(client, capabilityId);
  });

export const addCapabilityAgentRecord = async (
  capabilityId: string,
  agent: Omit<CapabilityAgent, 'capabilityId'>,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId);
    await upsertAgentTx(client, capabilityId, {
      ...agent,
      capabilityId,
    });

    return getCapabilityBundleTx(client, capabilityId);
  });

export const updateCapabilityAgentRecord = async (
  capabilityId: string,
  agentId: string,
  updates: Partial<CapabilityAgent>,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId);
    const bundle = await getCapabilityBundleTx(client, capabilityId);
    const currentAgent = bundle.workspace.agents.find(agent => agent.id === agentId);
    if (!currentAgent) {
      throw new Error(`Agent ${agentId} was not found in capability ${capabilityId}.`);
    }

    await upsertAgentTx(client, capabilityId, {
      ...currentAgent,
      ...updates,
      capabilityId,
    });

    return getCapabilityBundleTx(client, capabilityId);
  });

export const updateCapabilityAgentModelsRecord = async (
  capabilityId: string,
  model: string,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId);
    const bundle = await getCapabilityBundleTx(client, capabilityId);

    for (const agent of bundle.workspace.agents) {
      await upsertAgentTx(client, capabilityId, {
        ...agent,
        capabilityId,
        model,
      });
    }

    await client.query(
      'DELETE FROM capability_agent_sessions WHERE capability_id = $1',
      [capabilityId],
    );

    return getCapabilityBundleTx(client, capabilityId);
  });

export { auditRuntimeChatTurn } from './domains/context-fabric/repository';

export const appendCapabilityMessageRecord = async (
  capabilityId: string,
  message: Omit<CapabilityChatMessage, 'capabilityId'>,
): Promise<CapabilityWorkspace> =>
  transaction(async client => {
    const capability = await assertCapabilityEditableTx(client, capabilityId);
    await appendMessageTx(client, capabilityId, {
      ...message,
      capabilityId,
    });

    return getCapabilityWorkspaceTx(client, capability);
  });

export const clearCapabilityMessageHistoryRecord = async (
  capabilityId: string,
  options?: {
    workItemId?: string;
    sessionScope?: AgentSessionScope;
    sessionScopeId?: string;
  },
): Promise<CapabilityWorkspace> =>
  transaction(async client => {
    const capability = await assertCapabilityEditableTx(client, capabilityId);
    const workItemId = String(options?.workItemId || '').trim();
    const sessionScope = options?.sessionScope;
    const sessionScopeId = String(options?.sessionScopeId || '').trim();

    if (workItemId) {
      await client.query(
        `
          DELETE FROM capability_messages
          WHERE capability_id = $1
            AND work_item_id = $2
        `,
        [capabilityId, workItemId],
      );
      await client.query(
        `
          DELETE FROM capability_agent_sessions
          WHERE capability_id = $1
            AND scope = 'WORK_ITEM'
            AND scope_id = $2
        `,
        [capabilityId, workItemId],
      );
      return getCapabilityWorkspaceTx(client, capability);
    }

    if (sessionScope === 'GENERAL_CHAT') {
      await client.query(
        `
          DELETE FROM capability_messages
          WHERE capability_id = $1
            AND work_item_id IS NULL
            AND (
              session_scope = 'GENERAL_CHAT'
              OR session_scope IS NULL
            )
            AND (
              $2::text = ''
              OR session_scope_id = $2
              OR session_scope_id IS NULL
            )
        `,
        [capabilityId, sessionScopeId],
      );
      await client.query(
        `
          DELETE FROM capability_agent_sessions
          WHERE capability_id = $1
            AND scope = 'GENERAL_CHAT'
            AND ($2::text = '' OR scope_id = $2 OR scope_id IS NULL)
        `,
        [capabilityId, sessionScopeId],
      );
      return getCapabilityWorkspaceTx(client, capability);
    }

    if (sessionScope) {
      await client.query(
        `
          DELETE FROM capability_messages
          WHERE capability_id = $1
            AND session_scope = $2
            AND ($3::text = '' OR session_scope_id = $3)
        `,
        [capabilityId, sessionScope, sessionScopeId],
      );
      await client.query(
        `
          DELETE FROM capability_agent_sessions
          WHERE capability_id = $1
            AND scope = $2
            AND ($3::text = '' OR scope_id = $3)
        `,
        [capabilityId, sessionScope, sessionScopeId],
      );
      return getCapabilityWorkspaceTx(client, capability);
    }

    await client.query('DELETE FROM capability_messages WHERE capability_id = $1', [capabilityId]);
    await client.query('DELETE FROM capability_agent_sessions WHERE capability_id = $1', [capabilityId]);
    return getCapabilityWorkspaceTx(client, capability);
  });

export const setActiveChatAgentRecord = async (
  capabilityId: string,
  agentId: string,
): Promise<CapabilityWorkspace> =>
  transaction(async client => {
    const capability = await assertCapabilityEditableTx(client, capabilityId);

    const workspace = await getCapabilityWorkspaceTx(client, capability);
    await upsertWorkspaceMetaTx(client, capabilityId, agentId, workspace.createdAt);
    return getCapabilityWorkspaceTx(client, capability);
  });

export const replaceCapabilityWorkspaceContentRecord = async (
  capabilityId: string,
  updates: Partial<
    Pick<
      CapabilityWorkspace,
      | 'workflows'
      | 'artifacts'
      | 'tasks'
      | 'executionLogs'
      | 'learningUpdates'
      | 'workItems'
      | 'activeChatAgentId'
    >
  >,
): Promise<CapabilityWorkspace> => {
  if (isRemoteExecutionClient()) {
    return executionRuntimeRpc<CapabilityWorkspace>(
      'replaceCapabilityWorkspaceContentRecord',
      { capabilityId, updates },
    );
  }

  // Capture which artifact ids existed *before* this write so we can
  // detect newly-added CODE_PATCH artifacts after the transaction
  // commits and fire the agent-git auto-commit side effect.
  const preUpdateArtifactIds = new Set<string>();

  const freshWorkspace = await transaction(async client => {
    const capability = await assertCapabilityEditableTx(client, capabilityId);

    const currentWorkspace = await getCapabilityWorkspaceTx(client, capability);
    for (const artifact of currentWorkspace.artifacts) {
      preUpdateArtifactIds.add(artifact.id);
    }

    if (updates.workflows) {
      await replaceWorkflowsTx(client, capabilityId, updates.workflows, capability);
    }
    if (updates.artifacts) {
      await replaceArtifactsTx(client, capabilityId, updates.artifacts);
    }
    if (updates.tasks) {
      await replaceTasksTx(client, capabilityId, updates.tasks);
    }
    if (updates.executionLogs) {
      await replaceExecutionLogsTx(client, capabilityId, updates.executionLogs);
    }
    if (updates.learningUpdates) {
      await replaceLearningUpdatesTx(client, capabilityId, updates.learningUpdates);
    }
    if (updates.workItems) {
      await replaceWorkItemsTx(client, capabilityId, updates.workItems);
    }
    if (updates.activeChatAgentId !== undefined) {
      await upsertWorkspaceMetaTx(
        client,
        capabilityId,
        updates.activeChatAgentId || null,
        currentWorkspace.createdAt,
      );
    }

    return getCapabilityWorkspaceTx(client, capability);
  });

  // Post-commit side-effect: for every code-change artifact (CODE_PATCH or
  // CODE_DIFF) that was *newly* persisted in this write and is scoped to a
  // work item, fire a fire-and-forget auto-commit to the corresponding
  // agent-git session. The session is lazy-created inside the helper when
  // needed. The helper dispatches on kind (CODE_PATCH vs CODE_DIFF) and
  // extracts the unified diff from the right field on each.
  //
  // Dynamic import breaks the static cycle between repository.ts and
  // agentGit/* modules (agentGit/service imports from ../repository).
  if (updates.artifacts) {
    const newCommittableArtifacts = freshWorkspace.artifacts.filter(
      artifact =>
        (artifact.artifactKind === 'CODE_PATCH' ||
          artifact.artifactKind === 'CODE_DIFF') &&
        artifact.workItemId &&
        !preUpdateArtifactIds.has(artifact.id),
    );
    if (newCommittableArtifacts.length > 0) {
      void (async () => {
        try {
          const [{ autoCommitArtifact }, { queueWorkItemAstRefresh }, bundle] = await Promise.all([
            import('./agentGit/autoWire'),
            import('./workItemAst'),
            getCapabilityBundle(capabilityId),
          ]);
          const workItemsById = new Map(
            bundle.workspace.workItems.map(item => [item.id, item]),
          );
          const repositories = bundle.capability.repositories || [];
          await Promise.all(
            newCommittableArtifacts.map(async artifact => {
              const workItem = workItemsById.get(artifact.workItemId!);
              if (!workItem) return;
              await autoCommitArtifact({
                capabilityId,
                capabilityName: bundle.capability.name,
                artifact,
                workItem: { id: workItem.id, title: workItem.title },
                repositories,
                workspaceRoots: getCapabilityWorkspaceRoots(bundle.capability),
              });
              await queueWorkItemAstRefresh({
                capability: bundle.capability,
                workItem,
              });
            }),
          );
        } catch (error) {
          console.error(
            '[agentGit/autoWire] auto-commit dispatch failed',
            error,
          );
        }
      })();
    }
  }

  return freshWorkspace;
};

// ── Workflow Versioning & Immutability ────────────────────────────────────────

export const snapshotWorkflowVersion = async (
  capabilityId: string,
  workflowId: string,
  version: number,
  nodes: unknown[],
  edges: unknown[],
  publishState: string,
  createdBy?: string,
  changeSummary?: string,
): Promise<void> => {
  const id = `wfv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await query(
    `INSERT INTO capability_workflow_versions
       (id, workflow_id, capability_id, version, nodes, edges, publish_state, created_by, change_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (workflow_id, version) DO NOTHING`,
    [id, workflowId, capabilityId, version, JSON.stringify(nodes), JSON.stringify(edges), publishState, createdBy ?? null, changeSummary ?? null],
  );
};

export const lockWorkflow = async (
  capabilityId: string,
  workflowId: string,
  lockedBy: string,
): Promise<void> => {
  await query(
    `UPDATE capability_workflows
     SET locked_at = NOW(), locked_by = $1, publish_state = 'PUBLISHED', updated_at = NOW()
     WHERE capability_id = $2 AND id = $3`,
    [lockedBy, capabilityId, workflowId],
  );
};

export const unlockWorkflow = async (
  capabilityId: string,
  workflowId: string,
  unlockedBy: string,
): Promise<{ newVersion: number }> => {
  const result = await query<{ version: number; nodes: unknown; edges: unknown; publish_state: string }>(
    `SELECT version, nodes, edges, publish_state FROM capability_workflows
     WHERE capability_id = $1 AND id = $2`,
    [capabilityId, workflowId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Workflow ${workflowId} not found`);

  // Snapshot current state before unlocking
  await snapshotWorkflowVersion(
    capabilityId,
    workflowId,
    Number(row.version),
    row.nodes as unknown[],
    row.edges as unknown[],
    row.publish_state as string,
    unlockedBy,
    `Unlocked by ${unlockedBy}`,
  );

  const newVersion = Number(row.version) + 1;
  await query(
    `UPDATE capability_workflows
     SET locked_at = NULL, locked_by = NULL, publish_state = 'VALIDATED',
         version = $1, updated_at = NOW()
     WHERE capability_id = $2 AND id = $3`,
    [newVersion, capabilityId, workflowId],
  );

  return { newVersion };
};

export const getWorkflowVersions = async (
  capabilityId: string,
  workflowId: string,
): Promise<WorkflowVersion[]> => {
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM capability_workflow_versions
     WHERE capability_id = $1 AND workflow_id = $2
     ORDER BY version DESC`,
    [capabilityId, workflowId],
  );

  return result.rows.map(row => ({
    id: row.id as string,
    workflowId: row.workflow_id as string,
    capabilityId: row.capability_id as string,
    version: Number(row.version),
    nodes: ((row.nodes as unknown) as WorkflowNode[]) ?? [],
    edges: ((row.edges as unknown) as WorkflowEdge[]) ?? [],
    publishState: row.publish_state as WorkflowVersion['publishState'],
    createdBy: (row.created_by as string) ?? undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
    changeSummary: (row.change_summary as string) ?? undefined,
  }));
};

// ── Sub-Workflow Execution Helpers ────────────────────────────────────────────

export const getChildWorkflowRuns = async (
  parentRunId: string,
): Promise<Array<{ id: string; capabilityId: string; status: string; parentRunNodeId: string }>> => {
  const result = await query<Record<string, unknown>>(
    `SELECT id, capability_id, status, parent_run_node_id
     FROM capability_workflow_runs
     WHERE parent_run_id = $1`,
    [parentRunId],
  );
  return result.rows.map(row => ({
    id: row.id as string,
    capabilityId: row.capability_id as string,
    status: row.status as string,
    parentRunNodeId: row.parent_run_node_id as string,
  }));
};

// ── Policy Templates ──────────────────────────────────────────────────────────

export { getPolicyTemplates, seedPolicyTemplates } from './domains/model-policy/repository';
