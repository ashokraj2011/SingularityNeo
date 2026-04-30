import type express from 'express';
import { assertCapabilityPermission } from '../access';
import { sendApiError } from '../api/errors';
import {
  closeAgentBranchSession,
  commitPatchArtifactToSession,
  getWorkItemAgentGitSnapshot,
  openSessionPullRequest,
  startAgentBranchSession,
} from '../agentGit/service';
import { parseActorContext } from '../requestActor';
import { getCapabilityBundle } from '../domains/self-service';

const mapAgentGitStatus = (
  status:
    | 'NO_REPOSITORY'
    | 'REPO_URL_INVALID'
    | 'AUTH_MISSING'
    | 'RATE_LIMITED'
    | 'NOT_FOUND'
    | 'VALIDATION'
    | 'CONFLICT'
    | 'NETWORK'
    | 'ERROR',
): number => {
  switch (status) {
    case 'AUTH_MISSING':
      return 401;
    case 'RATE_LIMITED':
      return 429;
    case 'NOT_FOUND':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'VALIDATION':
    case 'NO_REPOSITORY':
    case 'REPO_URL_INVALID':
      return 400;
    case 'NETWORK':
      return 502;
    case 'ERROR':
    default:
      return 500;
  }
};

export const registerAgentGitRoutes = (app: express.Express) => {
  app.get(
    '/api/capabilities/:capabilityId/work-items/:workItemId/agent-git',
    async (request, response) => {
      try {
        const capabilityId = request.params.capabilityId;
        const workItemId = request.params.workItemId;
        await assertCapabilityPermission({
          capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'capability.read',
        });
        const snapshot = await getWorkItemAgentGitSnapshot({
          capabilityId,
          workItemId,
        });
        response.json(snapshot);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/work-items/:workItemId/agent-git/start-session',
    async (request, response) => {
      try {
        const capabilityId = request.params.capabilityId;
        const workItemId = request.params.workItemId;
        await assertCapabilityPermission({
          capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'capability.edit',
        });
        const body = (request.body || {}) as { repositoryId?: string };

        const bundle = await getCapabilityBundle(capabilityId);
        const workItem = bundle.workspace.workItems.find(item => item.id === workItemId);
        if (!workItem) {
          response.status(404).json({
            error: `Work item ${workItemId} was not found on capability ${capabilityId}.`,
          });
          return;
        }

        const result = await startAgentBranchSession({
          capabilityId,
          workItem: { id: workItem.id, title: workItem.title },
          repositories: bundle.capability.repositories || [],
          repositoryId: body.repositoryId,
        });
        if (result.ok === false) {
          response.status(mapAgentGitStatus(result.status)).json({
            error: result.message,
            status: result.status,
          });
          return;
        }
        response.json({
          session: result.session,
          reused: result.reused,
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/agent-git/sessions/:sessionId/commit-patch',
    async (request, response) => {
      try {
        const capabilityId = request.params.capabilityId;
        const sessionId = request.params.sessionId;
        await assertCapabilityPermission({
          capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'capability.edit',
        });
        const body = (request.body || {}) as {
          artifactId?: string;
          message?: string;
          authorName?: string;
          authorEmail?: string;
        };
        const result = await commitPatchArtifactToSession({
          capabilityId,
          sessionId,
          artifactId: body.artifactId,
          message: body.message,
          authorName: body.authorName,
          authorEmail: body.authorEmail,
        });
        if (result.ok === false) {
          response.status(mapAgentGitStatus(result.status)).json({
            error: result.message,
            status: result.status,
          });
          return;
        }
        response.json(result.result);
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/agent-git/sessions/:sessionId/open-pr',
    async (request, response) => {
      try {
        const capabilityId = request.params.capabilityId;
        const sessionId = request.params.sessionId;
        await assertCapabilityPermission({
          capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'capability.edit',
        });
        const body = (request.body || {}) as {
          title?: string;
          body?: string;
          draft?: boolean;
        };
        const result = await openSessionPullRequest({
          capabilityId,
          sessionId,
          title: body.title,
          body: body.body,
          draft: body.draft,
        });
        if (result.ok === false) {
          response.status(mapAgentGitStatus(result.status)).json({
            error: result.message,
            status: result.status,
          });
          return;
        }
        response.json({
          session: result.session,
          pullRequest: result.pullRequest,
        });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );

  app.post(
    '/api/capabilities/:capabilityId/agent-git/sessions/:sessionId/close',
    async (request, response) => {
      try {
        const capabilityId = request.params.capabilityId;
        const sessionId = request.params.sessionId;
        await assertCapabilityPermission({
          capabilityId,
          actor: parseActorContext(request, 'Workspace Operator'),
          action: 'capability.edit',
        });
        const result = await closeAgentBranchSession({
          capabilityId,
          sessionId,
        });
        if (result.ok === false) {
          response.status(mapAgentGitStatus(result.status)).json({
            error: result.message,
            status: result.status,
          });
          return;
        }
        response.json({ session: result.session });
      } catch (error) {
        sendApiError(response, error);
      }
    },
  );
};
