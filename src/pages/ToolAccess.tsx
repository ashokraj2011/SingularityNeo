import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Search,
  ShieldCheck,
  Workflow as WorkflowIcon,
  Wrench,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCapability } from '../context/CapabilityContext';
import { formatEnumLabel } from '../lib/enterprise';
import { deriveExecutionBoundary } from '../lib/workflowRuntime';
import type { CapabilityAgent, ToolAdapterId, Workflow, WorkflowStep } from '../types';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
  Toolbar,
} from '../components/EnterpriseUI';

type StepAccessRecord = {
  workflow: Workflow;
  step: WorkflowStep;
  agent: CapabilityAgent | null;
  allowedToolIds: ToolAdapterId[];
  workspaceMode: 'NONE' | 'READ_ONLY' | 'APPROVED_WRITE';
  requiresHumanApproval: boolean;
  escalationTriggers: string[];
};

const TOOL_TONE: Record<ToolAdapterId, 'info' | 'warning' | 'danger'> = {
  workspace_list: 'info',
  workspace_read: 'info',
  workspace_search: 'info',
  git_status: 'info',
  workspace_write: 'danger',
  run_build: 'warning',
  run_test: 'warning',
  run_docs: 'warning',
  run_deploy: 'danger',
};

const HIGH_IMPACT_TOOLS = new Set<ToolAdapterId>(['workspace_write', 'run_deploy']);

const byLabel = <T extends { label: string }>(items: T[]) =>
  items.slice().sort((left, right) => left.label.localeCompare(right.label));

export default function ToolAccess() {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const activeWorkflows = useMemo(
    () => workspace.workflows.filter(workflow => !workflow.archivedAt),
    [workspace.workflows],
  );

  const stepAccess = useMemo<StepAccessRecord[]>(
    () =>
      activeWorkflows.flatMap(workflow =>
        workflow.steps.map(step => {
          const agent =
            workspace.agents.find(candidate => candidate.id === step.agentId) || null;
          const boundary = deriveExecutionBoundary(activeCapability, step);

          return {
            workflow,
            step,
            agent,
            allowedToolIds: boundary.allowedToolIds,
            workspaceMode: boundary.workspaceMode,
            requiresHumanApproval: boundary.requiresHumanApproval,
            escalationTriggers: boundary.escalationTriggers,
          };
        }),
      ),
    [activeCapability, activeWorkflows, workspace.agents],
  );

  const filteredStepAccess = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return stepAccess.filter(record => {
      if (workflowFilter && record.workflow.id !== workflowFilter) {
        return false;
      }
      if (agentFilter && record.step.agentId !== agentFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        record.workflow.name,
        record.step.name,
        record.step.action,
        record.agent?.name,
        record.agent?.role,
        ...record.allowedToolIds,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [agentFilter, searchQuery, stepAccess, workflowFilter]);

  const agentSummaries = useMemo(() => {
    const summaries = workspace.agents.map(agent => {
      const records = stepAccess.filter(record => record.step.agentId === agent.id);
      const uniqueTools = [...new Set(records.flatMap(record => record.allowedToolIds))];
      const highImpactCount = records.filter(record =>
        record.allowedToolIds.some(toolId => HIGH_IMPACT_TOOLS.has(toolId)),
      ).length;

      return {
        agent,
        workflowCount: new Set(records.map(record => record.workflow.id)).size,
        stepCount: records.length,
        uniqueTools,
        preferredToolIds: agent.preferredToolIds || [],
        highImpactCount,
        approvalAwareCount: records.filter(record => record.requiresHumanApproval).length,
      };
    });

    return summaries;
  }, [stepAccess, workspace.agents]);

  const filteredAgentSummaries = useMemo(() => {
    return agentSummaries.filter(summary => {
      if (agentFilter && summary.agent.id !== agentFilter) {
        return false;
      }
      if (!searchQuery.trim()) {
        return true;
      }

      const haystack = [
        summary.agent.name,
        summary.agent.role,
        ...summary.uniqueTools,
        ...summary.preferredToolIds,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(searchQuery.trim().toLowerCase());
    });
  }, [agentFilter, agentSummaries, searchQuery]);

  const summaryStats = useMemo(() => {
    const highImpactSteps = stepAccess.filter(record =>
      record.allowedToolIds.some(toolId => HIGH_IMPACT_TOOLS.has(toolId)),
    ).length;
    const approvalAwareSteps = stepAccess.filter(record => record.requiresHumanApproval).length;
    const agentsWithTools = agentSummaries.filter(summary => summary.uniqueTools.length > 0).length;

    return {
      workflowCount: activeWorkflows.length,
      stepCount: stepAccess.length,
      highImpactSteps,
      approvalAwareSteps,
      agentsWithTools,
    };
  }, [activeWorkflows.length, agentSummaries, stepAccess]);

  const workflowOptions = useMemo(
    () =>
      byLabel(
        activeWorkflows.map(workflow => ({
          id: workflow.id,
          label: workflow.name,
        })),
      ),
    [activeWorkflows],
  );

  const agentOptions = useMemo(
    () =>
      byLabel(
        workspace.agents.map(agent => ({
          id: agent.id,
          label: agent.name,
        })),
      ),
    [workspace.agents],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Advanced Tools"
        context={activeCapability.id}
        title="Tool Access Policy"
        description="Tool access is step-scoped, not blanket agent access. Agents only get read, write, test, or deploy tools when a workflow step explicitly grants them."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate('/designer')}
              className="enterprise-button enterprise-button-secondary"
            >
              <WorkflowIcon size={16} />
              Open Designer
            </button>
            <button
              type="button"
              onClick={() => navigate('/orchestrator')}
              className="enterprise-button enterprise-button-secondary"
            >
              <ShieldCheck size={16} />
              Open Work
            </button>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatTile
            label="Workflows"
            value={summaryStats.workflowCount}
            helper="Active workflows shaping tool policy"
            icon={WorkflowIcon}
            tone="brand"
          />
          <StatTile
            label="Workflow steps"
            value={summaryStats.stepCount}
            helper="Step contracts reviewed"
            icon={Wrench}
            tone="info"
          />
          <StatTile
            label="Agents with tools"
            value={summaryStats.agentsWithTools}
            helper="Agents granted at least one step tool"
            icon={Bot}
            tone="success"
          />
          <StatTile
            label="Approval-aware"
            value={summaryStats.approvalAwareSteps}
            helper="Steps that explicitly pause or escalate"
            icon={ShieldCheck}
            tone="warning"
          />
          <StatTile
            label="High impact"
            value={summaryStats.highImpactSteps}
            helper="Write or deploy capable steps"
            icon={AlertTriangle}
            tone="danger"
          />
        </div>
      </PageHeader>

      <SectionCard
        title="How tool access works"
        description="Singularity keeps orchestration engine-first and grants tools only inside explicit step boundaries."
        icon={ShieldCheck}
        tone="brand"
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Default posture</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">No blanket tools</p>
            <p className="mt-2 text-sm leading-7 text-secondary">
              Agents can still reason, explain, collaborate, and ask for missing input without any tool permissions at all.
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Step boundary</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">Workflow decides access</p>
            <p className="mt-2 text-sm leading-7 text-secondary">
              Read, write, build, test, docs, and deploy access comes from the workflow step contract, not from the agent profile alone.
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Human control</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">Writes and deploys escalate</p>
            <p className="mt-2 text-sm leading-7 text-secondary">
              High-impact actions surface approval-aware controls, code diff review, and policy gates before the run can continue.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Filters"
        description="Narrow the policy view by workflow, agent, or tool/action text."
        icon={Search}
      >
        <Toolbar className="grid gap-3 md:grid-cols-[220px_220px_minmax(0,1fr)]">
          <label className="space-y-2">
            <span className="field-label">Workflow</span>
            <select
              value={workflowFilter}
              onChange={event => setWorkflowFilter(event.target.value)}
              className="field-select"
            >
              <option value="">All workflows</option>
              {workflowOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="field-label">Agent</span>
            <select
              value={agentFilter}
              onChange={event => setAgentFilter(event.target.value)}
              className="field-select"
            >
              <option value="">All agents</option>
              {agentOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="field-label">Search</span>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline"
              />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search steps, agents, or tools"
                className="field-input pl-10"
              />
            </div>
          </label>
        </Toolbar>
      </SectionCard>

      <SectionCard
        title="Agent reach"
        description="Preferred tool profiles are the agent defaults. Workflow step contracts below are still the actual execution gate."
        icon={Bot}
      >
        {filteredAgentSummaries.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {filteredAgentSummaries.map(summary => (
              <div
                key={summary.agent.id}
                className="rounded-3xl border border-outline-variant/30 bg-white p-5 shadow-[0_12px_32px_rgba(12,23,39,0.04)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-on-surface">{summary.agent.name}</p>
                    <p className="mt-1 text-sm text-secondary">{summary.agent.role}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {summary.uniqueTools.length > 0 ? (
                      <StatusBadge tone="brand">{summary.uniqueTools.length} tools</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">No tools</StatusBadge>
                    )}
                    {summary.highImpactCount > 0 ? (
                      <StatusBadge tone="danger">
                        {summary.highImpactCount} high impact
                      </StatusBadge>
                    ) : null}
                    {summary.approvalAwareCount > 0 ? (
                      <StatusBadge tone="warning">
                        {summary.approvalAwareCount} approval-aware
                      </StatusBadge>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="workspace-meta-card">
                    <p className="workspace-meta-label">Preferred profile</p>
                    <p className="workspace-meta-value">
                      {summary.preferredToolIds.length}
                    </p>
                  </div>
                  <div className="workspace-meta-card">
                    <p className="workspace-meta-label">Workflow reach</p>
                    <p className="workspace-meta-value">{summary.workflowCount}</p>
                  </div>
                  <div className="workspace-meta-card">
                    <p className="workspace-meta-label">Step grants</p>
                    <p className="workspace-meta-value">{summary.stepCount}</p>
                  </div>
                  <div className="workspace-meta-card">
                    <p className="workspace-meta-label">Model</p>
                    <p className="workspace-meta-value">{summary.agent.model}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {summary.preferredToolIds.length > 0 ? (
                      summary.preferredToolIds.map(toolId => (
                        <StatusBadge key={`preferred-${toolId}`} tone={TOOL_TONE[toolId] || 'info'}>
                          Preferred · {formatEnumLabel(toolId)}
                        </StatusBadge>
                      ))
                    ) : (
                      <p className="text-sm leading-7 text-secondary">
                        No preferred tool profile is defined for this agent yet.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {summary.uniqueTools.length > 0 ? (
                      summary.uniqueTools.map(toolId => (
                      <StatusBadge key={toolId} tone={TOOL_TONE[toolId]}>
                        Granted by workflow · {formatEnumLabel(toolId)}
                      </StatusBadge>
                      ))
                    ) : (
                      <p className="text-sm leading-7 text-secondary">
                        This agent can still collaborate and reason, but it does not currently have any explicit workflow tool grants.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No matching agents"
            description="Adjust the filters to review agent-level tool reach."
            icon={Bot}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Workflow step access"
        description="Step contracts are the real source of truth for allowed tools, workspace mode, and human approval behavior."
        icon={WorkflowIcon}
      >
        {filteredStepAccess.length > 0 ? (
          <div className="space-y-4">
            {filteredStepAccess.map(record => (
              <div
                key={`${record.workflow.id}:${record.step.id}`}
                className="rounded-3xl border border-outline-variant/30 bg-white p-5 shadow-[0_12px_32px_rgba(12,23,39,0.04)]"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="brand">{record.workflow.name}</StatusBadge>
                      <StatusBadge tone="neutral">
                        {formatEnumLabel(record.step.phase)}
                      </StatusBadge>
                      <StatusBadge
                        tone={
                          record.workspaceMode === 'APPROVED_WRITE'
                            ? 'warning'
                            : record.workspaceMode === 'READ_ONLY'
                            ? 'info'
                            : 'neutral'
                        }
                      >
                        {formatEnumLabel(record.workspaceMode)}
                      </StatusBadge>
                      <StatusBadge
                        tone={record.requiresHumanApproval ? 'warning' : 'success'}
                      >
                        {record.requiresHumanApproval ? 'Approval-aware' : 'Engine-managed'}
                      </StatusBadge>
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-on-surface">
                      {record.step.name}
                    </h3>
                    <p className="mt-1 text-sm text-secondary">
                      {record.agent?.name || record.step.agentId} · {formatEnumLabel(record.step.stepType)}
                    </p>
                    <p className="mt-3 text-sm leading-7 text-secondary">
                      {record.step.description || record.step.action}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[24rem]">
                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Allowed tools</p>
                      <p className="workspace-meta-value">
                        {record.allowedToolIds.length}
                      </p>
                    </div>
                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Required inputs</p>
                      <p className="workspace-meta-value">
                        {(record.step.requiredInputs || []).length +
                          (record.step.artifactContract?.requiredInputs?.length || 0)}
                      </p>
                    </div>
                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Completion gates</p>
                      <p className="workspace-meta-value">
                        {(record.step.exitCriteria?.length || 0) +
                          (record.step.completionGates?.length || 0)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {record.allowedToolIds.length > 0 ? (
                    record.allowedToolIds.map(toolId => (
                      <StatusBadge key={toolId} tone={TOOL_TONE[toolId]}>
                        {formatEnumLabel(toolId)}
                      </StatusBadge>
                    ))
                  ) : (
                    <StatusBadge tone="neutral">No explicit tools</StatusBadge>
                  )}
                </div>

                {record.escalationTriggers.length > 0 ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <p className="font-semibold">Escalation triggers</p>
                    <ul className="mt-2 space-y-1">
                      {record.escalationTriggers.map(trigger => (
                        <li key={trigger} className="flex gap-2">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                          <span>{trigger}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-4">
                    <p className="workspace-section-title">Required inputs</p>
                    <div className="mt-3 space-y-2">
                      {(record.step.requiredInputs?.length || 0) > 0 ||
                      (record.step.artifactContract?.requiredInputs?.length || 0) > 0 ? (
                        [
                          ...(record.step.requiredInputs || []).map(field => field.label),
                          ...(record.step.artifactContract?.requiredInputs || []),
                        ].map(label => (
                          <div
                            key={label}
                            className="rounded-2xl bg-white px-3 py-2 text-sm text-secondary"
                          >
                            {label}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-secondary">
                          No structured input contract is declared for this step.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-4">
                    <p className="workspace-section-title">Completion signals</p>
                    <div className="mt-3 space-y-2">
                      {[...(record.step.exitCriteria || []), ...(record.step.completionGates || [])]
                        .length > 0 ? (
                        [...(record.step.exitCriteria || []), ...(record.step.completionGates || [])].map(
                          item => (
                            <div
                              key={item}
                              className="rounded-2xl bg-white px-3 py-2 text-sm text-secondary"
                            >
                              {item}
                            </div>
                          ),
                        )
                      ) : (
                        <p className="text-sm text-secondary">
                          This step relies on the engine and artifact contract rather than named completion gates.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No workflow step access matched"
            description="Try another workflow, agent, or search term to inspect the policy surface."
            icon={ShieldCheck}
          />
        )}
      </SectionCard>

      {stepAccess.length === 0 ? (
        <EmptyState
          title="No workflow policy found yet"
          description="Publish or create a workflow in Designer to define step-level tool access for this capability."
          icon={WorkflowIcon}
          action={
            <button
              type="button"
              onClick={() => navigate('/designer')}
              className="enterprise-button enterprise-button-primary"
            >
              <WorkflowIcon size={16} />
              Open Designer
            </button>
          }
        />
      ) : null}
    </div>
  );
}
