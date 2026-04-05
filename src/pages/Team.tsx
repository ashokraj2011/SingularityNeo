import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  CheckCircle2,
  Cpu,
  Crown,
  FileText,
  MessageSquare,
  Plus,
  Settings2,
  Sparkles,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { COPILOT_MODEL_OPTIONS, SKILL_LIBRARY } from '../constants';
import { useCapability } from '../context/CapabilityContext';
import { CapabilityAgent, Skill } from '../types';

const splitLines = (value: string) =>
  value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);

const formatCurrency = (value: number) => `$${value.toFixed(4)}`;

const createAgentId = (capabilityId: string, name: string) => {
  const cleaned = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);

  return `${capabilityId}-${cleaned || 'AGENT'}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
};

const getAvailableSkills = (capabilitySkills: Skill[]) => {
  const uniqueSkills = new Map<string, Skill>();
  [...capabilitySkills, ...SKILL_LIBRARY].forEach(skill => {
    uniqueSkills.set(skill.id, skill);
  });
  return [...uniqueSkills.values()];
};

const createAgentForm = (skills: Skill[]) => ({
  name: '',
  role: 'Capability Specialist',
  objective: '',
  systemPrompt: '',
  documentationSources: '',
  learningNotes: '',
  skillIds: skills.map(skill => skill.id),
  model: COPILOT_MODEL_OPTIONS[0].id,
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

export default function Team() {
  const navigate = useNavigate();
  const {
    activeCapability,
    getCapabilityWorkspace,
    addCapabilityAgent,
    updateCapabilityAgent,
    setActiveChatAgent,
  } = useCapability();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const availableSkills = useMemo(
    () => getAvailableSkills(activeCapability.skillLibrary),
    [activeCapability.skillLibrary],
  );
  const ownerAgent = workspace.agents.find(agent => agent.isOwner) || workspace.agents[0];
  const activeChatAgent =
    workspace.agents.find(agent => agent.id === workspace.activeChatAgentId) || ownerAgent;

  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [selectedAgentId, setSelectedAgentId] = useState<string>(ownerAgent?.id || '');
  const [form, setForm] = useState(() => createAgentForm(availableSkills));

  const selectedAgent =
    workspace.agents.find(agent => agent.id === selectedAgentId) || ownerAgent || null;

  useEffect(() => {
    if (!selectedAgentId && ownerAgent) {
      setSelectedAgentId(ownerAgent.id);
    }
  }, [ownerAgent, selectedAgentId]);

  useEffect(() => {
    if (mode === 'edit' && selectedAgent) {
      setForm(agentToForm(selectedAgent));
      return;
    }

    if (mode === 'create') {
      setForm(createAgentForm(availableSkills));
    }
  }, [availableSkills, mode, selectedAgent]);

  const learningCount = useMemo(
    () =>
      workspace.agents.reduce(
        (count, agent) => count + (agent.learningNotes?.length || 0),
        0,
      ),
    [workspace.agents],
  );
  const builtInCount = useMemo(
    () => workspace.agents.filter(agent => agent.isBuiltIn).length,
    [workspace.agents],
  );

  const configureAgent = (agent: CapabilityAgent) => {
    setMode('edit');
    setSelectedAgentId(agent.id);
  };

  const openCreatePanel = () => {
    setMode('create');
    setSelectedAgentId('');
    setForm(createAgentForm(availableSkills));
  };

  const toggleSkill = (skillId: string) => {
    setForm(prev => ({
      ...prev,
      skillIds: prev.skillIds.includes(skillId)
        ? prev.skillIds.filter(id => id !== skillId)
        : [...prev.skillIds, skillId],
    }));
  };

  const setField = (
    field: keyof typeof form,
    value: string | string[],
  ) => {
    setForm(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const canSave = Boolean(form.name.trim() && form.role.trim() && form.objective.trim());

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    const sharedFields = {
      name: form.name.trim(),
      role: form.role.trim(),
      objective: form.objective.trim(),
      systemPrompt:
        form.systemPrompt.trim() ||
        `Operate only within ${activeCapability.name}. Use the capability metadata, documentation, skills, and team learning already attached to this capability.`,
      initializationStatus: 'READY' as const,
      documentationSources: splitLines(form.documentationSources),
      learningNotes: splitLines(form.learningNotes),
      skillIds: form.skillIds,
      provider: 'GitHub Copilot API' as const,
      model: form.model,
      tokenLimit: Math.max(1000, Number.parseInt(form.tokenLimit, 10) || 12000),
    };

    if (mode === 'create') {
      addCapabilityAgent(activeCapability.id, {
        id: createAgentId(activeCapability.id, form.name),
        ...sharedFields,
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
      });
      setMode('create');
      setForm(createAgentForm(availableSkills));
      return;
    }

    if (selectedAgent) {
      updateCapabilityAgent(activeCapability.id, selectedAgent.id, sharedFields);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[0.625rem] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">Capability Team</span>
            <span className="text-[0.625rem] font-bold text-slate-400 uppercase tracking-widest">{activeCapability.id}</span>
          </div>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">{activeCapability.name} Agent Manager</h1>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            Every agent is tagged to this capability, runs through the GitHub Copilot API, and carries its own model, token budget, skill stack, usage profile, and output history.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-3xl border border-outline-variant/15 bg-white p-4 shadow-sm">
          {[
            { label: 'Agents', value: workspace.agents.length },
            { label: 'Built-in Agents', value: builtInCount },
            { label: 'Learning Notes', value: learningCount },
          ].map(item => (
            <div key={item.label} className="rounded-2xl bg-surface-container-low px-4 py-3 text-center">
              <p className="text-2xl font-extrabold text-primary">{item.value}</p>
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-secondary">{item.label}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_560px]">
        <section className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[2rem] border border-primary/15 bg-primary/5 p-6 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-white text-primary shadow-sm">
                  <Crown size={24} />
                </div>
                <div>
                  <p className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-primary">Team owner</p>
                  <h2 className="mt-1 text-xl font-extrabold text-on-surface">{ownerAgent?.name || 'Capability Owning Agent'}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-secondary">
                    {ownerAgent?.objective}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-primary">{ownerAgent?.provider}</span>
                    <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-primary">{ownerAgent?.model}</span>
                    <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-primary">{ownerAgent?.tokenLimit.toLocaleString()} tokens</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => ownerAgent && setActiveChatAgent(activeCapability.id, ownerAgent.id)}
                  className="rounded-2xl border border-primary/15 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-primary transition-all hover:bg-primary/5"
                >
                  Use in chat
                </button>
                <button
                  onClick={() => ownerAgent && configureAgent(ownerAgent)}
                  className="rounded-2xl border border-primary/15 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-primary transition-all hover:bg-primary/5"
                >
                  Configure
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {[
                {
                  label: 'Requests',
                  value: ownerAgent?.usage.requestCount || 0,
                },
                {
                  label: 'Total Tokens',
                  value: (ownerAgent?.usage.totalTokens || 0).toLocaleString(),
                },
                {
                  label: 'Estimated Cost',
                  value: formatCurrency(ownerAgent?.usage.estimatedCostUsd || 0),
                },
              ].map(item => (
                <div key={item.label} className="rounded-2xl bg-white p-4">
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.2em] text-outline">{item.label}</p>
                  <p className="mt-3 text-xl font-extrabold text-primary">{item.value}</p>
                </div>
              ))}
            </div>
          </motion.div>

          <div className="grid gap-4 md:grid-cols-2">
            {workspace.agents.map(agent => {
              const attachedSkills = availableSkills.filter(skill => agent.skillIds.includes(skill.id));
              const isSelected = mode === 'edit' && selectedAgentId === agent.id;

              return (
                <div
                  key={agent.id}
                  className={`rounded-3xl border bg-white p-5 shadow-sm transition-all ${
                    isSelected
                      ? 'border-primary shadow-lg shadow-primary/5'
                      : 'border-outline-variant/15'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-container-low text-primary">
                        {agent.isOwner ? <Crown size={20} /> : <Bot size={20} />}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-on-surface">{agent.name}</h3>
                        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">{agent.role}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full bg-primary/5 px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                            {activeCapability.id}
                          </span>
                          {agent.isBuiltIn && (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-emerald-700">
                              Built-in
                            </span>
                          )}
                          <span className="rounded-full bg-surface-container-low px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-secondary">
                            {agent.model}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => configureAgent(agent)}
                      className="rounded-2xl border border-outline-variant/15 px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-secondary transition-all hover:bg-surface-container-low"
                    >
                      Edit
                    </button>
                  </div>

                  <p className="mt-4 text-sm leading-relaxed text-secondary">{agent.objective}</p>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-surface-container-low p-4">
                      <div className="flex items-center gap-2">
                        <Cpu size={14} className="text-primary" />
                        <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Runtime</p>
                      </div>
                      <p className="mt-3 text-sm font-bold text-on-surface">{agent.provider}</p>
                      <p className="text-sm text-secondary">{agent.tokenLimit.toLocaleString()} token limit</p>
                    </div>
                    <div className="rounded-2xl bg-surface-container-low p-4">
                      <div className="flex items-center gap-2">
                        <BarChart3 size={14} className="text-primary" />
                        <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Usage</p>
                      </div>
                      <p className="mt-3 text-sm font-bold text-on-surface">{agent.usage.totalTokens.toLocaleString()} tokens</p>
                      <p className="text-sm text-secondary">{formatCurrency(agent.usage.estimatedCostUsd)} estimated</p>
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className="text-primary" />
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">Skills</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {attachedSkills.length > 0 ? (
                        attachedSkills.map(skill => (
                          <span key={skill.id} className="rounded-full bg-primary/5 px-3 py-1.5 text-xs font-bold text-primary">
                            {skill.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-secondary">No skills attached yet.</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between">
                    <button
                      onClick={() => setActiveChatAgent(activeCapability.id, agent.id)}
                      className="rounded-2xl border border-outline-variant/15 px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-secondary transition-all hover:bg-surface-container-low"
                    >
                      Use in chat
                    </button>
                    <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                      {agent.previousOutputs.length} outputs
                    </span>
                  </div>
                </div>
              );
            })}

            {workspace.agents.length === 0 && (
              <div className="md:col-span-2 rounded-[2rem] border-2 border-dashed border-outline-variant/20 bg-white p-12 text-center">
                <Users size={36} className="mx-auto text-outline" />
                <h3 className="mt-4 text-xl font-bold text-primary">No agents yet</h3>
                <p className="mt-2 text-sm leading-relaxed text-secondary">
                  Start with a capability-owned agent configuration on the right to build this team.
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <form
            onSubmit={handleSubmit}
            className="rounded-[2rem] border border-outline-variant/15 bg-white p-8 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  {mode === 'create' ? <Plus size={22} /> : <Settings2 size={22} />}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-primary">
                    {mode === 'create' ? 'Create New Agent' : `Edit ${selectedAgent?.name || 'Agent'}`}
                  </h2>
                  <p className="text-sm text-secondary">
                    This panel is capability-tagged to {activeCapability.name} and uses GitHub Copilot API settings.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={openCreatePanel}
                className="rounded-2xl border border-outline-variant/15 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.18em] text-secondary transition-all hover:bg-surface-container-low"
              >
                New Agent
              </button>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {[
                { label: 'Capability Tag', value: activeCapability.id, icon: CheckCircle2 },
                { label: 'Provider', value: 'GitHub Copilot API', icon: Cpu },
                {
                  label: 'Agent Type',
                  value: selectedAgent?.isOwner
                    ? 'Owner'
                    : selectedAgent?.isBuiltIn
                    ? 'Built-in'
                    : 'Custom',
                  icon: Bot,
                },
              ].map(item => (
                <div key={item.label} className="rounded-2xl bg-surface-container-low p-4">
                  <div className="flex items-center gap-2">
                    <item.icon size={14} className="text-primary" />
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">{item.label}</p>
                  </div>
                  <p className="mt-3 text-lg font-extrabold text-primary">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-3xl border border-emerald-100 bg-emerald-50/70 p-5">
              <p className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-emerald-700">
                Standard Team
              </p>
              <p className="mt-2 text-sm leading-relaxed text-emerald-900">
                Every capability starts with a built-in delivery team: Architect, Business Analyst, Software Developer, QA, DevOps, and Validation Agent. You can edit them, but they stay tagged to this capability.
              </p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="space-y-2 block">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Agent name</span>
                <input
                  value={form.name}
                  onChange={event => setField('name', event.target.value)}
                  placeholder="Compliance Reviewer"
                  className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm font-medium outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Role</span>
                <input
                  value={form.role}
                  onChange={event => setField('role', event.target.value)}
                  placeholder="Capability Specialist"
                  className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm font-medium outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Copilot Model</span>
                <select
                  value={form.model}
                  onChange={event => setField('model', event.target.value)}
                  className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm font-medium outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                >
                  {COPILOT_MODEL_OPTIONS.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.label} · {model.profile}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 block">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Token Limit</span>
                <input
                  type="number"
                  min={1000}
                  step={500}
                  value={form.tokenLimit}
                  onChange={event => setField('tokenLimit', event.target.value)}
                  className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm font-medium outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <label className="space-y-2 block md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Objective</span>
                <textarea
                  value={form.objective}
                  onChange={event => setField('objective', event.target.value)}
                  placeholder="Describe what this agent owns within the capability."
                  className="h-24 w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm leading-relaxed outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <label className="space-y-2 block md:col-span-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">System prompt</span>
                <textarea
                  value={form.systemPrompt}
                  onChange={event => setField('systemPrompt', event.target.value)}
                  placeholder="If blank, the capability-aware default prompt will be used."
                  className="h-24 w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm leading-relaxed outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Documentation sources</span>
                <textarea
                  value={form.documentationSources}
                  onChange={event => setField('documentationSources', event.target.value)}
                  placeholder={'Confluence capability page\nJira board\nArchitecture runbook'}
                  className="h-24 w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm leading-relaxed outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.2em] text-outline">Learning scope</span>
                <textarea
                  value={form.learningNotes}
                  onChange={event => setField('learningNotes', event.target.value)}
                  placeholder={'Pricing policy changes\nAPI governance updates'}
                  className="h-24 w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm leading-relaxed outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>
            </div>

            <div className="mt-6 rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={18} className="text-primary" />
                  <div>
                    <p className="text-sm font-bold text-on-surface">Attached Skills</p>
                    <p className="text-[0.6875rem] text-secondary">Skills stay tagged under {activeCapability.name} for this agent.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setField('skillIds', availableSkills.map(skill => skill.id))}
                  className="rounded-2xl border border-outline-variant/15 px-3 py-2 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-secondary transition-all hover:bg-white"
                >
                  Attach All
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {availableSkills.map(skill => {
                  const selected = form.skillIds.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      className={`rounded-2xl border p-4 text-left transition-all ${
                        selected
                          ? 'border-primary bg-white shadow-sm'
                          : 'border-outline-variant/10 bg-white/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-on-surface">{skill.name}</p>
                          <p className="mt-1 text-[0.6875rem] text-secondary">{skill.description}</p>
                        </div>
                        {selected && <CheckCircle2 size={16} className="text-primary" />}
                      </div>
                      <p className="mt-3 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">{skill.category}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {mode === 'edit' && selectedAgent && (
              <div className="mt-6 grid gap-4">
                <div className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={18} className="text-primary" />
                    <div>
                      <p className="text-sm font-bold text-on-surface">Usage Overview</p>
                      <p className="text-[0.6875rem] text-secondary">Copilot requests and token consumption for this agent.</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {[
                      { label: 'Requests', value: selectedAgent.usage.requestCount },
                      { label: 'Prompt Tokens', value: selectedAgent.usage.promptTokens.toLocaleString() },
                      { label: 'Completion Tokens', value: selectedAgent.usage.completionTokens.toLocaleString() },
                      { label: 'Estimated Cost', value: formatCurrency(selectedAgent.usage.estimatedCostUsd) },
                    ].map(item => (
                      <div key={item.label} className="rounded-2xl bg-white p-4">
                        <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">{item.label}</p>
                        <p className="mt-3 text-lg font-extrabold text-primary">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5">
                  <div className="flex items-center gap-2">
                    <FileText size={18} className="text-primary" />
                    <div>
                      <p className="text-sm font-bold text-on-surface">Previous Outputs</p>
                      <p className="text-[0.6875rem] text-secondary">Recent deliverables already produced by this capability agent.</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {selectedAgent.previousOutputs.length > 0 ? (
                      selectedAgent.previousOutputs.map(output => (
                        <div key={output.id} className="rounded-2xl bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-on-surface">{output.title}</p>
                              <p className="mt-1 text-sm text-secondary">{output.summary}</p>
                            </div>
                            <span className="rounded-full bg-primary/5 px-2.5 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                              {output.status}
                            </span>
                          </div>
                          <p className="mt-3 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                            {output.timestamp}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl bg-white p-4 text-sm text-secondary">
                        No previous outputs have been recorded for this agent yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSave}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {mode === 'create' ? <Plus size={16} /> : <Settings2 size={16} />}
              {mode === 'create' ? 'Add Agent to Capability' : 'Save Agent Configuration'}
            </button>
          </form>

          <div className="rounded-3xl border border-primary/10 bg-primary p-6 text-white shadow-xl shadow-primary/10">
            <div className="flex items-center gap-2">
              <MessageSquare size={18} />
              <p className="text-sm font-bold">Capability-owned conversations</p>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-primary-fixed-dim">
              The active chat agent for this capability is <span className="font-bold text-white">{activeChatAgent?.name}</span>. Switching capability swaps the roster and the conversation history together.
            </p>
            <button
              onClick={() => navigate('/capabilities/metadata')}
              className="mt-4 flex w-full items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-left transition-all hover:bg-white/15"
            >
              <span className="text-sm font-bold">Edit capability metadata</span>
              <ArrowRight size={16} />
            </button>
            <button
              onClick={() => navigate('/chat')}
              className="mt-3 flex w-full items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-left transition-all hover:bg-white/15"
            >
              <span className="text-sm font-bold">Open chat workspace</span>
              <ArrowRight size={16} />
            </button>
          </div>

          <div className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <Brain size={16} className="text-primary" />
              <p className="text-sm font-bold text-on-surface">Capability rule</p>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-secondary">
              Agents do not float globally. They belong to the active capability, learn within it, use that capability’s skills and metadata, and operate only on that capability’s chats, workflows, and artifacts.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
