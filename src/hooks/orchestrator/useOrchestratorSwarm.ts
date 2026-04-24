/**
 * Swarm-debate state for the OrchestratorCopilotDock.
 *
 * Extracted from Orchestrator.tsx so the 6000-line page file stays readable.
 * The hook mirrors the AssistantDock pattern but scopes itself to the
 * currently-selected capability + work item so the swarm session lifecycle
 * stays naturally tied to the operator's current focus.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  cancelSwarmSession,
  listSwarmSessionsForWorkItem,
} from '../../lib/api';
import { useSwarmSession } from '../../components/swarm';
import type {
  SwarmSessionSummary,
  SwarmSessionDetail,
  SwarmSessionStatus,
  CapabilityChatMessage,
} from '../../types';
import type { TaggedParticipant } from '../../components/swarm';

const MAX_PARTICIPANTS = 3;

const REVIEW_STATUSES: SwarmSessionStatus[] = [
  'AWAITING_REVIEW',
  'APPROVED',
  'NO_CONSENSUS',
  'BUDGET_EXHAUSTED',
];

export interface OrchestratorSwarmState {
  // Composer ribbon
  taggedParticipants: TaggedParticipant[];
  showMentionPicker: boolean;
  hasTaggedParticipants: boolean;
  hasEnoughForSwarm: boolean;
  // Active session
  activeSwarmSessionId: string | null;
  swarmDetail: SwarmSessionDetail | null;
  swarmStatus: SwarmSessionStatus | null;
  swarmTranscript: CapabilityChatMessage[];
  swarmStreaming: boolean;
  swarmError: string | null;
  // Attention-queue review cards (sessions awaiting review for this WI)
  reviewSessions: SwarmSessionSummary[];
  // Handlers
  handleTagParticipant: (participant: TaggedParticipant) => void;
  handleRemoveParticipant: (participant: TaggedParticipant) => void;
  handleDebateStarted: (sessionId: string, prompt: string) => void;
  handleCancelSwarmComposer: () => void;
  handleCancelActiveSession: () => Promise<void>;
  handleRefreshSession: () => Promise<void>;
  setShowMentionPicker: React.Dispatch<React.SetStateAction<boolean>>;
  clearSwarm: () => void;
}

type UseOrchestratorSwarmArgs = {
  anchorCapabilityId: string;
  selectedWorkItemId: string | null;
};

// Small helper: deduplicate by capability::agent key
const addParticipant = (
  current: TaggedParticipant[],
  next: TaggedParticipant,
): TaggedParticipant[] => {
  const key = `${next.capabilityId}::${next.agentId}`;
  if (current.some(p => `${p.capabilityId}::${p.agentId}` === key)) return current;
  if (current.length >= MAX_PARTICIPANTS) return current;
  return [...current, next];
};

export const useOrchestratorSwarm = ({
  anchorCapabilityId,
  selectedWorkItemId,
}: UseOrchestratorSwarmArgs): OrchestratorSwarmState => {
  const [taggedParticipants, setTaggedParticipants] = useState<TaggedParticipant[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [activeSwarmSessionId, setActiveSwarmSessionId] = useState<string | null>(null);
  const [reviewSessions, setReviewSessions] = useState<SwarmSessionSummary[]>([]);

  // SSE + snapshot subscription for the live/terminal session.
  const swarmSession = useSwarmSession(anchorCapabilityId, activeSwarmSessionId);

  // Clear all swarm state when the selected work item changes so the dock
  // doesn't carry a previous WI's debate into the next one.
  useEffect(() => {
    setTaggedParticipants([]);
    setShowMentionPicker(false);
    setActiveSwarmSessionId(null);
    setReviewSessions([]);
  }, [selectedWorkItemId]);

  // Periodically fetch AWAITING_REVIEW sessions for the selected work item
  // so the attention queue card appears without needing a manual refresh.
  useEffect(() => {
    if (!selectedWorkItemId) {
      setReviewSessions([]);
      return undefined;
    }
    let cancelled = false;

    const fetch = async () => {
      try {
        const result = await listSwarmSessionsForWorkItem(
          anchorCapabilityId,
          selectedWorkItemId,
        );
        if (!cancelled) {
          setReviewSessions(
            (result.sessions ?? []).filter(s => REVIEW_STATUSES.includes(s.status)),
          );
        }
      } catch {
        // Best-effort — don't interrupt the main dock experience.
      }
    };

    void fetch();
    const interval = window.setInterval(() => {
      if (!cancelled) void fetch();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [anchorCapabilityId, selectedWorkItemId]);

  const handleTagParticipant = useCallback((participant: TaggedParticipant) => {
    setTaggedParticipants(current => addParticipant(current, participant));
    setShowMentionPicker(false);
  }, []);

  const handleRemoveParticipant = useCallback((participant: TaggedParticipant) => {
    const key = `${participant.capabilityId}::${participant.agentId}`;
    setTaggedParticipants(current =>
      current.filter(p => `${p.capabilityId}::${p.agentId}` !== key),
    );
  }, []);

  const handleDebateStarted = useCallback((sessionId: string) => {
    setActiveSwarmSessionId(sessionId);
    setTaggedParticipants([]);
    setShowMentionPicker(false);
  }, []);

  const handleCancelSwarmComposer = useCallback(() => {
    setTaggedParticipants([]);
    setShowMentionPicker(false);
  }, []);

  const handleCancelActiveSession = useCallback(async () => {
    if (!activeSwarmSessionId) return;
    try {
      await cancelSwarmSession(anchorCapabilityId, activeSwarmSessionId);
      await swarmSession.refresh();
    } catch {
      // Surface error via swarmSession.error
    }
  }, [activeSwarmSessionId, anchorCapabilityId, swarmSession]);

  const handleRefreshSession = useCallback(async () => {
    await swarmSession.refresh();
  }, [swarmSession]);

  const clearSwarm = useCallback(() => {
    setActiveSwarmSessionId(null);
    setTaggedParticipants([]);
    setShowMentionPicker(false);
  }, []);

  return {
    // Composer ribbon
    taggedParticipants,
    showMentionPicker,
    hasTaggedParticipants: taggedParticipants.length > 0,
    hasEnoughForSwarm: taggedParticipants.length >= 2,
    // Active session
    activeSwarmSessionId,
    swarmDetail: swarmSession.detail,
    swarmStatus: swarmSession.status,
    swarmTranscript: swarmSession.transcript,
    swarmStreaming: swarmSession.streaming,
    swarmError: swarmSession.error,
    // Attention queue
    reviewSessions,
    // Handlers
    handleTagParticipant,
    handleRemoveParticipant,
    handleDebateStarted,
    handleCancelSwarmComposer,
    handleCancelActiveSession,
    handleRefreshSession,
    setShowMentionPicker,
    clearSwarm,
  };
};
