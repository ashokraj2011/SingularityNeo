/**
 * Governance exceptions service — Slice 3.
 *
 * A governance exception is a time-bound, auditable waiver of a policy
 * decision. While a matching APPROVED, unexpired exception exists,
 * `evaluateToolPolicy` flips a REQUIRE_APPROVAL verdict to ALLOW and stamps
 * the decision row with the exception id + expiry. Every state transition
 * is recorded on `governance_exception_events` for the audit trail, and
 * approval decisions additionally drop a `GOVERNANCE_EXCEPTION` row on
 * `capability_learning_updates` so the unified audit timeline picks them up.
 *
 * Lifecycle (enforced by `decideException` / `revokeException`):
 *
 *     REQUESTED ─┬─▶ APPROVED ─┬─▶ EXPIRED (scheduler)
 *                │             └─▶ REVOKED (operator)
 *                └─▶ DENIED
 *
 * v1 invariants:
 *   - `expires_at` is required on request (no permanent exceptions). The
 *     plan flags an always-approved exception as a high-priority risk, so
 *     the schema permits nullable but the service path rejects null.
 *   - A decision is final: once APPROVED, only REVOKED / EXPIRED can move
 *     it; once DENIED, the exception is closed forever.
 *   - Feature flag `GOVERNANCE_EXCEPTIONS_ENABLED=false` makes the
 *     evaluateToolPolicy hook inert (never finds active exceptions). The
 *     rest of the service — request, decide, revoke, list — still works so
 *     in-flight exception data isn't stranded when the flag is flipped.
 */
import type { PoolClient } from 'pg';
import { query, transaction } from '../db';
import {
  appendLearningUpdateRecord,
} from '../agentLearning/repository';
import type {
  GovernanceException,
  GovernanceExceptionDecisionInput,
  GovernanceExceptionEvent,
  GovernanceExceptionEventType,
  GovernanceExceptionListFilter,
  GovernanceExceptionRequestInput,
  GovernanceExceptionStatus,
  GovernanceExceptionWithEvents,
} from '../../src/types';

const EXCEPTION_ID_PREFIX = 'GOV-EXC-';
const EVENT_ID_PREFIX = 'GOV-EXC-EVT-';

const createId = (prefix: string): string =>
  `${prefix}${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

const asIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value ?? '');

const asIsoOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return asIso(value);
};

const parseJsonb = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
};

const rowToException = (row: Record<string, unknown>): GovernanceException => ({
  exceptionId: String(row.exception_id),
  capabilityId: String(row.capability_id),
  controlId: String(row.control_id),
  requestedBy: String(row.requested_by),
  requestedAt: asIso(row.requested_at),
  reason: String(row.reason),
  scopeSelector: parseJsonb(row.scope_selector),
  status: String(row.status) as GovernanceExceptionStatus,
  decidedBy: row.decided_by ? String(row.decided_by) : null,
  decidedAt: asIsoOrNull(row.decided_at),
  decisionComment: row.decision_comment ? String(row.decision_comment) : null,
  expiresAt: asIsoOrNull(row.expires_at),
  revokedAt: asIsoOrNull(row.revoked_at),
  revokedBy: row.revoked_by ? String(row.revoked_by) : null,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
});

const rowToEvent = (row: Record<string, unknown>): GovernanceExceptionEvent => ({
  eventId: String(row.event_id),
  exceptionId: String(row.exception_id),
  eventType: String(row.event_type) as GovernanceExceptionEventType,
  actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
  details: parseJsonb(row.details),
  at: asIso(row.at),
});

// ──────────────────────────────────────────────────────────────────────────
// Feature flag. Defaults to ON; the Slice 3 rollback path is
// GOVERNANCE_EXCEPTIONS_ENABLED=false, which makes findActiveException
// return null so evaluateToolPolicy never flips REQUIRE_APPROVAL on
// account of an exception.
// ──────────────────────────────────────────────────────────────────────────
export const governanceExceptionsEnabled = (): boolean => {
  const raw = process.env.GOVERNANCE_EXCEPTIONS_ENABLED?.toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'no') return false;
  return true;
};

// ──────────────────────────────────────────────────────────────────────────
// Event writer — always called in-transaction alongside the exception
// status mutation so an event is never orphaned.
// ──────────────────────────────────────────────────────────────────────────
const writeEvent = async (
  executor: Pick<PoolClient, 'query'>,
  args: {
    exceptionId: string;
    eventType: GovernanceExceptionEventType;
    actorUserId: string | null;
    details?: Record<string, unknown>;
  },
): Promise<GovernanceExceptionEvent> => {
  const eventId = createId(EVENT_ID_PREFIX);
  const res = await executor.query(
    `
      INSERT INTO governance_exception_events (
        event_id, exception_id, event_type, actor_user_id, details, at
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,NOW())
      RETURNING *
    `,
    [
      eventId,
      args.exceptionId,
      args.eventType,
      args.actorUserId,
      JSON.stringify(args.details ?? {}),
    ],
  );
  return rowToEvent(res.rows[0]);
};

// ──────────────────────────────────────────────────────────────────────────
// requestException — create a REQUESTED exception. Writes the REQUESTED
// event atomically. `expiresAt` is required (v1 rejects permanent
// exceptions per the plan's risk mitigation).
// ──────────────────────────────────────────────────────────────────────────
export const requestException = async (
  input: GovernanceExceptionRequestInput & { requestedBy: string },
): Promise<GovernanceExceptionWithEvents> => {
  if (!input.capabilityId) throw new Error('requestException: capabilityId is required');
  if (!input.controlId) throw new Error('requestException: controlId is required');
  if (!input.requestedBy) throw new Error('requestException: requestedBy is required');
  if (!input.reason || !input.reason.trim()) {
    throw new Error('requestException: reason must be a non-empty string');
  }
  if (!input.expiresAt) {
    throw new Error(
      'requestException: expiresAt is required (v1 rejects permanent exceptions)',
    );
  }
  const expiresAtDate = new Date(input.expiresAt);
  if (Number.isNaN(expiresAtDate.getTime())) {
    throw new Error(`requestException: expiresAt is not a valid ISO date: ${input.expiresAt}`);
  }
  if (expiresAtDate.getTime() <= Date.now()) {
    throw new Error('requestException: expiresAt must be in the future');
  }

  // Caller must reference a known, non-retired control.
  const controlRes = await query<{ control_id: string; status: string }>(
    `SELECT control_id, status FROM governance_controls WHERE control_id = $1`,
    [input.controlId],
  );
  if (controlRes.rowCount === 0) {
    throw new Error(`requestException: control ${input.controlId} not found`);
  }
  if (controlRes.rows[0].status === 'RETIRED') {
    throw new Error(`requestException: control ${input.controlId} is retired`);
  }

  const exceptionId = createId(EXCEPTION_ID_PREFIX);
  const scopeSelector = input.scopeSelector ?? {};

  return transaction(async client => {
    const res = await client.query(
      `
        INSERT INTO governance_exceptions (
          exception_id, capability_id, control_id, requested_by, requested_at,
          reason, scope_selector, status, expires_at, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,NOW(),$5,$6::jsonb,'REQUESTED',$7,NOW(),NOW())
        RETURNING *
      `,
      [
        exceptionId,
        input.capabilityId,
        input.controlId,
        input.requestedBy,
        input.reason,
        JSON.stringify(scopeSelector),
        expiresAtDate.toISOString(),
      ],
    );
    const exception = rowToException(res.rows[0]);
    const event = await writeEvent(client, {
      exceptionId,
      eventType: 'REQUESTED',
      actorUserId: input.requestedBy,
      details: {
        controlId: input.controlId,
        scopeSelector,
        expiresAt: expiresAtDate.toISOString(),
      },
    });
    return { ...exception, events: [event] };
  });
};

// ──────────────────────────────────────────────────────────────────────────
// decideException — approve or deny a REQUESTED exception. Fails loud on
// double-decide to protect the audit trail. An APPROVED decision also
// writes a GOVERNANCE_EXCEPTION capability_learning_updates row so the
// unified audit timeline surfaces it alongside corrections / drift events.
// ──────────────────────────────────────────────────────────────────────────
export const decideException = async ({
  exceptionId,
  decision,
  actorUserId,
}: {
  exceptionId: string;
  decision: GovernanceExceptionDecisionInput;
  actorUserId: string;
}): Promise<GovernanceExceptionWithEvents> => {
  if (!exceptionId) throw new Error('decideException: exceptionId is required');
  if (!actorUserId) throw new Error('decideException: actorUserId is required');
  if (decision.status !== 'APPROVED' && decision.status !== 'DENIED') {
    throw new Error(
      `decideException: status must be APPROVED or DENIED (got ${decision.status})`,
    );
  }

  return transaction(async client => {
    const existingRes = await client.query<Record<string, unknown>>(
      `SELECT * FROM governance_exceptions WHERE exception_id = $1 FOR UPDATE`,
      [exceptionId],
    );
    if (existingRes.rowCount === 0) {
      throw new Error(`decideException: exception ${exceptionId} not found`);
    }
    const existing = rowToException(existingRes.rows[0]);
    if (existing.status !== 'REQUESTED') {
      throw new Error(
        `decideException: exception ${exceptionId} is not REQUESTED (current=${existing.status})`,
      );
    }

    // A decision can narrow the expiry but never extend it past what the
    // requester asked for. This prevents a rubber-stamp approver from
    // silently extending the waiver window.
    let resolvedExpiresAt = existing.expiresAt;
    if (decision.expiresAt) {
      const parsed = new Date(decision.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(
          `decideException: expiresAt is not a valid ISO date: ${decision.expiresAt}`,
        );
      }
      if (existing.expiresAt && parsed.getTime() > new Date(existing.expiresAt).getTime()) {
        throw new Error(
          'decideException: decision expiresAt cannot extend beyond the requested expiry',
        );
      }
      resolvedExpiresAt = parsed.toISOString();
    }

    const updateRes = await client.query<Record<string, unknown>>(
      `
        UPDATE governance_exceptions
           SET status = $2,
               decided_by = $3,
               decided_at = NOW(),
               decision_comment = $4,
               expires_at = $5,
               updated_at = NOW()
         WHERE exception_id = $1
         RETURNING *
      `,
      [
        exceptionId,
        decision.status,
        actorUserId,
        decision.comment ?? null,
        resolvedExpiresAt,
      ],
    );
    const updated = rowToException(updateRes.rows[0]);
    const event = await writeEvent(client, {
      exceptionId,
      eventType: decision.status, // APPROVED | DENIED
      actorUserId,
      details: {
        previousStatus: existing.status,
        expiresAt: resolvedExpiresAt,
        comment: decision.comment ?? null,
      },
    });

    // Approved exceptions are load-bearing for the audit trail: surface the
    // decision on the agent-learning timeline by appending a
    // GOVERNANCE_EXCEPTION row. We only emit for APPROVED so the timeline
    // doesn't fill with rejected waivers; the governance_exception_events
    // table is the authoritative record for denials.
    if (decision.status === 'APPROVED') {
      try {
        await appendLearningUpdateRecord({
          capabilityId: updated.capabilityId,
          agentId: 'governance',
          insight: `Governance exception ${exceptionId} approved for control ${updated.controlId} until ${resolvedExpiresAt ?? 'unspecified'}.`,
          triggerType: 'GOVERNANCE_EXCEPTION',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        // Best-effort: the exception record + event are authoritative; a
        // learning-updates append failure should never fail the decision.
        console.warn(
          `[governance.exceptions] learning-update append failed for ${exceptionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const events = await listEventsForException(client, exceptionId);
    return { ...updated, events };
  });
};

// ──────────────────────────────────────────────────────────────────────────
// revokeException — operator revoke of a previously APPROVED exception.
// Lifecycle: APPROVED → REVOKED. Nothing else is revokable.
// ──────────────────────────────────────────────────────────────────────────
export const revokeException = async ({
  exceptionId,
  actorUserId,
  comment,
}: {
  exceptionId: string;
  actorUserId: string;
  comment?: string;
}): Promise<GovernanceExceptionWithEvents> => {
  if (!exceptionId) throw new Error('revokeException: exceptionId is required');
  if (!actorUserId) throw new Error('revokeException: actorUserId is required');

  return transaction(async client => {
    const existingRes = await client.query<Record<string, unknown>>(
      `SELECT * FROM governance_exceptions WHERE exception_id = $1 FOR UPDATE`,
      [exceptionId],
    );
    if (existingRes.rowCount === 0) {
      throw new Error(`revokeException: exception ${exceptionId} not found`);
    }
    const existing = rowToException(existingRes.rows[0]);
    if (existing.status !== 'APPROVED') {
      throw new Error(
        `revokeException: only APPROVED exceptions can be revoked (current=${existing.status})`,
      );
    }
    const updated = await client.query<Record<string, unknown>>(
      `
        UPDATE governance_exceptions
           SET status = 'REVOKED',
               revoked_at = NOW(),
               revoked_by = $2,
               updated_at = NOW()
         WHERE exception_id = $1
         RETURNING *
      `,
      [exceptionId, actorUserId],
    );
    const next = rowToException(updated.rows[0]);
    await writeEvent(client, {
      exceptionId,
      eventType: 'REVOKED',
      actorUserId,
      details: { comment: comment ?? null },
    });
    const events = await listEventsForException(client, exceptionId);
    return { ...next, events };
  });
};

// ──────────────────────────────────────────────────────────────────────────
// listEventsForException — always sorted oldest→newest so consumers can
// render a chronological audit strip.
// ──────────────────────────────────────────────────────────────────────────
const listEventsForException = async (
  executor: Pick<PoolClient, 'query'>,
  exceptionId: string,
): Promise<GovernanceExceptionEvent[]> => {
  const res = await executor.query(
    `
      SELECT *
      FROM governance_exception_events
      WHERE exception_id = $1
      ORDER BY at ASC, event_id ASC
    `,
    [exceptionId],
  );
  return res.rows.map(rowToEvent);
};

export const getException = async (
  exceptionId: string,
): Promise<GovernanceExceptionWithEvents | null> => {
  const res = await query<Record<string, unknown>>(
    `SELECT * FROM governance_exceptions WHERE exception_id = $1`,
    [exceptionId],
  );
  if (res.rowCount === 0) return null;
  const exception = rowToException(res.rows[0]);
  const events = await listEventsForException({ query } as Pick<PoolClient, 'query'>, exceptionId);
  return { ...exception, events };
};

// ──────────────────────────────────────────────────────────────────────────
// listExceptions — filterable list for the inbox + the /governance/exceptions
// page. When `includeEvents=true` we fetch events per exception in a single
// follow-up query; for large lists callers should page instead.
// ──────────────────────────────────────────────────────────────────────────
export const listExceptions = async (
  filter: GovernanceExceptionListFilter = {},
): Promise<{ items: GovernanceException[]; total: number }> => {
  const params: unknown[] = [];
  const where: string[] = [];

  if (filter.capabilityId) {
    params.push(filter.capabilityId);
    where.push(`capability_id = $${params.length}`);
  }
  if (filter.controlId) {
    params.push(filter.controlId);
    where.push(`control_id = $${params.length}`);
  }
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (statuses.length > 0) {
      const placeholders = statuses.map(status => {
        params.push(status);
        return `$${params.length}`;
      });
      where.push(`status IN (${placeholders.join(',')})`);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const res = await query<Record<string, unknown>>(
    `
      SELECT *
      FROM governance_exceptions
      ${whereSql}
      ORDER BY requested_at DESC, exception_id DESC
    `,
    params,
  );
  const items = res.rows.map(rowToException);
  return { items, total: items.length };
};

// ──────────────────────────────────────────────────────────────────────────
// findActiveException — hot path for evaluateToolPolicy. Returns the single
// most-narrowly-scoped exception that:
//   1. belongs to the given capability,
//   2. is APPROVED and not-yet-expired,
//   3. has a `scope_selector` that contains every probe key/value.
//
// If multiple match, we prefer the exception expiring soonest to minimize
// blast radius ("use the tightest waiver"). Returns null when the feature
// flag is off so evaluateToolPolicy behaves as if exceptions don't exist.
// ──────────────────────────────────────────────────────────────────────────
export const findActiveException = async ({
  capabilityId,
  probe,
}: {
  capabilityId: string;
  probe: Record<string, unknown>;
}): Promise<GovernanceException | null> => {
  if (!governanceExceptionsEnabled()) return null;
  if (!capabilityId || !probe || Object.keys(probe).length === 0) return null;
  const res = await query<Record<string, unknown>>(
    `
      SELECT *
      FROM governance_exceptions
      WHERE capability_id = $1
        AND status = 'APPROVED'
        AND expires_at > NOW()
        AND scope_selector @> $2::jsonb
      ORDER BY expires_at ASC, exception_id ASC
      LIMIT 1
    `,
    [capabilityId, JSON.stringify(probe)],
  );
  if (res.rowCount === 0) return null;
  return rowToException(res.rows[0]);
};

// ──────────────────────────────────────────────────────────────────────────
// expireDueExceptions — maintenance sweep. Hooked into the agent-learning
// worker tick (Slice 3's "no new runner" rule). Flips APPROVED exceptions
// whose `expires_at <= NOW()` to EXPIRED and writes an EXPIRED event per
// row so the chain REQUESTED → APPROVED → EXPIRED is complete in the audit
// trail. Returns the count so the caller can emit a metric.
// ──────────────────────────────────────────────────────────────────────────
export const expireDueExceptions = async (): Promise<number> => {
  // Two-step: update + events, both in one tx so a crash between steps
  // doesn't leave an EXPIRED row with no terminal event.
  return transaction(async client => {
    const expired = await client.query<{ exception_id: string; capability_id: string }>(
      `
        UPDATE governance_exceptions
           SET status = 'EXPIRED',
               updated_at = NOW()
         WHERE status = 'APPROVED'
           AND expires_at IS NOT NULL
           AND expires_at <= NOW()
         RETURNING exception_id, capability_id
      `,
    );
    for (const row of expired.rows) {
      await writeEvent(client, {
        exceptionId: row.exception_id,
        eventType: 'EXPIRED',
        actorUserId: null,
        details: { reason: 'scheduler_expiry_sweep' },
      });
    }
    return expired.rowCount ?? 0;
  });
};
