import React, { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Play, X } from 'lucide-react';
import { ModalShell } from '../EnterpriseUI';
import type { Capability, WorkItem, WorkItemPhase } from '../../types';
import {
  SYSTEM_BACKLOG_PHASE_ID,
  SYSTEM_DONE_PHASE_ID,
  getCapabilityBoardPhaseIds,
  getLifecyclePhaseLabel,
} from '../../lib/capabilityLifecycle';

export type StartSegmentDialogSubmit = {
  startPhase: WorkItemPhase;
  stopAfterPhase?: WorkItemPhase;
  intention: string;
  saveAsPreset: boolean;
};

type Props = {
  open: boolean;
  workItem: WorkItem | null;
  capability: Capability | null;
  busy: boolean;
  error?: string | null;
  defaultIntention?: string;
  onClose: () => void;
  onSubmit: (submit: StartSegmentDialogSubmit) => Promise<void> | void;
};

/**
 * StartSegmentDialog — composed when the operator starts a new segment
 * of a work item. Captures:
 *   - start phase (defaults to workItem.phase; BACKLOG/DONE excluded)
 *   - stop-after phase (defaults to the next phase after start)
 *   - intention (required)
 *   - saveAsPreset flag for one-click resume next time.
 *
 * The priority is shown read-only — operators change it from the inbox
 * row, not here, so the "start ritual" doesn't double as a priority
 * editor.
 */
export const StartSegmentDialog: React.FC<Props> = ({
  open,
  workItem,
  capability,
  busy,
  error,
  defaultIntention,
  onClose,
  onSubmit,
}) => {
  // Derive the selectable phase list once per capability — BACKLOG and
  // DONE are system anchors; you don't "start at BACKLOG" or "stop
  // after DONE," so we strip both ends.
  const selectablePhases = useMemo<WorkItemPhase[]>(() => {
    if (!capability) return [];
    return getCapabilityBoardPhaseIds(capability).filter(
      phaseId =>
        phaseId !== SYSTEM_BACKLOG_PHASE_ID &&
        phaseId !== SYSTEM_DONE_PHASE_ID,
    ) as WorkItemPhase[];
  }, [capability]);

  const defaultStartPhase = useMemo<WorkItemPhase | undefined>(() => {
    if (!workItem) return undefined;
    const currentPhase = workItem.phase as WorkItemPhase;
    if (
      currentPhase &&
      currentPhase !== SYSTEM_BACKLOG_PHASE_ID &&
      currentPhase !== SYSTEM_DONE_PHASE_ID
    ) {
      return currentPhase;
    }
    return selectablePhases[0];
  }, [workItem, selectablePhases]);

  const [startPhase, setStartPhase] = useState<WorkItemPhase | ''>('');
  const [stopAfterPhase, setStopAfterPhase] = useState<WorkItemPhase | ''>('');
  const [intention, setIntention] = useState('');
  const [saveAsPreset, setSaveAsPreset] = useState(false);

  // Reset form each time the dialog opens for a different work item.
  useEffect(() => {
    if (!open) return;
    setStartPhase(defaultStartPhase || '');
    const startIdx = defaultStartPhase
      ? selectablePhases.indexOf(defaultStartPhase)
      : -1;
    const nextPhase =
      startIdx >= 0 && startIdx + 1 < selectablePhases.length
        ? selectablePhases[startIdx + 1]
        : selectablePhases[selectablePhases.length - 1] || '';
    setStopAfterPhase(nextPhase || '');
    setIntention(defaultIntention || '');
    setSaveAsPreset(false);
  }, [open, defaultStartPhase, selectablePhases, defaultIntention]);

  if (!open || !workItem || !capability) return null;

  const startIdx = startPhase
    ? selectablePhases.indexOf(startPhase as WorkItemPhase)
    : -1;
  const stopIdx = stopAfterPhase
    ? selectablePhases.indexOf(stopAfterPhase as WorkItemPhase)
    : -1;
  const rangeInvalid =
    stopAfterPhase !== '' && startIdx >= 0 && stopIdx >= 0 && stopIdx < startIdx;

  const canSubmit =
    Boolean(startPhase) &&
    Boolean(intention.trim()) &&
    !rangeInvalid &&
    !busy;

  const handleSubmit = async () => {
    if (!canSubmit || !startPhase) return;
    await onSubmit({
      startPhase: startPhase as WorkItemPhase,
      stopAfterPhase: (stopAfterPhase || undefined) as WorkItemPhase | undefined,
      intention: intention.trim(),
      saveAsPreset,
    });
  };

  const phaseLabel = (phaseId: string) =>
    getLifecyclePhaseLabel(capability, phaseId) || phaseId;

  return (
    <div className="desktop-content-modal-overlay z-[94]">
      <button
        type="button"
        aria-label="Close start segment dialog"
        onClick={onClose}
        className="desktop-content-modal-backdrop"
      />
      <ModalShell
        title={`Start segment · ${workItem.title}`}
        eyebrow="Phase Segment"
        description="Pick the phase range this segment covers and state the intention. The run stops at the selected boundary; the work item returns to the queue ready for its next segment."
        className="relative z-[1] w-full max-w-2xl"
        actions={
          <button
            type="button"
            onClick={onClose}
            className="workspace-list-action"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2">
              <span className="field-label">Start phase</span>
              <select
                value={startPhase}
                onChange={event =>
                  setStartPhase(event.target.value as WorkItemPhase)
                }
                className="field-input bg-white"
              >
                {selectablePhases.map(phase => (
                  <option key={phase} value={phase}>
                    {phaseLabel(phase)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="field-label">Stop after phase</span>
              <select
                value={stopAfterPhase}
                onChange={event =>
                  setStopAfterPhase(event.target.value as WorkItemPhase)
                }
                className="field-input bg-white"
              >
                <option value="">Run to DONE (no stop)</option>
                {selectablePhases.map(phase => (
                  <option key={phase} value={phase}>
                    {phaseLabel(phase)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {rangeInvalid ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Stop phase must be at or after the start phase.
            </div>
          ) : null}

          <label className="block space-y-2">
            <span className="field-label">Intention (required)</span>
            <textarea
              value={intention}
              onChange={event => setIntention(event.target.value)}
              placeholder="Why this segment? What do you expect at the boundary?"
              rows={4}
              className="field-textarea bg-white"
            />
            <span className="text-xs text-slate-500">
              Pinned for audit. Visible in the segment history and in every
              retry of this segment.
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={saveAsPreset}
              onChange={event => setSaveAsPreset(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold">Save as preset</span> — adds a
              one-click <span className="font-mono">Start next</span> button to
              this work item in the inbox.
            </span>
          </label>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            Priority <span className="font-semibold">{workItem.priority}</span>
            {' '}— change priority from the inbox row to re-rank this segment in
            the queue.
          </div>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="enterprise-button enterprise-button-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <Play size={16} />
              )}
              Start segment
            </button>
          </div>
        </div>
      </ModalShell>
    </div>
  );
};

export default StartSegmentDialog;
