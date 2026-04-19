import { describe, expect, it } from 'vitest';
import { summarizeCapabilityWorkspaceForBootstrap } from '../workspaceBootstrap';
import type { Artifact, CapabilityWorkspace, WorkItem } from '../../types';

const makeArtifact = (id: string, created: string): Artifact => ({
  id,
  name: `Artifact ${id}`,
  capabilityId: 'CAP-1',
  type: 'DOC',
  version: '1',
  agent: 'AGENT-1',
  created,
  contentText: `content-${id}`.repeat(500),
  contentJson: { id, payload: 'x'.repeat(2000) },
});

const makeWorkItem = (id: string, timestamp: string): WorkItem => ({
  id,
  title: `Work ${id}`,
  description: 'desc',
  phase: 'CONSTRUCTION',
  capabilityId: 'CAP-1',
  workflowId: 'WF-1',
  status: 'ACTIVE',
  priority: 'High',
  tags: [],
  history: Array.from({ length: 12 }, (_, index) => ({
    phase: 'CONSTRUCTION',
    step: `Step ${index + 1}`,
    timestamp: `${timestamp}.${String(index).padStart(3, '0')}Z`,
    status: 'ACTIVE',
    note: `History ${index + 1}`,
  })),
});

describe('summarizeCapabilityWorkspaceForBootstrap', () => {
  it('drops heavy payloads and trims history-heavy workspace collections', () => {
    const workspace: CapabilityWorkspace = {
      capabilityId: 'CAP-1',
      briefing: {
        capabilityId: 'CAP-1',
        title: 'Capability',
        purpose: 'purpose',
        sections: [],
      },
      agents: [],
      workflows: [],
      artifacts: Array.from({ length: 40 }, (_, index) =>
        makeArtifact(`A-${index + 1}`, `2026-04-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
      ),
      tasks: Array.from({ length: 35 }, (_, index) => ({
        id: `TASK-${index + 1}`,
        title: 'Task',
        agent: 'AGENT-1',
        capabilityId: 'CAP-1',
        priority: 'High',
        status: 'ACTIVE',
        timestamp: `2026-04-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
      executionLogs: Array.from({ length: 35 }, (_, index) => ({
        id: `LOG-${index + 1}`,
        taskId: 'TASK-1',
        capabilityId: 'CAP-1',
        agentId: 'AGENT-1',
        timestamp: `2026-04-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        level: 'INFO',
        message: 'message',
        metadata: { noisy: 'x'.repeat(5000) },
      })),
      learningUpdates: Array.from({ length: 20 }, (_, index) => ({
        id: `LEARN-${index + 1}`,
        capabilityId: 'CAP-1',
        agentId: 'AGENT-1',
        sourceLogIds: [],
        insight: 'insight',
        timestamp: `2026-04-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
      workItems: Array.from({ length: 40 }, (_, index) =>
        makeWorkItem(`WI-${index + 1}`, `2026-04-${String(index + 1).padStart(2, '0')}T00:00:00`),
      ),
      messages: [
        {
          id: 'MSG-1',
          capabilityId: 'CAP-1',
          agentId: 'AGENT-1',
          role: 'assistant',
          content: 'hello',
          createdAt: '2026-04-01T00:00:00.000Z',
        },
      ],
      activeChatAgentId: 'AGENT-1',
      primaryCopilotAgentId: 'AGENT-1',
      interactionFeed: {
        generatedAt: '2026-04-01T00:00:00.000Z',
        entries: [],
      },
      createdAt: '2026-04-01T00:00:00.000Z',
    };

    const summarized = summarizeCapabilityWorkspaceForBootstrap(workspace);

    expect(summarized.messages).toEqual([]);
    expect(summarized.interactionFeed).toBeUndefined();
    expect(summarized.artifacts).toHaveLength(24);
    expect(summarized.tasks).toHaveLength(24);
    expect(summarized.executionLogs).toHaveLength(24);
    expect(summarized.learningUpdates).toHaveLength(16);
    expect(summarized.workItems).toHaveLength(32);
    expect(summarized.artifacts[0]?.contentText).toBeUndefined();
    expect(summarized.artifacts[0]?.contentJson).toBeUndefined();
    expect(summarized.executionLogs[0]?.metadata).toBeUndefined();
    expect(summarized.workItems[0]?.history).toHaveLength(8);
  });
});
