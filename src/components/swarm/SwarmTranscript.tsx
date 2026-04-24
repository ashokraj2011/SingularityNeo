import React, { useMemo } from 'react';
import { CheckCircle2, Loader2, MessageCircle, Scale, Sparkles, XCircle } from 'lucide-react';
import MarkdownContent from '../MarkdownContent';
import { StatusBadge } from '../EnterpriseUI';
import { cn } from '../../lib/utils';
import type {
  CapabilityChatMessage,
  SwarmParticipant,
  SwarmSessionStatus,
  SwarmTurnType,
} from '../../types';

/**
 * Chronological transcript of a swarm debate.
 *
 * Messages are grouped by `swarmTurnType` (OPENING → REBUTTAL → SYNTHESIS →
 * VOTE) with separator rows between groups so operators can see the phase of
 * the debate at a glance. Each message shows both the speaking agent and its
 * home capability so a cross-capability contribution is obvious.
 */
type Props = {
  transcript: CapabilityChatMessage[];
  participants: SwarmParticipant[];
  status: SwarmSessionStatus | null;
  streaming: boolean;
  initiatingPrompt?: string;
  /** Used for resolving `participantAgentId` → display name. */
  resolveAgentName?: (agentId: string) => string | undefined;
  /** Used for resolving `sourceCapabilityId` → display name. */
  resolveCapabilityName?: (capabilityId: string) => string | undefined;
};

type TurnGroup = {
  turnType: SwarmTurnType | 'UNKNOWN';
  messages: CapabilityChatMessage[];
};

const TURN_META: Record<
  SwarmTurnType,
  { label: string; hint: string; icon: React.ComponentType<{ size?: number; className?: string }>; tone: 'brand' | 'neutral' | 'warning' | 'success' }
> = {
  OPENING: {
    label: 'Opening statements',
    hint: 'Each participant lays out their initial position.',
    icon: MessageCircle,
    tone: 'brand',
  },
  REBUTTAL: {
    label: 'Rebuttals',
    hint: 'Participants challenge each other’s openings.',
    icon: Scale,
    tone: 'neutral',
  },
  SYNTHESIS: {
    label: 'Synthesis',
    hint: 'The lead participant proposes a unified plan.',
    icon: Sparkles,
    tone: 'brand',
  },
  VOTE: {
    label: 'Vote',
    hint: 'Non-lead participants approve or object.',
    icon: CheckCircle2,
    tone: 'success',
  },
};

const groupByTurn = (transcript: CapabilityChatMessage[]): TurnGroup[] => {
  const groups: TurnGroup[] = [];
  for (const message of transcript) {
    const turnType = (message.swarmTurnType ?? 'UNKNOWN') as SwarmTurnType | 'UNKNOWN';
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.turnType === turnType) {
      lastGroup.messages.push(message);
    } else {
      groups.push({ turnType, messages: [message] });
    }
  }
  return groups;
};

export const SwarmTranscript: React.FC<Props> = ({
  transcript,
  participants,
  status,
  streaming,
  initiatingPrompt,
  resolveAgentName,
  resolveCapabilityName,
}) => {
  const groups = useMemo(() => groupByTurn(transcript), [transcript]);

  const agentLookup = useMemo(() => {
    const map = new Map<string, SwarmParticipant>();
    for (const participant of participants) {
      map.set(participant.participantAgentId, participant);
    }
    return map;
  }, [participants]);

  const statusTone = (() => {
    switch (status) {
      case 'APPROVED':
        return 'success' as const;
      case 'REJECTED':
      case 'NO_CONSENSUS':
      case 'BUDGET_EXHAUSTED':
      case 'CANCELLED':
        return 'danger' as const;
      case 'AWAITING_REVIEW':
        return 'warning' as const;
      default:
        return 'brand' as const;
    }
  })();

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2 rounded-2xl border border-outline-variant/40 bg-surface-container-low px-3 py-2">
        <StatusBadge tone="brand">
          <Sparkles size={11} className="mr-1 inline-block" />
          Swarm Debate
        </StatusBadge>
        {status ? <StatusBadge tone={statusTone}>{status}</StatusBadge> : null}
        {streaming ? (
          <span className="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-secondary">
            <Loader2 size={11} className="animate-spin" />
            Live
          </span>
        ) : null}
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-secondary">
          {participants.length} participant{participants.length === 1 ? '' : 's'}
        </span>
      </header>

      {initiatingPrompt ? (
        <div className="rounded-2xl border border-outline-variant/40 bg-white px-3 py-2 text-sm leading-relaxed text-on-surface">
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.15em] text-secondary">
            Initiating prompt
          </p>
          <p className="mt-1 whitespace-pre-wrap">{initiatingPrompt}</p>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant/50 bg-surface-container-low px-3 py-6 text-center text-sm text-secondary">
          Waiting for the first opening statement…
        </div>
      ) : (
        groups.map((group, groupIndex) => {
          const meta = group.turnType === 'UNKNOWN' ? null : TURN_META[group.turnType];
          const Icon = meta?.icon;
          return (
            <section key={`${group.turnType}-${groupIndex}`}>
              {meta ? (
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-px flex-1 bg-outline-variant/40" />
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/40 bg-white px-2.5 py-1 text-[0.66rem] font-bold uppercase tracking-[0.15em] text-secondary">
                    {Icon ? <Icon size={11} /> : null}
                    {meta.label}
                  </div>
                  <div className="h-px flex-1 bg-outline-variant/40" />
                </div>
              ) : null}
              <div className="space-y-2">
                {group.messages.map(message => {
                  const participant = message.agentId
                    ? agentLookup.get(message.agentId)
                    : undefined;
                  const agentName =
                    message.agentName
                    || (message.agentId ? resolveAgentName?.(message.agentId) : undefined)
                    || (participant ? `Agent ${participant.participantAgentId.slice(0, 8)}` : 'Agent');
                  const capabilityName =
                    message.sourceCapabilityId
                      ? resolveCapabilityName?.(message.sourceCapabilityId) ?? message.sourceCapabilityId
                      : participant?.participantCapabilityId
                        ? resolveCapabilityName?.(participant.participantCapabilityId)
                        : undefined;
                  const roleBadge = participant?.participantRole === 'LEAD';
                  const isVote = message.swarmTurnType === 'VOTE';

                  return (
                    <article
                      key={message.id}
                      className={cn(
                        'rounded-2xl border px-3 py-2.5',
                        isVote
                          ? 'border-emerald-300/60 bg-emerald-50/60'
                          : 'border-outline-variant/40 bg-white',
                      )}
                    >
                      <header className="mb-1 flex flex-wrap items-center gap-1.5">
                        <p className="text-[0.72rem] font-bold text-on-surface">
                          {agentName}
                        </p>
                        {capabilityName ? (
                          <span className="text-[0.66rem] text-secondary">
                            · {capabilityName}
                          </span>
                        ) : null}
                        {roleBadge ? <StatusBadge tone="brand">Lead</StatusBadge> : null}
                        {participant?.lastVote && isVote ? (
                          <StatusBadge
                            tone={participant.lastVote === 'APPROVE' ? 'success' : 'danger'}
                          >
                            {participant.lastVote === 'APPROVE' ? (
                              <CheckCircle2 size={11} className="mr-1 inline-block" />
                            ) : (
                              <XCircle size={11} className="mr-1 inline-block" />
                            )}
                            {participant.lastVote}
                          </StatusBadge>
                        ) : null}
                      </header>
                      <div className="text-sm leading-relaxed text-on-surface">
                        <MarkdownContent content={message.content || ''} />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
};

export default SwarmTranscript;
