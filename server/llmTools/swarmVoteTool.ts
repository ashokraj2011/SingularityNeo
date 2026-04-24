/**
 * Swarm Vote Tool
 *
 * Structured tool call forced on non-lead participants at the VOTE turn of a
 * Swarm Debate. Rather than parse free-text ("I approve…") we ask the model
 * to emit a strict JSON payload via its tool-calling channel. The orchestrator
 * validates the payload against this schema; anything non-conforming is
 * treated as an OBJECT vote with a synthetic rationale so the debate still
 * lands in a well-defined state.
 *
 * Why a tool call vs. JSON mode:
 *   - Tool calls give us deterministic argument extraction across providers
 *     that support them (OpenAI, Anthropic via GitHub Models, etc.).
 *   - For providers without native tool calls, callers may fall back to
 *     forced-JSON output and reuse `SWARM_VOTE_TOOL_NAME` + `SwarmVoteInput`
 *     to validate the resulting object. The schema below is intentionally
 *     provider-agnostic (plain JSON Schema Draft 7-ish).
 */
import type { SwarmVote } from '../../src/types';

export const SWARM_VOTE_TOOL_NAME = 'vote' as const;

export interface SwarmVoteInput {
  decision: SwarmVote;
  rationale: string;
}

/**
 * Canonical JSON Schema for the vote tool arguments. Exported so provider
 * adapters can embed it in their tool-definition payloads without duplicating
 * the shape in multiple places.
 */
export const SWARM_VOTE_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: {
      type: 'string',
      enum: ['APPROVE', 'OBJECT'] as const,
      description:
        "APPROVE if the synthesized plan is acceptable as stated; OBJECT if any material objection remains.",
    },
    rationale: {
      type: 'string',
      minLength: 1,
      description:
        'One-to-three sentence justification. For OBJECT, cite the specific blocker. For APPROVE, summarize why the plan resolves your concerns.',
    },
  },
  required: ['decision', 'rationale'],
} as const;

export const swarmVoteTool = {
  name: SWARM_VOTE_TOOL_NAME,
  description:
    'Cast your final, structured decision on the synthesized plan. You MUST call this exactly once. Do not answer in free text.',
  input_schema: SWARM_VOTE_TOOL_SCHEMA,
} as const;

/**
 * Normalize an arbitrary tool-call payload into a typed `SwarmVoteInput`.
 * Non-conforming payloads degrade to OBJECT so the debate reaches a decisive
 * terminal state instead of hanging on provider oddities.
 */
export const parseSwarmVotePayload = (raw: unknown): SwarmVoteInput => {
  if (!raw || typeof raw !== 'object') {
    return {
      decision: 'OBJECT',
      rationale: 'Vote payload was missing or malformed; recorded as objection by default.',
    };
  }
  const record = raw as Record<string, unknown>;
  const decisionRaw =
    typeof record.decision === 'string' ? record.decision.trim().toUpperCase() : '';
  const rationaleRaw =
    typeof record.rationale === 'string' ? record.rationale.trim() : '';

  const decision: SwarmVote =
    decisionRaw === 'APPROVE' ? 'APPROVE' : 'OBJECT';
  const rationale =
    rationaleRaw ||
    (decision === 'APPROVE'
      ? 'Approved without a written rationale.'
      : 'Objection recorded without a written rationale.');

  return { decision, rationale };
};
