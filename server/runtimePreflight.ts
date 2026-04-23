import fs from 'node:fs';
import path from 'node:path';
import type {
  RuntimePreflightSnapshot,
  RuntimeReadinessCheck,
  RuntimeReadinessState,
  WorkspaceDatabaseRuntimeInfo,
} from '../src/types';
import {
  decodeWorkspaceDatabaseBootstrapProfileSnapshot,
  resolveActiveWorkspaceDatabaseBootstrapProfileId,
} from './databaseProfiles';
import {
  getDatabaseRuntimeInfo,
  inspectDatabaseBootstrapStatus,
} from './db';

export const deriveReadinessState = (
  checks: RuntimeReadinessCheck[],
): RuntimeReadinessState => {
  if (checks.some(check => check.status === 'blocked')) {
    return 'blocked';
  }
  if (checks.some(check => check.status === 'degraded')) {
    return 'degraded';
  }
  return 'healthy';
};

const buildDatabaseProfileContext = (
  databaseRuntime: WorkspaceDatabaseRuntimeInfo,
) => {
  const databaseProfileSnapshot = decodeWorkspaceDatabaseBootstrapProfileSnapshot({
    encodedProfiles: process.env.WORKSPACE_DB_PROFILES_B64,
    activeProfileId: process.env.WORKSPACE_ACTIVE_DB_PROFILE_ID,
  });
  const activeDatabaseProfileId =
    resolveActiveWorkspaceDatabaseBootstrapProfileId(
      databaseProfileSnapshot,
      databaseRuntime,
    ) || null;
  const activeDatabaseProfile =
    databaseProfileSnapshot.profiles.find(
      profile => profile.id === activeDatabaseProfileId,
    ) || null;

  return {
    activeDatabaseProfileId,
    activeDatabaseProfileLabel: activeDatabaseProfile?.label || null,
  };
};

const inspectRendererBuild = (): RuntimeReadinessCheck => {
  const distIndexPath = path.resolve(process.cwd(), 'dist', 'index.html');
  if (!fs.existsSync(distIndexPath)) {
    return {
      id: 'renderer-build',
      label: 'Renderer build',
      status: 'degraded',
      message: 'No built renderer was found in dist/. API-only startup can continue.',
      remediation: 'Run npm run build for web/server packaging or npm run desktop:build for Electron.',
    };
  }

  return {
    id: 'renderer-build',
    label: 'Renderer build',
    status: 'healthy',
    message: 'A renderer bundle is available in dist/.',
  };
};

const inspectGovernanceSigning = (): RuntimeReadinessCheck => {
  const keyPath = String(process.env.GOVERNANCE_SIGNING_KEY_PATH || '').trim();
  const keyId = String(process.env.GOVERNANCE_SIGNING_ACTIVE_KEY_ID || '').trim();
  if (keyPath && keyId) {
    return {
      id: 'governance-signing',
      label: 'Governance signing',
      status: 'healthy',
      message: 'Governance signing key configuration is present.',
    };
  }

  return {
    id: 'governance-signing',
    label: 'Governance signing',
    status: 'degraded',
    message: 'Evidence packets can be created, but signed attestations are not fully configured.',
    remediation:
      'Set GOVERNANCE_SIGNING_KEY_PATH and GOVERNANCE_SIGNING_ACTIVE_KEY_ID before production attestation use.',
  };
};

export const buildRuntimePreflight = async ({
  runtimeConfigured,
  runtimeProvider,
  runtimeAccessMode,
  tokenSource,
}: {
  runtimeConfigured?: boolean;
  runtimeProvider?: string;
  runtimeAccessMode?: string;
  tokenSource?: string | null;
} = {}): Promise<RuntimePreflightSnapshot> => {
  const databaseStatus = await inspectDatabaseBootstrapStatus();
  const databaseRuntime = getDatabaseRuntimeInfo();
  const profileContext = buildDatabaseProfileContext(databaseRuntime);

  const checks: RuntimeReadinessCheck[] = [
    {
      id: 'database',
      label: 'Database',
      status: databaseStatus.ready ? 'healthy' : 'blocked',
      message: databaseStatus.ready
        ? `Database ${databaseRuntime.databaseName} is reachable and initialized.`
        : databaseStatus.lastError ||
          databaseRuntime.lastConnectionError ||
          `Database ${databaseRuntime.databaseName} is not ready.`,
      remediation: databaseStatus.ready
        ? undefined
        : 'Open Workspace Databases, select the intended profile, and initialize or repair the database.',
    },
    {
      id: 'database-profile',
      label: 'Active DB profile',
      status: profileContext.activeDatabaseProfileId ? 'healthy' : 'degraded',
      message: profileContext.activeDatabaseProfileLabel
        ? `Using ${profileContext.activeDatabaseProfileLabel}.`
        : `Using runtime env database ${databaseRuntime.databaseName}; no saved profile is active.`,
      remediation: profileContext.activeDatabaseProfileId
        ? undefined
        : 'Save the current database as an active profile in Workspace Databases for predictable startup.',
    },
    {
      id: 'runtime-provider',
      label: 'Model runtime',
      status: runtimeConfigured ? 'healthy' : 'degraded',
      message: runtimeConfigured
        ? `${runtimeProvider || 'Runtime'} is configured (${runtimeAccessMode || 'unknown mode'}).`
        : 'No model runtime is configured on this server.',
      remediation: runtimeConfigured
        ? undefined
        : 'Configure COPILOT_CLI_URL, GITHUB_MODELS_TOKEN, or a local OpenAI-compatible provider.',
    },
    {
      id: 'runtime-token',
      label: 'Runtime credential source',
      status: tokenSource ? 'healthy' : 'degraded',
      message: tokenSource
        ? `Runtime credentials are resolved from ${tokenSource}.`
        : 'No runtime credential source is active.',
      remediation: tokenSource
        ? undefined
        : 'Use headless Copilot, a GitHub Models token, or local runtime config before model-backed workflows.',
    },
    inspectRendererBuild(),
    inspectGovernanceSigning(),
  ];

  return {
    generatedAt: new Date().toISOString(),
    readinessState: deriveReadinessState(checks),
    checks,
    databaseRuntime,
    controlPlaneUrl:
      String(process.env.APP_URL || '').trim() ||
      `http://localhost:${String(process.env.PORT || '3001').trim() || '3001'}`,
    ...profileContext,
  };
};
