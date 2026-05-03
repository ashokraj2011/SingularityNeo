import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorBoardSurface } from '../OrchestratorBoardSurface';
import type { CapabilityAgent, WorkItem, Workflow } from '../../../types';

const workflow: Workflow = {
  id: 'wf-1',
  capabilityId: 'cap-1',
  name: 'Build Workflow',
  description: '',
  trigger: 'MANUAL',
  steps: [],
  status: 'PUBLISHED',
  createdAt: '2026-04-19T00:00:00.000Z',
  updatedAt: '2026-04-19T00:00:00.000Z',
};

const activeItem: WorkItem = {
  id: 'WI-1',
  capabilityId: 'cap-1',
  workflowId: 'wf-1',
  title: 'Implement parser',
  description: 'Build the parser changes',
  phase: 'DEVELOPMENT',
  status: 'ACTIVE',
  priority: 'High',
  tags: [],
  artifactIds: [],
  history: [],
  createdAt: '2026-04-19T00:00:00.000Z',
  updatedAt: '2026-04-19T00:00:00.000Z',
  taskType: 'FEATURE',
};

const completedItem: WorkItem = {
  ...activeItem,
  id: 'WI-2',
  title: 'Ship parser',
  phase: 'DONE',
  status: 'COMPLETED',
  priority: 'Med',
  history: [{ id: 'hist-1', timestamp: '2026-04-19T03:00:00.000Z', actor: 'system', action: 'COMPLETED' }],
};

const agentsById = new Map<string, CapabilityAgent>([
  [
    'agent-1',
    {
      id: 'agent-1',
      capabilityId: 'cap-1',
      name: 'Builder',
      role: 'BUILDER',
      description: '',
      systemPrompt: '',
      model: 'test-model',
      color: '#000000',
      position: { x: 0, y: 0 },
      capabilities: [],
      policyIds: [],
      approvalPolicyIds: [],
      skills: [],
      learningProfile: { status: 'NOT_STARTED', summary: '', highlights: [], contextBlock: '', sourceDocumentIds: [], sourceArtifactIds: [], sourceCount: 0 },
      memoryScope: { summary: '', scopeLabels: [] },
      rolePolicy: { summary: '', allowedToolIds: [] },
      qualityBar: { label: '', summary: '' },
      evalProfile: { summary: '' },
      preferredToolIds: [],
    } as CapabilityAgent,
  ],
]);

describe('OrchestratorBoardSurface', () => {
  it('renders board lanes and routes selection', async () => {
    const user = userEvent.setup();
    const onSelectWorkItem = vi.fn();

    render(
      <OrchestratorBoardSurface
        workflows={[workflow]}
        groupedItems={[{ phase: 'DEVELOPMENT', items: [activeItem] }]}
        completedItems={[completedItem]}
        selectedWorkItemId={null}
        dragOverPhase={null}
        draggedWorkItemId={null}
        workflowsById={new Map([[workflow.id, workflow]])}
        agentsById={agentsById}
        getPhaseMeta={phase => ({ label: phase })}
        getStatusLabel={workItem => workItem.status}
        getAttentionLabel={() => 'Attention'}
        getAttentionReason={() => 'Needs help'}
        isConflictAttention={() => false}
        onSelectWorkItem={onSelectWorkItem}
        onDragOverPhase={vi.fn()}
        onDragLeavePhase={vi.fn()}
        onDropOnPhase={vi.fn()}
        onDragStartWorkItem={vi.fn()}
        onDragEndWorkItem={vi.fn()}
      />,
    );

    expect(screen.getByText('Execution lanes')).toBeInTheDocument();
    expect(screen.getByText('Implement parser')).toBeInTheDocument();
    expect(screen.getByText('Completed work')).toBeInTheDocument();
    expect(screen.getByText('Ship parser')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /implement parser/i }));
    expect(onSelectWorkItem).toHaveBeenCalledWith('WI-1');

    await user.click(screen.getByRole('button', { name: /ship parser/i }));
    expect(onSelectWorkItem).toHaveBeenCalledWith('WI-2');
  });
});
