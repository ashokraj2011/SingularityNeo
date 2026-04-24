import { EventEmitter } from 'node:events';
import type {
  AgentBounty,
  AgentBountySignal,
  CapabilityChatMessage,
  ChatStreamEvent,
  RunEvent,
  SwarmSessionStatus,
  SwarmTerminalReason,
} from '../src/types';

const emitter = new EventEmitter();
emitter.setMaxListeners(100);
const activeBounties = new Map<string, AgentBounty>();
const completedBountySignals = new Map<string, AgentBountySignal>();

const runEventChannel = (runId: string) => `run:${runId}`;
const capabilityChannel = (capabilityId: string) => `capability:${capabilityId}`;
const chatChannel = (capabilityId: string) => `chat:${capabilityId}`;
const bountyChannel = (capabilityId: string) => `bounty:${capabilityId}`;
const signalChannel = (bountyId: string) => `signal:${bountyId}`;
const swarmChannel = (sessionId: string) => `swarm:${sessionId}`;

export const publishBounty = (bounty: AgentBounty) => {
  if (activeBounties.has(bounty.id)) {
    throw new Error(`Bounty ${bounty.id} is already active.`);
  }

  completedBountySignals.delete(bounty.id);
  activeBounties.set(bounty.id, bounty);
  emitter.emit(bountyChannel(bounty.capabilityId), bounty);
};

export const subscribeToBounties = (
  capabilityId: string,
  listener: (event: AgentBounty) => void,
) => {
  emitter.on(bountyChannel(capabilityId), listener);
  return () => emitter.off(bountyChannel(capabilityId), listener);
};

export const publishBountySignal = (signal: AgentBountySignal) => {
  activeBounties.delete(signal.bountyId);
  completedBountySignals.set(signal.bountyId, signal);
  emitter.emit(signalChannel(signal.bountyId), signal);
};

export const getPublishedBounty = (bountyId: string) => activeBounties.get(bountyId);
export const getPublishedBountySignal = (bountyId: string) =>
  completedBountySignals.get(bountyId);

export const waitForBountySignal = (
  bountyId: string,
  timeoutMs: number = 300000
): Promise<AgentBountySignal> => {
  const completedSignal = completedBountySignals.get(bountyId);
  if (completedSignal) {
    return Promise.resolve(completedSignal);
  }

  if (!activeBounties.has(bountyId)) {
    return Promise.reject(new Error(`Bounty ${bountyId} is not active.`));
  }

  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout;

    const listener = (signal: AgentBountySignal) => {
      clearTimeout(timeout);
      emitter.off(signalChannel(bountyId), listener);
      resolve(signal);
    };

    timeout = setTimeout(() => {
      emitter.off(signalChannel(bountyId), listener);
      reject(new Error(`Timeout waiting for signal on bounty ${bountyId}`));
    }, timeoutMs);

    emitter.on(signalChannel(bountyId), listener);
  });
};

export const __eventBusTestUtils = {
  resetBounties: () => {
    activeBounties.clear();
    completedBountySignals.clear();
  },
};

export const publishRunEvent = (event: RunEvent) => {
  emitter.emit(runEventChannel(event.runId), event);
  emitter.emit(capabilityChannel(event.capabilityId), event);
};

export const subscribeToRunEvents = (
  runId: string,
  listener: (event: RunEvent) => void,
) => {
  emitter.on(runEventChannel(runId), listener);
  return () => emitter.off(runEventChannel(runId), listener);
};

export const publishChatStreamEvent = (
  capabilityId: string,
  event: ChatStreamEvent,
) => {
  emitter.emit(chatChannel(capabilityId), event);
};

export const subscribeToCapabilityChat = (
  capabilityId: string,
  listener: (event: ChatStreamEvent) => void,
) => {
  emitter.on(chatChannel(capabilityId), listener);
  return () => emitter.off(chatChannel(capabilityId), listener);
};

/**
 * Swarm-debate stream events. One channel per swarm session; the orchestrator
 * emits a `turn` event for every message it appends and a `terminal` event
 * when the session transitions to its final state. The client UI subscribes
 * for the lifetime of the debate.
 *
 * Kept on its own channel (rather than reusing `chat:...`) because:
 *   - Multiple swarms can run against the same capability concurrently.
 *   - The payload shape differs enough from `ChatStreamEvent` that conflating
 *     them would force every chat consumer to branch on discriminators.
 */
export type SwarmStreamEvent =
  | {
      kind: 'status';
      sessionId: string;
      status: SwarmSessionStatus;
    }
  | {
      kind: 'turn';
      sessionId: string;
      turn: CapabilityChatMessage;
    }
  | {
      kind: 'terminal';
      sessionId: string;
      status: SwarmSessionStatus;
      terminalReason: SwarmTerminalReason;
      artifactId?: string;
    };

export const publishSwarmStreamEvent = (
  sessionId: string,
  event: SwarmStreamEvent,
) => {
  emitter.emit(swarmChannel(sessionId), event);
};

export const subscribeToSwarmStream = (
  sessionId: string,
  listener: (event: SwarmStreamEvent) => void,
) => {
  emitter.on(swarmChannel(sessionId), listener);
  return () => emitter.off(swarmChannel(sessionId), listener);
};
