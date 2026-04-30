/**
 * Agent Mind — 5-tab surface for inspecting what an agent knows, what rules it
 * applies, what the world looks like from its view, why it made recent
 * decisions, and what it has learned over time.
 *
 * Route: /team/mind?agentId=<id>   (capabilityId from CapabilityContext)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Brain,
  BookOpen,
  Globe,
  Lightbulb,
  FlaskConical,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Cpu,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  AgentMindSnapshot,
  AgentMindRule,
  AgentWorldEntity,
  LearningUpdate,
  PersistedPromptReceipt,
  AgentLearningProfileVersion,
} from '../types';
import {
  PageHeader,
  StatusBadge,
  StatTile,
  SectionCard,
  EmptyState,
} from '../components/EnterpriseUI';
import AgentKnowledgeLensPanel from '../components/AgentKnowledgeLensPanel';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { fetchAgentMindSnapshot } from '../lib/api';
import { cn } from '../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type MindTab = 'knowledge' | 'rules' | 'world' | 'reasoning' | 'learning';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtTs = (iso?: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const fmtRelative = (iso?: string | null) => {
  if (!iso) return '—';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return iso;
  }
};

const triggerTone = (
  t?: LearningUpdate['triggerType'],
): 'neutral' | 'info' | 'warning' | 'danger' | 'success' => {
  if (!t) return 'neutral';
  if (t === 'DRIFT_FLAGGED' || t === 'PIPELINE_ERROR') return 'danger';
  if (t === 'USER_CORRECTION' || t === 'MANUAL_REFRESH') return 'info';
  if (t === 'EXPERIENCE_DISTILLATION' || t === 'INITIALIZATION') return 'success';
  if (t === 'GOVERNANCE_EXCEPTION') return 'warning';
  return 'neutral';
};

const kindTone = (
  k: AgentMindRule['kind'],
): 'neutral' | 'info' | 'warning' | 'danger' | 'success' => {
  if (k === 'GUARDRAIL') return 'danger';
  if (k === 'GOVERNANCE') return 'warning';
  if (k === 'LEARNED') return 'success';
  if (k === 'RESPONSIBILITY') return 'info';
  return 'neutral';
};

const freshnessColor = (f?: 'HOT' | 'WARM' | 'COLD') => {
  if (f === 'HOT') return 'text-emerald-600';
  if (f === 'WARM') return 'text-amber-600';
  if (f === 'COLD') return 'text-secondary';
  return 'text-secondary';
};

const EPISTEMIC_LABEL: Record<string, string> = {
  LEARNING_CONTEXT: 'Beliefs used',
  MEMORY_HITS: 'World model consulted',
  DEVELOPER_PROMPT: 'Rules applied',
  SYSTEM_PROMPT: 'System context',
  USER_PROMPT: 'User message',
  SKILL_CONTEXT: 'Skill knowledge',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const TabButton = ({
  id,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  id: MindTab;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: (t: MindTab) => void;
}) => (
  <button
    type="button"
    onClick={() => onClick(id)}
    className={cn(
      'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
      active
        ? 'border-primary text-primary'
        : 'border-transparent text-secondary hover:border-outline-variant hover:text-primary',
    )}
  >
    <Icon size={15} />
    {label}
  </button>
);

// ── Knowledge tab ─────────────────────────────────────────────────────────────

const KnowledgeTab = ({ snapshot }: { snapshot: AgentMindSnapshot }) => (
  <AgentKnowledgeLensPanel lens={snapshot.lens} />
);

// ── Rules tab ─────────────────────────────────────────────────────────────────

const RuleRow = ({ rule }: { rule: AgentMindRule }) => (
  <div className="flex items-start gap-3 py-3">
    <div className="mt-0.5 flex-none">
      <StatusBadge tone={kindTone(rule.kind)} className="w-28 justify-center">
        {rule.kind}
      </StatusBadge>
    </div>
    <p className="flex-1 text-sm leading-relaxed text-primary">{rule.text}</p>
    <div className="flex-none text-right">
      <p className="text-xs text-secondary">{rule.source}</p>
      {rule.confidence !== undefined && (
        <p className="text-xs text-secondary">
          {Math.round(rule.confidence * 100)}% conf.
        </p>
      )}
    </div>
  </div>
);

const RulesTab = ({ snapshot }: { snapshot: AgentMindSnapshot }) => {
  const { rules } = snapshot;
  const guardrails = rules.filter(r => r.kind === 'GUARDRAIL');
  const responsibilities = rules.filter(r => r.kind === 'RESPONSIBILITY');
  const approaches = rules.filter(r => r.kind === 'APPROACH');
  const learned = rules.filter(r => r.kind === 'LEARNED');
  const governance = rules.filter(r => r.kind === 'GOVERNANCE');

  const groups: Array<{ label: string; items: AgentMindRule[]; icon: LucideIcon }> = [
    { label: 'Guardrails', items: guardrails, icon: ShieldCheck },
    { label: 'Responsibilities', items: responsibilities, icon: CheckCircle2 },
    { label: 'Working approach', items: approaches, icon: Cpu },
    { label: 'Learned', items: learned, icon: Brain },
    { label: 'Governance', items: governance, icon: Layers },
  ].filter(g => g.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Guardrails" value={guardrails.length} />
        <StatTile label="Responsibilities" value={responsibilities.length} />
        <StatTile label="Approaches" value={approaches.length} />
        <StatTile label="Learned" value={learned.length} />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="No rules configured"
          description="Rules are derived from the agent's operating contract and learning notes."
          icon={ShieldCheck}
        />
      ) : (
        groups.map(group => (
          <SectionCard key={group.label} title={group.label} icon={group.icon}>
            <div className="divide-y divide-outline-variant/30">
              {group.items.map(rule => (
                <RuleRow key={rule.id} rule={rule} />
              ))}
            </div>
          </SectionCard>
        ))
      )}
    </div>
  );
};

// ── World tab ─────────────────────────────────────────────────────────────────

const EntityRow = ({ entity }: { entity: AgentWorldEntity }) => (
  <div className="flex items-start gap-3 py-3">
    <div className="mt-0.5 flex-none">
      <StatusBadge tone="neutral" className="w-32 justify-center text-[0.55rem]">
        {entity.kind.replace(/_/g, ' ')}
      </StatusBadge>
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-primary truncate">{entity.label}</p>
      <p className="mt-0.5 text-xs text-secondary line-clamp-2">{entity.summary}</p>
    </div>
    <div className="flex-none text-right">
      <span className={cn('text-xs font-medium', freshnessColor(entity.freshness))}>
        {entity.freshness ?? '—'}
      </span>
      <p className="text-xs text-secondary">{fmtRelative(entity.updatedAt)}</p>
    </div>
  </div>
);

const WorldTab = ({ snapshot }: { snapshot: AgentMindSnapshot }) => {
  const { worldEntities } = snapshot;
  const byKind = worldEntities.reduce<Record<string, AgentWorldEntity[]>>((acc, e) => {
    (acc[e.kind] ??= []).push(e);
    return acc;
  }, {});

  const hot = worldEntities.filter(e => e.freshness === 'HOT').length;
  const warm = worldEntities.filter(e => e.freshness === 'WARM').length;
  const cold = worldEntities.filter(e => e.freshness === 'COLD').length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Total entities" value={worldEntities.length} />
        <StatTile label="Hot" value={hot} />
        <StatTile label="Warm" value={warm} />
        <StatTile label="Cold" value={cold} />
      </div>

      {worldEntities.length === 0 ? (
        <EmptyState
          title="No world model entities"
          description="Entities appear here after memory documents are indexed for this agent."
          icon={Globe}
        />
      ) : (
        Object.entries(byKind).map(([kind, entities]) => (
          <SectionCard key={kind} title={kind.replace(/_/g, ' ')}>
            <div className="divide-y divide-outline-variant/30">
              {entities.map(e => (
                <EntityRow key={e.id} entity={e} />
              ))}
            </div>
          </SectionCard>
        ))
      )}
    </div>
  );
};

// ── Reasoning tab ─────────────────────────────────────────────────────────────

const ReceiptCard = ({ receipt }: { receipt: PersistedPromptReceipt }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="workspace-surface">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 p-4"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-start gap-3 text-left">
          <Clock size={14} className="mt-0.5 flex-none text-secondary" />
          <div>
            <p className="text-sm font-medium text-primary">{fmtTs(receipt.createdAt)}</p>
            <p className="text-xs text-secondary">
              {receipt.scope} · {receipt.model ?? 'unknown model'} ·{' '}
              {receipt.totalEstimatedTokens.toLocaleString()} tokens
            </p>
          </div>
        </div>
        {open ? (
          <ChevronDown size={14} className="flex-none text-secondary" />
        ) : (
          <ChevronRight size={14} className="flex-none text-secondary" />
        )}
      </button>

      {open && (
        <div className="border-t border-outline-variant/30 px-4 pb-4 pt-3 space-y-3">
          {receipt.fragments.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
                Context fragments
              </p>
              <div className="space-y-1.5">
                {receipt.fragments.map((frag, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2"
                  >
                    <div>
                      <span className="text-xs font-medium text-primary">
                        {EPISTEMIC_LABEL[frag.source] ?? frag.source}
                      </span>
                      <span className="ml-2 text-xs text-secondary">{frag.source}</span>
                    </div>
                    <span className="flex-none text-xs text-secondary">
                      {frag.tokens.toLocaleString()} tok
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {receipt.evicted.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary">
                Evicted
              </p>
              <div className="space-y-1.5">
                {receipt.evicted.map((ev, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2"
                  >
                    <span className="text-xs text-secondary line-through">
                      {ev.source}
                    </span>
                    <span className="flex-none text-xs text-secondary">
                      {ev.reason}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

const ReasoningTab = ({ snapshot }: { snapshot: AgentMindSnapshot }) => {
  const { recentReceipts } = snapshot;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Recent receipts" value={recentReceipts.length} />
        <StatTile
          label="Avg tokens"
          value={
            recentReceipts.length
              ? Math.round(
                  recentReceipts.reduce((s, r) => s + r.totalEstimatedTokens, 0) /
                    recentReceipts.length,
                ).toLocaleString()
              : '—'
          }
        />
        <StatTile
          label="Last call"
          value={fmtRelative(recentReceipts[0]?.createdAt)}
        />
      </div>

      {recentReceipts.length === 0 ? (
        <EmptyState
          title="No prompt receipts yet"
          description="Prompt receipts are recorded whenever this agent invokes the LLM. Run a task to generate receipts."
          icon={FlaskConical}
        />
      ) : (
        <div className="space-y-3">
          {recentReceipts.map(receipt => (
            <ReceiptCard key={receipt.id} receipt={receipt} />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Learning tab ──────────────────────────────────────────────────────────────

const TimelineEntry = ({ update }: { update: LearningUpdate }) => (
  <div className="flex items-start gap-3 py-3">
    <div className="mt-0.5 flex-none">
      <StatusBadge tone={triggerTone(update.triggerType)} className="w-36 justify-center text-[0.55rem]">
        {(update.triggerType ?? 'UPDATE').replace(/_/g, ' ')}
      </StatusBadge>
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm text-primary leading-relaxed">{update.insight}</p>
      {update.relatedWorkItemId && (
        <p className="mt-0.5 text-xs text-secondary">
          Work item: {update.relatedWorkItemId}
        </p>
      )}
    </div>
    <p className="flex-none text-xs text-secondary">{fmtRelative(update.timestamp)}</p>
  </div>
);

const VersionRow = ({ version }: { version: AgentLearningProfileVersion }) => (
  <div className="flex items-start gap-3 py-3">
    <div className="mt-0.5 flex-none">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {version.versionNo}
      </span>
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm text-primary line-clamp-2">{version.summary}</p>
      <p className="mt-0.5 text-xs text-secondary">
        {version.sourceCount} sources · {version.contextBlockTokens ?? '?'} tokens
        {version.judgeScore !== undefined && (
          <> · Judge: {(version.judgeScore * 100).toFixed(0)}%</>
        )}
      </p>
    </div>
    <div className="flex-none text-right">
      <StatusBadge
        tone={
          version.status === 'READY'
            ? 'success'
            : version.status === 'ERROR'
            ? 'danger'
            : 'neutral'
        }
      >
        {version.status}
      </StatusBadge>
      <p className="mt-1 text-xs text-secondary">{fmtRelative(version.createdAt)}</p>
    </div>
  </div>
);

const LearningTab = ({ snapshot }: { snapshot: AgentMindSnapshot }) => {
  const { learningTimeline, versionHistory, driftState } = snapshot;

  return (
    <div className="space-y-4">
      {driftState?.isFlagged && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 flex-none text-amber-700" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Drift detected</p>
            <p className="mt-0.5 text-xs text-amber-700">
              {driftState.driftReason ?? 'Negative rate exceeded threshold.'} Flagged{' '}
              {fmtRelative(driftState.driftFlaggedAt)}.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Timeline events" value={learningTimeline.length} />
        <StatTile label="Versions" value={versionHistory.length} />
        <StatTile
          label="Canary requests"
          value={driftState?.canaryRequestCount ?? 0}
        />
      </div>

      <SectionCard title="Timeline" icon={Clock}>
        {learningTimeline.length === 0 ? (
          <p className="py-4 text-center text-sm text-secondary">No learning events yet.</p>
        ) : (
          <div className="divide-y divide-outline-variant/30">
            {learningTimeline.map(update => (
              <TimelineEntry key={update.id} update={update} />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Version history" icon={Layers}>
        {versionHistory.length === 0 ? (
          <p className="py-4 text-center text-sm text-secondary">No versions yet.</p>
        ) : (
          <div className="divide-y divide-outline-variant/30">
            {versionHistory.map(v => (
              <VersionRow key={v.versionId} version={v} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AgentMind() {
  const { activeCapability } = useCapability();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  const agentId = searchParams.get('agentId') ?? '';
  const [activeTab, setActiveTab] = useState<MindTab>('knowledge');
  const [snapshot, setSnapshot] = useState<AgentMindSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capabilityId = activeCapability?.id ?? '';

  const load = useCallback(async () => {
    if (!capabilityId || !agentId) {
      setError('No capability or agent selected.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAgentMindSnapshot(capabilityId, agentId);
      setSnapshot(data);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to load agent mind snapshot.';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [capabilityId, agentId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const agentName = snapshot
    ? snapshot.lens.agentId
    : agentId || 'Agent';

  const tabs: Array<{ id: MindTab; label: string; icon: LucideIcon }> = [
    { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
    { id: 'rules', label: 'Rules', icon: ShieldCheck },
    { id: 'world', label: 'World', icon: Globe },
    { id: 'reasoning', label: 'Reasoning', icon: FlaskConical },
    { id: 'learning', label: 'Learning', icon: Lightbulb },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Agent Mind"
        title={agentName}
        description="Inspect the agent's knowledge, rules, world model, reasoning trace, and learning history."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/team')}
              className="enterprise-button enterprise-button-secondary flex items-center gap-2"
            >
              <ArrowLeft size={14} />
              Back to team
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="enterprise-button enterprise-button-secondary flex items-center gap-2"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        }
      />

      {error && !loading && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle size={16} className="flex-none text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading && !snapshot ? (
        <div className="section-card animate-pulse space-y-6 p-8">
          <div className="h-4 w-48 rounded-full bg-primary/10" />
          <div className="grid gap-4 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 rounded-2xl bg-surface-container-low" />
            ))}
          </div>
          <div className="h-64 rounded-2xl bg-surface-container-low" />
        </div>
      ) : snapshot ? (
        <div className="section-card">
          {/* Tab bar */}
          <div className="flex gap-0 overflow-x-auto border-b border-outline-variant/40 px-2">
            {tabs.map(tab => (
              <TabButton
                key={tab.id}
                id={tab.id}
                label={tab.label}
                icon={tab.icon}
                active={activeTab === tab.id}
                onClick={setActiveTab}
              />
            ))}
          </div>

          {/* Tab content */}
          <div className="p-6">
            {activeTab === 'knowledge' && <KnowledgeTab snapshot={snapshot} />}
            {activeTab === 'rules' && <RulesTab snapshot={snapshot} />}
            {activeTab === 'world' && <WorldTab snapshot={snapshot} />}
            {activeTab === 'reasoning' && <ReasoningTab snapshot={snapshot} />}
            {activeTab === 'learning' && <LearningTab snapshot={snapshot} />}
          </div>
        </div>
      ) : null}
    </div>
  );
}
