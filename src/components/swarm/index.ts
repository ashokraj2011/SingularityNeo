/**
 * Barrel for shared swarm-debate UI primitives.
 *
 * The AssistantDock and the OrchestratorCopilotDock both tag agents with a
 * mention picker, render a composer ribbon when 2–3 agents are tagged, and
 * replace the message transcript with `SwarmTranscript` once a swarm session
 * is active. Keeping those pieces here (rather than duplicating per dock)
 * makes it straightforward to add a third surface later without drift.
 */
export { SwarmMentionPicker } from './SwarmMentionPicker';
export type { TaggedParticipant } from './SwarmMentionPicker';
export { SwarmComposerRibbon } from './SwarmComposerRibbon';
export { SwarmTranscript } from './SwarmTranscript';
export { SwarmReviewCard } from './SwarmReviewCard';
export { useSwarmSession } from './useSwarmSession';
export type { UseSwarmSessionResult } from './useSwarmSession';
