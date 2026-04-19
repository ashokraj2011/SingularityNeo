import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCcw,
  Scale,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import { listGovernanceControls, getGovernanceControl } from '../lib/api';
import type {
  GovernanceBindingKind,
  GovernanceControlBinding,
  GovernanceControlFramework,
  GovernanceControlListItem,
  GovernanceControlFrameworkSummary,
  GovernanceControlSeverity,
  GovernanceControlWithBindings,
} from '../types';

/**
 * Slice 2 — Governance Controls workspace.
 *
 * Lists the 45 seeded controls across NIST CSF 2.0, SOC 2 TSC, and ISO
 * 27001:2022, and — on drill-in — every binding tying an internal policy
 * surface to that control. This page is read-first: operators inspect,
 * the admin API is called out-of-band for now. Binding creation UI is a
 * follow-up once Slice 3 (exceptions) lands and we have a full
 * request→approve→bind flow worth building in-app.
 */

const FRAMEWORK_LABELS: Record<GovernanceControlFramework, string> = {
  NIST_CSF_2: 'NIST CSF 2.0',
  SOC2_TSC: 'SOC 2 TSC',
  ISO27001_2022: 'ISO 27001:2022',
};

const FRAMEWORK_TAGLINE: Record<GovernanceControlFramework, string> = {
  NIST_CSF_2: 'Cybersecurity Framework 2.0 (2024)',
  SOC2_TSC: 'Trust Services Criteria 2017',
  ISO27001_2022: 'Information security · 2022 rev.',
};

const SEVERITY_TONE: Record<GovernanceControlSeverity, 'neutral' | 'warning'> = {
  STANDARD: 'neutral',
  SEV_1: 'warning',
};

const BINDING_KIND_LABEL: Record<GovernanceBindingKind, string> = {
  POLICY_DECISION: 'Policy decision',
  APPROVAL_FLOW: 'Approval flow',
  SIGNING_REQUIRED: 'Signed attestation',
  EVIDENCE_PACKET: 'Evidence packet',
};

type FrameworkFilter = 'ALL' | GovernanceControlFramework;
type SeverityFilter = 'ALL' | GovernanceControlSeverity;

const formatPolicySelector = (selector: Record<string, unknown>): string => {
  const parts = Object.entries(selector)
    .map(([key, value]) => {
      if (value === null || value === undefined) return `${key}=∅`;
      if (typeof value === 'object') return `${key}=${JSON.stringify(value)}`;
      return `${key}=${String(value)}`;
    })
    .join(' · ');
  return parts || '—';
};

const GovernanceControls = () => {
  const [items, setItems] = useState<GovernanceControlListItem[]>([]);
  const [summary, setSummary] = useState<GovernanceControlFrameworkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [frameworkFilter, setFrameworkFilter] = useState<FrameworkFilter>('ALL');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [search, setSearch] = useState('');

  const [activeControlId, setActiveControlId] = useState<string | null>(null);
  const [activeControl, setActiveControl] = useState<GovernanceControlWithBindings | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listGovernanceControls();
      setItems(res.items);
      setSummary(res.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load controls');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!activeControlId) {
      setActiveControl(null);
      setDrawerError(null);
      return;
    }
    let cancelled = false;
    setDrawerLoading(true);
    setDrawerError(null);
    setActiveControl(null);
    (async () => {
      try {
        const res = await getGovernanceControl(activeControlId);
        if (!cancelled) setActiveControl(res);
      } catch (err) {
        if (!cancelled) setDrawerError(err instanceof Error ? err.message : 'Failed to load control');
      } finally {
        if (!cancelled) setDrawerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeControlId]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter(item => {
      if (frameworkFilter !== 'ALL' && item.framework !== frameworkFilter) return false;
      if (severityFilter !== 'ALL' && item.severity !== severityFilter) return false;
      if (!needle) return true;
      return (
        item.controlCode.toLowerCase().includes(needle) ||
        item.title.toLowerCase().includes(needle) ||
        item.controlFamily.toLowerCase().includes(needle)
      );
    });
  }, [items, frameworkFilter, severityFilter, search]);

  const totalBindings = useMemo(
    () => summary.reduce((acc, row) => acc + row.activeBindings, 0),
    [summary],
  );
  const totalControls = useMemo(
    () => summary.reduce((acc, row) => acc + row.total, 0),
    [summary],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Governance · Slice 2"
        context="Compliance & control mapping"
        title="Governance Controls"
        description="Every policy enforced by this platform is mapped to at least one external control across NIST CSF 2.0, SOC 2 TSC 2017, and ISO/IEC 27001:2022. Open a control to see the bindings that satisfy it."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="action-secondary"
            disabled={loading}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            <span>Refresh</span>
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatTile
          label="Active controls"
          value={loading ? '—' : totalControls}
          helper={`${summary.length} framework${summary.length === 1 ? '' : 's'}`}
          icon={ShieldCheck}
          tone="brand"
        />
        {summary.map(row => (
          <StatTile
            key={row.framework}
            label={FRAMEWORK_LABELS[row.framework]}
            value={row.total}
            helper={`${row.activeBindings} binding${row.activeBindings === 1 ? '' : 's'} · ${FRAMEWORK_TAGLINE[row.framework]}`}
            icon={Scale}
            tone="info"
          />
        ))}
      </div>

      <SectionCard
        icon={Filter}
        title="Controls catalog"
        description={`${filteredItems.length} of ${items.length} controls visible · ${totalBindings} total bindings across all frameworks`}
        action={
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search by code, title, or family…"
              className="h-9 rounded-md border border-outline-variant/60 bg-surface px-3 text-sm"
              aria-label="Search controls"
            />
            <select
              value={frameworkFilter}
              onChange={event => setFrameworkFilter(event.target.value as FrameworkFilter)}
              className="h-9 rounded-md border border-outline-variant/60 bg-surface px-2 text-sm"
              aria-label="Filter by framework"
            >
              <option value="ALL">All frameworks</option>
              {(Object.keys(FRAMEWORK_LABELS) as GovernanceControlFramework[]).map(fw => (
                <option key={fw} value={fw}>
                  {FRAMEWORK_LABELS[fw]}
                </option>
              ))}
            </select>
            <select
              value={severityFilter}
              onChange={event => setSeverityFilter(event.target.value as SeverityFilter)}
              className="h-9 rounded-md border border-outline-variant/60 bg-surface px-2 text-sm"
              aria-label="Filter by severity"
            >
              <option value="ALL">All severities</option>
              <option value="STANDARD">Standard</option>
              <option value="SEV_1">SEV-1</option>
            </select>
          </div>
        }
      >
        {error ? (
          <EmptyState
            icon={ShieldCheck}
            title="Couldn’t load controls"
            description={error}
            action={
              <button type="button" className="action-primary" onClick={() => void load()}>
                Retry
              </button>
            }
          />
        ) : loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-secondary">
            <Loader2 size={16} className="mr-2 animate-spin" /> Loading controls…
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={Filter}
            title="No controls match these filters"
            description="Clear the search or pick a different framework/severity to see more controls."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant/60 text-left text-xs uppercase tracking-wide text-secondary">
                  <th className="py-2 pr-3">Framework</th>
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Title</th>
                  <th className="py-2 pr-3">Family</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2 pr-3">Bindings</th>
                  <th className="py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => (
                  <tr
                    key={item.controlId}
                    className="border-b border-outline-variant/30 align-top hover:bg-surface-container-low"
                  >
                    <td className="py-3 pr-3 text-xs text-secondary">
                      {FRAMEWORK_LABELS[item.framework]}
                    </td>
                    <td className="py-3 pr-3 font-mono text-xs">
                      {item.controlCode}
                    </td>
                    <td className="py-3 pr-3 font-medium text-on-surface">
                      <div>{item.title}</div>
                      <div className="text-xs text-secondary line-clamp-2 max-w-xl">
                        {item.description}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-xs text-secondary">{item.controlFamily}</td>
                    <td className="py-3 pr-3">
                      <StatusBadge tone={SEVERITY_TONE[item.severity]}>
                        {item.severity === 'SEV_1' ? 'SEV-1' : 'Standard'}
                      </StatusBadge>
                    </td>
                    <td className="py-3 pr-3">
                      <StatusBadge tone={item.bindingCount > 0 ? 'success' : 'neutral'}>
                        {item.bindingCount}
                      </StatusBadge>
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <button
                        type="button"
                        onClick={() => setActiveControlId(item.controlId)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                      >
                        Details <ExternalLink size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {activeControlId ? (
        <GovernanceControlDrawer
          control={activeControl}
          loading={drawerLoading}
          error={drawerError}
          onClose={() => setActiveControlId(null)}
        />
      ) : null}
    </div>
  );
};

const GovernanceControlDrawer = ({
  control,
  loading,
  error,
  onClose,
}: {
  control: GovernanceControlWithBindings | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) => {
  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <aside
        className="relative h-full w-full max-w-xl overflow-y-auto bg-surface shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-outline-variant/60 bg-surface/95 px-5 py-4 backdrop-blur">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 text-sm font-medium text-secondary hover:text-on-surface"
          >
            <ChevronLeft size={16} /> Back to catalog
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-secondary hover:bg-surface-container-low hover:text-on-surface"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-6 px-5 py-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-secondary">
              <Loader2 size={16} className="animate-spin" /> Loading control…
            </div>
          ) : error ? (
            <EmptyState icon={ShieldCheck} title="Couldn’t load control" description={error} />
          ) : control ? (
            <>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="brand">
                    {FRAMEWORK_LABELS[control.framework]}
                  </StatusBadge>
                  <StatusBadge tone={SEVERITY_TONE[control.severity]}>
                    {control.severity === 'SEV_1' ? 'SEV-1' : 'Standard'}
                  </StatusBadge>
                  <StatusBadge tone={control.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {control.status}
                  </StatusBadge>
                </div>
                <h2 className="text-xl font-semibold text-on-surface">
                  <span className="font-mono text-base text-secondary">{control.controlCode}</span>{' '}
                  · {control.title}
                </h2>
                <p className="text-xs text-secondary">{control.controlFamily}</p>
                <p className="text-sm leading-relaxed text-on-surface">{control.description}</p>
                <dl className="grid grid-cols-2 gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-xs">
                  <div>
                    <dt className="text-secondary">Control ID</dt>
                    <dd className="font-mono text-on-surface">{control.controlId}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary">Owner role</dt>
                    <dd className="text-on-surface">{control.ownerRole ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary">Seed version</dt>
                    <dd className="text-on-surface">{control.seedVersion ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary">Updated</dt>
                    <dd className="text-on-surface">
                      {new Date(control.updatedAt).toLocaleString()}
                    </dd>
                  </div>
                </dl>
              </div>

              <SectionCard
                title="Policy bindings"
                description={
                  control.bindings.length === 0
                    ? 'No policy bindings yet. An auditor reviewing this control will see it as unbacked by enforcement.'
                    : `Internal surfaces that provide evidence for this control (${control.bindings.length}).`
                }
              >
                {control.bindings.length === 0 ? (
                  <EmptyState
                    icon={Scale}
                    title="No bindings"
                    description="This control is seeded but not yet bound to any internal policy. Add a binding via POST /api/governance/controls/:controlId/bindings."
                  />
                ) : (
                  <ul className="space-y-3">
                    {control.bindings.map(binding => (
                      <BindingRow key={binding.bindingId} binding={binding} />
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
};

const BindingRow = ({ binding }: { binding: GovernanceControlBinding }) => {
  const isSeeded = binding.bindingId.startsWith('GOV-BND-SEED-');
  return (
    <li className="rounded-xl border border-outline-variant/50 bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="info">{BINDING_KIND_LABEL[binding.bindingKind]}</StatusBadge>
        {isSeeded ? (
          <StatusBadge tone="neutral">Seeded</StatusBadge>
        ) : (
          <StatusBadge tone="brand">Operator</StatusBadge>
        )}
        {binding.capabilityScope ? (
          <StatusBadge tone="neutral">Scope · {binding.capabilityScope}</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Global</StatusBadge>
        )}
      </div>
      <div className="mt-2 font-mono text-xs text-on-surface break-all">
        {formatPolicySelector(binding.policySelector)}
      </div>
      <div className="mt-1 text-xs text-secondary">
        {binding.bindingId} · created {new Date(binding.createdAt).toLocaleString()}
        {binding.createdBy ? ` · ${binding.createdBy}` : ''}
      </div>
    </li>
  );
};

export default GovernanceControls;
