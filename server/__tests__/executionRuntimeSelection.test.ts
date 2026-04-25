import { describe, expect, it } from "vitest";
import type { CapabilityAgent, WorkflowStep } from "../../src/types";
import {
  buildExecutionRuntimeAgent,
  isExternalRuntimeEligibleStep,
  resolveExecutionRuntimeForStep,
} from "../execution/runtimeSelection";

const buildStep = (
  overrides: Partial<WorkflowStep> = {},
): WorkflowStep => ({
  id: "STEP-1",
  name: "Implement feature",
  phase: "DEVELOPMENT",
  stepType: "DELIVERY",
  action: "Write the code changes",
  ...overrides,
});

const buildAgent = (
  overrides: Partial<CapabilityAgent> = {},
): CapabilityAgent =>
  ({
    id: "AGENT-1",
    capabilityId: "CAP-1",
    name: "Implementation Agent",
    role: "Engineer",
    objective: "Ship the change safely",
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
    provider: "GitHub Copilot SDK",
    providerKey: "github-copilot",
    model: "gpt-4.1-mini",
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
    ...overrides,
  }) as CapabilityAgent;

describe("execution runtime selection", () => {
  it("uses the step override for eligible code phases", () => {
    const selection = resolveExecutionRuntimeForStep({
      step: buildStep({
        runtimeProviderKey: "codex-cli",
        runtimeModel: "gpt-5-codex",
      }),
      agent: buildAgent(),
      defaultProviderKey: "github-copilot",
      resolveTransportMode: () => "desktop-cli",
    });

    expect(selection).toMatchObject({
      providerKey: "codex-cli",
      model: "gpt-5-codex",
      source: "step",
      transportMode: "desktop-cli",
      usageEstimated: true,
      externalRuntimeEligible: true,
    });
  });

  it("falls back to a Singularity-owned runtime for non-code phases when a CLI provider is selected", () => {
    const selection = resolveExecutionRuntimeForStep({
      step: buildStep({
        phase: "RELEASE",
        runtimeProviderKey: "codex-cli",
      }),
      agent: buildAgent({
        providerKey: "codex-cli",
        provider: "Codex CLI",
        model: "gpt-5-codex",
      }),
      defaultProviderKey: "codex-cli",
      localOpenAIAvailable: true,
      localOpenAIModel: "qwen2.5-coder",
      resolveTransportMode: (providerKey) =>
        providerKey === "local-openai" ? "local-openai" : "desktop-cli",
    });

    expect(selection).toMatchObject({
      providerKey: "local-openai",
      model: "qwen2.5-coder",
      source: "fallback-internal",
      transportMode: "local-openai",
      usageEstimated: false,
      externalRuntimeEligible: false,
    });
  });

  it("falls back to GitHub Copilot when only CLI providers are configured for a non-code phase", () => {
    const selection = resolveExecutionRuntimeForStep({
      step: buildStep({
        phase: "QA",
      }),
      agent: buildAgent({
        providerKey: "claude-code-cli",
        provider: "Claude Code CLI",
        model: "sonnet",
      }),
      defaultProviderKey: "codex-cli",
      localOpenAIAvailable: false,
      githubProviderModel: "gpt-4o",
      resolveTransportMode: () => "sdk-session",
    });

    expect(selection).toMatchObject({
      providerKey: "github-copilot",
      model: "gpt-4o",
      source: "fallback-internal",
      transportMode: "sdk-session",
      usageEstimated: false,
      externalRuntimeEligible: false,
    });
  });

  it("uses provider-aware model defaults instead of leaking the old agent model into a CLI selection", () => {
    const selection = resolveExecutionRuntimeForStep({
      step: buildStep({
        runtimeProviderKey: "codex-cli",
      }),
      agent: buildAgent({
        model: "gpt-4.1",
      }),
      defaultProviderKey: "github-copilot",
      resolveCliModel: () => "",
      resolveTransportMode: () => "desktop-cli",
    });
    const runtimeAgent = buildExecutionRuntimeAgent({
      agent: buildAgent({
        model: "gpt-4.1",
      }),
      selection,
    });

    expect(selection.providerKey).toBe("codex-cli");
    expect(selection.model).toBe("");
    expect(runtimeAgent.model).toBe("");
  });

  it("falls back to an internal runtime when the capability has no GitHub code repository", () => {
    const selection = resolveExecutionRuntimeForStep({
      step: buildStep({
        runtimeProviderKey: "codex-cli",
      }),
      agent: buildAgent(),
      hasGitHubCodeRepository: false,
      localOpenAIAvailable: false,
      githubProviderModel: "gpt-4o-mini",
      resolveTransportMode: () => "sdk-session",
    });

    expect(selection).toMatchObject({
      providerKey: "github-copilot",
      model: "gpt-4.1-mini",
      source: "fallback-internal",
      externalRuntimeEligible: false,
    });
  });

  it("marks only code-oriented steps as eligible for external runtime adapters", () => {
    expect(
      isExternalRuntimeEligibleStep(
        buildStep({
          phase: "DEVELOPMENT",
          stepType: "DELIVERY",
        }),
      ),
    ).toBe(true);
    expect(
      isExternalRuntimeEligibleStep(
        buildStep({
          phase: "RELEASE",
          stepType: "DELIVERY",
        }),
      ),
    ).toBe(false);
    expect(
      isExternalRuntimeEligibleStep(
        buildStep({
          phase: "DEVELOPMENT",
          stepType: "HUMAN_APPROVAL",
        }),
      ),
    ).toBe(false);
  });
});
