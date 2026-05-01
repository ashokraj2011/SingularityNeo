import type {
  Capability,
  CapabilityAgent,
} from '../../src/contracts';
import type { AstGroundingSummary } from '../astGrounding';
import {
  buildAstGroundingSummary,
  buildFocusedWorkItemDeveloperPrompt,
  buildLiveWorkspaceBriefing,
  buildWorkItemRuntimeBriefing,
  buildWorkItemStageControlBriefing,
  extractChatWorkspaceReferenceId,
  resolveMentionedWorkItem,
} from '../domains/context-fabric';
import {
  getConfiguredToken,
  getConfiguredTokenSource,
  listManagedCopilotSessions,
} from '../domains/llm-gateway';
import { buildRuntimeStatus } from '../domains/model-policy';
import { getCapabilityBundle } from '../domains/self-service';
import { buildCopilotSessionMonitorData } from '../copilotSessions';
import type { AppCapabilityBundle, ChatRequestBody } from './types';

export const buildChatMemoryPrompt = ({
  liveBriefing,
  memoryPrompt,
}: {
  liveBriefing: string;
  memoryPrompt?: string;
}) =>
  [liveBriefing, memoryPrompt || null]
    .filter(Boolean)
    .join('\n\n');

const buildStageControlDeveloperPrompt = ({
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
    'If the user asks for direct work-state changes such as approve, provide input, resolve conflict, restart, or unblock, those workspace-control actions may be executed by the system outside the model response.',
  ].join('\n');

export const isRuntimeConfigured = () => {
  const tokenSource = getConfiguredTokenSource();
  return tokenSource === 'headless-cli' || Boolean(getConfiguredToken());
};

export const resolveChatRuntimeContext = async ({
  body,
  bundle,
  liveAgent,
}: {
  body: ChatRequestBody;
  bundle: AppCapabilityBundle;
  liveAgent: CapabilityAgent;
}) => {
  const requestedWorkItem = body.workItemId
    ? bundle.workspace.workItems.find(item => item.id === body.workItemId)
    : undefined;
  const referencedRunId =
    body.runId || extractChatWorkspaceReferenceId(body.message || '', 'RUN');
  const mentionedWorkItem = !requestedWorkItem
    ? resolveMentionedWorkItem(bundle, body.message || '')
    : undefined;
  const referencedWorkItem =
    requestedWorkItem ||
    (referencedRunId
      ? bundle.workspace.workItems.find(
          item =>
            item.activeRunId === referencedRunId || item.lastRunId === referencedRunId,
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
  const requestedStep =
    body.workflowStepId && requestedWorkflow
      ? requestedWorkflow.steps.find(step => step.id === body.workflowStepId)
      : requestedWorkItem?.currentStepId && requestedWorkflow
      ? requestedWorkflow.steps.find(step => step.id === requestedWorkItem.currentStepId)
      : undefined;
  const referencedStep =
    referencedWorkItem &&
    referencedWorkflow &&
    (body.workflowStepId || referencedWorkItem.currentStepId)
      ? referencedWorkflow.steps.find(
          step =>
            step.id === (body.workflowStepId || referencedWorkItem.currentStepId),
        )
      : undefined;
  const isStageControlRequest =
    body.contextMode === 'WORK_ITEM_STAGE' && Boolean(requestedWorkItem);
  const hasReferencedWorkItem = Boolean(
    referencedWorkItem && !mentionedWorkItem?.ambiguous?.length,
  );
  const liveBriefing = isStageControlRequest && requestedWorkItem
    ? await buildWorkItemStageControlBriefing({
        bundle,
        workItemId: requestedWorkItem.id,
      })
    : hasReferencedWorkItem && referencedWorkItem
      ? await buildWorkItemRuntimeBriefing({
          bundle,
          workItem: referencedWorkItem,
        })
      : buildLiveWorkspaceBriefing(bundle);
  const chatScope =
    isStageControlRequest || hasReferencedWorkItem
      ? 'WORK_ITEM'
      : body.sessionScope || 'GENERAL_CHAT';
  const chatScopeId =
    isStageControlRequest || hasReferencedWorkItem
      ? referencedWorkItem?.id
      : body.sessionScopeId || (chatScope === 'GENERAL_CHAT' ? bundle.capability.id : undefined);
  const memoryQueryText =
    isStageControlRequest && requestedWorkItem
      ? [
          body.message?.trim(),
          requestedWorkItem?.title,
          requestedWorkItem?.description,
          requestedStep?.name,
        ]
          .filter(Boolean)
          .join('\n')
      : hasReferencedWorkItem && referencedWorkItem
        ? [
            body.message?.trim(),
            referencedWorkItem.id,
            referencedWorkItem.title,
            referencedWorkItem.description,
            referencedStep?.name,
            referencedWorkItem.blocker?.message,
            referencedWorkItem.pendingRequest?.message,
            referencedRunId,
          ]
            .filter(Boolean)
            .join('\n')
        : body.message?.trim() || '';
  const astGrounding: AstGroundingSummary = await buildAstGroundingSummary({
    capability: bundle.capability,
    workItem: hasReferencedWorkItem ? referencedWorkItem : undefined,
    message: body.message || '',
    branchName: hasReferencedWorkItem ? referencedWorkItem?.id : undefined,
  }).catch(() => ({
    astGroundingMode: 'no-ast-grounding' as const,
    isCodeQuestion: false,
    prompt: undefined,
    checkoutPath: undefined,
    branchName: hasReferencedWorkItem ? referencedWorkItem?.id : undefined,
    codeIndexSource: undefined,
    codeIndexFreshness: undefined,
    verifiedPaths: [],
    groundingEvidenceSource: 'none' as const,
  }));

  return {
    liveBriefing,
    chatScope,
    chatScopeId,
    workItem: hasReferencedWorkItem ? referencedWorkItem : undefined,
    memoryQueryText,
    astGroundingPrompt: astGrounding.prompt,
    astGroundingMode: astGrounding.astGroundingMode,
    checkoutPath: astGrounding.checkoutPath,
    branchName: astGrounding.branchName,
    codeIndexSource: astGrounding.codeIndexSource,
    codeIndexFreshness: astGrounding.codeIndexFreshness,
    verifiedPaths: astGrounding.verifiedPaths,
    isCodeQuestion: astGrounding.isCodeQuestion,
    groundingEvidenceSource: astGrounding.groundingEvidenceSource,
    shouldBootstrapIndex: astGrounding.shouldBootstrapIndex,
    developerPrompt: isStageControlRequest
      ? buildStageControlDeveloperPrompt({
          agentName: liveAgent.name || liveAgent.role || 'the current stage agent',
        })
      : mentionedWorkItem?.ambiguous?.length
        ? buildFocusedWorkItemDeveloperPrompt({
            agentName: liveAgent.name || liveAgent.role || 'the active agent',
            ambiguousWorkItems: mentionedWorkItem.ambiguous,
          })
        : hasReferencedWorkItem
          ? buildFocusedWorkItemDeveloperPrompt({
              agentName: liveAgent.name || liveAgent.role || 'the active agent',
            })
          : undefined,
  };
};

export const buildCopilotSessionMonitorSnapshot = async (capabilityId: string) => {
  const [bundle, runtimeStatus] = await Promise.all([
    getCapabilityBundle(capabilityId),
    buildRuntimeStatus(),
  ]);
  const managedSessions = listManagedCopilotSessions().filter(
    session => session.capabilityId === capabilityId,
  );
  const liveSessionIds = new Set(managedSessions.map(session => session.sessionId));
  const sessionRows = new Map<
    string,
    {
      sessionId: string;
      agentId?: string;
      agentName: string;
      scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
      scopeId?: string;
      lastUsedAt: string;
      createdAt?: string;
      model: string;
      requestCount: number;
      totalTokens: number;
      hasStoredSummary: boolean;
      hasLiveSession: boolean;
    }
  >();

  bundle.workspace.agents.forEach(agent => {
    agent.sessionSummaries.forEach(session => {
      sessionRows.set(session.sessionId, {
        sessionId: session.sessionId,
        agentId: agent.id,
        agentName: agent.name,
        scope: session.scope,
        scopeId: session.scopeId,
        lastUsedAt: session.lastUsedAt,
        model: session.model,
        requestCount: session.requestCount,
        totalTokens: session.totalTokens,
        hasStoredSummary: true,
        hasLiveSession: liveSessionIds.has(session.sessionId),
      });
    });
  });

  managedSessions.forEach(session => {
    const current = sessionRows.get(session.sessionId);
    sessionRows.set(session.sessionId, {
      sessionId: session.sessionId,
      agentId: current?.agentId || session.agentId,
      agentName: current?.agentName || session.agentName || 'Unknown agent',
      scope: current?.scope || session.scope || 'GENERAL_CHAT',
      scopeId: current?.scopeId || session.scopeId,
      lastUsedAt: current?.lastUsedAt || session.lastUsedAt,
      createdAt: current?.createdAt || session.createdAt,
      model: current?.model || session.model || runtimeStatus.defaultModel,
      requestCount: current?.requestCount || 0,
      totalTokens: current?.totalTokens || 0,
      hasStoredSummary: current?.hasStoredSummary || false,
      hasLiveSession: true,
    });
  });

  const { sessions, summary } = buildCopilotSessionMonitorData([...sessionRows.values()]);

  return {
    capabilityId,
    runtime: {
      configured: runtimeStatus.configured,
      provider: runtimeStatus.provider,
      runtimeAccessMode: runtimeStatus.runtimeAccessMode,
      tokenSource: runtimeStatus.tokenSource,
      defaultModel: runtimeStatus.defaultModel,
      githubIdentity: runtimeStatus.githubIdentity
        ? {
            login: runtimeStatus.githubIdentity.login,
            name: runtimeStatus.githubIdentity.name,
          }
        : null,
      activeManagedSessions: managedSessions.length,
    },
    summary,
    sessions,
  };
};
