/**
 * BUILD step contract helpers.
 *
 * A `WorkflowStep` whose `stepType === 'BUILD'` is contractually
 * expected to produce a `CODE_PATCH` artifact — a unified diff the
 * platform can later turn into a branch + commit + PR via Phase C's
 * Octokit session module.
 *
 * This module is the single source of truth for that contract so the
 * runtime checklist, the UI hint, and the server-side validator all
 * agree on the same labels and enforcement rules. Keeping it a
 * standalone helper avoids dragging BUILD-specific knowledge into the
 * much larger `workflowRuntime.ts` / `standardWorkflow.ts` surfaces.
 */
import type { ArtifactKind, WorkflowStep, WorkflowStepType } from '../types';

/** The canonical artifact kind a BUILD step must emit. */
export const BUILD_STEP_OUTPUT_KIND: ArtifactKind = 'CODE_PATCH';

/** Checklist label surfaced in the runtime's expected-outputs list. */
export const BUILD_STEP_OUTPUT_LABEL =
  'CODE_PATCH artifact (unified diff ready to branch + commit)';

export const isBuildStep = (
  step: { stepType?: WorkflowStepType | string } | null | undefined,
): step is { stepType: 'BUILD' } =>
  Boolean(step && step.stepType === 'BUILD');

/**
 * What `artifactKind` should a step's completion produce? Null if the
 * step type doesn't constrain output kind. Today only BUILD does;
 * additional types (e.g. REVIEW → `REVIEW_PACKET`) can slot in here.
 */
export const expectedArtifactKindFor = (
  step: { stepType?: WorkflowStepType | string } | null | undefined,
): ArtifactKind | null => {
  if (isBuildStep(step)) return BUILD_STEP_OUTPUT_KIND;
  return null;
};

/**
 * Extend a step's `artifactContract.expectedOutputs` so the BUILD
 * contract label is always present. Idempotent — never duplicates the
 * label if the author already included it. Non-BUILD steps are
 * returned unchanged so callers can pipe every step through this.
 */
export const withBuildContract = <T extends WorkflowStep>(step: T): T => {
  if (!isBuildStep(step)) return step;
  const existing = step.artifactContract?.expectedOutputs || [];
  if (existing.some(label => label.trim() === BUILD_STEP_OUTPUT_LABEL)) {
    return step;
  }
  return {
    ...step,
    artifactContract: {
      ...(step.artifactContract || {}),
      expectedOutputs: [...existing, BUILD_STEP_OUTPUT_LABEL],
    },
  };
};

/**
 * True when the given artifact kind satisfies the step's contract.
 * Callers typically use this when accepting an artifact upload to a
 * step's output slot.
 */
export const artifactSatisfiesStepContract = (
  step: { stepType?: WorkflowStepType | string } | null | undefined,
  artifactKind: ArtifactKind | null | undefined,
): boolean => {
  const expected = expectedArtifactKindFor(step);
  if (!expected) return true; // no contract → anything goes
  return artifactKind === expected;
};
