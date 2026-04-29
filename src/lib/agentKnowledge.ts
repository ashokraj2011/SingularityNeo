import type {
  AgentKnowledgeConfidence,
  AgentKnowledgeFreshness,
  AgentKnowledgeLens,
  Capability,
  CapabilityAgent,
  CapabilityWorkspace,
  KnowledgeSourceSummary,
  LearningDelta,
} from '../types';
import { buildCapabilityBriefing } from './capabilityBriefing';

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const truncate = (value: string, limit = 180) => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
};

const toRelativeAgeHours = (value?: string) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return Math.max(0, (Date.now() - parsed.getTime()) / (1000 * 60 * 60));
};

const getFreshnessSignal = (agent: CapabilityAgent): AgentKnowledgeFreshness => {
  switch (agent.learningProfile.status) {
    case 'READY': {
      const ageHours = toRelativeAgeHours(agent.learningProfile.refreshedAt);
      if (ageHours === null || ageHours <= 24) {
        return 'FRESH';
      }
      return 'ACTIVE';
    }
    case 'STALE':
      return 'STALE';
    case 'ERROR':
      return 'ERROR';
    case 'LEARNING':
    case 'QUEUED':
      return 'ACTIVE';
    default:
      return 'NOT_STARTED';
  }
};

const getConfidenceSignal = (agent: CapabilityAgent): AgentKnowledgeConfidence => {
  if (agent.learningProfile.status === 'READY' && agent.learningProfile.sourceCount >= 8) {
    return 'HIGH';
  }
  if (agent.learningProfile.status === 'READY' && agent.learningProfile.sourceCount >= 3) {
    return 'MEDIUM';
  }
  return 'LOW';
};

const buildRoleKnowledge = (
  capability: Capability,
  agent: CapabilityAgent,
) => {
  const attachedSkillNames = (agent.skillIds || [])
    .map(skillId => capability.skillLibrary.find(skill => skill.id === skillId)?.name)
    .filter(Boolean) as string[];

  return unique(
    [
      ...agent.contract.primaryResponsibilities,
      ...agent.contract.workingApproach,
      ...agent.contract.guardrails.slice(0, 3),
      ...(attachedSkillNames || []).map(skillName => `Skill: ${skillName}`),
    ].map(item => item.trim()),
  ).slice(0, 6);
};

const buildLearningDeltas = ({
  workspace,
  agent,
  workItemId,
}: {
  workspace: CapabilityWorkspace;
  agent: CapabilityAgent;
  workItemId?: string;
}): LearningDelta[] =>
  workspace.learningUpdates
    .filter(update => {
      if (update.agentId !== agent.id) {
        return false;
      }
      if (workItemId && update.relatedWorkItemId && update.relatedWorkItemId !== workItemId) {
        return false;
      }
      return true;
    })
    .slice()
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
    )
    .slice(0, 4)
    .map(update => ({
      id: update.id,
      timestamp: update.timestamp,
      triggerType: update.triggerType,
      insight: update.insight,
      sourceLogIds: update.sourceLogIds,
      relatedWorkItemId: update.relatedWorkItemId,
      relatedRunId: update.relatedRunId,
    }));

const buildProvenance = ({
  capability,
  workspace,
  agent,
  deltas,
}: {
  capability: Capability;
  workspace: CapabilityWorkspace;
  agent: CapabilityAgent;
  deltas: LearningDelta[];
}): KnowledgeSourceSummary[] => {
  const metadataSources: KnowledgeSourceSummary[] = buildCapabilityBriefing(capability).sections
    .slice(0, 3)
    .map(section => ({
      id: `metadata-${section.id}`,
      kind: 'METADATA' as const,
      label: section.label,
      summary: section.summary,
      freshnessSignal: 'Live',
      confidenceSignal: 'Capability',
    }));

  const artifactSources: KnowledgeSourceSummary[] = agent.learningProfile.sourceArtifactIds
    .map(artifactId => workspace.artifacts.find(artifact => artifact.id === artifactId))
    .filter(Boolean)
    .slice(0, 3)
    .map(artifact => ({
      id: `artifact-${artifact!.id}`,
      kind: 'ARTIFACT' as const,
      label: artifact!.name,
      summary: artifact!.summary || artifact!.description || artifact!.type,
      linkedArtifactId: artifact!.id,
      freshnessSignal: artifact!.created,
      confidenceSignal: artifact!.direction || 'OUTPUT',
    }));

  const sessionSource: KnowledgeSourceSummary[] = agent.sessionSummaries.slice(0, 2).map(session => ({
    id: `session-${session.sessionId}`,
    kind: 'SESSION' as const,
    label: `${session.scope.replace(/_/g, ' ')} session`,
    summary: `${session.requestCount} turns · ${session.model}`,
    freshnessSignal: session.lastUsedAt,
    confidenceSignal: 'Durable',
  }));

  const learningSources: KnowledgeSourceSummary[] = deltas.slice(0, 3).map(delta => ({
    id: `learning-${delta.id}`,
    kind: 'LEARNING' as const,
    label: delta.triggerType ? delta.triggerType.replace(/_/g, ' ') : 'Learning update',
    summary: truncate(delta.insight, 140),
    freshnessSignal: delta.timestamp,
    confidenceSignal: 'Derived',
  }));

  return [...metadataSources, ...artifactSources, ...sessionSource, ...learningSources];
};

export const buildAgentKnowledgeLens = ({
  capability,
  workspace,
  agent,
  workItemId,
}: {
  capability: Capability;
  workspace: CapabilityWorkspace;
  agent: CapabilityAgent;
  workItemId?: string;
}): AgentKnowledgeLens => {
  const briefing = buildCapabilityBriefing(capability);
  const deltas = buildLearningDeltas({
    workspace,
    agent,
    workItemId,
  });

  return {
    agentId: agent.id,
    summary:
      agent.learningProfile.summary?.trim() ||
      `No reusable learning summary is available yet for ${agent.name}.`,
    freshnessSignal: getFreshnessSignal(agent),
    confidenceSignal: getConfidenceSignal(agent),
    baseRoleKnowledge: buildRoleKnowledge(capability, agent),
    capabilityKnowledge: unique(
      [
        briefing.outcome,
        ...briefing.activeConstraints,
        ...briefing.evidencePriorities.map(item => `Evidence: ${item}`),
      ].map(item => item.trim()),
    ).slice(0, 6),
    liveExecutionLearning: unique(
      [
        ...agent.learningProfile.highlights,
        ...deltas.map(delta => delta.insight),
      ].map(item => truncate(item, 180)),
    ).slice(0, 6),
    provenance: buildProvenance({
      capability,
      workspace,
      agent,
      deltas,
    }),
    deltas,
    contextBlock: agent.learningProfile.contextBlock || undefined,
    // Slice D — surface pipeline failures + review-pending state so the
    // lens can render the error chip without the caller opening the
    // version-history disclosure.
    lastError: agent.learningProfile.lastError || undefined,
    profileStatus: agent.learningProfile.status,
    derivationMode: agent.learningProfile.derivationMode,
    derivedFromAgentId: agent.learningProfile.derivedFromAgentId,
    derivedFromAgentName: agent.learningProfile.derivedFromAgentId
      ? workspace.agents.find(
          current => current.id === agent.learningProfile.derivedFromAgentId,
        )?.name
      : undefined,
    sourceVersionId: agent.learningProfile.sourceVersionId,
  };
};

export const buildAgentKnowledgePrompt = (lens: AgentKnowledgeLens) =>
  [
    `Knowledge summary: ${lens.summary}`,
    `Freshness: ${lens.freshnessSignal}`,
    `Confidence: ${lens.confidenceSignal}`,
      lens.baseRoleKnowledge.length > 0
      ? `Base role knowledge: ${lens.baseRoleKnowledge.join(' | ')}`
      : null,
    lens.capabilityKnowledge.length > 0
      ? `Capability knowledge: ${lens.capabilityKnowledge.join(' | ')}`
      : null,
    lens.liveExecutionLearning.length > 0
      ? `Live execution learning: ${lens.liveExecutionLearning.join(' | ')}`
      : null,
    lens.deltas.length > 0
      ? `Recent learning deltas: ${lens.deltas
          .map(delta => `${delta.triggerType || 'UPDATE'} - ${truncate(delta.insight, 140)}`)
          .join(' | ')}`
      : null,
    lens.contextBlock ? `Context block:\n${lens.contextBlock}` : null,
  ]
    .filter(Boolean)
    .join('\n');
