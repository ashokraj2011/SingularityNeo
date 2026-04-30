import type {
  Artifact,
  CapabilityFlightRecorderSnapshot,
  FlightRecorderArtifactSummary,
  FlightRecorderEvent,
  FlightRecorderEventType,
  FlightRecorderHumanGateSummary,
  FlightRecorderPolicySummary,
  FlightRecorderVerdict,
  PolicyDecision,
  RunEvent,
  RunWait,
  ToolInvocation,
  WorkItem,
  WorkItemFlightRecorderDetail,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunStep,
} from '../src/types';
import {
  getWorkflowRunDetail,
  listWorkflowRunEvents,
  listWorkflowRunsByCapability,
  listWorkflowRunsForWorkItem,
} from './execution/repository';
import { getCompletedWorkOrderEvidence } from './ledger';
import { listPolicyDecisions } from './policy';
import { getCapabilityBundle } from './domains/self-service/repository';

type VerdictFacts = {
  hasCompletedRun: boolean;
  hasOpenWaits: boolean;
  hasDeniedPolicy: boolean;
  hasUnresolvedApprovalPolicy: boolean;
  hasEvidenceArtifacts: boolean;
  hasHandoffArtifacts: boolean;
};

const sortIsoAsc = (left?: string, right?: string) =>
  String(left || '').localeCompare(String(right || ''));

const sortIsoDesc = (left?: string, right?: string) =>
  String(right || '').localeCompare(String(left || ''));

const formatEnumLabel = (value?: string) =>
  String(value || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, character => character.toUpperCase()) || 'Unknown';

const markdownEscape = (value?: string | number) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim();

const eventSeverityFromVerdict = (verdict: FlightRecorderVerdict): FlightRecorderEvent['severity'] => {
  if (verdict === 'ALLOWED') {
    return 'INFO';
  }
  if (verdict === 'DENIED') {
    return 'ERROR';
  }
  return 'WARN';
};

export const deriveFlightRecorderVerdictFromFacts = ({
  hasCompletedRun,
  hasOpenWaits,
  hasDeniedPolicy,
  hasUnresolvedApprovalPolicy,
  hasEvidenceArtifacts,
  hasHandoffArtifacts,
}: VerdictFacts): { verdict: FlightRecorderVerdict; reason: string } => {
  if (hasDeniedPolicy) {
    return {
      verdict: 'DENIED',
      reason: 'A run-linked policy decision denied a requested action.',
    };
  }

  if (hasOpenWaits || hasUnresolvedApprovalPolicy) {
    return {
      verdict: 'NEEDS_APPROVAL',
      reason:
        'Human approval, input, conflict resolution, or approval-backed policy evidence is still required.',
    };
  }

  if (!hasCompletedRun) {
    return {
      verdict: 'INCOMPLETE',
      reason: 'No completed workflow run is available for this work item yet.',
    };
  }

  if (!hasEvidenceArtifacts || !hasHandoffArtifacts) {
    return {
      verdict: 'INCOMPLETE',
      reason:
        'The work item completed, but evidence or handoff artifacts are not sufficient to justify release.',
    };
  }

  return {
    verdict: 'ALLOWED',
    reason:
      'A completed run exists with resolved human gates, no denied policy decisions, and release evidence plus handoffs attached.',
  };
};

const getAgentName = (agentsById: Map<string, string>, agentId?: string) =>
  agentId ? agentsById.get(agentId) || agentId : undefined;

const getStepContextById = (runDetails: WorkflowRunDetail[]) => {
  const steps = new Map<string, WorkflowRunStep>();
  runDetails.forEach(detail => {
    detail.steps.forEach(step => steps.set(step.id, step));
  });
  return steps;
};

const toPolicySummary = (
  decision: PolicyDecision,
  agentsById: Map<string, string>,
): FlightRecorderPolicySummary => ({
  id: decision.id,
  runId: decision.runId,
  runStepId: decision.runStepId,
  toolInvocationId: decision.toolInvocationId,
  actionType: decision.actionType,
  targetId: decision.targetId,
  decision: decision.decision,
  reason: decision.reason,
  requestedByAgentId: decision.requestedByAgentId,
  requestedByName: getAgentName(agentsById, decision.requestedByAgentId),
  createdAt: decision.createdAt,
});

const toHumanGateSummary = (
  wait: RunWait,
  agentsById: Map<string, string>,
): FlightRecorderHumanGateSummary => ({
  waitId: wait.id,
  runId: wait.runId,
  runStepId: wait.runStepId,
  type: wait.type,
  status: wait.status,
  message: wait.message,
  requestedBy: wait.requestedBy,
  requestedByName: getAgentName(agentsById, wait.requestedBy),
  resolvedBy: wait.resolvedBy,
  resolvedByName: getAgentName(agentsById, wait.resolvedBy),
  resolution: wait.resolution,
  contrarianReview: wait.payload?.contrarianReview,
  createdAt: wait.createdAt,
  resolvedAt: wait.resolvedAt,
});

const toArtifactSummary = ({
  artifact,
  agentsById,
}: {
  artifact: Artifact;
  agentsById: Map<string, string>;
}): FlightRecorderArtifactSummary => {
  const agentId = artifact.handoffFromAgentId || artifact.connectedAgentId || artifact.agent;
  return {
    artifactId: artifact.id,
    name: artifact.name,
    kind: artifact.artifactKind,
    summary: artifact.summary || artifact.description,
    workItemId: artifact.workItemId,
    runId: artifact.sourceRunId || artifact.runId,
    runStepId: artifact.sourceRunStepId || artifact.runStepId,
    phase: artifact.phase,
    agentId,
    agentName: getAgentName(agentsById, agentId),
    createdAt: artifact.created,
  };
};

const createRecorderEvent = (
  event: Omit<FlightRecorderEvent, 'severity'> & {
    severity?: FlightRecorderEvent['severity'];
  },
): FlightRecorderEvent => ({
  severity: 'INFO',
  ...event,
});

const mapRunEventToRecorderEvent = ({
  event,
  workItem,
  agentsById,
  stepContextById,
}: {
  event: RunEvent;
  workItem: WorkItem;
  agentsById: Map<string, string>;
  stepContextById: Map<string, WorkflowRunStep>;
}): FlightRecorderEvent | null => {
  const step = event.runStepId ? stepContextById.get(event.runStepId) : undefined;
  const base = {
    capabilityId: event.capabilityId,
    workItemId: event.workItemId,
    workItemTitle: workItem.title,
    runId: event.runId,
    runStepId: event.runStepId,
    toolInvocationId: event.toolInvocationId,
    traceId: event.traceId,
    timestamp: event.timestamp,
    actorId: step?.agentId,
    actorName: getAgentName(agentsById, step?.agentId),
    phase: step?.phase,
    description: event.message,
    severity: event.level === 'ERROR' ? 'ERROR' : event.level === 'WARN' ? 'WARN' : 'INFO',
  } satisfies Partial<FlightRecorderEvent>;

  if (event.type === 'STEP_COMPLETED') {
    return createRecorderEvent({
      ...base,
      id: `event-${event.id}`,
      type: 'STEP_COMPLETED',
      title: `${step?.name || 'Workflow step'} completed`,
    } as FlightRecorderEvent);
  }

  if (event.type === 'TOOL_COMPLETED' || event.type === 'TOOL_FAILED') {
    return createRecorderEvent({
      ...base,
      id: `event-${event.id}`,
      type: event.type === 'TOOL_COMPLETED' ? 'TOOL_COMPLETED' : 'TOOL_FAILED',
      title: event.type === 'TOOL_COMPLETED' ? 'Tool completed' : 'Tool failed',
    } as FlightRecorderEvent);
  }

  if (event.type === 'RUN_RESUMED') {
    return createRecorderEvent({
      ...base,
      id: `event-${event.id}`,
      type: 'WAIT_RESOLVED',
      title: 'Human gate resolved and run resumed',
    } as FlightRecorderEvent);
  }

  if (event.type === 'STEP_WAITING') {
    return createRecorderEvent({
      ...base,
      id: `event-${event.id}`,
      type: 'WAIT_OPENED',
      title: 'Workflow paused for human decision',
    } as FlightRecorderEvent);
  }

  if (event.type === 'CONTRARIAN_REVIEW_READY' || event.type === 'CONTRARIAN_REVIEW_FAILED') {
    return createRecorderEvent({
      ...base,
      id: `event-${event.id}`,
      type: 'CONTRARIAN_REVIEW',
      title:
        event.type === 'CONTRARIAN_REVIEW_READY'
          ? 'Contrarian review ready'
          : 'Contrarian review unavailable',
    } as FlightRecorderEvent);
  }

  if (event.type === 'STEP_FAILED') {
    return createRecorderEvent({
      ...base,
      id: `event-${event.id}`,
      type: 'RUN_FAILED',
      title: 'Workflow step failed',
    } as FlightRecorderEvent);
  }

  return null;
};

const buildRunLifecycleEvents = ({
  run,
  workItem,
}: {
  run: WorkflowRun;
  workItem: WorkItem;
}): FlightRecorderEvent[] => {
  const events: FlightRecorderEvent[] = [
    createRecorderEvent({
      id: `run-started-${run.id}`,
      capabilityId: run.capabilityId,
      workItemId: run.workItemId,
      workItemTitle: workItem.title,
      runId: run.id,
      traceId: run.traceId,
      timestamp: run.startedAt || run.createdAt,
      type: 'RUN_STARTED',
      title: `Attempt ${run.attemptNumber} started`,
      description: `Workflow run ${run.id} entered ${formatEnumLabel(run.status)}.`,
      actorId: run.assignedAgentId,
      phase: run.currentPhase,
    }),
  ];

  if (run.status === 'COMPLETED') {
    events.push(
      createRecorderEvent({
        id: `run-completed-${run.id}`,
        capabilityId: run.capabilityId,
        workItemId: run.workItemId,
        workItemTitle: workItem.title,
        runId: run.id,
        traceId: run.traceId,
        timestamp: run.completedAt || run.updatedAt,
        type: 'RUN_COMPLETED',
        title: `Attempt ${run.attemptNumber} completed`,
        description: run.terminalOutcome || 'Workflow run completed successfully.',
        actorId: run.assignedAgentId,
        phase: run.currentPhase,
      }),
    );
  }

  if (run.status === 'FAILED') {
    events.push(
      createRecorderEvent({
        id: `run-failed-${run.id}`,
        capabilityId: run.capabilityId,
        workItemId: run.workItemId,
        workItemTitle: workItem.title,
        runId: run.id,
        traceId: run.traceId,
        timestamp: run.completedAt || run.updatedAt,
        type: 'RUN_FAILED',
        title: `Attempt ${run.attemptNumber} failed`,
        description: run.terminalOutcome || 'Workflow run failed.',
        actorId: run.assignedAgentId,
        phase: run.currentPhase,
        severity: 'ERROR',
      }),
    );
  }

  return events;
};

const buildWaitEvents = ({
  gates,
  workItem,
}: {
  gates: FlightRecorderHumanGateSummary[];
  workItem: WorkItem;
}): FlightRecorderEvent[] =>
  gates.flatMap(gate => {
    const opened = createRecorderEvent({
      id: `wait-opened-${gate.waitId}`,
      capabilityId: workItem.capabilityId,
      workItemId: workItem.id,
      workItemTitle: workItem.title,
      runId: gate.runId,
      runStepId: gate.runStepId,
      waitId: gate.waitId,
      timestamp: gate.createdAt,
      type: 'WAIT_OPENED',
      title: `${formatEnumLabel(gate.type)} opened`,
      description: gate.message,
      actorId: gate.requestedBy,
      actorName: gate.requestedByName,
      severity: gate.type === 'CONFLICT_RESOLUTION' ? 'WARN' : 'INFO',
    });
    const events = [opened];

    if (gate.resolvedAt) {
      events.push(
        createRecorderEvent({
          id: `wait-resolved-${gate.waitId}`,
          capabilityId: workItem.capabilityId,
          workItemId: workItem.id,
          workItemTitle: workItem.title,
          runId: gate.runId,
          runStepId: gate.runStepId,
          waitId: gate.waitId,
          timestamp: gate.resolvedAt,
          type:
            gate.type === 'APPROVAL'
              ? 'APPROVAL_CAPTURED'
              : gate.type === 'CONFLICT_RESOLUTION'
              ? 'CONFLICT_RESOLVED'
              : 'WAIT_RESOLVED',
          title: `${formatEnumLabel(gate.type)} resolved`,
          description: gate.resolution || 'Human gate was resolved.',
          actorId: gate.resolvedBy,
          actorName: gate.resolvedByName,
          severity: 'INFO',
        }),
      );
    }

    if (gate.contrarianReview) {
      events.push(
        createRecorderEvent({
          id: `contrarian-${gate.waitId}`,
          capabilityId: workItem.capabilityId,
          workItemId: workItem.id,
          workItemTitle: workItem.title,
          runId: gate.runId,
          runStepId: gate.runStepId,
          waitId: gate.waitId,
          timestamp: gate.contrarianReview.generatedAt || gate.createdAt,
          type: 'CONTRARIAN_REVIEW',
          title:
            gate.contrarianReview.status === 'READY'
              ? 'Contrarian review ready'
              : 'Contrarian review unavailable',
          description:
            gate.contrarianReview.summary ||
            gate.contrarianReview.lastError ||
            'Contrarian review was requested for this conflict.',
          actorId: gate.contrarianReview.reviewerAgentId,
          severity:
            gate.contrarianReview.status === 'ERROR' ||
            gate.contrarianReview.severity === 'HIGH' ||
            gate.contrarianReview.severity === 'CRITICAL'
              ? 'WARN'
              : 'INFO',
        }),
      );
    }

    return events;
  });

const buildPolicyEvents = ({
  policies,
  workItem,
}: {
  policies: FlightRecorderPolicySummary[];
  workItem: WorkItem;
}): FlightRecorderEvent[] =>
  policies.map(policy =>
    createRecorderEvent({
      id: `policy-${policy.id}`,
      capabilityId: workItem.capabilityId,
      workItemId: workItem.id,
      workItemTitle: workItem.title,
      runId: policy.runId,
      runStepId: policy.runStepId,
      policyDecisionId: policy.id,
      toolInvocationId: policy.toolInvocationId,
      timestamp: policy.createdAt,
      type: 'POLICY_DECISION',
      title: `${formatEnumLabel(policy.decision)} policy decision`,
      description: policy.reason,
      actorId: policy.requestedByAgentId,
      actorName: policy.requestedByName,
      severity: policy.decision === 'DENY' ? 'ERROR' : policy.decision === 'REQUIRE_APPROVAL' ? 'WARN' : 'INFO',
    }),
  );

const buildArtifactEvents = ({
  artifacts,
  workItem,
}: {
  artifacts: FlightRecorderArtifactSummary[];
  workItem: WorkItem;
}): FlightRecorderEvent[] =>
  artifacts.map(artifact =>
    createRecorderEvent({
      id: `artifact-${artifact.artifactId}`,
      capabilityId: workItem.capabilityId,
      workItemId: workItem.id,
      workItemTitle: workItem.title,
      runId: artifact.runId,
      runStepId: artifact.runStepId,
      artifactId: artifact.artifactId,
      timestamp: artifact.createdAt,
      type: artifact.kind === 'HANDOFF_PACKET' ? 'HANDOFF_CREATED' : 'ARTIFACT_CREATED',
      title:
        artifact.kind === 'HANDOFF_PACKET'
          ? `Handoff created: ${artifact.name}`
          : `Artifact created: ${artifact.name}`,
      description: artifact.summary || `${formatEnumLabel(artifact.kind)} evidence was recorded.`,
      actorId: artifact.agentId,
      actorName: artifact.agentName,
      phase: artifact.phase,
    }),
  );

const buildToolEvents = ({
  tools,
  workItem,
  stepContextById,
}: {
  tools: ToolInvocation[];
  workItem: WorkItem;
  stepContextById: Map<string, WorkflowRunStep>;
}): FlightRecorderEvent[] =>
  tools
    .filter(tool => tool.status === 'COMPLETED' || tool.status === 'FAILED')
    .map(tool => {
      const step = stepContextById.get(tool.runStepId);
      return createRecorderEvent({
        id: `tool-${tool.id}`,
        capabilityId: workItem.capabilityId,
        workItemId: workItem.id,
        workItemTitle: workItem.title,
        runId: tool.runId,
        runStepId: tool.runStepId,
        toolInvocationId: tool.id,
        traceId: tool.traceId,
        timestamp: tool.completedAt || tool.startedAt || tool.createdAt,
        type: tool.status === 'COMPLETED' ? 'TOOL_COMPLETED' : 'TOOL_FAILED',
        title: `${formatEnumLabel(tool.toolId)} ${tool.status.toLowerCase()}`,
        description: tool.resultSummary || `Tool ${tool.toolId} ${tool.status.toLowerCase()}.`,
        actorId: step?.agentId,
        phase: step?.phase,
        severity: tool.status === 'FAILED' ? 'ERROR' : 'INFO',
      });
    });

const buildVerdictEvent = ({
  detail,
}: {
  detail: WorkItemFlightRecorderDetail;
}): FlightRecorderEvent =>
  createRecorderEvent({
    id: `verdict-${detail.workItem.id}`,
    capabilityId: detail.capabilityId,
    workItemId: detail.workItem.id,
    workItemTitle: detail.workItem.title,
    runId: detail.latestRun?.id,
    traceId: detail.latestRun?.traceId,
    timestamp: detail.generatedAt,
    type: 'RELEASE_VERDICT',
    title: `Release verdict: ${formatEnumLabel(detail.verdict)}`,
    description: detail.verdictReason,
    verdict: detail.verdict,
    severity: eventSeverityFromVerdict(detail.verdict),
  });

const getUnresolvedApprovalPolicy = ({
  policies,
  gates,
}: {
  policies: FlightRecorderPolicySummary[];
  gates: FlightRecorderHumanGateSummary[];
}) => {
  const resolvedApprovalExists = gates.some(
    gate => gate.type === 'APPROVAL' && gate.status === 'RESOLVED',
  );

  return policies.some(policy => policy.decision === 'REQUIRE_APPROVAL') && !resolvedApprovalExists;
};

export const buildWorkItemFlightRecorderDetail = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkItemFlightRecorderDetail> => {
  const [evidence, bundle, policies] = await Promise.all([
    getCompletedWorkOrderEvidence(capabilityId, workItemId),
    getCapabilityBundle(capabilityId),
    listPolicyDecisions(capabilityId, 500),
  ]);
  const runHistory = await listWorkflowRunsForWorkItem(capabilityId, workItemId);
  const [runDetails, eventLists] = await Promise.all([
    Promise.all(runHistory.map(run => getWorkflowRunDetail(capabilityId, run.id))),
    Promise.all(runHistory.map(run => listWorkflowRunEvents(capabilityId, run.id))),
  ]);
  const agentsById = new Map(bundle.workspace.agents.map(agent => [agent.id, agent.name]));
  const runsById = new Map(runHistory.map(run => [run.id, run]));
  const runIds = new Set(runHistory.map(run => run.id));
  const stepContextById = getStepContextById(runDetails);
  const waits = runDetails.flatMap(detail => detail.waits);
  const tools = runDetails.flatMap(detail => detail.toolInvocations);
  const gates = waits.map(wait => toHumanGateSummary(wait, agentsById));
  const policySummaries = policies
    .filter(policy => policy.runId && runIds.has(policy.runId))
    .map(policy => toPolicySummary(policy, agentsById))
    .sort((left, right) => sortIsoDesc(left.createdAt, right.createdAt));
  const artifactSummaries = evidence.artifacts.map(record =>
    toArtifactSummary({ artifact: record.artifact, agentsById }),
  );
  const handoffArtifacts = artifactSummaries.filter(
    artifact => artifact.kind === 'HANDOFF_PACKET',
  );
  const latestRun = evidence.latestCompletedRun || runHistory[0] || undefined;
  const verdictResult = deriveFlightRecorderVerdictFromFacts({
    hasCompletedRun: runHistory.some(run => run.status === 'COMPLETED'),
    hasOpenWaits: gates.some(gate => gate.status === 'OPEN'),
    hasDeniedPolicy: policySummaries.some(policy => policy.decision === 'DENY'),
    hasUnresolvedApprovalPolicy: getUnresolvedApprovalPolicy({
      policies: policySummaries,
      gates,
    }),
    hasEvidenceArtifacts: artifactSummaries.some(
      artifact => artifact.kind !== 'HANDOFF_PACKET',
    ),
    hasHandoffArtifacts: handoffArtifacts.length > 0,
  });
  const runEvents = eventLists
    .flat()
    .map(event =>
      mapRunEventToRecorderEvent({
        event,
        workItem: evidence.workItem,
        agentsById,
        stepContextById,
      }),
    )
    .filter(Boolean) as FlightRecorderEvent[];
  const recorderEvents = [
    ...runHistory.flatMap(run =>
      buildRunLifecycleEvents({
        run,
        workItem: evidence.workItem,
      }),
    ),
    ...runEvents,
    ...buildWaitEvents({ gates, workItem: evidence.workItem }),
    ...buildPolicyEvents({ policies: policySummaries, workItem: evidence.workItem }),
    ...buildToolEvents({ tools, workItem: evidence.workItem, stepContextById }),
    ...buildArtifactEvents({ artifacts: artifactSummaries, workItem: evidence.workItem }),
  ];
  const traceIds = Array.from(
    new Set(
      [
        ...runHistory.map(run => run.traceId),
        ...tools.map(tool => tool.traceId),
        ...runEvents.map(event => event.traceId),
      ].filter(Boolean) as string[],
    ),
  );
  const detail: WorkItemFlightRecorderDetail = {
    capabilityId,
    generatedAt: new Date().toISOString(),
    workItem: evidence.workItem,
    verdict: verdictResult.verdict,
    verdictReason: verdictResult.reason,
    latestRun,
    runHistory,
    humanGates: gates.sort((left, right) => sortIsoDesc(left.resolvedAt || left.createdAt, right.resolvedAt || right.createdAt)),
    policyDecisions: policySummaries,
    artifacts: artifactSummaries
      .filter(artifact => artifact.kind !== 'HANDOFF_PACKET')
      .sort((left, right) => sortIsoDesc(left.createdAt, right.createdAt)),
    handoffArtifacts: handoffArtifacts.sort((left, right) => sortIsoDesc(left.createdAt, right.createdAt)),
    toolInvocations: tools.sort((left, right) => sortIsoDesc(left.completedAt || left.startedAt || left.createdAt, right.completedAt || right.startedAt || right.createdAt)),
    events: [],
    telemetry: {
      traceIds,
      toolInvocationCount: tools.length,
      failedToolInvocationCount: tools.filter(tool => tool.status === 'FAILED').length,
      totalToolLatencyMs: tools.reduce((total, tool) => total + (tool.latencyMs || 0), 0),
      totalToolCostUsd: tools.reduce((total, tool) => total + (tool.costUsd || 0), 0),
      runConsolePath: `/run-console?runId=${encodeURIComponent(latestRun?.id || '')}`,
    },
  };

  detail.events = [...recorderEvents, buildVerdictEvent({ detail })].sort((left, right) =>
    sortIsoAsc(left.timestamp, right.timestamp),
  );

  return detail;
};

const aggregateCapabilityVerdict = (
  workItems: WorkItemFlightRecorderDetail[],
): { verdict: FlightRecorderVerdict; reason: string } => {
  if (workItems.some(workItem => workItem.verdict === 'DENIED')) {
    return {
      verdict: 'DENIED',
      reason: 'At least one work item has a denied policy decision in its audit chain.',
    };
  }
  if (workItems.some(workItem => workItem.verdict === 'NEEDS_APPROVAL')) {
    return {
      verdict: 'NEEDS_APPROVAL',
      reason: 'At least one work item is waiting on a human gate or approval-backed policy evidence.',
    };
  }
  if (workItems.length === 0 || workItems.some(workItem => workItem.verdict === 'INCOMPLETE')) {
    return {
      verdict: 'INCOMPLETE',
      reason: 'One or more work items do not yet have enough completed release evidence.',
    };
  }

  return {
    verdict: 'ALLOWED',
    reason: 'All tracked work items have audit-ready release records.',
  };
};

export const buildCapabilityFlightRecorderSnapshot = async (
  capabilityId: string,
): Promise<CapabilityFlightRecorderSnapshot> => {
  const [bundle, runs] = await Promise.all([
    getCapabilityBundle(capabilityId),
    listWorkflowRunsByCapability(capabilityId),
  ]);
  const workItemIds = Array.from(
    new Set([
      ...bundle.workspace.workItems.map(workItem => workItem.id),
      ...runs.map(run => run.workItemId),
    ]),
  );
  const workItems = (
    await Promise.all(
      workItemIds.map(async workItemId => {
        try {
          return await buildWorkItemFlightRecorderDetail(capabilityId, workItemId);
        } catch (error) {
          console.warn('Unable to build flight recorder detail.', {
            capabilityId,
            workItemId,
            error,
          });
          return null;
        }
      }),
    )
  ).filter(Boolean) as WorkItemFlightRecorderDetail[];
  const aggregate = aggregateCapabilityVerdict(workItems);
  const events = workItems
    .flatMap(workItem => workItem.events)
    .sort((left, right) => sortIsoDesc(left.timestamp, right.timestamp));

  return {
    capabilityId,
    generatedAt: new Date().toISOString(),
    verdict: aggregate.verdict,
    verdictReason: aggregate.reason,
    summary: {
      completedWorkCount: workItems.filter(workItem =>
        workItem.runHistory.some(run => run.status === 'COMPLETED'),
      ).length,
      openHumanGateCount: workItems.reduce(
        (total, workItem) =>
          total + workItem.humanGates.filter(gate => gate.status === 'OPEN').length,
        0,
      ),
      policyDecisionCount: workItems.reduce(
        (total, workItem) => total + workItem.policyDecisions.length,
        0,
      ),
      evidenceArtifactCount: workItems.reduce(
        (total, workItem) => total + workItem.artifacts.length,
        0,
      ),
      handoffPacketCount: workItems.reduce(
        (total, workItem) => total + workItem.handoffArtifacts.length,
        0,
      ),
    },
    events,
    workItems: workItems.sort((left, right) =>
      sortIsoDesc(
        left.latestRun?.updatedAt || left.workItem.history[0]?.timestamp,
        right.latestRun?.updatedAt || right.workItem.history[0]?.timestamp,
      ),
    ),
  };
};

const renderEventTable = (events: FlightRecorderEvent[]) => {
  if (events.length === 0) {
    return 'No curated audit events are available yet.';
  }

  return [
    '| Time | Type | Work Item | Actor | Event |',
    '|---|---|---|---|---|',
    ...events.map(event =>
      [
        markdownEscape(event.timestamp),
        markdownEscape(formatEnumLabel(event.type)),
        markdownEscape(event.workItemTitle || event.workItemId || 'Capability'),
        markdownEscape(event.actorName || event.actorId || 'System'),
        markdownEscape(`${event.title}: ${event.description}`),
      ].join(' | '),
    ),
  ].join('\n');
};

const renderPolicyTable = (policies: FlightRecorderPolicySummary[]) => {
  if (policies.length === 0) {
    return 'No policy decisions were linked to this record.';
  }

  return [
    '| Time | Decision | Action | Requested By | Reason |',
    '|---|---|---|---|---|',
    ...policies.map(policy =>
      [
        markdownEscape(policy.createdAt),
        markdownEscape(policy.decision),
        markdownEscape(policy.actionType),
        markdownEscape(policy.requestedByName || policy.requestedByAgentId || 'System'),
        markdownEscape(policy.reason),
      ].join(' | '),
    ),
  ].join('\n');
};

const renderGateTable = (gates: FlightRecorderHumanGateSummary[]) => {
  if (gates.length === 0) {
    return 'No human approval, input, or conflict gates were linked to this record.';
  }

  return [
    '| Opened | Type | Status | Requested By | Resolution |',
    '|---|---|---|---|---|',
    ...gates.map(gate =>
      [
        markdownEscape(gate.createdAt),
        markdownEscape(gate.type),
        markdownEscape(gate.status),
        markdownEscape(gate.requestedByName || gate.requestedBy),
        markdownEscape(gate.resolution || gate.message),
      ].join(' | '),
    ),
  ].join('\n');
};

const renderArtifactTable = (artifacts: FlightRecorderArtifactSummary[]) => {
  if (artifacts.length === 0) {
    return 'No artifacts were linked to this record.';
  }

  return [
    '| Created | Kind | Name | Agent | Summary |',
    '|---|---|---|---|---|',
    ...artifacts.map(artifact =>
      [
        markdownEscape(artifact.createdAt),
        markdownEscape(artifact.kind || 'ARTIFACT'),
        markdownEscape(artifact.name),
        markdownEscape(artifact.agentName || artifact.agentId || 'System'),
        markdownEscape(artifact.summary || ''),
      ].join(' | '),
    ),
  ].join('\n');
};

export const renderWorkItemFlightRecorderMarkdown = (
  detail: WorkItemFlightRecorderDetail,
) =>
  [
    `# Flight Recorder: ${detail.workItem.title}`,
    '',
    `Generated: ${detail.generatedAt}`,
    '',
    `Verdict: ${detail.verdict}`,
    '',
    detail.verdictReason,
    '',
    '## Run References',
    '',
    detail.runHistory.length
      ? detail.runHistory
          .map(
            run =>
              `- ${run.id}: attempt ${run.attemptNumber}, ${run.status}, trace ${run.traceId || 'none'}`,
          )
          .join('\n')
      : '- No workflow runs are linked yet.',
    '',
    '## Timeline',
    '',
    renderEventTable(detail.events),
    '',
    '## Human Gates',
    '',
    renderGateTable(detail.humanGates),
    '',
    '## Policy Decisions',
    '',
    renderPolicyTable(detail.policyDecisions),
    '',
    '## Artifacts and Handoffs',
    '',
    renderArtifactTable([...detail.artifacts, ...detail.handoffArtifacts]),
    '',
    '## Telemetry References',
    '',
    `- Trace IDs: ${detail.telemetry.traceIds.join(', ') || 'none'}`,
    `- Tool invocations: ${detail.telemetry.toolInvocationCount}`,
    `- Failed tool invocations: ${detail.telemetry.failedToolInvocationCount}`,
    `- Total tool latency: ${detail.telemetry.totalToolLatencyMs} ms`,
    `- Tool cost estimate: $${detail.telemetry.totalToolCostUsd.toFixed(6)}`,
  ].join('\n');

export const renderCapabilityFlightRecorderMarkdown = (
  snapshot: CapabilityFlightRecorderSnapshot,
) =>
  [
    `# Capability Flight Recorder: ${snapshot.capabilityId}`,
    '',
    `Generated: ${snapshot.generatedAt}`,
    '',
    `Verdict: ${snapshot.verdict}`,
    '',
    snapshot.verdictReason,
    '',
    '## Summary',
    '',
    `- Completed work: ${snapshot.summary.completedWorkCount}`,
    `- Open human gates: ${snapshot.summary.openHumanGateCount}`,
    `- Policy decisions: ${snapshot.summary.policyDecisionCount}`,
    `- Evidence artifacts: ${snapshot.summary.evidenceArtifactCount}`,
    `- Handoff packets: ${snapshot.summary.handoffPacketCount}`,
    '',
    '## Capability Timeline',
    '',
    renderEventTable(snapshot.events),
    '',
    '## Work Item Verdicts',
    '',
    snapshot.workItems.length
      ? [
          '| Work Item | Verdict | Reason |',
          '|---|---|---|',
          ...snapshot.workItems.map(workItem =>
            [
              markdownEscape(workItem.workItem.title),
              markdownEscape(workItem.verdict),
              markdownEscape(workItem.verdictReason),
            ].join(' | '),
          ),
        ].join('\n')
      : 'No work items have recorder detail yet.',
  ].join('\n');

export const getFlightRecorderDownloadName = ({
  title,
  format,
}: {
  title: string;
  format: 'json' | 'markdown';
}) => {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'flight-recorder';
  return `${slug}.${format === 'json' ? 'json' : 'md'}`;
};
