import React from 'react';
import { motion } from 'motion/react';
import { AlertCircle, Workflow as WorkflowIcon } from 'lucide-react';
import { getStatusTone } from '../../lib/enterprise';
import { getWorkItemDisplayStatus } from '../../lib/workItemState';
import { cn } from '../../lib/utils';
import {
  formatTimestamp,
  getCurrentWorkflowStep,
  getPriorityTone,
  type WorkItem,
  type WorkItemPhase,
  type Workflow,
} from '../../lib/orchestrator/support';
import {
  DEFAULT_WORK_ITEM_TASK_TYPE,
  getWorkItemTaskTypeLabel,
} from '../../lib/workItemTaskTypes';
import type { CapabilityAgent } from '../../types';
import { BoardColumn, EmptyState, StatusBadge } from '../EnterpriseUI';

type Props = {
  workflows: Workflow[];
  groupedItems: Array<{ phase: WorkItemPhase; items: WorkItem[] }>;
  completedItems: WorkItem[];
  selectedWorkItemId: string | null;
  dragOverPhase: WorkItemPhase | null;
  draggedWorkItemId: string | null;
  workflowsById: Map<string, Workflow>;
  agentsById: Map<string, CapabilityAgent>;
  getPhaseMeta: (phase: WorkItemPhase) => { label: string };
  getStatusLabel: (workItem: WorkItem) => string;
  getAttentionLabel: (args: {
    blocker?: WorkItem['blocker'];
    pendingRequest?: WorkItem['pendingRequest'];
  }) => string;
  getAttentionReason: (args: {
    blocker?: WorkItem['blocker'];
    pendingRequest?: WorkItem['pendingRequest'];
  }) => string;
  isConflictAttention: (item: WorkItem) => boolean;
  onSelectWorkItem: (workItemId: string) => void;
  onDragOverPhase: (phase: WorkItemPhase) => void;
  onDragLeavePhase: (phase: WorkItemPhase) => void;
  onDropOnPhase: (phase: WorkItemPhase, droppedId: string | null) => void;
  onDragStartWorkItem: (workItemId: string, event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEndWorkItem: () => void;
};

export const OrchestratorBoardSurface = ({
  workflows,
  groupedItems,
  completedItems,
  selectedWorkItemId,
  dragOverPhase,
  draggedWorkItemId,
  workflowsById,
  agentsById,
  getPhaseMeta,
  getStatusLabel,
  getAttentionLabel,
  getAttentionReason,
  isConflictAttention,
  onSelectWorkItem,
  onDragOverPhase,
  onDragLeavePhase,
  onDropOnPhase,
  onDragStartWorkItem,
  onDragEndWorkItem,
}: Props) => (
  <section id="orchestrator-flow-map" className="workspace-surface orchestrator-board-shell">
    <div className="orchestrator-surface-header">
      <div>
        <p className="form-kicker">Phase Board</p>
        <h2 className="mt-1 text-lg font-bold text-on-surface">Execution lanes</h2>
        <p className="mt-1 text-sm text-secondary">
          Use the lane map below as the flow view after you finish operating the selected work
          item above.
        </p>
      </div>
      <div className="orchestrator-board-meta">
        {workflows.slice(0, 3).map(workflow => (
          <span key={workflow.id}>
            <StatusBadge tone="neutral">{workflow.name}</StatusBadge>
          </span>
        ))}
      </div>
    </div>

    <div className="space-y-6">
      <div className="orchestrator-board-grid">
        {groupedItems.map(({ phase, items }) => (
          <BoardColumn
            key={phase}
            title={getPhaseMeta(phase).label}
            count={items.length}
            active={dragOverPhase === phase}
            className="orchestrator-phase-column transition-all"
          >
            <div
              onDragOver={event => {
                event.preventDefault();
                onDragOverPhase(phase);
              }}
              onDragLeave={() => onDragLeavePhase(phase)}
              onDrop={event => {
                event.preventDefault();
                const droppedId = event.dataTransfer.getData('text/plain') || draggedWorkItemId;
                onDropOnPhase(phase, droppedId || null);
              }}
              className="orchestrator-phase-body"
            >
              {items.map(item => {
                const workflow = workflowsById.get(item.workflowId) || null;
                const currentStep = getCurrentWorkflowStep(workflow, null, item);
                const agentId = item.assignedAgentId || currentStep?.agentId;
                const attentionLabel =
                  item.blocker?.status === 'OPEN' || item.pendingRequest
                    ? getAttentionLabel({
                        blocker: item.blocker,
                        pendingRequest: item.pendingRequest,
                      })
                    : '';
                const attentionReason = getAttentionReason({
                  blocker: item.blocker,
                  pendingRequest: item.pendingRequest,
                });
                const hasConflictReview = isConflictAttention(item);

                return (
                  <motion.button
                    key={item.id}
                    id={`orchestrator-item-${item.id}`}
                    draggable
                    onDragStart={event =>
                      onDragStartWorkItem(
                        item.id,
                        event as unknown as React.DragEvent<HTMLButtonElement>,
                      )
                    }
                    onDragEnd={onDragEndWorkItem}
                    onClick={() => onSelectWorkItem(item.id)}
                    className={cn(
                      'orchestrator-board-card',
                      selectedWorkItemId === item.id && 'orchestrator-board-card-active',
                    )}
                  >
                    <div className="orchestrator-board-card-top">
                      <div className="min-w-0">
                        <p className="form-kicker">{item.id}</p>
                        <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-on-surface">
                          {item.title}
                        </h3>
                      </div>
                      <StatusBadge tone={getPriorityTone(item.priority)}>
                        {item.priority}
                      </StatusBadge>
                    </div>

                    <div className="orchestrator-board-card-status">
                        <StatusBadge tone={getStatusTone(getWorkItemDisplayStatus(item))}>
                          {getStatusLabel(item)}
                        </StatusBadge>
                      {item.taskType && item.taskType !== DEFAULT_WORK_ITEM_TASK_TYPE && (
                        <StatusBadge tone="neutral">
                          {getWorkItemTaskTypeLabel(item.taskType)}
                        </StatusBadge>
                      )}
                      {item.activeRunId && <StatusBadge tone="brand">Running</StatusBadge>}
                      {hasConflictReview && (
                        <StatusBadge tone="danger">Contrarian pass</StatusBadge>
                      )}
                    </div>

                    <div className="orchestrator-board-card-body">
                      <div className="orchestrator-board-card-step">
                        <p className="form-kicker">Current Step</p>
                        <p className="mt-1 text-xs font-semibold text-on-surface">
                          {currentStep?.name || 'Awaiting orchestration'}
                        </p>
                      </div>
                      <div className="orchestrator-board-card-footer">
                        <span className="truncate">
                          {agentsById.get(agentId || '')?.name || agentId || 'Unassigned'}
                        </span>
                      </div>
                      {attentionLabel && (
                        <div className="orchestrator-board-card-attention">
                          <div className="flex items-center gap-2 font-bold uppercase tracking-[0.16em]">
                            <AlertCircle size={14} />
                            <span>{attentionLabel}</span>
                          </div>
                          <p className="mt-1 line-clamp-2 normal-case font-medium tracking-normal">
                            {attentionReason}
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.button>
                );
              })}

              {items.length === 0 && (
                <EmptyState
                  title={`No work in ${getPhaseMeta(phase).label}`}
                  description="Drop a work item here to re-stage it or keep the phase clear while execution moves forward."
                  icon={WorkflowIcon}
                  className="min-h-[10rem]"
                />
              )}
            </div>
          </BoardColumn>
        ))}
      </div>

      <div className="workspace-meta-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Completed work</p>
            <p className="mt-1 text-sm font-semibold text-on-surface">
              Finished items are tracked below the active lanes
            </p>
          </div>
          <StatusBadge tone="success">{completedItems.length} done</StatusBadge>
        </div>

        {completedItems.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <div className="data-table-shell min-w-[48rem]">
              <div className="data-table-header grid grid-cols-[1.7fr_0.9fr_0.95fr_1.1fr_1fr_1fr] gap-3">
                <span>Work Item</span>
                <span>Workflow</span>
                <span>Completed In</span>
                <span>Last Step</span>
                <span>Owner</span>
                <span>Last Update</span>
              </div>
              {completedItems.map(item => {
                const workflow = workflowsById.get(item.workflowId) || null;
                const currentStep = getCurrentWorkflowStep(workflow, null, item);
                const agentId = item.assignedAgentId || currentStep?.agentId;
                const lastHistoryEntry = item.history[item.history.length - 1];

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectWorkItem(item.id)}
                    className={cn(
                      'orchestrator-list-row',
                      selectedWorkItemId === item.id && 'orchestrator-list-row-active',
                    )}
                  >
                    <div>
                      <p className="font-semibold text-on-surface">{item.title}</p>
                      <p className="mt-1 text-xs text-secondary">{item.id}</p>
                    </div>
                    <span>{workflow?.name || 'Workflow missing'}</span>
                    <div>
                      <StatusBadge tone="success">{getPhaseMeta(item.phase).label}</StatusBadge>
                    </div>
                    <span>{currentStep?.name || 'Completed'}</span>
                    <span>{agentsById.get(agentId || '')?.name || agentId || 'Unassigned'}</span>
                    <span>{formatTimestamp(lastHistoryEntry?.timestamp)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-secondary">
            Completed work will collect here instead of stretching the phase board.
          </p>
        )}
      </div>
    </div>
  </section>
);
