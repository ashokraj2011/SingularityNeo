import { describe, expect, it } from 'vitest';
import { buildCapabilityBriefing, buildCapabilityBriefingPrompt } from '../capabilityBriefing';
import { createDefaultCapabilityLifecycle } from '../capabilityLifecycle';
import type { Capability } from '../../types';

const capability = (): Capability => ({
  id: 'CAP-BRIEF',
  name: 'Payments',
  description: 'Run the payments capability as a visible delivery system.',
  domain: 'Fintech',
  businessUnit: 'Digital',
  ownerTeam: 'Payments Platform',
  businessOutcome: 'Ship safer payment changes with clear evidence and approvals.',
  successMetrics: ['Approval turnaround stays below one day.'],
  definitionOfDone: 'Every shipped change has evidence, approval, and handoff records.',
  requiredEvidenceKinds: ['Code diff', 'Test evidence'],
  operatingPolicySummary: 'High-impact payment changes require approval before release.',
  applications: ['Payments Portal'],
  apis: ['Ledger API'],
  databases: ['Payments DB'],
  gitRepositories: ['ssh://git.example.com/payments.git'],
  localDirectories: ['/workspace/payments'],
  teamNames: ['Payments Platform', 'Release Engineering'],
  stakeholders: [
    {
      role: 'Product Owner',
      name: 'Ava',
      teamName: 'Payments Platform',
      email: 'ava@example.com',
    },
  ],
  additionalMetadata: [{ key: 'Risk profile', value: 'Tier 1' }],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    defaultWorkspacePath: '/workspace/payments',
    allowedWorkspacePaths: ['/workspace/payments'],
    commandTemplates: [
      {
        id: 'build',
        label: 'Build',
        command: ['npm', 'run', 'build'],
      },
    ],
    deploymentTargets: [
      {
        id: 'staging',
        label: 'Staging',
        commandTemplateId: 'build',
        workspacePath: '/workspace/payments',
      },
    ],
  },
  status: 'STABLE',
  skillLibrary: [],
});

describe('buildCapabilityBriefing', () => {
  it('normalizes capability metadata into a reusable live briefing', () => {
    const briefing = buildCapabilityBriefing(capability());

    expect(briefing.title).toBe('Payments');
    expect(briefing.outcome).toContain('Ship safer payment changes');
    expect(briefing.ownerTeam).toBe('Payments Platform');
    expect(briefing.evidencePriorities).toEqual(['Code diff', 'Test evidence']);
    expect(briefing.activeConstraints).toContain(
      'Definition of done: Every shipped change has evidence, approval, and handoff records.',
    );
    expect(briefing.sections.map(section => section.id)).toEqual(
      expect.arrayContaining(['outcome', 'evidence', 'ownership', 'systems', 'runtime']),
    );
  });

  it('builds a prompt that can be reused across runtime surfaces', () => {
    const prompt = buildCapabilityBriefingPrompt(buildCapabilityBriefing(capability()));

    expect(prompt).toContain('Capability briefing for Payments:');
    expect(prompt).toContain('Purpose: Run the payments capability as a visible delivery system.');
    expect(prompt).toContain('Outcome: Ship safer payment changes with clear evidence and approvals.');
    expect(prompt).toContain('Outcome contract:');
    expect(prompt).toContain('Runtime and delivery:');
  });
});
