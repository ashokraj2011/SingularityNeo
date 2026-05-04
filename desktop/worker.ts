import readline from 'node:readline';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  buildCapabilityBriefing,
  buildCapabilityBriefingPrompt,
} from '../src/lib/capabilityBriefing';
import type {
  ActorContext,
  AgentSessionMemory,
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityWorkspace,
  ChatStreamEvent,
  DesktopWorkspaceMapping,
  ExecutionLog,
  ExecutorHeartbeatStatus,
  MemoryReference,
  RuntimeReadinessCheck,
  MemorySearchResult,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
  WorkItem,
  WorkItemExplainDetail,
  ProviderKey,
  RuntimeProviderConfig,
  ToolAdapterId,
} from '../src/types';
import type { RuntimeStatus } from '../src/lib/api';
import {
  defaultModel,
  getConfiguredGitHubIdentity,
  getConfiguredToken,
  getConfiguredTokenSource,
  githubModelsApiUrl,
  normalizeModel,
} from '../server/githubModels';
import {
  invokeCommonAgentRuntime,
  resolveReadOnlyToolIds,
} from '../server/agentRuntime';
import {
  clearPersistedRuntimeToken,
  clearPersistedLocalEmbeddingSettings,
  persistLocalEmbeddingSettingsAndValidate,
  persistRuntimeTokenAndValidate,
  resolveRuntimeEnvLocalPath,
} from '../server/runtimeCredentials';
import {
  getLocalOpenAIBaseUrl,
  getLocalOpenAIEmbeddingModel,
  isLocalOpenAIConfigured,
} from '../server/localOpenAIProvider';
import {
  getMissingRuntimeConfigurationMessage,
  resolveRuntimeAccessMode,
} from '../server/runtimePolicy';
import {
  listRuntimeProviderStatuses,
  getRuntimeProviderModels,
  resolveSelectedRuntimeProvider,
  saveConfiguredRuntimeProvider,
  selectDefaultRuntimeProvider,
  validateRuntimeProviderStatus,
} from '../server/runtimeProviders';
import { probeRuntimeProvider } from '../server/runtimeProbe';
import { getLifecyclePhaseLabel } from '../src/lib/capabilityLifecycle';
import {
  buildFocusedWorkItemDeveloperPrompt,
  buildAgentSessionMemoryPrompt,
  extractChatWorkspaceReferenceId,
  maybeHandleCapabilityChatAction,
  resolveMentionedWorkItem,
} from '../server/domains/context-fabric';
import {
  buildStructuredChatEvidencePrompt,
  sanitizeGroundedChatResponse,
} from '../server/chatEvidence';
import {
  buildUnifiedChatContextPrompt,
  resolveChatFollowUpContext,
  shouldPreferFollowUpContinuation,
  type EffectiveMessageSource,
  type FollowUpBindingMode,
  type FollowUpIntent,
} from '../server/chatContinuity';
import {
  buildAstGroundingSummary,
  type AstGroundingSummary,
} from '../server/astGrounding';
import { syncCapabilityRepositoriesForDesktop } from '../server/desktopRepoSync';
import { processWorkflowRun, reconcileWorkflowRunFailure } from '../server/execution/service';
import { getWorkflowRunDetail } from '../server/execution/repository';
import { runWithExecutionClientContext } from '../server/execution/runtimeClient';
import { buildWorkItemCheckoutPath } from '../server/workItemCheckouts';
import {
  getDefaultRepoAwareReadOnlyToolIds,
  resolveRuntimeAgentForWorkspace,
  type RuntimeResolvedAgentSource,
} from '../server/runtimeAgents';

const projectRoot = process.env.SINGULARITY_PROJECT_ROOT || process.cwd();
const envLocalPath = resolveRuntimeEnvLocalPath(projectRoot);
dotenv.config({ path: path.join(projectRoot, '.env.local') });
dotenv.config({ path: path.join(projectRoot, '.env') });

type CapabilityBundleSnapshot = {
  capability: Capability;
  workspace: CapabilityWorkspace;
};

type DesktopRuntimePayload = Record<string, unknown> & {
  capability?: Partial<Capability>;
  agent?: Partial<CapabilityAgent>;
  actorContext?: ActorContext | null;
  message?: string;
  workItemId?: string;
  workflowStepId?: string;
  contextMode?: 'GENERAL' | 'WORK_ITEM_STAGE';
  sessionScope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  sessionScopeId?: string;
};

const reader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

const writeMessage = (message: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const controlPlaneUrl = String(
  process.env.SINGULARITY_CONTROL_PLANE_URL || 'http://127.0.0.1:3001',
).replace(/\/+$/, '');

const EXECUTOR_LEASE_MS = 30_000;
const EXECUTOR_POLL_MS = 2_500;

// ── Desktop identity ──────────────────────────────────────────────────────
// Derive a stable, hash-based desktop ID from the machine hostname.
// This matches the algorithm in server/desktopPreferences.ts so both sides
// agree on the key without needing to share a module at this import level.
const desktopHostname = os.hostname();
const desktopId = (() => {
  const host = desktopHostname.toLowerCase().trim();
  const hash = createHash('sha256').update(host).digest('hex').slice(0, 16).toUpperCase();
  return `DID-${hash}`;
})();

const resolveExecutorId = () => {
  const configured = String(process.env.SINGULARITY_DESKTOP_EXECUTOR_ID || '').trim();
  if (configured) return configured;
  // Derive from desktop ID so the executor ID is also stable across restarts.
  return `desktop-executor-${desktopId.replace('DID-', '').slice(0, 12).toLowerCase()}`;
};
let executorId = resolveExecutorId();

// User-level working directory is now defined exclusively by the operator
// via workspace mappings, rather than a global fallback.

/**
 * Fetches stored preferences from the control plane and applies them to this
 * worker's own process.env and local variables.  Called once after the first
 * successful server connection.
 *
 * Failures are silent — the worker continues with .env.local values.
 */
const loadPreferencesFromServer = async () => {
  try {
    const raw = await fetch(`${controlPlaneUrl}/api/runtime/desktop-preferences`, {
      headers: { 'x-desktop-hostname': desktopHostname },
      signal: AbortSignal.timeout(15_000),
    });
    if (!raw.ok) return;
    const prefs = await raw.json() as {
      copilotCliUrl?: string;
      allowHttpFallback?: boolean;
      embeddingBaseUrl?: string;
      embeddingModel?: string;
      executorId?: string;
    };


    if (prefs.copilotCliUrl) {
      process.env.COPILOT_CLI_URL = prefs.copilotCliUrl;
    }
    if (prefs.allowHttpFallback !== undefined) {
      process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK = prefs.allowHttpFallback ? 'true' : 'false';
    }
    if (prefs.embeddingBaseUrl) {
      process.env.LOCAL_OPENAI_BASE_URL = prefs.embeddingBaseUrl;
    }
    if (prefs.embeddingModel) {
      process.env.LOCAL_OPENAI_EMBEDDING_MODEL = prefs.embeddingModel;
    }
    if (prefs.executorId) {
      executorId = prefs.executorId;
      process.env.SINGULARITY_DESKTOP_EXECUTOR_ID = prefs.executorId;
    }
  } catch {
    // Server not yet reachable — proceed with .env.local values.
  }
};

const deriveReadinessState = (checks: RuntimeReadinessCheck[]) => {
  if (checks.some(check => check.status === 'blocked')) {
    return 'blocked' as const;
  }
  if (checks.some(check => check.status === 'degraded')) {
    return 'degraded' as const;
  }
  return 'healthy' as const;
};

let activeActorContext: ActorContext | null = null;
let executorHeartbeatAt: string | undefined;
let executorHeartbeatStatus: ExecutorHeartbeatStatus = 'OFFLINE';
let executorOwnedCapabilityIds: string[] = [];
let executorApprovedWorkspaceRoots: Record<string, string[]> = {};
let executorLoopTimer: NodeJS.Timeout | null = null;
let executorTickInFlight = false;
let lastExecutorDispatchOutcome: {
  state: "idle" | "skipped" | "claimed" | "error";
  reason: string;
  at: string;
} | null = null;
let lastExecutorDispatchSignature: string | null = null;
let readOnlyRepoBootstrapInFlight = new Map<string, Promise<void>>();
const cancelledRuntimeStreamIds = new Set<string>();

const createAbortError = (message = 'Desktop runtime stream was cancelled.') => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

const recordExecutorDispatchOutcome = ({
  state,
  reason,
  details,
  level = 'info',
}: {
  state: "idle" | "skipped" | "claimed" | "error";
  reason: string;
  details?: Record<string, unknown>;
  level?: 'info' | 'warn' | 'error';
}) => {
  const at = new Date().toISOString();
  lastExecutorDispatchOutcome = { state, reason, at };
  const signature = `${state}:${reason}`;
  if (signature === lastExecutorDispatchSignature) {
    return;
  }
  lastExecutorDispatchSignature = signature;
  const payload = {
    state,
    reason,
    at,
    ...(details || {}),
  };
  if (level === 'error') {
    console.error('[desktop-executor]', payload);
    return;
  }
  if (level === 'warn') {
    console.warn('[desktop-executor]', payload);
    return;
  }
  console.info('[desktop-executor]', payload);
};

const isRuntimeStreamCancelled = (streamId: string) =>
  Boolean(streamId) && cancelledRuntimeStreamIds.has(streamId);

const throwIfRuntimeStreamCancelled = (streamId: string) => {
  if (isRuntimeStreamCancelled(streamId)) {
    throw createAbortError();
  }
};

const adoptActorContext = (
  actorContext?: ActorContext | null,
  options?: {
    source?: string;
    syncExecutor?: boolean;
  },
) => {
  const nextActor =
    actorContext && typeof actorContext === 'object'
      ? (actorContext as ActorContext)
      : null;
  if (!nextActor?.userId?.trim()) {
    return false;
  }

  const nextSignature = JSON.stringify({
    userId: nextActor.userId,
    displayName: nextActor.displayName || '',
    teamIds: nextActor.teamIds || [],
    actedOnBehalfOfStakeholderIds: nextActor.actedOnBehalfOfStakeholderIds || [],
  });
  const currentSignature = activeActorContext
    ? JSON.stringify({
        userId: activeActorContext.userId,
        displayName: activeActorContext.displayName || '',
        teamIds: activeActorContext.teamIds || [],
        actedOnBehalfOfStakeholderIds:
          activeActorContext.actedOnBehalfOfStakeholderIds || [],
      })
    : '';

  activeActorContext = nextActor;
  if (nextSignature !== currentSignature) {
    console.info('[desktop-runtime-worker] adopted actor context', {
      source: options?.source || 'unknown',
      actorUserId: nextActor.userId,
      actorDisplayName: nextActor.displayName || null,
    });
  }

  if (options?.syncExecutor !== false) {
    void (async () => {
      try {
        await loadPreferencesFromServer().catch(() => undefined);
        await syncExecutorRegistration().catch(() => undefined);
        ensureDesktopExecutorLoop();
      } catch (error) {
        console.warn(
          `[desktop-runtime-worker] failed to sync actor context from ${
            options?.source || 'unknown'
          }:`,
          error instanceof Error ? error.message : error,
        );
      }
    })();
  }

  return true;
};

const respond = ({
  requestId,
  payload,
  error,
  streamId,
}: {
  requestId: string;
  payload?: unknown;
  error?: string;
  streamId?: string;
}) => {
  writeMessage({
    type: 'worker:response',
    requestId,
    payload,
    error,
    streamId,
  });
};

const sendStreamEvent = (streamId: string, event: ChatStreamEvent) => {
  if (isRuntimeStreamCancelled(streamId)) {
    return;
  }
  writeMessage({
    type: 'worker:stream-event',
    streamId,
    event,
  });
};

const withActorHeaders = (actorContext?: ActorContext | null) => {
  const headers = new Headers({
    'Content-Type': 'application/json',
  });

  if (actorContext?.userId) {
    headers.set('x-singularity-actor-user-id', actorContext.userId);
  }
  if (actorContext?.displayName) {
    headers.set('x-singularity-actor-display-name', actorContext.displayName);
  }
  if (actorContext?.teamIds?.length) {
    headers.set('x-singularity-actor-team-ids', JSON.stringify(actorContext.teamIds));
  }
  if (actorContext?.actedOnBehalfOfStakeholderIds?.length) {
    headers.set(
      'x-singularity-actor-stakeholder-ids',
      JSON.stringify(actorContext.actedOnBehalfOfStakeholderIds),
    );
  }

  return headers;
};

const controlPlaneRequest = async <T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    actorContext?: ActorContext | null;
    timeoutMs?: number;
  },
): Promise<T> => {
  const timeoutMs = options?.timeoutMs || 15_000;
  let response: Response;
  try {
    response = await fetch(new URL(path, `${controlPlaneUrl}/`), {
      method: options?.method || 'GET',
      headers: withActorHeaders(options?.actorContext),
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // AbortSignal.timeout() throws a DOMException whose `.name` is 'TimeoutError'
    // (Node 20+) or 'AbortError' on older runtimes. Convert either into a friendly
    // message that includes the path and budget so callers and IPC consumers see
    // something actionable instead of the raw "The operation was aborted due to timeout".
    if (
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new Error(
        `Control plane request timed out after ${timeoutMs}ms (${options?.method || 'GET'} ${path}).`,
      );
    }
    throw error;
  }

  if (!response.ok) {
    let errorMessage = `Control plane request failed with status ${response.status}.`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        errorMessage = payload.error;
      }
    } catch {
      // Keep fallback message when the response is not JSON.
    }
    throw new Error(errorMessage);
  }

  return response.json() as Promise<T>;
};

const buildRuntimeSummary = async () => {
  const token = getConfiguredToken();
  const tokenSource = getConfiguredTokenSource();
  const selectedProvider = await resolveSelectedRuntimeProvider();
  return {
    provider: selectedProvider?.label || 'Desktop runtime',
    endpoint: selectedProvider?.endpoint || githubModelsApiUrl,
    defaultModel: selectedProvider?.model || normalizeModel(defaultModel),
    runtimeAccessMode: resolveRuntimeAccessMode({
      providerKey: selectedProvider?.key,
      tokenSource,
      token,
      modelCatalogFromRuntime: selectedProvider?.transportMode === 'sdk-session',
    }),
  };
};

const syncExecutorRegistration = async () => {
  // Only heartbeat with a real workspace user attached. A whitespace-only
  // userId would still be truthy via `?.userId`, so trim before checking —
  // otherwise the server would persist actor_user_id as a junk string and
  // every downstream lookup keyed on userId would fail.
  if (!activeActorContext?.userId?.trim()) {
    executorHeartbeatStatus = 'OFFLINE';
    executorHeartbeatAt = undefined;
    executorOwnedCapabilityIds = [];
    return null;
  }

  const registration = await controlPlaneRequest<{
    id: string;
    heartbeatAt: string;
    heartbeatStatus: ExecutorHeartbeatStatus;
    ownedCapabilityIds: string[];
    approvedWorkspaceRoots: Record<string, string[]>;
  }>(`/api/runtime/executors/${encodeURIComponent(executorId)}/heartbeat`, {
    method: 'POST',
    actorContext: activeActorContext,
    body: {
      runtimeSummary: await buildRuntimeSummary(),
      // .env.local working directory fallback has been removed. All working
      // directories are now resolved via desktop_user_workspace_mappings.
    },
  }).catch(async () =>
    controlPlaneRequest<{
      id: string;
      heartbeatAt: string;
      heartbeatStatus: ExecutorHeartbeatStatus;
      ownedCapabilityIds: string[];
      approvedWorkspaceRoots: Record<string, string[]>;
    }>('/api/runtime/executors/register', {
      method: 'POST',
      actorContext: activeActorContext,
      body: {
        executorId,
        runtimeSummary: await buildRuntimeSummary(),
      },
    }),
  );

  executorHeartbeatAt = registration.heartbeatAt;
  executorHeartbeatStatus = registration.heartbeatStatus;
  executorOwnedCapabilityIds = registration.ownedCapabilityIds || [];
  executorApprovedWorkspaceRoots = registration.approvedWorkspaceRoots || {};
  return registration;
};

const heartbeatActiveRun = async (run: WorkflowRun) => {
  await controlPlaneRequest<{ ok: boolean }>(
    `/api/runtime/executors/${encodeURIComponent(executorId)}/runs/${encodeURIComponent(run.id)}/heartbeat`,
    {
      method: 'POST',
      actorContext: activeActorContext,
      body: {
        capabilityId: run.capabilityId,
        leaseMs: EXECUTOR_LEASE_MS,
        approvedWorkspaceRoots: executorApprovedWorkspaceRoots,
        runtimeSummary: await buildRuntimeSummary(),
      },
    },
  );
};

const executeClaimedRun = async (run: WorkflowRun) => {
  await runWithExecutionClientContext(
    {
      controlPlaneUrl,
      executorId,
      actor: activeActorContext,
    },
    async () => {
      // Track consecutive heartbeat failures. After MAX_HEARTBEAT_FAILURES
      // consecutive failures the worker exits so the server-side
      // reconciliation (30 s background loop) can reclaim the run and FAIL
      // any stuck steps, rather than leaving the run orphaned indefinitely.
      let heartbeatFailures = 0;
      const MAX_HEARTBEAT_FAILURES = 5;

      const heartbeat = setInterval(() => {
        void heartbeatActiveRun(run)
          .then(() => {
            heartbeatFailures = 0; // reset on success
          })
          .catch(err => {
            heartbeatFailures += 1;
            console.warn(
              `[worker] run heartbeat failed (${heartbeatFailures}/${MAX_HEARTBEAT_FAILURES}):`,
              err instanceof Error ? err.message : err,
            );
            if (heartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
              console.error(
                '[worker] too many consecutive heartbeat failures — aborting run so ' +
                'server-side reconciliation can reclaim it',
              );
              // Exit cleanly; server's 30 s background loop will FAIL the
              // stuck step and requeue the run within ~75 s total.
              process.exit(1);
            }
          });
      }, Math.max(8_000, Math.floor(EXECUTOR_LEASE_MS / 3)));

      try {
        const detail = await getWorkflowRunDetail(run.capabilityId, run.id);
        await processWorkflowRun(detail);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Desktop execution failed unexpectedly.';
        await reconcileWorkflowRunFailure({
          capabilityId: run.capabilityId,
          runId: run.id,
          message,
        }).catch(() => undefined);
        throw error;
      } finally {
        clearInterval(heartbeat);
      }
    },
  );
};

const tickDesktopExecutor = async () => {
  if (executorTickInFlight) {
    recordExecutorDispatchOutcome({
      state: 'skipped',
      reason: 'Desktop executor tick skipped because a prior poll is still running.',
    });
    return;
  }

  if (!activeActorContext?.userId) {
    recordExecutorDispatchOutcome({
      state: 'skipped',
      reason: 'Desktop executor is waiting for the active workspace operator to be selected.',
    });
    return;
  }

  executorTickInFlight = true;
  try {
    await syncExecutorRegistration();

    const runtimeStatus = await buildDesktopRuntimeStatus();
    if (!runtimeStatus.configured) {
      recordExecutorDispatchOutcome({
        state: 'skipped',
        reason:
          runtimeStatus.availableProviders?.find(provider => provider.defaultSelected)?.validation
            ?.message ||
          runtimeStatus.lastRuntimeError ||
          'Desktop runtime is not configured.',
        level: 'warn',
      });
      return;
    }

    const claimResult = await controlPlaneRequest<{
      run: WorkflowRun | null;
      ownedCapabilityIds: string[];
    }>(`/api/runtime/executors/${encodeURIComponent(executorId)}/runs/claim-next`, {
      method: 'POST',
      actorContext: activeActorContext,
      body: {
        leaseMs: EXECUTOR_LEASE_MS,
        approvedWorkspaceRoots: executorApprovedWorkspaceRoots,
        runtimeSummary: await buildRuntimeSummary(),
      },
    });

    executorOwnedCapabilityIds = claimResult.ownedCapabilityIds || executorOwnedCapabilityIds;
    if (!claimResult.run) {
      recordExecutorDispatchOutcome({
        state: 'idle',
        reason:
          executorOwnedCapabilityIds.length === 0
            ? 'Desktop executor owns no capabilities yet, so there is nothing to claim.'
            : 'No queued run was available for this desktop executor.',
      });
      return;
    }

    recordExecutorDispatchOutcome({
      state: 'claimed',
      reason: `Claimed run ${claimResult.run.id} for execution.`,
      details: {
        runId: claimResult.run.id,
        capabilityId: claimResult.run.capabilityId,
        queueReason: claimResult.run.queueReason || null,
      },
    });
    await executeClaimedRun(claimResult.run);
  } catch (error) {
    recordExecutorDispatchOutcome({
      state: 'error',
      reason:
        error instanceof Error
          ? error.message
          : 'Desktop executor polling failed unexpectedly.',
      level: 'error',
    });
    throw error;
  } finally {
    executorTickInFlight = false;
  }
};

const ensureDesktopExecutorLoop = () => {
  if (executorLoopTimer) {
    return;
  }

  executorLoopTimer = setInterval(() => {
    void tickDesktopExecutor().catch(error => {
      console.error('[desktop-executor] unhandled poll failure', error);
    });
  }, EXECUTOR_POLL_MS);
  void tickDesktopExecutor().catch(error => {
    console.error('[desktop-executor] initial poll failure', error);
  });
};

const withoutPersistentIdentity = <T extends Partial<Capability> | Partial<CapabilityAgent>>(
  value: T,
): T => {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const clone = { ...value };
  delete (clone as { id?: string }).id;
  return clone;
};

const buildDesktopLiveWorkspaceBriefing = (bundle: CapabilityBundleSnapshot) => {
  const briefing = bundle.workspace.briefing || buildCapabilityBriefing(bundle.capability);
  const counts = {
    active: bundle.workspace.workItems.filter(item => item.status === 'ACTIVE').length,
    blocked: bundle.workspace.workItems.filter(item => item.status === 'BLOCKED').length,
    approvals: bundle.workspace.workItems.filter(item => item.status === 'PENDING_APPROVAL')
      .length,
    completed: bundle.workspace.workItems.filter(item => item.status === 'COMPLETED').length,
  };

  const highlightedItems = bundle.workspace.workItems
    .filter(
      item =>
        item.status === 'BLOCKED' ||
        item.status === 'PENDING_APPROVAL' ||
        Boolean(item.activeRunId),
    )
    .slice(0, 5)
    .map(
      item =>
        `${item.id} | ${item.title} | ${getLifecyclePhaseLabel(bundle.capability, item.phase)} | ${item.status}`,
    );

  return [
    buildCapabilityBriefingPrompt(briefing),
    '',
    'Live delivery context:',
    `Work summary: ${counts.active} active, ${counts.blocked} blocked, ${counts.approvals} pending approval, ${counts.completed} completed.`,
    highlightedItems.length > 0
      ? `Attention items: ${highlightedItems.join('; ')}`
      : 'Attention items: none right now.',
    'If the operator asks to change work state and the target is ambiguous, ask for the exact work item id before proceeding.',
  ].join('\n\n');
};

const buildDesktopStageControlDeveloperPrompt = ({
  agentName,
}: {
  agentName: string;
}) =>
  [
    `You are ${agentName}, temporarily working with a human operator inside a direct stage-control window.`,
    'Stay focused on the current work item and current workflow stage only.',
    'Help the operator understand the current status, required inputs, expected outputs, and the smallest concrete next steps needed to complete this stage well.',
    'Be practical and action-oriented. Prefer clear proposed edits, decisions, tradeoffs, and acceptance checks over generic advice.',
    'Do not pretend the workflow has already advanced. The UI will decide when to continue the stage after the operator is satisfied.',
  ].join('\n');

const buildDesktopStageBriefing = ({
  bundle,
  workItem,
  workflow,
  workflowStepId,
}: {
  bundle: CapabilityBundleSnapshot;
  workItem: WorkItem;
  workflow?: Workflow;
  workflowStepId?: string;
}) => {
  const stepId = workflowStepId || workItem.currentStepId;
  const step = stepId ? workflow?.steps.find(item => item.id === stepId) : undefined;
  const briefing = bundle.workspace.briefing || buildCapabilityBriefing(bundle.capability);

  return [
    buildCapabilityBriefingPrompt(briefing),
    '',
    'Current stage context:',
    `${workItem.id} - ${workItem.title}`,
    `Phase: ${getLifecyclePhaseLabel(bundle.capability, workItem.phase)}`,
    `Status: ${workItem.status}`,
    step ? `Current step: ${step.name}` : null,
    workItem.pendingRequest
      ? `Open request: ${workItem.pendingRequest.type} - ${workItem.pendingRequest.message}`
      : null,
    workItem.blocker ? `Current blocker: ${workItem.blocker.message}` : null,
    workItem.description ? `Work item description: ${workItem.description}` : null,
  ]
    .filter(Boolean)
    .join('\n');
};

const summarizeSingleLine = (value: string, maxLength = 180) =>
  value.replace(/\s+/g, ' ').trim().slice(0, maxLength);

const buildDesktopSharedBranchLine = ({
  bundle,
  workItem,
}: {
  bundle: CapabilityBundleSnapshot;
  workItem: WorkItem;
}) => {
  const branch = workItem.executionContext?.branch;
  const repository = bundle.capability.repositories?.find(
    item =>
      item.id ===
      (branch?.repositoryId || workItem.executionContext?.primaryRepositoryId),
  );

  if (!branch && !repository) {
    return null;
  }

  return [
    'Shared branch context:',
    branch?.sharedBranch || 'Branch not created yet',
    repository?.label ? `repo ${repository.label}` : null,
    branch?.baseBranch || repository?.defaultBranch
      ? `base ${branch?.baseBranch || repository?.defaultBranch}`
      : null,
    repository?.localRootHint ? `root ${repository.localRootHint}` : null,
  ]
    .filter(Boolean)
    .join(' | ');
};

const buildDesktopExecutionLogLines = (logs: ExecutionLog[]) =>
  logs.map(log => {
    const timestamp = log.timestamp
      ? new Date(log.timestamp).toISOString().slice(11, 19)
      : 'unknown';
    return `- ${timestamp} | ${log.level} | ${summarizeSingleLine(log.message)}`;
  });

const buildDesktopToolLines = (runDetail?: WorkflowRunDetail | null) =>
  (runDetail?.toolInvocations || [])
    .slice()
    .sort((left, right) => {
      const leftTime = new Date(
        left.completedAt || left.startedAt || left.createdAt,
      ).getTime();
      const rightTime = new Date(
        right.completedAt || right.startedAt || right.createdAt,
      ).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 4)
    .map(invocation => {
      const summary =
        invocation.resultSummary ||
        invocation.stderrPreview ||
        invocation.stdoutPreview ||
        'No output summary recorded.';
      const exitCode =
        invocation.exitCode === undefined ? '' : ` | exit ${invocation.exitCode}`;
      return `- ${invocation.toolId} | ${invocation.status.toLowerCase()}${exitCode} | ${summarizeSingleLine(summary)}`;
    });

const buildDesktopWorkItemRuntimeBriefing = ({
  bundle,
  workItem,
  explain,
  runDetail,
}: {
  bundle: CapabilityBundleSnapshot;
  workItem: WorkItem;
  explain?: WorkItemExplainDetail | null;
  runDetail?: WorkflowRunDetail | null;
}) => {
  const currentWorkflow = bundle.workspace.workflows.find(
    workflow => workflow.id === workItem.workflowId,
  );
  const currentStep = workItem.currentStepId
    ? currentWorkflow?.steps.find(step => step.id === workItem.currentStepId)
    : undefined;
  const toolLines = buildDesktopToolLines(runDetail);
  const recentLogs = bundle.workspace.executionLogs
    .filter(log => {
      const metadata = log.metadata || {};
      return (
        log.runId === (workItem.activeRunId || workItem.lastRunId) ||
        metadata.workItemId === workItem.id ||
        metadata.relatedWorkItemId === workItem.id
      );
    })
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 5);
  const recentMessages = bundle.workspace.messages
    .filter(
      message =>
        message.workItemId === workItem.id ||
        message.runId === (workItem.activeRunId || workItem.lastRunId),
    )
    .slice(-4)
    .map(message => {
      const speaker =
        message.role === 'user'
          ? 'Operator'
          : message.agentName || message.role;
      return `- ${speaker}: ${summarizeSingleLine(message.content)}`;
    });

  return [
    'Focused work item context:',
    `${workItem.id} - ${workItem.title}`,
    explain?.summary.headline || null,
    `Phase: ${getLifecyclePhaseLabel(bundle.capability, workItem.phase)}`,
    `Status: ${workItem.status}`,
    currentStep ? `Current step: ${currentStep.name}` : null,
    explain?.latestRun
      ? `Latest run: ${explain.latestRun.id} (${explain.latestRun.status})`
      : workItem.activeRunId || workItem.lastRunId
        ? `Latest run: ${workItem.activeRunId || workItem.lastRunId}`
        : null,
    explain?.summary.blockingState
      ? `Blocking state: ${explain.summary.blockingState}`
      : workItem.blocker?.message
        ? `Blocking state: ${workItem.blocker.message}`
        : null,
    explain?.summary.nextAction ? `Next action: ${explain.summary.nextAction}` : null,
    explain
      ? `Release readiness: ${explain.releaseReadiness.status} (${explain.releaseReadiness.score}%)`
      : null,
    explain?.attemptDiff.summary
      ? `What changed since last attempt: ${explain.attemptDiff.summary}`
      : null,
    buildDesktopSharedBranchLine({ bundle, workItem }),
    toolLines.length > 0
      ? ['Recent tool activity:', ...toolLines].join('\n')
      : null,
    recentLogs.length > 0
      ? ['Recent execution logs:', ...buildDesktopExecutionLogLines(recentLogs)].join('\n')
      : null,
    recentMessages.length > 0
      ? ['Recent work-item chat context:', ...recentMessages].join('\n')
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');
};

const buildMemoryPrompt = (results: MemorySearchResult[]) =>
  results
    .slice(0, 6)
    .map((result, index) =>
      [
        `Reference ${index + 1}: ${result.document.title || result.reference.title || result.document.id}`,
        result.reference.sourceType ? `Source type: ${result.reference.sourceType}` : null,
        result.document.sourceUri ? `Source URI: ${result.document.sourceUri}` : null,
        `Excerpt: ${result.chunk.content.trim()}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');

const fetchAgentSessionMemory = async ({
  capabilityId,
  agentId,
  scope,
  scopeId,
  actorContext,
}: {
  capabilityId: string;
  agentId?: string;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
  actorContext?: ActorContext | null;
}): Promise<AgentSessionMemory | null> => {
  if (!capabilityId || !agentId) {
    return null;
  }

  const params = new URLSearchParams({
    agentId,
    scope,
    scopeId: scopeId || '',
  });

  return controlPlaneRequest<AgentSessionMemory | null>(
    `/api/capabilities/${encodeURIComponent(capabilityId)}/session-memory?${params.toString()}`,
    {
      actorContext,
    },
  ).catch(() => null);
};

const resolveDesktopRuntimeContext = async (
  payload: DesktopRuntimePayload,
): Promise<{
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  history: CapabilityChatMessage[];
  rawMessage: string;
  effectiveMessage: string;
  effectiveMessageSource: EffectiveMessageSource;
  followUpIntent: FollowUpIntent;
  resolvedAgentSource: RuntimeResolvedAgentSource;
  resolvedAllowedToolIds: ToolAdapterId[];
  bundle?: CapabilityBundleSnapshot;
  chatAction?: Awaited<ReturnType<typeof maybeHandleCapabilityChatAction>>;
  developerPrompt?: string;
  memoryPrompt?: string;
  memoryReferences: MemoryReference[];
  followUpBindingMode: FollowUpBindingMode;
  historyTurnCount: number;
  isCodeQuestion: boolean;
  memoryTrustMode: 'standard' | 'repo-evidence-only';
  astGroundingMode?:
    | 'ast-grounded-local-clone'
    | 'ast-grounded-remote-index'
    | 'no-ast-grounding';
  checkoutPath?: string;
  branchName?: string;
  codeIndexSource?: 'local-checkout' | 'capability-index';
  codeIndexFreshness?: string;
  verifiedPaths?: string[];
  groundingEvidenceSource?: 'local-checkout' | 'capability-index' | 'none';
  shouldBootstrapIndex?: boolean;
  workContextHydrated: boolean;
  workContextSource: 'live-work-item' | 'live-workspace';
  sessionMemoryUsed: boolean;
  sessionMemorySource: 'durable-agent-session' | 'legacy-chat-session' | 'none';
  workItem?: WorkItem;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
}> => {
  const capability = withoutPersistentIdentity(payload.capability as Partial<Capability>);
  const payloadAgent = withoutPersistentIdentity(payload.agent as Partial<CapabilityAgent>);
  const actorContext = payload.actorContext;
  const capabilityId = capability.id || payload.capability?.id;
  const payloadAgentId = payload.agent?.id;
  const originalMessage = String(payload.message || '').trim();
  let followUpContext = resolveChatFollowUpContext({
    history: (payload.history as CapabilityChatMessage[] | undefined) || [],
    latestMessage: originalMessage,
    sessionScope: payload.sessionScope as 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK' | undefined,
    sessionScopeId: payload.sessionScopeId as string | undefined,
    workItemId: payload.workItemId as string | undefined,
    runId: payload.runId as string | undefined,
    workflowStepId: payload.workflowStepId as string | undefined,
  });
  let effectiveMessage = followUpContext.effectiveMessage || originalMessage;

  let liveBriefing = '';
  let memoryReferences: MemoryReference[] = [];
  let developerPrompt: string | undefined;
  let scope = (payload.sessionScope as 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK') || 'GENERAL_CHAT';
  let scopeId = payload.sessionScopeId as string | undefined;
  let sessionMemoryUsed = false;
  let sessionMemorySource: 'durable-agent-session' | 'legacy-chat-session' | 'none' = 'none';
  const initialResolvedAgent = resolveRuntimeAgentForWorkspace({
    payloadAgent,
    payloadAgentId,
  });
  let agent = initialResolvedAgent.agent;
  let resolvedAgentSource: RuntimeResolvedAgentSource = initialResolvedAgent.source;
  let resolvedAllowedToolIds = resolveReadOnlyToolIds(initialResolvedAgent.agent);

  if (capabilityId) {
    const bundle = await controlPlaneRequest<CapabilityBundleSnapshot>(
      `/api/capabilities/${encodeURIComponent(capabilityId)}`,
      {
        actorContext,
        // Cold-worker bundle fetches over a warming control plane can exceed
        // the 15s default; give them the same 45s budget as LLM calls.
        timeoutMs: 45_000,
      },
    );
    const resolvedAgent = resolveRuntimeAgentForWorkspace({
      workspace: bundle.workspace,
      payloadAgent,
      payloadAgentId,
    });
    agent = resolvedAgent.agent;
    resolvedAgentSource = resolvedAgent.source;
    resolvedAllowedToolIds = resolveReadOnlyToolIds(agent);
    const initialSessionMemory = await fetchAgentSessionMemory({
      capabilityId,
      agentId: agent.id,
      scope,
      scopeId: scopeId || (scope === 'GENERAL_CHAT' ? capabilityId : undefined),
      actorContext,
    });
    followUpContext = resolveChatFollowUpContext({
      history: (payload.history as CapabilityChatMessage[] | undefined) || [],
      latestMessage: originalMessage,
      sessionScope: payload.sessionScope as 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK' | undefined,
      sessionScopeId: payload.sessionScopeId as string | undefined,
      workItemId: payload.workItemId as string | undefined,
      runId: payload.runId as string | undefined,
      workflowStepId: payload.workflowStepId as string | undefined,
      sessionMemory: initialSessionMemory,
    });
    effectiveMessage = followUpContext.effectiveMessage || originalMessage;
    const chatAction =
      shouldPreferFollowUpContinuation({
        latestMessage: originalMessage,
        followUpBindingMode: followUpContext.followUpBindingMode,
      })
        ? { handled: false, wakeWorker: false, content: undefined }
        : await maybeHandleCapabilityChatAction({
            bundle,
            agent,
            message: originalMessage,
          });
    const referencedRunId =
      (payload.runId as string | undefined) ||
      extractChatWorkspaceReferenceId(effectiveMessage, 'RUN');
    const requestedWorkItemId =
      (payload.workItemId as string | undefined) ||
      (scope === 'WORK_ITEM' ? scopeId : undefined);
    const requestedWorkItem = requestedWorkItemId
      ? bundle.workspace.workItems.find(item => item.id === requestedWorkItemId)
      : undefined;
    const mentionedWorkItem = !requestedWorkItem
      ? resolveMentionedWorkItem(bundle, effectiveMessage)
      : undefined;
    const referencedWorkItem =
      requestedWorkItem ||
      (referencedRunId
        ? bundle.workspace.workItems.find(
            item =>
              item.activeRunId === referencedRunId ||
              item.lastRunId === referencedRunId,
          )
        : undefined) ||
      mentionedWorkItem?.workItem;
    const requestedWorkflow = requestedWorkItem
      ? bundle.workspace.workflows.find(workflow => workflow.id === requestedWorkItem.workflowId)
      : undefined;
    const referencedWorkflow =
      referencedWorkItem && referencedWorkItem.id !== requestedWorkItem?.id
        ? bundle.workspace.workflows.find(
            workflow => workflow.id === referencedWorkItem.workflowId,
          )
        : requestedWorkflow;

    if (payload.contextMode === 'WORK_ITEM_STAGE' && requestedWorkItem) {
      liveBriefing = buildDesktopStageBriefing({
        bundle,
        workItem: requestedWorkItem,
        workflow: requestedWorkflow,
        workflowStepId: payload.workflowStepId as string | undefined,
      });
      developerPrompt = buildDesktopStageControlDeveloperPrompt({
        agentName: agent.name || agent.role || 'the current stage agent',
      });
      scope = 'WORK_ITEM';
      scopeId = requestedWorkItem.id;
    } else if (referencedWorkItem && !mentionedWorkItem?.ambiguous?.length) {
      const [explain, runDetail] = await Promise.all([
        controlPlaneRequest<WorkItemExplainDetail>(
          `/api/capabilities/${encodeURIComponent(capabilityId)}/work-items/${encodeURIComponent(
            referencedWorkItem.id,
          )}/explain`,
          {
            actorContext,
          },
        ).catch(() => null),
        referencedRunId || referencedWorkItem.activeRunId || referencedWorkItem.lastRunId
          ? controlPlaneRequest<WorkflowRunDetail>(
              `/api/capabilities/${encodeURIComponent(capabilityId)}/runs/${encodeURIComponent(
                referencedRunId ||
                  referencedWorkItem.activeRunId ||
                  referencedWorkItem.lastRunId ||
                  '',
              )}`,
              {
                actorContext,
              },
            ).catch(() => null)
          : Promise.resolve(null),
      ]);
      liveBriefing = buildDesktopWorkItemRuntimeBriefing({
        bundle,
        workItem: referencedWorkItem,
        explain,
        runDetail,
      });
      developerPrompt = buildFocusedWorkItemDeveloperPrompt({
        agentName: agent.name || agent.role || 'the active agent',
      });
      scope = 'WORK_ITEM';
      scopeId = referencedWorkItem.id;
    } else {
      liveBriefing = buildDesktopLiveWorkspaceBriefing(bundle);
      scopeId = scopeId || (scope === 'GENERAL_CHAT' ? bundle.capability.id : undefined);
      if (mentionedWorkItem?.ambiguous?.length) {
        developerPrompt = buildFocusedWorkItemDeveloperPrompt({
          agentName: agent.name || agent.role || 'the active agent',
          ambiguousWorkItems: mentionedWorkItem.ambiguous,
        });
      }
    }

    const queryText =
      payload.contextMode === 'WORK_ITEM_STAGE' && requestedWorkItem
        ? [
            effectiveMessage,
            requestedWorkItem.title,
            requestedWorkItem.description,
            requestedWorkflow?.steps.find(
              step => step.id === ((payload.workflowStepId as string | undefined) || requestedWorkItem.currentStepId),
            )?.name,
          ]
            .filter(Boolean)
            .join('\n')
        : referencedWorkItem && !mentionedWorkItem?.ambiguous?.length
          ? [
              effectiveMessage,
              referencedWorkItem.id,
              referencedWorkItem.title,
              referencedWorkItem.description,
              referencedWorkflow?.steps.find(
                step =>
                  step.id ===
                  ((payload.workflowStepId as string | undefined) ||
                    referencedWorkItem.currentStepId),
              )?.name,
              referencedWorkItem.blocker?.message,
              referencedWorkItem.pendingRequest?.message,
              referencedRunId,
            ]
              .filter(Boolean)
              .join('\n')
        : effectiveMessage;
    const astRepository =
      (bundle.capability.repositories || []).find(
        repository =>
          repository.id ===
          (referencedWorkItem?.executionContext?.primaryRepositoryId ||
            referencedWorkItem?.executionContext?.branch?.repositoryId),
      ) ||
      (bundle.capability.repositories || []).find(repository => repository.isPrimary) ||
      bundle.capability.repositories?.[0];
    const resolution = activeActorContext?.userId
      ? await controlPlaneRequest<{
          localRootPath?: string;
          workingDirectoryPath?: string;
        }>('/api/runtime/desktop-worker-rpc', {
          method: 'POST',
          actorContext: activeActorContext,
          body: {
            method: 'resolveDesktopWorkspace',
            args: {
              executorId,
              userId: activeActorContext.userId,
              capabilityId: bundle.capability.id,
              repositoryId: astRepository?.id,
            },
          },
        }).catch(() => null)
      : null;

    const astCheckoutPath =
      resolution?.workingDirectoryPath && referencedWorkItem && astRepository
        ? buildWorkItemCheckoutPath({
            workingDirectoryPath: resolution.workingDirectoryPath,
            capability: bundle.capability,
            workItemId: referencedWorkItem.id,
            repository: astRepository,
            repositoryCount: (bundle.capability.repositories || []).length,
          })
        : undefined;
    const astGrounding: AstGroundingSummary = await buildAstGroundingSummary({
      capability: bundle.capability,
      workItem: referencedWorkItem,
      message: effectiveMessage,
      checkoutPath: astCheckoutPath,
      repositoryId: astRepository?.id,
      branchName: referencedWorkItem?.id,
    }).catch(() => ({
      astGroundingMode: 'no-ast-grounding' as const,
      isCodeQuestion: false,
      prompt: undefined,
      checkoutPath: astCheckoutPath,
      branchName: referencedWorkItem?.id,
      codeIndexSource: undefined,
      codeIndexFreshness: undefined,
      verifiedPaths: [],
      groundingEvidenceSource: 'none' as const,
    }));
    if (
      astGrounding.isCodeQuestion &&
      !resolvedAllowedToolIds.some(
        toolId => toolId === 'browse_code' || toolId === 'workspace_search',
      )
    ) {
      resolvedAllowedToolIds = [
        ...new Set([
          ...resolvedAllowedToolIds,
          ...getDefaultRepoAwareReadOnlyToolIds(),
        ]),
      ];
    }
    const sessionMemory = await fetchAgentSessionMemory({
      capabilityId,
      agentId: agent.id,
      scope,
      scopeId,
      actorContext,
    });
    sessionMemoryUsed = Boolean(sessionMemory);
    sessionMemorySource = sessionMemory ? 'durable-agent-session' : 'none';
    const sessionMemoryPrompt = buildAgentSessionMemoryPrompt(sessionMemory);

    if (queryText) {
      const rawMemoryResults = await controlPlaneRequest<MemorySearchResult[]>(
        `/api/capabilities/${encodeURIComponent(capabilityId)}/memory/search?q=${encodeURIComponent(queryText)}&limit=6${
          agent.id ? `&agentId=${encodeURIComponent(agent.id)}` : ''
        }`,
        {
          actorContext,
        },
      ).catch(() => []);
      const memoryTrustMode =
        astGrounding.isCodeQuestion ? 'repo-evidence-only' : 'standard';
      const memoryResults =
        memoryTrustMode === 'repo-evidence-only'
          ? rawMemoryResults.filter(result => result.reference.sourceType !== 'CHAT_SESSION')
          : rawMemoryResults;
      memoryReferences = memoryResults.map(result => result.reference);
      const serializedMemory = buildMemoryPrompt(memoryResults);
      const evidencePrompt = buildStructuredChatEvidencePrompt({
        verifiedCodeGrounding: astGrounding.prompt,
        verifiedRepositoryEvidence: astGrounding.checkoutPath
          ? [
              `Repository root on disk: ${astGrounding.checkoutPath}`,
              astGrounding.branchName ? `Active branch: ${astGrounding.branchName}` : null,
              astGrounding.codeIndexFreshness
                ? `Code index freshness: ${astGrounding.codeIndexFreshness}`
                : null,
            ]
              .filter(Boolean)
              .join('\n')
          : null,
        advisoryMemory: serializedMemory ? `Anchor capability memory:\n${serializedMemory}` : null,
        memoryTrustMode,
      });
      return {
        capability,
        agent,
        history: followUpContext.history as CapabilityChatMessage[],
        rawMessage: originalMessage,
        effectiveMessage,
        effectiveMessageSource: followUpContext.effectiveMessageSource,
        followUpIntent: followUpContext.followUpIntent,
        resolvedAgentSource,
        resolvedAllowedToolIds,
        bundle,
        chatAction,
        developerPrompt,
        memoryPrompt: buildUnifiedChatContextPrompt({
          liveContext: liveBriefing,
          sessionMemoryPrompt,
          followUpContextPrompt: followUpContext.followUpContextPrompt,
          evidencePrompt,
        }) || undefined,
        memoryReferences,
        followUpBindingMode: followUpContext.followUpBindingMode,
        historyTurnCount: followUpContext.history.length,
        isCodeQuestion: astGrounding.isCodeQuestion,
        memoryTrustMode,
        astGroundingMode: astGrounding.astGroundingMode,
        checkoutPath: astGrounding.checkoutPath,
        branchName: astGrounding.branchName,
        codeIndexSource: astGrounding.codeIndexSource,
        codeIndexFreshness: astGrounding.codeIndexFreshness,
        verifiedPaths: astGrounding.verifiedPaths,
        groundingEvidenceSource: astGrounding.groundingEvidenceSource,
        shouldBootstrapIndex: astGrounding.shouldBootstrapIndex,
        workContextHydrated: Boolean(liveBriefing.trim()),
        workContextSource: scope === 'WORK_ITEM' ? 'live-work-item' : 'live-workspace',
        sessionMemoryUsed,
        sessionMemorySource,
        workItem: referencedWorkItem,
        scope,
        scopeId,
      };
    }

    return {
      capability,
      agent,
      history: followUpContext.history as CapabilityChatMessage[],
      rawMessage: originalMessage,
      effectiveMessage,
      effectiveMessageSource: followUpContext.effectiveMessageSource,
      followUpIntent: followUpContext.followUpIntent,
      resolvedAgentSource,
      resolvedAllowedToolIds,
      bundle,
      chatAction,
      developerPrompt,
      memoryPrompt:
        buildUnifiedChatContextPrompt({
          liveContext: liveBriefing,
          sessionMemoryPrompt,
          followUpContextPrompt: followUpContext.followUpContextPrompt,
          evidencePrompt: buildStructuredChatEvidencePrompt({
            verifiedCodeGrounding: astGrounding.prompt,
            verifiedRepositoryEvidence: astGrounding.checkoutPath
              ? [
                  `Repository root on disk: ${astGrounding.checkoutPath}`,
                  astGrounding.branchName ? `Active branch: ${astGrounding.branchName}` : null,
                  astGrounding.codeIndexFreshness
                    ? `Code index freshness: ${astGrounding.codeIndexFreshness}`
                    : null,
                ]
                  .filter(Boolean)
                  .join('\n')
              : null,
            advisoryMemory: null,
            memoryTrustMode: astGrounding.isCodeQuestion ? 'repo-evidence-only' : 'standard',
          }),
        }) || undefined,
      memoryReferences,
      followUpBindingMode: followUpContext.followUpBindingMode,
      historyTurnCount: followUpContext.history.length,
      isCodeQuestion: astGrounding.isCodeQuestion,
      memoryTrustMode: astGrounding.isCodeQuestion ? 'repo-evidence-only' : 'standard',
      astGroundingMode: astGrounding.astGroundingMode,
      checkoutPath: astGrounding.checkoutPath,
      branchName: astGrounding.branchName,
      codeIndexSource: astGrounding.codeIndexSource,
      codeIndexFreshness: astGrounding.codeIndexFreshness,
      verifiedPaths: astGrounding.verifiedPaths,
      groundingEvidenceSource: astGrounding.groundingEvidenceSource,
      shouldBootstrapIndex: astGrounding.shouldBootstrapIndex,
      workContextHydrated: Boolean(liveBriefing.trim()),
      workContextSource: scope === 'WORK_ITEM' ? 'live-work-item' : 'live-workspace',
      sessionMemoryUsed,
      sessionMemorySource,
      workItem: referencedWorkItem,
      scope,
      scopeId,
    };
  }

  return {
    capability,
    agent,
    history: followUpContext.history as CapabilityChatMessage[],
    rawMessage: originalMessage,
    effectiveMessage,
    effectiveMessageSource: followUpContext.effectiveMessageSource,
    followUpIntent: followUpContext.followUpIntent,
    resolvedAgentSource,
    resolvedAllowedToolIds,
    developerPrompt,
    memoryPrompt:
      buildUnifiedChatContextPrompt({
        liveContext: liveBriefing,
        sessionMemoryPrompt: '',
        followUpContextPrompt: followUpContext.followUpContextPrompt,
      }) || undefined,
    memoryReferences,
    followUpBindingMode: followUpContext.followUpBindingMode,
    historyTurnCount: followUpContext.history.length,
    isCodeQuestion: false,
    memoryTrustMode: 'standard',
    workContextHydrated: Boolean(liveBriefing.trim()),
    workContextSource: 'live-workspace',
    sessionMemoryUsed,
    sessionMemorySource,
    shouldBootstrapIndex: false,
    scope,
    scopeId,
  };
};

type DesktopRuntimeContext = Awaited<ReturnType<typeof resolveDesktopRuntimeContext>>;

const ensureReadOnlyRepoBootstrap = async (capabilityId: string) => {
  if (!capabilityId || !activeActorContext?.userId) {
    return;
  }
  const existing = readOnlyRepoBootstrapInFlight.get(capabilityId);
  if (existing) {
    await existing;
    return;
  }
  const bootstrapPromise = (async () => {
    console.log(
      `[desktop-runtime-worker] bootstrapping read-only repo grounding for ${capabilityId} via executor ${executorId}`,
    );
    await syncExecutorRegistration().catch(() => undefined);
    await syncCapabilityRepositoriesForDesktop({
      capabilityId,
      executorId,
      actorUserId: activeActorContext?.userId,
      fetch: false,
    });
  })()
    .catch((error) => {
      console.warn(
        `[desktop-runtime-worker] read-only repo bootstrap failed for ${capabilityId}:`,
        error instanceof Error ? error.message : error,
      );
    })
    .finally(() => {
      readOnlyRepoBootstrapInFlight.delete(capabilityId);
    });
  readOnlyRepoBootstrapInFlight.set(capabilityId, bootstrapPromise);
  await bootstrapPromise;
};

const maybeBootstrapReadOnlyRuntimeContext = async (
  payload: DesktopRuntimePayload,
  context: DesktopRuntimeContext,
): Promise<DesktopRuntimeContext> => {
  const capabilityId = String(
    context.bundle?.capability?.id ||
      context.capability?.id ||
      payload.capability?.id ||
      '',
  ).trim();
  if (
    !capabilityId ||
    !context.isCodeQuestion ||
    !context.shouldBootstrapIndex ||
    !activeActorContext?.userId
  ) {
    return context;
  }
  await ensureReadOnlyRepoBootstrap(capabilityId);
  return resolveDesktopRuntimeContext(payload).catch(() => context);
};

const buildDesktopRuntimeStatus = async (): Promise<RuntimeStatus> => {
  const token = getConfiguredToken();
  const tokenSource = getConfiguredTokenSource();
  const providerStatuses = await listRuntimeProviderStatuses();
  const selectedProvider =
    providerStatuses.find(provider => provider.defaultSelected && provider.configured) ||
    providerStatuses.find(provider => provider.configured) ||
    providerStatuses[0];
  const configured = Boolean(selectedProvider?.configured);
  const embeddingConfigured = isLocalOpenAIConfigured();
  let controlPlaneReachable = true;
  const controlPlaneRuntimeStatus = await controlPlaneRequest<
    Pick<
      RuntimeStatus,
      | 'databaseRuntime'
      | 'activeDatabaseProfileId'
      | 'activeDatabaseProfileLabel'
      | 'readinessState'
      | 'checks'
      | 'controlPlaneUrl'
      | 'fallbackReason'
      | 'embeddingConfigured'
      | 'retrievalMode'
    >
  >('/api/runtime/status').catch(() => {
    controlPlaneReachable = false;
    return {
      databaseRuntime: undefined,
      activeDatabaseProfileId: null,
      activeDatabaseProfileLabel: null,
      readinessState: 'blocked' as const,
      checks: [],
      controlPlaneUrl,
      fallbackReason: null,
      embeddingConfigured: false,
      retrievalMode: undefined,
    };
  });
  const models = selectedProvider?.availableModels || [];
  const fromRuntime =
    selectedProvider?.transportMode === 'sdk-session' ||
    selectedProvider?.transportMode === 'http-api' ||
    selectedProvider?.transportMode === 'local-openai';
  const runtimeDefaultModel = selectedProvider?.model || normalizeModel(defaultModel);
  const identityResult = configured
    ? selectedProvider?.key === 'github-copilot'
      ? await getConfiguredGitHubIdentity()
      : { identity: null, error: null }
    : { identity: null, error: null };
  const checks: RuntimeReadinessCheck[] = [
    {
      id: 'control-plane',
      label: 'Control plane',
      status: controlPlaneReachable ? 'healthy' : 'blocked',
      message: controlPlaneReachable
        ? `Desktop can reach ${controlPlaneUrl}.`
        : `Desktop cannot reach ${controlPlaneUrl}.`,
      remediation: controlPlaneReachable
        ? undefined
        : 'Start the server or set SINGULARITY_CONTROL_PLANE_URL to the reachable enterprise control-plane URL.',
    },
    {
      id: 'desktop-runtime',
      label: 'Desktop model runtime',
      status: configured ? 'healthy' : 'degraded',
      message: configured
        ? `${selectedProvider?.label || 'Desktop runtime'} is configured${selectedProvider?.transportMode ? ` (${selectedProvider.transportMode})` : ''}.`
        : 'Desktop model runtime is not configured.',
      remediation: configured
        ? undefined
        : 'Configure at least one desktop runtime provider or token before claiming execution.',
    },
    {
      id: 'desktop-executor',
      label: 'Desktop executor',
      status:
        activeActorContext?.userId && executorHeartbeatStatus === 'FRESH'
          ? 'healthy'
          : 'degraded',
      message: activeActorContext?.userId
        ? `Executor ${executorId} is ${executorHeartbeatStatus}.`
        : 'No current workspace operator is selected for this desktop executor.',
      remediation: activeActorContext?.userId
        ? undefined
        : 'Choose the current operator from the top bar before claiming execution.',
    },

    ...(controlPlaneRuntimeStatus.checks || []),
  ];

  // ── Resolve workingDirectory from desktop_user_workspace_mappings ────────
  // Without this, the runtime always reports `workingDirectorySource: 'missing'`
  // even when a valid mapping exists in the DB — which trips
  // `hasDesktopWorkspaceAuthority` and silently blocks Start execution / the
  // Copilot dock readiness banner.
  let resolvedWorkingDirectory: string | undefined;
  let resolvedWorkingDirectorySource: RuntimeStatus['workingDirectorySource'] =
    'missing';
  if (executorId && activeActorContext?.userId) {
    try {
      const mappingResult = await controlPlaneRequest<{
        mappings: DesktopWorkspaceMapping[];
      }>(
        `/api/runtime/executors/${encodeURIComponent(executorId)}/workspace-mappings?userId=${encodeURIComponent(activeActorContext.userId)}`,
      );
      const validMapping = (mappingResult?.mappings || []).find(
        (entry) => entry.validation?.valid && entry.workingDirectoryPath,
      );
      if (validMapping?.workingDirectoryPath) {
        resolvedWorkingDirectory = validMapping.workingDirectoryPath;
        resolvedWorkingDirectorySource = 'mapping';
      }
    } catch {
      // Control plane unreachable or permission denied — fall through to
      // env / project-root fallbacks below.
    }
  }
  if (!resolvedWorkingDirectory) {
    const envWorkingDir =
      process.env.SINGULARITY_WORKING_DIRECTORY?.trim() ||
      process.env.WORKING_DIRECTORY?.trim() ||
      '';
    if (envWorkingDir) {
      resolvedWorkingDirectory = envWorkingDir;
      resolvedWorkingDirectorySource = 'env';
    } else if (projectRoot) {
      resolvedWorkingDirectory = projectRoot;
      resolvedWorkingDirectorySource = 'project-root';
    }
  }

  return {
    configured,
    provider: selectedProvider?.label || 'Desktop runtime',
    providerKey: selectedProvider?.key,
    readinessState: deriveReadinessState(checks),
    checks,
    controlPlaneUrl,
    desktopExecutorId: executorId,
    desktopId,
    desktopHostname,
    workingDirectory: resolvedWorkingDirectory,
    workingDirectorySource: resolvedWorkingDirectorySource,
    runtimeOwner: 'DESKTOP',
    executionRuntimeOwner: 'DESKTOP',
    executorId,
    executorHeartbeatAt,
    executorHeartbeatStatus,
    actorUserId: activeActorContext?.userId,
    actorDisplayName: activeActorContext?.displayName,
    ownedCapabilityIds: executorOwnedCapabilityIds,
    endpoint: selectedProvider?.endpoint || githubModelsApiUrl,
    tokenSource,
    defaultModel: runtimeDefaultModel,
    modelCatalogSource: fromRuntime ? 'runtime' : 'fallback',
    runtimeAccessMode: resolveRuntimeAccessMode({
      providerKey: selectedProvider?.key,
      tokenSource,
      token,
      modelCatalogFromRuntime: fromRuntime,
    }),
    databaseRuntime: controlPlaneRuntimeStatus.databaseRuntime,
    activeDatabaseProfileId: controlPlaneRuntimeStatus.activeDatabaseProfileId ?? null,
    activeDatabaseProfileLabel: controlPlaneRuntimeStatus.activeDatabaseProfileLabel ?? null,
    httpFallbackEnabled: process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK === 'true',
    embeddingProviderKey: embeddingConfigured ? 'local-openai' : 'deterministic-hash',
    embeddingConfigured,
    retrievalMode:
      controlPlaneRuntimeStatus.retrievalMode ||
      controlPlaneRuntimeStatus.databaseRuntime?.retrievalMode,
    fallbackReason:
      controlPlaneRuntimeStatus.fallbackReason ||
      controlPlaneRuntimeStatus.databaseRuntime?.fallbackReason ||
      null,
    embeddingEndpoint: getLocalOpenAIBaseUrl() || null,
    embeddingModel: embeddingConfigured ? getLocalOpenAIEmbeddingModel() : null,
    embeddingApiKeyConfigured: Boolean(
      String(process.env.LOCAL_OPENAI_API_KEY || process.env.OPENAI_COMPAT_API_KEY || '').trim(),
    ),
    lastRuntimeError: identityResult.error,
    lastExecutorDispatchState: lastExecutorDispatchOutcome?.state,
    lastExecutorDispatchReason: lastExecutorDispatchOutcome?.reason || null,
    lastExecutorDispatchAt: lastExecutorDispatchOutcome?.at || null,
    streaming: true,
    githubIdentity: identityResult.identity,
    githubIdentityError: identityResult.error,
    platformFeatures: {
      pgvectorAvailable: false,
      memoryEmbeddingDimensions: 64,
    },
    availableModels: models,
    availableProviders: providerStatuses,
  };
};

const resolveRuntimeProviderTarget = async (providerKey?: string | null) => {
  const providerStatuses = await listRuntimeProviderStatuses();
  const matchedProvider = providerStatuses.find(status => status.key === providerKey);
  return {
    runtimeEndpoint: matchedProvider?.endpoint || null,
    runtimeCommand: matchedProvider?.command || null,
  };
};

reader.on('line', async line => {
  if (!line.trim()) {
    return;
  }

  let message: {
    type?: string;
    requestId?: string;
    payload?: Record<string, unknown>;
  };

  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  const requestId = message.requestId;
  if (!requestId || !message.type) {
    return;
  }

  try {
    if (message.type === 'worker:ping') {
      respond({
        requestId,
        payload: {
          status: 'ready',
          pid: process.pid,
          platform: process.platform,
          cwd: process.cwd(),
          homedir: process.env.HOME || '',
          controlPlaneUrl: process.env.SINGULARITY_CONTROL_PLANE_URL || '',
          projectRoot: process.env.SINGULARITY_PROJECT_ROOT || '',
          timestamp: new Date().toISOString(),
          versions: {
            node: process.versions.node,
          },
        },
      });
      return;
    }

    if (message.type === 'runtime:chat-stream:cancel') {
      const streamId = String(message.payload?.streamId || '').trim();
      if (streamId) {
        cancelledRuntimeStreamIds.add(streamId);
      }
      respond({
        requestId,
        streamId: streamId || undefined,
        payload: {
          cancelled: Boolean(streamId),
        },
      });
      return;
    }

    if (message.type === 'runtime:status') {
      adoptActorContext(
        (message.payload?.actorContext as ActorContext | null | undefined) ||
          null,
        {
        source: 'runtime:status',
        },
      );
      respond({
        requestId,
        payload: await buildDesktopRuntimeStatus(),
      });
      return;
    }

    if (message.type === 'runtime:actor-context') {
      const actorWasAdopted = adoptActorContext(
        (message.payload?.actor as ActorContext | null | undefined) || null,
        {
          source: 'runtime:actor-context',
        },
      );
      if (!actorWasAdopted) {
        activeActorContext = null;
        executorHeartbeatStatus = 'OFFLINE';
        executorHeartbeatAt = undefined;
        executorOwnedCapabilityIds = [];
      }

      respond({
        requestId,
        payload: {
          ok: true,
          actorUserId: activeActorContext?.userId,
          actorDisplayName: activeActorContext?.displayName,
          executorId,
          executorHeartbeatStatus,
        },
      });
      return;
    }

    if (message.type === 'runtime:set-token') {
      await persistRuntimeTokenAndValidate({
        token: String(message.payload?.token || ''),
        envFilePath: envLocalPath,
      });
      respond({
        requestId,
        payload: await buildDesktopRuntimeStatus(),
      });
      return;
    }

    if (message.type === 'runtime:clear-token') {
      await clearPersistedRuntimeToken({
        envFilePath: envLocalPath,
      });
      respond({
        requestId,
        payload: await buildDesktopRuntimeStatus(),
      });
      return;
    }

    if (message.type === 'runtime:providers:list') {
      respond({
        requestId,
        payload: await listRuntimeProviderStatuses(),
      });
      return;
    }

    if (message.type === 'runtime:providers:config:set') {
      const providerKey = String(message.payload?.providerKey || '').trim() as ProviderKey;
      const config = (message.payload?.config || {}) as RuntimeProviderConfig;
      const setDefault = Boolean(message.payload?.setDefault);
      const clearDefault = Boolean(message.payload?.clearDefault);

      const provider = await saveConfiguredRuntimeProvider({
        providerKey,
        config,
        setDefault,
      });

      if (clearDefault) {
        await selectDefaultRuntimeProvider({
          providerKey: undefined,
        }).catch(() => undefined);
      }

      respond({
        requestId,
        payload: {
          provider,
          providers: await listRuntimeProviderStatuses(),
        },
      });
      return;
    }

    if (message.type === 'runtime:providers:validate') {
      const providerKey = String(message.payload?.providerKey || '').trim() as ProviderKey;
      respond({
        requestId,
        payload: await validateRuntimeProviderStatus({
          providerKey,
          config: (message.payload?.config || undefined) as RuntimeProviderConfig | undefined,
        }),
      });
      return;
    }

    if (message.type === 'runtime:providers:probe') {
      const providerKey = String(message.payload?.providerKey || '').trim() as ProviderKey;
      respond({
        requestId,
        payload: await probeRuntimeProvider({
          providerKey,
          endpointHint: String(message.payload?.endpointHint || '').trim() || undefined,
          commandHint: String(message.payload?.commandHint || '').trim() || undefined,
          modelHint: String(message.payload?.modelHint || '').trim() || undefined,
        }),
      });
      return;
    }

    if (message.type === 'runtime:providers:models') {
      const providerKey = String(message.payload?.providerKey || '').trim() as ProviderKey;
      respond({
        requestId,
        payload: await getRuntimeProviderModels(providerKey),
      });
      return;
    }

    if (message.type === 'runtime:set-embedding-config') {
      await persistLocalEmbeddingSettingsAndValidate({
        baseUrl: String(message.payload?.baseUrl || ''),
        apiKey: String(message.payload?.apiKey || ''),
        model: String(message.payload?.model || ''),
        envFilePath: envLocalPath,
      });
      respond({
        requestId,
        payload: await buildDesktopRuntimeStatus(),
      });
      return;
    }

    if (message.type === 'runtime:clear-embedding-config') {
      await clearPersistedLocalEmbeddingSettings({
        envFilePath: envLocalPath,
      });
      respond({
        requestId,
        payload: await buildDesktopRuntimeStatus(),
      });
      return;
    }

    if (message.type === 'runtime:preferences:get') {
      // Return the stored preferences from the control plane.
      try {
        const raw = await fetch(`${controlPlaneUrl}/api/runtime/desktop-preferences`, {
          headers: { 'x-desktop-hostname': desktopHostname },
          signal: AbortSignal.timeout(15_000),
        });
        const prefs = raw.ok ? await raw.json() : null;
        respond({ requestId, payload: prefs });
      } catch (error) {
        respond({ requestId, payload: null });
      }
      return;
    }

    if (message.type === 'runtime:preferences:set') {
      // Save preferences to the control plane DB and apply to this worker.
      try {
        const body = {
          hostname: desktopHostname,
          ...(message.payload || {}),
        };
        const raw = await fetch(`${controlPlaneUrl}/api/runtime/desktop-preferences`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
        if (!raw.ok) {
          const err = await raw.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error((err as any).error || 'Failed to save preferences');
        }
        const saved = await raw.json();
        // Apply to this worker process.
        if (saved.copilotCliUrl) process.env.COPILOT_CLI_URL = saved.copilotCliUrl;
        if (saved.allowHttpFallback !== undefined) {
          process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK = saved.allowHttpFallback ? 'true' : 'false';
        }
        if (saved.embeddingBaseUrl) process.env.LOCAL_OPENAI_BASE_URL = saved.embeddingBaseUrl;
        if (saved.embeddingModel) process.env.LOCAL_OPENAI_EMBEDDING_MODEL = saved.embeddingModel;
        if (saved.executorId) {
          executorId = saved.executorId;
          process.env.SINGULARITY_DESKTOP_EXECUTOR_ID = saved.executorId;
        }
        respond({ requestId, payload: { saved, status: await buildDesktopRuntimeStatus() } });
      } catch (error) {
        respond({
          requestId,
          error: error instanceof Error ? error.message : 'Failed to save preferences',
        });
      }
      return;
    }

    if (message.type === 'runtime:chat') {
      // Always-visible entry log via stderr — bypasses the IPC pipe so
      // operators can see chat activity even before any provider call.
      process.stderr.write(`[chat:enter] runtime:chat (non-stream) requestId=${message.requestId}\n`);
      const payload = message.payload || {};
      if (!payload.message || !payload.capability || !payload.agent) {
        throw new Error('Capability, agent, and message are required.');
      }
      adoptActorContext(
        (payload.actorContext as ActorContext | null | undefined) || null,
        {
          source: 'runtime:chat',
        },
      );

      let context = await resolveDesktopRuntimeContext(payload as DesktopRuntimePayload);
      if (context.chatAction?.handled) {
        if (context.chatAction.wakeWorker && activeActorContext?.userId) {
          await syncExecutorRegistration().catch(() => undefined);
          ensureDesktopExecutorLoop();
        }
        respond({
          requestId,
          payload: {
            content:
              context.chatAction.content ||
              'The workspace request completed, but there was no additional message to show.',
            model: 'workspace-control',
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              estimatedCostUsd: 0,
            },
            responseId: null,
            createdAt: new Date().toISOString(),
            sessionMode: (payload.sessionMode as 'resume' | 'fresh') || 'resume',
            memoryReferences: [],
            effectiveMessage: context.effectiveMessage,
            effectiveMessageSource: context.effectiveMessageSource,
            followUpIntent: context.followUpIntent,
            historyTurnCount: context.historyTurnCount,
            historyRolledUp: false,
            workContextHydrated: context.workContextHydrated,
            workContextSource: context.workContextSource,
            sessionMemoryUsed: context.sessionMemoryUsed,
            sessionMemorySource: context.sessionMemorySource,
            followUpBindingMode: context.followUpBindingMode,
            chatRuntimeLane: 'desktop-runtime-worker',
            contextEnvelopeSource: 'shared-chat-envelope',
          },
        });
        return;
      }
      context = await maybeBootstrapReadOnlyRuntimeContext(
        payload as DesktopRuntimePayload,
        context,
      );
      const runtimeStatus = await buildDesktopRuntimeStatus();
      if (!runtimeStatus.configured) {
        throw new Error(getMissingRuntimeConfigurationMessage());
      }

      const result = await runWithExecutionClientContext(
        {
          controlPlaneUrl,
          executorId,
          actor: activeActorContext,
        },
        () =>
          invokeCommonAgentRuntime({
            capability: context.bundle?.capability || context.capability,
            agent: context.agent,
            history: context.history,
            message: context.effectiveMessage,
            developerPrompt:
              context.developerPrompt || (payload.developerPrompt as string | undefined),
            memoryPrompt: context.memoryPrompt || (payload.memoryPrompt as string | undefined),
            scope: context.scope,
            scopeId: context.scopeId,
            resetSession: payload.sessionMode === 'fresh',
            workItem: context.workItem,
            preferReadOnlyToolLoop: context.isCodeQuestion,
            allowedToolIds: context.resolvedAllowedToolIds,
            resolvedAgentSource: context.resolvedAgentSource,
            runtimeLane: 'desktop-runtime-worker',
          }),
      );
      // ── Post-LLM diagnostics (non-streaming) ────────────────────────────
      console.log(`\n[chat:llm] ══════ LLM RESULT (non-stream) ══════`);
      console.log(`[chat:llm]   contentLength:    ${(result.content || '').length}`);
      console.log(`[chat:llm]   content:`);
      console.log(result.content || '');
      console.log(`[chat:llm]   toolLoopUsed:     ${result.toolLoopUsed}`);
      console.log(`[chat:llm]   attemptedToolIds: ${(result.attemptedToolIds || []).join(', ') || 'NONE'}`);
      console.log(`[chat:llm]   model:            ${result.model || 'unknown'}`);
      // ────────────────────────────────────────────────────────────────────

      const runtimeTarget = await resolveRuntimeProviderTarget(result.runtimeProviderKey);
      const enforceEvidenceOnlyNonStream = context.memoryTrustMode === 'repo-evidence-only';
      const sanitizedResult = await sanitizeGroundedChatResponse({
        content: result.content || '',
        checkoutPath: context.checkoutPath,
        verifiedPaths: context.verifiedPaths,
        enforceEvidenceOnly: enforceEvidenceOnlyNonStream,
      });

      // ── Post-sanitize diagnostics (non-streaming) ────────────────────────
      console.log(`\n[chat:sanitize] ══════ SANITIZE (non-stream) ══════`);
      console.log(`[chat:sanitize]   runtimeProviderKey:  ${result.runtimeProviderKey || 'unknown'}`);
      console.log(`[chat:sanitize]   runtimeEndpoint:     ${runtimeTarget.runtimeEndpoint || 'unknown'}`);
      console.log(`[chat:sanitize]   runtimeCommand:      ${runtimeTarget.runtimeCommand || 'none'}`);
      console.log(`[chat:sanitize]   enforceEvidenceOnly: ${enforceEvidenceOnlyNonStream}`);
      console.log(`[chat:sanitize]   contentBefore:       ${(result.content || '').length} chars`);
      console.log(`[chat:sanitize]   contentAfter:        ${sanitizedResult.content.length} chars`);
      console.log(`[chat:sanitize]   finalReply:`);
      console.log(sanitizedResult.content);
      if (!sanitizedResult.content.trim() && (result.content || '').trim()) {
        console.error(`[chat:sanitize] ❌ CONTENT WIPED — enforceEvidenceOnly=${enforceEvidenceOnlyNonStream}, checkoutPath=${context.checkoutPath || 'NONE'}`);
      }
      // ────────────────────────────────────────────────────────────────────

      respond({
        requestId,
        payload: {
          ...result,
          ...runtimeTarget,
          content: sanitizedResult.content,
          effectiveMessage: context.effectiveMessage,
          effectiveMessageSource: context.effectiveMessageSource,
          followUpIntent: context.followUpIntent,
          astGroundingMode: context.astGroundingMode,
          checkoutPath: context.checkoutPath,
          branchName: context.branchName,
          codeIndexSource: context.codeIndexSource,
          codeIndexFreshness: context.codeIndexFreshness,
          groundingEvidenceSource: context.groundingEvidenceSource,
          memoryTrustMode: context.memoryTrustMode,
          pathValidationState: sanitizedResult.pathValidationState,
          unverifiedPathClaimsRemoved: sanitizedResult.unverifiedPathClaimsRemoved,
          historyTurnCount: result.historyTurnCount || context.historyTurnCount,
          historyRolledUp: Boolean(result.historyRolledUp),
          workContextHydrated: context.workContextHydrated,
          workContextSource: context.workContextSource,
          sessionMemoryUsed: context.sessionMemoryUsed,
          sessionMemorySource: context.sessionMemorySource,
          followUpBindingMode: context.followUpBindingMode,
          chatRuntimeLane: 'desktop-runtime-worker',
          contextEnvelopeSource: 'shared-chat-envelope',
          toolLoopEnabled: result.toolLoopEnabled,
          toolLoopReason: result.toolLoopReason,
          toolLoopUsed: result.toolLoopUsed,
          attemptedToolIds: result.attemptedToolIds,
          resolvedAllowedToolIds: result.resolvedAllowedToolIds || context.resolvedAllowedToolIds,
          resolvedAgentSource: result.resolvedAgentSource || context.resolvedAgentSource,
          parsedToolIntent: result.parsedToolIntent,
          toolIntentDisposition: result.toolIntentDisposition,
          toolIntentRejectionReason: result.toolIntentRejectionReason,
          codeDiscoveryMode: result.codeDiscoveryMode,
          codeDiscoveryFallback: result.codeDiscoveryFallback,
          astSource: result.astSource,
        },
      });
      return;
    }

    if (message.type === 'runtime:execution:claim') {
      const capabilityId = String(message.payload?.capabilityId || '').trim();
      if (!capabilityId) {
        throw new Error('capabilityId is required.');
      }
      if (!activeActorContext?.userId) {
        throw new Error('Select a workspace operator before claiming desktop execution.');
      }
      await syncExecutorRegistration();
      ensureDesktopExecutorLoop();

      const result = await controlPlaneRequest<{
        ownership: unknown;
      }>(`/api/capabilities/${encodeURIComponent(capabilityId)}/execution/claim`, {
        method: 'POST',
        actorContext: activeActorContext,
        body: {
          executorId,
          forceTakeover: Boolean(message.payload?.forceTakeover),
        },
      });

      await syncExecutorRegistration().catch(() => undefined);
      respond({
        requestId,
        payload: result,
      });
      return;
    }

    if (message.type === 'runtime:execution:release') {
      const capabilityId = String(message.payload?.capabilityId || '').trim();
      if (!capabilityId) {
        throw new Error('capabilityId is required.');
      }
      if (!activeActorContext?.userId) {
        throw new Error('Select a workspace operator before releasing desktop execution.');
      }

      const response = await fetch(
        new URL(
          `/api/capabilities/${encodeURIComponent(capabilityId)}/execution/claim?executorId=${encodeURIComponent(executorId)}`,
          `${controlPlaneUrl}/`,
        ),
        {
          method: 'DELETE',
          headers: withActorHeaders(activeActorContext),
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!response.ok) {
        let errorMessage = `Control plane request failed with status ${response.status}.`;
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) {
            errorMessage = payload.error;
          }
        } catch {
          // ignore
        }
        throw new Error(errorMessage);
      }

      executorOwnedCapabilityIds = executorOwnedCapabilityIds.filter(id => id !== capabilityId);
      await syncExecutorRegistration().catch(() => undefined);
      respond({
        requestId,
        payload: { ok: true },
      });
      return;
    }

    if (message.type === 'runtime:chat-stream') {
      // Always-visible entry log via stderr — bypasses the IPC pipe so
      // operators can see chat-stream activity even before any provider call.
      process.stderr.write(`[chat:enter] runtime:chat-stream requestId=${message.requestId}\n`);
      const payload = message.payload || {};
      const streamId = String(payload.streamId || randomUUID());
      cancelledRuntimeStreamIds.delete(streamId);
      if (!payload.message || !payload.capability || !payload.agent) {
        throw new Error('Capability, agent, and message are required.');
      }
      adoptActorContext(
        (payload.actorContext as ActorContext | null | undefined) || null,
        {
          source: 'runtime:chat-stream',
        },
      );

      let context = await resolveDesktopRuntimeContext(payload as DesktopRuntimePayload);
      throwIfRuntimeStreamCancelled(streamId);

      sendStreamEvent(streamId, {
        type: 'start',
        traceId: randomUUID(),
        createdAt: new Date().toISOString(),
        sessionMode: (payload.sessionMode as 'resume' | 'fresh') || 'resume',
      });
      if (context.chatAction?.handled) {
        throwIfRuntimeStreamCancelled(streamId);
        if (context.chatAction.wakeWorker && activeActorContext?.userId) {
          await syncExecutorRegistration().catch(() => undefined);
          ensureDesktopExecutorLoop();
        }
        sendStreamEvent(streamId, {
          type: 'complete',
          content:
            context.chatAction.content ||
            'The workspace request completed, but there was no additional message to show.',
          createdAt: new Date().toISOString(),
          model: 'workspace-control',
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
          },
          sessionMode: (payload.sessionMode as 'resume' | 'fresh') || 'resume',
          memoryReferences: [],
          effectiveMessage: context.effectiveMessage,
          effectiveMessageSource: context.effectiveMessageSource,
          followUpIntent: context.followUpIntent,
          historyTurnCount: context.historyTurnCount,
          historyRolledUp: false,
          workContextHydrated: context.workContextHydrated,
          workContextSource: context.workContextSource,
          sessionMemoryUsed: context.sessionMemoryUsed,
          sessionMemorySource: context.sessionMemorySource,
          followUpBindingMode: context.followUpBindingMode,
          chatRuntimeLane: 'desktop-runtime-worker',
          contextEnvelopeSource: 'shared-chat-envelope',
        });
        respond({
          requestId,
          streamId,
          payload: {
            ok: true,
          },
        });
        return;
      }
      context = await maybeBootstrapReadOnlyRuntimeContext(
        payload as DesktopRuntimePayload,
        context,
      );
      throwIfRuntimeStreamCancelled(streamId);

      // ── Chat-stream context diagnostics ─────────────────────────────────
      console.log(`\n[chat-stream:context] ══════ CONTEXT RESOLVED ══════`);
      console.log(`[chat-stream:context]   streamId:          ${streamId}`);
      console.log(`[chat-stream:context]   contextMode:       ${payload.contextMode || 'GENERAL'}`);
      console.log(`[chat-stream:context]   scope:             ${context.scope} / ${context.scopeId || 'none'}`);
      console.log(`[chat-stream:context]   isCodeQuestion:    ${context.isCodeQuestion}`);
      console.log(`[chat-stream:context]   memoryTrustMode:   ${context.memoryTrustMode}`);
      console.log(`[chat-stream:context]   allowedToolIds:    ${context.resolvedAllowedToolIds.join(', ') || 'NONE'}`);
      console.log(`[chat-stream:context]   checkoutPath:      ${context.checkoutPath || 'NONE'}`);
      console.log(`[chat-stream:context]   verifiedPaths:     ${context.verifiedPaths?.length ?? 0} paths`);
      console.log(`[chat-stream:context]   workContextSource: ${context.workContextSource}`);
      console.log(`[chat-stream:context]   workContextHydrated: ${context.workContextHydrated}`);
      console.log(`[chat-stream:context]   agentId:           ${context.agent?.id || 'none'}`);
      console.log(`[chat-stream:context]   capabilityId:      ${(context.bundle?.capability || context.capability)?.id || 'none'}`);
      console.log(`[chat-stream:context]   effectiveMessage:  ${context.effectiveMessage.slice(0, 200)}`);
      // ────────────────────────────────────────────────────────────────────

      const runtimeStatus = await buildDesktopRuntimeStatus();
      if (!runtimeStatus.configured) {
        throw new Error(getMissingRuntimeConfigurationMessage());
      }
      throwIfRuntimeStreamCancelled(streamId);
      sendStreamEvent(streamId, {
        type: 'memory',
        memoryReferences: context.memoryReferences,
        effectiveMessage: context.effectiveMessage,
        effectiveMessageSource: context.effectiveMessageSource,
        followUpIntent: context.followUpIntent,
        groundingEvidenceSource: context.groundingEvidenceSource,
        memoryTrustMode: context.memoryTrustMode,
        historyTurnCount: context.historyTurnCount,
        historyRolledUp: false,
        workContextHydrated: context.workContextHydrated,
        workContextSource: context.workContextSource,
        sessionMemoryUsed: context.sessionMemoryUsed,
        sessionMemorySource: context.sessionMemorySource,
        followUpBindingMode: context.followUpBindingMode,
        chatRuntimeLane: 'desktop-runtime-worker',
        contextEnvelopeSource: 'shared-chat-envelope',
        toolLoopEnabled:
          context.isCodeQuestion && context.resolvedAllowedToolIds.length > 0,
        toolLoopReason: context.isCodeQuestion
          ? context.resolvedAllowedToolIds.length > 0
            ? 'repo-aware-code-question'
            : 'no-read-only-tools'
          : 'disabled-by-caller',
        toolLoopUsed: false,
        attemptedToolIds: [],
        resolvedAllowedToolIds: context.resolvedAllowedToolIds,
        resolvedAgentSource: context.resolvedAgentSource,
        toolIntentDisposition: 'none',
        codeDiscoveryMode: 'prompt-only',
        codeDiscoveryFallback: 'none',
        astSource: 'none',
      });
      const shouldBufferValidatedStream =
        Boolean(context.isCodeQuestion);

      const streamed = await runWithExecutionClientContext(
        {
          controlPlaneUrl,
          executorId,
          actor: activeActorContext,
        },
        () =>
          invokeCommonAgentRuntime({
            capability: context.bundle?.capability || context.capability,
            agent: context.agent,
            history: context.history,
            message: context.effectiveMessage,
            developerPrompt:
              context.developerPrompt || (payload.developerPrompt as string | undefined),
            memoryPrompt: context.memoryPrompt || (payload.memoryPrompt as string | undefined),
            scope: context.scope,
            scopeId: context.scopeId,
            resetSession: payload.sessionMode === 'fresh',
            workItem: context.workItem,
            preferReadOnlyToolLoop: context.isCodeQuestion,
            allowedToolIds: context.resolvedAllowedToolIds,
            resolvedAgentSource: context.resolvedAgentSource,
            runtimeLane: 'desktop-runtime-worker',
            shouldCancel: () => isRuntimeStreamCancelled(streamId),
            onDelta: delta => {
              if (isRuntimeStreamCancelled(streamId)) {
                return;
              }
              if (!shouldBufferValidatedStream) {
                sendStreamEvent(streamId, {
                  type: 'delta',
                  content: delta,
                });
              }
            },
          }),
      );
      throwIfRuntimeStreamCancelled(streamId);

      // ── Post-LLM diagnostics ─────────────────────────────────────────────
      console.log(`\n[chat-stream:llm] ══════ LLM RESULT ══════`);
      console.log(`[chat-stream:llm]   contentLength:       ${(streamed.content || '').length}`);
      console.log(`[chat-stream:llm]   content:`);
      console.log(streamed.content || '');
      console.log(`[chat-stream:llm]   toolLoopUsed:        ${streamed.toolLoopUsed}`);
      console.log(`[chat-stream:llm]   attemptedToolIds:    ${(streamed.attemptedToolIds || []).join(', ') || 'NONE'}`);
      console.log(`[chat-stream:llm]   toolIntentDisposition: ${streamed.toolIntentDisposition || 'none'}`);
      console.log(`[chat-stream:llm]   model:               ${streamed.model || 'unknown'}`);
      console.log(`[chat-stream:llm]   promptTokens:        ${streamed.usage?.promptTokens ?? 0}`);
      console.log(`[chat-stream:llm]   completionTokens:    ${streamed.usage?.completionTokens ?? 0}`);
      // ────────────────────────────────────────────────────────────────────

      const runtimeTarget = await resolveRuntimeProviderTarget(streamed.runtimeProviderKey);
      const enforceEvidenceOnly = context.memoryTrustMode === 'repo-evidence-only';
      const sanitizedStream = await sanitizeGroundedChatResponse({
        content: streamed.content || '',
        checkoutPath: context.checkoutPath,
        verifiedPaths: context.verifiedPaths,
        enforceEvidenceOnly,
      });

      // ── Post-sanitize diagnostics ────────────────────────────────────────
      console.log(`\n[chat-stream:sanitize] ══════ SANITIZE RESULT ══════`);
      console.log(`[chat-stream:sanitize]   runtimeProviderKey:          ${streamed.runtimeProviderKey || 'unknown'}`);
      console.log(`[chat-stream:sanitize]   runtimeEndpoint:             ${runtimeTarget.runtimeEndpoint || 'unknown'}`);
      console.log(`[chat-stream:sanitize]   runtimeCommand:              ${runtimeTarget.runtimeCommand || 'none'}`);
      console.log(`[chat-stream:sanitize]   enforceEvidenceOnly:         ${enforceEvidenceOnly}`);
      console.log(`[chat-stream:sanitize]   checkoutPath:                ${context.checkoutPath || 'NONE'}`);
      console.log(`[chat-stream:sanitize]   verifiedPaths:               ${context.verifiedPaths?.length ?? 0}`);
      console.log(`[chat-stream:sanitize]   pathValidationState:         ${sanitizedStream.pathValidationState}`);
      console.log(`[chat-stream:sanitize]   unverifiedClaimsRemoved:     ${sanitizedStream.unverifiedPathClaimsRemoved.length}`);
      console.log(`[chat-stream:sanitize]   contentBefore:               ${(streamed.content || '').length} chars`);
      console.log(`[chat-stream:sanitize]   contentAfter:                ${sanitizedStream.content.length} chars`);
      console.log(`[chat-stream:sanitize]   finalReply:`);
      console.log(sanitizedStream.content);
      if (sanitizedStream.unverifiedPathClaimsRemoved.length > 0) {
        console.warn(`[chat-stream:sanitize] ⚠️  STRIPPED unverified paths:`, sanitizedStream.unverifiedPathClaimsRemoved.slice(0, 10));
      }
      if (!sanitizedStream.content.trim() && (streamed.content || '').trim()) {
        console.error(`[chat-stream:sanitize] ❌ CONTENT WIPED BY SANITIZER — enforceEvidenceOnly=${enforceEvidenceOnly}, checkoutPath=${context.checkoutPath || 'NONE'}`);
      }
      // ────────────────────────────────────────────────────────────────────

      throwIfRuntimeStreamCancelled(streamId);

      const completeEvent: ChatStreamEvent = {
        type: 'complete',
        content: sanitizedStream.content,
        createdAt: streamed.createdAt,
        model: streamed.model,
        usage: streamed.usage,
        runtimeProviderKey: streamed.runtimeProviderKey,
        runtimeTransportMode: streamed.runtimeTransportMode,
        ...runtimeTarget,
        sessionId: streamed.sessionId,
        sessionScope: streamed.sessionScope,
        sessionScopeId: streamed.sessionScopeId,
        isNewSession: streamed.isNewSession,
        sessionMode: (payload.sessionMode as 'resume' | 'fresh') || 'resume',
        memoryReferences: context.memoryReferences,
        effectiveMessage: context.effectiveMessage,
        effectiveMessageSource: context.effectiveMessageSource,
        followUpIntent: context.followUpIntent,
        groundingEvidenceSource: context.groundingEvidenceSource,
        memoryTrustMode: context.memoryTrustMode,
        pathValidationState: sanitizedStream.pathValidationState,
        unverifiedPathClaimsRemoved: sanitizedStream.unverifiedPathClaimsRemoved,
        historyTurnCount: streamed.historyTurnCount || context.historyTurnCount,
        historyRolledUp: Boolean(streamed.historyRolledUp),
        workContextHydrated: context.workContextHydrated,
        workContextSource: context.workContextSource,
        sessionMemoryUsed: context.sessionMemoryUsed,
        sessionMemorySource: context.sessionMemorySource,
        followUpBindingMode: context.followUpBindingMode,
        chatRuntimeLane: 'desktop-runtime-worker',
        contextEnvelopeSource: 'shared-chat-envelope',
        toolLoopEnabled: streamed.toolLoopEnabled,
        toolLoopReason: streamed.toolLoopReason,
        toolLoopUsed: streamed.toolLoopUsed,
        attemptedToolIds: streamed.attemptedToolIds,
        resolvedAllowedToolIds:
          streamed.resolvedAllowedToolIds || context.resolvedAllowedToolIds,
        resolvedAgentSource: streamed.resolvedAgentSource || context.resolvedAgentSource,
        parsedToolIntent: streamed.parsedToolIntent,
        toolIntentDisposition: streamed.toolIntentDisposition,
        toolIntentRejectionReason: streamed.toolIntentRejectionReason,
        codeDiscoveryMode: streamed.codeDiscoveryMode,
        codeDiscoveryFallback: streamed.codeDiscoveryFallback,
        astSource: streamed.astSource,
      };
      if (shouldBufferValidatedStream && sanitizedStream.content) {
        sendStreamEvent(streamId, {
          type: 'delta',
          content: sanitizedStream.content,
        });
      }
      sendStreamEvent(streamId, completeEvent);

      respond({
        requestId,
        streamId,
        payload: {
          ok: true,
        },
      });
      cancelledRuntimeStreamIds.delete(streamId);
      return;
    }

    respond({
      requestId,
      error: `Unsupported worker request: ${message.type}`,
    });
  } catch (error) {
    // Always-visible diagnostic via stderr — covers the case where chat
    // (stream or non-stream) throws before any LLM call. Stack trace
    // included so the operator can see WHERE the failure happened
    // without enabling verbose logging.
    process.stderr.write(
      `[chat:error] type=${message?.type} requestId=${message?.requestId} ` +
        `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );

    if (message.type === 'runtime:chat-stream') {
      const streamId = String(message.payload?.streamId || randomUUID());
      if (error instanceof Error && error.name === 'AbortError') {
        cancelledRuntimeStreamIds.delete(streamId);
        respond({
          requestId,
          streamId,
          payload: {
            cancelled: true,
          },
        });
        return;
      }
      sendStreamEvent(streamId, {
        type: 'error',
        error:
          error instanceof Error
            ? error.message
            : 'The desktop runtime could not complete this stream.',
      });
      respond({
        requestId,
        streamId,
        error:
          error instanceof Error
            ? error.message
            : 'The desktop runtime could not complete this stream.',
      });
      cancelledRuntimeStreamIds.delete(streamId);
      return;
    }

    respond({
      requestId,
      error:
        error instanceof Error ? error.message : 'The desktop worker request failed.',
    });
  }
});
