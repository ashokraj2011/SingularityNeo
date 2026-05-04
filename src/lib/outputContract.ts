/**
 * Output-contract audit.
 *
 * A workflow step's `artifactContract.expectedOutputs` is a list of
 * artifact names the step is expected to produce. The system stores the
 * agent's full response in a single PHASE_OUTPUT artifact rather than
 * splitting it into N named artifacts, so the contract is enforced at
 * the section level: the agent is asked to emit a top-level Markdown
 * section per expected output (e.g. `## Planning Report`), and we audit
 * the response for those headings after the step completes.
 *
 * Used in three places:
 *   1. server/execution/service.ts — append a contract instruction to
 *      the step prompt so the agent knows the format requirement.
 *   2. server/execution/service.ts — after the step completes, audit
 *      the response and emit a run event when sections are missing.
 *   3. src/lib/workflowRuntime.ts — set per-output status (READY /
 *      MISSING) on the artifact checklist by running the same audit
 *      against the PHASE_OUTPUT artifact's contentText.
 *
 * Heuristics:
 *   - Match `# <Name>` or `## <Name>` (any heading depth 1–6) at line
 *     start, case-insensitive, allowing trailing punctuation/whitespace.
 *   - Compare slugified label vs slugified heading text — tolerates
 *     punctuation drift (e.g. "Planning Report" matches "Planning
 *     Report:" or "## planning  report").
 *   - Headings inside fenced code blocks (```) are ignored.
 */

const slugifyHeading = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    // strip diacritics
    .replace(/\p{M}/gu, "")
    // Collapse anything that isn't a-z0-9 to whitespace
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Strip fenced code blocks (``` … ```) from markdown. Inside a fence,
 * `## foo` is example syntax, not a real heading.
 */
const stripFencedCode = (markdown: string): string =>
  markdown.replace(/```[\s\S]*?```/g, "");

const HEADING_LINE_PATTERN = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm;

/**
 * Extract all top-level Markdown headings from `text`, slugified.
 *
 * Returns an ordered list of unique slugs (preserves first-seen order).
 */
export const extractHeadingSlugs = (text: string): string[] => {
  const stripped = stripFencedCode(text || "");
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const match of stripped.matchAll(HEADING_LINE_PATTERN)) {
    const slug = slugifyHeading(match[1]);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }
  return slugs;
};

export interface OutputContractAuditResult {
  /** Expected labels that DID appear as a heading. */
  present: string[];
  /** Expected labels that are still missing. */
  missing: string[];
  /** True when no expectations were declared (audit no-op). */
  vacuous: boolean;
}

/**
 * Match a list of expected output labels against the headings present
 * in `responseText`. Slug comparison so case / punctuation drift is
 * tolerated.
 */
export const auditOutputContractSections = (
  responseText: string,
  expectedOutputs: string[],
): OutputContractAuditResult => {
  const labels = (expectedOutputs || [])
    .map((label) => label?.trim())
    .filter((label): label is string => Boolean(label));

  if (labels.length === 0) {
    return { present: [], missing: [], vacuous: true };
  }

  const headingSlugs = new Set(extractHeadingSlugs(responseText || ""));
  const present: string[] = [];
  const missing: string[] = [];
  for (const label of labels) {
    const labelSlug = slugifyHeading(label);
    if (labelSlug && headingSlugs.has(labelSlug)) {
      present.push(label);
    } else {
      missing.push(label);
    }
  }
  return { present, missing, vacuous: false };
};

/**
 * Build the system-prompt fragment that tells the agent which top-level
 * Markdown sections its final response must contain. Returns an empty
 * string when no expectations are declared (so the prompt isn't
 * polluted with empty boilerplate).
 */
export const buildOutputContractInstruction = (
  expectedOutputs: string[],
): string => {
  const labels = (expectedOutputs || [])
    .map((label) => label?.trim())
    .filter((label): label is string => Boolean(label));
  if (labels.length === 0) return "";
  const bullets = labels.map((label) => `  - ## ${label}`).join("\n");
  return [
    "Output contract — your final response MUST contain the following top-level Markdown sections, exactly named:",
    bullets,
    "Each section's heading must be on its own line and start with `## ` (level-2 heading). Sections may appear in any order; additional sections beyond these are allowed. Sections inside fenced code blocks are not counted.",
  ].join("\n");
};
