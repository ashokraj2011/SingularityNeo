import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApiEventSource } from '../../lib/desktop';
import { writeViewPreference } from '../../lib/viewPreferences';
import {
  fetchCapabilityWorkItemCollaboration,
  fetchCapabilityWorkItemExecutionContext,
  fetchCapabilityWorkflowRun,
  fetchCapabilityWorkflowRunEvents,
  listCapabilityWorkflowRuns,
  updateCapabilityWorkItemPresence,
} from '../../lib/api';
import type { ActorContext, RunEvent, WorkItem } from '../../types';
import {
  type WorkItemClaim,
  type WorkItemExecutionContext,
  type WorkItemHandoffPacket,
  type WorkItemPresence,
  type WorkflowRun,
  type WorkflowRunDetail,
  STORAGE_KEYS,
  readSessionValue,
} from '../../lib/orchestrator/support';

const LIVE_EXECUTION_RUN_STATUSES: WorkflowRun['status'][] = ['QUEUED', 'RUNNING'];
const ACTIVE_SELECTION_REFRESH_STATUSES: WorkflowRun['status'][] = [
  'PAUSED',
  'WAITING_APPROVAL',
  'WAITING_HUMAN_TASK',
  'WAITING_INPUT',
  'WAITING_CONFLICT',
];
const WORKSPACE_REFRESH_INTERVAL_MS = 15_000;
const SELECTED_RUN_REFRESH_INTERVAL_MS = 10_000;

type UseOrchestratorSelectionArgs = {
  activeCapabilityId: string;
  currentActorContext: ActorContext;
  workspaceWorkItems: WorkItem[];
  refreshCapabilityBundle: (capabilityId: string) => Promise<unknown>;
  onError: (message: string) => void;
};

export const useOrchestratorSelection = ({
  activeCapabilityId,
  currentActorContext,
  workspaceWorkItems,
  refreshCapabilityBundle,
  onError,
}: UseOrchestratorSelectionArgs) => {
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(() => {
    const stored = readSessionValue(STORAGE_KEYS.selected, '');
    return stored || null;
  });
  const [workItemOverrides, setWorkItemOverrides] = useState<Record<string, WorkItem>>({});
  const [selectedRunDetail, setSelectedRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<RunEvent[]>([]);
  const [selectedRunHistory, setSelectedRunHistory] = useState<WorkflowRun[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [selectedApprovalArtifactId, setSelectedApprovalArtifactId] = useState<string | null>(
    null,
  );
  const [selectedClaims, setSelectedClaims] = useState<WorkItemClaim[]>([]);
  const [selectedPresence, setSelectedPresence] = useState<WorkItemPresence[]>([]);
  const [selectedExecutionContext, setSelectedExecutionContext] =
    useState<WorkItemExecutionContext | null>(null);
  const [selectedHandoffs, setSelectedHandoffs] = useState<WorkItemHandoffPacket[]>([]);
  const selectedRunStreamFallbackId = selectedRunHistory[0]?.id || null;
  const selectedRunStreamFallbackStatus = selectedRunHistory[0]?.status || null;

  const workItems = useMemo(() => {
    const nextById = new Map(workspaceWorkItems.map(item => [item.id, item]));
    Object.values(workItemOverrides).forEach(item => {
      nextById.set(item.id, item);
    });
    return Array.from(nextById.values());
  }, [workspaceWorkItems, workItemOverrides]);

  const loadSelectedRunData = useCallback(
    async (workItemId: string) => {
      const runs = await listCapabilityWorkflowRuns(activeCapabilityId, workItemId);
      setSelectedRunHistory(runs);

      const latestRun = runs[0];
      if (!latestRun) {
        setSelectedRunDetail(null);
        setSelectedRunEvents([]);
        return;
      }

      const [detail, events] = await Promise.all([
        fetchCapabilityWorkflowRun(activeCapabilityId, latestRun.id),
        fetchCapabilityWorkflowRunEvents(activeCapabilityId, latestRun.id),
      ]);
      setSelectedRunDetail(detail);
      setSelectedRunEvents(events);
    },
    [activeCapabilityId],
  );

  const refreshSelection = useCallback(
    async (workItemId?: string | null) => {
      await refreshCapabilityBundle(activeCapabilityId);
      if (workItemId) {
        await loadSelectedRunData(workItemId);
      }
    },
    [activeCapabilityId, loadSelectedRunData, refreshCapabilityBundle],
  );

  useEffect(() => {
    if (!selectedWorkItemId || workItems.some(item => item.id === selectedWorkItemId)) {
      return;
    }
    setSelectedWorkItemId(null);
    setSelectedRunDetail(null);
    setSelectedRunEvents([]);
    setSelectedRunHistory([]);
    setSelectedArtifactId(null);
  }, [selectedWorkItemId, workItems]);

  useEffect(() => {
    if (!selectedWorkItemId) {
      setSelectedRunDetail(null);
      setSelectedRunEvents([]);
      setSelectedRunHistory([]);
      setSelectedArtifactId(null);
      setSelectedApprovalArtifactId(null);
      setSelectedClaims([]);
      setSelectedPresence([]);
      setSelectedExecutionContext(null);
      setSelectedHandoffs([]);
      return;
    }

    void loadSelectedRunData(selectedWorkItemId).catch(error => {
      onError(
        error instanceof Error ? error.message : 'Failed to load workflow run details.',
      );
    });
  }, [loadSelectedRunData, onError, selectedWorkItemId]);

  useEffect(() => {
    setWorkItemOverrides(current => {
      let changed = false;
      const next: Record<string, WorkItem> = { ...current };
      const serverItemsById = new Map(workspaceWorkItems.map(item => [item.id, item]));

      Object.entries(current).forEach(([workItemId, override]) => {
        const serverItem = serverItemsById.get(workItemId);
        if (
          serverItem &&
          serverItem.recordVersion >= override.recordVersion &&
          serverItem.status === override.status &&
          serverItem.phase === override.phase
        ) {
          delete next[workItemId];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [workspaceWorkItems]);

  useEffect(() => {
    if (!selectedWorkItemId || !currentActorContext.userId) {
      return;
    }

    let isMounted = true;
    void Promise.all([
      updateCapabilityWorkItemPresence(activeCapabilityId, selectedWorkItemId, {
        viewContext: 'WORKBENCH',
      }).catch(() => null),
      fetchCapabilityWorkItemCollaboration(activeCapabilityId, selectedWorkItemId),
      fetchCapabilityWorkItemExecutionContext(activeCapabilityId, selectedWorkItemId).catch(
        () => ({ context: null, handoffs: [] }),
      ),
    ])
      .then(([, collaboration, executionContext]) => {
        if (!isMounted) {
          return;
        }
        setSelectedClaims(collaboration.claims);
        setSelectedPresence(collaboration.presence);
        setSelectedExecutionContext(executionContext.context);
        setSelectedHandoffs(executionContext.handoffs);
      })
      .catch(error => {
        if (!isMounted) {
          return;
        }
        console.warn('Failed to load work item collaboration state.', error);
      });

    return () => {
      isMounted = false;
    };
  }, [activeCapabilityId, currentActorContext.userId, selectedWorkItemId]);

  useEffect(() => {
    const selectedRunStreamId =
      selectedRunDetail?.run?.id || selectedRunStreamFallbackId || null;
    const selectedRunStreamStatus =
      selectedRunDetail?.run?.status || selectedRunStreamFallbackStatus || null;

    if (
      !selectedRunStreamId ||
      !selectedRunStreamStatus ||
      !LIVE_EXECUTION_RUN_STATUSES.includes(selectedRunStreamStatus)
    ) {
      return;
    }

    let isMounted = true;
    const eventSource = createApiEventSource(
      `/api/capabilities/${encodeURIComponent(activeCapabilityId)}/runs/${encodeURIComponent(selectedRunStreamId)}/stream`,
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
  }, [
    activeCapabilityId,
    selectedRunDetail?.run?.id,
    selectedRunDetail?.run?.status,
    selectedRunStreamFallbackId,
    selectedRunStreamFallbackStatus,
  ]);

  useEffect(() => {
    const hasOtherActiveWorkItems = workItems.some(
      item => item.status === 'ACTIVE' && item.id !== selectedWorkItemId,
    );
    const selectedWorkItemHasLiveExecution = Boolean(
      (selectedWorkItemId &&
        workItems.some(item => item.id === selectedWorkItemId && item.status === 'ACTIVE')) ||
      (selectedRunDetail?.run?.status &&
        LIVE_EXECUTION_RUN_STATUSES.includes(selectedRunDetail.run.status)) ||
      (selectedRunHistory[0] &&
        LIVE_EXECUTION_RUN_STATUSES.includes(selectedRunHistory[0].status)),
    );
    const selectedRunNeedsLightRefresh = Boolean(
      selectedWorkItemId &&
        (selectedRunDetail?.run?.status
          ? ACTIVE_SELECTION_REFRESH_STATUSES.includes(selectedRunDetail.run.status)
          : selectedRunStreamFallbackStatus
          ? ACTIVE_SELECTION_REFRESH_STATUSES.includes(selectedRunStreamFallbackStatus)
          : false),
    );

    if (!hasOtherActiveWorkItems && !selectedRunNeedsLightRefresh) {
      return;
    }

    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }

      if (selectedRunNeedsLightRefresh && selectedWorkItemId) {
        void loadSelectedRunData(selectedWorkItemId).catch(() => undefined);
      }

      if (hasOtherActiveWorkItems && !selectedWorkItemHasLiveExecution) {
        void refreshCapabilityBundle(activeCapabilityId).catch(() => undefined);
      }
    }, hasOtherActiveWorkItems ? WORKSPACE_REFRESH_INTERVAL_MS : SELECTED_RUN_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [
    activeCapabilityId,
    loadSelectedRunData,
    refreshCapabilityBundle,
    selectedRunDetail?.run?.status,
    selectedRunStreamFallbackStatus,
    selectedWorkItemId,
    workItems,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    writeViewPreference(STORAGE_KEYS.selected, selectedWorkItemId || '', {
      storage: 'session',
    });
  }, [selectedWorkItemId]);

  return {
    selectedWorkItemId,
    setSelectedWorkItemId,
    workItemOverrides,
    setWorkItemOverrides,
    workItems,
    selectedRunDetail,
    setSelectedRunDetail,
    selectedRunEvents,
    setSelectedRunEvents,
    selectedRunHistory,
    setSelectedRunHistory,
    selectedArtifactId,
    setSelectedArtifactId,
    selectedApprovalArtifactId,
    setSelectedApprovalArtifactId,
    selectedClaims,
    setSelectedClaims,
    selectedPresence,
    setSelectedPresence,
    selectedExecutionContext,
    setSelectedExecutionContext,
    selectedHandoffs,
    setSelectedHandoffs,
    loadSelectedRunData,
    refreshSelection,
  };
};
