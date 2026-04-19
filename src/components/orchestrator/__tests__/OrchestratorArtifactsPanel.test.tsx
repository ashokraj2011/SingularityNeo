import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorArtifactsPanel } from '../OrchestratorArtifactsPanel';
import type { AgentTask, Artifact, ExecutionLog } from '../../../types';

const artifact = {
  id: 'artifact-1',
  capabilityId: 'cap-1',
  workItemId: 'WI-1',
  name: 'Implementation summary',
  type: 'REPORT',
  version: 1,
  status: 'READY',
  direction: 'OUTPUT',
  contentFormat: 'MARKDOWN',
  summary: 'Summarizes the implementation choices.',
  created: '2026-04-19T10:00:00.000Z',
  updated: '2026-04-19T10:00:00.000Z',
} as Artifact;

const task = {
  id: 'task-1',
  title: 'Build implementation',
  agent: 'Builder',
  status: 'IN_PROGRESS',
} as AgentTask;

const log = {
  id: 'log-1',
  message: 'Applied the parser changes.',
  timestamp: '2026-04-19T10:30:00.000Z',
} as ExecutionLog;

describe('OrchestratorArtifactsPanel', () => {
  it('routes artifact filters, selection, and drill-down actions', async () => {
    const user = userEvent.setup();
    const onArtifactFilterChange = vi.fn();
    const onSelectArtifact = vi.fn();
    const onOpenRunConsole = vi.fn();
    const onOpenLedger = vi.fn();
    const onOpenWorkflowDesigner = vi.fn();

    render(
      <OrchestratorArtifactsPanel
        filteredArtifacts={[artifact]}
        artifactFilter="ALL"
        onArtifactFilterChange={onArtifactFilterChange}
        selectedArtifact={artifact}
        latestArtifactDocument="# Summary\n\nArtifact body"
        onSelectArtifact={onSelectArtifact}
        selectedTasks={[task]}
        selectedLogs={[log]}
        onOpenRunConsole={onOpenRunConsole}
        onOpenLedger={onOpenLedger}
        onOpenWorkflowDesigner={onOpenWorkflowDesigner}
      />,
    );

    expect(screen.getAllByText('Implementation summary')).toHaveLength(2);
    expect(screen.getAllByText('Applied the parser changes.')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Diffs' }));
    expect(onArtifactFilterChange).toHaveBeenCalledWith('DIFFS');

    await user.click(screen.getAllByRole('button', { name: /implementation summary/i })[0]);
    expect(onSelectArtifact).toHaveBeenCalledWith('artifact-1');

    await user.click(screen.getByRole('button', { name: /run console telemetry/i }));
    expect(onOpenRunConsole).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /evidence ledger/i }));
    expect(onOpenLedger).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /workflow designer/i }));
    expect(onOpenWorkflowDesigner).toHaveBeenCalledTimes(1);
  });
});
