/**
 * Business Workflow contracts.
 *
 * The Business Workflow Designer is a NEW workflow surface, distinct
 * from the existing agent-driven `Workflow` / `WorkflowStep` types in
 * `src/types.ts`. It exists to model human-driven business processes
 * (approval chains, expense reviews, contract sign-offs, onboarding,
 * etc.) — but supports hybrid steps that delegate to existing
 * capability agents.
 *
 * NOTHING here aliases or extends the existing agent-workflow types.
 * Names are deliberately distinct (`BusinessWorkflow*`) so the two
 * systems coexist without collision.
 */

// ── Node taxonomy ────────────────────────────────────────────────────────────

export type BusinessNodeBaseType =
  // Boundary
  | "START"
  | "END"
  // Human work
  | "HUMAN_TASK"
  | "APPROVAL"
  | "FORM_FILL"
  // Control flow
  | "DECISION_GATE"
  | "PARALLEL_FORK"
  | "PARALLEL_JOIN"
  // Async / timing
  | "TIMER"
  | "NOTIFICATION"
  // Integration
  | "AGENT_TASK" // delegates to an existing capability agent
  | "TOOL_REQUEST"
  | "CALL_WORKFLOW";

/**
 * A node may either be one of the built-in base types above, or a
 * custom-defined node-type wrapping a base type (e.g. "Marketing Review"
 * → HUMAN_TASK). Custom node types live in
 * `capability_business_workflow_custom_node_types`.
 */
export type BusinessNodeType = BusinessNodeBaseType | string;

// ── Assignment / approval ────────────────────────────────────────────────────

export type AssignmentMode =
  | "DIRECT_USER"
  | "TEAM_QUEUE"
  | "ROLE_BASED"
  | "SKILL_BASED"
  | "AGENT";

export interface AssignmentTarget {
  mode: AssignmentMode;
  userId?: string;
  teamId?: string;
  role?: string;
  skill?: string;
  /** For mode=AGENT: the existing capability agent id to delegate to. */
  agentId?: string;
}

export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "APPROVED_WITH_CONDITIONS"
  | "NEEDS_MORE_INFORMATION"
  | "DEFERRED"
  | "ESCALATED";

export type TaskStatus =
  | "OPEN"
  | "CLAIMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

// ── Edge condition language ──────────────────────────────────────────────────

export type ConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "contains"
  | "exists";

export interface ConditionClause {
  /**
   * Dotted path into instance.context (e.g. `"results.score"`,
   * `"params.tier"`). The evaluator resolves it before applying `op`.
   */
  left: string;
  op: ConditionOperator;
  /**
   * Literal compared against the resolved `left`. For `in`, comma-
   * separated values. Ignored for `exists`.
   */
  right?: string | number | boolean | null;
}

export interface ConditionGroup {
  logic: "AND" | "OR";
  clauses: Array<ConditionClause | ConditionGroup>;
}

/**
 * `null` means "always true" (default edge taken when no other
 * conditional edge matches). Ordinary edges off non-DECISION_GATE nodes
 * leave this null.
 */
export type EdgeCondition = ConditionGroup | null;

// ── Form schema (JSON Schema subset for v1) ──────────────────────────────────

/**
 * V1 stores the JSON Schema string verbatim — UI is a textarea. Future
 * versions can add a drag-drop builder.
 */
export type FormSchema = Record<string, unknown> | null;

// ── Output bindings ──────────────────────────────────────────────────────────

/**
 * After a node completes, its `output` is mapped into the instance's
 * shared `context` object via these bindings. Each binding is
 * `{ name, contextPath }`: the key in `output` and the dotted path into
 * `context` to set.
 */
export interface OutputBinding {
  name: string;
  contextPath: string;
}

// ── Node config (per-base-type fields are loose by design — JSONB) ───────────

export interface BusinessNodeConfig {
  description?: string;
  // HUMAN_TASK / APPROVAL / FORM_FILL
  assignment?: AssignmentTarget;
  formSchema?: FormSchema;
  /** SLA in minutes. Future timer/escalation watcher uses this. */
  slaMinutes?: number;
  priority?: TaskPriority;

  // APPROVAL-only — which outcome statuses are selectable on the
  // decision form.
  allowedDecisionStatuses?: ApprovalStatus[];

  // AGENT_TASK — picks a specific capability agent.
  agentId?: string;
  agentPromptTemplate?: string;

  // TOOL_REQUEST — references an existing tool.
  toolId?: string;

  // CALL_WORKFLOW — references another business workflow template.
  childTemplateId?: string;

  // DECISION_GATE — defaultEdgeId is taken if no conditional edge matches.
  defaultEdgeId?: string;

  // TIMER — duration in minutes from activation.
  timerMinutes?: number;

  // NOTIFICATION
  notificationChannel?: "EMAIL" | "WEBHOOK" | "IN_APP";
  notificationRecipients?: string[];

  // Output bindings — applied after the node completes.
  outputBindings?: OutputBinding[];

  // Free-form K/V for custom node types or UI extras.
  extras?: Record<string, unknown>;
}

// ── Graph elements ───────────────────────────────────────────────────────────

export interface BusinessNode {
  id: string;
  type: BusinessNodeType;
  /** Display label on the canvas. */
  label: string;
  /** Phase id (swimlane). Optional. */
  phaseId?: string;
  /** Canvas position. */
  position: { x: number; y: number };
  config: BusinessNodeConfig;
}

export interface BusinessEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  condition?: EdgeCondition;
}

export interface BusinessPhase {
  id: string;
  name: string;
  displayOrder: number;
  color?: string;
}

// ── Template + version ───────────────────────────────────────────────────────

export type BusinessTemplateStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface BusinessWorkflowTemplate {
  capabilityId: string;
  id: string;
  name: string;
  description?: string;
  status: BusinessTemplateStatus;
  /** 0 means "no version published yet". */
  currentVersion: number;
  draftNodes: BusinessNode[];
  draftEdges: BusinessEdge[];
  draftPhases: BusinessPhase[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface BusinessWorkflowVersion {
  capabilityId: string;
  templateId: string;
  version: number;
  nodes: BusinessNode[];
  edges: BusinessEdge[];
  phases: BusinessPhase[];
  publishedBy: string;
  publishedAt: string;
}

// ── Custom node types ────────────────────────────────────────────────────────

export interface CustomNodeTypeFieldDef {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
}

export interface BusinessCustomNodeType {
  capabilityId: string;
  id: string;
  name: string; // unique within capability — used as node.type. UPPER_SNAKE_CASE.
  baseType: BusinessNodeBaseType;
  label: string;
  description?: string;
  /**
   * Either a hex color (e.g. "#38bdf8") rendered via inline style, or a
   * Tailwind background class (e.g. "bg-emerald-500") for legacy entries.
   * The renderer auto-detects.
   */
  color?: string;
  /** Lucide icon name, e.g. "Box", "Briefcase". */
  icon?: string;
  fields: CustomNodeTypeFieldDef[];
  /**
   * Soft-toggle. Inactive types are hidden from the palette by default
   * but remain available to instances that already reference them.
   */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Runtime ─────────────────────────────────────────────────────────────────

export type BusinessInstanceStatus =
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export interface BusinessWorkflowInstance {
  capabilityId: string;
  id: string;
  templateId: string;
  templateVersion: number;
  status: BusinessInstanceStatus;
  context: Record<string, unknown>;
  activeNodeIds: string[];
  startedBy: string;
  startedAt: string;
  completedAt?: string;
  metadata: Record<string, unknown>;
}

export interface BusinessTask {
  capabilityId: string;
  id: string;
  instanceId: string;
  nodeId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignmentMode: AssignmentMode;
  assignedUserId?: string;
  assignedTeamId?: string;
  assignedRole?: string;
  assignedSkill?: string;
  claimedBy?: string;
  claimedAt?: string;
  dueAt?: string;
  priority: TaskPriority;
  formSchema?: FormSchema;
  formData?: Record<string, unknown>;
  output?: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
}

export interface BusinessApproval {
  capabilityId: string;
  id: string;
  instanceId: string;
  nodeId: string;
  status: ApprovalStatus;
  assignedUserId?: string;
  assignedTeamId?: string;
  assignedRole?: string;
  dueAt?: string;
  decision?: string;
  decidedBy?: string;
  decidedAt?: string;
  conditions?: string;
  notes?: string;
  createdAt: string;
}

export type BusinessWorkflowEventType =
  | "INSTANCE_STARTED"
  | "NODE_ACTIVATED"
  | "NODE_COMPLETED"
  | "TASK_CLAIMED"
  | "TASK_COMPLETED"
  | "APPROVAL_DECIDED"
  | "INSTANCE_COMPLETED"
  | "INSTANCE_CANCELLED"
  | "AGENT_DELEGATED"
  | "NOTIFICATION_SENT";

export interface BusinessWorkflowEvent {
  id: string;
  capabilityId: string;
  instanceId: string;
  nodeId?: string;
  eventType: BusinessWorkflowEventType;
  payload: Record<string, unknown>;
  actorId?: string;
  occurredAt: string;
}
