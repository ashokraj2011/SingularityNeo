// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getPolicyActionTypeForToolId, matchesPolicySelector } from '../policy';

describe('policy selector normalization', () => {
  it('maps legacy tool ids to normalized action types', () => {
    expect(getPolicyActionTypeForToolId('workspace_apply_patch')).toBe('workspace_write');
    expect(getPolicyActionTypeForToolId('run_deploy')).toBe('run_deploy');
    expect(getPolicyActionTypeForToolId('some_unknown_tool')).toBe('custom');
  });

  it('matches selectors across actionType and legacy toolId shapes', () => {
    expect(
      matchesPolicySelector({
        selector: { actionType: 'workspace_write' },
        toolId: 'workspace_apply_patch',
      }),
    ).toBe(true);

    expect(
      matchesPolicySelector({
        selector: { toolId: 'workspace_apply_patch' },
        actionType: 'workspace_write',
      }),
    ).toBe(true);

    expect(
      matchesPolicySelector({
        selector: { actionType: 'run_deploy', toolId: 'run_deploy' },
        actionType: 'run_deploy',
      }),
    ).toBe(true);

    expect(
      matchesPolicySelector({
        selector: { actionType: 'run_test' },
        toolId: 'run_deploy',
      }),
    ).toBe(false);
  });
});
