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
} from '../components/CapabilityExecutionSetup';
import CapabilityLifecycleEditor from '../components/CapabilityLifecycleEditor';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { cn } from '../lib/utils';
import {
  clearRuntimeCredentials,
  fetchRuntimeStatus,
  updateRuntimeCredentials,
  type RuntimeStatus,
} from '../lib/api';
import {
  createLifecyclePhase,
  getLifecyclePhaseUsage,
  moveLifecyclePhase,
  normalizeCapabilityLifecycle,
  remapWorkflowPhaseReferences,
  renameLifecyclePhase,
  retireLifecyclePhase,
} from '../lib/capabilityLifecycle';
import { buildWorkflowFromGraph, normalizeWorkflowGraph } from '../lib/workflowGraph';
import {
  Capability,
  CapabilityMetadataEntry,
  CapabilityStakeholder,
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

  const [form, setForm] = useState({
    name: activeCapability.name,
    domain: activeCapability.domain || '',
    parentCapabilityId: activeCapability.parentCapabilityId || '',
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
  });
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeStatusError, setRuntimeStatusError] = useState('');
  const [runtimeTokenInput, setRuntimeTokenInput] = useState('');
  const capabilityLifecycle = useMemo(
    () => normalizeCapabilityLifecycle(activeCapability.lifecycle),
    [activeCapability.lifecycle],
  );
  const [lifecycleDraft, setLifecycleDraft] = useState(capabilityLifecycle);
  const [lifecycleDraftWorkflows, setLifecycleDraftWorkflows] = useState(
    workspace.workflows,
  );
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
    });
    setSaveError('');
    setLastSavedAt('');
  }, [activeCapability]);

  useEffect(() => {
    setLifecycleDraft(capabilityLifecycle);
    setLifecycleDraftWorkflows(workspace.workflows);
    setPendingLifecycleDeletePhaseId(null);
    setLifecycleDeleteTargetPhaseId('');
  }, [capabilityLifecycle, workspace.workflows]);

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

  const canSave = Boolean(
    form.name.trim() &&
      form.domain.trim() &&
      form.businessUnit.trim() &&
      form.description.trim() &&
      form.businessOutcome.trim() &&
      textToList(form.successMetrics).length > 0,
  );

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
      { label: 'Git Repos', value: textToList(form.gitRepositories).length },
      { label: 'Local Dirs', value: textToList(form.localDirectories).length },
    ],
    [
      filteredStakeholders.length,
      form.gitRepositories,
      form.localDirectories,
      form.requiredEvidenceKinds,
      form.successMetrics,
      form.teamNames,
    ],
  );
  const approvedWorkspacePaths = useMemo(
    () =>
      Array.from(
        new Set(
          [
            form.defaultWorkspacePath.trim(),
            ...textToList(form.localDirectories),
            ...textToList(form.allowedWorkspacePaths),
          ].filter(Boolean),
        ),
      ),
    [form.allowedWorkspacePaths, form.defaultWorkspacePath, form.localDirectories],
  );

  const setField = (field: keyof typeof form, value: string) => {
    setSaveError('');
    setForm(prev => ({ ...prev, [field]: value }));
  };

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
    () => ({
      name: form.name.trim(),
      domain: form.domain.trim(),
      parentCapabilityId: form.parentCapabilityId || undefined,
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
      gitRepositories: textToList(form.gitRepositories),
      localDirectories: textToList(form.localDirectories),
      executionConfig: {
        defaultWorkspacePath: form.defaultWorkspacePath.trim() || undefined,
        allowedWorkspacePaths: textToList(form.allowedWorkspacePaths),
        commandTemplates: form.commandTemplates,
        deploymentTargets: form.deploymentTargets,
      },
      teamNames: textToList(form.teamNames),
      stakeholders: filteredStakeholders,
      additionalMetadata: filteredMetadataEntries,
    }),
    [
      filteredMetadataEntries,
      filteredStakeholders,
      form.allowedWorkspacePaths,
      form.apis,
      form.applications,
      form.businessUnit,
      form.commandTemplates,
      form.confluenceLink,
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
      form.requiredEvidenceKinds,
      form.successMetrics,
      form.teamNames,
    ],
  );
  const activeCapabilitySnapshot = useMemo(
    () =>
      JSON.stringify({
        name: activeCapability.name,
        domain: activeCapability.domain || '',
        parentCapabilityId: activeCapability.parentCapabilityId || undefined,
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
        gitRepositories: activeCapability.gitRepositories,
        localDirectories: activeCapability.localDirectories,
        executionConfig: activeCapability.executionConfig,
        teamNames: activeCapability.teamNames,
        stakeholders: activeCapability.stakeholders.filter(hasStakeholderContent),
        additionalMetadata: activeCapability.additionalMetadata.filter(hasMetadataEntryContent),
      }),
    [activeCapability],
  );
  const formSnapshot = useMemo(() => JSON.stringify(formPayload), [formPayload]);
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
        setLastSavedAt(new Date().toISOString());
        success(
          'Capability metadata saved',
          `${form.name.trim()} now reflects the latest business charter and execution governance details.`,
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
            contentClassName="space-y-2"
          >
            <StatusBadge tone="brand">{ownerAgent?.id || 'Owner Agent'}</StatusBadge>
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
                <textarea
                  value={form.databases}
                  onChange={event => setField('databases', event.target.value)}
                  placeholder={'Retail_DB_01\nUser_Auth_DB'}
                  className="field-textarea h-32"
                />
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
                type="submit"
                disabled={!canSave || isSaving || bootStatus !== 'ready'}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={16} />
                {isSaving ? 'Saving...' : 'Save metadata'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/team')}
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-5 py-3 text-sm font-bold text-primary transition-all hover:bg-primary/10"
              >
                Team setup
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
            </div>
          </div>

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
