// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getApiErrorStatus, toApiErrorPayload } from '../errors';

describe('API error mapping', () => {
  it.each([
    ['Capability not found', 404],
    ['Workflow already exists', 409],
    ['Capability id is required', 400],
    ['Runtime is not configured', 503],
    ['Workspace path is not allowed', 403],
    ['Unexpected failure', 500],
  ])('maps "%s" to status %s', (message, expectedStatus) => {
    expect(getApiErrorStatus(message)).toBe(expectedStatus);
  });

  it('returns a stable JSON error payload', () => {
    expect(toApiErrorPayload(new Error('Capability not found'))).toEqual({
      status: 404,
      payload: {
        error: 'Capability not found',
      },
    });
  });
});
