import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ClipboardList,
  ExternalLink,
  FolderKanban,
  Hash,
  Link2,
  LoaderCircle,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  EmptyState,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { listStoryProposalBatches } from '../lib/api';
import { hasPermission } from '../lib/accessControl';
import { formatTimestamp } from '../lib/orchestrator/support';
import { cn } from '../lib/utils';
import type { Capability, StoryProposalBatchSummary } from '../types';

type CapabilityBatchSummary = {
  capability: Capability;
  batches: StoryProposalBatchSummary[];
};

type PlannerFocusFilter = 'ALL' | 'PENDING' | 'QUEUED';
type PlannerScopeFilter = 'ALL' | 'MINE';

interface JiraEpicContext {
  epicId: string;
  epicName: string;
}

const proposalStatusTone: Record<
  StoryProposalBatchSummary['status'],
  React.ComponentProps<typeof StatusBadge>['tone']
> = {
  DRAFT: 'neutral',
  REVIEW_READY: 'info',
  APPROVED: 'success',
  PARTIALLY_APPROVED: 'warning',
  DISCARDED: 'danger',
};

const proposalStatusAccent: Record<StoryProposalBatchSummary['status'], string> = {
  DRAFT: 'border-l-outline-variant/40',
  REVIEW_READY: 'border-l-info',
  APPROVED: 'border-l-success',
  PARTIALLY_APPROVED: 'border-l-warning',
  DISCARDED: 'border-l-danger',
};

const compareBatchUpdatedAt = (
  left: StoryProposalBatchSummary,
  right: StoryProposalBatchSummary,
) => Date.parse(right.updatedAt || right.createdAt || '') - Date.parse(left.updatedAt || left.createdAt || '');

const getBatchPendingCount = (batch: StoryProposalBatchSummary) =>
  Math.max(batch.itemCount - batch.promotedCount - batch.rejectedCount, 0);

const normalizeLookupValue = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase();

// ─── JIRA Epic Panel ──────────────────────────────────────────────────────────

interface JiraEpicPanelProps {
  value: JiraEpicContext;
  onChange: (next: JiraEpicContext) => void;
  capabilityJiraBoardLink?: string;
}

function JiraEpicPanel({ value, onChange, capabilityJiraBoardLink }: JiraEpicPanelProps) {
  const hasEpic = Boolean(value.epicId.trim() || value.epicName.trim());

  return (
    <div className="rounded-[1.75rem] border border-outline-variant/25 bg-surface-container-low/35 p-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Link2 size={15} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-on-surface">JIRA Epic</p>
            <p className="text-xs text-secondary">
              Link an epic before opening the planner so the agent has context
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {capabilityJiraBoardLink ? (
            <a
              href={capabilityJiraBoardLink}
              target="_blank"
              rel="noreferrer"
              className="enterprise-button enterprise-button-secondary gap-1.5 text-xs"
            >
              <ExternalLink size={13} />
              Open board
            </a>
          ) : null}
          {hasEpic && (
            <button
              type="button"
              onClick={() => onChange({ epicId: '', epicName: '' })}
              className="enterprise-button enterprise-button-secondary gap-1.5 text-xs"
              title="Clear JIRA epic"
            >
              <X size={13} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Inputs */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {/* Epic ID */}
        <div className="group relative flex items-center gap-2 rounded-2xl border border-outline-variant/30 bg-surface/60 px-3.5 py-2.5 transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
          <Hash size={14} className="shrink-0 text-secondary group-focus-within:text-primary" />
          <div className="flex-1 min-w-0">
            <label className="block text-[0.65rem] font-semibold uppercase tracking-wide text-secondary">
              Epic ID
            </label>
            <input
              type="text"
              value={value.epicId}
              onChange={e => onChange({ ...value, epicId: e.target.value })}
              placeholder="e.g. PROJ-123"
              className="w-full bg-transparent text-sm text-on-surface placeholder:text-secondary/50 focus:outline-none"
            />
          </div>
        </div>

        {/* Epic Name */}
        <div className="group relative flex items-center gap-2 rounded-2xl border border-outline-variant/30 bg-surface/60 px-3.5 py-2.5 transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
          <Tag size={14} className="shrink-0 text-secondary group-focus-within:text-primary" />
          <div className="flex-1 min-w-0">
            <label className="block text-[0.65rem] font-semibold uppercase tracking-wide text-secondary">
              Epic Name
            </label>
            <input
              type="text"
              value={value.epicName}
              onChange={e => onChange({ ...value, epicName: e.target.value })}
              placeholder="e.g. User Authentication Module"
              className="w-full bg-transparent text-sm text-on-surface placeholder:text-secondary/50 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Linked badge */}
      {hasEpic && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {value.epicId.trim() && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[0.72rem] font-medium text-primary">
              <Hash size={11} />
              {value.epicId.trim()}
            </span>
          )}
          {value.epicName.trim() && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container px-3 py-1 text-[0.72rem] text-secondary">
              {value.epicName.trim()}
            </span>
          )}
          <span className="text-[0.7rem] text-secondary/60">
            Will be passed to the planner when you open a capability
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PlanningHub() {
  const navigate = useNavigate();
  const {
    activeCapability,
    capabilities,
    currentActorContext,
    workspaceOrganization,
    setActiveCapability,
  } = useCapability();
  const [capabilitySummaries, setCapabilitySummaries] = useState<CapabilityBatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [focusFilter, setFocusFilter] = useState<PlannerFocusFilter>('ALL');
  const [scopeFilter, setScopeFilter] = useState<PlannerScopeFilter>('ALL');
  const [jiraEpic, setJiraEpic] = useState<JiraEpicContext>({ epicId: '', epicName: '' });

  const readableCapabilities = useMemo(
    () =>
      capabilities.filter(
        capability =>
          capability.status !== 'ARCHIVED' &&
          hasPermission(capability.effectivePermissions, 'capability.read'),
      ),
    [capabilities],
  );

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const results = await Promise.all(
          readableCapabilities.map(async capability => ({
            capability,
            batches: await listStoryProposalBatches(capability.id),
          })),
        );
        if (!isMounted) {
          return;
        }
        setCapabilitySummaries(results);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Unable to load planning batches.',
        );
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      isMounted = false;
    };
  }, [readableCapabilities]);

  const mineCapabilityIds = useMemo(() => {
    const actorTeamIds = new Set(
      (currentActorContext.teamIds || []).map(teamId => String(teamId || '').trim()).filter(Boolean),
    );
    const actorCapabilityIds = new Set<string>();
    const actorTeamNames = new Set<string>();

    workspaceOrganization.capabilityMemberships.forEach(membership => {
      if (
        (membership.userId && membership.userId === currentActorContext.userId) ||
        (membership.teamId && actorTeamIds.has(membership.teamId))
      ) {
        actorCapabilityIds.add(membership.capabilityId);
      }
    });

    workspaceOrganization.teams.forEach(team => {
      if (!actorTeamIds.has(team.id)) {
        return;
      }
      actorTeamNames.add(normalizeLookupValue(team.name));
      team.capabilityIds.forEach(capabilityId => actorCapabilityIds.add(capabilityId));
    });

    const hasGlobalScope = Boolean(
      currentActorContext.workspaceRoles?.some(
        role => role === 'WORKSPACE_ADMIN' || role === 'PORTFOLIO_OWNER',
      ),
    );

    if (hasGlobalScope) {
      readableCapabilities.forEach(capability => actorCapabilityIds.add(capability.id));
    }

    readableCapabilities.forEach(capability => {
      if (actorCapabilityIds.has(capability.id)) {
        return;
      }
      const capabilityTeamNames = [capability.ownerTeam, ...capability.teamNames]
        .map(entry => normalizeLookupValue(entry))
        .filter(Boolean);
      if (capabilityTeamNames.some(teamName => actorTeamNames.has(teamName))) {
        actorCapabilityIds.add(capability.id);
        return;
      }
      if ((capability.effectivePermissions?.capabilityRoles?.length || 0) > 0) {
        actorCapabilityIds.add(capability.id);
      }
    });

    return actorCapabilityIds;
  }, [currentActorContext, readableCapabilities, workspaceOrganization]);

  const capabilityCards = useMemo(
    () =>
      capabilitySummaries.map(summary => {
        const latestBatch = summary.batches[0] || null;
        const pendingCount = summary.batches.reduce(
          (sum, batch) => sum + getBatchPendingCount(batch),
          0,
        );
        const queuedCount = summary.batches.reduce(
          (sum, batch) => sum + batch.promotedCount,
          0,
        );
        return {
          ...summary,
          latestBatch,
          pendingCount,
          queuedCount,
          isMine: mineCapabilityIds.has(summary.capability.id),
        };
      }),
    [capabilitySummaries, mineCapabilityIds],
  );

  const filteredCapabilityCards = useMemo(
    () =>
      capabilityCards.filter(summary => {
        if (scopeFilter === 'MINE' && !summary.isMine) {
          return false;
        }
        if (focusFilter === 'PENDING') {
          return summary.pendingCount > 0;
        }
        if (focusFilter === 'QUEUED') {
          return summary.queuedCount > 0;
        }
        return true;
      }),
    [capabilityCards, focusFilter, scopeFilter],
  );

  const recentBatches = useMemo(
    () =>
      filteredCapabilityCards
        .flatMap(summary =>
          summary.batches
            .filter(batch => {
              if (focusFilter === 'PENDING') {
                return getBatchPendingCount(batch) > 0;
              }
              if (focusFilter === 'QUEUED') {
                return batch.promotedCount > 0;
              }
              return true;
            })
            .map(batch => ({
              capability: summary.capability,
              batch,
            })),
        )
        .sort((left, right) => compareBatchUpdatedAt(left.batch, right.batch)),
    [filteredCapabilityCards, focusFilter],
  );

  const visibleCapabilityCount = filteredCapabilityCards.length;
  const totalBatchCount = recentBatches.length;
  const capabilityCountWithPlans = filteredCapabilityCards.filter(
    summary => summary.batches.length > 0,
  ).length;
  const pendingBatchCount = recentBatches.filter(
    ({ batch }) => getBatchPendingCount(batch) > 0,
  ).length;
  const queuedWorkItemCount = recentBatches.reduce(
    (sum, { batch }) => sum + batch.promotedCount,
    0,
  );

  const buildJiraParams = () => {
    const params = new URLSearchParams();
    if (jiraEpic.epicId.trim()) params.set('jiraEpicId', jiraEpic.epicId.trim());
    if (jiraEpic.epicName.trim()) params.set('jiraEpicName', jiraEpic.epicName.trim());
    const qs = params.toString();
    return qs ? `&${qs}` : '';
  };

  const openPlanner = (capability: Capability, batchId?: string) => {
    setActiveCapability(capability);
    const batchParam = batchId ? `?batch=${encodeURIComponent(batchId)}${buildJiraParams()}` : buildJiraParams() ? `?${buildJiraParams().slice(1)}` : '';
    navigate(`/planning/${encodeURIComponent(capability.id)}/story-proposals${batchParam}`);
  };

  const hasLinkedEpic = Boolean(jiraEpic.epicId.trim() || jiraEpic.epicName.trim());

  return (
    <div className="space-y-6">
      {/* ── Hero header ───────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[2rem] border border-primary/15 bg-gradient-to-br from-primary/8 via-surface-container-low/60 to-surface-container-low/20 px-6 py-7 sm:px-8">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-primary/6 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-8 right-24 h-32 w-32 rounded-full bg-info/8 blur-2xl" />

        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-primary">
                <Sparkles size={11} />
                Planning
              </span>
              {hasLinkedEpic && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface/70 px-3 py-0.5 text-[0.7rem] font-medium text-secondary">
                  <Link2 size={11} />
                  {jiraEpic.epicId.trim() || jiraEpic.epicName.trim()}
                </span>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
              Planning home
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-secondary">
              Review planning batches across capabilities, see what is still pending, and jump into
              the right planner when it is time to shape or queue new work.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openPlanner(activeCapability)}
            className="enterprise-button enterprise-button-primary shrink-0 gap-2 px-5 py-2.5"
          >
            <Sparkles size={16} />
            Plan current capability
          </button>
        </div>
      </div>

      {/* ── Stats row ─────────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <StatTile label="Visible capabilities" value={visibleCapabilityCount} tone="brand" />
        <StatTile label="With plans" value={capabilityCountWithPlans} tone="info" />
        <StatTile label="Pending batches" value={pendingBatchCount} tone="warning" />
        <StatTile label="Queued work items" value={queuedWorkItemCount} tone="success" />
      </section>

      {/* ── JIRA Epic capture ──────────────────────────────────────────── */}
      <JiraEpicPanel
        value={jiraEpic}
        onChange={setJiraEpic}
        capabilityJiraBoardLink={activeCapability.jiraBoardLink ?? undefined}
      />

      {/* ── Filters ── compact segmented-control bar ──────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-outline-variant/20 bg-surface-container-low/40 px-4 py-3">
        {/* Focus group */}
        <div className="flex items-center gap-0.5 rounded-xl bg-surface/70 p-1 shadow-inner">
          {([
            { id: 'ALL', label: 'All batches' },
            { id: 'PENDING', label: 'Pending' },
            { id: 'QUEUED', label: 'Queued' },
          ] as const).map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFocusFilter(option.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                focusFilter === option.id
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-secondary hover:bg-surface-container hover:text-on-surface',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="h-5 w-px shrink-0 bg-outline-variant/30" />

        {/* Scope group */}
        <div className="flex items-center gap-0.5 rounded-xl bg-surface/70 p-1 shadow-inner">
          {([
            { id: 'ALL', label: 'All' },
            { id: 'MINE', label: 'Mine' },
          ] as const).map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => setScopeFilter(option.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                scopeFilter === option.id
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-secondary hover:bg-surface-container hover:text-on-surface',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Spacer + result counts */}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <span className="text-[0.72rem] text-secondary">
            <span className="font-semibold text-on-surface">{visibleCapabilityCount}</span>{' '}
            {visibleCapabilityCount === 1 ? 'capability' : 'capabilities'}
          </span>
          <span className="h-3 w-px bg-outline-variant/30" />
          <span className="text-[0.72rem] text-secondary">
            <span className="font-semibold text-on-surface">{totalBatchCount}</span>{' '}
            {totalBatchCount === 1 ? 'batch' : 'batches'}
          </span>
          {scopeFilter === 'MINE' && (
            <>
              <span className="h-3 w-px bg-outline-variant/30" />
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.68rem] font-medium text-primary">
                My scope
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────── */}
      {loading ? (
        <SectionCard
          title="Loading planning home"
          description="Collecting planning batches across capabilities."
          icon={LoaderCircle}
        >
          <div className="flex items-center gap-2 text-sm text-secondary">
            <LoaderCircle size={16} className="animate-spin" />
            Loading planning batch history…
          </div>
        </SectionCard>
      ) : loadError ? (
        <EmptyState
          title="Planning home could not load"
          description={loadError}
          icon={ClipboardList}
          className="min-h-[24rem]"
        />
      ) : (
        <>
          {/* ── Capability planners ─────────────────────────────────── */}
          <SectionCard
            title="Capability planners"
            description="Each capability keeps its own planning workspace. This home gives you one place to see where planning is active."
            icon={FolderKanban}
          >
            {readableCapabilities.length === 0 ? (
              <EmptyState
                title="No readable capabilities"
                description="Planning becomes available once the current operator can read at least one capability."
                icon={FolderKanban}
                className="min-h-[16rem]"
              />
            ) : filteredCapabilityCards.length === 0 ? (
              <EmptyState
                title="No planners match these filters"
                description="Try switching back to all batches or all capabilities to widen the planning view."
                icon={FolderKanban}
                className="min-h-[16rem]"
              />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {filteredCapabilityCards.map(summary => {
                  const isActive = summary.capability.id === activeCapability.id;
                  const latestStatus = summary.latestBatch?.status;
                  const accentBorder = latestStatus
                    ? proposalStatusAccent[latestStatus]
                    : 'border-l-outline-variant/40';

                  return (
                    <div
                      key={summary.capability.id}
                      className={cn(
                        'group relative flex flex-col rounded-[1.75rem] border border-l-4 p-5 transition',
                        accentBorder,
                        isActive
                          ? 'border-primary/20 bg-primary/5'
                          : 'border-outline-variant/25 bg-surface-container-low/35 hover:border-primary/15 hover:bg-primary/3',
                      )}
                    >
                      {/* Card header */}
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="form-kicker">{summary.capability.id}</p>
                          <h2 className="mt-1 text-base font-bold leading-snug text-on-surface">
                            {summary.capability.name}
                          </h2>
                          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-secondary">
                            {summary.capability.businessOutcome ||
                              summary.capability.description ||
                              'No business outcome captured yet.'}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {summary.latestBatch ? (
                            <StatusBadge tone={proposalStatusTone[summary.latestBatch.status]}>
                              {summary.latestBatch.status.replace(/_/g, ' ')}
                            </StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">No batches yet</StatusBadge>
                          )}
                          {summary.isMine && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-medium text-primary">
                              Mine
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Stats strip */}
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Pill value={summary.batches.length} label="batches" />
                        <Pill value={summary.pendingCount} label="pending" tone="warning" />
                        <Pill value={summary.queuedCount} label="queued" tone="success" />
                        {summary.latestBatch ? (
                          <span className="text-[0.7rem] text-secondary/70">
                            Updated {formatTimestamp(summary.latestBatch.updatedAt)}
                          </span>
                        ) : null}
                      </div>

                      {/* JIRA epic indicator */}
                      {hasLinkedEpic && (
                        <div className="mt-3 flex items-center gap-1.5 rounded-xl border border-outline-variant/20 bg-surface/50 px-3 py-1.5">
                          <Link2 size={12} className="shrink-0 text-secondary" />
                          <span className="text-[0.7rem] text-secondary">
                            Epic:{' '}
                            <span className="font-medium text-on-surface">
                              {[jiraEpic.epicId, jiraEpic.epicName].filter(Boolean).join(' — ')}
                            </span>
                          </span>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openPlanner(summary.capability, summary.latestBatch?.id)}
                          className="enterprise-button enterprise-button-primary gap-1.5"
                        >
                          <ArrowRight size={15} />
                          {summary.latestBatch ? 'Open latest batch' : 'Open planner'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openPlanner(summary.capability)}
                          className="enterprise-button enterprise-button-secondary gap-1.5"
                        >
                          <Sparkles size={15} />
                          Generate or review
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* ── Recent planning batches ─────────────────────────────── */}
          <SectionCard
            title="Recent planning batches"
            description="Resume the newest planning work regardless of which capability it belongs to."
            icon={ClipboardList}
          >
            {capabilitySummaries.flatMap(summary => summary.batches).length === 0 ? (
              <EmptyState
                title="No planning batches yet"
                description="Open a capability planner to generate the first epic and child story proposals."
                icon={Sparkles}
                action={
                  <button
                    type="button"
                    onClick={() => openPlanner(activeCapability)}
                    className="enterprise-button enterprise-button-primary"
                  >
                    <Sparkles size={16} />
                    Open current capability planner
                  </button>
                }
                className="min-h-[16rem]"
              />
            ) : totalBatchCount === 0 ? (
              <EmptyState
                title="No batches match these filters"
                description="The current filter combination is valid, but it does not surface any planning batches yet."
                icon={ClipboardList}
                className="min-h-[16rem]"
              />
            ) : (
              <div className="space-y-2">
                {recentBatches.slice(0, 12).map(({ capability, batch }) => {
                  const pendingCount = getBatchPendingCount(batch);
                  const latestStatus = batch.status;
                  const accentBorder = proposalStatusAccent[latestStatus];

                  return (
                    <button
                      key={`${capability.id}:${batch.id}`}
                      type="button"
                      onClick={() => openPlanner(capability, batch.id)}
                      className={cn(
                        'w-full rounded-[1.5rem] border border-l-4 bg-surface-container-low/35 px-4 py-4 text-left transition',
                        accentBorder,
                        'border-outline-variant/25 hover:border-primary/20 hover:bg-primary/5',
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="form-kicker">{capability.name}</p>
                            <span className="rounded-md bg-surface-container px-1.5 py-0.5 font-mono text-[0.65rem] text-secondary">
                              {batch.id}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-on-surface">
                            {batch.title}
                          </p>
                          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-secondary">
                            {batch.summary}
                          </p>
                        </div>
                        <StatusBadge tone={proposalStatusTone[batch.status]}>
                          {batch.status.replace(/_/g, ' ')}
                        </StatusBadge>
                      </div>

                      {/* Batch stats */}
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Pill value={batch.itemCount} label="items" />
                        <Pill value={pendingCount} label="pending" tone="warning" />
                        <Pill value={batch.promotedCount} label="queued" tone="success" />
                        <span className="text-[0.7rem] text-secondary/70">
                          {formatTimestamp(batch.updatedAt)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Pill({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: 'warning' | 'success';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.68rem] font-medium',
        tone === 'warning' && value > 0
          ? 'bg-warning/10 text-warning'
          : tone === 'success' && value > 0
            ? 'bg-success/10 text-success'
            : 'bg-surface-container text-secondary',
      )}
    >
      <span className="font-bold">{value}</span>
      {label}
    </span>
  );
}
