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

import { extractSymbolsFromSource } from '../codeIndex/parse';
import { findSymbolRangeInFile, searchCodeSymbols } from '../codeIndex/query';

beforeEach(() => {
  vi.clearAllMocks();
  getCapabilityRepositoriesRecordMock.mockResolvedValue([
    {
      id: 'repo-1',
      label: 'Primary repository',
    },
  ]);
});

describe('code index stage 1 upgrades', () => {
  it('extracts qualified nested symbols, alias lookups, and stable slice metadata', () => {
    const source = [
      "import { Context as RequestContext } from './ctx';",
      '',
      'export class AuthService {',
      '  login(user: string) {',
      '    function normalizeInput(value: string) {',
      '      return value.trim();',
      '    }',
      '',
      '    return normalizeInput(user);',
      '  }',
      '}',
      '',
      'export { AuthService as LoginHandler };',
      '',
      'export function login() {',
      "  return 'standalone';",
      '}',
      '',
    ].join('\n');

    const parsed = extractSymbolsFromSource('src/AuthService.ts', source);

    const classSymbol = parsed.symbols.find(symbol => symbol.qualifiedSymbolName === 'AuthService');
    const loginMethod = parsed.symbols.find(
      symbol => symbol.qualifiedSymbolName === 'AuthService.login',
    );
    const nestedFunction = parsed.symbols.find(
      symbol => symbol.qualifiedSymbolName === 'AuthService.login.normalizeInput',
    );
    const importAlias = parsed.symbols.find(symbol => symbol.symbolName === 'RequestContext');
    const exportAlias = parsed.symbols.find(symbol => symbol.symbolName === 'LoginHandler');

    expect(classSymbol?.symbolId).toMatch(/^SYM-/);
    expect(classSymbol?.language).toBe('ts');
    expect(loginMethod?.containerSymbolId).toBe(classSymbol?.symbolId);
    expect(loginMethod?.sliceStartLine).toBe(4);
    expect(loginMethod?.sliceEndLine).toBe(10);
    expect(nestedFunction?.containerSymbolId).toBe(loginMethod?.symbolId);
    expect(importAlias?.isExported).toBe(false);
    expect(exportAlias?.isExported).toBe(true);
  });

  it('maps enriched symbol search rows and builds qualified-name ranking SQL', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          repository_id: 'repo-1',
          file_path: 'src/AuthService.ts',
          symbol_id: 'SYM-LOGIN',
          container_symbol_id: 'SYM-AUTH',
          symbol_name: 'login',
          qualified_symbol_name: 'AuthService.login',
          kind: 'method',
          language: 'ts',
          parent_symbol: 'AuthService',
          start_line: 4,
          end_line: 10,
          slice_start_line: 4,
          slice_end_line: 10,
          signature: 'login(user: string) { ... }',
          is_exported: false,
          sha: 'abc123',
          indexed_at: '2026-04-22T00:00:00.000Z',
        },
      ],
    });

    const results = await searchCodeSymbols('CAP-1', 'AuthService.login', {
      repositoryId: 'repo-1',
      nearFilePath: 'src/AuthService.ts',
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql] = queryMock.mock.calls[0] || [];
    expect(String(sql)).toContain('qualified_symbol_name');
    expect(String(sql)).toContain('LOWER(');
    expect(results[0]).toMatchObject({
      repositoryId: 'repo-1',
      filePath: 'src/AuthService.ts',
      symbolId: 'SYM-LOGIN',
      containerSymbolId: 'SYM-AUTH',
      qualifiedSymbolName: 'AuthService.login',
      sliceStartLine: 4,
      sliceEndLine: 10,
      language: 'ts',
    });
  });

  it('resolves qualified symbol reads even for legacy rows without slice columns', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          symbol_id: null,
          container_symbol_id: null,
          symbol_name: 'login',
          qualified_symbol_name: null,
          parent_symbol: 'AuthService',
          start_line: 12,
          end_line: 34,
          slice_start_line: null,
          slice_end_line: null,
          kind: 'method',
          file_path: 'src/AuthService.ts',
        },
      ],
    });

    const range = await findSymbolRangeInFile(
      'CAP-1',
      'src/AuthService.ts',
      'AuthService.login',
    );

    expect(range).toMatchObject({
      qualifiedSymbolName: 'AuthService.login',
      startLine: 12,
      endLine: 34,
      sliceStartLine: 12,
      sliceEndLine: 34,
      kind: 'method',
    });
  });
});
