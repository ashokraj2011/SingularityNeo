import { EventEmitter } from 'node:events';
import type { ChatStreamEvent, RunEvent } from '../src/types';

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const runEventChannel = (runId: string) => `run:${runId}`;
const capabilityChannel = (capabilityId: string) => `capability:${capabilityId}`;
const chatChannel = (capabilityId: string) => `chat:${capabilityId}`;

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
