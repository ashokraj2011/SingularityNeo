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
  wakeAgentLearningWorker();
  startIncidentWorker();
  wakeIncidentWorker();
  workersStarted = true;
};

export const bootstrapWorkspaceDatabaseAndStandards =
  async (): Promise<WorkspaceDatabaseBootstrapResult> => {
    await initializeDatabase();
    await loadAndApplyDesktopPreferences();
    await initializeSeedData();
    const catalogSnapshot = await initializeWorkspaceFoundations();
    ensureWorkersStarted();
    await ensureAgentLearningBackfill().catch(() => undefined);

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
