/**
 * Persistent prompt receipts — time-travel debugging for AI decisions.
 *
 * Every main-model LLM call inside the execution engine persists a
 * receipt: the exact context fragments the model saw, the assembled
 * prompt, the agent snapshot, and the model's response. Operators can:
 *
 *   1. Answer "why did the agent decide X?" by viewing the exact
 *      fragments that entered the prompt.
 *   2. Answer "what would have happened with a different model?" by
 *      hitting the replay endpoint, which rehydrates the captured
 *      context and re-invokes the provider.
 *
 * On-brand with the evidence / flight-recorder story: everything the
 * model saw is durable, auditable, and replayable against any other
 * model without re-running the full step.
 *
 * Failure policy: persistence is fire-and-forget. A failed INSERT must
 * never block inference — the ephemeral PROMPT_RECEIPT run event is
 * still emitted regardless, so live ops UIs keep working.
 */
import type { Capability, CapabilityAgent } from '../../src/types';
import { query } from '../db';

export interface PromptReceiptFragment {
  source: string;
  tokens: number;
  meta?: Record<string, unknown>;
}

export interface PromptReceiptEviction {
  source: string;
  tokens: number;
  reason: string;
}

export interface PromptReceiptRecord {
  id: string;
  runStepId: string;
  runId: string | null;
  workItemId: string | null;
  capabilityId: string;
  agentId: string | null;
  agentSnapshot: Partial<CapabilityAgent>;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId: string | null;
  phase: string | null;
  model: string | null;
  providerKey: string | null;
  userPrompt: string;
  memoryPrompt: string | null;
  developerPrompt: string | null;
  responseContent: string;
  responseUsage: Record<string, unknown> | null;
  fragments: PromptReceiptFragment[];
  evicted: PromptReceiptEviction[];
  totalEstimatedTokens: number;
  maxInputTokens: number;
  reservedOutputTokens: number;
  createdAt: string;
}

export interface PersistPromptReceiptInput {
  runStepId: string;
  runId?: string | null;
  workItemId?: string | null;
  capability: Pick<Capability, 'id'>;
  agent: Partial<CapabilityAgent>;
  scope: 'GENERAL_CHAT' | 'WORK_ITEM' | 'TASK';
  scopeId?: string | null;
  phase?: string | null;
  model?: string | null;
  providerKey?: string | null;
  userPrompt: string;
  memoryPrompt?: string | null;
  developerPrompt?: string | null;
  responseContent: string;
  responseUsage?: Record<string, unknown> | null;
  fragments: PromptReceiptFragment[];
  evicted: PromptReceiptEviction[];
  totalEstimatedTokens: number;
  maxInputTokens: number;
  reservedOutputTokens: number;
}

const createReceiptId = () =>
  `PR-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}`;

// Agent snapshots are what drives replay fidelity: we need to rebuild
// exactly the system prompt the model saw. Persist only the fields
// `invokeScopedCapabilitySession` actually reads so the row stays small
// and doesn't drag secrets through the audit log.
const snapshotAgent = (agent: Partial<CapabilityAgent>) => ({
  id: agent.id,
  name: agent.name,
  model: agent.model,
  providerKey: (agent as { providerKey?: string }).providerKey,
  systemPrompt: agent.systemPrompt,
  responseContract: (agent as { responseContract?: unknown }).responseContract,
  temperature: (agent as { temperature?: number }).temperature,
  // Learning profile contributes to the system prompt; persist its
  // context block so replay gets identical guidance.
  learningProfile: agent.learningProfile
    ? { contextBlock: agent.learningProfile.contextBlock }
    : undefined,
});

export const persistPromptReceipt = async (
  input: PersistPromptReceiptInput,
): Promise<string | null> => {
  const id = createReceiptId();

  try {
    await query(
      `INSERT INTO run_step_prompt_receipts (
        id,
        run_step_id,
        run_id,
        work_item_id,
        capability_id,
        agent_id,
        agent_snapshot,
        scope,
        scope_id,
        phase,
        model,
        provider_key,
        user_prompt,
        memory_prompt,
        developer_prompt,
        response_content,
        response_usage,
        fragments,
        evicted,
        total_estimated_tokens,
        max_input_tokens,
        reserved_output_tokens
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb,
        $20, $21, $22
      )`,
      [
        id,
        input.runStepId,
        input.runId ?? null,
        input.workItemId ?? null,
        input.capability.id,
        input.agent.id ?? null,
        JSON.stringify(snapshotAgent(input.agent)),
        input.scope,
        input.scopeId ?? null,
        input.phase ?? null,
        input.model ?? null,
        input.providerKey ?? null,
        input.userPrompt,
        input.memoryPrompt ?? null,
        input.developerPrompt ?? null,
        input.responseContent,
        input.responseUsage ? JSON.stringify(input.responseUsage) : null,
        JSON.stringify(input.fragments),
        JSON.stringify(input.evicted),
        input.totalEstimatedTokens,
        input.maxInputTokens,
        input.reservedOutputTokens,
      ],
    );
    return id;
  } catch (error) {
    // Never block inference on persistence failure — the ephemeral
    // PROMPT_RECEIPT run event still flies, so live ops UIs keep
    // working. Durability is best-effort.
    console.warn('[promptReceipts] failed to persist receipt', error);
    return null;
  }
};

const mapRow = (row: Record<string, unknown>): PromptReceiptRecord => ({
  id: String(row.id),
  runStepId: String(row.run_step_id),
  runId: row.run_id == null ? null : String(row.run_id),
  workItemId: row.work_item_id == null ? null : String(row.work_item_id),
  capabilityId: String(row.capability_id),
  agentId: row.agent_id == null ? null : String(row.agent_id),
  agentSnapshot:
    row.agent_snapshot && typeof row.agent_snapshot === 'object'
      ? (row.agent_snapshot as Partial<CapabilityAgent>)
      : {},
  scope: String(row.scope) as PromptReceiptRecord['scope'],
  scopeId: row.scope_id == null ? null : String(row.scope_id),
  phase: row.phase == null ? null : String(row.phase),
  model: row.model == null ? null : String(row.model),
  providerKey: row.provider_key == null ? null : String(row.provider_key),
  userPrompt: String(row.user_prompt ?? ''),
  memoryPrompt: row.memory_prompt == null ? null : String(row.memory_prompt),
  developerPrompt:
    row.developer_prompt == null ? null : String(row.developer_prompt),
  responseContent: String(row.response_content ?? ''),
  responseUsage:
    row.response_usage && typeof row.response_usage === 'object'
      ? (row.response_usage as Record<string, unknown>)
      : null,
  fragments: Array.isArray(row.fragments)
    ? (row.fragments as PromptReceiptFragment[])
    : [],
  evicted: Array.isArray(row.evicted)
    ? (row.evicted as PromptReceiptEviction[])
    : [],
  totalEstimatedTokens: Number(row.total_estimated_tokens ?? 0),
  maxInputTokens: Number(row.max_input_tokens ?? 0),
  reservedOutputTokens: Number(row.reserved_output_tokens ?? 0),
  createdAt:
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at ?? ''),
});

export const getPromptReceiptById = async (
  id: string,
): Promise<PromptReceiptRecord | null> => {
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM run_step_prompt_receipts WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
};

export const listPromptReceiptsForRunStep = async (
  runStepId: string,
): Promise<PromptReceiptRecord[]> => {
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM run_step_prompt_receipts
     WHERE run_step_id = $1
     ORDER BY created_at ASC`,
    [runStepId],
  );
  return result.rows.map(mapRow);
};

export const listPromptReceiptsForRun = async (
  runId: string,
  limit = 200,
): Promise<PromptReceiptRecord[]> => {
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM run_step_prompt_receipts
     WHERE run_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [runId, limit],
  );
  return result.rows.map(mapRow);
};
