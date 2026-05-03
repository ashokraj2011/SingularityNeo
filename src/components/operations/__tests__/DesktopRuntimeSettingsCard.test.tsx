import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DesktopRuntimeSettingsCard from "../DesktopRuntimeSettingsCard";
import type { RuntimeProviderStatus } from "../../../types";

const providers: RuntimeProviderStatus[] = [
  {
    key: "local-openai",
    label: "Local OpenAI-Compatible",
    transportMode: "local-openai",
    configured: true,
    defaultSelected: true,
    endpoint: "http://localhost:11434/v1",
    model: "qwen2.5-coder:32b",
    supportsSessions: true,
    supportsTools: true,
    supportsWorkspaceAutonomy: false,
    availableModels: [],
    validation: null,
    config: null,
  },
  {
    key: "github-copilot",
    label: "GitHub Copilot SDK",
    transportMode: "sdk-session",
    configured: false,
    supportsSessions: true,
    supportsTools: true,
    supportsWorkspaceAutonomy: false,
    availableModels: [],
    validation: null,
    config: null,
  },
];

describe("DesktopRuntimeSettingsCard", () => {
  it("falls back to runtimeStatus.availableProviders for the default-provider selector", () => {
    render(
      <DesktopRuntimeSettingsCard
        runtimeStatus={{
          configured: true,
          provider: "Local OpenAI-Compatible",
          providerKey: "local-openai",
          tokenSource: null,
          defaultModel: "qwen2.5-coder:32b",
          endpoint: "http://localhost:11434/v1",
          availableModels: [],
          availableProviders: providers,
          runtimeAccessMode: "local-openai",
        }}
        runtimeStatusError=""
        runtimeTokenInput=""
        isUpdatingRuntime={false}
        runtimeProviders={[]}
        runtimeProviderDrafts={{}}
        runtimeProviderBusyKey=""
        defaultRuntimeProviderKey="local-openai"
        embeddingBaseUrlInput=""
        embeddingApiKeyInput=""
        embeddingModelInput=""
        isUpdatingEmbeddings={false}
        httpProviderDrafts={{}}
        httpProviderBusyKey=""
        httpEffectiveDefault={null}
        httpAvailableProviders={[]}
        onRuntimeTokenInputChange={vi.fn()}
        onSave={vi.fn()}
        onClear={vi.fn()}
        onRefresh={vi.fn()}
        onDefaultRuntimeProviderChange={vi.fn()}
        onSaveDefaultRuntimeProvider={vi.fn()}
        onProbeDefaultRuntimeProvider={vi.fn()}
        onUseRuntimeProviderNow={vi.fn()}
        onRuntimeProviderDraftChange={vi.fn()}
        onSaveRuntimeProvider={vi.fn()}
        onValidateRuntimeProvider={vi.fn()}
        onEmbeddingBaseUrlInputChange={vi.fn()}
        onEmbeddingApiKeyInputChange={vi.fn()}
        onEmbeddingModelInputChange={vi.fn()}
        onSaveEmbeddings={vi.fn()}
        onClearEmbeddings={vi.fn()}
        onHttpProviderDraftChange={vi.fn()}
        onSaveHttpProvider={vi.fn()}
        onSetHttpProviderDefault={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("option", { name: "Local OpenAI-Compatible" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "GitHub Copilot SDK" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("local-openai");
  });
});
