import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeWorkspaceDatabaseBootstrapProfileSnapshot,
  encodeWorkspaceDatabaseBootstrapProfileSnapshot,
  resolveActiveWorkspaceDatabaseBootstrapProfileId,
  upsertWorkspaceDatabaseBootstrapProfile,
  writeWorkspaceDatabaseBootstrapEnvSnapshot,
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

  it('syncs the active runtime profile into the env file', async () => {
    const snapshot = upsertWorkspaceDatabaseBootstrapProfile(
      { profiles: [] },
      {
        host: '127.0.0.1',
        port: 5432,
        databaseName: 'sing5',
        user: 'ashokraj',
        adminDatabaseName: 'postgres',
      },
      { makeActive: true },
    );

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-profile-env-'));
    const envPath = path.join(tempDir, '.env.local');

    await fs.writeFile(envPath, 'PORT=3001\nPGDATABASE=singmaster\n', 'utf8');
    await writeWorkspaceDatabaseBootstrapEnvSnapshot(envPath, snapshot);

    const contents = await fs.readFile(envPath, 'utf8');
    expect(contents).toContain('PGDATABASE=sing5');
    expect(contents).toContain('PGHOST=127.0.0.1');
    expect(contents).toContain('PGUSER=ashokraj');
    expect(contents).toContain(
      `WORKSPACE_ACTIVE_DB_PROFILE_ID=${snapshot.activeProfileId}`,
    );
  });
});
