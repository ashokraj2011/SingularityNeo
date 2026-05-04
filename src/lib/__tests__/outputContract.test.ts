import { describe, expect, it } from "vitest";
import {
  auditOutputContractSections,
  buildOutputContractInstruction,
  extractHeadingSlugs,
} from "../outputContract";

describe("extractHeadingSlugs", () => {
  it("captures h1-h6 headings, slugified", () => {
    const md = `
# Top
## Planning Report
### Stakeholder Alignment Summary
#### Notes
`;
    expect(extractHeadingSlugs(md)).toEqual([
      "top",
      "planning report",
      "stakeholder alignment summary",
      "notes",
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const md = `
## Real Heading
\`\`\`
## Not A Heading
\`\`\`
## Another Real
`;
    expect(extractHeadingSlugs(md)).toEqual(["real heading", "another real"]);
  });

  it("dedupes repeated headings (preserves first-seen order)", () => {
    const md = `## A\n## B\n## A`;
    expect(extractHeadingSlugs(md)).toEqual(["a", "b"]);
  });

  it("tolerates trailing punctuation and whitespace", () => {
    expect(extractHeadingSlugs("##   Planning  Report   ")).toEqual([
      "planning report",
    ]);
    expect(extractHeadingSlugs("## Planning Report:")).toEqual([
      "planning report",
    ]);
  });
});

describe("auditOutputContractSections", () => {
  it("reports vacuous when no expectations declared", () => {
    expect(auditOutputContractSections("anything", [])).toEqual({
      present: [],
      missing: [],
      vacuous: true,
    });
  });

  it("matches present sections case-insensitively", () => {
    const md = `## planning report\n## delivery milestone plan`;
    const audit = auditOutputContractSections(md, [
      "Planning Report",
      "Delivery Milestone Plan",
      "Stakeholder Alignment Summary",
    ]);
    expect(audit.present).toEqual(["Planning Report", "Delivery Milestone Plan"]);
    expect(audit.missing).toEqual(["Stakeholder Alignment Summary"]);
    expect(audit.vacuous).toBe(false);
  });

  it("misses headings inside fenced code blocks", () => {
    const md = "```\n## Planning Report\n```\nNo real headings.";
    const audit = auditOutputContractSections(md, ["Planning Report"]);
    expect(audit.present).toEqual([]);
    expect(audit.missing).toEqual(["Planning Report"]);
  });
});

describe("buildOutputContractInstruction", () => {
  it("returns empty when no expectations", () => {
    expect(buildOutputContractInstruction([])).toBe("");
    expect(buildOutputContractInstruction(["", "  "])).toBe("");
  });

  it("emits a structured instruction with bullet list of headings", () => {
    const text = buildOutputContractInstruction([
      "Planning Report",
      "Delivery Milestone Plan",
    ]);
    expect(text).toContain("Output contract");
    expect(text).toContain("- ## Planning Report");
    expect(text).toContain("- ## Delivery Milestone Plan");
    expect(text).toContain("level-2 heading");
  });
});
