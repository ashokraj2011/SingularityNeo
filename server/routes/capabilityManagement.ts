import type express from 'express';
import type {
  Capability,
  CapabilityAccessSnapshot,
  CapabilityAgent,
  CapabilityChatMessage,
  CapabilityRepository,
  CapabilityWorkspace,
  Skill,
} from '../../src/types';
import {
  buildCapabilityHierarchyNode,
  normalizeCapabilityKind,
} from '../../src/lib/capabilityArchitecture';
import { assertCapabilityPermission, assertWorkspacePermission, getAuthorizedAppState, getCapabilityAccessSnapshot, updateCapabilityAccessSnapshot } from '../access';
import { sendApiError } from '../api/errors';
import {
  addCapabilityAgentRecord,
  addCapabilitySkillRecord,
  appendCapabilityMessageRecord,
  clearCapabilityMessageHistoryRecord,
  createCapabilityRecord,
  getCapabilityAlmExportRecord,
  getCapabilityBundle,
  getCapabilityRepositoriesRecord,
  publishCapabilityContractRecord,
  removeCapabilitySkillRecord,
  replaceCapabilityWorkspaceContentRecord,
  setActiveChatAgentRecord,
  updateCapabilityAgentModelsRecord,
  updateCapabilityAgentRecord,
  updateCapabilityRecord,
  updateCapabilityRepositoriesRecord,
} from '../repository';
import { parseActorContext } from '../requestActor';
import { refreshCapabilityMemory } from '../memory';
import {
  queueCapabilityAgentLearningRefresh,
  queueSingleAgentLearningRefresh,
} from '../agentLearning/service';
import { wakeAgentLearningWorker } from '../agentLearning/worker';
import {
  getOperatingPolicySnapshots,
  revertOperatingPolicyToSnapshot,
} from '../agentLearning/repository';
import {
  readCapabilityCopilotGuidance,
  refreshCapabilityCopilotGuidance,
} from '../repoGuidance';
import { refreshCapabilityCodeIndex } from '../codeIndex/ingest';
import {
  readBlastRadiusSymbolGraph,
  readCodeIndexSnapshot,
  searchCodeSymbols,
} from '../codeIndex/query';
import { buildCodePatchPayload } from '../patch/validate';
import { estimateTokens } from '../execution/tokenEstimate';

type WorkspacePatchBody = Partial<
  Pick<
    CapabilityWorkspace,
    | 'workflows'
    | 'artifacts'
    | 'tasks'
    | 'executionLogs'
    | 'learningUpdates'
    | 'workItems'
    | 'activeChatAgentId'
  >
>;

type CapabilityManagementRouteDeps = {
  ensureCapabilityCreatePayload: (
    capability: Partial<Capability> | undefined,
  ) => Capability | null;
  ensureAgentCreatePayload: (
    capabilityId: string,
    agent: Partial<Omit<CapabilityAgent, 'capabilityId'>> | undefined,
  ) => CapabilityAgent | null;
  normalizeCapabilityRepositoriesPayload: (
    capabilityId: string,
    repositories: unknown,
  ) => CapabilityRepository[];
  resolveWritableAgentModel: (requestedModel?: string) => Promise<string>;
};

export const registerCapabilityManagementRoutes = (
  app: express.Express,
  {
    ensureAgentCreatePayload,
    ensureCapabilityCreatePayload,
    normalizeCapabilityRepositoriesPayload,
    resolveWritableAgentModel,
  }: CapabilityManagementRouteDeps,
) => {
  app.post('/api/capabilities', async (request, response) => {
    const capability = ensureCapabilityCreatePayload(
      request.body as Partial<Capability> | undefined,
    );
    if (!capability) {
      response.status(400).json({
        error: 'Capability name and description are required.',
      });
      return;
    }

    try {
      await assertWorkspacePermission({
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.create',
      });
      await createCapabilityRecord(capability);
      await queueCapabilityAgentLearningRefresh(capability.id, 'capability-created');
      wakeAgentLearningWorker();
      response.status(201).json(await getCapabilityBundle(capability.id));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/capabilities/:capabilityId', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.edit',
      });
      await updateCapabilityRecord(
        request.params.capabilityId,
        request.body as Partial<Capability>,
      );
      await refreshCapabilityMemory(request.params.capabilityId, {
        requeueAgents: true,
        requestReason: 'capability-updated',
      }).catch(() => undefined);
      await queueCapabilityAgentLearningRefresh(
        request.params.capabilityId,
        'capability-updated',
      );
      wakeAgentLearningWorker();
      response.json(await getCapabilityBundle(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/architecture', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'capability.read.rollup',
      });
      const state = await getAuthorizedAppState(actor);
      const capability = state.capabilities.find(item => item.id === request.params.capabilityId);
      if (!capability) {
        response.status(404).json({ error: 'Capability was not found.' });
        return;
      }

      const relatedCapabilities = state.capabilities.filter(item => {
        if (item.id === capability.id) {
          return true;
        }
        if (item.parentCapabilityId === capability.id) {
          return true;
        }
        if (capability.parentCapabilityId && item.id === capability.parentCapabilityId) {
          return true;
        }
        if ((capability.dependencies || []).some(dep => dep.targetCapabilityId === item.id)) {
          return true;
        }
        if ((item.dependencies || []).some(dep => dep.targetCapabilityId === capability.id)) {
          return true;
        }
        return false;
      });

      response.json({
        capability,
        hierarchy:
          capability.hierarchyNode ||
          buildCapabilityHierarchyNode(capability, state.capabilities),
        rollupSummary: capability.rollupSummary,
        relatedCapabilities,
      });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/publish-contract', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Capability Owner');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'contract.publish',
      });
      const result = await publishCapabilityContractRecord({
        capabilityId: request.params.capabilityId,
        publishedBy: actor.displayName,
      });
      await refreshCapabilityMemory(request.params.capabilityId, {
        requeueAgents: true,
        requestReason: 'capability-contract-published',
      }).catch(() => undefined);
      response.status(201).json(result);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/alm-export', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read.rollup',
      });
      response.json(await getCapabilityAlmExportRecord(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/access', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'capability.read',
      });
      response.json(await getCapabilityAccessSnapshot(request.params.capabilityId, actor));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/capabilities/:capabilityId/access', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertWorkspacePermission({ actor, action: 'access.manage' });
      response.json(
        await updateCapabilityAccessSnapshot({
          capabilityId: request.params.capabilityId,
          updates: request.body as Partial<CapabilityAccessSnapshot>,
          actor,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/repositories', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      response.json(await getCapabilityRepositoriesRecord(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/capabilities/:capabilityId/repositories', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.edit',
      });
      const repositories = normalizeCapabilityRepositoriesPayload(
        request.params.capabilityId,
        request.body?.repositories,
      );
      response.json(
        await updateCapabilityRepositoriesRecord(request.params.capabilityId, repositories),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/copilot-guidance', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      response.json(await readCapabilityCopilotGuidance(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/copilot-guidance/refresh', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'capability.edit',
      });
      void actor;
      const pack = await refreshCapabilityCopilotGuidance(request.params.capabilityId);
      response.json(pack);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/code-index', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      response.json(await readCodeIndexSnapshot(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/code-index/refresh', async (request, response) => {
    try {
      const actor = parseActorContext(request, 'Workspace Operator');
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor,
        action: 'capability.edit',
      });
      void actor;
      const snapshot = await refreshCapabilityCodeIndex(request.params.capabilityId);
      response.json(snapshot);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/code-index/symbols', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      const q = String(request.query?.q || '').trim();
      const limitRaw = Number.parseInt(String(request.query?.limit || ''), 10);
      const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
      const kindRaw = String(request.query?.kind || '').trim();
      const kind = kindRaw ? (kindRaw as any) : undefined;
      if (!q) {
        response.json([]);
        return;
      }
      response.json(
        await searchCodeSymbols(request.params.capabilityId, q, { limit, kind }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/code-index/blast-radius', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      const filePath = String(request.query?.filePath || '').trim();
      const symbolId = String(request.query?.symbolId || '').trim();
      const maxDepthRaw = Number.parseInt(String(request.query?.maxDepth || ''), 10);
      const maxDepth = Number.isFinite(maxDepthRaw) ? maxDepthRaw : undefined;
      const maxNodesRaw = Number.parseInt(String(request.query?.maxNodes || ''), 10);
      const maxNodes = Number.isFinite(maxNodesRaw) ? maxNodesRaw : undefined;
      if (!filePath && !symbolId) {
        response.status(400).json({
          error: 'filePath or symbolId query parameter is required.',
        });
        return;
      }
      response.json(
        await readBlastRadiusSymbolGraph(request.params.capabilityId, {
          filePath,
          symbolId,
          maxDepth,
          maxNodes,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/patches/validate', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      const body = (request.body || {}) as {
        raw?: string;
        repositoryId?: string;
        repositoryLabel?: string;
        baseSha?: string;
        targetBranch?: string;
        summary?: string;
      };
      const payload = buildCodePatchPayload(String(body.raw || ''), {
        repositoryId: body.repositoryId,
        repositoryLabel: body.repositoryLabel,
        baseSha: body.baseSha,
        targetBranch: body.targetBranch,
        summary: body.summary,
      });
      response.json(payload);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.get('/api/capabilities/:capabilityId/policy-history', async (request, response) => {
    try {
      const capabilityId = request.params.capabilityId;
      await assertCapabilityPermission({
        capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.read',
      });
      const snapshots = await getOperatingPolicySnapshots(capabilityId);
      response.json(snapshots);
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/revert-policy/:snapshotId', async (request, response) => {
    try {
      const capabilityId = request.params.capabilityId;
      const snapshotId = request.params.snapshotId;
      await assertCapabilityPermission({
        capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.edit',
      });
      const newSummary = await revertOperatingPolicyToSnapshot(capabilityId, snapshotId);
      response.json({ success: true, operatingPolicySummary: newSummary });
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/skills', async (request, response) => {
    const skill = request.body as Skill | undefined;
    if (!skill?.id || !skill?.name || !skill?.description) {
      response.status(400).json({
        error: 'Skill id, name, and description are required.',
      });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.edit',
      });
      await addCapabilitySkillRecord(request.params.capabilityId, {
        ...skill,
        contentMarkdown:
          skill.contentMarkdown?.trim() || `# ${skill.name}\n\n${skill.description}`,
        kind: skill.kind || 'CUSTOM',
        origin: skill.origin || 'CAPABILITY',
        defaultTemplateKeys: skill.defaultTemplateKeys || [],
      });
      await queueCapabilityAgentLearningRefresh(
        request.params.capabilityId,
        'capability-skill-added',
      );
      wakeAgentLearningWorker();
      response.status(201).json(await getCapabilityBundle(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete('/api/capabilities/:capabilityId/skills/:skillId', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.edit',
      });
      await removeCapabilitySkillRecord(
        request.params.capabilityId,
        request.params.skillId,
      );
      await queueCapabilityAgentLearningRefresh(
        request.params.capabilityId,
        'capability-skill-removed',
      );
      wakeAgentLearningWorker();
      response.json(await getCapabilityBundle(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/agents', async (request, response) => {
    const agent = ensureAgentCreatePayload(
      request.params.capabilityId,
      request.body as Partial<Omit<CapabilityAgent, 'capabilityId'>> | undefined,
    );
    if (!agent) {
      response.status(400).json({
        error: 'Agent name, role, and objective are required.',
      });
      return;
    }

    if (agent.contract && Object.keys(agent.contract).length > 0) {
      const tokenCount = estimateTokens(JSON.stringify(agent.contract), { provider: 'openai', kind: 'json' });
      if (tokenCount > 4000) {
        response.status(400).json({
          error: `The Operations Contract is too large (${tokenCount.toLocaleString()} tokens). The maximum allowed size is 4,000 tokens context ceiling limit.`,
        });
        return;
      }
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'agents.manage',
      });
      agent.model = await resolveWritableAgentModel(agent.model);
      await addCapabilityAgentRecord(request.params.capabilityId, agent);
      await queueSingleAgentLearningRefresh(
        request.params.capabilityId,
        agent.id,
        'agent-created',
      );
      wakeAgentLearningWorker();
      response.status(201).json(await getCapabilityBundle(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/capabilities/:capabilityId/agents/bulk-model', async (request, response) => {
    const requestedModel = String(request.body?.model || '').trim();
    if (!requestedModel) {
      response.status(400).json({
        error: 'Target model is required for bulk agent updates.',
      });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'agents.manage',
      });
      const resolvedModel = await resolveWritableAgentModel(requestedModel);
      response.json(
        await updateCapabilityAgentModelsRecord(
          request.params.capabilityId,
          resolvedModel,
        ),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/capabilities/:capabilityId/agents/:agentId', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'agents.manage',
      });
      const updates = request.body as Partial<CapabilityAgent>;
      if (updates.model) {
        updates.model = await resolveWritableAgentModel(updates.model);
      }

      if (updates.contract && Object.keys(updates.contract).length > 0) {
        const tokenCount = estimateTokens(JSON.stringify(updates.contract), { provider: 'openai', kind: 'json' });
        if (tokenCount > 4000) {
          response.status(400).json({
            error: `The Operations Contract is too large (${tokenCount.toLocaleString()} tokens). The maximum allowed size is 4,000 tokens context ceiling limit.`,
          });
          return;
        }
      }

      await updateCapabilityAgentRecord(
        request.params.capabilityId,
        request.params.agentId,
        updates,
      );
      await queueSingleAgentLearningRefresh(
        request.params.capabilityId,
        request.params.agentId,
        'agent-updated',
      );
      wakeAgentLearningWorker();
      response.json(await getCapabilityBundle(request.params.capabilityId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.post('/api/capabilities/:capabilityId/messages', async (request, response) => {
    const message = request.body as Omit<CapabilityChatMessage, 'capabilityId'> | undefined;
    if (!message?.id || !message?.content || !message?.role || !message?.timestamp) {
      response.status(400).json({
        error: 'Message id, role, content, and timestamp are required.',
      });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'chat.write',
      });
      response.status(201).json(
        await appendCapabilityMessageRecord(request.params.capabilityId, message),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/capabilities/:capabilityId/chat-agent', async (request, response) => {
    const agentId = String(request.body?.agentId || '').trim();
    if (!agentId) {
      response.status(400).json({ error: 'An agentId is required.' });
      return;
    }

    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'chat.read',
      });
      response.json(await setActiveChatAgentRecord(request.params.capabilityId, agentId));
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.delete('/api/capabilities/:capabilityId/messages', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'chat.write',
      });
      response.json(
        await clearCapabilityMessageHistoryRecord(request.params.capabilityId, {
          workItemId:
            typeof request.body?.workItemId === 'string'
              ? request.body.workItemId
              : undefined,
          sessionScope:
            request.body?.sessionScope === 'GENERAL_CHAT' ||
            request.body?.sessionScope === 'WORK_ITEM' ||
            request.body?.sessionScope === 'TASK'
              ? request.body.sessionScope
              : undefined,
          sessionScopeId:
            typeof request.body?.sessionScopeId === 'string'
              ? request.body.sessionScopeId
              : undefined,
        }),
      );
    } catch (error) {
      sendApiError(response, error);
    }
  });

  app.patch('/api/capabilities/:capabilityId/workspace', async (request, response) => {
    try {
      await assertCapabilityPermission({
        capabilityId: request.params.capabilityId,
        actor: parseActorContext(request, 'Workspace Operator'),
        action: 'capability.edit',
      });
      const capability = (await getCapabilityBundle(request.params.capabilityId)).capability;
      if (
        normalizeCapabilityKind(capability.capabilityKind, capability.collectionKind) ===
          'COLLECTION' &&
        (request.body?.workflows ||
          request.body?.workItems ||
          request.body?.tasks ||
          request.body?.executionLogs)
      ) {
        throw new Error(
          `${capability.name} is a collection capability and cannot persist execution workspace content.`,
        );
      }

      const workspace = await replaceCapabilityWorkspaceContentRecord(
        request.params.capabilityId,
        request.body as WorkspacePatchBody,
      );
      if (
        request.body?.artifacts ||
        request.body?.workItems ||
        request.body?.workflows ||
        request.body?.learningUpdates
      ) {
        await refreshCapabilityMemory(request.params.capabilityId, {
          requeueAgents: true,
          requestReason: 'workspace-content-updated',
        }).catch(() => undefined);
        wakeAgentLearningWorker();
      }
      response.json(workspace);
    } catch (error) {
      sendApiError(response, error);
    }
  });
};
