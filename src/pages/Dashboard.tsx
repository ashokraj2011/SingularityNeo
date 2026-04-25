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
  PlayCircle,
  Radiation,
  Scale,
  ScanEye,
  Search,
  TreePine,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Workflow,
  Wrench,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ExplainWorkItemDrawer } from '../components/ExplainWorkItemDrawer';
import {
  buildCapabilityExperience,
  getVisibleAdvancedToolDescriptors,
  type AdvancedToolId,
  getAgentHealth,
  getBusinessWorkStatusLabel,
  getTrustLevelTone,
} from '../lib/capabilityExperience';
import { hasPermission } from '../lib/accessControl';
import { formatEnumLabel, getStatusTone } from '../lib/enterprise';
import {
  fetchCapabilityHealthSnapshot,
  fetchCapabilityConnectorContext,
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
  CapabilityConnectorContext,
  CollectionRollupSnapshot,
  OperationsDashboardSnapshot,
} from '../types';

const getConnectorTone = (status?: CapabilityConnectorContext['github']['status']) => {
  switch (status) {
    case 'READY':
      return 'success' as const;
    case 'ERROR':
      return 'danger' as const;
    default:
      return 'warning' as const;
  }
};

const advancedToolIcons: Record<AdvancedToolId, typeof Database> = {
  architecture: Building2,
  identity: KeyRound,
  operations: Gauge,
  'desktop-connectors': KeyRound,
  access: ShieldCheck,
  databases: Database,
  memory: Database,
  'tool-access': ShieldCheck,
  'run-console': Gauge,
  evals: ClipboardCheck,
  skills: Sparkles,
  tools: Wrench,
  policies: Scale,
  'artifact-designer': FileText,
  tasks: PlayCircle,
  studio: Bot,
  incidents: AlertTriangle,
  mrm: ShieldCheck,
  'governance-controls': Scale,
  'governance-exceptions': ShieldOff,
  'governance-provenance': Search,
  'governance-posture': Gauge,
  'work-item-report': ClipboardCheck,
  sentinel: Radiation,
  'blast-radius': ScanEye,
  'ast-explorer': TreePine,
};

const Dashboard = () => {
  const navigate = useNavigate();
  const {
    activeCapability,
    currentWorkspaceUserId,
    getCapabilityWorkspace,
    workspaceOrganization,
  } = useCapability();
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
  const [connectorContext, setConnectorContext] = useState<CapabilityConnectorContext | null>(null);
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
      fetchCapabilityConnectorContext(activeCapability.id).catch(() => null),
      activeCapability.capabilityKind === 'COLLECTION'
        ? fetchCollectionRollupSnapshot(activeCapability.id).catch(() => null)
        : Promise.resolve(null),
    ]).then(([operations, health, connectors, collection]) => {
      if (!isMounted) {
        return;
      }
      setOperationsSnapshot(operations);
      setHealthSnapshot(health);
      setConnectorContext(connectors);
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
  const currentWorkspaceRoles =
    workspaceOrganization.users.find(user => user.id === currentWorkspaceUserId)?.workspaceRoles ||
    [];
  const visibleAdvancedTools = useMemo(
    () =>
      getVisibleAdvancedToolDescriptors({
        capability: activeCapability,
        workspace,
        workspaceRoles: currentWorkspaceRoles,
        includeOnDemand: false,
      }),
    [activeCapability, currentWorkspaceRoles, workspace],
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
  const executionOwnerLabel = workspace.executionOwnership
    ? `${workspace.executionOwnership.actorDisplayName}${
        runtimeStatus?.executorId &&
        workspace.executionOwnership.executorId === runtimeStatus.executorId
          ? ' (this desktop)'
          : ''
      }`
    : 'No desktop owner';
  const executionDispatchLabel =
    workspace.executionDispatchState === 'ASSIGNED'
      ? 'Desktop assigned'
      : workspace.executionDispatchState === 'WAITING_FOR_EXECUTOR'
      ? 'Waiting for desktop'
      : workspace.executionDispatchState === 'STALE_EXECUTOR'
      ? 'Desktop disconnected'
      : 'Unassigned';
  const primaryWorkflow =
    publishedWorkflow || workspace.workflows.find(workflow => !workflow.archivedAt);
  const topAttentionWorkItem =
    activeWork.find(
      item => item.status === 'BLOCKED' || item.status === 'PENDING_APPROVAL',
    ) || activeWork[0];
  const explainWorkItem =
    workspace.workItems.find(item => item.id === explainWorkItemId) || null;
  const primaryReadinessGate =
    experience.readinessContract.gates.find(gate => !gate.satisfied) || null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Home"
        context={activeCapability.id}
        title={activeCapability.name}
        description={
          activeCapability.businessOutcome ||
          activeCapability.description ||
          'Summary, governed delivery trust, and control-plane health for the capability. Daily operating work now starts in Work.'
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="enterprise-button enterprise-button-secondary"
            >
              <Workflow size={16} />
              Open Work
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
            <p className="form-kicker">Runtime posture</p>
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
            navPath: '/?queue=ALL_WORK',
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
            navPath: '/?queue=ATTENTION',
          },
          {
            label: 'Delivered work',
            value: healthSnapshot?.completedWorkCount ?? experience.completedWorkCount,
            helper: 'Completed work items',
            icon: CheckCircle2,
            tone: 'success' as const,
            navPath: '/ledger',
          },
          {
            label: 'Evidence outputs',
            value: healthSnapshot?.outputArtifactCount ?? experience.latestOutputCount,
            helper: 'Artifacts and handoffs',
            icon: FileText,
            tone: 'info' as const,
            navPath: '/ledger',
          },
        ].map(item => (
          <button
            key={item.label}
            type="button"
            onClick={() => navigate(item.navPath)}
            className="stat-tile group cursor-pointer text-left transition-shadow hover:shadow-md hover:ring-1 hover:ring-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="stat-label">{item.label}</p>
                <p className="stat-value">{item.value}</p>
              </div>
              <div
                className={cn(
                  'stat-icon transition-transform group-hover:scale-110',
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
          </button>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
      <SectionCard
          title="Today"
          description="Home stays summary-first while Work becomes the operating cockpit."
          icon={ShieldCheck}
          tone="brand"
        >
          <div className="rounded-[1.6rem] border border-primary/15 bg-white px-5 py-5">
            {primaryReadinessGate ? (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="form-kicker text-amber-800">Delivery gate</p>
                    <p className="mt-1 text-sm font-semibold text-amber-950">
                      {primaryReadinessGate.blockingReason || primaryReadinessGate.summary}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-800">
                      {primaryReadinessGate.nextRequiredAction ||
                        'Resolve the missing setup before starting heavier workflow execution.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(primaryReadinessGate.path)}
                    className="enterprise-button enterprise-button-secondary shrink-0"
                  >
                    Fix gate
                  </button>
                </div>
              </div>
            ) : null}
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
              onClick={() => navigate('/')}
              className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white"
            >
              <p className="text-sm font-semibold text-on-surface">Open Work</p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Inbox, waits, copilot, uploads, evidence preview, and the live operating story.
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
            <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4 md:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="form-kicker">Desktop execution</p>
                  <p className="mt-2 text-lg font-bold text-on-surface">{executionOwnerLabel}</p>
                  <p className="mt-2 text-xs text-secondary">
                    {workspace.executionQueueReason === 'EXECUTOR_DISCONNECTED'
                      ? 'The previous desktop owner disconnected. Queued runs will resume after a desktop claims this capability again.'
                      : workspace.executionQueueReason === 'EXECUTOR_RELEASED'
                      ? 'Execution was released and queued runs are waiting for a desktop owner.'
                      : 'Automated workflow execution is desktop-owned; browser sessions can queue work, but a claimed desktop starts and resumes it.'}
                  </p>
                </div>
                <StatusBadge
                  tone={
                    workspace.executionDispatchState === 'ASSIGNED'
                      ? 'success'
                      : workspace.executionDispatchState === 'STALE_EXECUTOR'
                      ? 'warning'
                      : 'neutral'
                  }
                >
                  {executionDispatchLabel}
                </StatusBadge>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Golden path"
          description="The fastest trustworthy path from capability setup to the first real evidence packet."
          icon={ClipboardCheck}
        >
          <div className="space-y-3">
            {experience.goldenPathProgress.steps.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.path)}
                className="flex w-full items-start justify-between gap-3 rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3 text-left transition hover:border-primary/20 hover:bg-white"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-on-surface">{item.label}</p>
                    <StatusBadge
                      tone={
                        item.status === 'COMPLETE'
                          ? 'success'
                          : item.status === 'CURRENT'
                          ? 'brand'
                          : 'neutral'
                      }
                    >
                      {item.status === 'COMPLETE'
                        ? 'Complete'
                        : item.status === 'CURRENT'
                        ? 'Current'
                        : 'Up next'}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-secondary">
                    {item.description}
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
          title="Execution Control Plane"
          description="Make the runtime lane legible as an enterprise control surface, not just a hidden coding dependency."
          icon={Database}
          action={
            <button
              type="button"
              onClick={() => navigate('/run-console')}
              className="enterprise-button enterprise-button-secondary"
            >
              Open run console
            </button>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
              <p className="form-kicker">Primary provider</p>
              <p className="mt-2 text-lg font-bold text-on-surface">
                {runtimeStatus?.provider || 'Unknown'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                {runtimeStatus?.availableProviders?.length
                  ? `${runtimeStatus.availableProviders.filter(provider => provider.configured).length} configured lane(s) · ${runtimeStatus.availableProviders.length} available`
                  : 'Runtime provider abstraction is present even if this environment only exposes one configured lane today.'}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
              <p className="form-kicker">Runtime access</p>
              <p className="mt-2 text-lg font-bold text-on-surface">
                {runtimeStatus?.runtimeAccessMode || 'Unknown'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                {runtimeStatus?.modelCatalogSource === 'runtime'
                  ? 'Live model catalog is coming from the connected runtime.'
                  : 'The app is falling back to a static model catalog in this session.'}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
              <p className="form-kicker">Execution owner</p>
              <p className="mt-2 text-lg font-bold text-on-surface">{executionOwnerLabel}</p>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                {executionDispatchLabel} · {runtimeStatus?.defaultModel || 'No default model resolved'}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
              <p className="form-kicker">Provider posture</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(runtimeStatus?.availableProviders || []).length > 0 ? (
                  runtimeStatus?.availableProviders?.map(provider => (
                    <StatusBadge
                      key={provider.key}
                      tone={provider.configured ? 'success' : 'neutral'}
                    >
                      {provider.label}
                    </StatusBadge>
                  ))
                ) : (
                  <StatusBadge tone="neutral">Single runtime lane</StatusBadge>
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                This is the layer that should stay visibly independent from any one coding agent or vendor.
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Operational Integrations"
          description="GitHub, Jira, and Confluence should read like live operating surfaces, not just setup fields."
          icon={FolderGit2}
          action={
            <button
              type="button"
              onClick={() => navigate('/capabilities/metadata')}
              className="enterprise-button enterprise-button-secondary"
            >
              Open metadata
            </button>
          }
        >
          <div className="grid gap-3">
            {[
              {
                key: 'github',
                label: 'GitHub',
                status: connectorContext?.github.status,
                helper: connectorContext?.github.message,
                count:
                  (connectorContext?.github.repositories.length || 0) +
                  (connectorContext?.github.pullRequests.length || 0) +
                  (connectorContext?.github.issues.length || 0),
              },
              {
                key: 'jira',
                label: 'Jira',
                status: connectorContext?.jira.status,
                helper: connectorContext?.jira.message,
                count: connectorContext?.jira.issues.length || 0,
              },
              {
                key: 'confluence',
                label: 'Confluence',
                status: connectorContext?.confluence.status,
                helper: connectorContext?.confluence.message,
                count: connectorContext?.confluence.pages.length || 0,
              },
            ].map(item => (
              <div
                key={item.key}
                className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="form-kicker">{item.label}</p>
                    <p className="mt-2 text-lg font-bold text-on-surface">
                      {item.count} live context item{item.count === 1 ? '' : 's'}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-secondary">
                      {item.helper || 'Integration status has not been loaded yet.'}
                    </p>
                  </div>
                  <StatusBadge tone={getConnectorTone(item.status)}>
                    {item.status ? formatEnumLabel(item.status) : 'Loading'}
                  </StatusBadge>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate('/incidents')}
              className="enterprise-button enterprise-button-secondary"
            >
              Open incidents
            </button>
            <button
              type="button"
              onClick={() => navigate('/mrm')}
              className="enterprise-button enterprise-button-secondary"
            >
              Open MRM
            </button>
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
              onClick={() => navigate('/?new=1')}
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
                        navigate(`/?selected=${encodeURIComponent(item.id)}`)
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
                  onClick={() => navigate('/?new=1')}
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
                'Optional: add a business outcome so owners know what this capability is meant to achieve.'}
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
              value: activeCapability.gitRepositories.length,
              helper:
                activeCapability.gitRepositories[0] ||
                'No repository linked',
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
        description="Technical diagnostics and builder tools remain available, but they surface only when the current role or capability context really needs them."
        storageKey="singularity.home.advanced.open"
        badge={<StatusBadge tone="neutral">Technical tools</StatusBadge>}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {visibleAdvancedTools.map(tool => {
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
