import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  Cpu,
  LoaderCircle,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  User,
  Zap,
} from 'lucide-react';
import {
  fetchRuntimeStatus,
  type RuntimeStatus,
  sendCapabilityChat,
} from '../lib/api';
import { useCapability } from '../context/CapabilityContext';
import { cn } from '../lib/utils';

const formatTimestamp = (value = new Date()) =>
  value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

const summarizeOutput = (value: string) =>
  value.replace(/\s+/g, ' ').trim().slice(0, 220);

const Chat = () => {
  const {
    activeCapability,
    getCapabilityWorkspace,
    appendCapabilityMessage,
    setActiveChatAgent,
    setCapabilityWorkspaceContent,
  } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [configError, setConfigError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeAgent =
    workspace.agents.find(agent => agent.id === workspace.activeChatAgentId) ||
    workspace.agents.find(agent => agent.isOwner) ||
    workspace.agents[0];

  const filteredMessages = useMemo(
    () =>
      workspace.messages.filter(message =>
        message.content.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [searchQuery, workspace.messages],
  );

  const learningFeed = useMemo(
    () =>
      workspace.agents.flatMap(agent =>
        (agent.learningNotes || []).map(note => ({
          id: `${agent.id}-${note}`,
          note,
          agentName: agent.name,
        })),
      ),
    [workspace.agents],
  );

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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredMessages.length, isSending, workspace.capabilityId]);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim() || !activeAgent || isSending) {
      return;
    }

    if (!runtimeStatus?.configured) {
      setError(
        'The backend runtime is not configured yet. Add GITHUB_MODELS_TOKEN to .env.local and restart npm run dev.',
      );
      return;
    }

    const userContent = input.trim();
    const userMessageId = `${Date.now()}-user`;
    appendCapabilityMessage(activeCapability.id, {
      id: userMessageId,
      role: 'user',
      content: userContent,
      timestamp: formatTimestamp(),
    });
    setInput('');
    setError('');
    setIsSending(true);

    try {
      const result = await sendCapabilityChat({
        capability: activeCapability,
        agent: activeAgent,
        history: workspace.messages.slice(-10),
        message: userContent,
      });

      appendCapabilityMessage(activeCapability.id, {
        id: `${Date.now()}-agent`,
        role: 'agent',
        content: result.content,
        timestamp: formatTimestamp(new Date(result.createdAt)),
        agentId: activeAgent.id,
        agentName: activeAgent.name,
      });

      setCapabilityWorkspaceContent(activeCapability.id, {
        executionLogs: [
          ...workspace.executionLogs,
          {
            id: `LOG-CHAT-${Date.now()}`,
            taskId: `CHAT-${userMessageId}`,
            capabilityId: activeCapability.id,
            agentId: activeAgent.id,
            timestamp: new Date(result.createdAt).toISOString(),
            level: 'INFO',
            message: `Completed capability chat response with ${result.model}.`,
            metadata: {
              requestType: 'CHAT',
              model: result.model,
              promptTokens: result.usage.promptTokens,
              completionTokens: result.usage.completionTokens,
              totalTokens: result.usage.totalTokens,
              estimatedCostUsd: result.usage.estimatedCostUsd,
              outputTitle: `${activeAgent.name} chat response`,
              outputSummary: summarizeOutput(result.content),
              outputStatus: 'completed',
            },
          },
        ],
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'The backend runtime could not complete this request.',
      );
    } finally {
      setIsSending(false);
    }
  };

  const configState = runtimeStatus?.configured
    ? {
        icon: ShieldCheck,
        title: 'Backend runtime connected',
        body: `React is calling the Express API only, and the server is routing requests to ${runtimeStatus.provider} through ${runtimeStatus.endpoint}.`,
        className:
          'border-emerald-200 bg-emerald-50 text-emerald-900',
      }
    : {
        icon: AlertTriangle,
        title: 'Backend runtime not configured',
        body:
          'Add GITHUB_MODELS_TOKEN to .env.local, then restart npm run dev so the Express API can call GitHub Copilot for this workspace.',
        className:
          'border-amber-200 bg-amber-50 text-amber-900',
      };
  const activeAgentTokenBudget = activeAgent
    ? activeAgent.tokenLimit.toLocaleString()
    : '0';
  const activeAgentTokenUsage = activeAgent
    ? activeAgent.usage.totalTokens.toLocaleString()
    : '0';
  const activeAgentEstimatedCost = activeAgent
    ? activeAgent.usage.estimatedCostUsd.toFixed(4)
    : '0.0000';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-primary/10 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-widest text-primary">
              Capability Chat
            </span>
            <span className="text-[0.625rem] font-bold uppercase tracking-widest text-slate-400">
              {activeCapability.id}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-on-surface">
            {activeCapability.name} Conversation Space
          </h1>
          <p className="text-sm font-medium text-secondary">
            Switching capability switches the full conversation, active chat
            agent, and team learning context.
          </p>
        </div>
        <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 text-right">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
            Active agent
          </p>
          <p className="text-sm font-bold text-on-surface">
            {activeAgent?.name || 'Capability Owning Agent'}
          </p>
          <p className="mt-1 text-[0.6875rem] font-medium text-secondary">
            {activeAgent?.model} • {activeAgentTokenBudget} token cap
          </p>
        </div>
      </header>

      <div
        className={cn(
          'flex items-start gap-3 rounded-3xl border px-5 py-4',
          configState.className,
        )}
      >
        <configState.icon size={18} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-bold">{configState.title}</p>
          <p className="text-sm leading-relaxed">{configState.body}</p>
          {configError && <p className="text-sm font-medium">{configError}</p>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 xl:flex-row xl:gap-8">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-outline-variant/15 bg-white shadow-sm">
          <div className="border-b border-outline-variant/10 bg-surface-container-lowest/30 px-6 py-4">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search capability chat history..."
                className="w-full rounded-xl border border-outline-variant/10 bg-surface-container-low py-2 pl-10 pr-4 text-xs outline-none transition-all focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto p-6">
            {filteredMessages.map(message => (
              <div
                key={message.id}
                className={cn(
                  'flex max-w-[80%] gap-4',
                  message.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto',
                )}
              >
                <div
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm',
                    message.role === 'user'
                      ? 'bg-primary text-white'
                      : 'border border-primary/10 bg-surface-container-high text-primary',
                  )}
                >
                  {message.role === 'user' ? <User size={20} /> : <Cpu size={20} />}
                </div>
                <div className="space-y-1">
                  <div
                    className={cn(
                      'mb-1 flex items-center gap-2',
                      message.role === 'user' ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <span className="text-[0.625rem] font-bold uppercase tracking-widest text-slate-400">
                      {message.role === 'user' ? 'You' : message.agentName}
                    </span>
                    <span className="text-[0.625rem] text-slate-300">{message.timestamp}</span>
                  </div>
                  <div
                    className={cn(
                      'rounded-2xl p-4 text-sm leading-relaxed',
                      message.role === 'user'
                        ? 'rounded-tr-none bg-primary text-white'
                        : 'rounded-tl-none border border-outline-variant/5 bg-surface-container-low text-on-surface',
                    )}
                  >
                    {message.content}
                  </div>
                </div>
              </div>
            ))}

            {isSending && activeAgent && (
              <div className="mr-auto flex max-w-[80%] gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/10 bg-surface-container-high text-primary shadow-sm">
                  <LoaderCircle size={20} className="animate-spin" />
                </div>
                <div className="space-y-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-[0.625rem] font-bold uppercase tracking-widest text-slate-400">
                      {activeAgent.name}
                    </span>
                    <span className="text-[0.625rem] text-slate-300">Working...</span>
                  </div>
                  <div className="rounded-2xl rounded-tl-none border border-outline-variant/5 bg-surface-container-low p-4 text-sm leading-relaxed text-on-surface">
                    Grounding the response in {activeCapability.name}, {activeAgent.role},
                    documentation context, and the selected {activeAgent.model} runtime.
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-outline-variant/10 bg-surface-container-lowest p-6">
            {error && (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {error}
              </div>
            )}

            <form onSubmit={handleSend} className="relative">
              <input
                type="text"
                value={input}
                onChange={event => setInput(event.target.value)}
                placeholder={`Message ${activeAgent?.name || 'the capability owner'} inside ${activeCapability.name}...`}
                className="w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low py-4 pl-12 pr-24 text-sm outline-none shadow-inner transition-all focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-primary"
              >
                <Paperclip size={20} />
              </button>
              <div className="absolute right-3 top-1/2 flex -translate-y-1/2 gap-2">
                <button
                  type="submit"
                  disabled={!input.trim() || isSending || !runtimeStatus?.configured}
                  className="rounded-xl bg-primary p-2.5 text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110 disabled:opacity-50"
                >
                  <Send size={18} />
                </button>
              </div>
            </form>
            <p className="mt-3 text-center text-[0.625rem] font-medium uppercase tracking-widest text-slate-400">
              Responses stay inside the {activeCapability.name} capability boundary.
            </p>
          </div>
        </div>

        <div className="flex min-h-0 w-full flex-col gap-6 xl:w-80 xl:min-w-80">
          <section className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-primary">
              <Zap size={16} />
              Active Context
            </h3>
            <div className="space-y-4">
              <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-3">
                <p className="mb-1 text-[0.625rem] font-bold uppercase text-slate-400">
                  Capability
                </p>
                <p className="text-xs font-bold text-on-surface">{activeCapability.name}</p>
              </div>
              <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-3">
                <p className="mb-1 text-[0.625rem] font-bold uppercase text-slate-400">
                  Owner Agent
                </p>
                <p className="text-xs font-bold text-on-surface">
                  {workspace.agents.find(agent => agent.isOwner)?.name}
                </p>
              </div>
              <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-3">
                <p className="mb-1 text-[0.625rem] font-bold uppercase text-slate-400">
                  Runtime
                </p>
                <p className="text-xs font-bold text-on-surface">{activeAgent?.model}</p>
                <p className="mt-1 text-[0.6875rem] text-secondary">
                  {activeAgentTokenBudget} token budget
                </p>
              </div>
              <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-3">
                <p className="mb-1 text-[0.625rem] font-bold uppercase text-slate-400">
                  Usage
                </p>
                <p className="text-xs font-bold text-on-surface">
                  {activeAgentTokenUsage} total tokens
                </p>
                <p className="mt-1 text-[0.6875rem] text-secondary">
                  ${activeAgentEstimatedCost} estimated spend
                </p>
              </div>
              <div className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-3">
                <p className="mb-1 text-[0.625rem] font-bold uppercase text-slate-400">
                  Team Size
                </p>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <p className="text-xs font-bold text-on-surface">
                    {workspace.agents.length} agents scoped to this capability
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-primary">
              <Bot size={16} />
              Chat Agents
            </h3>
            <div className="space-y-3">
              {workspace.agents.map(agent => {
                const isActive = activeAgent?.id === agent.id;
                return (
                  <button
                    key={agent.id}
                    onClick={() => setActiveChatAgent(activeCapability.id, agent.id)}
                    className={cn(
                      'w-full rounded-2xl border px-4 py-3 text-left transition-all',
                      isActive
                        ? 'border-primary/20 bg-primary/5'
                        : 'border-outline-variant/10 hover:border-primary/15 hover:bg-surface-container-low',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-on-surface">{agent.name}</p>
                        <p className="mt-1 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                          {agent.role}
                        </p>
                        <p className="mt-1 text-[0.6875rem] text-secondary">
                          {agent.model}
                        </p>
                      </div>
                      {isActive && <CheckCircle2 size={16} className="text-primary" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-primary">
              <Brain size={16} />
              Team Learning
            </h3>
            <div className="custom-scrollbar space-y-3 overflow-y-auto pr-2">
              {learningFeed.map(item => (
                <div
                  key={item.id}
                  className="rounded-xl border border-outline-variant/5 bg-surface-container-low p-3"
                >
                  <p className="text-[0.6875rem] leading-snug text-secondary">{item.note}</p>
                  <span className="text-[0.5rem] font-bold uppercase text-slate-300">
                    {item.agentName}
                  </span>
                </div>
              ))}
              {learningFeed.length === 0 && (
                <div className="rounded-2xl bg-surface-container-low p-4 text-sm text-secondary">
                  No capability learning notes have been recorded yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Chat;
