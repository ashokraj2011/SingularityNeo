import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  ExternalLink,
  GitBranch,
  Laptop2,
  LoaderCircle,
  Lock,
  LockOpen,
  MonitorCog,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unplug,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import DesktopRuntimeSettingsCard from "../components/operations/DesktopRuntimeSettingsCard";
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "../components/EnterpriseUI";
import { useCapability } from "../context/CapabilityContext";
import { useToast } from "../context/ToastContext";
import { hasPermission } from "../lib/accessControl";
import {
  claimCapabilityExecution,
  clearLocalEmbeddingSettings,
  clearRuntimeCredentials,
  createDesktopWorkspaceMapping,
  deleteDesktopWorkspaceMapping,
  fetchDesktopPreferences,
  fetchExecutorRegistry,
  fetchDesktopWorkspaceMappings,
  fetchRuntimeStatus,
  fetchWorkspaceWriteLock,
  releaseCapabilityExecution,
  removeDesktopExecutor,
  saveDesktopPreferences,
  syncCapabilityRepositories,
  updateLocalEmbeddingSettings,
  updateRuntimeCredentials,
  updateDesktopWorkspaceMapping,
  type RuntimeStatus,
} from "../lib/api";
import type {
  DesktopPreferences,
  DesktopWorkspaceMapping,
  ExecutorRegistrySummary,
  WorkspaceWriteLock,
} from "../types";

const formatTimestamp = (value?: string) => {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const heartbeatTone = (status?: string) => {
  switch (status) {
    case "FRESH":
      return "success" as const;
    case "STALE":
      return "warning" as const;
    case "OFFLINE":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
};

const readinessTone = (status?: string) => {
  switch (status) {
    case "healthy":
      return "success" as const;
    case "degraded":
      return "warning" as const;
    case "blocked":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
};

const Operations = () => {
  const navigate = useNavigate();
  const {
    activeCapability,
    getCapabilityWorkspace,
    refreshCapabilityBundle,
    currentActorContext,
  } = useCapability();
  const { success, error: showError } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [registry, setRegistry] = useState<ExecutorRegistrySummary | null>(
    null,
  );
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(
    null,
  );
  const [runtimeStatusError, setRuntimeStatusError] = useState("");
  const [runtimeTokenInput, setRuntimeTokenInput] = useState("");
  const [isUpdatingRuntime, setIsUpdatingRuntime] = useState(false);
  const [embeddingBaseUrlInput, setEmbeddingBaseUrlInput] = useState("");
  const [embeddingApiKeyInput, setEmbeddingApiKeyInput] = useState("");
  const [embeddingModelInput, setEmbeddingModelInput] = useState("");
  const [isUpdatingEmbeddings, setIsUpdatingEmbeddings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [writeLock, setWriteLock] = useState<WorkspaceWriteLock | null>(null);
  const [workspaceMappings, setWorkspaceMappings] = useState<
    DesktopWorkspaceMapping[]
  >([]);
  const [workspaceMappingsLoading, setWorkspaceMappingsLoading] =
    useState(false);
  const [workspaceMappingBusyKey, setWorkspaceMappingBusyKey] = useState("");
  const [workspaceMappingDrafts, setWorkspaceMappingDrafts] = useState<
    Record<string, { localRootPath: string; workingDirectoryPath: string }>
  >({});
  const lockPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Desktop preferences
  const [desktopPrefs, setDesktopPrefs] = useState<DesktopPreferences | null>(null);
  const [prefsDraft, setPrefsDraft] = useState<{
    workingDirectory: string;
    copilotCliUrl: string;
    allowHttpFallback: boolean;
    embeddingBaseUrl: string;
    embeddingModel: string;
  }>({
    workingDirectory: "",
    copilotCliUrl: "",
    allowHttpFallback: false,
    embeddingBaseUrl: "",
    embeddingModel: "",
  });
  const [prefsBusy, setPrefsBusy] = useState(false);

  const canClaimExecution = hasPermission(
    activeCapability.effectivePermissions,
    "capability.execution.claim",
  );
  const canManageWorkspace = Boolean(
    currentActorContext.workspaceRoles?.includes("WORKSPACE_ADMIN"),
  );
  const workspaceMappingRows = React.useMemo(() => {
    const repositories = (activeCapability.repositories || []).filter(
      (repository) => repository.status !== "ARCHIVED",
    );
    if (repositories.length > 0) {
      return repositories.map((repository) => ({
        key: repository.id,
        label: repository.label,
        repositoryId: repository.id,
        suggestedLocalRoot: repository.localRootHint || "",
        suggestedWorkingDirectory:
          repository.localRootHint ||
          activeCapability.executionConfig.defaultWorkspacePath ||
          activeCapability.localDirectories[0] ||
          "",
      }));
    }

    const fallbackSuggestion =
      activeCapability.executionConfig.defaultWorkspacePath ||
      activeCapability.localDirectories[0] ||
      "";

    return [
      {
        key: "capability-fallback",
        label: "Capability fallback workspace",
        repositoryId: undefined as string | undefined,
        suggestedLocalRoot: fallbackSuggestion,
        suggestedWorkingDirectory: fallbackSuggestion,
      },
    ];
  }, [
    activeCapability.executionConfig.defaultWorkspacePath,
    activeCapability.localDirectories,
    activeCapability.repositories,
  ]);
  const systemFacts = React.useMemo(
    () => [
      {
        label: "Readiness",
        value: runtimeStatus?.readinessState || "unknown",
        tone: readinessTone(runtimeStatus?.readinessState),
      },
      {
        label: "Active DB",
        value:
          runtimeStatus?.databaseRuntime?.databaseName ||
          runtimeStatus?.activeDatabaseProfileLabel ||
          "unknown",
        helper: runtimeStatus?.databaseRuntime
          ? `${runtimeStatus.databaseRuntime.host}:${runtimeStatus.databaseRuntime.port}`
          : "No database runtime reported.",
      },
      {
        label: "Control plane",
        value: runtimeStatus?.controlPlaneUrl || "unknown",
        helper:
          runtimeStatus?.runtimeOwner === "DESKTOP"
            ? "Reported by desktop runtime."
            : "Reported by server runtime.",
      },
      {
        label: "Executor",
        value: runtimeStatus?.desktopExecutorId || runtimeStatus?.executorId || "not connected",
        helper: runtimeStatus?.executorHeartbeatStatus
          ? `Heartbeat ${runtimeStatus.executorHeartbeatStatus}`
          : "No desktop heartbeat yet.",
      },
      {
        label: "Operator",
        value: runtimeStatus?.actorDisplayName || currentActorContext.displayName || "not selected",
        helper: runtimeStatus?.actorUserId || currentActorContext.userId || "Choose an operator before claiming.",
      },
      {
        label: "Workspace source",
        value: runtimeStatus?.workingDirectorySource || "unknown",
        helper: runtimeStatus?.workingDirectory || "No working directory published.",
      },
    ],
    [currentActorContext, runtimeStatus],
  );
  const runtimeRefreshFailureMessage =
    "Unable to load desktop execution runtime status.";

  const refreshRuntimeIdentity = async () => {
    try {
      const status = await fetchRuntimeStatus();
      setRuntimeStatus(status);
      setRuntimeStatusError("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : runtimeRefreshFailureMessage;
      setRuntimeStatusError(message);
      showError("Runtime refresh failed", message);
    }
  };

  const handleRuntimeOverrideSave = async () => {
    const nextToken = runtimeTokenInput.trim();
    if (!nextToken) {
      showError("Runtime key required", "Paste a runtime key before saving it to this desktop.");
      return;
    }

    setIsUpdatingRuntime(true);
    try {
      const status = await updateRuntimeCredentials(nextToken);
      setRuntimeStatus(status);
      setRuntimeStatusError("");
      setRuntimeTokenInput("");
      success(
        "Desktop runtime key updated",
        status.githubIdentity?.login
          ? `Saved to this desktop's .env.local and validated against GitHub Models as @${status.githubIdentity.login}.`
          : "Saved to this desktop's .env.local and validated against the live model runtime.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to update the desktop runtime key.";
      setRuntimeStatusError(message);
      showError("Desktop runtime update failed", message);
    } finally {
      setIsUpdatingRuntime(false);
    }
  };

  const handleRuntimeOverrideClear = async () => {
    setIsUpdatingRuntime(true);
    try {
      const status = await clearRuntimeCredentials();
      setRuntimeStatus(status);
      setRuntimeStatusError("");
      setRuntimeTokenInput("");
      success(
        "Desktop runtime key cleared",
        "Removed from this desktop's .env.local and reverted to the remaining runtime environment configuration.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to clear the desktop runtime key.";
      setRuntimeStatusError(message);
      showError("Desktop runtime clear failed", message);
    } finally {
      setIsUpdatingRuntime(false);
    }
  };

  const handleEmbeddingSettingsSave = async () => {
    const nextBaseUrl = embeddingBaseUrlInput.trim();
    if (!nextBaseUrl) {
      showError(
        "Embedding endpoint required",
        "Enter the local embedding base URL before saving desktop embedding settings.",
      );
      return;
    }

    setIsUpdatingEmbeddings(true);
    try {
      const status = await updateLocalEmbeddingSettings({
        baseUrl: nextBaseUrl,
        apiKey: embeddingApiKeyInput.trim() || undefined,
        model: embeddingModelInput.trim() || undefined,
      });
      setRuntimeStatus(status);
      setRuntimeStatusError("");
      setEmbeddingApiKeyInput("");
      success(
        "Desktop embedding settings updated",
        status.retrievalMode === "pgvector"
          ? "Saved to this desktop's .env.local, validated live, and memory retrieval will use pgvector in the active database."
          : status.retrievalMode === "json-cosine"
            ? "Saved to this desktop's .env.local, validated live, and memory retrieval will use JSON cosine because pgvector is unavailable."
            : "Saved to this desktop's .env.local. Without a validated embedding endpoint, memory retrieval falls back to the built-in deterministic-hash path.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to update desktop embedding settings.";
      showError("Desktop embedding update failed", message);
    } finally {
      setIsUpdatingEmbeddings(false);
    }
  };

  const handleEmbeddingSettingsClear = async () => {
    setIsUpdatingEmbeddings(true);
    try {
      const status = await clearLocalEmbeddingSettings();
      setRuntimeStatus(status);
      setRuntimeStatusError("");
      setEmbeddingBaseUrlInput("");
      setEmbeddingApiKeyInput("");
      setEmbeddingModelInput("");
      success(
        "Desktop embedding settings cleared",
        "Removed from this desktop's .env.local. Without a local embedding endpoint, memory retrieval falls back to the built-in deterministic-hash path.",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to clear desktop embedding settings.";
      showError("Desktop embedding clear failed", message);
    } finally {
      setIsUpdatingEmbeddings(false);
    }
  };

  const refreshData = async () => {
    setLoading(true);
    try {
      const [nextRegistry, nextRuntimeStatus] = await Promise.all([
        fetchExecutorRegistry(),
        fetchRuntimeStatus().catch((error) => {
          setRuntimeStatusError(
            error instanceof Error ? error.message : runtimeRefreshFailureMessage,
          );
          return null;
        }),
      ]);
      setRegistry(nextRegistry);
      setRuntimeStatus(nextRuntimeStatus);
      if (nextRuntimeStatus) {
        setRuntimeStatusError("");
      }
    } catch (error) {
      showError(
        "Operations unavailable",
        error instanceof Error
          ? error.message
          : "Unable to load desktop executor operations.",
      );
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspaceMappings = React.useCallback(
    async (executorId?: string | null) => {
      if (!executorId || !currentActorContext.userId) {
        setWorkspaceMappings([]);
        return;
      }

      setWorkspaceMappingsLoading(true);
      try {
        const nextMappings = await fetchDesktopWorkspaceMappings({
          executorId,
          userId: currentActorContext.userId,
          capabilityId: activeCapability.id,
        });
        setWorkspaceMappings(nextMappings);
      } catch (error) {
        showError(
          "Desktop workspaces unavailable",
          error instanceof Error
            ? error.message
            : "Unable to load desktop workspace mappings for this operator.",
        );
      } finally {
        setWorkspaceMappingsLoading(false);
      }
    },
    [activeCapability.id, currentActorContext.userId, showError],
  );

  useEffect(() => {
    void refreshData();
  }, [activeCapability.id]);

  // Load desktop preferences once on mount (desktop-only).
  useEffect(() => {
    fetchDesktopPreferences()
      .then(prefs => {
        if (!prefs) return;
        setDesktopPrefs(prefs);
        setPrefsDraft({
          workingDirectory: prefs.workingDirectory ?? "",
          copilotCliUrl: prefs.copilotCliUrl ?? "",
          allowHttpFallback: prefs.allowHttpFallback ?? false,
          embeddingBaseUrl: prefs.embeddingBaseUrl ?? "",
          embeddingModel: prefs.embeddingModel ?? "",
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadWorkspaceMappings(runtimeStatus?.executorId || null);
  }, [loadWorkspaceMappings, runtimeStatus?.executorId]);

  useEffect(() => {
    setEmbeddingBaseUrlInput(runtimeStatus?.embeddingEndpoint || "");
    setEmbeddingModelInput(runtimeStatus?.embeddingModel || "");
  }, [runtimeStatus?.embeddingEndpoint, runtimeStatus?.embeddingModel]);

  useEffect(() => {
    const nextDrafts = Object.fromEntries(
      workspaceMappingRows.map((row) => {
        const mapping =
          workspaceMappings.find((item) =>
            row.repositoryId
              ? item.repositoryId === row.repositoryId
              : !item.repositoryId,
          ) || null;
        const localRootPath =
          mapping?.localRootPath || row.suggestedLocalRoot || "";
        const workingDirectoryPath =
          mapping?.workingDirectoryPath ||
          mapping?.localRootPath ||
          row.suggestedWorkingDirectory ||
          localRootPath;

        return [
          row.key,
          {
            localRootPath,
            workingDirectoryPath,
          },
        ];
      }),
    ) as Record<
      string,
      { localRootPath: string; workingDirectoryPath: string }
    >;
    setWorkspaceMappingDrafts(nextDrafts);
  }, [workspaceMappingRows, workspaceMappings]);

  useEffect(() => {
    if (!activeCapability.id) return;

    const pollLock = async () => {
      try {
        const lock = await fetchWorkspaceWriteLock(activeCapability.id);
        setWriteLock(lock);
      } catch {
        // Ignore — lock panel shows last known state
      }
    };

    void pollLock();
    lockPollRef.current = setInterval(() => void pollLock(), 5_000);

    return () => {
      if (lockPollRef.current !== null) {
        clearInterval(lockPollRef.current);
        lockPollRef.current = null;
      }
    };
  }, [activeCapability.id]);

  const currentDesktopOwnsCapability =
    workspace.executionOwnership?.executorId &&
    runtimeStatus?.executorId &&
    workspace.executionOwnership.executorId === runtimeStatus.executorId;

  const handleClaimExecution = async (forceTakeover = false) => {
    setBusyAction(forceTakeover ? "takeover" : "claim");
    try {
      await claimCapabilityExecution({
        capabilityId: activeCapability.id,
        forceTakeover,
      });
      await Promise.all([
        refreshCapabilityBundle(activeCapability.id),
        refreshData(),
      ]);
      success(
        forceTakeover ? "Execution ownership transferred" : "Execution claimed",
        forceTakeover
          ? `${activeCapability.name} now routes through this desktop executor.`
          : `${activeCapability.name} is now claimed by this desktop executor.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to update execution ownership.";
      showError(forceTakeover ? "Takeover failed" : "Claim failed", message);
      if (/desktop workspace mapping/i.test(message)) {
        window.setTimeout(() => {
          document.getElementById("desktop-workspaces")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 0);
      }
    } finally {
      setBusyAction("");
    }
  };

  const handleReleaseExecution = async () => {
    setBusyAction("release");
    try {
      await releaseCapabilityExecution({ capabilityId: activeCapability.id });
      await Promise.all([
        refreshCapabilityBundle(activeCapability.id),
        refreshData(),
      ]);
      success(
        "Execution released",
        `${activeCapability.name} is now waiting for an eligible desktop executor.`,
      );
    } catch (error) {
      showError(
        "Release failed",
        error instanceof Error
          ? error.message
          : "Unable to release execution ownership.",
      );
    } finally {
      setBusyAction("");
    }
  };

  const handleSyncRepos = async (fetch = false) => {
    const executorId = runtimeStatus?.executorId;
    if (!executorId) return;
    setBusyAction(fetch ? "sync-repos-fetch" : "sync-repos");
    try {
      const report = await syncCapabilityRepositories({
        capabilityId: activeCapability.id,
        executorId,
        fetch,
      });
      const cloned = report.repos.filter(r => r.status === "cloned").length;
      const updated = report.repos.filter(r => r.status === "updated").length;
      const errors = report.repos.filter(r => r.status === "error");
      if (errors.length > 0) {
        showError(
          "Repo sync completed with errors",
          errors.map(r => `${r.repositoryLabel}: ${r.error}`).join("\n"),
        );
      } else {
        success(
          fetch
            ? "Repositories updated"
            : cloned > 0
              ? "Repositories cloned"
              : "Repositories up to date",
          cloned > 0
            ? `Cloned ${cloned} repo${cloned !== 1 ? "s" : ""} and queued AST index build.`
            : updated > 0
              ? `Fetched latest changes for ${updated} repo${updated !== 1 ? "s" : ""}.`
              : "All repositories already present.",
        );
      }
    } catch (error) {
      showError(
        "Repo sync failed",
        error instanceof Error ? error.message : "Unable to sync repositories.",
      );
    } finally {
      setBusyAction("");
    }
  };

  const handleSavePreferences = async () => {
    setPrefsBusy(true);
    try {
      const saved = await saveDesktopPreferences({
        workingDirectory: prefsDraft.workingDirectory.trim() || undefined,
        copilotCliUrl: prefsDraft.copilotCliUrl.trim() || undefined,
        allowHttpFallback: prefsDraft.allowHttpFallback,
        embeddingBaseUrl: prefsDraft.embeddingBaseUrl.trim() || undefined,
        embeddingModel: prefsDraft.embeddingModel.trim() || undefined,
      });
      setDesktopPrefs(saved);
      success(
        "Preferences saved",
        "Desktop settings are now stored in the database and will load automatically on next start.",
      );
    } catch (error) {
      showError(
        "Save failed",
        error instanceof Error ? error.message : "Unable to save desktop preferences.",
      );
    } finally {
      setPrefsBusy(false);
    }
  };

  const handleRemoveExecutor = async (executorId: string) => {
    setBusyAction(`remove-${executorId}`);
    try {
      await removeDesktopExecutor(executorId);
      await Promise.all([
        refreshCapabilityBundle(activeCapability.id),
        refreshData(),
      ]);
      success(
        "Executor removed",
        `${executorId} was removed from the registry.`,
      );
    } catch (error) {
      showError(
        "Remove failed",
        error instanceof Error
          ? error.message
          : "Unable to remove the desktop executor.",
      );
    } finally {
      setBusyAction("");
    }
  };

  const handleSaveWorkspaceMapping = async ({
    rowKey,
    repositoryId,
    label,
  }: {
    rowKey: string;
    repositoryId?: string;
    label?: string;
  }) => {
    if (!runtimeStatus?.executorId || !currentActorContext.userId) {
      showError(
        "Desktop executor required",
        "Connect this desktop executor and choose a current operator before saving local workspace mappings.",
      );
      return;
    }

    const draft = workspaceMappingDrafts[rowKey];
    if (!draft?.workingDirectoryPath.trim()) {
      showError(
        "Working directory required",
        "Enter the working directory path before saving this mapping.",
      );
      return;
    }

    const existing =
      workspaceMappings.find((item) =>
        repositoryId ? item.repositoryId === repositoryId : !item.repositoryId,
      ) || null;

    setWorkspaceMappingBusyKey(`save-${rowKey}`);
    try {
      if (existing) {
        await updateDesktopWorkspaceMapping(
          runtimeStatus.executorId,
          existing.id,
          {
            localRootPath: draft.localRootPath.trim() || undefined,
            workingDirectoryPath: draft.workingDirectoryPath.trim(),
          },
        );
      } else {
        await createDesktopWorkspaceMapping(runtimeStatus.executorId, {
          userId: currentActorContext.userId,
          capabilityId: activeCapability.id,
          repositoryId,
          localRootPath: draft.localRootPath.trim() || undefined,
          workingDirectoryPath: draft.workingDirectoryPath.trim(),
        });
      }
      await loadWorkspaceMappings(runtimeStatus.executorId);
      success(
        "Desktop workspace saved",
        repositoryId
          ? `Local mapping for ${label || rowKey} is now stored for ${currentActorContext.displayName} on this desktop.`
          : `Capability fallback mapping is now stored for ${currentActorContext.displayName} on this desktop.`,
      );
    } catch (error) {
      showError(
        "Save failed",
        error instanceof Error
          ? error.message
          : "Unable to save the desktop workspace mapping.",
      );
    } finally {
      setWorkspaceMappingBusyKey("");
    }
  };

  const handleDeleteWorkspaceMapping = async ({
    rowKey,
    repositoryId,
    label,
  }: {
    rowKey: string;
    repositoryId?: string;
    label?: string;
  }) => {
    if (!runtimeStatus?.executorId) {
      return;
    }

    const existing =
      workspaceMappings.find((item) =>
        repositoryId ? item.repositoryId === repositoryId : !item.repositoryId,
      ) || null;

    if (!existing) {
      const template =
        workspaceMappingRows.find((item) => item.key === rowKey) || null;
      setWorkspaceMappingDrafts((current) => ({
        ...current,
        [rowKey]: {
          localRootPath: template?.suggestedLocalRoot || "",
          workingDirectoryPath:
            template?.suggestedWorkingDirectory ||
            template?.suggestedLocalRoot ||
            "",
        },
      }));
      return;
    }

    setWorkspaceMappingBusyKey(`delete-${rowKey}`);
    try {
      await deleteDesktopWorkspaceMapping(
        runtimeStatus.executorId,
        existing.id,
      );
      await loadWorkspaceMappings(runtimeStatus.executorId);
      success(
        "Desktop workspace removed",
        `${label || rowKey} no longer has a stored local mapping for this operator on this desktop.`,
      );
    } catch (error) {
      showError(
        "Delete failed",
        error instanceof Error
          ? error.message
          : "Unable to remove the desktop workspace mapping.",
      );
    } finally {
      setWorkspaceMappingBusyKey("");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        context={activeCapability.id}
        title="Desktop Executor Operations"
        description="See who is online, which desktop owns execution, and which capabilities are waiting for reclaim."
        actions={
          <>
            <button
              type="button"
              onClick={() => void refreshData()}
              className="enterprise-button enterprise-button-secondary"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate("/work")}
              className="enterprise-button enterprise-button-primary"
            >
              <ArrowRight size={16} />
              Back to Work
            </button>
          </>
        }
      />

      <SectionCard
        title="System facts"
        description="Boring-startup diagnostics for the active DB, control plane, desktop executor, operator, and workspace source."
        icon={ShieldCheck}
        action={
          <StatusBadge tone={readinessTone(runtimeStatus?.readinessState)}>
            {runtimeStatus?.readinessState || "unknown"}
          </StatusBadge>
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          {systemFacts.map((fact) => (
            <div
              key={fact.label}
              className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4"
            >
              <p className="form-kicker">{fact.label}</p>
              <p className="mt-2 break-words text-sm font-bold text-on-surface">
                {fact.value}
              </p>
              {fact.helper ? (
                <p className="mt-2 break-words text-xs leading-relaxed text-secondary">
                  {fact.helper}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        {runtimeStatus?.checks?.length ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {runtimeStatus.checks.slice(0, 6).map((check) => (
              <div
                key={check.id}
                className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-on-surface">
                    {check.label}
                  </p>
                  <StatusBadge tone={readinessTone(check.status)}>
                    {check.status}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-secondary">
                  {check.message}
                </p>
                {check.remediation ? (
                  <p className="mt-1 text-xs leading-relaxed text-secondary">
                    Fix: {check.remediation}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </SectionCard>

      <DesktopRuntimeSettingsCard
        runtimeStatus={runtimeStatus}
        runtimeStatusError={runtimeStatusError}
        runtimeTokenInput={runtimeTokenInput}
        isUpdatingRuntime={isUpdatingRuntime}
        embeddingBaseUrlInput={embeddingBaseUrlInput}
        embeddingApiKeyInput={embeddingApiKeyInput}
        embeddingModelInput={embeddingModelInput}
        isUpdatingEmbeddings={isUpdatingEmbeddings}
        onRuntimeTokenInputChange={setRuntimeTokenInput}
        onSave={handleRuntimeOverrideSave}
        onClear={handleRuntimeOverrideClear}
        onRefresh={refreshRuntimeIdentity}
        onEmbeddingBaseUrlInputChange={setEmbeddingBaseUrlInput}
        onEmbeddingApiKeyInputChange={setEmbeddingApiKeyInput}
        onEmbeddingModelInputChange={setEmbeddingModelInput}
        onSaveEmbeddings={handleEmbeddingSettingsSave}
        onClearEmbeddings={handleEmbeddingSettingsClear}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <SectionCard
          title="Current capability execution"
          description="Manual capability-to-desktop routing is the v1 model. One capability has one active desktop owner at a time."
          icon={Bot}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">Execution owner</p>
              <p className="mt-2 text-lg font-bold text-on-surface">
                {workspace.executionOwnership?.actorDisplayName || "Unassigned"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                {workspace.executionQueueReason === "EXECUTOR_DISCONNECTED"
                  ? "The previous desktop disconnected. Queued runs are waiting for reclaim."
                  : workspace.executionQueueReason === "EXECUTOR_RELEASED"
                    ? "Execution was released intentionally. Runs remain queued until another desktop claims the capability."
                    : "Desktop execution ownership controls who can actually run runtime-backed workflow execution."}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">This desktop</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={heartbeatTone(runtimeStatus?.executorHeartbeatStatus)}
                >
                  {runtimeStatus?.executorHeartbeatStatus || "OFFLINE"}
                </StatusBadge>
                {runtimeStatus?.runtimeOwner ? (
                  <StatusBadge tone="neutral">
                    {runtimeStatus.runtimeOwner}
                  </StatusBadge>
                ) : null}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-secondary">
                {runtimeStatus?.executorId
                  ? `${runtimeStatus.executorId} • last heartbeat ${formatTimestamp(runtimeStatus.executorHeartbeatAt)}`
                  : "Open the desktop runtime and sign in as a workspace operator to register an executor."}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {!currentDesktopOwnsCapability ? (
              <button
                type="button"
                onClick={() =>
                  void handleClaimExecution(
                    Boolean(
                      workspace.executionOwnership &&
                      workspace.executionOwnership.executorId !==
                        runtimeStatus?.executorId,
                    ),
                  )
                }
                disabled={
                  !canClaimExecution ||
                  !runtimeStatus?.executorId ||
                  busyAction.length > 0
                }
                className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === "claim" || busyAction === "takeover" ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Laptop2 size={16} />
                )}
                {workspace.executionOwnership &&
                workspace.executionOwnership.executorId !==
                  runtimeStatus?.executorId
                  ? "Take over current capability"
                  : "Claim current capability"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleReleaseExecution()}
                  disabled={!canClaimExecution || busyAction.length > 0}
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === "release" ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <Unplug size={16} />
                  )}
                  Release current capability
                </button>
                <button
                  type="button"
                  onClick={() => void handleSyncRepos(false)}
                  disabled={busyAction.length > 0}
                  title="Clone any missing repositories and rebuild the local AST index"
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === "sync-repos" ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <GitBranch size={16} />
                  )}
                  Sync repos
                </button>
                <button
                  type="button"
                  onClick={() => void handleSyncRepos(true)}
                  disabled={busyAction.length > 0}
                  title="Fetch the latest remote changes and rebuild the local AST index"
                  className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyAction === "sync-repos-fetch" ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Pull latest
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                document.getElementById("desktop-workspaces")?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
              className="enterprise-button enterprise-button-secondary"
            >
              <Laptop2 size={16} />
              Desktop Workspaces
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title="Executor fleet"
          description="Heartbeat freshness, owned capabilities, and run assignment pressure across all registered desktop executors."
          icon={Activity}
          action={
            registry ? (
              <StatusBadge tone="info">
                {registry.activeCount} active · {registry.staleCount} stale
              </StatusBadge>
            ) : undefined
          }
        >
          {loading ? (
            <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-8 text-sm text-secondary">
              Loading executor registry.
            </div>
          ) : !registry || registry.entries.length === 0 ? (
            <EmptyState
              title="No desktop executors yet"
              description="Once the Electron runtime connects and signs in, the executor registry will appear here."
              icon={Laptop2}
              className="min-h-[16rem]"
            />
          ) : (
            <div className="space-y-4">
              {registry.entries.map((entry) => (
                <div
                  key={entry.registration.id}
                  className="rounded-3xl border border-outline-variant/40 bg-white px-5 py-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-on-surface">
                          {entry.registration.actorDisplayName}
                        </p>
                        <StatusBadge
                          tone={heartbeatTone(
                            entry.registration.heartbeatStatus,
                          )}
                        >
                          {entry.registration.heartbeatStatus}
                        </StatusBadge>
                        {entry.registration.id === runtimeStatus?.executorId ? (
                          <StatusBadge tone="brand">This desktop</StatusBadge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-secondary">
                        {entry.registration.id} • heartbeat{" "}
                        {formatTimestamp(entry.registration.heartbeatAt)}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-secondary">
                        {(entry.registration.runtimeSummary?.provider ||
                          "Desktop runtime") +
                          (entry.registration.runtimeSummary?.defaultModel
                            ? ` · ${entry.registration.runtimeSummary.defaultModel}`
                            : "")}
                      </p>
                    </div>

                    {entry.registration.heartbeatStatus !== "FRESH" &&
                    canManageWorkspace ? (
                      <button
                        type="button"
                        onClick={() =>
                          void handleRemoveExecutor(entry.registration.id)
                        }
                        disabled={
                          busyAction === `remove-${entry.registration.id}`
                        }
                        className="enterprise-button enterprise-button-secondary border-red-200 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busyAction === `remove-${entry.registration.id}` ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                        Remove stale executor
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-surface-container-low px-4 py-3">
                      <p className="form-kicker">Capabilities owned</p>
                      <p className="mt-2 text-lg font-bold text-on-surface">
                        {entry.ownedCapabilities.length}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-surface-container-low px-4 py-3">
                      <p className="form-kicker">Assigned runs</p>
                      <p className="mt-2 text-lg font-bold text-on-surface">
                        {entry.runAssignmentCount}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-surface-container-low px-4 py-3">
                      <p className="form-kicker">Validated roots</p>
                      <p className="mt-2 text-lg font-bold text-on-surface">
                        {Object.values(
                          entry.registration.approvedWorkspaceRoots,
                        ).reduce((total, roots) => total + roots.length, 0)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {entry.ownedCapabilities.length === 0 ? (
                      <p className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm text-secondary">
                        This executor is online but does not currently own any
                        capabilities.
                      </p>
                    ) : (
                      entry.ownedCapabilities.map((capability) => (
                        <div
                          key={`${entry.registration.id}-${capability.capabilityId}`}
                          className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-on-surface">
                                {capability.capabilityName}
                              </p>
                              <p className="mt-1 text-xs text-secondary">
                                {capability.capabilityId}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <StatusBadge tone="neutral">
                                {capability.activeRunCount} active
                              </StatusBadge>
                              <StatusBadge tone="neutral">
                                {capability.queuedRunCount} queued
                              </StatusBadge>
                            </div>
                          </div>
                          <p className="mt-3 text-xs leading-relaxed text-secondary">
                            Validated roots:{" "}
                            {capability.approvedWorkspaceRoots.length > 0
                              ? capability.approvedWorkspaceRoots.join(" • ")
                              : "No validated local roots are published for this capability."}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Desktop workspaces"
        description="Stored for this operator on this desktop only. Repository rows win over the capability fallback."
        icon={Laptop2}
      >
        <div id="desktop-workspaces" className="space-y-4 scroll-mt-28">
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4 text-sm text-secondary">
            <p className="font-semibold text-on-surface">
              Desktop-local storage
            </p>
            <p className="mt-2 leading-relaxed">
              These paths are saved for{" "}
              <span className="font-semibold text-on-surface">
                {currentActorContext.displayName}
              </span>{" "}
              on{" "}
              <span className="font-semibold text-on-surface">
                {runtimeStatus?.executorId || "this desktop"}
              </span>{" "}
              only.
            </p>
            <p className="mt-2 leading-relaxed">
              Capability metadata local root hints remain visible only as
              migration suggestions.
            </p>
          </div>

          {!currentActorContext.userId ? (
            <EmptyState
              title="Choose a current operator"
              description="Desktop workspace mappings are saved per operator, so pick a current operator before configuring a working directory for this desktop."
              icon={Laptop2}
              className="min-h-[14rem]"
            />
          ) : !runtimeStatus?.executorId ? (
            <EmptyState
              title="Desktop executor not connected"
              description="Open the Electron runtime on this machine first. Once the executor connects, you can save a working directory mapping here. The local root is optional and will be derived when possible."
              icon={Laptop2}
              className="min-h-[14rem]"
            />
          ) : workspaceMappingsLoading ? (
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-8 text-sm text-secondary">
              Loading desktop workspace mappings.
            </div>
          ) : (
            <div className="space-y-4">
              {workspaceMappingRows.map((row) => {
                const mapping =
                  workspaceMappings.find((item) =>
                    row.repositoryId
                      ? item.repositoryId === row.repositoryId
                      : !item.repositoryId,
                  ) || null;
                const draft = workspaceMappingDrafts[row.key] || {
                  localRootPath: "",
                  workingDirectoryPath: "",
                };
                const validationTone = mapping
                  ? mapping.validation.valid
                    ? "success"
                    : "warning"
                  : "neutral";

                return (
                  <div
                    key={row.key}
                    className="rounded-3xl border border-outline-variant/40 bg-white px-5 py-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-on-surface">
                            {row.label}
                          </p>
                          <StatusBadge tone={validationTone}>
                            {mapping
                              ? mapping.validation.valid
                                ? "Validated"
                                : "Needs attention"
                              : "Not saved"}
                          </StatusBadge>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-secondary">
                          {row.repositoryId
                            ? `Repository mapping for ${row.label}.`
                            : "Capability-level fallback used when no repository-specific mapping exists."}
                        </p>
                        {row.suggestedLocalRoot ? (
                          <p className="mt-1 text-xs leading-relaxed text-secondary">
                            Suggested from capability metadata:{" "}
                            {row.suggestedLocalRoot}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void handleSaveWorkspaceMapping({
                              rowKey: row.key,
                              repositoryId: row.repositoryId,
                              label: row.label,
                            })
                          }
                          disabled={workspaceMappingBusyKey.length > 0}
                          className="enterprise-button enterprise-button-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {workspaceMappingBusyKey === `save-${row.key}` ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : null}
                          Save mapping
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleDeleteWorkspaceMapping({
                              rowKey: row.key,
                              repositoryId: row.repositoryId,
                              label: row.label,
                            })
                          }
                          disabled={workspaceMappingBusyKey.length > 0}
                          className="enterprise-button enterprise-button-secondary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {workspaceMappingBusyKey === `delete-${row.key}` ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : null}
                          {mapping ? "Delete mapping" : "Reset draft"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="form-kicker">
                          Local root path (optional)
                        </span>
                        <input
                          value={draft.localRootPath}
                          onChange={(event) =>
                            setWorkspaceMappingDrafts((current) => ({
                              ...current,
                              [row.key]: {
                                ...current[row.key],
                                localRootPath: event.target.value,
                              },
                            }))
                          }
                          placeholder="/Users/you/projects"
                          className="field-input font-mono text-[0.8rem]"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="form-kicker">
                          Working directory path
                        </span>
                        <input
                          value={draft.workingDirectoryPath}
                          onChange={(event) =>
                            setWorkspaceMappingDrafts((current) => ({
                              ...current,
                              [row.key]: {
                                ...current[row.key],
                                workingDirectoryPath: event.target.value,
                              },
                            }))
                          }
                          placeholder={
                            draft.localRootPath || "/Users/you/projects/repo"
                          }
                          className="field-input font-mono text-[0.8rem]"
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {row.suggestedLocalRoot ? (
                        <button
                          type="button"
                          onClick={() =>
                            setWorkspaceMappingDrafts((current) => ({
                              ...current,
                              [row.key]: {
                                localRootPath: row.suggestedLocalRoot,
                                workingDirectoryPath:
                                  row.suggestedWorkingDirectory ||
                                  row.suggestedLocalRoot,
                              },
                            }))
                          }
                          className="enterprise-button enterprise-button-secondary"
                        >
                          Use suggested hint
                        </button>
                      ) : null}
                      {mapping ? (
                        <p className="text-xs leading-relaxed text-secondary">
                          {mapping.validation.message}
                        </p>
                      ) : (
                        <p className="text-xs leading-relaxed text-secondary">
                          Save this row to validate the desktop boundary. If the
                          working directory does not exist yet, SingularityNeo
                          will create it and clone the repository when work
                          starts.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Desktop Identity & Preferences ─────────────────────────────── */}
      <SectionCard
        title="Desktop identity & preferences"
        description="Non-secret settings stored in the database and loaded automatically on startup. Security tokens (GitHub token, embedding API key) are excluded — configure those in the Runtime settings card above."
        icon={MonitorCog}
        action={
          desktopPrefs?.id ? (
            <StatusBadge tone="info">{desktopPrefs.id}</StatusBadge>
          ) : runtimeStatus?.desktopId ? (
            <StatusBadge tone="neutral">{runtimeStatus.desktopId}</StatusBadge>
          ) : null
        }
      >
        {desktopPrefs?.hostname || runtimeStatus?.desktopHostname ? (
          <p className="mb-4 text-xs text-secondary">
            Machine:{" "}
            <span className="font-mono font-semibold">
              {desktopPrefs?.hostname || runtimeStatus?.desktopHostname}
            </span>
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="col-span-2 space-y-2">
            <span className="form-kicker">Working directory</span>
            <input
              value={prefsDraft.workingDirectory}
              onChange={e => setPrefsDraft(d => ({ ...d, workingDirectory: e.target.value }))}
              placeholder="/Users/you/projects"
              className="field-input font-mono text-[0.8rem]"
            />
            <p className="text-xs text-secondary">
              Replaces <code className="rounded bg-surface-container-low px-1">SINGULARITY_WORKING_DIRECTORY</code>.
              Stored in DB — no need to set it in .env.local.
            </p>
          </label>

          <label className="space-y-2">
            <span className="form-kicker">Copilot CLI URL</span>
            <input
              value={prefsDraft.copilotCliUrl}
              onChange={e => setPrefsDraft(d => ({ ...d, copilotCliUrl: e.target.value }))}
              placeholder="http://127.0.0.1:4321"
              className="field-input font-mono text-[0.8rem]"
            />
            <p className="text-xs text-secondary">
              Replaces <code className="rounded bg-surface-container-low px-1">COPILOT_CLI_URL</code>.
            </p>
          </label>

          <label className="space-y-2">
            <span className="form-kicker">Embedding base URL</span>
            <input
              value={prefsDraft.embeddingBaseUrl}
              onChange={e => setPrefsDraft(d => ({ ...d, embeddingBaseUrl: e.target.value }))}
              placeholder="http://127.0.0.1:11434/v1"
              className="field-input font-mono text-[0.8rem]"
            />
            <p className="text-xs text-secondary">
              Replaces <code className="rounded bg-surface-container-low px-1">LOCAL_OPENAI_BASE_URL</code>. API key stays in .env.local.
            </p>
          </label>

          <label className="space-y-2">
            <span className="form-kicker">Embedding model</span>
            <input
              value={prefsDraft.embeddingModel}
              onChange={e => setPrefsDraft(d => ({ ...d, embeddingModel: e.target.value }))}
              placeholder="nomic-embed-text"
              className="field-input"
            />
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefsDraft.allowHttpFallback}
              onChange={e => setPrefsDraft(d => ({ ...d, allowHttpFallback: e.target.checked }))}
              className="h-4 w-4 rounded border-outline-variant accent-primary"
            />
            <div>
              <p className="text-sm font-semibold text-on-surface">Allow HTTP fallback</p>
              <p className="text-xs text-secondary">
                Replaces <code className="rounded bg-surface-container-low px-1">ALLOW_GITHUB_MODELS_HTTP_FALLBACK</code>.
                Falls back to GitHub Models HTTP API when the CLI rejects a model.
              </p>
            </div>
          </label>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void handleSavePreferences()}
            disabled={prefsBusy}
            className="enterprise-button enterprise-button-brand-muted disabled:opacity-50"
          >
            {prefsBusy ? <LoaderCircle size={14} className="animate-spin" /> : null}
            Save to database
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="WRITE_CONTROL token"
        description="Only the agent holding this token may perform workspace write operations. The token is acquired atomically before each write tool call and released immediately after, preventing concurrent file edits between agents."
        icon={Lock}
        action={
          <StatusBadge tone={writeLock ? "warning" : "success"}>
            {writeLock ? "Locked" : "Free"}
          </StatusBadge>
        }
      >
        {writeLock ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">Held by agent</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {writeLock.agentId}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">Current step</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {writeLock.stepName || "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">Acquired at</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {formatTimestamp(writeLock.acquiredAt)}
              </p>
            </div>
            <div className="rounded-2xl border border-outline-variant/40 bg-white px-4 py-4">
              <p className="form-kicker">Expires at</p>
              <p className="mt-2 text-sm font-semibold text-on-surface">
                {formatTimestamp(writeLock.expiresAt)}
              </p>
              <p className="mt-1 text-xs text-secondary">5-minute safety TTL</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4">
            <LockOpen size={18} className="shrink-0 text-secondary" />
            <p className="text-sm text-secondary">
              No agent currently holds the write token. All write tools are
              available for dispatch.
            </p>
          </div>
        )}
        {writeLock && (
          <div className="mt-3">
            <a
              href={`/run-console?runId=${writeLock.runId}`}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <ExternalLink size={12} />
              View run in console
            </a>
          </div>
        )}
      </SectionCard>

      {!canClaimExecution ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Read-only operator</p>
              <p className="mt-1 leading-relaxed">
                This page is visible so you can understand executor health, but
                only operators and owners with{" "}
                <span className="font-mono">capability.execution.claim</span>{" "}
                can change execution ownership.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Operations;
