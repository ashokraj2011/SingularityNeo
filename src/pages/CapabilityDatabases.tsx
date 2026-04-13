import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  ClipboardCheck,
  Database,
  Files,
  Plus,
  RefreshCcw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import {
  activateDatabaseBootstrapProfile,
  fetchDatabaseBootstrapProfiles,
  fetchDatabaseBootstrapStatus,
  fetchWorkspaceCatalogSnapshot,
  initializeWorkspaceFoundationCatalog,
  setupDatabaseBootstrap,
} from '../lib/api';
import {
  CAPABILITY_DATABASE_AUTH_MODES,
  CAPABILITY_DATABASE_ENGINES,
  CAPABILITY_DATABASE_SSL_MODES,
  createCapabilityDatabaseConfig,
  getDefaultDatabasePort,
  isCapabilityDatabaseConfigValid,
  normalizeCapabilityDatabaseConfigs,
  summarizeCapabilityDatabaseConfig,
} from '../lib/capabilityDatabases';
import { normalizeWorkspaceConnectorSettings } from '../lib/workspaceConnectors';
import { formatEnumLabel } from '../lib/enterprise';
import type {
  CapabilityDatabaseConfig,
  WorkspaceDatabaseBootstrapConfig,
  WorkspaceDatabaseBootstrapResult,
  WorkspaceDatabaseBootstrapStatus,
  WorkspaceConnectorSettings,
  WorkspaceCatalogSnapshot,
  WorkspaceDatabaseBootstrapProfile,
  WorkspaceDatabaseBootstrapProfileSnapshot,
} from '../types';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';

const CapabilityDatabases = () => {
  const navigate = useNavigate();
  const {
    bootStatus,
    lastSyncError,
    workspaceSettings,
    updateWorkspaceSettings,
    retryInitialSync,
  } =
    useCapability();
  const { success, error: showError } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [catalogSnapshot, setCatalogSnapshot] = useState<WorkspaceCatalogSnapshot | null>(
    null,
  );
  const [isCatalogLoading, setIsCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [isInitializingFoundations, setIsInitializingFoundations] = useState(false);
  const [profiles, setProfiles] = useState<CapabilityDatabaseConfig[]>(
    normalizeCapabilityDatabaseConfigs(workspaceSettings.databaseConfigs),
  );
  const [connectorSettings, setConnectorSettings] = useState<WorkspaceConnectorSettings>(
    normalizeWorkspaceConnectorSettings(workspaceSettings.connectors),
  );
  const [bootstrapStatus, setBootstrapStatus] =
    useState<WorkspaceDatabaseBootstrapStatus | null>(null);
  const [profileSnapshot, setProfileSnapshot] =
    useState<WorkspaceDatabaseBootstrapProfileSnapshot>({
      profiles: [],
    });
  const [profilesError, setProfilesError] = useState('');
  const [isProfilesLoading, setIsProfilesLoading] = useState(true);
  const [activatingProfileId, setActivatingProfileId] = useState('');
  const [bootstrapError, setBootstrapError] = useState('');
  const [isBootstrapLoading, setIsBootstrapLoading] = useState(true);
  const [isInitializingDatabase, setIsInitializingDatabase] = useState(false);
  const [bootstrapConfig, setBootstrapConfig] = useState<
    WorkspaceDatabaseBootstrapConfig & { password: string }
  >({
    host: '127.0.0.1',
    port: 5432,
    databaseName: 'singularity',
    user: 'postgres',
    adminDatabaseName: 'postgres',
    password: '',
  });

  useEffect(() => {
    setProfiles(normalizeCapabilityDatabaseConfigs(workspaceSettings.databaseConfigs));
    setConnectorSettings(normalizeWorkspaceConnectorSettings(workspaceSettings.connectors));
    setSaveError('');
  }, [workspaceSettings]);

  useEffect(() => {
    if (!bootstrapStatus) {
      return;
    }

    setBootstrapConfig(current => ({
      ...current,
      host: bootstrapStatus.runtime.host,
      port: bootstrapStatus.runtime.port,
      databaseName: bootstrapStatus.runtime.databaseName,
      user: bootstrapStatus.runtime.user,
      adminDatabaseName: bootstrapStatus.runtime.adminDatabaseName || 'postgres',
      password: '',
    }));
  }, [bootstrapStatus]);

  const validCount = useMemo(
    () => profiles.filter(isCapabilityDatabaseConfigValid).length,
    [profiles],
  );
  const readOnlyCount = useMemo(
    () => profiles.filter(profile => profile.readOnly).length,
    [profiles],
  );
  const foundationSummary = catalogSnapshot?.summary;
  const databaseRuntime = catalogSnapshot?.databaseRuntime || bootstrapStatus?.runtime;
  const foundationsInitialized =
    foundationSummary?.initialized || bootstrapStatus?.foundationsInitialized || false;
  const foundationGroups = useMemo(
    () => [
      {
        id: 'agents',
        label: 'Agent templates',
        count: foundationSummary?.agentTemplateCount || 0,
        icon: Bot,
        preview:
          catalogSnapshot?.foundations.agentTemplates
            .slice(0, 3)
            .map(template => template.name)
            .join(', ') || 'No shared agent templates yet.',
      },
      {
        id: 'workflows',
        label: 'Workflow templates',
        count: foundationSummary?.workflowTemplateCount || 0,
        icon: Workflow,
        preview:
          catalogSnapshot?.foundations.workflowTemplates
            .slice(0, 2)
            .map(template => template.name)
            .join(', ') || 'No shared workflow templates yet.',
      },
      {
        id: 'evals',
        label: 'Eval suites',
        count: foundationSummary?.evalSuiteTemplateCount || 0,
        icon: ClipboardCheck,
        preview:
          catalogSnapshot?.foundations.evalSuiteTemplates
            .slice(0, 2)
            .map(template => template.name)
            .join(', ') || 'No shared eval suites yet.',
      },
      {
        id: 'artifacts',
        label: 'Artifacts and skills',
        count:
          (foundationSummary?.artifactTemplateCount || 0) +
          (foundationSummary?.skillTemplateCount || 0),
        icon: Files,
        preview:
          catalogSnapshot
            ? `${foundationSummary?.artifactTemplateCount || 0} artifact templates, ${
                foundationSummary?.skillTemplateCount || 0
              } skills`
            : 'No shared artifact or skill templates yet.',
      },
      {
        id: 'tools',
        label: 'Tool catalog',
        count: foundationSummary?.toolTemplateCount || 0,
        icon: ShieldCheck,
        preview:
          catalogSnapshot?.foundations.toolTemplates
            .slice(0, 3)
            .map(template => template.label)
            .join(', ') || 'No shared tool templates yet.',
      },
    ],
    [catalogSnapshot, foundationSummary],
  );
  const savedBootstrapProfiles = profileSnapshot.profiles;
  const activeBootstrapProfileId = profileSnapshot.activeProfileId;
  const activeBootstrapProfile = useMemo(
    () =>
      savedBootstrapProfiles.find(profile => profile.id === activeBootstrapProfileId),
    [savedBootstrapProfiles, activeBootstrapProfileId],
  );

  const loadBootstrapStatus = useCallback(async () => {
    setIsBootstrapLoading(true);
    setBootstrapError('');

    try {
      const status = await fetchDatabaseBootstrapStatus();
      setBootstrapStatus(status);
    } catch (error) {
      setBootstrapError(
        error instanceof Error
          ? error.message
          : 'Unable to inspect the database bootstrap status right now.',
      );
    } finally {
      setIsBootstrapLoading(false);
    }
  }, []);

  const loadBootstrapProfiles = useCallback(async () => {
    setIsProfilesLoading(true);
    setProfilesError('');

    try {
      const snapshot = await fetchDatabaseBootstrapProfiles();
      setProfileSnapshot(snapshot);
    } catch (error) {
      setProfilesError(
        error instanceof Error
          ? error.message
          : 'Unable to load saved database connections right now.',
      );
    } finally {
      setIsProfilesLoading(false);
    }
  }, []);

  const loadCatalogSnapshot = useCallback(async () => {
    setIsCatalogLoading(true);
    setCatalogError('');

    try {
      const snapshot = await fetchWorkspaceCatalogSnapshot();
      setCatalogSnapshot(snapshot);
    } catch (error) {
      setCatalogError(
        error instanceof Error
          ? error.message
          : 'Unable to load the shared workspace catalog right now.',
      );
    } finally {
      setIsCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBootstrapStatus();
  }, [loadBootstrapStatus]);

  useEffect(() => {
    void loadBootstrapProfiles();
  }, [loadBootstrapProfiles]);

  useEffect(() => {
    if (bootStatus !== 'ready' && !bootstrapStatus?.ready) {
      setIsCatalogLoading(false);
      setCatalogError('');
      return;
    }

    void loadCatalogSnapshot();
  }, [bootStatus, bootstrapStatus?.ready, loadCatalogSnapshot]);

  const setProfileField = <K extends keyof CapabilityDatabaseConfig>(
    profileId: string,
    field: K,
    value: CapabilityDatabaseConfig[K],
  ) => {
    setSaveError('');
    setProfiles(current =>
      current.map(profile => {
        if (profile.id !== profileId) {
          return profile;
        }

        const nextProfile = { ...profile, [field]: value };
        if (field === 'engine' && (!profile.port || profile.port === getDefaultDatabasePort(profile.engine))) {
          nextProfile.port = getDefaultDatabasePort(value as CapabilityDatabaseConfig['engine']);
        }
        return nextProfile;
      }),
    );
  };

  const addProfile = () => {
    setProfiles(current => [...current, createCapabilityDatabaseConfig()]);
  };

  const removeProfile = (profileId: string) => {
    setProfiles(current => current.filter(profile => profile.id !== profileId));
  };

  const setBootstrapField = <
    K extends keyof (WorkspaceDatabaseBootstrapConfig & { password: string }),
  >(
    field: K,
    value: (WorkspaceDatabaseBootstrapConfig & { password: string })[K],
  ) => {
    setBootstrapError('');
    setBootstrapConfig(current => ({
      ...current,
      [field]: value,
    }));
  };

  const applyBootstrapProfileToForm = (profile: WorkspaceDatabaseBootstrapProfile) => {
    setBootstrapError('');
    setBootstrapConfig(current => ({
      ...current,
      host: profile.host,
      port: profile.port,
      databaseName: profile.databaseName,
      user: profile.user,
      adminDatabaseName: profile.adminDatabaseName || 'postgres',
      password: '',
    }));
  };

  const handleActivateSavedProfile = async (profileId: string) => {
    setActivatingProfileId(profileId);
    setBootstrapError('');
    setProfilesError('');

    try {
      const result = await activateDatabaseBootstrapProfile(profileId);
      setBootstrapStatus(result.status);
      setCatalogSnapshot(result.catalogSnapshot);
      if (result.profileSnapshot) {
        setProfileSnapshot(result.profileSnapshot);
      } else {
        await loadBootstrapProfiles();
      }
      await retryInitialSync();
      success(
        'Saved database activated',
        `Switched Singulairy to the selected saved database connection and refreshed the shared standards for that database.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to switch to the saved database connection.';
      setProfilesError(message);
      showError('Saved database activation failed', message);
    } finally {
      setActivatingProfileId('');
    }
  };

  const handleInitializeDatabase = async () => {
    const host = bootstrapConfig.host.trim();
    const databaseName = bootstrapConfig.databaseName.trim();
    const user = bootstrapConfig.user.trim();
    const adminDatabaseName = bootstrapConfig.adminDatabaseName?.trim() || 'postgres';

    if (!host || !databaseName || !user || !Number.isFinite(Number(bootstrapConfig.port))) {
      setBootstrapError(
        'Host, port, database name, and user are required before Singularity can initialize the workspace database.',
      );
      return;
    }

    setIsInitializingDatabase(true);
    setBootstrapError('');

    try {
      const result: WorkspaceDatabaseBootstrapResult = await setupDatabaseBootstrap({
        host,
        port: Number(bootstrapConfig.port),
        databaseName,
        user,
        adminDatabaseName,
        ...(bootstrapConfig.password.trim()
          ? { password: bootstrapConfig.password.trim() }
          : {}),
      });
      setBootstrapStatus(result.status);
      setCatalogSnapshot(result.catalogSnapshot);
      if (result.profileSnapshot) {
        setProfileSnapshot(result.profileSnapshot);
      } else {
        await loadBootstrapProfiles();
      }
      await retryInitialSync();
      const summary = result.catalogSnapshot.summary;
      success(
        'Workspace database initialized',
        `Singularity created the target database objects, loaded ${summary.totalTemplateCount} shared standards, and materialized the hidden system foundation capability that new capabilities inherit from.`,
      );
      setBootstrapConfig(current => ({
        ...current,
        password: '',
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to initialize the workspace database right now.';
      setBootstrapError(message);
      showError('Database initialization failed', message);
    } finally {
      setIsInitializingDatabase(false);
    }
  };

  const handleSave = async () => {
    if (bootStatus !== 'ready') {
      setSaveError(
        lastSyncError ||
          'The workspace is offline or still loading. Restore sync before saving database setup.',
      );
      return;
    }

    const normalizedProfiles = normalizeCapabilityDatabaseConfigs(profiles);
    const invalidProfile = normalizedProfiles.find(
      profile => !isCapabilityDatabaseConfigValid(profile),
    );

    if (invalidProfile) {
      setSaveError(
        `Complete the required fields for ${invalidProfile.label || 'the unfinished database profile'} before saving.`,
      );
      return;
    }

    setIsSaving(true);
    setSaveError('');

    try {
      await updateWorkspaceSettings({
        databaseConfigs: normalizedProfiles,
        connectors: normalizeWorkspaceConnectorSettings(connectorSettings),
      });
      success(
        'Workspace catalog saved',
        `${normalizedProfiles.length} shared database profile${normalizedProfiles.length === 1 ? '' : 's'} and workspace connector settings are now available across capabilities.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save database setup.';
      setSaveError(message);
      showError('Database setup failed', message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleInitializeFoundations = async () => {
    setIsInitializingFoundations(true);
    setCatalogError('');

    try {
      const snapshot = await initializeWorkspaceFoundationCatalog();
      setCatalogSnapshot(snapshot);
      await loadBootstrapStatus();
      success(
        'Workspace foundations initialized',
        `Loaded ${snapshot.summary.totalTemplateCount} shared records into the workspace catalog for agents, workflows, eval suites, skills, artifacts, and tools.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to initialize the shared workspace foundations.';
      setCatalogError(message);
      showError('Workspace initialization failed', message);
    } finally {
      setIsInitializingFoundations(false);
    }
  };

  const setConnectorField = <
    TConnector extends keyof WorkspaceConnectorSettings,
    TField extends keyof WorkspaceConnectorSettings[TConnector],
  >(
    connector: TConnector,
    field: TField,
    value: WorkspaceConnectorSettings[TConnector][TField],
  ) => {
    setSaveError('');
    setConnectorSettings(current => ({
      ...current,
      [connector]: {
        ...current[connector],
        [field]: value,
      },
    }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace Databases"
        context="Shared across capabilities"
        title="Shared Database Catalog"
        description="Manage the common database profiles and shared platform foundations that every capability can use. Database initialization creates the schema and loads the standard static workspace data."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/capabilities/metadata')}
              className="enterprise-button enterprise-button-secondary"
            >
              <ArrowLeft size={16} />
              Back to metadata
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || bootStatus !== 'ready'}
              className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={16} />
              {isSaving ? 'Saving…' : 'Save shared catalog'}
            </button>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <StatTile label="Profiles" value={profiles.length} tone="brand" icon={Database} />
          <StatTile label="Ready" value={validCount} tone="success" icon={ShieldCheck} />
          <StatTile label="Read only" value={readOnlyCount} tone="info" icon={ShieldCheck} />
        </div>
      </PageHeader>

      {(saveError || catalogError || bootStatus !== 'ready') && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            saveError || catalogError
              ? 'border-error/15 bg-error/5 text-error'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>
              {saveError ||
                catalogError ||
                lastSyncError ||
                'The main workspace is not fully available yet. You can still configure or initialize the database from this page.'}
            </p>
          </div>
        </div>
      )}

      <SectionCard
        title="Database bootstrap"
        description="When the workspace database is missing or the connection has changed, configure it here and Singularity will create the target database if needed, run all schema DDL, and load the standard shared static data."
        icon={Server}
        tone="brand"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void loadBootstrapStatus();
                void loadBootstrapProfiles();
              }}
              className="enterprise-button enterprise-button-secondary"
              disabled={isBootstrapLoading}
            >
              <RefreshCcw size={16} />
              {isBootstrapLoading ? 'Refreshing…' : 'Refresh status'}
            </button>
            <button
              type="button"
              onClick={() => void handleInitializeDatabase()}
              className="enterprise-button enterprise-button-primary"
              disabled={isInitializingDatabase}
            >
              <Database size={16} />
              {isInitializingDatabase
                ? 'Initializing…'
                : 'Create DB objects and static data'}
            </button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Connection</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {bootstrapStatus?.databaseReachable
                ? 'Connected'
                : isBootstrapLoading
                ? 'Checking…'
                : 'Needs setup'}
            </p>
            <p className="mt-1 text-xs text-secondary">
              {bootstrapStatus?.adminReachable
                ? 'Admin database is reachable.'
                : 'Admin access is required to create the target database when it does not exist.'}
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Target database</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {bootstrapStatus?.databaseExists ? 'Exists' : 'Not created yet'}
            </p>
            <p className="mt-1 text-xs text-secondary">
              {bootstrapConfig.databaseName || 'Set a database name below.'}
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Schema</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {bootstrapStatus?.schemaInitialized ? 'Initialized' : 'Not initialized'}
            </p>
            <p className="mt-1 text-xs text-secondary">
              Tables, indexes, and migration-safe objects are created here.
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Shared standards</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">
              {foundationsInitialized ? 'Loaded' : 'Pending'}
            </p>
            <p className="mt-1 text-xs text-secondary">
              Standard agents, workflows, eval suites, skills, and artifact templates.
            </p>
          </div>
        </div>

        {(bootstrapError || bootstrapStatus?.lastError) && (
          <div className="workspace-inline-alert workspace-inline-alert-danger mt-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Database setup needs attention</p>
              <p className="mt-1">
                {bootstrapError || bootstrapStatus?.lastError}
              </p>
            </div>
          </div>
        )}

        <div className="mt-5 rounded-3xl border border-outline-variant/20 bg-surface px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="form-kicker">Saved runtime connections</p>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                These are local saved database connections for this Singularity workspace. Pick one to switch the active runtime after restart without retyping the connection again.
              </p>
            </div>
            {activeBootstrapProfile ? (
              <StatusBadge tone="success">
                Active: {activeBootstrapProfile.label}
              </StatusBadge>
            ) : null}
          </div>

          {profilesError ? (
            <div className="workspace-inline-alert workspace-inline-alert-danger mt-4">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Saved connections need attention</p>
                <p className="mt-1">{profilesError}</p>
              </div>
            </div>
          ) : null}

          {isProfilesLoading ? (
            <p className="mt-4 text-sm text-secondary">Loading saved connections…</p>
          ) : savedBootstrapProfiles.length > 0 ? (
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {savedBootstrapProfiles.map(profile => {
                const isActive = profile.id === activeBootstrapProfileId;
                const summary = `${profile.host}:${profile.port} / ${profile.databaseName}`;
                return (
                  <div
                    key={profile.id}
                    className={`rounded-2xl border px-4 py-4 ${
                      isActive
                        ? 'border-brand/30 bg-brand/5'
                        : 'border-outline-variant/20 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-on-surface">
                          {profile.label}
                        </p>
                        <p className="mt-1 text-xs text-secondary">{summary}</p>
                        <p className="mt-1 text-xs text-secondary">
                          User {profile.user} · Admin DB {profile.adminDatabaseName || 'postgres'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {isActive ? <StatusBadge tone="success">Active</StatusBadge> : null}
                        {profile.password ? (
                          <StatusBadge tone="info">Password saved</StatusBadge>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyBootstrapProfileToForm(profile)}
                        className="enterprise-button enterprise-button-secondary"
                      >
                        Load into form
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleActivateSavedProfile(profile.id)}
                        className="enterprise-button enterprise-button-primary"
                        disabled={activatingProfileId === profile.id}
                      >
                        <Server size={16} />
                        {activatingProfileId === profile.id ? 'Switching…' : 'Use now'}
                      </button>
                    </div>
                    <p className="mt-3 text-xs text-secondary">
                      Last used {new Date(profile.lastUsedAt).toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-secondary">
              No saved runtime database connections yet. The first successful database initialization here will save one automatically.
            </p>
          )}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="space-y-2">
            <span className="field-label">Host</span>
            <input
              className="field-input"
              value={bootstrapConfig.host}
              onChange={event => setBootstrapField('host', event.target.value)}
              placeholder="127.0.0.1"
            />
          </label>
          <label className="space-y-2">
            <span className="field-label">Port</span>
            <input
              type="number"
              min={1}
              className="field-input"
              value={bootstrapConfig.port}
              onChange={event =>
                setBootstrapField('port', Number(event.target.value || 0))
              }
              placeholder="5432"
            />
          </label>
          <label className="space-y-2">
            <span className="field-label">Database name</span>
            <input
              className="field-input"
              value={bootstrapConfig.databaseName}
              onChange={event => setBootstrapField('databaseName', event.target.value)}
              placeholder="singularity"
            />
          </label>
          <label className="space-y-2">
            <span className="field-label">Admin database</span>
            <input
              className="field-input"
              value={bootstrapConfig.adminDatabaseName || ''}
              onChange={event =>
                setBootstrapField('adminDatabaseName', event.target.value)
              }
              placeholder="postgres"
            />
          </label>
          <label className="space-y-2">
            <span className="field-label">User</span>
            <input
              className="field-input"
              value={bootstrapConfig.user}
              onChange={event => setBootstrapField('user', event.target.value)}
              placeholder="postgres"
            />
          </label>
          <label className="space-y-2">
            <span className="field-label">Password</span>
            <input
              type="password"
              className="field-input"
              value={bootstrapConfig.password}
              onChange={event => setBootstrapField('password', event.target.value)}
              placeholder={
                bootstrapStatus?.runtime.passwordConfigured
                  ? 'Leave blank to keep current password'
                  : 'Enter database password if needed'
              }
            />
            <p className="field-help">
              {bootstrapStatus?.runtime.passwordConfigured
                ? 'Leave blank to reuse the current configured password.'
                : 'Only needed when your Postgres server requires password authentication.'}
            </p>
          </label>
        </div>

        <div className="mt-5 rounded-2xl border border-brand/15 bg-brand/5 px-4 py-4 text-sm text-secondary">
          <p className="font-semibold text-on-surface">
            Initialize will do all of this for <span className="text-brand">{bootstrapConfig.databaseName || 'your target database'}</span>
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <p>Creates the database if it does not exist</p>
            <p>Runs schema DDL and migration-safe objects</p>
            <p>Loads shared agent templates</p>
            <p>Loads workflow templates</p>
            <p>Loads eval suites</p>
            <p>Loads skills, artifacts, and tools</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Current database runtime"
        description="These are the live Postgres connection details Singulairy is currently using for the shared workspace."
        icon={Server}
        tone="brand"
        action={
          <button
            type="button"
            onClick={() => {
              void loadBootstrapStatus();
              void loadBootstrapProfiles();
              void loadCatalogSnapshot();
            }}
            className="enterprise-button enterprise-button-secondary"
            disabled={isCatalogLoading}
          >
            <RefreshCcw size={16} />
            {isCatalogLoading ? 'Refreshing…' : 'Refresh runtime'}
          </button>
        }
      >
        {databaseRuntime ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Host</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {databaseRuntime.host}:{databaseRuntime.port}
              </p>
            </div>
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Database</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {databaseRuntime.databaseName}
              </p>
              <p className="mt-1 text-xs text-secondary">
                Admin DB: {databaseRuntime.adminDatabaseName || 'postgres'}
              </p>
            </div>
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">User</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {databaseRuntime.user}
              </p>
            </div>
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Password</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {databaseRuntime.passwordConfigured ? 'Configured' : 'Not configured'}
              </p>
            </div>
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">pgvector</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {databaseRuntime.pgvectorAvailable ? 'Available' : 'JSON fallback'}
              </p>
            </div>
            <div className="workspace-meta-card">
              <p className="workspace-meta-label">Shared foundations</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {foundationsInitialized ? 'Initialized' : 'Not initialized'}
              </p>
              <p className="mt-1 text-xs text-secondary">
                {foundationSummary?.lastInitializedAt
                  ? `Last initialized ${new Date(
                      foundationSummary.lastInitializedAt,
                    ).toLocaleString()}`
                  : 'Initialize shared templates into the DB when you are ready.'}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            title="Database runtime not loaded yet"
            description="Refresh the runtime snapshot to inspect which Postgres connection Singulairy is currently using."
            icon={Server}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Workspace connectors"
        description="Shared connector credentials live at the workspace level so capabilities can reuse GitHub, Jira, and Confluence access without duplicating secrets."
        icon={RefreshCcw}
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-3xl border border-outline-variant/20 bg-white px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="form-kicker">GitHub</p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  Fetch repo metadata, PRs, and issues for linked repositories.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-on-surface">
                <input
                  type="checkbox"
                  checked={connectorSettings.github.enabled}
                  onChange={event =>
                    setConnectorField('github', 'enabled', event.target.checked)
                  }
                />
                Enabled
              </label>
            </div>
            <div className="mt-4 space-y-3">
              <input
                className="field-input"
                value={connectorSettings.github.baseUrl || ''}
                onChange={event =>
                  setConnectorField('github', 'baseUrl', event.target.value)
                }
                placeholder="GitHub API base URL"
              />
              <input
                className="field-input"
                value={connectorSettings.github.secretReference || ''}
                onChange={event =>
                  setConnectorField('github', 'secretReference', event.target.value)
                }
                placeholder="Secret env var name, for example GITHUB_TOKEN"
              />
              <input
                className="field-input"
                value={connectorSettings.github.ownerHint || ''}
                onChange={event =>
                  setConnectorField('github', 'ownerHint', event.target.value)
                }
                placeholder="Optional owner hint"
              />
            </div>
          </div>

          <div className="rounded-3xl border border-outline-variant/20 bg-white px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="form-kicker">Jira</p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  Sync issue state and enable explicit workflow-aligned transitions.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-on-surface">
                <input
                  type="checkbox"
                  checked={connectorSettings.jira.enabled}
                  onChange={event =>
                    setConnectorField('jira', 'enabled', event.target.checked)
                  }
                />
                Enabled
              </label>
            </div>
            <div className="mt-4 space-y-3">
              <input
                className="field-input"
                value={connectorSettings.jira.baseUrl || ''}
                onChange={event => setConnectorField('jira', 'baseUrl', event.target.value)}
                placeholder="Jira site URL"
              />
              <input
                className="field-input"
                value={connectorSettings.jira.email || ''}
                onChange={event => setConnectorField('jira', 'email', event.target.value)}
                placeholder="Atlassian account email"
              />
              <input
                className="field-input"
                value={connectorSettings.jira.secretReference || ''}
                onChange={event =>
                  setConnectorField('jira', 'secretReference', event.target.value)
                }
                placeholder="Secret env var name"
              />
              <input
                className="field-input"
                value={connectorSettings.jira.projectKey || ''}
                onChange={event =>
                  setConnectorField('jira', 'projectKey', event.target.value)
                }
                placeholder="Default project key"
              />
            </div>
          </div>

          <div className="rounded-3xl border border-outline-variant/20 bg-white px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="form-kicker">Confluence</p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  Sync pages into memory and publish review packets or evidence back out.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-on-surface">
                <input
                  type="checkbox"
                  checked={connectorSettings.confluence.enabled}
                  onChange={event =>
                    setConnectorField('confluence', 'enabled', event.target.checked)
                  }
                />
                Enabled
              </label>
            </div>
            <div className="mt-4 space-y-3">
              <input
                className="field-input"
                value={connectorSettings.confluence.baseUrl || ''}
                onChange={event =>
                  setConnectorField('confluence', 'baseUrl', event.target.value)
                }
                placeholder="Confluence site URL"
              />
              <input
                className="field-input"
                value={connectorSettings.confluence.email || ''}
                onChange={event =>
                  setConnectorField('confluence', 'email', event.target.value)
                }
                placeholder="Confluence account email"
              />
              <input
                className="field-input"
                value={connectorSettings.confluence.secretReference || ''}
                onChange={event =>
                  setConnectorField('confluence', 'secretReference', event.target.value)
                }
                placeholder="Secret env var name"
              />
              <input
                className="field-input"
                value={connectorSettings.confluence.spaceKey || ''}
                onChange={event =>
                  setConnectorField('confluence', 'spaceKey', event.target.value)
                }
                placeholder="Default space key"
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Connection safety"
        description="Store host, database, schema, and secret references here. Keep raw passwords and connection strings in your enterprise secret manager."
        icon={ShieldCheck}
        tone="brand"
        action={
          <StatusBadge tone="brand">
            Secret references only
          </StatusBadge>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Stored here</p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Engine, host, port, database name, schema, username, SSL mode, and notes.
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Not stored here</p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Raw passwords, full connection strings, or live tokens.
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Used by Singularity</p>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Shared workspace memory, agent grounding, and operator context about which enterprise systems capabilities can touch.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Workspace foundations"
        description="Initialize the shared templates that do not depend on any specific capability. These live in the database once loaded, so new implementations can inspect, materialize, and override them later."
        icon={ShieldCheck}
        tone="brand"
        action={
          <button
            type="button"
            onClick={handleInitializeFoundations}
            disabled={
              isInitializingFoundations ||
              (!bootstrapStatus?.ready && bootStatus !== 'ready')
            }
            className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck size={16} />
            {isInitializingFoundations
              ? 'Initializing…'
              : foundationsInitialized
              ? 'Refresh shared foundations'
              : 'Initialize shared foundations'}
          </button>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {foundationGroups.map(group => {
            const Icon = group.icon;
            return (
              <div key={group.id} className="workspace-meta-card">
                <div className="flex items-center justify-between gap-3">
                  <p className="workspace-meta-label">{group.label}</p>
                  <Icon size={16} className="text-brand-600" />
                </div>
                <p className="mt-3 text-2xl font-bold text-on-surface">{group.count}</p>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  {group.preview}
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-2xl border border-outline-variant/50 bg-surface-raised px-4 py-4 text-sm text-secondary">
          Initialization writes the shared agent templates, Enterprise and Brokerage
          workflow templates, built-in eval suites, starter skills, and artifact templates
          into the shared workspace catalog. Capabilities can materialize these defaults
          later and still store their own overrides independently.
        </div>
      </SectionCard>

      <SectionCard
        title="Database profiles"
        description="Create one shared profile per operational data store used across this workspace. Capabilities can still describe how they use each system."
        icon={Database}
        action={
          <button
            type="button"
            onClick={addProfile}
            className="enterprise-button enterprise-button-secondary"
          >
            <Plus size={16} />
            Add profile
          </button>
        }
      >
        {profiles.length === 0 ? (
          <EmptyState
            title="No database profiles yet"
            description="Add a shared database profile to capture the systems your capabilities read from, write to, or depend on."
            icon={Database}
            action={
              <button
                type="button"
                onClick={addProfile}
                className="enterprise-button enterprise-button-primary"
              >
                <Plus size={16} />
                Add first profile
              </button>
            }
          />
        ) : (
          <div className="space-y-5">
            {profiles.map(profile => {
              const isReady = isCapabilityDatabaseConfigValid(profile);
              return (
                <div
                  key={profile.id}
                  className="rounded-[1.75rem] border border-outline-variant/40 bg-white px-5 py-5 shadow-[0_12px_36px_rgba(12,23,39,0.05)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="form-kicker">{profile.id}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold text-on-surface">
                          {profile.label || 'New database profile'}
                        </h2>
                        <StatusBadge tone={isReady ? 'success' : 'warning'}>
                          {isReady ? 'Ready' : 'Needs setup'}
                        </StatusBadge>
                        <StatusBadge tone="neutral">
                          {formatEnumLabel(profile.engine)}
                        </StatusBadge>
                        {profile.readOnly ? (
                          <StatusBadge tone="info">Read only</StatusBadge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-secondary">
                        {summarizeCapabilityDatabaseConfig(profile) ||
                          'Set the host, database name, and secret reference to complete this profile.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeProfile(profile.id)}
                      className="workspace-list-action"
                      title="Remove database profile"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <label className="space-y-2">
                      <span className="field-label">Profile name</span>
                      <input
                        value={profile.label}
                        onChange={event =>
                          setProfileField(profile.id, 'label', event.target.value)
                        }
                        placeholder="Orders primary"
                        className="field-input"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Engine</span>
                      <select
                        value={profile.engine}
                        onChange={event =>
                          setProfileField(
                            profile.id,
                            'engine',
                            event.target.value as CapabilityDatabaseConfig['engine'],
                          )
                        }
                        className="field-select"
                      >
                        {CAPABILITY_DATABASE_ENGINES.map(engine => (
                          <option key={engine} value={engine}>
                            {formatEnumLabel(engine)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Host</span>
                      <input
                        value={profile.host}
                        onChange={event =>
                          setProfileField(profile.id, 'host', event.target.value)
                        }
                        placeholder="db.company.internal"
                        className="field-input"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Port</span>
                      <input
                        value={profile.port ?? ''}
                        onChange={event =>
                          setProfileField(
                            profile.id,
                            'port',
                            event.target.value
                              ? Number(event.target.value)
                              : undefined,
                          )
                        }
                        type="number"
                        placeholder={String(getDefaultDatabasePort(profile.engine) || '')}
                        className="field-input"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Database name</span>
                      <input
                        value={profile.databaseName}
                        onChange={event =>
                          setProfileField(profile.id, 'databaseName', event.target.value)
                        }
                        placeholder="orders"
                        className="field-input"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Schema</span>
                      <input
                        value={profile.schema || ''}
                        onChange={event =>
                          setProfileField(profile.id, 'schema', event.target.value)
                        }
                        placeholder="public"
                        className="field-input"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Username</span>
                      <input
                        value={profile.username || ''}
                        onChange={event =>
                          setProfileField(profile.id, 'username', event.target.value)
                        }
                        placeholder="svc_orders_reader"
                        className="field-input"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Authentication</span>
                      <select
                        value={profile.authentication}
                        onChange={event =>
                          setProfileField(
                            profile.id,
                            'authentication',
                            event.target.value as CapabilityDatabaseConfig['authentication'],
                          )
                        }
                        className="field-select"
                      >
                        {CAPABILITY_DATABASE_AUTH_MODES.map(mode => (
                          <option key={mode} value={mode}>
                            {formatEnumLabel(mode)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">Secret reference</span>
                      <input
                        value={profile.secretReference || ''}
                        onChange={event =>
                          setProfileField(profile.id, 'secretReference', event.target.value)
                        }
                        placeholder="vault://platform/orders-db"
                        className="field-input"
                      />
                    </label>

                    <label className="space-y-2">
                      <span className="field-label">SSL mode</span>
                      <select
                        value={profile.sslMode || 'REQUIRE'}
                        onChange={event =>
                          setProfileField(
                            profile.id,
                            'sslMode',
                            event.target.value as CapabilityDatabaseConfig['sslMode'],
                          )
                        }
                        className="field-select"
                      >
                        {CAPABILITY_DATABASE_SSL_MODES.map(mode => (
                          <option key={mode} value={mode}>
                            {formatEnumLabel(mode)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2 md:col-span-2 xl:col-span-3">
                      <span className="field-label">Notes</span>
                      <textarea
                        value={profile.notes || ''}
                        onChange={event =>
                          setProfileField(profile.id, 'notes', event.target.value)
                        }
                        placeholder="Read replica for analytics queries. Change approval required before write access."
                        className="field-textarea h-28"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-secondary">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={profile.readOnly ?? true}
                        onChange={event =>
                          setProfileField(profile.id, 'readOnly', event.target.checked)
                        }
                      />
                      Mark this database as read only
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default CapabilityDatabases;
