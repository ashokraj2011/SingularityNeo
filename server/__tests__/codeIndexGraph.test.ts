// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, getCapabilityRepositoriesRecordMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getCapabilityRepositoriesRecordMock: vi.fn(),
}));

vi.mock('../db', () => ({
  query: queryMock,
}));

vi.mock('../repository', () => ({
  getCapabilityRepositoriesRecord: getCapabilityRepositoriesRecordMock,
}));

import { readBlastRadiusSymbolGraph } from '../codeIndex/query';

describe('readBlastRadiusSymbolGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCapabilityRepositoriesRecordMock.mockResolvedValue([
      {
        id: 'REPO-1',
        capabilityId: 'CAP-GRAPH',
        label: 'Primary Repo',
        url: 'https://github.com/example/repo',
        defaultBranch: 'main',
        isPrimary: true,
        status: 'ACTIVE',
      },
    ]);
  });

  it('returns recursive containment nodes and edges for a file seed', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('WITH RECURSIVE seed_symbols')) {
        return {
          rows: [
            {
              repository_id: 'REPO-1',
              file_path: 'src/AuthService.ts',
              symbol_id: 'SYM-AUTH',
              container_symbol_id: null,
              symbol_name: 'AuthService',
              qualified_symbol_name: 'AuthService',
              kind: 'class',
              language: 'ts',
              parent_symbol: null,
              start_line: 10,
              end_line: 120,
              slice_start_line: 10,
              slice_end_line: 120,
              signature: 'export class AuthService',
              is_exported: true,
              sha: 'sha-a',
              indexed_at: '2026-04-23T00:00:00.000Z',
              root_symbol_id: 'SYM-AUTH',
              depth: 0,
              relation: 'SEED',
            },
            {
              repository_id: 'REPO-1',
              file_path: 'src/AuthService.ts',
              symbol_id: 'SYM-LOGIN',
              container_symbol_id: 'SYM-AUTH',
              symbol_name: 'login',
              qualified_symbol_name: 'AuthService.login',
              kind: 'method',
              language: 'ts',
              parent_symbol: 'AuthService',
              start_line: 40,
              end_line: 70,
              slice_start_line: 40,
              slice_end_line: 70,
              signature: 'login(input: Credentials)',
              is_exported: false,
              sha: 'sha-a',
              indexed_at: '2026-04-23T00:00:00.000Z',
              root_symbol_id: 'SYM-AUTH',
              depth: 1,
              relation: 'DESCENDANT',
            },
          ],
        } as any;
      }
      if (sql.includes('FROM capability_code_symbol_edges AS edge')) {
        return {
          rows: [
            {
              repository_id: 'REPO-1',
              from_symbol_id: 'SYM-AUTH',
              to_symbol_id: 'SYM-LOGIN',
              from_file_path: 'src/AuthService.ts',
              to_file_path: 'src/AuthService.ts',
              edge_kind: 'CONTAINS',
              from_symbol_name: 'AuthService',
              to_symbol_name: 'login',
              from_qualified_symbol_name: 'AuthService',
              to_qualified_symbol_name: 'AuthService.login',
            },
          ],
        } as any;
      }
      return { rows: [] } as any;
    });

    const result = await readBlastRadiusSymbolGraph('CAP-GRAPH', {
      filePath: 'src/AuthService.ts',
      maxDepth: 3,
      maxNodes: 12,
    });

    expect(result.seedSymbolIds).toEqual(['SYM-AUTH']);
    expect(result.totalNodes).toBe(2);
    expect(result.nodes.map(node => [node.symbolId, node.relation, node.depth])).toEqual([
      ['SYM-AUTH', 'SEED', 0],
      ['SYM-LOGIN', 'DESCENDANT', 1],
    ]);
    expect(result.edges).toEqual([
      expect.objectContaining({
        fromSymbolId: 'SYM-AUTH',
        toSymbolId: 'SYM-LOGIN',
        edgeKind: 'CONTAINS',
      }),
    ]);
  });
});
