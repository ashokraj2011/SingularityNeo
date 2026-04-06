import type {
  Capability,
  PolicyActionType,
  PolicyDecision,
  PolicyDecisionResult,
  ToolAdapterId,
} from '../src/types';
import { query } from './db';

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const decisionFromRow = (row: Record<string, any>): PolicyDecision => ({
  id: row.id,
  capabilityId: row.capability_id,
  traceId: row.trace_id || undefined,
  runId: row.run_id || undefined,
  runStepId: row.run_step_id || undefined,
  toolInvocationId: row.tool_invocation_id || undefined,
  actionType: row.action_type,
  targetId: row.target_id || undefined,
  decision: row.decision,
  reason: row.reason,
  requestedByAgentId: row.requested_by_agent_id || undefined,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
});

const HIGH_IMPACT_TOOLS = new Set<ToolAdapterId>(['workspace_write', 'run_deploy']);

export const createPolicyDecision = async (
  decision: Omit<PolicyDecision, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
) => {
  const result = await query(
    `
      INSERT INTO capability_policy_decisions (
        capability_id,
        id,
        trace_id,
        run_id,
        run_step_id,
        tool_invocation_id,
        action_type,
        target_id,
        decision,
        reason,
        requested_by_agent_id,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `,
    [
      decision.capabilityId,
      decision.id || createId('POLICY'),
      decision.traceId || null,
      decision.runId || null,
      decision.runStepId || null,
      decision.toolInvocationId || null,
      decision.actionType,
      decision.targetId || null,
      decision.decision,
      decision.reason,
      decision.requestedByAgentId || null,
      decision.createdAt || new Date().toISOString(),
    ],
  );

  return decisionFromRow(result.rows[0]);
};

export const listPolicyDecisions = async (
  capabilityId: string,
  limit = 40,
) => {
  const result = await query(
    `
      SELECT *
      FROM capability_policy_decisions
      WHERE capability_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `,
    [capabilityId, limit],
  );

  return result.rows.map(decisionFromRow);
};

export const evaluateToolPolicy = async ({
  capability,
  traceId,
  toolId,
  requestedByAgentId,
  runId,
  runStepId,
  targetId,
  hasApprovalBypass = false,
}: {
  capability: Capability;
  traceId?: string;
  toolId: ToolAdapterId;
  requestedByAgentId?: string;
  runId?: string;
  runStepId?: string;
  targetId?: string;
  hasApprovalBypass?: boolean;
}) => {
  let actionType: PolicyActionType =
    toolId === 'workspace_write' || toolId === 'run_build' || toolId === 'run_test' || toolId === 'run_docs' || toolId === 'run_deploy'
      ? toolId
      : 'custom';
  let decision: PolicyDecisionResult = 'ALLOW';
  let reason = `${toolId} is allowed under the current execution policy.`;

  if (toolId === 'run_deploy') {
    decision = hasApprovalBypass ? 'ALLOW' : 'REQUIRE_APPROVAL';
    reason = hasApprovalBypass
      ? 'Deployment approval has been satisfied for this run.'
      : 'Deployment commands are always human-approved in this environment.';
  } else if (toolId === 'workspace_write') {
    decision = hasApprovalBypass ? 'ALLOW' : 'REQUIRE_APPROVAL';
    reason = hasApprovalBypass
      ? 'Workspace mutation is allowed after explicit human approval.'
      : 'Workspace writes require explicit human approval before execution.';
  } else if (HIGH_IMPACT_TOOLS.has(toolId)) {
    decision = 'REQUIRE_APPROVAL';
    reason = `${toolId} is treated as a high-impact action and requires approval.`;
  }

  return createPolicyDecision({
    capabilityId: capability.id,
    traceId,
    runId,
    runStepId,
    requestedByAgentId,
    actionType,
    targetId,
    decision,
    reason,
  });
};

export const evaluateBranchPolicy = async ({
  capability,
  traceId,
  requestedByAgentId,
  targetId,
}: {
  capability: Capability;
  traceId?: string;
  requestedByAgentId?: string;
  targetId?: string;
}) =>
  createPolicyDecision({
    capabilityId: capability.id,
    traceId,
    requestedByAgentId,
    actionType: 'git_branch',
    targetId,
    decision: 'REQUIRE_APPROVAL',
    reason:
      'Creating branches is a high-impact repository mutation and requires human approval in the enterprise policy engine.',
  });
