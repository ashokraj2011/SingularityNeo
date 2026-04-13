import { describe, expect, it } from 'vitest';
import {
  decodeWorkspaceDatabaseBootstrapProfileSnapshot,
  encodeWorkspaceDatabaseBootstrapProfileSnapshot,
  resolveActiveWorkspaceDatabaseBootstrapProfileId,
  upsertWorkspaceDatabaseBootstrapProfile,
} from '../databaseProfiles';

describe('databaseProfiles', () => {
  it('upserts and activates a saved runtime database profile', () => {
    const snapshot = upsertWorkspaceDatabaseBootstrapProfile(
      { profiles: [] },
      {
        host: '127.0.0.1',
        port: 5432,
        databaseName: 'singularity',
        user: 'postgres',
        adminDatabaseName: 'postgres',
        password: 'secret',
      },
      { makeActive: true },
    );

    expect(snapshot.profiles).toHaveLength(1);
    expect(snapshot.activeProfileId).toBe(snapshot.profiles[0]?.id);
    expect(snapshot.profiles[0]?.label).toContain('singularity');
  });

  it('preserves a stored password when a matching profile is updated without one', () => {
    const initial = upsertWorkspaceDatabaseBootstrapProfile(
      { profiles: [] },
      {
        host: '127.0.0.1',
        port: 5432,
        databaseName: 'singularity',
        user: 'postgres',
        adminDatabaseName: 'postgres',
        password: 'secret',
      },
      { makeActive: true },
    );

    const updated = upsertWorkspaceDatabaseBootstrapProfile(
      initial,
      {
        host: '127.0.0.1',
        port: 5432,
        databaseName: 'singularity',
        user: 'postgres',
        adminDatabaseName: 'postgres',
      },
      { makeActive: true },
    );

    expect(updated.profiles[0]?.password).toBe('secret');
  });

  it('round-trips encoded profile snapshots and resolves active profile by runtime match', () => {
    const snapshot = upsertWorkspaceDatabaseBootstrapProfile(
      { profiles: [] },
      {
        host: 'db.internal',
        port: 5432,
        databaseName: 'singularity_two',
        user: 'neo',
        adminDatabaseName: 'postgres',
      },
      { makeActive: true },
    );

    const decoded = decodeWorkspaceDatabaseBootstrapProfileSnapshot({
      encodedProfiles: encodeWorkspaceDatabaseBootstrapProfileSnapshot(snapshot),
      activeProfileId: '',
    });

    expect(decoded.profiles).toHaveLength(1);
    expect(
      resolveActiveWorkspaceDatabaseBootstrapProfileId(decoded, {
        host: 'db.internal',
        port: 5432,
        databaseName: 'singularity_two',
        user: 'neo',
        adminDatabaseName: 'postgres',
      }),
    ).toBe(decoded.profiles[0]?.id);
  });
});
