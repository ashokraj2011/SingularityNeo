import type express from 'express';
import type { WorkItemPhase } from '../../src/types';
import { assertCapabilityPermission } from '../access';
import {
  getApprovalWorkspaceContext,
  refreshApprovalStructuredPacket,
  sendBackApprovalForClarification,
} from '../approvalWorkspace';
import { sendApiError } from '../api/errors';
import { subscribeToRunEvents } from '../eventBus';
import { getWorkflowRunDetail, listWorkflowRunEvents } from '../execution/repository';
import {
  approveWorkflowRun,
  cancelWorkflowRun,
  pauseWorkflowRun,
  provideWorkflowRunInput,
  requestChangesWorkflowRun,
  resolveWorkflowRunConflict,
  restartWorkflowRun,
  resumeWorkflowRun,
} from '../execution/service';
import { wakeExecutionWorker } from '../execution/worker';
import { parseActorContext } from '../requestActor';

type WorkflowRunRouteDeps = {
  parseActor: (value: unknown, fallback: string) => string;
  writeSseEvent: (response: express.Response, event: string, payload: unknown) => void;
};

export const registerWorkflowRunRoutes = (
  app: express.Express,
  { parseActor, writeSseEvent }: WorkflowRunRouteDeps,
) => {
  app.get('/api/capabilities/:capabilityId/runs/:runId', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workitem.read',
      });
      response.json(
        await getWorkflowRunDetail(
          request.params.capabilityId,
          request.params.runId,
        ),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/runs/:runId/events', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
      response.json(
        await listWorkflowRunEvents(
          request.params.capabilityId,
          request.params.runId,
        ),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/runs/:runId/stream', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'telemetry.read',
      });
    } catch (error) {
      sendApiError(response, error);
      return;
    }

    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    const { capabilityId, runId } = request.params;

    try {
      const [detail, events] = await Promise.all([
        getWorkflowRunDetail(capabilityId, runId),
        listWorkflowRunEvents(capabilityId, runId),
      ]);
      writeSseEvent(response, 'snapshot', { detail, events });
    } catch (error) {
      writeSseEvent(response, 'error', {
        error: error instanceof Error ? error.message : 'Unable to load run stream snapshot.',
      });
      response.end();
      return;
    }

    const unsubscribe = subscribeToRunEvents(runId, event => {
      writeSseEvent(response, 'event', event);
    });

    const interval = setInterval(() => {
      void getWorkflowRunDetail(capabilityId, runId)
        .then(detail => {
          writeSseEvent(response, 'heartbeat', { detail });
        })
        .catch(error => {
          writeSseEvent(response, 'error', {
            error: error instanceof Error ? error.message : 'Run stream refresh failed.',
          });
        });
    }, 3000);

    request.on('close', () => {
      clearInterval(interval);
      unsubscribe();
      response.end();
    });
  });

  app.post('/api/capabilities/:capabilityId/runs/:runId/approve', async (request, response) => {
    try {
      const actor = parseActorContext(
        request,
        parseActor(request.body?.resolvedBy, 'Capability Owner'),
      );
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'approval.decide',
      });
      const detail = await approveWorkflowRun({
        capabilityId: request.params.capabilityId,
        runId: request.params.runId,
        resolution:
          String(request.body?.resolution || '').trim() || 'Approved for continuation.',
        resolvedBy: actor.displayName,
        actor,
      });
      wakeExecutionWorker();
      response.json(detail);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/runs/:runId/request-changes', async (request, response) => {
    try {
      const actor = parseActorContext(
        request,
        parseActor(request.body?.resolvedBy, 'Capability Owner'),
      );
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'approval.decide',
      });
      const detail = await requestChangesWorkflowRun({
        capabilityId: request.params.capabilityId,
        runId: request.params.runId,
        resolution:
          String(request.body?.resolution || '').trim() ||
          'Changes requested before continuation.',
        resolvedBy: actor.displayName,
        actor,
      });
      wakeExecutionWorker();
      response.json(detail);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get(
    '/api/capabilities/:capabilityId/runs/:runId/approvals/:waitId',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'workitem.read',
        });
        response.json(
          await getApprovalWorkspaceContext({
            capabilityId: request.params.capabilityId,
            runId: request.params.runId,
            waitId: request.params.waitId,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/runs/:runId/approvals/:waitId/refresh-packet',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'artifact.read',
        });
        response.json(
          await refreshApprovalStructuredPacket({
            capabilityId: request.params.capabilityId,
            runId: request.params.runId,
            waitId: request.params.waitId,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/runs/:runId/approvals/:waitId/send-back',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'approval.decide',
        });

        const targetAgentId = String(request.body?.targetAgentId || '').trim();
        const summary = String(request.body?.summary || '').trim();
        const note = String(request.body?.note || '').trim() || undefined;
        const clarificationQuestions = Array.isArray(request.body?.clarificationQuestions)
          ? request.body.clarificationQuestions
              .map((value: unknown) => String(value || '').trim())
              .filter(Boolean)
          : String(request.body?.clarificationQuestions || '')
              .split(/\r?\n/)
              .map(value => value.trim())
              .filter(Boolean);

        if (!targetAgentId) {
          response.status(400).json({ error: 'Choose a target agent for the clarification loop.' });
          return;
        }
        if (!summary) {
          response
            .status(400)
            .json({ error: 'Add a disagreement summary before sending the approval back.' });
          return;
        }
        if (clarificationQuestions.length === 0) {
          response.status(400).json({
            error: 'Add at least one clarification question or requested change.',
          });
          return;
        }

        response.json(
          await sendBackApprovalForClarification({
            capabilityId: request.params.capabilityId,
            runId: request.params.runId,
            waitId: request.params.waitId,
            targetAgentId,
            summary,
            clarificationQuestions,
            note,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post('/api/capabilities/:capabilityId/runs/:runId/provide-input', async (request, response) => {
    try {
      const actor = parseActorContext(
        request,
        parseActor(request.body?.resolvedBy, 'Capability Owner'),
      );
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const detail = await provideWorkflowRunInput({
        capabilityId: request.params.capabilityId,
        runId: request.params.runId,
        resolution:
          String(request.body?.resolution || '').trim() || 'Input provided for continuation.',
        resolvedBy: actor.displayName,
        actor,
      });
      wakeExecutionWorker();
      response.json(detail);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/runs/:runId/resolve-conflict', async (request, response) => {
    try {
      const actor = parseActorContext(
        request,
        parseActor(request.body?.resolvedBy, 'Capability Owner'),
      );
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const detail = await resolveWorkflowRunConflict({
        capabilityId: request.params.capabilityId,
        runId: request.params.runId,
        resolution:
          String(request.body?.resolution || '').trim() ||
          'Conflict resolved for continuation.',
        resolvedBy: actor.displayName,
        actor,
      });
      wakeExecutionWorker();
      response.json(detail);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/runs/:runId/cancel', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workitem.control',
      });
      response.json(
        await cancelWorkflowRun({
          capabilityId: request.params.capabilityId,
          runId: request.params.runId,
          note: String(request.body?.note || '').trim() || undefined,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/runs/:runId/pause', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      response.json(
        await pauseWorkflowRun({
          capabilityId: request.params.capabilityId,
          runId: request.params.runId,
          note: String(request.body?.note || '').trim() || undefined,
          actor,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/runs/:runId/resume', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const detail = await resumeWorkflowRun({
        capabilityId: request.params.capabilityId,
        runId: request.params.runId,
        note: String(request.body?.note || '').trim() || undefined,
        actor,
      });
      wakeExecutionWorker();
      response.json(detail);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/runs/:runId/restart', async (request, response) => {
    try {
      const actor = parseActorContext(
        request,
        parseActor(request.body?.guidedBy, 'Capability Owner'),
      );
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.restart',
      });
      const detail = await restartWorkflowRun({
        capabilityId: request.params.capabilityId,
        runId: request.params.runId,
        restartFromPhase: request.body?.restartFromPhase as WorkItemPhase | undefined,
        guidance: String(request.body?.guidance || '').trim() || undefined,
        guidedBy: actor.displayName,
        actor,
      });
      wakeExecutionWorker();
      response.status(201).json(detail);
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
