import type { WorkflowStep } from '../types';

const getStepSemanticText = (step: WorkflowStep) =>
  `${step.name} ${step.action} ${step.description || ''}`.toLowerCase();

export const isTestingWorkflowStep = (step: WorkflowStep) =>
  step.allowedToolIds?.includes('run_test') ||
  /test|qa|quality|regression|verification/.test(getStepSemanticText(step));

export const isImplementationWorkflowStep = (step: WorkflowStep) =>
  step.allowedToolIds?.includes('workspace_write') ||
  step.allowedToolIds?.includes('run_build') ||
  /implement|implementation|development|build|code|coding|fix/.test(
    getStepSemanticText(step),
  );

export const isReleaseWorkflowStep = (step: WorkflowStep) =>
  step.allowedToolIds?.includes('run_deploy') ||
  /\brelease\b|\bdeploy\b|\bdeployment\b/.test(getStepSemanticText(step));
