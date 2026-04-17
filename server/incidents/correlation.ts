import { query } from '../db';
import type {
  CapabilityIncident,
  EvidencePacketSummary,
  IncidentCorrelation,
  IncidentCorrelationCandidate,
} from '../../src/types';
import { getIncidentDetail, linkPacketToIncident } from './repository';

const ONE_HOUR_MS = 36e5;

const parseJson = <T,>(value: unknown, fallback: T): T => {
  if (!value) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value as T;
  }
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};

const toIso = (value: unknown) => {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

const normalizePath = (value: string) =>
  value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .trim();

const escapeRegex = (value: string) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');

export const globToRegExp = (pattern: string) => {
  const normalized = normalizePath(pattern);
  const converted = normalized
    .split('')
    .map((char, index, chars) => {
      if (char !== '*') {
        return escapeRegex(char);
      }
      const next = chars[index + 1];
      if (next === '*') {
        return '.*';
      }
      return '[^/]*';
    })
    .join('')
    .replace(/\.\\\*/g, '.*');

  return new RegExp(`^${converted.replace(/\*\*/g, '.*')}$`, 'i');
};

export const matchesPathGlob = (pathValue: string, pattern: string) => {
  const path = normalizePath(pathValue);
  const glob = normalizePath(pattern);
  if (!path || !glob) {
    return false;
  }
  return globToRegExp(glob).test(path);
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const decayByHours = (detectedAt: string, createdAt: string, halfLifeHours = 168) => {
  const detected = new Date(detectedAt).getTime();
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(detected) || !Number.isFinite(created)) {
    return 0;
  }
  const ageHours = Math.max(0, (detected - created) / ONE_HOUR_MS);
  return Math.pow(0.5, ageHours / Math.max(1, halfLifeHours));
};

type PacketRow = Record<string, any> & {
  bundle_id: string;
  capability_id: string;
  work_item_id: string;
  run_id: string | null;
  title: string;
  summary: string;
  digest_sha256: string;
  created_at: string | Date;
  touched_paths: string[];
  payload: unknown;
};

const packetSummaryFromRow = (row: PacketRow): EvidencePacketSummary => ({
  bundleId: row.bundle_id,
  capabilityId: row.capability_id,
  workItemId: row.work_item_id,
  runId: row.run_id || undefined,
  title: row.title,
  summary: row.summary,
  digestSha256: row.digest_sha256,
  createdAt: toIso(row.created_at),
  generatedBy: parseJson<Record<string, unknown>>(row.payload, {})?.generatedBy as string || 'Workspace Operator',
  touchedPaths: Array.isArray(row.touched_paths) ? row.touched_paths.map(String) : [],
});

const getApprovalPayload = (payload: Record<string, any>) => payload?.runDetail?.waits || [];

const getRunEvents = (payload: Record<string, any>) =>
  Array.isArray(payload?.runEvents) ? payload.runEvents : [];

export const hasHumanApproval = (payload: Record<string, any>) =>
  getApprovalPayload(payload).some(
    (wait: Record<string, any>) =>
      wait?.type === 'APPROVAL' &&
      ((Array.isArray(wait?.approvalDecisions) && wait.approvalDecisions.length > 0) ||
        typeof wait?.resolvedBy === 'string'),
  );

export const hasReviewerSignoff = (payload: Record<string, any>) =>
  getApprovalPayload(payload).some(
    (wait: Record<string, any>) =>
      wait?.type === 'APPROVAL' &&
      Array.isArray(wait?.approvalDecisions) &&
      wait.approvalDecisions.some((decision: Record<string, any>) => decision?.disposition === 'APPROVE'),
  );

export const hasOverriddenReviewerConcern = (payload: Record<string, any>) => {
  const events = getRunEvents(payload);
  return events.some((event: Record<string, any>) => {
    const summary = `${event?.message || ''} ${JSON.stringify(event?.details || {})}`.toLowerCase();
    return (
      summary.includes('override') ||
      summary.includes('overridden') ||
      summary.includes('without reviewer signoff')
    );
  });
};

const collectMatchedPaths = (touchedPaths: string[], affectedPaths: string[]) => {
  const matched = new Set<string>();
  for (const touchedPath of touchedPaths) {
    if (affectedPaths.some(pattern => matchesPathGlob(touchedPath, pattern))) {
      matched.add(normalizePath(touchedPath));
    }
  }
  return Array.from(matched);
};

const reasonsFor = ({
  payload,
  packetCreatedAt,
  matchedPaths,
  incident,
}: {
  payload: Record<string, any>;
  packetCreatedAt: string;
  matchedPaths: string[];
  incident: CapabilityIncident;
}) => {
  const reasons: string[] = [];
  if (matchedPaths.length > 0) {
    reasons.push(`Modified ${matchedPaths.length} path${matchedPaths.length === 1 ? '' : 's'} matching the incident scope.`);
  }
  if (hasOverriddenReviewerConcern(payload)) {
    reasons.push('Reviewer concern appears to have been overridden or bypassed.');
  }
  if (
    Math.max(
      0,
      (new Date(incident.detectedAt).getTime() - new Date(packetCreatedAt).getTime()) / ONE_HOUR_MS,
    ) < 24
  ) {
    reasons.push('Packet was generated within 24 hours of incident detection.');
  }
  if (!hasReviewerSignoff(payload)) {
    reasons.push('No explicit reviewer signoff was found in the approval trace.');
  }
  return reasons;
};

export const scoreCorrelationCandidate = ({
  incident,
  packetCreatedAt,
  affectedPathCount,
  matchedPaths,
  payload,
}: {
  incident: CapabilityIncident;
  packetCreatedAt: string;
  affectedPathCount: number;
  matchedPaths: string[];
  payload: Record<string, any>;
}) => {
  const recencyWeight = decayByHours(incident.detectedAt, packetCreatedAt, 168);
  const overlapWeight =
    affectedPathCount > 0 ? Math.min(matchedPaths.length / affectedPathCount, 1) : 0;
  const severityBoost = incident.severity === 'SEV1' ? 1.2 : 1;
  const reviewerOverride = hasOverriddenReviewerConcern(payload) ? 0.3 : 0;
  const humanApproval = hasHumanApproval(payload) ? -0.1 : 0;

  return clamp01(
    clamp01(0.5 * recencyWeight + 0.4 * overlapWeight + reviewerOverride + humanApproval) *
      severityBoost,
  );
};

export const findCandidatePackets = async ({
  incident,
  limit = 10,
}: {
  incident: CapabilityIncident;
  limit?: number;
}): Promise<IncidentCorrelationCandidate[]> => {
  const detectedAt = new Date(incident.detectedAt);
  const windowEnd = detectedAt.toISOString();
  const windowStart = new Date(detectedAt.getTime() - 30 * 24 * ONE_HOUR_MS).toISOString();

  const values: any[] = [windowStart, windowEnd];
  const capabilityFilter = incident.capabilityId
    ? `AND capability_id = $${values.push(incident.capabilityId)}`
    : '';

  const result = await query<PacketRow>(
    `
      SELECT *
      FROM capability_evidence_packets
      WHERE created_at BETWEEN $1 AND $2
        ${capabilityFilter}
      ORDER BY created_at DESC
      LIMIT ${Math.max(limit * 8, 100)}
    `,
    values,
  );

  return result.rows
    .map(row => {
      const payload = parseJson<Record<string, any>>(row.payload, {});
      const packet = packetSummaryFromRow(row);
      const matchedPaths = collectMatchedPaths(packet.touchedPaths || [], incident.affectedPaths);
      const score = scoreCorrelationCandidate({
        incident,
        packetCreatedAt: packet.createdAt,
        affectedPathCount: incident.affectedPaths.length,
        matchedPaths,
        payload,
      });
      return {
        incidentId: incident.id,
        packet,
        correlation:
          score >= 0.75 ? 'SUSPECTED' : score >= 0.4 ? 'BLAST_RADIUS' : 'DISMISSED',
        score,
        overlapCount: matchedPaths.length,
        matchedPaths,
        reasons: reasonsFor({
          payload,
          packetCreatedAt: packet.createdAt,
          matchedPaths,
          incident,
        }),
      } satisfies IncidentCorrelationCandidate;
    })
    .filter(candidate => candidate.overlapCount > 0 || candidate.score >= 0.45)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
};

export const correlateIncident = async ({
  incidentId,
  actorUserId,
  actorDisplayName,
  limit = 10,
}: {
  incidentId: string;
  actorUserId?: string;
  actorDisplayName?: string;
  limit?: number;
}) => {
  const incident = await getIncidentDetail(incidentId);
  if (!incident) {
    throw new Error(`Incident ${incidentId} was not found.`);
  }

  const candidates = await findCandidatePackets({ incident, limit });

  const persisted: IncidentCorrelationCandidate[] = [];
  for (const candidate of candidates.filter(item => item.correlation !== 'DISMISSED')) {
    const link = await linkPacketToIncident({
      incidentId,
      packetBundleId: candidate.packet.bundleId,
      correlation: candidate.correlation,
      correlationScore: candidate.score,
      correlationReasons: candidate.reasons,
      linkedAt: new Date().toISOString(),
      linkedBy: actorUserId,
      linkedByActorDisplayName: actorDisplayName,
    });
    persisted.push({
      ...candidate,
      correlation: link.correlation,
      score: link.correlationScore ?? candidate.score,
      reasons: link.correlationReasons,
    });
  }

  return {
    incident,
    candidates,
    persisted,
  };
};
