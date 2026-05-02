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
import {
  TOOL_ADAPTER_IDS,
  getProviderFunctionToolIds,
  getReadOnlyToolIds,
  getToolCatalogEntry,
} from "../../src/lib/toolCatalog";
import type { ProviderTool } from "../localOpenAIProvider";
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
  queueLocalCheckoutAstRefresh,
  searchLocalCheckoutSymbols,
} from "../localCodeIndex";
import {
  getPrimaryBaseClone,
} from "../desktopRepoSync";
import { buildWorkItemCheckoutPath } from "../workItemCheckouts";
import { buildCodeSearchCandidates, looksLikeSymbolPattern } from "../codeDiscovery";
import {
  canonicalizeRepoBackedPath,
  findContainingCodeRoot,
  resolveCapabilityCodeRoots,
  type RequestedPathKind,
  type ResolvedCodeRoot,
} from "../codeRoots";

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

export type ToolAdapter = {
  id: ToolAdapterId;
  description: string;
  usageExample?: string;
  parameterSchema?: Record<string, unknown>;
  retryable: boolean;
  execute: (
    context: ToolExecutionContext,
    args: Record<string, any>,
  ) => Promise<ToolExecutionResult>;
};

const toolDescription = (toolId: ToolAdapterId) =>
  getToolCatalogEntry(toolId).description;

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

const TOP_LEVEL_SYMBOL_KINDS = new Set(["class", "interface", "enum", "type"]);
const INVENTORY_CODE_QUESTION_TYPES = new Set(["inventory", "count"]);

const isTopLevelSymbol = (symbol: { kind?: string; parentSymbol?: string }) =>
  TOP_LEVEL_SYMBOL_KINDS.has(String(symbol.kind || "").toLowerCase()) &&
  !String(symbol.parentSymbol || "").trim();

const promoteParentSymbols = <T extends {
  filePath?: string;
  symbolId?: string;
  symbolName?: string;
  qualifiedSymbolName?: string;
  parentSymbol?: string;
  kind?: string;
}>(
  symbols: T[],
  questionType?: string,
) => {
  if (!INVENTORY_CODE_QUESTION_TYPES.has(String(questionType || ""))) {
    return symbols;
  }

  const byFile = new Map<string, T[]>();
  for (const symbol of symbols) {
    const filePath = String(symbol.filePath || "").trim();
    if (!filePath) continue;
    const current = byFile.get(filePath) || [];
    current.push(symbol);
    byFile.set(filePath, current);
  }

  const promoted: T[] = [];
  const seen = new Set<string>();
  const add = (symbol: T) => {
    const key =
      String(symbol.symbolId || "").trim() ||
      `${String(symbol.filePath || "")}:${String(symbol.qualifiedSymbolName || symbol.symbolName || "")}:${String(symbol.kind || "")}`;
    if (seen.has(key)) return;
    seen.add(key);
    promoted.push(symbol);
  };

  for (const symbol of symbols) {
    const fileSymbols = byFile.get(String(symbol.filePath || "").trim()) || [];
    const parentName =
      String(symbol.parentSymbol || "").trim() ||
      String(symbol.qualifiedSymbolName || "")
        .split(".")
        .slice(0, -1)
        .join(".");
    const parentSimpleName = parentName.split(".").filter(Boolean).pop();
    const matchingParent = fileSymbols.find(candidate => {
      if (!isTopLevelSymbol(candidate)) return false;
      const candidateName = String(candidate.symbolName || "").trim();
      const candidateQualifiedName = String(candidate.qualifiedSymbolName || "").trim();
      return (
        candidateName === parentName ||
        candidateQualifiedName === parentName ||
        Boolean(parentSimpleName && candidateName === parentSimpleName)
      );
    });
    if (matchingParent) {
      add(matchingParent);
    }
    add(symbol);
  }

  return promoted;
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

const summarizeSchemaArguments = (schema?: Record<string, unknown>) => {
  const properties =
    schema && typeof schema === "object"
      ? ((schema.properties as Record<string, { type?: string; description?: string }> | undefined) ||
          undefined)
      : undefined;
  if (!properties || Object.keys(properties).length === 0) {
    return "";
  }

  return Object.entries(properties)
    .map(([key, definition]) => {
      const type = String(definition?.type || "value");
      return `${key}:${type}`;
    })
    .join(", ");
};

type ResolvedWorkspaceContext = {
  workspacePath: string;
  approvedRoots: string[];
  workingDirectoryPath?: string;
  localRootPath?: string;
};

const resolveWorkspaceContext = async (
  capability: Capability,
  workItem?: WorkItem,
  preferredPath?: string,
) : Promise<ResolvedWorkspaceContext> => {
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

    // ── Workspace resolution diagnostics ────────────────────────
    console.log(`[resolveWorkspacePath] REMOTE branch | cap=${capability.name} | capId=${capability.id}`);
    console.log(`[resolveWorkspacePath]   resolution.localRootPath=${resolution.localRootPath || 'EMPTY'}`);
    console.log(`[resolveWorkspacePath]   resolution.workingDirectoryPath=${resolution.workingDirectoryPath || 'EMPTY'}`);
    console.log(`[resolveWorkspacePath]   resolution.approvedWorkspaceRoots=${JSON.stringify(resolution.approvedWorkspaceRoots)}`);
    console.log(`[resolveWorkspacePath]   resolution.validation=${JSON.stringify(resolution.validation)}`);
    // ────────────────────────────────────────────────────────────

    const allowed =
      resolution.approvedWorkspaceRoots.length > 0
        ? resolution.approvedWorkspaceRoots
        : [resolution.localRootPath];
    const workItemRepository = (capability.repositories || []).find(
      (repository) => repository.id === workItemRepositoryId,
    );
    const rawBaseClonePath =
      !workItem?.id && capability.id
        ? normalizeDirectoryPath(
            getPrimaryBaseClone(capability.id)?.checkoutPath || "",
          )
        : "";
    // Only trust the base clone path if it lives under the operator's
    // working directory. Stale clones under the SingularityNeo project
    // root (from before the operator configured their working directory)
    // must not shadow the correct resolution.
    const baseClonePath =
      rawBaseClonePath &&
      resolution.workingDirectoryPath &&
      rawBaseClonePath.startsWith(resolution.workingDirectoryPath)
        ? rawBaseClonePath
        : "";
    if (rawBaseClonePath && !baseClonePath) {
      console.warn(
        `[resolveWorkspacePath] DISCARDED stale baseClonePath=${rawBaseClonePath} — not under workingDirectory=${resolution.workingDirectoryPath}`,
      );
    }
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
    // Generic workspace tools still anchor to the desktop workspace, but
    // repo-backed code tools resolve against discovered code roots separately.
    const defaultPath =
      derivedWorkItemCheckoutPath ||
      baseClonePath ||
      resolution.workingDirectoryPath ||
      resolution.localRootPath;
    const requestedPath = normalizeDirectoryPath(preferredPath || "");
    const candidate = requestedPath || defaultPath;

    console.log(`[resolveWorkspacePath]   derivedCheckout=${derivedWorkItemCheckoutPath || 'EMPTY'} | baseClone=${baseClonePath || 'EMPTY'} | workingDir=${resolution.workingDirectoryPath || 'EMPTY'} | defaultPath=${defaultPath || 'EMPTY'} | candidate=${candidate || 'EMPTY'}`);

    if (!candidate) {
      throw new Error(
        `Capability ${capability.name} does not have a valid desktop workspace mapping for the current operator on this desktop.`,
      );
    }

    if (!findApprovedWorkspaceRoot(candidate, allowed)) {
      if (requestedPath && allowed.length === 1) {
        console.log(`[resolveWorkspacePath]   FALLBACK to defaultPath=${defaultPath || allowed[0]}`);
        return {
          workspacePath: defaultPath || allowed[0],
          approvedRoots: allowed,
          workingDirectoryPath: resolution.workingDirectoryPath,
          localRootPath: resolution.localRootPath,
        };
      }

      throw new Error(
        `Workspace path ${candidate} is not mapped for capability ${capability.name} on this desktop. Available local roots: ${formatApprovedWorkspaceRoots(allowed)}.`,
      );
    }

    console.log(`[resolveWorkspacePath]   RESOLVED → ${candidate}`);
    return {
      workspacePath: candidate,
      approvedRoots: allowed,
      workingDirectoryPath: resolution.workingDirectoryPath,
      localRootPath: resolution.localRootPath,
    };
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

  console.log(`[resolveWorkspacePath] LOCAL branch | cap=${capability.name} | allowed=${JSON.stringify(allowed)} | candidate=${candidate || 'EMPTY'}`);

  if (!candidate) {
    throw new Error(
      `Capability ${capability.name} does not have a desktop-user workspace path available for this run.`,
    );
  }

  if (!findApprovedWorkspaceRoot(candidate, allowed)) {
    if (requestedPath && allowed.length === 1) {
      return {
        workspacePath: allowed[0],
        approvedRoots: allowed,
      };
    }

    throw new Error(
      `Workspace path ${candidate} is outside the desktop-user workspace roots for capability ${capability.name}. Desktop workspace roots: ${formatApprovedWorkspaceRoots(allowed)}.`,
    );
  }

  console.log(`[resolveWorkspacePath]   RESOLVED → ${candidate}`);
  return {
    workspacePath: candidate,
    approvedRoots: allowed,
  };
};

const resolveWorkspacePath = async (
  capability: Capability,
  workItem?: WorkItem,
  preferredPath?: string,
) => (await resolveWorkspaceContext(capability, workItem, preferredPath)).workspacePath;

const resolvePathWithinWorkspace = (
  workspacePath: string,
  filePath: string,
) => {
  const nextPath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workspacePath, filePath);

  console.log(`[resolvePathWithinWorkspace] workspace=${workspacePath} | file=${filePath} | resolved=${nextPath}`);

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

const isPathWithinApprovedRoots = (
  candidatePath: string,
  approvedRoots: string[],
) =>
  approvedRoots.some((root) => {
    if (!root) return false;
    return findApprovedWorkspaceRoot(candidatePath, [root]) === root;
  });

const summarizeResolvedCodeRoots = (codeRoots: ResolvedCodeRoot[]) =>
  codeRoots.map((root) => `${root.source}:${root.checkoutPath}`);

const resolveRepoToolContext = async ({
  capability,
  workItem,
  preferredWorkspacePath,
  explicitCheckoutPath,
  explicitRepositoryId,
  includeWorkspaceFallbackRoot = false,
}: {
  capability: Capability;
  workItem?: WorkItem;
  preferredWorkspacePath?: string;
  explicitCheckoutPath?: string;
  explicitRepositoryId?: string;
  includeWorkspaceFallbackRoot?: boolean;
}) => {
  const workspaceContext = await resolveWorkspaceContext(
    capability,
    workItem,
    preferredWorkspacePath,
  );
  const workItemRepositoryId =
    explicitRepositoryId ||
    workItem?.executionContext?.primaryRepositoryId ||
    workItem?.executionContext?.branch?.repositoryId;
  const effectiveExplicitCheckoutPath =
    explicitCheckoutPath ||
    (workItem?.id && workItemRepositoryId
      ? workspaceContext.workspacePath
      : undefined);
  const codeRoots = await resolveCapabilityCodeRoots({
    capability,
    workItem,
    explicitCheckoutPath: effectiveExplicitCheckoutPath,
    explicitRepositoryId: workItemRepositoryId,
    workingDirectoryPath: workspaceContext.workingDirectoryPath,
    includeWorkspaceFallbackRoot,
    workspaceFallbackPath: workspaceContext.workspacePath,
  });
  return {
    workspaceContext,
    workItemRepositoryId,
    codeRoots,
  };
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

export const TOOL_REGISTRY: Record<ToolAdapterId, ToolAdapter> = {
  workspace_list: {
    id: "workspace_list",
    description: toolDescription("workspace_list"),
    usageExample: '{"path":"src","limit":200,"cursor":"..."}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", description: "Optional relative path to scope the listing." },
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root or child directory override.",
        },
        limit: { type: "number", description: "Maximum number of files to return." },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous call." },
      },
    },
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
    description: toolDescription("workspace_read"),
    usageExample:
      '{"path":"src/auth/token.ts","symbol":"validateToken","includeCallers":2} (semantic hunk + 2 dependents) OR {"path":"README.md"} (whole file fallback)',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", description: "Relative or absolute approved file path to read." },
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root or child directory override.",
        },
        symbol: {
          type: "string",
          description: "Exact function, class, method, or symbol name to read as a semantic hunk.",
        },
        symbolContextLines: {
          type: "number",
          description: "Extra surrounding lines to include around a semantic symbol hunk.",
        },
        includeCallers: {
          type: "number",
          description: "How many dependent neighbor files to surface as related references.",
        },
        includeCallees: {
          type: "number",
          description: "How many dependency neighbor files to surface as related references.",
        },
        maxBytes: { type: "number", description: "Soft cap on preview size." },
      },
    },
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      const { workspaceContext, workItemRepositoryId, codeRoots } =
        await resolveRepoToolContext({
          capability,
          workItem,
          preferredWorkspacePath: args.workspacePath,
          includeWorkspaceFallbackRoot: true,
        });
      const workspacePath = workspaceContext.workspacePath;
      const requestedPath = getRequiredStringArg(
        args,
        "path",
        "workspace_read",
      );
      const pathResolution = await canonicalizeRepoBackedPath({
        requestedPath,
        codeRoots,
        workspaceFallbackPath: workspacePath,
      });
      let targetPath = pathResolution.resolvedPath;

      if (
        !path.isAbsolute(requestedPath) &&
        pathResolution.pathResolutionMode === "workspace-fallback"
      ) {
        targetPath = resolvePathWithinWorkspace(workspacePath, requestedPath);
      }

      if (!isPathWithinApprovedRoots(targetPath, workspaceContext.approvedRoots)) {
        throw new Error(
          `Path ${requestedPath} is outside the approved workspace roots for capability ${capability.name}.`,
        );
      }

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
      const codeRootForPath =
        pathResolution.repoRoot || findContainingCodeRoot(targetPath, codeRoots);
      const relativePath = path
        .relative(codeRootForPath?.checkoutPath || workspacePath, targetPath)
        .replace(/\\/g, "/");
      const readDiagnostics = {
        resolvedCodeRoots: summarizeResolvedCodeRoots(codeRoots),
        codeRootSource: codeRootForPath?.source,
        toolWorkingRoot: codeRootForPath?.checkoutPath || workspacePath,
        pathResolutionMode: pathResolution.pathResolutionMode,
        requestedPathKind: pathResolution.requestedPathKind,
        pathResolutionFallbackUsed: pathResolution.pathResolutionFallbackUsed,
      };

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
              ...readDiagnostics,
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
              codeRootForPath
                ? "local-checkout"
                : "capability-index",
            symbolLookupMissed: true,
            hasNeighbors: neighborNote.length > 0,
            truncated: output.length > maxBytes,
            ...readDiagnostics,
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
          relativePath,
          mode: "whole-file",
          compression,
          codeIndexSource: codeRootForPath ? "local-checkout" : undefined,
          hasNeighbors: neighborNote.length > 0,
          truncated: output.length > maxBytes,
          ...readDiagnostics,
        },
      };
    },
  },
  workspace_search: {
    id: "workspace_search",
    description: toolDescription("workspace_search"),
    usageExample:
      '{"pattern":"Operator","path":"src","limit":100,"cursor":"..."}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: "String, symbol name, or natural-language code query to search for.",
        },
        path: { type: "string", description: "Optional relative path to scope the search." },
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root or child directory override.",
        },
        limit: { type: "number", description: "Maximum number of results to return." },
        cursor: { type: "string", description: "Opaque pagination cursor from a previous call." },
      },
    },
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      const pattern = getRequiredStringArg(args, "pattern", "workspace_search");

      const { workspaceContext, workItemRepositoryId, codeRoots } =
        await resolveRepoToolContext({
          capability,
          workItem,
          preferredWorkspacePath: args.workspacePath,
        });
      const workspacePath = workspaceContext.workspacePath;
      const scopePath = args.path
        ? resolvePathWithinWorkspace(workspacePath, String(args.path))
        : workspacePath;
      const limit = clampLimit(args.limit, 100, 500);
      const cursor =
        typeof args.cursor === "string" ? args.cursor.trim() : undefined;
      const scopePrefix = String(args.path || "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      const relativeScopePath = path
        .relative(workspacePath, scopePath)
        .replace(/\\/g, "/");

      const codeSearch = capability.id
        ? buildCodeSearchCandidates(pattern)
        : {
            isCodeQuestion: false,
            queries: [] as string[],
            searchTerms: [] as string[],
            candidates: [] as string[],
            textSearchTerms: [] as string[],
            weightedCandidates: [],
            questionType: "unknown" as const,
          };

      if (
        capability.id &&
        (looksLikeSymbolPattern(pattern) || codeSearch.isCodeQuestion)
      ) {
        let localSymbolResults: Awaited<ReturnType<typeof searchLocalCheckoutSymbols>> | null = null;
        let localSymbolCheckoutRoot = "";
        let localSymbolRootSource: ResolvedCodeRoot["source"] | undefined;
        for (const candidate of codeRoots) {
          for (const candidateQuery of codeSearch.candidates) {
            const result = await searchLocalCheckoutSymbols({
              checkoutPath: candidate.checkoutPath,
              capabilityId: capability.id,
              repositoryId: candidate.repositoryId,
              query: candidateQuery,
              limit: Math.min(limit, 25),
            }).catch(() => null);
            if (result && result.symbols.length > 0) {
              localSymbolResults = result;
              localSymbolCheckoutRoot = candidate.checkoutPath.replace(/\/+$/, "");
              localSymbolRootSource = candidate.source;
              break;
            }
          }
          if (localSymbolResults) {
            break;
          }
        }

        const filteredLocalSymbols =
          localSymbolResults?.symbols.filter((symbol) =>
            !scopePrefix
              ? true
              : symbol.filePath.startsWith(
                  `${scopePrefix}/`,
                ) || symbol.filePath === scopePrefix,
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
              normalizedQueries: codeSearch.candidates,
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
              codeDiscoveryMode: "ast-first",
              astSearchAttempted: true,
              astSearchSource: "local-checkout",
              resolvedCodeRoots: summarizeResolvedCodeRoots(codeRoots),
              codeRootSource: localSymbolRootSource,
              toolWorkingRoot: localSymbolCheckoutRoot || workspacePath,
            },
          };
        }

        let indexedMatches: Awaited<ReturnType<typeof searchCodeSymbols>> = [];
        for (const candidateQuery of codeSearch.candidates) {
          indexedMatches = (await searchCodeSymbols(capability.id, candidateQuery, {
            limit: Math.min(limit, 25),
          }).catch(() => []))
            .filter((symbol) =>
              !scopePrefix
                ? true
                : symbol.filePath.startsWith(
                    `${scopePrefix}/`,
                  ) || symbol.filePath === scopePrefix,
            );
          if (indexedMatches.length > 0) {
            break;
          }
        }
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
              normalizedQueries: codeSearch.candidates,
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
              codeDiscoveryMode: "ast-first",
              astSearchAttempted: true,
              astSearchSource: "capability-index",
              resolvedCodeRoots: summarizeResolvedCodeRoots(codeRoots),
              toolWorkingRoot: workspacePath,
            },
          };
        }
      }

      const textFallbackPatterns =
        codeSearch.isCodeQuestion && Array.isArray(codeSearch.textSearchTerms)
          ? [...new Set([...codeSearch.textSearchTerms, pattern])]
          : [pattern];

      if (codeSearch.isCodeQuestion && codeRoots.length > 0) {
        for (const codeRoot of codeRoots) {
          const scopedCodeRoot = scopePrefix
            ? path.resolve(codeRoot.checkoutPath, scopePrefix)
            : codeRoot.checkoutPath;
          if (
            scopePrefix &&
            !findContainingCodeRoot(scopedCodeRoot, [codeRoot]) &&
            !scopedCodeRoot.startsWith(codeRoot.checkoutPath)
          ) {
            continue;
          }
          for (const candidatePattern of textFallbackPatterns) {
            const trimmedPattern = String(candidatePattern || "").trim();
            if (!trimmedPattern) continue;
            const codeRootResult = await runProcess(
              "rg",
              ["-n", "-i", trimmedPattern, scopedCodeRoot],
              codeRoot.checkoutPath,
            );
            const lines = (codeRootResult.stdout || codeRootResult.stderr)
              .split("\n")
              .filter(Boolean);
            if (codeRootResult.exitCode === 0 && lines.length > 0) {
              const paged = paginateValues({
                values: lines,
                cursor,
                limit,
              });
              const output = paged.page.join("\n");
              return {
                summary: `Search completed for pattern ${pattern}.`,
                workingDirectory: codeRoot.checkoutPath,
                exitCode: 0,
                stdoutPreview: previewText(output),
                details: {
                  pattern,
                  effectivePattern: trimmedPattern,
                  normalizedCodeQueries: codeSearch.candidates,
                  textSearchTerms: codeSearch.textSearchTerms,
                  codeQuestionType: codeSearch.questionType,
                  scopePath: scopedCodeRoot,
                  normalizedQueries: codeSearch.candidates,
                  matches: paged.page,
                  nextCursor: paged.nextCursor,
                  totalScanned: lines.length,
                  truncated: paged.nextCursor !== undefined,
                  mode: "text-search",
                  codeDiscoveryMode: "text-search-fallback",
                  astSearchAttempted: true,
                  astSearchSource: "local-checkout",
                  resolvedCodeRoots: summarizeResolvedCodeRoots(codeRoots),
                  codeRootSource: codeRoot.source,
                  toolWorkingRoot: codeRoot.checkoutPath,
                },
              };
            }
          }
        }
      }

      let result = { exitCode: 1, stdout: "", stderr: "" };
      let effectivePattern = pattern;
      for (const candidatePattern of textFallbackPatterns) {
        const trimmedPattern = String(candidatePattern || "").trim();
        if (!trimmedPattern) continue;
        result = await runProcess(
          "rg",
          ["-n", "-i", trimmedPattern, scopePath],
          workspacePath,
        );
        effectivePattern = trimmedPattern;
        if (result.exitCode === 0 && String(result.stdout || "").trim()) {
          break;
        }
      }
      const paged = isCommandMissing(result)
        ? await searchIndexedWorkspaceFiles({
            workspacePath,
            scopePath,
            pattern: effectivePattern,
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
          effectivePattern,
          normalizedCodeQueries: codeSearch.candidates,
          textSearchTerms: codeSearch.textSearchTerms,
          codeQuestionType: codeSearch.questionType,
          scopePath,
          normalizedQueries: codeSearch.candidates,
          matches: paged.matches,
          nextCursor: paged.nextCursor,
          totalScanned: paged.totalScanned,
          truncated: paged.truncated,
          mode: "text-search",
          codeDiscoveryMode: codeSearch.isCodeQuestion
            ? "text-search-fallback"
            : "text-search",
          fallback: isCommandMissing(result) ? "node-filesystem" : undefined,
          astSearchAttempted: Boolean(codeSearch.isCodeQuestion),
          astSearchSource:
            codeSearch.isCodeQuestion && codeRoots.length > 0
              ? "local-checkout"
              : codeSearch.isCodeQuestion
                ? "capability-index"
                : undefined,
          resolvedCodeRoots: summarizeResolvedCodeRoots(codeRoots),
          toolWorkingRoot: workspacePath,
        },
      };
    },
  },
  browse_code: {
    id: "browse_code",
    description: toolDescription("browse_code"),
    usageExample:
      '{"query":"How many operators are there in the rule engine?","kind":"class","limit":30}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description:
            "Optional natural-language code question or symbol query to resolve semantically before broad listing.",
        },
        kind: {
          type: "string",
          description: "Optional symbol kind filter such as class, function, interface, method, type, enum, or variable.",
        },
        filePathPrefix: {
          type: "string",
          description: "Optional relative path prefix to restrict matching files.",
        },
        path: {
          type: "string",
          description: "Alias for filePathPrefix.",
        },
        limit: { type: "number", description: "Maximum number of symbols to return." },
      },
    },
    retryable: true,
    execute: async ({ capability, workItem }, args) => {
      if (!capability.id) {
        throw new Error("browse_code requires a capability context.");
      }

      const queryRaw = String(args.query || args.pattern || "").trim();
      const kindRaw = String(args.kind || "").trim().toLowerCase();
      const validKinds = new Set(["class", "function", "interface", "method", "type", "enum", "variable", "property"]);
      const kind = validKinds.has(kindRaw) ? (kindRaw as any) : undefined;
      const filePathPrefix = String(args.filePathPrefix || args.path || "").trim() || undefined;
      const limitRaw = Number(args.limit);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 100)) : 30;

      const workItemRepositoryId =
        workItem?.executionContext?.primaryRepositoryId ||
        workItem?.executionContext?.branch?.repositoryId ||
        (capability.repositories || []).find(repository => repository.isPrimary)?.id ||
        capability.repositories?.[0]?.id;
      const workspaceContext = await resolveWorkspaceContext(
        capability,
        workItem,
        args.workspacePath,
      );
      const workItemCheckoutPath =
        workItem?.id && workItemRepositoryId
          ? workspaceContext.workspacePath
          : "";
      const localCloneCandidates = await resolveCapabilityCodeRoots({
        capability,
        workItem,
        explicitCheckoutPath: workItemCheckoutPath || undefined,
        explicitRepositoryId: workItemRepositoryId,
        workingDirectoryPath: workspaceContext.workingDirectoryPath,
      });

      if (localCloneCandidates.length > 0) {
        console.log(`[browse_code] ${localCloneCandidates.length} search root(s): ${localCloneCandidates.map(c => `${c.repositoryLabel}=${c.checkoutPath}`).join(', ')}`);
      } else {
        console.warn(`[browse_code] no search roots available for capability ${capability.id} — browse_code will return empty`);
      }

      const semanticSearch =
        queryRaw.length > 0
          ? buildCodeSearchCandidates(queryRaw)
          : null;
      const semanticCandidates =
        semanticSearch?.candidates.length
          ? semanticSearch.candidates
          : queryRaw
            ? [queryRaw]
            : [];

      if (semanticCandidates.length > 0) {
        let localSemanticSymbols: Array<
          any & { _checkoutRoot: string; _rootSource: ResolvedCodeRoot["source"] }
        > = [];
        let localSemanticFreshness: string | undefined;

        for (const clone of [
          ...localCloneCandidates.filter(e => e.isPrimary),
          ...localCloneCandidates.filter(e => !e.isPrimary),
        ]) {
          const cloneRoot = clone.checkoutPath.replace(/\/+$/, "");
          for (const candidateQuery of semanticCandidates) {
            const result = await searchLocalCheckoutSymbols({
              checkoutPath: clone.checkoutPath,
              capabilityId: capability.id,
              repositoryId: clone.repositoryId,
              query: candidateQuery,
              limit: Math.min(limit, 25),
            }).catch(() => null);
            if (result?.symbols?.length) {
              localSemanticFreshness = result.builtAt || localSemanticFreshness;
              localSemanticSymbols.push(
                ...result.symbols.map(symbol => ({
                  ...symbol,
                  _checkoutRoot: cloneRoot,
                  _rootSource: clone.source,
                })),
              );
            }
            if (localSemanticSymbols.length >= limit) {
              break;
            }
          }
          if (localSemanticSymbols.length >= limit) {
            break;
          }
        }

        const promotedLocalSemanticSymbols = promoteParentSymbols(
          localSemanticSymbols,
          semanticSearch?.questionType,
        );
        const filteredForPrefix = promotedLocalSemanticSymbols.filter(symbol =>
          filePathPrefix
            ? String(symbol.filePath || "").startsWith(
                filePathPrefix.replace(/^\/+/, ""),
              )
            : true,
        );
        const dedupedLocalSemanticSymbols = Array.from(
          new Map(
            filteredForPrefix.map(symbol => [
              `${symbol._checkoutRoot}:${symbol.symbolId || symbol.filePath}:${symbol.qualifiedSymbolName || symbol.symbolName}:${symbol.kind}`,
              symbol,
            ]),
          ).values(),
        );
        const localSymbolDedupCount =
          Math.max(0, filteredForPrefix.length - dedupedLocalSemanticSymbols.length);
        const filteredLocalSemanticSymbols = dedupedLocalSemanticSymbols.slice(0, limit);

        if (filteredLocalSemanticSymbols.length > 0) {
          const output = [
            "NOTE: Paths below are absolute. Pass them directly to workspace_read.",
            "Do NOT cd to or construct directory paths — only these paths exist on disk.",
            "",
            ...filteredLocalSemanticSymbols.map(symbol =>
              `${symbol.qualifiedSymbolName || symbol.symbolName} (${symbol.kind}) ${symbol._checkoutRoot}/${String(symbol.filePath).replace(/^\/+/, "")}:${symbol.sliceStartLine ?? symbol.startLine}-${symbol.sliceEndLine ?? symbol.endLine}`,
            ),
          ].join("\n");
          return {
            summary: `Found ${filteredLocalSemanticSymbols.length} semantic symbol match${filteredLocalSemanticSymbols.length === 1 ? "" : "es"} for ${queryRaw}.`,
            stdoutPreview: previewText(output),
            details: {
              query: queryRaw,
              normalizedQueries: semanticCandidates,
              normalizedCodeQueries: semanticSearch?.candidates || semanticCandidates,
              textSearchTerms: semanticSearch?.textSearchTerms || semanticCandidates,
              codeQuestionType: semanticSearch?.questionType,
              localSymbolDedupCount,
              symbols: filteredLocalSemanticSymbols.map(symbol => ({
                symbolId: symbol.symbolId,
                symbolName: symbol.symbolName,
                qualifiedSymbolName: symbol.qualifiedSymbolName,
                kind: symbol.kind,
                filePath: `${symbol._checkoutRoot}/${String(symbol.filePath).replace(/^\/+/, "")}`,
                startLine: symbol.sliceStartLine ?? symbol.startLine,
                endLine: symbol.sliceEndLine ?? symbol.endLine,
                signature: symbol.signature,
                repositoryId: symbol.repositoryId,
                checkoutRoot: symbol._checkoutRoot,
              })),
              source: "local-clone",
              codeIndexSource: "local-checkout",
              codeIndexFreshness: localSemanticFreshness,
              codeDiscoveryMode: "ast-first",
              astSearchAttempted: true,
              astSearchSource: "local-checkout",
              resolvedCodeRoots: summarizeResolvedCodeRoots(localCloneCandidates),
              codeRootSource: filteredLocalSemanticSymbols[0]?._rootSource,
              toolWorkingRoot:
                filteredLocalSemanticSymbols[0]?._checkoutRoot || workspaceContext.workspacePath,
              mode: "symbol-search",
            },
          };
        }

        let indexedMatches: Awaited<ReturnType<typeof searchCodeSymbols>> = [];
        for (const candidateQuery of semanticCandidates) {
          indexedMatches = (await searchCodeSymbols(capability.id, candidateQuery, {
            limit: Math.min(limit, 25),
          }).catch(() => []))
            .filter(symbol =>
              filePathPrefix
                ? symbol.filePath.startsWith(filePathPrefix.replace(/^\/+/, ""))
                : true,
            );
          if (indexedMatches.length > 0) {
            break;
          }
        }
        if (indexedMatches.length > 0) {
          const output = indexedMatches
            .slice(0, limit)
            .map(
              symbol =>
                `${symbol.qualifiedSymbolName || symbol.symbolName} (${symbol.kind}) ${symbol.filePath}:${symbol.sliceStartLine || symbol.startLine}-${symbol.sliceEndLine || symbol.endLine}`,
            )
            .join("\n");
          return {
            summary: `Found ${Math.min(indexedMatches.length, limit)} semantic symbol match${indexedMatches.length === 1 ? "" : "es"} for ${queryRaw}.`,
            stdoutPreview: previewText(output),
            details: {
              query: queryRaw,
              normalizedQueries: semanticCandidates,
              normalizedCodeQueries: semanticSearch?.candidates || semanticCandidates,
              textSearchTerms: semanticSearch?.textSearchTerms || semanticCandidates,
              codeQuestionType: semanticSearch?.questionType,
              symbols: indexedMatches.slice(0, limit),
              source: "capability-index",
              codeIndexSource: "capability-index",
              codeDiscoveryMode: "ast-first",
              astSearchAttempted: true,
              astSearchSource: "capability-index",
              resolvedCodeRoots: summarizeResolvedCodeRoots(localCloneCandidates),
              toolWorkingRoot: workspaceContext.workspacePath,
              mode: "symbol-search",
            },
          };
        }
      }

      // Both local AST search and DB capability index returned zero results.
      // This typically means the AST index hasn't been built yet (first use).
      // Fall back to ripgrep — run TWO passes:
      //   Pass 1: line-level match on the user's search terms (vocabulary match).
      //           Returns file:line:content so the LLM can distinguish a
      //           *definition* (e.g. "public enum Operator") from a *reference*.
      //   Pass 2: structural search for top-level type declarations in the repo
      //           (enum|class|interface|type keyword), intersected with any file
      //           that contains the search term. Catches vocabulary mismatches
      //           where the user says "operator" but the code says "Comparator".
      if (localCloneCandidates.length > 0) {
        for (const clone of [
          ...localCloneCandidates.filter(e => e.isPrimary),
          ...localCloneCandidates.filter(e => !e.isPrimary),
        ]) {
          const cloneRoot = clone.checkoutPath.replace(/\/+$/, "");
          const termsToSearch = semanticSearch?.searchTerms?.length
            ? semanticSearch.searchTerms
            : semanticCandidates;

          // --- Pass 1: line-level matches for the user's terms ---
          const lineMatches: string[] = [];
          const matchedFileSet = new Set<string>();
          for (const term of termsToSearch) {
            const rgResult = await runProcess(
              "rg",
              // -n line numbers, --max-count=5 per file, -i case-insensitive
              ["-n", "--max-count=5", "--ignore-case",
               "--type-add", "code:*.{ts,tsx,js,jsx,mjs,cjs,java,py,go,rb,cs,cpp,c,h,rs,kt,swift}",
               "--type", "code",
               term, cloneRoot],
              cloneRoot,
            ).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
            (rgResult.stdout || "").split("\n").filter(Boolean).forEach(line => {
              if (filePathPrefix && !line.includes(filePathPrefix.replace(/^\/+/, ""))) return;
              lineMatches.push(line);
              // extract the file path (rg format: path:line:content)
              const filePath = line.split(":")[0];
              if (filePath) matchedFileSet.add(filePath);
            });
          }

          // --- Pass 2: structural search for type definitions ---
          // Finds enum/class/interface/type declarations in any file that
          // already matched Pass 1, or — if Pass 1 had no hits — scans the
          // whole repo for top-level definitions.
          const structuralMatches: string[] = [];
          const structPattern =
            "^\\s*(public\\s+)?(enum|class|interface|type|struct|abstract class|sealed class)\\s+";
          const structScope =
            matchedFileSet.size > 0
              ? [...matchedFileSet]          // only in already-matched files
              : [cloneRoot];                 // whole repo if pass 1 was empty

          for (const scope of structScope.slice(0, 20)) {
            const sgResult = await runProcess(
              "rg",
              ["-n", "--max-count=3", "--ignore-case", structPattern, scope],
              cloneRoot,
            ).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
            (sgResult.stdout || "").split("\n").filter(Boolean).forEach(line => {
              if (filePathPrefix && !line.includes(filePathPrefix.replace(/^\/+/, ""))) return;
              structuralMatches.push(line);
            });
          }

          const hasResults = lineMatches.length > 0 || structuralMatches.length > 0;
          if (hasResults) {
            const sections: string[] = [
              "NOTE: AST index is building in the background. Results below are raw text matches.",
              "Read the most relevant file(s) with workspace_read to get the full source.",
              "If these files do not contain the answer, use workspace_search with a broader",
              "pattern (e.g. workspace_search 'enum|interface' to find type definitions).",
              "",
            ];
            if (lineMatches.length > 0) {
              sections.push("=== Files / lines matching your query terms ===");
              sections.push(...lineMatches.slice(0, limit * 3));
            }
            if (structuralMatches.length > 0) {
              sections.push("");
              sections.push("=== Top-level type definitions in matching files ===");
              sections.push(...structuralMatches.slice(0, limit));
            }
            const output = sections.join("\n");
            const uniqueFiles = [...matchedFileSet].slice(0, limit);
            return {
              summary: `AST index not yet built. Found ${uniqueFiles.length} file(s) via text search in ${clone.repositoryLabel}. Line-level matches and type definitions shown — read the relevant file with workspace_read.`,
              stdoutPreview: previewText(output),
              details: {
                files: uniqueFiles,
                lineMatches: lineMatches.slice(0, limit * 3),
                structuralMatches: structuralMatches.slice(0, limit),
                query: queryRaw,
                searchTerms: termsToSearch,
                normalizedCodeQueries: semanticSearch?.candidates || semanticCandidates,
                textSearchTerms: semanticSearch?.searchTerms || semanticCandidates,
                codeQuestionType: semanticSearch?.questionType,
                source: "local-clone-text-fallback",
                codeDiscoveryMode: "text-search-fallback",
                mode: "text-search",
                cloneRoot,
              },
            };
          }
        }
      }

      if (localCloneCandidates.length === 0) {
        // Fall back to DB index.
        const dbResults = semanticCandidates.length
          ? await (async () => {
              for (const candidateQuery of semanticCandidates) {
                const matches = await searchCodeSymbols(capability.id, candidateQuery, {
                  limit: limit as any,
                }).catch(() => []);
                if (matches.length > 0) {
                  return matches;
                }
              }
              return [] as Awaited<ReturnType<typeof searchCodeSymbols>>;
            })()
          : await searchCodeSymbols(capability.id, kindRaw || "*", { limit: limit as any }).catch(() => []);
        if (dbResults.length === 0) {
          const workspacePath = await resolveWorkspacePath(
            capability,
            workItem,
            args.workspacePath,
          ).catch(() => "");
          if (workspacePath) {
            // Two-pass content search — same strategy as the local-clone fallback above.
            // Pass 1: line-level content match on user's search terms.
            // Pass 2: type-definition search in matched files (catches vocab mismatch).
            const termsToSearch = semanticSearch?.searchTerms?.length
              ? semanticSearch.searchTerms
              : semanticCandidates;

            const lineMatches: string[] = [];
            const matchedFileSet = new Set<string>();
            for (const term of termsToSearch) {
              const rgResult = await runProcess(
                "rg",
                ["-n", "--max-count=5", "--ignore-case",
                 "--type-add", "code:*.{ts,tsx,js,jsx,mjs,cjs,java,py,go,rb,cs,cpp,c,h,rs,kt,swift}",
                 "--type", "code",
                 term, workspacePath],
                workspacePath,
              ).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
              (rgResult.stdout || "").split("\n").filter(Boolean).forEach(line => {
                if (filePathPrefix && !line.includes(filePathPrefix.replace(/^\/+/, ""))) return;
                lineMatches.push(line);
                const filePath = line.split(":")[0];
                if (filePath) matchedFileSet.add(filePath);
              });
            }

            const structuralMatches: string[] = [];
            const structPattern =
              "^\\s*(public\\s+)?(enum|class|interface|type|struct|abstract class|sealed class)\\s+";
            const structScope = matchedFileSet.size > 0 ? [...matchedFileSet] : [workspacePath];
            for (const scope of structScope.slice(0, 20)) {
              const sgResult = await runProcess(
                "rg",
                ["-n", "--max-count=3", "--ignore-case", structPattern, scope],
                workspacePath,
              ).catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
              (sgResult.stdout || "").split("\n").filter(Boolean).forEach(line => {
                if (filePathPrefix && !line.includes(filePathPrefix.replace(/^\/+/, ""))) return;
                structuralMatches.push(line);
              });
            }

            const hasResults = lineMatches.length > 0 || structuralMatches.length > 0;
            if (hasResults) {
              const sections: string[] = [
                "NOTE: AST index not yet built. Results below are raw text matches from the workspace.",
                "Read the most relevant file(s) with workspace_read to get the full source.",
                "If these files do not contain the answer, use workspace_search with a broader pattern.",
                "",
              ];
              if (lineMatches.length > 0) {
                sections.push("=== Files / lines matching your query terms ===");
                sections.push(...lineMatches.slice(0, limit * 3));
              }
              if (structuralMatches.length > 0) {
                sections.push("");
                sections.push("=== Top-level type definitions in matching files ===");
                sections.push(...structuralMatches.slice(0, limit));
              }
              const uniqueFiles = [...matchedFileSet].slice(0, limit);
              return {
                summary: `AST index not yet built. Found ${uniqueFiles.length} file(s) via workspace text search. Line-level matches and type definitions shown — read the relevant file with workspace_read.`,
                stdoutPreview: previewText(sections.join("\n")),
                details: {
                  files: uniqueFiles,
                  lineMatches: lineMatches.slice(0, limit * 3),
                  structuralMatches: structuralMatches.slice(0, limit),
                  query: queryRaw,
                  searchTerms: termsToSearch,
                  normalizedCodeQueries: semanticSearch?.candidates || semanticCandidates,
                  textSearchTerms: semanticSearch?.searchTerms || semanticCandidates,
                  codeQuestionType: semanticSearch?.questionType,
                  source: "workspace-text-fallback",
                  codeDiscoveryMode: "text-search-fallback",
                  mode: "text-search",
                  workspacePath,
                },
              };
            }
          }
          return {
            summary: "No local base clones available and no DB code index found. Run repo-sync first.",
            stderrPreview: "TOOL_RESULT_EMPTY: browse_code returned no symbols (no clones, no DB index).",
            details: { symbols: [], source: "none", error: "no-index" },
          };
        }
        const output = dbResults
          .map(s => `${s.qualifiedSymbolName || s.symbolName} (${s.kind}) ${s.filePath}:${s.sliceStartLine}-${s.sliceEndLine}`)
          .join("\n");
	        return {
	          summary: `Found ${dbResults.length} symbol(s) from DB code index.`,
	          stdoutPreview: previewText(output),
	          details: {
              symbols: dbResults,
              source: "capability-index",
              codeIndexSource: "capability-index",
              codeDiscoveryMode: "ast-first",
            },
	        };
	      }

      // Track symbols with their checkout root so we can emit absolute paths.
      const allSymbols: Array<any & { _checkoutRoot: string }> = [];
      const repoSummaries: string[] = [];
      const effectiveKind =
        semanticSearch && INVENTORY_CODE_QUESTION_TYPES.has(String(semanticSearch.questionType || ""))
          ? undefined
          : kind;
	      for (const clone of [...localCloneCandidates.filter(e => e.isPrimary), ...localCloneCandidates.filter(e => !e.isPrimary)]) {
        const cloneRoot = clone.checkoutPath.replace(/\/+$/, "");
        const { symbols, builtAt } = await listLocalCheckoutAllSymbols({
          checkoutPath: clone.checkoutPath,
          capabilityId: capability.id,
          repositoryId: clone.repositoryId,
          kind: effectiveKind,
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
	        summary: `Found ${sliced.length} ${kind ? kind + " " : ""}symbol(s) across ${localCloneCandidates.length} checkout(s).`,
        stdoutPreview: previewText(`Repositories:\n${repoSummaries.join("\n")}\n\nSymbols:\n${output}`),
	        details: {
          normalizedCodeQueries: semanticSearch?.candidates || semanticCandidates,
          textSearchTerms: semanticSearch?.textSearchTerms || semanticCandidates,
          codeQuestionType: semanticSearch?.questionType,
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
	          codeIndexSource: "local-checkout",
	          codeDiscoveryMode: "ast-first",
	          repositories: repoSummaries,
	        },
      };
    },
  },
  git_status: {
    id: "git_status",
    description: toolDescription("git_status"),
    usageExample: '{"workspacePath":"src"}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root or child directory override.",
        },
      },
    },
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
    description: toolDescription("workspace_write"),
    usageExample: '{"path":"src/main/java/App.java","content":"..."}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path", "content"],
      properties: {
        path: { type: "string", description: "Relative or absolute approved file path to create." },
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root or child directory override.",
        },
        content: {
          type: "string",
          description: "Full file contents to write to the new file.",
        },
      },
    },
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

      // Invalidate the in-memory AST index so browse_code sees the new content.
      queueLocalCheckoutAstRefresh({
        checkoutPath: workspacePath,
        capabilityId: capability.id,
        repositoryId: capability.id,
      });

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
    description: toolDescription("workspace_replace_block"),
    usageExample:
      '{"path":"src/App.tsx","find":"const oldValue = 1;","replace":"const oldValue = 2;","expectedMatches":1}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path", "find"],
      properties: {
        path: { type: "string", description: "Relative or absolute approved file path to edit." },
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root or child directory override.",
        },
        find: {
          type: "string",
          description: "Exact anchored block to find in the existing file.",
        },
        replace: {
          type: "string",
          description: "Replacement text for the matched block.",
        },
        expectedMatches: {
          type: "number",
          description: "Expected number of matches for the anchored block.",
        },
        replaceAll: {
          type: "boolean",
          description: "Replace every exact match instead of only the first one.",
        },
      },
    },
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

      // Invalidate the in-memory AST index so browse_code sees the updated content.
      queueLocalCheckoutAstRefresh({
        checkoutPath: workspacePath,
        capabilityId: capability.id,
        repositoryId: capability.id,
      });

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
    description: toolDescription("workspace_apply_patch"),
    usageExample:
      '{"patchText":"diff --git a/src/App.tsx b/src/App.tsx\\n--- a/src/App.tsx\\n+++ b/src/App.tsx\\n@@ ..."}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["patchText"],
      properties: {
        patchText: {
          type: "string",
          description: "Unified diff patch text to apply inside the approved workspace.",
        },
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root or child directory override.",
        },
      },
    },
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

      // Invalidate the in-memory AST index so browse_code sees patched content.
      queueLocalCheckoutAstRefresh({
        checkoutPath: workspacePath,
        capabilityId: capability.id,
        repositoryId: capability.id,
      });

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
    description: toolDescription("delegate_task"),
    usageExample:
      '{"delegatedAgentId":"AGENT-...","title":"Inspect failing tests","prompt":"Review the latest test failures and summarize the root cause."}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["delegatedAgentId", "prompt"],
      properties: {
        delegatedAgentId: {
          type: "string",
          description: "Target agent id that should receive the delegated subtask.",
        },
        title: {
          type: "string",
          description: "Short title for the delegated work item or handoff.",
        },
        prompt: {
          type: "string",
          description: "Detailed prompt or instructions for the delegated agent.",
        },
      },
    },
    retryable: false,
    execute: async () => {
      throw new Error(
        "delegate_task is orchestrated by the execution service and cannot be executed outside an active workflow run.",
      );
    },
  },
  run_build: {
    id: "run_build",
    description: toolDescription("run_build"),
    usageExample: '{"templateId":"build"}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        templateId: {
          type: "string",
          description: "Optional build command template id. Defaults to build.",
        },
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root or child directory override.",
        },
      },
    },
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
    description: toolDescription("run_test"),
    usageExample: '{"templateId":"test"}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        templateId: {
          type: "string",
          description: "Optional test command template id. Defaults to test.",
        },
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root or child directory override.",
        },
      },
    },
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
    description: toolDescription("run_docs"),
    usageExample: '{"templateId":"docs"}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        templateId: {
          type: "string",
          description: "Optional docs command template id. Defaults to docs.",
        },
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root or child directory override.",
        },
      },
    },
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
    description: toolDescription("run_deploy"),
    usageExample: '{"targetId":"staging"}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        targetId: {
          type: "string",
          description: "Deployment target id or command template id to execute.",
        },
        workspacePath: {
          type: "string",
          description: "Optional approved workspace root override for the deployment target.",
        },
      },
    },
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
    description: toolDescription("publish_bounty"),
    usageExample:
      '{"bountyId":"req-123","targetRole":"Backend","instructions":"..."}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["bountyId", "instructions"],
      properties: {
        bountyId: { type: "string", description: "Unique runtime-local bounty id." },
        targetRole: {
          type: "string",
          description: "Optional target role that should resolve the bounty.",
        },
        instructions: {
          type: "string",
          description: "Instructions for the peer agent that will handle the bounty.",
        },
        timeoutMs: {
          type: "number",
          description: "Optional runtime-local timeout in milliseconds.",
        },
      },
    },
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
    description: toolDescription("resolve_bounty"),
    usageExample:
      '{"bountyId":"req-123","status":"RESOLVED","resultSummary":"Created route"}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["bountyId"],
      properties: {
        bountyId: { type: "string", description: "Active bounty id to resolve." },
        status: {
          type: "string",
          enum: ["RESOLVED", "FAILED"],
          description: "Resolution status to publish for the bounty.",
        },
        resultSummary: {
          type: "string",
          description: "Optional summary of the resolution outcome.",
        },
      },
    },
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
    description: toolDescription("wait_for_signal"),
    usageExample: '{"bountyId":"req-123"}',
    parameterSchema: {
      type: "object",
      additionalProperties: false,
      required: ["bountyId"],
      properties: {
        bountyId: {
          type: "string",
          description: "Previously published bounty id to wait on.",
        },
        timeoutMs: {
          type: "number",
          description: "Optional wait timeout in milliseconds.",
        },
      },
    },
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

const assertToolRegistryCompleteness = () => {
  const registryIds = Object.keys(TOOL_REGISTRY).sort();
  const catalogIds = [...TOOL_ADAPTER_IDS].sort();
  const missingFromRegistry = catalogIds.filter((toolId) => !(toolId in TOOL_REGISTRY));
  const missingFromCatalog = registryIds.filter(
    (toolId) => !TOOL_ADAPTER_IDS.includes(toolId as ToolAdapterId),
  );
  if (missingFromRegistry.length || missingFromCatalog.length) {
    throw new Error(
      `Tool registry/catalog drift detected. Missing registry adapters: ${missingFromRegistry.join(", ") || "none"}. Missing catalog entries: ${missingFromCatalog.join(", ") || "none"}.`,
    );
  }
};

assertToolRegistryCompleteness();

export const getToolAdapter = (toolId: ToolAdapterId) => {
  const adapter = TOOL_REGISTRY[toolId];
  if (!adapter) {
    throw new Error(`Tool adapter ${toolId} is not registered.`);
  }
  return adapter;
};

export const listRegisteredToolIds = (): ToolAdapterId[] => [...TOOL_ADAPTER_IDS];

export const READ_ONLY_AGENT_TOOL_IDS: ToolAdapterId[] = getReadOnlyToolIds();

export const listToolDescriptions = (toolIds: ToolAdapterId[]) =>
  toolIds.map((toolId) => {
    const adapter = getToolAdapter(toolId);
    const schemaArgs = summarizeSchemaArguments(adapter.parameterSchema);
    return `- ${adapter.id}: ${adapter.description}${
      schemaArgs ? ` Args: ${schemaArgs}.` : ""
    }${adapter.usageExample ? ` Example args: ${adapter.usageExample}` : ""}`;
  });

export const buildProviderToolDefinitions = (toolIds: ToolAdapterId[]): ProviderTool[] =>
  toolIds.flatMap((toolId) => {
    const adapter = getToolAdapter(toolId);
    if (
      !getProviderFunctionToolIds().includes(toolId) ||
      !adapter.parameterSchema
    ) {
      return [];
    }
    return [
      {
        type: "function",
        function: {
          name: adapter.id,
          description: adapter.description,
          parameters: adapter.parameterSchema,
        },
      } satisfies ProviderTool,
    ];
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
