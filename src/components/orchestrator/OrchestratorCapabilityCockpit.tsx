import React from 'react';
import { AlertCircle, ArrowRight, Bot, MessageSquareText, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import { StatusBadge } from '../EnterpriseUI';
import type { ExecutionDispatchState } from '../../types';

type DeliveryBlockingItem = {
  label: string;
  nextRequiredAction?: string;
  blockingReason?: string;
  description?: string;
  actionLabel: string;
  path: string;
};

type GoldenPathStep = {
  id: string;
  label: string;
  path: string;
  status: 'COMPLETE' | 'CURRENT' | 'UP_NEXT';
};

type Props = {
  canStartDelivery: boolean;
  deliveryBlockingItem: DeliveryBlockingItem | null;
  nextActionTitle: string;
  nextActionDescription: string;
  goldenPathSummary: string;
  goldenPathPercentComplete: number;
  goldenPathSteps: GoldenPathStep[];
  onNavigatePath: (path: string) => void;
  primaryCopilotAgentName: string;
  primaryCopilotAgentRole: string;
  primaryCopilotRoleSummary: string;
  selectedAgentName: string;
  selectedAgentQualitySummary: string;
  executionOwnerLabel: string;
  executionDispatchLabel: string;
  executionDispatchState: ExecutionDispatchState;
  executionQueueReason?: string | null;
  currentDesktopOwnsExecution: boolean;
  canClaimExecution: boolean;
  executionClaimBusy: boolean;
  hasRuntimeExecutor: boolean;
  onClaimDesktopExecution: (forceTakeover: boolean) => void;
  onReleaseDesktopExecution: () => void;
  canReadChat: boolean;
  primaryCopilotAvailable: boolean;
  onOpenFullChat: () => void;
  onOpenTeam: () => void;
};

export const OrchestratorCapabilityCockpit = ({
  canStartDelivery,
  deliveryBlockingItem,
  nextActionTitle,
  nextActionDescription,
  goldenPathSummary,
  goldenPathPercentComplete,
  goldenPathSteps,
  onNavigatePath,
  primaryCopilotAgentName,
  primaryCopilotAgentRole,
  primaryCopilotRoleSummary,
  selectedAgentName,
  selectedAgentQualitySummary,
  executionOwnerLabel,
  executionDispatchLabel,
  executionDispatchState,
  executionQueueReason,
  currentDesktopOwnsExecution,
  canClaimExecution,
  executionClaimBusy,
  hasRuntimeExecutor,
  onClaimDesktopExecution,
  onReleaseDesktopExecution,
  canReadChat,
  primaryCopilotAvailable,
  onOpenFullChat,
  onOpenTeam,
}: Props) => (
  <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
    <div className="workspace-surface space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="form-kicker">Capability cockpit</p>
          <h2 className="mt-1 text-lg font-bold text-on-surface">
            One operating loop for work, waits, evidence, and learning
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-secondary">
            Work is the primary cockpit. Home summarizes, while Chat, Agents, and Evidence stay
            available as companion drills when you need to go deeper.
          </p>
        </div>
        <StatusBadge tone={canStartDelivery ? 'success' : 'warning'}>
          {canStartDelivery ? 'Delivery gate clear' : 'Delivery gated'}
        </StatusBadge>
      </div>

      {deliveryBlockingItem ? (
        <div className="workspace-inline-alert workspace-inline-alert-warning">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{deliveryBlockingItem.label}</p>
            <p className="mt-1 text-sm leading-relaxed">
              {deliveryBlockingItem.nextRequiredAction ||
                deliveryBlockingItem.blockingReason ||
                deliveryBlockingItem.description}
            </p>
            <button
              type="button"
              onClick={() => onNavigatePath(deliveryBlockingItem.path)}
              className="enterprise-button enterprise-button-secondary mt-3"
            >
              <ArrowRight size={16} />
              {deliveryBlockingItem.actionLabel}
            </button>
          </div>
        </div>
      ) : (
        <div className="workspace-meta-card border-emerald-200 bg-emerald-50/50">
          <p className="workspace-meta-label">Next move</p>
          <p className="mt-2 text-sm font-semibold text-on-surface">{nextActionTitle}</p>
          <p className="mt-2 text-sm leading-relaxed text-secondary">{nextActionDescription}</p>
        </div>
      )}

      <div className="rounded-[1.5rem] border border-outline-variant/25 bg-surface-container-low/45 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Golden path</p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">{goldenPathSummary}</p>
          </div>
          <StatusBadge tone="brand">{goldenPathPercentComplete}% complete</StatusBadge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {goldenPathSteps.map(step => (
            <button
              key={step.id}
              type="button"
              onClick={() => onNavigatePath(step.path)}
              className={cn(
                'rounded-2xl border px-3 py-3 text-left transition',
                step.status === 'COMPLETE'
                  ? 'border-emerald-200 bg-emerald-50/70'
                  : step.status === 'CURRENT'
                    ? 'border-primary/20 bg-primary/8'
                    : 'border-outline-variant/30 bg-white/80 hover:border-primary/20',
              )}
            >
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.16em] text-secondary">
                {step.status === 'COMPLETE'
                  ? 'Complete'
                  : step.status === 'CURRENT'
                    ? 'Current'
                    : 'Up next'}
              </p>
              <p className="mt-2 text-sm font-semibold text-on-surface">{step.label}</p>
            </button>
          ))}
        </div>
      </div>
    </div>

    <div className="workspace-surface space-y-4">
      <div>
        <p className="form-kicker">Capability copilot</p>
        <h2 className="mt-1 text-lg font-bold text-on-surface">{primaryCopilotAgentName}</h2>
        <p className="mt-1 text-sm leading-relaxed text-secondary">
          One user-facing copilot routes work to specialists and keeps the live operating story
          grounded in workflow state, evidence, and learning.
        </p>
      </div>

      <div className="workspace-meta-card border-outline-variant/50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="workspace-meta-label">Desktop execution owner</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">{executionOwnerLabel}</p>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              {executionDispatchState === 'ASSIGNED'
                ? `Automation is routed through ${executionOwnerLabel}.`
                : executionQueueReason === 'EXECUTOR_DISCONNECTED'
                  ? 'The previous desktop owner disconnected. Queued runs will resume after a desktop takes ownership again.'
                  : executionQueueReason === 'EXECUTOR_RELEASED'
                    ? 'Execution was released and queued work is waiting for a new desktop owner.'
                    : 'Queued runs stay visible until an eligible desktop claims this capability.'}
            </p>
          </div>
          <StatusBadge
            tone={
              executionDispatchState === 'ASSIGNED'
                ? 'success'
                : executionDispatchState === 'STALE_EXECUTOR'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {executionDispatchLabel}
          </StatusBadge>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {!currentDesktopOwnsExecution ? (
            <button
              type="button"
              onClick={() => onClaimDesktopExecution(executionDispatchState !== 'UNASSIGNED')}
              disabled={!canClaimExecution || executionClaimBusy || !hasRuntimeExecutor}
              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Bot size={16} />
              {executionDispatchState !== 'UNASSIGNED'
                ? 'Take over desktop execution'
                : 'Claim desktop execution'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onReleaseDesktopExecution}
              disabled={!canClaimExecution || executionClaimBusy}
              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Square size={16} />
              Release desktop execution
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">Primary role</p>
          <p className="mt-2 text-sm font-semibold text-on-surface">{primaryCopilotAgentRole}</p>
          <p className="mt-2 text-xs leading-relaxed text-secondary">{primaryCopilotRoleSummary}</p>
        </div>
        <div className="workspace-meta-card">
          <p className="workspace-meta-label">Current specialist</p>
          <p className="mt-2 text-sm font-semibold text-on-surface">{selectedAgentName}</p>
          <p className="mt-2 text-xs leading-relaxed text-secondary">{selectedAgentQualitySummary}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={onOpenFullChat}
          disabled={!primaryCopilotAvailable || !canReadChat}
          className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <p className="text-sm font-semibold text-on-surface">Open companion chat</p>
          <p className="mt-1 text-xs leading-relaxed text-secondary">
            Deep-dive into the full capability conversation when the cockpit thread is not enough.
          </p>
        </button>
        <button
          type="button"
          onClick={onOpenTeam}
          className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white"
        >
          <p className="text-sm font-semibold text-on-surface">Inspect specialists</p>
          <p className="mt-1 text-xs leading-relaxed text-secondary">
            Review the specialist roster, learning state, and operating contracts behind the
            copilot.
          </p>
        </button>
      </div>
    </div>
  </section>
);
