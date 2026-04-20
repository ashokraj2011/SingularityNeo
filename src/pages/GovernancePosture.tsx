import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileBadge,
  Gauge,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import { fetchGovernancePosture } from '../lib/api';
import type { GovernancePostureSnapshot } from '../types';

/**
 * Slice 5 — governance posture dashboard.
 *
 * Read-only aggregation of the four earlier slices' tables:
 *   • Signer health + signed-packet ratio (Slice 1)
 *   • Control catalog coverage per framework (Slice 2)
 *   • Active / expiring-soon exceptions (Slice 3)
 *   • Provenance coverage + unmapped-tool shape check (Slice 4)
 *   • Recent denied policy decisions joined to bindings → control_id
 *
 * Every number here is answerable on a slice-specific page already; this
 * view exists so an operator (or an auditor on a screen-share) gets one
 * glance that says "posture is fine" or points at the exact red flag.
 */

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

const formatPercent = (ratio: number | null | undefined) => {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)}%`;
};

const formatInt = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

const FRAMEWORK_LABELS: Record<string, string> = {
  NIST_CSF_2: 'NIST CSF 2.0',
  SOC2_TSC: 'SOC 2 TSC',
  ISO27001_2022: 'ISO/IEC 27001:2022',
};

const labelFramework = (id: string) => FRAMEWORK_LABELS[id] ?? id;

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  APPROVED: 'success',
  DENIED: 'danger',
  EXPIRED: 'warning',
  REVOKED: 'warning',
  REQUESTED: 'neutral',
};

export default function GovernancePosture() {
  const [snapshot, setSnapshot] = useState<GovernancePostureSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedDenialIds, setExpandedDenialIds] = useState<Set<string>>(() => new Set());

  const toggleDenial = useCallback((decisionId: string) => {
    setExpandedDenialIds(prev => {
      const next = new Set(prev);
      if (next.has(decisionId)) next.delete(decisionId);
      else next.add(decisionId);
      return next;
    });
  }, []);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const result = await fetchGovernancePosture();
      setSnapshot(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posture');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  const signerTone: 'success' | 'warning' | 'danger' = useMemo(() => {
    if (!snapshot) return 'warning';
    const { configured } = snapshot.signer.status;
    if (!configured) return 'danger';
    const { total, signedRatio } = snapshot.signer.recentPackets;
    if (total === 0) return 'warning';
    if (signedRatio >= 0.99) return 'success';
    if (signedRatio >= 0.9) return 'warning';
    return 'danger';
  }, [snapshot]);

  const coverageTone: 'success' | 'warning' | 'danger' = useMemo(() => {
    if (!snapshot) return 'warning';
    const ratio = snapshot.controls.coverageRatio;
    if (ratio >= 0.8) return 'success';
    if (ratio >= 0.5) return 'warning';
    return 'danger';
  }, [snapshot]);

  const exceptionsTone: 'success' | 'warning' | 'danger' = useMemo(() => {
    if (!snapshot) return 'neutral' as 'warning';
    if (snapshot.exceptions.expiringSoon > 0) return 'warning';
    if (snapshot.exceptions.active > 0) return 'warning';
    return 'success';
  }, [snapshot]);

  const provenanceTone: 'success' | 'warning' | 'danger' = useMemo(() => {
    if (!snapshot) return 'warning';
    if (!snapshot.provenance.enabled) return 'warning';
    if (snapshot.provenance.capabilitiesWithCoverage === 0) return 'warning';
    return 'success';
  }, [snapshot]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Governance"
        context="Compliance posture"
        title="Posture Dashboard"
        description="A single-page snapshot of signer health, control coverage, active exceptions, and provenance integrity — read-only over the audit tables."
        actions={
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void load('refresh')}
            disabled={refreshing || loading}
          >
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            <span>Refresh</span>
          </button>
        }
      />

      {loading ? (
        <SectionCard title="Loading posture" icon={Loader2}>
          <div className="flex items-center gap-3 py-8 text-secondary">
            <Loader2 size={18} className="animate-spin" />
            <span>Aggregating governance signals…</span>
          </div>
        </SectionCard>
      ) : error ? (
        <SectionCard title="Posture unavailable" icon={AlertTriangle} tone="muted">
          <EmptyState
            title="Could not load posture snapshot"
            description={error}
            icon={AlertTriangle}
          />
        </SectionCard>
      ) : !snapshot ? null : (
        <>
          {snapshot.warnings.length > 0 ? (
            <SectionCard
              title="Degraded signals"
              description="One or more subsystems returned a warning. The tile below this row reflects available data only."
              icon={AlertTriangle}
              tone="muted"
            >
              <ul className="space-y-1 text-sm text-amber-800">
                {snapshot.warnings.map(msg => (
                  <li key={msg} className="flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <code className="break-all">{msg}</code>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Signer"
              value={
                snapshot.signer.status.configured
                  ? formatPercent(snapshot.signer.recentPackets.signedRatio)
                  : 'Unconfigured'
              }
              helper={
                snapshot.signer.status.configured
                  ? `${formatInt(snapshot.signer.recentPackets.signed)} / ${formatInt(snapshot.signer.recentPackets.total)} packets signed (${snapshot.signer.recentPackets.windowDays}d)`
                  : 'No active signing key — new packets land unsigned'
              }
              icon={KeyRound}
              tone={signerTone}
            />
            <StatTile
              label="Control coverage"
              value={formatPercent(snapshot.controls.coverageRatio)}
              helper={`${formatInt(snapshot.controls.boundControls)} of ${formatInt(snapshot.controls.totalControls)} controls bound`}
              icon={Gauge}
              tone={coverageTone}
            />
            <StatTile
              label="Active exceptions"
              value={formatInt(snapshot.exceptions.active)}
              helper={
                snapshot.exceptions.expiringSoon > 0
                  ? `${formatInt(snapshot.exceptions.expiringSoon)} expire in <${snapshot.exceptions.expiringSoonHours}h`
                  : snapshot.exceptions.enabled
                    ? 'No waivers expiring soon'
                    : 'Policy hook disabled — waivers don\u2019t flip decisions'
              }
              icon={ShieldAlert}
              tone={exceptionsTone}
            />
            <StatTile
              label="Provenance"
              value={
                snapshot.provenance.enabled
                  ? `${formatInt(snapshot.provenance.capabilitiesWithCoverage)} caps`
                  : 'Disabled'
              }
              helper={
                snapshot.provenance.enabled
                  ? `${formatInt(snapshot.provenance.coverageWindowCount)} coverage windows on record`
                  : 'GOVERNANCE_PROVENANCE_ENABLED=false — prove-no-touch returns inconclusive'
              }
              icon={ShieldCheck}
              tone={provenanceTone}
            />
          </div>

          <SectionCard
            title="Control coverage by framework"
            description="A control counts as bound when at least one policy binding references it. Unbound controls are the audit-hot targets."
            icon={Gauge}
          >
            {snapshot.controls.byFramework.length === 0 ? (
              <EmptyState
                title="No controls seeded yet"
                description="Run the bootstrap to seed the framework catalog, then bind active policies from /governance/controls."
                icon={FileBadge}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {snapshot.controls.byFramework.map(framework => {
                  const pct = framework.coverageRatio;
                  const tone: 'success' | 'warning' | 'danger' =
                    pct >= 0.8 ? 'success' : pct >= 0.5 ? 'warning' : 'danger';
                  return (
                    <div
                      key={framework.framework}
                      className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-on-surface">
                          {labelFramework(framework.framework)}
                        </span>
                        <StatusBadge tone={tone}>{formatPercent(pct)}</StatusBadge>
                      </div>
                      <p className="text-xs text-secondary">
                        {formatInt(framework.bound)} / {formatInt(framework.total)} controls bound
                      </p>
                      <div className="h-1.5 rounded-full bg-surface-container-high">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(4, Math.round(pct * 100))}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="Recent exception decisions"
              description="Last 10 exceptions that reached a terminal state."
              icon={ShieldAlert}
            >
              {snapshot.exceptions.recentDecisions.length === 0 ? (
                <EmptyState
                  title="No recent decisions"
                  description="Exceptions raised through /governance/exceptions will appear here once approved or denied."
                  icon={ShieldAlert}
                />
              ) : (
                <div className="space-y-2">
                  {snapshot.exceptions.recentDecisions.map(decision => (
                    <div
                      key={decision.exceptionId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-outline-variant/40 bg-surface-container-low p-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={STATUS_TONE[decision.status] ?? 'neutral'}>
                            {decision.status}
                          </StatusBadge>
                          <code className="text-xs text-secondary">{decision.exceptionId}</code>
                        </div>
                        <p className="text-xs text-secondary">
                          <span className="font-medium text-on-surface">{decision.controlId}</span>
                          {' · '}
                          {decision.capabilityId}
                          {decision.decidedBy ? ` · by ${decision.decidedBy}` : ''}
                        </p>
                      </div>
                      <div className="text-right text-xs text-secondary">
                        <div>{formatDateTime(decision.decidedAt)}</div>
                        {decision.expiresAt ? (
                          <div className="flex items-center gap-1 text-amber-700">
                            <Clock size={12} />
                            expires {formatDateTime(decision.expiresAt)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Recent non-ALLOW decisions"
              description="Last 50 REQUIRE_APPROVAL / DENY outcomes joined to the bound control_id."
              icon={ShieldAlert}
            >
              {snapshot.recentDenials.length === 0 ? (
                <EmptyState
                  title="No recent denials"
                  description="Every policy decision in the audit window resolved to ALLOW."
                  icon={CheckCircle2}
                />
              ) : (
                <div className="max-h-[28rem] overflow-y-auto space-y-2 pr-1">
                  {snapshot.recentDenials.map(row => {
                    const isExpanded = expandedDenialIds.has(row.decisionId);
                    return (
                      <div
                        key={row.decisionId}
                        className="rounded-xl border border-outline-variant/40 bg-surface-container-low text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => toggleDenial(row.decisionId)}
                          aria-expanded={isExpanded}
                          className="flex w-full items-start gap-2 p-3 text-left hover:bg-surface-container"
                        >
                          {isExpanded ? (
                            <ChevronDown size={14} className="mt-0.5 flex-shrink-0 text-secondary" />
                          ) : (
                            <ChevronRight size={14} className="mt-0.5 flex-shrink-0 text-secondary" />
                          )}
                          <div className="flex-1 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <StatusBadge
                                  tone={row.decision === 'DENY' ? 'danger' : 'warning'}
                                >
                                  {row.decision}
                                </StatusBadge>
                                <span className="font-medium text-on-surface">{row.actionType}</span>
                                {row.controlId ? (
                                  <code className="text-secondary">{row.controlId}</code>
                                ) : (
                                  <span className="text-secondary italic">unbound</span>
                                )}
                                {row.exceptionId ? (
                                  <StatusBadge tone="info">via exception</StatusBadge>
                                ) : null}
                              </div>
                              <span className="text-secondary">{formatDateTime(row.createdAt)}</span>
                            </div>
                            <p className="text-secondary">{row.reason}</p>
                          </div>
                        </button>
                        {isExpanded ? (
                          <div className="border-t border-outline-variant/30 bg-white p-3">
                            <dl className="grid grid-cols-[max-content,1fr] gap-x-3 gap-y-1 text-secondary">
                              <dt className="font-semibold uppercase tracking-[0.12em] text-outline">
                                Decision
                              </dt>
                              <dd className="font-mono text-[11px]">{row.decisionId}</dd>
                              <dt className="font-semibold uppercase tracking-[0.12em] text-outline">
                                Capability
                              </dt>
                              <dd className="font-mono text-[11px]">{row.capabilityId}</dd>
                              {row.controlId ? (
                                <>
                                  <dt className="font-semibold uppercase tracking-[0.12em] text-outline">
                                    Control
                                  </dt>
                                  <dd className="font-mono text-[11px]">{row.controlId}</dd>
                                </>
                              ) : null}
                              {row.exceptionId ? (
                                <>
                                  <dt className="font-semibold uppercase tracking-[0.12em] text-outline">
                                    Exception
                                  </dt>
                                  <dd className="font-mono text-[11px]">{row.exceptionId}</dd>
                                </>
                              ) : null}
                            </dl>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Link
                                to="/ledger"
                                className="inline-flex items-center gap-1 rounded-full border border-outline-variant/60 bg-white px-2.5 py-1 text-[11px] font-semibold text-on-surface hover:bg-surface-container-low"
                              >
                                <ExternalLink size={11} />
                                <span>Open in Ledger</span>
                              </Link>
                              {row.controlId ? (
                                <Link
                                  to="/governance/controls"
                                  className="inline-flex items-center gap-1 rounded-full border border-outline-variant/60 bg-white px-2.5 py-1 text-[11px] font-semibold text-on-surface hover:bg-surface-container-low"
                                >
                                  <ExternalLink size={11} />
                                  <span>View control</span>
                                </Link>
                              ) : null}
                              {row.exceptionId ? (
                                <Link
                                  to="/governance/exceptions"
                                  className="inline-flex items-center gap-1 rounded-full border border-outline-variant/60 bg-white px-2.5 py-1 text-[11px] font-semibold text-on-surface hover:bg-surface-container-low"
                                >
                                  <ExternalLink size={11} />
                                  <span>View exception</span>
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="Provenance health"
            description="Coverage windows declare when tool-invocation logging was known to be running. Tools without a path extractor still write invocations but land with empty touched_paths."
            icon={ShieldCheck}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4">
                <h3 className="text-sm font-semibold text-on-surface">Coverage window</h3>
                <p className="text-xs text-secondary">
                  Earliest: <span className="text-on-surface">{formatDateTime(snapshot.provenance.earliestWindowStart)}</span>
                </p>
                <p className="text-xs text-secondary">
                  Latest: <span className="text-on-surface">{formatDateTime(snapshot.provenance.latestWindowEnd)}</span>
                </p>
                <p className="text-xs text-secondary">
                  Capabilities with coverage rows: <span className="text-on-surface">{formatInt(snapshot.provenance.capabilitiesWithCoverage)}</span>
                </p>
              </div>
              <div className="space-y-2 rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4">
                <h3 className="text-sm font-semibold text-on-surface">Empty-path invocations (last 7d)</h3>
                <p className="text-[11px] text-secondary">
                  Shape-check only — filesystem-inert tools (e.g. <code>run_build</code>) legitimately land with <code>[]</code>. Drift telemetry lives on the <code>governance.provenance_unmapped_tool</code> metric.
                </p>
                {snapshot.provenance.unmappedToolSamples.length === 0 ? (
                  <p className="text-xs text-secondary">None observed.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {snapshot.provenance.unmappedToolSamples.map(sample => (
                      <li key={sample.toolId} className="flex items-center justify-between">
                        <code className="text-on-surface">{sample.toolId}</code>
                        <span className="text-secondary">{formatInt(sample.sampleCount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </SectionCard>

          <p className="text-center text-[11px] text-secondary">
            Snapshot generated {formatDateTime(snapshot.generatedAt)}
          </p>
        </>
      )}
    </div>
  );
}
