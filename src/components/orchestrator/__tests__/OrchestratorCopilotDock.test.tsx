import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileText } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorCopilotDock } from '../OrchestratorCopilotDock';

describe('OrchestratorCopilotDock', () => {
  it('renders the shell and routes clear/send actions', async () => {
    const user = userEvent.setup();
    const onClearChat = vi.fn();
    const onAskAgent = vi.fn();

    render(
      <OrchestratorCopilotDock
        selectedWorkItemPresent
        primaryCopilotAgentName="Architect"
        copilotRoutingLabel="Primary copilot active"
        dockMessagesCount={2}
        busyAction={null}
        onClearChat={onClearChat}
        statusContent={<div>status content</div>}
        threadContent={<div>thread content</div>}
        dockError=""
        onComposerDrop={vi.fn()}
        dockComposerLabel="Ask copilot"
        dockInput="What should we do next?"
        onDockInputChange={vi.fn()}
        dockComposerPlaceholder="Ask something"
        helperText={<div>helper text</div>}
        dockUploads={[]}
        renderUploadIcon={() => <FileText size={14} />}
        formatAttachmentSizeLabel={() => ''}
        onRemoveUpload={vi.fn()}
        onAddUploads={vi.fn()}
        selectedOpenWaitPresent={false}
        dockAllowsChatOnly={false}
        isDockSending={false}
        canWriteChat
        onAskAgent={onAskAgent}
        onResolveWait={vi.fn()}
        dockCanResolveWait={false}
        dockPrimaryActionLabel="Start and guide execution"
        selectedOpenWaitType={null}
        selectedCanGuideBlockedAgent={false}
        onGuideAndRestart={vi.fn()}
        canStartExecution={false}
        onStartExecution={vi.fn()}
        dockTextareaRef={{ current: null }}
      />,
    );

    expect(screen.getByText('Capability Copilot')).toBeInTheDocument();
    expect(screen.getByText('thread content')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear chat' }));
    expect(onClearChat).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAskAgent).toHaveBeenCalledTimes(1);
  });
});
