import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckSquare,
  Download,
  ExternalLink,
  LayoutGrid,
  RefreshCcw,
  Scale,
  Search,
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
  WorkflowNode,
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
 * Four tabs:
 *   • Runtime      — every ApprovalPolicy attached to a WorkflowStep
 *   • Governance   — NIST/SOC2/ISO controls
 *   • Templates    — pre-built governance/approval policy starters
 *   • Compliance   — coverage dashboard: which steps are unprotected
 */

type TabKey = 'runtime' | 'governance' | 'templates' | 'compliance';

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

// ── Built-in policy template starters ────────────────────────────────────────

interface PolicyTemplateStarter {
  id: string;
  name: string;
  description: string;
  category: string;
  mode: ApprovalPolicy['mode'];
  minimumApprovals?: number;
  tags: string[];
}

const BUILT_IN_POLICY_TEMPLATES: PolicyTemplateStarter[] = [
  {
    id: 'tpl-two-approver',
    name: 'Two-approver sign-off',
    description: 'Requires any two approvers from the configured list before the step proceeds.',
    category: 'General',
    mode: 'QUORUM',
    minimumApprovals: 2,
    tags: ['quorum', 'dual-control'],
  },
  {
    id: 'tpl-ciso-critical',
    name: 'CISO sign-off for CRITICAL',
    description: 'All configured approvers must approve — intended for critical security changes that require CISO sign-off.',
    category: 'Security',
    mode: 'ALL_REQUIRED',
    tags: ['security', 'ciso', 'critical'],
  },
  {
    id: 'tpl-finance-approval',
    name: 'Finance approval',
    description: 'Any one finance team approver can unblock the step.',
    category: 'Finance',
    mode: 'ANY_ONE',
    tags: ['finance', 'spend'],
  },
  {
    id: 'tpl-legal-review',
    name: 'Legal review',
    description: 'Any one legal team member must review and approve before the step continues.',
    category: 'Legal',
    mode: 'ANY_ONE',
    tags: ['legal', 'compliance'],
  },
  {
    id: 'tpl-four-eyes',
    name: 'Four-eyes principle',
    description: 'Two people from different teams must each independently approve (quorum of 2).',
    category: 'General',
    mode: 'QUORUM',
    minimumApprovals: 2,
    tags: ['segregation-of-duties', 'four-eyes'],
  },
  {
    id: 'tpl-unanimous',
    name: 'Unanimous board approval',
    description: 'Every configured approver must sign off — used for major strategic decisions.',
    category: 'Executive',
    mode: 'ALL_REQUIRED',
    tags: ['board', 'unanimous', 'executive'],
  },
];

// ── Compliance types ─────────────────────────────────────────────────────────

interface ComplianceRow {
  workflowName: string;
  workflowId: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  hasPolicy: boolean;
  assigneeRole?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const countDecisionsForPolicy = (
  policy: ApprovalPolicy,
  decisions: FlightRecorderPolicySummary[],
): number => {
  if (!decisions.length) return 0;
  let count = 0;
  for (const decision of decisions) {
    if (decision.targetId === policy.id) { count += 1; continue; }
    const reason = decision.reason || '';
    if (policy.id && reason.includes(policy.id)) count += 1;
  }
  return count;
};

function exportCsv(rows: ComplianceRow[]) {
  const header = 'Workflow,Step,Type,Has Policy,Assignee Role';
  const lines = rows.map(r =>
    [r.workflowName, r.nodeLabel, r.nodeType, r.hasPolicy ? 'Yes' : 'No', r.assigneeRole ?? ''].join(','),
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'policy-compliance.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

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

  // Search/filter
  const [searchQuery, setSearchQuery] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState<string>('All');

  useEffect(() => {
    let isMounted = true;
    setSnapshotLoading(true);
    setSnapshotError(undefined);
    fetchCapabilityFlightRecorder(activeCapability.id)
      .then(next => { if (isMounted) setSnapshot(next); })
      .catch(err => {
        if (isMounted) setSnapshotError(err instanceof Error ? err.message : 'Could not load recent decisions.');
      })
      .finally(() => { if (isMounted) setSnapshotLoading(false); });
    return () => { isMounted = false; };
  }, [activeCapability.id]);

  const loadControls = () => {
    setControlsLoading(true);
    setControlsError(undefined);
    listGovernanceControls({ capabilityScope: activeCapability.id })
      .then(res => setControls(res.items))
      .catch(err => setControlsError(err instanceof Error ? err.message : 'Could not load governance controls.'))
      .finally(() => setControlsLoading(false));
  };

  useEffect(() => {
    if (tab === 'governance') loadControls();
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
          byPolicyId.set(policy.id, { policy, appliedTo: [{ workflow, step }], decisionCount: 0 });
        }
      }
    }
    for (const row of byPolicyId.values()) {
      row.decisionCount = countDecisionsForPolicy(row.policy, allDecisions);
    }
    return Array.from(byPolicyId.values()).sort((a, b) => a.policy.name.localeCompare(b.policy.name));
  }, [activeWorkflows, allDecisions]);

  // Filtered runtime rows
  const filteredApprovalRows = useMemo(() => {
    if (!searchQuery.trim()) return approvalRows;
    const q = searchQuery.toLowerCase();
    return approvalRows.filter(r =>
      r.policy.name.toLowerCase().includes(q) ||
      r.policy.description?.toLowerCase().includes(q) ||
      r.appliedTo.some(a => a.workflow.name.toLowerCase().includes(q) || a.step.name.toLowerCase().includes(q)),
    );
  }, [approvalRows, searchQuery]);

  // Compliance rows: all HUMAN_APPROVAL and HUMAN_TASK nodes across all workflows
  const complianceRows = useMemo<ComplianceRow[]>(() => {
    const rows: ComplianceRow[] = [];
    for (const workflow of activeWorkflows) {
      // Check workflow-level nodes (new graph-based)
      const nodes: WorkflowNode[] = workflow.nodes ?? [];
      for (const node of nodes) {
        if (!['HUMAN_APPROVAL', 'HUMAN_TASK'].includes(node.type)) continue;
        rows.push({
          workflowName: workflow.name,
          workflowId: workflow.id,
          nodeId: node.id,
          nodeLabel: node.name,
          nodeType: node.type,
          hasPolicy: Boolean(node.approvalPolicy),
          assigneeRole: node.humanTaskConfig?.assigneeRole,
        });
      }
      // Also cover legacy step-based workflows
      for (const step of workflow.steps ?? []) {
        const sType = step.stepType as string;
        if (!['HUMAN_APPROVAL', 'HUMAN_TASK'].includes(sType)) continue;
        // Avoid duplicates if already covered via nodes
        const alreadyCovered = rows.some(r => r.workflowId === workflow.id && r.nodeId === step.id);
        if (alreadyCovered) continue;
        rows.push({
          workflowName: workflow.name,
          workflowId: workflow.id,
          nodeId: step.id,
          nodeLabel: step.name,
          nodeType: sType,
          hasPolicy: Boolean(step.approvalPolicy),
          assigneeRole: undefined,
        });
      }
    }
    return rows;
  }, [activeWorkflows]);

  const unprotectedRows = complianceRows.filter(r => !r.hasPolicy);
  const coveragePct = complianceRows.length > 0
    ? Math.round(((complianceRows.length - unprotectedRows.length) / complianceRows.length) * 100)
    : 100;

  // Template categories
  const templateCategories = useMemo(() => {
    const cats = new Set(BUILT_IN_POLICY_TEMPLATES.map(t => t.category));
    return ['All', ...Array.from(cats)];
  }, []);

  const filteredTemplates = useMemo(() => {
    return BUILT_IN_POLICY_TEMPLATES.filter(t => {
      if (templateCategory !== 'All' && t.category !== templateCategory) return false;
      if (!templateSearch.trim()) return true;
      const q = templateSearch.toLowerCase();
      return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some(tag => tag.includes(q));
    });
  }, [templateSearch, templateCategory]);

  const TAB_ITEMS: { key: TabKey; label: string }[] = [
    { key: 'runtime', label: 'Runtime' },
    { key: 'governance', label: 'Governance' },
    { key: 'templates', label: 'Templates' },
    { key: 'compliance', label: 'Compliance' },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Policies"
        context={activeCapability.id}
        title={`${activeCapability.name} policy catalog`}
        description="Runtime approval policies, governance control bindings, policy template starters, and a compliance coverage dashboard for this capability."
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
        <StatTile label="Runtime policies" value={approvalRows.length} icon={ShieldCheck} tone="brand" />
        <StatTile label="Gated steps" value={approvalRows.reduce((acc, r) => acc + r.appliedTo.length, 0)} icon={Users} />
        <StatTile
          label="Recent decisions"
          value={snapshotLoading ? '…' : allDecisions.length}
          icon={AlertTriangle}
          tone={allDecisions.some(d => d.decision === 'DENY') ? 'danger' : 'neutral'}
        />
        <StatTile
          label="Coverage"
          value={complianceRows.length > 0 ? `${coveragePct}%` : '—'}
          icon={CheckSquare}
          tone={coveragePct < 80 ? 'warning' : 'success'}
        />
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-1">
        {TAB_ITEMS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
              tab === key ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-on-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Runtime tab ───────────────────────────────────────────────────── */}
      {tab === 'runtime' && (
        <SectionCard
          title="Runtime approval policies"
          description="Each row is an ApprovalPolicy attached to a WorkflowStep. 'Applied to' lists the workflow step(s) that gate on it."
          icon={ShieldCheck}
          action={
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
              <input
                type="search"
                placeholder="Search policies…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="enterprise-input pl-8 text-sm"
              />
            </div>
          }
        >
          {snapshotError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Recent decisions could not be loaded: {snapshotError}
            </div>
          ) : null}
          {filteredApprovalRows.length === 0 && !snapshotLoading ? (
            <EmptyState
              icon={ShieldCheck}
              title={searchQuery ? 'No policies match your search' : 'No runtime approval policies'}
              description={
                searchQuery
                  ? 'Try a different keyword.'
                  : 'No WorkflowStep in this capability has an approvalPolicy attached. Open the Designer and attach an approval policy to gate a step.'
              }
              action={
                searchQuery ? (
                  <button type="button" onClick={() => setSearchQuery('')}
                    className="text-sm font-semibold text-primary hover:underline">
                    Clear search
                  </button>
                ) : (
                  <button type="button" onClick={() => navigate('/designer')}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110">
                    <ArrowRight size={16} />
                    Open Designer
                  </button>
                )
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
                  {filteredApprovalRows.map(row => (
                    <tr key={row.policy.id} className="border-b border-outline-variant/15 align-top">
                      <td className="py-4 pr-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-bold text-on-surface">{row.policy.name}</span>
                          <code className="text-[0.6875rem] font-mono text-outline">{row.policy.id}</code>
                          {row.policy.description ? (
                            <p className="mt-1 text-xs leading-relaxed text-secondary">{row.policy.description}</p>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <StatusBadge tone="info">{APPROVAL_MODE_LABEL[row.policy.mode]}</StatusBadge>
                        {row.policy.minimumApprovals ? (
                          <div className="mt-1 text-[0.6875rem] text-outline">min {row.policy.minimumApprovals}</div>
                        ) : null}
                      </td>
                      <td className="py-4 pr-4">
                        <ul className="space-y-1.5">
                          {row.appliedTo.map(({ workflow, step }, idx) => (
                            <li key={`${row.policy.id}-${workflow.id}-${step.id}-${idx}`}>
                              <button
                                type="button"
                                onClick={() => navigate(`/designer?workflowId=${encodeURIComponent(workflow.id)}&stepId=${encodeURIComponent(step.id)}`)}
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
                            <button type="button" onClick={() => navigate('/ledger')}
                              className="text-[0.6875rem] font-semibold text-primary hover:underline">
                              Open Activity Record
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
      )}

      {/* ── Governance tab ────────────────────────────────────────────────── */}
      {tab === 'governance' && (
        <SectionCard
          title="Governance control bindings"
          description="Controls from the compliance frameworks this capability is scoped into. Each row links to the full control detail page."
          icon={Scale}
          action={
            <button type="button" onClick={loadControls}
              className="inline-flex items-center gap-2 rounded-2xl border border-primary/10 bg-white px-3 py-2 text-xs font-bold text-primary shadow-sm transition-all hover:bg-primary/5"
              disabled={controlsLoading}>
              <RefreshCcw size={14} />
              Refresh
            </button>
          }
        >
          {controlsError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{controlsError}</div>
          ) : null}
          {!controlsLoading && controls.length === 0 && !controlsError ? (
            <EmptyState
              icon={Scale}
              title="No governance bindings scoped here"
              description="No control is currently scoped to this capability. Open Governance Controls to browse every binding across frameworks."
              action={
                <button type="button" onClick={() => navigate('/governance/controls')}
                  className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110">
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
                    <tr key={control.controlId} className="border-b border-outline-variant/15 align-top">
                      <td className="py-4 pr-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-bold text-on-surface">{control.title}</span>
                          <code className="text-[0.6875rem] font-mono text-outline">{control.controlCode}</code>
                          <p className="mt-1 text-xs leading-relaxed text-secondary">{control.controlFamily}</p>
                        </div>
                      </td>
                      <td className="py-4 pr-4"><StatusBadge tone="info">{FRAMEWORK_LABEL[control.framework]}</StatusBadge></td>
                      <td className="py-4 pr-4">
                        <StatusBadge tone={control.severity === 'SEV_1' ? 'warning' : 'neutral'}>{control.severity}</StatusBadge>
                      </td>
                      <td className="py-4 pr-4"><span className="text-sm font-bold text-on-surface">{control.bindingCount}</span></td>
                      <td className="py-4 pr-4"><StatusBadge tone="neutral">{control.status}</StatusBadge></td>
                      <td className="py-4 pr-4">
                        <button type="button"
                          onClick={() => navigate(`/governance/controls?controlId=${encodeURIComponent(control.controlId)}`)}
                          className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-primary hover:underline">
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

      {/* ── Templates tab ─────────────────────────────────────────────────── */}
      {tab === 'templates' && (
        <SectionCard
          title="Policy template starters"
          description="Pre-built governance and approval policy starters. Copy the configuration into the Designer's approval policy editor to jumpstart a workflow gate."
          icon={LayoutGrid}
          action={
            <div className="flex items-center gap-2">
              <select
                value={templateCategory}
                onChange={e => setTemplateCategory(e.target.value)}
                className="enterprise-input text-xs"
              >
                {templateCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outline" />
                <input
                  type="search"
                  placeholder="Search…"
                  value={templateSearch}
                  onChange={e => setTemplateSearch(e.target.value)}
                  className="enterprise-input pl-7 text-xs"
                />
              </div>
            </div>
          }
        >
          {filteredTemplates.length === 0 ? (
            <EmptyState
              icon={LayoutGrid}
              title="No templates match"
              description="Adjust the search or category filter."
              action={
                <button type="button" onClick={() => { setTemplateSearch(''); setTemplateCategory('All'); }}
                  className="text-sm font-semibold text-primary hover:underline">
                  Clear filters
                </button>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTemplates.map(tpl => (
                <div
                  key={tpl.id}
                  className="flex flex-col gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4 transition hover:border-primary/30 hover:bg-primary/5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-on-surface">{tpl.name}</p>
                    <StatusBadge tone="info">{tpl.category}</StatusBadge>
                  </div>
                  <p className="flex-1 text-xs leading-relaxed text-secondary">{tpl.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge tone="neutral">{APPROVAL_MODE_LABEL[tpl.mode]}</StatusBadge>
                    {tpl.minimumApprovals ? (
                      <StatusBadge tone="neutral">min {tpl.minimumApprovals}</StatusBadge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tpl.tags.map(tag => (
                      <span key={tag} className="rounded-full bg-outline-variant/20 px-2 py-0.5 text-[0.625rem] font-medium text-secondary">
                        #{tag}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/designer')}
                    className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/20"
                  >
                    <ArrowRight size={12} />
                    Use in Designer
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Compliance tab ────────────────────────────────────────────────── */}
      {tab === 'compliance' && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <StatTile label="Total human steps" value={complianceRows.length} icon={Users} />
            <StatTile
              label="Steps with policy"
              value={complianceRows.length - unprotectedRows.length}
              icon={ShieldCheck}
              tone="success"
            />
            <StatTile
              label="Unprotected steps"
              value={unprotectedRows.length}
              icon={AlertTriangle}
              tone={unprotectedRows.length > 0 ? 'danger' : 'success'}
            />
            <StatTile
              label="Coverage"
              value={complianceRows.length > 0 ? `${coveragePct}%` : '100%'}
              icon={CheckSquare}
              tone={coveragePct < 80 ? 'warning' : 'success'}
            />
          </div>

          <SectionCard
            title="Human step coverage report"
            description="All HUMAN_APPROVAL and HUMAN_TASK nodes across every active workflow in this capability. Red rows are unprotected — no approval policy and no assignee role."
            icon={CheckSquare}
            action={
              complianceRows.length > 0 ? (
                <button
                  type="button"
                  onClick={() => exportCsv(complianceRows)}
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-outline-variant/40 px-3 py-2 text-xs font-semibold text-secondary transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <Download size={13} />
                  Export CSV
                </button>
              ) : undefined
            }
          >
            {complianceRows.length === 0 ? (
              <EmptyState
                icon={CheckSquare}
                title="No human steps found"
                description="This capability has no HUMAN_APPROVAL or HUMAN_TASK nodes in its active workflows. Add some in the Workflow Studio."
                action={
                  <button type="button" onClick={() => navigate('/workflow-designer-neo')}
                    className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110">
                    <ArrowRight size={16} />
                    Open Workflow Studio
                  </button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant/30 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      <th className="py-3 pr-4">Workflow</th>
                      <th className="py-3 pr-4">Step</th>
                      <th className="py-3 pr-4">Type</th>
                      <th className="py-3 pr-4">Policy</th>
                      <th className="py-3 pr-4">Assignee role</th>
                      <th className="py-3 pr-4">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complianceRows.map(row => (
                      <tr
                        key={`${row.workflowId}-${row.nodeId}`}
                        className={`border-b border-outline-variant/15 align-top ${!row.hasPolicy ? 'bg-red-50/50' : ''}`}
                      >
                        <td className="py-3 pr-4 text-sm font-semibold text-on-surface">{row.workflowName}</td>
                        <td className="py-3 pr-4 text-sm text-on-surface">{row.nodeLabel}</td>
                        <td className="py-3 pr-4">
                          <StatusBadge tone={row.nodeType === 'HUMAN_APPROVAL' ? 'info' : 'warning'}>
                            {row.nodeType}
                          </StatusBadge>
                        </td>
                        <td className="py-3 pr-4">
                          {row.hasPolicy ? (
                            <StatusBadge tone="success">Protected</StatusBadge>
                          ) : (
                            <StatusBadge tone="danger">None</StatusBadge>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-xs text-secondary">{row.assigneeRole || '—'}</td>
                        <td className="py-3 pr-4">
                          <button
                            type="button"
                            onClick={() => navigate(`/workflow-designer-neo?workflowId=${encodeURIComponent(row.workflowId)}`)}
                            className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-primary hover:underline"
                          >
                            <ExternalLink size={11} />
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
