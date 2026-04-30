import type express from 'express';
import type { Capability, CapabilityAgent, CapabilityWorkspace, WorkItem } from '../../src/types';
import { assertCapabilityPermission } from '../access';
import { GitHubProviderRateLimitError, type ChatHistoryMessage } from '../githubModels';
import {
  auditRuntimeChatTurn,
  appendCapabilityMessageRecord,
} from '../domains/context-fabric';
import { getCapabilityBundle } from '../domains/self-service';
import { parseActorContext } from '../requestActor';
import { resolveAuthorizedSwarmParticipants } from '../swarmParticipants';
import { wakeExecutionWorker } from '../execution/worker';
import { sendApiError } from '../api/errors';
import { normalizeProviderKey } from '../providerRegistry';
import { getConfiguredRuntimeProviderStatus } from '../runtimeProviders';
import {
  buildStructuredChatEvidencePrompt,
  sanitizeGroundedChatResponse,
  type MemoryTrustMode,
  type PathValidationState,
} from '../chatEvidence';
import {
  buildUnifiedChatContextPrompt,
  resolveChatFollowUpContext,
  type EffectiveMessageSource,
  type FollowUpBindingMode,
  type FollowUpIntent,
} from '../chatContinuity';
import { invokeCommonAgentRuntime, resolveReadOnlyToolIds } from '../agentRuntime';
import {
  getDefaultRepoAwareReadOnlyToolIds,
  resolveRuntimeAgentForWorkspace,
} from '../runtimeAgents';

type ChatRequestBody = {
  capability?: Capability;
  agent?: CapabilityAgent;
  history?: ChatHistoryMessage[];
  message?: string;
  sessionMode?: 'resume' | 'fresh';
  sessionScope?: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  sessionScopeId?: string;
  contextMode?: 'GENERAL' | 'WORK_ITEM_STAGE';
  workItemId?: string;
  runId?: string;
  workflowStepId?: string;
  /**
   * Cross-capability participants tagged from the composer.
   *   - length 0 or undefined → legacy single-agent chat (body.capability/body.agent).
   *   - length 1              → cross-capability single-agent chat: the anchor
   *     stays `body.capability`, but the speaking agent resolves out of the
   *     participant's home bundle.
   *   - length 2-3            → swarm debate; this endpoint returns 409 with
   *     a pointer to /api/runtime/chat/swarm so the caller switches lanes.
   *   - length >3             → 400.
   */
  participants?: Array<{ capabilityId: string; agentId: string }>;
};

const resolveRuntimeTarget = async (providerKey?: string | null) => {
  const status = await getConfiguredRuntimeProviderStatus(
    normalizeProviderKey(providerKey),
  );
  return {
    runtimeEndpoint: status.endpoint || null,
    runtimeCommand: status.command || null,
  };
};

const normalizeParticipants = (
  participants?: Array<{ capabilityId?: string; agentId?: string }>,
): Array<{ capabilityId: string; agentId: string }> => {
  if (!participants || participants.length === 0) return [];
  const seen = new Set<string>();
  const out: Array<{ capabilityId: string; agentId: string }> = [];
  for (const item of participants) {
    if (!item?.capabilityId || !item?.agentId) continue;
    const key = `${item.capabilityId}::${item.agentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ capabilityId: item.capabilityId, agentId: item.agentId });
  }
  return out;
};

type ChatContext = {
  liveBriefing: string;
  chatScope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  chatScopeId?: string;
  workItem?: WorkItem;
  memoryQueryText: string;
  astGroundingPrompt?: string;
  astGroundingMode?:
    | 'ast-grounded-local-clone'
    | 'ast-grounded-remote-index'
    | 'no-ast-grounding';
  checkoutPath?: string;
  branchName?: string;
  codeIndexSource?: 'local-checkout' | 'capability-index';
  codeIndexFreshness?: string;
  verifiedPaths?: string[];
  isCodeQuestion?: boolean;
  groundingEvidenceSource?: 'local-checkout' | 'capability-index' | 'none';
  developerPrompt?: string;
};

type RuntimeChatRouteDeps = {
  ZERO_RUNTIME_USAGE: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  buildChatMemoryPrompt: (args: { liveBriefing: string; memoryPrompt?: string }) => string;
  createTraceId: () => string;
  evictManagedCapabilitySessions: typeof import('../githubModels').evictManagedCapabilitySessions;
  finishTelemetrySpan: typeof import('../telemetry').finishTelemetrySpan;
  getMissingRuntimeConfigurationMessage: () => string;
  invokeCapabilityChat: typeof import('../githubModels').invokeCapabilityChat;
  invokeCapabilityChatStream: typeof import('../githubModels').invokeCapabilityChatStream;
  isRuntimeConfigured: () => boolean;
  maybeHandleCapabilityChatAction: typeof import('../chatWorkspace').maybeHandleCapabilityChatAction;
  recordUsageMetrics: typeof import('../telemetry').recordUsageMetrics;
  refreshCapabilityMemory: typeof import('../memory').refreshCapabilityMemory;
  resolveChatRuntimeContext: (args: {
    body: ChatRequestBody;
    bundle: {
      capability: Capability;
      workspace: CapabilityWorkspace;
    };
    liveAgent: CapabilityAgent;
  }) => Promise<ChatContext>;
  startTelemetrySpan: typeof import('../telemetry').startTelemetrySpan;
  writeSseEvent: (response: express.Response, event: string, payload: unknown) => void;
  buildMemoryContext: typeof import('../memory').buildMemoryContext;
  GitHubProviderRateLimitError: typeof GitHubProviderRateLimitError;
};

export const registerRuntimeChatRoutes = (
  app: express.Express,
  {
    ZERO_RUNTIME_USAGE,
    buildChatMemoryPrompt,
    buildMemoryContext,
    createTraceId,
    evictManagedCapabilitySessions,
    finishTelemetrySpan,
    getMissingRuntimeConfigurationMessage,
    invokeCapabilityChat,
    invokeCapabilityChatStream,
    isRuntimeConfigured,
    maybeHandleCapabilityChatAction,
    recordUsageMetrics,
    refreshCapabilityMemory,
    resolveChatRuntimeContext,
    startTelemetrySpan,
    writeSseEvent,
    GitHubProviderRateLimitError,
  }: RuntimeChatRouteDeps,
) => {
  const buildEvidenceDiagnostics = ({
    chatContext,
    memoryTrustMode,
    pathValidationState,
    unverifiedPathClaimsRemoved,
    effectiveMessage,
    effectiveMessageSource,
    followUpIntent,
    followUpBindingMode,
    historyTurnCount,
    historyRolledUp,
    chatRuntimeLane,
    toolLoopEnabled,
    toolLoopReason,
    toolLoopUsed,
    attemptedToolIds,
    resolvedAllowedToolIds,
    resolvedAgentSource,
    parsedToolIntent,
    toolIntentDisposition,
    toolIntentRejectionReason,
    codeDiscoveryMode,
    codeDiscoveryFallback,
    astSource,
  }: {
    chatContext: ChatContext;
    memoryTrustMode: MemoryTrustMode;
    pathValidationState?: PathValidationState;
    unverifiedPathClaimsRemoved?: string[];
    effectiveMessage: string;
    effectiveMessageSource: EffectiveMessageSource;
    followUpIntent: FollowUpIntent;
    followUpBindingMode: FollowUpBindingMode;
    historyTurnCount: number;
    historyRolledUp?: boolean;
    chatRuntimeLane: 'server-runtime-route';
    toolLoopEnabled?: boolean;
    toolLoopReason?: 'repo-aware-code-question' | 'disabled-by-caller' | 'no-read-only-tools';
    toolLoopUsed?: boolean;
    attemptedToolIds?: string[];
    resolvedAllowedToolIds?: string[];
    resolvedAgentSource?: string;
    parsedToolIntent?: {
      action: 'invoke_tool';
      toolId?: string;
      requestedToolId?: string;
      args: Record<string, unknown>;
    };
    toolIntentDisposition?: 'none' | 'executed' | 'repaired' | 'rejected' | 'stripped';
    toolIntentRejectionReason?: string;
    codeDiscoveryMode?: 'prompt-only' | 'ast-first-tool-loop';
    codeDiscoveryFallback?: 'none' | 'capability-index' | 'text-search';
    astSource?: 'none' | 'local-checkout' | 'capability-index' | 'text-search';
  }) => ({
    groundingEvidenceSource:
      chatContext.groundingEvidenceSource ||
      chatContext.codeIndexSource ||
      'none',
    historyTurnCount,
    historyRolledUp: Boolean(historyRolledUp),
    workContextHydrated: Boolean(chatContext.liveBriefing?.trim()),
    workContextSource:
      chatContext.chatScope === 'WORK_ITEM' ? 'live-work-item' : 'live-workspace',
    effectiveMessage,
    effectiveMessageSource,
    followUpIntent,
    followUpBindingMode,
    chatRuntimeLane,
    memoryTrustMode,
    pathValidationState: pathValidationState || 'none',
    unverifiedPathClaimsRemoved: unverifiedPathClaimsRemoved || [],
    toolLoopEnabled: Boolean(toolLoopEnabled),
    toolLoopReason:
      toolLoopReason ||
      (chatContext.isCodeQuestion ? 'repo-aware-code-question' : 'disabled-by-caller'),
    toolLoopUsed: Boolean(toolLoopUsed),
    attemptedToolIds: attemptedToolIds || [],
    resolvedAllowedToolIds: resolvedAllowedToolIds || [],
    resolvedAgentSource: resolvedAgentSource || 'server-live-agent',
    parsedToolIntent,
    toolIntentDisposition: toolIntentDisposition || 'none',
    toolIntentRejectionReason,
    codeDiscoveryMode: codeDiscoveryMode || 'prompt-only',
    codeDiscoveryFallback: codeDiscoveryFallback || 'none',
    astSource: astSource || 'none',
  });

  const buildCodeEvidencePrompt = ({
    chatContext,
    advisoryMemory,
    homeMemoryPrompt,
    memoryTrustMode,
  }: {
    chatContext: ChatContext;
    advisoryMemory?: string;
    homeMemoryPrompt?: string;
    memoryTrustMode: MemoryTrustMode;
  }) =>
    buildStructuredChatEvidencePrompt({
      verifiedCodeGrounding: chatContext.astGroundingPrompt,
      verifiedRepositoryEvidence: chatContext.checkoutPath
        ? [
            `Repository root on disk: ${chatContext.checkoutPath}`,
            chatContext.branchName ? `Active branch: ${chatContext.branchName}` : null,
            chatContext.codeIndexFreshness
              ? `Code index freshness: ${chatContext.codeIndexFreshness}`
              : null,
          ]
            .filter(Boolean)
            .join('\n')
        : null,
      advisoryMemory: [
        advisoryMemory?.trim() ? `Anchor capability memory:\n${advisoryMemory.trim()}` : null,
        homeMemoryPrompt?.trim() ? homeMemoryPrompt.trim() : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      memoryTrustMode,
    });

  const buildTurnMemoryPrompt = ({
    chatContext,
    evidencePrompt,
    followUpContextPrompt,
  }: {
    chatContext: ChatContext;
    evidencePrompt?: string;
    followUpContextPrompt?: string;
  }) =>
    buildChatMemoryPrompt({
      liveBriefing: '',
      memoryPrompt: buildUnifiedChatContextPrompt({
        liveContext: chatContext.liveBriefing,
        followUpContextPrompt,
        evidencePrompt,
      }),
    });

  const maybeRefreshCodeGroundingMemory = (capabilityId: string, shouldRefresh: boolean) => {
    if (!shouldRefresh) {
      return;
    }
    void refreshCapabilityMemory(capabilityId, {
      requeueAgents: false,
      requestReason: 'repo-grounding-chat-refresh',
    }).catch(() => undefined);
  };

  app.post('/api/runtime/chat', async (request, response) => {
    const body = request.body as ChatRequestBody;
    const originalMessage = body.message?.trim();
    if (!originalMessage || !body.capability || !body.agent) {
      response.status(400).json({
        error: 'Capability, agent, and message are required.',
      });
      return;
    }

    // Participants routing (G22): 0/1 participants stay on the single-agent
    // chat path; 2-3 participants are a swarm debate (wrong endpoint); >3 is
    // always a bad request.
    const normalizedParticipants = normalizeParticipants(body.participants);
    if (normalizedParticipants.length > 3) {
      response.status(400).json({
        error: 'Chat supports at most 3 tagged participants; received more.',
      });
      return;
    }
    if (normalizedParticipants.length >= 2) {
      response.status(409).json({
        error:
          'Tagging 2 or 3 participants starts a Swarm Debate; call POST /api/runtime/chat/swarm instead.',
        swarmEndpoint: '/api/runtime/chat/swarm',
      });
      return;
    }

    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: body.capability.id,
        actor,
        action: 'chat.write',
      });
      const anchorBundle = await getCapabilityBundle(body.capability.id);
      const resolvedParticipants =
        normalizedParticipants.length === 1
          ? await resolveAuthorizedSwarmParticipants({
              anchorCapabilityId: body.capability.id,
              actor,
              participants: normalizedParticipants,
            })
          : [];

      // Foreign-agent (single-participant) path: the anchor stays the caller's
      // capability, but the speaking agent may resolve from a tagged
      // participant in the anchor capability or in an authorized linked one.
      const taggedParticipant = resolvedParticipants[0];
      const usingForeignAgent = Boolean(
        taggedParticipant &&
          taggedParticipant.capabilityId !== body.capability.id,
      );
      const liveAgent =
        taggedParticipant?.agent ||
        anchorBundle.workspace.agents.find(agent => agent.id === body.agent?.id) ||
        body.agent;

      if (!liveAgent) {
        response.status(404).json({
          error: usingForeignAgent
            ? `Agent ${taggedParticipant!.agentId} not found in capability ${taggedParticipant!.capabilityId}.`
            : `Agent ${body.agent?.id} not found in capability ${body.capability.id}.`,
        });
        return;
      }

      // The anchor capability is still the conversation anchor; foreign agents
      // never mutate anchor workspace state.
      const bundle = anchorBundle;
      const liveCapability = bundle.capability;
      const followUpContext = resolveChatFollowUpContext({
        history: body.history || [],
        latestMessage: originalMessage,
        sessionScope: body.sessionScope,
        sessionScopeId: body.sessionScopeId,
        workItemId: body.workItemId,
        runId: body.runId,
        workflowStepId: body.workflowStepId,
      });
      const effectiveMessage = followUpContext.effectiveMessage || originalMessage;
      const chatAction = await maybeHandleCapabilityChatAction({
        bundle,
        agent: liveAgent,
        message: originalMessage,
      });
      if (chatAction.handled) {
        if (chatAction.wakeWorker) {
          wakeExecutionWorker();
        }

        response.json({
          content:
            chatAction.content ||
            'The workspace request completed, but there was no additional message to show.',
          model: 'workspace-control',
          usage: ZERO_RUNTIME_USAGE,
          responseId: null,
          createdAt: new Date().toISOString(),
          traceId: createTraceId(),
          sessionMode: body.sessionMode || 'resume',
          memoryReferences: [],
        });
        return;
      }

      if (!isRuntimeConfigured()) {
        response.status(503).json({
          error: getMissingRuntimeConfigurationMessage(),
        });
        return;
      }

      const traceId = createTraceId();
      const span = await startTelemetrySpan({
        capabilityId: liveCapability.id,
        traceId,
        entityType: 'CHAT',
        entityId: liveAgent.id,
        name: `Capability chat: ${liveAgent.name}`,
        status: 'RUNNING',
        model: liveAgent.model,
        attributes: {
          capabilityId: liveCapability.id,
          agentId: liveAgent.id,
        },
      });
      const chatContext = await resolveChatRuntimeContext({
        body: {
          ...body,
          history: followUpContext.history,
          message: effectiveMessage,
        },
        bundle,
        liveAgent,
      });
      const runtimeResolvedAgent = resolveRuntimeAgentForWorkspace({
        workspace: usingForeignAgent ? undefined : bundle.workspace,
        payloadAgent: liveAgent,
        payloadAgentId: taggedParticipant?.agentId || body.agent?.id,
      });
      const runtimeAgent = runtimeResolvedAgent.agent as CapabilityAgent;
      const runtimeReadOnlyToolIds = resolveReadOnlyToolIds(runtimeAgent);
      const runtimeAllowedToolIds =
        chatContext.isCodeQuestion &&
        !runtimeReadOnlyToolIds.some(
          toolId => toolId === 'browse_code' || toolId === 'workspace_search',
        )
          ? getDefaultRepoAwareReadOnlyToolIds()
          : undefined;
      const runtimeAgentSource = runtimeAllowedToolIds?.length
        ? 'fallback-read-only-profile'
        : runtimeResolvedAgent.source;
      const memoryTrustMode: MemoryTrustMode = chatContext.isCodeQuestion
        ? 'repo-evidence-only'
        : 'standard';
      const anchorMemoryContext = await buildMemoryContext({
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        queryText: chatContext.memoryQueryText || effectiveMessage,
        excludeSourceTypes:
          memoryTrustMode === 'repo-evidence-only' ? ['CHAT_SESSION'] : [],
      });
      // Merged-memory slice (plan §3c) — when the speaking agent lives in a
      // different capability, pull its home memory too so it brings its own
      // lived context into the anchor conversation.
      const homeMemoryContext =
        usingForeignAgent && taggedParticipant
          ? await buildMemoryContext({
              capabilityId: taggedParticipant.capabilityId,
              agentId: taggedParticipant.agentId,
              queryText: chatContext.memoryQueryText || effectiveMessage,
              excludeSourceTypes:
                memoryTrustMode === 'repo-evidence-only' ? ['CHAT_SESSION'] : [],
            }).catch(() => null)
          : null;
      const memoryContext = anchorMemoryContext;
      const mergedMemoryPrompt = buildCodeEvidencePrompt({
        chatContext,
        advisoryMemory: anchorMemoryContext.prompt,
        homeMemoryPrompt: homeMemoryContext?.prompt
          ? `Home-capability memory (${taggedParticipant!.capabilityId}):\n${homeMemoryContext.prompt}`
          : undefined,
        memoryTrustMode,
      });
      const chatResponse = await invokeCommonAgentRuntime({
        capability: liveCapability,
        agent: runtimeAgent,
        history: followUpContext.history,
        message: effectiveMessage,
        resetSession: body.sessionMode === 'fresh',
        scope: chatContext.chatScope,
        scopeId: chatContext.chatScopeId,
        developerPrompt: chatContext.developerPrompt,
        memoryPrompt: buildTurnMemoryPrompt({
          chatContext,
          evidencePrompt: mergedMemoryPrompt,
          followUpContextPrompt: followUpContext.followUpContextPrompt,
        }),
        workItem: chatContext.workItem,
        preferReadOnlyToolLoop: Boolean(chatContext.isCodeQuestion),
        allowedToolIds: runtimeAllowedToolIds,
        resolvedAgentSource: runtimeAgentSource,
        runtimeLane: 'server-runtime-route',
      });
      const { promptReceipt, tokenPolicy, ...publicChatResponse } = chatResponse as typeof chatResponse & {
        promptReceipt?: Record<string, unknown>;
        tokenPolicy?: Record<string, unknown>;
      };
      const sanitizedChat = await sanitizeGroundedChatResponse({
        content: publicChatResponse.content || '',
        checkoutPath: chatContext.checkoutPath,
        verifiedPaths: chatContext.verifiedPaths,
        enforceEvidenceOnly: Boolean(chatContext.isCodeQuestion),
      });
      const evidenceDiagnostics = buildEvidenceDiagnostics({
        chatContext,
        memoryTrustMode,
        pathValidationState: sanitizedChat.pathValidationState,
        unverifiedPathClaimsRemoved: sanitizedChat.unverifiedPathClaimsRemoved,
        effectiveMessage,
        effectiveMessageSource: followUpContext.effectiveMessageSource,
        followUpIntent: followUpContext.followUpIntent,
        followUpBindingMode: followUpContext.followUpBindingMode,
        historyTurnCount: chatResponse.historyTurnCount || followUpContext.history.length,
        historyRolledUp: chatResponse.historyRolledUp,
        chatRuntimeLane: 'server-runtime-route',
        toolLoopEnabled: chatResponse.toolLoopEnabled,
        toolLoopReason: chatResponse.toolLoopReason,
        toolLoopUsed: chatResponse.toolLoopUsed,
        attemptedToolIds: chatResponse.attemptedToolIds,
        resolvedAllowedToolIds: chatResponse.resolvedAllowedToolIds,
        resolvedAgentSource: chatResponse.resolvedAgentSource,
        parsedToolIntent: chatResponse.parsedToolIntent,
        toolIntentDisposition: chatResponse.toolIntentDisposition,
        toolIntentRejectionReason: chatResponse.toolIntentRejectionReason,
        codeDiscoveryMode: chatResponse.codeDiscoveryMode,
        codeDiscoveryFallback: chatResponse.codeDiscoveryFallback,
        astSource: chatResponse.astSource,
      });
      const runtimeTarget = await resolveRuntimeTarget(
        publicChatResponse.runtimeProviderKey ||
          runtimeAgent.providerKey ||
          runtimeAgent.provider ||
          liveAgent.providerKey ||
          liveAgent.provider,
      );
      await finishTelemetrySpan({
        capabilityId: liveCapability.id,
        spanId: span.id,
        status: 'OK',
        costUsd: publicChatResponse.usage.estimatedCostUsd,
        tokenUsage: publicChatResponse.usage,
        attributes: {
          memoryHits: memoryContext.results.length,
          sessionMode: body.sessionMode || 'resume',
          isNewSession: String(Boolean(publicChatResponse.isNewSession)),
          stage: 'capability_chat',
          promptReceipt,
          tokenPolicy,
          ...evidenceDiagnostics,
        },
      });
      await recordUsageMetrics({
        capabilityId: liveCapability.id,
        traceId,
        scopeType: 'CHAT',
        scopeId: liveAgent.id,
        totalTokens: publicChatResponse.usage.totalTokens,
        costUsd: publicChatResponse.usage.estimatedCostUsd,
        tags: {
          model: publicChatResponse.model,
          sessionMode: body.sessionMode || 'resume',
          stage: 'capability_chat',
        },
      });

      response.json({
        ...publicChatResponse,
        ...runtimeTarget,
        content: sanitizedChat.content,
        traceId,
        sessionMode: body.sessionMode || 'resume',
        memoryReferences: memoryContext.results.map(result => result.reference),
        astGroundingMode: chatContext.astGroundingMode,
        checkoutPath: chatContext.checkoutPath,
        branchName: chatContext.branchName,
        codeIndexSource: chatContext.codeIndexSource,
        codeIndexFreshness: chatContext.codeIndexFreshness,
        ...evidenceDiagnostics,
      });

      // Persist tool-loop narration as hidden chat rows so subsequent user
      // turns inherit prior tool evidence without re-running the tools.  UI
      // surfaces filter `hidden=true` from rendering; the runtime forwards
      // them back into the next LLM call as part of the history window.
      // Skipped when the provider self-manages context (see Section D).
      const toolHistoryRows = (publicChatResponse as unknown as {
        toolHistory?: Array<{ role: 'user' | 'agent'; content: string }>;
      }).toolHistory;
      if (toolHistoryRows && toolHistoryRows.length > 0) {
        const baseTimestamp = new Date();
        for (const [index, entry] of toolHistoryRows.entries()) {
          const stamp = new Date(baseTimestamp.getTime() + index).toISOString();
          await appendCapabilityMessageRecord(liveCapability.id, {
            id: `${traceId || stamp}-tool-${index}`,
            role: entry.role === 'agent' ? 'agent' : 'user',
            content: entry.content,
            timestamp: stamp,
            agentId: liveAgent.id,
            agentName: liveAgent.name,
            traceId,
            sessionId: publicChatResponse.sessionId || undefined,
            sessionScope: chatContext.chatScope || undefined,
            sessionScopeId: chatContext.chatScopeId || undefined,
            workItemId: body.workItemId || undefined,
            runId: body.runId || undefined,
            workflowStepId: body.workflowStepId || undefined,
            hidden: true,
          }).catch(err => {
            console.warn(
              '[chat-audit] failed to persist tool-history row:',
              err instanceof Error ? err.message : err,
            );
          });
        }
      }

      // Fire-and-forget audit record so desktop chat turns are always
      // traceable on the control plane, even if the operator never
      // explicitly saves them as evidence.
      void auditRuntimeChatTurn({
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        agentName: liveAgent.name,
        userMessage: originalMessage,
        agentMessage: sanitizedChat.content || '',
        model: publicChatResponse.model || null,
        traceId,
        sessionId: publicChatResponse.sessionId || null,
        sessionScope: chatContext.chatScope || null,
        sessionScopeId: chatContext.chatScopeId || null,
        workItemId: body.workItemId || null,
        runId: body.runId || null,
        sourceCapabilityId: taggedParticipant?.capabilityId || liveCapability.id,
      }).catch(err => {
        console.warn('[chat-audit] failed to persist chat turn:', err instanceof Error ? err.message : err);
      });
      if (
        sanitizedChat.pathValidationState === 'repaired' ||
        sanitizedChat.pathValidationState === 'stripped'
      ) {
        void evictManagedCapabilitySessions({
          capabilityId: liveCapability.id,
          agentId: liveAgent.id,
          scope: chatContext.chatScope,
          scopeId: chatContext.chatScopeId,
        }).catch(() => undefined);
      }
      maybeRefreshCodeGroundingMemory(
        liveCapability.id,
        Boolean(chatContext.isCodeQuestion),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/runtime/chat/stream', async (request, response) => {
    const body = request.body as ChatRequestBody;
    const originalMessage = body.message?.trim();
    if (!originalMessage || !body.capability || !body.agent) {
      response.status(400).json({
        error: 'Capability, agent, and message are required.',
      });
      return;
    }

    // Participants routing — same semantics as /api/runtime/chat but applied
    // before headers go out so we can still reply with a JSON error instead
    // of a half-opened SSE channel.
    const streamParticipants = normalizeParticipants(body.participants);
    if (streamParticipants.length > 3) {
      response.status(400).json({
        error: 'Chat supports at most 3 tagged participants; received more.',
      });
      return;
    }
    if (streamParticipants.length >= 2) {
      response.status(409).json({
        error:
          'Tagging 2 or 3 participants starts a Swarm Debate; call POST /api/runtime/chat/swarm instead.',
        swarmEndpoint: '/api/runtime/chat/swarm',
      });
      return;
    }

    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    const traceId = createTraceId();

    writeSseEvent(response, 'start', {
      type: 'start',
      traceId,
      createdAt: new Date().toISOString(),
      sessionMode: body.sessionMode || 'resume',
    });

    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: body.capability.id,
        actor,
        action: 'chat.write',
      });
      const anchorBundle = await getCapabilityBundle(body.capability.id);
      const resolvedParticipants =
        streamParticipants.length === 1
          ? await resolveAuthorizedSwarmParticipants({
              anchorCapabilityId: body.capability.id,
              actor,
              participants: streamParticipants,
            })
          : [];

      const foreignParticipant = resolvedParticipants[0];
      const usingForeignAgent = Boolean(
        foreignParticipant &&
          foreignParticipant.capabilityId !== body.capability.id,
      );
      const liveAgent =
        foreignParticipant?.agent ||
        anchorBundle.workspace.agents.find(agent => agent.id === body.agent?.id) ||
        body.agent;

      if (!liveAgent) {
        writeSseEvent(response, 'error', {
          type: 'error',
          traceId,
          sessionMode: body.sessionMode || 'resume',
          error: usingForeignAgent
            ? `Agent ${foreignParticipant!.agentId} not found in capability ${foreignParticipant!.capabilityId}.`
            : `Agent ${body.agent?.id} not found in capability ${body.capability.id}.`,
        });
        response.end();
        return;
      }

      const bundle = anchorBundle;
      const liveCapability = bundle.capability;
      const followUpContext = resolveChatFollowUpContext({
        history: body.history || [],
        latestMessage: originalMessage,
        sessionScope: body.sessionScope,
        sessionScopeId: body.sessionScopeId,
        workItemId: body.workItemId,
        runId: body.runId,
        workflowStepId: body.workflowStepId,
      });
      const effectiveMessage = followUpContext.effectiveMessage || originalMessage;
      const chatAction = await maybeHandleCapabilityChatAction({
        bundle,
        agent: liveAgent,
        message: originalMessage,
      });

      if (chatAction.handled) {
        if (chatAction.wakeWorker) {
          wakeExecutionWorker();
        }

        writeSseEvent(response, 'complete', {
          type: 'complete',
          traceId,
          content:
            chatAction.content ||
            'The workspace request completed, but there was no additional message to show.',
          createdAt: new Date().toISOString(),
          model: 'workspace-control',
          usage: ZERO_RUNTIME_USAGE,
          sessionMode: body.sessionMode || 'resume',
          memoryReferences: [],
        });
        response.end();
        return;
      }

      if (!isRuntimeConfigured()) {
        writeSseEvent(response, 'error', {
          type: 'error',
          traceId,
          sessionMode: body.sessionMode || 'resume',
          error: getMissingRuntimeConfigurationMessage(),
        });
        response.end();
        return;
      }

      const chatContext = await resolveChatRuntimeContext({
        body: {
          ...body,
          history: followUpContext.history,
          message: effectiveMessage,
        },
        bundle,
        liveAgent,
      });
      const memoryTrustMode: MemoryTrustMode = chatContext.isCodeQuestion
        ? 'repo-evidence-only'
        : 'standard';
      const anchorMemoryContext = await buildMemoryContext({
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        queryText: chatContext.memoryQueryText || effectiveMessage,
        excludeSourceTypes:
          memoryTrustMode === 'repo-evidence-only' ? ['CHAT_SESSION'] : [],
      });
      const streamHomeMemoryContext =
        usingForeignAgent && foreignParticipant
          ? await buildMemoryContext({
              capabilityId: foreignParticipant.capabilityId,
              agentId: foreignParticipant.agentId,
              queryText: chatContext.memoryQueryText || effectiveMessage,
              excludeSourceTypes:
                memoryTrustMode === 'repo-evidence-only' ? ['CHAT_SESSION'] : [],
            }).catch(() => null)
          : null;
      const memoryContext = anchorMemoryContext;
      const runtimeResolvedAgent = resolveRuntimeAgentForWorkspace({
        workspace: usingForeignAgent ? undefined : bundle.workspace,
        payloadAgent: liveAgent,
        payloadAgentId: foreignParticipant?.agentId || body.agent?.id,
      });
      const runtimeAgent = runtimeResolvedAgent.agent as CapabilityAgent;
      const runtimeReadOnlyToolIds = resolveReadOnlyToolIds(runtimeAgent);
      const runtimeAllowedToolIds =
        chatContext.isCodeQuestion &&
        !runtimeReadOnlyToolIds.some(
          toolId => toolId === 'browse_code' || toolId === 'workspace_search',
        )
          ? getDefaultRepoAwareReadOnlyToolIds()
          : undefined;
      const runtimeAgentSource = runtimeAllowedToolIds?.length
        ? 'fallback-read-only-profile'
        : runtimeResolvedAgent.source;
      const streamMergedMemoryPrompt = buildCodeEvidencePrompt({
        chatContext,
        advisoryMemory: anchorMemoryContext.prompt,
        homeMemoryPrompt: streamHomeMemoryContext?.prompt
          ? `Home-capability memory (${foreignParticipant!.capabilityId}):\n${streamHomeMemoryContext.prompt}`
          : undefined,
        memoryTrustMode,
      });
      const memoryDiagnostics = buildEvidenceDiagnostics({
        chatContext,
        memoryTrustMode,
        effectiveMessage,
        effectiveMessageSource: followUpContext.effectiveMessageSource,
        followUpIntent: followUpContext.followUpIntent,
        followUpBindingMode: followUpContext.followUpBindingMode,
        historyTurnCount: followUpContext.history.length,
        historyRolledUp: false,
        chatRuntimeLane: 'server-runtime-route',
        toolLoopEnabled: Boolean(chatContext.isCodeQuestion),
        toolLoopReason: chatContext.isCodeQuestion
          ? 'repo-aware-code-question'
          : 'disabled-by-caller',
        toolLoopUsed: false,
        attemptedToolIds: [],
        resolvedAllowedToolIds: runtimeAllowedToolIds || runtimeReadOnlyToolIds,
        resolvedAgentSource: runtimeAgentSource,
        toolIntentDisposition: 'none',
        codeDiscoveryMode: 'prompt-only',
        codeDiscoveryFallback: 'none',
        astSource: 'none',
      });
      writeSseEvent(response, 'memory', {
        type: 'memory',
        traceId,
        memoryReferences: memoryContext.results.map(result => result.reference),
        astGroundingMode: chatContext.astGroundingMode,
        checkoutPath: chatContext.checkoutPath,
        branchName: chatContext.branchName,
        codeIndexSource: chatContext.codeIndexSource,
        codeIndexFreshness: chatContext.codeIndexFreshness,
        ...memoryDiagnostics,
      });
      const span = await startTelemetrySpan({
        capabilityId: liveCapability.id,
        traceId,
        entityType: 'CHAT',
        entityId: liveAgent.id,
        name: `Capability chat stream: ${liveAgent.name}`,
        status: 'RUNNING',
        model: liveAgent.model,
        attributes: {
          capabilityId: liveCapability.id,
          agentId: liveAgent.id,
          streamed: true,
        },
      });
      const shouldBufferValidatedStream = Boolean(chatContext.isCodeQuestion);
      const streamed = await invokeCommonAgentRuntime({
        capability: liveCapability,
        agent: runtimeAgent,
        history: followUpContext.history,
        message: effectiveMessage,
        resetSession: body.sessionMode === 'fresh',
        scope: chatContext.chatScope,
        scopeId: chatContext.chatScopeId,
        developerPrompt: chatContext.developerPrompt,
        memoryPrompt: buildTurnMemoryPrompt({
          chatContext,
          evidencePrompt: streamMergedMemoryPrompt,
          followUpContextPrompt: followUpContext.followUpContextPrompt,
        }),
        workItem: chatContext.workItem,
        preferReadOnlyToolLoop: Boolean(chatContext.isCodeQuestion),
        allowedToolIds: runtimeAllowedToolIds,
        resolvedAgentSource: runtimeAgentSource,
        runtimeLane: 'server-runtime-route',
        onDelta: delta => {
          if (!shouldBufferValidatedStream) {
            writeSseEvent(response, 'delta', {
              type: 'delta',
              traceId,
              content: delta,
            });
          }
        },
      });
      const { promptReceipt, tokenPolicy, ...publicStreamed } = streamed as typeof streamed & {
        promptReceipt?: Record<string, unknown>;
        tokenPolicy?: Record<string, unknown>;
      };

      const sanitizedStream = await sanitizeGroundedChatResponse({
        content: publicStreamed.content || '',
        checkoutPath: chatContext.checkoutPath,
        verifiedPaths: chatContext.verifiedPaths,
        enforceEvidenceOnly: Boolean(chatContext.isCodeQuestion),
      });
      const streamDiagnostics = buildEvidenceDiagnostics({
        chatContext,
        memoryTrustMode,
        pathValidationState: sanitizedStream.pathValidationState,
        unverifiedPathClaimsRemoved: sanitizedStream.unverifiedPathClaimsRemoved,
        effectiveMessage,
        effectiveMessageSource: followUpContext.effectiveMessageSource,
        followUpIntent: followUpContext.followUpIntent,
        followUpBindingMode: followUpContext.followUpBindingMode,
        historyTurnCount: streamed.historyTurnCount || followUpContext.history.length,
        historyRolledUp: streamed.historyRolledUp,
        chatRuntimeLane: 'server-runtime-route',
        toolLoopEnabled: streamed.toolLoopEnabled,
        toolLoopReason: streamed.toolLoopReason,
        toolLoopUsed: streamed.toolLoopUsed,
        attemptedToolIds: streamed.attemptedToolIds,
        resolvedAllowedToolIds: streamed.resolvedAllowedToolIds,
        resolvedAgentSource: streamed.resolvedAgentSource,
        parsedToolIntent: streamed.parsedToolIntent,
        toolIntentDisposition: streamed.toolIntentDisposition,
        toolIntentRejectionReason: streamed.toolIntentRejectionReason,
        codeDiscoveryMode: streamed.codeDiscoveryMode,
        codeDiscoveryFallback: streamed.codeDiscoveryFallback,
        astSource: streamed.astSource,
      });
      const runtimeTarget = await resolveRuntimeTarget(
        publicStreamed.runtimeProviderKey || liveAgent.providerKey || liveAgent.provider,
      );

      await finishTelemetrySpan({
        capabilityId: liveCapability.id,
        spanId: span.id,
        status: 'OK',
        costUsd: publicStreamed.usage.estimatedCostUsd,
        tokenUsage: publicStreamed.usage,
        attributes: {
          memoryHits: memoryContext.results.length,
          streamed: true,
          sessionMode: body.sessionMode || 'resume',
          isNewSession: String(Boolean(publicStreamed.isNewSession)),
          stage: 'capability_chat',
          promptReceipt,
          tokenPolicy,
          ...streamDiagnostics,
        },
      });
      await recordUsageMetrics({
        capabilityId: liveCapability.id,
        traceId,
        scopeType: 'CHAT',
        scopeId: liveAgent.id,
        totalTokens: publicStreamed.usage.totalTokens,
        costUsd: publicStreamed.usage.estimatedCostUsd,
        tags: {
          model: publicStreamed.model,
          streamed: 'true',
          sessionMode: body.sessionMode || 'resume',
          stage: 'capability_chat',
        },
      });

      if (shouldBufferValidatedStream && sanitizedStream.content) {
        writeSseEvent(response, 'delta', {
          type: 'delta',
          traceId,
          content: sanitizedStream.content,
        });
      }
      writeSseEvent(response, 'complete', {
        type: 'complete',
        traceId,
        content: sanitizedStream.content,
        createdAt: publicStreamed.createdAt,
        model: publicStreamed.model,
        usage: publicStreamed.usage,
        runtimeProviderKey: publicStreamed.runtimeProviderKey,
        runtimeTransportMode: publicStreamed.runtimeTransportMode,
        ...runtimeTarget,
        sessionId: publicStreamed.sessionId,
        sessionScope: publicStreamed.sessionScope,
        sessionScopeId: publicStreamed.sessionScopeId,
        isNewSession: publicStreamed.isNewSession,
        sessionMode: body.sessionMode || 'resume',
        memoryReferences: memoryContext.results.map(result => result.reference),
        ...streamDiagnostics,
      });
      response.end();

      // Persist tool-loop narration as hidden chat rows (see /api/runtime/chat
      // non-streaming route above for the rationale).
      const streamToolHistoryRows = (publicStreamed as unknown as {
        toolHistory?: Array<{ role: 'user' | 'agent'; content: string }>;
      }).toolHistory;
      if (streamToolHistoryRows && streamToolHistoryRows.length > 0) {
        const baseTimestamp = new Date();
        for (const [index, entry] of streamToolHistoryRows.entries()) {
          const stamp = new Date(baseTimestamp.getTime() + index).toISOString();
          await appendCapabilityMessageRecord(liveCapability.id, {
            id: `${traceId || stamp}-tool-${index}`,
            role: entry.role === 'agent' ? 'agent' : 'user',
            content: entry.content,
            timestamp: stamp,
            agentId: liveAgent.id,
            agentName: liveAgent.name,
            traceId,
            sessionId: publicStreamed.sessionId || undefined,
            sessionScope: chatContext.chatScope || undefined,
            sessionScopeId: chatContext.chatScopeId || undefined,
            workItemId: body.workItemId || undefined,
            runId: body.runId || undefined,
            workflowStepId: body.workflowStepId || undefined,
            hidden: true,
          }).catch(err => {
            console.warn(
              '[chat-audit] failed to persist tool-history row:',
              err instanceof Error ? err.message : err,
            );
          });
        }
      }

      // Fire-and-forget audit record (same as the non-streaming route).
      void auditRuntimeChatTurn({
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        agentName: liveAgent.name,
        userMessage: originalMessage,
        agentMessage: sanitizedStream.content || '',
        model: publicStreamed.model || null,
        traceId,
        sessionId: publicStreamed.sessionId || null,
        sessionScope: chatContext.chatScope || null,
        sessionScopeId: chatContext.chatScopeId || null,
        workItemId: body.workItemId || null,
        runId: body.runId || null,
        sourceCapabilityId: usingForeignAgent
          ? foreignParticipant!.capabilityId
          : liveCapability.id,
      }).catch(err => {
        console.warn('[chat-audit] failed to persist stream chat turn:', err instanceof Error ? err.message : err);
      });
      if (
        sanitizedStream.pathValidationState === 'repaired' ||
        sanitizedStream.pathValidationState === 'stripped'
      ) {
        void evictManagedCapabilitySessions({
          capabilityId: liveCapability.id,
          agentId: liveAgent.id,
          scope: chatContext.chatScope,
          scopeId: chatContext.chatScopeId,
        }).catch(() => undefined);
      }
      maybeRefreshCodeGroundingMemory(
        liveCapability.id,
        Boolean(chatContext.isCodeQuestion),
      );
    } catch (error) {
      writeSseEvent(response, 'error', {
        type: 'error',
        traceId,
        sessionMode: body.sessionMode || 'resume',
        retryAfterMs:
          error instanceof GitHubProviderRateLimitError ? error.retryAfterMs : undefined,
        error:
          error instanceof Error
            ? error.message
            : 'The backend runtime could not complete this streaming request.',
      });
      response.end();
    }
  });
};
