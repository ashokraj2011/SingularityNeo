import type { PoolClient } from 'pg'
import type {
  Artifact,
  ArtifactTemplateSection,
  CapabilityRepository,
  WorkItemBranch,
  WorkItemCheckoutSession,
  WorkItemCodeClaim,
  WorkItemExecutionContext,
  WorkItemHandoffPacket,
  WorkItemRepositoryAssignment,
} from '../../../src/contracts'
import { query, transaction } from '../../db'
import {
  executionRuntimeRpc,
  isRemoteExecutionClient,
} from '../../execution/runtimeClient'

const withUpdatedTimestamp = 'NOW()'

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const asJsonArray = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : []

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
})

const toStableSlug = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)

const normalizeCapabilityRepository = (
  capabilityId: string,
  repository: Partial<CapabilityRepository>,
  fallbackIndex = 0,
): CapabilityRepository | null => {
  const url = String(repository.url || '').trim()
  const label = String(repository.label || '').trim()
  const defaultBranch = String(repository.defaultBranch || '').trim() || 'main'

  if (!url && !label) {
    return null
  }

  return {
    id:
      String(repository.id || '').trim() ||
      `REPO-${toStableSlug(capabilityId)}-${
        toStableSlug(url || label || `REPOSITORY-${fallbackIndex + 1}`) ||
        `REPOSITORY-${fallbackIndex + 1}`
      }`,
    capabilityId,
    label:
      label ||
      url.split('/').pop()?.replace(/\.git$/i, '') ||
      `Repository ${fallbackIndex + 1}`,
    url: url || label,
    defaultBranch,
    localRootHint: String(repository.localRootHint || '').trim() || undefined,
    isPrimary: Boolean(repository.isPrimary),
    status: repository.status || 'ACTIVE',
  }
}

const buildLegacyCapabilityRepositories = (
  capabilityId: string,
  gitRepositories: string[],
  localDirectories: string[],
): CapabilityRepository[] => {
  const repoUrls = gitRepositories.map(value => String(value || '').trim()).filter(Boolean)
  const repoRoots = localDirectories.map(value => String(value || '').trim()).filter(Boolean)
  const total = Math.max(repoUrls.length, repoRoots.length)

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
    )

    return normalized ? [normalized] : []
  })
}

const repositoryAssignmentFromRow = (
  row: Record<string, any>,
): WorkItemRepositoryAssignment => ({
  workItemId: row.work_item_id,
  repositoryId: row.repository_id,
  role: row.role,
  checkoutRequired: Boolean(row.checkout_required),
})

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
})

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
})

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
})

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
})

const buildSharedBranchName = (workItemId: string) => {
  const segment = String(workItemId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `wi/${segment || 'work-item'}`
}

const assertCapabilityEditableTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<{
  id: string
  name: string
  gitRepositories: string[]
  localDirectories: string[]
}> => {
  const result = await client.query<Record<string, any>>(
    `
      SELECT id, name, is_system_capability, git_repositories, local_directories
      FROM capabilities
      WHERE id = $1
      LIMIT 1
    `,
    [capabilityId],
  )

  const row = result.rows[0]
  if (!row) {
    throw new Error(`Capability ${capabilityId} was not found.`)
  }
  if (row.is_system_capability) {
    throw new Error(
      `${String(row.name || capabilityId)} is a system foundation capability and cannot be edited.`,
    )
  }

  return {
    id: String(row.id),
    name: String(row.name || capabilityId),
    gitRepositories: asStringArray(row.git_repositories),
    localDirectories: asStringArray(row.local_directories),
  }
}

const listCapabilityRepositoriesTx = async (
  client: PoolClient,
  capabilityId: string,
  legacy: {
    gitRepositories: string[]
    localDirectories: string[]
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
  )

  if (result.rowCount === 0) {
    return buildLegacyCapabilityRepositories(
      capabilityId,
      legacy.gitRepositories,
      legacy.localDirectories,
    )
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
    .filter(Boolean) as CapabilityRepository[]
}

const buildWorkItemExecutionContextsTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<Map<string, WorkItemExecutionContext>> => {
  // These three queries must run sequentially on the same PoolClient.
  // pg does not multiplex — firing multiple client.query() calls concurrently
  // on one connection triggers a DeprecationWarning in pg@8 and will be an
  // error in pg@9.  Use individual awaits instead of Promise.all here.
  const assignmentResult = await client.query(
    `
      SELECT *
      FROM capability_work_item_repository_assignments
      WHERE capability_id = $1
      ORDER BY created_at ASC
    `,
    [capabilityId],
  )
  const branchResult = await client.query(
    `
      SELECT *
      FROM capability_work_item_branches
      WHERE capability_id = $1
      ORDER BY created_at DESC
    `,
    [capabilityId],
  )
  const claimResult = await client.query(
    `
      SELECT *
      FROM capability_work_item_code_claims
      WHERE capability_id = $1
        AND status = 'ACTIVE'
        AND claim_type = 'WRITE'
      ORDER BY claimed_at DESC
    `,
    [capabilityId],
  )

  const assignmentsByWorkItem = new Map<string, WorkItemRepositoryAssignment[]>()
  for (const row of assignmentResult.rows) {
    const assignment = repositoryAssignmentFromRow(row)
    const next = assignmentsByWorkItem.get(assignment.workItemId) || []
    next.push(assignment)
    assignmentsByWorkItem.set(assignment.workItemId, next)
  }

  const branchesByWorkItem = new Map<string, WorkItemBranch[]>()
  for (const row of branchResult.rows) {
    const branch = workItemBranchFromRow(row)
    const next = branchesByWorkItem.get(branch.workItemId) || []
    next.push(branch)
    branchesByWorkItem.set(branch.workItemId, next)
  }

  const activeClaimByWorkItem = new Map<string, WorkItemCodeClaim>()
  for (const row of claimResult.rows) {
    const claim = workItemCodeClaimFromRow(row)
    if (!activeClaimByWorkItem.has(claim.workItemId)) {
      activeClaimByWorkItem.set(claim.workItemId, claim)
    }
  }

  const workItemIds = new Set<string>([
    ...assignmentsByWorkItem.keys(),
    ...branchesByWorkItem.keys(),
    ...activeClaimByWorkItem.keys(),
  ])
  const contexts = new Map<string, WorkItemExecutionContext>()

  for (const workItemId of workItemIds) {
    const assignments = assignmentsByWorkItem.get(workItemId) || []
    const branches = branchesByWorkItem.get(workItemId) || []
    const activeBranch =
      branches.find(branch => branch.status === 'ACTIVE') ||
      branches.find(branch => branch.status === 'NOT_CREATED') ||
      branches[0]
    const activeClaim = activeClaimByWorkItem.get(workItemId)
    const primaryRepositoryId =
      assignments.find(assignment => assignment.role === 'PRIMARY')?.repositoryId ||
      activeBranch?.repositoryId ||
      assignments[0]?.repositoryId

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
    })
  }

  return contexts
}

export const getCapabilityArtifact = async (
  capabilityId: string,
  artifactId: string,
): Promise<Artifact | null> => {
  const result = await query(
    `
      SELECT *
      FROM capability_artifacts
      WHERE capability_id = $1 AND id = $2
      LIMIT 1
    `,
    [capabilityId, artifactId],
  )

  return result.rows[0] ? artifactFromRow(result.rows[0]) : null
}

export const listWorkItemCodePatchArtifacts = async ({
  capabilityId,
  workItemId,
  limit = 10,
}: {
  capabilityId: string
  workItemId: string
  limit?: number
}): Promise<Artifact[]> => {
  const result = await query(
    `
      SELECT *
      FROM capability_artifacts
      WHERE capability_id = $1
        AND work_item_id = $2
        AND artifact_kind = 'CODE_PATCH'
      ORDER BY created DESC
      LIMIT $3
    `,
    [capabilityId, workItemId, Math.max(1, Math.min(limit, 100))],
  )

  return result.rows.map(artifactFromRow)
}

export const getCapabilityArtifactFileMeta = async (
  capabilityId: string,
  artifactId: string,
): Promise<{ sizeBytes: number; sha256: string } | null> => {
  const result = await query(
    `
      SELECT size_bytes, sha256
      FROM capability_artifact_files
      WHERE capability_id = $1 AND artifact_id = $2
      LIMIT 1
    `,
    [capabilityId, artifactId],
  )

  const row = result.rows[0] as Record<string, any> | undefined
  if (!row) {
    return null
  }

  return {
    sizeBytes: Number(row.size_bytes) || 0,
    sha256: String(row.sha256 || ''),
  }
}

export const getCapabilityArtifactFileBytes = async (
  capabilityId: string,
  artifactId: string,
): Promise<{ bytes: Buffer; sizeBytes: number; sha256: string } | null> => {
  const result = await query(
    `
      SELECT bytes, size_bytes, sha256
      FROM capability_artifact_files
      WHERE capability_id = $1 AND artifact_id = $2
      LIMIT 1
    `,
    [capabilityId, artifactId],
  )

  const row = result.rows[0] as Record<string, any> | undefined
  if (!row) {
    return null
  }

  return {
    bytes: row.bytes as Buffer,
    sizeBytes: Number(row.size_bytes) || 0,
    sha256: String(row.sha256 || ''),
  }
}

export const getWorkItemExecutionContextRecord = async ({
  capabilityId,
  workItemId,
}: {
  capabilityId: string
  workItemId: string
}): Promise<WorkItemExecutionContext | null> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId)
    const contexts = await buildWorkItemExecutionContextsTx(client, capabilityId)
    return contexts.get(workItemId) || null
  })

export const initializeWorkItemExecutionContextRecord = async ({
  capabilityId,
  workItemId,
  actorUserId,
}: {
  capabilityId: string
  workItemId: string
  actorUserId?: string
}): Promise<WorkItemExecutionContext> =>
  transaction(async client => {
    const capability = await assertCapabilityEditableTx(client, capabilityId)
    const workItemResult = await client.query(
      `
        SELECT id
        FROM capability_work_items
        WHERE capability_id = $1
          AND id = $2
        LIMIT 1
      `,
      [capabilityId, workItemId],
    )
    if (!workItemResult.rowCount) {
      throw new Error(`Work item ${workItemId} was not found.`)
    }

    const repositories = (
      await listCapabilityRepositoriesTx(client, capabilityId, {
        gitRepositories: capability.gitRepositories,
        localDirectories: capability.localDirectories,
      })
    ).filter(repository => repository.status !== 'ARCHIVED')
    const primaryRepository =
      repositories.find(repository => repository.isPrimary) || repositories[0]
    if (!primaryRepository) {
      throw new Error(
        `${capability.name} does not have an approved repository configured yet.`,
      )
    }

    const expectedSharedBranch = buildSharedBranchName(workItemId)
    const existingContexts = await buildWorkItemExecutionContextsTx(client, capabilityId)
    const existing = existingContexts.get(workItemId)
    if (existing?.repositoryAssignments.length && existing.branch) {
      if (
        existing.branch.sharedBranch !== expectedSharedBranch &&
        existing.branch.status === 'NOT_CREATED'
      ) {
        await client.query(
          `
            UPDATE capability_work_item_branches
            SET shared_branch = $3,
                updated_at = ${withUpdatedTimestamp}
            WHERE capability_id = $1
              AND id = $2
          `,
          [capabilityId, existing.branch.id, expectedSharedBranch],
        )
        const refreshedContexts = await buildWorkItemExecutionContextsTx(client, capabilityId)
        return (
          refreshedContexts.get(workItemId) || {
            ...existing,
            branch: {
              ...existing.branch,
              sharedBranch: expectedSharedBranch,
            },
          }
        )
      }
      return existing
    }

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
        ON CONFLICT (capability_id, work_item_id, repository_id) DO UPDATE SET
          role = EXCLUDED.role,
          checkout_required = EXCLUDED.checkout_required,
          updated_at = ${withUpdatedTimestamp}
      `,
      [capabilityId, workItemId, primaryRepository.id, 'PRIMARY', true],
    )

    const branchId = `WIBR-${Math.random().toString(36).slice(2, 10).toUpperCase()}`
    const nextBranch: WorkItemBranch = {
      id: branchId,
      workItemId,
      repositoryId: primaryRepository.id,
      baseBranch: primaryRepository.defaultBranch || 'main',
      sharedBranch: expectedSharedBranch,
      createdByUserId: actorUserId,
      createdAt: new Date().toISOString(),
      status: 'NOT_CREATED',
    }

    if (!existing?.branch) {
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
          nextBranch.id,
          workItemId,
          nextBranch.repositoryId,
          nextBranch.baseBranch,
          nextBranch.sharedBranch,
          nextBranch.createdByUserId || null,
          null,
          null,
          nextBranch.status,
          nextBranch.createdAt,
        ],
      )
    }

    const contexts = await buildWorkItemExecutionContextsTx(client, capabilityId)
    return (
      contexts.get(workItemId) || {
        workItemId,
        primaryRepositoryId: primaryRepository.id,
        repositoryAssignments: [
          {
            workItemId,
            repositoryId: primaryRepository.id,
            role: 'PRIMARY',
            checkoutRequired: true,
          },
        ],
        branch: existing?.branch || nextBranch,
        strategy: 'SHARED_BRANCH',
      }
    )
  })

export const updateWorkItemBranchRecord = async ({
  capabilityId,
  workItemId,
  branch,
}: {
  capabilityId: string
  workItemId: string
  branch: WorkItemBranch
}): Promise<WorkItemExecutionContext> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId)
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
        ON CONFLICT (capability_id, id) DO UPDATE SET
          repository_id = EXCLUDED.repository_id,
          base_branch = EXCLUDED.base_branch,
          shared_branch = EXCLUDED.shared_branch,
          created_by_user_id = EXCLUDED.created_by_user_id,
          head_sha = EXCLUDED.head_sha,
          linked_pr_url = EXCLUDED.linked_pr_url,
          status = EXCLUDED.status,
          updated_at = ${withUpdatedTimestamp}
      `,
      [
        capabilityId,
        branch.id,
        workItemId,
        branch.repositoryId,
        branch.baseBranch,
        branch.sharedBranch,
        branch.createdByUserId || null,
        branch.headSha || null,
        branch.linkedPrUrl || null,
        branch.status,
        branch.createdAt,
      ],
    )
    const contexts = await buildWorkItemExecutionContextsTx(client, capabilityId)
    const context = contexts.get(workItemId)
    if (!context) {
      throw new Error(`Execution context for ${workItemId} could not be rebuilt.`)
    }
    return context
  })

export const upsertWorkItemCodeClaimRecord = async ({
  capabilityId,
  workItemId,
  userId,
  teamId,
  claimType,
  status,
  expiresAt,
}: {
  capabilityId: string
  workItemId: string
  userId: string
  teamId?: string
  claimType: WorkItemCodeClaim['claimType']
  status: WorkItemCodeClaim['status']
  expiresAt: string
}): Promise<WorkItemCodeClaim> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId)
    const result = await client.query(
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
          released_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,NULL,${withUpdatedTimestamp})
        ON CONFLICT (capability_id, work_item_id, claim_type) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          team_id = EXCLUDED.team_id,
          status = EXCLUDED.status,
          claimed_at = NOW(),
          expires_at = EXCLUDED.expires_at,
          released_at = NULL,
          updated_at = ${withUpdatedTimestamp}
        RETURNING *
      `,
      [capabilityId, workItemId, userId, teamId || null, claimType, status, expiresAt],
    )
    return workItemCodeClaimFromRow(result.rows[0])
  })

export const releaseWorkItemCodeClaimRecord = async ({
  capabilityId,
  workItemId,
  claimType,
  userId,
}: {
  capabilityId: string
  workItemId: string
  claimType: WorkItemCodeClaim['claimType']
  userId?: string
}): Promise<void> =>
  isRemoteExecutionClient()
    ? executionRuntimeRpc<void>('releaseWorkItemCodeClaimRecord', {
        capabilityId,
        workItemId,
        claimType,
        userId,
      })
    : transaction(async client => {
        await assertCapabilityEditableTx(client, capabilityId)
        await client.query(
          `
            UPDATE capability_work_item_code_claims
            SET
              status = 'RELEASED',
              released_at = NOW(),
              updated_at = ${withUpdatedTimestamp}
            WHERE capability_id = $1
              AND work_item_id = $2
              AND claim_type = $3
              AND ($4::text IS NULL OR user_id = $4)
              AND status = 'ACTIVE'
          `,
          [capabilityId, workItemId, claimType, userId || null],
        )
      })

export const upsertWorkItemCheckoutSessionRecord = async ({
  capabilityId,
  session,
}: {
  capabilityId: string
  session: WorkItemCheckoutSession
}): Promise<WorkItemCheckoutSession> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId)
    const result = await client.query(
      `
        INSERT INTO desktop_work_item_checkout_sessions (
          executor_id,
          capability_id,
          work_item_id,
          user_id,
          repository_id,
          local_path,
          working_directory_path,
          branch,
          last_seen_head_sha,
          last_synced_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,${withUpdatedTimestamp})
        ON CONFLICT (executor_id, capability_id, work_item_id, user_id, repository_id) DO UPDATE SET
          local_path = EXCLUDED.local_path,
          working_directory_path = EXCLUDED.working_directory_path,
          branch = EXCLUDED.branch,
          last_seen_head_sha = EXCLUDED.last_seen_head_sha,
          last_synced_at = EXCLUDED.last_synced_at,
          updated_at = ${withUpdatedTimestamp}
        RETURNING *
      `,
      [
        session.executorId,
        capabilityId,
        session.workItemId,
        session.userId,
        session.repositoryId,
        session.localPath || null,
        session.workingDirectoryPath || null,
        session.branch,
        session.lastSeenHeadSha || null,
        session.lastSyncedAt || new Date().toISOString(),
      ],
    )
    return workItemCheckoutSessionFromRow(result.rows[0])
  })

export const createWorkItemHandoffPacketRecord = async ({
  capabilityId,
  packet,
}: {
  capabilityId: string
  packet: WorkItemHandoffPacket
}): Promise<WorkItemHandoffPacket> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId)
    const result = await client.query(
      `
        INSERT INTO capability_work_item_handoff_packets (
          capability_id,
          id,
          work_item_id,
          from_user_id,
          to_user_id,
          from_team_id,
          to_team_id,
          summary,
          open_questions,
          blocking_dependencies,
          recommended_next_step,
          artifact_ids,
          trace_ids,
          delegation_origin_task_id,
          delegation_origin_agent_id,
          accepted_at,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,${withUpdatedTimestamp})
        RETURNING *
      `,
      [
        capabilityId,
        packet.id,
        packet.workItemId,
        packet.fromUserId || null,
        packet.toUserId || null,
        packet.fromTeamId || null,
        packet.toTeamId || null,
        packet.summary,
        JSON.stringify(packet.openQuestions || []),
        JSON.stringify(packet.blockingDependencies || []),
        packet.recommendedNextStep || null,
        JSON.stringify(packet.artifactIds || []),
        JSON.stringify(packet.traceIds || []),
        packet.delegationOriginTaskId || null,
        packet.delegationOriginAgentId || null,
        packet.acceptedAt || null,
        packet.createdAt,
      ],
    )
    return workItemHandoffPacketFromRow(result.rows[0])
  })

export const acceptWorkItemHandoffPacketRecord = async ({
  capabilityId,
  packetId,
}: {
  capabilityId: string
  packetId: string
}): Promise<WorkItemHandoffPacket> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId)
    const result = await client.query(
      `
        UPDATE capability_work_item_handoff_packets
        SET
          accepted_at = NOW(),
          updated_at = ${withUpdatedTimestamp}
        WHERE capability_id = $1
          AND id = $2
        RETURNING *
      `,
      [capabilityId, packetId],
    )
    if (!result.rowCount) {
      throw new Error(`Work item handoff ${packetId} was not found.`)
    }
    return workItemHandoffPacketFromRow(result.rows[0])
  })

export const listWorkItemHandoffPacketsRecord = async ({
  capabilityId,
  workItemId,
}: {
  capabilityId: string
  workItemId: string
}): Promise<WorkItemHandoffPacket[]> =>
  transaction(async client => {
    await assertCapabilityEditableTx(client, capabilityId)
    const result = await client.query(
      `
        SELECT *
        FROM capability_work_item_handoff_packets
        WHERE capability_id = $1
          AND work_item_id = $2
        ORDER BY created_at DESC
      `,
      [capabilityId, workItemId],
    )
    return result.rows.map(workItemHandoffPacketFromRow)
  })
