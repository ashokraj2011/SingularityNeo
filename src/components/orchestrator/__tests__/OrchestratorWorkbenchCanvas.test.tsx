import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OrchestratorWorkbenchCanvas } from '../OrchestratorWorkbenchCanvas';
import type { WorkItem } from '../../../types';

const workItem = {
  id: 'WI-1',
  capabilityId: 'cap-1',
  workflowId: 'wf-1',
  title: 'Implement parser',
  description: '',
  phase: 'DEVELOPMENT',
  status: 'ACTIVE',
  priority: 'High',
  tags: [],
  artifactIds: [],
  history: [],
  createdAt: '2026-04-19T00:00:00.000Z',
  updatedAt: '2026-04-19T00:00:00.000Z',
  taskType: 'FEATURE',
} as WorkItem;

describe('OrchestratorWorkbenchCanvas', () => {
  it('shows the empty selection state when no work item is selected', () => {
    render(
      <OrchestratorWorkbenchCanvas selectedWorkItem={null}>
        <div>selected content</div>
      </OrchestratorWorkbenchCanvas>,
    );

    expect(screen.getByText('Select a work item')).toBeInTheDocument();
    expect(screen.queryByText('selected content')).not.toBeInTheDocument();
  });

  it('renders the selected content when a work item is present', () => {
    render(
      <OrchestratorWorkbenchCanvas selectedWorkItem={workItem}>
        <div>selected content</div>
      </OrchestratorWorkbenchCanvas>,
    );

    expect(screen.getByText('selected content')).toBeInTheDocument();
  });
});
