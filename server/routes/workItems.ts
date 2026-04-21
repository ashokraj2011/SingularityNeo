import type express from 'express';
import type {
  Capability,
  WorkItem,
  WorkItemAttachmentUpload,
  WorkItemCheckoutSession,
  WorkItemPhase,
} from '../../src/types';
import { normalizeWorkItemPhaseStakeholders } from '../../src/lib/workItemStakeholders';
import { normalizeWorkItemTaskType } from '../../src/lib/workItemTaskTypes';
import { assertCapabilityPermission } from '../access';
import { sendApiError } from '../api/errors';
import { listActiveWorkItemClaims, listWorkItemPresence, listWorkflowRunsForWorkItem, releaseWorkItemClaim, upsertWorkItemClaim, upsertWorkItemPresence } from '../execution/repository';
import { archiveWorkItemControl, cancelWorkItemControl, createWorkItemRecord, moveWorkItemToPhaseControl, restoreWorkItemControl, startWorkflowExecution } from '../execution/service';
import { wakeExecutionWorker } from '../execution/worker';
import { parseActorContext } from '../requestActor';
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
} from '../repository';
import {
  getCapabilityWorkspaceRoots,
  isWorkspacePathApproved,
  normalizeDirectoryPath,
} from '../workspacePaths';

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
    permissionSet: Awaited<ReturnType<typeof assertCapabilityPermission>>['permissionSet'];
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
  app.post('/api/capabilities/:capabilityId/work-items', async (request, response) => {
    const title = String(request.body?.title || '').trim();
    const workflowId = String(request.body?.workflowId || '').trim();
    const description = String(request.body?.description || '').trim();
    const rawTaskType = String(request.body?.taskType || '').trim();
    const taskType = rawTaskType ? normalizeWorkItemTaskType(rawTaskType) : undefined;
    const priority = String(request.body?.priority || 'Med') as WorkItem['priority'];
    const tags = Array.isArray(request.body?.tags)
      ? request.body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
      : [];
    const phaseStakeholders = normalizeWorkItemPhaseStakeholders(
      Array.isArray(request.body?.phaseStakeholders) ? request.body.phaseStakeholders : [],
    );
    const attachments = Array.isArray(request.body?.attachments)
      ? request.body.attachments
          .map((attachment: Partial<WorkItemAttachmentUpload>) => ({
            fileName: String(attachment?.fileName || '').trim(),
            mimeType: String(attachment?.mimeType || '').trim() || undefined,
            contentText: String(attachment?.contentText || ''),
            sizeBytes:
              typeof attachment?.sizeBytes === 'number' && Number.isFinite(attachment.sizeBytes)
                ? attachment.sizeBytes
                : undefined,
          }))
          .filter(attachment => attachment.fileName && attachment.contentText.trim().length > 0)
      : [];

    if (!title || !workflowId) {
      response.status(400).json({
        error: 'Both title and workflowId are required.',
      });
      return;
    }

    try {
      assertCapabilitySupportsExecution(
        (await getCapabilityBundle(request.params.capabilityId)).capability,
      );
      const actor = parseActorContext(
        request,
        parseActor(request.body?.guidedBy, 'Capability Owner'),
      );
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.create',
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
  });

  app.post('/api/capabilities/:capabilityId/work-items/:workItemId/move', async (request, response) => {
    const targetPhase = String(request.body?.targetPhase || '').trim() as WorkItemPhase;
    const note = String(request.body?.note || '').trim();
    const cancelRunIfPresent = Boolean(request.body?.cancelRunIfPresent);

    if (!targetPhase) {
      response.status(400).json({ error: 'A targetPhase is required.' });
      return;
    }

    try {
      const actor = parseActorContext(request, 'Capability Owner');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
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
  });

  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/cancel',
    async (request, response) => {
      try {
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        assertCapabilitySupportsExecution(bundle.capability);

        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
        });

        response.json(
          await cancelWorkItemControl({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            note: String(request.body?.note || '').trim() || undefined,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/archive',
    async (request, response) => {
      try {
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        assertCapabilitySupportsExecution(bundle.capability);

        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
        });

        response.json(
          await archiveWorkItemControl({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            note: String(request.body?.note || '').trim() || undefined,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/restore',
    async (request, response) => {
      try {
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        assertCapabilitySupportsExecution(bundle.capability);

        const actor = parseActorContext(request, 'Workspace Operator');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
        });

        response.json(
          await restoreWorkItemControl({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            note: String(request.body?.note || '').trim() || undefined,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    '/api/capabilities/:capabilityId/work-items/:workItemId/collaboration',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'workitem.read',
        });
        const [claims, presence] = await Promise.all([
          listActiveWorkItemClaims(request.params.capabilityId, request.params.workItemId),
          listWorkItemPresence(request.params.capabilityId, request.params.workItemId),
        ]);
        response.json({ claims, presence });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    '/api/capabilities/:capabilityId/work-items/:workItemId/execution-context',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'workitem.read',
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
    '/api/capabilities/:capabilityId/work-items/:workItemId/execution-context/initialize',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Capability Owner');
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
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
    '/api/capabilities/:capabilityId/work-items/:workItemId/branch/create',
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Capability Owner');
        const permissionContext = await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
        });
        const context = await initializeWorkItemExecutionContextRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          actorUserId: actor.userId,
        });
        if (!context.branch || !context.primaryRepositoryId) {
          throw new Error('Work item execution context did not resolve a primary repository.');
        }

        const bundle = await getCapabilityBundle(request.params.capabilityId);
        const repository = (bundle.capability.repositories || []).find(
          item => item.id === context.primaryRepositoryId,
        );
        const workspaceRoot = normalizeDirectoryPath(repository?.localRootHint || '');
        if (!workspaceRoot) {
          throw new Error(
            'This repository does not have a local root hint yet, so Singulairy cannot create the shared Git branch.',
          );
        }

        const approvedPaths = getCapabilityWorkspaceRoots(bundle.capability);
        if (!isWorkspacePathApproved(workspaceRoot, approvedPaths)) {
          throw new Error(
            'The repository local root is not inside an approved capability workspace path.',
          );
        }

        const workspaceStatus = await inspectCodeWorkspace(workspaceRoot);
        if (!workspaceStatus.exists || !workspaceStatus.isGitRepository) {
          throw new Error(
            workspaceStatus.error ||
              'The repository local root exists but is not a Git repository.',
          );
        }

        const branchName = context.branch.sharedBranch;
        const baseBranch = context.branch.baseBranch || repository?.defaultBranch || 'main';
        const { policyDecision, blocked } = await applyManualBranchPolicy({
          capability: permissionContext.capability,
          permissionSet: permissionContext.permissionSet,
          workspacePath: workspaceRoot,
          branchName,
        });
        if (blocked) {
          response.status(403).json({
            error: (policyDecision as { reason?: string }).reason,
            requiresApproval: true,
            policyDecision,
          });
          return;
        }
        const existingBranch = await runGitCommand(workspaceRoot, [
          'rev-parse',
          '--verify',
          '--quiet',
          `refs/heads/${branchName}`,
        ]).catch(() => '');

        if (existingBranch) {
          await runGitCommand(workspaceRoot, ['switch', branchName]);
        } else {
          try {
            await runGitCommand(workspaceRoot, ['switch', '-c', branchName, baseBranch]);
          } catch {
            await runGitCommand(workspaceRoot, ['switch', '-c', branchName]);
          }
        }

        const headSha = await runGitCommand(workspaceRoot, ['rev-parse', 'HEAD']).catch(
          () => '',
        );
        const nextContext = await updateWorkItemBranchRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          branch: {
            ...context.branch,
            createdByUserId: actor.userId || context.branch.createdByUserId,
            headSha: headSha || context.branch.headSha,
            status: 'ACTIVE',
          },
        });

        if (actor.userId) {
          await upsertWorkItemCheckoutSessionRecord({
            capabilityId: request.params.capabilityId,
            session: {
              workItemId: request.params.workItemId,
              userId: actor.userId,
              repositoryId: context.primaryRepositoryId,
              localPath: workspaceRoot,
              branch: branchName,
              lastSeenHeadSha: headSha || undefined,
              lastSyncedAt: new Date().toISOString(),
            },
          });
        }

        response.status(201).json({
          context: nextContext,
          workspace: await inspectCodeWorkspace(workspaceRoot),
          repository,
          policyDecision,
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/claim/write',
    async (request, response) => {
      const actor = parseActorContext(request, 'Capability Owner');
      if (!actor.userId) {
        response.status(400).json({ error: 'Choose an operator before taking write control.' });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
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
          claimType: 'WRITE',
          status: 'ACTIVE',
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
    '/api/capabilities/:capabilityId/work-items/:workItemId/claim/write',
    async (request, response) => {
      const actor = parseActorContext(request, 'Capability Owner');
      if (!actor.userId) {
        response.status(400).json({ error: 'Choose an operator before releasing write control.' });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
        });
        await releaseWorkItemCodeClaimRecord({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          claimType: 'WRITE',
          userId: actor.userId,
        });
        response.status(204).end();
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    '/api/capabilities/:capabilityId/work-items/:workItemId/handoff',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'workitem.read',
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
    '/api/capabilities/:capabilityId/work-items/:workItemId/handoff',
    async (request, response) => {
      const actor = parseActorContext(request, 'Capability Owner');
      const summary = String(request.body?.summary || '').trim();
      if (!summary) {
        response.status(400).json({ error: 'A handoff summary is required.' });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
        });
        const packet = await createWorkItemHandoffPacketRecord({
          capabilityId: request.params.capabilityId,
          packet: {
            id: createRuntimeId('HANDOFF'),
            workItemId: request.params.workItemId,
            fromUserId: actor.userId,
            toUserId: String(request.body?.toUserId || '').trim() || undefined,
            fromTeamId: actor.teamIds[0],
            toTeamId: String(request.body?.toTeamId || '').trim() || undefined,
            summary,
            openQuestions: Array.isArray(request.body?.openQuestions)
              ? request.body.openQuestions
                  .map((value: unknown) => String(value || '').trim())
                  .filter(Boolean)
              : [],
            blockingDependencies: Array.isArray(request.body?.blockingDependencies)
              ? request.body.blockingDependencies
                  .map((value: unknown) => String(value || '').trim())
                  .filter(Boolean)
              : [],
            recommendedNextStep:
              String(request.body?.recommendedNextStep || '').trim() || undefined,
            artifactIds: Array.isArray(request.body?.artifactIds)
              ? request.body.artifactIds
                  .map((value: unknown) => String(value || '').trim())
                  .filter(Boolean)
              : [],
            traceIds: Array.isArray(request.body?.traceIds)
              ? request.body.traceIds
                  .map((value: unknown) => String(value || '').trim())
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
    '/api/capabilities/:capabilityId/work-items/:workItemId/handoff/:packetId/accept',
    async (request, response) => {
      const actor = parseActorContext(request, 'Capability Owner');
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
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
            claimType: 'WRITE',
            status: 'ACTIVE',
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
    '/api/capabilities/:capabilityId/work-items/:workItemId/checkout/register',
    async (request, response) => {
      const actor = parseActorContext(request, 'Capability Owner');
      const userId = actor.userId || String(request.body?.userId || '').trim();
      if (!userId) {
        response.status(400).json({ error: 'A user id is required to register a checkout.' });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
        });
        const session = await upsertWorkItemCheckoutSessionRecord({
          capabilityId: request.params.capabilityId,
          session: {
            workItemId: request.params.workItemId,
            userId,
            repositoryId: String(request.body?.repositoryId || '').trim(),
            localPath: String(request.body?.localPath || '').trim() || undefined,
            branch: String(request.body?.branch || '').trim(),
            lastSeenHeadSha:
              String(request.body?.lastSeenHeadSha || '').trim() || undefined,
            lastSyncedAt:
              String(request.body?.lastSyncedAt || '').trim() || new Date().toISOString(),
          } satisfies WorkItemCheckoutSession,
        });
        response.status(201).json(session);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/claim',
    async (request, response) => {
      const actor = parseActorContext(request, 'Capability Owner');
      if (!actor.userId) {
        response.status(400).json({ error: 'Choose an operator before taking control.' });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
        });
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        const workItem = bundle.workspace.workItems.find(
          item => item.id === request.params.workItemId,
        );
        if (!workItem) {
          throw new Error(`Work item ${request.params.workItemId} was not found.`);
        }

        const claim = await upsertWorkItemClaim({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          userId: actor.userId,
          teamId: actor.teamIds[0],
          status: 'ACTIVE',
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
              action: 'Work item claimed',
              detail: `${actor.displayName} took active operator control of this work item.`,
              phase: workItem.phase,
              status: workItem.status,
            },
          ],
        };
        await replaceCapabilityWorkspaceContentRecord(request.params.capabilityId, {
          workItems: bundle.workspace.workItems.map(item =>
            item.id === nextWorkItem.id ? nextWorkItem : item,
          ),
        });
        response.status(201).json({ claim, workItem: nextWorkItem });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.delete(
    '/api/capabilities/:capabilityId/work-items/:workItemId/claim',
    async (request, response) => {
      const actor = parseActorContext(request, 'Capability Owner');
      if (!actor.userId) {
        response.status(400).json({ error: 'Choose an operator before releasing control.' });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
        });
        await releaseWorkItemClaim({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          userId: actor.userId,
        });
        const bundle = await getCapabilityBundle(request.params.capabilityId);
        const nextWorkItems = bundle.workspace.workItems.map(item =>
          item.id === request.params.workItemId && item.claimOwnerUserId === actor.userId
            ? {
                ...item,
                claimOwnerUserId: undefined,
                recordVersion: (item.recordVersion || 1) + 1,
              }
            : item,
        );
        await replaceCapabilityWorkspaceContentRecord(request.params.capabilityId, {
          workItems: nextWorkItems,
        });
        response.status(204).end();
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/presence',
    async (request, response) => {
      const actor = parseActorContext(request, 'Capability Owner');
      if (!actor.userId) {
        response.status(400).json({ error: 'Choose an operator before updating presence.' });
        return;
      }

      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.read',
        });
        const presence = await upsertWorkItemPresence({
          capabilityId: request.params.capabilityId,
          workItemId: request.params.workItemId,
          userId: actor.userId,
          teamId: actor.teamIds[0],
          viewContext: String(request.body?.viewContext || '').trim() || undefined,
          lastSeenAt: new Date().toISOString(),
        });
        response.status(201).json(presence);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post('/api/capabilities/:capabilityId/work-items/:workItemId/runs', async (request, response) => {
    try {
      assertCapabilitySupportsExecution(
        (await getCapabilityBundle(request.params.capabilityId)).capability,
      );
      const actor = parseActorContext(
        request,
        parseActor(request.body?.guidedBy, 'Capability Owner'),
      );
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'workitem.control',
      });
      await initializeWorkItemExecutionContextRecord({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        actorUserId: actor.userId,
      }).catch(() => null);
      const detail = await startWorkflowExecution({
        capabilityId: request.params.capabilityId,
        workItemId: request.params.workItemId,
        restartFromPhase: request.body?.restartFromPhase as WorkItemPhase | undefined,
        guidance: String(request.body?.guidance || '').trim() || undefined,
        guidedBy: actor.displayName,
        actor,
      });
      wakeExecutionWorker();
      response.status(201).json(detail);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/work-items/:workItemId/runs', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'workitem.read',
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
  });
};
