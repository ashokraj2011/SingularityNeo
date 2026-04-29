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
  completeWorkflowRunHumanTask,
  delegateWorkflowRunToHuman,
  pauseWorkflowRun,
  provideWorkflowRunInput,
  requestChangesWorkflowRun,
  resolveWorkflowRunConflict,
  restartWorkflowRun,
  resumeWorkflowRun,
} from '../execution/service';
import { wakeExecutionWorker } from '../execution/worker';
import {
  getPromptReceiptById,
  listPromptReceiptsForRun,
  listPromptReceiptsForRunStep,
} from '../execution/promptReceipts';
import { invokeScopedCapabilitySession } from '../githubModels';
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

  app.post('/api/capabilities/:capabilityId/runs/:runId/delegate-to-human', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const instructions = String(request.body?.instructions || '').trim();
      if (!instructions) {
        response.status(400).json({ error: 'Human instructions are required.' });
        return;
      }
      const detail = await delegateWorkflowRunToHuman({
        capabilityId: request.params.capabilityId,
        runId: request.params.runId,
        instructions,
        checklist: Array.isArray(request.body?.checklist)
          ? request.body.checklist
              .map((value: unknown) => String(value || '').trim())
              .filter(Boolean)
          : undefined,
        assigneeUserId:
          typeof request.body?.assigneeUserId === 'string' &&
          request.body.assigneeUserId.trim()
            ? request.body.assigneeUserId.trim()
            : undefined,
        assigneeRole:
          typeof request.body?.assigneeRole === 'string' &&
          request.body.assigneeRole.trim()
            ? request.body.assigneeRole.trim()
            : undefined,
        approvalPolicy:
          request.body?.approvalPolicy && typeof request.body.approvalPolicy === 'object'
            ? (request.body.approvalPolicy as any)
            : undefined,
        note:
          typeof request.body?.note === 'string' && request.body.note.trim()
            ? request.body.note.trim()
            : undefined,
        delegatedBy: actor.displayName,
        actor,
      });
      response.json(detail);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/runs/:runId/complete-human-task', async (request, response) => {
    try {
      const actor = parseActorContext(
        request,
        parseActor(request.body?.resolvedBy, 'Workspace Operator'),
      );
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      const detail = await completeWorkflowRunHumanTask({
        capabilityId: request.params.capabilityId,
        runId: request.params.runId,
        resolution:
          String(request.body?.resolution || '').trim() ||
          'Human task completed and ready for approval.',
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

  // ──────────────────────────────────────────────────────────────────
  // Time-travel debugging for AI decisions.
  //
  // Every main-model LLM call inside the execution engine is persisted
  // to `run_step_prompt_receipts`. These endpoints let operators:
  //   • Browse the exact fragments a model saw for any step ("why did
  //     the agent decide X?").
  //   • Replay any receipt against an alternate model ("what would a
  //     different model have done with the same context?") without
  //     having to re-drive the whole step.
  // ──────────────────────────────────────────────────────────────────

  app.get(
    '/api/capabilities/:capabilityId/runs/:runId/prompt-receipts',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'telemetry.read',
        });
        const receipts = await listPromptReceiptsForRun(request.params.runId);
        // Scope check: a receipt must belong to the capability on the URL.
        // We filter in-memory because the column is already indexed by
        // run_id; adding capability_id to the WHERE is cheap defense-in-depth.
        response.json(
          receipts.filter(r => r.capabilityId === request.params.capabilityId),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    '/api/capabilities/:capabilityId/run-steps/:runStepId/prompt-receipts',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'telemetry.read',
        });
        const receipts = await listPromptReceiptsForRunStep(
          request.params.runStepId,
        );
        response.json(
          receipts.filter(r => r.capabilityId === request.params.capabilityId),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    '/api/capabilities/:capabilityId/prompt-receipts/:receiptId',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'telemetry.read',
        });
        const receipt = await getPromptReceiptById(request.params.receiptId);
        if (!receipt || receipt.capabilityId !== request.params.capabilityId) {
          response.status(404).json({ error: 'Prompt receipt not found.' });
          return;
        }
        response.json(receipt);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/prompt-receipts/:receiptId/replay',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          // Replay is an inference call — treat as execution control so
          // drive-by viewers can't burn tokens. Operators with
          // workitem.control can trigger it.
          action: 'workitem.control',
        });

        const receipt = await getPromptReceiptById(request.params.receiptId);
        if (!receipt || receipt.capabilityId !== request.params.capabilityId) {
          response.status(404).json({ error: 'Prompt receipt not found.' });
          return;
        }

        const modelOverride =
          typeof request.body?.model === 'string' && request.body.model.trim()
            ? String(request.body.model).trim()
            : undefined;

        // Rehydrate the agent snapshot. The stored snapshot holds only
        // the fields `invokeScopedCapabilitySession` reads — system
        // prompt, learning context block, model, provider — so replay
        // reconstructs the system prompt deterministically.
        const agentSnapshot = receipt.agentSnapshot || {};

        const started = Date.now();
        const replay = await invokeScopedCapabilitySession({
          capability: { id: receipt.capabilityId } as never,
          agent: agentSnapshot as never,
          scope: receipt.scope,
          scopeId: receipt.scopeId ?? undefined,
          workItemPhase: receipt.phase ?? null,
          developerPrompt: receipt.developerPrompt ?? undefined,
          memoryPrompt: receipt.memoryPrompt ?? undefined,
          prompt: receipt.userPrompt,
          // Fresh session so replay is not contaminated by whatever the
          // live session state currently is.
          resetSession: true,
          modelOverride,
        });
        const elapsedMs = Date.now() - started;

        response.json({
          receiptId: receipt.id,
          original: {
            model: receipt.model,
            content: receipt.responseContent,
            usage: receipt.responseUsage,
            capturedAt: receipt.createdAt,
          },
          replay: {
            model: replay.model,
            content: replay.content,
            usage: replay.usage,
            elapsedMs,
            modelOverride: modelOverride ?? null,
          },
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );
};
