import type { PoolClient } from 'pg';
import type {
  AgentSessionMemory,
  AgentSessionMemoryTurn,
  AgentSessionScope,
  CapabilityChatMessage,
  SessionMemoryUpdate,
} from '../../../src/types';
import { query } from '../../db';
import { mergeAgentSessionMemoryState } from './sessionMemory';

const createId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const asIso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : String(value || '');

const sessionMemoryFromRow = (row: Record<string, any>): AgentSessionMemory => ({
  id: String(row.id || ''),
  capabilityId: String(row.capability_id || ''),
  agentId: String(row.agent_id || ''),
  sessionId: String(row.session_id || ''),
  scope: String(row.scope || 'GENERAL_CHAT') as AgentSessionScope,
  scopeId: row.scope_id || undefined,
  rollingSummary: row.rolling_summary || '',
  salientTurns: Array.isArray(row.salient_turns)
    ? row.salient_turns
        .map((turn: any): AgentSessionMemoryTurn => ({
          role: turn?.role === 'agent' ? 'agent' : 'user',
          content: String(turn?.content || '').trim(),
          timestamp: turn?.timestamp ? String(turn.timestamp) : undefined,
          kind:
            turn?.kind === 'TOOL' || turn?.kind === 'SUMMARY'
              ? turn.kind
              : 'TRANSCRIPT',
        }))
        .filter(turn => Boolean(turn.content))
    : [],
  lastUserIntent: row.last_user_intent || undefined,
  lastAssistantActionableOffer: row.last_assistant_actionable_offer || undefined,
  recentRepoCodeTarget: row.recent_repo_code_target || undefined,
  requestCount: Number(row.request_count || 0),
  lastUpdatedAt: asIso(row.updated_at),
  createdAt: asIso(row.created_at),
});

const getAgentSessionMemoryTx = async (
  client: PoolClient,
  {
    capabilityId,
    agentId,
    scope,
    scopeId,
    sessionId,
  }: {
    capabilityId: string;
    agentId: string;
    scope: AgentSessionScope;
    scopeId?: string;
    sessionId?: string;
  },
): Promise<AgentSessionMemory | null> => {
  const result = await client.query(
    `
      SELECT *
      FROM capability_agent_session_memories
      WHERE capability_id = $1
        AND agent_id = $2
        AND scope = $3
        AND ($4::text = '' OR scope_id = $4)
        AND ($5::text = '' OR session_id = $5)
      ORDER BY
        CASE WHEN $5::text <> '' AND session_id = $5 THEN 0 ELSE 1 END,
        last_message_at DESC NULLS LAST,
        updated_at DESC
      LIMIT 1
    `,
    [capabilityId, agentId, scope, scopeId || '', sessionId || ''],
  );

  return result.rows[0] ? sessionMemoryFromRow(result.rows[0] as Record<string, any>) : null;
};

export const getAgentSessionMemory = async ({
  capabilityId,
  agentId,
  scope,
  scopeId,
  sessionId,
}: {
  capabilityId: string;
  agentId: string;
  scope: AgentSessionScope;
  scopeId?: string;
  sessionId?: string;
}): Promise<AgentSessionMemory | null> => {
  const result = await query(
    `
      SELECT *
      FROM capability_agent_session_memories
      WHERE capability_id = $1
        AND agent_id = $2
        AND scope = $3
        AND ($4::text = '' OR scope_id = $4)
        AND ($5::text = '' OR session_id = $5)
      ORDER BY
        CASE WHEN $5::text <> '' AND session_id = $5 THEN 0 ELSE 1 END,
        last_message_at DESC NULLS LAST,
        updated_at DESC
      LIMIT 1
    `,
    [capabilityId, agentId, scope, scopeId || '', sessionId || ''],
  );

  return result.rows[0] ? sessionMemoryFromRow(result.rows[0] as Record<string, any>) : null;
};

const upsertAgentSessionMemoryTx = async (
  client: PoolClient,
  {
    capabilityId,
    agentId,
    scope,
    scopeId,
    sessionId,
    update,
    assistantMessage,
  }: {
    capabilityId: string;
    agentId: string;
    scope: AgentSessionScope;
    scopeId?: string;
    sessionId: string;
    update: SessionMemoryUpdate;
    assistantMessage?: string;
  },
): Promise<AgentSessionMemory> => {
  const existing = await getAgentSessionMemoryTx(client, {
    capabilityId,
    agentId,
    scope,
    scopeId,
    sessionId,
  });
  const merged = mergeAgentSessionMemoryState({
    existing,
    update,
    assistantMessage,
  });
  const result = await client.query(
    `
      INSERT INTO capability_agent_session_memories (
        capability_id,
        id,
        agent_id,
        scope,
        scope_id,
        session_id,
        rolling_summary,
        salient_turns,
        last_user_intent,
        last_assistant_actionable_offer,
        recent_repo_code_target,
        request_count,
        last_message_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,NOW(),NOW())
      ON CONFLICT (capability_id, agent_id, scope, scope_id, session_id) DO UPDATE SET
        rolling_summary = EXCLUDED.rolling_summary,
        salient_turns = EXCLUDED.salient_turns,
        last_user_intent = EXCLUDED.last_user_intent,
        last_assistant_actionable_offer = EXCLUDED.last_assistant_actionable_offer,
        recent_repo_code_target = EXCLUDED.recent_repo_code_target,
        request_count = EXCLUDED.request_count,
        last_message_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `,
    [
      capabilityId,
      existing?.id || createId('ASESSIONMEM'),
      agentId,
      scope,
      scopeId || '',
      sessionId,
      merged.rollingSummary,
      JSON.stringify(merged.salientTurns),
      merged.lastUserIntent || null,
      merged.lastAssistantActionableOffer || null,
      merged.recentRepoCodeTarget || null,
      merged.requestCount,
    ],
  );

  return sessionMemoryFromRow(result.rows[0] as Record<string, any>);
};

export const upsertAgentSessionMemory = async ({
  capabilityId,
  agentId,
  scope,
  scopeId,
  sessionId,
  update,
  assistantMessage,
}: {
  capabilityId: string;
  agentId: string;
  scope: AgentSessionScope;
  scopeId?: string;
  sessionId: string;
  update: SessionMemoryUpdate;
  assistantMessage?: string;
}): Promise<AgentSessionMemory> => {
  const existing = await getAgentSessionMemory({
    capabilityId,
    agentId,
    scope,
    scopeId,
    sessionId,
  });
  const merged = mergeAgentSessionMemoryState({
    existing,
    update,
    assistantMessage,
  });
  const result = await query(
    `
      INSERT INTO capability_agent_session_memories (
        capability_id,
        id,
        agent_id,
        scope,
        scope_id,
        session_id,
        rolling_summary,
        salient_turns,
        last_user_intent,
        last_assistant_actionable_offer,
        recent_repo_code_target,
        request_count,
        last_message_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,NOW(),NOW())
      ON CONFLICT (capability_id, agent_id, scope, scope_id, session_id) DO UPDATE SET
        rolling_summary = EXCLUDED.rolling_summary,
        salient_turns = EXCLUDED.salient_turns,
        last_user_intent = EXCLUDED.last_user_intent,
        last_assistant_actionable_offer = EXCLUDED.last_assistant_actionable_offer,
        recent_repo_code_target = EXCLUDED.recent_repo_code_target,
        request_count = EXCLUDED.request_count,
        last_message_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `,
    [
      capabilityId,
      existing?.id || createId('ASESSIONMEM'),
      agentId,
      scope,
      scopeId || '',
      sessionId,
      merged.rollingSummary,
      JSON.stringify(merged.salientTurns),
      merged.lastUserIntent || null,
      merged.lastAssistantActionableOffer || null,
      merged.recentRepoCodeTarget || null,
      merged.requestCount,
    ],
  );

  return sessionMemoryFromRow(result.rows[0] as Record<string, any>);
};

export const syncAgentSessionMemoryFromTranscriptTx = async (
  client: PoolClient,
  capabilityId: string,
  message: Omit<CapabilityChatMessage, 'capabilityId'>,
) => {
  if (message.hidden || message.role !== 'agent' || !message.agentId) {
    return null;
  }

  const scope =
    message.sessionScope || (message.workItemId ? 'WORK_ITEM' : 'GENERAL_CHAT');
  const scopeId =
    message.sessionScopeId ||
    (scope === 'GENERAL_CHAT' ? capabilityId : message.workItemId || '');
  const sessionId =
    message.sessionId || `${scope}:${scopeId || capabilityId}:${message.agentId}`;

  const priorUserResult = await client.query(
    `
      SELECT content
      FROM capability_messages
      WHERE capability_id = $1
        AND role = 'user'
        AND hidden = FALSE
        AND (
          ($2::text <> '' AND session_scope = $2 AND ($3::text = '' OR session_scope_id = $3))
          OR ($4::text <> '' AND work_item_id = $4)
          OR ($2::text = '' AND $4::text = '' AND session_scope IS NULL)
        )
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [capabilityId, scope, scopeId || '', message.workItemId || ''],
  );
  const toolTranscriptResult =
    message.traceId
      ? await client.query(
          `
            SELECT role, content, timestamp
            FROM capability_messages
            WHERE capability_id = $1
              AND trace_id = $2
              AND hidden = TRUE
            ORDER BY created_at ASC
            LIMIT 6
          `,
          [capabilityId, message.traceId],
        )
      : { rows: [] as Array<Record<string, any>> };

  return upsertAgentSessionMemoryTx(client, {
    capabilityId,
    agentId: message.agentId,
    scope,
    scopeId: scopeId || undefined,
    sessionId,
    update: {
      rawMessage: String(priorUserResult.rows[0]?.content || ''),
      assistantMessage: message.content,
      recentRepoCodeTarget: message.workItemId || undefined,
      toolTranscript: toolTranscriptResult.rows.map(
        (row): AgentSessionMemoryTurn => ({
          role: row.role === 'agent' ? 'agent' : 'user',
          content: String(row.content || ''),
          timestamp: row.timestamp ? String(row.timestamp) : undefined,
          kind: 'TOOL',
        }),
      ),
    },
    assistantMessage: message.content,
  });
};

export const auditRuntimeChatTurn = async ({
  capabilityId,
  agentId,
  agentName,
  userMessage,
  agentMessage,
  model,
  traceId,
  sessionId,
  sessionScope,
  sessionScopeId,
  workItemId,
  runId,
  sourceCapabilityId,
}: {
  capabilityId: string
  agentId?: string | null
  agentName?: string | null
  userMessage: string
  agentMessage: string
  model?: string | null
  traceId?: string | null
  sessionId?: string | null
  sessionScope?: string | null
  sessionScopeId?: string | null
  workItemId?: string | null
  runId?: string | null
  sourceCapabilityId?: string | null
}): Promise<void> => {
  const now = new Date().toISOString()
  const makeId = () =>
    `cau-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  const baseParams = [
    capabilityId,
    agentId || null,
    agentName || null,
    traceId || null,
    model || null,
    sessionId || null,
    sessionScope || null,
    sessionScopeId || null,
    workItemId || null,
    runId || null,
    sourceCapabilityId || null,
  ]

  await query(
    `INSERT INTO capability_messages
       (capability_id, id, role, content, timestamp,
        agent_id, agent_name, trace_id, model,
        session_id, session_scope, session_scope_id,
        work_item_id, run_id, workflow_step_id,
        source_capability_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15)`,
    [capabilityId, makeId(), 'user', userMessage, now, ...baseParams.slice(1)],
  )

  await query(
    `INSERT INTO capability_messages
       (capability_id, id, role, content, timestamp,
        agent_id, agent_name, trace_id, model,
        session_id, session_scope, session_scope_id,
        work_item_id, run_id, workflow_step_id,
        source_capability_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15)`,
    [capabilityId, makeId(), 'agent', agentMessage, now, ...baseParams.slice(1)],
  )
}
