// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { __agentLearningTestUtils } from '../agentLearning/service';

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
});
