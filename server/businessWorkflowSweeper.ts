/**
 * Business workflow sweep worker.
 *
 * Two responsibilities, run every SWEEP_INTERVAL_MS (default 30s):
 *
 *   1. sweepDueTimers — drains capability_business_scheduled_timers
 *      where fire_at <= NOW() AND fired_at IS NULL AND
 *      cancelled_at IS NULL. For each:
 *        - emits ATTACHED_TIMER_FIRED on the events log
 *        - applies the action (NOTIFY / ESCALATE / AUTO_COMPLETE)
 *        - stamps fired_at so the row is never re-fired.
 *
 *   2. sweepOverdueTasks — finds tasks in OPEN/CLAIMED/IN_PROGRESS
 *      whose due_at < NOW() AND overdue_notified_at IS NULL. For
 *      each, scans the pinned version's node config for
 *      attachments whose trigger is ON_OVERDUE and fires them.
 *      Stamps overdue_notified_at so the same task isn't re-flagged
 *      every tick.
 *
 * Multi-process safe: SELECT … FOR UPDATE SKIP LOCKED ensures two
 * workers never grab the same row. Singularity is single-process
 * today; defence in depth.
 *
 * Boots from server/app/startServer.ts. Cleans up via the returned
 * Disposable so tests can stop it.
 *
 * V2.1 limits (called out so they don't surprise readers):
 *   - Recipient strings are passed through to dispatchAlert as-is.
 *     Role / team expansion (e.g. "role:OPERATOR" → list of user
 *     emails) is V2.2.
 *   - Message templates are literal — no ${context.foo} substitution.
 *   - On error, the row stays unfired and we log; the next sweep
 *     retries. No exponential backoff.
 */

import { query, transaction } from "./db";
import {
  dispatchAlert,
  type AlertContext,
} from "./lib/notificationDispatcher";
import type { WorkflowAlertConfig } from "../src/types";
import type {
  BusinessAttachment,
  BusinessNode,
  BusinessWorkflowVersion,
} from "../src/contracts/businessWorkflow";

const SWEEP_INTERVAL_MS = (() => {
  const parsed = Number(process.env.BUSINESS_WORKFLOW_SWEEP_INTERVAL_MS);
  if (Number.isFinite(parsed) && parsed >= 1000) return parsed;
  return 30_000;
})();

let runningHandle: NodeJS.Timeout | null = null;

interface ScheduledTimerRow {
  id: string;
  capability_id: string;
  instance_id: string;
  node_id: string;
  attachment_id: string;
  fire_at: string;
  action: string;
  channel: string | null;
  recipients: string[];
  message: string | null;
  escalate_to_user_id: string | null;
  escalate_to_role: string | null;
}

const asArray = <T>(value: unknown): T[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

// ── Per-tick orchestration ───────────────────────────────────────────────────

const sweepTick = async (): Promise<void> => {
  try {
    await sweepDueTimers();
  } catch (err) {
    console.error("[businessWorkflowSweeper] sweepDueTimers failed:", err);
  }
  try {
    await sweepOverdueTasks();
  } catch (err) {
    console.error("[businessWorkflowSweeper] sweepOverdueTasks failed:", err);
  }
};

// ── Timer fires ──────────────────────────────────────────────────────────────

const sweepDueTimers = async (): Promise<void> => {
  // Wrap the SELECT … FOR UPDATE in a transaction so the lock holds
  // across the per-row work. SKIP LOCKED means a second worker
  // grabs the next row instead of waiting; we never double-fire.
  await transaction(async (client) => {
    const result = await client.query<ScheduledTimerRow>(
      `
      SELECT id, capability_id, instance_id, node_id, attachment_id,
             fire_at, action, channel, recipients, message,
             escalate_to_user_id, escalate_to_role
      FROM capability_business_scheduled_timers
      WHERE fire_at <= NOW()
        AND fired_at IS NULL
        AND cancelled_at IS NULL
      ORDER BY fire_at ASC
      LIMIT 50
      FOR UPDATE SKIP LOCKED
      `,
    );
    if (result.rows.length === 0) return;

    for (const row of result.rows) {
      const r: ScheduledTimerRow = {
        ...row,
        recipients: asArray<string>(
          (row as unknown as { recipients: unknown }).recipients,
        ),
      };
      try {
        await fireOneTimer(r);
      } catch (err) {
        console.error(
          `[businessWorkflowSweeper] fireOneTimer ${r.id} failed:`,
          err,
        );
        // Don't stamp fired_at — the next tick retries.
        continue;
      }
      await client.query(
        `UPDATE capability_business_scheduled_timers
         SET fired_at = NOW()
         WHERE id = $1`,
        [r.id],
      );
    }
  });
};

const fireOneTimer = async (row: ScheduledTimerRow): Promise<void> => {
  // Lazy-import the engine to avoid an import cycle (engine imports
  // helpers from src/lib; sweeper now imports the engine).
  const engine = await import("./businessWorkflows");

  // Emit the audit event regardless of action outcome — the timeline
  // should always say "the timer fired."
  await emitEventCompat({
    capabilityId: row.capability_id,
    instanceId: row.instance_id,
    nodeId: row.node_id,
    eventType: "ATTACHED_TIMER_FIRED",
    payload: {
      timerRowId: row.id,
      attachmentId: row.attachment_id,
      action: row.action,
      channel: row.channel,
      recipients: row.recipients,
      message: row.message,
    },
    actorId: "system:sweeper",
  });

  switch (row.action) {
    case "NOTIFY": {
      const config: WorkflowAlertConfig = {
        severity: "INFO",
        channel:
          (row.channel as WorkflowAlertConfig["channel"]) || "IN_APP",
        recipients: row.recipients,
        messageTemplate:
          row.message || `Timer fired on node ${row.node_id}`,
      };
      const ctx: AlertContext = {
        workflowName: "Business workflow",
        capabilityId: row.capability_id,
        runId: row.instance_id, // dispatcher's existing field; we
        // also send the new businessInstanceId for the IN_APP insert.
        nodeId: row.node_id,
        resolvedRecipients: [],
        businessInstanceId: row.instance_id,
      };
      await dispatchAlert(config, ctx);
      return;
    }
    case "ESCALATE": {
      // Re-load the underlying task at this node, then reassign it.
      // The simplest "escalate" semantic: clear claim, retarget
      // assignment to the configured user / role. The existing
      // reassign helper handles releasing the claim + emitting
      // TASK_REASSIGNED.
      const task = await loadOpenTaskForNode(
        row.capability_id,
        row.instance_id,
        row.node_id,
      );
      if (!task) {
        console.warn(
          `[businessWorkflowSweeper] timer ${row.id} ESCALATE — no open task on node ${row.node_id}`,
        );
        return;
      }
      const mode = row.escalate_to_user_id
        ? ("DIRECT_USER" as const)
        : row.escalate_to_role
          ? ("ROLE_BASED" as const)
          : null;
      if (!mode) {
        console.warn(
          `[businessWorkflowSweeper] timer ${row.id} ESCALATE — neither user nor role configured`,
        );
        return;
      }
      await engine.reassignBusinessTask({
        capabilityId: row.capability_id,
        taskId: task.id,
        actorId: "system:sweeper",
        assignmentMode: mode,
        assignedUserId: row.escalate_to_user_id || undefined,
        assignedRole: row.escalate_to_role || undefined,
        reason: `Timer escalation${row.message ? `: ${row.message}` : ""}`,
      });
      return;
    }
    case "AUTO_COMPLETE": {
      const task = await loadOpenTaskForNode(
        row.capability_id,
        row.instance_id,
        row.node_id,
      );
      if (!task) {
        console.warn(
          `[businessWorkflowSweeper] timer ${row.id} AUTO_COMPLETE — no open task on node ${row.node_id}`,
        );
        return;
      }
      await engine.completeBusinessTask({
        capabilityId: row.capability_id,
        taskId: task.id,
        completedBy: "system:sweeper",
        formData: { __auto_complete_reason: row.message || "timer fired" },
      });
      return;
    }
    default:
      console.warn(
        `[businessWorkflowSweeper] timer ${row.id} unknown action: ${row.action}`,
      );
  }
};

// ── Overdue task notifications ───────────────────────────────────────────────

interface OverdueTaskRow {
  id: string;
  capability_id: string;
  instance_id: string;
  node_id: string;
  template_id: string;
  template_version: number;
}

const sweepOverdueTasks = async (): Promise<void> => {
  // UPDATE … RETURNING atomically claims the rows we'll process —
  // duplicate sweeps just see no rows on the second attempt because
  // overdue_notified_at is now NOT NULL for these tasks. The join
  // pulls in the template + version so we don't need a per-row
  // follow-up query for the node config.
  const result = await query<OverdueTaskRow>(
    `
    UPDATE capability_business_tasks AS t
    SET overdue_notified_at = NOW()
    FROM capability_business_workflow_instances AS i
    WHERE i.capability_id = t.capability_id
      AND i.id = t.instance_id
      AND t.status IN ('OPEN','CLAIMED','IN_PROGRESS')
      AND t.due_at IS NOT NULL
      AND t.due_at < NOW()
      AND t.overdue_notified_at IS NULL
    RETURNING t.id, t.capability_id, t.instance_id, t.node_id,
              i.template_id, i.template_version
    `,
  );

  if (!result.rows || result.rows.length === 0) return;

  for (const row of result.rows) {
    try {
      await fireOverdueAttachments(row);
    } catch (err) {
      console.error(
        `[businessWorkflowSweeper] fireOverdueAttachments task ${row.id} failed:`,
        err,
      );
      // We've already stamped overdue_notified_at — don't infinite-
      // loop on a broken attachment config. Operator can re-trigger
      // by editing the node + re-publishing.
    }
  }
};

const fireOverdueAttachments = async (row: OverdueTaskRow): Promise<void> => {
  const versionResult = await query<{ nodes: BusinessNode[] }>(
    `SELECT nodes FROM capability_business_workflow_template_versions
     WHERE capability_id = $1 AND template_id = $2 AND version = $3`,
    [row.capability_id, row.template_id, row.template_version],
  );
  if (versionResult.rows.length === 0) return;
  const versionRow = versionResult.rows[0] as unknown as {
    nodes: BusinessWorkflowVersion["nodes"];
  };
  const nodes = Array.isArray(versionRow.nodes)
    ? versionRow.nodes
    : asArray<BusinessNode>(versionRow.nodes);
  const node = nodes.find((n: BusinessNode) => n.id === row.node_id);
  if (!node) return;
  const attachments: BusinessAttachment[] = node.config?.attachments || [];

  for (const att of attachments) {
    if (!att.enabled) continue;
    if (att.type !== "NOTIFICATION") continue;
    if (att.trigger !== "ON_OVERDUE") continue;
    const config: WorkflowAlertConfig = {
      severity: "WARNING",
      channel: (att.channel as WorkflowAlertConfig["channel"]) || "IN_APP",
      recipients: att.recipients || [],
      messageTemplate:
        att.message ||
        `Task overdue on node ${node.label || node.id}`,
    };
    const ctx: AlertContext = {
      workflowName: "Business workflow",
      capabilityId: row.capability_id,
      runId: row.instance_id,
      nodeId: row.node_id,
      resolvedRecipients: [],
      businessInstanceId: row.instance_id,
    };
    await dispatchAlert(config, ctx);
    await emitEventCompat({
      capabilityId: row.capability_id,
      instanceId: row.instance_id,
      nodeId: row.node_id,
      eventType: "ATTACHED_NOTIFICATION_SENT",
      payload: {
        attachmentId: att.id,
        label: att.label,
        channel: att.channel,
        recipients: att.recipients,
        message: att.message,
        trigger: "ON_OVERDUE",
      },
      actorId: "system:sweeper",
    });
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const loadOpenTaskForNode = async (
  capabilityId: string,
  instanceId: string,
  nodeId: string,
): Promise<{ id: string } | null> => {
  const result = await query<{ id: string }>(
    `SELECT id FROM capability_business_tasks
     WHERE capability_id = $1 AND instance_id = $2 AND node_id = $3
       AND status IN ('OPEN','CLAIMED','IN_PROGRESS')
     ORDER BY created_at DESC
     LIMIT 1`,
    [capabilityId, instanceId, nodeId],
  );
  return result.rows[0] || null;
};

/**
 * The engine's emitEvent helper is module-private. We don't want to
 * widen its visibility just for the sweeper, so we INSERT directly
 * here. Schema matches the engine — the events log accepts the same
 * shape from any caller.
 */
const emitEventCompat = async (args: {
  capabilityId: string;
  instanceId: string;
  nodeId?: string;
  eventType: string;
  payload?: Record<string, unknown>;
  actorId?: string;
}): Promise<void> => {
  const id = `BWE-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
  await query(
    `
    INSERT INTO capability_business_workflow_events
      (id, capability_id, instance_id, node_id, event_type, payload, actor_id)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
    `,
    [
      id,
      args.capabilityId,
      args.instanceId,
      args.nodeId || null,
      args.eventType,
      JSON.stringify(args.payload || {}),
      args.actorId || null,
    ],
  );
};

// ── Boot / shutdown ──────────────────────────────────────────────────────────

export const startBusinessWorkflowSweeper = (): void => {
  if (runningHandle) return; // idempotent — startServer can call twice in tests
  console.log(
    `[businessWorkflowSweeper] starting (interval=${SWEEP_INTERVAL_MS}ms)`,
  );
  // First tick a beat after boot so we don't slow startup.
  runningHandle = setInterval(() => {
    void sweepTick();
  }, SWEEP_INTERVAL_MS);
};

export const stopBusinessWorkflowSweeper = (): void => {
  if (!runningHandle) return;
  clearInterval(runningHandle);
  runningHandle = null;
};
