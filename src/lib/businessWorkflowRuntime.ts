/**
 * Pure helpers for the Business Workflow runtime UI.
 *
 * Imported by both the canvas/timeline/dashboards on the renderer side
 * AND the server-side engine where applicable. NO DOM imports here, NO
 * React imports — keep this side-effect-free so the engine and the
 * unit tests can pull it in cheaply.
 */

import type {
  BusinessEdge,
  BusinessNode,
  BusinessWorkflowEvent,
  BusinessWorkflowInstance,
} from "../contracts/businessWorkflow";

/**
 * Five stable visual states a node can be in on the InstanceDashboard.
 *
 * Priority (highest first):
 *   active           → in instance.activeNodeIds
 *   sent-back-source → emitted TASK_SENT_BACK / APPROVAL_SENT_BACK from this node and is no longer active
 *   completed        → emitted NODE_COMPLETED at least once (and is not currently active)
 *   failed           → emitted some failure event (reserved for future)
 *   idle             → none of the above
 */
export type NodeRuntimeState =
  | "idle"
  | "active"
  | "completed"
  | "sent-back-source"
  | "failed";

/**
 * Compute a node's runtime state from the instance + event log.
 *
 * Pure function — same inputs always yield same output. The dashboard
 * derives every node's appearance from this so the canvas, the
 * timeline, and the active-tasks panel agree on what's "active" or
 * "completed".
 */
export const nodeRuntimeState = (
  nodeId: string,
  instance: BusinessWorkflowInstance,
  events: readonly BusinessWorkflowEvent[],
): NodeRuntimeState => {
  if (instance.activeNodeIds.includes(nodeId)) return "active";

  // Walk events newest-last; any sent-back from this node beats a prior
  // completion (the latter is preserved for audit but the visual cue is
  // "this is where we rewound from").
  let completed = false;
  let sentBackSource = false;
  let failed = false;
  for (const evt of events) {
    if (evt.nodeId !== nodeId) continue;
    if (evt.eventType === "NODE_COMPLETED") completed = true;
    if (
      evt.eventType === "TASK_SENT_BACK" ||
      evt.eventType === "APPROVAL_SENT_BACK"
    ) {
      sentBackSource = true;
    }
    // Reserved: future failure events
  }
  if (failed) return "failed";
  if (sentBackSource) return "sent-back-source";
  if (completed) return "completed";
  return "idle";
};

/**
 * Order nodes by the time they last completed, oldest first.
 * Used by the SendBackPanel to show "the path you've already walked"
 * — the operator wants to bounce a task back to a node from the past,
 * and chronological ordering matches their mental model better than
 * topological ordering when loops are involved.
 */
export const orderNodesByCompletion = (
  events: readonly BusinessWorkflowEvent[],
): { nodeId: string; completedAt: string }[] => {
  const seen = new Map<string, string>();
  for (const evt of events) {
    if (evt.eventType !== "NODE_COMPLETED" || !evt.nodeId) continue;
    // Keep the LATEST completion timestamp for nodes that completed
    // multiple times (loops, send-back/redo).
    const prev = seen.get(evt.nodeId);
    if (!prev || evt.occurredAt > prev) seen.set(evt.nodeId, evt.occurredAt);
  }
  return Array.from(seen.entries())
    .map(([nodeId, completedAt]) => ({ nodeId, completedAt }))
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
};

/**
 * Discover send-back arrows: for every TASK_SENT_BACK / APPROVAL_SENT_BACK
 * event, return a (sourceNodeId → targetNodeId) pair so the canvas can
 * render a dotted curved red edge from where the work was rewound FROM
 * to where it landed.
 */
export interface BackflowArrow {
  sourceNodeId: string;
  targetNodeId: string;
  reason?: string;
  occurredAt: string;
}

export const buildBackflowEdges = (
  events: readonly BusinessWorkflowEvent[],
): BackflowArrow[] => {
  const out: BackflowArrow[] = [];
  for (const evt of events) {
    if (
      evt.eventType !== "TASK_SENT_BACK" &&
      evt.eventType !== "APPROVAL_SENT_BACK"
    ) {
      continue;
    }
    if (!evt.nodeId) continue;
    const target =
      typeof evt.payload?.targetNodeId === "string"
        ? (evt.payload.targetNodeId as string)
        : null;
    if (!target) continue;
    const reason =
      typeof evt.payload?.reason === "string"
        ? (evt.payload.reason as string)
        : undefined;
    out.push({
      sourceNodeId: evt.nodeId,
      targetNodeId: target,
      reason,
      occurredAt: evt.occurredAt,
    });
  }
  return out;
};

/**
 * SLA chip representation. Centralised here so the chip on the inbox,
 * the chip on the dashboard task list, and the canvas overdue ring all
 * agree on amber/red thresholds.
 */
export type SlaTone = "ok" | "warn" | "overdue" | "none";

export interface SlaState {
  tone: SlaTone;
  /** Short label like "2h 14m left" or "3h overdue" or "no SLA". */
  label: string;
  /** Milliseconds until due (negative = overdue). null when no SLA. */
  msRemaining: number | null;
}

const formatDelta = (ms: number): string => {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remM = minutes % 60;
  if (hours < 24) return remM > 0 ? `${hours}h ${remM}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
};

/**
 * Format an SLA from a due-at ISO string. `now` is injected so this
 * is unit-testable without freezing time.
 */
export const formatSla = (
  dueAt: string | null | undefined,
  now: number = Date.now(),
): SlaState => {
  if (!dueAt) {
    return { tone: "none", label: "no SLA", msRemaining: null };
  }
  const dueMs = Date.parse(dueAt);
  if (Number.isNaN(dueMs)) {
    return { tone: "none", label: "no SLA", msRemaining: null };
  }
  const msRemaining = dueMs - now;
  if (msRemaining < 0) {
    return {
      tone: "overdue",
      label: `${formatDelta(msRemaining)} overdue`,
      msRemaining,
    };
  }
  // Heuristic warn threshold: under 1 hour OR under 25% of an
  // 8-hour window — whichever is sooner.
  const tone: SlaTone = msRemaining < 60 * 60_000 ? "warn" : "ok";
  return {
    tone,
    label: `${formatDelta(msRemaining)} left`,
    msRemaining,
  };
};

/**
 * Forward-BFS from `fromNodeId` to discover whether a `PARALLEL_JOIN`
 * sits on any path to `toNodeId`. Used by send-back to know whether
 * the rewind crosses a join (in which case the engine resets the
 * join's arrival counter).
 *
 * Returns the join nodeId(s) found, or [] if the path doesn't cross
 * any join. This is intentionally non-strict about reachability — we
 * use it to ANNOTATE, not to BLOCK.
 */
export const findJoinsBetween = (
  fromNodeId: string,
  toNodeId: string,
  nodes: readonly BusinessNode[],
  edges: readonly BusinessEdge[],
): string[] => {
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const joins: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [fromNodeId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (cur === toNodeId) continue; // don't walk past the target
    const node = nodesById.get(cur);
    if (node?.type === "PARALLEL_JOIN" && cur !== fromNodeId) {
      joins.push(cur);
    }
    for (const e of edges) {
      if (e.sourceNodeId === cur && !visited.has(e.targetNodeId)) {
        queue.push(e.targetNodeId);
      }
    }
  }
  return joins;
};

/**
 * Aggregate a set of nodes the operator can choose as a send-back
 * target — every previously-completed node, plus the node currently
 * holding the task being bounced (so they can re-do it themselves).
 *
 * Excludes the START node and any END nodes — sending back to those
 * is meaningless.
 */
export const sendBackCandidates = (
  events: readonly BusinessWorkflowEvent[],
  templateNodes: readonly BusinessNode[],
): { nodeId: string; label: string; completedAt: string }[] => {
  const ordered = orderNodesByCompletion(events);
  const byId = new Map(templateNodes.map((n) => [n.id, n]));
  return ordered
    .map(({ nodeId, completedAt }) => {
      const node = byId.get(nodeId);
      if (!node) return null;
      if (node.type === "START" || node.type === "END") return null;
      return {
        nodeId,
        label: node.label || node.id,
        completedAt,
      };
    })
    .filter((x): x is { nodeId: string; label: string; completedAt: string } =>
      Boolean(x),
    );
};
