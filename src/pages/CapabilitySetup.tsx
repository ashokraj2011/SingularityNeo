import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  FolderCode,
  GitBranch,
  KeyRound,
  Layers,
  Link2,
  Rocket,
  Search,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  CommandTemplateEditor,
  DeploymentTargetEditor,
  WorkspaceProfileRecommendationCard,
} from '../components/CapabilityExecutionSetup';
import { AdvancedDisclosure } from '../components/WorkspaceUI';
import { StatusBadge } from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { createDefaultCapabilityLifecycle } from '../lib/capabilityLifecycle';
import {
  hasMeaningfulExecutionCommandTemplate,
  isWorkspacePathInsideApprovedRoot,
} from '../lib/executionConfig';
import {
  detectOnboardingWorkspaceProfile,
  validateOnboardingCommandTemplate,
  validateOnboardingConnectors,
  validateOnboardingDeploymentTarget,
  validateOnboardingWorkspacePath,
} from '../lib/api';
import type {
  Capability,
  CapabilityCollectionKind,
  CapabilityOnboardingDraft,
  CommandTemplateValidationResult,
  ConnectorValidationResult,
  DeploymentTargetValidationResult,
  WorkspaceDetectionResult,
  WorkspacePathValidationResult,
} from '../types';

const slugify = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

const uniqueList = (items: string[]) =>
  Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));

const listToText = (items: string[]) => items.join('\n');

const textToList = (value: string) =>
  value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);

const isOptionalConnectorUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:', 'ssh:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const createDraft = (): CapabilityOnboardingDraft => ({
  name: '',
  domain: '',
  parentCapabilityId: '',
  capabilityKind: 'DELIVERY',
  collectionKind: undefined,
  childCapabilityIds: [],
  sharedCapabilityIds: [],
  businessUnit: '',
  ownerTeam: '',
  description: '',
  businessOutcome: '',
  successMetrics: [],
  definitionOfDone: '',
  requiredEvidenceKinds: [],
  operatingPolicySummary: '',
  githubRepositories: [],
  jiraBoardLink: '',
  confluenceLink: '',
  documentationNotes: '',
  localDirectories: [],
  defaultWorkspacePath: '',
  allowedWorkspacePaths: [],
  commandTemplates: [],
  deploymentTargets: [],
});

const steps = [
  {
    id: 'profile',
    title: 'Start',
    description: 'Name the capability and describe what it owns.',
    icon: Layers,
  },
  {
    id: 'sources',
    title: 'Learning sources',
    description: 'Add code, docs, or approved paths the owning agent can learn from.',
    icon: Link2,
  },
  {
    id: 'execution',
    title: 'Execution setup',
    description: 'Optional commands and deployment targets for later real execution.',
    icon: KeyRound,
  },
  {
    id: 'review',
    title: 'Review & create',
    description: 'Create now and let agents enrich the rest during initial learning.',
    icon: Rocket,
  },
] as const;

type StepId = (typeof steps)[number]['id'];

export default function CapabilitySetup() {
  const navigate = useNavigate();
  const {
    bootStatus,
    capabilities,
    createCapability,
    updateCapabilityMetadata,
    setActiveCapability,
    lastSyncError,
  } =
    useCapability();
  const { success, error: showError } = useToast();
  const [activeStepId, setActiveStepId] = useState<StepId>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [draft, setDraft] = useState<CapabilityOnboardingDraft>(createDraft);
  const [connectorValidation, setConnectorValidation] =
    useState<ConnectorValidationResult | null>(null);
  const [pathValidation, setPathValidation] = useState<
    Record<string, WorkspacePathValidationResult>
  >({});
  const [commandValidation, setCommandValidation] = useState<
    Record<string, CommandTemplateValidationResult>
  >({});
  const [deploymentValidation, setDeploymentValidation] = useState<
    Record<string, DeploymentTargetValidationResult>
  >({});
  const [workspaceDetection, setWorkspaceDetection] =
    useState<WorkspaceDetectionResult | null>(null);
  const [workspaceDetectionDismissed, setWorkspaceDetectionDismissed] =
    useState(false);

  const activeStepIndex = steps.findIndex(step => step.id === activeStepId);
  const activeStep = steps[activeStepIndex];
  const [existingCapabilityQuery, setExistingCapabilityQuery] = useState('');
  const ownerAgentId = useMemo(() => {
    const suffix = slugify(draft.name || 'CAPABILITY');
    return `AGENT-${suffix}-OWNER`;
  }, [draft.name]);
  const isCollectionCapability = draft.capabilityKind === 'COLLECTION';
  const parentCapability = useMemo(
    () =>
      capabilities.find(capability => capability.id === draft.parentCapabilityId) || null,
    [capabilities, draft.parentCapabilityId],
  );
  const selectedChildCapabilityIds = useMemo(
    () => new Set(draft.childCapabilityIds),
    [draft.childCapabilityIds],
  );
  const directChildCandidates = useMemo(() => {
    const ancestorIds = new Set<string>();
    let cursor = parentCapability;
    while (cursor) {
      ancestorIds.add(cursor.id);
      cursor =
        capabilities.find(capability => capability.id === cursor?.parentCapabilityId) || null;
    }

    return capabilities.filter(capability => {
      if (capability.id === draft.parentCapabilityId) {
        return false;
      }
      if (ancestorIds.has(capability.id)) {
        return false;
      }
      return true;
    });
  }, [capabilities, draft.parentCapabilityId, parentCapability]);
  const sharedCapabilityCandidates = useMemo(
    () =>
      capabilities.filter(
        capability =>
          capability.id !== draft.parentCapabilityId &&
          !selectedChildCapabilityIds.has(capability.id),
      ),
    [capabilities, draft.parentCapabilityId, selectedChildCapabilityIds],
  );
  const filteredExistingCapabilities = useMemo(() => {
    const query = existingCapabilityQuery.trim().toLowerCase();
    if (!query) {
      return capabilities;
    }
    return capabilities.filter(capability =>
      [
        capability.name,
        capability.id,
        capability.domain,
        capability.businessUnit,
        capability.capabilityKind,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [capabilities, existingCapabilityQuery]);

  const approvedWorkspacePaths = useMemo(
    () =>
      uniqueList([
        draft.defaultWorkspacePath,
        ...draft.localDirectories,
        ...draft.allowedWorkspacePaths,
      ]),
    [draft.allowedWorkspacePaths, draft.defaultWorkspacePath, draft.localDirectories],
  );
  const workspaceDetectionSignature = useMemo(
    () =>
      JSON.stringify({
        defaultWorkspacePath: draft.defaultWorkspacePath.trim(),
        approvedWorkspacePaths,
      }),
    [approvedWorkspacePaths, draft.defaultWorkspacePath],
  );

  const minimumReady = Boolean(draft.name.trim() && draft.description.trim());
  const hasBusinessCharterDetails = Boolean(
    draft.businessOutcome.trim() ||
      draft.successMetrics.length > 0 ||
      draft.requiredEvidenceKinds.length > 0 ||
      draft.definitionOfDone.trim() ||
      draft.operatingPolicySummary.trim(),
  );
  const hasGroundingSource = Boolean(
    draft.githubRepositories.length ||
      draft.jiraBoardLink.trim() ||
      draft.confluenceLink.trim() ||
      draft.documentationNotes.trim() ||
      approvedWorkspacePaths.length,
  );
  const connectorShapeReady =
    draft.githubRepositories.every(isOptionalConnectorUrl) &&
    isOptionalConnectorUrl(draft.jiraBoardLink) &&
    isOptionalConnectorUrl(draft.confluenceLink);
  const connectorReady =
    !draft.githubRepositories.length &&
    !draft.jiraBoardLink.trim() &&
    !draft.confluenceLink.trim()
      ? true
      : connectorShapeReady &&
        (!connectorValidation || connectorValidation.items.every(item => item.valid));
  const workspaceReady =
    approvedWorkspacePaths.length === 0 ||
    approvedWorkspacePaths.every(path => pathValidation[path]?.valid);
  const sourcesReady = hasGroundingSource ? connectorReady && workspaceReady : true;
  const hasExecutionSetup =
    hasMeaningfulExecutionCommandTemplate(draft.commandTemplates) ||
    draft.deploymentTargets.length > 0;
  const commandReady =
    new Set(draft.commandTemplates.map(template => template.id)).size ===
      draft.commandTemplates.length &&
    draft.commandTemplates.length > 0 &&
    draft.commandTemplates.every(template =>
      template.id &&
      template.label &&
      template.command.length > 0 &&
      commandValidation[template.id]?.valid !== false,
    );
  const deploymentReady =
    draft.deploymentTargets.length === 0 ||
    draft.deploymentTargets.every(target =>
      target.id &&
      target.label &&
      target.commandTemplateId &&
      draft.commandTemplates.some(template => template.id === target.commandTemplateId) &&
      (!target.workspacePath ||
        isWorkspacePathInsideApprovedRoot(target.workspacePath, approvedWorkspacePaths)) &&
      deploymentValidation[target.id]?.valid !== false,
    );
  const executionReady = hasExecutionSetup ? commandReady && deploymentReady : true;
  const canCreate = minimumReady && bootStatus === 'ready';

  const stepStates: Record<
    StepId,
    { label: string; tone: 'success' | 'neutral' | 'warning'; ready: boolean }
  > = {
    profile: minimumReady
      ? { label: 'Ready', tone: 'success', ready: true }
      : { label: 'Required', tone: 'neutral', ready: false },
    sources: !hasGroundingSource
      ? { label: 'Recommended', tone: 'neutral', ready: false }
      : sourcesReady
      ? { label: 'Ready', tone: 'success', ready: true }
      : { label: 'Review', tone: 'warning', ready: false },
    execution: !hasExecutionSetup
      ? { label: 'Later', tone: 'neutral', ready: false }
      : executionReady
      ? { label: 'Ready', tone: 'success', ready: true }
      : { label: 'Review', tone: 'warning', ready: false },
    review: canCreate
      ? { label: 'Ready', tone: 'success', ready: true }
      : { label: 'Pending', tone: 'neutral', ready: false },
  };

  const updateDraft = (updates: Partial<CapabilityOnboardingDraft>) => {
    setSubmitError('');
    setDraft(current => ({ ...current, ...updates }));
  };

  const toggleDraftIdSelection = (
    field: 'childCapabilityIds' | 'sharedCapabilityIds',
    value: string,
  ) => {
    setSubmitError('');
    setDraft(current => {
      const next = new Set(current[field]);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...current,
        [field]: [...next],
        ...(field === 'childCapabilityIds'
          ? {
              sharedCapabilityIds: current.sharedCapabilityIds.filter(id => id !== value),
            }
          : {
              childCapabilityIds: current.childCapabilityIds.filter(id => id !== value),
            }),
      };
    });
  };

  useEffect(() => {
    setWorkspaceDetection(null);
    setWorkspaceDetectionDismissed(false);
  }, [workspaceDetectionSignature]);

  const detectWorkspaceProfile = async (paths = approvedWorkspacePaths) => {
    if (paths.length === 0) {
      setWorkspaceDetection(null);
      setWorkspaceDetectionDismissed(false);
      return;
    }

    setIsValidating('workspace-profile');
    try {
      const result = await detectOnboardingWorkspaceProfile({
        defaultWorkspacePath: draft.defaultWorkspacePath.trim() || undefined,
        approvedWorkspacePaths: paths,
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
      setIsValidating('');
    }
  };

  const applyRecommendedSetup = (
    commandTemplates: CapabilityOnboardingDraft['commandTemplates'],
    deploymentTargets: CapabilityOnboardingDraft['deploymentTargets'],
  ) => {
    updateDraft({ commandTemplates, deploymentTargets });
    setCommandValidation({});
    setDeploymentValidation({});
    setWorkspaceDetectionDismissed(false);
  };

  const goNext = () => {
    const nextStep = steps[activeStepIndex + 1];
    if (nextStep) {
      setActiveStepId(nextStep.id);
    }
  };

  const goPrevious = () => {
    const previousStep = steps[activeStepIndex - 1];
    if (previousStep) {
      setActiveStepId(previousStep.id);
    }
  };

  const validateConnectors = async () => {
    setIsValidating('connectors');
    try {
      setConnectorValidation(
        await validateOnboardingConnectors({
          githubRepositories: draft.githubRepositories,
          jiraBoardLink: draft.jiraBoardLink,
          confluenceLink: draft.confluenceLink,
        }),
      );
    } catch (error) {
      showError(
        'Connector validation failed',
        error instanceof Error ? error.message : 'Unable to validate connectors.',
      );
    } finally {
      setIsValidating('');
    }
  };

  const validateWorkspacePaths = async () => {
    setIsValidating('workspace');
    try {
      const results = await Promise.all(
        approvedWorkspacePaths.map(path =>
          validateOnboardingWorkspacePath({ path }),
        ),
      );
      setPathValidation(
        results.reduce<Record<string, WorkspacePathValidationResult>>(
          (current, result) => ({
            ...current,
            [result.path]: result,
          }),
          {},
        ),
      );
      const validPaths = results
        .filter(result => result.valid)
        .map(result => result.normalizedPath || result.path);

      if (validPaths.length > 0) {
        await detectWorkspaceProfile(validPaths);
      } else {
        setWorkspaceDetection(null);
        setWorkspaceDetectionDismissed(false);
      }
    } catch (error) {
      showError(
        'Workspace validation failed',
        error instanceof Error ? error.message : 'Unable to validate paths.',
      );
    } finally {
      setIsValidating('');
    }
  };

  const validateCommand = async (
    template: CapabilityOnboardingDraft['commandTemplates'][number],
  ) => {
    setIsValidating(`command-${template.id}`);
    try {
      const result = await validateOnboardingCommandTemplate({
        template,
        existingTemplateIds: draft.commandTemplates.map(item => item.id),
        allowedWorkspacePaths: approvedWorkspacePaths,
      });
      setCommandValidation(current => ({ ...current, [template.id]: result }));
    } catch (error) {
      showError(
        'Command validation failed',
        error instanceof Error ? error.message : 'Unable to validate command.',
      );
    } finally {
      setIsValidating('');
    }
  };

  const validateDeployment = async (
    target: CapabilityOnboardingDraft['deploymentTargets'][number],
  ) => {
    setIsValidating(`deployment-${target.id}`);
    try {
      const result = await validateOnboardingDeploymentTarget({
        target,
        commandTemplates: draft.commandTemplates,
        allowedWorkspacePaths: approvedWorkspacePaths,
      });
      setDeploymentValidation(current => ({ ...current, [target.id]: result }));
    } catch (error) {
      showError(
        'Deployment validation failed',
        error instanceof Error ? error.message : 'Unable to validate target.',
      );
    } finally {
      setIsValidating('');
    }
  };

  const handleCreate = async () => {
    if (!canCreate) {
      setSubmitError('Add a capability name and purpose before creating the capability.');
      return;
    }

    setIsSaving(true);
    setSubmitError('');

    const capability: Omit<Capability, 'id'> & { id?: string } = {
      name: draft.name.trim(),
      domain: draft.domain.trim(),
      parentCapabilityId: draft.parentCapabilityId || undefined,
      capabilityKind: draft.capabilityKind,
      collectionKind:
        draft.capabilityKind === 'COLLECTION'
          ? draft.collectionKind || undefined
          : undefined,
      businessUnit: draft.businessUnit.trim(),
      ownerTeam: draft.ownerTeam.trim() || undefined,
      description: draft.description.trim(),
      businessOutcome: draft.businessOutcome.trim() || undefined,
      successMetrics: uniqueList(draft.successMetrics),
      definitionOfDone: draft.definitionOfDone.trim() || undefined,
      requiredEvidenceKinds: uniqueList(draft.requiredEvidenceKinds),
      operatingPolicySummary: draft.operatingPolicySummary.trim() || undefined,
      confluenceLink: draft.confluenceLink.trim() || undefined,
      jiraBoardLink: draft.jiraBoardLink.trim() || undefined,
      documentationNotes: draft.documentationNotes.trim() || undefined,
      applications: [],
      apis: [],
      databases: [],
      databaseConfigs: [],
      gitRepositories: uniqueList(draft.githubRepositories),
      localDirectories: uniqueList(draft.localDirectories),
      teamNames: [],
      stakeholders: [],
      additionalMetadata: [],
      lifecycle: createDefaultCapabilityLifecycle(),
      executionConfig: {
        defaultWorkspacePath: draft.defaultWorkspacePath.trim() || undefined,
        allowedWorkspacePaths: approvedWorkspacePaths,
        commandTemplates: draft.commandTemplates,
        deploymentTargets: draft.deploymentTargets,
      },
      status: 'PENDING',
      specialAgentId: ownerAgentId,
      skillLibrary: [],
    };

    try {
      const bundle = await createCapability(capability);
      if (draft.childCapabilityIds.length > 0 || draft.sharedCapabilityIds.length > 0) {
        await Promise.all([
          ...draft.childCapabilityIds.map(childCapabilityId =>
            updateCapabilityMetadata(childCapabilityId, {
              parentCapabilityId: bundle.capability.id,
            }),
          ),
          ...(draft.sharedCapabilityIds.length > 0
            ? [
                updateCapabilityMetadata(bundle.capability.id, {
                  sharedCapabilities: draft.sharedCapabilityIds.map(
                    (memberCapabilityId, index) => ({
                      id: `SHARED-${bundle.capability.id}-${index + 1}`,
                      collectionCapabilityId: bundle.capability.id,
                      memberCapabilityId,
                      label:
                        capabilities.find(capability => capability.id === memberCapabilityId)
                          ?.name || undefined,
                    }),
                  ),
                }),
              ]
            : []),
        ]);
      }
      success(
        'Capability created',
        `${bundle.capability.name} is ready on Capability Home.`,
      );
      navigate('/');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to create the capability right now.';
      setSubmitError(message);
      showError('Capability creation failed', message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-4xl">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-full border border-outline-variant/25 bg-white px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-secondary transition-all hover:border-primary/20 hover:text-primary"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <p className="mt-5 form-kicker">Enterprise onboarding</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-primary">
            Start a capability without over-configuring it
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-secondary">
            Start with the business purpose and any code or documentation you
            already have. The owning agent can infer a lot during initial
            learning, so execution rules, evidence expectations, and deployment
            details can be layered in later.
          </p>
        </div>

        <div className="rounded-3xl border border-primary/10 bg-primary/5 p-5 shadow-sm xl:w-80">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
              <Bot size={20} />
            </div>
            <div>
              <p className="text-sm font-bold text-on-surface">
                Capability Owning Agent
              </p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Created after final submit and grounded first in the charter,
                then in the repos, docs, and approved paths you attach here.
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-white px-4 py-3">
            <p className="form-kicker">Owner agent id</p>
            <p className="mt-1 break-all text-sm font-bold text-primary">
              {ownerAgentId}
            </p>
          </div>
        </div>
      </div>

      {bootStatus !== 'ready' && (
        <div className="flex items-start gap-3 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>
            Capability creation is unavailable until backend sync is restored.
            {lastSyncError ? ` ${lastSyncError}` : ''}
          </p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)_22rem]">
        <aside className="space-y-3 xl:sticky xl:top-28 xl:self-start">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = step.id === activeStepId;
            const stepState = stepStates[step.id];

            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setActiveStepId(step.id)}
                className={`w-full rounded-3xl border px-4 py-4 text-left transition-all ${
                  isActive
                    ? 'border-primary/30 bg-primary/5 shadow-[0_16px_34px_rgba(0,132,61,0.10)]'
                    : 'border-outline-variant/25 bg-white hover:border-primary/20'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-container-low text-primary">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-on-surface">
                        {index + 1}. {step.title}
                      </p>
                      <StatusBadge tone={stepState.tone}>
                        {stepState.label}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      {step.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </aside>

        <motion.section
          key={activeStepId}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[2rem] border border-outline-variant/20 bg-white p-6 shadow-sm"
        >
          <div className="flex flex-col gap-3 border-b border-outline-variant/20 pb-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="form-kicker">Step {activeStepIndex + 1} of {steps.length}</p>
              <h2 className="mt-2 text-2xl font-extrabold text-primary">
                {activeStep.title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-secondary">
                {activeStep.description}
              </p>
            </div>
            <StatusBadge tone={stepStates[activeStep.id].tone}>
              {stepStates[activeStep.id].label}
            </StatusBadge>
          </div>

          <div className="mt-6">
            {activeStepId === 'profile' && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-primary/10 bg-primary/5 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <Bot size={18} className="mt-0.5 text-primary" />
                    <p className="text-sm leading-relaxed text-secondary">
                      Start with the capability name and purpose. During initial
                      learning, the owning agent can infer domain vocabulary,
                      likely stakeholders, candidate evidence, and execution
                      hints from the codebase and documentation you attach next.
                    </p>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="form-kicker">Capability kind</span>
                    <select
                      value={draft.capabilityKind}
                      onChange={event =>
                        updateDraft({
                          capabilityKind: event.target.value as 'DELIVERY' | 'COLLECTION',
                          collectionKind:
                            event.target.value === 'COLLECTION'
                              ? draft.collectionKind || 'BUSINESS_DOMAIN'
                              : undefined,
                          childCapabilityIds:
                            event.target.value === 'COLLECTION'
                              ? draft.childCapabilityIds
                              : [],
                          sharedCapabilityIds:
                            event.target.value === 'COLLECTION'
                              ? draft.sharedCapabilityIds
                              : [],
                        })
                      }
                      className="field-select"
                    >
                      <option value="DELIVERY">Delivery capability</option>
                      <option value="COLLECTION">Collection capability</option>
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="form-kicker">Collection type</span>
                    <select
                      value={draft.collectionKind || ''}
                      onChange={event =>
                        updateDraft({
                          collectionKind: event.target.value as CapabilityCollectionKind,
                        })
                      }
                      disabled={!isCollectionCapability}
                      className="field-select disabled:opacity-50"
                    >
                      <option value="">
                        {isCollectionCapability
                          ? 'Choose collection type'
                          : 'Only used for collection capabilities'}
                      </option>
                      <option value="BUSINESS_DOMAIN">Business domain</option>
                      <option value="PLATFORM_LAYER">Platform layer</option>
                      <option value="ENTERPRISE_LAYER">Enterprise layer</option>
                      <option value="CITY_PLAN">City plan</option>
                      <option value="ALM_PORTFOLIO">ALM portfolio</option>
                    </select>
                  </label>
                  <label className="space-y-2 md:col-span-2">
                    <span className="form-kicker">Capability name</span>
                    <input
                      value={draft.name}
                      onChange={event => updateDraft({ name: event.target.value })}
                      placeholder="Payments Command Center"
                      className="field-input"
                    />
                  </label>
                  <label className="space-y-2 md:col-span-2">
                    <span className="form-kicker">Capability purpose</span>
                    <textarea
                      value={draft.description}
                      onChange={event =>
                        updateDraft({ description: event.target.value })
                      }
                      placeholder="Describe the business scope, systems, and outcome this capability owns."
                      className="field-textarea h-32"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="form-kicker">Domain</span>
                    <input
                      value={draft.domain}
                      onChange={event => updateDraft({ domain: event.target.value })}
                      placeholder="Payments"
                      className="field-input"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="form-kicker">Business unit</span>
                    <input
                      value={draft.businessUnit}
                      onChange={event =>
                        updateDraft({ businessUnit: event.target.value })
                      }
                      placeholder="Digital Platforms"
                      className="field-input"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="form-kicker">Owner team</span>
                    <input
                      value={draft.ownerTeam}
                      onChange={event =>
                        updateDraft({ ownerTeam: event.target.value })
                      }
                      placeholder="Capability Strategy Office"
                      className="field-input"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="form-kicker">Parent capability</span>
                    <select
                      value={draft.parentCapabilityId}
                      onChange={event =>
                        updateDraft({ parentCapabilityId: event.target.value })
                      }
                      className="field-select"
                    >
                      <option value="">Standalone capability</option>
                      {capabilities.map(capability => (
                        <option key={capability.id} value={capability.id}>
                          {capability.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {isCollectionCapability ? (
                  <div className="rounded-3xl border border-primary/10 bg-primary/5 px-5 py-4">
                    <div className="flex items-start gap-3">
                      <Layers size={18} className="mt-0.5 text-primary" />
                      <p className="text-sm leading-relaxed text-secondary">
                        Collection capabilities are architecture-first. We focus on hierarchy,
                        shared capability reuse, contracts, and rollups. Git repos, local
                        workspaces, and execution setup stay optional and out of the main path.
                      </p>
                    </div>
                  </div>
                ) : null}

                {isCollectionCapability ? (
                  <div className="space-y-5">
                    <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="form-kicker">Direct children</p>
                          <h3 className="mt-2 text-lg font-bold text-on-surface">
                            Capabilities this collection owns directly
                          </h3>
                          <p className="mt-2 text-sm leading-relaxed text-secondary">
                            These capabilities will be re-parented under this collection after
                            creation. The tree stays single-parent.
                          </p>
                        </div>
                        <StatusBadge tone={draft.childCapabilityIds.length ? 'success' : 'neutral'}>
                          {draft.childCapabilityIds.length
                            ? `${draft.childCapabilityIds.length} selected`
                            : 'Optional'}
                        </StatusBadge>
                      </div>
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {directChildCandidates.length > 0 ? (
                          directChildCandidates.map(capability => {
                            const isSelected = draft.childCapabilityIds.includes(capability.id);
                            const currentParent =
                              capability.parentCapabilityId &&
                              capabilities.find(
                                item => item.id === capability.parentCapabilityId,
                              );

                            return (
                              <label
                                key={`child-${capability.id}`}
                                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-all ${
                                  isSelected
                                    ? 'border-primary/30 bg-white'
                                    : 'border-outline-variant/15 bg-white hover:border-primary/20'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() =>
                                    toggleDraftIdSelection('childCapabilityIds', capability.id)
                                  }
                                  className="mt-1 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-bold text-on-surface">
                                    {capability.name}
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
                                  </div>
                                </div>
                              </label>
                            );
                          })
                        ) : (
                          <div className="rounded-2xl border border-dashed border-outline-variant/25 bg-white p-4 text-sm text-secondary md:col-span-2">
                            No eligible capabilities are available for direct parenting yet.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="form-kicker">Shared capabilities</p>
                          <h3 className="mt-2 text-lg font-bold text-on-surface">
                            Capabilities this collection reuses
                          </h3>
                          <p className="mt-2 text-sm leading-relaxed text-secondary">
                            Shared capabilities stay under their own direct parent and can be
                            referenced by multiple collections.
                          </p>
                        </div>
                        <StatusBadge
                          tone={draft.sharedCapabilityIds.length ? 'brand' : 'neutral'}
                        >
                          {draft.sharedCapabilityIds.length
                            ? `${draft.sharedCapabilityIds.length} selected`
                            : 'Optional'}
                        </StatusBadge>
                      </div>
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {sharedCapabilityCandidates.length > 0 ? (
                          sharedCapabilityCandidates.map(capability => {
                            const isSelected = draft.sharedCapabilityIds.includes(capability.id);
                            return (
                              <label
                                key={`shared-${capability.id}`}
                                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-all ${
                                  isSelected
                                    ? 'border-primary/30 bg-white'
                                    : 'border-outline-variant/15 bg-white hover:border-primary/20'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() =>
                                    toggleDraftIdSelection('sharedCapabilityIds', capability.id)
                                  }
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
                                    {capability.parentCapabilityId ? (
                                      <StatusBadge tone="neutral">
                                        Shared from existing tree
                                      </StatusBadge>
                                    ) : null}
                                  </div>
                                </div>
                              </label>
                            );
                          })
                        ) : (
                          <div className="rounded-2xl border border-dashed border-outline-variant/25 bg-white p-4 text-sm text-secondary md:col-span-2">
                            No remaining capabilities are available for shared references yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                <AdvancedDisclosure
                  title="Business charter details"
                  description="Optional now. Add them if you know them, or let the team infer and refine them after initial learning."
                  storageKey="capability-setup-business-charter"
                  badge={
                    <StatusBadge tone={hasBusinessCharterDetails ? 'success' : 'neutral'}>
                      {hasBusinessCharterDetails ? 'Added' : 'Optional'}
                    </StatusBadge>
                  }
                >
                  <div className="grid gap-5 md:grid-cols-2">
                    <label className="space-y-2 md:col-span-2">
                      <span className="form-kicker">Business outcome</span>
                      <p className="text-xs leading-relaxed text-secondary">
                        Optional. Describe the business result this capability should create.
                        Example: &quot;Evaluate rules accurately before returning a decision.&quot;
                      </p>
                      <textarea
                        value={draft.businessOutcome}
                        onChange={event =>
                          updateDraft({ businessOutcome: event.target.value })
                        }
                        placeholder="Optional. Example: Evaluate rules accurately before a quote or decision is returned."
                        className="field-textarea h-28"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="form-kicker">Success metrics</span>
                      <p className="text-xs leading-relaxed text-secondary">
                        Optional. One measurable outcome per line.
                        Example: &quot;Rule evaluation accuracy above 99.5%.&quot;
                      </p>
                      <textarea
                        value={listToText(draft.successMetrics)}
                        onChange={event =>
                          updateDraft({
                            successMetrics: textToList(event.target.value),
                          })
                        }
                        placeholder={
                          'Optional. One metric per line.\nRule evaluation accuracy above 99.5%\nP95 response time under 300 ms'
                        }
                        className="field-textarea h-32"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="form-kicker">Required evidence</span>
                      <p className="text-xs leading-relaxed text-secondary">
                        Optional. What proof should exist before someone trusts or releases the work.
                      </p>
                      <textarea
                        value={listToText(draft.requiredEvidenceKinds)}
                        onChange={event =>
                          updateDraft({
                            requiredEvidenceKinds: textToList(event.target.value),
                          })
                        }
                        placeholder={
                          'Optional. One item per line.\nRegression test report\nSample rule evaluation results\nApproval note'
                        }
                        className="field-textarea h-32"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="form-kicker">Definition of done</span>
                      <p className="text-xs leading-relaxed text-secondary">
                        Optional. Describe what must be true before this capability counts work as complete.
                      </p>
                      <textarea
                        value={draft.definitionOfDone}
                        onChange={event =>
                          updateDraft({ definitionOfDone: event.target.value })
                        }
                        placeholder="Optional. Example: Changes are implemented, validated, and supported by reviewable evidence."
                        className="field-textarea h-28"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="form-kicker">Operating policy summary</span>
                      <p className="text-xs leading-relaxed text-secondary">
                        Optional. Plain-language approvals, constraints, or guardrails for this capability.
                      </p>
                      <textarea
                        value={draft.operatingPolicySummary}
                        onChange={event =>
                          updateDraft({ operatingPolicySummary: event.target.value })
                        }
                        placeholder="Optional. Example: High-impact rule changes require review before release."
                        className="field-textarea h-28"
                      />
                    </label>
                  </div>
                </AdvancedDisclosure>
              </div>
            )}

            {activeStepId === 'sources' && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-primary/10 bg-primary/5 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <GitBranch size={18} className="mt-0.5 text-primary" />
                    <p className="text-sm leading-relaxed text-secondary">
                      {isCollectionCapability
                        ? 'Collections usually start from architecture notes, ALM links, and published child contracts. Technical sources stay optional unless you want this layer grounded in reference repos too.'
                        : 'Give the owning agent a repo, docs, or an approved local path if you want useful initial learning right away. You can also create the capability now and attach sources later from Metadata.'}
                    </p>
                  </div>
                </div>

                {!isCollectionCapability ? (
                  <label className="space-y-2 block">
                    <span className="form-kicker">GitHub repositories</span>
                    <textarea
                      value={listToText(draft.githubRepositories)}
                      onChange={event =>
                        updateDraft({
                          githubRepositories: textToList(event.target.value),
                        })
                      }
                      placeholder={'https://github.com/org/service-a\nssh://git.example.com/platform/service-b.git'}
                      className="field-textarea h-32"
                    />
                  </label>
                ) : null}

                <div className="grid gap-5 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="form-kicker">Jira board</span>
                    <input
                      value={draft.jiraBoardLink}
                      onChange={event =>
                        updateDraft({ jiraBoardLink: event.target.value })
                      }
                      placeholder="https://jira.example.com/boards/42"
                      className="field-input"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="form-kicker">Confluence page</span>
                    <input
                      value={draft.confluenceLink}
                      onChange={event =>
                        updateDraft({ confluenceLink: event.target.value })
                      }
                      placeholder="https://confluence.example.com/display/CAP"
                      className="field-input"
                    />
                  </label>
                </div>

                <label className="space-y-2 block">
                  <span className="form-kicker">Documentation notes</span>
                  <textarea
                    value={draft.documentationNotes}
                    onChange={event =>
                      updateDraft({ documentationNotes: event.target.value })
                    }
                    placeholder="Runbooks, domain terms, release constraints, governance notes."
                    className="field-textarea h-28"
                  />
                </label>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void validateConnectors()}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    {isValidating === 'connectors' ? 'Validating' : 'Validate source links'}
                  </button>
                  <StatusBadge tone={hasGroundingSource ? 'brand' : 'neutral'}>
                    {hasGroundingSource ? 'Learning inputs added' : 'No learning sources yet'}
                  </StatusBadge>
                </div>

                {connectorValidation && (
                  <div className="space-y-2">
                    {connectorValidation.items.length === 0 ? (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                        No source links were provided yet. You can still create
                        the capability and add them later.
                      </div>
                    ) : (
                      connectorValidation.items.map((item, index) => (
                        <div
                          key={`${item.connector}-${index}`}
                          className="flex items-start justify-between gap-3 rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3"
                        >
                          <div>
                            <p className="text-sm font-semibold text-on-surface">
                              {item.connector}
                            </p>
                            <p className="mt-1 break-all text-xs text-secondary">
                              {item.value}
                            </p>
                            <p className="mt-1 text-xs text-secondary">
                              {item.message}
                            </p>
                          </div>
                          <StatusBadge tone={item.valid ? 'success' : 'warning'}>
                            {item.valid ? 'Valid' : 'Review'}
                          </StatusBadge>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {!isCollectionCapability ? (
                  <AdvancedDisclosure
                    title="Approved workspace paths"
                    description="Optional now. Add them when you want agents to read, write, or run commands inside a local codebase."
                    storageKey="capability-setup-workspace-paths"
                    badge={
                      <StatusBadge tone={approvedWorkspacePaths.length ? 'brand' : 'neutral'}>
                        {approvedWorkspacePaths.length
                          ? `${approvedWorkspacePaths.length} path${approvedWorkspacePaths.length === 1 ? '' : 's'}`
                          : 'Optional'}
                      </StatusBadge>
                    }
                  >
                    <div className="space-y-5">
                      <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4">
                        <div className="flex items-start gap-3">
                          <FolderCode size={18} className="mt-0.5 text-amber-800" />
                          <p className="text-sm leading-relaxed text-amber-900">
                            Agents can read, write, and run commands only inside
                            approved local paths. Leave this empty for a planning
                            or discovery-first capability.
                          </p>
                        </div>
                      </div>
                      <label className="space-y-2 block">
                        <span className="form-kicker">Default workspace path</span>
                        <input
                          value={draft.defaultWorkspacePath}
                          onChange={event =>
                            updateDraft({ defaultWorkspacePath: event.target.value })
                          }
                          placeholder="/Users/ashokraj/Documents/workDir/service"
                          className="field-input"
                        />
                      </label>
                      <div className="grid gap-5 md:grid-cols-2">
                        <label className="space-y-2">
                          <span className="form-kicker">Local code directories</span>
                          <textarea
                            value={listToText(draft.localDirectories)}
                            onChange={event =>
                              updateDraft({
                                localDirectories: textToList(event.target.value),
                              })
                            }
                            className="field-textarea h-36"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="form-kicker">Additional allowed paths</span>
                          <textarea
                            value={listToText(draft.allowedWorkspacePaths)}
                            onChange={event =>
                              updateDraft({
                                allowedWorkspacePaths: textToList(event.target.value),
                              })
                            }
                            className="field-textarea h-36"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => void validateWorkspacePaths()}
                        disabled={approvedWorkspacePaths.length === 0}
                        className="enterprise-button enterprise-button-secondary disabled:opacity-50"
                      >
                        {isValidating === 'workspace'
                          ? 'Validating'
                          : 'Validate approved paths'}
                      </button>
                      <div className="space-y-2">
                        {approvedWorkspacePaths.length === 0 ? (
                          <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-secondary">
                            No local path is configured yet. The capability can
                            still be created and used for chat, planning, and
                            discovery before execution is enabled.
                          </div>
                        ) : (
                          approvedWorkspacePaths.map(path => {
                            const validation = pathValidation[path];

                            return (
                              <div
                                key={path}
                                className="flex items-start justify-between gap-3 rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3"
                              >
                                <div>
                                  <p className="break-all text-sm font-semibold text-on-surface">
                                    {path}
                                  </p>
                                  <p className="mt-1 text-xs text-secondary">
                                    {validation?.message || 'Not validated yet.'}
                                  </p>
                                </div>
                                <StatusBadge
                                  tone={validation?.valid ? 'success' : 'warning'}
                                >
                                  {validation?.valid ? 'Approved' : 'Check'}
                                </StatusBadge>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </AdvancedDisclosure>
                ) : null}
              </div>
            )}

            {activeStepId === 'execution' && (
              <div className="space-y-6">
                {isCollectionCapability ? (
                  <div className="space-y-5">
                    <div className="rounded-3xl border border-primary/10 bg-primary/5 px-5 py-4 text-sm leading-relaxed text-secondary">
                      Collection capabilities do not own execution runs, so command templates,
                      workspace commands, and deployment targets are intentionally skipped here.
                      If you later want technical reference material, you can still add docs or
                      repos from Capability Metadata without turning this collection into an
                      execution lane.
                    </div>
                    <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low p-5">
                      <p className="form-kicker">Collection structure</p>
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl bg-white px-4 py-3">
                          <p className="form-kicker">Direct children</p>
                          <p className="mt-2 text-lg font-extrabold text-primary">
                            {draft.childCapabilityIds.length}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white px-4 py-3">
                          <p className="form-kicker">Shared capabilities</p>
                          <p className="mt-2 text-lg font-extrabold text-primary">
                            {draft.sharedCapabilityIds.length}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white px-4 py-3">
                          <p className="form-kicker">Collection kind</p>
                          <p className="mt-2 text-sm font-bold text-on-surface">
                            {draft.collectionKind || 'Choose on Start step'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-3xl border border-primary/10 bg-primary/5 px-5 py-4 text-sm leading-relaxed text-secondary">
                      Skip this if you only need learning, chat, or planning first.
                      Command templates and deployment targets can be refined once
                      the owning agent understands the codebase and your operating
                      model more clearly.
                    </div>

                    <WorkspaceProfileRecommendationCard
                      detection={workspaceDetection}
                      currentTemplates={draft.commandTemplates}
                      currentTargets={draft.deploymentTargets}
                      dismissed={workspaceDetectionDismissed}
                      onUseRecommendedSetup={applyRecommendedSetup}
                      onKeepCurrentSetup={() => setWorkspaceDetectionDismissed(true)}
                      onRefresh={() => void detectWorkspaceProfile()}
                    />

                    {approvedWorkspacePaths.length > 0 && !workspaceDetection && (
                      <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="form-kicker">Detected workspace profile</p>
                            <p className="mt-2 text-sm leading-relaxed text-secondary">
                              Validate or refresh the approved workspace paths to infer Java, Python, or Node execution setup from the local codebase.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void detectWorkspaceProfile()}
                            className="enterprise-button enterprise-button-secondary"
                          >
                            {isValidating === 'workspace-profile'
                              ? 'Detecting'
                              : 'Refresh detection'}
                          </button>
                        </div>
                      </div>
                    )}

                    <AdvancedDisclosure
                      title="Command templates"
                      description="Turn execution into named, approved actions when you are ready for build, test, docs, or deployment work."
                      storageKey="capability-setup-command-templates"
                      badge={
                        <StatusBadge tone={hasMeaningfulExecutionCommandTemplate(draft.commandTemplates) ? 'success' : 'neutral'}>
                          {hasMeaningfulExecutionCommandTemplate(draft.commandTemplates)
                            ? 'Configured'
                            : 'Optional'}
                        </StatusBadge>
                      }
                    >
                      <CommandTemplateEditor
                        templates={draft.commandTemplates}
                        allowedWorkspacePaths={approvedWorkspacePaths}
                        validationResults={commandValidation}
                        onChange={commandTemplates => updateDraft({ commandTemplates })}
                        onValidate={template => void validateCommand(template)}
                      />
                    </AdvancedDisclosure>

                    <AdvancedDisclosure
                      title="Deployment targets"
                      description="Define approval-gated release targets when this capability is ready to ship changes."
                      storageKey="capability-setup-deployment-targets"
                      badge={
                        <StatusBadge tone={draft.deploymentTargets.length ? 'brand' : 'neutral'}>
                          {draft.deploymentTargets.length
                            ? `${draft.deploymentTargets.length} target${draft.deploymentTargets.length === 1 ? '' : 's'}`
                            : 'Optional'}
                        </StatusBadge>
                      }
                    >
                      <div className="space-y-5">
                        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900">
                          Deployment remains approval-gated. A deployment target
                          only defines where and how release execution can happen
                          after human approval.
                        </div>
                        <DeploymentTargetEditor
                          targets={draft.deploymentTargets}
                          commandTemplates={draft.commandTemplates}
                          allowedWorkspacePaths={approvedWorkspacePaths}
                          validationResults={deploymentValidation}
                          onChange={deploymentTargets =>
                            updateDraft({ deploymentTargets })
                          }
                          onValidate={target => void validateDeployment(target)}
                        />
                      </div>
                    </AdvancedDisclosure>
                  </>
                )}
              </div>
            )}

            {activeStepId === 'review' && (
              <div className="space-y-5">
                <div className="rounded-3xl border border-outline-variant/25 bg-surface-container-low p-5">
                  <p className="form-kicker">What will be created</p>
                  <h3 className="mt-2 text-lg font-bold text-on-surface">
                    A lightweight capability with room to learn
                  </h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {[
                      ['Capability', draft.name || 'Unnamed'],
                      ['Kind', draft.capabilityKind],
                      [
                        'Collection type',
                        draft.capabilityKind === 'COLLECTION'
                          ? draft.collectionKind || 'Choose on Start step'
                          : 'Not a collection',
                      ],
                      ['Purpose', draft.description || 'Missing'],
                      ['Owner team', draft.ownerTeam || 'Can be inferred later'],
                      ['Learning sources', String(
                        draft.githubRepositories.length +
                          Number(Boolean(draft.jiraBoardLink.trim())) +
                          Number(Boolean(draft.confluenceLink.trim())) +
                          Number(Boolean(draft.documentationNotes.trim())) +
                          approvedWorkspacePaths.length,
                      )],
                      [
                        'Business charter details',
                        hasBusinessCharterDetails ? 'Provided' : 'To refine later',
                      ],
                      [
                        'Execution setup',
                        draft.capabilityKind === 'COLLECTION'
                          ? 'Collection nodes stay non-executable'
                          : hasExecutionSetup
                          ? 'Partially configured'
                          : 'Planning-first',
                      ],
                      ['Direct children', String(draft.childCapabilityIds.length)],
                      ['Shared capabilities', String(draft.sharedCapabilityIds.length)],
                      ['Approved paths', String(approvedWorkspacePaths.length)],
                      ['Deployment targets', String(draft.deploymentTargets.length)],
                      ['Owner agent', ownerAgentId],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-outline-variant/20 bg-white px-4 py-3"
                      >
                        <p className="form-kicker">{label}</p>
                        <p className="mt-2 break-all text-sm font-semibold text-on-surface">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-primary/10 bg-primary/5 px-5 py-4">
                  <p className="form-kicker">What happens next</p>
                  <div className="mt-3 space-y-2 text-sm leading-relaxed text-secondary">
                    {isCollectionCapability ? (
                      <>
                        <p>1. We create the collection capability and owning agent.</p>
                        <p>2. Direct children are attached into the architecture tree.</p>
                        <p>3. Shared capabilities are linked as reusable collection members without changing their own parent chain.</p>
                      </>
                    ) : (
                      <>
                        <p>1. We create the capability and owning agent.</p>
                        <p>2. The team learns from any repos, docs, and paths you attached.</p>
                        <p>3. You can refine the business contract, commands, and release setup later from Metadata and Designer.</p>
                      </>
                    )}
                  </div>
                </div>

                {!hasGroundingSource && (
                  <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900">
                    {isCollectionCapability
                      ? 'No architecture sources are attached yet. The collection can still be created, and you can enrich it later with ALM links, documentation, and published child contracts.'
                      : 'No learning sources are attached yet. The capability can still be created, but the owning agent will only start from the charter until you connect code, docs, or workspace paths.'}
                  </div>
                )}

                {hasGroundingSource && !sourcesReady && (
                  <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900">
                    Some attached source links or approved paths still need
                    review. You can create the capability now, but it is worth
                    cleaning these up so initial learning has trustworthy input.
                  </div>
                )}

                {hasExecutionSetup && !executionReady && (
                  <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900">
                    Some execution or deployment entries still need review.
                    Since execution is optional at creation time, you can keep
                    moving and finish this setup after the capability exists.
                  </div>
                )}
              </div>
            )}
          </div>

          {submitError && (
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-error/15 bg-error/5 px-4 py-3 text-sm text-error">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <p>{submitError}</p>
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/20 pt-5">
            <button
              type="button"
              onClick={goPrevious}
              disabled={activeStepIndex === 0}
              className="enterprise-button enterprise-button-secondary disabled:opacity-40"
            >
              <ArrowLeft size={16} />
              Previous
            </button>
            <div className="flex flex-wrap gap-2">
              {activeStepIndex < steps.length - 1 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="enterprise-button enterprise-button-primary"
                >
                  Continue
                  <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={!canCreate || isSaving}
                  className="enterprise-button enterprise-button-primary disabled:opacity-40"
                >
                  {isSaving ? 'Creating capability' : 'Create real capability'}
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          </div>
        </motion.section>

        <aside className="space-y-4 xl:sticky xl:top-28 xl:self-start">
          <div className="rounded-3xl border border-outline-variant/20 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="form-kicker">Existing capabilities</p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  Open an existing capability directly from onboarding instead of searching for it elsewhere.
                </p>
              </div>
              <span className="rounded-full border border-outline-variant/30 bg-surface-container-low px-3 py-1 text-xs font-semibold text-secondary">
                {capabilities.length}
              </span>
            </div>
            <label className="relative mt-4 block">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline"
              />
              <input
                value={existingCapabilityQuery}
                onChange={event => setExistingCapabilityQuery(event.target.value)}
                placeholder="Search existing capability"
                className="field-input pl-10"
              />
            </label>
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
              {filteredExistingCapabilities.length > 0 ? (
                filteredExistingCapabilities.slice(0, 12).map(capability => (
                  <button
                    key={capability.id}
                    type="button"
                    onClick={() => {
                      setActiveCapability(capability);
                      navigate('/capabilities/metadata');
                    }}
                    className="w-full rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3 text-left transition hover:border-primary/20 hover:bg-white"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-on-surface">{capability.name}</p>
                      <StatusBadge
                        tone={capability.capabilityKind === 'COLLECTION' ? 'info' : 'brand'}
                      >
                        {capability.capabilityKind}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-secondary">
                      {[capability.domain, capability.businessUnit].filter(Boolean).join(' • ') ||
                        capability.id}
                    </p>
                  </button>
                ))
              ) : (
                <p className="rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-secondary">
                  No capability matches this search yet.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-outline-variant/20 bg-white p-5 shadow-sm">
            <p className="form-kicker">Completion checklist</p>
            <div className="mt-4 space-y-3">
              {steps.map(step => {
                const stepState = stepStates[step.id];
                return (
                  <div
                    key={step.id}
                    className="flex items-start gap-3 rounded-2xl bg-surface-container-low px-4 py-3"
                  >
                    <CheckCircle2
                      size={16}
                      className={`mt-0.5 shrink-0 ${
                        stepState.ready ? 'text-primary' : 'text-outline'
                      }`}
                    />
                    <div>
                      <p className="text-sm font-semibold text-on-surface">
                        {step.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        {stepState.ready
                          ? 'Ready for final review.'
                          : `${step.description} ${stepState.label === 'Recommended' || stepState.label === 'Later' ? 'You can keep moving and return later.' : ''}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-primary/10 bg-primary p-6 text-white shadow-xl shadow-primary/10">
            <p className="text-sm font-bold">Real workspace mode</p>
            <p className="mt-3 text-sm leading-relaxed text-primary-fixed-dim">
              This flow does not use demo data. Demo capability seeding must be
              enabled explicitly through environment flags.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
