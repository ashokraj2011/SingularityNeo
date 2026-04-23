import type express from 'express';
import {
  clearRuntimeTokenOverride,
  setRuntimeTokenOverride,
} from '../githubModels';
import { sendApiError } from '../api/errors';
import { buildRuntimeStatus } from '../runtimeStatus';

type RuntimeCredentialBody = {
  token?: string;
};

export const registerRuntimeRoutes = (app: express.Express) => {
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

      await setRuntimeTokenOverride(token);
      response.json(await buildRuntimeStatus());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete('/api/runtime/credentials', async (_request, response) => {
    try {
      await clearRuntimeTokenOverride();
      response.json(await buildRuntimeStatus());
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
