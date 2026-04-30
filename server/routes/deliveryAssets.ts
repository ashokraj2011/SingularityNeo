import { createHash } from 'node:crypto';
import path from 'node:path';
import type express from 'express';
import type { Capability, PermissionAction } from '../../src/types';
import { assertCapabilityPermission } from '../access';
import { sendApiError } from '../api/errors';
import {
  buildCapabilityConnectorContext,
  publishArtifactToConfluence,
  syncCapabilityConfluenceContext,
  syncCapabilityGithubContext,
  syncCapabilityJiraContext,
  transitionJiraIssue,
} from '../connectors';
import { continueWorkflowStageControl } from '../execution/service';
import { wakeAgentLearningWorker } from '../agentLearning/worker';
import {
  buildWorkItemFlightRecorderDetail,
  getFlightRecorderDownloadName,
  renderWorkItemFlightRecorderMarkdown,
} from '../flightRecorder';
import {
  buildWorkItemEvidenceBundle,
  getCompletedWorkOrderEvidence,
  getLedgerArtifactContent,
} from '../ledger';
import { refreshCapabilityMemory } from '../memory';
import { parseActorContext } from '../requestActor';
import {
  getCapabilityBundle,
  getWorkspaceSettings,
} from '../domains/self-service';
import {
  createCapabilityArtifactUploadRecord,
  getCapabilityArtifact,
  getCapabilityArtifactFileBytes,
} from '../domains/tool-plane';

type DeliveryAssetRouteDeps = {
  assertCapabilitySupportsExecution: (capability: Capability) => void;
  toSafeDownloadName: (value: string) => string;
  uploadFilesMiddleware: express.RequestHandler;
};

export const registerDeliveryAssetRoutes = (
  app: express.Express,
  {
    assertCapabilitySupportsExecution,
    toSafeDownloadName,
    uploadFilesMiddleware,
  }: DeliveryAssetRouteDeps,
) => {
  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/stage-control/continue',
    async (request, response) => {
      const body = request.body as {
        conversation?: Array<{
          role?: 'user' | 'agent';
          content?: string;
          timestamp?: string;
        }>;
        carryForwardNote?: string;
        resolvedBy?: string;
      };

      try {
        const actor = parseActorContext(
          request,
          typeof body.resolvedBy === 'string' && body.resolvedBy.trim()
            ? body.resolvedBy.trim()
            : 'Capability Owner',
        );
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor,
          action: 'workitem.control',
        });
        response.json(
          await continueWorkflowStageControl({
            capabilityId: request.params.capabilityId,
            workItemId: request.params.workItemId,
            conversation: (body.conversation || [])
              .filter(
                entry =>
                  (entry.role === 'user' || entry.role === 'agent') &&
                  typeof entry.content === 'string',
              )
              .map(entry => ({
                role: entry.role as 'user' | 'agent',
                content: String(entry.content || ''),
                timestamp:
                  typeof entry.timestamp === 'string' ? entry.timestamp : undefined,
              })),
            carryForwardNote:
              typeof body.carryForwardNote === 'string'
                ? body.carryForwardNote
                : undefined,
            resolvedBy: actor.displayName,
            actor,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    '/api/capabilities/:capabilityId/work-items/:workItemId/flight-recorder/download',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'telemetry.read',
        });
        const format = request.query.format === 'markdown' ? 'markdown' : 'json';
        const detail = await buildWorkItemFlightRecorderDetail(
          request.params.capabilityId,
          request.params.workItemId,
        );
        response.setHeader(
          'Content-Type',
          format === 'markdown'
            ? 'text/markdown; charset=utf-8'
            : 'application/json; charset=utf-8',
        );
        response.setHeader(
          'Content-Disposition',
          `attachment; filename="${getFlightRecorderDownloadName({
            title: `${detail.workItem.id}-${detail.workItem.title}-flight-recorder`,
            format,
          })}"`,
        );
        response.send(
          format === 'markdown'
            ? renderWorkItemFlightRecorderMarkdown(detail)
            : JSON.stringify(detail, null, 2),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get('/api/capabilities/:capabilityId/work-items/:workItemId/evidence', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'artifact.read',
      });
      response.json(
        await getCompletedWorkOrderEvidence(
          request.params.capabilityId,
          request.params.workItemId,
        ),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/connectors', async (request, response) => {
    try {
      response.json(await buildCapabilityConnectorContext(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/connectors/github/sync', async (request, response) => {
    try {
      const [bundle, settings] = await Promise.all([
        getCapabilityBundle(request.params.capabilityId),
        getWorkspaceSettings(),
      ]);
      response.json(
        await syncCapabilityGithubContext(bundle.capability, settings.connectors),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/connectors/jira/sync', async (request, response) => {
    try {
      const [bundle, settings] = await Promise.all([
        getCapabilityBundle(request.params.capabilityId),
        getWorkspaceSettings(),
      ]);
      response.json(await syncCapabilityJiraContext(bundle.capability, settings.connectors));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/connectors/jira/transition', async (request, response) => {
    try {
      response.json(
        await transitionJiraIssue({
          capabilityId: request.params.capabilityId,
          issueKey: String(request.body?.issueKey || ''),
          transitionId: String(request.body?.transitionId || ''),
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post(
    '/api/capabilities/:capabilityId/connectors/confluence/sync',
    async (request, response) => {
      try {
        const [bundle, settings] = await Promise.all([
          getCapabilityBundle(request.params.capabilityId),
          getWorkspaceSettings(),
        ]);
        response.json(
          await syncCapabilityConfluenceContext(bundle.capability, settings.connectors),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/connectors/confluence/publish',
    async (request, response) => {
      try {
        response.json(
          await publishArtifactToConfluence({
            capabilityId: request.params.capabilityId,
            artifactId: String(request.body?.artifactId || ''),
            title:
              typeof request.body?.title === 'string' ? request.body.title : undefined,
            parentPageId:
              typeof request.body?.parentPageId === 'string'
                ? request.body.parentPageId
                : undefined,
          }),
        );
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    '/api/capabilities/:capabilityId/artifacts/:artifactId/blob',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'artifact.read',
        });

        const artifact = await getCapabilityArtifact(
          request.params.capabilityId,
          request.params.artifactId,
        );

        if (!artifact) {
          response.status(404).json({ error: 'Artifact was not found.' });
          return;
        }

        const file = await getCapabilityArtifactFileBytes(
          request.params.capabilityId,
          request.params.artifactId,
        );

        if (!file) {
          response.status(404).json({ error: 'Artifact blob was not found.' });
          return;
        }

        const inline =
          request.query.inline === '1' || String(request.query.inline || '') === 'true';
        const fileName = artifact.fileName || `${request.params.artifactId}.bin`;

        response.setHeader('Content-Type', artifact.mimeType || 'application/octet-stream');
        response.setHeader('Content-Length', String(file.sizeBytes));
        response.setHeader(
          'Content-Disposition',
          `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`,
        );
        response.send(file.bytes);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get('/api/capabilities/:capabilityId/artifacts/:artifactId/content', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'artifact.read',
      });
      response.json(
        await getLedgerArtifactContent(
          request.params.capabilityId,
          request.params.artifactId,
        ),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/artifacts/:artifactId/download', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'artifact.read',
      });
      const content = await getLedgerArtifactContent(
        request.params.capabilityId,
        request.params.artifactId,
      );

      if (content.contentFormat === 'BINARY' || content.hasBinary) {
        const file = await getCapabilityArtifactFileBytes(
          request.params.capabilityId,
          request.params.artifactId,
        );

        if (file) {
          response.setHeader('Content-Type', content.mimeType);
          response.setHeader('Content-Length', String(file.sizeBytes));
          response.setHeader(
            'Content-Disposition',
            `attachment; filename="${content.fileName}"`,
          );
          response.send(file.bytes);
          return;
        }
      }

      response.setHeader('Content-Type', content.mimeType);
      response.setHeader('Content-Disposition', `attachment; filename="${content.fileName}"`);
      response.send(
        content.contentFormat === 'JSON'
          ? JSON.stringify(content.contentJson || {}, null, 2)
          : content.contentText || '',
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/uploads',
    uploadFilesMiddleware,
    async (request, response) => {
      try {
        const actor = parseActorContext(request, 'Workspace Operator');

        const authActions: PermissionAction[] = [
          'workitem.control',
          'approval.decide',
          'artifact.publish',
        ];
        let authorized = false;
        let firstError: unknown = null;

        for (const action of authActions) {
          try {
            await assertCapabilityPermission({
              capabilityId: request.params.capabilityId,
              actor,
              action,
            });
            authorized = true;
            break;
          } catch (error) {
            if (!firstError) firstError = error;
          }
        }

        if (!authorized) {
          throw firstError instanceof Error ? firstError : new Error('Forbidden.');
        }

        const bundle = await getCapabilityBundle(request.params.capabilityId);
        assertCapabilitySupportsExecution(bundle.capability);

        const workItem = bundle.workspace.workItems.find(
          item => item.id === request.params.workItemId,
        );
        if (!workItem) {
          response.status(404).json({ error: 'Work item was not found.' });
          return;
        }

        const workflow = bundle.workspace.workflows.find(
          item => item.id === workItem.workflowId,
        );

        const files = Array.isArray(request.files) ? request.files : [];
        if (files.length === 0) {
          response.status(400).json({ error: 'At least one file is required.' });
          return;
        }

        const allowedExtensions = new Set([
          '.png',
          '.jpg',
          '.jpeg',
          '.webp',
          '.gif',
          '.pdf',
          '.txt',
          '.md',
          '.json',
          '.csv',
          '.doc',
          '.docx',
        ]);
        const allowedMimePrefixes = ['image/', 'text/'];
        const allowedMimes = new Set([
          'application/pdf',
          'application/json',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/csv',
        ]);

        const toFileSlug = (value: string) =>
          value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80) || 'artifact';

        const createArtifactId = () =>
          `ART-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

        const normalizeMime = (value: string) => String(value || '').trim().toLowerCase();
        const inferContentFormat = (file: Express.Multer.File) => {
          const mime = normalizeMime(file.mimetype);
          const ext = path.extname(file.originalname || '').toLowerCase();

          if (mime.includes('json') || ext === '.json') {
            return 'JSON' as const;
          }

          if (mime.includes('markdown') || ext === '.md') {
            return 'MARKDOWN' as const;
          }

          if (mime.startsWith('text/')) {
            return 'TEXT' as const;
          }

          return 'BINARY' as const;
        };

        const createdArtifacts = [];

        for (const file of files) {
          const mime = normalizeMime(file.mimetype);
          const ext = path.extname(file.originalname || '').toLowerCase();
          const passesAllowlist =
            Boolean(
              mime &&
                (allowedMimePrefixes.some(prefix => mime.startsWith(prefix)) ||
                  allowedMimes.has(mime)),
            ) || allowedExtensions.has(ext);

          if (!passesAllowlist) {
            response.status(400).json({
              error: `Unsupported upload type for "${file.originalname}".`,
            });
            return;
          }

          const contentFormat = inferContentFormat(file);
          let contentText: string | undefined;
          let contentJson: Record<string, any> | any[] | undefined;

          if (contentFormat !== 'BINARY') {
            const decoded = file.buffer.toString('utf-8');
            if (contentFormat === 'JSON') {
              try {
                contentJson = JSON.parse(decoded);
              } catch {
                contentText = decoded;
              }
            } else {
              contentText = decoded;
            }
          }

          const sha256 = createHash('sha256').update(file.buffer).digest('hex');
          const artifact = {
            id: createArtifactId(),
            name: `${workItem.title} · ${file.originalname}`,
            capabilityId: bundle.capability.id,
            type: mime.startsWith('image/') ? 'Reference Image' : 'Reference Document',
            inputs: [],
            version: `phase-${toFileSlug(workItem.phase || 'work')}`,
            agent: actor.displayName || 'User Upload',
            created: new Date().toISOString(),
            direction: 'INPUT' as const,
            connectedAgentId: workItem.assignedAgentId,
            sourceWorkflowId: workflow?.id,
            summary: `Uploaded ${file.originalname} for ${workItem.id}.`,
            artifactKind: 'UPLOAD' as const,
            phase: workItem.phase,
            workItemId: workItem.id,
            contentFormat,
            mimeType: mime || 'application/octet-stream',
            fileName: file.originalname,
            contentText,
            contentJson,
            downloadable: true,
          };

          await createCapabilityArtifactUploadRecord({
            capabilityId: request.params.capabilityId,
            artifact,
            file: {
              bytes: file.buffer,
              sizeBytes: file.size,
              sha256,
            },
          });

          createdArtifacts.push(artifact);
        }

        await refreshCapabilityMemory(request.params.capabilityId, {
          requeueAgents: true,
          requestReason: 'work-item-uploaded',
        }).catch(() => undefined);
        wakeAgentLearningWorker();

        response.status(201).json({ artifacts: createdArtifacts });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.get(
    '/api/capabilities/:capabilityId/work-items/:workItemId/evidence-bundle',
    async (request, response) => {
      try {
        await assertCapabilityPermission({
          capabilityId: request.params.capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'artifact.read',
        });
        const bundle = await buildWorkItemEvidenceBundle(
          request.params.capabilityId,
          request.params.workItemId,
        );
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader(
          'Content-Disposition',
          `attachment; filename="${toSafeDownloadName(bundle.detail.workItem.title)}-evidence-bundle.json"`,
        );
        response.send(JSON.stringify(bundle, null, 2));
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );
};
