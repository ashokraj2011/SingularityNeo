import React from 'react';
import { AlertTriangle, KeyRound, RefreshCw } from 'lucide-react';
import type { RuntimeStatus } from '../../lib/api';
import { SectionCard, StatusBadge } from '../EnterpriseUI';

const runtimeAccessLabel = (runtimeStatus?: RuntimeStatus | null) =>
  runtimeStatus?.runtimeAccessMode === 'copilot-session'
    ? 'Copilot session'
    : runtimeStatus?.runtimeAccessMode === 'headless-cli'
    ? 'Headless CLI'
    : runtimeStatus?.runtimeAccessMode === 'http-fallback'
    ? 'HTTP fallback'
    : 'Unconfigured';

const runtimeTokenSourceLabel = (runtimeStatus?: RuntimeStatus | null) =>
  runtimeStatus?.tokenSource === 'headless-cli'
    ? 'COPILOT_CLI_URL'
    : runtimeStatus?.tokenSource === 'runtime-override'
    ? 'UI override'
    : runtimeStatus?.tokenSource === 'GITHUB_MODELS_TOKEN'
    ? 'GITHUB_MODELS_TOKEN'
    : runtimeStatus?.tokenSource === 'GITHUB_TOKEN'
    ? 'GITHUB_TOKEN'
    : 'No credential';

type DesktopRuntimeSettingsCardProps = {
  runtimeStatus: RuntimeStatus | null;
  runtimeStatusError: string;
  runtimeTokenInput: string;
  isUpdatingRuntime: boolean;
  embeddingBaseUrlInput: string;
  embeddingApiKeyInput: string;
  embeddingModelInput: string;
  isUpdatingEmbeddings: boolean;
  onRuntimeTokenInputChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onClear: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onEmbeddingBaseUrlInputChange: (value: string) => void;
  onEmbeddingApiKeyInputChange: (value: string) => void;
  onEmbeddingModelInputChange: (value: string) => void;
  onSaveEmbeddings: () => void | Promise<void>;
  onClearEmbeddings: () => void | Promise<void>;
};

export default function DesktopRuntimeSettingsCard({
  runtimeStatus,
  runtimeStatusError,
  runtimeTokenInput,
  isUpdatingRuntime,
  embeddingBaseUrlInput,
  embeddingApiKeyInput,
  embeddingModelInput,
  isUpdatingEmbeddings,
  onRuntimeTokenInputChange,
  onSave,
  onClear,
  onRefresh,
  onEmbeddingBaseUrlInputChange,
  onEmbeddingApiKeyInputChange,
  onEmbeddingModelInputChange,
  onSaveEmbeddings,
  onClearEmbeddings,
}: DesktopRuntimeSettingsCardProps) {
  const pgvectorAvailable = Boolean(runtimeStatus?.databaseRuntime?.pgvectorAvailable);
  const retrievalMode =
    runtimeStatus?.retrievalMode || runtimeStatus?.databaseRuntime?.retrievalMode || 'unknown';
  return (
    <SectionCard
      title="Desktop execution runtime"
      description="This desktop owns the execution runtime settings. Save a runtime key here to validate it live and store it in .env.local for this machine."
      icon={KeyRound}
      tone="brand"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={runtimeStatus?.configured ? 'success' : 'warning'}>
            {runtimeStatus?.configured ? 'Configured' : 'Not configured'}
          </StatusBadge>
          <StatusBadge
            tone={runtimeStatus?.runtimeAccessMode !== 'unconfigured' ? 'success' : 'warning'}
          >
            {runtimeAccessLabel(runtimeStatus)}
          </StatusBadge>
          <StatusBadge tone="info">{runtimeTokenSourceLabel(runtimeStatus)}</StatusBadge>
          <StatusBadge tone="brand">{runtimeStatus?.provider || 'Unknown provider'}</StatusBadge>
        </div>

        <div className="rounded-2xl bg-surface-container-low p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
              <KeyRound size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                {runtimeStatus?.providerKey === 'github-copilot'
                  ? 'Active GitHub identity'
                  : 'Resolved provider identity'}
              </p>
              <p className="mt-2 text-sm font-bold text-on-surface">
                {runtimeStatus?.githubIdentity?.login
                  ? `@${runtimeStatus.githubIdentity.login}`
                  : 'Identity unavailable'}
              </p>
              <p className="mt-1 text-sm text-secondary">
                {runtimeStatus?.githubIdentity?.name ||
                  runtimeStatus?.githubIdentityError ||
                  runtimeStatusError ||
                  'The runtime has not resolved a GitHub identity yet.'}
              </p>
              {runtimeStatus?.githubIdentity?.profileUrl ? (
                <a
                  href={runtimeStatus.githubIdentity.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex text-xs font-bold uppercase tracking-[0.18em] text-primary transition-colors hover:text-primary/80"
                >
                  Open GitHub profile
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-surface-container-low p-4">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
              Primary provider
            </p>
            <p className="mt-2 text-sm font-bold text-on-surface">
              {runtimeStatus?.provider || 'Not resolved'}
            </p>
          </div>
          <div className="rounded-2xl bg-surface-container-low p-4">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
              Default model
            </p>
            <p className="mt-2 text-sm font-bold text-on-surface">
              {runtimeStatus?.defaultModel || 'Not resolved'}
            </p>
          </div>
          <div className="rounded-2xl bg-surface-container-low p-4 sm:col-span-2">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
              Model catalog
            </p>
            <p className="mt-2 text-sm font-bold text-on-surface">
              {runtimeStatus?.modelCatalogSource === 'runtime'
                ? 'Live runtime catalog'
                : 'Fallback catalog'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              {(runtimeStatus?.availableProviders || []).length > 0
                ? `${runtimeStatus.availableProviders
                    .map(provider =>
                      provider.configured
                        ? `${provider.label} ready`
                        : `${provider.label} available`,
                    )
                    .join(' • ')}`
                : 'Provider abstraction is enabled through the runtime lane, even when only one provider is configured in this environment.'}
            </p>
          </div>
        </div>

        {(runtimeStatusError || runtimeStatus?.githubIdentityError) ? (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>{runtimeStatusError || runtimeStatus?.githubIdentityError}</p>
          </div>
        ) : null}

        <label className="block space-y-2">
          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
            Runtime key
          </span>
          <input
            type="password"
            value={runtimeTokenInput}
            onChange={event => onRuntimeTokenInputChange(event.target.value)}
            placeholder="Paste a GitHub Models or provider token for this desktop runtime"
            className="field-input"
          />
          <p className="text-xs text-secondary">
            Saved into this desktop&apos;s `.env.local` only after live validation succeeds.
          </p>
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={isUpdatingRuntime || !runtimeTokenInput.trim()}
            className="enterprise-button enterprise-button-brand-muted disabled:opacity-50"
          >
            {isUpdatingRuntime ? 'Saving key' : 'Save desktop runtime key'}
          </button>
          <button
            type="button"
            onClick={() => void onClear()}
            disabled={isUpdatingRuntime}
            className="enterprise-button enterprise-button-secondary disabled:opacity-50"
          >
            Clear desktop key
          </button>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={isUpdatingRuntime}
            className="inline-flex items-center gap-2 rounded-2xl border border-outline-variant/15 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-secondary transition-all hover:bg-surface-container-low disabled:opacity-50"
          >
            <RefreshCw size={14} />
            Refresh status
          </button>
        </div>

        <div className="rounded-3xl border border-outline-variant/30 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={runtimeStatus?.embeddingConfigured ? 'success' : 'warning'}>
              {runtimeStatus?.embeddingConfigured ? 'Embeddings configured' : 'Embeddings not configured'}
            </StatusBadge>
            <StatusBadge tone={pgvectorAvailable ? 'success' : 'warning'}>
              {pgvectorAvailable ? 'pgvector available' : 'pgvector unavailable'}
            </StatusBadge>
            <StatusBadge tone="info">{retrievalMode}</StatusBadge>
          </div>
          <p className="mt-3 text-sm text-secondary">
            {pgvectorAvailable
              ? 'With a local embedding endpoint configured, memory retrieval will use pgvector in this database.'
              : 'With a local embedding endpoint configured, memory retrieval will fall back to JSON cosine because pgvector is not available in this database.'}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-secondary">
            If you do not configure a local embedding endpoint, SingularityNeo falls back to the built-in deterministic-hash retrieval path. JSON cosine is used only when embeddings are configured but pgvector is unavailable.
          </p>
          {runtimeStatus?.fallbackReason ? (
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              Current memory fallback: {runtimeStatus.fallbackReason}
            </p>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block space-y-2 md:col-span-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                Local embedding base URL
              </span>
              <input
                type="text"
                value={embeddingBaseUrlInput}
                onChange={event => onEmbeddingBaseUrlInputChange(event.target.value)}
                placeholder="http://127.0.0.1:11434/v1"
                className="field-input"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                API key
              </span>
              <input
                type="password"
                value={embeddingApiKeyInput}
                onChange={event => onEmbeddingApiKeyInputChange(event.target.value)}
                placeholder="local"
                className="field-input"
              />
              {runtimeStatus?.embeddingApiKeyConfigured ? (
                <p className="text-xs text-secondary">
                  An embedding API key is already stored for this desktop. Saving with this field blank will remove it.
                </p>
              ) : null}
            </label>
            <label className="block space-y-2">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                Embedding model
              </span>
              <input
                type="text"
                value={embeddingModelInput}
                onChange={event => onEmbeddingModelInputChange(event.target.value)}
                placeholder="nomic-embed-text"
                className="field-input"
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-secondary">
            Saved into this desktop&apos;s `.env.local`. If a separate backend process is already running, restart it after changing local embedding settings so server-side memory refresh picks them up.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onSaveEmbeddings()}
              disabled={isUpdatingEmbeddings || !embeddingBaseUrlInput.trim()}
              className="enterprise-button enterprise-button-brand-muted disabled:opacity-50"
            >
              {isUpdatingEmbeddings ? 'Saving embeddings' : 'Save embedding settings'}
            </button>
            <button
              type="button"
              onClick={() => void onClearEmbeddings()}
              disabled={isUpdatingEmbeddings}
              className="enterprise-button enterprise-button-secondary disabled:opacity-50"
            >
              Clear embedding settings
            </button>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
