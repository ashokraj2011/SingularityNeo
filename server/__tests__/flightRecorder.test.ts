// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  deriveFlightRecorderVerdictFromFacts,
  renderWorkItemFlightRecorderMarkdown,
} from '../flightRecorder';
import type { WorkItemFlightRecorderDetail } from '../../src/types';

const baseFacts = {
  hasCompletedRun: true,
  hasOpenWaits: false,
  hasDeniedPolicy: false,
  hasUnresolvedApprovalPolicy: false,
  hasEvidenceArtifacts: true,
  hasHandoffArtifacts: true,
};

describe('flight recorder', () => {
  it('allows release only when completed, resolved, and evidenced', () => {
    expect(deriveFlightRecorderVerdictFromFacts(baseFacts).verdict).toBe('ALLOWED');
    expect(
      deriveFlightRecorderVerdictFromFacts({
        ...baseFacts,
        hasOpenWaits: true,
      }).verdict,
    ).toBe('NEEDS_APPROVAL');
    expect(
      deriveFlightRecorderVerdictFromFacts({
        ...baseFacts,
        hasDeniedPolicy: true,
      }).verdict,
    ).toBe('DENIED');
    expect(
      deriveFlightRecorderVerdictFromFacts({
        ...baseFacts,
        hasHandoffArtifacts: false,
      }).verdict,
    ).toBe('INCOMPLETE');
  });

  it('renders a readable work-item markdown audit report', () => {
    const detail: WorkItemFlightRecorderDetail = {
      capabilityId: 'CAP-1',
      generatedAt: '2026-04-10T00:00:00.000Z',
      workItem: {
        id: 'WI-1',
        title: 'Release calculator',
        description: 'Ship calculator change.',
        phase: 'DONE',
        capabilityId: 'CAP-1',
        workflowId: 'WF-1',
        status: 'COMPLETED',
        priority: 'Med',
        tags: [],
        history: [],
      },
      verdict: 'ALLOWED',
      verdictReason: 'Release evidence is complete.',
      runHistory: [],
      humanGates: [],
      policyDecisions: [],
      artifacts: [],
      handoffArtifacts: [],
      toolInvocations: [],
      events: [],
      telemetry: {
        traceIds: ['TRACE-1'],
        toolInvocationCount: 1,
        failedToolInvocationCount: 0,
        totalToolLatencyMs: 42,
        totalToolCostUsd: 0.001,
        runConsolePath: '/run-console?runId=RUN-1',
      },
    };

    const markdown = renderWorkItemFlightRecorderMarkdown(detail);

    expect(markdown).toContain('# Flight Recorder: Release calculator');
    expect(markdown).toContain('Verdict: ALLOWED');
    expect(markdown).toContain('## Policy Decisions');
    expect(markdown).toContain('TRACE-1');
  });
});
