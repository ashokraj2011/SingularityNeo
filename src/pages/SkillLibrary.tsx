import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  Cpu,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SKILL_LIBRARY } from '../constants';
import { useCapability } from '../context/CapabilityContext';
import { useToast } from '../context/ToastContext';
import { LearningUpdate, Skill } from '../types';

const createSkillId = (name: string) =>
  `SKL-${name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18)}`;

const inferCategory = (value: string): Skill['category'] => {
  const normalized = value.toLowerCase();
  if (normalized.includes('security') || normalized.includes('vulnerability')) {
    return 'Security';
  }
  if (normalized.includes('compliance') || normalized.includes('audit') || normalized.includes('policy')) {
    return 'Compliance';
  }
  if (normalized.includes('autom') || normalized.includes('remediation') || normalized.includes('workflow')) {
    return 'Automation';
  }
  if (normalized.includes('data') || normalized.includes('schema') || normalized.includes('mapping')) {
    return 'Data';
  }
  return 'Analysis';
};

const buildLearningSkill = (update: LearningUpdate): Skill => {
  const source = (update.skillUpdate || update.insight).trim();
  const normalizedName = source
    .split(/[.!?]/)[0]
    .split(/\s+/)
    .slice(0, 5)
    .join(' ');

  const name = normalizedName.replace(/\b\w/g, char => char.toUpperCase()) || 'Learning Skill';

  return {
    id: createSkillId(name),
    name,
    description: update.skillUpdate || update.insight,
    category: inferCategory(`${update.insight} ${update.skillUpdate || ''}`),
    version: '1.0.0',
  };
};

export default function SkillLibrary() {
  const navigate = useNavigate();
  const {
    activeCapability,
    getCapabilityWorkspace,
    addCapabilitySkill,
    removeCapabilitySkill,
  } = useCapability();
  const { success } = useToast();
  const workspace = getCapabilityWorkspace(activeCapability.id);
  const [draft, setDraft] = useState({
    name: '',
    description: '',
    category: 'Analysis' as Skill['category'],
    version: '1.0.0',
  });

  const capabilitySkills = activeCapability.skillLibrary;
  const capabilitySkillIds = useMemo(
    () => new Set(capabilitySkills.map(skill => skill.id)),
    [capabilitySkills],
  );
  const sharedCatalog = useMemo(
    () => SKILL_LIBRARY.filter(skill => !capabilitySkillIds.has(skill.id)),
    [capabilitySkillIds],
  );
  const skillCoverage = useMemo(
    () =>
      capabilitySkills.map(skill => ({
        skill,
        attachedAgents: workspace.agents.filter(agent => agent.skillIds.includes(skill.id)),
      })),
    [capabilitySkills, workspace.agents],
  );
  const learningSuggestions = useMemo(
    () =>
      workspace.learningUpdates
        .map(update => ({
          update,
          skill: buildLearningSkill(update),
        }))
        .filter(({ skill }) => !capabilitySkillIds.has(skill.id)),
    [capabilitySkillIds, workspace.learningUpdates],
  );

  const totalSkillAttachments = workspace.agents.reduce(
    (count, agent) => count + agent.skillIds.length,
    0,
  );
  const canCreate = Boolean(draft.name.trim() && draft.description.trim());

  const setField = (field: keyof typeof draft, value: string) => {
    setDraft(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleCreateSkill = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate) {
      return;
    }

    const skillName = draft.name.trim();
    addCapabilitySkill(activeCapability.id, {
      id: createSkillId(draft.name),
      name: skillName,
      description: draft.description.trim(),
      category: draft.category,
      version: draft.version.trim() || '1.0.0',
    });
    success('Skill added', `${skillName} is now available in this capability.`);

    setDraft({
      name: '',
      description: '',
      category: 'Analysis',
      version: '1.0.0',
    });
  };

  const handleRemoveSkill = (skill: Skill) => {
    removeCapabilitySkill(activeCapability.id, skill.id);
    success('Skill removed', `${skill.name} was removed from this capability.`);
  };

  const handleAddCatalogSkill = (skill: Skill) => {
    addCapabilitySkill(activeCapability.id, skill);
    success('Skill added', `${skill.name} was added to ${activeCapability.name}.`);
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-primary/10 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-widest text-primary">
              Skill Library
            </span>
            <span className="text-[0.625rem] font-bold uppercase tracking-widest text-slate-400">
              {activeCapability.id}
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-on-surface">
            {activeCapability.name} Skill Library
          </h1>
          <p className="text-sm font-medium text-secondary">
            Curate the reusable skills that belong to this capability, import shared
            skills when needed, and promote learning updates into the library so
            agents can keep getting smarter inside the same context boundary.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={() => navigate('/team')}
            className="inline-flex items-center gap-2 rounded-2xl border border-primary/10 bg-white px-4 py-3 text-sm font-bold text-primary shadow-sm transition-all hover:bg-primary/5"
          >
            <Cpu size={16} />
            Manage Agents
          </button>
          <button
            onClick={() => navigate('/tasks')}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all hover:brightness-110"
          >
            <ArrowRight size={16} />
            View Execution Learning
          </button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Capability Skills', value: capabilitySkills.length },
          { label: 'Shared Catalog', value: sharedCatalog.length },
          { label: 'Agent Attachments', value: totalSkillAttachments },
          { label: 'Learning Suggestions', value: learningSuggestions.length },
        ].map(item => (
          <div
            key={item.label}
            className="rounded-3xl border border-outline-variant/15 bg-white p-5 shadow-sm"
          >
            <p className="text-2xl font-extrabold text-primary">{item.value}</p>
            <p className="mt-1 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-secondary">
              {item.label}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-8">
          <section className="overflow-hidden rounded-3xl border border-outline-variant/15 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-outline-variant/10 bg-primary/5 p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary p-2 text-white">
                  <BookOpen size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-primary">Capability Skill Library</h2>
                  <p className="text-[0.6875rem] text-secondary">
                    Skills explicitly curated for {activeCapability.name}.
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-primary">
                {capabilitySkills.length} skills
              </span>
            </div>

            <div className="grid gap-4 p-6 md:grid-cols-2">
              {skillCoverage.map(({ skill, attachedAgents }) => (
                <article
                  key={skill.id}
                  className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{skill.name}</p>
                      <p className="mt-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        {skill.category} • v{skill.version}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveSkill(skill)}
                      className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white hover:text-error"
                      aria-label={`Remove ${skill.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <p className="mt-4 text-sm leading-relaxed text-secondary">
                    {skill.description}
                  </p>

                  <div className="mt-5 rounded-2xl bg-white p-4">
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                      Attached Agents
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {attachedAgents.length > 0 ? (
                        attachedAgents.map(agent => (
                          <span
                            key={agent.id}
                            className="rounded-full bg-primary/5 px-3 py-1.5 text-xs font-bold text-primary"
                          >
                            {agent.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-secondary">
                          Not attached to any capability agent yet.
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              ))}

              {capabilitySkills.length === 0 && (
                <div className="md:col-span-2 rounded-3xl border border-dashed border-outline-variant/20 bg-surface-container-low p-10 text-center">
                  <p className="text-lg font-bold text-primary">No capability-owned skills yet</p>
                  <p className="mt-2 text-sm text-secondary">
                    Add custom skills, import from the shared catalog, or promote
                    learning updates from execution into this capability library.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-tertiary/10 p-2 text-tertiary">
                <Brain size={18} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-primary">Learning-Derived Skills</h2>
                <p className="text-[0.6875rem] text-secondary">
                  Convert execution learning into reusable skills for the capability team.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {learningSuggestions.map(({ update, skill }) => (
                <div
                  key={update.id}
                  className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{skill.name}</p>
                      <p className="mt-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        Suggested from {update.agentId}
                      </p>
                    </div>
                    <button
                      onClick={() => handleAddCatalogSkill(skill)}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-[0.6875rem] font-bold text-white transition-all hover:brightness-110"
                    >
                      <Wand2 size={14} />
                      Apply
                    </button>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-secondary">
                    {skill.description}
                  </p>
                </div>
              ))}

              {learningSuggestions.length === 0 && (
                <div className="rounded-3xl bg-surface-container-low p-6 text-sm text-secondary">
                  No unapplied learning-derived skill suggestions are waiting right now.
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Plus size={18} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-primary">Create Custom Skill</h2>
                <p className="text-[0.6875rem] text-secondary">
                  Add a capability-specific skill that only belongs to this workspace.
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateSkill} className="mt-5 space-y-4">
              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Skill Name
                </span>
                <input
                  value={draft.name}
                  onChange={event => setField('name', event.target.value)}
                  placeholder="Settlement exception triage"
                  className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <label className="space-y-2">
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                  Description
                </span>
                <textarea
                  value={draft.description}
                  onChange={event => setField('description', event.target.value)}
                  placeholder="What the skill does, what inputs it expects, and what outcomes it improves."
                  className="h-28 w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                    Category
                  </span>
                  <select
                    value={draft.category}
                    onChange={event =>
                      setField('category', event.target.value as Skill['category'])
                    }
                    className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                  >
                    {['Analysis', 'Automation', 'Security', 'Compliance', 'Data'].map(category => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-outline">
                    Version
                  </span>
                  <input
                    value={draft.version}
                    onChange={event => setField('version', event.target.value)}
                    className="w-full rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3 text-sm outline-none transition-all focus:border-primary/20 focus:ring-2 focus:ring-primary/10"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={!canCreate}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={16} />
                Add to Capability Skill Library
              </button>
            </form>
          </section>

          <section className="rounded-3xl border border-outline-variant/15 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <Sparkles size={18} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-primary">Shared Skill Catalog</h2>
                <p className="text-[0.6875rem] text-secondary">
                  Import reusable shared skills into this capability when they fit.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {sharedCatalog.map(skill => (
                <div
                  key={skill.id}
                  className="rounded-3xl border border-outline-variant/15 bg-surface-container-low p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{skill.name}</p>
                      <p className="mt-1 text-[0.625rem] font-bold uppercase tracking-[0.18em] text-outline">
                        {skill.category} • v{skill.version}
                      </p>
                    </div>
                    <button
                      onClick={() => handleAddCatalogSkill(skill)}
                      className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white px-3 py-1.5 text-[0.6875rem] font-bold text-primary transition-all hover:bg-primary/5"
                    >
                      <CheckCircle2 size={14} />
                      Import
                    </button>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-secondary">
                    {skill.description}
                  </p>
                </div>
              ))}

              {sharedCatalog.length === 0 && (
                <div className="rounded-3xl bg-surface-container-low p-6 text-sm text-secondary">
                  Every shared skill is already available inside this capability library.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
