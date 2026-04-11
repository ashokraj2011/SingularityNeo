import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  Clock3,
  ExternalLink,
  LayoutGrid,
  List,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ArtifactPreview from '../components/ArtifactPreview';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { formatEnumLabel, getStatusTone } from '../lib/enterprise';
import { compactMarkdownPreview } from '../lib/markdown';
import { readViewPreference, writeViewPreference } from '../lib/viewPreferences';
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
import {
  getCapabilityBoardPhaseIds,
  getLifecyclePhaseLabel,
} from '../lib/capabilityLifecycle';
import { cn } from '../lib/utils';
import type {
  ContrarianConflictReview,
  RunEvent,
  RunWait,
  WorkItem,
  WorkItemPhase,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
} from '../types';
import { BoardColumn, EmptyState, StatusBadge } from '../components/EnterpriseUI';
import { AdvancedDisclosure } from '../components/WorkspaceUI';

const PHASE_ACCENTS = [
  'bg-sky-100 text-sky-700',
  'bg-indigo-100 text-indigo-700',
  'bg-primary/10 text-primary',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-cyan-100 text-cyan-700',
  'bg-orange-100 text-orange-700',
] as const;

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

type OrchestratorView = 'board' | 'list';
type DetailTab = 'overview' | 'control' | 'progress' | 'outputs';
type WorkItemStatusFilter = 'ALL' | WorkItem['status'];
type WorkItemPriorityFilter = 'ALL' | WorkItem['priority'];

const STORAGE_KEYS = {
  view: 'singularity.orchestrator.view',
  detailTab: 'singularity.orchestrator.detailTab',
  selected: 'singularity.orchestrator.selected',
  search: 'singularity.orchestrator.search',
  workflow: 'singularity.orchestrator.workflow',
  status: 'singularity.orchestrator.status',
  priority: 'singularity.orchestrator.priority',
  advanced: 'singularity.orchestrator.advanced.open',
} as const;

const readSessionValue = <T extends string>(key: string, fallback: T): T => {
  return readViewPreference(key, fallback, { storage: 'session' });
};

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

const formatRelativeTime = (value?: string) => {
  if (!value) {
    return 'Unknown';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const diff = Date.now() - parsed.getTime();
  const minutes = Math.max(1, Math.floor(diff / (1000 * 60)));

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const getPriorityTone = (priority: WorkItem['priority']) => {
  if (priority === 'High') {
    return 'danger' as const;
  }
  if (priority === 'Med') {
    return 'warning' as const;
  }
  return 'neutral' as const;
};

const getCurrentWorkflowStep = (
  workflow: Workflow | null,
  runDetail: WorkflowRunDetail | null,
  workItem: WorkItem | null,
) => {
  if (!workflow) {
    return null;
  }

  if (runDetail?.run.currentStepId) {
    return workflow.steps.find(step => step.id === runDetail.run.currentStepId) || null;
  }

  if (workItem?.currentStepId) {
    return workflow.steps.find(step => step.id === workItem.currentStepId) || null;
  }

  const lastCompletedRunStep = runDetail?.steps
    .filter(step => step.status === 'COMPLETED')
    .slice(-1)[0];

  if (lastCompletedRunStep) {
    return (
      workflow.steps.find(step => step.id === lastCompletedRunStep.workflowStepId) || null
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

const getAttentionCallToAction = ({
  blocker,
  pendingRequest,
  wait,
}: {
  blocker?: WorkItem['blocker'];
  pendingRequest?: WorkItem['pendingRequest'];
  wait?: RunWait | null;
}) => {
  if (wait?.type === 'APPROVAL' || pendingRequest?.type === 'APPROVAL') {
    return 'Review approval';
  }

  if (wait?.type === 'INPUT' || pendingRequest?.type === 'INPUT') {
    return 'Provide input';
  }

  if (
    blocker?.type === 'HUMAN_INPUT' ||
    wait?.type === 'CONFLICT_RESOLUTION' ||
    pendingRequest?.type === 'CONFLICT_RESOLUTION'
  ) {
    return 'Resolve now';
  }

  return 'Open controls';
};

const getWorkItemAttentionTimestamp = (item: WorkItem) =>
  item.blocker?.timestamp || item.pendingRequest?.timestamp || item.history.slice(-1)[0]?.timestamp;

const getRunEventTone = (event: RunEvent) => {
  if (event.level === 'ERROR' || event.type === 'STEP_FAILED' || event.type === 'TOOL_FAILED') {
    return 'danger' as const;
  }

  if (event.type === 'STEP_WAITING') {
    return 'warning' as const;
  }

  if (event.type === 'STEP_COMPLETED' || event.type === 'TOOL_COMPLETED') {
    return 'success' as const;
  }

  if (event.type === 'STEP_PROGRESS' || event.type === 'TOOL_STARTED') {
    return 'info' as const;
  }

  return getStatusTone(event.level);
};

const getRunEventLabel = (event: RunEvent) => {
  const stage =
    typeof event.details?.stage === 'string' ? event.details.stage : event.type;
  return formatEnumLabel(stage);
};

const getContrarianReview = (
  wait?: RunWait | null,
): ContrarianConflictReview | undefined => {
  const review = wait?.payload?.contrarianReview;
  return review && typeof review === 'object' ? review : undefined;
};

const getContrarianReviewTone = (review?: ContrarianConflictReview) => {
  if (!review) {
    return 'neutral' as const;
  }

  if (review.status === 'ERROR' || review.severity === 'CRITICAL') {
    return 'danger' as const;
  }

  if (review.status === 'PENDING' || review.severity === 'HIGH') {
    return 'warning' as const;
  }

  if (review.severity === 'LOW' && review.recommendation === 'CONTINUE') {
    return 'success' as const;
  }

  return 'info' as const;
};

const isConflictAttention = (item: WorkItem) =>
  item.blocker?.type === 'CONFLICT_RESOLUTION' ||
  item.pendingRequest?.type === 'CONFLICT_RESOLUTION';

const renderReviewList = (items: string[], emptyLabel: string) =>
  items.length > 0 ? (
    <ul className="mt-2 space-y-1 text-xs leading-relaxed text-secondary">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="mt-2 text-xs leading-relaxed text-secondary">{emptyLabel}</p>
  );

const Orchestrator = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeCapability, getCapabilityWorkspace, refreshCapabilityBundle } =
    useCapability();
  const { success } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const lifecycleBoardPhases = useMemo(
    () => getCapabilityBoardPhaseIds(activeCapability),
    [activeCapability],
  );
  const phaseMeta = useMemo(() => {
    const visiblePhaseIds = lifecycleBoardPhases.filter(
      phase => phase !== 'BACKLOG' && phase !== 'DONE',
    );
    const meta = new Map<WorkItemPhase, { label: string; accent: string }>();
    meta.set('BACKLOG', {
      label: getLifecyclePhaseLabel(activeCapability, 'BACKLOG'),
      accent: 'bg-slate-100 text-slate-700',
    });
    meta.set('DONE', {
      label: getLifecyclePhaseLabel(activeCapability, 'DONE'),
      accent: 'bg-surface-container-high text-secondary',
    });
    visiblePhaseIds.forEach((phase, index) => {
      meta.set(phase, {
        label: getLifecyclePhaseLabel(activeCapability, phase),
        accent: PHASE_ACCENTS[index % PHASE_ACCENTS.length],
      });
    });
    return meta;
  }, [activeCapability, lifecycleBoardPhases]);
  const getPhaseMeta = useCallback(
    (phase?: WorkItemPhase) =>
      phaseMeta.get(phase || '') || {
        label: getLifecyclePhaseLabel(activeCapability, phase),
        accent: 'bg-surface-container-high text-secondary',
      },
    [activeCapability, phaseMeta],
  );

  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(() => {
    const stored = readSessionValue(STORAGE_KEYS.selected, '');
    return stored || null;
  });
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);
  const [view, setView] = useState<OrchestratorView>(() =>
    readSessionValue(STORAGE_KEYS.view, 'board'),
  );
  const [detailTab, setDetailTab] = useState<DetailTab>(() =>
    readSessionValue(STORAGE_KEYS.detailTab, 'overview'),
  );
  const [searchQuery, setSearchQuery] = useState<string>(() =>
    readSessionValue(STORAGE_KEYS.search, ''),
  );
  const [workflowFilter, setWorkflowFilter] = useState<string>(() =>
    readSessionValue(STORAGE_KEYS.workflow, 'ALL'),
  );
  const [statusFilter, setStatusFilter] = useState<WorkItemStatusFilter>(() =>
    readSessionValue(STORAGE_KEYS.status, 'ALL') as WorkItemStatusFilter,
  );
  const [priorityFilter, setPriorityFilter] = useState<WorkItemPriorityFilter>(() =>
    readSessionValue(STORAGE_KEYS.priority, 'ALL') as WorkItemPriorityFilter,
  );
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

  const loadRuntime = useCallback(async () => {
    try {
      const status = await fetchRuntimeStatus();
      setRuntimeStatus(status);
      setRuntimeError('');
    } catch (error) {
      setRuntimeError(
        error instanceof Error ? error.message : 'Unable to load runtime configuration.',
      );
    }
  }, []);

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

  const selectWorkItem = useCallback(
    (workItemId: string, options?: { focusBoard?: boolean; openControl?: boolean }) => {
      setSelectedWorkItemId(workItemId);
      setActionError('');
      setResolutionNote('');
      if (options?.openControl) {
        setDetailTab('control');
      }
      if (options?.focusBoard) {
        setView('board');
        window.setTimeout(() => {
          const element = document.getElementById(`orchestrator-item-${workItemId}`);
          element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      }
    },
    [],
  );

  useEffect(() => {
    void refreshCapabilityBundle(activeCapability.id);
    void loadRuntime();
  }, [activeCapability.id, loadRuntime, refreshCapabilityBundle]);

  useEffect(() => {
    if (
      draftWorkItem.workflowId &&
      workspace.workflows.some(workflow => workflow.id === draftWorkItem.workflowId)
    ) {
      return;
    }
    setDraftWorkItem(current => ({
      ...current,
      workflowId: workspace.workflows[0]?.id || '',
    }));
  }, [draftWorkItem.workflowId, workspace.workflows]);

  useEffect(() => {
    if (!selectedWorkItemId || workItems.some(item => item.id === selectedWorkItemId)) {
      return;
    }
    setSelectedWorkItemId(null);
    setSelectedRunDetail(null);
    setSelectedRunEvents([]);
    setSelectedRunHistory([]);
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
    const selectedRunStreamId =
      selectedRunDetail?.run.id || selectedRunHistory[0]?.id || null;
    if (!selectedRunStreamId) {
      return;
    }

    let isMounted = true;
    const eventSource = new EventSource(
      `/api/capabilities/${encodeURIComponent(activeCapability.id)}/runs/${encodeURIComponent(selectedRunStreamId)}/stream`,
    );

    const syncRunHistory = (nextRun: WorkflowRun) => {
      setSelectedRunHistory(current => {
        const existingIndex = current.findIndex(run => run.id === nextRun.id);
        if (existingIndex === -1) {
          return [nextRun, ...current];
        }
        return current.map(run => (run.id === nextRun.id ? nextRun : run));
      });
    };

    eventSource.addEventListener('snapshot', event => {
      if (!isMounted) {
        return;
      }
      const payload = JSON.parse((event as MessageEvent).data) as {
        detail: WorkflowRunDetail;
        events: RunEvent[];
      };
      setSelectedRunDetail(payload.detail);
      setSelectedRunEvents(payload.events);
      syncRunHistory(payload.detail.run);
    });

    eventSource.addEventListener('heartbeat', event => {
      if (!isMounted) {
        return;
      }
      const payload = JSON.parse((event as MessageEvent).data) as {
        detail: WorkflowRunDetail;
      };
      setSelectedRunDetail(payload.detail);
      syncRunHistory(payload.detail.run);
    });

    eventSource.addEventListener('event', event => {
      if (!isMounted) {
        return;
      }
      const payload = JSON.parse((event as MessageEvent).data) as RunEvent;
      setSelectedRunEvents(current =>
        current.some(item => item.id === payload.id) ? current : [...current, payload],
      );
    });

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      isMounted = false;
      eventSource.close();
    };
  }, [activeCapability.id, selectedRunDetail?.run.id, selectedRunHistory[0]?.id]);

  useEffect(() => {
    const nextSearchParams = new URLSearchParams(searchParams);
    let shouldReplace = false;

    if (searchParams.get('new') === '1') {
      setIsCreateSheetOpen(true);
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.view, view, { storage: 'session' });
  }, [view]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.detailTab, detailTab, { storage: 'session' });
  }, [detailTab]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.selected, selectedWorkItemId || '', {
      storage: 'session',
    });
  }, [selectedWorkItemId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.search, searchQuery, { storage: 'session' });
  }, [searchQuery]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.workflow, workflowFilter, { storage: 'session' });
  }, [workflowFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.status, statusFilter, { storage: 'session' });
  }, [statusFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.priority, priorityFilter, { storage: 'session' });
  }, [priorityFilter]);

  const filteredWorkItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return workItems.filter(item => {
      const workflow = workflowsById.get(item.workflowId) || null;
      const currentStep = getCurrentWorkflowStep(workflow, null, item);
      const agentName = item.assignedAgentId
        ? agentsById.get(item.assignedAgentId)?.name || item.assignedAgentId
        : '';

      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.title.toLowerCase().includes(normalizedQuery) ||
        item.id.toLowerCase().includes(normalizedQuery) ||
        item.description.toLowerCase().includes(normalizedQuery) ||
        workflow?.name.toLowerCase().includes(normalizedQuery) ||
        currentStep?.name.toLowerCase().includes(normalizedQuery) ||
        agentName.toLowerCase().includes(normalizedQuery) ||
        item.tags.some(tag => tag.toLowerCase().includes(normalizedQuery));

      const matchesWorkflow =
        workflowFilter === 'ALL' || item.workflowId === workflowFilter;
      const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
      const matchesPriority =
        priorityFilter === 'ALL' || item.priority === priorityFilter;

      return matchesQuery && matchesWorkflow && matchesStatus && matchesPriority;
    });
  }, [
    agentsById,
    priorityFilter,
    searchQuery,
    statusFilter,
    workflowFilter,
    workItems,
    workflowsById,
  ]);

  const attentionItems = useMemo(
    () =>
      filteredWorkItems
        .filter(
          item =>
            item.blocker?.status === 'OPEN' ||
            Boolean(item.pendingRequest) ||
            item.status === 'BLOCKED' ||
            item.status === 'PENDING_APPROVAL',
        )
        .map(item => {
          const workflow = workflowsById.get(item.workflowId) || null;
          const currentStep = getCurrentWorkflowStep(workflow, null, item);
          const agentId = item.assignedAgentId || currentStep?.agentId;
          const attentionReason =
            getAttentionReason({
              blocker: item.blocker,
              pendingRequest: item.pendingRequest,
            }) || 'This work item is paused and needs operator attention.';
          const attentionLabel = getAttentionLabel({
            blocker: item.blocker,
            pendingRequest: item.pendingRequest,
          });
          return {
            item,
            workflow,
            currentStep,
            agentId,
            attentionReason,
            attentionLabel,
            attentionTimestamp: getWorkItemAttentionTimestamp(item),
            hasConflictReview: isConflictAttention(item),
            callToAction: getAttentionCallToAction({
              blocker: item.blocker,
              pendingRequest: item.pendingRequest,
            }),
          };
        })
        .sort((left, right) => {
          const leftTime = left.attentionTimestamp
            ? new Date(left.attentionTimestamp).getTime()
            : 0;
          const rightTime = right.attentionTimestamp
            ? new Date(right.attentionTimestamp).getTime()
            : 0;
          return rightTime - leftTime;
        }),
    [filteredWorkItems, workflowsById],
  );

  const groupedItems = useMemo(
    () =>
      lifecycleBoardPhases.map(phase => ({
        phase,
        items: filteredWorkItems.filter(item => item.phase === phase),
      })),
    [filteredWorkItems, lifecycleBoardPhases],
  );

  const stats = useMemo(
    () => ({
      active: workItems.filter(item => item.status === 'ACTIVE').length,
      blocked: workItems.filter(item => item.status === 'BLOCKED').length,
      approvals: workItems.filter(item => item.status === 'PENDING_APPROVAL').length,
      running: workItems.filter(item => Boolean(item.activeRunId)).length,
    }),
    [workItems],
  );

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
  const selectedContrarianReview =
    selectedOpenWait?.type === 'CONFLICT_RESOLUTION'
      ? getContrarianReview(selectedOpenWait)
      : undefined;
  const selectedContrarianReviewTone =
    getContrarianReviewTone(selectedContrarianReview);
  const selectedContrarianReviewIsReady =
    selectedContrarianReview?.status === 'READY';
  const selectedAgentId =
    selectedRunDetail?.run.assignedAgentId ||
    selectedCurrentStep?.agentId ||
    selectedWorkItem?.assignedAgentId;
  const selectedAgent = selectedAgentId ? agentsById.get(selectedAgentId) || null : null;
  const selectedAttentionReason = selectedWorkItem
    ? getAttentionReason({
        blocker: selectedWorkItem.blocker,
        pendingRequest: selectedWorkItem.pendingRequest,
        wait: selectedOpenWait,
      }) || (selectedWorkItem.status === 'BLOCKED'
        ? 'This work item is blocked and needs operator action before orchestration can continue.'
        : '')
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
    selectedWorkItem?.pendingRequest?.timestamp ||
    selectedWorkItem?.history.slice(-1)[0]?.timestamp;
  const selectedResetStep = selectedWorkflow?.steps[0] || null;
  const selectedResetPhase = selectedResetStep?.phase || 'BACKLOG';
  const selectedResetAgent = selectedResetStep?.agentId
    ? agentsById.get(selectedResetStep.agentId) || null
    : null;

  const currentRun = selectedRunDetail?.run || selectedRunHistory[0] || null;
  const currentRunIsActive = Boolean(
    currentRun && ACTIVE_RUN_STATUSES.includes(currentRun.status),
  );
  const runtimeReady = Boolean(runtimeStatus?.configured) && !runtimeError;

  const canStartExecution =
    Boolean(selectedWorkItem) &&
    !selectedWorkItem?.activeRunId &&
    selectedWorkItem?.phase !== 'DONE' &&
    runtimeReady;

  const canRestartFromPhase =
    Boolean(selectedWorkItem && currentRun && !selectedWorkItem.activeRunId) &&
    selectedWorkItem?.phase !== 'DONE' &&
    runtimeReady;
  const canResetAndRestart = Boolean(selectedWorkItem) && runtimeReady;

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

    return workspace.artifacts
      .filter(
        artifact =>
          artifact.runId === selectedRunDetail.run.id ||
          (artifact.runStepId && selectedRunStepIds.has(artifact.runStepId)),
      )
      .slice()
      .sort(
        (left, right) =>
          new Date(right.created).getTime() - new Date(left.created).getTime(),
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

  const recentRunActivity = useMemo(
    () => selectedRunEvents.slice(-8).reverse(),
    [selectedRunEvents],
  );

  const latestArtifact = selectedArtifacts[0] || null;
  const latestArtifactDocument = useMemo(() => {
    if (!latestArtifact) {
      return '';
    }

    if (latestArtifact.contentFormat === 'JSON' && latestArtifact.contentJson) {
      return JSON.stringify(latestArtifact.contentJson, null, 2);
    }

    return (
      latestArtifact.contentText ||
      latestArtifact.summary ||
      latestArtifact.description ||
      `${latestArtifact.type} · ${latestArtifact.version}`
    );
  }, [latestArtifact]);

  const draftWorkflow = workflowsById.get(draftWorkItem.workflowId) || null;
  const draftFirstStep = draftWorkflow?.steps[0] || null;
  const draftFirstAgent = draftFirstStep
    ? agentsById.get(draftFirstStep.agentId) || null
    : null;

  const withAction = async (
    label: string,
    action: () => Promise<void>,
    successMessage?: { title: string; description?: string },
  ) => {
    setBusyAction(label);
    setActionError('');
    try {
      await action();
      if (successMessage) {
        success(successMessage.title, successMessage.description);
      }
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

    await withAction(
      'create',
      async () => {
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
        setIsCreateSheetOpen(false);
        setDetailTab('overview');
        setDraftWorkItem({
          title: '',
          description: '',
          workflowId: workspace.workflows[0]?.id || '',
          priority: 'Med',
          tags: '',
        });
      },
      {
        title: 'Work item created',
        description: `${draftWorkItem.title.trim()} is now staged in ${activeCapability.name}.`,
      },
    );
  };

  const handleStartExecution = async () => {
    if (!selectedWorkItem) {
      return;
    }

    await withAction(
      'start',
      async () => {
        await startCapabilityWorkflowRun(activeCapability.id, selectedWorkItem.id);
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Execution started',
        description: `${selectedWorkItem.title} is now running through the workflow.`,
      },
    );
  };

  const handleRestartExecution = async () => {
    if (!currentRun || !selectedWorkItem) {
      return;
    }

    await withAction(
      'restart',
      async () => {
        await restartCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
          restartFromPhase: selectedWorkItem.phase,
        });
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Execution restarted',
        description: `${selectedWorkItem.title} restarted from ${getPhaseMeta(selectedWorkItem.phase).label}.`,
      },
    );
  };

  const handleResetAndRestart = async () => {
    if (!selectedWorkItem) {
      return;
    }

    const resetPhase = selectedResetPhase;
    const resetPhaseLabel = getPhaseMeta(resetPhase).label;

    await withAction(
      'reset',
      async () => {
        if (currentRun && currentRunIsActive) {
          await cancelCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
            note:
              resolutionNote.trim() ||
              `Run cancelled so ${selectedWorkItem.title} can be reset to ${resetPhaseLabel} and restarted.`,
          });
        }

        if (selectedWorkItem.phase !== resetPhase) {
          await moveCapabilityWorkItem(activeCapability.id, selectedWorkItem.id, {
            targetPhase: resetPhase,
            note: `Work item reset to ${resetPhaseLabel} before restart.`,
          });
        }

        if (currentRun) {
          await restartCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
            restartFromPhase: resetPhase,
          });
        } else {
          await startCapabilityWorkflowRun(activeCapability.id, selectedWorkItem.id, {
            restartFromPhase: resetPhase,
          });
        }

        setResolutionNote('');
        setDetailTab('progress');
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Progress reset and restarted',
        description: `${selectedWorkItem.title} was reset to ${resetPhaseLabel} and relaunched from the beginning of the workflow path.`,
      },
    );
  };

  const handleResolveWait = async () => {
    if (!currentRun || !selectedOpenWait || !selectedWorkItem) {
      return;
    }

    const resolution = resolutionNote.trim() || actionButtonLabel;

    await withAction(
      'resolve',
      async () => {
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
      },
      {
        title:
          selectedOpenWait.type === 'APPROVAL'
            ? 'Approval submitted'
            : selectedOpenWait.type === 'INPUT'
              ? 'Input submitted'
              : 'Conflict resolved',
        description: `${selectedWorkItem.title} was updated and can continue through the workflow.`,
      },
    );
  };

  const handleCancelRun = async () => {
    if (!currentRun || !selectedWorkItem) {
      return;
    }

    await withAction(
      'cancel',
      async () => {
        await cancelCapabilityWorkflowRun(activeCapability.id, currentRun.id, {
          note: resolutionNote.trim() || 'Run cancelled from the control plane.',
        });
        setResolutionNote('');
        await refreshSelection(selectedWorkItem.id);
      },
      {
        title: 'Execution cancelled',
        description: `${selectedWorkItem.title} was stopped from the control plane.`,
      },
    );
  };

  const handleMoveWorkItem = async (workItemId: string, targetPhase: WorkItemPhase) => {
    const item = workItems.find(current => current.id === workItemId);
    if (!item || item.phase === targetPhase) {
      return;
    }

    await withAction(
      `move-${workItemId}`,
      async () => {
        await moveCapabilityWorkItem(activeCapability.id, workItemId, {
          targetPhase,
          note: `Story moved to ${getPhaseMeta(targetPhase).label} from the orchestration board.`,
        });
        await refreshSelection(selectedWorkItemId === workItemId ? workItemId : undefined);
      },
      {
        title: 'Work item moved',
        description: `${item.title} moved to ${getPhaseMeta(targetPhase).label}.`,
      },
    );
  };

  const handleRefresh = async () => {
    await withAction('refresh', async () => {
      await Promise.all([refreshSelection(selectedWorkItemId), loadRuntime()]);
    });
  };

  return (
    <div className="orchestrator-page-shell space-y-4">
      <section className="orchestrator-commandbar">
        <div className="orchestrator-commandbar-main">
          <div className="orchestrator-commandbar-heading">
            <div className="orchestrator-commandbar-copy">
              <p className="form-kicker">Work</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h1 className="text-[1.75rem] font-bold tracking-tight text-on-surface">
                  {activeCapability.name} Work
                </h1>
                <StatusBadge tone={runtimeReady ? 'success' : 'danger'}>
                  {runtimeReady ? 'Execution ready' : 'Needs setup'}
                </StatusBadge>
                <StatusBadge tone="neutral">
                  {view === 'board' ? 'Board view' : 'List view'}
                </StatusBadge>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-secondary">
                Stage work, clear approvals and blockers, restart when needed, and keep delivery
                moving from one focused board.
              </p>
            </div>

            <div className="orchestrator-commandbar-kpis">
              {[
                { label: 'Active', value: stats.active, tone: 'brand' as const },
                { label: 'Blocked', value: stats.blocked, tone: 'danger' as const },
                { label: 'Pending Approval', value: stats.approvals, tone: 'warning' as const },
                { label: 'Running', value: stats.running, tone: 'info' as const },
              ].map(chip => (
                <div key={chip.label} className="orchestrator-kpi-chip">
                  <StatusBadge tone={chip.tone}>{chip.label}</StatusBadge>
                  <span className="text-sm font-semibold text-on-surface">{chip.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="orchestrator-commandbar-controls">
            <div className="orchestrator-toolbar-row orchestrator-toolbar-row-primary">
              <label className="orchestrator-search-shell">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline"
                />
                <input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Search work item, workflow, step, tag, or agent"
                  className="enterprise-input pl-11"
                />
              </label>

              <div className="orchestrator-view-toggle" aria-label="Choose orchestrator view">
                <button
                  type="button"
                  onClick={() => setView('board')}
                  className={cn(
                    'orchestrator-view-toggle-button',
                    view === 'board' && 'orchestrator-view-toggle-button-active',
                  )}
                >
                  <LayoutGrid size={16} />
                  Board
                </button>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className={cn(
                    'orchestrator-view-toggle-button',
                    view === 'list' && 'orchestrator-view-toggle-button-active',
                  )}
                >
                  <List size={16} />
                  List
                </button>
              </div>
            </div>

            <div className="orchestrator-toolbar-row orchestrator-toolbar-row-secondary">
              <div className="orchestrator-filter-strip">
                <select
                  value={workflowFilter}
                  onChange={event => setWorkflowFilter(event.target.value)}
                  className="field-select"
                >
                  <option value="ALL">All workflows</option>
                  {workspace.workflows.map(workflow => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={event =>
                    setStatusFilter(event.target.value as WorkItemStatusFilter)
                  }
                  className="field-select"
                >
                  <option value="ALL">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="BLOCKED">Blocked</option>
                  <option value="PENDING_APPROVAL">Pending approval</option>
                  <option value="COMPLETED">Completed</option>
                </select>
                <select
                  value={priorityFilter}
                  onChange={event =>
                    setPriorityFilter(event.target.value as WorkItemPriorityFilter)
                  }
                  className="field-select"
                >
                  <option value="ALL">All priorities</option>
                  <option value="High">High</option>
                  <option value="Med">Med</option>
                  <option value="Low">Low</option>
                </select>
              </div>

              <div className="orchestrator-commandbar-actions">
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  disabled={busyAction === 'refresh'}
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw
                    size={16}
                    className={busyAction === 'refresh' ? 'animate-spin' : ''}
                  />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreateSheetOpen(true)}
                  className="enterprise-button enterprise-button-primary"
                >
                  <Plus size={16} />
                  New Work Item
                </button>
              </div>
            </div>

            <div className="orchestrator-commandbar-footnote">
              <span className="orchestrator-commandbar-footnote-copy">
                Showing {filteredWorkItems.length} of {workItems.length} work items
              </span>
              <span className="orchestrator-commandbar-footnote-copy">
                {runtimeError
                  ? 'Agent connection needs attention'
                  : 'Advanced execution details are collapsed below'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <AdvancedDisclosure
        title="Advanced execution details"
        description="Runtime readiness, run-event counts, and telemetry links for operators who need deeper inspection."
        storageKey={STORAGE_KEYS.advanced}
        badge={
          <StatusBadge tone={runtimeReady ? 'success' : 'warning'}>
            {runtimeReady ? 'Connected' : 'Needs attention'}
          </StatusBadge>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Agent connection</p>
            <p className="workspace-meta-value">
              {runtimeReady ? 'Ready' : 'Needs setup'}
            </p>
            <p className="mt-1 text-xs text-secondary">
              {runtimeError || 'Agents can start or resume workflow execution.'}
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Selected run events</p>
            <p className="workspace-meta-value">{selectedRunEvents.length}</p>
            <p className="mt-1 text-xs text-secondary">
              Detailed run events remain available in Run Console.
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Run history</p>
            <p className="workspace-meta-value">{selectedRunHistory.length} runs</p>
            <p className="mt-1 text-xs text-secondary">
              Attempts for the currently selected work item.
            </p>
          </div>
        </div>
      </AdvancedDisclosure>

      <section className="workspace-surface orchestrator-attention-shell">
        <div className="orchestrator-surface-header">
          <div>
            <p className="form-kicker">Top Action Queue</p>
            <h2 className="mt-1 text-lg font-bold text-on-surface">Needs Attention</h2>
            <p className="mt-1 text-sm text-secondary">
              Blockers, approvals, missing input, and conflict resolutions stay here so triage
              happens before the board gets crowded with urgency.
            </p>
          </div>
          <StatusBadge tone={attentionItems.length > 0 ? 'warning' : 'success'}>
            {attentionItems.length > 0
              ? `${attentionItems.length} items waiting`
              : 'All clear'}
          </StatusBadge>
        </div>

        {attentionItems.length === 0 ? (
          <div className="orchestrator-attention-empty">
            No approvals, blockers, or missing-input requests are waiting right now.
          </div>
        ) : (
          <div className="orchestrator-attention-row">
            {attentionItems.map(attention => (
              <button
                key={attention.item.id}
                type="button"
                onClick={() =>
                  selectWorkItem(attention.item.id, { focusBoard: true, openControl: true })
                }
                className={cn(
                  'orchestrator-attention-card min-w-[18rem] text-left',
                  selectedWorkItemId === attention.item.id &&
                    'orchestrator-attention-card-active',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="form-kicker">{attention.item.id}</p>
                    <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-on-surface">
                      {attention.item.title}
                    </h3>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge tone="warning">{attention.attentionLabel}</StatusBadge>
                    {attention.hasConflictReview && (
                      <StatusBadge tone="danger" className="tracking-[0.12em]">
                        Contrarian pass
                      </StatusBadge>
                    )}
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-sm text-secondary">
                  <p className="line-clamp-2">{attention.attentionReason}</p>
                  <div className="orchestrator-attention-meta">
                    <span>{getPhaseMeta(attention.item.phase).label}</span>
                    <span>
                      {agentsById.get(attention.agentId || '')?.name ||
                        attention.agentId ||
                        'System'}
                    </span>
                    <span>{formatRelativeTime(attention.attentionTimestamp)}</span>
                  </div>
                </div>
                <div className="orchestrator-attention-cta">
                  <span>{attention.callToAction}</span>
                  <ArrowRight size={14} />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="orchestrator-workspace-grid">
        <section className="workspace-surface orchestrator-board-shell">
          <div className="orchestrator-surface-header">
            <div>
              <p className="form-kicker">Phase Board</p>
              <h2 className="mt-1 text-lg font-bold text-on-surface">
                {view === 'board' ? 'Execution lanes' : 'Operational list'}
              </h2>
              <p className="mt-1 text-sm text-secondary">
                {view === 'board'
                  ? 'Scan movement across SDLC phases in two compact rows while the control rail stays focused on one item.'
                  : 'Use the operational table for tighter triage without leaving the orchestration surface.'}
              </p>
            </div>
            <div className="orchestrator-board-meta">
              {workspace.workflows.slice(0, 3).map(workflow => (
                <span key={workflow.id}>
                  <StatusBadge tone="neutral">{workflow.name}</StatusBadge>
                </span>
              ))}
            </div>
          </div>

          {view === 'board' ? (
            <div className="orchestrator-board-grid">
              {groupedItems.map(({ phase, items }) => (
                <BoardColumn
                  key={phase}
                  title={getPhaseMeta(phase).label}
                  count={items.length}
                  badge={
                    <StatusBadge tone={getStatusTone(phase)}>
                      {getPhaseMeta(phase).label}
                    </StatusBadge>
                  }
                  active={dragOverPhase === phase}
                  className="orchestrator-phase-column transition-all"
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
                    className="orchestrator-phase-body"
                  >
                    {items.map(item => {
                      const workflow = workflowsById.get(item.workflowId) || null;
                      const currentStep = getCurrentWorkflowStep(workflow, null, item);
                      const agentId = item.assignedAgentId || currentStep?.agentId;
                      const attentionLabel =
                        item.blocker?.status === 'OPEN' || item.pendingRequest
                          ? getAttentionLabel({
                              blocker: item.blocker,
                              pendingRequest: item.pendingRequest,
                            })
                          : '';
                      const attentionReason = getAttentionReason({
                        blocker: item.blocker,
                        pendingRequest: item.pendingRequest,
                      });
                      const hasConflictReview = isConflictAttention(item);

                      return (
                        <motion.button
                          key={item.id}
                          id={`orchestrator-item-${item.id}`}
                          layout
                          draggable
                          onDragStart={event => {
                            setDraggedWorkItemId(item.id);
                            if ('dataTransfer' in event && event.dataTransfer) {
                              const dataTransfer = event.dataTransfer as DataTransfer;
                              dataTransfer.setData('text/plain', item.id);
                            }
                          }}
                          onDragEnd={() => {
                            setDraggedWorkItemId(null);
                            setDragOverPhase(null);
                          }}
                          onClick={() => selectWorkItem(item.id)}
                          className={cn(
                            'orchestrator-board-card',
                            selectedWorkItemId === item.id &&
                              'orchestrator-board-card-active',
                          )}
                        >
                          <div className="orchestrator-board-card-top">
                            <div className="min-w-0">
                              <p className="form-kicker">{item.id}</p>
                              <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-on-surface">
                                {item.title}
                              </h3>
                            </div>
                            <StatusBadge tone={getPriorityTone(item.priority)}>
                              {item.priority}
                            </StatusBadge>
                          </div>

                          <div className="orchestrator-board-card-status">
                            <StatusBadge tone={getStatusTone(item.status)}>
                              {WORK_ITEM_STATUS_META[item.status].label}
                            </StatusBadge>
                            {item.activeRunId && <StatusBadge tone="brand">Running</StatusBadge>}
                            {hasConflictReview && (
                              <StatusBadge tone="danger">Contrarian pass</StatusBadge>
                            )}
                          </div>

                          <div className="orchestrator-board-card-body">
                            <div className="orchestrator-board-card-step">
                              <p className="form-kicker">Current Step</p>
                              <p className="mt-1 text-xs font-semibold text-on-surface">
                                {currentStep?.name || 'Awaiting orchestration'}
                              </p>
                            </div>
                            <div className="orchestrator-board-card-footer">
                              <span className="truncate">
                                {agentsById.get(agentId || '')?.name || agentId || 'Unassigned'}
                              </span>
                              <span className="truncate">
                                {workflow?.name || 'Workflow'}
                              </span>
                            </div>
                            {attentionLabel && (
                              <div className="orchestrator-board-card-attention">
                                <div className="flex items-center gap-2 font-bold uppercase tracking-[0.16em]">
                                  <AlertCircle size={14} />
                                  <span>{attentionLabel}</span>
                                </div>
                                <p className="mt-1 line-clamp-2 normal-case tracking-normal font-medium">
                                  {attentionReason}
                                </p>
                              </div>
                            )}
                          </div>
                        </motion.button>
                      );
                    })}

                    {items.length === 0 && (
                      <EmptyState
                        title={`No work in ${getPhaseMeta(phase).label}`}
                        description="Drop a work item here to re-stage it or keep the phase clear while execution moves forward."
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
              <div className="data-table-header grid grid-cols-[1.6fr_0.85fr_0.9fr_0.95fr_1fr_1.05fr] gap-3">
                <span>Work Item</span>
                <span>Phase</span>
                <span>Status</span>
                <span>Priority</span>
                <span>Current Step</span>
                <span>Active Agent</span>
              </div>
              {filteredWorkItems.map(item => {
                const workflow = workflowsById.get(item.workflowId) || null;
                const currentStep = getCurrentWorkflowStep(workflow, null, item);
                const agentId = item.assignedAgentId || currentStep?.agentId;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectWorkItem(item.id)}
                    className={cn(
                      'orchestrator-list-row',
                      selectedWorkItemId === item.id && 'orchestrator-list-row-active',
                    )}
                  >
                    <div>
                      <p className="font-semibold text-on-surface">{item.title}</p>
                      <p className="mt-1 text-xs text-secondary">{item.id}</p>
                    </div>
                    <span>{getPhaseMeta(item.phase).label}</span>
                    <div>
                      <StatusBadge tone={getStatusTone(item.status)}>
                        {formatEnumLabel(item.status)}
                      </StatusBadge>
                    </div>
                    <div>
                      <StatusBadge tone={getPriorityTone(item.priority)}>
                        {item.priority}
                      </StatusBadge>
                    </div>
                    <span>{currentStep?.name || 'Awaiting orchestration'}</span>
                    <span>{agentsById.get(agentId || '')?.name || agentId || 'Unassigned'}</span>
                  </button>
                );
              })}
              {filteredWorkItems.length === 0 && (
                <EmptyState
                  title="No work items match the current filters"
                  description="Adjust the search or filters to bring items back into the operational list."
                  icon={WorkflowIcon}
                  className="min-h-[18rem]"
                />
              )}
            </div>
          )}
        </section>

        <aside className="orchestrator-detail-rail">
          <div className="workspace-surface orchestrator-detail-panel">
            {!selectedWorkItem ? (
              <EmptyState
                title="Select a work item"
                description="Choose a story from the board, list, or attention queue to inspect execution state, handle waits, and review outputs."
                icon={WorkflowIcon}
                className="h-full min-h-[45rem]"
              />
            ) : (
              <div className="flex h-full flex-col">
                <div className="orchestrator-detail-header">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="form-kicker">{selectedWorkItem.id}</p>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone={getStatusTone(selectedWorkItem.phase)}>
                        {getPhaseMeta(selectedWorkItem.phase).label}
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

                  <div className="mt-4 min-w-0">
                    <h2 className="text-xl font-bold tracking-tight text-on-surface">
                      {selectedWorkItem.title}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-secondary">
                      {selectedWorkItem.description ||
                        'No description was captured when this work item was staged into execution.'}
                    </p>
                  </div>

                  <div className="orchestrator-detail-tabs">
                    {([
                      ['overview', 'Overview'],
                      ['control', 'Control'],
                      ['progress', 'Progress'],
                      ['outputs', 'Outputs'],
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setDetailTab(id)}
                        className={cn(
                          'workspace-tab-button',
                          detailTab === id && 'workspace-tab-button-active',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="orchestrator-detail-body">
                {detailTab === 'overview' && (
                  <div className="space-y-4">
                    {selectedAttentionReason && (
                      <div className="workspace-inline-alert workspace-inline-alert-warning">
                        <AlertCircle size={18} className="mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em]">
                            {selectedAttentionLabel}
                          </p>
                          <p className="mt-2 text-sm font-semibold leading-relaxed">
                            {selectedAttentionReason}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
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
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Workflow</p>
                        <p className="workspace-meta-value">
                          {selectedWorkflow?.name || 'Workflow missing'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {selectedWorkflow?.steps.length || 0} steps staged across SDLC lanes
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Current Step</p>
                        <p className="workspace-meta-value">
                          {selectedCurrentStep?.name || 'Awaiting orchestration'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {selectedCurrentStep?.stepType
                            ? formatEnumLabel(selectedCurrentStep.stepType)
                            : 'Not assigned yet'}
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Active Agent</p>
                        <p className="workspace-meta-value">
                          {selectedAgent?.name || 'Unassigned'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {selectedAgent?.role || 'No agent has been activated for this step yet.'}
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Current Run</p>
                        <p className="workspace-meta-value">
                          {currentRun
                            ? `Attempt ${currentRun.attemptNumber}`
                            : 'No run started yet'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {currentRun
                            ? `Started ${formatTimestamp(currentRun.startedAt || currentRun.createdAt)}`
                            : 'Stage the item and start execution to create a durable run.'}
                        </p>
                      </div>
                    </div>

                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Tags and routing</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedWorkItem.tags.length > 0 ? (
                          selectedWorkItem.tags.map(tag => (
                            <span key={tag}>
                              <StatusBadge tone="neutral">{tag}</StatusBadge>
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-secondary">
                            No tags were attached to this work item.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {detailTab === 'control' && (
                  <div className="space-y-4">
                    {!runtimeReady && (
                      <div className="workspace-inline-alert workspace-inline-alert-warning">
                        <AlertCircle size={18} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-semibold">Agent connection is not ready</p>
                          <p className="mt-1 text-sm leading-relaxed">
                            {runtimeError ||
                              'Configure the agent connection before starting or restarting execution.'}
                          </p>
                        </div>
                      </div>
                    )}

                    {actionError && (
                      <div className="workspace-inline-alert workspace-inline-alert-danger">
                        <AlertCircle size={18} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-semibold">Action failed</p>
                          <p className="mt-1 text-sm leading-relaxed">{actionError}</p>
                        </div>
                      </div>
                    )}

                    {selectedOpenWait && (
                      <div className="workspace-inline-alert workspace-inline-alert-warning">
                        <Clock3 size={18} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em]">
                            Waiting for {formatEnumLabel(selectedOpenWait.type)}
                          </p>
                          <p className="mt-2 text-sm leading-relaxed">
                            {selectedOpenWait.message}
                          </p>
                        </div>
                      </div>
                    )}

                    {selectedOpenWait?.type === 'CONFLICT_RESOLUTION' && (
                      <div className="workspace-meta-card border-red-200/70 bg-red-50/55">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">
                              Contrarian Review
                            </p>
                            <p className="mt-2 text-sm font-semibold text-on-surface">
                              Advisory adversarial pass before continuation
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <StatusBadge tone={selectedContrarianReviewTone}>
                              {selectedContrarianReview
                                ? selectedContrarianReview.status === 'READY'
                                  ? 'Review ready'
                                  : selectedContrarianReview.status === 'PENDING'
                                    ? 'Review pending'
                                    : 'Review unavailable'
                                : 'Review unavailable'}
                            </StatusBadge>
                            {selectedContrarianReview && (
                              <StatusBadge tone={selectedContrarianReviewTone}>
                                {selectedContrarianReview.severity}
                              </StatusBadge>
                            )}
                          </div>
                        </div>

                        {!selectedContrarianReview && (
                          <p className="mt-3 text-sm leading-relaxed text-secondary">
                            No contrarian payload is attached to this wait yet. You can
                            still resolve the conflict manually.
                          </p>
                        )}

                        {selectedContrarianReview?.status === 'PENDING' && (
                          <p className="mt-3 text-sm leading-relaxed text-secondary">
                            The Contrarian Reviewer is challenging the assumptions behind
                            this conflict wait. The operator decision remains available
                            while the advisory pass completes.
                          </p>
                        )}

                        {selectedContrarianReview?.status === 'ERROR' && (
                          <div className="mt-3 rounded-2xl border border-red-200 bg-white/80 px-4 py-3">
                            <p className="text-sm font-semibold text-red-800">
                              Review unavailable
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-secondary">
                              {selectedContrarianReview.lastError ||
                                selectedContrarianReview.summary}
                            </p>
                          </div>
                        )}

                        {selectedContrarianReviewIsReady && selectedContrarianReview && (
                          <div className="mt-4 space-y-4">
                            <p className="text-sm leading-relaxed text-on-surface">
                              {selectedContrarianReview.summary}
                            </p>

                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">Recommendation</p>
                                <p className="mt-2 text-sm font-semibold text-on-surface">
                                  {formatEnumLabel(
                                    selectedContrarianReview.recommendation,
                                  )}
                                </p>
                              </div>
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">Sources</p>
                                <p className="mt-2 text-sm font-semibold text-on-surface">
                                  {selectedContrarianReview.sourceDocumentIds?.length || 0}{' '}
                                  documents
                                </p>
                              </div>
                            </div>

                            {selectedContrarianReview.suggestedResolution && (
                              <button
                                type="button"
                                onClick={() =>
                                  setResolutionNote(
                                    selectedContrarianReview.suggestedResolution || '',
                                  )
                                }
                                className="enterprise-button enterprise-button-secondary"
                              >
                                <ShieldCheck size={16} />
                                Use suggested resolution
                              </button>
                            )}

                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">
                                  Challenged assumptions
                                </p>
                                {renderReviewList(
                                  selectedContrarianReview.challengedAssumptions || [],
                                  'No assumptions were challenged.',
                                )}
                              </div>
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">Risks</p>
                                {renderReviewList(
                                  selectedContrarianReview.risks || [],
                                  'No major risks were flagged.',
                                )}
                              </div>
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">
                                  Missing evidence
                                </p>
                                {renderReviewList(
                                  selectedContrarianReview.missingEvidence || [],
                                  'No missing evidence was identified.',
                                )}
                              </div>
                              <div className="rounded-2xl border border-outline-variant/25 bg-white/80 px-4 py-3">
                                <p className="workspace-meta-label">
                                  Alternative paths
                                </p>
                                {renderReviewList(
                                  selectedContrarianReview.alternativePaths || [],
                                  'No alternative path was proposed.',
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="orchestrator-action-grid">
                      <button
                        type="button"
                        onClick={() => void handleStartExecution()}
                        disabled={!canStartExecution || busyAction !== null}
                        className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === 'start' ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <Play size={16} />
                        )}
                        {selectedRunHistory.length > 0 ? 'Start from current phase' : 'Start execution'}
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
                        onClick={() => void handleResetAndRestart()}
                        disabled={!canResetAndRestart || busyAction !== null}
                        className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === 'reset' ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <RefreshCw size={16} />
                        )}
                        Reset progress and restart
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

                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Reset target</p>
                      <p className="workspace-meta-value">
                        {selectedResetStep?.name || 'Workflow start'}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        Reset moves the work item back to{' '}
                        <strong>{getPhaseMeta(selectedResetPhase).label}</strong>
                        {selectedResetAgent
                          ? ` and restarts with ${selectedResetAgent.name}.`
                          : selectedResetStep?.agentId
                            ? ` and restarts with ${selectedResetStep.agentId}.`
                            : '.'}
                      </p>
                    </div>

                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Resolution composer</p>
                      <textarea
                        value={resolutionNote}
                        onChange={event => setResolutionNote(event.target.value)}
                        placeholder={resolutionPlaceholder}
                        className="field-textarea mt-3 h-28 bg-white"
                      />
                      {resolutionIsRequired && !resolutionNote.trim() && selectedOpenWait && (
                        <p className="mt-2 text-xs font-medium text-amber-700">
                          Add the missing detail above to unblock this work item and continue execution.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {detailTab === 'progress' && (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Attempt</p>
                        <p className="workspace-meta-value">
                          {currentRun ? currentRun.attemptNumber : 0}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {currentRun ? RUN_STATUS_META[currentRun.status].label : 'No active run'}
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Wait state</p>
                        <p className="workspace-meta-value">
                          {selectedOpenWait
                            ? formatEnumLabel(selectedOpenWait.type)
                            : 'No open waits'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {selectedOpenWait
                            ? `Opened ${formatTimestamp(selectedOpenWait.createdAt)}`
                            : 'Execution is not paused on approval, input, or conflict resolution.'}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {(selectedWorkflow?.steps || []).map(step => {
                        const runStep =
                          selectedRunDetail?.steps.find(
                            current => current.workflowStepId === step.id,
                          ) || null;

                        return (
                          <div key={step.id} className="orchestrator-step-row">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-on-surface">
                                  {step.name}
                                </p>
                                <StatusBadge tone={getStatusTone(step.phase)}>
                                  {getPhaseMeta(step.phase).label}
                                </StatusBadge>
                              </div>
                              <p className="mt-1 text-xs leading-relaxed text-secondary">
                                {step.action}
                              </p>
                              <p className="mt-2 text-xs text-secondary">
                                {agentsById.get(step.agentId)?.name || step.agentId} ·{' '}
                                {formatEnumLabel(step.stepType)}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <StatusBadge tone={getStatusTone(runStep?.status || 'PENDING')}>
                                {runStep?.status || 'PENDING'}
                              </StatusBadge>
                              <span className="text-xs text-secondary">
                                {runStep ? `${runStep.attemptCount} attempts` : 'Not started'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <AdvancedDisclosure
                      title="Advanced execution details"
                      description="Run events, tool activity, and worker milestones for deeper operator inspection."
                      storageKey="singularity.orchestrator.progress.advanced.open"
                      badge={
                        <StatusBadge tone="info">
                          {recentRunActivity.length} updates
                        </StatusBadge>
                      }
                    >
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="workspace-meta-card">
                          <p className="workspace-meta-label">Run events</p>
                          <p className="workspace-meta-value">{selectedRunEvents.length}</p>
                        </div>
                        <div className="workspace-meta-card">
                          <p className="workspace-meta-label">Tool actions</p>
                          <p className="workspace-meta-value">
                            {selectedRunDetail?.toolInvocations.length || 0}
                          </p>
                        </div>
                        <div className="workspace-meta-card">
                          <p className="workspace-meta-label">History</p>
                          <p className="workspace-meta-value">{selectedRunHistory.length} runs</p>
                        </div>
                      </div>

                      <div className="mt-4 workspace-meta-card">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="workspace-meta-label">Live agent activity</p>
                            <p className="mt-2 text-sm leading-relaxed text-secondary">
                              Safe execution milestones from the backend worker. This shows visible
                              orchestration progress, not private model reasoning.
                            </p>
                          </div>
                          <StatusBadge tone="info">
                            {recentRunActivity.length} recent updates
                          </StatusBadge>
                        </div>

                        <div className="mt-4 space-y-3">
                          {recentRunActivity.length === 0 ? (
                            <div className="rounded-2xl border border-outline-variant/35 bg-white px-4 py-4 text-sm text-secondary">
                              No live activity is recorded yet for this run.
                            </div>
                          ) : (
                            recentRunActivity.map(event => (
                              <div
                                key={event.id}
                                className="rounded-2xl border border-outline-variant/35 bg-white px-4 py-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-on-surface">
                                      {event.message}
                                    </p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-secondary">
                                      <span>{formatTimestamp(event.timestamp)}</span>
                                      {typeof event.details?.toolId === 'string' ? (
                                        <span>Tool: {formatEnumLabel(event.details.toolId)}</span>
                                      ) : null}
                                      {typeof event.details?.model === 'string' ? (
                                        <span>Model: {event.details.model}</span>
                                      ) : null}
                                      {typeof event.details?.retrievalCount === 'number' ? (
                                        <span>
                                          {event.details.retrievalCount} references
                                        </span>
                                      ) : null}
                                      {typeof event.details?.waitType === 'string' ? (
                                        <span>
                                          Wait: {formatEnumLabel(event.details.waitType)}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <StatusBadge tone={getRunEventTone(event)}>
                                    {getRunEventLabel(event)}
                                  </StatusBadge>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </AdvancedDisclosure>
                  </div>
                )}

                {detailTab === 'outputs' && (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Artifacts</p>
                        <p className="workspace-meta-value">{selectedArtifacts.length}</p>
                        <p className="mt-1 text-xs text-secondary">Captured for the latest run</p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Evidence tasks</p>
                        <p className="workspace-meta-value">{selectedTasks.length}</p>
                        <p className="mt-1 text-xs text-secondary">
                          Workflow-managed execution tasks linked to this work item
                        </p>
                      </div>
                      <div className="workspace-meta-card">
                        <p className="workspace-meta-label">Latest activity</p>
                        <p className="workspace-meta-value">
                          {selectedLogs.length > 0
                            ? formatRelativeTime(selectedLogs[selectedLogs.length - 1]?.timestamp)
                            : 'No logs yet'}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {selectedLogs.length > 0
                            ? selectedLogs[selectedLogs.length - 1]?.message
                            : 'Execution output will appear here after the run advances.'}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {selectedArtifacts.length === 0 ? (
                        <div className="rounded-3xl border border-outline-variant/35 bg-surface-container-low px-4 py-4 text-sm text-secondary">
                          No artifacts were recorded for the latest run yet.
                        </div>
                      ) : (
                        selectedArtifacts.slice(0, 5).map(artifact => (
                          <div key={artifact.id} className="orchestrator-step-row">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-on-surface">
                                  {artifact.name}
                                </p>
                                <StatusBadge tone="brand">
                                  {artifact.direction || 'OUTPUT'}
                                </StatusBadge>
                              </div>
                              <p className="mt-1 text-xs leading-relaxed text-secondary">
                                {compactMarkdownPreview(
                                  artifact.summary ||
                                    artifact.description ||
                                    `${artifact.type} · ${artifact.version}`,
                                  180,
                                )}
                              </p>
                            </div>
                            <span className="text-xs text-secondary">
                              {formatTimestamp(artifact.created)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="workspace-meta-card orchestrator-preview-panel">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="workspace-meta-label">Latest document preview</p>
                          <p className="mt-2 text-sm font-semibold text-on-surface">
                            {latestArtifact?.name || 'No document selected'}
                          </p>
                        </div>
                        {latestArtifact ? (
                          <StatusBadge tone="info">
                            {latestArtifact.contentFormat || 'TEXT'}
                          </StatusBadge>
                        ) : null}
                      </div>

                      <div className="mt-4 rounded-2xl border border-outline-variant/35 bg-white px-5 py-4">
                        {latestArtifactDocument ? (
                          <ArtifactPreview
                            format={latestArtifact?.contentFormat}
                            content={latestArtifactDocument}
                          />
                        ) : (
                          <p className="text-sm leading-relaxed text-secondary">
                            The latest artifact does not have a previewable text body yet.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="workspace-meta-card">
                      <p className="workspace-meta-label">Advanced drill-downs</p>
                      <div className="orchestrator-link-grid">
                        <button
                          type="button"
                          onClick={() => navigate('/run-console')}
                          className="enterprise-button enterprise-button-secondary justify-between"
                        >
                          <span>Run Console telemetry</span>
                          <ExternalLink size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate('/ledger')}
                          className="enterprise-button enterprise-button-secondary justify-between"
                        >
                          <span>Evidence Ledger</span>
                          <ExternalLink size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate('/designer')}
                          className="enterprise-button enterprise-button-secondary justify-between"
                        >
                          <span>Workflow Designer</span>
                          <ExternalLink size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {isCreateSheetOpen && (
        <div className="fixed inset-0 z-[90]">
          <button
            type="button"
            aria-label="Close create work item sheet"
            onClick={() => setIsCreateSheetOpen(false)}
            className="absolute inset-0 bg-slate-950/35"
          />
          <motion.aside
            initial={{ opacity: 0, x: 48 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 48 }}
            className="orchestrator-quick-sheet"
          >
            <div className="orchestrator-quick-sheet-header">
              <div>
                <p className="form-kicker">Quick Create</p>
                <h2 className="mt-1 text-xl font-bold text-on-surface">Stage new work</h2>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  Keep creation lightweight, pick the workflow, and let the execution engine own
                  progression, waits, and durable output.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateSheetOpen(false)}
                className="workspace-list-action"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {workspace.workflows.length === 0 ? (
                <EmptyState
                  title="No workflow is available"
                  description="Create or restore a workflow before staging new work into orchestration."
                  icon={WorkflowIcon}
                  className="min-h-[20rem]"
                />
              ) : (
                <form
                  id="orchestrator-create-work-item"
                  onSubmit={handleCreateWorkItem}
                  className="grid gap-5"
                >
                  <label className="space-y-2">
                    <span className="field-label">Work item title</span>
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
                    <span className="field-label">Workflow</span>
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

                  <div className="workspace-meta-card orchestrator-quick-sheet-summary">
                    <p className="workspace-meta-label">Workflow launch summary</p>
                    <p className="workspace-meta-value">
                      {draftWorkflow?.name || 'Select a workflow'}
                    </p>
                    <div className="mt-3 grid gap-2 text-sm text-secondary">
                      <p>
                        First phase:{' '}
                        <strong className="text-on-surface">
                          {draftFirstStep ? getPhaseMeta(draftFirstStep.phase).label : 'Not defined'}
                        </strong>
                      </p>
                      <p>
                        First agent:{' '}
                        <strong className="text-on-surface">
                          {draftFirstAgent?.name ||
                            (draftFirstStep ? draftFirstStep.agentId : 'Unassigned')}
                        </strong>
                      </p>
                      <p>
                        Steps:{' '}
                        <strong className="text-on-surface">
                          {draftWorkflow?.steps.length || 0}
                        </strong>
                      </p>
                    </div>
                  </div>

                  <label className="space-y-2">
                    <span className="field-label">Priority</span>
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

                  <label className="space-y-2">
                    <span className="field-label">Description</span>
                    <textarea
                      value={draftWorkItem.description}
                      onChange={event =>
                        setDraftWorkItem(prev => ({
                          ...prev,
                          description: event.target.value,
                        }))
                      }
                      placeholder="Add scope, acceptance criteria, or decision context."
                      className="field-textarea h-28"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="field-label">Tags</span>
                    <input
                      value={draftWorkItem.tags}
                      onChange={event =>
                        setDraftWorkItem(prev => ({ ...prev, tags: event.target.value }))
                      }
                      placeholder="parser, math, compiler"
                      className="field-input"
                    />
                  </label>
                </form>
              )}
            </div>

            {workspace.workflows.length > 0 && (
              <div className="orchestrator-quick-sheet-footer">
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsCreateSheetOpen(false)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="orchestrator-create-work-item"
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
              </div>
            )}
          </motion.aside>
        </div>
      )}
    </div>
  );
};

export default Orchestrator;
