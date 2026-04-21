import type express from 'express';

export const getApiErrorStatus = (message: string) =>
  /unauthorized|not registered in this workspace/i.test(message)
    ? 401
    : /not found/i.test(message)
    ? 404
    : /already has an active or waiting workflow run|already exists/i.test(message)
      ? 409
      : /required|invalid|must/i.test(message)
        ? 400
        : /not configured/i.test(message)
          ? 503
          : /not registered|forbidden|not allowed/i.test(message)
            ? 403
            : 500;

export const toApiErrorPayload = (error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'The persistence request failed unexpectedly.';

  return {
    status: getApiErrorStatus(message),
    payload: {
      error: message,
    },
  };
};

export const sendApiError = (response: express.Response, error: unknown) => {
  const { status, payload } = toApiErrorPayload(error);
  response.status(status).json(payload);
};
