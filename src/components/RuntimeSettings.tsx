import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';

type ProviderStatus = {
  key: string;
  label: string;
  configured: boolean;
  transportMode: string;
};

type RuntimeConfig = {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  label?: string;
};

type LoadError = { kind: 'network' } | { kind: 'api'; text: string };

const inputCls =
  'mt-1 w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-surface text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-secondary/50';

const labelCls = 'block text-sm font-medium text-on-surface';

const hintCls = 'mt-1 text-xs text-secondary';

export const RuntimeSettings = () => {
  const [defaultProvider, setDefaultProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<Record<string, RuntimeConfig>>({});
  const [availableProviders, setAvailableProviders] = useState<ProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/runtime-settings');
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setLoadError({ kind: 'api', text: body.error ?? `HTTP ${res.status}` });
        return;
      }
      const data = await res.json() as {
        success: boolean;
        defaultProvider: string | null;
        providers: Record<string, RuntimeConfig>;
        availableProviders: ProviderStatus[];
      };
      if (data.success) {
        setDefaultProvider(data.defaultProvider);
        setProviders(data.providers ?? {});
        setAvailableProviders(data.availableProviders ?? []);
        setSelectedProvider(prev =>
          prev && data.availableProviders.some(p => p.key === prev)
            ? prev
            : data.availableProviders[0]?.key ?? null,
        );
      }
    } catch {
      setLoadError({ kind: 'network' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const handleSaveProvider = async (providerKey: string) => {
    const config = providers[providerKey] ?? {};
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/runtime-settings/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerKey, config, setDefault: defaultProvider === providerKey }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        setMessage({ type: 'success', text: `Saved ${config.label || providerKey}` });
        // Re-check configured badge
        void loadSettings();
        setTimeout(() => setMessage(null), 3500);
      } else {
        setMessage({ type: 'error', text: data.error ?? 'Failed to save' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: `Network error — is the server running?` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetDefault = async (providerKey: string) => {
    setMessage(null);
    try {
      const res = await fetch('/api/runtime-settings/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerKey }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        setDefaultProvider(providerKey);
        setMessage({ type: 'success', text: `Default provider set to ${providerKey}` });
        setTimeout(() => setMessage(null), 3500);
      } else {
        setMessage({ type: 'error', text: data.error ?? 'Failed to set default' });
      }
    } catch {
      setMessage({ type: 'error', text: `Network error — is the server running?` });
    }
  };

  const updateProviderField = (providerKey: string, field: keyof RuntimeConfig, value: string) => {
    setProviders(prev => ({
      ...prev,
      [providerKey]: { ...prev[providerKey], [field]: value || undefined },
    }));
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-16 text-secondary">
        <Loader2 size={28} className="animate-spin" />
        <p className="text-sm">Loading runtime settings…</p>
      </div>
    );
  }

  // ── Load error ─────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-4 p-12 max-w-lg mx-auto text-center">
        <AlertCircle size={36} className="text-error" />
        <div>
          <p className="font-semibold text-on-surface">Could not reach the settings API</p>
          {loadError.kind === 'network' ? (
            <p className="mt-1 text-sm text-secondary">
              The backend server is not responding on{' '}
              <code className="rounded bg-surface-container px-1 py-0.5 text-xs">
                /api/runtime-settings
              </code>
              . Make sure the server is running (
              <code className="rounded bg-surface-container px-1 py-0.5 text-xs">npm run dev</code>
              ) and refresh.
            </p>
          ) : (
            <p className="mt-1 text-sm text-secondary">{loadError.text}</p>
          )}
        </div>
        <button
          onClick={() => void loadSettings()}
          className="flex items-center gap-2 rounded-lg border border-outline-variant/40 bg-surface-container px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container-high"
        >
          <RefreshCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  // ── Main UI ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <SlidersHorizontal size={22} className="text-primary shrink-0" />
        <div>
          <h1 className="text-xl font-bold text-on-surface">Runtime Provider Settings</h1>
          <p className="mt-0.5 text-sm text-secondary">
            Configure LLM API providers. Settings are saved to{' '}
            <code className="rounded bg-surface-container px-1 py-0.5 text-xs">.llm-providers.local.json</code>{' '}
            and take effect immediately — no restart needed.
          </p>
        </div>
      </div>

      {/* Toast */}
      {message && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-900'
              : 'border-red-200 bg-red-50 text-red-900',
          )}
        >
          {message.type === 'success'
            ? <Check size={16} className="mt-0.5 shrink-0" />
            : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Provider tabs */}
      <div className="flex flex-wrap gap-1 border-b border-outline-variant/25 pb-0">
        {availableProviders.map(provider => (
          <button
            key={provider.key}
            onClick={() => setSelectedProvider(provider.key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              selectedProvider === provider.key
                ? 'border-primary text-primary'
                : 'border-transparent text-secondary hover:text-on-surface',
            )}
          >
            {provider.label}
            {provider.configured && (
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white text-[9px] font-bold">
                ✓
              </span>
            )}
            {defaultProvider === provider.key && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                default
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Config form */}
      {selectedProvider ? (
        <div className="rounded-2xl border border-outline-variant/25 bg-surface-container-low p-6 space-y-5">

          {/* ── Custom Router / OpenRouter ──────────────────────────────── */}
          {selectedProvider === 'custom-router' && (
            <>
              <div>
                <label className={labelCls}>Display Label</label>
                <input
                  type="text"
                  placeholder="e.g., OpenRouter"
                  value={providers[selectedProvider]?.label ?? ''}
                  onChange={e => updateProviderField(selectedProvider, 'label', e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>Friendly name shown in the UI.</p>
              </div>

              <div>
                <label className={labelCls}>Base URL</label>
                <input
                  type="url"
                  placeholder="https://openrouter.ai/api/v1"
                  value={providers[selectedProvider]?.baseUrl ?? ''}
                  onChange={e => updateProviderField(selectedProvider, 'baseUrl', e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>
                  OpenRouter →{' '}
                  <code className="rounded bg-surface-container px-1 text-xs">https://openrouter.ai/api/v1</code>
                  {'  ·  LiteLLM → '}
                  <code className="rounded bg-surface-container px-1 text-xs">http://localhost:8000</code>
                </p>
              </div>

              <div>
                <label className={labelCls}>API Key</label>
                <input
                  type="password"
                  placeholder="sk-or-…"
                  value={providers[selectedProvider]?.apiKey ?? ''}
                  onChange={e => updateProviderField(selectedProvider, 'apiKey', e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>
                  Get your key at{' '}
                  <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    openrouter.ai/keys
                  </a>
                </p>
              </div>

              <div>
                <label className={labelCls}>Default Model</label>
                <input
                  type="text"
                  placeholder="openai/gpt-4o  or  anthropic/claude-3-opus"
                  value={providers[selectedProvider]?.defaultModel ?? ''}
                  onChange={e => updateProviderField(selectedProvider, 'defaultModel', e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>
                  Used when an agent has no preferred model. Browse{' '}
                  <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    openrouter.ai/models
                  </a>{' '}
                  for IDs. Free tier:{' '}
                  <code className="rounded bg-surface-container px-1 text-xs">openrouter/free</code>
                </p>
              </div>
            </>
          )}

          {/* ── Google Gemini ──────────────────────────────────────────── */}
          {selectedProvider === 'gemini' && (
            <>
              <div>
                <label className={labelCls}>API Key</label>
                <input
                  type="password"
                  placeholder="AIza…"
                  value={providers[selectedProvider]?.apiKey ?? ''}
                  onChange={e => updateProviderField(selectedProvider, 'apiKey', e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>
                  Get a free key at{' '}
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                    Google AI Studio
                  </a>
                </p>
              </div>

              <div>
                <label className={labelCls}>Default Model</label>
                <input
                  type="text"
                  placeholder="gemini-2.0-flash"
                  value={providers[selectedProvider]?.defaultModel ?? ''}
                  onChange={e => updateProviderField(selectedProvider, 'defaultModel', e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>
                  Leave blank to use <code className="rounded bg-surface-container px-1 text-xs">gemini-2.0-flash</code>.
                  Must start with <code className="rounded bg-surface-container px-1 text-xs">gemini-</code>.
                </p>
              </div>

              <div>
                <label className={labelCls}>Base URL (optional override)</label>
                <input
                  type="url"
                  placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
                  value={providers[selectedProvider]?.baseUrl ?? ''}
                  onChange={e => updateProviderField(selectedProvider, 'baseUrl', e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>Leave blank unless you are using a Vertex AI proxy.</p>
              </div>
            </>
          )}

          {/* ── Local OpenAI-Compatible ────────────────────────────────── */}
          {selectedProvider === 'local-openai' && (
            <>
              <div>
                <label className={labelCls}>Base URL</label>
                <input
                  type="url"
                  placeholder="http://localhost:11434/v1"
                  value={providers[selectedProvider]?.baseUrl ?? ''}
                  onChange={e => updateProviderField(selectedProvider, 'baseUrl', e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>
                  Ollama →{' '}
                  <code className="rounded bg-surface-container px-1 text-xs">http://localhost:11434/v1</code>
                  {'  ·  LM Studio → '}
                  <code className="rounded bg-surface-container px-1 text-xs">http://localhost:1234/v1</code>
                </p>
              </div>

              <div>
                <label className={labelCls}>API Key <span className="font-normal text-secondary">(optional)</span></label>
                <input
                  type="password"
                  placeholder="leave blank for Ollama / LM Studio"
                  value={providers[selectedProvider]?.apiKey ?? ''}
                  onChange={e => updateProviderField(selectedProvider, 'apiKey', e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Default Model</label>
                <input
                  type="text"
                  placeholder="llama3  or  mistral  or  phi3"
                  value={providers[selectedProvider]?.defaultModel ?? ''}
                  onChange={e => updateProviderField(selectedProvider, 'defaultModel', e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>
                  Must match a model you have pulled locally (e.g.{' '}
                  <code className="rounded bg-surface-container px-1 text-xs">ollama pull llama3</code>).
                </p>
              </div>
            </>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2 border-t border-outline-variant/20">
            <button
              onClick={() => void handleSaveProvider(selectedProvider)}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving
                ? <Loader2 size={14} className="animate-spin" />
                : <Check size={14} />}
              Save
            </button>

            <button
              onClick={() => void handleSetDefault(selectedProvider)}
              disabled={isSaving || defaultProvider === selectedProvider}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-5 py-2 text-sm font-medium transition-colors disabled:opacity-50',
                defaultProvider === selectedProvider
                  ? 'border-green-300 bg-green-50 text-green-800 cursor-default'
                  : 'border-outline-variant/40 bg-surface-container text-on-surface hover:bg-surface-container-high',
              )}
            >
              {defaultProvider === selectedProvider ? '✓ Default provider' : 'Set as default'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-secondary">No providers available.</p>
      )}
    </div>
  );
};

export default RuntimeSettings;
