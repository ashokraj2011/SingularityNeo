// @vitest-environment node
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../incidents/repository', () => ({
  getIncidentServiceCapabilityMap: vi.fn(),
}));

import { getIncidentServiceCapabilityMap } from '../incidents/repository';
import {
  normalizeManualIncidentInput,
  validateIncidentSourceRequest,
  verifyIncidentHmacSignature,
} from '../incidents/ingestion';

const getIncidentServiceCapabilityMapMock = vi.mocked(getIncidentServiceCapabilityMap);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('incident ingestion', () => {
  it('verifies webhook HMAC signatures', () => {
    const rawBody = JSON.stringify({ incident: 'INC-1' });
    const secret = 'top-secret';
    const signature = `v1=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

    expect(() =>
      verifyIncidentHmacSignature({
        rawBody,
        headerValue: signature,
        secret,
      }),
    ).not.toThrow();

    expect(() =>
      verifyIncidentHmacSignature({
        rawBody,
        headerValue: 'v1=deadbeef',
        secret,
      }),
    ).toThrow(/verification failed/i);
  });

  it('normalizes manual incidents with service-to-capability defaults', async () => {
    getIncidentServiceCapabilityMapMock.mockResolvedValue({
      serviceName: 'trade-router',
      capabilityId: 'CAP-ROUTER',
      defaultAffectedPaths: ['src/trading/**/*.ts'],
      ownerEmail: 'owner@example.com',
    });

    const incident = await normalizeManualIncidentInput({
      source: 'manual',
      actorUserId: 'USR-1',
      payload: {
        title: 'Latency spike',
        severity: 'critical',
        status: 'acknowledged',
        serviceName: 'trade-router',
        detectedAt: '2026-04-17T10:00:00-04:00',
      },
    });

    expect(incident.capabilityId).toBe('CAP-ROUTER');
    expect(incident.severity).toBe('SEV1');
    expect(incident.status).toBe('investigating');
    expect(incident.affectedPaths).toEqual(['src/trading/**/*.ts']);
    expect(incident.detectedAt).toBe('2026-04-17T14:00:00.000Z');
  });

  it('validates basic-auth incident sources', () => {
    const authorization = `Basic ${Buffer.from('pagerduty:s3cr3t').toString('base64')}`;

    expect(() =>
      validateIncidentSourceRequest({
        config: {
          source: 'servicenow',
          enabled: true,
          authType: 'BASIC',
          basicUsername: 'pagerduty',
          rateLimitPerMinute: 60,
          settings: { basicPassword: 's3cr3t' },
        },
        rawBody: '{}',
        authorization,
      }),
    ).not.toThrow();
  });
});
