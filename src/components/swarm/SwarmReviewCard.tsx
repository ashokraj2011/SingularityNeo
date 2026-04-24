import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Package,
  XCircle,
} from 'lucide-react';
import {
  promoteSwarmSessionToWorkItem,
  reviewSwarmSession,
} from '../../lib/api';
import { StatusBadge } from '../EnterpriseUI';
import type {
  WorkItem,
  SwarmSessionDetail,
  SwarmSessionStatus,
  SwarmTerminalReason,
} from '../../types';

/**
 * Review card for a swarm session that has reached a terminal state.
 *
 * Rendered inside the orchestrator's attention queue (and anywhere else a
 * reviewer might need to act on a debate). Behaviour depends on the session
 * status:
 *   - `AWAITING_REVIEW`   → Approve / Reject buttons + open artifact.
 *   - `APPROVED` (WI)     → "Promote to work item" button (only for
 *                            `GENERAL_CHAT` scope sessions).
 *   - `NO_CONSENSUS`      → Shows disagreement artifact; no mutating actions.
 *   - `BUDGET_EXHAUSTED`  → Same as above with a distinct copy.
 *   - Terminal / complete → No actions.
 */
type Props = {
  capabilityId: string;
  session: SwarmSessionDetail;
  onArtifactOpen?: (artifactId: string) => void;
  onWorkItemCreated?: (result: {
    workItem: WorkItem;
    swarmSessionId: string;
    linkedArtifactId?: string;
  }) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onError?: (message: string) => void;
};

const STATUS_TONE: Partial<
  Record<SwarmSessionStatus, 'brand' | 'warning' | 'success' | 'danger' | 'neutral'>
> = {
  AWAITING_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  NO_CONSENSUS: 'danger',
  BUDGET_EXHAUSTED: 'danger',
  CANCELLED: 'neutral',
  RUNNING: 'brand',
  PENDING: 'neutral',
};

const TERMINAL_COPY: Record<SwarmTerminalReason, string> = {
  CONSENSUS: 'All participants approved the synthesized plan.',
  NO_CONSENSUS:
    'At least one participant objected to the synthesis. See disagreement artifact.',
  BUDGET_EXHAUSTED:
    'Token budget was exhausted before consensus. Debate terminated early.',
  CANCELLED: 'The debate was cancelled by an operator.',
};

export const SwarmReviewCard: React.FC<Props> = ({
  capabilityId,
  session,
  onArtifactOpen,
  onWorkItemCreated,
  onRefresh,
  onError,
}) => {
  const [busyAction, setBusyAction] = useState<
    'APPROVE' | 'REJECT' | 'PROMOTE' | null
  >(null);
  const [comment, setComment] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const sessionSummary = session.session;
  const status = sessionSummary.status;
  const terminalReason = sessionSummary.terminalReason;
  const artifactId = session.producedArtifactId;
  const isAwaitingReview = status === 'AWAITING_REVIEW';
  const isApprovedGeneralChat =
    status === 'APPROVED' && sessionSummary.sessionScope === 'GENERAL_CHAT';

  const runMutation = async (
    action: 'APPROVE' | 'REJECT' | 'PROMOTE',
    fn: () => Promise<void>,
  ) => {
    setBusyAction(action);
    setLocalError(null);
    try {
      await fn();
    } catch (err) {
      const message = (err as Error).message || `${action} failed.`;
      setLocalError(message);
      onError?.(message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleApprove = () =>
    runMutation('APPROVE', async () => {
      await reviewSwarmSession(capabilityId, sessionSummary.id, 'APPROVE', comment.trim() || undefined);
      onRefresh?.();
    });

  const handleReject = () =>
    runMutation('REJECT', async () => {
      await reviewSwarmSession(capabilityId, sessionSummary.id, 'REJECT', comment.trim() || undefined);
      onRefresh?.();
    });

  const handlePromote = () =>
    runMutation('PROMOTE', async () => {
      const result = await promoteSwarmSessionToWorkItem(capabilityId, sessionSummary.id);
      await onWorkItemCreated?.(result);
      await onRefresh?.();
    });

  const tone = STATUS_TONE[status] ?? 'neutral';
  const terminalCopy = terminalReason ? TERMINAL_COPY[terminalReason] : null;

  return (
    <section className="rounded-2xl border border-outline-variant/40 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="form-kicker">Swarm Debate</p>
          <h3 className="mt-1 text-sm font-bold text-on-surface">
            {sessionSummary.sessionScope === 'WORK_ITEM'
              ? 'Work-item debate'
              : 'General chat debate'}
          </h3>
          <p className="mt-1 line-clamp-2 text-xs text-secondary">
            {sessionSummary.initiatingPrompt}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge tone={tone}>{status.replace(/_/g, ' ')}</StatusBadge>
          <span className="text-[0.66rem] text-secondary">
            {session.participants.length} participant
            {session.participants.length === 1 ? '' : 's'} ·{' '}
            {sessionSummary.tokenBudgetUsed.toLocaleString()} /{' '}
            {sessionSummary.maxTokenBudget.toLocaleString()} tokens
          </span>
        </div>
      </header>

      {terminalCopy ? (
        <p className="mt-3 rounded-xl bg-surface-container-low px-3 py-2 text-xs leading-relaxed text-secondary">
          {terminalCopy}
        </p>
      ) : null}

      {artifactId ? (
        <button
          type="button"
          onClick={() => onArtifactOpen?.(artifactId)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-1.5 text-[0.72rem] font-semibold text-on-surface transition hover:border-primary/30 hover:bg-white"
        >
          <FileText size={13} />
          Open {status === 'NO_CONSENSUS' || status === 'BUDGET_EXHAUSTED'
            ? 'disagreement summary'
            : 'execution plan'}
          <ArrowRight size={12} />
        </button>
      ) : null}

      {isAwaitingReview ? (
        <div className="mt-3 space-y-2">
          <label className="block text-[0.68rem] font-bold uppercase tracking-[0.15em] text-secondary">
            Reviewer note (optional)
          </label>
          <textarea
            value={comment}
            onChange={event => setComment(event.target.value)}
            rows={2}
            placeholder="Leave a short note for the record…"
            className="w-full resize-none rounded-xl border border-outline-variant/50 bg-white px-3 py-2 text-sm text-on-surface outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleApprove}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-[0.72rem] font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'APPROVE' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckCircle2 size={12} />
              )}
              Approve plan
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3.5 py-1.5 text-[0.72rem] font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'REJECT' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <XCircle size={12} />
              )}
              Reject
            </button>
            <p className="ml-auto text-[0.68rem] text-secondary">
              Approval does not start implementation.
            </p>
          </div>
        </div>
      ) : null}

      {isApprovedGeneralChat ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handlePromote}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-[0.72rem] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === 'PROMOTE' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Package size={12} />
            )}
            Promote to work item
          </button>
          <p className="text-[0.68rem] text-secondary">
            Creates a new work item seeded from the plan's rationale.
          </p>
        </div>
      ) : null}

      {localError ? (
        <p className="mt-2 text-[0.72rem] text-red-700">{localError}</p>
      ) : null}
    </section>
  );
};

export default SwarmReviewCard;
