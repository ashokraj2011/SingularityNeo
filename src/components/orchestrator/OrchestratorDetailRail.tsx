import React from 'react';
import { getStatusTone } from '../../lib/enterprise';
import { cn } from '../../lib/utils';
import type {
  WorkItem,
  WorkItemPhase,
  WorkNavigatorSection,
} from '../../lib/orchestrator/support';
import { StatusBadge } from '../EnterpriseUI';

type Props = {
  filteredWorkItemsCount: number;
  navigatorSections: WorkNavigatorSection[];
  selectedWorkItemId: string | null;
  getPhaseMeta: (phase: WorkItemPhase) => { label: string };
  getStatusLabel: (status: WorkItem['status']) => string;
  onSelectWorkItem: (workItemId: string) => void;
  workbenchCanvas: React.ReactNode;
};

export const OrchestratorDetailRail = ({
  filteredWorkItemsCount,
  navigatorSections,
  selectedWorkItemId,
  getPhaseMeta,
  getStatusLabel,
  onSelectWorkItem,
  workbenchCanvas,
}: Props) => (
  <aside className="orchestrator-detail-rail">
    <div className="workspace-surface orchestrator-detail-panel">
      <div className="orchestrator-workbench-grid">
        <aside className="orchestrator-navigator-rail">
          <div className="orchestrator-navigator-shell">
            <div className="orchestrator-navigator-header">
              <div>
                <p className="form-kicker">Workbench</p>
                <h2 className="mt-1 text-lg font-bold text-on-surface">Work navigator</h2>
                <p className="mt-1 text-sm text-secondary">
                  Move through urgent, active, and completed work without losing the focused
                  operator workspace.
                </p>
              </div>
              <StatusBadge tone="info">{filteredWorkItemsCount} items</StatusBadge>
            </div>

            <div className="orchestrator-navigator-groups">
              {navigatorSections.map(section => (
                <section key={section.id} className="orchestrator-navigator-group">
                  <div className="orchestrator-navigator-group-header">
                    <div>
                      <p className="text-sm font-semibold text-on-surface">{section.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        {section.helper}
                      </p>
                    </div>
                    <StatusBadge tone="neutral">{section.items.length}</StatusBadge>
                  </div>

                  {section.items.length === 0 ? (
                    <div className="orchestrator-navigator-empty">
                      Nothing to show in this section right now.
                    </div>
                  ) : (
                    <div className="orchestrator-navigator-list">
                      {section.items.map(entry => (
                        <button
                          key={entry.item.id}
                          type="button"
                          onClick={() => onSelectWorkItem(entry.item.id)}
                          className={cn(
                            'orchestrator-navigator-item',
                            selectedWorkItemId === entry.item.id &&
                              'orchestrator-navigator-item-active',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="form-kicker">{entry.item.id}</p>
                              <p className="mt-1 line-clamp-2 text-sm font-semibold text-on-surface">
                                {entry.item.title}
                              </p>
                            </div>
                            <StatusBadge tone={getStatusTone(entry.item.status)}>
                              {getStatusLabel(entry.item.status)}
                            </StatusBadge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <StatusBadge tone="neutral">
                              {getPhaseMeta(entry.item.phase).label}
                            </StatusBadge>
                            {entry.attentionLabel ? (
                              <StatusBadge tone="warning">{entry.attentionLabel}</StatusBadge>
                            ) : null}
                          </div>
                          <div className="mt-3 space-y-1 text-xs leading-relaxed text-secondary">
                            <p>{entry.currentStepName}</p>
                            <p>{entry.agentName}</p>
                            <p>{entry.ageLabel}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </div>
        </aside>

        {workbenchCanvas}
      </div>
    </div>
  </aside>
);
