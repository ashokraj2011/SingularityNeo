/**
 * Swarm Chat Routes
 *
 * HTTP surface for cross-capability Swarm Debates.
 *
 *   POST /api/runtime/chat/swarm                       — kickoff (non-streaming; 202 with sessionId)
 *   GET  /api/runtime/chat/swarm/stream                — SSE subscriber for an existing session
 *   GET  /api/capabilities/:capId/chat-participants    — participant directory
 *   GET  /api/capabilities/:capId/swarm-sessions/:id   — full session detail
 *   POST /api/capabilities/:capId/swarm-sessions/:id/review             — { decision, comment? }
 *   POST /api/capabilities/:capId/swarm-sessions/:id/promote-to-work-item
 *   POST /api/capabilities/:capId/swarm-sessions/:id/cancel
 *
 * Concurrency + rate-limit guards live in `createSwarmSessionWithGuards`
 * below; routes only do wiring + permission checks.
 */
import type express from 'express';
import type {
  ChatParticipantDirectory,
  SwarmParticipantRole,
  SwarmSessionScope,
  SwarmSessionDetail,
} from '../../src/types';
import { assertCapabilityPermission } from '../access';
import { query } from '../db';
import { getCapabilityBundle } from '../repository';
import {
  createSwarmSession,
  findOpenSwarmSessionForScope,
  loadSwarmSessionDetail,
  markSwarmSessionPromoted,
  updateSwarmSessionStatus,
  listRecentSwarmSessionsForWorkItem,
} from '../swarmRepository';
import {
  runSwarmDebate,
  SWARM_VOTE_TOOL_META,
} from '../execution/swarmOrchestrator';
import { createWorkItemRecord } from '../execution/service';
import {
  publishSwarmStreamEvent,
  subscribeToSwarmStream,
  type SwarmStreamEvent,
} from '../eventBus';
import { getApiErrorStatus, sendApiError } from '../api/errors';
import { parseActorContext } from '../requestActor';
import {
  buildAuthorizedParticipantDirectory,
  resolveAuthorizedSwarmParticipants,
} from '../swarmParticipants';

const MAX_PARTICIPANTS = 3;
const MIN_PARTICIPANTS = 2;
const DEFAULT_MAX_TOKEN_BUDGET = 120_000;

// In-memory cancellation flags keyed by session id. Flipped by the /cancel
// route; read by the orchestrator between turns. If the process restarts
// mid-debate the session row stays as RUNNING and an operator cancel after
// that point will still transition to CANCELLED via the status update — the
// orchestrator just won't observe the flag. Good enough for best-effort.
const cancellationFlags = new Map<string, boolean>();

// Simple per-user sliding-window rate limit — ten swarms / hour / user.
// Replace with the shared rate-limit middleware if/when one lands.
const recentStartsByUser = new Map<string, number[]>();
const SWARM_QUOTA_WINDOW_MS = 60 * 60 * 1000;
const SWARM_QUOTA_MAX = 10;

const registerStartForRateLimit = (userId: string) => {
  const now = Date.now();
  const cutoff = now - SWARM_QUOTA_WINDOW_MS;
  const history = (recentStartsByUser.get(userId) || []).filter(
    ts => ts > cutoff,
  );
  history.push(now);
  recentStartsByUser.set(userId, history);
  return history.length;
};

type KickoffBody = {
  capabilityId?: string;
  workItemId?: string;
  initiatingPrompt?: string;
  sessionScope?: SwarmSessionScope;
  leadParticipantIndex?: number;
  maxTokenBudget?: number;
  participants?: Array<{
    capabilityId: string;
    agentId: string;
  }>;
};

export type SwarmRouteDeps = {
  parseActor: (value: unknown, fallback: string) => string;
  writeSseEvent: (
    response: express.Response,
    event: string,
    payload: unknown,
  ) => void;
};

// ─── Kickoff helpers ─────────────────────────────────────────────────────────

const normalizeParticipants = (
  body: KickoffBody,
): { capabilityId: string; agentId: string }[] => {
  const raw = body.participants || [];
  const seen = new Set<string>();
  const deduped: { capabilityId: string; agentId: string }[] = [];
  for (const item of raw) {
    if (!item?.capabilityId || !item?.agentId) continue;
    const key = `${item.capabilityId}::${item.agentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      capabilityId: item.capabilityId,
      agentId: item.agentId,
    });
  }
  return deduped;
};

const validateKickoffBody = (
  body: KickoffBody,
): { ok: true } | { ok: false; status: number; message: string } => {
  if (!body.capabilityId) {
    return { ok: false, status: 400, message: 'capabilityId is required.' };
  }
  if (!body.initiatingPrompt?.trim()) {
    return {
      ok: false,
      status: 400,
      message: 'initiatingPrompt is required.',
    };
  }
  const participants = normalizeParticipants(body);
  if (
    participants.length < MIN_PARTICIPANTS ||
    participants.length > MAX_PARTICIPANTS
  ) {
    return {
      ok: false,
      status: 400,
      message: `Swarm debates require ${MIN_PARTICIPANTS}-${MAX_PARTICIPANTS} participants; received ${participants.length}.`,
    };
  }
  return { ok: true };
};

const isUniqueViolation = (error: unknown) =>
  Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === '23505',
  );

/**
 * Resolve + validate participants against their home capability bundles.
 * Returns a typed roster ready for persistence, or a user-facing error.
 */
const resolveParticipantRoster = async (
  body: KickoffBody,
  actor: ReturnType<typeof parseActorContext>,
): Promise<
  | {
      ok: true;
      roster: Array<{
        participantCapabilityId: string;
        participantAgentId: string;
        participantRole: SwarmParticipantRole;
        tagOrder: number;
      }>;
    }
  | { ok: false; status: number; message: string }
> => {
  const participants = normalizeParticipants(body);
  const leadIndex =
    typeof body.leadParticipantIndex === 'number' &&
    body.leadParticipantIndex >= 0 &&
    body.leadParticipantIndex < participants.length
      ? body.leadParticipantIndex
      : 0;

  try {
    const resolved = await resolveAuthorizedSwarmParticipants({
      anchorCapabilityId: body.capabilityId!,
      actor,
      participants,
    });

    return {
      ok: true,
      roster: resolved.map((entry, index) => ({
        participantCapabilityId: entry.capabilityId,
        participantAgentId: entry.agentId,
        participantRole: index === leadIndex ? 'LEAD' : 'PEER',
        tagOrder: index,
      })),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'The participant roster could not be resolved.';
    return {
      ok: false,
      status: getApiErrorStatus(message),
      message,
    };
  }
};

// ─── Route registration ──────────────────────────────────────────────────────

export const registerSwarmChatRoutes = (
  app: express.Express,
  { parseActor, writeSseEvent }: SwarmRouteDeps,
) => {
  // GET /api/capabilities/:capId/chat-participants
  app.get(
    '/api/capabilities/:capId/chat-participants',
    async (request, response) => {
      const capabilityId = String(request.params.capId || '').trim();
      if (!capabilityId) {
        response.status(400).json({ error: 'capabilityId is required.' });
        return;
      }
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'chat.read',
        });
        const directory = await buildAuthorizedParticipantDirectory({
          anchorCapabilityId: capabilityId,
          actor,
        });
        response.json(directory);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // POST /api/runtime/chat/swarm — kickoff
  app.post('/api/runtime/chat/swarm', async (request, response) => {
    const body = request.body as KickoffBody;

    const validation = validateKickoffBody(body);
    if (validation.ok !== true) {
      response.status(validation.status).json({ error: validation.message });
      return;
    }

    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: body.capabilityId!,
        actor,
        action: 'chat.write',
      });
      const sessionScope =
        body.sessionScope || (body.workItemId ? 'WORK_ITEM' : 'GENERAL_CHAT');

      const recentStarts = registerStartForRateLimit(
        actor.userId ||
          parseActor(
            request.headers['x-singularity-actor-user-id'],
            actor.displayName || 'anonymous',
          ),
      );
      if (recentStarts > SWARM_QUOTA_MAX) {
        response.status(429).json({
          error: `Per-user swarm quota exceeded (${SWARM_QUOTA_MAX}/hour).`,
        });
        return;
      }

      const existing = await findOpenSwarmSessionForScope(
        body.capabilityId!,
        sessionScope,
        body.workItemId || null,
      );
      if (existing) {
        response.status(409).json({
          error: 'A swarm debate is already in progress for this scope.',
          sessionId: existing.id,
        });
        return;
      }

      const rosterResult = await resolveParticipantRoster(body, actor);
      if (rosterResult.ok !== true) {
        response.status(rosterResult.status).json({
          error: rosterResult.message,
        });
        return;
      }

      let detail: SwarmSessionDetail;
      detail = await createSwarmSession({
        capabilityId: body.capabilityId!,
        workItemId: body.workItemId || undefined,
        sessionScope,
        initiatorUserId: actor.userId,
        initiatingPrompt: body.initiatingPrompt!.trim(),
        maxTokenBudget: Math.max(
          10_000,
          Number(body.maxTokenBudget) || DEFAULT_MAX_TOKEN_BUDGET,
        ),
        participants: rosterResult.roster,
      });

      // Fire the orchestrator but don't block the response. Any fatal error
      // gets surfaced via publishSwarmStreamEvent + status update so reconnecting
      // clients see it, and logged on the server.
      const sessionId = detail.session.id;
      cancellationFlags.set(sessionId, false);
      queueMicrotask(() => {
        runSwarmDebate({
          capabilityId: body.capabilityId!,
          sessionId,
          cancelled: () => cancellationFlags.get(sessionId) === true,
        }).catch(async error => {
          // eslint-disable-next-line no-console
          console.error('[swarm] debate failed', error);
          try {
            await updateSwarmSessionStatus({
              capabilityId: body.capabilityId!,
              sessionId,
              status: 'NO_CONSENSUS',
              terminalReason: 'NO_CONSENSUS',
              completed: true,
            });
          } catch {
            // Swallow: the original error is the real signal.
          }
          publishSwarmStreamEvent(sessionId, {
            kind: 'terminal',
            sessionId,
            status: 'NO_CONSENSUS',
            terminalReason: 'NO_CONSENSUS',
          });
        });
      });

      response.status(202).json({
        sessionId,
        session: detail.session,
        participants: detail.participants,
        voteTool: SWARM_VOTE_TOOL_META,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const sessionScope =
          body.sessionScope || (body.workItemId ? 'WORK_ITEM' : 'GENERAL_CHAT');
        const existing = await findOpenSwarmSessionForScope(
          body.capabilityId!,
          sessionScope,
          body.workItemId || null,
        );
        response.status(409).json({
          error: 'A swarm debate is already in progress for this scope.',
          sessionId: existing?.id,
        });
        return;
      }
      sendApiError(response, error);
      return;
    }
  });

  // GET /api/runtime/chat/swarm/stream?sessionId=...
  app.get('/api/runtime/chat/swarm/stream', async (request, response) => {
    const sessionId = String(request.query.sessionId || '').trim();
    const capabilityId = String(request.query.capabilityId || '').trim();
    if (!sessionId || !capabilityId) {
      response.status(400).json({
        error: 'sessionId and capabilityId query parameters are required.',
      });
      return;
    }

    // Confirm session exists up front so we fail fast.
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId,
        actor,
        action: 'chat.read',
      });
      await loadSwarmSessionDetail(capabilityId, sessionId);
    } catch (error) {
      sendApiError(response, error);
      return;
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    const emit = (event: SwarmStreamEvent) => {
      writeSseEvent(response, event.kind, event);
    };

    const unsubscribe = subscribeToSwarmStream(sessionId, emit);

    // Heartbeat every 20s so intermediaries don't close the connection.
    const heartbeat = setInterval(() => {
      response.write(': heartbeat\n\n');
    }, 20_000);

    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
      response.end();
    };

    request.on('close', close);
    request.on('aborted', close);
  });

  // GET /api/capabilities/:capId/swarm-sessions/:id
  app.get(
    '/api/capabilities/:capId/swarm-sessions/:id',
    async (request, response) => {
      const capabilityId = String(request.params.capId || '').trim();
      const sessionId = String(request.params.id || '').trim();
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'chat.read',
        });
        const detail = await loadSwarmSessionDetail(capabilityId, sessionId);
        response.json(detail);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // GET /api/capabilities/:capId/work-items/:workItemId/swarm-sessions
  app.get(
    '/api/capabilities/:capId/work-items/:workItemId/swarm-sessions',
    async (request, response) => {
      const capabilityId = String(request.params.capId || '').trim();
      const workItemId = String(request.params.workItemId || '').trim();
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'chat.read',
        });
        const sessions = await listRecentSwarmSessionsForWorkItem(
          capabilityId,
          workItemId,
        );
        response.json({ sessions });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // POST /api/capabilities/:capId/swarm-sessions/:id/review
  app.post(
    '/api/capabilities/:capId/swarm-sessions/:id/review',
    async (request, response) => {
      const capabilityId = String(request.params.capId || '').trim();
      const sessionId = String(request.params.id || '').trim();
      const body = request.body as {
        decision?: 'APPROVE' | 'REJECT';
        comment?: string;
      };
      const decision = body.decision;
      if (decision !== 'APPROVE' && decision !== 'REJECT') {
        response.status(400).json({
          error: "decision must be 'APPROVE' or 'REJECT'.",
        });
        return;
      }

      let detail: SwarmSessionDetail;
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.edit',
        });
        detail = await loadSwarmSessionDetail(capabilityId, sessionId);
      } catch (error) {
        sendApiError(response, error);
        return;
      }

      if (detail.session.status !== 'AWAITING_REVIEW') {
        response.status(409).json({
          error: `Session must be in AWAITING_REVIEW to be reviewed (current: ${detail.session.status}).`,
        });
        return;
      }

      const terminalStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await updateSwarmSessionStatus({
        capabilityId,
        sessionId,
        status: terminalStatus,
        completed: true,
      });

      // Record reviewer comment on the produced artifact (if any) as a side
      // note — we update the description rather than creating a new artifact
      // so the reviewer's context lives alongside the plan.
      if (detail.producedArtifactId && body.comment) {
        await query(
          `
            UPDATE capability_artifacts
            SET description = COALESCE(description, '')
              || E'\n\nReviewer comment: ' || $3,
                updated_at = NOW()
            WHERE capability_id = $1 AND id = $2
          `,
          [capabilityId, detail.producedArtifactId, body.comment],
        );
      }

      const refreshed = await loadSwarmSessionDetail(capabilityId, sessionId);
      response.json(refreshed);
    },
  );

  // POST /api/capabilities/:capId/swarm-sessions/:id/promote-to-work-item
  app.post(
    '/api/capabilities/:capId/swarm-sessions/:id/promote-to-work-item',
    async (request, response) => {
      const capabilityId = String(request.params.capId || '').trim();
      const sessionId = String(request.params.id || '').trim();
      const body = request.body as {
        title?: string;
        brief?: string;
      };
      let detail: SwarmSessionDetail;
      let actor: ReturnType<typeof parseActorContext>;

      try {
        actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'workitem.create',
        });
        detail = await loadSwarmSessionDetail(capabilityId, sessionId);
      } catch (error) {
        sendApiError(response, error);
        return;
      }

      if (detail.session.sessionScope !== 'GENERAL_CHAT') {
        response.status(409).json({
          error: 'Only GENERAL_CHAT swarm sessions can be promoted to work items.',
        });
        return;
      }
      if (
        detail.session.status !== 'AWAITING_REVIEW' &&
        detail.session.status !== 'APPROVED'
      ) {
        response.status(409).json({
          error: `Session must be AWAITING_REVIEW or APPROVED (current: ${detail.session.status}).`,
        });
        return;
      }
      if (detail.session.promotedWorkItemId) {
        response.status(409).json({
          error: `Session already promoted to ${detail.session.promotedWorkItemId}.`,
        });
        return;
      }

      try {
        const bundle = await getCapabilityBundle(capabilityId);
        const workflowId = bundle.workspace.workflows[0]?.id;
        if (!workflowId) {
          throw new Error(
            `Capability ${capabilityId} does not have a default workflow for promoted work.`,
          );
        }

        const createdWorkItem = await createWorkItemRecord({
          capabilityId,
          title:
            body.title?.trim() || `Swarm-approved plan (${detail.session.id})`,
          description:
            body.brief?.trim() || detail.session.initiatingPrompt,
          workflowId,
          taskType: 'GENERAL',
          priority: 'Med',
          tags: [],
          actor,
        });

        await markSwarmSessionPromoted({
          capabilityId,
          sessionId,
          workItemId: createdWorkItem.id,
        });

        response.status(201).json({
          workItem: createdWorkItem,
          swarmSessionId: detail.session.id,
          linkedArtifactId: detail.producedArtifactId,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'This swarm session could not be promoted.';
        if (/already been promoted/i.test(message)) {
          response.status(409).json({
            error: message,
          });
          return;
        }
        sendApiError(response, error);
      }
    },
  );

  // POST /api/capabilities/:capId/swarm-sessions/:id/cancel
  app.post(
    '/api/capabilities/:capId/swarm-sessions/:id/cancel',
    async (request, response) => {
      const capabilityId = String(request.params.capId || '').trim();
      const sessionId = String(request.params.id || '').trim();

      let detail: SwarmSessionDetail;
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'chat.write',
        });
        detail = await loadSwarmSessionDetail(capabilityId, sessionId);
      } catch (error) {
        sendApiError(response, error);
        return;
      }

      if (
        detail.session.status === 'APPROVED' ||
        detail.session.status === 'REJECTED' ||
        detail.session.status === 'CANCELLED' ||
        detail.session.status === 'NO_CONSENSUS' ||
        detail.session.status === 'BUDGET_EXHAUSTED'
      ) {
        response.status(409).json({
          error: `Session already terminal (${detail.session.status}).`,
        });
        return;
      }

      cancellationFlags.set(sessionId, true);
      await updateSwarmSessionStatus({
        capabilityId,
        sessionId,
        status: 'CANCELLED',
        terminalReason: 'CANCELLED',
        completed: true,
      });
      publishSwarmStreamEvent(sessionId, {
        kind: 'terminal',
        sessionId,
        status: 'CANCELLED',
        terminalReason: 'CANCELLED',
      });
      response.status(202).json({ ok: true });
    },
  );
};
