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
  | "CANCELLED"
  /**
   * Set when an operator/approver routes the work back to an earlier
   * node. The original task row is preserved (form_data and audit
   * trail intact); a fresh task is spawned at the target node.
   */
  | "SENT_BACK";

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

// ── Attached behaviors (Lego blocks) ─────────────────────────────────────────
//
// Timers and notifications are NOT distinct node types. They're tiny
// behaviors that bolt onto ANY actionable node (HUMAN_TASK, APPROVAL,
// FORM_FILL, AGENT_TASK, TOOL_REQUEST, CALL_WORKFLOW) and fire on the
// node's lifecycle transitions. This mirrors workgraph-studio's
// `config.attachments` shape so the model is familiar to anyone who's
// seen that designer.
//
// V1 scope: store + emit events on triggers so the timeline shows
// "notification fired" / "timer scheduled". Actual SMTP delivery and
// timer auto-fire are V2.1 (require a background sweep / queue
// worker — out of scope for this PR).

export type BusinessAttachmentType = "TIMER" | "NOTIFICATION";

/** When a NOTIFICATION attachment fires. Timers always start at
 *  ON_ACTIVATE — `durationMinutes` carries the relative offset. */
export type BusinessAttachmentTrigger =
  | "ON_ACTIVATE"
  | "ON_COMPLETE"
  | "ON_OVERDUE";

export type BusinessNotificationChannel = "EMAIL" | "WEBHOOK" | "IN_APP";

/** What happens when a TIMER attachment fires. V1 only emits an
 *  event. AUTO_COMPLETE / ESCALATE are reserved for V2.1 sweep. */
export type BusinessTimerAction = "NOTIFY" | "ESCALATE" | "AUTO_COMPLETE";

export interface BusinessAttachment {
  /** Stable id within the node's attachment list. */
  id: string;
  type: BusinessAttachmentType;
  /** Friendly label for the inspector + timeline event payload. */
  label?: string;
  /** Toggle without deleting — useful for templating-then-disabling. */
  enabled: boolean;

  // ── TIMER fields ──────────────────────────────────────────────────────────
  /** Minutes after the node activates when the timer fires. */
  durationMinutes?: number;
  onFire?: BusinessTimerAction;
  escalateToUserId?: string;
  escalateToRole?: string;

  // ── NOTIFICATION fields ───────────────────────────────────────────────────
  /** Lifecycle trigger. Only used for NOTIFICATION (timers always
   *  schedule on ON_ACTIVATE). */
  trigger?: BusinessAttachmentTrigger;
  channel?: BusinessNotificationChannel;
  /** User ids, team ids, role names, or raw email/webhook URLs.
   *  V1 doesn't deliver — but the recipient list is captured on the
   *  audit event so the operator can see "who SHOULD have been told". */
  recipients?: string[];
  /** Free-form message template. Future: ${context.foo} interpolation. */
  message?: string;
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

  /**
   * Attached behaviors. Each entry is a tiny Lego-block that runs on
   * a lifecycle trigger (ON_ACTIVATE / ON_COMPLETE / ON_OVERDUE) or
   * after a duration (TIMER). Stored on the node so the per-node
   * inspector edits them in place.
   */
  attachments?: BusinessAttachment[];

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
  /** Set when status becomes PAUSED. Cleared on resume. */
  pausedAt?: string;
  pausedBy?: string;
  pausedReason?: string;
}

export interface BusinessTask {
  capabilityId: string;
  id: string;
  instanceId: string;
  /**
   * Either a real `node.id` from the pinned template version, or a
   * synthetic `adhoc-<uuid>` for ad-hoc tasks (which don't appear on
   * the canvas).
   */
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

  // ── V2 runtime additions ─────────────────────────────────────────
  /** When this task replaced an earlier task via send-back, the id of
   *  the source node it was bounced FROM. Renders backflow on canvas. */
  sentBackFromNodeId?: string;
  sentBackReason?: string;
  /** Set when reassigned post-creation (claim is released). */
  reassignedAt?: string;
  reassignedBy?: string;
  /** Ad-hoc tasks live alongside the planned graph and do not advance
   *  the workflow on completion. `adHocBlocking` true means the
   *  instance pauses on creation and auto-resumes on completion. */
  isAdHoc: boolean;
  adHocBlocking: boolean;
  /** Optional link to the task that spawned this one (e.g. a parent
   *  HUMAN_TASK whose owner kicked off a side ad-hoc task). */
  parentTaskId?: string;
  /** The actor who created this task — the `started_by` of the
   *  instance for planned tasks, the operator for ad-hoc. */
  createdBy?: string;
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

  // ── V2 runtime additions ─────────────────────────────────────────
  sentBackFromNodeId?: string;
  sentBackReason?: string;
  reassignedAt?: string;
  reassignedBy?: string;
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
  | "NOTIFICATION_SENT"
  // ── V2 additions ─────────────────────────────────────────────────
  | "TASK_SENT_BACK"
  | "APPROVAL_SENT_BACK"
  | "TASK_REASSIGNED"
  | "APPROVAL_REASSIGNED"
  | "AD_HOC_TASK_CREATED"
  | "INSTANCE_PAUSED"
  | "INSTANCE_RESUMED"
  | "INSTANCE_NOTE_ADDED"
  // ── Attached behaviors ──────────────────────────────────────────
  | "ATTACHED_NOTIFICATION_SENT"
  | "ATTACHED_TIMER_SCHEDULED"
  | "ATTACHED_TIMER_FIRED" // reserved for V2.1 sweep
  // ── Editable context + documents ────────────────────────────────
  | "CONTEXT_UPDATED"
  | "DOCUMENT_ATTACHED"
  | "DOCUMENT_REMOVED";

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
