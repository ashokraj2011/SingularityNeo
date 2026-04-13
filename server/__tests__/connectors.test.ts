// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDefaultCapabilityLifecycle } from '../../src/lib/capabilityLifecycle';
import { normalizeWorkspaceConnectorSettings } from '../../src/lib/workspaceConnectors';
import { summarizeCapabilityConnectorContext } from '../connectors';
import type { Capability } from '../../src/types';

const buildCapability = (overrides?: Partial<Capability>): Capability => ({
  id: 'CAP-CONNECT',
  name: 'Connector Capability',
  description: 'Exercise connector-backed utility.',
  businessOutcome: '',
  successMetrics: [],
  requiredEvidenceKinds: [],
  applications: [],
  apis: [],
  databases: [],
  databaseConfigs: [],
  gitRepositories: ['https://github.com/openai/openai-openapi'],
  localDirectories: [],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    allowedWorkspacePaths: [],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: 'PENDING',
  skillLibrary: [],
  ...overrides,
});

describe('connectors', () => {
  it('summarizes linked systems even before live sync is configured', () => {
    const summary = summarizeCapabilityConnectorContext(
      buildCapability({
        jiraBoardLink: 'https://example.atlassian.net/browse/PROJ-42',
        confluenceLink: 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=12345',
      }),
      normalizeWorkspaceConnectorSettings(),
    );

    expect(summary.github.repositories[0]?.repo).toBe('openai-openapi');
    expect(summary.github.status).toBe('NEEDS_CONFIGURATION');
    expect(summary.jira.issues[0]?.key).toBe('PROJ-42');
    expect(summary.confluence.pages[0]?.pageId).toBe('12345');
  });

  it('marks GitHub ready when the workspace connector is enabled', () => {
    const summary = summarizeCapabilityConnectorContext(
      buildCapability(),
      normalizeWorkspaceConnectorSettings({
        github: {
          enabled: true,
        },
      }),
    );

    expect(summary.github.status).toBe('READY');
    expect(summary.github.message).toContain('enabled');
  });
});
