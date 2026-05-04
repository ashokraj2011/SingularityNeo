/**
 * LLM Context Log
 *
 * Two responsibilities:
 *
 *   1. Backend terminal logging — emit a structured `[llm:context]` block
 *      per LLM call so operators can grep/inspect what was sent to the
 *      model. Toggle via `SINGULARITY_LOG_LLM_CONTEXT` env:
 *        - `off`     : silence
 *        - `summary` : (default) lengths + budget receipt only
 *        - `verbose` : full content, no truncation
 *
 *   2. Durable persistence (chat) — write a `capability_llm_context_log`
 *      row per chat call so the operator UI can replay the exact prompt
 *      that produced each agent response.
 *
 * Execution-mode (workflow runs) persistence is via a `LLM_CONTEXT_PREPARED`
 * RunEvent emitted by `server/execution/service.ts`, not this module.
 */

import { query } from "./db";
import type { LlmContextLogEntry } from "../src/types";

// ── Logger ────────────────────────────────────────────────────────────────

export type LlmContextLogMode = "off" | "summary" | "verbose";

const resolveLogMode = (): LlmContextLogMode => {
  const raw = String(process.env.SINGULARITY_LOG_LLM_CONTEXT || "summary")
    .trim()
    .toLowerCase();
  if (raw === "off" || raw === "verbose") return raw;
  return "summary";
};

export interface LlmContextLogPayload {
  scope?: string;
  scopeId?: string;
  capabilityId?: string;
  workItemId?: string;
  traceId?: string;
  provider: string;
  model: string;
  /**
   * Assembled message array exactly as it will be sent to the model.
   * For chat mode this is typically `[{system}, {user}]`; for tool-loop
   * execution it can include multiple user/assistant/tool turns.
   */
  messages: Array<{ role: string; content: string }>;
  /** Budget receipt from contextBudget.ts — included + evicted fragments. */
  budgetReceipt?: {
    included?: Array<{ source: string; estimatedTokens: number }>;
    evicted?: Array<{ source: string; estimatedTokens: number; reason?: string }>;
    totalEstimatedTokens?: number;
    maxInputTokens?: number;
    reservedOutputTokens?: number;
  } | null;
  /** Coarse breakdown of recent history (turn count, length sum) for log line. */
  historySummary?: { turns: number; characters: number };
}

const ROW = "════════════════════════════════════════════════════════";
const SUB = "──────────────────────────────────────────────────────";

const summarizeMessages = (messages: LlmContextLogPayload["messages"]) => {
  let total = 0;
  const counts: Record<string, number> = {};
  for (const m of messages) {
    total += m.content?.length ?? 0;
    counts[m.role] = (counts[m.role] || 0) + 1;
  }
  return { total, counts };
};

const formatBudgetSummary = (
  budgetReceipt: LlmContextLogPayload["budgetReceipt"],
): string => {
  if (!budgetReceipt) return "";
  const used = budgetReceipt.totalEstimatedTokens ?? 0;
  const max = budgetReceipt.maxInputTokens ?? 0;
  const evicted = (budgetReceipt.evicted || [])
    .map((e) => e.source)
    .join(", ");
  return `${used}/${max} tok${evicted ? ` · evicted: ${evicted}` : ""}`;
};

/**
 * Print the assembled context envelope to the backend terminal. Honors
 * the `SINGULARITY_LOG_LLM_CONTEXT` env toggle.
 *
 * Uses `console.error` (stderr) instead of `console.log` (stdout)
 * because the desktop worker's stdout doubles as the IPC channel back
 * to the Electron parent — non-JSON lines on stdout were historically
 * dropped silently. main.mjs now also echoes those, but writing to
 * stderr (which is `inherit`-mapped to the launching terminal) is the
 * belt-and-suspenders path that works regardless.
 */
const writeLine = (line: string): void => {
  // stderr is configured `inherit` for the worker → reaches the operator's
  // terminal directly. For control-plane / unit-test contexts, stderr is
  // also their natural diagnostic channel.
  process.stderr.write(`${line}\n`);
};

export const logLlmContextEnvelope = (payload: LlmContextLogPayload): void => {
  const mode = resolveLogMode();
  if (mode === "off") return;

  const tag = "[llm:context]";
  const { scope, scopeId, traceId, provider, model, messages, budgetReceipt } =
    payload;
  const summary = summarizeMessages(messages);

  writeLine(`\n${tag} ${ROW}`);
  writeLine(
    `${tag} traceId: ${traceId || "n/a"} · scope: ${scope || "?"}${scopeId ? `:${scopeId}` : ""}`,
  );
  writeLine(`${tag} provider: ${provider} · model: ${model}`);
  writeLine(
    `${tag} messages: ${messages.length} (${summary.total} chars, ${Object.entries(
      summary.counts,
    )
      .map(([role, n]) => `${role}=${n}`)
      .join(" ")})`,
  );
  const budgetLine = formatBudgetSummary(budgetReceipt);
  if (budgetLine) writeLine(`${tag} budget: ${budgetLine}`);

  if (mode === "verbose") {
    // Print full content, role-by-role, with section dividers.
    for (let i = 0; i < messages.length; i += 1) {
      const m = messages[i];
      writeLine(`${tag} ${SUB}`);
      writeLine(`${tag} [${i + 1}] role: ${m.role} · ${m.content.length} chars`);
      writeLine(m.content);
    }

    if (budgetReceipt) {
      writeLine(`${tag} ${SUB}`);
      writeLine(`${tag} budget receipt:`);
      for (const f of budgetReceipt.included || []) {
        writeLine(`${tag}   + ${f.source.padEnd(22)} ${f.estimatedTokens} tok`);
      }
      for (const f of budgetReceipt.evicted || []) {
        writeLine(
          `${tag}   - ${f.source.padEnd(22)} ${f.estimatedTokens} tok (evicted${
            f.reason ? `: ${f.reason}` : ""
          })`,
        );
      }
    }
  }

  writeLine(`${tag} ${ROW}\n`);
};

// ── Persistence (chat-mode) ───────────────────────────────────────────────

const createId = () =>
  `LLM-CTX-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

export interface RecordChatContextLogInput {
  capabilityId: string;
  traceId?: string;
  agentId?: string;
  sessionId?: string;
  sessionScope?: string;
  sessionScopeId?: string;
  workItemId?: string;
  provider: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  budgetReceipt?: LlmContextLogPayload["budgetReceipt"];
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}

const rowToEntry = (row: Record<string, unknown>): LlmContextLogEntry => ({
  id: String(row.id),
  capabilityId: String(row.capability_id),
  traceId: row.trace_id ? String(row.trace_id) : undefined,
  agentId: row.agent_id ? String(row.agent_id) : undefined,
  sessionId: row.session_id ? String(row.session_id) : undefined,
  sessionScope: row.session_scope ? String(row.session_scope) : undefined,
  sessionScopeId: row.session_scope_id
    ? String(row.session_scope_id)
    : undefined,
  workItemId: row.work_item_id ? String(row.work_item_id) : undefined,
  provider: String(row.provider),
  model: String(row.model),
  messages: Array.isArray(row.messages)
    ? (row.messages as Array<{ role: string; content: string }>)
    : [],
  budgetReceipt: (row.budget_receipt as LlmContextLogEntry["budgetReceipt"]) ?? undefined,
  promptTokens: row.prompt_tokens != null ? Number(row.prompt_tokens) : undefined,
  completionTokens:
    row.completion_tokens != null ? Number(row.completion_tokens) : undefined,
  costUsd: row.cost_usd != null ? Number(row.cost_usd) : undefined,
  createdAt:
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
});

export const recordChatContextLogEntry = async (
  input: RecordChatContextLogInput,
): Promise<LlmContextLogEntry> => {
  const id = createId();
  const result = await query(
    `
    INSERT INTO capability_llm_context_log (
      id, capability_id, trace_id, agent_id, session_id, session_scope,
      session_scope_id, work_item_id, provider, model, messages,
      budget_receipt, prompt_tokens, completion_tokens, cost_usd
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15
    )
    RETURNING *
    `,
    [
      id,
      input.capabilityId,
      input.traceId || null,
      input.agentId || null,
      input.sessionId || null,
      input.sessionScope || null,
      input.sessionScopeId || null,
      input.workItemId || null,
      input.provider,
      input.model,
      JSON.stringify(input.messages || []),
      input.budgetReceipt ? JSON.stringify(input.budgetReceipt) : null,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.costUsd ?? null,
    ],
  );
  return rowToEntry(result.rows[0] as Record<string, unknown>);
};

export const listRecentContextLogEntries = async ({
  capabilityId,
  workItemId,
  limit = 50,
}: {
  capabilityId: string;
  workItemId?: string;
  limit?: number;
}): Promise<LlmContextLogEntry[]> => {
  const params: unknown[] = [capabilityId];
  let where = "WHERE capability_id = $1";
  if (workItemId) {
    params.push(workItemId);
    where += ` AND work_item_id = $${params.length}`;
  }
  params.push(Math.max(1, Math.min(500, limit)));
  const result = await query(
    `
    SELECT *
    FROM capability_llm_context_log
    ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length}
    `,
    params,
  );
  return result.rows.map((row) => rowToEntry(row as Record<string, unknown>));
};

export const fetchContextLogEntry = async ({
  capabilityId,
  entryId,
}: {
  capabilityId: string;
  entryId: string;
}): Promise<LlmContextLogEntry | null> => {
  const result = await query(
    `SELECT * FROM capability_llm_context_log WHERE capability_id = $1 AND id = $2`,
    [capabilityId, entryId],
  );
  if (result.rows.length === 0) return null;
  return rowToEntry(result.rows[0] as Record<string, unknown>);
};

export const fetchContextLogEntryByTraceId = async ({
  capabilityId,
  traceId,
}: {
  capabilityId: string;
  traceId: string;
}): Promise<LlmContextLogEntry | null> => {
  const result = await query(
    `SELECT * FROM capability_llm_context_log WHERE capability_id = $1 AND trace_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [capabilityId, traceId],
  );
  if (result.rows.length === 0) return null;
  return rowToEntry(result.rows[0] as Record<string, unknown>);
};
