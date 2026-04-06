import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  LayoutGrid,
  List,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  Workflow as WorkflowIcon,
  Wrench,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useCapability } from '../context/CapabilityContext';
import { formatEnumLabel, getStatusTone } from '../lib/enterprise';
import {
  approveCapabilityWorkflowRun,
  cancelCapabilityWorkflowRun,
  createCapabilityWorkItem,
  fetchCapabilityWorkflowRun,
  fetchCapabilityWorkflowRunEvents,
  fetchRuntimeStatus,
  listCapabilityWorkflowRuns,
  moveCapabilityWorkItem,
  provideCapabilityWorkflowRunInput,
  resolveCapabilityWorkflowRunConflict,
  restartCapabilityWorkflowRun,
  startCapabilityWorkflowRun,
  type RuntimeStatus,
} from '../lib/api';
import { SDLC_BOARD_PHASES } from '../lib/standardWorkflow';
import { cn } from '../lib/utils';
import type {
  RunEvent,
  RunWait,
  WorkItem,
  WorkItemPhase,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunStep,
} from '../types';
import {
  BoardColumn,
  DrawerShell,
  EmptyState,
  ModalShell,
  PageHeader,
  StatTile,
  StatusBadge,
  Toolbar,
} from '../components/EnterpriseUI';

const PHASE_META: Record<WorkItemPhase, { label: string; accent: string }> = {
  BACKLOG: { label: 'Backlog', accent: 'bg-slate-100 text-slate-700' },
  ANALYSIS: { label: 'Analysis', accent: 'bg-sky-100 text-sky-700' },
  DESIGN: { label: 'Design', accent: 'bg-indigo-100 text-indigo-700' },
  DEVELOPMENT: { label: 'Development', accent: 'bg-primary/10 text-primary' },
  QA: { label: 'QA', accent: 'bg-emerald-100 text-emerald-700' },
  GOVERNANCE: { label: 'Governance', accent: 'bg-amber-100 text-amber-700' },
  RELEASE: { label: 'Release', accent: 'bg-fuchsia-100 text-fuchsia-700' },
  DONE: { label: 'Done', accent: 'bg-surface-container-high text-secondary' },
};

const RUN_STATUS_META: Record<
  WorkflowRun['status'],
  { label: string; accent: string }
> = {
  QUEUED: { label: 'Queued', accent: 'bg-slate-100 text-slate-700' },
  RUNNING: { label: 'Running', accent: 'bg-primary/10 text-primary' },
  WAITING_APPROVAL: { label: 'Waiting Approval', accent: 'bg-amber-100 text-amber-700' },
  WAITING_INPUT: { label: 'Waiting Input', accent: 'bg-orange-100 text-orange-700' },
  WAITING_CONFLICT: { label: 'Waiting Conflict', accent: 'bg-red-100 text-red-700' },
  COMPLETED: { label: 'Completed', accent: 'bg-emerald-100 text-emerald-700' },
  FAILED: { label: 'Failed', accent: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Cancelled', accent: 'bg-slate-200 text-slate-700' },
};

const WORK_ITEM_STATUS_META: Record<
  WorkItem['status'],
  { label: string; accent: string }
> = {
  ACTIVE: { label: 'Active', accent: 'bg-primary/10 text-primary' },
  BLOCKED: { label: 'Blocked', accent: 'bg-red-100 text-red-700' },
  PENDING_APPROVAL: { label: 'Pending Approval', accent: 'bg-amber-100 text-amber-700' },
  COMPLETED: { label: 'Completed', accent: 'bg-emerald-100 text-emerald-700' },
};

const ACTIVE_RUN_STATUSES: WorkflowRun['status'][] = [
  'QUEUED',
  'RUNNING',
  'WAITING_APPROVAL',
  'WAITING_INPUT',
  'WAITING_CONFLICT',
];

const formatTimestamp = (value?: string) => {
  if (!value) {
    return 'Not yet';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const summarizeJson = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2);

const getCurrentWorkflowStep = (
  workflow: Workflow | null,
  runDetail: WorkflowRunDetail | null,
  workItem: WorkItem | null,
) => {
  if (!workflow) {
    return null;
  }

  if (runDetail?.run.currentStepId) {
    return (
      workflow.steps.find(step => step.id === runDetail.run.currentStepId) || null
    );
  }

  if (workItem?.currentStepId) {
    return workflow.steps.find(step => step.id === workItem.currentStepId) || null;
  }

  const lastCompletedRunStep = runDetail?.steps
    .filter(step => step.status === 'COMPLETED')
    .slice(-1)[0];

  if (lastCompletedRunStep) {
    return (
      workflow.steps.find(step => step.id === lastCompletedRunStep.workflowStepId) ||
      null
    );
  }

  return workItem?.phase === 'DONE' ? workflow.steps[workflow.steps.length - 1] || null : null;
};

const getSelectedRunWait = (runDetail: WorkflowRunDetail | null) =>
  runDetail?.waits.slice().reverse().find(wait => wait.status === 'OPEN') || null;

const getAttentionReason = ({
  blocker,
  pendingRequest,
  wait,
}: {
  blocker?: WorkItem['blocker'];
  pendingRequest?: WorkItem['pendingRequest'];
  wait?: RunWait | null;
}) => blocker?.message || wait?.message || pendingRequest?.message || '';

const getAttentionLabel = ({
  blocker,
  pendingRequest,
  wait,
}: {
  blocker?: WorkItem['blocker'];
  pendingRequest?: WorkItem['pendingRequest'];
  wait?: RunWait | null;
}) => {
  if (blocker?.status === 'OPEN') {
    return blocker.type === 'HUMAN_INPUT'
      ? 'Waiting for human input'
      : 'Waiting for conflict resolution';
  }

  if (wait?.type === 'APPROVAL' || pendingRequest?.type === 'APPROVAL') {
    return 'Waiting for approval';
  }

  if (wait?.type === 'INPUT' || pendingRequest?.type === 'INPUT') {
    return 'Waiting for input';
  }

  if (
    wait?.type === 'CONFLICT_RESOLUTION' ||
    pendingRequest?.type === 'CONFLICT_RESOLUTION'
  ) {
    return 'Waiting for conflict resolution';
  }

  return 'Action required';
};

const DetailPill = ({
  accent,
  children,
}: {
  accent: string;
  children: React.ReactNode;
}) => (
  <span
    className={cn(
      'inline-flex rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em]',
      accent,
    )}
  >
    {children}
  </span>
);

const Orchestrator = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeCapability, getCapabilityWorkspace, refreshCapabilityBundle } =
    useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);

  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [draggedWorkItemId, setDraggedWorkItemId] = useState<string | null>(null);
  const [dragOverPhase, setDragOverPhase] = useState<WorkItemPhase | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<RunEvent[]>([]);
  const [selectedRunHistory, setSelectedRunHistory] = useState<WorkflowRun[]>([]);
  const [resolutionNote, setResolutionNote] = useState('');
  const [draftWorkItem, setDraftWorkItem] = useState({
    title: '',
    description: '',
    workflowId: workspace.workflows[0]?.id || '',
    priority: 'Med' as WorkItem['priority'],
    tags: '',
  });

  const workflowsById = useMemo(
    () => new Map(workspace.workflows.map(workflow => [workflow.id, workflow])),
    [workspace.workflows],
  );
  const agentsById = useMemo(
    () => new Map(workspace.agents.map(agent => [agent.id, agent])),
    [workspace.agents],
  );
  const workItems = workspace.workItems;

  const loadSelectedRunData = useCallback(
    async (workItemId: string) => {
      const runs = await listCapabilityWorkflowRuns(activeCapability.id, workItemId);
      setSelectedRunHistory(runs);

      const latestRun = runs[0];
      if (!latestRun) {
        setSelectedRunDetail(null);
        setSelectedRunEvents([]);
        return;
      }

      const [detail, events] = await Promise.all([
        fetchCapabilityWorkflowRun(activeCapability.id, latestRun.id),
        fetchCapabilityWorkflowRunEvents(activeCapability.id, latestRun.id),
      ]);
      setSelectedRunDetail(detail);
      setSelectedRunEvents(events);
    },
    [activeCapability.id],
  );

  const refreshSelection = useCallback(
    async (workItemId?: string | null) => {
      await refreshCapabilityBundle(activeCapability.id);
      if (workItemId) {
        await loadSelectedRunData(workItemId);
      }
    },
    [activeCapability.id, loadSelectedRunData, refreshCapabilityBundle],
  );

  useEffect(() => {
    void refreshCapabilityBundle(activeCapability.id);
  }, [activeCapability.id, refreshCapabilityBundle]);

  useEffect(() => {
    let isMounted = true;

    fetchRuntimeStatus()
      .then(status => {
        if (!isMounted) {
          return;
        }
        setRuntimeStatus(status);
        setRuntimeError('');
      })
      .catch(error => {
        if (!isMounted) {
          return;
        }
        setRuntimeError(
          error instanceof Error ? error.message : 'Unable to load runtime configuration.',
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedWorkItemId || workItems.some(item => item.id === selectedWorkItemId)) {
      return;
    }
    setSelectedWorkItemId(null);
  }, [selectedWorkItemId, workItems]);

  useEffect(() => {
    if (!selectedWorkItemId) {
      setSelectedRunDetail(null);
      setSelectedRunEvents([]);
      setSelectedRunHistory([]);
      setResolutionNote('');
      return;
    }

    void loadSelectedRunData(selectedWorkItemId).catch(error => {
      setActionError(
        error instanceof Error ? error.message : 'Failed to load workflow run details.',
      );
    });
  }, [loadSelectedRunData, selectedWorkItemId]);

  useEffect(() => {
    const nextSearchParams = new URLSearchParams(searchParams);
    let shouldReplace = false;

    if (searchParams.get('new') === '1') {
      setIsCreateModalOpen(true);
      nextSearchParams.delete('new');
      shouldReplace = true;
    }

    const selectedId = searchParams.get('selected');
    if (selectedId && workItems.some(item => item.id === selectedId)) {
      setSelectedWorkItemId(selectedId);
      nextSearchParams.delete('selected');
      shouldReplace = true;
    }

    if (shouldReplace) {
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, workItems]);

  useEffect(() => {
    const hasActiveRuns = workItems.some(item => Boolean(item.activeRunId));
    if (!hasActiveRuns && !selectedWorkItemId) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshSelection(selectedWorkItemId);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [refreshSelection, selectedWorkItemId, workItems]);

  const selectedWorkItem =
    workItems.find(item => item.id === selectedWorkItemId) || null;
  const selectedWorkflow = selectedWorkItem
    ? workflowsById.get(selectedWorkItem.workflowId) || null
    : null;
  const selectedCurrentStep = getCurrentWorkflowStep(
    selectedWorkflow,
    selectedRunDetail,
    selectedWorkItem,
  );
  const selectedOpenWait = getSelectedRunWait(selectedRunDetail);
  const selectedAgent = selectedCurrentStep?.agentId
    ? agentsById.get(selectedCurrentStep.agentId) || null
    : selectedWorkItem?.assignedAgentId
    ? agentsById.get(selectedWorkItem.assignedAgentId) || null
    : null;
  const selectedAttentionReason = selectedWorkItem
    ? getAttentionReason({
        blocker: selectedWorkItem.blocker,
        pendingRequest: selectedWorkItem.pendingRequest,
        wait: selectedOpenWait,
      })
    : '';
  const selectedAttentionLabel = selectedWorkItem
    ? getAttentionLabel({
        blocker: selectedWorkItem.blocker,
        pendingRequest: selectedWorkItem.pendingRequest,
        wait: selectedOpenWait,
      })
    : 'Action required';
  const selectedAttentionRequestedBy =
    selectedWorkItem?.blocker?.requestedBy ||
    selectedOpenWait?.requestedBy ||
    selectedWorkItem?.pendingRequest?.requestedBy ||
    selectedAgent?.id;
  const selectedAttentionTimestamp =
    selectedWorkItem?.blocker?.timestamp ||
    selectedOpenWait?.createdAt ||
    selectedWorkItem?.pendingRequest?.timestamp;

  const stepOrder = useMemo(
    () =>
      new Map(
        (selectedWorkflow?.steps || []).map((step, index) => [step.id, index] as const),
      ),
    [selectedWorkflow],
  );

  const selectedTasks = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    return workspace.tasks
      .filter(task => task.workItemId === selectedWorkItem.id)
      .slice()
      .sort(
        (left, right) =>
          (stepOrder.get(left.workflowStepId || '') ?? Number.MAX_SAFE_INTEGER) -
          (stepOrder.get(right.workflowStepId || '') ?? Number.MAX_SAFE_INTEGER),
      );
  }, [selectedWorkItem, stepOrder, workspace.tasks]);

  const selectedRunStepIds = useMemo(
    () => new Set(selectedRunDetail?.steps.map(step => step.id) || []),
    [selectedRunDetail],
  );

  const selectedArtifacts = useMemo(() => {
    if (!selectedRunDetail) {
      return [];
    }

    return workspace.artifacts.filter(
      artifact =>
        artifact.runId === selectedRunDetail.run.id ||
        (artifact.runStepId && selectedRunStepIds.has(artifact.runStepId)),
    );
  }, [selectedRunDetail, selectedRunStepIds, workspace.artifacts]);

  const selectedLogs = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    const relatedTaskIds = new Set<string>([
      selectedWorkItem.id,
      ...selectedTasks.map(task => task.id),
    ]);

    return workspace.executionLogs
      .filter(log => {
        if (selectedRunDetail && log.runId === selectedRunDetail.run.id) {
          return true;
        }
        return relatedTaskIds.has(log.taskId);
      })
      .slice()
      .sort(
        (left, right) =>
          new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
      );
  }, [selectedRunDetail, selectedTasks, selectedWorkItem, workspace.executionLogs]);

  const stats = useMemo(
    () => ({
      active: workItems.filter(item => item.status === 'ACTIVE').length,
      blocked: workItems.filter(item => item.status === 'BLOCKED').length,
      approvals: workItems.filter(item => item.status === 'PENDING_APPROVAL').length,
      completed: workItems.filter(item => item.status === 'COMPLETED').length,
    }),
    [workItems],
  );

  const currentRun = selectedRunDetail?.run || selectedRunHistory[0] || null;
  const currentRunIsActive = Boolean(
    currentRun && ACTIVE_RUN_STATUSES.includes(currentRun.status),
  );
  const canStartExecution =
    Boolean(selectedWorkItem) &&
    !selectedWorkItem?.activeRunId &&
    selectedWorkItem?.phase !== 'DONE';

  const canRestartFromPhase =
    Boolean(selectedWorkItem && currentRun && !selectedWorkItem.activeRunId) &&
    selectedWorkItem?.phase !== 'DONE';

  const actionButtonLabel =
    selectedOpenWait?.type === 'APPROVAL'
      ? 'Approve and continue'
      : selectedOpenWait?.type === 'INPUT'
      ? 'Submit details and unblock'
      : selectedOpenWait?.type === 'CONFLICT_RESOLUTION'
      ? 'Resolve conflict and unblock'
      : 'Continue';
  const resolutionPlaceholder =
    selectedOpenWait?.type === 'APPROVAL'
      ? 'Add approval notes, release conditions, or sign-off details.'
      : selectedOpenWait?.type === 'INPUT'
      ? 'Provide the missing business, technical, or governance details needed to unblock this work item.'
      : selectedOpenWait?.type === 'CONFLICT_RESOLUTION'
      ? 'Describe the conflict resolution, final decision, and any implementation constraints.'
      : 'Approval note, human input, restart note, or cancellation reason.';
  const resolutionIsRequired =
    selectedOpenWait?.type === 'INPUT' ||
    selectedOpenWait?.type === 'CONFLICT_RESOLUTION';
  const canResolveSelectedWait =
    Boolean(selectedOpenWait) &&
    (!resolutionIsRequired || Boolean(resolutionNote.trim()));

  const withAction = async (label: string, action: () => Promise<void>) => {
    setBusyAction(label);
    setActionError('');
    try {
      await action();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The orchestration action failed.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateWorkItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draftWorkItem.title.trim() || !draftWorkItem.workflowId) {
      return;
    }

    await withAction('create', async () => {
      const nextItem = await createCapabilityWorkItem(activeCapability.id, {
        title: draftWorkItem.title.trim(),
        description: draftWorkItem.description.trim() || undefined,
        workflowId: draftWorkItem.workflowId,
        priority: draftWorkItem.priority,
        tags: draftWorkItem.tags
          .split(',')
          .map(tag => tag.trim())
          .filter(Boolean),
      });

      await refreshSelection(nextItem.id);
      setSelectedWorkItemId(nextItem.id);
      setIsCreateModalOpen(false);
      setDraftWorkItem({
        title: '',
        description: '',
        workflowId: workspace.workflows[0]?.id || '',
        priority: 'Med',
        tags: '',
      });
    });
  };

  const handleStartExecution = async () => {
    if (!selectedWorkItem) {
      return;
    }

    await withAction('start', async () => {
      await startCapabilityWorkflowRun(activeCapability.id, selectedWorkItem.id);
      await refreshSelection(selectedWorkItem.id);
    });
  };

  const handleRestartExecution = async () => {
    if (!currentRun || !selectedWorkItem) {
      return;
    }

    await withAction('restart', async () => {
      await restartCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
        restartFromPhase: selectedWorkItem.phase,
      });
      await refreshSelection(selectedWorkItem.id);
    });
  };

  const handleResolveWait = async () => {
    if (!currentRun || !selectedOpenWait || !selectedWorkItem) {
      return;
    }

    const resolution = resolutionNote.trim() || actionButtonLabel;

    await withAction('resolve', async () => {
      if (selectedOpenWait.type === 'APPROVAL') {
        await approveCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
          resolution,
          resolvedBy: 'Capability Owner',
        });
      } else if (selectedOpenWait.type === 'INPUT') {
        await provideCapabilityWorkflowRunInput(activeCapability.id, currentRun.id, {
          resolution,
          resolvedBy: 'Capability Owner',
        });
      } else {
        await resolveCapabilityWorkflowRunConflict(activeCapability.id, currentRun.id, {
          resolution,
          resolvedBy: 'Capability Owner',
        });
      }

      setResolutionNote('');
      await refreshSelection(selectedWorkItem.id);
    });
  };

  const handleCancelRun = async () => {
    if (!currentRun || !selectedWorkItem) {
      return;
    }

    await withAction('cancel', async () => {
      await cancelCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
        note: resolutionNote.trim() || 'Run cancelled from the control plane.',
      });
      setResolutionNote('');
      await refreshSelection(selectedWorkItem.id);
    });
  };

  const handleMoveWorkItem = async (workItemId: string, targetPhase: WorkItemPhase) => {
    const item = workItems.find(current => current.id === workItemId);
    if (!item || item.phase === targetPhase) {
      return;
    }

    await withAction(`move-${workItemId}`, async () => {
      await moveCapabilityWorkItem(activeCapability.id, workItemId, {
        targetPhase,
        note: `Story moved to ${PHASE_META[targetPhase].label} from the orchestration board.`,
      });
      await refreshSelection(selectedWorkItemId === workItemId ? workItemId : undefined);
    });
  };

  const groupedItems = useMemo(
    () =>
      SDLC_BOARD_PHASES.map(phase => ({
        phase,
        items: workItems.filter(item => item.phase === phase),
      })),
    [workItems],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Execution Control Plane"
        context={activeCapability.id}
        title={`${activeCapability.name} Orchestration`}
        description="The backend execution worker owns workflow progression, waits, approvals, artifacts, logs, and tool execution. This screen is the enterprise control plane for launching work, staging stories intentionally, and reviewing durable run history."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Toolbar className="p-1">
              <button
                type="button"
                onClick={() => setView('board')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all',
                  view === 'board' ? 'bg-primary text-white' : 'text-secondary',
                )}
              >
                <LayoutGrid size={16} />
                Board
              </button>
              <button
                type="button"
                onClick={() => setView('list')}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all',
                  view === 'list' ? 'bg-primary text-white' : 'text-secondary',
                )}
              >
                <List size={16} />
                List
              </button>
            </Toolbar>

            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="enterprise-button enterprise-button-primary"
            >
              <Plus size={16} />
              New Work Item
            </button>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Active', value: stats.active, tone: 'brand' as const },
          { label: 'Blocked', value: stats.blocked, tone: 'danger' as const },
          { label: 'Pending Approval', value: stats.approvals, tone: 'warning' as const },
          { label: 'Completed', value: stats.completed, tone: 'success' as const },
        ].map(stat => (
          <StatTile
            key={stat.label}
            label={stat.label}
            value={stat.value}
            tone={stat.tone}
          />
        ))}
      </section>

      {runtimeError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {runtimeError}
        </div>
      )}

      {actionError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_420px]">
        <section className="section-card min-h-[48rem]">
          {view === 'board' ? (
            <div className="grid gap-4 xl:grid-cols-4 2xl:grid-cols-8">
              {groupedItems.map(({ phase, items }) => (
                <BoardColumn
                  key={phase}
                  title={PHASE_META[phase].label}
                  count={items.length}
                  badge={
                    <StatusBadge tone={getStatusTone(phase)}>
                      {PHASE_META[phase].label}
                    </StatusBadge>
                  }
                  active={dragOverPhase === phase}
                  className="transition-all"
                >
                  <div
                    onDragOver={event => {
                      event.preventDefault();
                      setDragOverPhase(phase);
                    }}
                    onDragLeave={() =>
                      setDragOverPhase(current => (current === phase ? null : current))
                    }
                    onDrop={event => {
                      event.preventDefault();
                      setDragOverPhase(null);
                      const droppedId =
                        event.dataTransfer.getData('text/plain') || draggedWorkItemId;
                      setDraggedWorkItemId(null);
                      if (droppedId) {
                        void handleMoveWorkItem(droppedId, phase);
                      }
                    }}
                    className="space-y-3"
                  >
                    {items.map(item => {
                      const workflow = workflowsById.get(item.workflowId) || null;
                      const currentStep = getCurrentWorkflowStep(workflow, null, item);
                      const agentName = item.assignedAgentId
                        ? agentsById.get(item.assignedAgentId)?.name
                        : undefined;

                      return (
                        <motion.button
                          key={item.id}
                          layout
                          draggable
                          onDragStart={event => {
                            setDraggedWorkItemId(item.id);
                            event.dataTransfer.setData('text/plain', item.id);
                          }}
                          onDragEnd={() => {
                            setDraggedWorkItemId(null);
                            setDragOverPhase(null);
                          }}
                          onClick={() => setSelectedWorkItemId(item.id)}
                          className={cn(
                            'w-full rounded-2xl border border-outline-variant/50 bg-white p-4 text-left shadow-[0_8px_24px_rgba(12,23,39,0.04)] transition-all hover:border-primary/25',
                            selectedWorkItemId === item.id &&
                              'border-primary/30 ring-2 ring-primary/10',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="form-kicker">{item.id}</p>
                              <h3 className="mt-2 text-sm font-semibold text-on-surface">
                                {item.title}
                              </h3>
                            </div>
                            <StatusBadge tone={getStatusTone(item.status)}>
                              {formatEnumLabel(item.status)}
                            </StatusBadge>
                          </div>

                          <div className="mt-4 space-y-2">
                            <div className="rounded-xl border border-outline-variant/35 bg-surface-container-low px-3 py-3">
                              <p className="form-kicker">Current Step</p>
                              <p className="mt-1 text-xs font-semibold text-on-surface">
                                {currentStep?.name || 'Awaiting orchestration'}
                              </p>
                            </div>
                            <div className="flex items-center justify-between text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-secondary">
                              <span>{agentName || 'Unassigned'}</span>
                              <span>{item.priority}</span>
                            </div>
                            {(item.blocker?.status === 'OPEN' || item.pendingRequest) && (
                              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-[0.75rem] text-amber-800">
                                <div className="flex items-center gap-2 font-bold uppercase tracking-[0.16em]">
                                  <AlertCircle size={14} />
                                  <span>
                                    {getAttentionLabel({
                                      blocker: item.blocker,
                                      pendingRequest: item.pendingRequest,
                                    })}
                                  </span>
                                </div>
                                <p className="mt-1 line-clamp-2 normal-case tracking-normal font-medium">
                                  {getAttentionReason({
                                    blocker: item.blocker,
                                    pendingRequest: item.pendingRequest,
                                  })}
                                </p>
                              </div>
                            )}
                          </div>
                        </motion.button>
                      );
                    })}

                    {items.length === 0 && (
                      <EmptyState
                        title={`No work in ${PHASE_META[phase].label}`}
                        description="Drop a work item here to restart or intentionally re-stage it."
                        icon={WorkflowIcon}
                        className="min-h-[10rem]"
                      />
                    )}
                  </div>
                </BoardColumn>
              ))}
            </div>
          ) : (
            <div className="data-table-shell">
              <div className="data-table-header grid grid-cols-[1.5fr_0.85fr_0.95fr_0.95fr_1.1fr] gap-3">
                <span>Work Item</span>
                <span>Phase</span>
                <span>Status</span>
                <span>Priority</span>
                <span>Current Step</span>
              </div>
              {workItems.map(item => {
                const workflow = workflowsById.get(item.workflowId) || null;
                const currentStep = getCurrentWorkflowStep(workflow, null, item);

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedWorkItemId(item.id)}
                    className={cn(
                      'grid w-full grid-cols-[1.5fr_0.85fr_0.95fr_0.95fr_1.1fr] gap-3 border-t border-outline-variant/35 px-4 py-4 text-left text-sm transition-all hover:bg-surface-container-low/60',
                      selectedWorkItemId === item.id && 'bg-primary/5',
                    )}
                  >
                    <div>
                      <p className="font-semibold text-on-surface">{item.title}</p>
                      <p className="mt-1 text-xs text-secondary">{item.id}</p>
                    </div>
                    <span>{PHASE_META[item.phase].label}</span>
                    <div>
                      <StatusBadge tone={getStatusTone(item.status)}>
                        {formatEnumLabel(item.status)}
                      </StatusBadge>
                    </div>
                    <span>{item.priority}</span>
                    <span>{currentStep?.name || 'Awaiting orchestration'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <DrawerShell>
          {!selectedWorkItem ? (
            <EmptyState
              title="Select a work item"
              description="Pick a story to inspect durable run history, review tool output, resume waits, or start execution from the current SDLC stage."
              icon={WorkflowIcon}
              className="h-full min-h-[48rem]"
            />
          ) : (
            <div className="flex h-full flex-col gap-6">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="form-kicker">{selectedWorkItem.id}</p>
                    <h2 className="mt-2 text-2xl font-bold tracking-tight text-on-surface">
                      {selectedWorkItem.title}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-secondary">
                      {selectedWorkItem.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={getStatusTone(selectedWorkItem.phase)}>
                      {PHASE_META[selectedWorkItem.phase].label}
                    </StatusBadge>
                    <StatusBadge tone={getStatusTone(selectedWorkItem.status)}>
                      {WORK_ITEM_STATUS_META[selectedWorkItem.status].label}
                    </StatusBadge>
                    {currentRun && (
                      <StatusBadge tone={getStatusTone(currentRun.status)}>
                        {RUN_STATUS_META[currentRun.status].label}
                      </StatusBadge>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                    <p className="form-kicker">Current Step</p>
                    <p className="mt-1 text-sm font-semibold text-on-surface">
                      {selectedCurrentStep?.name || 'Awaiting orchestration'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                    <p className="form-kicker">Active Agent</p>
                    <p className="mt-1 text-sm font-semibold text-on-surface">
                      {selectedAgent?.name || 'Unassigned'}
                    </p>
                  </div>
                </div>
              </div>
              <div className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4">
                {selectedAttentionReason && (
                  <div className="mb-4 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-900">
                    <div className="flex items-start gap-3">
                      <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-700" />
                      <div className="min-w-0">
                        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-amber-700">
                          {selectedAttentionLabel}
                        </p>
                        <p className="mt-2 text-sm font-semibold leading-relaxed">
                          {selectedAttentionReason}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-800">
                          <span>
                            Requested by:{' '}
                            <strong>
                              {agentsById.get(selectedAttentionRequestedBy || '')?.name ||
                                selectedAttentionRequestedBy ||
                                'System'}
                            </strong>
                          </span>
                          <span>
                            Since: <strong>{formatTimestamp(selectedAttentionTimestamp)}</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleStartExecution()}
                    disabled={!canStartExecution || busyAction !== null}
                    className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === 'start' ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
                    {selectedRunHistory.length > 0 ? 'Start from current phase' : 'Start execution'}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleResolveWait()}
                    disabled={!canResolveSelectedWait || busyAction !== null}
                    className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === 'resolve' ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <ShieldCheck size={16} />
                    )}
                    {actionButtonLabel}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleRestartExecution()}
                    disabled={!canRestartFromPhase || busyAction !== null}
                    className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === 'restart' ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                    Restart run
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCancelRun()}
                    disabled={!currentRunIsActive || busyAction !== null}
                    className="enterprise-button enterprise-button-danger disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === 'cancel' ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <Square size={16} />
                    )}
                    Cancel run
                  </button>
                </div>

                <textarea
                  value={resolutionNote}
                  onChange={event => setResolutionNote(event.target.value)}
                  placeholder={resolutionPlaceholder}
                  className="field-textarea mt-3 h-24 bg-white"
                />

                {resolutionIsRequired && !resolutionNote.trim() && selectedOpenWait && (
                  <p className="mt-2 text-xs font-medium text-amber-700">
                    Add the missing details above to unblock this work item and continue execution.
                  </p>
                )}

                {selectedOpenWait && (
                  <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <p className="font-bold uppercase tracking-[0.14em]">
                      Waiting for {selectedOpenWait.type.replace('_', ' ')}
                    </p>
                    <p className="mt-1 leading-relaxed">{selectedOpenWait.message}</p>
                  </div>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-outline-variant/15 bg-white p-4">
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                    Runtime
                  </p>
                  <p className="mt-2 text-sm font-bold text-on-surface">
                    {runtimeStatus?.configured ? 'Configured' : 'Not configured'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-secondary">
                    {runtimeStatus?.configured
                      ? `Model runtime is ${runtimeStatus.defaultModel}.`
                      : 'Add GITHUB_MODELS_TOKEN to enable backend execution.'}
                  </p>
                </div>
                <div className="rounded-3xl border border-outline-variant/15 bg-white p-4">
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                    Run Summary
                  </p>
                  <p className="mt-2 text-sm font-bold text-on-surface">
                    {currentRun
                      ? `Attempt ${currentRun.attemptNumber}`
                      : 'No run started yet'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-secondary">
                    {currentRun
                      ? `Started ${formatTimestamp(currentRun.startedAt || currentRun.createdAt)}`
                      : 'Launch execution to create a durable workflow run.'}
                  </p>
                </div>
              </div>

              <div className="space-y-4 overflow-y-auto pr-1">
                <section className="rounded-3xl border border-outline-variant/15 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <WorkflowIcon size={16} className="text-primary" />
                    <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                      Workflow Steps
                    </h3>
                  </div>
                  <div className="mt-4 space-y-3">
                    {(selectedWorkflow?.steps || []).map(step => {
                      const runStep =
                        selectedRunDetail?.steps.find(
                          current => current.workflowStepId === step.id,
                        ) || null;

                      return (
                        <div
                          key={step.id}
                          className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-on-surface">{step.name}</p>
                              <p className="mt-1 text-xs leading-relaxed text-secondary">
                                {step.action}
                              </p>
                            </div>
                            <DetailPill
                              accent={
                                runStep?.status === 'COMPLETED'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : runStep?.status === 'RUNNING'
                                  ? 'bg-primary/10 text-primary'
                                  : runStep?.status === 'WAITING'
                                  ? 'bg-amber-100 text-amber-700'
                                  : runStep?.status === 'FAILED'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-slate-100 text-slate-700'
                              }
                            >
                              {runStep?.status || 'PENDING'}
                            </DetailPill>
                          </div>

                          <div className="mt-3 grid gap-2 text-xs text-secondary sm:grid-cols-2">
                            <span>Phase: {PHASE_META[step.phase].label}</span>
                            <span>
                              Agent: {agentsById.get(step.agentId)?.name || step.agentId}
                            </span>
                            <span>Type: {step.stepType.replace('_', ' ')}</span>
                            <span>Attempts: {runStep?.attemptCount || 0}</span>
                          </div>

                          {(runStep?.outputSummary || runStep?.evidenceSummary) && (
                            <div className="mt-3 rounded-2xl bg-white px-3 py-2 text-xs leading-relaxed text-secondary">
                              {runStep.outputSummary || runStep.evidenceSummary}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-3xl border border-outline-variant/15 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <Wrench size={16} className="text-primary" />
                    <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                      Tool Invocations
                    </h3>
                  </div>
                  <div className="mt-4 space-y-3">
                    {(selectedRunDetail?.toolInvocations || []).length === 0 && (
                      <p className="text-sm text-secondary">No tool activity recorded yet.</p>
                    )}
                    {(selectedRunDetail?.toolInvocations || []).map(tool => (
                      <div
                        key={tool.id}
                        className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-on-surface">{tool.toolId}</p>
                            <p className="mt-1 text-xs text-secondary">
                              {tool.resultSummary || 'Tool invocation recorded.'}
                            </p>
                          </div>
                          <DetailPill
                            accent={
                              tool.status === 'COMPLETED'
                                ? 'bg-emerald-100 text-emerald-700'
                                : tool.status === 'FAILED'
                                ? 'bg-red-100 text-red-700'
                                : tool.status === 'RUNNING'
                                ? 'bg-primary/10 text-primary'
                                : 'bg-slate-100 text-slate-700'
                            }
                          >
                            {tool.status}
                          </DetailPill>
                        </div>
                        <pre className="mt-3 overflow-x-auto rounded-2xl bg-white px-3 py-2 text-[0.6875rem] leading-relaxed text-secondary">
                          {summarizeJson(tool.request)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-outline-variant/15 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-primary" />
                    <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                      Artifacts and Outputs
                    </h3>
                  </div>
                  <div className="mt-4 space-y-3">
                    {selectedArtifacts.length === 0 && (
                      <p className="text-sm text-secondary">No artifacts produced yet.</p>
                    )}
                    {selectedArtifacts.map(artifact => (
                      <div
                        key={artifact.id}
                        className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-on-surface">{artifact.name}</p>
                            <p className="mt-1 text-xs text-secondary">
                              {artifact.type} · {artifact.version}
                            </p>
                          </div>
                          <DetailPill accent="bg-primary/10 text-primary">
                            {artifact.direction || 'OUTPUT'}
                          </DetailPill>
                        </div>
                        {artifact.summary && (
                          <p className="mt-3 text-xs leading-relaxed text-secondary">
                            {artifact.summary}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-outline-variant/15 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <Clock3 size={16} className="text-primary" />
                    <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                      Event Timeline
                    </h3>
                  </div>
                  <div className="mt-4 space-y-3">
                    {selectedRunEvents.length === 0 && (
                      <p className="text-sm text-secondary">No run events recorded yet.</p>
                    )}
                    {selectedRunEvents.map(event => (
                      <div
                        key={event.id}
                        className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-on-surface">{event.message}</p>
                            <p className="mt-1 text-xs text-secondary">
                              {event.type} · {formatTimestamp(event.timestamp)}
                            </p>
                          </div>
                          <DetailPill
                            accent={
                              event.level === 'ERROR'
                                ? 'bg-red-100 text-red-700'
                                : event.level === 'WARN'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-primary/10 text-primary'
                            }
                          >
                            {event.level}
                          </DetailPill>
                        </div>
                        {event.details && (
                          <pre className="mt-3 overflow-x-auto rounded-2xl bg-white px-3 py-2 text-[0.6875rem] leading-relaxed text-secondary">
                            {summarizeJson(event.details)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-outline-variant/15 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <ArrowRight size={16} className="text-primary" />
                    <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-primary">
                      Execution Logs
                    </h3>
                  </div>
                  <div className="mt-4 space-y-3">
                    {selectedLogs.length === 0 && (
                      <p className="text-sm text-secondary">No logs recorded yet.</p>
                    )}
                    {selectedLogs.map(log => (
                      <div
                        key={log.id}
                        className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-on-surface">{log.message}</p>
                            <p className="mt-1 text-xs text-secondary">
                              {formatTimestamp(log.timestamp)} ·{' '}
                              {agentsById.get(log.agentId)?.name || log.agentId}
                            </p>
                          </div>
                          <DetailPill
                            accent={
                              log.level === 'ERROR'
                                ? 'bg-red-100 text-red-700'
                                : log.level === 'WARN'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-primary/10 text-primary'
                            }
                          >
                            {log.level}
                          </DetailPill>
                        </div>
                        {log.metadata && (
                          <pre className="mt-3 overflow-x-auto rounded-2xl bg-white px-3 py-2 text-[0.6875rem] leading-relaxed text-secondary">
                            {summarizeJson(log.metadata)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}
        </DrawerShell>
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 px-4 pb-8 pt-24">
          <ModalShell
            eyebrow="New Work Item"
            title="Launch work into the backend SDLC engine"
            description="Create a story, choose the workflow, and let the backend execution service own step progression, waits, artifacts, and resumable run history."
            actions={
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="enterprise-button enterprise-button-secondary"
              >
                Close
              </button>
            }
          >

            <form onSubmit={handleCreateWorkItem} className="mt-6 grid gap-5">
              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Work item title
                </span>
                <input
                  value={draftWorkItem.title}
                  onChange={event =>
                    setDraftWorkItem(prev => ({ ...prev, title: event.target.value }))
                  }
                  placeholder="Implement expression parser"
                  className="field-input"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Description
                </span>
                <textarea
                  value={draftWorkItem.description}
                  onChange={event =>
                    setDraftWorkItem(prev => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Describe the change, acceptance criteria, and any business context."
                  className="field-textarea h-28"
                />
              </label>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                    Workflow
                  </span>
                  <select
                    value={draftWorkItem.workflowId}
                    onChange={event =>
                      setDraftWorkItem(prev => ({
                        ...prev,
                        workflowId: event.target.value,
                      }))
                    }
                    className="field-select"
                  >
                    {workspace.workflows.map(workflow => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                    Priority
                  </span>
                  <select
                    value={draftWorkItem.priority}
                    onChange={event =>
                      setDraftWorkItem(prev => ({
                        ...prev,
                        priority: event.target.value as WorkItem['priority'],
                      }))
                    }
                    className="field-select"
                  >
                    <option value="High">High</option>
                    <option value="Med">Med</option>
                    <option value="Low">Low</option>
                  </select>
                </label>
              </div>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                  Tags
                </span>
                <input
                  value={draftWorkItem.tags}
                  onChange={event =>
                    setDraftWorkItem(prev => ({ ...prev, tags: event.target.value }))
                  }
                  placeholder="parser, math, compiler"
                  className="field-input"
                />
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyAction !== null}
                  className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === 'create' ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Plus size={16} />
                  )}
                  Create work item
                </button>
              </div>
            </form>
          </ModalShell>
        </div>
      )}
    </div>
  );
};

export default Orchestrator;
