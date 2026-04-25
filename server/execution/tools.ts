import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  Capability,
  CapabilityAgent,
  CapabilityExecutionCommandTemplate,
  DesktopWorkspaceResolution,
  ToolAdapterId,
  WorkItem,
} from "../../src/types";
import { executionRuntimeRpc, isRemoteExecutionClient } from "./runtimeClient";
import {
  runSandboxedCommand,
  type SandboxProfile,
  summarizeSandboxFailure,
} from "../sandbox";
import {
  findApprovedWorkspaceRoot,
  formatApprovedWorkspaceRoots,
  getCapabilityWorkspaceRoots,
  normalizeDirectoryPath,
} from "../workspacePaths";
import {
  listIndexedWorkspaceFiles,
  searchIndexedWorkspaceFiles,
} from "../workspaceIndex";
import {
  getPublishedBounty,
  getPublishedBountySignal,
  publishBounty,
  publishBountySignal,
  waitForBountySignal,
} from "../eventBus";
import {
  acquireWorkspaceWriteLock,
  releaseWorkspaceWriteLock,
  WorkspaceLockConflictError,
} from "../workspaceLock";
import {
  findSymbolRangeInFile,
  findFileDependents,
  findFileDependencies,
  listTopExportsInFile,
  searchCodeSymbols,
} from "../codeIndex/query";
import {
  findLocalCheckoutSymbolRange,
  getLocalCheckoutAstFreshness,
  listLocalCheckoutAllSymbols,
  searchLocalCheckoutSymbols,
} from "../localCodeIndex";
import {
  getCapabilityBaseClones,
  getPrimaryBaseClone,
} from "../desktopRepoSync";
import { buildWorkItemCheckoutPath } from "../workItemCheckouts";

const execFileAsync = promisify(execFile);

export type ToolExecutionResult = {
  summary: string;
  details?: Record<string, unknown>;
  workingDirectory?: string;
  exitCode?: number;
  stdoutPreview?: string;
  stderrPreview?: string;
  sandboxProfile?: string;
};

type ToolExecutionContext = {
  capability: Capability;
  agent: CapabilityAgent;
  workItem?: WorkItem;
  requireApprovedDeployment?: boolean;
};

type ToolAdapter = {
  id: ToolAdapterId;
  description: string;
  usageExample?: string;
  retryable: boolean;
  execute: (
    context: ToolExecutionContext,
    args: Record<string, any>,
  ) => Promise<ToolExecutionResult>;
};

const previewText = (value: string, limit = 1600) =>
  value.replace(/\0/g, "").slice(0, limit);

const compressSnippet = (code: string) => {
  const lineEnding = code.includes("\r\n") ? "\r\n" : "\n";
  const lines = code.split(/\r?\n/);
  const compressed: string[] = [];
  let lastLineBlank = false;

  for (const line of lines) {
    const isBlankLine = line.trim().length === 0;
    if (isBlankLine) {
      if (lastLineBlank) {
        continue;
      }
      compressed.push("");
      lastLineBlank = true;
      continue;
    }

    compressed.push(line);
    lastLineBlank = false;
  }

  return compressed.join(lineEnding);
};

const clampLimit = (value: unknown, fallback: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(parsed), max));
};

const paginateValues = ({
  values,
  cursor,
  limit,
}: {
  values: string[];
  cursor?: string;
  limit: number;
}) => {
  const offset = (() => {
    if (!cursor) {
      return 0;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      ) as {
        offset?: number;
      };
      return Math.max(0, Number(payload.offset || 0));
    } catch {
      return 0;
    }
  })();
  const page = values.slice(offset, offset + limit);
  const nextCursor =
    offset + limit < values.length
      ? Buffer.from(
          JSON.stringify({ offset: offset + limit }),
          "utf8",
        ).toString("base64url")
      : undefined;

  return {
    page,
    nextCursor,
    total: values.length,
    truncated: Boolean(nextCursor),
  };
};

const getRequiredStringArg = (
  args: Record<string, any>,
  key: string,
  toolId: ToolAdapterId,
) => {
  if (Array.isArray(args[key])) {
    const label =
      key === "path" || key === "pattern" || key === "workspacePath"
        ? `${key} string`
        : `${key} value`;
    throw new Error(`${toolId} requires a single ${label}.`);
  }

  const value = String(args[key] || "").trim();
  if (!value) {
    const label =
      key === "path" || key === "pattern" || key === "workspacePath"
        ? `a ${key}`
        : key;
    throw new Error(`${toolId} requires ${label}.`);
  }
  return value;
};

const getRequiredRawStringArg = (
  args: Record<string, any>,
  key: string,
  toolId: ToolAdapterId,
) => {
  if (Array.isArray(args[key])) {
    throw new Error(`${toolId} requires a single ${key} value.`);
  }

  const value = args[key];
  if (value === undefined || value === null || String(value).length === 0) {
    throw new Error(`${toolId} requires ${key}.`);
  }
  return String(value);
};

const normalizeBountyRole = (value?: string | null) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

const agentMatchesBountyRole = (
  agent: CapabilityAgent,
  targetRole?: string,
) => {
  const expected = normalizeBountyRole(targetRole);
  if (!expected) {
    return true;
  }

  const candidates = [
    agent.role,
    agent.name,
    agent.standardTemplateKey,
    agent.roleStarterKey,
  ]
    .map((value) => normalizeBountyRole(value))
    .filter(Boolean);

  return candidates.some(
    (candidate) =>
      candidate === expected ||
      candidate.includes(expected) ||
      expected.includes(candidate),
  );
};

const describeDeploymentTargets = (
  targets: Capability["executionConfig"]["deploymentTargets"],
) =>
  targets
    .map((target) => `${target.id} -> ${target.commandTemplateId}`)
    .join(", ");

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const isCommandMissing = (result: { stderr?: string; stdout?: string }) =>
  /spawn\s+\S+\s+ENOENT/i.test(
    `${result.stderr || ""}\n${result.stdout || ""}`,
  );

const runProcessWithInput = async ({
  command,
  args,
  cwd,
  stdin,
}: {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
}) =>
  new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk || "");
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk || "");
      });
      child.on("error", (error) => {
        resolve({
          exitCode: 1,
          stdout,
          stderr: error.message,
        });
      });
      child.on("close", (exitCode) => {
        resolve({
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
        });
      });

      child.stdin.write(stdin);
      child.stdin.end();
    },
  );

const extractPatchTouchedFiles = (patchText: string) => {
  const touched = new Set<string>();
  patchText.split("\n").forEach((line) => {
    const match = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
    if (!match) {
      return;
    }
    const candidate = match[1]?.trim();
    if (!candidate || candidate === "/dev/null") {
      return;
    }
    touched.add(candidate);
  });
  return [...touched];
};

const requireRemoteWorkspaceResolution = (
  capability: Capability,
  resolution: DesktopWorkspaceResolution,
) => {
  if (
    !resolution.validation.valid ||
    !resolution.localRootPath ||
    !resolution.workingDirectoryPath
  ) {
    throw new Error(
      resolution.validation.message ||
        `Capability ${capability.name} does not have a valid desktop workspace mapping for the current operator on this desktop.`,
    );
  }

  return resolution as DesktopWorkspaceResolution & {
    localRootPath: string;
    workingDirectoryPath: string;
  };
};

const looksLikeSymbolPattern = (value: string) =>
  /^[A-Za-z_][A-Za-z0-9_.$-]{1,120}$/.test(String(value || "").trim()) &&
  !/\s/.test(String(value || ""));

const resolveWorkspacePath = async (
  capability: Capability,
  workItem?: WorkItem,
  preferredPath?: string,
) => {
  const workItemRepositoryId =
    workItem?.executionContext?.primaryRepositoryId ||
    workItem?.executionContext?.branch?.repositoryId;

  if (isRemoteExecutionClient() && capability.id) {
    const resolution = requireRemoteWorkspaceResolution(
      capability,
      await executionRuntimeRpc<DesktopWorkspaceResolution>(
        "resolveDesktopWorkspace",
        {
          capabilityId: capability.id,
          repositoryId: workItemRepositoryId,
        },
      ),
    );
    const allowed =
      resolution.approvedWorkspaceRoots.length > 0
        ? resolution.approvedWorkspaceRoots
        : [resolution.localRootPath];
    const workItemRepository = (capability.repositories || []).find(
      (repository) => repository.id === workItemRepositoryId,
    );
    const baseClonePath =
      !workItem?.id && capability.id
        ? normalizeDirectoryPath(
            getPrimaryBaseClone(capability.id)?.checkoutPath || "",
          )
        : "";
    const derivedWorkItemCheckoutPath =
      workItem?.id && workItemRepository
        ? buildWorkItemCheckoutPath({
            workingDirectoryPath: resolution.workingDirectoryPath,
            capability,
            workItemId: workItem.id,
            repository: workItemRepository,
            repositoryCount: (capability.repositories || []).length,
          })
        : "";
    const defaultPath =
      derivedWorkItemCheckoutPath ||
      baseClonePath ||
      resolution.workingDirectoryPath ||
      resolution.localRootPath;
    const requestedPath = normalizeDirectoryPath(preferredPath || "");
    const candidate = requestedPath || defaultPath;

    if (!candidate) {
      throw new Error(
        `Capability ${capability.name} does not have a valid desktop workspace mapping for the current operator on this desktop.`,
      );
    }

    if (!findApprovedWorkspaceRoot(candidate, allowed)) {
      if (requestedPath && allowed.length === 1) {
        return defaultPath || allowed[0];
      }

      throw new Error(
        `Workspace path ${candidate} is not mapped for capability ${capability.name} on this desktop. Available local roots: ${formatApprovedWorkspaceRoots(allowed)}.`,
      );
    }

    return candidate;
  }

  const allowed = getCapabilityWorkspaceRoots(capability);
  const configuredDefault = normalizeDirectoryPath(
    capability.executionConfig.defaultWorkspacePath || "",
  );
  const workItemRepositoryRoot = normalizeDirectoryPath(
    (capability.repositories || []).find(
      (repository) => repository.id === workItemRepositoryId,
    )?.localRootHint || "",
  );
  const defaultPath =
    workItemRepositoryRoot || configuredDefault || allowed[0] || "";
  const requestedPath = normalizeDirectoryPath(preferredPath || "");
  const candidate = requestedPath || defaultPath;

  if (!candidate) {
    throw new Error(
      `Capability ${capability.name} does not have a desktop-user workspace path available for this run.`,
    );
  }

  if (!findApprovedWorkspaceRoot(candidate, allowed)) {
    if (requestedPath && allowed.length === 1) {
      return allowed[0];
    }

    throw new Error(
      `Workspace path ${candidate} is outside the desktop-user workspace roots for capability ${capability.name}. Desktop workspace roots: ${formatApprovedWorkspaceRoots(allowed)}.`,
    );
  }

  return candidate;
};

const resolvePathWithinWorkspace = (
  workspacePath: string,
  filePath: string,
) => {
  const nextPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workspacePath, filePath);

  const relative = path.relative(workspacePath, nextPath);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path ${filePath} escapes the desktop workspace root.`);
  }

  return nextPath;
};

export const classifyToolExecutionError = ({
  toolId,
  message,
}: {
  toolId: ToolAdapterId;
  message: string;
}) => {
  const normalized = message.trim();
  if (!normalized) {
    return null;
  }

  if (/^WRITE_CONTROL lock held by agent\b/i.test(normalized)) {
    return {
      recoverable: true,
      feedback: `The workspace write lock is currently held by another agent. ${normalized} Wait a moment, then retry the write operation.`,
    };
  }

  if (/^workspace_write refused on existing file\b/i.test(normalized)) {
    return {
      recoverable: true,
      feedback: `Diff-Enforcement Policy blocked this write. ${normalized} Switch to workspace_apply_patch or workspace_replace_block for the next attempt.`,
    };
  }

  if (new RegExp(`^${toolId}\\s+requires\\b`, "i").test(normalized)) {
    return {
      recoverable: true,
      feedback: `Tool ${toolId} validation failed: ${normalized} Fix the missing required argument and try again.`,
    };
  }

  if (
    /is not approved for capability/i.test(normalized) ||
    /outside the desktop-user workspace roots/i.test(normalized) ||
    /escapes the approved workspace root/i.test(normalized) ||
    /escapes the desktop workspace root/i.test(normalized)
  ) {
    return {
      recoverable: true,
      feedback: `Tool ${toolId} used an invalid workspace path: ${normalized} Pick a desktop workspace root or child path and try again.`,
    };
  }

  if (
    toolId === "run_deploy" &&
    /does not define deployment target|must remain approval-gated/i.test(
      normalized,
    )
  ) {
    return {
      recoverable: true,
      feedback: `Tool ${toolId} could not run with the provided deployment target: ${normalized} Use one of the approved deployment targets or wait for the required approval gate.`,
    };
  }

  if (
    (toolId === "run_build" ||
      toolId === "run_test" ||
      toolId === "run_docs") &&
    /does not define the (build|test|docs) command template/i.test(normalized)
  ) {
    return {
      recoverable: true,
      feedback: `Tool ${toolId} cannot run because ${normalized} If explicit operator guidance says to skip this command for the current attempt, do not call ${toolId} again. Complete the step and clearly state that the validation was skipped by operator direction. Otherwise pause_for_input and ask whether to configure the missing command template or skip this command for this attempt.`,
    };
  }

  return null;
};

const runProcess = async (file: string, args: string[], cwd: string) => {
  try {
    const result = await execFileAsync(file, args, {
      cwd,
      maxBuffer: 1024 * 1024 * 8,
    });
    return {
      exitCode: 0,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  } catch (error) {
    const execError = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      stdout: execError.stdout || "",
      stderr: execError.stderr || execError.message || "",
    };
  }
};

const resolveCommandTemplate = (
  capability: Capability,
  templateId: string,
): CapabilityExecutionCommandTemplate => {
  const template = capability.executionConfig.commandTemplates.find(
    (item) => item.id === templateId,
  );
  if (!template) {
    throw new Error(
      `Capability ${capability.name} does not define the ${templateId} command template.`,
    );
  }
  if (!Array.isArray(template.command) || template.command.length === 0) {
    throw new Error(
      `Command template ${templateId} is not configured correctly.`,
    );
  }
  return template;
};

export const resolveDeploymentTarget = (
  capability: Capability,
  requestedTargetId?: string,
) => {
  const targets = capability.executionConfig.deploymentTargets || [];
  const targetId = String(requestedTargetId || "").trim();

  if (targets.length === 0) {
    throw new Error(
      `Capability ${capability.name} does not define any deployment targets.`,
    );
  }

  if (!targetId) {
    if (targets.length === 1) {
      return targets[0];
    }

    throw new Error(
      `run_deploy requires a deployment target id. Available deployment targets: ${describeDeploymentTargets(targets)}.`,
    );
  }

  const exactMatch = targets.find((item) => item.id === targetId);
  if (exactMatch) {
    return exactMatch;
  }

  const templateMatches = targets.filter(
    (item) => item.commandTemplateId === targetId,
  );
  if (templateMatches.length === 1) {
    return templateMatches[0];
  }

  if (targets.length === 1) {
    return targets[0];
  }

  throw new Error(
    `Capability ${capability.name} does not define deployment target ${targetId}. Available deployment targets: ${describeDeploymentTargets(targets)}.`,
  );
};

const executeCommandTemplate = async (
  capability: Capability,
  workItem: WorkItem | undefined,
  template: CapabilityExecutionCommandTemplate,
  workspacePath?: string,
  sandboxProfile: SandboxProfile = "workspace",
) => {
  const workingDirectory = template.workingDirectory
    ? await resolveWorkspacePath(
        capability,
        workItem,
        template.workingDirectory,
      )
    : await resolveWorkspacePath(capability, workItem, workspacePath);
  const result = await runSandboxedCommand({
    command: template.command,
    cwd: workingDirectory,
    workspacePath: workingDirectory,
    profile: sandboxProfile,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${template.label} failed in ${workingDirectory}: ${summarizeSandboxFailure(
        result.stderr,
        result.stdout,
      )}`,
    );
  }

  return {
    summary: `${template.label} completed successfully.`,
    workingDirectory,
    exitCode: result.exitCode,
    stdoutPreview: previewText(result.stdout),
    stderrPreview: previewText(result.stderr),
    sandboxProfile: result.sandboxProfile,
    details: {
      command: template.command,
      templateId: template.id,
      executionMode: result.executionMode,
    },
  } satisfies ToolExecutionResult;
};

const TOOL_REGISTRY: Record<ToolAdapterId, ToolAdapter> = {
  workspace_list: {
    id: "workspace_list",
    description: "List files inside the current desktop-user workspace path.",
    usageExample: '{"path":"src","limit":200,"cursor":"..."}',
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = await resolveWorkspacePath(
        capability,
        workItem,
        args.workspacePath || args.path,
      );
      const scopePath = args.path
        ? resolvePathWithinWorkspace(workspacePath, String(args.path))
        : workspacePath;
      const limit = clampLimit(args.limit, 200, 1000);
      const cursor =
        typeof args.cursor === "string" ? args.cursor.trim() : undefined;
      const result = await runProcess(
        "rg",
        ["--files", scopePath],
        workspacePath,
      );
      const paged =
        result.exitCode === 0
          ? paginateValues({
              values: result.stdout.split("\n").filter(Boolean),
              cursor,
              limit,
            })
          : isCommandMissing(result)
            ? {
                page: [],
                nextCursor: undefined,
                total: 0,
                truncated: false,
                ...(await listIndexedWorkspaceFiles({
                  workspacePath,
                  scopePath,
                  cursor,
                  limit,
                })),
              }
            : { page: [], nextCursor: undefined, total: 0, truncated: false };

      if (result.exitCode !== 0 && !isCommandMissing(result)) {
        throw new Error(
          `Unable to list files in ${workspacePath}: ${previewText(result.stderr || result.stdout)}`,
        );
      }

      return {
        summary: `Listed ${paged.page.length} files from ${workspacePath}.`,
        workingDirectory: workspacePath,
        stdoutPreview: previewText(paged.page.join("\n")),
        details: {
          files: paged.page,
          scopePath,
          total: paged.total,
          nextCursor: paged.nextCursor,
          truncated: paged.truncated,
          fallback: result.exitCode !== 0 ? "node-filesystem" : undefined,
        },
      };
    },
  },
  workspace_read: {
    id: "workspace_read",
    description:
      "Read a text file. Prefer passing `symbol` (an exact function/class name from the code index) to get JUST that symbol body plus ~10 lines of context instead of the whole file — this saves 80-95% of input tokens. Pass `includeCallers` (0-3) and/or `includeCallees` (0-3) to additionally surface neighbor-file paths + their top exported signatures so cross-method invariants stay in scope for refactors. Only omit `symbol` when you truly need the full file.",
    usageExample:
      '{"path":"src/auth/token.ts","symbol":"validateToken","includeCallers":2} (semantic hunk + 2 dependents) OR {"path":"README.md"} (whole file fallback)',
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = await resolveWorkspacePath(
        capability,
        workItem,
        args.workspacePath,
      );
      const requestedPath = getRequiredStringArg(
        args,
        "path",
        "workspace_read",
      );
      const targetPath = resolvePathWithinWorkspace(
        workspacePath,
        requestedPath,
      );
      const maxBytes = Math.max(
        256,
        Math.min(Number(args.maxBytes || 8000), 20000),
      );
      const requestedSymbol =
        typeof args.symbol === "string" && args.symbol.trim().length > 0
          ? args.symbol.trim()
          : null;
      const contextLines = Math.max(
        0,
        Math.min(Number(args.symbolContextLines ?? 10), 50),
      );
      const includeCallers = Math.max(
        0,
        Math.min(Number(args.includeCallers ?? 0), 3),
      );
      const includeCallees = Math.max(
        0,
        Math.min(Number(args.includeCallees ?? 0), 3),
      );
      const content = await fs.readFile(targetPath, "utf8");
      const relativePath = path
        .relative(workspacePath, targetPath)
        .replace(/\\/g, "/");
      const workItemRepositoryId =
        workItem?.executionContext?.primaryRepositoryId ||
        workItem?.executionContext?.branch?.repositoryId;

      // Retrieval Bundle (Phase 2 / Lever 6): when the agent asks for
      // a symbol with callers/callees, surface neighbor-file paths + up
      // to 3 of their top exported signatures each. We return paths and
      // signatures — NOT contents — so the agent can choose whether to
      // read them. Hard-capped at 6 neighbors total; the budgeter
      // handles further eviction upstream.
      const buildNeighborNote = async (): Promise<string> => {
        if (!capability.id || (includeCallers === 0 && includeCallees === 0)) {
          return "";
        }
        const [dependents, dependencies] = await Promise.all([
          includeCallers > 0
            ? findFileDependents(
                capability.id,
                relativePath,
                includeCallers,
              ).catch(() => [])
            : Promise.resolve([]),
          includeCallees > 0
            ? findFileDependencies(
                capability.id,
                relativePath,
                includeCallees,
              ).catch(() => [])
            : Promise.resolve([]),
        ]);
        const allNeighbors = [
          ...dependents.map((n) => ({ ...n, role: "caller" as const })),
          ...dependencies.map((n) => ({ ...n, role: "callee" as const })),
        ].slice(0, 6);
        if (allNeighbors.length === 0) return "";

        const sections: string[] = [];
        for (const neighbor of allNeighbors) {
          const exports = await listTopExportsInFile(
            capability.id,
            neighbor.filePath,
            3,
          ).catch(() => []);
          const sigLines = exports
            .map(
              (e) =>
                `    - ${e.isExported ? "export " : ""}${e.kind} ${e.symbolName}  (lines ${e.startLine}-${e.endLine})`,
            )
            .join("\n");
          sections.push(
            `  [${neighbor.role}] ${neighbor.filePath}${neighbor.moduleSpecifier ? ` (via "${neighbor.moduleSpecifier}")` : ""}${sigLines ? `\n${sigLines}` : ""}`,
          );
        }
        return `\n\n=== Related neighbors (file-level references) ===\n${sections.join("\n")}\n(Call workspace_read with these paths + a symbol to pull specific hunks.)`;
      };

      // Semantic-hunk path: caller asked for a specific symbol. Look up
      // start/end lines from the code index, slice just that region.
      if (requestedSymbol && capability.id) {
        const localRange =
          isRemoteExecutionClient() && workItem?.id && workItemRepositoryId
            ? await findLocalCheckoutSymbolRange({
                checkoutPath: workspacePath,
                capabilityId: capability.id,
                repositoryId: workItemRepositoryId,
                relativePath,
                symbolQuery: requestedSymbol,
              }).catch(() => null)
            : null;
        const range =
          localRange ||
          (await findSymbolRangeInFile(
            capability.id,
            relativePath,
            requestedSymbol,
          ).catch(() => null));
        if (range) {
          const allLines = content.split("\n");
          const semanticStartLine = Math.max(1, range.sliceStartLine || range.startLine);
          const semanticEndLine = Math.max(semanticStartLine, range.sliceEndLine || range.endLine);
          const sliceStart = Math.max(0, semanticStartLine - 1 - contextLines);
          const sliceEnd = Math.min(
            allLines.length,
            semanticEndLine + contextLines,
          );
          const hunkLines = allLines.slice(sliceStart, sliceEnd);
          // Prefix each line with its 1-based line number so the LLM can
          // reason about positions when asking for edits.
          const numbered = hunkLines
            .map(
              (line, idx) =>
                `${String(sliceStart + idx + 1).padStart(5, " ")}  ${line}`,
            )
            .join("\n");
          const neighborNote = await buildNeighborNote();
          const preview = previewText(numbered + neighborNote, maxBytes);
          return {
            summary: `Read ${relativePath} :: ${requestedSymbol} (${range.kind}, semantic lines ${semanticStartLine}-${semanticEndLine}, returned ${sliceStart + 1}-${sliceEnd})${neighborNote ? " + neighbors" : ""}.`,
            workingDirectory: workspacePath,
            stdoutPreview: preview,
            details: {
              path: targetPath,
              symbol: requestedSymbol,
              symbolId: range.symbolId,
              containerSymbolId: range.containerSymbolId,
              qualifiedSymbolName: range.qualifiedSymbolName,
              kind: range.kind,
              codeIndexSource:
                localRange?.source === "local-checkout"
                  ? "local-checkout"
                  : "capability-index",
              codeIndexFreshness:
                localRange?.source === "local-checkout"
                  ? localRange.builtAt
                  : undefined,
              startLine: range.startLine,
              endLine: range.endLine,
              semanticStartLine,
              semanticEndLine,
              sliceStartLine: sliceStart + 1,
              sliceEndLine: sliceEnd,
              contextLines,
              includeCallers,
              includeCallees,
              hasNeighbors: neighborNote.length > 0,
              mode: "semantic-hunk",
              compression: "none",
              truncated: preview.length > maxBytes,
            },
          };
        }
        // Symbol requested but not found — fall through to whole-file read
        // with a note so the agent knows to broaden or re-index.
        const neighborNote = await buildNeighborNote();
        const compressedContent = compressSnippet(content);
        const compression =
          compressedContent === content ? "none" : "blank-line-collapse";
        const output = compressedContent + neighborNote;
        return {
          summary: `Symbol "${requestedSymbol}" not found in code index for ${relativePath}. Returning whole file${neighborNote ? " + neighbors" : ""}.`,
          workingDirectory: workspacePath,
          stdoutPreview: previewText(output, maxBytes),
          details: {
            path: targetPath,
            symbol: requestedSymbol,
            mode: "whole-file-fallback",
            compression,
            codeIndexSource:
              isRemoteExecutionClient() && workItem?.id && workItemRepositoryId
                ? "local-checkout"
                : "capability-index",
            symbolLookupMissed: true,
            hasNeighbors: neighborNote.length > 0,
            truncated: output.length > maxBytes,
          },
        };
      }

      // Whole-file fallback (no symbol provided). Still honor neighbor
      // requests if the agent asked for them — useful for "read README
      // and tell me which files import it."
      const neighborNote = await buildNeighborNote();
      const compressedContent = compressSnippet(content);
      const compression =
        compressedContent === content ? "none" : "blank-line-collapse";
      const output = compressedContent + neighborNote;
      return {
        summary: `Read ${relativePath}${neighborNote ? " + neighbors" : ""}.`,
        workingDirectory: workspacePath,
        stdoutPreview: previewText(output, maxBytes),
        details: {
          path: targetPath,
          mode: "whole-file",
          compression,
          hasNeighbors: neighborNote.length > 0,
          truncated: output.length > maxBytes,
        },
      };
    },
  },
  workspace_search: {
    id: "workspace_search",
    description:
      "Search within the current desktop-user workspace for a string or regex pattern.",
    usageExample:
      '{"pattern":"Operator","path":"src","limit":100,"cursor":"..."}',
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      const pattern = getRequiredStringArg(args, "pattern", "workspace_search");

      const workspacePath = await resolveWorkspacePath(
        capability,
        workItem,
        args.workspacePath,
      );
      const scopePath = args.path
        ? resolvePathWithinWorkspace(workspacePath, String(args.path))
        : workspacePath;
      const limit = clampLimit(args.limit, 100, 500);
      const cursor =
        typeof args.cursor === "string" ? args.cursor.trim() : undefined;
      const workItemRepositoryId =
        workItem?.executionContext?.primaryRepositoryId ||
        workItem?.executionContext?.branch?.repositoryId;
      const relativeScopePath = path
        .relative(workspacePath, scopePath)
        .replace(/\\/g, "/");

      if (capability.id && looksLikeSymbolPattern(pattern)) {
        // Determine which checkout paths to search.
        // Priority 1: explicit work-item checkout (remote executor mode).
        // Priority 2: base clones registered at desktop claim time (chat / no workItem).
        const localCheckoutCandidates: Array<{ checkoutPath: string; repositoryId: string }> = [];

        if (isRemoteExecutionClient() && workItem?.id && workItemRepositoryId) {
          localCheckoutCandidates.push({ checkoutPath: workspacePath, repositoryId: workItemRepositoryId });
        }

        if (isRemoteExecutionClient() && capability.id && localCheckoutCandidates.length === 0) {
          const baseClones = getCapabilityBaseClones(capability.id).filter(e => e.isGitRepo);
          // Primary clone first.
          [...baseClones.filter(e => e.isPrimary), ...baseClones.filter(e => !e.isPrimary)].forEach(c =>
            localCheckoutCandidates.push({ checkoutPath: c.checkoutPath, repositoryId: c.repositoryId }),
          );
        }

        let localSymbolResults: Awaited<ReturnType<typeof searchLocalCheckoutSymbols>> | null = null;
        let localSymbolCheckoutRoot = "";
        for (const candidate of localCheckoutCandidates) {
          const result = await searchLocalCheckoutSymbols({
            checkoutPath: candidate.checkoutPath,
            capabilityId: capability.id,
            repositoryId: candidate.repositoryId,
            query: pattern,
            limit: Math.min(limit, 25),
          }).catch(() => null);
          if (result && result.symbols.length > 0) {
            localSymbolResults = result;
            localSymbolCheckoutRoot = candidate.checkoutPath.replace(/\/+$/, "");
            break;
          }
        }

        const filteredLocalSymbols =
          localSymbolResults?.symbols.filter((symbol) =>
            !relativeScopePath || relativeScopePath === "."
              ? true
              : symbol.filePath.startsWith(
                  `${relativeScopePath.replace(/\/+$/, "")}/`,
                ) || symbol.filePath === relativeScopePath,
          ) || [];
        if (filteredLocalSymbols.length > 0) {
          // Emit absolute paths so the agent never needs to guess directory layout.
          const toAbsPath = (relPath: string) =>
            localSymbolCheckoutRoot
              ? `${localSymbolCheckoutRoot}/${relPath.replace(/^\/+/, "")}`
              : relPath;
          const output = [
            ...(localSymbolCheckoutRoot ? [`Repository root: ${localSymbolCheckoutRoot}`, "Paths below are absolute — pass them directly to workspace_read."] : []),
            ...filteredLocalSymbols.map(
              (symbol) =>
                `${symbol.qualifiedSymbolName} (${symbol.kind}) ${toAbsPath(symbol.filePath)}:${symbol.sliceStartLine || symbol.startLine}-${symbol.sliceEndLine || symbol.endLine}`,
            ),
          ].join("\n");
          return {
            summary: `Found ${filteredLocalSymbols.length} indexed symbol match${filteredLocalSymbols.length === 1 ? "" : "es"} for ${pattern}.`,
            workingDirectory: workspacePath,
            exitCode: 0,
            stdoutPreview: previewText(output),
            details: {
              pattern,
              scopePath,
              matches: filteredLocalSymbols.map((symbol) => ({
                symbolId: symbol.symbolId,
                qualifiedSymbolName: symbol.qualifiedSymbolName,
                symbolName: symbol.symbolName,
                kind: symbol.kind,
                filePath: toAbsPath(symbol.filePath),
                sliceStartLine: symbol.sliceStartLine,
                sliceEndLine: symbol.sliceEndLine,
                checkoutRoot: localSymbolCheckoutRoot || undefined,
              })),
              totalScanned: filteredLocalSymbols.length,
              mode: "symbol-search",
              codeIndexSource: "local-checkout",
              codeIndexFreshness: localSymbolResults?.builtAt,
            },
          };
        }

        const indexedMatches = (await searchCodeSymbols(capability.id, pattern, {
          limit: Math.min(limit, 25),
        }).catch(() => []))
          .filter((symbol) =>
            !relativeScopePath || relativeScopePath === "."
              ? true
              : symbol.filePath.startsWith(
                  `${relativeScopePath.replace(/\/+$/, "")}/`,
                ) || symbol.filePath === relativeScopePath,
          );
        if (indexedMatches.length > 0) {
          const output = indexedMatches
            .map(
              (symbol) =>
                `${symbol.qualifiedSymbolName} (${symbol.kind}) ${symbol.filePath}:${symbol.sliceStartLine || symbol.startLine}-${symbol.sliceEndLine || symbol.endLine}`,
            )
            .join("\n");
          return {
            summary: `Found ${indexedMatches.length} indexed symbol match${indexedMatches.length === 1 ? "" : "es"} for ${pattern}.`,
            workingDirectory: workspacePath,
            exitCode: 0,
            stdoutPreview: previewText(output),
            details: {
              pattern,
              scopePath,
              matches: indexedMatches.map((symbol) => ({
                symbolId: symbol.symbolId,
                qualifiedSymbolName: symbol.qualifiedSymbolName,
                symbolName: symbol.symbolName,
                kind: symbol.kind,
                filePath: symbol.filePath,
                sliceStartLine: symbol.sliceStartLine,
                sliceEndLine: symbol.sliceEndLine,
              })),
              totalScanned: indexedMatches.length,
              mode: "symbol-search",
              codeIndexSource: "capability-index",
            },
          };
        }
      }

      const result = await runProcess(
        "rg",
        ["-n", pattern, scopePath],
        workspacePath,
      );
      const paged = isCommandMissing(result)
        ? await searchIndexedWorkspaceFiles({
            workspacePath,
            scopePath,
            pattern,
            cursor,
            limit,
          })
        : {
            matches: paginateValues({
              values: (result.stdout || result.stderr)
                .split("\n")
                .filter(Boolean),
              cursor,
              limit,
            }).page,
            totalScanned: (result.stdout || result.stderr)
              .split("\n")
              .filter(Boolean).length,
            nextCursor: paginateValues({
              values: (result.stdout || result.stderr)
                .split("\n")
                .filter(Boolean),
              cursor,
              limit,
            }).nextCursor,
            truncated: paginateValues({
              values: (result.stdout || result.stderr)
                .split("\n")
                .filter(Boolean),
              cursor,
              limit,
            }).truncated,
          };
      const output = paged.matches.join("\n");

      return {
        summary:
          result.exitCode === 0 || paged.matches.length > 0
            ? `Search completed for pattern ${pattern}.`
            : `Search found no matches for pattern ${pattern}.`,
        workingDirectory: workspacePath,
        exitCode: isCommandMissing(result)
          ? paged.matches.length > 0
            ? 0
            : 1
          : result.exitCode,
        stdoutPreview: previewText(output),
        details: {
          pattern,
          scopePath,
          matches: paged.matches,
          nextCursor: paged.nextCursor,
          totalScanned: paged.totalScanned,
          truncated: paged.truncated,
          mode: "text-search",
          fallback: isCommandMissing(result) ? "node-filesystem" : undefined,
        },
      };
    },
  },
  browse_code: {
    id: "browse_code",
    description:
      "Browse the AST symbol index for this capability's repositories. " +
      "Use kind='class'|'function'|'interface'|'method'|'type'|'enum'|'variable' to filter. " +
      "Returns symbol names, file paths, and line ranges from the local base clone. " +
      "Does NOT require cloning — uses the pre-synced _repos/ directory. " +
      "Use this to discover API endpoints, service contracts, interfaces, and top-level exports.",
    usageExample: '{"kind":"interface","limit":30}',
    retryable: true,
    execute: async ({ capability }, args) => {
      if (!capability.id) {
        throw new Error("browse_code requires a capability context.");
      }

      const kindRaw = String(args.kind || "").trim().toLowerCase();
      const validKinds = new Set(["class", "function", "interface", "method", "type", "enum", "variable", "property"]);
      const kind = validKinds.has(kindRaw) ? (kindRaw as any) : undefined;
      const filePathPrefix = String(args.filePathPrefix || args.path || "").trim() || undefined;
      const limitRaw = Number(args.limit);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 100)) : 30;

      // Try local base clones first.
      const baseClones = isRemoteExecutionClient()
        ? getCapabilityBaseClones(capability.id).filter(e => e.isGitRepo)
        : [];

      if (baseClones.length === 0) {
        // Fall back to DB index.
        const dbResults = await searchCodeSymbols(capability.id, kindRaw || "*", { limit: limit as any }).catch(() => []);
        if (dbResults.length === 0) {
          return {
            summary: "No local base clones available and no DB code index found. Run repo-sync first.",
            details: { symbols: [], source: "none" },
          };
        }
        const output = dbResults
          .map(s => `${s.qualifiedSymbolName || s.symbolName} (${s.kind}) ${s.filePath}:${s.sliceStartLine}-${s.sliceEndLine}`)
          .join("\n");
        return {
          summary: `Found ${dbResults.length} symbol(s) from DB code index.`,
          stdoutPreview: previewText(output),
          details: { symbols: dbResults, source: "capability-index" },
        };
      }

      // Track symbols with their checkout root so we can emit absolute paths.
      const allSymbols: Array<any & { _checkoutRoot: string }> = [];
      const repoSummaries: string[] = [];
      for (const clone of [...baseClones.filter(e => e.isPrimary), ...baseClones.filter(e => !e.isPrimary)]) {
        const cloneRoot = clone.checkoutPath.replace(/\/+$/, "");
        const { symbols, builtAt } = await listLocalCheckoutAllSymbols({
          checkoutPath: clone.checkoutPath,
          capabilityId: capability.id,
          repositoryId: clone.repositoryId,
          kind,
          filePathPrefix,
          limit,
        }).catch(() => ({ symbols: [] as any[], builtAt: undefined }));
        symbols.forEach(s => allSymbols.push({ ...s, _checkoutRoot: cloneRoot }));
        repoSummaries.push(
          `${clone.repositoryLabel} (root: ${cloneRoot}): ${symbols.length} symbol(s)` +
          ` (indexed ${builtAt ? new Date(builtAt).toLocaleString() : "pending"})`,
        );
        if (allSymbols.length >= limit) break;
      }

      const sliced = allSymbols.slice(0, limit);
      // Always emit absolute paths — the agent must NOT construct paths manually.
      const toAbsolute = (s: any) =>
        `${s._checkoutRoot}/${String(s.filePath).replace(/^\/+/, "")}`;
      const output = [
        "NOTE: Paths below are absolute. Pass them directly to workspace_read.",
        "Do NOT cd to or construct directory paths — only these paths exist on disk.",
        "",
        ...sliced.map(s =>
          `${s.qualifiedSymbolName || s.symbolName} (${s.kind}) ${toAbsolute(s)}:${s.sliceStartLine ?? s.startLine}-${s.sliceEndLine ?? s.endLine}`,
        ),
      ].join("\n");

      return {
        summary: `Found ${sliced.length} ${kind ? kind + " " : ""}symbol(s) across ${baseClones.length} repo(s).`,
        stdoutPreview: previewText(`Repositories:\n${repoSummaries.join("\n")}\n\nSymbols:\n${output}`),
        details: {
          symbols: sliced.map(s => ({
            symbolName: s.symbolName,
            qualifiedSymbolName: s.qualifiedSymbolName,
            kind: s.kind,
            filePath: toAbsolute(s),
            startLine: s.sliceStartLine ?? s.startLine,
            endLine: s.sliceEndLine ?? s.endLine,
            signature: s.signature,
            isExported: s.isExported,
            repositoryId: s.repositoryId,
            checkoutRoot: s._checkoutRoot,
          })),
          source: "local-clone",
          repositories: repoSummaries,
        },
      };
    },
  },
  git_status: {
    id: "git_status",
    description: "Inspect git status for the current desktop-user workspace repository.",
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = await resolveWorkspacePath(
        capability,
        workItem,
        args.workspacePath,
      );
      const result = await runProcess(
        "git",
        ["-C", workspacePath, "status", "--short", "--branch"],
        workspacePath,
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `git status failed in ${workspacePath}: ${previewText(result.stderr || result.stdout)}`,
        );
      }

      return {
        summary: `Loaded git status for ${workspacePath}.`,
        workingDirectory: workspacePath,
        stdoutPreview: previewText(result.stdout),
      };
    },
  },
  workspace_write: {
    id: "workspace_write",
    description:
      "Create a NEW file at `path` with `content`. For edits to EXISTING files, use `workspace_apply_patch` (preferred) or `workspace_replace_block` instead — they are dramatically cheaper in output tokens and surface cleaner diffs to reviewers. Repeated `workspace_write` on an existing file will be REJECTED after the first attempt; use patch tools.",
    usageExample: '{"path":"src/main/java/App.java","content":"..."}',
    retryable: false,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = await resolveWorkspacePath(
        capability,
        workItem,
        args.workspacePath,
      );
      const targetPath = resolvePathWithinWorkspace(
        workspacePath,
        getRequiredStringArg(args, "path", "workspace_write"),
      );
      const content = String(args.content || "");

      // Diff-Enforcement Policy (Phase 2 / Lever 9). If the file already
      // exists, this is an edit-via-write. After 1 such attempt we
      // reject further attempts on the same file with a recoverable
      // error so the agent re-enters the tool loop and picks a patch
      // tool. Exception: if the agent already failed to apply patches
      // to this path ≥ 2 times, we let the write through as a last
      // resort — assumes the edit legitimately can't be expressed as a
      // diff.
      const ctx = currentToolInvocationContext();
      let fileExisted = false;
      try {
        await fs.stat(targetPath);
        fileExisted = true;
      } catch {
        fileExisted = false;
      }
      let diffWarning: string | null = null;
      if (fileExisted) {
        const prior = getWriteAttempts(ctx.runStepId, targetPath);
        const patchFailures = getPatchFailures(ctx.runStepId, targetPath);
        if (prior >= 1 && patchFailures < 2) {
          throw new DiffEnforcementError(
            `workspace_write refused on existing file "${path.relative(workspacePath, targetPath)}" (attempt ${prior + 1}). Use workspace_apply_patch or workspace_replace_block — they are cheaper and produce reviewable diffs. If the edit truly cannot be expressed as a patch, retry workspace_write after two patch attempts fail.`,
          );
        }
        bumpWriteAttempts(ctx.runStepId, targetPath);
        diffWarning =
          patchFailures >= 2
            ? `Allowed workspace_write on existing file after ${patchFailures} patch failure${patchFailures === 1 ? "" : "s"} — fallback path.`
            : `NOTE: workspace_write on existing file. Prefer workspace_apply_patch / workspace_replace_block for subsequent edits.`;
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, "utf8");

      return {
        summary: diffWarning
          ? `Wrote ${path.relative(workspacePath, targetPath)} (${diffWarning})`
          : `Wrote ${path.relative(workspacePath, targetPath)}.`,
        workingDirectory: workspacePath,
        details: {
          path: targetPath,
          touchedPaths: [targetPath],
          bytesWritten: Buffer.byteLength(content, "utf8"),
          fileExisted,
          diffPolicyWarning: diffWarning,
        },
      };
    },
  },
  workspace_replace_block: {
    id: "workspace_replace_block",
    description:
      "PREFERRED for targeted single-block edits to existing files. Provide `find` (must match the existing text exactly) and `replace`. Far cheaper than rewriting the whole file with `workspace_write` and safer than free-form patches. Use this for simple in-place changes to an existing function or block.",
    usageExample:
      '{"path":"src/App.tsx","find":"const oldValue = 1;","replace":"const oldValue = 2;","expectedMatches":1}',
    retryable: false,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = await resolveWorkspacePath(
        capability,
        workItem,
        args.workspacePath,
      );
      const targetPath = resolvePathWithinWorkspace(
        workspacePath,
        getRequiredStringArg(args, "path", "workspace_replace_block"),
      );
      const find = getRequiredRawStringArg(
        args,
        "find",
        "workspace_replace_block",
      );
      const replace = String(args.replace ?? "");
      const expectedMatches = clampLimit(args.expectedMatches, 1, 1000);
      const replaceAll = Boolean(args.replaceAll);
      const current = await fs.readFile(targetPath, "utf8");
      const matchCount = current.split(find).length - 1;

      // Record patch failures so the Diff-Enforcement Policy knows
      // when to relax and allow workspace_write as a fallback.
      const replaceCtx = currentToolInvocationContext();
      if (matchCount === 0) {
        recordPatchFailure(replaceCtx.runStepId, targetPath);
        throw new Error(`Could not find the requested block in ${targetPath}.`);
      }
      if (matchCount !== expectedMatches) {
        recordPatchFailure(replaceCtx.runStepId, targetPath);
        throw new Error(
          `Expected ${expectedMatches} block match(es) in ${targetPath}, but found ${matchCount}.`,
        );
      }

      const nextContent = replaceAll
        ? current.split(find).join(replace)
        : current.replace(find, replace);
      await fs.writeFile(targetPath, nextContent, "utf8");

      return {
        summary: `Replaced ${matchCount} block match(es) in ${path.relative(workspacePath, targetPath)}.`,
        workingDirectory: workspacePath,
        details: {
          path: targetPath,
          touchedPaths: [targetPath],
          matchCount,
          bytesWritten: Buffer.byteLength(nextContent, "utf8"),
        },
      };
    },
  },
  workspace_apply_patch: {
    id: "workspace_apply_patch",
    description:
      "PREFERRED for editing existing files. Accepts a standard unified diff (git-style) and applies it in place. Output ONLY the diff hunks — never the full file. Strongly prefer this tool over `workspace_write` for any modification to code that already exists, since it uses a fraction of the output tokens and produces reviewable diffs.",
    usageExample:
      '{"patchText":"diff --git a/src/App.tsx b/src/App.tsx\\n--- a/src/App.tsx\\n+++ b/src/App.tsx\\n@@ ..."}',
    retryable: false,
    execute: async ({ capability, workItem }, args) => {
      const workspacePath = await resolveWorkspacePath(
        capability,
        workItem,
        args.workspacePath,
      );
      const patchText = getRequiredRawStringArg(
        args,
        "patchText",
        "workspace_apply_patch",
      );
      const touchedRelativePaths = extractPatchTouchedFiles(patchText);
      if (touchedRelativePaths.length === 0) {
        throw new Error(
          "workspace_apply_patch requires at least one touched file in the patch.",
        );
      }
      const touchedPaths = touchedRelativePaths.map((relativePath) =>
        resolvePathWithinWorkspace(workspacePath, relativePath),
      );

      const result = await runProcessWithInput({
        command: "git",
        args: [
          "apply",
          "--recount",
          "--reject",
          "--whitespace=nowarn",
          "--verbose",
          "-",
        ],
        cwd: workspacePath,
        stdin: patchText,
      });

      if (result.exitCode !== 0) {
        // Record the failure per touched path so the Diff-Enforcement
        // Policy eventually allows workspace_write as a last resort.
        const patchCtx = currentToolInvocationContext();
        for (const touched of touchedPaths) {
          recordPatchFailure(patchCtx.runStepId, touched);
        }
        throw new Error(
          `Unable to apply patch in ${workspacePath}: ${previewText(result.stderr || result.stdout)}`,
        );
      }

      return {
        summary: `Applied patch touching ${touchedRelativePaths.length} file(s).`,
        workingDirectory: workspacePath,
        stdoutPreview: previewText(result.stdout || result.stderr),
        details: {
          touchedPaths,
          touchedRelativePaths,
        },
      };
    },
  },
  delegate_task: {
    id: "delegate_task",
    description:
      "Delegate a bounded specialist subtask to another agent inside the current capability execution.",
    usageExample:
      '{"delegatedAgentId":"AGENT-...","title":"Inspect failing tests","prompt":"Review the latest test failures and summarize the root cause."}',
    retryable: false,
    execute: async () => {
      throw new Error(
        "delegate_task is orchestrated by the execution service and cannot be executed outside an active workflow run.",
      );
    },
  },
  run_build: {
    id: "run_build",
    description: "Run the approved build command template.",
    usageExample: '{"templateId":"build"}',
    retryable: true,
    execute: async ({ capability, workItem }, args) =>
      executeCommandTemplate(
        capability,
        workItem,
        resolveCommandTemplate(capability, String(args.templateId || "build")),
        args.workspacePath,
        "build",
      ),
  },
  run_test: {
    id: "run_test",
    description: "Run the approved test command template.",
    usageExample: '{"templateId":"test"}',
    retryable: true,
    execute: async ({ capability, workItem }, args) =>
      executeCommandTemplate(
        capability,
        workItem,
        resolveCommandTemplate(capability, String(args.templateId || "test")),
        args.workspacePath,
        "test",
      ),
  },
  run_docs: {
    id: "run_docs",
    description: "Run the approved docs command template.",
    usageExample: '{"templateId":"docs"}',
    retryable: true,
    execute: async ({ capability, workItem }, args) =>
      executeCommandTemplate(
        capability,
        workItem,
        resolveCommandTemplate(capability, String(args.templateId || "docs")),
        args.workspacePath,
        "docs",
      ),
  },
  run_deploy: {
    id: "run_deploy",
    description:
      "Execute an approved deployment target using a named command template after approval.",
    usageExample: '{"targetId":"staging"}',
    retryable: false,
    execute: async (
      { capability, workItem, requireApprovedDeployment },
      args,
    ) => {
      if (!requireApprovedDeployment) {
        throw new Error(
          "Deployment commands are approval-gated and cannot run until the release approval step is resolved.",
        );
      }

      const target = resolveDeploymentTarget(
        capability,
        typeof args.targetId === "string" ? args.targetId : undefined,
      );

      const template = resolveCommandTemplate(
        capability,
        target.commandTemplateId,
      );
      if (template.requiresApproval === false) {
        throw new Error(
          `Deployment template ${template.id} must remain approval-gated in this environment.`,
        );
      }

      return executeCommandTemplate(
        capability,
        workItem,
        template,
        target.workspacePath || args.workspacePath,
        "deploy",
      );
    },
  },
  publish_bounty: {
    id: "publish_bounty",
    description:
      "Experimental: broadcast an in-process bounty request to other agents in the current desktop runtime.",
    usageExample:
      '{"bountyId":"req-123","targetRole":"Backend","instructions":"..."}',
    retryable: false,
    execute: async ({ capability, agent }, args) => {
      const bountyId = getRequiredStringArg(args, "bountyId", "publish_bounty");
      const instructions = getRequiredStringArg(
        args,
        "instructions",
        "publish_bounty",
      );
      const targetRole = args.targetRole ? String(args.targetRole) : undefined;

      if (getPublishedBounty(bountyId) || getPublishedBountySignal(bountyId)) {
        throw new Error(
          `Bounty ${bountyId} already exists in this runtime. Use a new bountyId instead of retrying the same publish request.`,
        );
      }

      publishBounty({
        id: bountyId,
        capabilityId: capability.id,
        sourceAgentId: agent.id,
        targetRole,
        instructions,
        status: "OPEN",
        createdAt: new Date().toISOString(),
        timeoutMs: Number(args.timeoutMs) || undefined,
      });

      return {
        summary: `Published experimental bounty ${bountyId}. Only the publishing agent may wait on it, and only an eligible peer may resolve it in this runtime.`,
        details: { bountyId, targetRole, experimental: true },
      };
    },
  },
  resolve_bounty: {
    id: "resolve_bounty",
    description:
      "Experimental: resolve an active in-process bounty published by another agent in the same runtime.",
    usageExample:
      '{"bountyId":"req-123","status":"RESOLVED","resultSummary":"Created route"}',
    retryable: false,
    execute: async ({ capability, agent }, args) => {
      const bountyId = getRequiredStringArg(args, "bountyId", "resolve_bounty");
      const status = args.status === "FAILED" ? "FAILED" : "RESOLVED";
      const resultSummary = args.resultSummary
        ? String(args.resultSummary)
        : undefined;
      const bounty = getPublishedBounty(bountyId);

      if (!bounty) {
        throw new Error(`Bounty ${bountyId} is not active in this runtime.`);
      }
      if (bounty.capabilityId !== capability.id) {
        throw new Error(
          `Bounty ${bountyId} belongs to another capability runtime.`,
        );
      }
      if (bounty.sourceAgentId === agent.id) {
        throw new Error(
          `Agent ${agent.id} cannot resolve its own bounty ${bountyId}.`,
        );
      }
      if (!agentMatchesBountyRole(agent, bounty.targetRole)) {
        throw new Error(
          `Bounty ${bountyId} targets role ${bounty.targetRole}, which does not match ${agent.role}.`,
        );
      }

      publishBountySignal({
        bountyId,
        status,
        resultSummary,
        resolvedByAgentId: agent.id,
        resolvedAt: new Date().toISOString(),
      });

      return {
        summary: `Resolved experimental bounty ${bountyId} with status ${status}.`,
        details: { bountyId, status, experimental: true },
      };
    },
  },
  wait_for_signal: {
    id: "wait_for_signal",
    description:
      "Experimental: wait for an in-process bounty published by this same agent to be resolved.",
    usageExample: '{"bountyId":"req-123"}',
    retryable: false,
    execute: async ({ capability, agent }, args) => {
      const bountyId = getRequiredStringArg(
        args,
        "bountyId",
        "wait_for_signal",
      );
      const timeoutMs = Number(args.timeoutMs) || 60000; // default 1 minute
      const bounty = getPublishedBounty(bountyId);
      const priorSignal = getPublishedBountySignal(bountyId);

      if (bounty) {
        if (bounty.capabilityId !== capability.id) {
          throw new Error(
            `Bounty ${bountyId} belongs to another capability runtime.`,
          );
        }
        if (bounty.sourceAgentId !== agent.id) {
          throw new Error(
            `Only the publishing agent ${bounty.sourceAgentId} may wait on bounty ${bountyId}.`,
          );
        }
      } else if (!priorSignal) {
        throw new Error(`Bounty ${bountyId} is not active in this runtime.`);
      }

      try {
        const result = await waitForBountySignal(bountyId, timeoutMs);
        return {
          summary: `Experimental bounty ${bountyId} was signaled with status: ${result.status}`,
          details: {
            resolvedByAgentId: result.resolvedByAgentId,
            resultSummary: result.resultSummary,
            payload: result.detailPayload,
            experimental: true,
          },
        };
      } catch (err: any) {
        throw new Error(
          err.message || "Error occurred while waiting for signal",
        );
      }
    },
  },
};

export const getToolAdapter = (toolId: ToolAdapterId) => {
  const adapter = TOOL_REGISTRY[toolId];
  if (!adapter) {
    throw new Error(`Tool adapter ${toolId} is not registered.`);
  }
  return adapter;
};

export const listToolDescriptions = (toolIds: ToolAdapterId[]) =>
  toolIds.map((toolId) => {
    const adapter = getToolAdapter(toolId);
    return `- ${adapter.id}: ${adapter.description}${adapter.usageExample ? ` Example args: ${adapter.usageExample}` : ""}`;
  });

const SHADOW_MOCKED_TOOLS = new Set([
  "workspace_write",
  "workspace_replace_block",
  "workspace_apply_patch",
  "run_build",
  "run_test",
  "run_docs",
  "run_deploy",
]);

const WRITE_LOCK_TOOLS = new Set<ToolAdapterId>([
  "workspace_write",
  "workspace_replace_block",
  "workspace_apply_patch",
]);

/**
 * Diff-Enforcement Policy (Phase 2 / Lever 9).
 *
 * We track per-(runStep, path) counters so the policy state is scoped
 * to the current execution tick. Keys age out after 30 minutes — long
 * enough to survive a slow run, short enough not to leak memory.
 *
 * Rules:
 *   - 1st `workspace_write` attempt on an existing file: allowed, but
 *     the summary carries a warning nudging the agent toward patches.
 *   - 2nd attempt on the same file: REJECTED with a recoverable error
 *     so the agent re-enters the tool loop and picks a patch tool.
 *   - 3rd+ attempt: allowed as an escape hatch — assumed the agent
 *     couldn't make a patch stick after two genuine attempts.
 *   - `workspace_apply_patch` / `workspace_replace_block` failures
 *     increment a separate "patch failures" counter that relaxes the
 *     block on the next write attempt (belt-and-suspenders).
 */
interface EditPolicyEntry {
  writeAttemptsOnExisting: number;
  patchFailuresByPath: Map<string, number>;
  lastTouched: number;
}
const editPolicyTrackers = new Map<string, EditPolicyEntry>();
const EDIT_POLICY_TTL_MS = 30 * 60 * 1000;

const pruneEditPolicy = () => {
  const now = Date.now();
  for (const [key, entry] of editPolicyTrackers) {
    if (now - entry.lastTouched > EDIT_POLICY_TTL_MS) {
      editPolicyTrackers.delete(key);
    }
  }
};

const getEditPolicyEntry = (
  runStepId: string | undefined,
  path: string,
): EditPolicyEntry | null => {
  if (!runStepId) return null;
  pruneEditPolicy();
  const key = `${runStepId}:${path}`;
  let entry = editPolicyTrackers.get(key);
  if (!entry) {
    entry = {
      writeAttemptsOnExisting: 0,
      patchFailuresByPath: new Map(),
      lastTouched: Date.now(),
    };
    editPolicyTrackers.set(key, entry);
  }
  entry.lastTouched = Date.now();
  return entry;
};

const recordPatchFailure = (runStepId: string | undefined, path: string) => {
  const entry = getEditPolicyEntry(runStepId, path);
  if (!entry) return;
  entry.patchFailuresByPath.set(
    path,
    (entry.patchFailuresByPath.get(path) || 0) + 1,
  );
};

const getWriteAttempts = (
  runStepId: string | undefined,
  path: string,
): number => {
  if (!runStepId) return 0;
  return (
    editPolicyTrackers.get(`${runStepId}:${path}`)?.writeAttemptsOnExisting ?? 0
  );
};

const bumpWriteAttempts = (runStepId: string | undefined, path: string) => {
  const entry = getEditPolicyEntry(runStepId, path);
  if (entry) entry.writeAttemptsOnExisting += 1;
};

const getPatchFailures = (
  runStepId: string | undefined,
  path: string,
): number => {
  if (!runStepId) return 0;
  return (
    editPolicyTrackers
      .get(`${runStepId}:${path}`)
      ?.patchFailuresByPath.get(path) ?? 0
  );
};

export class DiffEnforcementError extends Error {
  readonly recoverable = true;
  constructor(message: string) {
    super(message);
    this.name = "DiffEnforcementError";
  }
}

// Async-local context so adapters can read the current runStepId without
// a signature change on every adapter. Populated in executeTool before
// the adapter runs.
interface ToolInvocationContext {
  runStepId?: string;
  runId?: string;
  stepName?: string;
}
const toolInvocationContextStorage =
  new AsyncLocalStorage<ToolInvocationContext>();
const currentToolInvocationContext = (): ToolInvocationContext =>
  toolInvocationContextStorage.getStore() || {};

export const executeTool = async ({
  capability,
  agent,
  workItem,
  toolId,
  args,
  requireApprovedDeployment,
  runId,
  runStepId,
  stepName,
}: {
  capability: Capability;
  agent: CapabilityAgent;
  workItem?: WorkItem;
  toolId: ToolAdapterId;
  args: Record<string, any>;
  requireApprovedDeployment?: boolean;
  runId?: string;
  runStepId?: string;
  stepName?: string;
}) => {
  const adapter = getToolAdapter(toolId);

  if (
    capability.executionConfig?.executionMode === "SHADOW" &&
    SHADOW_MOCKED_TOOLS.has(toolId)
  ) {
    return {
      summary: `[SHADOW MODE INTERCEPT]: Simulated successful execution of ${toolId}.`,
      workingDirectory:
        capability.executionConfig.defaultWorkspacePath || "/shadow",
      exitCode: 0,
      stdoutPreview:
        "Shadow mode simulation successful. No actual changes were made.",
      stderrPreview: "",
      sandboxProfile: "shadow",
      details: { shadowIntercept: true, simulated: true, originalArgs: args },
      retryable: false,
    };
  }

  if (WRITE_LOCK_TOOLS.has(toolId) && runId && runStepId) {
    await acquireWorkspaceWriteLock({
      capabilityId: capability.id,
      runStepId,
      runId,
      agentId: agent.id,
      stepName: stepName ?? toolId,
    });
  }

  try {
    // Run inside an AsyncLocalStorage frame so downstream adapters can
    // consult `currentToolInvocationContext()` for the runStepId (used
    // by the Diff Enforcement Policy without a signature change).
    const result = await toolInvocationContextStorage.run(
      { runStepId, runId, stepName },
      () =>
        adapter.execute(
          { capability, agent, workItem, requireApprovedDeployment },
          args,
        ),
    );

    return {
      ...result,
      retryable: adapter.retryable,
    };
  } finally {
    if (WRITE_LOCK_TOOLS.has(toolId) && runId && runStepId) {
      await releaseWorkspaceWriteLock({
        capabilityId: capability.id,
        runStepId,
      });
    }
  }
};
