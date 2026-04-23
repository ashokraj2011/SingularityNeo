// @vitest-environment node
import { spawnSync as realSpawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hasJavaToolchain = [
  ['java', ['-version']],
  ['javac', ['-version']],
].every(([command, args]) => {
  const result = realSpawnSync(command, args, {
    encoding: 'utf8',
  });
  return !result.error && result.status === 0;
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('node:child_process');
});

const describeIfJava = hasJavaToolchain ? describe : describe.skip;

describeIfJava('java AST extraction', () => {
  it('extracts nested types, constructors, methods, properties, and import symbols', async () => {
    const { extractSymbolsFromJavaSource } = await import('../codeIndex/parseJava');

    const source = [
      'package demo;',
      '',
      'import java.util.List;',
      'import static java.util.Collections.emptyList;',
      '',
      'public class Outer {',
      '  private static final int COUNT = 1;',
      '',
      '  class Inner {',
      '    public String name() {',
      '      return "inner";',
      '    }',
      '  }',
      '',
      '  public Outer() {}',
      '',
      '  public <T> List<T> map(List<T> input) {',
      '    return input == null ? emptyList() : input;',
      '  }',
      '}',
      '',
    ].join('\n');

    const parsed = extractSymbolsFromJavaSource('src/demo/Outer.java', source);

    expect(parsed.references).toEqual(
      expect.arrayContaining([
        { toModule: 'java.util.List', kind: 'IMPORTS' },
        { toModule: 'java.util.Collections.emptyList', kind: 'IMPORTS' },
      ]),
    );

    expect(parsed.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: 'List',
          kind: 'variable',
          qualifiedSymbolName: 'List',
          isExported: false,
        }),
        expect.objectContaining({
          symbolName: 'emptyList',
          kind: 'variable',
          qualifiedSymbolName: 'emptyList',
          isExported: false,
        }),
        expect.objectContaining({
          symbolName: 'Outer',
          kind: 'class',
          qualifiedSymbolName: 'Outer',
          startLine: 6,
          endLine: 20,
          isExported: true,
        }),
        expect.objectContaining({
          symbolName: 'COUNT',
          kind: 'property',
          parentSymbol: 'Outer',
          qualifiedSymbolName: 'Outer.COUNT',
          startLine: 7,
          endLine: 7,
        }),
        expect.objectContaining({
          symbolName: 'Inner',
          kind: 'class',
          parentSymbol: 'Outer',
          qualifiedSymbolName: 'Outer.Inner',
        }),
        expect.objectContaining({
          symbolName: 'name',
          kind: 'method',
          parentSymbol: 'Inner',
          qualifiedSymbolName: 'Outer.Inner.name',
          startLine: 10,
          endLine: 12,
        }),
        expect.objectContaining({
          symbolName: 'constructor',
          kind: 'method',
          parentSymbol: 'Outer',
          qualifiedSymbolName: 'Outer.constructor',
          startLine: 15,
          endLine: 15,
        }),
        expect.objectContaining({
          symbolName: 'map',
          kind: 'method',
          parentSymbol: 'Outer',
          qualifiedSymbolName: 'Outer.map',
          startLine: 17,
          endLine: 19,
        }),
      ]),
    );
  });
});

describe('java parser fallback', () => {
  it('uses the heuristic parser when the Java toolchain is unavailable', async () => {
    const spawnSyncMock = vi.fn().mockReturnValue({
      error: Object.assign(new Error('missing java'), { code: 'ENOENT' }),
      status: null,
      stdout: '',
      stderr: '',
    });

    vi.doMock('node:child_process', () => ({
      spawnSync: spawnSyncMock,
    }));

    const { extractSymbolsFromJavaSource } = await import('../codeIndex/parseJava');

    const source = [
      'public class Legacy {',
      '  private String value;',
      '  public String read() {',
      '    return value;',
      '  }',
      '}',
      '',
    ].join('\n');

    const parsed = extractSymbolsFromJavaSource('Legacy.java', source);

    expect(spawnSyncMock).toHaveBeenCalled();
    expect(parsed.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: 'Legacy',
          kind: 'class',
          startLine: 1,
          endLine: 6,
          isExported: true,
        }),
        expect.objectContaining({
          symbolName: 'value',
          kind: 'property',
          parentSymbol: 'Legacy',
          startLine: 2,
          endLine: 2,
        }),
        expect.objectContaining({
          symbolName: 'read',
          kind: 'method',
          parentSymbol: 'Legacy',
          startLine: 3,
          endLine: 5,
        }),
      ]),
    );
  });
});
