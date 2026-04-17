import type {
  IncidentExportTarget,
} from '../../../src/types';
import { getIncidentDetail } from '../repository';
import {
  getIncidentExportTargetConfig,
  updateIncidentExportDelivery,
} from '../repository';
import { renderIncidentPostmortemMarkdown } from '../attribution';
import {
  buildModelRiskMonitoringSummary,
  renderModelRiskMonitoringMarkdown,
} from '../mrm';
import {
  exportIncidentAttributionToDatadog,
  exportMrmSummaryToDatadog,
} from './datadog';
import {
  exportIncidentAttributionToServiceNow,
  exportMrmSummaryToServiceNow,
} from './servicenow';

const completeDelivery = async ({
  deliveryId,
  responseStatus,
  responsePreview,
  externalReference,
}: {
  deliveryId: string;
  responseStatus: number;
  responsePreview?: string;
  externalReference?: string;
}) =>
  updateIncidentExportDelivery({
    deliveryId,
    status: 'DELIVERED',
    responseStatus,
    responsePreview,
    externalReference,
    exportedAt: new Date().toISOString(),
  });

const failDelivery = async ({
  deliveryId,
  errorMessage,
}: {
  deliveryId: string;
  errorMessage: string;
}) =>
  updateIncidentExportDelivery({
    deliveryId,
    status: 'FAILED',
    responsePreview: errorMessage,
  });

const getTargetConfig = async (target: IncidentExportTarget) => {
  const config = await getIncidentExportTargetConfig(target);
  if (!config?.enabled) {
    throw new Error(`${target} export is not configured or enabled.`);
  }
  return config;
};

export const deliverIncidentExport = async ({
  target,
  incidentId,
  deliveryId,
}: {
  target: IncidentExportTarget;
  incidentId: string;
  deliveryId: string;
}) => {
  try {
    const [config, incident] = await Promise.all([
      getTargetConfig(target),
      getIncidentDetail(incidentId),
    ]);
    if (!incident) {
      throw new Error(`Incident ${incidentId} was not found.`);
    }
    const markdown = await renderIncidentPostmortemMarkdown(incident);
    const result =
      target === 'datadog'
        ? await exportIncidentAttributionToDatadog({ config, incident, markdown })
        : await exportIncidentAttributionToServiceNow({ config, incident, markdown });
    await completeDelivery({ deliveryId, ...result });
  } catch (error) {
    await failDelivery({
      deliveryId,
      errorMessage: error instanceof Error ? error.message : 'Incident export failed.',
    });
    throw error;
  }
};

export const deliverMrmExport = async ({
  target,
  capabilityId,
  windowDays,
  deliveryId,
}: {
  target: IncidentExportTarget;
  capabilityId?: string;
  windowDays?: number;
  deliveryId: string;
}) => {
  try {
    const config = await getTargetConfig(target);
    const summary = await buildModelRiskMonitoringSummary({ capabilityId, windowDays });
    const markdown = await renderModelRiskMonitoringMarkdown({ capabilityId, windowDays });
    const result =
      target === 'datadog'
        ? await exportMrmSummaryToDatadog({ config, summary, markdown })
        : await exportMrmSummaryToServiceNow({ config, summary, markdown });
    await completeDelivery({ deliveryId, ...result });
  } catch (error) {
    await failDelivery({
      deliveryId,
      errorMessage: error instanceof Error ? error.message : 'MRM export failed.',
    });
    throw error;
  }
};
