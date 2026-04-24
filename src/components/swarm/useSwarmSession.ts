import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelSwarmSession,
  getSwarmSession,
  streamSwarmDebate,
} from '../../lib/api';
import type {
  CapabilityChatMessage,
  SwarmSessionDetail,
  SwarmSessionStatus,
} from '../../types';

/**
 * Local state reducer for a live swarm session subscription.
 *
 * Responsibilities:
 *   1. Pull the initial `SwarmSessionDetail` once so the UI renders without
 *      waiting for the stream.
 *   2. Subscribe to `streamSwarmDebate` and fold `turn` / `status` / `terminal`
 *      events into local state as they arrive.
 *   3. Re-fetch the session snapshot on `terminal` so the caller gets the
 *      produced-artifact id (the SSE payload includes it but a fresh read is
 *      cheap insurance against ordering glitches).
 *
 * The hook gracefully tolerates mid-debate subscriptions: if the session is
 * already terminal by the time the component mounts, `onTerminal` still fires
 * via the one-shot snapshot so the review card appears immediately.
 */
export interface UseSwarmSessionResult {
  detail: SwarmSessionDetail | null;
  status: SwarmSessionStatus | null;
  transcript: CapabilityChatMessage[];
  terminalReason: string | null;
  producedArtifactId?: string;
  streaming: boolean;
  error: string | null;
  cancel: () => Promise<void>;
  refresh: () => Promise<void>;
}

const TERMINAL_STATUSES: SwarmSessionStatus[] = [
  'APPROVED',
  'REJECTED',
  'NO_CONSENSUS',
  'BUDGET_EXHAUSTED',
  'CANCELLED',
];

const isTerminalStatus = (status: SwarmSessionStatus | null | undefined) =>
  !!status && TERMINAL_STATUSES.includes(status);

export const useSwarmSession = (
  capabilityId: string | null,
  sessionId: string | null,
): UseSwarmSessionResult => {
  const [detail, setDetail] = useState<SwarmSessionDetail | null>(null);
  const [status, setStatus] = useState<SwarmSessionStatus | null>(null);
  const [transcript, setTranscript] = useState<CapabilityChatMessage[]>([]);
  const [terminalReason, setTerminalReason] = useState<string | null>(null);
  const [producedArtifactId, setProducedArtifactId] = useState<string | undefined>(
    undefined,
  );
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const seenTurnIdsRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!capabilityId || !sessionId) return;
    try {
      const next = await getSwarmSession(capabilityId, sessionId);
      setDetail(next);
      setStatus(next.session.status);
      setTranscript(next.transcript);
      setTerminalReason(next.session.terminalReason ?? null);
      setProducedArtifactId(next.producedArtifactId);
      seenTurnIdsRef.current = new Set(next.transcript.map(t => t.id));
    } catch (err) {
      setError((err as Error).message || 'Failed to load swarm session.');
    }
  }, [capabilityId, sessionId]);

  useEffect(() => {
    if (!capabilityId || !sessionId) {
      setDetail(null);
      setStatus(null);
      setTranscript([]);
      setTerminalReason(null);
      setProducedArtifactId(undefined);
      setStreaming(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setError(null);

    (async () => {
      await refresh();
      if (cancelled) return;

      // If the session already hit a terminal state before we subscribed,
      // skip SSE entirely — the snapshot above already populated everything.
      setDetail(current => {
        if (!current || isTerminalStatus(current.session.status)) {
          return current;
        }
        setStreaming(true);
        unsubscribeRef.current = streamSwarmDebate(capabilityId, sessionId, {
          onTurn: turn => {
            if (seenTurnIdsRef.current.has(turn.id)) return;
            seenTurnIdsRef.current.add(turn.id);
            setTranscript(prev => [...prev, turn]);
          },
          onStatus: nextStatus => {
            setStatus(nextStatus as SwarmSessionStatus);
          },
          onTerminal: payload => {
            setStatus(payload.status as SwarmSessionStatus);
            setTerminalReason(payload.terminalReason);
            if (payload.artifactId) {
              setProducedArtifactId(payload.artifactId);
            }
            setStreaming(false);
            // Re-sync once the stream closes so we get any participant
            // vote rationales that arrived alongside the terminal event.
            void refresh();
          },
          onError: err => {
            setError(err.message);
            setStreaming(false);
          },
        });
        return current;
      });
    })();

    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [capabilityId, sessionId, refresh]);

  const cancel = useCallback(async () => {
    if (!capabilityId || !sessionId) return;
    try {
      await cancelSwarmSession(capabilityId, sessionId);
      await refresh();
    } catch (err) {
      setError((err as Error).message || 'Failed to cancel swarm session.');
    }
  }, [capabilityId, sessionId, refresh]);

  return {
    detail,
    status,
    transcript,
    terminalReason,
    producedArtifactId,
    streaming,
    error,
    cancel,
    refresh,
  };
};

export default useSwarmSession;
