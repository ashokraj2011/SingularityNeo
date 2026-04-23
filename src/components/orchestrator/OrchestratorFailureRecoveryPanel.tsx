import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  LoaderCircle,
  RefreshCw,
  Square,
} from 'lucide-react';
import { StatusBadge } from '../EnterpriseUI';
import { formatEnumLabel } from '../../lib/enterprise';
import { cn } from '../../lib/utils';
import { formatTimestamp } from '../../lib/orchestrator/support';
import type { WorkItem, WorkflowRun, WorkflowRunStep, Workflow } from '../../types';

type Props = {
  /** The work item being operated on. */
  selectedWorkItem: WorkItem;
  /** The most-recent workflow run (may be null if never started). */
  currentRun: WorkflowRun | null;
  /** Human-readable failure/blocker reason from the engine. */
  selectedFailureReason: string;
  /** The workflow step that is currently active or was last active. */
  selectedCurrentStep: Workflow['steps'][number] | null;
  /** The run-step record that corresponds to the failing step. */
  failedRunStep: WorkflowRunStep | null;
  /** Mirrors busyAction from the orchestrator — disables buttons while mutations are in-flight. */
  busyAction: string | null;
  /** Recovery action availability */
  canRestartFromPhase: boolean;
  restartPhaseLabel: string;
  canResetAndRestart: boolean;
  selectedCanGuideBlockedAgent: boolean;
  currentRunIsActive: boolean;
  onRestartExecution: () => void;
  onResetAndRestart: () => void;
  onGuideBlockedAgent: () => void;
  onCancelRun: () => void;
};

/**
 * Inline failure recovery panel.
 *
 * Renders automatically when the current run is FAILED or the work item is
 * BLOCKED. Consolidates the failure reason, the affected step, the attempt
 * count, and all contextual recovery actions into a single card so operators
 * don't need to hunt across Header controls and the Operate tab.
 *
 * Placement: between the detail header and the tab strip so it is visible
 * regardless of which tab is active.
 */
export const OrchestratorFailureRecoveryPanel = ({
  selectedWorkItem,
  currentRun,
  selectedFailureReason,
  selectedCurrentStep,
  failedRunStep,
  busyAction,
  canRestartFromPhase,
  restartPhaseLabel,
  canResetAndRestart,
  selectedCanGuideBlockedAgent,
  currentRunIsActive,
  onRestartExecution,
  onResetAndRestart,
  onGuideBlockedAgent,
  onCancelRun,
}: Props) => {
  const isRunFailed = currentRun?.status === 'FAILED';
  const isBlocked = selectedWorkItem.status === 'BLOCKED';

  // Only show when the run has actually failed or the work item is blocked.
  if (!isRunFailed && !isBlocked) return null;

  const tone = isRunFailed ? 'danger' : 'warning';
  const kicker = isRunFailed ? 'Run failed' : 'Execution blocked';
  const stepName = selectedCurrentStep?.name || failedRunStep?.name || null;
  const attemptCount = failedRunStep?.attemptCount ?? currentRun?.attemptNumber ?? null;
  const failedAt = currentRun?.completedAt ?? currentRun?.updatedAt;
  const terminalNote = currentRun?.terminalOutcome;

  return (
    <div
      className={cn(
        'mx-4 mb-0 mt-3 rounded-[1.5rem] border px-5 py-4',
        isRunFailed
          ? 'border-red-200/80 bg-red-50/60'
          : 'border-amber-200/80 bg-amber-50/60',
      )}
      aria-label="Failure recovery panel"
    >
      {/* ── Header row ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={18}
            className={`mt-0.5 shrink-0 ${isRunFailed ? 'text-red-600' : 'text-amber-600'}`}
          />
          <div className="min-w-0">
            <p
              className={`text-[0.6875rem] font-bold uppercase tracking-[0.18em] ${
                isRunFailed ? 'text-red-700' : 'text-amber-800'
              }`}
            >
              {kicker}
            </p>
            {stepName ? (
              <p className="mt-1 text-sm font-semibold text-on-surface">
                Stopped at step: <span className="text-primary">{stepName}</span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {currentRun ? (
            <StatusBadge tone="neutral">
              Attempt {currentRun.attemptNumber}
            </StatusBadge>
          ) : null}
          {attemptCount !== null && attemptCount > 1 ? (
            <StatusBadge tone={tone}>
              {attemptCount} step attempts
            </StatusBadge>
          ) : null}
          {failedAt ? (
            <span className="text-xs text-secondary">
              {formatTimestamp(failedAt)}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── Failure reason ──────────────────────────────────── */}
      {selectedFailureReason ? (
        <div className="mt-3 rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
          <p className="workspace-meta-label">
            {isRunFailed ? 'Failure reason from engine' : 'Blocker from engine'}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-on-surface">
            {selectedFailureReason}
          </p>
        </div>
      ) : null}

      {/* ── Terminal outcome (if the run has a structured note) ─ */}
      {terminalNote && terminalNote !== selectedFailureReason ? (
        <div className="mt-2 rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
          <p className="workspace-meta-label">Engine outcome note</p>
          <p className="mt-2 text-sm leading-relaxed text-on-surface">{terminalNote}</p>
        </div>
      ) : null}

      {/* ── Step meta row ───────────────────────────────────── */}
      {selectedCurrentStep ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge tone="neutral">
            {formatEnumLabel(selectedCurrentStep.stepType)}
          </StatusBadge>
          {selectedCurrentStep.phase ? (
            <StatusBadge tone="neutral">
              Phase: {selectedCurrentStep.phase}
            </StatusBadge>
          ) : null}
          {failedRunStep?.status ? (
            <StatusBadge tone={tone}>{failedRunStep.status}</StatusBadge>
          ) : null}
        </div>
      ) : null}

      {/* ── Recovery actions ────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap gap-2">
        {selectedCanGuideBlockedAgent ? (
          <button
            type="button"
            onClick={onGuideBlockedAgent}
            disabled={busyAction !== null}
            className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyAction === 'guideRestart' ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <ArrowRight size={16} />
            )}
            Guide blocked agent
          </button>
        ) : null}

        <button
          type="button"
          onClick={onRestartExecution}
          disabled={!canRestartFromPhase || busyAction !== null}
          className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busyAction === 'restart' ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {restartPhaseLabel}
        </button>

        <button
          type="button"
          onClick={onResetAndRestart}
          disabled={!canResetAndRestart || busyAction !== null}
          className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busyAction === 'reset' ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          Reset and restart
        </button>

        <button
          type="button"
          onClick={onCancelRun}
          disabled={!currentRunIsActive || busyAction !== null}
          className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busyAction === 'cancel' ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <Square size={16} />
          )}
          Cancel run
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-secondary">
        {isRunFailed
          ? 'Add operator guidance in the Operate tab before restarting — the agent will read it on the next attempt.'
          : 'The agent is paused and waiting for operator guidance. Add a note and restart from the Operate tab.'}
      </p>
    </div>
  );
};
