import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AtSign,
  Loader2,
  MessageSquareText,
  Minimize2,
  Orbit,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useCapability } from '../context/CapabilityContext';
import { streamCapabilityChat } from '../lib/api';
import { MAX_HISTORY_FOR_LLM } from '../lib/chatLimits';
import { getRouteDescription, type RouteDescription } from '../lib/routeDescriptions';
import { cn } from '../lib/utils';
import { StatusBadge } from './EnterpriseUI';
import MarkdownContent from './MarkdownContent';
import {
  SwarmComposerRibbon,
  SwarmMentionPicker,
  SwarmReviewCard,
  SwarmTranscript,
  useSwarmSession,
  type TaggedParticipant,
} from './swarm';

/**
 * Always-available assistant dock.
 *
 * Mounted once in Layout so every route (except the main Chat page,
 * login, and immersive viewers) gets a bottom-right bubble that can
 * stream a reply against the active capability's primary agent.
 *
 * Transcript lives in local component state for the live session view,
 * and each message is also fire-and-forget persisted via
 * `appendCapabilityMessage` so the /chat page can show the history.
 * Both user and agent turns are written under `sessionScope: GENERAL_CHAT`
 * so they land in the same session bucket as the main /chat page — the
 * dock is a lightweight overlay on the same conversation, not a silo.
 * When a work item is selected in the Orchestrator the dock also passes
 * its id to `streamCapabilityChat` so the server can load WI context.
 *
 * `chatWorkspace.ts` (server) already intercepts a few intents before
 * the LLM call — STATUS, MOVE_PHASE, FIND_SYMBOL. Those short-circuits
 * make this dock useful even without a ton of extra plumbing here.
 */

type DockMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  createdAt: number;
};

const STORAGE_KEY = 'singularity.assistant-dock.open';
// MAX_HISTORY_FOR_LLM is imported from ../lib/chatLimits (shared with Chat.tsx).

/**
 * Brand of this dock's assistant persona.
 *
 * "Event Horizon" — the boundary at the edge of a singularity; the
 * thing you talk to when you need to see past where governance,
 * provenance, and runtime context would otherwise go dark.
 *
 * The underlying LLM agent still has its own name (shown as a subtle
 * "via <agent>" badge so operators know which model/persona is
 * replying), but the dock itself presents as Event Horizon across the
 * UI. Swap these two constants to rename the assistant everywhere.
 */
const ASSISTANT_NAME = 'Event Horizon';
const ASSISTANT_TAGLINE = 'Your capability assistant';

// Routes where the dock is redundant or in the way.
// /chat already IS the main chat; /login and onboarding need focus;
// the shared evidence viewer is a public read-only page.
const HIDDEN_PATH_PREFIXES = [
  '/chat',
  '/login',
  '/e/',
  '/capabilities/new',
];

/**
 * Context handed to a quick-action prompt builder at click time.
 * Lets actions produce prompts that actually reflect the current
 * page + capability instead of generic filler.
 */
type QuickActionContext = {
  pathname: string;
  capabilityName: string;
  route: RouteDescription | null;
};

type QuickAction = {
  label: string;
  /** Static prompt OR a builder that reads the current context. */
  prompt: string | ((ctx: QuickActionContext) => string);
};

const QUICK_ACTIONS: QuickAction[] = [
  // `status` short-circuits pre-LLM in server/chatWorkspace.ts — no
  // need to inject context here.
  { label: 'Status', prompt: 'status' },

  {
    label: "What's blocked?",
    prompt: ({ capabilityName }) =>
      `What's blocked right now for the "${capabilityName}" capability? List any open waits, pending approvals, and work items that need attention, and say who each one is waiting on.`,
  },

  {
    // The old version sent a literal "Explain this page…" with no
    // context. The model had no way to answer it usefully. Now we
    // inject the page path, label, catalogued purpose, and the active
    // capability so the reply is grounded.
    label: 'Explain this page',
    prompt: ({ pathname, capabilityName, route }) => {
      if (!route) {
        return `I'm on the route "${pathname}" in the "${capabilityName}" capability workspace, but this route isn't catalogued. Best-effort: describe what this page is likely for based on the URL, and what I should probably do here.`;
      }
      return [
        `I'm on the "${route.label}" page (${pathname}) in the "${capabilityName}" capability workspace.`,
        '',
        `Page purpose (from the product catalog): ${route.purpose}`,
        '',
        'Explain in plain language what this page is for, what I should be looking at first, and what actions are most likely useful right now. Be concise — a short paragraph plus a 3-item bullet list is ideal.',
      ].join('\n');
    },
  },

  // Trailing space signals "prefill the composer" mode in handleQuickAction.
  { label: 'Find symbol', prompt: 'find ' },
];

// Storage key written by Orchestrator to persist the selected work item.
// We read it (not write it) so the dock can show context without needing
// the selected id to live in CapabilityContext.
const ORCHESTRATOR_SELECTED_KEY = 'singularity.orchestrator.selected';

const readSelectedWorkItemId = (): string | null => {
  if (typeof window === 'undefined') return null;
  // Orchestrator stores it in sessionStorage via writeViewPreference.
  return window.sessionStorage.getItem(ORCHESTRATOR_SELECTED_KEY) || null;
};

export const AssistantDock: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    activeCapability,
    appendCapabilityMessage,
    getCapabilityWorkspace,
    refreshCapabilityBundle,
  } = useCapability();

  const [isOpen, setIsOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  });
  const [messages, setMessages] = useState<DockMessage[]>([]);
  const [input, setInput] = useState('');
  const [streamingDraft, setStreamingDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  // Swarm-debate state. `taggedParticipants` drives the composer ribbon; an
  // `activeSwarmSessionId` switches the transcript over to `SwarmTranscript`
  // + `SwarmReviewCard`. Cleared with the regular chat via `handleClear`.
  const [taggedParticipants, setTaggedParticipants] = useState<TaggedParticipant[]>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [activeSwarmSessionId, setActiveSwarmSessionId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Persist open/closed so the dock feels sticky across navigations.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, isOpen ? 'true' : 'false');
  }, [isOpen]);

  // Auto-scroll on new content (only when open, else the layout calc is wasted).
  useEffect(() => {
    if (!isOpen) return;
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingDraft, isOpen]);

  // Focus composer on open for zero-friction typing.
  useEffect(() => {
    if (isOpen) {
      const id = window.setTimeout(() => textareaRef.current?.focus(), 80);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [isOpen]);

  // Cancel any in-flight stream if the dock unmounts (route change unlikely
  // unmounts us since we sit in Layout, but keep the abort for safety).
  useEffect(() => () => abortRef.current?.abort(), []);

  const shouldHide = useMemo(() => {
    const path = location.pathname;
    return HIDDEN_PATH_PREFIXES.some(prefix =>
      prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`),
    );
  }, [location.pathname]);

  const workspace = activeCapability?.id ? getCapabilityWorkspace(activeCapability.id) : null;

  // Mirror Chat.tsx's agent-selection order: primary copilot → active → owner → first.
  const activeAgent = useMemo(() => {
    if (!workspace) return null;
    return (
      workspace.agents.find(agent => agent.id === workspace.primaryCopilotAgentId) ||
      workspace.agents.find(agent => agent.id === workspace.activeChatAgentId) ||
      workspace.agents.find(agent => agent.isOwner) ||
      workspace.agents[0] ||
      null
    );
  }, [workspace]);

  // Read the Orchestrator's selected work item from sessionStorage.
  // Re-derive on every render so the dock picks it up without an event
  // listener — cheap enough since it's just a sessionStorage read.
  const selectedWorkItemId = readSelectedWorkItemId();
  const selectedWorkItem = useMemo(
    () =>
      selectedWorkItemId && workspace
        ? (workspace.workItems ?? []).find(wi => wi.id === selectedWorkItemId) ?? null
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedWorkItemId, workspace],
  );

  // Resolve the current route once and memoize by pathname so quick
  // actions always see a consistent description (label + purpose).
  const currentRoute = useMemo(
    () => getRouteDescription(location.pathname),
    [location.pathname],
  );
  const currentPageLabel = currentRoute?.label || 'Workspace';

  // Swarm session subscription (no-op until `activeSwarmSessionId` is set).
  const swarmSession = useSwarmSession(
    activeCapability?.id ?? null,
    activeSwarmSessionId,
  );

  const hasTaggedParticipants = taggedParticipants.length > 0;
  const hasEnoughForSwarm = taggedParticipants.length >= 2;

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    if (!activeCapability?.id || !activeAgent) {
      setError('No capability or agent is ready yet. Try again in a moment.');
      return;
    }

    setError('');
    setStreamingDraft('');
    setIsSending(true);

    const userMsg: DockMessage = {
      id: `u-${Date.now().toString(36)}`,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };

    // Build `history` for the server BEFORE appending the new user turn —
    // the server expects `history` to be prior turns and `message` to be
    // the new user input (see CapabilityChatRequest in api.ts:266).
    const historyForRequest = messages.slice(-MAX_HISTORY_FOR_LLM).map(m => ({
      id: m.id,
      capabilityId: activeCapability.id,
      role: m.role,
      content: m.content,
      timestamp: new Date(m.createdAt).toISOString(),
      sessionScope: 'GENERAL_CHAT' as const,
      sessionScopeId: activeCapability.id,
    }));

    setMessages(current => [...current, userMsg]);
    setInput('');

    // Persist the user turn (fire-and-forget — don't block the stream start).
    void appendCapabilityMessage(activeCapability.id, {
      id: userMsg.id,
      role: 'user',
      content: trimmed,
      timestamp: new Date(userMsg.createdAt).toISOString(),
      sessionScope: 'GENERAL_CHAT',
      sessionScopeId: activeCapability.id,
      workItemId: selectedWorkItemId ?? undefined,
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await streamCapabilityChat(
        {
          capability: activeCapability,
          agent: activeAgent,
          history: historyForRequest,
          message: trimmed,
          sessionMode: 'resume',
          sessionScope: 'GENERAL_CHAT',
          sessionScopeId: activeCapability.id,
          contextMode: selectedWorkItemId ? 'WORK_ITEM_STAGE' : 'GENERAL',
          workItemId: selectedWorkItemId ?? undefined,
        },
        {
          onEvent: event => {
            if (event.type === 'delta' && event.content) {
              setStreamingDraft(draft => draft + event.content);
              return;
            }
            if (event.type === 'error' && event.error) {
              setError(event.error);
            }
          },
        },
        { signal: controller.signal },
      );

      const finalContent = (result.completeEvent?.content || result.draftContent || '').trim();
      if (!finalContent) {
        if (result.error) {
          throw new Error(result.error);
        }
        throw new Error('The assistant returned an empty response.');
      }

      const agentMsgId = `a-${Date.now().toString(36)}`;
      const agentCreatedAt = result.completeEvent?.createdAt
        ? new Date(result.completeEvent.createdAt).toISOString()
        : new Date().toISOString();

      setMessages(current => [
        ...current,
        {
          id: agentMsgId,
          role: 'agent',
          content: finalContent,
          createdAt: Date.now(),
        },
      ]);

      // Persist the agent turn (fire-and-forget).
      void appendCapabilityMessage(activeCapability.id, {
        id: agentMsgId,
        role: 'agent',
        content: finalContent,
        timestamp: agentCreatedAt,
        agentId: activeAgent.id,
        agentName: activeAgent.name,
        traceId: result.completeEvent?.traceId,
        model: result.completeEvent?.model || activeAgent.model,
        sessionId: result.completeEvent?.sessionId,
        sessionScope: result.completeEvent?.sessionScope ?? 'GENERAL_CHAT',
        sessionScopeId: result.completeEvent?.sessionScopeId ?? activeCapability.id,
        workItemId: selectedWorkItemId ?? undefined,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message || 'The assistant could not complete the request.');
    } finally {
      setStreamingDraft('');
      setIsSending(false);
      abortRef.current = null;
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamingDraft('');
    setError('');
    // Clearing the thread should also drop any in-flight swarm context so
    // the next operator turn starts clean.
    setActiveSwarmSessionId(null);
    setTaggedParticipants([]);
    setShowMentionPicker(false);
  };

  const handleTagParticipant = (participant: TaggedParticipant) => {
    setTaggedParticipants(current => {
      const key = `${participant.capabilityId}::${participant.agentId}`;
      if (current.some(p => `${p.capabilityId}::${p.agentId}` === key)) {
        return current;
      }
      // Hard cap at 3 — the server also enforces this, but we stop earlier
      // so the UI never looks like a 4th tag is legal.
      if (current.length >= 3) return current;
      return [...current, participant];
    });
    setShowMentionPicker(false);
  };

  const handleRemoveParticipant = (participant: TaggedParticipant) => {
    const key = `${participant.capabilityId}::${participant.agentId}`;
    setTaggedParticipants(current =>
      current.filter(p => `${p.capabilityId}::${p.agentId}` !== key),
    );
  };

  const handleDebateStarted = (sessionId: string) => {
    setActiveSwarmSessionId(sessionId);
    setInput('');
  };

  const handleCancelSwarmComposer = () => {
    setTaggedParticipants([]);
    setShowMentionPicker(false);
  };

  const handleQuickAction = (prompt: QuickAction['prompt']) => {
    // Resolve function-valued prompts against the current dock context.
    // Static strings pass through unchanged.
    const resolved =
      typeof prompt === 'function'
        ? prompt({
            pathname: location.pathname,
            capabilityName: activeCapability.name,
            route: currentRoute,
          })
        : prompt;

    if (typeof resolved === 'string' && resolved.endsWith(' ')) {
      // "find " — prefill and let the user finish typing.
      setInput(resolved);
      textareaRef.current?.focus();
      return;
    }
    void sendMessage(resolved);
  };

  if (shouldHide || !activeCapability?.id) return null;

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Open ${ASSISTANT_NAME}`}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full border border-outline-variant/50 bg-white px-4 py-3 text-sm font-semibold text-on-surface shadow-[0_16px_40px_rgba(12,23,39,0.18)] transition hover:border-primary/30 hover:shadow-[0_20px_48px_rgba(12,23,39,0.22)]"
      >
        <Orbit size={16} className="text-primary" />
        Ask {ASSISTANT_NAME}
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={ASSISTANT_NAME}
      className="fixed bottom-6 right-6 z-40 flex h-[min(640px,calc(100vh-3rem))] w-[min(420px,calc(100vw-3rem))] flex-col overflow-hidden rounded-3xl border border-outline-variant/50 bg-white shadow-[0_24px_60px_rgba(12,23,39,0.28)]"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/40 bg-surface-container-low px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Orbit size={15} className="text-primary" />
            <p className="text-sm font-bold text-on-surface">{ASSISTANT_NAME}</p>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-secondary">
              {ASSISTANT_TAGLINE}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <StatusBadge tone="brand">{activeCapability.name}</StatusBadge>
            <StatusBadge tone="neutral">On: {currentPageLabel}</StatusBadge>
            {activeAgent ? (
              <StatusBadge tone="neutral">via {activeAgent.name}</StatusBadge>
            ) : null}
            {selectedWorkItem ? (
              <span title={selectedWorkItem.title}>
                <StatusBadge tone="warning">
                  WI:{' '}
                  {selectedWorkItem.title.length > 22
                    ? `${selectedWorkItem.title.slice(0, 22)}…`
                    : selectedWorkItem.title}
                </StatusBadge>
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleClear}
            disabled={messages.length === 0 && !streamingDraft}
            className="rounded-xl p-1.5 text-secondary transition hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Clear assistant history"
            title="Clear"
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded-xl p-1.5 text-secondary transition hover:bg-surface-container"
            aria-label="Minimize assistant"
            title="Minimize"
          >
            <Minimize2 size={15} />
          </button>
        </div>
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {activeSwarmSessionId && swarmSession.detail ? (
          <div className="space-y-3">
            <SwarmTranscript
              transcript={swarmSession.transcript}
              participants={swarmSession.detail.participants}
              status={swarmSession.status}
              streaming={swarmSession.streaming}
              initiatingPrompt={swarmSession.detail.session.initiatingPrompt}
              resolveCapabilityName={id =>
                taggedParticipants.find(p => p.capabilityId === id)?.capabilityName
                ?? (id === activeCapability.id ? activeCapability.name : undefined)
              }
              resolveAgentName={id =>
                taggedParticipants.find(p => p.agentId === id)?.agentName
              }
            />
            {swarmSession.status &&
            ['AWAITING_REVIEW', 'APPROVED', 'REJECTED', 'NO_CONSENSUS', 'BUDGET_EXHAUSTED'].includes(
              swarmSession.status,
            ) ? (
              <SwarmReviewCard
                capabilityId={activeCapability.id}
                session={swarmSession.detail}
                onRefresh={() => void swarmSession.refresh()}
                onWorkItemCreated={async ({ workItem }) => {
                  if (typeof window !== 'undefined') {
                    window.sessionStorage.setItem(
                      ORCHESTRATOR_SELECTED_KEY,
                      workItem.id,
                    );
                  }
                  await refreshCapabilityBundle(activeCapability.id);
                  setMessages(current => [
                    ...current,
                    {
                      id: `swarm-work-item-${workItem.id}`,
                      role: 'agent',
                      content: `Created work item ${workItem.id}: ${workItem.title}. Opening Work so you can continue from the new queue item.`,
                      createdAt: Date.now(),
                    },
                  ]);
                  navigate('/work');
                }}
                onError={message => setError(message)}
              />
            ) : null}
            <div ref={scrollAnchorRef} />
          </div>
        ) : messages.length === 0 && !streamingDraft ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-2 text-center">
            <div className="section-card-icon h-12 w-12 rounded-2xl">
              <MessageSquareText size={20} />
            </div>
            <div>
              <p className="text-sm font-bold text-on-surface">
                {ASSISTANT_NAME} is ready.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                Type a question, or use a shortcut. {ASSISTANT_NAME} sees your active
                capability and the page you are on.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {QUICK_ACTIONS.map(action => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => handleQuickAction(action.prompt)}
                  className="rounded-full border border-outline-variant/50 bg-surface-container-low px-3 py-1.5 text-[0.7rem] font-semibold text-on-surface transition hover:border-primary/30 hover:bg-white"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={cn(
                  'rounded-2xl px-3 py-2 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'ml-6 border border-primary/15 bg-primary/5 text-on-surface'
                    : 'mr-6 border border-outline-variant/35 bg-white text-on-surface',
                )}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  {msg.role === 'user' ? (
                    <>
                      <div className="h-4 w-4 rounded-full bg-primary/20" />
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.15em] text-secondary">
                        You
                      </p>
                    </>
                  ) : (
                    <>
                      <Orbit size={12} className="text-primary" />
                      <p className="text-[0.68rem] font-bold uppercase tracking-[0.15em] text-secondary">
                        {ASSISTANT_NAME}
                      </p>
                    </>
                  )}
                </div>
                {msg.role === 'agent' ? (
                  <MarkdownContent content={msg.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            ))}
            {streamingDraft ? (
              <div className="mr-6 rounded-2xl border border-outline-variant/35 bg-white px-3 py-2 text-sm leading-relaxed">
                <div className="mb-1 flex items-center gap-1.5">
                  <Orbit size={12} className="text-primary" />
                  <p className="text-[0.68rem] font-bold uppercase tracking-[0.15em] text-secondary">
                    {ASSISTANT_NAME}
                  </p>
                  <Loader2 size={12} className="animate-spin text-primary" />
                </div>
                <MarkdownContent content={streamingDraft} />
              </div>
            ) : null}
            <div ref={scrollAnchorRef} />
          </div>
        )}
      </div>

      {/* Error banner */}
      {error ? (
        <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs leading-relaxed text-red-900">
          {error}
        </div>
      ) : null}

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="relative border-t border-outline-variant/40 bg-surface-container-low px-3 py-3"
      >
        <SwarmMentionPicker
          open={showMentionPicker}
          anchorCapabilityId={activeCapability.id}
          selected={taggedParticipants}
          onSelect={handleTagParticipant}
          onDismiss={() => setShowMentionPicker(false)}
          maxSelections={3}
        />

        {hasEnoughForSwarm && !activeSwarmSessionId ? (
          <div className="mb-2">
            <SwarmComposerRibbon
              anchorCapabilityId={activeCapability.id}
              workItemId={selectedWorkItemId ?? undefined}
              sessionScope={selectedWorkItemId ? 'WORK_ITEM' : 'GENERAL_CHAT'}
              participants={taggedParticipants}
              prompt={input}
              onRemoveParticipant={handleRemoveParticipant}
              onDebateStarted={handleDebateStarted}
              onCancel={handleCancelSwarmComposer}
              onError={message => setError(message)}
            />
          </div>
        ) : hasTaggedParticipants && !activeSwarmSessionId ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {taggedParticipants.map(participant => (
              <span
                key={`${participant.capabilityId}::${participant.agentId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[0.7rem]"
              >
                <span className="font-semibold">@{participant.agentName}</span>
                <span className="text-secondary">· {participant.capabilityName}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveParticipant(participant)}
                  aria-label={`Remove ${participant.agentName}`}
                  className="rounded-full p-0.5 text-secondary transition hover:bg-surface-container"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <StatusBadge tone="neutral">Tag one more to start a swarm debate</StatusBadge>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setShowMentionPicker(open => !open)}
            disabled={!activeCapability?.id || !!activeSwarmSessionId}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-outline-variant/50 bg-white text-secondary transition hover:border-primary/30 hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Tag an agent"
            title="Tag an agent (@)"
          >
            <AtSign size={16} />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === '@' && !event.shiftKey && !event.altKey) {
                // Let the `@` land in the textarea but also pop the picker so
                // operators who know the shortcut get it for free.
                setShowMentionPicker(true);
              }
              handleKeyDown(event);
            }}
            placeholder={
              activeSwarmSessionId
                ? 'Swarm debate in progress. Clear to start a new thread.'
                : hasEnoughForSwarm
                  ? 'Write the initiating prompt for the debate…'
                  : activeAgent
                    ? `Message ${ASSISTANT_NAME}…  (Enter to send, Shift+Enter for newline, @ to tag)`
                    : `Configure an agent for this capability so ${ASSISTANT_NAME} can reply.`
            }
            rows={2}
            disabled={!activeAgent || isSending || !!activeSwarmSessionId || hasEnoughForSwarm}
            className="min-h-[2.5rem] max-h-40 flex-1 resize-none rounded-2xl border border-outline-variant/50 bg-white px-3 py-2 text-sm leading-6 text-on-surface outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-container"
          />
          {isSending ? (
            <button
              type="button"
              onClick={handleStop}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-red-200 bg-white text-red-700 transition hover:bg-red-50"
              aria-label="Stop generating"
              title="Stop"
            >
              <X size={16} />
            </button>
          ) : hasEnoughForSwarm && !activeSwarmSessionId ? null : (
            <button
              type="submit"
              disabled={!input.trim() || !activeAgent || !!activeSwarmSessionId}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send"
              title="Send"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

export default AssistantDock;
