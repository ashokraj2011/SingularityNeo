import React, { useEffect, useMemo, useState } from 'react';
import { Crown, Loader2, Sparkles, X } from 'lucide-react';
import { startSwarmDebate } from '../../lib/api';
import { StatusBadge } from '../EnterpriseUI';
import { cn } from '../../lib/utils';
import type { TaggedParticipant } from './SwarmMentionPicker';

/**
 * Ribbon shown when 2–3 participants are tagged in the composer.
 *
 * Responsibilities:
 *   1. Render the current participant chips with remove affordances.
 *   2. Let the operator pick which participant leads the synthesis — defaults
 *      to the first tagged (tag order = debate order), per plan §5a.
 *   3. Surface the token-budget estimate with a manual override.
 *   4. Kick off the debate via `startSwarmDebate` and hand the session id
 *      back to the caller. The caller is responsible for mounting the
 *      `SwarmTranscript` + SSE hook after kickoff.
 */

type Props = {
  anchorCapabilityId: string;
  workItemId?: string;
  sessionScope?: 'WORK_ITEM' | 'GENERAL_CHAT';
  participants: TaggedParticipant[];
  /** Current composer text — used as the initiating prompt. */
  prompt: string;
  /** Remove a tagged participant (chip X). */
  onRemoveParticipant: (participant: TaggedParticipant) => void;
  /** Called with the new session id once the debate is accepted. */
  onDebateStarted: (sessionId: string) => void;
  /** Called if the operator bails on swarm and wants to return to single-agent. */
  onCancel: () => void;
  /** Called when kickoff fails so the caller can reset its state. */
  onError?: (message: string) => void;
};

const MIN_PARTICIPANTS = 2;
const MAX_PARTICIPANTS = 3;
const DEFAULT_BUDGET = 120_000;
const MIN_BUDGET = 20_000;
const MAX_BUDGET = 400_000;

// Rough estimator — each turn ~= 2k tokens, 4 turn types × N participants.
// Undershoot is fine; the server enforces the hard cap.
const estimateBudget = (participantCount: number) =>
  Math.min(DEFAULT_BUDGET, 16_000 + participantCount * 24_000);

export const SwarmComposerRibbon: React.FC<Props> = ({
  anchorCapabilityId,
  workItemId,
  sessionScope,
  participants,
  prompt,
  onRemoveParticipant,
  onDebateStarted,
  onCancel,
  onError,
}) => {
  const [leadIndex, setLeadIndex] = useState(0);
  const [budget, setBudget] = useState<number>(estimateBudget(participants.length));
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Re-estimate budget when the participant count changes, but only if the
  // operator hasn't manually overridden it (stays within ±10% of the default).
  useEffect(() => {
    const fresh = estimateBudget(participants.length);
    setBudget(current => {
      const drift = Math.abs(current - estimateBudget(Math.max(participants.length - 1, MIN_PARTICIPANTS)));
      if (drift < 2000) return fresh;
      return current;
    });
  }, [participants.length]);

  // Clamp lead index when a participant is removed.
  useEffect(() => {
    if (leadIndex >= participants.length && participants.length > 0) {
      setLeadIndex(participants.length - 1);
    }
  }, [participants.length, leadIndex]);

  const validCount =
    participants.length >= MIN_PARTICIPANTS && participants.length <= MAX_PARTICIPANTS;
  const trimmedPrompt = prompt.trim();
  const canStart = validCount && trimmedPrompt.length > 0 && !busy;

  const bucketsSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of participants) {
      counts[p.bucket] = (counts[p.bucket] ?? 0) + 1;
    }
    const fragments: string[] = [];
    if (counts.current) fragments.push(`${counts.current} this cap`);
    if (counts.parent) fragments.push(`${counts.parent} parent`);
    if (counts.children) fragments.push(`${counts.children} child`);
    if (counts.shared) fragments.push(`${counts.shared} shared`);
    return fragments.join(' · ');
  }, [participants]);

  const handleStart = async () => {
    if (!canStart) return;
    setBusy(true);
    setLocalError(null);
    try {
      const result = await startSwarmDebate({
        capabilityId: anchorCapabilityId,
        workItemId,
        sessionScope: sessionScope ?? (workItemId ? 'WORK_ITEM' : 'GENERAL_CHAT'),
        initiatingPrompt: trimmedPrompt,
        leadParticipantIndex: leadIndex,
        maxTokenBudget: budget,
        participants: participants.map(p => ({
          capabilityId: p.capabilityId,
          agentId: p.agentId,
        })),
      });
      onDebateStarted(result.sessionId);
    } catch (err) {
      const message = (err as Error).message || 'Failed to start swarm debate.';
      setLocalError(message);
      onError?.(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="brand">
          <Sparkles size={11} className="mr-1 inline-block" />
          Swarm Debate
        </StatusBadge>
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-secondary">
          {participants.length} of 3 agents
          {bucketsSummary ? ` · ${bucketsSummary}` : ''}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {participants.map((participant, index) => {
          const isLead = index === leadIndex;
          return (
            <span
              key={`${participant.capabilityId}::${participant.agentId}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem]',
                isLead
                  ? 'border-primary/40 bg-primary/10 text-on-surface'
                  : 'border-outline-variant/50 bg-white text-on-surface',
              )}
            >
              {isLead ? <Crown size={11} className="text-primary" /> : null}
              <span className="font-semibold">{participant.agentName}</span>
              <span className="text-secondary">· {participant.capabilityName}</span>
              <button
                type="button"
                onClick={() => onRemoveParticipant(participant)}
                className="ml-0.5 rounded-full p-0.5 text-secondary transition hover:bg-surface-container"
                aria-label={`Remove ${participant.agentName}`}
              >
                <X size={11} />
              </button>
            </span>
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-secondary">
          <Crown size={11} />
          Lead
          <select
            value={leadIndex}
            onChange={event => setLeadIndex(Number(event.target.value))}
            disabled={busy || participants.length === 0}
            className="rounded-lg border border-outline-variant/50 bg-white px-2 py-1 text-[0.72rem] font-medium text-on-surface outline-none focus:border-primary/40"
          >
            {participants.map((participant, index) => (
              <option key={`${participant.capabilityId}::${participant.agentId}`} value={index}>
                {participant.agentName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-secondary">
          Token budget
          <input
            type="number"
            min={MIN_BUDGET}
            max={MAX_BUDGET}
            step={1000}
            value={budget}
            onChange={event => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) setBudget(Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, next)));
            }}
            disabled={busy}
            className="w-24 rounded-lg border border-outline-variant/50 bg-white px-2 py-1 text-[0.72rem] font-medium text-on-surface outline-none focus:border-primary/40"
          />
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl px-3 py-1.5 text-[0.72rem] font-semibold text-secondary transition hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            title={
              !validCount
                ? `Tag ${MIN_PARTICIPANTS}–${MAX_PARTICIPANTS} agents to start`
                : !trimmedPrompt
                  ? 'Type an initiating prompt first'
                  : 'Start debate'
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-[0.72rem] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Start debate
          </button>
        </div>
      </div>

      {localError ? (
        <p className="mt-2 text-[0.72rem] text-red-700">{localError}</p>
      ) : null}
    </div>
  );
};

export default SwarmComposerRibbon;
