import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { CapabilityLifecyclePhase } from '../types';
import { getLifecyclePhaseLabel } from '../lib/capabilityLifecycle';

export interface CapabilityLifecycleEditorPhaseView {
  phase: CapabilityLifecyclePhase;
  usageSummary?: string;
  canDelete?: boolean;
  deleteHint?: string;
}

interface CapabilityLifecycleEditorProps {
  phases: CapabilityLifecycleEditorPhaseView[];
  onChangeLabel: (phaseId: string, label: string) => void;
  onMovePhase: (phaseId: string, direction: 'up' | 'down') => void;
  onDeletePhase: (phaseId: string) => void;
  onAddPhase: () => void;
  addLabel?: string;
  intro?: string;
}

export default function CapabilityLifecycleEditor({
  phases,
  onChangeLabel,
  onMovePhase,
  onDeletePhase,
  onAddPhase,
  addLabel = 'Add phase',
  intro,
}: CapabilityLifecycleEditorProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-4 text-sm text-secondary">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-secondary">
            {getLifecyclePhaseLabel(undefined, 'BACKLOG')}
          </span>
          <span className="text-outline">Fixed system state</span>
        </div>
        {intro && <p className="mt-3 leading-relaxed">{intro}</p>}
      </div>

      <div className="space-y-3">
        {phases.map((entry, index) => (
          <div
            key={entry.phase.id}
            className="rounded-2xl border border-outline-variant/15 bg-white px-4 py-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-secondary">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <input
                    value={entry.phase.label}
                    onChange={event =>
                      onChangeLabel(entry.phase.id, event.target.value)
                    }
                    className="field-input"
                    placeholder="Phase name"
                  />
                  <p className="mt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-outline">
                    {entry.phase.id}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onMovePhase(entry.phase.id, 'up')}
                  className="enterprise-button enterprise-button-secondary"
                  disabled={index === 0}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => onMovePhase(entry.phase.id, 'down')}
                  className="enterprise-button enterprise-button-secondary"
                  disabled={index === phases.length - 1}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => onDeletePhase(entry.phase.id)}
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={entry.canDelete === false}
                  title={entry.deleteHint}
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </div>

            {(entry.usageSummary || entry.deleteHint) && (
              <div className="mt-3 flex flex-col gap-2 text-sm text-secondary">
                {entry.usageSummary && <p>{entry.usageSummary}</p>}
                {entry.deleteHint && entry.canDelete === false && (
                  <p className="text-amber-700">{entry.deleteHint}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAddPhase}
        className="enterprise-button enterprise-button-secondary"
      >
        <Plus size={16} />
        {addLabel}
      </button>

      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-4 text-sm text-secondary">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-secondary">
            {getLifecyclePhaseLabel(undefined, 'DONE')}
          </span>
          <span className="text-outline">Fixed system state</span>
        </div>
      </div>
    </div>
  );
}
