import type {
  CapabilityDatabaseAuthentication,
  CapabilityDatabaseConfig,
  CapabilityDatabaseEngine,
  CapabilityDatabaseSslMode,
} from '../types';

export const CAPABILITY_DATABASE_ENGINES: CapabilityDatabaseEngine[] = [
  'POSTGRES',
  'MYSQL',
  'MARIADB',
  'SQLSERVER',
  'ORACLE',
  'SNOWFLAKE',
  'MONGODB',
  'REDIS',
  'OTHER',
];

export const CAPABILITY_DATABASE_AUTH_MODES: CapabilityDatabaseAuthentication[] = [
  'SECRET_REFERENCE',
  'USERNAME_PASSWORD',
  'IAM',
  'INTEGRATED',
  'NONE',
];

export const CAPABILITY_DATABASE_SSL_MODES: CapabilityDatabaseSslMode[] = [
  'DISABLE',
  'PREFER',
  'REQUIRE',
];

const DEFAULT_PORTS: Partial<Record<CapabilityDatabaseEngine, number>> = {
  POSTGRES: 5432,
  MYSQL: 3306,
  MARIADB: 3306,
  SQLSERVER: 1433,
  ORACLE: 1521,
  MONGODB: 27017,
  REDIS: 6379,
};

const trimOrEmpty = (value?: string | null) => (value || '').trim();

export const getDefaultDatabasePort = (engine: CapabilityDatabaseEngine) =>
  DEFAULT_PORTS[engine];

export const createCapabilityDatabaseConfig = (): CapabilityDatabaseConfig => ({
  id: `DB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  label: '',
  engine: 'POSTGRES',
  host: '',
  port: getDefaultDatabasePort('POSTGRES'),
  databaseName: '',
  schema: 'public',
  username: '',
  authentication: 'SECRET_REFERENCE',
  secretReference: '',
  sslMode: 'REQUIRE',
  readOnly: true,
  notes: '',
});

export const normalizeCapabilityDatabaseConfigs = (
  configs?: CapabilityDatabaseConfig[],
): CapabilityDatabaseConfig[] =>
  (Array.isArray(configs) ? configs : [])
    .map(config => ({
      ...createCapabilityDatabaseConfig(),
      ...config,
      id: trimOrEmpty(config.id) || createCapabilityDatabaseConfig().id,
      label: trimOrEmpty(config.label),
      engine: config.engine || 'POSTGRES',
      host: trimOrEmpty(config.host),
      port:
        typeof config.port === 'number' && Number.isFinite(config.port)
          ? config.port
          : getDefaultDatabasePort(config.engine || 'POSTGRES'),
      databaseName: trimOrEmpty(config.databaseName),
      schema: trimOrEmpty(config.schema),
      username: trimOrEmpty(config.username),
      authentication: config.authentication || 'SECRET_REFERENCE',
      secretReference: trimOrEmpty(config.secretReference),
      sslMode: config.sslMode || 'REQUIRE',
      readOnly: config.readOnly ?? true,
      notes: trimOrEmpty(config.notes),
    }))
    .filter(config => config.label || config.host || config.databaseName || config.notes);

export const mergeCapabilityDatabaseConfigs = (
  ...catalogs: Array<CapabilityDatabaseConfig[] | undefined>
) => {
  const merged = new Map<string, CapabilityDatabaseConfig>();

  normalizeCapabilityDatabaseConfigs(catalogs.flatMap(configs => configs || [])).forEach(config => {
    const fallbackKey = `${trimOrEmpty(config.label)}::${trimOrEmpty(config.host)}::${trimOrEmpty(config.databaseName)}`;
    const key = trimOrEmpty(config.id) || fallbackKey;
    const current = merged.get(key);
    merged.set(key, current ? { ...current, ...config } : config);
  });

  return [...merged.values()];
};

export const summarizeCapabilityDatabaseConfig = (
  config: CapabilityDatabaseConfig,
) => {
  const hostPort = [config.host, config.port].filter(Boolean).join(':');
  const location = [hostPort, config.databaseName].filter(Boolean).join(' / ');
  return [config.engine, location].filter(Boolean).join(' · ');
};

export const isCapabilityDatabaseConfigValid = (
  config: CapabilityDatabaseConfig,
) => {
  const needsSecret =
    config.authentication === 'SECRET_REFERENCE' ||
    config.authentication === 'USERNAME_PASSWORD';

  return Boolean(
    trimOrEmpty(config.label) &&
      trimOrEmpty(config.host) &&
      trimOrEmpty(config.databaseName) &&
      (!needsSecret || trimOrEmpty(config.secretReference)),
  );
};

export const toCapabilityDatabaseLabels = (
  configs?: CapabilityDatabaseConfig[],
) =>
  Array.from(
    new Set(
      normalizeCapabilityDatabaseConfigs(configs).map(config =>
        trimOrEmpty(config.label) || [config.host, config.databaseName].filter(Boolean).join('/'),
      ),
    ),
  ).filter(Boolean);
