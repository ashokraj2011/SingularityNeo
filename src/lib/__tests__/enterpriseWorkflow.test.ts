import { describe, expect, it } from 'vitest';
import {
  createBrokerageCapabilityLifecycle,
  getCapabilityBoardPhaseIds,
} from '../capabilityLifecycle';
import {
  BROKERAGE_WORKFLOW_TEMPLATE_ID,
  createBrokerageCapabilityWorkflow,
} from '../standardWorkflow';
import {
  getWorkItemTaskTypeEntryPhase,
  resolveWorkItemEntryStep,
} from '../workItemTaskTypes';
import { createWorkspaceWorkflowTemplates } from '../workspaceFoundations';

const brokerageCapability = {
  id: 'CAP-BROKERAGE',
  name: 'Brokerage Platform',
  specialAgentId: 'AGENT-BROKERAGE-OWNER',
  lifecycle: createBrokerageCapabilityLifecycle(),
};

describe('brokerage workflow template', () => {
  it('creates Brokerage lanes with backlog and done around the custom phases', () => {
    expect(getCapabilityBoardPhaseIds(brokerageCapability.lifecycle)).toEqual([
      'BACKLOG',
      'INCEPTION',
      'ELABORATION',
      'CONSTRUCTION',
      'DELIVERY',
      'DONE',
    ]);
  });

  it('builds a Brokerage SDLC workflow using the custom lifecycle phases', () => {
    const workflow = createBrokerageCapabilityWorkflow(brokerageCapability);

    expect(workflow.templateId).toBe(BROKERAGE_WORKFLOW_TEMPLATE_ID);
    expect(workflow.name).toBe('Brokerage SDLC Flow');
    expect(workflow.steps.map(step => step.phase)).toEqual([
      'INCEPTION',
      'ELABORATION',
      'CONSTRUCTION',
      'CONSTRUCTION',
      'DELIVERY',
      'DELIVERY',
    ]);
    expect(workflow.steps[0]?.name).toBe('Intent & Scope Definition');
    expect(workflow.steps[0]?.allowedToolIds).toEqual([]);
  });

  it('routes task types to the expected Brokerage entry phases', () => {
    const workflow = createBrokerageCapabilityWorkflow(brokerageCapability);

    expect(getWorkItemTaskTypeEntryPhase('STRATEGIC_INITIATIVE')).toBe('INCEPTION');
    expect(getWorkItemTaskTypeEntryPhase('FEATURE_ENHANCEMENT')).toBe('ELABORATION');
    expect(getWorkItemTaskTypeEntryPhase('BUGFIX')).toBe('CONSTRUCTION');
    expect(getWorkItemTaskTypeEntryPhase('REHYDRATION')).toBe('DELIVERY');

    expect(
      resolveWorkItemEntryStep(
        workflow,
        'FEATURE_ENHANCEMENT',
        brokerageCapability.lifecycle,
      )?.name,
    ).toBe('Solution Shaping & Architecture');
    expect(
      resolveWorkItemEntryStep(workflow, 'BUGFIX', brokerageCapability.lifecycle)?.name,
    ).toBe('Build & Test');
    expect(
      resolveWorkItemEntryStep(
        workflow,
        'REHYDRATION',
        brokerageCapability.lifecycle,
      )?.name,
    ).toBe('Delivery Authorization');
  });

  it('exposes Brokerage as a shared workflow template', () => {
    const templates = createWorkspaceWorkflowTemplates();
    expect(
      templates.some(template => template.templateId === BROKERAGE_WORKFLOW_TEMPLATE_ID),
    ).toBe(true);
  });
});
