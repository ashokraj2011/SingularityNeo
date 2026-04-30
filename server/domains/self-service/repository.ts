import type { PoolClient } from 'pg'
import type {
  AgentTask,
  CapabilityDatabaseConfig,
  WorkspaceCatalogSnapshot,
  WorkspaceFoundationCatalog,
  WorkspaceSettings,
} from '../../../src/contracts'
import {
  mergeCapabilityDatabaseConfigs,
  normalizeCapabilityDatabaseConfigs,
} from '../../../src/lib/capabilityDatabases'
import { normalizeWorkspaceConnectorSettings } from '../../../src/lib/workspaceConnectors'
import {
  createDefaultWorkspaceFoundationCatalog,
  summarizeWorkspaceFoundationCatalog,
} from '../../../src/lib/workspaceFoundations'
import { getDatabaseRuntimeInfo, query, transaction } from '../../db'

const withUpdatedTimestamp = 'NOW()'

const asJsonArray = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : []

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
  linkedArtifacts: asJsonArray<
    NonNullable<AgentTask['linkedArtifacts']>[number]
  >(row.linked_artifacts),
  producedOutputs: asJsonArray<
    NonNullable<AgentTask['producedOutputs']>[number]
  >(row.produced_outputs),
})

const workspaceSettingsFromRow = (
  row?: Record<string, any>,
): WorkspaceSettings => ({
  databaseConfigs: normalizeCapabilityDatabaseConfigs(
    asJsonArray<CapabilityDatabaseConfig>(row?.database_configs),
  ),
  connectors: normalizeWorkspaceConnectorSettings(row?.connector_settings),
})

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
})

const collectLegacyWorkspaceDatabaseConfigsTx = async (client: PoolClient) => {
  const result = await client.query<{ database_configs: unknown }>(
    `
      SELECT database_configs
      FROM capabilities
    `,
  )

  return mergeCapabilityDatabaseConfigs(
    ...result.rows.map(row => asJsonArray<CapabilityDatabaseConfig>(row.database_configs)),
  )
}

const getWorkspaceSettingsTx = async (client: PoolClient): Promise<WorkspaceSettings> => {
  const result = await client.query('SELECT * FROM workspace_settings WHERE id = $1', ['DEFAULT'])

  if (result.rowCount) {
    const settings = workspaceSettingsFromRow(result.rows[0])
    if (settings.databaseConfigs.length > 0) {
      return settings
    }
  }

  const legacyDatabaseConfigs = await collectLegacyWorkspaceDatabaseConfigsTx(client)
  const nextSettings = {
    databaseConfigs: legacyDatabaseConfigs,
    connectors: normalizeWorkspaceConnectorSettings(),
  }

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
  )

  return nextSettings
}

const upsertWorkspaceSettingsTx = async (
  client: PoolClient,
  settings: WorkspaceSettings,
): Promise<WorkspaceSettings> => {
  const normalizedDatabaseConfigs = normalizeCapabilityDatabaseConfigs(
    settings.databaseConfigs,
  )
  const normalizedConnectors = normalizeWorkspaceConnectorSettings(settings.connectors)

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
  )

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
  )

  return {
    databaseConfigs: normalizedDatabaseConfigs,
    connectors: normalizedConnectors,
  }
}

export const getWorkspaceSettings = async (): Promise<WorkspaceSettings> =>
  transaction(client => getWorkspaceSettingsTx(client))

export const updateWorkspaceSettings = async (
  updates: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> =>
  transaction(async client => {
    const current = await getWorkspaceSettingsTx(client)
    return upsertWorkspaceSettingsTx(client, {
      ...current,
      ...updates,
      databaseConfigs: updates.databaseConfigs ?? current.databaseConfigs,
      connectors: updates.connectors ?? current.connectors,
    })
  })

export const getWorkspaceCatalogSnapshot = async (): Promise<WorkspaceCatalogSnapshot> =>
  transaction(async client => {
    await getWorkspaceSettingsTx(client)
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
    )

    const foundations = workspaceFoundationCatalogFromRow(result.rows[0])
    return {
      databaseRuntime: getDatabaseRuntimeInfo(),
      foundations:
        result.rowCount > 0 ? foundations : createDefaultWorkspaceFoundationCatalog(),
      summary: summarizeWorkspaceFoundationCatalog(
        result.rowCount > 0 ? foundations : createDefaultWorkspaceFoundationCatalog(),
      ),
    }
  })

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
  )

  return result.rows.map(taskFromRow)
}

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
  )

  return result.rowCount ? taskFromRow(result.rows[0]) : null
}

export {
  addCapabilityAgentRecord,
  addCapabilitySkillRecord,
  clearCapabilityMessageHistoryRecord,
  createCapabilityRecord,
  fetchAppState,
  getCapabilityAlmExportRecord,
  getCapabilityBundle,
  getCapabilityRepositoriesRecord,
  initializeSeedData,
  initializeWorkspaceFoundations,
  publishCapabilityContractRecord,
  removeCapabilitySkillRecord,
  replaceCapabilityWorkspaceContentRecord,
  setActiveChatAgentRecord,
  updateCapabilityAgentModelsRecord,
  updateCapabilityAgentRecord,
  updateCapabilityRecord,
  updateCapabilityRepositoriesRecord,
  type CapabilityBundle,
} from '../../repository'
