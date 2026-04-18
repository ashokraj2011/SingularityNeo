import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type {
  WorkspaceDatabaseBootstrapConfig,
  WorkspaceDatabaseBootstrapProfile,
  WorkspaceDatabaseBootstrapProfileSnapshot,
  WorkspaceDatabaseRuntimeInfo,
} from '../src/types';

const PROFILE_ENV_KEY = 'WORKSPACE_DB_PROFILES_B64';
const ACTIVE_PROFILE_ENV_KEY = 'WORKSPACE_ACTIVE_DB_PROFILE_ID';

const trimOrEmpty = (value?: string | null) => String(value || '').trim();

const toPort = (value: unknown, fallback = 5432) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toProfileKey = (
  config: Pick<
    WorkspaceDatabaseBootstrapConfig,
    'host' | 'port' | 'databaseName' | 'user' | 'adminDatabaseName'
  >,
) =>
  [
    trimOrEmpty(config.host).toLowerCase(),
    String(toPort(config.port)),
    trimOrEmpty(config.databaseName).toLowerCase(),
    trimOrEmpty(config.user).toLowerCase(),
    trimOrEmpty(config.adminDatabaseName || 'postgres').toLowerCase(),
  ].join('::');

const toProfileId = (
  config: Pick<
    WorkspaceDatabaseBootstrapConfig,
    'host' | 'port' | 'databaseName' | 'user' | 'adminDatabaseName'
  >,
) =>
  `DBP-${toProfileKey(config)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .toUpperCase()}`;

const toProfileLabel = (
  config: Pick<WorkspaceDatabaseBootstrapConfig, 'host' | 'port' | 'databaseName'>,
) => {
  const database = trimOrEmpty(config.databaseName);
  const host = trimOrEmpty(config.host);
  const port = toPort(config.port);
  return database && host ? `${database} @ ${host}:${port}` : database || host || 'Database';
};

export const normalizeWorkspaceDatabaseBootstrapProfiles = (
  profiles?: WorkspaceDatabaseBootstrapProfile[],
): WorkspaceDatabaseBootstrapProfile[] => {
  const merged = new Map<string, WorkspaceDatabaseBootstrapProfile>();

  (Array.isArray(profiles) ? profiles : []).forEach(profile => {
    const normalized: WorkspaceDatabaseBootstrapProfile = {
      id: trimOrEmpty(profile?.id) || toProfileId(profile),
      label: trimOrEmpty(profile?.label) || toProfileLabel(profile),
      host: trimOrEmpty(profile?.host),
      port: toPort(profile?.port),
      databaseName: trimOrEmpty(profile?.databaseName),
      user: trimOrEmpty(profile?.user),
      adminDatabaseName: trimOrEmpty(profile?.adminDatabaseName) || 'postgres',
      password: trimOrEmpty(profile?.password) || undefined,
      lastUsedAt:
        trimOrEmpty(profile?.lastUsedAt) || new Date().toISOString(),
    };

    if (!normalized.host || !normalized.databaseName || !normalized.user) {
      return;
    }

    const key = trimOrEmpty(normalized.id) || toProfileKey(normalized);
    const current = merged.get(key);
    merged.set(key, current ? { ...current, ...normalized } : normalized);
  });

  return [...merged.values()].sort((left, right) =>
    right.lastUsedAt.localeCompare(left.lastUsedAt),
  );
};

export const decodeWorkspaceDatabaseBootstrapProfileSnapshot = ({
  encodedProfiles,
  activeProfileId,
}: {
  encodedProfiles?: string | null;
  activeProfileId?: string | null;
}): WorkspaceDatabaseBootstrapProfileSnapshot => {
  let parsedProfiles: WorkspaceDatabaseBootstrapProfile[] = [];

  if (trimOrEmpty(encodedProfiles)) {
    try {
      const decoded = Buffer.from(encodedProfiles as string, 'base64').toString('utf8');
      parsedProfiles = JSON.parse(decoded) as WorkspaceDatabaseBootstrapProfile[];
    } catch {
      parsedProfiles = [];
    }
  }

  const profiles = normalizeWorkspaceDatabaseBootstrapProfiles(parsedProfiles);
  const nextActiveProfileId = trimOrEmpty(activeProfileId) || undefined;

  return {
    activeProfileId: profiles.some(profile => profile.id === nextActiveProfileId)
      ? nextActiveProfileId
      : undefined,
    profiles,
  };
};

export const encodeWorkspaceDatabaseBootstrapProfileSnapshot = (
  snapshot: WorkspaceDatabaseBootstrapProfileSnapshot,
) =>
  Buffer.from(
    JSON.stringify(normalizeWorkspaceDatabaseBootstrapProfiles(snapshot.profiles)),
    'utf8',
  ).toString('base64');

export const upsertWorkspaceDatabaseBootstrapProfile = (
  snapshot: WorkspaceDatabaseBootstrapProfileSnapshot,
  config: WorkspaceDatabaseBootstrapConfig & { label?: string },
  options?: {
    makeActive?: boolean;
  },
): WorkspaceDatabaseBootstrapProfileSnapshot => {
  const normalizedProfiles = normalizeWorkspaceDatabaseBootstrapProfiles(snapshot.profiles);
  const existing = normalizedProfiles.find(
    profile =>
      profile.id === trimOrEmpty((config as WorkspaceDatabaseBootstrapProfile).id) ||
      toProfileKey(profile) === toProfileKey(config),
  );

  const nextProfile: WorkspaceDatabaseBootstrapProfile = {
    id: existing?.id || toProfileId(config),
    label: trimOrEmpty(config.label) || existing?.label || toProfileLabel(config),
    host: trimOrEmpty(config.host),
    port: toPort(config.port),
    databaseName: trimOrEmpty(config.databaseName),
    user: trimOrEmpty(config.user),
    adminDatabaseName: trimOrEmpty(config.adminDatabaseName) || 'postgres',
    password:
      trimOrEmpty(config.password) || existing?.password || undefined,
    lastUsedAt: new Date().toISOString(),
  };

  const profiles = normalizeWorkspaceDatabaseBootstrapProfiles([
    nextProfile,
    ...normalizedProfiles.filter(profile => profile.id !== nextProfile.id),
  ]);

  return {
    activeProfileId: options?.makeActive
      ? nextProfile.id
      : snapshot.activeProfileId,
    profiles,
  };
};

export const findMatchingWorkspaceDatabaseBootstrapProfile = (
  snapshot: WorkspaceDatabaseBootstrapProfileSnapshot,
  config: Pick<
    WorkspaceDatabaseBootstrapConfig,
    'host' | 'port' | 'databaseName' | 'user' | 'adminDatabaseName'
  >,
) =>
  snapshot.profiles.find(profile => toProfileKey(profile) === toProfileKey(config));

export const resolveActiveWorkspaceDatabaseBootstrapProfileId = (
  snapshot: WorkspaceDatabaseBootstrapProfileSnapshot,
  runtime: Pick<
    WorkspaceDatabaseRuntimeInfo,
    'host' | 'port' | 'databaseName' | 'user' | 'adminDatabaseName'
  >,
) => {
  if (snapshot.activeProfileId) {
    const active = snapshot.profiles.find(profile => profile.id === snapshot.activeProfileId);
    if (active && toProfileKey(active) === toProfileKey(runtime)) {
      return active.id;
    }
  }

  return snapshot.profiles.find(profile => toProfileKey(profile) === toProfileKey(runtime))?.id;
};

const upsertEnvLine = (contents: string, key: string, value?: string) => {
  if (value === undefined) {
    return contents;
  }

  const nextLine = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');

  if (pattern.test(contents)) {
    return contents.replace(pattern, nextLine);
  }

  const suffix = contents.endsWith('\n') || contents.length === 0 ? '' : '\n';
  return `${contents}${suffix}${nextLine}\n`;
};

export const readWorkspaceDatabaseBootstrapProfileSnapshot = async (
  filePath: string,
  fallbackEnvFilePath?: string,
): Promise<WorkspaceDatabaseBootstrapProfileSnapshot> => {
  if (fs.existsSync(filePath)) {
    try {
      const contents = await fs.promises.readFile(filePath, 'utf8');
      const parsed = JSON.parse(contents) as WorkspaceDatabaseBootstrapProfileSnapshot;
      return {
        activeProfileId: trimOrEmpty(parsed?.activeProfileId) || undefined,
        profiles: normalizeWorkspaceDatabaseBootstrapProfiles(parsed?.profiles),
      };
    } catch {
      // Fall through to env-based migration below.
    }
  }

  if (fallbackEnvFilePath && fs.existsSync(fallbackEnvFilePath)) {
    const envContents = await fs.promises.readFile(fallbackEnvFilePath, 'utf8');
    const env = dotenv.parse(envContents);
    return decodeWorkspaceDatabaseBootstrapProfileSnapshot({
      encodedProfiles: env[PROFILE_ENV_KEY],
      activeProfileId: env[ACTIVE_PROFILE_ENV_KEY],
    });
  }

  return {
    profiles: [],
  };
};

export const writeWorkspaceDatabaseBootstrapProfileSnapshot = async (
  filePath: string,
  snapshot: WorkspaceDatabaseBootstrapProfileSnapshot,
) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(
    filePath,
    JSON.stringify(
      {
        activeProfileId: snapshot.activeProfileId,
        profiles: normalizeWorkspaceDatabaseBootstrapProfiles(snapshot.profiles),
      } satisfies WorkspaceDatabaseBootstrapProfileSnapshot,
      null,
      2,
    ),
    'utf8',
  );
};

export const writeWorkspaceDatabaseBootstrapEnvSnapshot = async (
  filePath: string,
  snapshot: WorkspaceDatabaseBootstrapProfileSnapshot,
) => {
  const normalizedSnapshot: WorkspaceDatabaseBootstrapProfileSnapshot = {
    activeProfileId: trimOrEmpty(snapshot.activeProfileId) || undefined,
    profiles: normalizeWorkspaceDatabaseBootstrapProfiles(snapshot.profiles),
  };
  const activeProfile =
    normalizedSnapshot.profiles.find(
      profile => profile.id === normalizedSnapshot.activeProfileId,
    ) || normalizedSnapshot.profiles[0];

  let contents = '';
  if (fs.existsSync(filePath)) {
    contents = await fs.promises.readFile(filePath, 'utf8');
  }

  contents = upsertEnvLine(
    contents,
    PROFILE_ENV_KEY,
    encodeWorkspaceDatabaseBootstrapProfileSnapshot(normalizedSnapshot),
  );
  contents = upsertEnvLine(
    contents,
    ACTIVE_PROFILE_ENV_KEY,
    normalizedSnapshot.activeProfileId || activeProfile?.id || '',
  );

  if (activeProfile) {
    contents = upsertEnvLine(contents, 'PGHOST', activeProfile.host);
    contents = upsertEnvLine(contents, 'PGPORT', String(toPort(activeProfile.port)));
    contents = upsertEnvLine(contents, 'PGDATABASE', activeProfile.databaseName);
    contents = upsertEnvLine(contents, 'PGUSER', activeProfile.user);
    contents = upsertEnvLine(
      contents,
      'PGADMIN_DATABASE',
      activeProfile.adminDatabaseName || 'postgres',
    );
    if (activeProfile.password !== undefined) {
      contents = upsertEnvLine(contents, 'PGPASSWORD', activeProfile.password);
    }
  }

  await fs.promises.writeFile(filePath, contents, 'utf8');
};
