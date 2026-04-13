import type {
  AgentArtifactExpectation,
  AgentLearningProfile,
  AgentLearningStatus,
  AgentOperatingContract,
  AgentRoleStarterKey,
  AgentSessionSummary,
  AgentUsage,
  LearningUpdate,
  Skill,
  SkillKind,
  SkillOrigin,
} from '../types';

const SKILL_CATEGORIES = new Set<Skill['category']>([
  'Analysis',
  'Automation',
  'Security',
  'Compliance',
  'Data',
]);

const SKILL_KINDS = new Set<SkillKind>(['GENERAL', 'ROLE', 'CUSTOM', 'LEARNING']);
const SKILL_ORIGINS = new Set<SkillOrigin>(['FOUNDATION', 'CAPABILITY']);
const AGENT_ROLE_STARTERS = new Set<AgentRoleStarterKey>([
  'OWNER',
  'PLANNING',
  'BUSINESS-ANALYST',
  'ARCHITECT',
  'SOFTWARE-DEVELOPER',
  'QA',
  'DEVOPS',
  'VALIDATION',
  'EXECUTION-OPS',
  'CONTRARIAN-REVIEWER',
]);
const LEARNING_STATUSES = new Set<AgentLearningStatus>([
  'NOT_STARTED',
  'QUEUED',
  'LEARNING',
  'READY',
  'STALE',
  'ERROR',
]);

const toStringValue = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
};

const toNonBlankString = (value: unknown, fallback = ''): string => {
  const normalized = toStringValue(value, fallback);
  return normalized.trim() ? normalized : fallback;
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
    : [];

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeSkill = (skill: Partial<Skill> & Pick<Skill, 'id'>): Skill => {
  const name = toNonBlankString(skill.name, 'Untitled Skill');
  const description = toNonBlankString(
    skill.description,
    'No description has been captured for this skill yet.',
  );

  return {
    id: toStringValue(skill.id),
    name,
    description,
    category: SKILL_CATEGORIES.has(skill.category as Skill['category'])
      ? (skill.category as Skill['category'])
      : 'Analysis',
    version: toNonBlankString(skill.version, '1.0.0'),
    contentMarkdown:
      typeof skill.contentMarkdown === 'string' && skill.contentMarkdown.trim()
        ? skill.contentMarkdown
        : `# ${name}\n\n${description}`,
    kind: SKILL_KINDS.has(skill.kind as SkillKind)
      ? (skill.kind as SkillKind)
      : 'CUSTOM',
    origin: SKILL_ORIGINS.has(skill.origin as SkillOrigin)
      ? (skill.origin as SkillOrigin)
      : 'CAPABILITY',
    defaultTemplateKeys: toStringArray(skill.defaultTemplateKeys),
  };
};

export const normalizeAgentArtifactExpectation = (
  expectation: Partial<AgentArtifactExpectation>,
  fallbackDirection: AgentArtifactExpectation['direction'],
  fallbackRequiredByDefault: boolean,
): AgentArtifactExpectation | null => {
  const artifactName = toNonBlankString(expectation.artifactName);
  if (!artifactName) {
    return null;
  }

  return {
    artifactName,
    direction:
      expectation.direction === 'INPUT' || expectation.direction === 'OUTPUT'
        ? expectation.direction
        : fallbackDirection,
    requiredByDefault:
      typeof expectation.requiredByDefault === 'boolean'
        ? expectation.requiredByDefault
        : fallbackRequiredByDefault,
    description: toNonBlankString(expectation.description) || undefined,
  };
};

const normalizeAgentArtifactExpectationList = (
  value: unknown,
  fallbackDirection: AgentArtifactExpectation['direction'],
  fallbackRequiredByDefault: boolean,
) =>
  Array.isArray(value)
    ? value
        .map(item =>
          normalizeAgentArtifactExpectation(
            item && typeof item === 'object' ? (item as Partial<AgentArtifactExpectation>) : {},
            fallbackDirection,
            fallbackRequiredByDefault,
          ),
        )
        .filter((item): item is AgentArtifactExpectation => Boolean(item))
    : [];

export const normalizeAgentRoleStarterKey = (
  value: unknown,
): AgentRoleStarterKey | undefined => {
  const normalized = toNonBlankString(value).toUpperCase();
  return AGENT_ROLE_STARTERS.has(normalized as AgentRoleStarterKey)
    ? (normalized as AgentRoleStarterKey)
    : undefined;
};

export const normalizeAgentOperatingContract = (
  contract?: Partial<AgentOperatingContract> | null,
  fallback?: {
    description?: string;
    suggestedInputArtifacts?: string[];
    expectedOutputArtifacts?: string[];
  },
): AgentOperatingContract => {
  const description = toNonBlankString(
    contract?.description,
    toNonBlankString(fallback?.description, 'No operating contract has been captured yet.'),
  );

  const suggestedInputArtifacts = normalizeAgentArtifactExpectationList(
    contract?.suggestedInputArtifacts,
    'INPUT',
    false,
  );
  if (suggestedInputArtifacts.length === 0) {
    suggestedInputArtifacts.push(
      ...unique(fallback?.suggestedInputArtifacts || [])
        .map(name =>
          normalizeAgentArtifactExpectation(
            { artifactName: name, direction: 'INPUT', requiredByDefault: false },
            'INPUT',
            false,
          ),
        )
        .filter((item): item is AgentArtifactExpectation => Boolean(item)),
    );
  }

  const expectedOutputArtifacts = normalizeAgentArtifactExpectationList(
    contract?.expectedOutputArtifacts,
    'OUTPUT',
    true,
  );
  if (expectedOutputArtifacts.length === 0) {
    expectedOutputArtifacts.push(
      ...unique(fallback?.expectedOutputArtifacts || [])
        .map(name =>
          normalizeAgentArtifactExpectation(
            { artifactName: name, direction: 'OUTPUT', requiredByDefault: true },
            'OUTPUT',
            true,
          ),
        )
        .filter((item): item is AgentArtifactExpectation => Boolean(item)),
    );
  }

  return {
    description,
    primaryResponsibilities: toStringArray(contract?.primaryResponsibilities),
    workingApproach: toStringArray(contract?.workingApproach),
    preferredOutputs: toStringArray(contract?.preferredOutputs),
    guardrails: toStringArray(contract?.guardrails),
    conflictResolution: toStringArray(contract?.conflictResolution),
    definitionOfDone: toNonBlankString(
      contract?.definitionOfDone,
      'Complete the role safely with clear outputs, explicit assumptions, and handoff-ready evidence.',
    ),
    suggestedInputArtifacts,
    expectedOutputArtifacts,
  };
};

export const getLegacyArtifactListsFromContract = (
  contract: AgentOperatingContract,
) => ({
  inputArtifacts: unique(
    contract.suggestedInputArtifacts
      .map(expectation => toNonBlankString(expectation.artifactName))
      .filter(Boolean),
  ),
  outputArtifacts: unique(
    contract.expectedOutputArtifacts
      .map(expectation => toNonBlankString(expectation.artifactName))
      .filter(Boolean),
  ),
});

export const formatAgentContractSection = (items: string[] = []) =>
  items.filter(Boolean).map(item => `- ${item}`).join('\n');

export const normalizeAgentLearningProfile = (
  profile?: Partial<AgentLearningProfile> | null,
): AgentLearningProfile => ({
  status: LEARNING_STATUSES.has(profile?.status as AgentLearningStatus)
    ? (profile?.status as AgentLearningStatus)
    : 'NOT_STARTED',
  summary: toStringValue(profile?.summary),
  highlights: toStringArray(profile?.highlights),
  contextBlock: toStringValue(profile?.contextBlock),
  sourceDocumentIds: toStringArray(profile?.sourceDocumentIds),
  sourceArtifactIds: toStringArray(profile?.sourceArtifactIds),
  sourceCount: toFiniteNumber(profile?.sourceCount, 0),
  refreshedAt: profile?.refreshedAt ? toStringValue(profile.refreshedAt) : undefined,
  lastRequestedAt: profile?.lastRequestedAt
    ? toStringValue(profile.lastRequestedAt)
    : undefined,
  lastError: profile?.lastError ? toStringValue(profile.lastError) : undefined,
});

export const normalizeAgentSessionSummary = (
  session: Partial<AgentSessionSummary>,
): AgentSessionSummary => ({
  sessionId: toStringValue(session.sessionId),
  scope:
    session.scope === 'WORK_ITEM' || session.scope === 'TASK'
      ? session.scope
      : 'GENERAL_CHAT',
  scopeId: session.scopeId ? toStringValue(session.scopeId) : undefined,
  lastUsedAt: toStringValue(session.lastUsedAt),
  model: toStringValue(session.model, 'unknown'),
  requestCount: toFiniteNumber(session.requestCount, 0),
  totalTokens: toFiniteNumber(session.totalTokens, 0),
});

export const normalizeAgentUsage = (
  usage?: Partial<AgentUsage> | null,
): AgentUsage => ({
  requestCount: toFiniteNumber(usage?.requestCount, 0),
  promptTokens: toFiniteNumber(usage?.promptTokens, 0),
  completionTokens: toFiniteNumber(usage?.completionTokens, 0),
  totalTokens: toFiniteNumber(usage?.totalTokens, 0),
  estimatedCostUsd: toFiniteNumber(usage?.estimatedCostUsd, 0),
  lastRunAt: usage?.lastRunAt ? toStringValue(usage.lastRunAt) : undefined,
});

export const normalizeLearningUpdate = (
  update: Partial<LearningUpdate> & Pick<LearningUpdate, 'id'>,
): LearningUpdate => {
  const insight =
    toStringValue(update.insight).trim() ||
    toStringValue(update.skillUpdate).trim() ||
    'No learning insight was captured for this update yet.';

  return {
    id: toStringValue(update.id),
    capabilityId: toStringValue(update.capabilityId),
    agentId: toStringValue(update.agentId),
    sourceLogIds: toStringArray(update.sourceLogIds),
    insight,
    skillUpdate: update.skillUpdate
      ? toStringValue(update.skillUpdate)
      : undefined,
    timestamp: toStringValue(update.timestamp),
    triggerType: update.triggerType,
    relatedWorkItemId: update.relatedWorkItemId
      ? toStringValue(update.relatedWorkItemId)
      : undefined,
    relatedRunId: update.relatedRunId ? toStringValue(update.relatedRunId) : undefined,
  };
};
