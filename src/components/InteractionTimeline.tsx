import React from 'react';
import type { CapabilityInteractionFeed } from '../types';
import { StatusBadge } from './EnterpriseUI';
import { formatEnumLabel } from '../lib/enterprise';

const interactionTone = (
  level: CapabilityInteractionFeed['records'][number]['level'],
) => {
  switch (level) {
    case 'SUCCESS':
      return 'success' as const;
    case 'ERROR':
      return 'danger' as const;
    case 'WARN':
      return 'warning' as const;
    case 'INFO':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
};

const formatTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const InteractionTimeline = ({
  feed,
  title = 'Interaction timeline',
  emptyMessage = 'No interaction records are available yet.',
  maxItems = 10,
  onOpenArtifact,
  onOpenRun,
  onOpenTask,
}: {
  feed: CapabilityInteractionFeed;
  title?: string;
  emptyMessage?: string;
  maxItems?: number;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenRun?: (runId: string) => void;
  onOpenTask?: (taskId: string) => void;
}) => (
  <div className="workspace-meta-card">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="workspace-meta-label">{title}</p>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          One feed for chat turns, tool activity, waits, approvals, run events, and learning updates.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="info">{feed.summary.totalCount} records</StatusBadge>
        <StatusBadge tone="neutral">{feed.summary.toolCount} tools</StatusBadge>
        <StatusBadge tone="neutral">{feed.summary.chatCount} chat</StatusBadge>
        <StatusBadge tone="neutral">{feed.summary.artifactCount} artifacts</StatusBadge>
        <StatusBadge tone="neutral">{feed.summary.taskCount} tasks</StatusBadge>
        <StatusBadge tone="neutral">{feed.summary.learningCount} learning</StatusBadge>
      </div>
    </div>

    {feed.records.length === 0 ? (
      <p className="mt-4 text-sm leading-relaxed text-secondary">{emptyMessage}</p>
    ) : (
      <div className="mt-4 space-y-3">
        {feed.records.slice(0, maxItems).map(record => (
          <div
            key={record.id}
            className="rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/25 px-4 py-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-on-surface">{record.title}</p>
                  <StatusBadge tone={interactionTone(record.level)}>
                    {record.interactionType}
                  </StatusBadge>
                  {record.toolId ? (
                    <StatusBadge tone="neutral">{formatEnumLabel(record.toolId)}</StatusBadge>
                  ) : null}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-secondary">{record.summary}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.72rem] text-secondary">
                  <span>{formatTimestamp(record.timestamp)}</span>
                  {record.actorLabel ? <span>{record.actorLabel}</span> : null}
                  {record.traceId ? <span>Trace {record.traceId.slice(-8)}</span> : null}
                  {record.sessionId ? <span>Session {record.sessionId}</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {record.linkedArtifactId && onOpenArtifact ? (
                  <button
                    type="button"
                    onClick={() => onOpenArtifact(record.linkedArtifactId!)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Open artifact
                  </button>
                ) : null}
                {record.id.startsWith('task-') && onOpenTask ? (
                  <button
                    type="button"
                    onClick={() => onOpenTask(record.id.replace(/^task-/, ''))}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Open task
                  </button>
                ) : null}
                {record.runId && onOpenRun ? (
                  <button
                    type="button"
                    onClick={() => onOpenRun(record.runId!)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Open run
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default InteractionTimeline;
