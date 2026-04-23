import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { OrchestratorAttemptsPanel } from '../OrchestratorAttemptsPanel';
import type { CapabilityAgent, RunEvent, Workflow, WorkflowRun, WorkflowRunDetail } from '../../../types';

const workflow = {
  id: 'wf-1',
  capabilityId: 'cap-1',
  name: 'Implementation workflow',
  description: '',
  trigger: 'MANUAL',
  status: 'PUBLISHED',
  createdAt: '2026-04-19T10:00:00.000Z',
  updatedAt: '2026-04-19T10:00:00.000Z',
  steps: [
    {
      id: 'step-1',
      workflowId: 'wf-1',
      name: 'Build & Test',
      action: 'Implement and validate the parser rule',
      phase: 'DEVELOPMENT',
      stepType: 'BUILD',
      agentId: 'agent-1',
      orderIndex: 1,
      policyIds: [],
      approvalPolicyIds: [],
      config: {},
      createdAt: '2026-04-19T10:00:00.000Z',
      updatedAt: '2026-04-19T10:00:00.000Z',
    },
  ],
} as Workflow;

const currentRun = {
  id: 'run-1',
  workflowId: 'wf-1',
  attemptNumber: 2,
  status: 'RUNNING',
} as WorkflowRun;

const runDetail = {
  toolInvocations: [{ id: 'tool-1' }],
} as WorkflowRunDetail;

const runEvent = {
  id: 'event-1',
  message: 'Builder is applying the parser changes.',
  timestamp: '2026-04-19T10:20:00.000Z',
  level: 'INFO',
  details: { toolId: 'workspace_apply_patch' },
} as RunEvent;

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

describe('OrchestratorAttemptsPanel', () => {
  it('renders run comparison and step progress context', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
      <OrchestratorAttemptsPanel
        capabilityId="cap-1"
        currentRun={currentRun}
        selectedOpenWait={null}
        previousRunSummary="The previous attempt stopped before tests."
        attemptComparisonLines={['Status changed from waiting to running.']}
        selectedWorkflow={workflow}
        selectedRunSteps={
          [
            {
              workflowStepId: 'step-1',
              status: 'RUNNING',
              attemptCount: 2,
            },
          ] as WorkflowRunDetail['steps']
        }
        getPhaseMeta={() => ({ label: 'Development' })}
        selectedRunEvents={[runEvent]}
        selectedRunDetail={runDetail}
        selectedRunHistory={[currentRun]}
        recentRunActivity={[runEvent]}
        agentsById={agentsById}
        getRunEventTone={() => 'info'}
        getRunEventLabel={() => 'Info'}
        liveStreamingText=""
        recentlyChangedFiles={[]}
      />
      </MemoryRouter>,
    );

    expect(screen.getByText('Comparison ready')).toBeInTheDocument();
    expect(screen.getByText('Status changed from waiting to running.')).toBeInTheDocument();
    expect(screen.getByText('Build & Test')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /advanced execution details/i }));
    expect(screen.getByText('Builder is applying the parser changes.')).toBeInTheDocument();
  });
});
