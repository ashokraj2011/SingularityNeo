/**
 * Bell-icon notifications REST.
 *
 * Reads from the existing `notifications` table (see server/db.ts).
 * Operator identity comes from the `x-singularity-actor-user-id`
 * header — same shape every other route in this codebase uses.
 *
 * Three endpoints:
 *
 *   GET   /api/notifications?unread=true&limit=100   list for the
 *           current operator. unread=true is the default so the
 *           bell badge query stays cheap.
 *   POST  /api/notifications/:id/ack                 mark single ack.
 *   POST  /api/notifications/ack-all                 mark all unread
 *           for the operator as ack'd. Returns count.
 *
 * No write endpoints — notifications are inserted by
 * notificationDispatcher (which is called from the sweep worker and
 * from agent-workflow alert nodes). The bell only reads + ack's.
 */

import type express from "express";
import { query } from "../db";
import { sendApiError } from "../api/errors";

interface NotificationRow {
  id: string;
  user_id: string | null;
  run_id: string | null;
  capability_id: string | null;
  node_id: string | null;
  severity: string;
  message: string;
  acknowledged: boolean;
  created_at: string;
  business_instance_id: string | null;
}

const trim = (value: unknown): string => String(value ?? "").trim();

const resolveUserId = (request: express.Request): string => {
  const userId = trim(request.header("x-singularity-actor-user-id"));
  return userId || "anonymous-operator";
};

/**
 * Camel-case shape sent to the renderer. Aligns with conventions
 * used by other Business Workflow API responses.
 */
interface NotificationDto {
  id: string;
  userId: string | null;
  runId: string | null;
  capabilityId: string | null;
  nodeId: string | null;
  severity: string;
  message: string;
  acknowledged: boolean;
  createdAt: string;
  businessInstanceId: string | null;
}

const rowToDto = (row: NotificationRow): NotificationDto => {
  // node-postgres returns timestamptz as Date — coerce defensively
  // since the row type is a structural string for the rest of the
  // pipeline.
  const createdAt = row.created_at as unknown;
  return {
    id: row.id,
    userId: row.user_id,
    runId: row.run_id,
    capabilityId: row.capability_id,
    nodeId: row.node_id,
    severity: row.severity,
    message: row.message,
    acknowledged: row.acknowledged,
    createdAt:
      createdAt instanceof Date
        ? createdAt.toISOString()
        : String(createdAt),
    businessInstanceId: row.business_instance_id,
  };
};

export const registerNotificationRoutes = (app: express.Express): void => {
  app.get("/api/notifications", async (request, response) => {
    try {
      const userId = resolveUserId(request);
      const unreadOnly =
        String(request.query.unread ?? "true").toLowerCase() !== "false";
      const limit = Math.max(
        1,
        Math.min(500, Number(request.query.limit) || 100),
      );
      // The existing index is on (user_id, acknowledged, created_at
      // DESC). Bell badge query hits it directly.
      //
      // NULL user_id rows (system-wide) are surfaced to everyone —
      // useful for "broadcast" notifications, and matches what
      // notificationDispatcher inserts when the alert config has no
      // resolved recipients.
      const params: unknown[] = [userId];
      let where = "WHERE (user_id = $1 OR user_id IS NULL)";
      if (unreadOnly) {
        where += " AND acknowledged = FALSE";
      }
      params.push(limit);
      const result = await query<NotificationRow>(
        `
        SELECT * FROM notifications
        ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length}
        `,
        params,
      );
      response.json({
        notifications: result.rows.map(rowToDto),
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post(
    "/api/notifications/:id/ack",
    async (request, response) => {
      try {
        const userId = resolveUserId(request);
        // The user can ack only their own (or NULL = broadcast)
        // notifications. Unauthorised attempts return a 0-row update
        // which we surface as 404 so we don't leak presence info.
        const result = await query<{ id: string }>(
          `
          UPDATE notifications
          SET acknowledged = TRUE
          WHERE id = $1
            AND (user_id = $2 OR user_id IS NULL)
            AND acknowledged = FALSE
          RETURNING id
          `,
          [trim(request.params.id), userId],
        );
        if (result.rows.length === 0) {
          response.status(404).json({ error: "Notification not found" });
          return;
        }
        response.json({ ok: true });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post("/api/notifications/ack-all", async (request, response) => {
    try {
      const userId = resolveUserId(request);
      const result = await query<{ id: string }>(
        `
        UPDATE notifications
        SET acknowledged = TRUE
        WHERE (user_id = $1 OR user_id IS NULL)
          AND acknowledged = FALSE
        RETURNING id
        `,
        [userId],
      );
      response.json({ ok: true, count: result.rows.length });
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
