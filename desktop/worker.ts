import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  buildCapabilityBriefing,
  buildCapabilityBriefingPrompt,
} from '../src/lib/capabilityBriefing';
import type {
  ActorContext,
  Capability,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityWorkspace,
  ChatStreamEvent,
  ExecutionLog,
  ExecutorHeartbeatStatus,
  MemoryReference,
  MemorySearchResult,
  Workflow,
  WorkflowRun,
  WorkflowRunDetail,
  WorkItem,
  WorkItemExplainDetail,
} from '../src/types';
import type { RuntimeStatus } from '../src/lib/api';
import {
  clearRuntimeTokenOverride,
  defaultModel,
  getConfiguredGitHubIdentity,
  getConfiguredToken,
  getConfiguredTokenSource,
  getRuntimeDefaultModel,
  githubModelsApiUrl,
  invokeCapabilityChat,
  invokeCapabilityChatStream,
  listAvailableRuntimeModels,
  normalizeModel,
  setRuntimeTokenOverride,
} from '../server/githubModels';
import {
  getMissingRuntimeConfigurationMessage,
  resolveRuntimeAccessMode,
} from '../server/runtimePolicy';
import { getLifecyclePhaseLabel } from '../src/lib/capabilityLifecycle';
import {
  buildFocusedWorkItemDeveloperPrompt,
  extractChatWorkspaceReferenceId,
  resolveMentionedWorkItem,
} from '../server/chatWorkspace';
import { processWorkflowRun, reconcileWorkflowRunFailure } from '../server/execution/service';
import { getWorkflowRunDetail } from '../server/execution/repository';
import { runWithExecutionClientContext } from '../server/execution/runtimeClient';

const projectRoot = process.env.SINGULARITY_PROJECT_ROOT || process.cwd();
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
const executorId = `desktop-executor-${process.pid}-${randomUUID().slice(0, 8)}`;

let activeActorContext: ActorContext | null = null;
let executorHeartbeatAt: string | undefined;
let executorHeartbeatStatus: ExecutorHeartbeatStatus = 'OFFLINE';
let executorOwnedCapabilityIds: string[] = [];
let executorApprovedWorkspaceRoots: Record<string, string[]> = {};
let executorLoopTimer: NodeJS.Timeout | null = null;
let executorTickInFlight = false;

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
  },
): Promise<T> => {
  const response = await fetch(new URL(path, `${controlPlaneUrl}/`), {
    method: options?.method || 'GET',
    headers: withActorHeaders(options?.actorContext),
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

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
  const headlessCli = tokenSource === 'headless-cli';
  return {
    provider: 'GitHub Copilot SDK (Desktop Worker)',
    endpoint: headlessCli ? process.env.COPILOT_CLI_URL || githubModelsApiUrl : githubModelsApiUrl,
    defaultModel: token ? await getRuntimeDefaultModel() : normalizeModel(defaultModel),
    runtimeAccessMode: resolveRuntimeAccessMode({
      tokenSource,
      token,
      modelCatalogFromRuntime: false,
    }),
  };
};

const syncExecutorRegistration = async () => {
  if (!activeActorContext?.userId) {
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
      const heartbeat = setInterval(() => {
        void heartbeatActiveRun(run).catch(() => undefined);
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
  if (executorTickInFlight || !activeActorContext?.userId) {
    return;
  }

  executorTickInFlight = true;
  try {
    await syncExecutorRegistration();

    const runtimeStatus = await buildDesktopRuntimeStatus();
    if (!runtimeStatus.configured) {
      return;
    }

    if (executorOwnedCapabilityIds.length === 0) {
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
      return;
    }

    await executeClaimedRun(claimResult.run);
  } finally {
    executorTickInFlight = false;
  }
};

const ensureDesktopExecutorLoop = () => {
  if (executorLoopTimer) {
    return;
  }

  executorLoopTimer = setInterval(() => {
    void tickDesktopExecutor().catch(() => undefined);
  }, EXECUTOR_POLL_MS);
  void tickDesktopExecutor().catch(() => undefined);
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

const resolveDesktopRuntimeContext = async (
  payload: DesktopRuntimePayload,
): Promise<{
  capability: Partial<Capability>;
  agent: Partial<CapabilityAgent>;
  developerPrompt?: string;
  memoryPrompt?: string;
  memoryReferences: MemoryReference[];
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string;
}> => {
  const capability = withoutPersistentIdentity(payload.capability as Partial<Capability>);
  const agent = withoutPersistentIdentity(payload.agent as Partial<CapabilityAgent>);
  const actorContext = payload.actorContext;
  const capabilityId = capability.id || payload.capability?.id;
  const agentId = payload.agent?.id;

  let liveBriefing = '';
  let memoryReferences: MemoryReference[] = [];
  let developerPrompt: string | undefined;
  let scope = (payload.sessionScope as 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK') || 'GENERAL_CHAT';
  let scopeId = payload.sessionScopeId as string | undefined;

  if (capabilityId) {
    const bundle = await controlPlaneRequest<CapabilityBundleSnapshot>(
      `/api/capabilities/${encodeURIComponent(capabilityId)}`,
      {
        actorContext,
      },
    );
    const referencedRunId =
      (payload.runId as string | undefined) ||
      extractChatWorkspaceReferenceId(String(payload.message || ''), 'RUN');
    const requestedWorkItemId =
      (payload.workItemId as string | undefined) ||
      (scope === 'WORK_ITEM' ? scopeId : undefined);
    const requestedWorkItem = requestedWorkItemId
      ? bundle.workspace.workItems.find(item => item.id === requestedWorkItemId)
      : undefined;
    const mentionedWorkItem = !requestedWorkItem
      ? resolveMentionedWorkItem(bundle, String(payload.message || ''))
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
            payload.message?.trim(),
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
              payload.message?.trim(),
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
        : String(payload.message || '').trim();

    if (queryText) {
      const memoryResults = await controlPlaneRequest<MemorySearchResult[]>(
        `/api/capabilities/${encodeURIComponent(capabilityId)}/memory/search?q=${encodeURIComponent(queryText)}&limit=6${
          agentId ? `&agentId=${encodeURIComponent(agentId)}` : ''
        }`,
        {
          actorContext,
        },
      ).catch(() => []);
      memoryReferences = memoryResults.map(result => result.reference);
      const serializedMemory = buildMemoryPrompt(memoryResults);
      if (serializedMemory) {
        const combined = [liveBriefing, `Retrieved memory context:\n${serializedMemory}`]
          .filter(Boolean)
          .join('\n\n');
        return {
          capability,
          agent,
          developerPrompt,
          memoryPrompt: combined,
          memoryReferences,
          scope,
          scopeId,
        };
      }
    }
  }

  return {
    capability,
    agent,
    developerPrompt,
    memoryPrompt: liveBriefing || undefined,
    memoryReferences,
    scope,
    scopeId,
  };
};

const buildDesktopRuntimeStatus = async (): Promise<RuntimeStatus> => {
  const token = getConfiguredToken();
  const tokenSource = getConfiguredTokenSource();
  const headlessCli = tokenSource === 'headless-cli';
  const configured = headlessCli || Boolean(token);
  const controlPlaneRuntimeStatus = await controlPlaneRequest<
    Pick<
      RuntimeStatus,
      'databaseRuntime' | 'activeDatabaseProfileId' | 'activeDatabaseProfileLabel'
    >
  >('/api/runtime/status').catch(() => ({
    databaseRuntime: undefined,
    activeDatabaseProfileId: null,
    activeDatabaseProfileLabel: null,
  }));
  const { models, fromRuntime } = await listAvailableRuntimeModels();
  const runtimeDefaultModel = configured
    ? await getRuntimeDefaultModel()
    : normalizeModel(defaultModel);
  const identityResult = configured
    ? await getConfiguredGitHubIdentity()
    : { identity: null, error: null };

  return {
    configured,
    provider: 'GitHub Copilot SDK (Desktop Worker)',
    runtimeOwner: 'DESKTOP',
    executionRuntimeOwner: 'DESKTOP',
    executorId,
    executorHeartbeatAt,
    executorHeartbeatStatus,
    actorUserId: activeActorContext?.userId,
    actorDisplayName: activeActorContext?.displayName,
    ownedCapabilityIds: executorOwnedCapabilityIds,
    endpoint: headlessCli ? process.env.COPILOT_CLI_URL || githubModelsApiUrl : githubModelsApiUrl,
    tokenSource,
    defaultModel: runtimeDefaultModel,
    modelCatalogSource: fromRuntime ? 'runtime' : 'fallback',
    runtimeAccessMode: resolveRuntimeAccessMode({
      tokenSource,
      token,
      modelCatalogFromRuntime: fromRuntime,
    }),
    databaseRuntime: controlPlaneRuntimeStatus.databaseRuntime,
    activeDatabaseProfileId: controlPlaneRuntimeStatus.activeDatabaseProfileId ?? null,
    activeDatabaseProfileLabel: controlPlaneRuntimeStatus.activeDatabaseProfileLabel ?? null,
    httpFallbackEnabled: process.env.ALLOW_GITHUB_MODELS_HTTP_FALLBACK === 'true',
    lastRuntimeError: identityResult.error,
    streaming: true,
    githubIdentity: identityResult.identity,
    githubIdentityError: identityResult.error,
    platformFeatures: {
      pgvectorAvailable: false,
      memoryEmbeddingDimensions: 64,
    },
    availableModels: models,
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

    if (message.type === 'runtime:status') {
      respond({
        requestId,
        payload: await buildDesktopRuntimeStatus(),
      });
      return;
    }

    if (message.type === 'runtime:actor-context') {
      activeActorContext =
        (message.payload?.actor as ActorContext | null | undefined) || null;

      if (activeActorContext?.userId) {
        await syncExecutorRegistration().catch(() => undefined);
        ensureDesktopExecutorLoop();
      } else {
        executorHeartbeatStatus = 'OFFLINE';
        executorOwnedCapabilityIds = [];
      }

      respond({
        requestId,
        payload: await buildDesktopRuntimeStatus(),
      });
      return;
    }

    if (message.type === 'runtime:set-token') {
      await setRuntimeTokenOverride(String(message.payload?.token || ''));
      respond({
        requestId,
        payload: await buildDesktopRuntimeStatus(),
      });
      return;
    }

    if (message.type === 'runtime:clear-token') {
      await clearRuntimeTokenOverride();
      respond({
        requestId,
        payload: await buildDesktopRuntimeStatus(),
      });
      return;
    }

    if (message.type === 'runtime:chat') {
      const payload = message.payload || {};
      if (!payload.message || !payload.capability || !payload.agent) {
        throw new Error('Capability, agent, and message are required.');
      }

      const runtimeStatus = await buildDesktopRuntimeStatus();
      if (!runtimeStatus.configured) {
        throw new Error(getMissingRuntimeConfigurationMessage());
      }

      const context = await resolveDesktopRuntimeContext(payload as DesktopRuntimePayload);

      const result = await invokeCapabilityChat({
        capability: context.capability,
        agent: context.agent,
        history: (payload.history as CapabilityChatMessage[]) || [],
        message: String(payload.message),
        developerPrompt:
          context.developerPrompt || (payload.developerPrompt as string | undefined),
        memoryPrompt: context.memoryPrompt || (payload.memoryPrompt as string | undefined),
        scope: context.scope,
        scopeId: context.scopeId,
        resetSession: payload.sessionMode === 'fresh',
      });

      respond({
        requestId,
        payload: result,
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
      const payload = message.payload || {};
      const streamId = String(payload.streamId || randomUUID());
      if (!payload.message || !payload.capability || !payload.agent) {
        throw new Error('Capability, agent, and message are required.');
      }

      const runtimeStatus = await buildDesktopRuntimeStatus();
      if (!runtimeStatus.configured) {
        throw new Error(getMissingRuntimeConfigurationMessage());
      }
      const context = await resolveDesktopRuntimeContext(payload as DesktopRuntimePayload);

      sendStreamEvent(streamId, {
        type: 'start',
        traceId: randomUUID(),
        createdAt: new Date().toISOString(),
        sessionMode: (payload.sessionMode as 'resume' | 'fresh') || 'resume',
      });
      sendStreamEvent(streamId, {
        type: 'memory',
        memoryReferences: context.memoryReferences,
      });

      const streamed = await invokeCapabilityChatStream({
        capability: context.capability,
        agent: context.agent,
        history: (payload.history as CapabilityChatMessage[]) || [],
        message: String(payload.message),
        developerPrompt:
          context.developerPrompt || (payload.developerPrompt as string | undefined),
        memoryPrompt: context.memoryPrompt || (payload.memoryPrompt as string | undefined),
        scope: context.scope,
        scopeId: context.scopeId,
        resetSession: payload.sessionMode === 'fresh',
        onDelta: delta => {
          sendStreamEvent(streamId, {
            type: 'delta',
            content: delta,
          });
        },
      });

      const completeEvent: ChatStreamEvent = {
        type: 'complete',
        content: streamed.content,
        createdAt: streamed.createdAt,
        model: streamed.model,
        usage: streamed.usage,
        sessionId: streamed.sessionId,
        sessionScope: streamed.sessionScope,
        sessionScopeId: streamed.sessionScopeId,
        isNewSession: streamed.isNewSession,
        sessionMode: (payload.sessionMode as 'resume' | 'fresh') || 'resume',
        memoryReferences: context.memoryReferences,
      };
      sendStreamEvent(streamId, completeEvent);

      respond({
        requestId,
        streamId,
        payload: {
          ok: true,
        },
      });
      return;
    }

    respond({
      requestId,
      error: `Unsupported worker request: ${message.type}`,
    });
  } catch (error) {
    if (message.type === 'runtime:chat-stream') {
      const streamId = String(message.payload?.streamId || randomUUID());
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
      return;
    }

    respond({
      requestId,
      error:
        error instanceof Error ? error.message : 'The desktop worker request failed.',
    });
  }
});
