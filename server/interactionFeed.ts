import { buildCapabilityInteractionFeed } from '../src/lib/interactionFeed';
import type { CapabilityInteractionFeed } from '../src/types';
import {
  getLatestRunForWorkItem,
  getWorkflowRunDetail,
  listRecentWorkflowRunEvents,
  listWorkflowRunEvents,
} from './execution/repository';
import { getCapabilityBundle } from './domains/self-service/repository';

export const buildCapabilityInteractionFeedSnapshot = async ({
  capabilityId,
  workItemId,
}: {
  capabilityId: string;
  workItemId?: string;
}): Promise<CapabilityInteractionFeed> => {
  const bundle = await getCapabilityBundle(capabilityId);

  if (!workItemId) {
    return buildCapabilityInteractionFeed({
      capability: bundle.capability,
      workspace: bundle.workspace,
      runEvents: await listRecentWorkflowRunEvents(capabilityId, 40),
    });
  }

  const latestRun = await getLatestRunForWorkItem(capabilityId, workItemId);
  const [runDetail, runEvents] = latestRun
    ? await Promise.all([
        getWorkflowRunDetail(capabilityId, latestRun.id),
        listWorkflowRunEvents(capabilityId, latestRun.id),
      ])
    : [null, []];

  return buildCapabilityInteractionFeed({
    capability: bundle.capability,
    workspace: bundle.workspace,
    workItemId,
    runDetail,
    runEvents,
  });
};
