export type EnterpriseTone =
  | 'neutral'
  | 'brand'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';

const STATUS_TONE_MAP: Record<string, EnterpriseTone> = {
  STABLE: 'success',
  VERIFIED: 'success',
  COMPLETED: 'success',
  ACTIVE: 'brand',
  RUNNING: 'brand',
  IN_PROGRESS: 'info',
  PROCESSING: 'info',
  BETA: 'info',
  PENDING: 'neutral',
  QUEUED: 'neutral',
  ARCHIVED: 'neutral',
  ALERT: 'danger',
  BLOCKED: 'danger',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  PENDING_APPROVAL: 'warning',
  WAITING_APPROVAL: 'warning',
  WAITING_INPUT: 'warning',
  WAITING_CONFLICT: 'danger',
  URGENT: 'danger',
};

export const getStatusTone = (value?: string): EnterpriseTone =>
  STATUS_TONE_MAP[String(value || '').toUpperCase()] || 'neutral';

export const formatEnumLabel = (value?: string) =>
  String(value || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, character => character.toUpperCase()) || 'Unknown';
