import os from 'node:os';
import type express from 'express';
import {
  clearPersistedRuntimeToken,
  persistRuntimeTokenAndValidate,
  resolveRuntimeEnvLocalPath,
} from '../runtimeCredentials';
import { sendApiError } from '../api/errors';
import { buildRuntimeStatus } from '../runtimeStatus';
import {
  applyPreferencesToEnv,
  deriveDesktopId,
  getDesktopPreferences,
  patchDesktopPreferences,
} from '../desktopPreferences';
import type { ProviderKey, RuntimeProviderConfig } from '../../src/types';
import {
  getConfiguredRuntimeProviderStatus,
  getRuntimeProviderModels,
  listRuntimeProviderStatuses,
  saveConfiguredRuntimeProvider,
  selectDefaultRuntimeProvider,
  validateRuntimeProviderStatus,
} from '../runtimeProviders';
import { probeRuntimeProvider } from '../runtimeProbe';

type RuntimeCredentialBody = {
  token?: string;
};

type RuntimeProviderConfigBody = {
  config?: RuntimeProviderConfig;
  setDefault?: boolean;
  clearDefault?: boolean;
  endpointHint?: string;
  commandHint?: string;
  modelHint?: string;
};

export const registerRuntimeRoutes = (app: express.Express) => {
  const envLocalPath = resolveRuntimeEnvLocalPath();

  app.get('/api/runtime/status', async (_request, response) => {
    response.json(await buildRuntimeStatus());
  });

  app.get('/api/runtime/preflight', async (_request, response) => {
    try {
      const status = await buildRuntimeStatus();
      response.json({
        generatedAt: new Date().toISOString(),
        readinessState: status.readinessState,
        checks: status.checks,
        databaseRuntime: status.databaseRuntime,
        activeDatabaseProfileId: status.activeDatabaseProfileId,
        activeDatabaseProfileLabel: status.activeDatabaseProfileLabel,
        controlPlaneUrl: status.controlPlaneUrl,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/runtime/credentials', async (request, response) => {
    try {
      const body = request.body as RuntimeCredentialBody;
      const token = String(body.token || '').trim();
      if (!token) {
        response.status(400).json({
          error: 'A GitHub token is required.',
        });
        return;
      }

      await persistRuntimeTokenAndValidate({
        token,
        envFilePath: envLocalPath,
      });
      response.json(await buildRuntimeStatus());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete('/api/runtime/credentials', async (_request, response) => {
    try {
      await clearPersistedRuntimeToken({
        envFilePath: envLocalPath,
      });
      response.json(await buildRuntimeStatus());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/runtime/providers', async (_request, response) => {
    try {
      response.json({
        providers: await listRuntimeProviderStatuses(),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/runtime/providers/:providerKey/status', async (request, response) => {
    try {
      const providerKey = String(request.params.providerKey || '').trim() as ProviderKey;
      response.json(await getConfiguredRuntimeProviderStatus(providerKey));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put('/api/runtime/providers/:providerKey/config', async (request, response) => {
    try {
      const providerKey = String(request.params.providerKey || '').trim() as ProviderKey;
      const body = (request.body || {}) as RuntimeProviderConfigBody;
      const savedStatus = await saveConfiguredRuntimeProvider({
        providerKey,
        config: body.config || {},
        setDefault: body.setDefault,
      });

      if (body.clearDefault) {
        await selectDefaultRuntimeProvider({ providerKey: undefined });
      }

      response.json({
        provider: savedStatus,
        providers: await listRuntimeProviderStatuses(),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/runtime/providers/:providerKey/validate', async (request, response) => {
    try {
      const providerKey = String(request.params.providerKey || '').trim() as ProviderKey;
      const body = (request.body || {}) as RuntimeProviderConfigBody;
      response.json(
        await validateRuntimeProviderStatus({
          providerKey,
          config: body.config || undefined,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/runtime/providers/:providerKey/probe', async (request, response) => {
    try {
      const providerKey = String(request.params.providerKey || '').trim() as ProviderKey;
      const body = (request.body || {}) as RuntimeProviderConfigBody;
      response.json(
        await probeRuntimeProvider({
          providerKey,
          endpointHint: body.endpointHint,
          commandHint: body.commandHint,
          modelHint: body.modelHint,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/runtime/providers/:providerKey/models', async (request, response) => {
    try {
      const providerKey = String(request.params.providerKey || '').trim() as ProviderKey;
      response.json({
        models: await getRuntimeProviderModels(providerKey),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  // ── Desktop preferences ──────────────────────────────────────────────────

  /**
   * GET /api/runtime/desktop-preferences
   *
   * Returns the stored preferences for the desktop identified by the
   * `x-desktop-hostname` header (or falls back to the server's own hostname).
   * Creates a minimal row on first access.
   */
  app.get('/api/runtime/desktop-preferences', async (request, response) => {
    try {
      const hostname = String(request.headers['x-desktop-hostname'] || '').trim();
      const desktopId = deriveDesktopId(hostname || undefined);
      const prefs = await getDesktopPreferences(desktopId);
      response.json(prefs ?? { id: desktopId, hostname: hostname || os.hostname(), createdAt: null, updatedAt: null });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  /**
   * PUT /api/runtime/desktop-preferences
   *
   * Saves non-secret preferences for this desktop and immediately applies
   * them to the server process environment.
   *
   * Body: { hostname, workingDirectory?, copilotCliUrl?, allowHttpFallback?,
   *         embeddingBaseUrl?, embeddingModel?, runtimePort?, executorId? }
   *
   * Security tokens are never accepted here — they continue to be saved via
   * POST /api/runtime/credentials.
   */
  app.put('/api/runtime/desktop-preferences', async (request, response) => {
    try {
      const hostname = String(request.body?.hostname || '').trim();
      const desktopId = deriveDesktopId(hostname || undefined);

      const patch = {
        workingDirectory: request.body?.workingDirectory !== undefined
          ? String(request.body.workingDirectory || '').trim() || undefined
          : undefined,
        copilotCliUrl: request.body?.copilotCliUrl !== undefined
          ? String(request.body.copilotCliUrl || '').trim() || undefined
          : undefined,
        allowHttpFallback: request.body?.allowHttpFallback !== undefined
          ? Boolean(request.body.allowHttpFallback)
          : undefined,
        embeddingBaseUrl: request.body?.embeddingBaseUrl !== undefined
          ? String(request.body.embeddingBaseUrl || '').trim() || undefined
          : undefined,
        embeddingModel: request.body?.embeddingModel !== undefined
          ? String(request.body.embeddingModel || '').trim() || undefined
          : undefined,
        runtimePort: request.body?.runtimePort !== undefined
          ? (Number(request.body.runtimePort) > 0 ? Math.floor(Number(request.body.runtimePort)) : undefined)
          : undefined,
        executorId: request.body?.executorId !== undefined
          ? String(request.body.executorId || '').trim() || undefined
          : undefined,
      };

      const saved = await patchDesktopPreferences(desktopId, hostname, patch);

      // Apply immediately so the running server process picks them up.
      applyPreferencesToEnv(saved);

      response.json(saved);
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
