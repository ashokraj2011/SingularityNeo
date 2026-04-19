// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice 3 — Governance exceptions service tests.
 *
 * Covers server/governance/exceptions.ts:
 *   1. requestException() validates inputs, rejects retired/unknown
 *      controls, rejects null or past `expiresAt`, and writes a REQUESTED
 *      event atomically.
 *   2. decideException() guards double-decide, rejects an expiresAt that
 *      extends past the requested window, and emits a GOVERNANCE_EXCEPTION
 *      learning-update row on APPROVED (best-effort).
 *   3. revokeException() guards non-APPROVED transitions and writes a
 *      REVOKED event.
 *   4. findActiveException() honors JSONB @> containment, prefers the
 *      soonest-expiring match, returns null when the feature flag is off,
 *      and ignores expired rows.
 *   5. expireDueExceptions() flips APPROVED → EXPIRED and writes an
 *      EXPIRED event per row, and returns the expired count.
 *
 * The pg layer + the agent-learning repository are replaced with a
 * Map-backed in-memory simulator so the tests run offline. The simulator
 * pattern-matches on SQL fragments (comment drift is harmless) and keeps
 * the same row shape the service expects.
 */

type ExceptionRow = {
  exception_id: string;
  capability_id: string;
  control_id: string;
  requested_by: string;
  requested_at: Date;
  reason: string;
  scope_selector: Record<string, unknown>;
  status: string;
  decided_by: string | null;
  decided_at: Date | null;
  decision_comment: string | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  created_at: Date;
  updated_at: Date;
};

type EventRow = {
  event_id: string;
  exception_id: string;
  event_type: string;
  actor_user_id: string | null;
  details: Record<string, unknown>;
  at: Date;
};

type ControlRow = { control_id: string; status: string };

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };

const exceptions = new Map<string, ExceptionRow>();
const events: EventRow[] = [];
const controlsTable = new Map<string, ControlRow>();

const learningUpdates: Array<{
  capabilityId: string;
  agentId: string;
  insight: string;
  triggerType: string;
}> = [];
let learningUpdateShouldThrow = false;

// Monotonic clock so tightly-sequenced events don't collide on the same
// millisecond and trigger event_id tie-breaking in `listEventsForException`.
let clockCursor = Date.now();
const nextMonotonicDate = (): Date => {
  clockCursor += 1;
  return new Date(clockCursor);
};

const resetStore = () => {
  exceptions.clear();
  events.length = 0;
  controlsTable.clear();
  learningUpdates.length = 0;
  learningUpdateShouldThrow = false;
  clockCursor = Date.now();
};

const parseJsonbParam = (raw: unknown): Record<string, unknown> => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
};

const containsSelector = (
  stored: Record<string, unknown>,
  probe: Record<string, unknown>,
): boolean => {
  for (const key of Object.keys(probe)) {
    const a = stored[key];
    const b = probe[key];
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) return false;
    } else if (a !== b) {
      return false;
    }
  }
  return true;
};

const toExceptionJson = (row: ExceptionRow): Record<string, unknown> => ({
  exception_id: row.exception_id,
  capability_id: row.capability_id,
  control_id: row.control_id,
  requested_by: row.requested_by,
  requested_at: row.requested_at,
  reason: row.reason,
  scope_selector: row.scope_selector,
  status: row.status,
  decided_by: row.decided_by,
  decided_at: row.decided_at,
  decision_comment: row.decision_comment,
  expires_at: row.expires_at,
  revoked_at: row.revoked_at,
  revoked_by: row.revoked_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const toEventJson = (row: EventRow): Record<string, unknown> => ({
  event_id: row.event_id,
  exception_id: row.exception_id,
  event_type: row.event_type,
  actor_user_id: row.actor_user_id,
  details: row.details,
  at: row.at,
});

const queryImpl = async (rawSql: string, params?: unknown[]): Promise<QueryResult> => {
  const sql = rawSql.replace(/\s+/g, ' ').trim();
  const paramList = (params ?? []) as unknown[];

  // ────────────────────────────────────────────────────────────────────
  // Control existence check inside requestException().
  // ────────────────────────────────────────────────────────────────────
  if (sql.startsWith('SELECT control_id, status FROM governance_controls')) {
    const id = paramList[0] as string;
    const row = controlsTable.get(id);
    if (!row) return { rows: [], rowCount: 0 };
    return { rows: [{ control_id: row.control_id, status: row.status }], rowCount: 1 };
  }

  // ────────────────────────────────────────────────────────────────────
  // INSERT governance_exceptions (initial REQUESTED row).
  // ────────────────────────────────────────────────────────────────────
  if (sql.startsWith('INSERT INTO governance_exceptions')) {
    const [
      exception_id,
      capability_id,
      control_id,
      requested_by,
      reason,
      scope_selector_raw,
      expires_at,
    ] = paramList as [string, string, string, string, string, unknown, string];
    const now = new Date();
    const row: ExceptionRow = {
      exception_id,
      capability_id,
      control_id,
      requested_by,
      requested_at: now,
      reason,
      scope_selector: parseJsonbParam(scope_selector_raw),
      status: 'REQUESTED',
      decided_by: null,
      decided_at: null,
      decision_comment: null,
      expires_at: expires_at ? new Date(expires_at) : null,
      revoked_at: null,
      revoked_by: null,
      created_at: now,
      updated_at: now,
    };
    exceptions.set(exception_id, row);
    return { rows: [toExceptionJson(row)], rowCount: 1 };
  }

  // ────────────────────────────────────────────────────────────────────
  // INSERT governance_exception_events.
  // ────────────────────────────────────────────────────────────────────
  if (sql.startsWith('INSERT INTO governance_exception_events')) {
    const [event_id, exception_id, event_type, actor_user_id, details_raw] =
      paramList as [string, string, string, string | null, unknown];
    const row: EventRow = {
      event_id,
      exception_id,
      event_type,
      actor_user_id: actor_user_id ?? null,
      details: parseJsonbParam(details_raw),
      at: nextMonotonicDate(),
    };
    events.push(row);
    return { rows: [toEventJson(row)], rowCount: 1 };
  }

  // ────────────────────────────────────────────────────────────────────
  // SELECT ... FOR UPDATE inside decide/revoke.
  // ────────────────────────────────────────────────────────────────────
  if (sql.startsWith('SELECT * FROM governance_exceptions WHERE exception_id = $1 FOR UPDATE')) {
    const id = paramList[0] as string;
    const row = exceptions.get(id);
    if (!row) return { rows: [], rowCount: 0 };
    return { rows: [toExceptionJson(row)], rowCount: 1 };
  }

  // ────────────────────────────────────────────────────────────────────
  // Plain SELECT by exception_id (getException).
  // ────────────────────────────────────────────────────────────────────
  if (sql.startsWith('SELECT * FROM governance_exceptions WHERE exception_id = $1')) {
    const id = paramList[0] as string;
    const row = exceptions.get(id);
    if (!row) return { rows: [], rowCount: 0 };
    return { rows: [toExceptionJson(row)], rowCount: 1 };
  }

  // ────────────────────────────────────────────────────────────────────
  // UPDATE decide path — status = $2 (APPROVED|DENIED).
  // ────────────────────────────────────────────────────────────────────
  if (
    sql.startsWith('UPDATE governance_exceptions') &&
    sql.includes('SET status = $2') &&
    sql.includes('decided_by = $3')
  ) {
    const [exception_id, status, decided_by, decision_comment, expires_at] = paramList as [
      string,
      string,
      string,
      string | null,
      string | null,
    ];
    const row = exceptions.get(exception_id);
    if (!row) return { rows: [], rowCount: 0 };
    row.status = status;
    row.decided_by = decided_by;
    row.decided_at = new Date();
    row.decision_comment = decision_comment ?? null;
    row.expires_at = expires_at ? new Date(expires_at) : row.expires_at;
    row.updated_at = new Date();
    exceptions.set(exception_id, row);
    return { rows: [toExceptionJson(row)], rowCount: 1 };
  }

  // ────────────────────────────────────────────────────────────────────
  // UPDATE revoke path — SET status = 'REVOKED'.
  // ────────────────────────────────────────────────────────────────────
  if (
    sql.startsWith('UPDATE governance_exceptions') &&
    sql.includes("SET status = 'REVOKED'")
  ) {
    const [exception_id, revoked_by] = paramList as [string, string];
    const row = exceptions.get(exception_id);
    if (!row) return { rows: [], rowCount: 0 };
    row.status = 'REVOKED';
    row.revoked_at = new Date();
    row.revoked_by = revoked_by;
    row.updated_at = new Date();
    exceptions.set(exception_id, row);
    return { rows: [toExceptionJson(row)], rowCount: 1 };
  }

  // ────────────────────────────────────────────────────────────────────
  // UPDATE expire path — expireDueExceptions().
  // ────────────────────────────────────────────────────────────────────
  if (
    sql.startsWith('UPDATE governance_exceptions') &&
    sql.includes("SET status = 'EXPIRED'") &&
    sql.includes('RETURNING exception_id, capability_id')
  ) {
    const now = Date.now();
    const expiredRows: Array<{ exception_id: string; capability_id: string }> = [];
    for (const row of exceptions.values()) {
      if (
        row.status === 'APPROVED' &&
        row.expires_at !== null &&
        row.expires_at.getTime() <= now
      ) {
        row.status = 'EXPIRED';
        row.updated_at = new Date();
        expiredRows.push({ exception_id: row.exception_id, capability_id: row.capability_id });
      }
    }
    return { rows: expiredRows, rowCount: expiredRows.length };
  }

  // ────────────────────────────────────────────────────────────────────
  // findActiveException — capability + status=APPROVED + JSONB @>.
  // ────────────────────────────────────────────────────────────────────
  if (
    sql.includes('FROM governance_exceptions') &&
    sql.includes("status = 'APPROVED'") &&
    sql.includes('expires_at > NOW()') &&
    sql.includes('scope_selector @> $2::jsonb')
  ) {
    const [capabilityId, probeRaw] = paramList as [string, unknown];
    const probe = parseJsonbParam(probeRaw);
    const now = Date.now();
    const candidates = Array.from(exceptions.values()).filter(row => {
      if (row.capability_id !== capabilityId) return false;
      if (row.status !== 'APPROVED') return false;
      if (!row.expires_at || row.expires_at.getTime() <= now) return false;
      return containsSelector(row.scope_selector, probe);
    });
    candidates.sort((left, right) => {
      const a = left.expires_at?.getTime() ?? Infinity;
      const b = right.expires_at?.getTime() ?? Infinity;
      if (a !== b) return a - b;
      return left.exception_id.localeCompare(right.exception_id);
    });
    const first = candidates[0];
    if (!first) return { rows: [], rowCount: 0 };
    return { rows: [toExceptionJson(first)], rowCount: 1 };
  }

  // ────────────────────────────────────────────────────────────────────
  // listExceptions — with optional where clauses.
  // ────────────────────────────────────────────────────────────────────
  if (
    sql.includes('FROM governance_exceptions') &&
    sql.includes('ORDER BY requested_at DESC')
  ) {
    let matches = Array.from(exceptions.values());
    let cursor = 0;
    if (sql.includes('capability_id = $')) {
      const capabilityId = paramList[cursor++] as string;
      matches = matches.filter(row => row.capability_id === capabilityId);
    }
    if (sql.includes('control_id = $')) {
      const controlId = paramList[cursor++] as string;
      matches = matches.filter(row => row.control_id === controlId);
    }
    if (sql.includes('status IN (')) {
      const inClause = sql.match(/status IN \(([^)]+)\)/);
      const placeholderCount = inClause ? inClause[1].split(',').length : 0;
      const statuses = paramList.slice(cursor, cursor + placeholderCount) as string[];
      cursor += placeholderCount;
      matches = matches.filter(row => statuses.includes(row.status));
    }
    matches.sort(
      (left, right) =>
        right.requested_at.getTime() - left.requested_at.getTime() ||
        right.exception_id.localeCompare(left.exception_id),
    );
    return { rows: matches.map(toExceptionJson), rowCount: matches.length };
  }

  // ────────────────────────────────────────────────────────────────────
  // listEventsForException — events by exception_id ordered oldest→newest.
  // ────────────────────────────────────────────────────────────────────
  if (
    sql.includes('FROM governance_exception_events') &&
    sql.includes('ORDER BY at ASC')
  ) {
    const [exceptionId] = paramList as [string];
    const filtered = events.filter(row => row.exception_id === exceptionId);
    filtered.sort(
      (left, right) =>
        left.at.getTime() - right.at.getTime() ||
        left.event_id.localeCompare(right.event_id),
    );
    return { rows: filtered.map(toEventJson), rowCount: filtered.length };
  }

  throw new Error(`Unhandled SQL in mock: ${sql}`);
};

vi.mock('../db', () => ({
  query: (sql: string, params?: unknown[]) => queryImpl(sql, params),
  transaction: async <T>(
    work: (client: { query: typeof queryImpl }) => Promise<T>,
  ): Promise<T> => {
    return work({ query: queryImpl });
  },
}));

vi.mock('../agentLearning/repository', () => ({
  appendLearningUpdateRecord: vi.fn(async (input: {
    capabilityId: string;
    agentId: string;
    insight: string;
    triggerType: string;
  }) => {
    if (learningUpdateShouldThrow) {
      throw new Error('simulated learning-update failure');
    }
    learningUpdates.push({
      capabilityId: input.capabilityId,
      agentId: input.agentId,
      insight: input.insight,
      triggerType: input.triggerType,
    });
    return { id: 'fake-learning-update' } as unknown;
  }),
}));

// ──────────────────────────────────────────────────────────────────────────
// Seed helpers
// ──────────────────────────────────────────────────────────────────────────

const seedControl = (id: string, status: 'ACTIVE' | 'RETIRED' = 'ACTIVE') => {
  controlsTable.set(id, { control_id: id, status });
};

const hoursFromNow = (hours: number) =>
  new Date(Date.now() + hours * 3600 * 1000).toISOString();

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
  delete process.env.GOVERNANCE_EXCEPTIONS_ENABLED;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('governanceExceptionsEnabled()', () => {
  it('defaults to true when the env var is unset', async () => {
    const { governanceExceptionsEnabled } = await import('../governance/exceptions');
    expect(governanceExceptionsEnabled()).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'off', 'no'])(
    'returns false when GOVERNANCE_EXCEPTIONS_ENABLED=%s',
    async value => {
      process.env.GOVERNANCE_EXCEPTIONS_ENABLED = value;
      const { governanceExceptionsEnabled } = await import('../governance/exceptions');
      expect(governanceExceptionsEnabled()).toBe(false);
    },
  );
});

describe('requestException()', () => {
  it('creates a REQUESTED exception and writes the REQUESTED event atomically', async () => {
    seedControl('GOV-CTRL-0001');
    const { requestException } = await import('../governance/exceptions');

    const result = await requestException({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      requestedBy: 'u-operator',
      reason: 'Urgent hot-fix for billing outage',
      scopeSelector: { toolId: 'run_deploy' },
      expiresAt: hoursFromNow(4),
    });

    expect(result.status).toBe('REQUESTED');
    expect(result.exceptionId).toMatch(/^GOV-EXC-/);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventType).toBe('REQUESTED');
    expect(result.events[0].actorUserId).toBe('u-operator');

    expect(exceptions.size).toBe(1);
    expect(events).toHaveLength(1);
  });

  it('rejects a missing or empty reason', async () => {
    seedControl('GOV-CTRL-0001');
    const { requestException } = await import('../governance/exceptions');

    await expect(
      requestException({
        capabilityId: 'cap-alpha',
        controlId: 'GOV-CTRL-0001',
        requestedBy: 'u-operator',
        reason: '   ',
        expiresAt: hoursFromNow(4),
      }),
    ).rejects.toThrow(/reason must be a non-empty string/);
  });

  it('rejects a null or past expiresAt', async () => {
    seedControl('GOV-CTRL-0001');
    const { requestException } = await import('../governance/exceptions');

    await expect(
      requestException({
        capabilityId: 'cap-alpha',
        controlId: 'GOV-CTRL-0001',
        requestedBy: 'u-operator',
        reason: 'valid',
        expiresAt: '' as unknown as string,
      }),
    ).rejects.toThrow(/expiresAt is required/);

    await expect(
      requestException({
        capabilityId: 'cap-alpha',
        controlId: 'GOV-CTRL-0001',
        requestedBy: 'u-operator',
        reason: 'valid',
        expiresAt: hoursFromNow(-1),
      }),
    ).rejects.toThrow(/expiresAt must be in the future/);
  });

  it('rejects an unknown or retired control', async () => {
    seedControl('GOV-CTRL-RETIRED', 'RETIRED');
    const { requestException } = await import('../governance/exceptions');

    await expect(
      requestException({
        capabilityId: 'cap-alpha',
        controlId: 'GOV-CTRL-UNKNOWN',
        requestedBy: 'u-operator',
        reason: 'valid',
        expiresAt: hoursFromNow(4),
      }),
    ).rejects.toThrow(/not found/);

    await expect(
      requestException({
        capabilityId: 'cap-alpha',
        controlId: 'GOV-CTRL-RETIRED',
        requestedBy: 'u-operator',
        reason: 'valid',
        expiresAt: hoursFromNow(4),
      }),
    ).rejects.toThrow(/retired/);
  });
});

describe('decideException()', () => {
  const prep = async (expiresAt?: string) => {
    seedControl('GOV-CTRL-0001');
    const { requestException } = await import('../governance/exceptions');
    const created = await requestException({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      requestedBy: 'u-requester',
      reason: 'hot-fix window',
      scopeSelector: { toolId: 'run_deploy' },
      expiresAt: expiresAt ?? hoursFromNow(4),
    });
    return created;
  };

  it('APPROVED flips status, writes event, and emits a GOVERNANCE_EXCEPTION learning update', async () => {
    const created = await prep();
    const { decideException } = await import('../governance/exceptions');

    const result = await decideException({
      exceptionId: created.exceptionId,
      actorUserId: 'u-approver',
      decision: { status: 'APPROVED', comment: 'ok, 4h max' },
    });

    expect(result.status).toBe('APPROVED');
    expect(result.decidedBy).toBe('u-approver');
    expect(result.decisionComment).toBe('ok, 4h max');
    const approvedEvent = result.events.find(ev => ev.eventType === 'APPROVED');
    expect(approvedEvent).toBeDefined();
    expect(approvedEvent?.actorUserId).toBe('u-approver');

    expect(learningUpdates).toHaveLength(1);
    expect(learningUpdates[0].triggerType).toBe('GOVERNANCE_EXCEPTION');
    expect(learningUpdates[0].capabilityId).toBe('cap-alpha');
    expect(learningUpdates[0].agentId).toBe('governance');
  });

  it('DENIED does NOT emit a learning update', async () => {
    const created = await prep();
    const { decideException } = await import('../governance/exceptions');

    const result = await decideException({
      exceptionId: created.exceptionId,
      actorUserId: 'u-approver',
      decision: { status: 'DENIED', comment: 'not urgent enough' },
    });

    expect(result.status).toBe('DENIED');
    expect(learningUpdates).toHaveLength(0);
  });

  it('refuses to double-decide an already-decided exception', async () => {
    const created = await prep();
    const { decideException } = await import('../governance/exceptions');

    await decideException({
      exceptionId: created.exceptionId,
      actorUserId: 'u-approver',
      decision: { status: 'APPROVED' },
    });

    await expect(
      decideException({
        exceptionId: created.exceptionId,
        actorUserId: 'u-approver',
        decision: { status: 'DENIED' },
      }),
    ).rejects.toThrow(/is not REQUESTED/);
  });

  it('rejects a decision expiresAt that extends past the requested expiry', async () => {
    const fourHoursOut = hoursFromNow(4);
    const created = await prep(fourHoursOut);
    const { decideException } = await import('../governance/exceptions');

    // 10h > original 4h requested window
    await expect(
      decideException({
        exceptionId: created.exceptionId,
        actorUserId: 'u-approver',
        decision: { status: 'APPROVED', expiresAt: hoursFromNow(10) },
      }),
    ).rejects.toThrow(/cannot extend beyond the requested expiry/);
  });

  it('allows narrowing the expiry', async () => {
    const created = await prep(hoursFromNow(8));
    const { decideException } = await import('../governance/exceptions');

    const narrowed = hoursFromNow(2);
    const result = await decideException({
      exceptionId: created.exceptionId,
      actorUserId: 'u-approver',
      decision: { status: 'APPROVED', expiresAt: narrowed },
    });

    expect(result.status).toBe('APPROVED');
    expect(result.expiresAt).toBeDefined();
    const expiryMs = new Date(result.expiresAt!).getTime();
    expect(Math.abs(expiryMs - new Date(narrowed).getTime())).toBeLessThan(1000);
  });

  it('continues when the learning-update append fails (best-effort)', async () => {
    const created = await prep();
    learningUpdateShouldThrow = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { decideException } = await import('../governance/exceptions');

    const result = await decideException({
      exceptionId: created.exceptionId,
      actorUserId: 'u-approver',
      decision: { status: 'APPROVED' },
    });

    expect(result.status).toBe('APPROVED');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('revokeException()', () => {
  it('moves APPROVED → REVOKED and writes a REVOKED event', async () => {
    seedControl('GOV-CTRL-0001');
    const { requestException, decideException, revokeException } = await import(
      '../governance/exceptions'
    );
    const created = await requestException({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      requestedBy: 'u-requester',
      reason: 'hot-fix window',
      scopeSelector: { toolId: 'run_deploy' },
      expiresAt: hoursFromNow(4),
    });
    await decideException({
      exceptionId: created.exceptionId,
      actorUserId: 'u-approver',
      decision: { status: 'APPROVED' },
    });

    const result = await revokeException({
      exceptionId: created.exceptionId,
      actorUserId: 'u-operator',
      comment: 'incident resolved early',
    });

    expect(result.status).toBe('REVOKED');
    expect(result.revokedBy).toBe('u-operator');
    const revokedEvent = result.events.find(ev => ev.eventType === 'REVOKED');
    expect(revokedEvent).toBeDefined();
    expect(revokedEvent?.details).toMatchObject({ comment: 'incident resolved early' });
  });

  it('refuses to revoke a non-APPROVED exception', async () => {
    seedControl('GOV-CTRL-0001');
    const { requestException, revokeException } = await import('../governance/exceptions');
    const created = await requestException({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      requestedBy: 'u-requester',
      reason: 'hot-fix window',
      expiresAt: hoursFromNow(4),
    });

    await expect(
      revokeException({
        exceptionId: created.exceptionId,
        actorUserId: 'u-operator',
      }),
    ).rejects.toThrow(/only APPROVED exceptions can be revoked/);
  });
});

describe('findActiveException()', () => {
  const seedApproved = async (args: {
    capabilityId: string;
    controlId: string;
    scopeSelector: Record<string, unknown>;
    expiresInHours: number;
  }) => {
    seedControl(args.controlId);
    const { requestException, decideException } = await import('../governance/exceptions');
    const created = await requestException({
      capabilityId: args.capabilityId,
      controlId: args.controlId,
      requestedBy: 'u-requester',
      reason: 'waiver',
      scopeSelector: args.scopeSelector,
      expiresAt: hoursFromNow(args.expiresInHours),
    });
    return decideException({
      exceptionId: created.exceptionId,
      actorUserId: 'u-approver',
      decision: { status: 'APPROVED' },
    });
  };

  it('returns the exception when scope_selector contains the probe', async () => {
    await seedApproved({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      scopeSelector: { toolId: 'run_deploy' },
      expiresInHours: 4,
    });
    const { findActiveException } = await import('../governance/exceptions');

    const hit = await findActiveException({
      capabilityId: 'cap-alpha',
      probe: { toolId: 'run_deploy' },
    });

    expect(hit).not.toBeNull();
    expect(hit?.status).toBe('APPROVED');
  });

  it('returns null when the probe does NOT match scope_selector', async () => {
    await seedApproved({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      scopeSelector: { toolId: 'run_deploy' },
      expiresInHours: 4,
    });
    const { findActiveException } = await import('../governance/exceptions');

    const miss = await findActiveException({
      capabilityId: 'cap-alpha',
      probe: { toolId: 'workspace_write' },
    });
    expect(miss).toBeNull();
  });

  it('returns the soonest-expiring exception when multiple match', async () => {
    const laterId = await seedApproved({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      scopeSelector: { toolId: 'run_deploy' },
      expiresInHours: 8,
    });
    const soonerId = await seedApproved({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      scopeSelector: { toolId: 'run_deploy' },
      expiresInHours: 2,
    });
    const { findActiveException } = await import('../governance/exceptions');

    const hit = await findActiveException({
      capabilityId: 'cap-alpha',
      probe: { toolId: 'run_deploy' },
    });

    expect(hit?.exceptionId).toBe(soonerId.exceptionId);
    expect(hit?.exceptionId).not.toBe(laterId.exceptionId);
  });

  it('returns null when the feature flag is off', async () => {
    await seedApproved({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      scopeSelector: { toolId: 'run_deploy' },
      expiresInHours: 4,
    });

    process.env.GOVERNANCE_EXCEPTIONS_ENABLED = 'false';
    const { findActiveException } = await import('../governance/exceptions');
    const hit = await findActiveException({
      capabilityId: 'cap-alpha',
      probe: { toolId: 'run_deploy' },
    });
    expect(hit).toBeNull();
  });

  it('returns null for an empty probe', async () => {
    const { findActiveException } = await import('../governance/exceptions');
    const hit = await findActiveException({ capabilityId: 'cap-alpha', probe: {} });
    expect(hit).toBeNull();
  });
});

describe('expireDueExceptions()', () => {
  it('flips APPROVED+past-due rows to EXPIRED and writes an EXPIRED event each', async () => {
    seedControl('GOV-CTRL-0001');
    const { requestException, decideException, expireDueExceptions } = await import(
      '../governance/exceptions'
    );

    // Exception A — due: we back-date expires_at by reaching into the store
    //   after approval since requestException() refuses past expiries.
    const a = await requestException({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      requestedBy: 'u1',
      reason: 'r',
      expiresAt: hoursFromNow(2),
    });
    await decideException({
      exceptionId: a.exceptionId,
      actorUserId: 'u-approver',
      decision: { status: 'APPROVED' },
    });
    const rowA = exceptions.get(a.exceptionId)!;
    rowA.expires_at = new Date(Date.now() - 60 * 1000); // 1 min ago

    // Exception B — not yet due; should stay APPROVED.
    const b = await requestException({
      capabilityId: 'cap-beta',
      controlId: 'GOV-CTRL-0001',
      requestedBy: 'u2',
      reason: 'r',
      expiresAt: hoursFromNow(4),
    });
    await decideException({
      exceptionId: b.exceptionId,
      actorUserId: 'u-approver',
      decision: { status: 'APPROVED' },
    });

    const expiredCount = await expireDueExceptions();

    expect(expiredCount).toBe(1);
    expect(exceptions.get(a.exceptionId)!.status).toBe('EXPIRED');
    expect(exceptions.get(b.exceptionId)!.status).toBe('APPROVED');

    const expiryEvents = events.filter(ev => ev.event_type === 'EXPIRED');
    expect(expiryEvents).toHaveLength(1);
    expect(expiryEvents[0].exception_id).toBe(a.exceptionId);
    expect(expiryEvents[0].actor_user_id).toBeNull();
  });

  it('returns 0 and writes no events when nothing is due', async () => {
    const { expireDueExceptions } = await import('../governance/exceptions');
    const expired = await expireDueExceptions();
    expect(expired).toBe(0);
    expect(events).toHaveLength(0);
  });
});

describe('getException() / listExceptions()', () => {
  it('getException() hydrates the events chronologically', async () => {
    seedControl('GOV-CTRL-0001');
    const { requestException, decideException, revokeException, getException } = await import(
      '../governance/exceptions'
    );
    const created = await requestException({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      requestedBy: 'u1',
      reason: 'r',
      expiresAt: hoursFromNow(4),
    });
    await decideException({
      exceptionId: created.exceptionId,
      actorUserId: 'u-approver',
      decision: { status: 'APPROVED' },
    });
    await revokeException({
      exceptionId: created.exceptionId,
      actorUserId: 'u-ops',
    });

    const detail = await getException(created.exceptionId);
    expect(detail).not.toBeNull();
    const types = detail!.events.map(ev => ev.eventType);
    expect(types).toEqual(['REQUESTED', 'APPROVED', 'REVOKED']);
  });

  it('listExceptions() honors capability + status filters', async () => {
    seedControl('GOV-CTRL-0001');
    const { requestException, listExceptions } = await import('../governance/exceptions');
    await requestException({
      capabilityId: 'cap-alpha',
      controlId: 'GOV-CTRL-0001',
      requestedBy: 'u1',
      reason: 'r',
      expiresAt: hoursFromNow(4),
    });
    await requestException({
      capabilityId: 'cap-beta',
      controlId: 'GOV-CTRL-0001',
      requestedBy: 'u2',
      reason: 'r',
      expiresAt: hoursFromNow(4),
    });

    const forAlpha = await listExceptions({ capabilityId: 'cap-alpha' });
    expect(forAlpha.items).toHaveLength(1);
    expect(forAlpha.items[0].capabilityId).toBe('cap-alpha');

    const byStatus = await listExceptions({ status: ['REQUESTED'] });
    expect(byStatus.items).toHaveLength(2);

    const byStatusNone = await listExceptions({ status: ['APPROVED'] });
    expect(byStatusNone.items).toHaveLength(0);
  });
});
