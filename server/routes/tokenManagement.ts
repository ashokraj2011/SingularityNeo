import type express from 'express';
import type { ProviderKey, TokenManagementPolicy } from '../../src/types';
import { assertCapabilityPermission, getAuthorizedAppState } from '../access';
import { sendApiError } from '../api/errors';
import { parseActorContext } from '../requestActor';
import { getCapabilityBundle, updateCapabilityRecord } from '../repository';
import {
  buildTokenManagementCapabilitySnapshot,
  buildTokenManagementSummary,
  estimatePromptForTokenManagement,
  listTokenManagementRecommendations,
  listTokenOptimizationReceipts,
  recommendModelForTurn,
  sanitizeTokenManagementPolicy,
} from '../tokenManagement';

const parseLimit = (value: unknown, fallback = 50) => {
  const numeric = Number(value || fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(250, Math.floor(numeric)));
};

export const registerTokenManagementRoutes = (app: express.Express) => {
  app.get('/api/token-management/summary', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const authorizedState = await getAuthorizedAppState(actor);
      response.json(
        await buildTokenManagementSummary(
          authorizedState.capabilities.map(capability => capability.id),
        ),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/token-management/capabilities/:capabilityId', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
      response.json(
        await buildTokenManagementCapabilitySnapshot(request.params.capabilityId),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put('/api/token-management/capabilities/:capabilityId/policy', async (request, response) => {
    try {
      const capabilityId = request.params.capabilityId;
      await assertCapabilityPermission({
        capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.edit',
      });
      const bundle = await getCapabilityBundle(capabilityId);
      const tokenManagement = sanitizeTokenManagementPolicy(
        bundle.capability,
        (request.body?.policy || request.body || {}) as Partial<TokenManagementPolicy>,
      );
      await updateCapabilityRecord(capabilityId, {
        executionConfig: {
          ...bundle.capability.executionConfig,
          tokenManagement,
        },
      });
      response.json(await buildTokenManagementCapabilitySnapshot(capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/token-management/recommend-model', async (request, response) => {
    try {
      const capabilityId = String(request.body?.capabilityId || '').trim();
      if (!capabilityId) {
        response.status(400).json({ error: 'capabilityId is required.' });
        return;
      }
      await assertCapabilityPermission({
        capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
      const { capability } = await getCapabilityBundle(capabilityId);
      response.json(
        recommendModelForTurn({
          capability,
          selectedProviderKey:
            typeof request.body?.selectedProviderKey === 'string'
              ? (request.body.selectedProviderKey as ProviderKey)
              : null,
          selectedModel:
            typeof request.body?.selectedModel === 'string'
              ? request.body.selectedModel
              : null,
          phase:
            typeof request.body?.phase === 'string' ? request.body.phase : null,
          toolId:
            typeof request.body?.toolId === 'string' ? request.body.toolId : null,
          intent:
            typeof request.body?.intent === 'string' ? request.body.intent : null,
          writeMode: Boolean(request.body?.writeMode),
          requiresApproval: Boolean(request.body?.requiresApproval),
          governanceState:
            typeof request.body?.governanceState === 'string'
              ? request.body.governanceState
              : null,
          complexityTier: request.body?.complexityTier,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/token-management/estimate-prompt', async (request, response) => {
    try {
      const capabilityId = String(request.body?.capabilityId || '').trim();
      let capability = null;
      if (capabilityId) {
        await assertCapabilityPermission({
          capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'telemetry.read',
        });
        capability = (await getCapabilityBundle(capabilityId)).capability;
      }
      response.json(
        estimatePromptForTokenManagement({
          capability,
          prompt: String(request.body?.prompt || ''),
          providerKey:
            typeof request.body?.providerKey === 'string'
              ? (request.body.providerKey as ProviderKey)
              : null,
          model:
            typeof request.body?.model === 'string' ? request.body.model : null,
          kind:
            request.body?.kind === 'code' || request.body?.kind === 'json'
              ? request.body.kind
              : 'prose',
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/token-management/receipts', async (request, response) => {
    try {
      const capabilityId = String(request.query.capabilityId || '').trim();
      if (capabilityId) {
        await assertCapabilityPermission({
          capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'telemetry.read',
        });
      }
      response.json(
        await listTokenOptimizationReceipts({
          capabilityId: capabilityId || undefined,
          limit: parseLimit(request.query.limit),
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/token-management/recommendations', async (request, response) => {
    try {
      const capabilityId = String(request.query.capabilityId || '').trim();
      if (capabilityId) {
        await assertCapabilityPermission({
          capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'telemetry.read',
        });
      }
      response.json(
        await listTokenManagementRecommendations(capabilityId || undefined),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
