import type {
  Artifact,
  Capability,
  CapabilityConnectorContext,
  ConfluenceConnectorPageContext,
  ConfluenceConnectorSyncResult,
  ConnectorSyncStatus,
  GithubConnectorIssueContext,
  GithubConnectorPullRequestContext,
  GithubConnectorRepositoryContext,
  GithubConnectorSyncResult,
  JiraConnectorIssueContext,
  JiraConnectorSyncResult,
  WorkspaceConnectorSettings,
} from '../src/types';
import { normalizeWorkspaceConnectorSettings } from '../src/lib/workspaceConnectors';
import {
  getCapabilityBundle,
  getWorkspaceSettings,
  replaceCapabilityWorkspaceContentRecord,
} from './domains/self-service/repository';
import { refreshCapabilityMemory } from './memory';

const createArtifactId = () => `ART-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const toFileSlug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'artifact';

const compactSummary = (value: string) =>
  value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const buildStatus = (
  status: ConnectorSyncStatus,
  message: string,
): Pick<GithubConnectorSyncResult, 'status' | 'message' | 'syncedAt'> => ({
  status,
  message,
  syncedAt: new Date().toISOString(),
});

const readSecret = (secretReference?: string) => {
  const key = String(secretReference || '').trim();
  return key ? process.env[key] || '' : '';
};

const trim = (value?: string | null) => String(value || '').trim();

const parseGithubRepoUrl = (value: string) => {
  const normalized = trim(value);
  if (!normalized) {
    return null;
  }

  const match =
    normalized.match(/github\.com\/([^/]+)\/([^/#?]+)/i) ||
    normalized.match(/^([^/]+)\/([^/#?]+)$/);
  if (!match) {
    return null;
  }

  return {
    url: normalized.startsWith('http') ? normalized : `https://github.com/${match[1]}/${match[2]}`,
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ''),
  };
};

const parseJiraIssueKey = (value: string) => {
  const match = trim(value).match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return match?.[1];
};

const parseConfluencePageId = (value: string) => {
  const normalized = trim(value);
  const queryMatch = normalized.match(/[?&]pageId=(\d+)/i);
  if (queryMatch) {
    return queryMatch[1];
  }

  const pathMatch = normalized.match(/\/pages\/(?:viewpage\.action\/)?(\d+)/i);
  return pathMatch?.[1];
};

const withTrailingSlashRemoved = (value?: string) => trim(value).replace(/\/+$/g, '');

const toJiraApiBaseUrl = (value?: string) => {
  const normalized = withTrailingSlashRemoved(value);
  if (!normalized) {
    return '';
  }
  return /\/rest\/api\/3$/i.test(normalized)
    ? normalized
    : `${normalized}/rest/api/3`;
};

const toConfluenceApiBaseUrl = (value?: string) => {
  const normalized = withTrailingSlashRemoved(value);
  if (!normalized) {
    return '';
  }
  return /\/wiki$/i.test(normalized) ? `${normalized}/rest/api` : `${normalized}/wiki/rest/api`;
};

const toConfluenceWebBaseUrl = (value?: string) => {
  const normalized = withTrailingSlashRemoved(value);
  if (!normalized) {
    return '';
  }
  return /\/wiki$/i.test(normalized) ? normalized : `${normalized}/wiki`;
};

const requestJson = async <T>(
  url: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || `Connector request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
};

export const summarizeCapabilityConnectorContext = (
  capability: Capability,
  settings: WorkspaceConnectorSettings,
): CapabilityConnectorContext => {
  const normalized = normalizeWorkspaceConnectorSettings(settings);
  const githubRepos = capability.gitRepositories
    .map(parseGithubRepoUrl)
    .filter(Boolean) as Array<{ url: string; owner: string; repo: string }>;
  const jiraIssueKey = parseJiraIssueKey(capability.jiraBoardLink || '');
  const confluencePageId = parseConfluencePageId(capability.confluenceLink || '');

  return {
    capabilityId: capability.id,
    github: {
      provider: 'GITHUB',
      ...buildStatus(
        githubRepos.length === 0
          ? 'NEEDS_CONFIGURATION'
          : normalized.github.enabled
          ? 'READY'
          : 'NEEDS_CONFIGURATION',
        githubRepos.length === 0
          ? 'No GitHub repositories are linked to this capability yet.'
          : normalized.github.enabled
          ? 'GitHub repositories are linked and the workspace connector is enabled.'
          : 'GitHub repositories are linked, but the workspace GitHub connector is not enabled yet.',
      ),
      repositories: githubRepos.map(repo => ({
        url: repo.url,
        owner: repo.owner,
        repo: repo.repo,
      })),
      pullRequests: [],
      issues: [],
    },
    jira: {
      provider: 'JIRA',
      ...buildStatus(
        capability.jiraBoardLink
          ? normalized.jira.enabled
            ? 'READY'
            : 'NEEDS_CONFIGURATION'
          : 'NEEDS_CONFIGURATION',
        capability.jiraBoardLink
          ? normalized.jira.enabled
            ? 'A Jira source is linked and the workspace Jira connector is enabled.'
            : 'A Jira URL is linked, but the workspace Jira connector is not enabled yet.'
          : 'No Jira board or issue URL is linked to this capability yet.',
      ),
      boardUrl: capability.jiraBoardLink,
      issues: jiraIssueKey
        ? [
            {
              key: jiraIssueKey,
              title: 'Linked Jira issue',
              status: 'Linked',
              url: capability.jiraBoardLink,
            },
          ]
        : [],
    },
    confluence: {
      provider: 'CONFLUENCE',
      ...buildStatus(
        capability.confluenceLink
          ? normalized.confluence.enabled
            ? 'READY'
            : 'NEEDS_CONFIGURATION'
          : 'NEEDS_CONFIGURATION',
        capability.confluenceLink
          ? normalized.confluence.enabled
            ? 'A Confluence page is linked and the workspace connector is enabled.'
            : 'A Confluence page is linked, but the workspace connector is not enabled yet.'
          : 'No Confluence page is linked to this capability yet.',
      ),
      pages: capability.confluenceLink
        ? [
            {
              pageId: confluencePageId,
              title: 'Linked Confluence page',
              url: capability.confluenceLink,
            },
          ]
        : [],
    },
  };
};

export const syncCapabilityGithubContext = async (
  capability: Capability,
  settings: WorkspaceConnectorSettings,
): Promise<GithubConnectorSyncResult> => {
  const normalized = normalizeWorkspaceConnectorSettings(settings);
  const repositories = capability.gitRepositories
    .map(parseGithubRepoUrl)
    .filter(Boolean) as Array<{ url: string; owner: string; repo: string }>;

  if (repositories.length === 0) {
    return {
      provider: 'GITHUB',
      ...buildStatus('NEEDS_CONFIGURATION', 'No GitHub repositories are linked to this capability yet.'),
      repositories: [],
      pullRequests: [],
      issues: [],
    };
  }

  if (!normalized.github.enabled) {
    return {
      provider: 'GITHUB',
      ...buildStatus(
        'NEEDS_CONFIGURATION',
        'Enable the workspace GitHub connector to fetch live repo, PR, and issue context.',
      ),
      repositories: repositories.map(repository => ({
        url: repository.url,
        owner: repository.owner,
        repo: repository.repo,
      })),
      pullRequests: [],
      issues: [],
    };
  }

  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
  };
  const token = readSecret(normalized.github.secretReference);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const repoContexts: GithubConnectorRepositoryContext[] = [];
    const pullRequests: GithubConnectorPullRequestContext[] = [];
    const issues: GithubConnectorIssueContext[] = [];

    for (const repository of repositories) {
      const baseUrl = withTrailingSlashRemoved(normalized.github.baseUrl) || 'https://api.github.com';
      const repoData = await requestJson<{
        description?: string;
        default_branch?: string;
        open_issues_count?: number;
      }>(`${baseUrl}/repos/${repository.owner}/${repository.repo}`, { headers });
      const repoPulls = await requestJson<
        Array<{ number: number; title: string; state: string; html_url: string }>
      >(`${baseUrl}/repos/${repository.owner}/${repository.repo}/pulls?state=open&per_page=3`, {
        headers,
      });
      const repoIssues = await requestJson<
        Array<{
          number: number;
          title: string;
          state: string;
          html_url: string;
          pull_request?: Record<string, unknown>;
        }>
      >(`${baseUrl}/repos/${repository.owner}/${repository.repo}/issues?state=open&per_page=3`, {
        headers,
      });

      repoContexts.push({
        url: repository.url,
        owner: repository.owner,
        repo: repository.repo,
        description: repoData.description,
        defaultBranch: repoData.default_branch,
        openIssueCount: repoIssues.filter(issue => !issue.pull_request).length,
        openPullRequestCount: repoPulls.length,
      });
      pullRequests.push(
        ...repoPulls.map(pull => ({
          number: pull.number,
          title: pull.title,
          state: pull.state,
          url: pull.html_url,
        })),
      );
      issues.push(
        ...repoIssues
          .filter(issue => !issue.pull_request)
          .map(issue => ({
            number: issue.number,
            title: issue.title,
            state: issue.state,
            url: issue.html_url,
          })),
      );
    }

    return {
      provider: 'GITHUB',
      ...buildStatus(
        'READY',
        `Fetched live GitHub context for ${repoContexts.length} linked repos.`,
      ),
      repositories: repoContexts,
      pullRequests,
      issues,
    };
  } catch (error) {
    return {
      provider: 'GITHUB',
      ...buildStatus(
        'ERROR',
        error instanceof Error ? error.message : 'Unable to fetch GitHub connector context.',
      ),
      repositories: repositories.map(repository => ({
        url: repository.url,
        owner: repository.owner,
        repo: repository.repo,
      })),
      pullRequests: [],
      issues: [],
    };
  }
};

export const syncCapabilityJiraContext = async (
  capability: Capability,
  settings: WorkspaceConnectorSettings,
): Promise<JiraConnectorSyncResult> => {
  const normalized = normalizeWorkspaceConnectorSettings(settings);
  const boardUrl = trim(capability.jiraBoardLink);
  const issueKey = parseJiraIssueKey(boardUrl);
  const projectKey = trim(normalized.jira.projectKey) || (issueKey ? issueKey.split('-')[0] : '');
  const token = readSecret(normalized.jira.secretReference);

  if (!boardUrl) {
    return {
      provider: 'JIRA',
      ...buildStatus('NEEDS_CONFIGURATION', 'No Jira board or issue URL is linked to this capability yet.'),
      boardUrl: undefined,
      issues: [],
    };
  }

  if (!normalized.jira.enabled || !normalized.jira.baseUrl || !normalized.jira.email || !token) {
    return {
      provider: 'JIRA',
      ...buildStatus(
        'NEEDS_CONFIGURATION',
        'Configure Jira base URL, email, and secret reference in workspace connectors to fetch live issue context.',
      ),
      boardUrl,
      issues: issueKey
        ? [{ key: issueKey, title: 'Linked Jira issue', status: 'Linked', url: boardUrl }]
        : [],
    };
  }

  const authHeader = `Basic ${Buffer.from(`${normalized.jira.email}:${token}`).toString('base64')}`;
  const headers: HeadersInit = {
    Accept: 'application/json',
    Authorization: authHeader,
  };

  try {
    const baseUrl = toJiraApiBaseUrl(normalized.jira.baseUrl);
    let issues: JiraConnectorIssueContext[] = [];

    if (issueKey) {
      const issue = await requestJson<{
        key: string;
        fields?: { summary?: string; status?: { name?: string } };
        self?: string;
      }>(`${baseUrl}/issue/${encodeURIComponent(issueKey)}?fields=summary,status`, {
        headers,
      });
      issues = [
        {
          key: issue.key,
          title: issue.fields?.summary || issue.key,
          status: issue.fields?.status?.name || 'Unknown',
          url: boardUrl,
        },
      ];
    } else if (projectKey) {
      const search = await requestJson<{
        issues?: Array<{
          key: string;
          fields?: { summary?: string; status?: { name?: string } };
        }>;
      }>(
        `${baseUrl}/search?jql=${encodeURIComponent(
          `project=${projectKey} ORDER BY updated DESC`,
        )}&maxResults=5&fields=summary,status`,
        { headers },
      );
      issues = (search.issues || []).map(issue => ({
        key: issue.key,
        title: issue.fields?.summary || issue.key,
        status: issue.fields?.status?.name || 'Unknown',
        url: boardUrl,
      }));
    }

    return {
      provider: 'JIRA',
      ...buildStatus('READY', `Fetched ${issues.length} Jira issue records for this capability.`),
      boardUrl,
      issues,
    };
  } catch (error) {
    return {
      provider: 'JIRA',
      ...buildStatus(
        'ERROR',
        error instanceof Error ? error.message : 'Unable to fetch Jira connector context.',
      ),
      boardUrl,
      issues: issueKey
        ? [{ key: issueKey, title: 'Linked Jira issue', status: 'Linked', url: boardUrl }]
        : [],
    };
  }
};

const buildConfluenceArtifact = ({
  capability,
  page,
  content,
}: {
  capability: Capability;
  page: ConfluenceConnectorPageContext;
  content: string;
}): Artifact => ({
  id: createArtifactId(),
  name: page.title ? `Confluence Page: ${page.title}` : `Confluence Page ${page.pageId || 'Sync'}`,
  capabilityId: capability.id,
  type: 'Confluence Page',
  version: 'connector-sync',
  agent: 'CONFLUENCE_CONNECTOR',
  created: new Date().toISOString(),
  direction: 'INPUT',
  summary: compactSummary(content),
  artifactKind: 'EXECUTION_SUMMARY',
  contentFormat: 'MARKDOWN',
  mimeType: 'text/markdown',
  fileName: `${toFileSlug(page.title || page.pageId || 'confluence-page')}.md`,
  contentText: content,
  downloadable: true,
});

export const syncCapabilityConfluenceContext = async (
  capability: Capability,
  settings: WorkspaceConnectorSettings,
): Promise<ConfluenceConnectorSyncResult> => {
  const normalized = normalizeWorkspaceConnectorSettings(settings);
  const link = trim(capability.confluenceLink);
  const pageId = parseConfluencePageId(link);
  const token = readSecret(normalized.confluence.secretReference);

  if (!link) {
    return {
      provider: 'CONFLUENCE',
      ...buildStatus('NEEDS_CONFIGURATION', 'No Confluence page is linked to this capability yet.'),
      pages: [],
    };
  }

  if (
    !normalized.confluence.enabled ||
    !normalized.confluence.baseUrl ||
    !normalized.confluence.email ||
    !token ||
    !pageId
  ) {
    return {
      provider: 'CONFLUENCE',
      ...buildStatus(
        'NEEDS_CONFIGURATION',
        'Configure Confluence base URL, email, secret reference, and a page URL to sync linked documentation into capability memory.',
      ),
      pages: [{ pageId, title: 'Linked Confluence page', url: link }],
    };
  }

  const authHeader = `Basic ${Buffer.from(
    `${normalized.confluence.email}:${token}`,
  ).toString('base64')}`;
  const headers: HeadersInit = {
    Accept: 'application/json',
    Authorization: authHeader,
  };

  try {
    const apiBaseUrl = toConfluenceApiBaseUrl(normalized.confluence.baseUrl);
    const webBaseUrl = toConfluenceWebBaseUrl(normalized.confluence.baseUrl);
    const page = await requestJson<{
      id: string;
      title: string;
      _links?: { webui?: string };
      space?: { key?: string };
      body?: { storage?: { value?: string } };
    }>(
      `${apiBaseUrl}/content/${encodeURIComponent(
        pageId,
      )}?expand=body.storage,space`,
      { headers },
    );
    const pageContext: ConfluenceConnectorPageContext = {
      pageId: page.id,
      title: page.title,
      url: page._links?.webui ? `${webBaseUrl}${page._links.webui}` : link,
      spaceKey: page.space?.key,
    };

    const markdown = [
      `# ${page.title}`,
      '',
      `Synced from Confluence page ${page.id}.`,
      '',
      page.body?.storage?.value || 'No page body was returned.',
    ].join('\n');

    const bundle = await getCapabilityBundle(capability.id);
    const nextArtifact = buildConfluenceArtifact({
      capability,
      page: pageContext,
      content: markdown,
    });
    await replaceCapabilityWorkspaceContentRecord(capability.id, {
      artifacts: [...bundle.workspace.artifacts, nextArtifact],
    });
    await refreshCapabilityMemory(capability.id, {
      requestReason: 'confluence-sync',
      requeueAgents: false,
    });

    return {
      provider: 'CONFLUENCE',
      ...buildStatus('READY', 'Confluence page synced into capability memory.'),
      pages: [pageContext],
    };
  } catch (error) {
    return {
      provider: 'CONFLUENCE',
      ...buildStatus(
        'ERROR',
        error instanceof Error ? error.message : 'Unable to sync the linked Confluence page.',
      ),
      pages: [{ pageId, title: 'Linked Confluence page', url: link }],
    };
  }
};

export const buildCapabilityConnectorContext = async (
  capabilityId: string,
): Promise<CapabilityConnectorContext> => {
  const [bundle, workspaceSettings] = await Promise.all([
    getCapabilityBundle(capabilityId),
    getWorkspaceSettings(),
  ]);

  return summarizeCapabilityConnectorContext(
    bundle.capability,
    workspaceSettings.connectors,
  );
};

export const syncCapabilityConnectorContext = async (
  capabilityId: string,
): Promise<CapabilityConnectorContext> => {
  const [bundle, workspaceSettings] = await Promise.all([
    getCapabilityBundle(capabilityId),
    getWorkspaceSettings(),
  ]);

  return {
    capabilityId,
    github: await syncCapabilityGithubContext(bundle.capability, workspaceSettings.connectors),
    jira: await syncCapabilityJiraContext(bundle.capability, workspaceSettings.connectors),
    confluence: await syncCapabilityConfluenceContext(
      bundle.capability,
      workspaceSettings.connectors,
    ),
  };
};

export const transitionJiraIssue = async ({
  capabilityId,
  issueKey,
  transitionId,
}: {
  capabilityId: string;
  issueKey: string;
  transitionId: string;
}) => {
  const [bundle, workspaceSettings] = await Promise.all([
    getCapabilityBundle(capabilityId),
    getWorkspaceSettings(),
  ]);
  const normalized = normalizeWorkspaceConnectorSettings(workspaceSettings.connectors);
  const token = readSecret(normalized.jira.secretReference);
  if (!normalized.jira.enabled || !normalized.jira.baseUrl || !normalized.jira.email || !token) {
    throw new Error('Jira connector is not fully configured for transitions.');
  }

  const authHeader = `Basic ${Buffer.from(`${normalized.jira.email}:${token}`).toString('base64')}`;
  const headers: HeadersInit = {
    Accept: 'application/json',
    Authorization: authHeader,
    'Content-Type': 'application/json',
  };
  const baseUrl = toJiraApiBaseUrl(normalized.jira.baseUrl);
  await fetch(
    `${baseUrl}/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        transition: { id: transitionId },
      }),
    },
  ).then(async response => {
    if (!response.ok) {
      const payload = await response.text();
      throw new Error(payload || 'Unable to transition the Jira issue.');
    }
  });

  return {
    status: 'READY' as const,
    message: `Transitioned Jira issue ${issueKey} for capability ${bundle.capability.name}.`,
  };
};

export const publishArtifactToConfluence = async ({
  capabilityId,
  artifactId,
  title,
  parentPageId,
}: {
  capabilityId: string;
  artifactId: string;
  title?: string;
  parentPageId?: string;
}) => {
  const [bundle, workspaceSettings] = await Promise.all([
    getCapabilityBundle(capabilityId),
    getWorkspaceSettings(),
  ]);
  const normalized = normalizeWorkspaceConnectorSettings(workspaceSettings.connectors);
  const token = readSecret(normalized.confluence.secretReference);
  if (
    !normalized.confluence.enabled ||
    !normalized.confluence.baseUrl ||
    !normalized.confluence.email ||
    !normalized.confluence.spaceKey ||
    !token
  ) {
    throw new Error('Confluence connector is not fully configured for publishing.');
  }

  const artifact = bundle.workspace.artifacts.find(item => item.id === artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} was not found for capability ${capabilityId}.`);
  }

  const authHeader = `Basic ${Buffer.from(
    `${normalized.confluence.email}:${token}`,
  ).toString('base64')}`;
  const headers: HeadersInit = {
    Accept: 'application/json',
    Authorization: authHeader,
    'Content-Type': 'application/json',
  };
  const apiBaseUrl = toConfluenceApiBaseUrl(normalized.confluence.baseUrl);
  const webBaseUrl = toConfluenceWebBaseUrl(normalized.confluence.baseUrl);
  const publishTitle = trim(title) || artifact.name;
  const markdown =
    artifact.contentText ||
    (artifact.contentJson ? JSON.stringify(artifact.contentJson, null, 2) : artifact.summary || '');
  const storageValue = `<h1>${escapeHtml(publishTitle)}</h1><pre>${escapeHtml(markdown)}</pre>`;

  const response = await fetch(`${apiBaseUrl}/content`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'page',
      title: publishTitle,
      space: { key: normalized.confluence.spaceKey },
      ancestors: parentPageId ? [{ id: parentPageId }] : undefined,
      body: {
        storage: {
          value: storageValue,
          representation: 'storage',
        },
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(payload || 'Unable to publish artifact to Confluence.');
  }

  const payload = (await response.json()) as {
    id?: string;
    _links?: { webui?: string };
  };

  return {
    status: 'READY' as const,
    message: `Published ${publishTitle} to Confluence.`,
    url: payload._links?.webui
      ? `${webBaseUrl}${payload._links.webui}`
      : undefined,
    pageId: payload.id,
  };
};
