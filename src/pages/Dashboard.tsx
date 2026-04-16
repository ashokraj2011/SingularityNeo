import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Building2,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  FolderGit2,
  Gauge,
  KeyRound,
  MessageSquareText,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ExplainWorkItemDrawer } from '../components/ExplainWorkItemDrawer';
import {
  buildCapabilityExperience,
  ADVANCED_TOOL_DESCRIPTORS,
  type AdvancedToolId,
  getAgentHealth,
  getBusinessWorkStatusLabel,
  getProofStatusLabel,
  getProofStatusTone,
  getReadinessLabel,
  getReadinessTone,
  getTrustLevelTone,
} from '../lib/capabilityExperience';
import { hasPermission } from '../lib/accessControl';
import { getStatusTone } from '../lib/enterprise';
import {
  fetchCapabilityHealthSnapshot,
  fetchCollectionRollupSnapshot,
  fetchOperationsDashboardSnapshot,
  fetchRuntimeStatus,
  type RuntimeStatus,
} from '../lib/api';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/EnterpriseUI';
import { AdvancedDisclosure } from '../components/WorkspaceUI';
import type {
  CapabilityHealthSnapshot,
  CollectionRollupSnapshot,
  OperationsDashboardSnapshot,
} from '../types';

const advancedToolIcons: Record<AdvancedToolId, typeof Database> = {
  architecture: Building2,
  identity: KeyRound,
  access: ShieldCheck,
  databases: Database,
  memory: Database,
  'tool-access': ShieldCheck,
  'run-console': Gauge,
  evals: ClipboardCheck,
  skills: Sparkles,
  'artifact-designer': FileText,
  tasks: PlayCircle,
  studio: Bot,
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const canCreateWorkItems = hasPermission(
    activeCapability.effectivePermissions,
    'workitem.create',
  );
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [operationsSnapshot, setOperationsSnapshot] = useState<OperationsDashboardSnapshot | null>(
    null,
  );
  const [healthSnapshot, setHealthSnapshot] = useState<CapabilityHealthSnapshot | null>(null);
  const [collectionSnapshot, setCollectionSnapshot] =
    useState<CollectionRollupSnapshot | null>(null);
  const [reportError, setReportError] = useState('');
  const [explainWorkItemId, setExplainWorkItemId] = useState('');

  useEffect(() => {
    let isMounted = true;

    fetchRuntimeStatus()
      .then(status => {
        if (isMounted) {
          setRuntimeStatus(status);
        }
      })
      .catch(() => {
        if (isMounted) {
          setRuntimeStatus({
            configured: false,
            provider: 'GitHub Copilot SDK',
            endpoint: '',
            tokenSource: null,
            defaultModel: '',
            availableModels: [],
            lastRuntimeError: 'Runtime status could not be loaded.',
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    void Promise.all([
      fetchOperationsDashboardSnapshot().catch(() => null),
      fetchCapabilityHealthSnapshot(activeCapability.id).catch(error => {
        if (isMounted) {
          setReportError(
            error instanceof Error ? error.message : 'Unable to load capability reporting.',
          );
        }
        return null;
      }),
      activeCapability.capabilityKind === 'COLLECTION'
        ? fetchCollectionRollupSnapshot(activeCapability.id).catch(() => null)
        : Promise.resolve(null),
    ]).then(([operations, health, collection]) => {
      if (!isMounted) {
        return;
      }
      setOperationsSnapshot(operations);
      setHealthSnapshot(health);
      setCollectionSnapshot(collection);
    });

    return () => {
      isMounted = false;
    };
  }, [activeCapability.id, activeCapability.capabilityKind]);

  const experience = useMemo(
    () =>
      buildCapabilityExperience({
        capability: activeCapability,
        workspace,
        runtimeStatus,
      }),
    [activeCapability, runtimeStatus, workspace],
  );

  const ownerHealth = getAgentHealth(experience.ownerAgent);
  const activeWork = workspace.workItems
    .filter(item => item.status !== 'COMPLETED')
    .slice()
    .sort((left, right) => {
      const leftTime = left.history[left.history.length - 1]?.timestamp || '';
      const rightTime = right.history[right.history.length - 1]?.timestamp || '';
      return rightTime.localeCompare(leftTime);
    })
    .slice(0, 4);
  const latestOutputs = workspace.artifacts
    .filter(artifact => artifact.direction !== 'INPUT')
    .slice()
    .sort((left, right) => right.created.localeCompare(left.created))
    .slice(0, 4);
  const publishedWorkflow = workspace.workflows.find(
    workflow => !workflow.archivedAt && workflow.publishState === 'PUBLISHED',
  );
  const primaryWorkflow =
    publishedWorkflow || workspace.workflows.find(workflow => !workflow.archivedAt);
  const topAttentionWorkItem =
    activeWork.find(
      item => item.status === 'BLOCKED' || item.status === 'PENDING_APPROVAL',
    ) || activeWork[0];
  const explainWorkItem =
    workspace.workItems.find(item => item.id === explainWorkItemId) || null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capability Home"
        context={activeCapability.id}
        title={activeCapability.name}
        description={
          activeCapability.businessOutcome ||
          activeCapability.description ||
          'A guided workspace for trust, active work, collaboration, and evidence.'
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => navigate('/chat')}
              className="enterprise-button enterprise-button-secondary"
            >
              <MessageSquareText size={16} />
              Chat with team
            </button>
            <button
              type="button"
              onClick={() => navigate(experience.nextAction.path)}
              className="enterprise-button enterprise-button-primary"
            >
              <ArrowRight size={16} />
              {experience.nextAction.actionLabel}
            </button>
          </>
        }
      >
        <div className="grid max-w-5xl gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
            <p className="form-kicker">Capability trust</p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge tone={getTrustLevelTone(experience.trustLevel)}>
                {experience.trustLabel}
              </StatusBadge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              {experience.trustDescription}
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
            <p className="form-kicker">Agent connection</p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge tone={experience.runtimeHealth.tone}>
                {experience.runtimeHealth.label}
              </StatusBadge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              {experience.runtimeHealth.description}
            </p>
          </div>
          <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
            <p className="form-kicker">Owner collaborator</p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge tone={ownerHealth.tone}>{ownerHealth.label}</StatusBadge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              {experience.ownerAgent?.name || ownerHealth.description}
            </p>
          </div>
        </div>
      </PageHeader>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Active work',
            value: healthSnapshot?.activeWorkCount ?? experience.activeWorkCount,
            helper: 'Items currently moving',
            icon: BriefcaseBusiness,
            tone: 'brand' as const,
          },
          {
            label: 'Needs attention',
            value:
              (healthSnapshot?.blockedCount ?? experience.blockerCount) +
              (healthSnapshot?.pendingApprovalCount ?? experience.approvalCount),
            helper: `${healthSnapshot?.blockedCount ?? experience.blockerCount} blocked, ${healthSnapshot?.pendingApprovalCount ?? experience.approvalCount} approvals`,
            icon: AlertTriangle,
            tone:
              (healthSnapshot?.blockedCount ?? experience.blockerCount) > 0
                ? ('danger' as const)
                : (healthSnapshot?.pendingApprovalCount ?? experience.approvalCount) > 0
                ? ('warning' as const)
                : ('success' as const),
          },
          {
            label: 'Delivered work',
            value: healthSnapshot?.completedWorkCount ?? experience.completedWorkCount,
            helper: 'Completed work items',
            icon: CheckCircle2,
            tone: 'success' as const,
          },
          {
            label: 'Evidence outputs',
            value: healthSnapshot?.outputArtifactCount ?? experience.latestOutputCount,
            helper: 'Artifacts and handoffs',
            icon: FileText,
            tone: 'info' as const,
          },
        ].map(item => (
          <div key={item.label} className="stat-tile">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="stat-label">{item.label}</p>
                <p className="stat-value">{item.value}</p>
              </div>
              <div
                className={cn(
                  'stat-icon',
                  item.tone === 'danger'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : item.tone === 'warning'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : item.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : item.tone === 'brand'
                    ? 'border-primary/15 bg-primary/10 text-primary'
                    : 'border-secondary/15 bg-secondary-container/50 text-secondary',
                )}
              >
                <item.icon size={16} />
              </div>
            </div>
            <div className="stat-helper">{item.helper}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
        <SectionCard
          title="Today"
          description="The clearest next move for this capability."
          icon={ShieldCheck}
          tone="brand"
        >
          <div className="rounded-[1.6rem] border border-primary/15 bg-white px-5 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <StatusBadge tone={experience.nextAction.tone}>
                  Recommended next action
                </StatusBadge>
                <h2 className="mt-3 text-2xl font-bold tracking-tight text-on-surface">
                  {experience.nextAction.title}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-secondary">
                  {experience.nextAction.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate(experience.nextAction.path)}
                className="enterprise-button enterprise-button-primary shrink-0"
              >
                <ArrowRight size={16} />
                {experience.nextAction.actionLabel}
              </button>
            </div>
            {topAttentionWorkItem ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setExplainWorkItemId(topAttentionWorkItem.id)}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Explain {topAttentionWorkItem.id}
                </button>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <button
              type="button"
              onClick={() => navigate('/orchestrator')}
              className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white"
            >
              <p className="text-sm font-semibold text-on-surface">Open Work</p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Approvals, blockers, active work, and restart controls.
              </p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/team')}
              className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white"
            >
              <p className="text-sm font-semibold text-on-surface">Open Agents</p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Collaborators, readiness, learning refresh, and chat handoff.
              </p>
            </button>
            <button
              type="button"
              onClick={() => navigate('/ledger')}
              className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white"
            >
              <p className="text-sm font-semibold text-on-surface">Open Evidence</p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Completed work, artifacts, handoffs, and acceptance evidence.
              </p>
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title="Operations Pulse"
          description="Permission-aware operations reporting and capability health from server-built projections."
          icon={Gauge}
        >
          {reportError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {reportError}
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
              <p className="form-kicker">My work</p>
              <p className="mt-2 text-2xl font-bold text-on-surface">
                {operationsSnapshot?.myWork.length ?? 0}
              </p>
              <p className="mt-2 text-xs text-secondary">
                {operationsSnapshot?.pendingApprovalCount ?? 0} approvals pending
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
              <p className="form-kicker">Capability health</p>
              <p className="mt-2 text-2xl font-bold text-on-surface">
                {healthSnapshot?.publishFreshness || 'Unknown'}
              </p>
              <p className="mt-2 text-xs text-secondary">
                {healthSnapshot?.totalRuns ?? 0} runs · {healthSnapshot?.failedRuns ?? 0} failed
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
              <p className="form-kicker">Evidence completeness</p>
              <p className="mt-2 text-2xl font-bold text-on-surface">
                {Math.round((healthSnapshot?.evidenceCompleteness ?? 0) * 100)}%
              </p>
              <p className="mt-2 text-xs text-secondary">
                ${(healthSnapshot?.totalCostUsd ?? 0).toFixed(2)} cost ·{' '}
                {Math.round(healthSnapshot?.averageLatencyMs ?? 0)} ms average latency
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
              <p className="form-kicker">
                {activeCapability.capabilityKind === 'COLLECTION'
                  ? 'Collection rollup'
                  : 'Team operations'}
              </p>
              <p className="mt-2 text-2xl font-bold text-on-surface">
                {activeCapability.capabilityKind === 'COLLECTION'
                  ? collectionSnapshot?.rollupSummary.directChildCount ?? 0
                  : operationsSnapshot?.teamWork.length ?? 0}
              </p>
              <p className="mt-2 text-xs text-secondary">
                {activeCapability.capabilityKind === 'COLLECTION'
                  ? `${collectionSnapshot?.rollupSummary.unresolvedDependencyCount ?? 0} dependency risks · ${collectionSnapshot?.rollupSummary.missingPublishCount ?? 0} missing publishes`
                  : `${operationsSnapshot?.blockedCount ?? 0} blocked · ${operationsSnapshot?.activeWriterConflicts ?? 0} writer conflicts`}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Trust ladder"
          description="Proof milestones that show whether this capability is real, grounded, operable, and proven."
          icon={ClipboardCheck}
        >
          <div className="space-y-3">
            {experience.proofItems.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.path)}
                className="flex w-full items-start justify-between gap-3 rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3 text-left transition hover:border-primary/20 hover:bg-white"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-on-surface">{item.label}</p>
                    <StatusBadge tone={getProofStatusTone(item.status)}>
                      {getProofStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-secondary">
                    {item.description}
                  </p>
                  <p className="mt-2 text-xs font-medium leading-relaxed text-on-surface/80">
                    {item.proofSignal}
                  </p>
                </div>
                <ArrowRight size={15} className="mt-1 shrink-0 text-outline" />
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard
          title="Delivery"
          description="Business-facing work currently moving through the capability."
          icon={PlayCircle}
          action={
            <button
              type="button"
              onClick={() => navigate('/orchestrator?new=1')}
              disabled={!canCreateWorkItems}
              className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              New work
            </button>
          }
        >
          {activeWork.length > 0 ? (
            <div className="space-y-3">
              {activeWork.map(item => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4 transition hover:border-primary/20 hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/orchestrator?selected=${encodeURIComponent(item.id)}`)
                      }
                      className="min-w-0 text-left"
                    >
                      <p className="text-sm font-semibold text-on-surface">{item.title}</p>
                      <p className="mt-1 text-xs text-secondary">
                        {item.phase.toLowerCase()} • {item.priority} priority
                      </p>
                    </button>
                    <StatusBadge tone={getStatusTone(item.status)}>
                      {getBusinessWorkStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setExplainWorkItemId(item.id)}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Explain
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No active work yet"
              description="Create the first work item when the capability is ready for delivery."
              icon={BriefcaseBusiness}
              className="min-h-[14rem]"
              action={
                <button
                  type="button"
                  onClick={() => navigate('/orchestrator?new=1')}
                  disabled={!canCreateWorkItems}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Create work
                </button>
              }
            />
          )}
        </SectionCard>

        <SectionCard
          title="Evidence"
          description="Recent outputs, artifacts, and handoffs produced by capability work."
          icon={FileText}
          action={
            <button
              type="button"
              onClick={() => navigate('/ledger')}
              className="enterprise-button enterprise-button-secondary"
            >
              Open evidence
            </button>
          }
        >
          {latestOutputs.length > 0 ? (
            <div className="space-y-3">
              {latestOutputs.map(artifact => (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => navigate('/ledger')}
                  className="flex w-full items-start gap-3 rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-white text-primary">
                    <FileText size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">
                      {artifact.name}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-secondary">
                      {artifact.summary || artifact.description || artifact.type}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No evidence yet"
              description="Completed work will produce artifacts, handoffs, and delivery evidence here."
              icon={FileText}
              className="min-h-[14rem]"
            />
          )}
        </SectionCard>
      </div>

      <AdvancedDisclosure
        title="Capability foundation"
        description="Business contract and operating model details, available when you need the deeper setup view."
        storageKey="singularity.home.foundation.open"
        badge={<StatusBadge tone="neutral">Setup details</StatusBadge>}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-outline-variant/40 bg-white px-5 py-5">
            <p className="form-kicker">Business outcome</p>
            <p className="mt-3 text-sm leading-7 text-on-surface">
              {experience.outcomeContract.businessOutcome ||
                'Add a business outcome so owners know what this capability is meant to achieve.'}
            </p>
          </div>
          <div className="rounded-3xl border border-outline-variant/40 bg-white px-5 py-5">
            <p className="form-kicker">Outcome contract</p>
            <div className="mt-3 space-y-3 text-sm text-secondary">
              <p>
                <span className="font-semibold text-on-surface">Success metrics:</span>{' '}
                {experience.outcomeContract.successMetrics.length > 0
                  ? `${experience.outcomeContract.successMetrics.length} defined`
                  : 'Not defined yet'}
              </p>
              <p>
                <span className="font-semibold text-on-surface">Required evidence:</span>{' '}
                {experience.outcomeContract.requiredEvidenceKinds.length > 0
                  ? experience.outcomeContract.requiredEvidenceKinds.join(', ')
                  : 'Not defined yet'}
              </p>
              <p>
                <span className="font-semibold text-on-surface">Definition of done:</span>{' '}
                {experience.outcomeContract.definitionOfDone || 'Not defined yet'}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Workflow',
              value: primaryWorkflow?.name || 'Not defined',
              helper: primaryWorkflow?.publishState || 'Create or publish workflow',
              icon: Workflow,
              path: '/designer',
            },
            {
              label: 'Service boundary',
              value: experience.outcomeContract.serviceBoundary.length,
              helper:
                experience.outcomeContract.serviceBoundary.slice(0, 2).join(', ') ||
                'No boundary signals listed',
              icon: BriefcaseBusiness,
              path: '/capabilities/metadata',
            },
            {
              label: 'Repositories',
              value: activeCapability.gitRepositories.length + activeCapability.localDirectories.length,
              helper:
                activeCapability.gitRepositories[0] ||
                activeCapability.localDirectories[0] ||
                'No source workspace linked',
              icon: FolderGit2,
              path: '/capabilities/metadata',
            },
            {
              label: 'Collaborators',
              value: workspace.agents.length,
              helper: `${workspace.agents.filter(agent => agent.learningProfile.status === 'READY').length} ready`,
              icon: Bot,
              path: '/team',
            },
          ].map(item => (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.path)}
              className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="stat-label">{item.label}</p>
                  <p className="mt-2 truncate text-xl font-bold tracking-tight text-on-surface">
                    {item.value}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/10 bg-white text-primary">
                  <item.icon size={16} />
                </div>
              </div>
              <p className="mt-3 truncate text-xs leading-relaxed text-secondary">
                {item.helper}
              </p>
            </button>
          ))}
        </div>
      </AdvancedDisclosure>

      <AdvancedDisclosure
        title="Advanced tools"
        description="Technical diagnostics and builder tools remain available, but they are no longer the main business journey."
        storageKey="singularity.home.advanced.open"
        badge={<StatusBadge tone="neutral">Technical tools</StatusBadge>}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {ADVANCED_TOOL_DESCRIPTORS.map(tool => {
            const Icon = advancedToolIcons[tool.id];
            return (
            <button
              key={tool.path}
              type="button"
              onClick={() => navigate(tool.path)}
              className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4 text-left transition hover:border-primary/20 hover:bg-surface-container-low"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-outline-variant/50 bg-surface-container-low text-secondary">
                  <Icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface">{tool.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-secondary">
                    {tool.description}
                  </p>
                </div>
              </div>
            </button>
            );
          })}
        </div>
      </AdvancedDisclosure>

      <ExplainWorkItemDrawer
        capability={activeCapability}
        workItem={explainWorkItem}
        isOpen={Boolean(explainWorkItem)}
        onClose={() => setExplainWorkItemId('')}
      />
    </div>
  );
};

export default Dashboard;
