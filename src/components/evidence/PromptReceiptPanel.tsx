/**
 * PromptReceiptPanel — Phase 2 / Lever 7 observability surface for the
 * context-budgeter (see plan: /Users/ashokraj/.claude/plans/iridescent-tinkering-cocoa.md).
 *
 * Every main-model LLM call in `requestStepDecision` emits a
 * `PROMPT_RECEIPT` run event whose `details` payload describes exactly
 * which context fragments the model saw (and which got evicted under
 * budget pressure). This panel renders that payload so operators can
 * answer "why did the model decide X" with "because it saw these
 * specific fragments."
 *
 * Input: the same `RunEvent[]` the Attempts panel consumes. We filter
 * to `type === 'PROMPT_RECEIPT'` and render one card per receipt.
 */
import React from 'react';
import { Info, Scissors, Layers, Play, RotateCcw, Loader2 } from 'lucide-react';
import type { RunEvent } from '../../types';
import {
  fetchPromptReceiptsForRun,
  type PersistedPromptReceipt,
} from '../../lib/api';
import { EmptyState, SectionCard, StatTile, StatusBadge } from '../EnterpriseUI';
import { PromptReceiptReplayModal } from './PromptReceiptReplayModal';

// These match `ContextSource` in server/execution/contextBudget.ts. Duplicated
// here as a string-literal union to avoid a server→client import.
type ContextSource =
  | 'SYSTEM_CORE'
  | 'TOOL_DESCRIPTIONS'
  | 'PHASE_GUIDANCE'
  | 'WORK_ITEM_BRIEFING'
  | 'RAW_TAIL_TURNS'
  | 'HISTORY_ROLLUP'
  | 'CODE_HUNKS'
  | 'MEMORY_HITS'
  | 'OPERATOR_GUIDANCE'
  | 'PLAN_SUMMARY'
  | 'STEP_CONTRACT';

interface IncludedFragment {
  source: ContextSource;
  estimatedTokens: number;
  meta?: Record<string, unknown>;
}

interface EvictedFragment {
  source: ContextSource;
  estimatedTokens: number;
  reason: 'budget_overflow' | 'duplicate';
  meta?: Record<string, unknown>;
}

interface PromptReceiptDetails {
  stage?: 'PROMPT_RECEIPT';
  included?: IncludedFragment[];
  evicted?: EvictedFragment[];
  totalEstimatedTokens?: number;
  maxInputTokens?: number;
  reservedOutputTokens?: number;
  phase?: string | null;
  model?: string | null;
  actualUsage?: {
    prompt?: number | null;
    completion?: number | null;
    total?: number | null;
  } | null;
}

/**
 * Bar colors by source. Each source gets a distinct hue so the stacked
 * bar reads as a legend at a glance. Tailwind requires concrete class
 * names, so we use an explicit map (no dynamic-string hacks).
 */
const SOURCE_BAR_CLASS: Record<ContextSource, string> = {
  SYSTEM_CORE: 'bg-slate-500',
  TOOL_DESCRIPTIONS: 'bg-indigo-500',
  STEP_CONTRACT: 'bg-violet-500',
  WORK_ITEM_BRIEFING: 'bg-blue-500',
  OPERATOR_GUIDANCE: 'bg-purple-500',
  PLAN_SUMMARY: 'bg-sky-500',
  PHASE_GUIDANCE: 'bg-cyan-500',
  RAW_TAIL_TURNS: 'bg-emerald-500',
  HISTORY_ROLLUP: 'bg-teal-500',
  CODE_HUNKS: 'bg-amber-500',
  MEMORY_HITS: 'bg-rose-500',
};

const SOURCE_SWATCH_CLASS: Record<ContextSource, string> = {
  SYSTEM_CORE: 'bg-slate-500',
  TOOL_DESCRIPTIONS: 'bg-indigo-500',
  STEP_CONTRACT: 'bg-violet-500',
  WORK_ITEM_BRIEFING: 'bg-blue-500',
  OPERATOR_GUIDANCE: 'bg-purple-500',
  PLAN_SUMMARY: 'bg-sky-500',
  PHASE_GUIDANCE: 'bg-cyan-500',
  RAW_TAIL_TURNS: 'bg-emerald-500',
  HISTORY_ROLLUP: 'bg-teal-500',
  CODE_HUNKS: 'bg-amber-500',
  MEMORY_HITS: 'bg-rose-500',
};

const SOURCE_LABEL: Record<ContextSource, string> = {
  SYSTEM_CORE: 'System core',
  TOOL_DESCRIPTIONS: 'Tool descriptions',
  STEP_CONTRACT: 'Step contract',
  WORK_ITEM_BRIEFING: 'Work-item briefing',
  OPERATOR_GUIDANCE: 'Operator guidance',
  PLAN_SUMMARY: 'Plan summary',
  PHASE_GUIDANCE: 'Phase guidance',
  RAW_TAIL_TURNS: 'Raw tail turns',
  HISTORY_ROLLUP: 'History rollup',
  CODE_HUNKS: 'Code hunks',
  MEMORY_HITS: 'Memory hits',
};

const formatPct = (n: number): string => (n < 1 && n > 0 ? '<1%' : `${Math.round(n)}%`);

const formatTokens = (n: number | undefined | null): string => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

const describeMeta = (meta?: Record<string, unknown>): string => {
  if (!meta) return '';
  const pieces: string[] = [];
  if (typeof meta.filePath === 'string') {
    pieces.push(String(meta.filePath));
    if (typeof meta.symbolName === 'string') {
      pieces[pieces.length - 1] += ` → ${meta.symbolName}`;
    }
    if (typeof meta.startLine === 'number' && typeof meta.endLine === 'number') {
      pieces[pieces.length - 1] += `:${meta.startLine}–${meta.endLine}`;
    }
  }
  if (typeof meta.memoryId === 'string') {
    const sim = typeof meta.similarity === 'number' ? ` (sim ${meta.similarity.toFixed(2)})` : '';
    pieces.push(`mem:${meta.memoryId}${sim}`);
  }
  if (typeof meta.summarizedTurns === 'number') {
    const budget = typeof meta.budgetModel === 'string' ? ` via ${meta.budgetModel}` : '';
    pieces.push(`${meta.summarizedTurns} turns condensed${budget}`);
  }
  if (typeof meta.categories === 'string' || Array.isArray(meta.categories)) {
    const cats = Array.isArray(meta.categories) ? meta.categories.join(', ') : String(meta.categories);
    pieces.push(`categories: ${cats}`);
  }
  return pieces.join(' · ');
};

const formatReceiptTimestamp = (ts: string): string => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
};

type ReceiptCardProps = {
  event: RunEvent;
  details: PromptReceiptDetails;
};

const ReceiptCard = ({ event, details }: ReceiptCardProps) => {
  const included = details.included ?? [];
  const evicted = details.evicted ?? [];
  const total = details.totalEstimatedTokens ?? included.reduce((a, f) => a + f.estimatedTokens, 0);
  const max = details.maxInputTokens ?? 0;
  const reserved = details.reservedOutputTokens ?? 0;
  const usagePct = max > 0 ? (total / max) * 100 : 0;
  const evictedTotal = evicted.reduce((a, f) => a + f.estimatedTokens, 0);
  const actual = details.actualUsage ?? null;

  const tone: React.ComponentProps<typeof StatusBadge>['tone'] =
    evicted.length > 0 ? 'warning' : 'success';
  const badge = evicted.length > 0 ? `${evicted.length} evicted` : 'no eviction';

  return (
    <div className="workspace-meta-card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="workspace-meta-label">Prompt receipt</p>
          <p className="text-xs text-secondary">
            {formatReceiptTimestamp(event.timestamp)}
            {details.phase ? ` · ${details.phase}` : ''}
            {details.model ? ` · ${details.model}` : ''}
          </p>
        </div>
        <StatusBadge tone={tone}>{badge}</StatusBadge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Input tokens"
          value={`${formatTokens(total)} / ${formatTokens(max)}`}
          helper={max > 0 ? `${formatPct(usagePct)} of budget` : undefined}
          icon={Layers}
          tone={usagePct > 90 ? 'warning' : 'info'}
        />
        <StatTile
          label="Reserved output"
          value={formatTokens(reserved)}
          helper="Headroom for response"
        />
        <StatTile
          label="Included fragments"
          value={included.length}
          helper={`${Object.keys(
            included.reduce<Record<string, true>>((acc, f) => {
              acc[f.source] = true;
              return acc;
            }, {}),
          ).length} sources`}
        />
        <StatTile
          label="Evicted"
          value={evicted.length}
          helper={evicted.length > 0 ? `${formatTokens(evictedTotal)} tokens cut` : 'All fragments kept'}
          tone={evicted.length > 0 ? 'warning' : 'success'}
          icon={evicted.length > 0 ? Scissors : undefined}
        />
      </div>

      {/* Stacked bar of included fragments, proportional to estimated tokens. */}
      {included.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-secondary">
            <span>Context mix</span>
            <span>{formatTokens(total)} tokens</span>
          </div>
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100"
            role="img"
            aria-label={`Context mix: ${included
              .map(f => `${SOURCE_LABEL[f.source]} ${formatTokens(f.estimatedTokens)}`)
              .join(', ')}`}
          >
            {included.map((fragment, idx) => {
              const pct = total > 0 ? (fragment.estimatedTokens / total) * 100 : 0;
              return (
                <div
                  key={`${fragment.source}-${idx}`}
                  className={SOURCE_BAR_CLASS[fragment.source]}
                  style={{ width: `${pct}%` }}
                  title={`${SOURCE_LABEL[fragment.source]} · ${formatTokens(fragment.estimatedTokens)} tokens (${formatPct(pct)})`}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Included fragment table. */}
      {included.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer select-none font-semibold text-secondary">
            Included fragments ({included.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {included.map((fragment, idx) => {
              const pct = total > 0 ? (fragment.estimatedTokens / total) * 100 : 0;
              const metaLine = describeMeta(fragment.meta);
              return (
                <li
                  key={`${fragment.source}-${idx}`}
                  className="flex items-start gap-2 rounded border border-slate-100 bg-white/60 p-2"
                >
                  <span
                    className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${SOURCE_SWATCH_CLASS[fragment.source]}`}
                    aria-hidden
                  />
                  <div className="flex-1">
                    <p className="font-medium text-primary">{SOURCE_LABEL[fragment.source]}</p>
                    {metaLine ? <p className="text-secondary">{metaLine}</p> : null}
                  </div>
                  <span className="shrink-0 font-mono text-[0.7rem] text-secondary">
                    {formatTokens(fragment.estimatedTokens)} ({formatPct(pct)})
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      {/* Evicted fragments. */}
      {evicted.length > 0 ? (
        <details className="text-xs" open>
          <summary className="cursor-pointer select-none font-semibold text-amber-700">
            Evicted fragments ({evicted.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {evicted.map((fragment, idx) => {
              const metaLine = describeMeta(fragment.meta);
              return (
                <li
                  key={`${fragment.source}-${idx}`}
                  className="flex items-start gap-2 rounded border border-amber-100 bg-amber-50/60 p-2"
                >
                  <Scissors size={12} className="mt-1 shrink-0 text-amber-600" aria-hidden />
                  <div className="flex-1">
                    <p className="font-medium text-primary">{SOURCE_LABEL[fragment.source]}</p>
                    <p className="text-secondary">
                      {fragment.reason.replace(/_/g, ' ')}
                      {metaLine ? ` · ${metaLine}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[0.7rem] text-amber-700">
                    -{formatTokens(fragment.estimatedTokens)}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      {actual && (actual.prompt != null || actual.completion != null || actual.total != null) ? (
        <div className="flex flex-wrap gap-4 border-t border-slate-100 pt-3 text-xs text-secondary">
          <span>
            Actual prompt: <span className="font-mono">{formatTokens(actual.prompt ?? null)}</span>
          </span>
          <span>
            Actual completion: <span className="font-mono">{formatTokens(actual.completion ?? null)}</span>
          </span>
          <span>
            Actual total: <span className="font-mono">{formatTokens(actual.total ?? null)}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
};

type Props = {
  selectedRunEvents: RunEvent[];
  /**
   * When provided, the panel also fetches persisted prompt receipts
   * for this run from the API and surfaces a "Replay" action per
   * receipt. Omit to keep the panel purely presentational.
   */
  capabilityId?: string | null;
  runId?: string | null;
};

/**
 * Compact card for a persisted (replayable) prompt receipt. Mirrors
 * the look of the ephemeral ReceiptCard but adds the Replay action.
 */
const ReplayableReceiptCard = ({
  receipt,
  onReplay,
}: {
  receipt: PersistedPromptReceipt;
  onReplay: (receipt: PersistedPromptReceipt) => void;
}) => {
  const evictedCount = receipt.evicted.length;
  const tone: React.ComponentProps<typeof StatusBadge>['tone'] =
    evictedCount > 0 ? 'warning' : 'success';
  return (
    <div className="workspace-meta-card flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="workspace-meta-label">
          {receipt.phase ? `${receipt.phase} · ` : ''}
          {receipt.model || 'unknown model'}
        </p>
        <p className="truncate text-xs text-secondary">
          {formatReceiptTimestamp(receipt.createdAt)}
          {' · '}
          {receipt.fragments.length} fragments ·{' '}
          {formatTokens(receipt.totalEstimatedTokens)} /{' '}
          {formatTokens(receipt.maxInputTokens)} tokens
        </p>
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge tone={tone}>
          {evictedCount > 0 ? `${evictedCount} evicted` : 'kept all'}
        </StatusBadge>
        <button
          type="button"
          onClick={() => onReplay(receipt)}
          className="workspace-list-action workspace-list-action-primary flex items-center gap-1.5"
        >
          <Play size={12} />
          Replay
        </button>
      </div>
    </div>
  );
};

/**
 * Renders every `PROMPT_RECEIPT` run event in the provided list as a
 * stacked-bar card showing what the main model saw and what the
 * budgeter evicted. When `capabilityId` and `runId` are supplied, the
 * panel also loads persisted receipts from the API and exposes a
 * Replay action per receipt — the flight recorder / time-travel
 * debugging surface.
 */
export const PromptReceiptPanel = ({
  selectedRunEvents,
  capabilityId,
  runId,
}: Props) => {
  const receipts = React.useMemo(
    () =>
      selectedRunEvents
        .filter(event => event.type === 'PROMPT_RECEIPT')
        .map(event => ({
          event,
          details: (event.details ?? {}) as PromptReceiptDetails,
        }))
        // Newest first.
        .sort((a, b) => (a.event.timestamp < b.event.timestamp ? 1 : -1)),
    [selectedRunEvents],
  );

  // Persisted receipts for the replay surface. Fetched lazily from
  // the API when capabilityId + runId are both present.
  const [persistedReceipts, setPersistedReceipts] = React.useState<
    PersistedPromptReceipt[]
  >([]);
  const [isLoadingPersisted, setIsLoadingPersisted] =
    React.useState<boolean>(false);
  const [persistedError, setPersistedError] = React.useState<string | null>(
    null,
  );
  const [activeReplayReceipt, setActiveReplayReceipt] =
    React.useState<PersistedPromptReceipt | null>(null);

  const loadPersisted = React.useCallback(async () => {
    if (!capabilityId || !runId) return;
    setIsLoadingPersisted(true);
    setPersistedError(null);
    try {
      const rows = await fetchPromptReceiptsForRun(capabilityId, runId);
      // Newest first so the just-captured decision is on top.
      setPersistedReceipts(
        [...rows].sort((a, b) =>
          a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
        ),
      );
    } catch (err) {
      setPersistedError(
        err instanceof Error ? err.message : 'Failed to load receipts.',
      );
    } finally {
      setIsLoadingPersisted(false);
    }
  }, [capabilityId, runId]);

  React.useEffect(() => {
    if (!capabilityId || !runId) {
      setPersistedReceipts([]);
      return;
    }
    void loadPersisted();
    // Refetch when a new PROMPT_RECEIPT event arrives during this
    // run — keeps the replay list fresh without polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilityId, runId, receipts.length]);

  return (
    <>
      <SectionCard
        title="Prompt receipts"
        description="Which context fragments the main model saw on each decision, and what the budgeter had to evict."
        icon={Info}
        action={
          capabilityId && runId ? (
            <button
              type="button"
              onClick={() => void loadPersisted()}
              disabled={isLoadingPersisted}
              className="workspace-list-action flex items-center gap-1.5 text-xs"
              aria-label="Refresh replayable receipts"
            >
              {isLoadingPersisted ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RotateCcw size={12} />
              )}
              Refresh
            </button>
          ) : undefined
        }
      >
        {/* Replay surface — only when we have the run context to hit the API. */}
        {capabilityId && runId ? (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="workspace-meta-label">
                Replayable decisions ({persistedReceipts.length})
              </p>
              {persistedError ? (
                <StatusBadge tone="warning">Load error</StatusBadge>
              ) : null}
            </div>
            {persistedError ? (
              <p className="text-xs text-rose-700">{persistedError}</p>
            ) : persistedReceipts.length === 0 ? (
              <p className="text-xs text-secondary">
                {isLoadingPersisted
                  ? 'Loading replayable receipts…'
                  : 'No persisted receipts yet. They appear here after the engine records a main-model call.'}
              </p>
            ) : (
              <div className="space-y-2">
                {persistedReceipts.map(receipt => (
                  <ReplayableReceiptCard
                    key={receipt.id}
                    receipt={receipt}
                    onReplay={setActiveReplayReceipt}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {receipts.length === 0 ? (
          <EmptyState
            title="No prompt receipts yet"
            description="Receipts appear here once the execution engine makes its first main-model call for this run."
          />
        ) : (
          <div className="space-y-3">
            {receipts.map(({ event, details }) => (
              <ReceiptCard key={event.id} event={event} details={details} />
            ))}
          </div>
        )}
      </SectionCard>

      {capabilityId && activeReplayReceipt ? (
        <PromptReceiptReplayModal
          capabilityId={capabilityId}
          receipt={activeReplayReceipt}
          onClose={() => setActiveReplayReceipt(null)}
        />
      ) : null}
    </>
  );
};

export default PromptReceiptPanel;
