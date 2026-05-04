/**
 * Per-work-item git workspace manager.
 *
 * Correct directory layout (matches the user-visible pattern):
 *
 *   {operatorWorkDir}/{workItemId}/{repoCloneName}/
 *
 * For example, if the operator's workDir is `/work`, the work item is
 * `WI-FQYB8E`, and the repository is `rule-engine`, the checkout lands at:
 *
 *   /work/WI-FQYB8E/rule-engine/
 *
 * This keeps work-item directories flat directly under the operator workDir
 * (no capability slug in the path) and lets the actual git clone sit inside
 * as a named subdirectory — matching the pattern `workDir/workItemId/<gitClone>`.
 *
 * All agent tools (workspace_read, browse_code, workspace_write, …) discover
 * the checkout by scanning `{operatorWorkDir}/{workItemId}/` for the first
 * subdirectory that contains a `.git` — no hard-coded path formula needed.
 *
 * On workflow completion `finalizeWorkItemGitWorkspace` stages all changes,
 * commits them on branch `wi/{workItemId}`, and optionally pushes to origin.
 *
 * This module has no knowledge of Singularity-specific workflow business
 * logic and can be driven by any orchestration layer.
 */

import fs from "node:fs";
import path from "node:path";
import { runGitCommand } from "./app/executionSupport";
import { getCapabilityBaseClones, resolveOperatorWorkingDirectory } from "./desktopRepoSync";
import {
  getLocalCheckoutAstFreshness,
  queueLocalCheckoutAstRefresh,
} from "./localCodeIndex";
import { normalizeDirectoryPath } from "./workspacePaths";
import type {
  Capability,
  SourceWorkspaceAstStatus,
  SourceWorkspaceState,
} from "../src/types";

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
  /** Path to the actual git repository root (contains `.git`). */
  workspacePath: string;
  /** Parent directory containing the git clone: `{workDir}/{workItemId}/` */
  workItemDir: string;
  branchName: string;
  /** True when the workspace was freshly created (false when it already existed). */
  created: boolean;
  source: WorkItemGitWorkspaceSource;
  sourceWorkspaceState: SourceWorkspaceState;
  operatorWorkDir: string;
  repoRoot: string;
  astStatus: SourceWorkspaceAstStatus;
  astFreshness?: string;
  sourceWorkspaceError?: string;
  remediation?: string;
}

export interface WorkItemGitFinalizeResult {
  workspacePath: string;
  branchName: string;
  committed: boolean;
  pushed: boolean;
  headSha: string;
  commitMessage: string;
  changedFiles: string[];
}

export interface WorkItemGitWorkspaceStatus {
  workspacePath: string;
  workItemDir: string;
  exists: boolean;
  isGitRepo: boolean;
  branchName: string;
  headSha: string;
  dirty: boolean;
  changedFiles: string[];
  ahead: number;
  sourceWorkspaceState: SourceWorkspaceState;
  operatorWorkDir: string;
  repoRoot?: string;
  astStatus: SourceWorkspaceAstStatus;
  astFreshness?: string;
  sourceWorkspaceError?: string;
  remediation?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Path helpers
// ────────────────────────────────────────────────────────────────────────────

const sanitizeBranchSegment = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/**
 * Canonical branch name for a work item: `wi/{sanitised-id}`.
 */
export const buildWorkItemBranchName = (workItemId: string): string =>
  `wi/${sanitizeBranchSegment(workItemId) || "work-item"}`;

/**
 * The parent directory for a work item's isolated workspace:
 *   `{workDir}/{workItemId}/`
 *
 * The actual git clone lives one level deeper at
 *   `{workDir}/{workItemId}/{repoName}/`
 */
export const getWorkItemDir = (workingDir: string, workItemId: string): string => {
  const dir = normalizeDirectoryPath(workingDir);
  if (!dir || !workItemId) return "";
  return path.join(dir, workItemId);
};

/**
 * Derive a short clone-directory name from a repository URL or label.
 *
 * Examples:
 *   "https://github.com/example/rule-engine.git" → "rule-engine"
 *   "git@github.com:example/my-app.git"          → "my-app"
 *   "My App"                                       → "my-app"
 */
export const deriveRepoCloneName = (urlOrLabel: string): string => {
  const trimmed = String(urlOrLabel || "").trim().replace(/\.git$/i, "");
  const lastSegment = trimmed.replace(/[/\\:]+/g, "/").split("/").filter(Boolean).pop() || "";
  return (
    lastSegment
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repo"
  );
};

/**
 * Scan `{workDir}/{workItemId}/` for a git repository.
 *
 * Returns the path to the git root (the directory that contains `.git`) when
 * found, or `null` when the work-item directory does not exist or contains no
 * git repositories.
 *
 * Search order:
 * 1. `{workDir}/{workItemId}/` itself (single-level checkout, less common).
 * 2. Every immediate subdirectory of `{workDir}/{workItemId}/` (the standard
 *    layout: `{workDir}/{workItemId}/{repoName}/`).
 *
 * Only one level of subdirectories is scanned — deep nesting is not supported.
 */
export const discoverWorkItemCheckoutPath = (
  workingDir: string,
  workItemId: string,
): string | null => {
  const workItemDir = getWorkItemDir(workingDir, workItemId);
  if (!workItemDir || !fs.existsSync(workItemDir)) return null;

  // Check if the work-item dir itself is a git repo.
  if (fs.existsSync(path.join(workItemDir, ".git"))) {
    return workItemDir;
  }

  // Scan one level of subdirectories.
  try {
    const entries = fs.readdirSync(workItemDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const candidate = path.join(workItemDir, entry.name);
        if (fs.existsSync(path.join(candidate, ".git"))) {
          return candidate;
        }
      }
    }
  } catch {
    // Permissions error or other FS issue — treat as not found.
  }
  return null;
};

// ────────────────────────────────────────────────────────────────────────────
// Internal git helpers
// ────────────────────────────────────────────────────────────────────────────

const isGitRepository = async (dirPath: string): Promise<boolean> => {
  if (!fs.existsSync(dirPath)) return false;
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

const removeDirSilently = (dirPath: string) => {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors.
  }
};

const buildAstWorkspaceFields = ({
  workingDir,
  workspacePath,
  queueAst,
  capabilityId,
  repositoryId,
}: {
  workingDir: string;
  workspacePath: string;
  queueAst?: boolean;
  capabilityId?: string;
  repositoryId?: string;
}): Pick<
  WorkItemGitWorkspaceResult,
  "sourceWorkspaceState" | "operatorWorkDir" | "repoRoot" | "astStatus" | "astFreshness"
> => {
  const astFreshness = getLocalCheckoutAstFreshness(workspacePath);
  const astQueued = Boolean(queueAst && capabilityId && repositoryId && !astFreshness);
  if (astQueued && capabilityId && repositoryId) {
    queueLocalCheckoutAstRefresh({
      checkoutPath: workspacePath,
      capabilityId,
      repositoryId,
    });
  }
  const nextAstFreshness = getLocalCheckoutAstFreshness(workspacePath) || astFreshness;
  const astStatus: SourceWorkspaceAstStatus = nextAstFreshness
    ? "READY"
    : astQueued
      ? "BUILDING"
      : "MISSING";
  const sourceWorkspaceState: SourceWorkspaceState =
    astStatus === "READY" ? "AST_READY" : astStatus === "BUILDING" ? "AST_BUILDING" : "WORK_ITEM_CHECKOUT_READY";
  return {
    sourceWorkspaceState,
    operatorWorkDir: workingDir,
    repoRoot: workspacePath,
    astStatus,
    astFreshness: nextAstFreshness,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Initialise (or reuse) an isolated git workspace for `workItemId`.
 *
 * Layout after a successful call:
 *   `{workDir}/{workItemId}/{repoCloneName}/`  ← git root
 *
 * **Strategy (in priority order):**
 * 1. Scan `{workDir}/{workItemId}/` — if a git repo already exists there,
 *    return it immediately (idempotent, no network).
 * 2. Registered base clone on disk → `git worktree add -b wi/{workItemId}`
 *    places a linked worktree at `{workDir}/{workItemId}/{repoCloneName}/`.
 *    Fast: shares the object store, no network required.
 * 3. `repositoryUrl` supplied → `git clone` into
 *    `{workDir}/{workItemId}/{repoCloneName}/` then create branch.
 *
 * Throws when neither a base clone nor a URL is available.
 */
export const initWorkItemGitWorkspace = async ({
  capability,
  workItemId,
  workingDir: explicitWorkingDir,
  repositoryUrl,
  repositoryLabel,
  repositoryId,
  defaultBranch = "main",
}: {
  capability: Pick<Capability, "name" | "id">;
  workItemId: string;
  /** Override the operator working directory. Falls back to the registered value. */
  workingDir?: string;
  /** Repository URL — used as clone source and to derive the clone dir name. */
  repositoryUrl?: string;
  /** Human-readable label used to derive the clone dir name when no URL is given. */
  repositoryLabel?: string;
  /** Repository id used for AST refresh provenance. */
  repositoryId?: string;
  defaultBranch?: string;
}): Promise<WorkItemGitWorkspaceResult> => {
  const workingDir =
    normalizeDirectoryPath(explicitWorkingDir || "") ||
    (await resolveOperatorWorkingDirectory());

  if (!workingDir) {
    throw new Error(
      "No operator working directory is configured. " +
        "Set one in Desktop Settings or via workingDir.",
    );
  }

  const workItemDir = getWorkItemDir(workingDir, workItemId);
  if (!workItemDir) {
    throw new Error(
      `Cannot determine workspace directory for work item "${workItemId}".`,
    );
  }

  const branchName = buildWorkItemBranchName(workItemId);

  // ── 1. Idempotent: scan for existing checkout ───────────────────────────
  const existingPath = discoverWorkItemCheckoutPath(workingDir, workItemId);
  if (existingPath) {
    console.log(
      `[workItemGitWorkspace] reusing existing workspace for ${workItemId}: ${existingPath}`,
    );
    return {
      workspacePath: existingPath,
      workItemDir,
      branchName,
      created: false,
      source: "existing",
      ...buildAstWorkspaceFields({
        workingDir,
        workspacePath: existingPath,
        queueAst: true,
        capabilityId: capability.id,
        repositoryId,
      }),
    };
  }

  // Ensure the parent work-item directory exists.
  fs.mkdirSync(workItemDir, { recursive: true });

  // ── 2. Git worktree from base clone ────────────────────────────────────
  const baseClones = getCapabilityBaseClones(capability.id).filter(
    (entry) => entry.isGitRepo !== false,
  );
  const primaryClone =
    baseClones.find((entry) => entry.isPrimary) ?? baseClones[0];

  if (primaryClone?.checkoutPath && fs.existsSync(primaryClone.checkoutPath)) {
    const sourceRepoPath = primaryClone.checkoutPath;
    // Derive clone dir name from the base clone's directory name.
    const cloneDirName =
      deriveRepoCloneName(
        repositoryLabel || repositoryUrl || path.basename(sourceRepoPath),
      );
    const workspacePath = path.join(workItemDir, cloneDirName);

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
        `[workItemGitWorkspace] worktree created for ${workItemId}: ${workspacePath} (branch: ${branchName})`,
      );
      return {
        workspacePath,
        workItemDir,
        branchName,
        created: true,
        source: "worktree",
        ...buildAstWorkspaceFields({
          workingDir,
          workspacePath,
          queueAst: true,
          capabilityId: capability.id,
          repositoryId,
        }),
      };
    } catch (err) {
      console.warn(
        `[workItemGitWorkspace] worktree add failed for ${workItemId}, falling back to clone:`,
        err instanceof Error ? err.message : err,
      );
      removeDirSilently(workspacePath);
    }
  }

  // ── 3. Clone from URL ───────────────────────────────────────────────────
  const repoUrl = repositoryUrl?.trim();
  if (!repoUrl) {
    throw new Error(
      `No base clone is available for capability "${capability.name}" and no repository ` +
        `URL was provided. Configure a repository URL in the capability settings or ` +
        `register a base clone before initialising a work-item workspace.`,
    );
  }

  const cloneDirName = deriveRepoCloneName(repositoryLabel || repoUrl);
  const workspacePath = path.join(workItemDir, cloneDirName);

  // Single-branch clone (faster); falls back to full clone on failure.
  try {
    await runGitCommand(workItemDir, [
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
    removeDirSilently(workspacePath);
    await runGitCommand(workItemDir, ["clone", repoUrl, cloneDirName]);
  }

  if (!(await isGitRepository(workspacePath))) {
    throw new Error(
      `Clone of ${repoUrl} did not produce a valid git repository at ${workspacePath}.`,
    );
  }

  // Create / switch to the work-item branch.
  if (await branchExistsLocally(workspacePath, branchName)) {
    await runGitCommand(workspacePath, ["switch", branchName]);
  } else {
    await runGitCommand(workspacePath, ["switch", "-c", branchName]);
  }

  console.log(
    `[workItemGitWorkspace] cloned for ${workItemId}: ${workspacePath} (branch: ${branchName})`,
  );
  return {
    workspacePath,
    workItemDir,
    branchName,
    created: true,
    source: "clone",
    ...buildAstWorkspaceFields({
      workingDir,
      workspacePath,
      queueAst: true,
      capabilityId: capability.id,
      repositoryId,
    }),
  };
};

/**
 * Stage all pending changes in the workspace, commit them, and optionally
 * push to the remote.  Does nothing (returns `committed: false`) when the
 * working tree is clean.
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
  push?: boolean;
}): Promise<WorkItemGitFinalizeResult> => {
  if (!(await isGitRepository(workspacePath))) {
    throw new Error(
      `${workspacePath} is not a git repository — cannot finalize.`,
    );
  }

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
      `[workItemGitWorkspace] committed ${changedFiles.length} file(s) on ${branchName}: ${headSha.slice(0, 8)}`,
    );
  } else {
    headSha = await runGitCommand(workspacePath, ["rev-parse", "HEAD"]).catch(
      () => "",
    );
    console.log(
      `[workItemGitWorkspace] nothing to commit on ${branchName} — working tree clean.`,
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
      console.log(`[workItemGitWorkspace] pushed ${branchName} to origin.`);
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
 * Safe to call before the workspace has been initialised (`exists: false`).
 */
export const getWorkItemGitWorkspaceStatus = async (
  workingDir: string,
  workItemId: string,
): Promise<WorkItemGitWorkspaceStatus> => {
  const workItemDir = getWorkItemDir(workingDir, workItemId);
  const workspacePath = discoverWorkItemCheckoutPath(workingDir, workItemId) ?? "";

  if (!workspacePath || !(await isGitRepository(workspacePath))) {
    return {
      workspacePath,
      workItemDir,
      exists: fs.existsSync(workItemDir),
      isGitRepo: false,
      branchName: "",
      headSha: "",
      dirty: false,
      changedFiles: [],
      ahead: 0,
      sourceWorkspaceState: fs.existsSync(workItemDir) ? "CHECKING" : "BLOCKED",
      operatorWorkDir: normalizeDirectoryPath(workingDir),
      repoRoot: workspacePath || undefined,
      astStatus: "MISSING",
      sourceWorkspaceError: fs.existsSync(workItemDir)
        ? "Work-item directory exists but no git checkout was found."
        : "Work-item checkout has not been initialized.",
      remediation: "Use Refresh source / AST or start execution to create the checkout.",
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
    runGitCommand(workspacePath, ["rev-list", "--count", "@{u}..HEAD"]).catch(
      () => "0",
    ),
  ]);

  const changedFiles = statusOutput
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);

  return {
    workspacePath,
    workItemDir,
    exists: true,
    isGitRepo: true,
    branchName: branch.trim(),
    headSha: headSha.trim(),
    dirty: changedFiles.length > 0,
    changedFiles,
    ahead: Number.parseInt(aheadOutput.trim() || "0", 10) || 0,
    ...buildAstWorkspaceFields({
      workingDir: normalizeDirectoryPath(workingDir),
      workspacePath,
      queueAst: false,
    }),
  };
};
