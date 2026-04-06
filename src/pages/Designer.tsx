import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  CircleDot,
  Code2,
  Copy,
  Database,
  Download,
  FileText,
  Filter,
  GitBranch,
  GitMerge,
  Globe,
  LayoutTemplate,
  PanelLeft,
  Play,
  Plus,
  Radio,
  Route,
  ScanLine,
  Server,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Split,
  UnfoldVertical,
  Workflow as WorkflowIcon,
  Wrench,
  X,
} from 'lucide-react';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import {
  EmptyState,
  FormSection,
  ModalShell,
  SectionCard,
  StatusBadge,
  Toolbar,
} from '../components/EnterpriseUI';
import {
  createStandardCapabilityWorkflow,
} from '../lib/standardWorkflow';
import {
  autoLayoutWorkflowGraph,
  buildWorkflowFromGraph,
  createWorkflowEdge,
  createWorkflowNode,
  getOutgoingWorkflowEdges,
  getWorkflowEdges,
  getWorkflowNode,
  getWorkflowNodeDimensions,
  getWorkflowNodeOrder,
  getWorkflowNodes,
  getWorkflowPublishState,
  isVisibleWorkflowNode,
  normalizeWorkflowGraph,
  validateWorkflowGraph,
  WORKFLOW_GRAPH_PHASES,
} from '../lib/workflowGraph';
import { cn } from '../lib/utils';
import type {
  ToolAdapterId,
  WorkItemPhase,
  Workflow,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowPublishState,
} from '../types';

const NODE_TYPE_OPTIONS: Array<{
  type: WorkflowNodeType;
  label: string;
  description: string;
}> = [
  { type: 'DELIVERY', label: 'Delivery Step', description: 'Agent-owned delivery work inside an SDLC phase.' },
  { type: 'DECISION', label: 'Decision', description: 'Route work based on outcome, guardrail, or validation result.' },
  { type: 'PARALLEL_SPLIT', label: 'Parallel Split', description: 'Fan work out across multiple agent tracks.' },
  { type: 'PARALLEL_JOIN', label: 'Parallel Join', description: 'Wait for multiple agent tracks, then continue.' },
  { type: 'GOVERNANCE_GATE', label: 'Governance Gate', description: 'Hold for governance, audit, or risk checks.' },
  { type: 'HUMAN_APPROVAL', label: 'Human Approval', description: 'Pause for human review, approval, or clarification.' },
  { type: 'RELEASE', label: 'Release Step', description: 'Release or deploy after upstream work is complete.' },
  { type: 'END', label: 'End', description: 'Terminal node that closes the workflow path.' },
  { type: 'EXTRACT', label: 'Legacy Source Step', description: 'Legacy ETL node imported from an older workflow.' },
  { type: 'TRANSFORM', label: 'Legacy Transform Step', description: 'Legacy ETL node imported from an older workflow.' },
  { type: 'LOAD', label: 'Legacy Target Step', description: 'Legacy ETL node imported from an older workflow.' },
  { type: 'FILTER', label: 'Legacy Validation Step', description: 'Legacy ETL node imported from an older workflow.' },
];

const EDGE_CONDITION_OPTIONS: WorkflowEdge['conditionType'][] = [
  'DEFAULT',
  'SUCCESS',
  'FAILURE',
  'APPROVED',
  'REJECTED',
  'PARALLEL',
  'CUSTOM',
];

const TOOL_OPTIONS: ToolAdapterId[] = [
  'workspace_list',
  'workspace_read',
  'workspace_search',
  'git_status',
  'workspace_write',
  'run_build',
  'run_test',
  'run_docs',
  'run_deploy',
];

const NODE_TYPE_TONE: Record<WorkflowNodeType, string> = {
  START: 'bg-slate-100 text-slate-700 border-slate-200',
  EXTRACT: 'bg-slate-100 text-slate-600 border-slate-200',
  TRANSFORM: 'bg-slate-100 text-slate-600 border-slate-200',
  LOAD: 'bg-slate-100 text-slate-600 border-slate-200',
  FILTER: 'bg-slate-100 text-slate-600 border-slate-200',
  DELIVERY: 'bg-primary/10 text-primary border-primary/20',
  GOVERNANCE_GATE: 'bg-orange-100 text-orange-800 border-orange-200',
  HUMAN_APPROVAL: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  DECISION: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  PARALLEL_SPLIT: 'bg-rose-100 text-rose-700 border-rose-200',
  PARALLEL_JOIN: 'bg-pink-100 text-pink-700 border-pink-200',
  RELEASE: 'bg-teal-100 text-teal-700 border-teal-200',
  END: 'bg-slate-900 text-white border-slate-900',
};

const PUBLISH_STATE_TONE: Record<WorkflowPublishState, 'neutral' | 'info' | 'success'> = {
  DRAFT: 'neutral',
  VALIDATED: 'info',
  PUBLISHED: 'success',
};

const AGENT_NODE_GROUPS: Array<{
  title: string;
  description: string;
  phase: Exclude<WorkItemPhase, 'BACKLOG' | 'DONE'>;
  items: Array<{ type: WorkflowNodeType; label: string; defaultPhase: Exclude<WorkItemPhase, 'BACKLOG' | 'DONE'> }>;
}> = [
  {
    title: 'Delivery Agents',
    description: 'Core agent steps that perform analysis, design, build, QA, and release work.',
    phase: 'DEVELOPMENT',
    items: [
      { type: 'DELIVERY', label: 'Analysis Task', defaultPhase: 'ANALYSIS' },
      { type: 'DELIVERY', label: 'Design Task', defaultPhase: 'DESIGN' },
      { type: 'DELIVERY', label: 'Build Task', defaultPhase: 'DEVELOPMENT' },
      { type: 'DELIVERY', label: 'QA Task', defaultPhase: 'QA' },
      { type: 'RELEASE', label: 'Release Task', defaultPhase: 'RELEASE' },
    ],
  },
  {
    title: 'Handoffs & Branching',
    description: 'Move work between agents and branch on review or execution outcomes.',
    phase: 'DESIGN',
    items: [
      { type: 'DECISION', label: 'Decision', defaultPhase: 'DESIGN' },
      { type: 'PARALLEL_SPLIT', label: 'Parallel Split', defaultPhase: 'DESIGN' },
      { type: 'PARALLEL_JOIN', label: 'Parallel Join', defaultPhase: 'QA' },
    ],
  },
  {
    title: 'Governance & Human Review',
    description: 'Pause for approval, human input, and governance sign-offs.',
    phase: 'GOVERNANCE',
    items: [
      { type: 'GOVERNANCE_GATE', label: 'Governance Gate', defaultPhase: 'GOVERNANCE' },
      { type: 'HUMAN_APPROVAL', label: 'Human Approval', defaultPhase: 'GOVERNANCE' },
      { type: 'END', label: 'End', defaultPhase: 'RELEASE' },
    ],
  },
];

const slugify = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

const createWorkflowId = (capabilityId: string, name: string) =>
  `WF-${slugify(capabilityId)}-${slugify(name || 'WORKFLOW')}`;

const createDesignerCopyId = (prefix: 'WF' | 'NODE' | 'EDGE', label: string) =>
  `${prefix}-${slugify(label || prefix)}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

const createCopyName = (sourceName: string, existingNames: string[]) => {
  const normalizedExistingNames = new Set(existingNames.map(name => name.trim().toLowerCase()));
  const baseName = sourceName.replace(/\s+copy(?:\s+\d+)?$/i, '').trim() || sourceName.trim();
  let index = 1;
  let candidate = `${baseName} Copy`;

  while (normalizedExistingNames.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${baseName} Copy ${index}`;
  }

  return candidate;
};

const phaseLabel = (phase: WorkItemPhase) =>
  phase
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const isLegacyEtlNodeType = (type: WorkflowNodeType) =>
  type === 'EXTRACT' || type === 'TRANSFORM' || type === 'LOAD' || type === 'FILTER';

const getNodeTypeLabel = (type: WorkflowNodeType) =>
  NODE_TYPE_OPTIONS.find(option => option.type === type)?.label || type;

const getEtlSubTypeIcon = (subType?: string) => {
  switch (subType) {
    case 'database_source': case 'database_target': return Database;
    case 'file_source': case 'file_target': return FileText;
    case 'api_source': case 'api_target': return Globe;
    case 'stream_source': return Radio;
    case 'filter': return Filter;
    case 'map': return Shuffle;
    case 'join': return GitMerge;
    case 'aggregate': return BarChart3;
    case 'sort': return ArrowUpDown;
    case 'deduplicate': return Copy;
    case 'validate': return ShieldCheck;
    case 'script': return Code2;
    case 'warehouse_target': return Server;
    case 'error_handler': return AlertTriangle;
    default: return null;
  }
};

const getNodeIcon = (type: WorkflowNodeType, etlSubType?: string) => {
  const subIcon = etlSubType ? getEtlSubTypeIcon(etlSubType) : null;
  if (subIcon) return subIcon;
  switch (type) {
    case 'EXTRACT': return Database;
    case 'TRANSFORM': return Shuffle;
    case 'LOAD': return Server;
    case 'FILTER': return Filter;
    case 'DELIVERY': return WorkflowIcon;
    case 'DECISION': return GitBranch;
    case 'PARALLEL_SPLIT': return Split;
    case 'PARALLEL_JOIN': return UnfoldVertical;
    case 'GOVERNANCE_GATE': return ShieldCheck;
    case 'HUMAN_APPROVAL': return CheckCircle2;
    case 'RELEASE': return Sparkles;
    case 'END': return CircleDot;
    default: return WorkflowIcon;
  }
};

const getSamplePath = (workflow: Workflow) => {
  const normalized = buildWorkflowFromGraph(normalizeWorkflowGraph(workflow));
  const path: Array<{ label: string; note?: string }> = [];
  const visited = new Set<string>();
  let currentNode = getWorkflowNode(normalized, normalized.entryNodeId);
  let safetyCounter = 0;

  while (currentNode && !visited.has(currentNode.id) && safetyCounter < 40) {
    safetyCounter += 1;
    visited.add(currentNode.id);
    if (currentNode.type !== 'START') {
      path.push({
        label: currentNode.name,
        note:
          currentNode.type === 'HUMAN_APPROVAL'
            ? 'Pauses for approval'
            : currentNode.type === 'PARALLEL_SPLIT'
            ? 'Creates parallel branches'
            : currentNode.type === 'PARALLEL_JOIN'
            ? 'Waits for branches to join'
            : undefined,
      });
    }
    if (currentNode.type === 'END') {
      break;
    }
    const nextEdge = getOutgoingWorkflowEdges(normalized, currentNode.id)[0];
    if (!nextEdge) {
      break;
    }
    currentNode = getWorkflowNode(normalized, nextEdge.toNodeId);
  }

  return path;
};

const getNodeValidationMessages = (
  workflow: Workflow,
  selectedNodeId?: string,
  selectedEdgeId?: string,
) => {
  const validation = validateWorkflowGraph(workflow);
  return {
    all: validation.errors,
    selected:
      validation.errors.filter(
        error => error.nodeId === selectedNodeId || error.edgeId === selectedEdgeId,
      ) || [],
    nodeIdsWithErrors: new Set(validation.errors.map(error => error.nodeId).filter(Boolean)),
  };
};

const getEdgePath = (fromNode: WorkflowNode, toNode: WorkflowNode) => {
  const { width, height } = getWorkflowNodeDimensions();
  const startX = fromNode.layout.x + width;
  const startY = fromNode.layout.y + height / 2;
  const endX = toNode.layout.x;
  const endY = toNode.layout.y + height / 2;
  const controlX = Math.max((startX + endX) / 2, startX + 40);
  return `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`;
};

const getDropCoordinates = (
  event: React.DragEvent<HTMLDivElement>,
  element: HTMLDivElement,
  scale: number,
) => {
  const bounds = element.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left + element.scrollLeft) / scale - 110,
    y: (event.clientY - bounds.top + element.scrollTop) / scale - 54,
  };
};

const getCanvasPointFromMouse = (
  clientX: number,
  clientY: number,
  element: HTMLDivElement,
  scale: number,
) => {
  const bounds = element.getBoundingClientRect();
  return {
    x: (clientX - bounds.left + element.scrollLeft) / scale,
    y: (clientY - bounds.top + element.scrollTop) / scale,
  };
};

const Designer = () => {
  const { activeCapability, getCapabilityWorkspace, setCapabilityWorkspaceContent } =
    useCapability();
  const { success, info, warning } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const workflows = useMemo(
    () =>
      workspace.workflows.map(workflow =>
        buildWorkflowFromGraph(normalizeWorkflowGraph(workflow)),
      ),
    [workspace.workflows],
  );
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    workflows[0]?.id || '',
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectFromNodeId, setConnectFromNodeId] = useState<string | null>(null);
  const [dragLinkFromNodeId, setDragLinkFromNodeId] = useState<string | null>(null);
  const [dragLinkPosition, setDragLinkPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [canvasScale, setCanvasScale] = useState(1);
  const [isWorkflowLibraryOpen, setIsWorkflowLibraryOpen] = useState(true);
  const [isCreateWorkflowOpen, setIsCreateWorkflowOpen] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState({
    name: '',
    summary: '',
    workflowType: 'SDLC' as NonNullable<Workflow['workflowType']>,
    scope: 'CAPABILITY' as NonNullable<Workflow['scope']>,
  });
  const [nodeDraft, setNodeDraft] = useState<WorkflowNode | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<WorkflowEdge | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const selectedWorkflow = useMemo(
    () =>
      workflows.find(workflow => workflow.id === selectedWorkflowId) ||
      workflows[0] ||
      null,
    [selectedWorkflowId, workflows],
  );

  useEffect(() => {
    if (!selectedWorkflow && workflows[0]) {
      setSelectedWorkflowId(workflows[0].id);
      return;
    }

    if (!selectedWorkflowId && workflows[0]) {
      setSelectedWorkflowId(workflows[0].id);
    }
  }, [selectedWorkflow, selectedWorkflowId, workflows]);

  const nodes = selectedWorkflow ? getWorkflowNodes(selectedWorkflow) : [];
  const edges = selectedWorkflow ? getWorkflowEdges(selectedWorkflow) : [];
  const orderedNodeIds = selectedWorkflow ? getWorkflowNodeOrder(selectedWorkflow) : [];
  const orderedNodes = orderedNodeIds
    .map(nodeId => nodes.find(node => node.id === nodeId))
    .filter((node): node is WorkflowNode => Boolean(node));
  const selectedNode =
    selectedWorkflow && selectedNodeId
      ? getWorkflowNode(selectedWorkflow, selectedNodeId) || null
      : null;
  const selectedEdge =
    selectedWorkflow && selectedEdgeId
      ? edges.find(edge => edge.id === selectedEdgeId) || null
      : null;
  const validationState = selectedWorkflow
    ? getNodeValidationMessages(selectedWorkflow, selectedNodeId || undefined, selectedEdgeId || undefined)
    : { all: [], selected: [], nodeIdsWithErrors: new Set<string>() };
  const workflowSamplePath = selectedWorkflow ? getSamplePath(selectedWorkflow) : [];

  useEffect(() => {
    if (!selectedNode) {
      setNodeDraft(null);
      return;
    }
    setNodeDraft({ ...selectedNode });
  }, [selectedNode]);

  useEffect(() => {
    if (!selectedEdge) {
      setEdgeDraft(null);
      return;
    }
    setEdgeDraft({
      ...selectedEdge,
      artifactContract: selectedEdge.artifactContract
        ? { ...selectedEdge.artifactContract }
        : undefined,
    });
  }, [selectedEdge]);

  const persistWorkflows = (
    nextWorkflows: Workflow[],
    toastTitle: string,
    toastDescription?: string,
  ) => {
    setCapabilityWorkspaceContent(activeCapability.id, {
      workflows: nextWorkflows.map(workflow =>
        buildWorkflowFromGraph(normalizeWorkflowGraph(workflow)),
      ),
    });
    success(toastTitle, toastDescription);
  };

  const focusNodeOnCanvas = (nodeId: string) => {
    if (!selectedWorkflow || !canvasRef.current) {
      return;
    }

    const nextNode = getWorkflowNode(selectedWorkflow, nodeId);
    if (!nextNode) {
      return;
    }

    const nextNodeDimensions = getWorkflowNodeDimensions();
    canvasRef.current.scrollTo({
      left: Math.max(
        nextNode.layout.x * canvasScale -
          canvasRef.current.clientWidth / 2 +
          (nextNodeDimensions.width * canvasScale) / 2,
        0,
      ),
      top: Math.max(
        nextNode.layout.y * canvasScale -
          canvasRef.current.clientHeight / 2 +
          (nextNodeDimensions.height * canvasScale) / 2,
        0,
      ),
      behavior: 'smooth',
    });
  };

  const replaceSelectedWorkflow = (
    updater: (workflow: Workflow) => Workflow,
    toastTitle: string,
    toastDescription?: string,
  ) => {
    if (!selectedWorkflow) {
      return;
    }

    const nextWorkflow = buildWorkflowFromGraph(
      normalizeWorkflowGraph(updater(selectedWorkflow)),
    );

    const nextWorkflows = workflows.map(workflow =>
      workflow.id === nextWorkflow.id ? nextWorkflow : workflow,
    );
    persistWorkflows(nextWorkflows, toastTitle, toastDescription);
  };

  const handleCreateWorkflow = (event: React.FormEvent) => {
    event.preventDefault();
    if (!workflowDraft.name.trim()) {
      return;
    }

    const workflowId = createWorkflowId(activeCapability.id, workflowDraft.name);
    const startNodeId = `NODE-${slugify(activeCapability.id)}-${slugify(workflowDraft.name)}-START`;
    const endNodeId = `NODE-${slugify(activeCapability.id)}-${slugify(workflowDraft.name)}-END`;
    const nextWorkflow = buildWorkflowFromGraph(
      normalizeWorkflowGraph({
        id: workflowId,
        name: workflowDraft.name.trim(),
        capabilityId: activeCapability.id,
        status: 'BETA',
        workflowType: workflowDraft.workflowType,
        scope: workflowDraft.scope,
        summary: workflowDraft.summary.trim() || undefined,
        publishState: 'DRAFT',
        schemaVersion: 2,
        entryNodeId: startNodeId,
        nodes: [
          createWorkflowNode({
            id: startNodeId,
            name: 'Start',
            type: 'START',
            phase: 'ANALYSIS',
            layout: { x: 80, y: 48 },
          }),
          createWorkflowNode({
            id: endNodeId,
            name: 'End',
            type: 'END',
            phase: 'RELEASE',
            layout: { x: 340, y: 48 + 5 * 176 },
          }),
        ],
        edges: [
          createWorkflowEdge({
            fromNodeId: startNodeId,
            toNodeId: endNodeId,
            label: 'Complete without delivery',
          }),
        ],
        steps: [],
      }),
    );

    persistWorkflows(
      [...workflows, nextWorkflow],
      'Workflow created',
      `${nextWorkflow.name} is now available in ${activeCapability.name}.`,
    );
    setSelectedWorkflowId(nextWorkflow.id);
    setSelectedNodeId(startNodeId);
    setSelectedEdgeId(null);
    setIsCreateWorkflowOpen(false);
    setWorkflowDraft({
      name: '',
      summary: '',
      workflowType: 'SDLC',
      scope: 'CAPABILITY',
    });
  };

  const handleLoadStandardWorkflow = () => {
    const standardWorkflow = createStandardCapabilityWorkflow(activeCapability);
    const existingStandardIndex = workflows.findIndex(
      workflow => workflow.id === standardWorkflow.id,
    );
    const nextWorkflows =
      existingStandardIndex >= 0
        ? workflows.map(workflow =>
            workflow.id === standardWorkflow.id ? standardWorkflow : workflow,
          )
        : [...workflows, standardWorkflow];

    persistWorkflows(
      nextWorkflows,
      'Standard agent workflow loaded',
      'The enterprise SDLC graph is now available in the designer.',
    );
    setSelectedWorkflowId(standardWorkflow.id);
    setSelectedNodeId(standardWorkflow.entryNodeId || null);
  };

  const handleDuplicateWorkflow = (workflowToCopy: Workflow | null = selectedWorkflow) => {
    if (!workflowToCopy) {
      return;
    }

    const copyName = createCopyName(
      workflowToCopy.name,
      workflows.map(workflow => workflow.name),
    );
    const workflowId = (() => {
      const baseId = createWorkflowId(activeCapability.id, copyName);
      if (!workflows.some(workflow => workflow.id === baseId)) {
        return baseId;
      }

      let counter = 2;
      let candidate = `${baseId}-${counter}`;
      while (workflows.some(workflow => workflow.id === candidate)) {
        counter += 1;
        candidate = `${baseId}-${counter}`;
      }
      return candidate;
    })();

    const nodeIdMap = new Map<string, string>();
    (workflowToCopy.nodes || []).forEach(node => {
      nodeIdMap.set(node.id, createDesignerCopyId('NODE', `${copyName}-${node.name}`));
    });

    const copiedWorkflow = buildWorkflowFromGraph(
      normalizeWorkflowGraph({
        ...workflowToCopy,
        id: workflowId,
        name: copyName,
        status: 'BETA',
        publishState: 'DRAFT',
        summary: workflowToCopy.summary
          ? `Copy of ${workflowToCopy.summary}`
          : `Copy of ${workflowToCopy.name}`,
        entryNodeId: nodeIdMap.get(workflowToCopy.entryNodeId || '') || workflowToCopy.entryNodeId,
        nodes: (workflowToCopy.nodes || []).map(node => ({
          ...node,
          id: nodeIdMap.get(node.id) || node.id,
          layout: {
            x: node.layout.x + 48,
            y: node.layout.y + 32,
          },
          approverRoles: node.approverRoles ? [...node.approverRoles] : undefined,
          exitCriteria: node.exitCriteria ? [...node.exitCriteria] : undefined,
          allowedToolIds: node.allowedToolIds ? [...node.allowedToolIds] : undefined,
          etlConfig: node.etlConfig ? { ...node.etlConfig } : undefined,
        })),
        edges: (workflowToCopy.edges || []).map(edge => ({
          ...edge,
          id: createDesignerCopyId('EDGE', `${copyName}-${edge.label || edge.id}`),
          fromNodeId: nodeIdMap.get(edge.fromNodeId) || edge.fromNodeId,
          toNodeId: nodeIdMap.get(edge.toNodeId) || edge.toNodeId,
          artifactContract: edge.artifactContract
            ? {
                ...edge.artifactContract,
                requiredInputs: edge.artifactContract.requiredInputs
                  ? [...edge.artifactContract.requiredInputs]
                  : undefined,
                expectedOutputs: edge.artifactContract.expectedOutputs
                  ? [...edge.artifactContract.expectedOutputs]
                  : undefined,
              }
            : undefined,
        })),
        steps: [],
        handoffProtocols: [],
      }),
    );

    persistWorkflows(
      [...workflows, copiedWorkflow],
      'Workflow duplicated',
      `${workflowToCopy.name} was copied into ${copiedWorkflow.name}.`,
    );
    setSelectedWorkflowId(copiedWorkflow.id);
    setSelectedNodeId(copiedWorkflow.entryNodeId || copiedWorkflow.nodes?.[0]?.id || null);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
    cancelDragLink();
  };

  const handleValidateWorkflow = () => {
    if (!selectedWorkflow) {
      return;
    }
    const validation = validateWorkflowGraph(selectedWorkflow);
    if (!validation.valid) {
      warning(
        'Validation issues found',
        `${validation.errors.length} graph rules must be resolved before publishing.`,
      );
      return;
    }

    replaceSelectedWorkflow(
      workflow => ({ ...workflow, publishState: 'VALIDATED' }),
      'Workflow validated',
      `${selectedWorkflow.name} passed graph validation and is ready to publish.`,
    );
  };

  const handlePublishWorkflow = () => {
    if (!selectedWorkflow) {
      return;
    }
    const validation = validateWorkflowGraph(selectedWorkflow);
    if (!validation.valid) {
      warning(
        'Publish blocked',
        'Resolve workflow validation issues before publishing this flow.',
      );
      return;
    }

    replaceSelectedWorkflow(
      workflow => ({ ...workflow, publishState: 'PUBLISHED', status: 'STABLE' }),
      'Workflow published',
      `${selectedWorkflow.name} is now published for enterprise execution.`,
    );
  };

  const handleAutoLayout = () => {
    if (!selectedWorkflow) {
      return;
    }
    replaceSelectedWorkflow(
      workflow => autoLayoutWorkflowGraph(workflow),
      'Graph auto-layout applied',
      'The workflow lanes and branches were re-aligned for readability.',
    );
  };

  const handleExportWorkflow = () => {
    if (!selectedWorkflow) {
      return;
    }
    const blob = new Blob([JSON.stringify(selectedWorkflow, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selectedWorkflow.id.toLowerCase()}-graph.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    info('Workflow exported', `${selectedWorkflow.name} JSON was downloaded.`);
  };

  const handleCanvasDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!selectedWorkflow || !canvasRef.current) {
      return;
    }

    event.preventDefault();
    const moveNodeId = event.dataTransfer.getData('application/singularity-node-move');
    const nodeTemplate = event.dataTransfer.getData('application/singularity-node-template');
    const nextCoordinates = getDropCoordinates(event, canvasRef.current, canvasScale);

    if (moveNodeId) {
      replaceSelectedWorkflow(
        workflow => ({
          ...workflow,
          nodes: (workflow.nodes || []).map(node =>
            node.id === moveNodeId
              ? {
                  ...node,
                  layout: {
                    x: Math.max(nextCoordinates.x, 32),
                    y: Math.max(nextCoordinates.y, 24),
                  },
                }
              : node,
          ),
        }),
        'Node repositioned',
        'The graph layout was updated.',
      );
      return;
    }

    if (!nodeTemplate) {
      return;
    }

    const parsedTemplate = JSON.parse(nodeTemplate) as {
      type: WorkflowNodeType;
      phase: Exclude<WorkItemPhase, 'BACKLOG' | 'DONE'>;
      etlSubType?: string;
      label?: string;
    };
    const nextNode = createWorkflowNode({
      name:
        parsedTemplate.label ||
        NODE_TYPE_OPTIONS.find(option => option.type === parsedTemplate.type)?.label ||
        'New Node',
      type: parsedTemplate.type,
      phase: parsedTemplate.phase,
      layout: {
        x: Math.max(nextCoordinates.x, 32),
        y: Math.max(nextCoordinates.y, 24),
      },
      agentId:
        parsedTemplate.type === 'START' || parsedTemplate.type === 'END'
          ? undefined
          : workspace.agents[0]?.id,
      action:
        parsedTemplate.type === 'DELIVERY'
          ? 'Complete the assigned SDLC task and hand off evidence to the next step.'
          : parsedTemplate.type === 'DECISION'
          ? 'Evaluate completion criteria and route the work item to the right hand-off path.'
          : parsedTemplate.type === 'PARALLEL_SPLIT'
          ? 'Start multiple agent workstreams in parallel.'
          : parsedTemplate.type === 'PARALLEL_JOIN'
          ? 'Wait for the parallel workstreams and consolidate their outputs.'
          : parsedTemplate.type === 'GOVERNANCE_GATE'
          ? 'Check governance, risk, evidence, and policy requirements before continuing.'
          : parsedTemplate.type === 'HUMAN_APPROVAL'
          ? 'Pause for human review, clarification, or approval.'
          : parsedTemplate.type === 'RELEASE'
          ? 'Execute release or deployment work and capture completion evidence.'
          : isLegacyEtlNodeType(parsedTemplate.type)
          ? 'Legacy ETL step imported from an earlier workflow. Consider converting this to a delivery or governance step.'
          : 'Describe the work that happens in this node.',
      etlConfig: parsedTemplate.etlSubType ? { subType: parsedTemplate.etlSubType } : undefined,
    });

    replaceSelectedWorkflow(
      workflow => {
        const nextWorkflow = {
          ...workflow,
          nodes: [...(workflow.nodes || []), nextNode],
        };

        if (!connectFromNodeId) {
          return nextWorkflow;
        }

        return {
          ...nextWorkflow,
          edges: [
            ...(nextWorkflow.edges || []),
            createWorkflowEdge({
              fromNodeId: connectFromNodeId,
              toNodeId: nextNode.id,
              label: 'New branch',
              conditionType: 'DEFAULT',
            }),
          ],
        };
      },
      'Node added',
      connectFromNodeId
        ? 'A new node and graph connection were created.'
        : 'A new graph node was added to the workflow.',
    );
    setSelectedNodeId(nextNode.id);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
  };

  const handleConnectNodes = (targetNodeId: string) => {
    if (!selectedWorkflow || !connectFromNodeId || connectFromNodeId === targetNodeId) {
      return;
    }

    const duplicateEdge = edges.some(
      edge => edge.fromNodeId === connectFromNodeId && edge.toNodeId === targetNodeId,
    );
    if (duplicateEdge) {
      warning('Connection already exists', 'This node path is already defined.');
      setConnectFromNodeId(null);
      return;
    }

    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        edges: [
          ...(workflow.edges || []),
          createWorkflowEdge({
            fromNodeId: connectFromNodeId,
            toNodeId: targetNodeId,
            label: 'Transition',
            conditionType: 'DEFAULT',
          }),
        ],
      }),
      'Nodes connected',
      'A new workflow transition was created.',
    );
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
  };

  const cancelDragLink = () => {
    setDragLinkFromNodeId(null);
    setDragLinkPosition(null);
  };

  const handleStartDragLink = (
    event: React.MouseEvent<HTMLButtonElement>,
    nodeId: string,
  ) => {
    if (!canvasRef.current) {
      return;
    }

    event.stopPropagation();
    const nextPoint = getCanvasPointFromMouse(
      event.clientX,
      event.clientY,
      canvasRef.current,
      canvasScale,
    );
    setDragLinkFromNodeId(nodeId);
    setDragLinkPosition(nextPoint);
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
  };

  const handleCompleteDragLink = (
    event: React.MouseEvent<HTMLButtonElement>,
    targetNodeId: string,
  ) => {
    event.stopPropagation();
    if (!selectedWorkflow || !dragLinkFromNodeId || dragLinkFromNodeId === targetNodeId) {
      cancelDragLink();
      return;
    }

    const duplicateEdge = edges.some(
      edge => edge.fromNodeId === dragLinkFromNodeId && edge.toNodeId === targetNodeId,
    );
    if (duplicateEdge) {
      warning('Connection already exists', 'This node path is already defined.');
      cancelDragLink();
      return;
    }

    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        edges: [
          ...(workflow.edges || []),
          createWorkflowEdge({
            fromNodeId: dragLinkFromNodeId,
            toNodeId: targetNodeId,
            label: 'Transition',
            conditionType: 'DEFAULT',
          }),
        ],
      }),
      'Nodes connected',
      'A new workflow transition was created.',
    );
    setSelectedEdgeId(null);
    cancelDragLink();
  };

  const handleApplyNodeDraft = () => {
    if (!selectedWorkflow || !selectedNode || !nodeDraft) {
      return;
    }

    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        nodes: (workflow.nodes || []).map(node =>
          node.id === selectedNode.id ? nodeDraft : node,
        ),
      }),
      'Node updated',
      `${nodeDraft.name} was updated in the workflow graph.`,
    );
  };

  const handleApplyEdgeDraft = () => {
    if (!selectedWorkflow || !selectedEdge || !edgeDraft) {
      return;
    }

    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        edges: (workflow.edges || []).map(edge =>
          edge.id === selectedEdge.id ? edgeDraft : edge,
        ),
      }),
      'Transition updated',
      'The hand-off rule and branch metadata were saved.',
    );
  };

  const handleDeleteSelectedNode = () => {
    if (!selectedWorkflow || !selectedNode) {
      return;
    }
    if (selectedNode.type === 'START') {
      warning('Start node locked', 'The START node cannot be removed from the workflow.');
      return;
    }

    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        nodes: (workflow.nodes || []).filter(node => node.id !== selectedNode.id),
        edges: (workflow.edges || []).filter(
          edge => edge.fromNodeId !== selectedNode.id && edge.toNodeId !== selectedNode.id,
        ),
      }),
      'Node removed',
      `${selectedNode.name} and its transitions were removed from the graph.`,
    );
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
  };

  const handleDeleteSelectedEdge = () => {
    if (!selectedWorkflow || !selectedEdge) {
      return;
    }
    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        edges: (workflow.edges || []).filter(edge => edge.id !== selectedEdge.id),
      }),
      'Transition removed',
      'The selected graph transition was removed.',
    );
    setSelectedEdgeId(null);
  };

  const handleDuplicateSelectedNode = () => {
    if (!selectedWorkflow || !selectedNode) {
      return;
    }

    if (selectedNode.type === 'START') {
      warning(
        'Start node locked',
        'Duplicate the workflow if you want another template starting point. The START node stays unique inside a graph.',
      );
      return;
    }

    const duplicatedNode = createWorkflowNode({
      ...selectedNode,
      id: createDesignerCopyId('NODE', `${selectedNode.name}-copy`),
      name: createCopyName(
        selectedNode.name,
        nodes.filter(node => node.phase === selectedNode.phase).map(node => node.name),
      ),
      layout: {
        x: selectedNode.layout.x + 52,
        y: selectedNode.layout.y + 28,
      },
      approverRoles: selectedNode.approverRoles ? [...selectedNode.approverRoles] : undefined,
      exitCriteria: selectedNode.exitCriteria ? [...selectedNode.exitCriteria] : undefined,
      allowedToolIds: selectedNode.allowedToolIds ? [...selectedNode.allowedToolIds] : undefined,
      etlConfig: selectedNode.etlConfig ? { ...selectedNode.etlConfig } : undefined,
    });

    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        nodes: [...(workflow.nodes || []), duplicatedNode],
      }),
      'Node duplicated',
      `${selectedNode.name} was copied for faster graph editing.`,
    );
    setSelectedNodeId(duplicatedNode.id);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
    cancelDragLink();
    setTimeout(() => focusNodeOnCanvas(duplicatedNode.id), 0);
  };

  const publishState = selectedWorkflow
    ? getWorkflowPublishState(selectedWorkflow)
    : 'DRAFT';
  const nodeDimensions = getWorkflowNodeDimensions();
  const visibleNodeCount = orderedNodes.filter(node => isVisibleWorkflowNode(node.type)).length;
  const controlNodeCount = orderedNodes.length - visibleNodeCount;
  const laneSummaries = WORKFLOW_GRAPH_PHASES.map(phase => ({
    phase,
    count: orderedNodes.filter(node => node.phase === phase).length,
  }));
  const nodeCoordinates = orderedNodes.map(node => ({
    x: node.layout.x,
    y: node.layout.y,
  }));
  const graphWidth = nodeCoordinates.length
    ? Math.max(...nodeCoordinates.map(point => point.x)) + nodeDimensions.width + 120
    : 1200;
  const graphHeight = nodeCoordinates.length
    ? Math.max(...nodeCoordinates.map(point => point.y)) + nodeDimensions.height + 120
    : 920;
  const minimapScale = Math.min(0.14, 180 / Math.max(graphWidth, graphHeight));
  const dragLinkFromNode =
    selectedWorkflow && dragLinkFromNodeId
      ? getWorkflowNode(selectedWorkflow, dragLinkFromNodeId)
      : null;
  const dragLinkStart = dragLinkFromNode
    ? {
        x: dragLinkFromNode.layout.x + nodeDimensions.width,
        y: dragLinkFromNode.layout.y + nodeDimensions.height / 2,
      }
    : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-3xl border border-outline-variant/50 bg-white/70 px-5 py-4 shadow-[0_10px_30px_rgba(12,23,39,0.04)] backdrop-blur xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="brand">Agent Workflow Studio</StatusBadge>
            <span className="page-context">{activeCapability.id}</span>
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-on-surface">
              {selectedWorkflow ? selectedWorkflow.name : `${activeCapability.name} Workflow Designer`}
            </h1>
            <p className="max-w-4xl text-sm leading-relaxed text-secondary">
              Design agent-led SDLC workflows with clear ownership, hand-offs, approvals, artifacts, and release stages.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={PUBLISH_STATE_TONE[publishState]}>{publishState}</StatusBadge>
            {selectedWorkflow ? (
              <StatusBadge tone="info">{getWorkflowNodes(selectedWorkflow).length} nodes</StatusBadge>
            ) : null}
            {selectedWorkflow ? (
              <StatusBadge tone="neutral">{getWorkflowEdges(selectedWorkflow).length} transitions</StatusBadge>
            ) : null}
            {selectedWorkflow ? (
              <StatusBadge tone="brand">{visibleNodeCount} runtime nodes</StatusBadge>
            ) : null}
            {dragLinkFromNode ? (
              <StatusBadge tone="warning">Hand-off from {dragLinkFromNode.name}</StatusBadge>
            ) : null}
            {connectFromNodeId ? (
              <StatusBadge tone="warning">
                Manual hand-off mode from {getWorkflowNode(selectedWorkflow!, connectFromNodeId)?.name}
              </StatusBadge>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePublishWorkflow}
            className="enterprise-button enterprise-button-primary"
          >
            <Play size={16} />
            Publish
          </button>
          <button
            type="button"
            onClick={() => setIsCreateWorkflowOpen(true)}
            className="enterprise-button enterprise-button-secondary"
          >
            <Plus size={16} />
            New Workflow
          </button>
        </div>
      </div>

      {!selectedWorkflow ? (
        <SectionCard
          title="No workflow graph yet"
          description="Start with the standard SDLC template or create a new agent workflow from scratch."
          icon={WorkflowIcon}
        >
          <EmptyState
            title="Build your first agent workflow"
            description="Create a graph-based workflow with SDLC lanes, branching decisions, parallel agent tracks, governance pauses, and hand-off contracts."
            icon={WorkflowIcon}
            action={
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleLoadStandardWorkflow}
                  className="enterprise-button enterprise-button-primary"
                >
                  <Sparkles size={16} />
                  Load Standard SDLC
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateWorkflowOpen(true)}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Plus size={16} />
                  Create Workflow
                </button>
              </div>
            }
          />
        </SectionCard>
      ) : (
        <div className="designer-studio-shell">
          <div className="designer-studio-topbar">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="brand">{selectedWorkflow.workflowType || 'Custom'}</StatusBadge>
                <StatusBadge tone="neutral">{selectedWorkflow.scope || 'CAPABILITY'}</StatusBadge>
                {validationState.all.length > 0 ? (
                  <StatusBadge tone="warning">
                    {validationState.all.length} validation issue{validationState.all.length > 1 ? 's' : ''}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="success">Graph valid</StatusBadge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/70 px-2.5 py-1">
                  <Route size={14} />
                  {getWorkflowEdges(selectedWorkflow).length} hand-offs
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/70 px-2.5 py-1">
                  <WorkflowIcon size={14} />
                  {WORKFLOW_GRAPH_PHASES.length} SDLC lanes
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/70 px-2.5 py-1">
                  <ShieldCheck size={14} />
                  Agent, hand-off, and approval design
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="designer-studio-toolbar">
                <button
                  type="button"
                  onClick={handleValidateWorkflow}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  <ScanLine size={16} />
                  Validate
                </button>
                <button
                  type="button"
                  onClick={handleAutoLayout}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  <LayoutTemplate size={16} />
                  Auto-layout
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasScale(1)}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  <Route size={16} />
                  Fit
                </button>
                <button
                  type="button"
                  onClick={handleLoadStandardWorkflow}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  <Sparkles size={16} />
                  Load Standard SDLC
                </button>
                <button
                  type="button"
                  onClick={handleExportWorkflow}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  <Download size={16} />
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => handleDuplicateWorkflow()}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  <Copy size={16} />
                  Duplicate
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-0 xl:grid-cols-[19rem,minmax(0,1fr),23rem]">
            <aside className="border-b border-slate-800/80 bg-slate-950/55 xl:border-b-0 xl:border-r">
              <div className="designer-widget-stack">
                <section className="designer-widget">
                  <div className="designer-widget-header">
                    <div>
                      <p className="designer-widget-kicker">Node Widget</p>
                      <div className="mt-2 flex items-center gap-2">
                        <WorkflowIcon size={15} className="text-sky-300" />
                        <p className="text-sm font-semibold text-white">Agent Step Kit</p>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        Drag workflow steps into the canvas. Use delivery, decision, approval, governance, and release nodes to design agent execution paths.
                      </p>
                    </div>
                    <div className="designer-widget-toolbar">
                      <button
                        type="button"
                        onClick={handleDuplicateSelectedNode}
                        className="designer-widget-action"
                      >
                        <Copy size={14} />
                        Copy node
                      </button>
                      <button
                        type="button"
                        title={connectFromNodeId ? 'Cancel hand-off mode' : 'Fallback hand-off mode'}
                        onClick={() => {
                          if (connectFromNodeId) {
                            setConnectFromNodeId(null);
                          } else if (selectedNodeId) {
                            setConnectFromNodeId(selectedNodeId);
                          }
                        }}
                        className={cn(
                          'designer-widget-action',
                          connectFromNodeId && 'border-emerald-400/40 bg-emerald-500/15 text-white',
                        )}
                      >
                        <Route size={14} />
                        {connectFromNodeId ? 'Cancel hand-off' : 'Hand-off mode'}
                      </button>
                    </div>
                  </div>
                  <div className="designer-widget-body space-y-4">
                    {AGENT_NODE_GROUPS.map(group => (
                      <div
                        key={group.title}
                        className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-500">
                              {group.title}
                            </p>
                            <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-400">
                              {group.description}
                            </p>
                          </div>
                          <StatusBadge tone="neutral">{phaseLabel(group.phase)}</StatusBadge>
                        </div>
                        <div className="mt-4 grid gap-2">
                          {group.items.map(item => {
                            const Icon = getNodeIcon(item.type);
                            const optionDesc = NODE_TYPE_OPTIONS.find(o => o.type === item.type)?.description || '';
                            return (
                              <button
                                key={`${item.type}-${item.label}`}
                                type="button"
                                draggable
                                title={`Drag ${item.label} to canvas`}
                                onDragStart={event => {
                                  event.dataTransfer.setData(
                                    'application/singularity-node-template',
                                    JSON.stringify({
                                      type: item.type,
                                      phase: item.defaultPhase,
                                      label: item.label,
                                    }),
                                  );
                                }}
                                className="group flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/75 px-3 py-3 text-left transition hover:border-sky-500/30 hover:bg-slate-900"
                              >
                                <span
                                  className={cn(
                                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition',
                                    NODE_TYPE_TONE[item.type],
                                  )}
                                >
                                  <Icon size={16} />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-white">
                                    {item.label}
                                  </span>
                                  <span className="mt-1 block text-[0.6875rem] leading-relaxed text-slate-400">
                                    {optionDesc}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="designer-widget">
                  <div className="designer-widget-header">
                    <div>
                      <p className="designer-widget-kicker">Tree Widget</p>
                      <div className="mt-2 flex items-center gap-2">
                        <PanelLeft size={15} className="text-sky-300" />
                        <p className="text-sm font-semibold text-white">Workflow Tree</p>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">
                        Browse the workflow by SDLC phase and jump straight to the selected agent step.
                      </p>
                    </div>
                    <div className="designer-widget-toolbar">
                      <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-[0.6875rem] font-semibold text-slate-300">
                        {orderedNodes.length} nodes
                      </div>
                    </div>
                  </div>
                  <div className="designer-widget-body">
                    <div className="space-y-3">
                      {laneSummaries.map(({ phase, count }) => (
                        <div key={phase} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-500">
                              {phaseLabel(phase)}
                            </p>
                            <span className="rounded-full border border-slate-800 bg-slate-950/80 px-2 py-1 text-[0.625rem] font-bold text-slate-400">
                              {count}
                            </span>
                          </div>
                          {orderedNodes
                            .filter(node => node.phase === phase)
                            .map(node => (
                              <button
                                key={node.id}
                                type="button"
                                onClick={() => {
                                  setSelectedNodeId(node.id);
                                  setSelectedEdgeId(null);
                                  focusNodeOnCanvas(node.id);
                                }}
                                className={cn(
                                  'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition',
                                  selectedNodeId === node.id
                                    ? 'bg-sky-500/15 text-sky-100'
                                    : 'text-slate-200 hover:bg-slate-950 hover:text-white',
                                )}
                              >
                                <span className="truncate text-sm font-medium">
                                  {node.name}
                                </span>
                                <ArrowRight size={13} className="shrink-0 text-slate-500" />
                              </button>
                            ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </aside>

            <main className="min-w-0 border-b border-slate-800/80 bg-slate-950/25 xl:border-b-0 xl:border-r">
              <div className="border-b border-slate-800/80 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="brand">{selectedWorkflow.workflowType || 'Custom'}</StatusBadge>
                      <StatusBadge tone="neutral">{selectedWorkflow.scope || 'CAPABILITY'}</StatusBadge>
                      {validationState.all.length > 0 ? (
                        <StatusBadge tone="warning">
                          {validationState.all.length} validation issue{validationState.all.length > 1 ? 's' : ''}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="success">Graph valid</StatusBadge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/70 px-2.5 py-1">
                        <Route size={14} />
                        {getWorkflowEdges(selectedWorkflow).length} hand-offs
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/70 px-2.5 py-1">
                        <PanelLeft size={14} />
                        {WORKFLOW_GRAPH_PHASES.length} SDLC lanes
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/70 px-2.5 py-1">
                        <GitBranch size={14} />
                        Agent steps + hand-offs
                      </span>
                    </div>
                  </div>
                  <Toolbar className="gap-2 border-slate-800/80 bg-slate-900/70 p-1 shadow-none">
                    <button
                      type="button"
                      onClick={() => setCanvasScale(value => Math.max(0.7, Number((value - 0.1).toFixed(1))))}
                      className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                    >
                      -
                    </button>
                    <span className="min-w-[3rem] text-center text-xs font-semibold text-slate-300">
                      {Math.round(canvasScale * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setCanvasScale(value => Math.min(1.4, Number((value + 0.1).toFixed(1))))}
                      className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
                    >
                      +
                    </button>
                  </Toolbar>
                </div>
              </div>

              <div className="px-5 py-5">
                <div
                  ref={canvasRef}
                  className="designer-canvas-shell relative h-[calc(100vh-23rem)] min-h-[44rem]"
                  onDragOver={event => event.preventDefault()}
                  onDrop={handleCanvasDrop}
                  onMouseMove={event => {
                    if (!dragLinkFromNodeId || !canvasRef.current) {
                      return;
                    }
                    setDragLinkPosition(
                      getCanvasPointFromMouse(
                        event.clientX,
                        event.clientY,
                        canvasRef.current,
                        canvasScale,
                      ),
                    );
                  }}
                  onMouseUp={() => {
                    if (dragLinkFromNodeId) {
                      cancelDragLink();
                    }
                  }}
                >
                  <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2">
                    <div className="rounded-full border border-slate-700 bg-slate-950/90 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-300">
                      Designer
                    </div>
                    <div className="rounded-full border border-slate-700 bg-slate-950/90 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-400">
                      Agent workflow canvas
                    </div>
                  </div>
                  <div className="absolute left-4 top-16 z-20 pointer-events-auto">
                    <div className="designer-floating-widget">
                      <div className="designer-floating-widget-header">
                        <div>
                          <p className="designer-widget-kicker">Canvas Widget</p>
                          <div className="mt-2 flex items-center gap-2">
                            <WorkflowIcon size={15} className="text-sky-300" />
                            <p className="text-sm font-semibold text-white">Workflow Library</p>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">
                            Keep workflow copies and variants inside the canvas, like a floating studio library.
                          </p>
                        </div>
                        <div className="designer-widget-toolbar">
                          <button
                            type="button"
                            onClick={() => setIsWorkflowLibraryOpen(current => !current)}
                            className="designer-widget-action"
                          >
                            {isWorkflowLibraryOpen ? 'Collapse' : 'Open'}
                          </button>
                        </div>
                      </div>

                      {isWorkflowLibraryOpen ? (
                        <div className="designer-floating-widget-body">
                          <div className="mb-3 grid grid-cols-2 gap-2">
                            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
                              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-500">
                                Runtime
                              </p>
                              <p className="mt-2 text-lg font-bold text-white">{visibleNodeCount}</p>
                            </div>
                            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
                              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-500">
                                Control
                              </p>
                              <p className="mt-2 text-lg font-bold text-white">{controlNodeCount}</p>
                            </div>
                          </div>
                          <div className="mb-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setIsCreateWorkflowOpen(true)}
                              className="designer-widget-action"
                            >
                              <Plus size={14} />
                              New
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateWorkflow()}
                              className="designer-widget-action"
                            >
                              <Copy size={14} />
                              Copy
                            </button>
                          </div>
                          <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                            {workflows.map(workflow => (
                              <div
                                key={workflow.id}
                                className={cn(
                                  'rounded-2xl border px-4 py-3 transition',
                                  selectedWorkflow.id === workflow.id
                                    ? 'border-sky-400/40 bg-sky-500/15 text-white shadow-[0_10px_26px_rgba(56,189,248,0.12)]'
                                    : 'border-slate-800 bg-slate-900/60 text-slate-200 hover:border-slate-600 hover:bg-slate-900',
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedWorkflowId(workflow.id);
                                      setSelectedNodeId(null);
                                      setSelectedEdgeId(null);
                                      setConnectFromNodeId(null);
                                      cancelDragLink();
                                    }}
                                    className="min-w-0 flex-1 text-left"
                                  >
                                    <p className="truncate text-sm font-semibold">{workflow.name}</p>
                                    <p className="mt-1 text-[0.6875rem] text-slate-400">
                                      {workflow.workflowType || 'Custom'} · {workflow.steps.length} projected steps
                                    </p>
                                  </button>
                                  <button
                                    type="button"
                                    title={`Duplicate ${workflow.name}`}
                                    onClick={() => handleDuplicateWorkflow(workflow)}
                                    className="rounded-xl border border-slate-700 bg-slate-950/80 p-2 text-slate-300 transition hover:border-sky-400/40 hover:text-white"
                                  >
                                    <Copy size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div
                    className="relative min-h-[72rem] min-w-[96rem] origin-top-left"
                    style={{ transform: `scale(${canvasScale})`, transformOrigin: 'top left' }}
                  >
                    {WORKFLOW_GRAPH_PHASES.map((phase, index) => (
                      <div
                        key={phase}
                        className="pointer-events-none absolute left-0 right-0 border-b border-dashed border-slate-700/70"
                        style={{
                          top: 24 + index * 176,
                          height: 176,
                        }}
                      >
                        <div className="sticky left-0 top-0 inline-flex rounded-r-full border border-slate-700 bg-slate-900/95 px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-slate-200 shadow-sm">
                          {phaseLabel(phase)}
                        </div>
                      </div>
                    ))}

                    <svg className="absolute inset-0 h-full w-full overflow-visible">
                      {edges.map(edge => {
                        const fromNode = getWorkflowNode(selectedWorkflow, edge.fromNodeId);
                        const toNode = getWorkflowNode(selectedWorkflow, edge.toNodeId);
                        if (!fromNode || !toNode) {
                          return null;
                        }
                        const isSelected = selectedEdgeId === edge.id;
                        const midX = (fromNode.layout.x + toNode.layout.x + nodeDimensions.width) / 2;
                        const midY = (fromNode.layout.y + toNode.layout.y) / 2 + nodeDimensions.height / 2;

                        return (
                          <g
                            key={edge.id}
                            className="cursor-pointer"
                            onClick={event => {
                              event.stopPropagation();
                              setSelectedEdgeId(edge.id);
                              setSelectedNodeId(null);
                              setConnectFromNodeId(null);
                            }}
                          >
                            <path
                              d={getEdgePath(fromNode, toNode)}
                              fill="none"
                              stroke={isSelected ? '#38bdf8' : '#64748b'}
                              strokeWidth={isSelected ? 3 : 2}
                              strokeDasharray={edge.conditionType === 'PARALLEL' ? '8 7' : undefined}
                            />
                            <circle cx={fromNode.layout.x + nodeDimensions.width} cy={fromNode.layout.y + nodeDimensions.height / 2} r="4" fill={isSelected ? '#38bdf8' : '#64748b'} />
                            <circle cx={toNode.layout.x} cy={toNode.layout.y + nodeDimensions.height / 2} r="4" fill={isSelected ? '#38bdf8' : '#64748b'} />
                            <foreignObject x={midX - 96} y={midY - 18} width={192} height={40}>
                              <div
                                className={cn(
                                  'inline-flex w-full items-center justify-center rounded-full border px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] shadow-sm backdrop-blur',
                                  isSelected
                                    ? 'border-sky-400/60 bg-sky-500/20 text-sky-100'
                                    : 'border-slate-600 bg-slate-900/90 text-slate-200',
                                )}
                              >
                                {edge.label || edge.conditionType}
                              </div>
                            </foreignObject>
                          </g>
                        );
                      })}

                      {dragLinkStart && dragLinkPosition ? (
                        <path
                          d={`M ${dragLinkStart.x} ${dragLinkStart.y} C ${dragLinkStart.x + 70} ${dragLinkStart.y}, ${dragLinkPosition.x - 70} ${dragLinkPosition.y}, ${dragLinkPosition.x} ${dragLinkPosition.y}`}
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth={3}
                          strokeDasharray="8 6"
                        />
                      ) : null}
                    </svg>

                    {orderedNodes.map(node => {
                      const Icon = getNodeIcon(node.type, node.etlConfig?.subType);
                      const isSelected = selectedNodeId === node.id;
                      const isConnectTarget =
                        Boolean(connectFromNodeId) && connectFromNodeId !== node.id;
                      const isPortTarget =
                        Boolean(dragLinkFromNodeId) && dragLinkFromNodeId !== node.id;

                      return (
                        <div
                          key={node.id}
                          draggable
                          onDragStart={event => {
                            event.dataTransfer.setData(
                              'application/singularity-node-move',
                              node.id,
                            );
                          }}
                          onClick={() => {
                            if (connectFromNodeId && connectFromNodeId !== node.id) {
                              handleConnectNodes(node.id);
                              return;
                            }
                            setSelectedNodeId(node.id);
                            setSelectedEdgeId(null);
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedNodeId(node.id);
                              setSelectedEdgeId(null);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            'designer-node-card',
                            isSelected && 'border-sky-400 ring-2 ring-sky-300/60',
                            isConnectTarget && 'border-emerald-300 ring-2 ring-emerald-200/80',
                            validationState.nodeIdsWithErrors.has(node.id) &&
                              'border-red-300 ring-2 ring-red-200/60',
                          )}
                          style={{
                            left: node.layout.x,
                            top: node.layout.y,
                            minHeight: nodeDimensions.height,
                          }}
                        >
                            <button
                              type="button"
                              onMouseUp={event => handleCompleteDragLink(event, node.id)}
                              onClick={event => event.stopPropagation()}
                            className={cn(
                              'designer-node-port designer-node-port-input',
                              isPortTarget && 'designer-node-port-target',
                            )}
                            title={`Connect into ${node.name}`}
                          />
                          <button
                            type="button"
                            onMouseDown={event => handleStartDragLink(event, node.id)}
                            onClick={event => event.stopPropagation()}
                            className={cn(
                              'designer-node-port designer-node-port-output',
                              dragLinkFromNodeId === node.id && 'designer-node-port-active',
                            )}
                            title={`Start link from ${node.name}`}
                          />
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={cn(
                                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                                NODE_TYPE_TONE[node.type],
                              )}>
                                <Icon size={16} />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-on-surface">
                                  {node.name}
                                </p>
                                <p className="text-[0.6875rem] text-secondary">
                                  {phaseLabel(node.phase)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <StatusBadge tone={isVisibleWorkflowNode(node.type) ? 'brand' : 'neutral'}>
                              {getNodeTypeLabel(node.type)}
                            </StatusBadge>
                            {node.agentId ? (
                              <span className="truncate text-[0.6875rem] font-medium text-outline">
                                {workspace.agents.find(agent => agent.id === node.agentId)?.name || node.agentId}
                              </span>
                            ) : isLegacyEtlNodeType(node.type) ? (
                              <span className="truncate text-[0.6875rem] font-medium text-outline">
                                Legacy ETL node
                              </span>
                            ) : null}
                          </div>

                          <p className="line-clamp-2 text-xs leading-relaxed text-secondary">
                            {node.description || node.action || 'No node guidance yet.'}
                          </p>

                          <div className="mt-auto flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-[0.6875rem] text-outline">
                              <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
                              in
                              <span className="ml-2 h-2.5 w-2.5 rounded-full bg-primary" />
                              out
                            </div>
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation();
                                setConnectFromNodeId(node.id);
                                setSelectedNodeId(node.id);
                                setSelectedEdgeId(null);
                              }}
                              className="rounded-xl border border-outline-variant/30 px-3 py-1.5 text-[0.6875rem] font-semibold text-secondary transition hover:bg-surface-container-low"
                            >
                              Hand-off
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="designer-minimap">
                    <div className="mb-2 flex items-center justify-between gap-4">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-400">
                        Minimap
                      </p>
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-slate-500">
                        {Math.round(canvasScale * 100)}%
                      </p>
                    </div>
                    <div
                      className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/80"
                      style={{
                        width: Math.max(graphWidth * minimapScale, 120),
                        height: Math.max(graphHeight * minimapScale, 88),
                      }}
                    >
                      {orderedNodes.map(node => (
                        <div
                          key={`mini-${node.id}`}
                          className={cn(
                            'absolute rounded-sm border',
                            selectedNodeId === node.id
                              ? 'border-sky-300 bg-sky-400/60'
                              : 'border-slate-500 bg-slate-300/30',
                          )}
                          style={{
                            left: node.layout.x * minimapScale,
                            top: node.layout.y * minimapScale,
                            width: nodeDimensions.width * minimapScale,
                            height: Math.max(nodeDimensions.height * minimapScale, 6),
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="designer-utility-dock">
                  <div className="designer-panel-card px-4 py-4">
                    <div className="flex items-center gap-2">
                      <WorkflowIcon size={16} className="text-sky-300" />
                      <p className="text-sm font-semibold text-white">Execution Path</p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {workflowSamplePath.length ? (
                        workflowSamplePath.map((step, index) => (
                          <React.Fragment key={`${step.label}-${index}`}>
                            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 px-3 py-2 shadow-sm">
                              <p className="text-xs font-semibold text-white">{step.label}</p>
                              {step.note ? (
                                <p className="mt-1 text-[0.6875rem] text-slate-400">{step.note}</p>
                              ) : null}
                            </div>
                            {index < workflowSamplePath.length - 1 ? (
                              <ArrowRight size={14} className="text-slate-500" />
                            ) : null}
                          </React.Fragment>
                        ))
                      ) : (
                        <p className="text-sm text-slate-400">
                          Add nodes and transitions to preview a sample execution path.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="designer-panel-card px-4 py-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-sky-300" />
                      <p className="text-sm font-semibold text-white">Validation</p>
                    </div>
                    <div className="mt-4 space-y-2">
                      {validationState.all.length ? (
                        validationState.all.map(error => (
                          <div
                            key={error.id}
                            className="rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-3 text-xs leading-relaxed text-red-100"
                          >
                            {error.message}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-400">
                          START, END, branching, join, and governance checks are all passing.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </main>

            <aside className="designer-inspector-shell">
              <div className="sticky top-0 z-10 border-b border-slate-800/80 bg-white/96 px-5 py-4 backdrop-blur">
                <div className="flex items-center gap-2">
                  <Wrench size={16} className="text-primary" />
                  <p className="text-sm font-semibold text-on-surface">Inspector</p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-secondary">
                  Configure agent ownership, runtime controls, hand-off rules, artifact expectations, and approvals for the selected graph element.
                </p>
              </div>
              <div className="h-[calc(100vh-24rem)] min-h-[46rem] overflow-y-auto p-5">
            <SectionCard
            title="Properties"
            description="Use this dock to configure workflow metadata, execution policy, and hand-off behavior."
            icon={Wrench}
            className="border-outline-variant/40 shadow-none"
          >
            {selectedNode && nodeDraft ? (
              <FormSection
                title="Node Configuration"
                description="Configure the selected graph node."
                icon={WorkflowIcon}
                action={
                  <button
                    type="button"
                    onClick={handleDeleteSelectedNode}
                    className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                  >
                    Delete
                  </button>
                }
              >
                <div className="grid gap-4">
                  <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      General
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      Core node identity, type, phase, and assignment.
                    </p>
                  </div>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Name</span>
                    <input
                      value={nodeDraft.name}
                      onChange={event =>
                        setNodeDraft(current => (current ? { ...current, name: event.target.value } : current))
                      }
                      className="enterprise-input"
                    />
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Node Type</span>
                    <select
                      value={nodeDraft.type}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                type: event.target.value as WorkflowNodeType,
                              }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    >
                      {NODE_TYPE_OPTIONS.map(option => (
                        <option key={option.type} value={option.type}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Phase Lane</span>
                    <select
                      value={nodeDraft.phase}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                phase: event.target.value as WorkItemPhase,
                              }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    >
                      {WORKFLOW_GRAPH_PHASES.map(phase => (
                        <option key={phase} value={phase}>
                          {phaseLabel(phase)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Assigned Agent</span>
                    <select
                      value={nodeDraft.agentId || ''}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                agentId: event.target.value || undefined,
                              }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    >
                      <option value="">Control node</option>
                      {workspace.agents.map(agent => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Action</span>
                    <input
                      value={nodeDraft.action || ''}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                action: event.target.value,
                              }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    />
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Description</span>
                    <textarea
                      rows={4}
                      value={nodeDraft.description || ''}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                description: event.target.value,
                              }
                            : current,
                        )
                      }
                      className="enterprise-input min-h-[7rem]"
                    />
                  </label>

                  {isLegacyEtlNodeType(nodeDraft.type) ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                      This node came from a legacy ETL-style workflow. It can still be kept for compatibility, but this designer is now optimized for agent workflows. If you want a clean agent model, change the node type to a delivery, decision, governance, approval, or release step.
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Artifacts & Exit
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      Capture the evidence produced by this step and the conditions needed before hand-off.
                    </p>
                  </div>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Input Artifact Id</span>
                    <input
                      value={nodeDraft.inputArtifactId || ''}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                inputArtifactId: event.target.value || undefined,
                              }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    />
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Output Artifact Id</span>
                    <input
                      value={nodeDraft.outputArtifactId || ''}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                outputArtifactId: event.target.value || undefined,
                              }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    />
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Exit Criteria</span>
                    <textarea
                      rows={4}
                      value={(nodeDraft.exitCriteria || []).join('\n')}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                exitCriteria: event.target.value
                                  .split('\n')
                                  .map(value => value.trim())
                                  .filter(Boolean),
                              }
                            : current,
                        )
                      }
                      placeholder="Artifact drafted&#10;Peer review complete&#10;Ready for next hand-off"
                      className="enterprise-input min-h-[7rem]"
                    />
                  </label>

                  <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Approvals
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      Roles and governance expectations for this node.
                    </p>
                  </div>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Approver Roles</span>
                    <input
                      value={(nodeDraft.approverRoles || []).join(', ')}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                approverRoles: event.target.value
                                  .split(',')
                                  .map(value => value.trim())
                                  .filter(Boolean),
                              }
                            : current,
                        )
                      }
                      placeholder="Development Manager, Team Lead"
                      className="enterprise-input"
                    />
                  </label>
                  <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Runtime
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      Tooling and execution guidance used during automated runs.
                    </p>
                  </div>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Allowed Tools</span>
                    <select
                      multiple
                      value={nodeDraft.allowedToolIds || []}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                allowedToolIds: Array.from(event.target.selectedOptions).map(
                                  (option: HTMLOptionElement) =>
                                    option.value as ToolAdapterId,
                                ),
                              }
                            : current,
                        )
                      }
                      className="enterprise-input min-h-[9rem]"
                    >
                      {TOOL_OPTIONS.map(toolId => (
                        <option key={toolId} value={toolId}>
                          {toolId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Execution Notes</span>
                    <textarea
                      rows={4}
                      value={nodeDraft.executionNotes || ''}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                executionNotes: event.target.value,
                              }
                            : current,
                        )
                      }
                      className="enterprise-input min-h-[7rem]"
                    />
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Preferred Workspace Path</span>
                    <input
                      value={nodeDraft.preferredWorkspacePath || ''}
                      onChange={event =>
                        setNodeDraft(current =>
                          current
                            ? {
                                ...current,
                                preferredWorkspacePath: event.target.value || undefined,
                              }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleApplyNodeDraft}
                    className="enterprise-button enterprise-button-primary"
                  >
                    Save node
                  </button>
                </div>
              </FormSection>
            ) : selectedEdge && edgeDraft ? (
              <FormSection
                title="Transition Configuration"
                description="Define hand-off rules, branch semantics, and artifact contracts."
                icon={GitBranch}
                action={
                  <button
                    type="button"
                    onClick={handleDeleteSelectedEdge}
                    className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                  >
                    Delete
                  </button>
                }
              >
                <div className="grid gap-4">
                  <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      General
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      Branch identity and condition handling for the selected transition.
                    </p>
                  </div>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Label</span>
                    <input
                      value={edgeDraft.label || ''}
                      onChange={event =>
                        setEdgeDraft(current =>
                          current ? { ...current, label: event.target.value } : current,
                        )
                      }
                      className="enterprise-input"
                    />
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Condition Type</span>
                    <select
                      value={edgeDraft.conditionType}
                      onChange={event =>
                        setEdgeDraft(current =>
                          current
                            ? {
                                ...current,
                                conditionType: event.target.value as WorkflowEdge['conditionType'],
                              }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    >
                      {EDGE_CONDITION_OPTIONS.map(option => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Branch Key</span>
                    <input
                      value={edgeDraft.branchKey || ''}
                      onChange={event =>
                        setEdgeDraft(current =>
                          current ? { ...current, branchKey: event.target.value } : current,
                        )
                      }
                      className="enterprise-input"
                    />
                  </label>
                  <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Hand-off
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      Protocol and branch metadata for moving work between nodes.
                    </p>
                  </div>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Handoff Protocol Id</span>
                    <input
                      value={edgeDraft.handoffProtocolId || ''}
                      onChange={event =>
                        setEdgeDraft(current =>
                          current
                            ? { ...current, handoffProtocolId: event.target.value || undefined }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    />
                  </label>
                  <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Artifacts
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      Define the input and output expectations carried across this edge.
                    </p>
                  </div>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Artifact Inputs</span>
                    <input
                      value={(edgeDraft.artifactContract?.requiredInputs || []).join(', ')}
                      onChange={event =>
                        setEdgeDraft(current =>
                          current
                            ? {
                                ...current,
                                artifactContract: {
                                  ...(current.artifactContract || {}),
                                  requiredInputs: event.target.value
                                    .split(',')
                                    .map(value => value.trim())
                                    .filter(Boolean),
                                },
                              }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    />
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Expected Outputs</span>
                    <input
                      value={(edgeDraft.artifactContract?.expectedOutputs || []).join(', ')}
                      onChange={event =>
                        setEdgeDraft(current =>
                          current
                            ? {
                                ...current,
                                artifactContract: {
                                  ...(current.artifactContract || {}),
                                  expectedOutputs: event.target.value
                                    .split(',')
                                    .map(value => value.trim())
                                    .filter(Boolean),
                                },
                              }
                            : current,
                        )
                      }
                      className="enterprise-input"
                    />
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Artifact Contract Notes</span>
                    <textarea
                      rows={4}
                      value={edgeDraft.artifactContract?.notes || ''}
                      onChange={event =>
                        setEdgeDraft(current =>
                          current
                            ? {
                                ...current,
                                artifactContract: {
                                  ...(current.artifactContract || {}),
                                  notes: event.target.value,
                                },
                              }
                            : current,
                        )
                      }
                      className="enterprise-input min-h-[7rem]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleApplyEdgeDraft}
                    className="enterprise-button enterprise-button-primary"
                  >
                    Save transition
                  </button>
                </div>
              </FormSection>
            ) : (
              <EmptyState
                title="Select a node or transition"
                description="Choose a node to edit its SDLC phase, agent, tools, and execution notes. Choose an edge to configure hand-off rules, branch labels, and artifact contracts."
                icon={Wrench}
                action={
                  connectFromNodeId ? (
                    <button
                      type="button"
                      onClick={() => setConnectFromNodeId(null)}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Cancel hand-off mode
                    </button>
                  ) : undefined
                }
              />
              )}
            </SectionCard>
              </div>
            </aside>
          </div>
        </div>
      )}

      {isCreateWorkflowOpen ? (
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-20 backdrop-blur-sm">
          <div className="w-full max-w-3xl">
            <ModalShell
              eyebrow="New Workflow Graph"
              title="Create a graph-first workflow"
              description="Start from an empty workflow with START and END nodes, then drag agent steps, decisions, approvals, and releases into the canvas."
              actions={
                <button
                  type="button"
                  onClick={() => setIsCreateWorkflowOpen(false)}
                  className="rounded-full p-2 text-outline transition hover:bg-surface-container-low hover:text-on-surface"
                >
                  <X size={18} />
                </button>
              }
            >
              <form className="grid gap-5" onSubmit={handleCreateWorkflow}>
                <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                  <span>Workflow Name</span>
                  <input
                    required
                    value={workflowDraft.name}
                    onChange={event =>
                      setWorkflowDraft(current => ({ ...current, name: event.target.value }))
                    }
                    className="enterprise-input"
                  />
                </label>
                <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                  <span>Summary</span>
                  <textarea
                    rows={4}
                    value={workflowDraft.summary}
                    onChange={event =>
                      setWorkflowDraft(current => ({ ...current, summary: event.target.value }))
                    }
                    className="enterprise-input min-h-[7rem]"
                  />
                </label>
                <div className="grid gap-5 md:grid-cols-2">
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Workflow Type</span>
                    <select
                      value={workflowDraft.workflowType}
                      onChange={event =>
                        setWorkflowDraft(current => ({
                          ...current,
                          workflowType: event.target.value as NonNullable<Workflow['workflowType']>,
                        }))
                      }
                      className="enterprise-input"
                    >
                      <option value="SDLC">SDLC</option>
                      <option value="Operational">Operational</option>
                      <option value="Governance">Governance</option>
                      <option value="Custom">Custom</option>
                    </select>
                  </label>
                  <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                    <span>Scope</span>
                    <select
                      value={workflowDraft.scope}
                      onChange={event =>
                        setWorkflowDraft(current => ({
                          ...current,
                          scope: event.target.value as NonNullable<Workflow['scope']>,
                        }))
                      }
                      className="enterprise-input"
                    >
                      <option value="CAPABILITY">Capability Local</option>
                      <option value="GLOBAL">Global</option>
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsCreateWorkflowOpen(false)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="enterprise-button enterprise-button-primary">
                    <Plus size={16} />
                    Create Graph Workflow
                  </button>
                </div>
              </form>
            </ModalShell>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Designer;
