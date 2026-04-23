import type express from "express";
import type { Capability } from "../../src/types";
import { assertCapabilityPermission } from "../access";
import { sendApiError } from "../api/errors";
import { listDesktopWorkspaceMappings } from "../desktopWorkspaces";
import { parseActorContext } from "../requestActor";
import {
  isWorkspacePathApproved,
  normalizeDirectoryPath,
} from "../workspacePaths";

type CodeWorkspaceStatus = {
  path: string;
  exists: boolean;
  isGitRepository: boolean;
  currentBranch: string | null;
  pendingChanges: number;
  lastCommit: string | null;
  error?: string;
};

type CodeWorkspaceRouteDeps = {
  applyManualBranchPolicy: (args: {
    capability: Capability;
    permissionSet: Awaited<
      ReturnType<typeof assertCapabilityPermission>
    >["permissionSet"];
    workspacePath: string;
    branchName: string;
  }) => Promise<{
    policyDecision: { reason?: string };
    actorCanApprove: boolean;
    blocked: boolean;
  }>;
  inspectCodeWorkspace: (directoryPath: string) => Promise<CodeWorkspaceStatus>;
  runGitCommand: (directoryPath: string, args: string[]) => Promise<string>;
};

export const registerCodeWorkspaceRoutes = (
  app: express.Express,
  {
    applyManualBranchPolicy,
    inspectCodeWorkspace,
    runGitCommand,
  }: CodeWorkspaceRouteDeps,
) => {
  app.get(
    "/api/capabilities/:capabilityId/code-workspaces",
    async (request, response) => {
      try {
        const actor = parseActorContext(request, "Workspace Operator");
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "capability.read",
        });
        const executorId = String(request.query.executorId || "").trim();
        if (!executorId) {
          response.status(400).json({ error: "executorId is required." });
          return;
        }
        if (!actor.userId) {
          response
            .status(400)
            .json({
              error: "Choose an operator before listing desktop workspaces.",
            });
          return;
        }
        const mappings = await listDesktopWorkspaceMappings({
          executorId,
          userId: actor.userId,
          capabilityId: request.params.capabilityId,
        });
        const workspaces = await Promise.all(
          Array.from(
            new Set(
              mappings
                .filter((mapping) => mapping.validation.valid)
                .map((mapping) => mapping.workingDirectoryPath),
            ),
          ).map((directoryPath) => inspectCodeWorkspace(directoryPath)),
        );

        response.json(workspaces);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    "/api/capabilities/:capabilityId/code-workspaces/branch",
    async (request, response) => {
      const requestedPath = String(request.body?.path || "").trim();
      const branchName = String(request.body?.branchName || "").trim();
      const executorId = String(request.body?.executorId || "").trim();

      if (!requestedPath || !branchName || !executorId) {
        response.status(400).json({
          error: "path, branchName, and executorId are required.",
        });
        return;
      }

      try {
        const actor = parseActorContext(request, "Workspace Operator");
        const permissionContext = await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: "capability.edit",
        });
        if (!actor.userId) {
          response
            .status(400)
            .json({ error: "Choose an operator before creating a branch." });
          return;
        }
        const allowedPaths = Array.from(
          new Set(
            (
              await listDesktopWorkspaceMappings({
                executorId,
                userId: actor.userId,
                capabilityId: request.params.capabilityId,
              })
            )
              .filter((mapping) => mapping.validation.valid)
              .map((mapping) => mapping.localRootPath),
          ),
        );
        const resolvedPath = normalizeDirectoryPath(requestedPath);

        if (!isWorkspacePathApproved(resolvedPath, allowedPaths)) {
          response.status(403).json({
            error:
              "This directory is not mapped for the selected operator on this desktop.",
          });
          return;
        }

        const { policyDecision, blocked } = await applyManualBranchPolicy({
          capability: permissionContext.capability,
          permissionSet: permissionContext.permissionSet,
          workspacePath: resolvedPath,
          branchName,
        });
        if (blocked) {
          response.status(403).json({
            error: policyDecision.reason,
            requiresApproval: true,
            policyDecision,
          });
          return;
        }

        const existingBranch = await runGitCommand(resolvedPath, [
          "rev-parse",
          "--verify",
          "--quiet",
          `refs/heads/${branchName}`,
        ]).catch(() => "");

        if (existingBranch) {
          response.status(409).json({
            error: `Branch ${branchName} already exists in ${resolvedPath}.`,
          });
          return;
        }

        await runGitCommand(resolvedPath, ["switch", "-c", branchName]);
        response.status(201).json({
          ...(await inspectCodeWorkspace(resolvedPath)),
          policyDecision,
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );
};
