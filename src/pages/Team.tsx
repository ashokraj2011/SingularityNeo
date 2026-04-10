import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Crown,
  FileText,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { COPILOT_MODEL_OPTIONS, SKILL_LIBRARY } from '../constants';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { fetchRuntimeStatus, refreshAgentLearningProfile, type RuntimeStatus } from '../lib/api';
import { getAgentHealth, getLearningStatusLabel } from '../lib/capabilityExperience';
import { cn } from '../lib/utils';
import { readViewPreference, writeViewPreference } from '../lib/viewPreferences';
import { AgentLearningStatus, CapabilityAgent, Skill } from '../types';
import {
  DrawerShell,
  EmptyState,
  ModalShell,
  PageHeader,
  StatusBadge,
} from '../components/EnterpriseUI';

type AgentDetailTab = 'overview' | 'learning' | 'skills' | 'sessions' | 'usage';

const TEAM_DETAIL_TAB_KEY = 'singularity.team.detail-tab';
const getTeamSelectionKey = (capabilityId: string) =>
  `singularity.team.selected-agent.${capabilityId}`;

const splitLines = (value: string) =>
  value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);

const formatCurrency = (value: number) => `$${value.toFixed(4)}`;

const formatTimestamp = (value?: string) => {
  if (!value) {
    return 'Not yet';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getLearningTone = (status: AgentLearningStatus) => {
  switch (status) {
    case 'READY':
      return 'success' as const;
    case 'ERROR':
      return 'danger' as const;
    case 'STALE':
      return 'warning' as const;
    case 'LEARNING':
    case 'QUEUED':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
};

const getLearningSummaryText = (agent: CapabilityAgent) => {
  if (agent.learningProfile.summary?.trim()) {
    return agent.learningProfile.summary.trim();
  }

  if (agent.learningProfile.status === 'ERROR') {
    return (
      agent.learningProfile.lastError ||
      'Learning failed. Refresh the learning profile after validating the runtime model and Copilot configuration.'
    );
  }

  return 'This collaborator is preparing its capability context.';
};

const getAvailableSkills = (capabilitySkills: Skill[]) => {
  const uniqueSkills = new Map<string, Skill>();
  [...capabilitySkills, ...SKILL_LIBRARY].forEach(skill => {
    uniqueSkills.set(skill.id, skill);
  });
  return [...uniqueSkills.values()];
};

const defaultInspectorTab = (): AgentDetailTab => {
  return readViewPreference<AgentDetailTab>(TEAM_DETAIL_TAB_KEY, 'overview', {
    allowed: ['overview', 'learning', 'skills', 'sessions', 'usage'] as const,
  });
};

const createAgentForm = (skills: Skill[], defaultModel: string) => ({
  name: '',
  role: 'Capability Specialist',
  objective: '',
  systemPrompt: '',
  documentationSources: '',
  learningNotes: '',
  skillIds: skills.map(skill => skill.id),
  model: defaultModel,
  tokenLimit: '12000',
});

const agentToForm = (agent: CapabilityAgent) => ({
  name: agent.name,
  role: agent.role,
  objective: agent.objective,
  systemPrompt: agent.systemPrompt,
  documentationSources: agent.documentationSources.join('\n'),
  learningNotes: (agent.learningNotes || []).join('\n'),
  skillIds: agent.skillIds,
  model: agent.model,
  tokenLimit: agent.tokenLimit.toString(),
});

const normalizeFormSnapshot = (form: ReturnType<typeof createAgentForm>) =>
  JSON.stringify({
    name: form.name.trim(),
    role: form.role.trim(),
    objective: form.objective.trim(),
    systemPrompt: form.systemPrompt.trim(),
    documentationSources: splitLines(form.documentationSources),
    learningNotes: splitLines(form.learningNotes),
    skillIds: [...new Set(form.skillIds)].sort(),
    model: form.model.trim(),
    tokenLimit: Math.max(1000, Number.parseInt(form.tokenLimit, 10) || 12000),
  });

const createDefaultLearningProfile = () => ({
  status: 'QUEUED' as AgentLearningStatus,
  summary: '',
  highlights: [],
  contextBlock: '',
  sourceDocumentIds: [],
  sourceArtifactIds: [],
  sourceCount: 0,
});

const buildAgentPayload = (
  form: ReturnType<typeof createAgentForm>,
  capabilityName: string,
) => ({
  name: form.name.trim(),
  role: form.role.trim(),
  objective: form.objective.trim(),
  systemPrompt:
    form.systemPrompt.trim() ||
    `Operate only within ${capabilityName}. Use the capability metadata, documentation, skills, and team learning already attached to this capability.`,
  initializationStatus: 'READY' as const,
  documentationSources: splitLines(form.documentationSources),
  learningNotes: splitLines(form.learningNotes),
  skillIds: [...new Set(form.skillIds)],
  provider: 'GitHub Copilot SDK' as const,
  model: form.model,
  tokenLimit: Math.max(1000, Number.parseInt(form.tokenLimit, 10) || 12000),
});

const getComparableSelectedAgent = (
  agent: CapabilityAgent | null,
  fallbackSkills: Skill[],
  fallbackModel: string,
) =>
  normalizeFormSnapshot(
    agent ? agentToForm(agent) : createAgentForm(fallbackSkills, fallbackModel),
  );

export default function Team() {
  const navigate = useNavigate();
  const {
    activeCapability,
    bootStatus,
    mutationStatusByCapability,
    getCapabilityWorkspace,
    addCapabilityAgent,
    refreshCapabilityBundle,
    updateCapabilityAgent,
    setActiveChatAgent,
  } = useCapability();
  const { success, error: showError } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const availableSkills = useMemo(
    () => getAvailableSkills(activeCapability.skillLibrary),
    [activeCapability.skillLibrary],
  );
  const fallbackModelOptions = useMemo(
    () =>
      COPILOT_MODEL_OPTIONS.map(model => ({
        ...model,
        apiModelId: model.id,
      })),
    [],
  );
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeStatusError, setRuntimeStatusError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [detailTab, setDetailTab] = useState<AgentDetailTab>(defaultInspectorTab);
  const [detailForm, setDetailForm] = useState(() =>
    createAgentForm(availableSkills, fallbackModelOptions[0]?.apiModelId || 'gpt-4.1-mini'),
  );
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState(() =>
    createAgentForm(availableSkills, fallbackModelOptions[0]?.apiModelId || 'gpt-4.1-mini'),
  );
  const [refreshingAgentId, setRefreshingAgentId] = useState('');
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);

  const mutationState = mutationStatusByCapability[activeCapability.id];
  const ownerAgent = workspace.agents.find(agent => agent.isOwner) || workspace.agents[0] || null;
  const activeChatAgent =
    workspace.agents.find(agent => agent.id === workspace.activeChatAgentId) || ownerAgent;
  const availableModelOptions = runtimeStatus?.availableModels?.length
    ? runtimeStatus.availableModels
    : fallbackModelOptions;
  const runtimeDefaultModel =
    runtimeStatus?.defaultModel ||
    availableModelOptions[0]?.apiModelId ||
    availableModelOptions[0]?.id ||
    'gpt-4.1-mini';
  const selectedAgent =
    workspace.agents.find(agent => agent.id === selectedAgentId) || ownerAgent || null;

  const learningReadyCount = useMemo(
    () => workspace.agents.filter(agent => agent.learningProfile.status === 'READY').length,
    [workspace.agents],
  );
  const customAgentCount = useMemo(
    () => workspace.agents.filter(agent => !agent.isBuiltIn && !agent.isOwner).length,
    [workspace.agents],
  );
  const totalSessionCount = useMemo(
    () =>
      workspace.agents.reduce((count, agent) => count + agent.sessionSummaries.length, 0),
    [workspace.agents],
  );
  const hasPendingLearning = useMemo(
    () =>
      workspace.agents.some(agent =>
        ['QUEUED', 'LEARNING', 'STALE'].includes(agent.learningProfile.status),
      ),
    [workspace.agents],
  );

  const filteredRoster = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return workspace.agents.filter(agent => {
      if (agent.isOwner) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [agent.name, agent.role, agent.objective, agent.model]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [searchQuery, workspace.agents]);

  const detailFormIsDirty = useMemo(
    () =>
      normalizeFormSnapshot(detailForm) !==
      getComparableSelectedAgent(selectedAgent, availableSkills, runtimeDefaultModel),
    [availableSkills, detailForm, runtimeDefaultModel, selectedAgent],
  );

  const detailCanSave = Boolean(
    selectedAgent &&
      detailForm.name.trim() &&
      detailForm.role.trim() &&
      detailForm.objective.trim(),
  );

  const createCanSave = Boolean(
    createForm.name.trim() && createForm.role.trim() && createForm.objective.trim(),
  );

  const getModelOptionsForValue = (value: string) => {
    const isUnavailable = !availableModelOptions.some(
      model => model.id === value || model.apiModelId === value,
    );

    if (!isUnavailable || !value) {
      return availableModelOptions;
    }

    return [
      {
        id: value,
        apiModelId: value,
        label: `${value} (current)`,
        profile: 'Unavailable in current Copilot runtime',
      },
      ...availableModelOptions,
    ];
  };

  const detailModelOptions = getModelOptionsForValue(detailForm.model);
  const createModelOptions = getModelOptionsForValue(createForm.model);
  const detailModelUnavailable = !availableModelOptions.some(
    model => model.id === detailForm.model || model.apiModelId === detailForm.model,
  );
  const createModelUnavailable = !availableModelOptions.some(
    model => model.id === createForm.model || model.apiModelId === createForm.model,
  );

  useEffect(() => {
    let isMounted = true;

    fetchRuntimeStatus()
      .then(status => {
        if (!isMounted) {
          return;
        }

        setRuntimeStatus(status);
        setRuntimeStatusError('');
      })
      .catch(nextError => {
        if (!isMounted) {
          return;
        }

        setRuntimeStatusError(
          nextError instanceof Error
            ? nextError.message
            : 'Unable to load the live Copilot model catalog.',
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    void refreshCapabilityBundle(activeCapability.id);
  }, [activeCapability.id, refreshCapabilityBundle]);

  useEffect(() => {
    if (!hasPendingLearning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      void refreshCapabilityBundle(activeCapability.id);
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeCapability.id, hasPendingLearning, refreshCapabilityBundle]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const storedAgentId = readViewPreference(
      getTeamSelectionKey(activeCapability.id),
      '',
    );
    if (storedAgentId && workspace.agents.some(agent => agent.id === storedAgentId)) {
      setSelectedAgentId(storedAgentId);
      return;
    }

    setSelectedAgentId(ownerAgent?.id || workspace.agents[0]?.id || '');
  }, [activeCapability.id, ownerAgent?.id, workspace.agents]);

  useEffect(() => {
    if (!selectedAgent) {
      return;
    }

    setDetailForm(agentToForm(selectedAgent));
  }, [activeCapability.id, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    writeViewPreference(getTeamSelectionKey(activeCapability.id), selectedAgentId);
  }, [activeCapability.id, selectedAgentId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    writeViewPreference(TEAM_DETAIL_TAB_KEY, detailTab);
  }, [detailTab]);

  const selectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
  };

  const openCreateModal = () => {
    setCreateForm(createAgentForm(availableSkills, runtimeDefaultModel));
    setCreateModalOpen(true);
  };

  const openAgentInChat = async (agent: CapabilityAgent) => {
    try {
      await setActiveChatAgent(activeCapability.id, agent.id);
      navigate('/chat');
    } catch (error) {
      showError(
        'Chat hand-off failed',
        error instanceof Error ? error.message : 'Unable to switch the active chat agent.',
      );
    }
  };

  const handleRefreshLearning = async (agent: CapabilityAgent) => {
    if (!agent || refreshingAgentId === agent.id) {
      return;
    }

    setRefreshingAgentId(agent.id);
    try {
      await refreshAgentLearningProfile(activeCapability.id, agent.id);
      await refreshCapabilityBundle(activeCapability.id);
      success(
        'Learning refresh queued',
        `${agent.name} is refreshing its capability learning profile.`,
      );
    } catch (nextError) {
      showError(
        'Learning refresh failed',
        nextError instanceof Error
          ? nextError.message
          : 'Unable to refresh agent learning.',
      );
    } finally {
      setRefreshingAgentId('');
    }
  };

  const handleCreateAgent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!createCanSave || bootStatus !== 'ready' || isCreatingAgent) {
      return;
    }

    setIsCreatingAgent(true);
    const existingIds = new Set(workspace.agents.map(agent => agent.id));

    try {
      const payload = buildAgentPayload(createForm, activeCapability.name);
      const bundle = await addCapabilityAgent(activeCapability.id, {
        ...payload,
        inputArtifacts: ['Capability operating context'],
        outputArtifacts: ['Agent contribution'],
        usage: {
          requestCount: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        },
        previousOutputs: [],
        learningProfile: createDefaultLearningProfile(),
        sessionSummaries: [],
      });

      const createdAgent =
        bundle.workspace.agents.find(agent => !existingIds.has(agent.id)) ||
        bundle.workspace.agents[bundle.workspace.agents.length - 1];

      if (createdAgent) {
        setSelectedAgentId(createdAgent.id);
        setDetailTab('overview');
      }
      setCreateModalOpen(false);
      success(
        'Agent created',
        `${payload.name} is now part of ${activeCapability.name}. Learning queued.`,
      );
    } catch (error) {
      showError(
        'Agent creation failed',
        error instanceof Error ? error.message : 'Unable to save the agent right now.',
      );
    } finally {
      setIsCreatingAgent(false);
    }
  };

  const handleSaveSelectedAgent = async () => {
    if (!selectedAgent || !detailCanSave || bootStatus !== 'ready' || isSavingAgent) {
      return;
    }

    setIsSavingAgent(true);

    try {
      const payload = buildAgentPayload(detailForm, activeCapability.name);
      await updateCapabilityAgent(activeCapability.id, selectedAgent.id, payload);
      success(
        'Agent updated',
        `${payload.name} settings were saved and learning was re-queued.`,
      );
    } catch (error) {
      showError(
        'Agent update failed',
        error instanceof Error ? error.message : 'Unable to save the agent right now.',
      );
    } finally {
      setIsSavingAgent(false);
    }
  };

  const toggleSkill = (
    setter: React.Dispatch<React.SetStateAction<ReturnType<typeof createAgentForm>>>,
    skillId: string,
  ) => {
    setter(prev => ({
      ...prev,
      skillIds: prev.skillIds.includes(skillId)
        ? prev.skillIds.filter(id => id !== skillId)
        : [...prev.skillIds, skillId],
    }));
  };

  const renderRuntimeNotice = (isUnavailable: boolean) => (
    <div className="space-y-3 rounded-3xl border border-outline-variant/15 bg-surface-container-low p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={
            runtimeStatus?.configured &&
            runtimeStatus?.modelCatalogSource === 'runtime'
              ? 'success'
              : 'warning'
          }
        >
          {runtimeStatus?.configured && runtimeStatus?.modelCatalogSource === 'runtime'
            ? 'Live Copilot models'
            : 'Fallback model catalog'}
        </StatusBadge>
        {isUnavailable ? (
          <StatusBadge tone="warning">Selected model unavailable</StatusBadge>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed text-secondary">
        {runtimeStatus?.configured && runtimeStatus?.modelCatalogSource === 'runtime'
          ? `Using ${availableModelOptions.length} models reported by the backend runtime.`
          : 'The backend is currently serving the fallback model catalog, so validate the selected model in this environment before relying on it.'}
      </p>
      {runtimeStatusError ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>{runtimeStatusError}</p>
        </div>
      ) : null}
    </div>
  );

  const renderAgentRow = (agent: CapabilityAgent, options?: { pinned?: boolean }) => {
    const isSelected = selectedAgentId === agent.id;
    const isRefreshing = refreshingAgentId === agent.id;
    const attachedSkills = availableSkills.filter(skill => agent.skillIds.includes(skill.id));
    const agentHealth = getAgentHealth(agent);

    return (
      <div
        key={agent.id}
        className={cn(
          'workspace-list-row',
          isSelected && 'workspace-list-row-active',
          options?.pinned && 'border-primary/20 bg-primary/5',
        )}
      >
        <button
          type="button"
          onClick={() => selectAgent(agent.id)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <div
            className={cn(
              'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border',
              agent.isOwner
                ? 'border-primary/15 bg-white text-primary'
                : 'border-outline-variant/30 bg-surface-container-low text-primary',
            )}
          >
            {agent.isOwner ? <Crown size={18} /> : <Bot size={18} />}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-bold text-on-surface">{agent.name}</p>
              {agent.isOwner ? <StatusBadge tone="brand">Owner</StatusBadge> : null}
              {agent.isBuiltIn ? <StatusBadge tone="success">Built-in</StatusBadge> : null}
              <StatusBadge tone={getLearningTone(agent.learningProfile.status)}>
                {agentHealth.label}
              </StatusBadge>
            </div>
            <p className="truncate text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
              {agent.role}
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-secondary">
              <span>{agent.model}</span>
              <span>{agent.sessionSummaries.length} sessions</span>
              <span>{formatTimestamp(agent.learningProfile.refreshedAt)}</span>
            </div>
            <p className="line-clamp-2 text-sm leading-relaxed text-secondary">
              {agent.objective || agentHealth.description}
            </p>
            <div className="flex flex-wrap gap-2">
              {attachedSkills.slice(0, 3).map(skill => (
                <span
                  key={skill.id}
                  className="rounded-full bg-primary/5 px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-primary"
                >
                  {skill.name}
                </span>
              ))}
              {attachedSkills.length > 3 ? (
                <span className="rounded-full bg-surface-container-low px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-outline">
                  +{attachedSkills.length - 3}
                </span>
              ) : null}
            </div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-2 self-start">
          <button
            type="button"
            onClick={() => void handleRefreshLearning(agent)}
            disabled={isRefreshing}
            className="workspace-list-action"
            title={`Refresh learning for ${agent.name}`}
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => void openAgentInChat(agent)}
            className="workspace-list-action"
            title={`Use ${agent.name} in chat`}
          >
            <MessageSquare size={14} />
          </button>
          <ChevronRight
            size={16}
            className={cn(
              'text-outline transition-transform',
              isSelected && 'translate-x-0.5 text-primary',
            )}
          />
        </div>
      </div>
    );
  };

  const renderDetailTabContent = () => {
    if (!selectedAgent) {
      return (
        <EmptyState
          title="Select an agent"
          description="Choose a roster item to inspect its learning, runtime posture, and saved capability context."
          icon={Users}
          action={
            <button
              type="button"
              onClick={openCreateModal}
              className="enterprise-button enterprise-button-primary"
            >
              <Plus size={16} />
              Create agent
            </button>
          }
        />
      );
    }

    if (detailTab === 'overview') {
      return (
        <div className="space-y-5">
          {renderRuntimeNotice(detailModelUnavailable)}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="field-label">Agent name</span>
              <input
                value={detailForm.name}
                onChange={event =>
                  setDetailForm(prev => ({ ...prev, name: event.target.value }))
                }
                className="field-input"
              />
            </label>
            <label className="space-y-2">
              <span className="field-label">Role</span>
              <input
                value={detailForm.role}
                onChange={event =>
                  setDetailForm(prev => ({ ...prev, role: event.target.value }))
                }
                className="field-input"
              />
            </label>
            <label className="space-y-2">
              <span className="field-label">Copilot model</span>
              <select
                value={detailForm.model}
                onChange={event =>
                  setDetailForm(prev => ({ ...prev, model: event.target.value }))
                }
                className="field-select"
              >
                {detailModelOptions.map(model => (
                  <option key={model.apiModelId} value={model.apiModelId}>
                    {model.label} · {model.profile}
                  </option>
                ))}
              </select>
              <p className="field-help">
                This list comes from the backend runtime when available, so the agent only uses models exposed by the connected Copilot environment.
              </p>
            </label>
            <label className="space-y-2">
              <span className="field-label">Token limit</span>
              <input
                type="number"
                min={1000}
                step={500}
                value={detailForm.tokenLimit}
                onChange={event =>
                  setDetailForm(prev => ({ ...prev, tokenLimit: event.target.value }))
                }
                className="field-input"
              />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="field-label">Objective</span>
              <textarea
                value={detailForm.objective}
                onChange={event =>
                  setDetailForm(prev => ({ ...prev, objective: event.target.value }))
                }
                className="field-textarea"
              />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="field-label">System prompt</span>
              <textarea
                value={detailForm.systemPrompt}
                onChange={event =>
                  setDetailForm(prev => ({ ...prev, systemPrompt: event.target.value }))
                }
                className="field-textarea"
              />
            </label>
            <label className="space-y-2">
              <span className="field-label">Documentation sources</span>
              <textarea
                value={detailForm.documentationSources}
                onChange={event =>
                  setDetailForm(prev => ({
                    ...prev,
                    documentationSources: event.target.value,
                  }))
                }
                className="field-textarea"
              />
              <p className="field-help">One source per line or comma-separated.</p>
            </label>
            <label className="space-y-2">
              <span className="field-label">Learning scope</span>
              <textarea
                value={detailForm.learningNotes}
                onChange={event =>
                  setDetailForm(prev => ({ ...prev, learningNotes: event.target.value }))
                }
                className="field-textarea"
              />
              <p className="field-help">Priority topics the agent should keep learning from.</p>
            </label>
          </div>
        </div>
      );
    }

    if (detailTab === 'learning') {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              {
                label: 'Status',
                value: getLearningStatusLabel(selectedAgent.learningProfile.status),
              },
              { label: 'Sources', value: selectedAgent.learningProfile.sourceCount },
              { label: 'Highlights', value: selectedAgent.learningProfile.highlights.length },
              {
                label: 'Last refresh',
                value: formatTimestamp(selectedAgent.learningProfile.refreshedAt),
              },
            ].map(item => (
              <div key={item.label} className="workspace-meta-card">
                <p className="workspace-meta-label">{item.label}</p>
                <p className="workspace-meta-value">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="workspace-surface space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="workspace-section-title">Learning summary</p>
                <p className="workspace-section-copy">
                  Reusable capability-grounded context used when this agent opens or resumes Copilot sessions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRefreshLearning(selectedAgent)}
                disabled={refreshingAgentId === selectedAgent.id}
                className="enterprise-button enterprise-button-secondary"
              >
                <RefreshCw
                  size={16}
                  className={refreshingAgentId === selectedAgent.id ? 'animate-spin' : ''}
                />
                Refresh learning
              </button>
            </div>
            <p className="text-sm leading-7 text-secondary">
              {getLearningSummaryText(selectedAgent)}
            </p>
          </div>

          <div className="workspace-surface">
            <p className="workspace-section-title">Highlights</p>
            <div className="mt-3 space-y-2">
              {selectedAgent.learningProfile.highlights.length > 0 ? (
                selectedAgent.learningProfile.highlights.map(highlight => (
                  <div
                    key={highlight}
                    className="rounded-2xl border border-outline-variant/40 bg-surface-container-low px-4 py-3 text-sm text-secondary"
                  >
                    {highlight}
                  </div>
                ))
              ) : (
                <p className="text-sm text-secondary">
                  No learning highlights are available yet.
                </p>
              )}
            </div>
          </div>

          <div className="workspace-surface">
            <p className="workspace-section-title">Context block</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-secondary">
              {selectedAgent.learningProfile.contextBlock ||
                'The reusable Copilot context block will appear here after learning completes.'}
            </p>
          </div>

          {selectedAgent.learningProfile.lastError ? (
            <div className="workspace-inline-alert workspace-inline-alert-danger">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Latest learning error</p>
                <p className="mt-1">{selectedAgent.learningProfile.lastError}</p>
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    if (detailTab === 'skills') {
      return (
        <div className="space-y-4">
          <div className="workspace-surface">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="workspace-section-title">Attached skills</p>
                <p className="workspace-section-copy">
                  Skills stay capability-scoped and shape how this agent contributes to delivery.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setDetailForm(prev => ({
                      ...prev,
                      skillIds: availableSkills.map(skill => skill.id),
                    }))
                  }
                  className="enterprise-button enterprise-button-secondary"
                >
                  Attach all
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDetailForm(prev => ({
                      ...prev,
                      skillIds: [],
                    }))
                  }
                  className="enterprise-button enterprise-button-secondary"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {availableSkills.map(skill => {
              const selected = detailForm.skillIds.includes(skill.id);
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => toggleSkill(setDetailForm, skill.id)}
                  className={cn(
                    'rounded-3xl border p-4 text-left transition-all',
                    selected
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-outline-variant/40 bg-white hover:border-primary/20 hover:bg-surface-container-low',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{skill.name}</p>
                      <p className="mt-1 text-sm leading-relaxed text-secondary">
                        {skill.description}
                      </p>
                    </div>
                    {selected ? <CheckCircle2 size={16} className="text-primary" /> : null}
                  </div>
                  <p className="mt-3 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                    {skill.category}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (detailTab === 'sessions') {
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                label: 'Resumable scopes',
                value: selectedAgent.sessionSummaries.length,
              },
              {
                label: 'Total requests',
                value: selectedAgent.sessionSummaries.reduce(
                  (count, session) => count + session.requestCount,
                  0,
                ),
              },
              {
                label: 'Total tokens',
                value: selectedAgent.sessionSummaries.reduce(
                  (count, session) => count + session.totalTokens,
                  0,
                ),
              },
            ].map(item => (
              <div key={item.label} className="workspace-meta-card">
                <p className="workspace-meta-label">{item.label}</p>
                <p className="workspace-meta-value">{item.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {selectedAgent.sessionSummaries.length > 0 ? (
              selectedAgent.sessionSummaries.map(session => (
                <div key={`${session.scope}:${session.scopeId || 'general'}`} className="workspace-surface">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-on-surface">
                        {session.scope}
                        {session.scopeId ? ` · ${session.scopeId}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-secondary">
                        {session.model} · Last used {formatTimestamp(session.lastUsedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone="info">
                        {session.requestCount.toLocaleString()} requests
                      </StatusBadge>
                      <StatusBadge tone="neutral">
                        {session.totalTokens.toLocaleString()} tokens
                      </StatusBadge>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="No resumable sessions yet"
                description="This agent will show durable Copilot session scopes after it completes chat or workflow work."
                icon={MessageSquare}
              />
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Requests', value: selectedAgent.usage.requestCount.toLocaleString() },
            {
              label: 'Prompt tokens',
              value: selectedAgent.usage.promptTokens.toLocaleString(),
            },
            {
              label: 'Completion tokens',
              value: selectedAgent.usage.completionTokens.toLocaleString(),
            },
            {
              label: 'Estimated cost',
              value: formatCurrency(selectedAgent.usage.estimatedCostUsd),
            },
          ].map(item => (
            <div key={item.label} className="workspace-meta-card">
              <p className="workspace-meta-label">{item.label}</p>
              <p className="workspace-meta-value">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="workspace-surface">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            <div>
              <p className="workspace-section-title">Previous outputs</p>
              <p className="workspace-section-copy">
                Recent deliverables produced by this capability agent.
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {selectedAgent.previousOutputs.length > 0 ? (
              selectedAgent.previousOutputs.map(output => (
                <div
                  key={output.id}
                  className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{output.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-secondary">
                        {output.summary}
                      </p>
                    </div>
                    <StatusBadge tone="brand">{output.status}</StatusBadge>
                  </div>
                  <p className="mt-3 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                    {output.timestamp}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-secondary">
                No previous outputs have been recorded for this agent yet.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Capability Team"
        context={activeCapability.id}
        title={`${activeCapability.name} Agent Workspace`}
        description="Review the capability roster, inspect one agent at a time, and manage learning, skills, sessions, and runtime posture from a focused operator workspace."
        actions={
          <>
            <button
              type="button"
              onClick={() => navigate('/chat')}
              className="enterprise-button enterprise-button-secondary"
            >
              <MessageSquare size={16} />
              Open collaboration
            </button>
            <button
              type="button"
              onClick={() => navigate('/capabilities/metadata')}
              className="enterprise-button enterprise-button-primary"
            >
              <ArrowRight size={16} />
              Capability metadata
            </button>
          </>
        }
      />

      {bootStatus !== 'ready' ? (
        <div className="workspace-inline-alert workspace-inline-alert-warning">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Capability sync is not fully ready</p>
            <p className="mt-1">
              Team actions stay read-only until the capability bundle is synchronized with the backend.
            </p>
          </div>
        </div>
      ) : null}

      {mutationState?.status === 'error' && mutationState.error ? (
        <div className="workspace-inline-alert workspace-inline-alert-danger">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Recent capability update failed</p>
            <p className="mt-1">{mutationState.error}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <section className="space-y-4">
          <div className="workspace-command-strip">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/10 bg-primary/10 text-primary">
                <Users size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-on-surface">Agent roster</p>
                <p className="text-sm text-secondary">
                  {workspace.agents.length} agents · {learningReadyCount} ready ·{' '}
                  {totalSessionCount} stored sessions
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              disabled={bootStatus !== 'ready'}
              className="enterprise-button enterprise-button-primary"
            >
              <Plus size={16} />
              Create agent
            </button>
          </div>

          <div className="workspace-command-strip">
            <label className="relative block min-w-0 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline"
              />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search agents by name, role, objective, or model"
                className="enterprise-input pl-10"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="brand">{customAgentCount} custom</StatusBadge>
              <StatusBadge tone="neutral">{activeChatAgent?.name || 'No chat agent'} active</StatusBadge>
            </div>
          </div>

          <div className="workspace-surface space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="workspace-section-title">Capability owner</p>
                <p className="workspace-section-copy">
                  Pinned at the top, but managed with the same detail workspace as every other agent.
                </p>
              </div>
              <StatusBadge tone="brand">Pinned</StatusBadge>
            </div>
            {ownerAgent ? (
              renderAgentRow(ownerAgent, { pinned: true })
            ) : (
              <EmptyState
                title="No owner agent found"
                description="This capability needs an owning agent before the rest of the team can be managed."
                icon={Crown}
              />
            )}
          </div>

          <div className="workspace-surface space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="workspace-section-title">Team roster</p>
                <p className="workspace-section-copy">
                  Select an agent to inspect or edit it in the detail pane.
                </p>
              </div>
              <StatusBadge tone="info">{filteredRoster.length} visible</StatusBadge>
            </div>

            <div className="space-y-3">
              {filteredRoster.length > 0 ? (
                filteredRoster.map(agent => renderAgentRow(agent))
              ) : (
                <EmptyState
                  title="No agents match this search"
                  description="Try a different keyword or clear the filter to return to the full roster."
                  icon={Search}
                />
              )}
            </div>
          </div>
        </section>

        <DrawerShell className="flex min-h-[48rem] flex-col overflow-hidden p-0">
          {selectedAgent ? (
            <>
              <div className="border-b border-outline-variant/40 px-6 py-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="brand">{activeCapability.id}</StatusBadge>
                      {selectedAgent.isOwner ? <StatusBadge tone="brand">Owner</StatusBadge> : null}
                      {selectedAgent.isBuiltIn ? (
                        <StatusBadge tone="success">Built-in</StatusBadge>
                      ) : (
                        <StatusBadge tone="info">Custom</StatusBadge>
                      )}
                      <StatusBadge tone={getLearningTone(selectedAgent.learningProfile.status)}>
                        {getLearningStatusLabel(selectedAgent.learningProfile.status)}
                      </StatusBadge>
                      {detailFormIsDirty ? <StatusBadge tone="warning">Unsaved</StatusBadge> : null}
                    </div>
                    <h2 className="mt-3 text-2xl font-bold tracking-tight text-on-surface">
                      {selectedAgent.name}
                    </h2>
                    <p className="mt-1 text-sm text-secondary">{selectedAgent.role}</p>
                    <p className="mt-3 max-w-3xl text-sm leading-relaxed text-secondary">
                      {selectedAgent.objective}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void openAgentInChat(selectedAgent)}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      <MessageSquare size={16} />
                      Use in chat
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRefreshLearning(selectedAgent)}
                      disabled={refreshingAgentId === selectedAgent.id}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      <RefreshCw
                        size={16}
                        className={refreshingAgentId === selectedAgent.id ? 'animate-spin' : ''}
                      />
                      Refresh learning
                    </button>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {[
                    ['overview', 'Overview'],
                    ['learning', 'Learning'],
                    ['skills', 'Skills'],
                    ['sessions', 'Sessions'],
                    ['usage', 'Usage'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDetailTab(id as AgentDetailTab)}
                      className={cn(
                        'workspace-tab-button',
                        detailTab === id && 'workspace-tab-button-active',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="custom-scrollbar flex-1 overflow-y-auto px-6 py-5">
                {renderDetailTabContent()}
              </div>

              <div className="flex flex-col gap-3 border-t border-outline-variant/40 bg-surface-container-low/60 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-secondary">
                  {detailFormIsDirty
                    ? 'You have unsaved agent changes in this detail pane.'
                    : 'Agent details are in sync with the latest capability bundle.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => selectedAgent && setDetailForm(agentToForm(selectedAgent))}
                    disabled={!detailFormIsDirty}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Reset changes
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveSelectedAgent()}
                    disabled={!detailCanSave || !detailFormIsDirty || isSavingAgent || bootStatus !== 'ready'}
                    className="enterprise-button enterprise-button-primary"
                  >
                    {isSavingAgent ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    Save changes
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState
                title="No agent selected"
                description="Pick a roster row on the left to inspect its learning, skills, sessions, and runtime settings."
                icon={Bot}
                action={
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="enterprise-button enterprise-button-primary"
                  >
                    <Plus size={16} />
                    Create agent
                  </button>
                }
              />
            </div>
          )}
        </DrawerShell>
      </div>

      {createModalOpen ? (
        <div className="workspace-modal-backdrop">
          <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" />
          <ModalShell
            eyebrow="Create Agent"
            title={`Add an Agent to ${activeCapability.name}`}
            description="Create a new capability-scoped agent with its own runtime, learning scope, and attached skills."
            actions={
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="workspace-list-action"
              >
                <X size={16} />
              </button>
            }
            className="relative z-10 max-w-5xl"
          >
            <form onSubmit={handleCreateAgent} className="space-y-6 pt-6">
              {renderRuntimeNotice(createModelUnavailable)}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="field-label">Agent name</span>
                  <input
                    value={createForm.name}
                    onChange={event =>
                      setCreateForm(prev => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="Compliance Reviewer"
                    className="field-input"
                  />
                </label>
                <label className="space-y-2">
                  <span className="field-label">Role</span>
                  <input
                    value={createForm.role}
                    onChange={event =>
                      setCreateForm(prev => ({ ...prev, role: event.target.value }))
                    }
                    placeholder="Capability Specialist"
                    className="field-input"
                  />
                </label>
                <label className="space-y-2">
                  <span className="field-label">Copilot model</span>
                  <select
                    value={createForm.model}
                    onChange={event =>
                      setCreateForm(prev => ({ ...prev, model: event.target.value }))
                    }
                    className="field-select"
                  >
                    {createModelOptions.map(model => (
                      <option key={model.apiModelId} value={model.apiModelId}>
                        {model.label} · {model.profile}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="field-label">Token limit</span>
                  <input
                    type="number"
                    min={1000}
                    step={500}
                    value={createForm.tokenLimit}
                    onChange={event =>
                      setCreateForm(prev => ({ ...prev, tokenLimit: event.target.value }))
                    }
                    className="field-input"
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="field-label">Objective</span>
                  <textarea
                    value={createForm.objective}
                    onChange={event =>
                      setCreateForm(prev => ({ ...prev, objective: event.target.value }))
                    }
                    placeholder="Describe what this agent owns within the capability."
                    className="field-textarea"
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="field-label">System prompt</span>
                  <textarea
                    value={createForm.systemPrompt}
                    onChange={event =>
                      setCreateForm(prev => ({ ...prev, systemPrompt: event.target.value }))
                    }
                    placeholder="If left blank, the capability-aware default prompt will be used."
                    className="field-textarea"
                  />
                </label>
                <label className="space-y-2">
                  <span className="field-label">Documentation sources</span>
                  <textarea
                    value={createForm.documentationSources}
                    onChange={event =>
                      setCreateForm(prev => ({
                        ...prev,
                        documentationSources: event.target.value,
                      }))
                    }
                    placeholder={'Confluence capability page\nJira board\nArchitecture runbook'}
                    className="field-textarea"
                  />
                </label>
                <label className="space-y-2">
                  <span className="field-label">Learning scope</span>
                  <textarea
                    value={createForm.learningNotes}
                    onChange={event =>
                      setCreateForm(prev => ({ ...prev, learningNotes: event.target.value }))
                    }
                    placeholder={'Pricing policy changes\nAPI governance updates'}
                    className="field-textarea"
                  />
                </label>
              </div>

              <div className="space-y-4 rounded-3xl border border-outline-variant/20 bg-surface-container-low p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="workspace-section-title">Attached skills</p>
                    <p className="workspace-section-copy">
                      Skills stay capability-tagged and will be included in the agent’s learning context.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setCreateForm(prev => ({
                        ...prev,
                        skillIds: availableSkills.map(skill => skill.id),
                      }))
                    }
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Attach all
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {availableSkills.map(skill => {
                    const selected = createForm.skillIds.includes(skill.id);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => toggleSkill(setCreateForm, skill.id)}
                        className={cn(
                          'rounded-2xl border p-4 text-left transition-all',
                          selected
                            ? 'border-primary bg-white shadow-sm'
                            : 'border-outline-variant/30 bg-white/80 hover:bg-white',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-on-surface">{skill.name}</p>
                            <p className="mt-1 text-[0.6875rem] leading-relaxed text-secondary">
                              {skill.description}
                            </p>
                          </div>
                          {selected ? <CheckCircle2 size={16} className="text-primary" /> : null}
                        </div>
                        <p className="mt-3 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                          {skill.category}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-outline-variant/40 pt-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-secondary">
                  New agents are created inside {activeCapability.name}, queued for learning immediately, and stay capability-scoped.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateModalOpen(false)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!createCanSave || isCreatingAgent || bootStatus !== 'ready'}
                    className="enterprise-button enterprise-button-primary"
                  >
                    {isCreatingAgent ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                    Create agent
                  </button>
                </div>
              </div>
            </form>
          </ModalShell>
        </div>
      ) : null}
    </div>
  );
}
