import { beforeEach, describe, expect, it } from 'vitest';
import {
  readJsonViewPreference,
  readViewPreference,
  writeJsonViewPreference,
  writeViewPreference,
} from '../viewPreferences';

describe('view preference helpers', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('reads and writes string preferences with allowed-value guards', () => {
    writeViewPreference('pref.tab', 'learning');

    expect(
      readViewPreference<'overview' | 'learning'>('pref.tab', 'overview', {
        allowed: ['overview', 'learning'] as const,
      }),
    ).toBe('learning');

    writeViewPreference('pref.tab', 'unexpected');

    expect(
      readViewPreference<'overview' | 'learning'>('pref.tab', 'overview', {
        allowed: ['overview', 'learning'] as const,
      }),
    ).toBe('overview');
  });

  it('supports session storage and JSON preferences', () => {
    writeViewPreference('pref.view', 'board', { storage: 'session' });
    writeJsonViewPreference('pref.layout', { collapsed: true });

    expect(readViewPreference('pref.view', 'list', { storage: 'session' })).toBe('board');
    expect(readJsonViewPreference('pref.layout', { collapsed: false })).toEqual({
      collapsed: true,
    });
  });
});
