import type { Capability, CapabilityRepository, WorkItem } from "../src/types";
import {
  requireValidDesktopWorkspaceResolution,
  resolveDesktopWorkspace,
} from "./desktopWorkspaces";
import { getCapabilityExecutionOwnership } from "./executionOwnership";
import { forceLocalCheckoutAstRefresh, queueLocalCheckoutAstRefresh } from "./localCodeIndex";
import { refreshCapabilityCodeIndex } from "./codeIndex/ingest";
import { buildWorkItemCheckoutPath } from "./workItemCheckouts";

const pickRepositoryForWorkItem = (
  capability: Pick<Capability, "repositories">,
  workItem: Pick<WorkItem, "executionContext">,
  repositoryId?: string,
) => {
  const repositories = capability.repositories || [];
  const preferredRepositoryId =
    repositoryId ||
    workItem.executionContext?.primaryRepositoryId ||
    workItem.executionContext?.branch?.repositoryId;
  return (
    repositories.find((repository) => repository.id === preferredRepositoryId) ||
    repositories.find((repository) => repository.isPrimary) ||
    repositories[0] ||
    null
  );
};

const resolveCheckoutPath = async ({
  capability,
  workItem,
  repository,
}: {
  capability: Pick<Capability, "id" | "name" | "repositories">;
  workItem: Pick<WorkItem, "id" | "executionContext">;
  repository: CapabilityRepository;
}) => {
  const ownership = await getCapabilityExecutionOwnership(capability.id).catch(
    () => null,
  );
  if (!ownership?.executorId || !ownership.actorUserId) {
    return null;
  }

  const resolution = requireValidDesktopWorkspaceResolution(
    await resolveDesktopWorkspace({
      executorId: ownership.executorId,
      userId: ownership.actorUserId,
      capabilityId: capability.id,
      repositoryId: repository.id,
    }),
  );

  return buildWorkItemCheckoutPath({
    workingDirectoryPath: resolution.workingDirectoryPath,
    capability,
    workItemId: workItem.id,
    repository,
    repositoryCount: (capability.repositories || []).length,
  });
};

const resolveWorkItemAstTarget = async ({
  capability,
  workItem,
  repositoryId,
  checkoutPath,
}: {
  capability: Pick<Capability, "id" | "name" | "repositories">;
  workItem: Pick<WorkItem, "id" | "executionContext">;
  repositoryId?: string;
  checkoutPath?: string;
}) => {
  const repository = pickRepositoryForWorkItem(capability, workItem, repositoryId);
  if (!repository) {
    return null;
  }

  const resolvedCheckoutPath =
    checkoutPath ||
    (await resolveCheckoutPath({
      capability,
      workItem,
      repository,
    }));
  if (!resolvedCheckoutPath) {
    return null;
  }

  return {
    repository,
    checkoutPath: resolvedCheckoutPath,
  };
};

export const queueWorkItemAstRefresh = async ({
  capability,
  workItem,
  repositoryId,
  checkoutPath,
}: {
  capability: Pick<Capability, "id" | "name" | "repositories">;
  workItem: Pick<WorkItem, "id" | "executionContext">;
  repositoryId?: string;
  checkoutPath?: string;
}) => {
  const target = await resolveWorkItemAstTarget({
    capability,
    workItem,
    repositoryId,
    checkoutPath,
  });
  if (!target) {
    return null;
  }

  queueLocalCheckoutAstRefresh({
    checkoutPath: target.checkoutPath,
    capabilityId: capability.id,
    repositoryId: target.repository.id,
  });

  return {
    repositoryId: target.repository.id,
    checkoutPath: target.checkoutPath,
  };
};

export const forceWorkItemAstRefresh = async ({
  capability,
  workItem,
  repositoryId,
  checkoutPath,
}: {
  capability: Pick<Capability, "id" | "name" | "repositories">;
  workItem: Pick<WorkItem, "id" | "executionContext">;
  repositoryId?: string;
  checkoutPath?: string;
}) => {
  const target = await resolveWorkItemAstTarget({
    capability,
    workItem,
    repositoryId,
    checkoutPath,
  });
  if (!target) {
    return null;
  }

  await forceLocalCheckoutAstRefresh({
    checkoutPath: target.checkoutPath,
    capabilityId: capability.id,
    repositoryId: target.repository.id,
  }).catch(() => undefined);

  await refreshCapabilityCodeIndex(capability.id, {
    localRepositoryRoots: {
      [target.repository.id]: target.checkoutPath,
    },
  }).catch(() => undefined);

  return {
    repositoryId: target.repository.id,
    checkoutPath: target.checkoutPath,
  };
};
