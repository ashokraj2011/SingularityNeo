import React from 'react';
import type { AgentKnowledgeLens } from '../types';
import { StatusBadge } from './EnterpriseUI';

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

export const AgentKnowledgeLensPanel = ({
  lens,
  title = 'What this agent knows now',
  compact = false,
}: {
  lens: AgentKnowledgeLens;
  title?: string;
  compact?: boolean;
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
      </div>
    </div>

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
  </div>
);

export default AgentKnowledgeLensPanel;
