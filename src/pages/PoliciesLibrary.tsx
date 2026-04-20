import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  RefreshCcw,
  Scale,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCapability } from '../context/CapabilityContext';
import {
  fetchCapabilityFlightRecorder,
  listGovernanceControls,
} from '../lib/api';
import type {
  ApprovalPolicy,
  CapabilityFlightRecorderSnapshot,
  FlightRecorderPolicySummary,
  GovernanceControlFramework,
  GovernanceControlListItem,
  Workflow,
  WorkflowStep,
} from '../types';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';

/**
 * /policies — capability-scoped policy catalog.
 *
 * Two tabs:
 *   • Runtime     — every ApprovalPolicy attached to a WorkflowStep in this
 *                   capability, with the workflow→step it applies to and
 *                   the count of recent decisions that reference it.
 *   • Governance  — NIST/SOC2/ISO controls from /api/governance/controls
 *                   (reused endpoint), surfaced as a compact per-capability
 *                   read with a link back to the full control page.
 *
 * No backend changes. Runtime decisions count comes from the existing
 * flight recorder snapshot (`policyDecisions[]`); we match by targetId or
 * by the reason string mentioning the policy id, since the server-side
 * join key varies by action type.
 */

type TabKey = 'runtime' | 'governance';

type ApprovalRow = {
  policy: ApprovalPolicy;
  appliedTo: Array<{ workflow: Workflow; step: WorkflowStep }>;
  decisionCount: number;
};

const FRAMEWORK_LABEL: Record<GovernanceControlFramework, string> = {
  NIST_CSF_2: 'NIST CSF 2.0',
  SOC2_TSC: 'SOC 2 TSC',
  ISO27001_2022: 'ISO 27001',
};

const APPROVAL_MODE_LABEL: Record<ApprovalPolicy['mode'], string> = {
  ANY_ONE: 'Any one approver',
  ALL_REQUIRED: 'All approvers required',
  QUORUM: 'Quorum',
};

const countDecisionsForPolicy = (
  policy: ApprovalPolicy,
  decisions: FlightRecorderPolicySummary[],
): number => {
  if (!decisions.length) return 0;
  let count = 0;
  for (const decision of decisions) {
    if (decision.targetId === policy.id) {
      count += 1;
      continue;
    }
    const reason = decision.reason || '';
    if (policy.id && reason.includes(policy.id)) {
      count += 1;
    }
  }
  return count;
};

export default function PoliciesLibrary() {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);

  const [tab, setTab] = useState<TabKey>('runtime');
  const [snapshot, setSnapshot] =
    useState<CapabilityFlightRecorderSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | undefined>();

  const [controls, setControls] = useState<GovernanceControlListItem[]>([]);
  const [controlsLoading, setControlsLoading] = useState(false);
  const [controlsError, setControlsError] = useState<string | undefined>();

  useEffect(() => {
    let isMounted = true;
    setSnapshotLoading(true);
    setSnapshotError(undefined);
    fetchCapabilityFlightRecorder(activeCapability.id)
      .then(next => {
        if (!isMounted) return;
        setSnapshot(next);
      })
      .catch(err => {
        if (!isMounted) return;
        setSnapshotError(
          err instanceof Error ? err.message : 'Could not load recent decisions.',
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setSnapshotLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [activeCapability.id]);

  const loadControls = () => {
    setControlsLoading(true);
    setControlsError(undefined);
    listGovernanceControls({ capabilityScope: activeCapability.id })
      .then(res => {
        setControls(res.items);
      })
      .catch(err => {
        setControlsError(
          err instanceof Error ? err.message : 'Could not load governance controls.',
        );
      })
      .finally(() => {
        setControlsLoading(false);
      });
  };

  useEffect(() => {
    if (tab === 'governance') {
      loadControls();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeCapability.id]);

  const allDecisions = useMemo<FlightRecorderPolicySummary[]>(
    () => (snapshot ? snapshot.workItems.flatMap(w => w.policyDecisions) : []),
    [snapshot],
  );

  const activeWorkflows = useMemo(
    () => workspace.workflows.filter(w => !w.archivedAt),
    [workspace.workflows],
  );

  const approvalRows = useMemo<ApprovalRow[]>(() => {
    const byPolicyId = new Map<string, ApprovalRow>();
    for (const workflow of activeWorkflows) {
      for (const step of workflow.steps) {
        const policy = step.approvalPolicy;
        if (!policy) continue;
        const existing = byPolicyId.get(policy.id);
        if (existing) {
          existing.appliedTo.push({ workflow, step });
        } else {
          byPolicyId.set(policy.id, {
            policy,
            appliedTo: [{ workflow, step }],
            decisionCount: 0,
          });
        }
      }
    }
    for (const row of byPolicyId.values()) {
      row.decisionCount = countDecisionsForPolicy(row.policy, allDecisions);
    }
    return Array.from(byPolicyId.values()).sort((a, b) =>
      a.policy.name.localeCompare(b.policy.name),
    );
  }, [activeWorkflows, allDecisions]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Policies"
        context={activeCapability.id}
        title={`${activeCapability.name} policy catalog`}
        description="Runtime approval policies bound to workflow steps, and governance control bindings scoped to this capability. Drill into any row to land on the workflow step or control it applies to."
        actions={
          <button
            type="button"
            onClick={() => navigate('/governance/controls')}
            className="inline-flex items-center gap-2 rounded-2xl border border-primary/10 bg-white px-4 py-3 text-sm font-bold text-primary shadow-sm transition-all hover:bg-primary/5"
          >
            <Scale size={16} />
            All governance controls
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatTile
          label="Runtime policies"
          value={approvalRows.length}
          icon={ShieldCheck}
          tone="brand"
        />
        <StatTile
          label="Gated steps"
          value={approvalRows.reduce((acc, r) => acc + r.appliedTo.length, 0)}
          icon={Users}
        />
        <StatTile
          label="Recent decisions"
          value={snapshotLoading ? '…' : allDecisions.length}
          icon={AlertTriangle}
          tone={
            allDecisions.some(d => d.decision === 'DENY') ? 'danger' : 'neutral'
          }
        />
        <StatTile
          label="Governance controls"
          value={controlsLoading ? '…' : controls.length}
          icon={Scale}
        />
      </div>

      <div className="flex gap-2 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-1">
        <button
          type="button"
          onClick={() => setTab('runtime')}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
            tab === 'runtime'
              ? 'bg-white text-primary shadow-sm'
              : 'text-secondary hover:text-on-surface'
          }`}
        >
          Runtime
        </button>
        <button
          type="button"
          onClick={() => setTab('governance')}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
            tab === 'governance'
              ? 'bg-white text-primary shadow-sm'
              : 'text-secondary hover:text-on-surface'
          }`}
        >
          Governance
        </button>
      </div>

      {tab === 'runtime' ? (
        <SectionCard
          title="Runtime approval policies"
          description="Each row is an ApprovalPolicy attached to a WorkflowStep. 'Applied to' lists the workflow step(s) that actually gate on it."
          icon={ShieldCheck}
        >
          {snapshotError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Recent decisions could not be loaded: {snapshotError}
            </div>
          ) : null}
          {approvalRows.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No runtime approval policies"
              description="No WorkflowStep in this capability has an approvalPolicy attached. Open the Designer and attach an approval policy to gate a step."
              action={
                <button
                  type="button"
                  onClick={() => navigate('/designer')}
                  className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
                >
                  <ArrowRight size={16} />
                  Open Designer
                </button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/30 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                    <th className="py-3 pr-4">Policy</th>
                    <th className="py-3 pr-4">Mode</th>
                    <th className="py-3 pr-4">Applied to</th>
                    <th className="py-3 pr-4">Recent decisions</th>
                  </tr>
                </thead>
                <tbody>
                  {approvalRows.map(row => (
                    <tr
                      key={row.policy.id}
                      className="border-b border-outline-variant/15 align-top"
                    >
                      <td className="py-4 pr-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-bold text-on-surface">
                            {row.policy.name}
                          </span>
                          <code className="text-[0.6875rem] font-mono text-outline">
                            {row.policy.id}
                          </code>
                          {row.policy.description ? (
                            <p className="mt-1 text-xs leading-relaxed text-secondary">
                              {row.policy.description}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <StatusBadge tone="info">
                          {APPROVAL_MODE_LABEL[row.policy.mode]}
                        </StatusBadge>
                        {row.policy.minimumApprovals ? (
                          <div className="mt-1 text-[0.6875rem] text-outline">
                            min {row.policy.minimumApprovals}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-4 pr-4">
                        <ul className="space-y-1.5">
                          {row.appliedTo.map(({ workflow, step }, idx) => (
                            <li
                              key={`${row.policy.id}-${workflow.id}-${step.id}-${idx}`}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(
                                    `/designer?workflowId=${encodeURIComponent(workflow.id)}&stepId=${encodeURIComponent(step.id)}`,
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded-full border border-primary/10 bg-primary/5 px-2 py-1 text-[0.6875rem] font-semibold text-primary transition-colors hover:bg-primary/10"
                              >
                                <span>{workflow.name}</span>
                                <ArrowRight size={11} />
                                <span>{step.name}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="py-4 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-on-surface">
                            {snapshotLoading ? '…' : row.decisionCount}
                          </span>
                          {row.decisionCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => navigate('/ledger')}
                              className="text-[0.6875rem] font-semibold text-primary hover:underline"
                            >
                              Open ledger
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard
          title="Governance control bindings"
          description="Controls from the compliance frameworks this capability is scoped into. Each row links to the full control detail page with its policy bindings."
          icon={Scale}
          action={
            <button
              type="button"
              onClick={loadControls}
              className="inline-flex items-center gap-2 rounded-2xl border border-primary/10 bg-white px-3 py-2 text-xs font-bold text-primary shadow-sm transition-all hover:bg-primary/5"
              disabled={controlsLoading}
            >
              <RefreshCcw size={14} />
              Refresh
            </button>
          }
        >
          {controlsError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {controlsError}
            </div>
          ) : null}
          {!controlsLoading && controls.length === 0 && !controlsError ? (
            <EmptyState
              icon={Scale}
              title="No governance bindings scoped here"
              description="No control is currently scoped to this capability. Open Governance Controls to browse every binding across frameworks."
              action={
                <button
                  type="button"
                  onClick={() => navigate('/governance/controls')}
                  className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
                >
                  <ArrowRight size={16} />
                  Open Governance Controls
                </button>
              }
            />
          ) : null}
          {controls.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-outline-variant/30 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                    <th className="py-3 pr-4">Control</th>
                    <th className="py-3 pr-4">Framework</th>
                    <th className="py-3 pr-4">Severity</th>
                    <th className="py-3 pr-4">Bindings</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {controls.map(control => (
                    <tr
                      key={control.controlId}
                      className="border-b border-outline-variant/15 align-top"
                    >
                      <td className="py-4 pr-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-bold text-on-surface">
                            {control.title}
                          </span>
                          <code className="text-[0.6875rem] font-mono text-outline">
                            {control.controlCode}
                          </code>
                          <p className="mt-1 text-xs leading-relaxed text-secondary">
                            {control.controlFamily}
                          </p>
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <StatusBadge tone="info">
                          {FRAMEWORK_LABEL[control.framework]}
                        </StatusBadge>
                      </td>
                      <td className="py-4 pr-4">
                        <StatusBadge
                          tone={control.severity === 'SEV_1' ? 'warning' : 'neutral'}
                        >
                          {control.severity}
                        </StatusBadge>
                      </td>
                      <td className="py-4 pr-4">
                        <span className="text-sm font-bold text-on-surface">
                          {control.bindingCount}
                        </span>
                      </td>
                      <td className="py-4 pr-4">
                        <StatusBadge tone="neutral">{control.status}</StatusBadge>
                      </td>
                      <td className="py-4 pr-4">
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/governance/controls?controlId=${encodeURIComponent(control.controlId)}`,
                            )
                          }
                          className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-primary hover:underline"
                        >
                          <ExternalLink size={12} />
                          View control
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </SectionCard>
      )}
    </div>
  );
}
