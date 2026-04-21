import type express from 'express';
import type { Capability, CapabilityAgent, CapabilityWorkspace } from '../../src/types';
import type { ChatHistoryMessage } from '../githubModels';
import { getCapabilityBundle } from '../repository';
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

    try {
      const bundle = await getCapabilityBundle(body.capability.id);
      const liveAgent =
        bundle.workspace.agents.find(agent => agent.id === body.agent?.id) || body.agent;
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
      const memoryContext = await buildMemoryContext({
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        queryText: chatContext.memoryQueryText || message,
      });
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
          memoryPrompt: memoryContext.prompt,
        }),
      });
      await finishTelemetrySpan({
        capabilityId: liveCapability.id,
        spanId: span.id,
        status: 'OK',
        costUsd: chatResponse.usage.estimatedCostUsd,
        tokenUsage: chatResponse.usage,
        attributes: {
          memoryHits: memoryContext.results.length,
          sessionMode: body.sessionMode || 'resume',
          isNewSession: String(Boolean(chatResponse.isNewSession)),
        },
      });
      await recordUsageMetrics({
        capabilityId: liveCapability.id,
        traceId,
        scopeType: 'CHAT',
        scopeId: liveAgent.id,
        totalTokens: chatResponse.usage.totalTokens,
        costUsd: chatResponse.usage.estimatedCostUsd,
        tags: {
          model: chatResponse.model,
          sessionMode: body.sessionMode || 'resume',
        },
      });

      response.json({
        ...chatResponse,
        traceId,
        sessionMode: body.sessionMode || 'resume',
        memoryReferences: memoryContext.results.map(result => result.reference),
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
      const bundle = await getCapabilityBundle(body.capability.id);
      const liveAgent =
        bundle.workspace.agents.find(agent => agent.id === body.agent?.id) || body.agent;
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
      const memoryContext = await buildMemoryContext({
        capabilityId: liveCapability.id,
        agentId: liveAgent.id,
        queryText: chatContext.memoryQueryText || message,
      });
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
          memoryPrompt: memoryContext.prompt,
        }),
        onDelta: delta => {
          writeSseEvent(response, 'delta', {
            type: 'delta',
            traceId,
            content: delta,
          });
        },
      });

      await finishTelemetrySpan({
        capabilityId: liveCapability.id,
        spanId: span.id,
        status: 'OK',
        costUsd: streamed.usage.estimatedCostUsd,
        tokenUsage: streamed.usage,
        attributes: {
          memoryHits: memoryContext.results.length,
          streamed: true,
          sessionMode: body.sessionMode || 'resume',
          isNewSession: String(Boolean(streamed.isNewSession)),
        },
      });
      await recordUsageMetrics({
        capabilityId: liveCapability.id,
        traceId,
        scopeType: 'CHAT',
        scopeId: liveAgent.id,
        totalTokens: streamed.usage.totalTokens,
        costUsd: streamed.usage.estimatedCostUsd,
        tags: {
          model: streamed.model,
          streamed: 'true',
          sessionMode: body.sessionMode || 'resume',
        },
      });

      writeSseEvent(response, 'complete', {
        type: 'complete',
        traceId,
        content: streamed.content,
        createdAt: streamed.createdAt,
        model: streamed.model,
        usage: streamed.usage,
        sessionId: streamed.sessionId,
        sessionScope: streamed.sessionScope,
        sessionScopeId: streamed.sessionScopeId,
        isNewSession: streamed.isNewSession,
        sessionMode: body.sessionMode || 'resume',
        memoryReferences: memoryContext.results.map(result => result.reference),
      });
      response.end();
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
