import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
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

export const RuntimeSettings = () => {
  const [defaultProvider, setDefaultProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<Record<string, RuntimeConfig>>({});
  const [availableProviders, setAvailableProviders] = useState<ProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/runtime-settings');
        const data = await res.json();
        if (data.success) {
          setDefaultProvider(data.defaultProvider);
          setProviders(data.providers);
          setAvailableProviders(data.availableProviders);
          // Auto-select first available provider
          if (data.availableProviders.length > 0) {
            setSelectedProvider(data.availableProviders[0].key);
          }
        }
      } catch (error) {
        setMessage({ type: 'error', text: `Failed to load settings: ${error}` });
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleSaveProvider = async (providerKey: string) => {
    const config = providers[providerKey] || {};

    setIsSaving(true);
    try {
      const res = await fetch('/api/runtime-settings/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerKey,
          config,
          setDefault: defaultProvider === providerKey,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `Saved ${config.label || providerKey}` });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error: ${error}` });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetDefault = async (providerKey: string) => {
    try {
      const res = await fetch('/api/runtime-settings/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerKey }),
      });

      const data = await res.json();
      if (data.success) {
        setDefaultProvider(providerKey);
        setMessage({ type: 'success', text: `Set default to ${providerKey}` });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to set default' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Error: ${error}` });
    }
  };

  const updateProviderField = (providerKey: string, field: keyof RuntimeConfig, value: string) => {
    setProviders(prev => ({
      ...prev,
      [providerKey]: {
        ...prev[providerKey],
        [field]: value || undefined,
      },
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Runtime Provider Settings</h1>
        <p className="mt-2 text-sm text-secondary">
          Configure LLM providers for your runtime. Changes take effect immediately.
        </p>
      </div>

      {message && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-lg p-4',
            message.type === 'success'
              ? 'bg-green-50 text-green-900 border border-green-200'
              : 'bg-red-50 text-red-900 border border-red-200',
          )}
        >
          {message.type === 'success' ? (
            <Check size={18} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
          )}
          <p>{message.text}</p>
        </div>
      )}

      {/* Provider tabs */}
      <div className="flex flex-wrap gap-2 border-b border-outline-variant/25">
        {availableProviders.map(provider => (
          <button
            key={provider.key}
            onClick={() => setSelectedProvider(provider.key)}
            className={cn(
              'px-4 py-3 font-medium text-sm transition-colors border-b-2 -mb-[2px]',
              selectedProvider === provider.key
                ? 'border-primary text-primary'
                : 'border-transparent text-secondary hover:text-on-surface',
            )}
          >
            {provider.label}
            {provider.configured && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">✓</span>}
          </button>
        ))}
      </div>

      {/* Provider config form */}
      {selectedProvider && (
        <div className="space-y-4 bg-surface-container-low rounded-2xl p-6">
          {selectedProvider === 'custom-router' && (
            <>
              <div>
                <label className="block text-sm font-medium text-on-surface">Label</label>
                <input
                  type="text"
                  placeholder="e.g., OpenRouter"
                  value={providers[selectedProvider]?.label || ''}
                  onChange={e => updateProviderField(selectedProvider, 'label', e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-white text-on-surface"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface">Base URL</label>
                <input
                  type="url"
                  placeholder="https://openrouter.ai/api/v1"
                  value={providers[selectedProvider]?.baseUrl || ''}
                  onChange={e => updateProviderField(selectedProvider, 'baseUrl', e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-white text-on-surface"
                />
                <p className="mt-1 text-xs text-secondary">
                  For OpenRouter: <code className="bg-white px-1 py-0.5 rounded">https://openrouter.ai/api/v1</code>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface">API Key</label>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={providers[selectedProvider]?.apiKey || ''}
                  onChange={e => updateProviderField(selectedProvider, 'apiKey', e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-white text-on-surface"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface">Default Model</label>
                <input
                  type="text"
                  placeholder="e.g., openai/gpt-4-turbo"
                  value={providers[selectedProvider]?.defaultModel || ''}
                  onChange={e => updateProviderField(selectedProvider, 'defaultModel', e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-white text-on-surface"
                />
                <p className="mt-1 text-xs text-secondary">
                  OpenRouter model ID. See{' '}
                  <a
                    href="https://openrouter.ai/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    available models
                  </a>
                </p>
              </div>
            </>
          )}

          {selectedProvider === 'gemini' && (
            <>
              <div>
                <label className="block text-sm font-medium text-on-surface">API Key</label>
                <input
                  type="password"
                  placeholder="AIza..."
                  value={providers[selectedProvider]?.apiKey || ''}
                  onChange={e => updateProviderField(selectedProvider, 'apiKey', e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-white text-on-surface"
                />
                <p className="mt-1 text-xs text-secondary">
                  Get a key from{' '}
                  <a
                    href="https://ai.google.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    Google AI Studio
                  </a>
                </p>
              </div>
            </>
          )}

          {selectedProvider === 'local-openai' && (
            <>
              <div>
                <label className="block text-sm font-medium text-on-surface">Base URL</label>
                <input
                  type="url"
                  placeholder="http://localhost:8000/v1"
                  value={providers[selectedProvider]?.baseUrl || ''}
                  onChange={e => updateProviderField(selectedProvider, 'baseUrl', e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-white text-on-surface"
                />
                <p className="mt-1 text-xs text-secondary">
                  URL of your local server (Ollama, LM Studio, vLLM, etc.)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface">API Key (optional)</label>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={providers[selectedProvider]?.apiKey || ''}
                  onChange={e => updateProviderField(selectedProvider, 'apiKey', e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-white text-on-surface"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-on-surface">Default Model</label>
                <input
                  type="text"
                  placeholder="e.g., llama2"
                  value={providers[selectedProvider]?.defaultModel || ''}
                  onChange={e => updateProviderField(selectedProvider, 'defaultModel', e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-white text-on-surface"
                />
              </div>
            </>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-4">
            <button
              onClick={() => handleSaveProvider(selectedProvider)}
              disabled={isSaving}
              className="flex-1 px-4 py-2 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="inline animate-spin mr-2" size={16} /> : 'Save Config'}
            </button>

            <button
              onClick={() => handleSetDefault(selectedProvider)}
              disabled={isSaving}
              className={cn(
                'flex-1 px-4 py-2 rounded-lg font-medium transition-colors',
                defaultProvider === selectedProvider
                  ? 'bg-green-100 text-green-700 border border-green-300'
                  : 'bg-surface-container text-on-surface border border-outline-variant/30 hover:bg-surface-container-high',
              )}
            >
              {defaultProvider === selectedProvider ? '✓ Default' : 'Set as Default'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RuntimeSettings;
