import { describe, expect, it } from 'vitest';
import {
  getDefaultExecutionConfig,
  hasMeaningfulExecutionCommandTemplate,
  isDefaultExecutionCommandTemplatePlaceholder,
} from '../executionConfig';

describe('executionConfig defaults', () => {
  it('keeps command templates empty until the user accepts or edits setup', () => {
    const config = getDefaultExecutionConfig({
      localDirectories: ['/workspace/demo'],
    });

    expect(config.defaultWorkspacePath).toBe('/workspace/demo');
    expect(config.commandTemplates).toEqual([]);
  });

  it('treats the legacy npm starter commands as placeholders, not meaningful setup', () => {
    const legacyTemplates = [
      {
        id: 'build',
        label: 'Build',
        description: 'Compile and package the capability workspace.',
        command: ['npm', 'run', 'build'],
      },
      {
        id: 'test',
        label: 'Test',
        description: 'Execute the configured automated test suite.',
        command: ['npm', 'run', 'test'],
      },
      {
        id: 'docs',
        label: 'Docs',
        description: 'Generate or refresh capability documentation artifacts.',
        command: ['npm', 'run', 'docs'],
      },
    ];

    expect(
      legacyTemplates.every(template =>
        isDefaultExecutionCommandTemplatePlaceholder(template),
      ),
    ).toBe(true);
    expect(hasMeaningfulExecutionCommandTemplate(legacyTemplates)).toBe(false);
  });
});
