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
import {
  mergeCapabilityDatabaseConfigs,
  normalizeCapabilityDatabaseConfigs,
} from '../src/lib/capabilityDatabases';
import {
  AgentTask,
  Capability,
  CapabilityAgent,
  CapabilityDatabaseConfig,
  CapabilityChatMessage,
  CapabilityMetadataEntry,
  CapabilityStakeholder,
  CapabilityWorkspace,
  ExecutionLog,
  LearningUpdate,
  Skill,
  WorkspaceCatalogSnapshot,
  WorkspaceFoundationCatalog,
  WorkspaceSettings,
  WorkItem,
  WorkItemPhase,
  WorkItemStatus,
  Workflow,
} from '../src/types';
import { query, transaction, getDatabaseRuntimeInfo } from './db';
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
  STANDARD_WORKFLOW_TEMPLATE_ID,
} from '../src/lib/standardWorkflow';
import {
  createDefaultWorkspaceFoundationCatalog,
  summarizeWorkspaceFoundationCatalog,
} from '../src/lib/workspaceFoundations';
import { normalizeExecutionConfig } from '../src/lib/executionConfig';
import { buildWorkflowFromGraph, normalizeWorkflowGraph } from '../src/lib/workflowGraph';
import {
  listAgentLearningProfilesTx,
  listAgentSessionSummariesTx,
} from './agentLearning/repository';

type CapabilityBundle = {
  capability: Capability;
  workspace: CapabilityWorkspace;
};

type AppState = {
  capabilities: Capability[];
  capabilityWorkspaces: CapabilityWorkspace[];
  workspaceSettings: WorkspaceSettings;
};

const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  databaseConfigs: [],
};

const withUpdatedTimestamp = 'NOW()';
const LEGACY_DEMO_CAPABILITY_IDS = ['CAP-001', 'CAP-002', 'CAP-003'];

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

const asJsonArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const capabilityFromRow = (
  row: Record<string, any>,
  skills: Skill[],
  workspaceSettings: WorkspaceSettings = DEFAULT_WORKSPACE_SETTINGS,
): Capability => ({
  id: row.id,
  name: row.name,
  description: row.description,
  domain: row.domain || undefined,
  parentCapabilityId: row.parent_capability_id || undefined,
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
  teamNames: asStringArray(row.team_names),
  stakeholders: asJsonArray<CapabilityStakeholder>(row.stakeholders),
  additionalMetadata: asJsonArray<CapabilityMetadataEntry>(row.additional_metadata),
  lifecycle: normalizeCapabilityLifecycle(row.lifecycle || undefined),
  executionConfig: normalizeExecutionConfig(
    { localDirectories: asStringArray(row.local_directories) },
    row.execution_config || undefined,
  ),
  status: row.status,
  specialAgentId: row.special_agent_id || undefined,
  skillLibrary: skills,
});

const skillFromRow = (row: Record<string, any>): Skill => ({
  id: row.id,
  name: row.name,
  description: row.description,
  category: row.category,
  version: row.version,
});

const workspaceSettingsFromRow = (
  row?: Record<string, any>,
): WorkspaceSettings => ({
  databaseConfigs: normalizeCapabilityDatabaseConfigs(
    asJsonArray<CapabilityDatabaseConfig>(row?.database_configs),
  ),
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
  initializedAt:
    row?.foundations_initialized_at instanceof Date
      ? row.foundations_initialized_at.toISOString()
      : row?.foundations_initialized_at
      ? String(row.foundations_initialized_at)
      : undefined,
});

const agentFromRow = (row: Record<string, any>): CapabilityAgent => ({
  id: row.id,
  capabilityId: row.capability_id,
  name: row.name,
  role: row.role,
  objective: row.objective,
  systemPrompt: row.system_prompt,
  initializationStatus: row.initialization_status,
  documentationSources: asStringArray(row.documentation_sources),
  inputArtifacts: asStringArray(row.input_artifacts),
  outputArtifacts: asStringArray(row.output_artifacts),
  isOwner: Boolean(row.is_owner),
  isBuiltIn: Boolean(row.is_built_in),
  standardTemplateKey: row.standard_template_key || undefined,
  learningNotes: asStringArray(row.learning_notes),
  skillIds: asStringArray(row.skill_ids),
  provider: process.env.COPILOT_CLI_URL?.trim()
    ? 'GitHub Copilot SDK'
    : row.provider,
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

const artifactFromRow = (row: Record<string, any>) => ({
  id: row.id,
  name: row.name,
  capabilityId: row.capability_id,
  type: row.type,
  inputs: asStringArray(row.inputs),
  version: row.version,
  agent: row.agent,
  created: row.created,
  template: row.template || undefined,
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

const learningUpdateFromRow = (row: Record<string, any>): LearningUpdate => ({
  id: row.id,
  capabilityId: row.capability_id,
  agentId: row.agent_id,
  sourceLogIds: asStringArray(row.source_log_ids),
  insight: row.insight,
  skillUpdate: row.skill_update || undefined,
  timestamp: row.timestamp,
});

const workItemFromRow = (row: Record<string, any>): WorkItem => ({
  id: row.id,
  title: row.title,
  description: row.description,
  phase: row.phase,
  capabilityId: row.capability_id,
  workflowId: row.workflow_id,
  currentStepId: row.current_step_id || undefined,
  assignedAgentId: row.assigned_agent_id || undefined,
  status: row.status,
  priority: row.priority,
  tags: asStringArray(row.tags),
  pendingRequest: row.pending_request || undefined,
  blocker: row.blocker || undefined,
  activeRunId: row.active_run_id || undefined,
  lastRunId: row.last_run_id || undefined,
  history: asJsonArray<WorkItem['history'][number]>(row.history),
});

const workspaceCreatedAt = (row: Record<string, any> | undefined) =>
  row?.created_at instanceof Date ? row.created_at.toISOString() : new Date().toISOString();

const mergeCapability = (current: Capability, updates: Partial<Capability>): Capability => ({
  ...current,
  ...updates,
  successMetrics: updates.successMetrics ?? current.successMetrics,
  requiredEvidenceKinds:
    updates.requiredEvidenceKinds ?? current.requiredEvidenceKinds,
  applications: updates.applications ?? current.applications,
  apis: updates.apis ?? current.apis,
  databases: updates.databases ?? current.databases,
  databaseConfigs:
    updates.databaseConfigs ?? current.databaseConfigs ?? [],
  gitRepositories: updates.gitRepositories ?? current.gitRepositories,
  localDirectories: updates.localDirectories ?? current.localDirectories,
  teamNames: updates.teamNames ?? current.teamNames,
  stakeholders: updates.stakeholders ?? current.stakeholders,
  additionalMetadata: updates.additionalMetadata ?? current.additionalMetadata,
  lifecycle: normalizeCapabilityLifecycle(updates.lifecycle ?? current.lifecycle),
  executionConfig:
    updates.executionConfig ??
    normalizeExecutionConfig(current, current.executionConfig),
  skillLibrary: updates.skillLibrary ?? current.skillLibrary,
});

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
  };

  await client.query(
    `
      INSERT INTO workspace_settings (
        id,
        database_configs,
        updated_at
      )
      VALUES ($1, $2, ${withUpdatedTimestamp})
      ON CONFLICT (id) DO UPDATE SET
        database_configs = EXCLUDED.database_configs,
        updated_at = ${withUpdatedTimestamp}
    `,
    ['DEFAULT', JSON.stringify(legacyDatabaseConfigs)],
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

  await client.query(
    `
      INSERT INTO workspace_settings (
        id,
        database_configs,
        updated_at
      )
      VALUES ($1, $2, ${withUpdatedTimestamp})
      ON CONFLICT (id) DO UPDATE SET
        database_configs = EXCLUDED.database_configs,
        updated_at = ${withUpdatedTimestamp}
    `,
    ['DEFAULT', JSON.stringify(normalizedDatabaseConfigs)],
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
  } satisfies WorkspaceSettings;
};

const upsertCapabilityTx = async (client: PoolClient, capability: Capability) => {
  await client.query(
    `
      INSERT INTO capabilities (
        id,
        name,
        description,
        domain,
        parent_capability_id,
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
        lifecycle,
        execution_config,
        status,
        special_agent_id,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,${withUpdatedTimestamp}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        domain = EXCLUDED.domain,
        parent_capability_id = EXCLUDED.parent_capability_id,
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
        lifecycle = EXCLUDED.lifecycle,
        execution_config = EXCLUDED.execution_config,
        status = EXCLUDED.status,
        special_agent_id = EXCLUDED.special_agent_id,
        updated_at = ${withUpdatedTimestamp}
    `,
    [
      capability.id,
      capability.name,
      capability.description,
      capability.domain || null,
      capability.parentCapabilityId || null,
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
      capability.gitRepositories,
      capability.localDirectories,
      capability.teamNames,
      JSON.stringify(capability.stakeholders),
      JSON.stringify(capability.additionalMetadata),
      JSON.stringify(normalizeCapabilityLifecycle(capability.lifecycle)),
      JSON.stringify(normalizeExecutionConfig(capability, capability.executionConfig)),
      capability.status,
      capability.specialAgentId || null,
    ],
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
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,${withUpdatedTimestamp})
      `,
      [capabilityId, skill.id, skill.name, skill.description, skill.category, skill.version],
    );
  }
};

const upsertAgentTx = async (
  client: PoolClient,
  capabilityId: string,
  agent: Omit<CapabilityAgent, 'usage' | 'previousOutputs'>,
) => {
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
        learning_notes,
        skill_ids,
        provider,
        model,
        token_limit,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,${withUpdatedTimestamp}
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
        learning_notes = EXCLUDED.learning_notes,
        skill_ids = EXCLUDED.skill_ids,
        provider = EXCLUDED.provider,
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
      agent.inputArtifacts,
      agent.outputArtifacts,
      Boolean(agent.isOwner),
      Boolean(agent.isBuiltIn),
      agent.standardTemplateKey || null,
      agent.learningNotes || [],
      agent.skillIds,
      agent.provider,
      agent.model,
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
          agent_name
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        capabilityId,
        message.id,
        message.role,
        message.content,
        message.timestamp,
        message.agentId || null,
        message.agentName || null,
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
        agent_name
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (capability_id, id) DO UPDATE SET
        content = EXCLUDED.content,
        timestamp = EXCLUDED.timestamp,
        agent_id = EXCLUDED.agent_id,
        agent_name = EXCLUDED.agent_name
    `,
    [
      capabilityId,
      message.id,
      message.role,
      message.content,
      message.timestamp,
      message.agentId || null,
      message.agentName || null,
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
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,${withUpdatedTimestamp}
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
          linked_artifacts,
          produced_outputs,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,${withUpdatedTimestamp})
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
          timestamp
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        capabilityId,
        update.id,
        update.agentId,
        update.sourceLogIds,
        update.insight,
        update.skillUpdate || null,
        update.timestamp,
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

  for (const item of workItems) {
    await client.query(
      `
        INSERT INTO capability_work_items (
          capability_id,
          id,
          title,
          description,
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
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,${withUpdatedTimestamp})
      `,
      [
        capabilityId,
        item.id,
        item.title,
        item.description,
        item.phase,
        item.workflowId,
        item.currentStepId || null,
        item.assignedAgentId || null,
        item.status,
        item.priority,
        item.tags,
        item.pendingRequest || null,
        item.blocker || null,
        item.activeRunId || null,
        item.lastRunId || null,
        JSON.stringify(item.history || []),
      ],
    );
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
  if (status === 'WAITING_INPUT' || status === 'WAITING_CONFLICT' || status === 'FAILED') {
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
    type: wait.type === 'CONFLICT_RESOLUTION' ? 'CONFLICT_RESOLUTION' : 'HUMAN_INPUT',
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
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,${withUpdatedTimestamp}
        )
      `,
      [
        missing.capability_id,
        missing.work_item_id,
        title,
        `Recovered from workflow execution history for ${title}.`,
        phase,
        latestRun?.workflow_id || firstTask?.workflow_id || fallbackWorkflowId || '',
        phase === 'DONE' ? null : latestRun?.current_step_id || firstTask?.workflow_step_id || null,
        phase === 'DONE' ? null : latestRun?.assigned_agent_id || null,
        status,
        'Med',
        [],
        pendingRequest ? JSON.stringify(pendingRequest) : null,
        blocker ? JSON.stringify(blocker) : null,
        latestRun && ['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_INPUT', 'WAITING_CONFLICT'].includes(latestRun.status)
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
  const defaultWorkflows = getDefaultCapabilityWorkflows(capability);

  await upsertCapabilityTx(client, capability);
  await upsertWorkspaceMetaTx(client, capability.id, ownerAgent.id);
  await replaceSkillsTx(client, capability.id, capability.skillLibrary);
  await replaceAgentsTx(client, capability.id, buildSeededAgents(capability, ownerAgent));
  await replaceMessagesTx(client, capability.id, [buildWelcomeMessage(capability, ownerAgent)]);
  await replaceWorkflowsTx(client, capability.id, defaultWorkflows, capability);
  await replaceArtifactsTx(
    client,
    capability.id,
    ARTIFACTS.filter(artifact => artifact.capabilityId === capability.id),
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
    WORK_ITEMS.filter(item => item.capabilityId === capability.id),
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

  return capabilityFromRow(
    capabilityResult.rows[0],
    skillsResult.rows.map(skillFromRow),
    workspaceSettings,
  );
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
  const learningProfilesByAgent = await listAgentLearningProfilesTx(client, capability.id);
  const sessionSummariesByAgent = await listAgentSessionSummariesTx(client, capability.id);

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

  return materializeWorkspace(capability, {
    capabilityId: capability.id,
    agents: applyWorkspaceRuntime(capability, agents, tasks, executionLogs),
    workflows: effectiveWorkflows,
    artifacts: artifactResult.rows.map(artifactFromRow),
    tasks,
    executionLogs,
    learningUpdates: learningResult.rows.map(learningUpdateFromRow),
    workItems: workItemResult.rows.map(workItemFromRow),
    messages: messageResult.rows.map(messageFromRow),
    activeChatAgentId: workspaceResult.rows[0]?.active_chat_agent_id || undefined,
    createdAt: workspaceCreatedAt(workspaceResult.rows[0]),
  });
};

const getCapabilityBundleTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<CapabilityBundle> => {
  const capability = await getCapabilityByIdTx(client, capabilityId);
  if (!capability) {
    throw new Error(`Capability ${capabilityId} was not found.`);
  }

  const workspace = await getCapabilityWorkspaceTx(client, capability);
  return { capability, workspace };
};

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
        'SELECT COUNT(*)::text AS count FROM capabilities',
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
    }

    await repairWorkItemProjectionsTx(client);
  });
};

export const fetchAppState = async (): Promise<AppState> => {
  const workspaceSettings = await transaction(client => getWorkspaceSettingsTx(client));
  const capabilitiesResult = await query<{ id: string }>(
    'SELECT id FROM capabilities ORDER BY created_at ASC, id ASC',
  );
  const bundles: CapabilityBundle[] = [];

  for (const row of capabilitiesResult.rows) {
    bundles.push(await getCapabilityBundle(row.id as string));
  }

  return {
    capabilities: bundles.map(bundle => bundle.capability),
    capabilityWorkspaces: bundles.map(bundle => bundle.workspace),
    workspaceSettings,
  };
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
          foundations_initialized_at = $7,
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
        initializedAt,
      ],
    );

    return {
      databaseRuntime: getDatabaseRuntimeInfo(),
      foundations,
      summary: summarizeWorkspaceFoundationCatalog(foundations),
    };
  });

export const getCapabilityBundle = async (capabilityId: string): Promise<CapabilityBundle> =>
  transaction(client => getCapabilityBundleTx(client, capabilityId));

export const createCapabilityRecord = async (
  capability: Capability,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    await upsertCapabilityTx(client, capability);
    await replaceSkillsTx(client, capability.id, capability.skillLibrary);

    const ownerAgent = buildOwnerAgent(capability);
    await upsertWorkspaceMetaTx(client, capability.id, ownerAgent.id);
    await replaceAgentsTx(client, capability.id, buildBaseAgents(capability, ownerAgent));
    await replaceMessagesTx(client, capability.id, [buildWelcomeMessage(capability, ownerAgent)]);
    await replaceArtifactsTx(client, capability.id, []);
    await replaceTasksTx(client, capability.id, []);
    await replaceExecutionLogsTx(client, capability.id, []);
    await replaceLearningUpdatesTx(client, capability.id, []);
    await replaceWorkItemsTx(client, capability.id, []);

    return getCapabilityBundleTx(client, capability.id);
  });

export const updateCapabilityRecord = async (
  capabilityId: string,
  updates: Partial<Capability>,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    const current = await getCapabilityByIdTx(client, capabilityId);
    if (!current) {
      throw new Error(`Capability ${capabilityId} was not found.`);
    }

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

    return getCapabilityBundleTx(client, capabilityId);
  });

export const addCapabilitySkillRecord = async (
  capabilityId: string,
  skill: Skill,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    const capability = await getCapabilityByIdTx(client, capabilityId);
    if (!capability) {
      throw new Error(`Capability ${capabilityId} was not found.`);
    }

    await client.query(
      `
        INSERT INTO capability_skills (
          capability_id,
          id,
          name,
          description,
          category,
          version,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,${withUpdatedTimestamp})
        ON CONFLICT (capability_id, id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          version = EXCLUDED.version,
          updated_at = ${withUpdatedTimestamp}
      `,
      [capabilityId, skill.id, skill.name, skill.description, skill.category, skill.version],
    );

    return getCapabilityBundleTx(client, capabilityId);
  });

export const removeCapabilitySkillRecord = async (
  capabilityId: string,
  skillId: string,
): Promise<CapabilityBundle> =>
  transaction(async client => {
    await client.query(
      'DELETE FROM capability_skills WHERE capability_id = $1 AND id = $2',
      [capabilityId, skillId],
    );

    const workspaceBundle = await getCapabilityBundleTx(client, capabilityId);
    for (const agent of workspaceBundle.workspace.agents) {
      if (agent.skillIds.includes(skillId)) {
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

export const appendCapabilityMessageRecord = async (
  capabilityId: string,
  message: Omit<CapabilityChatMessage, 'capabilityId'>,
): Promise<CapabilityWorkspace> =>
  transaction(async client => {
    await appendMessageTx(client, capabilityId, {
      ...message,
      capabilityId,
    });

    const capability = await getCapabilityByIdTx(client, capabilityId);
    if (!capability) {
      throw new Error(`Capability ${capabilityId} was not found.`);
    }

    return getCapabilityWorkspaceTx(client, capability);
  });

export const setActiveChatAgentRecord = async (
  capabilityId: string,
  agentId: string,
): Promise<CapabilityWorkspace> =>
  transaction(async client => {
    const capability = await getCapabilityByIdTx(client, capabilityId);
    if (!capability) {
      throw new Error(`Capability ${capabilityId} was not found.`);
    }

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
): Promise<CapabilityWorkspace> =>
  transaction(async client => {
    const capability = await getCapabilityByIdTx(client, capabilityId);
    if (!capability) {
      throw new Error(`Capability ${capabilityId} was not found.`);
    }

    const currentWorkspace = await getCapabilityWorkspaceTx(client, capability);

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
