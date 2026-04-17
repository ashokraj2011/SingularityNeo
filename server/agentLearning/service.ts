import type {
  ActorContext,
  AgentLearningProfileDetail,
  AgentOperatingContract,
  Artifact,
  CapabilityAgent,
  LearningUpdate,
  Skill,
} from '../../src/types';
import { requestGitHubModel } from '../githubModels';
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
  getAgentLearningProfile,
  listAgentSessionSummaries,
  listAgentsNeedingLearning,
  queueAgentLearningJob,
  updateAgentLearningJob,
  upsertAgentLearningProfile,
  createOperatingPolicySnapshot,
} from './repository';

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

const EXPERIENCE_DISTILLATION_PREFIX = 'experience-distillation';
const INCIDENT_DERIVED_PREFIX = 'incident-derived';
const USER_CORRECTION_PREFIX = 'learning-correction';

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

  const response = await requestGitHubModel({
    model: agent.model,
    providerKey: agent.providerKey || agent.provider,
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
  const response = await requestGitHubModel({
    model: agent.model,
    providerKey: agent.providerKey || agent.provider,
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
  await Promise.all(
    bundle.workspace.agents.map(agent =>
      queueAgentLearningJob({
        capabilityId,
        agentId: agent.id,
        requestReason,
        makeStale: true,
      }),
    ),
  );
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
  const latestBundle = await getCapabilityBundle(capabilityId);

  await replaceCapabilityWorkspaceContentRecord(capabilityId, {
    learningUpdates: [...latestBundle.workspace.learningUpdates, nextUpdate],
  });

  await refreshCapabilityMemory(capabilityId).catch(() => undefined);
  await queueSingleAgentLearningRefresh(
    capabilityId,
    agentId,
    buildLearningCorrectionReason({
      workItemId,
      runId,
    }),
  );
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

export const processAgentLearningJob = async (job: AgentLearningJobRecord) => {
  const capabilityId = job.capabilityId;
  const bundle = await getCapabilityBundle(capabilityId);
  const agent = bundle.workspace.agents.find(current => current.id === job.agentId);
  const reflectionRequest = parseLearningReflectionRequest(job.requestReason);

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
    });

    const corpus = await getCapabilityMemoryCorpus(capabilityId);
    const attachedSkills = bundle.capability.skillLibrary.filter(skill =>
      agent.skillIds.includes(skill.id),
    );
    const ranked = await rankCorpusForAgent(capabilityId, agent, corpus, attachedSkills);
    const selected = ranked.slice(0, Math.min(12, ranked.length));

    const summarized =
      selected.length > 0
        ? await summarizeAgentLearning({
            agent,
            selectedCorpus: selected,
            skills: attachedSkills,
          })
        : {
            summary: `${agent.name} does not have capability memory sources available yet.`,
            highlights: ['No indexed capability artifacts or documents were available.'],
            contextBlock:
              'No indexed capability memory was available yet. Ask for updated capability artifacts or refresh learning after documents are added.',
          };

    let reflected: ExperienceDistillationResult | null = null;
    let reflectionContextBlock: string | undefined;

    if (reflectionRequest) {
      const reflectionContext = await buildExperienceTracePayload({
        bundle,
        agent,
        skills: attachedSkills,
        request: reflectionRequest,
      });

      reflected = await summarizeExperienceDistillation({
        agent,
        skills: attachedSkills,
        request: reflectionRequest,
        tracePayload: reflectionContext.tracePayload,
      });

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
      await refreshCapabilityMemory(capabilityId, {
        requeueAgents: false,
        requestReason: `agent-learning-reflection:${agent.id}`,
      }).catch(() => undefined);
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

    await upsertAgentLearningProfile({
      capabilityId,
      agentId: agent.id,
      profile: {
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
        refreshedAt: new Date().toISOString(),
        lastRequestedAt: job.requestedAt,
      },
    });

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
