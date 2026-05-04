/**
 * Per-work-item git workspace manager.
 *
 * When a work item starts in the Workflow Orchestrator (or any workflow-driven
 * flow), this module creates an isolated, fully-writable git checkout that:
 *
 *   • Lives at  {workingDir}/{capability-slug}/{workItemId}/
 *   • Tracks branch  wi/{workItemId}  (sanitised from the raw ID)
 *   • Can be seeded from the capability's registered base clone (fast —
 *     uses `git worktree add`, no network) or cloned from the repository
 *     URL when no base clone is available (network required).
 *
 * All agent tools (workspace_read, browse_code, workspace_write, …) that
 * receive a `workItem` whose ID matches this path will operate exclusively
 * within the isolated checkout, keeping work items hermetically separated.
 *
 * On workflow completion, `finalizeWorkItemGitWorkspace` stages and commits
 * every change and (optionally) pushes to the remote.
 *
 * This is a generic utility — it has no knowledge of Singularity-specific
 * workflow business logic and can be driven by any orchestration layer.
 */

import fs from "node:fs";
import path from "node:path";
import { runGitCommand } from "./app/executionSupport";
import { getCapabilityBaseClones, resolveOperatorWorkingDirectory } from "./desktopRepoSync";
import { buildWorkItemCheckoutPath } from "./workItemCheckouts";
import { normalizeDirectoryPath } from "./workspacePaths";
import type { Capability } from "../src/types";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type WorkItemGitWorkspaceSource =
  /** Workspace already existed on disk — returned as-is (idempotent). */
  | "existing"
  /** Created via `git worktree add` branching off the capability base clone. */
  | "worktree"
  /** Cloned directly from the repository URL. */
  | "clone";

export interface WorkItemGitWorkspaceResult {
  workspacePath: string;
  branchName: string;
  /** True when the workspace was freshly created (false when it already existed). */
  created: boolean;
  source: WorkItemGitWorkspaceSource;
}

export interface WorkItemGitFinalizeResult {
  workspacePath: string;
  branchName: string;
  /** True when at least one file was staged and committed. */
  committed: boolean;
  /** True when changes were pushed to the remote. */
  pushed: boolean;
  headSha: string;
  commitMessage: string;
  changedFiles: string[];
}

export interface WorkItemGitWorkspaceStatus {
  workspacePath: string;
  exists: boolean;
  isGitRepo: boolean;
  branchName: string;
  headSha: string;
  /** True when there are staged or unstaged changes. */
  dirty: boolean;
  changedFiles: string[];
  /** Number of commits ahead of the tracking remote branch (0 when no upstream). */
  ahead: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Path / branch helpers
// ────────────────────────────────────────────────────────────────────────────

const sanitizeBranchSegment = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/**
 * Canonical branch name for a work item: `wi/{sanitised-id}`.
 * Callers can also pass the raw work item ID to this helper.
 */
export const buildWorkItemBranchName = (workItemId: string): string =>
  `wi/${sanitizeBranchSegment(workItemId)}`;

/**
 * Derive the on-disk path for the work-item's isolated checkout.
 *
 * Layout:  {workingDir}/{capability-slug}/{workItemId}/
 *
 * This intentionally matches `buildWorkItemCheckoutPath` from
 * `workItemCheckouts.ts` so that the standard `resolveCapabilityCodeRoots`
 * path can discover it without any additional plumbing.
 */
export const getWorkItemWorkspacePath = (
  workingDir: string,
  capability: Pick<Capability, "name" | "id">,
  workItemId: string,
): string => {
  const dir = normalizeDirectoryPath(workingDir);
  if (!dir || !workItemId) return "";
  return buildWorkItemCheckoutPath({
    workingDirectoryPath: dir,
    capability,
    workItemId,
    // No repository suffix — single-repo layout is the default.
  });
};

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

const checkPathExists = (p: string): boolean => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

const isGitRepository = async (dirPath: string): Promise<boolean> => {
  if (!checkPathExists(dirPath)) return false;
  try {
    const result = await runGitCommand(dirPath, [
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return result.trim() === "true";
  } catch {
    return false;
  }
};

const branchExistsLocally = async (
  repoPath: string,
  branchName: string,
): Promise<boolean> => {
  try {
    const result = await runGitCommand(repoPath, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branchName}`,
    ]);
    return result.trim().length > 0;
  } catch {
    return false;
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Initialise (or reuse) an isolated git workspace for `workItemId`.
 *
 * **Strategy (in priority order):**
 * 1. If the checkout directory already exists and is a valid git repository →
 *    return immediately (idempotent).
 * 2. If the capability has a registered base clone on disk →
 *    `git worktree add -b wi/{workItemId} {workspacePath}` off that clone.
 *    This is fast (no network), shares the object store with the base clone,
 *    and means all future fetches update both the base clone and this worktree.
 * 3. If a `repositoryUrl` is supplied →
 *    `git clone --single-branch {url} {workspacePath}` then create/switch to
 *    `wi/{workItemId}`.
 *
 * Throws when neither a base clone nor a repository URL is available.
 */
export const initWorkItemGitWorkspace = async ({
  capability,
  workItemId,
  workingDir: explicitWorkingDir,
  repositoryUrl,
  defaultBranch = "main",
}: {
  capability: Pick<Capability, "name" | "id">;
  workItemId: string;
  /** Override the working directory.  Falls back to the operator's
   *  registered working directory (from `desktopRepoSync`). */
  workingDir?: string;
  /** Repository URL used as a fallback when no base clone is registered. */
  repositoryUrl?: string;
  defaultBranch?: string;
}): Promise<WorkItemGitWorkspaceResult> => {
  const workingDir =
    normalizeDirectoryPath(explicitWorkingDir || "") ||
    (await resolveOperatorWorkingDirectory());

  if (!workingDir) {
    throw new Error(
      "No working directory available. " +
        "Configure one under Desktop Settings or set SINGULARITY_WORKING_DIRECTORY.",
    );
  }

  const workspacePath = getWorkItemWorkspacePath(workingDir, capability, workItemId);
  if (!workspacePath) {
    throw new Error(
      `Cannot determine workspace path for work item "${workItemId}".`,
    );
  }

  const branchName = buildWorkItemBranchName(workItemId);

  // ── 1. Idempotent: already exists ──────────────────────────────────────
  if (await isGitRepository(workspacePath)) {
    console.log(
      `[workItemGitWorkspace] reusing existing workspace for ${workItemId}: ${workspacePath}`,
    );
    return { workspacePath, branchName, created: false, source: "existing" };
  }

  // Make sure the parent directory exists.
  fs.mkdirSync(path.dirname(workspacePath), { recursive: true });

  // ── 2. Git worktree from base clone ────────────────────────────────────
  const baseClones = getCapabilityBaseClones(capability.id).filter(
    (entry) => entry.isGitRepo !== false,
  );
  const primaryClone =
    baseClones.find((entry) => entry.isPrimary) ?? baseClones[0];

  if (primaryClone?.checkoutPath && checkPathExists(primaryClone.checkoutPath)) {
    const sourceRepoPath = primaryClone.checkoutPath;
    try {
      const alreadyExists = await branchExistsLocally(sourceRepoPath, branchName);
      if (alreadyExists) {
        await runGitCommand(sourceRepoPath, [
          "worktree",
          "add",
          workspacePath,
          branchName,
        ]);
      } else {
        await runGitCommand(sourceRepoPath, [
          "worktree",
          "add",
          "-b",
          branchName,
          workspacePath,
        ]);
      }
      console.log(
        `[workItemGitWorkspace] created worktree for ${workItemId} at ${workspacePath} (branch: ${branchName})`,
      );
      return { workspacePath, branchName, created: true, source: "worktree" };
    } catch (err) {
      console.warn(
        `[workItemGitWorkspace] worktree add failed for ${workItemId}, falling back to clone:`,
        err instanceof Error ? err.message : err,
      );
      // Clean up any partial directory before attempting a clone.
      try {
        fs.rmSync(workspacePath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
  }

  // ── 3. Clone from URL ───────────────────────────────────────────────────
  const repoUrl = repositoryUrl?.trim();
  if (!repoUrl) {
    throw new Error(
      `No base clone available for capability "${capability.name}" and no repository URL was ` +
        `provided. Configure a repository in the capability settings or register a base clone ` +
        `before initializing a work-item workspace.`,
    );
  }

  const parentDir = path.dirname(workspacePath);
  const cloneDirName = path.basename(workspacePath);
  fs.mkdirSync(parentDir, { recursive: true });

  // Attempt a single-branch clone first (faster); fall back to full clone.
  try {
    await runGitCommand(parentDir, [
      "clone",
      "--branch",
      defaultBranch,
      "--single-branch",
      repoUrl,
      cloneDirName,
    ]);
  } catch {
    console.warn(
      `[workItemGitWorkspace] single-branch clone failed for ${workItemId}, retrying full clone.`,
    );
    // Remove any partial clone directory.
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch {
      // Ignore.
    }
    await runGitCommand(parentDir, ["clone", repoUrl, cloneDirName]);
  }

  if (!(await isGitRepository(workspacePath))) {
    throw new Error(
      `Clone of ${repoUrl} did not produce a valid git repository at ${workspacePath}.`,
    );
  }

  // Create and switch to the work-item branch.
  if (await branchExistsLocally(workspacePath, branchName)) {
    await runGitCommand(workspacePath, ["switch", branchName]);
  } else {
    await runGitCommand(workspacePath, ["switch", "-c", branchName]);
  }

  console.log(
    `[workItemGitWorkspace] cloned and branched ${workItemId} at ${workspacePath} (branch: ${branchName})`,
  );
  return { workspacePath, branchName, created: true, source: "clone" };
};

/**
 * Stage all changes in the workspace, commit them, and optionally push to the
 * remote tracking branch.
 *
 * Does nothing (returns `committed: false`) when the working tree is clean.
 */
export const finalizeWorkItemGitWorkspace = async ({
  workspacePath,
  branchName,
  commitMessage,
  authorName = "Singularity Workflow Orchestrator",
  authorEmail = "orchestrator@singularity.local",
  push = false,
}: {
  workspacePath: string;
  branchName: string;
  commitMessage?: string;
  authorName?: string;
  authorEmail?: string;
  /** When true, push the branch to `origin`. */
  push?: boolean;
}): Promise<WorkItemGitFinalizeResult> => {
  if (!(await isGitRepository(workspacePath))) {
    throw new Error(
      `${workspacePath} is not a git repository — cannot finalize.`,
    );
  }

  // Collect changed files.
  const statusOutput = await runGitCommand(workspacePath, [
    "status",
    "--short",
    "--untracked-files=normal",
  ]).catch(() => "");

  const changedFiles = statusOutput
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);

  let committed = false;
  let headSha = "";
  const message =
    commitMessage ||
    `Workflow Orchestrator: finalize ${branchName} [${new Date().toISOString()}]`;

  if (changedFiles.length > 0) {
    await runGitCommand(workspacePath, ["add", "-A"]);
    await runGitCommand(workspacePath, [
      "-c",
      `user.name=${authorName}`,
      "-c",
      `user.email=${authorEmail}`,
      "commit",
      "-m",
      message,
    ]);
    committed = true;
    headSha = await runGitCommand(workspacePath, ["rev-parse", "HEAD"]).catch(
      () => "",
    );
    console.log(
      `[workItemGitWorkspace] committed ${changedFiles.length} file(s) for ${branchName}: ${headSha.slice(0, 8)}`,
    );
  } else {
    headSha = await runGitCommand(workspacePath, ["rev-parse", "HEAD"]).catch(
      () => "",
    );
    console.log(
      `[workItemGitWorkspace] nothing to commit for ${branchName} — working tree is clean.`,
    );
  }

  let pushed = false;
  if (push) {
    try {
      await runGitCommand(workspacePath, [
        "push",
        "--set-upstream",
        "origin",
        branchName,
      ]);
      pushed = true;
      console.log(
        `[workItemGitWorkspace] pushed ${branchName} to origin.`,
      );
    } catch (err) {
      console.warn(
        `[workItemGitWorkspace] push failed for ${branchName}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    workspacePath,
    branchName,
    committed,
    pushed,
    headSha: headSha.trim(),
    commitMessage: message,
    changedFiles,
  };
};

/**
 * Returns the current git status of a work-item workspace.
 * Safe to call on a path that doesn't exist yet (returns `exists: false`).
 */
export const getWorkItemGitWorkspaceStatus = async (
  workspacePath: string,
): Promise<WorkItemGitWorkspaceStatus> => {
  const exists = checkPathExists(workspacePath);
  const isRepo = exists && (await isGitRepository(workspacePath));

  if (!isRepo) {
    return {
      workspacePath,
      exists,
      isGitRepo: false,
      branchName: "",
      headSha: "",
      dirty: false,
      changedFiles: [],
      ahead: 0,
    };
  }

  const [branch, headSha, statusOutput, aheadOutput] = await Promise.all([
    runGitCommand(workspacePath, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(
      () => "",
    ),
    runGitCommand(workspacePath, ["rev-parse", "HEAD"]).catch(() => ""),
    runGitCommand(workspacePath, [
      "status",
      "--short",
      "--untracked-files=normal",
    ]).catch(() => ""),
    // `@{u}..HEAD` counts commits not yet pushed; fails gracefully when no upstream.
    runGitCommand(workspacePath, [
      "rev-list",
      "--count",
      "@{u}..HEAD",
    ]).catch(() => "0"),
  ]);

  const changedFiles = statusOutput
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);

  return {
    workspacePath,
    exists: true,
    isGitRepo: true,
    branchName: branch.trim(),
    headSha: headSha.trim(),
    dirty: changedFiles.length > 0,
    changedFiles,
    ahead: Number.parseInt(aheadOutput.trim() || "0", 10) || 0,
  };
};
