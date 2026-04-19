import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  ShieldOff,
  X,
} from 'lucide-react';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import {
  decideGovernanceException,
  listGovernanceControls,
  listGovernanceExceptions,
  getGovernanceException,
  requestGovernanceException,
  revokeGovernanceException,
} from '../lib/api';
import type {
  GovernanceControlListItem,
  GovernanceException,
  GovernanceExceptionEvent,
  GovernanceExceptionStatus,
  GovernanceExceptionWithEvents,
} from '../types';

/**
 * Slice 3 — Governance Exceptions workspace.
 *
 * Surfaces a first-class, time-bound deviation flow: an operator files a
 * request against a specific control, a reviewer approves or denies it
 * with a comment + expiry, and until expiry / revoke / EXPIRED the
 * evaluateToolPolicy hook flips matching REQUIRE_APPROVAL decisions to
 * ALLOW — each stamped with the exception id for audit reconstruction.
 *
 * Design
 *  - List is status-filterable; the default is "open": REQUESTED+APPROVED.
 *    Decided / revoked exceptions stay visible via the "All" filter.
 *  - Row click opens a right-side drawer with the full event timeline.
 *  - Decide / revoke buttons live in the drawer, not the table — the
 *    action always sees the full record before it fires.
 *  - The request form is a lightweight inline dialog; controls are pulled
 *    from the already-seeded /governance/controls endpoint so reviewers
 *    can only pick from real controls.
 */

const STATUS_TONE: Record<GovernanceExceptionStatus, 'neutral' | 'success' | 'warning' | 'danger'> =
  {
    REQUESTED: 'warning',
    APPROVED: 'success',
    DENIED: 'danger',
    EXPIRED: 'neutral',
    REVOKED: 'danger',
  };

const STATUS_LABEL: Record<GovernanceExceptionStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  DENIED: 'Denied',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
  COMMENTED: 'Commented',
};

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatRelativeExpiry = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
};

const STATUS_FILTER_OPTIONS: Array<{
  id: 'OPEN' | 'ALL' | GovernanceExceptionStatus;
  label: string;
}> = [
  { id: 'OPEN', label: 'Open' },
  { id: 'ALL', label: 'All' },
  { id: 'REQUESTED', label: 'Requested' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'EXPIRED', label: 'Expired' },
  { id: 'DENIED', label: 'Denied' },
  { id: 'REVOKED', label: 'Revoked' },
];

const GovernanceExceptions = () => {
  const [items, setItems] = useState<GovernanceException[]>([]);
  const [controls, setControls] = useState<GovernanceControlListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'ALL' | GovernanceExceptionStatus>('OPEN');
  const [selectedExceptionId, setSelectedExceptionId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<GovernanceExceptionWithEvents | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statuses: GovernanceExceptionStatus[] | undefined =
        statusFilter === 'ALL'
          ? undefined
          : statusFilter === 'OPEN'
            ? ['REQUESTED', 'APPROVED']
            : [statusFilter];
      const [exceptionsResponse, controlsResponse] = await Promise.all([
        listGovernanceExceptions({ status: statuses }),
        listGovernanceControls(),
      ]);
      setItems(exceptionsResponse.items);
      setControls(controlsResponse.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load governance exceptions.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadDetail = useCallback(async (exceptionId: string) => {
    setDetailLoading(true);
    try {
      const detail = await getGovernanceException(exceptionId);
      setSelectedDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load exception detail.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedExceptionId) {
      void loadDetail(selectedExceptionId);
    } else {
      setSelectedDetail(null);
    }
  }, [selectedExceptionId, loadDetail]);

  const statTiles = useMemo(() => {
    const grouped = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
    return [
      {
        label: 'Requested',
        value: String(grouped.REQUESTED ?? 0),
        helper: 'Awaiting review',
        icon: Clock,
      },
      {
        label: 'Approved (active)',
        value: String(grouped.APPROVED ?? 0),
        helper: 'Waiver currently in force',
        icon: CheckCircle2,
      },
      {
        label: 'Expired',
        value: String(grouped.EXPIRED ?? 0),
        helper: 'Auto-closed by scheduler',
        icon: AlertTriangle,
      },
      {
        label: 'Revoked',
        value: String(grouped.REVOKED ?? 0),
        helper: 'Operator-closed before expiry',
        icon: ShieldOff,
      },
    ];
  }, [items]);

  const handleDecision = useCallback(
    async (exceptionId: string, status: 'APPROVED' | 'DENIED', comment?: string) => {
      try {
        const updated = await decideGovernanceException(exceptionId, { status, comment });
        setSelectedDetail(updated);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Decision failed.');
      }
    },
    [reload],
  );

  const handleRevoke = useCallback(
    async (exceptionId: string, comment?: string) => {
      try {
        const updated = await revokeGovernanceException(exceptionId, comment);
        setSelectedDetail(updated);
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Revoke failed.');
      }
    },
    [reload],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Governance"
        title="Exceptions"
        description="Time-bound, auditable waivers of policy decisions. Every transition is recorded; approved exceptions flip matching REQUIRE_APPROVAL verdicts to ALLOW until expiry."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowRequestModal(true)}
            >
              Request exception
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void reload()}
              disabled={loading}
              aria-label="Refresh list"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
            </button>
          </div>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {statTiles.map(tile => (
          <StatTile
            key={tile.label}
            label={tile.label}
            value={tile.value}
            helper={tile.helper}
            icon={tile.icon}
          />
        ))}
      </div>

      <SectionCard
        title="Exceptions"
        description="Open (requested + approved) by default. Use All to see historical decisions."
        action={
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTER_OPTIONS.map(option => (
              <button
                key={option.id}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  statusFilter === option.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/60'
                }`}
                onClick={() => setStatusFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {error && (
          <div className="mb-3 rounded-md border border-error/40 bg-error/5 p-3 text-sm text-error">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-on-surface-variant">
            <Loader2 size={16} className="animate-spin" /> Loading exceptions…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No exceptions match this filter"
            description="Request a new exception from the CTA above, or broaden the filter."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-outline-variant/40">
            <table className="w-full divide-y divide-outline-variant/40 text-sm">
              <thead className="bg-surface-container-low text-left text-xs uppercase tracking-wide text-on-surface-variant">
                <tr>
                  <th className="px-3 py-2">Exception</th>
                  <th className="px-3 py-2">Capability</th>
                  <th className="px-3 py-2">Control</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Expires</th>
                  <th className="px-3 py-2">Requested</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {items.map(item => {
                  const relativeExpiry = formatRelativeExpiry(item.expiresAt);
                  return (
                    <tr
                      key={item.exceptionId}
                      className="cursor-pointer transition hover:bg-surface-container-low/60"
                      onClick={() => setSelectedExceptionId(item.exceptionId)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{item.exceptionId}</td>
                      <td className="px-3 py-2">{item.capabilityId}</td>
                      <td className="px-3 py-2">{item.controlId}</td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={STATUS_TONE[item.status]}>
                          {STATUS_LABEL[item.status]}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2 text-xs text-on-surface-variant">
                        {item.expiresAt ? formatDateTime(item.expiresAt) : '—'}
                        {relativeExpiry && item.status === 'APPROVED' && (
                          <span className="ml-1 text-[11px] text-primary">({relativeExpiry})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-on-surface-variant">
                        <div>{item.requestedBy}</div>
                        <div>{formatDateTime(item.requestedAt)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {selectedExceptionId && (
        <GovernanceExceptionDrawer
          exceptionId={selectedExceptionId}
          detail={selectedDetail}
          loading={detailLoading}
          onClose={() => setSelectedExceptionId(null)}
          onDecide={handleDecision}
          onRevoke={handleRevoke}
        />
      )}

      {showRequestModal && (
        <GovernanceExceptionRequestModal
          controls={controls}
          onClose={() => setShowRequestModal(false)}
          onSubmitted={async () => {
            setShowRequestModal(false);
            await reload();
          }}
        />
      )}
    </div>
  );
};

const GovernanceExceptionDrawer = ({
  exceptionId,
  detail,
  loading,
  onClose,
  onDecide,
  onRevoke,
}: {
  exceptionId: string;
  detail: GovernanceExceptionWithEvents | null;
  loading: boolean;
  onClose: () => void;
  onDecide: (id: string, status: 'APPROVED' | 'DENIED', comment?: string) => Promise<void>;
  onRevoke: (id: string, comment?: string) => Promise<void>;
}) => {
  const [comment, setComment] = useState('');

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="h-full w-full max-w-xl overflow-y-auto bg-surface p-6 shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary"
            onClick={onClose}
          >
            <ChevronLeft size={16} /> Back
          </button>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close drawer">
            <X size={16} />
          </button>
        </header>

        {loading && !detail ? (
          <div className="flex items-center gap-2 text-sm text-on-surface-variant">
            <Loader2 size={16} className="animate-spin" /> Loading {exceptionId}…
          </div>
        ) : !detail ? (
          <EmptyState
            icon={AlertTriangle}
            title="Exception not found"
            description="The exception may have been removed or your session is stale."
          />
        ) : (
          <div className="space-y-5">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <h2 className="text-lg font-semibold">{detail.exceptionId}</h2>
                <StatusBadge tone={STATUS_TONE[detail.status]}>
                  {STATUS_LABEL[detail.status]}
                </StatusBadge>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-on-surface-variant">Capability</dt>
                <dd>{detail.capabilityId}</dd>
                <dt className="text-on-surface-variant">Control</dt>
                <dd>{detail.controlId}</dd>
                <dt className="text-on-surface-variant">Requested by</dt>
                <dd>{detail.requestedBy}</dd>
                <dt className="text-on-surface-variant">Requested at</dt>
                <dd>{formatDateTime(detail.requestedAt)}</dd>
                <dt className="text-on-surface-variant">Expires at</dt>
                <dd>
                  {formatDateTime(detail.expiresAt)}
                  {detail.status === 'APPROVED' && detail.expiresAt && (
                    <span className="ml-1 text-xs text-primary">
                      ({formatRelativeExpiry(detail.expiresAt)})
                    </span>
                  )}
                </dd>
                {detail.decidedBy && (
                  <>
                    <dt className="text-on-surface-variant">Decided by</dt>
                    <dd>
                      {detail.decidedBy} · {formatDateTime(detail.decidedAt)}
                    </dd>
                  </>
                )}
                {detail.revokedBy && (
                  <>
                    <dt className="text-on-surface-variant">Revoked by</dt>
                    <dd>
                      {detail.revokedBy} · {formatDateTime(detail.revokedAt)}
                    </dd>
                  </>
                )}
              </dl>
            </div>

            <div>
              <h3 className="text-sm font-semibold">Reason</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-on-surface-variant">
                {detail.reason}
              </p>
            </div>

            {Object.keys(detail.scopeSelector ?? {}).length > 0 && (
              <div>
                <h3 className="text-sm font-semibold">Scope selector</h3>
                <pre className="mt-1 rounded-md bg-surface-container-low p-3 text-xs">
                  {JSON.stringify(detail.scopeSelector, null, 2)}
                </pre>
              </div>
            )}

            {detail.decisionComment && (
              <div>
                <h3 className="text-sm font-semibold">Decision comment</h3>
                <p className="mt-1 text-sm text-on-surface-variant">{detail.decisionComment}</p>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold">Timeline</h3>
              <ul className="mt-2 space-y-2">
                {detail.events.map(event => (
                  <EventRow key={event.eventId} event={event} />
                ))}
              </ul>
            </div>

            {(detail.status === 'REQUESTED' || detail.status === 'APPROVED') && (
              <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-4">
                <h3 className="text-sm font-semibold">Actions</h3>
                <textarea
                  className="mt-2 w-full rounded-md border border-outline-variant/60 bg-surface p-2 text-sm"
                  rows={2}
                  placeholder="Optional comment"
                  value={comment}
                  onChange={event => setComment(event.target.value)}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {detail.status === 'REQUESTED' && (
                    <>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() =>
                          void onDecide(detail.exceptionId, 'APPROVED', comment || undefined)
                        }
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() =>
                          void onDecide(detail.exceptionId, 'DENIED', comment || undefined)
                        }
                      >
                        Deny
                      </button>
                    </>
                  )}
                  {detail.status === 'APPROVED' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void onRevoke(detail.exceptionId, comment || undefined)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
};

const EventRow = ({ event }: { event: GovernanceExceptionEvent }) => {
  const label = EVENT_TYPE_LABEL[event.eventType] ?? event.eventType;
  return (
    <li className="rounded-lg border border-outline-variant/40 bg-surface p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span className="text-on-surface-variant">{formatDateTime(event.at)}</span>
      </div>
      {event.actorUserId && (
        <div className="mt-1 text-on-surface-variant">By {event.actorUserId}</div>
      )}
      {Object.keys(event.details ?? {}).length > 0 && (
        <pre className="mt-1 rounded-md bg-surface-container-low p-2 text-[11px]">
          {JSON.stringify(event.details, null, 2)}
        </pre>
      )}
    </li>
  );
};

const GovernanceExceptionRequestModal = ({
  controls,
  onClose,
  onSubmitted,
}: {
  controls: GovernanceControlListItem[];
  onClose: () => void;
  onSubmitted: () => Promise<void>;
}) => {
  const [capabilityId, setCapabilityId] = useState('');
  const [controlId, setControlId] = useState(controls[0]?.controlId ?? '');
  const [reason, setReason] = useState('');
  const [toolId, setToolId] = useState('');
  const [expiresAt, setExpiresAt] = useState(() => {
    const defaultExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return defaultExpiry.toISOString().slice(0, 16);
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!capabilityId.trim() || !controlId || !reason.trim() || !expiresAt) {
      setFormError('All fields except tool-id are required.');
      return;
    }
    const iso = new Date(expiresAt).toISOString();
    setSubmitting(true);
    try {
      await requestGovernanceException({
        capabilityId,
        controlId,
        reason,
        scopeSelector: toolId.trim() ? { toolId: toolId.trim() } : {},
        expiresAt: iso,
      });
      await onSubmitted();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <form
        className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl"
        onClick={event => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 className="text-lg font-semibold">Request governance exception</h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          Time-bound waiver of a policy decision. Every field is recorded on the audit event.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="block font-medium">Capability ID</span>
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-outline-variant/60 bg-surface p-2"
              value={capabilityId}
              onChange={e => setCapabilityId(e.target.value)}
              placeholder="CAP-..."
              required
            />
          </label>
          <label className="block text-sm">
            <span className="block font-medium">Control</span>
            <select
              className="mt-1 w-full rounded-md border border-outline-variant/60 bg-surface p-2"
              value={controlId}
              onChange={e => setControlId(e.target.value)}
              required
            >
              {controls.map(control => (
                <option key={control.controlId} value={control.controlId}>
                  {control.controlId} · {control.controlCode} · {control.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="block font-medium">Tool id (optional scope)</span>
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-outline-variant/60 bg-surface p-2"
              value={toolId}
              onChange={e => setToolId(e.target.value)}
              placeholder="run_deploy, workspace_write, ..."
            />
            <span className="mt-1 block text-xs text-on-surface-variant">
              Leave blank for a capability-wide waiver. Recommended to scope to a specific tool.
            </span>
          </label>
          <label className="block text-sm">
            <span className="block font-medium">Reason</span>
            <textarea
              className="mt-1 w-full rounded-md border border-outline-variant/60 bg-surface p-2"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="block font-medium">Expires at</span>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-outline-variant/60 bg-surface p-2"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              required
            />
          </label>
        </div>

        {formError && (
          <div className="mt-3 rounded-md border border-error/40 bg-error/5 p-2 text-sm text-error">
            {formError}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default GovernanceExceptions;
