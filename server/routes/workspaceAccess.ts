import type express from 'express';
import type { PermissionAction, UserPreference, WorkspaceOrganization } from '../../src/types';
import { hasPermission } from '../../src/lib/accessControl';
import { normalizeCapabilityDatabaseConfigs } from '../../src/lib/capabilityDatabases';
import { normalizeWorkspaceConnectorSettings } from '../../src/lib/workspaceConnectors';
import {
  assertCapabilityPermission,
  assertWorkspacePermission,
  getAuthorizedAppState,
  getWorkspaceAccessSnapshot,
  updateWorkspaceAccessSnapshot,
} from '../access';
import { sendApiError } from '../api/errors';
import { listRecentWorkflowRunEvents, listWorkflowRunsByCapability } from '../execution/repository';
import { buildCapabilityInteractionFeedSnapshot } from '../interactionFeed';
import { listPolicyDecisions } from '../policy';
import { parseActorContext } from '../requestActor';
import {
  getCapabilityTask,
  getWorkspaceCatalogSnapshot,
  getWorkspaceSettings,
  initializeWorkspaceFoundations,
  listCapabilityTasks,
  updateWorkspaceSettings,
  getCapabilityBundle,
} from '../domains/self-service';
import { buildRunConsoleSnapshot, listTelemetryMetrics, listTelemetrySpans } from '../telemetry';
import { upsertUserPreference } from '../workspaceOrganization';

type WorkspaceAccessRouteDeps = {
  awaitStartupInitialization: () => Promise<void>;
  buildCopilotSessionMonitorSnapshot: (capabilityId: string) => Promise<unknown>;
};

export const registerWorkspaceAccessRoutes = (
  app: express.Express,
  { awaitStartupInitialization, buildCopilotSessionMonitorSnapshot }: WorkspaceAccessRouteDeps,
) => {
  app.get('/api/state', async (request, response) => {
    try {
      await awaitStartupInitialization();
      response.json(await getAuthorizedAppState(parseActorContext(request, 'Workspace Operator')));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/workspace/organization', async (request, response) => {
    try {
      await awaitStartupInitialization();
      const actor = parseActorContext(request, 'Workspace Operator');
      const accessSnapshot = await getWorkspaceAccessSnapshot(actor);
      response.json(
        hasPermission(accessSnapshot.currentActorPermissions, 'access.manage') ||
          hasPermission(accessSnapshot.currentActorPermissions, 'workspace.manage')
          ? accessSnapshot.organization
          : {
              ...accessSnapshot.organization,
              capabilityGrants: [],
              descendantAccessGrants: [],
              accessAuditEvents: [],
            },
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/workspace/organization', async (request, response) => {
    try {
      await awaitStartupInitialization();
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'access.manage' });
      response.json(
        (
          await updateWorkspaceAccessSnapshot({
            updates: request.body as Partial<WorkspaceOrganization>,
            actor,
          })
        ).organization,
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.put('/api/workspace/users/:userId/preferences', async (request, response) => {
    try {
      await awaitStartupInitialization();
      const actor = parseActorContext(request, 'Workspace Operator');
      if (actor.userId !== request.params.userId) {
        await assertWorkspacePermission({ actor, action: 'access.manage' });
      }
      response.json(
        await upsertUserPreference({
          userId: request.params.userId,
          defaultCapabilityId:
            String(request.body?.defaultCapabilityId || '').trim() || undefined,
          lastSelectedTeamId:
            String(request.body?.lastSelectedTeamId || '').trim() || undefined,
          workbenchView: String(request.body?.workbenchView || '').trim() || undefined,
        } as UserPreference),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/workspace/access', async (request, response) => {
    try {
      await awaitStartupInitialization();
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'access.manage' });
      response.json(await getWorkspaceAccessSnapshot(actor));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/workspace/access', async (request, response) => {
    try {
      await awaitStartupInitialization();
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'access.manage' });
      response.json(
        await updateWorkspaceAccessSnapshot({
          updates: request.body as Partial<WorkspaceOrganization>,
          actor,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/workspace/settings', async (request, response) => {
    try {
      await awaitStartupInitialization();
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json(await getWorkspaceSettings());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/workspace/settings', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json(
        await updateWorkspaceSettings({
          databaseConfigs: normalizeCapabilityDatabaseConfigs(
            request.body?.databaseConfigs || [],
          ),
          connectors: request.body?.connectors
            ? normalizeWorkspaceConnectorSettings(request.body.connectors)
            : undefined,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/workspace/connectors', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json((await getWorkspaceSettings()).connectors);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/workspace/connectors', async (request, response) => {
    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json(
        (
          await updateWorkspaceSettings({
            connectors: normalizeWorkspaceConnectorSettings(request.body || {}),
          })
        ).connectors,
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/workspace/catalog', async (request, response) => {
    try {
      await awaitStartupInitialization();
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json(await getWorkspaceCatalogSnapshot());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/workspace/catalog/initialize', async (request, response) => {
    try {
      await awaitStartupInitialization();
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workspace.manage',
      });
      response.json(await initializeWorkspaceFoundations());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const state = await getAuthorizedAppState(actor);
      const capability = state.capabilities.find(item => item.id === request.params.capabilityId);
      const workspace = state.capabilityWorkspaces.find(
        item => item.capabilityId === request.params.capabilityId,
      );
      if (!capability || !workspace) {
        response.status(404).json({ error: 'Capability was not found or is not visible.' });
        return;
      }
      response.json({ capability, workspace });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/readiness-contract', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      const bundle = await getCapabilityBundle(request.params.capabilityId);
      response.json(bundle.workspace.readinessContract);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/interaction-feed', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workitem.read',
      });
      response.json(
        await buildCapabilityInteractionFeedSnapshot({
          capabilityId: request.params.capabilityId,
          workItemId: String(request.query.workItemId || '').trim() || undefined,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/tasks', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workitem.read',
      });
      response.json(await listCapabilityTasks(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/tasks/:taskId', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workitem.read',
      });
      const task = await getCapabilityTask(
        request.params.capabilityId,
        request.params.taskId,
      );
      if (!task) {
        response.status(404).json({ error: 'Task was not found.' });
        return;
      }
      response.json(task);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/run-console', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
      const capabilityId = request.params.capabilityId;
      const [recentRuns, recentEvents, recentPolicyDecisions] = await Promise.all([
        listWorkflowRunsByCapability(capabilityId),
        listRecentWorkflowRunEvents(capabilityId),
        listPolicyDecisions(capabilityId),
      ]);

      response.json(
        await buildRunConsoleSnapshot(
          capabilityId,
          recentRuns,
          recentEvents,
          recentPolicyDecisions,
        ),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/copilot-sessions', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
      response.json(await buildCopilotSessionMonitorSnapshot(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/telemetry/spans', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
      response.json(
        await listTelemetrySpans(
          request.params.capabilityId,
          Number(request.query.limit || 80),
        ),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/telemetry/metrics', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
      response.json(
        await listTelemetryMetrics(
          request.params.capabilityId,
          Number(request.query.limit || 120),
        ),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/permissions/evaluate', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const capabilityId = String(request.body?.capabilityId || '').trim();
      const action = String(request.body?.action || '').trim() as PermissionAction;
      if (!capabilityId || !action) {
        response.status(400).json({
          error: 'capabilityId and action are required for permission evaluation.',
        });
        return;
      }
      const { permissionSet } = await assertCapabilityPermission({
        capabilityId,
        actor,
        action:
          action === 'capability.read.rollup' || action === 'capability.read'
            ? action
            : 'capability.read.rollup',
      });
      response.json({
        capabilityId,
        action,
        allowed: hasPermission(permissionSet, action),
        permissionSet,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
