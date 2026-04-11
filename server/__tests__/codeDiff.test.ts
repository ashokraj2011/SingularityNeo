// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';
import type {
  Capability,
  Workflow,
  WorkflowRunDetail,
  WorkflowRunStep,
  WorkflowStep,
} from '../../src/types';
import { captureCodeDiffReviewArtifact } from '../execution/codeDiff';

const runGit = (cwd: string, args: string[]) =>
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
  })
    .toString()
    .trim();

const buildCapability = (workspacePath: string): Capability => ({
  id: 'CAP-DIFF',
  name: 'Diff Capability',
  description: 'Capability for diff review testing.',
  businessOutcome: 'Review code diffs before implementation advances.',
  successMetrics: ['Developer changes are visible at approval time.'],
  definitionOfDone: 'A code diff artifact exists for changed files.',
  requiredEvidenceKinds: ['Code diff'],
  operatingPolicySummary: 'Developer code changes require approval review.',
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  localDirectories: [workspacePath],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    defaultWorkspacePath: workspacePath,
    allowedWorkspacePaths: [workspacePath],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'STABLE',
  skillLibrary: [],
});

const buildWorkflow = (step: WorkflowStep): Workflow => ({
  id: 'WF-DIFF',
  name: 'Diff Workflow',
  capabilityId: 'CAP-DIFF',
  steps: [step],
  status: 'STABLE',
});

const buildRunStep = (): WorkflowRunStep => ({
  id: 'RUNSTEP-DIFF',
  capabilityId: 'CAP-DIFF',
  runId: 'RUN-DIFF',
  workflowNodeId: 'STEP-DIFF',
  workflowStepId: 'STEP-DIFF',
  stepIndex: 0,
  phase: 'DEVELOPMENT',
  name: 'Implementation',
  stepType: 'DELIVERY',
  agentId: 'AGENT-DEV',
  status: 'RUNNING',
  attemptCount: 1,
  lastToolInvocationId: 'TOOL-WRITE',
});

const buildRunDetail = (workflow: Workflow): WorkflowRunDetail => ({
  run: {
    id: 'RUN-DIFF',
    capabilityId: 'CAP-DIFF',
    workItemId: 'WI-DIFF',
    workflowId: workflow.id,
    status: 'RUNNING',
    attemptNumber: 1,
    workflowSnapshot: workflow,
    currentNodeId: 'STEP-DIFF',
    currentStepId: 'STEP-DIFF',
    currentPhase: 'DEVELOPMENT',
    assignedAgentId: 'AGENT-DEV',
    branchState: {
      pendingNodeIds: ['STEP-DIFF'],
      activeNodeIds: ['STEP-DIFF'],
      completedNodeIds: [],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  steps: [buildRunStep()],
  waits: [],
  toolInvocations: [],
});

describe('captureCodeDiffReviewArtifact', () => {
  it('builds a diff artifact for tracked and newly created files', async () => {
    const workspacePath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'singularity-code-diff-'),
    );
    const step: WorkflowStep = {
      id: 'STEP-DIFF',
      name: 'Implementation',
      phase: 'DEVELOPMENT',
      stepType: 'DELIVERY',
      agentId: 'AGENT-DEV',
      action: 'Implement the requested change.',
      allowedToolIds: ['workspace_write'],
    };
    const workflow = buildWorkflow(step);
    const runDetail = buildRunDetail(workflow);
    const runStep = runDetail.steps[0];
    const trackedFile = path.join(workspacePath, 'src', 'app.ts');
    const newFile = path.join(workspacePath, 'src', 'power.ts');

    try {
      await fs.mkdir(path.join(workspacePath, 'src'), { recursive: true });
      runGit(workspacePath, ['init']);
      runGit(workspacePath, ['config', 'user.email', 'codex@example.com']);
      runGit(workspacePath, ['config', 'user.name', 'Codex']);
      await fs.writeFile(trackedFile, 'export const value = 1;\n', 'utf8');
      runGit(workspacePath, ['add', '.']);
      runGit(workspacePath, ['commit', '-m', 'initial']);

      await fs.writeFile(trackedFile, 'export const value = 2;\n', 'utf8');
      await fs.writeFile(newFile, 'export const power = (a: number, b: number) => a ** b;\n', 'utf8');

      const artifact = await captureCodeDiffReviewArtifact({
        capability: buildCapability(workspacePath),
        detail: runDetail,
        step,
        runStep,
        touchedPaths: [trackedFile, newFile],
      });

      expect(artifact).not.toBeNull();
      expect(artifact?.artifactKind).toBe('CODE_DIFF');
      expect(artifact?.summary).toContain('changed files');
      expect(artifact?.contentText).toContain('Implementation Code Diff Review');
      expect(artifact?.contentText).toContain('src/app.ts');
      expect(artifact?.contentText).toContain('src/power.ts');
      expect(artifact?.contentText).toContain('```diff');
      expect(artifact?.contentText).toContain('+export const power');
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  });

  it('returns null when touched files are not inside a git repository', async () => {
    const workspacePath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'singularity-no-diff-'),
    );
    const step: WorkflowStep = {
      id: 'STEP-DIFF',
      name: 'Implementation',
      phase: 'DEVELOPMENT',
      stepType: 'DELIVERY',
      agentId: 'AGENT-DEV',
      action: 'Implement the requested change.',
      allowedToolIds: ['workspace_write'],
    };
    const workflow = buildWorkflow(step);
    const runDetail = buildRunDetail(workflow);
    const runStep = runDetail.steps[0];
    const filePath = path.join(workspacePath, 'src', 'app.ts');

    try {
      await fs.mkdir(path.join(workspacePath, 'src'), { recursive: true });
      await fs.writeFile(filePath, 'console.log("hello");\n', 'utf8');

      const artifact = await captureCodeDiffReviewArtifact({
        capability: buildCapability(workspacePath),
        detail: runDetail,
        step,
        runStep,
        touchedPaths: [filePath],
      });

      expect(artifact).toBeNull();
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  });
});
