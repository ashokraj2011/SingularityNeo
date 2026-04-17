import { getEvidencePacket } from '../evidencePackets';
import { query } from '../db';
import type {
  ModelRiskMonitoringSummary,
  ProviderKey,
} from '../../src/types';
import { listIncidents, listIncidentGuardrailPromotions } from './repository';
import { hasOverriddenReviewerConcern } from './correlation';

const ONE_HOUR_MS = 36e5;

const toDaysAgoIso = (days: number) => new Date(Date.now() - days * 24 * ONE_HOUR_MS).toISOString();

const withinWindow = (value: string | undefined, windowStart: string) =>
  Boolean(value) && new Date(value!).getTime() >= new Date(windowStart).getTime();

const detectPacketProvider = (packet: Awaited<ReturnType<typeof getEvidencePacket>>) => {
  const models = new Set<string>();
  const providerKeys = new Set<ProviderKey | 'unknown'>();

  packet?.payload.interactionFeed.records.forEach(record => {
    const model = String(record.metadata?.model || '').trim();
    if (model) {
      models.add(model);
    }
  });

  const agentModels = Array.isArray((packet?.payload as Record<string, any>)?.agentModels)
    ? ((packet?.payload as Record<string, any>).agentModels as Array<Record<string, any>>)
    : [];
  agentModels.forEach(model => {
    const provider = String(model.providerKey || '').trim();
    const selectedModel = String(model.model || '').trim();
    if (provider === 'github-copilot' || provider === 'local-openai') {
      providerKeys.add(provider);
    }
    if (selectedModel) {
      models.add(selectedModel);
    }
  });

  return {
    providerKey: providerKeys.values().next().value || 'unknown',
    model: Array.from(models)[0] || 'unknown',
  };
};

export const buildModelRiskMonitoringSummary = async ({
  capabilityId,
  windowDays = 90,
}: {
  capabilityId?: string;
  windowDays?: number;
}): Promise<ModelRiskMonitoringSummary> => {
  const windowStart = toDaysAgoIso(windowDays);
  const incidents = (await listIncidents({ capabilityId, limit: 250 })).filter(incident =>
    withinWindow(incident.detectedAt, windowStart),
  );
  const promotions = (await listIncidentGuardrailPromotions({ capabilityId })).filter(promotion =>
    withinWindow(promotion.createdAt, windowStart),
  );

  const confirmedLinks = incidents.flatMap(incident =>
    incident.linkedPackets
      .filter(link => link.correlation === 'CONFIRMED')
      .map(link => ({ incident, link })),
  );
  const suspectedLinks = incidents.flatMap(incident =>
    incident.linkedPackets
      .filter(link => link.correlation === 'SUSPECTED')
      .map(link => ({ incident, link })),
  );
  const blastRadiusLinks = incidents.flatMap(incident =>
    incident.linkedPackets
      .filter(link => link.correlation === 'BLAST_RADIUS')
      .map(link => ({ incident, link })),
  );

  const packetIds = Array.from(
    new Set(
      [...confirmedLinks, ...suspectedLinks, ...blastRadiusLinks].map(item => item.link.packetBundleId),
    ),
  );

  const packetMap = new Map(
    await Promise.all(
      packetIds.map(async packetId => [packetId, await getEvidencePacket(packetId)] as const),
    ),
  );

  const providerRollup = new Map<string, { providerKey: ProviderKey | 'unknown'; model: string; confirmed: number; suspected: number }>();
  let overrideCandidates = 0;
  let overrideConfirmed = 0;
  let attributionHoursTotal = 0;

  confirmedLinks.forEach(({ incident, link }) => {
    const packet = packetMap.get(link.packetBundleId);
    if (packet?.createdAt) {
      const linkedAt = new Date(link.linkedAt).getTime();
      const detectedAt = new Date(incident.detectedAt).getTime();
      if (Number.isFinite(linkedAt) && Number.isFinite(detectedAt) && linkedAt >= detectedAt) {
        attributionHoursTotal += (linkedAt - detectedAt) / ONE_HOUR_MS;
      }
    }
    if (packet && hasOverriddenReviewerConcern(packet.payload as Record<string, any>)) {
      overrideConfirmed += 1;
    }
    const provider = detectPacketProvider(packet);
    const key = `${provider.providerKey}:${provider.model}`;
    const current = providerRollup.get(key) || {
      providerKey: provider.providerKey,
      model: provider.model,
      confirmed: 0,
      suspected: 0,
    };
    current.confirmed += 1;
    providerRollup.set(key, current);
  });

  suspectedLinks.forEach(({ link }) => {
    const packet = packetMap.get(link.packetBundleId);
    const provider = detectPacketProvider(packet);
    const key = `${provider.providerKey}:${provider.model}`;
    const current = providerRollup.get(key) || {
      providerKey: provider.providerKey,
      model: provider.model,
      confirmed: 0,
      suspected: 0,
    };
    current.suspected += 1;
    providerRollup.set(key, current);
  });

  packetMap.forEach(packet => {
    if (packet && hasOverriddenReviewerConcern(packet.payload as Record<string, any>)) {
      overrideCandidates += 1;
    }
  });

  const packetCountResult = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM capability_evidence_packets
      WHERE created_at >= $1
        ${capabilityId ? 'AND capability_id = $2' : ''}
    `,
    capabilityId ? [windowStart, capabilityId] : [windowStart],
  );

  const incidentDerivedLearningResult = await query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM capability_learning_updates
      WHERE trigger_type = 'INCIDENT_DERIVED'
        AND created_at >= $1
        ${capabilityId ? 'AND capability_id = $2' : ''}
    `,
    capabilityId ? [windowStart, capabilityId] : [windowStart],
  );

  return {
    capabilityId,
    windowDays,
    totals: {
      incidents: incidents.length,
      confirmedContributors: confirmedLinks.length,
      suspectedContributors: suspectedLinks.length,
      blastRadiusLinks: blastRadiusLinks.length,
      totalPackets: Number(packetCountResult.rows[0]?.count || 0),
      incidentContributionRate:
        Number(packetCountResult.rows[0]?.count || 0) > 0
          ? confirmedLinks.length / Number(packetCountResult.rows[0]?.count || 1)
          : 0,
      meanTimeToAttributionHours:
        confirmedLinks.length > 0 ? attributionHoursTotal / confirmedLinks.length : 0,
      overrideToIncidentRate: overrideCandidates > 0 ? overrideConfirmed / overrideCandidates : 0,
      guardrailPromotionsRequested: promotions.length,
      incidentDerivedLearningCount: Number(incidentDerivedLearningResult.rows[0]?.count || 0),
    },
    bySeverity: ['SEV1', 'SEV2', 'SEV3', 'SEV4'].map(severity => ({
      severity: severity as 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4',
      incidentCount: incidents.filter(incident => incident.severity === severity).length,
      confirmedContributors: confirmedLinks.filter(item => item.incident.severity === severity)
        .length,
    })),
    byProvider: Array.from(providerRollup.values())
      .sort((left, right) => right.confirmed - left.confirmed || right.suspected - left.suspected)
      .map(item => ({
        providerKey: item.providerKey,
        model: item.model,
        confirmedContributors: item.confirmed,
        suspectedContributors: item.suspected,
      })),
    recentIncidents: incidents.slice(0, 12),
    guardrailPromotions: promotions.map(promotion => ({
      incidentId: promotion.incidentId,
      packetBundleId: promotion.packetBundleId,
      capabilityId: promotion.capabilityId,
      concernText: promotion.concernText,
      status: promotion.status,
      requestedAt: promotion.createdAt,
      requestedBy: promotion.requestedByActorDisplayName,
    })),
  };
};

export const renderModelRiskMonitoringMarkdown = async ({
  capabilityId,
  windowDays,
}: {
  capabilityId?: string;
  windowDays?: number;
}) => {
  const summary = await buildModelRiskMonitoringSummary({ capabilityId, windowDays });
  return [
    `# Model Risk Monitoring Summary${capabilityId ? ` - ${capabilityId}` : ''}`,
    '',
    `Window: last ${summary.windowDays} days`,
    '',
    `- Incidents: ${summary.totals.incidents}`,
    `- Confirmed AI contributors: ${summary.totals.confirmedContributors}`,
    `- Suspected contributors: ${summary.totals.suspectedContributors}`,
    `- Blast radius links: ${summary.totals.blastRadiusLinks}`,
    `- AI incident contribution rate: ${(summary.totals.incidentContributionRate * 100).toFixed(1)}%`,
    `- Mean time to attribution: ${summary.totals.meanTimeToAttributionHours.toFixed(1)} hours`,
    `- Override-to-incident rate: ${(summary.totals.overrideToIncidentRate * 100).toFixed(1)}%`,
    `- Incident-derived learning updates: ${summary.totals.incidentDerivedLearningCount}`,
    '',
    '## Provider trends',
    ...(summary.byProvider.length > 0
      ? summary.byProvider.map(
          item =>
            `- ${item.providerKey} / ${item.model}: ${item.confirmedContributors} confirmed, ${item.suspectedContributors} suspected`,
        )
      : ['- No incident-linked packet trends recorded yet.']),
  ].join('\n');
};
