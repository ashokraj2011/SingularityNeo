import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Capability,
  CapabilityAgent,
  RuntimeProviderStatus,
  Workflow,
  WorkflowStep,
  WorkItem,
} from "../../src/types";

const { getConfiguredRuntimeProviderStatus } = vi.hoisted(() => ({
  getConfiguredRuntimeProviderStatus: vi.fn(),
}));

vi.mock("../runtimeProviders", () => ({
  getConfiguredRuntimeProviderStatus,
}));

import { validateExecutionStartRuntime } from "../execution/runtimeValidation";

const buildWorkflow = (steps: WorkflowStep[]): Workflow =>
  ({
    id: "WF-1",
    name: "Delivery Workflow",
    capabilityId: "CAP-1",
    steps,
    status: "STABLE",
  }) as Workflow;

const buildCapability = (): Capability =>
  ({
    id: "CAP-1",
    name: "Payments Capability",
    repositories: [
      {
        id: "REPO-1",
        capabilityId: "CAP-1",
        label: "primary",
        url: "https://github.com/example/repo",
        defaultBranch: "main",
        isPrimary: true,
      },
    ],
  }) as Capability;

const buildWorkItem = (): WorkItem =>
  ({
    id: "WI-1",
    capabilityId: "CAP-1",
    workflowId: "WF-1",
    title: "Implement the flow",
    description: "Ship the change",
    phase: "DEVELOPMENT",
    currentStepId: "STEP-1",
    assignedAgentId: "AGENT-1",
    status: "STAGED",
    priority: "Med",
    tags: [],
    history: [],
    recordVersion: 1,
  }) as WorkItem;

const buildAgent = (): CapabilityAgent =>
  ({
    id: "AGENT-1",
    capabilityId: "CAP-1",
    name: "Implementation Agent",
    role: "Engineer",
    objective: "Implement the change safely",
    systemPrompt: "Be helpful.",
    contract: {
      coreMission: "Implement safely",
      operatingModes: [],
      nonNegotiables: [],
      escalationTriggers: [],
      doneCriteria: [],
      evidencePolicy: {
        requiredArtifacts: [],
        verificationSteps: [],
        citationStyle: "NONE",
      },
      toolPolicy: {
        allowedCategories: [],
        blockedTools: [],
        requiredChecks: [],
      },
      communicationPolicy: {
        tone: "Direct",
        updateCadence: "On milestones",
        escalationFormat: "Bullet list",
      },
    },
    initializationStatus: "READY",
    documentationSources: [],
    inputArtifacts: [],
    outputArtifacts: [],
    skillIds: [],
    provider: "Local OpenAI-Compatible",
    providerKey: "local-openai",
    model: "qwen2.5-coder:7b",
    tokenLimit: 32000,
    usage: {
      sessions: 0,
      totalTokens: 0,
      averageLatencyMs: 0,
    },
    previousOutputs: [],
    learningProfile: {
      versionId: "LP-1",
      summary: "",
      highlights: [],
      sourceDocumentIds: [],
      contextBlock: "",
      lastUpdated: new Date(0).toISOString(),
    },
    sessionSummaries: [],
  }) as CapabilityAgent;

const buildStep = (): WorkflowStep =>
  ({
    id: "STEP-1",
    name: "Implement feature",
    phase: "DEVELOPMENT",
    stepType: "DELIVERY",
    agentId: "AGENT-1",
    action: "Write the implementation",
    allowedToolIds: [],
  }) as WorkflowStep;

const buildProviderStatus = (
  overrides: Partial<RuntimeProviderStatus> = {},
): RuntimeProviderStatus =>
  ({
    key: "local-openai",
    label: "Local OpenAI-Compatible",
    transportMode: "local-openai",
    configured: true,
    endpoint: "http://127.0.0.1:11434/v1",
    command: null,
    model: "qwen2.5-coder:7b",
    supportsSessions: true,
    supportsTools: true,
    supportsWorkspaceAutonomy: false,
    availableModels: [],
    validation: {
      providerKey: "local-openai",
      ok: true,
      status: "configured",
      message: "Local OpenAI-Compatible is configured.",
      transportMode: "local-openai",
      installed: true,
      authenticated: null,
      workingDirectoryAllowed: null,
      checkedAt: new Date().toISOString(),
    },
    config: null,
    ...overrides,
  }) as RuntimeProviderStatus;

describe("execution runtime validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the start-step runtime with the same provider selection used by execution", async () => {
    getConfiguredRuntimeProviderStatus.mockResolvedValue(
      buildProviderStatus(),
    );

    const result = await validateExecutionStartRuntime({
      capability: buildCapability(),
      workItem: buildWorkItem(),
      workflow: buildWorkflow([buildStep()]),
      agents: [buildAgent()],
    });

    expect(result.selection.providerKey).toBe("local-openai");
    expect(result.selection.model).toBe("qwen2.5-coder:7b");
    expect(result.providerStatus.validation?.ok).toBe(true);
    expect(result.startStep.id).toBe("STEP-1");
  });

  it("fails fast with the provider validation message when execution runtime is invalid", async () => {
    getConfiguredRuntimeProviderStatus.mockResolvedValue(
      buildProviderStatus({
        configured: false,
        validation: {
          providerKey: "local-openai",
          ok: false,
          status: "invalid",
          message:
            'Local OpenAI-compatible runtime is misconfigured: endpoint is OpenAI (https://api.openai.com/v1) but model "qwen2.5-coder:7b" looks local/Ollama.',
          transportMode: "local-openai",
          installed: true,
          authenticated: null,
          workingDirectoryAllowed: null,
          checkedAt: new Date().toISOString(),
        },
      }),
    );

    await expect(
      validateExecutionStartRuntime({
        capability: buildCapability(),
        workItem: buildWorkItem(),
        workflow: buildWorkflow([buildStep()]),
        agents: [buildAgent()],
      }),
    ).rejects.toThrow(
      'Local OpenAI-compatible runtime is misconfigured: endpoint is OpenAI (https://api.openai.com/v1) but model "qwen2.5-coder:7b" looks local/Ollama.',
    );
  });
});
