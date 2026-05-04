import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  StopCircle,
  User,
  X,
  CheckCircle,
} from 'lucide-react';
import { ModalShell, StatusBadge } from './EnterpriseUI';
import {
  continueCapabilityWorkItemStageControl,
  streamCapabilityChat,
} from '../lib/api';
import type {
  Capability,
  CapabilityAgent,
  CompiledStepContext,
  RunWait,
  WorkItem,
  WorkflowRun,
  WorkflowStep,
} from '../types';
import { getLifecyclePhaseLabel } from '../lib/capabilityLifecycle';
import { useToast } from '../context/ToastContext';

type StageControlMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  traceId?: string;
  model?: string;
};

const formatTimestamp = (value = new Date()) =>
  value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

const getContinueLabel = ({
  currentRun,
  openWait,
  workItemStatus,
}: {
  currentRun?: WorkflowRun | null;
  openWait?: RunWait | null;
  workItemStatus?: WorkItem['status'];
}) => {
  if (openWait?.type === 'APPROVAL') {
    return 'Use chat to approve and continue';
  }
  if (openWait?.type === 'INPUT') {
    return 'Use chat to submit input and continue';
  }
  if (openWait?.type === 'CONFLICT_RESOLUTION') {
    return 'Use chat to resolve and continue';
  }
  if (workItemStatus === 'BLOCKED') {
    return 'Use chat to unblock and restart';
  }
  if (currentRun?.status === 'RUNNING' || currentRun?.status === 'QUEUED') {
    return 'Restart stage with takeover';
  }
  if (currentRun) {
    return 'Restart this stage';
  }
  return 'Start this stage';
};

const getContinueHelper = ({
  currentRun,
  openWait,
  workItemStatus,
}: {
  currentRun?: WorkflowRun | null;
  openWait?: RunWait | null;
  workItemStatus?: WorkItem['status'];
}) => {
  if (openWait?.type === 'APPROVAL') {
    return 'Use this conversation as the approval rationale and let the workflow advance with the current stage output.';
  }
  if (openWait?.type === 'INPUT') {
    return 'Use this conversation as the missing input and let the current stage continue automatically.';
  }
  if (openWait?.type === 'CONFLICT_RESOLUTION') {
    return 'Use this conversation as the authoritative resolution for the blocked stage.';
  }
  if (workItemStatus === 'BLOCKED') {
    return 'Use this conversation as the unblock note. The workflow will restart from the current stage with this guidance attached to the next attempt.';
  }
  if (currentRun?.status === 'RUNNING' || currentRun?.status === 'QUEUED') {
    return 'The current attempt will be replaced with a new attempt that carries forward this stage-control conversation.';
  }
  return 'A new attempt will carry this conversation forward so the agent can complete the stage and produce the required output.';
};

export const StageControlModal = ({
  isOpen,
  capability,
  workItem,
  agent,
  currentRun,
  currentStep,
  openWait,
  compiledStepContext,
  failureReason,
  runtimeReady,
  runtimeError,
  onOpenStageOwnership,
  onClose,
  onRefresh,
}: {
  isOpen: boolean;
  capability: Capability;
  workItem: WorkItem;
  agent: CapabilityAgent | null;
  currentRun?: WorkflowRun | null;
  currentStep?: WorkflowStep | null;
  openWait?: RunWait | null;
  compiledStepContext?: CompiledStepContext;
  failureReason?: string;
  runtimeReady: boolean;
  runtimeError?: string;
  onOpenStageOwnership?: () => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) => {
  const { success, info } = useToast();
  const [messages, setMessages] = useState<StageControlMessage[]>([]);
  const [input, setInput] = useState('');
  const [carryForwardNote, setCarryForwardNote] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const [streamedDraft, setStreamedDraft] = useState('');
  const [error, setError] = useState('');
  const [sessionMode, setSessionMode] = useState<'resume' | 'fresh'>('resume');
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const isMountedRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      requestRef.current += 1;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      requestRef.current += 1;
      abortControllerRef.current?.abort();
      return;
    }

    setMessages([]);
    setInput('');
    setCarryForwardNote('');
    setError('');
    setStreamedDraft('');
    setSessionMode('resume');
  }, [isOpen, workItem.id]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isOpen, messages, streamedDraft]);

  const workItemSession = useMemo(
    () =>
      agent?.sessionSummaries.find(
        session => session.scope === 'WORK_ITEM' && session.scopeId === workItem.id,
      ),
    [agent, workItem.id],
  );

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || !agent) {
      return;
    }

    if (!runtimeReady) {
      setError(runtimeError || 'Agent connection is not ready.');
      return;
    }

    const userMessage: StageControlMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: trimmed,
      timestamp: formatTimestamp(),
    };
    const history = messages.map(message => ({
      id: message.id,
      capabilityId: capability.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      agentId: message.role === 'agent' ? agent.id : undefined,
      agentName: message.role === 'agent' ? agent.name : undefined,
    }));

    setMessages(current => [...current, userMessage]);
    setInput('');
    setError('');
    setStreamedDraft('');
    setIsSending(true);
    const requestToken = ++requestRef.current;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await streamCapabilityChat(
        {
          capability,
          agent,
          history,
          message: trimmed,
          sessionMode,
          sessionScope: 'WORK_ITEM',
          sessionScopeId: workItem.id,
          contextMode: 'WORK_ITEM_STAGE',
          workItemId: workItem.id,
          runId: currentRun?.id,
          workflowStepId: currentStep?.id,
        },
        {
          onEvent: event => {
            if (!isMountedRef.current || requestRef.current !== requestToken) {
              return;
            }

            if (event.type === 'delta' && event.content) {
              setStreamedDraft(current => current + event.content);
            }
          },
        },
        {
          signal: controller.signal,
        },
      );

      if (!isMountedRef.current || requestRef.current !== requestToken) {
        return;
      }

      const content = result.completeEvent?.content || result.draftContent;
      if (!content.trim()) {
        throw new Error(result.error || 'The stage-control assistant did not return a response.');
      }

      setMessages(current => [
        ...current,
        {
          id: `${Date.now()}-agent`,
          role: 'agent',
          content,
          timestamp: formatTimestamp(new Date(result.completeEvent?.createdAt || Date.now())),
          traceId: result.completeEvent?.traceId,
          model: result.completeEvent?.model || agent.model,
        },
      ]);
      setStreamedDraft('');
      setSessionMode('resume');
      await onRefresh();

      if (result.termination === 'recovered') {
        info('Recovered draft', 'A partial stage-control response was preserved.');
      }

      if (result.completeEvent?.followUpIntent === 'active-work-scope') {
        setCarryForwardNote(content);
        setTimeout(() => void handleContinue(true), 500);
      }
    } catch (nextError) {
      if (!isMountedRef.current || requestRef.current !== requestToken) {
        return;
      }

      setStreamedDraft('');
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'The stage-control assistant could not complete this turn.',
      );
    } finally {
      if (requestRef.current === requestToken) {
        abortControllerRef.current = null;
      }
      if (isMountedRef.current && requestRef.current === requestToken) {
        setIsSending(false);
      }
    }
  };

  const handleContinue = async (markComplete = false) => {
    if (!agent) {
      return;
    }

    if (messages.length === 0 && !carryForwardNote.trim()) {
      setError('Add at least one message or a carry-forward note before continuing the stage.');
      return;
    }

    setIsContinuing(true);
    setError('');

    try {
      const result = await continueCapabilityWorkItemStageControl(
        capability.id,
        workItem.id,
        {
          agentId: agent.id,
          conversation: messages.map(message => ({
            role: message.role,
            content: message.content,
            timestamp: message.timestamp,
          })),
          carryForwardNote: carryForwardNote.trim() || undefined,
          resolvedBy: 'Capability Owner',
          markComplete,
        },
      );

      await onRefresh();
      success('Stage control applied', result.summary);
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Unable to continue this stage from the takeover window.',
      );
    } finally {
      setIsContinuing(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  const continueLabel = getContinueLabel({
    currentRun,
    openWait,
    workItemStatus: workItem.status,
  });
  const continueHelper = getContinueHelper({
    currentRun,
    openWait,
    workItemStatus: workItem.status,
  });
  const generatedCarryForwardPreview =
    carryForwardNote.trim() ||
    messages
      .slice(-2)
      .map(
        message =>
          `${message.role === 'user' ? 'Operator' : agent?.name || 'Agent'}: ${message.content}`,
      )
      .join('\n\n');

  return (
    <div className="workspace-modal-backdrop z-[96] bg-slate-950/45">
      <button
        type="button"
        aria-label="Close stage control"
        onClick={() => {
          abortControllerRef.current?.abort();
          onClose();
        }}
        className="absolute inset-0"
      />
      <ModalShell
        title={`${currentStep?.name || getLifecyclePhaseLabel(capability, workItem.phase)} stage control`}
        description="Take direct control of the current workflow stage, chat with the assigned agent in a focused work-item session, and continue the stage once you are satisfied."
        eyebrow="Stage Control"
        className="relative z-[1] max-w-[92rem]"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="brand">{getLifecyclePhaseLabel(capability, workItem.phase)}</StatusBadge>
            {currentRun ? <StatusBadge tone="neutral">{currentRun.status}</StatusBadge> : null}
            {onOpenStageOwnership ? (
              <button
                type="button"
                onClick={onOpenStageOwnership}
                className="workspace-list-action"
              >
                <User size={14} />
                Stage owner & uploads
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                abortControllerRef.current?.abort();
                onClose();
              }}
              className="workspace-list-action"
            >
              <X size={14} />
            </button>
          </div>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Work item</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">{workItem.id}</p>
              <p className="mt-1 text-sm leading-relaxed text-secondary">{workItem.title}</p>
            </div>

            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Stage agent</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {agent?.name || 'No agent assigned'}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-secondary">
                {agent?.role || 'Select a stage with an assigned agent to take control.'}
              </p>
              {workItemSession ? (
                <p className="mt-2 text-xs text-secondary">
                  Existing work-item session · {workItemSession.model}
                </p>
              ) : null}
            </div>

            {openWait && (
              <div className="workspace-meta-card border-amber-200/80 bg-amber-50/60">
                <p className="workspace-meta-label">Open wait</p>
                <p className="mt-2 text-sm font-semibold text-on-surface">
                  {openWait.type}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-secondary">
                  {openWait.message}
                </p>
              </div>
            )}

            {failureReason ? (
              <div className="workspace-meta-card border-red-200/80 bg-red-50/60">
                <p className="workspace-meta-label">Latest failure from engine</p>
                <p className="mt-2 text-sm leading-relaxed text-on-surface">
                  {failureReason}
                </p>
              </div>
            ) : null}

            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Stage objective</p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {compiledStepContext?.objective ||
                  currentStep?.action ||
                  'The current stage objective will be inferred from the assigned workflow step.'}
              </p>
            </div>

            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Required inputs</p>
              {compiledStepContext?.requiredInputs?.length ? (
                <ul className="mt-3 space-y-2 text-xs leading-relaxed text-secondary">
                  {compiledStepContext.requiredInputs.map(item => (
                    <li key={item.id} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                      <span>
                        <strong className="text-on-surface">{item.label}</strong>
                        {item.description ? ` · ${item.description}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  No explicit structured inputs were attached to this stage.
                </p>
              )}
            </div>

            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Expected outputs</p>
              {compiledStepContext?.artifactChecklist?.length ? (
                <ul className="mt-3 space-y-2 text-xs leading-relaxed text-secondary">
                  {compiledStepContext.artifactChecklist.map(item => (
                    <li key={item.id} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                      <span>
                        <strong className="text-on-surface">{item.label}</strong>
                        {` · ${item.direction.toLowerCase()}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  The stage will still produce normal workflow output, but no explicit artifact checklist is attached yet.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {!runtimeReady && (
              <div className="workspace-inline-alert workspace-inline-alert-warning">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Agent connection is not ready</p>
                  <p className="mt-1 text-sm leading-relaxed">
                    {runtimeError || 'Configure the runtime before using stage control.'}
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="workspace-inline-alert workspace-inline-alert-danger">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Stage control issue</p>
                  <p className="mt-1 text-sm leading-relaxed">{error}</p>
                </div>
              </div>
            )}

            <div className="workspace-meta-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="workspace-meta-label">Focused takeover chat</p>
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    This session stays scoped to the current work item and stage so you can resolve the blockage, refine the output, or coach the assigned agent directly.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSessionMode('fresh')}
                    disabled={isSending}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    <RefreshCw size={16} />
                    Start fresh
                  </button>
                  {isSending && (
                    <button
                      type="button"
                      onClick={() => abortControllerRef.current?.abort()}
                      className="enterprise-button enterprise-button-danger"
                    >
                      <StopCircle size={16} />
                      Stop
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-[1.5rem] border border-outline-variant/35 bg-slate-950 px-5 py-4 text-slate-100 shadow-[0_24px_80px_rgba(12,23,39,0.2)]">
                <div className="max-h-[28rem] overflow-auto pr-2">
                  {messages.length === 0 && !streamedDraft ? (
                    <div className="flex min-h-[18rem] flex-col items-center justify-center gap-3 text-center text-slate-200/80">
                      <div className="rounded-3xl bg-white/10 p-4">
                        <MessageSquareText size={24} />
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-slate-100">
                          Talk directly to {agent?.name || 'the stage agent'}
                        </p>
                        <p className="max-w-xl text-sm leading-relaxed">
                          Ask what is blocked, what output is missing, what assumptions are unsafe, or what the agent needs to complete this stage well.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messages.map(message => (
                        <div
                          key={message.id}
                          className={`rounded-[1.25rem] px-4 py-3 ${
                            message.role === 'user'
                              ? 'ml-auto max-w-[80%] bg-primary text-white'
                              : 'mr-auto max-w-[88%] bg-white/10 text-slate-100'
                          }`}
                        >
                          <div className="mb-2 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-current/80">
                            {message.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                            <span>{message.role === 'user' ? 'Operator' : agent?.name || 'Agent'}</span>
                            <span>{message.timestamp}</span>
                            {message.model ? <span>{message.model}</span> : null}
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed">
                            {message.content}
                          </p>
                        </div>
                      ))}
                      {streamedDraft && (
                        <div className="mr-auto max-w-[88%] rounded-[1.25rem] bg-white/10 px-4 py-3 text-slate-100">
                          <div className="mb-2 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-slate-200/80">
                            <Bot size={12} />
                            <span>{agent?.name || 'Agent'}</span>
                            <LoaderCircle size={12} className="animate-spin" />
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed">
                            {streamedDraft}
                          </p>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <textarea
                  value={input}
                  onChange={event => setInput(event.target.value)}
                  placeholder={`Ask ${agent?.name || 'the stage agent'} what is blocking this stage or what it needs to produce the required output.`}
                  className="field-textarea h-28 bg-white"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs leading-relaxed text-secondary">
                    Commands like approval, input, conflict resolution, restart, and unblock still work inside this chat.
                  </p>
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={!input.trim() || !agent || isSending}
                    className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isSending ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <Send size={16} />
                    )}
                    Send
                  </button>
                </div>
              </div>
            </div>

            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Carry forward to the stage engine</p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {continueHelper}
              </p>
              <textarea
                value={carryForwardNote}
                onChange={event => setCarryForwardNote(event.target.value)}
                placeholder="Optional: summarize the exact instruction, decision, or acceptance condition the next attempt should carry forward."
                className="field-textarea mt-3 h-24 bg-white"
              />
              <div className="mt-3 rounded-2xl border border-outline-variant/25 bg-surface-container-low px-4 py-3">
                <p className="workspace-meta-label">Unblock payload preview</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-secondary">
                  {generatedCarryForwardPreview ||
                    'If you continue without a manual note, the current stage-control conversation will be used as the unblock note.'}
                </p>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    abortControllerRef.current?.abort();
                    onClose();
                  }}
                  className="enterprise-button enterprise-button-secondary"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void handleContinue(true)}
                  disabled={isContinuing || !agent}
                  className="enterprise-button enterprise-button-success"
                >
                  <CheckCircle size={16} />
                  Mark complete
                </button>
                <button
                  type="button"
                  onClick={() => void handleContinue(false)}
                  disabled={(!messages.length && !carryForwardNote.trim() && !openWait) || isContinuing || !agent}
                  className="enterprise-button enterprise-button-brand-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isContinuing ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : openWait ? (
                    <ShieldCheck size={16} />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                  {continueLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      </ModalShell>
    </div>
  );
};

export default StageControlModal;
