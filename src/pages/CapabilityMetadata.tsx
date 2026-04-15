import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Building2,
  Database,
  FolderCode,
  GitBranch,
  KeyRound,
  Layers,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  CommandTemplateEditor,
  DeploymentTargetEditor,
  WorkspaceProfileRecommendationCard,
} from '../components/CapabilityExecutionSetup';
import CapabilityLifecycleEditor from '../components/CapabilityLifecycleEditor';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { cn } from '../lib/utils';
import {
  fetchCapabilityAlmExport,
  clearRuntimeCredentials,
  detectCapabilityWorkspaceProfile,
  fetchRuntimeStatus,
  publishCapabilityContract,
  updateRuntimeCredentials,
  type RuntimeStatus,
} from '../lib/api';
import {
  createLifecyclePhase,
  getLifecyclePhaseUsage,
  getLifecyclePhaseLabel,
  moveLifecyclePhase,
  normalizeCapabilityLifecycle,
  remapWorkflowPhaseReferences,
  renameLifecyclePhase,
  retireLifecyclePhase,
} from '../lib/capabilityLifecycle';
import { normalizeCapabilityPhaseOwnershipRules } from '../lib/capabilityOwnership';
import { toWorkspaceTeamId } from '../lib/workspaceOrganization';
import { buildWorkflowFromGraph, normalizeWorkflowGraph } from '../lib/workflowGraph';
import {
  Capability,
  CapabilityAlmReference,
  CapabilityCollectionKind,
  CapabilityContractDraft,
  CapabilityDependency,
  CapabilityMetadataEntry,
  CapabilityPhaseOwnershipRule,
  CapabilityRepository,
  CapabilityPublishedSnapshot,
  CapabilityStakeholder,
  FunctionalRequirementRecord,
  NonFunctionalRequirementRecord,
  ApiContractReference,
  SoftwareVersionRecord,
  WorkspaceDetectionResult,
} from '../types';
import {
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';

const listToText = (items: string[]) => items.join('\n');

const textToList = (value: string) =>
  value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);

const repositoriesToText = (repositories: CapabilityRepository[]) =>
  repositories
    .map(repository =>
      [
        repository.label,
        repository.url,
        repository.defaultBranch || 'main',
        repository.localRootHint || '',
        repository.isPrimary ? 'primary' : '',
      ].join(' | '),
    )
    .join('\n');

const textToRepositories = (
  capabilityId: string,
  value: string,
): CapabilityRepository[] =>
  value
    .split('\n')
    .map((line, index) => {
      const [label = '', url = '', defaultBranch = '', localRootHint = '', flag = ''] = line
        .split('|')
        .map(part => part.trim());

      if (!label && !url && !localRootHint) {
        return null;
      }

      const normalizedUrl = url || localRootHint;
      return {
        id: `REPO-${capabilityId}-${index + 1}`,
        capabilityId,
        label: label || normalizedUrl.split('/').pop()?.replace(/\.git$/i, '') || `Repository ${index + 1}`,
        url: normalizedUrl,
        defaultBranch: defaultBranch || 'main',
        localRootHint: localRootHint || undefined,
        isPrimary: flag.toLowerCase() === 'primary' || index === 0,
        status: 'ACTIVE',
      } satisfies CapabilityRepository;
    })
    .filter(Boolean) as CapabilityRepository[];

const dependencyListToText = (dependencies: CapabilityDependency[] = []) =>
  dependencies
    .map(dependency =>
      [
        dependency.targetCapabilityId,
        dependency.dependencyKind,
        dependency.criticality,
        dependency.versionConstraint || '',
        dependency.description || '',
      ].join(' | '),
    )
    .join('\n');

const textToDependencies = (
  capabilityId: string,
  value: string,
): CapabilityDependency[] =>
  value
    .split('\n')
    .map((line, index) => {
      const [targetCapabilityId = '', dependencyKind = '', criticality = '', versionConstraint = '', description = ''] =
        line.split('|').map(part => part.trim());

      if (!targetCapabilityId && !description) {
        return null;
      }

      return {
        id: `DEP-${capabilityId}-${index + 1}`,
        capabilityId,
        targetCapabilityId,
        dependencyKind:
          (dependencyKind as CapabilityDependency['dependencyKind']) || 'FUNCTIONAL',
        criticality:
          (criticality as CapabilityDependency['criticality']) || 'MEDIUM',
        versionConstraint: versionConstraint || undefined,
        description,
      } satisfies CapabilityDependency;
    })
    .filter(Boolean) as CapabilityDependency[];

const requirementListToText = (
  items: FunctionalRequirementRecord[] | NonFunctionalRequirementRecord[] = [],
) =>
  items
    .map(item =>
      [
        item.title,
        item.description,
        'priority' in item ? item.priority || '' : item.category || '',
        'target' in item ? item.target || '' : '',
      ].join(' | '),
    )
    .join('\n');

const textToFunctionalRequirements = (value: string): FunctionalRequirementRecord[] =>
  value
    .split('\n')
    .map((line, index) => {
      const [title = '', description = '', priority = ''] = line
        .split('|')
        .map(part => part.trim());
      if (!title && !description) {
        return null;
      }
      return {
        id: `FR-${index + 1}`,
        title: title || `Requirement ${index + 1}`,
        description,
        priority:
          (priority as FunctionalRequirementRecord['priority']) || undefined,
      } satisfies FunctionalRequirementRecord;
    })
    .filter(Boolean) as FunctionalRequirementRecord[];

const textToNonFunctionalRequirements = (
  value: string,
): NonFunctionalRequirementRecord[] =>
  value
    .split('\n')
    .map((line, index) => {
      const [title = '', description = '', category = '', target = ''] = line
        .split('|')
        .map(part => part.trim());
      if (!title && !description) {
        return null;
      }
      return {
        id: `NFR-${index + 1}`,
        title: title || `Constraint ${index + 1}`,
        description,
        category:
          (category as NonFunctionalRequirementRecord['category']) || 'OTHER',
        target: target || undefined,
      } satisfies NonFunctionalRequirementRecord;
    })
    .filter(Boolean) as NonFunctionalRequirementRecord[];

const apiContractsToText = (items: ApiContractReference[] = []) =>
  items
    .map(item =>
      [
        item.name,
        item.kind || '',
        item.version || '',
        item.pathOrChannel || '',
        item.description || '',
      ].join(' | '),
    )
    .join('\n');

const textToApiContracts = (value: string): ApiContractReference[] =>
  value
    .split('\n')
    .map((line, index) => {
      const [name = '', kind = '', version = '', pathOrChannel = '', description = ''] =
        line.split('|').map(part => part.trim());
      if (!name && !description) {
        return null;
      }
      return {
        id: `API-${index + 1}`,
        name: name || `Interface ${index + 1}`,
        kind: (kind as ApiContractReference['kind']) || undefined,
        version: version || undefined,
        pathOrChannel: pathOrChannel || undefined,
        description: description || undefined,
      } satisfies ApiContractReference;
    })
    .filter(Boolean) as ApiContractReference[];

const softwareVersionsToText = (items: SoftwareVersionRecord[] = []) =>
  items
    .map(item =>
      [item.name, item.version, item.role || '', item.environment || '', item.notes || ''].join(
        ' | ',
      ),
    )
    .join('\n');

const textToSoftwareVersions = (value: string): SoftwareVersionRecord[] =>
  value
    .split('\n')
    .map((line, index) => {
      const [name = '', version = '', role = '', environment = '', notes = ''] = line
        .split('|')
        .map(part => part.trim());
      if (!name && !version) {
        return null;
      }
      return {
        id: `SW-${index + 1}`,
        name: name || `Component ${index + 1}`,
        version: version || 'unversioned',
        role: role || undefined,
        environment: environment || undefined,
        notes: notes || undefined,
      } satisfies SoftwareVersionRecord;
    })
    .filter(Boolean) as SoftwareVersionRecord[];

const almReferencesToText = (items: CapabilityAlmReference[] = []) =>
  items
    .map(item => [item.system, item.label, item.externalId || '', item.url || '', item.description || ''].join(' | '))
    .join('\n');

const textToAlmReferences = (value: string): CapabilityAlmReference[] =>
  value
    .split('\n')
    .map((line, index) => {
      const [system = '', label = '', externalId = '', url = '', description = ''] = line
        .split('|')
        .map(part => part.trim());
      if (!label && !externalId && !url) {
        return null;
      }
      return {
        id: `ALM-${index + 1}`,
        system: (system as CapabilityAlmReference['system']) || 'OTHER',
        label: label || `Reference ${index + 1}`,
        externalId: externalId || undefined,
        url: url || undefined,
        description: description || undefined,
      } satisfies CapabilityAlmReference;
    })
    .filter(Boolean) as CapabilityAlmReference[];

const contractDraftToForm = (draft?: CapabilityContractDraft) => ({
  contractOverview: draft?.overview || '',
  contractBusinessIntent: draft?.businessIntent || '',
  contractOwnershipModel: draft?.ownershipModel || '',
  contractDeploymentFootprint: draft?.deploymentFootprint || '',
  contractEvidenceAndReadiness: draft?.evidenceAndReadiness || '',
  contractFunctionalRequirements: requirementListToText(
    draft?.functionalRequirements || [],
  ),
  contractNonFunctionalRequirements: requirementListToText(
    draft?.nonFunctionalRequirements || [],
  ),
  contractApiContracts: apiContractsToText(draft?.apiContracts || []),
  contractSoftwareVersions: softwareVersionsToText(draft?.softwareVersions || []),
  contractAlmReferences: almReferencesToText(draft?.almReferences || []),
});

const defaultStakeholderRoles = [
  'Development Manager',
  'Squad Leader',
  'Team Lead',
];

const createStakeholder = (role = 'Stakeholder'): CapabilityStakeholder => ({
  role,
  name: '',
  email: '',
  teamName: '',
});

const createMetadataEntry = (): CapabilityMetadataEntry => ({
  key: '',
  value: '',
});

const hasStakeholderContent = (stakeholder: CapabilityStakeholder) =>
  Boolean(
    stakeholder.name.trim() ||
      stakeholder.email.trim() ||
      stakeholder.teamName?.trim(),
  );

const hasMetadataEntryContent = (entry: CapabilityMetadataEntry) =>
  Boolean(entry.key.trim() || entry.value.trim());

const normalizeStakeholders = (stakeholders: CapabilityStakeholder[]) => {
  const existing = [...stakeholders];
  const normalized = defaultStakeholderRoles.map(role => {
    const matchIndex = existing.findIndex(
      stakeholder => stakeholder.role.trim().toLowerCase() === role.toLowerCase(),
    );

    if (matchIndex === -1) {
      return createStakeholder(role);
    }

    const [match] = existing.splice(matchIndex, 1);
    return {
      role,
      name: match.name || '',
      email: match.email || '',
      teamName: match.teamName || '',
    };
  });

  return [
    ...normalized,
    ...existing.filter(hasStakeholderContent).map(stakeholder => ({
      role: stakeholder.role || 'Stakeholder',
      name: stakeholder.name || '',
      email: stakeholder.email || '',
      teamName: stakeholder.teamName || '',
    })),
  ];
};

export default function CapabilityMetadata() {
  const navigate = useNavigate();
  const {
    activeCapability,
    bootStatus,
    capabilities,
    getCapabilityWorkspace,
    lastSyncError,
    setCapabilityWorkspaceContent,
    updateCapabilityMetadata,
    workspaceSettings,
  } = useCapability();
  const { success, error: showError } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdatingRuntime, setIsUpdatingRuntime] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const ownerAgent = workspace.agents.find(agent => agent.isOwner) || workspace.agents[0];
  const siblingCapabilities = capabilities.filter(
    capability => capability.id !== activeCapability.id,
  );
  const parentCapability =
    capabilities.find(
      capability => capability.id === activeCapability.parentCapabilityId,
    ) || null;
  const subCapabilities = capabilities.filter(
    capability => capability.parentCapabilityId === activeCapability.id,
  );
  const ancestorCapabilityIds = new Set(activeCapability.hierarchyNode?.pathIds || [activeCapability.id]);
  const candidateChildCapabilities = capabilities.filter(capability => {
    if (capability.id === activeCapability.id) {
      return false;
    }
    if (ancestorCapabilityIds.has(capability.id)) {
      return false;
    }
    return true;
  });

  const [form, setForm] = useState({
    name: activeCapability.name,
    domain: activeCapability.domain || '',
    parentCapabilityId: activeCapability.parentCapabilityId || '',
    capabilityKind: activeCapability.capabilityKind || 'DELIVERY',
    collectionKind: (activeCapability.collectionKind || '') as
      | CapabilityCollectionKind
      | '',
    childCapabilityIds: subCapabilities.map(capability => capability.id),
    sharedCapabilityIds: (activeCapability.sharedCapabilities || []).map(
      reference => reference.memberCapabilityId,
    ),
    businessUnit: activeCapability.businessUnit || '',
    ownerTeam: activeCapability.ownerTeam || '',
    description: activeCapability.description,
    businessOutcome: activeCapability.businessOutcome || '',
    successMetrics: listToText(activeCapability.successMetrics),
    definitionOfDone: activeCapability.definitionOfDone || '',
    requiredEvidenceKinds: listToText(activeCapability.requiredEvidenceKinds),
    operatingPolicySummary: activeCapability.operatingPolicySummary || '',
    confluenceLink: activeCapability.confluenceLink || '',
    jiraBoardLink: activeCapability.jiraBoardLink || '',
    documentationNotes: activeCapability.documentationNotes || '',
    applications: listToText(activeCapability.applications),
    apis: listToText(activeCapability.apis),
    databases: listToText(activeCapability.databases),
    repositoriesCatalog: repositoriesToText(activeCapability.repositories || []),
    dependenciesText: dependencyListToText(activeCapability.dependencies || []),
    gitRepositories: listToText(activeCapability.gitRepositories),
    localDirectories: listToText(activeCapability.localDirectories),
    defaultWorkspacePath:
      activeCapability.executionConfig.defaultWorkspacePath || '',
    allowedWorkspacePaths: listToText(
      activeCapability.executionConfig.allowedWorkspacePaths,
    ),
    commandTemplates: activeCapability.executionConfig.commandTemplates,
    deploymentTargets: activeCapability.executionConfig.deploymentTargets,
    teamNames: listToText(activeCapability.teamNames),
    stakeholders: normalizeStakeholders(activeCapability.stakeholders),
    additionalMetadata:
      activeCapability.additionalMetadata.length > 0
        ? activeCapability.additionalMetadata
        : [createMetadataEntry()],
    ...contractDraftToForm(activeCapability.contractDraft),
  });
  const actsAsParentCapability =
    form.capabilityKind === 'COLLECTION' ||
    form.childCapabilityIds.length > 0 ||
    form.sharedCapabilityIds.length > 0;
  const availableChildCapabilities = useMemo(
    () =>
      candidateChildCapabilities.filter(
        capability => capability.id !== form.parentCapabilityId,
      ),
    [candidateChildCapabilities, form.parentCapabilityId],
  );
  const availableSharedCapabilities = useMemo(
    () =>
      capabilities.filter(
        capability =>
          capability.id !== activeCapability.id &&
          capability.id !== form.parentCapabilityId &&
          !form.childCapabilityIds.includes(capability.id),
      ),
    [activeCapability.id, capabilities, form.childCapabilityIds, form.parentCapabilityId],
  );
  const [isPublishingContract, setIsPublishingContract] = useState(false);
  const [almExportPreview, setAlmExportPreview] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeStatusError, setRuntimeStatusError] = useState('');
  const [runtimeTokenInput, setRuntimeTokenInput] = useState('');
  const [workspaceDetection, setWorkspaceDetection] =
    useState<WorkspaceDetectionResult | null>(null);
  const [workspaceDetectionDismissed, setWorkspaceDetectionDismissed] =
    useState(false);
  const [isRefreshingWorkspaceDetection, setIsRefreshingWorkspaceDetection] =
    useState(false);
  const capabilityLifecycle = useMemo(
    () => normalizeCapabilityLifecycle(activeCapability.lifecycle),
    [activeCapability.lifecycle],
  );
  const [lifecycleDraft, setLifecycleDraft] = useState(capabilityLifecycle);
  const [lifecycleDraftWorkflows, setLifecycleDraftWorkflows] = useState(
    workspace.workflows,
  );
  const [phaseOwnershipRulesDraft, setPhaseOwnershipRulesDraft] = useState<
    CapabilityPhaseOwnershipRule[]
  >(() => normalizeCapabilityPhaseOwnershipRules(activeCapability));
  const [pendingLifecycleDeletePhaseId, setPendingLifecycleDeletePhaseId] =
    useState<string | null>(null);
  const [lifecycleDeleteTargetPhaseId, setLifecycleDeleteTargetPhaseId] =
    useState('');
  const [isSavingLifecycle, setIsSavingLifecycle] = useState(false);

  useEffect(() => {
    setForm({
      name: activeCapability.name,
      domain: activeCapability.domain || '',
      parentCapabilityId: activeCapability.parentCapabilityId || '',
      capabilityKind: activeCapability.capabilityKind || 'DELIVERY',
      collectionKind: (activeCapability.collectionKind || '') as
        | CapabilityCollectionKind
        | '',
      childCapabilityIds: capabilities
        .filter(capability => capability.parentCapabilityId === activeCapability.id)
        .map(capability => capability.id),
      sharedCapabilityIds: (activeCapability.sharedCapabilities || []).map(
        reference => reference.memberCapabilityId,
      ),
      businessUnit: activeCapability.businessUnit || '',
      ownerTeam: activeCapability.ownerTeam || '',
      description: activeCapability.description,
      businessOutcome: activeCapability.businessOutcome || '',
      successMetrics: listToText(activeCapability.successMetrics),
      definitionOfDone: activeCapability.definitionOfDone || '',
      requiredEvidenceKinds: listToText(activeCapability.requiredEvidenceKinds),
      operatingPolicySummary: activeCapability.operatingPolicySummary || '',
      confluenceLink: activeCapability.confluenceLink || '',
      jiraBoardLink: activeCapability.jiraBoardLink || '',
      documentationNotes: activeCapability.documentationNotes || '',
      applications: listToText(activeCapability.applications),
      apis: listToText(activeCapability.apis),
      databases: listToText(activeCapability.databases),
      repositoriesCatalog: repositoriesToText(activeCapability.repositories || []),
      dependenciesText: dependencyListToText(activeCapability.dependencies || []),
      gitRepositories: listToText(activeCapability.gitRepositories),
      localDirectories: listToText(activeCapability.localDirectories),
      defaultWorkspacePath:
        activeCapability.executionConfig.defaultWorkspacePath || '',
      allowedWorkspacePaths: listToText(
        activeCapability.executionConfig.allowedWorkspacePaths,
      ),
      commandTemplates: activeCapability.executionConfig.commandTemplates,
      deploymentTargets: activeCapability.executionConfig.deploymentTargets,
      teamNames: listToText(activeCapability.teamNames),
      stakeholders: normalizeStakeholders(activeCapability.stakeholders),
      additionalMetadata:
        activeCapability.additionalMetadata.length > 0
          ? activeCapability.additionalMetadata
          : [createMetadataEntry()],
      ...contractDraftToForm(activeCapability.contractDraft),
    });
    setSaveError('');
    setLastSavedAt('');
    setWorkspaceDetection(null);
    setWorkspaceDetectionDismissed(false);
    setAlmExportPreview('');
  }, [activeCapability]);

  useEffect(() => {
    setLifecycleDraft(capabilityLifecycle);
    setLifecycleDraftWorkflows(workspace.workflows);
    setPhaseOwnershipRulesDraft(normalizeCapabilityPhaseOwnershipRules(activeCapability));
    setPendingLifecycleDeletePhaseId(null);
    setLifecycleDeleteTargetPhaseId('');
  }, [activeCapability, capabilityLifecycle, workspace.workflows]);

  useEffect(() => {
    let isMounted = true;

    fetchRuntimeStatus()
      .then(status => {
        if (!isMounted) {
          return;
        }

        setRuntimeStatus(status);
        setRuntimeStatusError('');
      })
      .catch(error => {
        if (!isMounted) {
          return;
        }

        setRuntimeStatusError(
          error instanceof Error
            ? error.message
            : 'Unable to load GitHub runtime identity.',
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const canSave = Boolean(form.name.trim() && form.description.trim());

  const filteredStakeholders = useMemo(
    () => form.stakeholders.filter(hasStakeholderContent),
    [form.stakeholders],
  );
  const filteredMetadataEntries = useMemo(
    () => form.additionalMetadata.filter(hasMetadataEntryContent),
    [form.additionalMetadata],
  );
  const capabilityLifecycleLabel =
    activeCapability.status === 'ARCHIVED' ? 'Inactive' : 'Active';
  const runtimeAccessLabel =
    runtimeStatus?.runtimeAccessMode === 'copilot-session'
      ? 'Copilot session'
      : runtimeStatus?.runtimeAccessMode === 'headless-cli'
      ? 'Headless CLI'
      : runtimeStatus?.runtimeAccessMode === 'http-fallback'
      ? 'HTTP fallback'
      : 'Unconfigured';
  const runtimeTokenSourceLabel =
    runtimeStatus?.tokenSource === 'headless-cli'
      ? 'COPILOT_CLI_URL'
      : runtimeStatus?.tokenSource === 'runtime-override'
      ? 'UI override'
      : runtimeStatus?.tokenSource === 'GITHUB_MODELS_TOKEN'
      ? 'GITHUB_MODELS_TOKEN'
      : runtimeStatus?.tokenSource === 'GITHUB_TOKEN'
      ? 'GITHUB_TOKEN'
      : 'No credential';

  const metadataSummary = useMemo(
    () => [
      { label: 'Teams', value: textToList(form.teamNames).length },
      { label: 'Stakeholders', value: filteredStakeholders.length },
      { label: 'Success Metrics', value: textToList(form.successMetrics).length },
      { label: 'Evidence Needs', value: textToList(form.requiredEvidenceKinds).length },
      { label: 'Direct children', value: form.childCapabilityIds.length },
      { label: 'Shared capabilities', value: form.sharedCapabilityIds.length },
      { label: 'Repos', value: textToRepositories(activeCapability.id, form.repositoriesCatalog).length },
      { label: 'Local Dirs', value: textToList(form.localDirectories).length },
    ],
    [
      form.childCapabilityIds.length,
      form.sharedCapabilityIds.length,
      filteredStakeholders.length,
      form.localDirectories,
      form.repositoriesCatalog,
      form.requiredEvidenceKinds,
      form.successMetrics,
      form.teamNames,
      activeCapability.id,
    ],
  );
  const phaseOwnershipTeamOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [form.ownerTeam.trim(), ...textToList(form.teamNames)]
            .filter(Boolean)
            .map(teamName => teamName.trim()),
        ),
      ).map(teamName => ({
        id: toWorkspaceTeamId(teamName),
        label: teamName,
      })),
    [form.ownerTeam, form.teamNames],
  );
  const approvedWorkspacePaths = useMemo(
    () =>
      Array.from(
        new Set(
          [
            form.defaultWorkspacePath.trim(),
            ...textToList(form.localDirectories),
            ...textToList(form.allowedWorkspacePaths),
            ...textToRepositories(activeCapability.id, form.repositoriesCatalog)
              .map(repository => repository.localRootHint || '')
              .filter(Boolean),
          ].filter(Boolean),
        ),
      ),
    [
      activeCapability.id,
      form.allowedWorkspacePaths,
      form.defaultWorkspacePath,
      form.localDirectories,
      form.repositoriesCatalog,
    ],
  );
  const workspaceDetectionSignature = useMemo(
    () =>
      JSON.stringify({
        defaultWorkspacePath: form.defaultWorkspacePath.trim(),
        approvedWorkspacePaths,
      }),
    [approvedWorkspacePaths, form.defaultWorkspacePath],
  );

  const refreshWorkspaceDetection = async () => {
    if (approvedWorkspacePaths.length === 0) {
      setWorkspaceDetection(null);
      setWorkspaceDetectionDismissed(false);
      return;
    }

    setIsRefreshingWorkspaceDetection(true);
    try {
      const result = await detectCapabilityWorkspaceProfile(activeCapability.id, {
        defaultWorkspacePath: form.defaultWorkspacePath.trim() || undefined,
        approvedWorkspacePaths,
      });
      setWorkspaceDetection(result);
      setWorkspaceDetectionDismissed(false);
    } catch (error) {
      showError(
        'Workspace detection failed',
        error instanceof Error
          ? error.message
          : 'Unable to infer the workspace stack right now.',
      );
    } finally {
      setIsRefreshingWorkspaceDetection(false);
    }
  };

  const applyRecommendedExecutionSetup = (
    commandTemplates: Capability['executionConfig']['commandTemplates'],
    deploymentTargets: Capability['executionConfig']['deploymentTargets'],
  ) => {
    setForm(prev => ({ ...prev, commandTemplates, deploymentTargets }));
    setWorkspaceDetectionDismissed(false);
  };

  useEffect(() => {
    if (approvedWorkspacePaths.length === 0) {
      setWorkspaceDetection(null);
      setWorkspaceDetectionDismissed(false);
      return;
    }

    void refreshWorkspaceDetection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCapability.id]);

  const setField = (field: keyof typeof form, value: string) => {
    setSaveError('');
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const toggleChildCapabilitySelection = (childCapabilityId: string) => {
    setSaveError('');
    setForm(prev => {
      const nextIds = new Set(prev.childCapabilityIds);
      if (nextIds.has(childCapabilityId)) {
        nextIds.delete(childCapabilityId);
      } else {
        nextIds.add(childCapabilityId);
      }
      return {
        ...prev,
        childCapabilityIds: [...nextIds],
        sharedCapabilityIds: prev.sharedCapabilityIds.filter(id => id !== childCapabilityId),
      };
    });
  };

  const toggleSharedCapabilitySelection = (sharedCapabilityId: string) => {
    setSaveError('');
    setForm(prev => {
      const nextIds = new Set(prev.sharedCapabilityIds);
      if (nextIds.has(sharedCapabilityId)) {
        nextIds.delete(sharedCapabilityId);
      } else {
        nextIds.add(sharedCapabilityId);
      }
      return {
        ...prev,
        sharedCapabilityIds: [...nextIds],
        childCapabilityIds: prev.childCapabilityIds.filter(id => id !== sharedCapabilityId),
      };
    });
  };

  useEffect(() => {
    setWorkspaceDetection(null);
    setWorkspaceDetectionDismissed(false);
  }, [workspaceDetectionSignature]);

  const normalizeLifecycleWorkflows = (
    workflowsToNormalize: typeof workspace.workflows,
    lifecycle = capabilityLifecycle,
  ) =>
    workflowsToNormalize.map(workflow =>
      buildWorkflowFromGraph(normalizeWorkflowGraph(workflow, lifecycle), lifecycle),
    );

  const lifecyclePhaseViews = useMemo(
    () =>
      lifecycleDraft.phases.map(phase => {
        const usage = getLifecyclePhaseUsage(
          {
            workItems: workspace.workItems,
            tasks: workspace.tasks,
          },
          lifecycleDraftWorkflows,
          phase.id,
        );
        const referencedByWorkflow =
          usage.workflowNodeCount + usage.workflowStepCount + usage.handoffTargetCount > 0;
        const blockedByLiveWork =
          usage.activeWorkItemCount > 0 || usage.pendingTaskCount > 0;

        const usageSummary = [
          usage.workflowNodeCount ? `${usage.workflowNodeCount} workflow nodes` : '',
          usage.workflowStepCount ? `${usage.workflowStepCount} workflow steps` : '',
          usage.handoffTargetCount ? `${usage.handoffTargetCount} hand-off targets` : '',
        ]
          .filter(Boolean)
          .join(', ');

        return {
          phase,
          usageSummary: usageSummary
            ? `Used by ${usageSummary}.`
            : 'Not used by saved workflows yet.',
          canDelete: lifecycleDraft.phases.length > 1 && !blockedByLiveWork,
          deleteHint: blockedByLiveWork
            ? 'Move or complete live work and workflow-managed tasks in this phase before deleting it.'
            : referencedByWorkflow
            ? 'Deleting this phase will require remapping workflow references.'
            : lifecycleDraft.phases.length <= 1
            ? 'At least one visible lifecycle phase must remain.'
            : undefined,
        };
      }),
    [lifecycleDraft.phases, lifecycleDraftWorkflows, workspace.tasks, workspace.workItems],
  );

  const lifecycleSnapshot = useMemo(
    () =>
      JSON.stringify({
        lifecycle: lifecycleDraft,
        workflows: lifecycleDraftWorkflows,
      }),
    [lifecycleDraft, lifecycleDraftWorkflows],
  );
  const activeLifecycleSnapshot = useMemo(
    () =>
      JSON.stringify({
        lifecycle: capabilityLifecycle,
        workflows: workspace.workflows,
      }),
    [capabilityLifecycle, workspace.workflows],
  );
  const lifecycleDirty = lifecycleSnapshot !== activeLifecycleSnapshot;

  const formPayload = useMemo<Partial<Capability>>(
    () => {
      const repositories = textToRepositories(activeCapability.id, form.repositoriesCatalog);
      const contractDraft: CapabilityContractDraft = {
        overview: form.contractOverview.trim() || undefined,
        businessIntent: form.contractBusinessIntent.trim() || undefined,
        ownershipModel: form.contractOwnershipModel.trim() || undefined,
        deploymentFootprint: form.contractDeploymentFootprint.trim() || undefined,
        evidenceAndReadiness: form.contractEvidenceAndReadiness.trim() || undefined,
        functionalRequirements: textToFunctionalRequirements(
          form.contractFunctionalRequirements,
        ),
        nonFunctionalRequirements: textToNonFunctionalRequirements(
          form.contractNonFunctionalRequirements,
        ),
        apiContracts: textToApiContracts(form.contractApiContracts),
        softwareVersions: textToSoftwareVersions(form.contractSoftwareVersions),
        almReferences: textToAlmReferences(form.contractAlmReferences),
        sections: [],
        additionalMetadata: filteredMetadataEntries,
      };
      return {
        name: form.name.trim(),
        domain: form.domain.trim(),
        parentCapabilityId: form.parentCapabilityId || undefined,
        capabilityKind: form.capabilityKind,
        collectionKind:
          form.capabilityKind === 'COLLECTION'
            ? form.collectionKind || undefined
            : undefined,
        businessUnit: form.businessUnit.trim(),
        ownerTeam: form.ownerTeam.trim() || undefined,
        description: form.description.trim(),
        businessOutcome: form.businessOutcome.trim() || undefined,
        successMetrics: textToList(form.successMetrics),
        definitionOfDone: form.definitionOfDone.trim() || undefined,
        requiredEvidenceKinds: textToList(form.requiredEvidenceKinds),
        operatingPolicySummary: form.operatingPolicySummary.trim() || undefined,
        confluenceLink: form.confluenceLink.trim() || undefined,
        jiraBoardLink: form.jiraBoardLink.trim() || undefined,
        documentationNotes: form.documentationNotes.trim() || undefined,
        applications: textToList(form.applications),
        apis: textToList(form.apis),
        databases: textToList(form.databases),
        repositories,
        dependencies: textToDependencies(activeCapability.id, form.dependenciesText),
        sharedCapabilities:
          form.capabilityKind === 'COLLECTION'
            ? form.sharedCapabilityIds.map((memberCapabilityId, index) => ({
                id: `SHARED-${activeCapability.id}-${index + 1}`,
                collectionCapabilityId: activeCapability.id,
                memberCapabilityId,
                label:
                  capabilities.find(capability => capability.id === memberCapabilityId)?.name ||
                  undefined,
              }))
            : [],
        contractDraft,
        gitRepositories: Array.from(
          new Set([
            ...repositories.map(repository => repository.url).filter(Boolean),
            ...textToList(form.gitRepositories),
          ]),
        ),
        localDirectories: Array.from(
          new Set([
            ...repositories
              .map(repository => repository.localRootHint || '')
              .filter(Boolean),
            ...textToList(form.localDirectories),
          ]),
        ),
        executionConfig: {
          defaultWorkspacePath: form.defaultWorkspacePath.trim() || undefined,
          allowedWorkspacePaths: textToList(form.allowedWorkspacePaths),
          commandTemplates: form.commandTemplates,
          deploymentTargets: form.deploymentTargets,
        },
        teamNames: textToList(form.teamNames),
        stakeholders: filteredStakeholders,
        additionalMetadata: filteredMetadataEntries,
        phaseOwnershipRules: phaseOwnershipRulesDraft,
      };
    },
    [
      activeCapability.id,
      capabilities,
      filteredMetadataEntries,
      filteredStakeholders,
      form.allowedWorkspacePaths,
      form.apis,
      form.applications,
      form.businessUnit,
      form.capabilityKind,
      form.commandTemplates,
      form.confluenceLink,
      form.contractAlmReferences,
      form.contractApiContracts,
      form.contractBusinessIntent,
      form.contractDeploymentFootprint,
      form.contractEvidenceAndReadiness,
      form.contractFunctionalRequirements,
      form.contractNonFunctionalRequirements,
      form.contractOverview,
      form.contractOwnershipModel,
      form.contractSoftwareVersions,
      form.databases,
      form.defaultWorkspacePath,
      form.definitionOfDone,
      form.deploymentTargets,
      form.description,
      form.documentationNotes,
      form.domain,
      form.gitRepositories,
      form.jiraBoardLink,
      form.localDirectories,
      form.name,
      form.operatingPolicySummary,
      form.ownerTeam,
      form.parentCapabilityId,
      form.collectionKind,
      form.sharedCapabilityIds,
      form.dependenciesText,
      form.repositoriesCatalog,
      form.requiredEvidenceKinds,
      form.successMetrics,
      form.teamNames,
      phaseOwnershipRulesDraft,
    ],
  );
  const activeCapabilitySnapshot = useMemo(
    () =>
      JSON.stringify({
        name: activeCapability.name,
        domain: activeCapability.domain || '',
        parentCapabilityId: activeCapability.parentCapabilityId || undefined,
        childCapabilityIds: subCapabilities.map(capability => capability.id).sort(),
        sharedCapabilityIds: (activeCapability.sharedCapabilities || [])
          .map(reference => reference.memberCapabilityId)
          .sort(),
        capabilityKind: activeCapability.capabilityKind || 'DELIVERY',
        collectionKind: activeCapability.collectionKind || undefined,
        businessUnit: activeCapability.businessUnit || '',
        ownerTeam: activeCapability.ownerTeam || undefined,
        description: activeCapability.description,
        businessOutcome: activeCapability.businessOutcome || undefined,
        successMetrics: activeCapability.successMetrics,
        definitionOfDone: activeCapability.definitionOfDone || undefined,
        requiredEvidenceKinds: activeCapability.requiredEvidenceKinds,
        operatingPolicySummary: activeCapability.operatingPolicySummary || undefined,
        confluenceLink: activeCapability.confluenceLink || undefined,
        jiraBoardLink: activeCapability.jiraBoardLink || undefined,
        documentationNotes: activeCapability.documentationNotes || undefined,
        applications: activeCapability.applications,
        apis: activeCapability.apis,
        databases: activeCapability.databases,
        repositories: activeCapability.repositories || [],
        dependencies: activeCapability.dependencies || [],
        contractDraft: activeCapability.contractDraft,
        gitRepositories: activeCapability.gitRepositories,
        localDirectories: activeCapability.localDirectories,
        executionConfig: activeCapability.executionConfig,
        teamNames: activeCapability.teamNames,
        stakeholders: activeCapability.stakeholders.filter(hasStakeholderContent),
        additionalMetadata: activeCapability.additionalMetadata.filter(hasMetadataEntryContent),
        phaseOwnershipRules: normalizeCapabilityPhaseOwnershipRules(activeCapability),
      }),
    [activeCapability, subCapabilities],
  );
  const formSnapshot = useMemo(
    () =>
      JSON.stringify({
        ...formPayload,
        childCapabilityIds: [...form.childCapabilityIds].sort(),
        sharedCapabilityIds: [...form.sharedCapabilityIds].sort(),
      }),
    [form.childCapabilityIds, form.sharedCapabilityIds, formPayload],
  );
  const saveState =
    isSaving
      ? 'saving'
      : saveError
        ? 'error'
        : formSnapshot !== activeCapabilitySnapshot
          ? 'unsaved'
          : lastSavedAt
            ? 'saved'
            : 'idle';

  const updateStakeholder = (
    index: number,
    field: keyof CapabilityStakeholder,
    value: string,
  ) => {
    setForm(prev => ({
      ...prev,
      stakeholders: prev.stakeholders.map((stakeholder, stakeholderIndex) =>
        stakeholderIndex === index
          ? { ...stakeholder, [field]: value }
          : stakeholder,
      ),
    }));
  };

  const addStakeholder = () => {
    setForm(prev => ({
      ...prev,
      stakeholders: [...prev.stakeholders, createStakeholder()],
    }));
  };

  const removeStakeholder = (index: number) => {
    setForm(prev => ({
      ...prev,
      stakeholders: prev.stakeholders.filter(
        (_stakeholder, stakeholderIndex) => stakeholderIndex !== index,
      ),
    }));
  };

  const updatePhaseOwnershipRule = (
    phaseId: string,
    field: keyof CapabilityPhaseOwnershipRule,
    value: string | string[],
  ) => {
    setPhaseOwnershipRulesDraft(current =>
      current.map(rule =>
        rule.phaseId === phaseId
          ? {
              ...rule,
              [field]:
                typeof value === 'string'
                  ? value || undefined
                  : value,
            }
          : rule,
      ),
    );
  };

  const updateMetadataEntry = (
    index: number,
    field: keyof CapabilityMetadataEntry,
    value: string,
  ) => {
    setForm(prev => ({
      ...prev,
      additionalMetadata: prev.additionalMetadata.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    }));
  };

  const addMetadataEntry = () => {
    setForm(prev => ({
      ...prev,
      additionalMetadata: [...prev.additionalMetadata, createMetadataEntry()],
    }));
  };

  const removeMetadataEntry = (index: number) => {
    setForm(prev => ({
      ...prev,
      additionalMetadata: prev.additionalMetadata.filter(
        (_entry, entryIndex) => entryIndex !== index,
      ),
    }));
  };

  const handleAddLifecyclePhase = () => {
    const allPhaseIds = [
      ...lifecycleDraft.phases.map(phase => phase.id),
      ...lifecycleDraft.retiredPhases.map(phase => phase.id),
    ];
    setLifecycleDraft(current => ({
      ...current,
      phases: [
        ...current.phases,
        createLifecyclePhase(`Phase ${current.phases.length + 1}`, allPhaseIds),
      ],
    }));
  };

  const handleRenameLifecyclePhase = (phaseId: string, label: string) => {
    setLifecycleDraft(current => renameLifecyclePhase(current, phaseId, label));
  };

  const handleMoveLifecyclePhase = (
    phaseId: string,
    direction: 'up' | 'down',
  ) => {
    setLifecycleDraft(current => moveLifecyclePhase(current, phaseId, direction));
  };

  const handleDeleteLifecyclePhase = (phaseId: string) => {
    const usage = getLifecyclePhaseUsage(
      {
        workItems: workspace.workItems,
        tasks: workspace.tasks,
      },
      lifecycleDraftWorkflows,
      phaseId,
    );

    if (lifecycleDraft.phases.length <= 1) {
      showError(
        'Cannot remove the last phase',
        'Keep at least one visible lifecycle phase between Backlog and Done.',
      );
      return;
    }

    if (usage.activeWorkItemCount > 0 || usage.pendingTaskCount > 0) {
      showError(
        'Phase is still active',
        'Move or complete live work and workflow-managed tasks before deleting this lifecycle phase.',
      );
      return;
    }

    if (usage.workflowNodeCount + usage.workflowStepCount + usage.handoffTargetCount > 0) {
      const fallbackPhaseId =
        lifecycleDraft.phases.find(phase => phase.id !== phaseId)?.id || '';
      setPendingLifecycleDeletePhaseId(phaseId);
      setLifecycleDeleteTargetPhaseId(fallbackPhaseId);
      return;
    }

    setLifecycleDraft(current => retireLifecyclePhase(current, phaseId));
  };

  const handleConfirmLifecycleDelete = () => {
    if (!pendingLifecycleDeletePhaseId || !lifecycleDeleteTargetPhaseId) {
      return;
    }

    const nextLifecycle = retireLifecyclePhase(
      lifecycleDraft,
      pendingLifecycleDeletePhaseId,
    );
    setLifecycleDraft(nextLifecycle);
    setLifecycleDraftWorkflows(current =>
      normalizeLifecycleWorkflows(
        remapWorkflowPhaseReferences(
          current,
          pendingLifecycleDeletePhaseId,
          lifecycleDeleteTargetPhaseId,
        ),
        nextLifecycle,
      ),
    );
    setPendingLifecycleDeletePhaseId(null);
    setLifecycleDeleteTargetPhaseId('');
  };

  const handleResetLifecycleDraft = () => {
    setLifecycleDraft(capabilityLifecycle);
    setLifecycleDraftWorkflows(workspace.workflows);
    setPendingLifecycleDeletePhaseId(null);
    setLifecycleDeleteTargetPhaseId('');
  };

  const handleSaveLifecycle = async () => {
    const hasBlankLabel = lifecycleDraft.phases.some(phase => !phase.label.trim());
    if (hasBlankLabel) {
      showError(
        'Lifecycle needs names',
        'Give every lifecycle phase a visible label before saving.',
      );
      return;
    }

    const nextLifecycle = normalizeCapabilityLifecycle(lifecycleDraft);
    const normalizedWorkflows = normalizeLifecycleWorkflows(
      lifecycleDraftWorkflows,
      nextLifecycle,
    );

    setIsSavingLifecycle(true);
    try {
      await setCapabilityWorkspaceContent(activeCapability.id, {
        workflows: normalizedWorkflows,
      });
      await updateCapabilityMetadata(activeCapability.id, {
        lifecycle: nextLifecycle,
      });
      setLastSavedAt(new Date().toISOString());
      success(
        'Capability lifecycle saved',
        'Designer lanes, work board columns, and evidence labels now use the updated lifecycle.',
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to save the capability lifecycle.';
      showError('Capability lifecycle save failed', message);
    } finally {
      setIsSavingLifecycle(false);
    }
  };

  const handleSave = (event: React.FormEvent) => {
    void (async () => {
      event.preventDefault();
      if (!canSave || bootStatus !== 'ready') {
        return;
      }

      setIsSaving(true);
      setSaveError('');
      try {
        await updateCapabilityMetadata(activeCapability.id, formPayload);
        const existingChildIds = new Set(subCapabilities.map(capability => capability.id));
        const nextChildIds = new Set(form.childCapabilityIds);
        const childAttachIds = [...nextChildIds].filter(id => !existingChildIds.has(id));
        const childDetachIds = [...existingChildIds].filter(id => !nextChildIds.has(id));

        if (childAttachIds.length > 0 || childDetachIds.length > 0) {
          await Promise.all([
            ...childAttachIds.map(childCapabilityId =>
              updateCapabilityMetadata(childCapabilityId, {
                parentCapabilityId: activeCapability.id,
              }),
            ),
            ...childDetachIds.map(childCapabilityId =>
              updateCapabilityMetadata(childCapabilityId, {
                parentCapabilityId: undefined,
              }),
            ),
          ]);
        }
        setLastSavedAt(new Date().toISOString());
        success(
          'Capability metadata saved',
          childAttachIds.length > 0 || childDetachIds.length > 0
            ? `${form.name.trim()} now reflects the latest business charter and parent-child hierarchy updates.`
            : `${form.name.trim()} now reflects the latest business charter and execution governance details.`,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to save capability metadata.';
        setSaveError(message);
        showError('Capability metadata save failed', message);
      } finally {
        setIsSaving(false);
      }
    })();
  };

  const handlePublishContract = async () => {
    setIsPublishingContract(true);
    try {
      await updateCapabilityMetadata(activeCapability.id, formPayload);
      const result = await publishCapabilityContract(activeCapability.id);
      setLastSavedAt(new Date().toISOString());
      success(
        'Capability contract published',
        `${activeCapability.name} is now published at version ${result.snapshot?.publishVersion || '?'}. Parent rollups and ALM exports will use this snapshot.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to publish the capability contract.';
      showError('Capability publish failed', message);
    } finally {
      setIsPublishingContract(false);
    }
  };

  const handlePreviewAlmExport = async () => {
    try {
      const payload = await fetchCapabilityAlmExport(activeCapability.id);
      setAlmExportPreview(JSON.stringify(payload, null, 2));
    } catch (error) {
      showError(
        'ALM export failed',
        error instanceof Error
          ? error.message
          : 'Unable to build the ALM export preview.',
      );
    }
  };

  const handleStatusToggle = () => {
    void (async () => {
    const nextStatus = activeCapability.status === 'ARCHIVED' ? 'STABLE' : 'ARCHIVED';
    const confirmed = window.confirm(
      `${
        nextStatus === 'ARCHIVED' ? 'Make inactive' : 'Reactivate'
      } ${activeCapability.name}?`,
    );

    if (!confirmed) {
      return;
    }

    try {
      await updateCapabilityMetadata(activeCapability.id, {
        status: nextStatus,
      });
      setLastSavedAt(new Date().toISOString());
      success(
        nextStatus === 'ARCHIVED'
          ? 'Capability made inactive'
          : 'Capability reactivated',
        `${activeCapability.name} lifecycle state was updated.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to update the capability lifecycle state.';
      setSaveError(message);
      showError('Capability lifecycle update failed', message);
    }
    })();
  };

  const refreshRuntimeIdentity = async () => {
    try {
      const status = await fetchRuntimeStatus();
      setRuntimeStatus(status);
      setRuntimeStatusError('');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to refresh runtime identity.';
      setRuntimeStatusError(message);
      showError('Runtime refresh failed', message);
    }
  };

  const handleRuntimeOverrideSave = async () => {
    const nextToken = runtimeTokenInput.trim();
    if (!nextToken) {
      showError('GitHub token required', 'Paste a GitHub token before saving the runtime override.');
      return;
    }

    setIsUpdatingRuntime(true);
    try {
      const status = await updateRuntimeCredentials(nextToken);
      setRuntimeStatus(status);
      setRuntimeStatusError('');
      setRuntimeTokenInput('');
      success(
        'Runtime key updated',
        status.githubIdentity?.login
          ? `The backend is now using @${status.githubIdentity.login}.`
          : 'The backend is now using the runtime override key.',
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to update the runtime key.';
      setRuntimeStatusError(message);
      showError('Runtime key update failed', message);
    } finally {
      setIsUpdatingRuntime(false);
    }
  };

  const handleRuntimeOverrideClear = async () => {
    setIsUpdatingRuntime(true);
    try {
      const status = await clearRuntimeCredentials();
      setRuntimeStatus(status);
      setRuntimeStatusError('');
      setRuntimeTokenInput('');
      success(
        'Runtime override cleared',
        'The backend reverted to the server environment token configuration.',
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to clear the runtime override.';
      setRuntimeStatusError(message);
      showError('Runtime override clear failed', message);
    } finally {
      setIsUpdatingRuntime(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capability Metadata"
        context={activeCapability.id}
        title={activeCapability.name}
        description="Configure the capability contract, hierarchy, leadership contacts, code repositories, execution boundaries, and inherited metadata for downstream teams and workflows."
        actions={
          <SectionCard
            title={ownerAgent?.name || 'Capability Owning Agent'}
            description="Team owner and default context anchor for this capability workspace."
            icon={Bot}
            tone="brand"
            className="min-w-[22rem] p-4"
            contentClassName="space-y-3"
          >
            <StatusBadge tone="brand">{ownerAgent?.id || 'Owner Agent'}</StatusBadge>
            <button
              type="button"
              onClick={() => navigate('/workspace/databases')}
              className="enterprise-button enterprise-button-secondary w-full justify-center"
            >
              <Database size={16} />
              Workspace databases
            </button>
          </SectionCard>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {metadataSummary.map(item => (
          <StatTile
            key={item.label}
            label={item.label}
            value={item.value}
            tone="brand"
            className="xl:col-span-1"
          />
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <motion.form
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={handleSave}
          className="section-card"
        >
          <div className="grid gap-8">
            {bootStatus !== 'ready' || saveError ? (
              <div
                className={cn(
                  'rounded-2xl border px-4 py-3 text-sm',
                  saveError
                    ? 'border-error/15 bg-error/5 text-error'
                    : 'border-amber-200 bg-amber-50 text-amber-900',
                )}
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                  <p>
                    {saveError ||
                      lastSyncError ||
                      'The capability workspace is still syncing. Metadata changes are disabled until the backend is ready.'}
                  </p>
                </div>
              </div>
            ) : null}

            <section className="rounded-[2rem] border border-primary/10 bg-primary/5 px-5 py-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="form-kicker">Business definition</p>
                  <h2 className="mt-2 text-xl font-extrabold text-primary">
                    Define what this capability owns and how success will be judged
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-secondary">
                    Keep the business contract clear first: purpose, owner, outcome, success
                    metrics, evidence expectations, and done criteria.
                  </p>
                </div>
                <StatusBadge tone="brand">Business-first</StatusBadge>
              </div>
            </section>

            <section className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Layers size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Core capability context
                  </h2>
                  <p className="text-sm text-secondary">
                    These values define the boundary and hierarchy for this
                    capability.
                  </p>
                </div>
              </div>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Capability name
                </span>
                <input
                  value={form.name}
                  onChange={event => setField('name', event.target.value)}
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Domain
                </span>
                <input
                  value={form.domain}
                  onChange={event => setField('domain', event.target.value)}
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Capability kind
                </span>
                <select
                  value={form.capabilityKind}
                  onChange={event =>
                    setForm(prev => ({
                      ...prev,
                      capabilityKind: event.target.value as 'DELIVERY' | 'COLLECTION',
                      collectionKind:
                        event.target.value === 'COLLECTION' ? prev.collectionKind : '',
                    }))
                  }
                  className="field-select"
                >
                  <option value="DELIVERY">Delivery</option>
                  <option value="COLLECTION">Collection</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Business unit
                </span>
                <input
                  value={form.businessUnit}
                  onChange={event => setField('businessUnit', event.target.value)}
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Parent capability
                </span>
                <select
                  value={form.parentCapabilityId}
                  onChange={event =>
                    setField('parentCapabilityId', event.target.value)
                  }
                  className="field-select"
                >
                  <option value="">Standalone capability</option>
                  {siblingCapabilities.map(capability => (
                    <option key={capability.id} value={capability.id}>
                      {capability.name}
                    </option>
                  ))}
                </select>
              </label>

              {form.capabilityKind === 'COLLECTION' ? (
                <label className="space-y-2">
                  <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                    Collection kind
                  </span>
                  <select
                    value={form.collectionKind}
                    onChange={event =>
                      setForm(prev => ({
                        ...prev,
                        collectionKind: event.target.value as CapabilityCollectionKind | '',
                      }))
                    }
                    className="field-select"
                  >
                    <option value="">Choose a collection layer</option>
                    <option value="BUSINESS_DOMAIN">Business domain</option>
                    <option value="PLATFORM_LAYER">Platform layer</option>
                    <option value="ENTERPRISE_LAYER">Enterprise layer</option>
                    <option value="CITY_PLAN">City plan</option>
                    <option value="ALM_PORTFOLIO">ALM portfolio</option>
                  </select>
                </label>
              ) : null}

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Owner team
                </span>
                <input
                  value={form.ownerTeam}
                  onChange={event => setField('ownerTeam', event.target.value)}
                  placeholder="Capability Strategy Office"
                  className="field-input"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Description
                </span>
                <textarea
                  value={form.description}
                  onChange={event => setField('description', event.target.value)}
                  className="field-textarea h-28"
                />
              </label>
            </section>

            <section className="grid gap-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Building2 size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Parent capability management
                  </h2>
                  <p className="text-sm text-secondary">
                    Use this capability as a parent node and attach child capabilities directly
                    from here. Selecting a child will re-parent it to this capability when you
                    save.
                  </p>
                </div>
              </div>

              <div className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={actsAsParentCapability ? 'success' : 'neutral'}>
                    {actsAsParentCapability ? 'Parent capability' : 'No child capabilities yet'}
                  </StatusBadge>
                  {form.capabilityKind === 'COLLECTION' ? (
                    <StatusBadge tone="info">Collection nodes are natural parents</StatusBadge>
                  ) : null}
                </div>
                <p className="mt-3 text-sm text-secondary">
                  Single-parent hierarchy is enforced. If you select a capability that already
                  belongs to another parent, Singulairy will move it under this parent when you
                  save.
                </p>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {availableChildCapabilities.length > 0 ? (
                    availableChildCapabilities.map(capability => {
                      const isSelected = form.childCapabilityIds.includes(capability.id);
                      const currentParent =
                        capability.parentCapabilityId &&
                        capabilities.find(item => item.id === capability.parentCapabilityId);

                      return (
                        <label
                          key={capability.id}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-all',
                            isSelected
                              ? 'border-primary/30 bg-primary/5'
                              : 'border-outline-variant/15 bg-white hover:border-primary/20',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleChildCapabilitySelection(capability.id)}
                            className="mt-1 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-on-surface">
                              {capability.name}
                            </p>
                            <p className="mt-1 text-xs text-secondary">
                              {capability.capabilityKind === 'COLLECTION'
                                ? capability.collectionKind || 'Collection'
                                : capability.domain || capability.description}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <StatusBadge tone="info">
                                {capability.capabilityKind || 'DELIVERY'}
                              </StatusBadge>
                              {currentParent && !isSelected ? (
                                <StatusBadge tone="warning">
                                  Current parent: {currentParent.name}
                                </StatusBadge>
                              ) : null}
                              {isSelected ? (
                                <StatusBadge tone="success">Will be attached here</StatusBadge>
                              ) : null}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-outline-variant/30 bg-white p-5 text-sm text-secondary">
                      No eligible child capabilities are available. Ancestors and this capability
                      are excluded to keep the hierarchy cycle-free.
                    </div>
                  )}
                </div>
              </div>

              {form.capabilityKind === 'COLLECTION' ? (
                <div className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={form.sharedCapabilityIds.length ? 'brand' : 'neutral'}>
                      {form.sharedCapabilityIds.length
                        ? `${form.sharedCapabilityIds.length} shared capability reference${form.sharedCapabilityIds.length === 1 ? '' : 's'}`
                        : 'No shared capability references yet'}
                    </StatusBadge>
                    <StatusBadge tone="info">
                      Shared capabilities can appear in multiple collections
                    </StatusBadge>
                  </div>
                  <p className="mt-3 text-sm text-secondary">
                    Shared capabilities keep their own direct parent but are still visible in this
                    collection’s architecture, rollups, and ALM views.
                  </p>

                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    {availableSharedCapabilities.length > 0 ? (
                      availableSharedCapabilities.map(capability => {
                        const isSelected = form.sharedCapabilityIds.includes(capability.id);
                        const currentParent =
                          capability.parentCapabilityId &&
                          capabilities.find(item => item.id === capability.parentCapabilityId);

                        return (
                          <label
                            key={`shared-${capability.id}`}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-all',
                              isSelected
                                ? 'border-primary/30 bg-primary/5'
                                : 'border-outline-variant/15 bg-white hover:border-primary/20',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSharedCapabilitySelection(capability.id)}
                              className="mt-1 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-on-surface">
                                {capability.name}
                              </p>
                              <p className="mt-1 text-xs text-secondary">
                                {capability.capabilityKind === 'COLLECTION'
                                  ? capability.collectionKind || 'Collection'
                                  : capability.domain || capability.description}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <StatusBadge tone="info">
                                  {capability.capabilityKind || 'DELIVERY'}
                                </StatusBadge>
                                {currentParent ? (
                                  <StatusBadge tone="neutral">
                                    Direct parent: {currentParent.name}
                                  </StatusBadge>
                                ) : null}
                                {isSelected ? (
                                  <StatusBadge tone="success">Shared here</StatusBadge>
                                ) : null}
                              </div>
                            </div>
                          </label>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-outline-variant/30 bg-white p-5 text-sm text-secondary">
                        No additional capabilities are available for shared references right now.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ArrowRight size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Business outcome contract
                  </h2>
                  <p className="text-sm text-secondary">
                    These fields make the capability legible to a business owner before any
                    runtime or workflow detail shows up.
                  </p>
                </div>
              </div>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Business outcome
                </span>
                <textarea
                  value={form.businessOutcome}
                  onChange={event => setField('businessOutcome', event.target.value)}
                  placeholder="Describe the business outcome this capability must create."
                  className="field-textarea h-28"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Success metrics
                </span>
                <textarea
                  value={form.successMetrics}
                  onChange={event => setField('successMetrics', event.target.value)}
                  placeholder={'Cycle time reduced by 30%\nRelease evidence is available for every completed work item'}
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Required evidence
                </span>
                <textarea
                  value={form.requiredEvidenceKinds}
                  onChange={event =>
                    setField('requiredEvidenceKinds', event.target.value)
                  }
                  placeholder={'Requirements pack\nTest evidence\nRelease decision'}
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Definition of done
                </span>
                <textarea
                  value={form.definitionOfDone}
                  onChange={event => setField('definitionOfDone', event.target.value)}
                  placeholder="Describe what must be true before this capability counts work as done."
                  className="field-textarea h-28"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Operating policy summary
                </span>
                <textarea
                  value={form.operatingPolicySummary}
                  onChange={event =>
                    setField('operatingPolicySummary', event.target.value)
                  }
                  placeholder="Summarize approvals, constraints, and evidence expectations in plain language."
                  className="field-textarea h-28"
                />
              </label>
            </section>

            <section className="rounded-[2rem] border border-outline-variant/25 bg-surface-container-low px-5 py-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="form-kicker">Execution & governance</p>
                  <h2 className="mt-2 text-xl font-extrabold text-primary">
                    Reveal the operating machinery only after the business contract is clear
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-secondary">
                    Repositories, approved paths, commands, deployment targets, lifecycle, and
                    runtime setup belong here as operating controls.
                  </p>
                </div>
                <StatusBadge tone="neutral">Advanced controls</StatusBadge>
              </div>
            </section>

            <section className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Building2 size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Architecture dependencies and publishable contract
                  </h2>
                  <p className="text-sm text-secondary">
                    Owners maintain the draft here. Parent layers and ALM rollups consume the
                    published snapshot, not the live draft.
                  </p>
                </div>
              </div>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Dependencies
                </span>
                <textarea
                  value={form.dependenciesText}
                  onChange={event => setField('dependenciesText', event.target.value)}
                  placeholder={'CAP-PAYMENTS | API | HIGH | 4 | Depends on the payments contract\nCAP-IDENTITY | FUNCTIONAL | MEDIUM |  | Needs identity availability'}
                  className="field-textarea h-32"
                />
                <p className="text-xs text-secondary">
                  One per line: target capability id | dependency kind | criticality | version
                  constraint | description
                </p>
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Contract overview
                </span>
                <textarea
                  value={form.contractOverview}
                  onChange={event => setField('contractOverview', event.target.value)}
                  placeholder="Summarize the service boundary, operating scope, and what upstream and downstream teams can rely on."
                  className="field-textarea h-28"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Business intent
                </span>
                <textarea
                  value={form.contractBusinessIntent}
                  onChange={event => setField('contractBusinessIntent', event.target.value)}
                  className="field-textarea h-28"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Ownership model
                </span>
                <textarea
                  value={form.contractOwnershipModel}
                  onChange={event => setField('contractOwnershipModel', event.target.value)}
                  className="field-textarea h-28"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Deployment footprint
                </span>
                <textarea
                  value={form.contractDeploymentFootprint}
                  onChange={event => setField('contractDeploymentFootprint', event.target.value)}
                  className="field-textarea h-28"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Evidence and readiness
                </span>
                <textarea
                  value={form.contractEvidenceAndReadiness}
                  onChange={event => setField('contractEvidenceAndReadiness', event.target.value)}
                  className="field-textarea h-28"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Functional requirements
                </span>
                <textarea
                  value={form.contractFunctionalRequirements}
                  onChange={event =>
                    setField('contractFunctionalRequirements', event.target.value)
                  }
                  placeholder={'Expose settlement status | Must expose current settlement state | HIGH\nSupport reversal requests | Handle approved reversal requests | MEDIUM'}
                  className="field-textarea h-32"
                />
                <p className="text-xs text-secondary">
                  One per line: title | description | priority
                </p>
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Non-functional requirements
                </span>
                <textarea
                  value={form.contractNonFunctionalRequirements}
                  onChange={event =>
                    setField('contractNonFunctionalRequirements', event.target.value)
                  }
                  placeholder={'API latency | p95 under 200ms | PERFORMANCE | p95 < 200ms\nAudit retention | Keep records for 7 years | COMPLIANCE | 7 years'}
                  className="field-textarea h-32"
                />
                <p className="text-xs text-secondary">
                  One per line: title | description | category | target
                </p>
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  API contracts
                </span>
                <textarea
                  value={form.contractApiContracts}
                  onChange={event => setField('contractApiContracts', event.target.value)}
                  placeholder={'Payments API | REST | v4 | /payments | External payment orchestration\nSettlement events | EVENT | v2 | settlement.updated | Downstream status broadcast'}
                  className="field-textarea h-32"
                />
                <p className="text-xs text-secondary">
                  One per line: name | kind | version | path or channel | description
                </p>
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Software inventory and versions
                </span>
                <textarea
                  value={form.contractSoftwareVersions}
                  onChange={event =>
                    setField('contractSoftwareVersions', event.target.value)
                  }
                  placeholder={'payments-service | 2.4.1 | runtime | prod | Primary API service\npayments-ui | 1.8.0 | frontend | prod | Internal console'}
                  className="field-textarea h-32"
                />
                <p className="text-xs text-secondary">
                  One per line: name | version | role | environment | notes
                </p>
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  ALM references
                </span>
                <textarea
                  value={form.contractAlmReferences}
                  onChange={event => setField('contractAlmReferences', event.target.value)}
                  placeholder={'JIRA | Payments roadmap | PAY | https://jira.example.com/browse/PAY | Portfolio epic\nCONFLUENCE | Payments architecture | ARCH-12 | https://confluence.example.com/display/ARCH-12 | Living design page'}
                  className="field-textarea h-28"
                />
                <p className="text-xs text-secondary">
                  One per line: system | label | external id | url | description
                </p>
              </label>
            </section>

            <section className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Link2 size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Documentation and delivery links
                  </h2>
                  <p className="text-sm text-secondary">
                    Shared reference inputs for owner and team agents.
                  </p>
                </div>
              </div>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Confluence link
                </span>
                <input
                  value={form.confluenceLink}
                  onChange={event => setField('confluenceLink', event.target.value)}
                  placeholder="https://confluence.example.com/display/..."
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Jira board
                </span>
                <input
                  value={form.jiraBoardLink}
                  onChange={event => setField('jiraBoardLink', event.target.value)}
                  placeholder="https://jira.example.com/boards/..."
                  className="field-input"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Documentation notes
                </span>
                <textarea
                  value={form.documentationNotes}
                  onChange={event =>
                    setField('documentationNotes', event.target.value)
                  }
                  placeholder="Runbooks, architecture constraints, terminology, onboarding notes, governance rules."
                  className="field-textarea h-28"
                />
              </label>
            </section>

            <section className="grid gap-5 md:grid-cols-3">
              <div className="md:col-span-3 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Building2 size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Platform and delivery footprint
                  </h2>
                  <p className="text-sm text-secondary">
                    Capture the systems, repositories, local code paths, and
                    delivery teams that belong to this capability.
                  </p>
                </div>
              </div>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Applications
                </span>
                <textarea
                  value={form.applications}
                  onChange={event => setField('applications', event.target.value)}
                  placeholder={'CoreLedger\nCustomerPortal'}
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  APIs and services
                </span>
                <textarea
                  value={form.apis}
                  onChange={event => setField('apis', event.target.value)}
                  placeholder={'AccountAPI\nTransactionService'}
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Databases
                </span>
                <div className="rounded-[1.5rem] border border-outline-variant/35 bg-surface-container-low px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-on-surface">
                        {workspaceSettings.databaseConfigs.length} shared database profile
                        {workspaceSettings.databaseConfigs.length === 1 ? '' : 's'}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-secondary">
                        Manage the shared workspace catalog for hosts, schemas, usernames, and
                        secret references without storing raw passwords here.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/workspace/databases')}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      <Database size={16} />
                      Open setup
                    </button>
                  </div>

                  <textarea
                    value={form.databases}
                    readOnly
                    placeholder={'Orders Primary\nUser Auth Replica'}
                    className="field-textarea mt-4 h-24 bg-white/70"
                  />
                </div>
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Shared repository catalog
                </span>
                <textarea
                  value={form.repositoriesCatalog}
                  onChange={event =>
                    setField('repositoriesCatalog', event.target.value)
                  }
                  placeholder={
                    'Payments Core | ssh://git.example.com/payments/payments-core.git | main | /Users/ashokraj/Documents/payments-core | primary\nGateway Adapter | ssh://git.example.com/payments/payment-gateway.git | develop | /Users/ashokraj/Documents/payment-gateway |'
                  }
                  className="field-textarea h-32"
                />
                <p className="text-xs leading-relaxed text-secondary">
                  One repository per line: <code>Label | URL | default branch | local root | primary</code>.
                  The first line is treated as primary if you do not mark one explicitly.
                </p>
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Git repositories
                </span>
                <textarea
                  value={form.gitRepositories}
                  onChange={event =>
                    setField('gitRepositories', event.target.value)
                  }
                  placeholder={
                    'ssh://git.example.com/payments/payments-core.git\nssh://git.example.com/payments/payment-gateway.git'
                  }
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Associated teams
                </span>
                <textarea
                  value={form.teamNames}
                  onChange={event => setField('teamNames', event.target.value)}
                  placeholder={'Core Banking Architecture\nRetail Platform Delivery'}
                  className="field-textarea h-32"
                />
              </label>

              <label className="space-y-2 md:col-span-3">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Local code directories
                </span>
                <textarea
                  value={form.localDirectories}
                  onChange={event =>
                    setField('localDirectories', event.target.value)
                  }
                  placeholder={
                    '/Users/ashokraj/Documents/payments-core\n/Users/ashokraj/Documents/payment-gateway'
                  }
                  className="field-textarea h-28"
                />
              </label>
            </section>

            <section className="grid gap-5 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <FolderCode size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-primary">
                    Execution policy
                  </h2>
                  <p className="text-sm text-secondary">
                    Backend execution uses these workspace limits, named command
                    templates, and deployment targets.
                  </p>
                </div>
              </div>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Default workspace path
                </span>
                <input
                  value={form.defaultWorkspacePath}
                  onChange={event =>
                    setField('defaultWorkspacePath', event.target.value)
                  }
                  placeholder="/Users/ashokraj/Documents/agentGoogle"
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Allowed workspace paths
                </span>
                <textarea
                  value={form.allowedWorkspacePaths}
                  onChange={event =>
                    setField('allowedWorkspacePaths', event.target.value)
                  }
                  placeholder={'/Users/ashokraj/Documents/agentGoogle\n/Users/ashokraj/Documents/other-repo'}
                  className="field-textarea h-28"
                />
              </label>

              <div className="md:col-span-2 space-y-3">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                    Command templates
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-secondary">
                    Structured command templates replace raw JSON editing and
                    keep agent execution constrained to approved actions.
                  </p>
                </div>
                <WorkspaceProfileRecommendationCard
                  detection={workspaceDetection}
                  currentTemplates={form.commandTemplates}
                  currentTargets={form.deploymentTargets}
                  dismissed={workspaceDetectionDismissed}
                  onUseRecommendedSetup={applyRecommendedExecutionSetup}
                  onKeepCurrentSetup={() => setWorkspaceDetectionDismissed(true)}
                  onRefresh={() => void refreshWorkspaceDetection()}
                />
                {approvedWorkspacePaths.length > 0 && !workspaceDetection && (
                  <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="form-kicker">Detected workspace profile</p>
                        <p className="mt-2 text-sm leading-relaxed text-secondary">
                          Infer stack-aware Java, Python, or Node execution recommendations from the approved workspace paths.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void refreshWorkspaceDetection()}
                        className="enterprise-button enterprise-button-secondary"
                      >
                        {isRefreshingWorkspaceDetection ? 'Detecting' : 'Refresh inferred setup'}
                      </button>
                    </div>
                  </div>
                )}
                <CommandTemplateEditor
                  templates={form.commandTemplates}
                  allowedWorkspacePaths={approvedWorkspacePaths}
                  onChange={commandTemplates =>
                    setForm(prev => ({ ...prev, commandTemplates }))
                  }
                />
              </div>

              <div className="md:col-span-2 space-y-3">
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                    Deployment targets
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-secondary">
                    Targets reference approved command templates and remain
                    release-approval gated during workflow execution.
                  </p>
                </div>
                <DeploymentTargetEditor
                  targets={form.deploymentTargets}
                  commandTemplates={form.commandTemplates}
                  allowedWorkspacePaths={approvedWorkspacePaths}
                  onChange={deploymentTargets =>
                    setForm(prev => ({ ...prev, deploymentTargets }))
                  }
                />
              </div>
            </section>

            <section className="grid gap-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <WorkflowIcon size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-primary">
                      Capability lifecycle
                    </h2>
                    <p className="text-sm text-secondary">
                      Define the visible lifecycle phases that drive Designer lanes,
                      Work board columns, and evidence phase labels for this capability.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="brand">
                    {lifecycleDraft.phases.length} visible phase
                    {lifecycleDraft.phases.length === 1 ? '' : 's'}
                  </StatusBadge>
                  <StatusBadge tone={lifecycleDirty ? 'warning' : 'success'}>
                    {lifecycleDirty ? 'Unsaved lifecycle changes' : 'Lifecycle saved'}
                  </StatusBadge>
                </div>
              </div>

              <CapabilityLifecycleEditor
                phases={lifecyclePhaseViews}
                intro="Backlog and Done stay fixed. Every phase in between is capability-owned and flows through the workflow designer, orchestration board, ledger, and flight recorder."
                onChangeLabel={handleRenameLifecyclePhase}
                onMovePhase={handleMoveLifecyclePhase}
                onDeletePhase={handleDeleteLifecyclePhase}
                onAddPhase={handleAddLifecyclePhase}
                addLabel="Add lifecycle phase"
              />

              {pendingLifecycleDeletePhaseId ? (
                <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <p className="text-sm font-semibold text-amber-950">
                          Remap workflow references before removing this phase
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-amber-900">
                          Saved workflows still reference{' '}
                          {lifecycleDraft.phases.find(
                            phase => phase.id === pendingLifecycleDeletePhaseId,
                          )?.label || pendingLifecycleDeletePhaseId}
                          . Choose the phase that should inherit those nodes, steps, and hand-off
                          targets.
                        </p>
                      </div>
                      <label className="space-y-2">
                        <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-amber-900">
                          Remap to
                        </span>
                        <select
                          value={lifecycleDeleteTargetPhaseId}
                          onChange={event =>
                            setLifecycleDeleteTargetPhaseId(event.target.value)
                          }
                          className="field-select bg-white"
                        >
                          {lifecycleDraft.phases
                            .filter(phase => phase.id !== pendingLifecycleDeletePhaseId)
                            .map(phase => (
                              <option key={phase.id} value={phase.id}>
                                {phase.label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={handleConfirmLifecycleDelete}
                          disabled={!lifecycleDeleteTargetPhaseId}
                          className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remap and remove phase
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingLifecycleDeletePhaseId(null);
                            setLifecycleDeleteTargetPhaseId('');
                          }}
                          className="enterprise-button enterprise-button-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-outline-variant/15 bg-surface-container-low px-5 py-4">
                <p className="text-sm text-secondary">
                  Delete is blocked while active work or workflow-managed tasks still use a phase.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleResetLifecycleDraft}
                    disabled={!lifecycleDirty || isSavingLifecycle}
                    className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reset lifecycle changes
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveLifecycle()}
                    disabled={!lifecycleDirty || isSavingLifecycle || bootStatus !== 'ready'}
                    className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingLifecycle ? 'Saving lifecycle...' : 'Save lifecycle'}
                  </button>
                </div>
              </div>
            </section>

            <section className="grid gap-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Users size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-primary">
                      Phase ownership
                    </h2>
                    <p className="text-sm text-secondary">
                      Make ownership explicit for each lifecycle phase so work routing,
                      approvals, and escalation can become team-aware.
                    </p>
                  </div>
                </div>
                <StatusBadge tone="brand">
                  {phaseOwnershipRulesDraft.length} configured phase
                  {phaseOwnershipRulesDraft.length === 1 ? '' : 's'}
                </StatusBadge>
              </div>

              <div className="space-y-3">
                {phaseOwnershipRulesDraft.map(rule => (
                  <div
                    key={rule.phaseId}
                    className="grid gap-3 rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4 md:grid-cols-2"
                  >
                    <div className="md:col-span-2">
                      <p className="text-sm font-semibold text-on-surface">
                        {getLifecyclePhaseLabel(activeCapability, rule.phaseId)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        Team ids are stored so ownership rules remain stable even if team labels evolve.
                      </p>
                    </div>
                    <label className="space-y-2">
                      <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Primary owner team
                      </span>
                      <select
                        value={rule.primaryOwnerTeamId || ''}
                        onChange={event =>
                          updatePhaseOwnershipRule(
                            rule.phaseId,
                            'primaryOwnerTeamId',
                            event.target.value,
                          )
                        }
                        className="field-select bg-white"
                      >
                        <option value="">No explicit owner</option>
                        {phaseOwnershipTeamOptions.map(option => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2">
                      <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Secondary owner teams
                      </span>
                      <input
                        value={rule.secondaryOwnerTeamIds.join(', ')}
                        onChange={event =>
                          updatePhaseOwnershipRule(
                            rule.phaseId,
                            'secondaryOwnerTeamIds',
                            event.target.value
                              .split(',')
                              .map(teamId => teamId.trim())
                              .filter(Boolean),
                          )
                        }
                        placeholder="TEAM-..., TEAM-..."
                        className="field-input bg-white"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Approval teams
                      </span>
                      <input
                        value={rule.approvalTeamIds.join(', ')}
                        onChange={event =>
                          updatePhaseOwnershipRule(
                            rule.phaseId,
                            'approvalTeamIds',
                            event.target.value
                              .split(',')
                              .map(teamId => teamId.trim())
                              .filter(Boolean),
                          )
                        }
                        placeholder="TEAM-..., TEAM-..."
                        className="field-input bg-white"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Escalation teams
                      </span>
                      <input
                        value={rule.escalationTeamIds.join(', ')}
                        onChange={event =>
                          updatePhaseOwnershipRule(
                            rule.phaseId,
                            'escalationTeamIds',
                            event.target.value
                              .split(',')
                              .map(teamId => teamId.trim())
                              .filter(Boolean),
                          )
                        }
                        placeholder="TEAM-..., TEAM-..."
                        className="field-input bg-white"
                      />
                    </label>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Users size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-primary">
                      Leadership and stakeholders
                    </h2>
                    <p className="text-sm text-secondary">
                      Keep named contacts, team names, and email addresses for
                      this capability.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addStakeholder}
                  className="inline-flex items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-2.5 text-sm font-bold text-primary transition-all hover:bg-primary/10"
                >
                  <Plus size={16} />
                  Add stakeholder
                </button>
              </div>

              <div className="space-y-3">
                {form.stakeholders.map((stakeholder, index) => {
                  const isDefaultRole = index < defaultStakeholderRoles.length;

                  return (
                    <div
                      key={`${stakeholder.role}-${index}`}
                      className="grid gap-3 rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4 md:grid-cols-[1.1fr_1fr_1fr_auto]"
                    >
                      <input
                        value={stakeholder.role}
                        onChange={event =>
                          updateStakeholder(index, 'role', event.target.value)
                        }
                        placeholder="Role"
                        className="field-input bg-white"
                      />
                      <input
                        value={stakeholder.name}
                        onChange={event =>
                          updateStakeholder(index, 'name', event.target.value)
                        }
                        placeholder="Name"
                        className="field-input bg-white"
                      />
                      <input
                        value={stakeholder.email}
                        onChange={event =>
                          updateStakeholder(index, 'email', event.target.value)
                        }
                        placeholder="email@example.com"
                        className="field-input bg-white"
                      />
                      <div className="flex gap-2">
                        <input
                          value={stakeholder.teamName || ''}
                          onChange={event =>
                            updateStakeholder(
                              index,
                              'teamName',
                              event.target.value,
                            )
                          }
                          placeholder="Team name"
                          className="field-input min-w-0 flex-1 bg-white"
                        />
                        {!isDefaultRole && (
                          <button
                            type="button"
                            onClick={() => removeStakeholder(index)}
                            className="rounded-2xl border border-outline-variant/15 bg-white px-3 text-secondary transition-all hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Database size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-extrabold text-primary">
                      Additional metadata
                    </h2>
                    <p className="text-sm text-secondary">
                      Free-form key/value pairs for anything else that should be
                      tracked at capability level.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addMetadataEntry}
                  className="inline-flex items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-2.5 text-sm font-bold text-primary transition-all hover:bg-primary/10"
                >
                  <Plus size={16} />
                  Add key/value
                </button>
              </div>

              <div className="space-y-3">
                {form.additionalMetadata.map((entry, index) => (
                  <div
                    key={`${entry.key}-${index}`}
                    className="grid gap-3 rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4 md:grid-cols-[1fr_1.2fr_auto]"
                  >
                    <input
                      value={entry.key}
                      onChange={event =>
                        updateMetadataEntry(index, 'key', event.target.value)
                      }
                      placeholder="Metadata key"
                      className="field-input bg-white"
                    />
                    <input
                      value={entry.value}
                      onChange={event =>
                        updateMetadataEntry(index, 'value', event.target.value)
                      }
                      placeholder="Metadata value"
                      className="field-input bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => removeMetadataEntry(index)}
                      className="rounded-2xl border border-outline-variant/15 bg-white px-3 text-secondary transition-all hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-outline-variant/10 pt-6">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-2xl border border-outline-variant/15 px-4 py-2.5 text-sm font-bold text-secondary transition-all hover:bg-surface-container-low"
            >
              Back to dashboard
            </button>
            <div className="flex items-center gap-3">
              <StatusBadge
                tone={
                  saveState === 'error'
                    ? 'danger'
                    : saveState === 'saving'
                      ? 'info'
                      : saveState === 'saved'
                        ? 'success'
                        : saveState === 'unsaved'
                          ? 'warning'
                          : 'neutral'
                }
              >
                {saveState === 'saving'
                  ? 'Saving'
                  : saveState === 'saved'
                    ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : saveState === 'unsaved'
                      ? 'Unsaved changes'
                      : saveState === 'error'
                        ? 'Save failed'
                        : 'No changes'}
              </StatusBadge>
              <button
                type="button"
                onClick={() => void handlePublishContract()}
                disabled={!canSave || isPublishingContract || bootStatus !== 'ready'}
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-5 py-3 text-sm font-bold text-primary transition-all hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <WorkflowIcon size={16} />
                {isPublishingContract ? 'Publishing...' : 'Publish contract'}
              </button>
              <button
                type="submit"
                disabled={!canSave || isSaving || bootStatus !== 'ready'}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={16} />
                {isSaving ? 'Saving...' : 'Save metadata'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/architecture')}
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-5 py-3 text-sm font-bold text-primary transition-all hover:bg-primary/10"
              >
                Architecture view
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </motion.form>

        <aside className="space-y-4 xl:sticky xl:top-28 xl:self-start">
          <SectionCard
            title="GitHub runtime identity"
            description="See how the backend is reaching Copilot, which GitHub identity is visible, and whether the app is using headless CLI or token-based access."
            tone="brand"
          >
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={runtimeStatus?.configured ? 'success' : 'warning'}>
                  {runtimeStatus?.configured ? 'Configured' : 'Not configured'}
                </StatusBadge>
                <StatusBadge tone={runtimeStatus?.runtimeAccessMode !== 'unconfigured' ? 'success' : 'warning'}>
                  {runtimeAccessLabel}
                </StatusBadge>
                <StatusBadge tone="info">{runtimeTokenSourceLabel}</StatusBadge>
              </div>

              <div className="rounded-2xl bg-surface-container-low p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                    <KeyRound size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Active GitHub identity
                    </p>
                    <p className="mt-2 text-sm font-bold text-on-surface">
                      {runtimeStatus?.githubIdentity?.login
                        ? `@${runtimeStatus.githubIdentity.login}`
                        : 'Identity unavailable'}
                    </p>
                    <p className="mt-1 text-sm text-secondary">
                      {runtimeStatus?.githubIdentity?.name ||
                        runtimeStatus?.githubIdentityError ||
                        runtimeStatusError ||
                        'The runtime has not resolved a GitHub identity yet.'}
                    </p>
                    {runtimeStatus?.githubIdentity?.profileUrl ? (
                      <a
                        href={runtimeStatus.githubIdentity.profileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex text-xs font-bold uppercase tracking-[0.18em] text-primary transition-colors hover:text-primary/80"
                      >
                        Open GitHub profile
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-surface-container-low p-4">
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                    Default model
                  </p>
                  <p className="mt-2 text-sm font-bold text-on-surface">
                    {runtimeStatus?.defaultModel || 'Not resolved'}
                  </p>
                </div>
                <div className="rounded-2xl bg-surface-container-low p-4">
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                    Model catalog
                  </p>
                  <p className="mt-2 text-sm font-bold text-on-surface">
                    {runtimeStatus?.modelCatalogSource === 'runtime'
                      ? 'Live runtime catalog'
                      : 'Fallback catalog'}
                  </p>
                </div>
              </div>

              {(runtimeStatusError || runtimeStatus?.githubIdentityError) ? (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <p>{runtimeStatusError || runtimeStatus?.githubIdentityError}</p>
                </div>
              ) : null}

              <label className="space-y-2 block">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Runtime override key
                </span>
                <input
                  type="password"
                  value={runtimeTokenInput}
                  onChange={event => setRuntimeTokenInput(event.target.value)}
                  placeholder="Paste a GitHub token for the backend runtime"
                  className="field-input"
                />
                <p className="text-xs text-secondary">
                  This override applies immediately to the running backend and masks the server env token until you clear it or restart the server.
                </p>
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleRuntimeOverrideSave()}
                  disabled={isUpdatingRuntime || !runtimeTokenInput.trim()}
                  className="enterprise-button enterprise-button-brand-muted disabled:opacity-50"
                >
                  {isUpdatingRuntime ? 'Saving key' : 'Use this key'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRuntimeOverrideClear()}
                  disabled={isUpdatingRuntime}
                  className="enterprise-button enterprise-button-secondary disabled:opacity-50"
                >
                  Revert to server env
                </button>
                <button
                  type="button"
                  onClick={() => void refreshRuntimeIdentity()}
                  disabled={isUpdatingRuntime}
                  className="inline-flex items-center gap-2 rounded-2xl border border-outline-variant/15 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-secondary transition-all hover:bg-surface-container-low disabled:opacity-50"
                >
                  <RefreshCw size={14} />
                  Refresh status
                </button>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Capability status"
            description="Use this to keep a capability active for day-to-day delivery or move it to an inactive state without deleting its history."
            tone={activeCapability.status === 'ARCHIVED' ? 'muted' : 'brand'}
          >
            <div className="flex items-center justify-between gap-3">
              <StatusBadge
                tone={activeCapability.status === 'ARCHIVED' ? 'warning' : 'success'}
              >
                {capabilityLifecycleLabel}
              </StatusBadge>
              <button
                type="button"
                onClick={handleStatusToggle}
                className={cn(
                  'enterprise-button',
                  activeCapability.status === 'ARCHIVED'
                    ? 'enterprise-button-brand-muted'
                    : 'enterprise-button-secondary',
                )}
              >
                {activeCapability.status === 'ARCHIVED'
                  ? 'Reactivate capability'
                  : 'Make inactive'}
              </button>
            </div>
          </SectionCard>

          <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.25em] text-outline">
              Capability summary
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {metadataSummary.map(item => (
                <div
                  key={item.label}
                  className="rounded-2xl bg-surface-container-low p-4 text-center"
                >
                  <p className="text-2xl font-extrabold text-primary">
                    {item.value}
                  </p>
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-secondary">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-primary" />
              <p className="text-sm font-bold text-on-surface">
                Capability hierarchy
              </p>
            </div>
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="info">
                  {activeCapability.capabilityKind || 'DELIVERY'}
                </StatusBadge>
                {actsAsParentCapability ? (
                  <StatusBadge tone="success">Parent capability</StatusBadge>
                ) : null}
                {activeCapability.collectionKind ? (
                  <StatusBadge tone="warning">{activeCapability.collectionKind}</StatusBadge>
                ) : null}
                {activeCapability.publishedSnapshots?.[0] ? (
                  <StatusBadge tone="success">
                    v{activeCapability.publishedSnapshots[0].publishVersion}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="warning">Unpublished</StatusBadge>
                )}
              </div>
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Parent capability
                </p>
                <p className="mt-2 text-sm font-medium text-on-surface">
                  {parentCapability?.name || 'Standalone capability'}
                </p>
              </div>
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Sub-capabilities
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {subCapabilities.length > 0 ? (
                    subCapabilities.map(capability => (
                      <span
                        key={capability.id}
                        className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary"
                      >
                        {capability.name}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-secondary">
                      No sub-capabilities are attached yet.
                    </p>
                  )}
                </div>
              </div>
              {activeCapability.rollupSummary ? (
                <div className="rounded-2xl bg-surface-container-low p-4 text-sm text-secondary">
                  <p className="font-bold text-on-surface">
                    Rollup signals: {activeCapability.rollupSummary.directChildCount} direct
                    children, {activeCapability.rollupSummary.descendantCount} descendants
                  </p>
                  <p className="mt-1">
                    {activeCapability.rollupSummary.missingPublishCount} missing publishes,{' '}
                    {activeCapability.rollupSummary.unresolvedDependencyCount} unresolved
                    dependencies, {activeCapability.rollupSummary.versionMismatchCount} version
                    mismatches.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/architecture')}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Open architecture
                </button>
                <button
                  type="button"
                  onClick={() => void handlePreviewAlmExport()}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Preview ALM export
                </button>
              </div>
            </div>
          </div>

          {almExportPreview ? (
            <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-on-surface">ALM export preview</p>
                  <p className="text-xs text-secondary">
                    Normalized publish payload for rollups and external tooling.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAlmExportPreview('')}
                  className="rounded-xl border border-outline-variant/15 px-3 py-1.5 text-xs font-bold text-secondary transition hover:bg-surface-container-low"
                >
                  Clear
                </button>
              </div>
              <pre className="mt-4 max-h-72 overflow-auto rounded-2xl bg-surface-container-low p-4 text-xs text-secondary">
                {almExportPreview}
              </pre>
            </div>
          ) : null}

          <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <GitBranch size={16} className="text-primary" />
              <p className="text-sm font-bold text-on-surface">Code context</p>
            </div>
            <div className="mt-4 space-y-4 text-sm text-secondary">
              <div className="rounded-2xl bg-surface-container-low p-4">
                <p className="font-bold text-on-surface">
                  {textToList(form.gitRepositories).length} repositories linked
                </p>
                <p className="mt-1">
                  Capability-owned repos should map to the systems and workflows
                  above.
                </p>
              </div>
              <div className="rounded-2xl bg-surface-container-low p-4">
                <div className="flex items-center gap-2">
                  <FolderCode size={16} className="text-primary" />
                  <p className="font-bold text-on-surface">
                    Local directories power branch work
                  </p>
                </div>
                <p className="mt-2">
                  The Studio view can inspect these directories and create Git
                  branches, but only for paths registered under this capability.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-primary/10 bg-primary p-6 text-white shadow-xl shadow-primary/10">
            <div className="flex items-center gap-2">
              <WorkflowIcon size={18} />
              <p className="text-sm font-bold">Next capability-owned spaces</p>
            </div>
            <div className="mt-4 space-y-3">
              <button
                onClick={() => navigate('/team')}
                className="flex w-full items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-left transition-all hover:bg-white/15"
              >
                <span className="text-sm font-bold">Build the team</span>
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() => navigate('/chat')}
                className="flex w-full items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-left transition-all hover:bg-white/15"
              >
                <span className="text-sm font-bold">Open capability chat</span>
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() => navigate('/studio')}
                className="flex w-full items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-left transition-all hover:bg-white/15"
              >
                <span className="text-sm font-bold">Inspect code workspaces</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
