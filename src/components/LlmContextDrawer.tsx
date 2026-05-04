import { useMemo, useState } from "react";
import { Copy, Loader2, X } from "lucide-react";
import { cn } from "../lib/utils";
import type { LlmContextLogEntry } from "../types";

/**
 * "View context" drawer.
 *
 * Renders a single LLM context envelope — full system / user / history
 * messages plus the budget receipt — so operators can confirm exactly
 * what was sent to the model for any chat turn or workflow step.
 *
 * Sources two different shapes:
 *   - DB row (`LlmContextLogEntry`) for chat-mode replays
 *   - RunEvent.details for execution-mode prompts (LLM_CONTEXT_PREPARED)
 *
 * Both shapes share the messages + budgetReceipt fields so the drawer
 * accepts a single common subset.
 */

export interface LlmContextDrawerPayload {
  title?: string;
  subtitle?: string;
  provider?: string;
  model?: string;
  traceId?: string;
  createdAt?: string;
  messages: Array<{ role: string; content: string }>;
  budgetReceipt?: LlmContextLogEntry["budgetReceipt"];
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

type Props = {
  open: boolean;
  loading?: boolean;
  error?: string | null;
  payload: LlmContextDrawerPayload | null;
  onClose: () => void;
};

const formatNumber = (n?: number) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : "—";

const formatTokens = (n?: number) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toLocaleString()} tok` : "—";

const MessageBlock = ({
  index,
  role,
  content,
  defaultOpen,
}: {
  index: number;
  role: string;
  content: string;
  defaultOpen: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const charCount = content.length;
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-on-surface hover:bg-surface-container"
      >
        <span className="flex items-center gap-2">
          <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide text-primary">
            {role}
          </span>
          <span className="text-secondary">[{index + 1}]</span>
        </span>
        <span className="font-normal text-[0.65rem] text-outline">
          {charCount.toLocaleString()} chars · {open ? "click to hide" : "click to show"}
        </span>
      </button>
      {open && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words border-t border-outline-variant/30 bg-surface px-3 py-2 font-mono text-[0.7rem] leading-relaxed text-on-surface">
          {content || "(empty)"}
        </pre>
      )}
    </div>
  );
};

export const LlmContextDrawer = ({
  open,
  loading,
  error,
  payload,
  onClose,
}: Props) => {
  const [justCopied, setJustCopied] = useState(false);

  const rawJson = useMemo(() => {
    if (!payload) return "";
    return JSON.stringify(payload, null, 2);
  }, [payload]);

  if (!open) return null;

  const handleCopy = async () => {
    if (!rawJson) return;
    try {
      await navigator.clipboard.writeText(rawJson);
      setJustCopied(true);
      window.setTimeout(() => setJustCopied(false), 1500);
    } catch {
      // clipboard blocked — silently ignore
    }
  };

  const budgetReceipt = payload?.budgetReceipt;
  const totalEvictedTokens = (budgetReceipt?.evicted || []).reduce(
    (sum, f) => sum + (f.estimatedTokens || 0),
    0,
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-stretch justify-end">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-label="Close context drawer"
      />
      <aside className="relative flex h-full w-full max-w-3xl flex-col border-l border-outline-variant/30 bg-surface shadow-2xl">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/30 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-secondary">
              {payload?.title || "LLM context envelope"}
            </p>
            {payload?.subtitle && (
              <p className="mt-0.5 truncate text-sm font-medium text-on-surface">
                {payload.subtitle}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.65rem] text-outline">
              {payload?.provider && (
                <span className="rounded bg-surface-container-low px-1.5 py-0.5 font-mono">
                  {payload.provider}
                </span>
              )}
              {payload?.model && (
                <span className="rounded bg-surface-container-low px-1.5 py-0.5 font-mono">
                  {payload.model}
                </span>
              )}
              {payload?.traceId && (
                <span
                  className="truncate rounded bg-surface-container-low px-1.5 py-0.5 font-mono"
                  title={payload.traceId}
                >
                  trace: {payload.traceId.slice(-12)}
                </span>
              )}
              {payload?.createdAt && (
                <span>{new Date(payload.createdAt).toLocaleString()}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!rawJson}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2.5 py-1.5 text-[0.7rem] font-semibold text-secondary hover:bg-surface-container",
                !rawJson && "cursor-not-allowed opacity-50",
              )}
            >
              <Copy size={12} />
              {justCopied ? "Copied" : "Copy raw JSON"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-1.5 text-secondary hover:text-primary"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-secondary">
              <Loader2 size={14} className="animate-spin" /> Loading context…
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-700/40 dark:bg-rose-950/30 dark:text-rose-300">
              {error}
            </div>
          )}
          {!loading && !error && payload && (
            <div className="space-y-4">
              {/* Token totals + usage strip */}
              {(budgetReceipt || payload.promptTokens != null) && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2">
                    <p className="text-[0.6rem] uppercase tracking-wider text-secondary">
                      Estimated input
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-on-surface">
                      {formatTokens(budgetReceipt?.totalEstimatedTokens)}
                    </p>
                    {budgetReceipt?.maxInputTokens && (
                      <p className="text-[0.62rem] text-outline">
                        / {formatNumber(budgetReceipt.maxInputTokens)} max
                      </p>
                    )}
                  </div>
                  <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2">
                    <p className="text-[0.6rem] uppercase tracking-wider text-secondary">
                      Actual prompt
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-on-surface">
                      {formatTokens(payload.promptTokens)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2">
                    <p className="text-[0.6rem] uppercase tracking-wider text-secondary">
                      Completion
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-on-surface">
                      {formatTokens(payload.completionTokens)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2">
                    <p className="text-[0.6rem] uppercase tracking-wider text-secondary">
                      Cost
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-on-surface">
                      {payload.costUsd != null
                        ? `$${payload.costUsd.toFixed(4)}`
                        : "—"}
                    </p>
                  </div>
                </div>
              )}

              {/* Messages — collapsible per role */}
              <section>
                <h3 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-secondary">
                  Messages sent to model ({payload.messages.length})
                </h3>
                <div className="space-y-2">
                  {payload.messages.map((m, i) => (
                    <MessageBlock
                      key={`${m.role}-${i}`}
                      index={i}
                      role={m.role}
                      content={m.content}
                      // System messages can be huge — keep first one open
                      // by default; rest collapsed for scannability.
                      defaultOpen={i === 0}
                    />
                  ))}
                </div>
              </section>

              {/* Budget receipt table */}
              {budgetReceipt && (
                <section>
                  <h3 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-secondary">
                    Budget receipt
                    {totalEvictedTokens > 0 && (
                      <span className="ml-2 font-normal text-rose-700 dark:text-rose-400">
                        ({budgetReceipt.evicted?.length ?? 0} fragments evicted, ~
                        {formatTokens(totalEvictedTokens)} dropped)
                      </span>
                    )}
                  </h3>
                  <div className="overflow-hidden rounded-lg border border-outline-variant/30">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-surface-container-low">
                        <tr>
                          <th className="px-3 py-1.5 font-semibold text-secondary">
                            source
                          </th>
                          <th className="px-3 py-1.5 text-right font-semibold text-secondary">
                            tokens
                          </th>
                          <th className="px-3 py-1.5 font-semibold text-secondary">
                            action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/20">
                        {(budgetReceipt.included || []).map((f, i) => (
                          <tr key={`inc-${i}-${f.source}`}>
                            <td className="px-3 py-1.5 font-mono text-[0.7rem] text-on-surface">
                              {f.source}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-[0.7rem] text-on-surface">
                              {formatNumber(f.estimatedTokens)}
                            </td>
                            <td className="px-3 py-1.5 text-emerald-700 dark:text-emerald-400">
                              included
                            </td>
                          </tr>
                        ))}
                        {(budgetReceipt.evicted || []).map((f, i) => (
                          <tr
                            key={`ev-${i}-${f.source}`}
                            className="bg-rose-50/40 dark:bg-rose-950/10"
                          >
                            <td className="px-3 py-1.5 font-mono text-[0.7rem] text-on-surface">
                              {f.source}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-[0.7rem] text-on-surface">
                              {formatNumber(f.estimatedTokens)}
                            </td>
                            <td className="px-3 py-1.5 text-rose-700 dark:text-rose-400">
                              evicted{f.reason ? ` · ${f.reason}` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

export default LlmContextDrawer;
