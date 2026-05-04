import type { ActorContext } from '../../contracts';
import { getDesktopBridge, resolveApiUrl } from '../desktop';

export const getError = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
};

export const jsonHeaders = {
  'Content-Type': 'application/json',
};

const DEFAULT_JSON_REQUEST_TIMEOUT_MS = 20_000;

type TimedRequestInit = RequestInit & {
  timeoutMs?: number;
};

const buildTimedRequestSignal = (
  signal?: AbortSignal | null,
  timeoutMs = DEFAULT_JSON_REQUEST_TIMEOUT_MS,
) => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) {
    return timeoutSignal;
  }
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  return signal;
};

const asTimedRequestError = (
  error: unknown,
  method: string,
  input: string,
  timeoutMs: number,
) => {
  if (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new Error(
      `Request timed out after ${timeoutMs}ms (${method.toUpperCase()} ${input}).`,
    );
  }

  return error;
};

let currentActorContext: ActorContext | null = null;

export const getCurrentActorContext = () => currentActorContext;

export const withActorHeaders = (headers?: HeadersInit): HeadersInit => {
  const nextHeaders = new Headers(headers || {});

  if (currentActorContext?.userId) {
    nextHeaders.set('x-singularity-actor-user-id', currentActorContext.userId);
  }
  if (currentActorContext?.displayName) {
    nextHeaders.set(
      'x-singularity-actor-display-name',
      currentActorContext.displayName,
    );
  }
  if (currentActorContext?.teamIds?.length) {
    nextHeaders.set(
      'x-singularity-actor-team-ids',
      JSON.stringify(currentActorContext.teamIds),
    );
  }
  if (currentActorContext?.actedOnBehalfOfStakeholderIds?.length) {
    nextHeaders.set(
      'x-singularity-actor-stakeholder-ids',
      JSON.stringify(currentActorContext.actedOnBehalfOfStakeholderIds),
    );
  }

  return nextHeaders;
};

export const requestJson = async <T>(
  input: string,
  init?: TimedRequestInit,
): Promise<T> => {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_JSON_REQUEST_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(input), {
      ...init,
      headers: withActorHeaders(init?.headers),
      signal: buildTimedRequestSignal(init?.signal, timeoutMs),
    });
  } catch (error) {
    throw asTimedRequestError(
      error,
      init?.method || 'GET',
      input,
      timeoutMs,
    );
  }

  if (!response.ok) {
    throw new Error(await getError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
};

export const requestText = async (
  input: string,
  init?: TimedRequestInit,
): Promise<string> => {
  const timeoutMs = init?.timeoutMs ?? DEFAULT_JSON_REQUEST_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(input), {
      ...init,
      headers: withActorHeaders(init?.headers),
      signal: buildTimedRequestSignal(init?.signal, timeoutMs),
    });
  } catch (error) {
    throw asTimedRequestError(
      error,
      init?.method || 'GET',
      input,
      timeoutMs,
    );
  }
  if (!response.ok) {
    throw new Error(await getError(response));
  }
  return response.text();
};

export const setCurrentActorContext = (actor: ActorContext | null) => {
  currentActorContext = actor;
  const desktop = getDesktopBridge();
  if (desktop?.isDesktop) {
    void desktop.setActorContext(actor);
  }
};
