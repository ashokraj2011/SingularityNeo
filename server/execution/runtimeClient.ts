import type { ActorContext } from '../../src/types';

type ExecutionClientContext = {
  controlPlaneUrl: string;
  executorId: string;
  actor?: ActorContext | null;
};

let executionClientContext: ExecutionClientContext | null = null;

const normalizeBaseUrl = (value?: string | null) =>
  String(value || '').trim().replace(/\/+$/, '');

const withActorHeaders = (actor?: ActorContext | null) => {
  const headers = new Headers({
    'Content-Type': 'application/json',
  });

  if (actor?.userId) {
    headers.set('x-singularity-actor-user-id', actor.userId);
  }
  if (actor?.displayName) {
    headers.set('x-singularity-actor-display-name', actor.displayName);
  }
  if (actor?.teamIds?.length) {
    headers.set('x-singularity-actor-team-ids', JSON.stringify(actor.teamIds));
  }
  if (actor?.actedOnBehalfOfStakeholderIds?.length) {
    headers.set(
      'x-singularity-actor-stakeholder-ids',
      JSON.stringify(actor.actedOnBehalfOfStakeholderIds),
    );
  }

  return headers;
};

const getRuntimeClientError = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || `Runtime client request failed with status ${response.status}.`;
  } catch {
    return `Runtime client request failed with status ${response.status}.`;
  }
};

export const getExecutionClientContext = () => executionClientContext;

export const isRemoteExecutionClient = () =>
  Boolean(executionClientContext?.controlPlaneUrl && executionClientContext?.executorId);

export const setExecutionClientContext = (context: ExecutionClientContext | null) => {
  executionClientContext = context
    ? {
        ...context,
        controlPlaneUrl: normalizeBaseUrl(context.controlPlaneUrl),
      }
    : null;
};

export const runWithExecutionClientContext = async <T>(
  context: ExecutionClientContext,
  action: () => Promise<T>,
) => {
  const previous = getExecutionClientContext();
  setExecutionClientContext(context);
  try {
    return await action();
  } finally {
    setExecutionClientContext(previous);
  }
};

export const executionRuntimeRpc = async <T>(
  operation: string,
  args: Record<string, unknown> = {},
): Promise<T> => {
  if (!executionClientContext?.controlPlaneUrl || !executionClientContext.executorId) {
    throw new Error('The execution runtime client is not configured.');
  }

  const response = await fetch(
    new URL(
      `/api/runtime/executors/${encodeURIComponent(executionClientContext.executorId)}/rpc`,
      `${executionClientContext.controlPlaneUrl}/`,
    ),
    {
      method: 'POST',
      headers: withActorHeaders(executionClientContext.actor),
      body: JSON.stringify({
        operation,
        args,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await getRuntimeClientError(response));
  }

  const payload = (await response.json()) as { result: T };
  return payload.result;
};
