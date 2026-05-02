// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Capability, CapabilityAgent } from "../../src/types";
import { getStandardAgentContract } from "../../src/constants";
import { createDefaultCapabilityLifecycle } from "../../src/lib/capabilityLifecycle";

const { searchLocalCheckoutSymbolsMock, desktopState, rpcState } = vi.hoisted(() => ({
  searchLocalCheckoutSymbolsMock: vi.fn(),
  desktopState: {
    workingDirectory: "",
    clonePaths: [] as string[],
  },
  rpcState: {
    workspaceRoot: "",
  },
}));

vi.mock("../execution/runtimeClient", () => ({
  executionRuntimeRpc: async (_method: string, _payload: unknown) => ({
    localRootPath: rpcState.workspaceRoot,
    workingDirectoryPath: rpcState.workspaceRoot,
    approvedWorkspaceRoots: [rpcState.workspaceRoot],
    validation: {
      valid: true,
      message: "",
    },
  }),
  isRemoteExecutionClient: () => true,
}));

vi.mock("../desktopRepoSync", () => ({
  getCapabilityBaseClones: () => [],
  getPrimaryBaseClone: () => undefined,
  resolveOperatorWorkingDirectory: async () => desktopState.workingDirectory,
  discoverExistingClonePaths: async () => desktopState.clonePaths,
}));

vi.mock("../localCodeIndex", async () => {
  const actual = await vi.importActual("../localCodeIndex");
  return {
    ...actual,
    searchLocalCheckoutSymbols: searchLocalCheckoutSymbolsMock,
  };
});

import { executeTool } from "../execution/tools";

const temporaryRoots: string[] = [];

const createWorkspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "singularity-code-roots-"));
  temporaryRoots.push(root);
  return root;
};

const buildCapability = (workspacePath: string): Capability => ({
  id: "CAP-RULES",
  name: "Rule Engine",
  description: "Capability for repo-root resolution tests.",
  businessOutcome: "Ground code questions from the correct checkout roots.",
  successMetrics: ["Repo-backed reads/searches resolve through shared code roots."],
  definitionOfDone: "Code questions use AST/search from the actual clone root.",
  requiredEvidenceKinds: ["Code diff"],
  operatingPolicySummary: "Read from approved workspace roots only.",
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  repositories: [
    {
      id: "REPO-RULES",
      capabilityId: "CAP-RULES",
      label: "RuleEngine",
      url: "https://github.com/example/RuleEngine.git",
      defaultBranch: "main",
      isPrimary: true,
    },
  ],
  localDirectories: [],
  teamNames: [],
  stakeholders: [],
  additionalMetadata: [],
  lifecycle: createDefaultCapabilityLifecycle(),
  executionConfig: {
    defaultWorkspacePath: workspacePath,
    allowedWorkspacePaths: [workspacePath],
    commandTemplates: [],
    deploymentTargets: [],
  },
  status: "STABLE",
  skillLibrary: [],
});

const buildAgent = (): CapabilityAgent => ({
  id: "AGENT-SEARCH",
  capabilityId: "CAP-RULES",
  name: "Searcher",
  role: "Software Developer",
  objective: "Inspect code structure safely.",
  systemPrompt: "",
  contract: getStandardAgentContract("SOFTWARE-DEVELOPER"),
  initializationStatus: "READY",
  documentationSources: [],
  inputArtifacts: [],
  outputArtifacts: [],
  learningNotes: [],
  skillIds: [],
  preferredToolIds: ["browse_code", "workspace_search", "workspace_read"],
  provider: "GitHub Copilot SDK",
  model: "test-model",
  tokenLimit: 12000,
  usage: {
    requestCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  },
  previousOutputs: [],
  learningProfile: {
    status: "READY",
    summary: "",
    highlights: [],
    contextBlock: "",
    sourceDocumentIds: [],
    sourceArtifactIds: [],
    sourceCount: 0,
  },
  sessionSummaries: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  desktopState.workingDirectory = "";
  desktopState.clonePaths = [];
  rpcState.workspaceRoot = "";
});

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("repo-backed code roots", () => {
  it("uses discovered operator-working-directory clones for workspace_search AST queries", async () => {
    const workspaceRoot = createWorkspace();
    const cloneRoot = path.join(
      workspaceRoot,
      "_repos",
      "rule-engine",
      "ruleengine",
    );
    fs.mkdirSync(path.join(cloneRoot, "src/main/java/org/example/rules"), {
      recursive: true,
    });

    rpcState.workspaceRoot = workspaceRoot;
    desktopState.workingDirectory = workspaceRoot;
    desktopState.clonePaths = [cloneRoot];

    searchLocalCheckoutSymbolsMock.mockImplementation(
      async ({ checkoutPath, query }: { checkoutPath: string; query: string }) => {
        if (checkoutPath === cloneRoot && (query === "operator" || query === "operators")) {
          return {
            source: "local-checkout",
            builtAt: "2026-05-01T00:00:00.000Z",
            symbols: [
              {
                symbolId: "SYM-OP-ENUM",
                symbolName: "Operator",
                qualifiedSymbolName: "org.example.rules.Operator",
                kind: "ENUM",
                filePath: "src/main/java/org/example/rules/Operator.java",
                startLine: 1,
                endLine: 24,
                sliceStartLine: 1,
                sliceEndLine: 24,
              },
            ],
          };
        }
        return {
          source: "local-checkout",
          builtAt: "2026-05-01T00:00:00.000Z",
          symbols: [],
        };
      },
    );

    const result = await executeTool({
      capability: buildCapability(workspaceRoot),
      agent: buildAgent(),
      toolId: "workspace_search",
      args: {
        pattern: "How many operators are there in this rule engine?",
      },
    });

    expect(result.details).toMatchObject({
      codeIndexSource: "local-checkout",
      codeDiscoveryMode: "ast-first",
      astSearchAttempted: true,
      codeRootSource: "operator-workdir-discovered",
    });
    expect(result.stdoutPreview).toContain(
      `${cloneRoot}/src/main/java/org/example/rules/Operator.java`,
    );
    expect(searchLocalCheckoutSymbolsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutPath: cloneRoot,
      }),
    );
  });

  it("canonicalizes repo-prefixed workspace_read paths to the discovered clone root", async () => {
    const workspaceRoot = createWorkspace();
    const cloneRoot = path.join(
      workspaceRoot,
      "_repos",
      "rule-engine",
      "ruleengine",
    );
    const operatorFile = path.join(
      cloneRoot,
      "src/main/java/org/example/rules/Operator.java",
    );
    fs.mkdirSync(path.dirname(operatorFile), { recursive: true });
    fs.writeFileSync(
      operatorFile,
      "public enum Operator { eq, ne, lt, lte, gt, gte }",
      "utf8",
    );

    rpcState.workspaceRoot = workspaceRoot;
    desktopState.workingDirectory = workspaceRoot;
    desktopState.clonePaths = [cloneRoot];

    const result = await executeTool({
      capability: buildCapability(workspaceRoot),
      agent: buildAgent(),
      toolId: "workspace_read",
      args: {
        path: "ruleengine/src/main/java/org/example/rules/Operator.java",
      },
    });

    expect(result.details).toMatchObject({
      path: operatorFile,
      relativePath: "src/main/java/org/example/rules/Operator.java",
      pathResolutionMode: "repo-prefixed",
      requestedPathKind: "repo-prefixed",
      codeRootSource: "operator-workdir-discovered",
      toolWorkingRoot: cloneRoot,
    });
    expect(result.stdoutPreview).toContain("public enum Operator");
  });
});
