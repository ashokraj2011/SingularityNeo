import React, { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { COPILOT_MODEL_OPTIONS, SKILL_LIBRARY } from '../constants';
import { useCapability } from '../context/CapabilityContext';
import {
  createCapabilityCodeBranch,
  fetchCapabilityCodeWorkspaces,
  type CodeWorkspaceStatus,
} from '../lib/api';
import { Skill } from '../types';

const formatCurrency = (value: number) => `$${value.toFixed(4)}`;

const buildDefaultBranchName = (capabilityId: string) =>
  `codex/${capabilityId.toLowerCase()}-workspace`;

const Studio = () => {
  const navigate = useNavigate();
  const { activeCapability, getCapabilityWorkspace } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const capabilitySkills = useMemo(() => {
    const uniqueSkills = new Map<string, Skill>();
    [...activeCapability.skillLibrary, ...SKILL_LIBRARY].forEach(skill => {
      uniqueSkills.set(skill.id, skill);
    });
    return [...uniqueSkills.values()];
  }, [activeCapability.skillLibrary]);
  const [codeWorkspaces, setCodeWorkspaces] = useState<CodeWorkspaceStatus[]>([]);
  const [isLoadingCodeWorkspaces, setIsLoadingCodeWorkspaces] = useState(false);
  const [codeWorkspaceError, setCodeWorkspaceError] = useState('');
  const [codeWorkspaceMessage, setCodeWorkspaceMessage] = useState('');
  const [branchDrafts, setBranchDrafts] = useState<Record<string, string>>({});
  const [activeBranchPath, setActiveBranchPath] = useState('');

  const loadCodeWorkspaces = async () => {
    if (activeCapability.localDirectories.length === 0) {
      setCodeWorkspaces([]);
      setCodeWorkspaceError('');
      return;
    }

    setIsLoadingCodeWorkspaces(true);
    setCodeWorkspaceError('');

    try {
      const result = await fetchCapabilityCodeWorkspaces(activeCapability.id);
      setCodeWorkspaces(result);
    } catch (error) {
      setCodeWorkspaceError(
        error instanceof Error
          ? error.message
          : 'Unable to inspect capability code workspaces.',
      );
    } finally {
      setIsLoadingCodeWorkspaces(false);
    }
  };

  useEffect(() => {
    void loadCodeWorkspaces();
  }, [activeCapability.id]);

  const setBranchDraft = (directoryPath: string, value: string) => {
    setBranchDrafts(prev => ({
      ...prev,
      [directoryPath]: value,
    }));
  };

  const handleCreateBranch = async (directoryPath: string) => {
    const branchName =
      branchDrafts[directoryPath]?.trim() ||
      buildDefaultBranchName(activeCapability.id);

    setActiveBranchPath(directoryPath);
    setCodeWorkspaceError('');
    setCodeWorkspaceMessage('');

    try {
      const result = await createCapabilityCodeBranch(activeCapability.id, {
        path: directoryPath,
        branchName,
      });

      setCodeWorkspaces(prev =>
        prev.map(workspaceStatus =>
          workspaceStatus.path === result.path ? result : workspaceStatus,
        ),
      );
      setBranchDraft(directoryPath, result.currentBranch || branchName);
      setCodeWorkspaceMessage(`Created branch ${branchName} for ${directoryPath}.`);
    } catch (error) {
      setCodeWorkspaceError(
        error instanceof Error
          ? error.message
          : 'Unable to create the Git branch for this workspace.',
      );
    } finally {
      setActiveBranchPath('');
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-primary/10 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-widest text-primary">
              Agent Studio
            </span>
            <span className="text-[0.625rem] font-bold uppercase tracking-widest text-slate-400">
              {activeCapability.id}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-on-surface">
            Capability Runtime, Skills, and Code Workspaces
          </h1>
          <p className="text-sm font-medium text-secondary">
            Review skills, model choices, token budgets, usage, and the local
            directories that this capability can use for branch-based code work.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={() => navigate('/skills')}
            className="inline-flex items-center gap-2 rounded-2xl border border-primary/10 bg-white px-5 py-3 text-sm font-bold text-primary shadow-sm transition-all hover:bg-primary/5"
          >
            <BookOpen size={18} />
            Open Skill Library
          </button>
          <button
            onClick={() => navigate('/team')}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
          >
            <Settings2 size={18} />
            Open Agent Manager
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-7">
          <section className="overflow-hidden rounded-3xl border border-outline-variant/15 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-outline-variant/10 bg-primary/5 p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary p-2 text-white">
                  <Sparkles size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-primary">
                    Capability Skill Library
                  </h3>
                  <p className="text-[0.625rem] font-bold uppercase tracking-widest text-slate-400">
                    Reusable agent skills currently visible in this capability
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase text-primary">
                {capabilitySkills.length} Skills
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
              {capabilitySkills.map(skill => (
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
                  <h4 className="mb-1 font-bold text-on-surface">{skill.name}</h4>
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
          </section>

          <section className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Cpu size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-primary">Copilot Model Pool</h3>
                <p className="text-[0.6875rem] text-secondary">
                  Available model choices for agents running on GitHub Copilot
                  API.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {COPILOT_MODEL_OPTIONS.map(model => (
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
          </section>

          <section className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary/10 p-2 text-primary">
                  <FolderCode size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-primary">Code Workspaces</h3>
                  <p className="text-[0.6875rem] text-secondary">
                    Capability-approved local directories for branch work and
                    code changes.
                  </p>
                </div>
              </div>
              <button
                onClick={() => void loadCodeWorkspaces()}
                className="inline-flex items-center gap-2 rounded-2xl border border-outline-variant/15 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-secondary transition-all hover:bg-surface-container-low"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>

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

            {activeCapability.localDirectories.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-outline-variant/20 bg-surface-container-low p-6 text-sm text-secondary">
                No local directories are configured for this capability yet.
                Add them in capability metadata to inspect repos and create
                branches from Studio.
                <button
                  onClick={() => navigate('/capabilities/metadata')}
                  className="mt-4 flex items-center gap-2 font-bold text-primary"
                >
                  Open capability metadata
                  <ArrowRight size={14} />
                </button>
              </div>
            ) : isLoadingCodeWorkspaces ? (
              <div className="flex items-center gap-3 rounded-3xl border border-outline-variant/15 bg-surface-container-low p-6 text-sm text-secondary">
                <LoaderCircle size={18} className="animate-spin text-primary" />
                Inspecting configured code workspaces...
              </div>
            ) : (
              <div className="space-y-4">
                {codeWorkspaces.map(workspaceStatus => (
                  <div
                    key={workspaceStatus.path}
                    className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-white px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                            {workspaceStatus.isGitRepository ? 'Git Repo' : 'Directory'}
                          </span>
                          {workspaceStatus.currentBranch && (
                            <span className="rounded-full bg-primary/10 px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                              {workspaceStatus.currentBranch}
                            </span>
                          )}
                        </div>
                        <p className="mt-3 break-all text-sm font-bold text-on-surface">
                          {workspaceStatus.path}
                        </p>
                        {workspaceStatus.lastCommit && (
                          <p className="mt-2 text-xs text-secondary">
                            Last commit: {workspaceStatus.lastCommit}
                          </p>
                        )}
                        {workspaceStatus.error && (
                          <p className="mt-2 text-xs font-medium text-red-600">
                            {workspaceStatus.error}
                          </p>
                        )}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[260px]">
                        <div className="rounded-2xl bg-white p-4">
                          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                            Pending Changes
                          </p>
                          <p className="mt-3 text-lg font-extrabold text-primary">
                            {workspaceStatus.pendingChanges}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-white p-4">
                          <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                            Directory Status
                          </p>
                          <p className="mt-3 text-sm font-bold text-on-surface">
                            {workspaceStatus.exists
                              ? workspaceStatus.isGitRepository
                                ? 'Ready'
                                : 'Not a repository'
                              : 'Missing'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 lg:flex-row">
                      <input
                        value={
                          branchDrafts[workspaceStatus.path] ||
                          buildDefaultBranchName(activeCapability.id)
                        }
                        onChange={event =>
                          setBranchDraft(workspaceStatus.path, event.target.value)
                        }
                        className="flex-1 rounded-2xl border border-outline-variant/15 bg-white px-4 py-3 text-sm font-medium outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                      />
                      <button
                        onClick={() => void handleCreateBranch(workspaceStatus.path)}
                        disabled={
                          !workspaceStatus.exists ||
                          !workspaceStatus.isGitRepository ||
                          activeBranchPath === workspaceStatus.path
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {activeBranchPath === workspaceStatus.path ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <GitBranch size={16} />
                        )}
                        Create Branch
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6 lg:col-span-5">
          <section className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <BarChart3 size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-primary">
                  Agent Runtime Stack
                </h3>
                <p className="text-[0.6875rem] text-secondary">
                  Usage, cost, and output visibility across the capability team.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {workspace.agents.map(agent => (
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
                      .filter(skill => agent.skillIds.includes(skill.id))
                      .slice(0, 4)
                      .map(skill => (
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
                    <span>{agent.usage.totalTokens.toLocaleString()} tokens used</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl bg-primary p-6 text-white shadow-xl shadow-primary/20">
            <div className="flex items-center gap-2">
              <BookOpen size={18} />
              <p className="text-sm font-bold">
                Capability-owned agent and code configuration
              </p>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-primary-fixed-dim">
              Capabilities now carry workflow scope, leadership contacts, Git
              repos, local directories, and agent runtime settings together, so
              the workspace can stay anchored to the same delivery context.
            </p>
            <button
              onClick={() => navigate('/team')}
              className="mt-5 flex w-full items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-left transition-all hover:bg-white/15"
            >
              <span className="text-sm font-bold">
                Open Team Agent Manager
              </span>
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Studio;
