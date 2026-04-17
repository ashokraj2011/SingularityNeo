import { normalizeServiceNowIncident } from '../ingestion';

export const SERVICENOW_SIGNATURE_HEADER = 'x-servicenow-signature';

export const buildServiceNowIncidentFromWebhook = normalizeServiceNowIncident;
