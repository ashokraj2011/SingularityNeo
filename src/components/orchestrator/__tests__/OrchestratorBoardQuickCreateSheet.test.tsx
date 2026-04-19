import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorBoardQuickCreateSheet } from '../OrchestratorBoardQuickCreateSheet';
import type { WorkItemAttachmentUpload, WorkItemPhaseStakeholder } from '../../../types';

const attachment: WorkItemAttachmentUpload = {
  fileName: 'requirements.md',
  mimeType: 'text/markdown',
  sizeBytes: 1024,
  contentText: '# Requirements',
};

const phaseStakeholder: WorkItemPhaseStakeholder = {
  role: 'Reviewer',
  name: 'Asha',
  email: 'asha@example.com',
  teamName: 'Platform',
};

describe('OrchestratorBoardQuickCreateSheet', () => {
  it('renders the extracted board quick-create sheet and routes key interactions', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn(event => event.preventDefault());
    const onTitleChange = vi.fn();
    const onWorkflowChange = vi.fn();
    const onTaskTypeChange = vi.fn();
    const onPriorityChange = vi.fn();
    const onDescriptionChange = vi.fn();
    const onTagsChange = vi.fn();
    const onApplyCapabilityStakeholdersToPhase = vi.fn();
    const onAddDraftPhaseStakeholder = vi.fn();
    const onRemoveDraftPhaseStakeholder = vi.fn();
    const onRemoveAttachment = vi.fn();

    render(
      <OrchestratorBoardQuickCreateSheet
        isOpen
        workflows={[{ id: 'WF-1', name: 'Delivery Flow' }]}
        draftWorkItem={{
          title: 'Implement rule parser',
          workflowId: 'WF-1',
          taskType: 'GENERAL',
          priority: 'High',
          description: 'Add support for startsWith expressions.',
          attachments: [attachment],
          tags: 'parser, compiler',
        }}
        launchSummary={{
          workflowName: 'Delivery Flow',
          entryPointLabel: 'General Delivery',
          routedPhaseLabel: 'Elaboration',
          entryAgentLabel: 'Builder',
          stepsCount: 5,
          phaseSignoffLabel: '1 phases configured',
          inputFilesLabel: '1 attached',
          routingNote: 'Workflow default entry will be used.',
        }}
        visibleLifecyclePhases={[
          { id: 'ELABORATION', label: 'Elaboration', description: 'Shape the work.' },
        ]}
        capabilityStakeholdersCount={2}
        busyAction={null}
        canCreateWorkItems
        getDraftPhaseStakeholders={() => [phaseStakeholder]}
        onClose={onClose}
        onSubmit={onSubmit}
        onTitleChange={onTitleChange}
        onWorkflowChange={onWorkflowChange}
        onTaskTypeChange={onTaskTypeChange}
        onPriorityChange={onPriorityChange}
        onDescriptionChange={onDescriptionChange}
        onTagsChange={onTagsChange}
        onApplyCapabilityStakeholdersToPhase={onApplyCapabilityStakeholdersToPhase}
        onAddDraftPhaseStakeholder={onAddDraftPhaseStakeholder}
        onUpdateDraftPhaseStakeholderField={vi.fn()}
        onRemoveDraftPhaseStakeholder={onRemoveDraftPhaseStakeholder}
        onUploadAttachments={vi.fn()}
        onRemoveAttachment={onRemoveAttachment}
        renderAttachmentIcon={() => <span>icon</span>}
        formatAttachmentSizeLabel={() => '1 KB'}
      />,
    );

    expect(screen.getByText('Stage new work')).toBeInTheDocument();
    expect(screen.getByText('Workflow launch summary')).toBeInTheDocument();

    await user.type(screen.getByDisplayValue('Implement rule parser'), ' now');
    expect(onTitleChange).toHaveBeenCalled();

    await user.selectOptions(screen.getByRole('combobox', { name: /task type/i }), 'BUGFIX');
    expect(onTaskTypeChange).toHaveBeenCalledWith('BUGFIX');

    await user.selectOptions(screen.getByRole('combobox', { name: /priority/i }), 'Low');
    expect(onPriorityChange).toHaveBeenCalledWith('Low');

    await user.click(screen.getByRole('button', { name: /use capability stakeholders/i }));
    expect(onApplyCapabilityStakeholdersToPhase).toHaveBeenCalledWith('ELABORATION');

    await user.click(screen.getByRole('button', { name: /add stakeholder/i }));
    expect(onAddDraftPhaseStakeholder).toHaveBeenCalledWith('ELABORATION');

    await user.click(screen.getByRole('button', { name: /remove stakeholder elaboration 1/i }));
    expect(onRemoveDraftPhaseStakeholder).toHaveBeenCalledWith('ELABORATION', 0);

    await user.click(screen.getByRole('button', { name: /remove attachment requirements\.md/i }));
    expect(onRemoveAttachment).toHaveBeenCalledWith(0);

    await user.type(screen.getByDisplayValue('parser, compiler'), ' runtime');
    expect(onTagsChange).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Create work item' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /close board quick create sheet/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
