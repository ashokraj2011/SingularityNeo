/**
 * Work Item Efficiency Report — /reports/work-items
 *
 * Per-work-item breakdown of AI cost, token usage, elapsed time, human
 * interactions, agent autonomy %, lines of code produced, and documents
 * created.  Each row expands to show an agent-level breakdown with
 * per-agent time, cost, lines of code, and document count.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  BarChart3,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Code2,
  Coins,
  Cpu,
  FileText,
  Loader2,
  RefreshCw,
  Users,
  Zap,
} from 'lucide-react';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import { fetchWorkItemEfficiencySnapshot } from '../lib/api';
import { useCapability } from '../context/CapabilityContext';
import type {
  AgentEfficiencyRow,
  WorkItemEfficiencyRow,
  WorkItemEfficiencySnapshot,
} from '../types';

// ─── Format helpers ────────────────────────────────────────────────────────

const fmt = {
  cost: (v: number) =>
    v === 0 ? '—' : v < 0.01 ? '<$0.01' : `$${v.toFixed(v >= 1 ? 2 : 4)}`,
  tokens: (v: number) =>
    v === 0
      ? '—'
      : v >= 1_000_000
        ? `${(v / 1_000_000).toFixed(1)}M`
        : v >= 1_000
          ? `${(v / 1_000).toFixed(1)}k`
          : String(v),
  hours: (v: number) =>
    v === 0 ? '—' : v < 1 ? `${Math.round(v * 60)}m` : `${v.toFixed(1)}h`,
  count: (v: number) => (v === 0 ? '—' : String(v)),
  loc: (v: number) =>
    v === 0 ? '—' : v >= 1_000 ? `${(v / 1_000).toFixed(1)}k` : String(v),
  pct: (v: number) => `${v}%`,
};

const autonomyTone = (pct: number) => {
  if (pct >= 80) return 'success';
  if (pct >= 50) return 'warning';
  return 'danger';
};

const statusTone = (status: WorkItemEfficiencyRow['status']) => {
  switch (status) {
    case 'ACTIVE':           return 'brand';
    case 'BLOCKED':          return 'danger';
    case 'COMPLETED':        return 'success';
    case 'PENDING_APPROVAL': return 'warning';
    default:                 return 'neutral';
  }
};

const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, High: 0, Med: 1, Low: 2 };

// ─── Sortable column header ────────────────────────────────────────────────

type SortKey = keyof WorkItemEfficiencyRow;
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'title',                 label: 'Work Item',       align: 'left'  },
  { key: 'status',                label: 'Status',          align: 'left'  },
  { key: 'priority',              label: 'Pri',             align: 'left'  },
  { key: 'totalCostUsd',          label: 'Cost',            align: 'right' },
  { key: 'totalTokens',           label: 'Tokens',          align: 'right' },
  { key: 'elapsedHours',          label: 'Elapsed',         align: 'right' },
  { key: 'totalLinesOfCode',      label: 'Lines',           align: 'right' },
  { key: 'totalDocumentsProduced',label: 'Docs',            align: 'right' },
  { key: 'humanInteractions',     label: 'Human touches',   align: 'right' },
  { key: 'runAttempts',           label: 'Attempts',        align: 'right' },
  { key: 'agentAutonomyPct',      label: 'Autonomy',        align: 'right' },
];

const compareRows = (
  a: WorkItemEfficiencyRow,
  b: WorkItemEfficiencyRow,
  key: SortKey,
  dir: SortDir,
): number => {
  let av: string | number = a[key] as string | number;
  let bv: string | number = b[key] as string | number;
  if (key === 'priority') {
    av = priorityOrder[av as string] ?? 99;
    bv = priorityOrder[bv as string] ?? 99;
  }
  // agentBreakdowns is an array — sort by length as a proxy
  if (key === 'agentBreakdowns') {
    av = (a.agentBreakdowns ?? []).length;
    bv = (b.agentBreakdowns ?? []).length;
  }
  if (typeof av === 'string' && typeof bv === 'string') {
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  }
  return dir === 'asc'
    ? (av as number) - (bv as number)
    : (bv as number) - (av as number);
};

const SortTh = ({
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  col: (typeof COLUMNS)[number];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) => {
  const active = sortKey === col.key;
  return (
    <th
      scope="col"
      onClick={() => onSort(col.key)}
      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-[0.15em] transition-colors hover:text-primary ${
        col.align === 'right' ? 'text-right' : 'text-left'
      } ${active ? 'text-primary' : 'text-secondary'}`}
    >
      <span className="inline-flex items-center gap-1">
        {col.label}
        {active ? (
          sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
        ) : (
          <ArrowDownUp size={10} className="opacity-30" />
        )}
      </span>
    </th>
  );
};

// ─── Agent breakdown sub-table ─────────────────────────────────────────────

const AgentBreakdownRow = ({ agent }: { agent: AgentEfficiencyRow }) => (
  <tr className="border-b border-outline-variant/10 bg-surface-container-low/40 text-xs">
    {/* indent spacer for the expand column */}
    <td className="w-8" />
    <td className="py-2 pl-6 pr-3" colSpan={2}>
      <div className="flex items-center gap-2">
        <Bot size={13} className="shrink-0 text-primary/60" />
        <span className="font-semibold text-on-surface">{agent.agentName}</span>
        <code className="truncate text-[0.6125rem] text-outline">{agent.agentId}</code>
      </div>
    </td>
    <td className="px-3 py-2 text-right font-mono text-secondary">
      {fmt.cost(agent.costUsd)}
    </td>
    {/* tokens — not per-agent, leave blank */}
    <td className="px-3 py-2 text-right text-outline">—</td>
    <td className="px-3 py-2 text-right font-mono text-secondary">
      {fmt.hours(agent.elapsedHours)}
    </td>
    <td className="px-3 py-2 text-right font-mono">
      {agent.linesOfCode === 0 ? (
        <span className="text-outline">—</span>
      ) : (
        <span className="text-emerald-700">{fmt.loc(agent.linesOfCode)}</span>
      )}
    </td>
    <td className="px-3 py-2 text-right font-mono">
      {agent.documentsProduced === 0 ? (
        <span className="text-outline">—</span>
      ) : (
        <span className="text-primary">{agent.documentsProduced}</span>
      )}
    </td>
    {/* human touches, attempts, autonomy — not per-agent */}
    <td colSpan={3} />
  </tr>
);

// ─── Main component ────────────────────────────────────────────────────────

const WorkItemReport: React.FC = () => {
  const { activeCapability } = useCapability();

  const [snapshot, setSnapshot] = useState<WorkItemEfficiencySnapshot | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [sortKey, setSortKey]   = useState<SortKey>('totalCostUsd');
  const [sortDir, setSortDir]   = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!activeCapability?.id) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchWorkItemEfficiencySnapshot(activeCapability.id);
      setSnapshot(data);
    } catch (err) {
      setError((err as Error).message || 'Failed to load the efficiency report.');
    } finally {
      setLoading(false);
    }
  }, [activeCapability?.id]);

  useEffect(() => { void load(); }, [load]);

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        const col = COLUMNS.find(c => c.key === key);
        setSortDir(col?.align === 'right' ? 'desc' : 'asc');
      }
    },
    [sortKey],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sortedRows = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.rows].sort((a, b) => compareRows(a, b, sortKey, sortDir));
  }, [snapshot, sortKey, sortDir]);

  if (!activeCapability?.id) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No capability selected"
        description="Select a capability to view its work item efficiency report."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        context={activeCapability.name}
        title="Work Item Efficiency"
        description="Cost, tokens, elapsed time, code output, and agent-level breakdown for every work item. Expand any row to see per-agent contribution."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-2xl border border-outline-variant/50 bg-white px-3 py-2 text-xs font-semibold text-on-surface transition hover:border-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Refresh
          </button>
        }
      />

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* ── Summary stat tiles ─────────────────────────────────────── */}
      {snapshot ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile icon={Coins}   label="Total AI cost"     value={fmt.cost(snapshot.totals.totalCostUsd)}   tone="neutral" />
            <StatTile icon={Cpu}     label="Total tokens"      value={fmt.tokens(snapshot.totals.totalTokens)}  tone="neutral" />
            <StatTile icon={Clock}   label="Avg elapsed"       value={fmt.hours(snapshot.totals.avgElapsedHours)} tone="neutral" />
            <StatTile icon={Users}   label="Avg human touches" value={
              snapshot.totals.avgHumanInteractions === 0
                ? '—'
                : snapshot.totals.avgHumanInteractions.toFixed(1)
            } tone="neutral" />
            <StatTile icon={Zap}     label="Avg autonomy"      value={fmt.pct(snapshot.totals.avgAgentAutonomyPct)}
              tone={autonomyTone(snapshot.totals.avgAgentAutonomyPct)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <StatTile icon={Code2}   label="Total lines of code"    value={fmt.loc(snapshot.totals.totalLinesOfCode)}    tone="success" />
            <StatTile icon={FileText} label="Total documents produced" value={fmt.count(snapshot.totals.totalDocumentsProduced)} tone="brand" />
          </div>
        </>
      ) : null}

      {/* ── Main table ─────────────────────────────────────────────── */}
      <SectionCard title="Work items" icon={BarChart3}>
        {loading && !snapshot ? (
          <div className="flex items-center justify-center gap-2 py-16 text-secondary">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading efficiency data…</span>
          </div>
        ) : !snapshot || snapshot.rows.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No work items yet"
            description="Run a workflow and come back — metrics will appear as the agent executes."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-outline-variant/30">
                  {/* expand toggle col */}
                  <th className="w-8 px-1" />
                  {COLUMNS.map(col => (
                    <SortTh
                      key={col.key}
                      col={col}
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, idx) => {
                  const isExpanded = expanded.has(row.workItemId);
                  const hasAgents  = row.agentBreakdowns && row.agentBreakdowns.length > 0;

                  return (
                    <React.Fragment key={row.workItemId}>
                      <tr
                        className={`border-b border-outline-variant/20 transition-colors hover:bg-surface-container-low/60 ${
                          idx % 2 === 0 ? '' : 'bg-surface-container-low/30'
                        } ${isExpanded ? 'bg-primary/5' : ''}`}
                      >
                        {/* Expand toggle */}
                        <td className="w-8 px-1 py-2.5 text-center">
                          {hasAgents ? (
                            <button
                              type="button"
                              onClick={() => toggleExpand(row.workItemId)}
                              className="flex h-5 w-5 items-center justify-center rounded-md text-secondary transition hover:bg-primary/10 hover:text-primary"
                              title={isExpanded ? 'Collapse agent breakdown' : 'Expand agent breakdown'}
                            >
                              {isExpanded
                                ? <ChevronDown size={13} />
                                : <ChevronRight size={13} />
                              }
                            </button>
                          ) : null}
                        </td>

                        {/* Title + phase */}
                        <td className="max-w-[220px] px-3 py-2.5">
                          <p className="truncate font-medium text-on-surface" title={row.title}>
                            {row.title}
                          </p>
                          <p className="mt-0.5 font-mono text-[0.625rem] text-secondary">
                            {row.phase}
                          </p>
                        </td>

                        {/* Status */}
                        <td className="px-3 py-2.5">
                          <StatusBadge tone={statusTone(row.status)}>
                            {row.status}
                          </StatusBadge>
                        </td>

                        {/* Priority */}
                        <td className="px-3 py-2.5">
                          <StatusBadge
                            tone={
                              row.priority === 'High'
                                ? 'danger'
                                : row.priority === 'Med'
                                  ? 'warning'
                                  : 'neutral'
                            }
                          >
                            {row.priority}
                          </StatusBadge>
                        </td>

                        {/* Cost */}
                        <td className="px-3 py-2.5 text-right font-mono text-[0.8125rem] text-on-surface">
                          {fmt.cost(row.totalCostUsd)}
                        </td>

                        {/* Tokens */}
                        <td className="px-3 py-2.5 text-right font-mono text-[0.8125rem] text-on-surface">
                          {fmt.tokens(row.totalTokens)}
                        </td>

                        {/* Elapsed */}
                        <td className="px-3 py-2.5 text-right font-mono text-[0.8125rem] text-on-surface">
                          {fmt.hours(row.elapsedHours)}
                        </td>

                        {/* Lines of code */}
                        <td className="px-3 py-2.5 text-right font-mono text-[0.8125rem]">
                          {row.totalLinesOfCode === 0 ? (
                            <span className="text-secondary">—</span>
                          ) : (
                            <span className="text-emerald-700">
                              {fmt.loc(row.totalLinesOfCode)}
                            </span>
                          )}
                        </td>

                        {/* Documents */}
                        <td className="px-3 py-2.5 text-right font-mono text-[0.8125rem]">
                          {row.totalDocumentsProduced === 0 ? (
                            <span className="text-secondary">—</span>
                          ) : (
                            <span className="text-primary">
                              {row.totalDocumentsProduced}
                            </span>
                          )}
                        </td>

                        {/* Human interactions */}
                        <td className="px-3 py-2.5 text-right font-mono text-[0.8125rem]">
                          <span
                            className={
                              row.humanInteractions === 0
                                ? 'text-secondary'
                                : row.humanInteractions > 3
                                  ? 'text-amber-700'
                                  : 'text-on-surface'
                            }
                          >
                            {fmt.count(row.humanInteractions)}
                          </span>
                        </td>

                        {/* Attempts */}
                        <td className="px-3 py-2.5 text-right font-mono text-[0.8125rem]">
                          <span
                            className={
                              row.runAttempts <= 1
                                ? 'text-secondary'
                                : row.runAttempts >= 3
                                  ? 'text-rose-700'
                                  : 'text-amber-700'
                            }
                          >
                            {fmt.count(row.runAttempts)}
                          </span>
                        </td>

                        {/* Autonomy */}
                        <td className="px-3 py-2.5 text-right">
                          {row.runAttempts === 0 ? (
                            <span className="text-[0.8125rem] text-secondary">—</span>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <div className="hidden w-14 overflow-hidden rounded-full bg-outline-variant/20 sm:block">
                                <div
                                  className={`h-1.5 rounded-full transition-all ${
                                    row.agentAutonomyPct >= 80
                                      ? 'bg-emerald-500'
                                      : row.agentAutonomyPct >= 50
                                        ? 'bg-amber-400'
                                        : 'bg-rose-500'
                                  }`}
                                  style={{ width: `${row.agentAutonomyPct}%` }}
                                />
                              </div>
                              <StatusBadge tone={autonomyTone(row.agentAutonomyPct)}>
                                {fmt.pct(row.agentAutonomyPct)}
                              </StatusBadge>
                            </div>
                          )}
                        </td>
                      </tr>

                      {/* Agent breakdown rows (visible when expanded) */}
                      {isExpanded && hasAgents
                        ? row.agentBreakdowns.map(agent => (
                            <AgentBreakdownRow key={agent.agentId} agent={agent} />
                          ))
                        : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            <div className="flex items-center justify-between border-t border-outline-variant/20 px-3 py-2 text-[0.6875rem] text-secondary">
              <span>
                {snapshot.rows.length} work item{snapshot.rows.length === 1 ? '' : 's'} ·
                generated{' '}
                {new Date(snapshot.generatedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span>
                Click <ChevronRight size={11} className="inline" /> to expand agent breakdown ·
                click any column header to sort
              </span>
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Legend ─────────────────────────────────────────────────── */}
      <SectionCard title="How to read this report" tone="muted">
        <div className="grid gap-x-8 gap-y-2 text-xs text-secondary sm:grid-cols-2 lg:grid-cols-3">
          <p>
            <span className="font-semibold text-on-surface">Cost</span> — sum of AI model
            charges across all agent steps for this work item.
          </p>
          <p>
            <span className="font-semibold text-on-surface">Tokens</span> — total prompt +
            completion tokens consumed.
          </p>
          <p>
            <span className="font-semibold text-on-surface">Elapsed</span> — wall-clock time
            from first run start to last run end (includes human wait time).
          </p>
          <p>
            <span className="font-semibold text-on-surface">Lines</span> — estimated lines
            written by all agents: counted from the{' '}
            <code className="rounded bg-surface-container px-1">content</code> /
            <code className="rounded bg-surface-container px-1">new_content</code> fields of
            workspace write/patch tool invocations.
          </p>
          <p>
            <span className="font-semibold text-on-surface">Docs</span> — substantive
            artifacts produced (phase outputs, code patches, handoff packets, evidence packets,
            execution plans, review packets, execution summaries).
          </p>
          <p>
            <span className="font-semibold text-on-surface">Human touches</span> — count of
            approval gates, input requests, and conflict resolutions triggered.
          </p>
          <p>
            <span className="font-semibold text-on-surface">Autonomy %</span> — (elapsed −
            human wait) ÷ elapsed × 100. Higher is better.
          </p>
          <p>
            <span className="font-semibold text-on-surface">Agent breakdown</span> — click the{' '}
            <ChevronRight size={11} className="inline" /> on any row to see per-agent time,
            cost, lines of code, and documents. Sorted by most time spent first.
          </p>
        </div>
      </SectionCard>
    </div>
  );
};

export default WorkItemReport;
