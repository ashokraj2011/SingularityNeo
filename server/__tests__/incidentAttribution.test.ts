// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../evidencePackets', () => ({
  getEvidencePacket: vi.fn(),
}));

vi.mock('../incidents/repository', () => ({
  listIncidentGuardrailPromotions: vi.fn(),
}));

import { getEvidencePacket } from '../evidencePackets';
import { listIncidentGuardrailPromotions } from '../incidents/repository';
import { renderIncidentPostmortemMarkdown } from '../incidents/attribution';

const getEvidencePacketMock = vi.mocked(getEvidencePacket);
const listIncidentGuardrailPromotionsMock = vi.mocked(listIncidentGuardrailPromotions);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('incident attribution markdown', () => {
  it('renders replayable contributor sections with digests and guardrail promotions', async () => {
    getEvidencePacketMock.mockResolvedValue({
      bundleId: 'EVD-123',
      capabilityId: 'CAP-INC',
      workItemId: 'WI-1',
      title: 'Trade Router Evidence Packet',
      summary: 'Summary',
      digestSha256: 'digest-123',
      createdAt: '2026-04-17T00:00:00.000Z',
      generatedBy: 'Ashok',
      touchedPaths: ['src/trading/router.ts', 'src/trading/orders.ts'],
      payload: {
        latestRun: { assignedAgentId: 'BUILDER' },
        runDetail: {
          waits: [
            {
              type: 'APPROVAL',
              approvalDecisions: [
                {
                  disposition: 'REQUEST_CHANGES',
                  actorDisplayName: 'Reviewer One',
                  comment: 'Please override only after rollback test.',
                },
                {
                  disposition: 'APPROVE',
                  actorDisplayName: 'Commander',
                  comment: 'Approved',
                },
              ],
            },
          ],
          steps: [],
        },
      },
      incidentLinks: [],
    } as any);
    listIncidentGuardrailPromotionsMock.mockResolvedValue([
      {
        incidentId: 'INC-123',
        packetBundleId: 'EVD-123',
        capabilityId: 'CAP-INC',
        concernText: 'Require rollback simulation before override.',
        status: 'PENDING',
        requestedByActorDisplayName: 'Ashok',
        createdAt: '2026-04-17T02:00:00.000Z',
      },
    ] as any);

    const markdown = await renderIncidentPostmortemMarkdown({
      id: 'INC-123',
      source: 'manual',
      capabilityId: 'CAP-INC',
      title: 'Trading regression',
      severity: 'SEV1',
      status: 'resolved',
      detectedAt: '2026-04-17T01:00:00.000Z',
      resolvedAt: '2026-04-17T03:00:00.000Z',
      affectedServices: ['trade-router'],
      affectedPaths: ['src/trading/**/*.ts'],
      linkedPackets: [
        {
          incidentId: 'INC-123',
          packetBundleId: 'EVD-123',
          correlation: 'CONFIRMED',
          correlationReasons: ['Modified 2 paths matching incident scope.'],
          linkedAt: '2026-04-17T03:30:00.000Z',
          packetTitle: 'Trade Router Evidence Packet',
        },
        {
          incidentId: 'INC-123',
          packetBundleId: 'EVD-999',
          correlation: 'SUSPECTED',
          correlationReasons: ['Packet was generated within 24 hours of incident detection.'],
          linkedAt: '2026-04-17T03:35:00.000Z',
          packetTitle: 'Suspected Packet',
        },
      ],
    } as any);

    expect(markdown).toContain('## AI Contribution Analysis - INC-123');
    expect(markdown).toContain('#### [Trade Router Evidence Packet](/e/EVD-123)');
    expect(markdown).toContain('Evidence digest: `digest-123`');
    expect(markdown).toContain('Confirmed contributors: 1');
    expect(markdown).toContain('Suspected, pending review: 1');
    expect(markdown).toContain('Require rollback simulation before override.');
  });
});
