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

import { queueAgentLearningJob } from '../agentLearning/repository';
import { queueIncidentDerivedLearningRefresh } from '../agentLearning/service';

const queueAgentLearningJobMock = vi.mocked(queueAgentLearningJob);

beforeEach(() => {
  vi.clearAllMocks();
  queueAgentLearningJobMock.mockResolvedValue(undefined as never);
});

describe('incident-derived learning loop', () => {
  it('queues an INCIDENT_DERIVED learning refresh with encoded incident metadata', async () => {
    await queueIncidentDerivedLearningRefresh({
      capabilityId: 'CAP-INC',
      agentId: 'AGENT-1',
      incident: {
        title: 'Trade gateway latency',
        severity: 'SEV1',
      },
      packetBundleId: 'EVD-123',
      workItemId: 'WI-1',
      runId: 'RUN-1',
    });

    expect(queueAgentLearningJobMock).toHaveBeenCalledWith({
      capabilityId: 'CAP-INC',
      agentId: 'AGENT-1',
      requestReason:
        'incident-derived:SEV1:Trade%20gateway%20latency:EVD-123:WI-1:RUN-1',
      makeStale: true,
    });
  });
});
