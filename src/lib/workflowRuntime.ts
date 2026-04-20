import type {
  AgentArtifactExpectation,
  Artifact,
  Capability,
  CapabilityAgent,
  CompiledArtifactChecklistItem,
  CompiledRequiredInputField,
  CompiledStepContext,
  CompiledWorkItemPlan,
  ExecutionBoundary,
  RequiredInputField,
  ToolAdapterId,
  Workflow,
  WorkflowStep,
  WorkItem,
} from '../types';
import { getCapabilityBoardPhaseIds } from './capabilityLifecycle';
import { compileStepOwnership } from './capabilityOwnership';
import { BUILD_STEP_OUTPUT_LABEL, isBuildStep } from './buildStepContract';

type CompileStepContextArgs = {
  capability: Capability;
  workItem: WorkItem;
  workflow: Workflow;
  step: WorkflowStep;
  agent?: CapabilityAgent | null;
  handoffContext?: string;
  resolvedWaitContext?: string;
  artifacts?: Artifact[];
};

const WRITE_CAPABLE_TOOLS = new Set<ToolAdapterId>([
  'workspace_write',
  'workspace_replace_block',
  'workspace_apply_patch',
  'run_build',
  'run_test',
  'run_docs',
  'run_deploy',
]);

const READ_ONLY_TOOLS = new Set<ToolAdapterId>([
  'workspace_list',
  'workspace_read',
  'workspace_search',
  'git_status',
]);

const hasText = (value?: string | null) => Boolean(value && value.trim().length > 0);

const summarizeText = (value?: string | null, limit = 120) => {
  if (!hasText(value)) {
    return undefined;
  }

  return value!.replace(/\s+/g, ' ').trim().slice(0, limit);
};

const dedupeById = <T extends { id: string }>(items: T[]) => {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
};

export const deriveExecutionBoundary = (
  capability: Capability,
  step: WorkflowStep,
): ExecutionBoundary => {
  const allowedToolIds = step.allowedToolIds || [];
  const workspaceMode = allowedToolIds.some(toolId => WRITE_CAPABLE_TOOLS.has(toolId))
    ? 'APPROVED_WRITE'
    : allowedToolIds.some(toolId => READ_ONLY_TOOLS.has(toolId))
    ? 'READ_ONLY'
    : 'NONE';

  const escalationTriggers = [
    ...(step.approverRoles?.length
      ? [`Requires review from ${step.approverRoles.join(', ')}`]
      : []),
    ...(allowedToolIds.includes('run_deploy')
      ? ['Deployment commands remain approval-gated.']
      : []),
    ...(allowedToolIds.some(
      toolId =>
        toolId === 'workspace_write' ||
        toolId === 'workspace_replace_block' ||
        toolId === 'workspace_apply_patch',
    )
      ? ['Workspace writes should produce reviewable code diff evidence.']
      : []),
    ...(capability.executionConfig.allowedWorkspacePaths.length === 0 &&
    workspaceMode !== 'NONE'
      ? ['No approved workspace paths are configured yet.']
      : []),
  ];

  return {
    allowedToolIds,
    workspaceMode,
    requiresHumanApproval:
      step.stepType === 'HUMAN_APPROVAL' ||
      Boolean(step.executionBoundary?.requiresHumanApproval) ||
      allowedToolIds.includes('run_deploy'),
    escalationTriggers,
  };
};

export const normalizeExecutionBoundary = (
  value?: Partial<ExecutionBoundary> | null,
): ExecutionBoundary => ({
  allowedToolIds: Array.isArray(value?.allowedToolIds) ? value.allowedToolIds : [],
  workspaceMode:
    value?.workspaceMode === 'READ_ONLY' ||
    value?.workspaceMode === 'APPROVED_WRITE' ||
    value?.workspaceMode === 'NONE'
      ? value.workspaceMode
      : 'NONE',
  requiresHumanApproval: Boolean(value?.requiresHumanApproval),
  escalationTriggers: Array.isArray(value?.escalationTriggers)
    ? value.escalationTriggers.filter(trigger => typeof trigger === 'string')
    : [],
});

const buildDefaultRequiredInputs = ({
  capability,
  workflow,
  step,
}: Pick<CompileStepContextArgs, 'capability' | 'workflow' | 'step'>): RequiredInputField[] => {
  const fields: RequiredInputField[] = [
    {
      id: 'work-item-request',
      label: 'Work item request',
      description: 'The title or request description that defines the delivery outcome.',
      required: true,
      source: 'WORK_ITEM',
      kind: 'MARKDOWN',
    },
    {
      id: 'capability-charter',
      label: 'Capability purpose',
      description: 'The business purpose or outcome this capability is responsible for.',
      required: true,
      source: 'CAPABILITY',
      kind: 'CONTEXT',
    },
  ];

  if ((step.allowedToolIds || []).length > 0 || hasText(step.preferredWorkspacePath)) {
    fields.push({
      id: 'approved-workspace',
      label: 'Approved workspace',
      description: 'A validated workspace path that tools can safely inspect or execute inside.',
      required: true,
      source: 'WORKSPACE',
      kind: 'PATH',
    });
  }

  if ((workflow.steps.findIndex(item => item.id === step.id) || 0) > 0) {
    fields.push({
      id: 'prior-step-handoff',
      label: 'Prior step hand-off',
      description: 'Carry-forward context or evidence from earlier workflow steps.',
      required: true,
      source: 'HANDOFF',
      kind: 'CONTEXT',
    });
  }

  return fields;
};

const buildArtifactEvidenceText = (artifacts: Artifact[], workItemId: string) =>
  artifacts
    .filter(artifact => artifact.workItemId === workItemId)
    .map(artifact =>
      [artifact.name, artifact.summary, artifact.description, artifact.contentText]
        .filter(Boolean)
        .join(' '),
    )
    .join('\n')
    .toLowerCase();

const evaluateRequiredInput = ({
  field,
  capability,
  workItem,
  handoffContext,
  resolvedWaitContext,
  artifactEvidenceText,
}: {
  field: RequiredInputField;
  capability: Capability;
  workItem: WorkItem;
  handoffContext?: string;
  resolvedWaitContext?: string;
  artifactEvidenceText: string;
}): CompiledRequiredInputField => {
  const valueHint = summarizeText(field.valueHint);
  const normalizedLabel = field.label.trim().toLowerCase();

  const withStatus = (
    status: 'READY' | 'MISSING',
    valueSummary?: string,
  ): CompiledRequiredInputField => ({
    ...field,
    status,
    valueSummary,
  });

  switch (field.source) {
    case 'WORK_ITEM': {
      const summary = summarizeText(workItem.description) || summarizeText(workItem.title);
      return withStatus(summary ? 'READY' : 'MISSING', summary);
    }
    case 'CAPABILITY': {
      const summary =
        summarizeText(capability.businessOutcome) || summarizeText(capability.description);
      return withStatus(summary ? 'READY' : 'MISSING', summary);
    }
    case 'WORKSPACE': {
      const summary =
        summarizeText(stepPreferredWorkspace(capability)) ||
        summarizeText(capability.executionConfig.allowedWorkspacePaths[0]);
      return withStatus(summary ? 'READY' : 'MISSING', summary);
    }
    case 'HANDOFF': {
      const summary = summarizeText(handoffContext);
      return withStatus(summary ? 'READY' : 'MISSING', summary);
    }
    case 'HUMAN_INPUT': {
      const summary = summarizeText(resolvedWaitContext);
      return withStatus(summary ? 'READY' : 'MISSING', summary);
    }
    case 'ARTIFACT': {
      const matched =
        (valueHint && artifactEvidenceText.includes(valueHint.toLowerCase())) ||
        artifactEvidenceText.includes(normalizedLabel);
      return withStatus(
        matched ? 'READY' : 'MISSING',
        matched ? `Matched ${field.valueHint || field.label}` : undefined,
      );
    }
    case 'RUNTIME': {
      const summary = summarizeText(capability.executionConfig.defaultWorkspacePath);
      return withStatus(summary ? 'READY' : 'MISSING', summary);
    }
    default:
      return withStatus('MISSING');
  }
};

const stepPreferredWorkspace = (capability: Capability) =>
  capability.executionConfig.defaultWorkspacePath ||
  capability.executionConfig.allowedWorkspacePaths[0] ||
  capability.localDirectories[0] ||
  '';

const buildArtifactChecklist = ({
  step,
  handoffContext,
}: Pick<CompileStepContextArgs, 'step' | 'handoffContext'>): CompiledArtifactChecklistItem[] => {
  const requiredInputs = (step.artifactContract?.requiredInputs || []).map((label, index) => ({
    id: `input-${index}-${label}`,
    label,
    direction: 'INPUT' as const,
    status: hasText(handoffContext) ? 'READY' as const : 'EXPECTED' as const,
    description: step.artifactContract?.notes,
  }));

  // For BUILD steps we inject the canonical CODE_PATCH contract label
  // if the step author didn't spell it out. Keeps the "expected outputs"
  // panel consistent regardless of whether the template or the user
  // authored the step.
  const authorExpectedOutputs = step.artifactContract?.expectedOutputs || [];
  const expectedOutputLabels = isBuildStep(step)
    ? authorExpectedOutputs.some(
        label => label.trim() === BUILD_STEP_OUTPUT_LABEL,
      )
      ? authorExpectedOutputs
      : [...authorExpectedOutputs, BUILD_STEP_OUTPUT_LABEL]
    : authorExpectedOutputs;

  const expectedOutputs = expectedOutputLabels.map((label, index) => ({
    id: `output-${index}-${label}`,
    label,
    direction: 'OUTPUT' as const,
    status: 'EXPECTED' as const,
    description: step.artifactContract?.notes,
  }));

  return [...requiredInputs, ...expectedOutputs];
};

const cloneAgentArtifactExpectations = (
  expectations: AgentArtifactExpectation[] = [],
  direction: AgentArtifactExpectation['direction'],
) =>
  expectations
    .filter(expectation => expectation.direction === direction && expectation.artifactName.trim())
    .map(expectation => ({
      artifactName: expectation.artifactName,
      direction: expectation.direction,
      requiredByDefault: expectation.requiredByDefault,
      description: expectation.description,
    }));

export const compileStepContext = ({
  capability,
  workItem,
  workflow,
  step,
  agent,
  handoffContext,
  resolvedWaitContext,
  artifacts = [],
}: CompileStepContextArgs): CompiledStepContext => {
  const compiledAt = new Date().toISOString();
  const executionBoundary = deriveExecutionBoundary(capability, step);
  const requiredInputs = dedupeById([
    ...buildDefaultRequiredInputs({ capability, workflow, step }),
    ...(step.requiredInputs || []),
  ]);
  const artifactEvidenceText = buildArtifactEvidenceText(artifacts, workItem.id);
  const compiledInputs = requiredInputs.map(field =>
    evaluateRequiredInput({
      field,
      capability,
      workItem,
      handoffContext,
      resolvedWaitContext,
      artifactEvidenceText,
    }),
  );
  const missingInputs = compiledInputs.filter(
    field => field.required && field.status === 'MISSING',
  );
  const expectedOutputsForChecklist = isBuildStep(step)
    ? (step.artifactContract?.expectedOutputs || []).some(
        label => label.trim() === BUILD_STEP_OUTPUT_LABEL,
      )
      ? step.artifactContract?.expectedOutputs || []
      : [
          ...(step.artifactContract?.expectedOutputs || []),
          BUILD_STEP_OUTPUT_LABEL,
        ]
    : step.artifactContract?.expectedOutputs || [];
  const completionChecklist = Array.from(
    new Set([
      ...(step.exitCriteria || []),
      ...(step.completionGates || []),
      ...expectedOutputsForChecklist.map(output => `Produce ${output}`),
    ]),
  );
  const memoryBoundary = Array.from(
    new Set([
      ...(step.artifactContract?.requiredInputs || []),
      ...(step.artifactContract?.expectedOutputs || []),
      ...(handoffContext ? ['Prior hand-off context'] : []),
      ...(resolvedWaitContext ? ['Resolved human input'] : []),
    ]),
  );
  const nextActions = missingInputs.length
    ? [
        'Collect the missing structured inputs before allowing the model to continue.',
        'Resume the same step after the missing inputs are resolved.',
      ]
    : [
        executionBoundary.allowedToolIds.length > 0
          ? 'Use only the allowed tools inside this step boundary.'
          : 'Reason within the current step and either complete or pause with a typed wait.',
        executionBoundary.requiresHumanApproval
          ? 'Pause for approval if the step or policy requires operator sign-off.'
          : 'Complete the step when the output and evidence checklist are satisfied.',
      ];
  const ownership = compileStepOwnership({ capability, step });

  return {
    compiledAt,
    stepId: step.id,
    stepName: step.name,
    phase: step.phase,
    stepType: step.stepType,
    objective: step.action,
    description: step.description,
    executionNotes: step.executionNotes,
    preferredWorkspacePath: step.preferredWorkspacePath || stepPreferredWorkspace(capability),
    executionBoundary,
    requiredInputs: compiledInputs,
    missingInputs,
    artifactChecklist: buildArtifactChecklist({ step, handoffContext }),
    agentSuggestedInputs: cloneAgentArtifactExpectations(
      agent?.contract?.suggestedInputArtifacts,
      'INPUT',
    ),
    agentExpectedOutputs: cloneAgentArtifactExpectations(
      agent?.contract?.expectedOutputArtifacts,
      'OUTPUT',
    ),
    completionChecklist,
    memoryBoundary,
    nextActions,
    ownership,
    handoffContext: hasText(handoffContext) ? handoffContext : undefined,
    resolvedWaitContext: hasText(resolvedWaitContext)
      ? resolvedWaitContext
      : undefined,
  };
};

export const normalizeCompiledStepContext = (
  value?:
    | (Omit<Partial<CompiledStepContext>, 'executionBoundary'> & {
        executionBoundary?: Partial<ExecutionBoundary> | null;
      })
    | null,
): CompiledStepContext | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  if (!value.stepId || !value.stepName || !value.phase || !value.stepType || !value.objective) {
    return undefined;
  }

  return {
    compiledAt:
      typeof value.compiledAt === 'string' && value.compiledAt.trim().length > 0
        ? value.compiledAt
        : new Date(0).toISOString(),
    stepId: value.stepId,
    stepName: value.stepName,
    phase: value.phase,
    stepType: value.stepType,
    objective: value.objective,
    description: value.description,
    executionNotes: value.executionNotes,
    preferredWorkspacePath: value.preferredWorkspacePath,
    executionBoundary: normalizeExecutionBoundary(value.executionBoundary),
    requiredInputs: Array.isArray(value.requiredInputs) ? value.requiredInputs : [],
    missingInputs: Array.isArray(value.missingInputs) ? value.missingInputs : [],
    artifactChecklist: Array.isArray(value.artifactChecklist) ? value.artifactChecklist : [],
    agentSuggestedInputs: Array.isArray(value.agentSuggestedInputs)
      ? value.agentSuggestedInputs
      : [],
    agentExpectedOutputs: Array.isArray(value.agentExpectedOutputs)
      ? value.agentExpectedOutputs
      : [],
    completionChecklist: Array.isArray(value.completionChecklist)
      ? value.completionChecklist.filter(item => typeof item === 'string')
      : [],
    memoryBoundary: Array.isArray(value.memoryBoundary)
      ? value.memoryBoundary.filter(item => typeof item === 'string')
      : [],
    nextActions: Array.isArray(value.nextActions)
      ? value.nextActions.filter(item => typeof item === 'string')
      : [],
    handoffContext: value.handoffContext,
    resolvedWaitContext: value.resolvedWaitContext,
  };
};

export const compileWorkItemPlan = ({
  capability,
  workItem,
  workflow,
  currentStep,
  currentStepContext,
}: {
  capability: Capability;
  workItem: WorkItem;
  workflow: Workflow;
  currentStep: WorkflowStep;
  currentStepContext: CompiledStepContext;
}): CompiledWorkItemPlan => ({
  compiledAt: currentStepContext.compiledAt,
  workItemId: workItem.id,
  workflowId: workflow.id,
  workflowName: workflow.name,
  currentPhase: currentStep.phase,
  currentStepId: currentStep.id,
  currentStepName: currentStep.name,
  lifecyclePhases: getCapabilityBoardPhaseIds(capability),
  planSummary: `Operate ${workflow.name} as an engine-managed delivery plan. Keep orchestration deterministic, keep waits typed, and keep step outputs inside durable artifacts.`,
  stepSequence: workflow.steps.map(step => ({
    stepId: step.id,
    name: step.name,
    phase: step.phase,
    stepType: step.stepType,
    agentId: step.agentId,
  })),
  currentStep: currentStepContext,
});
