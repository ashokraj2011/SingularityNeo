import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  FolderGit2,
  Gauge,
  MessageSquareText,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  buildCapabilityExperience,
  ADVANCED_TOOL_DESCRIPTORS,
  type AdvancedToolId,
  getAgentHealth,
  getBusinessWorkStatusLabel,
  getReadinessLabel,
  getReadinessTone,
} from '../lib/capabilityExperience';
import { getStatusTone } from '../lib/enterprise';
import { fetchRuntimeStatus, type RuntimeStatus } from '../lib/api';
import { cn } from '../lib/utils';
import { useCapability } from '../context/CapabilityContext';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/EnterpriseUI';
import { AdvancedDisclosure } from '../components/WorkspaceUI';

const advancedToolIcons: Record<AdvancedToolId, typeof Database> = {
  memory: Database,
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
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capability Home"
        context={activeCapability.id}
        title={activeCapability.name}
        description={
          activeCapability.description ||
          'A guided workspace for readiness, active work, collaboration, and evidence.'
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
            <p className="form-kicker">Readiness</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-on-surface">
              {experience.readinessScore}%
            </p>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              {experience.readinessItems.filter(item => item.status === 'READY').length} of{' '}
              {experience.readinessItems.length} setup checks are ready.
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
            value: experience.activeWorkCount,
            helper: 'Items currently moving',
            icon: BriefcaseBusiness,
            tone: 'brand' as const,
          },
          {
            label: 'Needs attention',
            value: experience.blockerCount + experience.approvalCount,
            helper: `${experience.blockerCount} blocked, ${experience.approvalCount} approvals`,
            icon: AlertTriangle,
            tone:
              experience.blockerCount > 0
                ? ('danger' as const)
                : experience.approvalCount > 0
                ? ('warning' as const)
                : ('success' as const),
          },
          {
            label: 'Delivered work',
            value: experience.completedWorkCount,
            helper: 'Completed work items',
            icon: CheckCircle2,
            tone: 'success' as const,
          },
          {
            label: 'Evidence outputs',
            value: experience.latestOutputCount,
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
              <p className="text-sm font-semibold text-on-surface">Open Team</p>
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
          title="Readiness checklist"
          description="Plain-language setup health for business users."
          icon={ClipboardCheck}
        >
          <div className="space-y-3">
            {experience.readinessItems.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.path)}
                className="flex w-full items-start justify-between gap-3 rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-3 text-left transition hover:border-primary/20 hover:bg-white"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-on-surface">{item.label}</p>
                    <StatusBadge tone={getReadinessTone(item.status)}>
                      {getReadinessLabel(item.status)}
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
          title="Delivery"
          description="Business-facing work currently moving through the capability."
          icon={PlayCircle}
          action={
            <button
              type="button"
              onClick={() => navigate('/orchestrator?new=1')}
              className="enterprise-button enterprise-button-secondary"
            >
              New work
            </button>
          }
        >
          {activeWork.length > 0 ? (
            <div className="space-y-3">
              {activeWork.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    navigate(`/orchestrator?selected=${encodeURIComponent(item.id)}`)
                  }
                  className="flex w-full items-start justify-between gap-3 rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4 text-left transition hover:border-primary/20 hover:bg-white"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-on-surface">{item.title}</p>
                    <p className="mt-1 text-xs text-secondary">
                      {item.phase.toLowerCase()} • {item.priority} priority
                    </p>
                  </div>
                  <StatusBadge tone={getStatusTone(item.status)}>
                    {getBusinessWorkStatusLabel(item.status)}
                  </StatusBadge>
                </button>
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
                  className="enterprise-button enterprise-button-primary"
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
        description="Core setup behind this capability, available when you need to inspect the operating model."
        storageKey="singularity.home.foundation.open"
        badge={<StatusBadge tone="neutral">Setup details</StatusBadge>}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Workflow',
              value: primaryWorkflow?.name || 'Not defined',
              helper: primaryWorkflow?.publishState || 'Create or publish workflow',
              icon: Workflow,
              path: '/designer',
            },
            {
              label: 'Applications',
              value: activeCapability.applications.length,
              helper: activeCapability.applications.slice(0, 2).join(', ') || 'No apps listed',
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
    </div>
  );
};

export default Dashboard;
