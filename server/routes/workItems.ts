import fs from "node:fs";
import path from "node:path";
import type express from "express";
import type {
  Capability,
  WorkItem,
  WorkItemAttachmentUpload,
  WorkItemCheckoutSession,
  WorkItemPhase,
} from "../../src/types";
import { normalizeWorkItemPhaseStakeholders } from "../../src/lib/workItemStakeholders";
import { normalizeWorkItemTaskType } from "../../src/lib/workItemTaskTypes";
import { assertCapabilityPermission } from "../access";
import { sendApiError } from "../api/errors";
import {
  requireValidDesktopWorkspaceResolution,
  resolveDesktopWorkspace,
} from "../desktopWorkspaces";
import {
  listActiveWorkItemClaims,
  listWorkItemPresence,
  listWorkflowRunsForWorkItem,
  releaseWorkItemClaim,
  upsertWorkItemClaim,
  upsertWorkItemPresence,
} from "../execution/repository";
import {
  archiveWorkItemControl,
  cancelWorkItemControl,
  createWorkItemRecord,
  listWorkItemSegments,
  moveWorkItemToPhaseControl,
  restoreWorkItemControl,
  retryWorkItemSegment,
  startNextSegmentFromPreset,
  startWorkflowExecution,
  startWorkItemSegment,
  updateWorkItemBrief,
  updateWorkItemNextSegmentPreset,
} from "../execution/service";
import { wakeExecutionWorker } from "../execution/worker";
import { parseActorContext } from "../requestActor";
import {
  acceptWorkItemHandoffPacketRecord,
  createWorkItemHandoffPacketRecord,
  getCapabilityBundle,
  getWorkItemExecutionContextRecord,
  initializeWorkItemExecutionContextRecord,
  listWorkItemHandoffPacketsRecord,
  releaseWorkItemCodeClaimRecord,
  replaceCapabilityWorkspaceContentRecord,
  updateWorkItemBranchRecord,
  upsertWorkItemCheckoutSessionRecord,
  upsertWorkItemCodeClaimRecord,
} from "../repository";
import { buildWorkItemCheckoutPath } from "../workItemCheckouts";
import { isPathInsideWorkspaceRoot } from "../workspacePaths";

type CodeWorkspaceStatus = {
  path: string;
  exists: boolean;
  isGitRepository: boolean;
  currentBranch: string | null;
  pendingChanges: number;
  lastCommit: string | null;
  error?: string;
};

type WorkItemRouteDeps = {
  applyManualBranchPolicy: (args: {
    capability: Capability;
    permissionSet: Awaited<
      ReturnType<typeof assertCapabilityPermission>
    >["permissionSet"];
    workspacePath: string;
    branchName: string;
  }) => Promise<{
    policyDecision: unknown;
    actorCanApprove: boolean;
    blocked: boolean;
  }>;
  assertCapabilitySupportsExecution: (capability: Capability) => void;
  createRuntimeId: (prefix: string) => string;
  inspectCodeWorkspace: (directoryPath: string) => Promise<CodeWorkspaceStatus>;
  parseActor: (value: unknown, fallback: string) => string;
  runGitCommand: (directoryPath: string, args: string[]) => Promise<string>;
};

export const registerWorkItemRoutes = (
  app: express.Express,
  {
    applyManualBranchPolicy,
    assertCapabilitySupportsExecution,
    createRuntimeId,
    inspectCodeWorkspace,
    parseActor,
    runGitCommand,
  }: WorkItemRouteDeps,
) => {
  const resolveRequiredDesktopWorkspace = async ({
    capabilityId,
    executorId,
    actorUserId,
    repositoryId,
  }: {
    capabilityId: string;
    executorId: string;
    actorUserId?: string;
    repositoryId?: string;
  }) => {
    if (!executorId) {
      throw new Error("executorId is required.");
    }
    if (!actorUserId) {
      throw new Error("Choose an operator before using desktop workspaces.");
    }

    return requireValidDesktopWorkspaceResolution(
      await resolveDesktopWorkspace({
        executorId,
        userId: actorUserId,
        capabilityId,
        repositoryId,
      }),
    );
  };

  const cloneRepositoryIntoWorkingDirectory = async ({
    repositoryUrl,
    checkoutPath,
    baseBranch,
  }: {
    repositoryUrl: string;
    checkoutPath: string;
    baseBranch: string;
  }) => {
    const normalizedCheckoutPath = path.resolve(checkoutPath);
    const parentDirectory = path.dirname(normalizedCheckoutPath);
    fs.mkdirSync(parentDirectory, { recursive: true });

    try {
      await runGitCommand(parentDirectory, [
        "clone",
        "--branch",
        baseBranch,
        "--single-branch",
        repositoryUrl,
        normalizedCheckoutPath,
      ]);
    } catch {
      await runGitCommand(parentDirectory, [
        "clone",
        repositoryUrl,
        normalizedCheckoutPath,
      ]);
    }
  };

  const ensureRepositoryCheckoutReady = async ({
    capability,
    workItemId,
    desktopWorkspace,
    repository,
    baseBranch,
  }: {
    capability: Capability;
    workItemId: string;
    desktopWorkspace: Awaited<
      ReturnType<typeof resolveRequiredDesktopWorkspace>
    >;
    repository: Capability["repositories"][number];
    baseBranch: string;
  }) => {
    const checkoutPath = buildWorkItemCheckoutPath({
      workingDirectoryPath: desktopWorkspace.workingDirectoryPath,
      capability,
      workItemId,
      repository,
      repositoryCount: (capability.repositories || []).length,
    });
    if (
      !isPathInsideWorkspaceRoot(checkoutPath, desktopWorkspace.localRootPath)
    ) {
      throw new Error(
        `Working directory ${checkoutPath} must stay inside mapped root ${desktopWorkspace.localRootPath}.`,
      );
    }

    const workspaceStatus = await inspectCodeWorkspace(checkoutPath);
    if (workspaceStatus.exists && workspaceStatus.isGitRepository) {
      return {
        workspacePath: checkoutPath,
        workspaceStatus,
        cloned: false,
      };
    }

    if (workspaceStatus.exists) {
      const stats = fs.statSync(checkoutPath);
      if (!stats.isDirectory()) {
        throw new Error(
          `Working directory ${checkoutPath} exists but is not a directory.`,
        );
      }

      const entries = fs
        .readdirSync(checkoutPath)
        .filter((entry) => entry !== ".DS_Store");
      if (entries.length > 0) {
        throw new Error(
          `Working directory ${checkoutPath} exists but is not a Git repository. Empty the directory or point the mapping at a clean checkout target.`,
        );
      }
    }

    await cloneRepositoryIntoWorkingDirectory({
      repositoryUrl: repository.url,
      checkoutPath,
      baseBranch,
    });

    const clonedWorkspace = await inspectCodeWorkspace(checkoutPath);
    if (!clonedWorkspace.exists || !clonedWorkspace.isGitRepository) {
      throw new Error(
        clonedWorkspace.error ||
          `Repository ${repository.url} could not be initialized in ${checkoutPath}.`,
      );
    }

    return {
      workspacePath: checkoutPath,
      workspaceStatus: clonedWorkspace,
      cloned: true,
    };
  };

  const ensureWorkItemSharedBranchReady = async ({
    capabilityId,
    workItemId,
    actorUserId,
    executorId,
    permissionContext,
  }: {
    capabilityId: string;
    workItemId: string;
    actorUserId: string;
    executorId: string;
    permissionContext: Awaited<ReturnType<typeof assertCapabilityPermission>>;
  }) => {
    const context = await initializeWorkItemExecutionContextRecord({
      capabilityId,
      workItemId,
      actorUserId,
    });
    if (!context.branch || !context.primaryRepositoryId) {
      throw new Error(
        "Work item execution context did not resolve a primary repository.",
      );
    }

    const bundle = await getCapabilityBundle(capabilityId);
    const repository = (bundle.capability.repositories || []).find(
      (item) => item.id === context.primaryRepositoryId,
    );
    if (!repository) {
      throw new Error(
        `Primary repository ${context.primaryRepositoryId} was not found for ${workItemId}.`,
      );
    }

    const desktopWorkspace = await resolveRequiredDesktopWorkspace({
      capabilityId,
      executorId,
      actorUserId,
      repositoryId: context.primaryRepositoryId,
    });
    const branchName = context.branch.sharedBranch;
    const baseBranch =
      context.branch.baseBranch || repository.defaultBranch || "main";
    const { workspacePath, workspaceStatus } =
      await ensureRepositoryCheckoutReady({
        capability: bundle.capability,
        workItemId,
        desktopWorkspace,
        repository,
        baseBranch,
      });

    const { policyDecision, blocked } = await applyManualBranchPolicy({
      capability: permissionContext.capability,
      permissionSet: permissionContext.permissionSet,
      workspacePath,
      branchName,
    });

    if (blocked) {
      return {
        blocked: true as const,
        policyDecision,
      };
    }

    const existingBranch = await runGitCommand(workspacePath, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branchName}`,
    ]).catch(() => "");

    if (existingBranch) {
      await runGitCommand(workspacePath, ["switch", branchName]);
    } else {
      try {
        await runGitCommand(workspacePath, [
          "switch",
          "-c",
          branchName,
          baseBranch,
        ]);
      } catch {
        await runGitCommand(workspacePath, ["switch", "-c", branchName]);
      }
    }

    const headSha = await runGitCommand(workspacePath, [
      "rev-parse",
      "HEAD",
    ]).catch(() => "");
    const nextContext = await updateWorkItemBranchRecord({
      capabilityId,
      workItemId,
      branch: {
        ...context.branch,
        createdByUserId: actorUserId || context.branch.createdByUserId,
        headSha: headSha || context.branch.headSha,
        status: "ACTIVE",
      },
    });

    await upsertWorkItemCheckoutSessionRecord({
      capabilityId,
      session: {
        executorId,
        workItemId,
        userId: actorUserId,
        repositoryId: context.primaryRepositoryId,
        localPath: workspacePath,
        workingDirectoryPath: workspacePath,
        branch: branchName,
        lastSeenHeadSha: headSha || undefined,
        lastSyncedAt: new Date().toISOString(),
      },
    });

    return {
      blocked: false as const,
      context: nextContext,
      repository,
      desktopWorkspace,
      workspace: workspaceStatus,
      policyDecision,
    };
  };

  app.post(
    "/api/capabilities/:capabilityId/work-items",
    async (request, response) => {
      const title = String(request.body?.title || "").trim();
      const workflowId = String(request.body?.workflowId || "").trim();
      const description = String(request.body?.description || "").trim();
      const rawTaskType = String(request.body?.taskType || "").trim();
      const taskType = rawTaskType
        ? normalizeWorkItemTaskType(rawTaskType)
        : undefined;
      const priority = String(
        request.body?.priority || "Med",
      ) as WorkItem["priority"];
      const tags = Array.isArray(request.body?.tags)
        ? request.body.tags
            .map((tag: unknown) => String(tag).trim())
            .filter(Boolean)
        : [];
      const phaseStakeholders = normalizeWorkItemPhaseStakeholders(
        Array.isArray(request.body?.phaseStakeholders)
          ? request.body.phaseStakeholders
          : [],
      );
      const attachments = Array.isArray(request.body?.attachments)
        ? request.body.attachments
            .map((attachment: Partial<WorkItemAttachmentUpload>) => ({
              fileName: String(attachment?.fileName || "").trim(),
              mimeType: String(attachment?.mimeType || "").trim() || undefined,
              contentText: String(attachment?.contentText || ""),
              sizeBytes:
                typeof attachment?.sizeBytes === "number" &&
                Number.isFinite(attachment.sizeBytes)
                  ? attachment.sizeBytes
                  : undefined,
            }))
            .filter(
              (attachment) =>
                attachment.fileName && attachment.contentText.trim().length > 0,
            )
        : [];

      if (!title || !workflowId) {
        response.status(400).json({
          error: "Both title and workflowId are required.",
        });
        return;
      }

      try {
        assertCapabilitySupportsExecution(
          (await getCapabilityBundle(request.params.capabilityId)).capability,
        );
        const actor = parseActorContext(
          request,
          parseActor(request.body?.guidedBy, "Capability Owner"),
        );
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.create",
        });
        response.status(201).json(
          await createWorkItemRecord({
            capabilityId: request.params.capabilityId,
            title,
            description,
            workflowId,
            taskType,
            phaseStakeholders,
            attachments,
            priority,
            tags,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/move",
    async (request, response) => {
      const targetPhase = String(
        request.body?.targetPhase || "",
      ).trim() as WorkItemPhase;
      const note = String(request.body?.note || "").trim();
      const cancelRunIfPresent = Boolean(request.body?.cancelRunIfPresent);

      if (!targetPhase) {
        response.status(400).json({ error: "A targetPhase is required." });
        return;
      }

      try {
        const actor = parseActorContext(request, "Capability Owner");
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        response.json(
          await moveWorkItemToPhaseControl({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            targetPhase,
            note: note || undefined,
            cancelRunIfPresent,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/cancel",
    async (request, response) => {
      try {
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        assertCapabilitySupportsExecution(bundle.capability);

        const actor = parseActorContext(request, "Workspace Operator");
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });

        response.json(
          await cancelWorkItemControl({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            note: String(request.body?.note || "").trim() || undefined,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/archive",
    async (request, response) => {
      try {
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        assertCapabilitySupportsExecution(bundle.capability);

        const actor = parseActorContext(request, "Workspace Operator");
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });

        response.json(
          await archiveWorkItemControl({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            note: String(request.body?.note || "").trim() || undefined,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/restore",
    async (request, response) => {
      try {
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        assertCapabilitySupportsExecution(bundle.capability);

        const actor = parseActorContext(request, "Workspace Operator");
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });

        response.json(
          await restoreWorkItemControl({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            note: String(request.body?.note || "").trim() || undefined,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/work-items/:workItemId/collaboration",
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, "Workspace Operator"),
          action: "workitem.read",
        });
        const [claims, presence] = await Promise.all([
          listActiveWorkItemClaims(
            request.params.capabilityId,
            request.params.workItemId,
          ),
          listWorkItemPresence(
            request.params.capabilityId,
            request.params.workItemId,
          ),
        ]);
        response.json({ claims, presence });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/work-items/:workItemId/execution-context",
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, "Workspace Operator"),
          action: "workitem.read",
        });
        const [context, handoffs] = await Promise.all([
          getWorkItemExecutionContextRecord({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
          }),
          listWorkItemHandoffPacketsRecord({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
          }),
        ]);
        response.json({ context, handoffs });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/execution-context/initialize",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Capability Owner");
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const context = await initializeWorkItemExecutionContextRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          actorUserId: actor.userId,
        });
        response.status(201).json(context);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/branch/create",
    async (request, response) => {
      try {
        const executorId = String(request.body?.executorId || "").trim();
        if (!executorId) {
          response.status(400).json({ error: "executorId is required." });
          return;
        }
        const actor = parseActorContext(request, "Capability Owner");
        if (!actor.userId) {
          response.status(400).json({
            error:
              "Choose an operator before creating a shared work-item branch.",
          });
          return;
        }
        const permissionContext = await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const result = await ensureWorkItemSharedBranchReady({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          actorUserId: actor.userId,
          executorId,
          permissionContext,
        });
        if (result.blocked) {
          response.status(403).json({
            error: (result.policyDecision as { reason?: string }).reason,
            requiresApproval: true,
            policyDecision: result.policyDecision,
          });
          return;
        }

        response.status(201).json({
          context: result.context,
          workspace: result.workspace,
          repository: result.repository,
          desktopWorkspace: result.desktopWorkspace,
          policyDecision: result.policyDecision,
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/claim/write",
    async (request, response) => {
      const actor = parseActorContext(request, "Capability Owner");
      if (!actor.userId) {
        response
          .status(400)
          .json({ error: "Choose an operator before taking write control." });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        await initializeWorkItemExecutionContextRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          actorUserId: actor.userId,
        });
        const claim = await upsertWorkItemCodeClaimRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          userId: actor.userId,
          teamId: actor.teamIds[0],
          claimType: "WRITE",
          status: "ACTIVE",
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        });
        const context = await getWorkItemExecutionContextRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
        });
        response.status(201).json({ claim, context });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.delete(
    "/api/capabilities/:capabilityId/work-items/:workItemId/claim/write",
    async (request, response) => {
      const actor = parseActorContext(request, "Capability Owner");
      if (!actor.userId) {
        response.status(400).json({
          error: "Choose an operator before releasing write control.",
        });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        await releaseWorkItemCodeClaimRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          claimType: "WRITE",
          userId: actor.userId,
        });
        response.status(204).end();
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/work-items/:workItemId/handoff",
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, "Workspace Operator"),
          action: "workitem.read",
        });
        response.json(
          await listWorkItemHandoffPacketsRecord({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/handoff",
    async (request, response) => {
      const actor = parseActorContext(request, "Capability Owner");
      const summary = String(request.body?.summary || "").trim();
      if (!summary) {
        response.status(400).json({ error: "A handoff summary is required." });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const packet = await createWorkItemHandoffPacketRecord({
          capabilityId: request.params.capabilityId,
          packet: {
            id: createRuntimeId("HANDOFF"),
            workItemId: request.params.workItemId,
            fromUserId: actor.userId,
            toUserId: String(request.body?.toUserId || "").trim() || undefined,
            fromTeamId: actor.teamIds[0],
            toTeamId: String(request.body?.toTeamId || "").trim() || undefined,
            summary,
            openQuestions: Array.isArray(request.body?.openQuestions)
              ? request.body.openQuestions
                  .map((value: unknown) => String(value || "").trim())
                  .filter(Boolean)
              : [],
            blockingDependencies: Array.isArray(
              request.body?.blockingDependencies,
            )
              ? request.body.blockingDependencies
                  .map((value: unknown) => String(value || "").trim())
                  .filter(Boolean)
              : [],
            recommendedNextStep:
              String(request.body?.recommendedNextStep || "").trim() ||
              undefined,
            artifactIds: Array.isArray(request.body?.artifactIds)
              ? request.body.artifactIds
                  .map((value: unknown) => String(value || "").trim())
                  .filter(Boolean)
              : [],
            traceIds: Array.isArray(request.body?.traceIds)
              ? request.body.traceIds
                  .map((value: unknown) => String(value || "").trim())
                  .filter(Boolean)
              : [],
            createdAt: new Date().toISOString(),
          },
        });
        response.status(201).json(packet);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/handoff/:packetId/accept",
    async (request, response) => {
      const actor = parseActorContext(request, "Capability Owner");
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const packet = await acceptWorkItemHandoffPacketRecord({
          capabilityId: request.params.capabilityId,
          packetId: request.params.packetId,
        });
        if (actor.userId) {
          await upsertWorkItemCodeClaimRecord({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            userId: actor.userId,
            teamId: actor.teamIds[0],
            claimType: "WRITE",
            status: "ACTIVE",
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
          });
        }
        const context = await getWorkItemExecutionContextRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
        });
        response.json({ packet, context });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/checkout/register",
    async (request, response) => {
      const actor = parseActorContext(request, "Capability Owner");
      const executorId = String(request.body?.executorId || "").trim();
      const userId = actor.userId || String(request.body?.userId || "").trim();
      const repositoryId = String(request.body?.repositoryId || "").trim();
      if (!executorId || !userId || !repositoryId) {
        response.status(400).json({
          error:
            "executorId, userId, and repositoryId are required to register a checkout.",
        });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const desktopWorkspace = await resolveRequiredDesktopWorkspace({
          capabilityId: request.params.capabilityId,
          executorId,
          actorUserId: userId,
          repositoryId,
        });
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        const repository = (bundle.capability.repositories || []).find(
          (entry) => entry.id === repositoryId,
        );
        if (!repository) {
          throw new Error(
            `Repository ${repositoryId} was not found on capability ${request.params.capabilityId}.`,
          );
        }

        const defaultCheckoutPath = buildWorkItemCheckoutPath({
          workingDirectoryPath: desktopWorkspace.workingDirectoryPath,
          capability: bundle.capability,
          workItemId: request.params.workItemId,
          repository,
          repositoryCount: (bundle.capability.repositories || []).length,
        });
        const localPath =
          String(request.body?.localPath || "").trim() || defaultCheckoutPath;
        const workingDirectoryPath =
          String(request.body?.workingDirectoryPath || "").trim() ||
          defaultCheckoutPath;

        if (
          !isPathInsideWorkspaceRoot(localPath, desktopWorkspace.localRootPath)
        ) {
          throw new Error(
            `Local path ${localPath} must stay inside mapped root ${desktopWorkspace.localRootPath}.`,
          );
        }
        if (
          !isPathInsideWorkspaceRoot(
            workingDirectoryPath,
            desktopWorkspace.localRootPath,
          )
        ) {
          throw new Error(
            `Working directory ${workingDirectoryPath} must stay inside mapped root ${desktopWorkspace.localRootPath}.`,
          );
        }
        const session = await upsertWorkItemCheckoutSessionRecord({
          capabilityId: request.params.capabilityId,
          session: {
            executorId,
            workItemId: request.params.workItemId,
            userId,
            repositoryId,
            localPath,
            workingDirectoryPath,
            branch: request.params.workItemId,
            lastSeenHeadSha:
              String(request.body?.lastSeenHeadSha || "").trim() || undefined,
            lastSyncedAt:
              String(request.body?.lastSyncedAt || "").trim() ||
              new Date().toISOString(),
          } satisfies WorkItemCheckoutSession,
        });
        response.status(201).json(session);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/claim",
    async (request, response) => {
      const actor = parseActorContext(request, "Capability Owner");
      if (!actor.userId) {
        response
          .status(400)
          .json({ error: "Choose an operator before taking control." });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        const workItem = bundle.workspace.workItems.find(
          (item) => item.id === request.params.workItemId,
        );
        if (!workItem) {
          throw new Error(
            `Work item ${request.params.workItemId} was not found.`,
          );
        }

        const claim = await upsertWorkItemClaim({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          userId: actor.userId,
          teamId: actor.teamIds[0],
          status: "ACTIVE",
          claimedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        });
        const nextWorkItem = {
          ...workItem,
          claimOwnerUserId: actor.userId,
          recordVersion: (workItem.recordVersion || 1) + 1,
          history: [
            ...workItem.history,
            {
              id: `HIST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
              timestamp: new Date().toISOString(),
              actor: actor.displayName,
              action: "Work item claimed",
              detail: `${actor.displayName} took active operator control of this work item.`,
              phase: workItem.phase,
              status: workItem.status,
            },
          ],
        };
        await replaceCapabilityWorkspaceContentRecord(
          request.params.capabilityId,
          {
            workItems: bundle.workspace.workItems.map((item) =>
              item.id === nextWorkItem.id ? nextWorkItem : item,
            ),
          },
        );
        response.status(201).json({ claim, workItem: nextWorkItem });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.delete(
    "/api/capabilities/:capabilityId/work-items/:workItemId/claim",
    async (request, response) => {
      const actor = parseActorContext(request, "Capability Owner");
      if (!actor.userId) {
        response
          .status(400)
          .json({ error: "Choose an operator before releasing control." });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        await releaseWorkItemClaim({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          userId: actor.userId,
        });
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        const nextWorkItems = bundle.workspace.workItems.map((item) =>
          item.id === request.params.workItemId &&
          item.claimOwnerUserId === actor.userId
            ? {
                ...item,
                claimOwnerUserId: undefined,
                recordVersion: (item.recordVersion || 1) + 1,
              }
            : item,
        );
        await replaceCapabilityWorkspaceContentRecord(
          request.params.capabilityId,
          {
            workItems: nextWorkItems,
          },
        );
        response.status(204).end();
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/presence",
    async (request, response) => {
      const actor = parseActorContext(request, "Capability Owner");
      if (!actor.userId) {
        response
          .status(400)
          .json({ error: "Choose an operator before updating presence." });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.read",
        });
        const presence = await upsertWorkItemPresence({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          userId: actor.userId,
          teamId: actor.teamIds[0],
          viewContext:
            String(request.body?.viewContext || "").trim() || undefined,
          lastSeenAt: new Date().toISOString(),
        });
        response.status(201).json(presence);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/runs",
    async (request, response) => {
      try {
        assertCapabilitySupportsExecution(
          (await getCapabilityBundle(request.params.capabilityId)).capability,
        );
        const actor = parseActorContext(
          request,
          parseActor(request.body?.guidedBy, "Capability Owner"),
        );
        const permissionContext = await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const executorId = String(request.body?.executorId || "").trim();
        const context = await initializeWorkItemExecutionContextRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          actorUserId: actor.userId,
        }).catch(() => null);
        if (executorId && actor.userId && context?.primaryRepositoryId) {
          const result = await ensureWorkItemSharedBranchReady({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            actorUserId: actor.userId,
            executorId,
            permissionContext,
          });
          if (result.blocked) {
            response.status(403).json({
              error: (result.policyDecision as { reason?: string }).reason,
              requiresApproval: true,
              policyDecision: result.policyDecision,
            });
            return;
          }
        }
        // `startPhase` is a client-side alias for `restartFromPhase` that
        // reads more naturally in the new segment model. Accept either;
        // precedence: explicit startPhase > legacy restartFromPhase.
        const startPhase =
          (request.body?.startPhase as WorkItemPhase | undefined) ||
          (request.body?.restartFromPhase as WorkItemPhase | undefined);
        const stopAfterPhase = request.body?.stopAfterPhase as
          | WorkItemPhase
          | undefined;
        const intention =
          typeof request.body?.intention === "string"
            ? request.body.intention.trim() || undefined
            : undefined;

        const detail = await startWorkflowExecution({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          restartFromPhase: startPhase,
          stopAfterPhase,
          intention,
          guidance: String(request.body?.guidance || "").trim() || undefined,
          guidedBy: actor.displayName,
          actor,
        });
        wakeExecutionWorker();
        response.status(201).json(detail);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // --- Phase-segment routes ----------------------------------------------

  // Create + start a new segment. Body: { startPhase?, stopAfterPhase?,
  // intention (required), saveAsPreset? }. Intention is required at the
  // route level because the segment row enforces it NOT NULL.
  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/segments",
    async (request, response) => {
      try {
        assertCapabilitySupportsExecution(
          (await getCapabilityBundle(request.params.capabilityId)).capability,
        );
        const actor = parseActorContext(
          request,
          parseActor(request.body?.guidedBy, "Capability Owner"),
        );
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const intention =
          typeof request.body?.intention === "string"
            ? request.body.intention.trim()
            : "";
        if (!intention) {
          response
            .status(400)
            .json({ error: "Segment intention is required." });
          return;
        }
        const detail = await startWorkItemSegment({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          startPhase: request.body?.startPhase as WorkItemPhase | undefined,
          stopAfterPhase: request.body?.stopAfterPhase as
            | WorkItemPhase
            | undefined,
          intention,
          saveAsPreset: Boolean(request.body?.saveAsPreset),
          guidance: String(request.body?.guidance || "").trim() || undefined,
          actor,
        });
        wakeExecutionWorker();
        response.status(201).json(detail);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Retry a FAILED/CANCELLED segment: spawn a new run under the same segment
  // row so the intention and phase range are preserved for audit.
  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/segments/:segmentId/retry",
    async (request, response) => {
      try {
        assertCapabilitySupportsExecution(
          (await getCapabilityBundle(request.params.capabilityId)).capability,
        );
        const actor = parseActorContext(
          request,
          parseActor(request.body?.guidedBy, "Capability Owner"),
        );
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const detail = await retryWorkItemSegment({
          capabilityId: request.params.capabilityId,
          segmentId: request.params.segmentId,
          actor,
        });
        wakeExecutionWorker();
        response.status(201).json(detail);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // One-click "Start next" using the work item's saved preset.
  app.post(
    "/api/capabilities/:capabilityId/work-items/:workItemId/start-next",
    async (request, response) => {
      try {
        assertCapabilitySupportsExecution(
          (await getCapabilityBundle(request.params.capabilityId)).capability,
        );
        const actor = parseActorContext(
          request,
          parseActor(request.body?.guidedBy, "Capability Owner"),
        );
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const detail = await startNextSegmentFromPreset({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          actor,
        });
        wakeExecutionWorker();
        response.status(201).json(detail);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // List all segments for a work item, newest first.
  app.get(
    "/api/capabilities/:capabilityId/work-items/:workItemId/segments",
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, "Workspace Operator"),
          action: "workitem.read",
        });
        const segments = await listWorkItemSegments({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
        });
        response.json(segments);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Update the long-lived work item brief (cross-segment goal).
  app.patch(
    "/api/capabilities/:capabilityId/work-items/:workItemId/brief",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Capability Owner");
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const brief =
          typeof request.body?.brief === "string"
            ? request.body.brief
            : request.body?.brief === null
            ? null
            : "";
        const result = await updateWorkItemBrief({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          brief,
        });
        response.json(result);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  // Save or clear the "start next" preset. Body: { preset: { startPhase,
  // stopAfterPhase, intention } | null }
  app.patch(
    "/api/capabilities/:capabilityId/work-items/:workItemId/next-segment-preset",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Capability Owner");
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "workitem.control",
        });
        const result = await updateWorkItemNextSegmentPreset({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          preset: request.body?.preset ?? null,
        });
        response.json(result);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    "/api/capabilities/:capabilityId/work-items/:workItemId/runs",
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, "Workspace Operator"),
          action: "workitem.read",
        });
        response.json(
          await listWorkflowRunsForWorkItem(
            request.params.capabilityId,
            request.params.workItemId,
          ),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );
};
