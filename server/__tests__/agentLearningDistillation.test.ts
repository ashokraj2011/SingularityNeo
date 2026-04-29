// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCapabilityBundle } from '../repository';
import { queueAgentLearningJob } from '../agentLearning/repository';

vi.mock('../githubModels', () => ({
  requestGitHubModel: vi.fn(),
}));

vi.mock('../memory', () => ({
  getCapabilityMemoryCorpus: vi.fn(),
  listMemoryDocuments: vi.fn(),
  rankMemoryCorpusByQuery: vi.fn(),
  refreshCapabilityMemory: vi.fn(),
}));

vi.mock('../repository', () => ({
  addCapabilitySkillRecord: vi.fn(),
  getCapabilityBundle: vi.fn(),
  replaceCapabilityWorkspaceContentRecord: vi.fn(),
  updateCapabilityAgentRecord: vi.fn(),
}));

vi.mock('../execution/runtimeClient', () => ({
  executionRuntimeRpc: vi.fn(),
  isRemoteExecutionClient: () => false,
}));

vi.mock('../execution/repository', () => ({
  getWorkflowRunDetail: vi.fn(),
  listWorkflowRunEvents: vi.fn(),
}));

vi.mock('../agentLearning/repository', () => ({
  getAgentLearningProfile: vi.fn(),
  listAgentSessionSummaries: vi.fn(),
  listAgentsNeedingLearning: vi.fn(),
  queueAgentLearningJob: vi.fn(),
  updateAgentLearningJob: vi.fn(),
  upsertAgentLearningProfile: vi.fn(),
}));

import {
  __agentLearningTestUtils,
  queueCapabilityAgentLearningRefresh,
} from '../agentLearning/service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('agent learning experience distillation helpers', () => {
  it('round-trips experience distillation request reasons', () => {
    const reason = __agentLearningTestUtils.buildExperienceDistillationReason({
      outcome: 'FAILED',
      workItemId: 'WI-123',
      runId: 'RUN-987',
    });

    expect(reason).toBe('experience-distillation:FAILED:WI-123:RUN-987');
    expect(__agentLearningTestUtils.parseLearningReflectionRequest(reason)).toEqual({
      kind: 'EXPERIENCE_DISTILLATION',
      outcome: 'FAILED',
      workItemId: 'WI-123',
      runId: 'RUN-987',
    });
  });

  it('round-trips learning correction request reasons', () => {
    const reason = __agentLearningTestUtils.buildLearningCorrectionReason({
      workItemId: 'WI-321',
      runId: 'RUN-654',
    });

    expect(reason).toBe('learning-correction:WI-321:RUN-654');
    expect(__agentLearningTestUtils.parseLearningReflectionRequest(reason)).toEqual({
      kind: 'USER_CORRECTION',
      workItemId: 'WI-321',
      runId: 'RUN-654',
    });
  });

  it('appends generated skill sections once per marker', () => {
    const nextSection = [
      '<!-- distillation:RUN-1 -->',
      '## Rule Engine · Failed attempt · 2026-04-17',
      '',
      '- Prefer block replacements over whole-file rewrites.',
    ].join('\n');

    const first = __agentLearningTestUtils.appendGeneratedSkillSection({
      currentMarkdown: '# Experience Distillation',
      nextSection,
      marker: '<!-- distillation:RUN-1 -->',
    });
    const second = __agentLearningTestUtils.appendGeneratedSkillSection({
      currentMarkdown: first,
      nextSection,
      marker: '<!-- distillation:RUN-1 -->',
    });

    expect(first).toContain('Rule Engine · Failed attempt');
    expect(second).toBe(first);
  });

  it('merges unique strings in stable order', () => {
    expect(
      __agentLearningTestUtils.mergeUniqueStrings(
        ['Prefer patches', 'Prefer patches', 'Respect approved roots', ''],
        10,
      ),
    ).toEqual(['Prefer patches', 'Respect approved roots']);
  });

  it('queues only the owner agent for capability-wide refreshes', async () => {
    vi.mocked(getCapabilityBundle).mockResolvedValue({
      capability: { id: 'CAP-1' },
      workspace: {
        agents: [
          { id: 'AGENT-OWNER', name: 'Owner', role: 'Owner', isOwner: true },
          { id: 'AGENT-DEV', name: 'Developer', role: 'Developer' },
        ],
      },
    } as never);

    await queueCapabilityAgentLearningRefresh('CAP-1', 'capability-created');

    expect(queueAgentLearningJob).toHaveBeenCalledTimes(1);
    expect(queueAgentLearningJob).toHaveBeenCalledWith({
      capabilityId: 'CAP-1',
      agentId: 'AGENT-OWNER',
      requestReason: 'capability-created',
      makeStale: true,
    });
  });

  it('builds derived profiles with owner provenance and role focus', () => {
    const derived = __agentLearningTestUtils.buildDerivedAgentLearningProfile({
      ownerAgent: {
        id: 'AGENT-OWNER',
        name: 'Capability Owner',
        role: 'Owner',
      } as never,
      ownerProfile: {
        status: 'READY',
        summary: 'Shared capability knowledge.',
        highlights: ['Owner highlight'],
        contextBlock: 'Canonical context block.',
        sourceDocumentIds: ['DOC-1'],
        sourceArtifactIds: ['ART-1'],
        sourceCount: 2,
      },
      ownerVersionId: 'VER-1',
      agent: {
        id: 'AGENT-DEV',
        name: 'Delivery Engineer',
        role: 'Developer',
        skillIds: ['SKILL-1'],
        learningNotes: ['Prefer semantic hunks'],
        contract: {
          description: 'Implements code changes.',
          primaryResponsibilities: ['Ship the requested implementation'],
          workingApproach: [],
          preferredOutputs: [],
          guardrails: ['Do not invent file paths'],
          conflictResolution: [],
          suggestedInputArtifacts: [],
          expectedOutputArtifacts: [],
        },
      } as never,
      skills: [
        {
          id: 'SKILL-1',
          name: 'Code surgery',
        } as never,
      ],
      requestedAt: '2026-04-29T10:00:00.000Z',
    });

    expect(derived.derivationMode).toBe('OWNER_DERIVED');
    expect(derived.derivedFromAgentId).toBe('AGENT-OWNER');
    expect(derived.sourceVersionId).toBe('VER-1');
    expect(derived.sourceDocumentIds).toEqual(['DOC-1']);
    expect(derived.sourceArtifactIds).toEqual(['ART-1']);
    expect(derived.summary).toContain('Capability Owner');
    expect(derived.summary).toContain('Shared capability knowledge.');
    expect(derived.contextBlock).toContain('Canonical context block.');
    expect(derived.contextBlock).toContain('Implements code changes.');
  });
});
