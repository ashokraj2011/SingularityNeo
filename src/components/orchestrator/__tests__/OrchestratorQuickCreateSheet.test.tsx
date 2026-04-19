import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorQuickCreateSheet } from '../OrchestratorQuickCreateSheet';
import type { WorkItemAttachmentUpload } from '../../../types';

const attachment: WorkItemAttachmentUpload = {
  fileName: 'requirements.md',
  mimeType: 'text/markdown',
  sizeBytes: 1024,
  contentText: '# Requirements',
};

describe('OrchestratorQuickCreateSheet', () => {
  it('renders the list quick-create sheet and routes form interactions', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn(event => event.preventDefault());
    const onTitleChange = vi.fn();
    const onWorkflowChange = vi.fn();
    const onDescriptionChange = vi.fn();
    const onClearAttachments = vi.fn();
    const onRemoveAttachment = vi.fn();

    render(
      <OrchestratorQuickCreateSheet
        isOpen
        workflows={[{ id: 'WF-1', name: 'Delivery Flow' }]}
        draftWorkItem={{
          title: 'Implement rule parser',
          description: 'Parse startsWith expressions',
          workflowId: 'WF-1',
          attachments: [attachment],
        }}
        busyAction={null}
        canCreateWorkItems
        formatAttachmentSizeLabel={() => '1 KB'}
        onClose={onClose}
        onSubmit={onSubmit}
        onTitleChange={onTitleChange}
        onWorkflowChange={onWorkflowChange}
        onDescriptionChange={onDescriptionChange}
        onUploadAttachments={vi.fn()}
        onClearAttachments={onClearAttachments}
        onRemoveAttachment={onRemoveAttachment}
      />,
    );

    expect(screen.getByText('Stage new work')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Implement rule parser')).toBeInTheDocument();

    await user.type(screen.getByDisplayValue('Implement rule parser'), ' now');
    expect(onTitleChange).toHaveBeenCalled();

    await user.selectOptions(screen.getByDisplayValue('Delivery Flow'), 'WF-1');
    expect(onWorkflowChange).toHaveBeenCalledWith('WF-1');

    await user.type(screen.getByDisplayValue('Parse startsWith expressions'), ' safely');
    expect(onDescriptionChange).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClearAttachments).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Remove attachment requirements.md' }));
    expect(onRemoveAttachment).toHaveBeenCalledWith(0);

    await user.click(screen.getByRole('button', { name: 'Create work item' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close quick create sheet' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the no-workflow empty state', () => {
    render(
      <OrchestratorQuickCreateSheet
        isOpen
        workflows={[]}
        draftWorkItem={{
          title: '',
          description: '',
          workflowId: '',
          attachments: [],
        }}
        busyAction={null}
        canCreateWorkItems={false}
        formatAttachmentSizeLabel={() => ''}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onTitleChange={vi.fn()}
        onWorkflowChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onUploadAttachments={vi.fn()}
        onClearAttachments={vi.fn()}
        onRemoveAttachment={vi.fn()}
      />,
    );

    expect(screen.getByText('No workflow is available')).toBeInTheDocument();
  });
});
