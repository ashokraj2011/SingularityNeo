import React from 'react';
import type { CapabilityBriefing } from '../types';
import { StatusBadge } from './EnterpriseUI';

export const CapabilityBriefingPanel = ({
  briefing,
  title = 'Capability brain',
  compact = false,
}: {
  briefing: CapabilityBriefing;
  title?: string;
  compact?: boolean;
}) => {
  const sections = compact ? briefing.sections.slice(0, 3) : briefing.sections;

  return (
    <div className="workspace-meta-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="workspace-meta-label">{title}</p>
          <p className="mt-2 text-sm font-semibold text-on-surface">{briefing.outcome}</p>
          <p className="mt-2 text-sm leading-relaxed text-secondary">{briefing.purpose}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {briefing.ownerTeam ? <StatusBadge tone="info">{briefing.ownerTeam}</StatusBadge> : null}
          {briefing.evidencePriorities.length > 0 ? (
            <StatusBadge tone="warning">
              {briefing.evidencePriorities.length} evidence goals
            </StatusBadge>
          ) : null}
        </div>
      </div>

      {briefing.activeConstraints.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {briefing.activeConstraints.slice(0, compact ? 3 : 6).map(item => (
            <StatusBadge key={item} tone="neutral">
              {item}
            </StatusBadge>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {sections.map(section => (
          <div
            key={section.id}
            className="rounded-[1.25rem] border border-outline-variant/25 bg-surface-container-low/30 px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-on-surface">{section.label}</p>
              {section.tone ? <StatusBadge tone={section.tone}>{section.label}</StatusBadge> : null}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-secondary">{section.summary}</p>
            <ul className="mt-3 space-y-1 text-xs leading-relaxed text-secondary">
              {section.items.slice(0, compact ? 3 : 5).map(item => (
                <li key={item} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CapabilityBriefingPanel;
