import type {
  FlightRecorderEvent,
  FlightRecorderEventType,
  WorkItemFlightRecorderDetail,
  WorkItemPhase,
} from '../types';

export type RecorderEventCategory =
  | 'run'
  | 'step'
  | 'gate'
  | 'policy'
  | 'tool'
  | 'artifact'
  | 'handoff'
  | 'verdict';

export interface RecorderTimelineEvent {
  id: string;
  event: FlightRecorderEvent;
  category: RecorderEventCategory;
  elapsedMs: number;
  elapsedLabel: string;
  trackPositionPercent: number;
  phase?: WorkItemPhase;
  laneOffset: number;
}

export interface RecorderPhaseStation {
  phase: WorkItemPhase;
  label: string;
  trackPositionPercent: number;
  eventCount: number;
}

export interface RecorderTimelineModel {
  startedAt?: string;
  endedAt?: string;
  durationMs: number;
  durationLabel: string;
  events: RecorderTimelineEvent[];
  phaseStations: RecorderPhaseStation[];
  categories: RecorderEventCategory[];
}

const RECORDER_PHASE_ORDER: WorkItemPhase[] = [
  'BACKLOG',
  'ANALYSIS',
  'DESIGN',
  'DEVELOPMENT',
  'QA',
  'GOVERNANCE',
  'RELEASE',
  'DONE',
];

const CATEGORY_BY_EVENT_TYPE: Record<FlightRecorderEventType, RecorderEventCategory> = {
  RUN_STARTED: 'run',
  RUN_COMPLETED: 'run',
  RUN_FAILED: 'run',
  STEP_COMPLETED: 'step',
  WAIT_OPENED: 'gate',
  WAIT_RESOLVED: 'gate',
  APPROVAL_CAPTURED: 'gate',
  CONFLICT_RESOLVED: 'gate',
  CONTRARIAN_REVIEW: 'gate',
  POLICY_DECISION: 'policy',
  TOOL_COMPLETED: 'tool',
  TOOL_FAILED: 'tool',
  ARTIFACT_CREATED: 'artifact',
  HANDOFF_CREATED: 'handoff',
  RELEASE_VERDICT: 'verdict',
};

export const getRecorderEventCategory = (
  event: Pick<FlightRecorderEvent, 'type'>,
): RecorderEventCategory => CATEGORY_BY_EVENT_TYPE[event.type] || 'step';

export const formatElapsedTime = (elapsedMs: number) => {
  const safeMs = Math.max(0, Math.round(elapsedMs));
  const totalMinutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60) % 24;
  const days = Math.floor(totalMinutes / 1440);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const parseTimestamp = (value: string | undefined, fallbackMs: number) => {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallbackMs;
};

const formatPhase = (phase: WorkItemPhase) =>
  phase
    .toLowerCase()
    .split('_')
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');

export const normalizeFlightRecorderTimeline = (
  detail?: WorkItemFlightRecorderDetail | null,
): RecorderTimelineModel => {
  const sourceEvents = [...(detail?.events || [])].sort((left, right) =>
    String(left.timestamp || '').localeCompare(String(right.timestamp || '')),
  );
  const fallbackStartMs = Date.now();
  const timedEvents = sourceEvents.map((event, index) => ({
    event,
    timeMs: parseTimestamp(event.timestamp, fallbackStartMs + index * 60000),
  }));
  const startedMs =
    timedEvents.length > 0
      ? Math.min(...timedEvents.map(event => event.timeMs))
      : fallbackStartMs;
  const endedMs =
    timedEvents.length > 0
      ? Math.max(...timedEvents.map(event => event.timeMs))
      : startedMs;
  const rawDurationMs = Math.max(0, endedMs - startedMs);
  const durationMs = rawDurationMs || Math.max(0, timedEvents.length - 1) * 60000;
  const denominator = durationMs || 1;
  const events = timedEvents.map(({ event, timeMs }, index) => {
    const elapsedMs = rawDurationMs
      ? Math.max(0, timeMs - startedMs)
      : index * 60000;
    const trackPositionPercent =
      timedEvents.length <= 1
        ? 50
        : Math.min(100, Math.max(0, (elapsedMs / denominator) * 100));

    return {
      id: event.id,
      event,
      category: getRecorderEventCategory(event),
      elapsedMs,
      elapsedLabel: formatElapsedTime(elapsedMs),
      trackPositionPercent,
      phase: event.phase,
      laneOffset: index % 4,
    };
  });
  const eventPhaseSet = new Set(
    events.map(event => event.phase).filter(Boolean) as WorkItemPhase[],
  );
  const phases = [
    ...RECORDER_PHASE_ORDER,
    ...Array.from(eventPhaseSet).filter(phase => !RECORDER_PHASE_ORDER.includes(phase)),
  ];
  const phaseStations = phases.map((phase, index) => ({
    phase,
    label: formatPhase(phase),
    trackPositionPercent:
      phases.length <= 1 ? 50 : Math.round((index / (phases.length - 1)) * 100),
    eventCount: events.filter(event => event.phase === phase).length,
  }));

  return {
    startedAt: detail?.events[0]?.timestamp,
    endedAt: detail?.events[detail.events.length - 1]?.timestamp,
    durationMs,
    durationLabel: formatElapsedTime(durationMs),
    events,
    phaseStations,
    categories: Array.from(new Set(events.map(event => event.category))),
  };
};

export const findNearestRecorderEvent = (
  events: RecorderTimelineEvent[],
  trackPositionPercent: number,
) => {
  if (events.length === 0) {
    return null;
  }

  return events.reduce((nearest, current) => {
    const nearestDistance = Math.abs(nearest.trackPositionPercent - trackPositionPercent);
    const currentDistance = Math.abs(current.trackPositionPercent - trackPositionPercent);
    return currentDistance < nearestDistance ? current : nearest;
  }, events[0]);
};
