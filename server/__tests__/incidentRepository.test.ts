// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  query: vi.fn(),
}));

import { query } from '../db';
import {
  createIncident,
  getIncidentDetail,
  linkPacketToIncident,
} from '../incidents/repository';
import type { CapabilityIncident } from '../../src/types';

const queryMock = vi.mocked(query);

const rowResult = <T>(rows: T[]) =>
  ({
    rows,
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  }) as any;

const buildIncidentRow = () => ({
  id: 'INC-123',
  external_id: 'PD-42',
  source: 'pagerduty',
  capability_id: 'CAP-INC',
  title: 'Trading latency spike',
  severity: 'SEV1',
  status: 'triggered',
  detected_at: '2026-04-17T00:00:00.000Z',
  resolved_at: null,
  affected_services: ['trading-gateway'],
  affected_paths: ['src/trading/**/*.ts'],
  summary: 'Latency spiked after deploy',
  postmortem_url: null,
  raw_payload: { summary: 'Latency spiked after deploy' },
  created_by_actor_user_id: 'USR-1',
  created_at: '2026-04-17T00:00:00.000Z',
  updated_at: '2026-04-17T00:05:00.000Z',
});

const buildLinkRow = () => ({
  incident_id: 'INC-123',
  packet_bundle_id: 'EVD-123',
  correlation: 'CONFIRMED',
  correlation_score: 0.91,
  correlation_reasons: ['Modified 2 paths matching incident scope.'],
  linked_by_actor_user_id: 'USR-1',
  linked_by_actor_display_name: 'Ashok',
  linked_at: '2026-04-17T01:00:00.000Z',
  packet_title: 'Trade Router Evidence Packet',
  work_item_id: 'WI-1',
  run_id: 'RUN-1',
  touched_paths: ['src/trading/router.ts'],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('incident repository', () => {
  it('creates incidents with normalized typed fields', async () => {
    queryMock.mockResolvedValueOnce(rowResult([buildIncidentRow()]));

    const saved = await createIncident({
      id: 'INC-123',
      externalId: 'PD-42',
      source: 'pagerduty',
      capabilityId: 'CAP-INC',
      title: 'Trading latency spike',
      severity: 'SEV1',
      status: 'triggered',
      detectedAt: '2026-04-17T00:00:00.000Z',
      affectedServices: ['trading-gateway'],
      affectedPaths: ['src/trading/**/*.ts'],
      summary: 'Latency spiked after deploy',
      rawPayload: { summary: 'Latency spiked after deploy' },
      createdByActorUserId: 'USR-1',
      linkedPackets: [],
    });

    expect(saved).toMatchObject<Partial<CapabilityIncident>>({
      id: 'INC-123',
      externalId: 'PD-42',
      capabilityId: 'CAP-INC',
      severity: 'SEV1',
      affectedPaths: ['src/trading/**/*.ts'],
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0]?.[0])).toContain(
      'INSERT INTO capability_incidents',
    );
  });

  it('hydrates incident detail with linked packets', async () => {
    queryMock
      .mockResolvedValueOnce(rowResult([buildIncidentRow()]))
      .mockResolvedValueOnce(rowResult([buildLinkRow()]));

    const incident = await getIncidentDetail('INC-123');

    expect(incident?.id).toBe('INC-123');
    expect(incident?.linkedPackets).toHaveLength(1);
    expect(incident?.linkedPackets[0]).toMatchObject({
      incidentId: 'INC-123',
      packetBundleId: 'EVD-123',
      packetTitle: 'Trade Router Evidence Packet',
      touchedPaths: ['src/trading/router.ts'],
    });
  });

  it('returns enriched packet links after upsert', async () => {
    queryMock
      .mockResolvedValueOnce(
        rowResult([
          {
            incident_id: 'INC-123',
            packet_bundle_id: 'EVD-123',
            correlation: 'SUSPECTED',
            correlation_score: 0.76,
            correlation_reasons: ['Packet was generated within 24 hours of incident detection.'],
            linked_by_actor_user_id: 'USR-1',
            linked_by_actor_display_name: 'Ashok',
            linked_at: '2026-04-17T01:00:00.000Z',
          },
        ]),
      )
      .mockResolvedValueOnce(rowResult([buildLinkRow()]));

    const link = await linkPacketToIncident({
      incidentId: 'INC-123',
      packetBundleId: 'EVD-123',
      correlation: 'SUSPECTED',
      correlationScore: 0.76,
      correlationReasons: ['Packet was generated within 24 hours of incident detection.'],
      linkedAt: '2026-04-17T01:00:00.000Z',
      linkedBy: 'USR-1',
      linkedByActorDisplayName: 'Ashok',
    });

    expect(link.packetTitle).toBe('Trade Router Evidence Packet');
    expect(link.correlation).toBe('CONFIRMED');
    expect(link.touchedPaths).toEqual(['src/trading/router.ts']);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
