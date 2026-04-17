import React, { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import {
  ActorContext,
  AgentOutputRecord,
  AgentLearningProfile,
  AgentUsage,
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityWorkspace,
  Skill,
  WorkspaceOrganization,
  WorkspaceSettings,
} from '../types';
import {
  AGENT_TASKS,
  ARTIFACTS,
  BUILT_IN_AGENT_TEMPLATES,
  CAPABILITIES,
  COPILOT_MODEL_OPTIONS,
  EXECUTION_LOGS,
  LEARNING_UPDATES,
  WORKFLOWS,
  WORK_ITEMS,
  getStandardAgentContract,
} from '../constants';
import {
  addCapabilityAgentRecord,
  addCapabilitySkillRecord,
  appendCapabilityMessageRecord,
  createCapabilityRecord,
  type CapabilityBundle,
  type CreateCapabilityAgentInput,
  type CreateCapabilityInput,
  fetchAppState,
  fetchCapabilityBundle,
  setCurrentActorContext,
  replaceCapabilityWorkspaceContentRecord,
  removeCapabilitySkillRecord,
  setActiveChatAgentRecord,
  updateWorkspaceUserPreferenceRecord,
  updateCapabilityAgentRecord,
  updateCapabilityAgentModelsRecord,
  updateCapabilityRecord,
  updateWorkspaceSettingsRecord,
  type AppState,
} from '../lib/api';
import { createDefaultCapabilityLifecycle } from '../lib/capabilityLifecycle';
import {
  applyCapabilityArchitecture,
  createEmptyCapabilityContractDraft,
  normalizeCapabilityCollectionKind,
  normalizeCapabilityContractDraft,
  normalizeCapabilityDependencies,
  normalizeCapabilityKind,
  normalizeCapabilityPublishedSnapshots,
  normalizeCapabilitySharedReferences,
} from '../lib/capabilityArchitecture';
import { buildCapabilityBriefing } from '../lib/capabilityBriefing';
import { buildCapabilityExperience } from '../lib/capabilityExperience';
import { enrichCapabilityAgentProfile, selectPrimaryCopilotAgentId } from '../lib/agentProfiles';
import { buildCapabilityInteractionFeed } from '../lib/interactionFeed';
import { getDefaultCapabilityWorkflows } from '../lib/standardWorkflow';
import { readViewPreference, writeViewPreference } from '../lib/viewPreferences';
import { buildWorkflowFromGraph, normalizeWorkflowGraph } from '../lib/workflowGraph';
import { normalizeWorkspaceConnectorSettings } from '../lib/workspaceConnectors';
import { WORKSPACE_AGENT_TEMPLATES } from '../lib/workspaceFoundations';
import {
  buildActorContextFromOrganization,
  getCurrentWorkspaceUser,
  normalizeWorkspaceOrganization,
  seedWorkspaceOrganizationFromCapabilities,
} from '../lib/workspaceOrganization';
import {
  getLegacyArtifactListsFromContract,
  normalizeAgentOperatingContract,
  normalizeAgentLearningProfile,
  normalizeAgentRoleStarterKey,
  normalizeAgentSessionSummary,
  normalizeAgentUsage,
  normalizeLearningUpdate,
  normalizeSkill,
} from '../lib/agentRuntime';
import { useToast } from './ToastContext';

interface CapabilityContextType {
  bootStatus: 'loading' | 'ready' | 'degraded';
  lastSyncError?: string;
  mutationStatusByCapability: Record<
    string,
    {
      status: 'idle' | 'pending' | 'error';
      error?: string;
    }
  >;
  activeCapability: Capability;
  setActiveCapability: (capability: Capability) => void;
  preferredCapabilityId?: string;
  setPreferredCapabilityId: (capabilityId?: string) => void;
  capabilities: Capability[];
  capabilityWorkspaces: CapabilityWorkspace[];
  workspaceSettings: WorkspaceSettings;
  workspaceOrganization: WorkspaceOrganization;
  currentActorContext: ActorContext;
  currentWorkspaceUserId?: string;
  setCurrentWorkspaceUserId: (userId: string) => void;
  createCapability: (capability: CreateCapabilityInput) => Promise<CapabilityBundle>;
  getCapabilityWorkspace: (capabilityId: string) => CapabilityWorkspace;
  updateCapabilityMetadata: (
    capabilityId: string,
    updates: Partial<Capability>,
  ) => Promise<CapabilityBundle>;
  addCapabilitySkill: (capabilityId: string, skill: Skill) => Promise<CapabilityBundle>;
  removeCapabilitySkill: (capabilityId: string, skillId: string) => Promise<CapabilityBundle>;
  addCapabilityAgent: (
    capabilityId: string,
    agent: CreateCapabilityAgentInput,
  ) => Promise<CapabilityBundle>;
  updateCapabilityAgent: (
    capabilityId: string,
    agentId: string,
    updates: Partial<CapabilityAgent>,
  ) => Promise<CapabilityBundle>;
  updateCapabilityAgentModels: (
    capabilityId: string,
    model: string,
  ) => Promise<CapabilityBundle>;
  appendCapabilityMessage: (
    capabilityId: string,
    message: Omit<CapabilityChatMessage, 'capabilityId'>,
  ) => Promise<CapabilityWorkspace>;
  setActiveChatAgent: (capabilityId: string, agentId: string) => Promise<CapabilityWorkspace>;
  setCapabilityWorkspaceContent: (
    capabilityId: string,
    updates: Partial<
      Pick<
        CapabilityWorkspace,
        'workflows' | 'artifacts' | 'tasks' | 'executionLogs' | 'learningUpdates' | 'workItems'
      >
    >,
  ) => Promise<CapabilityWorkspace>;
  refreshCapabilityBundle: (capabilityId: string) => Promise<CapabilityWorkspace | null>;
  updateWorkspaceSettings: (updates: Partial<WorkspaceSettings>) => Promise<WorkspaceSettings>;
  retryInitialSync: () => Promise<boolean>;
}

const CapabilityContext = createContext<CapabilityContextType | undefined>(undefined);
const SEEDED_CAPABILITY_IDS = new Set(CAPABILITIES.map(capability => capability.id));
const DEFAULT_AGENT_PROVIDER = 'GitHub Copilot SDK' as const;
const DEFAULT_AGENT_MODEL = COPILOT_MODEL_OPTIONS[0].id;
const DEFAULT_AGENT_TOKEN_LIMIT = 12000;
const DEMO_MODE_ENABLED =
  ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_ENABLE_DEMO_MODE || '') === 'true';
const EMPTY_CAPABILITY: Capability = {
  id: '',
  name: '',
  domain: '',
  businessUnit: '',
  description: '',
  capabilityKind: 'DELIVERY',
  collectionKind: undefined,
  businessOutcome: '',
  successMetrics: [],
  definitionOfDone: '',
  requiredEvidenceKinds: [],
  operatingPolicySummary: '',
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  localDirectories: [],
  repositories: [],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  dependencies: [],
  contractDraft: createEmptyCapabilityContractDraft(),
  publishedSnapshots: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    defaultWorkspacePath: undefined,
    allowedWorkspacePaths: [],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'PENDING',
  isSystemCapability: false,
  specialAgentId: '',
  skillLibrary: [],
};

const EMPTY_WORKSPACE_SETTINGS: WorkspaceSettings = {
  databaseConfigs: [],
  connectors: normalizeWorkspaceConnectorSettings(),
};
const DEFAULT_CAPABILITY_PREFERENCE_KEY = 'singularity.workspace.defaultCapabilityId';
const DEFAULT_WORKSPACE_USER_KEY = 'singularity.workspace.currentUserId';

const createDefaultAgentLearningProfile = (): AgentLearningProfile => ({
  status: 'NOT_STARTED',
  summary: '',
  highlights: [],
  contextBlock: '',
  sourceDocumentIds: [],
  sourceArtifactIds: [],
  sourceCount: 0,
});

const slugify = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

const getCapabilityDocumentationSources = (capability: Capability) =>
  [capability.confluenceLink, capability.jiraBoardLink, capability.documentationNotes].filter(
    Boolean,
  ) as string[];

const toAgentLabel = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

const getAgentTemplate = (key?: string) =>
  WORKSPACE_AGENT_TEMPLATES.find(template => template.key === key);

const getAvailableCapabilitySkillIds = (capability: Capability) =>
  new Set(capability.skillLibrary.map(skill => skill.id));

const normalizeCapability = (capability: Capability): Capability => ({
  ...capability,
  capabilityKind: normalizeCapabilityKind(
    capability.capabilityKind,
    capability.collectionKind,
  ),
  collectionKind: normalizeCapabilityCollectionKind(capability.collectionKind),
  repositories: capability.repositories || [],
  dependencies: normalizeCapabilityDependencies(capability.id, capability.dependencies),
  sharedCapabilities: normalizeCapabilitySharedReferences(
    capability.id,
    capability.sharedCapabilities,
  ),
  contractDraft: normalizeCapabilityContractDraft(capability.contractDraft),
  publishedSnapshots: normalizeCapabilityPublishedSnapshots(
    capability.id,
    capability.publishedSnapshots,
  ),
  skillLibrary: (capability.skillLibrary || []).map(skill => normalizeSkill(skill)),
});

const getDefaultSkillIds = (capability: Capability, templateKey?: string) => {
  const availableSkills = getAvailableCapabilitySkillIds(capability);
  const template = getAgentTemplate(templateKey || 'OWNER');
  const preferred = (template?.defaultSkillIds || []).filter(skillId =>
    availableSkills.has(skillId),
  );

  return preferred.length > 0
    ? preferred
    : capability.skillLibrary.map(skill => skill.id);
};

const getPreferredToolIds = (templateKey?: string) => [
  ...(getAgentTemplate(templateKey || 'OWNER')?.preferredToolIds || []),
];

const createBuiltInAgentId = (capabilityId: string, key: string) =>
  `AGENT-${slugify(capabilityId)}-${key}`;

const resolveCapabilityText = (value: string, capability: Capability) =>
  value.replace(/\{capabilityName\}/g, capability.name);

const getMetadataNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const buildPreviousOutputs = (
  capabilityId: string,
  agentId: string,
  tasks: CapabilityWorkspace['tasks'] = AGENT_TASKS,
  logs: CapabilityWorkspace['executionLogs'] = EXECUTION_LOGS,
): AgentOutputRecord[] => {
  const taskOutputs = tasks
    .filter(task => task.capabilityId === capabilityId && task.agent === agentId)
    .flatMap(task =>
      (task.producedOutputs || []).map((output, index) => ({
        id: `${task.id}-OUT-${index + 1}`,
        title: output.name,
        summary: `${task.title} output generated by ${toAgentLabel(agentId)}.`,
        timestamp: task.timestamp,
        status: output.status,
        relatedTaskId: task.id,
      })),
    );

  const loggedOutputs = logs
    .filter(log => log.capabilityId === capabilityId && log.agentId === agentId)
    .flatMap(log => {
      const outputTitle =
        typeof log.metadata?.outputTitle === 'string' ? log.metadata.outputTitle : undefined;
      const outputSummary =
        typeof log.metadata?.outputSummary === 'string'
          ? log.metadata.outputSummary
          : undefined;

      if (!outputTitle && !outputSummary) {
        return [];
      }

      return [
        {
          id: `${log.id}-OUT`,
          title: outputTitle || 'Capability response',
          summary: outputSummary || log.message,
          timestamp: log.timestamp,
          status:
            log.metadata?.outputStatus === 'pending' ? 'pending' : 'completed',
          artifactId:
            typeof log.metadata?.artifactId === 'string' ? log.metadata.artifactId : undefined,
        } satisfies AgentOutputRecord,
      ];
    });

  return [...loggedOutputs, ...taskOutputs];
};

const buildAgentUsage = (
  capabilityId: string,
  agentId: string,
  tasks: CapabilityWorkspace['tasks'] = AGENT_TASKS,
  logs: CapabilityWorkspace['executionLogs'] = EXECUTION_LOGS,
): AgentUsage => {
  const relatedTasks = tasks.filter(
    task => task.capabilityId === capabilityId && task.agent === agentId,
  );
  const relatedLogs = logs.filter(
    log => log.capabilityId === capabilityId && log.agentId === agentId,
  );
  const logsWithUsage = relatedLogs.filter(log =>
    getMetadataNumber(log.metadata?.totalTokens) !== undefined ||
    getMetadataNumber(log.metadata?.promptTokens) !== undefined ||
    getMetadataNumber(log.metadata?.completionTokens) !== undefined,
  );
  const logsWithoutUsageCount = relatedLogs.length - logsWithUsage.length;
  const taskPromptTokens = relatedTasks.reduce(
    (count, task) => count + Math.max(320, (task.prompt || '').length * 2),
    0,
  );
  const taskCompletionTokens = relatedTasks.reduce(
    (count, task) => count + (task.producedOutputs?.length || 0) * 280 + 160,
    0,
  );
  const promptTokens =
    taskPromptTokens +
    logsWithUsage.reduce(
      (count, log) => count + (getMetadataNumber(log.metadata?.promptTokens) || 0),
      0,
    ) +
    logsWithoutUsageCount * 48;
  const completionTokens =
    taskCompletionTokens +
    logsWithUsage.reduce(
      (count, log) => count + (getMetadataNumber(log.metadata?.completionTokens) || 0),
      0,
    ) +
    logsWithoutUsageCount * 36;
  const totalTokens = promptTokens + completionTokens;
  const requestCount =
    logsWithUsage.length > 0
      ? relatedTasks.length + logsWithUsage.length
      : Math.max(relatedLogs.length, relatedTasks.length);

  return {
    requestCount,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd: Number((totalTokens * 0.000003).toFixed(4)),
    lastRunAt: relatedLogs[relatedLogs.length - 1]?.timestamp || relatedTasks[0]?.timestamp,
  };
};

const withAgentDefaults = (
  capability: Capability,
  agent: CapabilityAgent,
  workspaceContent?: Pick<CapabilityWorkspace, 'tasks' | 'executionLogs'>,
): CapabilityAgent => {
  const contract = normalizeAgentOperatingContract(agent.contract, {
    description: agent.objective || agent.role,
    suggestedInputArtifacts: agent.inputArtifacts,
    expectedOutputArtifacts: agent.outputArtifacts,
  });

  return {
    ...agent,
    capabilityId: capability.id,
    roleStarterKey:
      normalizeAgentRoleStarterKey(agent.roleStarterKey) ||
      normalizeAgentRoleStarterKey(agent.isOwner ? 'OWNER' : agent.standardTemplateKey),
    contract,
    ...getLegacyArtifactListsFromContract(contract),
    skillIds:
      agent.skillIds?.length
        ? agent.skillIds
        : getDefaultSkillIds(capability, agent.isOwner ? 'OWNER' : agent.standardTemplateKey),
    preferredToolIds:
      agent.preferredToolIds?.length
        ? agent.preferredToolIds
        : getPreferredToolIds(agent.isOwner ? 'OWNER' : agent.standardTemplateKey),
    provider: agent.provider || DEFAULT_AGENT_PROVIDER,
    model: agent.model || DEFAULT_AGENT_MODEL,
    tokenLimit: agent.tokenLimit || DEFAULT_AGENT_TOKEN_LIMIT,
    learningProfile: normalizeAgentLearningProfile(
      agent.learningProfile || createDefaultAgentLearningProfile(),
    ),
    sessionSummaries: (agent.sessionSummaries || []).map(summary =>
      normalizeAgentSessionSummary(summary),
    ),
    usage:
      workspaceContent
        ? buildAgentUsage(
            capability.id,
            agent.id,
            workspaceContent.tasks,
            workspaceContent.executionLogs,
          )
        : normalizeAgentUsage(
            agent.usage ||
              buildAgentUsage(
                capability.id,
                agent.id,
                workspaceContent?.tasks,
                workspaceContent?.executionLogs,
              ),
          ),
    previousOutputs:
      workspaceContent
        ? buildPreviousOutputs(
            capability.id,
            agent.id,
            workspaceContent.tasks,
            workspaceContent.executionLogs,
          )
        : agent.previousOutputs !== undefined
        ? agent.previousOutputs
        : buildPreviousOutputs(
            capability.id,
            agent.id,
            workspaceContent?.tasks,
            workspaceContent?.executionLogs,
          ),
  };
};

const buildOwnerAgent = (capability: Capability): CapabilityAgent => {
  const ownerAgentId =
    capability.specialAgentId || `AGENT-${slugify(capability.name || capability.id || 'CAPABILITY')}-OWNER`;

  return {
    id: ownerAgentId,
    capabilityId: capability.id,
    name: 'Capability Owning Agent',
    role: 'Capability Owner',
    roleStarterKey: 'OWNER',
    objective: `Own the end-to-end delivery context for ${capability.name} and coordinate all downstream agents within this capability.`,
    systemPrompt: `You are the capability owner for ${capability.name}. Ground every decision, workflow, and team action in the capability's domain, documentation, and governance context.`,
    contract: getStandardAgentContract('OWNER'),
    initializationStatus: 'READY',
    documentationSources: getCapabilityDocumentationSources(capability),
    ...getLegacyArtifactListsFromContract(getStandardAgentContract('OWNER')),
    isOwner: true,
    learningNotes: [
      `${capability.name} team context is isolated to this capability.`,
      `All downstream chats, agents, and workflows should remain aligned to ${capability.domain || capability.name}.`,
    ],
    skillIds: getDefaultSkillIds(capability, 'OWNER'),
    preferredToolIds: getPreferredToolIds('OWNER'),
    provider: DEFAULT_AGENT_PROVIDER,
    model: DEFAULT_AGENT_MODEL,
    tokenLimit: DEFAULT_AGENT_TOKEN_LIMIT,
    learningProfile: createDefaultAgentLearningProfile(),
    sessionSummaries: [],
    usage: buildAgentUsage(capability.id, ownerAgentId),
    previousOutputs: buildPreviousOutputs(capability.id, ownerAgentId),
  };
};

const buildBuiltInAgents = (capability: Capability): CapabilityAgent[] =>
  BUILT_IN_AGENT_TEMPLATES.map(template => {
    const agentId = createBuiltInAgentId(capability.id, template.key);

    return {
      id: agentId,
      capabilityId: capability.id,
      name: template.name,
      role: template.role,
      roleStarterKey: template.roleStarterKey,
      objective: resolveCapabilityText(template.objective, capability),
      systemPrompt: resolveCapabilityText(template.systemPrompt, capability),
      contract: template.contract,
      initializationStatus: 'READY',
      documentationSources: getCapabilityDocumentationSources(capability),
      ...getLegacyArtifactListsFromContract(template.contract),
      isBuiltIn: true,
      standardTemplateKey: template.key,
      learningNotes: [
        `${template.name} is a built-in agent for ${capability.name}.`,
        `Keep all outputs aligned to ${capability.domain || capability.name} capability context.`,
      ],
      skillIds: getDefaultSkillIds(capability, template.key),
      preferredToolIds: getPreferredToolIds(template.key),
      provider: DEFAULT_AGENT_PROVIDER,
      model: DEFAULT_AGENT_MODEL,
      tokenLimit: DEFAULT_AGENT_TOKEN_LIMIT,
      learningProfile: createDefaultAgentLearningProfile(),
      sessionSummaries: [],
      usage: buildAgentUsage(capability.id, agentId),
      previousOutputs: buildPreviousOutputs(capability.id, agentId),
    };
  });

const buildBaseAgents = (
  capability: Capability,
  ownerAgent: CapabilityAgent,
): CapabilityAgent[] => [ownerAgent, ...buildBuiltInAgents(capability)];

const mergeWorkspaceAgents = (
  capability: Capability,
  ownerAgent: CapabilityAgent,
  agents: CapabilityAgent[],
  tasks: CapabilityWorkspace['tasks'],
  executionLogs: CapabilityWorkspace['executionLogs'],
): CapabilityAgent[] => {
  const runtime = { tasks, executionLogs };
  const builtInAgents = buildBuiltInAgents(capability);
  const builtInIds = new Set(builtInAgents.map(agent => agent.id));

  return [
    withAgentDefaults(
      capability,
      {
        ...buildOwnerAgent(capability),
        ...ownerAgent,
        capabilityId: capability.id,
        isOwner: true,
      },
      runtime,
    ),
    ...builtInAgents.map(agent => {
      const existingAgent = agents.find(
        current => !current.isOwner && current.id === agent.id,
      );

      return withAgentDefaults(
        capability,
        existingAgent
          ? {
              ...agent,
              ...existingAgent,
              capabilityId: capability.id,
              isBuiltIn: true,
            }
          : agent,
        runtime,
      );
    }),
    ...agents
      .filter(agent => !agent.isOwner && !builtInIds.has(agent.id))
      .map(agent => withAgentDefaults(capability, agent, runtime)),
  ];
};

const buildWelcomeMessage = (
  capability: Capability,
  ownerAgent: CapabilityAgent,
): CapabilityChatMessage => ({
  id: `MSG-${capability.id}-WELCOME`,
  capabilityId: capability.id,
  role: 'agent',
  content: `I am the Capability Owning Agent for ${capability.name}. Everything in this workspace now belongs to this capability context, including team formation, learning, workflows, and chat.`,
  timestamp: 'Just now',
  agentId: ownerAgent.id,
  agentName: ownerAgent.name,
});

const buildSeededAgents = (
  capability: Capability,
  ownerAgent: CapabilityAgent,
): CapabilityAgent[] => {
  const nextAgents = new Map<string, CapabilityAgent>(
    buildBuiltInAgents(capability).map(agent => [agent.id, agent]),
  );
  const learningByAgent = LEARNING_UPDATES.filter(update => update.capabilityId === capability.id).reduce<
    Record<string, string[]>
  >((acc, update) => {
    acc[update.agentId] = [...(acc[update.agentId] || []), update.insight];
    return acc;
  }, {});

  const registerAgent = (agentId?: string | null, role = 'Capability Agent') => {
    if (!agentId || agentId === ownerAgent.id || nextAgents.has(agentId)) {
      return;
    }

    const outputArtifacts = ARTIFACTS.filter(
      artifact =>
        artifact.capabilityId === capability.id &&
        (artifact.connectedAgentId === agentId || artifact.agent === agentId),
    ).map(artifact => artifact.name);
    const contract = normalizeAgentOperatingContract(undefined, {
      description: `Execute ${capability.name} work inside this capability context and hand off outputs to the next workflow stage.`,
      expectedOutputArtifacts: outputArtifacts,
    });
    const legacyArtifacts = getLegacyArtifactListsFromContract(contract);

    nextAgents.set(agentId, {
      id: agentId,
      capabilityId: capability.id,
      name: toAgentLabel(agentId),
      role,
      roleStarterKey: 'EXECUTION-OPS',
      objective: `Execute ${capability.name} work inside this capability context and hand off outputs to the next workflow stage.`,
      systemPrompt: `You are a ${role.toLowerCase()} for ${capability.name}. Stay inside this capability's metadata, documentation, workflows, and learning context.`,
      contract,
      initializationStatus: 'READY',
      documentationSources: getCapabilityDocumentationSources(capability),
      inputArtifacts: legacyArtifacts.inputArtifacts,
      outputArtifacts: legacyArtifacts.outputArtifacts,
      learningNotes: learningByAgent[agentId] || [],
      skillIds: getDefaultSkillIds(capability),
      preferredToolIds: [],
      provider: DEFAULT_AGENT_PROVIDER,
      model: DEFAULT_AGENT_MODEL,
      tokenLimit: DEFAULT_AGENT_TOKEN_LIMIT,
      learningProfile: createDefaultAgentLearningProfile(),
      sessionSummaries: [],
      usage: buildAgentUsage(capability.id, agentId),
      previousOutputs: buildPreviousOutputs(capability.id, agentId),
    });
  };

  WORKFLOWS.filter(workflow => workflow.capabilityId === capability.id).forEach(workflow => {
    workflow.steps.forEach(step => registerAgent(step.agentId, 'Workflow Agent'));
  });
  AGENT_TASKS.filter(task => task.capabilityId === capability.id).forEach(task =>
    registerAgent(task.agent, 'Task Agent'),
  );
  ARTIFACTS.filter(artifact => artifact.capabilityId === capability.id).forEach(artifact =>
    registerAgent(artifact.connectedAgentId || artifact.agent, 'Artifact Agent'),
  );
  WORK_ITEMS.filter(item => item.capabilityId === capability.id).forEach(item =>
    registerAgent(item.assignedAgentId, 'Delivery Agent'),
  );
  EXECUTION_LOGS.filter(log => log.capabilityId === capability.id).forEach(log =>
    registerAgent(log.agentId, 'Execution Agent'),
  );

  return [ownerAgent, ...nextAgents.values()];
};

const buildCapabilityWorkspace = (
  capability: Capability,
  includeSeedData = false,
): CapabilityWorkspace => {
  const normalizedCapability = normalizeCapability(capability);
  const ownerAgent = buildOwnerAgent(normalizedCapability);
  const isCollectionCapability = normalizedCapability.capabilityKind === 'COLLECTION';
  const defaultWorkflows = isCollectionCapability
    ? []
    : getDefaultCapabilityWorkflows(normalizedCapability).map(workflow =>
        buildWorkflowFromGraph(normalizeWorkflowGraph(workflow)),
      );
  const agents = (includeSeedData
    ? buildSeededAgents(normalizedCapability, ownerAgent)
    : buildBaseAgents(normalizedCapability, ownerAgent)).map(enrichCapabilityAgentProfile);
  const primaryCopilotAgentId = selectPrimaryCopilotAgentId(agents);
  const baseWorkspace: CapabilityWorkspace = {
    capabilityId: normalizedCapability.id,
    briefing: buildCapabilityBriefing(normalizedCapability),
    agents,
    workflows: defaultWorkflows,
    artifacts: includeSeedData
      ? isCollectionCapability
        ? []
        : ARTIFACTS.filter(artifact => artifact.capabilityId === normalizedCapability.id)
      : [],
    tasks: includeSeedData
      ? isCollectionCapability
        ? []
        : AGENT_TASKS.filter(task => task.capabilityId === normalizedCapability.id)
      : [],
    executionLogs: includeSeedData
      ? isCollectionCapability
        ? []
        : EXECUTION_LOGS.filter(log => log.capabilityId === normalizedCapability.id)
      : [],
    learningUpdates: includeSeedData
      ? isCollectionCapability
        ? []
        : LEARNING_UPDATES.filter(
            update => update.capabilityId === normalizedCapability.id,
          ).map(update => normalizeLearningUpdate(update))
      : [],
    workItems: includeSeedData
      ? isCollectionCapability
        ? []
        : WORK_ITEMS.filter(item => item.capabilityId === normalizedCapability.id)
      : [],
    messages: [buildWelcomeMessage(capability, ownerAgent)],
    activeChatAgentId: primaryCopilotAgentId || ownerAgent.id,
    primaryCopilotAgentId,
    createdAt: new Date().toISOString(),
  };
  const experience = buildCapabilityExperience({
    capability: normalizedCapability,
    workspace: baseWorkspace,
  });

  return {
    ...baseWorkspace,
    readinessContract: experience.readinessContract,
    goldenPathProgress: experience.goldenPathProgress,
    interactionFeed: buildCapabilityInteractionFeed({
      capability: normalizedCapability,
      workspace: baseWorkspace,
      agentId: primaryCopilotAgentId,
    }),
  };
};

const upsertCapability = (items: Capability[], next: Capability) =>
  items.some(item => item.id === next.id)
    ? items.map(item => (item.id === next.id ? next : item))
    : [...items, next];

const upsertWorkspace = (items: CapabilityWorkspace[], next: CapabilityWorkspace) =>
  items.some(item => item.capabilityId === next.capabilityId)
    ? items.map(item => (item.capabilityId === next.capabilityId ? next : item))
    : [...items, next];

const mergeCapabilities = (persistedCapabilities: Capability[]) =>
  applyCapabilityArchitecture(
    persistedCapabilities.map(normalizeCapability).reduce(
      (items, capability) => upsertCapability(items, capability),
      DEMO_MODE_ENABLED ? [...CAPABILITIES] : [],
    ),
  );

const upsertCapabilitySkill = (skills: Skill[], nextSkill: Skill) =>
  skills.some(skill => skill.id === nextSkill.id)
    ? skills.map(skill =>
        skill.id === nextSkill.id ? normalizeSkill(nextSkill) : normalizeSkill(skill),
      )
    : [...skills.map(skill => normalizeSkill(skill)), normalizeSkill(nextSkill)];

const normalizeWorkspace = (
  capability: Capability,
  workspace?: Partial<CapabilityWorkspace>,
): CapabilityWorkspace => {
  const normalizedCapability = normalizeCapability(capability);
  const seededWorkspace = buildCapabilityWorkspace(
    normalizedCapability,
    DEMO_MODE_ENABLED && SEEDED_CAPABILITY_IDS.has(capability.id),
  );
  const existingOwnerAgent = workspace?.agents?.find(agent => agent.isOwner);
  const nextOwnerAgent = {
    ...buildOwnerAgent(normalizedCapability),
    ...(existingOwnerAgent || seededWorkspace.agents[0]),
    capabilityId: normalizedCapability.id,
    isOwner: true,
  };
  const nextMessages =
    workspace?.messages?.length &&
    workspace.messages.some(message => message.capabilityId === normalizedCapability.id)
      ? workspace.messages.map(message => ({
          ...message,
          capabilityId: normalizedCapability.id,
        }))
      : seededWorkspace.messages;
  const nextTasks = workspace?.tasks || seededWorkspace.tasks;
  const nextExecutionLogs = workspace?.executionLogs || seededWorkspace.executionLogs;
  const nextAgents = mergeWorkspaceAgents(
    normalizedCapability,
    nextOwnerAgent,
    workspace?.agents || seededWorkspace.agents,
    nextTasks,
    nextExecutionLogs,
  ).map(enrichCapabilityAgentProfile);
  const primaryCopilotAgentId = selectPrimaryCopilotAgentId(nextAgents);
  const normalizedWorkspace: CapabilityWorkspace = {
    ...seededWorkspace,
    ...workspace,
    capabilityId: normalizedCapability.id,
    briefing: buildCapabilityBriefing(normalizedCapability),
    agents: nextAgents,
    workflows: (workspace?.workflows || seededWorkspace.workflows).map(workflow =>
      buildWorkflowFromGraph(normalizeWorkflowGraph(workflow)),
    ),
    artifacts: workspace?.artifacts || seededWorkspace.artifacts,
    tasks: nextTasks,
    executionLogs: nextExecutionLogs,
    learningUpdates: (workspace?.learningUpdates || seededWorkspace.learningUpdates).map(
      update => normalizeLearningUpdate(update),
    ),
    workItems: workspace?.workItems || seededWorkspace.workItems,
    messages: nextMessages,
    activeChatAgentId:
      workspace?.activeChatAgentId &&
      nextAgents.some(agent => agent.id === workspace.activeChatAgentId)
        ? workspace.activeChatAgentId
        : primaryCopilotAgentId || nextOwnerAgent.id,
    primaryCopilotAgentId,
    readinessContract: workspace?.readinessContract,
    createdAt: workspace?.createdAt || seededWorkspace.createdAt,
  };
  const experience = buildCapabilityExperience({
    capability: normalizedCapability,
    workspace: normalizedWorkspace,
  });

  return {
    ...normalizedWorkspace,
    readinessContract: experience.readinessContract,
    goldenPathProgress: experience.goldenPathProgress,
    interactionFeed: buildCapabilityInteractionFeed({
      capability: normalizedCapability,
      workspace: normalizedWorkspace,
      agentId: primaryCopilotAgentId,
    }),
  };
};

const getPreferredActiveCapability = (
  capabilities: Capability[],
  preferredCapabilityId?: string,
) =>
  capabilities.find(
    capability =>
      capability.id === preferredCapabilityId && capability.status !== 'ARCHIVED',
  ) ||
  capabilities.find(capability => capability.status !== 'ARCHIVED') ||
  capabilities.find(capability => capability.id === preferredCapabilityId) ||
  capabilities[0];

const readInitialState = () => {
  const capabilities = DEMO_MODE_ENABLED ? [...CAPABILITIES] : [];
  const preferredCapabilityId = readViewPreference(
    DEFAULT_CAPABILITY_PREFERENCE_KEY,
    '',
  );
  const workspaceOrganization = normalizeWorkspaceOrganization();

  return {
    capabilities,
    preferredCapabilityId,
    activeCapability:
      getPreferredActiveCapability(capabilities, preferredCapabilityId) ||
      EMPTY_CAPABILITY,
    capabilityWorkspaces: capabilities.map(capability =>
      buildCapabilityWorkspace(capability, true),
    ),
    workspaceSettings: EMPTY_WORKSPACE_SETTINGS,
    workspaceOrganization,
  };
};

const normalizeAppState = (
  state: Partial<AppState>,
  preferredActiveCapabilityId?: string,
) => {
  const nextCapabilities = mergeCapabilities(state.capabilities || []);
  const nextWorkspaces = nextCapabilities.map(capability =>
    normalizeWorkspace(
      capability,
      state.capabilityWorkspaces?.find(
        workspace => workspace.capabilityId === capability.id,
      ),
    ),
  );
  const workspaceOrganization = normalizeWorkspaceOrganization(
    state.workspaceOrganization,
  );
  const currentUserPreference =
    workspaceOrganization.userPreferences.find(
      preference => preference.userId === workspaceOrganization.currentUserId,
    ) || null;
  const nextActiveCapability =
    getPreferredActiveCapability(
      nextCapabilities,
      currentUserPreference?.defaultCapabilityId || preferredActiveCapabilityId,
    ) ||
    EMPTY_CAPABILITY;

  return {
    capabilities: nextCapabilities,
    activeCapability: nextActiveCapability,
    capabilityWorkspaces: nextWorkspaces,
    workspaceSettings: state.workspaceSettings || EMPTY_WORKSPACE_SETTINGS,
    workspaceOrganization,
  };
};

export const CapabilityProvider = ({ children }: { children: ReactNode }) => {
  const { error: showErrorToast } = useToast();
  const initialState = useRef(readInitialState()).current;
  const [bootStatus, setBootStatus] = useState<'loading' | 'ready' | 'degraded'>('loading');
  const [lastSyncError, setLastSyncError] = useState('');
  const [capabilities, setCapabilities] = useState<Capability[]>(initialState.capabilities);
  const [activeCapability, setActiveCapabilityState] = useState<Capability>(
    initialState.activeCapability,
  );
  const [preferredCapabilityId, setPreferredCapabilityIdState] = useState<string>(
    initialState.preferredCapabilityId || '',
  );
  const [capabilityWorkspaces, setCapabilityWorkspaces] = useState<CapabilityWorkspace[]>(
    initialState.capabilityWorkspaces,
  );
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings>(
    initialState.workspaceSettings,
  );
  const [workspaceOrganization, setWorkspaceOrganization] = useState<WorkspaceOrganization>(
    initialState.workspaceOrganization,
  );
  const [currentWorkspaceUserId, setCurrentWorkspaceUserIdState] = useState<string>(
    readViewPreference(
      DEFAULT_WORKSPACE_USER_KEY,
      initialState.workspaceOrganization.currentUserId || '',
    ) || initialState.workspaceOrganization.currentUserId || '',
  );
  const [mutationStatusByCapability, setMutationStatusByCapability] = useState<
    Record<string, { status: 'idle' | 'pending' | 'error'; error?: string }>
  >({});
  const mutationQueueRef = useRef<Record<string, Promise<unknown>>>({});
  const capabilitiesRef = useRef(capabilities);
  const activeCapabilityRef = useRef(activeCapability);
  const preferredCapabilityIdRef = useRef(preferredCapabilityId);
  const capabilityWorkspacesRef = useRef(capabilityWorkspaces);
  const workspaceOrganizationRef = useRef(workspaceOrganization);
  const lastAuthorizedUserSyncRef = useRef('');

  useEffect(() => {
    capabilitiesRef.current = capabilities;
  }, [capabilities]);

  useEffect(() => {
    activeCapabilityRef.current = activeCapability;
  }, [activeCapability]);

  useEffect(() => {
    preferredCapabilityIdRef.current = preferredCapabilityId;
  }, [preferredCapabilityId]);

  useEffect(() => {
    capabilityWorkspacesRef.current = capabilityWorkspaces;
  }, [capabilityWorkspaces]);

  useEffect(() => {
    workspaceOrganizationRef.current = workspaceOrganization;
  }, [workspaceOrganization]);

  useEffect(() => {
    const normalizedOrganization = normalizeWorkspaceOrganization({
      ...workspaceOrganization,
      currentUserId:
        currentWorkspaceUserId || workspaceOrganization.currentUserId || undefined,
    });
    setCurrentActorContext(buildActorContextFromOrganization(normalizedOrganization));
  }, [currentWorkspaceUserId, workspaceOrganization]);

  useEffect(() => {
    const selectedUserId =
      currentWorkspaceUserId || workspaceOrganization.currentUserId || '';
    if (!selectedUserId) {
      return;
    }

    const selectedPreference = workspaceOrganization.userPreferences.find(
      preference => preference.userId === selectedUserId,
    );
    const preferredId = selectedPreference?.defaultCapabilityId || '';
    if (!preferredId || preferredId === preferredCapabilityIdRef.current) {
      return;
    }

    setPreferredCapabilityIdState(preferredId);
    const nextActiveCapability = getPreferredActiveCapability(
      capabilitiesRef.current,
      preferredId,
    );
    if (nextActiveCapability) {
      setActiveCapabilityState(nextActiveCapability);
    }
  }, [currentWorkspaceUserId, workspaceOrganization.currentUserId, workspaceOrganization.userPreferences]);

  const setMutationStatus = (
    capabilityId: string,
    status: 'idle' | 'pending' | 'error',
    error?: string,
  ) => {
    if (!capabilityId) {
      return;
    }
    setMutationStatusByCapability(prev => ({
      ...prev,
      [capabilityId]: {
        status,
        error,
      },
    }));
  };

  const clearMutationStatus = (capabilityId: string) => {
    if (!capabilityId) {
      return;
    }
    setMutationStatusByCapability(prev => {
      if (!prev[capabilityId]) {
        return prev;
      }
      return {
        ...prev,
        [capabilityId]: {
          status: 'idle',
        },
      };
    });
  };

  const syncCapabilityBundleState = (
    bundle: { capability: Capability; workspace: CapabilityWorkspace },
    options?: {
      activateCapabilityId?: string;
      allowArchivedFallback?: boolean;
    },
  ) => {
    const normalizedCapability = normalizeCapability(bundle.capability);
    const normalizedWorkspace = normalizeWorkspace(
      normalizedCapability,
      bundle.workspace,
    );
    const nextCapabilities = upsertCapability(
      capabilitiesRef.current,
      normalizedCapability,
    );
    const nextWorkspaces = upsertWorkspace(
      capabilityWorkspacesRef.current,
      normalizedWorkspace,
    );
    const nextWorkspaceOrganization = seedWorkspaceOrganizationFromCapabilities(
      nextCapabilities,
      workspaceOrganizationRef.current,
    );
    const currentActiveCapability = activeCapabilityRef.current;

    setCapabilities(nextCapabilities);
    setCapabilityWorkspaces(nextWorkspaces);
    setWorkspaceOrganization(nextWorkspaceOrganization);

    if (
      options?.activateCapabilityId === normalizedCapability.id ||
      currentActiveCapability.id === normalizedCapability.id ||
      !currentActiveCapability.id
    ) {
      if (normalizedCapability.status === 'ARCHIVED' && options?.allowArchivedFallback) {
        setActiveCapabilityState(
          getPreferredActiveCapability(
            nextCapabilities.filter(capability => capability.id !== normalizedCapability.id),
          ) || normalizedCapability,
        );
      } else {
        setActiveCapabilityState(normalizedCapability);
      }
      return;
    }

    const nextActiveCapability = nextCapabilities.find(
      capability => capability.id === currentActiveCapability.id,
    );
    if (nextActiveCapability) {
      setActiveCapabilityState(nextActiveCapability);
    }
  };

  const syncWorkspaceState = (
    capabilityId: string,
    workspace: CapabilityWorkspace,
  ) => {
    const capability =
      capabilitiesRef.current.find(item => item.id === capabilityId) ||
      activeCapabilityRef.current;
    if (!capability?.id) {
      return;
    }

    setCapabilityWorkspaces(prev =>
      upsertWorkspace(prev, normalizeWorkspace(capability, workspace)),
    );
  };

  const runInitialSync = async () => {
    setBootStatus('loading');
    try {
      const nextState = normalizeAppState(
        await fetchAppState(),
        preferredCapabilityIdRef.current || activeCapabilityRef.current.id,
      );
      setCapabilities(nextState.capabilities);
      setCapabilityWorkspaces(nextState.capabilityWorkspaces);
      setWorkspaceSettings(nextState.workspaceSettings);
      setWorkspaceOrganization(nextState.workspaceOrganization);
      setCurrentWorkspaceUserIdState(
        readViewPreference(
          DEFAULT_WORKSPACE_USER_KEY,
          nextState.workspaceOrganization.currentUserId || '',
        ) || nextState.workspaceOrganization.currentUserId || '',
      );
      lastAuthorizedUserSyncRef.current =
        readViewPreference(
          DEFAULT_WORKSPACE_USER_KEY,
          nextState.workspaceOrganization.currentUserId || '',
        ) || nextState.workspaceOrganization.currentUserId || '';
      setActiveCapabilityState(nextState.activeCapability);
      setLastSyncError('');
      setBootStatus('ready');
      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to hydrate capability state from the API.';
      console.warn('Failed to hydrate capability state from the API.', error);
      setLastSyncError(message);
      setBootStatus('degraded');
      if (!capabilitiesRef.current.length) {
        setCapabilities([]);
        setCapabilityWorkspaces([]);
        setWorkspaceSettings(EMPTY_WORKSPACE_SETTINGS);
        setWorkspaceOrganization(normalizeWorkspaceOrganization());
        setActiveCapabilityState(EMPTY_CAPABILITY);
      }
      return false;
    }
  };

  useEffect(() => {
    let isMounted = true;

    void runInitialSync().then(result => {
      if (!isMounted || result) {
        return;
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const queueCapabilityMutation = (
    capabilityId: string,
    mutation: () => Promise<unknown>,
  ) => {
    const previousMutation = mutationQueueRef.current[capabilityId] || Promise.resolve();
    const nextMutation = previousMutation.catch(() => undefined).then(mutation);
    mutationQueueRef.current[capabilityId] = nextMutation.catch(() => undefined);
    return nextMutation;
  };

  const getCapabilityById = (capabilityId: string) =>
    capabilities.find(capability => capability.id === capabilityId) ||
    (DEMO_MODE_ENABLED
      ? CAPABILITIES.find(capability => capability.id === capabilityId)
      : undefined) ||
    activeCapabilityRef.current ||
    EMPTY_CAPABILITY;

  const getCapabilityWorkspace = (capabilityId: string) => {
    const existingWorkspace = capabilityWorkspaces.find(
      workspace => workspace.capabilityId === capabilityId,
    );
    if (existingWorkspace) {
      return existingWorkspace;
    }
    return buildCapabilityWorkspace(
      getCapabilityById(capabilityId),
      DEMO_MODE_ENABLED && SEEDED_CAPABILITY_IDS.has(capabilityId),
    );
  };

  const logMutationFailure = (scope: string, error: unknown) => {
    console.warn(
      `Failed to sync ${scope} with the capability persistence API.`,
      error,
    );
    showErrorToast('Unable to save changes', `The latest ${scope} update could not be synced to the API.`);
  };

  const ensureWritableState = () => {
    if (bootStatus !== 'ready') {
      throw new Error(
        lastSyncError ||
          'The workspace is offline or still loading. Restore sync before making durable changes.',
      );
    }
  };

  const createCapability = async (newCapability: CreateCapabilityInput) => {
    ensureWritableState();
    const pendingKey = newCapability.id || `NEW-${Date.now()}`;
    setMutationStatus(pendingKey, 'pending');

    try {
      const bundle = await createCapabilityRecord(newCapability);
      syncCapabilityBundleState(bundle, {
        activateCapabilityId: bundle.capability.id,
      });
      clearMutationStatus(pendingKey);
      clearMutationStatus(bundle.capability.id);
      setLastSyncError('');
      setBootStatus('ready');
      return bundle;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create capability.';
      setMutationStatus(pendingKey, 'error', message);
      logMutationFailure(`capability ${newCapability.name || pendingKey}`, error);
      throw error;
    }
  };

  const updateCapabilityMetadata = (
    capabilityId: string,
    updates: Partial<Capability>,
  ) => {
    ensureWritableState();
    setMutationStatus(capabilityId, 'pending');

    return queueCapabilityMutation(capabilityId, async () => {
      const bundle = await updateCapabilityRecord(capabilityId, updates);
      syncCapabilityBundleState(bundle, { allowArchivedFallback: true });
      clearMutationStatus(capabilityId);
      return bundle;
    }).catch(error => {
      const message =
        error instanceof Error
          ? error.message
          : `Unable to update capability ${capabilityId}.`;
      setMutationStatus(capabilityId, 'error', message);
      logMutationFailure(`capability metadata for ${capabilityId}`, error);
      throw error;
    }) as Promise<CapabilityBundle>;
  };

  const addCapabilitySkill = (capabilityId: string, skill: Skill) => {
    ensureWritableState();
    setMutationStatus(capabilityId, 'pending');

    return queueCapabilityMutation(capabilityId, async () => {
      const bundle = await addCapabilitySkillRecord(capabilityId, skill);
      syncCapabilityBundleState(bundle);
      clearMutationStatus(capabilityId);
      return bundle;
    }).catch(error => {
      const message =
        error instanceof Error
          ? error.message
          : `Unable to add skill ${skill.id}.`;
      setMutationStatus(capabilityId, 'error', message);
      logMutationFailure(`capability skill ${skill.id} for ${capabilityId}`, error);
      throw error;
    }) as Promise<CapabilityBundle>;
  };

  const removeCapabilitySkill = (capabilityId: string, skillId: string) => {
    ensureWritableState();
    setMutationStatus(capabilityId, 'pending');

    return queueCapabilityMutation(capabilityId, async () => {
      const bundle = await removeCapabilitySkillRecord(capabilityId, skillId);
      syncCapabilityBundleState(bundle);
      clearMutationStatus(capabilityId);
      return bundle;
    }).catch(error => {
      const message =
        error instanceof Error
          ? error.message
          : `Unable to remove skill ${skillId}.`;
      setMutationStatus(capabilityId, 'error', message);
      logMutationFailure(`capability skill ${skillId} for ${capabilityId}`, error);
      throw error;
    }) as Promise<CapabilityBundle>;
  };

  const addCapabilityAgent = (
    capabilityId: string,
    agent: CreateCapabilityAgentInput,
  ) => {
    ensureWritableState();
    setMutationStatus(capabilityId, 'pending');

    return queueCapabilityMutation(capabilityId, async () => {
      const bundle = await addCapabilityAgentRecord(capabilityId, agent);
      syncCapabilityBundleState(bundle);
      clearMutationStatus(capabilityId);
      return bundle;
    }).catch(error => {
      const message =
        error instanceof Error
          ? error.message
          : `Unable to add agent to ${capabilityId}.`;
      setMutationStatus(capabilityId, 'error', message);
      logMutationFailure(`agent ${agent.name || agent.id || 'new'} for ${capabilityId}`, error);
      throw error;
    }) as Promise<CapabilityBundle>;
  };

  const updateCapabilityAgent = (
    capabilityId: string,
    agentId: string,
    updates: Partial<CapabilityAgent>,
  ) => {
    ensureWritableState();
    setMutationStatus(capabilityId, 'pending');

    return queueCapabilityMutation(capabilityId, async () => {
      const bundle = await updateCapabilityAgentRecord(capabilityId, agentId, updates);
      syncCapabilityBundleState(bundle);
      clearMutationStatus(capabilityId);
      return bundle;
    }).catch(error => {
      const message =
        error instanceof Error
          ? error.message
          : `Unable to update agent ${agentId}.`;
      setMutationStatus(capabilityId, 'error', message);
      logMutationFailure(`agent ${agentId} for ${capabilityId}`, error);
      throw error;
    }) as Promise<CapabilityBundle>;
  };

  const updateCapabilityAgentModels = (
    capabilityId: string,
    model: string,
  ) => {
    ensureWritableState();
    setMutationStatus(capabilityId, 'pending');

    return queueCapabilityMutation(capabilityId, async () => {
      const bundle = await updateCapabilityAgentModelsRecord(capabilityId, {
        model,
      });
      syncCapabilityBundleState(bundle);
      clearMutationStatus(capabilityId);
      return bundle;
    }).catch(error => {
      const message =
        error instanceof Error
          ? error.message
          : `Unable to update agent models for ${capabilityId}.`;
      setMutationStatus(capabilityId, 'error', message);
      logMutationFailure(`agent models for ${capabilityId}`, error);
      throw error;
    }) as Promise<CapabilityBundle>;
  };

  const appendCapabilityMessage = (
    capabilityId: string,
    message: Omit<CapabilityChatMessage, 'capabilityId'>,
  ) => {
    ensureWritableState();

    return queueCapabilityMutation(capabilityId, async () => {
      const workspace = await appendCapabilityMessageRecord(capabilityId, message);
      syncWorkspaceState(capabilityId, workspace);
      clearMutationStatus(capabilityId);
      return workspace;
    }).catch(error => {
      setMutationStatus(
        capabilityId,
        'error',
        error instanceof Error ? error.message : 'Unable to append chat message.',
      );
      logMutationFailure(`chat message ${message.id} for ${capabilityId}`, error);
      throw error;
    }) as Promise<CapabilityWorkspace>;
  };

  const setActiveChatAgent = (capabilityId: string, agentId: string) => {
    ensureWritableState();

    return queueCapabilityMutation(capabilityId, async () => {
      const workspace = await setActiveChatAgentRecord(capabilityId, agentId);
      syncWorkspaceState(capabilityId, workspace);
      clearMutationStatus(capabilityId);
      return workspace;
    }).catch(error => {
      setMutationStatus(
        capabilityId,
        'error',
        error instanceof Error ? error.message : 'Unable to switch the active chat agent.',
      );
      logMutationFailure(`active chat agent ${agentId} for ${capabilityId}`, error);
      throw error;
    }) as Promise<CapabilityWorkspace>;
  };

  const setCapabilityWorkspaceContent = (
    capabilityId: string,
    updates: Partial<
      Pick<
        CapabilityWorkspace,
        'workflows' | 'artifacts' | 'tasks' | 'executionLogs' | 'learningUpdates' | 'workItems'
      >
    >,
  ) => {
    ensureWritableState();
    setMutationStatus(capabilityId, 'pending');

    return queueCapabilityMutation(capabilityId, async () => {
      const workspace = await replaceCapabilityWorkspaceContentRecord(capabilityId, updates);
      syncWorkspaceState(capabilityId, workspace);
      clearMutationStatus(capabilityId);
      return workspace;
    }).catch(error => {
      const message =
        error instanceof Error
          ? error.message
          : `Unable to update workspace content for ${capabilityId}.`;
      setMutationStatus(capabilityId, 'error', message);
      logMutationFailure(`workspace content for ${capabilityId}`, error);
      throw error;
    }) as Promise<CapabilityWorkspace>;
  };

  const updateWorkspaceSettings = async (updates: Partial<WorkspaceSettings>) => {
    ensureWritableState();
    const nextSettings = await updateWorkspaceSettingsRecord(updates);
    const applySharedDatabases = (capability: Capability): Capability => ({
      ...capability,
      databaseConfigs: nextSettings.databaseConfigs,
      databases: nextSettings.databaseConfigs
        .map(config => config.label)
        .filter(Boolean),
    });
    setWorkspaceSettings(nextSettings);
    setCapabilities(current => current.map(applySharedDatabases));
    setActiveCapabilityState(current =>
      current.id ? applySharedDatabases(current) : current,
    );
    setLastSyncError('');
    setBootStatus('ready');
    return nextSettings;
  };

  const setPreferredCapabilityId = (capabilityId?: string) => {
    const nextValue = capabilityId || '';
    setPreferredCapabilityIdState(nextValue);
    writeViewPreference(DEFAULT_CAPABILITY_PREFERENCE_KEY, nextValue || null);
    const currentUser = getCurrentWorkspaceUser({
      ...workspaceOrganizationRef.current,
      currentUserId:
        currentWorkspaceUserId || workspaceOrganizationRef.current.currentUserId,
    });
    if (currentUser?.id) {
      void updateWorkspaceUserPreferenceRecord(currentUser.id, {
        userId: currentUser.id,
        defaultCapabilityId: nextValue || undefined,
      }).catch(() => undefined);
      setWorkspaceOrganization(current => ({
        ...current,
        userPreferences: [
          ...current.userPreferences.filter(pref => pref.userId !== currentUser.id),
          {
            userId: currentUser.id,
            defaultCapabilityId: nextValue || undefined,
            lastSelectedTeamId:
              current.userPreferences.find(pref => pref.userId === currentUser.id)
                ?.lastSelectedTeamId,
            workbenchView:
              current.userPreferences.find(pref => pref.userId === currentUser.id)
                ?.workbenchView || 'MY_QUEUE',
          },
        ],
      }));
    }
  };

  const setCurrentWorkspaceUserId = (userId: string) => {
    const nextUserId = userId.trim();
    setCurrentWorkspaceUserIdState(nextUserId);
    writeViewPreference(DEFAULT_WORKSPACE_USER_KEY, nextUserId || null);
    setWorkspaceOrganization(current => ({
      ...current,
      currentUserId:
        nextUserId ||
        current.users.find(user => user.id === 'USR-WORKSPACE-OPERATOR')?.id ||
        current.users[0]?.id ||
        current.currentUserId,
    }));
  };

  const refreshCapabilityBundle = async (capabilityId: string) => {
    try {
      const bundle = await fetchCapabilityBundle(capabilityId);
      syncCapabilityBundleState(bundle, {
        activateCapabilityId:
          activeCapabilityRef.current.id === capabilityId ? capabilityId : undefined,
      });
      setLastSyncError('');
      setBootStatus('ready');
      return normalizeWorkspace(bundle.capability, bundle.workspace);
    } catch (error) {
      setLastSyncError(
        error instanceof Error
          ? error.message
          : `Unable to refresh workspace ${capabilityId}.`,
      );
      setBootStatus('degraded');
      return null;
    }
  };

  useEffect(() => {
    if (bootStatus !== 'ready' || !activeCapability.id) {
      return;
    }

    void refreshCapabilityBundle(activeCapability.id);
  }, [activeCapability.id]);

  useEffect(() => {
    const selectedUserId =
      currentWorkspaceUserId || workspaceOrganization.currentUserId || '';
    if (!selectedUserId || bootStatus !== 'ready') {
      return;
    }
    if (lastAuthorizedUserSyncRef.current === selectedUserId) {
      return;
    }

    lastAuthorizedUserSyncRef.current = selectedUserId;

    void (async () => {
      try {
        const nextState = normalizeAppState(
          await fetchAppState(),
          preferredCapabilityIdRef.current || activeCapabilityRef.current.id,
        );
        setCapabilities(nextState.capabilities);
        setCapabilityWorkspaces(nextState.capabilityWorkspaces);
        setWorkspaceSettings(nextState.workspaceSettings);
        setWorkspaceOrganization(nextState.workspaceOrganization);
        setActiveCapabilityState(nextState.activeCapability);
        setLastSyncError('');
        setBootStatus('ready');
      } catch (error) {
        lastAuthorizedUserSyncRef.current = '';
        setLastSyncError(
          error instanceof Error
            ? error.message
            : 'Unable to refresh capability permissions for the selected operator.',
        );
        setBootStatus('degraded');
      }
    })();
  }, [bootStatus, currentWorkspaceUserId, workspaceOrganization.currentUserId]);

  const currentActorContext = buildActorContextFromOrganization({
    ...workspaceOrganization,
    currentUserId: currentWorkspaceUserId || workspaceOrganization.currentUserId,
  });

  return (
    <CapabilityContext.Provider
      value={{
        bootStatus,
        lastSyncError,
        mutationStatusByCapability,
        activeCapability,
        setActiveCapability: capability => {
          setActiveCapabilityState(capability);
        },
        preferredCapabilityId,
        setPreferredCapabilityId,
        capabilities,
        capabilityWorkspaces,
        workspaceSettings,
        workspaceOrganization,
        currentActorContext,
        currentWorkspaceUserId:
          currentWorkspaceUserId || workspaceOrganization.currentUserId,
        setCurrentWorkspaceUserId,
        createCapability,
        getCapabilityWorkspace,
        updateCapabilityMetadata,
        addCapabilitySkill,
        removeCapabilitySkill,
        addCapabilityAgent,
        updateCapabilityAgent,
        updateCapabilityAgentModels,
        appendCapabilityMessage,
        setActiveChatAgent,
        setCapabilityWorkspaceContent,
        updateWorkspaceSettings,
        refreshCapabilityBundle,
        retryInitialSync: runInitialSync,
      }}
    >
      {children}
    </CapabilityContext.Provider>
  );
};

export const useCapability = () => {
  const context = useContext(CapabilityContext);
  if (context === undefined) {
    throw new Error('useCapability must be used within a CapabilityProvider');
  }
  return context;
};
