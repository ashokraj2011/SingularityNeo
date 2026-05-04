/**
 * Sentinel-based stage-completion detection for the Workflow Orchestrator
 * page.
 *
 * The page injects a system-prompt instruction telling the agent to end its
 * reply with `<<STAGE_COMPLETE>>` (optionally followed by a JSON payload
 * such as `<<STAGE_COMPLETE: {"summary":"…"}>>`) when the stage's objective
 * is fully met.  This module:
 *
 *   1. Detects whether the sentinel is present in the agent's final reply
 *      (case-insensitive, ignoring sentinels that occur inside fenced code
 *      blocks so the agent can quote examples without triggering an
 *      accidental advance).
 *   2. Strips the sentinel from the rendered message so the user only sees
 *      clean prose.
 *   3. Surfaces an optional structured payload (for future enrichment).
 */

// Captures the optional JSON suffix as ANY characters (non-greedy) up to the
// closing `>>`, so a malformed suffix still triggers detection — only payload
// parsing falls through to null.
const SENTINEL_REGEX = /<<\s*STAGE_COMPLETE\s*(?::\s*([^>]*?))?\s*>>/gi;
const FENCED_CODE_REGEX = /```[\s\S]*?```/g;
const INLINE_CODE_REGEX = /`[^`\n]*`/g;

export interface StageCompleteDetection {
  /** True when at least one sentinel is present outside of code fences. */
  detected: boolean;
  /** The first parsed JSON payload (if any), e.g. `{ summary: "…" }`. */
  payload: Record<string, unknown> | null;
  /** The original content with all sentinels (incl. JSON suffix) stripped. */
  cleanedContent: string;
}

/**
 * Strip fenced + inline code blocks from `content` so we don't get false
 * positives when the agent quotes the sentinel as an example.  Replaced with
 * spaces of equal length so character offsets stay consistent for any
 * downstream slicing logic — handy for tests.
 */
const maskCodeRegions = (content: string): string =>
  content
    .replace(FENCED_CODE_REGEX, (block) => " ".repeat(block.length))
    .replace(INLINE_CODE_REGEX, (block) => " ".repeat(block.length));

export const detectStageComplete = (content: string): StageCompleteDetection => {
  const safeContent = String(content ?? "");
  const masked = maskCodeRegions(safeContent);

  // Reset regex state between invocations (regex has /g flag).
  SENTINEL_REGEX.lastIndex = 0;
  const firstMatch = SENTINEL_REGEX.exec(masked);

  if (!firstMatch) {
    return { detected: false, payload: null, cleanedContent: safeContent };
  }

  let payload: Record<string, unknown> | null = null;
  const jsonText = firstMatch[1];
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed JSON suffix — still treat sentinel as a valid completion
      // signal, just without a payload.
      payload = null;
    }
  }

  // Strip every sentinel occurrence (including the JSON suffix) from the
  // ORIGINAL content, not the masked one.  Trailing newlines left behind by
  // the strip are collapsed.
  SENTINEL_REGEX.lastIndex = 0;
  const cleanedContent = safeContent
    .replace(SENTINEL_REGEX, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  return { detected: true, payload, cleanedContent };
};

/**
 * Strip the sentinel from a *user* message before sending to the agent.
 * Defensive: stops a malicious or curious user from triggering auto-advance
 * by typing the token into the composer.
 */
export const stripStageCompleteSentinel = (content: string): string =>
  String(content ?? "").replace(SENTINEL_REGEX, "").trimEnd();

/**
 * The system-prompt suffix the page prepends to the first user turn of each
 * stage so the agent knows when (and how) to signal completion.
 */
export const STAGE_COMPLETE_INSTRUCTION = [
  "When this stage's objective is fully met, end your message with the",
  "literal token <<STAGE_COMPLETE>> on its own line.  Do NOT emit it",
  "otherwise.  Optionally include a JSON summary like",
  "<<STAGE_COMPLETE: {\"summary\":\"one-line recap\"}>> if helpful.",
].join(" ");
