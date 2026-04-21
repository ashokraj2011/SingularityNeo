import type express from 'express';
import type { ActorContext } from '../../src/types';
import { sendApiError } from '../api/errors';
import { assertCapabilityPermission, assertWorkspacePermission } from '../access';
import {
  claimNextRunnableRunForExecutor,
  getWorkflowRun,
  getWorkflowRunDetail,
  getWorkflowRunStatus,
  getLatestRunForWorkItem,
  getActiveRunForWorkItem,
  updateWorkflowRun,
  updateWorkflowRunControl,
  updateWorkflowRunStep,
  insertRunEvent,
  createRunWait,
  createToolInvocation,
  updateToolInvocation,
  listActiveWorkItemClaims,
  releaseWorkItemClaim,
  upsertWorkItemClaim,
  resolveRunWait,
  updateRunWaitPayload,
  updateApprovalAssignmentsForWait,
  createApprovalAssignments,
  createApprovalDecision,
  markOpenToolInvocationsAborted,
  cancelOpenWaitsForRun,
  releaseRunLease,
  renewExecutorRunLease,
} from '../execution/repository';
import {
  buildExecutorRegistrySummary,
  buildCapabilityExecutionSurface,
  claimCapabilityExecution,
  getCapabilityExecutionOwnership,
  getDesktopExecutorRegistration,
  heartbeatDesktopExecutor,
  listOwnedCapabilityIdsForExecutor,
  registerDesktopExecutor,
  releaseCapabilityExecution,
  unregisterDesktopExecutor,
} from '../executionOwnership';
import {
  getCapabilityBundle,
  releaseWorkItemCodeClaimRecord,
  replaceCapabilityWorkspaceContentRecord,
} from '../repository';
import { buildMemoryContext, refreshCapabilityMemory } from '../memory';
import { evaluateToolPolicy } from '../policy';
import { queueSingleAgentLearningRefresh } from '../agentLearning/service';
import {
  finishTelemetrySpan,
  recordMetricSample,
  recordUsageMetrics,
  startTelemetrySpan,
} from '../telemetry';
import { appendAccessAuditEvent } from '../workspaceOrganization';
import { getWorkspaceWriteLock } from '../workspaceLock';

const parseHeaderStringList = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(item => String(item || '').trim()).filter(Boolean);
    }
  } catch {
    // Ignore invalid JSON and fall back to CSV parsing.
  }

  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const parseActorContext = (
  request: express.Request,
  fallbackDisplayName = 'Desktop Executor',
): ActorContext => ({
  userId: String(request.header('x-singularity-actor-user-id') || '').trim() || undefined,
  displayName:
    String(request.header('x-singularity-actor-display-name') || '').trim() ||
    fallbackDisplayName,
  teamIds: parseHeaderStringList(request.header('x-singularity-actor-team-ids')),
  actedOnBehalfOfStakeholderIds: parseHeaderStringList(
    request.header('x-singularity-actor-stakeholder-ids'),
  ),
});

type RuntimeRpcOperation =
  | 'getWorkflowRunDetail'
  | 'getWorkflowRunStatus'
  | 'getLatestRunForWorkItem'
  | 'getActiveRunForWorkItem'
  | 'updateWorkflowRun'
  | 'updateWorkflowRunControl'
  | 'updateWorkflowRunStep'
  | 'insertRunEvent'
  | 'createRunWait'
  | 'createToolInvocation'
  | 'updateToolInvocation'
  | 'listActiveWorkItemClaims'
  | 'releaseWorkItemClaim'
  | 'upsertWorkItemClaim'
  | 'resolveRunWait'
  | 'updateRunWaitPayload'
  | 'updateApprovalAssignmentsForWait'
  | 'createApprovalAssignments'
  | 'createApprovalDecision'
  | 'markOpenToolInvocationsAborted'
  | 'cancelOpenWaitsForRun'
  | 'releaseRunLease'
  | 'getCapabilityBundle'
  | 'replaceCapabilityWorkspaceContentRecord'
  | 'releaseWorkItemCodeClaimRecord'
  | 'buildMemoryContext'
  | 'refreshCapabilityMemory'
  | 'evaluateToolPolicy'
  | 'queueSingleAgentLearningRefresh'
  | 'startTelemetrySpan'
  | 'finishTelemetrySpan'
  | 'recordMetricSample'
  | 'recordUsageMetrics';

const executeRuntimeRpc = async (
  operation: RuntimeRpcOperation,
  args: Record<string, any> = {},
) => {
  switch (operation) {
    case 'getWorkflowRunDetail':
      return getWorkflowRunDetail(args.capabilityId, args.runId);
    case 'getWorkflowRunStatus':
      return getWorkflowRunStatus(args.capabilityId, args.runId);
    case 'getLatestRunForWorkItem':
      return getLatestRunForWorkItem(args.capabilityId, args.workItemId);
    case 'getActiveRunForWorkItem':
      return getActiveRunForWorkItem(args.capabilityId, args.workItemId);
    case 'updateWorkflowRun':
      return updateWorkflowRun(args.run);
    case 'updateWorkflowRunControl':
      return updateWorkflowRunControl(args.run);
    case 'updateWorkflowRunStep':
      return updateWorkflowRunStep(args.step);
    case 'insertRunEvent':
      return insertRunEvent(args.event);
    case 'createRunWait':
      return createRunWait(args.wait);
    case 'createToolInvocation':
      return createToolInvocation(args.invocation);
    case 'updateToolInvocation':
      return updateToolInvocation(args.invocation);
    case 'listActiveWorkItemClaims':
      return listActiveWorkItemClaims(args.capabilityId, args.workItemId);
    case 'releaseWorkItemClaim':
      return releaseWorkItemClaim(args as Parameters<typeof releaseWorkItemClaim>[0]);
    case 'upsertWorkItemClaim':
      return upsertWorkItemClaim(args.claim);
    case 'resolveRunWait':
      return resolveRunWait(args as Parameters<typeof resolveRunWait>[0]);
    case 'updateRunWaitPayload':
      return updateRunWaitPayload(args as Parameters<typeof updateRunWaitPayload>[0]);
    case 'updateApprovalAssignmentsForWait':
      return updateApprovalAssignmentsForWait(
        args as Parameters<typeof updateApprovalAssignmentsForWait>[0],
      );
    case 'createApprovalAssignments':
      return createApprovalAssignments(args.assignments || []);
    case 'createApprovalDecision':
      return createApprovalDecision(args.decision);
    case 'markOpenToolInvocationsAborted':
      return markOpenToolInvocationsAborted(
        args as Parameters<typeof markOpenToolInvocationsAborted>[0],
      );
    case 'cancelOpenWaitsForRun':
      return cancelOpenWaitsForRun(args as Parameters<typeof cancelOpenWaitsForRun>[0]);
    case 'releaseRunLease':
      return releaseRunLease(args as Parameters<typeof releaseRunLease>[0]);
    case 'getCapabilityBundle':
      return getCapabilityBundle(args.capabilityId);
    case 'replaceCapabilityWorkspaceContentRecord':
      return replaceCapabilityWorkspaceContentRecord(args.capabilityId, args.updates || {});
    case 'releaseWorkItemCodeClaimRecord':
      return releaseWorkItemCodeClaimRecord(
        args as Parameters<typeof releaseWorkItemCodeClaimRecord>[0],
      );
    case 'buildMemoryContext':
      return buildMemoryContext(args as Parameters<typeof buildMemoryContext>[0]);
    case 'refreshCapabilityMemory':
      return refreshCapabilityMemory(args.capabilityId);
    case 'evaluateToolPolicy':
      return evaluateToolPolicy(args as Parameters<typeof evaluateToolPolicy>[0]);
    case 'queueSingleAgentLearningRefresh':
      return queueSingleAgentLearningRefresh(
        args.capabilityId,
        args.agentId,
        args.requestReason,
      );
    case 'startTelemetrySpan':
      return startTelemetrySpan(args as Parameters<typeof startTelemetrySpan>[0]);
    case 'finishTelemetrySpan':
      return finishTelemetrySpan(args as Parameters<typeof finishTelemetrySpan>[0]);
    case 'recordMetricSample':
      return recordMetricSample(args.sample);
    case 'recordUsageMetrics':
      return recordUsageMetrics(args as Parameters<typeof recordUsageMetrics>[0]);
    default:
      throw new Error(`Unsupported runtime RPC operation: ${operation}`);
  }
};

const createAuditEventId = () =>
  `AUDIT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const requireExecutorActor = async ({
  executorId,
  actor,
}: {
  executorId: string;
  actor: ActorContext;
}) => {
  if (!actor.userId) {
    throw new Error('Select a workspace operator before using desktop execution.');
  }

  const registration = await getDesktopExecutorRegistration(executorId);
  if (!registration) {
    throw new Error('The desktop executor is not registered yet.');
  }

  if (registration.actorUserId && registration.actorUserId !== actor.userId) {
    throw new Error('This desktop executor is registered for a different workspace operator.');
  }

  return registration;
};

const collectCapabilityIds = (
  value: unknown,
  capabilityIds = new Set<string>(),
  visited = new WeakSet<object>(),
) => {
  if (!value || typeof value !== 'object') {
    return capabilityIds;
  }

  if (visited.has(value)) {
    return capabilityIds;
  }

  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach(item => collectCapabilityIds(item, capabilityIds, visited));
    return capabilityIds;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.capabilityId === 'string' && record.capabilityId.trim()) {
    capabilityIds.add(record.capabilityId.trim());
  }

  const nestedCapability = record.capability;
  if (
    nestedCapability &&
    typeof nestedCapability === 'object' &&
    typeof (nestedCapability as { id?: unknown }).id === 'string' &&
    (nestedCapability as { id: string }).id.trim()
  ) {
    capabilityIds.add((nestedCapability as { id: string }).id.trim());
  }

  Object.values(record).forEach(item => collectCapabilityIds(item, capabilityIds, visited));
  return capabilityIds;
};

const assertExecutorCapabilityAccess = async ({
  executorId,
  capabilityIds,
}: {
  executorId: string;
  capabilityIds: string[];
}) => {
  const uniqueCapabilityIds = Array.from(
    new Set(capabilityIds.map(item => item.trim()).filter(Boolean)),
  );
  if (uniqueCapabilityIds.length === 0) {
    throw new Error('The runtime operation did not include a capability scope.');
  }

  for (const capabilityId of uniqueCapabilityIds) {
    const ownership = await getCapabilityExecutionOwnership(capabilityId);
    if (!ownership || ownership.executorId !== executorId) {
      throw new Error(
        `This desktop executor does not own execution for capability ${capabilityId}.`,
      );
    }
  }
};

export const registerExecutionRuntimeRoutes = (app: express.Express) => {
  app.get('/api/runtime/executors', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.operations' });
      response.json(await buildExecutorRegistrySummary());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/runtime/executors/:executorId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'report.view.operations' });
      const summary = await buildExecutorRegistrySummary();
      const entry = summary.entries.find(
        item => item.registration.id === String(request.params.executorId || '').trim(),
      );
      if (!entry) {
        response.status(404).json({ error: 'Desktop executor not found.' });
        return;
      }
      response.json(entry);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete('/api/runtime/executors/:executorId', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'workspace.manage' });
      await unregisterDesktopExecutor(String(request.params.executorId || '').trim());
      response.status(204).end();
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/runtime/executors/register', async (request, response) => {
    try {
      const actor = parseActorContext(request);
      const body = (request.body || {}) as {
        executorId?: string;
        approvedWorkspaceRoots?: Record<string, string[]>;
        runtimeSummary?: Record<string, unknown>;
      };
      const executorId = String(body.executorId || '').trim();
      if (!executorId) {
        response.status(400).json({ error: 'executorId is required.' });
        return;
      }
      if (!actor.userId) {
        response
          .status(400)
          .json({ error: 'Select a workspace operator before registering desktop execution.' });
        return;
      }

      response.json(
        await registerDesktopExecutor({
          executorId,
          actor,
          approvedWorkspaceRoots: body.approvedWorkspaceRoots,
          runtimeSummary: body.runtimeSummary,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/runtime/executors/:executorId/heartbeat', async (request, response) => {
    try {
      const actor = parseActorContext(request);
      const executorId = String(request.params.executorId || '').trim();
      await requireExecutorActor({ executorId, actor });
      response.json(
        await heartbeatDesktopExecutor({
          executorId,
          actor,
          approvedWorkspaceRoots: request.body?.approvedWorkspaceRoots,
          runtimeSummary: request.body?.runtimeSummary,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/execution/claim', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const capabilityId = String(request.params.capabilityId || '').trim();
      await assertCapabilityPermission({
        capabilityId,
        actor,
        action: 'capability.execution.claim',
      });

      const executorId = String(request.body?.executorId || '').trim();
      if (!executorId) {
        response.status(400).json({ error: 'executorId is required.' });
        return;
      }

      const registration = await getDesktopExecutorRegistration(executorId);
      if (!registration) {
        response.status(404).json({ error: 'Desktop executor not found.' });
        return;
      }

      const approvedWorkspaceRoots =
        request.body?.approvedWorkspaceRoots ||
        registration.approvedWorkspaceRoots?.[capabilityId] ||
        [];

      const ownership = await claimCapabilityExecution({
        capabilityId,
        executorId,
        actor,
        approvedWorkspaceRoots,
        forceTakeover: Boolean(request.body?.forceTakeover),
      });

      await appendAccessAuditEvent({
        id: createAuditEventId(),
        actorUserId: actor.userId,
        actorDisplayName: actor.displayName || 'Workspace Operator',
        action: request.body?.forceTakeover
          ? 'capability.execution.taken_over'
          : 'capability.execution.claimed',
        targetType: 'CAPABILITY_ACCESS',
        targetId: capabilityId,
        capabilityId,
        summary: `${actor.displayName || 'Workspace Operator'} claimed desktop execution for this capability.`,
        metadata: {
          executorId,
          approvedWorkspaceRoots,
          forceTakeover: Boolean(request.body?.forceTakeover),
        },
        createdAt: new Date().toISOString(),
      }).catch(() => undefined);

      response.json({
        ownership,
        executor: await getDesktopExecutorRegistration(executorId),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete('/api/capabilities/:capabilityId/execution/claim', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const capabilityId = String(request.params.capabilityId || '').trim();
      await assertCapabilityPermission({
        capabilityId,
        actor,
        action: 'capability.execution.claim',
      });

      const executorId = String(request.body?.executorId || request.query.executorId || '').trim();
      if (!executorId) {
        response.status(400).json({ error: 'executorId is required.' });
        return;
      }

      await releaseCapabilityExecution({ capabilityId, executorId });
      await appendAccessAuditEvent({
        id: createAuditEventId(),
        actorUserId: actor.userId,
        actorDisplayName: actor.displayName || 'Workspace Operator',
        action: 'capability.execution.released',
        targetType: 'CAPABILITY_ACCESS',
        targetId: capabilityId,
        capabilityId,
        summary: `${actor.displayName || 'Workspace Operator'} released desktop execution for this capability.`,
        metadata: {
          executorId,
        },
        createdAt: new Date().toISOString(),
      }).catch(() => undefined);
      response.status(204).end();
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/execution/status', async (request, response) => {
    try {
      const capabilityId = String(request.params.capabilityId || '').trim();
      const ownership = await getCapabilityExecutionOwnership(capabilityId);
      const dispatch = await buildCapabilityExecutionSurface({
        capabilityId,
      });

      response.json({
        ownership,
        executionDispatchState: dispatch.executionDispatchState,
        executionQueueReason: dispatch.executionQueueReason,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/workspace-lock', async (request, response) => {
    try {
      const capabilityId = String(request.params.capabilityId || '').trim();
      const lock = await getWorkspaceWriteLock(capabilityId);
      response.json({ lock });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/runtime/executors/:executorId/runs/claim-next', async (request, response) => {
    try {
      const executorId = String(request.params.executorId || '').trim();
      const actor = parseActorContext(request);
      await requireExecutorActor({ executorId, actor });
      await heartbeatDesktopExecutor({
        executorId,
        actor,
        approvedWorkspaceRoots: request.body?.approvedWorkspaceRoots,
        runtimeSummary: request.body?.runtimeSummary,
      });
      const run = await claimNextRunnableRunForExecutor({
        executorId,
        leaseMs: Number(request.body?.leaseMs || 30_000),
      });
      response.json({ run, ownedCapabilityIds: await listOwnedCapabilityIdsForExecutor(executorId) });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get(
    '/api/runtime/executors/:executorId/runs/:runId/bundle',
    async (request, response) => {
      try {
        const executorId = String(request.params.executorId || '').trim();
        const runId = String(request.params.runId || '').trim();
        const capabilityId = String(request.query.capabilityId || '').trim();
        const actor = parseActorContext(request);
        await requireExecutorActor({ executorId, actor });
        await assertExecutorCapabilityAccess({
          executorId,
          capabilityIds: [capabilityId],
        });
        const run = await getWorkflowRun(capabilityId, runId);
        if (run.assignedExecutorId && run.assignedExecutorId !== executorId) {
          response.status(403).json({ error: 'This run is assigned to a different desktop executor.' });
          return;
        }

        response.json({
          detail: await getWorkflowRunDetail(capabilityId, runId),
          bundle: await getCapabilityBundle(capabilityId),
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/runtime/executors/:executorId/runs/:runId/heartbeat',
    async (request, response) => {
      try {
        const executorId = String(request.params.executorId || '').trim();
        const runId = String(request.params.runId || '').trim();
        const capabilityId = String(request.body?.capabilityId || '').trim();
        const actor = parseActorContext(request);
        await requireExecutorActor({ executorId, actor });
        await assertExecutorCapabilityAccess({
          executorId,
          capabilityIds: [capabilityId],
        });
        await heartbeatDesktopExecutor({
          executorId,
          actor,
          approvedWorkspaceRoots: request.body?.approvedWorkspaceRoots,
          runtimeSummary: request.body?.runtimeSummary,
        });
        await renewExecutorRunLease({
          capabilityId,
          runId,
          executorId,
          leaseMs: Number(request.body?.leaseMs || 30_000),
        });
        response.json({ ok: true });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/runtime/executors/:executorId/runs/:runId/apply-turn',
    async (request, response) => {
      try {
        const executorId = String(request.params.executorId || '').trim();
        const actor = parseActorContext(request);
        await requireExecutorActor({ executorId, actor });
        const operations = Array.isArray(request.body?.operations)
          ? request.body.operations
          : [];
        await assertExecutorCapabilityAccess({
          executorId,
          capabilityIds: operations.flatMap(entry =>
            Array.from(collectCapabilityIds(entry?.args || {})),
          ),
        });
        const results = [];
        for (const entry of operations) {
          const operation = String(entry?.operation || '') as RuntimeRpcOperation;
          results.push({
            operation,
            result: await executeRuntimeRpc(operation, entry?.args || {}),
          });
        }
        response.json({ results });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post('/api/runtime/executors/:executorId/rpc', async (request, response) => {
    try {
      const executorId = String(request.params.executorId || '').trim();
      const actor = parseActorContext(request);
      await requireExecutorActor({ executorId, actor });
      await assertExecutorCapabilityAccess({
        executorId,
        capabilityIds: Array.from(collectCapabilityIds(request.body?.args || {})),
      });
      const operation = String(request.body?.operation || '') as RuntimeRpcOperation;
      response.json({
        result: await executeRuntimeRpc(operation, request.body?.args || {}),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
