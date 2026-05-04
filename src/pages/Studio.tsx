import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Cpu,
  FileCode,
  FolderCode,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { COPILOT_MODEL_OPTIONS, SKILL_LIBRARY } from "../constants";
import { useCapability } from "../context/CapabilityContext";
import {
  createCapabilityWorkItemSharedBranch,
  fetchRuntimeStatus,
  initializeCapabilityWorkItemExecutionContext,
} from "../lib/api";
import { Skill } from "../types";
import { PageHeader, SectionCard } from "../components/EnterpriseUI";

const formatCurrency = (value: number) => `$${value.toFixed(4)}`;

const Studio = () => {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace, refreshCapabilityBundle } =
    useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const capabilitySkills = useMemo(() => {
    const uniqueSkills = new Map<string, Skill>();
    [...activeCapability.skillLibrary, ...SKILL_LIBRARY].forEach((skill) => {
      uniqueSkills.set(skill.id, skill);
    });
    return [...uniqueSkills.values()];
  }, [activeCapability.skillLibrary]);
  const [codeWorkspaceError, setCodeWorkspaceError] = useState("");
  const [codeWorkspaceMessage, setCodeWorkspaceMessage] = useState("");
  const [activeWorkItemActionId, setActiveWorkItemActionId] = useState("");

  const workItemsWithExecutionContext = useMemo(
    () =>
      workspace.workItems.filter((workItem) =>
        Boolean(workItem.executionContext || workItem.status !== "COMPLETED"),
      ),
    [workspace.workItems],
  );

  useEffect(() => {
    setCodeWorkspaceError("");
    setCodeWorkspaceMessage("");
    setActiveWorkItemActionId("");
  }, [activeCapability.id]);

  const handleInitializeExecutionContext = async (workItemId: string) => {
    setActiveWorkItemActionId(`init-${workItemId}`);
    setCodeWorkspaceError("");
    setCodeWorkspaceMessage("");

    try {
      await initializeCapabilityWorkItemExecutionContext(
        activeCapability.id,
        workItemId,
      );
      await refreshCapabilityBundle(activeCapability.id);
      setCodeWorkspaceMessage(
        `Prepared shared execution context for ${workItemId}.`,
      );
    } catch (error) {
      setCodeWorkspaceError(
        error instanceof Error
          ? error.message
          : "Unable to initialize the shared work-item execution context.",
      );
    } finally {
      setActiveWorkItemActionId("");
    }
  };

  const handleCreateSharedBranch = async (workItemId: string) => {
    setActiveWorkItemActionId(`branch-${workItemId}`);
    setCodeWorkspaceError("");
    setCodeWorkspaceMessage("");

    try {
      const runtimeStatus = await fetchRuntimeStatus();
      if (!runtimeStatus.executorId) {
        throw new Error(
          "Connect this desktop executor and save a Desktop Workspaces mapping before creating a shared branch.",
        );
      }
      const result = await createCapabilityWorkItemSharedBranch(
        activeCapability.id,
        workItemId,
        {
          executorId: runtimeStatus.executorId,
        },
      );
      await refreshCapabilityBundle(activeCapability.id);
      setCodeWorkspaceMessage(
        `Shared branch ${
          result.context.branch?.sharedBranch || "created"
        } is ready for ${workItemId}.`,
      );
    } catch (error) {
      setCodeWorkspaceError(
        error instanceof Error
          ? error.message
          : "Unable to create the shared work-item branch.",
      );
    } finally {
      setActiveWorkItemActionId("");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent Studio"
        context={activeCapability.id}
        title="Capability Runtime, Skills & Code Workspaces"
        description="Review skills, model choices, token budgets, usage, and the local directories that this capability can use for branch-based code work."
        actions={
          <>
            <button
              onClick={() => navigate("/skills")}
              className="enterprise-button enterprise-button-secondary"
            >
              <BookOpen size={16} />
              Skill Library
            </button>
            <button
              onClick={() => navigate("/team")}
              className="enterprise-button bg-primary text-on-primary hover:bg-primary/90"
            >
              <Settings2 size={16} />
              Open Agents
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <SectionCard
            title="Capability Skill Library"
            description="Reusable agent skills currently visible in this capability."
            icon={Sparkles}
            action={
              <span className="text-xs font-bold text-primary">
                {capabilitySkills.length} Skills
              </span>
            }
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {capabilitySkills.map((skill) => (
                <div
                  key={skill.id}
                  className="group rounded-2xl border border-outline-variant/15 bg-surface-container-low p-5 transition-all hover:border-primary/30"
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="rounded-lg bg-white p-2 text-primary transition-all group-hover:bg-primary group-hover:text-white">
                      <FileCode size={18} />
                    </div>
                    <span className="text-[0.625rem] font-bold uppercase tracking-widest text-slate-400">
                      v{skill.version}
                    </span>
                  </div>
                  <h4 className="mb-1 font-bold text-on-surface">
                    {skill.name}
                  </h4>
                  <p className="mb-4 text-xs leading-relaxed text-secondary">
                    {skill.description}
                  </p>
                  <div className="flex items-center justify-between border-t border-outline-variant/10 pt-3">
                    <span className="text-[0.625rem] font-bold uppercase text-slate-400">
                      {skill.category}
                    </span>
                    <span className="text-[0.625rem] font-bold uppercase tracking-widest text-primary">
                      Capability Tagged
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Copilot Model Pool"
            description="Available model choices for agents running on GitHub Copilot API."
            icon={Cpu}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {COPILOT_MODEL_OPTIONS.map((model) => (
                <div
                  key={model.id}
                  className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-5"
                >
                  <p className="text-sm font-bold text-on-surface">
                    {model.label}
                  </p>
                  <p className="mt-1 text-sm text-secondary">{model.profile}</p>
                  <p className="mt-3 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                    {model.id}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Shared Work Item Branches"
            description="Work items own shared repo and branch context. Initialize the execution context here, then open Work to collaborate on the same branch."
            icon={FolderCode}
            action={
              <button
                onClick={() =>
                  void refreshCapabilityBundle(activeCapability.id)
                }
                className="enterprise-button enterprise-button-secondary"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            }
          >
            {codeWorkspaceError && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <p>{codeWorkspaceError}</p>
              </div>
            )}

            {codeWorkspaceMessage && (
              <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                {codeWorkspaceMessage}
              </div>
            )}

            {workItemsWithExecutionContext.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-outline-variant/20 bg-surface-container-low p-6 text-sm text-secondary">
                No work items are ready for shared branch work yet. Onboard a
                repository in capability metadata, then create a work item to
                generate a shared execution context.
                <button
                  onClick={() => navigate("/orchestrator")}
                  className="mt-4 flex items-center gap-2 font-bold text-primary"
                >
                  Open workbench
                  <ArrowRight size={14} />
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {workItemsWithExecutionContext.map((workItem) => {
                  const executionContext = workItem.executionContext;
                  const branch = executionContext?.branch;
                  const repository =
                    activeCapability.repositories?.find(
                      (item) =>
                        item.id ===
                        (executionContext?.primaryRepositoryId ||
                          branch?.repositoryId),
                    ) || null;
                  const hasSharedBranch = Boolean(branch);
                  const branchIsActive = branch?.status === "ACTIVE";
                  const busyInit =
                    activeWorkItemActionId === `init-${workItem.id}`;
                  const busyBranch =
                    activeWorkItemActionId === `branch-${workItem.id}`;

                  return (
                    <div
                      key={workItem.id}
                      className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-white px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                              {workItem.id}
                            </span>
                            {branch?.sharedBranch && (
                              <span className="rounded-full bg-primary/10 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                                {branch.sharedBranch}
                              </span>
                            )}
                          </div>
                          <p className="mt-3 text-sm font-bold text-on-surface">
                            {workItem.title}
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-secondary">
                            {repository
                              ? `${repository.label} • base ${branch?.baseBranch || repository.defaultBranch}`
                              : "No repository is attached yet. Initialize the execution context to bind the primary repo."}
                          </p>
                          {repository?.localRootHint && (
                            <p className="mt-2 break-all text-xs text-secondary">
                              Local root: {repository.localRootHint}
                            </p>
                          )}
                          {executionContext?.activeWriterUserId && (
                            <p className="mt-2 text-xs font-medium text-primary">
                              Active writer:{" "}
                              {executionContext.activeWriterUserId}
                            </p>
                          )}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[260px]">
                          <div className="rounded-2xl bg-white p-4">
                            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                              Phase
                            </p>
                            <p className="mt-3 text-lg font-extrabold text-primary">
                              {workItem.phase}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-white p-4">
                            <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                              Branch Status
                            </p>
                            <p className="mt-3 text-sm font-bold text-on-surface">
                              {branchIsActive
                                ? "Active"
                                : hasSharedBranch
                                  ? branch?.status || "Prepared"
                                  : "Not initialized"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-col gap-3 lg:flex-row">
                        <button
                          onClick={() =>
                            void handleInitializeExecutionContext(workItem.id)
                          }
                          disabled={busyInit}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-outline-variant/20 bg-white px-5 py-3 text-sm font-bold text-primary transition-all hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyInit ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <Settings2 size={16} />
                          )}
                          {hasSharedBranch
                            ? "Refresh context"
                            : "Initialize context"}
                        </button>
                        <button
                          onClick={() =>
                            void handleCreateSharedBranch(workItem.id)
                          }
                          disabled={busyBranch || !repository?.localRootHint}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyBranch ? (
                            <LoaderCircle size={16} className="animate-spin" />
                          ) : (
                            <GitBranch size={16} />
                          )}
                          {branchIsActive
                            ? "Re-open branch locally"
                            : "Create shared branch"}
                        </button>
                        <button
                          onClick={() =>
                            navigate(
                              `/orchestrator?selected=${encodeURIComponent(workItem.id)}`,
                            )
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-outline-variant/20 bg-white px-5 py-3 text-sm font-bold text-secondary transition-all hover:bg-surface-container-high"
                        >
                          <ArrowRight size={16} />
                          Open in Work
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6 lg:col-span-5">
          <SectionCard
            title="Agent Runtime Stack"
            description="Usage, cost, and output visibility across the capability team."
            icon={BarChart3}
          >
            <div className="space-y-4">
              {workspace.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-2xl border border-outline-variant/15 bg-surface-container-low p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-bold text-on-surface">
                        {agent.name}
                      </h4>
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        {agent.role}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                      {agent.model}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Token Limit
                      </p>
                      <p className="mt-3 text-lg font-extrabold text-primary">
                        {agent.tokenLimit.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Estimated Cost
                      </p>
                      <p className="mt-3 text-lg font-extrabold text-primary">
                        {formatCurrency(agent.usage.estimatedCostUsd)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {capabilitySkills
                      .filter((skill) => agent.skillIds.includes(skill.id))
                      .slice(0, 4)
                      .map((skill) => (
                        <span
                          key={skill.id}
                          className="rounded-full bg-primary/5 px-3 py-1.5 text-xs font-bold text-primary"
                        >
                          {skill.name}
                        </span>
                      ))}
                    {agent.skillIds.length === 0 && (
                      <span className="text-sm text-secondary">
                        No skills attached.
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                    <span>{agent.previousOutputs.length} previous outputs</span>
                    <span>
                      {agent.usage.totalTokens.toLocaleString()} tokens used
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Capability-owned configuration"
            description="Capabilities carry workflow scope, contacts, repos, local directories, and agent runtime settings together — the workspace stays anchored to the same delivery context."
            icon={BookOpen}
            tone="brand"
          >
            <div className="space-y-2">
              <button
                onClick={() => navigate("/team")}
                className="enterprise-button w-full justify-between bg-primary text-on-primary hover:bg-primary/90"
              >
                <span>Open Agents</span>
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() => navigate("/studio/designer-config")}
                className="enterprise-button enterprise-button-secondary w-full justify-between"
              >
                <span>Designer Settings</span>
                <Settings2 size={16} />
              </button>
              <button
                onClick={() => navigate("/studio/step-templates")}
                className="enterprise-button enterprise-button-secondary w-full justify-between"
              >
                <span>Step Templates</span>
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() => navigate("/studio/business-workflows")}
                className="enterprise-button enterprise-button-secondary w-full justify-between"
              >
                <span>Business Workflows</span>
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() => navigate("/studio/business-workflows/inbox")}
                className="enterprise-button enterprise-button-secondary w-full justify-between"
              >
                <span>Business Workflow Inbox</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
};

export default Studio;
