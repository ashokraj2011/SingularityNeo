import { normalizePagerDutyIncident } from '../ingestion';

export const PAGERDUTY_SIGNATURE_HEADER = 'x-pagerduty-signature';

export const buildPagerDutyIncidentFromWebhook = normalizePagerDutyIncident;
