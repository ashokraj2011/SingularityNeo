import { describe, expect, it } from 'vitest';
import {
  createDefaultWorkspaceFoundationCatalog,
  summarizeWorkspaceFoundationCatalog,
  WORKSPACE_AGENT_TEMPLATES,
  WORKSPACE_EVAL_SUITE_TEMPLATES,
} from '../workspaceFoundations';

describe('workspace foundations', () => {
  it('builds the default shared workspace foundation catalog', () => {
    const catalog = createDefaultWorkspaceFoundationCatalog();

    expect(catalog.agentTemplates.length).toBe(WORKSPACE_AGENT_TEMPLATES.length);
    expect(catalog.agentTemplates.some(template => template.key === 'OWNER')).toBe(true);
    expect(catalog.workflowTemplates.length).toBeGreaterThan(0);
    expect(catalog.workflowTemplates[0]?.scope).toBe('GLOBAL');
    expect(catalog.evalSuiteTemplates.length).toBe(WORKSPACE_EVAL_SUITE_TEMPLATES.length);
    expect(catalog.skillTemplates.length).toBeGreaterThan(0);
    expect(catalog.artifactTemplates.length).toBeGreaterThan(0);
  });

  it('summarizes the shared workspace foundations for UI status', () => {
    const catalog = {
      ...createDefaultWorkspaceFoundationCatalog(),
      initializedAt: '2026-04-12T09:00:00.000Z',
    };

    expect(summarizeWorkspaceFoundationCatalog(catalog)).toEqual(
      expect.objectContaining({
        initialized: true,
        lastInitializedAt: '2026-04-12T09:00:00.000Z',
        agentTemplateCount: catalog.agentTemplates.length,
        workflowTemplateCount: catalog.workflowTemplates.length,
        evalSuiteTemplateCount: catalog.evalSuiteTemplates.length,
        skillTemplateCount: catalog.skillTemplates.length,
        artifactTemplateCount: catalog.artifactTemplates.length,
      }),
    );
  });
});
