import type express from 'express';
import type { Capability } from '../../src/types';
import { assertCapabilityPermission } from '../access';
import { sendApiError } from '../api/errors';
import { parseActorContext } from '../requestActor';
import { getCapabilityBundle } from '../repository';
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

type CodeWorkspaceRouteDeps = {
  applyManualBranchPolicy: (args: {
    capability: Capability;
    permissionSet: Awaited<ReturnType<typeof assertCapabilityPermission>>['permissionSet'];
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
  { applyManualBranchPolicy, inspectCodeWorkspace, runGitCommand }: CodeWorkspaceRouteDeps,
) => {
  app.get('/api/capabilities/:capabilityId/code-workspaces', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      const bundle = await getCapabilityBundle(request.params.capabilityId);
      const workspaces = await Promise.all(
        getCapabilityWorkspaceRoots(bundle.capability).map(directoryPath =>
          inspectCodeWorkspace(directoryPath),
        ),
      );

      response.json(workspaces);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/code-workspaces/branch', async (request, response) => {
    const requestedPath = String(request.body?.path || '').trim();
    const branchName = String(request.body?.branchName || '').trim();

    if (!requestedPath || !branchName) {
      response.status(400).json({
        error: 'Both path and branchName are required.',
      });
      return;
    }

    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      const permissionContext = await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'capability.edit',
      });
      const bundle = await getCapabilityBundle(request.params.capabilityId);
      const allowedPaths = getCapabilityWorkspaceRoots(bundle.capability);
      const resolvedPath = normalizeDirectoryPath(requestedPath);

      if (!isWorkspacePathApproved(resolvedPath, allowedPaths)) {
        response.status(403).json({
          error: 'This directory is not registered under the selected capability.',
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
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${branchName}`,
      ]).catch(() => '');

      if (existingBranch) {
        response.status(409).json({
          error: `Branch ${branchName} already exists in ${resolvedPath}.`,
        });
        return;
      }

      await runGitCommand(resolvedPath, ['switch', '-c', branchName]);
      response.status(201).json({
        ...(await inspectCodeWorkspace(resolvedPath)),
        policyDecision,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
