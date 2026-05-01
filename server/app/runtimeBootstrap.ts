import { isDesktopExecutionRuntime, loadAndApplyDesktopPreferences, reconcileDesktopExecutionOwnerships } from '../domains/local-runner';
import { ensureAgentLearningBackfill, startAgentLearningWorker, wakeAgentLearningWorker } from '../domains/agent-learning';
import {
  getPool,
  initializeDatabase,
  inspectDatabaseBootstrapStatus,
  readWorkspaceDatabaseBootstrapProfileSnapshot,
  setDatabaseRuntimeConfig,
  writeWorkspaceDatabaseBootstrapEnvSnapshot,
  writeWorkspaceDatabaseBootstrapProfileSnapshot,
} from '../domains/platform';
import {
  initializeSeedData,
  initializeWorkspaceFoundations,
} from '../domains/self-service';
import { startExecutionWorker } from '../execution/worker';
import { startIncidentWorker, wakeIncidentWorker } from '../incidents/worker';
import { restoreBaseCloneRegistryFromDisk } from '../desktopRepoSync';
import type { WorkspaceDatabaseBootstrapProfileSnapshot, WorkspaceDatabaseBootstrapResult } from '../../src/contracts';
import { databaseBootstrapStatePath, envLocalPath } from './projectPaths';

let workersStarted = false;
let startupInitializationPromise: Promise<void> | null = null;

export const ensureWorkersStarted = () => {
  if (workersStarted) {
    return;
  }

  if (!isDesktopExecutionRuntime()) {
    startExecutionWorker();
  }
  startAgentLearningWorker();
  // wakeAgentLearningWorker() — disabled; let the worker poll naturally
  // instead of immediately draining stale QUEUED jobs from previous runs.
  startIncidentWorker();
  wakeIncidentWorker();
  workersStarted = true;
};

export const bootstrapWorkspaceDatabaseAndStandards =
  async (): Promise<WorkspaceDatabaseBootstrapResult> => {
    await initializeDatabase();
    await loadAndApplyDesktopPreferences();
    await restoreBaseCloneRegistryFromDisk();
    await initializeSeedData();
    const catalogSnapshot = await initializeWorkspaceFoundations();

    // ── Cancel stale learning jobs from previous runs ────────────
    // On restart, old QUEUED/LEARNING jobs would be picked up by the
    // worker and trigger LLM calls. Cancel them so profiles are only
    // regenerated on demand (agent create/update).
    try {
      const { query: dbQuery } = await import('../db');
      const cancelled = await dbQuery(
        `UPDATE capability_agent_learning_jobs
         SET status = 'CANCELLED', completed_at = NOW(), updated_at = NOW()
         WHERE status IN ('QUEUED', 'LEARNING')`,
      );
      if (cancelled.rowCount && cancelled.rowCount > 0) {
        console.log(`[runtimeBootstrap] cancelled ${cancelled.rowCount} stale agent learning job(s) from previous run`);
      }
    } catch {
      // DB may not have the table yet on first run — safe to ignore.
    }

    ensureWorkersStarted();
    // ── Agent learning backfill DISABLED on startup ──────────────
    // ensureAgentLearningBackfill() enqueues an LLM call per agent
    // whose profile is STALE/NOT_STARTED/ERROR. On every restart
    // this fires for ALL agents (~10+ LLM calls at $0.003 each).
    // Profiles persist in the DB and only need regeneration when an
    // agent definition changes — which is handled by the capability
    // management routes (create/update). Re-enable only if you need
    // a one-time backfill for new agents without profiles.
    // await ensureAgentLearningBackfill().catch(() => undefined);

    return {
      status: await inspectDatabaseBootstrapStatus(),
      catalogSnapshot,
    };
  };

const initializePersistentWorkspace = async () => {
  await bootstrapWorkspaceDatabaseAndStandards();
};

export const ensurePersistentWorkspaceInitialization = () => {
  if (!startupInitializationPromise) {
    startupInitializationPromise = initializePersistentWorkspace().catch(error => {
      startupInitializationPromise = null;
      throw error;
    });
  }

  return startupInitializationPromise;
};

export const awaitStartupInitialization = async () => {
  if (!startupInitializationPromise) {
    return;
  }

  await startupInitializationPromise.catch(() => undefined);
};

export const getDatabaseBootstrapProfileSnapshot =
  async (): Promise<WorkspaceDatabaseBootstrapProfileSnapshot> =>
    readWorkspaceDatabaseBootstrapProfileSnapshot(
      databaseBootstrapStatePath,
      envLocalPath,
    );

export const persistDatabaseBootstrapProfileSnapshot = async (
  snapshot: WorkspaceDatabaseBootstrapProfileSnapshot,
) => {
  await writeWorkspaceDatabaseBootstrapProfileSnapshot(
    databaseBootstrapStatePath,
    snapshot,
  );
  await writeWorkspaceDatabaseBootstrapEnvSnapshot(envLocalPath, snapshot);
};

export const hydratePersistedDatabaseBootstrapRuntime = async () => {
  const snapshot = await getDatabaseBootstrapProfileSnapshot();
  const activeProfile =
    snapshot.profiles.find(profile => profile.id === snapshot.activeProfileId) ||
    snapshot.profiles[0];

  if (!activeProfile) {
    return;
  }

  await setDatabaseRuntimeConfig({
    host: activeProfile.host,
    port: activeProfile.port,
    databaseName: activeProfile.databaseName,
    user: activeProfile.user,
    adminDatabaseName: activeProfile.adminDatabaseName,
    ...(activeProfile.password ? { password: activeProfile.password } : {}),
  });
};

export const closeDatabasePool = async () => {
  try {
    const pool = await getPool();
    await pool.end();
  } catch {
    // pool may already be closed; ignore
  }
};

export { reconcileDesktopExecutionOwnerships };
