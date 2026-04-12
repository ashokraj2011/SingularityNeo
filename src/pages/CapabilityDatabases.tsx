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
  fetchWorkspaceCatalogSnapshot,
  initializeWorkspaceFoundationCatalog,
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
import { formatEnumLabel } from '../lib/enterprise';
import type {
  CapabilityDatabaseConfig,
  WorkspaceCatalogSnapshot,
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

  useEffect(() => {
    setProfiles(normalizeCapabilityDatabaseConfigs(workspaceSettings.databaseConfigs));
    setSaveError('');
  }, [workspaceSettings]);

  const validCount = useMemo(
    () => profiles.filter(isCapabilityDatabaseConfigValid).length,
    [profiles],
  );
  const readOnlyCount = useMemo(
    () => profiles.filter(profile => profile.readOnly).length,
    [profiles],
  );
  const foundationSummary = catalogSnapshot?.summary;
  const databaseRuntime = catalogSnapshot?.databaseRuntime;
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
    ],
    [catalogSnapshot, foundationSummary],
  );

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
    void loadCatalogSnapshot();
  }, [loadCatalogSnapshot]);

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
      });
      success(
        'Workspace database catalog saved',
        `${normalizedProfiles.length} shared database profile${normalizedProfiles.length === 1 ? '' : 's'} ${normalizedProfiles.length === 1 ? 'is' : 'are'} now available across capabilities.`,
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
      success(
        'Workspace foundations initialized',
        `Loaded ${snapshot.summary.totalTemplateCount} shared records into the workspace catalog for agents, workflows, eval suites, skills, and artifact templates.`,
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace Databases"
        context="Shared across capabilities"
        title="Shared Database Catalog"
        description="Manage the common database profiles that every capability can ground against. Capabilities can reference and describe them, but the connection catalog lives at the workspace level."
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
              disabled={isSaving}
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
                'The capability workspace is still syncing. Database setup is disabled until the backend is ready.'}
            </p>
          </div>
        </div>
      )}

      <SectionCard
        title="Current database runtime"
        description="These are the live Postgres connection details Singularity Neo is currently using for the shared workspace."
        icon={Server}
        tone="brand"
        action={
          <button
            type="button"
            onClick={() => void loadCatalogSnapshot()}
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
                {foundationSummary?.initialized ? 'Initialized' : 'Not initialized'}
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
            description="Refresh the runtime snapshot to inspect which Postgres connection Singularity Neo is currently using."
            icon={Server}
          />
        )}
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
            disabled={isInitializingFoundations}
            className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck size={16} />
            {isInitializingFoundations
              ? 'Initializing…'
              : foundationSummary?.initialized
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
          Initialization writes the shared agent templates, standard workflow template,
          built-in eval suites, starter skills, and artifact templates into the shared
          workspace catalog. Capabilities can materialize these defaults later and still
          store their own overrides independently.
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
