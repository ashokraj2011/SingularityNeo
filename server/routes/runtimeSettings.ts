import type express from 'express';
import type { ProviderKey } from '../../src/types';
import {
  readLLMProviderConfigState,
  saveLLMProviderConfig,
  setDefaultLLMProviderKey,
  type LLMProviderConfig,
} from '../llmProviderConfig';
import { isGeminiConfigured } from '../geminiProvider';
import { isCustomRouterConfigured } from '../customRouterProvider';
import { isLocalOpenAIConfigured } from '../localOpenAIProvider';
import { sendApiError } from '../api/errors';

/** The three LLM API providers exposed via the Settings UI. */
const LLM_PROVIDER_DEFINITIONS = [
  {
    key: 'custom-router' as ProviderKey,
    label: 'Custom Router (OpenRouter, LiteLLM, …)',
    transportMode: 'http',
    isConfigured: () => isCustomRouterConfigured(),
  },
  {
    key: 'gemini' as ProviderKey,
    label: 'Google Gemini',
    transportMode: 'http',
    isConfigured: () => isGeminiConfigured(),
  },
  {
    key: 'local-openai' as ProviderKey,
    label: 'Local OpenAI-Compatible',
    transportMode: 'http',
    isConfigured: () => isLocalOpenAIConfigured(),
  },
];

export const registerRuntimeSettingsRoutes = (app: express.Express) => {
  /**
   * GET /api/runtime-settings
   * Returns saved LLM provider configs + live "configured" status for each.
   */
  app.get('/api/runtime-settings', async (req: express.Request, res: express.Response) => {
    try {
      const configState = await readLLMProviderConfigState();

      const availableProviders = LLM_PROVIDER_DEFINITIONS.map(def => ({
        key: def.key,
        label: def.label,
        configured: def.isConfigured(),
        transportMode: def.transportMode,
      }));

      res.json({
        success: true,
        defaultProvider: configState.defaultProviderKey ?? null,
        providers: configState.providers ?? {},
        availableProviders,
      });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  /**
   * POST /api/runtime-settings/provider
   * Saves a single provider's LLM config.
   *
   * Body: { providerKey: string, config: LLMProviderConfig, setDefault?: boolean }
   */
  app.post('/api/runtime-settings/provider', async (req: express.Request, res: express.Response) => {
    try {
      const { providerKey, config, setDefault } = req.body as {
        providerKey: string;
        config: Record<string, string | undefined>;
        setDefault?: boolean;
      };

      if (!providerKey || typeof providerKey !== 'string') {
        return res.status(400).json({ success: false, error: 'providerKey is required' });
      }

      const cleanConfig: LLMProviderConfig = {};
      if (config?.apiKey)        cleanConfig.apiKey        = String(config.apiKey).trim();
      if (config?.baseUrl)       cleanConfig.baseUrl       = String(config.baseUrl).trim();
      if (config?.defaultModel)  cleanConfig.defaultModel  = String(config.defaultModel).trim();
      if (config?.label)         cleanConfig.label         = String(config.label).trim();

      await saveLLMProviderConfig({
        providerKey: providerKey as ProviderKey,
        config: cleanConfig,
        setDefault: Boolean(setDefault),
      });

      res.json({ success: true });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  /**
   * POST /api/runtime-settings/default
   * Sets the default LLM provider.
   *
   * Body: { providerKey: string }
   */
  app.post('/api/runtime-settings/default', async (req: express.Request, res: express.Response) => {
    try {
      const { providerKey } = req.body as { providerKey: string };

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
