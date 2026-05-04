/**
 * Business Workflow — DB layer + minimal runtime engine.
 *
 * This module owns:
 *   1. CRUD on `capability_business_workflow_templates` (designer-time)
 *   2. Publishing → snapshot rows in `..._template_versions`
 *   3. Starting instances pinned to a published version
 *   4. Activating nodes per their type:
 *        HUMAN_TASK / FORM_FILL  → row in capability_business_tasks
 *        APPROVAL                → row in capability_business_approvals
 *        AGENT_TASK              → invokeCommonAgentRuntime, auto-advance
 *        DECISION_GATE           → evaluate + advance synchronously
 *        PARALLEL_FORK           → activate all outgoing target nodes
 *        PARALLEL_JOIN           → wait until all incoming edges complete
 *        TIMER                   → store timer record (V1: no auto-fire)
 *        NOTIFICATION            → emit NOTIFICATION_SENT event
 *        CALL_WORKFLOW           → spawn child instance
 *        START                   → immediately advance
 *        END                     → mark instance COMPLETED
 *   5. Advancing the instance after a task or approval resolves
 *
 * NOT in V1:
 *   - Real timer auto-fire (no background sweep)
 *   - PARALLEL_JOIN actually computing "all incoming edges done" — V1
 *     uses a simple counter on the join node's metadata
 *   - Tool execution (TOOL_REQUEST is a no-op + warn)
 *   - SAGA / compensation
 */

import { query, transaction } from "./db";
import { evaluateEdgeCondition } from "../src/lib/businessWorkflowConditions";
import type {
  ApprovalStatus,
  AssignmentMode,
  BusinessApproval,
  BusinessEdge,
  BusinessInstanceStatus,
  BusinessNode,
  BusinessNodeBaseType,
  BusinessPhase,
  BusinessTask,
  BusinessTemplateStatus,
  BusinessWorkflowEvent,
  BusinessWorkflowEventType,
  BusinessWorkflowInstance,
  BusinessWorkflowTemplate,
  BusinessWorkflowVersion,
  FormSchema,
  TaskPriority,
  TaskStatus,
} from "../src/contracts/businessWorkflow";
import { findJoinsBetween } from "../src/lib/businessWorkflowRuntime";

// ── ID helpers ───────────────────────────────────────────────────────────────

const createId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

// ── Row mappers ──────────────────────────────────────────────────────────────

const asJsonArray = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];
const asJsonObject = <T>(value: unknown): T =>
  value && typeof value === "object" ? (value as T) : ({} as T);
const asString = (value: unknown): string | undefined =>
  value == null ? undefined : String(value);
const asIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value || "");

const rowToTemplate = (row: Record<string, unknown>): BusinessWorkflowTemplate => ({
  capabilityId: String(row.capability_id),
  id: String(row.id),
  name: String(row.name),
  description: asString(row.description),
  status: String(row.status) as BusinessTemplateStatus,
  currentVersion: Number(row.current_version || 0),
  draftNodes: asJsonArray<BusinessNode>(row.draft_nodes),
  draftEdges: asJsonArray<BusinessEdge>(row.draft_edges),
  draftPhases: asJsonArray<BusinessPhase>(row.draft_phases),
  metadata: asJsonObject<Record<string, unknown>>(row.metadata),
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
  archivedAt: row.archived_at ? asIso(row.archived_at) : undefined,
});

const rowToVersion = (row: Record<string, unknown>): BusinessWorkflowVersion => ({
  capabilityId: String(row.capability_id),
  templateId: String(row.template_id),
  version: Number(row.version),
  nodes: asJsonArray<BusinessNode>(row.nodes),
  edges: asJsonArray<BusinessEdge>(row.edges),
  phases: asJsonArray<BusinessPhase>(row.phases),
  publishedBy: String(row.published_by),
  publishedAt: asIso(row.published_at),
});

const rowToInstance = (
  row: Record<string, unknown>,
): BusinessWorkflowInstance => ({
  capabilityId: String(row.capability_id),
  id: String(row.id),
  templateId: String(row.template_id),
  templateVersion: Number(row.template_version),
  status: String(row.status) as BusinessInstanceStatus,
  context: asJsonObject<Record<string, unknown>>(row.context),
  activeNodeIds: asJsonArray<string>(row.active_node_ids),
  startedBy: String(row.started_by),
  startedAt: asIso(row.started_at),
  completedAt: row.completed_at ? asIso(row.completed_at) : undefined,
  metadata: asJsonObject<Record<string, unknown>>(row.metadata),
  pausedAt: row.paused_at ? asIso(row.paused_at) : undefined,
  pausedBy: asString(row.paused_by),
  pausedReason: asString(row.paused_reason),
});

const rowToTask = (row: Record<string, unknown>): BusinessTask => ({
  capabilityId: String(row.capability_id),
  id: String(row.id),
  instanceId: String(row.instance_id),
  nodeId: String(row.node_id),
  title: String(row.title),
  description: asString(row.description),
  status: String(row.status) as TaskStatus,
  assignmentMode: String(row.assignment_mode) as AssignmentMode,
  assignedUserId: asString(row.assigned_user_id),
  assignedTeamId: asString(row.assigned_team_id),
  assignedRole: asString(row.assigned_role),
  assignedSkill: asString(row.assigned_skill),
  claimedBy: asString(row.claimed_by),
  claimedAt: row.claimed_at ? asIso(row.claimed_at) : undefined,
  dueAt: row.due_at ? asIso(row.due_at) : undefined,
  priority: (row.priority as TaskPriority) || "NORMAL",
  formSchema: row.form_schema as Record<string, unknown> | null | undefined,
  formData: row.form_data as Record<string, unknown> | undefined,
  output: row.output as Record<string, unknown> | undefined,
  createdAt: asIso(row.created_at),
  completedAt: row.completed_at ? asIso(row.completed_at) : undefined,
  // V2 fields. Default booleans to false for legacy rows that pre-date
  // the columns being added (NULL → false).
  sentBackFromNodeId: asString(row.sent_back_from_node_id),
  sentBackReason: asString(row.sent_back_reason),
  reassignedAt: row.reassigned_at ? asIso(row.reassigned_at) : undefined,
  reassignedBy: asString(row.reassigned_by),
  isAdHoc: row.is_ad_hoc === true,
  adHocBlocking: row.ad_hoc_blocking === true,
  parentTaskId: asString(row.parent_task_id),
  createdBy: asString(row.created_by),
});

const rowToApproval = (row: Record<string, unknown>): BusinessApproval => ({
  capabilityId: String(row.capability_id),
  id: String(row.id),
  instanceId: String(row.instance_id),
  nodeId: String(row.node_id),
  status: String(row.status) as ApprovalStatus,
  assignedUserId: asString(row.assigned_user_id),
  assignedTeamId: asString(row.assigned_team_id),
  assignedRole: asString(row.assigned_role),
  dueAt: row.due_at ? asIso(row.due_at) : undefined,
  decision: asString(row.decision),
  decidedBy: asString(row.decided_by),
  decidedAt: row.decided_at ? asIso(row.decided_at) : undefined,
  conditions: asString(row.conditions),
  notes: asString(row.notes),
  createdAt: asIso(row.created_at),
  sentBackFromNodeId: asString(row.sent_back_from_node_id),
  sentBackReason: asString(row.sent_back_reason),
  reassignedAt: row.reassigned_at ? asIso(row.reassigned_at) : undefined,
  reassignedBy: asString(row.reassigned_by),
});

// ── Event emit ───────────────────────────────────────────────────────────────

const emitEvent = async ({
  capabilityId,
  instanceId,
  nodeId,
  eventType,
  payload,
  actorId,
}: {
  capabilityId: string;
  instanceId: string;
  nodeId?: string;
  eventType: BusinessWorkflowEventType;
  payload?: Record<string, unknown>;
  actorId?: string;
}): Promise<BusinessWorkflowEvent> => {
  const id = createId("BWE");
  await query(
    `
    INSERT INTO capability_business_workflow_events
      (id, capability_id, instance_id, node_id, event_type, payload, actor_id)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
    `,
    [
      id,
      capabilityId,
      instanceId,
      nodeId || null,
      eventType,
      JSON.stringify(payload || {}),
      actorId || null,
    ],
  );
  return {
    id,
    capabilityId,
    instanceId,
    nodeId,
    eventType,
    payload: payload || {},
    actorId,
    occurredAt: new Date().toISOString(),
  };
};

// ── Template CRUD ────────────────────────────────────────────────────────────

export const listBusinessTemplates = async (
  capabilityId: string,
): Promise<BusinessWorkflowTemplate[]> => {
  const result = await query(
    `
    SELECT * FROM capability_business_workflow_templates
    WHERE capability_id = $1 AND archived_at IS NULL
    ORDER BY updated_at DESC
    `,
    [capabilityId],
  );
  return result.rows.map((row) => rowToTemplate(row as Record<string, unknown>));
};

export const fetchBusinessTemplate = async (
  capabilityId: string,
  templateId: string,
): Promise<BusinessWorkflowTemplate | null> => {
  const result = await query(
    `SELECT * FROM capability_business_workflow_templates WHERE capability_id = $1 AND id = $2`,
    [capabilityId, templateId],
  );
  if (result.rows.length === 0) return null;
  return rowToTemplate(result.rows[0] as Record<string, unknown>);
};

/**
 * Create a new draft template with START + END nodes pre-placed so the
 * canvas opens to a usable state.
 */
export const createBusinessTemplate = async ({
  capabilityId,
  name,
  description,
}: {
  capabilityId: string;
  name: string;
  description?: string;
}): Promise<BusinessWorkflowTemplate> => {
  const id = createId("BWF");
  const startNode: BusinessNode = {
    id: "node-start",
    type: "START",
    label: "Start",
    position: { x: 80, y: 200 },
    config: {},
  };
  const endNode: BusinessNode = {
    id: "node-end",
    type: "END",
    label: "End",
    position: { x: 800, y: 200 },
    config: {},
  };
  const result = await query(
    `
    INSERT INTO capability_business_workflow_templates
      (capability_id, id, name, description, draft_nodes, draft_edges, draft_phases)
    VALUES ($1, $2, $3, $4, $5::jsonb, '[]'::jsonb, '[]'::jsonb)
    RETURNING *
    `,
    [
      capabilityId,
      id,
      name.trim() || "Untitled business workflow",
      description?.trim() || null,
      JSON.stringify([startNode, endNode]),
    ],
  );
  return rowToTemplate(result.rows[0] as Record<string, unknown>);
};

export const saveBusinessTemplateDraft = async ({
  capabilityId,
  templateId,
  name,
  description,
  draftNodes,
  draftEdges,
  draftPhases,
  metadata,
}: {
  capabilityId: string;
  templateId: string;
  name?: string;
  description?: string;
  draftNodes?: BusinessNode[];
  draftEdges?: BusinessEdge[];
  draftPhases?: BusinessPhase[];
  metadata?: Record<string, unknown>;
}): Promise<BusinessWorkflowTemplate | null> => {
  const result = await query(
    `
    UPDATE capability_business_workflow_templates SET
      name           = COALESCE($3, name),
      description    = COALESCE($4, description),
      draft_nodes    = COALESCE($5::jsonb, draft_nodes),
      draft_edges    = COALESCE($6::jsonb, draft_edges),
      draft_phases   = COALESCE($7::jsonb, draft_phases),
      metadata       = COALESCE($8::jsonb, metadata),
      updated_at     = NOW()
    WHERE capability_id = $1 AND id = $2
    RETURNING *
    `,
    [
      capabilityId,
      templateId,
      name?.trim() || null,
      description != null ? description : null,
      draftNodes ? JSON.stringify(draftNodes) : null,
      draftEdges ? JSON.stringify(draftEdges) : null,
      draftPhases ? JSON.stringify(draftPhases) : null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
  if (result.rows.length === 0) return null;
  return rowToTemplate(result.rows[0] as Record<string, unknown>);
};

export const archiveBusinessTemplate = async (
  capabilityId: string,
  templateId: string,
): Promise<void> => {
  await query(
    `
    UPDATE capability_business_workflow_templates
    SET archived_at = NOW(), status = 'ARCHIVED', updated_at = NOW()
    WHERE capability_id = $1 AND id = $2
    `,
    [capabilityId, templateId],
  );
};

export const publishBusinessTemplate = async ({
  capabilityId,
  templateId,
  publishedBy,
}: {
  capabilityId: string;
  templateId: string;
  publishedBy: string;
}): Promise<BusinessWorkflowVersion | null> => {
  const tpl = await fetchBusinessTemplate(capabilityId, templateId);
  if (!tpl) return null;

  // Atomic publish.
  //
  // Two failure modes we used to hit:
  //   1. INSERT version_row succeeds, then UPDATE current_version fails:
  //      template's `current_version` stays stale, and the next publish
  //      attempt computes the SAME nextVersion → unique-constraint
  //      violation on (capability_id, template_id, version).
  //   2. Two operators clicking Publish at the same instant both compute
  //      the same nextVersion → duplicate insert.
  //
  // Fix:
  //   - Wrap both writes in a single transaction.
  //   - Take a row-level lock on the templates row (FOR UPDATE) to
  //     serialise concurrent publishes.
  //   - Compute nextVersion from MAX(version) on the actual versions
  //     table inside the same transaction, so any drift between
  //     `templates.current_version` and the versions table self-heals.
  return transaction(async (client) => {
    await client.query(
      `SELECT 1 FROM capability_business_workflow_templates
       WHERE capability_id = $1 AND id = $2 FOR UPDATE`,
      [capabilityId, templateId],
    );
    const maxResult = await client.query<{ max: number | null }>(
      `SELECT MAX(version) AS max
       FROM capability_business_workflow_template_versions
       WHERE capability_id = $1 AND template_id = $2`,
      [capabilityId, templateId],
    );
    const existingMax = Number(maxResult.rows[0]?.max ?? 0) || 0;
    // Honour either the locked row's current_version OR what's actually
    // in the versions table — whichever is greater.
    const nextVersion =
      Math.max(existingMax, Number(tpl.currentVersion) || 0) + 1;

    await client.query(
      `
      INSERT INTO capability_business_workflow_template_versions
        (capability_id, template_id, version, nodes, edges, phases, published_by)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)
      `,
      [
        capabilityId,
        templateId,
        nextVersion,
        JSON.stringify(tpl.draftNodes),
        JSON.stringify(tpl.draftEdges),
        JSON.stringify(tpl.draftPhases),
        publishedBy,
      ],
    );
    await client.query(
      `
      UPDATE capability_business_workflow_templates
      SET current_version = $3, status = 'PUBLISHED', updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
      `,
      [capabilityId, templateId, nextVersion],
    );
    return {
      capabilityId,
      templateId,
      version: nextVersion,
      nodes: tpl.draftNodes,
      edges: tpl.draftEdges,
      phases: tpl.draftPhases,
      publishedBy,
      publishedAt: new Date().toISOString(),
    };
  });
};

export const listBusinessTemplateVersions = async (
  capabilityId: string,
  templateId: string,
): Promise<BusinessWorkflowVersion[]> => {
  const result = await query(
    `
    SELECT * FROM capability_business_workflow_template_versions
    WHERE capability_id = $1 AND template_id = $2
    ORDER BY version DESC
    `,
    [capabilityId, templateId],
  );
  return result.rows.map((row) => rowToVersion(row as Record<string, unknown>));
};

const fetchTemplateVersion = async (
  capabilityId: string,
  templateId: string,
  version: number,
): Promise<BusinessWorkflowVersion | null> => {
  const result = await query(
    `
    SELECT * FROM capability_business_workflow_template_versions
    WHERE capability_id = $1 AND template_id = $2 AND version = $3
    `,
    [capabilityId, templateId, version],
  );
  if (result.rows.length === 0) return null;
  return rowToVersion(result.rows[0] as Record<string, unknown>);
};

// ── Runtime: instances ───────────────────────────────────────────────────────

const fetchInstance = async (
  capabilityId: string,
  instanceId: string,
): Promise<BusinessWorkflowInstance | null> => {
  const result = await query(
    `SELECT * FROM capability_business_workflow_instances WHERE capability_id = $1 AND id = $2`,
    [capabilityId, instanceId],
  );
  if (result.rows.length === 0) return null;
  return rowToInstance(result.rows[0] as Record<string, unknown>);
};

export const getBusinessInstance = fetchInstance;

const updateInstance = async (
  instance: BusinessWorkflowInstance,
): Promise<void> => {
  await query(
    `
    UPDATE capability_business_workflow_instances SET
      status           = $3,
      context          = $4::jsonb,
      active_node_ids  = $5::jsonb,
      completed_at     = $6,
      metadata         = $7::jsonb
    WHERE capability_id = $1 AND id = $2
    `,
    [
      instance.capabilityId,
      instance.id,
      instance.status,
      JSON.stringify(instance.context),
      JSON.stringify(instance.activeNodeIds),
      instance.completedAt || null,
      JSON.stringify(instance.metadata),
    ],
  );
};

// ── Output binding helper ────────────────────────────────────────────────────

const setPath = (
  context: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> => {
  if (!path) return context;
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cursor: Record<string, unknown> = context;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const next = cursor[key];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  return context;
};

const applyOutputBindings = (
  context: Record<string, unknown>,
  node: BusinessNode,
  output: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  if (!output) return context;
  const bindings = node.config.outputBindings || [];
  if (bindings.length === 0) {
    // Default: stash full output under `nodeOutputs.<nodeId>`
    return setPath(context, `nodeOutputs.${node.id}`, output);
  }
  let next = { ...context };
  for (const binding of bindings) {
    const value = output[binding.name];
    if (value !== undefined) {
      next = setPath(next, binding.contextPath, value);
    }
  }
  return next;
};

// ── Activation per node base type ────────────────────────────────────────────

const baseTypeOf = (
  node: BusinessNode,
  customNodeBaseTypeMap: Map<string, BusinessNodeBaseType>,
): BusinessNodeBaseType => {
  // If type is one of the known base types, return it directly.
  const known: BusinessNodeBaseType[] = [
    "START",
    "END",
    "HUMAN_TASK",
    "APPROVAL",
    "FORM_FILL",
    "DECISION_GATE",
    "PARALLEL_FORK",
    "PARALLEL_JOIN",
    "TIMER",
    "NOTIFICATION",
    "AGENT_TASK",
    "TOOL_REQUEST",
    "CALL_WORKFLOW",
  ];
  if (known.includes(node.type as BusinessNodeBaseType)) {
    return node.type as BusinessNodeBaseType;
  }
  return customNodeBaseTypeMap.get(node.type) || "HUMAN_TASK";
};

const createTaskRow = async (
  instance: BusinessWorkflowInstance,
  node: BusinessNode,
): Promise<BusinessTask> => {
  const id = createId("BTASK");
  const assignment = node.config.assignment;
  const result = await query(
    `
    INSERT INTO capability_business_tasks
      (capability_id, id, instance_id, node_id, title, description, status,
       assignment_mode, assigned_user_id, assigned_team_id, assigned_role,
       assigned_skill, due_at, priority, form_schema)
    VALUES ($1, $2, $3, $4, $5, $6, 'OPEN',
            $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
    RETURNING *
    `,
    [
      instance.capabilityId,
      id,
      instance.id,
      node.id,
      node.label || node.id,
      node.config.description || null,
      assignment?.mode || "DIRECT_USER",
      assignment?.userId || null,
      assignment?.teamId || null,
      assignment?.role || null,
      assignment?.skill || null,
      // SLA → due_at = now + slaMinutes
      node.config.slaMinutes
        ? new Date(Date.now() + node.config.slaMinutes * 60_000).toISOString()
        : null,
      node.config.priority || "NORMAL",
      node.config.formSchema ? JSON.stringify(node.config.formSchema) : null,
    ],
  );
  return rowToTask(result.rows[0] as Record<string, unknown>);
};

const createApprovalRow = async (
  instance: BusinessWorkflowInstance,
  node: BusinessNode,
): Promise<BusinessApproval> => {
  const id = createId("BAPP");
  const assignment = node.config.assignment;
  const result = await query(
    `
    INSERT INTO capability_business_approvals
      (capability_id, id, instance_id, node_id, status,
       assigned_user_id, assigned_team_id, assigned_role, due_at)
    VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $8)
    RETURNING *
    `,
    [
      instance.capabilityId,
      id,
      instance.id,
      node.id,
      assignment?.userId || null,
      assignment?.teamId || null,
      assignment?.role || null,
      node.config.slaMinutes
        ? new Date(Date.now() + node.config.slaMinutes * 60_000).toISOString()
        : null,
    ],
  );
  return rowToApproval(result.rows[0] as Record<string, unknown>);
};

interface ActivationContext {
  instance: BusinessWorkflowInstance;
  version: BusinessWorkflowVersion;
  customBaseTypes: Map<string, BusinessNodeBaseType>;
  actorId?: string;
}

/**
 * Recursive activation of a node. Synchronous-completing nodes (START,
 * DECISION_GATE, NOTIFICATION, END) advance immediately; long-running
 * ones (HUMAN_TASK, APPROVAL, TIMER) leave the node in `activeNodeIds`
 * and return.
 */
const activateNode = async (
  ctx: ActivationContext,
  node: BusinessNode,
): Promise<void> => {
  const { instance, version, customBaseTypes, actorId } = ctx;
  const base = baseTypeOf(node, customBaseTypes);

  await emitEvent({
    capabilityId: instance.capabilityId,
    instanceId: instance.id,
    nodeId: node.id,
    eventType: "NODE_ACTIVATED",
    payload: { type: base },
    actorId,
  });

  switch (base) {
    case "START":
    case "PARALLEL_FORK": {
      // Synchronous: advance through every outgoing edge whose
      // condition matches.
      const targets = pickActivatableTargets(version, node, instance.context);
      // For START there's typically one target; for fork, several.
      for (const target of targets) {
        await activateNode(ctx, target);
      }
      return;
    }
    case "END": {
      instance.status = "COMPLETED";
      instance.completedAt = new Date().toISOString();
      instance.activeNodeIds = instance.activeNodeIds.filter((id) => id !== node.id);
      await updateInstance(instance);
      await emitEvent({
        capabilityId: instance.capabilityId,
        instanceId: instance.id,
        nodeId: node.id,
        eventType: "INSTANCE_COMPLETED",
        actorId,
      });
      return;
    }
    case "DECISION_GATE": {
      // Evaluate outgoing edges; take first matching, or default.
      const targets = pickActivatableTargets(version, node, instance.context);
      if (targets.length === 0 && node.config.defaultEdgeId) {
        const def = version.edges.find((e) => e.id === node.config.defaultEdgeId);
        if (def) {
          const defNode = version.nodes.find((n) => n.id === def.targetNodeId);
          if (defNode) await activateNode(ctx, defNode);
        }
      }
      for (const target of targets) {
        await activateNode(ctx, target);
      }
      return;
    }
    case "HUMAN_TASK":
    case "FORM_FILL": {
      await createTaskRow(instance, node);
      if (!instance.activeNodeIds.includes(node.id)) {
        instance.activeNodeIds = [...instance.activeNodeIds, node.id];
        await updateInstance(instance);
      }
      return;
    }
    case "APPROVAL": {
      await createApprovalRow(instance, node);
      if (!instance.activeNodeIds.includes(node.id)) {
        instance.activeNodeIds = [...instance.activeNodeIds, node.id];
        await updateInstance(instance);
      }
      return;
    }
    case "AGENT_TASK": {
      // V1 stub: emit AGENT_DELEGATED event, store the request payload,
      // and immediately advance with an empty output. The real delegate-
      // to-existing-capability-agent invocation hook is wired through
      // the route handler so we don't pull the entire agent runtime
      // import chain into this module in V1.
      await emitEvent({
        capabilityId: instance.capabilityId,
        instanceId: instance.id,
        nodeId: node.id,
        eventType: "AGENT_DELEGATED",
        payload: {
          agentId: node.config.agentId,
          promptTemplate: node.config.agentPromptTemplate,
        },
        actorId,
      });
      if (!instance.activeNodeIds.includes(node.id)) {
        instance.activeNodeIds = [...instance.activeNodeIds, node.id];
        await updateInstance(instance);
      }
      return;
    }
    case "TOOL_REQUEST": {
      // Not implemented in V1 — leave node active; operator can manually
      // advance via /complete on a task created elsewhere, or cancel.
      console.warn(
        `[business-workflow] TOOL_REQUEST node ${node.id} activated; tool execution is not implemented in V1.`,
      );
      if (!instance.activeNodeIds.includes(node.id)) {
        instance.activeNodeIds = [...instance.activeNodeIds, node.id];
        await updateInstance(instance);
      }
      return;
    }
    case "TIMER": {
      // V1 stub: store timer config in metadata; no auto-fire.
      const timerKey = `timers.${node.id}`;
      const fireAt = node.config.timerMinutes
        ? new Date(Date.now() + node.config.timerMinutes * 60_000).toISOString()
        : null;
      instance.metadata = setPath(instance.metadata, timerKey, {
        nodeId: node.id,
        fireAt,
      });
      if (!instance.activeNodeIds.includes(node.id)) {
        instance.activeNodeIds = [...instance.activeNodeIds, node.id];
      }
      await updateInstance(instance);
      return;
    }
    case "NOTIFICATION": {
      await emitEvent({
        capabilityId: instance.capabilityId,
        instanceId: instance.id,
        nodeId: node.id,
        eventType: "NOTIFICATION_SENT",
        payload: {
          channel: node.config.notificationChannel || "IN_APP",
          recipients: node.config.notificationRecipients || [],
        },
        actorId,
      });
      // Synchronous → advance immediately.
      const targets = pickActivatableTargets(version, node, instance.context);
      for (const target of targets) {
        await activateNode(ctx, target);
      }
      return;
    }
    case "PARALLEL_JOIN": {
      // V1 simple counter: track join arrival count in metadata.
      const arrivalsKey = `joinArrivals.${node.id}`;
      const arrivals = (instance.metadata[arrivalsKey] as number | undefined) || 0;
      const incomingCount = version.edges.filter(
        (e) => e.targetNodeId === node.id,
      ).length;
      const next = arrivals + 1;
      instance.metadata = setPath(instance.metadata, arrivalsKey, next);
      await updateInstance(instance);
      if (next >= incomingCount) {
        // All arrived → forward.
        const targets = pickActivatableTargets(version, node, instance.context);
        for (const target of targets) {
          await activateNode(ctx, target);
        }
      }
      return;
    }
    case "CALL_WORKFLOW": {
      // V1: spawn child instance pinned to the called template's current
      // version. Parent does not auto-resume on child completion in V1
      // (manual /advance required). Future: link child→parent via metadata.
      console.warn(
        `[business-workflow] CALL_WORKFLOW spawn skipped in V1 for node ${node.id}.`,
      );
      if (!instance.activeNodeIds.includes(node.id)) {
        instance.activeNodeIds = [...instance.activeNodeIds, node.id];
        await updateInstance(instance);
      }
      return;
    }
    default: {
      // Unrecognized → leave node active so it doesn't get lost.
      if (!instance.activeNodeIds.includes(node.id)) {
        instance.activeNodeIds = [...instance.activeNodeIds, node.id];
        await updateInstance(instance);
      }
      return;
    }
  }
};

const pickActivatableTargets = (
  version: BusinessWorkflowVersion,
  fromNode: BusinessNode,
  context: Record<string, unknown>,
): BusinessNode[] => {
  const outgoing = version.edges.filter((e) => e.sourceNodeId === fromNode.id);
  const matched: BusinessNode[] = [];
  for (const edge of outgoing) {
    if (!evaluateEdgeCondition(edge.condition || null, context)) continue;
    const target = version.nodes.find((n) => n.id === edge.targetNodeId);
    if (target) matched.push(target);
  }
  return matched;
};

// ── Public runtime API ──────────────────────────────────────────────────────

const loadCustomNodeBaseTypeMap = async (
  capabilityId: string,
): Promise<Map<string, BusinessNodeBaseType>> => {
  const result = await query(
    `SELECT name, base_type FROM capability_business_workflow_custom_node_types WHERE capability_id = $1`,
    [capabilityId],
  );
  const map = new Map<string, BusinessNodeBaseType>();
  for (const row of result.rows) {
    map.set(String((row as Record<string, unknown>).name), String((row as Record<string, unknown>).base_type) as BusinessNodeBaseType);
  }
  return map;
};

export const startBusinessInstance = async ({
  capabilityId,
  templateId,
  startedBy,
  contextOverrides,
}: {
  capabilityId: string;
  templateId: string;
  startedBy: string;
  contextOverrides?: Record<string, unknown>;
}): Promise<BusinessWorkflowInstance> => {
  const tpl = await fetchBusinessTemplate(capabilityId, templateId);
  if (!tpl) throw new Error(`Template ${templateId} not found.`);
  if (tpl.currentVersion === 0) {
    throw new Error(`Template ${templateId} has no published version yet.`);
  }
  const version = await fetchTemplateVersion(
    capabilityId,
    templateId,
    tpl.currentVersion,
  );
  if (!version) throw new Error("Pinned version row missing.");

  const startNode = version.nodes.find((n) => n.type === "START");
  if (!startNode) throw new Error("Template has no START node.");

  const instanceId = createId("BWI");
  await query(
    `
    INSERT INTO capability_business_workflow_instances
      (capability_id, id, template_id, template_version, status, context, active_node_ids, started_by)
    VALUES ($1, $2, $3, $4, 'RUNNING', $5::jsonb, '[]'::jsonb, $6)
    `,
    [
      capabilityId,
      instanceId,
      templateId,
      tpl.currentVersion,
      JSON.stringify(contextOverrides || {}),
      startedBy,
    ],
  );

  const instance = (await fetchInstance(capabilityId, instanceId))!;
  await emitEvent({
    capabilityId,
    instanceId,
    eventType: "INSTANCE_STARTED",
    payload: { templateId, templateVersion: tpl.currentVersion },
    actorId: startedBy,
  });

  const customBaseTypes = await loadCustomNodeBaseTypeMap(capabilityId);
  await activateNode(
    { instance, version, customBaseTypes, actorId: startedBy },
    startNode,
  );

  return (await fetchInstance(capabilityId, instanceId))!;
};

export const cancelBusinessInstance = async ({
  capabilityId,
  instanceId,
  actorId,
  reason,
}: {
  capabilityId: string;
  instanceId: string;
  actorId: string;
  reason?: string;
}): Promise<BusinessWorkflowInstance | null> => {
  const instance = await fetchInstance(capabilityId, instanceId);
  if (!instance) return null;
  if (instance.status === "COMPLETED" || instance.status === "CANCELLED") {
    return instance;
  }
  // Cascade in a single transaction so we never leave orphan OPEN tasks
  // or PENDING approvals visible to the inbox after cancel.
  await transaction(async (client) => {
    await client.query(
      `UPDATE capability_business_workflow_instances
       SET status = 'CANCELLED', completed_at = NOW()
       WHERE capability_id = $1 AND id = $2`,
      [capabilityId, instanceId],
    );
    await client.query(
      `UPDATE capability_business_tasks
       SET status = 'CANCELLED', completed_at = NOW()
       WHERE capability_id = $1 AND instance_id = $2
         AND status IN ('OPEN','CLAIMED','IN_PROGRESS')`,
      [capabilityId, instanceId],
    );
    await client.query(
      `UPDATE capability_business_approvals
       SET status = 'REJECTED', decided_by = $3, decided_at = NOW(),
           notes = COALESCE(notes, '') || E'\n[cancelled with instance]'
       WHERE capability_id = $1 AND instance_id = $2 AND status = 'PENDING'`,
      [capabilityId, instanceId, actorId],
    );
  });
  await emitEvent({
    capabilityId,
    instanceId,
    eventType: "INSTANCE_CANCELLED",
    actorId,
    payload: reason ? { reason } : undefined,
  });
  return (await fetchInstance(capabilityId, instanceId)) || null;
};

// ── Pause guard ──────────────────────────────────────────────────────────────

/**
 * Throw a typed error when the instance is paused. The route layer
 * maps the message → HTTP 409 via the regex in `server/api/errors.ts`
 * (the word "already" matches the conflict pattern).
 *
 * Reassign + ad-hoc are allowed while paused (the operator pauses TO
 * fix things), so this is only called from claim / complete / decide /
 * advance.
 */
const assertInstanceNotPaused = async (
  capabilityId: string,
  instanceId: string,
): Promise<void> => {
  const inst = await fetchInstance(capabilityId, instanceId);
  if (inst && inst.status === "PAUSED") {
    throw new Error(
      `Instance ${instanceId} is paused — already paused, resume it before continuing.`,
    );
  }
};

// ── Tasks ────────────────────────────────────────────────────────────────────

export const listBusinessTasks = async ({
  capabilityId,
  status,
  limit = 100,
}: {
  capabilityId: string;
  status?: TaskStatus | "OPEN_OR_CLAIMED";
  limit?: number;
}): Promise<BusinessTask[]> => {
  const params: unknown[] = [capabilityId];
  let where = "WHERE capability_id = $1";
  if (status === "OPEN_OR_CLAIMED") {
    where += ` AND status IN ('OPEN', 'CLAIMED', 'IN_PROGRESS')`;
  } else if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  params.push(Math.max(1, Math.min(500, limit)));
  const result = await query(
    `
    SELECT * FROM capability_business_tasks
    ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length}
    `,
    params,
  );
  return result.rows.map((row) => rowToTask(row as Record<string, unknown>));
};

export const claimBusinessTask = async ({
  capabilityId,
  taskId,
  claimedBy,
}: {
  capabilityId: string;
  taskId: string;
  claimedBy: string;
}): Promise<BusinessTask | null> => {
  // Pre-check: refuse to claim against a paused instance.
  const taskRow = await query(
    `SELECT instance_id FROM capability_business_tasks
     WHERE capability_id = $1 AND id = $2`,
    [capabilityId, taskId],
  );
  if (taskRow.rows.length > 0) {
    await assertInstanceNotPaused(
      capabilityId,
      String((taskRow.rows[0] as Record<string, unknown>).instance_id),
    );
  }
  const result = await query(
    `
    UPDATE capability_business_tasks SET
      status = 'CLAIMED',
      claimed_by = $3,
      claimed_at = NOW()
    WHERE capability_id = $1 AND id = $2 AND status = 'OPEN'
    RETURNING *
    `,
    [capabilityId, taskId, claimedBy],
  );
  if (result.rows.length === 0) return null;
  const task = rowToTask(result.rows[0] as Record<string, unknown>);
  await emitEvent({
    capabilityId,
    instanceId: task.instanceId,
    nodeId: task.nodeId,
    eventType: "TASK_CLAIMED",
    actorId: claimedBy,
  });
  return task;
};

export const completeBusinessTask = async ({
  capabilityId,
  taskId,
  completedBy,
  formData,
  output,
}: {
  capabilityId: string;
  taskId: string;
  completedBy: string;
  formData?: Record<string, unknown>;
  output?: Record<string, unknown>;
}): Promise<BusinessTask | null> => {
  // Pause guard: reject completion attempts on a paused instance so
  // the operator can't accidentally race past their own pause.
  const taskRow = await query(
    `SELECT instance_id, is_ad_hoc, ad_hoc_blocking
     FROM capability_business_tasks
     WHERE capability_id = $1 AND id = $2`,
    [capabilityId, taskId],
  );
  if (taskRow.rows.length > 0) {
    const r = taskRow.rows[0] as Record<string, unknown>;
    // Allow completion of a blocking-ad-hoc task even when paused —
    // that's how the instance auto-resumes (handled at end of fn).
    if (!(r.is_ad_hoc === true && r.ad_hoc_blocking === true)) {
      await assertInstanceNotPaused(capabilityId, String(r.instance_id));
    }
  }
  const result = await query(
    `
    UPDATE capability_business_tasks SET
      status        = 'COMPLETED',
      form_data     = COALESCE($3::jsonb, form_data),
      output        = COALESCE($4::jsonb, output),
      completed_at  = NOW()
    WHERE capability_id = $1 AND id = $2 AND status IN ('OPEN', 'CLAIMED', 'IN_PROGRESS')
    RETURNING *
    `,
    [
      capabilityId,
      taskId,
      formData ? JSON.stringify(formData) : null,
      output ? JSON.stringify(output) : null,
    ],
  );
  if (result.rows.length === 0) return null;
  const task = rowToTask(result.rows[0] as Record<string, unknown>);
  await emitEvent({
    capabilityId,
    instanceId: task.instanceId,
    nodeId: task.nodeId,
    eventType: "TASK_COMPLETED",
    actorId: completedBy,
    payload: { formData, output, isAdHoc: task.isAdHoc },
  });

  if (task.isAdHoc) {
    // Ad-hoc tasks don't advance the planned graph — they're a
    // side-channel. If this was a BLOCKING ad-hoc, auto-resume the
    // instance now that the operator's done with the side errand.
    if (task.adHocBlocking) {
      try {
        await resumeBusinessInstance({
          capabilityId,
          instanceId: task.instanceId,
          actorId: completedBy,
        });
      } catch {
        // Resume can race with cancel — swallow; the task is still
        // recorded as completed and the timeline will show both.
      }
    }
    return task;
  }

  // Planned task: advance the workflow.
  await advanceFromCompletedNode({
    capabilityId,
    instanceId: task.instanceId,
    completedNodeId: task.nodeId,
    output: output || formData || {},
    actorId: completedBy,
  });

  return task;
};

// ── Approvals ────────────────────────────────────────────────────────────────

export const decideBusinessApproval = async ({
  capabilityId,
  approvalId,
  decidedBy,
  decision,
  conditions,
  notes,
}: {
  capabilityId: string;
  approvalId: string;
  decidedBy: string;
  decision: ApprovalStatus;
  conditions?: string;
  notes?: string;
}): Promise<BusinessApproval | null> => {
  // Pause guard.
  const apRow = await query(
    `SELECT instance_id FROM capability_business_approvals
     WHERE capability_id = $1 AND id = $2`,
    [capabilityId, approvalId],
  );
  if (apRow.rows.length > 0) {
    await assertInstanceNotPaused(
      capabilityId,
      String((apRow.rows[0] as Record<string, unknown>).instance_id),
    );
  }
  const result = await query(
    `
    UPDATE capability_business_approvals SET
      status      = $3,
      decision    = $3,
      decided_by  = $4,
      decided_at  = NOW(),
      conditions  = $5,
      notes       = $6
    WHERE capability_id = $1 AND id = $2 AND status = 'PENDING'
    RETURNING *
    `,
    [
      capabilityId,
      approvalId,
      decision,
      decidedBy,
      conditions || null,
      notes || null,
    ],
  );
  if (result.rows.length === 0) return null;
  const approval = rowToApproval(result.rows[0] as Record<string, unknown>);
  await emitEvent({
    capabilityId,
    instanceId: approval.instanceId,
    nodeId: approval.nodeId,
    eventType: "APPROVAL_DECIDED",
    actorId: decidedBy,
    payload: { decision, conditions, notes },
  });

  // Only advance on terminal decisions; intermediate ones (NEEDS_MORE_INFORMATION,
  // DEFERRED, ESCALATED) leave the workflow paused.
  if (
    decision === "APPROVED" ||
    decision === "APPROVED_WITH_CONDITIONS" ||
    decision === "REJECTED"
  ) {
    await advanceFromCompletedNode({
      capabilityId,
      instanceId: approval.instanceId,
      completedNodeId: approval.nodeId,
      output: { decision, conditions, notes },
      actorId: decidedBy,
    });
  }

  return approval;
};

export const fetchBusinessApproval = async (
  capabilityId: string,
  approvalId: string,
): Promise<BusinessApproval | null> => {
  const result = await query(
    `SELECT * FROM capability_business_approvals WHERE capability_id = $1 AND id = $2`,
    [capabilityId, approvalId],
  );
  if (result.rows.length === 0) return null;
  return rowToApproval(result.rows[0] as Record<string, unknown>);
};

// ── Advance ──────────────────────────────────────────────────────────────────

const advanceFromCompletedNode = async ({
  capabilityId,
  instanceId,
  completedNodeId,
  output,
  actorId,
}: {
  capabilityId: string;
  instanceId: string;
  completedNodeId: string;
  output: Record<string, unknown>;
  actorId?: string;
}): Promise<void> => {
  const instance = await fetchInstance(capabilityId, instanceId);
  if (!instance || instance.status !== "RUNNING") return;
  const version = await fetchTemplateVersion(
    capabilityId,
    instance.templateId,
    instance.templateVersion,
  );
  if (!version) return;
  const node = version.nodes.find((n) => n.id === completedNodeId);
  if (!node) return;

  await emitEvent({
    capabilityId,
    instanceId,
    nodeId: completedNodeId,
    eventType: "NODE_COMPLETED",
    actorId,
  });

  // Apply output bindings to context.
  instance.context = applyOutputBindings(instance.context, node, output);
  // Remove from active.
  instance.activeNodeIds = instance.activeNodeIds.filter(
    (id) => id !== completedNodeId,
  );
  await updateInstance(instance);

  // Activate downstream nodes.
  const customBaseTypes = await loadCustomNodeBaseTypeMap(capabilityId);
  const targets = pickActivatableTargets(version, node, instance.context);
  for (const target of targets) {
    await activateNode(
      {
        instance: (await fetchInstance(capabilityId, instanceId))!,
        version,
        customBaseTypes,
        actorId,
      },
      target,
    );
  }
};

// ── Custom node types ────────────────────────────────────────────────────────

import type { BusinessCustomNodeType } from "../src/contracts/businessWorkflow";

const rowToCustomType = (
  row: Record<string, unknown>,
): BusinessCustomNodeType => ({
  capabilityId: String(row.capability_id),
  id: String(row.id),
  name: String(row.name),
  baseType: String(row.base_type) as BusinessCustomNodeType["baseType"],
  label: String(row.label),
  description: row.description ? String(row.description) : undefined,
  color: row.color ? String(row.color) : undefined,
  icon: row.icon ? String(row.icon) : undefined,
  fields: asJsonArray<BusinessCustomNodeType["fields"][number]>(row.fields),
  // Default true so old rows (created before is_active existed) stay visible.
  isActive: row.is_active === false ? false : true,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
});

export const listBusinessCustomNodeTypes = async (
  capabilityId: string,
  options: { includeInactive?: boolean } = {},
): Promise<BusinessCustomNodeType[]> => {
  const result = await query(
    options.includeInactive
      ? `SELECT * FROM capability_business_workflow_custom_node_types
         WHERE capability_id = $1
         ORDER BY label ASC`
      : `SELECT * FROM capability_business_workflow_custom_node_types
         WHERE capability_id = $1 AND is_active = TRUE
         ORDER BY label ASC`,
    [capabilityId],
  );
  return result.rows.map((row) =>
    rowToCustomType(row as Record<string, unknown>),
  );
};

export const upsertBusinessCustomNodeType = async ({
  capabilityId,
  id,
  name,
  baseType,
  label,
  description,
  color,
  icon,
  fields,
  isActive,
}: Omit<BusinessCustomNodeType, "createdAt" | "updatedAt" | "isActive"> & {
  id?: string;
  isActive?: boolean;
}): Promise<BusinessCustomNodeType> => {
  const ensuredId = id || createId("BCNT");
  const result = await query(
    `
    INSERT INTO capability_business_workflow_custom_node_types
      (capability_id, id, name, base_type, label, description, color, icon, fields, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
    ON CONFLICT (capability_id, id) DO UPDATE SET
      name        = EXCLUDED.name,
      base_type   = EXCLUDED.base_type,
      label       = EXCLUDED.label,
      description = EXCLUDED.description,
      color       = EXCLUDED.color,
      icon        = EXCLUDED.icon,
      fields      = EXCLUDED.fields,
      is_active   = EXCLUDED.is_active,
      updated_at  = NOW()
    RETURNING *
    `,
    [
      capabilityId,
      ensuredId,
      name,
      baseType,
      label,
      description || null,
      color || null,
      icon || null,
      JSON.stringify(fields || []),
      isActive === false ? false : true,
    ],
  );
  return rowToCustomType(result.rows[0] as Record<string, unknown>);
};

export const deleteBusinessCustomNodeType = async (
  capabilityId: string,
  id: string,
): Promise<void> => {
  await query(
    `DELETE FROM capability_business_workflow_custom_node_types
     WHERE capability_id = $1 AND id = $2`,
    [capabilityId, id],
  );
};

// ── Events read ──────────────────────────────────────────────────────────────

export const listBusinessInstanceEvents = async (
  capabilityId: string,
  instanceId: string,
  options: { sinceEventId?: string } = {},
): Promise<BusinessWorkflowEvent[]> => {
  // `sinceEventId` is the last event id the dashboard already has —
  // we filter on (occurred_at, id) > the matching row so polling
  // returns deltas only and the typical payload is empty.
  const params: unknown[] = [capabilityId, instanceId];
  let extra = "";
  if (options.sinceEventId) {
    params.push(options.sinceEventId);
    extra = `
      AND (occurred_at, id) > (
        SELECT occurred_at, id FROM capability_business_workflow_events
        WHERE id = $${params.length}
      )
    `;
  }
  const result = await query(
    `
    SELECT * FROM capability_business_workflow_events
    WHERE capability_id = $1 AND instance_id = $2
    ${extra}
    ORDER BY occurred_at ASC, id ASC
    `,
    params,
  );
  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      capabilityId: String(r.capability_id),
      instanceId: String(r.instance_id),
      nodeId: r.node_id ? String(r.node_id) : undefined,
      eventType: String(r.event_type) as BusinessWorkflowEventType,
      payload: asJsonObject<Record<string, unknown>>(r.payload),
      actorId: r.actor_id ? String(r.actor_id) : undefined,
      occurredAt: asIso(r.occurred_at),
    };
  });
};

// ════════════════════════════════════════════════════════════════════════════
// V2 runtime — reassign, send-back, ad-hoc, pause/resume, notes, listings
// ════════════════════════════════════════════════════════════════════════════

// ── List instances + approvals ───────────────────────────────────────────────

export const listBusinessInstances = async ({
  capabilityId,
  templateId,
  status,
  startedAfter,
  startedBefore,
  limit = 50,
  offset = 0,
}: {
  capabilityId: string;
  templateId?: string;
  /** "ACTIVE" is shorthand for RUNNING|PAUSED. */
  status?: BusinessInstanceStatus | "ACTIVE";
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: BusinessWorkflowInstance[]; total: number }> => {
  const params: unknown[] = [capabilityId];
  let where = "WHERE capability_id = $1";
  if (templateId) {
    params.push(templateId);
    where += ` AND template_id = $${params.length}`;
  }
  if (status === "ACTIVE") {
    where += ` AND status IN ('RUNNING','PAUSED')`;
  } else if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  if (startedAfter) {
    params.push(startedAfter);
    where += ` AND started_at >= $${params.length}`;
  }
  if (startedBefore) {
    params.push(startedBefore);
    where += ` AND started_at <= $${params.length}`;
  }
  // Page + count in two queries — could be a single SELECT … OVER ()
  // but the row counts are bounded enough that this stays cheap.
  const totalResult = await query(
    `SELECT COUNT(*)::int AS total FROM capability_business_workflow_instances ${where}`,
    params,
  );
  const total = Number((totalResult.rows[0] as { total: number })?.total || 0);
  params.push(Math.max(1, Math.min(500, limit)));
  params.push(Math.max(0, offset));
  const rowsResult = await query(
    `
    SELECT * FROM capability_business_workflow_instances
    ${where}
    ORDER BY started_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );
  return {
    rows: rowsResult.rows.map((row) =>
      rowToInstance(row as Record<string, unknown>),
    ),
    total,
  };
};

export const listBusinessApprovals = async ({
  capabilityId,
  status,
  limit = 100,
}: {
  capabilityId: string;
  /** "PENDING_OR_INFO_REQUESTED" is shorthand for PENDING|NEEDS_MORE_INFORMATION. */
  status?: ApprovalStatus | "PENDING_OR_INFO_REQUESTED";
  limit?: number;
}): Promise<BusinessApproval[]> => {
  const params: unknown[] = [capabilityId];
  let where = "WHERE capability_id = $1";
  if (status === "PENDING_OR_INFO_REQUESTED") {
    where += ` AND status IN ('PENDING','NEEDS_MORE_INFORMATION')`;
  } else if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  params.push(Math.max(1, Math.min(500, limit)));
  const result = await query(
    `
    SELECT * FROM capability_business_approvals
    ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length}
    `,
    params,
  );
  return result.rows.map((row) =>
    rowToApproval(row as Record<string, unknown>),
  );
};

// ── Reassign ─────────────────────────────────────────────────────────────────

export const reassignBusinessTask = async ({
  capabilityId,
  taskId,
  actorId,
  assignmentMode,
  assignedUserId,
  assignedTeamId,
  assignedRole,
  assignedSkill,
  reason,
}: {
  capabilityId: string;
  taskId: string;
  actorId: string;
  assignmentMode: AssignmentMode;
  assignedUserId?: string;
  assignedTeamId?: string;
  assignedRole?: string;
  assignedSkill?: string;
  reason?: string;
}): Promise<BusinessTask | null> => {
  // Reassignment is allowed even on a paused instance — that's how
  // the operator unwinds a stuck task. We DO release the existing
  // claim (status flips back to OPEN) so the new assignee starts from
  // a clean slate.
  const result = await query(
    `
    UPDATE capability_business_tasks SET
      assignment_mode  = $3,
      assigned_user_id = $4,
      assigned_team_id = $5,
      assigned_role    = $6,
      assigned_skill   = $7,
      claimed_by       = NULL,
      claimed_at       = NULL,
      status           = CASE WHEN status = 'CLAIMED' THEN 'OPEN' ELSE status END,
      reassigned_at    = NOW(),
      reassigned_by    = $8
    WHERE capability_id = $1 AND id = $2
      AND status IN ('OPEN','CLAIMED','IN_PROGRESS')
    RETURNING *
    `,
    [
      capabilityId,
      taskId,
      assignmentMode,
      assignedUserId || null,
      assignedTeamId || null,
      assignedRole || null,
      assignedSkill || null,
      actorId,
    ],
  );
  if (result.rows.length === 0) return null;
  const task = rowToTask(result.rows[0] as Record<string, unknown>);
  await emitEvent({
    capabilityId,
    instanceId: task.instanceId,
    nodeId: task.nodeId,
    eventType: "TASK_REASSIGNED",
    actorId,
    payload: {
      assignmentMode,
      assignedUserId,
      assignedTeamId,
      assignedRole,
      assignedSkill,
      reason,
    },
  });
  return task;
};

export const reassignBusinessApproval = async ({
  capabilityId,
  approvalId,
  actorId,
  assignedUserId,
  assignedTeamId,
  assignedRole,
  reason,
}: {
  capabilityId: string;
  approvalId: string;
  actorId: string;
  assignedUserId?: string;
  assignedTeamId?: string;
  assignedRole?: string;
  reason?: string;
}): Promise<BusinessApproval | null> => {
  const result = await query(
    `
    UPDATE capability_business_approvals SET
      assigned_user_id = $3,
      assigned_team_id = $4,
      assigned_role    = $5,
      reassigned_at    = NOW(),
      reassigned_by    = $6
    WHERE capability_id = $1 AND id = $2 AND status = 'PENDING'
    RETURNING *
    `,
    [
      capabilityId,
      approvalId,
      assignedUserId || null,
      assignedTeamId || null,
      assignedRole || null,
      actorId,
    ],
  );
  if (result.rows.length === 0) return null;
  const approval = rowToApproval(result.rows[0] as Record<string, unknown>);
  await emitEvent({
    capabilityId,
    instanceId: approval.instanceId,
    nodeId: approval.nodeId,
    eventType: "APPROVAL_REASSIGNED",
    actorId,
    payload: { assignedUserId, assignedTeamId, assignedRole, reason },
  });
  return approval;
};

// ── Send-back ────────────────────────────────────────────────────────────────

/**
 * Bounce a task back to a previous (or any other) node in the pinned
 * template version. The original task row is preserved with
 * `status='SENT_BACK'` so the audit trail keeps the form_data they
 * already entered. A FRESH task is then activated at the target node,
 * inheriting THAT node's formSchema / assignment / SLA — not the
 * source's.
 */
export const sendBackBusinessTask = async ({
  capabilityId,
  taskId,
  targetNodeId,
  actorId,
  reason,
}: {
  capabilityId: string;
  taskId: string;
  targetNodeId: string;
  actorId: string;
  reason: string;
}): Promise<{ closedTask: BusinessTask; activatedNodeId: string } | null> => {
  // Load the task + its instance + the pinned template version. Do
  // this BEFORE the close, so we know we have a valid target node.
  const taskRowResult = await query(
    `SELECT * FROM capability_business_tasks
     WHERE capability_id = $1 AND id = $2`,
    [capabilityId, taskId],
  );
  if (taskRowResult.rows.length === 0) return null;
  const closedTaskBefore = rowToTask(
    taskRowResult.rows[0] as Record<string, unknown>,
  );
  if (closedTaskBefore.status === "COMPLETED" || closedTaskBefore.status === "CANCELLED" || closedTaskBefore.status === "SENT_BACK") {
    throw new Error(`Task ${taskId} is already closed.`);
  }
  const instance = await fetchInstance(
    capabilityId,
    closedTaskBefore.instanceId,
  );
  if (!instance) throw new Error("Instance not found.");
  await assertInstanceNotPaused(capabilityId, instance.id);

  const version = await fetchTemplateVersion(
    capabilityId,
    instance.templateId,
    instance.templateVersion,
  );
  if (!version) throw new Error("Pinned version row missing.");
  const target = version.nodes.find((n) => n.id === targetNodeId);
  if (!target) {
    throw new Error(`Target node ${targetNodeId} is not in this template.`);
  }
  if (target.type === "START" || target.type === "END") {
    throw new Error(`Cannot send back to ${target.type} node.`);
  }

  // Mark original task SENT_BACK (preserved for audit, NOT cancelled).
  const closedResult = await query(
    `
    UPDATE capability_business_tasks SET
      status                  = 'SENT_BACK',
      sent_back_from_node_id  = $3,
      sent_back_reason        = $4,
      completed_at            = NOW()
    WHERE capability_id = $1 AND id = $2
    RETURNING *
    `,
    [capabilityId, taskId, targetNodeId, reason],
  );
  const closedTask = rowToTask(closedResult.rows[0] as Record<string, unknown>);

  // Reset PARALLEL_JOIN counters on any join sitting between target
  // and source — otherwise a join that already counted us would still
  // be holding a stale arrival.
  const joins = findJoinsBetween(
    targetNodeId,
    closedTaskBefore.nodeId,
    version.nodes,
    version.edges,
  );
  if (joins.length > 0) {
    const meta = { ...(instance.metadata || {}) };
    const arrivals = (meta.joinArrivals as Record<string, number>) || {};
    for (const joinId of joins) {
      delete arrivals[joinId];
    }
    meta.joinArrivals = arrivals;
    await query(
      `UPDATE capability_business_workflow_instances
       SET metadata = $3::jsonb, updated_at = NOW()
       WHERE capability_id = $1 AND id = $2`,
      [capabilityId, instance.id, JSON.stringify(meta)],
    );
  }

  // Remove the source node from active and activate the target.
  const refreshedInstance = (await fetchInstance(capabilityId, instance.id))!;
  refreshedInstance.activeNodeIds = refreshedInstance.activeNodeIds.filter(
    (id) => id !== closedTaskBefore.nodeId,
  );
  await updateInstance(refreshedInstance);

  await emitEvent({
    capabilityId,
    instanceId: instance.id,
    nodeId: closedTaskBefore.nodeId,
    eventType: "TASK_SENT_BACK",
    actorId,
    payload: { targetNodeId, reason, taskId },
  });

  const customBaseTypes = await loadCustomNodeBaseTypeMap(capabilityId);
  await activateNode(
    {
      instance: (await fetchInstance(capabilityId, instance.id))!,
      version,
      customBaseTypes,
      actorId,
    },
    target,
  );

  return { closedTask, activatedNodeId: target.id };
};

export const sendBackBusinessApproval = async ({
  capabilityId,
  approvalId,
  targetNodeId,
  actorId,
  reason,
}: {
  capabilityId: string;
  approvalId: string;
  targetNodeId: string;
  actorId: string;
  reason: string;
}): Promise<{ closedApproval: BusinessApproval; activatedNodeId: string } | null> => {
  const approvalRowResult = await query(
    `SELECT * FROM capability_business_approvals
     WHERE capability_id = $1 AND id = $2`,
    [capabilityId, approvalId],
  );
  if (approvalRowResult.rows.length === 0) return null;
  const before = rowToApproval(
    approvalRowResult.rows[0] as Record<string, unknown>,
  );
  if (before.status !== "PENDING") {
    throw new Error(`Approval ${approvalId} is no longer pending.`);
  }
  const instance = await fetchInstance(capabilityId, before.instanceId);
  if (!instance) throw new Error("Instance not found.");
  await assertInstanceNotPaused(capabilityId, instance.id);
  const version = await fetchTemplateVersion(
    capabilityId,
    instance.templateId,
    instance.templateVersion,
  );
  if (!version) throw new Error("Pinned version row missing.");
  const target = version.nodes.find((n) => n.id === targetNodeId);
  if (!target) throw new Error(`Target node ${targetNodeId} not in template.`);
  if (target.type === "START" || target.type === "END") {
    throw new Error(`Cannot send back to ${target.type} node.`);
  }

  const closedResult = await query(
    `
    UPDATE capability_business_approvals SET
      status                  = 'NEEDS_MORE_INFORMATION',
      sent_back_from_node_id  = $3,
      sent_back_reason        = $4,
      decided_by              = $5,
      decided_at              = NOW(),
      notes                   = COALESCE(notes, '') || E'\n[sent back]'
    WHERE capability_id = $1 AND id = $2
    RETURNING *
    `,
    [capabilityId, approvalId, targetNodeId, reason, actorId],
  );
  const closedApproval = rowToApproval(
    closedResult.rows[0] as Record<string, unknown>,
  );

  // Same active-set + join-counter cleanup as task send-back.
  const joins = findJoinsBetween(
    targetNodeId,
    before.nodeId,
    version.nodes,
    version.edges,
  );
  if (joins.length > 0) {
    const meta = { ...(instance.metadata || {}) };
    const arrivals = (meta.joinArrivals as Record<string, number>) || {};
    for (const joinId of joins) delete arrivals[joinId];
    meta.joinArrivals = arrivals;
    await query(
      `UPDATE capability_business_workflow_instances
       SET metadata = $3::jsonb, updated_at = NOW()
       WHERE capability_id = $1 AND id = $2`,
      [capabilityId, instance.id, JSON.stringify(meta)],
    );
  }

  const refreshed = (await fetchInstance(capabilityId, instance.id))!;
  refreshed.activeNodeIds = refreshed.activeNodeIds.filter(
    (id) => id !== before.nodeId,
  );
  await updateInstance(refreshed);

  await emitEvent({
    capabilityId,
    instanceId: instance.id,
    nodeId: before.nodeId,
    eventType: "APPROVAL_SENT_BACK",
    actorId,
    payload: { targetNodeId, reason, approvalId },
  });

  const customBaseTypes = await loadCustomNodeBaseTypeMap(capabilityId);
  await activateNode(
    {
      instance: (await fetchInstance(capabilityId, instance.id))!,
      version,
      customBaseTypes,
      actorId,
    },
    target,
  );

  return { closedApproval, activatedNodeId: target.id };
};

// ── Ad-hoc tasks ─────────────────────────────────────────────────────────────

export const createAdHocTask = async ({
  capabilityId,
  instanceId,
  actorId,
  title,
  description,
  assignment,
  priority,
  dueAt,
  formSchema,
  blocking,
  parentTaskId,
}: {
  capabilityId: string;
  instanceId: string;
  actorId: string;
  title: string;
  description?: string;
  assignment: {
    mode: AssignmentMode;
    userId?: string;
    teamId?: string;
    role?: string;
    skill?: string;
  };
  priority?: TaskPriority;
  dueAt?: string;
  formSchema?: FormSchema | null;
  blocking?: boolean;
  parentTaskId?: string;
}): Promise<BusinessTask> => {
  const instance = await fetchInstance(capabilityId, instanceId);
  if (!instance) throw new Error(`Instance ${instanceId} not found.`);
  if (
    instance.status === "COMPLETED" ||
    instance.status === "CANCELLED" ||
    instance.status === "FAILED"
  ) {
    throw new Error(`Instance ${instanceId} is ${instance.status}.`);
  }
  const id = createId("BTASK");
  // Synthetic node_id so the canvas — which keys off pinned version
  // node ids — never tries to render an ad-hoc task as a graph node.
  const syntheticNodeId = `adhoc-${id.toLowerCase()}`;
  const result = await query(
    `
    INSERT INTO capability_business_tasks
      (capability_id, id, instance_id, node_id, title, description, status,
       assignment_mode, assigned_user_id, assigned_team_id, assigned_role,
       assigned_skill, due_at, priority, form_schema,
       is_ad_hoc, ad_hoc_blocking, parent_task_id, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, 'OPEN',
            $7, $8, $9, $10, $11, $12, $13, $14::jsonb,
            TRUE, $15, $16, $17)
    RETURNING *
    `,
    [
      capabilityId,
      id,
      instanceId,
      syntheticNodeId,
      title,
      description || null,
      assignment.mode,
      assignment.userId || null,
      assignment.teamId || null,
      assignment.role || null,
      assignment.skill || null,
      dueAt || null,
      priority || "NORMAL",
      formSchema ? JSON.stringify(formSchema) : null,
      blocking === true,
      parentTaskId || null,
      actorId,
    ],
  );
  const task = rowToTask(result.rows[0] as Record<string, unknown>);
  await emitEvent({
    capabilityId,
    instanceId,
    nodeId: syntheticNodeId,
    eventType: "AD_HOC_TASK_CREATED",
    actorId,
    payload: { taskId: id, title, blocking: blocking === true, parentTaskId },
  });
  if (blocking) {
    // Auto-pause the planned graph until the operator finishes the
    // side errand. resumeBusinessInstance is called from
    // completeBusinessTask when this ad-hoc closes.
    try {
      await pauseBusinessInstance({
        capabilityId,
        instanceId,
        actorId,
        reason: `Blocking ad-hoc task: ${title}`,
      });
    } catch {
      // Already paused or something else — that's fine, the ad-hoc
      // still got created and event-logged.
    }
  }
  return task;
};

// ── Pause / Resume ───────────────────────────────────────────────────────────

export const pauseBusinessInstance = async ({
  capabilityId,
  instanceId,
  actorId,
  reason,
}: {
  capabilityId: string;
  instanceId: string;
  actorId: string;
  reason?: string;
}): Promise<BusinessWorkflowInstance | null> => {
  // Pause is only valid from RUNNING. Pausing a paused/completed/
  // cancelled instance is a no-op so the caller doesn't have to know.
  const result = await query(
    `
    UPDATE capability_business_workflow_instances SET
      status        = 'PAUSED',
      paused_at     = NOW(),
      paused_by     = $3,
      paused_reason = $4
    WHERE capability_id = $1 AND id = $2 AND status = 'RUNNING'
    RETURNING *
    `,
    [capabilityId, instanceId, actorId, reason || null],
  );
  if (result.rows.length === 0) {
    // Not RUNNING — return current state so the UI can reflect it.
    return fetchInstance(capabilityId, instanceId);
  }
  const inst = rowToInstance(result.rows[0] as Record<string, unknown>);
  await emitEvent({
    capabilityId,
    instanceId,
    eventType: "INSTANCE_PAUSED",
    actorId,
    payload: reason ? { reason } : undefined,
  });
  return inst;
};

export const resumeBusinessInstance = async ({
  capabilityId,
  instanceId,
  actorId,
}: {
  capabilityId: string;
  instanceId: string;
  actorId: string;
}): Promise<BusinessWorkflowInstance | null> => {
  const result = await query(
    `
    UPDATE capability_business_workflow_instances SET
      status        = 'RUNNING',
      paused_at     = NULL,
      paused_by     = NULL,
      paused_reason = NULL
    WHERE capability_id = $1 AND id = $2 AND status = 'PAUSED'
    RETURNING *
    `,
    [capabilityId, instanceId],
  );
  if (result.rows.length === 0) {
    return fetchInstance(capabilityId, instanceId);
  }
  const inst = rowToInstance(result.rows[0] as Record<string, unknown>);
  await emitEvent({
    capabilityId,
    instanceId,
    eventType: "INSTANCE_RESUMED",
    actorId,
  });
  return inst;
};

// ── Notes ────────────────────────────────────────────────────────────────────

/**
 * Notes live in the events table — no separate notes table. A note is
 * just an INSTANCE_NOTE_ADDED event with `payload.body`. The
 * NotesPanel filters the timeline for these.
 */
export const addInstanceNote = async ({
  capabilityId,
  instanceId,
  actorId,
  note,
  taskId,
  approvalId,
}: {
  capabilityId: string;
  instanceId: string;
  actorId: string;
  note: string;
  taskId?: string;
  approvalId?: string;
}): Promise<BusinessWorkflowEvent> => {
  const inst = await fetchInstance(capabilityId, instanceId);
  if (!inst) throw new Error(`Instance ${instanceId} not found.`);
  return emitEvent({
    capabilityId,
    instanceId,
    eventType: "INSTANCE_NOTE_ADDED",
    actorId,
    payload: { body: note, taskId, approvalId },
  });
};

// ── Aggregate stats for status report ────────────────────────────────────────

export const aggregateBusinessTemplateStats = async ({
  capabilityId,
  templateId,
}: {
  capabilityId: string;
  templateId: string;
}): Promise<{
  byStatus: Record<BusinessInstanceStatus, number>;
  avgDurationMs: number | null;
  overdueTaskCount: number;
  pendingApprovalCount: number;
  recentInstances: BusinessWorkflowInstance[];
}> => {
  // Counts by instance status
  const statusResult = await query(
    `
    SELECT status, COUNT(*)::int AS n
    FROM capability_business_workflow_instances
    WHERE capability_id = $1 AND template_id = $2
    GROUP BY status
    `,
    [capabilityId, templateId],
  );
  const byStatus: Record<BusinessInstanceStatus, number> = {
    RUNNING: 0,
    PAUSED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    FAILED: 0,
  };
  for (const row of statusResult.rows) {
    const r = row as { status: string; n: number };
    if (r.status in byStatus) {
      byStatus[r.status as BusinessInstanceStatus] = Number(r.n);
    }
  }
  // Average duration over completed instances
  const avgResult = await query(
    `
    SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::float8 AS avg_ms
    FROM capability_business_workflow_instances
    WHERE capability_id = $1 AND template_id = $2 AND status = 'COMPLETED'
    `,
    [capabilityId, templateId],
  );
  const avgDurationMs = (avgResult.rows[0] as { avg_ms: number | null })
    ?.avg_ms;
  // Overdue tasks across this template's instances
  const overdueResult = await query(
    `
    SELECT COUNT(*)::int AS n
    FROM capability_business_tasks t
    JOIN capability_business_workflow_instances i
      ON i.capability_id = t.capability_id AND i.id = t.instance_id
    WHERE t.capability_id = $1 AND i.template_id = $2
      AND t.status IN ('OPEN','CLAIMED','IN_PROGRESS')
      AND t.due_at IS NOT NULL AND t.due_at < NOW()
    `,
    [capabilityId, templateId],
  );
  const overdueTaskCount = Number(
    (overdueResult.rows[0] as { n: number })?.n || 0,
  );
  // Pending approvals
  const pendingResult = await query(
    `
    SELECT COUNT(*)::int AS n
    FROM capability_business_approvals a
    JOIN capability_business_workflow_instances i
      ON i.capability_id = a.capability_id AND i.id = a.instance_id
    WHERE a.capability_id = $1 AND i.template_id = $2
      AND a.status = 'PENDING'
    `,
    [capabilityId, templateId],
  );
  const pendingApprovalCount = Number(
    (pendingResult.rows[0] as { n: number })?.n || 0,
  );
  // Recent instances (top 10) for the dashboard table
  const recentResult = await query(
    `
    SELECT * FROM capability_business_workflow_instances
    WHERE capability_id = $1 AND template_id = $2
    ORDER BY started_at DESC
    LIMIT 10
    `,
    [capabilityId, templateId],
  );
  const recentInstances = recentResult.rows.map((row) =>
    rowToInstance(row as Record<string, unknown>),
  );
  return {
    byStatus,
    avgDurationMs:
      avgDurationMs == null ? null : Number(avgDurationMs),
    overdueTaskCount,
    pendingApprovalCount,
    recentInstances,
  };
};
