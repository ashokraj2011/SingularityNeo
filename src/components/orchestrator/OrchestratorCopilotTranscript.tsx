import React, { useMemo, useState } from 'react';
import { Bot, Brain, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
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

// ---------------------------------------------------------------------------
// Collapsible disclosure used for thinking and tool-result blocks.
// ---------------------------------------------------------------------------
const Disclosure = ({
  label,
  icon: Icon,
  children,
  defaultOpen = false,
  labelClassName,
  containerClassName,
}: {
  label: string;
  icon: typeof Brain;
  children: React.ReactNode;
  defaultOpen?: boolean;
  labelClassName?: string;
  containerClassName?: string;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn('rounded-2xl border', containerClassName)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Icon size={13} className={cn('shrink-0', labelClassName)} />
        <span className={cn('flex-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em]', labelClassName)}>
          {label}
        </span>
        {open
          ? <ChevronDown size={13} className={labelClassName} />
          : <ChevronRight size={13} className={labelClassName} />
        }
      </button>
      {open && (
        <div className="border-t px-3 py-2">
          {children}
        </div>
      )}
    </div>
  );
};

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
    tone === 'user'   ? 'text-white/75'
    : tone === 'draft' ? 'text-slate-500'
    : 'text-secondary';

  const panelTone =
    tone === 'user'   ? 'border-white/15 bg-white/10 text-white'
    : tone === 'draft' ? 'border-slate-200 bg-slate-50/90 text-slate-900'
    : 'border-slate-200 bg-slate-50/85 text-slate-900';

  const codeTone =
    tone === 'user'
      ? 'border-white/10 bg-slate-950/35 text-white'
      : 'border-slate-200 bg-white text-slate-900';

  const mdToneClass =
    tone === 'user'   ? 'copilot-md-user'
    : tone === 'draft' ? 'copilot-md-draft'
    : 'copilot-md-agent';

  // Thinking / tool-result disclosure tones
  const thinkingContainer =
    tone === 'user'
      ? 'border-white/15 bg-slate-950/20'
      : 'border-slate-200 bg-slate-50/60';
  const thinkingLabel =
    tone === 'user' ? 'text-white/60' : 'text-slate-400';
  const resultContainer =
    tone === 'user'
      ? 'border-white/15 bg-slate-950/20'
      : 'border-slate-200/80 bg-white/60';
  const resultLabel =
    tone === 'user' ? 'text-white/60' : 'text-slate-400';

  if (blocks.length === 0) return null;

  const lastBlockIndex = blocks.length - 1;

  return (
    <div className="mt-3 space-y-3">
      {blocks.map((block, index) => {
        // ── plain text ──────────────────────────────────────────────────────
        if (block.type === 'text') {
          const isLastTextBlock = isStreaming && index === lastBlockIndex;
          return (
            <div
              key={`${block.type}-${index}`}
              className={cn('copilot-md-block', isLastTextBlock ? 'copilot-md-block-streaming' : null)}
            >
              <MarkdownContent content={block.text} className={cn('copilot-md', mdToneClass)} />
            </div>
          );
        }

        // ── system annotation ───────────────────────────────────────────────
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

        // ── extended thinking (collapsed by default) ────────────────────────
        if (block.type === 'thinking') {
          return (
            <Disclosure
              key={`${block.type}-${index}`}
              label="Reasoning"
              icon={Brain}
              defaultOpen={false}
              containerClassName={thinkingContainer}
              labelClassName={thinkingLabel}
            >
              <pre
                className={cn(
                  'whitespace-pre-wrap break-words text-xs leading-relaxed',
                  tone === 'user' ? 'text-white/80' : 'text-slate-600',
                )}
              >
                {block.text}
              </pre>
            </Disclosure>
          );
        }

        // ── tool result (collapsed by default) ─────────────────────────────
        if (block.type === 'tool_result') {
          const label = block.toolName ? `Result: ${block.toolName}` : 'Tool output';
          return (
            <Disclosure
              key={`${block.type}-${index}`}
              label={label}
              icon={Wrench}
              defaultOpen={false}
              containerClassName={resultContainer}
              labelClassName={resultLabel}
            >
              <pre
                className={cn(
                  'max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed',
                  tone === 'user' ? 'text-white/80' : 'text-slate-600',
                )}
              >
                {block.content}
              </pre>
            </Disclosure>
          );
        }

        // ── tool call ───────────────────────────────────────────────────────
        return (
          <div
            key={`${block.type}-${index}`}
            className={cn('rounded-2xl border px-3 py-3 shadow-sm', panelTone)}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn('text-[0.68rem] font-semibold uppercase tracking-[0.16em]', metaTone)}>
                Tool call
              </span>
              <span className={cn('text-sm font-semibold', tone === 'user' ? 'text-white' : 'text-on-surface')}>
                {block.toolName || 'Tool'}
              </span>
            </div>
            {block.parameters.length > 0 ? (
              <div className="mt-3 space-y-2">
                {block.parameters.map(parameter => (
                  <div key={`${parameter.name}-${parameter.value.slice(0, 24)}`}>
                    <p className={cn('text-[0.68rem] font-semibold uppercase tracking-[0.14em]', metaTone)}>
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
