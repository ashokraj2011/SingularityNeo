import React from 'react';
import type {
  AgentKnowledgeLens,
  AgentLearningDriftState,
  AgentLearningProfileVersion,
} from '../types';
import { StatusBadge } from './EnterpriseUI';
import {
  activateAgentLearningProfileVersion,
  fetchAgentLearningDriftState,
  fetchAgentLearningProfileVersions,
} from '../lib/api';

const freshnessTone = (value: AgentKnowledgeLens['freshnessSignal']) => {
  switch (value) {
    case 'FRESH':
      return 'success' as const;
    case 'ACTIVE':
      return 'info' as const;
    case 'STALE':
      return 'warning' as const;
    case 'ERROR':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
};

const confidenceTone = (value: AgentKnowledgeLens['confidenceSignal']) => {
  switch (value) {
    case 'HIGH':
      return 'success' as const;
    case 'MEDIUM':
      return 'info' as const;
    default:
      return 'warning' as const;
  }
};

const renderList = (items: string[], emptyLabel: string, compact?: boolean) =>
  items.length > 0 ? (
    <ul className="mt-3 space-y-1 text-xs leading-relaxed text-secondary">
      {items.slice(0, compact ? 3 : 5).map(item => (
        <li key={item} className="flex gap-2">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="mt-3 text-xs leading-relaxed text-secondary">{emptyLabel}</p>
  );

/**
 * Slice C — drift banner. Polls the drift endpoint once on mount, shows a red
 * banner when the backend has flagged the current version as regressing
 * against the previous baseline, and offers a single-click "Revert to v{N-1}"
 * that reuses the Slice A activate-version endpoint. Per the locked plan
 * decision drift is **manual-approve only** — this component never triggers a
 * revert on its own.
 */
const ProfileDriftBanner = ({
  capabilityId,
  agentId,
}: {
  capabilityId: string;
  agentId: string;
}) => {
  const [state, setState] = React.useState<AgentLearningDriftState | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isReverting, setIsReverting] = React.useState(false);
  const [revertError, setRevertError] = React.useState<string | null>(null);
  const [reverted, setReverted] = React.useState(false);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await fetchAgentLearningDriftState(capabilityId, agentId);
      setState(result.state);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load drift state.');
    } finally {
      setIsLoading(false);
    }
  }, [capabilityId, agentId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleRevert = React.useCallback(async () => {
    if (!state?.previousVersionId) return;
    setIsReverting(true);
    setRevertError(null);
    try {
      await activateAgentLearningProfileVersion(
        capabilityId,
        agentId,
        state.previousVersionId,
        { reason: state.driftReason || 'Reverted after drift flag' },
      );
      setReverted(true);
    } catch (error) {
      setRevertError(
        error instanceof Error ? error.message : 'Unable to revert to previous version.',
      );
    } finally {
      setIsReverting(false);
    }
  }, [capabilityId, agentId, state?.previousVersionId, state?.driftReason]);

  if (isLoading) return null;
  if (loadError) {
    return (
      <div className="mt-4 rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/20 px-4 py-3">
        <p className="text-xs leading-relaxed text-secondary">{loadError}</p>
      </div>
    );
  }
  if (!state || !state.isFlagged) return null;

  const deltaLabel =
    typeof state.negativeRateDelta === 'number'
      ? `${(state.negativeRateDelta * 100).toFixed(1)} pp`
      : null;

  return (
    <div className="mt-4 rounded-[1.25rem] border border-error/40 bg-error-container/30 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <StatusBadge tone="danger">Drift detected</StatusBadge>
            {deltaLabel ? (
              <span className="text-[0.72rem] font-semibold text-error">
                +{deltaLabel} negative rate vs baseline
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-on-surface">
            {state.driftReason ||
              'Current profile version is regressing vs. the previous baseline.'}
          </p>
          {state.lastCheckedAt ? (
            <p className="mt-1 text-[0.72rem] text-secondary">
              Last checked {new Date(state.lastCheckedAt).toLocaleString()}
            </p>
          ) : null}
          {revertError ? (
            <p className="mt-2 text-[0.72rem] leading-relaxed text-error">{revertError}</p>
          ) : null}
          {reverted ? (
            <p className="mt-2 text-[0.72rem] leading-relaxed text-success">
              Reverted. The previous version is now live — refresh to see updated state.
            </p>
          ) : null}
        </div>
        {state.previousVersionId && !reverted ? (
          <button
            type="button"
            disabled={isReverting}
            onClick={() => void handleRevert()}
            className="rounded-full border border-error/60 bg-error/10 px-3 py-1 text-[0.72rem] font-semibold text-error transition hover:bg-error/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isReverting ? 'Reverting…' : 'Revert to previous version'}
          </button>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Slice A — version history disclosure. Lazily fetches the append-only
 * version history for the agent's learning profile so the UI is read-only +
 * cheap until the operator actually wants to see it. Slice C adds the
 * drift banner + revert button above this disclosure.
 */
const ProfileVersionHistoryDisclosure = ({
  capabilityId,
  agentId,
  currentVersionId,
}: {
  capabilityId: string;
  agentId: string;
  currentVersionId?: string;
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const [versions, setVersions] = React.useState<AgentLearningProfileVersion[] | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const loadVersions = React.useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await fetchAgentLearningProfileVersions(capabilityId, agentId, {
        limit: 20,
      });
      setVersions(result.versions);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load version history.');
    } finally {
      setIsLoading(false);
    }
  }, [capabilityId, agentId]);

  const handleToggle = () => {
    setExpanded(previous => {
      const next = !previous;
      if (next && versions === null && !isLoading) {
        void loadVersions();
      }
      return next;
    });
  };

  return (
    <div className="mt-4 rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/20 px-4 py-3">
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <span className="text-sm font-semibold text-on-surface">Version history</span>
        <span className="text-[0.72rem] text-secondary">
          {expanded ? 'Hide' : 'Show'}
        </span>
      </button>
      {expanded ? (
        <div className="mt-3">
          {isLoading ? (
            <p className="text-xs leading-relaxed text-secondary">Loading versions…</p>
          ) : loadError ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs leading-relaxed text-error">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadVersions()}
                className="text-[0.72rem] font-semibold text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          ) : versions && versions.length > 0 ? (
            <ul className="space-y-2">
              {versions.map(version => {
                const isCurrent = currentVersionId === version.versionId;
                const isReviewPending = version.status === 'REVIEW_PENDING';
                const statusTone = isCurrent
                  ? 'success'
                  : isReviewPending
                    ? 'warning'
                    : 'neutral';
                const judgeScore =
                  typeof version.judgeScore === 'number' ? version.judgeScore : null;
                const judgeTone =
                  judgeScore === null
                    ? 'neutral'
                    : judgeScore >= 0.8
                      ? 'success'
                      : judgeScore >= 0.6
                        ? 'info'
                        : 'warning';
                return (
                  <li
                    key={version.versionId}
                    className="rounded-2xl border border-outline-variant/20 bg-white px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-on-surface">
                        v{version.versionNo}
                      </span>
                      <StatusBadge tone={statusTone}>
                        {isCurrent ? 'Current' : version.status}
                      </StatusBadge>
                      {judgeScore !== null ? (
                        <StatusBadge tone={judgeTone}>
                          Judge {judgeScore.toFixed(2)}
                        </StatusBadge>
                      ) : null}
                      <span className="text-[0.72rem] text-secondary">
                        {new Date(version.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {isReviewPending ? (
                      <p className="mt-1 text-[0.72rem] leading-relaxed text-warning">
                        Shape check failed — previous version is still serving this agent.
                      </p>
                    ) : null}
                    {version.summary ? (
                      <p className="mt-1 line-clamp-2 text-[0.72rem] leading-relaxed text-secondary">
                        {version.summary}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs leading-relaxed text-secondary">
              No prior versions recorded yet. A new version is created on every successful
              refresh.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
};

export const AgentKnowledgeLensPanel = ({
  lens,
  title = 'What this agent knows now',
  compact = false,
  versionHistory,
}: {
  lens: AgentKnowledgeLens;
  title?: string;
  compact?: boolean;
  /**
   * Slice A — when the caller has the capability + agent IDs, render a
   * collapsible version-history disclosure that lazily loads the append-only
   * profile-version log. Omit to preserve the legacy read-only view.
   */
  versionHistory?: {
    capabilityId: string;
    agentId: string;
    currentVersionId?: string;
  };
}) => (
  <div className="workspace-meta-card">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="workspace-meta-label">{title}</p>
        <p className="mt-2 text-sm leading-relaxed text-on-surface">{lens.summary}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={freshnessTone(lens.freshnessSignal)}>
          {lens.freshnessSignal}
        </StatusBadge>
        <StatusBadge tone={confidenceTone(lens.confidenceSignal)}>
          {lens.confidenceSignal} confidence
        </StatusBadge>
        {lens.profileStatus === 'REVIEW_PENDING' ? (
          <StatusBadge tone="warning">Review pending</StatusBadge>
        ) : null}
      </div>
    </div>
    {lens.lastError ? (
      /* Slice D — error chip. Operators can copy the message to their
         incident channel; the full error survives in capability_learning_updates
         (triggerType=PIPELINE_ERROR) for postmortem. */
      <div className="mt-3 flex flex-wrap items-start justify-between gap-2 rounded-[1rem] border border-error/40 bg-error-container/20 px-3 py-2">
        <div className="flex-1">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-error">
            Pipeline error
          </p>
          <p className="mt-1 text-xs leading-relaxed text-on-surface break-all">
            {lens.lastError}
          </p>
          {lens.profileStatus === 'REVIEW_PENDING' ? (
            <p className="mt-1 text-[0.72rem] leading-relaxed text-secondary">
              The previous profile version is still serving inference while this candidate
              waits for operator review.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              void navigator.clipboard.writeText(lens.lastError || '').catch(() => undefined);
            }
          }}
          className="rounded-full border border-error/40 bg-white/60 px-3 py-1 text-[0.72rem] font-semibold text-error transition hover:bg-white"
        >
          Copy
        </button>
      </div>
    ) : null}
    {lens.derivationMode ? (
      <div className="mt-3 rounded-[1rem] border border-outline-variant/25 bg-surface-container-low/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={lens.derivationMode === 'OWNER_DERIVED' ? 'info' : 'neutral'}>
            {lens.derivationMode === 'OWNER_DERIVED'
              ? 'Capability-derived learning'
              : lens.derivationMode === 'OWNER_DISTILLED'
                ? 'Owner-distilled learning'
                : 'Agent-specific learning'}
          </StatusBadge>
          {lens.derivedFromAgentName ? (
            <span className="text-xs text-secondary">
              Source agent: <strong>{lens.derivedFromAgentName}</strong>
            </span>
          ) : null}
          {lens.sourceVersionId ? (
            <span className="text-xs text-secondary">
              Source version: <strong>{lens.sourceVersionId}</strong>
            </span>
          ) : null}
        </div>
      </div>
    ) : null}

    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <div className="rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/30 px-4 py-3">
        <p className="text-sm font-semibold text-on-surface">Base role knowledge</p>
        {renderList(
          lens.baseRoleKnowledge,
          'No structured role knowledge has been attached yet.',
          compact,
        )}
      </div>
      <div className="rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/30 px-4 py-3">
        <p className="text-sm font-semibold text-on-surface">Capability knowledge</p>
        {renderList(
          lens.capabilityKnowledge,
          'No capability-specific knowledge has been surfaced yet.',
          compact,
        )}
      </div>
      <div className="rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/30 px-4 py-3">
        <p className="text-sm font-semibold text-on-surface">Live execution learning</p>
        {renderList(
          lens.liveExecutionLearning,
          'The agent has not learned from recent work yet.',
          compact,
        )}
      </div>
      <div className="rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/30 px-4 py-3">
        <p className="text-sm font-semibold text-on-surface">Why the agent believes this</p>
        {lens.provenance.length > 0 ? (
          <div className="mt-3 space-y-2">
            {lens.provenance.slice(0, compact ? 3 : 5).map(source => (
              <div key={source.id} className="rounded-2xl border border-outline-variant/20 bg-white px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-on-surface">{source.label}</p>
                  <StatusBadge tone="neutral">{source.kind}</StatusBadge>
                </div>
                {source.summary ? (
                  <p className="mt-1 text-xs leading-relaxed text-secondary">{source.summary}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-secondary">
            Provenance detail will appear after learning and execution history accumulate.
          </p>
        )}
      </div>
    </div>

    {lens.deltas.length > 0 ? (
      <div className="mt-4 rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/20 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-on-surface">What changed since the last attempt</p>
          <StatusBadge tone="info">{lens.deltas.length} deltas</StatusBadge>
        </div>
        <div className="mt-3 space-y-2">
          {lens.deltas.slice(0, compact ? 2 : 4).map(delta => (
            <div key={delta.id} className="rounded-2xl border border-outline-variant/20 bg-white px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="neutral">
                  {delta.triggerType ? delta.triggerType.replace(/_/g, ' ') : 'UPDATE'}
                </StatusBadge>
                <span className="text-[0.72rem] text-secondary">{delta.timestamp}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-secondary">{delta.insight}</p>
            </div>
          ))}
        </div>
      </div>
    ) : null}

    {versionHistory ? (
      <>
        <ProfileDriftBanner
          capabilityId={versionHistory.capabilityId}
          agentId={versionHistory.agentId}
        />
        <ProfileVersionHistoryDisclosure
          capabilityId={versionHistory.capabilityId}
          agentId={versionHistory.agentId}
          currentVersionId={versionHistory.currentVersionId}
        />
      </>
    ) : null}
  </div>
);

export default AgentKnowledgeLensPanel;
