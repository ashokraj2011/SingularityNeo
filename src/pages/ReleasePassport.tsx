/**
 * ReleasePassport — a governance document summarising a run's delivery
 * evidence, code impact, governance posture, and approval status.
 *
 * Route: /passport/:capabilityId/:runId
 *
 * Visual style mirrors the passport.html mockup: a light, document-like
 * layout with a recommendation bar, dual-column body, and an "ATTESTED"
 * watermark. Uses the same EnterpriseUI primitives as WorkItemReport.tsx.
 */
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Award,
  BriefcaseIcon,
  CheckCircle2,
  ClipboardCheck,
  FileCode2,
  Fingerprint,
  GitCommit,
  Lock,
  Scale,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  Users,
  BookOpen,
  XCircle,
  Clock,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { fetchReleasePassport, type ReleasePassportData } from '../lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const recommendationConfig = {
  APPROVE: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    iconBg: 'bg-emerald-500',
    textColor: 'text-emerald-700',
    badgeText: 'Release Ready',
    label: 'Platform Output: APPROVE',
  },
  HOLD: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    iconBg: 'bg-amber-500',
    textColor: 'text-amber-700',
    badgeText: 'Hold — Pending',
    label: 'Platform Output: HOLD',
  },
  REJECT: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    iconBg: 'bg-red-500',
    textColor: 'text-red-700',
    badgeText: 'Blocked',
    label: 'Platform Output: REJECT',
  },
} as const;

const evidenceIcon = {
  ANALYSIS: ClipboardCheck,
  COMMIT: GitCommit,
  SIGNATURE: Award,
  TEST: ShieldCheck,
  ARTIFACT: FileCode2,
} as const;

const approvalStatusConfig = {
  PENDING: { text: 'text-amber-600', label: 'Pending' },
  APPROVED: { text: 'text-emerald-600', label: 'Approved' },
  REJECTED: { text: 'text-red-600', label: 'Rejected' },
  REQUEST_CHANGES: { text: 'text-orange-600', label: 'Changes requested' },
} as const;

const govLabel: Record<string, string> = {
  UNTOUCHED: 'Untouched',
  MODIFIED: 'Modified',
  ALIGNED: 'Aligned',
  DRIFTED: 'Drifted',
  UNKNOWN: 'Unknown',
};

const govTone = (val: string) => {
  if (['UNTOUCHED', 'ALIGNED'].includes(val)) return 'text-emerald-600';
  if (['DRIFTED', 'MODIFIED'].includes(val)) return 'text-red-600';
  return 'text-slate-500';
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const SectionTitle = ({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) => (
  <div className="mb-5 flex items-center gap-2.5 text-xs font-bold uppercase tracking-widest text-slate-400">
    <Icon size={15} className="text-slate-400" />
    {children}
  </div>
);

const AttrRow = ({
  icon: Icon,
  label,
  value,
  valueClass,
}: {
  icon?: React.ElementType;
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) => (
  <div className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0 last:pb-0">
    <span className="flex items-center gap-2 text-sm font-medium text-slate-600">
      {Icon ? <Icon size={13} className="text-slate-400" /> : null}
      {label}
    </span>
    <span className={cn('font-mono text-sm font-semibold', valueClass ?? 'text-slate-800')}>
      {value}
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

const LoadingState = () => (
  <div className="flex min-h-screen items-center justify-center bg-slate-100">
    <div className="text-center">
      <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-500" />
      <p className="text-sm text-slate-500">Compiling release passport…</p>
    </div>
  </div>
);

const ErrorState = ({ message }: { message: string }) => (
  <div className="flex min-h-screen items-center justify-center bg-slate-100">
    <div className="rounded-xl border border-red-200 bg-white p-8 text-center shadow">
      <XCircle size={40} className="mx-auto mb-4 text-red-400" />
      <p className="font-semibold text-slate-800">Could not load passport</p>
      <p className="mt-2 text-sm text-slate-500">{message}</p>
      <Link to="/" className="mt-6 inline-block text-sm text-emerald-600 underline">
        Back to Orchestrator
      </Link>
    </div>
  </div>
);

export default function ReleasePassport() {
  const { capabilityId, runId } = useParams<{
    capabilityId: string;
    runId: string;
  }>();
  const [passport, setPassport] = useState<ReleasePassportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!capabilityId || !runId) return;
    setLoading(true);
    setError(null);
    fetchReleasePassport(capabilityId, runId)
      .then(setPassport)
      .catch(err => setError(err?.message ?? 'Unknown error'))
      .finally(() => setLoading(false));
  }, [capabilityId, runId]);

  if (loading) return <LoadingState />;
  if (error || !passport) return <ErrorState message={error ?? 'No data'} />;

  const rec = recommendationConfig[passport.recommendation];

  return (
    <div className="min-h-screen bg-slate-100 py-10 px-4">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">

        {/* Watermark */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-10 top-24 z-0 -rotate-6 select-none font-bold tracking-tighter text-slate-50"
          style={{ fontSize: '7rem', letterSpacing: '-3px', fontFamily: 'system-ui' }}
        >
          ATTESTED
        </div>

        {/* Recommendation bar */}
        <div
          className={cn(
            'relative z-10 flex items-center justify-between border-b px-10 py-5',
            rec.bg,
            rec.border,
          )}
        >
          <div className="flex items-center gap-4">
            <div
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full',
                rec.iconBg,
              )}
            >
              <CheckCircle2 size={22} className="text-white" />
            </div>
            <div>
              <p className={cn('text-xl font-bold', rec.textColor)}>{rec.label}</p>
              <p className={cn('mt-0.5 text-sm font-medium', rec.textColor)}>
                {passport.recommendationReason}
              </p>
            </div>
          </div>
          <span
            className={cn(
              'rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-widest',
              rec.textColor,
              rec.border,
              'bg-white',
            )}
          >
            {rec.badgeText}
          </span>
        </div>

        {/* Document header */}
        <div className="relative z-10 border-b-2 border-dashed border-slate-200 px-10 py-8">
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                {passport.workItem.title}
              </h1>
              <p className="mt-2 flex items-center gap-2 text-base text-slate-500">
                <BriefcaseIcon size={16} />
                {passport.workItem.taskType} · {passport.workItem.phase}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-xs text-slate-400">DOCUMENT ID</p>
              <p className="font-mono text-base font-bold tracking-widest text-slate-700">
                {passport.documentId}
              </p>
            </div>
          </div>
          {passport.workItem.description ? (
            <p className="mt-4 text-base leading-relaxed text-slate-500">
              {passport.workItem.description.slice(0, 240)}
              {passport.workItem.description.length > 240 ? '…' : ''}
            </p>
          ) : null}
        </div>

        {/* Dual-column body */}
        <div className="relative z-10 grid grid-cols-1 gap-0 lg:grid-cols-[1fr_320px]">

          {/* Left column: code impact + evidence */}
          <div className="border-b border-slate-200 px-10 py-8 lg:border-b-0 lg:border-r">

            {/* Code Impact */}
            <section className="mb-10">
              <SectionTitle icon={FileCode2}>Code &amp; Symbol Impact</SectionTitle>
              <div className="rounded-lg border border-slate-200 p-5">
                {passport.codeImpact.targetRepository ? (
                  <>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Target Repository
                    </p>
                    <p className="mb-4 font-mono text-sm text-slate-700">
                      {passport.codeImpact.targetRepository}
                    </p>
                  </>
                ) : null}

                {passport.codeImpact.primarySymbols.length > 0 ? (
                  <>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Primary Symbols Touched
                    </p>
                    <div className="mb-4 space-y-0.5">
                      {passport.codeImpact.primarySymbols.map(s => (
                        <p key={s} className="font-mono text-sm text-blue-600">
                          {s}
                        </p>
                      ))}
                    </div>
                  </>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-3">
                  <span className="flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-1 font-mono text-sm font-bold text-emerald-700">
                    +{passport.codeImpact.additions} Lines
                  </span>
                  <span className="flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-3 py-1 font-mono text-sm font-bold text-red-700">
                    -{passport.codeImpact.deletions} Lines
                  </span>
                  <span className="flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-3 py-1 font-mono text-sm font-bold text-blue-700">
                    {passport.codeImpact.filesChanged} Files
                  </span>
                </div>
              </div>
            </section>

            {/* Evidence */}
            <section>
              <SectionTitle icon={Fingerprint}>Evidence &amp; Provenance</SectionTitle>
              <ul className="space-y-2.5">
                {passport.evidence.map(ev => {
                  const Icon = evidenceIcon[ev.kind] ?? ClipboardCheck;
                  return (
                    <li
                      key={ev.label}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="flex items-center gap-3 font-medium text-slate-700">
                        <Icon size={16} className="text-slate-400" />
                        {ev.label}
                      </div>
                      <div
                        className={cn(
                          'flex items-center gap-2 font-mono text-xs font-semibold',
                          ev.status === 'VERIFIED'
                            ? 'text-emerald-600'
                            : ev.status === 'MISSING'
                              ? 'text-red-500'
                              : 'text-amber-500',
                        )}
                      >
                        {ev.status === 'VERIFIED' ? (
                          <CheckCircle2 size={13} />
                        ) : ev.status === 'PENDING' ? (
                          <Clock size={13} />
                        ) : (
                          <XCircle size={13} />
                        )}
                        {ev.ref ?? ev.status}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          {/* Right column: governance + approvals */}
          <div className="bg-slate-50 px-8 py-8">

            {/* Governance */}
            <section className="mb-10">
              <SectionTitle icon={Scale}>Governance Posture</SectionTitle>
              <AttrRow
                icon={Lock}
                label="Sensitive Paths"
                value={govLabel[passport.governance.sensitivePaths] ?? passport.governance.sensitivePaths}
                valueClass={govTone(passport.governance.sensitivePaths)}
              />
              <AttrRow
                icon={TriangleAlert}
                label="Policy Exceptions"
                value={passport.governance.policyExceptions === 0 ? 'None' : String(passport.governance.policyExceptions)}
                valueClass={passport.governance.policyExceptions > 0 ? 'text-red-600' : 'text-slate-700'}
              />
              <AttrRow
                icon={Users}
                label="Execution Role"
                value={passport.governance.executionRole}
              />
              <AttrRow
                icon={BookOpen}
                label="Memory Drift"
                value={govLabel[passport.governance.memoryDrift] ?? passport.governance.memoryDrift}
                valueClass={govTone(passport.governance.memoryDrift)}
              />
            </section>

            {/* Approvals */}
            <section>
              <SectionTitle icon={UserCheck}>Required Approvals</SectionTitle>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                {passport.approvals.map((a, i) => (
                  <AttrRow
                    key={`${a.role}-${i}`}
                    label={a.role}
                    value={approvalStatusConfig[a.status]?.label ?? a.status}
                    valueClass={approvalStatusConfig[a.status]?.text ?? 'text-slate-700'}
                  />
                ))}
              </div>
              <p className="mt-3 text-xs italic text-slate-400">
                All prerequisite construction phases complete.
                {passport.approvals.some(a => a.status === 'PENDING')
                  ? ' Awaiting final operational release consent.'
                  : ' All approvals resolved.'}
              </p>
            </section>

            {/* Back link */}
            <div className="mt-8 border-t border-slate-200 pt-6 text-center">
              <Link
                to="/"
                className="text-xs font-semibold text-emerald-600 underline underline-offset-2"
              >
                ← Back to Orchestrator
              </Link>
              <p className="mt-2 font-mono text-[0.65rem] text-slate-300">
                Generated {new Date(passport.generatedAt).toLocaleString()} · Run {passport.runId.slice(0, 8)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
