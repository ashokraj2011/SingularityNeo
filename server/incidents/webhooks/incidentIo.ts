import { normalizeIncidentIoIncident } from '../ingestion';

export const INCIDENT_IO_SIGNATURE_HEADER = 'x-incidentio-signature';

export const buildIncidentIoIncidentFromWebhook = normalizeIncidentIoIncident;
