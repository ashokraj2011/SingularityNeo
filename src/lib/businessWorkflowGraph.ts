/**
 * Pure helpers for manipulating a Business Workflow graph in the
 * designer (no React). Add/remove/update nodes & edges; small
 * validation utilities.
 */

import type {
  BusinessEdge,
  BusinessNode,
  BusinessNodeType,
  EdgeCondition,
} from "../contracts/businessWorkflow";

const createId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

export const newBusinessNode = (
  type: BusinessNodeType,
  position: { x: number; y: number },
  label?: string,
): BusinessNode => ({
  id: createId("node"),
  type,
  label: label || type.replace(/_/g, " "),
  position,
  config: {},
});

export const newBusinessEdge = (
  sourceNodeId: string,
  targetNodeId: string,
  condition?: EdgeCondition,
): BusinessEdge => ({
  id: createId("edge"),
  sourceNodeId,
  targetNodeId,
  condition,
});

export const addNode = (
  nodes: BusinessNode[],
  node: BusinessNode,
): BusinessNode[] => [...nodes, node];

export const updateNode = (
  nodes: BusinessNode[],
  nodeId: string,
  patch: Partial<BusinessNode>,
): BusinessNode[] =>
  nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          ...patch,
          config: patch.config ? { ...n.config, ...patch.config } : n.config,
          position: patch.position
            ? { ...n.position, ...patch.position }
            : n.position,
        }
      : n,
  );

export const moveNode = (
  nodes: BusinessNode[],
  nodeId: string,
  position: { x: number; y: number },
): BusinessNode[] =>
  nodes.map((n) => (n.id === nodeId ? { ...n, position } : n));

export const removeNode = (
  nodes: BusinessNode[],
  edges: BusinessEdge[],
  nodeId: string,
): { nodes: BusinessNode[]; edges: BusinessEdge[] } => ({
  nodes: nodes.filter((n) => n.id !== nodeId),
  edges: edges.filter(
    (e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId,
  ),
});

export const addEdge = (
  edges: BusinessEdge[],
  edge: BusinessEdge,
): BusinessEdge[] => [...edges, edge];

export const updateEdge = (
  edges: BusinessEdge[],
  edgeId: string,
  patch: Partial<BusinessEdge>,
): BusinessEdge[] =>
  edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e));

export const removeEdge = (
  edges: BusinessEdge[],
  edgeId: string,
): BusinessEdge[] => edges.filter((e) => e.id !== edgeId);

/**
 * Lightweight validation. Returns a list of human-readable warnings.
 * Empty list = OK.
 */
export const validateGraph = ({
  nodes,
  edges,
}: {
  nodes: BusinessNode[];
  edges: BusinessEdge[];
}): string[] => {
  const issues: string[] = [];
  const startNodes = nodes.filter((n) => n.type === "START");
  const endNodes = nodes.filter((n) => n.type === "END");
  if (startNodes.length === 0) issues.push("Missing START node.");
  if (startNodes.length > 1) issues.push("Multiple START nodes — only one allowed.");
  if (endNodes.length === 0) issues.push("Missing END node.");

  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceNodeId)) {
      issues.push(`Edge ${edge.id} has unknown source node.`);
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      issues.push(`Edge ${edge.id} has unknown target node.`);
    }
  }
  // Reachability from START: BFS
  if (startNodes.length === 1) {
    const reachable = new Set<string>();
    const stack = [startNodes[0].id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const e of edges) {
        if (e.sourceNodeId === cur) stack.push(e.targetNodeId);
      }
    }
    const unreachable = nodes.filter(
      (n) => !reachable.has(n.id) && n.type !== "START",
    );
    if (unreachable.length > 0) {
      issues.push(
        `Unreachable nodes from START: ${unreachable.map((n) => n.label || n.id).join(", ")}`,
      );
    }
  }
  return issues;
};
