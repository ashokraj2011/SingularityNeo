import type express from 'express';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import type { Capability, EffectivePermissionSet } from '../../src/contracts';
import { hasPermission } from '../domains/access';
import { evaluateBranchPolicy } from '../domains/model-policy';
import { normalizeCapabilityKind } from '../domains/self-service';
import { normalizeDirectoryPath } from '../workspacePaths';
import type { CodeWorkspaceStatus } from './types';

const execFileAsync = promisify(execFile);

export const ZERO_RUNTIME_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCostUsd: 0,
} as const;

export const toSafeDownloadName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'evidence';

export const runGitCommand = async (directoryPath: string, args: string[]) => {
  const result = await execFileAsync('git', ['-C', directoryPath, ...args], {
    cwd: directoryPath,
  });
  return (result.stdout || '').trim();
};

export const inspectCodeWorkspace = async (directoryPath: string): Promise<CodeWorkspaceStatus> => {
  const resolvedPath = normalizeDirectoryPath(directoryPath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      path: resolvedPath,
      exists: false,
      isGitRepository: false,
      currentBranch: null,
      pendingChanges: 0,
      lastCommit: null,
      error: 'Directory not found.',
    };
  }

  try {
    const gitStatus = await runGitCommand(resolvedPath, ['rev-parse', '--is-inside-work-tree']);
    if (gitStatus !== 'true') {
      return {
        path: resolvedPath,
        exists: true,
        isGitRepository: false,
        currentBranch: null,
        pendingChanges: 0,
        lastCommit: null,
        error: 'Directory is not a Git repository.',
      };
    }

    const [currentBranch, pendingStatus, lastCommit] = await Promise.all([
      runGitCommand(resolvedPath, ['branch', '--show-current']),
      runGitCommand(resolvedPath, ['status', '--short']),
      runGitCommand(resolvedPath, ['log', '-1', '--pretty=%h %s']).catch(() => ''),
    ]);

    return {
      path: resolvedPath,
      exists: true,
      isGitRepository: true,
      currentBranch: currentBranch || null,
      pendingChanges: pendingStatus ? pendingStatus.split('\n').filter(Boolean).length : 0,
      lastCommit: lastCommit || null,
    };
  } catch (error) {
    return {
      path: resolvedPath,
      exists: true,
      isGitRepository: false,
      currentBranch: null,
      pendingChanges: 0,
      lastCommit: null,
      error: error instanceof Error ? error.message : 'Unable to inspect repository.',
    };
  }
};

export const parseActor = (value: unknown, fallback: string) => {
  const actor = String(value || '').trim();
  return actor || fallback;
};

export const assertCapabilitySupportsExecution = (capability: Capability) => {
  if (normalizeCapabilityKind(capability.capabilityKind, capability.collectionKind) === 'COLLECTION') {
    throw new Error(
      `${capability.name} is a collection capability. Collection nodes are architecture and planning layers, so they cannot own work items or execution runs.`,
    );
  }
};

export const writeSseEvent = (
  response: express.Response,
  event: string,
  payload: unknown,
) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const buildBranchPolicyTargetId = ({
  workspacePath,
  branchName,
}: {
  workspacePath: string;
  branchName: string;
}) => `workspacePath=${workspacePath};branch=${branchName}`;

export const applyManualBranchPolicy = async ({
  capability,
  permissionSet,
  workspacePath,
  branchName,
}: {
  capability: Capability;
  permissionSet: EffectivePermissionSet;
  workspacePath: string;
  branchName: string;
}) => {
  const policyDecision = await evaluateBranchPolicy({
    capability,
    targetId: buildBranchPolicyTargetId({
      workspacePath,
      branchName,
    }),
  });
  const actorCanApprove = hasPermission(permissionSet, 'approval.decide');
  const blocked = policyDecision.decision === 'REQUIRE_APPROVAL' && !actorCanApprove;

  return {
    policyDecision,
    actorCanApprove,
    blocked,
  };
};
