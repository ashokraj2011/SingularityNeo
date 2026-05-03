import React from 'react';
import { Bot, User } from 'lucide-react';
import { motion } from 'motion/react';
import type { CapabilityChatMessage } from '../../types';
import { cn } from '../../lib/utils';
import {
  CopilotThinkingIndicator,
  MemoizedCopilotMessageBody,
} from './OrchestratorCopilotTranscript';

type Props = {
  messages: CapabilityChatMessage[];
  currentActorDisplayName: string;
  selectedAgentName?: string | null;
  dockDraft: string;
  isDockSending: boolean;
  threadRef: React.RefObject<HTMLDivElement | null>;
  onScroll: React.UIEventHandler<HTMLDivElement>;
};

export const OrchestratorCopilotThread = ({
  messages,
  currentActorDisplayName,
  selectedAgentName,
  dockDraft,
  isDockSending,
  threadRef,
  onScroll,
}: Props) => (
  <div className="flex min-h-[12rem] flex-1 flex-col">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="workspace-meta-label">Conversation</p>
        <p className="mt-1 text-xs leading-relaxed text-secondary">
          Ask follow-up questions, inspect prior guidance, and keep the run conversation in one
          place.
        </p>
      </div>
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-outline">
        {messages.length + (dockDraft || isDockSending ? 1 : 0)} visible entries
      </span>
    </div>
    <div
      ref={threadRef}
      className="orchestrator-stage-chat-thread orchestrator-stage-chat-thread-dock custom-scrollbar"
      onScroll={onScroll}
    >
      {messages.length === 0 && !dockDraft && !isDockSending ? (
        <div className="orchestrator-stage-chat-empty">
          This work item does not have a copilot thread yet. Ask a question, upload evidence, or
          capture the first operator note to start the thread.
        </div>
      ) : (
        <>
          {messages.map(message => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'orchestrator-stage-chat-message',
                message.role === 'user'
                  ? 'orchestrator-stage-chat-message-user'
                  : 'orchestrator-stage-chat-message-agent',
              )}
            >
              <div className="orchestrator-stage-chat-message-meta">
                <span className="inline-flex items-center gap-2">
                  {message.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                  {message.role === 'user'
                    ? currentActorDisplayName
                    : message.agentName || message.agentId || 'Agent'}
                </span>
                <span>{message.timestamp}</span>
              </div>
              <MemoizedCopilotMessageBody
                content={message.content}
                tone={message.role === 'user' ? 'user' : 'agent'}
              />
            </motion.div>
          ))}
          {dockDraft ? (
            <motion.div
              key="dock-draft"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="orchestrator-stage-chat-message orchestrator-stage-chat-message-agent"
            >
              <div className="orchestrator-stage-chat-message-meta">
                <span className="inline-flex items-center gap-2">
                  <Bot size={14} />
                  {selectedAgentName || 'Agent'}
                </span>
                <CopilotThinkingIndicator label="Streaming" />
              </div>
              <MemoizedCopilotMessageBody content={dockDraft} tone="draft" isStreaming />
            </motion.div>
          ) : isDockSending ? (
            <motion.div
              key="dock-thinking"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="orchestrator-stage-chat-message orchestrator-stage-chat-message-agent orchestrator-stage-chat-message-thinking"
            >
              <div className="orchestrator-stage-chat-message-meta">
                <span className="inline-flex items-center gap-2">
                  <Bot size={14} />
                  {selectedAgentName || 'Agent'}
                </span>
                <span>Just now</span>
              </div>
              <div className="mt-3">
                <CopilotThinkingIndicator label="Thinking" />
              </div>
            </motion.div>
          ) : null}
        </>
      )}
    </div>
  </div>
);
