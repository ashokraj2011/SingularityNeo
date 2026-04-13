import { describe, expect, it } from 'vitest';
import {
  createWorkspaceFoundationCapability,
  createDefaultWorkspaceFoundationCatalog,
  isSystemFoundationCapability,
  materializeCapabilityStarterArtifacts,
  mergeCapabilitySkillLibrary,
  summarizeWorkspaceFoundationCatalog,
  WORKSPACE_AGENT_TEMPLATES,
  WORKSPACE_EVAL_SUITE_TEMPLATES,
} from '../workspaceFoundations';
import { getStandardAgentContract } from '../../constants';
import { createDefaultCapabilityLifecycle } from '../capabilityLifecycle';
import { getDefaultExecutionConfig } from '../executionConfig';
import type { Capability, CapabilityAgent, Skill } from '../../types';

const TEST_CAPABILITY: Capability = {
  id: 'CAP-TEST',
  name: 'Starter Capability',
  description: 'Capability used for workspace foundation tests.',
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  localDirectories: [],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: getDefaultExecutionConfig({ localDirectories: [] }),
  status: 'STABLE',
  successMetrics: [],
  requiredEvidenceKinds: [],
  skillLibrary: [],
};

describe('workspace foundations', () => {
  it('builds the default shared workspace foundation catalog', () => {
    const catalog = createDefaultWorkspaceFoundationCatalog();

    expect(catalog.agentTemplates.length).toBe(WORKSPACE_AGENT_TEMPLATES.length);
    expect(catalog.agentTemplates.some(template => template.key === 'OWNER')).toBe(true);
    expect(
      catalog.agentTemplates.find(template => template.key === 'SOFTWARE-DEVELOPER')
        ?.preferredToolIds,
    ).toContain('workspace_write');
    expect(catalog.workflowTemplates.length).toBeGreaterThan(0);
    expect(catalog.workflowTemplates[0]?.scope).toBe('GLOBAL');
    expect(catalog.evalSuiteTemplates.length).toBe(WORKSPACE_EVAL_SUITE_TEMPLATES.length);
    expect(catalog.skillTemplates.length).toBeGreaterThan(0);
    expect(catalog.artifactTemplates.length).toBeGreaterThan(0);
    expect(catalog.toolTemplates.length).toBeGreaterThan(0);
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
        toolTemplateCount: catalog.toolTemplates.length,
      }),
    );
  });

  it('materializes a locked system foundation capability from the workspace catalog', () => {
    const capability = createWorkspaceFoundationCapability();

    expect(capability.id).toBe('CAP-SYSTEM-FOUNDATION');
    expect(capability.isSystemCapability).toBe(true);
    expect(capability.systemCapabilityRole).toBe('FOUNDATION');
    expect(isSystemFoundationCapability(capability)).toBe(true);
    expect(capability.skillLibrary.length).toBeGreaterThan(0);
  });

  it('merges standard starter skills into a capability skill library', () => {
    const customSkill: Skill = {
      id: 'SKL-CUSTOM',
      name: 'Custom Capability Skill',
      description: 'Capability-specific specialization.',
      category: 'Analysis',
      version: '1.0.0',
    };

    const merged = mergeCapabilitySkillLibrary([customSkill]);

    expect(merged.some(skill => skill.id === customSkill.id)).toBe(true);
    expect(
      merged.some(skill => skill.id === 'SKL-GENERAL-REPO-INSTRUCTIONS'),
    ).toBe(true);
  });

  it('materializes starter artifacts from workspace foundations for a capability', () => {
    const agents: CapabilityAgent[] = [
      {
        id: 'AGENT-OWNER',
        capabilityId: TEST_CAPABILITY.id,
        name: 'Capability Owning Agent',
        role: 'Capability Owner',
        objective: 'Owns the capability.',
        systemPrompt: 'Own the capability.',
        contract: getStandardAgentContract('OWNER'),
        initializationStatus: 'READY',
        documentationSources: [],
        inputArtifacts: [],
        outputArtifacts: [],
        isOwner: true,
        skillIds: [],
        provider: 'GitHub Copilot SDK',
        model: 'gpt-4.1-mini',
        tokenLimit: 12000,
        usage: {
          requestCount: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        },
        previousOutputs: [],
        learningProfile: {
          status: 'NOT_STARTED',
          summary: '',
          highlights: [],
          contextBlock: '',
          sourceDocumentIds: [],
          sourceArtifactIds: [],
          sourceCount: 0,
        },
        sessionSummaries: [],
      },
    ];

    const artifacts = materializeCapabilityStarterArtifacts({
      capability: TEST_CAPABILITY,
      agents,
      createdAt: '2026-04-12T12:00:00.000Z',
    });

    expect(artifacts.length).toBeGreaterThan(0);
    expect(artifacts.some(artifact => artifact.documentationStatus === 'PENDING')).toBe(true);
    expect(artifacts.some(artifact => artifact.connectedAgentId === 'AGENT-OWNER')).toBe(true);
    expect(artifacts.every(artifact => artifact.capabilityId === TEST_CAPABILITY.id)).toBe(true);
  });
});
