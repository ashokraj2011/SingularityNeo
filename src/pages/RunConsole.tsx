import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Clock3,
  Database,
  DollarSign,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import {
  fetchCapabilityWorkflowRun,
  fetchCapabilityWorkflowRunEvents,
  fetchRunConsoleSnapshot,
} from '../lib/api';
import { useCapability } from '../context/CapabilityContext';
import { formatEnumLabel, getStatusTone } from '../lib/enterprise';
import {
  DataTable,
  DrawerShell,
  EmptyState,
  KeyValueList,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
  Toolbar,
} from '../components/EnterpriseUI';
import type { RunConsoleSnapshot, RunEvent, WorkflowRun, WorkflowRunDetail } from '../types';

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

const formatCurrency = (value = 0) => `$${value.toFixed(4)}`;

const RunConsole = () => {
  const { activeCapability } = useCapability();
  const [snapshot, setSnapshot] = useState<RunConsoleSnapshot | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [selectedRunDetail, setSelectedRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadSnapshot = async () => {
    setIsRefreshing(true);
    try {
      const nextSnapshot = await fetchRunConsoleSnapshot(activeCapability.id);
      setSnapshot(nextSnapshot);
      setSelectedRunId(current => current || nextSnapshot.recentRuns[0]?.id || '');
      setError('');
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to load the run console snapshot.',
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadSnapshot();
  }, [activeCapability.id]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRunDetail(null);
      setSelectedRunEvents([]);
      return;
    }

    let isMounted = true;
    let eventSource: EventSource | null = null;

    void Promise.all([
      fetchCapabilityWorkflowRun(activeCapability.id, selectedRunId),
      fetchCapabilityWorkflowRunEvents(activeCapability.id, selectedRunId),
    ])
      .then(([detail, events]) => {
        if (!isMounted) {
          return;
        }
        setSelectedRunDetail(detail);
        setSelectedRunEvents(events);
      })
      .catch(nextError => {
        if (!isMounted) {
          return;
        }
        setError(
          nextError instanceof Error
            ? nextError.message
            : 'Unable to load the selected workflow run.',
        );
      });

    eventSource = new EventSource(
      `/api/capabilities/${encodeURIComponent(activeCapability.id)}/runs/${encodeURIComponent(selectedRunId)}/stream`,
    );

    eventSource.addEventListener('snapshot', event => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        detail: WorkflowRunDetail;
        events: RunEvent[];
      };
      if (!isMounted) {
        return;
      }
      setSelectedRunDetail(payload.detail);
      setSelectedRunEvents(payload.events);
    });

    eventSource.addEventListener('heartbeat', event => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        detail: WorkflowRunDetail;
      };
      if (!isMounted) {
        return;
      }
      setSelectedRunDetail(payload.detail);
    });

    eventSource.addEventListener('event', event => {
      const payload = JSON.parse((event as MessageEvent).data) as RunEvent;
      if (!isMounted) {
        return;
      }
      setSelectedRunEvents(current => [payload, ...current].slice(0, 40));
    });

    eventSource.onerror = () => {
      eventSource?.close();
    };

    return () => {
      isMounted = false;
      eventSource?.close();
    };
  }, [activeCapability.id, selectedRunId]);

  const recentRuns = snapshot?.recentRuns || [];
  const selectedRun =
    recentRuns.find(run => run.id === selectedRunId) ||
    selectedRunDetail?.run ||
    null;

  const recentSpanRows = useMemo(
    () => snapshot?.telemetry.recentSpans.slice(0, 8) || [],
    [snapshot],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        context={activeCapability.id}
        title={`${activeCapability.name} Run Console`}
        description="Live backend execution console for trace-linked workflow runs, step telemetry, waits, policy decisions, and cost visibility."
        actions={
          <button
            type="button"
            className="enterprise-button enterprise-button-secondary"
            onClick={() => void loadSnapshot()}
            disabled={isRefreshing}
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total Runs"
          value={snapshot?.telemetry.totalRuns || 0}
          helper={`${snapshot?.telemetry.activeRuns || 0} active`}
          icon={Workflow}
          tone="brand"
        />
        <StatTile
          label="Waiting Runs"
          value={snapshot?.telemetry.waitingRuns || 0}
          helper={`${snapshot?.telemetry.failedRuns || 0} failed`}
          icon={AlertCircle}
          tone={(snapshot?.telemetry.waitingRuns || 0) > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Total Cost"
          value={formatCurrency(snapshot?.telemetry.totalCostUsd || 0)}
          helper={`${(snapshot?.telemetry.totalTokens || 0).toLocaleString()} tokens`}
          icon={DollarSign}
          tone="info"
        />
        <StatTile
          label="Memory Docs"
          value={snapshot?.telemetry.memoryDocumentCount || 0}
          helper={`${snapshot?.telemetry.policyDecisionCount || 0} policy decisions`}
          icon={Database}
          tone="success"
        />
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
        <div className="space-y-6">
          <SectionCard
            title="Run Fabric"
            description="Recent and active workflow runs owned by the backend execution worker."
            icon={Activity}
          >
            <Toolbar>
              <span className="text-sm text-secondary">
                Active runs: <span className="font-bold text-on-surface">{snapshot?.activeRuns.length || 0}</span>
              </span>
              <span className="text-sm text-secondary">
                Avg latency: <span className="font-bold text-on-surface">{Math.round(snapshot?.telemetry.averageLatencyMs || 0)} ms</span>
              </span>
            </Toolbar>

            {recentRuns.length === 0 ? (
              <EmptyState
                title="No workflow runs yet"
                description="Start a work item from the Orchestrator to generate durable run telemetry."
                icon={Workflow}
              />
            ) : (
              <div className="space-y-3">
                {recentRuns.map(run => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                      selectedRunId === run.id
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-outline-variant/40 bg-white hover:bg-surface-container-low'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-on-surface">{run.workItemId}</p>
                        <p className="text-xs text-secondary">
                          Attempt {run.attemptNumber} • {formatTimestamp(run.createdAt)}
                        </p>
                      </div>
                      <StatusBadge tone={getStatusTone(run.status)}>
                        {formatEnumLabel(run.status)}
                      </StatusBadge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-secondary">
                      <span>Phase: {formatEnumLabel(run.currentPhase)}</span>
                      <span>Trace: {run.traceId?.slice(0, 10) || 'Pending'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Recent Trace Spans"
            description="Execution spans recorded across chat, run, step, tool, memory, and eval activity."
            icon={Clock3}
          >
            <DataTable
              header={
                <div className="grid grid-cols-[minmax(0,1.5fr)_8rem_8rem_8rem] gap-4">
                  <span>Span</span>
                  <span>Status</span>
                  <span>Duration</span>
                  <span>Cost</span>
                </div>
              }
            >
              {recentSpanRows.map(span => (
                <div
                  key={span.id}
                  className="grid grid-cols-[minmax(0,1.5fr)_8rem_8rem_8rem] gap-4 border-t border-outline-variant/35 px-4 py-3 text-sm first:border-t-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-on-surface">{span.name}</p>
                    <p className="truncate text-xs text-secondary">
                      {span.entityType} • {span.traceId.slice(0, 10)}
                    </p>
                  </div>
                  <StatusBadge tone={getStatusTone(span.status)}>
                    {formatEnumLabel(span.status)}
                  </StatusBadge>
                  <span className="text-secondary">{span.durationMs || 0} ms</span>
                  <span className="text-secondary">{formatCurrency(span.costUsd || 0)}</span>
                </div>
              ))}
            </DataTable>
          </SectionCard>
        </div>

        <DrawerShell className="space-y-6">
          {selectedRun && selectedRunDetail ? (
            <>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={getStatusTone(selectedRun.status)}>
                    {formatEnumLabel(selectedRun.status)}
                  </StatusBadge>
                  <StatusBadge tone="brand">Trace {selectedRun.traceId?.slice(0, 10) || 'Pending'}</StatusBadge>
                </div>
                <h2 className="text-xl font-bold text-on-surface">{selectedRun.workItemId}</h2>
                <p className="text-sm text-secondary">
                  Current phase: {formatEnumLabel(selectedRun.currentPhase)} • Attempt {selectedRun.attemptNumber}
                </p>
              </div>

              <KeyValueList
                items={[
                  { label: 'Started', value: formatTimestamp(selectedRun.startedAt) },
                  { label: 'Completed', value: formatTimestamp(selectedRun.completedAt) },
                  { label: 'Assigned Agent', value: selectedRun.assignedAgentId || 'Unassigned' },
                  { label: 'Terminal Outcome', value: selectedRun.terminalOutcome || 'In progress' },
                ]}
              />

              <SectionCard
                title="Workflow Step State"
                description="Durable step progression and retrieval context for the selected run."
                icon={Workflow}
              >
                <div className="space-y-3">
                  {selectedRunDetail.steps.map(step => (
                    <div
                      key={step.id}
                      className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-on-surface">{step.name}</p>
                        <StatusBadge tone={getStatusTone(step.status)}>
                          {formatEnumLabel(step.status)}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-xs text-secondary">
                        {formatEnumLabel(step.phase)} • Attempts {step.attemptCount}
                      </p>
                      {step.outputSummary ? (
                        <p className="mt-2 text-sm text-secondary">{step.outputSummary}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title="Live Event Timeline"
                description="Recent backend events emitted for the selected run."
                icon={ShieldCheck}
              >
                <div className="space-y-3">
                  {selectedRunEvents.slice(0, 12).map(event => (
                    <div key={event.id} className="rounded-2xl border border-outline-variant/35 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-on-surface">{event.message}</p>
                        <StatusBadge tone={getStatusTone(event.level)}>
                          {event.level}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-xs text-secondary">
                        {event.type} • {formatTimestamp(event.timestamp)}
                      </p>
                    </div>
                  ))}
                </div>
              </SectionCard>
            </>
          ) : (
            <EmptyState
              title="Select a run"
              description="Choose a workflow run from the left to inspect its live backend state, telemetry, and event stream."
              icon={Activity}
            />
          )}
        </DrawerShell>
      </div>
    </div>
  );
};

export default RunConsole;
