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
  archiveBusinessTemplate,
  cancelBusinessInstance,
  claimBusinessTask,
  completeBusinessTask,
  createBusinessTemplate,
  decideBusinessApproval,
  deleteBusinessCustomNodeType,
  fetchBusinessApproval,
  fetchBusinessTemplate,
  getBusinessInstance,
  listBusinessCustomNodeTypes,
  listBusinessInstanceEvents,
  listBusinessTasks,
  listBusinessTemplateVersions,
  listBusinessTemplates,
  publishBusinessTemplate,
  saveBusinessTemplateDraft,
  startBusinessInstance,
  upsertBusinessCustomNodeType,
} from "../businessWorkflows";
import { sendApiError } from "../api/errors";
import type { ApprovalStatus, TaskStatus } from "../../src/contracts/businessWorkflow";

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
        const events = await listBusinessInstanceEvents(
          trim(request.params.capabilityId),
          trim(request.params.instanceId),
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
};
