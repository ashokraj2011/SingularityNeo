import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlarmClock,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  Loader2,
  PauseCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useCapability } from "../../../context/CapabilityContext";
import { useToast } from "../../../context/ToastContext";
import {
  fetchBusinessTemplateStats,
  fetchBusinessWorkflow,
  listBusinessInstances,
} from "../../../lib/api";
import { cn } from "../../../lib/utils";
import type {
  BusinessInstanceStatus,
  BusinessWorkflowInstance,
} from "../../../contracts/businessWorkflow";

/**
 * Per-template status report: KPIs across every instance, plus a paged
 * table of recent instances with quick-link to the dashboard.
 *
 * Polling is gentle (15s) — this page is for "where are we across the
 * whole template", not real-time monitoring of one instance.
 */

const STATUS_TONE: Record<BusinessInstanceStatus, string> = {
  RUNNING: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  PAUSED: "bg-amber-100 text-amber-800 ring-amber-300",
  COMPLETED: "bg-slate-200 text-slate-700 ring-slate-300",
  CANCELLED: "bg-rose-100 text-rose-700 ring-rose-300",
  FAILED: "bg-orange-100 text-orange-800 ring-orange-300",
};

const formatDuration = (ms: number | null): string => {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
};

const formatDelta = (ms: number): string => {
  if (ms < 1000) return "now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

export const StatusReport = () => {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { activeCapability } = useCapability();
  const { error: toastError } = useToast();

  const [templateName, setTemplateName] = useState("");
  const [stats, setStats] = useState<{
    byStatus: Record<BusinessInstanceStatus, number>;
    avgDurationMs: number | null;
    overdueTaskCount: number;
    pendingApprovalCount: number;
    recentInstances: BusinessWorkflowInstance[];
  } | null>(null);
  const [instances, setInstances] = useState<BusinessWorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<
    BusinessInstanceStatus | "ALL" | "ACTIVE"
  >("ALL");

  const capabilityId = activeCapability.id;

  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [tpl, st, inst] = await Promise.all([
          fetchBusinessWorkflow(capabilityId, templateId),
          fetchBusinessTemplateStats(capabilityId, templateId),
          listBusinessInstances(capabilityId, {
            templateId,
            status: filterStatus === "ALL" ? undefined : filterStatus,
            limit: 50,
          }),
        ]);
        if (cancelled) return;
        setTemplateName(tpl.template.name);
        setStats(st);
        setInstances(inst.rows);
      } catch (err) {
        if (cancelled) return;
        toastError(
          "Couldn't load status",
          err instanceof Error ? err.message : "Unknown error",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [capabilityId, templateId, filterStatus, toastError]);

  const totalInstances = useMemo(() => {
    if (!stats) return 0;
    return Object.values(stats.byStatus).reduce((a, b) => a + b, 0);
  }, [stats]);

  if (loading || !stats) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-secondary">
        <Loader2 size={14} className="mr-2 animate-spin" />
        Loading status…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex items-center gap-2 border-b border-outline-variant/30 bg-surface-container-low px-4 py-2">
        <button
          type="button"
          onClick={() =>
            navigate(
              `/studio/business-workflows/${encodeURIComponent(templateId || "")}`,
            )
          }
          className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-white px-2 py-1 text-[0.7rem] hover:bg-surface-container"
        >
          <ArrowLeft size={11} /> Studio
        </button>
        <div className="min-w-0">
          <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
            Status report
          </p>
          <h1 className="truncate text-sm font-semibold text-on-surface">
            {templateName}
          </h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Kpi
            Icon={CircleDot}
            tone="emerald"
            label="Running"
            value={stats.byStatus.RUNNING}
          />
          <Kpi
            Icon={PauseCircle}
            tone="amber"
            label="Paused"
            value={stats.byStatus.PAUSED}
          />
          <Kpi
            Icon={CheckCircle2}
            tone="slate"
            label="Completed"
            value={stats.byStatus.COMPLETED}
          />
          <Kpi
            Icon={XCircle}
            tone="rose"
            label="Cancelled"
            value={stats.byStatus.CANCELLED}
          />
          <Kpi
            Icon={ShieldCheck}
            tone="indigo"
            label="Pending approvals"
            value={stats.pendingApprovalCount}
          />
          <Kpi
            Icon={AlarmClock}
            tone={stats.overdueTaskCount > 0 ? "rose" : "slate"}
            label="Overdue tasks"
            value={stats.overdueTaskCount}
          />
        </div>

        {/* Avg duration */}
        <div className="mt-3 rounded-lg border border-outline-variant/30 bg-white p-3">
          <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
            Average duration (completed instances)
          </p>
          <p className="mt-1 text-2xl font-semibold text-on-surface">
            {formatDuration(stats.avgDurationMs)}
          </p>
          <p className="text-[0.65rem] text-outline">
            across {stats.byStatus.COMPLETED} completed run
            {stats.byStatus.COMPLETED === 1 ? "" : "s"}
          </p>
        </div>

        {/* Filters */}
        <div className="mt-4 flex items-center gap-1.5">
          <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
            Instances ({totalInstances})
          </p>
          <span className="ml-2 inline-flex gap-1">
            {(
              ["ALL", "ACTIVE", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED"] as const
            ).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterStatus(f)}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[0.6rem] font-semibold ring-1",
                  filterStatus === f
                    ? "bg-primary/10 text-primary ring-primary"
                    : "text-outline ring-outline-variant/40 hover:text-on-surface",
                )}
              >
                {f}
              </button>
            ))}
          </span>
        </div>

        {/* Instance table */}
        <div className="mt-2 overflow-hidden rounded-lg border border-outline-variant/30 bg-white">
          {instances.length === 0 ? (
            <p className="p-4 text-center text-[0.7rem] text-outline">
              No instances match this filter.
            </p>
          ) : (
            <table className="w-full text-[0.7rem]">
              <thead className="bg-surface-container-low text-left">
                <tr className="text-[0.6rem] uppercase tracking-wider text-outline">
                  <th className="px-3 py-1.5">Instance</th>
                  <th className="px-3 py-1.5">Status</th>
                  <th className="px-3 py-1.5">Started by</th>
                  <th className="px-3 py-1.5">Started</th>
                  <th className="px-3 py-1.5">Runtime</th>
                  <th className="px-3 py-1.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {instances.map((inst) => {
                  const startedMs = Date.parse(inst.startedAt);
                  const endedMs = inst.completedAt
                    ? Date.parse(inst.completedAt)
                    : Date.now();
                  return (
                    <tr key={inst.id} className="hover:bg-surface-container">
                      <td className="px-3 py-1.5 font-mono text-[0.62rem] text-outline">
                        {inst.id}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.55rem] font-bold uppercase ring-1",
                            STATUS_TONE[inst.status],
                          )}
                        >
                          {inst.status}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-on-surface">
                        {inst.startedBy}
                      </td>
                      <td className="px-3 py-1.5 text-outline">
                        {formatDelta(Date.now() - startedMs)}
                      </td>
                      <td className="px-3 py-1.5 text-outline">
                        {formatDuration(endedMs - startedMs)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/studio/business-workflows/${encodeURIComponent(
                                inst.templateId,
                              )}/instances/${encodeURIComponent(inst.id)}`,
                            )
                          }
                          className="rounded border border-outline-variant/40 bg-white px-2 py-0.5 text-[0.62rem] hover:bg-surface-container"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

const Kpi = ({
  Icon,
  tone,
  label,
  value,
}: {
  Icon: typeof CircleDot;
  tone: "emerald" | "amber" | "slate" | "rose" | "indigo";
  label: string;
  value: number;
}) => {
  const map: Record<string, string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
  };
  return (
    <div className={cn("rounded-lg border p-2", map[tone])}>
      <div className="flex items-center gap-1.5">
        <Icon size={12} />
        <p className="text-[0.6rem] font-semibold uppercase tracking-wider opacity-90">
          {label}
        </p>
      </div>
      <p className="mt-1 text-2xl font-semibold leading-none">{value}</p>
    </div>
  );
};

export default StatusReport;
