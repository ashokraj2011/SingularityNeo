import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  LayoutGrid,
  LoaderCircle,
  MessageSquare,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Trello,
  User,
  Workflow as WorkflowIcon,
  Wrench,
  X,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useCapability } from '../context/CapabilityContext';
import { cn } from '../lib/utils';
import { SDLC_BOARD_PHASES } from '../lib/standardWorkflow';
import { syncWorkflowManagedTasksForWorkItem } from '../lib/workflowTaskAutomation';
import {
  fetchRuntimeStatus,
  sendCapabilityChat,
  type RuntimeStatus,
} from '../lib/api';
import { WorkItem, WorkItemPhase, WorkflowStep } from '../types';

const createWorkItemId = () => `WI-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const createHistoryId = () => `HIST-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const createLogId = () => `LOG-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

const formatTaskTimestamp = () =>
  new Date().toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const summarizeOutput = (value: string) =>
  value.replace(/\s+/g, ' ').trim().slice(0, 240);

const PHASE_META: Record<
  WorkItemPhase,
  {
    label: string;
    accent: string;
  }
> = {
  BACKLOG: { label: 'Backlog', accent: 'bg-slate-100 text-slate-700' },
  ANALYSIS: { label: 'Analysis', accent: 'bg-sky-100 text-sky-700' },
  DESIGN: { label: 'Design', accent: 'bg-indigo-100 text-indigo-700' },
  DEVELOPMENT: { label: 'Development', accent: 'bg-primary/10 text-primary' },
  QA: { label: 'QA', accent: 'bg-emerald-100 text-emerald-700' },
  GOVERNANCE: { label: 'Governance', accent: 'bg-amber-100 text-amber-700' },
  RELEASE: { label: 'Release', accent: 'bg-fuchsia-100 text-fuchsia-700' },
  DONE: { label: 'Done', accent: 'bg-surface-container-high text-secondary' },
};

const STATUS_META: Record<
  WorkItem['status'],
  {
    label: string;
    accent: string;
  }
> = {
  ACTIVE: { label: 'Active', accent: 'bg-primary/10 text-primary' },
  BLOCKED: { label: 'Blocked', accent: 'bg-error/10 text-error' },
  PENDING_APPROVAL: {
    label: 'Pending Approval',
    accent: 'bg-amber-100 text-amber-700',
  },
  COMPLETED: { label: 'Completed', accent: 'bg-emerald-100 text-emerald-700' },
};

const getPhaseOrder = (phase: WorkItemPhase) => SDLC_BOARD_PHASES.indexOf(phase);

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const createHistoryEntry = (
  actor: string,
  action: string,
  detail: string,
  phase?: WorkItemPhase,
  status?: WorkItem['status'],
) => ({
  id: createHistoryId(),
  timestamp: new Date().toISOString(),
  actor,
  action,
  detail,
  phase,
  status,
});

const getStepStatus = (step?: WorkflowStep): WorkItem['status'] =>
  step?.stepType === 'HUMAN_APPROVAL' ? 'PENDING_APPROVAL' : 'ACTIVE';

const buildPendingRequest = (step?: WorkflowStep): WorkItem['pendingRequest'] => {
  if (!step || step.stepType !== 'HUMAN_APPROVAL') {
    return undefined;
  }

  return {
    type: 'APPROVAL',
    message:
      `${step.name} is waiting for human approval before release execution can continue.`,
    requestedBy: step.agentId,
    timestamp: new Date().toISOString(),
  };
};

const resolveStepForPhase = (
  workflow: { steps: WorkflowStep[] },
  phase: WorkItemPhase,
  currentStepId?: string,
) => {
  if (phase === 'BACKLOG' || phase === 'DONE') {
    return undefined;
  }

  const phaseSteps = workflow.steps.filter(step => step.phase === phase);
  if (phaseSteps.length === 0) {
    return undefined;
  }

  return phaseSteps.find(step => step.id === currentStepId) || phaseSteps[0];
};

const buildExecutionPrompt = ({
  item,
  workflowName,
  step,
  agentName,
  taskPrompt,
  protocolName,
  protocolRules,
  inputArtifactLabel,
  outputArtifactLabel,
}: {
  item: WorkItem;
  workflowName: string;
  step: WorkflowStep;
  agentName: string;
  taskPrompt?: string;
  protocolName?: string;
  protocolRules?: string[];
  inputArtifactLabel?: string;
  outputArtifactLabel?: string;
}) =>
  [
    `Execute the current SDLC step for work item "${item.title}".`,
    `Workflow: ${workflowName}.`,
    `Assigned agent: ${agentName}.`,
    `Current phase: ${item.phase}.`,
    `Current step: ${step.name}.`,
    `Step objective: ${step.action}.`,
    step.description ? `Step guidance: ${step.description}` : null,
    `Story request: ${item.description}`,
    taskPrompt ? `Workflow-managed task prompt: ${taskPrompt}` : null,
    protocolName ? `Hand-off protocol: ${protocolName}.` : null,
    protocolRules?.length
      ? `Hand-off rules: ${protocolRules.join('; ')}`
      : null,
    inputArtifactLabel ? `Input artifact: ${inputArtifactLabel}` : null,
    outputArtifactLabel ? `Expected output artifact: ${outputArtifactLabel}` : null,
    step.exitCriteria?.length
      ? `Exit criteria: ${step.exitCriteria.join('; ')}`
      : null,
    step.stepType === 'DELIVERY'
      ? 'Execute this delivery step and provide a concise completion summary, the concrete output produced, and any residual risks.'
      : 'Prepare the validation or approval-ready evidence for this step, then summarize what is ready and what still needs human action.',
    'Answer in a practical execution style with sections for Summary, Output, and Follow-up.',
  ]
    .filter(Boolean)
    .join('\n');

const WorkItemCard = ({
  item,
  stepName,
  agentName,
  onClick,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  key?: React.Key;
  item: WorkItem;
  stepName: string;
  agentName: string;
  onClick: (id: string) => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>, id: string) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) => (
  <motion.button
    layout
    draggable
    onClick={() => onClick(item.id)}
    onDragStart={event => onDragStart(event, item.id)}
    onDragEnd={onDragEnd}
    className={cn(
      'w-full rounded-3xl border border-outline-variant/15 bg-white p-4 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md',
      isDragging && 'scale-[0.98] opacity-50',
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">{item.id}</p>
        <h3 className="mt-2 text-sm font-bold text-on-surface">{item.title}</h3>
      </div>
      <span
        className={cn(
          'rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em]',
          STATUS_META[item.status].accent,
        )}
      >
        {STATUS_META[item.status].label}
      </span>
    </div>

    <div className="mt-4 space-y-2">
      <div className="rounded-2xl bg-surface-container-low px-3 py-2">
        <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Current Step</p>
        <p className="mt-1 text-xs font-semibold text-on-surface">{stepName}</p>
      </div>
      <div className="flex items-center justify-between text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-secondary">
        <span>{agentName}</span>
        <span>{PHASE_META[item.phase].label}</span>
      </div>
      {(item.blocker?.status === 'OPEN' || item.pendingRequest) && (
        <div className="flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-amber-700">
          <AlertCircle size={14} />
          <span>{item.blocker?.status === 'OPEN' ? 'Blocked' : 'Action Required'}</span>
        </div>
      )}
    </div>
  </motion.button>
);

const Orchestrator = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeCapability, getCapabilityWorkspace, setCapabilityWorkspaceContent } =
    useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [actionNote, setActionNote] = useState('');
  const [draggedWorkItemId, setDraggedWorkItemId] = useState<string | null>(null);
  const [dragOverPhase, setDragOverPhase] = useState<WorkItemPhase | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [isExecutingWorkItemId, setIsExecutingWorkItemId] = useState<string | null>(null);
  const [draftWorkItem, setDraftWorkItem] = useState({
    title: '',
    description: '',
    workflowId: workspace.workflows[0]?.id || '',
    priority: 'Med' as WorkItem['priority'],
    tags: '',
  });

  const workItems = useMemo(() => workspace.workItems, [workspace.workItems]);
  const workflowsById = useMemo(
    () => new Map(workspace.workflows.map(workflow => [workflow.id, workflow])),
    [workspace.workflows],
  );
  const agentsById = useMemo(
    () => new Map(workspace.agents.map(agent => [agent.id, agent])),
    [workspace.agents],
  );

  useEffect(() => {
    if (!selectedWorkItemId || workItems.some(item => item.id === selectedWorkItemId)) {
      return;
    }
    setSelectedWorkItemId(null);
  }, [selectedWorkItemId, workItems]);

  useEffect(() => {
    setRuntimeError('');
  }, [selectedWorkItemId]);

  useEffect(() => {
    let isMounted = true;

    fetchRuntimeStatus()
      .then(nextStatus => {
        if (!isMounted) {
          return;
        }

        setRuntimeStatus(nextStatus);
        setRuntimeError('');
      })
      .catch(error => {
        if (!isMounted) {
          return;
        }

        setRuntimeError(
          error instanceof Error
            ? error.message
            : 'Unable to load runtime configuration.',
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

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
      setActionNote('');
      nextSearchParams.delete('selected');
      shouldReplace = true;
    }

    if (shouldReplace) {
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, workItems]);

  const selectedWorkItem =
    workItems.find(item => item.id === selectedWorkItemId) || null;
  const selectedWorkflow = selectedWorkItem
    ? workflowsById.get(selectedWorkItem.workflowId) || null
    : null;
  const currentStep = selectedWorkflow?.steps.find(
    step => step.id === selectedWorkItem?.currentStepId,
  );
  const currentStepIndex = selectedWorkflow
    ? selectedWorkflow.steps.findIndex(step => step.id === selectedWorkItem?.currentStepId)
    : -1;
  const displayStep =
    currentStep ||
    (selectedWorkItem?.status === 'COMPLETED'
      ? selectedWorkflow?.steps[selectedWorkflow.steps.length - 1]
      : null) ||
    null;
  const displayStepIndex =
    displayStep && selectedWorkflow
      ? selectedWorkflow.steps.findIndex(step => step.id === displayStep.id)
      : -1;
  const nextStep =
    selectedWorkflow && currentStepIndex >= 0
      ? selectedWorkflow.steps[currentStepIndex + 1]
      : undefined;
  const displayAgent = displayStep
    ? agentsById.get(selectedWorkItem?.assignedAgentId || displayStep.agentId || '') || null
    : selectedWorkItem?.assignedAgentId
    ? agentsById.get(selectedWorkItem.assignedAgentId) || null
    : null;
  const workItemManagedTasks = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    const stepOrder = new Map<string, number>(
      (selectedWorkflow?.steps || []).map((step, index) => [step.id, index] as const),
    );

    return workspace.tasks
      .filter(task => task.workItemId === selectedWorkItem.id)
      .slice()
      .sort(
        (left, right) =>
          (stepOrder.get(left.workflowStepId || '') ?? Number.MAX_SAFE_INTEGER) -
          (stepOrder.get(right.workflowStepId || '') ?? Number.MAX_SAFE_INTEGER),
      );
  }, [selectedWorkItem, selectedWorkflow, workspace.tasks]);
  const selectedManagedTask =
    workItemManagedTasks.find(
      task => task.workflowStepId === (selectedWorkItem?.currentStepId || displayStep?.id),
    ) ||
    workItemManagedTasks[workItemManagedTasks.length - 1] ||
    null;
  const selectedExecutionLogs = useMemo(() => {
    if (!selectedWorkItem) {
      return [];
    }

    const relatedIds = new Set<string>([
      selectedWorkItem.id,
      ...workItemManagedTasks.map(task => task.id),
    ]);

    return workspace.executionLogs
      .filter(log => relatedIds.has(log.taskId))
      .slice()
      .sort(
        (left, right) =>
          new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
      );
  }, [selectedWorkItem, workItemManagedTasks, workspace.executionLogs]);
  const workItemArtifactView = useMemo(() => {
    const linked: Array<{
      key: string;
      name: string;
      size: string;
      type: 'table' | 'scale' | 'file';
      stepName: string;
    }> = [];
    const outputs: Array<{
      key: string;
      name: string;
      status: 'completed' | 'pending';
      stepName: string;
      downloadUrl?: string;
    }> = [];

    workItemManagedTasks.forEach(task => {
      const stepName =
        selectedWorkflow?.steps.find(step => step.id === task.workflowStepId)?.name ||
        task.title;

      task.linkedArtifacts?.forEach((artifact, index) => {
        linked.push({
          ...artifact,
          key: `${task.id}-linked-${index}-${artifact.name}`,
          stepName,
        });
      });

      task.producedOutputs?.forEach((output, index) => {
        outputs.push({
          ...output,
          key: `${task.id}-output-${index}-${output.name}`,
          stepName,
        });
      });
    });

    return { linked, outputs };
  }, [selectedWorkflow, workItemManagedTasks]);
  const executionSummary = useMemo(() => {
    if (!selectedWorkItem) {
      return null;
    }

    const latestSummaryLog = selectedExecutionLogs
      .slice()
      .reverse()
      .find(log => typeof log.metadata?.outputSummary === 'string');
    const latestCompletionHistory = selectedWorkItem.history
      .slice()
      .reverse()
      .find(entry => entry.action === 'Execution completed' || entry.action === 'Story completed');
    const completedSteps = workItemManagedTasks.filter(
      task => task.status === 'COMPLETED',
    ).length;
    const totalSteps = selectedWorkflow?.steps.length || workItemManagedTasks.length;
    const totalTokens = selectedExecutionLogs.reduce((sum, log) => {
      const tokens = log.metadata?.totalTokens;
      return typeof tokens === 'number' ? sum + tokens : sum;
    }, 0);
    const estimatedCostUsd = selectedExecutionLogs.reduce((sum, log) => {
      const cost = log.metadata?.estimatedCostUsd;
      return typeof cost === 'number' ? sum + cost : sum;
    }, 0);

    return {
      title:
        (typeof latestSummaryLog?.metadata?.outputTitle === 'string' &&
          latestSummaryLog.metadata.outputTitle) ||
        (selectedWorkItem.status === 'COMPLETED'
          ? 'Workflow Completed'
          : displayStep?.name || 'Execution Summary'),
      summary:
        (typeof latestSummaryLog?.metadata?.outputSummary === 'string' &&
          latestSummaryLog.metadata.outputSummary) ||
        latestCompletionHistory?.detail ||
        'No execution summary is available yet.',
      timestamp: latestSummaryLog?.timestamp || latestCompletionHistory?.timestamp,
      model:
        typeof latestSummaryLog?.metadata?.model === 'string'
          ? latestSummaryLog.metadata.model
          : displayAgent?.model,
      completedSteps,
      totalSteps,
      totalTokens,
      estimatedCostUsd,
    };
  }, [
    displayAgent?.model,
    displayStep?.name,
    selectedExecutionLogs,
    selectedWorkItem,
    selectedWorkflow?.steps.length,
    workItemManagedTasks,
  ]);
  const canStartSelectedWorkItem =
    Boolean(selectedWorkItem && currentStep && selectedWorkItem.assignedAgentId) &&
    selectedWorkItem?.status !== 'BLOCKED' &&
    selectedWorkItem?.status !== 'COMPLETED' &&
    selectedWorkItem?.status !== 'PENDING_APPROVAL' &&
    selectedWorkItem?.pendingRequest?.type !== 'INPUT' &&
    selectedWorkItem?.pendingRequest?.type !== 'CONFLICT_RESOLUTION';

  const stats = useMemo(
    () => ({
      active: workItems.filter(item => item.status === 'ACTIVE').length,
      blocked: workItems.filter(item => item.status === 'BLOCKED').length,
      approvals: workItems.filter(item => item.status === 'PENDING_APPROVAL').length,
      completed: workItems.filter(item => item.status === 'COMPLETED').length,
    }),
    [workItems],
  );

  type ExecutionState = {
    workItems: typeof workItems;
    tasks: typeof workspace.tasks;
    executionLogs: typeof workspace.executionLogs;
    currentItem: WorkItem;
  };

  const persistExecutionState = (state: ExecutionState) => {
    setCapabilityWorkspaceContent(activeCapability.id, {
      workItems: state.workItems,
      tasks: state.tasks,
      executionLogs: state.executionLogs,
    });
    setSelectedWorkItemId(state.currentItem.id);
  };

  const applyExecutionStateTransition = ({
    state,
    previousItem,
    nextItem,
    logMessage,
    logAgentId,
    options,
  }: {
    state: ExecutionState;
    previousItem: WorkItem;
    nextItem: WorkItem;
    logMessage: string;
    logAgentId?: string;
    options?: {
      buildTasks?: (
        syncedTasks: typeof workspace.tasks,
        nextItem: WorkItem,
        currentItem: WorkItem,
      ) => typeof workspace.tasks;
      logLevel?: 'INFO' | 'WARN' | 'ERROR';
      logMetadata?: Record<string, unknown>;
    };
  }): ExecutionState => {
    const workflow = workflowsById.get(nextItem.workflowId);
    const syncedTasks = workflow
      ? syncWorkflowManagedTasksForWorkItem({
          allTasks: state.tasks,
          workItem: nextItem,
          workflow,
          artifacts: workspace.artifacts,
        })
      : state.tasks;
    const nextTasks = options?.buildTasks
      ? options.buildTasks(syncedTasks, nextItem, previousItem)
      : syncedTasks;

    return {
      workItems: state.workItems.map(item =>
        item.id === nextItem.id ? nextItem : item,
      ),
      tasks: nextTasks,
      executionLogs: [
        ...state.executionLogs,
        {
          id: createLogId(),
          taskId: nextItem.id,
          capabilityId: activeCapability.id,
          agentId:
            logAgentId ||
            nextItem.assignedAgentId ||
            nextItem.pendingRequest?.requestedBy ||
            activeCapability.specialAgentId ||
            workspace.agents[0]?.id ||
            'SYSTEM',
          timestamp: new Date().toISOString(),
          level: options?.logLevel || 'INFO',
          message: logMessage,
          metadata: {
            phase: nextItem.phase,
            status: nextItem.status,
            ...(options?.logMetadata || {}),
          },
        },
      ],
      currentItem: nextItem,
    };
  };

  const updateWorkItem = (
    workItemId: string,
    buildNextItem: (current: WorkItem) => WorkItem,
    logMessage: string,
    logAgentId?: string,
    options?: {
      buildTasks?: (
        syncedTasks: typeof workspace.tasks,
        nextItem: WorkItem,
        currentItem: WorkItem,
      ) => typeof workspace.tasks;
      logLevel?: 'INFO' | 'WARN' | 'ERROR';
      logMetadata?: Record<string, unknown>;
    },
  ) => {
    const currentItem = workItems.find(item => item.id === workItemId);
    if (!currentItem) {
      return;
    }

    const nextItem = buildNextItem(currentItem);
    persistExecutionState(
      applyExecutionStateTransition({
        state: {
          workItems,
          tasks: workspace.tasks,
          executionLogs: workspace.executionLogs,
          currentItem,
        },
        previousItem: currentItem,
        nextItem,
        logMessage,
        logAgentId,
        options,
      }),
    );
  };

  const handleCreateWorkItem = (event: React.FormEvent) => {
    event.preventDefault();

    const workflow = workflowsById.get(draftWorkItem.workflowId);
    if (!draftWorkItem.title.trim() || !workflow) {
      return;
    }

    const firstStep = workflow.steps[0];
    const nextWorkItem: WorkItem = {
      id: createWorkItemId(),
      title: draftWorkItem.title.trim(),
      description:
        draftWorkItem.description.trim() ||
        `Delivery story for ${activeCapability.name}.`,
      phase: firstStep?.phase || 'BACKLOG',
      capabilityId: activeCapability.id,
      workflowId: workflow.id,
      currentStepId: firstStep?.id,
      assignedAgentId: firstStep?.agentId,
      status: getStepStatus(firstStep),
      priority: draftWorkItem.priority,
      tags: draftWorkItem.tags
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean),
      pendingRequest: buildPendingRequest(firstStep),
      history: [
        createHistoryEntry(
          'System',
          'Story created',
          `Story entered ${firstStep?.name || 'Backlog'} in ${workflow.name}.`,
          firstStep?.phase || 'BACKLOG',
          getStepStatus(firstStep),
        ),
      ],
    };
    const nextTasks = syncWorkflowManagedTasksForWorkItem({
      allTasks: workspace.tasks,
      workItem: nextWorkItem,
      workflow,
      artifacts: workspace.artifacts,
    });

    setCapabilityWorkspaceContent(activeCapability.id, {
      workItems: [...workspace.workItems, nextWorkItem],
      tasks: nextTasks,
      executionLogs: [
        ...workspace.executionLogs,
        {
          id: createLogId(),
          taskId: nextWorkItem.id,
          capabilityId: activeCapability.id,
          agentId: firstStep?.agentId || workspace.agents[0]?.id || 'SYSTEM',
          timestamp: new Date().toISOString(),
          level: 'INFO',
          message: `Story created and entered ${firstStep?.name || 'Backlog'} in ${workflow.name}.`,
          metadata: {
            phase: nextWorkItem.phase,
            status: nextWorkItem.status,
          },
        },
        {
          id: createLogId(),
          taskId: nextWorkItem.id,
          capabilityId: activeCapability.id,
          agentId: firstStep?.agentId || workspace.agents[0]?.id || 'SYSTEM',
          timestamp: new Date().toISOString(),
          level: 'INFO',
          message: `Workflow generated ${workflow.steps.length} managed step tasks, including testing coverage, for ${nextWorkItem.title}.`,
          metadata: {
            phase: nextWorkItem.phase,
            status: nextWorkItem.status,
            generatedTaskCount: workflow.steps.length,
          },
        },
      ],
    });

    setSelectedWorkItemId(nextWorkItem.id);
    setActionNote('');
    setDraftWorkItem({
      title: '',
      description: '',
      workflowId: workspace.workflows[0]?.id || '',
      priority: 'Med',
      tags: '',
    });
    setIsCreateModalOpen(false);
  };

  const moveToNextStep = (item: WorkItem) => {
    if (item.status === 'COMPLETED') {
      return;
    }

    const workflow = workflowsById.get(item.workflowId);
    if (!workflow) {
      return;
    }

    const index = workflow.steps.findIndex(step => step.id === item.currentStepId);
    const upcomingStep = index >= 0 ? workflow.steps[index + 1] : workflow.steps[0];

    if (!upcomingStep) {
      updateWorkItem(
        item.id,
        current => ({
          ...current,
          phase: 'DONE',
          currentStepId: undefined,
          assignedAgentId: undefined,
          status: 'COMPLETED',
          pendingRequest: undefined,
          blocker: undefined,
          history: [
            ...current.history,
            createHistoryEntry(
              'System',
              'Story completed',
              actionNote.trim() || 'All SDLC steps were completed.',
              'DONE',
              'COMPLETED',
            ),
          ],
        }),
        `${item.title} completed and moved to Done.`,
      );
      setActionNote('');
      return;
    }

    const pendingRequest = buildPendingRequest(upcomingStep);
    updateWorkItem(
      item.id,
      current => ({
        ...current,
        phase: upcomingStep.phase,
        currentStepId: upcomingStep.id,
        assignedAgentId: upcomingStep.agentId,
        status: getStepStatus(upcomingStep),
        pendingRequest,
        blocker: undefined,
        history: [
          ...current.history,
          createHistoryEntry(
            'System',
            'Advanced workflow',
            actionNote.trim() ||
              `Moved into ${upcomingStep.name}.`,
            upcomingStep.phase,
            getStepStatus(upcomingStep),
          ),
        ],
      }),
      `${item.title} moved into ${upcomingStep.name}.`,
      upcomingStep.agentId,
    );
    setActionNote('');
  };

  const blockWorkItem = (
    item: WorkItem,
    type: 'CONFLICT_RESOLUTION' | 'HUMAN_INPUT',
  ) => {
    const message =
      actionNote.trim() ||
      (type === 'CONFLICT_RESOLUTION'
        ? 'Conflict resolution is required before this story can continue.'
        : 'Human input is required before this story can continue.');

    updateWorkItem(
      item.id,
      current => ({
        ...current,
        status: 'BLOCKED',
        pendingRequest: {
          type: type === 'CONFLICT_RESOLUTION' ? 'CONFLICT_RESOLUTION' : 'INPUT',
          message,
          requestedBy: current.assignedAgentId || 'SYSTEM',
          timestamp: new Date().toISOString(),
        },
        blocker: {
          type,
          message,
          requestedBy: current.assignedAgentId || 'SYSTEM',
          timestamp: new Date().toISOString(),
          status: 'OPEN',
        },
        history: [
          ...current.history,
          createHistoryEntry(
            'System',
            type === 'CONFLICT_RESOLUTION' ? 'Conflict raised' : 'Input requested',
            message,
            current.phase,
            'BLOCKED',
          ),
        ],
      }),
      `${item.title} is blocked: ${message}`,
    );
    setActionNote('');
  };

  const resolveBlocker = async (item: WorkItem) => {
    const workflow = workflowsById.get(item.workflowId);
    const fallbackStep = workflow?.steps.find(step => step.id === item.currentStepId);
    const nextStatus =
      fallbackStep?.stepType === 'HUMAN_APPROVAL' ? 'PENDING_APPROVAL' : 'ACTIVE';

    const nextItem: WorkItem = {
      ...item,
      status: nextStatus,
      pendingRequest:
        nextStatus === 'PENDING_APPROVAL' ? buildPendingRequest(fallbackStep) : undefined,
      blocker: item.blocker
        ? {
            ...item.blocker,
            status: 'RESOLVED',
            resolution: actionNote.trim() || 'Blocker resolved and story re-activated.',
          }
        : undefined,
      history: [
        ...item.history,
        createHistoryEntry(
          'User',
          'Blocker resolved',
          actionNote.trim() || 'Blocker resolved and story can continue.',
          item.phase,
          nextStatus,
        ),
      ],
    };
    const state = applyExecutionStateTransition({
      state: {
        workItems,
        tasks: workspace.tasks,
        executionLogs: workspace.executionLogs,
        currentItem: item,
      },
      previousItem: item,
      nextItem,
      logMessage: `${item.title} was unblocked.`,
    });
    setActionNote('');

    if (nextItem.status === 'ACTIVE' && runtimeStatus?.configured) {
      setRuntimeError('');
      setIsExecutingWorkItemId(item.id);
      try {
        await runAutomatedWorkflow(nextItem, state);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'The backend runtime could not complete this work item.';
        setRuntimeError(errorMessage);
      } finally {
        setIsExecutingWorkItemId(null);
      }
      return;
    }

    persistExecutionState(state);
  };

  const runAutomatedWorkflow = async (
    startingItem: WorkItem,
    initialState?: ExecutionState,
  ) => {
    if (!runtimeStatus?.configured) {
      setRuntimeError(
        'The backend runtime is not configured yet. Add GITHUB_MODELS_TOKEN to .env.local and restart npm run dev.',
      );
      return;
    }

    let state: ExecutionState =
      initialState || {
        workItems,
        tasks: workspace.tasks,
        executionLogs: workspace.executionLogs,
        currentItem: startingItem,
      };
    let currentItem = state.currentItem;
    let safetyCounter = 0;

    while (safetyCounter < 20) {
      safetyCounter += 1;

      const workflow = workflowsById.get(currentItem.workflowId);
      const step = workflow?.steps.find(candidate => candidate.id === currentItem.currentStepId);
      const agent = agentsById.get(currentItem.assignedAgentId || '');

      if (!workflow || !step || !agent) {
        throw new Error(
          'The current work item is missing workflow, step, or agent context, so execution could not continue.',
        );
      }

      if (
        currentItem.status === 'COMPLETED' ||
        currentItem.status === 'BLOCKED' ||
        currentItem.blocker?.status === 'OPEN'
      ) {
        break;
      }

      if (
        currentItem.pendingRequest?.type === 'INPUT' ||
        currentItem.pendingRequest?.type === 'CONFLICT_RESOLUTION' ||
        step.stepType === 'HUMAN_APPROVAL'
      ) {
        break;
      }

      const currentTask = state.tasks.find(
        task =>
          task.workItemId === currentItem.id &&
          task.workflowStepId === currentItem.currentStepId,
      );
      const handoffProtocol = workflow.handoffProtocols?.find(
        protocol =>
          protocol.id === step.handoffProtocolId || protocol.sourceStepId === step.id,
      );
      const inputArtifact = workspace.artifacts.find(
        artifact => artifact.id === step.inputArtifactId,
      );
      const outputArtifact = workspace.artifacts.find(
        artifact => artifact.id === step.outputArtifactId,
      );
      let result;
      try {
        result = await sendCapabilityChat({
          capability: activeCapability,
          agent,
          history: currentItem.history.slice(-6).map((entry, index) => ({
            id: `${currentItem.id}-H-${index}`,
            capabilityId: activeCapability.id,
            role: 'user',
            content: `${entry.action}: ${entry.detail}`,
            timestamp: entry.timestamp,
          })),
          message: buildExecutionPrompt({
            item: currentItem,
            workflowName: workflow.name,
            step,
            agentName: agent.name,
            taskPrompt: currentTask?.prompt,
            protocolName: handoffProtocol?.name,
            protocolRules: handoffProtocol?.rules,
            inputArtifactLabel: inputArtifact
              ? `${inputArtifact.name} (${inputArtifact.type})`
              : undefined,
            outputArtifactLabel: outputArtifact
              ? `${outputArtifact.name} (${outputArtifact.type})`
              : undefined,
          }),
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'The backend runtime could not complete this work item.';

        state = applyExecutionStateTransition({
          state,
          previousItem: currentItem,
          nextItem: {
            ...currentItem,
            history: [
              ...currentItem.history,
              createHistoryEntry(
                'System',
                'Execution failed',
                errorMessage,
                currentItem.phase,
                currentItem.status,
              ),
            ],
          },
          logMessage: `${currentItem.title} execution failed: ${errorMessage}`,
          logAgentId: agent.id,
          options: {
            buildTasks: syncedTasks =>
              syncedTasks.map(task =>
                task.workItemId === currentItem.id &&
                task.workflowStepId === step.id
                  ? {
                      ...task,
                      status: 'ALERT',
                      timestamp: formatTaskTimestamp(),
                      executionNotes: `${task.executionNotes || ''}\nLast execution failed: ${errorMessage}`.trim(),
                    }
                  : task,
              ),
            logLevel: 'ERROR',
            logMetadata: {
              requestType: 'WORK_ITEM_EXECUTION',
              stepId: step.id,
              stepName: step.name,
              errorMessage,
            },
          },
        });
        persistExecutionState(state);
        throw error;
      }

      const executionSummary = summarizeOutput(result.content);
      const currentStepIndex = workflow.steps.findIndex(
        candidate => candidate.id === step.id,
      );
      const upcomingStep = workflow.steps[currentStepIndex + 1];
      const nextStatus = upcomingStep ? getStepStatus(upcomingStep) : 'COMPLETED';
      const nextPhase = upcomingStep?.phase || 'DONE';
      const nextItem: WorkItem = {
        ...currentItem,
        phase: nextPhase,
        currentStepId: upcomingStep?.id,
        assignedAgentId: upcomingStep?.agentId,
        status: nextStatus,
        pendingRequest: buildPendingRequest(upcomingStep),
        blocker: undefined,
        history: [
          ...currentItem.history,
          createHistoryEntry(
            agent.name,
            'Execution completed',
            upcomingStep
              ? `${step.name} completed. ${executionSummary}`
              : `Final workflow step completed. ${executionSummary}`,
            nextPhase,
            nextStatus,
          ),
        ],
      };

      state = applyExecutionStateTransition({
        state,
        previousItem: currentItem,
        nextItem,
        logMessage: upcomingStep
          ? `${currentItem.title} executed in ${step.name} and advanced to ${upcomingStep.name}. Result: ${executionSummary}`
          : `${currentItem.title} executed in ${step.name} and completed the workflow. Result: ${executionSummary}`,
        logAgentId: agent.id,
        options: {
          buildTasks: syncedTasks =>
            syncedTasks.map(task => {
              if (
                task.workItemId !== currentItem.id ||
                task.workflowStepId !== step.id
              ) {
                return task;
              }

              const existingOutputs = task.producedOutputs || [];
              const nextOutputs =
                existingOutputs.length > 0
                  ? existingOutputs.map(output => ({
                      ...output,
                      status: 'completed' as const,
                    }))
                  : [
                      {
                        name: outputArtifact?.name || `${step.name} Execution Result`,
                        status: 'completed' as const,
                      },
                    ];

              return {
                ...task,
                status: 'COMPLETED',
                timestamp: formatTaskTimestamp(),
                executionNotes: `${task.executionNotes || ''}\nLatest run summary: ${executionSummary}`.trim(),
                producedOutputs: nextOutputs,
              };
            }),
          logMetadata: {
            requestType: 'WORK_ITEM_EXECUTION',
            stepId: step.id,
            stepName: step.name,
            model: result.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
            estimatedCostUsd: result.usage.estimatedCostUsd,
            outputTitle: outputArtifact?.name || `${step.name} Execution Result`,
            outputSummary: executionSummary,
            outputStatus: 'completed',
            rawResponsePreview: executionSummary,
          },
        },
      });

      currentItem = state.currentItem;
      persistExecutionState(state);

      if (
        currentItem.status === 'COMPLETED' ||
        currentItem.status === 'PENDING_APPROVAL' ||
        currentItem.pendingRequest?.type === 'INPUT' ||
        currentItem.pendingRequest?.type === 'CONFLICT_RESOLUTION' ||
        currentItem.blocker?.status === 'OPEN'
      ) {
        break;
      }
    }

    persistExecutionState(state);
  };

  const approveAndProceed = async (item: WorkItem) => {
    const workflow = workflowsById.get(item.workflowId);
    if (!workflow) {
      return;
    }

    const index = workflow.steps.findIndex(step => step.id === item.currentStepId);
    const upcomingStep = index >= 0 ? workflow.steps[index + 1] : workflow.steps[0];

    if (!upcomingStep) {
      moveToNextStep(item);
      return;
    }

    const nextItem: WorkItem = {
      ...item,
      phase: upcomingStep.phase,
      currentStepId: upcomingStep.id,
      assignedAgentId: upcomingStep.agentId,
      status: getStepStatus(upcomingStep),
      pendingRequest: buildPendingRequest(upcomingStep),
      blocker: undefined,
      history: [
        ...item.history,
        createHistoryEntry(
          'User',
          'Approval granted',
          actionNote.trim() || `Approval granted. Moving into ${upcomingStep.name}.`,
          upcomingStep.phase,
          getStepStatus(upcomingStep),
        ),
      ],
    };
    const state = applyExecutionStateTransition({
      state: {
        workItems,
        tasks: workspace.tasks,
        executionLogs: workspace.executionLogs,
        currentItem: item,
      },
      previousItem: item,
      nextItem,
      logMessage: `${item.title} approved and moved into ${upcomingStep.name}.`,
      logAgentId: upcomingStep.agentId,
    });

    setActionNote('');

    if (nextItem.status === 'ACTIVE' && runtimeStatus?.configured) {
      setRuntimeError('');
      setIsExecutingWorkItemId(item.id);
      try {
        await runAutomatedWorkflow(nextItem, state);
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'The backend runtime could not complete this work item.';
        setRuntimeError(errorMessage);
      } finally {
        setIsExecutingWorkItemId(null);
      }
      return;
    }

    persistExecutionState(state);
  };

  const handleStartExecution = async (item: WorkItem) => {
    if (!runtimeStatus?.configured) {
      setRuntimeError(
        'The backend runtime is not configured yet. Add GITHUB_MODELS_TOKEN to .env.local and restart npm run dev.',
      );
      return;
    }

    setRuntimeError('');
    setActionNote('');
    setIsExecutingWorkItemId(item.id);

    try {
      await runAutomatedWorkflow(item);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'The backend runtime could not complete this work item.';

      setRuntimeError(errorMessage);
    } finally {
      setIsExecutingWorkItemId(null);
    }
  };

  const moveWorkItemToPhase = (item: WorkItem, targetPhase: WorkItemPhase) => {
    if (item.phase === targetPhase) {
      return;
    }

    const workflow = workflowsById.get(item.workflowId);
    if (!workflow) {
      return;
    }

    const targetStep = resolveStepForPhase(workflow, targetPhase, item.currentStepId);
    if (!targetStep && targetPhase !== 'BACKLOG' && targetPhase !== 'DONE') {
      return;
    }

    const currentPhaseOrder = getPhaseOrder(item.phase);
    const targetPhaseOrder = getPhaseOrder(targetPhase);
    const movingBackward = targetPhaseOrder < currentPhaseOrder;
    const movingToDone = targetPhase === 'DONE';
    const movingToBacklog = targetPhase === 'BACKLOG';
    const nextStatus = movingToDone
      ? 'COMPLETED'
      : movingToBacklog
      ? 'ACTIVE'
      : getStepStatus(targetStep);
    const nextPendingRequest =
      movingToDone || movingToBacklog ? undefined : buildPendingRequest(targetStep);
    const historyDetail =
      actionNote.trim() ||
      (movingBackward
        ? `Story was moved back to ${PHASE_META[targetPhase].label} and restarted from that stage.`
        : movingToDone
        ? 'Story was marked done from the delivery board.'
        : `Story was moved to ${PHASE_META[targetPhase].label} from the delivery board.`);

    updateWorkItem(
      item.id,
      current => ({
        ...current,
        phase: targetPhase,
        currentStepId: movingToDone || movingToBacklog ? undefined : targetStep?.id,
        assignedAgentId: movingToDone || movingToBacklog ? undefined : targetStep?.agentId,
        status: nextStatus,
        pendingRequest: nextPendingRequest,
        blocker: undefined,
        history: [
          ...current.history,
          createHistoryEntry(
            'User',
            movingBackward ? 'Restarted from board move' : 'Board stage updated',
            historyDetail,
            targetPhase,
            nextStatus,
          ),
        ],
      }),
      movingBackward
        ? `${item.title} restarted in ${PHASE_META[targetPhase].label}.`
        : movingToDone
        ? `${item.title} marked done from the board.`
        : `${item.title} moved to ${PHASE_META[targetPhase].label}.`,
      targetStep?.agentId,
    );
    setActionNote('');
  };

  const resetDragState = () => {
    setDraggedWorkItemId(null);
    setDragOverPhase(null);
  };

  const handleDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    workItemId: string,
  ) => {
    setDraggedWorkItemId(workItemId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', workItemId);
  };

  const handleDropOnPhase = (
    event: React.DragEvent<HTMLDivElement>,
    phase: WorkItemPhase,
  ) => {
    event.preventDefault();
    const workItemId =
      event.dataTransfer.getData('text/plain') || draggedWorkItemId || '';
    const item = workItems.find(candidate => candidate.id === workItemId);

    if (item) {
      moveWorkItemToPhase(item, phase);
      if (!selectedWorkItemId || selectedWorkItemId === item.id) {
        setSelectedWorkItemId(item.id);
      }
    }

    resetDragState();
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[0.625rem] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">
              Jira Style Delivery Board
            </span>
            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">
              {activeCapability.id}
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-primary">
            {activeCapability.name} SDLC Flow
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-secondary">
            Stories automatically enter the SDLC workflow, move across board phases,
            and stop on governance or human approval gates until someone unblocks or approves them.
            Drag a card to any phase to restart it from that stage or fast-forward it with a board move.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-2xl border border-outline-variant/15 bg-white p-1 shadow-sm">
            <button
              onClick={() => setView('board')}
              className={cn(
                'rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] transition-all',
                view === 'board'
                  ? 'bg-primary text-white'
                  : 'text-secondary hover:bg-surface-container-low',
              )}
            >
              <span className="inline-flex items-center gap-2">
                <Trello size={14} />
                Board
              </span>
            </button>
            <button
              onClick={() => setView('list')}
              className={cn(
                'rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] transition-all',
                view === 'list'
                  ? 'bg-primary text-white'
                  : 'text-secondary hover:bg-surface-container-low',
              )}
            >
              <span className="inline-flex items-center gap-2">
                <LayoutGrid size={14} />
                List
              </span>
            </button>
          </div>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
          >
            <Plus size={18} />
            New Story
          </button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Active', value: stats.active },
          { label: 'Blocked', value: stats.blocked },
          { label: 'Pending Approval', value: stats.approvals },
          { label: 'Completed', value: stats.completed },
        ].map(card => (
          <div key={card.label} className="rounded-3xl border border-outline-variant/15 bg-white p-5 shadow-sm">
            <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">{card.label}</p>
            <p className="mt-3 text-3xl font-extrabold text-primary">{card.value}</p>
          </div>
        ))}
      </section>

      {view === 'board' ? (
        <div className="overflow-x-auto pb-4">
          <div className="flex min-w-max gap-5">
            {SDLC_BOARD_PHASES.map(phase => (
              <section key={phase} className="w-[320px] shrink-0">
                <div className="mb-3 flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em]',
                        PHASE_META[phase].accent,
                      )}
                    >
                      {PHASE_META[phase].label}
                    </span>
                    <span className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-secondary">
                      {workItems.filter(item => item.phase === phase).length}
                    </span>
                  </div>
                </div>

                <div
                  onDragOver={event => {
                    event.preventDefault();
                    if (draggedWorkItemId) {
                      setDragOverPhase(phase);
                    }
                  }}
                  onDragEnter={event => {
                    event.preventDefault();
                    if (draggedWorkItemId) {
                      setDragOverPhase(phase);
                    }
                  }}
                  onDragLeave={event => {
                    const nextTarget = event.relatedTarget;
                    if (
                      dragOverPhase === phase &&
                      (!nextTarget || !event.currentTarget.contains(nextTarget as Node))
                    ) {
                      setDragOverPhase(null);
                    }
                  }}
                  onDrop={event => handleDropOnPhase(event, phase)}
                  className={cn(
                    'relative flex min-h-[420px] flex-col gap-3 rounded-[2rem] border p-3 transition-all',
                    dragOverPhase === phase && draggedWorkItemId
                      ? 'border-primary/30 bg-primary/5 shadow-inner'
                      : 'border-outline-variant/10 bg-surface-container-low/40',
                  )}
                >
                  {dragOverPhase === phase && draggedWorkItemId && (
                    <div className="pointer-events-none absolute inset-x-4 top-4 rounded-2xl border border-dashed border-primary/30 bg-white/85 px-4 py-3 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary shadow-sm">
                      Drop here to move the story to {PHASE_META[phase].label}
                    </div>
                  )}
                  {workItems
                    .filter(item => item.phase === phase)
                    .map(item => {
                      const workflow = workflowsById.get(item.workflowId);
                      const step = workflow?.steps.find(
                        candidate => candidate.id === item.currentStepId,
                      );
                      const agentName =
                        agentsById.get(item.assignedAgentId || '')?.name || 'Unassigned';
                      return (
                        <WorkItemCard
                          key={item.id}
                          item={item}
                          stepName={step?.name || 'Awaiting workflow step'}
                          agentName={agentName}
                          onDragStart={handleDragStart}
                          onDragEnd={resetDragState}
                          isDragging={draggedWorkItemId === item.id}
                          onClick={id => {
                            setSelectedWorkItemId(id);
                            setActionNote('');
                          }}
                        />
                      );
                    })}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <section className="rounded-[2rem] border border-outline-variant/15 bg-white shadow-sm">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_0.8fr] gap-4 border-b border-outline-variant/10 px-6 py-4 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
            <span>Story</span>
            <span>Current Step</span>
            <span>Assigned Agent</span>
            <span>Status</span>
          </div>
          <div className="divide-y divide-outline-variant/10">
            {workItems.length > 0 ? (
              workItems.map(item => {
                const workflow = workflowsById.get(item.workflowId);
                const step = workflow?.steps.find(candidate => candidate.id === item.currentStepId);
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedWorkItemId(item.id);
                      setActionNote('');
                    }}
                    className="grid w-full grid-cols-[1.4fr_1fr_1fr_0.8fr] gap-4 px-6 py-5 text-left transition-all hover:bg-surface-container-low/50"
                  >
                    <div>
                      <p className="text-sm font-bold text-on-surface">{item.title}</p>
                      <p className="mt-1 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-outline">
                        {item.id} • {PHASE_META[item.phase].label}
                      </p>
                    </div>
                    <p className="text-sm text-secondary">{step?.name || 'Awaiting step'}</p>
                    <p className="text-sm text-secondary">
                      {agentsById.get(item.assignedAgentId || '')?.name || 'Unassigned'}
                    </p>
                    <span
                      className={cn(
                        'w-fit rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em]',
                        STATUS_META[item.status].accent,
                      )}
                    >
                      {STATUS_META[item.status].label}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="px-6 py-20 text-center">
                <WorkflowIcon size={40} className="mx-auto text-outline" />
                <h3 className="mt-4 text-xl font-bold text-primary">No stories yet</h3>
                <p className="mt-2 text-sm text-secondary">
                  Create a story and it will enter the SDLC board automatically.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <AnimatePresence>
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCreateModalOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-md"
            />
            <motion.form
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              onSubmit={handleCreateWorkItem}
              className="relative w-full max-w-2xl rounded-[2rem] border border-outline-variant/15 bg-white p-8 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.2em] text-primary">New Story</p>
                  <h3 className="mt-2 text-2xl font-extrabold text-primary">Launch work into the SDLC flow</h3>
                  <p className="mt-2 text-sm text-secondary">
                    Every story enters the selected workflow and moves through hand-offs, governance gates, and human approvals on the board.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="rounded-full p-2 text-slate-400 transition-colors hover:bg-surface-container-low hover:text-primary"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mt-8 grid gap-5 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Story Title</span>
                  <input
                    required
                    value={draftWorkItem.title}
                    onChange={event =>
                      setDraftWorkItem(prev => ({ ...prev, title: event.target.value }))
                    }
                    placeholder="e.g. Calculator division edge-case support"
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Description</span>
                  <textarea
                    value={draftWorkItem.description}
                    onChange={event =>
                      setDraftWorkItem(prev => ({ ...prev, description: event.target.value }))
                    }
                    placeholder="Describe the delivery outcome, expected behavior, or release objective."
                    className="h-28 w-full resize-none rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Workflow</span>
                  <select
                    value={draftWorkItem.workflowId}
                    onChange={event =>
                      setDraftWorkItem(prev => ({ ...prev, workflowId: event.target.value }))
                    }
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    {workspace.workflows.map(workflow => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Priority</span>
                  <select
                    value={draftWorkItem.priority}
                    onChange={event =>
                      setDraftWorkItem(prev => ({
                        ...prev,
                        priority: event.target.value as WorkItem['priority'],
                      }))
                    }
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="High">High</option>
                    <option value="Med">Med</option>
                    <option value="Low">Low</option>
                  </select>
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Tags</span>
                  <input
                    value={draftWorkItem.tags}
                    onChange={event =>
                      setDraftWorkItem(prev => ({ ...prev, tags: event.target.value }))
                    }
                    placeholder="calculator, release, approval"
                    className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </label>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 rounded-2xl border border-outline-variant/20 px-5 py-3 text-sm font-bold text-secondary transition-all hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
                >
                  Create Story
                </button>
              </div>
            </motion.form>
          </div>
        )}

        {selectedWorkItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-end p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedWorkItemId(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 24, stiffness: 220 }}
              className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-l-[2.5rem] border-l border-outline-variant/10 bg-white shadow-2xl"
            >
              <div className="border-b border-outline-variant/10 p-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        {selectedWorkItem.id}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em]',
                          PHASE_META[selectedWorkItem.phase].accent,
                        )}
                      >
                        {PHASE_META[selectedWorkItem.phase].label}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em]',
                          STATUS_META[selectedWorkItem.status].accent,
                        )}
                      >
                        {STATUS_META[selectedWorkItem.status].label}
                      </span>
                    </div>
                    <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-on-surface">
                      {selectedWorkItem.title}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-secondary">
                      {selectedWorkItem.description}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedWorkItemId(null)}
                    className="rounded-full p-2 text-slate-400 transition-colors hover:bg-surface-container-low hover:text-primary"
                  >
                    <X size={22} />
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-8 overflow-y-auto p-8">
                <section className="rounded-[2rem] border border-outline-variant/15 bg-surface-container-low/40 p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                        Current Step
                      </p>
                      <h3 className="mt-2 text-lg font-extrabold text-primary">
                        {displayStep?.name ||
                          (selectedWorkItem.status === 'COMPLETED'
                            ? 'Workflow Completed'
                            : 'No active step')}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-secondary">
                        {selectedWorkItem.status === 'COMPLETED'
                          ? 'This story completed the workflow. The final executed step, generated outputs, and full run evidence are shown below.'
                          : displayStep?.description ||
                            'This story has not entered a workflow step yet.'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 text-right shadow-sm">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Assigned</p>
                      <p className="mt-2 text-sm font-bold text-on-surface">
                        {displayAgent?.name ||
                          (selectedWorkItem.status === 'COMPLETED'
                            ? 'Workflow finished'
                            : 'Unassigned')}
                      </p>
                    </div>
                  </div>

                  {displayStep && (
                    <div className="mt-6 grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl bg-white p-4 shadow-sm">
                        <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Action</p>
                        <p className="mt-2 text-sm text-on-surface">{displayStep.action}</p>
                      </div>
                      <div className="rounded-2xl bg-white p-4 shadow-sm">
                        <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Handoff</p>
                        <p className="mt-2 text-sm text-on-surface">
                          {displayStep.handoffLabel || 'No explicit hand-off configured.'}
                        </p>
                        {displayStep.handoffToAgentId && (
                          <p className="mt-2 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-secondary">
                            Next: {agentsById.get(displayStep.handoffToAgentId)?.name || displayStep.handoffToAgentId}
                            {displayStep.handoffToPhase ? ` • ${PHASE_META[displayStep.handoffToPhase].label}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Execution Runtime
                      </p>
                      <p className="mt-2 text-sm font-bold text-on-surface">
                        {runtimeStatus?.configured
                          ? 'GitHub Copilot runtime ready'
                          : 'Runtime not configured'}
                      </p>
                      <p className="mt-1 text-[0.75rem] leading-relaxed text-secondary">
                        {runtimeStatus?.configured
                          ? `${displayAgent?.model || 'Configured model'} ${
                              selectedWorkItem.status === 'COMPLETED'
                                ? 'was used for the latest completed step through the Express API.'
                                : 'will run the current step through the Express API.'
                            }`
                          : 'Add GITHUB_MODELS_TOKEN to .env.local and restart npm run dev before starting execution.'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Workflow Task
                      </p>
                      <p className="mt-2 text-sm font-bold text-on-surface">
                        {selectedManagedTask?.title || 'No workflow task linked yet'}
                      </p>
                      <p className="mt-1 text-[0.75rem] leading-relaxed text-secondary">
                        {selectedManagedTask
                          ? `${selectedManagedTask.taskType || 'DELIVERY'} task • ${selectedManagedTask.status}`
                          : 'This story will create and update workflow-managed tasks as execution moves through the SDLC phases.'}
                      </p>
                    </div>
                  </div>

                  {displayStep?.exitCriteria?.length ? (
                    <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Exit Criteria</p>
                      <div className="mt-3 space-y-2">
                        {displayStep.exitCriteria.map(item => (
                          <div key={item} className="flex items-start gap-2 text-sm text-secondary">
                            <CheckCircle2 size={14} className="mt-0.5 text-primary" />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                      {displayStep.templatePath && (
                        <p className="mt-4 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-outline">
                          Template: {displayStep.templatePath}
                        </p>
                      )}
                    </div>
                  ) : null}
                </section>

                {executionSummary && (
                  <section className="rounded-[2rem] border border-outline-variant/15 bg-white p-6 shadow-sm">
                    <div className="flex items-center gap-3">
                      <Sparkles size={18} className="text-primary" />
                      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Execution Summary
                      </p>
                    </div>
                    <div className="mt-5 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                      <div className="rounded-2xl bg-surface-container-low p-5">
                        <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                          {executionSummary.title}
                        </p>
                        <p className="mt-3 text-sm leading-relaxed text-on-surface">
                          {executionSummary.summary}
                        </p>
                        {executionSummary.timestamp ? (
                          <p className="mt-4 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-outline">
                            Updated {formatTimestamp(executionSummary.timestamp)}
                          </p>
                        ) : null}
                      </div>
                      <div className="grid gap-3">
                        <div className="rounded-2xl bg-surface-container-low px-4 py-4">
                          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Workflow Progress</p>
                          <p className="mt-2 text-lg font-extrabold text-primary">
                            {executionSummary.completedSteps}/{executionSummary.totalSteps} steps completed
                          </p>
                        </div>
                        <div className="rounded-2xl bg-surface-container-low px-4 py-4">
                          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Runtime Usage</p>
                          <p className="mt-2 text-sm font-bold text-on-surface">
                            {executionSummary.totalTokens > 0
                              ? `${executionSummary.totalTokens.toLocaleString()} tokens`
                              : 'No token usage recorded yet'}
                          </p>
                          <p className="mt-1 text-[0.75rem] text-secondary">
                            {executionSummary.model
                              ? `${executionSummary.model} • $${executionSummary.estimatedCostUsd.toFixed(4)} estimated`
                              : `$${executionSummary.estimatedCostUsd.toFixed(4)} estimated`}
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                <section className="rounded-[2rem] border border-outline-variant/15 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <WorkflowIcon size={18} className="text-primary" />
                    <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Artifacts & Outputs
                    </p>
                  </div>
                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <div className="space-y-3">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Linked Artifacts
                      </p>
                      {workItemArtifactView.linked.length > 0 ? (
                        workItemArtifactView.linked.map(artifact => (
                          <div key={artifact.key} className="rounded-2xl bg-surface-container-low p-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-bold text-on-surface">{artifact.name}</p>
                              <span className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-outline">
                                {artifact.type}
                              </span>
                            </div>
                            <p className="mt-2 text-[0.75rem] text-secondary">
                              {artifact.stepName} • {artifact.size}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-2xl bg-surface-container-low p-4 text-sm text-secondary">
                          No linked artifacts were recorded for this story yet.
                        </p>
                      )}
                    </div>
                    <div className="space-y-3">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Produced Outputs
                      </p>
                      {workItemArtifactView.outputs.length > 0 ? (
                        workItemArtifactView.outputs.map(output => (
                          <div key={output.key} className="rounded-2xl bg-surface-container-low p-4">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-bold text-on-surface">{output.name}</p>
                              <span
                                className={cn(
                                  'rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em]',
                                  output.status === 'completed'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-slate-100 text-slate-700',
                                )}
                              >
                                {output.status}
                              </span>
                            </div>
                            <p className="mt-2 text-[0.75rem] text-secondary">
                              {output.stepName}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-2xl bg-surface-container-low p-4 text-sm text-secondary">
                          No produced outputs were recorded for this story yet.
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="rounded-[2rem] border border-outline-variant/15 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Clock size={18} className="text-primary" />
                    <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Workflow Step Evidence
                    </p>
                  </div>
                  <div className="mt-5 space-y-3">
                    {workItemManagedTasks.length > 0 ? (
                      workItemManagedTasks.map(task => {
                        const stepName =
                          selectedWorkflow?.steps.find(step => step.id === task.workflowStepId)
                            ?.name || task.title;

                        return (
                          <div key={task.id} className="rounded-2xl bg-surface-container-low p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-on-surface">{stepName}</p>
                                <p className="mt-1 text-[0.75rem] text-secondary">
                                  {task.taskType || 'DELIVERY'} • {task.phase || 'Workflow'}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  'rounded-full px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.16em]',
                                  task.status === 'COMPLETED'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : task.status === 'ALERT'
                                    ? 'bg-error/10 text-error'
                                    : task.status === 'PROCESSING'
                                    ? 'bg-primary/10 text-primary'
                                    : 'bg-slate-100 text-slate-700',
                                )}
                              >
                                {task.status}
                              </span>
                            </div>
                            <p className="mt-3 text-sm leading-relaxed text-secondary">
                              {task.executionNotes || 'No execution notes recorded for this step yet.'}
                            </p>
                          </div>
                        );
                      })
                    ) : (
                      <p className="rounded-2xl bg-surface-container-low p-4 text-sm text-secondary">
                        No workflow-managed step evidence is available for this story yet.
                      </p>
                    )}
                  </div>
                </section>

                {runtimeError && (
                  <section className="rounded-[2rem] border border-error/20 bg-error/5 p-6">
                    <div className="flex items-center gap-3 text-error">
                      <AlertCircle size={18} />
                      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em]">
                        Execution Error
                      </p>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-on-surface">
                      {runtimeError}
                    </p>
                  </section>
                )}

                {selectedWorkItem.pendingRequest && (
                  <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6">
                    <div className="flex items-center gap-3 text-amber-700">
                      <ShieldCheck size={18} />
                      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em]">
                        {selectedWorkItem.pendingRequest.type === 'APPROVAL'
                          ? 'Approval Required'
                          : selectedWorkItem.pendingRequest.type === 'CONFLICT_RESOLUTION'
                          ? 'Conflict Resolution Needed'
                          : 'Human Input Needed'}
                      </p>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-amber-900">
                      {selectedWorkItem.pendingRequest.message}
                    </p>
                    <p className="mt-3 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-amber-700">
                      Requested by {agentsById.get(selectedWorkItem.pendingRequest.requestedBy)?.name || selectedWorkItem.pendingRequest.requestedBy}
                    </p>
                  </section>
                )}

                {selectedWorkItem.blocker?.status === 'OPEN' && (
                  <section className="rounded-[2rem] border border-error/20 bg-error/5 p-6">
                    <div className="flex items-center gap-3 text-error">
                      <AlertCircle size={18} />
                      <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em]">
                        {selectedWorkItem.blocker.type === 'CONFLICT_RESOLUTION'
                          ? 'Conflict Resolution'
                          : 'Human Input Blocker'}
                      </p>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-on-surface">
                      {selectedWorkItem.blocker.message}
                    </p>
                  </section>
                )}

                <section className="rounded-[2rem] border border-outline-variant/15 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Sparkles size={18} className="text-primary" />
                    <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Story History
                    </p>
                  </div>
                  <div className="mt-5 space-y-4">
                    {selectedWorkItem.history.length > 0 ? (
                      selectedWorkItem.history
                        .slice()
                        .reverse()
                        .map(entry => (
                          <div key={entry.id} className="flex gap-4 rounded-2xl bg-surface-container-low p-4">
                            <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-primary" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-bold text-on-surface">{entry.action}</p>
                                <span className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-outline">
                                  {entry.actor}
                                </span>
                              </div>
                              <p className="mt-1 text-sm leading-relaxed text-secondary">{entry.detail}</p>
                              <p className="mt-2 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-outline">
                                {formatTimestamp(entry.timestamp)}
                              </p>
                            </div>
                          </div>
                        ))
                    ) : (
                      <p className="text-sm text-secondary">No story history yet.</p>
                    )}
                  </div>
                </section>

                <section className="rounded-[2rem] border border-outline-variant/15 bg-slate-950 p-6 text-slate-200 shadow-sm">
                  <div className="flex items-center gap-3">
                    <WorkflowIcon size={18} className="text-white" />
                    <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-slate-400">
                      Execution Logs
                    </p>
                  </div>
                  <div className="mt-5 space-y-3 font-mono text-[0.75rem]">
                    {selectedExecutionLogs.length > 0 ? (
                      selectedExecutionLogs.slice().reverse().map(log => (
                        <div key={log.id} className="rounded-2xl bg-slate-900/70 p-4">
                          <div className="flex gap-4">
                            <span className="shrink-0 text-slate-500">
                              [{formatTimestamp(log.timestamp)}]
                            </span>
                            <span className="text-slate-200">{log.message}</span>
                          </div>
                          {typeof log.metadata?.outputSummary === 'string' ? (
                            <p className="mt-3 text-[0.75rem] leading-relaxed text-slate-300">
                              Summary: {log.metadata.outputSummary}
                            </p>
                          ) : null}
                          {typeof log.metadata?.model === 'string' ||
                          typeof log.metadata?.totalTokens === 'number' ||
                          typeof log.metadata?.estimatedCostUsd === 'number' ? (
                            <p className="mt-3 text-[0.6875rem] uppercase tracking-[0.16em] text-slate-500">
                              {[
                                typeof log.metadata?.model === 'string'
                                  ? log.metadata.model
                                  : null,
                                typeof log.metadata?.totalTokens === 'number'
                                  ? `${log.metadata.totalTokens.toLocaleString()} tokens`
                                  : null,
                                typeof log.metadata?.estimatedCostUsd === 'number'
                                  ? `$${log.metadata.estimatedCostUsd.toFixed(4)} est.`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' • ')}
                            </p>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-500">No logs recorded for this story yet.</p>
                    )}
                  </div>
                </section>
              </div>

              <div className="border-t border-outline-variant/10 bg-white p-6">
                <label className="block">
                  <span className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Resolution or notes</span>
                  <textarea
                    value={actionNote}
                    onChange={event => setActionNote(event.target.value)}
                    placeholder="Add release notes, unblock comments, conflict resolution details, or approval context."
                    className="mt-3 h-24 w-full resize-none rounded-2xl border border-outline-variant/20 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </label>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <button
                    onClick={() => selectedWorkItem && handleStartExecution(selectedWorkItem)}
                    disabled={
                      !canStartSelectedWorkItem ||
                      !runtimeStatus?.configured ||
                      isExecutingWorkItemId === selectedWorkItem.id
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-primary transition-all hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isExecutingWorkItemId === selectedWorkItem.id ? (
                      <>
                        <LoaderCircle size={14} className="animate-spin" />
                        Running
                      </>
                    ) : selectedWorkItem.status === 'COMPLETED' ? (
                      <>
                        <CheckCircle2 size={14} />
                        Completed
                      </>
                    ) : selectedWorkItem.status === 'PENDING_APPROVAL' ? (
                      <>
                        <ShieldCheck size={14} />
                        Awaiting Approval
                      </>
                    ) : (
                      <>
                        <Sparkles size={14} />
                        Start Execution
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => selectedWorkItem && blockWorkItem(selectedWorkItem, 'CONFLICT_RESOLUTION')}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-outline-variant/20 px-4 py-3 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-secondary transition-all hover:border-primary/20 hover:bg-surface-container-low"
                  >
                    <AlertCircle size={14} />
                    Flag Conflict
                  </button>
                  <button
                    onClick={() => selectedWorkItem && blockWorkItem(selectedWorkItem, 'HUMAN_INPUT')}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-outline-variant/20 px-4 py-3 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-secondary transition-all hover:border-primary/20 hover:bg-surface-container-low"
                  >
                    <MessageSquare size={14} />
                    Need Input
                  </button>
                  <button
                    onClick={() => selectedWorkItem && resolveBlocker(selectedWorkItem)}
                    disabled={selectedWorkItem.blocker?.status !== 'OPEN'}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-outline-variant/20 px-4 py-3 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-secondary transition-all hover:border-primary/20 hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Wrench size={14} />
                    Unblock
                  </button>
                  <button
                    onClick={() =>
                      selectedWorkItem &&
                      (selectedWorkItem.status === 'PENDING_APPROVAL'
                        ? approveAndProceed(selectedWorkItem)
                        : moveToNextStep(selectedWorkItem))
                    }
                    disabled={
                      selectedWorkItem.status === 'BLOCKED' ||
                      selectedWorkItem.status === 'COMPLETED' ||
                      isExecutingWorkItemId === selectedWorkItem.id
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectedWorkItem.status === 'COMPLETED' ? (
                      <>
                        <CheckCircle2 size={14} />
                        Story Completed
                      </>
                    ) : selectedWorkItem.status === 'PENDING_APPROVAL' ? (
                      <>
                        <ShieldCheck size={14} />
                        Approve & Proceed
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        {nextStep ? 'Move Forward' : 'Complete Story'}
                      </>
                    )}
                  </button>
                </div>

                {selectedWorkflow?.steps?.length ? (
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    {selectedWorkflow.steps.map(step => {
                      const isCurrent =
                        selectedWorkItem.status !== 'COMPLETED' &&
                        step.id === selectedWorkItem.currentStepId;
                      const isComplete =
                        selectedWorkItem.status === 'COMPLETED' ||
                        selectedWorkflow.steps.findIndex(candidate => candidate.id === step.id) <
                          displayStepIndex;

                      return (
                        <div
                          key={step.id}
                          className={cn(
                            'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-[0.16em]',
                            isCurrent
                              ? 'bg-primary text-white'
                              : isComplete
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-surface-container-low text-secondary',
                          )}
                        >
                          <span>{step.name}</span>
                          {isCurrent ? <ChevronRight size={12} /> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Orchestrator;
