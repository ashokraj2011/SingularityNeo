// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectWorkspaceProfile } from '../workspaceProfile';

const createdRoots: string[] = [];

const createWorkspace = async (name: string) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `singularity-${name}-`));
  createdRoots.push(root);
  return root;
};

const writeJson = async (filePath: string, value: unknown) => {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

describe('detectWorkspaceProfile', () => {
  afterEach(async () => {
    await Promise.all(
      createdRoots.splice(0).map(root =>
        fs.rm(root, { recursive: true, force: true }),
      ),
    );
  });

  it('detects a Node workspace and only recommends scripts that exist', async () => {
    const root = await createWorkspace('node');
    await writeJson(path.join(root, 'package.json'), {
      scripts: {
        build: 'vite build',
        test: 'vitest run',
        docs: 'typedoc src',
      },
    });
    await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9', 'utf8');

    const result = detectWorkspaceProfile({
      defaultWorkspacePath: root,
      workspaceRoots: [root],
    });

    expect(result.profile.stack).toBe('NODE');
    expect(result.profile.buildTool).toBe('PNPM');
    expect(result.recommendedCommandTemplates.map(template => template.id)).toEqual([
      'build',
      'test',
      'docs',
    ]);
    expect(result.recommendedCommandTemplates[0]?.command).toEqual([
      'pnpm',
      'run',
      'build',
    ]);
  });

  it('detects a Python workspace and prefers poetry when poetry files exist', async () => {
    const root = await createWorkspace('python');
    await fs.writeFile(
      path.join(root, 'pyproject.toml'),
      '[tool.poetry]\nname = "demo"\n',
      'utf8',
    );
    await fs.writeFile(path.join(root, 'poetry.lock'), 'demo', 'utf8');
    await fs.writeFile(path.join(root, 'pytest.ini'), '[pytest]\n', 'utf8');

    const result = detectWorkspaceProfile({
      defaultWorkspacePath: root,
      workspaceRoots: [root],
    });

    expect(result.profile.stack).toBe('PYTHON');
    expect(result.profile.buildTool).toBe('POETRY');
    expect(result.recommendedCommandTemplates.map(template => template.id)).toEqual([
      'test',
      'build',
    ]);
    expect(result.recommendedCommandTemplates[0]?.command).toEqual([
      'poetry',
      'run',
      'pytest',
    ]);
    expect(result.recommendedCommandTemplates[1]?.command).toEqual([
      'poetry',
      'build',
    ]);
  });

  it('detects a Maven workspace and prefers the wrapper command', async () => {
    const root = await createWorkspace('java-maven');
    await fs.writeFile(path.join(root, 'pom.xml'), '<project />', 'utf8');
    await fs.writeFile(path.join(root, 'mvnw'), '#!/bin/sh', 'utf8');

    const result = detectWorkspaceProfile({
      defaultWorkspacePath: root,
      workspaceRoots: [root],
    });

    expect(result.profile.stack).toBe('JAVA');
    expect(result.profile.buildTool).toBe('MAVEN');
    expect(result.recommendedCommandTemplates.map(template => template.command)).toEqual([
      ['./mvnw', 'test'],
      ['./mvnw', 'package'],
    ]);
  });

  it('detects a Gradle workspace and prefers the wrapper command', async () => {
    const root = await createWorkspace('java-gradle');
    await fs.writeFile(path.join(root, 'build.gradle'), 'plugins {}', 'utf8');
    await fs.writeFile(path.join(root, 'gradlew'), '#!/bin/sh', 'utf8');

    const result = detectWorkspaceProfile({
      defaultWorkspacePath: root,
      workspaceRoots: [root],
    });

    expect(result.profile.stack).toBe('JAVA');
    expect(result.profile.buildTool).toBe('GRADLE');
    expect(result.recommendedCommandTemplates.map(template => template.command)).toEqual([
      ['./gradlew', 'test'],
      ['./gradlew', 'build'],
    ]);
  });

  it('detects a nested child application when the approved path is a parent folder', async () => {
    const root = await createWorkspace('parent');
    const child = path.join(root, 'todo-app');
    await fs.mkdir(child, { recursive: true });
    await writeJson(path.join(child, 'package.json'), {
      scripts: {
        build: 'vite build',
      },
    });

    const result = detectWorkspaceProfile({
      defaultWorkspacePath: root,
      workspaceRoots: [root],
    });

    expect(result.profile.stack).toBe('NODE');
    expect(result.normalizedPath).toBe(child);
    expect(result.recommendedCommandTemplates.map(template => template.id)).toEqual([
      'build',
    ]);
  });

  it('returns GENERIC when no supported stack signals are found', async () => {
    const root = await createWorkspace('generic');
    await fs.writeFile(path.join(root, 'README.md'), '# Demo', 'utf8');

    const result = detectWorkspaceProfile({
      defaultWorkspacePath: root,
      workspaceRoots: [root],
    });

    expect(result.profile.stack).toBe('GENERIC');
    expect(result.recommendedCommandTemplates).toEqual([]);
    expect(result.recommendedDeploymentTargets).toEqual([]);
  });
});
