/**
 * Desktop Repository Sync
 *
 * When a desktop executor claims a capability, this module ensures every
 * configured repository is present as a local clone inside the executor's
 * working directory.  It also builds (or queues a build of) the in-memory
 * AST index for each clone so that chat and agent runs get `ast-grounded-local-clone`
 * quality grounding without waiting for a work-item checkout.
 *
 * The module also maintains an in-memory registry of base clone paths that
 * other services (astGrounding, chatWorkspace) can query without needing to
 * know the executor or working-directory details.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CapabilityRepository } from '../src/types';
import {
  buildCapabilityBaseRepositoryPath,
} from './workItemCheckouts';
import { getDesktopExecutorRegistration } from './executionOwnership';
import {
  getCapabilityBundle,
} from './domains/self-service/repository';
import { resolveDesktopWorkspace } from './desktopWorkspaces';
import { refreshCapabilityCodeIndex } from './codeIndex/ingest';
import {
  queueLocalCheckoutAstRefresh,
  getLocalCheckoutAstFreshness,
} from './localCodeIndex';
import { normalizeDirectoryPath } from './workspacePaths';

// ---------------------------------------------------------------------------
// In-memory registry — maps capabilityId → list of base clone entries.
// Written by syncCapabilityRepositoriesForDesktop(); read by astGrounding.ts.
// ---------------------------------------------------------------------------

export interface CapabilityBaseCloneEntry {
  repositoryId: string;
  repositoryLabel: string;
  checkoutPath: string;
  isPrimary: boolean;
  syncedAt: string;
  /** undefined = not yet checked */
  isGitRepo?: boolean;
}

const baseCloneRegistry = new Map<string, CapabilityBaseCloneEntry[]>();

interface CheckoutChangeFingerprint {
  branch: string;
  headSha: string;
  workingTreeDigest: string;
  dirty: boolean;
  token: string;
}

interface BaseCloneRefreshState {
  lastQueuedFingerprint?: CheckoutChangeFingerprint;
  lastObservedAt?: string;
  lastRefreshReason?: string;
}

const baseCloneRefreshState = new Map<string, BaseCloneRefreshState>();
const capabilityCodeIndexRefreshes = new Map<string, Promise<void>>();
const capabilityCodeIndexQueuedRoots = new Map<string, Record<string, string>>();

/**
 * Returns the registered base clone entries for a capability, or an empty
 * array if the capability has not been synced yet.
 */
export const getCapabilityBaseClones = (
  capabilityId: string,
): CapabilityBaseCloneEntry[] => baseCloneRegistry.get(capabilityId) ?? [];

/**
 * Returns the primary (or first) base clone entry for a capability.
 * Used by astGrounding.ts when no work-item checkout is available.
 */
export const getPrimaryBaseClone = (
  capabilityId: string,
): CapabilityBaseCloneEntry | undefined => {
  const entries = getCapabilityBaseClones(capabilityId);
  return entries.find(e => e.isPrimary && e.isGitRepo) ?? entries.find(e => e.isGitRepo);
};

// ---------------------------------------------------------------------------
// Git helpers (thin wrappers — the real impl lives in workItems.ts / index.ts)
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

/** Runs a git command and returns trimmed stdout.  Throws on non-zero exit. */
const runGit = async (cwd: string, args: string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout?.trim() ?? '';
  } catch (err: any) {
    const msg = (err?.stderr as string | undefined)?.trim() || err?.message || String(err);
    throw new Error(msg);
  }
};

/**
 * Returns true when the given directory is the root of a git working tree.
 * Returns false (never throws) when the directory doesn't exist or is not a repo.
 */
const isGitRepository = async (dirPath: string): Promise<boolean> => {
  if (!fs.existsSync(dirPath)) return false;
  try {
    const result = await runGit(dirPath, ['rev-parse', '--is-inside-work-tree']);
    return result === 'true';
  } catch {
    return false;
  }
};

/**
 * Clones `repositoryUrl` into `checkoutPath` on `defaultBranch`.
 * Falls back to a full clone if the branch-specific clone fails.
 */
const cloneRepository = async ({
  repositoryUrl,
  checkoutPath,
  defaultBranch,
}: {
  repositoryUrl: string;
  checkoutPath: string;
  defaultBranch: string;
}): Promise<void> => {
  const parent = path.dirname(checkoutPath);
  fs.mkdirSync(parent, { recursive: true });

  try {
    await runGit(parent, [
      'clone',
      '--branch', defaultBranch,
      '--single-branch',
      repositoryUrl,
      checkoutPath,
    ]);
  } catch {
    // Branch not found or other failure — attempt a full clone.
    await runGit(parent, ['clone', repositoryUrl, checkoutPath]);
  }
};

/**
 * Fetches the latest changes on the current branch of an existing clone.
 * Does nothing (no throw) if the network is unreachable.
 */
const fetchRepository = async (checkoutPath: string): Promise<void> => {
  try {
    await runGit(checkoutPath, ['fetch', '--quiet', '--prune']);
  } catch {
    // Network unreachable — leave the existing clone as-is.
  }
};

const buildCheckoutChangeFingerprint = async (
  checkoutPath: string,
): Promise<CheckoutChangeFingerprint | null> => {
  if (!(await isGitRepository(checkoutPath))) {
    return null;
  }

  const [branch, headSha, statusOutput] = await Promise.all([
    runGit(checkoutPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
    runGit(checkoutPath, ['rev-parse', 'HEAD']).catch(() => ''),
    runGit(checkoutPath, ['status', '--short', '--untracked-files=normal']).catch(() => ''),
  ]);

  const normalizedBranch = String(branch || '').trim();
  const normalizedHeadSha = String(headSha || '').trim();
  const normalizedStatus = String(statusOutput || '').trim();
  if (!normalizedBranch && !normalizedHeadSha && !normalizedStatus) {
    return null;
  }

  const workingTreeDigest = createHash('sha1')
    .update(normalizedStatus)
    .digest('hex');
  const token = createHash('sha1')
    .update([normalizedBranch, normalizedHeadSha, normalizedStatus].join('\n--\n'))
    .digest('hex');

  return {
    branch: normalizedBranch,
    headSha: normalizedHeadSha,
    workingTreeDigest,
    dirty: Boolean(normalizedStatus),
    token,
  };
};

const queueCapabilityCodeIndexRefresh = ({
  capabilityId,
  localRepositoryRoots,
}: {
  capabilityId: string;
  localRepositoryRoots: Record<string, string>;
}) => {
  if (Object.keys(localRepositoryRoots).length === 0) {
    return;
  }

  const mergedRoots = {
    ...(capabilityCodeIndexQueuedRoots.get(capabilityId) ?? {}),
    ...localRepositoryRoots,
  };
  capabilityCodeIndexQueuedRoots.set(capabilityId, mergedRoots);

  if (capabilityCodeIndexRefreshes.has(capabilityId)) {
    return;
  }

  const refresh = (async () => {
    while (true) {
      const nextRoots = capabilityCodeIndexQueuedRoots.get(capabilityId);
      capabilityCodeIndexQueuedRoots.delete(capabilityId);
      if (!nextRoots || Object.keys(nextRoots).length === 0) {
        break;
      }

      try {
        await refreshCapabilityCodeIndex(capabilityId, {
          localRepositoryRoots: nextRoots,
        });
      } catch (err) {
        console.error(
          `[desktopRepoSync] capability code index refresh failed for ${capabilityId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  })().finally(() => {
    capabilityCodeIndexRefreshes.delete(capabilityId);
  });

  capabilityCodeIndexRefreshes.set(capabilityId, refresh);
};

const resolveBaseCloneRefreshReason = ({
  previous,
  current,
  freshness,
  forcedReason,
}: {
  previous?: CheckoutChangeFingerprint;
  current?: CheckoutChangeFingerprint | null;
  freshness?: string;
  forcedReason?: string;
}) => {
  if (forcedReason) {
    return forcedReason;
  }
  if (!freshness) {
    return 'ast-missing';
  }
  if (!current) {
    return null;
  }
  if (!previous) {
    return 'checkout-state-untracked';
  }
  if (previous.headSha !== current.headSha) {
    return 'git-head-changed';
  }
  if (previous.branch !== current.branch) {
    return 'git-branch-changed';
  }
  if (previous.workingTreeDigest !== current.workingTreeDigest) {
    return current.dirty ? 'working-tree-changed' : 'working-tree-cleaned';
  }
  return null;
};

const queueBaseCloneAstRefresh = ({
  capabilityId,
  entry,
  fingerprint,
  reason,
  includeCapabilityCodeIndexRefresh = true,
}: {
  capabilityId: string;
  entry: CapabilityBaseCloneEntry;
  fingerprint?: CheckoutChangeFingerprint | null;
  reason: string;
  includeCapabilityCodeIndexRefresh?: boolean;
}) => {
  queueLocalCheckoutAstRefresh({
    checkoutPath: entry.checkoutPath,
    capabilityId,
    repositoryId: entry.repositoryId,
  });
  if (includeCapabilityCodeIndexRefresh) {
    queueCapabilityCodeIndexRefresh({
      capabilityId,
      localRepositoryRoots: {
        [entry.repositoryId]: entry.checkoutPath,
      },
    });
  }
  baseCloneRefreshState.set(entry.checkoutPath, {
    lastQueuedFingerprint: fingerprint || undefined,
    lastObservedAt: new Date().toISOString(),
    lastRefreshReason: reason,
  });
  console.log(
    `[desktopRepoSync] AST refresh queued for ${entry.repositoryLabel} (${capabilityId}) because ${reason}`,
  );
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RepoSyncResult {
  repositoryId: string;
  repositoryLabel: string;
  checkoutPath: string;
  status: 'cloned' | 'updated' | 'already-current' | 'skipped' | 'error';
  error?: string;
}

export interface CapabilityRepoSyncReport {
  capabilityId: string;
  executorId: string;
  workingDirectory: string;
  repos: RepoSyncResult[];
  syncedAt: string;
}

/**
 * Checks whether each repository configured on the capability has a local
 * clone in the executor's working directory.  Missing repos are cloned;
 * existing clones are kept as-is (or optionally fetched when `fetch: true`).
 *
 * After cloning, the in-memory AST index for each repo is queued for a
 * refresh so that code grounding is available immediately.
 *
 * The capability code index is also refreshed with the local clone paths so
 * that subsequent ingest jobs prefer reading from disk rather than the GitHub
 * API.
 *
 * Designed to be called fire-and-forget from the claim endpoint.
 */
export const syncCapabilityRepositoriesForDesktop = async ({
  capabilityId,
  executorId,
  actorUserId,
  fetch = false,
}: {
  capabilityId: string;
  executorId: string;
  /**
   * The operator's user ID.  When provided and the executor has no global
   * `SINGULARITY_WORKING_DIRECTORY` set, the function falls back to the
   * per-capability workspace mapping that the operator saved in the UI
   * (stored in `desktop_user_workspace_mappings`).
   */
  actorUserId?: string;
  /**
   * When true, run `git fetch` on already-cloned repos to pull the latest
   * remote changes.  Defaults to false so the initial claim is fast.
   */
  fetch?: boolean;
}): Promise<CapabilityRepoSyncReport> => {
  // 1. Resolve working directory.
  //    Priority order:
  //    a. executor.workingDirectory  (set via SINGULARITY_WORKING_DIRECTORY env var)
  //    b. per-capability workspace mapping saved through the UI
  //       (desktop_user_workspace_mappings.working_directory_path)
  const registration = await getDesktopExecutorRegistration(executorId);
  let workingDirectory = registration?.workingDirectory
    ? normalizeDirectoryPath(registration.workingDirectory)
    : '';

  if (!workingDirectory && actorUserId) {
    const resolution = await resolveDesktopWorkspace({
      executorId,
      userId: actorUserId,
      capabilityId,
    }).catch(() => null);
    if (resolution?.workingDirectoryPath) {
      workingDirectory = normalizeDirectoryPath(resolution.workingDirectoryPath);
    }
  }

  if (!workingDirectory) {
    console.warn(
      `[desktopRepoSync] executor ${executorId} has no workingDirectory for ${capabilityId} — ` +
      `set SINGULARITY_WORKING_DIRECTORY or save a Desktop Workspace mapping in the Operations page`,
    );
    return {
      capabilityId,
      executorId,
      workingDirectory: '',
      repos: [],
      syncedAt: new Date().toISOString(),
    };
  }

  // 2. Load capability bundle (needed for the slug + repository list).
  const bundle = await getCapabilityBundle(capabilityId).catch(() => null);
  const repositories: CapabilityRepository[] = bundle?.capability.repositories ?? [];

  if (!repositories.length) {
    console.log(
      `[desktopRepoSync] capability ${capabilityId} has no repositories — nothing to sync`,
    );
    return {
      capabilityId,
      executorId,
      workingDirectory,
      repos: [],
      syncedAt: new Date().toISOString(),
    };
  }

  const capability = bundle!.capability;
  const results: RepoSyncResult[] = [];
  const registryEntries: CapabilityBaseCloneEntry[] = [];
  const localRepositoryRoots: Record<string, string> = {};

  // 3. For each repository — ensure clone exists and queue AST refresh.
  for (const repo of repositories) {
    if (repo.status === 'ARCHIVED') {
      results.push({
        repositoryId: repo.id,
        repositoryLabel: repo.label || repo.url,
        checkoutPath: '',
        status: 'skipped',
      });
      continue;
    }

    const checkoutPath = buildCapabilityBaseRepositoryPath({
      workingDirectoryPath: workingDirectory,
      capability,
      repository: repo,
    });

    if (!checkoutPath) {
      results.push({
        repositoryId: repo.id,
        repositoryLabel: repo.label || repo.url,
        checkoutPath: '',
        status: 'error',
        error: 'Could not build checkout path — workingDirectory may be invalid',
      });
      continue;
    }

    let status: RepoSyncResult['status'] = 'already-current';
    let error: string | undefined;

    try {
      const alreadyCloned = await isGitRepository(checkoutPath);

      if (alreadyCloned) {
        if (fetch) {
          await fetchRepository(checkoutPath);
          status = 'updated';
        } else {
          status = 'already-current';
        }
      } else {
        if (!repo.url) {
          throw new Error(`Repository ${repo.id} has no URL configured`);
        }
        await cloneRepository({
          repositoryUrl: repo.url,
          checkoutPath,
          defaultBranch: repo.defaultBranch || 'main',
        });
        status = 'cloned';
        console.log(
          `[desktopRepoSync] cloned ${repo.url} → ${checkoutPath}`,
        );
      }

      // 4. Queue AST refresh when the clone is new or the local cache is missing.
      const fingerprint = await buildCheckoutChangeFingerprint(checkoutPath).catch(() => null);
      const freshness = getLocalCheckoutAstFreshness(checkoutPath);
      const forcedReason = status === 'cloned' ? 'repo-cloned' : undefined;
      const refreshReason = resolveBaseCloneRefreshReason({
        previous: baseCloneRefreshState.get(checkoutPath)?.lastQueuedFingerprint,
        current: fingerprint,
        freshness,
        forcedReason,
      });
      if (refreshReason) {
        queueBaseCloneAstRefresh({
          capabilityId,
          entry: {
            repositoryId: repo.id,
            repositoryLabel: repo.label || repo.url,
            checkoutPath,
            isPrimary: Boolean(repo.isPrimary),
            syncedAt: new Date().toISOString(),
            isGitRepo: true,
          },
          fingerprint,
          reason: refreshReason,
          includeCapabilityCodeIndexRefresh: false,
        });
      }

      // 5. Record in the local roots map for the capability code index.
      localRepositoryRoots[repo.id] = checkoutPath;

      registryEntries.push({
        repositoryId: repo.id,
        repositoryLabel: repo.label || repo.url,
        checkoutPath,
        isPrimary: Boolean(repo.isPrimary),
        syncedAt: new Date().toISOString(),
        isGitRepo: true,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      status = 'error';
      console.error(
        `[desktopRepoSync] failed to sync repo ${repo.id} for capability ${capabilityId}: ${error}`,
      );
      registryEntries.push({
        repositoryId: repo.id,
        repositoryLabel: repo.label || repo.url,
        checkoutPath,
        isPrimary: Boolean(repo.isPrimary),
        syncedAt: new Date().toISOString(),
        isGitRepo: false,
      });
    }

    results.push({
      repositoryId: repo.id,
      repositoryLabel: repo.label || repo.url,
      checkoutPath,
      status,
      error,
    });
  }

  // 6. Update in-memory registry so astGrounding can resolve base clone paths.
  baseCloneRegistry.set(capabilityId, registryEntries);

  // 7. Refresh the capability code index using local clones where available.
  //    Run in the background — do not block the caller.
  queueCapabilityCodeIndexRefresh({
    capabilityId,
    localRepositoryRoots,
  });

  const report: CapabilityRepoSyncReport = {
    capabilityId,
    executorId,
    workingDirectory,
    repos: results,
    syncedAt: new Date().toISOString(),
  };

  const cloned = results.filter(r => r.status === 'cloned').length;
  const updated = results.filter(r => r.status === 'updated').length;
  const errors = results.filter(r => r.status === 'error').length;
  console.log(
    `[desktopRepoSync] ${capabilityId}: cloned=${cloned} updated=${updated} errors=${errors}`,
  );

  // Start (or re-arm) the periodic AST refresh loop for this capability now
  // that the registry is populated.
  schedulePeriodicAstRefresh(capabilityId);

  return report;
};

// ---------------------------------------------------------------------------
// Periodic AST refresh
//
// After the initial clone/claim, code on disk can change (git pull, editor
// saves, branch switches).  To keep the in-memory AST index current without
// requiring a full re-claim, we run a self-rescheduling loop per capability
// that:
//   1. git-fetches each registered base clone (background, ignores network
//      errors so an offline laptop never breaks the loop)
//   2. Queues a non-blocking AST re-index only when the working tree/HEAD
//      changed or the local AST cache is missing
//
// The loop uses setTimeout (not setInterval) so that if the work takes
// longer than the interval it simply delays the next tick rather than
// piling up concurrent refreshes.
// ---------------------------------------------------------------------------

/** How often each base clone is checked for AST-relevant repo changes. */
const AST_REFRESH_INTERVAL_MS =
  Number(process.env.AST_REFRESH_INTERVAL_MS) || 5 * 60 * 1000;

// One active timer handle per capability — prevents duplicate loops when
// syncCapabilityRepositoriesForDesktop is called multiple times (e.g. re-claim).
const periodicRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const runPeriodicAstRefreshPass = async (capabilityId: string): Promise<void> => {
  const entries = getCapabilityBaseClones(capabilityId).filter(e => e.isGitRepo);
  if (entries.length === 0) return;

  for (const entry of entries) {
    // 1. git fetch — pull latest refs from remote so the tree is up-to-date.
    //    fetchRepository already swallows network errors silently.
    await fetchRepository(entry.checkoutPath);

    // 2. Re-index only if the repo content actually changed or the AST cache is missing.
    const freshness = getLocalCheckoutAstFreshness(entry.checkoutPath);
    const previous = baseCloneRefreshState.get(entry.checkoutPath)?.lastQueuedFingerprint;
    const current = await buildCheckoutChangeFingerprint(entry.checkoutPath).catch(() => null);
    const refreshReason = resolveBaseCloneRefreshReason({
      previous,
      current,
      freshness,
    });
    if (refreshReason) {
      queueBaseCloneAstRefresh({
        capabilityId,
        entry,
        fingerprint: current,
        reason: refreshReason,
      });
    } else {
      baseCloneRefreshState.set(entry.checkoutPath, {
        ...baseCloneRefreshState.get(entry.checkoutPath),
        lastObservedAt: new Date().toISOString(),
      });
    }
  }
};

/**
 * Starts (or re-arms) the periodic AST refresh loop for a capability.
 * Safe to call multiple times — only one timer runs per capability.
 */
export const schedulePeriodicAstRefresh = (capabilityId: string): void => {
  // Clear any existing timer so re-claiming doesn't create a second loop.
  const existing = periodicRefreshTimers.get(capabilityId);
  if (existing !== undefined) clearTimeout(existing);

  const tick = () => {
    runPeriodicAstRefreshPass(capabilityId)
      .catch(err =>
        console.warn(
          `[desktopRepoSync] periodic AST refresh error for ${capabilityId}:`,
          err instanceof Error ? err.message : err,
        ),
      )
      .finally(() => {
        // Re-schedule unless the capability was removed from the registry.
        if (getCapabilityBaseClones(capabilityId).length > 0) {
          periodicRefreshTimers.set(capabilityId, setTimeout(tick, AST_REFRESH_INTERVAL_MS));
        } else {
          periodicRefreshTimers.delete(capabilityId);
        }
      });
  };

  periodicRefreshTimers.set(capabilityId, setTimeout(tick, AST_REFRESH_INTERVAL_MS));
};

/**
 * Cancels the periodic refresh loop for a capability (e.g. executor unclaim).
 */
export const cancelPeriodicAstRefresh = (capabilityId: string): void => {
  const timer = periodicRefreshTimers.get(capabilityId);
  if (timer !== undefined) {
    clearTimeout(timer);
    periodicRefreshTimers.delete(capabilityId);
  }
  capabilityCodeIndexQueuedRoots.delete(capabilityId);
  const entries = getCapabilityBaseClones(capabilityId);
  for (const entry of entries) {
    baseCloneRefreshState.delete(entry.checkoutPath);
  }
};
