import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TOOL_ADAPTER_IDS } from '../../lib/toolCatalog';
import ToolsLibrary from '../ToolsLibrary';

const fetchCapabilityFlightRecorderMock = vi.fn();

vi.mock('../../context/CapabilityContext', () => ({
  useCapability: () => ({
    activeCapability: {
      id: 'CAP-RULES',
      name: 'Rule Engine',
    },
    getCapabilityWorkspace: () => ({
      workflows: [
        {
          id: 'WF-1',
          name: 'Runtime Workflow',
          archivedAt: null,
          steps: [
            {
              id: 'STEP-1',
              name: 'Inspect tools',
              allowedToolIds: [...TOOL_ADAPTER_IDS],
            },
          ],
        },
      ],
      agents: [
        {
          id: 'AGENT-1',
          name: 'Execution Agent',
          preferredToolIds: [...TOOL_ADAPTER_IDS],
        },
      ],
    }),
  }),
}));

vi.mock('../../lib/api', () => ({
  fetchCapabilityFlightRecorder: (...args: unknown[]) =>
    fetchCapabilityFlightRecorderMock(...args),
}));

describe('ToolsLibrary', () => {
  it('renders the full catalog inventory, including experimental tools', async () => {
    fetchCapabilityFlightRecorderMock.mockResolvedValue({
      capabilityId: 'CAP-RULES',
      generatedAt: '2026-04-30T00:00:00.000Z',
      workItems: [],
    });

    render(
      <MemoryRouter>
        <ToolsLibrary />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(fetchCapabilityFlightRecorderMock).toHaveBeenCalledWith('CAP-RULES');
    });

    expect(screen.getByText('Browse code AST')).toBeInTheDocument();
    expect(screen.getByText('Publish bounty')).toBeInTheDocument();
    expect(screen.getByText('Wait for signal')).toBeInTheDocument();
    expect(screen.getAllByText('Experimental').length).toBeGreaterThanOrEqual(3);
  });
});
