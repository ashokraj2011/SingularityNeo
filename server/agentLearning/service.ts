import type {
  AgentLearningProfileDetail,
  AgentOperatingContract,
  CapabilityAgent,
  Skill,
} from '../../src/types';
import { requestGitHubModel } from '../githubModels';
import {
  getCapabilityMemoryCorpus,
  listMemoryDocuments,
  refreshCapabilityMemory,
} from '../memory';
import { getCapabilityBundle } from '../repository';
import {
  type AgentLearningJobRecord,
  getAgentLearningProfile,
  listAgentSessionSummaries,
  listAgentsNeedingLearning,
  queueAgentLearningJob,
  updateAgentLearningJob,
  upsertAgentLearningProfile,
} from './repository';

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length > 2);

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const LEARNING_SUMMARY_TIMEOUT_MS = 90_000;

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

const getSourceWeight = (sourceType?: string) => {
  switch (sourceType) {
    case 'ARTIFACT':
      return 60;
    case 'HANDOFF':
      return 56;
    case 'HUMAN_INTERACTION':
      return 52;
    case 'WORK_ITEM':
      return 36;
    case 'CAPABILITY_METADATA':
      return 32;
    case 'REPOSITORY_FILE':
      return 28;
    case 'CHAT_SESSION':
      return 20;
    default:
      return 12;
  }
};

const rankCorpusForAgent = (
  agent: CapabilityAgent,
  corpus: Awaited<ReturnType<typeof getCapabilityMemoryCorpus>>,
  skills: Skill[] = [],
) => {
  const keywords = buildAgentKeywordSet(agent, skills);

  return [...corpus]
    .map(item => {
      const text = `${item.document.title}\n${item.document.contentPreview}\n${item.combinedContent}`;
      const tokens = tokenize(text);
      const overlap = tokens.reduce(
        (count, token) => count + (keywords.has(token) ? 1 : 0),
        0,
      );
      const artifactBias =
        item.document.metadata?.artifactId ||
        item.document.sourceType === 'ARTIFACT' ||
        item.document.sourceType === 'HANDOFF' ||
        item.document.sourceType === 'HUMAN_INTERACTION'
          ? 8
          : 0;

      return {
        ...item,
        score: getSourceWeight(item.document.sourceType) + overlap + artifactBias,
      };
    })
    .sort((left, right) => right.score - left.score);
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
  queueAgentLearningJob({
    capabilityId,
    agentId,
    requestReason,
    makeStale: true,
  });

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
    const ranked = rankCorpusForAgent(agent, corpus, attachedSkills);
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
        summary: summarized.summary?.trim() || '',
        highlights: (summarized.highlights || []).map(item => item.trim()).filter(Boolean).slice(0, 8),
        contextBlock: summarized.contextBlock?.trim() || '',
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
