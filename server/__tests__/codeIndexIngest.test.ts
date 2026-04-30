// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  transactionMock,
  clientQueryMock,
  getCapabilityRepositoriesRecordMock,
  getWorkspaceSettingsMock,
  readCodeIndexSnapshotMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  transactionMock: vi.fn(),
  clientQueryMock: vi.fn(),
  getCapabilityRepositoriesRecordMock: vi.fn(),
  getWorkspaceSettingsMock: vi.fn(),
  readCodeIndexSnapshotMock: vi.fn(),
}));

vi.mock('../db', () => ({
  query: queryMock,
  transaction: transactionMock,
}));

vi.mock('../domains/self-service/repository', () => ({
  getCapabilityRepositoriesRecord: getCapabilityRepositoriesRecordMock,
  getWorkspaceSettings: getWorkspaceSettingsMock,
}));

vi.mock('../codeIndex/query', () => ({
  readCodeIndexSnapshot: readCodeIndexSnapshotMock,
}));

import { refreshCapabilityCodeIndex } from '../codeIndex/ingest';

const fetchMock = vi.fn();
const temporaryRoots: string[] = [];
const disabledConnectorSettings = {
  databaseConfigs: [],
  connectors: {
    github: {
      enabled: false,
      baseUrl: '',
      secretReference: '',
      ownerHint: '',
    },
    jira: {
      enabled: false,
      baseUrl: '',
      email: '',
      secretReference: '',
      projectKey: '',
    },
    confluence: {
      enabled: false,
      baseUrl: '',
      email: '',
      secretReference: '',
      spaceKey: '',
    },
  },
};

describe('code index ingest hardening', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    global.fetch = fetchMock as unknown as typeof fetch;
    clientQueryMock.mockResolvedValue({ rows: [] } as any);
    transactionMock.mockImplementation(async callback =>
      callback({ query: clientQueryMock } as any),
    );
    getCapabilityRepositoriesRecordMock.mockResolvedValue([
      {
        id: 'REPO-1',
        capabilityId: 'CAP-INDEX',
        label: 'Primary repo',
        url: 'https://github.com/example/private-repo',
        defaultBranch: 'main',
        isPrimary: true,
        status: 'ACTIVE',
      },
    ]);
    readCodeIndexSnapshotMock.mockResolvedValue({
      capabilityId: 'CAP-INDEX',
      repositories: [],
      totalSymbols: 0,
      totalFiles: 0,
      totalReferences: 0,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    while (temporaryRoots.length > 0) {
      const root = temporaryRoots.pop();
      if (root && fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('uses the workspace GitHub connector secret when indexing repos', async () => {
    process.env.TEST_GH_SECRET = 'connector-token';
    getWorkspaceSettingsMock.mockResolvedValue({
      databaseConfigs: [],
      connectors: {
        github: {
          enabled: true,
          baseUrl: 'https://api.github.com',
          secretReference: 'TEST_GH_SECRET',
          ownerHint: '',
        },
        jira: {
          enabled: false,
          baseUrl: '',
          email: '',
          secretReference: '',
          projectKey: '',
        },
        confluence: {
          enabled: false,
          baseUrl: '',
          email: '',
          secretReference: '',
          spaceKey: '',
        },
      },
    });
    queryMock.mockResolvedValue({ rows: [] } as any);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ tree: [], truncated: false }),
    } as any);

    await refreshCapabilityCodeIndex('CAP-INDEX');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] || [];
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer connector-token',
    });
  });

  it('reuses unchanged indexed files and only fetches changed blobs', async () => {
    process.env.GITHUB_TOKEN = 'env-token';
    getWorkspaceSettingsMock.mockResolvedValue({
      databaseConfigs: [],
      connectors: {
        github: {
          enabled: false,
          baseUrl: '',
          secretReference: '',
          ownerHint: '',
        },
        jira: {
          enabled: false,
          baseUrl: '',
          email: '',
          secretReference: '',
          projectKey: '',
        },
        confluence: {
          enabled: false,
          baseUrl: '',
          email: '',
          secretReference: '',
          spaceKey: '',
        },
      },
    });

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM capability_code_symbols')) {
        return {
          rows: [
            {
              file_path: 'src/unchanged.ts',
              symbol_id: 'SYM-UNCHANGED',
              container_symbol_id: null,
              symbol_name: 'stableFn',
              qualified_symbol_name: 'stableFn',
              kind: 'function',
              language: 'ts',
              parent_symbol: '',
              start_line: 1,
              end_line: 3,
              slice_start_line: 1,
              slice_end_line: 3,
              signature: 'export function stableFn() {}',
              is_exported: true,
              sha: 'sha-unchanged',
            },
          ],
        } as any;
      }
      if (sql.includes('FROM capability_code_references')) {
        return {
          rows: [
            {
              from_file: 'src/unchanged.ts',
              to_module: './shared',
              kind: 'IMPORTS',
            },
          ],
        } as any;
      }
      if (sql.includes('INSERT INTO capability_code_index_runs')) {
        return { rows: [] } as any;
      }
      return { rows: [] } as any;
    });

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          tree: [
            { path: 'src/unchanged.ts', type: 'blob', sha: 'sha-unchanged', size: 80 },
            { path: 'src/changed.ts', type: 'blob', sha: 'sha-changed', size: 120 },
          ],
          truncated: false,
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          content: Buffer.from('export function changedFn() { return 1; }', 'utf8').toString(
            'base64',
          ),
          encoding: 'base64',
        }),
      } as any);

    await refreshCapabilityCodeIndex('CAP-INDEX');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0] || '')).toContain('/git/trees/main?recursive=1');
    expect(String(fetchMock.mock.calls[1]?.[0] || '')).toContain('/git/blobs/sha-changed');
    expect(String(fetchMock.mock.calls[1]?.[0] || '')).not.toContain('sha-unchanged');
  });

  it('uses the configured GitHub API base for enterprise hosts', async () => {
    process.env.TEST_GHE_SECRET = 'enterprise-token';
    getCapabilityRepositoriesRecordMock.mockResolvedValue([
      {
        id: 'REPO-ENT',
        capabilityId: 'CAP-INDEX',
        label: 'Enterprise repo',
        url: 'https://ghe.example.com/platform/payments-service',
        defaultBranch: 'main',
        isPrimary: true,
        status: 'ACTIVE',
      },
    ]);
    getWorkspaceSettingsMock.mockResolvedValue({
      databaseConfigs: [],
      connectors: {
        github: {
          enabled: true,
          baseUrl: 'https://ghe.example.com/api/v3',
          secretReference: 'TEST_GHE_SECRET',
          ownerHint: '',
        },
        jira: {
          enabled: false,
          baseUrl: '',
          email: '',
          secretReference: '',
          projectKey: '',
        },
        confluence: {
          enabled: false,
          baseUrl: '',
          email: '',
          secretReference: '',
          spaceKey: '',
        },
      },
    });
    queryMock.mockResolvedValue({ rows: [] } as any);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ tree: [], truncated: false }),
    } as any);

    await refreshCapabilityCodeIndex('CAP-INDEX');

    expect(String(fetchMock.mock.calls[0]?.[0] || '')).toContain(
      'https://ghe.example.com/api/v3/repos/platform/payments-service/git/trees/main?recursive=1',
    );
    const [, init] = fetchMock.mock.calls[0] || [];
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer enterprise-token',
    });
  });

  it('preserves the existing repo index when remote access fails before parsing', async () => {
    process.env.GITHUB_TOKEN = '';
    process.env.GH_TOKEN = '';
    getWorkspaceSettingsMock.mockResolvedValue(disabledConnectorSettings);
    queryMock.mockResolvedValue({ rows: [] } as any);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers([['x-ratelimit-remaining', '1']]),
      json: async () => ({}),
    } as any);

    await refreshCapabilityCodeIndex('CAP-INDEX');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const destructiveRefreshCalls = clientQueryMock.mock.calls.filter(call => {
      const sql = String(call[0] || '');
      return (
        sql.includes('DELETE FROM capability_code_symbols') ||
        sql.includes('DELETE FROM capability_code_references') ||
        sql.includes('DELETE FROM capability_code_symbol_edges')
      );
    });
    expect(destructiveRefreshCalls).toEqual([]);
  });

  it('indexes from a readable local clone without calling GitHub', async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sing-code-index-local-'));
    temporaryRoots.push(localRoot);
    fs.mkdirSync(path.join(localRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(localRoot, 'src', 'local.ts'),
      'export function localHelper() { return 1; }\n',
      'utf8',
    );

    getCapabilityRepositoriesRecordMock.mockResolvedValue([
      {
        id: 'REPO-LOCAL',
        capabilityId: 'CAP-INDEX',
        label: 'Local repo',
        url: 'https://github.com/example/private-repo',
        defaultBranch: 'main',
        localRootHint: localRoot,
        isPrimary: true,
        status: 'ACTIVE',
      },
    ]);
    getWorkspaceSettingsMock.mockResolvedValue({
      databaseConfigs: [],
      connectors: {
        github: {
          enabled: false,
          baseUrl: '',
          secretReference: '',
          ownerHint: '',
        },
        jira: {
          enabled: false,
          baseUrl: '',
          email: '',
          secretReference: '',
          projectKey: '',
        },
        confluence: {
          enabled: false,
          baseUrl: '',
          email: '',
          secretReference: '',
          spaceKey: '',
        },
      },
    });
    queryMock.mockResolvedValue({ rows: [] } as any);

    await refreshCapabilityCodeIndex('CAP-INDEX');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(clientQueryMock).toHaveBeenCalled();
    const insertCall = clientQueryMock.mock.calls.find(call =>
      String(call[0] || '').includes('INSERT INTO capability_code_symbols'),
    );
    expect(String(JSON.stringify(insertCall?.[1] || []))).toContain('src/local.ts');
  });
});
