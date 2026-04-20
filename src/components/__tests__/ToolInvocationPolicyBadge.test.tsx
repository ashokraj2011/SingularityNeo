import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ToolInvocationPolicyBadge,
  type ToolInvocationPolicyDecision,
} from '../ToolInvocationPolicyBadge';

const baseDecision: ToolInvocationPolicyDecision = {
  id: 'pd-1',
  toolInvocationId: 'tool-allow',
  actionType: 'run_build',
  decision: 'ALLOW',
  reason: 'matches workspace policy',
  createdAt: '2026-04-01T10:00:00.000Z',
};

const denyDecision: ToolInvocationPolicyDecision = {
  id: 'pd-2',
  toolInvocationId: 'tool-deny',
  actionType: 'run_deploy',
  decision: 'DENY',
  reason: 'production deploys are gated',
  createdAt: '2026-04-02T10:00:00.000Z',
  exceptionId: 'exc-42',
  exceptionExpiresAt: '2026-05-02T10:00:00.000Z',
};

describe('ToolInvocationPolicyBadge', () => {
  it('renders the matching decision badge with the correct tone', () => {
    render(
      <ToolInvocationPolicyBadge
        toolInvocationId="tool-allow"
        policyDecisions={[baseDecision, denyDecision]}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: /Policy: allowed — reason: matches workspace policy/i,
    });
    expect(trigger).toBeInTheDocument();
    // The StatusBadge renders the decision text inside the trigger.
    expect(trigger).toHaveTextContent('ALLOW');
  });

  it('renders nothing when no decision matches the tool invocation id', () => {
    const { container } = render(
      <ToolInvocationPolicyBadge
        toolInvocationId="tool-without-decision"
        policyDecisions={[baseDecision]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no toolInvocationId is provided', () => {
    const { container } = render(
      <ToolInvocationPolicyBadge
        toolInvocationId={undefined}
        policyDecisions={[baseDecision]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes the reason and exception id via the tooltip and popover', async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocationPolicyBadge
        toolInvocationId="tool-deny"
        policyDecisions={[denyDecision]}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: /Policy: denied — reason: production deploys are gated/i,
    });
    const tooltip = trigger.getAttribute('title') ?? '';
    expect(tooltip).toContain('production deploys are gated');
    expect(tooltip).toContain('run_deploy');
    expect(tooltip).toContain('exc-42');

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', {
      name: /Policy decision for run_deploy/i,
    });
    expect(dialog).toHaveTextContent('production deploys are gated');
    expect(dialog).toHaveTextContent('exc-42');
  });
});
