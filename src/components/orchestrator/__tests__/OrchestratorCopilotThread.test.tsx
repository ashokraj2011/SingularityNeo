import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorCopilotThread } from '../OrchestratorCopilotThread';
import type { CapabilityChatMessage } from '../../../types';

const buildMessage = (overrides: Partial<CapabilityChatMessage> = {}): CapabilityChatMessage => ({
  id: 'MSG-1',
  capabilityId: 'CAP-1',
  role: 'agent',
  content: 'Review the generated plan.',
  timestamp: '2026-04-19T10:00:00.000Z',
  agentId: 'AGENT-1',
  agentName: 'Architect',
  ...overrides,
});

describe('OrchestratorCopilotThread', () => {
  it('renders messages, streaming draft content, and reports scroll events', () => {
    const onScroll = vi.fn();

    render(
      <OrchestratorCopilotThread
        messages={[
          buildMessage(),
          buildMessage({
            id: 'MSG-2',
            role: 'user',
            content: 'Please include rollback steps.',
          }),
        ]}
        currentActorDisplayName="Workspace Operator"
        selectedAgentName="Architect"
        dockDraft="Working through the impact now."
        isDockSending={false}
        threadRef={createRef<HTMLDivElement>()}
        onScroll={onScroll}
      />,
    );

    expect(screen.getByText('Review the generated plan.')).toBeInTheDocument();
    expect(screen.getByText('Please include rollback steps.')).toBeInTheDocument();
    expect(screen.getByText('Working through the impact now.')).toBeInTheDocument();
    expect(screen.getByText('Streaming')).toBeInTheDocument();

    fireEvent.scroll(screen.getByText('Review the generated plan.').closest('div.orchestrator-stage-chat-thread')!);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when there is no thread yet', () => {
    render(
      <OrchestratorCopilotThread
        messages={[]}
        currentActorDisplayName="Workspace Operator"
        selectedAgentName="Architect"
        dockDraft=""
        isDockSending={false}
        threadRef={createRef<HTMLDivElement>()}
        onScroll={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/This work item does not have a copilot thread yet/i),
    ).toBeInTheDocument();
  });
});
