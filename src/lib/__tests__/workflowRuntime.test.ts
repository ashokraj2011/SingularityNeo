import { describe, expect, it } from 'vitest';
import { createDefaultCapabilityLifecycle } from '../capabilityLifecycle';
import { compileStepContext, compileWorkItemPlan } from '../workflowRuntime';
import type { Capability, Workflow, WorkflowStep, WorkItem } from '../../types';

const buildCapability = (
  overrides?: Partial<Capability>,
): Capability => ({
  id: 'CAP-RUNTIME',
  name: 'Runtime Capability',
  description: 'Deliver product changes through a governed workflow.',
  businessOutcome: 'Ship trustworthy changes with auditability.',
  successMetrics: ['Changes move through a bounded execution plan.'],
  definitionOfDone: 'Execution waits are structured and durable.',
  requiredEvidenceKinds: ['Execution plan', 'Approval record'],
  operatingPolicySummary: 'High-impact changes remain approval-gated.',
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  localDirectories: ['/workspace/app'],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    defaultWorkspacePath: '/workspace/app',
    allowedWorkspacePaths: ['/workspace/app'],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: [],
  ...overrides,
});

const buildWorkItem = (overrides?: Partial<WorkItem>): WorkItem => ({
  id: 'WI-RUNTIME',
  title: 'Implement structured input waits',
  description: 'Refactor the execution engine to compile a bounded step contract.',
  capabilityId: 'CAP-RUNTIME',
  workflowId: 'WF-RUNTIME',
  phase: 'ANALYSIS',
  assignedAgentId: 'AGENT-ANALYST',
  currentStepId: 'STEP-ANALYSIS',
  status: 'ACTIVE',
  priority: 'Med',
  tags: [],
  history: [],
  ...overrides,
});

const buildStep = (overrides?: Partial<WorkflowStep>): WorkflowStep => ({
  id: 'STEP-ANALYSIS',
  name: 'Analysis',
  phase: 'ANALYSIS',
  stepType: 'DELIVERY',
  agentId: 'AGENT-ANALYST',
  action: 'Clarify the work item and define the bounded execution contract.',
  description: 'Gather the business outcome and prepare the step-local contract.',
  allowedToolIds: ['workspace_read'],
  executionNotes: 'Stay within documentation and scoped context.',
  artifactContract: {
    requiredInputs: ['Capability charter', 'Work item request'],
    expectedOutputs: ['Requirements packet'],
  },
  exitCriteria: ['Requirements are clear'],
  ...overrides,
});

const buildWorkflow = (steps: WorkflowStep[]): Workflow => ({
  id: 'WF-RUNTIME',
  name: 'Runtime Workflow',
  capabilityId: 'CAP-RUNTIME',
  steps,
  status: 'STABLE',
});

describe('workflowRuntime', () => {
  it('marks missing workspace and handoff inputs before a model call', () => {
    const step = buildStep({
      id: 'STEP-DEV',
      name: 'Implementation',
      phase: 'DEVELOPMENT',
      allowedToolIds: ['workspace_write'],
    });
    const workflow = buildWorkflow([buildStep(), step]);
    const capability = buildCapability({
      localDirectories: [],
      executionConfig: {
        defaultWorkspacePath: '',
        allowedWorkspacePaths: [],
        commandTemplates: [],
        deploymentTargets: [],
      },
    });
    const workItem = buildWorkItem({
      phase: 'DEVELOPMENT',
      currentStepId: step.id,
      assignedAgentId: step.agentId,
    });

    const compiled = compileStepContext({
      capability,
      workItem,
      workflow,
      step,
    });

    expect(compiled.executionBoundary.workspaceMode).toBe('APPROVED_WRITE');
    expect(compiled.missingInputs.map(item => item.id)).toEqual(
      expect.arrayContaining(['approved-workspace', 'prior-step-handoff']),
    );
  });

  it('uses handoff and resolved input context to satisfy step requirements', () => {
    const step = buildStep({
      id: 'STEP-DEV',
      name: 'Implementation',
      phase: 'DEVELOPMENT',
      allowedToolIds: ['workspace_write', 'run_test'],
    });
    const workflow = buildWorkflow([buildStep(), step]);

    const compiled = compileStepContext({
      capability: buildCapability(),
      workItem: buildWorkItem({
        phase: 'DEVELOPMENT',
        currentStepId: step.id,
        assignedAgentId: step.agentId,
      }),
      workflow,
      step,
      handoffContext: 'Business Analysis completed with acceptance criteria and design notes.',
      resolvedWaitContext: 'Owner confirmed the Python workspace should remain read-only.',
    });

    expect(compiled.missingInputs).toHaveLength(0);
    expect(compiled.requiredInputs.find(item => item.id === 'prior-step-handoff')?.status).toBe(
      'READY',
    );
    expect(compiled.artifactChecklist[0]?.status).toBe('READY');
  });

  it('builds a durable compiled work item plan around the current step', () => {
    const firstStep = buildStep();
    const secondStep = buildStep({
      id: 'STEP-DESIGN',
      name: 'Design',
      phase: 'DESIGN',
      agentId: 'AGENT-ARCH',
    });
    const workflow = buildWorkflow([firstStep, secondStep]);
    const workItem = buildWorkItem();
    const currentStepContext = compileStepContext({
      capability: buildCapability(),
      workItem,
      workflow,
      step: firstStep,
    });

    const plan = compileWorkItemPlan({
      capability: buildCapability(),
      workItem,
      workflow,
      currentStep: firstStep,
      currentStepContext,
    });

    expect(plan.workflowName).toBe('Runtime Workflow');
    expect(plan.currentStep.stepId).toBe(firstStep.id);
    expect(plan.stepSequence).toHaveLength(2);
    expect(plan.planSummary).toContain('engine-managed delivery plan');
  });
});
