/**
 * PromptReceiptReplayModal — time-travel debugging UI.
 *
 * Given a persisted prompt receipt, lets an operator re-invoke the
 * provider with an optional model override and renders the original
 * decision alongside the replay output for side-by-side inspection.
 *
 * On-brand with the evidence / flight-recorder story: the prompt
 * receipt is the flight recorder; this modal is the replay bench.
 */
import React from 'react';
import { Loader2, Play, X } from 'lucide-react';
import {
  PersistedPromptReceipt,
  PromptReceiptReplayResponse,
  replayPromptReceipt,
} from '../../lib/api';
import { ModalShell, StatusBadge } from '../EnterpriseUI';

type Props = {
  capabilityId: string;
  receipt: PersistedPromptReceipt;
  onClose: () => void;
};

/**
 * Provider-aware suggestions for the "try a different model" picker.
 * Derived from the models we actually route to in `githubModels.ts`.
 * Operators can also type in a custom model id (provider permitting).
 */
const MODEL_SUGGESTIONS_BY_PROVIDER: Record<string, string[]> = {
  'github-copilot': [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'o1-mini',
    'claude-sonnet-4',
    'claude-haiku-4',
  ],
  'local-openai': ['gpt-oss-20b', 'llama-3-8b-instruct'],
};

const formatNumber = (value: unknown): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return String(value);
};

const formatElapsed = (ms: number): string => {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
};

const readUsageField = (
  usage: Record<string, unknown> | null | undefined,
  key: string,
): string => {
  if (!usage) return '—';
  const value = usage[key];
  return formatNumber(value);
};

export const PromptReceiptReplayModal = ({
  capabilityId,
  receipt,
  onClose,
}: Props) => {
  const providerSuggestions =
    MODEL_SUGGESTIONS_BY_PROVIDER[receipt.providerKey ?? ''] ??
    MODEL_SUGGESTIONS_BY_PROVIDER['github-copilot'];

  const [selectedModel, setSelectedModel] = React.useState<string>(
    receipt.model ?? providerSuggestions[0] ?? '',
  );
  const [customModel, setCustomModel] = React.useState<string>('');
  const [isReplaying, setIsReplaying] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [replayResult, setReplayResult] =
    React.useState<PromptReceiptReplayResponse | null>(null);

  const effectiveModel = customModel.trim() || selectedModel;

  const handleReplay = React.useCallback(async () => {
    setIsReplaying(true);
    setError(null);
    setReplayResult(null);
    try {
      const result = await replayPromptReceipt(capabilityId, receipt.id, {
        // If the operator picks the original model, let the server
        // decide — omit the override so the agent's default applies.
        model:
          effectiveModel && effectiveModel !== receipt.model
            ? effectiveModel
            : undefined,
      });
      setReplayResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Replay failed.');
    } finally {
      setIsReplaying(false);
    }
  }, [capabilityId, effectiveModel, receipt.id, receipt.model]);

  return (
    <div className="desktop-content-modal-overlay px-4 py-16">
      <button
        type="button"
        aria-label="Close replay"
        onClick={onClose}
        className="desktop-content-modal-backdrop"
      />
      <ModalShell
        title="Replay this decision"
        description="Re-invoke the provider with the exact context the model originally saw. Compare outputs side-by-side to audit the decision or evaluate an alternate model."
        eyebrow="Time-Travel Debugging"
        className="relative z-[1] max-w-[78rem]"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">
              {receipt.phase ? `${receipt.phase} phase` : 'Decision'}
            </StatusBadge>
            <button
              type="button"
              onClick={onClose}
              className="workspace-list-action"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        }
      >
        {/* Controls */}
        <div className="workspace-meta-card mb-4 space-y-3">
          <p className="workspace-meta-label">Replay configuration</p>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div>
              <label className="mb-1 block text-xs font-semibold text-secondary">
                Model preset
              </label>
              <select
                value={selectedModel}
                onChange={e => {
                  setSelectedModel(e.target.value);
                  setCustomModel('');
                }}
                className="workspace-input w-full"
                disabled={isReplaying}
              >
                {receipt.model && !providerSuggestions.includes(receipt.model) ? (
                  <option value={receipt.model}>
                    {receipt.model} (original)
                  </option>
                ) : null}
                {providerSuggestions.map(model => (
                  <option key={model} value={model}>
                    {model}
                    {model === receipt.model ? ' (original)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-secondary">
                Or custom model id
              </label>
              <input
                type="text"
                value={customModel}
                onChange={e => setCustomModel(e.target.value)}
                placeholder="e.g. gpt-4.1-mini"
                className="workspace-input w-full"
                disabled={isReplaying}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void handleReplay()}
                disabled={isReplaying || !effectiveModel}
                className="workspace-list-action workspace-list-action-primary flex items-center gap-2"
              >
                {isReplaying ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}
                {isReplaying ? 'Replaying…' : 'Run replay'}
              </button>
            </div>
          </div>
          <p className="text-xs text-secondary">
            Replay rebuilds the agent's system prompt from the captured
            snapshot and re-invokes the provider with the exact same
            user prompt, memory context, and developer prompt. No side
            effects — the original step is untouched.
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            {error}
          </div>
        ) : null}

        {/* Side-by-side panels */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Original */}
          <div className="workspace-meta-card space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="workspace-meta-label">Original decision</p>
                <p className="text-xs text-secondary">
                  {receipt.model || 'unknown model'} ·{' '}
                  {new Date(receipt.createdAt).toLocaleString()}
                </p>
              </div>
              <StatusBadge tone="neutral">Captured</StatusBadge>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-secondary">
              <span>
                Prompt:{' '}
                <span className="font-mono">
                  {readUsageField(receipt.responseUsage, 'prompt')}
                </span>
              </span>
              <span>
                Completion:{' '}
                <span className="font-mono">
                  {readUsageField(receipt.responseUsage, 'completion')}
                </span>
              </span>
              <span>
                Total:{' '}
                <span className="font-mono">
                  {readUsageField(receipt.responseUsage, 'total')}
                </span>
              </span>
            </div>
            <pre className="max-h-[55vh] overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
              {receipt.responseContent || '(empty response)'}
            </pre>
          </div>

          {/* Replay */}
          <div className="workspace-meta-card space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="workspace-meta-label">Replay</p>
                <p className="text-xs text-secondary">
                  {replayResult?.replay.model ??
                    effectiveModel ??
                    'waiting for run…'}
                  {replayResult
                    ? ` · ${formatElapsed(replayResult.replay.elapsedMs)}`
                    : ''}
                </p>
              </div>
              {replayResult ? (
                <StatusBadge
                  tone={
                    replayResult.replay.content === receipt.responseContent
                      ? 'success'
                      : 'warning'
                  }
                >
                  {replayResult.replay.content === receipt.responseContent
                    ? 'Identical'
                    : 'Diverged'}
                </StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Pending</StatusBadge>
              )}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-secondary">
              <span>
                Prompt:{' '}
                <span className="font-mono">
                  {readUsageField(replayResult?.replay.usage, 'prompt')}
                </span>
              </span>
              <span>
                Completion:{' '}
                <span className="font-mono">
                  {readUsageField(replayResult?.replay.usage, 'completion')}
                </span>
              </span>
              <span>
                Total:{' '}
                <span className="font-mono">
                  {readUsageField(replayResult?.replay.usage, 'total')}
                </span>
              </span>
            </div>
            <pre className="max-h-[55vh] overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
              {replayResult
                ? replayResult.replay.content || '(empty replay response)'
                : isReplaying
                  ? 'Re-invoking provider with captured context…'
                  : 'Pick a model and click "Run replay" to compare.'}
            </pre>
          </div>
        </div>

        {/* Prompt / context shown to the model (collapsed by default) */}
        <details className="workspace-meta-card mt-4 text-xs">
          <summary className="cursor-pointer select-none font-semibold text-secondary">
            Captured context (what the model saw)
          </summary>
          <div className="mt-3 space-y-3">
            {receipt.developerPrompt ? (
              <div>
                <p className="workspace-meta-label">Developer prompt</p>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-slate-900 p-2 text-[0.7rem] text-slate-100">
                  {receipt.developerPrompt}
                </pre>
              </div>
            ) : null}
            {receipt.memoryPrompt ? (
              <div>
                <p className="workspace-meta-label">Memory prompt</p>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-slate-900 p-2 text-[0.7rem] text-slate-100">
                  {receipt.memoryPrompt}
                </pre>
              </div>
            ) : null}
            <div>
              <p className="workspace-meta-label">User prompt (budgeted)</p>
              <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-slate-900 p-2 text-[0.7rem] text-slate-100">
                {receipt.userPrompt}
              </pre>
            </div>
          </div>
        </details>
      </ModalShell>
    </div>
  );
};

export default PromptReceiptReplayModal;
