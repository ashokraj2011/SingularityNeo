/**
 * Swarm Orchestrator
 *
 * Runs a bounded 2-3 agent planning debate against an anchor capability.
 * The code below is the concrete implementation of:
 *
 *   1. Bundle cache (anchor + per-participant home capabilities) for the
 *      lifetime of a single session so we don't re-hydrate workspaces on
 *      every turn.
 *   2. Merged memory context — each participant's prompt mixes memory
 *      retrieved from the anchor capability (shared evidence) with memory
 *      retrieved from its own home capability (lived context).
 *   3. Prompt layering (`buildSwarmPromptLayers`) that keeps the anchor
 *      framing separate from the participant's home framing so operators
 *      reading transcripts can trace "which capability did this claim
 *      come from."
 *   4. Turn loop: OPENING (parallel) → REBUTTAL (parallel) → SYNTHESIS
 *      (lead only) → VOTE (non-lead, forced JSON).
 *   5. Terminal-state materialization into an EXECUTION_PLAN artifact
 *      (on unanimous APPROVE) or DISAGREEMENT_SUMMARY (otherwise or on
 *      BUDGET_EXHAUSTED).
 *
 * The orchestrator streams progress through a capability-chat-style SSE
 * channel (`publishSwarmStreamEvent`, registered in `eventBus.ts`) so the
 * client UI can render turns as they appear.
 */
import {
  buildCapabilitySystemPrompt,
  invokeCapabilityChat,
} from '../githubModels';
import {
  swarmVoteTool,
  SWARM_VOTE_TOOL_NAME,
  SWARM_VOTE_TOOL_SCHEMA,
  parseSwarmVotePayload,
  type SwarmVoteInput,
} from '../llmTools/swarmVoteTool';
import { buildMemoryContext } from '../memory';
import { getCapabilityBundle, type CapabilityBundle } from '../repository';
import {
  buildBudgetedPrompt,
  type BudgetFragment,
  type BudgetReceipt,
} from './contextBudget';
import { estimateTokens } from './tokenEstimate';
import {
  appendSwarmTranscriptTurn,
  incrementSwarmTokenBudget,
  loadSwarmSessionDetail,
  recordSwarmParticipantVote,
  updateSwarmSessionStatus,
  writeSwarmArtifact,
} from '../swarmRepository';
import { publishSwarmStreamEvent } from '../eventBus';
import type {
  CapabilityChatMessage,
  DisagreementSummaryArtifactPayload,
  ExecutionPlanArtifactPayload,
  SwarmParticipant,
  SwarmSessionDetail,
  SwarmTerminalReason,
  SwarmTurnType,
  SwarmVote,
} from '../../src/types';

// ─── Bundle cache ────────────────────────────────────────────────────────────
// Sessions typically last seconds and live in a single Node process, but the
// same participant may show up in back-to-back sessions; a short TTL keeps
// hot swarms from repeatedly hitting the DB.

const BUNDLE_CACHE_TTL_MS = 60_000;

interface CachedBundle {
  bundle: CapabilityBundle;
  expiresAt: number;
}

const bundleCache = new Map<string, CachedBundle>();

export const getSwarmBundle = async (
  capabilityId: string,
): Promise<CapabilityBundle> => {
  const hit = bundleCache.get(capabilityId);
  if (hit && hit.expiresAt > Date.now()) return hit.bundle;
  const bundle = await getCapabilityBundle(capabilityId);
  bundleCache.set(capabilityId, {
    bundle,
    expiresAt: Date.now() + BUNDLE_CACHE_TTL_MS,
  });
  return bundle;
};

/** Test hook — explicitly drop the cache (no production caller needs this). */
export const __clearSwarmBundleCacheForTests = () => bundleCache.clear();

// ─── Prompt layering ─────────────────────────────────────────────────────────

export interface SwarmPromptLayerArgs {
  anchorBundle: CapabilityBundle;
  participantBundle: CapabilityBundle;
  participantAgentId: string;
  anchorMemoryPrompt?: string;
  homeMemoryPrompt?: string;
  turnType: SwarmTurnType;
  initiatingPrompt: string;
  priorTurns: CapabilityChatMessage[];
  leadParticipantAgentName?: string;
  sharedEvidence?: string;
  voteToolDescription?: string;
}

export interface SwarmPromptLayers {
  sharedBlock: string;
  homeBlock: string;
  userMessage: string;
  sharedReceipt: BudgetReceipt;
  homeReceipt: BudgetReceipt;
  estimatedInputTokens: number;
}

const TURN_INSTRUCTIONS: Record<SwarmTurnType, string> = {
  OPENING:
    "Provide your OPENING stance on the problem. State your recommended approach in 4-8 sentences. Cite any concrete evidence (files, symbols, prior artifacts) you rely on. Do not vote yet.",
  REBUTTAL:
    "You have seen the opening stances of the other participants. Respond with your REBUTTAL: where do you agree, where do you disagree, and what specific change would you make to their plan? Keep it focused — 4-8 sentences.",
  SYNTHESIS:
    "You are the LEAD participant. Synthesize a single unified plan from the debate so far. Output sections:\n  1. Summary (2-3 sentences)\n  2. Steps (numbered, each with a title and detail)\n  3. Risks (bulleted)\n  4. Alternatives considered (bulleted)\nDo NOT vote; the non-lead participants will vote next.",
  VOTE:
    `Review the synthesized plan. You MUST respond with a single JSON object matching this schema and NOTHING else (no prose, no code fences, no preamble):\n\n${JSON.stringify(SWARM_VOTE_TOOL_SCHEMA, null, 2)}\n\nExample:\n{"decision": "APPROVE", "rationale": "Plan addresses my concerns about error handling."}`,
};

const describeTurn = (turn: CapabilityChatMessage): string => {
  const label = turn.swarmTurnType || 'TURN';
  const agent = turn.agentName || turn.agentId || 'unknown';
  const from = turn.sourceCapabilityId
    ? ` (from capability ${turn.sourceCapabilityId})`
    : '';
  return `### [${label}] ${agent}${from}\n${turn.content.trim()}`;
};

export const buildSwarmPromptLayers = (
  args: SwarmPromptLayerArgs,
): SwarmPromptLayers => {
  const {
    anchorBundle,
    participantBundle,
    participantAgentId,
    anchorMemoryPrompt,
    homeMemoryPrompt,
    turnType,
    initiatingPrompt,
    priorTurns,
    sharedEvidence,
  } = args;

  const anchorAgent = anchorBundle.workspace.agents[0]; // just for framing
  const participantAgent =
    participantBundle.workspace.agents.find(a => a.id === participantAgentId) ||
    participantBundle.workspace.agents[0];

  const anchorSystem = buildCapabilitySystemPrompt({
    capability: anchorBundle.capability,
    agent: anchorAgent,
  });
  const participantSystem = buildCapabilitySystemPrompt({
    capability: participantBundle.capability,
    agent: participantAgent,
  });

  const priorTranscript = priorTurns.map(describeTurn).join('\n\n');

  // Shared block — context every participant sees identically.
  const sharedFragments: BudgetFragment[] = [
    {
      source: 'SYSTEM_CORE',
      text:
        `You are participating in a Swarm Debate anchored on capability "${anchorBundle.capability.name}". ` +
        `The goal is to converge on an EXECUTION_PLAN through OPENING → REBUTTAL → SYNTHESIS → VOTE.`,
      estimatedTokens: 64,
    },
    {
      source: 'DEVELOPER_PROMPT',
      text: anchorSystem,
      estimatedTokens: estimateTokens(anchorSystem),
    },
    {
      source: 'WORK_ITEM_BRIEFING',
      text: `Initiating prompt:\n${initiatingPrompt.trim()}`,
      estimatedTokens: estimateTokens(initiatingPrompt),
    },
    sharedEvidence
      ? {
          source: 'CODE_HUNKS',
          text: `Shared evidence:\n${sharedEvidence.trim()}`,
          estimatedTokens: estimateTokens(sharedEvidence),
        }
      : null,
    anchorMemoryPrompt
      ? {
          source: 'SWARM_SHARED_MEMORY',
          text: `Anchor-capability memory hits:\n${anchorMemoryPrompt.trim()}`,
          estimatedTokens: estimateTokens(anchorMemoryPrompt),
        }
      : null,
    priorTranscript
      ? {
          source: 'CONVERSATION_HISTORY',
          text: `Debate so far:\n\n${priorTranscript}`,
          estimatedTokens: estimateTokens(priorTranscript),
        }
      : null,
  ].filter((f): f is BudgetFragment => f != null);

  const sharedAssembly = buildBudgetedPrompt({
    fragments: sharedFragments,
    maxInputTokens: 28_000,
    reservedOutputTokens: 4_000,
  });

  // Home block — participant-specific framing.
  const homeFragments: BudgetFragment[] = [
    {
      source: 'SYSTEM_CORE',
      text: `Your home capability: "${participantBundle.capability.name}". Speak from this perspective.`,
      estimatedTokens: 32,
    },
    {
      source: 'DEVELOPER_PROMPT',
      text: participantSystem,
      estimatedTokens: estimateTokens(participantSystem),
    },
    homeMemoryPrompt
      ? {
          source: 'SWARM_HOME_MEMORY',
          text: `Home-capability memory hits:\n${homeMemoryPrompt.trim()}`,
          estimatedTokens: estimateTokens(homeMemoryPrompt),
        }
      : null,
  ].filter((f): f is BudgetFragment => f != null);

  const homeAssembly = buildBudgetedPrompt({
    fragments: homeFragments,
    maxInputTokens: 12_000,
    reservedOutputTokens: 2_000,
  });

  const instruction = TURN_INSTRUCTIONS[turnType];
  const userMessage =
    `Turn type: ${turnType}\n\n${instruction}\n\nRespond as: ${
      participantAgent?.name || participantAgent?.id || 'Agent'
    }`;

  return {
    sharedBlock: sharedAssembly.assembled,
    homeBlock: homeAssembly.assembled,
    userMessage,
    sharedReceipt: sharedAssembly.receipt,
    homeReceipt: homeAssembly.receipt,
    estimatedInputTokens:
      sharedAssembly.receipt.totalEstimatedTokens +
      homeAssembly.receipt.totalEstimatedTokens +
      estimateTokens(userMessage),
  };
};

// ─── Turn execution ──────────────────────────────────────────────────────────

interface RunTurnArgs {
  sessionId: string;
  capabilityId: string;
  sessionScope: SwarmSessionDetail['session']['sessionScope'];
  sessionScopeId?: string;
  workItemId?: string;
  participant: SwarmParticipant;
  anchorBundle: CapabilityBundle;
  participantBundle: CapabilityBundle;
  turnType: SwarmTurnType;
  initiatingPrompt: string;
  priorTurns: CapabilityChatMessage[];
  sharedEvidence?: string;
  anchorMemoryPrompt?: string;
  homeMemoryPrompt?: string;
  traceId?: string;
}

interface TurnResult {
  turn: CapabilityChatMessage;
  tokensUsed: number;
  voteParsed?: SwarmVoteInput;
  rawContent: string;
}

const runTurn = async (args: RunTurnArgs): Promise<TurnResult> => {
  const {
    sessionId,
    capabilityId,
    sessionScope,
    sessionScopeId,
    workItemId,
    participant,
    anchorBundle,
    participantBundle,
    turnType,
    priorTurns,
    traceId,
  } = args;

  const layers = buildSwarmPromptLayers({
    anchorBundle,
    participantBundle,
    participantAgentId: participant.participantAgentId,
    anchorMemoryPrompt: args.anchorMemoryPrompt,
    homeMemoryPrompt: args.homeMemoryPrompt,
    turnType,
    initiatingPrompt: args.initiatingPrompt,
    priorTurns,
    sharedEvidence: args.sharedEvidence,
  });

  const participantAgent =
    participantBundle.workspace.agents.find(
      a => a.id === participant.participantAgentId,
    ) || participantBundle.workspace.agents[0];

  if (!participantAgent) {
    throw new Error(
      `Participant agent ${participant.participantAgentId} not found in capability ${participant.participantCapabilityId}.`,
    );
  }

  // Merge the two prompt layers into the single `developerPrompt` slot the
  // standard chat helper exposes. The shared block goes first so every
  // participant's recollection of the debate anchors to the same framing;
  // the home block differs per participant.
  const developerPrompt = [layers.sharedBlock, layers.homeBlock]
    .filter(Boolean)
    .join('\n\n---\n\n');

  // VOTE turns use native tool-call mode on providers that support it
  // (GitHub Models HTTP and local-OpenAI). The Copilot session SDK does not
  // expose tool-choice; those calls automatically fall back to the HTTP path
  // or the forced-JSON text extractor (`extractVoteJson`) in the result
  // handling below.
  const isVoteTurn = turnType === 'VOTE';
  const chatResult = await invokeCapabilityChat({
    capability: participantBundle.capability,
    agent: participantAgent,
    history: [],
    message: layers.userMessage,
    developerPrompt,
    scope: sessionScope,
    scopeId: sessionScopeId || workItemId || sessionId,
    resetSession: true,
    ...(isVoteTurn
      ? {
          tools: [
            {
              type: 'function' as const,
              function: {
                name: swarmVoteTool.name,
                description: swarmVoteTool.description,
                parameters: swarmVoteTool.input_schema as Record<string, unknown>,
              },
            },
          ],
          tool_choice: { type: 'function' as const, function: { name: SWARM_VOTE_TOOL_NAME } },
        }
      : {}),
  });

  const rawContent =
    (chatResult as any).message ||
    (chatResult as any).content ||
    (chatResult as any).text ||
    '';

  const text = String(rawContent).trim();

  let voteParsed: SwarmVoteInput | undefined;
  if (turnType === 'VOTE') {
    voteParsed = extractVoteJson(text);
  }

  const displayContent =
    turnType === 'VOTE' && voteParsed
      ? `[${voteParsed.decision}] ${voteParsed.rationale}`
      : text;

  const turn = await appendSwarmTranscriptTurn({
    capabilityId,
    sessionId,
    turnType,
    sessionScope,
    sessionScopeId,
    sourceCapabilityId: participant.participantCapabilityId,
    agentId: participantAgent.id,
    agentName: participantAgent.name,
    content: displayContent,
    model: participantAgent.model || undefined,
    traceId,
    workItemId,
  });

  // Token accounting — prefer actual usage when the provider returns it,
  // otherwise fall back to the prompt-layer estimate plus an output estimate.
  const providerUsage = (chatResult as any).usage || {};
  const tokensUsed =
    Number(providerUsage.totalTokens) ||
    layers.estimatedInputTokens + estimateTokens(text);

  publishSwarmStreamEvent(sessionId, {
    kind: 'turn',
    sessionId,
    turn,
  });

  return { turn, tokensUsed, voteParsed, rawContent: text };
};

/**
 * Best-effort JSON extractor for vote turns. Accepts the raw model output,
 * strips markdown fences, and feeds it into `parseSwarmVotePayload` which
 * gracefully degrades malformed input to a tagged OBJECT vote.
 */
const extractVoteJson = (raw: string): SwarmVoteInput => {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const startIdx = stripped.indexOf('{');
  const endIdx = stripped.lastIndexOf('}');
  if (startIdx < 0 || endIdx < 0) {
    return parseSwarmVotePayload(null);
  }
  const candidate = stripped.slice(startIdx, endIdx + 1);
  try {
    const parsed = JSON.parse(candidate);
    return parseSwarmVotePayload(parsed);
  } catch {
    return parseSwarmVotePayload({ decision: 'OBJECT', rationale: stripped });
  }
};

// ─── Artifact assembly ───────────────────────────────────────────────────────

interface SynthesisParseResult {
  summary: string;
  steps: ExecutionPlanArtifactPayload['steps'];
  risks: string[];
  alternatives: string[];
}

/**
 * Extract a structured plan out of the lead's SYNTHESIS turn. We ask the
 * model for a predictable layout (Summary / Steps / Risks / Alternatives) but
 * don't punish minor formatting drift — if a section is missing we leave it
 * empty and let the artifact render whatever is available.
 */
const parseSynthesis = (text: string): SynthesisParseResult => {
  const sections = splitSections(text);
  const steps: ExecutionPlanArtifactPayload['steps'] = (sections.steps ?? '')
    .split(/\n(?=\s*\d+[.)]\s+)/)
    .map(line => line.replace(/^\s*\d+[.)]\s+/, '').trim())
    .filter(Boolean)
    .map((raw, index) => {
      const [titleLine, ...rest] = raw.split('\n');
      return {
        id: `step-${index + 1}`,
        title: titleLine.replace(/^(?:title:|\*+)\s*/i, '').trim(),
        detail: rest.join('\n').trim() || titleLine.trim(),
      };
    });

  const risks = bulletLines(sections.risks);
  const alternatives = bulletLines(sections.alternatives);

  return {
    summary: (sections.summary || '').trim(),
    steps,
    risks,
    alternatives,
  };
};

const splitSections = (text: string) => {
  const lower = text.toLowerCase();
  const grabbed: Record<'summary' | 'steps' | 'risks' | 'alternatives', string> = {
    summary: '',
    steps: '',
    risks: '',
    alternatives: '',
  };
  const markers: Array<{ key: keyof typeof grabbed; rx: RegExp }> = [
    { key: 'summary', rx: /(?:^|\n)\s*(?:\d+\.\s*)?summary[:\s]/i },
    { key: 'steps', rx: /(?:^|\n)\s*(?:\d+\.\s*)?steps?[:\s]/i },
    { key: 'risks', rx: /(?:^|\n)\s*(?:\d+\.\s*)?risks?[:\s]/i },
    { key: 'alternatives', rx: /(?:^|\n)\s*(?:\d+\.\s*)?alternatives?(?:\s+considered)?[:\s]/i },
  ];
  const offsets = markers
    .map(m => ({ key: m.key, idx: lower.search(m.rx) }))
    .filter(e => e.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  if (offsets.length === 0) {
    grabbed.summary = text.trim();
    return grabbed;
  }

  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i].idx;
    const end = i + 1 < offsets.length ? offsets[i + 1].idx : text.length;
    const block = text.slice(start, end);
    const cleaned = block.replace(markers.find(m => m.key === offsets[i].key)!.rx, '').trim();
    grabbed[offsets[i].key] = cleaned;
  }
  return grabbed;
};

const bulletLines = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split('\n')
    .map(line => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
};

const buildExecutionPlanPayload = (
  session: SwarmSessionDetail,
  synthesis: SynthesisParseResult,
): ExecutionPlanArtifactPayload => ({
  swarmSessionId: session.session.id,
  participants: session.participants.map(p => ({
    capabilityId: p.participantCapabilityId,
    agentId: p.participantAgentId,
    role: p.participantRole,
  })),
  steps: synthesis.steps.length > 0
    ? synthesis.steps
    : [{ id: 'step-1', title: 'Proceed per plan summary', detail: synthesis.summary || 'See summary.' }],
  rationale: synthesis.summary || 'Consensus reached.',
  risks: synthesis.risks,
  alternativesConsidered: synthesis.alternatives,
});

const buildDisagreementPayload = (
  session: SwarmSessionDetail,
  terminalReason: Extract<SwarmTerminalReason, 'NO_CONSENSUS' | 'BUDGET_EXHAUSTED'>,
  blockers: string[],
): DisagreementSummaryArtifactPayload => ({
  swarmSessionId: session.session.id,
  terminalReason,
  participants: session.participants.map(p => ({
    capabilityId: p.participantCapabilityId,
    agentId: p.participantAgentId,
    role: p.participantRole,
  })),
  positions: session.participants.map(p => ({
    agentId: p.participantAgentId,
    stance:
      session.transcript
        .filter(
          t =>
            t.agentId === p.participantAgentId && t.swarmTurnType === 'OPENING',
        )
        .map(t => t.content)
        .join('\n') || 'No stance recorded.',
    vote: p.lastVote,
    rationale: p.voteRationale,
  })),
  blockers,
});

// ─── Orchestrator entry point ────────────────────────────────────────────────

export interface RunSwarmDebateOptions {
  capabilityId: string;
  sessionId: string;
  traceId?: string;
  /**
   * Optional externally cancellable handle — when resolved, the turn loop
   * stops before launching the next turn and transitions the session to
   * CANCELLED.
   */
  cancelled?: () => boolean;
}

export interface SwarmDebateOutcome {
  status: SwarmSessionDetail['session']['status'];
  terminalReason: SwarmTerminalReason;
  producedArtifactId?: string;
}

/**
 * Drive a swarm session from its PENDING state to a terminal state. Emits
 * SSE turn events along the way and writes every turn (and the final
 * artifact) to the database.
 *
 * Contract:
 *   - Expects the session row + participants to already exist (created via
 *     `createSwarmSession`).
 *   - Never mutates rows outside its own session.
 *   - Safe to call from an HTTP handler after the handler has sent 202
 *     Accepted; callers should `.catch(logError)` to surface fatals.
 */
export const runSwarmDebate = async (
  options: RunSwarmDebateOptions,
): Promise<SwarmDebateOutcome> => {
  const { capabilityId, sessionId, traceId, cancelled } = options;

  let session = await loadSwarmSessionDetail(capabilityId, sessionId);

  const anchorBundle = await getSwarmBundle(capabilityId);
  const participantBundles = await Promise.all(
    session.participants.map(p =>
      getSwarmBundle(p.participantCapabilityId).then(bundle => ({ p, bundle })),
    ),
  );
  const bundleByParticipantId = new Map(
    participantBundles.map(entry => [entry.p.id, entry.bundle]),
  );

  // Resolve memory slices once per participant (query = initiating prompt).
  const memoryByParticipantId = new Map<
    string,
    { anchor?: string; home?: string }
  >();
  await Promise.all(
    session.participants.map(async participant => {
      const [anchorHits, homeHits] = await Promise.all([
        buildMemoryContext({
          capabilityId,
          agentId: participant.participantAgentId,
          queryText: session.session.initiatingPrompt,
          limit: 4,
        }).catch(() => null),
        buildMemoryContext({
          capabilityId: participant.participantCapabilityId,
          agentId: participant.participantAgentId,
          queryText: session.session.initiatingPrompt,
          limit: 4,
        }).catch(() => null),
      ]);
      memoryByParticipantId.set(participant.id, {
        anchor: anchorHits?.prompt || undefined,
        home: homeHits?.prompt || undefined,
      });
    }),
  );

  await updateSwarmSessionStatus({
    capabilityId,
    sessionId,
    status: 'RUNNING',
  });
  publishSwarmStreamEvent(sessionId, {
    kind: 'status',
    sessionId,
    status: 'RUNNING',
  });

  const earlyExit = (reason: SwarmTerminalReason) =>
    terminate({
      capabilityId,
      sessionId,
      session,
      reason,
    });

  const projectNextTurn = (estimated: number) =>
    session.session.tokenBudgetUsed + estimated >
    session.session.maxTokenBudget;

  // Helper to run a turn-kind across a list of participants in parallel.
  const runParallelTurns = async (
    participants: SwarmParticipant[],
    turnType: SwarmTurnType,
  ): Promise<TurnResult[]> => {
    const priorTurns = (await loadSwarmSessionDetail(capabilityId, sessionId))
      .transcript;
    const results = await Promise.all(
      participants.map(participant => {
        const participantBundle = bundleByParticipantId.get(participant.id)!;
        const memory = memoryByParticipantId.get(participant.id) || {};
        return runTurn({
          sessionId,
          capabilityId,
          sessionScope: session.session.sessionScope,
          sessionScopeId:
            session.session.sessionScope === 'GENERAL_CHAT'
              ? capabilityId
              : session.session.workItemId,
          workItemId: session.session.workItemId,
          participant,
          anchorBundle,
          participantBundle,
          turnType,
          initiatingPrompt: session.session.initiatingPrompt,
          priorTurns,
          anchorMemoryPrompt: memory.anchor,
          homeMemoryPrompt: memory.home,
          traceId,
        });
      }),
    );

    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
    session.session = await incrementSwarmTokenBudget({
      capabilityId,
      sessionId,
      tokensAdded: totalTokens,
    });
    session = await loadSwarmSessionDetail(capabilityId, sessionId);
    return results;
  };

  // 1. OPENING
  if (cancelled?.()) return earlyExit('CANCELLED');
  if (projectNextTurn(4_000 * session.participants.length)) {
    return earlyExit('BUDGET_EXHAUSTED');
  }
  await runParallelTurns(session.participants, 'OPENING');

  // 2. REBUTTAL
  if (cancelled?.()) return earlyExit('CANCELLED');
  if (projectNextTurn(4_000 * session.participants.length)) {
    return earlyExit('BUDGET_EXHAUSTED');
  }
  await runParallelTurns(session.participants, 'REBUTTAL');

  // 3. SYNTHESIS (lead only)
  const leadParticipant =
    session.participants.find(p => p.participantRole === 'LEAD') ||
    session.participants[0];
  if (!leadParticipant) {
    return earlyExit('NO_CONSENSUS');
  }

  if (cancelled?.()) return earlyExit('CANCELLED');
  if (projectNextTurn(6_000)) {
    return earlyExit('BUDGET_EXHAUSTED');
  }
  const synthesisResults = await runParallelTurns([leadParticipant], 'SYNTHESIS');
  const synthesisRaw = synthesisResults[0]?.rawContent || '';

  // 4. VOTE (non-lead participants)
  const voters = session.participants.filter(p => p.id !== leadParticipant.id);
  if (voters.length === 0) {
    // Single-agent swarm isn't routed to the orchestrator, but guard anyway.
    return earlyExit('NO_CONSENSUS');
  }

  if (cancelled?.()) return earlyExit('CANCELLED');
  if (projectNextTurn(1_500 * voters.length)) {
    return earlyExit('BUDGET_EXHAUSTED');
  }
  const voteResults = await runParallelTurns(voters, 'VOTE');

  const votesById = new Map<string, SwarmVoteInput>();
  await Promise.all(
    voteResults.map((result, index) => {
      const voter = voters[index];
      const vote = result.voteParsed ?? {
        decision: 'OBJECT' as SwarmVote,
        rationale: 'Vote payload missing.',
      };
      votesById.set(voter.id, vote);
      return recordSwarmParticipantVote({
        capabilityId,
        sessionId,
        participantId: voter.id,
        vote: vote.decision,
        rationale: vote.rationale,
      });
    }),
  );

  session = await loadSwarmSessionDetail(capabilityId, sessionId);

  const allApprove = Array.from(votesById.values()).every(
    v => v.decision === 'APPROVE',
  );

  if (allApprove) {
    const synthesis = parseSynthesis(synthesisRaw);
    const payload = buildExecutionPlanPayload(session, synthesis);
    const artifactId = await writeSwarmArtifact({
      capabilityId,
      sessionId,
      kind: 'EXECUTION_PLAN',
      name: `Swarm plan — ${anchorBundle.capability.name}`,
      description:
        synthesis.summary ||
        'Execution plan synthesized by swarm debate.',
      payload,
      agentName:
        session.participants
          .map(p => p.participantAgentId)
          .join(', ') || 'swarm',
      workItemId: session.session.workItemId,
      traceId,
    });

    await updateSwarmSessionStatus({
      capabilityId,
      sessionId,
      status: 'AWAITING_REVIEW',
      terminalReason: 'CONSENSUS',
    });

    publishSwarmStreamEvent(sessionId, {
      kind: 'terminal',
      sessionId,
      status: 'AWAITING_REVIEW',
      terminalReason: 'CONSENSUS',
      artifactId,
    });

    return {
      status: 'AWAITING_REVIEW',
      terminalReason: 'CONSENSUS',
      producedArtifactId: artifactId,
    };
  }

  // Objection path
  const blockers = Array.from(votesById.values())
    .filter(v => v.decision === 'OBJECT')
    .map(v => v.rationale);
  const payload = buildDisagreementPayload(session, 'NO_CONSENSUS', blockers);
  const artifactId = await writeSwarmArtifact({
    capabilityId,
    sessionId,
    kind: 'DISAGREEMENT_SUMMARY',
    name: `Swarm disagreement — ${anchorBundle.capability.name}`,
    description: 'Swarm debate ended without consensus.',
    payload,
    agentName: 'swarm',
    workItemId: session.session.workItemId,
    traceId,
  });

  await updateSwarmSessionStatus({
    capabilityId,
    sessionId,
    status: 'NO_CONSENSUS',
    terminalReason: 'NO_CONSENSUS',
    completed: true,
  });

  publishSwarmStreamEvent(sessionId, {
    kind: 'terminal',
    sessionId,
    status: 'NO_CONSENSUS',
    terminalReason: 'NO_CONSENSUS',
    artifactId,
  });

  return {
    status: 'NO_CONSENSUS',
    terminalReason: 'NO_CONSENSUS',
    producedArtifactId: artifactId,
  };
};

const terminate = async (args: {
  capabilityId: string;
  sessionId: string;
  session: SwarmSessionDetail;
  reason: SwarmTerminalReason;
}): Promise<SwarmDebateOutcome> => {
  let status: SwarmSessionDetail['session']['status'];
  let artifactId: string | undefined;

  if (args.reason === 'CANCELLED') {
    status = 'CANCELLED';
  } else if (args.reason === 'BUDGET_EXHAUSTED') {
    status = 'BUDGET_EXHAUSTED';
    artifactId = await writeSwarmArtifact({
      capabilityId: args.capabilityId,
      sessionId: args.sessionId,
      kind: 'DISAGREEMENT_SUMMARY',
      name: `Swarm budget exhausted — ${args.session.session.id}`,
      description: 'Swarm debate halted before consensus — token budget exhausted.',
      payload: buildDisagreementPayload(args.session, 'BUDGET_EXHAUSTED', [
        'Token budget exhausted before vote.',
      ]),
      agentName: 'swarm',
      workItemId: args.session.session.workItemId,
    });
  } else {
    // NO_CONSENSUS fallback reachable from SYNTHESIS guard etc.
    status = 'NO_CONSENSUS';
    artifactId = await writeSwarmArtifact({
      capabilityId: args.capabilityId,
      sessionId: args.sessionId,
      kind: 'DISAGREEMENT_SUMMARY',
      name: `Swarm no-consensus — ${args.session.session.id}`,
      description: 'Swarm debate ended without consensus.',
      payload: buildDisagreementPayload(args.session, 'NO_CONSENSUS', [
        'Debate terminated before vote.',
      ]),
      agentName: 'swarm',
      workItemId: args.session.session.workItemId,
    });
  }

  await updateSwarmSessionStatus({
    capabilityId: args.capabilityId,
    sessionId: args.sessionId,
    status,
    terminalReason: args.reason,
    completed: true,
  });

  publishSwarmStreamEvent(args.sessionId, {
    kind: 'terminal',
    sessionId: args.sessionId,
    status,
    terminalReason: args.reason,
    artifactId,
  });

  return {
    status,
    terminalReason: args.reason,
    producedArtifactId: artifactId,
  };
};

/** Re-export vote tool metadata so route handlers can include it in kickoff responses. */
export const SWARM_VOTE_TOOL_META = {
  name: SWARM_VOTE_TOOL_NAME,
  schema: SWARM_VOTE_TOOL_SCHEMA,
};
