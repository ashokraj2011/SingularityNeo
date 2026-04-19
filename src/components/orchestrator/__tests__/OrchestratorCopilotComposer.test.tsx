import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorCopilotComposer } from '../OrchestratorCopilotComposer';

const buildBaseProps = () => ({
  onComposerDrop: vi.fn(),
  dockComposerLabel: 'Guide blocked execution',
  dockInput: 'Restart with the exact acceptance rules.',
  onDockInputChange: vi.fn(),
  dockComposerPlaceholder: 'Explain what should happen next',
  helperText: <div>helper text</div>,
  dockUploads: [],
  formatAttachmentSizeLabel: () => '',
  onRemoveUpload: vi.fn(),
  onAddUploads: vi.fn(),
  selectedOpenWaitPresent: false,
  dockAllowsChatOnly: false,
  isDockSending: false,
  canWriteChat: true,
  onAskAgent: vi.fn(),
  onResolveWait: vi.fn(),
  dockCanResolveWait: false,
  dockPrimaryActionLabel: 'Restart development',
  selectedOpenWaitType: null as const,
  selectedCanGuideBlockedAgent: false,
  onGuideAndRestart: vi.fn(),
  canStartExecution: false,
  onStartExecution: vi.fn(),
  busyAction: null,
  dockTextareaRef: createRef<HTMLTextAreaElement>(),
});

describe('OrchestratorCopilotComposer', () => {
  it('routes the default send path through ask-agent', async () => {
    const user = userEvent.setup();
    const props = buildBaseProps();

    render(<OrchestratorCopilotComposer {...props} />);

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(props.onAskAgent).toHaveBeenCalledTimes(1);
  });

  it('routes wait-resolution actions and keeps the ask-agent side action', async () => {
    const user = userEvent.setup();
    const props = {
      ...buildBaseProps(),
      selectedOpenWaitPresent: true,
      dockAllowsChatOnly: true,
      dockCanResolveWait: true,
      dockPrimaryActionLabel: 'Approve and continue',
      selectedOpenWaitType: 'APPROVAL' as const,
    };

    render(<OrchestratorCopilotComposer {...props} />);

    await user.click(screen.getByRole('button', { name: 'Ask agent' }));
    expect(props.onAskAgent).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Approve and continue' }));
    expect(props.onResolveWait).toHaveBeenCalledTimes(1);
  });

  it('routes restart and start actions through their dedicated callbacks', async () => {
    const user = userEvent.setup();
    const guideProps = {
      ...buildBaseProps(),
      selectedCanGuideBlockedAgent: true,
    };

    const { rerender } = render(<OrchestratorCopilotComposer {...guideProps} />);

    await user.click(screen.getByRole('button', { name: 'Restart development' }));
    expect(guideProps.onGuideAndRestart).toHaveBeenCalledTimes(1);

    const startProps = {
      ...buildBaseProps(),
      canStartExecution: true,
      dockPrimaryActionLabel: 'Start and guide execution',
    };

    rerender(<OrchestratorCopilotComposer {...startProps} />);

    await user.click(screen.getByRole('button', { name: 'Ask copilot' }));
    expect(startProps.onAskAgent).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Start and guide execution' }));
    expect(startProps.onStartExecution).toHaveBeenCalledTimes(1);
  });
});
