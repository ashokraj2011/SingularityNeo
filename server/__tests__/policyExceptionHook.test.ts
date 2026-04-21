// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice 3 — policy hook test.
 *
 * Covers the exception-lookup branch in `evaluateToolPolicy` at
 * `server/policy.ts`:
 *
 *   - When the base decision is REQUIRE_APPROVAL and an active exception
 *     matches the (capabilityId, probe) tuple, the verdict flips to ALLOW
 *     and the returned PolicyDecision carries `exceptionId` +
 *     `exceptionExpiresAt`.
 *   - When `findActiveException` throws, the verdict stays REQUIRE_APPROVAL
 *     (fail-closed) and a warning is logged. Silent allow on lookup failure
 *     would let governed actions slip through.
 *   - When the base decision is already ALLOW (e.g. `run_build`) the hook
 *     is not consulted.
 *   - An approval-bypass ALLOW path does not stamp exceptionId either.
 */

// Capture the inserts that createPolicyDecision emits so we can assert the
// decision row picks up `exception_id` + `exception_expires_at`.
const dbQueryMock = vi.fn();

vi.mock('../db', () => ({
  query: (sql: string, params?: unknown[]) => dbQueryMock(sql, params),
}));

vi.mock('../incidents/repository', () => ({
  listIncidents: vi.fn().mockResolvedValue([]),
}));

vi.mock('../incidents/correlation', () => ({
  matchesPathGlob: vi.fn().mockReturnValue(false),
}));

vi.mock('../execution/runtimeClient', () => ({
  executionRuntimeRpc: vi.fn(),
  isRemoteExecutionClient: () => false,
}));

const findActiveExceptionMock = vi.fn();
vi.mock('../governance/exceptions', () => ({
  findActiveException: (args: unknown) => findActiveExceptionMock(args),
}));

// The service creates a row via `INSERT INTO capability_policy_decisions` and
// reads back the inserted row. Return whatever was inserted so the PolicyDecision
// shape stays coherent.
const makeInsertReturning = (): Record<string, unknown> => ({
  id: 'POLICY-XYZ',
  capability_id: 'CAP-1',
  trace_id: null,
  run_id: null,
  run_step_id: null,
  tool_invocation_id: null,
  action_type: 'workspace_write',
  target_id: null,
  decision: 'ALLOW',
  reason: '',
  requested_by_agent_id: null,
  created_at: new Date(),
  exception_id: null,
  exception_expires_at: null,
});

import { evaluateToolPolicy } from '../policy';

beforeEach(() => {
  dbQueryMock.mockReset();
  findActiveExceptionMock.mockReset();

  // Default: the INSERT echoes back the params we passed in so the returned
  // PolicyDecision faithfully reflects the hook's output.
  dbQueryMock.mockImplementation(async (_sql: string, params?: unknown[]) => {
    const list = params ?? [];
    const row = makeInsertReturning();
    if (list.length >= 14) {
      row.capability_id = list[0];
      row.id = list[1] ?? row.id;
      row.action_type = list[6];
      row.decision = list[8];
      row.reason = list[9];
      row.exception_id = list[12] ?? null;
      row.exception_expires_at = list[13] ?? null;
    }
    return { rows: [row], rowCount: 1 };
  });
});

describe('evaluateToolPolicy — governance exception hook', () => {
  it('flips REQUIRE_APPROVAL to ALLOW when a matching exception is active', async () => {
    const expiresAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    findActiveExceptionMock.mockResolvedValue({
      exceptionId: 'GOV-EXC-ABC',
      controlId: 'GOV-CTRL-0003',
      capabilityId: 'CAP-1',
      status: 'APPROVED',
      expiresAt,
    });

    const decision = await evaluateToolPolicy({
      capability: { id: 'CAP-1', name: 'Billing' } as any,
      toolId: 'run_deploy',
      hasApprovalBypass: false,
    });

    expect(findActiveExceptionMock).toHaveBeenCalledWith({
      capabilityId: 'CAP-1',
      probe: { actionType: 'run_deploy' },
    });
    expect(decision.decision).toBe('ALLOW');
    expect(decision.exceptionId).toBe('GOV-EXC-ABC');
    expect(decision.exceptionExpiresAt).toBe(expiresAt);
    expect(decision.reason).toMatch(/governance exception GOV-EXC-ABC/);
    expect(decision.reason).toMatch(/control GOV-CTRL-0003/);
  });

  it('preserves REQUIRE_APPROVAL when no matching exception is found', async () => {
    findActiveExceptionMock.mockResolvedValue(null);

    const decision = await evaluateToolPolicy({
      capability: { id: 'CAP-1', name: 'Billing' } as any,
      toolId: 'run_deploy',
    });

    expect(decision.decision).toBe('REQUIRE_APPROVAL');
    expect(decision.exceptionId).toBeUndefined();
    expect(decision.exceptionExpiresAt).toBeUndefined();
  });

  it('fails closed — a findActiveException throw preserves REQUIRE_APPROVAL', async () => {
    findActiveExceptionMock.mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const decision = await evaluateToolPolicy({
      capability: { id: 'CAP-1', name: 'Billing' } as any,
      toolId: 'run_deploy',
    });

    expect(decision.decision).toBe('REQUIRE_APPROVAL');
    expect(decision.exceptionId).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not consult the exception hook when the base verdict is ALLOW', async () => {
    const decision = await evaluateToolPolicy({
      capability: { id: 'CAP-1', name: 'Billing' } as any,
      toolId: 'run_build',
    });

    expect(decision.decision).toBe('ALLOW');
    expect(findActiveExceptionMock).not.toHaveBeenCalled();
  });

  it('does not stamp exceptionId when approval-bypass already allows run_deploy', async () => {
    const decision = await evaluateToolPolicy({
      capability: { id: 'CAP-1', name: 'Billing' } as any,
      toolId: 'run_deploy',
      hasApprovalBypass: true,
    });

    expect(decision.decision).toBe('ALLOW');
    expect(decision.exceptionId).toBeUndefined();
    expect(findActiveExceptionMock).not.toHaveBeenCalled();
  });
});
