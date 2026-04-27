import type express from 'express';
import type { ProviderKey } from '../../src/types';
import {
  readLLMProviderConfigState,
  saveLLMProviderConfig,
  setDefaultLLMProviderKey,
  getLLMProviderConfig,
  type LLMProviderConfig,
} from '../llmProviderConfig';
import { sendApiError } from '../api/errors';

/**
 * The three LLM API providers surfaced by the Settings UI.
 * Deliberately avoids importing from geminiProvider / customRouterProvider /
 * localOpenAIProvider so that no CLI-validation code runs at import time.
 */
const LLM_PROVIDER_DEFINITIONS: Array<{
  key: ProviderKey;
  label: string;
  transportMode: string;
}> = [
  { key: 'custom-router', label: 'Custom Router (OpenRouter, LiteLLM, …)', transportMode: 'http' },
  { key: 'gemini',        label: 'Google Gemini',                           transportMode: 'http' },
  { key: 'local-openai',  label: 'Local OpenAI-Compatible',                 transportMode: 'http' },
];

/**
 * A provider is "configured" if either:
 *   - it has an apiKey or baseUrl in the saved .llm-providers.local.json, OR
 *   - the matching environment variable is set.
 */
const isProviderConfigured = (key: ProviderKey): boolean => {
  const saved = getLLMProviderConfig(key);
  if (saved?.apiKey || saved?.baseUrl) return true;

  if (key === 'gemini') {
    return Boolean(
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    );
  }
  if (key === 'custom-router') {
    return Boolean(process.env.CUSTOM_ROUTER_BASE_URL);
  }
  if (key === 'local-openai') {
    return Boolean(
      process.env.LOCAL_OPENAI_BASE_URL ||
      process.env.OPENAI_COMPAT_BASE_URL,
    );
  }
  return false;
};

export const registerRuntimeSettingsRoutes = (app: express.Express) => {
  /**
   * GET /api/runtime-settings
   */
  app.get('/api/runtime-settings', async (_req, res) => {
    try {
      const configState = await readLLMProviderConfigState();

      res.json({
        success: true,
        defaultProvider: configState.defaultProviderKey ?? null,
        providers: configState.providers ?? {},
        availableProviders: LLM_PROVIDER_DEFINITIONS.map(def => ({
          key:           def.key,
          label:         def.label,
          configured:    isProviderConfigured(def.key),
          transportMode: def.transportMode,
        })),
      });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  /**
   * POST /api/runtime-settings/provider
   * Body: { providerKey, config, setDefault? }
   */
  app.post('/api/runtime-settings/provider', async (req, res) => {
    try {
      const { providerKey, config = {}, setDefault } = req.body as {
        providerKey?: string;
        config?: Record<string, string | undefined>;
        setDefault?: boolean;
      };

      if (!providerKey || typeof providerKey !== 'string') {
        return res.status(400).json({ success: false, error: 'providerKey is required' });
      }

      const cleanConfig: LLMProviderConfig = {};
      if (config.apiKey)       cleanConfig.apiKey       = String(config.apiKey).trim();
      if (config.baseUrl)      cleanConfig.baseUrl      = String(config.baseUrl).trim();
      if (config.defaultModel) cleanConfig.defaultModel = String(config.defaultModel).trim();
      if (config.label)        cleanConfig.label        = String(config.label).trim();

      await saveLLMProviderConfig({
        providerKey: providerKey as ProviderKey,
        config:      cleanConfig,
        setDefault:  Boolean(setDefault),
      });

      res.json({ success: true });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  /**
   * POST /api/runtime-settings/default
   * Body: { providerKey }
   */
  app.post('/api/runtime-settings/default', async (req, res) => {
    try {
      const { providerKey } = req.body as { providerKey?: string };

      if (!providerKey || typeof providerKey !== 'string') {
        return res.status(400).json({ success: false, error: 'providerKey is required' });
      }

      await setDefaultLLMProviderKey({ providerKey: providerKey as ProviderKey });
      res.json({ success: true });
    } catch (error) {
      sendApiError(res, error);
    }
  });
};
