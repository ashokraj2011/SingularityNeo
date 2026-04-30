// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getDesktopExecutorRegistrationMock,
  getCapabilityBundleMock,
  resolveDesktopWorkspaceMock,
  refreshCapabilityCodeIndexMock,
  queueLocalCheckoutAstRefreshMock,
  getLocalCheckoutAstFreshnessMock,
} = vi.hoisted(() => ({
  getDesktopExecutorRegistrationMock: vi.fn(),
  getCapabilityBundleMock: vi.fn(),
  resolveDesktopWorkspaceMock: vi.fn(),
  refreshCapabilityCodeIndexMock: vi.fn(),
  queueLocalCheckoutAstRefreshMock: vi.fn(),
  getLocalCheckoutAstFreshnessMock: vi.fn(),
}));

vi.mock('../executionOwnership', () => ({
  getDesktopExecutorRegistration: getDesktopExecutorRegistrationMock,
}));

vi.mock('../domains/self-service/repository', () => ({
  getCapabilityBundle: getCapabilityBundleMock,
}));

vi.mock('../desktopWorkspaces', () => ({
  resolveDesktopWorkspace: resolveDesktopWorkspaceMock,
}));

vi.mock('../codeIndex/ingest', () => ({
  refreshCapabilityCodeIndex: refreshCapabilityCodeIndexMock,
}));

vi.mock('../localCodeIndex', () => ({
  queueLocalCheckoutAstRefresh: queueLocalCheckoutAstRefreshMock,
  getLocalCheckoutAstFreshness: getLocalCheckoutAstFreshnessMock,
}));

import {
  cancelPeriodicAstRefresh,
  runPeriodicAstRefreshPass,
  syncCapabilityRepositoriesForDesktop,
} from '../desktopRepoSync';

const runGit = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

const writeFile = (filePath: string, content: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
};

describe('desktopRepoSync AST refresh triggers', () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    getLocalCheckoutAstFreshnessMock.mockReturnValue('2026-04-30T13:00:00.000Z');
    refreshCapabilityCodeIndexMock.mockResolvedValue(undefined);
    resolveDesktopWorkspaceMock.mockResolvedValue(null);
  });

  afterEach(() => {
    cancelPeriodicAstRefresh('CAP-RULES');
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root && fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('queues AST refreshes only when a base clone changes or the cache is missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'singularityneo-repo-sync-'));
    tempRoots.push(root);

    const sourceRepo = path.join(root, 'source-repo');
    fs.mkdirSync(sourceRepo, { recursive: true });
    runGit(sourceRepo, ['init']);
    runGit(sourceRepo, ['config', 'user.email', 'codex@example.com']);
    runGit(sourceRepo, ['config', 'user.name', 'Codex']);
    runGit(sourceRepo, ['branch', '-M', 'main']);
    writeFile(
      path.join(sourceRepo, 'src', 'operators.ts'),
      'export const equalsOperator = (left: string, right: string) => left === right;\n',
    );
    runGit(sourceRepo, ['add', '.']);
    runGit(sourceRepo, ['commit', '-m', 'initial']);

    const workingDirectory = path.join(root, 'workspace');
    fs.mkdirSync(workingDirectory, { recursive: true });

    getDesktopExecutorRegistrationMock.mockResolvedValue({
      workingDirectory,
    });
    getCapabilityBundleMock.mockResolvedValue({
      capability: {
        id: 'CAP-RULES',
        name: 'RuleEngine',
        repositories: [
          {
            id: 'REPO-RULES',
            capabilityId: 'CAP-RULES',
            label: 'RuleEngine',
            url: sourceRepo,
            defaultBranch: 'main',
            isPrimary: true,
            status: 'ACTIVE',
          },
        ],
      },
    });

    const report = await syncCapabilityRepositoriesForDesktop({
      capabilityId: 'CAP-RULES',
      executorId: 'EXEC-1',
    });

    expect(report.repos).toHaveLength(1);
    expect(queueLocalCheckoutAstRefreshMock).toHaveBeenCalledTimes(1);

    await runPeriodicAstRefreshPass('CAP-RULES');
    expect(queueLocalCheckoutAstRefreshMock).toHaveBeenCalledTimes(1);

    const checkoutPath = report.repos[0]?.checkoutPath;
    expect(checkoutPath).toBeTruthy();

    writeFile(
      path.join(checkoutPath, 'src', 'operators.ts'),
      'export const equalsOperator = (left: string, right: string) => left !== right;\n',
    );

    await runPeriodicAstRefreshPass('CAP-RULES');
    expect(queueLocalCheckoutAstRefreshMock).toHaveBeenCalledTimes(2);

    runGit(checkoutPath, ['config', 'user.email', 'codex@example.com']);
    runGit(checkoutPath, ['config', 'user.name', 'Codex']);
    runGit(checkoutPath, ['add', '.']);
    runGit(checkoutPath, ['commit', '-m', 'local change']);

    await runPeriodicAstRefreshPass('CAP-RULES');
    expect(queueLocalCheckoutAstRefreshMock).toHaveBeenCalledTimes(3);
  });
});
