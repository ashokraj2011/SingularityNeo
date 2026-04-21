import type express from 'express';
import { sendApiError } from '../api/errors';
import { assertWorkspacePermission } from '../access';
import { createBinding, getControl, getControlFrameworkSummary, listControls } from '../governance/controls';
import { decideException, getException, listExceptions, requestException, revokeException } from '../governance/exceptions';
import { getGovernancePostureSnapshot } from '../governance/posture';
import { listCoverageWindows, proveNoTouch } from '../governance/provenance';
import { describeSignerStatus } from '../governance/signer';
import { findMatchingActivePolicyException } from '../policy';
import { parseActorContext } from '../requestActor';

export const registerGovernanceRoutes = (app: express.Express) => {
  app.get('/api/governance/signer/status', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });
      response.json(describeSignerStatus());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/governance/controls', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });

      const { framework, severity, status, capabilityScope } = request.query as Record<
        string,
        string | undefined
      >;
      const [items, summary] = await Promise.all([
        listControls({
          framework: framework as any,
          severity: severity as any,
          status: status as any,
          capabilityScope: capabilityScope || undefined,
        }),
        getControlFrameworkSummary(),
      ]);
      response.json({ items, summary });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/governance/controls/:controlId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });

      const capabilityScope =
        typeof request.query.capabilityScope === 'string'
          ? request.query.capabilityScope
          : undefined;
      const control = await getControl(request.params.controlId, capabilityScope);
      if (!control) {
        response.status(404).json({ message: 'Control not found' });
        return;
      }
      response.json(control);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/governance/controls/:controlId/bindings', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'access.manage' });

      const body = (request.body ?? {}) as {
        policySelector?: Record<string, unknown>;
        bindingKind?: string;
        capabilityScope?: string | null;
      };
      const record = await createBinding({
        controlId: request.params.controlId,
        policySelector: body.policySelector ?? {},
        bindingKind: (body.bindingKind ?? '') as any,
        capabilityScope: body.capabilityScope ?? null,
        createdBy: actor?.userId ?? actor?.displayName ?? null,
      });
      response.status(201).json(record);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/governance/exceptions', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });

      const { capabilityId, controlId, status } = request.query as Record<
        string,
        string | string[] | undefined
      >;
      const statuses = Array.isArray(status)
        ? (status as string[])
        : typeof status === 'string' && status.trim()
          ? [status]
          : undefined;
      const result = await listExceptions({
        capabilityId: typeof capabilityId === 'string' ? capabilityId : undefined,
        controlId: typeof controlId === 'string' ? controlId : undefined,
        status: statuses as any,
      });
      response.json(result);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/governance/exceptions/active', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });

      const { capabilityId, actionType, toolId } = request.query as Record<
        string,
        string | undefined
      >;
      if (!capabilityId || (!actionType && !toolId)) {
        response.status(400).json({
          message: 'capabilityId and at least one of actionType or toolId are required',
        });
        return;
      }
      const exception = await findMatchingActivePolicyException({
        capabilityId,
        actionType: actionType as any,
        toolId: toolId as any,
      });
      response.json({ exception });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/governance/exceptions/:exceptionId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });

      const exception = await getException(request.params.exceptionId);
      if (!exception) {
        response.status(404).json({ message: 'Exception not found' });
        return;
      }
      response.json(exception);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/governance/exceptions', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'access.manage' });

      const body = (request.body ?? {}) as {
        capabilityId?: string;
        controlId?: string;
        reason?: string;
        scopeSelector?: Record<string, unknown>;
        expiresAt?: string;
      };
      const requestedBy = actor?.userId ?? actor?.displayName ?? 'unknown';
      const record = await requestException({
        capabilityId: String(body.capabilityId ?? ''),
        controlId: String(body.controlId ?? ''),
        reason: String(body.reason ?? ''),
        scopeSelector: body.scopeSelector ?? {},
        expiresAt: String(body.expiresAt ?? ''),
        requestedBy,
      });
      response.status(201).json(record);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/governance/exceptions/:exceptionId/decide', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'access.manage' });

      const body = (request.body ?? {}) as {
        status?: 'APPROVED' | 'DENIED';
        comment?: string;
        expiresAt?: string;
      };
      const record = await decideException({
        exceptionId: request.params.exceptionId,
        decision: {
          status: (body.status ?? 'APPROVED') as 'APPROVED' | 'DENIED',
          comment: body.comment,
          expiresAt: body.expiresAt,
        },
        actorUserId: actor?.userId ?? actor?.displayName ?? 'unknown',
      });
      response.json(record);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/governance/exceptions/:exceptionId/revoke', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'access.manage' });

      const body = (request.body ?? {}) as { comment?: string };
      const record = await revokeException({
        exceptionId: request.params.exceptionId,
        actorUserId: actor?.userId ?? actor?.displayName ?? 'unknown',
        comment: body.comment,
      });
      response.json(record);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/governance/provenance/prove-no-touch', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });

      const body = (request.body ?? {}) as {
        capabilityId?: string;
        pathGlob?: string;
        from?: string;
        to?: string;
        actorKind?: 'AI' | 'HUMAN' | 'ANY';
      };
      if (!body.capabilityId || !body.pathGlob || !body.from || !body.to) {
        response.status(400).json({
          message: 'capabilityId, pathGlob, from, and to are required',
        });
        return;
      }
      const result = await proveNoTouch({
        capabilityId: body.capabilityId,
        pathGlob: body.pathGlob,
        from: body.from,
        to: body.to,
        actorKind: body.actorKind,
      });
      response.json(result);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/governance/provenance/coverage', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });

      const capabilityId = String(request.query.capabilityId ?? '');
      if (!capabilityId) {
        response.status(400).json({ message: 'capabilityId is required' });
        return;
      }
      const windows = await listCoverageWindows(capabilityId);
      response.json({ windows });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/governance/posture', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.audit' });
      response.json(await getGovernancePostureSnapshot());
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
