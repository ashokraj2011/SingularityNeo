import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Clock3,
  Database,
  DollarSign,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import MarkdownContent from '../components/MarkdownContent';
import { ExplainWorkItemDrawer } from '../components/ExplainWorkItemDrawer';
import {
  fetchCopilotSessionMonitor,
  fetchCapabilityWorkflowRun,
  fetchCapabilityWorkflowRunEvents,
  fetchRunConsoleSnapshot,
} from '../lib/api';
import { createApiEventSource } from '../lib/desktop';
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
import type {
  CopilotSessionMonitorSnapshot,
  RunConsoleSnapshot,
  RunEvent,
  WorkflowRun,
  WorkflowRunDetail,
} from '../types';

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

const RunConsole = () => {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace, setActiveChatAgent } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [snapshot, setSnapshot] = useState<RunConsoleSnapshot | null>(null);
  const [sessionMonitor, setSessionMonitor] = useState<CopilotSessionMonitorSnapshot | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [selectedRunDetail, setSelectedRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExplainOpen, setIsExplainOpen] = useState(false);

  const loadSnapshot = async () => {
    setIsRefreshing(true);
    try {
      const [nextSnapshot, nextSessionMonitor] = await Promise.all([
        fetchRunConsoleSnapshot(activeCapability.id),
        fetchCopilotSessionMonitor(activeCapability.id),
      ]);
      setSnapshot(nextSnapshot);
      setSessionMonitor(nextSessionMonitor);
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

    eventSource = createApiEventSource(
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
  const selectedWorkItem = selectedRun
    ? workspace.workItems.find(item => item.id === selectedRun.workItemId) || null
    : null;

  const recentSpanRows = useMemo(
    () => snapshot?.telemetry.recentSpans.slice(0, 8) || [],
    [snapshot],
  );
  const monitoredSessions = sessionMonitor?.sessions || [];
  const liveTimelineEvents = useMemo(
    () =>
      selectedRunEvents
        .slice()
        .sort(
          (left, right) =>
            new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
        )
        .slice(0, 12),
    [selectedRunEvents],
  );

  const openAgentChat = (agentId?: string) => {
    if (!agentId) {
      return;
    }
    setActiveChatAgent(activeCapability.id, agentId);
    navigate('/chat');
  };

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
          helper={`${sessionMonitor?.summary.storedSessionCount || 0} monitored sessions`}
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
            title="Copilot Session Monitor"
            description="Live and resumable Copilot sessions for this capability, merged from the runtime session cache and durable session records."
            icon={Bot}
          >
            <Toolbar>
              <span className="text-sm text-secondary">
                Runtime: <span className="font-bold text-on-surface">{sessionMonitor?.runtime.runtimeAccessMode || 'Unknown'}</span>
              </span>
              <span className="text-sm text-secondary">
                Identity:{' '}
                <span className="font-bold text-on-surface">
                  {sessionMonitor?.runtime.githubIdentity?.login || 'Unresolved'}
                </span>
              </span>
              <span className="text-sm text-secondary">
                Active: <span className="font-bold text-on-surface">{sessionMonitor?.summary.activeSessionCount || 0}</span>
              </span>
            </Toolbar>

            {sessionMonitor ? (
              <div className="mb-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                  <p className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-secondary">Stored Sessions</p>
                  <p className="mt-2 text-2xl font-bold text-on-surface">
                    {sessionMonitor.summary.storedSessionCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                  <p className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-secondary">General Chat</p>
                  <p className="mt-2 text-2xl font-bold text-on-surface">
                    {sessionMonitor.summary.generalChatCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                  <p className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-secondary">Work Item</p>
                  <p className="mt-2 text-2xl font-bold text-on-surface">
                    {sessionMonitor.summary.workItemCount}
                  </p>
                </div>
                <div className="rounded-2xl border border-outline-variant/35 bg-surface-container-low px-4 py-3">
                  <p className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-secondary">Tracked Tokens</p>
                  <p className="mt-2 text-2xl font-bold text-on-surface">
                    {sessionMonitor.summary.totalTokens.toLocaleString()}
                  </p>
                </div>
              </div>
            ) : null}

            {monitoredSessions.length === 0 ? (
              <EmptyState
                title="No Copilot sessions recorded yet"
                description="Open Chat or start an automated workflow run to create durable Copilot session records for this capability."
                icon={Bot}
              />
            ) : (
              <DataTable
                header={
                  <div className="grid grid-cols-[minmax(0,1.25fr)_10rem_8rem_8rem_8rem_8rem] gap-4">
                    <span>Session</span>
                    <span>Scope</span>
                    <span>State</span>
                    <span>Last Used</span>
                    <span>Tokens</span>
                    <span>Action</span>
                  </div>
                }
              >
                {monitoredSessions.map(session => (
                  <div
                    key={session.sessionId}
                    className="grid grid-cols-[minmax(0,1.25fr)_10rem_8rem_8rem_8rem_8rem] gap-4 border-t border-outline-variant/35 px-4 py-3 text-sm first:border-t-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-on-surface">{session.agentName}</p>
                      <p className="truncate text-xs text-secondary">
                        {session.model} • {session.sessionId.slice(0, 20)}
                      </p>
                    </div>
                    <div className="text-secondary">
                      <p>{formatEnumLabel(session.scope)}</p>
                      <p className="truncate text-xs">
                        {session.scopeId || activeCapability.id}
                      </p>
                    </div>
                    <div>
                      <StatusBadge tone={session.live ? 'success' : 'neutral'}>
                        {session.state}
                      </StatusBadge>
                    </div>
                    <span className="text-secondary">{formatTimestamp(session.lastUsedAt)}</span>
                    <span className="text-secondary">{session.totalTokens.toLocaleString()}</span>
                    <div>
                      <button
                        type="button"
                        onClick={() => openAgentChat(session.agentId)}
                        disabled={!session.agentId}
                        className="inline-flex items-center gap-2 rounded-xl border border-outline-variant/45 bg-white px-3 py-1.5 text-xs font-semibold text-on-surface transition hover:border-primary/20 hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <MessageSquare size={14} />
                        Chat
                      </button>
                    </div>
                  </div>
                ))}
              </DataTable>
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
                {selectedWorkItem ? (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setIsExplainOpen(true)}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Explain
                    </button>
                  </div>
                ) : null}
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
                      {step.outputSummary || step.evidenceSummary ? (
                        <div className="mt-3 rounded-2xl border border-outline-variant/30 bg-white px-4 py-3">
                          <MarkdownContent
                            content={step.outputSummary || step.evidenceSummary || ''}
                          />
                        </div>
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
                  {liveTimelineEvents.map(event => (
                    <div key={event.id} className="rounded-2xl border border-outline-variant/35 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-on-surface">{event.message}</p>
                        <StatusBadge tone={getRunEventTone(event)}>
                          {getRunEventLabel(event)}
                        </StatusBadge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-secondary">
                        <span>{formatTimestamp(event.timestamp)}</span>
                        <span>{event.level}</span>
                        {typeof event.details?.toolId === 'string' ? (
                          <span>Tool: {formatEnumLabel(event.details.toolId)}</span>
                        ) : null}
                        {typeof event.details?.model === 'string' ? (
                          <span>Model: {event.details.model}</span>
                        ) : null}
                        {typeof event.details?.retrievalCount === 'number' ? (
                          <span>{event.details.retrievalCount} references</span>
                        ) : null}
                      </div>
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

      <ExplainWorkItemDrawer
        capability={activeCapability}
        workItem={selectedWorkItem}
        isOpen={isExplainOpen}
        onClose={() => setIsExplainOpen(false)}
      />
    </div>
  );
};

export default RunConsole;
