/**
 * Swarm Repository
 *
 * Persistence helpers for the Cross-Capability Swarm Debate feature.
 *
 * Kept separate from `server/repository.ts` because the swarm feature is
 * additive — none of the existing workspace/capability read paths care about
 * swarm rows, so bundling these helpers alongside the unrelated code would
 * just bloat an already large file. Everything here talks to:
 *
 *   - capability_swarm_sessions
 *   - capability_swarm_session_participants
 *   - capability_messages (swarm_session_id / swarm_turn_type / source_capability_id)
 *   - capability_artifacts (swarm_session_id)
 *
 * All IDs are generated here. Row shapes are hydrated into the typed
 * `SwarmSession*` shapes declared in `src/types.ts` so the server/client
 * contract is the single source of truth.
 */
import { query, transaction } from './db';
import type { PoolClient } from 'pg';
import type {
  ArtifactKind,
  CapabilityChatMessage,
  DisagreementSummaryArtifactPayload,
  ExecutionPlanArtifactPayload,
  SwarmParticipant,
  SwarmParticipantRole,
  SwarmSessionDetail,
  SwarmSessionScope,
  SwarmSessionStatus,
  SwarmSessionSummary,
  SwarmTerminalReason,
  SwarmTurnType,
  SwarmVote,
} from '../src/types';

type SwarmSessionRow = {
  capability_id: string;
  id: string;
  work_item_id: string | null;
  session_scope: string;
  initiator_user_id: string | null;
  status: string;
  lead_participant_id: string | null;
  promoted_work_item_id: string | null;
  initiating_prompt: string;
  token_budget_used: number | string;
  max_token_budget: number | string;
  terminal_reason: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
};

type SwarmParticipantRow = {
  capability_id: string;
  session_id: string;
  id: string;
  participant_capability_id: string;
  participant_agent_id: string;
  participant_role: string;
  tag_order: number | string;
  last_vote: string | null;
  vote_rationale: string | null;
  created_at: string | Date;
};

const toIso = (value: string | Date | null | undefined): string | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
};

const toNumber = (value: number | string | null | undefined): number => {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hydrateSession = (row: SwarmSessionRow): SwarmSessionSummary => ({
  id: row.id,
  capabilityId: row.capability_id,
  workItemId: row.work_item_id || undefined,
  sessionScope: row.session_scope as SwarmSessionScope,
  initiatorUserId: row.initiator_user_id || undefined,
  status: row.status as SwarmSessionStatus,
  leadParticipantId: row.lead_participant_id || undefined,
  promotedWorkItemId: row.promoted_work_item_id || undefined,
  initiatingPrompt: row.initiating_prompt,
  tokenBudgetUsed: toNumber(row.token_budget_used),
  maxTokenBudget: toNumber(row.max_token_budget),
  terminalReason: (row.terminal_reason as SwarmTerminalReason | null) || undefined,
  createdAt: toIso(row.created_at) || new Date().toISOString(),
  updatedAt: toIso(row.updated_at) || new Date().toISOString(),
  completedAt: toIso(row.completed_at),
});

const hydrateParticipant = (row: SwarmParticipantRow): SwarmParticipant => ({
  id: row.id,
  capabilityId: row.capability_id,
  sessionId: row.session_id,
  participantCapabilityId: row.participant_capability_id,
  participantAgentId: row.participant_agent_id,
  participantRole: row.participant_role as SwarmParticipantRole,
  tagOrder: toNumber(row.tag_order),
  lastVote: (row.last_vote as SwarmVote | null) || undefined,
  voteRationale: row.vote_rationale || undefined,
  createdAt: toIso(row.created_at) || new Date().toISOString(),
});

const randomSuffix = () => Math.random().toString(36).slice(2, 8);

export const makeSwarmSessionId = () =>
  `swm-${Date.now().toString(36)}-${randomSuffix()}`;

export const makeSwarmParticipantId = () =>
  `swp-${Date.now().toString(36)}-${randomSuffix()}`;

export interface CreateSwarmSessionInput {
  id?: string;
  capabilityId: string;
  workItemId?: string;
  sessionScope: SwarmSessionScope;
  initiatorUserId?: string;
  initiatingPrompt: string;
  maxTokenBudget: number;
  participants: Array<{
    id?: string;
    participantCapabilityId: string;
    participantAgentId: string;
    participantRole: SwarmParticipantRole;
    tagOrder: number;
  }>;
}

/**
 * Atomically insert a new swarm session plus its participant roster, and
 * resolve the lead participant id (if any participant is flagged LEAD) within
 * the same transaction. Returns the fully hydrated detail envelope.
 *
 * Concurrency guard: callers should run the 409 check (see
 * `findOpenSwarmSessionForWorkItem`) before calling this. We don't enforce it
 * here because at runtime the guard is a cheap partial-index lookup and
 * layering it inside the transaction would couple the route contract to this
 * helper.
 */
export const createSwarmSession = async (
  input: CreateSwarmSessionInput,
): Promise<SwarmSessionDetail> =>
  transaction(async client => {
    const sessionId = input.id || makeSwarmSessionId();
    const now = new Date().toISOString();

    const participantsWithIds = input.participants.map(participant => ({
      id: participant.id || makeSwarmParticipantId(),
      ...participant,
    }));

    const leadRow = participantsWithIds.find(p => p.participantRole === 'LEAD');

    await client.query(
      `
        INSERT INTO capability_swarm_sessions (
          capability_id, id, work_item_id, session_scope, initiator_user_id,
          status, lead_participant_id, promoted_work_item_id, initiating_prompt,
          token_budget_used, max_token_budget, terminal_reason,
          created_at, updated_at, completed_at
        )
        VALUES ($1,$2,$3,$4,$5,'PENDING',$6,NULL,$7,0,$8,NULL,$9,$9,NULL)
      `,
      [
        input.capabilityId,
        sessionId,
        input.workItemId || null,
        input.sessionScope,
        input.initiatorUserId || null,
        leadRow?.id || null,
        input.initiatingPrompt,
        input.maxTokenBudget,
        now,
      ],
    );

    for (const participant of participantsWithIds) {
      await client.query(
        `
          INSERT INTO capability_swarm_session_participants (
            capability_id, session_id, id,
            participant_capability_id, participant_agent_id,
            participant_role, tag_order, last_vote, vote_rationale, created_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8)
        `,
        [
          input.capabilityId,
          sessionId,
          participant.id,
          participant.participantCapabilityId,
          participant.participantAgentId,
          participant.participantRole,
          participant.tagOrder,
          now,
        ],
      );
    }

    return loadSwarmSessionDetailTx(client, input.capabilityId, sessionId);
  });

/**
 * In-transaction loader. Exposed so the orchestrator can read a session after
 * mutating rows without paying for two round-trips.
 */
export const loadSwarmSessionDetailTx = async (
  client: PoolClient,
  capabilityId: string,
  sessionId: string,
): Promise<SwarmSessionDetail> => {
  const sessionResult = await client.query<SwarmSessionRow>(
    `SELECT * FROM capability_swarm_sessions WHERE capability_id = $1 AND id = $2`,
    [capabilityId, sessionId],
  );
  if (sessionResult.rowCount === 0) {
    throw new Error(`Swarm session ${sessionId} not found for capability ${capabilityId}.`);
  }

  const participantsResult = await client.query<SwarmParticipantRow>(
    `
      SELECT * FROM capability_swarm_session_participants
      WHERE capability_id = $1 AND session_id = $2
      ORDER BY tag_order ASC, created_at ASC
    `,
    [capabilityId, sessionId],
  );

  const transcriptResult = await client.query(
    `
      SELECT id, capability_id, role, content, timestamp,
             agent_id, agent_name, trace_id, model,
             session_id, session_scope, session_scope_id,
             work_item_id, run_id, workflow_step_id,
             swarm_session_id, swarm_turn_type, source_capability_id
      FROM capability_messages
      WHERE capability_id = $1 AND swarm_session_id = $2
      ORDER BY timestamp ASC
    `,
    [capabilityId, sessionId],
  );

  const transcript: CapabilityChatMessage[] = transcriptResult.rows.map((row: any) => ({
    id: row.id,
    capabilityId: row.capability_id,
    role: row.role,
    content: row.content,
    timestamp: toIso(row.timestamp) || new Date().toISOString(),
    agentId: row.agent_id || undefined,
    agentName: row.agent_name || undefined,
    traceId: row.trace_id || undefined,
    model: row.model || undefined,
    sessionId: row.session_id || undefined,
    sessionScope: row.session_scope || undefined,
    sessionScopeId: row.session_scope_id || undefined,
    workItemId: row.work_item_id || undefined,
    runId: row.run_id || undefined,
    workflowStepId: row.workflow_step_id || undefined,
    swarmSessionId: row.swarm_session_id || undefined,
    swarmTurnType: (row.swarm_turn_type as SwarmTurnType | null) || undefined,
    sourceCapabilityId: row.source_capability_id || undefined,
  }));

  const artifactResult = await client.query<{ id: string }>(
    `
      SELECT id FROM capability_artifacts
      WHERE capability_id = $1 AND swarm_session_id = $2
      ORDER BY created DESC LIMIT 1
    `,
    [capabilityId, sessionId],
  );

  return {
    session: hydrateSession(sessionResult.rows[0]),
    participants: participantsResult.rows.map(hydrateParticipant),
    transcript,
    producedArtifactId: artifactResult.rows[0]?.id,
  };
};

export const loadSwarmSessionDetail = async (
  capabilityId: string,
  sessionId: string,
): Promise<SwarmSessionDetail> =>
  transaction(client => loadSwarmSessionDetailTx(client, capabilityId, sessionId));

/**
 * Concurrency helper backed by the open-session partial unique index.
 * Returns the open session (if any) targeting the same
 * `{capability, session_scope, work_item/null-bucket}` slot.
 */
export const findOpenSwarmSessionForScope = async (
  capabilityId: string,
  sessionScope: SwarmSessionScope,
  workItemId: string | null,
): Promise<SwarmSessionSummary | null> => {
  const result = await query<SwarmSessionRow>(
    `
      SELECT * FROM capability_swarm_sessions
      WHERE capability_id = $1
        AND session_scope = $2
        AND COALESCE(work_item_id, '__none__') = COALESCE($3, '__none__')
        AND status IN ('PENDING','RUNNING','AWAITING_REVIEW')
      LIMIT 1
    `,
    [capabilityId, sessionScope, workItemId],
  );
  const row = result.rows[0];
  return row ? hydrateSession(row) : null;
};

export const listRecentSwarmSessionsForWorkItem = async (
  capabilityId: string,
  workItemId: string,
  limit = 20,
): Promise<SwarmSessionSummary[]> => {
  const result = await query<SwarmSessionRow>(
    `
      SELECT * FROM capability_swarm_sessions
      WHERE capability_id = $1 AND work_item_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [capabilityId, workItemId, limit],
  );
  return result.rows.map(hydrateSession);
};

export const updateSwarmSessionStatus = async (args: {
  capabilityId: string;
  sessionId: string;
  status: SwarmSessionStatus;
  terminalReason?: SwarmTerminalReason;
  completed?: boolean;
}): Promise<void> => {
  const completed = args.completed
    ? new Date().toISOString()
    : null;
  await query(
    `
      UPDATE capability_swarm_sessions
      SET status = $3,
          terminal_reason = COALESCE($4, terminal_reason),
          completed_at = COALESCE(completed_at, $5),
          updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
    `,
    [
      args.capabilityId,
      args.sessionId,
      args.status,
      args.terminalReason || null,
      completed,
    ],
  );
};

export const incrementSwarmTokenBudget = async (args: {
  capabilityId: string;
  sessionId: string;
  tokensAdded: number;
}): Promise<SwarmSessionSummary> => {
  const result = await query<SwarmSessionRow>(
    `
      UPDATE capability_swarm_sessions
      SET token_budget_used = token_budget_used + $3,
          updated_at = NOW()
      WHERE capability_id = $1 AND id = $2
      RETURNING *
    `,
    [args.capabilityId, args.sessionId, Math.max(0, Math.round(args.tokensAdded))],
  );
  if (result.rowCount === 0) {
    throw new Error(`Swarm session ${args.sessionId} not found.`);
  }
  return hydrateSession(result.rows[0]);
};

export const recordSwarmParticipantVote = async (args: {
  capabilityId: string;
  sessionId: string;
  participantId: string;
  vote: SwarmVote;
  rationale: string;
}): Promise<void> => {
  await query(
    `
      UPDATE capability_swarm_session_participants
      SET last_vote = $4, vote_rationale = $5
      WHERE capability_id = $1 AND session_id = $2 AND id = $3
    `,
    [
      args.capabilityId,
      args.sessionId,
      args.participantId,
      args.vote,
      args.rationale,
    ],
  );
};

/**
 * Append a single swarm-tagged message to `capability_messages`. Row `role`
 * stays `'agent'` (keeps legacy readers happy) and the turn kind is carried
 * by the new `swarm_turn_type` column.
 */
export const appendSwarmTranscriptTurn = async (args: {
  capabilityId: string;
  sessionId: string;
  turnType: SwarmTurnType;
  sessionScope: SwarmSessionScope;
  sessionScopeId?: string;
  sourceCapabilityId: string;
  agentId: string;
  agentName?: string;
  content: string;
  model?: string;
  traceId?: string;
  workItemId?: string;
}): Promise<CapabilityChatMessage> => {
  const id = `swt-${Date.now().toString(36)}-${randomSuffix()}`;
  const timestamp = new Date().toISOString();

  await query(
    `
      INSERT INTO capability_messages (
        capability_id, id, role, content, timestamp,
        agent_id, agent_name, trace_id, model,
        session_id, session_scope, session_scope_id,
        work_item_id, run_id, workflow_step_id,
        swarm_session_id, swarm_turn_type, source_capability_id
      )
      VALUES ($1,$2,'agent',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NULL,$13,$14,$15)
    `,
    [
      args.capabilityId,
      id,
      args.content,
      timestamp,
      args.agentId,
      args.agentName || null,
      args.traceId || null,
      args.model || null,
      args.sessionId, // session_id mirrors swarm session id for transcript threading
      args.sessionScope,
      args.sessionScopeId || null,
      args.workItemId || null,
      args.sessionId, // swarm_session_id
      args.turnType,
      args.sourceCapabilityId,
    ],
  );

  return {
    id,
    capabilityId: args.capabilityId,
    role: 'agent',
    content: args.content,
    timestamp,
    agentId: args.agentId,
    agentName: args.agentName,
    traceId: args.traceId,
    model: args.model,
    sessionId: args.sessionId,
    sessionScope: args.sessionScope,
    sessionScopeId: args.sessionScopeId,
    workItemId: args.workItemId,
    swarmSessionId: args.sessionId,
    swarmTurnType: args.turnType,
    sourceCapabilityId: args.sourceCapabilityId,
  };
};

export type SwarmArtifactKind = Extract<
  ArtifactKind,
  'EXECUTION_PLAN' | 'DISAGREEMENT_SUMMARY'
>;

/**
 * Insert a swarm-produced artifact. We bypass the general `insertArtifactTx`
 * because (a) swarm artifacts are JSON payloads rather than uploads and
 * (b) we need to write the new `swarm_session_id` column on a small,
 * well-controlled column surface rather than maintaining two parallel insert
 * shapes.
 */
export const writeSwarmArtifact = async (args: {
  capabilityId: string;
  sessionId: string;
  kind: SwarmArtifactKind;
  name: string;
  description: string;
  payload: ExecutionPlanArtifactPayload | DisagreementSummaryArtifactPayload;
  agentName: string;
  workItemId?: string;
  traceId?: string;
}): Promise<string> => {
  const id = `swa-${Date.now().toString(36)}-${randomSuffix()}`;
  const created = new Date().toISOString();

  await query(
    `
      INSERT INTO capability_artifacts (
        capability_id, id, name, type,
        inputs, version, agent, created,
        template, template_sections,
        documentation_status,
        is_learning_artifact, is_master_artifact,
        decisions, changes, learning_insights, governance_rules,
        description, direction, connected_agent_id,
        source_workflow_id, run_id, run_step_id, tool_invocation_id,
        summary, work_item_id, artifact_kind, phase,
        source_run_id, source_run_step_id, source_wait_id,
        handoff_from_agent_id, handoff_to_agent_id,
        content_format, mime_type, file_name,
        content_text, content_json, downloadable,
        trace_id, latency_ms, cost_usd, policy_decision_id,
        retrieval_references, updated_at, swarm_session_id
      )
      VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,
        NULL, $9,
        NULL,
        NULL, NULL,
        $10, $10, $10, $10,
        $11, NULL, NULL,
        NULL, NULL, NULL, NULL,
        $12, $13, $14, NULL,
        NULL, NULL, NULL,
        NULL, NULL,
        'application/json', 'application/json', NULL,
        NULL, $15, false,
        $16, NULL, NULL, NULL,
        $17, NOW(), $18
      )
    `,
    [
      args.capabilityId,
      id,
      args.name,
      'swarm',                           // type — free-form, existing schema uses it loosely
      [],                                 // inputs
      1,                                  // version
      args.agentName,                     // agent
      created,                            // created
      JSON.stringify([]),                 // template_sections
      [],                                 // decisions/changes/learning/governance (empty arrays)
      args.description,                   // description
      args.workItemId || null,            // work_item_id
      args.kind,                          // artifact_kind
      null,                               // phase
      JSON.stringify(args.payload),       // content_json
      args.traceId || null,               // trace_id
      JSON.stringify([]),                 // retrieval_references
      args.sessionId,                     // swarm_session_id
    ],
  );

  return id;
};

export const markSwarmSessionPromoted = async (args: {
  capabilityId: string;
  sessionId: string;
  workItemId: string;
}): Promise<SwarmSessionSummary> => {
  const result = await query<SwarmSessionRow>(
    `
      UPDATE capability_swarm_sessions
      SET promoted_work_item_id = $3,
          updated_at = NOW()
      WHERE capability_id = $1
        AND id = $2
        AND promoted_work_item_id IS NULL
      RETURNING *
    `,
    [args.capabilityId, args.sessionId, args.workItemId],
  );
  if (result.rowCount === 0) {
    throw new Error(
      `Swarm session ${args.sessionId} has already been promoted to a work item.`,
    );
  }
  return hydrateSession(result.rows[0]);
};
