/**
 * Local types for the Work Item Cockpit.
 * All external types are imported from src/types.ts or src/lib/api.ts.
 */

import type {
  Artifact,
  CapabilityChatMessage,
  LedgerArtifactRecord,
  RunWait,
  ToolInvocation,
  WorkflowRunStep,
} from "../../types";

// ── UI modes ──────────────────────────────────────────────────────────────────

export type RightPanelMode =
  | "NOW"
  | "ARTIFACT"
  | "APPROVAL"
  | "GUIDANCE";

export type TimelineFilter =
  | "ALL"
  | "CHAT"
  | "AGENTS"
  | "TOOLS"
  | "ARTIFACTS"
  | "APPROVALS"
  | "ERRORS";

export type CockpitStatus =
  | "IDLE"
  | "LOADING"
  | "READY"
  | "STREAMING"
  | "SUBMITTING"
  | "ERROR";

// ── Normalised timeline item ──────────────────────────────────────────────────

export type CockpitTimelineItem =
  | { kind: "STEP"; ts: string; step: WorkflowRunStep }
  | { kind: "WAIT"; ts: string; wait: RunWait }
  | { kind: "TOOL"; ts: string; tool: ToolInvocation }
  | { kind: "ARTIFACT"; ts: string; record: LedgerArtifactRecord }
  | { kind: "MESSAGE"; ts: string; message: CapabilityChatMessage };

// ── Guidance (Phase 4 stub — composer uses this) ──────────────────────────────

export type GuidanceIntent =
  | "CLARIFY_REQUIREMENT"
  | "ADD_CONSTRAINT"
  | "CHANGE_DIRECTION"
  | "REQUEST_EVIDENCE"
  | "ASK_AGENT_TO_EXPLAIN"
  | "OVERRIDE_NEXT_STEP"
  | "STOP_AND_WAIT"
  | "RESTART_FROM_PHASE";

export interface GuidanceDraft {
  intent: GuidanceIntent;
  instruction: string;
  constraints: string;
  targetAgentId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export const GUIDANCE_INTENT_LABELS: Record<GuidanceIntent, string> = {
  CLARIFY_REQUIREMENT: "Clarify requirement",
  ADD_CONSTRAINT: "Add constraint",
  CHANGE_DIRECTION: "Change direction",
  REQUEST_EVIDENCE: "Request evidence",
  ASK_AGENT_TO_EXPLAIN: "Ask agent to explain",
  OVERRIDE_NEXT_STEP: "Override next step",
  STOP_AND_WAIT: "Stop and wait",
  RESTART_FROM_PHASE: "Restart from phase",
};

export const TIMELINE_FILTER_LABELS: Record<TimelineFilter, string> = {
  ALL: "All",
  CHAT: "Chat",
  AGENTS: "Agents",
  TOOLS: "Tools",
  ARTIFACTS: "Artifacts",
  APPROVALS: "Approvals",
  ERRORS: "Errors",
};

export const itemMatchesFilter = (
  item: CockpitTimelineItem,
  filter: TimelineFilter,
): boolean => {
  if (filter === "ALL") return true;
  if (filter === "CHAT") return item.kind === "MESSAGE";
  if (filter === "AGENTS") return item.kind === "STEP";
  if (filter === "TOOLS") return item.kind === "TOOL";
  if (filter === "ARTIFACTS") return item.kind === "ARTIFACT";
  if (filter === "APPROVALS")
    return item.kind === "WAIT" && item.wait.type === "APPROVAL";
  if (filter === "ERRORS") {
    if (item.kind === "STEP") return item.step.status === "FAILED";
    if (item.kind === "TOOL")
      return (
        item.tool.status === "FAILED" || item.tool.status === "CANCELLED"
      );
    return false;
  }
  return true;
};

export const normalizeTimeline = (
  steps: WorkflowRunStep[],
  waits: RunWait[],
  tools: ToolInvocation[],
  records: LedgerArtifactRecord[],
  messages: CapabilityChatMessage[],
): CockpitTimelineItem[] => {
  const items: CockpitTimelineItem[] = [
    ...steps.map(
      (s): CockpitTimelineItem => ({
        kind: "STEP",
        ts: s.startedAt || s.completedAt || new Date(0).toISOString(),
        step: s,
      }),
    ),
    ...waits.map(
      (w): CockpitTimelineItem => ({
        kind: "WAIT",
        ts: w.createdAt,
        wait: w,
      }),
    ),
    ...tools.map(
      (t): CockpitTimelineItem => ({
        kind: "TOOL",
        ts: t.startedAt || t.createdAt,
        tool: t,
      }),
    ),
    ...records.map(
      (r): CockpitTimelineItem => ({
        kind: "ARTIFACT",
        ts: r.artifact.created,
        record: r,
      }),
    ),
    ...messages.map(
      (m): CockpitTimelineItem => ({
        kind: "MESSAGE",
        ts: m.timestamp || new Date(0).toISOString(),
        message: m,
      }),
    ),
  ];
  return items.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
};

export const getArtifactFromRecord = (r: LedgerArtifactRecord): Artifact =>
  r.artifact;
