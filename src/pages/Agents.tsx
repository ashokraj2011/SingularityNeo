import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Crown,
  Edit3,
  FileText,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AgentKnowledgeLensPanel from '../components/AgentKnowledgeLensPanel';
import CapabilityBriefingPanel from '../components/CapabilityBriefingPanel';
import { COPILOT_MODEL_OPTIONS, SKILL_LIBRARY, getStandardAgentContract } from '../constants';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { fetchRuntimeStatus, refreshAgentLearningProfile, type RuntimeStatus } from '../lib/api';
import { buildAgentKnowledgeLens } from '../lib/agentKnowledge';
import {
  getLegacyArtifactListsFromContract,
  normalizeAgentOperatingContract,
  normalizeAgentRoleStarterKey,
  normalizeSkill,
} from '../lib/agentRuntime';
import { getAgentHealth } from '../lib/capabilityExperience';
import { formatEnumLabel } from '../lib/enterprise';
import { WORKSPACE_AGENT_TEMPLATES } from '../lib/workspaceFoundations';
import { cn } from '../lib/utils';
import { readViewPreference, writeViewPreference } from '../lib/viewPreferences';
import {
  AgentArtifactExpectation,
  AgentLearningStatus,
  AgentRoleStarterKey,
  CapabilityAgent,
  ProviderKey,
  RuntimeProviderStatus,
  Skill,
  ToolAdapterId,
} from '../types';
import {
  DrawerShell,
  EmptyState,
  ModalShell,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from '../components/EnterpriseUI';
import { AdvancedDisclosure } from '../components/WorkspaceUI';

type AgentDetailTab = 'overview' | 'learning' | 'skills' | 'tools' | 'sessions' | 'usage';

const AGENTS_DETAIL_TAB_KEY = 'singularity.team.detail-tab';
const getAgentSelectionKey = (capabilityId: string) =>
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

const formatToolLabel = (toolId: string) => formatEnumLabel(toolId);

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
    uniqueSkills.set(skill.id, normalizeSkill(skill));
  });
  return [...uniqueSkills.values()];
};

const defaultInspectorTab = (): AgentDetailTab => {
  return readViewPreference<AgentDetailTab>(AGENTS_DETAIL_TAB_KEY, 'overview', {
    allowed: ['overview', 'learning', 'skills', 'tools', 'sessions', 'usage'] as const,
  });
};

type AgentFormState = {
  name: string;
  roleStarterKey: AgentRoleStarterKey;
  role: string;
  objective: string;
  systemPrompt: string;
  documentationSources: string;
  learningNotes: string;
  contractDescription: string;
  primaryResponsibilities: string;
  workingApproach: string;
  preferredOutputs: string;
  guardrails: string;
  conflictResolution: string;
  definitionOfDone: string;
  suggestedInputArtifacts: string;
  expectedOutputArtifacts: string;
  skillIds: string[];
  preferredToolIds: ToolAdapterId[];
  providerKey: ProviderKey;
  model: string;
  tokenLimit: string;
};

const RUNTIME_PROVIDER_FALLBACKS: Array<{ key: ProviderKey; label: string }> = [
  { key: 'github-copilot', label: 'GitHub Copilot SDK' },
  { key: 'local-openai', label: 'Local OpenAI-Compatible (Ollama / OpenAI-compatible)' },
  { key: 'claude-code-cli', label: 'Claude Code CLI' },
  { key: 'codex-cli', label: 'Codex CLI' },
  { key: 'aider-cli', label: 'Aider CLI' },
];

const normalizeAgentProviderKey = (value?: string | null): ProviderKey => {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    normalized === 'local-openai' ||
    normalized.includes('local openai') ||
    normalized.includes('openai-compatible') ||
    normalized.includes('ollama')
  ) {
    return 'local-openai';
  }
  if (normalized === 'claude-code-cli' || normalized === 'claude' || normalized.includes('claude code')) {
    return 'claude-code-cli';
  }
  if (normalized === 'codex-cli' || normalized === 'codex' || normalized.includes('codex cli')) {
    return 'codex-cli';
  }
  if (normalized === 'aider-cli' || normalized === 'aider' || normalized.includes('aider cli')) {
    return 'aider-cli';
  }
  return 'github-copilot';
};

const getRuntimeProviderLabel = (providerKey: ProviderKey, providers: RuntimeProviderStatus[] = []) =>
  providers.find(provider => provider.key === providerKey)?.label ||
  RUNTIME_PROVIDER_FALLBACKS.find(provider => provider.key === providerKey)?.label ||
  'GitHub Copilot SDK';

const CUSTOM_AGENT_DEFAULT_STARTER: AgentRoleStarterKey = 'SOFTWARE-DEVELOPER';

const getRoleStarterTemplate = (roleStarterKey: AgentRoleStarterKey) =>
  WORKSPACE_AGENT_TEMPLATES.find(template => template.roleStarterKey === roleStarterKey);

const resolveStarterText = (value: string, capabilityName: string) =>
  value.replace(/\{capabilityName\}/g, capabilityName);

const formatArtifactExpectations = (expectations: AgentArtifactExpectation[] = []) =>
  expectations.map(expectation => expectation.artifactName).join('\n');

const parseArtifactExpectations = (
  value: string,
  direction: AgentArtifactExpectation['direction'],
  requiredByDefault: boolean,
): AgentArtifactExpectation[] =>
  value
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
    .map(artifactName => ({
      artifactName,
      direction,
      requiredByDefault,
    }));

const createAgentForm = (
  capabilityName: string,
  availableSkills: Skill[],
  defaultModel: string,
  defaultProviderKey: ProviderKey = 'github-copilot',
  roleStarterKey: AgentRoleStarterKey = CUSTOM_AGENT_DEFAULT_STARTER,
): AgentFormState => {
  const template = getRoleStarterTemplate(roleStarterKey);
  const contract = normalizeAgentOperatingContract(
    template?.contract || getStandardAgentContract(roleStarterKey),
  );
  const availableSkillIds = new Set(availableSkills.map(skill => skill.id));
  const defaultSkillIds = (template?.defaultSkillIds || []).filter(skillId =>
    availableSkillIds.has(skillId),
  );

  return {
    name: '',
    roleStarterKey,
    role: template?.role || 'Capability Specialist',
    objective: template ? resolveStarterText(template.objective, capabilityName) : '',
    systemPrompt: template ? resolveStarterText(template.systemPrompt, capabilityName) : '',
    documentationSources: '',
    learningNotes: '',
    contractDescription: contract.description,
    primaryResponsibilities: contract.primaryResponsibilities.join('\n'),
    workingApproach: contract.workingApproach.join('\n'),
    preferredOutputs: contract.preferredOutputs.join('\n'),
    guardrails: contract.guardrails.join('\n'),
    conflictResolution: contract.conflictResolution.join('\n'),
    definitionOfDone: contract.definitionOfDone,
    suggestedInputArtifacts: formatArtifactExpectations(contract.suggestedInputArtifacts),
    expectedOutputArtifacts: formatArtifactExpectations(contract.expectedOutputArtifacts),
    skillIds: defaultSkillIds,
    preferredToolIds: template?.preferredToolIds || [],
    providerKey: defaultProviderKey,
    model: defaultModel,
    tokenLimit: '12000',
  };
};

const agentToForm = (agent: CapabilityAgent): AgentFormState => {
  const contract = normalizeAgentOperatingContract(agent.contract, {
    description: agent.objective || agent.role,
    suggestedInputArtifacts: agent.inputArtifacts,
    expectedOutputArtifacts: agent.outputArtifacts,
  });

  return {
    name: agent.name,
    roleStarterKey:
      normalizeAgentRoleStarterKey(agent.roleStarterKey) ||
      normalizeAgentRoleStarterKey(agent.isOwner ? 'OWNER' : agent.standardTemplateKey) ||
      CUSTOM_AGENT_DEFAULT_STARTER,
    role: agent.role,
    objective: agent.objective,
    systemPrompt: agent.systemPrompt,
    documentationSources: agent.documentationSources.join('\n'),
    learningNotes: (agent.learningNotes || []).join('\n'),
    contractDescription: contract.description,
    primaryResponsibilities: contract.primaryResponsibilities.join('\n'),
    workingApproach: contract.workingApproach.join('\n'),
    preferredOutputs: contract.preferredOutputs.join('\n'),
    guardrails: contract.guardrails.join('\n'),
    conflictResolution: contract.conflictResolution.join('\n'),
    definitionOfDone: contract.definitionOfDone,
    suggestedInputArtifacts: formatArtifactExpectations(contract.suggestedInputArtifacts),
    expectedOutputArtifacts: formatArtifactExpectations(contract.expectedOutputArtifacts),
    skillIds: agent.skillIds,
    preferredToolIds: agent.preferredToolIds || [],
    providerKey: normalizeAgentProviderKey(agent.providerKey || agent.provider),
    model: agent.model,
    tokenLimit: agent.tokenLimit.toString(),
  };
};

const buildAgentContractFromForm = (form: AgentFormState) =>
  normalizeAgentOperatingContract(
    {
      description: form.contractDescription,
      primaryResponsibilities: splitLines(form.primaryResponsibilities),
      workingApproach: splitLines(form.workingApproach),
      preferredOutputs: splitLines(form.preferredOutputs),
      guardrails: splitLines(form.guardrails),
      conflictResolution: splitLines(form.conflictResolution),
      definitionOfDone: form.definitionOfDone,
      suggestedInputArtifacts: parseArtifactExpectations(
        form.suggestedInputArtifacts,
        'INPUT',
        false,
      ),
      expectedOutputArtifacts: parseArtifactExpectations(
        form.expectedOutputArtifacts,
        'OUTPUT',
        true,
      ),
    },
    {
      description: form.objective || form.role,
    },
  );

const applyRoleStarterToForm = (
  form: AgentFormState,
  capabilityName: string,
  availableSkills: Skill[],
  roleStarterKey: AgentRoleStarterKey,
): AgentFormState => {
  const template = getRoleStarterTemplate(roleStarterKey);
  const starterForm = createAgentForm(
    capabilityName,
    availableSkills,
    form.model,
    form.providerKey,
    roleStarterKey,
  );

  return {
    ...form,
    roleStarterKey,
    role: template?.role || starterForm.role,
    objective: template ? resolveStarterText(template.objective, capabilityName) : form.objective,
    systemPrompt: template
      ? resolveStarterText(template.systemPrompt, capabilityName)
      : form.systemPrompt,
    contractDescription: starterForm.contractDescription,
    primaryResponsibilities: starterForm.primaryResponsibilities,
    workingApproach: starterForm.workingApproach,
    preferredOutputs: starterForm.preferredOutputs,
    guardrails: starterForm.guardrails,
    conflictResolution: starterForm.conflictResolution,
    definitionOfDone: starterForm.definitionOfDone,
    suggestedInputArtifacts: starterForm.suggestedInputArtifacts,
    expectedOutputArtifacts: starterForm.expectedOutputArtifacts,
    skillIds: starterForm.skillIds,
    preferredToolIds: starterForm.preferredToolIds,
  };
};

const normalizeFormSnapshot = (form: AgentFormState) =>
  JSON.stringify({
    name: form.name.trim(),
    roleStarterKey: form.roleStarterKey,
    role: form.role.trim(),
    objective: form.objective.trim(),
    systemPrompt: form.systemPrompt.trim(),
    documentationSources: splitLines(form.documentationSources),
    learningNotes: splitLines(form.learningNotes),
    contractDescription: form.contractDescription.trim(),
    primaryResponsibilities: splitLines(form.primaryResponsibilities),
    workingApproach: splitLines(form.workingApproach),
    preferredOutputs: splitLines(form.preferredOutputs),
    guardrails: splitLines(form.guardrails),
    conflictResolution: splitLines(form.conflictResolution),
    definitionOfDone: form.definitionOfDone.trim(),
    suggestedInputArtifacts: parseArtifactExpectations(
      form.suggestedInputArtifacts,
      'INPUT',
      false,
    ),
    expectedOutputArtifacts: parseArtifactExpectations(
      form.expectedOutputArtifacts,
      'OUTPUT',
      true,
    ),
    skillIds: [...new Set(form.skillIds)].sort(),
    preferredToolIds: [...new Set(form.preferredToolIds)].sort(),
    providerKey: form.providerKey,
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
  form: AgentFormState,
  capabilityName: string,
) => {
  const contract = buildAgentContractFromForm(form);
  const legacyArtifacts = getLegacyArtifactListsFromContract(contract);

  return {
    name: form.name.trim(),
    roleStarterKey: form.roleStarterKey,
    role: form.role.trim(),
    objective: form.objective.trim(),
    systemPrompt:
      form.systemPrompt.trim() ||
      `Operate only within ${capabilityName}. Use the capability metadata, documentation, skills, and team learning already attached to this capability.`,
    initializationStatus: 'READY' as const,
    documentationSources: splitLines(form.documentationSources),
    learningNotes: splitLines(form.learningNotes),
    contract,
    inputArtifacts: legacyArtifacts.inputArtifacts,
    outputArtifacts: legacyArtifacts.outputArtifacts,
    skillIds: [...new Set(form.skillIds)],
    preferredToolIds: [...new Set(form.preferredToolIds)],
    provider: getRuntimeProviderLabel(form.providerKey),
    providerKey: form.providerKey,
    model: form.model,
    tokenLimit: Math.max(1000, Number.parseInt(form.tokenLimit, 10) || 12000),
  };
};

const getComparableSelectedAgent = (
  agent: CapabilityAgent | null,
  capabilityName: string,
  fallbackSkills: Skill[],
  fallbackModel: string,
  fallbackProviderKey: ProviderKey,
) =>
  normalizeFormSnapshot(
    agent
      ? agentToForm(agent)
      : createAgentForm(capabilityName, fallbackSkills, fallbackModel, fallbackProviderKey),
  );

export default function Agents() {
  const navigate = useNavigate();
  const {
    activeCapability,
    bootStatus,
    mutationStatusByCapability,
    getCapabilityWorkspace,
    addCapabilityAgent,
    refreshCapabilityBundle,
    updateCapabilityAgent,
    updateCapabilityAgentModels,
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
    createAgentForm(
      activeCapability.name,
      availableSkills,
      fallbackModelOptions[0]?.apiModelId || 'gpt-4.1-mini',
      'github-copilot',
    ),
  );
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [bulkModelModalOpen, setBulkModelModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState(() =>
    createAgentForm(
      activeCapability.name,
      availableSkills,
      fallbackModelOptions[0]?.apiModelId || 'gpt-4.1-mini',
      'github-copilot',
    ),
  );
  const [bulkModelValue, setBulkModelValue] = useState<string>(
    fallbackModelOptions[0]?.apiModelId || 'gpt-4.1-mini',
  );
  const [createAdvancedOpen, setCreateAdvancedOpen] = useState(false);
  const [isEditingSelectedAgent, setIsEditingSelectedAgent] = useState(false);
  const [refreshingAgentId, setRefreshingAgentId] = useState('');
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [isApplyingBulkModel, setIsApplyingBulkModel] = useState(false);

  const mutationState = mutationStatusByCapability[activeCapability.id];
  const ownerAgent = workspace.agents.find(agent => agent.isOwner) || workspace.agents[0] || null;
  const activeChatAgent =
    workspace.agents.find(agent => agent.id === workspace.primaryCopilotAgentId) ||
    workspace.agents.find(agent => agent.id === workspace.activeChatAgentId) ||
    ownerAgent;
  const availableModelOptions = runtimeStatus?.availableModels?.length
    ? runtimeStatus.availableModels
    : fallbackModelOptions;
  const runtimeDefaultModel =
    runtimeStatus?.defaultModel ||
    availableModelOptions[0]?.apiModelId ||
    availableModelOptions[0]?.id ||
    'gpt-4.1-mini';
  const runtimeDefaultProviderKey = runtimeStatus?.providerKey || 'github-copilot';
  const runtimeProviderOptions = runtimeStatus?.availableProviders?.length
    ? runtimeStatus.availableProviders.map(provider => ({
        key: provider.key,
        label: provider.label,
      }))
    : RUNTIME_PROVIDER_FALLBACKS;
  const selectedAgent =
    workspace.agents.find(agent => agent.id === selectedAgentId) || ownerAgent || null;
  const selectedAgentKnowledgeLens = useMemo(
    () =>
      selectedAgent
        ? buildAgentKnowledgeLens({
            capability: activeCapability,
            workspace,
            agent: selectedAgent,
          })
        : null,
    [activeCapability, selectedAgent, workspace],
  );

  const learningReadyCount = useMemo(
    () => workspace.agents.filter(agent => agent.learningProfile.status === 'READY').length,
    [workspace.agents],
  );
  const customAgentCount = useMemo(
    () => workspace.agents.filter(agent => !agent.isBuiltIn && !agent.isOwner).length,
    [workspace.agents],
  );
  const needsAttentionCount = useMemo(
    () =>
      workspace.agents.filter(agent =>
        ['ERROR', 'STALE'].includes(agent.learningProfile.status),
      ).length,
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
      getComparableSelectedAgent(
        selectedAgent,
        activeCapability.name,
        availableSkills,
        runtimeDefaultModel,
        runtimeDefaultProviderKey,
      ),
    [
      activeCapability.name,
      availableSkills,
      detailForm,
      runtimeDefaultModel,
      runtimeDefaultProviderKey,
      selectedAgent,
    ],
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

  const getProviderModelOptions = (providerKey: ProviderKey) => {
    const providerModels = runtimeStatus?.availableProviders?.find(
      provider => provider.key === providerKey,
    )?.availableModels;
    return providerModels && providerModels.length > 0 ? providerModels : availableModelOptions;
  };

  const getPreferredModelForProvider = (providerKey: ProviderKey) => {
    const providerOptions = getProviderModelOptions(providerKey);
    return (
      providerOptions[0]?.apiModelId ||
      providerOptions[0]?.id ||
      runtimeDefaultModel
    );
  };

  const getModelOptionsForValue = (providerKey: ProviderKey, value: string) => {
    const providerOptions = getProviderModelOptions(providerKey);
    const isUnavailable = !providerOptions.some(
      model => model.id === value || model.apiModelId === value,
    );

    if (!isUnavailable || !value) {
      return providerOptions;
    }

    return [
      {
        id: value,
        apiModelId: value,
        label: `${value} (current)`,
        profile: 'Unavailable in current runtime provider',
      },
      ...providerOptions,
    ];
  };

  const detailModelOptions = getModelOptionsForValue(detailForm.providerKey, detailForm.model);
  const createModelOptions = getModelOptionsForValue(createForm.providerKey, createForm.model);
  const detailModelUnavailable = !getProviderModelOptions(detailForm.providerKey).some(
    model => model.id === detailForm.model || model.apiModelId === detailForm.model,
  );
  const createModelUnavailable = !getProviderModelOptions(createForm.providerKey).some(
    model => model.id === createForm.model || model.apiModelId === createForm.model,
  );
  const bulkModelOptions = getModelOptionsForValue(runtimeDefaultProviderKey, bulkModelValue);
  const bulkModelUnavailable = !availableModelOptions.some(
    model => model.id === bulkModelValue || model.apiModelId === bulkModelValue,
  );
  const bulkModelChangeCount = useMemo(
    () => workspace.agents.filter(agent => agent.model !== bulkModelValue).length,
    [bulkModelValue, workspace.agents],
  );
  const preferredBulkModel = useMemo(() => {
    const modelCounts = new Map<string, number>();
    for (const agent of workspace.agents) {
      modelCounts.set(agent.model, (modelCounts.get(agent.model) || 0) + 1);
    }

    const [topModel] =
      [...modelCounts.entries()].sort((left, right) => right[1] - left[1])[0] || [];
    return topModel || runtimeDefaultModel;
  }, [runtimeDefaultModel, workspace.agents]);

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
            : 'Unable to load the live runtime model catalog.',
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
      getAgentSelectionKey(activeCapability.id),
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

    writeViewPreference(getAgentSelectionKey(activeCapability.id), selectedAgentId);
  }, [activeCapability.id, selectedAgentId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    writeViewPreference(AGENTS_DETAIL_TAB_KEY, detailTab);
  }, [detailTab]);

  const selectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    setIsEditingSelectedAgent(false);
  };

  const openCreateModal = () => {
    setCreateForm(
      createAgentForm(
        activeCapability.name,
        availableSkills,
        getPreferredModelForProvider(runtimeDefaultProviderKey),
        runtimeDefaultProviderKey,
      ),
    );
    setCreateAdvancedOpen(false);
    setCreateModalOpen(true);
  };

  const openBulkModelModal = () => {
    setBulkModelValue(preferredBulkModel);
    setBulkModelModalOpen(true);
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

  const handleApplyBulkModel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (bootStatus !== 'ready' || isApplyingBulkModel || !bulkModelValue.trim()) {
      return;
    }

    setIsApplyingBulkModel(true);

    try {
      await updateCapabilityAgentModels(activeCapability.id, bulkModelValue.trim());
      setBulkModelModalOpen(false);
      success(
        'All collaborator models updated',
        bulkModelChangeCount > 0
          ? `${bulkModelChangeCount} agent${bulkModelChangeCount === 1 ? '' : 's'} now use ${bulkModelValue}. Resumable sessions were cleared so new chats reopen on the new model.`
          : `All collaborators in ${activeCapability.name} were already on ${bulkModelValue}.`,
      );
    } catch (error) {
      showError(
        'Bulk model update failed',
        error instanceof Error
          ? error.message
          : 'Unable to change the agent models right now.',
      );
    } finally {
      setIsApplyingBulkModel(false);
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
      setIsEditingSelectedAgent(false);
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
    setter: React.Dispatch<React.SetStateAction<AgentFormState>>,
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
            ? 'Live runtime models'
            : 'Fallback model catalog'}
        </StatusBadge>
        {isUnavailable ? (
          <StatusBadge tone="warning">Selected model unavailable</StatusBadge>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed text-secondary">
        {runtimeStatus?.configured && runtimeStatus?.modelCatalogSource === 'runtime'
          ? `Using ${availableModelOptions.length} models reported by the backend runtime.`
          : 'The backend is currently serving the fallback model catalog, so validate the selected runtime model in this environment before relying on it.'}
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
    const agentHealth = getAgentHealth(agent);

    return (
      <div
        key={agent.id}
        className={cn(
          'team-collaborator-row',
          isSelected && 'team-collaborator-row-active',
          options?.pinned && 'team-collaborator-row-pinned',
        )}
      >
        <button
          type="button"
          onClick={() => selectAgent(agent.id)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border',
              agent.isOwner
                ? 'border-primary/15 bg-primary/10 text-primary'
                : 'border-outline-variant/30 bg-surface-container-low text-primary',
            )}
          >
            {agent.isOwner ? <Crown size={18} /> : <Bot size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="truncate text-sm font-bold text-on-surface">{agent.name}</p>
              {agent.isOwner ? <StatusBadge tone="brand">Owner</StatusBadge> : null}
              <StatusBadge tone={getLearningTone(agent.learningProfile.status)}>
                {agentHealth.label}
              </StatusBadge>
            </div>
            <p className="truncate text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
              {agent.role}
            </p>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-secondary">
              <span>{agent.isBuiltIn ? 'Shared standard' : 'Capability custom'}</span>
              <span>{agent.sessionSummaries.length} sessions</span>
              <span>Learned {formatTimestamp(agent.learningProfile.refreshedAt)}</span>
            </div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-2">
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
              description="Choose a roster item to inspect readiness, purpose, skills, and collaboration context."
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
      if (!isEditingSelectedAgent) {
        const agentHealth = getAgentHealth(selectedAgent);
        const selectedContract = normalizeAgentOperatingContract(selectedAgent.contract, {
          description: selectedAgent.objective || selectedAgent.role,
          suggestedInputArtifacts: selectedAgent.inputArtifacts,
          expectedOutputArtifacts: selectedAgent.outputArtifacts,
        });
        const attachedSkills = availableSkills.filter(skill =>
          selectedAgent.skillIds.includes(skill.id),
        );
        const preferredTools = selectedAgent.preferredToolIds || [];
        const recentSessions = selectedAgent.sessionSummaries.slice(0, 3);

        return (
          <div className="space-y-5">
            <CapabilityBriefingPanel
              briefing={workspace.briefing}
              compact
              title="Capability brain"
            />

            <section className="team-profile-hero">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="form-kicker">Purpose</p>
                  <p className="mt-2 text-base leading-7 text-on-surface">
                    {selectedAgent.objective ||
                      'This collaborator has not been given a clear purpose yet.'}
                  </p>
                </div>
                <StatusBadge tone={agentHealth.tone}>{agentHealth.label}</StatusBadge>
              </div>
              <p className="mt-4 text-sm leading-7 text-secondary">
                {agentHealth.description}
              </p>
            </section>

            <div className="grid gap-3 md:grid-cols-4">
              {[
                { label: 'Role', value: selectedAgent.role },
                {
                  label: 'Last learned',
                  value: formatTimestamp(selectedAgent.learningProfile.refreshedAt),
                },
                {
                  label: 'Sources',
                  value: selectedAgent.learningProfile.sourceCount || 0,
                },
                { label: 'Sessions', value: selectedAgent.sessionSummaries.length },
              ].map(item => (
                <div key={item.label} className="team-mini-metric">
                  <p className="workspace-meta-label">{item.label}</p>
                  <p className="workspace-meta-value">{item.value}</p>
                </div>
              ))}
            </div>

            <AdvancedDisclosure
              title="Technical details"
              description="Model, provider, token cap, and usage stay available for technical operators."
              storageKey="singularity.team.technical.open"
              badge={<StatusBadge tone="neutral">Advanced</StatusBadge>}
            >
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  {
                    label: 'Provider',
                    value: getRuntimeProviderLabel(
                      normalizeAgentProviderKey(
                        selectedAgent.providerKey || selectedAgent.provider,
                      ),
                      runtimeStatus?.availableProviders,
                    ),
                  },
                  { label: 'Model', value: selectedAgent.model },
                  {
                    label: 'Token cap',
                    value: selectedAgent.tokenLimit.toLocaleString(),
                  },
                  {
                    label: 'Usage',
                    value: `${selectedAgent.usage.totalTokens.toLocaleString()} tokens`,
                  },
                ].map(item => (
                  <div key={item.label} className="workspace-meta-card">
                    <p className="workspace-meta-label">{item.label}</p>
                    <p className="workspace-meta-value">{item.value}</p>
                  </div>
                ))}
              </div>
            </AdvancedDisclosure>

            <section className="workspace-surface space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="workspace-section-title">Operating profile</p>
                  <p className="workspace-section-copy">
                    What this specialist is allowed to do, what context it carries, and how we judge a good result.
                  </p>
                </div>
                <StatusBadge
                  tone={selectedAgent.userVisibility === 'PRIMARY_COPILOT' ? 'brand' : 'neutral'}
                >
                  {selectedAgent.userVisibility === 'PRIMARY_COPILOT'
                    ? 'Primary capability copilot'
                    : 'Specialist collaborator'}
                </StatusBadge>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4">
                  <p className="workspace-meta-label">Tool policy</p>
                  <p className="mt-2 text-sm leading-7 text-secondary">
                    {selectedAgent.rolePolicy?.summary ||
                      'Operate only through the tools and workflow boundaries attached to this collaborator.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(selectedAgent.rolePolicy?.allowedToolIds || selectedAgent.preferredToolIds || []).length >
                    0 ? (
                      (selectedAgent.rolePolicy?.allowedToolIds ||
                        selectedAgent.preferredToolIds ||
                        []
                      ).map(toolId => (
                        <StatusBadge key={toolId} tone="info">
                          {formatToolLabel(toolId)}
                        </StatusBadge>
                      ))
                    ) : (
                      <span className="text-sm text-secondary">
                        No preferred tool policy is attached yet.
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4">
                  <p className="workspace-meta-label">Memory scope</p>
                  <p className="mt-2 text-sm leading-7 text-secondary">
                    {selectedAgent.memoryScope?.summary ||
                      'Uses capability context, current work state, and recent artifacts.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(selectedAgent.memoryScope?.scopeLabels || []).length > 0 ? (
                      (selectedAgent.memoryScope?.scopeLabels || []).map(label => (
                        <StatusBadge key={label} tone="neutral">
                          {label}
                        </StatusBadge>
                      ))
                    ) : (
                      <span className="text-sm text-secondary">
                        Memory scope has not been described yet.
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4">
                  <p className="workspace-meta-label">
                    {selectedAgent.qualityBar?.label || 'Quality bar'}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-secondary">
                    {selectedAgent.qualityBar?.summary ||
                      'Outputs should be useful, bounded, and evidence-aware.'}
                  </p>
                  <div className="mt-3 space-y-2">
                    {(selectedAgent.qualityBar?.checklist || []).length > 0 ? (
                      (selectedAgent.qualityBar?.checklist || []).map(item => (
                        <div
                          key={item}
                          className="rounded-2xl border border-outline-variant/30 bg-white px-3 py-2 text-sm text-secondary"
                        >
                          {item}
                        </div>
                      ))
                    ) : (
                      <span className="text-sm text-secondary">
                        No explicit quality checklist is attached yet.
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4">
                  <p className="workspace-meta-label">
                    {selectedAgent.evalProfile?.label || 'Eval profile'}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-secondary">
                    {selectedAgent.evalProfile?.summary ||
                      'Used to judge whether the collaborator actually moved the work forward safely.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(selectedAgent.evalProfile?.criteria || []).length > 0 ? (
                      (selectedAgent.evalProfile?.criteria || []).map(item => (
                        <StatusBadge key={item} tone="success">
                          {item}
                        </StatusBadge>
                      ))
                    ) : (
                      <span className="text-sm text-secondary">
                        No explicit evaluation criteria are attached yet.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="workspace-surface">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="workspace-section-title">Learning summary</p>
                  <p className="workspace-section-copy">
                    What this collaborator currently knows about the capability.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailTab('learning')}
                  className="enterprise-button enterprise-button-secondary"
                >
                  View learning
                </button>
              </div>
              <p className="mt-4 text-sm leading-7 text-secondary">
                {getLearningSummaryText(selectedAgent)}
              </p>
            </section>

            <section className="workspace-surface space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="workspace-section-title">Operating contract</p>
                  <p className="workspace-section-copy">
                    The shared agent setup this collaborator follows across skills, guardrails, and artifact expectations.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="info">
                    Starter {selectedAgent.roleStarterKey || selectedAgent.standardTemplateKey || 'Custom'}
                  </StatusBadge>
                  <button
                    type="button"
                    onClick={() => setIsEditingSelectedAgent(true)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    <Edit3 size={16} />
                    Edit contract
                  </button>
                </div>
              </div>

              <p className="text-sm leading-7 text-secondary">
                {selectedContract.description}
              </p>

              <div className="grid gap-4 xl:grid-cols-2">
                {[
                  {
                    label: 'Primary responsibilities',
                    items: selectedContract.primaryResponsibilities,
                  },
                  { label: 'Working approach', items: selectedContract.workingApproach },
                  { label: 'Preferred outputs', items: selectedContract.preferredOutputs },
                  { label: 'Guardrails', items: selectedContract.guardrails },
                  {
                    label: 'Conflict resolution',
                    items: selectedContract.conflictResolution,
                  },
                ].map(section => (
                  <div
                    key={section.label}
                    className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4"
                  >
                    <p className="workspace-meta-label">{section.label}</p>
                    {section.items.length > 0 ? (
                      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-secondary">
                        {section.items.map(item => (
                          <li key={item} className="flex gap-2">
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-secondary">No items captured yet.</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4">
                  <p className="workspace-meta-label">Suggested input artifacts</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedContract.suggestedInputArtifacts.length > 0 ? (
                      selectedContract.suggestedInputArtifacts.map(expectation => (
                        <StatusBadge key={expectation.artifactName} tone="neutral">
                          {expectation.artifactName}
                        </StatusBadge>
                      ))
                    ) : (
                      <span className="text-sm text-secondary">No default input suggestions.</span>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-4 py-4">
                  <p className="workspace-meta-label">Expected output artifacts</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedContract.expectedOutputArtifacts.length > 0 ? (
                      selectedContract.expectedOutputArtifacts.map(expectation => (
                        <StatusBadge key={expectation.artifactName} tone="brand">
                          {expectation.artifactName}
                        </StatusBadge>
                      ))
                    ) : (
                      <span className="text-sm text-secondary">No default output expectations.</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-outline-variant/30 bg-white px-4 py-4">
                <p className="workspace-meta-label">Definition of done</p>
                <p className="mt-2 text-sm leading-7 text-secondary">
                  {selectedContract.definitionOfDone}
                </p>
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-3">
              <section className="workspace-surface">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="workspace-section-title">Skills</p>
                    <p className="workspace-section-copy">
                      {attachedSkills.length} capability skills attached.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailTab('skills')}
                    className="text-sm font-bold text-primary"
                  >
                    Manage
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {attachedSkills.slice(0, 6).map(skill => (
                    <span
                      key={skill.id}
                      className="rounded-full bg-primary/5 px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-primary"
                    >
                      {skill.name}
                    </span>
                  ))}
                  {attachedSkills.length === 0 ? (
                    <p className="text-sm text-secondary">No skills attached yet.</p>
                  ) : null}
                  {attachedSkills.length > 6 ? (
                    <span className="rounded-full bg-surface-container-low px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-outline">
                      +{attachedSkills.length - 6}
                    </span>
                  ) : null}
                </div>
              </section>

              <section className="workspace-surface">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="workspace-section-title">Tool profile</p>
                    <p className="workspace-section-copy">
                      Preferred tool profile for this agent. Workflow steps still decide actual execution access.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailTab('tools')}
                    className="text-sm font-bold text-primary"
                  >
                    View tools
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {preferredTools.slice(0, 6).map(toolId => (
                    <span
                      key={toolId}
                      className="rounded-full bg-surface-container-low px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-outline"
                    >
                      {formatToolLabel(toolId)}
                    </span>
                  ))}
                  {preferredTools.length === 0 ? (
                    <p className="text-sm text-secondary">No preferred tools defined yet.</p>
                  ) : null}
                  {preferredTools.length > 6 ? (
                    <span className="rounded-full bg-surface-container-low px-3 py-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-outline">
                      +{preferredTools.length - 6}
                    </span>
                  ) : null}
                </div>
              </section>

              <section className="workspace-surface">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="workspace-section-title">Recent sessions</p>
                    <p className="workspace-section-copy">
                      Saved collaboration contexts this agent can resume.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailTab('sessions')}
                    className="text-sm font-bold text-primary"
                  >
                    View all
                  </button>
                </div>
                <div className="mt-4 space-y-2">
                  {recentSessions.length > 0 ? (
                    recentSessions.map(session => (
                      <div
                        key={`${session.scope}:${session.scopeId || 'general'}`}
                        className="rounded-2xl bg-surface-container-low px-4 py-3"
                      >
                        <p className="text-sm font-bold text-on-surface">
                          {session.scope}
                          {session.scopeId ? ` · ${session.scopeId}` : ''}
                        </p>
                        <p className="mt-1 text-xs text-secondary">
                          {session.requestCount} requests · Last used{' '}
                          {formatTimestamp(session.lastUsedAt)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-secondary">
                      No resumable sessions have been recorded yet.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </div>
        );
      }

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
              <span className="field-label">Base role starter</span>
              <select
                value={detailForm.roleStarterKey}
                onChange={event =>
                  setDetailForm(prev =>
                    applyRoleStarterToForm(
                      prev,
                      activeCapability.name,
                      availableSkills,
                      event.target.value as AgentRoleStarterKey,
                    ),
                  )
                }
                disabled={Boolean(selectedAgent.isBuiltIn || selectedAgent.isOwner)}
                className="field-select"
              >
                {WORKSPACE_AGENT_TEMPLATES.filter(template => template.key !== 'OWNER').map(
                  template => (
                    <option key={template.roleStarterKey} value={template.roleStarterKey}>
                      {template.name}
                    </option>
                  ),
                )}
              </select>
              <p className="field-help">
                {selectedAgent.isBuiltIn || selectedAgent.isOwner
                  ? 'Shared standard agents keep their starter contract fixed.'
                  : 'Changing the starter refreshes the structured contract, default skills, and preferred tool profile.'}
              </p>
            </label>
            <label className="space-y-2">
              <span className="field-label">Runtime provider</span>
              <select
                value={detailForm.providerKey}
                onChange={event =>
                  setDetailForm(prev => {
                    const nextProviderKey = event.target.value as ProviderKey;
                    const nextModel = getProviderModelOptions(nextProviderKey).some(
                      model => model.id === prev.model || model.apiModelId === prev.model,
                    )
                      ? prev.model
                      : getPreferredModelForProvider(nextProviderKey);
                    return {
                      ...prev,
                      providerKey: nextProviderKey,
                      model: nextModel,
                    };
                  })
                }
                className="field-select"
              >
                {runtimeProviderOptions.map(provider => (
                  <option key={provider.key} value={provider.key}>
                    {provider.label}
                  </option>
                ))}
              </select>
              <p className="field-help">
                Choose the runtime lane this agent should use. If you leave other agents unpinned, they follow the desktop default provider from Operations.
              </p>
            </label>
            <label className="space-y-2">
              <span className="field-label">Runtime model</span>
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
                This list comes from the selected runtime provider when available, so the agent only uses models exposed by that environment.
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
              <span className="field-label">Contract description</span>
              <textarea
                value={detailForm.contractDescription}
                onChange={event =>
                  setDetailForm(prev => ({
                    ...prev,
                    contractDescription: event.target.value,
                  }))
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
            <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low p-5 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="workspace-section-title">Preferred tool profile</p>
                  <p className="workspace-section-copy">
                    Starter-level defaults only. Workflow step allowlists still control real execution access.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/tool-access')}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Wrench size={16} />
                  Open tool policy
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {detailForm.preferredToolIds.length > 0 ? (
                  detailForm.preferredToolIds.map(toolId => (
                    <StatusBadge key={toolId} tone="info">
                      {formatToolLabel(toolId)}
                    </StatusBadge>
                  ))
                ) : (
                  <p className="text-sm text-secondary">No preferred tool profile is attached.</p>
                )}
              </div>
            </div>
            <div className="grid gap-4 rounded-3xl border border-outline-variant/20 bg-surface-container-low p-5 md:col-span-2 md:grid-cols-2">
              <label className="space-y-2">
                <span className="field-label">Primary responsibilities</span>
                <textarea
                  value={detailForm.primaryResponsibilities}
                  onChange={event =>
                    setDetailForm(prev => ({
                      ...prev,
                      primaryResponsibilities: event.target.value,
                    }))
                  }
                  className="field-textarea"
                />
              </label>
              <label className="space-y-2">
                <span className="field-label">Working approach</span>
                <textarea
                  value={detailForm.workingApproach}
                  onChange={event =>
                    setDetailForm(prev => ({
                      ...prev,
                      workingApproach: event.target.value,
                    }))
                  }
                  className="field-textarea"
                />
              </label>
              <label className="space-y-2">
                <span className="field-label">Preferred outputs</span>
                <textarea
                  value={detailForm.preferredOutputs}
                  onChange={event =>
                    setDetailForm(prev => ({
                      ...prev,
                      preferredOutputs: event.target.value,
                    }))
                  }
                  className="field-textarea"
                />
              </label>
              <label className="space-y-2">
                <span className="field-label">Guardrails</span>
                <textarea
                  value={detailForm.guardrails}
                  onChange={event =>
                    setDetailForm(prev => ({
                      ...prev,
                      guardrails: event.target.value,
                    }))
                  }
                  className="field-textarea"
                />
              </label>
              <label className="space-y-2">
                <span className="field-label">Conflict resolution guidance</span>
                <textarea
                  value={detailForm.conflictResolution}
                  onChange={event =>
                    setDetailForm(prev => ({
                      ...prev,
                      conflictResolution: event.target.value,
                    }))
                  }
                  className="field-textarea"
                />
              </label>
              <label className="space-y-2">
                <span className="field-label">Definition of done</span>
                <textarea
                  value={detailForm.definitionOfDone}
                  onChange={event =>
                    setDetailForm(prev => ({
                      ...prev,
                      definitionOfDone: event.target.value,
                    }))
                  }
                  className="field-textarea"
                />
              </label>
              <label className="space-y-2">
                <span className="field-label">Suggested input artifacts</span>
                <textarea
                  value={detailForm.suggestedInputArtifacts}
                  onChange={event =>
                    setDetailForm(prev => ({
                      ...prev,
                      suggestedInputArtifacts: event.target.value,
                    }))
                  }
                  className="field-textarea"
                />
                <p className="field-help">One artifact name per line. Inputs stay advisory by default.</p>
              </label>
              <label className="space-y-2">
                <span className="field-label">Expected output artifacts</span>
                <textarea
                  value={detailForm.expectedOutputArtifacts}
                  onChange={event =>
                    setDetailForm(prev => ({
                      ...prev,
                      expectedOutputArtifacts: event.target.value,
                    }))
                  }
                  className="field-textarea"
                />
                <p className="field-help">
                  One artifact name per line. Outputs stay expected by default unless the workflow step overrides them.
                </p>
              </label>
            </div>
          </div>
        </div>
      );
    }

    if (detailTab === 'learning') {
      return (
        <div className="space-y-4">
          {selectedAgentKnowledgeLens ? (
            <AgentKnowledgeLensPanel lens={selectedAgentKnowledgeLens} />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-4">
            {[
              {
                label: 'Status',
                value: getAgentHealth(selectedAgent).label,
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

          <AdvancedDisclosure
            title="Technical context block"
            description="The reusable context sent to Copilot when this collaborator starts or resumes work."
            storageKey="singularity.team.learning.context.open"
            badge={<StatusBadge tone="neutral">Advanced</StatusBadge>}
          >
            <p className="whitespace-pre-wrap text-sm leading-7 text-secondary">
              {selectedAgent.learningProfile.contextBlock ||
                'The reusable Copilot context block will appear here after learning completes.'}
            </p>
          </AdvancedDisclosure>

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
      if (!isEditingSelectedAgent) {
        const attachedSkills = availableSkills.filter(skill =>
          selectedAgent.skillIds.includes(skill.id),
        );

        return (
          <div className="space-y-4">
            <div className="workspace-surface">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="workspace-section-title">Attached skills</p>
                  <p className="workspace-section-copy">
                    These skills shape how this collaborator contributes to the capability.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditingSelectedAgent(true)}
                  className="enterprise-button enterprise-button-secondary"
                >
                  <Edit3 size={16} />
                  Edit skills
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {attachedSkills.length > 0 ? (
                attachedSkills.map(skill => (
                  <div key={skill.id} className="team-skill-card">
                    <p className="text-sm font-bold text-on-surface">{skill.name}</p>
                    <p className="mt-1 text-sm leading-relaxed text-secondary">
                      {skill.description}
                    </p>
                    <p className="mt-3 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      {skill.category}
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No skills attached"
                  description="Open edit mode to attach capability skills to this collaborator."
                  icon={FileText}
                />
              )}
            </div>
          </div>
        );
      }

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

    if (detailTab === 'tools') {
      const preferredTools = selectedAgent.preferredToolIds || [];

      return (
        <div className="space-y-4">
          <div className="workspace-surface">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="workspace-section-title">Preferred tool profile</p>
                <p className="workspace-section-copy">
                  These are this agent’s default tool preferences. Workflow step allowlists remain the real execution gate.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/tool-access')}
                className="enterprise-button enterprise-button-secondary"
              >
                <Wrench size={16} />
                Open tool policy
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {preferredTools.length > 0 ? (
              preferredTools.map(toolId => (
                <div key={toolId} className="team-skill-card">
                  <p className="text-sm font-bold text-on-surface">
                    {formatToolLabel(toolId)}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-secondary">
                    Preferred by this agent when an eligible workflow step grants the tool.
                  </p>
                  <p className="mt-3 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                    {toolId}
                  </p>
                </div>
              ))
            ) : (
              <EmptyState
                title="No preferred tools"
                description="This collaborator currently relies on workflow step access only."
                icon={Wrench}
              />
            )}
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
        eyebrow="Capability Agents"
        context={activeCapability.id}
        title={activeCapability.name}
        description="Manage, configure, and monitor every agent in this capability team. Select an agent to review their purpose, readiness, and session history."
        actions={
          <>
            <label className="relative min-w-0 flex-1 lg:max-w-xs">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-outline"
              />
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search agents"
                className="enterprise-input pl-10"
              />
            </label>
            <button
              type="button"
              onClick={() => navigate('/chat')}
              className="enterprise-button enterprise-button-secondary"
            >
              <MessageSquare size={16} />
              Chat
            </button>
            <button
              type="button"
              onClick={openBulkModelModal}
              disabled={bootStatus !== 'ready' || workspace.agents.length === 0}
              className="enterprise-button enterprise-button-secondary"
            >
              <Bot size={16} />
              Change all models
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              disabled={bootStatus !== 'ready'}
              className="enterprise-button enterprise-button-primary"
            >
              <Plus size={16} />
              Create agent
            </button>
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="brand">{workspace.agents.length} collaborators</StatusBadge>
          <StatusBadge tone="success">{learningReadyCount} ready</StatusBadge>
          <StatusBadge tone={needsAttentionCount > 0 ? 'warning' : 'neutral'}>
            {needsAttentionCount} need attention
          </StatusBadge>
          <StatusBadge tone="neutral">{totalSessionCount} sessions</StatusBadge>
        </div>
      </PageHeader>

      {bootStatus !== 'ready' ? (
        <div className="workspace-inline-alert workspace-inline-alert-warning">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Capability sync is not fully ready</p>
            <p className="mt-1">
              Agent changes stay read-only until the capability bundle is synchronized with the backend.
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Collaborators"   value={workspace.agents.length} icon={Users}    tone="brand"   />
        <StatTile label="Custom agents"   value={customAgentCount}        icon={Bot}      tone="info"    />
        <StatTile label="Ready to learn"  value={learningReadyCount}      icon={CheckCircle2} tone="success" />
        <StatTile label="Total sessions"  value={totalSessionCount}       icon={MessageSquare} tone="neutral" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <section className="space-y-4">
          <SectionCard
            title="Collaborators"
            description="Owner is pinned first. Select anyone to review purpose, readiness, and sessions."
            icon={Users}
            action={
              <StatusBadge tone="neutral">
                {activeChatAgent?.name || 'No chat agent'} active
              </StatusBadge>
            }
          >

            <div className="mt-4 space-y-2">
              {ownerAgent ? (
                renderAgentRow(ownerAgent, { pinned: true })
              ) : (
                <EmptyState
                  title="No owner agent found"
                  description="This capability needs an owning agent before the rest of the agents can be managed."
                  icon={Crown}
                />
              )}
              {filteredRoster.length > 0 ? (
                filteredRoster.map(agent => renderAgentRow(agent))
              ) : (
                <div className="rounded-2xl border border-dashed border-outline-variant/50 bg-surface-container-low px-4 py-6 text-center text-sm text-secondary">
                  {searchQuery.trim()
                    ? 'No collaborators match this search.'
                    : 'No specialist agents have been added yet.'}
                </div>
              )}
            </div>
          </SectionCard>
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
                        <StatusBadge tone="success">Shared standard</StatusBadge>
                      ) : (
                        <StatusBadge tone="info">Capability custom</StatusBadge>
                      )}
                      <StatusBadge tone={getLearningTone(selectedAgent.learningProfile.status)}>
                        {getAgentHealth(selectedAgent).label}
                      </StatusBadge>
                      {detailFormIsDirty ? <StatusBadge tone="warning">Unsaved</StatusBadge> : null}
                    </div>
                    <h2 className="mt-3 text-2xl font-bold tracking-tight text-on-surface">
                      {selectedAgent.name}
                    </h2>
                    <p className="mt-1 text-sm text-secondary">{selectedAgent.role}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isEditingSelectedAgent) {
                          setIsEditingSelectedAgent(false);
                          setDetailTab('overview');
                          return;
                        }
                        setIsEditingSelectedAgent(true);
                      }}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      {isEditingSelectedAgent ? <X size={16} /> : <Edit3 size={16} />}
                      {isEditingSelectedAgent ? 'View profile' : 'Edit agent'}
                    </button>
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
                      ['tools', 'Tools'],
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

              {isEditingSelectedAgent || detailFormIsDirty ? (
                <div className="flex flex-col gap-3 border-t border-outline-variant/40 bg-surface-container-low/60 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <p className="text-sm text-secondary">
                    {detailFormIsDirty
                      ? 'You have unsaved agent changes in this detail pane.'
                      : 'Edit mode is open. Make changes, then save or return to profile view.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedAgent) {
                          setDetailForm(agentToForm(selectedAgent));
                        }
                        setIsEditingSelectedAgent(false);
                      }}
                      className="enterprise-button enterprise-button-secondary"
                    >
                      Reset
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
              ) : null}
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState
                title="No agent selected"
                description="Pick a roster row on the left to inspect readiness, purpose, skills, and sessions."
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

      {bulkModelModalOpen ? (
        <div className="workspace-modal-backdrop">
          <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" />
          <ModalShell
            eyebrow="Bulk Model Update"
            title={`Change all collaborator models in ${activeCapability.name}`}
            description="Apply one runtime model across all capability agents instead of editing each agent individually."
            actions={
              <button
                type="button"
                onClick={() => setBulkModelModalOpen(false)}
                className="workspace-list-action"
              >
                <X size={16} />
              </button>
            }
            className="relative z-10 max-w-3xl"
          >
            <form onSubmit={handleApplyBulkModel} className="space-y-6 pt-6">
              {renderRuntimeNotice(bulkModelUnavailable)}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="field-label">Target runtime model</span>
                  <select
                    value={bulkModelValue}
                    onChange={event => setBulkModelValue(event.target.value)}
                    className="field-select"
                  >
                    {bulkModelOptions.map(model => (
                      <option key={model.apiModelId} value={model.apiModelId}>
                        {model.label} · {model.profile}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="workspace-meta-card">
                  <p className="workspace-meta-label">Collaborators</p>
                  <p className="workspace-meta-value">{workspace.agents.length}</p>
                </div>
                <div className="workspace-meta-card">
                  <p className="workspace-meta-label">Agents changing</p>
                  <p className="workspace-meta-value">{bulkModelChangeCount}</p>
                </div>
              </div>

              <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-low p-5">
                <p className="workspace-section-title">What this changes</p>
                <ul className="mt-3 space-y-2 text-sm leading-7 text-secondary">
                  <li>All owner, standard, and custom agents in this capability will use the selected model.</li>
                  <li>Saved resumable chat sessions are cleared so future chats reopen on the new model cleanly.</li>
                  <li>Learning profiles stay intact; this only changes the runtime model selection.</li>
                </ul>
              </div>

              <div className="flex flex-col gap-3 border-t border-outline-variant/40 pt-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-secondary">
                  Bulk updates keep the capability consistent when you want all agents on the same lower-cost or higher-quality model.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkModelModalOpen(false)}
                    className="enterprise-button enterprise-button-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={bootStatus !== 'ready' || isApplyingBulkModel}
                    className="enterprise-button enterprise-button-primary"
                  >
                    {isApplyingBulkModel ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={16} />
                    )}
                    Apply to all agents
                  </button>
                </div>
              </div>
            </form>
          </ModalShell>
        </div>
      ) : null}

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
                  <span className="field-label">Base role starter</span>
                  <select
                    value={createForm.roleStarterKey}
                    onChange={event =>
                      setCreateForm(prev =>
                        applyRoleStarterToForm(
                          prev,
                          activeCapability.name,
                          availableSkills,
                          event.target.value as AgentRoleStarterKey,
                        ),
                      )
                    }
                    className="field-select"
                  >
                    {WORKSPACE_AGENT_TEMPLATES.filter(template => template.key !== 'OWNER').map(
                      template => (
                        <option key={template.roleStarterKey} value={template.roleStarterKey}>
                          {template.name}
                        </option>
                      ),
                    )}
                  </select>
                  <p className="field-help">
                    Every custom agent starts from one structured starter contract, then you can tailor it for this capability.
                  </p>
                </label>
                <label className="space-y-2">
                  <span className="field-label">Runtime provider</span>
                  <select
                    value={createForm.providerKey}
                    onChange={event =>
                      setCreateForm(prev => {
                        const nextProviderKey = event.target.value as ProviderKey;
                        const nextModel = getProviderModelOptions(nextProviderKey).some(
                          model => model.id === prev.model || model.apiModelId === prev.model,
                        )
                          ? prev.model
                          : getPreferredModelForProvider(nextProviderKey);
                        return {
                          ...prev,
                          providerKey: nextProviderKey,
                          model: nextModel,
                        };
                      })
                    }
                    className="field-select"
                  >
                    {runtimeProviderOptions.map(provider => (
                      <option key={provider.key} value={provider.key}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                  <p className="field-help">
                    Pin this agent to a specific runtime lane, or match the desktop default provider before saving.
                  </p>
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
                  <span className="field-label">Runtime model</span>
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
                  <span className="field-label">Contract description</span>
                  <textarea
                    value={createForm.contractDescription}
                    onChange={event =>
                      setCreateForm(prev => ({
                        ...prev,
                        contractDescription: event.target.value,
                      }))
                    }
                    placeholder="Summarize what this agent is responsible for inside the capability."
                    className="field-textarea"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => setCreateAdvancedOpen(current => !current)}
                className="enterprise-button enterprise-button-secondary"
              >
                {createAdvancedOpen ? 'Hide advanced setup' : 'Show advanced setup'}
              </button>

              {createAdvancedOpen ? (
                <>
                  <div className="grid gap-4 rounded-3xl border border-outline-variant/20 bg-surface-container-low p-5 md:grid-cols-2">
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
                    <div className="rounded-3xl border border-outline-variant/20 bg-white p-5 md:col-span-2">
                      <p className="workspace-section-title">Preferred tool profile</p>
                      <p className="workspace-section-copy">
                        Inherited from the chosen starter. Workflow steps still decide actual execution access.
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {createForm.preferredToolIds.length > 0 ? (
                          createForm.preferredToolIds.map(toolId => (
                            <StatusBadge key={toolId} tone="info">
                              {formatToolLabel(toolId)}
                            </StatusBadge>
                          ))
                        ) : (
                          <p className="text-sm text-secondary">No preferred tool profile is attached.</p>
                        )}
                      </div>
                    </div>
                    <label className="space-y-2">
                      <span className="field-label">Primary responsibilities</span>
                      <textarea
                        value={createForm.primaryResponsibilities}
                        onChange={event =>
                          setCreateForm(prev => ({
                            ...prev,
                            primaryResponsibilities: event.target.value,
                          }))
                        }
                        className="field-textarea"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="field-label">Working approach</span>
                      <textarea
                        value={createForm.workingApproach}
                        onChange={event =>
                          setCreateForm(prev => ({
                            ...prev,
                            workingApproach: event.target.value,
                          }))
                        }
                        className="field-textarea"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="field-label">Preferred outputs</span>
                      <textarea
                        value={createForm.preferredOutputs}
                        onChange={event =>
                          setCreateForm(prev => ({
                            ...prev,
                            preferredOutputs: event.target.value,
                          }))
                        }
                        className="field-textarea"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="field-label">Guardrails</span>
                      <textarea
                        value={createForm.guardrails}
                        onChange={event =>
                          setCreateForm(prev => ({
                            ...prev,
                            guardrails: event.target.value,
                          }))
                        }
                        className="field-textarea"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="field-label">Conflict resolution guidance</span>
                      <textarea
                        value={createForm.conflictResolution}
                        onChange={event =>
                          setCreateForm(prev => ({
                            ...prev,
                            conflictResolution: event.target.value,
                          }))
                        }
                        className="field-textarea"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="field-label">Definition of done</span>
                      <textarea
                        value={createForm.definitionOfDone}
                        onChange={event =>
                          setCreateForm(prev => ({
                            ...prev,
                            definitionOfDone: event.target.value,
                          }))
                        }
                        className="field-textarea"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="field-label">Suggested input artifacts</span>
                      <textarea
                        value={createForm.suggestedInputArtifacts}
                        onChange={event =>
                          setCreateForm(prev => ({
                            ...prev,
                            suggestedInputArtifacts: event.target.value,
                          }))
                        }
                        className="field-textarea"
                      />
                      <p className="field-help">One artifact name per line. Inputs stay advisory by default.</p>
                    </label>
                    <label className="space-y-2">
                      <span className="field-label">Expected output artifacts</span>
                      <textarea
                        value={createForm.expectedOutputArtifacts}
                        onChange={event =>
                          setCreateForm(prev => ({
                            ...prev,
                            expectedOutputArtifacts: event.target.value,
                          }))
                        }
                        className="field-textarea"
                      />
                      <p className="field-help">
                        One artifact name per line. Outputs stay expected by default unless a workflow step overrides them.
                      </p>
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
                </>
              ) : null}

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
