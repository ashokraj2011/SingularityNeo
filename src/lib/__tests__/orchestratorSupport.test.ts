import { describe, expect, it } from 'vitest';
import {
  getCurrentWorkflowStep,
  getSelectedRunWait,
  normalizeMarkdownishText,
} from '../orchestrator/support';
import type { Workflow, WorkflowRunDetail } from '../../types';

describe('orchestrator support helpers', () => {
  it('normalizes markdownish bullets and numbered lists', () => {
    expect(
      normalizeMarkdownishText(['  • first', '2) second', '', 'plain'].join('\n')),
    ).toBe(['- first', '2. second', '', 'plain'].join('\n'));
  });

  it('returns the most recent open run wait', () => {
    const detail = {
      waits: [
        { id: 'WAIT-1', status: 'OPEN' },
        { id: 'WAIT-2', status: 'RESOLVED' },
        { id: 'WAIT-3', status: 'OPEN' },
      ],
    } as WorkflowRunDetail;

    expect(getSelectedRunWait(detail)?.id).toBe('WAIT-3');
  });

  it('prefers the explicit current step before falling back to phase completion', () => {
    const workflow = {
      steps: [
        { id: 'STEP-1', title: 'Analyze' },
        { id: 'STEP-2', title: 'Build' },
      ],
    } as unknown as Workflow;

    expect(
      getCurrentWorkflowStep(
        workflow,
        {
          run: { currentStepId: 'STEP-2' },
          steps: [],
        } as WorkflowRunDetail,
        null,
      )?.id,
    ).toBe('STEP-2');

    expect(
      getCurrentWorkflowStep(
        workflow,
        {
          run: null,
          steps: [{ workflowStepId: 'STEP-1', status: 'COMPLETED' }],
        } as WorkflowRunDetail,
        null,
      )?.id,
    ).toBe('STEP-1');
  });
});
