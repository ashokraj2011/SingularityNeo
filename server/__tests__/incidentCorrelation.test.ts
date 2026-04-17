// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  query: vi.fn(),
}));

vi.mock('../incidents/repository', () => ({
  getIncidentDetail: vi.fn(),
  linkPacketToIncident: vi.fn(),
}));

import { query } from '../db';
import { getIncidentDetail, linkPacketToIncident } from '../incidents/repository';
import {
  correlateIncident,
  findCandidatePackets,
  matchesPathGlob,
  scoreCorrelationCandidate,
} from '../incidents/correlation';

const queryMock = vi.mocked(query);
const getIncidentDetailMock = vi.mocked(getIncidentDetail);
const linkPacketToIncidentMock = vi.mocked(linkPacketToIncident);

const rowResult = <T>(rows: T[]) =>
  ({
    rows,
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  }) as any;

const incident = {
  id: 'INC-123',
  source: 'manual' as const,
  capabilityId: 'CAP-INC',
  title: 'Trading regression',
  severity: 'SEV2' as const,
  status: 'triggered' as const,
  detectedAt: '2026-04-17T12:00:00.000Z',
  affectedServices: ['trade-router'],
  affectedPaths: [
    'src/trading/orders/*.ts',
    'src/trading/core/*.ts',
    'src/trading/api/*.ts',
    'src/trading/risk/*.ts',
    'src/trading/ui/*.ts',
  ],
  linkedPackets: [],
};

const buildPacketRow = ({
  bundleId,
  createdAt,
  touchedPaths,
  payload = {},
}: {
  bundleId: string;
  createdAt: string;
  touchedPaths: string[];
  payload?: Record<string, unknown>;
}) => ({
  bundle_id: bundleId,
  capability_id: 'CAP-INC',
  work_item_id: 'WI-1',
  run_id: 'RUN-1',
  title: `${bundleId} packet`,
  summary: 'Evidence packet',
  digest_sha256: `${bundleId}-digest`,
  created_at: createdAt,
  touched_paths: touchedPaths,
  payload,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('incident correlation', () => {
  it('matches concrete file paths against incident globs', () => {
    expect(matchesPathGlob('src/trading/orders/create.ts', 'src/trading/orders/*.ts')).toBe(true);
    expect(matchesPathGlob('src/trading/orders/create.ts', 'src/trading/**/*.js')).toBe(false);
  });

  it('combines reviewer override, recency, and overlap into a bounded candidate score', () => {
    const score = scoreCorrelationCandidate({
      incident,
      packetCreatedAt: '2026-04-17T11:30:00.000Z',
      affectedPathCount: 5,
      matchedPaths: ['src/trading/orders/create.ts'],
      payload: {
        runEvents: [{ message: 'override reviewer concern' }],
        runDetail: { waits: [] },
      },
    });

    expect(score).toBeGreaterThan(0.75);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('correlates candidate packets and persists only non-dismissed links', async () => {
    queryMock.mockResolvedValueOnce(
      rowResult([
        buildPacketRow({
          bundleId: 'EVD-HIGH',
          createdAt: '2026-04-17T11:00:00.000Z',
          touchedPaths: [
            'src/trading/orders/create.ts',
            'src/trading/core/router.ts',
            'src/trading/api/routes.ts',
            'src/trading/risk/checks.ts',
            'src/trading/ui/order-form.ts',
          ],
          payload: {
            runDetail: { waits: [] },
            runEvents: [],
          },
        }),
        buildPacketRow({
          bundleId: 'EVD-LOW',
          createdAt: '2026-03-19T12:00:00.000Z',
          touchedPaths: ['src/trading/orders/create.ts'],
          payload: {
            runDetail: { waits: [] },
            runEvents: [],
          },
        }),
      ]),
    );
    getIncidentDetailMock.mockResolvedValue(incident as any);
    linkPacketToIncidentMock.mockImplementation(async link => ({
      ...link,
      correlationReasons: link.correlationReasons || [],
      linkedAt: link.linkedAt || '2026-04-17T12:01:00.000Z',
      packetTitle: `${link.packetBundleId} packet`,
      touchedPaths:
        link.packetBundleId === 'EVD-HIGH'
          ? ['src/trading/orders/create.ts', 'src/trading/core/router.ts']
          : ['src/trading/orders/create.ts'],
    }));

    const result = await correlateIncident({
      incidentId: 'INC-123',
      actorUserId: 'USR-1',
      actorDisplayName: 'Ashok',
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.packet.bundleId).toBe('EVD-HIGH');
    expect(result.candidates[0]?.correlation).toBe('SUSPECTED');
    expect(result.candidates[1]?.correlation).toBe('DISMISSED');
    expect(result.persisted).toHaveLength(1);
    expect(linkPacketToIncidentMock).toHaveBeenCalledTimes(1);
    expect(result.candidates[0]?.reasons[0]).toContain('Modified 5 paths');
  });

  it('can inspect candidate packets directly for UI preview flows', async () => {
    queryMock.mockResolvedValueOnce(
      rowResult([
        buildPacketRow({
          bundleId: 'EVD-BLAST',
          createdAt: '2026-04-10T12:00:00.000Z',
          touchedPaths: ['src/trading/orders/create.ts'],
        }),
      ]),
    );

    const candidates = await findCandidatePackets({ incident: incident as any, limit: 5 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      packet: { bundleId: 'EVD-BLAST' },
      correlation: 'DISMISSED',
      overlapCount: 1,
    });
  });
});
