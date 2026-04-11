import { describe, expect, it } from 'vitest';
import {
  findNearestRecorderEvent,
  formatElapsedTime,
  getRecorderEventCategory,
  normalizeFlightRecorderTimeline,
} from '../flightRecorderTimeline';
import type { FlightRecorderEvent, WorkItemFlightRecorderDetail } from '../../types';

const event = (
  overrides: Partial<FlightRecorderEvent>,
): FlightRecorderEvent => ({
  id: overrides.id || 'event-1',
  capabilityId: 'CAP-1',
  workItemId: 'WI-1',
  workItemTitle: 'Release calculator',
  timestamp: overrides.timestamp || '2026-04-10T00:00:00.000Z',
  type: overrides.type || 'RUN_STARTED',
  title: overrides.title || 'Run started',
  description: overrides.description || 'Workflow run started.',
  ...overrides,
});

const detail = (events: FlightRecorderEvent[]): WorkItemFlightRecorderDetail => ({
  capabilityId: 'CAP-1',
  generatedAt: '2026-04-10T00:00:00.000Z',
  workItem: {
    id: 'WI-1',
    title: 'Release calculator',
    description: '',
    phase: 'DONE',
    capabilityId: 'CAP-1',
    workflowId: 'WF-1',
    status: 'COMPLETED',
    priority: 'Med',
    tags: [],
    history: [],
  },
  verdict: 'ALLOWED',
  verdictReason: 'Ready',
  runHistory: [],
  humanGates: [],
  policyDecisions: [],
  artifacts: [],
  handoffArtifacts: [],
  toolInvocations: [],
  events,
  telemetry: {
    traceIds: [],
    toolInvocationCount: 0,
    failedToolInvocationCount: 0,
    totalToolLatencyMs: 0,
    totalToolCostUsd: 0,
    runConsolePath: '/run-console',
  },
});

describe('flight recorder timeline', () => {
  it('converts timestamps into elapsed positions', () => {
    const model = normalizeFlightRecorderTimeline(
      detail([
        event({ id: 'start', timestamp: '2026-04-10T00:00:00.000Z' }),
        event({
          id: 'middle',
          type: 'STEP_COMPLETED',
          timestamp: '2026-04-10T00:05:00.000Z',
        }),
        event({
          id: 'end',
          type: 'RELEASE_VERDICT',
          timestamp: '2026-04-10T00:10:00.000Z',
        }),
      ]),
    );

    expect(model.events.map(current => current.trackPositionPercent)).toEqual([
      0,
      50,
      100,
    ]);
    expect(model.durationLabel).toBe('10m 0s');
  });

  it('handles missing timestamps without crashing', () => {
    const model = normalizeFlightRecorderTimeline(
      detail([
        event({ id: 'missing-start', timestamp: '' }),
        event({ id: 'missing-end', timestamp: '' }),
      ]),
    );

    expect(model.events).toHaveLength(2);
    expect(model.events.every(current => Number.isFinite(current.elapsedMs))).toBe(true);
  });

  it('groups event categories and finds the nearest scrubbed event', () => {
    expect(getRecorderEventCategory(event({ type: 'APPROVAL_CAPTURED' }))).toBe('gate');
    expect(getRecorderEventCategory(event({ type: 'HANDOFF_CREATED' }))).toBe('handoff');

    const model = normalizeFlightRecorderTimeline(
      detail([
        event({ id: 'start', timestamp: '2026-04-10T00:00:00.000Z' }),
        event({
          id: 'policy',
          type: 'POLICY_DECISION',
          phase: 'GOVERNANCE',
          timestamp: '2026-04-10T00:04:00.000Z',
        }),
        event({
          id: 'verdict',
          type: 'RELEASE_VERDICT',
          phase: 'RELEASE',
          timestamp: '2026-04-10T00:10:00.000Z',
        }),
      ]),
    );

    expect(model.categories).toContain('policy');
    expect(
      model.phaseStations.find(station => station.phase === 'GOVERNANCE')?.eventCount,
    ).toBe(1);
    expect(findNearestRecorderEvent(model.events, 42)?.id).toBe('policy');
  });
});
