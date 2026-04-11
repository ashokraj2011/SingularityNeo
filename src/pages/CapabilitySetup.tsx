import React, { useMemo, useState } from 'react';
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
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  CommandTemplateEditor,
  DeploymentTargetEditor,
} from '../components/CapabilityExecutionSetup';
import { StatusBadge } from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import {
  getDefaultExecutionConfig,
  isWorkspacePathInsideApprovedRoot,
} from '../lib/executionConfig';
import {
  validateOnboardingCommandTemplate,
  validateOnboardingConnectors,
  validateOnboardingDeploymentTarget,
  validateOnboardingWorkspacePath,
} from '../lib/api';
import type {
  Capability,
  CapabilityOnboardingDraft,
  CommandTemplateValidationResult,
  ConnectorValidationResult,
  DeploymentTargetValidationResult,
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

const defaultExecutionConfig = getDefaultExecutionConfig({ localDirectories: [] });

const createDraft = (): CapabilityOnboardingDraft => ({
  name: '',
  domain: '',
  parentCapabilityId: '',
  businessUnit: '',
  ownerTeam: '',
  description: '',
  githubRepositories: [],
  jiraBoardLink: '',
  confluenceLink: '',
  documentationNotes: '',
  localDirectories: [],
  defaultWorkspacePath: '',
  allowedWorkspacePaths: [],
  commandTemplates: defaultExecutionConfig.commandTemplates,
  deploymentTargets: [],
});

const steps = [
  {
    id: 'profile',
    title: 'Profile',
    description: 'Business identity and ownership.',
    icon: Layers,
  },
  {
    id: 'connectors',
    title: 'Connectors',
    description: 'GitHub, Jira, and Confluence references.',
    icon: GitBranch,
  },
  {
    id: 'workspace',
    title: 'Workspace Approval',
    description: 'Approved local paths for agent execution.',
    icon: ShieldCheck,
  },
  {
    id: 'commands',
    title: 'Commands',
    description: 'Approved build, test, docs, and deploy commands.',
    icon: KeyRound,
  },
  {
    id: 'deploy',
    title: 'Deployment & Review',
    description: 'Approval-gated targets and final create.',
    icon: Rocket,
  },
] as const;

type StepId = (typeof steps)[number]['id'];

const getValidationTone = (ready: boolean, warning = false) =>
  ready ? 'success' : warning ? 'warning' : 'neutral';

export default function CapabilitySetup() {
  const navigate = useNavigate();
  const { bootStatus, capabilities, createCapability, lastSyncError } =
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

  const activeStepIndex = steps.findIndex(step => step.id === activeStepId);
  const activeStep = steps[activeStepIndex];
  const ownerAgentId = useMemo(() => {
    const suffix = slugify(draft.name || 'CAPABILITY');
    return `AGENT-${suffix}-OWNER`;
  }, [draft.name]);

  const approvedWorkspacePaths = useMemo(
    () =>
      uniqueList([
        draft.defaultWorkspacePath,
        ...draft.localDirectories,
        ...draft.allowedWorkspacePaths,
      ]),
    [draft.allowedWorkspacePaths, draft.defaultWorkspacePath, draft.localDirectories],
  );

  const profileReady = Boolean(
    draft.name.trim() &&
      draft.domain.trim() &&
      draft.businessUnit.trim() &&
      draft.description.trim(),
  );
  const connectorShapeReady =
    draft.githubRepositories.every(isOptionalConnectorUrl) &&
    isOptionalConnectorUrl(draft.jiraBoardLink) &&
    isOptionalConnectorUrl(draft.confluenceLink);
  const connectorReady =
    connectorShapeReady &&
    (!connectorValidation || connectorValidation.items.every(item => item.valid));
  const workspaceReady =
    approvedWorkspacePaths.length === 0 ||
    approvedWorkspacePaths.every(path => pathValidation[path]?.valid);
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
  const canCreate =
    profileReady &&
    connectorReady &&
    workspaceReady &&
    commandReady &&
    deploymentReady &&
    bootStatus === 'ready';

  const stepReadiness: Record<StepId, boolean> = {
    profile: profileReady,
    connectors: connectorReady,
    workspace: workspaceReady,
    commands: commandReady,
    deploy: deploymentReady,
  };

  const updateDraft = (updates: Partial<CapabilityOnboardingDraft>) => {
    setSubmitError('');
    setDraft(current => ({ ...current, ...updates }));
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
      setSubmitError('Complete required onboarding checks before creating the capability.');
      return;
    }

    setIsSaving(true);
    setSubmitError('');

    const capability: Omit<Capability, 'id'> & { id?: string } = {
      name: draft.name.trim(),
      domain: draft.domain.trim(),
      parentCapabilityId: draft.parentCapabilityId || undefined,
      businessUnit: draft.businessUnit.trim(),
      ownerTeam: draft.ownerTeam.trim() || undefined,
      description: draft.description.trim(),
      confluenceLink: draft.confluenceLink.trim() || undefined,
      jiraBoardLink: draft.jiraBoardLink.trim() || undefined,
      documentationNotes: draft.documentationNotes.trim() || undefined,
      applications: [],
      apis: [],
      databases: [],
      gitRepositories: uniqueList(draft.githubRepositories),
      localDirectories: uniqueList(draft.localDirectories),
      teamNames: [],
      stakeholders: [],
      additionalMetadata: [],
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
            Create a real capability workspace
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-secondary">
            Configure profile, enterprise references, approved paths, command
            templates, and deployment targets before the capability is created.
            No durable capability is written until final review.
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
                Created only after final submit and scoped to this real
                enterprise workspace.
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
            const isReady = stepReadiness[step.id];

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
                      <StatusBadge tone={getValidationTone(isReady)}>
                        {isReady ? 'Ready' : 'Setup'}
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
            <StatusBadge tone={getValidationTone(stepReadiness[activeStep.id])}>
              {stepReadiness[activeStep.id] ? 'Ready' : 'Needs setup'}
            </StatusBadge>
          </div>

          <div className="mt-6">
            {activeStepId === 'profile' && (
              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="form-kicker">Capability name</span>
                  <input
                    value={draft.name}
                    onChange={event => updateDraft({ name: event.target.value })}
                    placeholder="Payments Command Center"
                    className="field-input"
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
                <label className="space-y-2 md:col-span-2">
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
              </div>
            )}

            {activeStepId === 'connectors' && (
              <div className="space-y-5">
                <div className="rounded-3xl border border-primary/10 bg-primary/5 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <Link2 size={18} className="mt-0.5 text-primary" />
                    <p className="text-sm leading-relaxed text-secondary">
                      Connector setup v1 validates enterprise references only.
                      OAuth and token sync can layer on later without changing
                      the capability schema.
                    </p>
                  </div>
                </div>
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
                <button
                  type="button"
                  onClick={() => void validateConnectors()}
                  className="enterprise-button enterprise-button-secondary"
                >
                  {isValidating === 'connectors' ? 'Validating' : 'Validate connectors'}
                </button>
                {connectorValidation && (
                  <div className="space-y-2">
                    {connectorValidation.items.length === 0 ? (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                        No connector links were provided. You can add them later
                        from Metadata.
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
              </div>
            )}

            {activeStepId === 'workspace' && (
              <div className="space-y-5">
                <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <FolderCode size={18} className="mt-0.5 text-amber-800" />
                    <p className="text-sm leading-relaxed text-amber-900">
                      Agents can read, write, and run commands only inside
                      approved local paths. Leave paths empty for a planning-only
                      capability, or validate paths before execution.
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
                  {isValidating === 'workspace' ? 'Validating' : 'Validate approved paths'}
                </button>
                <div className="space-y-2">
                  {approvedWorkspacePaths.length === 0 ? (
                    <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm text-secondary">
                      No local path is configured yet. Execution tools will stay
                      disabled until a workspace path is approved.
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
            )}

            {activeStepId === 'commands' && (
              <div className="space-y-5">
                <div className="rounded-3xl border border-primary/10 bg-primary/5 px-5 py-4 text-sm leading-relaxed text-secondary">
                  Command templates turn execution into named, approved actions.
                  Agents request templates by id instead of inventing shell
                  commands.
                </div>
                <CommandTemplateEditor
                  templates={draft.commandTemplates}
                  allowedWorkspacePaths={approvedWorkspacePaths}
                  validationResults={commandValidation}
                  onChange={commandTemplates => updateDraft({ commandTemplates })}
                  onValidate={template => void validateCommand(template)}
                />
              </div>
            )}

            {activeStepId === 'deploy' && (
              <div className="space-y-5">
                <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900">
                  Deployment remains approval-gated. A deployment target only
                  defines where and how release execution can happen after human
                  approval.
                </div>
                <DeploymentTargetEditor
                  targets={draft.deploymentTargets}
                  commandTemplates={draft.commandTemplates}
                  allowedWorkspacePaths={approvedWorkspacePaths}
                  validationResults={deploymentValidation}
                  onChange={deploymentTargets => updateDraft({ deploymentTargets })}
                  onValidate={target => void validateDeployment(target)}
                />

                <div className="rounded-3xl border border-outline-variant/25 bg-surface-container-low p-5">
                  <p className="form-kicker">Final review</p>
                  <h3 className="mt-2 text-lg font-bold text-on-surface">
                    What will be created
                  </h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {[
                      ['Capability', draft.name || 'Unnamed'],
                      ['Domain', draft.domain || 'Missing'],
                      ['Owner team', draft.ownerTeam || 'Not set'],
                      ['Git repos', String(draft.githubRepositories.length)],
                      ['Approved paths', String(approvedWorkspacePaths.length)],
                      ['Command templates', String(draft.commandTemplates.length)],
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
            <p className="form-kicker">Completion checklist</p>
            <div className="mt-4 space-y-3">
              {steps.map(step => {
                const ready = stepReadiness[step.id];
                return (
                  <div
                    key={step.id}
                    className="flex items-start gap-3 rounded-2xl bg-surface-container-low px-4 py-3"
                  >
                    <CheckCircle2
                      size={16}
                      className={`mt-0.5 shrink-0 ${
                        ready ? 'text-primary' : 'text-outline'
                      }`}
                    />
                    <div>
                      <p className="text-sm font-semibold text-on-surface">
                        {step.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        {ready ? 'Ready for final review.' : step.description}
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
