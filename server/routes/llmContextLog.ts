/**
 * LLM context log routes — read-only endpoints powering the operator's
 * "View context" drawer.
 *
 *   GET /api/capabilities/:capabilityId/llm-context-log
 *       List recent chat-mode context-log entries for the capability
 *       (most-recent first). Supports `?workItemId=X&limit=N`.
 *
 *   GET /api/capabilities/:capabilityId/llm-context-log/:entryId
 *       Fetch one entry's full body — messages[] + budget receipt.
 *
 *   GET /api/capabilities/:capabilityId/llm-context-log/by-trace/:traceId
 *       Fetch the latest entry matching a chat traceId. Used by the
 *       cockpit timeline's "View context for this turn" affordance.
 *
 * Execution-mode (workflow run) prompts live on `LLM_CONTEXT_PREPARED`
 * RunEvents — fetched via the existing run-events endpoint, not here.
 */

import type express from "express";
import {
  fetchContextLogEntry,
  fetchContextLogEntryByTraceId,
  listRecentContextLogEntries,
} from "../llmContextLog";
import { sendApiError } from "../api/errors";

export const registerLlmContextLogRoutes = (app: express.Express) => {
  app.get(
    "/api/capabilities/:capabilityId/llm-context-log",
    async (request, response) => {
      try {
        const capabilityId = String(request.params.capabilityId || "").trim();
        if (!capabilityId) {
          response.status(400).json({ error: "capabilityId is required." });
          return;
        }
        const workItemId =
          String(request.query.workItemId || "").trim() || undefined;
        const limitRaw = Number(request.query.limit || 50);
        const limit = Number.isFinite(limitRaw)
          ? Math.max(1, Math.min(500, limitRaw))
          : 50;
        const entries = await listRecentContextLogEntries({
          capabilityId,
          workItemId,
          limit,
        });
        response.json({ entries });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/llm-context-log/by-trace/:traceId",
    async (request, response) => {
      try {
        const capabilityId = String(request.params.capabilityId || "").trim();
        const traceId = String(request.params.traceId || "").trim();
        if (!capabilityId || !traceId) {
          response.status(400).json({ error: "capabilityId and traceId required." });
          return;
        }
        const entry = await fetchContextLogEntryByTraceId({
          capabilityId,
          traceId,
        });
        if (!entry) {
          response.status(404).json({ error: "Context log entry not found." });
          return;
        }
        response.json({ entry });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/llm-context-log/:entryId",
    async (request, response) => {
      try {
        const capabilityId = String(request.params.capabilityId || "").trim();
        const entryId = String(request.params.entryId || "").trim();
        if (!capabilityId || !entryId) {
          response.status(400).json({ error: "capabilityId and entryId required." });
          return;
        }
        const entry = await fetchContextLogEntry({ capabilityId, entryId });
        if (!entry) {
          response.status(404).json({ error: "Context log entry not found." });
          return;
        }
        response.json({ entry });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );
};
