/**
 * Chat-driven learning.
 *
 * Reads the last N messages of a chat session between a user and an agent,
 * asks the model to distill durable corrections/preferences/learnings the
 * user taught the agent during the conversation, and pipes the result
 * through `applyAgentLearningCorrection()` — which in turn runs the
 * existing shape-check quality gate before letting the profile flip.
 *
 * Design notes:
 * - One row per (capability, agent, session) in `capability_chat_distillations`
 *   so re-distilling is an UPSERT — we never double-teach from the same
 *   chat.
 * - The model call is explicit and short: a single system+user pair asking
 *   for a ≤2000-char correction summary. Empty/refused responses short-
 *   circuit to "nothing to learn here" (skip record).
 * - We don't block inference waiting for this. Endpoint is explicit so the
 *   user (or the auto-hook at session end) triggers it deliberately.
 */
import type { ActorContext } from '../../src/types';
import { query } from '../db';
import { requestGitHubModel } from '../githubModels';
import { applyAgentLearningCorrection } from './service';

const MESSAGE_LOOKBACK_LIMIT = 30;
const DISTILLATION_MAX_OUTPUT_CHARS = 2000;
const DISTILLATION_MIN_USEFUL_CHARS = 24;

interface RawChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  agentId: string | null;
  agentName: string | null;
}

const loadRecentSessionMessages = async (
  capabilityId: string,
  agentId: string,
  sessionId: string,
): Promise<RawChatMessage[]> => {
  const result = await query(
    `
      SELECT id, role, content, timestamp, agent_id, agent_name
      FROM capability_messages
      WHERE capability_id = $1
        AND session_id = $2
        AND (agent_id = $3 OR role = 'user')
      ORDER BY created_at DESC
      LIMIT $4
    `,
    [capabilityId, sessionId, agentId, MESSAGE_LOOKBACK_LIMIT],
  );
  const rows = (result.rows as Array<Record<string, any>>) || [];
  return rows
    .map(row => ({
      id: String(row.id),
      role: String(row.role),
      content: String(row.content || ''),
      timestamp: String(row.timestamp || ''),
      agentId: row.agent_id ? String(row.agent_id) : null,
      agentName: row.agent_name ? String(row.agent_name) : null,
    }))
    .reverse(); // oldest-first for the LLM
};

const formatTranscriptForModel = (messages: RawChatMessage[], agentName: string): string => {
  if (!messages.length) return '';
  return messages
    .map(msg => {
      const speaker =
        msg.role === 'user'
          ? 'User'
          : msg.role === 'assistant'
          ? agentName
          : msg.role;
      const content = msg.content.replace(/\s+$/g, '').slice(0, 4000);
      return `${speaker}: ${content}`;
    })
    .join('\n\n');
};

const buildDistillationPrompt = (transcript: string, agentName: string) => [
  {
    role: 'system' as const,
    content: [
      'You distill conversations into durable corrections that improve an agent\'s learned behavior.',
      'Given a chat transcript between a user and the agent, identify the concrete corrections, preferences, policies, or factual updates the user expressed — the things the agent should remember next time.',
      'Rules:',
      '- Focus on things the user explicitly corrected, preferred, clarified, or taught. Ignore small talk, restating, or the agent\'s own answers.',
      '- Each item must be an imperative sentence ("Use X, not Y", "Prefer concise summaries", "Always cite the relevant control ID", …).',
      '- If the user did not teach anything durable (e.g. just asked questions), respond with the exact string NO_LEARNING.',
      '- Output at most 8 items as a simple bullet list, no headers, no preamble. Total response ≤ 1500 characters.',
    ].join('\n'),
  },
  {
    role: 'user' as const,
    content: [
      `Agent name: ${agentName}`,
      'Transcript:',
      '"""',
      transcript,
      '"""',
      '',
      'Return either the bullet list of durable learnings or NO_LEARNING.',
    ].join('\n'),
  },
];

const trimBullets = (raw: string): string => {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
  const bullets = lines
    .map(line => line.replace(/^[-*•\d.\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!bullets.length) return '';
  const joined = bullets.map(line => `- ${line}`).join('\n');
  return joined.length > DISTILLATION_MAX_OUTPUT_CHARS
    ? `${joined.slice(0, DISTILLATION_MAX_OUTPUT_CHARS - 1)}…`
    : joined;
};

const recordDistillationAudit = async (row: {
  capabilityId: string;
  agentId: string;
  sessionId: string;
  messageCount: number;
  correctionPreview: string;
  learningUpdateId?: string;
  blockedByShapeCheck?: boolean;
  blockReason?: string;
}) => {
  await query(
    `
      INSERT INTO capability_chat_distillations (
        capability_id, agent_id, session_id, distilled_at, message_count,
        correction_preview, learning_update_id, blocked_by_shape_check, block_reason
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8)
      ON CONFLICT (capability_id, agent_id, session_id) DO UPDATE SET
        distilled_at = EXCLUDED.distilled_at,
        message_count = EXCLUDED.message_count,
        correction_preview = EXCLUDED.correction_preview,
        learning_update_id = EXCLUDED.learning_update_id,
        blocked_by_shape_check = EXCLUDED.blocked_by_shape_check,
        block_reason = EXCLUDED.block_reason
    `,
    [
      row.capabilityId,
      row.agentId,
      row.sessionId,
      row.messageCount,
      row.correctionPreview.slice(0, 1024),
      row.learningUpdateId || null,
      Boolean(row.blockedByShapeCheck),
      row.blockReason || null,
    ],
  );
};

export interface ChatDistillationResult {
  status: 'APPLIED' | 'NO_LEARNING' | 'TOO_SHORT' | 'ALREADY_DISTILLED' | 'ERROR';
  correctionPreview?: string;
  messageCount: number;
  message?: string;
}

export const distillAgentChatSession = async ({
  capabilityId,
  agentId,
  agentName,
  sessionId,
  actor,
  workItemId,
  runId,
  force = false,
}: {
  capabilityId: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  actor: ActorContext;
  workItemId?: string;
  runId?: string;
  /** When true, re-distill even if we've already distilled this session. */
  force?: boolean;
}): Promise<ChatDistillationResult> => {
  if (!force) {
    const existing = await query(
      `
        SELECT distilled_at
        FROM capability_chat_distillations
        WHERE capability_id = $1 AND agent_id = $2 AND session_id = $3
      `,
      [capabilityId, agentId, sessionId],
    );
    if (existing.rowCount) {
      return {
        status: 'ALREADY_DISTILLED',
        messageCount: 0,
        message: 'This chat session was already distilled into the agent\'s learning profile. Pass force=true to re-distill.',
      };
    }
  }

  const messages = await loadRecentSessionMessages(capabilityId, agentId, sessionId);
  if (messages.length < 2) {
    await recordDistillationAudit({
      capabilityId,
      agentId,
      sessionId,
      messageCount: messages.length,
      correctionPreview: '',
      blockReason: 'Not enough messages to distill.',
    });
    return {
      status: 'TOO_SHORT',
      messageCount: messages.length,
      message: 'Not enough back-and-forth in this session to distill a learning correction.',
    };
  }

  const transcript = formatTranscriptForModel(messages, agentName);
  const prompt = buildDistillationPrompt(transcript, agentName);

  let modelResponse: { content: string };
  try {
    modelResponse = await requestGitHubModel({
      messages: prompt,
      timeoutMs: 30_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model call failed.';
    await recordDistillationAudit({
      capabilityId,
      agentId,
      sessionId,
      messageCount: messages.length,
      correctionPreview: '',
      blockReason: `Distillation model call failed: ${message}`,
    });
    return {
      status: 'ERROR',
      messageCount: messages.length,
      message,
    };
  }

  const raw = (modelResponse.content || '').trim();
  if (!raw || /^NO_LEARNING\.?$/i.test(raw)) {
    await recordDistillationAudit({
      capabilityId,
      agentId,
      sessionId,
      messageCount: messages.length,
      correctionPreview: '',
      blockReason: 'Model reported nothing durable to learn.',
    });
    return {
      status: 'NO_LEARNING',
      messageCount: messages.length,
      message: 'The model found nothing durable to teach the agent from this session.',
    };
  }

  const correction = trimBullets(raw);
  if (correction.length < DISTILLATION_MIN_USEFUL_CHARS) {
    await recordDistillationAudit({
      capabilityId,
      agentId,
      sessionId,
      messageCount: messages.length,
      correctionPreview: correction,
      blockReason: 'Distilled correction was too short to be useful.',
    });
    return {
      status: 'TOO_SHORT',
      messageCount: messages.length,
      correctionPreview: correction,
    };
  }

  // Delegate to the existing correction writer — it writes the
  // USER_CORRECTION audit row, refreshes capability memory, and enqueues
  // a learning-profile refresh job. The shape-check quality gate runs on
  // the refreshed profile version asynchronously; if it fails the prior
  // version keeps serving and the profile is left at `REVIEW_PENDING`.
  try {
    await applyAgentLearningCorrection({
      capabilityId,
      agentId,
      correction,
      workItemId,
      runId,
      actor,
    });
    await recordDistillationAudit({
      capabilityId,
      agentId,
      sessionId,
      messageCount: messages.length,
      correctionPreview: correction,
    });
    return {
      status: 'APPLIED',
      messageCount: messages.length,
      correctionPreview: correction,
      message:
        'Distilled correction applied. A learning-profile refresh is queued; the quality gate runs on the new version asynchronously.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Learning correction failed.';
    await recordDistillationAudit({
      capabilityId,
      agentId,
      sessionId,
      messageCount: messages.length,
      correctionPreview: correction,
      blockReason: `applyAgentLearningCorrection threw: ${message}`,
    });
    return {
      status: 'ERROR',
      messageCount: messages.length,
      correctionPreview: correction,
      message,
    };
  }
};
