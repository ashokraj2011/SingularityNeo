// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../access', () => ({
  assertCapabilityPermission: vi.fn(),
}));

vi.mock('../db', () => ({
  query: vi.fn(),
}));

vi.mock('../repository', () => ({
  getCapabilityBundle: vi.fn(),
}));

vi.mock('../swarmRepository', () => ({
  createSwarmSession: vi.fn(),
  findOpenSwarmSessionForScope: vi.fn(),
  listRecentSwarmSessionsForWorkItem: vi.fn(),
  loadSwarmSessionDetail: vi.fn(),
  markSwarmSessionPromoted: vi.fn(),
  updateSwarmSessionStatus: vi.fn(),
}));

vi.mock('../execution/swarmOrchestrator', () => ({
  runSwarmDebate: vi.fn(),
  SWARM_VOTE_TOOL_META: { name: 'vote', schema: {} },
}));

vi.mock('../execution/service', () => ({
  createWorkItemRecord: vi.fn(),
}));

vi.mock('../eventBus', () => ({
  publishSwarmStreamEvent: vi.fn(),
  subscribeToSwarmStream: vi.fn(() => () => undefined),
}));

vi.mock('../requestActor', () => ({
  parseActorContext: vi.fn(),
}));

vi.mock('../swarmParticipants', () => ({
  buildAuthorizedParticipantDirectory: vi.fn(),
  resolveAuthorizedSwarmParticipants: vi.fn(),
}));

import { assertCapabilityPermission } from '../access';
import { getCapabilityBundle } from '../repository';
import {
  createSwarmSession,
  findOpenSwarmSessionForScope,
  loadSwarmSessionDetail,
  markSwarmSessionPromoted,
} from '../swarmRepository';
import { createWorkItemRecord } from '../execution/service';
import { parseActorContext } from '../requestActor';
import { resolveAuthorizedSwarmParticipants } from '../swarmParticipants';
import { registerSwarmChatRoutes } from '../routes/swarmChat';

const assertCapabilityPermissionMock = vi.mocked(assertCapabilityPermission);
const getCapabilityBundleMock = vi.mocked(getCapabilityBundle);
const createSwarmSessionMock = vi.mocked(createSwarmSession);
const findOpenSwarmSessionForScopeMock = vi.mocked(findOpenSwarmSessionForScope);
const loadSwarmSessionDetailMock = vi.mocked(loadSwarmSessionDetail);
const markSwarmSessionPromotedMock = vi.mocked(markSwarmSessionPromoted);
const createWorkItemRecordMock = vi.mocked(createWorkItemRecord);
const parseActorContextMock = vi.mocked(parseActorContext);
const resolveAuthorizedSwarmParticipantsMock = vi.mocked(
  resolveAuthorizedSwarmParticipants,
);

const buildApp = () => {
  const app = express();
  app.use(express.json());
  registerSwarmChatRoutes(app, {
    parseActor: (value, fallback) => String(value || fallback),
    writeSseEvent: () => undefined,
  });
  return app;
};

beforeEach(() => {
  vi.clearAllMocks();
  assertCapabilityPermissionMock.mockResolvedValue(undefined as never);
  parseActorContextMock.mockReturnValue({
    userId: 'USR-1',
    displayName: 'Workspace Operator',
    teamIds: [],
    workspaceRoles: [],
  } as any);
});

describe('swarmChat routes', () => {
  it('creates a real work item during promotion and returns it', async () => {
    loadSwarmSessionDetailMock.mockResolvedValue({
      session: {
        id: 'SWS-1',
        capabilityId: 'CAP-1',
        sessionScope: 'GENERAL_CHAT',
        status: 'APPROVED',
        initiatingPrompt: 'Debate the plan.',
        tokenBudgetUsed: 10,
        maxTokenBudget: 100,
        createdAt: '2026-04-24T10:00:00.000Z',
        updatedAt: '2026-04-24T10:00:00.000Z',
      },
      participants: [],
      transcript: [],
      producedArtifactId: 'ART-1',
    } as any);
    getCapabilityBundleMock.mockResolvedValue({
      capability: { id: 'CAP-1', name: 'Anchor Capability' },
      workspace: { workflows: [{ id: 'WF-1', name: 'Default Workflow' }] },
    } as any);
    createWorkItemRecordMock.mockResolvedValue({
      id: 'WI-123',
      capabilityId: 'CAP-1',
      title: 'Swarm-approved plan (SWS-1)',
    } as any);
    markSwarmSessionPromotedMock.mockResolvedValue({
      id: 'SWS-1',
      capabilityId: 'CAP-1',
    } as any);

    const response = await request(buildApp())
      .post('/api/capabilities/CAP-1/swarm-sessions/SWS-1/promote-to-work-item')
      .send({});

    expect(response.status).toBe(201);
    expect(createWorkItemRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'CAP-1',
        workflowId: 'WF-1',
        taskType: 'GENERAL',
        priority: 'Med',
        tags: [],
      }),
    );
    expect(markSwarmSessionPromotedMock).toHaveBeenCalledWith({
      capabilityId: 'CAP-1',
      sessionId: 'SWS-1',
      workItemId: 'WI-123',
    });
    expect(response.body).toMatchObject({
      workItem: {
        id: 'WI-123',
      },
      swarmSessionId: 'SWS-1',
      linkedArtifactId: 'ART-1',
    });
  });

  it('converts a duplicate open-session insert race into a 409', async () => {
    findOpenSwarmSessionForScopeMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'SWS-EXISTING',
      } as any);
    resolveAuthorizedSwarmParticipantsMock.mockResolvedValue([
      {
        capabilityId: 'CAP-1',
        agentId: 'AG-1',
        bucket: 'current',
        bundle: {
          capability: { id: 'CAP-1', name: 'Anchor' },
          workspace: { agents: [{ id: 'AG-1', name: 'Architect' }] },
        },
        agent: { id: 'AG-1', name: 'Architect' },
      },
      {
        capabilityId: 'CAP-1',
        agentId: 'AG-2',
        bucket: 'current',
        bundle: {
          capability: { id: 'CAP-1', name: 'Anchor' },
          workspace: { agents: [{ id: 'AG-2', name: 'Security' }] },
        },
        agent: { id: 'AG-2', name: 'Security' },
      },
    ] as any);
    createSwarmSessionMock.mockRejectedValue({ code: '23505' });

    const response = await request(buildApp())
      .post('/api/runtime/chat/swarm')
      .send({
        capabilityId: 'CAP-1',
        initiatingPrompt: 'Debate the blast radius.',
        participants: [
          { capabilityId: 'CAP-1', agentId: 'AG-1' },
          { capabilityId: 'CAP-1', agentId: 'AG-2' },
        ],
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: 'A swarm debate is already in progress for this scope.',
      sessionId: 'SWS-EXISTING',
    });
  });
});
