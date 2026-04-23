import { createHash } from 'node:crypto';
import { getLifecyclePhaseLabel } from '../src/lib/capabilityLifecycle';
import { buildCapabilityInteractionFeed } from '../src/lib/interactionFeed';
import type {
  ActorContext,
  ApprovalClarificationRequest,
  ApprovalClarificationResponse,
  ApprovalStructuredPacket,
  ApprovalStructuredPacketAiSummary,
  ApprovalWorkspaceContext,
  ApprovalWorkspaceState,
  Artifact,
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityInteractionFeed,
  ReviewPacketArtifactSummary,
  RunWait,
  WorkItem,
  WorkflowRunDetail,
  WorkflowRunStep,
} from '../src/types';
import {
  appendCapabilityMessageRecord,
  getCapabilityBundle,
  replaceCapabilityWorkspaceContentRecord,
} from './repository';
import {
  createApprovalDecision,
  createRunEvent,
  getWorkflowRunDetail,
  insertRunEvent,
  listWorkflowRunEvents,
  updateApprovalAssignmentsForWait,
  updateRunWaitPayload,
} from './execution/repository';
import {
  buildWorkItemExplainDetail,
  renderWorkItemReviewPacketMarkdown,
} from './workItemExplain';
import { getCompletedWorkOrderEvidence } from './ledger';
import { buildWorkItemFlightRecorderDetail } from './flightRecorder';
import { invokeCapabilityChat, requestGitHubModel } from './githubModels';
import { buildWorkItemRuntimeBriefing } from './chatWorkspace';
import {
  compactApprovalDeterministicSummary,
  buildBudgetedSectionPrompt,
  resolveTokenOptimizationPolicy,
} from './tokenOptimization';
import {
  createTraceId,
  finishTelemetrySpan,
  recordUsageMetrics,
  startTelemetrySpan,
} from './telemetry';

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const createArtifactId = () => createId('ART');
const createApprovalDecisionId = () => createId('APPROVALDECISION');
const createClarificationRequestId = () => createId('APPROVALREQ');
const createClarificationResponseId = () => createId('APPROVALRESP');
const createMessageId = () => createId('MSG');

const truncate = (value: string, limit = 220) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
};

const toTimestamp = (value?: string) => {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const compactSummary = (value: string, fallback = 'Approval workspace packet prepared.') => {
  const normalized = truncate(value || '', 160);
  return normalized || fallback;
};

const toFileSlug = (value: string) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'approval-packet';

const parseJsonObject = <T>(value: string): T | null => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
};

const dedupeStrings = (values: string[], limit: number) => {
  const seen = new Set<string>();
  const next: string[] = [];
  values.forEach(value => {
    const normalized = truncate(value || '', 220);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    if (next.length < limit) {
      next.push(normalized);
    }
  });
  return next;
};

const findApprovalWait = (detail: WorkflowRunDetail, waitId: string) => {
  const wait = detail.waits.find(candidate => candidate.id === waitId);
  if (!wait || wait.type !== 'APPROVAL') {
    throw new Error(`Approval wait ${waitId} was not found on run ${detail.run.id}.`);
  }
  return wait;
};

const replaceArtifactForApprovalWait = (artifacts: Artifact[], nextArtifact: Artifact) => {
  const filtered = artifacts.filter(
    artifact =>
      !(
        artifact.artifactKind === nextArtifact.artifactKind &&
        (artifact.sourceWaitId || null) === (nextArtifact.sourceWaitId || null) &&
        (artifact.runId || artifact.sourceRunId || null) ===
          (nextArtifact.runId || nextArtifact.sourceRunId || null)
      ),
  );

  return [...filtered, nextArtifact].sort(
    (left, right) => toTimestamp(right.created) - toTimestamp(left.created),
  );
};

const getApprovalWorkspaceState = (wait: RunWait): ApprovalWorkspaceState => {
  const raw = wait.payload?.approvalWorkspace;
  return raw && typeof raw === 'object' ? (raw as ApprovalWorkspaceState) : {};
};

const getCurrentRunStep = (detail: WorkflowRunDetail, wait: RunWait): WorkflowRunStep | undefined =>
  detail.steps.find(step => step.id === wait.runStepId) ||
  detail.steps.find(step => step.id === detail.run.currentStepId);

const getApprovalArtifacts = ({
  workspaceArtifacts,
  workItemId,
  waitId,
  runId,
}: {
  workspaceArtifacts: Artifact[];
  workItemId: string;
  waitId: string;
  runId: string;
}) =>
  workspaceArtifacts
    .filter(
      artifact =>
        artifact.workItemId === workItemId ||
        artifact.sourceWaitId === waitId ||
        artifact.runId === runId ||
        artifact.sourceRunId === runId,
    )
    .slice()
    .sort((left, right) => toTimestamp(right.created) - toTimestamp(left.created));

const buildChatExcerptTitle = (record: CapabilityInteractionFeed['records'][number]) =>
  `${record.actorLabel ? `${record.actorLabel}: ` : ''}${record.title}`;

const mineApprovalDeterministicSummary = ({
  workItem,
  wait,
  feed,
  artifacts,
  clarificationRequests,
  clarificationResponses,
  explainHeadline,
}: {
  workItem: WorkItem;
  wait: RunWait;
  feed: CapabilityInteractionFeed;
  artifacts: Artifact[];
  clarificationRequests: ApprovalClarificationRequest[];
  clarificationResponses: ApprovalClarificationResponse[];
  explainHeadline?: string;
}) => {
  const recentRecords = feed.records.slice().sort(
    (left, right) => toTimestamp(right.timestamp) - toTimestamp(left.timestamp),
  );
  const keyEvents = dedupeStrings(
    recentRecords
      .filter(
        record =>
          record.interactionType === 'WAIT' ||
          record.interactionType === 'APPROVAL' ||
          record.interactionType === 'RUN_EVENT',
      )
      .map(record => `${record.title}${record.summary ? ` — ${record.summary}` : ''}`),
    8,
  );

  const keyClaims = dedupeStrings(
    recentRecords
      .filter(
        record =>
          record.interactionType === 'CHAT' ||
          record.interactionType === 'TASK' ||
          record.interactionType === 'ARTIFACT',
      )
      .map(record => `${buildChatExcerptTitle(record)}${record.summary ? ` — ${record.summary}` : ''}`),
    8,
  );

  const evidenceHighlights = dedupeStrings(
    artifacts
      .slice(0, 10)
      .map(
        artifact =>
          `${artifact.name}${artifact.summary ? ` — ${artifact.summary}` : ''}${
            artifact.artifactKind ? ` (${artifact.artifactKind})` : ''
          }`,
      ),
    10,
  );

  const requestQuestions = clarificationRequests.flatMap(request =>
    request.clarificationQuestions.map(
      question => `${request.targetAgentName || request.targetAgentId}: ${question}`,
    ),
  );
  const unansweredRequestIds = new Set(
    clarificationRequests
      .filter(request => request.status !== 'RESPONDED')
      .map(request => request.id),
  );
  const pendingQuestions = clarificationRequests
    .filter(request => unansweredRequestIds.has(request.id))
    .flatMap(request => request.clarificationQuestions);
  const responseErrors = clarificationResponses
    .filter(response => response.error)
    .map(response => response.error || '');

  const openQuestions = dedupeStrings(
    [
      ...pendingQuestions,
      ...requestQuestions,
      wait.message,
    ],
    8,
  );

  const unresolvedConcerns = dedupeStrings(
    [
      ...((wait.approvalDecisions || [])
        .filter(decision => decision.disposition === 'REQUEST_CHANGES')
        .map(
          decision =>
            `${decision.actorDisplayName} requested changes${
              decision.comment ? ` — ${decision.comment}` : ''
            }`,
        )),
      ...responseErrors,
    ],
    8,
  );

  const chatExcerpts = recentRecords
    .filter(
      record =>
        record.interactionType === 'CHAT' ||
        record.interactionType === 'TOOL' ||
        record.interactionType === 'RUN_EVENT',
    )
    .slice(0, 6)
    .map(record => ({
      id: record.id,
      title: buildChatExcerptTitle(record),
      timestamp: record.timestamp,
      excerpt: truncate(record.summary || record.title, 280),
    }));

  return {
    approvalSummary: [
      `${workItem.title} is waiting for approval.`,
      wait.message,
      explainHeadline ? `Current state: ${explainHeadline}` : null,
    ]
      .filter(Boolean)
      .join(' '),
    keyEvents,
    keyClaims,
    evidenceHighlights,
    openQuestions,
    unresolvedConcerns,
    chatExcerpts,
  };
};

const buildApprovalPacketMarkdown = ({
  workItem,
  wait,
  deterministic,
  aiSummary,
  reviewPacketMarkdown,
  clarificationRequests,
  clarificationResponses,
}: {
  workItem: WorkItem;
  wait: RunWait;
  deterministic: ApprovalStructuredPacket['deterministic'];
  aiSummary: ApprovalStructuredPacketAiSummary;
  reviewPacketMarkdown: string;
  clarificationRequests: ApprovalClarificationRequest[];
  clarificationResponses: ApprovalClarificationResponse[];
}) =>
  [
    `# Approval Workspace Packet: ${workItem.title}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Approval Gate',
    '',
    `- Wait ID: ${wait.id}`,
    `- Request: ${wait.message}`,
    `- Status: ${wait.status}`,
    '',
    '## Deterministic Summary',
    '',
    `- Summary: ${deterministic.approvalSummary}`,
    ...(deterministic.keyEvents.length > 0
      ? ['', '### Key Events', ...deterministic.keyEvents.map(item => `- ${item}`)]
      : []),
    ...(deterministic.keyClaims.length > 0
      ? ['', '### Key Claims and Decisions', ...deterministic.keyClaims.map(item => `- ${item}`)]
      : []),
    ...(deterministic.evidenceHighlights.length > 0
      ? [
          '',
          '### Evidence Highlights',
          ...deterministic.evidenceHighlights.map(item => `- ${item}`),
        ]
      : []),
    ...(deterministic.openQuestions.length > 0
      ? ['', '### Open Questions', ...deterministic.openQuestions.map(item => `- ${item}`)]
      : []),
    ...(deterministic.unresolvedConcerns.length > 0
      ? [
          '',
          '### Unresolved Concerns',
          ...deterministic.unresolvedConcerns.map(item => `- ${item}`),
        ]
      : []),
    ...(deterministic.chatExcerpts.length > 0
      ? [
          '',
          '### Approval-Relevant Chat Excerpts',
          ...deterministic.chatExcerpts.map(
            excerpt => `- ${excerpt.title} (${excerpt.timestamp}): ${excerpt.excerpt}`,
          ),
        ]
      : []),
    '',
    '## AI Synthesis',
    '',
    `- Status: ${aiSummary.status}`,
    ...(aiSummary.summary ? [`- Summary: ${aiSummary.summary}`] : []),
    ...(aiSummary.topRisks.length > 0
      ? ['', '### Top Risks', ...aiSummary.topRisks.map(item => `- ${item}`)]
      : []),
    ...(aiSummary.missingEvidence.length > 0
      ? [
          '',
          '### Missing Evidence',
          ...aiSummary.missingEvidence.map(item => `- ${item}`),
        ]
      : []),
    ...(aiSummary.disagreements.length > 0
      ? [
          '',
          '### Disagreements',
          ...aiSummary.disagreements.map(item => `- ${item}`),
        ]
      : []),
    ...(aiSummary.suggestedClarifications.length > 0
      ? [
          '',
          '### Suggested Clarifications',
          ...aiSummary.suggestedClarifications.map(item => `- ${item}`),
        ]
      : []),
    ...(aiSummary.error ? ['', `- AI synthesis error: ${aiSummary.error}`] : []),
    ...(clarificationRequests.length > 0
      ? [
          '',
          '## Clarification Requests',
          ...clarificationRequests.map(
            request =>
              `- ${request.requestedAt}: ${request.requestedBy} sent ${request.targetAgentName || request.targetAgentId} clarification request — ${request.summary}`,
          ),
        ]
      : []),
    ...(clarificationResponses.length > 0
      ? [
          '',
          '## Clarification Responses',
          ...clarificationResponses.map(
            response =>
              `- ${response.createdAt}: ${response.agentName || response.agentId} responded — ${truncate(response.content, 280)}`,
          ),
        ]
      : []),
    '',
    '## Review Packet Backbone',
    '',
    reviewPacketMarkdown,
  ].join('\n');

const buildApprovalPacketFingerprint = ({
  wait,
  feed,
  artifacts,
  clarificationRequests,
  clarificationResponses,
}: {
  wait: RunWait;
  feed: CapabilityInteractionFeed;
  artifacts: Artifact[];
  clarificationRequests: ApprovalClarificationRequest[];
  clarificationResponses: ApprovalClarificationResponse[];
}) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        waitId: wait.id,
        waitStatus: wait.status,
        waitMessage: wait.message,
        decisions: (wait.approvalDecisions || []).map(decision => ({
          id: decision.id,
          disposition: decision.disposition,
          createdAt: decision.createdAt,
          comment: decision.comment,
        })),
        artifacts: artifacts.slice(0, 24).map(artifact => ({
          id: artifact.id,
          created: artifact.created,
          kind: artifact.artifactKind,
          summary: artifact.summary,
        })),
        records: feed.records.slice(0, 24).map(record => ({
          id: record.id,
          type: record.interactionType,
          timestamp: record.timestamp,
          summary: record.summary,
        })),
        clarificationRequests,
        clarificationResponses,
      }),
    )
    .digest('hex');

const buildApprovalAiSummary = async ({
  capability,
  agent,
  workItem,
  wait,
  packetDeterministic,
}: {
  capability: Capability;
  agent?: CapabilityAgent;
  workItem: WorkItem;
  wait: RunWait;
  packetDeterministic: ApprovalStructuredPacket['deterministic'];
}): Promise<ApprovalStructuredPacketAiSummary> => {
  const providerKey = agent?.providerKey || agent?.provider;
  const tokenPolicy = resolveTokenOptimizationPolicy(capability);
  const compactDeterministic = compactApprovalDeterministicSummary({
    deterministic: packetDeterministic,
    excerptMaxChars: tokenPolicy.approvalExcerptMaxChars,
  });
  const systemPrompt =
    'You are an approval packet synthesizer. Read the deterministic approval packet context and return strict JSON only.';
  const userPrompt = buildBudgetedSectionPrompt({
    protectedFragments: [
      {
        source: 'SYSTEM_CORE',
        text: systemPrompt,
      },
    ],
    promptFragments: [
      {
        source: 'WORK_ITEM_BRIEFING',
        text: [
          `Capability: ${capability.name}`,
          `Work item: ${workItem.title}`,
          `Approval wait: ${wait.message}`,
          '',
          'Return JSON with this shape:',
          '{"summary":"...","topRisks":["..."],"missingEvidence":["..."],"disagreements":["..."],"suggestedClarifications":["..."]}',
          '',
          'Rules:',
          '- summary must be 2-3 concise sentences',
          '- topRisks should contain 2-5 concrete risks',
          '- missingEvidence should contain only gaps supported by the deterministic context',
          '- disagreements should summarize unresolved reviewer concerns or requested changes',
          '- suggestedClarifications should be concise reviewer prompts',
          '- do not invent facts or artifacts that are not present',
        ].join('\n'),
      },
      {
        source: 'APPROVAL_PACKET',
        text: `Deterministic approval packet context:\n${JSON.stringify(compactDeterministic, null, 2)}`,
      },
    ],
    maxInputTokens: tokenPolicy.approvalSynthesisMaxInputTokens,
    providerKey,
    model: agent?.model,
  });
  const traceId = createTraceId();
  const span = await startTelemetrySpan({
    capabilityId: capability.id,
    traceId,
    entityType: 'APPROVAL',
    entityId: wait.id,
    name: `Approval synthesis: ${workItem.title}`,
    status: 'RUNNING',
    model: agent?.model,
    attributes: {
      waitId: wait.id,
      runId: wait.runId,
      stage: 'approval_synthesis',
    },
  });

  try {
    const response = await requestGitHubModel({
      model: agent?.model,
      providerKey,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt.prompt,
        },
      ],
      timeoutMs: 30_000,
    });
    await finishTelemetrySpan({
      capabilityId: capability.id,
      spanId: span.id,
      status: 'OK',
      costUsd: response.usage.estimatedCostUsd,
      tokenUsage: response.usage,
      attributes: {
        stage: 'approval_synthesis',
        promptReceipt: userPrompt.receipt,
      },
    });
    await recordUsageMetrics({
      capabilityId: capability.id,
      traceId,
      scopeType: 'APPROVAL',
      scopeId: wait.id,
      totalTokens: response.usage.totalTokens,
      costUsd: response.usage.estimatedCostUsd,
      tags: {
        model: response.model,
        stage: 'approval_synthesis',
      },
    });

    const parsed = parseJsonObject<{
      summary?: string;
      topRisks?: string[];
      missingEvidence?: string[];
      disagreements?: string[];
      suggestedClarifications?: string[];
    }>(response.content);

    if (!parsed) {
      return {
        status: 'ERROR',
        generatedAt: response.createdAt,
        model: response.model,
        topRisks: [],
        missingEvidence: [],
        disagreements: [],
        suggestedClarifications: [],
        error: 'AI synthesis returned invalid JSON.',
      };
    }

    return {
      status: 'READY',
      generatedAt: response.createdAt,
      model: response.model,
      summary: truncate(parsed.summary || '', 520),
      topRisks: dedupeStrings(parsed.topRisks || [], 5),
      missingEvidence: dedupeStrings(parsed.missingEvidence || [], 5),
      disagreements: dedupeStrings(parsed.disagreements || [], 5),
      suggestedClarifications: dedupeStrings(parsed.suggestedClarifications || [], 5),
    };
  } catch (error) {
    await finishTelemetrySpan({
      capabilityId: capability.id,
      spanId: span.id,
      status: 'ERROR',
      attributes: {
        stage: 'approval_synthesis',
        promptReceipt: userPrompt.receipt,
        error: error instanceof Error ? error.message : 'AI synthesis failed unexpectedly.',
      },
    }).catch(() => undefined);
    return {
      status: 'ERROR',
      topRisks: [],
      missingEvidence: [],
      disagreements: [],
      suggestedClarifications: [],
      error: error instanceof Error ? error.message : 'AI synthesis failed unexpectedly.',
    };
  }
};

const buildApprovalWorkspacePayload = ({
  existing,
  packet,
  clarificationRequests,
  clarificationResponses,
  clarificationStatus,
  activeClarificationRequestId,
}: {
  existing: ApprovalWorkspaceState;
  packet?: ApprovalStructuredPacket;
  clarificationRequests: ApprovalClarificationRequest[];
  clarificationResponses: ApprovalClarificationResponse[];
  clarificationStatus: ApprovalWorkspaceState['clarificationStatus'];
  activeClarificationRequestId?: string;
}): ApprovalWorkspaceState => ({
  ...existing,
  packet: packet || existing.packet,
  clarificationRequests,
  clarificationResponses,
  clarificationStatus,
  activeClarificationRequestId,
});

const buildApprovalInteractionMessages = ({
  capabilityId,
  workItemId,
  runId,
  workflowStepId,
  request,
  response,
  reviewerName,
  reviewerNote,
  responseModel,
}: {
  capabilityId: string;
  workItemId: string;
  runId: string;
  workflowStepId?: string;
  request: ApprovalClarificationRequest;
  response?: ApprovalClarificationResponse;
  reviewerName: string;
  reviewerNote?: string;
  responseModel?: string;
}) => {
  const requestMessage: Omit<CapabilityChatMessage, 'capabilityId'> = {
    id: createMessageId(),
    role: 'user',
    content: [
      `Approval clarification requested by ${reviewerName}.`,
      `Summary: ${request.summary}`,
      request.clarificationQuestions.length > 0
        ? `Questions:\n${request.clarificationQuestions.map(question => `- ${question}`).join('\n')}`
        : null,
      reviewerNote ? `Reviewer note: ${reviewerNote}` : null,
    ]
      .filter(Boolean)
      .join('\n\n'),
    timestamp: request.requestedAt,
    sessionScope: 'WORK_ITEM',
    sessionScopeId: workItemId,
    workItemId,
    runId,
    workflowStepId,
    agentId: request.targetAgentId,
    agentName: request.targetAgentName,
  };

  const responseMessage = response
    ? ({
        id: createMessageId(),
        role: 'agent',
        content: response.content,
        timestamp: response.createdAt,
        sessionScope: 'WORK_ITEM',
        sessionScopeId: workItemId,
        workItemId,
        runId,
        workflowStepId,
        agentId: response.agentId,
        agentName: response.agentName,
        model: responseModel,
      } satisfies Omit<CapabilityChatMessage, 'capabilityId'>)
    : null;

  return { requestMessage, responseMessage };
};

const buildClarificationArtifacts = ({
  capabilityId,
  workItem,
  runDetail,
  wait,
  request,
  response,
}: {
  capabilityId: string;
  workItem: WorkItem;
  runDetail: WorkflowRunDetail;
  wait: RunWait;
  request: ApprovalClarificationRequest;
  response?: ApprovalClarificationResponse;
}) => {
  const requestArtifact: Artifact = {
    id: createArtifactId(),
    name: `${workItem.title} Approval Clarification Request`,
    capabilityId,
    type: 'Approval Clarification',
    version: `attempt-${runDetail.run.attemptNumber}`,
    agent: request.requestedBy,
    created: request.requestedAt,
    direction: 'OUTPUT',
    connectedAgentId: request.targetAgentId,
    sourceWorkflowId: runDetail.run.workflowId,
    runId: runDetail.run.id,
    runStepId: wait.runStepId,
    summary: compactSummary(request.summary, 'Clarification requested before approval.'),
    artifactKind: 'APPROVAL_RECORD',
    phase: workItem.phase,
    workItemId: workItem.id,
    sourceRunId: runDetail.run.id,
    sourceRunStepId: wait.runStepId,
    sourceWaitId: wait.id,
    contentFormat: 'MARKDOWN',
    mimeType: 'text/markdown',
    fileName: `${toFileSlug(workItem.id)}-approval-clarification-request.md`,
    contentText: [
      `# Approval Clarification Request`,
      '',
      `- Work Item: ${workItem.id}`,
      `- Requested By: ${request.requestedBy}`,
      `- Target Agent: ${request.targetAgentName || request.targetAgentId}`,
      `- Summary: ${request.summary}`,
      ...(request.clarificationQuestions.length > 0
        ? [
            '',
            '## Clarification Questions',
            ...request.clarificationQuestions.map(question => `- ${question}`),
          ]
        : []),
      ...(request.note ? ['', `## Reviewer Note`, request.note] : []),
    ].join('\n'),
    downloadable: true,
    traceId: runDetail.run.traceId,
  };

  const responseArtifact = response
    ? ({
        id: createArtifactId(),
        name: `${workItem.title} Approval Clarification Response`,
        capabilityId,
        type: 'Approval Clarification',
        version: `attempt-${runDetail.run.attemptNumber}`,
        agent: response.agentName || response.agentId,
        created: response.createdAt,
        direction: 'OUTPUT',
        connectedAgentId: response.agentId,
        sourceWorkflowId: runDetail.run.workflowId,
        runId: runDetail.run.id,
        runStepId: wait.runStepId,
        summary: compactSummary(response.content, 'Clarification response recorded for approval.'),
        artifactKind: 'APPROVAL_RECORD',
        phase: workItem.phase,
        workItemId: workItem.id,
        sourceRunId: runDetail.run.id,
        sourceRunStepId: wait.runStepId,
        sourceWaitId: wait.id,
        contentFormat: 'MARKDOWN',
        mimeType: 'text/markdown',
        fileName: `${toFileSlug(workItem.id)}-approval-clarification-response.md`,
        contentText: `# Approval Clarification Response\n\n${response.content}`,
        downloadable: true,
        traceId: runDetail.run.traceId,
      } satisfies Artifact)
    : undefined;

  return {
    requestArtifact,
    responseArtifact,
  };
};

const persistApprovalClarificationState = async ({
  capabilityId,
  workItem,
  wait,
  packet,
  clarificationRequests,
  clarificationResponses,
  clarificationStatus,
  request,
  response,
  requestArtifact,
  responseArtifact,
}: {
  capabilityId: string;
  workItem: WorkItem;
  wait: RunWait;
  packet?: ApprovalStructuredPacket;
  clarificationRequests: ApprovalClarificationRequest[];
  clarificationResponses: ApprovalClarificationResponse[];
  clarificationStatus: ApprovalWorkspaceState['clarificationStatus'];
  request: ApprovalClarificationRequest;
  response?: ApprovalClarificationResponse;
  requestArtifact: Artifact;
  responseArtifact?: Artifact;
}) => {
  const bundle = await getCapabilityBundle(capabilityId);
  const nextArtifacts = [
    requestArtifact,
    ...(responseArtifact ? [responseArtifact] : []),
  ].reduce(
    (items, artifact) => replaceArtifactForApprovalWait(items, artifact),
    bundle.workspace.artifacts,
  );

  const nextWorkItems = bundle.workspace.workItems.map(item => {
    if (item.id !== workItem.id) {
      return item;
    }

    const historyEntries = [
      {
        id: createId('HIST'),
        timestamp: request.requestedAt,
        actor: request.requestedBy,
        action: 'Approval clarification requested',
        detail: request.summary,
        phase: item.phase,
        status: 'PENDING_APPROVAL' as const,
      },
      ...(response
        ? [
            {
              id: createId('HIST'),
              timestamp: response.createdAt,
              actor: response.agentName || response.agentId,
              action: 'Approval clarification responded',
              detail: truncate(response.content, 220),
              phase: item.phase,
              status: 'PENDING_APPROVAL' as const,
            },
          ]
        : []),
    ] satisfies typeof item.history;

    return {
      ...item,
      assignedAgentId: request.targetAgentId,
      status: 'PENDING_APPROVAL' as const,
      pendingRequest: {
        type: 'APPROVAL' as const,
        message: response
          ? `${response.agentName || response.agentId} sent approval clarifications back for review.`
          : `Clarification requested from ${request.targetAgentName || request.targetAgentId}.`,
        requestedBy: response?.agentName || request.requestedBy,
        timestamp: response?.createdAt || request.requestedAt,
      },
      blocker: undefined,
      activeRunId: wait.runId,
      lastRunId: wait.runId,
      history: [...item.history, ...historyEntries],
    };
  });

  await replaceCapabilityWorkspaceContentRecord(capabilityId, {
    artifacts: nextArtifacts,
    workItems: nextWorkItems,
  });

  const existingState = getApprovalWorkspaceState(wait);
  await updateRunWaitPayload({
    capabilityId,
    waitId: wait.id,
    payload: {
      ...(wait.payload || {}),
      approvalWorkspace: buildApprovalWorkspacePayload({
        existing: existingState,
        packet,
        clarificationRequests,
        clarificationResponses,
        clarificationStatus,
        activeClarificationRequestId:
          clarificationStatus === 'WAITING_FOR_AGENT' ? request.id : undefined,
      }),
    },
  });
};

const buildApprovalWorkspaceContextFromDetail = async ({
  capability,
  workspace,
  detail,
  wait,
}: {
  capability: Capability;
  workspace: Awaited<ReturnType<typeof getCapabilityBundle>>['workspace'];
  detail: WorkflowRunDetail;
  wait: RunWait;
}): Promise<ApprovalWorkspaceContext> => {
  const workItem =
    workspace.workItems.find(item => item.id === detail.run.workItemId) ||
    (() => {
      throw new Error(`Work item ${detail.run.workItemId} could not be found.`);
    })();
  const runStep = getCurrentRunStep(detail, wait);
  const runEvents = await listWorkflowRunEvents(capability.id, detail.run.id);
  const interactionFeed = buildCapabilityInteractionFeed({
    capability,
    workspace,
    workItemId: workItem.id,
    runDetail: detail,
    runEvents,
  });
  const approvalArtifacts = getApprovalArtifacts({
    workspaceArtifacts: workspace.artifacts,
    workItemId: workItem.id,
    waitId: wait.id,
    runId: detail.run.id,
  });
  const codeDiffArtifact =
    typeof wait.payload?.codeDiffArtifactId === 'string'
      ? approvalArtifacts.find(artifact => artifact.id === wait.payload?.codeDiffArtifactId)
      : undefined;
  const approvalState = getApprovalWorkspaceState(wait);
  const availableAgents = workspace.agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
  }));

  return {
    capabilityId: capability.id,
    capabilityName: capability.name,
    runId: detail.run.id,
    waitId: wait.id,
    workItem,
    run: detail.run,
    runStep,
    approvalWait: wait,
    interactionFeed,
    artifacts: approvalArtifacts,
    codeDiffArtifact,
    selectedArtifactId:
      approvalState.packet?.artifactId ||
      codeDiffArtifact?.id ||
      approvalArtifacts[0]?.id,
    availableAgents,
    currentPhaseLabel: getLifecyclePhaseLabel(capability.lifecycle, workItem.phase),
    currentStepName: runStep?.name || 'Approval review',
    requestedByLabel: wait.requestedBy,
    requestedAt: wait.createdAt,
    structuredPacket: approvalState.packet,
    clarificationRequests: approvalState.clarificationRequests || [],
    clarificationResponses: approvalState.clarificationResponses || [],
    clarificationStatus: approvalState.clarificationStatus || 'IDLE',
  };
};

export const getApprovalWorkspaceContext = async ({
  capabilityId,
  runId,
  waitId,
}: {
  capabilityId: string;
  runId: string;
  waitId: string;
}): Promise<ApprovalWorkspaceContext> => {
  const [bundle, detail] = await Promise.all([
    getCapabilityBundle(capabilityId),
    getWorkflowRunDetail(capabilityId, runId),
  ]);
  const wait = findApprovalWait(detail, waitId);

  return buildApprovalWorkspaceContextFromDetail({
    capability: bundle.capability,
    workspace: bundle.workspace,
    detail,
    wait,
  });
};

export const refreshApprovalStructuredPacket = async ({
  capabilityId,
  runId,
  waitId,
}: {
  capabilityId: string;
  runId: string;
  waitId: string;
}): Promise<ApprovalStructuredPacket> => {
  const [bundle, detail] = await Promise.all([
    getCapabilityBundle(capabilityId),
    getWorkflowRunDetail(capabilityId, runId),
  ]);
  const workItemId = detail.run.workItemId;
  const [explain, evidence, flightRecorder] = await Promise.all([
    buildWorkItemExplainDetail(capabilityId, workItemId),
    getCompletedWorkOrderEvidence(capabilityId, workItemId),
    buildWorkItemFlightRecorderDetail(capabilityId, workItemId),
  ]);
  const wait = findApprovalWait(detail, waitId);
  const workItem =
    bundle.workspace.workItems.find(item => item.id === detail.run.workItemId) ||
    (() => {
      throw new Error(`Work item ${detail.run.workItemId} could not be found.`);
    })();
  const runEvents = await listWorkflowRunEvents(capabilityId, runId);
  const interactionFeed = buildCapabilityInteractionFeed({
    capability: bundle.capability,
    workspace: bundle.workspace,
    workItemId: workItem.id,
    runDetail: detail,
    runEvents,
  });
  const approvalState = getApprovalWorkspaceState(wait);
  const clarificationRequests = approvalState.clarificationRequests || [];
  const clarificationResponses = approvalState.clarificationResponses || [];
  const approvalArtifacts = getApprovalArtifacts({
    workspaceArtifacts: bundle.workspace.artifacts,
    workItemId: workItem.id,
    waitId,
    runId,
  });
  const fingerprint = buildApprovalPacketFingerprint({
    wait,
    feed: interactionFeed,
    artifacts: approvalArtifacts,
    clarificationRequests,
    clarificationResponses,
  });

  if (approvalState.packet && approvalState.packet.sourceFingerprint === fingerprint) {
    return approvalState.packet;
  }

  const deterministic = mineApprovalDeterministicSummary({
    workItem,
    wait,
    feed: interactionFeed,
    artifacts: approvalArtifacts,
    clarificationRequests,
    clarificationResponses,
    explainHeadline: explain.summary.headline,
  });
  const currentAgent = bundle.workspace.agents.find(
    agent => agent.id === (detail.run.assignedAgentId || workItem.assignedAgentId),
  );
  const aiSummary = await buildApprovalAiSummary({
    capability: bundle.capability,
    agent: currentAgent,
    workItem,
    wait,
    packetDeterministic: deterministic,
  });
  const reviewPacketMarkdown = renderWorkItemReviewPacketMarkdown({
    explain,
    evidence,
    detail: flightRecorder,
  });
  const contentText = buildApprovalPacketMarkdown({
    workItem,
    wait,
    deterministic,
    aiSummary,
    reviewPacketMarkdown,
    clarificationRequests,
    clarificationResponses,
  });
  const packetArtifact: Artifact = {
    id: createArtifactId(),
    name: `${workItem.title} Approval Packet`,
    capabilityId,
    type: 'Approval Packet',
    version: `attempt-${detail.run.attemptNumber}`,
    agent: 'SYSTEM',
    created: new Date().toISOString(),
    direction: 'OUTPUT',
    connectedAgentId: detail.run.assignedAgentId || workItem.assignedAgentId,
    sourceWorkflowId: detail.run.workflowId,
    runId,
    runStepId: wait.runStepId,
    summary: compactSummary(deterministic.approvalSummary),
    artifactKind: 'REVIEW_PACKET',
    phase: workItem.phase,
    workItemId: workItem.id,
    sourceRunId: runId,
    sourceRunStepId: wait.runStepId,
    sourceWaitId: waitId,
    contentFormat: 'MARKDOWN',
    mimeType: 'text/markdown',
    fileName: `${toFileSlug(workItem.id)}-approval-packet.md`,
    contentText,
    downloadable: true,
    traceId: detail.run.traceId,
  };
  const packet: ApprovalStructuredPacket = {
    waitId,
    generatedAt: packetArtifact.created,
    sourceFingerprint: fingerprint,
    artifactId: packetArtifact.id,
    fileName: packetArtifact.fileName,
    contentText,
    deterministic,
    aiSummary,
  };
  const nextArtifacts = replaceArtifactForApprovalWait(bundle.workspace.artifacts, packetArtifact);

  await replaceCapabilityWorkspaceContentRecord(capabilityId, {
    artifacts: nextArtifacts,
  });
  await updateRunWaitPayload({
    capabilityId,
    waitId,
    payload: {
      ...(wait.payload || {}),
      approvalWorkspace: buildApprovalWorkspacePayload({
        existing: approvalState,
        packet,
        clarificationRequests,
        clarificationResponses,
        clarificationStatus: approvalState.clarificationStatus || 'IDLE',
      }),
    },
  });

  return packet;
};

const buildClarificationPrompt = ({
  workItem,
  request,
  briefing,
  packet,
}: {
  workItem: WorkItem;
  request: ApprovalClarificationRequest;
  briefing?: string;
  packet?: ApprovalStructuredPacket;
}) =>
  [
    `A human approver sent back ${workItem.title} for clarification.`,
    '',
    `Clarification summary: ${request.summary}`,
    request.note ? `Reviewer note: ${request.note}` : null,
    request.clarificationQuestions.length > 0
      ? [
          'Answer these questions clearly:',
          ...request.clarificationQuestions.map(question => `- ${question}`),
        ].join('\n')
      : null,
    '',
    'Respond in Markdown with these sections:',
    '## Summary',
    '## Clarifications',
    '## Evidence to Review',
    '## Remaining Risks',
    '',
    packet
      ? `Structured approval packet summary:\n${packet.deterministic.approvalSummary}`
      : null,
    briefing ? `Focused runtime briefing:\n${briefing}` : null,
  ]
    .filter(Boolean)
    .join('\n');

export const sendBackApprovalForClarification = async ({
  capabilityId,
  runId,
  waitId,
  targetAgentId,
  summary,
  clarificationQuestions,
  note,
  actor,
}: {
  capabilityId: string;
  runId: string;
  waitId: string;
  targetAgentId: string;
  summary: string;
  clarificationQuestions: string[];
  note?: string;
  actor?: ActorContext;
}): Promise<ApprovalWorkspaceContext> => {
  const [bundle, detail] = await Promise.all([
    getCapabilityBundle(capabilityId),
    getWorkflowRunDetail(capabilityId, runId),
  ]);
  const wait = findApprovalWait(detail, waitId);
  if (wait.status !== 'OPEN') {
    throw new Error('Only open approval waits can be sent back for clarification.');
  }
  const workItem =
    bundle.workspace.workItems.find(item => item.id === detail.run.workItemId) ||
    (() => {
      throw new Error(`Work item ${detail.run.workItemId} could not be found.`);
    })();
  const targetAgent =
    bundle.workspace.agents.find(agent => agent.id === targetAgentId) ||
    (() => {
      throw new Error(`Agent ${targetAgentId} is not configured for this capability.`);
    })();
  const approvalState = getApprovalWorkspaceState(wait);
  const request: ApprovalClarificationRequest = {
    id: createClarificationRequestId(),
    capabilityId,
    runId,
    waitId,
    targetAgentId,
    targetAgentName: targetAgent.name,
    summary,
    clarificationQuestions,
    note,
    requestedBy: actor?.displayName || 'Workspace Operator',
    requestedByActorUserId: actor?.userId,
    requestedAt: new Date().toISOString(),
    status: 'PENDING_RESPONSE',
  };

  await updateApprovalAssignmentsForWait({
    capabilityId,
    waitId,
    status: 'REQUEST_CHANGES',
  });
  await createApprovalDecision({
    id: createApprovalDecisionId(),
    capabilityId,
    runId,
    waitId,
    assignmentId: undefined,
    disposition: 'REQUEST_CHANGES',
    actorUserId: actor?.userId,
    actorDisplayName: actor?.displayName || 'Workspace Operator',
    actorTeamIds: actor?.teamIds || [],
    comment: [summary, note].filter(Boolean).join('\n\n'),
    createdAt: request.requestedAt,
  });

  const requestArtifactPlaceholder: Artifact = {
    id: createArtifactId(),
    name: `${workItem.title} Approval Clarification Request`,
    capabilityId,
    type: 'Approval Clarification',
    version: `attempt-${detail.run.attemptNumber}`,
    agent: request.requestedBy,
    created: request.requestedAt,
    direction: 'OUTPUT',
    connectedAgentId: targetAgentId,
    sourceWorkflowId: detail.run.workflowId,
    runId,
    runStepId: wait.runStepId,
    summary: compactSummary(summary),
    artifactKind: 'APPROVAL_RECORD',
    phase: workItem.phase,
    workItemId: workItem.id,
    sourceRunId: runId,
    sourceRunStepId: wait.runStepId,
    sourceWaitId: waitId,
    contentFormat: 'MARKDOWN',
    mimeType: 'text/markdown',
    fileName: `${toFileSlug(workItem.id)}-approval-clarification-request.md`,
    contentText: '',
    downloadable: true,
    traceId: detail.run.traceId,
  };
  const waitingClarificationRequests = [...(approvalState.clarificationRequests || []), request];
  await updateRunWaitPayload({
    capabilityId,
    waitId,
    payload: {
      ...(wait.payload || {}),
      approvalWorkspace: buildApprovalWorkspacePayload({
        existing: approvalState,
        packet: approvalState.packet,
        clarificationRequests: waitingClarificationRequests,
        clarificationResponses: approvalState.clarificationResponses || [],
        clarificationStatus: 'WAITING_FOR_AGENT',
        activeClarificationRequestId: request.id,
      }),
    },
  });

  let response: ApprovalClarificationResponse | undefined;
  let responseArtifact: Artifact | undefined;
  let responseModel: string | undefined;

  try {
    const briefing = await buildWorkItemRuntimeBriefing({
      bundle,
      workItem,
    }).catch(() => undefined);
    const clarificationChat = await invokeCapabilityChat({
      capability: bundle.capability,
      agent: targetAgent,
      history: [],
      message: buildClarificationPrompt({
        workItem,
        request,
        briefing,
        packet: approvalState.packet,
      }),
      scope: 'WORK_ITEM',
      scopeId: workItem.id,
      resetSession: true,
      developerPrompt:
        'You are responding to an approval clarification request. Be concrete, evidence-aware, and address each reviewer concern without pretending unresolved issues are closed.',
    });

    responseModel = clarificationChat.model;
    response = {
      id: createClarificationResponseId(),
      capabilityId,
      runId,
      waitId,
      requestId: request.id,
      agentId: targetAgent.id,
      agentName: targetAgent.name,
      content: clarificationChat.content,
      createdAt: clarificationChat.createdAt,
    };
    request.status = 'RESPONDED';
    request.responseId = response.id;

    const artifacts = buildClarificationArtifacts({
      capabilityId,
      workItem,
      runDetail: detail,
      wait,
      request,
      response,
    });
    responseArtifact = artifacts.responseArtifact;

    const messages = buildApprovalInteractionMessages({
      capabilityId,
      workItemId: workItem.id,
      runId,
      workflowStepId: wait.runStepId,
      request,
      response,
      reviewerName: request.requestedBy,
      reviewerNote: note,
      responseModel,
    });
    await appendCapabilityMessageRecord(capabilityId, messages.requestMessage);
    if (messages.responseMessage) {
      const storedResponse = await appendCapabilityMessageRecord(
        capabilityId,
        messages.responseMessage,
      );
      response.messageId = storedResponse.messages[storedResponse.messages.length - 1]?.id;
    }

    await insertRunEvent(
      createRunEvent({
        capabilityId,
        runId,
        workItemId: workItem.id,
        runStepId: wait.runStepId,
        traceId: detail.run.traceId,
        spanId: wait.spanId,
        type: 'APPROVAL_CLARIFICATION_REQUESTED',
        level: 'WARN',
        message: `${request.requestedBy} requested clarification from ${targetAgent.name}.`,
        details: {
          waitId,
          targetAgentId,
          clarificationRequestId: request.id,
        },
      }),
    );
    await insertRunEvent(
      createRunEvent({
        capabilityId,
        runId,
        workItemId: workItem.id,
        runStepId: wait.runStepId,
        traceId: detail.run.traceId,
        spanId: wait.spanId,
        type: 'APPROVAL_CLARIFICATION_RESPONDED',
        level: 'INFO',
        message: `${targetAgent.name} responded with approval clarifications.`,
        details: {
          waitId,
          targetAgentId,
          clarificationRequestId: request.id,
          clarificationResponseId: response.id,
        },
      }),
    );

    const requestArtifacts = buildClarificationArtifacts({
      capabilityId,
      workItem,
      runDetail: detail,
      wait,
      request,
      response,
    });
    await persistApprovalClarificationState({
      capabilityId,
      workItem,
      wait,
      packet: approvalState.packet,
      clarificationRequests: waitingClarificationRequests,
      clarificationResponses: [...(approvalState.clarificationResponses || []), response],
      clarificationStatus: 'RESPONDED',
      request,
      response,
      requestArtifact: requestArtifacts.requestArtifact,
      responseArtifact: requestArtifacts.responseArtifact,
    });
  } catch (error) {
    request.status = 'FAILED';
    response = {
      id: createClarificationResponseId(),
      capabilityId,
      runId,
      waitId,
      requestId: request.id,
      agentId: targetAgent.id,
      agentName: targetAgent.name,
      content: '',
      createdAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Clarification generation failed.',
    };
    request.responseId = response.id;

    const requestArtifacts = buildClarificationArtifacts({
      capabilityId,
      workItem,
      runDetail: detail,
      wait,
      request,
    });
    await persistApprovalClarificationState({
      capabilityId,
      workItem,
      wait,
      packet: approvalState.packet,
      clarificationRequests: waitingClarificationRequests,
      clarificationResponses: [...(approvalState.clarificationResponses || []), response],
      clarificationStatus: 'FAILED',
      request,
      response,
      requestArtifact: requestArtifacts.requestArtifact,
      responseArtifact,
    });
  }

  const packet = await refreshApprovalStructuredPacket({
    capabilityId,
    runId,
    waitId,
  }).catch(() => undefined);
  if (packet) {
    const refreshedDetail = await getWorkflowRunDetail(capabilityId, runId);
    const refreshedWait = findApprovalWait(refreshedDetail, waitId);
    const refreshedState = getApprovalWorkspaceState(refreshedWait);
    await updateRunWaitPayload({
      capabilityId,
      waitId,
      payload: {
        ...(refreshedWait.payload || {}),
        approvalWorkspace: buildApprovalWorkspacePayload({
          existing: refreshedState,
          packet,
          clarificationRequests:
            refreshedState.clarificationRequests || waitingClarificationRequests,
          clarificationResponses:
            refreshedState.clarificationResponses ||
            (response ? [response] : approvalState.clarificationResponses || []),
          clarificationStatus: refreshedState.clarificationStatus || 'RESPONDED',
          activeClarificationRequestId: undefined,
        }),
      },
    });
  }

  return getApprovalWorkspaceContext({
    capabilityId,
    runId,
    waitId,
  });
};

export const __approvalWorkspaceTestUtils = {
  mineApprovalDeterministicSummary,
};
