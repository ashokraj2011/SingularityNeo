// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  findApprovedWorkspaceRoot,
  getCapabilityWorkspaceRoots,
  isWorkspacePathApproved,
} from '../workspacePaths';

describe('workspace path approval', () => {
  it('approves the configured root and child paths under it', () => {
    const approvedRoots = ['/Users/example/work/todo-app'];

    expect(isWorkspacePathApproved('/Users/example/work/todo-app', approvedRoots)).toBe(true);
    expect(isWorkspacePathApproved('/Users/example/work/todo-app/src', approvedRoots)).toBe(true);
    expect(findApprovedWorkspaceRoot('/Users/example/work/todo-app/src', approvedRoots)).toBe(
      '/Users/example/work/todo-app',
    );
  });

  it('rejects sibling prefix paths that only look similar', () => {
    const approvedRoots = ['/Users/example/work/todo-app'];

    expect(isWorkspacePathApproved('/Users/example/work/todo-app-copy/src', approvedRoots)).toBe(
      false,
    );
  });

  it('normalizes capability workspace roots from all configured sources', () => {
    expect(
      getCapabilityWorkspaceRoots({
        localDirectories: ['/workspace/todo-app'],
        executionConfig: {
          defaultWorkspacePath: '/workspace/todo-app/src',
          allowedWorkspacePaths: ['/workspace/todo-app'],
          commandTemplates: [],
          deploymentTargets: [],
        },
      }),
    ).toEqual(['/workspace/todo-app/src', '/workspace/todo-app']);
  });
});
