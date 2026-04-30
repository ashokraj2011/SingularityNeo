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
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(resolveApiUrl(input), {
    ...init,
    headers: withActorHeaders(init?.headers),
  });
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
  init?: RequestInit,
): Promise<string> => {
  const response = await fetch(resolveApiUrl(input), {
    ...init,
    headers: withActorHeaders(init?.headers),
  });
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
