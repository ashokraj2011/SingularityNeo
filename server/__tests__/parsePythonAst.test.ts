// @vitest-environment node
import { spawnSync as realSpawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hasPythonInterpreter = ['python3', 'python'].some(command => {
  const result = realSpawnSync(command, ['--version'], {
    encoding: 'utf8',
  });
  return !result.error && result.status === 0;
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('node:child_process');
});

const describeIfPython = hasPythonInterpreter ? describe : describe.skip;

describeIfPython('python AST extraction', () => {
  it('extracts nested symbols, decorated properties, and import aliases', async () => {
    const { extractSymbolsFromPythonSource } = await import('../codeIndex/parsePython');

    const source = [
      'import numpy as np',
      'from pkg.utils import helper as alias_helper',
      '',
      '_hidden = 1',
      '',
      'class Outer:',
      '    answer = 42',
      '',
      '    class Inner:',
      '        def run(self, value):',
      '            return value',
      '',
      '    @property',
      '    def name(self):',
      "        return 'outer'",
      '',
      'async def sync_me():',
      '    return alias_helper(np.array([1]))',
      '',
    ].join('\n');

    const parsed = extractSymbolsFromPythonSource('pkg/module.py', source);

    expect(parsed.references).toEqual(
      expect.arrayContaining([
        { toModule: 'numpy', kind: 'IMPORTS' },
        { toModule: 'pkg.utils', kind: 'IMPORTS' },
      ]),
    );

    expect(parsed.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: 'np',
          kind: 'variable',
          isExported: false,
          qualifiedSymbolName: 'np',
        }),
        expect.objectContaining({
          symbolName: 'alias_helper',
          kind: 'variable',
          isExported: false,
          qualifiedSymbolName: 'alias_helper',
        }),
        expect.objectContaining({
          symbolName: '_hidden',
          kind: 'variable',
          isExported: false,
          qualifiedSymbolName: '_hidden',
        }),
        expect.objectContaining({
          symbolName: 'Outer',
          kind: 'class',
          qualifiedSymbolName: 'Outer',
          startLine: 6,
          endLine: 15,
        }),
        expect.objectContaining({
          symbolName: 'answer',
          kind: 'property',
          parentSymbol: 'Outer',
          qualifiedSymbolName: 'Outer.answer',
        }),
        expect.objectContaining({
          symbolName: 'Inner',
          kind: 'class',
          parentSymbol: 'Outer',
          qualifiedSymbolName: 'Outer.Inner',
        }),
        expect.objectContaining({
          symbolName: 'run',
          kind: 'method',
          parentSymbol: 'Inner',
          qualifiedSymbolName: 'Outer.Inner.run',
          startLine: 10,
          endLine: 11,
        }),
        expect.objectContaining({
          symbolName: 'name',
          kind: 'property',
          parentSymbol: 'Outer',
          qualifiedSymbolName: 'Outer.name',
          startLine: 14,
          endLine: 15,
        }),
        expect.objectContaining({
          symbolName: 'sync_me',
          kind: 'function',
          qualifiedSymbolName: 'sync_me',
          startLine: 17,
          endLine: 18,
        }),
      ]),
    );
  });
});

describe('python parser fallback', () => {
  it('uses the heuristic parser when no Python interpreter is available', async () => {
    const spawnSyncMock = vi.fn().mockReturnValue({
      error: Object.assign(new Error('missing python'), { code: 'ENOENT' }),
      status: null,
      stdout: '',
      stderr: '',
    });

    vi.doMock('node:child_process', () => ({
      spawnSync: spawnSyncMock,
    }));

    const { extractSymbolsFromPythonSource } = await import('../codeIndex/parsePython');

    const source = [
      'class Heuristic:',
      '    def run(self):',
      '        return 1',
      '',
      '_private_value = 1',
      'public_value = 2',
      '',
    ].join('\n');

    const parsed = extractSymbolsFromPythonSource('legacy.py', source);

    expect(spawnSyncMock).toHaveBeenCalled();
    expect(parsed.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: 'Heuristic',
          kind: 'class',
          startLine: 1,
          endLine: 3,
        }),
        expect.objectContaining({
          symbolName: 'run',
          kind: 'method',
          parentSymbol: 'Heuristic',
          startLine: 2,
          endLine: 3,
        }),
        expect.objectContaining({
          symbolName: '_private_value',
          kind: 'variable',
          isExported: false,
        }),
        expect.objectContaining({
          symbolName: 'public_value',
          kind: 'variable',
          isExported: true,
        }),
      ]),
    );
  });
});
