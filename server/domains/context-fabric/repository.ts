import { query } from '../../db'

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
