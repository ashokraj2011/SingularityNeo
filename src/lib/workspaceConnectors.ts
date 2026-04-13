import type {
  WorkspaceConnectorSettings,
  WorkspaceConfluenceConnectorSettings,
  WorkspaceGithubConnectorSettings,
  WorkspaceJiraConnectorSettings,
} from '../types';

const trim = (value?: string | null) => (value || '').trim();

export const createDefaultWorkspaceConnectorSettings = (): WorkspaceConnectorSettings => ({
  github: {
    enabled: false,
    baseUrl: 'https://api.github.com',
    secretReference: '',
    ownerHint: '',
    notes: '',
  },
  jira: {
    enabled: false,
    baseUrl: '',
    email: '',
    secretReference: '',
    projectKey: '',
    notes: '',
  },
  confluence: {
    enabled: false,
    baseUrl: '',
    email: '',
    secretReference: '',
    spaceKey: '',
    notes: '',
  },
});

const normalizeGithubConnector = (
  settings?: Partial<WorkspaceGithubConnectorSettings>,
): WorkspaceGithubConnectorSettings => ({
  ...createDefaultWorkspaceConnectorSettings().github,
  ...settings,
  enabled: Boolean(settings?.enabled),
  baseUrl: trim(settings?.baseUrl) || 'https://api.github.com',
  secretReference: trim(settings?.secretReference),
  ownerHint: trim(settings?.ownerHint),
  notes: trim(settings?.notes),
});

const normalizeJiraConnector = (
  settings?: Partial<WorkspaceJiraConnectorSettings>,
): WorkspaceJiraConnectorSettings => ({
  ...createDefaultWorkspaceConnectorSettings().jira,
  ...settings,
  enabled: Boolean(settings?.enabled),
  baseUrl: trim(settings?.baseUrl),
  email: trim(settings?.email),
  secretReference: trim(settings?.secretReference),
  projectKey: trim(settings?.projectKey),
  notes: trim(settings?.notes),
});

const normalizeConfluenceConnector = (
  settings?: Partial<WorkspaceConfluenceConnectorSettings>,
): WorkspaceConfluenceConnectorSettings => ({
  ...createDefaultWorkspaceConnectorSettings().confluence,
  ...settings,
  enabled: Boolean(settings?.enabled),
  baseUrl: trim(settings?.baseUrl),
  email: trim(settings?.email),
  secretReference: trim(settings?.secretReference),
  spaceKey: trim(settings?.spaceKey),
  notes: trim(settings?.notes),
});

export const normalizeWorkspaceConnectorSettings = (
  settings?: Partial<WorkspaceConnectorSettings> | null,
): WorkspaceConnectorSettings => ({
  github: normalizeGithubConnector(settings?.github),
  jira: normalizeJiraConnector(settings?.jira),
  confluence: normalizeConfluenceConnector(settings?.confluence),
});
