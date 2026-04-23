import type express from 'express';
import { assertCapabilityPermission } from '../access';
import { sendApiError } from '../api/errors';
import type { ActorContext, PlanningGenerationRequest, StoryProposalItem } from '../../src/types';
import {
  createStoryProposalBatch,
  getStoryProposalBatch,
  listStoryProposalBatches,
  promoteStoryProposalBatch,
  regenerateStoryProposalBatch,
  updateStoryProposalItem,
} from '../storyProposals';

export const registerStoryProposalRoutes = (
  app: express.Express,
  {
    parseActorContext,
  }: {
    parseActorContext: (request: express.Request, fallbackDisplayName: string) => ActorContext;
  },
) => {
  app.get('/api/capabilities/:capabilityId/story-proposals', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const capabilityId = String(request.params.capabilityId || '').trim();
      await assertCapabilityPermission({
        capabilityId,
        actor,
        action: 'capability.read',
      });
      response.json(await listStoryProposalBatches(capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/story-proposals', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const capabilityId = String(request.params.capabilityId || '').trim();
      await assertCapabilityPermission({
        capabilityId,
        actor,
        action: 'capability.edit',
      });
      const batch = await createStoryProposalBatch({
        capabilityId,
        request: (request.body || {}) as PlanningGenerationRequest,
        actor,
      });
      response.status(201).json(batch);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get(
    '/api/capabilities/:capabilityId/story-proposals/:batchId',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        const capabilityId = String(request.params.capabilityId || '').trim();
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.read',
        });
        const batch = await getStoryProposalBatch(
          capabilityId,
          String(request.params.batchId || '').trim(),
        );
        if (!batch) {
          response.status(404).json({ error: 'Story proposal batch was not found.' });
          return;
        }
        response.json(batch);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.patch(
    '/api/capabilities/:capabilityId/story-proposals/:batchId/items/:itemId',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        const capabilityId = String(request.params.capabilityId || '').trim();
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.edit',
        });
        const batch = await updateStoryProposalItem({
          capabilityId,
          batchId: String(request.params.batchId || '').trim(),
          itemId: String(request.params.itemId || '').trim(),
          updates: (request.body || {}) as Partial<
            Pick<
              StoryProposalItem,
              | 'title'
              | 'description'
              | 'businessOutcome'
              | 'acceptanceCriteria'
              | 'dependencies'
              | 'risks'
              | 'recommendedWorkflowId'
              | 'recommendedTaskType'
              | 'storyPoints'
              | 'tShirtSize'
              | 'sizingConfidence'
              | 'sizingRationale'
              | 'implementationNotes'
              | 'tags'
              | 'reviewState'
            >
          >,
          actor,
        });
        response.json(batch);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/story-proposals/:batchId/regenerate',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        const capabilityId = String(request.params.capabilityId || '').trim();
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.edit',
        });
        response.json(
          await regenerateStoryProposalBatch({
            capabilityId,
            batchId: String(request.params.batchId || '').trim(),
            request: (request.body || {}) as PlanningGenerationRequest,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/story-proposals/:batchId/promote',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');
        const capabilityId = String(request.params.capabilityId || '').trim();
        await assertCapabilityPermission({
          capabilityId,
          actor,
          action: 'capability.edit',
        });
        response.json(
          await promoteStoryProposalBatch({
            capabilityId,
            batchId: String(request.params.batchId || '').trim(),
            itemIds: Array.isArray(request.body?.itemIds)
              ? request.body.itemIds
                  .map((value: unknown) => String(value || '').trim())
                  .filter(Boolean)
              : undefined,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );
};
