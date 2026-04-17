import { getEvidencePacket } from '../evidencePackets';
import { listIncidentGuardrailPromotions } from './repository';
import { findCandidatePackets } from './correlation';
import type { CapabilityIncident } from '../../src/types';

const formatDate = (value?: string) => {
  if (!value) {
    return 'Unknown';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString();
};

const toPacketPermalink = (bundleId: string) => `/e/${encodeURIComponent(bundleId)}`;

const summarizeApprovalContext = async (bundleId: string) => {
  const packet = await getEvidencePacket(bundleId);
  if (!packet?.payload.runDetail?.waits?.length) {
    return {
      role: packet?.payload.latestRun?.assignedAgentId || 'Unknown',
      reviewerConcerns: 0,
      overriddenConcerns: 0,
      approver: 'None recorded',
      toolTouchCount: packet?.touchedPaths?.length || 0,
      digestSha256: packet?.digestSha256 || 'Unavailable',
    };
  }

  let reviewerConcerns = 0;
  let overriddenConcerns = 0;
  let approver = 'None recorded';
  const role =
    packet.payload.latestRun?.assignedAgentId ||
    packet.payload.runDetail.steps?.find(step => step.status === 'COMPLETED')?.agentId ||
    'Unknown';

  packet.payload.runDetail.waits.forEach(wait => {
    if (wait.type !== 'APPROVAL') {
      return;
    }
    reviewerConcerns += (wait.approvalDecisions || []).filter(
      decision => decision.disposition === 'REQUEST_CHANGES',
    ).length;
    overriddenConcerns += (wait.approvalDecisions || []).filter(decision =>
      String(decision.comment || '').toLowerCase().includes('override'),
    ).length;
    const approveDecision = (wait.approvalDecisions || []).find(
      decision => decision.disposition === 'APPROVE',
    );
    if (approveDecision?.actorDisplayName) {
      approver = approveDecision.actorDisplayName;
    }
  });

  return {
    role,
    reviewerConcerns,
    overriddenConcerns,
    approver,
    toolTouchCount: packet.touchedPaths?.length || 0,
    digestSha256: packet.digestSha256,
  };
};

export const renderIncidentPostmortemMarkdown = async (
  incident: CapabilityIncident,
): Promise<string> => {
  const confirmed = incident.linkedPackets.filter(link => link.correlation === 'CONFIRMED');
  const suspected = incident.linkedPackets.filter(link => link.correlation === 'SUSPECTED');
  const promotions = await listIncidentGuardrailPromotions({
    incidentId: incident.id,
    capabilityId: incident.capabilityId,
  });

  const confirmedSections = await Promise.all(
    confirmed.map(async link => {
      const context = await summarizeApprovalContext(link.packetBundleId);
      const title = link.packetTitle || link.packetBundleId;
      return [
        `#### [${title}](${toPacketPermalink(link.packetBundleId)})`,
        `- Role at time of change: **${context.role}**`,
        `- Evidence digest: \`${context.digestSha256}\``,
        `- REVIEWER concerns raised: ${context.reviewerConcerns}`,
        `- REVIEWER concerns overridden: ${context.overriddenConcerns} by ${context.approver}`,
        `- Tool calls touching incident scope: ${context.toolTouchCount}`,
        `- Correlation reasons: ${link.correlationReasons.join('; ') || 'No reasons recorded.'}`,
      ].join('\n');
    }),
  );

  return [
    `## AI Contribution Analysis - ${incident.id}`,
    '',
    `**Incident:** ${incident.title} (${incident.severity})  `,
    `**Detected:** ${formatDate(incident.detectedAt)}  `,
    `**Resolved:** ${formatDate(incident.resolvedAt)}`,
    '',
    '### Candidate AI-assisted changes reviewed',
    `- Total packets in review set: ${incident.linkedPackets.length}`,
    `- Confirmed contributors: ${confirmed.length}`,
    `- Suspected, pending review: ${suspected.length}`,
    '',
    '### Confirmed contributors',
    confirmedSections.length > 0 ? confirmedSections.join('\n\n') : '- None confirmed yet.',
    '',
    '### Guardrails added by learning loop',
    promotions.length > 0
      ? promotions
          .map(
            promotion =>
              `- ${promotion.concernText} (${promotion.status.toLowerCase()} request created ${formatDate(promotion.createdAt)})`,
          )
          .join('\n')
      : '- No incident-derived guardrail promotion requests have been recorded yet.',
    '',
    '### Replay',
    'Full evidence packets are content-addressed and replayable through their packet permalinks and digest markers.',
  ].join('\n');
};

export const renderIncidentAlibiMarkdown = async (
  incident: CapabilityIncident,
): Promise<string> => {
  const candidates = await findCandidatePackets({ incident, limit: 500 });
  const timeWindowStart = new Date(new Date(incident.detectedAt).getTime() - 72 * 3600 * 1000).toISOString();
  
  const recentPackets = candidates.filter(c => new Date(c.packet.createdAt).getTime() > new Date(timeWindowStart).getTime());
  const overlapping = recentPackets.filter(c => c.overlapCount > 0);
  
  return [
    `## Mathematical Proof of Non-Involvement - ${incident.id}`,
    '',
    `**Incident:** ${incident.title} (${incident.severity})  `,
    `**Detected:** ${formatDate(incident.detectedAt)}  `,
    `**Capability ID:** ${incident.capabilityId || 'Global'}`,
    '',
    '### Verification Parameters',
    `- Scan window evaluated: 72 hours preceding incident detection`,
    `- Total executable packets analyzed: ${recentPackets.length}`,
    `- Paths evaluated globally against incident footprint: ${incident.affectedPaths.length} globs`,
    '',
    '### Verdict',
    overlapping.length === 0 
      ? `**CLEAR**. Zero (0) generative workspace actions intersected with the identified incident zones during the evaluated timeframe. The AI autonomous execution framework is mathematically cleared of involvement.`
      : `**INCONCLUSIVE**. ${overlapping.length} generative workspace actions intersected with the identified incident zones. A human reviewer must analyze the correlation report.`,
    '',
    '### Cryptographic Hashes Analyzed',
    '```',
    recentPackets.length > 0 ? recentPackets.slice(0, 10).map(c => c.packet.digestSha256).join('\n') + (recentPackets.length > 10 ? '\n...' : '') : 'No packets found in window.',
    '```',
  ].join('\n');
};

