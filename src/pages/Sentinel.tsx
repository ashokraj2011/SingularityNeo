/**
 * Sentinel Mode — Zero-Prompt Autonomous Security Remediation dashboard.
 *
 * Route: /sentinel
 *
 * Shows: active sentinel missions with their pipeline stages, a form to
 * manually trigger a new alert, and a direct link to the generated
 * Release Passport when a mission reaches WAITING_APPROVAL.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  ExternalLink,
  GitMerge,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Siren,
  XCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
  StatTile,
} from '../components/EnterpriseUI';
import {
  fetchSentinelMissions,
  triggerSentinelAlert,
  type SentinelAlertSeverity,
  type SentinelMissionStatus,
} from '../lib/api';
import { useCapability } from '../context/CapabilityContext';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_TONE: Record<SentinelAlertSeverity, React.ComponentProps<typeof StatusBadge>['tone']> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'warning',
  LOW: 'neutral',
};

const STATUS_META: Record<string, { icon: React.ElementType; tone: React.ComponentProps<typeof StatusBadge>['tone']; label: string }> = {
  DISPATCHED:       { icon: Cpu,          tone: 'info',    label: 'Dispatched'        },
  ACTIVE:           { icon: Cpu,          tone: 'info',    label: 'Running'           },
  WAITING_APPROVAL: { icon: ShieldCheck,  tone: 'warning', label: 'Awaiting Approval' },
  PENDING_APPROVAL: { icon: ShieldCheck,  tone: 'warning', label: 'Awaiting Approval' },
  COMPLETE:         { icon: CheckCircle2, tone: 'success', label: 'Complete'          },
  COMPLETED:        { icon: CheckCircle2, tone: 'success', label: 'Complete'          },
  CANCELLED:        { icon: XCircle,      tone: 'neutral', label: 'Cancelled'         },
  FAILED:           { icon: AlertTriangle,tone: 'danger',  label: 'Failed'            },
};

const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const stageForStatus = (status: string): number => {
  if (['DISPATCHED', 'ACTIVE', 'PENDING'].includes(status)) return 1;
  if (['WAITING_APPROVAL', 'PENDING_APPROVAL'].includes(status)) return 2;
  if (['COMPLETE', 'COMPLETED'].includes(status)) return 3;
  return 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mission stage timeline
// ─────────────────────────────────────────────────────────────────────────────

const STAGES = [
  {
    n: 1,
    icon: Siren,
    label: 'Event Trigger',
    title: 'Webhook Received',
    dotClass: 'bg-red-100 text-red-600 border-red-300',
    activeDotClass: 'bg-red-50 text-red-500 ring-2 ring-red-200',
  },
  {
    n: 2,
    icon: Cpu,
    label: 'Autonomous Response',
    title: 'Pipeline Execution',
    dotClass: 'bg-blue-100 text-blue-600 border-blue-300',
    activeDotClass: 'bg-blue-50 text-blue-500 ring-2 ring-blue-200',
  },
  {
    n: 3,
    icon: CheckCircle2,
    label: 'Human-in-the-Loop',
    title: 'Payload Delivery',
    dotClass: 'bg-emerald-100 text-emerald-600 border-emerald-300',
    activeDotClass: 'bg-emerald-50 text-emerald-500 ring-2 ring-emerald-200',
  },
] as const;

const MissionCard = ({ mission }: { mission: SentinelMissionStatus }) => {
  const stage = stageForStatus(mission.status);
  const statusMeta = STATUS_META[mission.status] ?? STATUS_META.DISPATCHED;

  return (
    <div className="rounded-xl border border-outline-variant/40 bg-white shadow-sm">
      {/* Card header */}
      <div className="flex items-center justify-between border-b border-outline-variant/30 px-5 py-4">
        <div className="flex items-center gap-3">
          <StatusBadge tone={SEVERITY_TONE[mission.severity] ?? 'neutral'}>
            {mission.severity}
          </StatusBadge>
          <span className="font-mono text-sm font-semibold text-on-surface">{mission.cveId}</span>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
          <span className="flex items-center gap-1 text-xs text-secondary">
            <Clock size={11} /> {relativeTime(mission.createdAt)}
          </span>
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="mb-5 text-sm text-secondary">
          {mission.description.slice(0, 160)}
          {mission.description.length > 160 ? '…' : ''}
        </p>

        {/* Stage timeline */}
        <div className="relative flex flex-col gap-4">
          {/* Vertical connector */}
          <div className="absolute left-4 top-8 bottom-8 w-px bg-outline-variant/40" />

          {STAGES.map(s => {
            const active = s.n <= stage;
            const Icon = s.icon;
            return (
              <div
                key={s.n}
                className={cn('flex items-start gap-4', !active && 'opacity-40')}
              >
                {/* Node dot */}
                <div
                  className={cn(
                    'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                    active ? s.activeDotClass : 'border-outline-variant/40 bg-surface-container-low text-secondary',
                  )}
                >
                  <Icon size={14} />
                </div>
                {/* Content */}
                <div className="flex-1 pb-1">
                  <p className="text-[0.7rem] font-bold uppercase tracking-widest text-secondary">
                    {s.label}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-on-surface">{s.title}</p>

                  {/* Stage-specific content */}
                  {s.n === 1 && active ? (
                    <div className="mt-2 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-xs text-secondary">
                      <span className="font-semibold text-on-surface">Finding:</span>{' '}
                      {mission.cveId} — {mission.severity} severity alert received and queued for remediation.
                    </div>
                  ) : null}

                  {s.n === 2 && active ? (
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      {['Locate symbol', 'Apply patch', 'Run tests'].map((step, i) => (
                        <div
                          key={step}
                          className="rounded border border-outline-variant/30 bg-surface-container-low px-2 py-1.5 text-center"
                        >
                          <span className="font-mono text-[0.65rem] text-secondary">{i + 1}.</span>{' '}
                          <span className="font-medium text-on-surface">{step}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {s.n === 3 && active ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {mission.runId && mission.capabilityId ? (
                        <Link
                          to={`/passport/${mission.capabilityId}/${mission.runId}`}
                          className="enterprise-button enterprise-button-secondary inline-flex items-center gap-1.5 text-xs"
                        >
                          <ExternalLink size={12} /> View Release Passport
                        </Link>
                      ) : null}
                      <Link
                        to={`/?workItemId=${mission.workItemId}`}
                        className="enterprise-button inline-flex items-center gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                      >
                        <GitMerge size={12} /> Approve &amp; Deploy
                      </Link>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Trigger form
// ─────────────────────────────────────────────────────────────────────────────

const TriggerForm = ({
  capabilityId,
  onMissionCreated,
}: {
  capabilityId: string;
  onMissionCreated: (m: SentinelMissionStatus) => void;
}) => {
  const [cveId, setCveId] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<SentinelAlertSeverity>('HIGH');
  const [affectedFile, setAffectedFile] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cveId || !description) return;
    setSubmitting(true);
    setError(null);
    try {
      const mission = await triggerSentinelAlert({
        cveId,
        description,
        severity,
        affectedFile: affectedFile || undefined,
        source: 'manual',
        capabilityId: capabilityId || undefined,
      });
      onMissionCreated(mission);
      setCveId('');
      setDescription('');
      setAffectedFile('');
    } catch (err: any) {
      setError(err?.message ?? 'Failed to trigger alert');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-secondary">
            CVE / Finding ID
          </label>
          <input
            value={cveId}
            onChange={e => setCveId(e.target.value)}
            placeholder="CVE-2026-9912"
            className="w-full rounded-lg border border-outline-variant/50 bg-white px-3 py-2 font-mono text-sm text-on-surface placeholder-secondary/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-secondary">Severity</label>
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value as SentinelAlertSeverity)}
            className="w-full rounded-lg border border-outline-variant/50 bg-white px-3 py-2 text-sm text-on-surface focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
          >
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold text-secondary">Description</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Unauthorized prototype pollution in Core API"
            className="w-full rounded-lg border border-outline-variant/50 bg-white px-3 py-2 text-sm text-on-surface placeholder-secondary/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold text-secondary">
            Affected File <span className="font-normal text-secondary/60">(optional)</span>
          </label>
          <input
            value={affectedFile}
            onChange={e => setAffectedFile(e.target.value)}
            placeholder="src/auth/AuthService.ts"
            className="w-full rounded-lg border border-outline-variant/50 bg-white px-3 py-2 font-mono text-sm text-on-surface placeholder-secondary/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting || !cveId || !description}
        className="enterprise-button w-full justify-center bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
      >
        <Siren size={15} />
        {submitting ? 'Dispatching…' : 'Dispatch Sentinel Agent'}
      </button>
    </form>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Sentinel() {
  const { activeCapability } = useCapability();
  const [missions, setMissions] = useState<SentinelMissionStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const capabilityId = activeCapability?.id ?? '';

  const loadMissions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSentinelMissions(capabilityId || undefined);
      setMissions(data);
    } catch {
      // Non-fatal — empty state handles it.
    } finally {
      setLoading(false);
    }
  }, [capabilityId]);

  useEffect(() => {
    loadMissions();
  }, [loadMissions]);

  const handleMissionCreated = (m: SentinelMissionStatus) => {
    setMissions(prev => [m, ...prev]);
  };

  const dispatched = missions.filter(m => ['DISPATCHED', 'ACTIVE'].includes(m.status)).length;
  const awaitingApproval = missions.filter(m =>
    ['WAITING_APPROVAL', 'PENDING_APPROVAL'].includes(m.status),
  ).length;
  const completed = missions.filter(m => ['COMPLETE', 'COMPLETED'].includes(m.status)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sentinel Mode"
        title="Zero-Prompt Security Remediation"
        description="SingularityNeo acts as autonomous Incident Commander — detecting, mapping, patching, signing, and delivering the resolution for 1-click approval. Human-in-the-loop is preserved at the final merge gate."
        actions={
          <button
            type="button"
            onClick={loadMissions}
            disabled={loading}
            className="enterprise-button enterprise-button-secondary"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      >
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="info">{missions.length} missions total</StatusBadge>
          {awaitingApproval > 0 ? (
            <StatusBadge tone="warning">{awaitingApproval} awaiting approval</StatusBadge>
          ) : null}
        </div>
      </PageHeader>

      {/* Stats row */}
      {missions.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Running" value={dispatched} icon={Cpu} tone="info" />
          <StatTile label="Awaiting Approval" value={awaitingApproval} icon={ShieldCheck} tone="warning" />
          <StatTile label="Completed" value={completed} icon={CheckCircle2} tone="success" />
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        {/* Trigger form */}
        <SectionCard
          title="Trigger Alert"
          description="Manually dispatch a remediation mission for a known CVE or security finding."
          icon={Plus}
        >
          <TriggerForm capabilityId={capabilityId} onMissionCreated={handleMissionCreated} />
        </SectionCard>

        {/* Missions list */}
        <SectionCard
          title={`Active Missions (${missions.length})`}
          description="Each mission traces the full remediation pipeline: event intake → autonomous execution → human approval."
          icon={ShieldAlert}
        >
          {loading && !missions.length ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-outline-variant border-t-primary" />
            </div>
          ) : missions.length === 0 ? (
            <EmptyState
              title="No sentinel missions yet"
              description="Trigger an alert above or connect a security scanner webhook to dispatch the first agent."
              icon={ShieldCheck}
            />
          ) : (
            <div className="space-y-4">
              {missions.map(m => (
                <MissionCard key={m.missionId} mission={m} />
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
