import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Search,
  ShieldCheck,
} from 'lucide-react';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import { listProvenanceCoverage, proveNoTouch } from '../lib/api';
import type {
  ProveNoTouchResult,
  ProvenanceActorKind,
  ProvenanceCoverageWindow,
} from '../types';

/**
 * Slice 4 — prove-the-negative provenance workspace.
 *
 * Given a capability, a path glob (e.g. `services/billing/**`), and a time
 * window, the page renders one of three honest answers:
 *
 *   • Green — "No AI touched PATH between T1 and T2" with a full-coverage
 *     confirmation.
 *   • Red — "Yes, PATH was touched" with the matching tool invocations.
 *   • Amber — "Answer is inconclusive: coverage has gaps" listing the
 *     specific sub-windows where logging wasn't running.
 *
 * Never a silent false. The amber state is non-negotiable: prove-the-
 * negative is only useful when the caller can trust "no" as really "no".
 */

const DEFAULT_RANGE_HOURS = 72;

const toDatetimeLocal = (iso: string) => {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
};

const formatDuration = (startIso: string, endIso: string) => {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
};

const ACTOR_OPTIONS: Array<{ id: ProvenanceActorKind; label: string }> = [
  { id: 'AI', label: 'AI' },
  { id: 'HUMAN', label: 'Human' },
  { id: 'ANY', label: 'Any' },
];

const initialRange = () => {
  const now = new Date();
  const from = new Date(now.getTime() - DEFAULT_RANGE_HOURS * 3600 * 1000);
  return {
    from: toDatetimeLocal(from.toISOString()),
    to: toDatetimeLocal(now.toISOString()),
  };
};

const GovernanceProvenance = () => {
  const { from: defaultFrom, to: defaultTo } = initialRange();
  const [capabilityId, setCapabilityId] = useState('');
  const [pathGlob, setPathGlob] = useState('');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [actorKind, setActorKind] = useState<ProvenanceActorKind>('AI');
  const [result, setResult] = useState<ProveNoTouchResult | null>(null);
  const [coverage, setCoverage] = useState<ProvenanceCoverageWindow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tone: 'success' | 'danger' | 'warning' | null = useMemo(() => {
    if (!result) return null;
    if (result.touched) return 'danger';
    if (result.coverage.hasGap) return 'warning';
    return 'success';
  }, [result]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setResult(null);
    if (!capabilityId || !pathGlob || !from || !to) {
      setError('Capability, path glob, from, and to are all required.');
      return;
    }
    setLoading(true);
    try {
      const [proofResult, coverageResult] = await Promise.all([
        proveNoTouch({
          capabilityId,
          pathGlob,
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          actorKind,
        }),
        listProvenanceCoverage(capabilityId),
      ]);
      setResult(proofResult);
      setCoverage(coverageResult.windows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed.');
    } finally {
      setLoading(false);
    }
  }, [capabilityId, pathGlob, from, to, actorKind]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Governance"
        title="Prove the negative"
        description="Ask whether a path was touched by an AI between two points in time. If logging had a gap in the window, the answer is shown as inconclusive — never a silent false."
      />

      <SectionCard
        title="Query"
        description="Glob syntax: `*` within a segment, `**` across segments. Exact paths are accelerated by a GIN index."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-on-surface-variant">Capability ID</span>
            <input
              type="text"
              value={capabilityId}
              onChange={event => setCapabilityId(event.target.value)}
              className="input"
              placeholder="cap-alpha"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-on-surface-variant">Path glob</span>
            <input
              type="text"
              value={pathGlob}
              onChange={event => setPathGlob(event.target.value)}
              className="input"
              placeholder="services/billing/**"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-on-surface-variant">From</span>
            <input
              type="datetime-local"
              value={from}
              onChange={event => setFrom(event.target.value)}
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-on-surface-variant">To</span>
            <input
              type="datetime-local"
              value={to}
              onChange={event => setTo(event.target.value)}
              className="input"
            />
          </label>
          <div className="md:col-span-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-on-surface-variant">Actor kind:</span>
              {ACTOR_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    actorKind === opt.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/60'
                  }`}
                  onClick={() => setActorKind(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={() => void handleSubmit()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Search size={16} />
              )}
              Prove
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-4 rounded-md border border-error/40 bg-error/5 p-3 text-sm text-error">
            {error}
          </div>
        )}
      </SectionCard>

      {result && (
        <SectionCard
          title="Result"
          description={result.summary}
          tone={tone === 'warning' ? 'muted' : 'default'}
        >
          <div className="mb-4 flex items-center gap-3">
            {tone === 'success' && (
              <StatusBadge tone="success">
                <CheckCircle2 size={14} className="mr-1 inline" />
                No touch
              </StatusBadge>
            )}
            {tone === 'danger' && (
              <StatusBadge tone="danger">
                <AlertTriangle size={14} className="mr-1 inline" />
                Touched
              </StatusBadge>
            )}
            {tone === 'warning' && (
              <StatusBadge tone="warning">
                <Clock size={14} className="mr-1 inline" />
                Inconclusive (coverage gap)
              </StatusBadge>
            )}
            <StatTile
              label="Matching invocations"
              value={String(result.matchingInvocations.length)}
            />
            <StatTile
              label="Coverage gap windows"
              value={String(result.coverage.gapWindows.length)}
              tone={result.coverage.hasGap ? 'warning' : 'neutral'}
            />
          </div>

          {result.coverage.hasGap && (
            <div className="mb-4 rounded-md border border-amber-300/60 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
              <div className="mb-2 font-semibold">Coverage gaps in the requested window</div>
              <ul className="space-y-1">
                {result.coverage.gapWindows.map((gap, idx) => (
                  <li key={`${gap.start}-${idx}`}>
                    {formatDateTime(gap.start)} → {formatDateTime(gap.end)}{' '}
                    <span className="text-on-surface-variant">
                      ({formatDuration(gap.start, gap.end)})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.matchingInvocations.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-outline-variant/40">
              <table className="w-full divide-y divide-outline-variant/40 text-sm">
                <thead className="bg-surface-container-low text-left text-xs uppercase tracking-wide text-on-surface-variant">
                  <tr>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Tool</th>
                    <th className="px-3 py-2">Run</th>
                    <th className="px-3 py-2">Actor</th>
                    <th className="px-3 py-2">Paths</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {result.matchingInvocations.map(match => (
                    <tr key={match.toolInvocationId}>
                      <td className="px-3 py-2">{formatDateTime(match.startedAt)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{match.toolId}</td>
                      <td className="px-3 py-2 font-mono text-xs">{match.runId}</td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={match.actorKind === 'HUMAN' ? 'info' : 'brand'}>
                          {match.actorKind}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {match.touchedPaths.join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title={tone === 'warning' ? 'Inconclusive' : 'No AI touched this path'}
              description={
                tone === 'warning'
                  ? 'We can\'t confirm the negative because coverage had gaps. Narrow the window or re-run after backfill.'
                  : 'No matching tool invocation landed in the logged window.'
              }
            />
          )}
        </SectionCard>
      )}

      <SectionCard
        title="Coverage windows"
        description="Periods during which we're confident tool-invocation logging was healthy for the selected capability."
      >
        {coverage.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No coverage windows recorded"
            description="Run the provenance backfill script (`npm run governance:backfill-provenance`) or wait for the first runtime write to seed coverage."
          />
        ) : (
          <ul className="divide-y divide-outline-variant/40 rounded-xl border border-outline-variant/40 text-sm">
            {coverage.map(window => (
              <li key={window.coverageId} className="flex items-center justify-between px-3 py-2">
                <div>
                  <div className="font-medium">
                    {formatDateTime(window.windowStart)} → {formatDateTime(window.windowEnd)}
                  </div>
                  {window.notes && (
                    <div className="text-xs text-on-surface-variant">{window.notes}</div>
                  )}
                </div>
                <StatusBadge tone="neutral">{window.source}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
};

export default GovernanceProvenance;
