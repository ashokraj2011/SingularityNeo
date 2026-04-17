import type {
  CapabilityIncident,
  IncidentExportTargetConfig,
  ModelRiskMonitoringSummary,
} from '../../../src/types';

type ExportResult = {
  responseStatus: number;
  responsePreview?: string;
  externalReference?: string;
};

const trim = (value?: string | null) => String(value || '').trim();

const readSecret = (secretReference?: string, fallback?: unknown) => {
  const key = trim(secretReference);
  if (key && process.env[key]) {
    return String(process.env[key]).trim();
  }
  return trim(typeof fallback === 'string' ? fallback : '');
};

const compactPreview = (value: unknown) =>
  String(typeof value === 'string' ? value : value ? JSON.stringify(value) : '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

const buildHeaders = (config: IncidentExportTargetConfig) => {
  const username = trim(config.basicUsername);
  const password = readSecret(config.secretReference, config.settings?.password);
  if (!username || !password) {
    throw new Error('ServiceNow export requires a basic-username and secret reference.');
  }
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
  };
};

const buildBaseUrl = (config: IncidentExportTargetConfig) => {
  const baseUrl = trim(config.baseUrl);
  if (!baseUrl) {
    throw new Error('ServiceNow export requires a base URL.');
  }
  return baseUrl.replace(/\/+$/g, '');
};

const performInsert = async ({
  config,
  tableName,
  payload,
}: {
  config: IncidentExportTargetConfig;
  tableName: string;
  payload: Record<string, unknown>;
}): Promise<ExportResult> => {
  const response = await fetch(
    `${buildBaseUrl(config)}/api/now/table/${encodeURIComponent(tableName)}`,
    {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(payload),
    },
  );
  const body = await response.json().catch(async () => ({
    text: await response.text().catch(() => ''),
  }));
  if (!response.ok) {
    throw new Error(
      compactPreview(body?.error?.message || body?.text || response.statusText) ||
        `ServiceNow export failed with status ${response.status}.`,
    );
  }

  const result = body?.result || {};
  return {
    responseStatus: response.status,
    responsePreview: compactPreview(result?.short_description || result?.number || body?.result),
    externalReference: trim(String(result?.sys_id || result?.number || '')) || undefined,
  };
};

export const exportIncidentAttributionToServiceNow = async ({
  config,
  incident,
  markdown,
}: {
  config: IncidentExportTargetConfig;
  incident: CapabilityIncident;
  markdown: string;
}): Promise<ExportResult> =>
  performInsert({
    config,
    tableName: trim(String(config.settings?.incidentTableName || 'u_singularityneo_incident_attribution')),
    payload: {
      short_description: `[AI Attribution] ${incident.title}`,
      description: markdown,
      u_incident_id: incident.id,
      u_external_id: incident.externalId || '',
      u_capability_id: incident.capabilityId || '',
      u_severity: incident.severity,
      u_status: incident.status,
      u_detected_at: incident.detectedAt,
      u_resolved_at: incident.resolvedAt || '',
      u_linked_packet_count: incident.linkedPackets.length,
      u_postmortem_url: incident.postmortemUrl || '',
    },
  });

export const exportMrmSummaryToServiceNow = async ({
  config,
  summary,
  markdown,
}: {
  config: IncidentExportTargetConfig;
  summary: ModelRiskMonitoringSummary;
  markdown: string;
}): Promise<ExportResult> =>
  performInsert({
    config,
    tableName: trim(String(config.settings?.mrmTableName || 'u_singularityneo_mrm_summary')),
    payload: {
      short_description: `MRM summary${summary.capabilityId ? ` - ${summary.capabilityId}` : ''}`,
      description: markdown,
      u_capability_id: summary.capabilityId || '',
      u_window_days: summary.windowDays,
      u_incidents: summary.totals.incidents,
      u_confirmed_contributors: summary.totals.confirmedContributors,
      u_suspected_contributors: summary.totals.suspectedContributors,
      u_blast_radius_links: summary.totals.blastRadiusLinks,
      u_total_packets: summary.totals.totalPackets,
      u_incident_contribution_rate: summary.totals.incidentContributionRate,
      u_mean_time_to_attribution_hours: summary.totals.meanTimeToAttributionHours,
      u_override_to_incident_rate: summary.totals.overrideToIncidentRate,
      u_guardrail_promotions_requested: summary.totals.guardrailPromotionsRequested,
      u_incident_learning_count: summary.totals.incidentDerivedLearningCount,
    },
  });
