/**
 * Business Workflow REST routes.
 *
 * Designer-time:
 *   GET    /api/capabilities/:capId/business-workflows
 *   POST   /api/capabilities/:capId/business-workflows
 *   GET    /api/capabilities/:capId/business-workflows/:id
 *   PATCH  /api/capabilities/:capId/business-workflows/:id
 *   DELETE /api/capabilities/:capId/business-workflows/:id              (archive)
 *   POST   /api/capabilities/:capId/business-workflows/:id/publish
 *   GET    /api/capabilities/:capId/business-workflows/:id/versions
 *
 * Runtime:
 *   POST   /api/capabilities/:capId/business-workflows/:id/instances
 *   GET    /api/capabilities/:capId/business-instances/:instanceId
 *   POST   /api/capabilities/:capId/business-instances/:instanceId/cancel
 *   GET    /api/capabilities/:capId/business-instances/:instanceId/events
 *
 *   GET    /api/capabilities/:capId/business-tasks
 *   POST   /api/capabilities/:capId/business-tasks/:taskId/claim
 *   POST   /api/capabilities/:capId/business-tasks/:taskId/complete
 *
 *   GET    /api/capabilities/:capId/business-approvals/:approvalId
 *   POST   /api/capabilities/:capId/business-approvals/:approvalId/decide
 */

import type express from "express";
import {
  addInstanceNote,
  aggregateBusinessTemplateStats,
  archiveBusinessTemplate,
  cancelBusinessInstance,
  claimBusinessTask,
  completeBusinessTask,
  createAdHocTask,
  createBusinessTemplate,
  decideBusinessApproval,
  deleteBusinessCustomNodeType,
  fetchBusinessApproval,
  fetchBusinessTemplate,
  getBusinessInstance,
  listBusinessApprovals,
  listBusinessCustomNodeTypes,
  listBusinessInstanceEvents,
  listBusinessInstances,
  listBusinessTasks,
  listBusinessTemplateVersions,
  listBusinessTemplates,
  pauseBusinessInstance,
  publishBusinessTemplate,
  reassignBusinessApproval,
  reassignBusinessTask,
  resumeBusinessInstance,
  saveBusinessTemplateDraft,
  sendBackBusinessApproval,
  sendBackBusinessTask,
  startBusinessInstance,
  upsertBusinessCustomNodeType,
} from "../businessWorkflows";
import { sendApiError } from "../api/errors";
import type {
  ApprovalStatus,
  AssignmentMode,
  BusinessInstanceStatus,
  FormSchema,
  TaskPriority,
  TaskStatus,
} from "../../src/contracts/businessWorkflow";

const trim = (value: unknown): string => String(value ?? "").trim();

const resolveActor = (
  request: express.Request,
): { id: string; displayName: string } => {
  const userId =
    String(request.header("x-singularity-actor-user-id") || "").trim() ||
    "anonymous-operator";
  const displayName =
    String(request.header("x-singularity-actor-display-name") || "").trim() ||
    "Operator";
  return { id: userId, displayName };
};

export const registerBusinessWorkflowRoutes = (app: express.Express) => {
  // ── Designer-time: templates ───────────────────────────────────────────

  app.get(
    "/api/capabilities/:capabilityId/business-workflows",
    async (request, response) => {
      try {
        const capabilityId = trim(request.params.capabilityId);
        const templates = await listBusinessTemplates(capabilityId);
        response.json({ templates });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/business-workflows",
    async (request, response) => {
      try {
        const capabilityId = trim(request.params.capabilityId);
        const body = (request.body || {}) as {
          name?: string;
          description?: string;
        };
        if (!body.name?.trim()) {
          response.status(400).json({ error: "name is required" });
          return;
        }
        const template = await createBusinessTemplate({
          capabilityId,
          name: body.name,
          description: body.description,
        });
        response.json({ template });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/business-workflows/:id",
    async (request, response) => {
      try {
        const capabilityId = trim(request.params.capabilityId);
        const id = trim(request.params.id);
        const template = await fetchBusinessTemplate(capabilityId, id);
        if (!template) {
          response.status(404).json({ error: "Template not found" });
          return;
        }
        const versions = await listBusinessTemplateVersions(capabilityId, id);
        response.json({ template, versions });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.patch(
    "/api/capabilities/:capabilityId/business-workflows/:id",
    async (request, response) => {
      try {
        const capabilityId = trim(request.params.capabilityId);
        const id = trim(request.params.id);
        const body = (request.body || {}) as Record<string, unknown>;
        const template = await saveBusinessTemplateDraft({
          capabilityId,
          templateId: id,
          name: typeof body.name === "string" ? body.name : undefined,
          description:
            typeof body.description === "string" ? body.description : undefined,
          draftNodes: Array.isArray(body.draftNodes)
            ? (body.draftNodes as never)
            : undefined,
          draftEdges: Array.isArray(body.draftEdges)
            ? (body.draftEdges as never)
            : undefined,
          draftPhases: Array.isArray(body.draftPhases)
            ? (body.draftPhases as never)
            : undefined,
          metadata:
            body.metadata && typeof body.metadata === "object"
              ? (body.metadata as Record<string, unknown>)
              : undefined,
        });
        if (!template) {
          response.status(404).json({ error: "Template not found" });
          return;
        }
        response.json({ template });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.delete(
    "/api/capabilities/:capabilityId/business-workflows/:id",
    async (request, response) => {
      try {
        await archiveBusinessTemplate(
          trim(request.params.capabilityId),
          trim(request.params.id),
        );
        response.json({ ok: true });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/business-workflows/:id/publish",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const version = await publishBusinessTemplate({
          capabilityId: trim(request.params.capabilityId),
          templateId: trim(request.params.id),
          publishedBy: actor.displayName,
        });
        if (!version) {
          response.status(404).json({ error: "Template not found" });
          return;
        }
        response.json({ version });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/business-workflows/:id/versions",
    async (request, response) => {
      try {
        const versions = await listBusinessTemplateVersions(
          trim(request.params.capabilityId),
          trim(request.params.id),
        );
        response.json({ versions });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // ── Runtime: instances ─────────────────────────────────────────────────

  app.post(
    "/api/capabilities/:capabilityId/business-workflows/:id/instances",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const body = (request.body || {}) as {
          context?: Record<string, unknown>;
        };
        const instance = await startBusinessInstance({
          capabilityId: trim(request.params.capabilityId),
          templateId: trim(request.params.id),
          startedBy: actor.displayName,
          contextOverrides: body.context,
        });
        response.json({ instance });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/business-instances/:instanceId",
    async (request, response) => {
      try {
        const capabilityId = trim(request.params.capabilityId);
        const instanceId = trim(request.params.instanceId);
        const instance = await getBusinessInstance(capabilityId, instanceId);
        if (!instance) {
          response.status(404).json({ error: "Instance not found" });
          return;
        }
        const events = await listBusinessInstanceEvents(capabilityId, instanceId);
        response.json({ instance, events });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/business-instances/:instanceId/cancel",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const instance = await cancelBusinessInstance({
          capabilityId: trim(request.params.capabilityId),
          instanceId: trim(request.params.instanceId),
          actorId: actor.displayName,
        });
        if (!instance) {
          response.status(404).json({ error: "Instance not found" });
          return;
        }
        response.json({ instance });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/business-instances/:instanceId/events",
    async (request, response) => {
      try {
        // Optional `?since=<eventId>` so the dashboard polls deltas.
        const sinceEventId = trim(request.query.since) || undefined;
        const events = await listBusinessInstanceEvents(
          trim(request.params.capabilityId),
          trim(request.params.instanceId),
          { sinceEventId },
        );
        response.json({ events });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // ── Tasks ──────────────────────────────────────────────────────────────

  app.get(
    "/api/capabilities/:capabilityId/business-tasks",
    async (request, response) => {
      try {
        const status = trim(request.query.status) as TaskStatus | "OPEN_OR_CLAIMED";
        const limit = Number(request.query.limit || 100);
        const tasks = await listBusinessTasks({
          capabilityId: trim(request.params.capabilityId),
          status: status || "OPEN_OR_CLAIMED",
          limit: Number.isFinite(limit) ? limit : 100,
        });
        response.json({ tasks });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/business-tasks/:taskId/claim",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const task = await claimBusinessTask({
          capabilityId: trim(request.params.capabilityId),
          taskId: trim(request.params.taskId),
          claimedBy: actor.displayName,
        });
        if (!task) {
          response.status(409).json({ error: "Task not claimable" });
          return;
        }
        response.json({ task });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/business-tasks/:taskId/complete",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const body = (request.body || {}) as {
          formData?: Record<string, unknown>;
          output?: Record<string, unknown>;
        };
        const task = await completeBusinessTask({
          capabilityId: trim(request.params.capabilityId),
          taskId: trim(request.params.taskId),
          completedBy: actor.displayName,
          formData: body.formData,
          output: body.output,
        });
        if (!task) {
          response.status(409).json({ error: "Task not in completable state" });
          return;
        }
        response.json({ task });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // ── Approvals ──────────────────────────────────────────────────────────

  app.get(
    "/api/capabilities/:capabilityId/business-approvals/:approvalId",
    async (request, response) => {
      try {
        const approval = await fetchBusinessApproval(
          trim(request.params.capabilityId),
          trim(request.params.approvalId),
        );
        if (!approval) {
          response.status(404).json({ error: "Approval not found" });
          return;
        }
        response.json({ approval });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // ── Custom node types ──────────────────────────────────────────────────

  app.get(
    "/api/capabilities/:capabilityId/business-workflow-node-types",
    async (request, response) => {
      try {
        const includeInactive =
          String(request.query.includeInactive ?? "").toLowerCase() === "true";
        const types = await listBusinessCustomNodeTypes(
          trim(request.params.capabilityId),
          { includeInactive },
        );
        response.json({ types });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.put(
    "/api/capabilities/:capabilityId/business-workflow-node-types",
    async (request, response) => {
      try {
        const capabilityId = trim(request.params.capabilityId);
        const body = (request.body || {}) as {
          id?: string;
          name?: string;
          baseType?: string;
          label?: string;
          description?: string;
          color?: string;
          icon?: string;
          fields?: Array<{
            key: string;
            label: string;
            placeholder?: string;
            multiline?: boolean;
          }>;
          isActive?: boolean;
        };
        if (!body.name?.trim() || !body.baseType?.trim() || !body.label?.trim()) {
          response
            .status(400)
            .json({ error: "name, baseType, and label are required" });
          return;
        }
        const upserted = await upsertBusinessCustomNodeType({
          capabilityId,
          id: body.id,
          name: body.name,
          baseType: body.baseType as never,
          label: body.label,
          description: body.description,
          color: body.color,
          icon: body.icon,
          fields: body.fields || [],
          isActive: body.isActive,
        });
        response.json({ type: upserted });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.delete(
    "/api/capabilities/:capabilityId/business-workflow-node-types/:id",
    async (request, response) => {
      try {
        await deleteBusinessCustomNodeType(
          trim(request.params.capabilityId),
          trim(request.params.id),
        );
        response.json({ ok: true });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/business-approvals/:approvalId/decide",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const body = (request.body || {}) as {
          decision?: ApprovalStatus;
          conditions?: string;
          notes?: string;
        };
        if (!body.decision) {
          response.status(400).json({ error: "decision is required" });
          return;
        }
        const approval = await decideBusinessApproval({
          capabilityId: trim(request.params.capabilityId),
          approvalId: trim(request.params.approvalId),
          decidedBy: actor.displayName,
          decision: body.decision,
          conditions: body.conditions,
          notes: body.notes,
        });
        if (!approval) {
          response.status(409).json({ error: "Approval already decided" });
          return;
        }
        response.json({ approval });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════════
  // V2 runtime — list instances, list approvals, reassign, send-back,
  //              ad-hoc, pause/resume, notes, stats
  // ════════════════════════════════════════════════════════════════════════

  // List instances (for status report + cross-template overviews)
  app.get(
    "/api/capabilities/:capabilityId/business-instances",
    async (request, response) => {
      try {
        const capabilityId = trim(request.params.capabilityId);
        const status = trim(request.query.status) || undefined;
        const templateId = trim(request.query.templateId) || undefined;
        const limit = Number(request.query.limit) || 50;
        const offset = Number(request.query.offset) || 0;
        const result = await listBusinessInstances({
          capabilityId,
          templateId,
          status: (status as BusinessInstanceStatus | "ACTIVE") || undefined,
          limit,
          offset,
        });
        response.json(result);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Aggregate stats per template
  app.get(
    "/api/capabilities/:capabilityId/business-workflows/:id/stats",
    async (request, response) => {
      try {
        const stats = await aggregateBusinessTemplateStats({
          capabilityId: trim(request.params.capabilityId),
          templateId: trim(request.params.id),
        });
        response.json(stats);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // List approvals (for the inbox approvals tab)
  app.get(
    "/api/capabilities/:capabilityId/business-approvals",
    async (request, response) => {
      try {
        const status = trim(request.query.status) || undefined;
        const limit = Number(request.query.limit) || 100;
        const approvals = await listBusinessApprovals({
          capabilityId: trim(request.params.capabilityId),
          status:
            (status as ApprovalStatus | "PENDING_OR_INFO_REQUESTED") ||
            undefined,
          limit,
        });
        response.json({ approvals });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Pause / resume the planned graph for an instance
  app.post(
    "/api/capabilities/:capabilityId/business-instances/:instanceId/pause",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const body = (request.body || {}) as { reason?: string };
        const inst = await pauseBusinessInstance({
          capabilityId: trim(request.params.capabilityId),
          instanceId: trim(request.params.instanceId),
          actorId: actor.displayName,
          reason: body.reason,
        });
        if (!inst) {
          response.status(404).json({ error: "Instance not found" });
          return;
        }
        response.json({ instance: inst });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/business-instances/:instanceId/resume",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const inst = await resumeBusinessInstance({
          capabilityId: trim(request.params.capabilityId),
          instanceId: trim(request.params.instanceId),
          actorId: actor.displayName,
        });
        if (!inst) {
          response.status(404).json({ error: "Instance not found" });
          return;
        }
        response.json({ instance: inst });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Append a note to the instance timeline
  app.post(
    "/api/capabilities/:capabilityId/business-instances/:instanceId/notes",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const body = (request.body || {}) as {
          note?: string;
          taskId?: string;
          approvalId?: string;
        };
        if (!body.note?.trim()) {
          response.status(400).json({ error: "note is required" });
          return;
        }
        const event = await addInstanceNote({
          capabilityId: trim(request.params.capabilityId),
          instanceId: trim(request.params.instanceId),
          actorId: actor.displayName,
          note: body.note.trim(),
          taskId: body.taskId,
          approvalId: body.approvalId,
        });
        response.json({ event });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Inject an ad-hoc task on a running (or paused) instance
  app.post(
    "/api/capabilities/:capabilityId/business-instances/:instanceId/ad-hoc-tasks",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const body = (request.body || {}) as {
          title?: string;
          description?: string;
          assignment?: {
            mode?: AssignmentMode;
            userId?: string;
            teamId?: string;
            role?: string;
            skill?: string;
          };
          priority?: TaskPriority;
          dueAt?: string;
          formSchema?: FormSchema | null;
          blocking?: boolean;
          parentTaskId?: string;
        };
        if (!body.title?.trim() || !body.assignment?.mode) {
          response
            .status(400)
            .json({ error: "title and assignment.mode are required" });
          return;
        }
        const task = await createAdHocTask({
          capabilityId: trim(request.params.capabilityId),
          instanceId: trim(request.params.instanceId),
          actorId: actor.displayName,
          title: body.title.trim(),
          description: body.description,
          assignment: {
            mode: body.assignment.mode,
            userId: body.assignment.userId,
            teamId: body.assignment.teamId,
            role: body.assignment.role,
            skill: body.assignment.skill,
          },
          priority: body.priority,
          dueAt: body.dueAt,
          formSchema: body.formSchema,
          blocking: body.blocking,
          parentTaskId: body.parentTaskId,
        });
        response.json({ task });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Reassign an open/claimed task to a different user/team/role
  app.post(
    "/api/capabilities/:capabilityId/business-tasks/:taskId/reassign",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const body = (request.body || {}) as {
          assignmentMode?: AssignmentMode;
          assignedUserId?: string;
          assignedTeamId?: string;
          assignedRole?: string;
          assignedSkill?: string;
          reason?: string;
        };
        if (!body.assignmentMode) {
          response.status(400).json({ error: "assignmentMode is required" });
          return;
        }
        const task = await reassignBusinessTask({
          capabilityId: trim(request.params.capabilityId),
          taskId: trim(request.params.taskId),
          actorId: actor.displayName,
          assignmentMode: body.assignmentMode,
          assignedUserId: body.assignedUserId,
          assignedTeamId: body.assignedTeamId,
          assignedRole: body.assignedRole,
          assignedSkill: body.assignedSkill,
          reason: body.reason,
        });
        if (!task) {
          response.status(404).json({ error: "Task not found or already closed" });
          return;
        }
        response.json({ task });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Send a task BACK to a previous (or any other) node — spawns a
  // fresh task at the target with that node's formSchema/SLA/assignment
  app.post(
    "/api/capabilities/:capabilityId/business-tasks/:taskId/send-back",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const body = (request.body || {}) as {
          targetNodeId?: string;
          reason?: string;
        };
        if (!body.targetNodeId?.trim() || !body.reason?.trim()) {
          response
            .status(400)
            .json({ error: "targetNodeId and reason are required" });
          return;
        }
        const result = await sendBackBusinessTask({
          capabilityId: trim(request.params.capabilityId),
          taskId: trim(request.params.taskId),
          targetNodeId: body.targetNodeId.trim(),
          actorId: actor.displayName,
          reason: body.reason.trim(),
        });
        if (!result) {
          response.status(404).json({ error: "Task not found" });
          return;
        }
        response.json(result);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Reassign an open approval
  app.post(
    "/api/capabilities/:capabilityId/business-approvals/:approvalId/reassign",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const body = (request.body || {}) as {
          assignedUserId?: string;
          assignedTeamId?: string;
          assignedRole?: string;
          reason?: string;
        };
        const approval = await reassignBusinessApproval({
          capabilityId: trim(request.params.capabilityId),
          approvalId: trim(request.params.approvalId),
          actorId: actor.displayName,
          assignedUserId: body.assignedUserId,
          assignedTeamId: body.assignedTeamId,
          assignedRole: body.assignedRole,
          reason: body.reason,
        });
        if (!approval) {
          response.status(404).json({ error: "Approval not found or decided" });
          return;
        }
        response.json({ approval });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Send an approval back to a previous node
  app.post(
    "/api/capabilities/:capabilityId/business-approvals/:approvalId/send-back",
    async (request, response) => {
      try {
        const actor = resolveActor(request);
        const body = (request.body || {}) as {
          targetNodeId?: string;
          reason?: string;
        };
        if (!body.targetNodeId?.trim() || !body.reason?.trim()) {
          response
            .status(400)
            .json({ error: "targetNodeId and reason are required" });
          return;
        }
        const result = await sendBackBusinessApproval({
          capabilityId: trim(request.params.capabilityId),
          approvalId: trim(request.params.approvalId),
          targetNodeId: body.targetNodeId.trim(),
          actorId: actor.displayName,
          reason: body.reason.trim(),
        });
        if (!result) {
          response.status(404).json({ error: "Approval not found" });
          return;
        }
        response.json(result);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );
};
