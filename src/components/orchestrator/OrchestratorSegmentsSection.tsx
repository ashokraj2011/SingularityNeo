import React, { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { StatusBadge } from '../EnterpriseUI';
import type { Capability, NextSegmentPreset, WorkItemSegment } from '../../types';
import { getLifecyclePhaseLabel } from '../../lib/capabilityLifecycle';
import {
  listCapabilityWorkItemSegments,
  retryCapabilityWorkItemSegment,
  updateCapabilityWorkItemBrief,
} from '../../lib/api';

type Props = {
  capability: Capability | null;
  workItemId: string | null;
  workItemBrief?: string | null;
  actorDisplayName?: string;
  canEdit: boolean;
  hasActiveRun?: boolean;
  nextSegmentPreset?: NextSegmentPreset | null;
  onStartSegment?: () => void;
  onStartNextSegment?: () => void;
  onAfterRetry?: () => void;
};

const statusTone = (status: WorkItemSegment['status']) => {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'CANCELLED':
      return 'neutral';
    case 'RUNNING':
      return 'info';
    case 'WAITING':
      return 'warning';
    default:
      return 'neutral';
  }
};

const fmtDuration = (start?: string, end?: string) => {
  if (!start) return '—';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const sec = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

/**
 * OrchestratorSegmentsSection — rendered in the selected-work sidebar
 * alongside the operate panel. Fetches segments for the currently
 * selected work item, renders them newest-first with expand-to-view
 * intention and retry controls for failed/cancelled segments. Also
 * hosts the long-lived "brief" editor since both live at the work-item
 * level and share the same selection.
 */
export const OrchestratorSegmentsSection: React.FC<Props> = ({
  capability,
  workItemId,
  workItemBrief,
  canEdit,
  hasActiveRun = false,
  nextSegmentPreset,
  onStartSegment,
  onStartNextSegment,
  onAfterRetry,
}) => {
  const [segments, setSegments] = useState<WorkItemSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Brief editor local state: seeded from props, committed via API on blur.
  const [briefDraft, setBriefDraft] = useState(workItemBrief || '');
  const [briefDirty, setBriefDirty] = useState(false);
  const [briefSaving, setBriefSaving] = useState(false);
  useEffect(() => {
    setBriefDraft(workItemBrief || '');
    setBriefDirty(false);
  }, [workItemBrief, workItemId]);

  const refreshSegments = useCallback(async () => {
    if (!capability || !workItemId) {
      setSegments([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await listCapabilityWorkItemSegments(
        capability.id,
        workItemId,
      );
      setSegments(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load segments.');
    } finally {
      setLoading(false);
    }
  }, [capability, workItemId]);

  useEffect(() => {
    void refreshSegments();
  }, [refreshSegments]);

  const handleRetry = useCallback(
    async (segmentId: string) => {
      if (!capability || !workItemId) return;
      setRetryingId(segmentId);
      setError(null);
      try {
        await retryCapabilityWorkItemSegment(
          capability.id,
          workItemId,
          segmentId,
        );
        await refreshSegments();
        if (onAfterRetry) onAfterRetry();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Retry failed.');
      } finally {
        setRetryingId(null);
      }
    },
    [capability, workItemId, refreshSegments, onAfterRetry],
  );

  const handleBriefCommit = useCallback(async () => {
    if (!capability || !workItemId || !briefDirty) return;
    setBriefSaving(true);
    try {
      await updateCapabilityWorkItemBrief(
        capability.id,
        workItemId,
        briefDraft.trim() || null,
      );
      setBriefDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save brief.');
    } finally {
      setBriefSaving(false);
    }
  }, [capability, workItemId, briefDraft, briefDirty]);

  if (!workItemId || !capability) {
    return null;
  }

  const phaseLabel = (phaseId?: string | null) =>
    phaseId
      ? getLifecyclePhaseLabel(capability, phaseId) || phaseId
      : 'DONE';

  return (
    <section className="workspace-surface mt-4 p-4">
      {/* Start / Start-next actions — only when no active run and canEdit. */}
      {canEdit && !hasActiveRun && (onStartSegment || (nextSegmentPreset && onStartNextSegment)) ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {onStartSegment ? (
            <button
              type="button"
              onClick={onStartSegment}
              className="enterprise-button enterprise-button-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Play size={12} />
              Start segment…
            </button>
          ) : null}
          {nextSegmentPreset && onStartNextSegment ? (
            <button
              type="button"
              onClick={onStartNextSegment}
              className="enterprise-button enterprise-button-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
              title={`Resume: ${nextSegmentPreset.intention}`}
            >
              <Play size={12} />
              Start next
              {nextSegmentPreset.stopAfterPhase
                ? ` (→ ${nextSegmentPreset.stopAfterPhase})`
                : ''}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Brief: long-lived cross-segment goal. Distinct from description. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-on-surface">Work item brief</h3>
          {briefSaving ? (
            <LoaderCircle size={14} className="animate-spin text-secondary" />
          ) : briefDirty ? (
            <span className="text-xs text-amber-700">Unsaved</span>
          ) : null}
        </div>
        <textarea
          value={briefDraft}
          onChange={(event) => {
            setBriefDraft(event.target.value);
            setBriefDirty(true);
          }}
          onBlur={() => void handleBriefCommit()}
          placeholder="Long-lived framing that applies across all segments of this work item."
          className="field-textarea bg-white"
          rows={3}
          disabled={!canEdit || briefSaving}
        />
        <p className="text-xs text-secondary">
          Visible at every segment start. Separate from the original
          description; use this to capture ongoing context that should
          outlive individual runs.
        </p>
      </div>

      {/* Segments list. */}
      <div className="mt-5 flex items-center justify-between">
        <h3 className="text-sm font-bold text-on-surface">Segments</h3>
        <button
          type="button"
          onClick={() => void refreshSegments()}
          disabled={loading}
          className="workspace-list-action"
          aria-label="Refresh segments"
          title="Refresh"
        >
          {loading ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
        </button>
      </div>

      {error ? (
        <div className="mt-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          {error}
        </div>
      ) : null}

      {segments.length === 0 ? (
        <p className="mt-2 text-xs text-secondary">
          No segments yet.{' '}
          {canEdit && !hasActiveRun
            ? 'Use the "Start segment…" button above to scope a phase-bounded execution.'
            : 'Start one from the "Start segment…" action to scope a phase-bounded execution.'}
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {segments.map((segment) => {
            const isExpanded = expandedId === segment.id;
            const canRetry =
              segment.status === 'FAILED' || segment.status === 'CANCELLED';
            return (
              <li
                key={segment.id}
                className="rounded-2xl border border-outline-variant/30 bg-white p-3 text-sm"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : segment.id)
                  }
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-secondary">
                        #{segment.segmentIndex}
                      </span>
                      <span className="font-semibold text-on-surface">
                        {phaseLabel(segment.startPhase)} →{' '}
                        {phaseLabel(segment.stopAfterPhase)}
                      </span>
                      <StatusBadge tone={statusTone(segment.status)}>
                        {segment.status}
                      </StatusBadge>
                      {segment.attemptCount > 1 ? (
                        <StatusBadge tone="neutral">
                          {segment.attemptCount} attempts
                        </StatusBadge>
                      ) : null}
                      <StatusBadge tone="neutral">
                        {segment.prioritySnapshot}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-secondary">
                      {segment.intention}
                    </p>
                    <p className="mt-1 text-[0.68rem] text-outline">
                      {fmtDuration(segment.startedAt, segment.completedAt)}
                    </p>
                  </div>
                </button>
                {isExpanded ? (
                  <div className="mt-3 space-y-2 border-t border-outline-variant/25 pt-3 text-xs text-secondary">
                    <p className="whitespace-pre-wrap">{segment.intention}</p>
                    {segment.terminalOutcome ? (
                      <p>
                        <span className="font-semibold">Outcome:</span>{' '}
                        {segment.terminalOutcome}
                      </p>
                    ) : null}
                    {segment.firstRunId ? (
                      <p className="font-mono text-[0.65rem]">
                        first run: {segment.firstRunId}
                      </p>
                    ) : null}
                    {segment.currentRunId &&
                    segment.currentRunId !== segment.firstRunId ? (
                      <p className="font-mono text-[0.65rem]">
                        current run: {segment.currentRunId}
                      </p>
                    ) : null}
                    {canRetry && canEdit ? (
                      <button
                        type="button"
                        onClick={() => void handleRetry(segment.id)}
                        disabled={retryingId !== null}
                        className="enterprise-button enterprise-button-secondary px-3 py-1.5 text-[0.68rem] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {retryingId === segment.id ? (
                          <LoaderCircle size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        Retry segment
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default OrchestratorSegmentsSection;
