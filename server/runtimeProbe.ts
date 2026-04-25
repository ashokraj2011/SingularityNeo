import type {
  DesktopPreferences,
  ProviderKey,
  RuntimeProviderConfig,
  RuntimeProviderProbeResult,
  RuntimeProviderValidationResult,
} from "../src/types";
import { validateCopilotCliEndpoint } from "./githubModels";
import { validateLocalOpenAIChatProvider } from "./localOpenAIProvider";
import {
  DEFAULT_PROVIDER_KEY,
  LOCAL_OPENAI_PROVIDER_KEY,
  isCliRuntimeProviderKey,
  normalizeProviderKey,
} from "./providerRegistry";
import { getStoredRuntimeProviderConfig } from "./runtimeProviderConfig";
import { validateCliRuntimeProvider } from "./runtimeCli";
import { getConfiguredRuntimeProviderStatus } from "./runtimeProviders";

const trim = (value?: string | null) => String(value || "").trim();

const uniq = (values: Array<string | undefined | null>) =>
  [...new Set(values.map(value => trim(value)).filter(Boolean))];

const buildResult = ({
  providerKey,
  ok,
  message,
  attempted,
  validation,
  detectedEndpoint,
  detectedCommand,
  config,
  preferencePatch,
}: RuntimeProviderProbeResult): RuntimeProviderProbeResult => ({
  providerKey,
  ok,
  message,
  attempted,
  validation: validation || null,
  detectedEndpoint: detectedEndpoint || null,
  detectedCommand: detectedCommand || null,
  config: config || null,
  preferencePatch: preferencePatch || undefined,
});

const probeGitHubCopilotProvider = async ({
  endpointHint,
}: {
  endpointHint?: string;
}): Promise<RuntimeProviderProbeResult> => {
  const attempted: string[] = [];
  const candidates = uniq([
    endpointHint,
    process.env.COPILOT_CLI_URL,
    "http://127.0.0.1:4321",
    "http://localhost:4321",
  ]);

  let lastError = "No reachable GitHub Copilot SDK session endpoint was found.";
  for (const candidate of candidates) {
    attempted.push(candidate);
    try {
      const validation = await validateCopilotCliEndpoint({
        cliUrl: candidate,
      });
      const validationPayload: RuntimeProviderValidationResult = {
        providerKey: DEFAULT_PROVIDER_KEY,
        ok: true,
        status: "configured",
        message: validation.message,
        transportMode: "sdk-session",
        detectedCommand: undefined,
        installed: true,
        authenticated: true,
        workingDirectoryAllowed: null,
        usageEstimated: false,
        models: validation.models,
        checkedAt: new Date().toISOString(),
      };
      return buildResult({
        providerKey: DEFAULT_PROVIDER_KEY,
        ok: true,
        message: validation.message,
        attempted,
        detectedEndpoint: candidate,
        validation: validationPayload,
        preferencePatch: {
          copilotCliUrl: candidate,
        } satisfies Partial<DesktopPreferences>,
      });
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "GitHub Copilot probe failed.";
    }
  }

  const configuredStatus = await getConfiguredRuntimeProviderStatus(DEFAULT_PROVIDER_KEY);
  if (configuredStatus.configured) {
    const configuredMessage =
      configuredStatus.transportMode === "http-api"
        ? "No local SDK session endpoint was detected, but GitHub Copilot is configured through the GitHub Models HTTP runtime."
        : configuredStatus.transportMode === "sdk-session"
          ? "GitHub Copilot is configured, but the current SDK session endpoint could not be re-validated."
          : configuredStatus.validation?.message ||
            "GitHub Copilot is configured in this environment.";

    return buildResult({
      providerKey: DEFAULT_PROVIDER_KEY,
      ok: true,
      message: configuredMessage,
      attempted,
      validation: configuredStatus.validation || undefined,
      detectedEndpoint: configuredStatus.endpoint || null,
    });
  }

  return buildResult({
    providerKey: DEFAULT_PROVIDER_KEY,
    ok: false,
    message: lastError,
    attempted,
    validation: {
      providerKey: DEFAULT_PROVIDER_KEY,
      ok: false,
      status: "unavailable",
      message: lastError,
      transportMode: "sdk-session",
      installed: false,
      authenticated: null,
      workingDirectoryAllowed: null,
      usageEstimated: false,
      checkedAt: new Date().toISOString(),
    },
  });
};

const probeLocalOpenAIProvider = async ({
  endpointHint,
  modelHint,
}: {
  endpointHint?: string;
  modelHint?: string;
}): Promise<RuntimeProviderProbeResult> => {
  const attempted: string[] = [];
  const candidates = uniq([
    endpointHint,
    process.env.LOCAL_OPENAI_BASE_URL,
    process.env.OPENAI_COMPAT_BASE_URL,
    "http://127.0.0.1:11434/v1",
    "http://localhost:11434/v1",
    "http://127.0.0.1:1234/v1",
    "http://localhost:1234/v1",
  ]);

  let lastError = "No reachable local OpenAI-compatible endpoint was found.";
  for (const candidate of candidates) {
    attempted.push(candidate);
    try {
      const validation = await validateLocalOpenAIChatProvider({
        baseUrl: candidate,
        apiKey: process.env.LOCAL_OPENAI_API_KEY || process.env.OPENAI_COMPAT_API_KEY || "local",
        model: modelHint,
      });
      const validationPayload: RuntimeProviderValidationResult = {
        providerKey: LOCAL_OPENAI_PROVIDER_KEY,
        ok: true,
        status: "configured",
        message: `Connected to the local OpenAI-compatible provider at ${candidate}.`,
        transportMode: "local-openai",
        installed: true,
        authenticated: null,
        workingDirectoryAllowed: null,
        usageEstimated: false,
        models: validation.models,
        checkedAt: new Date().toISOString(),
      };
      return buildResult({
        providerKey: LOCAL_OPENAI_PROVIDER_KEY,
        ok: true,
        message: validationPayload.message,
        attempted,
        detectedEndpoint: candidate,
        validation: validationPayload,
        preferencePatch: {
          embeddingBaseUrl: candidate,
          embeddingModel: validation.model,
        } satisfies Partial<DesktopPreferences>,
      });
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "Local OpenAI-compatible provider probe failed.";
    }
  }

  return buildResult({
    providerKey: LOCAL_OPENAI_PROVIDER_KEY,
    ok: false,
    message: lastError,
    attempted,
    validation: {
      providerKey: LOCAL_OPENAI_PROVIDER_KEY,
      ok: false,
      status: "unavailable",
      message: lastError,
      transportMode: "local-openai",
      installed: false,
      authenticated: null,
      workingDirectoryAllowed: null,
      usageEstimated: false,
      checkedAt: new Date().toISOString(),
    },
  });
};

const probeCliRuntimeProvider = async ({
  providerKey,
  commandHint,
  modelHint,
}: {
  providerKey: ProviderKey;
  commandHint?: string;
  modelHint?: string;
}): Promise<RuntimeProviderProbeResult> => {
  const storedConfig = (await getStoredRuntimeProviderConfig({ providerKey })) || {};
  const config: RuntimeProviderConfig = {
    ...storedConfig,
    ...(trim(commandHint) ? { command: trim(commandHint) } : {}),
    ...(trim(modelHint) ? { model: trim(modelHint) } : {}),
  };
  const validation = await validateCliRuntimeProvider({
    providerKey,
    config,
  });

  return buildResult({
    providerKey,
    ok: validation.ok,
    message: validation.message,
    attempted: [trim(commandHint), trim(config.command)].filter(Boolean),
    validation,
    detectedCommand: validation.detectedCommand || trim(config.command) || null,
    config: {
      ...config,
      command: validation.detectedCommand || trim(config.command) || undefined,
    },
  });
};

export const probeRuntimeProvider = async ({
  providerKey,
  endpointHint,
  commandHint,
  modelHint,
}: {
  providerKey: ProviderKey;
  endpointHint?: string;
  commandHint?: string;
  modelHint?: string;
}): Promise<RuntimeProviderProbeResult> => {
  const normalizedProviderKey = normalizeProviderKey(providerKey);
  if (normalizedProviderKey === DEFAULT_PROVIDER_KEY) {
    return probeGitHubCopilotProvider({ endpointHint });
  }
  if (normalizedProviderKey === LOCAL_OPENAI_PROVIDER_KEY) {
    return probeLocalOpenAIProvider({ endpointHint, modelHint });
  }
  if (isCliRuntimeProviderKey(normalizedProviderKey)) {
    return probeCliRuntimeProvider({
      providerKey: normalizedProviderKey,
      commandHint,
      modelHint,
    });
  }

  return buildResult({
    providerKey: normalizedProviderKey,
    ok: false,
    message: `${normalizedProviderKey} does not support probing in this environment yet.`,
    attempted: [],
    validation: {
      providerKey: normalizedProviderKey,
      ok: false,
      status: "unavailable",
      message: `${normalizedProviderKey} does not support probing in this environment yet.`,
      transportMode: "unconfigured",
      installed: false,
      authenticated: null,
      workingDirectoryAllowed: null,
      checkedAt: new Date().toISOString(),
    },
  });
};
