import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Brain,
  Cpu,
  Database,
  Forward,
  History,
  LoaderCircle,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  StopCircle,
  User,
  XCircle,
} from 'lucide-react';
import {
  fetchRuntimeStatus,
  refreshAgentLearningProfile,
  streamCapabilityChat,
  type RuntimeStatus,
  type RuntimeUsage,
} from '../lib/api';
import { EmptyState, StatusBadge } from '../components/EnterpriseUI';
import { AdvancedDisclosure } from '../components/WorkspaceUI';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import type { AgentSessionSummary, CapabilityChatMessage, MemoryReference } from '../types';
import { cn } from '../lib/utils';
import { readViewPreference, writeViewPreference } from '../lib/viewPreferences';
import {
  buildCapabilityExperience,
  getAgentHealth,
} from '../lib/capabilityExperience';

type SessionMode = 'resume' | 'fresh';
type InspectorTab = 'agent' | 'learning' | 'memory' | 'session' | 'diagnostics';
type MessageDeliveryState = 'clean' | 'recovered' | 'interrupted';

type ChatMessageAnnotation = {
  deliveryState: MessageDeliveryState;
  traceId?: string;
  model?: string;
  usage?: RuntimeUsage;
  memoryReferences?: MemoryReference[];
  error?: string;
  requestMessage?: string;
  sessionId?: string;
  sessionScope?: AgentSessionSummary['scope'];
  sessionScopeId?: string;
  isNewSession?: boolean;
  sessionMode?: SessionMode;
};

const INSPECTOR_OPEN_KEY = 'singularity.chat.inspector.open';
const INSPECTOR_TAB_KEY = 'singularity.chat.inspector.tab';

const formatTimestamp = (value = new Date()) =>
  value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

const formatDateTime = (value?: string) => {
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

const summarizeOutput = (value: string) =>
  value.replace(/\s+/g, ' ').trim().slice(0, 220);

const formatCompactNumber = (value?: number) =>
  new Intl.NumberFormat().format(Number.isFinite(value || 0) ? Number(value || 0) : 0);

const formatUsageLabel = (usage?: RuntimeUsage) =>
  usage ? `${formatCompactNumber(usage.totalTokens)} tokens` : 'Usage unavailable';

const formatSessionScope = (scope?: AgentSessionSummary['scope']) =>
  scope
    ? scope
        .split('_')
        .map(part => `${part.slice(0, 1)}${part.slice(1).toLowerCase()}`)
        .join(' ')
    : 'General Chat';

const defaultInspectorOpen = () => {
  if (typeof window === 'undefined') {
    return true;
  }

  const stored = readViewPreference<'0' | '1' | 'auto'>(INSPECTOR_OPEN_KEY, 'auto', {
    allowed: ['0', '1', 'auto'] as const,
  });
  if (stored === '1') {
    return true;
  }
  if (stored === '0') {
    return false;
  }

  return window.innerWidth >= 1440;
};

const defaultInspectorTab = (): InspectorTab => {
  return readViewPreference<InspectorTab>(INSPECTOR_TAB_KEY, 'agent', {
    allowed: ['agent', 'learning', 'memory', 'session'] as const,
  });
};

const getLearningTone = (
  status?: string,
): 'success' | 'info' | 'warning' | 'danger' | 'neutral' => {
  switch (status) {
    case 'READY':
      return 'success';
    case 'LEARNING':
    case 'QUEUED':
      return 'info';
    case 'STALE':
      return 'warning';
    case 'ERROR':
      return 'danger';
    default:
      return 'neutral';
  }
};

const getLearningSummaryText = (learningProfile: {
  status?: string;
  summary?: string;
  lastError?: string;
}) => {
  if (learningProfile.summary?.trim()) {
    return learningProfile.summary.trim();
  }

  if (learningProfile.status === 'ERROR') {
    return (
      learningProfile.lastError ||
      'Learning failed. Refresh the learning profile after validating the runtime model and Copilot configuration.'
    );
  }

  return 'This collaborator is preparing its capability context.';
};

const getDeliveryTone = (
  deliveryState?: MessageDeliveryState,
): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (deliveryState) {
    case 'recovered':
      return 'warning';
    case 'interrupted':
      return 'danger';
    case 'clean':
      return 'success';
    default:
      return 'neutral';
  }
};

const getDeliveryLabel = (deliveryState?: MessageDeliveryState) => {
  switch (deliveryState) {
    case 'recovered':
      return 'Recovered draft';
    case 'interrupted':
      return 'Interrupted';
    case 'clean':
      return 'Completed';
    default:
      return '';
  }
};

const DEFAULT_RATE_LIMIT_RETRY_MS = 60_000;

const formatRemainingRetry = (ms: number) => {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
};

const formatChatRuntimeError = (value: string) => {
  if (
    /Too many requests/i.test(value) ||
    /rate[- ]limit/i.test(value)
  ) {
    return 'GitHub Models is rate-limiting requests for this workspace right now. Wait a minute and try again.';
  }

  return value;
};

const resizeComposer = (element: HTMLTextAreaElement | null) => {
  if (!element) {
    return;
  }

  element.style.height = '0px';
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
};

const Chat = () => {
  const {
    activeCapability,
    appendCapabilityMessage,
    getCapabilityWorkspace,
    refreshCapabilityBundle,
    setActiveChatAgent,
    setCapabilityWorkspaceContent,
  } = useCapability();
  const { error: showError, info, success, warning } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [configError, setConfigError] = useState('');
  const [streamedDraft, setStreamedDraft] = useState('');
  const [lastMemoryReferences, setLastMemoryReferences] = useState<MemoryReference[]>([]);
  const [pendingSessionMode, setPendingSessionMode] = useState<SessionMode>('resume');
  const [inspectorOpen, setInspectorOpen] = useState(defaultInspectorOpen);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(defaultInspectorTab);
  const [refreshingAgentId, setRefreshingAgentId] = useState('');
  const [messageAnnotations, setMessageAnnotations] = useState<
    Record<string, ChatMessageAnnotation>
  >({});
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [runtimeErrorDetail, setRuntimeErrorDetail] = useState('');
  const [diagnosticsOpenSignal, setDiagnosticsOpenSignal] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [lastSessionSnapshot, setLastSessionSnapshot] = useState<{
    sessionId?: string;
    sessionScope?: AgentSessionSummary['scope'];
    sessionScopeId?: string;
    isNewSession?: boolean;
    sessionMode: SessionMode;
    createdAt?: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const rateLimitRemainingMs = rateLimitUntil ? Math.max(0, rateLimitUntil - now) : 0;
  const rateLimited = rateLimitRemainingMs > 0;

  const activeAgent =
    workspace.agents.find(agent => agent.id === workspace.activeChatAgentId) ||
    workspace.agents.find(agent => agent.isOwner) ||
    workspace.agents[0];

  const generalChatSession = useMemo(
    () =>
      activeAgent?.sessionSummaries.find(
        session =>
          session.scope === 'GENERAL_CHAT' &&
          (!session.scopeId || session.scopeId === activeCapability.id),
      ) ||
      activeAgent?.sessionSummaries[0],
    [activeAgent, activeCapability.id],
  );
  const capabilityExperience = useMemo(
    () =>
      buildCapabilityExperience({
        capability: activeCapability,
        workspace,
        runtimeStatus,
      }),
    [activeCapability, runtimeStatus, workspace],
  );
  const activeAgentHealth = getAgentHealth(activeAgent);
  const hasPendingLearning = useMemo(
    () =>
      workspace.agents.some(agent =>
        ['QUEUED', 'LEARNING', 'STALE'].includes(agent.learningProfile.status),
      ),
    [workspace.agents],
  );

  const handleRefreshLearning = async (agentId: string, agentName: string) => {
    if (!agentId || refreshingAgentId === agentId) {
      return;
    }

    setRefreshingAgentId(agentId);

    try {
      await refreshAgentLearningProfile(activeCapability.id, agentId);
      await refreshCapabilityBundle(activeCapability.id);
      success(
        'Learning refresh queued',
        `${agentName} is refreshing its capability learning profile.`,
      );
    } catch (nextError) {
      const description =
        nextError instanceof Error
          ? nextError.message
          : 'Unable to queue the learning refresh right now.';
      showError('Learning refresh failed', description);
    } finally {
      setRefreshingAgentId('');
    }
  };

  const filteredMessages = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return workspace.messages;
    }

    return workspace.messages.filter(message =>
      [message.content, message.agentName, message.role]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [searchQuery, workspace.messages]);

  const runtimeIdentityLabel = runtimeStatus?.githubIdentity
    ? [
        runtimeStatus.githubIdentity.name || null,
        runtimeStatus.githubIdentity.login
          ? `@${runtimeStatus.githubIdentity.login}`
          : null,
      ]
        .filter(Boolean)
        .join(' ')
    : 'Unknown';

  useEffect(() => {
    let isMounted = true;

    fetchRuntimeStatus()
      .then(nextStatus => {
        if (!isMounted) {
          return;
        }

        setRuntimeStatus(nextStatus);
        setConfigError('');
      })
      .catch(nextError => {
        if (!isMounted) {
          return;
        }

        setConfigError(
          nextError instanceof Error
            ? nextError.message
            : 'Unable to load backend runtime configuration.',
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    void refreshCapabilityBundle(activeCapability.id);
  }, [activeCapability.id, refreshCapabilityBundle]);

  useEffect(() => {
    if (!hasPendingLearning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      void refreshCapabilityBundle(activeCapability.id);
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeCapability.id, hasPendingLearning, refreshCapabilityBundle]);

  useEffect(() => {
    resizeComposer(composerRef.current);
  }, [input]);

  useEffect(() => {
    if (!rateLimited) {
      return;
    }

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [rateLimited]);

  useEffect(() => {
    if (!rateLimitUntil) {
      return;
    }

    if (Date.now() >= rateLimitUntil) {
      setRateLimitUntil(null);
      setNow(Date.now());
      setError(current =>
        /rate-limiting requests for this workspace right now/i.test(current) ? '' : current,
      );
    }
  }, [now, rateLimitUntil]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredMessages.length, isSending, streamedDraft, activeCapability.id, activeAgent?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    writeViewPreference(INSPECTOR_OPEN_KEY, inspectorOpen ? '1' : '0');
  }, [inspectorOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    writeViewPreference(INSPECTOR_TAB_KEY, inspectorTab);
  }, [inspectorTab]);

  useEffect(() => {
    setError('');
    setStreamedDraft('');
    setSearchQuery('');
    setLastMemoryReferences([]);
    setPendingSessionMode('resume');
    setLastSessionSnapshot(null);
    setMessageAnnotations({});
  }, [activeCapability.id]);

  useEffect(() => {
    setStreamedDraft('');
    setLastMemoryReferences([]);
    setPendingSessionMode('resume');
  }, [activeAgent?.id]);

  const persistMessageAnnotation = (messageId: string, annotation: ChatMessageAnnotation) => {
    setMessageAnnotations(current => ({
      ...current,
      [messageId]: {
        ...current[messageId],
        ...annotation,
      },
    }));
  };

  const recordExecutionLog = async ({
    agentMessageId,
    content,
    model,
    traceId,
    usage,
    memoryReferences,
    deliveryState,
    createdAt,
  }: {
    agentMessageId: string;
    content: string;
    model?: string;
    traceId?: string;
    usage?: RuntimeUsage;
    memoryReferences: MemoryReference[];
    deliveryState: MessageDeliveryState;
    createdAt: string;
  }) => {
    const latestWorkspace = getCapabilityWorkspace(activeCapability.id);

    await setCapabilityWorkspaceContent(activeCapability.id, {
      executionLogs: [
        ...latestWorkspace.executionLogs,
        {
          id: `LOG-CHAT-${Date.now()}`,
          taskId: `CHAT-${agentMessageId}`,
          capabilityId: activeCapability.id,
          agentId: activeAgent?.id || '',
          timestamp: createdAt,
          level: deliveryState === 'interrupted' ? 'WARN' : 'INFO',
          message:
            deliveryState === 'clean'
              ? `Completed streamed capability chat response with ${model || activeAgent?.model}.`
              : deliveryState === 'recovered'
                ? `Recovered a streamed draft for ${activeAgent?.name || 'the active agent'} after the backend stream ended early.`
                : `Preserved an interrupted streamed draft for ${activeAgent?.name || 'the active agent'}.`,
          traceId,
          metadata: {
            requestType: 'CHAT',
            model: model || activeAgent?.model,
            promptTokens: usage?.promptTokens || 0,
            completionTokens: usage?.completionTokens || 0,
            totalTokens: usage?.totalTokens || 0,
            estimatedCostUsd: usage?.estimatedCostUsd || 0,
            memoryHits: memoryReferences.length,
            outputTitle: `${activeAgent?.name || 'Capability agent'} chat response`,
            outputSummary: summarizeOutput(content),
            outputStatus: deliveryState === 'interrupted' ? 'interrupted' : 'completed',
          },
        },
      ],
    });
  };

  const sendMessage = async (
    rawMessage: string,
    options?: {
      sessionMode?: SessionMode;
    },
  ) => {
    if (!activeAgent || isSending) {
      return;
    }

    const userContent = rawMessage.trim();
    if (!userContent) {
      return;
    }

    if (!runtimeStatus?.configured) {
      setError(
        'The backend runtime is not configured yet. Set COPILOT_CLI_URL for a headless Copilot CLI server or add GITHUB_MODELS_TOKEN to .env.local, then restart npm run dev.',
      );
      return;
    }

    if (rateLimited) {
      setError(
        `GitHub Models is rate-limiting requests for this workspace right now. Try again in ${formatRemainingRetry(rateLimitRemainingMs)}.`,
      );
      return;
    }

    const requestedSessionMode = options?.sessionMode || pendingSessionMode;
    const userMessageId = `${Date.now()}-user`;
    const userTimestamp = formatTimestamp();
    const historyForRequest = [
      ...workspace.messages.slice(-10),
      {
        id: userMessageId,
        capabilityId: activeCapability.id,
        role: 'user' as const,
        content: userContent,
        timestamp: userTimestamp,
      },
    ];

    setInput('');
    setError('');
    setRuntimeErrorDetail('');
    setIsSending(true);
    setStreamedDraft('');
    setLastMemoryReferences([]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await appendCapabilityMessage(activeCapability.id, {
        id: userMessageId,
        role: 'user',
        content: userContent,
        timestamp: userTimestamp,
      });

      const streamResult = await streamCapabilityChat(
        {
          capability: activeCapability,
          agent: activeAgent,
          history: historyForRequest,
          message: userContent,
          sessionMode: requestedSessionMode,
        },
        {
          onEvent: event => {
            if (event.type === 'memory') {
              setLastMemoryReferences(event.memoryReferences || []);
              return;
            }

            if (event.type === 'delta' && event.content) {
              setStreamedDraft(current => current + event.content);
              return;
            }

            if (event.type === 'complete') {
              setLastMemoryReferences(event.memoryReferences || []);
              return;
            }

            if (event.type === 'error' && event.error) {
              setRuntimeErrorDetail(event.error);
            }

            if (event.type === 'error' && event.retryAfterMs) {
              setRateLimitUntil(Date.now() + event.retryAfterMs);
            }
          },
        },
        {
          signal: abortController.signal,
        },
      );

      const finalContent =
        streamResult.completeEvent?.content || streamResult.draftContent;

      if (streamResult.termination === 'empty' || !finalContent.trim()) {
        if (streamResult.error?.includes('stopped')) {
          info(
            'Response stopped',
            'The stream was stopped before any assistant content arrived.',
          );
          return;
        }

        throw new Error(
          streamResult.error || 'The backend runtime did not return a response.',
        );
      }

      const agentMessageId = `${Date.now()}-agent`;
      const createdAt =
        streamResult.completeEvent?.createdAt || new Date().toISOString();
      const deliveryState: MessageDeliveryState =
        streamResult.termination === 'complete'
          ? 'clean'
          : streamResult.termination === 'recovered'
            ? 'recovered'
            : 'interrupted';

      await appendCapabilityMessage(activeCapability.id, {
        id: agentMessageId,
        role: 'agent',
        content: finalContent,
        timestamp: formatTimestamp(new Date(createdAt)),
        agentId: activeAgent.id,
        agentName: activeAgent.name,
      });

      persistMessageAnnotation(agentMessageId, {
        deliveryState,
        traceId: streamResult.completeEvent?.traceId,
        model: streamResult.completeEvent?.model || activeAgent.model,
        usage: streamResult.completeEvent?.usage,
        memoryReferences: streamResult.memoryReferences,
        error: streamResult.error,
        requestMessage: userContent,
        sessionId: streamResult.completeEvent?.sessionId,
        sessionScope: streamResult.completeEvent?.sessionScope,
        sessionScopeId: streamResult.completeEvent?.sessionScopeId,
        isNewSession: streamResult.completeEvent?.isNewSession,
        sessionMode: requestedSessionMode,
      });

      setLastSessionSnapshot({
        sessionId: streamResult.completeEvent?.sessionId,
        sessionScope: streamResult.completeEvent?.sessionScope,
        sessionScopeId: streamResult.completeEvent?.sessionScopeId,
        isNewSession: streamResult.completeEvent?.isNewSession,
        sessionMode: requestedSessionMode,
        createdAt,
      });

      setStreamedDraft('');

      await recordExecutionLog({
        agentMessageId,
        content: finalContent,
        model: streamResult.completeEvent?.model || activeAgent.model,
        traceId: streamResult.completeEvent?.traceId,
        usage: streamResult.completeEvent?.usage,
        memoryReferences: streamResult.memoryReferences,
        deliveryState,
        createdAt,
      });

      if (deliveryState === 'recovered') {
        warning(
          'Recovered streamed draft',
          'The stream ended without a final payload, so the assistant draft was preserved.',
        );
      }

      if (deliveryState === 'interrupted') {
        warning(
          'Response interrupted',
          'A partial assistant draft was preserved. Retry or continue when ready.',
        );
      }

      if (requestedSessionMode === 'fresh') {
        info(
          'Fresh session started',
          `${activeAgent.name} started a new Copilot session for this turn.`,
        );
      }
    } catch (nextError) {
      setStreamedDraft('');
      const normalizedError =
        nextError instanceof Error
          ? formatChatRuntimeError(nextError.message)
          : 'The backend runtime could not complete this request.';
      const rawRuntimeError =
        nextError instanceof Error ? nextError.message : normalizedError;
      const retryAfterMs =
        nextError instanceof Error &&
        (/Too many requests/i.test(nextError.message) || /rate[- ]limit/i.test(nextError.message))
          ? DEFAULT_RATE_LIMIT_RETRY_MS
          : 0;
      if (retryAfterMs > 0) {
        setRateLimitUntil(Date.now() + retryAfterMs);
      }
      setRuntimeErrorDetail(rawRuntimeError);
      setError(
        normalizedError,
      );
    } finally {
      abortControllerRef.current = null;
      setIsSending(false);
      if (requestedSessionMode === 'fresh') {
        setPendingSessionMode('resume');
      }
    }
  };

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    await sendMessage(input);
  };

  const handleRetry = async (messageId: string) => {
    const annotation = messageAnnotations[messageId];
    if (!annotation?.requestMessage || isSending) {
      return;
    }

    await sendMessage(annotation.requestMessage, {
      sessionMode: 'fresh',
    });
  };

  const handleContinue = async (messageId: string) => {
    if (isSending) {
      return;
    }

    const annotation = messageAnnotations[messageId];
    const prompt =
      annotation?.deliveryState === 'interrupted'
        ? 'Continue from the previously interrupted response using the same capability context. Do not repeat content that was already completed.'
        : 'Continue the current response using the same capability context.';

    await sendMessage(prompt, {
      sessionMode: 'resume',
    });
  };

  const handleStopStreaming = () => {
    abortControllerRef.current?.abort();
  };

  const runtimeBadge = runtimeStatus?.configured
    ? {
        icon: ShieldCheck,
        tone: 'success' as const,
        label: 'Connected',
        helper: 'Agent connection is ready',
      }
    : {
        icon: AlertTriangle,
        tone: 'warning' as const,
        label: 'Needs Copilot setup',
        helper: 'Open context',
      };

  const commandStripSummary = pendingSessionMode === 'fresh'
    ? 'Next turn starts a fresh Copilot session'
    : generalChatSession
      ? `Resuming ${formatSessionScope(generalChatSession.scope).toLowerCase()} context`
      : 'First chat session for this agent';

  const suggestedPrompts = useMemo(() => {
    const prompts = [
      `What is the next best action for ${activeCapability.name}?`,
      `Summarize ${activeCapability.name} readiness in business language.`,
    ];

    const attentionItem = workspace.workItems.find(item =>
      ['BLOCKED', 'PENDING_APPROVAL'].includes(item.status),
    );
    if (attentionItem) {
      prompts.push(`Explain what is needed to move "${attentionItem.title}" forward.`);
    } else if (capabilityExperience.readinessScore < 100) {
      prompts.push('What setup gaps should we close before starting work?');
    } else {
      prompts.push('Create a simple business update for current active work.');
    }

    if (workspace.artifacts.length > 0) {
      prompts.push('Summarize the latest evidence and outputs produced so far.');
    } else {
      prompts.push('What artifacts should this capability produce during delivery?');
    }

    return prompts.slice(0, 4);
  }, [
    activeCapability.name,
    capabilityExperience.readinessScore,
    workspace.artifacts.length,
    workspace.workItems,
  ]);

  const renderMessage = (message: CapabilityChatMessage) => {
    const annotation = messageAnnotations[message.id];
    const isUser = message.role === 'user';

    return (
      <div
        key={message.id}
        className={cn(
          'flex gap-3',
          isUser ? 'justify-end' : 'justify-start',
        )}
      >
        <div
          className={cn(
            'flex min-w-0 max-w-[min(78ch,85%)] gap-3',
            isUser ? 'flex-row-reverse' : 'flex-row',
          )}
        >
          <div
            className={cn(
              'mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border shadow-sm',
              isUser
                ? 'border-primary/20 bg-primary text-white'
                : 'border-slate-200 bg-slate-900 text-white',
            )}
          >
            {isUser ? <User size={18} /> : <Cpu size={18} />}
          </div>

          <div className="min-w-0 space-y-2">
            <div
              className={cn(
                'flex flex-wrap items-center gap-2 text-[0.6875rem] font-medium',
                isUser ? 'justify-end text-slate-500' : 'justify-start text-slate-500',
              )}
            >
              <span className="font-semibold uppercase tracking-[0.16em] text-slate-400">
                {isUser ? 'You' : message.agentName || activeAgent?.name || 'Capability Agent'}
              </span>
              <span>{message.timestamp}</span>
              {annotation?.deliveryState ? (
                <StatusBadge tone={getDeliveryTone(annotation.deliveryState)}>
                  {getDeliveryLabel(annotation.deliveryState)}
                </StatusBadge>
              ) : null}
            </div>

            <div
              className={cn(
                'rounded-[22px] border px-4 py-3.5 shadow-sm',
                isUser
                  ? 'rounded-tr-md border-primary/15 bg-primary text-white'
                  : annotation?.deliveryState === 'interrupted'
                    ? 'rounded-tl-md border-rose-200 bg-rose-50/80 text-slate-900'
                    : annotation?.deliveryState === 'recovered'
                      ? 'rounded-tl-md border-amber-200 bg-amber-50/80 text-slate-900'
                      : 'rounded-tl-md border-slate-200 bg-white text-slate-900',
              )}
            >
              <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>

              {!isUser && (annotation?.model || annotation?.usage || annotation?.traceId) ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3 text-[0.6875rem] text-slate-500">
                  {annotation.model ? <span>{annotation.model}</span> : null}
                  {annotation.usage ? <span>{formatUsageLabel(annotation.usage)}</span> : null}
                  {annotation.memoryReferences?.length ? (
                    <span>{annotation.memoryReferences.length} memory sources</span>
                  ) : null}
                  {annotation.traceId ? <span>Trace {annotation.traceId.slice(-8)}</span> : null}
                </div>
              ) : null}

              {!isUser && annotation?.deliveryState === 'interrupted' ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rose-200 pt-3">
                  <button
                    type="button"
                    onClick={() => void handleRetry(message.id)}
                    disabled={isSending}
                    className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCcw size={14} />
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleContinue(message.id)}
                    disabled={isSending}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Forward size={14} />
                    Continue
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const openDiagnosticsPanel = () => {
    setInspectorOpen(true);
    setInspectorTab('session');
    setDiagnosticsOpenSignal(value => value + 1);
    writeViewPreference('singularity.chat.diagnostics.open', 'open');
  };

  const handleAgentSwitch = async (agentId: string) => {
    if (!agentId || agentId === activeAgent?.id) {
      return;
    }

    try {
      await setActiveChatAgent(activeCapability.id, agentId);
    } catch (nextError) {
      showError(
        'Agent switch failed',
        nextError instanceof Error
          ? nextError.message
          : 'Unable to switch the active collaboration agent.',
      );
    }
  };

  const renderInspector = () => {
    if (!activeAgent) {
      return null;
    }

    const attachedSkills = workspace.agents
      .find(agent => agent.id === activeAgent.id)
      ?.skillIds.map(skillId =>
        activeCapability.skillLibrary.find(skill => skill.id === skillId),
      )
      .filter(Boolean) as Array<{ id: string; name: string; category: string }> | undefined;

    const tabs: Array<{
      id: InspectorTab;
      label: string;
      icon: React.ComponentType<{ size?: number; className?: string }>;
    }> = [
      { id: 'agent', label: 'Agent', icon: Bot },
      { id: 'learning', label: 'Learning', icon: Brain },
      { id: 'memory', label: 'Memory', icon: Database },
      { id: 'session', label: 'Session', icon: History },
    ];

    const diagnosticsContent = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: 'Runtime mode', value: runtimeStatus?.runtimeAccessMode || 'Unknown' },
            { label: 'Token source', value: runtimeStatus?.tokenSource || 'Unknown' },
            { label: 'Provider', value: runtimeStatus?.provider || 'Unknown' },
            { label: 'GitHub identity', value: runtimeIdentityLabel },
          ].map(item => (
            <div key={item.label} className="workspace-meta-card">
              <p className="workspace-meta-label">{item.label}</p>
              <p className="workspace-meta-value">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="workspace-surface">
          <p className="workspace-section-title">Runtime details</p>
          <div className="mt-3 space-y-2 text-sm text-secondary">
            <p>Endpoint: {runtimeStatus?.endpoint || 'Unknown'}</p>
            <p>Streaming: {runtimeStatus?.streaming ? 'Enabled' : 'Unavailable'}</p>
            {configError ? <p>Config warning: {configError}</p> : null}
            {runtimeStatus?.githubIdentityError ? (
              <p>Identity warning: {runtimeStatus.githubIdentityError}</p>
            ) : null}
          </div>
        </div>

        {rateLimited ? (
          <div className="workspace-inline-alert workspace-inline-alert-warning">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Rate limited</p>
              <p className="mt-1">
                Retry in {formatRemainingRetry(rateLimitRemainingMs)}.
              </p>
            </div>
          </div>
        ) : null}

        <div className="workspace-surface">
          <p className="workspace-section-title">Raw provider detail</p>
          <pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-slate-950 px-4 py-3 text-[11px] leading-5 text-slate-100">
            {runtimeErrorDetail ||
              error ||
              configError ||
              'No provider or runtime error is currently captured for this collaboration session.'}
          </pre>
        </div>
      </div>
    );

    const inspectorContent =
      inspectorTab === 'agent' ? (
        <div className="space-y-4">
          <div className="workspace-surface">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="workspace-section-title">{activeAgent.name}</p>
                <p className="workspace-section-copy">{activeAgent.role}</p>
              </div>
              <StatusBadge tone={getLearningTone(activeAgent.learningProfile.status)}>
                {activeAgentHealth.label}
              </StatusBadge>
            </div>
            <p className="mt-3 text-sm leading-7 text-secondary">{activeAgent.objective}</p>
            <p className="mt-2 text-sm leading-7 text-secondary">
              {activeAgentHealth.description}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Provider', value: activeAgent.provider },
              { label: 'Model', value: activeAgent.model },
              {
                label: 'Token cap',
                value: `${formatCompactNumber(activeAgent.tokenLimit)} tokens`,
              },
              {
                label: 'Usage',
                value: `${formatCompactNumber(activeAgent.usage.totalTokens)} tokens`,
              },
            ].map(item => (
              <div key={item.label} className="workspace-meta-card">
                <p className="workspace-meta-label">{item.label}</p>
                <p className="workspace-meta-value">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="workspace-surface">
            <p className="workspace-section-title">Session posture</p>
            <p className="mt-2 text-sm leading-7 text-secondary">{commandStripSummary}</p>
          </div>

          <div className="workspace-surface">
            <p className="workspace-section-title">Attached skills</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {attachedSkills && attachedSkills.length > 0 ? (
                attachedSkills.map(skill => (
                  <span
                    key={skill.id}
                    className="rounded-full bg-primary/5 px-3 py-1.5 text-xs font-bold text-primary"
                  >
                    {skill.name}
                  </span>
                ))
              ) : (
                <p className="text-sm text-secondary">
                  This agent does not have capability skills attached yet.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : inspectorTab === 'learning' ? (
        <div className="space-y-4">
          <div className="workspace-surface">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="workspace-section-title">Learning profile</p>
                <p className="workspace-section-copy">
                  Reusable capability-grounded context used when this agent opens or resumes sessions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRefreshLearning(activeAgent.id, activeAgent.name)}
                disabled={refreshingAgentId === activeAgent.id}
                className="enterprise-button enterprise-button-secondary"
              >
                <RefreshCcw
                  size={14}
                  className={refreshingAgentId === activeAgent.id ? 'animate-spin' : ''}
                />
                Refresh learning
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusBadge tone={getLearningTone(activeAgent.learningProfile.status)}>
                {activeAgentHealth.label}
              </StatusBadge>
              <StatusBadge tone="info">
                {activeAgent.learningProfile.sourceCount || 0} sources
              </StatusBadge>
              <StatusBadge tone="neutral">
                {activeAgent.learningProfile.highlights.length || 0} highlights
              </StatusBadge>
            </div>
            <p className="mt-4 text-sm leading-7 text-secondary">
              {getLearningSummaryText(activeAgent.learningProfile)}
            </p>
          </div>

          <div className="workspace-surface">
            <p className="workspace-section-title">Highlights</p>
            <div className="mt-3 space-y-2">
              {activeAgent.learningProfile.highlights.length > 0 ? (
                activeAgent.learningProfile.highlights.map(highlight => (
                  <div
                    key={highlight}
                    className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-sm text-secondary"
                  >
                    {highlight}
                  </div>
                ))
              ) : (
                <p className="text-sm text-secondary">
                  No learning highlights are available yet.
                </p>
              )}
            </div>
          </div>

          <div className="workspace-surface">
            <p className="workspace-section-title">Context block</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-secondary">
              {activeAgent.learningProfile.contextBlock ||
                'The reusable Copilot context block will appear here after learning completes.'}
            </p>
          </div>

          {activeAgent.learningProfile.lastError ? (
            <div className="workspace-inline-alert workspace-inline-alert-danger">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Latest learning error</p>
                <p className="mt-1">{activeAgent.learningProfile.lastError}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : inspectorTab === 'memory' ? (
        <div className="space-y-4">
          <div className="workspace-surface">
            <div className="flex items-center justify-between gap-3">
              <p className="workspace-section-title">Retrieved context</p>
              <StatusBadge tone={lastMemoryReferences.length > 0 ? 'info' : 'neutral'}>
                {lastMemoryReferences.length} sources
              </StatusBadge>
            </div>
            <p className="mt-2 text-sm leading-7 text-secondary">
              These memory references grounded the current or most recent turn.
            </p>
          </div>

          {lastMemoryReferences.length > 0 ? (
            <div className="space-y-3">
              {lastMemoryReferences.map(reference => (
                <div
                  key={`${reference.documentId}-${reference.chunkId}`}
                  className="workspace-surface"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-on-surface">{reference.title}</p>
                    <StatusBadge tone="info">{reference.tier}</StatusBadge>
                    <StatusBadge tone="neutral">{reference.sourceType}</StatusBadge>
                  </div>
                  <p className="mt-2 text-xs text-secondary">
                    Document {reference.documentId} · Chunk {reference.chunkId}
                    {typeof reference.score === 'number'
                      ? ` · Score ${reference.score.toFixed(2)}`
                      : ''}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No retrieved memory yet"
              description="Send a message to see the exact capability memory used to ground the response."
              icon={Database}
              className="rounded-3xl border border-dashed border-outline-variant/40 bg-surface-container-low"
            />
          )}
        </div>
      ) : inspectorTab === 'session' ? (
        <div className="space-y-4">
          <div className="workspace-surface">
            <p className="workspace-section-title">Session mode</p>
            <p className="mt-2 text-sm leading-7 text-secondary">
              Resume keeps the durable Copilot context. New Chat starts the next turn fresh while preserving the capability boundary.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPendingSessionMode('resume')}
                className={cn(
                  'workspace-tab-button',
                  pendingSessionMode === 'resume' && 'workspace-tab-button-active',
                )}
              >
                <History size={14} />
                Resume context
              </button>
              <button
                type="button"
                onClick={() => setPendingSessionMode('fresh')}
                className={cn(
                  'workspace-tab-button',
                  pendingSessionMode === 'fresh' && 'workspace-tab-button-active',
                )}
              >
                <Sparkles size={14} />
                Start fresh
              </button>
            </div>
          </div>

          <div className="workspace-surface">
            <p className="workspace-section-title">Current session</p>
            <div className="mt-3 space-y-2 text-sm text-secondary">
              <p>{commandStripSummary}</p>
              <p>
                {lastSessionSnapshot?.sessionId
                  ? `Latest session ${lastSessionSnapshot.sessionId}`
                  : generalChatSession?.sessionId
                    ? `Stored session ${generalChatSession.sessionId}`
                    : 'No stored general chat session yet.'}
              </p>
              <p>
                {lastSessionSnapshot?.createdAt
                  ? `Last response ${formatDateTime(lastSessionSnapshot.createdAt)}`
                  : generalChatSession?.lastUsedAt
                    ? `Last used ${formatDateTime(generalChatSession.lastUsedAt)}`
                    : 'Waiting for the first completed turn.'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {activeAgent.sessionSummaries.length > 0 ? (
              activeAgent.sessionSummaries.map(session => (
                <div
                  key={`${session.scope}-${session.scopeId || 'capability'}`}
                  className="workspace-surface"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-on-surface">
                      {formatSessionScope(session.scope)}
                    </p>
                    <StatusBadge tone="info">
                      {formatCompactNumber(session.requestCount)} req
                    </StatusBadge>
                  </div>
                  <p className="mt-2 text-xs text-secondary">
                    {session.scopeId || activeCapability.id} · {session.model}
                  </p>
                  <p className="mt-1 text-xs text-secondary">
                    {formatCompactNumber(session.totalTokens)} tokens · Last used{' '}
                    {formatDateTime(session.lastUsedAt)}
                  </p>
                </div>
              ))
            ) : (
              <EmptyState
                title="No resumable sessions yet"
                description="This agent will show durable chat or work-item session scopes after it completes a turn."
                icon={History}
                className="rounded-3xl border border-dashed border-outline-variant/40 bg-surface-container-low"
              />
            )}
          </div>
        </div>
      ) : diagnosticsContent;

    return (
      <div className="flex h-full min-h-0 flex-col border-l border-outline-variant/40 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-outline-variant/40 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = inspectorTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setInspectorTab(tab.id)}
                  className={cn(
                    'workspace-tab-button',
                    isActive && 'workspace-tab-button-active',
                  )}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setInspectorOpen(false)}
            className="workspace-list-action"
            title="Hide context"
          >
            <PanelRightClose size={14} />
          </button>
        </div>
        <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
          {inspectorContent}
          <AdvancedDisclosure
            title="Diagnostics"
            description="Provider, runtime, token, and raw error details for technical troubleshooting."
            storageKey="singularity.chat.diagnostics.open"
            openSignal={diagnosticsOpenSignal}
            className="mt-4"
            badge={<StatusBadge tone={runtimeErrorDetail || error || configError ? 'warning' : 'neutral'}>Advanced</StatusBadge>}
          >
            {diagnosticsContent}
          </AdvancedDisclosure>
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-outline-variant/50 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
        <div className="workspace-command-strip rounded-none border-x-0 border-t-0 shadow-none">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="brand">Collaboration</StatusBadge>
              <span className="page-context">{activeCapability.id}</span>
              <StatusBadge tone={runtimeBadge.tone}>{runtimeBadge.label}</StatusBadge>
            </div>
            <h1 className="mt-3 truncate text-2xl font-bold tracking-tight text-on-surface">
              {activeCapability.name}
            </h1>
            <p className="mt-1 text-sm text-secondary">
              Conversation-first workspace for capability-scoped Copilot sessions.
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 xl:w-auto xl:min-w-[44rem] xl:flex-row xl:items-center xl:justify-end">
            <label className="relative min-w-[16rem] flex-1 xl:max-w-[15rem]">
              <Bot
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline"
              />
              <select
                value={activeAgent?.id || ''}
                onChange={event => {
                  void handleAgentSwitch(event.target.value);
                }}
                className="enterprise-input appearance-none pl-10"
              >
                {workspace.agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.role}
                  </option>
                ))}
              </select>
            </label>

            <label className="relative min-w-[16rem] flex-1 xl:max-w-sm">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search this conversation"
                className="enterprise-input pl-10"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPendingSessionMode('resume')}
                className={cn(
                  'workspace-tab-button',
                  pendingSessionMode === 'resume' && 'workspace-tab-button-active',
                )}
              >
                <History size={14} />
                Resume
              </button>
              <button
                type="button"
                onClick={() => setPendingSessionMode('fresh')}
                className={cn(
                  'workspace-tab-button',
                  pendingSessionMode === 'fresh' && 'workspace-tab-button-active',
                )}
              >
                <Sparkles size={14} />
                New chat
              </button>
              <button
                type="button"
                onClick={() => setInspectorOpen(current => !current)}
                className="enterprise-button enterprise-button-secondary"
              >
                {inspectorOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                Context
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/40 bg-surface-container-low/60 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={pendingSessionMode === 'fresh' ? 'warning' : 'info'}>
                  {pendingSessionMode === 'fresh' ? 'Fresh next turn' : 'Resume next turn'}
                </StatusBadge>
                {generalChatSession ? (
                  <StatusBadge tone="neutral">
                    {formatSessionScope(generalChatSession.scope)}
                  </StatusBadge>
                ) : null}
                {lastMemoryReferences.length > 0 ? (
                  <StatusBadge tone="brand">
                    {lastMemoryReferences.length} memory refs
                  </StatusBadge>
                ) : null}
                {lastSessionSnapshot?.sessionId ? (
                  <StatusBadge tone="success">Resuming saved session</StatusBadge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-secondary">
                <span>{commandStripSummary}</span>
                <span>
                  {searchQuery
                    ? `${filteredMessages.length} match${filteredMessages.length === 1 ? '' : 'es'}`
                    : `${workspace.messages.length} message${workspace.messages.length === 1 ? '' : 's'}`}
                </span>
              </div>
            </div>

            <div className="custom-scrollbar flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,#ffffff_0%,#f8fbfb_45%,#eef3f4_100%)] px-4 py-4">
              <div className="space-y-5">
                {filteredMessages.length > 0 ? (
                  filteredMessages.map(renderMessage)
                ) : searchQuery ? (
                  <EmptyState
                    title="No messages match this search"
                    description="Try a different keyword or clear the search to return to the full transcript."
                    icon={Search}
                    className="rounded-[28px] border border-dashed border-outline-variant/40 bg-surface-container-low"
                  />
                ) : !isSending ? (
                  <div className="rounded-[28px] border border-dashed border-outline-variant/40 bg-surface-container-low px-5 py-5">
                    <EmptyState
                      title="Start the capability conversation"
                      description="Use business-friendly prompts to understand readiness, next actions, delivery progress, and evidence."
                      icon={MessageSquareText}
                      className="min-h-[12rem] border-0 bg-transparent"
                    />
                    <div className="grid gap-3 md:grid-cols-2">
                      {suggestedPrompts.map(prompt => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => {
                            setInput(prompt);
                            composerRef.current?.focus();
                          }}
                          className="rounded-2xl border border-outline-variant/50 bg-white px-4 py-3 text-left text-sm font-semibold leading-6 text-on-surface transition hover:border-primary/20 hover:bg-primary/5"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {isSending && activeAgent ? (
                  <div className="flex justify-start gap-3">
                    <div className="flex min-w-0 max-w-[min(78ch,85%)] gap-3">
                      <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-900 text-white">
                        <LoaderCircle size={18} className="animate-spin" />
                      </div>
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] font-medium text-slate-500">
                          <span className="font-semibold uppercase tracking-[0.16em] text-slate-400">
                            {activeAgent.name}
                          </span>
                          <span>Working…</span>
                          {lastMemoryReferences.length > 0 ? (
                            <StatusBadge tone="info">
                              {lastMemoryReferences.length} memory refs
                            </StatusBadge>
                          ) : null}
                          <StatusBadge tone={pendingSessionMode === 'fresh' ? 'warning' : 'info'}>
                            {pendingSessionMode === 'fresh' ? 'Fresh session' : 'Resume context'}
                          </StatusBadge>
                        </div>
                        <div className="rounded-[22px] rounded-tl-md border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm leading-7 text-slate-800 shadow-sm">
                          {streamedDraft ||
                            `Using ${activeCapability.name} memory, ${activeAgent.name}'s learning profile, and ${
                              pendingSessionMode === 'fresh' ? 'a fresh session' : 'the stored session context'
                            }.`}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="border-t border-outline-variant/40 bg-white px-4 py-4">
              {!runtimeStatus?.configured || configError ? (
                <div className="workspace-inline-alert workspace-inline-alert-warning mb-3">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="font-semibold">
                        {runtimeStatus?.configured
                          ? 'Runtime metadata needs attention'
                          : 'Backend runtime is not configured'}
                      </p>
                      <p className="mt-1">
                        {configError ||
                          'The Express runtime needs a working Copilot connection before chat can complete.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openDiagnosticsPanel}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Open context
                    </button>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="workspace-inline-alert workspace-inline-alert-danger mb-3">
                  <XCircle size={18} className="mt-0.5 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="font-semibold">Chat request failed</p>
                      <p className="mt-1">{error}</p>
                    </div>
                    <button
                      type="button"
                      onClick={openDiagnosticsPanel}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Open context
                    </button>
                  </div>
                </div>
              ) : null}

              {rateLimited && !error ? (
                <div className="workspace-inline-alert workspace-inline-alert-warning mb-3">
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="font-semibold">Rate limited</p>
                      <p className="mt-1">
                        Retry in {formatRemainingRetry(rateLimitRemainingMs)}. The composer will unlock automatically when the cooldown ends.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openDiagnosticsPanel}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Open context
                    </button>
                  </div>
                </div>
              ) : null}

              <form onSubmit={handleSend} className="space-y-3">
                <div className="rounded-[24px] border border-outline-variant/40 bg-surface-container-low px-4 py-3 shadow-inner shadow-slate-200/40">
                  <textarea
                    ref={composerRef}
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage(input);
                      }
                    }}
                    placeholder={`Ask ${activeAgent?.name || 'the active agent'} about ${activeCapability.name}, its artifacts, or the next delivery decision…`}
                    className="min-h-[52px] w-full resize-none bg-transparent text-sm leading-7 text-slate-900 outline-none placeholder:text-slate-400"
                    rows={1}
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/30 pt-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
                      <span>
                        {pendingSessionMode === 'fresh'
                          ? 'Next send starts a new Copilot session.'
                          : 'Next send resumes the stored Copilot session.'}
                      </span>
                      <span>Capability boundary: {activeCapability.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isSending ? (
                        <button
                          type="button"
                          onClick={handleStopStreaming}
                          className="enterprise-button enterprise-button-secondary !rounded-full"
                        >
                          <StopCircle size={16} />
                          Stop
                        </button>
                      ) : null}
                      <button
                        type="submit"
                        disabled={
                          !input.trim() ||
                          isSending ||
                          !runtimeStatus?.configured ||
                          rateLimited
                        }
                        className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                      >
                        <Send size={16} />
                        {rateLimited ? `Retry in ${formatRemainingRetry(rateLimitRemainingMs)}` : 'Send'}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </section>

          {inspectorOpen ? (
            <div className="hidden w-[360px] shrink-0 xl:block">{renderInspector()}</div>
          ) : null}

          {inspectorOpen ? (
            <div className="absolute inset-y-0 right-0 z-20 w-[min(94vw,360px)] xl:hidden">
              <div className="h-full border-l border-outline-variant/40 bg-white shadow-[0_24px_64px_rgba(15,23,42,0.2)]">
                {renderInspector()}
              </div>
            </div>
          ) : null}

          {!inspectorOpen ? (
            <button
              type="button"
              onClick={() => setInspectorOpen(true)}
              className="absolute bottom-4 right-4 z-10 inline-flex items-center gap-2 rounded-full border border-outline-variant/60 bg-white px-4 py-2 text-sm font-semibold text-secondary shadow-lg shadow-slate-900/10 transition-colors hover:bg-surface-container-low"
            >
              <PanelRightOpen size={16} />
              Inspect
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default Chat;
