import type { CapabilityRepository } from "../../src/types";
import {
  inspectCodeWorkspace,
  runGitCommand,
} from "../app/executionSupport";
import {
  requireValidDesktopWorkspaceResolution,
  resolveDesktopWorkspace,
} from "../desktopWorkspaces";
import { resolveOperatorWorkingDirectory } from "../desktopRepoSync";
import {
  getCapabilityBundle,
} from "../domains/self-service";
import {
  initializeWorkItemExecutionContextRecord,
  updateWorkItemBranchRecord,
  upsertWorkItemCheckoutSessionRecord,
} from "../domains/tool-plane";
import { buildWorkItemCheckoutPath } from "../workItemCheckouts";
import {
  buildWorkItemBranchName,
  initWorkItemGitWorkspace,
} from "../workItemGitWorkspace";
import { isPathInsideWorkspaceRoot } from "../workspacePaths";

type DesktopWorkspaceResolution = Awaited<
  ReturnType<typeof requireValidDesktopWorkspaceResolution>
>;

export type WorkItemExecutionPreparationPlan = {
  bundle: Awaited<ReturnType<typeof getCapabilityBundle>>;
  context: Awaited<ReturnType<typeof initializeWorkItemExecutionContextRecord>>;
  repository: CapabilityRepository;
  desktopWorkspace: DesktopWorkspaceResolution;
  checkoutPath: string;
  branchName: string;
  baseBranch: string;
};

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

const ensureRepositoryCheckoutReady = async ({
  bundle,
  workItemId,
  desktopWorkspace,
  repository,
  baseBranch,
}: {
  bundle: Awaited<ReturnType<typeof getCapabilityBundle>>;
  workItemId: string;
  desktopWorkspace: DesktopWorkspaceResolution;
  repository: CapabilityRepository;
  baseBranch: string;
}) => {
  const workspaceInit = await initWorkItemGitWorkspace({
    capability: bundle.capability,
    workItemId,
    workingDir: desktopWorkspace.workingDirectoryPath,
    repositoryUrl: repository.url,
    repositoryLabel: repository.label,
    repositoryId: repository.id,
    defaultBranch: baseBranch,
  });
  if (
    !isPathInsideWorkspaceRoot(
      workspaceInit.workspacePath,
      desktopWorkspace.localRootPath,
    )
  ) {
    throw new Error(
      `Working directory ${workspaceInit.workspacePath} must stay inside mapped root ${desktopWorkspace.localRootPath}.`,
    );
  }

  const workspaceStatus = await inspectCodeWorkspace(workspaceInit.workspacePath);
  if (!workspaceStatus.isGitRepository) {
    throw new Error(
      `Repository ${repository.url} could not be initialized in ${workspaceInit.workspacePath}.`,
    );
  }

  return {
    workspacePath: workspaceInit.workspacePath,
    workspaceStatus,
    cloned: workspaceInit.created,
    workspaceInit,
  };
};

export const resolveWorkItemExecutionPreparationPlan = async ({
  capabilityId,
  workItemId,
  actorUserId,
  executorId,
}: {
  capabilityId: string;
  workItemId: string;
  actorUserId: string;
  executorId: string;
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
  const operatorWorkingDirectory =
    (await resolveOperatorWorkingDirectory().catch(() => "")) ||
    desktopWorkspace.workingDirectoryPath;
  const effectiveDesktopWorkspace = {
    ...desktopWorkspace,
    localRootPath: operatorWorkingDirectory || desktopWorkspace.localRootPath,
    workingDirectoryPath:
      operatorWorkingDirectory || desktopWorkspace.workingDirectoryPath,
  };
  const branchName = buildWorkItemBranchName(workItemId);
  const baseBranch =
    context.branch.baseBranch || repository.defaultBranch || "main";
  const checkoutPath = buildWorkItemCheckoutPath({
    workingDirectoryPath: effectiveDesktopWorkspace.workingDirectoryPath,
    capability: bundle.capability,
    workItemId,
    repository,
  });

  return {
    bundle,
    context,
    repository,
    desktopWorkspace: effectiveDesktopWorkspace,
    checkoutPath,
    branchName,
    baseBranch,
  } satisfies WorkItemExecutionPreparationPlan;
};

export const prepareWorkItemExecutionWorkspace = async ({
  capabilityId,
  workItemId,
  actorUserId,
  executorId,
  plan,
}: {
  capabilityId: string;
  workItemId: string;
  actorUserId: string;
  executorId: string;
  plan?: WorkItemExecutionPreparationPlan;
}) => {
  const resolvedPlan =
    plan ||
    (await resolveWorkItemExecutionPreparationPlan({
      capabilityId,
      workItemId,
      actorUserId,
      executorId,
    }));

  const { workspacePath, workspaceStatus, cloned, workspaceInit } =
    await ensureRepositoryCheckoutReady({
      bundle: resolvedPlan.bundle,
      workItemId,
      desktopWorkspace: resolvedPlan.desktopWorkspace,
      repository: resolvedPlan.repository,
      baseBranch: resolvedPlan.baseBranch,
    });

  const existingBranch = await runGitCommand(workspacePath, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${resolvedPlan.branchName}`,
  ]).catch(() => "");

  if (existingBranch) {
    await runGitCommand(workspacePath, ["switch", resolvedPlan.branchName]);
  } else {
    try {
      await runGitCommand(workspacePath, [
        "switch",
        "-c",
        resolvedPlan.branchName,
        resolvedPlan.baseBranch,
      ]);
    } catch {
      await runGitCommand(workspacePath, [
        "switch",
        "-c",
        resolvedPlan.branchName,
      ]);
    }
  }

  const headSha = await runGitCommand(workspacePath, ["rev-parse", "HEAD"]).catch(
    () => "",
  );
  const nextContext = await updateWorkItemBranchRecord({
    capabilityId,
    workItemId,
    branch: {
      ...resolvedPlan.context.branch,
      sharedBranch: resolvedPlan.branchName,
      createdByUserId:
        actorUserId || resolvedPlan.context.branch.createdByUserId,
      headSha: headSha || resolvedPlan.context.branch.headSha,
      status: "ACTIVE",
    },
  });

  await upsertWorkItemCheckoutSessionRecord({
    capabilityId,
    session: {
      executorId,
      workItemId,
      userId: actorUserId,
      repositoryId: resolvedPlan.context.primaryRepositoryId,
      localPath: workspacePath,
      workingDirectoryPath: workspacePath,
      branch: resolvedPlan.branchName,
      lastSeenHeadSha: headSha || undefined,
      lastSyncedAt: new Date().toISOString(),
    },
  });

  return {
    ...resolvedPlan,
    nextContext,
    workspacePath,
    workspaceStatus,
    cloned,
    sourceWorkspace: workspaceInit,
    headSha: headSha || undefined,
  };
};
