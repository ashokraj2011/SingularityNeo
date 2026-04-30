import type {
  Capability,
  CapabilityAgent,
  CapabilityContractDraft,
  CapabilityDependency,
  CapabilityRepository,
} from '../../src/contracts';
import { defaultModel } from '../domains/llm-gateway';
import {
  applyCapabilityArchitecture,
  getLegacyArtifactListsFromContract,
  normalizeAgentOperatingContract,
  normalizeAgentRoleStarterKey,
  normalizeCapabilityCollectionKind,
  normalizeCapabilityContractDraft,
  normalizeCapabilityDatabaseConfigs,
  normalizeCapabilityDependencies,
  normalizeCapabilityKind,
  normalizeCapabilityLifecycle,
  normalizeCapabilitySharedReferences,
} from '../domains/self-service';
import { createRuntimeId, slugify } from './runtimeIds';

export const normalizeCapabilityRepositoriesPayload = (
  capabilityId: string,
  repositories: unknown,
): CapabilityRepository[] =>
  Array.isArray(repositories)
    ? repositories
        .map((repository, index) => {
          const candidate = repository as Partial<CapabilityRepository>;
          const url = String(candidate?.url || '').trim();
          const label = String(candidate?.label || '').trim();
          if (!url && !label) {
            return null;
          }

          return {
            id:
              String(candidate?.id || '').trim() ||
              `${createRuntimeId('REPO')}-${index + 1}`,
            capabilityId,
            label:
              label ||
              url.split('/').pop()?.replace(/\.git$/i, '') ||
              `Repository ${index + 1}`,
            url: url || label,
            defaultBranch: String(candidate?.defaultBranch || '').trim() || 'main',
            localRootHint: String(candidate?.localRootHint || '').trim() || undefined,
            isPrimary: Boolean(candidate?.isPrimary),
            status: candidate?.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
          } satisfies CapabilityRepository;
        })
        .filter(Boolean) as CapabilityRepository[]
    : [];

export const ensureCapabilityCreatePayload = (
  capability: Partial<Capability> | undefined,
): Capability | null => {
  if (!capability?.name || !capability?.description) {
    return null;
  }

  const capabilityId = capability.id?.trim() || createRuntimeId('CAP');

  return {
    ...capability,
    id: capabilityId,
    domain: capability.domain || '',
    capabilityKind: normalizeCapabilityKind(
      capability.capabilityKind,
      capability.collectionKind,
    ),
    collectionKind: normalizeCapabilityCollectionKind(capability.collectionKind),
    description: capability.description,
    businessOutcome: capability.businessOutcome || '',
    successMetrics: capability.successMetrics || [],
    definitionOfDone: capability.definitionOfDone || '',
    requiredEvidenceKinds: capability.requiredEvidenceKinds || [],
    operatingPolicySummary: capability.operatingPolicySummary || '',
    applications: capability.applications || [],
    apis: capability.apis || [],
    databases: capability.databases || [],
    databaseConfigs: normalizeCapabilityDatabaseConfigs(
      capability.databaseConfigs || [],
    ),
    repositories: normalizeCapabilityRepositoriesPayload(capabilityId, capability.repositories),
    gitRepositories: capability.gitRepositories || [],
    localDirectories: capability.localDirectories || [],
    teamNames: capability.teamNames || [],
    stakeholders: capability.stakeholders || [],
    additionalMetadata: capability.additionalMetadata || [],
    dependencies: normalizeCapabilityDependencies(
      capabilityId,
      capability.dependencies as CapabilityDependency[] | undefined,
    ),
    sharedCapabilities:
      normalizeCapabilityKind(capability.capabilityKind, capability.collectionKind) ===
      'COLLECTION'
        ? normalizeCapabilitySharedReferences(
            capabilityId,
            capability.sharedCapabilities,
          )
        : [],
    contractDraft: normalizeCapabilityContractDraft(
      capability.contractDraft as Partial<CapabilityContractDraft> | undefined,
    ),
    publishedSnapshots: capability.publishedSnapshots || [],
    lifecycle: normalizeCapabilityLifecycle(capability.lifecycle),
    skillLibrary: capability.skillLibrary || [],
    status: capability.status || 'PENDING',
    isSystemCapability: false,
    systemCapabilityRole: undefined,
    executionConfig: capability.executionConfig || {
      allowedWorkspacePaths: [],
      commandTemplates: [],
      deploymentTargets: [],
    },
  } as Capability;
};

export const ensureAgentCreatePayload = (
  capabilityId: string,
  agent: Partial<Omit<CapabilityAgent, 'capabilityId'>> | undefined,
): Omit<CapabilityAgent, 'capabilityId'> | null => {
  if (!agent?.name || !agent?.role || !agent?.objective) {
    return null;
  }

  const contract = normalizeAgentOperatingContract(agent.contract, {
    description: agent.objective || agent.role,
    suggestedInputArtifacts: agent.inputArtifacts || [],
    expectedOutputArtifacts: agent.outputArtifacts || [],
  });

  return {
    ...agent,
    id:
      agent.id?.trim() ||
      `AGENT-${slugify(capabilityId)}-${slugify(agent.name || 'CUSTOM')}-${Math.random()
        .toString(36)
        .slice(2, 5)
        .toUpperCase()}`,
    name: agent.name,
    role: agent.role,
    roleStarterKey: normalizeAgentRoleStarterKey(agent.roleStarterKey),
    objective: agent.objective,
    systemPrompt: agent.systemPrompt || '',
    contract,
    initializationStatus: agent.initializationStatus || 'READY',
    documentationSources: agent.documentationSources || [],
    ...getLegacyArtifactListsFromContract(contract),
    learningNotes: agent.learningNotes || [],
    skillIds: agent.skillIds || [],
    preferredToolIds: agent.preferredToolIds || [],
    provider: agent.provider || 'GitHub Copilot SDK',
    model: agent.model || defaultModel,
    tokenLimit:
      typeof agent.tokenLimit === 'number' && Number.isFinite(agent.tokenLimit)
        ? agent.tokenLimit
        : 12000,
    learningProfile: agent.learningProfile,
    sessionSummaries: agent.sessionSummaries || [],
    usage: agent.usage,
    previousOutputs: agent.previousOutputs || [],
    isBuiltIn: agent.isBuiltIn,
    isOwner: agent.isOwner,
  } as Omit<CapabilityAgent, 'capabilityId'>;
};
