// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportIncidentAttributionToDatadog,
  exportMrmSummaryToDatadog,
} from '../incidents/exports/datadog';
import {
  exportIncidentAttributionToServiceNow,
  exportMrmSummaryToServiceNow,
} from '../incidents/exports/servicenow';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  process.env.TEST_DD_SECRET = 'dd-api-key';
  process.env.TEST_DD_APP = 'dd-app-key';
  process.env.TEST_SN_SECRET = 'service-now-password';
});

afterEach(() => {
  delete process.env.TEST_DD_SECRET;
  delete process.env.TEST_DD_APP;
  delete process.env.TEST_SN_SECRET;
});

describe('incident export connectors', () => {
  it('publishes incident attribution events to Datadog with API key headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        event: {
          id: 12345,
          title: 'accepted',
        },
      }),
    });

    const result = await exportIncidentAttributionToDatadog({
      config: {
        target: 'datadog',
        enabled: true,
        authType: 'API_KEY',
        baseUrl: 'https://api.datadoghq.eu',
        secretReference: 'TEST_DD_SECRET',
        settings: {
          appKeyReference: 'TEST_DD_APP',
          tags: ['env:test', 'team:ops'],
        },
      },
      incident: {
        id: 'INC-1',
        source: 'manual',
        capabilityId: 'CAP-1',
        title: 'Trade gateway latency',
        severity: 'SEV1',
        status: 'resolved',
        detectedAt: '2026-04-17T10:00:00.000Z',
        affectedServices: ['trade-gateway'],
        affectedPaths: ['src/trading/**/*.ts'],
        linkedPackets: [],
      },
      markdown: '## AI Contribution Analysis',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.datadoghq.eu/api/v1/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'DD-API-KEY': 'dd-api-key',
          'DD-APPLICATION-KEY': 'dd-app-key',
        }),
      }),
    );
    expect(result).toMatchObject({
      responseStatus: 202,
      externalReference: '12345',
    });
  });

  it('publishes MRM summary metrics and event text to Datadog', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ status: 'ok' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ event: { id: 987 } }),
      });

    await exportMrmSummaryToDatadog({
      config: {
        target: 'datadog',
        enabled: true,
        authType: 'API_KEY',
        baseUrl: 'https://api.datadoghq.com',
        secretReference: 'TEST_DD_SECRET',
        settings: {},
      },
      summary: {
        capabilityId: 'CAP-1',
        windowDays: 90,
        totals: {
          incidents: 3,
          confirmedContributors: 2,
          suspectedContributors: 1,
          blastRadiusLinks: 1,
          totalPackets: 20,
          incidentContributionRate: 0.1,
          meanTimeToAttributionHours: 3,
          overrideToIncidentRate: 0.2,
          guardrailPromotionsRequested: 1,
          incidentDerivedLearningCount: 2,
        },
        bySeverity: [],
        byProvider: [],
        recentIncidents: [],
        guardrailPromotions: [],
      },
      markdown: '# Model Risk Monitoring Summary',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.datadoghq.com/api/v1/series',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.datadoghq.com/api/v1/events',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('exports incident attribution to ServiceNow using basic auth and configured tables', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        result: {
          sys_id: 'sys-123',
          short_description: '[AI Attribution] Trade gateway latency',
        },
      }),
    });

    const result = await exportIncidentAttributionToServiceNow({
      config: {
        target: 'servicenow',
        enabled: true,
        authType: 'BASIC',
        baseUrl: 'https://acme.service-now.com',
        basicUsername: 'codex-user',
        secretReference: 'TEST_SN_SECRET',
        settings: {
          incidentTableName: 'u_ai_incident_attr',
        },
      },
      incident: {
        id: 'INC-2',
        source: 'servicenow',
        capabilityId: 'CAP-2',
        title: 'Trade gateway latency',
        severity: 'SEV2',
        status: 'investigating',
        detectedAt: '2026-04-17T10:00:00.000Z',
        affectedServices: ['trade-gateway'],
        affectedPaths: ['src/trading/**/*.ts'],
        linkedPackets: [],
      },
      markdown: '## AI Contribution Analysis',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://acme.service-now.com/api/now/table/u_ai_incident_attr',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from('codex-user:service-now-password').toString('base64')}`,
        }),
      }),
    );
    expect(result.externalReference).toBe('sys-123');
  });

  it('exports MRM summaries to ServiceNow summary tables', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        result: {
          number: 'MRM001234',
        },
      }),
    });

    await exportMrmSummaryToServiceNow({
      config: {
        target: 'servicenow',
        enabled: true,
        authType: 'BASIC',
        baseUrl: 'https://acme.service-now.com',
        basicUsername: 'codex-user',
        secretReference: 'TEST_SN_SECRET',
        settings: {
          mrmTableName: 'u_ai_mrm_summary',
        },
      },
      summary: {
        capabilityId: 'CAP-1',
        windowDays: 30,
        totals: {
          incidents: 1,
          confirmedContributors: 1,
          suspectedContributors: 0,
          blastRadiusLinks: 0,
          totalPackets: 4,
          incidentContributionRate: 0.25,
          meanTimeToAttributionHours: 1,
          overrideToIncidentRate: 0,
          guardrailPromotionsRequested: 0,
          incidentDerivedLearningCount: 1,
        },
        bySeverity: [],
        byProvider: [],
        recentIncidents: [],
        guardrailPromotions: [],
      },
      markdown: '# Model Risk Monitoring Summary',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://acme.service-now.com/api/now/table/u_ai_mrm_summary',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
