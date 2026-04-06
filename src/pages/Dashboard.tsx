import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bolt,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  FolderGit2,
  Globe,
  Layers,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BLUEPRINTS } from '../constants';
import { useCapability } from '../context/CapabilityContext';
import { formatEnumLabel, getStatusTone } from '../lib/enterprise';
import { cn } from '../lib/utils';
import {
  DataTable,
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
  Toolbar,
} from '../components/EnterpriseUI';

const Dashboard = () => {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const [taskFilter, setTaskFilter] = useState<
    'ALL' | 'QUEUED' | 'PROCESSING' | 'COMPLETED'
  >('ALL');
  const workspace = getCapabilityWorkspace(activeCapability.id);

  const agentsById = useMemo(
    () => new Map(workspace.agents.map(agent => [agent.id, agent.name])),
    [workspace.agents],
  );
  const workflowsById = useMemo(
    () => new Map(workspace.workflows.map(workflow => [workflow.id, workflow])),
    [workspace.workflows],
  );

  const filteredBlueprints = useMemo(
    () => BLUEPRINTS.filter(bp => bp.capabilityId === activeCapability.id),
    [activeCapability.id],
  );

  const liveWorkPackages = useMemo(
    () =>
      workspace.workItems
        .slice()
        .sort((left, right) => {
          const leftTimestamp = left.history[left.history.length - 1]?.timestamp || '';
          const rightTimestamp = right.history[right.history.length - 1]?.timestamp || '';
          return rightTimestamp.localeCompare(leftTimestamp);
        })
        .slice(0, 8),
    [workspace.workItems],
  );

  const filteredTasks = useMemo(() => {
    if (taskFilter === 'ALL') {
      return workspace.tasks;
    }
    return workspace.tasks.filter(task => task.status === taskFilter);
  }, [taskFilter, workspace.tasks]);

  const dashboardStats = useMemo(
    () => [
      {
        label: 'Active Work',
        value: workspace.workItems.filter(item => item.status === 'ACTIVE').length,
        helper: `${workspace.workItems.filter(item => item.status === 'COMPLETED').length} completed`,
        icon: Activity,
        tone: 'brand' as const,
      },
      {
        label: 'Agents',
        value: workspace.agents.length,
        helper: `${workspace.agents.filter(agent => agent.isBuiltIn).length} built-in`,
        icon: Sparkles,
        tone: 'info' as const,
      },
      {
        label: 'Artifacts',
        value: workspace.artifacts.length,
        helper: `${workspace.executionLogs.length} execution logs`,
        icon: FileText,
        tone: 'success' as const,
      },
      {
        label: 'Approvals & Blocks',
        value:
          workspace.workItems.filter(
            item => item.status === 'BLOCKED' || item.status === 'PENDING_APPROVAL',
          ).length,
        helper: `${workspace.workItems.filter(item => item.status === 'BLOCKED').length} blocked`,
        icon: ShieldCheck,
        tone:
          workspace.workItems.some(item => item.status === 'BLOCKED')
            ? ('danger' as const)
            : ('warning' as const),
      },
    ],
    [workspace.agents, workspace.artifacts.length, workspace.executionLogs.length, workspace.workItems],
  );

  const recommendedSteps = useMemo(() => {
    const recommendations: Array<{
      key: string;
      title: string;
      desc: string;
      icon: typeof ShieldCheck;
      tone: 'brand' | 'warning' | 'success';
      onClick: () => void;
    }> = [];

    const blockedItem = workspace.workItems.find(item => item.status === 'BLOCKED');
    if (blockedItem) {
      recommendations.push({
        key: `blocked-${blockedItem.id}`,
        title: `Unblock ${blockedItem.title}`,
        desc:
          blockedItem.blocker?.message ||
          `Resolve the blocker in ${blockedItem.phase.toLowerCase()} and continue the workflow run.`,
        icon: RefreshCw,
        tone: 'warning',
        onClick: () =>
          navigate(`/orchestrator?selected=${encodeURIComponent(blockedItem.id)}`),
      });
    }

    const pendingApprovalItem = workspace.workItems.find(
      item => item.status === 'PENDING_APPROVAL',
    );
    if (pendingApprovalItem) {
      recommendations.push({
        key: `approval-${pendingApprovalItem.id}`,
        title: `Approve ${pendingApprovalItem.title}`,
        desc:
          pendingApprovalItem.pendingRequest?.message ||
          `Review the governance gate and release the work item forward.`,
        icon: ShieldCheck,
        tone: 'warning',
        onClick: () =>
          navigate(`/orchestrator?selected=${encodeURIComponent(pendingApprovalItem.id)}`),
      });
    }

    const activeItem = workspace.workItems.find(item => item.status === 'ACTIVE');
    if (activeItem) {
      const workflow = workflowsById.get(activeItem.workflowId);
      const currentStep = workflow?.steps.find(step => step.id === activeItem.currentStepId);
      recommendations.push({
        key: `continue-${activeItem.id}`,
        title: `Continue ${activeItem.title}`,
        desc:
          currentStep?.description ||
          `Inspect the current step and runtime evidence before advancing execution.`,
        icon: ArrowRight,
        tone: 'brand',
        onClick: () =>
          navigate(`/orchestrator?selected=${encodeURIComponent(activeItem.id)}`),
      });
    }

    if (recommendations.length === 0 && workspace.workflows.length > 0) {
      recommendations.push({
        key: 'create-work-package',
        title: 'Launch new work package',
        desc: 'Create a new story and place it into the active SDLC workflow.',
        icon: Bolt,
        tone: 'brand',
        onClick: () => navigate('/orchestrator?new=1'),
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        key: 'define-workflow',
        title: 'Define workflow',
        desc: 'Set up the enterprise workflow before starting capability delivery.',
        icon: Workflow,
        tone: 'success',
        onClick: () => navigate('/designer'),
      });
    }

    return recommendations.slice(0, 3);
  }, [navigate, workspace.workItems, workspace.workflows, workflowsById]);

  const architectureFacts = [
    {
      label: 'Applications',
      value: activeCapability.applications.length,
      detail:
        activeCapability.applications.slice(0, 3).join(', ') ||
        'No applications registered yet',
      icon: Globe,
    },
    {
      label: 'APIs & Services',
      value: activeCapability.apis.length,
      detail:
        activeCapability.apis.slice(0, 3).join(', ') || 'No services registered yet',
      icon: Layers,
    },
    {
      label: 'Data Stores',
      value: activeCapability.databases.length,
      detail:
        activeCapability.databases.slice(0, 3).join(', ') ||
        'No databases registered yet',
      icon: Database,
    },
    {
      label: 'Git Repositories',
      value: activeCapability.gitRepositories.length,
      detail:
        activeCapability.gitRepositories.slice(0, 2).join(', ') ||
        'No repositories linked yet',
      icon: FolderGit2,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capability Overview"
        context={activeCapability.id}
        title={`${activeCapability.name} Command Center`}
        description="Operational overview for the active capability, including live work, governance pressure, evidence output, and recommended next actions."
        actions={
          <>
            <button
              type="button"
              onClick={() => navigate('/team')}
              className="enterprise-button enterprise-button-secondary"
            >
              <Sparkles size={16} />
              Manage agents
            </button>
            <button
              type="button"
              onClick={() => navigate('/orchestrator?new=1')}
              className="enterprise-button enterprise-button-primary"
            >
              <Bolt size={16} />
              New work package
            </button>
          </>
        }
      >
        <Toolbar className="w-fit">
          <div className="min-w-[10rem]">
            <p className="form-kicker">Domain</p>
            <p className="mt-1 text-sm font-semibold text-on-surface">
              {activeCapability.domain || 'Unassigned'}
            </p>
          </div>
          <div className="hidden h-10 w-px bg-outline-variant/50 sm:block" />
          <div className="min-w-[10rem]">
            <p className="form-kicker">Business Unit</p>
            <p className="mt-1 text-sm font-semibold text-on-surface">
              {activeCapability.businessUnit || 'Unassigned'}
            </p>
          </div>
          <div className="hidden h-10 w-px bg-outline-variant/50 sm:block" />
          <div className="min-w-[10rem]">
            <p className="form-kicker">Primary Workflow</p>
            <p className="mt-1 text-sm font-semibold text-on-surface">
              {workspace.workflows[0]?.name || 'No workflow'}
            </p>
          </div>
        </Toolbar>
      </PageHeader>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map(stat => (
          <StatTile
            key={stat.label}
            label={stat.label}
            value={stat.value}
            helper={stat.helper}
            icon={stat.icon}
            tone={stat.tone}
          />
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.7fr)]">
        <SectionCard
          title="Capability footprint"
          description="Core systems, services, repositories, and delivery context tied to this capability."
          icon={Layers}
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
          <div className="grid gap-4 md:grid-cols-2">
            {architectureFacts.map(item => (
              <div
                key={item.label}
                className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="stat-label">{item.label}</p>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-on-surface">
                      {item.value}
                    </p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/10 bg-white text-primary">
                    <item.icon size={16} />
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-secondary">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Recommended next steps"
          description="Focused actions based on the live state of work items, approvals, and workflow runs."
          icon={ShieldCheck}
          tone="brand"
        >
          <div className="space-y-3">
            {recommendedSteps.map(step => (
              <button
                key={step.key}
                type="button"
                onClick={step.onClick}
                className="flex w-full items-start gap-3 rounded-2xl border border-primary/10 bg-white px-4 py-4 text-left transition-all hover:border-primary/20 hover:bg-primary/5"
              >
                <div
                  className={cn(
                    'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
                    step.tone === 'warning'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : step.tone === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-primary/10 bg-primary/10 text-primary',
                  )}
                >
                  <step.icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-secondary">
                    {step.desc}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <SectionCard
          title="Recent work packages"
          description="Latest work items in this capability with owning workflow and current status."
          icon={Workflow}
          action={
            <button
              type="button"
              onClick={() => navigate('/orchestrator')}
              className="enterprise-button enterprise-button-secondary"
            >
              Open orchestrator
            </button>
          }
        >
          <DataTable
            header={
              <div className="grid grid-cols-[1.3fr_1fr_0.9fr_0.9fr] gap-3">
                <span>Work Item</span>
                <span>Workflow</span>
                <span>Status</span>
                <span>Owner</span>
              </div>
            }
          >
            {liveWorkPackages.length > 0 ? (
              liveWorkPackages.map(workItem => (
                <button
                  key={workItem.id}
                  type="button"
                  onClick={() =>
                    navigate(`/orchestrator?selected=${encodeURIComponent(workItem.id)}`)
                  }
                  className="grid w-full grid-cols-[1.3fr_1fr_0.9fr_0.9fr] gap-3 border-t border-outline-variant/35 px-4 py-4 text-left text-sm transition-all hover:bg-surface-container-low"
                >
                  <div>
                    <p className="font-semibold text-on-surface">{workItem.title}</p>
                    <p className="mt-1 text-xs text-secondary">{workItem.id}</p>
                  </div>
                  <span className="text-secondary">
                    {workflowsById.get(workItem.workflowId)?.name || 'Workflow not found'}
                  </span>
                  <div>
                    <StatusBadge tone={getStatusTone(workItem.status)}>
                      {formatEnumLabel(workItem.status)}
                    </StatusBadge>
                  </div>
                  <span className="text-secondary">
                    {agentsById.get(workItem.assignedAgentId || '') || 'Unassigned'}
                  </span>
                </button>
              ))
            ) : (
              <EmptyState
                title="No live work packages"
                description="Create a new work package to start capability execution and see it appear here."
                icon={Bolt}
                className="m-4 min-h-[12rem]"
                action={
                  <button
                    type="button"
                    onClick={() => navigate('/orchestrator?new=1')}
                    className="enterprise-button enterprise-button-primary"
                  >
                    <Bolt size={16} />
                    Create work package
                  </button>
                }
              />
            )}
          </DataTable>
        </SectionCard>

        <SectionCard
          title="Agent task flow"
          description="Live task stream across the selected capability."
          icon={Activity}
          action={
            <Toolbar className="border-0 bg-transparent p-0 shadow-none">
              {(['ALL', 'QUEUED', 'PROCESSING', 'COMPLETED'] as const).map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setTaskFilter(status)}
                  className={cn(
                    'rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] transition-all',
                    taskFilter === status
                      ? 'bg-primary text-white'
                      : 'bg-surface-container-low text-secondary hover:text-on-surface',
                  )}
                >
                  {status}
                </button>
              ))}
            </Toolbar>
          }
        >
          <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {filteredTasks.length > 0 ? (
              filteredTasks.map(task => (
                <div
                  key={task.id}
                  className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-on-surface">{task.title}</p>
                      <p className="mt-1 text-xs text-secondary">
                        {task.agent} • {task.timestamp}
                      </p>
                    </div>
                    <StatusBadge tone={getStatusTone(task.status)}>
                      {formatEnumLabel(task.status)}
                    </StatusBadge>
                  </div>
                  {task.executionNotes ? (
                    <p className="mt-3 text-sm leading-relaxed text-secondary">
                      {task.executionNotes}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <EmptyState
                title="No tasks for this filter"
                description="Change the filter or start more execution activity to populate the stream."
                icon={Clock3}
                className="min-h-[12rem]"
              />
            )}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Workflow blueprints"
        description="Registered blueprint and architecture references mapped to this capability."
        icon={Layers}
        action={
          <button
            type="button"
            onClick={() => navigate('/designer')}
            className="enterprise-button enterprise-button-secondary"
          >
            View design workspace
            <ArrowRight size={16} />
          </button>
        }
      >
        {filteredBlueprints.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {filteredBlueprints.map(blueprint => (
              <div
                key={blueprint.id}
                className="rounded-2xl border border-outline-variant/50 bg-surface-container-low px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-on-surface">
                      {blueprint.title}
                    </p>
                    <p className="mt-1 text-xs text-secondary">
                      {blueprint.description}
                    </p>
                  </div>
                  <StatusBadge tone={getStatusTone(blueprint.status)}>
                    {formatEnumLabel(blueprint.status)}
                  </StatusBadge>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs font-medium text-secondary">
                  <span>{blueprint.version}</span>
                  <span>{blueprint.activeIds} active IDs</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No blueprints linked"
            description="Use the design workspace to define or register enterprise workflow blueprints for this capability."
            icon={FileText}
          />
        )}
      </SectionCard>
    </div>
  );
};

export default Dashboard;
