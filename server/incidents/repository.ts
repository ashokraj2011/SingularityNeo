import { query } from '../db';
import type {
  CapabilityIncident,
  IncidentCorrelation,
  IncidentExportDelivery,
  IncidentExportDeliveryStatus,
  IncidentExportTarget,
  IncidentExportTargetConfig,
  IncidentJob,
  IncidentJobStatus,
  IncidentPacketLink,
  IncidentServiceCapabilityMap,
  IncidentSource,
  IncidentSourceConfig,
} from '../../src/types';

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : [];

const toIso = (value: unknown) => {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
};

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

const incidentLinkFromRow = (row: Record<string, any>): IncidentPacketLink => ({
  incidentId: row.incident_id,
  packetBundleId: row.packet_bundle_id,
  correlation: row.correlation as IncidentCorrelation,
  correlationScore:
    row.correlation_score === null || row.correlation_score === undefined
      ? undefined
      : Number(row.correlation_score),
  correlationReasons: parseJson<string[]>(row.correlation_reasons, []),
  linkedAt: toIso(row.linked_at) || new Date().toISOString(),
  linkedBy: row.linked_by_actor_user_id || undefined,
  linkedByActorDisplayName: row.linked_by_actor_display_name || undefined,
  packetTitle: row.packet_title || undefined,
  workItemId: row.work_item_id || undefined,
  runId: row.run_id || undefined,
  touchedPaths: asStringArray(row.touched_paths),
});

const incidentFromRow = (row: Record<string, any>): CapabilityIncident => ({
  id: row.id,
  externalId: row.external_id || undefined,
  source: row.source as IncidentSource,
  capabilityId: row.capability_id || undefined,
  title: row.title,
  severity: row.severity,
  status: row.status,
  detectedAt: toIso(row.detected_at) || new Date().toISOString(),
  resolvedAt: toIso(row.resolved_at),
  affectedServices: asStringArray(row.affected_services),
  affectedPaths: asStringArray(row.affected_paths),
  summary: row.summary || undefined,
  postmortemUrl: row.postmortem_url || undefined,
  rawPayload: parseJson<Record<string, unknown>>(row.raw_payload, {}),
  createdByActorUserId: row.created_by_actor_user_id || undefined,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  linkedPackets: [],
});

const incidentSourceConfigFromRow = (row: Record<string, any>): IncidentSourceConfig => ({
  source: row.source,
  enabled: Boolean(row.enabled),
  authType: row.auth_type,
  secretReference: row.secret_reference || undefined,
  basicUsername: row.basic_username || undefined,
  signatureHeader: row.signature_header || undefined,
  rateLimitPerMinute: Number(row.rate_limit_per_minute || 60),
  settings: parseJson<Record<string, unknown>>(row.settings, {}),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const incidentServiceMapFromRow = (
  row: Record<string, any>,
): IncidentServiceCapabilityMap => ({
  serviceName: row.service_name,
  capabilityId: row.capability_id,
  defaultAffectedPaths: asStringArray(row.default_affected_paths),
  ownerEmail: row.owner_email || undefined,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const incidentExportTargetConfigFromRow = (
  row: Record<string, any>,
): IncidentExportTargetConfig => ({
  target: row.target,
  enabled: Boolean(row.enabled),
  authType: row.auth_type,
  baseUrl: row.base_url || undefined,
  secretReference: row.secret_reference || undefined,
  basicUsername: row.basic_username || undefined,
  settings: parseJson<Record<string, unknown>>(row.settings, {}),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const incidentExportDeliveryFromRow = (
  row: Record<string, any>,
): IncidentExportDelivery => ({
  id: row.id,
  target: row.target as IncidentExportTarget,
  exportKind: row.export_kind,
  incidentId: row.incident_id || undefined,
  capabilityId: row.capability_id || undefined,
  windowDays:
    row.window_days === null || row.window_days === undefined
      ? undefined
      : Number(row.window_days),
  status: row.status as IncidentExportDeliveryStatus,
  requestPayload: parseJson<Record<string, unknown>>(row.request_payload, {}),
  responseStatus:
    row.response_status === null || row.response_status === undefined
      ? undefined
      : Number(row.response_status),
  responsePreview: row.response_preview || undefined,
  externalReference: row.external_reference || undefined,
  triggeredByActorUserId: row.triggered_by_actor_user_id || undefined,
  triggeredByActorDisplayName: row.triggered_by_actor_display_name || undefined,
  createdAt: toIso(row.created_at) || new Date().toISOString(),
  exportedAt: toIso(row.exported_at),
  updatedAt: toIso(row.updated_at) || new Date().toISOString(),
});

const incidentJobFromRow = (row: Record<string, any>): IncidentJob => ({
  id: row.id,
  source: row.source,
  incidentId: row.incident_id || undefined,
  type: row.type,
  status: row.status as IncidentJobStatus,
  payload: parseJson<Record<string, unknown>>(row.payload, {}),
  attempts: Number(row.attempts || 0),
  lastError: row.last_error || undefined,
  availableAt: toIso(row.available_at) || new Date().toISOString(),
  leaseOwner: row.lease_owner || undefined,
  leaseExpiresAt: toIso(row.lease_expires_at),
  createdAt: toIso(row.created_at) || new Date().toISOString(),
  updatedAt: toIso(row.updated_at) || new Date().toISOString(),
});

export const createIncident = async (incident: CapabilityIncident): Promise<CapabilityIncident> => {
  const result = await query<Record<string, any>>(
    `
      INSERT INTO capability_incidents (
        id,
        external_id,
        source,
        capability_id,
        title,
        severity,
        status,
        detected_at,
        resolved_at,
        affected_services,
        affected_paths,
        summary,
        postmortem_url,
        raw_payload,
        created_by_actor_user_id,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
      ON CONFLICT (source, external_id) DO UPDATE SET
        capability_id = EXCLUDED.capability_id,
        title = EXCLUDED.title,
        severity = EXCLUDED.severity,
        status = EXCLUDED.status,
        detected_at = EXCLUDED.detected_at,
        resolved_at = EXCLUDED.resolved_at,
        affected_services = EXCLUDED.affected_services,
        affected_paths = EXCLUDED.affected_paths,
        summary = EXCLUDED.summary,
        postmortem_url = EXCLUDED.postmortem_url,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
      RETURNING *
    `,
    [
      incident.id,
      incident.externalId || null,
      incident.source,
      incident.capabilityId || null,
      incident.title,
      incident.severity,
      incident.status,
      incident.detectedAt,
      incident.resolvedAt || null,
      incident.affectedServices,
      incident.affectedPaths,
      incident.summary || null,
      incident.postmortemUrl || null,
      JSON.stringify(incident.rawPayload || {}),
      incident.createdByActorUserId || null,
    ],
  );

  return incidentFromRow(result.rows[0]);
};

export const listIncidents = async ({
  capabilityId,
  severity,
  status,
  limit = 100,
}: {
  capabilityId?: string;
  severity?: string;
  status?: string;
  limit?: number;
} = {}): Promise<CapabilityIncident[]> => {
  const conditions = ['TRUE'];
  const values: any[] = [];

  if (capabilityId) {
    values.push(capabilityId);
    conditions.push(`capability_id = $${values.length}`);
  }
  if (severity) {
    values.push(severity);
    conditions.push(`severity = $${values.length}`);
  }
  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }
  values.push(limit);

  const result = await query<Record<string, any>>(
    `
      SELECT *
      FROM capability_incidents
      WHERE ${conditions.join(' AND ')}
      ORDER BY detected_at DESC, created_at DESC
      LIMIT $${values.length}
    `,
    values,
  );

  const incidents = result.rows.map(incidentFromRow);
  if (!incidents.length) {
    return incidents;
  }

  const links = await listIncidentLinks({
    incidentIds: incidents.map(incident => incident.id),
  });
  const linksByIncidentId = new Map<string, IncidentPacketLink[]>();
  links.forEach(link => {
    const items = linksByIncidentId.get(link.incidentId) || [];
    items.push(link);
    linksByIncidentId.set(link.incidentId, items);
  });

  return incidents.map(incident => ({
    ...incident,
    linkedPackets: linksByIncidentId.get(incident.id) || [],
  }));
};

export const listIncidentLinks = async ({
  incidentIds,
  packetBundleId,
}: {
  incidentIds?: string[];
  packetBundleId?: string;
} = {}): Promise<IncidentPacketLink[]> => {
  const conditions = ['TRUE'];
  const values: any[] = [];

  if (incidentIds?.length) {
    values.push(incidentIds);
    conditions.push(`links.incident_id = ANY($${values.length}::text[])`);
  }
  if (packetBundleId) {
    values.push(packetBundleId);
    conditions.push(`links.packet_bundle_id = $${values.length}`);
  }

  const result = await query<Record<string, any>>(
    `
      SELECT
        links.*,
        packets.title AS packet_title,
        packets.work_item_id,
        packets.run_id,
        packets.touched_paths
      FROM capability_incident_packet_links AS links
      JOIN capability_evidence_packets AS packets
        ON packets.bundle_id = links.packet_bundle_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY links.linked_at DESC
    `,
    values,
  );

  return result.rows.map(incidentLinkFromRow);
};

export const getIncidentDetail = async (incidentId: string): Promise<CapabilityIncident | null> => {
  const result = await query<Record<string, any>>(
    `
      SELECT *
      FROM capability_incidents
      WHERE id = $1
      LIMIT 1
    `,
    [incidentId],
  );

  if (!result.rowCount) {
    return null;
  }

  const incident = incidentFromRow(result.rows[0]);
  return {
    ...incident,
    linkedPackets: await listIncidentLinks({ incidentIds: [incidentId] }),
  };
};

export const linkPacketToIncident = async (
  link: IncidentPacketLink & {
    linkedByActorDisplayName?: string;
  },
): Promise<IncidentPacketLink> => {
  const result = await query<Record<string, any>>(
    `
      INSERT INTO capability_incident_packet_links (
        incident_id,
        packet_bundle_id,
        correlation,
        correlation_score,
        correlation_reasons,
        linked_by_actor_user_id,
        linked_by_actor_display_name
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (incident_id, packet_bundle_id) DO UPDATE SET
        correlation = EXCLUDED.correlation,
        correlation_score = EXCLUDED.correlation_score,
        correlation_reasons = EXCLUDED.correlation_reasons,
        linked_by_actor_user_id = EXCLUDED.linked_by_actor_user_id,
        linked_by_actor_display_name = EXCLUDED.linked_by_actor_display_name,
        linked_at = NOW()
      RETURNING *
    `,
    [
      link.incidentId,
      link.packetBundleId,
      link.correlation,
      link.correlationScore ?? null,
      JSON.stringify(link.correlationReasons || []),
      link.linkedBy || null,
      link.linkedByActorDisplayName || null,
    ],
  );

  const [joined] = await listIncidentLinks({
    incidentIds: [result.rows[0].incident_id],
    packetBundleId: result.rows[0].packet_bundle_id,
  });
  return joined || incidentLinkFromRow(result.rows[0]);
};

export const deleteIncidentPacketLink = async ({
  incidentId,
  packetBundleId,
}: {
  incidentId: string;
  packetBundleId: string;
}) => {
  await query(
    `
      DELETE FROM capability_incident_packet_links
      WHERE incident_id = $1
        AND packet_bundle_id = $2
    `,
    [incidentId, packetBundleId],
  );
};

export const getIncidentLinksForPacket = async (
  packetBundleId: string,
): Promise<IncidentPacketLink[]> => listIncidentLinks({ packetBundleId });

export const listIncidentSourceConfigs = async (): Promise<IncidentSourceConfig[]> => {
  const result = await query<Record<string, any>>(
    `
      SELECT *
      FROM incident_source_configs
      ORDER BY source ASC
    `,
  );
  return result.rows.map(incidentSourceConfigFromRow);
};

export const getIncidentSourceConfig = async (
  source: IncidentSource,
): Promise<IncidentSourceConfig | null> => {
  const result = await query<Record<string, any>>(
    `
      SELECT *
      FROM incident_source_configs
      WHERE source = $1
      LIMIT 1
    `,
    [source],
  );
  return result.rowCount ? incidentSourceConfigFromRow(result.rows[0]) : null;
};

export const upsertIncidentSourceConfig = async (
  config: IncidentSourceConfig,
): Promise<IncidentSourceConfig> => {
  const result = await query<Record<string, any>>(
    `
      INSERT INTO incident_source_configs (
        source,
        enabled,
        auth_type,
        secret_reference,
        basic_username,
        signature_header,
        rate_limit_per_minute,
        settings,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (source) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        auth_type = EXCLUDED.auth_type,
        secret_reference = EXCLUDED.secret_reference,
        basic_username = EXCLUDED.basic_username,
        signature_header = EXCLUDED.signature_header,
        rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
        settings = EXCLUDED.settings,
        updated_at = NOW()
      RETURNING *
    `,
    [
      config.source,
      config.enabled,
      config.authType,
      config.secretReference || null,
      config.basicUsername || null,
      config.signatureHeader || null,
      config.rateLimitPerMinute || 60,
      JSON.stringify(config.settings || {}),
    ],
  );
  return incidentSourceConfigFromRow(result.rows[0]);
};

export const deleteIncidentSourceConfig = async (source: IncidentSource) => {
  await query('DELETE FROM incident_source_configs WHERE source = $1', [source]);
};

export const listIncidentServiceCapabilityMaps = async (): Promise<IncidentServiceCapabilityMap[]> => {
  const result = await query<Record<string, any>>(
    `
      SELECT *
      FROM incident_service_capability_map
      ORDER BY service_name ASC
    `,
  );
  return result.rows.map(incidentServiceMapFromRow);
};

export const getIncidentServiceCapabilityMap = async (
  serviceName: string,
): Promise<IncidentServiceCapabilityMap | null> => {
  const result = await query<Record<string, any>>(
    `
      SELECT *
      FROM incident_service_capability_map
      WHERE lower(service_name) = lower($1)
      LIMIT 1
    `,
    [serviceName],
  );
  return result.rowCount ? incidentServiceMapFromRow(result.rows[0]) : null;
};

export const upsertIncidentServiceCapabilityMap = async (
  mapping: IncidentServiceCapabilityMap,
): Promise<IncidentServiceCapabilityMap> => {
  const result = await query<Record<string, any>>(
    `
      INSERT INTO incident_service_capability_map (
        service_name,
        capability_id,
        default_affected_paths,
        owner_email,
        updated_at
      )
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (service_name) DO UPDATE SET
        capability_id = EXCLUDED.capability_id,
        default_affected_paths = EXCLUDED.default_affected_paths,
        owner_email = EXCLUDED.owner_email,
        updated_at = NOW()
      RETURNING *
    `,
    [
      mapping.serviceName,
      mapping.capabilityId,
      mapping.defaultAffectedPaths,
      mapping.ownerEmail || null,
    ],
  );
  return incidentServiceMapFromRow(result.rows[0]);
};

export const deleteIncidentServiceCapabilityMap = async (serviceName: string) => {
  await query('DELETE FROM incident_service_capability_map WHERE service_name = $1', [serviceName]);
};

export const listIncidentExportTargetConfigs = async (): Promise<IncidentExportTargetConfig[]> => {
  const result = await query<Record<string, any>>(
    `
      SELECT *
      FROM incident_export_target_configs
      ORDER BY target ASC
    `,
  );
  return result.rows.map(incidentExportTargetConfigFromRow);
};

export const getIncidentExportTargetConfig = async (
  target: IncidentExportTarget,
): Promise<IncidentExportTargetConfig | null> => {
  const result = await query<Record<string, any>>(
    `
      SELECT *
      FROM incident_export_target_configs
      WHERE target = $1
      LIMIT 1
    `,
    [target],
  );
  return result.rowCount ? incidentExportTargetConfigFromRow(result.rows[0]) : null;
};

export const upsertIncidentExportTargetConfig = async (
  config: IncidentExportTargetConfig,
): Promise<IncidentExportTargetConfig> => {
  const result = await query<Record<string, any>>(
    `
      INSERT INTO incident_export_target_configs (
        target,
        enabled,
        auth_type,
        base_url,
        secret_reference,
        basic_username,
        settings,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (target) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        auth_type = EXCLUDED.auth_type,
        base_url = EXCLUDED.base_url,
        secret_reference = EXCLUDED.secret_reference,
        basic_username = EXCLUDED.basic_username,
        settings = EXCLUDED.settings,
        updated_at = NOW()
      RETURNING *
    `,
    [
      config.target,
      config.enabled,
      config.authType,
      config.baseUrl || null,
      config.secretReference || null,
      config.basicUsername || null,
      JSON.stringify(config.settings || {}),
    ],
  );
  return incidentExportTargetConfigFromRow(result.rows[0]);
};

export const createIncidentExportDelivery = async (
  delivery: IncidentExportDelivery,
): Promise<IncidentExportDelivery> => {
  const result = await query<Record<string, any>>(
    `
      INSERT INTO incident_export_deliveries (
        id,
        target,
        export_kind,
        incident_id,
        capability_id,
        window_days,
        status,
        request_payload,
        response_status,
        response_preview,
        external_reference,
        triggered_by_actor_user_id,
        triggered_by_actor_display_name,
        exported_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      RETURNING *
    `,
    [
      delivery.id,
      delivery.target,
      delivery.exportKind,
      delivery.incidentId || null,
      delivery.capabilityId || null,
      delivery.windowDays ?? null,
      delivery.status,
      JSON.stringify(delivery.requestPayload || {}),
      delivery.responseStatus ?? null,
      delivery.responsePreview || null,
      delivery.externalReference || null,
      delivery.triggeredByActorUserId || null,
      delivery.triggeredByActorDisplayName || null,
      delivery.exportedAt || null,
    ],
  );
  return incidentExportDeliveryFromRow(result.rows[0]);
};

export const updateIncidentExportDelivery = async ({
  deliveryId,
  status,
  responseStatus,
  responsePreview,
  externalReference,
  exportedAt,
}: {
  deliveryId: string;
  status: IncidentExportDeliveryStatus;
  responseStatus?: number;
  responsePreview?: string;
  externalReference?: string;
  exportedAt?: string;
}): Promise<IncidentExportDelivery | null> => {
  const result = await query<Record<string, any>>(
    `
      UPDATE incident_export_deliveries
      SET
        status = $2,
        response_status = $3,
        response_preview = $4,
        external_reference = $5,
        exported_at = $6,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      deliveryId,
      status,
      responseStatus ?? null,
      responsePreview || null,
      externalReference || null,
      exportedAt || null,
    ],
  );

  return result.rowCount ? incidentExportDeliveryFromRow(result.rows[0]) : null;
};

export const listIncidentExportDeliveries = async ({
  incidentId,
  capabilityId,
  target,
  limit = 50,
}: {
  incidentId?: string;
  capabilityId?: string;
  target?: IncidentExportTarget;
  limit?: number;
} = {}): Promise<IncidentExportDelivery[]> => {
  const conditions = ['TRUE'];
  const values: any[] = [];
  if (incidentId) {
    values.push(incidentId);
    conditions.push(`incident_id = $${values.length}`);
  }
  if (capabilityId) {
    values.push(capabilityId);
    conditions.push(`capability_id = $${values.length}`);
  }
  if (target) {
    values.push(target);
    conditions.push(`target = $${values.length}`);
  }
  values.push(limit);

  const result = await query<Record<string, any>>(
    `
      SELECT *
      FROM incident_export_deliveries
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${values.length}
    `,
    values,
  );

  return result.rows.map(incidentExportDeliveryFromRow);
};

export const queueIncidentJob = async (job: IncidentJob): Promise<IncidentJob> => {
  const result = await query<Record<string, any>>(
    `
      INSERT INTO capability_incident_jobs (
        id,
        source,
        incident_id,
        type,
        status,
        payload,
        attempts,
        last_error,
        available_at,
        lease_owner,
        lease_expires_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      RETURNING *
    `,
    [
      job.id,
      job.source,
      job.incidentId || null,
      job.type,
      job.status,
      JSON.stringify(job.payload || {}),
      job.attempts || 0,
      job.lastError || null,
      job.availableAt,
      job.leaseOwner || null,
      job.leaseExpiresAt || null,
    ],
  );
  return incidentJobFromRow(result.rows[0]);
};

export const claimRunnableIncidentJobs = async ({
  workerId,
  limit,
  leaseMs,
}: {
  workerId: string;
  limit: number;
  leaseMs: number;
}): Promise<IncidentJob[]> => {
  const result = await query<Record<string, any>>(
    `
      WITH claimed AS (
        SELECT id
        FROM capability_incident_jobs
        WHERE status = 'QUEUED'
          AND available_at <= NOW()
          AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
        ORDER BY available_at ASC, created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE capability_incident_jobs AS jobs
      SET
        status = 'PROCESSING',
        lease_owner = $2,
        lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        attempts = jobs.attempts + 1,
        updated_at = NOW()
      FROM claimed
      WHERE jobs.id = claimed.id
      RETURNING jobs.*
    `,
    [limit, workerId, leaseMs],
  );

  return result.rows.map(incidentJobFromRow);
};

export const renewIncidentJobLease = async ({
  jobId,
  workerId,
  leaseMs,
}: {
  jobId: string;
  workerId: string;
  leaseMs: number;
}) => {
  await query(
    `
      UPDATE capability_incident_jobs
      SET
        lease_owner = $2,
        lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      WHERE id = $1
    `,
    [jobId, workerId, leaseMs],
  );
};

export const completeIncidentJob = async (jobId: string) => {
  await query(
    `
      UPDATE capability_incident_jobs
      SET
        status = 'COMPLETED',
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [jobId],
  );
};

export const failIncidentJob = async ({
  jobId,
  errorMessage,
  retryAfterMs = 60_000,
}: {
  jobId: string;
  errorMessage: string;
  retryAfterMs?: number;
}) => {
  await query(
    `
      UPDATE capability_incident_jobs
      SET
        status = 'QUEUED',
        last_error = $2,
        available_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [jobId, errorMessage, retryAfterMs],
  );
};

export const releaseIncidentJobLease = async (jobId: string) => {
  await query(
    `
      UPDATE capability_incident_jobs
      SET
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [jobId],
  );
};

export const listIncidentGuardrailPromotions = async ({
  capabilityId,
  incidentId,
}: {
  capabilityId?: string;
  incidentId?: string;
} = {}) => {
  const conditions = ['TRUE'];
  const values: any[] = [];
  if (capabilityId) {
    values.push(capabilityId);
    conditions.push(`capability_id = $${values.length}`);
  }
  if (incidentId) {
    values.push(incidentId);
    conditions.push(`incident_id = $${values.length}`);
  }

  const result = await query<Record<string, any>>(
    `
      SELECT *
      FROM capability_incident_guardrail_promotions
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
    `,
    values,
  );

  return result.rows.map(row => ({
    id: row.id,
    capabilityId: row.capability_id,
    incidentId: row.incident_id,
    packetBundleId: row.packet_bundle_id,
    concernText: row.concern_text,
    status: row.status,
    approvalPolicyId: row.approval_policy_id || undefined,
    approvalWaitId: row.approval_wait_id || undefined,
    approvalRunId: row.approval_run_id || undefined,
    requestedByActorUserId: row.requested_by_actor_user_id || undefined,
    requestedByActorDisplayName: row.requested_by_actor_display_name || undefined,
    createdAt: toIso(row.created_at) || new Date().toISOString(),
    updatedAt: toIso(row.updated_at) || new Date().toISOString(),
  }));
};

export const createIncidentGuardrailPromotion = async ({
  id,
  capabilityId,
  incidentId,
  packetBundleId,
  concernText,
  approvalPolicyId,
  approvalWaitId,
  approvalRunId,
  requestedByActorUserId,
  requestedByActorDisplayName,
}: {
  id: string;
  capabilityId: string;
  incidentId: string;
  packetBundleId: string;
  concernText: string;
  approvalPolicyId?: string;
  approvalWaitId?: string;
  approvalRunId?: string;
  requestedByActorUserId?: string;
  requestedByActorDisplayName: string;
}) => {
  const result = await query<Record<string, any>>(
    `
      INSERT INTO capability_incident_guardrail_promotions (
        id,
        capability_id,
        incident_id,
        packet_bundle_id,
        concern_text,
        approval_policy_id,
        approval_wait_id,
        approval_run_id,
        requested_by_actor_user_id,
        requested_by_actor_display_name,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      RETURNING *
    `,
    [
      id,
      capabilityId,
      incidentId,
      packetBundleId,
      concernText,
      approvalPolicyId || null,
      approvalWaitId || null,
      approvalRunId || null,
      requestedByActorUserId || null,
      requestedByActorDisplayName,
    ],
  );

  return {
    id: result.rows[0].id,
    capabilityId: result.rows[0].capability_id,
    incidentId: result.rows[0].incident_id,
    packetBundleId: result.rows[0].packet_bundle_id,
    concernText: result.rows[0].concern_text,
    status: result.rows[0].status,
    approvalPolicyId: result.rows[0].approval_policy_id || undefined,
    approvalWaitId: result.rows[0].approval_wait_id || undefined,
    approvalRunId: result.rows[0].approval_run_id || undefined,
    requestedByActorUserId: result.rows[0].requested_by_actor_user_id || undefined,
    requestedByActorDisplayName: result.rows[0].requested_by_actor_display_name || undefined,
    createdAt: toIso(result.rows[0].created_at) || new Date().toISOString(),
    updatedAt: toIso(result.rows[0].updated_at) || new Date().toISOString(),
  };
};

export const getIncidentSignalForPacket = async (packetBundleId: string) => {
  const result = await query<Record<string, any>>(
    `
      SELECT incidents.*, links.correlation
      FROM capability_incident_packet_links AS links
      JOIN capability_incidents AS incidents
        ON incidents.id = links.incident_id
      WHERE links.packet_bundle_id = $1
        AND links.correlation = 'CONFIRMED'
      ORDER BY incidents.detected_at DESC
      LIMIT 1
    `,
    [packetBundleId],
  );

  if (!result.rowCount) {
    return null;
  }

  const incident = incidentFromRow(result.rows[0]);
  return {
    ...incident,
    correlation: result.rows[0].correlation as IncidentCorrelation,
  };
};
