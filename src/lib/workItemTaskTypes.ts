import { findFirstExecutableNode, findFirstExecutableNodeForPhase } from './workflowGraph';
import type {
  CapabilityLifecycle,
  WorkItemTaskType,
  Workflow,
  WorkflowNode,
  WorkflowPhaseId,
  WorkflowStep,
} from '../types';

export const DEFAULT_WORK_ITEM_TASK_TYPE: WorkItemTaskType = 'GENERAL';

type WorkItemTaskTypeOption = {
  value: WorkItemTaskType;
  label: string;
  description: string;
  entryPhase?: WorkflowPhaseId;
};

const WORK_ITEM_TASK_TYPE_META: Record<WorkItemTaskType, WorkItemTaskTypeOption> = {
  GENERAL: {
    value: 'GENERAL',
    label: 'General Delivery',
    description: 'Use the workflow’s default starting point.',
  },
  STRATEGIC_INITIATIVE: {
    value: 'STRATEGIC_INITIATIVE',
    label: 'Strategic Initiative',
    description: 'Start in Inception to define intent, scope, and executive framing.',
    entryPhase: 'INCEPTION',
  },
  'NEW_BUSINESS_CASE': {
    value: 'NEW_BUSINESS_CASE',
    label: 'New Business Case',
    description: 'Start in Inception to shape the business case and early scope.',
    entryPhase: 'INCEPTION',
  },
  FEATURE_ENHANCEMENT: {
    value: 'FEATURE_ENHANCEMENT',
    label: 'Feature Enhancement',
    description: 'Start in Elaboration to refine solution shape and architecture.',
    entryPhase: 'ELABORATION',
  },
  PRODUCTION_ISSUE: {
    value: 'PRODUCTION_ISSUE',
    label: 'Production Issue',
    description: 'Start in Elaboration to assess impact and shape the safest recovery path.',
    entryPhase: 'ELABORATION',
  },
  BUGFIX: {
    value: 'BUGFIX',
    label: 'Bugfix',
    description: 'Start in Construction so the team can move straight into build and validation.',
    entryPhase: 'CONSTRUCTION',
  },
  SECURITY_FINDING: {
    value: 'SECURITY_FINDING',
    label: 'Security Finding',
    description: 'Start in Construction to remediate and verify the security issue quickly.',
    entryPhase: 'CONSTRUCTION',
  },
  REHYDRATION: {
    value: 'REHYDRATION',
    label: 'Rehydration',
    description: 'Start in Delivery to restore, recover, or re-operationalize an existing flow.',
    entryPhase: 'DELIVERY',
  },
};

export const WORK_ITEM_TASK_TYPE_OPTIONS = Object.values(WORK_ITEM_TASK_TYPE_META);

export const normalizeWorkItemTaskType = (
  value?: string | WorkItemTaskType | null,
): WorkItemTaskType => {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_') as WorkItemTaskType;
  return WORK_ITEM_TASK_TYPE_META[normalized] ? normalized : DEFAULT_WORK_ITEM_TASK_TYPE;
};

export const getWorkItemTaskTypeLabel = (
  taskType?: WorkItemTaskType | null,
) => WORK_ITEM_TASK_TYPE_META[normalizeWorkItemTaskType(taskType)].label;

export const getWorkItemTaskTypeDescription = (
  taskType?: WorkItemTaskType | null,
) => WORK_ITEM_TASK_TYPE_META[normalizeWorkItemTaskType(taskType)].description;

export const getWorkItemTaskTypeEntryPhase = (
  taskType?: WorkItemTaskType | null,
) => WORK_ITEM_TASK_TYPE_META[normalizeWorkItemTaskType(taskType)].entryPhase;

export const resolveWorkItemEntryNode = (
  workflow: Workflow,
  taskType?: WorkItemTaskType | null,
  lifecycle?: CapabilityLifecycle | null,
): WorkflowNode | undefined => {
  const entryPhase = getWorkItemTaskTypeEntryPhase(taskType);
  if (entryPhase) {
    const phaseNode = findFirstExecutableNodeForPhase(workflow, entryPhase, lifecycle);
    if (phaseNode) {
      return phaseNode;
    }
  }

  return findFirstExecutableNode(workflow);
};

export const resolveWorkItemEntryStep = (
  workflow: Workflow,
  taskType?: WorkItemTaskType | null,
  lifecycle?: CapabilityLifecycle | null,
): WorkflowStep | undefined => {
  const entryNode = resolveWorkItemEntryNode(workflow, taskType, lifecycle);
  return entryNode
    ? workflow.steps.find(step => step.id === entryNode.id)
    : undefined;
};
