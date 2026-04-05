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
  AgentTask,
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityMetadataEntry,
  CapabilityStakeholder,
  CapabilityWorkspace,
  ExecutionLog,
  LearningUpdate,
  Skill,
  WorkItem,
  Workflow,
} from '../src/types';
import { query, transaction } from './db';
import {
  applyWorkspaceRuntime,
  buildOwnerAgent,
  buildSeededAgents,
  buildWelcomeMessage,
  materializeWorkspace,
} from './workspace';

type CapabilityBundle = {
  capability: Capability;
  workspace: CapabilityWorkspace;
};

type AppState = {
  capabilities: Capability[];
  capabilityWorkspaces: CapabilityWorkspace[];
};

const withUpdatedTimestamp = 'NOW()';

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

const asJsonArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const capabilityFromRow = (row: Record<string, any>, skills: Skill[]): Capability => ({
  id: row.id,
  name: row.name,
  description: row.description,
  domain: row.domain || undefined,
  parentCapabilityId: row.parent_capability_id || undefined,
  businessUnit: row.business_unit || undefined,
  ownerTeam: row.owner_team || undefined,
  confluenceLink: row.confluence_link || undefined,
  jiraBoardLink: row.jira_board_link || undefined,
  documentationNotes: row.documentation_notes || undefined,
  applications: asStringArray(row.applications),
  apis: asStringArray(row.apis),
  databases: asStringArray(row.databases),
  gitRepositories: asStringArray(row.git_repositories),
  localDirectories: asStringArray(row.local_directories),
  teamNames: asStringArray(row.team_names),
  stakeholders: asJsonArray<CapabilityStakeholder>(row.stakeholders),
  additionalMetadata: asJsonArray<CapabilityMetadataEntry>(row.additional_metadata),
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
  learningNotes: asStringArray(row.learning_notes),
  skillIds: asStringArray(row.skill_ids),
  provider: row.provider,
  model: row.model,
  tokenLimit: Number(row.token_limit || 0),
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

const workflowFromRow = (row: Record<string, any>): Workflow => ({
  id: row.id,
  name: row.name,
  capabilityId: row.capability_id,
  steps: asJsonArray<Workflow['steps'][number]>(row.steps),
  status: row.status,
  workflowType: row.workflow_type || undefined,
  scope: row.scope || 'CAPABILITY',
  summary: row.summary || undefined,
});

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
});

const taskFromRow = (row: Record<string, any>): AgentTask => ({
  id: row.id,
  title: row.title,
  agent: row.agent,
  capabilityId: row.capability_id,
  priority: row.priority,
  status: row.status,
  timestamp: row.timestamp,
  prompt: row.prompt || undefined,
  executionNotes: row.execution_notes || undefined,
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
});

const workspaceCreatedAt = (row: Record<string, any> | undefined) =>
  row?.created_at instanceof Date ? row.created_at.toISOString() : new Date().toISOString();

const mergeCapability = (current: Capability, updates: Partial<Capability>): Capability => ({
  ...current,
  ...updates,
  applications: updates.applications ?? current.applications,
  apis: updates.apis ?? current.apis,
  databases: updates.databases ?? current.databases,
  gitRepositories: updates.gitRepositories ?? current.gitRepositories,
  localDirectories: updates.localDirectories ?? current.localDirectories,
  teamNames: updates.teamNames ?? current.teamNames,
  stakeholders: updates.stakeholders ?? current.stakeholders,
  additionalMetadata: updates.additionalMetadata ?? current.additionalMetadata,
  skillLibrary: updates.skillLibrary ?? current.skillLibrary,
});

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
        confluence_link,
        jira_board_link,
        documentation_notes,
        applications,
        apis,
        databases,
        git_repositories,
        local_directories,
        team_names,
        stakeholders,
        additional_metadata,
        status,
        special_agent_id,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,${withUpdatedTimestamp}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        domain = EXCLUDED.domain,
        parent_capability_id = EXCLUDED.parent_capability_id,
        business_unit = EXCLUDED.business_unit,
        owner_team = EXCLUDED.owner_team,
        confluence_link = EXCLUDED.confluence_link,
        jira_board_link = EXCLUDED.jira_board_link,
        documentation_notes = EXCLUDED.documentation_notes,
        applications = EXCLUDED.applications,
        apis = EXCLUDED.apis,
        databases = EXCLUDED.databases,
        git_repositories = EXCLUDED.git_repositories,
        local_directories = EXCLUDED.local_directories,
        team_names = EXCLUDED.team_names,
        stakeholders = EXCLUDED.stakeholders,
        additional_metadata = EXCLUDED.additional_metadata,
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
      capability.confluenceLink || null,
      capability.jiraBoardLink || null,
      capability.documentationNotes || null,
      capability.applications,
      capability.apis,
      capability.databases,
      capability.gitRepositories,
      capability.localDirectories,
      capability.teamNames,
      JSON.stringify(capability.stakeholders),
      JSON.stringify(capability.additionalMetadata),
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
        learning_notes,
        skill_ids,
        provider,
        model,
        token_limit,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,${withUpdatedTimestamp}
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
) => {
  await client.query('DELETE FROM capability_workflows WHERE capability_id = $1', [capabilityId]);

  for (const workflow of workflows) {
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
          steps,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${withUpdatedTimestamp})
      `,
      [
        capabilityId,
        workflow.id,
        workflow.name,
        workflow.status,
        workflow.workflowType || null,
        workflow.scope || 'CAPABILITY',
        workflow.summary || null,
        JSON.stringify(workflow.steps),
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
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,${withUpdatedTimestamp}
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
          priority,
          status,
          timestamp,
          prompt,
          execution_notes,
          linked_artifacts,
          produced_outputs,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,${withUpdatedTimestamp})
      `,
      [
        capabilityId,
        task.id,
        task.title,
        task.agent,
        task.priority,
        task.status,
        task.timestamp,
        task.prompt || null,
        task.executionNotes || null,
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
          metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
      [
        capabilityId,
        log.id,
        log.taskId,
        log.agentId,
        log.timestamp,
        log.level,
        log.message,
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
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,${withUpdatedTimestamp})
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
      ],
    );
  }
};

const getCapabilityByIdTx = async (
  client: PoolClient,
  capabilityId: string,
): Promise<Capability | null> => {
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

  return capabilityFromRow(capabilityResult.rows[0], skillsResult.rows.map(skillFromRow));
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

  const agents = agentResult.rows.map(agentFromRow);
  const tasks = taskResult.rows.map(taskFromRow);
  const executionLogs = logResult.rows.map(executionLogFromRow);

  return materializeWorkspace(capability, {
    capabilityId: capability.id,
    agents: applyWorkspaceRuntime(capability, agents, tasks, executionLogs),
    workflows: workflowResult.rows.map(workflowFromRow),
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
  const existing = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM capabilities');
  const hasCapabilities = Number(existing.rows[0]?.count || '0') > 0;

  await transaction(async client => {
    if (!hasCapabilities) {
      for (const capability of CAPABILITIES) {
        const ownerAgent = buildOwnerAgent(capability);
        await upsertCapabilityTx(client, capability);
        await upsertWorkspaceMetaTx(client, capability.id, ownerAgent.id);
        await replaceSkillsTx(client, capability.id, capability.skillLibrary);
        await replaceAgentsTx(client, capability.id, buildSeededAgents(capability, ownerAgent));
        await replaceMessagesTx(client, capability.id, [buildWelcomeMessage(capability, ownerAgent)]);
        await replaceWorkflowsTx(
          client,
          capability.id,
          WORKFLOWS.filter(workflow => workflow.capabilityId === capability.id),
        );
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
      }
      return;
    }

    for (const seededCapability of CAPABILITIES) {
      const currentCapability = await getCapabilityByIdTx(client, seededCapability.id);
      if (!currentCapability) {
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
    }
  });
};

export const fetchAppState = async (): Promise<AppState> => {
  const capabilitiesResult = await query<{ id: string }>(
    'SELECT id FROM capabilities ORDER BY created_at ASC, id ASC',
  );
  const bundles = await Promise.all(
    capabilitiesResult.rows.map(row => getCapabilityBundle(row.id as string)),
  );

  return {
    capabilities: bundles.map(bundle => bundle.capability),
    capabilityWorkspaces: bundles.map(bundle => bundle.workspace),
  };
};

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
    await replaceAgentsTx(client, capability.id, [ownerAgent]);
    await replaceMessagesTx(client, capability.id, [buildWelcomeMessage(capability, ownerAgent)]);
    await replaceWorkflowsTx(client, capability.id, []);
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
      await replaceWorkflowsTx(client, capabilityId, updates.workflows);
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
