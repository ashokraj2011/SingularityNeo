import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  Laptop2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unplug,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, PageHeader, SectionCard, StatusBadge } from '../components/EnterpriseUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { hasPermission } from '../lib/accessControl';
import {
  claimCapabilityExecution,
  fetchExecutorRegistry,
  fetchRuntimeStatus,
  releaseCapabilityExecution,
  removeDesktopExecutor,
  type RuntimeStatus,
} from '../lib/api';
import type { ExecutorRegistrySummary } from '../types';

const formatTimestamp = (value?: string) => {
  if (!value) {
    return 'Unknown';
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

const heartbeatTone = (status?: string) => {
  switch (status) {
    case 'FRESH':
      return 'success' as const;
    case 'STALE':
      return 'warning' as const;
    case 'OFFLINE':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
};

const Operations = () => {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace, refreshCapabilityBundle, currentActorContext } =
    useCapability();
  const { success, error: showError } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [registry, setRegistry] = useState<ExecutorRegistrySummary | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');

  const canClaimExecution = hasPermission(
    activeCapability.effectivePermissions,
    'capability.execution.claim',
  );
  const canManageWorkspace = Boolean(
    currentActorContext.workspaceRoles?.includes('WORKSPACE_ADMIN'),
  );

  const refreshData = async () => {
    setLoading(true);
    try {
      const [nextRegistry, nextRuntimeStatus] = await Promise.all([
        fetchExecutorRegistry(),
        fetchRuntimeStatus().catch(() => null),
      ]);
      setRegistry(nextRegistry);
      setRuntimeStatus(nextRuntimeStatus);
    } catch (error) {
      showError(
        'Operations unavailable',
        error instanceof Error ? error.message : 'Unable to load desktop executor operations.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshData();
  }, [activeCapability.id]);

  const currentDesktopOwnsCapability =
    workspace.executionOwnership?.executorId &&
    runtimeStatus?.executorId &&
    workspace.executionOwnership.executorId === runtimeStatus.executorId;

  const handleClaimExecution = async (forceTakeover = false) => {
    setBusyAction(forceTakeover ? 'takeover' : 'claim');
    try {
      await claimCapabilityExecution({
        capabilityId: activeCapability.id,
        forceTakeover,
      });
      await Promise.all([refreshCapabilityBundle(activeCapability.id), refreshData()]);
      success(
        forceTakeover ? 'Execution ownership transferred' : 'Execution claimed',
        forceTakeover
          ? `${activeCapability.name} now routes through this desktop executor.`
          : `${activeCapability.name} is now claimed by this desktop executor.`,
      );
    } catch (error) {
      showError(
        forceTakeover ? 'Takeover failed' : 'Claim failed',
        error instanceof Error ? error.message : 'Unable to update execution ownership.',
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleReleaseExecution = async () => {
    setBusyAction('release');
    try {
      await releaseCapabilityExecution({ capabilityId: activeCapability.id });
      await Promise.all([refreshCapabilityBundle(activeCapability.id), refreshData()]);
      success(
        'Execution released',
        `${activeCapability.name} is now waiting for an eligible desktop executor.`,
      );
    } catch (error) {
      showError(
        'Release failed',
        error instanceof Error ? error.message : 'Unable to release execution ownership.',
      );
    } finally {
      setBusyAction('');
    }
  };

  const handleRemoveExecutor = async (executorId: string) => {
    setBusyAction(`remove-${executorId}`);
    try {
      await removeDesktopExecutor(executorId);
      await Promise.all([refreshCapabilityBundle(activeCapability.id), refreshData()]);
      success('Executor removed', `${executorId} was removed from the registry.`);
    } catch (error) {
      showError(
        'Remove failed',
        error instanceof Error ? error.message : 'Unable to remove the desktop executor.',
      );
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        context={activeCapability.id}
        title="Desktop Executor Operations"
        description="See who is online, which desktop owns execution, and which capabilities are waiting for reclaim."
        actions={
          <>
            <button
              type="button"
              onClick={() => void refreshData()}
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
              Back to Work
            </button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <SectionCard
          title="Current capability execution"
          description="Manual capability-to-desktop routing is the v1 model. One capability has one active desktop owner at a time."
          icon={Bot}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">Execution owner</p>
              <p className="mt-2 text-lg font-bold text-on-surface">
                {workspace.executionOwnership?.actorDisplayName || 'Unassigned'}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                {workspace.executionQueueReason === 'EXECUTOR_DISCONNECTED'
                  ? 'The previous desktop disconnected. Queued runs are waiting for reclaim.'
                  : workspace.executionQueueReason === 'EXECUTOR_RELEASED'
                  ? 'Execution was released intentionally. Runs remain queued until another desktop claims the capability.'
                  : 'Desktop execution ownership controls who can actually run Copilot-backed workflow execution.'}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">This desktop</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge tone={heartbeatTone(runtimeStatus?.executorHeartbeatStatus)}>
                  {runtimeStatus?.executorHeartbeatStatus || 'OFFLINE'}
                </StatusBadge>
                {runtimeStatus?.runtimeOwner ? (
                  <StatusBadge tone="neutral">{runtimeStatus.runtimeOwner}</StatusBadge>
                ) : null}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                {runtimeStatus?.executorId
                  ? `${runtimeStatus.executorId} • last heartbeat ${formatTimestamp(runtimeStatus.executorHeartbeatAt)}`
                  : 'Open the desktop runtime and sign in as a workspace operator to register an executor.'}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {!currentDesktopOwnsCapability ? (
              <button
                type="button"
                onClick={() =>
                  void handleClaimExecution(
                    Boolean(
                      workspace.executionOwnership &&
                        workspace.executionOwnership.executorId !== runtimeStatus?.executorId,
                    ),
                  )
                }
                disabled={!canClaimExecution || !runtimeStatus?.executorId || busyAction.length > 0}
                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === 'claim' || busyAction === 'takeover' ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Laptop2 size={16} />
                )}
                {workspace.executionOwnership &&
                workspace.executionOwnership.executorId !== runtimeStatus?.executorId
                  ? 'Take over current capability'
                  : 'Claim current capability'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleReleaseExecution()}
                disabled={!canClaimExecution || busyAction.length > 0}
                className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === 'release' ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Unplug size={16} />
                )}
                Release current capability
              </button>
            )}
          </div>
        </SectionCard>

        <SectionCard
          title="Executor fleet"
          description="Heartbeat freshness, owned capabilities, and run assignment pressure across all registered desktop executors."
          icon={Activity}
          action={
            registry ? (
              <StatusBadge tone="info">
                {registry.activeCount} active · {registry.staleCount} stale
              </StatusBadge>
            ) : undefined
          }
        >
          {loading ? (
            <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-8 text-sm text-secondary">
              Loading executor registry.
            </div>
          ) : !registry || registry.entries.length === 0 ? (
            <EmptyState
              title="No desktop executors yet"
              description="Once the Electron runtime connects and signs in, the executor registry will appear here."
              icon={Laptop2}
              className="min-h-[16rem]"
            />
          ) : (
            <div className="space-y-4">
              {registry.entries.map(entry => (
                <div
                  key={entry.registration.id}
                  className="rounded-3xl border border-outline-variant/40 bg-white px-5 py-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-on-surface">
                          {entry.registration.actorDisplayName}
                        </p>
                        <StatusBadge tone={heartbeatTone(entry.registration.heartbeatStatus)}>
                          {entry.registration.heartbeatStatus}
                        </StatusBadge>
                        {entry.registration.id === runtimeStatus?.executorId ? (
                          <StatusBadge tone="brand">This desktop</StatusBadge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        {entry.registration.id} • heartbeat {formatTimestamp(entry.registration.heartbeatAt)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        {(entry.registration.runtimeSummary?.provider || 'Desktop runtime') +
                          (entry.registration.runtimeSummary?.defaultModel
                            ? ` · ${entry.registration.runtimeSummary.defaultModel}`
                            : '')}
                      </p>
                    </div>

                    {entry.registration.heartbeatStatus !== 'FRESH' && canManageWorkspace ? (
                      <button
                        type="button"
                        onClick={() => void handleRemoveExecutor(entry.registration.id)}
                        disabled={busyAction === `remove-${entry.registration.id}`}
                        className="enterprise-button enterprise-button-secondary border-red-200 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === `remove-${entry.registration.id}` ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                        Remove stale executor
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-surface-container-low px-4 py-3">
                      <p className="form-kicker">Capabilities owned</p>
                      <p className="mt-2 text-lg font-bold text-on-surface">
                        {entry.ownedCapabilities.length}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-surface-container-low px-4 py-3">
                      <p className="form-kicker">Assigned runs</p>
                      <p className="mt-2 text-lg font-bold text-on-surface">
                        {entry.runAssignmentCount}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-surface-container-low px-4 py-3">
                      <p className="form-kicker">Approved roots</p>
                      <p className="mt-2 text-lg font-bold text-on-surface">
                        {Object.values(entry.registration.approvedWorkspaceRoots).reduce(
                          (total, roots) => total + roots.length,
                          0,
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {entry.ownedCapabilities.length === 0 ? (
                      <p className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm text-secondary">
                        This executor is online but does not currently own any capabilities.
                      </p>
                    ) : (
                      entry.ownedCapabilities.map(capability => (
                        <div
                          key={`${entry.registration.id}-${capability.capabilityId}`}
                          className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-on-surface">
                                {capability.capabilityName}
                              </p>
                              <p className="mt-1 text-xs text-secondary">
                                {capability.capabilityId}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <StatusBadge tone="neutral">
                                {capability.activeRunCount} active
                              </StatusBadge>
                              <StatusBadge tone="neutral">
                                {capability.queuedRunCount} queued
                              </StatusBadge>
                            </div>
                          </div>
                          <p className="mt-3 text-xs leading-relaxed text-secondary">
                            Approved roots:{' '}
                            {capability.approvedWorkspaceRoots.length > 0
                              ? capability.approvedWorkspaceRoots.join(' • ')
                              : 'No local roots published for this capability.'}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {!canClaimExecution ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Read-only operator</p>
              <p className="mt-1 leading-relaxed">
                This page is visible so you can understand executor health, but only operators and
                owners with <span className="font-mono">capability.execution.claim</span> can
                change execution ownership.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Operations;
