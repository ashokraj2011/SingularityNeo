import React from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { StatusBadge } from '../EnterpriseUI';
import { cn } from '../../lib/utils';
import type {
  WorkItem,
  WorkbenchSelectionFocus,
  WorkItemPhase,
} from '../../lib/orchestrator/support';

type AttentionItem = {
  item: WorkItem;
  agentId?: string;
  attentionLabel: string;
  attentionReason: string;
  attentionTimestamp?: string;
  hasConflictReview: boolean;
  callToAction: string;
};

type OrchestratorAttentionQueueProps = {
  attentionItems: AttentionItem[];
  selectedWorkItemId: string | null;
  onSelectWorkItem: (
    workItemId: string,
    options?: {
      openControl?: boolean;
      focus?: WorkbenchSelectionFocus;
    },
  ) => void;
  resolveAgentName: (agentId?: string) => string;
  getPhaseMeta: (phase?: WorkItemPhase) => { label: string; accent: string };
  formatRelativeTime: (value?: string) => string;
};

export const OrchestratorAttentionQueue = ({
  attentionItems,
  selectedWorkItemId,
  onSelectWorkItem,
  resolveAgentName,
  getPhaseMeta,
  formatRelativeTime,
}: OrchestratorAttentionQueueProps) => {
  return (
    <section className="workspace-surface orchestrator-attention-shell">
      <div className="orchestrator-surface-header">
        <div>
          <p className="form-kicker">Top Action Queue</p>
          <h2 className="mt-1 text-lg font-bold text-on-surface">Needs Attention</h2>
          <p className="mt-1 text-sm text-secondary">
            Blockers, approvals, missing input, and conflict resolutions stay here so triage
            happens before the board gets crowded with urgency.
          </p>
        </div>
        <StatusBadge tone={attentionItems.length > 0 ? 'warning' : 'success'}>
          {attentionItems.length > 0 ? `${attentionItems.length} items waiting` : 'All clear'}
        </StatusBadge>
      </div>

      {attentionItems.length === 0 ? (
        <div className="orchestrator-attention-empty">
          No approvals, blockers, or missing-input requests are waiting right now.
        </div>
      ) : (
        <div className="orchestrator-attention-row">
          {attentionItems.map(attention => (
            <button
              key={attention.item.id}
              type="button"
              onClick={() => {
                const focus: WorkbenchSelectionFocus | undefined =
                  attention.item.pendingRequest?.type === 'INPUT'
                    ? 'INPUT'
                    : attention.item.pendingRequest?.type === 'APPROVAL'
                      ? 'APPROVAL'
                      : attention.item.blocker?.type
                        ? 'RESOLUTION'
                        : undefined;
                onSelectWorkItem(attention.item.id, {
                  openControl: true,
                  focus,
                });
              }}
              className={cn(
                'orchestrator-attention-card min-w-[18rem] text-left',
                selectedWorkItemId === attention.item.id &&
                  'orchestrator-attention-card-active',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="form-kicker">{attention.item.id}</p>
                  <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-on-surface">
                    {attention.item.title}
                  </h3>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge tone="warning">{attention.attentionLabel}</StatusBadge>
                  {attention.hasConflictReview ? (
                    <StatusBadge tone="danger" className="tracking-[0.12em]">
                      Contrarian pass
                    </StatusBadge>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 space-y-2 text-sm text-secondary">
                <p className="line-clamp-2">{attention.attentionReason}</p>
                <div className="orchestrator-attention-meta">
                  <span>{getPhaseMeta(attention.item.phase).label}</span>
                  <span>{resolveAgentName(attention.agentId)}</span>
                  <span>{formatRelativeTime(attention.attentionTimestamp)}</span>
                </div>
              </div>
              <div className="orchestrator-attention-cta">
                <span>{attention.callToAction}</span>
                <ArrowRight size={14} />
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
