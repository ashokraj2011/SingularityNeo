import React from 'react';
import { ArrowRight } from 'lucide-react';
import { StatusBadge } from '../EnterpriseUI';
import { cn } from '../../lib/utils';
import type { EnterpriseTone } from '../../lib/enterprise';
import type { WorkItem, WorkItemPhase } from '../../lib/orchestrator/support';

type PhaseMeta = {
  label: string;
  accent: string;
};

type OrchestratorLifecycleRailProps = {
  selectedWorkItem: WorkItem | null;
  selectedWorkflowName?: string | null;
  selectedStatusTone: EnterpriseTone;
  selectedStatusLabel?: string;
  canControlWorkItems: boolean;
  phaseRailPreviewingMove: boolean;
  phaseRailTargetPhase: WorkItemPhase | null;
  lifecycleBoardPhases: WorkItemPhase[];
  phaseRailTrackRef: React.RefObject<HTMLDivElement | null>;
  onTrackPointerDown: (
    event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>,
  ) => void;
  phaseRailCurrentIndex: number;
  phaseRailTargetIndex: number;
  measureForIndex: (index: number) => { ratio: number; cssValue: string };
  onOpenPhaseMoveDialog: (workItemId: string, targetPhase: WorkItemPhase) => void;
  phaseRailCanInteract: boolean;
  isPhaseRailDragging: boolean;
  onHandleKeyDown: React.KeyboardEventHandler<HTMLButtonElement>;
  onSwitchOperator: () => void;
  getPhaseMeta: (phase?: WorkItemPhase) => PhaseMeta;
};

export const OrchestratorLifecycleRail = ({
  selectedWorkItem,
  selectedWorkflowName,
  selectedStatusTone,
  selectedStatusLabel = 'Unknown',
  canControlWorkItems,
  phaseRailPreviewingMove,
  phaseRailTargetPhase,
  lifecycleBoardPhases,
  phaseRailTrackRef,
  onTrackPointerDown,
  phaseRailCurrentIndex,
  phaseRailTargetIndex,
  measureForIndex,
  onOpenPhaseMoveDialog,
  phaseRailCanInteract,
  isPhaseRailDragging,
  onHandleKeyDown,
  onSwitchOperator,
  getPhaseMeta,
}: OrchestratorLifecycleRailProps) => {
  return (
    <section className="workspace-surface overflow-hidden p-0">
      <div className="border-b border-outline-variant/25 bg-white/70 px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="form-kicker">Workflow</p>
            <h2 className="mt-1 text-lg font-bold text-on-surface">Lifecycle rail</h2>
            <p className="mt-2 max-w-4xl text-sm leading-relaxed text-secondary">
              {selectedWorkItem ? (
                <>
                  {selectedWorkflowName || 'Workflow'} ·{' '}
                  <span className="font-semibold text-on-surface">{selectedWorkItem.id}</span>{' '}
                  {selectedWorkItem.title}
                </>
              ) : (
                'Select a work item to preview its lifecycle and move phases safely.'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedWorkItem ? (
              <>
                <StatusBadge tone={selectedStatusTone}>{selectedStatusLabel}</StatusBadge>
                <StatusBadge tone="neutral">
                  Current · {getPhaseMeta(selectedWorkItem.phase).label}
                </StatusBadge>
                {phaseRailPreviewingMove && phaseRailTargetPhase ? (
                  <StatusBadge tone="brand">
                    Preview · {getPhaseMeta(phaseRailTargetPhase).label}
                  </StatusBadge>
                ) : null}
              </>
            ) : (
              <StatusBadge tone="neutral">No selection</StatusBadge>
            )}
          </div>
        </div>
      </div>

      <div className="orchestrator-phase-rail-shell px-5 pb-5 pt-4">
        <div
          ref={phaseRailTrackRef}
          className="orchestrator-phase-rail-track"
          onPointerDown={onTrackPointerDown}
        >
          <div className="orchestrator-phase-rail-progress" />
          {selectedWorkItem ? (
            <div
              className="orchestrator-phase-rail-progress-current"
              style={{ width: measureForIndex(phaseRailCurrentIndex).cssValue }}
            />
          ) : null}
          {selectedWorkItem ? (
            <div
              className={cn(
                'orchestrator-phase-rail-progress-preview',
                phaseRailPreviewingMove && 'orchestrator-phase-rail-progress-preview-active',
              )}
              style={{ width: measureForIndex(phaseRailTargetIndex).cssValue }}
            />
          ) : null}

          <div className="orchestrator-phase-rail-stations">
            {lifecycleBoardPhases.map((phase, index) => {
              const isCurrent = Boolean(selectedWorkItem && phase === selectedWorkItem.phase);
              const isPreview = Boolean(selectedWorkItem && phase === phaseRailTargetPhase);
              const isReached =
                Boolean(selectedWorkItem) &&
                phaseRailTargetIndex >= 0 &&
                index <= phaseRailTargetIndex;
              const phaseRailPosition = measureForIndex(index);
              const label = getPhaseMeta(phase).label;
              const canMove = Boolean(
                selectedWorkItem && canControlWorkItems && !isCurrent,
              );

              return (
                <button
                  key={phase}
                  type="button"
                  data-phase-station-button="true"
                  aria-disabled={!canMove}
                  onPointerDown={event => {
                    event.stopPropagation();
                  }}
                  onClick={() => {
                    if (!selectedWorkItem || !canMove) {
                      return;
                    }
                    onOpenPhaseMoveDialog(selectedWorkItem.id, phase);
                  }}
                  className={cn(
                    'orchestrator-phase-station',
                    isCurrent && 'orchestrator-phase-station-active',
                    isPreview && 'orchestrator-phase-station-preview',
                    isReached && !isPreview && 'orchestrator-phase-station-reached',
                    !canMove && !isCurrent && 'cursor-default opacity-70',
                  )}
                  style={{ left: phaseRailPosition.cssValue }}
                  aria-label={`Move to ${label}`}
                  title={canMove ? `Move to ${label}` : label}
                >
                  <span className="orchestrator-phase-station-dot" />
                  <span className="orchestrator-phase-station-label">{label}</span>
                </button>
              );
            })}
          </div>

          {selectedWorkItem && phaseRailTargetIndex >= 0 ? (
            <button
              type="button"
              aria-label={`Lifecycle rail handle at ${getPhaseMeta(
                phaseRailTargetPhase || selectedWorkItem.phase,
              ).label}`}
              disabled={!phaseRailCanInteract}
              onPointerDown={onTrackPointerDown}
              onKeyDown={onHandleKeyDown}
              className={cn(
                'orchestrator-phase-slider-handle',
                phaseRailCanInteract && 'orchestrator-phase-slider-handle-interactive',
                isPhaseRailDragging && 'orchestrator-phase-slider-handle-dragging',
              )}
              style={{ left: measureForIndex(phaseRailTargetIndex).cssValue }}
            >
              <span className="sr-only">Drag to preview a new lifecycle phase</span>
              <span className="orchestrator-phase-slider-handle-core" />
            </button>
          ) : null}
        </div>

        {!canControlWorkItems ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs leading-relaxed text-secondary">
            <p>
              You have read-only visibility here. Switch Current Operator to someone with
              `workitem.control` to pause, cancel, or move phases.
            </p>
            <button
              type="button"
              onClick={onSwitchOperator}
              className="enterprise-button enterprise-button-secondary px-3 py-2 text-[0.68rem]"
            >
              <ArrowRight size={14} />
              Switch operator
            </button>
          </div>
        ) : (
          <p className="mt-4 text-xs leading-relaxed text-secondary">
            Drag the rail handle to preview a phase, or click any phase station to move with
            confirmation. In-flight runs are cancelled safely before the move.
          </p>
        )}
      </div>
    </section>
  );
};
