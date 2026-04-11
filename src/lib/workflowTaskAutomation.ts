import { AgentTask, Artifact, WorkItem, Workflow, WorkflowStep } from '../types';
import {
  isImplementationWorkflowStep,
  isTestingWorkflowStep,
} from './workflowStepSemantics';

const createManagedTaskId = (workItemId: string, stepId: string) =>
  `TASK-${workItemId}-${stepId}`;

const formatTaskTimestamp = (value?: string) =>
  value ||
  new Date().toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const mapArtifactTypeToLinkType = (artifactType: string) => {
  const normalizedType = artifactType.toLowerCase();
  if (normalizedType.includes('data')) {
    return 'table' as const;
  }
  if (normalizedType.includes('governance') || normalizedType.includes('compliance')) {
    return 'scale' as const;
  }
  return 'file' as const;
};

const getTaskType = (step: WorkflowStep): NonNullable<AgentTask['taskType']> => {
  if (isTestingWorkflowStep(step)) {
    return 'TEST';
  }
  if (step.stepType === 'HUMAN_APPROVAL') {
    return 'APPROVAL';
  }
  if (step.stepType === 'GOVERNANCE_GATE') {
    return 'GOVERNANCE';
  }
  return 'DELIVERY';
};

const buildTaskTitle = (workItem: WorkItem, step: WorkflowStep) => {
  const taskType = getTaskType(step);

  if (taskType === 'TEST') {
    return `${workItem.title} · Test Coverage & QA Evidence`;
  }
  if (isImplementationWorkflowStep(step)) {
    return `${workItem.title} · Implementation & Unit Tests`;
  }
  if (taskType === 'APPROVAL') {
    return `${workItem.title} · Human Approval`;
  }
  if (taskType === 'GOVERNANCE') {
    return `${workItem.title} · Governance Validation`;
  }

  return `${workItem.title} · ${step.name}`;
};

const buildTaskPrompt = (workItem: WorkItem, step: WorkflowStep) => {
  const taskType = getTaskType(step);
  const lines = [
    `Workflow-managed task for story "${workItem.title}".`,
    `Current SDLC step: ${step.name} (${step.phase}).`,
    `Objective: ${step.action}`,
    `Story context: ${workItem.description}`,
  ];

  if (step.description) {
    lines.push(`Step guidance: ${step.description}`);
  }

  if (isImplementationWorkflowStep(step)) {
    lines.push(
      'Implementation must include the required code changes plus unit or integration tests before the story can move forward.',
    );
  }

  if (taskType === 'TEST') {
    lines.push(
      'Create or refine the test approach, execute validation, capture evidence, and record any defects or residual release risk.',
    );
  }

  if (step.exitCriteria?.length) {
    lines.push(`Exit criteria: ${step.exitCriteria.join('; ')}`);
  }

  return lines.join(' ');
};

const buildTaskExecutionNotes = (workItem: WorkItem, step: WorkflowStep) => {
  const taskType = getTaskType(step);

  if (taskType === 'TEST') {
    return `Workflow-managed testing task for ${workItem.title}. The SDLC flow automatically provisions QA coverage, test execution evidence, and release-quality feedback without requiring a separate manual task.`;
  }

  if (isImplementationWorkflowStep(step)) {
    return `Workflow-managed development task for ${workItem.title}. The implementation phase is responsible for code changes plus developer test coverage before hand-off to QA.`;
  }

  if (taskType === 'APPROVAL') {
    return `Workflow-managed approval task for ${workItem.title}. This task stays aligned to the story and waits for the required human sign-off.`;
  }

  if (taskType === 'GOVERNANCE') {
    return `Workflow-managed governance task for ${workItem.title}. Validation and policy evidence are captured here before release approval.`;
  }

  return `Workflow-managed ${step.phase.toLowerCase()} task for ${workItem.title}. This step is automatically maintained by the SDLC workflow.`;
};

const buildLinkedArtifacts = (
  step: WorkflowStep,
  artifacts: Artifact[],
  existingArtifacts?: NonNullable<AgentTask['linkedArtifacts']>,
) => {
  if (existingArtifacts?.length) {
    return existingArtifacts;
  }

  const nextArtifacts: NonNullable<AgentTask['linkedArtifacts']> = [];
  const inputArtifact = artifacts.find(artifact => artifact.id === step.inputArtifactId);
  const outputArtifact = artifacts.find(artifact => artifact.id === step.outputArtifactId);

  if (inputArtifact) {
    nextArtifacts.push({
      name: inputArtifact.name,
      size: `${inputArtifact.version} • input`,
      type: mapArtifactTypeToLinkType(inputArtifact.type),
    });
  }

  if (outputArtifact) {
    nextArtifacts.push({
      name: outputArtifact.name,
      size: `${outputArtifact.version} • output`,
      type: mapArtifactTypeToLinkType(outputArtifact.type),
    });
  }

  return nextArtifacts;
};

const buildProducedOutputs = (
  step: WorkflowStep,
  artifacts: Artifact[],
  status: AgentTask['status'],
  existingOutputs?: NonNullable<AgentTask['producedOutputs']>,
) => {
  const nextStatus: 'completed' | 'pending' =
    status === 'COMPLETED' ? 'completed' : 'pending';
  const outputArtifact = artifacts.find(artifact => artifact.id === step.outputArtifactId);

  if (existingOutputs?.length) {
    return existingOutputs.map(output => ({
      ...output,
      status: nextStatus,
    }));
  }

  if (outputArtifact) {
    return [
      {
        name: outputArtifact.name,
        status: nextStatus,
      },
    ];
  }

  if (getTaskType(step) === 'TEST') {
    return [
      {
        name: 'Test Evidence Package',
        status: nextStatus,
      },
    ];
  }

  return [];
};

const getTaskStatus = (
  workItem: WorkItem,
  workflow: Workflow,
  step: WorkflowStep,
): AgentTask['status'] => {
  const currentIndex = workflow.steps.findIndex(candidate => candidate.id === workItem.currentStepId);
  const stepIndex = workflow.steps.findIndex(candidate => candidate.id === step.id);

  if (workItem.status === 'COMPLETED') {
    return 'COMPLETED';
  }

  if (currentIndex >= 0 && stepIndex < currentIndex) {
    return 'COMPLETED';
  }

  if (currentIndex >= 0 && step.id === workItem.currentStepId) {
    if (workItem.status === 'BLOCKED') {
      return 'ALERT';
    }
    if (workItem.status === 'PENDING_APPROVAL') {
      return 'PENDING';
    }
    return 'PROCESSING';
  }

  return 'QUEUED';
};

export const syncWorkflowManagedTasksForWorkItem = ({
  allTasks,
  workItem,
  workflow,
  artifacts,
}: {
  allTasks: AgentTask[];
  workItem: WorkItem;
  workflow: Workflow;
  artifacts: Artifact[];
}) => {
  const existingManagedTasks = new Map(
    allTasks
      .filter(task => task.managedByWorkflow && task.workItemId === workItem.id)
      .map(task => [task.workflowStepId || task.id, task]),
  );

  const nextManagedTasks = workflow.steps.map(step => {
    const existingTask = existingManagedTasks.get(step.id);
    const nextStatus = getTaskStatus(workItem, workflow, step);

    return {
      id: existingTask?.id || createManagedTaskId(workItem.id, step.id),
      title: buildTaskTitle(workItem, step),
      agent: step.agentId,
      capabilityId: workItem.capabilityId,
      workItemId: workItem.id,
      workflowId: workflow.id,
      workflowStepId: step.id,
      managedByWorkflow: true,
      taskType: getTaskType(step),
      phase: step.phase,
      priority: workItem.priority,
      status: nextStatus,
      timestamp: formatTaskTimestamp(existingTask?.timestamp),
      prompt: buildTaskPrompt(workItem, step),
      executionNotes: buildTaskExecutionNotes(workItem, step),
      linkedArtifacts: buildLinkedArtifacts(
        step,
        artifacts,
        existingTask?.linkedArtifacts,
      ),
      producedOutputs: buildProducedOutputs(
        step,
        artifacts,
        nextStatus,
        existingTask?.producedOutputs,
      ),
    } satisfies AgentTask;
  });

  return [
    ...allTasks.filter(
      task => !(task.managedByWorkflow && task.workItemId === workItem.id),
    ),
    ...nextManagedTasks,
  ];
};
