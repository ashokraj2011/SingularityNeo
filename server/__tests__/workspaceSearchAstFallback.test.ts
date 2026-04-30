// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Capability, CapabilityAgent, WorkItem } from "../../src/types";
import { getStandardAgentContract } from "../../src/constants";
import { createDefaultCapabilityLifecycle } from "../../src/lib/capabilityLifecycle";

const { searchLocalCheckoutSymbolsMock, searchCodeSymbolsMock, rpcState } =
  vi.hoisted(() => ({
    searchLocalCheckoutSymbolsMock: vi.fn(),
    searchCodeSymbolsMock: vi.fn(),
    rpcState: { workspaceRoot: "/tmp" },
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

vi.mock("../localCodeIndex", async () => {
  const actual = await vi.importActual("../localCodeIndex");
  return {
    ...actual,
    searchLocalCheckoutSymbols: searchLocalCheckoutSymbolsMock,
  };
});

vi.mock("../codeIndex/query", async () => {
  const actual = await vi.importActual("../codeIndex/query");
  return {
    ...actual,
    searchCodeSymbols: searchCodeSymbolsMock,
  };
});

import { executeTool } from "../execution/tools";

const temporaryRoots: string[] = [];

const createWorkspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "singularity-search-"));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, "src/main/java/org/example/rules/operators"), {
    recursive: true,
  });
  return root;
};

const buildCapability = (workspacePath: string): Capability => ({
  id: "CAP-RULES",
  name: "Rule Engine",
  description: "Capability for AST-first search tests.",
  businessOutcome: "Search code from the indexed AST before grep fallback.",
  successMetrics: ["Natural-language code questions resolve against AST data first."],
  definitionOfDone: "workspace_search prefers indexed symbol results for code questions.",
  requiredEvidenceKinds: ["Code diff"],
  operatingPolicySummary: "Read from approved workspace roots only.",
  applications: [],
  apis: [],
  databases: [],
  gitRepositories: [],
  repositories: [],
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

const buildWorkItem = (): WorkItem => ({
  id: "WI-RULES-1",
  capabilityId: "CAP-RULES",
  title: "Inspect rule engine operators",
  description: "Determine the available operators in the rule engine.",
  phase: "DEVELOPMENT",
  status: "IN_PROGRESS",
  priority: "P1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  artifacts: [],
  executionContext: {
    primaryRepositoryId: "REPO-RULES",
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("workspace_search AST-first fallback", () => {
  it("normalizes natural-language code questions before searching local checkout AST", async () => {
    const workspacePath = createWorkspace();
    rpcState.workspaceRoot = workspacePath;

    searchLocalCheckoutSymbolsMock.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query === "operator" || query === "operators") {
          return {
            source: "local-checkout",
            builtAt: "2026-04-30T00:00:00.000Z",
            symbols: [
              {
                symbolId: "SYM-OP-1",
                symbolName: "EqualsOperator",
                qualifiedSymbolName: "operators.EqualsOperator",
                kind: "CLASS",
                filePath:
                  "src/main/java/org/example/rules/operators/EqualsOperator.java",
                startLine: 1,
                endLine: 40,
                sliceStartLine: 1,
                sliceEndLine: 40,
              },
            ],
          };
        }

        return {
          source: "local-checkout",
          builtAt: "2026-04-30T00:00:00.000Z",
          symbols: [],
        };
      },
    );
    searchCodeSymbolsMock.mockResolvedValue([]);

    const result = await executeTool({
      capability: buildCapability(workspacePath),
      agent: buildAgent(),
      workItem: buildWorkItem(),
      toolId: "workspace_search",
      args: {
        pattern: "How many operators are there in this rule engine?",
      },
    });

    expect(result.summary).toContain("indexed symbol match");
    expect(result.details).toMatchObject({
      codeIndexSource: "local-checkout",
      codeDiscoveryMode: "ast-first",
      mode: "symbol-search",
    });
    expect((result.details as { normalizedQueries?: string[] }).normalizedQueries).toEqual(
      expect.arrayContaining(["operators", "operator"]),
    );
    expect(
      searchLocalCheckoutSymbolsMock.mock.calls.map(
        ([input]: [{ query: string }]) => input.query,
      ),
    ).toEqual(expect.arrayContaining(["operators"]));
    expect(result.stdoutPreview).toContain(
      `${workspacePath}/src/main/java/org/example/rules/operators/EqualsOperator.java`,
    );
    expect(searchCodeSymbolsMock).not.toHaveBeenCalled();
  });

  it("lets browse_code use a semantic query so inventory questions can resolve enums and related symbols", async () => {
    const workspacePath = createWorkspace();
    rpcState.workspaceRoot = workspacePath;

    searchLocalCheckoutSymbolsMock.mockImplementation(
      async ({ query }: { query: string }) => {
        if (query === "operator") {
          return {
            source: "local-checkout",
            builtAt: "2026-04-30T00:00:00.000Z",
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
          builtAt: "2026-04-30T00:00:00.000Z",
          symbols: [],
        };
      },
    );
    searchCodeSymbolsMock.mockResolvedValue([]);

    const result = await executeTool({
      capability: buildCapability(workspacePath),
      agent: buildAgent(),
      workItem: buildWorkItem(),
      toolId: "browse_code",
      args: {
        kind: "class",
        query: "What are the operators in the rule engine?",
      },
    });

    expect(result.summary).toContain("semantic symbol match");
    expect(result.details).toMatchObject({
      codeIndexSource: "local-checkout",
      codeDiscoveryMode: "ast-first",
      mode: "symbol-search",
      query: "What are the operators in the rule engine?",
    });
    expect((result.details as { normalizedQueries?: string[] }).normalizedQueries).toEqual(
      expect.arrayContaining(["operators", "operator"]),
    );
    expect(result.stdoutPreview).toContain(
      `${workspacePath}/src/main/java/org/example/rules/Operator.java`,
    );
  });
});
