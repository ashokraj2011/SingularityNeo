import type express from "express";
import type { ActorContext } from "../../src/types";
import { sendApiError } from "../api/errors";
import {
  assertCapabilityPermission,
  assertWorkspacePermission,
} from "../access";
import {
  deleteDesktopWorkspaceMapping,
  getDesktopWorkspaceMappingById,
  listDesktopWorkspaceMappings,
  listValidatedWorkspaceRootsByCapability,
  resolveDesktopWorkspace,
  upsertDesktopWorkspaceMapping,
} from "../desktopWorkspaces";
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
} from "../execution/repository";
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
} from "../executionOwnership";
import {
  getCapabilityBundle,
  releaseWorkItemCodeClaimRecord,
  replaceCapabilityWorkspaceContentRecord,
} from "../repository";
import { buildMemoryContext, refreshCapabilityMemory } from "../memory";
import { evaluateToolPolicy } from "../policy";
import { queueSingleAgentLearningRefresh } from "../agentLearning/service";
import {
  finishTelemetrySpan,
  recordMetricSample,
  recordUsageMetrics,
  startTelemetrySpan,
} from "../telemetry";
import { appendAccessAuditEvent } from "../workspaceOrganization";
import { getWorkspaceWriteLock } from "../workspaceLock";
import { syncCapabilityRepositoriesForDesktop } from "../desktopRepoSync";

const parseHeaderStringList = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // Ignore invalid JSON and fall back to CSV parsing.
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseActorContext = (
  request: express.Request,
  fallbackDisplayName = "Desktop Executor",
): ActorContext => ({
  userId:
    String(request.header("x-singularity-actor-user-id") || "").trim() ||
    undefined,
  displayName:
    String(request.header("x-singularity-actor-display-name") || "").trim() ||
    fallbackDisplayName,
  teamIds: parseHeaderStringList(
    request.header("x-singularity-actor-team-ids"),
  ),
  actedOnBehalfOfStakeholderIds: parseHeaderStringList(
    request.header("x-singularity-actor-stakeholder-ids"),
  ),
});

type RuntimeRpcOperation =
  | "getWorkflowRunDetail"
  | "getWorkflowRunStatus"
  | "getLatestRunForWorkItem"
  | "getActiveRunForWorkItem"
  | "updateWorkflowRun"
  | "updateWorkflowRunControl"
  | "updateWorkflowRunStep"
  | "insertRunEvent"
  | "createRunWait"
  | "createToolInvocation"
  | "updateToolInvocation"
  | "listActiveWorkItemClaims"
  | "releaseWorkItemClaim"
  | "upsertWorkItemClaim"
  | "resolveRunWait"
  | "updateRunWaitPayload"
  | "updateApprovalAssignmentsForWait"
  | "createApprovalAssignments"
  | "createApprovalDecision"
  | "markOpenToolInvocationsAborted"
  | "cancelOpenWaitsForRun"
  | "releaseRunLease"
  | "getCapabilityBundle"
  | "replaceCapabilityWorkspaceContentRecord"
  | "releaseWorkItemCodeClaimRecord"
  | "buildMemoryContext"
  | "refreshCapabilityMemory"
  | "evaluateToolPolicy"
  | "queueSingleAgentLearningRefresh"
  | "startTelemetrySpan"
  | "finishTelemetrySpan"
  | "recordMetricSample"
  | "recordUsageMetrics"
  | "resolveDesktopWorkspace";

const executeRuntimeRpc = async (
  operation: RuntimeRpcOperation,
  args: Record<string, any> = {},
  context?: {
    executorId?: string;
    actor?: ActorContext;
  },
) => {
  switch (operation) {
    case "getWorkflowRunDetail":
      return getWorkflowRunDetail(args.capabilityId, args.runId);
    case "getWorkflowRunStatus":
      return getWorkflowRunStatus(args.capabilityId, args.runId);
    case "getLatestRunForWorkItem":
      return getLatestRunForWorkItem(args.capabilityId, args.workItemId);
    case "getActiveRunForWorkItem":
      return getActiveRunForWorkItem(args.capabilityId, args.workItemId);
    case "updateWorkflowRun":
      return updateWorkflowRun(args.run);
    case "updateWorkflowRunControl":
      return updateWorkflowRunControl(args.run);
    case "updateWorkflowRunStep":
      return updateWorkflowRunStep(args.step);
    case "insertRunEvent":
      return insertRunEvent(args.event);
    case "createRunWait":
      return createRunWait(args.wait);
    case "createToolInvocation":
      return createToolInvocation(args.invocation);
    case "updateToolInvocation":
      return updateToolInvocation(args.invocation);
    case "listActiveWorkItemClaims":
      return listActiveWorkItemClaims(args.capabilityId, args.workItemId);
    case "releaseWorkItemClaim":
      return releaseWorkItemClaim(
        args as Parameters<typeof releaseWorkItemClaim>[0],
      );
    case "upsertWorkItemClaim":
      return upsertWorkItemClaim(args.claim);
    case "resolveRunWait":
      return resolveRunWait(args as Parameters<typeof resolveRunWait>[0]);
    case "updateRunWaitPayload":
      return updateRunWaitPayload(
        args as Parameters<typeof updateRunWaitPayload>[0],
      );
    case "updateApprovalAssignmentsForWait":
      return updateApprovalAssignmentsForWait(
        args as Parameters<typeof updateApprovalAssignmentsForWait>[0],
      );
    case "createApprovalAssignments":
      return createApprovalAssignments(args.assignments || []);
    case "createApprovalDecision":
      return createApprovalDecision(args.decision);
    case "markOpenToolInvocationsAborted":
      return markOpenToolInvocationsAborted(
        args as Parameters<typeof markOpenToolInvocationsAborted>[0],
      );
    case "cancelOpenWaitsForRun":
      return cancelOpenWaitsForRun(
        args as Parameters<typeof cancelOpenWaitsForRun>[0],
      );
    case "releaseRunLease":
      return releaseRunLease(args as Parameters<typeof releaseRunLease>[0]);
    case "getCapabilityBundle":
      return getCapabilityBundle(args.capabilityId);
    case "replaceCapabilityWorkspaceContentRecord":
      return replaceCapabilityWorkspaceContentRecord(
        args.capabilityId,
        args.updates || {},
      );
    case "releaseWorkItemCodeClaimRecord":
      return releaseWorkItemCodeClaimRecord(
        args as Parameters<typeof releaseWorkItemCodeClaimRecord>[0],
      );
    case "buildMemoryContext":
      return buildMemoryContext(
        args as Parameters<typeof buildMemoryContext>[0],
      );
    case "refreshCapabilityMemory":
      return refreshCapabilityMemory(args.capabilityId);
    case "evaluateToolPolicy":
      return evaluateToolPolicy(
        args as Parameters<typeof evaluateToolPolicy>[0],
      );
    case "queueSingleAgentLearningRefresh":
      return queueSingleAgentLearningRefresh(
        args.capabilityId,
        args.agentId,
        args.requestReason,
      );
    case "startTelemetrySpan":
      return startTelemetrySpan(
        args as Parameters<typeof startTelemetrySpan>[0],
      );
    case "finishTelemetrySpan":
      return finishTelemetrySpan(
        args as Parameters<typeof finishTelemetrySpan>[0],
      );
    case "recordMetricSample":
      return recordMetricSample(args.sample);
    case "recordUsageMetrics":
      return recordUsageMetrics(
        args as Parameters<typeof recordUsageMetrics>[0],
      );
    case "resolveDesktopWorkspace":
      if (!context?.executorId || !context.actor?.userId) {
        throw new Error(
          "Desktop workspace resolution requires the current executor and actor.",
        );
      }
      return resolveDesktopWorkspace({
        executorId: context.executorId,
        userId: context.actor.userId,
        capabilityId: String(args.capabilityId || "").trim(),
        repositoryId: String(args.repositoryId || "").trim() || undefined,
      });
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
    throw new Error(
      "Select a workspace operator before using desktop execution.",
    );
  }

  const registration = await getDesktopExecutorRegistration(executorId);
  if (!registration) {
    throw new Error("The desktop executor is not registered yet.");
  }

  if (registration.actorUserId && registration.actorUserId !== actor.userId) {
    throw new Error(
      "This desktop executor is registered for a different workspace operator.",
    );
  }

  return registration;
};

const assertExecutorWorkspaceMappingAccess = async ({
  executorId,
  actor,
  targetUserId,
}: {
  executorId: string;
  actor: ActorContext;
  targetUserId?: string;
}) => {
  if (!actor.userId) {
    throw new Error(
      "Select a workspace operator before managing desktop workspaces.",
    );
  }

  const registration = await getDesktopExecutorRegistration(executorId);
  if (!registration) {
    throw new Error("The desktop executor is not registered yet.");
  }

  const requestedUserId =
    String(targetUserId || actor.userId).trim() || actor.userId;
  const needsWorkspaceManage =
    requestedUserId !== actor.userId ||
    (registration.actorUserId && registration.actorUserId !== actor.userId);

  if (needsWorkspaceManage) {
    await assertWorkspacePermission({ actor, action: "workspace.manage" });
  }

  return {
    registration,
    targetUserId: requestedUserId,
  };
};

const collectCapabilityIds = (
  value: unknown,
  capabilityIds = new Set<string>(),
  visited = new WeakSet<object>(),
) => {
  if (!value || typeof value !== "object") {
    return capabilityIds;
  }

  if (visited.has(value)) {
    return capabilityIds;
  }

  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) => collectCapabilityIds(item, capabilityIds, visited));
    return capabilityIds;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.capabilityId === "string" && record.capabilityId.trim()) {
    capabilityIds.add(record.capabilityId.trim());
  }

  const nestedCapability = record.capability;
  if (
    nestedCapability &&
    typeof nestedCapability === "object" &&
    typeof (nestedCapability as { id?: unknown }).id === "string" &&
    (nestedCapability as { id: string }).id.trim()
  ) {
    capabilityIds.add((nestedCapability as { id: string }).id.trim());
  }

  Object.values(record).forEach((item) =>
    collectCapabilityIds(item, capabilityIds, visited),
  );
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
    new Set(capabilityIds.map((item) => item.trim()).filter(Boolean)),
  );
  if (uniqueCapabilityIds.length === 0) {
    throw new Error(
      "The runtime operation did not include a capability scope.",
    );
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
  app.get("/api/runtime/executors", async (request, response) => {
    try {
      const actor = parseActorContext(request, "Workspace Operator");
      await assertWorkspacePermission({
        actor,
        action: "report.view.operations",
      });
      response.json(await buildExecutorRegistrySummary());
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get("/api/runtime/executors/:executorId", async (request, response) => {
    try {
      const actor = parseActorContext(request, "Workspace Operator");
      await assertWorkspacePermission({
        actor,
        action: "report.view.operations",
      });
      const summary = await buildExecutorRegistrySummary();
      const entry = summary.entries.find(
        (item) =>
          item.registration.id ===
          String(request.params.executorId || "").trim(),
      );
      if (!entry) {
        response.status(404).json({ error: "Desktop executor not found." });
        return;
      }
      response.json(entry);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get(
    "/api/runtime/executors/:executorId/workspace-mappings",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Workspace Operator");
        const executorId = String(request.params.executorId || "").trim();
        const { targetUserId } = await assertExecutorWorkspaceMappingAccess({
          executorId,
          actor,
          targetUserId: String(request.query.userId || "").trim() || undefined,
        });

        response.json({
          mappings: await listDesktopWorkspaceMappings({
            executorId,
            userId: targetUserId,
            capabilityId:
              String(request.query.capabilityId || "").trim() || undefined,
            repositoryId:
              request.query.repositoryId === undefined
                ? undefined
                : String(request.query.repositoryId || "").trim() || "",
          }),
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/runtime/executors/:executorId/workspace-mappings",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Workspace Operator");
        const executorId = String(request.params.executorId || "").trim();
        const { targetUserId } = await assertExecutorWorkspaceMappingAccess({
          executorId,
          actor,
          targetUserId: String(request.body?.userId || "").trim() || undefined,
        });

        const mapping = await upsertDesktopWorkspaceMapping({
          executorId,
          userId: targetUserId,
          capabilityId: String(request.body?.capabilityId || "").trim(),
          repositoryId:
            String(request.body?.repositoryId || "").trim() || undefined,
          localRootPath:
            String(request.body?.localRootPath || "").trim() || undefined,
          workingDirectoryPath:
            String(request.body?.workingDirectoryPath || "").trim() ||
            undefined,
        });

        response.status(201).json(mapping);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.patch(
    "/api/runtime/executors/:executorId/workspace-mappings/:mappingId",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Workspace Operator");
        const executorId = String(request.params.executorId || "").trim();
        const existing = await getDesktopWorkspaceMappingById(
          String(request.params.mappingId || "").trim(),
        );
        if (!existing || existing.executorId !== executorId) {
          response
            .status(404)
            .json({ error: "Desktop workspace mapping not found." });
          return;
        }

        const { targetUserId } = await assertExecutorWorkspaceMappingAccess({
          executorId,
          actor,
          targetUserId: existing.userId,
        });

        response.json(
          await upsertDesktopWorkspaceMapping({
            id: existing.id,
            executorId,
            userId: targetUserId,
            capabilityId:
              String(request.body?.capabilityId || "").trim() ||
              existing.capabilityId,
            repositoryId:
              request.body?.repositoryId === undefined
                ? existing.repositoryId
                : String(request.body?.repositoryId || "").trim() || undefined,
            localRootPath:
              request.body?.localRootPath === undefined
                ? existing.localRootPath
                : String(request.body?.localRootPath || "").trim() || undefined,
            workingDirectoryPath:
              request.body?.workingDirectoryPath === undefined
                ? existing.workingDirectoryPath
                : String(request.body?.workingDirectoryPath || "").trim() ||
                  undefined,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.delete(
    "/api/runtime/executors/:executorId/workspace-mappings/:mappingId",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Workspace Operator");
        const executorId = String(request.params.executorId || "").trim();
        const existing = await getDesktopWorkspaceMappingById(
          String(request.params.mappingId || "").trim(),
        );
        if (!existing || existing.executorId !== executorId) {
          response
            .status(404)
            .json({ error: "Desktop workspace mapping not found." });
          return;
        }

        await assertExecutorWorkspaceMappingAccess({
          executorId,
          actor,
          targetUserId: existing.userId,
        });
        await deleteDesktopWorkspaceMapping({ mappingId: existing.id });
        response.status(204).end();
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.delete(
    "/api/runtime/executors/:executorId",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Workspace Operator");
        await assertWorkspacePermission({ actor, action: "workspace.manage" });
        await unregisterDesktopExecutor(
          String(request.params.executorId || "").trim(),
        );
        response.status(204).end();
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post("/api/runtime/executors/register", async (request, response) => {
    try {
      const actor = parseActorContext(request);
      const body = (request.body || {}) as {
        executorId?: string;
        approvedWorkspaceRoots?: Record<string, string[]>;
        runtimeSummary?: Record<string, unknown>;
        /** User-level working directory for this desktop (Fix: user-level workdir). */
        workingDirectory?: string;
      };
      const executorId = String(body.executorId || "").trim();
      if (!executorId) {
        response.status(400).json({ error: "executorId is required." });
        return;
      }
      if (!actor.userId) {
        response
          .status(400)
          .json({
            error:
              "Select a workspace operator before registering desktop execution.",
          });
        return;
      }

      response.json(
        await registerDesktopExecutor({
          executorId,
          actor,
          approvedWorkspaceRoots: body.approvedWorkspaceRoots,
          runtimeSummary: body.runtimeSummary,
          workingDirectory: body.workingDirectory,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post(
    "/api/runtime/executors/:executorId/heartbeat",
    async (request, response) => {
      try {
        const actor = parseActorContext(request);
        const executorId = String(request.params.executorId || "").trim();
        await requireExecutorActor({ executorId, actor });
        response.json(
          await heartbeatDesktopExecutor({
            executorId,
            actor,
            approvedWorkspaceRoots: request.body?.approvedWorkspaceRoots,
            runtimeSummary: request.body?.runtimeSummary,
            workingDirectory: request.body?.workingDirectory,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/execution/claim",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Workspace Operator");
        const capabilityId = String(request.params.capabilityId || "").trim();
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: "capability.execution.claim",
        });

        const executorId = String(request.body?.executorId || "").trim();
        if (!executorId) {
          response.status(400).json({ error: "executorId is required." });
          return;
        }

        const registration = await getDesktopExecutorRegistration(executorId);
        if (!registration) {
          response.status(404).json({ error: "Desktop executor not found." });
          return;
        }

        let approvedWorkspaceRoots = actor.userId
          ? (
              await listValidatedWorkspaceRootsByCapability({
                executorId,
                userId: actor.userId,
              })
            )[capabilityId] || []
          : registration.approvedWorkspaceRoots?.[capabilityId] || [];

        if (actor.userId && approvedWorkspaceRoots.length === 0) {
          const fallbackResolution = await resolveDesktopWorkspace({
            executorId,
            userId: actor.userId,
            capabilityId,
          }).catch(() => null);
          if (
            fallbackResolution?.validation.valid &&
            fallbackResolution.localRootPath
          ) {
            approvedWorkspaceRoots = Array.from(
              new Set([
                ...(fallbackResolution.approvedWorkspaceRoots || []),
                fallbackResolution.localRootPath,
              ]),
            );
          }
        }

        if (approvedWorkspaceRoots.length === 0) {
          response.status(409).json({
            error:
              "No validated desktop workspace mapping is stored for this operator on the current desktop. Open Desktop Workspaces and save a working directory mapping before claiming execution. A local root is optional when the working directory can derive it.",
          });
          return;
        }

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
          actorDisplayName: actor.displayName || "Workspace Operator",
          action: request.body?.forceTakeover
            ? "capability.execution.taken_over"
            : "capability.execution.claimed",
          targetType: "CAPABILITY_ACCESS",
          targetId: capabilityId,
          capabilityId,
          summary: `${actor.displayName || "Workspace Operator"} claimed desktop execution for this capability.`,
          metadata: {
            executorId,
            approvedWorkspaceRoots,
            forceTakeover: Boolean(request.body?.forceTakeover),
          },
          createdAt: new Date().toISOString(),
        }).catch(() => undefined);

        // Fire-and-forget: ensure repos are cloned and AST index is built.
        // Do NOT await — the claim response must not be delayed.
        syncCapabilityRepositoriesForDesktop({
          capabilityId,
          executorId,
        }).catch(err => {
          console.error(
            `[executionRuntime] repo-sync failed for ${capabilityId}:`,
            err instanceof Error ? err.message : err,
          );
        });

        response.json({
          ownership,
          executor: await getDesktopExecutorRegistration(executorId),
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  /**
   * POST /api/capabilities/:capabilityId/execution/repo-sync
   *
   * Explicitly triggers (or re-triggers) the git clone + AST index build for
   * all repositories configured on the capability.  Accepts an optional
   * `fetch: true` body flag to also pull the latest remote changes into
   * existing clones.
   *
   * Returns a JSON report of what was cloned / updated / skipped.
   */
  app.post(
    "/api/capabilities/:capabilityId/execution/repo-sync",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Workspace Operator");
        const capabilityId = String(request.params.capabilityId || "").trim();
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: "capability.execution.claim",
        });

        const executorId = String(request.body?.executorId || "").trim();
        if (!executorId) {
          response.status(400).json({ error: "executorId is required." });
          return;
        }

        const registration = await getDesktopExecutorRegistration(executorId);
        if (!registration) {
          response.status(404).json({ error: "Desktop executor not found." });
          return;
        }

        const fetch = Boolean(request.body?.fetch);
        const report = await syncCapabilityRepositoriesForDesktop({
          capabilityId,
          executorId,
          fetch,
        });

        response.json(report);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.delete(
    "/api/capabilities/:capabilityId/execution/claim",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Workspace Operator");
        const capabilityId = String(request.params.capabilityId || "").trim();
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: "capability.execution.claim",
        });

        const executorId = String(
          request.body?.executorId || request.query.executorId || "",
        ).trim();
        if (!executorId) {
          response.status(400).json({ error: "executorId is required." });
          return;
        }

        await releaseCapabilityExecution({ capabilityId, executorId });
        await appendAccessAuditEvent({
          id: createAuditEventId(),
          actorUserId: actor.userId,
          actorDisplayName: actor.displayName || "Workspace Operator",
          action: "capability.execution.released",
          targetType: "CAPABILITY_ACCESS",
          targetId: capabilityId,
          capabilityId,
          summary: `${actor.displayName || "Workspace Operator"} released desktop execution for this capability.`,
          metadata: {
            executorId,
          },
          createdAt: new Date().toISOString(),
        }).catch(() => undefined);
        response.status(204).end();
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/execution/status",
    async (request, response) => {
      try {
        const capabilityId = String(request.params.capabilityId || "").trim();
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
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/workspace-lock",
    async (request, response) => {
      try {
        const capabilityId = String(request.params.capabilityId || "").trim();
        const lock = await getWorkspaceWriteLock(capabilityId);
        response.json({ lock });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/runtime/executors/:executorId/runs/claim-next",
    async (request, response) => {
      try {
        const executorId = String(request.params.executorId || "").trim();
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
        response.json({
          run,
          ownedCapabilityIds:
            await listOwnedCapabilityIdsForExecutor(executorId),
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/runtime/executors/:executorId/runs/:runId/bundle",
    async (request, response) => {
      try {
        const executorId = String(request.params.executorId || "").trim();
        const runId = String(request.params.runId || "").trim();
        const capabilityId = String(request.query.capabilityId || "").trim();
        const actor = parseActorContext(request);
        await requireExecutorActor({ executorId, actor });
        await assertExecutorCapabilityAccess({
          executorId,
          capabilityIds: [capabilityId],
        });
        const run = await getWorkflowRun(capabilityId, runId);
        if (run.assignedExecutorId && run.assignedExecutorId !== executorId) {
          response
            .status(403)
            .json({
              error: "This run is assigned to a different desktop executor.",
            });
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
    "/api/runtime/executors/:executorId/runs/:runId/heartbeat",
    async (request, response) => {
      try {
        const executorId = String(request.params.executorId || "").trim();
        const runId = String(request.params.runId || "").trim();
        const capabilityId = String(request.body?.capabilityId || "").trim();
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
    "/api/runtime/executors/:executorId/runs/:runId/apply-turn",
    async (request, response) => {
      try {
        const executorId = String(request.params.executorId || "").trim();
        const actor = parseActorContext(request);
        await requireExecutorActor({ executorId, actor });
        const operations = Array.isArray(request.body?.operations)
          ? request.body.operations
          : [];
        await assertExecutorCapabilityAccess({
          executorId,
          capabilityIds: operations.flatMap((entry) =>
            Array.from(collectCapabilityIds(entry?.args || {})),
          ),
        });
        const results = [];
        for (const entry of operations) {
          const operation = String(
            entry?.operation || "",
          ) as RuntimeRpcOperation;
          results.push({
            operation,
            result: await executeRuntimeRpc(operation, entry?.args || {}, {
              executorId,
              actor,
            }),
          });
        }
        response.json({ results });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/runtime/executors/:executorId/rpc",
    async (request, response) => {
      try {
        const executorId = String(request.params.executorId || "").trim();
        const actor = parseActorContext(request);
        await requireExecutorActor({ executorId, actor });
        await assertExecutorCapabilityAccess({
          executorId,
          capabilityIds: Array.from(
            collectCapabilityIds(request.body?.args || {}),
          ),
        });
        const operation = String(
          request.body?.operation || "",
        ) as RuntimeRpcOperation;
        response.json({
          result: await executeRuntimeRpc(operation, request.body?.args || {}, {
            executorId,
            actor,
          }),
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );
};
