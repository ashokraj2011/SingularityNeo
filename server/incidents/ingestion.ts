import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CapabilityIncident,
  IncidentSeverity,
  IncidentSource,
  IncidentSourceConfig,
  IncidentStatus,
} from '../../src/types';
import { getIncidentServiceCapabilityMap } from './repository';

const normalizeStatus = (value: unknown): IncidentStatus => {
  const normalized = String(value || '').trim().toLowerCase();
  switch (normalized) {
    case 'resolved':
    case 'closed':
      return normalized;
    case 'acknowledged':
    case 'investigating':
      return 'investigating';
    default:
      return 'triggered';
  }
};

const normalizeSeverity = (value: unknown): IncidentSeverity => {
  const normalized = String(value || '').trim().toUpperCase();
  if (['SEV1', 'SEV2', 'SEV3', 'SEV4'].includes(normalized)) {
    return normalized as IncidentSeverity;
  }
  if (normalized === 'CRITICAL' || normalized === 'P1') {
    return 'SEV1';
  }
  if (normalized === 'HIGH' || normalized === 'P2') {
    return 'SEV2';
  }
  if (normalized === 'MEDIUM' || normalized === 'P3') {
    return 'SEV3';
  }
  return 'SEV4';
};

const toIsoUtc = (value: unknown, fallback = new Date()) => {
  if (!value) {
    return fallback.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
};

const coerceStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : typeof value === 'string' && value.trim()
    ? value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    : [];

const pickPayload = (payload: Record<string, any>, allowlist: string[]) =>
  allowlist.reduce<Record<string, unknown>>((next, key) => {
    if (payload[key] !== undefined) {
      next[key] = payload[key];
    }
    return next;
  }, {});

export const verifyIncidentHmacSignature = ({
  rawBody,
  headerValue,
  secret,
  prefix = 'v1=',
}: {
  rawBody: string;
  headerValue?: string;
  secret?: string;
  prefix?: string;
}) => {
  if (!secret) {
    throw new Error('Webhook secret is not configured for this incident source.');
  }
  const token = String(headerValue || '').trim();
  if (!token || !token.startsWith(prefix)) {
    throw new Error('Webhook signature is missing or malformed.');
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = token.slice(prefix.length);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new Error('Webhook signature verification failed.');
  }
};

export const verifyIncidentBasicAuth = ({
  authorization,
  username,
  password,
}: {
  authorization?: string;
  username?: string;
  password?: string;
}) => {
  if (!username || !password) {
    throw new Error('Basic-auth credentials are not configured for this incident source.');
  }
  const header = String(authorization || '').trim();
  if (!header.startsWith('Basic ')) {
    throw new Error('Webhook authorization header is missing.');
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const [providedUser, providedPassword] = decoded.split(':');
  if (providedUser !== username || providedPassword !== password) {
    throw new Error('Webhook basic-auth verification failed.');
  }
};

export const normalizeManualIncidentInput = async ({
  source,
  payload,
  actorUserId,
}: {
  source: IncidentSource;
  payload: Record<string, any>;
  actorUserId?: string;
}): Promise<CapabilityIncident> => {
  const serviceName =
    String(payload.serviceName || payload.service || payload.service_name || '').trim() || undefined;
  const mapping = serviceName ? await getIncidentServiceCapabilityMap(serviceName) : null;

  return {
    id: String(payload.id || '').trim() || `INC-${randomUUID().slice(0, 12).toUpperCase()}`,
    externalId: String(payload.externalId || payload.external_id || '').trim() || undefined,
    source,
    capabilityId: String(payload.capabilityId || mapping?.capabilityId || '').trim() || undefined,
    title: String(payload.title || payload.summary || 'Incident').trim(),
    severity: normalizeSeverity(payload.severity),
    status: normalizeStatus(payload.status),
    detectedAt: toIsoUtc(payload.detectedAt || payload.detected_at || payload.created_at),
    resolvedAt: payload.resolvedAt || payload.resolved_at ? toIsoUtc(payload.resolvedAt || payload.resolved_at) : undefined,
    affectedServices: coerceStringArray(payload.affectedServices || payload.affected_services || serviceName),
    affectedPaths: coerceStringArray(
      payload.affectedPaths || payload.affected_paths || mapping?.defaultAffectedPaths || [],
    ),
    summary: String(payload.summary || payload.description || '').trim() || undefined,
    postmortemUrl:
      String(payload.postmortemUrl || payload.postmortem_url || '').trim() || undefined,
    rawPayload: pickPayload(payload, [
      'title',
      'summary',
      'severity',
      'status',
      'serviceName',
      'service',
      'service_name',
      'externalId',
      'external_id',
      'detectedAt',
      'detected_at',
      'resolvedAt',
      'resolved_at',
    ]),
    createdByActorUserId: actorUserId,
    linkedPackets: [],
  };
};

export const normalizePagerDutyIncident = async ({
  payload,
  actorUserId,
}: {
  payload: Record<string, any>;
  actorUserId?: string;
}) =>
  normalizeManualIncidentInput({
    source: 'pagerduty',
    actorUserId,
    payload: {
      id: payload?.event?.id,
      externalId: payload?.event?.data?.id || payload?.incident?.id || payload?.data?.id,
      title:
        payload?.event?.data?.title ||
        payload?.incident?.title ||
        payload?.messages?.[0]?.message,
      severity:
        payload?.event?.data?.severity ||
        payload?.incident?.urgency ||
        payload?.incident?.priority,
      status: payload?.event?.event_type || payload?.incident?.status,
      detectedAt:
        payload?.event?.occurred_at || payload?.incident?.created_at || payload?.created_at,
      resolvedAt: payload?.incident?.resolved_at || payload?.resolved_at,
      serviceName:
        payload?.event?.data?.service?.summary ||
        payload?.incident?.service?.summary ||
        payload?.service?.name,
      summary:
        payload?.event?.data?.description ||
        payload?.incident?.description ||
        payload?.messages?.[0]?.message,
    },
  });

export const normalizeServiceNowIncident = async ({
  payload,
  actorUserId,
}: {
  payload: Record<string, any>;
  actorUserId?: string;
}) =>
  normalizeManualIncidentInput({
    source: 'servicenow',
    actorUserId,
    payload: {
      externalId: payload?.number || payload?.sys_id || payload?.incident_number,
      title: payload?.short_description || payload?.title || payload?.description,
      severity: payload?.severity || payload?.priority,
      status: payload?.state || payload?.status,
      detectedAt: payload?.opened_at || payload?.sys_created_on || payload?.created_at,
      resolvedAt: payload?.resolved_at || payload?.closed_at,
      serviceName: payload?.business_service || payload?.service || payload?.cmdb_ci,
      summary: payload?.description || payload?.work_notes,
    },
  });

export const normalizeIncidentIoIncident = async ({
  payload,
  actorUserId,
}: {
  payload: Record<string, any>;
  actorUserId?: string;
}) =>
  normalizeManualIncidentInput({
    source: 'incident-io',
    actorUserId,
    payload: {
      externalId: payload?.id || payload?.incident_id,
      title: payload?.name || payload?.title,
      severity: payload?.severity || payload?.impact,
      status: payload?.status,
      detectedAt: payload?.created_at || payload?.started_at,
      resolvedAt: payload?.closed_at || payload?.resolved_at,
      serviceName: payload?.service || payload?.service_name || payload?.team,
      summary: payload?.summary || payload?.description,
    },
  });

export const validateIncidentSourceRequest = ({
  config,
  rawBody,
  signature,
  authorization,
  resolvedSecret,
}: {
  config: IncidentSourceConfig;
  rawBody: string;
  signature?: string;
  authorization?: string;
  resolvedSecret?: string;
}) => {
  if (!config.enabled) {
    throw new Error(`Incident source ${config.source} is disabled.`);
  }
  if (config.authType === 'BASIC') {
    const password = String(config.settings?.basicPassword || resolvedSecret || '').trim();
    verifyIncidentBasicAuth({
      authorization,
      username: config.basicUsername,
      password,
    });
    return;
  }
  verifyIncidentHmacSignature({
    rawBody,
    headerValue: signature,
    secret: String(resolvedSecret || config.settings?.sharedSecret || '').trim(),
    prefix: config.source === 'pagerduty' ? 'v1=' : '',
  });
};
