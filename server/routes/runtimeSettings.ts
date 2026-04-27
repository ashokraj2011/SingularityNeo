import type express from 'express';
import type { ProviderKey } from '../../src/types';
import {
  readLLMProviderConfigState,
  saveLLMProviderConfig,
  setDefaultLLMProviderKey,
  type LLMProviderConfig,
} from '../llmProviderConfig';
import { listRuntimeProviderStatuses } from '../runtimeProviders';
import { sendApiError } from '../api/errors';

/**
 * GET /api/runtime-settings
 * Returns the current runtime provider configuration and available providers.
 */
export const registerRuntimeSettingsRoutes = (app: express.Express) => {
  app.get('/api/runtime-settings', async (req: express.Request, res: express.Response) => {
    try {
      const configState = await readLLMProviderConfigState();
      const providerStatuses = await listRuntimeProviderStatuses();

      res.json({
        success: true,
        defaultProvider: configState.defaultProviderKey,
        providers: configState.providers || {},
        availableProviders: providerStatuses.map(s => ({
          key: s.key,
          label: s.label,
          configured: s.configured,
          transportMode: s.transportMode,
        })),
      });
    } catch (error) {
      sendApiError(res, error);
    }
  });

  /**
   * POST /api/runtime-settings/provider
   * Saves a runtime provider configuration.
   *
   * Body: {
   *   providerKey: string,
   *   config: RuntimeProviderConfig,
   *   setDefault?: boolean
   * }
   */
  app.post('/api/runtime-settings/provider', async (req: express.Request, res: express.Response) => {
    try {
      const { providerKey, config, setDefault } = req.body;

      if (!providerKey || typeof providerKey !== 'string') {
        return res
          .status(400)
          .json({ success: false, error: 'providerKey is required' });
      }

      // Filter out undefined values from config
      const cleanConfig: LLMProviderConfig = {};
      if (config.apiKey)
        cleanConfig.apiKey = String(config.apiKey).trim();
      if (config.baseUrl)
        cleanConfig.baseUrl = String(config.baseUrl).trim();
      if (config.defaultModel)
        cleanConfig.defaultModel = String(config.defaultModel).trim();
      if (config.label) cleanConfig.label = String(config.label).trim();

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
   * Sets the default runtime provider.
   *
   * Body: { providerKey: string }
   */
  app.post('/api/runtime-settings/default', async (req: express.Request, res: express.Response) => {
    try {
      const { providerKey } = req.body;

      if (!providerKey || typeof providerKey !== 'string') {
        return res
          .status(400)
          .json({ success: false, error: 'providerKey is required' });
      }

      await setDefaultLLMProviderKey({ providerKey: providerKey as ProviderKey });
      res.json({ success: true });
    } catch (error) {
      sendApiError(res, error);
    }
  });
};
