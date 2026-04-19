import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorDetailRail } from '../OrchestratorDetailRail';
import type { WorkNavigatorSection } from '../../../lib/orchestrator/support';

const navigatorSections: WorkNavigatorSection[] = [
  {
    id: 'urgent',
    title: 'Urgent',
    helper: 'Needs action soon',
    items: [
      {
        item: {
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
        },
        attentionLabel: 'Waiting for approval',
        currentStepName: 'Build',
        agentName: 'Builder',
        ageLabel: '1m ago',
      },
    ],
  },
];

describe('OrchestratorDetailRail', () => {
  it('renders navigator sections and routes selection', async () => {
    const user = userEvent.setup();
    const onSelectWorkItem = vi.fn();

    render(
      <OrchestratorDetailRail
        filteredWorkItemsCount={1}
        navigatorSections={navigatorSections}
        selectedWorkItemId={null}
        getPhaseMeta={phase => ({ label: phase })}
        getStatusLabel={status => status}
        onSelectWorkItem={onSelectWorkItem}
        workbenchCanvas={<div>workbench canvas</div>}
      />,
    );

    expect(screen.getByText('Work navigator')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByText('workbench canvas')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /implement parser/i }));
    expect(onSelectWorkItem).toHaveBeenCalledWith('WI-1');
  });
});
