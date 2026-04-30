/**
 * Agent Mind — aggregation service.
 *
 * Builds a complete AgentMindSnapshot from existing data stores: no new DB
 * tables, no schema migrations. Called by the GET .../agents/:id/mind route.
 */
import type {
  AgentKnowledgeLens,
  AgentLearningDriftState,
  AgentLearningStatus,
  AgentMindRule,
  AgentMindSnapshot,
  AgentWorldEntity,
  LearningUpdate,
} from '../src/types';
import { buildAgentKnowledgeLens } from '../src/lib/agentKnowledge';
import { getCapabilityBundle } from './repository';
import {
  getAgentLearningDriftState,
  getAgentLearningProfileVersionHistory,
} from './agentLearning/service';
import { listRecentPromptReceiptsForAgent } from './agentLearning/repository';
import { listMemoryDocuments } from './memory';

// ─── Rule derivation ──────────────────────────────────────────────────────────

const buildRules = (
  agent: {
    contract: {
      guardrails: string[];
      primaryResponsibilities: string[];
      workingApproach: string[];
    };
    learningNotes?: string[];
    learningProfile: { refreshedAt?: string };
    id: string;
  },
): AgentMindRule[] => {
  const rules: AgentMindRule[] = [];

  agent.contract.guardrails.forEach((text, i) => {
    if (!text.trim()) return;
    rules.push({
      id: `guardrail-${i}`,
      text: text.trim(),
      kind: 'GUARDRAIL',
      source: 'Operating Contract',
    });
  });

  agent.contract.primaryResponsibilities.forEach((text, i) => {
    if (!text.trim()) return;
    rules.push({
      id: `responsibility-${i}`,
      text: text.trim(),
      kind: 'RESPONSIBILITY',
      source: 'Operating Contract',
    });
  });

  agent.contract.workingApproach.forEach((text, i) => {
    if (!text.trim()) return;
    rules.push({
      id: `approach-${i}`,
      text: text.trim(),
      kind: 'APPROACH',
      source: 'Operating Contract',
    });
  });

  (agent.learningNotes || []).forEach((text, i) => {
    if (!text.trim()) return;
    rules.push({
      id: `learned-${i}`,
      text: text.trim(),
      kind: 'LEARNED',
      source: 'Learning Update',
      effectiveSince: agent.learningProfile.refreshedAt,
    });
  });

  return rules;
};

// ─── World entity derivation ──────────────────────────────────────────────────

const buildWorldEntities = (
  documents: Awaited<ReturnType<typeof listMemoryDocuments>>,
): AgentWorldEntity[] =>
  documents.map(doc => ({
    id: doc.id,
    kind: doc.sourceType,
    label: doc.title,
    summary: doc.contentPreview,
    freshness: doc.freshness,
    sourceDocumentId: doc.id,
    updatedAt: doc.updatedAt,
  }));

// ─── Profile status ───────────────────────────────────────────────────────────

const resolveProfileStatus = (
  status: string | undefined,
): AgentLearningStatus =>
  (status as AgentLearningStatus) || 'NOT_STARTED';

// ─── Main aggregation ─────────────────────────────────────────────────────────

export const getAgentMindSnapshot = async (
  capabilityId: string,
  agentId: string,
): Promise<AgentMindSnapshot> => {
  const bundle = await getCapabilityBundle(capabilityId);
  const agent = bundle.workspace.agents.find(a => a.id === agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} not found in capability ${capabilityId}.`);
  }

  // Run IO in parallel where possible
  const [driftState, versionHistory, documents, recentReceipts] =
    await Promise.all([
      getAgentLearningDriftState(capabilityId, agentId).catch(
        (): AgentLearningDriftState => ({
          canaryRequestCount: 0,
          canaryNegativeCount: 0,
          canaryNegativeRate: 0,
          regressionStreak: 0,
          isFlagged: false,
        }),
      ),
      getAgentLearningProfileVersionHistory(capabilityId, agentId, {
        limit: 10,
      }).catch(() => []),
      listMemoryDocuments(capabilityId).catch(() => []),
      listRecentPromptReceiptsForAgent(capabilityId, agentId, 10).catch(
        () => [],
      ),
    ]);

  const lens: AgentKnowledgeLens = buildAgentKnowledgeLens({
    capability: bundle.capability,
    workspace: bundle.workspace,
    agent,
  });

  const rules = buildRules(agent);
  const worldEntities = buildWorldEntities(documents);

  const learningTimeline: LearningUpdate[] = bundle.workspace.learningUpdates
    .filter(u => u.agentId === agentId)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, 30);

  return {
    agentId,
    capabilityId,
    generatedAt: new Date().toISOString(),
    lens,
    driftState,
    profileStatus: resolveProfileStatus(agent.learningProfile.status),
    rules,
    worldEntities,
    recentReceipts,
    learningTimeline,
    versionHistory,
  };
};
