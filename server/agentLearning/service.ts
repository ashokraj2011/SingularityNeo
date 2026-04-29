import type {
  ActorContext,
  AgentLearningProfile,
  AgentLearningProfileDetail,
  AgentLearningProfileVersion,
  AgentLearningStatus,
  AgentOperatingContract,
  Artifact,
  CapabilityAgent,
  LearningUpdate,
  Skill,
} from '../../src/types';
import { requestGitHubModel, resolveModelForProvider } from '../githubModels';
import {
  getCapabilityMemoryCorpus,
  listMemoryDocuments,
  rankMemoryCorpusByQuery,
  refreshCapabilityMemory,
} from '../memory';
import {
  addCapabilitySkillRecord,
  getCapabilityBundle,
  replaceCapabilityWorkspaceContentRecord,
  updateCapabilityAgentRecord,
} from '../repository';
import {
  executionRuntimeRpc,
  isRemoteExecutionClient,
} from '../execution/runtimeClient';
import {
  getWorkflowRunDetail,
  listWorkflowRunEvents,
} from '../execution/repository';
import {
  type AgentLearningJobRecord,
  activateAgentLearningProfileVersion,
  appendLearningUpdateRecord,
  bootstrapAgentEvalFixturesFromMessages,
  commitAgentLearningProfileVersion,
  countAgentEvalFixtures,
  getAgentLearningDriftContext,
  getAgentLearningProfile,
  getAgentLearningProfileVersion,
  incrementAgentLearningCanaryCounters,
  listAgentEvalFixtures,
  listAgentLearningProfileVersions,
  listAgentSessionSummaries,
  listAgentsNeedingLearning,
  markAgentLearningDriftFlag,
  markEvalFixturesUsed,
  queueAgentLearningJob,
  updateAgentLearningJob,
  updateAgentLearningProfileVersionJudge,
  upsertAgentLearningProfile,
  withAgentLearningLock,
  createOperatingPolicySnapshot,
} from './repository';
import { recordMetricSample } from '../telemetry';
import {
  estimateTokenCount,
  isQualityGateEnabled,
  runJudgeAgainstFixtures,
  runProfileShapeChecks,
  type JudgeReport,
  type ShapeCheckReport,
} from './qualityGate';
import {
  defaultDriftThresholds,
  evaluateAgentLearningDrift,
  isDriftDetectionEnabled,
  isDriftDryRun,
  type DriftThresholds,
} from './driftDetector';
import type { AgentLearningDriftState } from '../../src/types';
import { resolveAgentProviderKey } from '../providerRegistry';

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length > 2);

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const LEARNING_SUMMARY_TIMEOUT_MS = 90_000;
const GENERATED_DISTILLATION_SKILL_SUFFIX = 'EXPERIENCE-DISTILLATION';
const GENERATED_DISTILLATION_SECTION_LIMIT = 8;
const GENERATED_NOTE_LIMIT = 14;
const GENERATED_GUARDRAIL_LIMIT = 12;
type CapabilityBundle = Awaited<ReturnType<typeof getCapabilityBundle>>;

type LearningReflectionRequest =
  | {
      kind: 'EXPERIENCE_DISTILLATION';
      outcome: 'COMPLETED' | 'FAILED';
      workItemId?: string;
      runId?: string;
    }
  | {
      kind: 'INCIDENT_DERIVED';
      severity: string;
      incidentTitle?: string;
      packetBundleId?: string;
      workItemId?: string;
      runId?: string;
    }
  | {
      kind: 'USER_CORRECTION';
      workItemId?: string;
      runId?: string;
    };

type ExperienceDistillationResult = {
  summary: string;
  lessons: string[];
  guardrails: string[];
  skillAppendix: string;
  contextBlock?: string;
};

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

// ─────────────────────────────────────────────────────────────────────────
// Slice D — failure observability. Every silent `.catch(() => undefined)`
// in the pipeline gets replaced with `recordPipelineError(...)` so operators
// see a chip on the lens instead of the work disappearing. These helpers
// are module-private — callers pass the stage label and the error; nobody
// outside needs to stitch together update rows or metric samples by hand.
// ─────────────────────────────────────────────────────────────────────────

const LEARNING_PIPELINE_STAGE_LABELS: Record<string, string> = {
  'memory-refresh': 'memory-refresh',
  'memory-refresh-reflection': 'memory-refresh-reflection',
  'owner-fanout': 'owner-fanout',
  'provider-resolution': 'provider-resolution',
  'model-resolution': 'model-resolution',
  'judge-evaluation': 'judge-evaluation',
  'judge-persist': 'judge-persist',
  'judge-fixture-bootstrap': 'judge-fixture-bootstrap',
  'fixture-usage': 'fixture-usage',
  'drift-evaluation': 'drift-evaluation',
  'drift-audit-emit': 'drift-audit-emit',
  'correction-canary-bump': 'correction-canary-bump',
  'correction-lock': 'correction-lock',
  'revert-audit-emit': 'revert-audit-emit',
  'revert-memory-refresh': 'revert-memory-refresh',
  'lease-renew': 'lease-renew',
  'lease-release': 'lease-release',
  'llm-parse': 'llm-parse',
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
};

const errorCode = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'code' in (error as Record<string, unknown>)) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
};

export interface PipelineErrorContext {
  capabilityId: string;
  agentId?: string;
  stage: string;
  error: unknown;
  workItemId?: string;
  runId?: string;
}

/**
 * Writes a `PIPELINE_ERROR` learning-update row + emits a
 * `learning.pipeline_errors_count` metric sample. Never throws — we swallow
 * its own failure with a console.error because losing an audit row must
 * not break the caller. Stage labels are free-form but we expose a canonical
 * set in LEARNING_PIPELINE_STAGE_LABELS for discoverability.
 */
export const recordPipelineError = async ({
  capabilityId,
  agentId,
  stage,
  error,
  workItemId,
  runId,
}: PipelineErrorContext): Promise<void> => {
  const message = errorMessage(error);
  const code = errorCode(error);
  const suffix = code ? ` [${code}]` : '';
  const label = LEARNING_PIPELINE_STAGE_LABELS[stage] || stage;
  const insight = `Pipeline error in ${label}: ${message}${suffix}`;
  console.error(`[learning.pipeline] ${label} failed for ${capabilityId}/${agentId || '-'}: ${message}${suffix}`);
  try {
    if (agentId) {
      await appendLearningUpdateRecord({
        capabilityId,
        agentId,
        insight,
        triggerType: 'PIPELINE_ERROR',
        timestamp: new Date().toISOString(),
        relatedWorkItemId: workItemId,
        relatedRunId: runId,
      });
    }
  } catch (auditError) {
    // Audit row failure is logged but not propagated. We've already surfaced
    // the original error via console.error above.
    console.error(
      `[learning.pipeline] Failed to persist PIPELINE_ERROR audit row for ${capabilityId}: ${errorMessage(auditError)}`,
    );
  }
  try {
    await recordMetricSample({
      capabilityId,
      scopeType: 'AGENT',
      scopeId: agentId || '-',
      metricName: 'learning.pipeline_errors_count',
      metricValue: 1,
      unit: 'count',
      tags: { stage: label, code: code || null },
    });
  } catch {
    // Metric emission is best-effort; the console.error above is the SLO
    // backstop.
  }
};

/**
 * Emits the lock-wait latency metric. Kept separate so the advisory-lock
 * helper in the repository can stay telemetry-agnostic. Success path still
 * pings the metric so we can track p50/p99 under normal traffic, not just
 * the rare contention case.
 */
const recordLearningLockWait = async (
  capabilityId: string,
  agentId: string,
  lockWaitMs: number,
  outcome: 'acquired' | 'timeout',
): Promise<void> => {
  try {
    await recordMetricSample({
      capabilityId,
      scopeType: 'AGENT',
      scopeId: agentId,
      metricName: 'learning.lock_wait_ms',
      metricValue: Math.max(0, lockWaitMs),
      unit: 'ms',
      tags: { outcome },
    });
  } catch {
    // Best-effort.
  }
};

const EXPERIENCE_DISTILLATION_PREFIX = 'experience-distillation';
const INCIDENT_DERIVED_PREFIX = 'incident-derived';
const USER_CORRECTION_PREFIX = 'learning-correction';
const CAPABILITY_WIDE_LEARNING_REASONS = new Set([
  'capability-created',
  'capability-updated',
  'capability-skill-added',
  'capability-skill-removed',
  'capability-contract-published',
  'workspace-content-updated',
  'manual-memory-refresh',
  'memory-refresh',
  'work-item-uploaded',
]);

const mergeUniqueStrings = (values: Array<string | undefined>, limit: number) =>
  unique(
    values
      .map(value => value?.trim())
      .filter((value): value is string => Boolean(value)),
  ).slice(0, limit);

const buildExperienceDistillationReason = ({
  outcome,
  workItemId,
  runId,
}: {
  outcome: 'COMPLETED' | 'FAILED';
  workItemId?: string;
  runId?: string;
}) =>
  [EXPERIENCE_DISTILLATION_PREFIX, outcome, workItemId || '', runId || ''].join(':');

const buildLearningCorrectionReason = ({
  workItemId,
  runId,
}: {
  workItemId?: string;
  runId?: string;
}) => [USER_CORRECTION_PREFIX, workItemId || '', runId || ''].join(':');

const buildIncidentDerivedReason = ({
  severity,
  incidentTitle,
  packetBundleId,
  workItemId,
  runId,
}: {
  severity: string;
  incidentTitle?: string;
  packetBundleId?: string;
  workItemId?: string;
  runId?: string;
}) =>
  [
    INCIDENT_DERIVED_PREFIX,
    severity || '',
    encodeURIComponent(incidentTitle || ''),
    packetBundleId || '',
    workItemId || '',
    runId || '',
  ].join(':');

const parseLearningReflectionRequest = (
  requestReason: string,
): LearningReflectionRequest | null => {
  const parts = requestReason.split(':');

  if (parts[0] === EXPERIENCE_DISTILLATION_PREFIX) {
    const outcome = parts[1] === 'FAILED' ? 'FAILED' : parts[1] === 'COMPLETED' ? 'COMPLETED' : null;
    if (!outcome) {
      return null;
    }

    return {
      kind: 'EXPERIENCE_DISTILLATION',
      outcome,
      workItemId: parts[2] || undefined,
      runId: parts[3] || undefined,
    };
  }

  if (parts[0] === INCIDENT_DERIVED_PREFIX) {
    return {
      kind: 'INCIDENT_DERIVED',
      severity: parts[1] || 'SEV1',
      incidentTitle: parts[2] ? decodeURIComponent(parts[2]) : undefined,
      packetBundleId: parts[3] || undefined,
      workItemId: parts[4] || undefined,
      runId: parts[5] || undefined,
    };
  }

  if (parts[0] === USER_CORRECTION_PREFIX) {
    return {
      kind: 'USER_CORRECTION',
      workItemId: parts[1] || undefined,
      runId: parts[2] || undefined,
    };
  }

  return null;
};

const isCapabilityWideLearningReason = (requestReason: string) => {
  if (!requestReason.trim()) {
    return false;
  }
  if (parseLearningReflectionRequest(requestReason)) {
    return false;
  }
  if (
    requestReason === 'manual-agent-refresh' ||
    requestReason === 'startup-backfill' ||
    requestReason.startsWith('agent-learning:') ||
    requestReason.startsWith('agent-learning-reflection:') ||
    requestReason.startsWith('agent-learning-revert:')
  ) {
    return false;
  }
  return (
    CAPABILITY_WIDE_LEARNING_REASONS.has(requestReason) ||
    requestReason.startsWith('capability-')
  );
};

const findOwnerAgent = (agents: CapabilityAgent[]) =>
  agents.find(current => current.isOwner) ||
  agents.find(current => current.roleStarterKey === 'OWNER') ||
  agents[0];

const createGeneratedDistillationSkillId = (agentId: string) =>
  `SKILL-${agentId}-${GENERATED_DISTILLATION_SKILL_SUFFIX}`;

const createGeneratedDistillationArtifactId = (agentId: string, runId?: string, workItemId?: string) =>
  `ART-LEARN-${agentId}-${runId || workItemId || 'CAPABILITY'}`;

const hasUsableLearningProfile = (profile: AgentLearningProfileDetail['profile']) =>
  Boolean(
    profile.summary?.trim() ||
      profile.contextBlock?.trim() ||
      profile.highlights?.length ||
      profile.sourceCount ||
      profile.refreshedAt,
  );

const extractJsonObject = (value: string) => {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Learning summarizer did not return JSON.');
  }

  return JSON.parse(value.slice(start, end + 1)) as {
    summary?: string;
    highlights?: string[];
    contextBlock?: string;
  };
};

const buildArtifactSummary = (summary: string, lessons: string[]) =>
  [summary.trim(), ...lessons.slice(0, 2)].filter(Boolean).join(' ').slice(0, 360);

const buildDistillationSection = ({
  outcome,
  workItemTitle,
  workItemId,
  runId,
  generatedAt,
  lessons,
  guardrails,
}: {
  outcome: 'COMPLETED' | 'FAILED';
  workItemTitle?: string;
  workItemId?: string;
  runId?: string;
  generatedAt: string;
  lessons: string[];
  guardrails: string[];
}) => {
  const headingParts = [
    workItemTitle?.trim() || workItemId || 'Capability reflection',
    outcome === 'FAILED' ? 'Failed attempt' : 'Completed attempt',
    new Date(generatedAt).toLocaleDateString('en-CA'),
  ].filter(Boolean);

  return [
    `<!-- distillation:${runId || workItemId || generatedAt} -->`,
    `## ${headingParts.join(' · ')}`,
    '',
    ...lessons.map(item => `- ${item}`),
    ...(guardrails.length > 0
      ? ['', '### Guardrails to keep next time', '', ...guardrails.map(item => `- ${item}`)]
      : []),
  ].join('\n');
};

const appendGeneratedSkillSection = ({
  currentMarkdown,
  nextSection,
  marker,
}: {
  currentMarkdown?: string;
  nextSection: string;
  marker: string;
}) => {
  const base = currentMarkdown?.trim() || '# Experience Distillation\n';
  if (base.includes(marker)) {
    return base;
  }

  const sections = base
    .split(/\n(?=## )/g)
    .map(section => section.trim())
    .filter(Boolean);
  const [header, ...existingSections] =
    sections[0]?.startsWith('# ') ? sections : ['# Experience Distillation', ...sections];

  return [header, nextSection, ...existingSections.slice(0, GENERATED_DISTILLATION_SECTION_LIMIT - 1)]
    .filter(Boolean)
    .join('\n\n')
    .trim();
};

const buildReflectionArtifactMarkdown = ({
  capabilityName,
  agent,
  request,
  workItemTitle,
  generatedAt,
  summary,
  lessons,
  guardrails,
  corrections,
}: {
  capabilityName: string;
  agent: CapabilityAgent;
  request: LearningReflectionRequest;
  workItemTitle?: string;
  generatedAt: string;
  summary: string;
  lessons: string[];
  guardrails: string[];
  corrections: string[];
}) => [
  '# Lessons Learned',
  '',
  `- Capability: ${capabilityName}`,
  `- Agent: ${agent.name}`,
  `- Outcome: ${
    request.kind === 'EXPERIENCE_DISTILLATION'
      ? request.outcome
      : request.kind === 'INCIDENT_DERIVED'
      ? `Incident-derived reflection (${request.severity})`
      : 'User correction applied'
  }`,
  `- Work item: ${workItemTitle || request.workItemId || 'Capability context'}`,
  `- Run: ${request.runId || 'Not scoped'}`,
  `- Generated at: ${generatedAt}`,
  ...(request.kind === 'INCIDENT_DERIVED' && request.incidentTitle
    ? [`- Incident: ${request.incidentTitle}`, `- Evidence packet: ${request.packetBundleId || 'Not scoped'}`]
    : []),
  '',
  '## Summary',
  '',
  summary,
  '',
  '## Distilled lessons',
  '',
  ...lessons.map(item => `- ${item}`),
  ...(guardrails.length > 0
    ? ['', '## Operating contract guardrails', '', ...guardrails.map(item => `- ${item}`)]
    : []),
  ...(corrections.length > 0
    ? ['', '## Operator corrections', '', ...corrections.map(item => `- ${item}`)]
    : []),
].join('\n');

const buildExperienceDistillationArtifact = ({
  capabilityId,
  capabilityName,
  agent,
  request,
  workItemTitle,
  generatedAt,
  summary,
  lessons,
  guardrails,
  corrections,
}: {
  capabilityId: string;
  capabilityName: string;
  agent: CapabilityAgent;
  request: LearningReflectionRequest;
  workItemTitle?: string;
  generatedAt: string;
  summary: string;
  lessons: string[];
  guardrails: string[];
  corrections: string[];
}): Artifact => ({
  id: createGeneratedDistillationArtifactId(agent.id, request.runId, request.workItemId),
  name: `${agent.name} Lessons Learned`,
  capabilityId,
  type: 'Experience Distillation',
  version: request.runId || request.workItemId || 'capability',
  agent: agent.id,
  created: generatedAt,
  direction: 'OUTPUT',
  connectedAgentId: agent.id,
  runId: request.runId,
  summary: buildArtifactSummary(summary, lessons),
  artifactKind: 'LEARNING_NOTE',
  phase: undefined,
  workItemId: request.workItemId,
  contentFormat: 'MARKDOWN',
  mimeType: 'text/markdown',
  fileName: `${(request.workItemId || agent.id).toLowerCase()}-lessons-learned.md`,
  contentText: buildReflectionArtifactMarkdown({
    capabilityName,
    agent,
    request,
    workItemTitle,
    generatedAt,
    summary,
    lessons,
    guardrails,
    corrections,
  }),
  downloadable: true,
});

const buildAgentKeywordSet = (
  agent: CapabilityAgent,
  skills: Skill[] = [],
) =>
  new Set(
    unique(
      [
        agent.name,
        agent.role,
        agent.objective,
        agent.systemPrompt,
        ...(agent.skillIds || []),
        ...skills.flatMap(skill => [
          skill.name,
          skill.description,
          skill.contentMarkdown,
          ...(skill.defaultTemplateKeys || []),
        ]),
        ...(agent.learningNotes || []),
        ...(agent.documentationSources || []),
        ...(agent.inputArtifacts || []),
        ...(agent.outputArtifacts || []),
        agent.contract?.description,
        ...(agent.contract?.primaryResponsibilities || []),
        ...(agent.contract?.workingApproach || []),
        ...(agent.contract?.preferredOutputs || []),
        ...(agent.contract?.guardrails || []),
        ...(agent.contract?.conflictResolution || []),
        agent.contract?.definitionOfDone,
        ...(agent.contract?.suggestedInputArtifacts || []).flatMap(expectation => [
          expectation.artifactName,
          expectation.description,
        ]),
        ...(agent.contract?.expectedOutputArtifacts || []).flatMap(expectation => [
          expectation.artifactName,
          expectation.description,
        ]),
      ].flatMap(value => tokenize(value || '')),
    ),
  );

const summarizeContract = (contract?: AgentOperatingContract) => {
  if (!contract) {
    return 'No structured agent contract was available.';
  }

  return [
    contract.description ? `Description: ${contract.description}` : null,
    contract.primaryResponsibilities.length
      ? `Responsibilities: ${contract.primaryResponsibilities.join(' | ')}`
      : null,
    contract.workingApproach.length
      ? `Working approach: ${contract.workingApproach.join(' | ')}`
      : null,
    contract.preferredOutputs.length
      ? `Preferred outputs: ${contract.preferredOutputs.join(' | ')}`
      : null,
    contract.guardrails.length ? `Guardrails: ${contract.guardrails.join(' | ')}` : null,
    contract.conflictResolution.length
      ? `Conflict resolution: ${contract.conflictResolution.join(' | ')}`
      : null,
    contract.definitionOfDone ? `Definition of done: ${contract.definitionOfDone}` : null,
  ]
    .filter(Boolean)
    .join('\n');
};

const buildAgentRoleFocusHighlights = (
  agent: CapabilityAgent,
  skills: Skill[] = [],
) =>
  mergeUniqueStrings(
    [
      ...((agent.contract?.primaryResponsibilities || []).map(item => `Responsibility: ${item}`)),
      ...((agent.contract?.guardrails || []).map(item => `Guardrail: ${item}`)),
      ...skills.map(skill => `Attached skill: ${skill.name}`),
      ...(agent.learningNotes || []).map(item => `Learned note: ${item}`),
    ],
    6,
  );

const buildDerivedAgentLearningProfile = ({
  ownerAgent,
  ownerProfile,
  ownerVersionId,
  agent,
  skills,
  requestedAt,
}: {
  ownerAgent: CapabilityAgent;
  ownerProfile: AgentLearningProfile;
  ownerVersionId?: string;
  agent: CapabilityAgent;
  skills: Skill[];
  requestedAt: string;
}): AgentLearningProfile => {
  const roleFocus = buildAgentRoleFocusHighlights(agent, skills);
  const summaryParts = [
    `${agent.name} inherits the shared capability learning curated by ${ownerAgent.name} for the ${agent.role} role.`,
    ownerProfile.summary.trim(),
    roleFocus.length > 0
      ? `Primary role focus: ${roleFocus
          .slice(0, 3)
          .map(item => item.replace(/^[A-Za-z ]+:\s*/, '').trim())
          .join('; ')}.`
      : null,
  ].filter(Boolean);

  const contextSections = [
    'Shared capability context:',
    ownerProfile.contextBlock.trim() || ownerProfile.summary.trim(),
    '',
    `Agent-specific focus for ${agent.name} (${agent.role}):`,
    summarizeContract(agent.contract) || 'No structured contract was available.',
    skills.length > 0
      ? `Attached skills: ${skills.map(skill => skill.name).join(', ')}`
      : null,
    agent.learningNotes?.length
      ? `Learning notes: ${agent.learningNotes.join(' | ')}`
      : null,
  ].filter(Boolean);

  return {
    status: 'READY',
    summary: summaryParts.join(' ').trim(),
    highlights: mergeUniqueStrings(
      [...roleFocus, ...ownerProfile.highlights],
      8,
    ),
    contextBlock: contextSections.join('\n'),
    sourceDocumentIds: [...ownerProfile.sourceDocumentIds],
    sourceArtifactIds: [...ownerProfile.sourceArtifactIds],
    sourceCount: ownerProfile.sourceCount,
    derivationMode: 'OWNER_DERIVED',
    derivedFromAgentId: ownerAgent.id,
    sourceVersionId: ownerVersionId,
    refreshedAt: new Date().toISOString(),
    lastRequestedAt: requestedAt,
  };
};

const fanOutCapabilityLearningFromOwner = async ({
  bundle,
  ownerAgent,
  ownerProfile,
  ownerVersion,
  requestedAt,
  requestReason,
}: {
  bundle: CapabilityBundle;
  ownerAgent: CapabilityAgent;
  ownerProfile: AgentLearningProfile;
  ownerVersion: AgentLearningProfileVersion;
  requestedAt: string;
  requestReason: string;
}) => {
  for (const agent of bundle.workspace.agents) {
    if (agent.id === ownerAgent.id) {
      continue;
    }

    const attachedSkills = bundle.capability.skillLibrary.filter(skill =>
      agent.skillIds.includes(skill.id),
    );
    const derivedProfile = buildDerivedAgentLearningProfile({
      ownerAgent,
      ownerProfile,
      ownerVersionId: ownerVersion.versionId,
      agent,
      skills: attachedSkills,
      requestedAt,
    });

    await commitAgentLearningProfileVersion({
      capabilityId: bundle.capability.id,
      agentId: agent.id,
      profile: derivedProfile,
      contextBlockTokens: estimateTokenCount(derivedProfile.contextBlock),
      notes: `${requestReason} (derived from ${ownerAgent.id}:${ownerVersion.versionId})`,
    });
  }
};

const rankCorpusForAgent = async (
  capabilityId: string,
  agent: CapabilityAgent,
  corpus: Awaited<ReturnType<typeof getCapabilityMemoryCorpus>>,
  skills: Skill[] = [],
) => {
  const keywords = buildAgentKeywordSet(agent, skills);
  const queryText = [
    agent.name,
    agent.role,
    agent.objective,
    ...(agent.inputArtifacts || []),
    ...(agent.outputArtifacts || []),
    ...(agent.learningNotes || []),
    ...(agent.documentationSources || []),
    ...Array.from(keywords).slice(0, 40),
  ]
    .filter(Boolean)
    .join('\n');

  return rankMemoryCorpusByQuery({
    corpus,
    queryText: `${capabilityId}\n${queryText}`,
  });
};

export const __agentLearningTestUtils = {
  buildExperienceDistillationReason,
  buildLearningCorrectionReason,
  parseLearningReflectionRequest,
  isCapabilityWideLearningReason,
  buildDerivedAgentLearningProfile,
  appendGeneratedSkillSection,
  mergeUniqueStrings,
  rankCorpusForAgent,
};

const summarizeAgentLearning = async ({
  agent,
  selectedCorpus,
  skills,
}: {
  agent: CapabilityAgent;
  selectedCorpus: Awaited<ReturnType<typeof getCapabilityMemoryCorpus>>;
  skills: Skill[];
}) => {
  const payload = selectedCorpus
    .map((item, index) =>
      [
        `[Source ${index + 1}] ${item.document.title}`,
        `Type: ${item.document.sourceType} / ${item.document.tier}`,
        `Preview: ${item.document.contentPreview}`,
        `Content: ${item.combinedContent.slice(0, 1800)}`,
      ].join('\n'),
    )
    .join('\n\n');

  const learningProviderKey = resolveAgentProviderKey(agent);
  const response = await requestGitHubModel({
    model: resolveModelForProvider(learningProviderKey, agent.model),
    providerKey: learningProviderKey,
    timeoutMs: LEARNING_SUMMARY_TIMEOUT_MS,
    messages: [
      {
        role: 'system',
        content:
          'You build concise learning profiles for enterprise delivery agents. Return strict JSON only.',
      },
      {
        role: 'user',
        content: [
          `Agent name: ${agent.name}`,
          `Agent role: ${agent.role}`,
          `Objective: ${agent.objective}`,
          `Input artifacts: ${(agent.inputArtifacts || []).join(', ') || 'None'}`,
          `Output artifacts: ${(agent.outputArtifacts || []).join(', ') || 'None'}`,
          `Documentation sources: ${(agent.documentationSources || []).join(', ') || 'None'}`,
          `Preferred tools: ${(agent.preferredToolIds || []).join(', ') || 'None'}`,
          `Structured contract:\n${summarizeContract(agent.contract)}`,
          '',
          'Attached skill content:',
          ...(skills.length > 0
            ? skills.map(
                skill =>
                  `- ${skill.name} (${skill.kind}/${skill.origin}): ${(skill.contentMarkdown || skill.description).slice(0, 1200)}`,
              )
            : ['- None']),
          '',
          'Using the source material below, produce JSON with this shape:',
          '{"summary":"...","highlights":["..."],"contextBlock":"..."}',
          '',
          'Rules:',
          '- summary: 2-3 sentences',
          '- highlights: 5 to 8 short bullets as strings',
          '- contextBlock: a compact reusable context block for future Copilot sessions',
          '- focus on capability-specific knowledge, constraints, artifacts, and operating context',
          '- do not invent facts outside the sources',
          '',
          payload,
        ].join('\n'),
      },
    ],
  });

  return extractJsonObject(response.content);
};

const summarizeExperienceDistillation = async ({
  agent,
  skills,
  request,
  tracePayload,
}: {
  agent: CapabilityAgent;
  skills: Skill[];
  request: LearningReflectionRequest;
  tracePayload: string;
}): Promise<ExperienceDistillationResult> => {
  const reflectionProviderKey = resolveAgentProviderKey(agent);
  const response = await requestGitHubModel({
    model: resolveModelForProvider(reflectionProviderKey, agent.model),
    providerKey: reflectionProviderKey,
    timeoutMs: LEARNING_SUMMARY_TIMEOUT_MS,
    messages: [
      {
        role: 'system',
        content:
          'You are a reflector agent. Study execution traces, human feedback, and operator corrections. Return strict JSON only.',
      },
      {
        role: 'user',
        content: [
          `Agent name: ${agent.name}`,
          `Agent role: ${agent.role}`,
          `Objective: ${agent.objective}`,
          `Reflection trigger: ${
            request.kind === 'EXPERIENCE_DISTILLATION'
              ? request.outcome
              : request.kind === 'INCIDENT_DERIVED'
              ? `INCIDENT_DERIVED ${request.severity}`
              : 'USER_CORRECTION'
          }`,
          ...(request.kind === 'INCIDENT_DERIVED'
            ? [
                `Critical incident: ${request.incidentTitle || 'Linked production incident'}`,
                `Evidence packet: ${request.packetBundleId || 'Not provided'}`,
                'Treat this as a high-priority reflection. Emphasize guardrails that would have prevented recurrence.',
              ]
            : []),
          `Structured contract:\n${summarizeContract(agent.contract)}`,
          '',
          'Attached skills:',
          ...(skills.length > 0
            ? skills.map(
                skill =>
                  `- ${skill.name}: ${(skill.contentMarkdown || skill.description).slice(0, 900)}`,
              )
            : ['- None']),
          '',
          'Return JSON with this shape:',
          '{"summary":"...","lessons":["..."],"guardrails":["..."],"skillAppendix":"...","contextBlock":"..."}',
          '',
          'Rules:',
          '- lessons must contain exactly 3 non-obvious, concrete bullets that would have improved first-pass success',
          '- prefer nuances, edge cases, undocumented rules, or operator corrections over generic advice',
          '- if user corrections are present, treat them as authoritative',
          '- guardrails should be concise, durable, and safe to add to an operating contract',
          '- skillAppendix should be short markdown bullets suitable for appending to a skill document',
          '- do not invent facts that are not supported by the trace',
          '',
          tracePayload,
        ].join('\n'),
      },
    ],
  });

  const parsed = extractJsonObject(response.content) as {
    summary?: string;
    lessons?: string[];
    guardrails?: string[];
    skillAppendix?: string;
    contextBlock?: string;
  };

  return {
    summary: parsed.summary?.trim() || `${agent.name} completed an experience distillation refresh.`,
    lessons: mergeUniqueStrings(parsed.lessons || [], 3),
    guardrails: mergeUniqueStrings(parsed.guardrails || [], 3),
    skillAppendix: parsed.skillAppendix?.trim() || '',
    contextBlock: parsed.contextBlock?.trim() || undefined,
  };
};

const buildExperienceTracePayload = async ({
  bundle,
  agent,
  skills,
  request,
}: {
  bundle: CapabilityBundle;
  agent: CapabilityAgent;
  skills: Skill[];
  request: LearningReflectionRequest;
}) => {
  const workItem = request.workItemId
    ? bundle.workspace.workItems.find(item => item.id === request.workItemId)
    : undefined;
  const detail = request.runId
    ? await getWorkflowRunDetail(bundle.capability.id, request.runId).catch(() => null)
    : null;
  const events = request.runId
    ? await listWorkflowRunEvents(bundle.capability.id, request.runId).catch(() => [])
    : [];
  const logs = bundle.workspace.executionLogs
    .filter(
      log =>
        (request.runId && log.runId === request.runId) ||
        (request.workItemId && log.taskId === request.workItemId),
    )
    .slice(-18);
  const artifacts = bundle.workspace.artifacts
    .filter(
      artifact =>
        (request.runId && artifact.runId === request.runId) ||
        (request.workItemId && artifact.workItemId === request.workItemId),
    )
    .slice(-10);
  const messages = bundle.workspace.messages
    .filter(
      message =>
        (request.runId && message.runId === request.runId) ||
        (request.workItemId && message.workItemId === request.workItemId),
    )
    .slice(-10);
  const corrections = bundle.workspace.learningUpdates
    .filter(
      update =>
        update.agentId === agent.id &&
        update.triggerType === 'USER_CORRECTION' &&
        (!request.workItemId || update.relatedWorkItemId === request.workItemId) &&
        (!request.runId || update.relatedRunId === request.runId),
    )
    .slice(-6);
  const humanFeedback = bundle.workspace.learningUpdates
    .filter(
      update =>
        update.agentId === agent.id &&
        ['REQUEST_CHANGES', 'GUIDANCE', 'STAGE_CONTROL', 'CONFLICT_RESOLUTION', 'USER_CORRECTION'].includes(
          update.triggerType || '',
        ) &&
        (!request.workItemId || update.relatedWorkItemId === request.workItemId) &&
        (!request.runId || update.relatedRunId === request.runId),
    )
    .slice(-10);

  const tracePayload = [
    `Capability: ${bundle.capability.name}`,
    `Agent: ${agent.name}`,
    `Objective: ${workItem?.title || agent.objective}`,
    workItem?.description ? `Work item description: ${workItem.description}` : null,
    detail?.run.terminalOutcome ? `Run outcome: ${detail.run.terminalOutcome}` : null,
    '',
    'Attached skill excerpts:',
    ...(skills.length > 0
      ? skills.map(
          skill => `- ${skill.name}: ${(skill.contentMarkdown || skill.description).slice(0, 500)}`,
        )
      : ['- None']),
    '',
    'Workflow events:',
    ...(events.length > 0
      ? events.slice(-16).map(
          event => `- [${event.type}] ${event.message}${event.runStepId ? ` (step ${event.runStepId})` : ''}`,
        )
      : ['- None']),
    '',
    'Execution logs:',
    ...(logs.length > 0
      ? logs.map(log => `- [${log.level}] ${log.message}`)
      : ['- None']),
    '',
    'Tool activity:',
    ...(detail?.toolInvocations?.length
      ? detail.toolInvocations.slice(-10).map(
          tool =>
            `- ${tool.toolId} (${tool.status})${tool.resultSummary ? `: ${tool.resultSummary}` : ''}${tool.stderrPreview ? ` | stderr: ${tool.stderrPreview.slice(0, 180)}` : ''}`,
        )
      : ['- None']),
    '',
    'Human feedback and corrections:',
    ...(humanFeedback.length > 0
      ? humanFeedback.map(
          update => `- [${update.triggerType}] ${update.insight}${update.skillUpdate ? ` | skill update: ${update.skillUpdate}` : ''}`,
        )
      : ['- None']),
    '',
    'Conversation context:',
    ...(messages.length > 0
      ? messages.map(message => `- [${message.role}] ${message.content.slice(0, 220)}`)
      : ['- None']),
    '',
    'Artifacts produced:',
    ...(artifacts.length > 0
      ? artifacts.map(
          artifact =>
            `- ${artifact.name}${artifact.summary ? `: ${artifact.summary}` : ''}${artifact.artifactKind ? ` (${artifact.artifactKind})` : ''}`,
        )
      : ['- None']),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    tracePayload,
    workItemTitle: workItem?.title,
    corrections: corrections.map(update => update.insight),
  };
};

const applyExperienceDistillation = async ({
  bundle,
  agent,
  request,
  result,
  generatedAt,
  workItemTitle,
  corrections,
}: {
  bundle: CapabilityBundle;
  agent: CapabilityAgent;
  request: LearningReflectionRequest;
  result: ExperienceDistillationResult;
  generatedAt: string;
  workItemTitle?: string;
  corrections: string[];
}) => {
  const capabilityId = bundle.capability.id;
  const skillId = createGeneratedDistillationSkillId(agent.id);
  const sectionMarker = `<!-- distillation:${request.runId || request.workItemId || generatedAt} -->`;
  const existingSkill = bundle.capability.skillLibrary.find(skill => skill.id === skillId);
  const nextSection = buildDistillationSection({
    outcome:
      request.kind === 'EXPERIENCE_DISTILLATION'
        ? request.outcome
        : request.kind === 'INCIDENT_DERIVED'
        ? 'FAILED'
        : 'COMPLETED',
    workItemTitle,
    workItemId: request.workItemId,
    runId: request.runId,
    generatedAt,
    lessons: result.lessons,
    guardrails: result.guardrails,
  });

  await addCapabilitySkillRecord(capabilityId, {
    id: skillId,
    name: `${agent.name} Experience Distillation`,
    description: `Generated lessons and edge cases distilled from ${agent.name} execution traces.`,
    category: 'Analysis',
    version: existingSkill?.version || '1.0.0',
    kind: 'CUSTOM',
    origin: 'CAPABILITY',
    defaultTemplateKeys: agent.roleStarterKey ? [agent.roleStarterKey] : [],
    contentMarkdown: appendGeneratedSkillSection({
      currentMarkdown: existingSkill?.contentMarkdown,
      nextSection,
      marker: sectionMarker,
    }),
  });

  await updateCapabilityAgentRecord(capabilityId, agent.id, {
    learningNotes: mergeUniqueStrings(
      [...(agent.learningNotes || []), ...result.lessons, ...corrections],
      GENERATED_NOTE_LIMIT,
    ),
    skillIds: mergeUniqueStrings([...(agent.skillIds || []), skillId], 64),
    contract: {
      ...agent.contract,
      guardrails: mergeUniqueStrings(
        [...(agent.contract?.guardrails || []), ...result.guardrails],
        GENERATED_GUARDRAIL_LIMIT,
      ),
    },
  });
  const latestBundle = await getCapabilityBundle(capabilityId);

  await createOperatingPolicySnapshot(
    capabilityId,
    latestBundle.capability.operatingPolicySummary || '',
    undefined,
    undefined
  );

  const artifact = buildExperienceDistillationArtifact({
    capabilityId,
    capabilityName: latestBundle.capability.name,
    agent,
    request,
    workItemTitle,
    generatedAt,
    summary: result.summary,
    lessons: result.lessons,
    guardrails: result.guardrails,
    corrections,
  });

  const nextLearningUpdate: LearningUpdate = {
    id: createId('LEARN'),
    capabilityId,
    agentId: agent.id,
    sourceLogIds: [],
    insight: result.lessons.join(' ').trim() || result.summary,
    skillUpdate: result.skillAppendix || nextSection,
    timestamp: generatedAt,
    triggerType:
      request.kind === 'USER_CORRECTION'
        ? 'USER_CORRECTION'
        : request.kind === 'INCIDENT_DERIVED'
        ? 'INCIDENT_DERIVED'
        : 'EXPERIENCE_DISTILLATION',
    relatedWorkItemId: request.workItemId,
    relatedRunId: request.runId,
  };

  await replaceCapabilityWorkspaceContentRecord(capabilityId, {
    artifacts: [
      ...latestBundle.workspace.artifacts.filter(item => item.id !== artifact.id),
      artifact,
    ],
    learningUpdates: [...latestBundle.workspace.learningUpdates, nextLearningUpdate],
  });

  return artifact;
};

export const queueCapabilityAgentLearningRefresh = async (
  capabilityId: string,
  requestReason: string,
) => {
  const bundle = await getCapabilityBundle(capabilityId);
  const ownerAgent = findOwnerAgent(bundle.workspace.agents);
  if (!ownerAgent) {
    return;
  }
  await queueAgentLearningJob({
    capabilityId,
    agentId: ownerAgent.id,
    requestReason,
    makeStale: true,
  });
};

export const queueSingleAgentLearningRefresh = async (
  capabilityId: string,
  agentId: string,
  requestReason: string,
) =>
  isRemoteExecutionClient()
    ? executionRuntimeRpc<void>('queueSingleAgentLearningRefresh', {
        capabilityId,
        agentId,
        requestReason,
      })
    :
  queueAgentLearningJob({
    capabilityId,
    agentId,
    requestReason,
    makeStale: true,
  });

export const queueExperienceDistillationRefresh = async ({
  capabilityId,
  agentId,
  outcome,
  workItemId,
  runId,
}: {
  capabilityId: string;
  agentId: string;
  outcome: 'COMPLETED' | 'FAILED';
  workItemId?: string;
  runId?: string;
}) =>
  queueSingleAgentLearningRefresh(
    capabilityId,
    agentId,
    buildExperienceDistillationReason({
      outcome,
      workItemId,
      runId,
    }),
  );

export const queueIncidentDerivedLearningRefresh = async ({
  capabilityId,
  agentId,
  incident,
  packetBundleId,
  workItemId,
  runId,
}: {
  capabilityId: string;
  agentId: string;
  incident: {
    title: string;
    severity: string;
  };
  packetBundleId: string;
  workItemId?: string;
  runId?: string;
}) =>
  queueSingleAgentLearningRefresh(
    capabilityId,
    agentId,
    buildIncidentDerivedReason({
      severity: incident.severity,
      incidentTitle: incident.title,
      packetBundleId,
      workItemId,
      runId,
    }),
  );

export const applyAgentLearningCorrection = async ({
  capabilityId,
  agentId,
  correction,
  workItemId,
  runId,
  actor,
}: {
  capabilityId: string;
  agentId: string;
  correction: string;
  workItemId?: string;
  runId?: string;
  actor: ActorContext;
}) => {
  const trimmedCorrection = correction.trim();
  if (!trimmedCorrection) {
    throw new Error('Add a learning correction before saving it.');
  }

  // Slice D — serialize concurrent corrections against the same (capability,
  // agent) pair via a Postgres advisory transaction lock. The long-lived
  // work (memory refresh + queue enqueue) runs AFTER the lock releases so a
  // short critical section just covers the state writes that would
  // otherwise race. On timeout we surface a PIPELINE_ERROR update + retry
  // via the existing job queue.
  let lockWaitMs = 0;
  try {
    const locked = await withAgentLearningLock(
      { capabilityId, agentId, attempts: 3, delayMs: 50 },
      async () => {
        const bundle = await getCapabilityBundle(capabilityId);
        const agent = bundle.workspace.agents.find(current => current.id === agentId);
        if (!agent) {
          throw new Error(`Agent ${agentId} was not found in capability ${capabilityId}.`);
        }

        const timestamp = new Date().toISOString();
        const nextUpdate: LearningUpdate = {
          id: createId('LEARN'),
          capabilityId,
          agentId,
          sourceLogIds: [],
          insight: `${actor.displayName} corrected ${agent.name}'s learning: ${trimmedCorrection}`,
          timestamp,
          triggerType: 'USER_CORRECTION',
          relatedWorkItemId: workItemId,
          relatedRunId: runId,
        };

        await updateCapabilityAgentRecord(capabilityId, agentId, {
          learningNotes: mergeUniqueStrings(
            [...(agent.learningNotes || []), `Operator correction: ${trimmedCorrection}`],
            GENERATED_NOTE_LIMIT,
          ),
        });
        // Slice D — write the USER_CORRECTION audit row via the append-only
        // helper so we don't DELETE + bulk-INSERT every row in the capability
        // on every correction (that's what the legacy replace path did and
        // it was the race window that motivated this lock).
        await appendLearningUpdateRecord({
          capabilityId,
          agentId,
          id: nextUpdate.id,
          insight: nextUpdate.insight,
          triggerType: 'USER_CORRECTION',
          timestamp,
          relatedWorkItemId: workItemId,
          relatedRunId: runId,
        });

        // Slice C — a correction is a strong negative signal for the
        // currently live profile version. Bump both counters (request +
        // negative) so the drift detector has a clean view of "bad outcomes
        // per canary touch". Then run an opportunistic drift evaluation;
        // heavy-traffic capabilities don't need to wait for a scheduled job
        // to see drift.
        try {
          await incrementAgentLearningCanaryCounters({
            capabilityId,
            agentId,
            requestDelta: 1,
            negativeDelta: 1,
          });
        } catch (error) {
          await recordPipelineError({
            capabilityId,
            agentId,
            stage: 'correction-canary-bump',
            error,
            workItemId,
            runId,
          });
        }

        try {
          await evaluateAndPersistAgentLearningDrift({ capabilityId, agentId });
        } catch (error) {
          await recordPipelineError({
            capabilityId,
            agentId,
            stage: 'drift-evaluation',
            error,
            workItemId,
            runId,
          });
        }
      },
    );
    lockWaitMs = locked.lockWaitMs;
    await recordLearningLockWait(capabilityId, agentId, lockWaitMs, 'acquired');
  } catch (error) {
    const code = errorCode(error);
    if (code === 'AGENT_LEARNING_LOCK_TIMEOUT') {
      await recordLearningLockWait(capabilityId, agentId, 200, 'timeout');
      await recordPipelineError({
        capabilityId,
        agentId,
        stage: 'correction-lock',
        error,
        workItemId,
        runId,
      });
      // Fall through to queue a job — the queue is idempotent by
      // (capabilityId, agentId, requestReason) so a future tick will still
      // apply this correction once contention clears.
    } else {
      throw error;
    }
  }

  // Memory refresh + enqueue happen OUTSIDE the lock so long-running work
  // doesn't hold up a concurrent writer. Any failure here surfaces as a
  // PIPELINE_ERROR so the lens shows a warning instead of swallowing it.
  try {
    await refreshCapabilityMemory(capabilityId);
  } catch (error) {
    await recordPipelineError({
      capabilityId,
      agentId,
      stage: 'memory-refresh',
      error,
      workItemId,
      runId,
    });
  }
  await queueSingleAgentLearningRefresh(
    capabilityId,
    agentId,
    buildLearningCorrectionReason({
      workItemId,
      runId,
    }),
  );
};

/**
 * Slice C — evaluates drift against the previous version's frozen baseline
 * and, when the evaluator flips the `flagged` state on or a regression
 * streak crosses the configured consecutive-checks threshold, persists the
 * new drift flag + writes a `DRIFT_FLAGGED` learning update so the UI can
 * surface the banner.
 *
 * Kept idempotent: a second call while already flagged does not re-emit
 * the learning update. Respects `LEARNING_DRIFT_ENABLED=false` (skip) and
 * `LEARNING_DRIFT_DRY_RUN=true` (compute + telemetry only, no writes).
 */
export const evaluateAndPersistAgentLearningDrift = async ({
  capabilityId,
  agentId,
  thresholds,
  now,
}: {
  capabilityId: string;
  agentId: string;
  thresholds?: DriftThresholds;
  now?: Date;
}): Promise<AgentLearningDriftState | null> => {
  if (!isDriftDetectionEnabled()) {
    return null;
  }
  const evaluatedAt = now || new Date();
  const context = await getAgentLearningDriftContext(capabilityId, agentId);
  const { profile, previousVersion } = context;
  const evaluation = evaluateAgentLearningDrift({
    profile,
    previousVersion,
    thresholds: thresholds || defaultDriftThresholds(),
    now: evaluatedAt,
  });

  if (isDriftDryRun()) {
    // Observe-only mode: skip the DB write + learning-update emission.
    return evaluation.state;
  }

  const decision = evaluation.decision;

  // Track "was flagged" vs "is now flagged" transitions so we only emit
  // a DRIFT_FLAGGED update on the state change — not every time the
  // detector fires while the flag is still set.
  const wasFlagged = Boolean(profile.driftFlaggedAt);
  let nextFlaggedAt: string | null = profile.driftFlaggedAt || null;
  let nextReason: string | null = profile.driftReason || null;
  let nextStreak: number = Number(profile.driftRegressionStreak || 0);
  let newlyFlagged = false;

  if (decision.kind === 'REGRESSING') {
    nextStreak = decision.newStreak;
    if (decision.flagged) {
      if (!wasFlagged) {
        nextFlaggedAt = evaluatedAt.toISOString();
        nextReason = decision.reason;
        newlyFlagged = true;
      } else {
        // Already flagged — refresh the reason string so the banner
        // carries the latest numbers but don't bump the flagged_at ts.
        nextReason = decision.reason;
      }
    }
  } else if (decision.kind === 'HEALTHY') {
    // Reset streak; leave the flagged state alone (operator must revert).
    nextStreak = 0;
  } else {
    // INSUFFICIENT_SIGNAL — touch lastCheckedAt but don't mutate state.
    nextStreak = Number(profile.driftRegressionStreak || 0);
  }

  await markAgentLearningDriftFlag({
    capabilityId,
    agentId,
    flaggedAt: nextFlaggedAt,
    reason: nextReason,
    regressionStreak: nextStreak,
    lastCheckedAt: evaluatedAt.toISOString(),
  });

  if (newlyFlagged) {
    try {
      const bundle = await getCapabilityBundle(capabilityId);
      const agent = bundle.workspace.agents.find(current => current.id === agentId);
      const agentName = agent?.name || agentId;
      // Slice D — append-only audit write. The old path did DELETE +
      // bulk-INSERT every learning update which was the race window we
      // were explicitly trying to eliminate.
      await appendLearningUpdateRecord({
        capabilityId,
        agentId,
        insight: `Drift detected on ${agentName}'s learning profile — ${decision.kind === 'REGRESSING' ? decision.reason : 'regression'}. Operator review required.`,
        triggerType: 'DRIFT_FLAGGED',
        timestamp: evaluatedAt.toISOString(),
      });
    } catch (error) {
      await recordPipelineError({
        capabilityId,
        agentId,
        stage: 'drift-audit-emit',
        error,
      });
    }
  }

  return {
    ...evaluation.state,
    driftFlaggedAt: nextFlaggedAt || undefined,
    driftReason: nextReason || undefined,
    regressionStreak: nextStreak,
    isFlagged: Boolean(nextFlaggedAt),
  };
};

/**
 * Slice C — lightweight getter for the UI banner + /learning/drift endpoint.
 * Reads the live canary state + previous version baseline and returns the
 * shape the client expects. Safe for hot-path polling.
 */
export const getAgentLearningDriftState = async (
  capabilityId: string,
  agentId: string,
): Promise<AgentLearningDriftState> => {
  const context = await getAgentLearningDriftContext(capabilityId, agentId);
  const evaluation = evaluateAgentLearningDrift({
    profile: context.profile,
    previousVersion: context.previousVersion,
    now: new Date(),
  });
  return evaluation.state;
};


/**
 * Slice A — list the immutable version history for an agent's learning
 * profile. Returned newest-first by version_no. The current pointer lives on
 * the live profile row (see getAgentLearningProfileDetail).
 */
export const getAgentLearningProfileVersionHistory = async (
  capabilityId: string,
  agentId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<AgentLearningProfileVersion[]> => {
  const bundle = await getCapabilityBundle(capabilityId);
  const agent = bundle.workspace.agents.find(current => current.id === agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} was not found in capability ${capabilityId}.`);
  }
  return listAgentLearningProfileVersions(capabilityId, agentId, options);
};

/**
 * Slice A — pure diff helper. Kept intentionally simple (set-based highlight
 * delta + token-length delta on the context block) so the UI can render a
 * readable before/after without needing a full text-diff engine. Exported on
 * its own so unit tests can exercise the diff logic without mocking the DB.
 */
export const computeAgentLearningProfileVersionDiff = (
  fromVersion: AgentLearningProfileVersion,
  toVersion: AgentLearningProfileVersion,
) => {
  const before = new Set(fromVersion.highlights);
  const after = new Set(toVersion.highlights);
  const highlightsAdded = toVersion.highlights.filter(item => !before.has(item));
  const highlightsRemoved = fromVersion.highlights.filter(item => !after.has(item));

  const beforeDocs = new Set(fromVersion.sourceDocumentIds);
  const afterDocs = new Set(toVersion.sourceDocumentIds);
  const sourceDocumentsAdded = toVersion.sourceDocumentIds.filter(id => !beforeDocs.has(id));
  const sourceDocumentsRemoved = fromVersion.sourceDocumentIds.filter(id => !afterDocs.has(id));

  // Token proxy: fall back to character length delta when neither side has a
  // measured token count yet. This keeps the diff useful in Slice A before
  // Slice B lands real tokenizer measurements.
  const fromTokens =
    typeof fromVersion.contextBlockTokens === 'number'
      ? fromVersion.contextBlockTokens
      : Math.ceil(fromVersion.contextBlock.length / 4);
  const toTokens =
    typeof toVersion.contextBlockTokens === 'number'
      ? toVersion.contextBlockTokens
      : Math.ceil(toVersion.contextBlock.length / 4);

  return {
    fromVersionId: fromVersion.versionId,
    toVersionId: toVersion.versionId,
    summaryBefore: fromVersion.summary,
    summaryAfter: toVersion.summary,
    highlightsAdded,
    highlightsRemoved,
    sourceDocumentsAdded,
    sourceDocumentsRemoved,
    contextBlockTokenDelta: toTokens - fromTokens,
  };
};

/**
 * Slice A — fetches two versions and delegates to
 * computeAgentLearningProfileVersionDiff. The HTTP handler wires straight
 * into this.
 */
export const getAgentLearningProfileVersionDiff = async (
  capabilityId: string,
  agentId: string,
  versionId: string,
  againstVersionId: string,
) => {
  const [toVersion, fromVersion] = await Promise.all([
    getAgentLearningProfileVersion(capabilityId, agentId, versionId),
    getAgentLearningProfileVersion(capabilityId, agentId, againstVersionId),
  ]);
  if (!toVersion) {
    throw new Error(`Profile version ${versionId} was not found.`);
  }
  if (!fromVersion) {
    throw new Error(`Profile version ${againstVersionId} was not found.`);
  }

  return computeAgentLearningProfileVersionDiff(fromVersion, toVersion);
};

/**
 * Slice A — operator-initiated revert. Flips the live pointer to a prior
 * version and appends a VERSION_REVERTED update to the append-only learning
 * update log so the action is auditable from the existing learning history UI.
 */
export const activateAgentLearningProfileVersionWithAudit = async ({
  capabilityId,
  agentId,
  versionId,
  actor,
  reason,
}: {
  capabilityId: string;
  agentId: string;
  versionId: string;
  actor?: ActorContext;
  reason?: string;
}): Promise<{ profile: AgentLearningProfile; version: AgentLearningProfileVersion }> => {
  const bundle = await getCapabilityBundle(capabilityId);
  const agent = bundle.workspace.agents.find(current => current.id === agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} was not found in capability ${capabilityId}.`);
  }

  const result = await activateAgentLearningProfileVersion({
    capabilityId,
    agentId,
    versionId,
  });

  const timestamp = new Date().toISOString();
  const actorLabel = actor?.displayName || 'Operator';
  const reasonSuffix = reason ? ` Reason: ${reason}` : '';
  const update: LearningUpdate = {
    id: createId('LEARN'),
    capabilityId,
    agentId,
    sourceLogIds: [],
    insight: `${actorLabel} reverted ${agent.name}'s learning profile to version ${result.version.versionNo}.${reasonSuffix}`,
    timestamp,
    triggerType: 'VERSION_REVERTED',
  };

  try {
    // Slice D — append-only audit write. The revert itself already
    // committed, so audit failure must not propagate, but operators DO
    // need to see it via the PIPELINE_ERROR chip on the lens.
    await appendLearningUpdateRecord({
      capabilityId,
      agentId,
      id: update.id,
      insight: update.insight,
      triggerType: 'VERSION_REVERTED',
      timestamp: update.timestamp,
    });
  } catch (error) {
    await recordPipelineError({
      capabilityId,
      agentId,
      stage: 'revert-audit-emit',
      error,
    });
  }

  try {
    await refreshCapabilityMemory(capabilityId, {
      requeueAgents: false,
      requestReason: `agent-learning-revert:${agentId}`,
    });
  } catch (error) {
    await recordPipelineError({
      capabilityId,
      agentId,
      stage: 'revert-memory-refresh',
      error,
    });
  }

  return result;
};

export const getAgentLearningProfileDetail = async (
  capabilityId: string,
  agentId: string,
): Promise<AgentLearningProfileDetail> => {
  const bundle = await getCapabilityBundle(capabilityId);
  const agent = bundle.workspace.agents.find(current => current.id === agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} was not found in capability ${capabilityId}.`);
  }

  const profile = await getAgentLearningProfile(capabilityId, agentId);

  return {
    capabilityId,
    agentId,
    profile,
    documents: profile.sourceDocumentIds.length
      ? (await listMemoryDocuments(capabilityId)).filter(document =>
          profile.sourceDocumentIds.includes(document.id),
        )
      : [],
    sessions: await listAgentSessionSummaries(capabilityId, agentId),
  };
};

export const ensureAgentLearningBackfill = async () => {
  const missing = await listAgentsNeedingLearning();
  await Promise.all(
    missing.map(agent =>
      queueAgentLearningJob({
        capabilityId: agent.capabilityId,
        agentId: agent.agentId,
        requestReason: 'startup-backfill',
      }),
    ),
  );
  return missing.length;
};

/**
 * Slice B — async LLM-judge evaluation for a freshly committed profile
 * version. Best-effort: bootstraps fixtures if none exist, scores the
 * candidate, and writes judge_score + judge_report back onto the version
 * row. Failures are swallowed (judge is advisory in v1; Slice D will add
 * structured PIPELINE_ERROR logging around this).
 */
const scheduleJudgeEvaluation = async ({
  capabilityId,
  agentId,
  versionId,
  profile,
  model,
  providerKey,
}: {
  capabilityId: string;
  agentId: string;
  versionId: string;
  profile: AgentLearningProfile;
  model?: string;
  providerKey?: string;
}): Promise<JudgeReport | null> => {
  try {
    await bootstrapAgentEvalFixturesFromMessages({
      capabilityId,
      agentId,
      targetCount: 10,
    }).catch(error => {
      void recordPipelineError({
        capabilityId,
        agentId,
        stage: 'judge-fixture-bootstrap',
        error,
      });
      return 0;
    });

    const fixtureCount = await countAgentEvalFixtures(capabilityId, agentId);
    if (!fixtureCount) {
      return null;
    }

    const fixtures = await listAgentEvalFixtures(capabilityId, agentId, { limit: 10 });
    const report = await runJudgeAgainstFixtures({
      profile,
      fixtures: fixtures.map(f => ({
        fixtureId: f.fixtureId,
        prompt: f.prompt,
        referenceResponse: f.referenceResponse,
        expectedCriteria: f.expectedCriteria,
      })),
      requestModel: requestGitHubModel,
      model,
      providerKey,
    });

    try {
      await updateAgentLearningProfileVersionJudge({
        capabilityId,
        agentId,
        versionId,
        judgeScore: report.score,
        judgeReport: report,
      });
    } catch (error) {
      await recordPipelineError({
        capabilityId,
        agentId,
        stage: 'judge-persist',
        error,
      });
    }

    try {
      await markEvalFixturesUsed(
        capabilityId,
        fixtures.map(f => f.fixtureId),
      );
    } catch (error) {
      await recordPipelineError({
        capabilityId,
        agentId,
        stage: 'fixture-usage',
        error,
      });
    }

    return report;
  } catch (error) {
    await recordPipelineError({
      capabilityId,
      agentId,
      stage: 'judge-evaluation',
      error,
    });
    return null;
  }
};

export const processAgentLearningJob = async (job: AgentLearningJobRecord) => {
  const capabilityId = job.capabilityId;
  const bundle = await getCapabilityBundle(capabilityId);
  const agent = bundle.workspace.agents.find(current => current.id === job.agentId);
  const reflectionRequest = parseLearningReflectionRequest(job.requestReason);
  const capabilityWideRefresh = isCapabilityWideLearningReason(job.requestReason);
  const ownerAgent = findOwnerAgent(bundle.workspace.agents);

  if (!agent) {
    await updateAgentLearningJob({
      ...job,
      status: 'FAILED',
      error: `Agent ${job.agentId} was not found.`,
      completedAt: new Date().toISOString(),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    return;
  }

  if (
    capabilityWideRefresh &&
    ownerAgent &&
    agent.id !== ownerAgent.id
  ) {
    const ownerProfile = await getAgentLearningProfile(capabilityId, ownerAgent.id);
    const ownerVersion = ownerProfile.currentVersionId
      ? await getAgentLearningProfileVersion(
          capabilityId,
          ownerAgent.id,
          ownerProfile.currentVersionId,
        )
      : null;

    if (ownerVersion && hasUsableLearningProfile(ownerProfile)) {
      const attachedSkills = bundle.capability.skillLibrary.filter(skill =>
        agent.skillIds.includes(skill.id),
      );
      const derivedProfile = buildDerivedAgentLearningProfile({
        ownerAgent,
        ownerProfile,
        ownerVersionId: ownerVersion.versionId,
        agent,
        skills: attachedSkills,
        requestedAt: job.requestedAt,
      });
      await commitAgentLearningProfileVersion({
        capabilityId,
        agentId: agent.id,
        profile: derivedProfile,
        contextBlockTokens: estimateTokenCount(derivedProfile.contextBlock),
        notes: `${job.requestReason} (derived from ${ownerAgent.id}:${ownerVersion.versionId})`,
      });
    }

    await updateAgentLearningJob({
      ...job,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      error: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    return;
  }

  const previousProfile = await getAgentLearningProfile(capabilityId, agent.id);

  await upsertAgentLearningProfile({
    capabilityId,
    agentId: agent.id,
    profile: {
      ...previousProfile,
      status: 'LEARNING',
      lastRequestedAt: job.requestedAt,
      lastError: undefined,
    },
  });

  try {
    await refreshCapabilityMemory(capabilityId, {
      requeueAgents: false,
      requestReason: `agent-learning:${agent.id}`,
      strictOnEmbeddingAbort: capabilityWideRefresh,
    });

    const corpus = await getCapabilityMemoryCorpus(capabilityId);
    const attachedSkills = bundle.capability.skillLibrary.filter(skill =>
      agent.skillIds.includes(skill.id),
    );
    const ranked = await rankCorpusForAgent(capabilityId, agent, corpus, attachedSkills);
    const selected = ranked.slice(0, Math.min(12, ranked.length));

    // Slice D — LLM parse failure fallback. If `extractJsonObject` inside
    // the summarizer throws (malformed JSON or missing fields), we capture
    // the error, fall back to the PREVIOUS profile's summary + highlights,
    // and pass a parse-failure flag into the shape-gate logic below so the
    // candidate is committed as REVIEW_PENDING instead of dropped on the
    // floor. This preserves the audit timeline AND guarantees we never
    // write an empty-summary version even if the shape gate is disabled.
    let llmParseError: { stage: string; message: string; code?: string } | null = null;

    let summarized: {
      summary: string;
      highlights: string[];
      contextBlock: string;
    };
    if (selected.length === 0) {
      summarized = {
        summary: `${agent.name} does not have capability memory sources available yet.`,
        highlights: ['No indexed capability artifacts or documents were available.'],
        contextBlock:
          'No indexed capability memory was available yet. Ask for updated capability artifacts or refresh learning after documents are added.',
      };
    } else {
      try {
        const raw = await summarizeAgentLearning({
          agent,
          selectedCorpus: selected,
          skills: attachedSkills,
        });
        summarized = {
          summary: raw.summary || '',
          highlights: raw.highlights || [],
          contextBlock: raw.contextBlock || '',
        };
      } catch (error) {
        llmParseError = {
          stage: 'summarize',
          message: errorMessage(error),
          code: errorCode(error),
        };
        await recordPipelineError({
          capabilityId,
          agentId: agent.id,
          stage: 'llm-parse',
          error,
        });
        // Preserve the prior summary so the archived candidate row has
        // something usable for operators to inspect, and the lens never
        // shows a blank agent because of a single malformed LLM response.
        summarized = {
          summary: previousProfile.summary || '',
          highlights: previousProfile.highlights || [],
          contextBlock: previousProfile.contextBlock || '',
        };
      }
    }

    let reflected: ExperienceDistillationResult | null = null;
    let reflectionContextBlock: string | undefined;

    if (reflectionRequest) {
      const reflectionContext = await buildExperienceTracePayload({
        bundle,
        agent,
        skills: attachedSkills,
        request: reflectionRequest,
      });

      try {
        reflected = await summarizeExperienceDistillation({
          agent,
          skills: attachedSkills,
          request: reflectionRequest,
          tracePayload: reflectionContext.tracePayload,
        });
      } catch (error) {
        llmParseError = llmParseError || {
          stage: 'reflection',
          message: errorMessage(error),
          code: errorCode(error),
        };
        await recordPipelineError({
          capabilityId,
          agentId: agent.id,
          stage: 'llm-parse',
          error,
        });
        reflected = null;
      }

      if (reflected) {
        await applyExperienceDistillation({
          bundle,
          agent,
          request: reflectionRequest,
          result: reflected,
          generatedAt: new Date().toISOString(),
          workItemTitle: reflectionContext.workItemTitle,
          corrections: reflectionContext.corrections,
        });
        reflectionContextBlock = reflected.contextBlock;
        try {
          await refreshCapabilityMemory(capabilityId, {
            requeueAgents: false,
            requestReason: `agent-learning-reflection:${agent.id}`,
          });
        } catch (error) {
          await recordPipelineError({
            capabilityId,
            agentId: agent.id,
            stage: 'memory-refresh-reflection',
            error,
          });
        }
      }
    }

    const sourceDocumentIds = selected.map(item => item.document.id);
    const sourceArtifactIds = unique(
      selected
        .map(item =>
          typeof item.document.metadata?.artifactId === 'string'
            ? item.document.metadata.artifactId
            : undefined,
        )
        .filter(Boolean) as string[],
    );

    // Slice A: commit a new immutable profile version and atomically flip the
    // live pointer to it. Prior versions remain in history, available via
    // listAgentLearningProfileVersions / activateAgentLearningProfileVersion
    // for operator-initiated revert. Transient state transitions (LEARNING /
    // ERROR / STALE) still go through upsertAgentLearningProfile so we don't
    // spam the history with error placeholders.
    //
    // Slice B: before the pointer flips, the candidate must pass synchronous
    // shape checks. On blocking failure the candidate is still persisted in
    // the version table with status=REVIEW_PENDING and the live pointer
    // stays on the prior version — no silent empty-profile regression.
    const distilledProfile: AgentLearningProfile = {
      status: 'READY',
      summary: reflected?.summary?.trim() || summarized.summary?.trim() || '',
      highlights: mergeUniqueStrings(
        [...(reflected?.lessons || []), ...((summarized.highlights || []).map(item => item.trim()))],
        8,
      ),
      contextBlock:
        mergeUniqueStrings(
          [reflectionContextBlock, summarized.contextBlock?.trim()],
          2,
        ).join('\n\n') || '',
      sourceDocumentIds,
      sourceArtifactIds,
      sourceCount: selected.length,
      derivationMode: capabilityWideRefresh ? 'OWNER_DISTILLED' : 'AGENT_SPECIFIC',
      derivedFromAgentId: capabilityWideRefresh && ownerAgent ? ownerAgent.id : undefined,
      refreshedAt: new Date().toISOString(),
      lastRequestedAt: job.requestedAt,
    };

    const qualityGateOn = isQualityGateEnabled();
    const shapeReport: ShapeCheckReport | undefined = qualityGateOn
      ? runProfileShapeChecks(distilledProfile)
      : undefined;
    const contextBlockTokens = estimateTokenCount(distilledProfile.contextBlock);

    let finalizedProfile: AgentLearningProfile = distilledProfile;
    let flipPointer = true;
    let versionStatusOverride: AgentLearningStatus | undefined;

    if (shapeReport && !shapeReport.passed) {
      const failureSummary = shapeReport.blockingFailures
        .map(failure => `${failure.code}: ${failure.message}`)
        .join('; ');
      finalizedProfile = {
        ...distilledProfile,
        // Keep the candidate body in the version row but hold the live
        // pointer steady. The live profile row gets last_error populated
        // so the lens can surface the pending state.
        status: 'REVIEW_PENDING',
        lastError: `Shape check failed — ${failureSummary}`,
      };
      flipPointer = false;
      versionStatusOverride = 'REVIEW_PENDING';
    }

    // Slice D — LLM parse failure is load-bearing even if the shape gate
    // is off: we don't want a partially-hallucinated profile serving
    // inference. If the summarizer threw, we already substituted the prior
    // summary/highlights above; here we promote the candidate to
    // REVIEW_PENDING + hold the pointer so operators see the error chip on
    // the lens and can retry via the refresh button.
    if (llmParseError) {
      finalizedProfile = {
        ...finalizedProfile,
        status: 'REVIEW_PENDING',
        lastError: `LLM_PARSE_FAILED (${llmParseError.stage}): ${llmParseError.message}`,
      };
      flipPointer = false;
      versionStatusOverride = 'REVIEW_PENDING';
    }

    const { version: committedVersion } = await commitAgentLearningProfileVersion({
      capabilityId,
      agentId: agent.id,
      profile: finalizedProfile,
      notes: job.requestReason,
      contextBlockTokens,
      shapeReport,
      flipPointer,
      versionStatusOverride,
    });

    if (
      capabilityWideRefresh &&
      ownerAgent &&
      ownerAgent.id === agent.id &&
      flipPointer
    ) {
      try {
        await fanOutCapabilityLearningFromOwner({
          bundle,
          ownerAgent,
          ownerProfile: {
            ...finalizedProfile,
            status: 'READY',
            currentVersionId: committedVersion.versionId,
          },
          ownerVersion: committedVersion,
          requestedAt: job.requestedAt,
          requestReason: job.requestReason,
        });
      } catch (error) {
        await recordPipelineError({
          capabilityId,
          agentId: agent.id,
          stage: 'owner-fanout',
          error,
        });
        throw error;
      }
    }

    // Slice B: kick off the async LLM-judge after the transaction closes.
    // Judge results are advisory in v1 — we annotate the version row and
    // (later, Slice C) feed drift detection, but we never auto-revert.
    // Slice D: surface any judge failure as a PIPELINE_ERROR instead of
    // swallowing it silently.
    if (qualityGateOn && flipPointer) {
      void scheduleJudgeEvaluation({
        capabilityId,
        agentId: agent.id,
        versionId: committedVersion.versionId,
        profile: finalizedProfile,
        model: agent.model,
        providerKey: resolveAgentProviderKey(agent),
      }).catch(error =>
        recordPipelineError({
          capabilityId,
          agentId: agent.id,
          stage: 'judge-evaluation',
          error,
        }),
      );
    }

    await updateAgentLearningJob({
      ...job,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      error: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Agent learning failed unexpectedly.';

    await upsertAgentLearningProfile({
      capabilityId,
      agentId: agent.id,
      profile: hasUsableLearningProfile(previousProfile)
        ? {
            ...previousProfile,
            status: 'STALE',
            lastRequestedAt: job.requestedAt,
            lastError: message,
          }
        : {
            ...previousProfile,
            status: 'ERROR',
            lastRequestedAt: job.requestedAt,
            lastError: message,
          },
    });

    await updateAgentLearningJob({
      ...job,
      status: 'FAILED',
      completedAt: new Date().toISOString(),
      error: message,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    throw error;
  }
};
