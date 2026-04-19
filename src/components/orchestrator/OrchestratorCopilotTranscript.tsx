import React, { useMemo } from 'react';
import { Bot } from 'lucide-react';
import MarkdownContent from '../MarkdownContent';
import { parseCopilotTranscriptBlocks } from '../../lib/copilotTranscript';
import { cn } from '../../lib/utils';

export const CopilotThinkingIndicator = ({
  label = 'Thinking',
  tone = 'agent',
}: {
  label?: string;
  tone?: 'agent' | 'draft' | 'user';
}) => (
  <span
    className={cn(
      'copilot-thinking-indicator',
      tone === 'user' ? 'copilot-thinking-indicator-user' : null,
    )}
    aria-live="polite"
    aria-label={`${label}…`}
  >
    <span className="copilot-thinking-dots" aria-hidden="true">
      <span className="copilot-thinking-dot" />
      <span className="copilot-thinking-dot" />
      <span className="copilot-thinking-dot" />
    </span>
    <span className="copilot-thinking-label">{label}</span>
  </span>
);

export const CopilotMessageBody = ({
  content,
  tone,
  isStreaming = false,
}: {
  content: string;
  tone: 'agent' | 'user' | 'draft';
  isStreaming?: boolean;
}) => {
  const blocks = useMemo(() => parseCopilotTranscriptBlocks(content), [content]);
  const metaTone =
    tone === 'user'
      ? 'text-white/75'
      : tone === 'draft'
      ? 'text-slate-500'
      : 'text-secondary';
  const panelTone =
    tone === 'user'
      ? 'border-white/15 bg-white/10 text-white'
      : tone === 'draft'
      ? 'border-slate-200 bg-slate-50/90 text-slate-900'
      : 'border-slate-200 bg-slate-50/85 text-slate-900';
  const codeTone =
    tone === 'user'
      ? 'border-white/10 bg-slate-950/35 text-white'
      : 'border-slate-200 bg-white text-slate-900';
  const mdToneClass =
    tone === 'user'
      ? 'copilot-md-user'
      : tone === 'draft'
      ? 'copilot-md-draft'
      : 'copilot-md-agent';

  if (blocks.length === 0) {
    return null;
  }

  const lastBlockIndex = blocks.length - 1;

  return (
    <div className="mt-3 space-y-3">
      {blocks.map((block, index) => {
        if (block.type === 'text') {
          const isLastTextBlock =
            isStreaming && index === lastBlockIndex && block.type === 'text';
          return (
            <div
              key={`${block.type}-${index}`}
              className={cn(
                'copilot-md-block',
                isLastTextBlock ? 'copilot-md-block-streaming' : null,
              )}
            >
              <MarkdownContent content={block.text} className={cn('copilot-md', mdToneClass)} />
            </div>
          );
        }

        if (block.type === 'system') {
          return (
            <div
              key={`${block.type}-${index}`}
              className={cn(
                'rounded-2xl border px-3 py-2 text-xs leading-6',
                tone === 'user'
                  ? 'border-white/15 bg-slate-950/25 text-white/90'
                  : 'border-slate-200 bg-white/85 text-slate-700',
              )}
            >
              <span className="font-semibold uppercase tracking-[0.14em]">System</span>
              <span className="ml-2">{block.text}</span>
            </div>
          );
        }

        return (
          <div
            key={`${block.type}-${index}`}
            className={cn('rounded-2xl border px-3 py-3 shadow-sm', panelTone)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={cn(
                  'text-[0.68rem] font-semibold uppercase tracking-[0.16em]',
                  metaTone,
                )}
              >
                Tool call
              </span>
              <span
                className={cn(
                  'text-sm font-semibold',
                  tone === 'user' ? 'text-white' : 'text-on-surface',
                )}
              >
                {block.toolName || 'Tool'}
              </span>
            </div>
            {block.parameters.length > 0 ? (
              <div className="mt-3 space-y-2">
                {block.parameters.map(parameter => (
                  <div key={`${parameter.name}-${parameter.value.slice(0, 24)}`}>
                    <p
                      className={cn(
                        'text-[0.68rem] font-semibold uppercase tracking-[0.14em]',
                        metaTone,
                      )}
                    >
                      {parameter.name}
                    </p>
                    <pre
                      className={cn(
                        'mt-1 whitespace-pre-wrap break-all rounded-2xl border px-3 py-2 text-xs leading-6',
                        codeTone,
                      )}
                    >
                      {parameter.value}
                    </pre>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export const MemoizedCopilotMessageBody = React.memo(CopilotMessageBody);

export const CopilotTypingBubble = ({ agentName }: { agentName?: string | null }) => (
  <div className="orchestrator-stage-chat-message orchestrator-stage-chat-message-agent orchestrator-stage-chat-message-thinking">
    <div className="orchestrator-stage-chat-message-meta">
      <span className="inline-flex items-center gap-2">
        <Bot size={14} />
        {agentName || 'Agent'}
      </span>
      <span>Just now</span>
    </div>
    <div className="mt-3">
      <CopilotThinkingIndicator label="Thinking" />
    </div>
  </div>
);
