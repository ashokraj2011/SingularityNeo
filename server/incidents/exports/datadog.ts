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
  String(
    typeof value === 'string' ? value : value ? JSON.stringify(value) : '',
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

const buildHeaders = (config: IncidentExportTargetConfig) => {
  const apiKey = readSecret(config.secretReference, config.settings?.apiKey);
  if (!apiKey) {
    throw new Error('Datadog export is missing an API key secret reference.');
  }
  const appKey = readSecret(
    String(config.settings?.appKeyReference || '').trim() || undefined,
    config.settings?.applicationKey,
  );

  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'DD-API-KEY': apiKey,
    ...(appKey ? { 'DD-APPLICATION-KEY': appKey } : {}),
  };
};

const buildTags = ({
  baseTags,
  capabilityId,
  incident,
}: {
  baseTags: string[];
  capabilityId?: string;
  incident?: CapabilityIncident;
}) =>
  [
    ...baseTags,
    capabilityId ? `capability:${capabilityId}` : '',
    incident?.id ? `incident:${incident.id}` : '',
    incident?.severity ? `severity:${incident.severity.toLowerCase()}` : '',
  ].filter(Boolean);

export const exportIncidentAttributionToDatadog = async ({
  config,
  incident,
  markdown,
}: {
  config: IncidentExportTargetConfig;
  incident: CapabilityIncident;
  markdown: string;
}): Promise<ExportResult> => {
  const baseUrl = trim(config.baseUrl) || 'https://api.datadoghq.com';
  const tags = buildTags({
    baseTags: Array.isArray(config.settings?.tags)
      ? (config.settings?.tags as unknown[]).map(value => trim(String(value))).filter(Boolean)
      : [],
    capabilityId: incident.capabilityId,
    incident,
  });

  const response = await fetch(`${baseUrl.replace(/\/+$/g, '')}/api/v1/events`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      title: `[${incident.severity}] Incident attribution - ${incident.title}`,
      text: markdown,
      alert_type: incident.severity === 'SEV1' ? 'error' : 'warning',
      source_type_name: trim(String(config.settings?.sourceTypeName || 'singularityneo')),
      tags,
    }),
  });

  const payload = await response.json().catch(async () => ({
    text: await response.text().catch(() => ''),
  }));
  if (!response.ok) {
    throw new Error(
      compactPreview(payload?.errors || payload?.error || payload?.text || response.statusText) ||
        `Datadog export failed with status ${response.status}.`,
    );
  }

  return {
    responseStatus: response.status,
    responsePreview: compactPreview(payload?.event?.title || payload?.status || payload?.text),
    externalReference:
      payload?.event?.id !== undefined && payload?.event?.id !== null
        ? String(payload.event.id)
        : undefined,
  };
};

export const exportMrmSummaryToDatadog = async ({
  config,
  summary,
  markdown,
}: {
  config: IncidentExportTargetConfig;
  summary: ModelRiskMonitoringSummary;
  markdown: string;
}): Promise<ExportResult> => {
  const baseUrl = trim(config.baseUrl) || 'https://api.datadoghq.com';
  const headers = buildHeaders(config);
  const timestamp = Math.floor(Date.now() / 1000);
  const namespace = trim(String(config.settings?.metricNamespace || 'singularityneo.mrm'));
  const tags = buildTags({
    baseTags: Array.isArray(config.settings?.tags)
      ? (config.settings?.tags as unknown[]).map(value => trim(String(value))).filter(Boolean)
      : [],
    capabilityId: summary.capabilityId,
  });

  const seriesResponse = await fetch(`${baseUrl.replace(/\/+$/g, '')}/api/v1/series`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      series: [
        {
          metric: `${namespace}.incidents`,
          points: [[timestamp, summary.totals.incidents]],
          type: 'gauge',
          tags,
        },
        {
          metric: `${namespace}.confirmed_contributors`,
          points: [[timestamp, summary.totals.confirmedContributors]],
          type: 'gauge',
          tags,
        },
        {
          metric: `${namespace}.incident_contribution_rate`,
          points: [[timestamp, summary.totals.incidentContributionRate]],
          type: 'gauge',
          tags,
        },
        {
          metric: `${namespace}.override_to_incident_rate`,
          points: [[timestamp, summary.totals.overrideToIncidentRate]],
          type: 'gauge',
          tags,
        },
        {
          metric: `${namespace}.incident_learning_updates`,
          points: [[timestamp, summary.totals.incidentDerivedLearningCount]],
          type: 'gauge',
          tags,
        },
      ],
    }),
  });

  const seriesPayload = await seriesResponse.json().catch(async () => ({
    text: await seriesResponse.text().catch(() => ''),
  }));
  if (!seriesResponse.ok) {
    throw new Error(
      compactPreview(
        seriesPayload?.errors || seriesPayload?.error || seriesPayload?.text || seriesResponse.statusText,
      ) || `Datadog metrics export failed with status ${seriesResponse.status}.`,
    );
  }

  const eventResponse = await fetch(`${baseUrl.replace(/\/+$/g, '')}/api/v1/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `MRM summary${summary.capabilityId ? ` - ${summary.capabilityId}` : ''}`,
      text: markdown,
      alert_type: summary.totals.confirmedContributors > 0 ? 'warning' : 'info',
      source_type_name: trim(String(config.settings?.sourceTypeName || 'singularityneo')),
      tags,
    }),
  });

  const eventPayload = await eventResponse.json().catch(async () => ({
    text: await eventResponse.text().catch(() => ''),
  }));
  if (!eventResponse.ok) {
    throw new Error(
      compactPreview(eventPayload?.errors || eventPayload?.error || eventPayload?.text || eventResponse.statusText) ||
        `Datadog event export failed with status ${eventResponse.status}.`,
    );
  }

  return {
    responseStatus: eventResponse.status,
    responsePreview: compactPreview(
      eventPayload?.event?.title || seriesPayload?.status || eventPayload?.text,
    ),
    externalReference:
      eventPayload?.event?.id !== undefined && eventPayload?.event?.id !== null
        ? String(eventPayload.event.id)
        : undefined,
  };
};
