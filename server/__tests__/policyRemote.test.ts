// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  query: vi.fn(),
}));

vi.mock('../incidents/repository', () => ({
  listIncidents: vi.fn(),
}));

vi.mock('../incidents/correlation', () => ({
  matchesPathGlob: vi.fn(),
}));

vi.mock('../execution/runtimeClient', () => ({
  executionRuntimeRpc: vi.fn(),
  isRemoteExecutionClient: () => true,
}));

import { executionRuntimeRpc } from '../execution/runtimeClient';
import { evaluateToolPolicy } from '../policy';

const executionRuntimeRpcMock = vi.mocked(executionRuntimeRpc);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('evaluateToolPolicy remote execution', () => {
  it('passes an explicit capability scope to the desktop runtime RPC', async () => {
    executionRuntimeRpcMock.mockResolvedValue({
      id: 'POLICY-1',
      capabilityId: 'CAP-1',
      actionType: 'workspace_write',
      decision: 'ALLOW',
      reason: 'allowed',
      createdAt: '2026-04-18T00:00:00.000Z',
    } as any);

    await evaluateToolPolicy({
      capability: {
        id: 'CAP-1',
        name: 'Rule engine',
      } as any,
      toolId: 'workspace_read',
      traceId: 'TRACE-1',
      targetId: 'src/rules/PrefixRule.java',
    });

    expect(executionRuntimeRpcMock).toHaveBeenCalledWith(
      'evaluateToolPolicy',
      expect.objectContaining({
        capabilityId: 'CAP-1',
        capability: expect.objectContaining({
          id: 'CAP-1',
        }),
        toolId: 'workspace_read',
      }),
    );
  });
});
