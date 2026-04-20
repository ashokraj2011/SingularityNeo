import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Hammer,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCapability } from '../context/CapabilityContext';
import { fetchCapabilityFlightRecorder } from '../lib/api';
import type {
  CapabilityAgent,
  CapabilityFlightRecorderSnapshot,
  FlightRecorderPolicySummary,
  ToolAdapterId,
  ToolInvocation,
  Workflow,
  WorkflowStep,
} from '../types';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import {
  ToolInvocationPolicyBadge,
  type ToolInvocationPolicyDecision,
} from '../components/ToolInvocationPolicyBadge';

/**
 * /tools — capability-wide tool-adapter inventory.
 *
 * Walks the active capability's workflows (step.allowedToolIds) and agents
 * (agent.preferredToolIds) to build a single de-duped list of tool adapters
 * that are *claimed* somewhere in the capability, then enriches every row
 * with:
 *   • "Used in" — the workflow steps + agents that declare the tool
 *   • "Recent invocations" — count of ToolInvocation records from the flight
 *     recorder snapshot for this capability
 *   • "Last verdict" — the most recent policy decision matched on
 *     toolInvocationId (reusing ToolInvocationPolicyBadge)
 *   • "Approval gate" — any step that uses this tool has approvalPolicy set
 *
 * No backend changes — derives from the existing CapabilityWorkspace tree
 * and the existing /api/capabilities/:id/flight-recorder endpoint.
 */

type ToolCategory = 'Read' | 'Write' | 'Orchestration' | 'Build & Deploy';

const TOOL_CATEGORY: Record<ToolAdapterId, ToolCategory> = {
  workspace_list: 'Read',
  workspace_read: 'Read',
  workspace_search: 'Read',
  git_status: 'Read',
  workspace_write: 'Write',
  workspace_replace_block: 'Write',
  workspace_apply_patch: 'Write',
  delegate_task: 'Orchestration',
  publish_bounty: 'Orchestration',
  resolve_bounty: 'Orchestration',
  wait_for_signal: 'Orchestration',
  run_build: 'Build & Deploy',
  run_test: 'Build & Deploy',
  run_docs: 'Build & Deploy',
  run_deploy: 'Build & Deploy',
};

const TOOL_LABEL: Record<ToolAdapterId, string> = {
  workspace_list: 'Workspace list',
  workspace_read: 'Workspace read',
  workspace_search: 'Workspace search',
  git_status: 'Git status',
  workspace_write: 'Workspace write',
  workspace_replace_block: 'Workspace replace block',
  workspace_apply_patch: 'Workspace apply patch',
  delegate_task: 'Delegate task',
  publish_bounty: 'Publish bounty',
  resolve_bounty: 'Resolve bounty',
  wait_for_signal: 'Wait for signal',
  run_build: 'Run build',
  run_test: 'Run tests',
  run_docs: 'Run docs',
  run_deploy: 'Run deploy',
};

const CATEGORY_TONE: Record<ToolCategory, 'info' | 'warning' | 'danger' | 'brand'> = {
  Read: 'info',
  Orchestration: 'brand',
  'Build & Deploy': 'warning',
  Write: 'danger',
};

type UsageRef =
  | {
      kind: 'workflow-step';
      workflow: Workflow;
      step: WorkflowStep;
    }
  | {
      kind: 'agent';
      agent: CapabilityAgent;
    };

type ToolRow = {
  toolId: ToolAdapterId;
  label: string;
  category: ToolCategory;
  usage: UsageRef[];
  invocations: ToolInvocation[];
  latestInvocation?: ToolInvocation;
  latestDecision?: ToolInvocationPolicyDecision;
  approvalGated: boolean;
};

const dedupeBy = <T, K>(items: T[], key: (value: T) => K): T[] => {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
};

export default function ToolsLibrary() {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);

  const [snapshot, setSnapshot] =
    useState<CapabilityFlightRecorderSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLoadError(undefined);
    fetchCapabilityFlightRecorder(activeCapability.id)
      .then(next => {
        if (!isMounted) return;
        setSnapshot(next);
      })
      .catch(nextError => {
        if (!isMounted) return;
        setLoadError(
          nextError instanceof Error
            ? nextError.message
            : 'Could not load recent tool invocations.',
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [activeCapability.id]);

  const activeWorkflows = useMemo(
    () => workspace.workflows.filter(workflow => !workflow.archivedAt),
    [workspace.workflows],
  );

  const allInvocations = useMemo<ToolInvocation[]>(() => {
    if (!snapshot) return [];
    return snapshot.workItems.flatMap(detail => detail.toolInvocations);
  }, [snapshot]);

  const allDecisions = useMemo<FlightRecorderPolicySummary[]>(() => {
    if (!snapshot) return [];
    return snapshot.workItems.flatMap(detail => detail.policyDecisions);
  }, [snapshot]);

  const rows = useMemo<ToolRow[]>(() => {
    const usageByTool = new Map<ToolAdapterId, UsageRef[]>();
    const approvalGatedTools = new Set<ToolAdapterId>();

    for (const workflow of activeWorkflows) {
      for (const step of workflow.steps) {
        const allowed = step.allowedToolIds || [];
        for (const toolId of allowed) {
          const list = usageByTool.get(toolId) || [];
          list.push({ kind: 'workflow-step', workflow, step });
          usageByTool.set(toolId, list);
          if (step.approvalPolicy) approvalGatedTools.add(toolId);
        }
      }
    }

    for (const agent of workspace.agents) {
      const preferred = agent.preferredToolIds || [];
      for (const toolId of preferred) {
        const list = usageByTool.get(toolId) || [];
        list.push({ kind: 'agent', agent });
        usageByTool.set(toolId, list);
      }
    }

    const sortedInvocations = [...allInvocations].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return tb - ta;
    });

    const decisions: ToolInvocationPolicyDecision[] = allDecisions;

    const toolIds = Array.from(usageByTool.keys()).sort((a, b) =>
      TOOL_LABEL[a].localeCompare(TOOL_LABEL[b]),
    );

    return toolIds.map<ToolRow>(toolId => {
      const invocations = sortedInvocations.filter(item => item.toolId === toolId);
      const latestInvocation = invocations[0];
      const latestDecision = latestInvocation
        ? decisions.find(entry => entry.toolInvocationId === latestInvocation.id)
        : undefined;
      return {
        toolId,
        label: TOOL_LABEL[toolId] ?? toolId,
        category: TOOL_CATEGORY[toolId] ?? 'Read',
        usage: usageByTool.get(toolId) || [],
        invocations,
        latestInvocation,
        latestDecision,
        approvalGated: approvalGatedTools.has(toolId),
      };
    });
  }, [activeWorkflows, workspace.agents, allInvocations, allDecisions]);

  const decisionsForBadge = useMemo<ToolInvocationPolicyDecision[]>(
    () => allDecisions,
    [allDecisions],
  );

  const totalUsages = useMemo(
    () => rows.reduce((acc, row) => acc + row.usage.length, 0),
    [rows],
  );

  const writeToolsInUse = useMemo(
    () => rows.filter(row => row.category === 'Write' || row.category === 'Build & Deploy').length,
    [rows],
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Tools"
        context={activeCapability.id}
        title={`${activeCapability.name} tool inventory`}
        description="Every tool adapter this capability's workflows and agents claim, with the workflow steps and agents that declare it, recent invocations, and the latest policy verdict per tool."
        actions={
          <button
            type="button"
            onClick={() => navigate('/tool-access')}
            className="inline-flex items-center gap-2 rounded-2xl border border-primary/10 bg-white px-4 py-3 text-sm font-bold text-primary shadow-sm transition-all hover:bg-primary/5"
          >
            <ShieldCheck size={16} />
            Step-level Rule Engine
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatTile
          label="Tools claimed"
          value={rows.length}
          icon={Wrench}
          tone="brand"
        />
        <StatTile
          label="Workflow/agent bindings"
          value={totalUsages}
          icon={Hammer}
        />
        <StatTile
          label="Write or deploy tools"
          value={writeToolsInUse}
          icon={AlertTriangle}
          tone={writeToolsInUse > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Recent invocations"
          value={isLoading ? '…' : allInvocations.length}
          icon={ShieldCheck}
        />
      </div>

      {loadError ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Recent invocations and verdicts could not be loaded: {loadError}
        </div>
      ) : null}

      <SectionCard
        title="Tool inventory"
        description="Used in: every workflow step (step.allowedToolIds) and agent (agent.preferredToolIds) that claims this tool. Click a link to land on the exact source."
        icon={Wrench}
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No tools claimed yet"
            description="This capability has no workflow step or agent declaring a tool adapter. Open the Designer to add a step that uses a tool, or attach preferred tools to an agent from the Agents page."
            action={
              <button
                type="button"
                onClick={() => navigate('/designer')}
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
              >
                <ArrowRight size={16} />
                Open Designer
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-outline-variant/30 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                  <th className="py-3 pr-4">Tool</th>
                  <th className="py-3 pr-4">Category</th>
                  <th className="py-3 pr-4">Used in</th>
                  <th className="py-3 pr-4">Recent invocations</th>
                  <th className="py-3 pr-4">Last verdict</th>
                  <th className="py-3 pr-4">Approval gate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr
                    key={row.toolId}
                    className="border-b border-outline-variant/15 align-top"
                  >
                    <td className="py-4 pr-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-bold text-on-surface">
                          {row.label}
                        </span>
                        <code className="text-[0.6875rem] font-mono text-outline">
                          {row.toolId}
                        </code>
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <StatusBadge tone={CATEGORY_TONE[row.category]}>
                        {row.category}
                      </StatusBadge>
                    </td>
                    <td className="py-4 pr-4">
                      <ul className="space-y-1.5">
                        {row.usage.map((usage, index) =>
                          usage.kind === 'workflow-step' ? (
                            <li
                              key={`${row.toolId}-wf-${usage.workflow.id}-${usage.step.id}-${index}`}
                              className="flex items-center gap-2 text-xs text-secondary"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(
                                    `/designer?workflowId=${encodeURIComponent(usage.workflow.id)}&stepId=${encodeURIComponent(usage.step.id)}`,
                                  )
                                }
                                className="group inline-flex items-center gap-1 rounded-full border border-primary/10 bg-primary/5 px-2 py-1 text-[0.6875rem] font-semibold text-primary transition-colors hover:bg-primary/10"
                              >
                                <span>{usage.workflow.name}</span>
                                <ArrowRight size={11} />
                                <span>{usage.step.name}</span>
                              </button>
                            </li>
                          ) : (
                            <li
                              key={`${row.toolId}-agent-${usage.agent.id}-${index}`}
                              className="flex items-center gap-2 text-xs text-secondary"
                            >
                              <button
                                type="button"
                                onClick={() => navigate('/team')}
                                className="inline-flex items-center gap-1 rounded-full border border-outline-variant/30 bg-surface-container-low px-2 py-1 text-[0.6875rem] font-semibold text-secondary transition-colors hover:bg-white"
                              >
                                <Bot size={11} />
                                <span>{usage.agent.name}</span>
                              </button>
                            </li>
                          ),
                        )}
                      </ul>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-on-surface">
                          {isLoading ? '…' : row.invocations.length}
                        </span>
                        {row.invocations.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => navigate('/ledger')}
                            className="text-[0.6875rem] font-semibold text-primary hover:underline"
                          >
                            Open ledger
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      {row.latestInvocation && row.latestDecision ? (
                        <ToolInvocationPolicyBadge
                          toolInvocationId={row.latestInvocation.id}
                          policyDecisions={decisionsForBadge}
                        />
                      ) : row.latestInvocation ? (
                        <StatusBadge tone="neutral">Ungated</StatusBadge>
                      ) : (
                        <span className="text-xs text-outline">
                          {isLoading ? '…' : 'No runs yet'}
                        </span>
                      )}
                    </td>
                    <td className="py-4 pr-4">
                      {row.approvalGated ? (
                        <StatusBadge tone="warning">Required</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">None</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
