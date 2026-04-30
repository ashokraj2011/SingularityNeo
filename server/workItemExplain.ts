import type {
  Artifact,
  CompletedWorkOrderDetail,
  FlightRecorderArtifactSummary,
  FlightRecorderHumanGateSummary,
  FlightRecorderPolicySummary,
  ReleaseReadiness,
  ReleaseReadinessDimension,
  ReviewPacketArtifactSummary,
  WorkItemAttemptDiff,
  WorkItemExplainDetail,
  WorkItemFlightRecorderDetail,
  WorkflowRun,
} from '../src/types';
import { isTestingWorkflowStep, isReleaseWorkflowStep } from '../src/lib/workflowStepSemantics';
import { getCompletedWorkOrderEvidence } from './ledger';
import {
  buildWorkItemFlightRecorderDetail,
  renderWorkItemFlightRecorderMarkdown,
} from './flightRecorder';
import { buildCapabilityConnectorContext } from './connectors';
import {
  getCapabilityBundle,
  replaceCapabilityWorkspaceContentRecord,
} from './domains/self-service/repository';

const createArtifactId = () => `ART-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const toFileSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'artifact';

const compactSummary = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);

const difference = (current: string[], previous: string[]) =>
  current.filter(item => !previous.includes(item));

const unique = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

const toArtifactDownloadUrl = (capabilityId: string, artifactId: string) =>
  `/api/capabilities/${encodeURIComponent(capabilityId)}/artifacts/${encodeURIComponent(artifactId)}/download`;

const buildReadinessDimensions = ({
  detail,
  evidence,
}: {
  detail: WorkItemFlightRecorderDetail;
  evidence: CompletedWorkOrderDetail;
}): ReleaseReadinessDimension[] => {
  const openHumanGates = detail.humanGates.filter(gate => gate.status === 'OPEN');
  const deniedPolicies = detail.policyDecisions.filter(policy => policy.decision === 'DENY');
  const approvalPolicies = detail.policyDecisions.filter(
    policy => policy.decision === 'REQUIRE_APPROVAL',
  );
  const qaSteps = evidence.workflow?.steps.filter(isTestingWorkflowStep) || [];
  const releaseSteps = evidence.workflow?.steps.filter(isReleaseWorkflowStep) || [];
  const hasQaEvidence = evidence.phaseGroups.some(group =>
    group.stepName
      ? qaSteps.some(step => step.name === group.stepName)
      : false,
  );
  const latestRunId = detail.latestRun?.id;
  const releasePolicies = detail.policyDecisions.filter(policy => policy.actionType === 'run_deploy');

  return [
    {
      id: 'evidence_complete',
      label: 'Evidence complete',
      weight: 25,
      applicable: true,
      passed: detail.artifacts.length > 0,
      reason:
        detail.artifacts.length > 0
          ? `${detail.artifacts.length} evidence artifact${detail.artifacts.length === 1 ? '' : 's'} captured.`
          : 'No non-handoff evidence artifacts are attached to the work item yet.',
    },
    {
      id: 'approvals_resolved',
      label: 'Approvals resolved',
      weight: 20,
      applicable: openHumanGates.length > 0 || approvalPolicies.length > 0,
      passed: openHumanGates.length === 0,
      reason:
        openHumanGates.length === 0
          ? 'No open approval, input, or conflict gates remain.'
          : `${openHumanGates.length} human gate${openHumanGates.length === 1 ? '' : 's'} still need resolution.`,
    },
    {
      id: 'no_denied_policy',
      label: 'No denied policy',
      weight: 20,
      applicable: true,
      passed: deniedPolicies.length === 0,
      reason:
        deniedPolicies.length === 0
          ? 'No denied policy decisions were found in the release chain.'
          : `${deniedPolicies.length} denied policy decision${deniedPolicies.length === 1 ? '' : 's'} block release.`,
    },
    {
      id: 'qa_complete',
      label: 'QA complete',
      weight: 15,
      applicable: qaSteps.length > 0,
      passed: qaSteps.length === 0 || hasQaEvidence,
      reason:
        qaSteps.length === 0
          ? 'This workflow does not define a dedicated QA step.'
          : hasQaEvidence
          ? 'Testing or QA evidence exists for the workflow.'
          : 'The workflow defines QA-oriented steps, but no QA evidence is linked yet.',
    },
    {
      id: 'handoff_complete',
      label: 'Handoff complete',
      weight: 10,
      applicable:
        (evidence.workflow?.steps.length || 0) > 1 ||
        detail.handoffArtifacts.length > 0,
      passed: detail.handoffArtifacts.length > 0,
      reason:
        detail.handoffArtifacts.length > 0
          ? `${detail.handoffArtifacts.length} handoff artifact${detail.handoffArtifacts.length === 1 ? '' : 's'} captured.`
          : 'No handoff packet has been recorded for this work item yet.',
    },
    {
      id: 'deployment_authorized',
      label: 'Deployment authorized',
      weight: 10,
      applicable: releaseSteps.length > 0 || releasePolicies.length > 0,
      passed:
        releasePolicies.every(policy => policy.decision !== 'DENY') &&
        (releasePolicies.length === 0 ||
          detail.humanGates.some(
            gate =>
              gate.type === 'APPROVAL' &&
              gate.status === 'RESOLVED' &&
              gate.runId === latestRunId,
          ) ||
          detail.latestRun?.status === 'COMPLETED'),
      reason:
        releaseSteps.length === 0 && releasePolicies.length === 0
          ? 'No deployment or release authorization step is defined for this work item.'
          : releasePolicies.some(policy => policy.decision === 'DENY')
          ? 'A deployment-related policy decision denied release.'
          : 'Deployment authorization is captured or no blocking release policy remains.',
    },
  ];
};

export const deriveReleaseReadiness = ({
  detail,
  evidence,
}: {
  detail: WorkItemFlightRecorderDetail;
  evidence: CompletedWorkOrderDetail;
}): ReleaseReadiness => {
  const dimensions = buildReadinessDimensions({ detail, evidence });
  const applicable = dimensions.filter(dimension => dimension.applicable);
  const totalWeight = applicable.reduce((sum, dimension) => sum + dimension.weight, 0);
  const passedWeight = applicable
    .filter(dimension => dimension.passed)
    .reduce((sum, dimension) => sum + dimension.weight, 0);
  const score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
  const blockingReasons = unique(
    dimensions
      .filter(dimension => dimension.applicable && !dimension.passed)
      .map(dimension => dimension.reason),
  );

  let status: ReleaseReadiness['status'] = 'INCOMPLETE';
  if (detail.policyDecisions.some(policy => policy.decision === 'DENY')) {
    status = 'BLOCKED';
  } else if (detail.humanGates.some(gate => gate.status === 'OPEN')) {
    status = 'WAITING_APPROVAL';
  } else if (score >= 85) {
    status = 'READY';
  }

  return {
    status,
    score,
    dimensions,
    blockingReasons,
  };
};

const summarizeRunStatusDelta = (current?: WorkflowRun, previous?: WorkflowRun) => {
  if (!current || !previous) {
    return undefined;
  }

  if (current.status === previous.status) {
    return `Status stayed ${current.status} across attempts ${previous.attemptNumber} and ${current.attemptNumber}.`;
  }

  return `Status moved from ${previous.status} on attempt ${previous.attemptNumber} to ${current.status} on attempt ${current.attemptNumber}.`;
};

const summarizeTerminalOutcomeDelta = (current?: WorkflowRun, previous?: WorkflowRun) => {
  if (!current || !previous) {
    return undefined;
  }

  const currentOutcome = current.terminalOutcome || 'No terminal outcome recorded';
  const previousOutcome = previous.terminalOutcome || 'No terminal outcome recorded';
  if (currentOutcome === previousOutcome) {
    return undefined;
  }

  return `Terminal outcome changed from "${previousOutcome}" to "${currentOutcome}".`;
};

const filterRunArtifacts = (
  items: FlightRecorderArtifactSummary[],
  run?: WorkflowRun,
) => items.filter(item => item.runId === run?.id);

const filterRunPolicies = (
  items: FlightRecorderPolicySummary[],
  run?: WorkflowRun,
) => items.filter(item => item.runId === run?.id);

const filterRunGates = (
  items: FlightRecorderHumanGateSummary[],
  run?: WorkflowRun,
) => items.filter(item => item.runId === run?.id);

export const deriveWorkItemAttemptDiff = ({
  detail,
}: {
  detail: WorkItemFlightRecorderDetail;
}): WorkItemAttemptDiff => {
  const currentRun = detail.runHistory[0];
  const previousRun = detail.runHistory[1];

  if (!currentRun || !previousRun) {
    return {
      hasPreviousAttempt: false,
      currentAttemptNumber: currentRun?.attemptNumber,
      summary: 'This is the first tracked attempt for this work item, so there is no earlier attempt to compare yet.',
      stepProgressDelta: [],
      waitDelta: [],
      policyDelta: [],
      evidenceDelta: [],
      handoffDelta: [],
      toolDelta: [],
      humanDelta: [],
    };
  }

  const currentCompletedSteps = unique(
    detail.events
      .filter(event => event.runId === currentRun.id && event.type === 'STEP_COMPLETED')
      .map(event => event.title),
  );
  const previousCompletedSteps = unique(
    detail.events
      .filter(event => event.runId === previousRun.id && event.type === 'STEP_COMPLETED')
      .map(event => event.title),
  );
  const currentWaits = filterRunGates(detail.humanGates, currentRun).map(
    gate => `${gate.type}: ${gate.message}`,
  );
  const previousWaits = filterRunGates(detail.humanGates, previousRun).map(
    gate => `${gate.type}: ${gate.message}`,
  );
  const currentPolicies = filterRunPolicies(detail.policyDecisions, currentRun).map(
    policy => `${policy.decision} ${policy.actionType}: ${policy.reason}`,
  );
  const previousPolicies = filterRunPolicies(detail.policyDecisions, previousRun).map(
    policy => `${policy.decision} ${policy.actionType}: ${policy.reason}`,
  );
  const currentArtifacts = filterRunArtifacts(detail.artifacts, currentRun).map(
    artifact => artifact.name,
  );
  const previousArtifacts = filterRunArtifacts(detail.artifacts, previousRun).map(
    artifact => artifact.name,
  );
  const currentHandoffs = filterRunArtifacts(detail.handoffArtifacts, currentRun).map(
    artifact => artifact.name,
  );
  const previousHandoffs = filterRunArtifacts(detail.handoffArtifacts, previousRun).map(
    artifact => artifact.name,
  );
  const currentTools = detail.toolInvocations
    .filter(tool => tool.runId === currentRun.id)
    .map(tool => `${tool.toolId}: ${tool.status}`);
  const previousTools = detail.toolInvocations
    .filter(tool => tool.runId === previousRun.id)
    .map(tool => `${tool.toolId}: ${tool.status}`);
  const currentHuman = filterRunGates(detail.humanGates, currentRun).map(
    gate => `${gate.status} ${gate.type} by ${gate.resolvedByName || gate.resolvedBy || gate.requestedByName || gate.requestedBy}`,
  );
  const previousHuman = filterRunGates(detail.humanGates, previousRun).map(
    gate => `${gate.status} ${gate.type} by ${gate.resolvedByName || gate.resolvedBy || gate.requestedByName || gate.requestedBy}`,
  );

  const stepProgressDelta = difference(currentCompletedSteps, previousCompletedSteps).map(
    item => `New completed step: ${item}`,
  );
  const newWaits = difference(currentWaits, previousWaits).map(item => `New gate: ${item}`);
  const resolvedWaits = difference(previousWaits, currentWaits).map(
    item => `Resolved gate: ${item}`,
  );
  const policyDelta = difference(currentPolicies, previousPolicies).map(
    item => `New policy decision: ${item}`,
  );
  const evidenceDelta = difference(currentArtifacts, previousArtifacts).map(
    item => `New evidence artifact: ${item}`,
  );
  const handoffDelta = difference(currentHandoffs, previousHandoffs).map(
    item => `New handoff packet: ${item}`,
  );
  const toolDelta = difference(currentTools, previousTools).map(
    item => `Tool change: ${item}`,
  );
  const humanDelta = difference(currentHuman, previousHuman).map(
    item => `Human action: ${item}`,
  );
  const summaryParts = [
    stepProgressDelta.length > 0 ? `${stepProgressDelta.length} new completed step(s)` : '',
    evidenceDelta.length > 0 ? `${evidenceDelta.length} new evidence artifact(s)` : '',
    resolvedWaits.length > 0 ? `${resolvedWaits.length} resolved gate(s)` : '',
    newWaits.length > 0 ? `${newWaits.length} new gate(s)` : '',
  ].filter(Boolean);

  return {
    hasPreviousAttempt: true,
    currentAttemptNumber: currentRun.attemptNumber,
    previousAttemptNumber: previousRun.attemptNumber,
    summary:
      summaryParts.join(', ') ||
      'The latest attempt mainly reused the same shape as the previous one, with no major evidence or gate changes captured.',
    statusDelta: summarizeRunStatusDelta(currentRun, previousRun),
    terminalOutcomeDelta: summarizeTerminalOutcomeDelta(currentRun, previousRun),
    stepProgressDelta,
    waitDelta: [...newWaits, ...resolvedWaits],
    policyDelta,
    evidenceDelta,
    handoffDelta,
    toolDelta,
    humanDelta,
  };
};

const buildExplainSummary = ({
  detail,
  readiness,
}: {
  detail: WorkItemFlightRecorderDetail;
  readiness: ReleaseReadiness;
}) => {
  const latestRunStatus = detail.latestRun?.status;
  const openGate = detail.humanGates.find(gate => gate.status === 'OPEN');

  if (readiness.status === 'BLOCKED') {
    return {
      headline: `${detail.workItem.title} is blocked by policy or unresolved execution risk.`,
      blockingState:
        readiness.blockingReasons[0] ||
        detail.verdictReason,
      nextAction: 'Review the denied policy decision or blocker, then revise the path before another attempt.',
      latestRunStatus,
    };
  }

  if (readiness.status === 'WAITING_APPROVAL' && openGate) {
    return {
      headline: `${detail.workItem.title} is waiting on ${openGate.type.toLowerCase().replace(/_/g, ' ')}.`,
      blockingState: openGate.message,
      nextAction: `Resolve the open ${openGate.type.toLowerCase().replace(/_/g, ' ')} gate so the workflow can continue.`,
      latestRunStatus,
    };
  }

  if (detail.latestRun?.status === 'COMPLETED') {
    return {
      headline: `${detail.workItem.title} completed its latest tracked run.`,
      blockingState: detail.verdictReason,
      nextAction:
        readiness.status === 'READY'
          ? 'Review the evidence and approvals, then move toward release or external review.'
          : 'Fill the remaining evidence or handoff gaps before treating this as release-ready.',
      latestRunStatus,
    };
  }

  if (detail.latestRun?.status === 'FAILED') {
    return {
      headline: `${detail.workItem.title} failed on its latest attempt.`,
      blockingState: detail.latestRun.terminalOutcome || detail.verdictReason,
      nextAction: 'Inspect what changed since the previous attempt, then guide the next retry with a tighter correction.',
      latestRunStatus,
    };
  }

  return {
    headline: `${detail.workItem.title} is still moving through the workflow.`,
    blockingState: detail.verdictReason,
    nextAction: 'Use the latest gates, evidence, and attempt diff to decide the next operator action.',
    latestRunStatus,
  };
};

const findLatestReviewPacket = ({
  artifacts,
  capabilityId,
}: {
  artifacts: Artifact[];
  capabilityId: string;
}): ReviewPacketArtifactSummary | undefined => {
  const latest = artifacts
    .filter(artifact => artifact.artifactKind === 'REVIEW_PACKET')
    .sort((left, right) => String(right.created || '').localeCompare(String(left.created || '')))[0];

  if (!latest || !latest.contentText) {
    return undefined;
  }

  return {
    artifactId: latest.id,
    name: latest.name,
    createdAt: latest.created,
    fileName: latest.fileName || `${toFileSlug(latest.name)}.md`,
    contentText: latest.contentText,
    downloadUrl: toArtifactDownloadUrl(capabilityId, latest.id),
  };
};

export const buildWorkItemExplainDetail = async (
  capabilityId: string,
  workItemId: string,
): Promise<WorkItemExplainDetail> => {
  const [detail, evidence, bundle, connectors] = await Promise.all([
    buildWorkItemFlightRecorderDetail(capabilityId, workItemId),
    getCompletedWorkOrderEvidence(capabilityId, workItemId),
    getCapabilityBundle(capabilityId),
    buildCapabilityConnectorContext(capabilityId),
  ]);
  const releaseReadiness = deriveReleaseReadiness({ detail, evidence });
  const attemptDiff = deriveWorkItemAttemptDiff({ detail });
  const latestReviewPacket = findLatestReviewPacket({
    artifacts: bundle.workspace.artifacts.filter(artifact => artifact.workItemId === workItemId),
    capabilityId,
  });

  return {
    capabilityId,
    generatedAt: new Date().toISOString(),
    workItem: detail.workItem,
    summary: buildExplainSummary({ detail, readiness: releaseReadiness }),
    releaseReadiness,
    attemptDiff,
    latestRun: detail.runHistory[0],
    previousRun: detail.runHistory[1],
    flightRecorder: {
      verdict: detail.verdict,
      verdictReason: detail.verdictReason,
    },
    evidence: {
      artifactCount: detail.artifacts.length,
      handoffCount: detail.handoffArtifacts.length,
      phaseCount: evidence.phaseGroups.length,
      latestCompletedAt: evidence.latestCompletedRun?.completedAt,
    },
    humanGates: detail.humanGates,
    policyDecisions: detail.policyDecisions,
    artifacts: detail.artifacts,
    handoffArtifacts: detail.handoffArtifacts,
    telemetry: detail.telemetry,
    connectors,
    reviewPacket: latestReviewPacket,
  };
};

export const renderWorkItemReviewPacketMarkdown = ({
  explain,
  evidence,
  detail,
}: {
  explain: WorkItemExplainDetail;
  evidence: CompletedWorkOrderDetail;
  detail: WorkItemFlightRecorderDetail;
}) =>
  [
    `# Review Packet: ${explain.workItem.title}`,
    '',
    `Generated: ${explain.generatedAt}`,
    '',
    `## Current State`,
    '',
    `- Headline: ${explain.summary.headline}`,
    `- Blocking state: ${explain.summary.blockingState}`,
    `- Next action: ${explain.summary.nextAction}`,
    `- Release readiness: ${explain.releaseReadiness.status} (${explain.releaseReadiness.score}%)`,
    '',
    '## Readiness Dimensions',
    '',
    ...explain.releaseReadiness.dimensions
      .filter(dimension => dimension.applicable)
      .map(
        dimension =>
          `- ${dimension.label}: ${dimension.passed ? 'Pass' : 'Needs work'} (${dimension.reason})`,
      ),
    '',
    '## Attempt Comparison',
    '',
    `- ${explain.attemptDiff.summary}`,
    ...(explain.attemptDiff.statusDelta ? [`- ${explain.attemptDiff.statusDelta}`] : []),
    ...(explain.attemptDiff.terminalOutcomeDelta
      ? [`- ${explain.attemptDiff.terminalOutcomeDelta}`]
      : []),
    ...(explain.attemptDiff.stepProgressDelta.length > 0
      ? ['', '### Step Progress', ...explain.attemptDiff.stepProgressDelta.map(item => `- ${item}`)]
      : []),
    ...(explain.attemptDiff.waitDelta.length > 0
      ? ['', '### Gates', ...explain.attemptDiff.waitDelta.map(item => `- ${item}`)]
      : []),
    ...(explain.attemptDiff.policyDelta.length > 0
      ? ['', '### Policy', ...explain.attemptDiff.policyDelta.map(item => `- ${item}`)]
      : []),
    ...(explain.attemptDiff.evidenceDelta.length > 0
      ? ['', '### Evidence', ...explain.attemptDiff.evidenceDelta.map(item => `- ${item}`)]
      : []),
    ...(explain.attemptDiff.handoffDelta.length > 0
      ? ['', '### Handoffs', ...explain.attemptDiff.handoffDelta.map(item => `- ${item}`)]
      : []),
    '',
    '## Acceptance, Design, and QA Signals',
    '',
    ...(evidence.phaseGroups.length > 0
      ? evidence.phaseGroups.flatMap(group => [
          `### ${group.label}${group.stepName ? ` - ${group.stepName}` : ''}`,
          ...group.artifacts.slice(0, 4).map(record => `- Artifact: ${record.artifact.name}`),
          ...group.handoffArtifacts
            .slice(0, 2)
            .map(record => `- Handoff: ${record.artifact.name}`),
          ...group.interactions
            .slice(0, 2)
            .map(interaction => `- Human gate: ${interaction.message}`),
        ])
      : ['- No phase evidence groups were available.']),
    '',
    '## Human Gates',
    '',
    ...(explain.humanGates.length > 0
      ? explain.humanGates.map(
          gate =>
            `- ${gate.type}: ${gate.status} — ${gate.resolution || gate.message}`,
        )
      : ['- No human gates were recorded.']),
    '',
    '## Policy Decisions',
    '',
    ...(explain.policyDecisions.length > 0
      ? explain.policyDecisions.map(
          decision => `- ${decision.decision} ${decision.actionType}: ${decision.reason}`,
        )
      : ['- No policy decisions were linked.']),
    '',
    '## Evidence and Handoffs',
    '',
    ...(detail.artifacts.length > 0
      ? detail.artifacts.slice(0, 8).map(artifact => `- Evidence: ${artifact.name}`)
      : ['- No evidence artifacts captured.']),
    ...(detail.handoffArtifacts.length > 0
      ? detail.handoffArtifacts.map(artifact => `- Handoff: ${artifact.name}`)
      : ['- No handoff packets captured.']),
    '',
    '## Flight Recorder',
    '',
    renderWorkItemFlightRecorderMarkdown(detail),
  ].join('\n');

export const generateReviewPacketForWorkItem = async (
  capabilityId: string,
  workItemId: string,
): Promise<ReviewPacketArtifactSummary> => {
  const [explain, evidence, detail, bundle] = await Promise.all([
    buildWorkItemExplainDetail(capabilityId, workItemId),
    getCompletedWorkOrderEvidence(capabilityId, workItemId),
    buildWorkItemFlightRecorderDetail(capabilityId, workItemId),
    getCapabilityBundle(capabilityId),
  ]);

  const title = `${explain.workItem.title} Review Packet`;
  const contentText = renderWorkItemReviewPacketMarkdown({
    explain,
    evidence,
    detail,
  });
  const artifact: Artifact = {
    id: createArtifactId(),
    name: title,
    capabilityId,
    type: 'Review Packet',
    version: `attempt-${explain.latestRun?.attemptNumber || 1}`,
    agent: 'SYSTEM',
    created: new Date().toISOString(),
    direction: 'OUTPUT',
    connectedAgentId: explain.workItem.assignedAgentId,
    sourceWorkflowId: explain.workItem.workflowId,
    runId: explain.latestRun?.id,
    summary: compactSummary(explain.summary.headline),
    artifactKind: 'REVIEW_PACKET',
    phase: explain.workItem.phase,
    workItemId,
    sourceRunId: explain.latestRun?.id,
    contentFormat: 'MARKDOWN',
    mimeType: 'text/markdown',
    fileName: `${toFileSlug(explain.workItem.id)}-review-packet.md`,
    contentText,
    downloadable: true,
    traceId: explain.latestRun?.traceId,
  };

  await replaceCapabilityWorkspaceContentRecord(capabilityId, {
    artifacts: [...bundle.workspace.artifacts, artifact],
  });

  return {
    artifactId: artifact.id,
    name: artifact.name,
    createdAt: artifact.created,
    fileName: artifact.fileName || `${toFileSlug(artifact.name)}.md`,
    contentText,
    downloadUrl: toArtifactDownloadUrl(capabilityId, artifact.id),
  };
};
