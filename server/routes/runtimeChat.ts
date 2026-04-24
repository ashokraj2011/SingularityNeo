import type express from 'express';
import type { Capability, CapabilityAgent, CapabilityWorkspace } from '../../src/types';
import { assertCapabilityPermission } from '../access';
import { GitHubProviderRateLimitError, type ChatHistoryMessage } from '../githubModels';
import { auditRuntimeChatTurn, getCapabilityBundle } from '../repository';
import { parseActorContext } from '../requestActor';
import { resolveAuthorizedSwarmParticipants } from '../swarmParticipants';
import { wakeExecutionWorker } from '../execution/worker';
import { sendApiError } from '../api/errors';

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
  memoryQueryText: string;
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
  finishTelemetrySpan: typeof import('../telemetry').finishTelemetrySpan;
  getMissingRuntimeConfigurationMessage: () => string;
  invokeCapabilityChat: typeof import('../githubModels').invokeCapabilityChat;
  invokeCapabilityChatStream: typeof import('../githubModels').invokeCapabilityChatStream;
  isRuntimeConfigured: () => boolean;
  maybeHandleCapabilityChatAction: typeof import('../chatWorkspace').maybeHandleCapabilityChatAction;
  recordUsageMetrics: typeof import('../telemetry').recordUsageMetrics;
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
    finishTelemetrySpan,
    getMissingRuntimeConfigurationMessage,
    invokeCapabilityChat,
    invokeCapabilityChatStream,
    isRuntimeConfigured,
    maybeHandleCapabilityChatAction,
    recordUsageMetrics,
    resolveChatRuntimeContext,
    startTelemetrySpan,
    writeSseEvent,
    GitHubProviderRateLimitError,
  }: RuntimeChatRouteDeps,
) => {
  app.post('/api/runtime/chat', async (request, response) => {
    const body = request.body as ChatRequestBody;
    const message = body.message?.trim();
    if (!message || !body.capability || !body.agent) {
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
      const homeBundle = taggedParticipant?.bundle || anchorBundle;

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
      const chatAction = await maybeHandleCapabilityChatAction({
        bundle,
        agent: liveAgent,
        message,
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
        body,
        bundle,
        liveAgent,
      });
      const anchorMemoryContext = await buildMemoryContext({
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        queryText: chatContext.memoryQueryText || message,
      });
      // Merged-memory slice (plan §3c) — when the speaking agent lives in a
      // different capability, pull its home memory too so it brings its own
      // lived context into the anchor conversation.
      const homeMemoryContext =
        usingForeignAgent && taggedParticipant
          ? await buildMemoryContext({
              capabilityId: taggedParticipant.capabilityId,
              agentId: taggedParticipant.agentId,
              queryText: chatContext.memoryQueryText || message,
            }).catch(() => null)
          : null;
      const memoryContext = anchorMemoryContext;
      const mergedMemoryPrompt = [
        anchorMemoryContext.prompt,
        homeMemoryContext?.prompt
          ? `Home-capability memory (${taggedParticipant!.capabilityId}):\n${homeMemoryContext.prompt}`
          : null,
      ]
        .filter(Boolean)
        .join('\n\n');
      const chatResponse = await invokeCapabilityChat({
        capability: liveCapability,
        agent: liveAgent,
        history: body.history || [],
        message,
        resetSession: body.sessionMode === 'fresh',
        scope: chatContext.chatScope,
        scopeId: chatContext.chatScopeId,
        developerPrompt: chatContext.developerPrompt,
        memoryPrompt: buildChatMemoryPrompt({
          liveBriefing: chatContext.liveBriefing,
          memoryPrompt: mergedMemoryPrompt,
        }),
      });
      const { promptReceipt, tokenPolicy, ...publicChatResponse } = chatResponse as typeof chatResponse & {
        promptReceipt?: Record<string, unknown>;
        tokenPolicy?: Record<string, unknown>;
      };
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
        traceId,
        sessionMode: body.sessionMode || 'resume',
        memoryReferences: memoryContext.results.map(result => result.reference),
      });

      // Fire-and-forget audit record so desktop chat turns are always
      // traceable on the control plane, even if the operator never
      // explicitly saves them as evidence.
      void auditRuntimeChatTurn({
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        agentName: liveAgent.name,
        userMessage: message,
        agentMessage: publicChatResponse.content || '',
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
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/runtime/chat/stream', async (request, response) => {
    const body = request.body as ChatRequestBody;
    const message = body.message?.trim();
    if (!message || !body.capability || !body.agent) {
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
      const homeBundle = foreignParticipant?.bundle || anchorBundle;

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
      const chatAction = await maybeHandleCapabilityChatAction({
        bundle,
        agent: liveAgent,
        message,
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
        body,
        bundle,
        liveAgent,
      });
      const anchorMemoryContext = await buildMemoryContext({
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        queryText: chatContext.memoryQueryText || message,
      });
      const streamHomeMemoryContext =
        usingForeignAgent && foreignParticipant
          ? await buildMemoryContext({
              capabilityId: foreignParticipant.capabilityId,
              agentId: foreignParticipant.agentId,
              queryText: chatContext.memoryQueryText || message,
            }).catch(() => null)
          : null;
      const memoryContext = anchorMemoryContext;
      const streamMergedMemoryPrompt = [
        anchorMemoryContext.prompt,
        streamHomeMemoryContext?.prompt
          ? `Home-capability memory (${foreignParticipant!.capabilityId}):\n${streamHomeMemoryContext.prompt}`
          : null,
      ]
        .filter(Boolean)
        .join('\n\n');
      writeSseEvent(response, 'memory', {
        type: 'memory',
        traceId,
        memoryReferences: memoryContext.results.map(result => result.reference),
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
      const streamed = await invokeCapabilityChatStream({
        capability: liveCapability,
        agent: liveAgent,
        history: body.history || [],
        message,
        resetSession: body.sessionMode === 'fresh',
        scope: chatContext.chatScope,
        scopeId: chatContext.chatScopeId,
        developerPrompt: chatContext.developerPrompt,
        memoryPrompt: buildChatMemoryPrompt({
          liveBriefing: chatContext.liveBriefing,
          memoryPrompt: streamMergedMemoryPrompt,
        }),
        onDelta: delta => {
          writeSseEvent(response, 'delta', {
            type: 'delta',
            traceId,
            content: delta,
          });
        },
      });
      const { promptReceipt, tokenPolicy, ...publicStreamed } = streamed as typeof streamed & {
        promptReceipt?: Record<string, unknown>;
        tokenPolicy?: Record<string, unknown>;
      };

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

      writeSseEvent(response, 'complete', {
        type: 'complete',
        traceId,
        content: publicStreamed.content,
        createdAt: publicStreamed.createdAt,
        model: publicStreamed.model,
        usage: publicStreamed.usage,
        sessionId: publicStreamed.sessionId,
        sessionScope: publicStreamed.sessionScope,
        sessionScopeId: publicStreamed.sessionScopeId,
        isNewSession: publicStreamed.isNewSession,
        sessionMode: body.sessionMode || 'resume',
        memoryReferences: memoryContext.results.map(result => result.reference),
      });
      response.end();

      // Fire-and-forget audit record (same as the non-streaming route).
      void auditRuntimeChatTurn({
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        agentName: liveAgent.name,
        userMessage: message,
        agentMessage: publicStreamed.content || '',
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
