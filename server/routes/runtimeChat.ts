import type express from 'express';
import type { Capability, CapabilityAgent, CapabilityWorkspace } from '../../src/types';
import type { ChatHistoryMessage } from '../githubModels';
import { auditRuntimeChatTurn, getCapabilityBundle } from '../repository';
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
