// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRuntimeWorkingDirectory } from '../githubModels';

const tempDirectories: string[] = [];
const previousWorkingDirectory = process.env.SINGULARITY_WORKING_DIRECTORY;

const createTempDirectory = () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'singularityneo-working-dir-'),
  );
  tempDirectories.push(directory);
  return directory;
};

afterEach(() => {
  process.env.SINGULARITY_WORKING_DIRECTORY = previousWorkingDirectory;
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('resolveRuntimeWorkingDirectory', () => {
  it('prefers the explicit desktop working directory over capability hints', () => {
    const envDirectory = createTempDirectory();
    const capabilityDirectory = createTempDirectory();
    process.env.SINGULARITY_WORKING_DIRECTORY = envDirectory;

    const resolved = resolveRuntimeWorkingDirectory({
      localDirectories: [capabilityDirectory],
    } as any);

    expect(resolved).toBe(envDirectory);
  });

  it('uses an existing capability workspace root when available', () => {
    delete process.env.SINGULARITY_WORKING_DIRECTORY;
    const capabilityDirectory = createTempDirectory();

    const resolved = resolveRuntimeWorkingDirectory({
      localDirectories: [capabilityDirectory],
    } as any);

    expect(resolved).toBe(capabilityDirectory);
  });

  it('does not silently fall back to the application repo cwd', () => {
    delete process.env.SINGULARITY_WORKING_DIRECTORY;

    const resolved = resolveRuntimeWorkingDirectory();

    expect(fs.existsSync(resolved)).toBe(true);
    expect(resolved).not.toBe(process.cwd());
  });
});
