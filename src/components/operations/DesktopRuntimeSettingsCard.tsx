import React from 'react';
import { AlertTriangle, Check, Globe, KeyRound, RefreshCw, TerminalSquare } from 'lucide-react';
import type {
  ProviderKey,
  RuntimeProviderStatus,
} from '../../types';
import type { LLMProviderConfig, LLMProviderEntry, RuntimeStatus } from '../../lib/api';
import { SectionCard, StatusBadge } from '../EnterpriseUI';

const runtimeAccessLabel = (runtimeStatus?: RuntimeStatus | null) =>
  runtimeStatus?.runtimeAccessMode === 'sdk-session'
    ? 'SDK session'
    : runtimeStatus?.runtimeAccessMode === 'desktop-cli'
    ? 'Desktop CLI'
    : runtimeStatus?.runtimeAccessMode === 'http-api'
    ? 'HTTP API'
    : runtimeStatus?.runtimeAccessMode === 'local-openai'
    ? 'Local OpenAI-compatible'
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
    : 'No shared token';

type RuntimeProviderDraft = {
  command: string;
  model: string;
  profile: string;
  workingMode: string;
  enabled: boolean;
  envText: string;
  setDefault: boolean;
  /**
   * When true, this provider manages its own conversation history and prompt
   * cache (typical of CLI lanes).  Singularity then skips its own context
   * bundling and tool-history persistence.  Default depends on provider:
   * CLIs default ON, HTTP/SDK lanes default OFF (see providerRegistry).
   */
  selfManagesContext: boolean;
};

type DesktopRuntimeSettingsCardProps = {
  runtimeStatus: RuntimeStatus | null;
  runtimeStatusError: string;
  runtimeTokenInput: string;
  isUpdatingRuntime: boolean;
  runtimeProviders: RuntimeProviderStatus[];
  runtimeProviderDrafts: Record<string, RuntimeProviderDraft>;
  runtimeProviderBusyKey: string;
  defaultRuntimeProviderKey: ProviderKey;
  embeddingBaseUrlInput: string;
  embeddingApiKeyInput: string;
  embeddingModelInput: string;
  isUpdatingEmbeddings: boolean;
  // HTTP LLM providers (OpenRouter / Gemini / local-openai)
  httpProviderDrafts: Record<string, LLMProviderConfig>;
  httpProviderBusyKey: string;
  httpEffectiveDefault: string | null;
  httpAvailableProviders: LLMProviderEntry[];
  onRuntimeTokenInputChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onClear: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onDefaultRuntimeProviderChange: (providerKey: ProviderKey) => void;
  onSaveDefaultRuntimeProvider: () => void | Promise<void>;
  onProbeDefaultRuntimeProvider: () => void | Promise<void>;
  onUseRuntimeProviderNow: (providerKey: ProviderKey) => void | Promise<void>;
  onRuntimeProviderDraftChange: (
    providerKey: ProviderKey,
    patch: Partial<RuntimeProviderDraft>,
  ) => void;
  onSaveRuntimeProvider: (providerKey: ProviderKey) => void | Promise<void>;
  onValidateRuntimeProvider: (providerKey: ProviderKey) => void | Promise<void>;
  onEmbeddingBaseUrlInputChange: (value: string) => void;
  onEmbeddingApiKeyInputChange: (value: string) => void;
  onEmbeddingModelInputChange: (value: string) => void;
  onSaveEmbeddings: () => void | Promise<void>;
  onClearEmbeddings: () => void | Promise<void>;
  onHttpProviderDraftChange: (providerKey: string, patch: Partial<LLMProviderConfig>) => void;
  onSaveHttpProvider: (providerKey: string) => void | Promise<void>;
  onSetHttpProviderDefault: (providerKey: string) => void | Promise<void>;
};

const providerTone = (provider: RuntimeProviderStatus) =>
  provider.configured ? 'success' : provider.validation?.status === 'missing' ? 'warning' : 'neutral';

export default function DesktopRuntimeSettingsCard({
  runtimeStatus,
  runtimeStatusError,
  runtimeTokenInput,
  isUpdatingRuntime,
  runtimeProviders,
  runtimeProviderDrafts,
  runtimeProviderBusyKey,
  defaultRuntimeProviderKey,
  embeddingBaseUrlInput,
  embeddingApiKeyInput,
  embeddingModelInput,
  isUpdatingEmbeddings,
  httpProviderDrafts,
  httpProviderBusyKey,
  httpEffectiveDefault,
  httpAvailableProviders,
  onRuntimeTokenInputChange,
  onSave,
  onClear,
  onRefresh,
  onDefaultRuntimeProviderChange,
  onSaveDefaultRuntimeProvider,
  onProbeDefaultRuntimeProvider,
  onUseRuntimeProviderNow,
  onRuntimeProviderDraftChange,
  onSaveRuntimeProvider,
  onValidateRuntimeProvider,
  onEmbeddingBaseUrlInputChange,
  onEmbeddingApiKeyInputChange,
  onEmbeddingModelInputChange,
  onSaveEmbeddings,
  onClearEmbeddings,
  onHttpProviderDraftChange,
  onSaveHttpProvider,
  onSetHttpProviderDefault,
}: DesktopRuntimeSettingsCardProps) {
  const availableRuntimeProviders =
    runtimeProviders.length > 0
      ? runtimeProviders
      : runtimeStatus?.availableProviders || [];
  const resolvedDefaultRuntimeProviderKey =
    availableRuntimeProviders.find(provider => provider.key === defaultRuntimeProviderKey)?.key ||
    availableRuntimeProviders.find(provider => provider.defaultSelected)?.key ||
    availableRuntimeProviders.find(provider => provider.key === runtimeStatus?.providerKey)?.key ||
    availableRuntimeProviders[0]?.key ||
    defaultRuntimeProviderKey;
  const defaultProviderBusy =
    runtimeProviderBusyKey === `probe:${resolvedDefaultRuntimeProviderKey}` ||
    runtimeProviderBusyKey === `default:${resolvedDefaultRuntimeProviderKey}`;
  const selectedProvider =
    availableRuntimeProviders.find(provider => provider.defaultSelected) ||
    availableRuntimeProviders.find(provider => provider.key === runtimeStatus?.providerKey) ||
    availableRuntimeProviders.find(provider => provider.configured) ||
    null;
  const pgvectorAvailable = Boolean(runtimeStatus?.databaseRuntime?.pgvectorAvailable);
  const retrievalMode =
    runtimeStatus?.retrievalMode || runtimeStatus?.databaseRuntime?.retrievalMode || 'unknown';
  const cliProviders = availableRuntimeProviders.filter(
    provider =>
      provider.key === 'claude-code-cli' ||
      provider.key === 'codex-cli',
  );

  return (
    <SectionCard
      title="Runtime providers"
      description="This desktop owns the agent runtime configuration. Keep shared tokens in .env.local, keep CLI provider settings on this machine, and choose the default runtime that agents fall back to when they do not pin a provider."
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

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-surface-container-low p-4">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
              Selected provider
            </p>
            <p className="mt-2 text-sm font-bold text-on-surface">
              {selectedProvider?.label || runtimeStatus?.provider || 'Not resolved'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              {selectedProvider?.validation?.message ||
                runtimeStatus?.githubIdentityError ||
                runtimeStatusError ||
                'Choose a desktop runtime provider below and validate it before using it for agent chat or execution.'}
            </p>
          </div>
          <div className="rounded-2xl bg-surface-container-low p-4">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
              Default model
            </p>
            <p className="mt-2 text-sm font-bold text-on-surface">
              {runtimeStatus?.defaultModel || selectedProvider?.model || 'Not resolved'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-secondary">
              {availableRuntimeProviders.length > 0
                ? `${availableRuntimeProviders.filter(provider => provider.configured).length} configured runtime lane(s) across ${availableRuntimeProviders.length} available providers.`
                : 'No runtime providers have been discovered yet.'}
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-outline-variant/30 bg-white p-5">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
            Desktop default provider
          </p>
          <p className="mt-2 text-sm text-secondary">
            Agents without an explicit provider key will fall back to this desktop runtime. Changing it here takes effect for Event Horizon, chat, and execution the next time they resolve an unpinned runtime.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-secondary">
            Probe tries the common local endpoint or command for the selected provider, validates it, and applies the detected value here when it succeeds.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <select
              value={resolvedDefaultRuntimeProviderKey}
              onChange={event =>
                onDefaultRuntimeProviderChange(event.target.value as ProviderKey)
              }
              className="field-input min-w-[260px]"
            >
              {availableRuntimeProviders.length === 0 ? (
                <option value="">No runtime providers discovered yet</option>
              ) : null}
              {availableRuntimeProviders.map(provider => (
                <option key={provider.key} value={provider.key}>
                  {provider.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void onSaveDefaultRuntimeProvider()}
              disabled={!availableRuntimeProviders.length || !resolvedDefaultRuntimeProviderKey || defaultProviderBusy}
              className="enterprise-button enterprise-button-secondary disabled:opacity-50"
            >
              Save default provider
            </button>
            <button
              type="button"
              onClick={() => void onProbeDefaultRuntimeProvider()}
              disabled={!availableRuntimeProviders.length || !resolvedDefaultRuntimeProviderKey || defaultProviderBusy}
              className="enterprise-button enterprise-button-brand-muted disabled:opacity-50"
            >
              {runtimeProviderBusyKey === `probe:${resolvedDefaultRuntimeProviderKey}`
                ? 'Probing provider'
                : 'Probe selected provider'}
            </button>
          </div>
        </div>

        {(runtimeStatusError || runtimeStatus?.githubIdentityError) ? (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>{runtimeStatusError || runtimeStatus?.githubIdentityError}</p>
          </div>
        ) : null}

        <div className="rounded-3xl border border-outline-variant/30 bg-white p-5">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-primary" />
            <div>
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                Shared GitHub Models token
              </p>
              <p className="text-sm text-secondary">
                Keep Copilot and GitHub Models credentials local to this desktop. Claude Code CLI and Codex CLI use their own local login state instead.
              </p>
            </div>
          </div>

          <label className="mt-4 block space-y-2">
            <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
              Runtime key
            </span>
            <input
              type="password"
              value={runtimeTokenInput}
              onChange={event => onRuntimeTokenInputChange(event.target.value)}
              placeholder="Paste a GitHub Models token for the shared SDK / HTTP runtime"
              className="field-input"
            />
            <p className="text-xs text-secondary">
              Saved into this desktop&apos;s `.env.local` only after live validation succeeds.
            </p>
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={isUpdatingRuntime || !runtimeTokenInput.trim()}
              className="enterprise-button enterprise-button-brand-muted disabled:opacity-50"
            >
              {isUpdatingRuntime ? 'Saving key' : 'Save shared runtime key'}
            </button>
            <button
              type="button"
              onClick={() => void onClear()}
              disabled={isUpdatingRuntime}
              className="enterprise-button enterprise-button-secondary disabled:opacity-50"
            >
              Clear shared key
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
        </div>

        {/* ── HTTP / LLM API providers ─────────────────────────────────── */}
        {httpAvailableProviders.length > 0 && (
          <div className="rounded-3xl border border-outline-variant/30 bg-white p-5">
            <div className="flex items-center gap-2">
              <Globe size={18} className="text-primary" />
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                  LLM API providers
                </p>
                <p className="text-sm text-secondary">
                  OpenRouter, Google Gemini, and local Ollama / LM Studio — configure API keys, base URLs, and default models. Settings take effect immediately, no restart needed.
                </p>
              </div>
            </div>

            {httpEffectiveDefault && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                <Check size={13} className="text-primary shrink-0" />
                <span className="text-on-surface">
                  Active across the app:{' '}
                  <code className="rounded bg-surface-container px-1.5 py-0.5 font-semibold">
                    {httpAvailableProviders.find(p => p.key === httpEffectiveDefault)?.label ?? httpEffectiveDefault}
                  </code>
                  <span className="ml-1 text-secondary">— every chat and work item will use this unless an agent overrides it.</span>
                </span>
              </div>
            )}

            <div className="mt-4 grid gap-4 xl:grid-cols-3">
              {httpAvailableProviders.map(provider => {
                const draft = httpProviderDrafts[provider.key] ?? {};
                const busy = httpProviderBusyKey === provider.key || httpProviderBusyKey === `default:${provider.key}`;
                const isDefault = httpEffectiveDefault === provider.key;
                return (
                  <div
                    key={provider.key}
                    className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={provider.configured ? 'success' : 'warning'}>
                        {provider.configured ? 'Configured' : 'Not configured'}
                      </StatusBadge>
                      {isDefault && (
                        <StatusBadge tone="brand">Default</StatusBadge>
                      )}
                    </div>
                    <p className="text-sm font-bold text-on-surface">{provider.label}</p>

                    {/* Custom Router fields */}
                    {provider.key === 'custom-router' && (
                      <>
                        <label className="block space-y-1">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Display label</span>
                          <input
                            type="text"
                            value={draft.label ?? ''}
                            onChange={e => onHttpProviderDraftChange(provider.key, { label: e.target.value })}
                            placeholder="e.g. OpenRouter"
                            className="field-input"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Base URL</span>
                          <input
                            type="url"
                            value={draft.baseUrl ?? ''}
                            onChange={e => onHttpProviderDraftChange(provider.key, { baseUrl: e.target.value })}
                            placeholder="https://openrouter.ai/api/v1"
                            className="field-input font-mono text-[0.8rem]"
                          />
                          <p className="text-[0.7rem] text-amber-700 leading-tight">⚠ Do not include /chat/completions — appended automatically.</p>
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">API key</span>
                          <input
                            type="password"
                            value={draft.apiKey ?? ''}
                            onChange={e => onHttpProviderDraftChange(provider.key, { apiKey: e.target.value })}
                            placeholder="sk-or-…"
                            className="field-input"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Default model</span>
                          <input
                            type="text"
                            value={draft.defaultModel ?? ''}
                            onChange={e => onHttpProviderDraftChange(provider.key, { defaultModel: e.target.value })}
                            placeholder="openai/gpt-4o or openrouter/free"
                            className="field-input"
                          />
                        </label>
                      </>
                    )}

                    {/* Gemini fields */}
                    {provider.key === 'gemini' && (
                      <>
                        <label className="block space-y-1">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">API key</span>
                          <input
                            type="password"
                            value={draft.apiKey ?? ''}
                            onChange={e => onHttpProviderDraftChange(provider.key, { apiKey: e.target.value })}
                            placeholder="AIza…"
                            className="field-input"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Default model</span>
                          <input
                            type="text"
                            value={draft.defaultModel ?? ''}
                            onChange={e => onHttpProviderDraftChange(provider.key, { defaultModel: e.target.value })}
                            placeholder="gemini-2.0-flash"
                            className="field-input"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Base URL (optional)</span>
                          <input
                            type="url"
                            value={draft.baseUrl ?? ''}
                            onChange={e => onHttpProviderDraftChange(provider.key, { baseUrl: e.target.value })}
                            placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
                            className="field-input font-mono text-[0.8rem]"
                          />
                        </label>
                      </>
                    )}

                    {/* Local OpenAI-compatible fields */}
                    {provider.key === 'local-openai' && (
                      <>
                        <label className="block space-y-1">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Base URL</span>
                          <input
                            type="url"
                            value={draft.baseUrl ?? ''}
                            onChange={e => onHttpProviderDraftChange(provider.key, { baseUrl: e.target.value })}
                            placeholder="http://localhost:11434/v1"
                            className="field-input font-mono text-[0.8rem]"
                          />
                          <p className="text-[0.7rem] text-amber-700 leading-tight">⚠ Do not include /chat/completions — appended automatically.</p>
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">API key (optional)</span>
                          <input
                            type="password"
                            value={draft.apiKey ?? ''}
                            onChange={e => onHttpProviderDraftChange(provider.key, { apiKey: e.target.value })}
                            placeholder="leave blank for Ollama / LM Studio"
                            className="field-input"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Default model</span>
                          <input
                            type="text"
                            value={draft.defaultModel ?? ''}
                            onChange={e => onHttpProviderDraftChange(provider.key, { defaultModel: e.target.value })}
                            placeholder="llama3 or mistral"
                            className="field-input"
                          />
                        </label>
                      </>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void onSaveHttpProvider(provider.key)}
                        disabled={busy}
                        className="enterprise-button enterprise-button-brand-muted disabled:opacity-50"
                      >
                        {httpProviderBusyKey === provider.key ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void onSetHttpProviderDefault(provider.key)}
                        disabled={busy || isDefault}
                        className="enterprise-button enterprise-button-secondary disabled:opacity-50"
                      >
                        {isDefault ? '✓ Active default' : 'Set as default'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-outline-variant/30 bg-white p-5">
          <div className="flex items-center gap-2">
            <TerminalSquare size={18} className="text-primary" />
            <div>
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                Desktop CLI runtimes
              </p>
              <p className="text-sm text-secondary">
                These provider configs stay on this desktop. Use them to validate local Claude Code CLI or Codex CLI binaries, set a preferred model, and choose the default runtime for agents that do not specify a provider key.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {cliProviders.map(provider => {
              const draft = runtimeProviderDrafts[provider.key];
              const busy = runtimeProviderBusyKey === provider.key || runtimeProviderBusyKey === `${provider.key}:validate`;
              return (
                <div
                  key={provider.key}
                  className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={providerTone(provider)}>
                      {provider.configured ? 'Configured' : 'Not configured'}
                    </StatusBadge>
                    <StatusBadge tone={provider.defaultSelected ? 'brand' : 'info'}>
                      {provider.defaultSelected ? 'Default runtime' : provider.transportMode}
                    </StatusBadge>
                  </div>
                  <p className="mt-3 text-sm font-bold text-on-surface">{provider.label}</p>
                  <p className="mt-2 text-xs leading-relaxed text-secondary">
                    {provider.validation?.message ||
                      `Configure ${provider.label} for desktop-owned chat, planning, and swarm work.`}
                  </p>

                  <div className="mt-4 space-y-3">
                    <label className="block space-y-2">
                      <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                        Command
                      </span>
                      <input
                        type="text"
                        value={draft?.command || ''}
                        onChange={event =>
                          onRuntimeProviderDraftChange(provider.key, {
                            command: event.target.value,
                          })
                        }
                        placeholder={provider.key === 'codex-cli' ? 'codex' : 'claude'}
                        className="field-input font-mono text-[0.8rem]"
                      />
                    </label>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-2">
                        <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                          Model
                        </span>
                        <input
                          type="text"
                          value={draft?.model || ''}
                          onChange={event =>
                            onRuntimeProviderDraftChange(provider.key, {
                              model: event.target.value,
                            })
                          }
                          placeholder="Optional"
                          className="field-input"
                        />
                      </label>
                      <label className="block space-y-2">
                        <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                          Profile
                        </span>
                        <input
                          type="text"
                          value={draft?.profile || ''}
                          onChange={event =>
                            onRuntimeProviderDraftChange(provider.key, {
                              profile: event.target.value,
                            })
                          }
                          placeholder="Optional"
                          className="field-input"
                        />
                      </label>
                    </div>

                    <label className="block space-y-2">
                      <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                        Working mode
                      </span>
                      <select
                        value={draft?.workingMode || 'read-only'}
                        onChange={event =>
                          onRuntimeProviderDraftChange(provider.key, {
                            workingMode: event.target.value,
                          })
                        }
                        className="field-input"
                      >
                        <option value="plan">Plan only</option>
                        <option value="read-only">Read only</option>
                        <option value="workspace-write">Workspace write</option>
                        <option value="danger-full-access">Danger full access</option>
                      </select>
                    </label>

                    <label className="block space-y-2">
                      <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">
                        Environment overrides
                      </span>
                      <textarea
                        value={draft?.envText || ''}
                        onChange={event =>
                          onRuntimeProviderDraftChange(provider.key, {
                            envText: event.target.value,
                          })
                        }
                        placeholder={'KEY=value\nANOTHER_KEY=value'}
                        className="field-input min-h-[88px] font-mono text-[0.78rem]"
                      />
                    </label>

                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={Boolean(draft?.enabled)}
                        onChange={event =>
                          onRuntimeProviderDraftChange(provider.key, {
                            enabled: event.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-outline-variant accent-primary"
                      />
                      <span className="text-sm text-secondary">
                        Enable this provider on this desktop
                      </span>
                    </label>

                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={Boolean(draft?.selfManagesContext)}
                        onChange={event =>
                          onRuntimeProviderDraftChange(provider.key, {
                            selfManagesContext: event.target.checked,
                          })
                        }
                        className="mt-1 h-4 w-4 rounded border-outline-variant accent-primary"
                      />
                      <span className="text-sm text-secondary">
                        <span className="block font-medium text-on-surface">
                          Self-managed context
                        </span>
                        <span className="block text-[0.78rem] text-secondary/85">
                          Default ON for CLIs, OFF for HTTP/SDK providers. When
                          this provider manages its own conversation history and
                          prompt cache, leave this on so Singularity does not
                          double-bundle context. Disable to let Singularity
                          forward conversation history and reuse prompt fragments
                          itself.
                        </span>
                      </span>
                    </label>

                    <label className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={Boolean(draft?.setDefault)}
                        onChange={event =>
                          onRuntimeProviderDraftChange(provider.key, {
                            setDefault: event.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-outline-variant accent-primary"
                      />
                      <span className="text-sm text-secondary">
                        Use as the default provider for agents without an explicit provider key
                      </span>
                    </label>
                  </div>

                  {provider.validation?.details?.length ? (
                    <div className="mt-3 rounded-2xl bg-white px-3 py-2 text-xs text-secondary">
                      {provider.validation.details.join(' ')}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void onUseRuntimeProviderNow(provider.key)}
                      disabled={busy || !provider.configured || provider.defaultSelected}
                      className="enterprise-button enterprise-button-secondary disabled:opacity-50"
                    >
                      {provider.defaultSelected ? 'Active default' : 'Use now'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onSaveRuntimeProvider(provider.key)}
                      disabled={busy || !(draft?.command || '').trim()}
                      className="enterprise-button enterprise-button-brand-muted disabled:opacity-50"
                    >
                      {runtimeProviderBusyKey === provider.key ? 'Saving provider' : 'Save provider'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onValidateRuntimeProvider(provider.key)}
                      disabled={busy}
                      className="enterprise-button enterprise-button-secondary disabled:opacity-50"
                    >
                      {runtimeProviderBusyKey === `${provider.key}:validate`
                        ? 'Validating'
                        : 'Validate provider'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
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
