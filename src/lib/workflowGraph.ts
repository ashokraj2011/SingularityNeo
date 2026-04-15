import type {
  CapabilityLifecycle,
  WorkItemPhase,
  Workflow,
  WorkflowEdge,
  WorkflowEdgeConditionType,
  WorkflowHandoffProtocol,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowPublishState,
  WorkflowRunBranchState,
  WorkflowStep,
  WorkflowStepType,
} from '../types';
import {
  createDefaultCapabilityLifecycle,
  getCapabilityGraphPhaseIds,
  getDefaultLifecycleEndPhaseId,
  getDefaultLifecycleStartPhaseId,
} from './capabilityLifecycle';
import { isReleaseWorkflowStep } from './workflowStepSemantics';

export const WORKFLOW_GRAPH_SCHEMA_VERSION = 2;

export const WORKFLOW_GRAPH_PHASES: WorkItemPhase[] = getCapabilityGraphPhaseIds(
  createDefaultCapabilityLifecycle(),
);

const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 108;
const DEFAULT_LANE_HEIGHT = 176;
const DEFAULT_COLUMN_GAP = 260;
const DEFAULT_LANE_TOP = 48;

const createGraphId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const getGraphPhases = (lifecycle?: CapabilityLifecycle | null) =>
  getCapabilityGraphPhaseIds(lifecycle);

const isObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isVisibleWorkflowNode = (nodeType: WorkflowNodeType) =>
  nodeType === 'DELIVERY' ||
  nodeType === 'EVENT' ||
  nodeType === 'ALERT' ||
  nodeType === 'GOVERNANCE_GATE' ||
  nodeType === 'HUMAN_APPROVAL' ||
  nodeType === 'RELEASE' ||
  nodeType === 'EXTRACT' ||
  nodeType === 'TRANSFORM' ||
  nodeType === 'LOAD' ||
  nodeType === 'FILTER';

export const isWorkflowControlNode = (nodeType: WorkflowNodeType) =>
  nodeType === 'START' ||
  nodeType === 'END' ||
  nodeType === 'DECISION' ||
  nodeType === 'PARALLEL_SPLIT' ||
  nodeType === 'PARALLEL_JOIN';

export const mapNodeTypeToStepType = (nodeType: WorkflowNodeType): WorkflowStepType => {
  if (nodeType === 'GOVERNANCE_GATE' || nodeType === 'FILTER') {
    return 'GOVERNANCE_GATE';
  }

  if (nodeType === 'HUMAN_APPROVAL') {
    return 'HUMAN_APPROVAL';
  }

  return 'DELIVERY';
};

const mapStepTypeToNodeType = (step: WorkflowStep): WorkflowNodeType => {
  if (step.stepType === 'GOVERNANCE_GATE') {
    return 'GOVERNANCE_GATE';
  }

  if (step.stepType === 'HUMAN_APPROVAL') {
    return 'HUMAN_APPROVAL';
  }

  if (isReleaseWorkflowStep(step)) {
    return 'RELEASE';
  }

  return 'DELIVERY';
};

const normalizeLayout = (
  node: Partial<WorkflowNode>,
  column: number,
  phase: WorkItemPhase,
  lifecycle?: CapabilityLifecycle | null,
) => {
  const graphPhases = getGraphPhases(lifecycle);
  const laneIndex = Math.max(graphPhases.indexOf(phase), 0);

  return {
    x:
      typeof node.layout?.x === 'number'
        ? node.layout.x
        : 80 + column * DEFAULT_COLUMN_GAP,
    y:
      typeof node.layout?.y === 'number'
        ? node.layout.y
        : DEFAULT_LANE_TOP + laneIndex * DEFAULT_LANE_HEIGHT,
  };
};

const sortNodeIdsForTraversal = (
  nodes: WorkflowNode[],
  ids: string[],
  lifecycle?: CapabilityLifecycle | null,
) =>
  ids
    .map(id => nodes.find(node => node.id === id))
    .filter(Boolean)
    .sort((left, right) => {
      const graphPhases = getGraphPhases(lifecycle);
      const laneLeft = graphPhases.indexOf(left!.phase);
      const laneRight = graphPhases.indexOf(right!.phase);
      if (laneLeft !== laneRight) {
        return laneLeft - laneRight;
      }
      if (left!.layout.x !== right!.layout.x) {
        return left!.layout.x - right!.layout.x;
      }
      return left!.layout.y - right!.layout.y;
    })
    .map(node => node!.id);

const getLanePhase = (
  phase?: WorkItemPhase,
  lifecycle?: CapabilityLifecycle | null,
): WorkItemPhase => {
  const graphPhases = getGraphPhases(lifecycle);
  return graphPhases.includes(phase || '') ? (phase as WorkItemPhase) : graphPhases[0];
};

const getNodeRecord = (workflow: Workflow) =>
  new Map((workflow.nodes || []).map(node => [node.id, node]));

export const getWorkflowNodes = (workflow: Workflow) => workflow.nodes || [];

export const getWorkflowEdges = (workflow: Workflow) => workflow.edges || [];

export const getWorkflowNode = (workflow: Workflow, nodeId?: string | null) =>
  nodeId ? getNodeRecord(workflow).get(nodeId) : undefined;

export const getWorkflowEntryNode = (workflow: Workflow) =>
  getWorkflowNode(workflow, workflow.entryNodeId) ||
  getWorkflowNodes(workflow).find(node => node.type === 'START');

export const getOutgoingWorkflowEdges = (workflow: Workflow, nodeId?: string | null) =>
  getWorkflowEdges(workflow).filter(edge => edge.fromNodeId === nodeId);

export const getIncomingWorkflowEdges = (workflow: Workflow, nodeId?: string | null) =>
  getWorkflowEdges(workflow).filter(edge => edge.toNodeId === nodeId);

export const getWorkflowNodeOrder = (
  workflow: Workflow,
  lifecycle?: CapabilityLifecycle | null,
) => {
  const nodes = getWorkflowNodes(workflow);
  const edges = getWorkflowEdges(workflow);
  const visited = new Set<string>();
  const ordered: string[] = [];
  const entryNode = getWorkflowEntryNode(workflow);
  const graphPhases = getGraphPhases(lifecycle);
  const fallbackIds = nodes
    .slice()
    .sort((left, right) => {
      const laneLeft = graphPhases.indexOf(left.phase);
      const laneRight = graphPhases.indexOf(right.phase);
      if (laneLeft !== laneRight) {
        return laneLeft - laneRight;
      }
      if (left.layout.x !== right.layout.x) {
        return left.layout.x - right.layout.x;
      }
      return left.layout.y - right.layout.y;
    })
    .map(node => node.id);

  const visit = (nodeId?: string | null) => {
    if (!nodeId || visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);
    ordered.push(nodeId);
    const nextIds = sortNodeIdsForTraversal(
      nodes,
      edges.filter(edge => edge.fromNodeId === nodeId).map(edge => edge.toNodeId),
      lifecycle,
    );
    nextIds.forEach(visit);
  };

  visit(entryNode?.id);
  fallbackIds.forEach(visit);

  return ordered;
};

const findNearestVisibleNode = (
  workflow: Workflow,
  startNodeId?: string,
  direction: 'forward' | 'backward' = 'forward',
  lifecycle?: CapabilityLifecycle | null,
) => {
  if (!startNodeId) {
    return undefined;
  }

  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    const currentNode = getWorkflowNode(workflow, currentId);
    if (!currentNode) {
      continue;
    }
    if (isVisibleWorkflowNode(currentNode.type)) {
      return currentNode;
    }

    const nextIds =
      direction === 'forward'
        ? getOutgoingWorkflowEdges(workflow, currentId).map(edge => edge.toNodeId)
        : getIncomingWorkflowEdges(workflow, currentId).map(edge => edge.fromNodeId);
    sortNodeIdsForTraversal(getWorkflowNodes(workflow), nextIds, lifecycle).forEach(id =>
      queue.push(id),
    );
  }

  return undefined;
};

const deriveHandoffProtocols = (
  workflow: Workflow,
  lifecycle?: CapabilityLifecycle | null,
) => {
  const existingProtocols = new Map(
    (workflow.handoffProtocols || []).map(protocol => [
      protocol.sourceNodeId || protocol.sourceStepId,
      protocol,
    ]),
  );

  return deriveWorkflowStepsFromGraph(workflow, lifecycle).flatMap(step => {
    const outgoingEdge = getOutgoingWorkflowEdges(workflow, step.id)[0];
    if (!outgoingEdge || !outgoingEdge.handoffProtocolId) {
      return [];
    }

    const targetVisibleNode =
      findNearestVisibleNode(workflow, outgoingEdge.toNodeId, 'forward', lifecycle) ||
      getWorkflowNode(workflow, outgoingEdge.toNodeId);
    const existing = existingProtocols.get(step.id);

    return [
      {
        id: outgoingEdge.handoffProtocolId,
        name:
          existing?.name ||
          outgoingEdge.label ||
          `${step.name} hand-off`,
        sourceStepId: step.id,
        sourceNodeId: step.id,
        targetAgentId: targetVisibleNode?.agentId,
        targetPhase: targetVisibleNode?.phase,
        description: existing?.description,
        rules: existing?.rules || [],
        validationRequired: existing?.validationRequired ?? true,
        autoDocumentation: existing?.autoDocumentation ?? true,
      } satisfies WorkflowHandoffProtocol,
    ];
  });
};

export const deriveWorkflowStepsFromGraph = (
  workflow: Workflow,
  lifecycle?: CapabilityLifecycle | null,
): WorkflowStep[] => {
  const orderedNodes = getWorkflowNodeOrder(workflow, lifecycle)
    .map(nodeId => getWorkflowNode(workflow, nodeId))
    .filter((node): node is WorkflowNode => Boolean(node));

  return orderedNodes
    .filter(node => isVisibleWorkflowNode(node.type))
    .map(node => {
      const firstEdge = getOutgoingWorkflowEdges(workflow, node.id)[0];
      const targetVisibleNode = firstEdge
        ? findNearestVisibleNode(workflow, firstEdge.toNodeId, 'forward', lifecycle)
        : undefined;

      return {
        id: node.id,
        name: node.name,
        phase: node.phase,
        stepType: mapNodeTypeToStepType(node.type),
        agentId: node.agentId || 'SYSTEM',
        action: node.action || `${node.name} for ${node.phase}`,
        description: node.description,
        inputArtifactId: node.inputArtifactId,
        outputArtifactId: node.outputArtifactId,
        handoffToAgentId: targetVisibleNode?.agentId,
        handoffToPhase: targetVisibleNode?.phase,
        handoffLabel: firstEdge?.label,
        handoffProtocolId: firstEdge?.handoffProtocolId,
        governanceGate: node.governanceGate,
        approverRoles: node.approverRoles,
        exitCriteria: node.exitCriteria,
        templatePath: node.templatePath,
        allowedToolIds: node.allowedToolIds,
        preferredWorkspacePath: node.preferredWorkspacePath,
        executionNotes: node.executionNotes,
        artifactContract: node.artifactContract,
        approvalPolicy: node.approvalPolicy,
        ownershipRule: node.ownershipRule,
      } satisfies WorkflowStep;
    });
};

const createLinearGraph = (
  workflow: Workflow,
  lifecycle?: CapabilityLifecycle | null,
): Workflow => {
  const startNodeId = `NODE-${workflow.id}-START`;
  const endNodeId = `NODE-${workflow.id}-END`;
  const graphPhases = getGraphPhases(lifecycle);
  const startPhase = getDefaultLifecycleStartPhaseId(lifecycle);
  const endPhase = getDefaultLifecycleEndPhaseId(lifecycle);
  const nodes: WorkflowNode[] = [
    {
      id: startNodeId,
      name: 'Start',
      type: 'START',
      phase: startPhase,
      layout: { x: 80, y: DEFAULT_LANE_TOP },
      description: 'Entry point for workflow execution.',
    },
    ...workflow.steps.map((step, index) => ({
      id: step.id,
      name: step.name,
      type: mapStepTypeToNodeType(step),
      phase: getLanePhase(step.phase, lifecycle),
      layout: normalizeLayout(
        step as Partial<WorkflowNode>,
        index + 1,
        step.phase,
        lifecycle,
      ),
      agentId: step.agentId,
      action: step.action,
      description: step.description,
      inputArtifactId: step.inputArtifactId,
      outputArtifactId: step.outputArtifactId,
      governanceGate: step.governanceGate,
      approverRoles: step.approverRoles,
      exitCriteria: step.exitCriteria,
      templatePath: step.templatePath,
      allowedToolIds: step.allowedToolIds,
      preferredWorkspacePath: step.preferredWorkspacePath,
      executionNotes: step.executionNotes,
      artifactContract: step.artifactContract,
      approvalPolicy: step.approvalPolicy,
      ownershipRule: step.ownershipRule,
    })),
    {
      id: endNodeId,
      name: 'End',
      type: 'END',
      phase: endPhase,
      layout: {
        x: 80 + (workflow.steps.length + 1) * DEFAULT_COLUMN_GAP,
        y:
          DEFAULT_LANE_TOP +
          Math.max(graphPhases.indexOf(endPhase), 0) * DEFAULT_LANE_HEIGHT,
      },
      description: 'Terminal completion node.',
    },
  ];

  const edges: WorkflowEdge[] = [];

  if (workflow.steps[0]) {
    edges.push({
      id: createGraphId('EDGE'),
      fromNodeId: startNodeId,
      toNodeId: workflow.steps[0].id,
      conditionType: 'DEFAULT',
      label: 'Begin delivery',
    });
  } else {
    edges.push({
      id: createGraphId('EDGE'),
      fromNodeId: startNodeId,
      toNodeId: endNodeId,
      conditionType: 'DEFAULT',
      label: 'No steps defined',
    });
  }

  workflow.steps.forEach((step, index) => {
    const nextStep = workflow.steps[index + 1];
    edges.push({
      id: createGraphId('EDGE'),
      fromNodeId: step.id,
      toNodeId: nextStep?.id || endNodeId,
      conditionType: 'DEFAULT',
      label: step.handoffLabel || (nextStep ? 'Continue' : 'Complete'),
      handoffProtocolId: step.handoffProtocolId,
    });
  });

  const nextWorkflow: Workflow = {
    ...workflow,
    schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
    entryNodeId: startNodeId,
    nodes,
    edges,
    publishState: workflow.publishState || 'PUBLISHED',
  };

  const normalized = {
    ...nextWorkflow,
    steps: deriveWorkflowStepsFromGraph(nextWorkflow, lifecycle),
    handoffProtocols: deriveHandoffProtocols(nextWorkflow, lifecycle),
  };
  return normalized;
};

const ensureGraphDefaults = (
  workflow: Workflow,
  lifecycle?: CapabilityLifecycle | null,
): Workflow => {
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    return createLinearGraph(workflow, lifecycle);
  }

  const entryNodeId =
    workflow.entryNodeId ||
    workflow.nodes.find(node => node.type === 'START')?.id ||
    workflow.nodes[0]?.id;
  const order = getWorkflowNodeOrder({
    ...workflow,
    entryNodeId,
  }, lifecycle);
  const nodesById = new Map(workflow.nodes.map(node => [node.id, node]));
  const normalizedNodes = order
    .map((nodeId, index) => {
      const node = nodesById.get(nodeId)!;
      return {
        ...node,
        phase: getLanePhase(node.phase, lifecycle),
        layout: normalizeLayout(node, index, node.phase, lifecycle),
      } satisfies WorkflowNode;
    })
    .filter(Boolean);
  const existingEdgeIds = new Set<string>();
  const normalizedEdges = (workflow.edges || [])
    .filter(edge => nodesById.has(edge.fromNodeId) && nodesById.has(edge.toNodeId))
    .map(edge => {
      const nextId = edge.id || createGraphId('EDGE');
      if (existingEdgeIds.has(nextId)) {
        return {
          ...edge,
          id: createGraphId('EDGE'),
          conditionType: edge.conditionType || 'DEFAULT',
        };
      }
      existingEdgeIds.add(nextId);
      return {
        ...edge,
        id: nextId,
        conditionType: edge.conditionType || 'DEFAULT',
      } satisfies WorkflowEdge;
    });

  const nextWorkflow: Workflow = {
    ...workflow,
    schemaVersion: workflow.schemaVersion || WORKFLOW_GRAPH_SCHEMA_VERSION,
    entryNodeId,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    publishState: workflow.publishState || 'DRAFT',
  };

  return {
    ...nextWorkflow,
    steps: deriveWorkflowStepsFromGraph(nextWorkflow, lifecycle),
    handoffProtocols: deriveHandoffProtocols(nextWorkflow, lifecycle),
  };
};

export const normalizeWorkflowGraph = (
  workflow: Workflow,
  lifecycle?: CapabilityLifecycle | null,
): Workflow => ensureGraphDefaults(workflow, lifecycle);

export const autoLayoutWorkflowGraph = (
  workflow: Workflow,
  lifecycle?: CapabilityLifecycle | null,
): Workflow => {
  const normalizedWorkflow = normalizeWorkflowGraph(workflow, lifecycle);
  const order = getWorkflowNodeOrder(normalizedWorkflow, lifecycle);
  const laneRowCounters = new Map<string, number>();
  const graphPhases = getGraphPhases(lifecycle);
  const nextNodes = order.map((nodeId, index) => {
    const node = getWorkflowNode(normalizedWorkflow, nodeId)!;
    const laneKey = node.phase;
    const laneIndex = graphPhases.indexOf(node.phase);
    const row = laneRowCounters.get(laneKey) || 0;
    laneRowCounters.set(laneKey, row + 1);

    return {
      ...node,
      layout: {
        x: 80 + index * DEFAULT_COLUMN_GAP,
        y: DEFAULT_LANE_TOP + Math.max(laneIndex, 0) * DEFAULT_LANE_HEIGHT + row * 16,
      },
    };
  });

  return normalizeWorkflowGraph({
    ...normalizedWorkflow,
    nodes: nextNodes,
  }, lifecycle);
};

const hasGovernanceBeforeRelease = (workflow: Workflow, nodeId: string) => {
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    const incomingEdges = getIncomingWorkflowEdges(workflow, currentId);
    for (const edge of incomingEdges) {
      const sourceNode = getWorkflowNode(workflow, edge.fromNodeId);
      if (!sourceNode) {
        continue;
      }
      if (
        sourceNode.type === 'GOVERNANCE_GATE' ||
        sourceNode.type === 'HUMAN_APPROVAL'
      ) {
        return true;
      }
      queue.push(sourceNode.id);
    }
  }

  return false;
};

export const validateWorkflowGraph = (
  workflow: Workflow,
  lifecycle?: CapabilityLifecycle | null,
) => {
  const normalizedWorkflow = normalizeWorkflowGraph(workflow, lifecycle);
  const errors: Array<{
    id: string;
    message: string;
    nodeId?: string;
    edgeId?: string;
  }> = [];
  const nodes = getWorkflowNodes(normalizedWorkflow);
  const edges = getWorkflowEdges(normalizedWorkflow);
  const entryNode = getWorkflowEntryNode(normalizedWorkflow);

  const startNodes = nodes.filter(node => node.type === 'START');
  const endNodes = nodes.filter(node => node.type === 'END');

  if (startNodes.length !== 1) {
    errors.push({
      id: 'graph-start',
      message: 'Workflows must define exactly one START node.',
      nodeId: startNodes[0]?.id,
    });
  }

  if (endNodes.length < 1) {
    errors.push({
      id: 'graph-end',
      message: 'Workflows must define at least one END node.',
    });
  }

  if (!entryNode) {
    errors.push({
      id: 'graph-entry',
      message: 'Workflow is missing an entry node.',
    });
  }

  const reachable = new Set<string>();
  const visit = (nodeId?: string | null) => {
    if (!nodeId || reachable.has(nodeId)) {
      return;
    }
    reachable.add(nodeId);
    getOutgoingWorkflowEdges(normalizedWorkflow, nodeId).forEach(edge => visit(edge.toNodeId));
  };
  visit(entryNode?.id);

  nodes.forEach(node => {
    if (!reachable.has(node.id)) {
      errors.push({
        id: `orphan-${node.id}`,
        nodeId: node.id,
        message: `${node.name} is orphaned and cannot be reached from START.`,
      });
    }

    if (node.type !== 'END' && getOutgoingWorkflowEdges(normalizedWorkflow, node.id).length === 0) {
      errors.push({
        id: `dead-end-${node.id}`,
        nodeId: node.id,
        message: `${node.name} has no outbound edge and will dead-end the workflow.`,
      });
    }

    if (
      node.type === 'DECISION' &&
      getOutgoingWorkflowEdges(normalizedWorkflow, node.id).length < 2
    ) {
      errors.push({
        id: `decision-${node.id}`,
        nodeId: node.id,
        message: `${node.name} must define at least two outbound branches.`,
      });
    }

    if (node.type === 'PARALLEL_SPLIT') {
      const downstreamJoin = (() => {
        const queue = getOutgoingWorkflowEdges(normalizedWorkflow, node.id).map(edge => edge.toNodeId);
        const visited = new Set<string>();
        while (queue.length > 0) {
          const currentId = queue.shift();
          if (!currentId || visited.has(currentId)) {
            continue;
          }
          visited.add(currentId);
          const currentNode = getWorkflowNode(normalizedWorkflow, currentId);
          if (!currentNode) {
            continue;
          }
          if (currentNode.type === 'PARALLEL_JOIN') {
            return currentNode;
          }
          getOutgoingWorkflowEdges(normalizedWorkflow, currentId).forEach(edge =>
            queue.push(edge.toNodeId),
          );
        }
        return undefined;
      })();

      if (!downstreamJoin) {
        errors.push({
          id: `split-${node.id}`,
          nodeId: node.id,
          message: `${node.name} must connect to a reachable PARALLEL_JOIN node.`,
        });
      }
    }

    if (node.type === 'RELEASE' && !hasGovernanceBeforeRelease(normalizedWorkflow, node.id)) {
      errors.push({
        id: `release-${node.id}`,
        nodeId: node.id,
        message: `${node.name} must be gated by governance or human approval.`,
      });
    }
  });

  edges.forEach(edge => {
    if (edge.fromNodeId === edge.toNodeId) {
      errors.push({
        id: `edge-loop-${edge.id}`,
        edgeId: edge.id,
        message: 'Self-loop edges are not supported in v1.',
      });
    }
  });

  return {
    workflow: normalizedWorkflow,
    valid: errors.length === 0,
    errors,
  };
};

export const createWorkflowBranchState = (
  entryNodeId?: string,
): WorkflowRunBranchState => ({
  pendingNodeIds: entryNodeId ? [entryNodeId] : [],
  completedNodeIds: [],
  activeNodeIds: entryNodeId ? [entryNodeId] : [],
  joinState: {},
  visitCount: 0,
});

export const findFirstExecutableNode = (
  workflow: Workflow,
  lifecycle?: CapabilityLifecycle | null,
) => {
  const normalizedWorkflow = normalizeWorkflowGraph(workflow, lifecycle);
  const visited = new Set<string>();
  const queue = [normalizedWorkflow.entryNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    const node = getWorkflowNode(normalizedWorkflow, currentId);
    if (!node) {
      continue;
    }
    if (isVisibleWorkflowNode(node.type)) {
      return node;
    }
    getOutgoingWorkflowEdges(normalizedWorkflow, currentId).forEach(edge =>
      queue.push(edge.toNodeId),
    );
  }

  return undefined;
};

export const findFirstExecutableNodeForPhase = (
  workflow: Workflow,
  phase?: WorkItemPhase,
  lifecycle?: CapabilityLifecycle | null,
) => {
  const normalizedWorkflow = normalizeWorkflowGraph(workflow, lifecycle);
  const orderedNodes = getWorkflowNodeOrder(normalizedWorkflow, lifecycle)
    .map(nodeId => getWorkflowNode(normalizedWorkflow, nodeId))
    .filter((node): node is WorkflowNode => Boolean(node));

  return orderedNodes.find(
    node => isVisibleWorkflowNode(node.type) && (!phase || node.phase === phase),
  );
};

export const getDisplayStepIdForNode = (workflow: Workflow, nodeId?: string) => {
  const normalizedWorkflow = normalizeWorkflowGraph(workflow);
  const currentNode = getWorkflowNode(normalizedWorkflow, nodeId);
  if (!currentNode) {
    return undefined;
  }

  if (isVisibleWorkflowNode(currentNode.type)) {
    return currentNode.id;
  }

  return (
    findNearestVisibleNode(normalizedWorkflow, nodeId, 'forward')?.id ||
    findNearestVisibleNode(normalizedWorkflow, nodeId, 'backward')?.id
  );
};

export const buildWorkflowFromGraph = (
  workflow: Workflow,
  lifecycle?: CapabilityLifecycle | null,
) => {
  const normalizedWorkflow = normalizeWorkflowGraph(workflow, lifecycle);
  return {
    ...normalizedWorkflow,
    steps: deriveWorkflowStepsFromGraph(normalizedWorkflow, lifecycle),
    handoffProtocols: deriveHandoffProtocols(normalizedWorkflow, lifecycle),
  };
};

export const getWorkflowPublishState = (workflow: Workflow): WorkflowPublishState =>
  workflow.publishState || 'DRAFT';

export const createWorkflowNode = (
  values: Partial<WorkflowNode> & Pick<WorkflowNode, 'name' | 'type' | 'phase'>,
  lifecycle?: CapabilityLifecycle | null,
): WorkflowNode => ({
  id: values.id || createGraphId('NODE'),
  name: values.name,
  type: values.type,
  phase: getLanePhase(values.phase, lifecycle),
  layout: values.layout || { x: 80, y: DEFAULT_LANE_TOP },
  agentId: values.agentId,
  action: values.action,
  description: values.description,
  inputArtifactId: values.inputArtifactId,
  outputArtifactId: values.outputArtifactId,
  governanceGate: values.governanceGate,
  approverRoles: values.approverRoles,
  exitCriteria: values.exitCriteria,
  templatePath: values.templatePath,
  allowedToolIds: values.allowedToolIds,
  preferredWorkspacePath: values.preferredWorkspacePath,
  executionNotes: values.executionNotes,
  etlConfig: values.etlConfig,
  eventConfig: values.eventConfig,
  alertConfig: values.alertConfig,
  artifactContract: values.artifactContract,
  approvalPolicy: values.approvalPolicy,
  ownershipRule: values.ownershipRule,
});

export const createWorkflowEdge = (
  values: Partial<WorkflowEdge> &
    Pick<WorkflowEdge, 'fromNodeId' | 'toNodeId'>,
): WorkflowEdge => ({
  id: values.id || createGraphId('EDGE'),
  fromNodeId: values.fromNodeId,
  toNodeId: values.toNodeId,
  label: values.label,
  conditionType: values.conditionType || 'DEFAULT',
  handoffProtocolId: values.handoffProtocolId,
  artifactContract: values.artifactContract,
  branchKey: values.branchKey,
});

export const parseWorkflowGraphFromUnknown = (
  value: unknown,
  lifecycle?: CapabilityLifecycle | null,
): Workflow | null => {
  if (!isObject(value)) {
    return null;
  }

  return normalizeWorkflowGraph(value as Workflow, lifecycle);
};

export const getWorkflowNodeDimensions = () => ({
  width: DEFAULT_NODE_WIDTH,
  height: DEFAULT_NODE_HEIGHT,
});
