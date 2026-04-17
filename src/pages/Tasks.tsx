import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, ListTodo, RefreshCw, Workflow } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState, PageHeader, SectionCard, StatusBadge } from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { fetchCapabilityTask, fetchCapabilityTasks } from '../lib/api';
import type { AgentTask } from '../types';

const formatTimestamp = (value: string) => {
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

const statusTone = (status: AgentTask['status']) => {
  switch (status) {
    case 'COMPLETED':
      return 'success' as const;
    case 'PROCESSING':
      return 'info' as const;
    case 'ALERT':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
};

const Tasks = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const { error: showError } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [tasks, setTasks] = useState<AgentTask[]>(workspace.tasks);
  const [selectedTask, setSelectedTask] = useState<AgentTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const selectedTaskId = searchParams.get('taskId') || '';

  const refreshTasks = async () => {
    setLoading(true);
    try {
      const nextTasks = await fetchCapabilityTasks(activeCapability.id);
      setTasks(nextTasks);
      if (!selectedTaskId && nextTasks[0]?.id) {
        setSearchParams({ taskId: nextTasks[0].id }, { replace: true });
      }
    } catch (error) {
      showError(
        'Tasks unavailable',
        error instanceof Error ? error.message : 'Unable to load workflow-managed tasks.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshTasks();
  }, [activeCapability.id]);

  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTask(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    void fetchCapabilityTask(activeCapability.id, selectedTaskId)
      .then(task => {
        if (!cancelled) {
          setSelectedTask(task);
        }
      })
      .catch(error => {
        if (!cancelled) {
          showError(
            'Task unavailable',
            error instanceof Error ? error.message : 'Unable to load the selected task.',
          );
          setSelectedTask(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeCapability.id, selectedTaskId]);

  const taskStats = useMemo(
    () => ({
      total: tasks.length,
      workflowManaged: tasks.filter(task => task.managedByWorkflow).length,
      active: tasks.filter(task => task.status === 'PROCESSING' || task.status === 'QUEUED').length,
      completed: tasks.filter(task => task.status === 'COMPLETED').length,
    }),
    [tasks],
  );

  const relatedLogs = useMemo(
    () =>
      selectedTask
        ? workspace.executionLogs.filter(log => log.taskId === selectedTask.id)
        : [],
    [selectedTask, workspace.executionLogs],
  );

  const relatedArtifacts = useMemo(
    () =>
      selectedTask
        ? workspace.artifacts.filter(
            artifact =>
              selectedTask.linkedArtifacts?.some(link => link.name === artifact.name) ||
              selectedTask.producedOutputs?.some(output => output.artifactId === artifact.id),
          )
        : [],
    [selectedTask, workspace.artifacts],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tasks"
        context={activeCapability.id}
        title="Workflow-managed task projection"
        description="Tasks are now treated as execution-side projections of the workflow, not a separate manual task app."
        actions={
          <>
            <button
              type="button"
              onClick={() => void refreshTasks()}
              className="enterprise-button enterprise-button-secondary"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate('/work')}
              className="enterprise-button enterprise-button-primary"
            >
              <ArrowRight size={16} />
              Open Work
            </button>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
          <p className="form-kicker">Total tasks</p>
          <p className="mt-2 text-2xl font-bold text-on-surface">{taskStats.total}</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
          <p className="form-kicker">Workflow managed</p>
          <p className="mt-2 text-2xl font-bold text-on-surface">{taskStats.workflowManaged}</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
          <p className="form-kicker">Active</p>
          <p className="mt-2 text-2xl font-bold text-on-surface">{taskStats.active}</p>
        </div>
        <div className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-4">
          <p className="form-kicker">Completed</p>
          <p className="mt-2 text-2xl font-bold text-on-surface">{taskStats.completed}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <SectionCard
          title="Task stream"
          description="Every record here should trace back to a work item, workflow step, run, or produced output."
          icon={ListTodo}
        >
          {loading ? (
            <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-8 text-sm text-secondary">
              Loading task projections.
            </div>
          ) : tasks.length === 0 ? (
            <EmptyState
              title="No projected tasks yet"
              description="Tasks will appear here when the workflow engine creates lower-level execution records."
              icon={Workflow}
              className="min-h-[18rem]"
            />
          ) : (
            <div className="space-y-3">
              {tasks.map(task => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSearchParams({ taskId: task.id }, { replace: true })}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    selectedTaskId === task.id
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-outline-variant/40 bg-white hover:border-primary/20'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-on-surface">{task.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        {task.id} • {task.workItemId || 'No work item'} • {task.workflowStepId || 'No step'}
                      </p>
                    </div>
                    <StatusBadge tone={statusTone(task.status)}>{task.status}</StatusBadge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {task.managedByWorkflow ? (
                      <StatusBadge tone="brand">Workflow managed</StatusBadge>
                    ) : null}
                    {task.taskType ? <StatusBadge tone="neutral">{task.taskType}</StatusBadge> : null}
                    {task.phase ? <StatusBadge tone="neutral">{task.phase}</StatusBadge> : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Task detail"
          description="Focused context for the selected workflow-managed task."
          icon={CheckCircle2}
        >
          {detailLoading ? (
            <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-8 text-sm text-secondary">
              Loading task detail.
            </div>
          ) : !selectedTask ? (
            <EmptyState
              title="Select a task"
              description="Pick a task from the left to inspect its workflow linkage, logs, and outputs."
              icon={Clock3}
              className="min-h-[18rem]"
            />
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-bold text-on-surface">{selectedTask.title}</p>
                  <StatusBadge tone={statusTone(selectedTask.status)}>
                    {selectedTask.status}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  {selectedTask.executionNotes || selectedTask.prompt || 'No additional execution notes were stored for this task.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusBadge tone="neutral">{selectedTask.agent}</StatusBadge>
                  {selectedTask.workItemId ? (
                    <StatusBadge tone="neutral">{selectedTask.workItemId}</StatusBadge>
                  ) : null}
                  {selectedTask.runId ? (
                    <StatusBadge tone="neutral">{selectedTask.runId}</StatusBadge>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                  <p className="form-kicker">Produced outputs</p>
                  <div className="mt-3 space-y-2">
                    {(selectedTask.producedOutputs || []).length > 0 ? (
                      selectedTask.producedOutputs!.map(output => (
                        <div
                          key={`${selectedTask.id}-${output.name}`}
                          className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-on-surface">{output.name}</p>
                          <p className="mt-1 text-xs text-secondary">{output.status}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-secondary">No outputs were linked yet.</p>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                  <p className="form-kicker">Related artifacts</p>
                  <div className="mt-3 space-y-2">
                    {relatedArtifacts.length > 0 ? (
                      relatedArtifacts.map(artifact => (
                        <button
                          key={artifact.id}
                          type="button"
                          onClick={() => navigate('/ledger')}
                          className="w-full rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3 text-left transition hover:border-primary/20"
                        >
                          <p className="text-sm font-semibold text-on-surface">{artifact.name}</p>
                          <p className="mt-1 text-xs text-secondary">
                            {artifact.summary || artifact.type}
                          </p>
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-secondary">No related artifacts were linked yet.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
                <p className="form-kicker">Execution logs</p>
                <div className="mt-3 space-y-2">
                  {relatedLogs.length > 0 ? (
                    relatedLogs.map(log => (
                      <div
                        key={log.id}
                        className="rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-on-surface">{log.message}</p>
                          <StatusBadge tone={log.level === 'ERROR' ? 'danger' : log.level === 'WARN' ? 'warning' : 'info'}>
                            {log.level}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-secondary">
                          {formatTimestamp(log.timestamp)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-secondary">No execution logs were linked to this task yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};

export default Tasks;
