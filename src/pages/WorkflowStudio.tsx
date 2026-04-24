import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  GitBranch,
  Hand,
  Keyboard,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Moon,
  PanelLeft,
  Play,
  Plus,
  Radio,
  Redo2,
  Route,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  Split,
  Sun,
  Trash2,
  Undo2,
  UnfoldVertical,
  Workflow as WorkflowIcon,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import {
  EmptyState,
  FormSection,
  ModalShell,
  SectionCard,
  StatusBadge,
} from '../components/EnterpriseUI';
import CapabilityLifecycleEditor from '../components/CapabilityLifecycleEditor';
import {
  loadDesignerConfig,
  type DesignerConfig,
} from './DesignerConfig';
import { normalizeAgentOperatingContract } from '../lib/agentRuntime';
import {
  applyWorkflowTemplateArtifacts,
  createBrokerageCapabilityWorkflow,
  createStandardCapabilityWorkflow,
} from '../lib/standardWorkflow';
import {
  createBrokerageCapabilityLifecycle,
  createDefaultCapabilityLifecycle,
  createLifecyclePhase,
  getCapabilityGraphPhaseIds,
  getDefaultLifecycleEndPhaseId,
  getDefaultLifecycleStartPhaseId,
  getLifecyclePhaseLabel,
  getLifecyclePhaseUsage,
  moveLifecyclePhase,
  normalizeCapabilityLifecycle,
  remapWorkflowPhaseReferences,
  renameLifecyclePhase,
  retireLifecyclePhase,
} from '../lib/capabilityLifecycle';
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
} from '../lib/workflowGraph';
import { cn } from '../lib/utils';
import type {
  AgentArtifactExpectation,
  ApprovalMode,
  ApprovalPolicy,
  ApprovalRuleTarget,
  Artifact,
  HumanTaskConfig,
  AgentTaskConfig,
  StepTemplate,
  SubWorkflowConfig,
  WorkflowVersion,
  ToolAdapterId,
  WorkItemPhase,
  Workflow,
  WorkflowAlertChannel,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowPublishState,
  WorkflowStepOwnershipRule,
} from '../types';

const NODE_TYPE_OPTIONS: Array<{
  type: WorkflowNodeType;
  label: string;
  description: string;
}> = [
  { type: 'DELIVERY', label: 'Delivery Step', description: 'Agent-owned work inside a delivery phase.' },
  { type: 'HUMAN_TASK', label: 'Human Task', description: 'A human-owned task: upload documents, verify items, fill a form, or review a checklist.' },
  { type: 'AGENT_TASK', label: 'Agent Task', description: 'A configurable agent step with custom parameters and timeout.' },
  { type: 'SUB_WORKFLOW', label: 'Sub-Workflow', description: 'Embed and run an existing published workflow as a single composable step.' },
  { type: 'EVENT', label: 'Event', description: 'Emit a workflow event or signal for downstream systems and evidence.' },
  { type: 'ALERT', label: 'Alert', description: 'Raise an operational alert with severity, routing, and acknowledgement rules.' },
  { type: 'DECISION', label: 'Decision', description: 'Route the work item based on review or execution outcome.' },
  { type: 'PARALLEL_SPLIT', label: 'Parallel Split', description: 'Send work to multiple agents or tracks in parallel.' },
  { type: 'PARALLEL_JOIN', label: 'Parallel Join', description: 'Wait for parallel tracks and consolidate evidence.' },
  { type: 'GOVERNANCE_GATE', label: 'Governance Gate', description: 'Pause for risk, control, or compliance checks.' },
  { type: 'HUMAN_APPROVAL', label: 'Human Approval', description: 'Pause for human sign-off, clarification, or unblock.' },
  { type: 'RELEASE', label: 'Release Step', description: 'Complete release or deployment work.' },
  { type: 'END', label: 'End', description: 'Close the workflow path.' },
  { type: 'EXTRACT', label: 'Legacy Source Step', description: 'Legacy ETL node kept for compatibility.' },
  { type: 'TRANSFORM', label: 'Legacy Transform Step', description: 'Legacy ETL node kept for compatibility.' },
  { type: 'LOAD', label: 'Legacy Target Step', description: 'Legacy ETL node kept for compatibility.' },
  { type: 'FILTER', label: 'Legacy Validation Step', description: 'Legacy ETL node kept for compatibility.' },
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

// ──────────────────────────────────────────────────────────────────────────
// Artifact-reference nudge: if a step names an inputArtifactId/outputArtifactId
// but the capability has no matching artifact *with a template defined*, we
// surface a one-line link into /artifact-designer. This is how Artifact
// Designer becomes discoverable at the moment builders actually need it,
// without promoting it into the always-on sidebar.
// ──────────────────────────────────────────────────────────────────────────

type ArtifactReferenceStatus = 'empty' | 'missing' | 'untemplated' | 'ready';

const evaluateArtifactReference = (
  artifactId: string | undefined,
  artifacts: Artifact[],
): ArtifactReferenceStatus => {
  const id = (artifactId || '').trim();
  if (!id) return 'empty';
  const match = artifacts.find(candidate => candidate.id === id);
  if (!match) return 'missing';
  const hasTemplate =
    Boolean(match.template?.trim()) ||
    (Array.isArray(match.templateSections) && match.templateSections.length > 0);
  return hasTemplate ? 'ready' : 'untemplated';
};

const ArtifactTemplateNudge = ({
  artifactId,
  status,
  onOpenDesigner,
}: {
  artifactId: string | undefined;
  status: ArtifactReferenceStatus;
  onOpenDesigner: (id: string) => void;
}) => {
  if (status === 'empty' || status === 'ready') return null;
  const trimmedId = (artifactId || '').trim();
  const label =
    status === 'missing'
      ? `No artifact named ${trimmedId} exists yet — define its template so this step has a contract.`
      : `Artifact ${trimmedId} exists but has no template sections — add them so handoffs are structured.`;
  return (
    <button
      type="button"
      onClick={() => onOpenDesigner(trimmedId)}
      className="mt-1 inline-flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-[0.6875rem] font-semibold leading-relaxed text-amber-900 transition-colors hover:bg-amber-100"
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span className="flex-1 normal-case tracking-normal">
        {label}
        <span className="ml-1 inline-flex items-center gap-1 text-amber-900 underline decoration-amber-400 underline-offset-2">
          Open Artifact Designer
          <ArrowRight size={11} />
        </span>
      </span>
    </button>
  );
};

const NODE_TYPE_TONE: Record<WorkflowNodeType, string> = {
  START: 'bg-slate-100 text-slate-700 border-slate-200',
  DELIVERY: 'bg-primary/10 text-primary border-primary/20',
  EVENT: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  ALERT: 'bg-red-100 text-red-700 border-red-200',
  GOVERNANCE_GATE: 'bg-amber-100 text-amber-800 border-amber-200',
  HUMAN_APPROVAL: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  HUMAN_TASK: 'bg-rose-100 text-rose-700 border-rose-200',
  AGENT_TASK: 'bg-teal-100 text-teal-700 border-teal-200',
  SUB_WORKFLOW: 'bg-violet-100 text-violet-700 border-violet-200',
  DECISION: 'bg-sky-100 text-sky-700 border-sky-200',
  PARALLEL_SPLIT: 'bg-blue-100 text-blue-700 border-blue-200',
  PARALLEL_JOIN: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  RELEASE: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  END: 'bg-slate-900 text-white border-slate-900',
  EXTRACT: 'bg-slate-100 text-slate-600 border-slate-200',
  TRANSFORM: 'bg-slate-100 text-slate-600 border-slate-200',
  LOAD: 'bg-slate-100 text-slate-600 border-slate-200',
  FILTER: 'bg-slate-100 text-slate-600 border-slate-200',
};

const PUBLISH_STATE_TONE: Record<WorkflowPublishState, 'neutral' | 'info' | 'success'> = {
  DRAFT: 'neutral',
  VALIDATED: 'info',
  PUBLISHED: 'success',
};

const PALETTE_GROUPS: Array<{
  title: string;
  description: string;
  phase: Exclude<WorkItemPhase, 'BACKLOG' | 'DONE'>;
  items: Array<{
    type: WorkflowNodeType;
    label: string;
    defaultPhase: Exclude<WorkItemPhase, 'BACKLOG' | 'DONE'>;
    action: string;
  }>;
}> = [
  {
    title: 'Delivery',
    description: 'Core agent work for analysis, design, engineering, QA, and release.',
    phase: 'DEVELOPMENT',
    items: [
      { type: 'DELIVERY', label: 'Analysis Task', defaultPhase: 'ANALYSIS', action: 'Analyze the request, shape requirements, and record assumptions.' },
      { type: 'DELIVERY', label: 'Design Task', defaultPhase: 'DESIGN', action: 'Create the design approach, interfaces, and implementation plan.' },
      { type: 'DELIVERY', label: 'Implementation Task', defaultPhase: 'DEVELOPMENT', action: 'Implement the code or system change and capture technical evidence.' },
      { type: 'DELIVERY', label: 'QA Task', defaultPhase: 'QA', action: 'Test the change, verify acceptance criteria, and record outcomes.' },
      { type: 'RELEASE', label: 'Release Task', defaultPhase: 'RELEASE', action: 'Prepare and complete the release with deployment evidence.' },
      { type: 'AGENT_TASK', label: 'Agent Task', defaultPhase: 'DEVELOPMENT', action: 'Run a specific agent with configurable parameters and timeout.' },
    ],
  },
  {
    title: 'Routing',
    description: 'Branch, split, and rejoin work between agent tracks.',
    phase: 'DESIGN',
    items: [
      { type: 'DECISION', label: 'Decision', defaultPhase: 'DESIGN', action: 'Choose the next path based on criteria or result.' },
      { type: 'PARALLEL_SPLIT', label: 'Parallel Split', defaultPhase: 'DESIGN', action: 'Start multiple downstream workstreams in parallel.' },
      { type: 'PARALLEL_JOIN', label: 'Parallel Join', defaultPhase: 'QA', action: 'Wait for parallel workstreams and consolidate outputs.' },
    ],
  },
  {
    title: 'Controls',
    description: 'Governance, approvals, and human interactions.',
    phase: 'GOVERNANCE',
    items: [
      { type: 'GOVERNANCE_GATE', label: 'Governance Gate', defaultPhase: 'GOVERNANCE', action: 'Check controls, evidence, policy, and governance requirements.' },
      { type: 'HUMAN_APPROVAL', label: 'Human Approval', defaultPhase: 'GOVERNANCE', action: 'Pause for human approval, clarification, or unblock.' },
      { type: 'HUMAN_TASK', label: 'Human Task', defaultPhase: 'GOVERNANCE', action: 'Assign a task to a human: upload documents, fill a form, verify items, or complete a checklist.' },
      { type: 'END', label: 'End', defaultPhase: 'RELEASE', action: 'Close the workflow path and mark the run complete.' },
    ],
  },
  {
    title: 'Signals',
    description: 'Emit events and raise alerts as part of the workflow execution path.',
    phase: 'GOVERNANCE',
    items: [
      { type: 'EVENT', label: 'Workflow Event', defaultPhase: 'DEVELOPMENT', action: 'Emit a workflow event with a structured payload for telemetry, automation, or hand-off triggers.' },
      { type: 'ALERT', label: 'Operational Alert', defaultPhase: 'GOVERNANCE', action: 'Raise an alert with severity, routing, and acknowledgement expectations for operators or stakeholders.' },
    ],
  },
  {
    title: 'Compositions',
    description: 'Embed an existing workflow as a single composable step inside this workflow.',
    phase: 'DEVELOPMENT',
    items: [
      { type: 'SUB_WORKFLOW', label: 'Sub-Workflow', defaultPhase: 'DEVELOPMENT', action: 'Run a referenced workflow as a composable step; optionally wait for it to complete.' },
    ],
  },
];

const slugify = (value?: string | null) =>
  (value || '')
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

const createCopyName = (sourceName?: string | null, existingNames: Array<string | undefined | null> = []) => {
  const safeSourceName = (sourceName || '').trim() || 'Untitled';
  const normalizedExistingNames = new Set(
    existingNames
      .map(name => (name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const baseName =
    safeSourceName.replace(/\s+copy(?:\s+\d+)?$/i, '').trim() || safeSourceName;
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

const splitArtifactLines = (value: string) =>
  value
    .split('\n')
    .map(entry => entry.trim())
    .filter(Boolean);

const formatAgentArtifactSuggestionLines = (
  expectations: AgentArtifactExpectation[] = [],
) => expectations.map(expectation => expectation.artifactName);

const mergeArtifactLines = (...groups: string[][]) =>
  [...new Set(groups.flat().map(item => item.trim()).filter(Boolean))];

const cloneArtifactContract = (artifactContract?: WorkflowNode['artifactContract']) =>
  artifactContract
    ? {
        ...artifactContract,
        requiredInputs: artifactContract.requiredInputs
          ? [...artifactContract.requiredInputs]
          : undefined,
        expectedOutputs: artifactContract.expectedOutputs
          ? [...artifactContract.expectedOutputs]
          : undefined,
      }
    : undefined;

const cloneApprovalPolicy = (approvalPolicy?: WorkflowNode['approvalPolicy']) =>
  approvalPolicy
    ? {
        ...approvalPolicy,
        targets: approvalPolicy.targets.map(target => ({ ...target })),
      }
    : undefined;

const cloneOwnershipRule = (ownershipRule?: WorkflowNode['ownershipRule']) =>
  ownershipRule
    ? {
        ...ownershipRule,
        secondaryOwnerTeamIds: [...ownershipRule.secondaryOwnerTeamIds],
        approvalTeamIds: [...ownershipRule.approvalTeamIds],
        escalationTeamIds: [...ownershipRule.escalationTeamIds],
      }
    : undefined;

const parseCommaList = (value: string) =>
  value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);

const createDefaultApprovalPolicy = (node: Pick<WorkflowNode, 'id' | 'name'>): ApprovalPolicy => ({
  id: `APPROVAL-${slugify(node.id || node.name || 'STEP')}`,
  name: `${node.name} Approval`,
  mode: 'ANY_ONE',
  targets: [],
  delegationAllowed: false,
});

const createDefaultOwnershipRule = (): WorkflowStepOwnershipRule => ({
  secondaryOwnerTeamIds: [],
  approvalTeamIds: [],
  escalationTeamIds: [],
  requireHandoffAcceptance: false,
});

const getApprovalPolicyTargetIds = (
  approvalPolicy: ApprovalPolicy | undefined,
  targetType: ApprovalRuleTarget,
) =>
  (approvalPolicy?.targets || [])
    .filter(target => target.targetType === targetType)
    .map(target => target.targetId);

const toDateTimeLocalValue = (value?: string) => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toIsoDateTimeValue = (value: string) => {
  if (!value.trim()) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const getNodeArtifactInputs = (node: WorkflowNode) =>
  node.artifactContract?.requiredInputs?.length
    ? node.artifactContract.requiredInputs
    : node.inputArtifactId
    ? [node.inputArtifactId]
    : [];

const getNodeArtifactOutputs = (node: WorkflowNode) =>
  node.artifactContract?.expectedOutputs?.length
    ? node.artifactContract.expectedOutputs
    : node.outputArtifactId
    ? [node.outputArtifactId]
    : [];

const getArtifactPreview = (artifacts: string[], max = 2) =>
  artifacts.slice(0, max).join(', ');

const isLegacyEtlNodeType = (type: WorkflowNodeType) =>
  type === 'EXTRACT' || type === 'TRANSFORM' || type === 'LOAD' || type === 'FILTER';

const getNodeTypeLabel = (type: WorkflowNodeType, config?: DesignerConfig) => {
  const override = config?.nodeLabels?.[type]?.label;
  if (override) return override;
  return NODE_TYPE_OPTIONS.find(option => option.type === type)?.label || type;
};

const getNodeIcon = (type: WorkflowNodeType) => {
  switch (type) {
    case 'EVENT':
      return Radio;
    case 'ALERT':
      return AlertTriangle;
    case 'DECISION':
      return GitBranch;
    case 'PARALLEL_SPLIT':
      return Split;
    case 'PARALLEL_JOIN':
      return UnfoldVertical;
    case 'GOVERNANCE_GATE':
      return ShieldCheck;
    case 'HUMAN_APPROVAL':
      return CheckCircle2;
    case 'HUMAN_TASK':
      return Hand;
    case 'AGENT_TASK':
      return Wrench;
    case 'SUB_WORKFLOW':
      return WorkflowIcon;
    case 'RELEASE':
      return Sparkles;
    default:
      return WorkflowIcon;
  }
};

/** Human-readable annotation shown beneath a node name in the simulation path. */
const getSimNodeNote = (nodeType: string): string | undefined => {
  switch (nodeType) {
    case 'HUMAN_APPROVAL': return 'Pauses for operator approval';
    case 'EVENT': return 'Emits a workflow event';
    case 'ALERT': return 'Raises an alert';
    case 'PARALLEL_SPLIT': return 'Creates parallel branches';
    case 'PARALLEL_JOIN': return 'Waits for all branches to converge';
    case 'DECISION': return 'Routes work based on outcome';
    case 'GOVERNANCE_GATE': return 'Governance gate must pass';
    case 'END': return 'Execution complete';
    default: return undefined;
  }
};

/** Human-readable label for an edge condition type. */
const getConditionLabel = (conditionType: WorkflowEdge['conditionType'], branchKey?: string): string => {
  if (branchKey) return branchKey;
  switch (conditionType) {
    case 'SUCCESS': return 'On success';
    case 'FAILURE': return 'On failure';
    case 'APPROVED': return 'On approval';
    case 'REJECTED': return 'On rejection';
    case 'PARALLEL': return 'Parallel branch';
    case 'CUSTOM': return 'Custom route';
    default: return 'Default path';
  }
};

const getSamplePath = (
  workflow: Workflow,
  lifecycle = createDefaultCapabilityLifecycle(),
) => {
  const normalized = buildWorkflowFromGraph(
    normalizeWorkflowGraph(workflow, lifecycle),
    lifecycle,
  );
  const path: Array<{ nodeId: string; label: string; note?: string }> = [];
  const visited = new Set<string>();
  let currentNode = getWorkflowNode(normalized, normalized.entryNodeId);
  let safetyCounter = 0;

  while (currentNode && !visited.has(currentNode.id) && safetyCounter < 40) {
    safetyCounter += 1;
    visited.add(currentNode.id);

    if (currentNode.type !== 'START') {
      path.push({
        nodeId: currentNode.id,
        label: currentNode.name,
        note:
          currentNode.type === 'HUMAN_APPROVAL'
            ? 'Pauses for approval'
            : currentNode.type === 'EVENT'
            ? 'Emits a workflow event'
            : currentNode.type === 'ALERT'
            ? 'Raises an alert'
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
  lifecycle = createDefaultCapabilityLifecycle(),
) => {
  const validation = validateWorkflowGraph(workflow, lifecycle);
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type WorkflowHistoryEntry = {
  id: string;
  label: string;
  description?: string;
  timestamp: string;
  snapshot: string;
  workflows: Workflow[];
};

type CanvasWidgetKey = 'library' | 'palette' | 'tree' | 'insights';
type WidgetDockMode = 'free' | 'left' | 'right';
type NeoInsightsTab = 'overview' | 'validation' | 'history' | 'simulation';
type NeoInspectorMode = 'workflow' | 'node' | 'edge';

/** One step in the user-built interactive simulation path. */
type SimulationPathStep = {
  nodeId: string;
  label: string;
  nodeType: string;
  note?: string;
  /** The edge ID chosen from this node to advance to the next step. */
  chosenEdgeId?: string;
};

/** Pending branch choice — set when the simulation reaches a DECISION or PARALLEL_SPLIT node. */
type SimulationBranchPending = {
  fromNodeId: string;
  fromLabel: string;
  fromType: 'DECISION' | 'PARALLEL_SPLIT';
  options: Array<{
    edgeId: string;
    toNodeId: string;
    toLabel: string;
    conditionType: WorkflowEdge['conditionType'];
    branchKey?: string;
    edgeLabel?: string;
  }>;
};
type NeoContextMenuState =
  | {
      x: number;
      y: number;
      type: 'node' | 'edge';
      targetId: string;
    }
  | null;

type WorkflowStudioProps = {
  variant?: 'standard' | 'neo';
};

const NEO_LAYOUT_STORAGE_KEY = 'singularity.workflow-designer-neo.layout';
type NeoStudioTheme = 'dark' | 'light';
type NeoStudioLayout = {
  activePanel: CanvasWidgetKey;
  panelOpen: boolean;
  floatingPanel: boolean;
  laneVisibility: boolean;
  minimapCollapsed: boolean;
  inspectorCollapsed: boolean;
  canvasScale: number;
  insightsTab: NeoInsightsTab;
  theme: NeoStudioTheme;
};

const readNeoStudioLayout = (): NeoStudioLayout => {
  if (typeof window === 'undefined') {
    return {
      activePanel: 'palette' as CanvasWidgetKey,
      panelOpen: true,
      floatingPanel: false,
      laneVisibility: true,
      minimapCollapsed: false,
      inspectorCollapsed: false,
      canvasScale: 1,
      insightsTab: 'overview' as NeoInsightsTab,
      theme: 'dark' as NeoStudioTheme,
    };
  }

  try {
    const raw = window.localStorage.getItem(NEO_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return {
        activePanel: 'palette' as CanvasWidgetKey,
        panelOpen: true,
        floatingPanel: false,
        laneVisibility: true,
        minimapCollapsed: false,
        inspectorCollapsed: false,
        canvasScale: 1,
        insightsTab: 'overview' as NeoInsightsTab,
        theme: 'dark' as NeoStudioTheme,
      };
    }

    const parsed = JSON.parse(raw) as Partial<{
      activePanel: CanvasWidgetKey;
      panelOpen: boolean;
      floatingPanel: boolean;
      laneVisibility: boolean;
      minimapCollapsed: boolean;
      inspectorCollapsed: boolean;
      canvasScale: number;
      insightsTab: NeoInsightsTab;
      theme: NeoStudioTheme;
    }>;

    return {
      activePanel: parsed.activePanel || 'palette',
      panelOpen: parsed.panelOpen ?? true,
      floatingPanel: parsed.floatingPanel ?? false,
      laneVisibility: parsed.laneVisibility ?? true,
      minimapCollapsed: parsed.minimapCollapsed ?? false,
      inspectorCollapsed: parsed.inspectorCollapsed ?? false,
      canvasScale:
        typeof parsed.canvasScale === 'number' && Number.isFinite(parsed.canvasScale)
          ? clamp(parsed.canvasScale, 0.65, 1.35)
          : 1,
      insightsTab: parsed.insightsTab || 'overview',
      theme: parsed.theme === 'light' ? 'light' : 'dark',
    };
  } catch {
    return {
      activePanel: 'palette' as CanvasWidgetKey,
      panelOpen: true,
      floatingPanel: false,
      laneVisibility: true,
      minimapCollapsed: false,
      inspectorCollapsed: false,
      canvasScale: 1,
      insightsTab: 'overview' as NeoInsightsTab,
      theme: 'dark' as NeoStudioTheme,
    };
  }
};

const cloneWorkflowSet = (
  items: Workflow[],
  lifecycle = createDefaultCapabilityLifecycle(),
) =>
  items.map(workflow =>
    buildWorkflowFromGraph(normalizeWorkflowGraph(workflow, lifecycle), lifecycle),
  );

const serializeWorkflowSet = (items: Workflow[]) => JSON.stringify(items);

const createHistoryEntry = (
  label: string,
  description: string | undefined,
  workflows: Workflow[],
  lifecycle = createDefaultCapabilityLifecycle(),
): WorkflowHistoryEntry => {
  const normalizedWorkflows = cloneWorkflowSet(workflows, lifecycle);
  return {
    id: `HISTORY-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`,
    label,
    description,
    timestamp: new Date().toISOString(),
    snapshot: serializeWorkflowSet(normalizedWorkflows),
    workflows: normalizedWorkflows,
  };
};

const snapToGridValue = (value: number, enabled: boolean) =>
  enabled ? Math.round(value / 24) * 24 : value;

const WORKFLOW_LANE_TOP = 48;
const WORKFLOW_LANE_HEIGHT = 176;
const WORKFLOW_LANE_X_OFFSET = 32;
const WORKFLOW_LANE_LABEL_WIDTH = 168;

const getLaneIndex = (phase: WorkItemPhase, lanePhases: WorkItemPhase[]) =>
  Math.max(lanePhases.indexOf(phase), 0);

const getLanePhaseFromY = (y: number, lanePhases: WorkItemPhase[]): WorkItemPhase => {
  const rawIndex = Math.round((y - WORKFLOW_LANE_TOP) / WORKFLOW_LANE_HEIGHT);
  const laneIndex = clamp(rawIndex, 0, lanePhases.length - 1);
  return lanePhases[laneIndex];
};

const getLaneY = (phase: WorkItemPhase, lanePhases: WorkItemPhase[]) =>
  WORKFLOW_LANE_TOP + getLaneIndex(phase, lanePhases) * WORKFLOW_LANE_HEIGHT;

const getLaneAlignedLayout = (
  x: number,
  y: number,
  snapEnabled: boolean,
  lanePhases: WorkItemPhase[],
  phase?: WorkItemPhase,
) => {
  const resolvedPhase = phase && lanePhases.includes(phase)
    ? phase
    : getLanePhaseFromY(y, lanePhases);

  return {
    phase: resolvedPhase,
    x: snapToGridValue(Math.max(x, WORKFLOW_LANE_X_OFFSET), snapEnabled),
    y: getLaneY(resolvedPhase, lanePhases),
  };
};

export default function WorkflowStudio({
  variant = 'standard',
}: WorkflowStudioProps) {
  const navigate = useNavigate();
  const isNeo = variant === 'neo';
  const initialNeoLayout = useMemo(() => readNeoStudioLayout(), []);
  const {
    activeCapability,
    getCapabilityWorkspace,
    setCapabilityWorkspaceContent,
    updateCapabilityMetadata,
    workspaceOrganization,
  } = useCapability();
  const { success, info, warning } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const workspaceTeamOptions = useMemo(
    () =>
      workspaceOrganization.teams.map(team => ({
        id: team.id,
        label: team.name,
      })),
    [workspaceOrganization.teams],
  );
  const workspaceUserOptions = useMemo(
    () =>
      workspaceOrganization.users.map(user => ({
        id: user.id,
        label: user.name,
      })),
    [workspaceOrganization.users],
  );
  const workspaceTeamNameById = useMemo(
    () => new Map(workspaceTeamOptions.map(team => [team.id, team.label])),
    [workspaceTeamOptions],
  );
  const workspaceUserNameById = useMemo(
    () => new Map(workspaceUserOptions.map(user => [user.id, user.label])),
    [workspaceUserOptions],
  );
  const capabilityLifecycle = useMemo(
    () => normalizeCapabilityLifecycle(activeCapability.lifecycle),
    [activeCapability.lifecycle],
  );
  const lifecyclePhaseIds = useMemo(
    () => getCapabilityGraphPhaseIds(capabilityLifecycle),
    [capabilityLifecycle],
  );
  const phaseLabel = useCallback(
    (phase?: string | null) => getLifecyclePhaseLabel(activeCapability, phase),
    [activeCapability],
  );
  const resolveLifecycleTemplatePhase = useCallback(
    (phase: WorkItemPhase): WorkItemPhase => {
      const fallbackPhase =
        lifecyclePhaseIds[0] || getDefaultLifecycleStartPhaseId(capabilityLifecycle);
      if (lifecyclePhaseIds.includes(phase)) {
        return phase;
      }

      const firstPhase = lifecyclePhaseIds[0] || fallbackPhase;
      const secondPhase = lifecyclePhaseIds[1] || firstPhase;
      const middlePhase =
        lifecyclePhaseIds[Math.floor(Math.max(lifecyclePhaseIds.length - 1, 0) / 2)] ||
        firstPhase;
      const penultimatePhase =
        lifecyclePhaseIds[Math.max(lifecyclePhaseIds.length - 2, 0)] ||
        lifecyclePhaseIds[lifecyclePhaseIds.length - 1] ||
        firstPhase;
      const lastPhase =
        lifecyclePhaseIds[lifecyclePhaseIds.length - 1] || firstPhase;

      switch (phase) {
        case 'ANALYSIS':
          return firstPhase;
        case 'DESIGN':
          return secondPhase;
        case 'DEVELOPMENT':
          return middlePhase;
        case 'QA':
        case 'GOVERNANCE':
          return penultimatePhase;
        case 'RELEASE':
          return lastPhase;
        default:
          return fallbackPhase;
      }
    },
    [capabilityLifecycle, lifecyclePhaseIds],
  );
  // Step Kit dynamic palette — must be declared before paletteGroups useMemo
  const [stepTemplates, setStepTemplates] = useState<StepTemplate[]>([]);

  // Designer configuration (per-capability localStorage)
  const [designerConfig, setDesignerConfig] = useState<DesignerConfig>(
    () => loadDesignerConfig(activeCapability.id),
  );
  // Reload config whenever the active capability changes
  useEffect(() => {
    setDesignerConfig(loadDesignerConfig(activeCapability.id));
  }, [activeCapability.id]);

  const paletteGroups = useMemo(() => {
    const visibility = designerConfig.paletteGroupVisibility;
    const baseGroups = PALETTE_GROUPS
      .filter(group => visibility[group.title] !== false)
      .map(group => ({
      ...group,
      phase: resolveLifecycleTemplatePhase(group.phase),
      items: group.items.map(item => ({
        ...item,
        defaultPhase: resolveLifecycleTemplatePhase(item.defaultPhase),
      })),
    }));

    // Dynamic Step Kit groups from workspace_step_templates
    const humanTemplates = stepTemplates.filter(t => t.nodeType === 'HUMAN_TASK');
    const agentTemplates = stepTemplates.filter(t => t.nodeType === 'AGENT_TASK');

    if (humanTemplates.length > 0 && visibility['General Steps'] !== false) {
      baseGroups.push({
        title: 'General Steps',
        description: 'Configurable human task steps — upload documents, verify items, checklists, and more.',
        phase: resolveLifecycleTemplatePhase('DEVELOPMENT'),
        items: humanTemplates.map(t => ({
          type: 'HUMAN_TASK' as const,
          label: t.label,
          defaultPhase: resolveLifecycleTemplatePhase('DEVELOPMENT'),
          action: (t.defaultConfig as { instructions?: string })?.instructions || t.description || 'Complete the assigned task.',
        })),
      });
    }

    if (agentTemplates.length > 0 && visibility['Agent Steps'] !== false) {
      baseGroups.push({
        title: 'Agent Steps',
        description: 'Configurable agent task steps from your step template library.',
        phase: resolveLifecycleTemplatePhase('DEVELOPMENT'),
        items: agentTemplates.map(t => ({
          type: 'AGENT_TASK' as const,
          label: t.label,
          defaultPhase: resolveLifecycleTemplatePhase('DEVELOPMENT'),
          action: t.description || 'Run the configured agent step.',
        })),
      });
    }

    return baseGroups;
  }, [resolveLifecycleTemplatePhase, stepTemplates, designerConfig]);
  const normalizeWorkflowForCapability = useCallback(
    (workflow: Workflow) =>
      buildWorkflowFromGraph(
        normalizeWorkflowGraph(workflow, capabilityLifecycle),
        capabilityLifecycle,
      ),
    [capabilityLifecycle],
  );
  const workflows = useMemo(
    () =>
      workspace.workflows.map(workflow =>
        normalizeWorkflowForCapability(
          applyWorkflowTemplateArtifacts(activeCapability, workflow),
        ),
      ),
    [activeCapability, normalizeWorkflowForCapability, workspace.workflows],
  );
  const activeWorkflows = useMemo(
    () => workflows.filter(workflow => workflow.status !== 'ARCHIVED'),
    [workflows],
  );
  const archivedWorkflows = useMemo(
    () => workflows.filter(workflow => workflow.status === 'ARCHIVED'),
    [workflows],
  );

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    activeWorkflows[0]?.id || '',
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connectFromNodeId, setConnectFromNodeId] = useState<string | null>(null);
  const [dragLinkFromNodeId, setDragLinkFromNodeId] = useState<string | null>(null);
  const [dragLinkPosition, setDragLinkPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [canvasScale, setCanvasScale] = useState(
    () => initialNeoLayout.canvasScale * (loadDesignerConfig(activeCapability.id).canvasPreferences.defaultZoom ?? 1),
  );
  const [snapToGrid, setSnapToGrid] = useState(
    () => loadDesignerConfig(activeCapability.id).canvasPreferences.snapToGrid,
  );
  const [isCreateWorkflowOpen, setIsCreateWorkflowOpen] = useState(false);
  const [isLifecycleManagerOpen, setIsLifecycleManagerOpen] = useState(false);
  const [isNodeDetailsOpen, setIsNodeDetailsOpen] = useState(false);
  const [isQuickEditOpen, setIsQuickEditOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isNeoHelpOpen, setIsNeoHelpOpen] = useState(false);
  const [isNeoOverflowOpen, setIsNeoOverflowOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [workflowLibraryQuery, setWorkflowLibraryQuery] = useState('');
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());
  const [neoActivePanel, setNeoActivePanel] = useState<CanvasWidgetKey>(
    initialNeoLayout.activePanel,
  );
  const [neoPanelOpen, setNeoPanelOpen] = useState(initialNeoLayout.panelOpen);
  const [neoFloatingPanel, setNeoFloatingPanel] = useState(initialNeoLayout.floatingPanel);
  const [neoLaneVisibility, setNeoLaneVisibility] = useState(initialNeoLayout.laneVisibility);
  const [neoMinimapCollapsed, setNeoMinimapCollapsed] = useState(
    initialNeoLayout.minimapCollapsed,
  );
  const [neoInspectorCollapsed, setNeoInspectorCollapsed] = useState(
    initialNeoLayout.inspectorCollapsed,
  );
  const [neoInsightsTab, setNeoInsightsTab] = useState<NeoInsightsTab>(
    initialNeoLayout.insightsTab,
  );
  const [neoTheme, setNeoTheme] = useState<NeoStudioTheme>(initialNeoLayout.theme);
  const [neoInspectorMode, setNeoInspectorMode] = useState<NeoInspectorMode>('workflow');
  const [neoContextMenu, setNeoContextMenu] = useState<NeoContextMenuState>(null);
  const [widgets, setWidgets] = useState({
    library: true,
    palette: true,
    tree: true,
    insights: true,
  });
  const [canvasWidgetPositions, setCanvasWidgetPositions] = useState({
    library: { x: 320, y: 18 },
    palette: { x: 16, y: 520 },
    tree: { x: 1040, y: 84 },
    insights: { x: 1040, y: 442 },
  });
  const [canvasWidgetPreferences, setCanvasWidgetPreferences] = useState<Record<
    CanvasWidgetKey,
    { width: number; dock: WidgetDockMode }
  >>({
    library: { width: 420, dock: 'free' },
    palette: { width: 304, dock: 'left' },
    tree: { width: 304, dock: 'right' },
    insights: { width: 420, dock: 'right' },
  });
  const [draggingWidget, setDraggingWidget] = useState<{
    key: CanvasWidgetKey;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [simulationState, setSimulationState] = useState({
    active: false,
    stepIndex: 0,
  });
  const [simulationPath, setSimulationPath] = useState<SimulationPathStep[]>([]);
  const [simulationBranchPending, setSimulationBranchPending] =
    useState<SimulationBranchPending | null>(null);
  const [canvasViewport, setCanvasViewport] = useState({
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 0,
    clientHeight: 0,
  });
  const [isCanvasPanMode, setIsCanvasPanMode] = useState(false);
  const [canvasPanDrag, setCanvasPanDrag] = useState<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [workflowDraft, setWorkflowDraft] = useState({
    name: '',
    summary: '',
    workflowType: 'SDLC' as NonNullable<Workflow['workflowType']>,
    scope: 'CAPABILITY' as NonNullable<Workflow['scope']>,
  });
  const [lifecycleDraft, setLifecycleDraft] = useState(capabilityLifecycle);
  const [lifecycleDraftWorkflows, setLifecycleDraftWorkflows] = useState(workflows);
  const [pendingLifecycleDeletePhaseId, setPendingLifecycleDeletePhaseId] = useState<string | null>(
    null,
  );
  const [lifecycleDeleteTargetPhaseId, setLifecycleDeleteTargetPhaseId] = useState('');
  const [isSavingLifecycle, setIsSavingLifecycle] = useState(false);

  useEffect(() => {
    if (isLifecycleManagerOpen) {
      return;
    }
    setLifecycleDraft(capabilityLifecycle);
    setLifecycleDraftWorkflows(workflows);
    setPendingLifecycleDeletePhaseId(null);
    setLifecycleDeleteTargetPhaseId('');
  }, [capabilityLifecycle, isLifecycleManagerOpen, workflows]);
  const [nodeDraft, setNodeDraft] = useState<WorkflowNode | null>(null);
  const [edgeDraft, setEdgeDraft] = useState<WorkflowEdge | null>(null);
  // Advanced node details tabs + view toggle
  const [nodeDetailTab, setNodeDetailTab] = useState<'overview' | 'task' | 'io' | 'governance' | 'execution'>('overview');
  const [businessView, setBusinessView] = useState<boolean>(() => {
    try { return localStorage.getItem('wf-business-view') === 'true'; } catch { return false; }
  });
  // Workflow versioning
  const [workflowVersions, setWorkflowVersions] = useState<WorkflowVersion[]>([]);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  // Sub-workflow picker
  const [isSubWorkflowPickerOpen, setIsSubWorkflowPickerOpen] = useState(false);
  const [pendingSubWorkflowNodeId, setPendingSubWorkflowNodeId] = useState<string | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const graphStageRef = useRef<HTMLDivElement | null>(null);
  const historyCapabilityRef = useRef<string | null>(null);
  const isApplyingHistoryRef = useRef(false);

  const selectedWorkflow = useMemo(
    () =>
      activeWorkflows.find(workflow => workflow.id === selectedWorkflowId) ||
      activeWorkflows[0] ||
      null,
    [activeWorkflows, selectedWorkflowId],
  );

  useEffect(() => {
    if (!selectedWorkflow && activeWorkflows[0]) {
      setSelectedWorkflowId(activeWorkflows[0].id);
      return;
    }

    if (!selectedWorkflowId && activeWorkflows[0]) {
      setSelectedWorkflowId(activeWorkflows[0].id);
      return;
    }

    if (selectedWorkflowId && !activeWorkflows.some(workflow => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(activeWorkflows[0]?.id || '');
    }
  }, [activeWorkflows, selectedWorkflow, selectedWorkflowId]);


  useEffect(() => {
    const baselineEntry = createHistoryEntry(
      'Workspace synced',
      undefined,
      workflows,
      capabilityLifecycle,
    );

    if (
      historyCapabilityRef.current !== activeCapability.id ||
      workflowHistory.length === 0
    ) {
      historyCapabilityRef.current = activeCapability.id;
      setWorkflowHistory([baselineEntry]);
      setHistoryIndex(0);
      setLastSavedAt(baselineEntry.timestamp);
      return;
    }

    if (isApplyingHistoryRef.current) {
      isApplyingHistoryRef.current = false;
    }
  }, [activeCapability.id, capabilityLifecycle, historyIndex, workflowHistory, workflows]);

  const nodes = selectedWorkflow ? getWorkflowNodes(selectedWorkflow) : [];
  const edges = selectedWorkflow ? getWorkflowEdges(selectedWorkflow) : [];
  const orderedNodeIds = selectedWorkflow
    ? getWorkflowNodeOrder(selectedWorkflow, capabilityLifecycle)
    : [];
  const orderedNodes = orderedNodeIds
    .map(nodeId => nodes.find(node => node.id === nodeId))
    .filter((node): node is WorkflowNode => Boolean(node));
  const visibleNodeCount = orderedNodes.filter(node => isVisibleWorkflowNode(node.type)).length;
  const laneSummaries = lifecyclePhaseIds.map(phase => ({
    phase,
    count: orderedNodes.filter(node => node.phase === phase).length,
  }));
  const selectedNode =
    selectedWorkflow && selectedNodeId
      ? getWorkflowNode(selectedWorkflow, selectedNodeId) || null
      : null;
  const selectedEdge =
    selectedWorkflow && selectedEdgeId
      ? edges.find(edge => edge.id === selectedEdgeId) || null
      : null;
  const validationState = selectedWorkflow
    ? getNodeValidationMessages(
        selectedWorkflow,
        selectedNodeId || undefined,
        selectedEdgeId || undefined,
        capabilityLifecycle,
      )
    : { all: [], selected: [], nodeIdsWithErrors: new Set<string>() };
  const workflowSamplePath = selectedWorkflow
    ? getSamplePath(selectedWorkflow, capabilityLifecycle)
    : [];
  const selectedCanvasNodes = orderedNodes.filter(node => selectedNodeIds.includes(node.id));
  const nodeValidationDetails = useMemo(() => {
    const record = new Map<string, string[]>();
    validationState.all.forEach(error => {
      if (!error.nodeId) {
        return;
      }
      const current = record.get(error.nodeId) || [];
      current.push(error.message);
      record.set(error.nodeId, current);
    });
    return record;
  }, [validationState.all]);
  const edgeValidationDetails = useMemo(() => {
    const record = new Map<string, string[]>();
    validationState.all.forEach(error => {
      if (!error.edgeId) {
        return;
      }
      const current = record.get(error.edgeId) || [];
      current.push(error.message);
      record.set(error.edgeId, current);
    });
    return record;
  }, [validationState.all]);
  const workflowNarrative = useMemo(() => {
    if (!selectedWorkflow) {
      return null;
    }

    const activePhases = laneSummaries
      .filter(summary => summary.count > 0)
      .map(summary => phaseLabel(summary.phase));
    const assignedAgents = Array.from(
      new Set(
        orderedNodes
          .map(node => workspace.agents.find(agent => agent.id === node.agentId)?.name)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const approvalCount = orderedNodes.filter(
      node => node.type === 'HUMAN_APPROVAL' || node.type === 'GOVERNANCE_GATE',
    ).length;
    const branchCount = orderedNodes.filter(
      node => node.type === 'DECISION' || node.type === 'PARALLEL_SPLIT',
    ).length;
    const pathDescription = workflowSamplePath.map(step => step.label).join(' -> ');

    return {
      overview:
        selectedWorkflow.summary?.trim() ||
        `${selectedWorkflow.name} orchestrates agent-owned delivery from ${activePhases[0] || 'Analysis'} through ${activePhases[activePhases.length - 1] || 'Release'}.`,
      execution: `This workflow currently spans ${activePhases.length || 1} SDLC phases, with ${visibleNodeCount} visible nodes, ${edges.length} hand-offs, ${approvalCount} approval or governance checkpoints, and ${branchCount} branch controls.`,
      ownership: assignedAgents.length
        ? `Primary agents in this flow: ${assignedAgents.join(', ')}.`
        : 'Assign agents to nodes so ownership and hand-offs are clear to operators.',
      path: pathDescription
        ? `Representative execution path: ${pathDescription}.`
        : 'Add nodes and transitions to generate a readable execution narrative.',
    };
  }, [edges.length, laneSummaries, orderedNodes, selectedWorkflow, visibleNodeCount, workflowSamplePath, workspace.agents]);

  useEffect(() => {
    if (!selectedNode) {
      setNodeDraft(null);
      setIsNodeDetailsOpen(false);
      return;
    }
    setNodeDraft({
      ...selectedNode,
      etlConfig: selectedNode.etlConfig ? { ...selectedNode.etlConfig } : undefined,
      eventConfig: selectedNode.eventConfig ? { ...selectedNode.eventConfig } : undefined,
      alertConfig: selectedNode.alertConfig
        ? {
            ...selectedNode.alertConfig,
            notifyRoles: selectedNode.alertConfig.notifyRoles
              ? [...selectedNode.alertConfig.notifyRoles]
              : undefined,
          }
        : undefined,
      artifactContract: cloneArtifactContract(selectedNode.artifactContract),
      approvalPolicy: cloneApprovalPolicy(selectedNode.approvalPolicy),
      ownershipRule: cloneOwnershipRule(selectedNode.ownershipRule),
    });
  }, [selectedNode]);

  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedNodeIds(current => (current.length ? [] : current));
      return;
    }

    setSelectedNodeIds(current => {
      const valid = current.filter(id => nodes.some(node => node.id === id));
      if (valid.length === 0 || !valid.includes(selectedNodeId)) {
        return [selectedNodeId];
      }
      return valid;
    });
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    // When the workflow graph changes, reset simulation to avoid stale paths.
    setSimulationState({ active: false, stepIndex: 0 });
    setSimulationPath([]);
    setSimulationBranchPending(null);
  }, [workflowSamplePath.length]);

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

  useEffect(() => {
    if (!isNeo) {
      return;
    }

    if (selectedEdge) {
      setNeoInspectorMode('edge');
      return;
    }

    if (selectedNode) {
      setNeoInspectorMode('node');
      return;
    }

    setNeoInspectorMode('workflow');
  }, [isNeo, selectedEdge, selectedNode]);

  useEffect(() => {
    if (!draggingWidget) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!canvasRef.current) {
        return;
      }

      const bounds = canvasRef.current.getBoundingClientRect();
      const widgetWidth = canvasWidgetPreferences[draggingWidget.key].width;
      const minX = 16;
      const minY = 16;
      const maxX = Math.max(bounds.width - widgetWidth - 16, minX);
      const maxY = Math.max(bounds.height - 96, minY);

      setCanvasWidgetPositions(current => ({
        ...current,
        [draggingWidget.key]: {
          x: clamp(event.clientX - bounds.left - draggingWidget.offsetX, minX, maxX),
          y: clamp(event.clientY - bounds.top - draggingWidget.offsetY, minY, maxY),
        },
      }));
    };

    const handleMouseUp = () => {
      setDraggingWidget(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [canvasWidgetPreferences, draggingWidget]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) {
      return;
    }

    const updateViewport = () => {
      setCanvasViewport({
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
      });
    };

    updateViewport();
    element.addEventListener('scroll', updateViewport);
    window.addEventListener('resize', updateViewport);
    return () => {
      element.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [canvasScale, selectedWorkflowId]);

  useEffect(() => {
    if (!canvasPanDrag) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (event: MouseEvent) => {
      if (!canvasRef.current) {
        return;
      }

      event.preventDefault();
      canvasRef.current.scrollLeft =
        canvasPanDrag.scrollLeft - (event.clientX - canvasPanDrag.startX);
      canvasRef.current.scrollTop =
        canvasPanDrag.scrollTop - (event.clientY - canvasPanDrag.startY);
    };

    const handleMouseUp = () => {
      setCanvasPanDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [canvasPanDrag]);

  useEffect(() => {
    if (!isNeo || typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      NEO_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        activePanel: neoActivePanel,
        panelOpen: neoPanelOpen,
        floatingPanel: neoFloatingPanel,
        laneVisibility: neoLaneVisibility,
        minimapCollapsed: neoMinimapCollapsed,
        inspectorCollapsed: neoInspectorCollapsed,
        canvasScale,
        insightsTab: neoInsightsTab,
        theme: neoTheme,
      }),
    );
  }, [
    canvasScale,
    isNeo,
    neoActivePanel,
    neoFloatingPanel,
    neoInsightsTab,
    neoInspectorCollapsed,
    neoLaneVisibility,
    neoMinimapCollapsed,
    neoPanelOpen,
    neoTheme,
  ]);

  useEffect(() => {
    if (!isNeo || typeof document === 'undefined') {
      return;
    }

    document.body.dataset.designerTheme = neoTheme;
    return () => {
      delete document.body.dataset.designerTheme;
    };
  }, [isNeo, neoTheme]);

  useEffect(() => {
    if (!neoContextMenu) {
      return;
    }

    const handleClose = () => setNeoContextMenu(null);
    window.addEventListener('click', handleClose);
    return () => {
      window.removeEventListener('click', handleClose);
    };
  }, [neoContextMenu]);

  // Load step templates for dynamic palette groups
  useEffect(() => {
    const capId = activeCapability.id;
    if (!capId) return;
    fetch(`/api/step-templates?capabilityId=${encodeURIComponent(capId)}&workspaceId=default`)
      .then(r => r.ok ? r.json() : [])
      .then((templates: StepTemplate[]) => setStepTemplates(templates))
      .catch(() => undefined);
  }, [activeCapability.id]);

  // Load version history when a PUBLISHED/locked workflow is opened
  useEffect(() => {
    const wf = selectedWorkflow;
    if (!wf?.lockedAt && !wf?.version) return;
    const capId = activeCapability.id;
    if (!capId || !wf?.id) return;
    fetch(`/api/capabilities/${encodeURIComponent(capId)}/workflows/${encodeURIComponent(wf.id)}/versions`)
      .then(r => r.ok ? r.json() : [])
      .then((versions: WorkflowVersion[]) => setWorkflowVersions(versions))
      .catch(() => undefined);
  }, [selectedWorkflow?.id, selectedWorkflow?.lockedAt, activeCapability.id]);

  const persistWorkflows = async (
    nextWorkflows: Workflow[],
    toastTitle: string,
    toastDescription?: string,
  ) => {
    const normalizedWorkflows = cloneWorkflowSet(nextWorkflows, capabilityLifecycle);
    const nextEntry = createHistoryEntry(
      toastTitle,
      toastDescription,
      normalizedWorkflows,
      capabilityLifecycle,
    );
    const currentSnapshot = workflowHistory[historyIndex]?.snapshot;

    if (nextEntry.snapshot !== currentSnapshot) {
      const baseHistory = workflowHistory.slice(0, historyIndex + 1);
      const trimmedHistory = [...baseHistory, nextEntry].slice(-40);
      setWorkflowHistory(trimmedHistory);
      setHistoryIndex(trimmedHistory.length - 1);
    }

    try {
      await setCapabilityWorkspaceContent(activeCapability.id, {
        workflows: normalizedWorkflows,
      });
      setLastSavedAt(nextEntry.timestamp);
      success(toastTitle, toastDescription);
    } catch {
      // Context mutation paths already emit failure toasts.
    }
  };

  const toggleBusinessView = (next: boolean) => {
    setBusinessView(next);
    try { localStorage.setItem('wf-business-view', String(next)); } catch { /* ignore */ }
  };

  // Determine default view mode when a node is selected
  const getDefaultBusinessView = (nodeType: WorkflowNodeType): boolean => {
    const businessFirst: WorkflowNodeType[] = ['HUMAN_APPROVAL', 'HUMAN_TASK', 'GOVERNANCE_GATE'];
    return businessFirst.includes(nodeType);
  };

  const lifecyclePhaseViews = useMemo(
    () =>
      lifecycleDraft.phases.map(phase => {
        const usage = getLifecyclePhaseUsage(
          {
            workItems: workspace.workItems,
            tasks: workspace.tasks,
          },
          lifecycleDraftWorkflows,
          phase.id,
        );
        const referencedByWorkflow =
          usage.workflowNodeCount + usage.workflowStepCount + usage.handoffTargetCount > 0;
        const blockedByLiveWork =
          usage.activeWorkItemCount > 0 || usage.pendingTaskCount > 0;

        const usageSummaryParts = [
          usage.workflowNodeCount > 0
            ? `${usage.workflowNodeCount} workflow nodes`
            : '',
          usage.workflowStepCount > 0
            ? `${usage.workflowStepCount} workflow steps`
            : '',
          usage.handoffTargetCount > 0
            ? `${usage.handoffTargetCount} hand-off targets`
            : '',
        ].filter(Boolean);

        return {
          phase,
          usageSummary: usageSummaryParts.length
            ? `Used by ${usageSummaryParts.join(', ')}.`
            : 'Not used by any saved workflow nodes yet.',
          canDelete:
            lifecycleDraft.phases.length > 1 && !blockedByLiveWork,
          deleteHint:
            blockedByLiveWork
              ? 'Move or complete live work and workflow-managed tasks in this phase before deleting it.'
              : referencedByWorkflow
              ? 'Deleting this phase will require remapping workflow references.'
              : lifecycleDraft.phases.length <= 1
              ? 'At least one lifecycle phase must remain.'
              : undefined,
        };
      }),
    [lifecycleDraft.phases, lifecycleDraftWorkflows, workspace.tasks, workspace.workItems],
  );

  const openLifecycleManager = () => {
    setLifecycleDraft(capabilityLifecycle);
    setLifecycleDraftWorkflows(workflows);
    setPendingLifecycleDeletePhaseId(null);
    setLifecycleDeleteTargetPhaseId('');
    setIsLifecycleManagerOpen(true);
  };

  const handleAddLifecyclePhase = () => {
    const allPhaseIds = [
      ...lifecycleDraft.phases.map(phase => phase.id),
      ...lifecycleDraft.retiredPhases.map(phase => phase.id),
    ];
    setLifecycleDraft(current => ({
      ...current,
      phases: [
        ...current.phases,
        createLifecyclePhase(`Phase ${current.phases.length + 1}`, allPhaseIds),
      ],
    }));
  };

  const handleRenameLifecyclePhase = (phaseId: string, label: string) => {
    setLifecycleDraft(current => renameLifecyclePhase(current, phaseId, label));
  };

  const handleMoveLifecyclePhase = (
    phaseId: string,
    direction: 'up' | 'down',
  ) => {
    setLifecycleDraft(current => moveLifecyclePhase(current, phaseId, direction));
  };

  const handleDeleteLifecyclePhase = (phaseId: string) => {
    const usage = getLifecyclePhaseUsage(
      {
        workItems: workspace.workItems,
        tasks: workspace.tasks,
      },
      lifecycleDraftWorkflows,
      phaseId,
    );

    if (lifecycleDraft.phases.length <= 1) {
      warning(
        'Cannot remove the last phase',
        'Keep at least one visible lifecycle phase between Backlog and Done.',
      );
      return;
    }

    if (usage.activeWorkItemCount > 0 || usage.pendingTaskCount > 0) {
      warning(
        'Phase is still active',
        'Move or complete live work and workflow-managed tasks before deleting this lifecycle phase.',
      );
      return;
    }

    if (usage.workflowNodeCount + usage.workflowStepCount + usage.handoffTargetCount > 0) {
      const fallbackPhaseId =
        lifecycleDraft.phases.find(phase => phase.id !== phaseId)?.id || '';
      setPendingLifecycleDeletePhaseId(phaseId);
      setLifecycleDeleteTargetPhaseId(fallbackPhaseId);
      return;
    }

    setLifecycleDraft(current => retireLifecyclePhase(current, phaseId));
  };

  const handleConfirmLifecycleDelete = () => {
    if (!pendingLifecycleDeletePhaseId || !lifecycleDeleteTargetPhaseId) {
      return;
    }

    const nextLifecycle = retireLifecyclePhase(
      lifecycleDraft,
      pendingLifecycleDeletePhaseId,
    );
    setLifecycleDraft(nextLifecycle);
    setLifecycleDraftWorkflows(current =>
      cloneWorkflowSet(
        remapWorkflowPhaseReferences(
          current,
          pendingLifecycleDeletePhaseId,
          lifecycleDeleteTargetPhaseId,
        ),
        nextLifecycle,
      ),
    );
    setPendingLifecycleDeletePhaseId(null);
    setLifecycleDeleteTargetPhaseId('');
  };

  const handleSaveLifecycle = async () => {
    const hasBlankLabel = lifecycleDraft.phases.some(
      phase => !phase.label.trim(),
    );
    if (hasBlankLabel) {
      warning('Lifecycle needs names', 'Give every lifecycle phase a visible label before saving.');
      return;
    }

    const nextLifecycle = normalizeCapabilityLifecycle(lifecycleDraft);
    const normalizedWorkflows = cloneWorkflowSet(
      lifecycleDraftWorkflows,
      nextLifecycle,
    );

    setIsSavingLifecycle(true);
    try {
      await setCapabilityWorkspaceContent(activeCapability.id, {
        workflows: normalizedWorkflows,
      });
      await updateCapabilityMetadata(activeCapability.id, {
        lifecycle: nextLifecycle,
      });
      setLastSavedAt(new Date().toISOString());
      setIsLifecycleManagerOpen(false);
      setPendingLifecycleDeletePhaseId(null);
      setLifecycleDeleteTargetPhaseId('');
      success(
        'Lifecycle saved',
        'Designer lanes, workflow phase selectors, and downstream work views now use the updated lifecycle.',
      );
    } catch {
      // Context mutation paths already emit failure toasts.
    } finally {
      setIsSavingLifecycle(false);
    }
  };

  const replaceSelectedWorkflow = (
    updater: (workflow: Workflow) => Workflow,
    toastTitle: string,
    toastDescription?: string,
  ) => {
    if (!selectedWorkflow) {
      return;
    }

    const nextWorkflow = normalizeWorkflowForCapability(updater(selectedWorkflow));

    const nextWorkflows = workflows.map(workflow =>
      workflow.id === nextWorkflow.id ? nextWorkflow : workflow,
    );

    persistWorkflows(nextWorkflows, toastTitle, toastDescription);
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

  const clearCanvasSelection = () => {
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
  };

  const selectNode = (nodeId: string, additive = false) => {
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
    if (!additive) {
      setSelectedNodeId(nodeId);
      setSelectedNodeIds([nodeId]);
      return;
    }

    setSelectedNodeIds(current => {
      if (current.includes(nodeId)) {
        const next = current.filter(id => id !== nodeId);
        setSelectedNodeId(next[next.length - 1] || null);
        return next;
      }
      setSelectedNodeId(nodeId);
      return [...current, nodeId];
    });
  };

  const applyHistoryEntry = (
    nextEntry: WorkflowHistoryEntry,
    nextIndex: number,
    toastTitle: string,
  ) => {
    void (async () => {
      isApplyingHistoryRef.current = true;
      setHistoryIndex(nextIndex);
      try {
        await setCapabilityWorkspaceContent(activeCapability.id, {
          workflows: nextEntry.workflows,
        });
        setLastSavedAt(new Date().toISOString());
        setSelectedEdgeId(null);
        setConnectFromNodeId(null);
        success(toastTitle, nextEntry.label);
      } catch {
        // Context mutation paths already emit failure toasts.
      }
    })();
  };

  const handleUndo = () => {
    if (historyIndex <= 0 || !workflowHistory[historyIndex - 1]) {
      warning('Nothing to undo', 'No earlier workflow history is available.');
      return;
    }
    applyHistoryEntry(workflowHistory[historyIndex - 1], historyIndex - 1, 'Undo applied');
  };

  const handleRedo = () => {
    if (historyIndex >= workflowHistory.length - 1 || !workflowHistory[historyIndex + 1]) {
      warning('Nothing to redo', 'No later workflow history is available.');
      return;
    }
    applyHistoryEntry(workflowHistory[historyIndex + 1], historyIndex + 1, 'Redo applied');
  };

  const handleRestoreHistoryEntry = (entry: WorkflowHistoryEntry, index: number) => {
    applyHistoryEntry(entry, index, 'Workflow restored');
  };

  const handleAlignSelectedNodes = () => {
    if (!selectedWorkflow || selectedCanvasNodes.length < 2) {
      warning('Select more nodes', 'Choose at least two nodes to align them.');
      return;
    }

    const alignedX = Math.min(...selectedCanvasNodes.map(node => node.layout.x));
    const selectedIds = new Set(selectedCanvasNodes.map(node => node.id));
    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        nodes: (workflow.nodes || []).map(node =>
          selectedIds.has(node.id)
            ? { ...node, layout: { ...node.layout, x: alignedX } }
            : node,
        ),
      }),
      'Nodes aligned',
      'Selected nodes were aligned to the same vertical column.',
    );
  };

  const handleDistributeSelectedNodes = () => {
    if (!selectedWorkflow || selectedCanvasNodes.length < 3) {
      warning('Need three nodes', 'Select at least three nodes to distribute them.');
      return;
    }

    const orderedSelection = [...selectedCanvasNodes].sort((left, right) => left.layout.x - right.layout.x);
    const first = orderedSelection[0].layout.x;
    const last = orderedSelection[orderedSelection.length - 1].layout.x;
    const gap = (last - first) / (orderedSelection.length - 1 || 1);
    const selectedIds = new Map(
      orderedSelection.map((node, index) => [node.id, first + gap * index]),
    );

    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        nodes: (workflow.nodes || []).map(node =>
          selectedIds.has(node.id)
            ? {
                ...node,
                layout: {
                  ...node.layout,
                  x: selectedIds.get(node.id) || node.layout.x,
                },
              }
            : node,
        ),
      }),
      'Nodes distributed',
      'Selected nodes were distributed horizontally for cleaner spacing.',
    );
  };

  const handleToggleWidgetDock = (key: CanvasWidgetKey, dock: WidgetDockMode) => {
    setCanvasWidgetPreferences(current => ({
      ...current,
      [key]: {
        ...current[key],
        dock,
      },
    }));
  };

  const handleToggleWidgetWidth = (key: CanvasWidgetKey) => {
    setCanvasWidgetPreferences(current => ({
      ...current,
      [key]: {
        ...current[key],
        width: current[key].width > 304 ? 304 : 420,
      },
    }));
  };

  const getCanvasWidgetStyle = (key: CanvasWidgetKey) => {
    const preference = canvasWidgetPreferences[key];
    const fallback = canvasWidgetPositions[key];
    const canvasWidth = canvasRef.current?.clientWidth || 1320;
    const left =
      preference.dock === 'left'
        ? 16
        : preference.dock === 'right'
        ? Math.max(canvasWidth - preference.width - 16, 16)
        : fallback.x;

    return {
      left,
      top: fallback.y,
      width: preference.width,
    };
  };

  const handleActivateNeoPanel = (key: CanvasWidgetKey) => {
    if (neoActivePanel === key) {
      setNeoPanelOpen(current => !current);
      return;
    }

    setNeoActivePanel(key);
    setNeoPanelOpen(true);
    setNeoFloatingPanel(false);
  };

  const handleToggleNeoPanelFloating = () => {
    setNeoFloatingPanel(current => !current);
    setNeoPanelOpen(true);
  };

  const handleToggleNeoInspector = () => {
    setNeoInspectorCollapsed(current => !current);
  };

  const handleCanvasZoom = (direction: 'in' | 'out') => {
    setCanvasScale(current =>
      clamp(current + (direction === 'in' ? 0.1 : -0.1), 0.65, 1.35),
    );
  };

  const simulationNodeIds = useMemo(() => {
    if (!simulationState.active) return new Set<string>();
    return new Set(simulationPath.map(s => s.nodeId));
  }, [simulationState.active, simulationPath]);

  const simulationEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!simulationState.active) return ids;
    for (const step of simulationPath) {
      if (step.chosenEdgeId) ids.add(step.chosenEdgeId);
    }
    return ids;
  }, [simulationState.active, simulationPath]);

  const currentSimulationStep = simulationState.active
    ? simulationPath[simulationPath.length - 1] || null
    : null;

  /** Build a SimulationPathStep for a given nodeId from a normalised workflow. */
  const buildSimStep = (nodeId: string, workflow: Workflow): SimulationPathStep => {
    const node = getWorkflowNode(workflow, nodeId);
    const nodeType = node?.type || 'DELIVERY';
    return { nodeId, label: node?.name || nodeId, nodeType, note: getSimNodeNote(nodeType) };
  };

  const handleStartSimulation = () => {
    if (!selectedWorkflow) {
      warning('Simulation unavailable', 'Select a workflow first.');
      return;
    }
    const normalized = buildWorkflowFromGraph(
      normalizeWorkflowGraph(selectedWorkflow, capabilityLifecycle),
      capabilityLifecycle,
    );
    // Walk past the START node to get the actual first step.
    const startNode = getWorkflowNode(normalized, normalized.entryNodeId);
    const firstEdge = startNode ? getOutgoingWorkflowEdges(normalized, startNode.id)[0] : null;
    const firstNodeId = firstEdge?.toNodeId ?? startNode?.id;
    if (!firstNodeId) {
      warning('Simulation unavailable', 'Add connected nodes before running a simulation.');
      return;
    }
    const firstStep = buildSimStep(firstNodeId, normalized);
    setSimulationPath([firstStep]);
    setSimulationBranchPending(null);
    setSimulationState({ active: true, stepIndex: 0 });
    focusNodeOnCanvas(firstNodeId);
  };

  const handleSimulationStep = (direction: 'next' | 'prev') => {
    if (!simulationState.active || !selectedWorkflow) return;

    if (direction === 'prev') {
      // Dismiss pending branch choice first, then step back.
      if (simulationBranchPending) {
        setSimulationBranchPending(null);
        return;
      }
      if (simulationPath.length <= 1) return;
      const newPath = simulationPath.slice(0, -1);
      setSimulationPath(newPath);
      setSimulationState({ active: true, stepIndex: newPath.length - 1 });
      const prevId = newPath[newPath.length - 1]?.nodeId;
      if (prevId) setTimeout(() => focusNodeOnCanvas(prevId), 0);
      return;
    }

    // direction === 'next'
    if (simulationBranchPending) return; // user must choose a branch first

    const normalized = buildWorkflowFromGraph(
      normalizeWorkflowGraph(selectedWorkflow, capabilityLifecycle),
      capabilityLifecycle,
    );
    const current = simulationPath[simulationPath.length - 1];
    if (!current) return;
    const currentNode = getWorkflowNode(normalized, current.nodeId);
    if (!currentNode || currentNode.type === 'END') return;

    const outgoing = getOutgoingWorkflowEdges(normalized, currentNode.id);
    if (outgoing.length === 0) return;

    if (outgoing.length === 1) {
      // Single edge — auto-advance.
      const edge = outgoing[0];
      const updatedCurrent: SimulationPathStep = { ...current, chosenEdgeId: edge.id };
      const nextStep = buildSimStep(edge.toNodeId, normalized);
      const newPath = [...simulationPath.slice(0, -1), updatedCurrent, nextStep];
      setSimulationPath(newPath);
      setSimulationState({ active: true, stepIndex: newPath.length - 1 });
      setTimeout(() => focusNodeOnCanvas(edge.toNodeId), 0);
    } else {
      // Multiple edges — pause and show branch picker.
      const fromType = currentNode.type as 'DECISION' | 'PARALLEL_SPLIT';
      setSimulationBranchPending({
        fromNodeId: currentNode.id,
        fromLabel: currentNode.name,
        fromType,
        options: outgoing.map(edge => ({
          edgeId: edge.id,
          toNodeId: edge.toNodeId,
          toLabel: getWorkflowNode(normalized, edge.toNodeId)?.name || edge.toNodeId,
          conditionType: edge.conditionType,
          branchKey: edge.branchKey,
          edgeLabel: edge.label,
        })),
      });
    }
  };

  const handleBranchChoice = (option: SimulationBranchPending['options'][number]) => {
    if (!simulationBranchPending || !simulationState.active || !selectedWorkflow) return;
    const normalized = buildWorkflowFromGraph(
      normalizeWorkflowGraph(selectedWorkflow, capabilityLifecycle),
      capabilityLifecycle,
    );
    const current = simulationPath[simulationPath.length - 1];
    if (!current) return;
    const updatedCurrent: SimulationPathStep = { ...current, chosenEdgeId: option.edgeId };
    const nextStep = buildSimStep(option.toNodeId, normalized);
    const newPath = [...simulationPath.slice(0, -1), updatedCurrent, nextStep];
    setSimulationPath(newPath);
    setSimulationState({ active: true, stepIndex: newPath.length - 1 });
    setSimulationBranchPending(null);
    setTimeout(() => focusNodeOnCanvas(option.toNodeId), 0);
  };

  const handleResetSimulation = () => {
    setSimulationState({ active: false, stepIndex: 0 });
    setSimulationPath([]);
    setSimulationBranchPending(null);
  };

  const handleCreateWorkflow = (event: React.FormEvent) => {
    event.preventDefault();
    if (!workflowDraft.name.trim()) {
      return;
    }

    const workflowId = createWorkflowId(activeCapability.id, workflowDraft.name);
    const startNodeId = `NODE-${slugify(activeCapability.id)}-${slugify(workflowDraft.name)}-START`;
    const endNodeId = `NODE-${slugify(activeCapability.id)}-${slugify(workflowDraft.name)}-END`;
    const nextWorkflow = normalizeWorkflowForCapability({
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
            phase: getDefaultLifecycleStartPhaseId(capabilityLifecycle),
            layout: { x: 120, y: 48 },
          }, capabilityLifecycle),
          createWorkflowNode({
            id: endNodeId,
            name: 'End',
            type: 'END',
            phase: getDefaultLifecycleEndPhaseId(capabilityLifecycle),
            layout: {
              x: 520,
              y:
                48 +
                Math.max(
                  lifecyclePhaseIds.indexOf(
                    getDefaultLifecycleEndPhaseId(capabilityLifecycle),
                  ),
                  0,
                ) *
                  176,
            },
          }, capabilityLifecycle),
        ],
        edges: [
          createWorkflowEdge({
            fromNodeId: startNodeId,
            toNodeId: endNodeId,
            label: 'Complete without delivery',
          }),
        ],
        steps: [],
      });

    persistWorkflows(
      [...workflows, nextWorkflow],
      'Workflow created',
      `${nextWorkflow.name} is now available in ${activeCapability.name}.`,
    );
    setSelectedWorkflowId(nextWorkflow.id);
    setSelectedNodeId(startNodeId);
    setSelectedNodeIds([startNodeId]);
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
      'Standard workflow loaded',
      'The standard agent workflow is now available in the new studio.',
    );
    setSelectedWorkflowId(standardWorkflow.id);
    setSelectedNodeId(standardWorkflow.entryNodeId || null);
    setSelectedNodeIds(standardWorkflow.entryNodeId ? [standardWorkflow.entryNodeId] : []);
  };

  const handleLoadBrokerageWorkflow = async () => {
    const brokerageLifecycle = createBrokerageCapabilityLifecycle();
    const brokerageCapability = {
      ...activeCapability,
      lifecycle: brokerageLifecycle,
    };
    const brokerageWorkflow = createBrokerageCapabilityWorkflow(brokerageCapability);
    const existingBrokerageIndex = workflows.findIndex(
      workflow => workflow.id === brokerageWorkflow.id,
    );
    const nextWorkflows =
      existingBrokerageIndex >= 0
        ? workflows.map(workflow =>
            workflow.id === brokerageWorkflow.id ? brokerageWorkflow : workflow,
          )
        : [...workflows, brokerageWorkflow];

    try {
      await setCapabilityWorkspaceContent(activeCapability.id, {
        workflows: cloneWorkflowSet(nextWorkflows, brokerageLifecycle),
      });
      await updateCapabilityMetadata(activeCapability.id, {
        lifecycle: brokerageLifecycle,
      });
      setLifecycleDraft(brokerageLifecycle);
      setLastSavedAt(new Date().toISOString());
      success(
        'Brokerage workflow loaded',
        'The Brokerage SDLC flow and lifecycle lanes are now active for this capability.',
      );
      setSelectedWorkflowId(brokerageWorkflow.id);
      setSelectedNodeId(brokerageWorkflow.entryNodeId || null);
      setSelectedNodeIds(
        brokerageWorkflow.entryNodeId ? [brokerageWorkflow.entryNodeId] : [],
      );
    } catch {
      // Capability context mutation paths already emit failure toasts.
    }
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

    const copiedWorkflow = normalizeWorkflowForCapability({
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
          artifactContract: cloneArtifactContract(node.artifactContract),
          approvalPolicy: cloneApprovalPolicy(node.approvalPolicy),
          ownershipRule: cloneOwnershipRule(node.ownershipRule),
          etlConfig: node.etlConfig ? { ...node.etlConfig } : undefined,
          eventConfig: node.eventConfig ? { ...node.eventConfig } : undefined,
          alertConfig: node.alertConfig
            ? {
                ...node.alertConfig,
                notifyRoles: node.alertConfig.notifyRoles
                  ? [...node.alertConfig.notifyRoles]
                  : undefined,
              }
            : undefined,
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
      });

    persistWorkflows(
      [...workflows, copiedWorkflow],
      'Workflow duplicated',
      `${workflowToCopy.name} was copied into ${copiedWorkflow.name}.`,
    );
    setSelectedWorkflowId(copiedWorkflow.id);
    setSelectedNodeId(copiedWorkflow.entryNodeId || copiedWorkflow.nodes?.[0]?.id || null);
    setSelectedNodeIds(
      copiedWorkflow.entryNodeId || copiedWorkflow.nodes?.[0]?.id
        ? [copiedWorkflow.entryNodeId || copiedWorkflow.nodes?.[0]?.id || '']
        : [],
    );
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
    cancelDragLink();
  };

  const handleArchiveWorkflow = (workflowToArchive: Workflow | null = selectedWorkflow) => {
    if (!workflowToArchive || workflowToArchive.status === 'ARCHIVED') {
      return;
    }

    const nextWorkflows = workflows.map(workflow =>
      workflow.id === workflowToArchive.id
        ? {
            ...workflow,
            status: 'ARCHIVED' as const,
            archivedAt: new Date().toISOString(),
            publishState:
              workflow.publishState === 'PUBLISHED' ? 'VALIDATED' : workflow.publishState,
          }
        : workflow,
    );

    const nextActiveWorkflow = activeWorkflows.find(
      workflow => workflow.id !== workflowToArchive.id,
    );

    persistWorkflows(
      nextWorkflows,
      'Workflow archived',
      `${workflowToArchive.name} moved to the archived section.`,
    );
    setSelectedWorkflowId(nextActiveWorkflow?.id || '');
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
    cancelDragLink();
    setSimulationState({ active: false, stepIndex: 0 });
  };

  const handleRestoreWorkflow = (workflowToRestore: Workflow) => {
    if (workflowToRestore.status !== 'ARCHIVED') {
      return;
    }

    const nextWorkflows = workflows.map(workflow =>
      workflow.id === workflowToRestore.id
        ? {
            ...workflow,
            status: 'BETA' as const,
            archivedAt: undefined,
          }
        : workflow,
    );

    persistWorkflows(
      nextWorkflows,
      'Workflow restored',
      `${workflowToRestore.name} is active again in the library.`,
    );
    setSelectedWorkflowId(workflowToRestore.id);
    setSelectedNodeId(workflowToRestore.entryNodeId || workflowToRestore.nodes?.[0]?.id || null);
    setSelectedNodeIds(
      workflowToRestore.entryNodeId || workflowToRestore.nodes?.[0]?.id
        ? [workflowToRestore.entryNodeId || workflowToRestore.nodes?.[0]?.id || '']
        : [],
    );
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
    cancelDragLink();
    setSimulationState({ active: false, stepIndex: 0 });
  };

  const handleValidateWorkflow = () => {
    if (!selectedWorkflow) {
      return;
    }

    const validation = validateWorkflowGraph(selectedWorkflow, capabilityLifecycle);
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

    const validation = validateWorkflowGraph(selectedWorkflow, capabilityLifecycle);
    if (!validation.valid) {
      warning(
        'Publish blocked',
        'Resolve workflow validation issues before publishing this flow.',
      );
      return;
    }

    replaceSelectedWorkflow(
      workflow => ({ ...workflow, publishState: 'PUBLISHED', status: 'STABLE', lockedAt: new Date().toISOString() }),
      'Workflow published',
      `${selectedWorkflow.name} is now published for enterprise execution.`,
    );

    // Async server-side lock — fire-and-forget; reload fetches fresh lock state
    const capId = activeCapability.id;
    const wfId = selectedWorkflow.id;
    if (capId && wfId) {
      fetch(`/api/capabilities/${encodeURIComponent(capId)}/workflows/${encodeURIComponent(wfId)}/lock`, {
        method: 'POST',
      }).catch(err => console.warn('[WorkflowStudio] lock after publish failed:', err));
    }
  };

  const handleAutoLayout = () => {
    if (!selectedWorkflow) {
      return;
    }

    replaceSelectedWorkflow(
      workflow => autoLayoutWorkflowGraph(workflow, capabilityLifecycle),
      'Auto-layout applied',
      'The graph was re-aligned for readability in the new studio.',
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

  const handleStartWidgetDrag = (
    event: React.MouseEvent<HTMLDivElement>,
    key: CanvasWidgetKey,
  ) => {
    if (!canvasRef.current) {
      return;
    }

    if ((event.target as HTMLElement).closest('button')) {
      return;
    }

    const widgetElement = event.currentTarget.parentElement as HTMLDivElement | null;
    if (!widgetElement) {
      return;
    }

    const widgetBounds = widgetElement.getBoundingClientRect();
    setCanvasWidgetPreferences(current => ({
      ...current,
      [key]: {
        ...current[key],
        dock: 'free',
      },
    }));
    setDraggingWidget({
      key,
      offsetX: event.clientX - widgetBounds.left,
      offsetY: event.clientY - widgetBounds.top,
    });
  };

  const handleCanvasDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!selectedWorkflow || !canvasRef.current) {
      return;
    }

    event.preventDefault();
    const moveNodeId = event.dataTransfer.getData('application/singularity-node-move');
    const nodeTemplate = event.dataTransfer.getData('application/singularity-node-template');
    const nextCoordinates = getDropCoordinates(event, canvasRef.current, canvasScale);
    const laneAlignedLayout = getLaneAlignedLayout(
      nextCoordinates.x,
      nextCoordinates.y,
      snapToGrid,
      lifecyclePhaseIds,
    );

    if (moveNodeId) {
      replaceSelectedWorkflow(
        workflow => ({
          ...workflow,
          nodes: (workflow.nodes || []).map(node =>
            node.id === moveNodeId
              ? {
                  ...node,
                  phase: laneAlignedLayout.phase,
                  layout: {
                    x: laneAlignedLayout.x,
                    y: laneAlignedLayout.y,
                  },
                }
              : node,
          ),
        }),
        'Node repositioned',
        `The node moved into the ${phaseLabel(laneAlignedLayout.phase)} lane.`,
      );
      return;
    }

    if (!nodeTemplate) {
      return;
    }

    const parsedTemplate = JSON.parse(nodeTemplate) as {
      type: WorkflowNodeType;
      phase: Exclude<WorkItemPhase, 'BACKLOG' | 'DONE'>;
      label?: string;
      action?: string;
    };
    const nextNodeLayout = getLaneAlignedLayout(
      nextCoordinates.x,
      nextCoordinates.y,
      snapToGrid,
      lifecyclePhaseIds,
      parsedTemplate.phase,
    );

    const _baseNodeLabel =
      parsedTemplate.label ||
      NODE_TYPE_OPTIONS.find(option => option.type === parsedTemplate.type)?.label ||
      'New Node';
    const _configPrefix = designerConfig.namingConventions.prefixByNodeType[parsedTemplate.type];
    const _labelWithPrefix = _configPrefix
      ? `${_configPrefix} ${_baseNodeLabel}`
      : _baseNodeLabel;
    const _newNodeName = designerConfig.namingConventions.useTitleCase
      ? _labelWithPrefix
          .split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ')
      : _labelWithPrefix;

    // Control-flow nodes (DECISION, PARALLEL_SPLIT, PARALLEL_JOIN) are
    // orchestration primitives — they don't execute agent work, so they
    // should not have a pre-assigned agent. Delivery/approval nodes get
    // the first workspace agent as a starting point for the operator to refine.
    const _isControlNode =
      parsedTemplate.type === 'START' ||
      parsedTemplate.type === 'END' ||
      parsedTemplate.type === 'DECISION' ||
      parsedTemplate.type === 'PARALLEL_SPLIT' ||
      parsedTemplate.type === 'PARALLEL_JOIN';

    const _rawNode = createWorkflowNode({
      name: _newNodeName,
      type: parsedTemplate.type,
      phase: nextNodeLayout.phase,
      layout: {
        x: nextNodeLayout.x,
        y: nextNodeLayout.y,
      },
      agentId: _isControlNode ? undefined : workspace.agents[0]?.id,
      action:
        parsedTemplate.action ||
        (parsedTemplate.type === 'DECISION'
          ? 'Evaluate criteria and choose the correct downstream path.'
          : parsedTemplate.type === 'PARALLEL_SPLIT'
          ? 'Create multiple downstream tracks.'
          : parsedTemplate.type === 'PARALLEL_JOIN'
          ? 'Wait for parallel tracks and consolidate the outputs.'
          : parsedTemplate.type === 'GOVERNANCE_GATE'
          ? 'Check governance controls and evidence before continuing.'
          : parsedTemplate.type === 'HUMAN_APPROVAL'
          ? 'Pause for a human to review and approve or unblock.'
          : parsedTemplate.type === 'EVENT'
          ? 'Emit a workflow event for downstream automation, evidence, or observability.'
          : parsedTemplate.type === 'ALERT'
          ? 'Raise an alert with severity and routing so operators can respond quickly.'
          : parsedTemplate.type === 'RELEASE'
          ? 'Complete release work and attach evidence.'
          : parsedTemplate.type === 'HUMAN_TASK'
          ? 'Complete the assigned human task and mark it done.'
          : parsedTemplate.type === 'AGENT_TASK'
          ? 'Run the configured agent and capture outputs.'
          : parsedTemplate.type === 'SUB_WORKFLOW'
          ? 'Run a referenced workflow as a composable step.'
          : isLegacyEtlNodeType(parsedTemplate.type)
          ? 'Legacy ETL step imported from an older workflow.'
          : 'Complete the assigned work and prepare the next hand-off.'),
      eventConfig:
        parsedTemplate.type === 'EVENT'
          ? {
              eventName: 'workflow.event',
              eventSource: activeCapability.name,
              trigger: 'ON_SUCCESS',
            }
          : undefined,
      alertConfig:
        parsedTemplate.type === 'ALERT'
          ? {
              severity: 'WARNING',
              channel: 'IN_APP',
              requiresAcknowledgement: true,
            }
          : undefined,
      humanTaskConfig:
        parsedTemplate.type === 'HUMAN_TASK'
          ? { kind: 'HUMAN_TASK', instructions: 'Complete the required task and mark it done.' }
          : undefined,
      agentTaskConfig:
        parsedTemplate.type === 'AGENT_TASK'
          ? { kind: 'AGENT_TASK', agentRef: '', timeoutMinutes: 60 }
          : undefined,
    }, capabilityLifecycle);

    // HUMAN_APPROVAL nodes require an approvalPolicy at creation time.
    // Without one the execution engine parks the run with no assignment
    // target and the run stays stuck. Wire a sensible default so the
    // operator only needs to pick who approves, not rebuild the policy.
    const nextNode =
      parsedTemplate.type === 'HUMAN_APPROVAL' && !_rawNode.approvalPolicy
        ? { ..._rawNode, approvalPolicy: createDefaultApprovalPolicy(_rawNode) }
        : _rawNode;

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
              label: 'New hand-off',
              conditionType: 'DEFAULT',
            }),
          ],
        };
      },
      'Node added',
      connectFromNodeId
        ? 'A new node and hand-off were created.'
        : 'A new node was added to the workflow.',
    );
    setSelectedNodeId(nextNode.id);
    setSelectedNodeIds([nextNode.id]);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
    // Auto-open the inspector so the developer can immediately configure
    // the new node without an extra right-click → Advanced config step.
    if (isNeo) {
      setNeoInspectorCollapsed(false);
      setNeoInspectorMode('node');
    }
    // For SUB_WORKFLOW nodes, immediately open the workflow picker
    if (parsedTemplate.type === 'SUB_WORKFLOW') {
      setPendingSubWorkflowNodeId(nextNode.id);
      setIsSubWorkflowPickerOpen(true);
    }
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
            label: 'Hand-off',
            conditionType: 'DEFAULT',
          }),
        ],
      }),
      'Nodes connected',
      'A new hand-off was created.',
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

    // Prevent the browser from starting a native HTML drag operation on the
    // parent draggable node card. Without this, mousedown + move triggers
    // the node-card onDragStart instead of the port mouse-drag sequence.
    event.preventDefault();
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
    event: React.MouseEvent<HTMLElement>,
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
            label: 'Hand-off',
            conditionType: 'DEFAULT',
          }),
        ],
      }),
      'Nodes connected',
      'A new hand-off was created.',
    );
    setSelectedEdgeId(null);
    cancelDragLink();
  };

  const handleApplyNodeDraft = () => {
    if (!selectedWorkflow || !selectedNode || !nodeDraft) {
      return;
    }

    const laneAlignedLayout = getLaneAlignedLayout(
      nodeDraft.layout.x,
      nodeDraft.layout.y,
      snapToGrid,
      lifecyclePhaseIds,
      nodeDraft.phase,
    );
    const nextNodeDraft = {
      ...nodeDraft,
      phase: laneAlignedLayout.phase,
      layout: {
        x: laneAlignedLayout.x,
        y: laneAlignedLayout.y,
      },
    };

    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        nodes: (workflow.nodes || []).map(node =>
          node.id === selectedNode.id ? nextNodeDraft : node,
        ),
      }),
      'Node updated',
      `${nextNodeDraft.name} was updated in the workflow.`,
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

    const nodeToDelete = selectedNode;
    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        nodes: (workflow.nodes || []).filter(node => node.id !== nodeToDelete.id),
        edges: (workflow.edges || []).filter(
          edge => edge.fromNodeId !== nodeToDelete.id && edge.toNodeId !== nodeToDelete.id,
        ),
      }),
      'Node removed',
      `${nodeToDelete.name} and its transitions were removed from the graph.`,
    );
    setCollapsedNodeIds(current => {
      const next = new Set(current);
      next.delete(nodeToDelete.id);
      return next;
    });
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
    setIsNodeDetailsOpen(false);
    setSelectedNodeIds([]);
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
      'The selected hand-off was removed.',
    );
    setSelectedEdgeId(null);
  };

  const handleDuplicateNode = (nodeToCopy: WorkflowNode | null = selectedNode) => {
    if (!selectedWorkflow || !nodeToCopy) {
      return;
    }

    const copyName = createCopyName(
      nodeToCopy.name,
      nodes.map(node => node.name),
    );
    const duplicatedNode = createWorkflowNode({
      ...nodeToCopy,
      id: createDesignerCopyId('NODE', `${selectedWorkflow.id}-${copyName}`),
      name: copyName,
      layout: {
        x: nodeToCopy.layout.x + 48,
        y: nodeToCopy.layout.y,
      },
      approverRoles: nodeToCopy.approverRoles ? [...nodeToCopy.approverRoles] : undefined,
      exitCriteria: nodeToCopy.exitCriteria ? [...nodeToCopy.exitCriteria] : undefined,
      allowedToolIds: nodeToCopy.allowedToolIds ? [...nodeToCopy.allowedToolIds] : undefined,
      artifactContract: cloneArtifactContract(nodeToCopy.artifactContract),
      approvalPolicy: cloneApprovalPolicy(nodeToCopy.approvalPolicy),
      ownershipRule: cloneOwnershipRule(nodeToCopy.ownershipRule),
      etlConfig: nodeToCopy.etlConfig ? { ...nodeToCopy.etlConfig } : undefined,
      eventConfig: nodeToCopy.eventConfig ? { ...nodeToCopy.eventConfig } : undefined,
      alertConfig: nodeToCopy.alertConfig
        ? {
            ...nodeToCopy.alertConfig,
            notifyRoles: nodeToCopy.alertConfig.notifyRoles
              ? [...nodeToCopy.alertConfig.notifyRoles]
              : undefined,
          }
        : undefined,
    }, capabilityLifecycle);

    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        nodes: [...(workflow.nodes || []), duplicatedNode],
      }),
      'Node duplicated',
      `${nodeToCopy.name} was duplicated as ${duplicatedNode.name}.`,
    );
    setSelectedNodeId(duplicatedNode.id);
    setSelectedNodeIds([duplicatedNode.id]);
    setSelectedEdgeId(null);
    setIsQuickEditOpen(false);
  };

  const openQuickEdit = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
    setIsQuickEditOpen(true);
  };

  const openNodeDetailsModal = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setConnectFromNodeId(null);
    setIsNodeDetailsOpen(true);
  };

  const handleToggleNodeMinimized = (nodeId: string) => {
    setCollapsedNodeIds(current => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleDeleteNodeFromCanvas = (node: WorkflowNode) => {
    if (!selectedWorkflow) {
      return;
    }

    if (node.type === 'START') {
      warning('Start node locked', 'The START node cannot be removed from the workflow.');
      return;
    }

    replaceSelectedWorkflow(
      workflow => ({
        ...workflow,
        nodes: (workflow.nodes || []).filter(item => item.id !== node.id),
        edges: (workflow.edges || []).filter(
          edge => edge.fromNodeId !== node.id && edge.toNodeId !== node.id,
        ),
      }),
      'Node removed',
      `${node.name} and its transitions were removed from the graph.`,
    );
    setCollapsedNodeIds(current => {
      const next = new Set(current);
      next.delete(node.id);
      return next;
    });
    if (selectedNodeId === node.id) {
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setConnectFromNodeId(null);
      setIsNodeDetailsOpen(false);
    }
  };

  const renderNodeEditorFields = (surface: 'inspector' | 'modal') => {
    if (!nodeDraft) {
      return null;
    }

    const assignedAgent = nodeDraft.agentId
      ? workspace.agents.find(agent => agent.id === nodeDraft.agentId) || null
      : null;
    const assignedAgentContract = assignedAgent
      ? normalizeAgentOperatingContract(assignedAgent.contract, {
          description: assignedAgent.objective || assignedAgent.role,
          suggestedInputArtifacts: assignedAgent.inputArtifacts,
          expectedOutputArtifacts: assignedAgent.outputArtifacts,
        })
      : null;
    const agentSuggestedInputs = formatAgentArtifactSuggestionLines(
      assignedAgentContract?.suggestedInputArtifacts,
    );
    const agentExpectedOutputs = formatAgentArtifactSuggestionLines(
      assignedAgentContract?.expectedOutputArtifacts,
    );
    const hasAgentArtifactSuggestions =
      agentSuggestedInputs.length > 0 || agentExpectedOutputs.length > 0;
    const applyAssignedAgentArtifactSuggestions = () => {
      if (!hasAgentArtifactSuggestions) {
        return;
      }

      setNodeDraft(current =>
        current
          ? {
              ...current,
              artifactContract: {
                ...(current.artifactContract || {}),
                requiredInputs: mergeArtifactLines(
                  current.artifactContract?.requiredInputs || [],
                  agentSuggestedInputs,
                ),
                expectedOutputs: mergeArtifactLines(
                  current.artifactContract?.expectedOutputs || [],
                  agentExpectedOutputs,
                ),
                notes: current.artifactContract?.notes,
              },
            }
          : current,
      );
    };

    return (
      <div className="grid gap-4">
        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
          <span>Name</span>
          <input
            value={nodeDraft.name}
            onChange={event =>
              setNodeDraft(current =>
                current ? { ...current, name: event.target.value } : current,
              )
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
            {lifecyclePhaseIds.map(phase => (
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

        {assignedAgent ? (
          <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                  Agent IO Suggestions
                </p>
                <p className="mt-1 text-xs leading-relaxed text-secondary">
                  {assignedAgent.name} carries advisory artifact defaults from its operating
                  contract. Workflow-level artifact requirements still win.
                </p>
              </div>
              <button
                type="button"
                onClick={applyAssignedAgentArtifactSuggestions}
                disabled={!hasAgentArtifactSuggestions}
                className="enterprise-button enterprise-button-secondary"
              >
                Apply suggestions
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Suggested inputs
                </p>
                {agentSuggestedInputs.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {agentSuggestedInputs.map(item => (
                      <StatusBadge key={item} tone="neutral">
                        {item}
                      </StatusBadge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    This agent does not suggest default inputs.
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-outline-variant/30 bg-white/85 px-4 py-3">
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Expected outputs
                </p>
                {agentExpectedOutputs.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {agentExpectedOutputs.map(item => (
                      <StatusBadge key={item} tone="brand">
                        {item}
                      </StatusBadge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    This agent does not define default outputs.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {nodeDraft.type === 'EVENT' ? (
          <>
            <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
              <span>Event Name</span>
              <input
                value={nodeDraft.eventConfig?.eventName || ''}
                onChange={event =>
                  setNodeDraft(current =>
                    current
                      ? {
                          ...current,
                          eventConfig: {
                            ...(current.eventConfig || {}),
                            eventName: event.target.value,
                          },
                        }
                      : current,
                  )
                }
                className="enterprise-input"
              />
            </label>
            <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
              <span>Event Source</span>
              <input
                value={nodeDraft.eventConfig?.eventSource || ''}
                onChange={event =>
                  setNodeDraft(current =>
                    current
                      ? {
                          ...current,
                          eventConfig: {
                            ...(current.eventConfig || {}),
                            eventSource: event.target.value,
                          },
                        }
                      : current,
                  )
                }
                className="enterprise-input"
              />
            </label>
            <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
              <span>Emit Trigger</span>
              <select
                value={nodeDraft.eventConfig?.trigger || 'ON_SUCCESS'}
                onChange={event =>
                  setNodeDraft(current =>
                    current
                      ? {
                          ...current,
                          eventConfig: {
                            ...(current.eventConfig || {}),
                            trigger: event.target.value as 'ON_ENTER' | 'ON_SUCCESS' | 'ON_FAILURE',
                          },
                        }
                      : current,
                  )
                }
                className="enterprise-input"
              >
                <option value="ON_ENTER">On enter</option>
                <option value="ON_SUCCESS">On success</option>
                <option value="ON_FAILURE">On failure</option>
              </select>
            </label>
            <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
              <span>Payload Template</span>
              <textarea
                rows={4}
                value={nodeDraft.eventConfig?.payloadTemplate || ''}
                onChange={event =>
                  setNodeDraft(current =>
                    current
                      ? {
                          ...current,
                          eventConfig: {
                            ...(current.eventConfig || {}),
                            payloadTemplate: event.target.value,
                          },
                        }
                      : current,
                  )
                }
                className="enterprise-input min-h-[7rem]"
              />
            </label>
          </>
        ) : null}

        {nodeDraft.type === 'ALERT' ? (
          <>
            <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
              <span>Alert Severity</span>
              <select
                value={nodeDraft.alertConfig?.severity || 'WARNING'}
                onChange={event =>
                  setNodeDraft(current =>
                    current
                      ? {
                          ...current,
                          alertConfig: {
                            ...(current.alertConfig || {}),
                            severity: event.target.value as 'INFO' | 'WARNING' | 'CRITICAL',
                          },
                        }
                      : current,
                  )
                }
                className="enterprise-input"
              >
                <option value="INFO">Info</option>
                <option value="WARNING">Warning</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </label>
            <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
              <span>Alert Channel</span>
              <input
                value={nodeDraft.alertConfig?.channel || ''}
                onChange={event =>
                  setNodeDraft(current =>
                    current
                      ? {
                          ...current,
                          alertConfig: {
                            ...(current.alertConfig || {}),
                            channel: event.target.value as WorkflowAlertChannel,
                          },
                        }
                      : current,
                  )
                }
                className="enterprise-input"
              />
            </label>
            <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
              <span>Notify Roles</span>
              <input
                value={(nodeDraft.alertConfig?.notifyRoles || []).join(', ')}
                onChange={event =>
                  setNodeDraft(current =>
                    current
                      ? {
                          ...current,
                          alertConfig: {
                            ...(current.alertConfig || {}),
                            notifyRoles: event.target.value
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
              <span>Alert Message</span>
              <textarea
                rows={4}
                value={nodeDraft.alertConfig?.messageTemplate || ''}
                onChange={event =>
                  setNodeDraft(current =>
                    current
                      ? {
                          ...current,
                          alertConfig: {
                            ...(current.alertConfig || {}),
                            messageTemplate: event.target.value,
                          },
                        }
                      : current,
                  )
                }
                className="enterprise-input min-h-[7rem]"
              />
            </label>
          </>
        ) : null}

        {isLegacyEtlNodeType(nodeDraft.type) ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
            This node came from a legacy ETL-style workflow. It still renders here for compatibility, but this new studio is optimized for agent workflows.
          </div>
        ) : null}

        <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
            Standard Artifacts
          </p>
          <p className="mt-1 text-xs leading-relaxed text-secondary">
            Define the standard input and output documents this SDLC step expects and produces.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
              <span>Primary Input Reference</span>
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
            <ArtifactTemplateNudge
              artifactId={nodeDraft.inputArtifactId}
              status={evaluateArtifactReference(
                nodeDraft.inputArtifactId,
                workspace.artifacts,
              )}
              onOpenDesigner={id =>
                navigate(
                  `/artifact-designer${id ? `?artifactId=${encodeURIComponent(id)}` : ''}`,
                )
              }
            />
          </div>
          <div className="space-y-2">
            <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
              <span>Primary Output Reference</span>
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
            <ArtifactTemplateNudge
              artifactId={nodeDraft.outputArtifactId}
              status={evaluateArtifactReference(
                nodeDraft.outputArtifactId,
                workspace.artifacts,
              )}
              onOpenDesigner={id =>
                navigate(
                  `/artifact-designer${id ? `?artifactId=${encodeURIComponent(id)}` : ''}`,
                )
              }
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
            <span>Standard Input Documents</span>
            <textarea
              rows={5}
              value={(nodeDraft.artifactContract?.requiredInputs || []).join('\n')}
              onChange={event =>
                setNodeDraft(current =>
                  current
                    ? {
                        ...current,
                        artifactContract: {
                          ...(current.artifactContract || {}),
                          requiredInputs: splitArtifactLines(event.target.value),
                          expectedOutputs: current.artifactContract?.expectedOutputs || [],
                          notes: current.artifactContract?.notes,
                        },
                      }
                    : current,
                )
              }
              className="enterprise-input min-h-[8rem]"
            />
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
            <span>Standard Output Documents</span>
            <textarea
              rows={5}
              value={(nodeDraft.artifactContract?.expectedOutputs || []).join('\n')}
              onChange={event =>
                setNodeDraft(current =>
                  current
                    ? {
                        ...current,
                        artifactContract: {
                          ...(current.artifactContract || {}),
                          requiredInputs: current.artifactContract?.requiredInputs || [],
                          expectedOutputs: splitArtifactLines(event.target.value),
                          notes: current.artifactContract?.notes,
                        },
                      }
                    : current,
                )
              }
              className="enterprise-input min-h-[8rem]"
            />
          </label>
        </div>
        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
          <span>Artifact Guidance</span>
          <textarea
            rows={4}
            value={nodeDraft.artifactContract?.notes || ''}
            onChange={event =>
              setNodeDraft(current =>
                current
                  ? {
                      ...current,
                      artifactContract: {
                        ...(current.artifactContract || {}),
                        requiredInputs: current.artifactContract?.requiredInputs || [],
                        expectedOutputs: current.artifactContract?.expectedOutputs || [],
                        notes: event.target.value || undefined,
                      },
                    }
                  : current,
              )
            }
            className="enterprise-input min-h-[7rem]"
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
            className="enterprise-input min-h-[7rem]"
          />
        </label>
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
            className="enterprise-input"
          />
        </label>
        <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                Approval Policy
              </p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Human approval steps can route to named users, teams, and capability roles. Workflow approval policy drives assignments; legacy approver roles remain as a compatibility fallback.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setNodeDraft(current =>
                  current
                    ? {
                        ...current,
                        approvalPolicy: current.approvalPolicy
                          ? undefined
                          : createDefaultApprovalPolicy(current),
                      }
                    : current,
                )
              }
              className="enterprise-button enterprise-button-secondary"
            >
              {nodeDraft.approvalPolicy ? 'Clear policy' : 'Add policy'}
            </button>
          </div>
        </div>
        {nodeDraft.approvalPolicy && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                <span>Policy Name</span>
                <input
                  value={nodeDraft.approvalPolicy.name}
                  onChange={event =>
                    setNodeDraft(current =>
                      current
                        ? {
                            ...current,
                            approvalPolicy: {
                              ...(current.approvalPolicy || createDefaultApprovalPolicy(current)),
                              name: event.target.value || `${current.name} Approval`,
                            },
                          }
                        : current,
                    )
                  }
                  className="enterprise-input"
                />
              </label>
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                <span>Approval Mode</span>
                <select
                  value={nodeDraft.approvalPolicy.mode}
                  onChange={event =>
                    setNodeDraft(current =>
                      current
                        ? {
                            ...current,
                            approvalPolicy: {
                              ...(current.approvalPolicy || createDefaultApprovalPolicy(current)),
                              mode: event.target.value as ApprovalMode,
                            },
                          }
                        : current,
                    )
                  }
                  className="enterprise-input"
                >
                  <option value="ANY_ONE">Any one approver</option>
                  <option value="ALL_REQUIRED">All required</option>
                  <option value="QUORUM">Quorum</option>
                </select>
              </label>
            </div>
            <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
              <span>Policy Description</span>
              <textarea
                rows={3}
                value={nodeDraft.approvalPolicy.description || ''}
                onChange={event =>
                  setNodeDraft(current =>
                    current
                      ? {
                          ...current,
                          approvalPolicy: {
                            ...(current.approvalPolicy || createDefaultApprovalPolicy(current)),
                            description: event.target.value || undefined,
                          },
                        }
                      : current,
                  )
                }
                className="enterprise-input min-h-[6rem]"
              />
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                <span>Minimum Approvals</span>
                <input
                  type="number"
                  min={1}
                  value={nodeDraft.approvalPolicy.minimumApprovals || ''}
                  onChange={event =>
                    setNodeDraft(current =>
                      current
                        ? {
                            ...current,
                            approvalPolicy: {
                              ...(current.approvalPolicy || createDefaultApprovalPolicy(current)),
                              minimumApprovals: event.target.value
                                ? Math.max(1, Number(event.target.value))
                                : undefined,
                            },
                          }
                        : current,
                    )
                  }
                  className="enterprise-input"
                />
              </label>
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                <span>Escalate After (Minutes)</span>
                <input
                  type="number"
                  min={1}
                  value={nodeDraft.approvalPolicy.escalationAfterMinutes || ''}
                  onChange={event =>
                    setNodeDraft(current =>
                      current
                        ? {
                            ...current,
                            approvalPolicy: {
                              ...(current.approvalPolicy || createDefaultApprovalPolicy(current)),
                              escalationAfterMinutes: event.target.value
                                ? Math.max(1, Number(event.target.value))
                                : undefined,
                            },
                          }
                        : current,
                    )
                  }
                  className="enterprise-input"
                />
              </label>
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                <span>Due By</span>
                <input
                  type="datetime-local"
                  value={toDateTimeLocalValue(nodeDraft.approvalPolicy.dueAt)}
                  onChange={event =>
                    setNodeDraft(current =>
                      current
                        ? {
                            ...current,
                            approvalPolicy: {
                              ...(current.approvalPolicy || createDefaultApprovalPolicy(current)),
                              dueAt: toIsoDateTimeValue(event.target.value),
                            },
                          }
                        : current,
                    )
                  }
                  className="enterprise-input"
                />
              </label>
            </div>
            <label className="flex items-center gap-3 text-sm text-secondary">
              <input
                type="checkbox"
                checked={Boolean(nodeDraft.approvalPolicy.delegationAllowed)}
                onChange={event =>
                  setNodeDraft(current =>
                    current
                      ? {
                          ...current,
                          approvalPolicy: {
                            ...(current.approvalPolicy || createDefaultApprovalPolicy(current)),
                            delegationAllowed: event.target.checked,
                          },
                        }
                      : current,
                  )
                }
                className="h-4 w-4 rounded border-outline-variant/40 text-primary focus:ring-primary"
              />
              Allow delegated approval decisions for this step
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                <span>Approver Teams</span>
                <select
                  multiple
                  value={getApprovalPolicyTargetIds(nodeDraft.approvalPolicy, 'TEAM')}
                  onChange={event => {
                    const teamIds = Array.from(event.target.selectedOptions).map(option => option.value);
                    setNodeDraft(current => {
                      if (!current) {
                        return current;
                      }
                      const currentPolicy = current.approvalPolicy || createDefaultApprovalPolicy(current);
                      const otherTargets = currentPolicy.targets.filter(target => target.targetType !== 'TEAM');
                      return {
                        ...current,
                        approvalPolicy: {
                          ...currentPolicy,
                          targets: [
                            ...otherTargets,
                            ...teamIds.map(teamId => ({
                              targetType: 'TEAM' as const,
                              targetId: teamId,
                              label: workspaceTeamNameById.get(teamId) || teamId,
                            })),
                          ],
                        },
                      };
                    });
                  }}
                  className="enterprise-input min-h-[8rem]"
                >
                  {workspaceTeamOptions.map(team => (
                    <option key={team.id} value={team.id}>
                      {team.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                <span>Approver Users</span>
                <select
                  multiple
                  value={getApprovalPolicyTargetIds(nodeDraft.approvalPolicy, 'USER')}
                  onChange={event => {
                    const userIds = Array.from(event.target.selectedOptions).map(option => option.value);
                    setNodeDraft(current => {
                      if (!current) {
                        return current;
                      }
                      const currentPolicy = current.approvalPolicy || createDefaultApprovalPolicy(current);
                      const otherTargets = currentPolicy.targets.filter(target => target.targetType !== 'USER');
                      return {
                        ...current,
                        approvalPolicy: {
                          ...currentPolicy,
                          targets: [
                            ...otherTargets,
                            ...userIds.map(userId => ({
                              targetType: 'USER' as const,
                              targetId: userId,
                              label: workspaceUserNameById.get(userId) || userId,
                            })),
                          ],
                        },
                      };
                    });
                  }}
                  className="enterprise-input min-h-[8rem]"
                >
                  {workspaceUserOptions.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                <span>Capability Roles</span>
                <textarea
                  rows={5}
                  value={getApprovalPolicyTargetIds(nodeDraft.approvalPolicy, 'CAPABILITY_ROLE').join(', ')}
                  onChange={event => {
                    const roleIds = parseCommaList(event.target.value);
                    setNodeDraft(current => {
                      if (!current) {
                        return current;
                      }
                      const currentPolicy = current.approvalPolicy || createDefaultApprovalPolicy(current);
                      const otherTargets = currentPolicy.targets.filter(
                        target => target.targetType !== 'CAPABILITY_ROLE',
                      );
                      return {
                        ...current,
                        approverRoles: roleIds,
                        approvalPolicy: {
                          ...currentPolicy,
                          targets: [
                            ...otherTargets,
                            ...roleIds.map(roleId => ({
                              targetType: 'CAPABILITY_ROLE' as const,
                              targetId: roleId,
                              label: roleId,
                            })),
                          ],
                        },
                      };
                    });
                  }}
                  className="enterprise-input min-h-[8rem]"
                />
              </label>
            </div>
          </>
        )}
        <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
            Ownership & Routing
          </p>
          <p className="mt-1 text-xs leading-relaxed text-secondary">
            Phase ownership sets the default queue. Step ownership overrides let you route a single step to a different team, define escalation teams, and require explicit handoff acceptance.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
            <span>Primary Owner Team Override</span>
            <select
              value={nodeDraft.ownershipRule?.primaryOwnerTeamId || ''}
              onChange={event =>
                setNodeDraft(current =>
                  current
                    ? {
                        ...current,
                        ownershipRule: {
                          ...(current.ownershipRule || createDefaultOwnershipRule()),
                          primaryOwnerTeamId: event.target.value || undefined,
                        },
                      }
                    : current,
                )
              }
              className="enterprise-input"
            >
              <option value="">Use phase default</option>
              {workspaceTeamOptions.map(team => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
            <span>Require Handoff Acceptance</span>
            <div className="rounded-2xl border border-outline-variant/25 bg-white px-4 py-3">
              <label className="flex items-center gap-3 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={Boolean(nodeDraft.ownershipRule?.requireHandoffAcceptance)}
                  onChange={event =>
                    setNodeDraft(current =>
                      current
                        ? {
                            ...current,
                            ownershipRule: {
                              ...(current.ownershipRule || createDefaultOwnershipRule()),
                              requireHandoffAcceptance: event.target.checked,
                            },
                          }
                        : current,
                    )
                  }
                  className="h-4 w-4 rounded border-outline-variant/40 text-primary focus:ring-primary"
                />
                Receiving team must accept the handoff before this step becomes active
              </label>
            </div>
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
            <span>Secondary Owner Teams</span>
            <select
              multiple
              value={nodeDraft.ownershipRule?.secondaryOwnerTeamIds || []}
              onChange={event =>
                setNodeDraft(current =>
                  current
                    ? {
                        ...current,
                        ownershipRule: {
                          ...(current.ownershipRule || createDefaultOwnershipRule()),
                          secondaryOwnerTeamIds: Array.from(event.target.selectedOptions).map(
                            option => option.value,
                          ),
                        },
                      }
                    : current,
                )
              }
              className="enterprise-input min-h-[8rem]"
            >
              {workspaceTeamOptions.map(team => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
            <span>Approval Teams</span>
            <select
              multiple
              value={nodeDraft.ownershipRule?.approvalTeamIds || []}
              onChange={event =>
                setNodeDraft(current =>
                  current
                    ? {
                        ...current,
                        ownershipRule: {
                          ...(current.ownershipRule || createDefaultOwnershipRule()),
                          approvalTeamIds: Array.from(event.target.selectedOptions).map(
                            option => option.value,
                          ),
                        },
                      }
                    : current,
                )
              }
              className="enterprise-input min-h-[8rem]"
            >
              {workspaceTeamOptions.map(team => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
            <span>Escalation Teams</span>
            <select
              multiple
              value={nodeDraft.ownershipRule?.escalationTeamIds || []}
              onChange={event =>
                setNodeDraft(current =>
                  current
                    ? {
                        ...current,
                        ownershipRule: {
                          ...(current.ownershipRule || createDefaultOwnershipRule()),
                          escalationTeamIds: Array.from(event.target.selectedOptions).map(
                            option => option.value,
                          ),
                        },
                      }
                    : current,
                )
              }
              className="enterprise-input min-h-[8rem]"
            >
              {workspaceTeamOptions.map(team => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </label>
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
                        option => (option as HTMLOptionElement).value as ToolAdapterId,
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
          <p className="text-[0.72rem] font-medium normal-case tracking-normal text-secondary">
            This allowlist is the real execution gate for the step. Agent preferred tools stay advisory and do not bypass these permissions.
          </p>
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
        <div className={cn('flex flex-wrap gap-3', surface === 'modal' && 'justify-end')}>
          {surface === 'modal' ? (
            <button
              type="button"
              onClick={() => setIsNodeDetailsOpen(false)}
              className="enterprise-button enterprise-button-secondary"
            >
              Close
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleApplyNodeDraft}
            className="enterprise-button enterprise-button-primary"
          >
            Save node
          </button>
        </div>
      </div>
    );
  };

  const commandActions = (() => {
    const nodeActions = orderedNodes.slice(0, 12).map(node => ({
      id: `node-${node.id}`,
      label: `Focus node: ${node.name}`,
      subtitle: phaseLabel(node.phase),
      run: () => {
        selectNode(node.id);
        focusNodeOnCanvas(node.id);
      },
    }));

    const workflowActions = activeWorkflows.slice(0, 8).map(workflow => ({
      id: `workflow-${workflow.id}`,
      label: `Open workflow: ${workflow.name}`,
      subtitle: workflow.summary || workflow.workflowType || 'Workflow',
      run: () => {
        setSelectedWorkflowId(workflow.id);
        clearCanvasSelection();
      },
    }));

    const studioActions = [
      {
        id: 'new-workflow',
        label: 'Create new workflow',
        subtitle: 'Open the workflow creation modal',
        run: () => setIsCreateWorkflowOpen(true),
      },
      {
        id: 'undo',
        label: 'Undo last change',
        subtitle: 'Restore the previous workflow revision',
        run: handleUndo,
      },
      {
        id: 'redo',
        label: 'Redo last change',
        subtitle: 'Re-apply the next workflow revision',
        run: handleRedo,
      },
      {
        id: 'validate',
        label: 'Validate workflow',
        subtitle: 'Run graph validation checks',
        run: handleValidateWorkflow,
      },
      {
        id: 'publish',
        label: 'Publish workflow',
        subtitle: 'Publish the selected workflow for execution',
        run: handlePublishWorkflow,
      },
      ...(selectedWorkflow
        ? [
            {
              id: 'archive-selected',
              label: 'Archive selected workflow',
              subtitle: 'Move the current workflow into the archived section',
              run: () => handleArchiveWorkflow(selectedWorkflow),
            },
          ]
        : []),
      {
        id: 'auto-layout',
        label: 'Auto-layout canvas',
        subtitle: 'Reorganize nodes for readability',
        run: handleAutoLayout,
      },
      {
        id: 'align',
        label: 'Align selected nodes',
        subtitle: 'Align the current multi-selection',
        run: handleAlignSelectedNodes,
      },
      {
        id: 'distribute',
        label: 'Distribute selected nodes',
        subtitle: 'Evenly spread the selected nodes',
        run: handleDistributeSelectedNodes,
      },
      {
        id: 'simulation',
        label: simulationState.active ? 'Reset simulation' : 'Start simulation',
        subtitle: simulationState.active
          ? 'Clear the current simulation highlight'
          : 'Preview a sample execution path',
        run: simulationState.active ? handleResetSimulation : handleStartSimulation,
      },
    ];

    return [...studioActions, ...workflowActions, ...nodeActions];
  })();

  const filteredCommandActions = commandActions.filter(action =>
    `${action.label} ${action.subtitle}`.toLowerCase().includes(commandQuery.trim().toLowerCase()),
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      // Cmd/Ctrl+S — force-save the current workflow state.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (selectedWorkflow && activeWorkflows.length > 0) {
          void persistWorkflows(activeWorkflows, 'Saved', 'Workflow layout saved.');
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (isTypingTarget) {
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (selectedEdgeId) {
          handleDeleteSelectedEdge();
        } else if (selectedNodeId) {
          handleDeleteSelectedNode();
        }
        return;
      }

      if (event.key === 'Escape') {
        setIsCommandPaletteOpen(false);
        setCommandQuery('');
        setIsNeoOverflowOpen(false);
        setIsNeoHelpOpen(false);
        setNeoContextMenu(null);
        setConnectFromNodeId(null);
        setIsCanvasPanMode(false);
        setCanvasPanDrag(null);
        cancelDragLink();
        return;
      }

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setCanvasScale(1);
        return;
      }

      if (event.key.toLowerCase() === 'l' && isNeo) {
        event.preventDefault();
        setNeoLaneVisibility(current => !current);
        return;
      }

      if (event.key.toLowerCase() === 'h' && isNeo) {
        event.preventDefault();
        setIsCanvasPanMode(current => !current);
        setCanvasPanDrag(null);
        return;
      }

      if (event.key === '?' && isNeo) {
        event.preventDefault();
        setIsNeoHelpOpen(current => !current);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === '=') {
        event.preventDefault();
        handleCanvasZoom('in');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === '-') {
        event.preventDefault();
        handleCanvasZoom('out');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && selectedNode) {
        event.preventDefault();
        handleDuplicateNode(selectedNode);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeWorkflows, commandActions, isNeo, persistWorkflows, selectedEdgeId, selectedNode, selectedNodeId, selectedWorkflow]);

  const publishState = selectedWorkflow ? getWorkflowPublishState(selectedWorkflow) : 'DRAFT';
  const nodeDimensions = getWorkflowNodeDimensions();
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
  const minimapViewport = {
    left: (canvasViewport.scrollLeft / Math.max(canvasScale, 0.01)) * minimapScale,
    top: (canvasViewport.scrollTop / Math.max(canvasScale, 0.01)) * minimapScale,
    width:
      (canvasViewport.clientWidth / Math.max(canvasScale, 0.01)) * minimapScale,
    height:
      (canvasViewport.clientHeight / Math.max(canvasScale, 0.01)) * minimapScale,
  };

  useEffect(() => {
    if (!marqueeSelection) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!graphStageRef.current) {
        return;
      }

      const bounds = graphStageRef.current.getBoundingClientRect();
      setMarqueeSelection(current =>
        current
          ? {
              ...current,
              currentX: clamp((event.clientX - bounds.left) / canvasScale, 0, graphWidth),
              currentY: clamp((event.clientY - bounds.top) / canvasScale, 0, graphHeight),
            }
          : current,
      );
    };

    const handleMouseUp = () => {
      setMarqueeSelection(current => {
        if (!current) {
          return current;
        }

        const left = Math.min(current.startX, current.currentX);
        const right = Math.max(current.startX, current.currentX);
        const top = Math.min(current.startY, current.currentY);
        const bottom = Math.max(current.startY, current.currentY);

        const selectedIds = orderedNodes
          .filter(node => {
            const nodeLeft = node.layout.x;
            const nodeRight = node.layout.x + nodeDimensions.width;
            const nodeTop = node.layout.y;
            const nodeBottom = node.layout.y + nodeDimensions.height;
            return !(
              nodeRight < left ||
              nodeLeft > right ||
              nodeBottom < top ||
              nodeTop > bottom
            );
          })
          .map(node => node.id);

        if (selectedIds.length) {
          setSelectedNodeIds(selectedIds);
          setSelectedNodeId(selectedIds[selectedIds.length - 1] || null);
          setSelectedEdgeId(null);
          setConnectFromNodeId(null);
        } else {
          clearCanvasSelection();
        }

        return null;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [canvasScale, graphHeight, graphWidth, marqueeSelection, nodeDimensions.height, nodeDimensions.width, orderedNodes]);
  const recentHistoryEntries = [...workflowHistory]
    .map((entry, index) => ({ entry, index }))
    .reverse()
    .slice(0, 5)
    .map(({ entry, index }) => ({
      entry,
      actualIndex: workflowHistory.length - 1 - index,
    }));
  const filteredLibraryWorkflows = activeWorkflows.filter(workflow =>
    `${workflow.name} ${workflow.summary || ''}`
      .toLowerCase()
      .includes(workflowLibraryQuery.trim().toLowerCase()),
  );
  const neoWidgetMeta: Array<{
    key: CanvasWidgetKey;
    label: string;
    accentClassName: string;
    Icon: typeof WorkflowIcon;
  }> = [
    {
      key: 'library',
      label: 'Workflow Library',
      Icon: WorkflowIcon,
      accentClassName: 'text-sky-300',
    },
    {
      key: 'palette',
      label: 'Agent Step Kit',
      Icon: Wrench,
      accentClassName: 'text-emerald-300',
    },
    {
      key: 'tree',
      label: 'Workflow Tree',
      Icon: PanelLeft,
      accentClassName: 'text-violet-300',
    },
    {
      key: 'insights',
      label: 'Workflow Insights',
      Icon: ShieldCheck,
      accentClassName: 'text-amber-300',
    },
  ];
  const activeNeoPanelMeta =
    neoWidgetMeta.find(item => item.key === neoActivePanel) || neoWidgetMeta[0];
  const renderNeoInsightsContent = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        {([
          ['overview', 'Overview'],
          ['validation', 'Validation'],
          ['history', 'History'],
          ['simulation', 'Simulation'],
        ] as Array<[NeoInsightsTab, string]>).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setNeoInsightsTab(tab)}
            className={cn(
              'workflow-neo-segment',
              neoInsightsTab === tab && 'workflow-neo-segment-active',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="designer-palette-chip">
          <WorkflowIcon size={13} />
          {visibleNodeCount} nodes
        </div>
        <div className="designer-palette-chip">
          <Route size={13} />
          {edges.length} hand-offs
        </div>
        <div className="designer-palette-chip">
          <CheckCircle2 size={13} />
          {validationState.all.length ? `${validationState.all.length} issues` : 'Graph valid'}
        </div>
        <div className="designer-palette-chip">
          <Undo2 size={13} />
          {workflowHistory.length} revisions
        </div>
      </div>

      {neoInsightsTab === 'overview' ? (
        <section className="designer-palette-section">
          <div className="designer-palette-section-header">
            <div className="flex items-center gap-2">
              <WorkflowIcon size={14} className="text-sky-300" />
              <p className="designer-palette-section-title">Workflow overview</p>
            </div>
            <StatusBadge tone={PUBLISH_STATE_TONE[publishState]}>{publishState}</StatusBadge>
          </div>
          <div className="space-y-3 text-sm leading-relaxed text-slate-300">
            <p>{workflowNarrative?.overview}</p>
            <p className="text-slate-400">{workflowNarrative?.execution}</p>
            <p className="text-slate-400">{workflowNarrative?.ownership}</p>
            <p className="text-slate-400">{workflowNarrative?.path}</p>
          </div>
        </section>
      ) : null}

      {neoInsightsTab === 'validation' ? (
        <section className="designer-palette-section">
          <div className="designer-palette-section-header">
            <div className="flex items-center gap-2">
              <ScanLine size={14} className="text-amber-300" />
              <p className="designer-palette-section-title">Validation</p>
            </div>
            <button
              type="button"
              onClick={handleValidateWorkflow}
              className="designer-widget-action"
            >
              Run checks
            </button>
          </div>
          <div className="space-y-2">
            {validationState.all.length ? (
              validationState.all.slice(0, 8).map(error => (
                <div
                  key={error.id}
                  className="rounded-2xl border border-red-400/30 bg-red-500/10 px-3 py-3 text-xs leading-relaxed text-red-100"
                >
                  {error.message}
                </div>
              ))
            ) : (
              <p className="text-xs leading-relaxed text-slate-400">
                START, END, branching, join, and governance checks are all passing.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {neoInsightsTab === 'history' ? (
        <section className="designer-palette-section">
          <div className="designer-palette-section-header">
            <div className="flex items-center gap-2">
              <Undo2 size={14} className="text-violet-300" />
              <p className="designer-palette-section-title">History</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleUndo} className="designer-widget-action">
                Undo
              </button>
              <button type="button" onClick={handleRedo} className="designer-widget-action">
                Redo
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {recentHistoryEntries.map(({ entry, actualIndex }) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => handleRestoreHistoryEntry(entry, actualIndex)}
                className={cn(
                  'w-full rounded-2xl border px-3 py-3 text-left transition',
                  actualIndex === historyIndex
                    ? 'border-sky-400/40 bg-sky-500/15'
                    : 'border-slate-800 bg-slate-950/70 hover:bg-slate-900',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-white">{entry.label}</p>
                    <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-400">
                      {entry.description || 'Workflow state snapshot'}
                    </p>
                  </div>
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-slate-500">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {neoInsightsTab === 'simulation' ? (
        <section className="designer-palette-section">
          {/* ── Header ────────────────────────────────────────── */}
          <div className="designer-palette-section-header">
            <div className="flex items-center gap-2">
              <Play size={14} className="text-emerald-300" />
              <p className="designer-palette-section-title">Simulation</p>
            </div>
            <button
              type="button"
              onClick={simulationState.active ? handleResetSimulation : handleStartSimulation}
              className="designer-widget-action"
            >
              {simulationState.active ? 'Reset' : 'Start'}
            </button>
          </div>

          {/* ── Navigation controls ───────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleSimulationStep('prev')}
              disabled={
                !simulationState.active ||
                (simulationPath.length <= 1 && !simulationBranchPending)
              }
              className="designer-widget-action disabled:cursor-not-allowed disabled:opacity-50"
            >
              {simulationBranchPending ? 'Cancel choice' : 'Previous'}
            </button>
            <button
              type="button"
              onClick={() => handleSimulationStep('next')}
              disabled={
                !simulationState.active ||
                Boolean(simulationBranchPending) ||
                currentSimulationStep?.nodeType === 'END'
              }
              className="designer-widget-action disabled:cursor-not-allowed disabled:opacity-50"
              title={simulationBranchPending ? 'Choose a branch below first' : undefined}
            >
              Next
            </button>
            {simulationState.active ? (
              <span className="ml-auto text-[0.625rem] text-slate-400">
                {simulationPath.length} step{simulationPath.length !== 1 ? 's' : ''}
              </span>
            ) : null}
          </div>

          {/* ── Branch picker ─────────────────────────────────── */}
          {simulationBranchPending ? (
            <div className="mt-3 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-3 py-3">
              <div className="flex items-center gap-2">
                {simulationBranchPending.fromType === 'PARALLEL_SPLIT' ? (
                  <Split size={13} className="shrink-0 text-sky-300" />
                ) : (
                  <GitBranch size={13} className="shrink-0 text-sky-300" />
                )}
                <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-sky-200">
                  {simulationBranchPending.fromType === 'PARALLEL_SPLIT'
                    ? 'Parallel split — pick a branch to trace'
                    : 'Decision point — pick a route'}
                </p>
              </div>
              <p className="mt-1 text-[0.6875rem] text-slate-400">
                <span className="font-semibold text-slate-200">{simulationBranchPending.fromLabel}</span>
                {simulationBranchPending.fromType === 'PARALLEL_SPLIT'
                  ? ' fans out to all branches in production. Trace one path here.'
                  : ' routes work based on outcome. Choose which path to follow.'}
              </p>
              <div className="mt-3 space-y-2">
                {simulationBranchPending.options.map(option => (
                  <button
                    key={option.edgeId}
                    type="button"
                    onClick={() => handleBranchChoice(option)}
                    className="group flex w-full items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2.5 text-left transition hover:border-sky-500/50 hover:bg-sky-500/10"
                  >
                    <ArrowRight
                      size={13}
                      className="mt-0.5 shrink-0 text-slate-500 transition group-hover:text-sky-300"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-100">{option.toLabel}</p>
                      <p className="mt-0.5 text-[0.6rem] text-slate-400">
                        {getConditionLabel(option.conditionType, option.branchKey)}
                        {option.edgeLabel && option.edgeLabel !== option.branchKey
                          ? ` · ${option.edgeLabel}`
                          : ''}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* ── Path so far ───────────────────────────────────── */}
          <div className="mt-3">
            {simulationPath.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {simulationPath.map((step, index) => (
                  <React.Fragment key={`${step.nodeId}-${index}`}>
                    <div
                      className={cn(
                        'rounded-xl border px-2.5 py-1.5 text-[0.6875rem] font-semibold transition',
                        index === simulationPath.length - 1 && !simulationBranchPending
                          ? 'border-sky-400/50 bg-sky-500/20 text-sky-50'
                          : index === simulationPath.length - 1 && simulationBranchPending
                          ? 'border-amber-400/50 bg-amber-500/15 text-amber-100'
                          : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
                      )}
                      title={step.note}
                    >
                      {step.label}
                    </div>
                    {index < simulationPath.length - 1 ? (
                      <ArrowRight size={11} className="shrink-0 text-slate-500" />
                    ) : null}
                  </React.Fragment>
                ))}
                {simulationBranchPending ? (
                  <>
                    <ArrowRight size={11} className="shrink-0 text-sky-400 opacity-60" />
                    <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[0.6875rem] font-semibold text-sky-400 opacity-80">
                      ?
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-slate-400">
                {selectedWorkflow
                  ? 'Press Start to walk the workflow step by step. At decision or parallel-split nodes you will choose which branch to trace.'
                  : 'Select a workflow from the library first.'}
              </p>
            )}
          </div>

          {/* ── Current step note ─────────────────────────────── */}
          {currentSimulationStep?.note && !simulationBranchPending ? (
            <div className="mt-2 rounded-xl border border-slate-700/60 bg-slate-900/50 px-3 py-2">
              <p className="text-[0.6875rem] text-slate-400">{currentSimulationStep.note}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );

  const renderNeoPrimaryPanelContent = () => {
    if (neoActivePanel === 'library') {
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setIsCreateWorkflowOpen(true)}
                className="enterprise-button enterprise-button-primary"
              >
                <Plus size={14} />
                New
              </button>
              <button
                type="button"
                onClick={handleLoadStandardWorkflow}
                className="enterprise-button enterprise-button-secondary"
              >
                <Sparkles size={14} />
                Standard
              </button>
              <button
                type="button"
                onClick={() => void handleLoadBrokerageWorkflow()}
                className="enterprise-button enterprise-button-secondary"
              >
                <Sparkles size={14} />
                Brokerage
              </button>
            </div>
            <input
              value={workflowLibraryQuery}
              onChange={event => setWorkflowLibraryQuery(event.target.value)}
              placeholder="Search workflows"
              className="enterprise-input"
            />
          </div>
          <div className="space-y-2">
            {filteredLibraryWorkflows.map(workflow => (
              <div
                key={workflow.id}
                className={cn(
                  'workflow-neo-list-row',
                  selectedWorkflow?.id === workflow.id && 'workflow-neo-list-row-active',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWorkflowId(workflow.id);
                    clearCanvasSelection();
                    setNeoInspectorMode('workflow');
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold text-white">{workflow.name}</p>
                  <p className="mt-1 truncate text-[0.6875rem] text-slate-400">
                    {workflow.summary || workflow.workflowType || 'Workflow'}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={PUBLISH_STATE_TONE[getWorkflowPublishState(workflow)]}>
                    {getWorkflowPublishState(workflow)}
                  </StatusBadge>
                  <button
                    type="button"
                    onClick={() => handleDuplicateWorkflow(workflow)}
                    className="designer-widget-icon-action"
                    title="Duplicate workflow"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {archivedWorkflows.length ? (
            <div className="designer-palette-section">
              <div className="designer-palette-section-header">
                <p className="designer-palette-section-title">Archived</p>
                <StatusBadge tone="neutral">{archivedWorkflows.length}</StatusBadge>
              </div>
              <div className="space-y-2">
                {archivedWorkflows.slice(0, 4).map(workflow => (
                  <div key={workflow.id} className="workflow-neo-list-row">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{workflow.name}</p>
                      <p className="mt-1 text-[0.6875rem] text-slate-400">Archived workflow</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestoreWorkflow(workflow)}
                      className="designer-widget-action"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    if (neoActivePanel === 'palette') {
      return (
        <div className="space-y-3">
          <button
            type="button"
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
          <div className="max-h-[calc(100vh-18rem)] space-y-3 overflow-y-auto pr-1">
            {paletteGroups.map(group => (
              <div
                key={group.title}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-3"
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
                <div className="mt-3 grid gap-2">
                  {group.items.map(item => {
                    const Icon = getNodeIcon(item.type);
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
                              action: item.action,
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
                            {NODE_TYPE_OPTIONS.find(option => option.type === item.type)?.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (neoActivePanel === 'tree') {
      return (
        <div className="max-h-[calc(100vh-18rem)] space-y-3 overflow-y-auto pr-1">
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
                  <div
                    key={node.id}
                    className={cn(
                      'workflow-neo-list-row',
                      selectedNodeId === node.id && 'workflow-neo-list-row-active',
                    )}
                  >
                    <button
                      type="button"
                      onClick={event => {
                        selectNode(node.id, event.shiftKey);
                        focusNodeOnCanvas(node.id);
                      }}
                      onDoubleClick={() => {
                        focusNodeOnCanvas(node.id);
                        openQuickEdit(node.id);
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="truncate text-sm font-medium text-white">{node.name}</span>
                    </button>
                    {(nodeValidationDetails.get(node.id) || []).length ? (
                      <span
                        className="rounded-full border border-red-400/50 bg-red-500/15 px-2 py-1 text-[0.625rem] font-bold text-red-50"
                        title={nodeValidationDetails.get(node.id)?.[0]}
                      >
                        {(nodeValidationDetails.get(node.id) || []).length}
                      </span>
                    ) : null}
                  </div>
                ))}
            </div>
          ))}
        </div>
      );
    }

    return <div className="max-h-[calc(100vh-18rem)] overflow-y-auto pr-1">{renderNeoInsightsContent()}</div>;
  };

  const renderWorkflowLibraryContent = (surface: 'card' | 'widget') => (
    <>
      <div className={cn('flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between', surface === 'widget' && 'xl:flex-col xl:justify-start')}>
        <div>
          <p className="page-context">Workflow Library</p>
          <p className={cn('text-sm leading-relaxed text-secondary', surface === 'widget' && 'mt-1 text-[0.75rem]')}>
            {isNeo
              ? 'Create, switch, archive, and restore workflows without leaving the canvas.'
              : 'Keep reusable workflow variants above the canvas and switch between them without covering the graph.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateWorkflowOpen(true)}
            className="enterprise-button enterprise-button-secondary"
          >
            <Plus size={14} />
            New workflow
          </button>
          <button
            type="button"
            onClick={() => handleLoadStandardWorkflow()}
            className="enterprise-button enterprise-button-brand-muted"
          >
            <Sparkles size={14} />
            Standard
          </button>
          <button
            type="button"
            onClick={() => void handleLoadBrokerageWorkflow()}
            className="enterprise-button enterprise-button-brand-muted"
          >
            <Sparkles size={14} />
            Brokerage
          </button>
          {selectedWorkflow ? (
            <>
              <button
                type="button"
                onClick={() => handleDuplicateWorkflow()}
                className="enterprise-button enterprise-button-brand-muted"
              >
                <Copy size={14} />
                Copy selected
              </button>
              <button
                type="button"
                onClick={() => handleArchiveWorkflow()}
                className="enterprise-button enterprise-button-secondary"
              >
                <Archive size={14} />
                Archive selected
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className={cn('mt-4 flex gap-3 overflow-x-auto pb-1', surface === 'widget' && 'max-h-[14rem] flex-col overflow-y-auto overflow-x-hidden pr-1')}>
        {activeWorkflows.map(workflow => (
          <div
            key={workflow.id}
            className={cn(
              'rounded-2xl border px-4 py-3 transition',
              surface === 'widget' ? 'min-w-0' : 'min-w-[17rem]',
              selectedWorkflow?.id === workflow.id
                ? 'border-primary/25 bg-primary/6 shadow-[0_10px_26px_rgba(0,132,61,0.08)]'
                : 'border-outline-variant/60 bg-surface-container-low hover:border-outline hover:bg-white',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedWorkflowId(workflow.id);
                  setSelectedNodeId(null);
                  setSelectedNodeIds([]);
                  setSelectedEdgeId(null);
                  setConnectFromNodeId(null);
                  cancelDragLink();
                  setSimulationState({ active: false, stepIndex: 0 });
                }}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-semibold text-on-surface">{workflow.name}</p>
                <p className="mt-1 text-[0.6875rem] text-secondary">
                  {workflow.workflowType || 'Custom'} · {workflow.steps.length} projected steps
                </p>
                <p className="mt-2 text-[0.6875rem] leading-relaxed text-outline">
                  {workflow.summary || 'No summary yet. Add a description to explain the delivery intent.'}
                </p>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title={`Duplicate ${workflow.name}`}
                  onClick={() => handleDuplicateWorkflow(workflow)}
                  className="rounded-xl border border-outline-variant/60 bg-white p-2 text-secondary transition hover:bg-surface-container-low hover:text-on-surface"
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  title={`Archive ${workflow.name}`}
                  onClick={() => handleArchiveWorkflow(workflow)}
                  className="rounded-xl border border-amber-200 bg-white p-2 text-amber-700 transition hover:bg-amber-50"
                >
                  <Archive size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {archivedWorkflows.length ? (
        <div className="mt-4 rounded-2xl border border-outline-variant/60 bg-surface-container-low px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="page-context">Archived Workflows</p>
              <p className="text-sm leading-relaxed text-secondary">
                Archived workflows stay preserved here and can be restored at any time.
              </p>
            </div>
            <StatusBadge tone="neutral">{archivedWorkflows.length} archived</StatusBadge>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {archivedWorkflows.map(workflow => (
              <div
                key={workflow.id}
                className="rounded-2xl border border-outline-variant/60 bg-white px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-on-surface">
                      {workflow.name}
                    </p>
                    <p className="mt-1 text-[0.6875rem] text-secondary">
                      {workflow.workflowType || 'Custom'} · archived
                      {workflow.archivedAt
                        ? ` ${new Date(workflow.archivedAt).toLocaleDateString()}`
                        : ''}
                    </p>
                    <p className="mt-2 text-[0.6875rem] leading-relaxed text-outline">
                      {workflow.summary || 'No summary yet. Add a description to explain the delivery intent.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestoreWorkflow(workflow)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    <ArchiveRestore size={14} />
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );

  const renderNeoQuickEditFields = () => {
    if (!nodeDraft) {
      return null;
    }

    return (
      <div className="grid gap-4">
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
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
            <span>Phase</span>
            <select
              value={nodeDraft.phase}
              onChange={event =>
                setNodeDraft(current =>
                  current ? { ...current, phase: event.target.value as WorkItemPhase } : current,
                )
              }
              className="enterprise-input"
            >
              {lifecyclePhaseIds.map(phase => (
                <option key={phase} value={phase}>
                  {phaseLabel(phase)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
            <span>Agent</span>
            <select
              value={nodeDraft.agentId || ''}
              onChange={event =>
                setNodeDraft(current =>
                  current ? { ...current, agentId: event.target.value || undefined } : current,
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
        </div>
        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
          <span>Action</span>
          <input
            value={nodeDraft.action || ''}
            onChange={event =>
              setNodeDraft(current => (current ? { ...current, action: event.target.value } : current))
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
                current ? { ...current, description: event.target.value } : current,
              )
            }
            className="enterprise-input min-h-[6rem]"
          />
        </label>
      </div>
    );
  };

  const renderNeoInspectorContent = () => {
    const mode = neoInspectorMode;

    return (
      <div className="workflow-neo-inspector-panel">
        <div className="workflow-neo-inspector-header">
          <div>
            <p className="designer-widget-kicker">Inspector</p>
            <p className="mt-2 text-sm font-semibold text-white">
              {mode === 'node'
                ? selectedNode?.name || 'Node'
                : mode === 'edge'
                ? selectedEdge?.label || 'Transition'
                : selectedWorkflow?.name || 'Workflow'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleNeoInspector}
              className="designer-widget-icon-action"
              title="Minimize inspector"
            >
              <Minimize2 size={14} />
            </button>
            <button
              type="button"
              onClick={() => setNeoInspectorMode('workflow')}
              className={cn(
                'workflow-neo-segment',
                mode === 'workflow' && 'workflow-neo-segment-active',
              )}
            >
              Workflow
            </button>
            {selectedNode ? (
              <button
                type="button"
                onClick={() => setNeoInspectorMode('node')}
                className={cn(
                  'workflow-neo-segment',
                  mode === 'node' && 'workflow-neo-segment-active',
                )}
              >
                Node
              </button>
            ) : null}
            {selectedEdge ? (
              <button
                type="button"
                onClick={() => setNeoInspectorMode('edge')}
                className={cn(
                  'workflow-neo-segment',
                  mode === 'edge' && 'workflow-neo-segment-active',
                )}
              >
                Edge
              </button>
            ) : null}
          </div>
        </div>

        <div className="workflow-neo-inspector-body">
          {mode === 'workflow' ? (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="designer-palette-metric">
                  <span className="designer-palette-metric-label">Type</span>
                  <span className="designer-palette-metric-value">
                    {selectedWorkflow?.workflowType || 'Custom'}
                  </span>
                </div>
                <div className="designer-palette-metric">
                  <span className="designer-palette-metric-label">Scope</span>
                  <span className="designer-palette-metric-value">
                    {selectedWorkflow?.scope || 'CAPABILITY'}
                  </span>
                </div>
                <div className="designer-palette-metric">
                  <span className="designer-palette-metric-label">Nodes</span>
                  <span className="designer-palette-metric-value">{visibleNodeCount}</span>
                </div>
                <div className="designer-palette-metric">
                  <span className="designer-palette-metric-label">Hand-offs</span>
                  <span className="designer-palette-metric-value">{edges.length}</span>
                </div>
              </div>
              <div className="designer-palette-section">
                <div className="designer-palette-section-header">
                  <p className="designer-palette-section-title">Summary</p>
                  <StatusBadge tone={PUBLISH_STATE_TONE[publishState]}>{publishState}</StatusBadge>
                </div>
                <p className="text-sm leading-relaxed text-slate-300">
                  {selectedWorkflow?.summary ||
                    'Use the library, node kit, and canvas to shape a workflow for execution.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateWorkflowOpen(true)}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Plus size={14} />
                  New
                </button>
                {selectedWorkflow ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDuplicateWorkflow()}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      <Copy size={14} />
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => handleArchiveWorkflow()}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      <Archive size={14} />
                      Archive
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {mode === 'node' && selectedNode && nodeDraft ? (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="designer-palette-metric">
                  <span className="designer-palette-metric-label">Inputs</span>
                  <span className="designer-palette-metric-value">
                    {getNodeArtifactInputs(nodeDraft).length}
                  </span>
                </div>
                <div className="designer-palette-metric">
                  <span className="designer-palette-metric-label">Outputs</span>
                  <span className="designer-palette-metric-value">
                    {getNodeArtifactOutputs(nodeDraft).length}
                  </span>
                </div>
              </div>
              {nodeDraft.artifactContract?.notes ? (
                <div className="designer-palette-section">
                  <div className="designer-palette-section-header">
                    <p className="designer-palette-section-title">Artifact Guidance</p>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-300">
                    {nodeDraft.artifactContract.notes}
                  </p>
                </div>
              ) : null}
              {renderNeoQuickEditFields()}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleApplyNodeDraft}
                  className="enterprise-button enterprise-button-primary"
                >
                  Save Quick Edit
                </button>
                <button
                  type="button"
                  onClick={() => setIsNodeDetailsOpen(true)}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Wrench size={14} />
                  Advanced Config
                </button>
              </div>
            </div>
          ) : null}

          {mode === 'edge' && selectedEdge && edgeDraft ? (
            <div className="space-y-4">
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
                <span>Condition</span>
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
                      current ? { ...current, branchKey: event.target.value || undefined } : current,
                    )
                  }
                  className="enterprise-input"
                />
              </label>
              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                <span>Handoff Protocol</span>
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
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleApplyEdgeDraft}
                  className="enterprise-button enterprise-button-primary"
                >
                  Save Edge
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelectedEdge}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Delete Edge
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  };
  const neoCanvasMargins = {
    left: isNeo ? (neoPanelOpen && !neoFloatingPanel ? '25rem' : '5.5rem') : undefined,
    right: isNeo ? (neoInspectorCollapsed ? '4.75rem' : '22.5rem') : undefined,
    top: isNeo ? '8.5rem' : undefined,
    bottom: isNeo ? '2.5rem' : undefined,
  };

  return (
    <div className={cn('space-y-4', isNeo && 'h-full space-y-0')}>
      {!isNeo ? (
      <div className="section-card section-card-brand">
        <div className="section-card-header">
          <div>
            <p className="page-context">New Designer</p>
            <h1 className="page-title">Workflow Studio</h1>
            <p className="page-subtitle">
              A new agent-workflow designer with floating in-canvas widgets, a cleaner
              orchestration canvas, and a dedicated inspector. The existing designer at
              `/designer` remains unchanged.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="brand">Experimental</StatusBadge>
            <StatusBadge tone={PUBLISH_STATE_TONE[publishState]}>{publishState}</StatusBadge>
          </div>
        </div>
      </div>
      ) : null}

      {!selectedWorkflow && !isNeo ? (
        <SectionCard
          title="No workflow graph yet"
          description={
            archivedWorkflows.length
              ? 'All workflows are archived. Restore one from the archive or create a new graph workflow.'
              : 'Start with the shared Standard or Brokerage workflow templates, or create a capability-specific graph workflow in the new studio.'
          }
          icon={WorkflowIcon}
        >
          <EmptyState
            title={archivedWorkflows.length ? 'No active workflows' : 'Build the first workflow'}
            description={
              archivedWorkflows.length
                ? 'Archived workflows are preserved below. Restore one to bring it back into the active library.'
                : 'Create a graph-based agent workflow with hand-offs, approvals, and runtime controls.'
            }
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
                  onClick={() => void handleLoadBrokerageWorkflow()}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Sparkles size={16} />
                  Load Brokerage SDLC
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
          {archivedWorkflows.length ? (
            <div className="mt-6 rounded-[1.3rem] border border-outline-variant/60 bg-surface-container-low px-5 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="page-context">Archived Workflows</p>
                  <p className="text-sm leading-relaxed text-secondary">
                    Archived workflows stay available for restore and reference. Nothing is deleted permanently.
                  </p>
                </div>
                <StatusBadge tone="neutral">{archivedWorkflows.length} archived</StatusBadge>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {archivedWorkflows.map(workflow => (
                  <div
                    key={workflow.id}
                    className="rounded-2xl border border-outline-variant/60 bg-white px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-on-surface">
                          {workflow.name}
                        </p>
                        <p className="mt-1 text-[0.6875rem] text-secondary">
                          {workflow.workflowType || 'Custom'} · archived
                          {workflow.archivedAt
                            ? ` ${new Date(workflow.archivedAt).toLocaleDateString()}`
                            : ''}
                        </p>
                        <p className="mt-2 text-[0.6875rem] leading-relaxed text-outline">
                          {workflow.summary || 'No summary yet. Add a description to explain the delivery intent.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRestoreWorkflow(workflow)}
                        className="enterprise-button enterprise-button-secondary"
                      >
                        <ArchiveRestore size={14} />
                        Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </SectionCard>
      ) : (
        <div
          className={cn(
            'workflow-lab-shell',
            isNeo && 'workflow-lab-shell-neo',
            isNeo && (neoTheme === 'light' ? 'workflow-theme-light' : 'workflow-theme-dark'),
          )}
        >
          {!isNeo ? (
          <div className="workflow-lab-topbar">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="brand">{selectedWorkflow.workflowType || 'Custom'}</StatusBadge>
                <StatusBadge tone="neutral">
                  {selectedWorkflow.templateId ? 'Shared template' : selectedWorkflow.scope || 'CAPABILITY'}
                </StatusBadge>
                {validationState.all.length > 0 ? (
                  <StatusBadge tone="warning">
                    {validationState.all.length} validation issue{validationState.all.length > 1 ? 's' : ''}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="success">Graph valid</StatusBadge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-secondary">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 bg-white px-2.5 py-1">
                  <Route size={14} />
                  {getWorkflowEdges(selectedWorkflow).length} hand-offs
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 bg-white px-2.5 py-1">
                  <WorkflowIcon size={14} />
                  {visibleNodeCount} visible nodes
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 bg-white px-2.5 py-1">
                  <ShieldCheck size={14} />
                  Agent-first studio
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 bg-white px-2.5 py-1">
                  <Undo2 size={14} />
                  {historyIndex + 1}/{Math.max(workflowHistory.length, 1)} history
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 bg-white px-2.5 py-1">
                  {lastSavedAt
                    ? `Auto-saved ${new Date(lastSavedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : 'Auto-save ready'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="workflow-lab-toolbar">
                <button
                  type="button"
                  onClick={handleUndo}
                  className="workflow-lab-toolbar-button"
                >
                  <Undo2 size={16} />
                  Undo
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
                  className="workflow-lab-toolbar-button"
                >
                  <Redo2 size={16} />
                  Redo
                </button>
                <button
                  type="button"
                  onClick={() => setIsCommandPaletteOpen(true)}
                  className="workflow-lab-toolbar-button"
                >
                  <Search size={16} />
                  Search
                </button>
                <button
                  type="button"
                  onClick={handleValidateWorkflow}
                  className="workflow-lab-toolbar-button"
                >
                  <ScanLine size={16} />
                  Validate
                </button>
                <button
                  type="button"
                  onClick={handleAutoLayout}
                  className="workflow-lab-toolbar-button"
                >
                  <LayoutTemplate size={16} />
                  Auto-layout
                </button>
                <button
                  type="button"
                  onClick={openLifecycleManager}
                  className="workflow-lab-toolbar-button"
                >
                  <Split size={16} />
                  Lifecycle
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasScale(1)}
                  className="workflow-lab-toolbar-button"
                >
                  <Route size={16} />
                  Fit
                </button>
                <button
                  type="button"
                  onClick={() => setSnapToGrid(current => !current)}
                  className={cn(
                    'workflow-lab-toolbar-button',
                    snapToGrid && 'bg-primary/8 text-primary',
                  )}
                >
                  Snap {snapToGrid ? 'On' : 'Off'}
                </button>
                <button
                  type="button"
                  onClick={handleAlignSelectedNodes}
                  className="workflow-lab-toolbar-button"
                >
                  Align
                </button>
                <button
                  type="button"
                  onClick={handleDistributeSelectedNodes}
                  className="workflow-lab-toolbar-button"
                >
                  Distribute
                </button>
                <button
                  type="button"
                  onClick={simulationState.active ? handleResetSimulation : handleStartSimulation}
                  className={cn(
                    'workflow-lab-toolbar-button',
                    simulationState.active && 'bg-sky-100 text-sky-700',
                  )}
                >
                  {simulationState.active ? 'Reset Sim' : 'Simulate'}
                </button>
                <button
                  type="button"
                  onClick={handleLoadStandardWorkflow}
                  className="workflow-lab-toolbar-button"
                >
                  <Sparkles size={16} />
                  Standard
                </button>
                <button
                  type="button"
                  onClick={() => void handleLoadBrokerageWorkflow()}
                  className="workflow-lab-toolbar-button"
                >
                  <Sparkles size={16} />
                  Brokerage
                </button>
                <button
                  type="button"
                  onClick={handleExportWorkflow}
                  className="workflow-lab-toolbar-button"
                >
                  <Download size={16} />
                  Export
                </button>
              </div>
              {selectedNode ? (
                <button
                  type="button"
                  onClick={() => setIsNodeDetailsOpen(true)}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Wrench size={16} />
                  Edit selected
                </button>
              ) : null}
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
                onClick={() => handleArchiveWorkflow()}
                className="enterprise-button enterprise-button-secondary"
              >
                <Archive size={16} />
                Archive
              </button>
            </div>
          </div>
          ) : null}

          <div className={cn(!isNeo && 'grid gap-0 xl:grid-cols-[minmax(0,1fr),24rem]')}>
            <main className={cn('min-w-0 bg-surface-container-low/50', !isNeo && 'border-b border-outline-variant/60 xl:border-b-0 xl:border-r')}>
              <div className={cn(!isNeo ? 'px-5 py-5' : 'h-full p-0')}>
                {!isNeo ? (
                <div className="mb-4 rounded-[1.4rem] border border-outline-variant/60 bg-white px-4 py-4 shadow-[0_12px_30px_rgba(12,23,39,0.05)]">
                  {renderWorkflowLibraryContent('card')}
                </div>
                ) : null}

                <div
                  ref={canvasRef}
                  className={cn(
                    'workflow-canvas-shell relative',
                    isNeo
                      ? 'workflow-canvas-shell-neo h-[calc(100vh-2rem)] min-h-[100vh]'
                      : 'h-[calc(100vh-25rem)] min-h-[46rem]',
                    isNeo && isCanvasPanMode && 'workflow-canvas-pan-mode',
                    canvasPanDrag && 'workflow-canvas-panning',
                  )}
                  onClick={event => {
                    if (event.target === event.currentTarget) {
                      clearCanvasSelection();
                    }
                  }}
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
                  {isNeo ? (
                    <>
                      <div className="workflow-neo-commandbar">
                        <div className="workflow-neo-commandbar-title">
                          <button
                            type="button"
                            onClick={() => navigate('/home')}
                            className="workflow-lab-toolbar-button shrink-0"
                            title="Back to home"
                          >
                            <ArrowLeft size={16} />
                            <span className="hidden xl:inline">Home</span>
                          </button>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">
                              {selectedWorkflow?.name || 'Create a new workflow graph'}
                              {selectedWorkflow?.version ? (
                                <span className="ml-2 rounded-full bg-slate-700 px-1.5 py-0.5 text-[0.6rem] font-bold text-slate-300">
                                  v{selectedWorkflow.version}
                                </span>
                              ) : null}
                            </p>
                            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[0.6875rem] text-slate-400">
                              <StatusBadge tone={selectedWorkflow ? PUBLISH_STATE_TONE[publishState] : 'neutral'}>
                                {selectedWorkflow ? publishState : 'No workflow selected'}
                              </StatusBadge>
                              {selectedWorkflow?.lockedAt ? (
                                <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-300">
                                  🔒 Locked · <button type="button" className="underline" onClick={async () => { if (!activeCapability.id || !selectedWorkflow?.id) return; setIsLocking(true); try { await fetch(`/api/capabilities/${activeCapability.id}/workflows/${selectedWorkflow.id}/unlock`, { method: 'POST' }); window.location.reload(); } catch { /* ignore */ } finally { setIsLocking(false); } }}>{isLocking ? 'Unlocking…' : 'Unlock'}</button>
                                </span>
                              ) : null}
                              {workflowVersions.length > 0 && (
                                <button type="button" className="underline text-slate-400 hover:text-slate-200" onClick={() => setIsVersionHistoryOpen(true)}>History</button>
                              )}
                              <span className="whitespace-nowrap">
                                {lastSavedAt
                                  ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}`
                                  : 'Auto-save ready'}
                              </span>
                              <span className="whitespace-nowrap">{visibleNodeCount} nodes</span>
                              <span className="whitespace-nowrap">{edges.length} links</span>
                            </div>
                          </div>
                        </div>
                        <div className="workflow-neo-commandbar-actions">
                          <button
                            type="button"
                            onClick={() =>
                              setNeoTheme(current => (current === 'dark' ? 'light' : 'dark'))
                            }
                            className="workflow-lab-toolbar-button"
                            title={
                              neoTheme === 'dark'
                                ? 'Switch to light mode'
                                : 'Switch to dark mode'
                            }
                          >
                            {neoTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsCommandPaletteOpen(true)}
                            className="workflow-lab-toolbar-button"
                            title="Command palette"
                          >
                            <Search size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCanvasZoom('out')}
                            className="workflow-lab-toolbar-button"
                            title="Zoom out"
                          >
                            <ZoomOut size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setCanvasScale(1)}
                            className="workflow-lab-toolbar-button"
                            title="Fit canvas"
                          >
                            {Math.round(canvasScale * 100)}%
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCanvasZoom('in')}
                            className="workflow-lab-toolbar-button"
                            title="Zoom in"
                          >
                            <ZoomIn size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={handleValidateWorkflow}
                            className="workflow-lab-toolbar-button"
                            title="Validate workflow"
                          >
                            <ScanLine size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={handleAutoLayout}
                            className="workflow-lab-toolbar-button"
                            title="Auto-layout"
                          >
                            <LayoutTemplate size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={openLifecycleManager}
                            className="workflow-lab-toolbar-button"
                            title="Edit capability lifecycle"
                          >
                            <Split size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setNeoLaneVisibility(current => !current)}
                            className={cn(
                              'workflow-lab-toolbar-button',
                              neoLaneVisibility && 'bg-primary/8 text-primary',
                            )}
                            title="Toggle phase lanes"
                          >
                            {neoLaneVisibility ? <Eye size={16} /> : <EyeOff size={16} />}
                          </button>
                          <button
                            type="button"
                            onClick={handlePublishWorkflow}
                            className="workflow-lab-toolbar-button"
                            title="Publish workflow"
                          >
                            <Play size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsNeoHelpOpen(true)}
                            className="workflow-lab-toolbar-button"
                            title="Shortcuts"
                          >
                            <Keyboard size={16} />
                          </button>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setIsNeoOverflowOpen(current => !current)}
                              className="workflow-lab-toolbar-button"
                              title="More actions"
                            >
                              <MoreHorizontal size={16} />
                            </button>
                            {isNeoOverflowOpen ? (
                              <div className="workflow-neo-overflow-menu">
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleDuplicateWorkflow();
                                    setIsNeoOverflowOpen(false);
                                  }}
                                  className="workflow-neo-menu-item"
                                >
                                  <Copy size={14} />
                                  Duplicate workflow
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSnapToGrid(current => !current);
                                    setIsNeoOverflowOpen(false);
                                  }}
                                  className="workflow-neo-menu-item"
                                >
                                  <Route size={14} />
                                  Snap {snapToGrid ? 'Off' : 'On'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    openLifecycleManager();
                                    setIsNeoOverflowOpen(false);
                                  }}
                                  className="workflow-neo-menu-item"
                                >
                                  <Split size={14} />
                                  Edit lifecycle
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    simulationState.active
                                      ? handleResetSimulation()
                                      : handleStartSimulation();
                                    setIsNeoOverflowOpen(false);
                                  }}
                                  className="workflow-neo-menu-item"
                                >
                                  <Play size={14} />
                                  {simulationState.active ? 'Reset simulation' : 'Start simulation'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNeoFloatingPanel(current => !current);
                                    setIsNeoOverflowOpen(false);
                                  }}
                                  className="workflow-neo-menu-item"
                                >
                                  <PanelLeft size={14} />
                                  {neoFloatingPanel ? 'Dock tool panel' : 'Float tool panel'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleArchiveWorkflow();
                                    setIsNeoOverflowOpen(false);
                                  }}
                                  className="workflow-neo-menu-item"
                                >
                                  <Archive size={14} />
                                  Archive workflow
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleExportWorkflow();
                                    setIsNeoOverflowOpen(false);
                                  }}
                                  className="workflow-neo-menu-item"
                                >
                                  <Download size={14} />
                                  Export JSON
                                </button>
                                <div className="my-1 border-t border-slate-700" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsNeoOverflowOpen(false);
                                    navigate('/studio/designer-config');
                                  }}
                                  className="workflow-neo-menu-item"
                                >
                                  <Wrench size={14} />
                                  Designer settings
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsNeoOverflowOpen(false);
                                    navigate('/studio/step-templates');
                                  }}
                                  className="workflow-neo-menu-item"
                                >
                                  <LayoutTemplate size={14} />
                                  Step templates
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="workflow-neo-pan-control">
                        <button
                          type="button"
                          onClick={() => {
                            setIsCanvasPanMode(current => !current);
                            setCanvasPanDrag(null);
                          }}
                          className={cn(
                            'workflow-neo-pan-button',
                            isCanvasPanMode && 'workflow-neo-pan-button-active',
                          )}
                          title="Toggle hand tool to drag the canvas"
                          aria-pressed={isCanvasPanMode}
                        >
                          <Hand size={16} />
                          <span>Pan</span>
                          <kbd>H</kbd>
                        </button>
                        {isCanvasPanMode ? (
                          <span className="workflow-neo-pan-hint">Drag empty canvas</span>
                        ) : null}
                      </div>

                      <div className="workflow-neo-side-dock">
                        <div className="workflow-neo-icon-dock">
                          {neoWidgetMeta.map(({ key, label, Icon, accentClassName }) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => handleActivateNeoPanel(key)}
                              className={cn(
                                'workflow-neo-icon-button',
                                neoActivePanel === key && neoPanelOpen && 'workflow-neo-icon-button-active',
                              )}
                              title={label}
                            >
                              <Icon size={16} className={accentClassName} />
                            </button>
                          ))}
                        </div>
                        {neoPanelOpen && !neoFloatingPanel ? (
                          <div
                            className="workflow-neo-primary-panel"
                            style={{ width: canvasWidgetPreferences[neoActivePanel].width }}
                          >
                            <div className="workflow-neo-panel-header">
                              <div className="flex items-center gap-2">
                                <activeNeoPanelMeta.Icon
                                  size={15}
                                  className={activeNeoPanelMeta.accentClassName}
                                />
                                <p className="text-sm font-semibold text-white">
                                  {activeNeoPanelMeta.label}
                                </p>
                              </div>
                              <div className="designer-widget-icon-toolbar">
                                <button
                                  type="button"
                                  onClick={() => handleToggleWidgetWidth(neoActivePanel)}
                                  className="designer-widget-icon-action"
                                  title="Resize panel"
                                >
                                  <UnfoldVertical size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={handleToggleNeoPanelFloating}
                                  className="designer-widget-icon-action"
                                  title="Float panel"
                                >
                                  <UnfoldVertical size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setNeoPanelOpen(false)}
                                  className="designer-widget-icon-action"
                                  title="Collapse panel"
                                >
                                  <Minimize2 size={14} />
                                </button>
                              </div>
                            </div>
                            <div className="workflow-neo-panel-body">
                              {renderNeoPrimaryPanelContent()}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {neoPanelOpen && neoFloatingPanel ? (
                        <div
                          className="absolute z-20 pointer-events-auto"
                          style={getCanvasWidgetStyle(neoActivePanel)}
                        >
                          <div className="workflow-floating-widget workflow-floating-widget-lg workflow-floating-widget-dragging">
                            <div
                              className="workflow-floating-widget-header workflow-floating-widget-handle"
                              onMouseDown={event => handleStartWidgetDrag(event, neoActivePanel)}
                            >
                              <div className="flex items-center gap-2">
                                <activeNeoPanelMeta.Icon
                                  size={15}
                                  className={activeNeoPanelMeta.accentClassName}
                                />
                                <p className="text-sm font-semibold text-white">
                                  {activeNeoPanelMeta.label}
                                </p>
                              </div>
                              <div className="designer-widget-icon-toolbar">
                                <button
                                  type="button"
                                  onClick={() => handleToggleWidgetDock(neoActivePanel, 'left')}
                                  className="designer-widget-icon-action"
                                  title="Snap left"
                                >
                                  <PanelLeft size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleWidgetDock(neoActivePanel, 'right')}
                                  className="designer-widget-icon-action"
                                  title="Snap right"
                                >
                                  <PanelLeft size={14} className="rotate-180" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleWidgetWidth(neoActivePanel)}
                                  className="designer-widget-icon-action"
                                  title="Resize panel"
                                >
                                  <UnfoldVertical size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={handleToggleNeoPanelFloating}
                                  className="designer-widget-icon-action"
                                  title="Dock panel"
                                >
                                  <PanelLeft size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setNeoPanelOpen(false)}
                                  className="designer-widget-icon-action"
                                  title="Close panel"
                                >
                                  <Minimize2 size={14} />
                                </button>
                              </div>
                            </div>
                            <div className="workflow-floating-widget-body">
                              {renderNeoPrimaryPanelContent()}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {neoInspectorCollapsed ? (
                        <div className="workflow-neo-inspector-trigger-shell">
                          <button
                            type="button"
                            onClick={handleToggleNeoInspector}
                            className="workflow-neo-inspector-trigger"
                            title="Open inspector"
                          >
                            <Wrench size={15} />
                            <span>
                              Inspect{' '}
                              {neoInspectorMode === 'node'
                                ? 'Node'
                                : neoInspectorMode === 'edge'
                                ? 'Edge'
                                : 'Workflow'}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <div className="workflow-neo-inspector-shell">
                          {renderNeoInspectorContent()}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2">
                      <div className="rounded-full border border-slate-700 bg-slate-950/90 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-300">
                        Workflow Studio
                      </div>
                      <div className="rounded-full border border-slate-700 bg-slate-950/90 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-400">
                        New Designer
                      </div>
                    </div>
                  )}
                  <div
                    ref={graphStageRef}
                    className={cn(
                      'relative min-h-[72rem] min-w-[96rem] origin-top-left',
                      isNeo && isCanvasPanMode && 'workflow-canvas-pan-stage',
                    )}
                    style={{
                      transform: `scale(${canvasScale})`,
                      transformOrigin: 'top left',
                      marginLeft: neoCanvasMargins.left,
                      marginRight: neoCanvasMargins.right,
                      marginTop: neoCanvasMargins.top,
                      marginBottom: neoCanvasMargins.bottom,
                    }}
                    onClick={event => {
                      if (event.target === event.currentTarget) {
                        clearCanvasSelection();
                      }
                    }}
                    onMouseDown={event => {
                      const target = event.target as Element;
                      const targetTagName = target.tagName.toLowerCase();
                      const isCanvasSurface =
                        event.target === event.currentTarget || targetTagName === 'svg';

                      if (
                        isNeo &&
                        isCanvasPanMode &&
                        canvasRef.current &&
                        event.button === 0 &&
                        isCanvasSurface
                      ) {
                        event.preventDefault();
                        setCanvasPanDrag({
                          startX: event.clientX,
                          startY: event.clientY,
                          scrollLeft: canvasRef.current.scrollLeft,
                          scrollTop: canvasRef.current.scrollTop,
                        });
                        return;
                      }

                      if (!isNeo || event.button !== 0 || event.target !== event.currentTarget) {
                        return;
                      }

                      const bounds = event.currentTarget.getBoundingClientRect();
                      const startX = clamp((event.clientX - bounds.left) / canvasScale, 0, graphWidth);
                      const startY = clamp((event.clientY - bounds.top) / canvasScale, 0, graphHeight);
                      setMarqueeSelection({
                        startX,
                        startY,
                        currentX: startX,
                        currentY: startY,
                      });
                    }}
                    >
                    {!selectedWorkflow && isNeo ? (
                      <div className="workflow-neo-empty-state">
                        <div className="workflow-neo-empty-panel">
                          <p className="page-context">Neo Canvas</p>
                          <p className="mt-3 text-2xl font-bold text-white">
                            Start a workflow without leaving the canvas
                          </p>
                          <p className="mt-3 text-sm leading-relaxed text-slate-300">
                            Create a brand-new workflow or load the Standard or Brokerage SDLC template, then use the studio panels to model nodes, hand-offs, events, alerts, and approvals.
                          </p>
                          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                            <button
                              type="button"
                              onClick={() => setIsCreateWorkflowOpen(true)}
                              className="enterprise-button enterprise-button-primary"
                            >
                              <Plus size={16} />
                              Create workflow
                            </button>
                            <button
                              type="button"
                              onClick={handleLoadStandardWorkflow}
                              className="enterprise-button enterprise-button-secondary"
                            >
                              <Sparkles size={16} />
                              Load Standard SDLC
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleLoadBrokerageWorkflow()}
                              className="enterprise-button enterprise-button-secondary"
                            >
                              <Sparkles size={16} />
                              Load Brokerage SDLC
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {/* Connect-mode hint — floats at the top of the canvas so
                        operators always know they're in hand-off mode and what
                        to do next. Dismissed by clicking the × or any canvas. */}
                    {connectFromNodeId ? (
                      <div className="pointer-events-none absolute inset-x-0 top-4 z-40 flex justify-center">
                        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-emerald-400/60 bg-emerald-950/90 px-4 py-2 text-sm font-medium text-emerald-200 shadow-xl backdrop-blur">
                          <Route size={14} className="text-emerald-400" />
                          <span>
                            Hand-off mode — click any node to connect from{' '}
                            <strong className="text-emerald-100">
                              {getWorkflowNode(selectedWorkflow, connectFromNodeId)?.name || 'selected node'}
                            </strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => setConnectFromNodeId(null)}
                            className="ml-1 rounded-full p-0.5 text-emerald-400 transition hover:bg-emerald-800/50 hover:text-emerald-100"
                            title="Cancel connection"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* Drag-link mode hint — shown while user is dragging a port */}
                    {dragLinkFromNodeId ? (
                      <div className="pointer-events-none absolute inset-x-0 top-4 z-40 flex justify-center">
                        <div className="pointer-events-none flex items-center gap-2 rounded-full border border-sky-400/60 bg-sky-950/90 px-4 py-2 text-sm font-medium text-sky-200 shadow-xl backdrop-blur">
                          <Route size={14} className="text-sky-400" />
                          <span>
                            Drag to a target node to create a hand-off — release anywhere on the node
                          </span>
                        </div>
                      </div>
                    ) : null}

                    <div className="pointer-events-none absolute inset-0 z-0">
                      {laneSummaries.map(({ phase, count }, index) => {
                        if (isNeo && !neoLaneVisibility) {
                          return null;
                        }
                        const laneTop = WORKFLOW_LANE_TOP + index * WORKFLOW_LANE_HEIGHT;
                        return (
                          <div
                            key={phase}
                            className="absolute left-0 right-0"
                            style={{
                              top: `${laneTop}px`,
                              height: `${WORKFLOW_LANE_HEIGHT - 12}px`,
                            }}
                          >
                            <div className="absolute inset-x-0 top-0 h-px bg-slate-800/50" />
                            <div className="absolute inset-x-0 bottom-3 h-px border-b border-dashed border-slate-800/40" />
                            <div className={cn(
                              'absolute left-6 top-5 rounded-xl border bg-slate-950/78 px-3 py-2',
                              isNeo ? 'w-28 border-slate-800/70' : 'w-36 border-slate-800/80',
                            )}>
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-400">
                                  {phaseLabel(phase)}
                                </p>
                                <span className="rounded-full border border-slate-700/70 bg-slate-900/70 px-2 py-0.5 text-[0.5625rem] font-bold text-slate-300">
                                  {count}
                                </span>
                              </div>
                            </div>
                            <div
                              className={cn(
                                'absolute inset-y-5 right-8 rounded-[1.5rem] border',
                                isNeo
                                  ? 'left-32 border-slate-900/65 bg-[linear-gradient(180deg,rgba(15,23,42,0.18),rgba(15,23,42,0.08))]'
                                  : 'left-[12.25rem] border-slate-900/90 bg-[linear-gradient(180deg,rgba(15,23,42,0.36),rgba(15,23,42,0.16))]',
                              )}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <svg className="absolute inset-0 h-full w-full overflow-visible">
                      {edges.map(edge => {
                        const fromNode = getWorkflowNode(selectedWorkflow, edge.fromNodeId);
                        const toNode = getWorkflowNode(selectedWorkflow, edge.toNodeId);
                        if (!fromNode || !toNode) {
                          return null;
                        }

                        const isSelected = selectedEdgeId === edge.id;
                        const edgeErrors = edgeValidationDetails.get(edge.id) || [];
                        const isSimulated = simulationEdgeIds.has(edge.id);
                        const midX =
                          (fromNode.layout.x + toNode.layout.x + nodeDimensions.width) / 2;
                        const midY =
                          (fromNode.layout.y + toNode.layout.y) / 2 +
                          nodeDimensions.height / 2;

                        return (
                          <g
                            key={edge.id}
                            className="cursor-pointer"
                            onClick={event => {
                              event.stopPropagation();
                              setSelectedEdgeId(edge.id);
                              setSelectedNodeId(null);
                              setSelectedNodeIds([]);
                              setConnectFromNodeId(null);
                            }}
                            onContextMenu={event => {
                              event.preventDefault();
                              event.stopPropagation();
                              setSelectedEdgeId(edge.id);
                              setSelectedNodeId(null);
                              setSelectedNodeIds([]);
                              setNeoInspectorMode('edge');
                              setNeoContextMenu({
                                x: event.clientX,
                                y: event.clientY,
                                type: 'edge',
                                targetId: edge.id,
                              });
                            }}
                          >
                            <path
                              d={getEdgePath(fromNode, toNode)}
                              fill="none"
                              stroke={isSelected ? '#38bdf8' : isSimulated ? '#22c55e' : '#64748b'}
                              strokeWidth={isSelected ? 3 : isSimulated ? 3 : 2}
                              strokeDasharray={edge.conditionType === 'PARALLEL' ? '8 7' : undefined}
                            />
                            <circle
                              cx={fromNode.layout.x + nodeDimensions.width}
                              cy={fromNode.layout.y + nodeDimensions.height / 2}
                              r="4"
                              fill={isSelected ? '#38bdf8' : '#64748b'}
                            />
                            <circle
                              cx={toNode.layout.x}
                              cy={toNode.layout.y + nodeDimensions.height / 2}
                              r="4"
                              fill={isSelected ? '#38bdf8' : '#64748b'}
                            />
                            <foreignObject x={midX - 96} y={midY - 18} width={192} height={40}>
                              <div
                                className={cn(
                                  'inline-flex w-full items-center justify-center rounded-full border px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] shadow-sm backdrop-blur',
                                  isSelected
                                    ? 'border-sky-400/60 bg-sky-500/20 text-sky-100'
                                    : edgeErrors.length
                                    ? 'border-red-400/60 bg-red-500/15 text-red-50'
                                    : isSimulated
                                    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-50'
                                    : 'border-slate-600 bg-slate-900/90 text-slate-200',
                                )}
                                title={edgeErrors[0]}
                              >
                                {edge.label || edge.conditionType}
                              </div>
                            </foreignObject>
                            {edgeErrors.length ? (
                              <foreignObject x={midX - 36} y={midY + 18} width={72} height={24}>
                                <div className="inline-flex w-full items-center justify-center rounded-full border border-red-400/60 bg-red-500/15 px-2 py-1 text-[0.625rem] font-bold text-red-50">
                                  {edgeErrors.length} issue{edgeErrors.length > 1 ? 's' : ''}
                                </div>
                              </foreignObject>
                            ) : null}
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
                      const Icon = getNodeIcon(node.type);
                      const isSelected = selectedNodeId === node.id;
                      const isMultiSelected = selectedNodeIds.includes(node.id);
                      const isCollapsed = collapsedNodeIds.has(node.id);
                      const isConnectTarget =
                        Boolean(connectFromNodeId) && connectFromNodeId !== node.id;
                      const isPortTarget =
                        Boolean(dragLinkFromNodeId) && dragLinkFromNodeId !== node.id;
                      const nodeErrors = nodeValidationDetails.get(node.id) || [];
                      const isSimulated = simulationNodeIds.has(node.id);
                      const isSimulationCurrent = currentSimulationStep?.nodeId === node.id;
                      const nodeInputArtifacts = getNodeArtifactInputs(node);
                      const nodeOutputArtifacts = getNodeArtifactOutputs(node);

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
                          onClick={event => {
                            if (connectFromNodeId && connectFromNodeId !== node.id) {
                              handleConnectNodes(node.id);
                              return;
                            }
                            selectNode(node.id, event.shiftKey);
                          }}
                          // When a drag-link is in progress (user held the output
                          // port and is moving to a target), accept the drop on the
                          // entire node card — not just the tiny 16px input port.
                          onMouseUp={event => {
                            if (dragLinkFromNodeId && dragLinkFromNodeId !== node.id) {
                              handleCompleteDragLink(event, node.id);
                            }
                          }}
                          onContextMenu={event => {
                            event.preventDefault();
                            selectNode(node.id, event.shiftKey);
                            setNeoInspectorMode('node');
                            setNeoContextMenu({
                              x: event.clientX,
                              y: event.clientY,
                              type: 'node',
                              targetId: node.id,
                            });
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              selectNode(node.id, event.shiftKey);
                            }
                          }}
                          onDoubleClick={() => openQuickEdit(node.id)}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            'workflow-node-card',
                            isSelected && 'border-sky-400 ring-2 ring-sky-300/60',
                            !isSelected && isMultiSelected && 'border-primary/40 ring-2 ring-primary/20',
                            isConnectTarget && 'border-emerald-300 ring-2 ring-emerald-200/80',
                            isPortTarget && 'border-sky-400 ring-2 ring-sky-300/60 cursor-crosshair',
                            isSimulated && 'ring-2 ring-emerald-300/60',
                            isSimulationCurrent && 'border-emerald-400 shadow-[0_0_0_3px_rgba(34,197,94,0.2)]',
                            validationState.nodeIdsWithErrors.has(node.id) &&
                              'border-red-300 ring-2 ring-red-200/60',
                          )}
                          style={{
                            left: node.layout.x,
                            top: node.layout.y,
                            minHeight: isCollapsed ? 76 : nodeDimensions.height,
                          }}
                        >
                          <button
                            type="button"
                            onMouseUp={event => handleCompleteDragLink(event, node.id)}
                            onClick={event => event.stopPropagation()}
                            className={cn(
                              'workflow-node-port workflow-node-port-input',
                              isPortTarget && 'workflow-node-port-target',
                            )}
                            title={`Connect into ${node.name}`}
                          />
                          <button
                            type="button"
                            onMouseDown={event => handleStartDragLink(event, node.id)}
                            onClick={event => event.stopPropagation()}
                            className={cn(
                              'workflow-node-port workflow-node-port-output',
                              dragLinkFromNodeId === node.id && 'workflow-node-port-active',
                            )}
                            title={`Start hand-off from ${node.name}`}
                          />
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className={cn(
                                  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                                  NODE_TYPE_TONE[node.type],
                                )}
                              >
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
                            <div className="flex items-center gap-1.5">
                              {nodeErrors.length ? (
                                <span
                                  className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-[0.625rem] font-bold text-red-700"
                                  title={nodeErrors[0]}
                                >
                                  {nodeErrors.length}
                                </span>
                              ) : null}
                              {/* "Connect from here" quick button — visible on selected
                                  nodes so operators never need to hunt for the port
                                  dot or the palette's hand-off mode button. */}
                              {isSelected && node.type !== 'END' ? (
                                <button
                                  type="button"
                                  onClick={event => {
                                    event.stopPropagation();
                                    if (connectFromNodeId === node.id) {
                                      setConnectFromNodeId(null);
                                    } else {
                                      setConnectFromNodeId(node.id);
                                    }
                                  }}
                                  className={cn(
                                    'rounded-lg border p-1.5 transition',
                                    connectFromNodeId === node.id
                                      ? 'border-emerald-400 bg-emerald-500/15 text-emerald-700'
                                      : 'border-outline-variant/40 text-secondary hover:bg-surface-container-low hover:text-on-surface',
                                  )}
                                  title={
                                    connectFromNodeId === node.id
                                      ? 'Click another node to connect, or click here to cancel'
                                      : `Start a hand-off from ${node.name}`
                                  }
                                >
                                  <Route size={13} />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={event => {
                                  event.stopPropagation();
                                  handleToggleNodeMinimized(node.id);
                                }}
                                className="rounded-lg border border-outline-variant/40 p-1.5 text-secondary transition hover:bg-surface-container-low hover:text-on-surface"
                                title={isCollapsed ? `Expand ${node.name}` : `Minimize ${node.name}`}
                              >
                                {isCollapsed ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
                              </button>
                              {node.type !== 'START' ? (
                                <button
                                  type="button"
                                  onClick={event => {
                                    event.stopPropagation();
                                    handleDeleteNodeFromCanvas(node);
                                  }}
                                  className="rounded-lg border border-red-200 p-1.5 text-red-700 transition hover:bg-red-50"
                                  title={`Delete ${node.name}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <StatusBadge tone={isVisibleWorkflowNode(node.type) ? 'brand' : 'neutral'}>
                              {getNodeTypeLabel(node.type, designerConfig)}
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

                          {!isCollapsed ? (
                            <div className="flex flex-wrap gap-1.5">
                              {node.agentId ? (
                                <span className="rounded-full border border-outline-variant/50 bg-surface-container-low px-2 py-1 text-[0.625rem] font-semibold text-secondary">
                                  {workspace.agents.find(agent => agent.id === node.agentId)?.name || 'Assigned'}
                                </span>
                              ) : null}
                              {nodeInputArtifacts.length ? (
                                <span className="rounded-full border border-outline-variant/50 bg-surface-container-low px-2 py-1 text-[0.625rem] font-semibold text-secondary">
                                  In: {getArtifactPreview(nodeInputArtifacts)}
                                  {nodeInputArtifacts.length > 2 ? ` +${nodeInputArtifacts.length - 2}` : ''}
                                </span>
                              ) : null}
                              {nodeOutputArtifacts.length ? (
                                <span className="rounded-full border border-outline-variant/50 bg-surface-container-low px-2 py-1 text-[0.625rem] font-semibold text-secondary">
                                  Out: {getArtifactPreview(nodeOutputArtifacts)}
                                  {nodeOutputArtifacts.length > 2 ? ` +${nodeOutputArtifacts.length - 2}` : ''}
                                </span>
                              ) : null}
                              {(node.approverRoles || []).length ? (
                                <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-1 text-[0.625rem] font-semibold text-fuchsia-700">
                                  {(node.approverRoles || []).length} approver role{(node.approverRoles || []).length > 1 ? 's' : ''}
                                </span>
                              ) : null}
                              {node.eventConfig?.eventName ? (
                                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-[0.625rem] font-semibold text-cyan-700">
                                  Event: {node.eventConfig.eventName}
                                </span>
                              ) : null}
                              {node.alertConfig?.severity ? (
                                <span className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-[0.625rem] font-semibold text-red-700">
                                  Alert: {node.alertConfig.severity}
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          {!isCollapsed ? (
                            <>
                              <p className="line-clamp-2 text-xs leading-relaxed text-secondary">
                                {node.action || node.description || 'No node guidance yet.'}
                              </p>
                              {node.artifactContract?.notes ? (
                                <p className="line-clamp-2 text-[0.6875rem] leading-relaxed text-outline">
                                  {node.artifactContract.notes}
                                </p>
                              ) : null}

                              <div className="mt-auto flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {nodeInputArtifacts.length ? (
                                    <span className="workflow-node-meta-pill">In</span>
                                  ) : null}
                                  {nodeOutputArtifacts.length ? (
                                    <span className="workflow-node-meta-pill workflow-node-meta-pill-out">
                                      Out
                                    </span>
                                  ) : null}
                                  {(node.approverRoles || []).length ? (
                                    <span className="workflow-node-meta-pill workflow-node-meta-pill-approval">
                                      Approve
                                    </span>
                                  ) : null}
                                  {node.eventConfig?.eventName ? (
                                    <span className="workflow-node-meta-pill workflow-node-meta-pill-event">
                                      Event
                                    </span>
                                  ) : null}
                                  {node.alertConfig?.severity ? (
                                    <span className="workflow-node-meta-pill workflow-node-meta-pill-alert">
                                      Alert
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2 text-[0.6875rem] text-outline">
                                  <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
                                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="mt-auto flex items-center justify-between gap-2 text-[0.6875rem] text-outline">
                              <span>Minimized</span>
                              <span className="inline-flex items-center gap-1">
                                <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
                                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {marqueeSelection ? (
                      <div
                        className="workflow-neo-marquee"
                        style={{
                          left: Math.min(marqueeSelection.startX, marqueeSelection.currentX),
                          top: Math.min(marqueeSelection.startY, marqueeSelection.currentY),
                          width: Math.abs(marqueeSelection.currentX - marqueeSelection.startX),
                          height: Math.abs(marqueeSelection.currentY - marqueeSelection.startY),
                        }}
                      />
                    ) : null}
                  </div>

                  <div className="workflow-minimap">
                    <div className="mb-2 flex items-center justify-between gap-4">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-slate-400">
                        Minimap
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-slate-500">
                          {Math.round(canvasScale * 100)}%
                        </p>
                        <button
                          type="button"
                          onClick={() => setNeoMinimapCollapsed(current => !current)}
                          className="designer-widget-icon-action"
                          title={neoMinimapCollapsed ? 'Expand minimap' : 'Collapse minimap'}
                        >
                          {neoMinimapCollapsed ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
                        </button>
                      </div>
                    </div>
                    {!neoMinimapCollapsed ? (
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
                        <div
                          className="pointer-events-none absolute rounded-md border border-sky-300/80 bg-sky-400/15"
                          style={{
                            left: minimapViewport.left,
                            top: minimapViewport.top,
                            width: Math.max(minimapViewport.width, 18),
                            height: Math.max(minimapViewport.height, 14),
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                {!isNeo ? (
                <div className="mt-4 rounded-[1.4rem] border border-outline-variant/60 bg-white px-5 py-5 shadow-[0_12px_30px_rgba(12,23,39,0.05)]">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="page-context">Workflow Description</p>
                      <p className="text-base font-semibold text-on-surface">
                        Textual narrative for {selectedWorkflow.name}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone="neutral">{visibleNodeCount} nodes</StatusBadge>
                      <StatusBadge tone="neutral">{edges.length} hand-offs</StatusBadge>
                      <StatusBadge tone="neutral">{laneSummaries.filter(item => item.count > 0).length} active phases</StatusBadge>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4">
                      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Overview
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-on-surface">
                        {workflowNarrative?.overview}
                      </p>
                      <p className="mt-3 text-sm leading-relaxed text-secondary">
                        {workflowNarrative?.execution}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4">
                      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Ownership and path
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-on-surface">
                        {workflowNarrative?.ownership}
                      </p>
                      <p className="mt-3 text-sm leading-relaxed text-secondary">
                        {workflowNarrative?.path}
                      </p>
                    </div>
                  </div>
                </div>
                ) : null}

                {!isNeo ? (
                <div className="workflow-utility-grid">
                  <div className="section-card">
                    <div className="flex items-center gap-2">
                      <WorkflowIcon size={16} className="text-primary" />
                      <p className="text-sm font-semibold text-on-surface">Execution Preview</p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={simulationState.active ? handleResetSimulation : handleStartSimulation}
                        className={cn(
                          'enterprise-button',
                          simulationState.active
                            ? 'enterprise-button-brand-muted'
                            : 'enterprise-button-secondary',
                        )}
                      >
                        {simulationState.active ? 'Reset Simulation' : 'Start Simulation'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSimulationStep('prev')}
                        disabled={
                          !simulationState.active ||
                          (simulationPath.length <= 1 && !simulationBranchPending)
                        }
                        className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {simulationBranchPending ? 'Cancel choice' : 'Previous'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSimulationStep('next')}
                        disabled={
                          !simulationState.active ||
                          Boolean(simulationBranchPending) ||
                          currentSimulationStep?.nodeType === 'END'
                        }
                        className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>

                    {/* Branch picker */}
                    {simulationBranchPending ? (
                      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4">
                        <div className="flex items-center gap-2">
                          {simulationBranchPending.fromType === 'PARALLEL_SPLIT'
                            ? <Split size={15} className="shrink-0 text-sky-600" />
                            : <GitBranch size={15} className="shrink-0 text-sky-600" />}
                          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-sky-700">
                            {simulationBranchPending.fromType === 'PARALLEL_SPLIT'
                              ? 'Parallel split — pick a branch to trace'
                              : 'Decision point — pick a route'}
                          </p>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-secondary">
                          <span className="font-semibold text-on-surface">{simulationBranchPending.fromLabel}</span>
                          {simulationBranchPending.fromType === 'PARALLEL_SPLIT'
                            ? ' fans out to all branches in production. Pick one to trace here.'
                            : ' routes work based on the execution outcome. Pick a path to continue.'}
                        </p>
                        <div className="mt-3 space-y-2">
                          {simulationBranchPending.options.map(option => (
                            <button
                              key={option.edgeId}
                              type="button"
                              onClick={() => handleBranchChoice(option)}
                              className="group flex w-full items-start gap-3 rounded-xl border border-outline-variant/50 bg-white px-3 py-2.5 text-left transition hover:border-primary/30 hover:bg-primary/5"
                            >
                              <ArrowRight
                                size={14}
                                className="mt-0.5 shrink-0 text-outline transition group-hover:text-primary"
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-on-surface">{option.toLabel}</p>
                                <p className="mt-0.5 text-xs text-secondary">
                                  {getConditionLabel(option.conditionType, option.branchKey)}
                                  {option.edgeLabel && option.edgeLabel !== option.branchKey
                                    ? ` · ${option.edgeLabel}`
                                    : ''}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {simulationPath.length > 0 ? (
                        simulationPath.map((step, index) => (
                          <React.Fragment key={`${step.nodeId}-${index}`}>
                            <div
                              className={cn(
                                'rounded-2xl border px-3 py-2 shadow-sm',
                                index === simulationPath.length - 1 && !simulationBranchPending
                                  ? 'border-sky-300 bg-sky-50'
                                  : index === simulationPath.length - 1 && simulationBranchPending
                                  ? 'border-amber-200 bg-amber-50'
                                  : 'border-emerald-200 bg-emerald-50',
                              )}
                            >
                              <p className="text-xs font-semibold text-on-surface">{step.label}</p>
                              {step.note ? (
                                <p className="mt-1 text-[0.6875rem] text-secondary">{step.note}</p>
                              ) : null}
                            </div>
                            {index < simulationPath.length - 1 ? (
                              <ArrowRight size={14} className="text-outline" />
                            ) : null}
                          </React.Fragment>
                        ))
                      ) : (
                        <p className="text-sm text-secondary">
                          Press Start to walk through the workflow step by step.
                        </p>
                      )}
                    </div>

                    {currentSimulationStep && !simulationBranchPending ? (
                      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-sky-700">
                          Simulation Focus
                        </p>
                        <p className="mt-2 text-sm font-semibold text-on-surface">
                          {currentSimulationStep.label}
                        </p>
                        {currentSimulationStep.note ? (
                          <p className="mt-1 text-sm text-secondary">{currentSimulationStep.note}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="section-card">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-primary" />
                      <p className="text-sm font-semibold text-on-surface">Validation</p>
                    </div>
                    <div className="mt-4 space-y-2">
                      {validationState.all.length ? (
                        validationState.all.map(error => (
                          <div
                            key={error.id}
                            className="rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-xs leading-relaxed text-red-800"
                          >
                            {error.message}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-secondary">
                          START, END, branching, join, and governance checks are all passing.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="section-card">
                    <div className="flex items-center gap-2">
                      <Undo2 size={16} className="text-primary" />
                      <p className="text-sm font-semibold text-on-surface">History & Restore</p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleUndo}
                        className="enterprise-button enterprise-button-secondary"
                      >
                        Undo
                      </button>
                      <button
                        type="button"
                        onClick={handleRedo}
                        className="enterprise-button enterprise-button-secondary"
                      >
                        Redo
                      </button>
                    </div>
                    <div className="mt-4 space-y-2">
                      {[...workflowHistory]
                        .map((entry, index) => ({ entry, index }))
                        .reverse()
                        .slice(0, 6)
                        .map(({ entry, index }) => {
                          const actualIndex = workflowHistory.length - 1 - index;
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => handleRestoreHistoryEntry(entry, actualIndex)}
                              className={cn(
                                'flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition',
                                actualIndex === historyIndex
                                  ? 'border-primary/20 bg-primary/6'
                                  : 'border-outline-variant/50 bg-surface-container-low hover:bg-white',
                              )}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-on-surface">
                                  {entry.label}
                                </span>
                                <span className="mt-1 block text-[0.6875rem] leading-relaxed text-secondary">
                                  {entry.description || 'Workflow state snapshot'}
                                </span>
                              </span>
                              <span className="text-[0.6875rem] font-semibold text-outline">
                                {new Date(entry.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  <div className="section-card">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={16} className="text-primary" />
                      <p className="text-sm font-semibold text-on-surface">Workflow Metadata</p>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                          Type
                        </p>
                        <p className="mt-2 text-sm font-semibold text-on-surface">
                          {selectedWorkflow.workflowType || 'Custom'}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                          Scope
                        </p>
                        <p className="mt-2 text-sm font-semibold text-on-surface">
                          {selectedWorkflow.templateId ? 'Shared workspace default' : selectedWorkflow.scope || 'CAPABILITY'}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                          Selected Nodes
                        </p>
                        <p className="mt-2 text-sm font-semibold text-on-surface">
                          {selectedNodeIds.length || 0}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                          Auto-save
                        </p>
                        <p className="mt-2 text-sm font-semibold text-on-surface">
                          {lastSavedAt
                            ? new Date(lastSavedAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Pending'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                ) : null}
              </div>
            </main>

          </div>
        </div>
      )}

      {neoContextMenu ? (
        <div
          className="workflow-neo-context-menu"
          style={{ left: neoContextMenu.x, top: neoContextMenu.y }}
        >
          {neoContextMenu.type === 'node' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  openQuickEdit(neoContextMenu.targetId);
                  setNeoContextMenu(null);
                }}
                className="workflow-neo-menu-item"
              >
                <Wrench size={14} />
                Quick edit
              </button>
              <button
                type="button"
                onClick={() => {
                  openNodeDetailsModal(neoContextMenu.targetId);
                  setNeoContextMenu(null);
                }}
                className="workflow-neo-menu-item"
              >
                <Wrench size={14} />
                Advanced config
              </button>
              <button
                type="button"
                onClick={() => {
                  if (connectFromNodeId === neoContextMenu.targetId) {
                    setConnectFromNodeId(null);
                  } else {
                    setConnectFromNodeId(neoContextMenu.targetId);
                    setSelectedNodeId(neoContextMenu.targetId);
                    setSelectedNodeIds([neoContextMenu.targetId]);
                  }
                  setNeoContextMenu(null);
                }}
                className="workflow-neo-menu-item"
              >
                <Route size={14} />
                {connectFromNodeId === neoContextMenu.targetId ? 'Cancel connection' : 'Connect from here'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetNode = selectedWorkflow
                    ? getWorkflowNode(selectedWorkflow, neoContextMenu.targetId)
                    : null;
                  handleDuplicateNode(targetNode || null);
                  setNeoContextMenu(null);
                }}
                className="workflow-neo-menu-item"
              >
                <Copy size={14} />
                Duplicate node
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetNode = selectedWorkflow
                    ? getWorkflowNode(selectedWorkflow, neoContextMenu.targetId)
                    : null;
                  if (targetNode) {
                    handleDeleteNodeFromCanvas(targetNode);
                  }
                  setNeoContextMenu(null);
                }}
                className="workflow-neo-menu-item"
              >
                <Trash2 size={14} />
                Delete node
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setNeoInspectorMode('edge');
                  setNeoContextMenu(null);
                }}
                className="workflow-neo-menu-item"
              >
                <Route size={14} />
                Inspect edge
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDeleteSelectedEdge();
                  setNeoContextMenu(null);
                }}
                className="workflow-neo-menu-item"
              >
                <Trash2 size={14} />
                Delete edge
              </button>
            </>
          )}
        </div>
      ) : null}

      {isCommandPaletteOpen ? (
        <div className="fixed inset-0 z-[92] flex items-start justify-center overflow-y-auto bg-slate-950/35 px-4 py-24 backdrop-blur-sm">
          <div className="w-full max-w-3xl">
            <ModalShell
              eyebrow="Studio Search"
              title="Command Palette"
              description="Search workflows, nodes, and studio actions. Keyboard shortcut: Ctrl/Cmd + K."
              actions={
                <button
                  type="button"
                  onClick={() => {
                    setIsCommandPaletteOpen(false);
                    setCommandQuery('');
                  }}
                  className="rounded-full p-2 text-outline transition hover:bg-surface-container-low hover:text-on-surface"
                >
                  <X size={18} />
                </button>
              }
            >
              <div className="grid gap-4">
                <input
                  autoFocus
                  value={commandQuery}
                  onChange={event => setCommandQuery(event.target.value)}
                  placeholder="Search actions, workflows, or nodes"
                  className="enterprise-input"
                />
                <div className="max-h-[26rem] space-y-2 overflow-y-auto">
                  {filteredCommandActions.length ? (
                    filteredCommandActions.map(action => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => {
                          action.run();
                          setIsCommandPaletteOpen(false);
                          setCommandQuery('');
                        }}
                        className="flex w-full items-start justify-between gap-3 rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3 text-left transition hover:border-outline hover:bg-white"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-on-surface">
                            {action.label}
                          </span>
                          <span className="mt-1 block text-[0.6875rem] leading-relaxed text-secondary">
                            {action.subtitle}
                          </span>
                        </span>
                        <ArrowRight size={16} className="shrink-0 text-outline" />
                      </button>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-outline-variant/60 bg-surface-container-low px-4 py-8 text-center text-sm text-secondary">
                      No commands or workflow items matched that search.
                    </div>
                  )}
                </div>
              </div>
            </ModalShell>
          </div>
        </div>
      ) : null}

      {isLifecycleManagerOpen ? (
        <div className="fixed inset-0 z-[93] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-20 backdrop-blur-sm">
          <div className="w-full max-w-4xl">
            <ModalShell
              eyebrow="Capability Lifecycle"
              title="Manage workflow lanes"
              description="These visible phases define the Designer lanes, Work board columns, and Evidence labels for this capability."
              actions={
                <button
                  type="button"
                  onClick={() => {
                    setIsLifecycleManagerOpen(false);
                    setPendingLifecycleDeletePhaseId(null);
                    setLifecycleDeleteTargetPhaseId('');
                  }}
                  className="rounded-full p-2 text-outline transition hover:bg-surface-container-low hover:text-on-surface"
                >
                  <X size={18} />
                </button>
              }
            >
              <div className="grid gap-5">
                <CapabilityLifecycleEditor
                  phases={lifecyclePhaseViews}
                  intro="Backlog and Done stay fixed. Everything in between is capability-owned and flows through Designer, Work, Ledger, and Flight Recorder."
                  onChangeLabel={handleRenameLifecyclePhase}
                  onMovePhase={handleMoveLifecyclePhase}
                  onDeletePhase={handleDeleteLifecyclePhase}
                  onAddPhase={handleAddLifecyclePhase}
                  addLabel="Add lifecycle phase"
                />

                {pendingLifecycleDeletePhaseId ? (
                  <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-5">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />
                      <div className="min-w-0 flex-1 space-y-3">
                        <div>
                          <p className="text-sm font-semibold text-amber-950">
                            Remap workflow references before removing this phase
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-amber-900">
                            Saved workflows still reference{' '}
                            {phaseLabel(pendingLifecycleDeletePhaseId)}. Choose the phase that should
                            inherit those workflow nodes, steps, and hand-off targets.
                          </p>
                        </div>
                        <label className="space-y-2">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-amber-900">
                            Remap to
                          </span>
                          <select
                            value={lifecycleDeleteTargetPhaseId}
                            onChange={event =>
                              setLifecycleDeleteTargetPhaseId(event.target.value)
                            }
                            className="enterprise-input bg-white"
                          >
                            {lifecycleDraft.phases
                              .filter(phase => phase.id !== pendingLifecycleDeletePhaseId)
                              .map(phase => (
                                <option key={phase.id} value={phase.id}>
                                  {phase.label}
                                </option>
                              ))}
                          </select>
                        </label>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={handleConfirmLifecycleDelete}
                            disabled={!lifecycleDeleteTargetPhaseId}
                            className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Remap and remove phase
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingLifecycleDeletePhaseId(null);
                              setLifecycleDeleteTargetPhaseId('');
                            }}
                            className="enterprise-button enterprise-button-secondary"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/50 pt-5">
                  <p className="text-sm text-secondary">
                    Delete is blocked while live work or workflow-managed tasks still occupy a phase.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setIsLifecycleManagerOpen(false);
                        setPendingLifecycleDeletePhaseId(null);
                        setLifecycleDeleteTargetPhaseId('');
                      }}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveLifecycle()}
                      disabled={isSavingLifecycle}
                      className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSavingLifecycle ? 'Saving lifecycle...' : 'Save lifecycle'}
                    </button>
                  </div>
                </div>
              </div>
            </ModalShell>
          </div>
        </div>
      ) : null}

      {isNeoHelpOpen ? (
        <div className="fixed inset-0 z-[93] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-20 backdrop-blur-sm">
          <div className="w-full max-w-2xl">
            <ModalShell
              eyebrow="Workflow Designer Neo"
              title="Keyboard Shortcuts"
              description="Desktop shortcuts for technical builders working directly on the Neo canvas."
              actions={
                <button
                  type="button"
                  onClick={() => setIsNeoHelpOpen(false)}
                  className="rounded-full p-2 text-outline transition hover:bg-surface-container-low hover:text-on-surface"
                >
                  <X size={18} />
                </button>
              }
            >
              <div className="grid gap-3">
                {[
                  ['Cmd/Ctrl + K', 'Open command palette'],
                  ['Cmd/Ctrl + S', 'Save workflow'],
                  ['Cmd/Ctrl + Z', 'Undo'],
                  ['Cmd/Ctrl + Shift + Z', 'Redo'],
                  ['Cmd/Ctrl + D', 'Duplicate selected node'],
                  ['Delete / Backspace', 'Delete selected node or edge'],
                  ['F', 'Fit canvas'],
                  ['Cmd/Ctrl + =', 'Zoom in'],
                  ['Cmd/Ctrl + -', 'Zoom out'],
                  ['L', 'Toggle phase lanes'],
                  ['H', 'Toggle hand tool / pan canvas'],
                  ['?', 'Open shortcuts'],
                ].map(([shortcut, description]) => (
                  <div
                    key={shortcut}
                    className="workflow-neo-shortcut-row"
                  >
                    <span className="workflow-neo-shortcut-key">{shortcut}</span>
                    <span className="text-sm text-secondary">{description}</span>
                  </div>
                ))}
              </div>
            </ModalShell>
          </div>
        </div>
      ) : null}

      {isQuickEditOpen && selectedNode && nodeDraft ? (
        <div className="fixed inset-0 z-[94] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-20 backdrop-blur-sm">
          <div className="w-full max-w-2xl">
            <ModalShell
              eyebrow="Quick Edit"
              title={nodeDraft.name || 'Workflow node'}
              description="Update the core identity and execution details without leaving the canvas."
              actions={
                <button
                  type="button"
                  onClick={() => setIsQuickEditOpen(false)}
                  className="rounded-full p-2 text-outline transition hover:bg-surface-container-low hover:text-on-surface"
                >
                  <X size={18} />
                </button>
              }
            >
              <div className="grid gap-5">
                {renderNeoQuickEditFields()}
                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsQuickEditOpen(false);
                      setIsNodeDetailsOpen(true);
                    }}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Advanced Config
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleApplyNodeDraft();
                      setIsQuickEditOpen(false);
                    }}
                    className="enterprise-button enterprise-button-primary"
                  >
                    Save Quick Edit
                  </button>
                </div>
              </div>
            </ModalShell>
          </div>
        </div>
      ) : null}

      {isNodeDetailsOpen && selectedNode && nodeDraft ? (
        <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-20 backdrop-blur-sm">
          <div className="w-full max-w-4xl">
            <ModalShell
              eyebrow="Node Configuration"
              title={nodeDraft.name || 'Workflow node'}
              description={NODE_TYPE_OPTIONS.find(o => o.type === nodeDraft.type)?.description || 'Configure this workflow node.'}
              actions={
                <div className="flex items-center gap-2">
                  {/* Business / Technical view toggle */}
                  <div className="flex items-center gap-1.5 rounded-full border border-outline-variant/40 bg-surface-container-low px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleBusinessView(true)}
                      className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold transition', businessView ? 'bg-primary text-white' : 'text-outline hover:text-on-surface')}
                    >
                      Business
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleBusinessView(false)}
                      className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold transition', !businessView ? 'bg-primary text-white' : 'text-outline hover:text-on-surface')}
                    >
                      Technical
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsNodeDetailsOpen(false)}
                    className="rounded-full p-2 text-outline transition hover:bg-surface-container-low hover:text-on-surface"
                  >
                    <X size={18} />
                  </button>
                </div>
              }
            >
              <div className="grid gap-5">
                {/* Summary cards */}
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                    <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">Phase</p>
                    <p className="mt-2 text-sm font-semibold text-on-surface">{phaseLabel(nodeDraft.phase)}</p>
                  </div>
                  <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                    <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">Type</p>
                    <p className="mt-2 text-sm font-semibold text-on-surface">{getNodeTypeLabel(nodeDraft.type, designerConfig)}</p>
                  </div>
                  <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3">
                    <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">Assigned</p>
                    <p className="mt-2 text-sm font-semibold text-on-surface">
                      {workspace.agents.find(agent => agent.id === nodeDraft.agentId)?.name || 'Control / Human node'}
                    </p>
                  </div>
                </div>

                {/* Tab navigation */}
                <div className="flex gap-1 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-1">
                  {([ 'overview', 'task', 'io', 'governance', ...(!businessView ? ['execution'] : []) ] as const).map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setNodeDetailTab(tab as typeof nodeDetailTab)}
                      className={cn(
                        'flex-1 rounded-xl px-3 py-2 text-xs font-semibold capitalize transition',
                        nodeDetailTab === tab
                          ? 'bg-white text-on-surface shadow-sm'
                          : 'text-outline hover:text-on-surface',
                      )}
                    >
                      {tab === 'io' ? 'I/O & Artifacts' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                {nodeDetailTab === 'overview' && (
                  <div className="grid gap-4">
                    <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                      <span>Name</span>
                      <input value={nodeDraft.name} onChange={e => setNodeDraft(c => c ? { ...c, name: e.target.value } : c)} className="enterprise-input" />
                    </label>
                    <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                      <span>Node Type</span>
                      <select value={nodeDraft.type} onChange={e => setNodeDraft(c => c ? { ...c, type: e.target.value as WorkflowNodeType } : c)} className="enterprise-input">
                        {NODE_TYPE_OPTIONS.map(o => <option key={o.type} value={o.type}>{o.label}</option>)}
                      </select>
                    </label>
                    <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                      <span>Phase Lane</span>
                      <select value={nodeDraft.phase} onChange={e => setNodeDraft(c => c ? { ...c, phase: e.target.value as WorkItemPhase } : c)} className="enterprise-input">
                        {lifecyclePhaseIds.map(p => <option key={p} value={p}>{phaseLabel(p)}</option>)}
                      </select>
                    </label>
                    <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                      <span>Description</span>
                      <textarea rows={4} value={nodeDraft.description || ''} onChange={e => setNodeDraft(c => c ? { ...c, description: e.target.value } : c)} className="enterprise-input min-h-[7rem]" />
                    </label>
                  </div>
                )}

                {nodeDetailTab === 'task' && (
                  <div className="grid gap-4">
                    {/* DELIVERY / RELEASE */}
                    {(nodeDraft.type === 'DELIVERY' || nodeDraft.type === 'RELEASE') && (
                      <>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Assigned Agent</span>
                          <select value={nodeDraft.agentId || ''} onChange={e => setNodeDraft(c => c ? { ...c, agentId: e.target.value || undefined } : c)} className="enterprise-input">
                            <option value="">Unassigned</option>
                            {workspace.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </label>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Action</span>
                          <input value={nodeDraft.action || ''} onChange={e => setNodeDraft(c => c ? { ...c, action: e.target.value } : c)} className="enterprise-input" />
                        </label>
                      </>
                    )}

                    {/* HUMAN_TASK */}
                    {nodeDraft.type === 'HUMAN_TASK' && (
                      <>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Instructions</span>
                          <textarea rows={4} value={nodeDraft.humanTaskConfig?.instructions || ''} onChange={e => setNodeDraft(c => c ? { ...c, humanTaskConfig: { ...((c.humanTaskConfig as HumanTaskConfig) || { kind: 'HUMAN_TASK', instructions: '' }), instructions: e.target.value } as HumanTaskConfig } : c)} className="enterprise-input min-h-[7rem]" />
                        </label>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Checklist Items (one per line)</span>
                          <textarea rows={4} value={(nodeDraft.humanTaskConfig?.checklist || []).join('\n')} onChange={e => setNodeDraft(c => c ? { ...c, humanTaskConfig: { ...((c.humanTaskConfig as HumanTaskConfig) || { kind: 'HUMAN_TASK', instructions: '' }), checklist: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } as HumanTaskConfig } : c)} className="enterprise-input min-h-[6rem]" placeholder="Check item 1&#10;Check item 2" />
                        </label>
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>SLA Hours</span>
                            <input type="number" min={1} value={(nodeDraft.humanTaskConfig as HumanTaskConfig)?.slaHours ?? ''} onChange={e => setNodeDraft(c => c ? { ...c, humanTaskConfig: { ...((c.humanTaskConfig as HumanTaskConfig) || { kind: 'HUMAN_TASK', instructions: '' }), slaHours: Number(e.target.value) || undefined } as HumanTaskConfig } : c)} className="enterprise-input" />
                          </label>
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>Assignee Role</span>
                            <input value={(nodeDraft.humanTaskConfig as HumanTaskConfig)?.assigneeRole || ''} onChange={e => setNodeDraft(c => c ? { ...c, humanTaskConfig: { ...((c.humanTaskConfig as HumanTaskConfig) || { kind: 'HUMAN_TASK', instructions: '' }), assigneeRole: e.target.value } as HumanTaskConfig } : c)} className="enterprise-input" placeholder="e.g. Finance Manager" />
                          </label>
                        </div>
                        <div className="rounded-2xl border border-outline-variant/25 bg-white px-4 py-3">
                          <label className="flex items-center gap-3 text-sm text-secondary">
                            <input type="checkbox" checked={Boolean((nodeDraft.humanTaskConfig as HumanTaskConfig)?.requiresDocumentUpload)} onChange={e => setNodeDraft(c => c ? { ...c, humanTaskConfig: { ...((c.humanTaskConfig as HumanTaskConfig) || { kind: 'HUMAN_TASK', instructions: '' }), requiresDocumentUpload: e.target.checked } as HumanTaskConfig } : c)} className="h-4 w-4 rounded" />
                            Requires document upload from assignee
                          </label>
                        </div>
                      </>
                    )}

                    {/* AGENT_TASK */}
                    {nodeDraft.type === 'AGENT_TASK' && (
                      <>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Agent</span>
                          <select value={nodeDraft.agentId || ''} onChange={e => setNodeDraft(c => c ? { ...c, agentId: e.target.value || undefined } : c)} className="enterprise-input">
                            <option value="">Select an agent…</option>
                            {workspace.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </label>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Action / Objective</span>
                          <input value={nodeDraft.action || ''} onChange={e => setNodeDraft(c => c ? { ...c, action: e.target.value } : c)} className="enterprise-input" />
                        </label>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Parameters (JSON)</span>
                          <textarea rows={4} value={nodeDraft.agentTaskConfig?.parameters ? JSON.stringify(nodeDraft.agentTaskConfig.parameters, null, 2) : ''} onChange={e => { try { const p = JSON.parse(e.target.value); setNodeDraft(c => c ? { ...c, agentTaskConfig: { ...((c.agentTaskConfig as AgentTaskConfig) || { kind: 'AGENT_TASK' }), parameters: p } as AgentTaskConfig } : c); } catch { /* ignore invalid JSON while typing */ } }} className="enterprise-input font-mono text-xs min-h-[6rem]" placeholder="{}" />
                        </label>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Timeout (minutes)</span>
                          <input type="number" min={1} value={(nodeDraft.agentTaskConfig as AgentTaskConfig)?.timeoutMinutes ?? ''} onChange={e => setNodeDraft(c => c ? { ...c, agentTaskConfig: { ...((c.agentTaskConfig as AgentTaskConfig) || { kind: 'AGENT_TASK' }), timeoutMinutes: Number(e.target.value) || undefined } as AgentTaskConfig } : c)} className="enterprise-input" />
                        </label>
                      </>
                    )}

                    {/* SUB_WORKFLOW */}
                    {nodeDraft.type === 'SUB_WORKFLOW' && (
                      <>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Referenced Workflow</span>
                          <select value={nodeDraft.subWorkflowConfig?.referencedWorkflowId || ''} onChange={e => {
                            const wf = workflows.find(w => w.id === e.target.value);
                            if (wf) setNodeDraft(c => c ? { ...c, subWorkflowConfig: { ...(c.subWorkflowConfig || { waitForCompletion: true }), referencedWorkflowId: wf.id, referencedWorkflowName: wf.name } as SubWorkflowConfig } : c);
                          }} className="enterprise-input">
                            <option value="">Select a workflow…</option>
                            {workflows.filter(w => w.id !== selectedWorkflow?.id).map(w => <option key={w.id} value={w.id}>{w.name} {w.publishState ? `(${w.publishState})` : ''}</option>)}
                          </select>
                        </label>
                        <div className="rounded-2xl border border-outline-variant/25 bg-white px-4 py-3">
                          <label className="flex items-center gap-3 text-sm text-secondary">
                            <input type="checkbox" checked={Boolean(nodeDraft.subWorkflowConfig?.waitForCompletion ?? true)} onChange={e => setNodeDraft(c => c ? { ...c, subWorkflowConfig: { ...(c.subWorkflowConfig || { referencedWorkflowId: '', referencedWorkflowName: '' }), waitForCompletion: e.target.checked } as SubWorkflowConfig } : c)} className="h-4 w-4 rounded" />
                            Wait for sub-workflow to complete before advancing
                          </label>
                        </div>
                        {nodeDraft.subWorkflowConfig?.referencedWorkflowId && (
                          <button type="button" onClick={() => navigate(`/capabilities/${activeCapability.id}/workflows?wf=${nodeDraft.subWorkflowConfig?.referencedWorkflowId}`)} className="enterprise-button enterprise-button-secondary self-start">
                            ↗ Open Referenced Workflow
                          </button>
                        )}
                      </>
                    )}

                    {/* HUMAN_APPROVAL */}
                    {nodeDraft.type === 'HUMAN_APPROVAL' && (
                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Approval Policy</p>
                              <p className="mt-1 text-xs leading-relaxed text-secondary">Configure who must approve and how many approvals are needed.</p>
                            </div>
                            <button type="button" onClick={() => setNodeDraft(c => c ? { ...c, approvalPolicy: c.approvalPolicy ? undefined : createDefaultApprovalPolicy(c) } : c)} className="enterprise-button enterprise-button-secondary">
                              {nodeDraft.approvalPolicy ? 'Clear policy' : 'Add policy'}
                            </button>
                          </div>
                        </div>
                        {nodeDraft.approvalPolicy && (
                          <div className="grid gap-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                                <span>Policy Name</span>
                                <input value={nodeDraft.approvalPolicy.name} onChange={e => setNodeDraft(c => c ? { ...c, approvalPolicy: { ...(c.approvalPolicy || createDefaultApprovalPolicy(c)), name: e.target.value } } : c)} className="enterprise-input" />
                              </label>
                              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                                <span>Approval Mode</span>
                                <select value={nodeDraft.approvalPolicy.mode} onChange={e => setNodeDraft(c => c ? { ...c, approvalPolicy: { ...(c.approvalPolicy || createDefaultApprovalPolicy(c)), mode: e.target.value as ApprovalMode } } : c)} className="enterprise-input">
                                  <option value="ANY_ONE">Any one approver</option>
                                  <option value="ALL_REQUIRED">All approvers required</option>
                                  <option value="QUORUM">Quorum (minimum count)</option>
                                </select>
                              </label>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                                <span>Minimum Approvals</span>
                                <input type="number" min={1} value={nodeDraft.approvalPolicy.minimumApprovals ?? ''} onChange={e => setNodeDraft(c => c ? { ...c, approvalPolicy: { ...(c.approvalPolicy || createDefaultApprovalPolicy(c)), minimumApprovals: Number(e.target.value) } } : c)} className="enterprise-input" />
                              </label>
                              <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                                <span>Escalate After (minutes)</span>
                                <input type="number" min={1} value={nodeDraft.approvalPolicy.escalationAfterMinutes ?? ''} onChange={e => setNodeDraft(c => c ? { ...c, approvalPolicy: { ...(c.approvalPolicy || createDefaultApprovalPolicy(c)), escalationAfterMinutes: Number(e.target.value) } } : c)} className="enterprise-input" />
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* GOVERNANCE_GATE */}
                    {nodeDraft.type === 'GOVERNANCE_GATE' && (
                      <>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Gate Name</span>
                          <input value={nodeDraft.governanceGate || ''} onChange={e => setNodeDraft(c => c ? { ...c, governanceGate: e.target.value } : c)} className="enterprise-input" placeholder="e.g. SOC 2 Evidence Gate" />
                        </label>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Exit Criteria (one per line)</span>
                          <textarea rows={4} value={(nodeDraft.exitCriteria || []).join('\n')} onChange={e => setNodeDraft(c => c ? { ...c, exitCriteria: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } : c)} className="enterprise-input min-h-[7rem]" />
                        </label>
                      </>
                    )}

                    {/* ALERT */}
                    {nodeDraft.type === 'ALERT' && (
                      <>
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>Severity</span>
                            <select value={nodeDraft.alertConfig?.severity || 'WARNING'} onChange={e => setNodeDraft(c => c ? { ...c, alertConfig: { ...(c.alertConfig || {}), severity: e.target.value as 'INFO'|'WARNING'|'CRITICAL' } } : c)} className="enterprise-input">
                              <option value="INFO">Info</option>
                              <option value="WARNING">Warning</option>
                              <option value="CRITICAL">Critical</option>
                            </select>
                          </label>
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>Channel</span>
                            <select value={nodeDraft.alertConfig?.channel || 'IN_APP'} onChange={e => setNodeDraft(c => c ? { ...c, alertConfig: { ...(c.alertConfig || {}), channel: e.target.value as WorkflowAlertChannel } } : c)} className="enterprise-input">
                              <option value="IN_APP">In-App</option>
                              <option value="EMAIL">Email</option>
                              <option value="SLACK">Slack</option>
                              <option value="WEBHOOK">Webhook</option>
                            </select>
                          </label>
                        </div>
                        {(nodeDraft.alertConfig?.channel === 'EMAIL') && (
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>Recipients (comma-separated emails)</span>
                            <input value={(nodeDraft.alertConfig?.recipients || []).join(', ')} onChange={e => setNodeDraft(c => c ? { ...c, alertConfig: { ...(c.alertConfig || {}), recipients: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } } : c)} className="enterprise-input" />
                          </label>
                        )}
                        {(nodeDraft.alertConfig?.channel === 'SLACK') && (
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>Slack Channel</span>
                            <input value={nodeDraft.alertConfig?.slackChannel || ''} onChange={e => setNodeDraft(c => c ? { ...c, alertConfig: { ...(c.alertConfig || {}), slackChannel: e.target.value } } : c)} className="enterprise-input" placeholder="#ops-alerts" />
                          </label>
                        )}
                        {(nodeDraft.alertConfig?.channel === 'WEBHOOK' || nodeDraft.alertConfig?.channel === 'SLACK') && (
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>Webhook URL</span>
                            <input value={nodeDraft.alertConfig?.webhookUrl || ''} onChange={e => setNodeDraft(c => c ? { ...c, alertConfig: { ...(c.alertConfig || {}), webhookUrl: e.target.value } } : c)} className="enterprise-input" placeholder="https://hooks.example.com/…" />
                          </label>
                        )}
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Notify Roles (comma-separated)</span>
                          <input value={(nodeDraft.alertConfig?.notifyRoles || []).join(', ')} onChange={e => setNodeDraft(c => c ? { ...c, alertConfig: { ...(c.alertConfig || {}), notifyRoles: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } } : c)} className="enterprise-input" />
                        </label>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Message Template</span>
                          <textarea rows={4} value={nodeDraft.alertConfig?.messageTemplate || ''} onChange={e => setNodeDraft(c => c ? { ...c, alertConfig: { ...(c.alertConfig || {}), messageTemplate: e.target.value } } : c)} className="enterprise-input min-h-[7rem]" />
                        </label>
                        <div className="rounded-2xl border border-outline-variant/25 bg-white px-4 py-3">
                          <label className="flex items-center gap-3 text-sm text-secondary">
                            <input type="checkbox" checked={Boolean(nodeDraft.alertConfig?.requiresAcknowledgement)} onChange={e => setNodeDraft(c => c ? { ...c, alertConfig: { ...(c.alertConfig || {}), requiresAcknowledgement: e.target.checked } } : c)} className="h-4 w-4 rounded" />
                            Requires acknowledgement before workflow continues
                          </label>
                        </div>
                      </>
                    )}

                    {/* EVENT */}
                    {nodeDraft.type === 'EVENT' && (
                      <>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Event Name</span>
                          <input value={nodeDraft.eventConfig?.eventName || ''} onChange={e => setNodeDraft(c => c ? { ...c, eventConfig: { ...(c.eventConfig || {}), eventName: e.target.value } } : c)} className="enterprise-input" />
                        </label>
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>Event Source</span>
                            <input value={nodeDraft.eventConfig?.eventSource || ''} onChange={e => setNodeDraft(c => c ? { ...c, eventConfig: { ...(c.eventConfig || {}), eventSource: e.target.value } } : c)} className="enterprise-input" />
                          </label>
                          <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                            <span>Emit Trigger</span>
                            <select value={nodeDraft.eventConfig?.trigger || 'ON_SUCCESS'} onChange={e => setNodeDraft(c => c ? { ...c, eventConfig: { ...(c.eventConfig || {}), trigger: e.target.value as 'ON_ENTER'|'ON_SUCCESS'|'ON_FAILURE' } } : c)} className="enterprise-input">
                              <option value="ON_ENTER">On enter</option>
                              <option value="ON_SUCCESS">On success</option>
                              <option value="ON_FAILURE">On failure</option>
                            </select>
                          </label>
                        </div>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Payload Template</span>
                          <textarea rows={4} value={nodeDraft.eventConfig?.payloadTemplate || ''} onChange={e => setNodeDraft(c => c ? { ...c, eventConfig: { ...(c.eventConfig || {}), payloadTemplate: e.target.value } } : c)} className="enterprise-input font-mono text-xs min-h-[7rem]" />
                        </label>
                      </>
                    )}

                    {/* Control nodes / START / END */}
                    {['START', 'END', 'DECISION', 'PARALLEL_SPLIT', 'PARALLEL_JOIN'].includes(nodeDraft.type) && (
                      <p className="text-sm text-secondary">This is a control-flow node — it routes execution automatically. Use edges to connect it to the next step.</p>
                    )}
                  </div>
                )}

                {nodeDetailTab === 'io' && !['START', 'END', 'DECISION', 'PARALLEL_SPLIT', 'PARALLEL_JOIN'].includes(nodeDraft.type) && (
                  <div className="grid gap-4">
                    {!businessView && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Primary Input Reference (Artifact ID)</span>
                          <input value={nodeDraft.inputArtifactId || ''} onChange={e => setNodeDraft(c => c ? { ...c, inputArtifactId: e.target.value || undefined } : c)} className="enterprise-input font-mono text-xs" />
                        </label>
                        <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>Primary Output Reference (Artifact ID)</span>
                          <input value={nodeDraft.outputArtifactId || ''} onChange={e => setNodeDraft(c => c ? { ...c, outputArtifactId: e.target.value || undefined } : c)} className="enterprise-input font-mono text-xs" />
                        </label>
                      </div>
                    )}
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                        <span>Input Documents (one per line)</span>
                        <textarea rows={5} value={(nodeDraft.artifactContract?.requiredInputs || []).join('\n')} onChange={e => setNodeDraft(c => c ? { ...c, artifactContract: { ...(c.artifactContract || {}), requiredInputs: e.target.value.split('\n').map(s => s.trim()).filter(Boolean), expectedOutputs: c.artifactContract?.expectedOutputs || [], notes: c.artifactContract?.notes } } : c)} className="enterprise-input min-h-[8rem]" />
                      </label>
                      <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                        <span>Output Documents (one per line)</span>
                        <textarea rows={5} value={(nodeDraft.artifactContract?.expectedOutputs || []).join('\n')} onChange={e => setNodeDraft(c => c ? { ...c, artifactContract: { ...(c.artifactContract || {}), requiredInputs: c.artifactContract?.requiredInputs || [], expectedOutputs: e.target.value.split('\n').map(s => s.trim()).filter(Boolean), notes: c.artifactContract?.notes } } : c)} className="enterprise-input min-h-[8rem]" />
                      </label>
                    </div>
                    <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                      <span>Artifact Guidance</span>
                      <textarea rows={3} value={nodeDraft.artifactContract?.notes || ''} onChange={e => setNodeDraft(c => c ? { ...c, artifactContract: { ...(c.artifactContract || {}), requiredInputs: c.artifactContract?.requiredInputs || [], expectedOutputs: c.artifactContract?.expectedOutputs || [], notes: e.target.value || undefined } } : c)} className="enterprise-input min-h-[5rem]" />
                    </label>
                    <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                      <span>Exit Criteria (one per line)</span>
                      <textarea rows={3} value={(nodeDraft.exitCriteria || []).join('\n')} onChange={e => setNodeDraft(c => c ? { ...c, exitCriteria: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } : c)} className="enterprise-input min-h-[5rem]" />
                    </label>
                  </div>
                )}

                {nodeDetailTab === 'governance' && (
                  <div className="grid gap-4">
                    <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                      <span>Approver Roles (comma-separated)</span>
                      <input value={(nodeDraft.approverRoles || []).join(', ')} onChange={e => setNodeDraft(c => c ? { ...c, approverRoles: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } : c)} className="enterprise-input" />
                    </label>
                    {nodeDraft.type !== 'HUMAN_APPROVAL' && (
                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Approval Policy</p>
                              <p className="mt-1 text-xs leading-relaxed text-secondary">Optionally require formal approval before this step completes.</p>
                            </div>
                            <button type="button" onClick={() => setNodeDraft(c => c ? { ...c, approvalPolicy: c.approvalPolicy ? undefined : createDefaultApprovalPolicy(c) } : c)} className="enterprise-button enterprise-button-secondary">
                              {nodeDraft.approvalPolicy ? 'Clear policy' : 'Add policy'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Ownership & Routing</p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">Override default phase ownership for this step.</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                        <span>Primary Owner Team Override</span>
                        <select value={nodeDraft.ownershipRule?.primaryOwnerTeamId || ''} onChange={e => setNodeDraft(c => c ? { ...c, ownershipRule: { ...(c.ownershipRule || createDefaultOwnershipRule()), primaryOwnerTeamId: e.target.value || undefined } } : c)} className="enterprise-input">
                          <option value="">Use phase default</option>
                          {workspaceTeamOptions.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </label>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-outline">Require Handoff Acceptance</p>
                        <div className="rounded-2xl border border-outline-variant/25 bg-white px-4 py-3">
                          <label className="flex items-center gap-3 text-sm text-secondary">
                            <input type="checkbox" checked={Boolean(nodeDraft.ownershipRule?.requireHandoffAcceptance)} onChange={e => setNodeDraft(c => c ? { ...c, ownershipRule: { ...(c.ownershipRule || createDefaultOwnershipRule()), requireHandoffAcceptance: e.target.checked } } : c)} className="h-4 w-4 rounded" />
                            Team must accept handoff before step activates
                          </label>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      {(['secondaryOwnerTeamIds', 'approvalTeamIds', 'escalationTeamIds'] as const).map(field => (
                        <label key={field} className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                          <span>{field === 'secondaryOwnerTeamIds' ? 'Secondary Owners' : field === 'approvalTeamIds' ? 'Approval Teams' : 'Escalation Teams'}</span>
                          <select multiple value={nodeDraft.ownershipRule?.[field] || []} onChange={e => setNodeDraft(c => c ? { ...c, ownershipRule: { ...(c.ownershipRule || createDefaultOwnershipRule()), [field]: Array.from(e.target.selectedOptions).map(o => o.value) } } : c)} className="enterprise-input min-h-[7rem]">
                            {workspaceTeamOptions.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {!businessView && nodeDetailTab === 'execution' && ['DELIVERY', 'AGENT_TASK', 'RELEASE'].includes(nodeDraft.type) && (
                  <div className="grid gap-4">
                    <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                      <span>Allowed Tools</span>
                      <select multiple value={nodeDraft.allowedToolIds || []} onChange={e => setNodeDraft(c => c ? { ...c, allowedToolIds: Array.from(e.target.selectedOptions).map(o => o.value as ToolAdapterId) } : c)} className="enterprise-input min-h-[9rem]">
                        {TOOL_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <p className="text-[0.72rem] font-medium normal-case tracking-normal text-secondary">This allowlist is the real execution gate. Agent preferred tools stay advisory and do not bypass these permissions.</p>
                    </label>
                    <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                      <span>Preferred Workspace Path</span>
                      <input value={nodeDraft.preferredWorkspacePath || ''} onChange={e => setNodeDraft(c => c ? { ...c, preferredWorkspacePath: e.target.value || undefined } : c)} className="enterprise-input font-mono text-xs" />
                    </label>
                    <label className="space-y-2 text-xs font-semibold uppercase tracking-[0.18em] text-outline">
                      <span>Execution Notes</span>
                      <textarea rows={4} value={nodeDraft.executionNotes || ''} onChange={e => setNodeDraft(c => c ? { ...c, executionNotes: e.target.value } : c)} className="enterprise-input min-h-[7rem]" />
                    </label>
                  </div>
                )}

                {/* Save / Close */}
                <div className="flex flex-wrap justify-end gap-3">
                  <button type="button" onClick={() => setIsNodeDetailsOpen(false)} className="enterprise-button enterprise-button-secondary">Close</button>
                  <button type="button" onClick={() => { handleApplyNodeDraft(); setIsNodeDetailsOpen(false); }} className="enterprise-button enterprise-button-primary">Save Changes</button>
                </div>
              </div>
            </ModalShell>
          </div>
        </div>
      ) : null}

      {/* Sub-Workflow Picker Dialog */}
      {isSubWorkflowPickerOpen && (
        <div className="fixed inset-0 z-[96] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-20 backdrop-blur-sm">
          <div className="w-full max-w-2xl">
            <ModalShell
              eyebrow="Compositions"
              title="Select a workflow to embed"
              description="Choose a workflow from this capability to run as a composable step. Select it and the node will be configured automatically."
              actions={
                <button type="button" onClick={() => { setIsSubWorkflowPickerOpen(false); setPendingSubWorkflowNodeId(null); }} className="rounded-full p-2 text-outline transition hover:bg-surface-container-low hover:text-on-surface">
                  <X size={18} />
                </button>
              }
            >
              <div className="grid gap-3">
                {workflows.filter(w => w.id !== selectedWorkflow?.id).length === 0 ? (
                  <p className="text-sm text-secondary">No other workflows available in this capability.</p>
                ) : workflows.filter(w => w.id !== selectedWorkflow?.id).map(wf => (
                  <button
                    key={wf.id}
                    type="button"
                    onClick={() => {
                      if (pendingSubWorkflowNodeId) {
                        replaceSelectedWorkflow(
                          workflow => ({
                            ...workflow,
                            nodes: (workflow.nodes || []).map(n =>
                              n.id === pendingSubWorkflowNodeId
                                ? { ...n, name: wf.name, subWorkflowConfig: { referencedWorkflowId: wf.id, referencedWorkflowName: wf.name, waitForCompletion: true } }
                                : n
                            ),
                          }),
                          'Sub-workflow configured',
                          `Now embedding "${wf.name}".`,
                        );
                      }
                      setIsSubWorkflowPickerOpen(false);
                      setPendingSubWorkflowNodeId(null);
                    }}
                    className="flex items-center justify-between rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-on-surface">{wf.name}</p>
                      {wf.summary && <p className="mt-0.5 text-xs text-secondary">{wf.summary}</p>}
                    </div>
                    {wf.publishState && (
                      <StatusBadge tone={wf.publishState === 'PUBLISHED' ? 'success' : 'neutral'}>{wf.publishState}</StatusBadge>
                    )}
                  </button>
                ))}
              </div>
            </ModalShell>
          </div>
        </div>
      )}

      {/* Version History Panel */}
      {isVersionHistoryOpen && (
        <div className="fixed inset-0 z-[96] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-20 backdrop-blur-sm">
          <div className="w-full max-w-2xl">
            <ModalShell
              eyebrow="Workflow History"
              title={`Version history — ${selectedWorkflow?.name}`}
              description="Browse prior published snapshots. Each unlock creates a new version."
              actions={
                <button type="button" onClick={() => setIsVersionHistoryOpen(false)} className="rounded-full p-2 text-outline transition hover:bg-surface-container-low hover:text-on-surface">
                  <X size={18} />
                </button>
              }
            >
              <div className="grid gap-3">
                {workflowVersions.length === 0 ? (
                  <p className="text-sm text-secondary">No previous versions yet. Publish and unlock this workflow to create version snapshots.</p>
                ) : workflowVersions.map(v => (
                  <div key={v.id} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-on-surface">Version {v.version}</p>
                        <p className="mt-0.5 text-xs text-secondary">{new Date(v.createdAt).toLocaleString()} {v.createdBy ? `· by ${v.createdBy}` : ''}</p>
                        {v.changeSummary && <p className="mt-1 text-xs text-secondary italic">{v.changeSummary}</p>}
                      </div>
                      <StatusBadge tone={v.publishState === 'PUBLISHED' ? 'success' : 'neutral'}>{v.publishState}</StatusBadge>
                    </div>
                  </div>
                ))}
              </div>
            </ModalShell>
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
}
