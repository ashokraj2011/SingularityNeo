import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Laptop2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unplug,
} from 'lucide-react';
import {
  siConfluence,
  siDatadog,
  siGithub,
  siJenkins,
  siJira,
  siNow,
  siSplunk,
} from 'simple-icons';
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/EnterpriseUI';
import { useToast } from '../context/ToastContext';
import { getDesktopBridge } from '../lib/desktop';
import type {
  DesktopLocalConnectorAuthType,
  DesktopLocalConnectorConfig,
  DesktopLocalConnectorProvider,
  DesktopLocalConnectorSavePayload,
  DesktopLocalConnectorStatus,
  DesktopLocalConnectorValidationResult,
} from '../types';

type ConnectorDraft = {
  enabled: boolean;
  label: string;
  baseUrl: string;
  authType: DesktopLocalConnectorAuthType;
  username: string;
  projectKey: string;
  spaceKey: string;
  organization: string;
  notes: string;
  token: string;
};

const PROVIDER_ORDER: DesktopLocalConnectorProvider[] = [
  'github',
  'jira',
  'confluence',
  'jenkins',
  'datadog',
  'splunk',
  'servicenow',
];

const PROVIDER_ICONS = {
  github: siGithub,
  jira: siJira,
  confluence: siConfluence,
  jenkins: siJenkins,
  datadog: siDatadog,
  splunk: siSplunk,
  servicenow: siNow,
} satisfies Record<
  DesktopLocalConnectorProvider,
  { title: string; path: string; hex: string }
>;

const PROVIDER_HELP: Record<
  DesktopLocalConnectorProvider,
  {
    title: string;
    description: string;
    defaultBaseUrl: string;
    usernameLabel?: string;
    usernamePlaceholder?: string;
    tokenLabel: string;
    tokenPlaceholder: string;
  }
> = {
  github: {
    title: 'GitHub',
    description: 'Local repo, pull request, issue, and branch context for this desktop.',
    defaultBaseUrl: 'https://api.github.com',
    tokenLabel: 'Personal access token',
    tokenPlaceholder: 'github_pat_...',
  },
  jira: {
    title: 'Jira',
    description: 'Issue lookup and delivery state context through an operator-owned token.',
    defaultBaseUrl: 'https://your-domain.atlassian.net',
    usernameLabel: 'Atlassian email',
    usernamePlaceholder: 'you@company.com',
    tokenLabel: 'API token',
    tokenPlaceholder: 'Atlassian API token',
  },
  confluence: {
    title: 'Confluence',
    description: 'Page and space context for local planning and evidence lookup.',
    defaultBaseUrl: 'https://your-domain.atlassian.net',
    usernameLabel: 'Atlassian email',
    usernamePlaceholder: 'you@company.com',
    tokenLabel: 'API token',
    tokenPlaceholder: 'Atlassian API token',
  },
  jenkins: {
    title: 'Jenkins',
    description: 'Build status and job context from this operator’s Jenkins access.',
    defaultBaseUrl: 'https://jenkins.company.com',
    usernameLabel: 'Jenkins user',
    usernamePlaceholder: 'username',
    tokenLabel: 'API token',
    tokenPlaceholder: 'Jenkins API token',
  },
  datadog: {
    title: 'Datadog',
    description: 'Incident, monitor, and observability export context from a local API key.',
    defaultBaseUrl: 'https://api.datadoghq.com',
    tokenLabel: 'API key',
    tokenPlaceholder: 'Datadog API key',
  },
  splunk: {
    title: 'Splunk',
    description: 'Search and incident context through a local Splunk bearer token.',
    defaultBaseUrl: 'https://splunk.company.com:8089',
    tokenLabel: 'Bearer token',
    tokenPlaceholder: 'Splunk bearer token',
  },
  servicenow: {
    title: 'ServiceNow',
    description: 'Incident and change context using local operator credentials.',
    defaultBaseUrl: 'https://company.service-now.com',
    usernameLabel: 'ServiceNow user',
    usernamePlaceholder: 'username',
    tokenLabel: 'Password or API token',
    tokenPlaceholder: 'ServiceNow password or API token',
  },
};

const statusTone = (status?: DesktopLocalConnectorStatus) => {
  switch (status) {
    case 'READY':
      return 'success' as const;
    case 'ERROR':
      return 'danger' as const;
    case 'NEEDS_CONFIGURATION':
      return 'warning' as const;
    default:
      return 'neutral' as const;
  }
};

const formatTimestamp = (value?: string) => {
  if (!value) {
    return 'Never';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const ServiceLogo = ({
  provider,
  className = '',
}: {
  provider: DesktopLocalConnectorProvider;
  className?: string;
}) => {
  const icon = PROVIDER_ICONS[provider];
  const help = PROVIDER_HELP[provider];

  return (
    <span
      className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ring-1 ring-black/5 ${className}`}
      style={{ backgroundColor: `#${icon.hex}` }}
      title={`${help.title} connector`}
    >
      <svg
        aria-label={`${help.title} logo`}
        role="img"
        viewBox="0 0 24 24"
        className="h-6 w-6 text-white"
      >
        <path d={icon.path} fill="currentColor" />
      </svg>
    </span>
  );
};

const draftFromConfig = (config: DesktopLocalConnectorConfig): ConnectorDraft => ({
  enabled: config.enabled,
  label: config.label,
  baseUrl: config.baseUrl || PROVIDER_HELP[config.provider].defaultBaseUrl,
  authType: config.authType,
  username: config.username || '',
  projectKey: config.projectKey || '',
  spaceKey: config.spaceKey || '',
  organization: config.organization || '',
  notes: config.notes || '',
  token: '',
});

const DesktopConnectors = () => {
  const bridge = getDesktopBridge();
  const { success, error: showError } = useToast();
  const [connectors, setConnectors] = useState<DesktopLocalConnectorConfig[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ConnectorDraft>>({});
  const [validationResults, setValidationResults] = useState<
    Partial<Record<DesktopLocalConnectorProvider, DesktopLocalConnectorValidationResult>>
  >({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');

  const connectorMap = useMemo(
    () => new Map(connectors.map(connector => [connector.provider, connector])),
    [connectors],
  );

  const loadConnectors = async () => {
    if (!bridge?.listLocalConnectors) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await bridge.listLocalConnectors();
      setConnectors(next);
      setDrafts(
        Object.fromEntries(next.map(config => [config.provider, draftFromConfig(config)])),
      );
    } catch (error) {
      showError(
        'Unable to load local connectors',
        error instanceof Error ? error.message : 'The desktop connector vault could not be read.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConnectors();
  }, []);

  const updateDraft = <TKey extends keyof ConnectorDraft>(
    provider: DesktopLocalConnectorProvider,
    key: TKey,
    value: ConnectorDraft[TKey],
  ) => {
    setDrafts(current => ({
      ...current,
      [provider]: {
        ...(current[provider] || draftFromConfig(connectorMap.get(provider)!)),
        [key]: value,
      },
    }));
  };

  const saveConnector = async (
    provider: DesktopLocalConnectorProvider,
    options?: { clearToken?: boolean },
  ) => {
    const draft = drafts[provider];
    if (!bridge?.saveLocalConnector || !draft) {
      return;
    }
    setBusyKey(`save:${provider}`);
    try {
      const payload: DesktopLocalConnectorSavePayload = {
        provider,
        enabled: draft.enabled,
        label: draft.label,
        baseUrl: draft.baseUrl,
        authType: draft.authType,
        username: draft.username,
        projectKey: draft.projectKey,
        spaceKey: draft.spaceKey,
        organization: draft.organization,
        notes: draft.notes,
        clearToken: Boolean(options?.clearToken),
      };
      if (draft.token.trim() && !options?.clearToken) {
        payload.token = draft.token.trim();
      }
      const saved = await bridge.saveLocalConnector(payload);
      setConnectors(current =>
        current.map(connector => (connector.provider === provider ? saved : connector)),
      );
      setDrafts(current => ({
        ...current,
        [provider]: {
          ...draft,
          token: '',
        },
      }));
      success(
        options?.clearToken ? 'Local token cleared' : 'Local connector saved',
        `${PROVIDER_HELP[provider].title} is stored on this desktop only.`,
      );
    } catch (error) {
      showError(
        'Unable to save local connector',
        error instanceof Error ? error.message : 'The connector could not be saved locally.',
      );
    } finally {
      setBusyKey('');
    }
  };

  const deleteConnector = async (provider: DesktopLocalConnectorProvider) => {
    if (!bridge?.deleteLocalConnector) {
      return;
    }
    const confirmed = window.confirm(
      `Delete the local ${PROVIDER_HELP[provider].title} connector from this desktop?`,
    );
    if (!confirmed) {
      return;
    }
    setBusyKey(`delete:${provider}`);
    try {
      await bridge.deleteLocalConnector(provider);
      await loadConnectors();
      success(
        'Local connector removed',
        `${PROVIDER_HELP[provider].title} was removed from this desktop.`,
      );
    } catch (error) {
      showError(
        'Unable to delete connector',
        error instanceof Error ? error.message : 'The local connector could not be removed.',
      );
    } finally {
      setBusyKey('');
    }
  };

  const validateConnector = async (provider: DesktopLocalConnectorProvider) => {
    if (!bridge?.validateLocalConnector) {
      return;
    }
    setBusyKey(`validate:${provider}`);
    try {
      const result = await bridge.validateLocalConnector(provider);
      setValidationResults(current => ({
        ...current,
        [provider]: result,
      }));
      await loadConnectors();
      if (result.status === 'READY') {
        success('Connector validated', result.message);
      } else {
        showError('Connector needs attention', result.message);
      }
    } catch (error) {
      showError(
        'Validation failed',
        error instanceof Error ? error.message : 'The local connector could not be validated.',
      );
    } finally {
      setBusyKey('');
    }
  };

  if (!bridge?.isDesktop) {
    return (
      <EmptyState
        title="Desktop-only connector vault"
        description="Local connector tokens are intentionally available only inside the Electron desktop app. Open SingularityNeo desktop to configure GitHub, Jira, Confluence, Jenkins, Datadog, Splunk, and ServiceNow tokens."
        icon={Laptop2}
        className="min-h-[28rem]"
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Desktop"
        context="Local only"
        title="Local connectors"
        description="Store operator-owned connector tokens on this desktop only. Tokens are never saved to the server or workspace database."
        actions={
          <button
            type="button"
            onClick={() => void loadConnectors()}
            className="enterprise-button enterprise-button-secondary"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        }
      />

      <SectionCard
        title="Security boundary"
        description="The control plane can know that a connector is available, but the token material stays in the local Electron vault."
        icon={ShieldCheck}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Storage</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">Desktop userData</p>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              Secrets are written under the Electron user profile for this OS user.
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Token visibility</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">Redacted in UI</p>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              The renderer receives only token-present flags and validation messages.
            </p>
          </div>
          <div className="workspace-meta-card">
            <p className="workspace-meta-label">Server storage</p>
            <p className="mt-2 text-sm font-semibold text-on-surface">None</p>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              This page does not call a server route to save connector secrets.
            </p>
          </div>
        </div>
      </SectionCard>

      {loading ? (
        <div className="rounded-3xl border border-outline-variant/40 bg-white px-6 py-8 text-sm text-secondary">
          Loading local connector vault.
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {PROVIDER_ORDER.map(provider => {
            const config = connectorMap.get(provider);
            if (!config) {
              return null;
            }
            const draft = drafts[provider] || draftFromConfig(config);
            const help = PROVIDER_HELP[provider];
            const latestValidation = validationResults[provider];
            const status = latestValidation?.status || config.lastValidationStatus;
            const message =
              latestValidation?.message ||
              config.lastValidationMessage ||
              (config.tokenStored ? 'Token saved locally.' : 'No local token saved yet.');
            return (
              <SectionCard
                key={provider}
                title={help.title}
                description={help.description}
                action={<StatusBadge tone={statusTone(status)}>{status || 'LOCAL'}</StatusBadge>}
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <ServiceLogo provider={provider} />
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-on-surface">
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          onChange={event =>
                            updateDraft(provider, 'enabled', event.target.checked)
                          }
                        />
                        Enabled for this desktop user
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {config.tokenStored ? (
                        <StatusBadge
                          tone={
                            config.encryption === 'plaintext-local-fallback'
                              ? 'warning'
                              : 'success'
                          }
                        >
                          Token stored
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">No token</StatusBadge>
                      )}
                      <StatusBadge tone="neutral">
                        {config.encryption === 'safeStorage'
                          ? 'OS encrypted'
                          : config.encryption === 'plaintext-local-fallback'
                            ? 'Local fallback'
                            : 'No secret'}
                      </StatusBadge>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="form-label">Display label</span>
                      <input
                        className="field-input"
                        value={draft.label}
                        onChange={event => updateDraft(provider, 'label', event.target.value)}
                        placeholder={help.title}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="form-label">Base URL</span>
                      <input
                        className="field-input"
                        value={draft.baseUrl}
                        onChange={event => updateDraft(provider, 'baseUrl', event.target.value)}
                        placeholder={help.defaultBaseUrl}
                      />
                    </label>
                    {help.usernameLabel ? (
                      <label className="space-y-1">
                        <span className="form-label">{help.usernameLabel}</span>
                        <input
                          className="field-input"
                          value={draft.username}
                          onChange={event =>
                            updateDraft(provider, 'username', event.target.value)
                          }
                          placeholder={help.usernamePlaceholder}
                        />
                      </label>
                    ) : null}
                    <label className="space-y-1">
                      <span className="form-label">{help.tokenLabel}</span>
                      <input
                        className="field-input"
                        type="password"
                        value={draft.token}
                        onChange={event => updateDraft(provider, 'token', event.target.value)}
                        placeholder={
                          config.tokenStored
                            ? 'Leave blank to keep current local token'
                            : help.tokenPlaceholder
                        }
                      />
                    </label>
                    {provider === 'jira' ? (
                      <label className="space-y-1">
                        <span className="form-label">Default project key</span>
                        <input
                          className="field-input"
                          value={draft.projectKey}
                          onChange={event =>
                            updateDraft(provider, 'projectKey', event.target.value)
                          }
                          placeholder="PAYMENTS"
                        />
                      </label>
                    ) : null}
                    {provider === 'confluence' ? (
                      <label className="space-y-1">
                        <span className="form-label">Default space key</span>
                        <input
                          className="field-input"
                          value={draft.spaceKey}
                          onChange={event =>
                            updateDraft(provider, 'spaceKey', event.target.value)
                          }
                          placeholder="ENG"
                        />
                      </label>
                    ) : null}
                    {provider === 'datadog' ? (
                      <label className="space-y-1">
                        <span className="form-label">Site / organization</span>
                        <input
                          className="field-input"
                          value={draft.organization}
                          onChange={event =>
                            updateDraft(provider, 'organization', event.target.value)
                          }
                          placeholder="us1, us3, eu, gov"
                        />
                      </label>
                    ) : null}
                  </div>

                  <label className="space-y-1">
                    <span className="form-label">Local notes</span>
                    <textarea
                      className="field-input min-h-[4.5rem]"
                      value={draft.notes}
                      onChange={event => updateDraft(provider, 'notes', event.target.value)}
                      placeholder="Optional local note for this desktop only."
                    />
                  </label>

                  <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {status === 'READY' ? (
                        <CheckCircle2 size={16} className="text-emerald-600" />
                      ) : (
                        <Unplug size={16} className="text-secondary" />
                      )}
                      <p className="text-sm font-semibold text-on-surface">{message}</p>
                    </div>
                    <p className="mt-1 text-xs text-secondary">
                      Last validated: {formatTimestamp(latestValidation?.checkedAt || config.lastValidatedAt)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void saveConnector(provider)}
                      disabled={busyKey === `save:${provider}`}
                      className="enterprise-button enterprise-button-primary"
                    >
                      {busyKey === `save:${provider}` ? (
                        <LoaderCircle size={16} className="animate-spin" />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                      Save local
                    </button>
                    <button
                      type="button"
                      onClick={() => void validateConnector(provider)}
                      disabled={busyKey === `validate:${provider}` || !config.tokenStored}
                      className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyKey === `validate:${provider}` ? (
                        <LoaderCircle size={16} className="animate-spin" />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                      Validate
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveConnector(provider, { clearToken: true })}
                      disabled={!config.tokenStored || busyKey === `save:${provider}`}
                      className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Clear token
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteConnector(provider)}
                      disabled={busyKey === `delete:${provider}`}
                      className="enterprise-button enterprise-button-danger"
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                  </div>
                </div>
              </SectionCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DesktopConnectors;
